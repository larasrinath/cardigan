import { stampLine } from "./details.js";
import { Failure, failureOf, ModelUnavailable, OldReader, REFRESH, SEND_LOG, UNEXPECTED, type Progress, type Stop } from "./progress.js";
import { plainResult, textOf } from "./result-plain.js";
import type { AnalysisResult } from "./result-types.js";
import { SCOPE_ID, sleep } from "./util.js";
import { BUILD } from "./version.js";

/** The Model Building page (`/a/modeling/…/models/{id}`) is a shell; the classic model client runs in a core frame inside it,
 * often on another data centre's host. The export must read there,
 * but the results page talks to the content script of the page the user sees. This bridge links the two with window
 * messages: the core frame announces itself, the shell asks it to export, and the core frame streams progress and finally
 * the result (the export's files as tables) back. The shell can also ask it to open one of the model's modules, lists or
 * settings pages in the page, as Model Building's own Modules list, General Lists and sidebar open one (`openInCore`).
 * Each side accepts messages only from the other window and only from an Anaplan origin, and addresses its own to the
 * other window's Anaplan origin alone (`TopWindow` on the core side). Only the page's greeting to its frames, which carries
 * nothing, goes to any origin (`greetFrames`). On the classic model page opened on its own there is no frame: the core
 * side runs in the page's own window, and the other window is that same window.
 *
 * A frame can hold two readers: the one Chrome put there as the page loaded, and one of a later build that the results
 * page put beside it since (results/connection.ts `renewReader`). Checking in is common to all of them (PROTOCOL), so
 * that the page hears every reader and the build each is of. What sets a reader to work, and what it answers, goes on a
 * channel of its own (RUN_PROTOCOL), each message with its build, and a reader takes only its own build's: so only the
 * reader of the content script's build reads the model or opens anything. A reader made before that channel listens on
 * PROTOCOL alone, and hears none of it. */

export const PROTOCOL = "cardigan-model-export";
/** The channel of a run and of an ask to open: "run", "stop" and "open" to the reader, and "status", "log", "alive",
 * "done", "error" and "opened" back. Every message on it says its build (version.ts `BUILD`). */
export const RUN_PROTOCOL = "cardigan-model-reader";
export const ANAPLAN_ORIGIN = /^https:\/\/[a-z0-9.-]+\.anaplan\.com$/i;
const WAIT_FOR_CORE_MS = 120_000;
/** Why an export that was asked to stop ends. */
const STOPPED = "The export was stopped.";
/** What the user is told when the page cannot get the model exported (progress.ts `Failure`). */
export const NO_MODEL = "The model is still opening; wait until it shows in Anaplan, then choose Run again.";
export const NO_READER = "Refresh the Anaplan tab to load Cardigan's model reader and run again.";
export const QUIET = "The model stopped answering while Cardigan was reading it. Check that it is still open in the Anaplan tab, then choose Run again.";
/** What the user is told when the model's frame did not answer a run at all (`FIRST_ANSWER_MS`). */
export const UNANSWERED = "The model's page in the Anaplan tab did not answer. Refresh the Anaplan tab, wait until the model shows, then choose Run again.";
/** How long a run waits for the model's frame to answer it at all, with its first step, or with "alive" where it takes over
 * an export that was stopped (`serveCore`). A frame that serves a reader of this build answers in the very turn it hears
 * the run, so the answer comes at once, or within a second or two where the frame's page is busy. One that has said
 * nothing by then has no reader that serves it: Model Building moved the frame to another page whose reader has not
 * started, or the page in it is stuck. Thirty seconds leave room for a page that is busy for a while, as Model Building
 * can be just after it opens a model, and are still a tenth of the idle time. Only once the frame has answered is it given
 * the idle time, which is for a long read (`runInCore`). */
