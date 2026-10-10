import { stampLine } from "../details.js";
import { CONTENT_SCRIPT, CONTENT_SCRIPT_ORIGIN, FRESH_MS, OPENED_PARAM, TAB_PARAM, type PageMessage, type Subject, type TabMessage } from "../protocol.js";
import type { AnalysisResult } from "../result-types.js";

/** The results page's side of the port to the Anaplan tab's content script (protocol.ts): it connects, hears what the tab
 * shows, asks for the analysis, follows the progress and puts the result together. It asks by itself only on a page the
 * icon has just opened; any other page waits for the run control. Nothing here touches the page: the page is told the
 * state and draws it. */

/** The Anaplan tab's ID from the results page's address ("?tab=123"), or undefined when the address names none. */
export function tabIdFrom(search: string): number | undefined {
  const value = new URLSearchParams(search).get(TAB_PARAM);
  return value !== null && /^\d{1,10}$/.test(value) ? Number(value) : undefined;
}

/** Whether the toolbar icon has just opened the page: its address says when the icon was clicked ("opened=<Date.now()>"),
 * and that is less than FRESH_MS before `now`. Only then may the page start the analysis by itself (protocol.ts). A time
 * that is no number, or one still to come, is not the icon's. */
export function openedJustNow(search: string, now: number): boolean {
  const value = new URLSearchParams(search).get(OPENED_PARAM);
  if (value === null || !/^\d{1,15}$/.test(value)) return false;
  const age = now - Number(value);
  return age >= 0 && age < FRESH_MS;
}

/** The page's address without the time it was opened at, or undefined when it holds none. A page that has read the time
 * puts this in the address's place, so that a reload, a duplicate or a tab Chrome restores starts nothing by itself. */
export function withoutOpened(search: string): string | undefined {
  const params = new URLSearchParams(search);
  if (!params.has(OPENED_PARAM)) return undefined;
  params.delete(OPENED_PARAM);
  const rest = params.toString();
  return rest ? `?${rest}` : "";
}

/** The part of chrome.runtime.Port the client uses; a test hands it a stand-in. */
export type TabPort = Pick<chrome.runtime.Port, "postMessage" | "disconnect" | "onMessage" | "onDisconnect">;

export type RunState =
  /** The address names no tab: there is nothing to connect to. */
  | { phase: "no-tab" }
  /** The port is open and the tab has not said yet what it shows. */
  | { phase: "connecting" }
  /** The port closed before the tab answered, and kept doing so: its content script is not there, and could not be put
   * there. That is an Anaplan tab that is still loading, or one open since before the extension was installed, updated or
   * reloaded on a page that did not open with the icon. */
  | { phase: "unreachable" }
  /** The tab shows something other than an Anaplan page: `shows` is its origin. */
  | { phase: "not-anaplan"; shows: string }
  /** The tab the page was opened for has been closed. */
  | { phase: "tab-closed" }
  /** The tab is an Anaplan page that shows neither an app nor a model, or a model page that has not loaded its model yet. */
  | { phase: "no-subject" }
  /** The tab shows an app or a model, and nothing has asked for its analysis: the icon did not open this page just now. */
  | { phase: "ready"; kind: "app" | "model" }
  | { phase: "running"; status: string }
  /** The run failed. `message` says what happened and what to do: the tab's own sentence (progress.ts `Failure`, tab-port.ts),
   * or the page's when it could not put the result together. */
  | { phase: "failed"; message: string }
  /** The port closed during a run: the tab was closed or went to another page. */
  | { phase: "interrupted" }
  /** `received` is when the result was complete: the time the page says a result was analysed at, once a refresh has
   * brought it back. */
  | { phase: "done"; result: AnalysisResult; received: Date };

export interface ClientOptions {
  /** Opens the port to the tab: chrome.tabs.connect(tabId, { name: PORT_NAME }). Undefined when the address names no tab. */
  connect: (() => TabPort) | undefined;
  /** True on a page the toolbar icon has just opened (`openedJustNow`): the only page that asks for the analysis by itself. */
  autoRun: boolean;
  /** Why Chrome closed a port (chrome.runtime.lastError), which it only says while the port's disconnect event runs. */
  closeReason?: () => string | undefined;
  /** Puts the content script into the tab when it did not answer (`repairTab`). Tried once for each connection. */
  repair?: () => Promise<Repair>;
  /** How many more times, and how far apart, a tab that did not answer is asked again: it may still be loading. */
  retries?: { count: number; pauseMs: number };
  /** True when the tab no longer exists: asked when the tab first does not answer, so that a closed tab is said to be
   * closed at once. */
  tabGone?: () => Promise<boolean>;
  /** Waits that long: setTimeout's, unless a test passes its own. */
  wait?: (ms: number) => Promise<void>;
  onState(state: RunState): void;
  /** The diagnostic log changed; the lines are the run's so far. */
  onLog?(lines: readonly string[]): void;
}

