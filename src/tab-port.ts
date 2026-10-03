import { stampLine } from "./details.js";
import { resultMessages } from "./pieces.js";
import type { Progress } from "./progress.js";
import { PORT_NAME, type PageMessage, type Subject, type TabMessage } from "./protocol.js";
import type { AnalysisResult } from "./result-types.js";
import { message } from "./util.js";
import { VERSION } from "./version.js";

/** The Anaplan tab's end of the port to the results page (protocol.ts). The page opens the port; this side says what the
 * tab shows and reads nothing until the page sends "run". It then reports each step and each line of the diagnostic log,
 * and finally the result in pieces (pieces.ts), or the error that stopped the run.
 * - One run at a time. A second results page of the same tab that asks while a run is going follows that run.
 * - When the last page following a run goes away, the run is stopped: nothing more is read for a page nobody is looking at.
 * - Only this extension's results page is answered: its own ID as the sender, and the port's name. */

/** An app or a model: something a run can read. */
export type Seen = Exclude<Subject, { kind: "none" }>;

/** What this file needs from the content script around it. */
export interface Tab {
  /** The Anaplan host, for the first line of the diagnostic log. */
  host: string;
  /** What the tab shows now. */
  subject(): Subject;
  /** Reads it. When `signal` stops the run, the promise rejects with the signal's reason. */
  run(subject: Seen, progress: Progress, diagnostics: () => string, signal: AbortSignal): Promise<AnalysisResult>;
  /** True for the error that means Anaplan's session has ended. */
  signedOut(error: unknown): boolean;
}

export const SIGNED_OUT = "You're signed out of Anaplan. Sign in and try again.";
export const NOTHING_TO_ANALYSE = "This tab is not showing an Anaplan app or a model. Open an app, or a model in Model Building, and run again.";
export const BUSY = "This tab is still busy with an earlier run of something else. Run again when it has finished.";
const STOPPING = "Stopping the previous run…";
/** The reason a run is stopped with. */
const NOBODY_LISTENING = "Stopped: the results page was closed.";
/** As many lines of the diagnostic log as a run keeps; the oldest go first. */
const MAX_LOG_LINES = 3000;

type Port = chrome.runtime.Port;
interface Run { subject: Seen; ports: Set<Port>; stop: AbortController; lines: string[]; status?: string }

const same = (a: Subject, b: Subject) => a.kind === b.kind && (a.kind === "none" || a.id === (b as Seen).id);

export function serveTab(runtime: Pick<typeof chrome.runtime, "id" | "onConnect">, tab: Tab): void {
  let run: Run | undefined;
  /** Pages that asked while a stopped run was still ending: they start the next one. */
  const waiting = new Set<Port>();

  /** A port can close between two messages; its disconnect listener does the tidying. */
  const send = (port: Port, sent: TabMessage) => { try { port.postMessage(sent); } catch { /* closed */ } };

  const start = (ports: Set<Port>) => {
    const subject = tab.subject();
    if (subject.kind === "none") {
      for (const port of ports) send(port, { type: "error", message: NOTHING_TO_ANALYSE });
      return;
    }
    const current: Run = run = { subject, ports, stop: new AbortController(), lines: [] };
    const tell = (sent: TabMessage) => { for (const port of current.ports) send(port, sent); };
    const log = (line: string) => {
      const stamped = stampLine(line);
      current.lines.push(stamped);
      if (current.lines.length > MAX_LOG_LINES) current.lines.splice(0, current.lines.length - MAX_LOG_LINES);
      tell({ type: "log", text: stamped });
    };
    const progress: Progress = { status: text => { current.status = text; tell({ type: "status", text }); log(text); }, log };
    log(`Cardigan ${VERSION}: ${subject.kind} ${subject.id} on ${tab.host}`);
    new Promise<AnalysisResult>(resolve => resolve(tab.run(subject, progress, () => current.lines.join("\r\n"), current.stop.signal)))
      // A stopped run has no page left to tell, however it ends: a page that asks while it is ending waits for the next.
      .then(result => { for (const sent of resultMessages(result)) tell(sent); })
      .catch(error => {
        log(`stopped: ${message(error)}`);
        tell(tab.signedOut(error) ? { type: "error", message: SIGNED_OUT, code: "SIGNED_OUT" } : { type: "error", message: message(error) });
      })
      .finally(() => {
        run = undefined;
        if (!waiting.size) return;
        const next = new Set(waiting);
        waiting.clear();
        start(next);
      });
  };

  const ask = (port: Port) => {
    if (!run) { start(new Set([port])); return; }
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
    // The sender must name this extension: two missing IDs are not a match.
    if (!runtime.id || port.sender?.id !== runtime.id || port.name !== PORT_NAME) { port.disconnect(); return; }
    port.onDisconnect.addListener(() => {
      waiting.delete(port);
      if (run?.ports.delete(port) && !run.ports.size) run.stop.abort(new Error(NOBODY_LISTENING));
    });
    port.onMessage.addListener(received => { if ((received as PageMessage | null)?.type === "run") ask(port); });
    send(port, { type: "subject", subject: tab.subject() });
  });
}