export const FIRST_ANSWER_MS = 30_000;
export const UNREADABLE = `Cardigan could not read what the model's page sent back. ${REFRESH} ${SEND_LOG}`;
/** What the user is told when the model's reader in the tab is of another build than the content script: Chrome puts the
 * reader into a page as it loads, and a reload of the extension takes it out of no page, so a model open since before an
 * update still has the earlier reader, which the results page cannot put back as it puts back the content script. Read
 * with it, a model's result would lack what the earlier build did not read. */
export const OLD_READER = "This Anaplan tab was open before Cardigan was updated or reloaded, and still holds the earlier Cardigan's model reader. "
  + "Refresh the Anaplan tab, wait until the model shows, then choose Run again.";

export interface Endpoint {
  postMessage(message: unknown, targetOrigin: string, transfer?: Transferable[]): void;
  /** A window says it once it has gone, whatever its origin: a frame's window once the frame was taken out of the page
   * (`gone`). */
  readonly closed?: boolean;
}
export interface MessageTarget {
  addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
  removeEventListener(type: "message", listener: (event: MessageEvent) => void): void;
}
/** A model's reader as it announced itself: its window, its origin, the model it holds, and its build (version.ts `BUILD`),
 * which a reader made before builds were marked does not say. */
export interface CoreHandle { source: Endpoint; origin: string; modelId: string; build?: string }
/** A build's mark as a reader says it: a few letters and digits, which the log may quote. */
const BUILD_MARK = /^[\w.-]{1,40}$/;

/** Whether a reader's window has gone: its frame was taken out of the page, and what is posted to it reaches nobody. The
 * window says so itself, whatever its origin (`closed`): in Chrome the window of a frame taken out of the page says it is
 * closed, a frame of another site's as well, and posting to it throws nothing. A frame that was only moved to another page
 * is the same window, and open. A window that cannot be asked is taken to be there: the run's short wait for its answer
 * tells (`runInCore`). */
export function gone(core: CoreHandle): boolean {
  try {
    return core.source.closed === true;
  } catch {
    return false;
  }
}

// Messages are structured clones from another window; fields are checked before use.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Message = Record<string, any>;
const ours = (event: MessageEvent): Message | undefined => {
  const data = event.data as Message | null;
  return data && typeof data === "object" && data.protocol === PROTOCOL && ANAPLAN_ORIGIN.test(event.origin) ? data : undefined;
};
/** A message of a run or of an ask to open, of this very build: one of another build is for another reader. */
const ofThisBuild = (event: MessageEvent): Message | undefined => {
  const data = event.data as Message | null;
  return data && typeof data === "object" && data.protocol === RUN_PROTOCOL && data.build === BUILD && ANAPLAN_ORIGIN.test(event.origin) ? data : undefined;
};
/** A message on the run channel, with this build. */
const onRun = (message: Message): Message => ({ protocol: RUN_PROTOCOL, build: BUILD, ...message });

/** Shell side: remembers the model's core frame when it announces itself, and acknowledges it. */
export function watchCore(self: MessageTarget, onCore: (core: CoreHandle) => void): void {
  self.addEventListener("message", event => {
    const data = ours(event);
    if (data?.type !== "core-ready" || typeof data.modelId !== "string" || !SCOPE_ID.test(data.modelId) || !event.source) return;
    const source = event.source as unknown as Endpoint;
    source.postMessage({ protocol: PROTOCOL, type: "ack" }, event.origin);
    onCore({ source, origin: event.origin, modelId: data.modelId, ...(typeof data.build === "string" && BUILD_MARK.test(data.build) ? { build: data.build } : {}) });
  });
}

/** Shell side: asks the core frame to export and relays its progress. Fails if the frame does not answer the run within
 * `firstMs` (at most `idleMs`), if it goes quiet for `idleMs` once it has answered, or if it sends something that is not
 * a model's result. `signal` stops it: the run rejects with the signal's reason. A frame that went quiet and a run that
 * was stopped are both given up at once, and the frame is told to stop reading (serveCore says when it then does). Quiet
 * is no message of this run at all: besides its steps and log lines the frame sends "alive" before each page of a grid it
 * reads, so that a grid of many pages, which has nothing to report between them, is not taken for a frame that has gone.
 * A frame of this build answers a run in the turn it hears it (`FIRST_ANSWER_MS`): one that has not answered within the
 * short wait is given up, telling the user to refresh the tab, and not waited for as long as a read may take. A frame that
 * has gone is not asked at all (`gone`). */