const STARTING = "Starting the analysis…";
const RECEIVING = "Receiving the result…";
/** The page's own two failures, in the words the tab's messages use for what to do next (progress.ts): they name the run
 * control and the button beside the log as those read. */
export const UNREADABLE = "Cardigan received a result it could not read. Refresh the Anaplan tab, then click the Cardigan icon again.";
export const NO_REASON = "The analysis stopped without saying why. Choose Run again. If it keeps happening, choose Copy diagnostic log and send the log.";
export const MAX_LOG_LINES = 3000;

const text = (value: unknown): value is string => typeof value === "string";
const pause = (ms: number) => new Promise<void>(resolve => { setTimeout(resolve, ms); });

/** What putting the content script into a tab came to: it is there now, or it is not, with what the tab shows when that is
 * no Anaplan page. */
export type Repair = { put: true } | { put: false; notAnaplan?: string };

/** Puts the content script into the tab, when the tab shows an Anaplan page. Chrome puts content scripts only into pages
 * that load after the extension was installed, updated or reloaded; this puts it into one that was open before. Chrome
 * allows it only in a tab the toolbar icon was clicked on, until that tab moves on (activeTab): otherwise nothing is put
 * there, and nothing is said. */
export async function repairTab(scripting: Pick<typeof chrome.scripting, "executeScript">, tabId: number): Promise<Repair> {
  try {
    const [probe] = await scripting.executeScript({ target: { tabId }, func: () => location.origin });
    const origin = typeof probe?.result === "string" ? probe.result : "";
    if (!CONTENT_SCRIPT_ORIGIN.test(origin)) return { put: false, notAnaplan: origin || "a page Cardigan cannot read" };
    await scripting.executeScript({ target: { tabId }, files: [CONTENT_SCRIPT] });
    return { put: true };
  } catch {
    return { put: false };
  }
}

/** A "result" message's result, as far as putting it together needs: its tables with headers and rows, and its summary. */
function isResult(value: unknown): value is AnalysisResult {
  if (!value || typeof value !== "object") return false;
  const result = value as Partial<AnalysisResult>;
  return Array.isArray(result.summary) && Array.isArray(result.tables)
    && result.tables.every(table => !!table && typeof table === "object" && Array.isArray(table.headers) && Array.isArray(table.rows));
}

export class ResultsClient {
  state: RunState = { phase: "connecting" };
  /** Whether an analysis has been asked for on this page: by the icon that has just opened it, or with the run control.
   * Until then the page only says what the tab shows, and reads nothing. */
  asked: boolean;
  /** The diagnostic log of the current run: the tab's lines, each stamped with its time, and why a port closed. */
  readonly log: string[] = [];
  private port: TabPort | undefined;
  private subject: Subject | undefined;
  /** The connection the page is on: each new one, from start or the run control, counts one up. */
  private connection = 0;
  /** How often this connection has asked the tab again, and whether its content script was put back. */
  private attempts = 0;
  private repaired = false;
  /** The result being put together, between "result" and "done". */
  private pending: AnalysisResult | undefined;

  constructor(private readonly options: ClientOptions) {
    // Without a tab there is nothing to ask: the icon's click is no analysis asked for, and the run control stays "Run".
    this.asked = options.autoRun && options.connect !== undefined;
  }

  /** Connects to the tab. On a page the icon has just opened, an app or a model is analysed as soon as the tab says it
   * shows one. Any other page says what the tab shows and waits for the run control. */
  start(): void {
    this.open();
  }

  /** The run control: analyses what the tab shows. On the open port when the tab showed an app or a model, otherwise on a
   * new port, which asks the tab afresh what it shows and then analyses it. Ignored while a run is in progress. */
  runAgain(): void {
    if (this.state.phase === "running") return;
    this.asked = this.options.connect !== undefined;
    const usable = this.port !== undefined && this.subject !== undefined && this.subject.kind !== "none";
    if (!usable || !this.run()) this.open();
  }

  private set(state: RunState): void {
    this.state = state;
    this.options.onState(state);
  }

  private append(line: string): void {
    this.log.push(line);
    if (this.log.length > MAX_LOG_LINES) this.log.splice(0, this.log.length - MAX_LOG_LINES);
    this.options.onLog?.(this.log);
  }

  /** A line of the page's own in the run's log, with its time: what became of the run's result on the page. */
  note(line: string): void {
    this.append(stampLine(line));
  }

  private clearLog(): void {
    this.log.length = 0;
    this.options.onLog?.(this.log);
  }

