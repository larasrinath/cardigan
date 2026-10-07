import { stampLine } from "./details.js";
import { Failure, failureOf, REFRESH, SEND_LOG, UNEXPECTED, type Progress, type Stop } from "./progress.js";
import { plainResult, textOf } from "./result-plain.js";
import type { AnalysisResult } from "./result-types.js";
import { SCOPE_ID, sleep } from "./util.js";

/** The Model Building page (`/a/modeling/…/models/{id}`) is a shell; the classic model client runs in a core frame inside it,
 * often on another data centre's host. The export must read there,
 * but the results page talks to the content script of the page the user sees. This bridge links the two with window
 * messages: the core frame announces itself, the shell asks it to export, and the core frame streams progress and finally
 * the result (the export's files as tables) back.
 * Each side accepts messages only from the other window and only from an Anaplan origin. On the classic model page opened
 * on its own there is no frame: the core side runs in the page's own window, and the other window is that same window. */

export const PROTOCOL = "cardigan-model-export";
export const ANAPLAN_ORIGIN = /^https:\/\/[a-z0-9.-]+\.anaplan\.com$/i;
const WAIT_FOR_CORE_MS = 20_000;
/** Why an export that was asked to stop ends. */
const STOPPED = "The export was stopped.";
/** What the user is told when the page cannot get the model exported (progress.ts `Failure`). */
export const NO_MODEL = "Cardigan could not reach the model inside this page. If the model is still opening, wait until it shows and choose Run again; "
  + `otherwise refresh the Anaplan tab, then click the Cardigan icon again. ${SEND_LOG}`;
export const QUIET = "The model stopped answering while Cardigan was reading it. Check that it is still open in the Anaplan tab, then choose Run again.";
export const UNREADABLE = `Cardigan could not read what the model's page sent back. ${REFRESH} ${SEND_LOG}`;

export interface Endpoint { postMessage(message: unknown, targetOrigin: string, transfer?: Transferable[]): void }
export interface MessageTarget {
  addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
  removeEventListener(type: "message", listener: (event: MessageEvent) => void): void;
}
export interface CoreHandle { source: Endpoint; origin: string; modelId: string }

// Messages are structured clones from another window; fields are checked before use.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Message = Record<string, any>;
const ours = (event: MessageEvent): Message | undefined => {
  const data = event.data as Message | null;
  return data && typeof data === "object" && data.protocol === PROTOCOL && ANAPLAN_ORIGIN.test(event.origin) ? data : undefined;
};

/** Shell side: remembers the model's core frame when it announces itself, and acknowledges it. */
export function watchCore(self: MessageTarget, onCore: (core: CoreHandle) => void): void {
  self.addEventListener("message", event => {
    const data = ours(event);
    if (data?.type !== "core-ready" || typeof data.modelId !== "string" || !SCOPE_ID.test(data.modelId) || !event.source) return;
    const source = event.source as unknown as Endpoint;
    source.postMessage({ protocol: PROTOCOL, type: "ack" }, event.origin);
    onCore({ source, origin: event.origin, modelId: data.modelId });
  });
}

/** Shell side: asks the core frame to export and relays its progress. Fails if the frame goes quiet for `idleMs`, or sends
 * something that is not a model's result. `signal` stops it: the run rejects with the signal's reason. A frame that went
 * quiet and a run that was stopped are both given up at once, and the frame is told to stop reading (serveCore says when
 * it then does). Quiet is no message of this run at all: besides its steps and log lines the frame sends "alive" before
 * each page of a grid it reads, so that a grid of many pages, which has nothing to report between them, is not taken for
 * a frame that has gone. */
export function runInCore(self: MessageTarget, core: CoreHandle, progress: Progress, idleMs = 300_000, signal?: AbortSignal): Promise<AnalysisResult> {
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
      core.source.postMessage({ protocol: PROTOCOL, type: "stop", nonce }, core.origin);
      finish({ error });
    };
    const idle = () => { clearTimeout(timer); timer = setTimeout(() => giveUp(new Failure(QUIET, `the model's frame sent nothing for ${idleMs / 1000} s`)), idleMs); };
    const stop = () => giveUp(signal?.reason ?? new Error(STOPPED));
    const listener = (event: MessageEvent) => {
      const data = ours(event);
      if (!data || event.source !== (core.source as unknown) || event.origin !== core.origin || data.nonce !== nonce) return;
      // Whatever the frame sends for this run starts the wait again. For "alive" that is all: it is not passed on.
      idle();
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
    self.addEventListener("message", listener);
    signal?.addEventListener("abort", stop, { once: true });
    idle();
    core.source.postMessage({ protocol: PROTOCOL, type: "run", nonce }, core.origin);
  });
}

