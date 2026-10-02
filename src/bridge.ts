import type { Progress, TaskResult } from "./panel.js";

/** The Model Building page (`/a/modeling/…/models/{id}`) is a shell; the classic model client runs in a core frame inside it,
 * often on another data centre's host (SAM's Model Builder evaluates only in that core frame). The export must read there,
 * but the button belongs on the page the user sees. This bridge links the two with window messages: the core frame
 * announces itself, the shell asks it to export, and the core frame streams progress and finally the zip back.
 * Each side accepts messages only from the other window and only from an Anaplan origin. */

export const PROTOCOL = "sam-model-export";
export const ANAPLAN_ORIGIN = /^https:\/\/[a-z0-9.-]+\.anaplan\.com$/i;
const MODEL_ID = /^[0-9A-Za-z]{32}$/;

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
    if (data?.type !== "core-ready" || typeof data.modelId !== "string" || !MODEL_ID.test(data.modelId) || !event.source) return;
    const source = event.source as unknown as Endpoint;
    source.postMessage({ protocol: PROTOCOL, type: "ack" }, event.origin);
    onCore({ source, origin: event.origin, modelId: data.modelId });
  });
}

/** Shell side: asks the core frame to export and relays its progress. Fails if the frame goes quiet for `idleMs`. */
export function runInCore(self: MessageTarget, core: CoreHandle, progress: Progress, idleMs = 300_000): Promise<TaskResult> {
  return new Promise((resolve, reject) => {
    const nonce = crypto.randomUUID();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (error?: Error, result?: TaskResult) => {
      clearTimeout(timer);
      self.removeEventListener("message", listener);
      if (error) reject(error); else resolve(result!);
    };
    const idle = () => { clearTimeout(timer); timer = setTimeout(() => finish(new Error("The model frame stopped answering.")), idleMs); };
    const listener = (event: MessageEvent) => {
      const data = ours(event);
      if (!data || event.source !== (core.source as unknown) || event.origin !== core.origin || data.nonce !== nonce) return;
      idle();
      if (data.type === "status") progress.status(String(data.text));
      else if (data.type === "log") progress.log(String(data.text));
      else if (data.type === "error") finish(new Error(String(data.message)));
      else if (data.type === "done" && data.zip instanceof ArrayBuffer) {
        finish(undefined, { zip: new Uint8Array(data.zip), fileName: String(data.fileName), summary: Array.isArray(data.summary) ? data.summary.map(String) : [] });
      }
    };
    self.addEventListener("message", listener);
    idle();
    core.source.postMessage({ protocol: PROTOCOL, type: "run", nonce }, core.origin);
  });
}

/** What the main-world script sees in one frame, for the diagnostic log: host, path with IDs masked, and whether the
 * classic client's loader, model and workspace are present (types only, never values). */
export interface FrameProbe { host: string; path: string; top: boolean; loader: string; model: string; workspace: string }

export function probeFrame(): FrameProbe {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any;
  const shape = (value: unknown) => (typeof value === "string" ? (MODEL_ID.test(value) ? "id" : `text(${value.length})`) : typeof value);
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

/** Core side: announces itself to the top window until acknowledged, then runs the exports the top window asks for. */
export function serveCore(self: MessageTarget, top: Endpoint, modelId: () => string | undefined,
  exporter: (progress: Progress, diagnostics: () => string) => Promise<TaskResult>, announceMs = 2000, announceForMs = 10 * 60_000): () => void {
  let running = false;
  const announce = () => { const id = modelId(); if (id) top.postMessage({ protocol: PROTOCOL, type: "core-ready", modelId: id }, "*"); };
  const timer = setInterval(announce, announceMs);
  const stopAnnouncing = setTimeout(() => clearInterval(timer), announceForMs);
  announce();
  const listener = (event: MessageEvent) => {
    const data = ours(event);
    if (!data || event.source !== (top as unknown)) return;
    if (data.type === "ack") { clearInterval(timer); return; }
    if (data.type === "hello") { announce(); return; }
    if (data.type !== "run" || typeof data.nonce !== "string" || running) return;
    running = true;
    const origin = event.origin;
    const reply = (message: Message, transfer: Transferable[] = []) => top.postMessage({ protocol: PROTOCOL, nonce: data.nonce, ...message }, origin, transfer);
    const lines: string[] = [];
    // Stamped like the panel's own log, so Model Details.csv gives every diagnostic line its time.
    const stamp = (text: string) => lines.push(`${new Date().toISOString().slice(11, 19)} ${text}`);
    const progress: Progress = {
      status: text => { stamp(text); reply({ type: "status", text }); },
      log: line => { stamp(line); reply({ type: "log", text: line }); },
    };
    exporter(progress, () => lines.join("\r\n"))
      .then(result => reply({ type: "done", fileName: result.fileName, summary: result.summary, zip: result.zip.buffer }, [result.zip.buffer]))
      .catch(error => reply({ type: "error", message: error instanceof Error ? error.message : String(error) }))
      .finally(() => { running = false; });
  };
  self.addEventListener("message", listener);
  return () => { clearInterval(timer); clearTimeout(stopAnnouncing); self.removeEventListener("message", listener); };
}