  /** Opens a port to the tab. `again`: one more try of the same connection, whose log says why it tries again. */
  private open(again = false): void {
    const old = this.port;
    this.port = undefined;
    try { old?.disconnect(); } catch { /* it had closed already */ }
    this.subject = undefined;
    this.pending = undefined;
    if (!again) {
      this.connection++;
      this.attempts = 0;
      this.repaired = false;
      this.clearLog();
    }
    const connect = this.options.connect;
    if (!connect) return this.set({ phase: "no-tab" });
    this.set({ phase: "connecting" });
    let port: TabPort;
    try {
      port = connect();
    } catch (error) {
      if (this.firstTry()) this.append(stampLine(`The tab did not answer: ${error instanceof Error ? error.message : String(error)}`));
      return void this.unanswered();
    }
    this.port = port;
    // A port that has been replaced no longer speaks for the tab: its late messages and its closing are ignored.
    port.onMessage.addListener(message => { if (this.port === port) this.receive(message); });
    port.onDisconnect.addListener(() => {
      const reason = this.options.closeReason?.();
      if (this.port === port) this.closed(reason);
    });
  }

  /** Asks the tab to analyse what it shows. False when the port turns out to be closed. */
  private run(): boolean {
    const port = this.port;
    if (!port) return false;
    const message: PageMessage = { type: "run" };
    try {
      port.postMessage(message);
    } catch {
      return false;
    }
    this.pending = undefined;
    this.clearLog();
    this.set({ phase: "running", status: STARTING });
    return true;
  }

  private receive(received: unknown): void {
    if (!received || typeof received !== "object") return;
    const message = received as TabMessage;
    if (message.type === "subject") {
      // Sent once per port. Only the first one starts a run, so a result on the page is never replaced unasked.
      if (this.subject) return;
      const subject: Subject | undefined = message.subject && typeof message.subject === "object" ? message.subject : undefined;
      if (subject && (subject.kind === "app" || subject.kind === "model")) {
        this.subject = subject;
        // A page nobody has asked reads nothing: by now its tab ID may belong to another tab than the one it was opened for.
        if (!this.asked) return this.set({ phase: "ready", kind: subject.kind });
        if (!this.run()) this.closed(undefined);
      } else {
        this.subject = { kind: "none" };
        this.set({ phase: "no-subject" });
      }
      return;
    }
    // Progress and results belong to a run; outside one (after an error, or before "run") they are not acted on.
    if (this.state.phase !== "running") return;
    switch (message.type) {
      case "status":
        if (text(message.text)) this.set({ phase: "running", status: message.text });
        return;
      case "log":
        if (text(message.text)) this.append(message.text);
        return;
      case "result":
        if (!isResult(message.result)) return this.fail("the tab sent a result the page cannot read");
        // The rows arrive in pieces after this; the tables are copied so the pieces are added to the page's own result.
        this.pending = { ...message.result, tables: message.result.tables.map(table => ({ ...table, rows: [...table.rows] })) };
        this.set({ phase: "running", status: RECEIVING });
        return;
      case "rows": {
        const table = typeof message.table === "number" ? this.pending?.tables[message.table] : undefined;
        if (!table || !Array.isArray(message.rows) || !message.rows.every(Array.isArray)) return this.fail("the tab sent rows that fit no table of its result");
        for (const row of message.rows) table.rows.push(row);
        return;
      }
      case "done": {
        const result = this.pending;
        if (!result) return this.fail("the tab said its result was complete before it sent one");
        this.pending = undefined;
        return this.set({ phase: "done", result, received: new Date() });
      }
      // Also in place of "done", when a piece of the result could not be sent: what has arrived of it is not shown.
      case "error": {
        this.pending = undefined;
        const failure = text(message.message) && message.message ? message.message : NO_REASON;
        // The tab writes why a run stopped into its log before it says so. An error with no line before it (the tab had
        // nothing to analyse, or is busy with an earlier run) gets one here: a failed run always has a log to copy.
        if (!this.log.length) this.append(stampLine(`stopped: ${failure}`));
        return this.set({ phase: "failed", message: failure });
      }
    }
  }

  /** The pieces the tab sent do not make a result. The run has failed, and the log says what did not fit. */
  private fail(detail: string): void {
    this.pending = undefined;
    this.append(stampLine(`stopped: ${detail}`));
    this.set({ phase: "failed", message: UNREADABLE });
  }