export function runInCore(self: MessageTarget, core: CoreHandle, progress: Progress, idleMs = 300_000, signal?: AbortSignal,
  firstMs = FIRST_ANSWER_MS): Promise<AnalysisResult> {
  return new Promise((resolve, reject) => {
    const nonce = crypto.randomUUID();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (outcome: { result: AnalysisResult } | { error: unknown }) => {
      clearTimeout(timer);
      self.removeEventListener("message", listener);
      signal?.removeEventListener("abort", stop);
      if ("result" in outcome) resolve(outcome.result); else reject(outcome.error);
    };
    /** Ends the run while the frame may still be exporting for it: the frame is told to stop. */
    const giveUp = (error: unknown) => {
      core.source.postMessage(onRun({ type: "stop", nonce }), core.origin);
      finish({ error });
    };
    /** Starts the wait again: for the frame's first answer until it has answered the run, and for the idle time from then on. */
    const wait = (answered: boolean) => {
      clearTimeout(timer);
      const first = Math.min(firstMs, idleMs);
      timer = answered ? setTimeout(() => giveUp(new Failure(QUIET, `the model's frame sent nothing for ${idleMs / 1000} s`)), idleMs)
        : setTimeout(() => giveUp(new Failure(UNANSWERED, `case=NO_ANSWER; the model's frame did not answer the run in ${first / 1000} s`)), first);
    };
    const stop = () => giveUp(signal?.reason ?? new Error(STOPPED));
    const listener = (event: MessageEvent) => {
      const data = ofThisBuild(event);
      if (!data || event.source !== (core.source as unknown) || event.origin !== core.origin || data.nonce !== nonce) return;
      // Whatever the frame sends for this run is its answer, and starts the wait again. For "alive" that is all: it is not
      // passed on.
      wait(true);
      // Nothing here may throw, or the run would be left waiting for the idle time: textOf has a text for every value.
      if (data.type === "status") progress.status(textOf(data.text));
      else if (data.type === "log") progress.log(textOf(data.text));
      else if (data.type === "error") {
        // The frame sends the sentence for the user and, apart from it, the detail for the log (serveCore).
        const detail = data.detail === undefined ? undefined : textOf(data.detail);
        finish({ error: typeof data.message === "string" && data.message ? new Failure(data.message, detail) : new Failure(UNEXPECTED, detail ?? textOf(data.message)) });
      } else if (data.type === "done") {
        const result = plainResult(data.result);
        finish(result?.kind === "model" ? { result } : { error: new Failure(UNREADABLE, "the model's frame sent a result this page cannot read") });
      }
    };
    if (signal?.aborted) { reject(signal.reason ?? new Error(STOPPED)); return; }
    if (gone(core)) { reject(new Failure(UNANSWERED, "case=NO_ANSWER; the model's frame has gone")); return; }
    self.addEventListener("message", listener);
    signal?.addEventListener("abort", stop, { once: true });
    wait(false);
    core.source.postMessage(onRun({ type: "run", nonce }), core.origin);
  });
}

/** How long the page waits, once a reader of another build has checked in, for one of this build to check in as well. One
 * that the results page has just put into the frame does within a second or two (results/connection.ts `renewReader`). */
const OWN_READER_WAIT_MS = 4000;

/** The origin of the page a window holds, or nothing where it cannot be read. */
function originOf(self: Window): string | undefined {
  try {
    const origin = (self as { location?: { origin?: unknown } }).location?.origin;
    return typeof origin === "string" ? origin : undefined;
  } catch {
    return undefined;
  }
}