/** Shell side: the model's own frame (the classic client inside this page) does the reading. Waits for it to check in,
 * asking every frame once a second, then runs the export there. `model` is the model the page's address names. */
export async function exportInCore(self: Window, core: () => CoreHandle | undefined, probes: () => Iterable<FrameProbe>, model: string, progress: Progress,
  signal?: AbortSignal, waitMs = WAIT_FOR_CORE_MS): Promise<AnalysisResult> {
  const deadline = Date.now() + waitMs;
  while (!core() && Date.now() < deadline) {
    signal?.throwIfAborted();
    progress.status("Waiting for the model's frame…");
    greetFrames(self);
    await sleep(1000);
  }
  signal?.throwIfAborted();
  const seen = [...probes()];
  for (const probe of seen) progress.log(describeProbe(probe));
  const found = core();
  if (!found) throw new Failure(NO_MODEL, seen.length ? `the model's frame did not answer; ${seen.length} frame(s) reported in` : "no frame reported in");
  if (found.modelId.toUpperCase() !== model.toUpperCase()) progress.log("the model frame reports a different model than this page's address");
  return runInCore(self, found, progress, undefined, signal);
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

/** Main-world side, in every frame: report what this frame sees to the top window for a while. */
export function reportFrame(top: Endpoint, everyMs = 3000, forMs = 60_000): void {
  const send = () => top.postMessage({ protocol: PROTOCOL, type: "probe", probe: probeFrame() }, "*");
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

/** Shell side: ask every frame, nested ones included, to check in now. */
export function greetFrames(root: Window, depth = 0): void {
  if (depth > 4) return;
  for (let index = 0; index < root.frames.length; index++) {
    const frame = root.frames[index];
    try { frame.postMessage({ protocol: PROTOCOL, type: "hello" }, "*"); greetFrames(frame, depth + 1); } catch { /* a frame that went away */ }
  }
}

/** Core side: announces itself to the top window until acknowledged, then runs the exports the top window asks for, one at
 * a time. A "stop" for the running export ends it before its next step (a status or a log line) or the next page of a
 * grid it reads, whichever comes first: the read that is under way is let finish, and nothing is read after it. A "run"
 * that arrives before then takes the export over, so a second export never starts beside the first. An export that is
 * not stopped tells the top window before each page of a grid that it is still going ("alive"), which is all that keeps
 * the top window waiting while a grid of many pages is read (runInCore). */
export function serveCore(self: MessageTarget, top: Endpoint, modelId: () => string | undefined,
  exporter: (progress: Progress, diagnostics: () => string, stop: Stop) => Promise<AnalysisResult>, announceMs = 2000, announceForMs = 10 * 60_000): () => void {
  let running: { nonce: string; origin: string; stopped: boolean } | undefined;
  const announce = () => { const id = modelId(); if (id) top.postMessage({ protocol: PROTOCOL, type: "core-ready", modelId: id }, "*"); };
  const timer = setInterval(announce, announceMs);
  const stopAnnouncing = setTimeout(() => clearInterval(timer), announceForMs);
  announce();
  const listener = (event: MessageEvent) => {
    const data = ours(event);
    if (!data || event.source !== (top as unknown)) return;
    if (data.type === "ack") { clearInterval(timer); return; }
    if (data.type === "hello") { announce(); return; }
    if (data.type === "stop") { if (running && data.nonce === running.nonce) running.stopped = true; return; }
    if (data.type !== "run" || typeof data.nonce !== "string") return;
    if (running) {
      if (running.stopped) Object.assign(running, { nonce: data.nonce, origin: event.origin, stopped: false });
      return;
    }
    const run = running = { nonce: data.nonce, origin: event.origin, stopped: false };
    const reply = (message: Message) => top.postMessage({ protocol: PROTOCOL, nonce: run.nonce, ...message }, run.origin);
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
