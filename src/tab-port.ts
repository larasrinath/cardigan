import { stampLine } from "./details.js";
import { resultMessages } from "./pieces.js";
import { failureOf, firstLine, OldReader, SEND_LOG, type Progress } from "./progress.js";
import { PORT_NAME, type PageMessage, type Subject, type TabMessage } from "./protocol.js";
import type { AnalysisResult } from "./result-types.js";
import { message } from "./util.js";

/** The Anaplan tab's end of the port to the results page (protocol.ts). The page opens the port; this side says what the
 * tab shows and reads nothing until the page sends "run". It then reports each step and each line of the diagnostic log,
 * and finally the result in pieces (pieces.ts), or the error that stopped the run.
 * - One run at a time. A second results page of the same tab that asks while a run is going follows that run.
 * - A run's "done" or "error" is its last message: whatever the run still reports afterwards is sent to nobody.
 * - A page that a piece of the result cannot be sent to is told that the run failed, in place of the rest and of "done".
 * - An "error" is a sentence for the user: what happened and what to do next (progress.ts `Failure`). What a developer
 *   asks for (codes, status numbers, counts) is in the line of the diagnostic log that says why the run stopped.
 * - When the last page following a run goes away, the run is stopped: nothing new is asked of Anaplan for a page nobody is
 *   looking at. An app's analysis starts no further page and asks nothing more for a model's names (analyse.ts), and a
 *   model's export reads no further rows of a grid (bridge.ts). A read that is under way is not cut short, except that
 *   the socket to a model is closed at once, and the routes still to be tried for the app page being read are tried.
 * - Only this extension's results page is answered: its own ID as the sender, and the port's name.
 * - An "open" asks the tab to open a module or a list inside the Model Building page it shows (content.ts). It is
 *   answered on its own, with or without a run going on, and reads nothing. */

/** An app or a model: something a run can read. */
export type Seen = Exclude<Subject, { kind: "none" }>;

/** How the page asked for a run (protocol.ts "run"): `afterRefresh`, right after it refreshed the tab for it. */
export interface RunAsked { afterRefresh?: boolean }

/** What became of an "open": whether the page took the module or the list, and in a few words how, or why not, for the
 * log. `oldReader`: not, because the model's frame holds a reader of another build. */
export interface Opened { opened: boolean; detail: string; oldReader?: boolean }

/** What this file needs from the content script around it. */
export interface Tab {
  /** The Anaplan host, for the first line of the diagnostic log. */
  host: string;
  /** What the tab shows now. */
  subject(): Subject;
  /** Reads it. When `signal` stops the run, the promise rejects with the signal's reason. A run that fails rejects with a
   * Failure (progress.ts), whose message the page is told as it is; any other error is told as an unexpected one. An
   * OldReader is told with its code, and with whether the page may put this build's reader into the tab. `asked` is how
   * the page that started the run asked for it. */
  run(subject: Seen, progress: Progress, diagnostics: () => string, signal: AbortSignal, asked?: RunAsked): Promise<AnalysisResult>;
  /** True for the error that means Anaplan's session has ended. */
  signedOut(error: unknown): boolean;
  /** False once a later copy of the content script serves the document: this one then leaves new results pages to it. */
  current?(): boolean;
  /** Opens a module or a list of the model inside the Model Building page the tab shows, beside the tabs open there
   * (protocol.ts "open"). A tab without it answers that it cannot. */
  open?(model: string, object: string): Promise<Opened>;
}

export const SIGNED_OUT = "You're signed out of Anaplan. Sign in and try again.";
export const NOTHING_TO_ANALYSE = "This tab is not showing an Anaplan app or a model. Open an app, or a model in Model Building, then choose Run again.";
/** The tab moved on to another app or model while what it showed before is still being analysed for another results page. */
export const BUSY = "Cardigan is still analysing what this Anaplan tab showed before. Wait for that to finish, or close its results page, then choose Run again.";
const STOPPING = "Stopping the previous run…";
/** What a page is told when a piece of the result could not be sent to it. */
export const UNSENT = `Cardigan finished reading but could not pass the result to this page. Choose Run again. ${SEND_LOG}`;
/** The reason a run is stopped with. */
const NOBODY_LISTENING = "Stopped: the results page was closed.";
/** As many lines of the diagnostic log as a run keeps; the oldest go first. */
const MAX_LOG_LINES = 3000;

type Port = chrome.runtime.Port;
interface Run { subject: Seen; ports: Set<Port>; stop: AbortController; lines: string[]; status?: string }

const same = (a: Subject, b: Subject) => a.kind === b.kind && (a.kind === "none" || a.id === (b as Seen).id);

/** An "open" as the page may send it: a nonce to answer with, a model's 32-character ID and a module's or a list's ID in
 * digits. Anything else is not answered. */
const OPEN_NONCE = /^[\w-]{1,100}$/;
const OPEN_MODEL = /^[0-9A-Za-z]{32}$/;
const OPEN_OBJECT = /^\d{1,19}$/;
type OpenAsked = Extract<PageMessage, { type: "open" }>;
const openAsked = (received: unknown): OpenAsked | undefined => {
  const asked = received as Partial<OpenAsked> | null;
  return asked?.type === "open" && typeof asked.nonce === "string" && OPEN_NONCE.test(asked.nonce) && typeof asked.model === "string" && OPEN_MODEL.test(asked.model)
    && typeof asked.object === "string" && OPEN_OBJECT.test(asked.object) ? asked as OpenAsked : undefined;
};