/** Shell side: the model's own frame (the classic client inside this page) does the reading. Waits for it to check in,
 * asking every frame once a second, then runs the export there. `model` is the model the page's address names. A frame
 * whose reader is of another build than this script, or says none, is not asked: after a few seconds more for one of
 * this build to check in beside it, the run fails with `OLD_READER` (progress.ts `OldReader`). That says whether the
 * frame is on this page's origin, where the results page may put this build's reader itself, and the log says which
 * builds the two are. A frame of another model, or one that has gone, is never asked (`waitForCore`). */
export async function exportInCore(self: Window, core: () => CoreHandle | undefined, probes: () => Iterable<FrameProbe>, model: string, progress: Progress,
  signal?: AbortSignal, waitMs = WAIT_FOR_CORE_MS): Promise<AnalysisResult> {
  const found = await waitForCore(self, core, probes, model, progress, signal, waitMs);
  progress.log("Classic reader: answered; starting model settings");
  return runInCore(self, found, progress, undefined, signal);
}

/** Wait before starting either reader: both Classic and Polaris models can load the Classic client late. Only the reader of
 * `model`, the model the tab's address names, is taken, in whatever case its ID is written. Model Building moves to another
 * model inside its page, so the frame held (`core`) can be the one of the model it showed before, until the new model's
 * frame checks in; and a frame taken out of the page has gone (`gone`). Either is passed over, which the log says once for
 * each, and the frames are greeted every second until the model's own checks in, within the same wait as for none. */
export async function waitForCore(self: Window, core: () => CoreHandle | undefined, probes: () => Iterable<FrameProbe>, model: string, progress: Progress,
  signal?: AbortSignal, waitMs = WAIT_FOR_CORE_MS): Promise<CoreHandle> {
  const deadline = Date.now() + waitMs;
  const began = Date.now();
  /** When a reader of another build was first heard, while none of this build has been. */
  let otherSince: number | undefined;
  /** What the log said of each frame passed over so far, by its window: it says each once. */
  const passed = new Map<Endpoint, string>();
  /** The reader held, where it is the model's own and its frame is there. */
  const ours = (): CoreHandle | undefined => {
    const held = core();
    if (!held) return undefined;
    const why = held.modelId.toUpperCase() !== model.toUpperCase() ? `the tab's address names model ${model}` : gone(held) ? "it has gone" : undefined;
    if (why === undefined) return held;
    const said = `the frame of model ${held.modelId}: ${why}`;
    if (passed.get(held.source) !== said) {
      passed.set(held.source, said);
      progress.log(`Classic reader: passed over ${said}`);
    }
    return undefined;
  };
  for (;;) {
    const found = ours();
    if (found?.build === BUILD) break;
    if (found) otherSince ??= Date.now();
    if (Date.now() >= deadline || (otherSince !== undefined && Date.now() - otherSince >= OWN_READER_WAIT_MS)) break;
    signal?.throwIfAborted();
    progress.status("Waiting for the model to open…");
    greetFrames(self);
    await sleep(1000);
  }
  signal?.throwIfAborted();
  const seen = [...probes()];
  for (const probe of seen) progress.log(describeProbe(probe));
  const found = ours();
  if (!found) throw seen.length || self.document?.readyState === "loading"
    ? new ModelUnavailable(NO_MODEL, `case=MODEL_OPENING; the Classic frame did not answer after ${Math.round((Date.now() - began) / 1000)} s; ${seen.length} frame(s) reported in`, "MODEL_OPENING")
    : new ModelUnavailable(NO_READER, "case=NO_READER; no reader in the frames answered", "NO_READER");
  if (found.build !== BUILD) {
    const page = originOf(self);
    const renewable = page !== undefined && found.origin === page;
    throw new OldReader(OLD_READER, `case=OLD_READER; the model's reader is ${found.build === undefined ? "of a build that names none" : `build ${found.build}`}; this script is build ${BUILD}; `
      + `its frame is ${renewable ? "on the page's own origin" : `on ${found.origin}, the page on ${page ?? "an origin it does not say"}`}`, renewable);
  }
  return found;
}