  private closed(reason: string | undefined): void {
    this.port = undefined;
    const why = reason ? `: ${reason}` : ".";
    if (this.state.phase === "connecting") {
      if (this.firstTry()) this.append(stampLine(`The tab did not answer${why}`));
      void this.unanswered();
    } else if (this.state.phase === "running") {
      this.pending = undefined;
      this.append(stampLine(`The connection to the tab closed${why}`));
      this.set({ phase: "interrupted" });
    }
    // After a result, an error or "not an app or a model", and while the page waits for the run control, there is nothing
    // to say: the run control opens a new port.
  }

  /** The tab did not answer this connection. Its content script is put back once, and it is asked again for a while; then
   * the page says that the tab is unreachable, or gone. A step whose connection the run control has replaced meanwhile
   * ends there. Without a way to put the script back, to ask again or to look for the tab, it says so at once. */
  private async unanswered(): Promise<void> {
    const connection = this.connection;
    const current = () => connection === this.connection && this.state.phase === "connecting";
    const { repair, retries, tabGone } = this.options;
    // A closed tab is said to be closed at once: there is nothing to put the script into, or to ask again.
    if (this.firstTry() && tabGone && await Promise.resolve().then(tabGone).catch(() => false)) {
      if (current()) this.set({ phase: "tab-closed" });
      return;
    }
    if (repair && !this.repaired) {
      this.repaired = true;
      const repaired = await repair().catch((): Repair => ({ put: false }));
      if (!current()) return;
      if (repaired.put) {
        this.append(stampLine("Cardigan put its content script into the tab, which had none."));
        return this.open(true);
      }
      if (repaired.notAnaplan !== undefined) return this.set({ phase: "not-anaplan", shows: repaired.notAnaplan });
    }
    if (retries && this.attempts < retries.count) {
      this.attempts++;
      await (this.options.wait ?? pause)(retries.pauseMs);
      if (current()) this.open(true);
      return;
    }
    if (!current()) return;
    // The log has the first try's line: the tries after it are counted, not each written down.
    if (this.attempts) this.append(stampLine(`No answer after ${this.attempts} more ${this.attempts === 1 ? "try" : "tries"}.`));
    this.set({ phase: "unreachable" });
  }

  /** True on the first try of this connection: the one whose failure the log has a line for. */
  private firstTry(): boolean {
    return this.attempts === 0 && !this.repaired;
  }
}

/** What the run control reads: "Run" until an analysis has been asked for on this page, "Run again" after. */
export const runLabel = (asked: boolean): string => (asked ? "Run again" : "Run");

/** What the page says for a state that is not a result: a heading, the message, and what to do about it. `asked` is the
 * client's: the run control is named as it reads. */
export interface StateText { title: string; message: string; hint: string }
export function describeState(state: RunState, asked: boolean): StateText {
  const run = runLabel(asked);
  switch (state.phase) {
    case "no-tab":
      return { title: "No Anaplan tab", message: "This page was opened without an Anaplan tab to read.",
        hint: "Open an app or a model in Anaplan, then click the Cardigan icon on that tab." };
    case "connecting":
      return { title: "Connecting", message: "Connecting to the Anaplan tab…", hint: "" };
    case "unreachable":
      return { title: "Not connected", message: "Cardigan cannot reach that tab.",
        hint: `If it is an Anaplan app or model that is still loading, wait for it, then choose ${run}. Otherwise refresh it, then click the Cardigan icon on it.` };
    case "not-anaplan":
      return { title: "Not an Anaplan tab", message: `That tab shows ${state.shows}, not Anaplan.`,
        hint: "Open an app or a model in Anaplan, then click the Cardigan icon on that tab." };
    case "tab-closed":
      return { title: "Tab closed", message: "The Anaplan tab this page was opened for has been closed.",
        hint: "Open the app or model in Anaplan again, then click the Cardigan icon on that tab." };
    case "no-subject":
      return { title: "Nothing to analyse", message: "That Anaplan page is not an app or a model.",
        hint: `Open an app, or a model in Model Building, in that tab; if it is still loading, give it a moment. Then choose ${run}.` };
    case "ready":
      return { title: "Ready to analyse", message: `That Anaplan tab shows ${state.kind === "app" ? "an app" : "a model"}.`,
        hint: `Choose ${run} to analyse it. This page starts by itself only when the Cardigan icon has just opened it.` };
    case "running":
      return { title: "Analysing", message: state.status, hint: "Keep the Anaplan tab open until this finishes." };
    // The message is a whole sentence that says what to do next, so the page adds no advice of its own under it.
    case "failed":
      return { title: "The analysis stopped", message: state.message, hint: "" };
    case "interrupted":
      return { title: "The analysis stopped", message: "The Anaplan tab was closed or left the page before the analysis finished.",
        hint: `Open the app or model again, then click the Cardigan icon or choose ${run}.` };
    case "done":
      return { title: "Results", message: "", hint: "" };
  }
}