export function serveTab(runtime: Pick<typeof chrome.runtime, "id" | "onConnect">, tab: Tab): void {
  let run: Run | undefined;
  /** Pages that asked while a stopped run was still ending: they start the next one. */
  const waiting = new Set<Port>();

  /** A port can close between two messages; its disconnect listener does the tidying. */
  const send = (port: Port, sent: TabMessage) => { try { port.postMessage(sent); } catch { /* closed */ } };

  /** The result to one page, in pieces. If one of them cannot be sent, the page gets none of the rest and no "done": it is
   * told that the run failed instead, with the reason as a last line of its log, so that it never takes a result that
   * lacks rows for the whole. (A port that has closed takes those no more than the piece.) */
  const deliver = (port: Port, result: AnalysisResult) => {
    try {
      for (const sent of resultMessages(result)) port.postMessage(sent);
    } catch (error) {
      send(port, { type: "log", text: stampLine(`stopped: the result could not be sent (${message(error)})`) });
      send(port, { type: "error", message: UNSENT });
    }
  };

  const start = (ports: Set<Port>, asked: RunAsked = {}) => {
    const subject = tab.subject();
    if (subject.kind === "none") {
      for (const port of ports) send(port, { type: "error", message: NOTHING_TO_ANALYSE });
      return;
    }
    const current: Run = run = { subject, ports, stop: new AbortController(), lines: [] };
    /** True once the run's "done" or "error" has gone out. What the run still reports after that is sent to nobody: a
     * socket logs its closing when the close event fires, and by then the same ports may be following the next run. */
    let over = false;
    const tell = (sent: TabMessage) => { if (!over) for (const port of current.ports) send(port, sent); };
    const log = (line: string) => {
      const stamped = stampLine(line);
      current.lines.push(stamped);
      if (current.lines.length > MAX_LOG_LINES) current.lines.splice(0, current.lines.length - MAX_LOG_LINES);
      tell({ type: "log", text: stamped });
    };
    const progress: Progress = { status: text => { current.status = text; tell({ type: "status", text }); log(text); }, log };
    log(firstLine(subject.kind, subject.id, tab.host));
    const perform = async () => {
      try {
        const result = await tab.run(subject, progress, () => current.lines.join("\r\n"), current.stop.signal, asked);
        // A stopped run has no page left to tell, however it ends: a page that asks while it is ending waits for the next.
        for (const port of current.ports) deliver(port, result);
      } catch (error) {
        const failed = failureOf(error);
        log(`stopped: ${failed.detail ?? failed.message}`);
        tell(tab.signedOut(error) ? { type: "error", message: SIGNED_OUT, code: "SIGNED_OUT" }
          : error instanceof OldReader ? { type: "error", message: failed.message, code: "OLD_READER", renewable: error.renewable }
          : { type: "error", message: failed.message });
      } finally {
        // In the same turn as the last message, so that nothing the run still reports can follow it.
        over = true;
        run = undefined;
        if (waiting.size) {
          const next = new Set(waiting);
          waiting.clear();
          start(next);
        }
      }
    };
    void perform();
  };

  /** Opens a module or a list in the page as the page asked, and says what became of it. It belongs to no run: a run going on
   * meanwhile is neither waited for nor told. */
  const answerOpen = async (port: Port, asked: OpenAsked) => {
    let answer: Opened;
    try {
      answer = tab.open ? await tab.open(asked.model, asked.object) : { opened: false, detail: "this tab opens nothing in its page" };
    } catch (error) {
      answer = { opened: false, detail: message(error) };
    }
    send(port, { type: "opened", nonce: asked.nonce, opened: answer.opened === true, detail: String(answer.detail), ...(answer.oldReader === true ? { oldReader: true } : {}) });
  };

  const ask = (port: Port, asked: RunAsked) => {
    if (!run) { start(new Set([port]), asked); return; }
    if (run.ports.has(port)) return;
    if (run.stop.signal.aborted) {
      waiting.add(port);
      send(port, { type: "status", text: STOPPING });
    } else if (same(run.subject, tab.subject())) {
      if (run.status !== undefined) send(port, { type: "status", text: run.status });
      for (const text of run.lines) send(port, { type: "log", text });
      run.ports.add(port);
    } else {
      send(port, { type: "error", message: BUSY });
    }
  };

  runtime.onConnect.addListener(port => {
    // A later copy of the content script answers instead. The port is not closed: that would close it for that copy too.
    if (tab.current && !tab.current()) return;
    // The sender must name this extension: two missing IDs are not a match.
    if (!runtime.id || port.sender?.id !== runtime.id || port.name !== PORT_NAME) { port.disconnect(); return; }
    port.onDisconnect.addListener(() => {
      waiting.delete(port);
      if (run?.ports.delete(port) && !run.ports.size) run.stop.abort(new Error(NOBODY_LISTENING));
    });
    port.onMessage.addListener(received => {
      const message = received as PageMessage | null;
      if (message?.type === "run") ask(port, message.afterRefresh === true ? { afterRefresh: true } : {});
      const open = openAsked(received);
      if (open) void answerOpen(port, open);
    });
    send(port, { type: "subject", subject: tab.subject() });
  });
}