/** How long the page waits for the model's frame to say whether it opened a module, a list or a settings page (`openInCore`). The frame
 * answers at once; one that is busy or gone has not answered by then, and the object is opened by its address instead. */
const OPEN_WAIT_MS = 700;

/** Shell side: asks the model's frame to open one of the model's modules, lists or settings pages in the page, beside the
 * tabs open there (`serveOpen`). True once the frame says it did; false when it says it could not, or says nothing within `waitMs`. */
export function openInCore(self: MessageTarget, core: CoreHandle, model: string, object: string, waitMs = OPEN_WAIT_MS): Promise<boolean> {
  return new Promise(resolve => {
    const nonce = crypto.randomUUID();
    const finish = (opened: boolean) => {
      clearTimeout(timer);
      self.removeEventListener("message", listener);
      resolve(opened);
    };
    const listener = (event: MessageEvent) => {
      const data = ofThisBuild(event);
      if (data?.type === "opened" && data.nonce === nonce && event.source === (core.source as unknown) && event.origin === core.origin) finish(data.opened === true);
    };
    const timer = setTimeout(() => finish(false), waitMs);
    self.addEventListener("message", listener);
    core.source.postMessage(onRun({ type: "open", nonce, model, object }), core.origin);
  });
}

/** Core side: opens a module, a list or a settings page when the top window asks (`openInCore`), and says whether it did.
 * `opener` does the opening (model/open-object.ts); the object's ID and the model's are checked before it is asked: an ID
 * is a number, and a settings page's may be below nought. `current` is false
 * once a later reader serves this frame (model-content.ts): this one then opens nothing. */
export function serveOpen(self: MessageTarget, top: Endpoint, opener: (model: string, object: string) => Promise<boolean>, current: () => boolean = () => true): () => void {
  const listener = (event: MessageEvent) => {
    const data = ofThisBuild(event);
    if (data?.type !== "open" || event.source !== (top as unknown) || !current() || typeof data.nonce !== "string" || typeof data.model !== "string" || !SCOPE_ID.test(data.model)
      || typeof data.object !== "string" || !/^-?\d{1,19}$/.test(data.object)) return;
    const reply = (opened: boolean) => top.postMessage(onRun({ type: "opened", nonce: data.nonce, opened }), event.origin);
    opener(data.model, data.object).then(reply, () => reply(false));
  };
  self.addEventListener("message", listener);
  return () => self.removeEventListener("message", listener);
}

/** What the main-world script sees in one frame, for the diagnostic log: host, path with IDs masked, and whether the
 * classic client's loader, model and workspace are present (types only, never values). */
export interface FrameProbe { host: string; path: string; top: boolean; loader: string; model: string; workspace: string }

export function probeFrame(): FrameProbe {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any;
  const shape = (value: unknown) => (typeof value === "string" ? (SCOPE_ID.test(value) ? "id" : `text(${value.length})`) : typeof value);
  return { host: location.host, path: location.pathname.replace(/[0-9A-Fa-f]{32}/g, "<id>").slice(0, 120), top: window.top === window,
    loader: typeof w.require, model: shape(w.modelId), workspace: shape(w.workspaceId) };
}

export const describeProbe = (probe: FrameProbe) =>
  `${probe.top ? "page" : "frame"} ${probe.host}${probe.path}: loader=${probe.loader} model=${probe.model} workspace=${probe.workspace}`;

/** Main-world side: the top window's origin as this window can read it without a message. In the top window itself, its
 * own; in a frame, the last of the origins Chrome lists for the windows around it (`location.ancestorOrigins`), which is
 * the top window's. Where there is no such list, nothing; where a page's referrer policy hides an origin, the list says
 * "null" for it, which `topWindow` does not take. */
export function topOriginOf(isTop: boolean, place: { readonly origin: string; readonly ancestorOrigins?: ArrayLike<string> }): string | undefined {
  if (isTop) return place.origin;
  const ancestors = place.ancestorOrigins;
  return ancestors?.length ? ancestors[ancestors.length - 1] : undefined;
}

/** Main-world side: the top window, as the reader in a frame posts to it. What the reader posts without being asked, the
 * frame's probe and its check-in ("core-ready", with the model's ID), goes to the top window's own origin alone, and only
 * once that is known to be an Anaplan origin: a page of another site that framed an Anaplan page hears nothing of the
 * model. The frame reads it where it can (`topOriginOf`); where it cannot, the first message the top window sends the
 * frame tells it, such as its greeting ("hello"), an acknowledgement or a run. Until then nothing is posted: the top window
 * greets its frames every second while a run waits for the model (`waitForCore`), and when it is to open one of the
 * model's objects before any frame has checked in (content.ts). What the reader answers to an ask goes to the origin the
 * ask came from. */
export interface TopWindow {
  /** The top window as this frame holds it: the source of its messages, and what is posted to. */
  readonly window: Endpoint;
  /** Its origin, once known: an Anaplan origin. */
  readonly origin: string | undefined;
  /** Learns the origin from a message, while it is not known: one the top window sent, from an Anaplan origin. */
  hear(event: MessageEvent): void;
  /** Posts to the top window at its origin; nothing while that is not known. */
  post(message: Record<string, unknown>): void;
}

/** The top window `top`, whose origin this frame read as `origin` (`topOriginOf`): taken only if it is an Anaplan origin. */
export function topWindow(top: Endpoint, origin?: string): TopWindow {
  let known = origin !== undefined && ANAPLAN_ORIGIN.test(origin) ? origin : undefined;
  return {
    window: top,
    get origin() { return known; },
    hear: event => {
      if (known === undefined && event.source === (top as unknown) && ANAPLAN_ORIGIN.test(event.origin)) known = event.origin;
    },
    post: message => { if (known !== undefined) top.postMessage(message, known); },
  };
}

/** Main-world side, in every frame: report what this frame sees to the top window for a while, at the top window's
 * origin alone (`TopWindow`). While that is not known the reports wait, and the greeting that tells it has one sent. */
export function reportFrame(top: TopWindow, everyMs = 3000, forMs = 60_000): void {
  const send = () => top.post({ protocol: PROTOCOL, type: "probe", probe: probeFrame() });
  // An already-open page can be greeted long after the periodic diagnostics have stopped. Whatever the top window sends
  // tells this frame its origin, where the frame could not read it.
  window.addEventListener?.("message", event => {
    top.hear(event);
    if (ours(event)?.type === "hello" && event.source === (top.window as unknown)) send();
  });
  send();
  const timer = setInterval(send, everyMs);
  setTimeout(() => clearInterval(timer), forMs);
}

/** Shell side: collects frame reports, latest per frame. */
export function watchProbes(self: MessageTarget, onProbe: (probe: FrameProbe) => void): void {
  self.addEventListener("message", event => {
    const data = ours(event);
    const probe = data?.type === "probe" ? data.probe : undefined;
    if (!probe || typeof probe !== "object") return;
    onProbe({ host: String(probe.host), path: String(probe.path), top: probe.top === true, loader: String(probe.loader), model: String(probe.model), workspace: String(probe.workspace) });
  });
}

/** Shell side: ask every frame, nested ones included, to check in now. The greeting also tells a frame's reader this
 * page's origin, where the frame could not read it (`TopWindow`). */
export function greetFrames(root: Window, depth = 0): void {
  if (depth > 4) return;
  for (let index = 0; index < root.frames.length; index++) {
    const frame = root.frames[index];
    // The one message of the bridge to any origin ("*"): a frame's origin cannot be read from this window, and a frame
    // greeted at another origin than its own would not hear it. So it carries the protocol and its type, and never
    // anything else: nothing of the model, the page or the user.
    try { frame.postMessage({ protocol: PROTOCOL, type: "hello" }, "*"); greetFrames(frame, depth + 1); } catch { /* a frame that went away */ }
  }
}

/** Core side: announces itself to the top window until acknowledged, then runs the exports the top window asks for, one at
 * a time. A "stop" for the running export ends it before its next step (a status or a log line) or the next page of a
 * grid it reads, whichever comes first: the read that is under way is let finish, and nothing is read after it. A "run"
 * that arrives before then takes the export over, so a second export never starts beside the first, and is answered at
 * once that it goes on ("alive"), as a new export answers with its first step: the read under way may say nothing for a
 * while, and the top window gives up on a frame that does not answer a run (runInCore). An export that is
 * not stopped tells the top window before each page of a grid that it is still going ("alive"), which is all that keeps
 * the top window waiting while a grid of many pages is read (runInCore). It takes a run only of its own build, on the run
 * channel (RUN_PROTOCOL). `current` is false once a later reader serves this frame (model-content.ts): this one then
 * neither announces itself nor takes a run. It announces itself at the top window's origin alone: while that is not
 * known, it does not, and the greeting that tells it has it announce itself at once (`TopWindow`). */
export function serveCore(self: MessageTarget, top: TopWindow, modelId: () => string | undefined,
  exporter: (progress: Progress, diagnostics: () => string, stop: Stop) => Promise<AnalysisResult>, announceMs = 2000, announceForMs = 10 * 60_000,
  current: () => boolean = () => true): () => void {
  let running: { nonce: string; origin: string; stopped: boolean } | undefined;
  const announce = () => {
    const id = current() ? modelId() : undefined;
    if (id) top.post({ protocol: PROTOCOL, type: "core-ready", modelId: id, build: BUILD });
  };
  const timer = setInterval(announce, announceMs);
  const stopAnnouncing = setTimeout(() => clearInterval(timer), announceForMs);
  announce();
  const listener = (event: MessageEvent) => {
    if (event.source !== (top.window as unknown)) return;
    top.hear(event);
    const common = ours(event);
    if (common?.type === "ack") { clearInterval(timer); return; }
    if (common?.type === "hello") { announce(); return; }
    const data = ofThisBuild(event);
    if (!data || !current()) return;
    if (data.type === "stop") { if (running && data.nonce === running.nonce) running.stopped = true; return; }
    if (data.type !== "run" || typeof data.nonce !== "string") return;
    if (running) {
      if (running.stopped) {
        Object.assign(running, { nonce: data.nonce, origin: event.origin, stopped: false });
        top.window.postMessage(onRun({ nonce: data.nonce, type: "alive" }), event.origin);
      }
      return;
    }
    const run = running = { nonce: data.nonce, origin: event.origin, stopped: false };
    const reply = (message: Message) => top.window.postMessage(onRun({ nonce: run.nonce, ...message }), run.origin);
    const lines: string[] = [];
    /** What ends a stopped export: every step asks it first. */
    const check = () => { if (run.stopped) throw new Error(STOPPED); };
    /** What the exporter asks before each page of a grid: a stopped export ends there as well, and one that goes on says
     * so. "alive" is no step and no line of the log: nothing is shown for it, and Model Details.csv has no row of it. */
    const stop: Stop = { throwIfAborted: () => { check(); reply({ type: "alive" }); } };
    // Stamped as the content script stamps its own log, so Model Details.csv gives every diagnostic line its time.
    const step = (type: "status" | "log") => (text: string) => {
      check();
      lines.push(stampLine(text));
      reply({ type, text });
    };
    exporter({ status: step("status"), log: step("log") }, () => lines.join("\r\n"), stop)
      .then(result => reply({ type: "done", result }))
      .catch(error => { const failed = failureOf(error); reply({ type: "error", message: failed.message, detail: failed.detail }); })
      .finally(() => { running = undefined; });
  };
  self.addEventListener("message", listener);
  return () => { clearInterval(timer); clearTimeout(stopAnnouncing); self.removeEventListener("message", listener); };
}
