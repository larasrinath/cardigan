import type { Log } from "./progress.js";
import { ANAPLAN_HOST } from "./util.js";

/** A minimal STOMP client for Page Builder's widget data socket (traced in the designer bundle, 27 Sep 2026: CONNECT
 * headers, SUBSCRIBE plus an `update-subscription` SEND, MESSAGE frames typed by `message-type`). The same socket carries
 * data writes, so this client can only subscribe: any other command or action type is refused before it is sent. */

export interface StompFrame { command: string; headers: Record<string, string>; body: string }

const CLIENT_COMMANDS = new Set(["CONNECT", "SUBSCRIBE", "UNSUBSCRIBE", "SEND", "DISCONNECT"]);
/** Each subscription sends its options once, as Page Builder's first revision (eight digits, zero-padded). */
const REVISION = "00000001";

export function assertReadOnly(frame: StompFrame): void {
  if (!CLIENT_COMMANDS.has(frame.command)) throw new Error(`Refusing to send a ${frame.command} frame.`);
  if (frame.command === "SEND" && frame.headers["action-type"] !== "update-subscription") {
    throw new Error("Refusing to send an action other than update-subscription.");
  }
}

const escapeValue = (value: string) => value.replace(/\\/g, "\\\\").replace(/\r/g, "\\r").replace(/\n/g, "\\n").replace(/:/g, "\\c");
const unescapeValue = (value: string) => value.replace(/\\([\\rnc])/g, (_, c: string) => (c === "\\" ? "\\" : c === "r" ? "\r" : c === "n" ? "\n" : ":"));

/** STOMP 1.2 escapes header text in every frame but CONNECT; destinations such as `core://ws:model/...` contain colons. */
export function encodeFrame(frame: StompFrame, escapeHeaders: boolean): string {
  assertReadOnly(frame);
  const headers = { ...frame.headers };
  if (frame.body) headers["content-length"] = String(new TextEncoder().encode(frame.body).byteLength);
  const escape = escapeHeaders && frame.command !== "CONNECT";
  const lines = Object.entries(headers).map(([key, value]) => (escape ? `${escapeValue(key)}:${escapeValue(value)}` : `${key}:${value}`));
  return `${[frame.command, ...lines].join("\n")}\n\n${frame.body}\0`;
}

/** Splits buffered socket text into complete frames and returns the unconsumed rest. Heart-beats (bare line ends) are skipped. */
export function decodeFrames(buffer: string): { frames: StompFrame[]; rest: string } {
  const frames: StompFrame[] = [];
  let rest = buffer;
  for (;;) {
    rest = rest.replace(/^(?:\r?\n)+/, "");
    const end = rest.indexOf("\0");
    if (end < 0) break;
    const raw = rest.slice(0, end);
    rest = rest.slice(end + 1);
    const split = /\r?\n\r?\n/.exec(raw);
    const head = split ? raw.slice(0, split.index) : raw;
    const body = split ? raw.slice(split.index + split[0].length) : "";
    const [command, ...lines] = head.split(/\r?\n/);
    const headers: Record<string, string> = {};
    for (const line of lines) {
      const at = line.indexOf(":");
      if (at <= 0) continue;
      const key = unescapeValue(line.slice(0, at));
      if (!(key in headers)) headers[key] = unescapeValue(line.slice(at + 1)); // the first occurrence wins
    }
    frames.push({ command, headers, body });
  }
  return { frames, rest };
}

/** Server error body: `{error, ...}`. REDIRECTION_REQUIRED names the host (`fqdn`) to reconnect to. */
export class StompError extends Error {
  constructor(message: string, readonly code?: string, readonly fqdn?: string) { super(message); }
}

/** As much of a body that is no JSON as an error says: the start of it. */
const BODY_SAID = 200;

/** Why the data service refused a read, or ended the connection, as far as the frame says. The service's body
 * `{error, reason, fqdn}` gives its code, its words, and the host a redirect names. Page Builder reads more of a refusal
 * (designer.js `eft`): the frame's `status-code` and `error-code` headers, and a body's `name` and `message`, or the body
 * itself where it is no JSON. So does this, so that the diagnostic log says why a read was refused (seen live, 10 Oct
 * 2026: a model's saved views were all refused, and the log said only that they were). Where nothing says why,
 * `fallback` does. A status code is added to what is said, where the frame gives one. */
function errorFromFrame(frame: StompFrame, fallback: string): StompError {
  let parsed: Record<string, unknown> | undefined;
  try {
    const value: unknown = JSON.parse(frame.body);
    parsed = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
  } catch {
    parsed = undefined;
  }
  const word = (key: string): string | undefined => {
    const value = parsed?.[key];
    return typeof value === "string" && value.trim() !== "" ? value : undefined;
  };
  const headerCode = frame.headers["error-code"]?.trim() || undefined;
  const code = word("error") ?? word("errorCode") ?? headerCode ?? word("name");
  const body = parsed === undefined && frame.body.trim() !== "" ? frame.body.trim().slice(0, BODY_SAID) : undefined;
  const said = word("reason") ?? word("message") ?? body ?? code;
  const status = frame.headers["status-code"]?.trim();
  const withStatus = (text: string): string => (status && !text.includes(status) ? `${text.replace(/\.$/, "")} (status ${status})${text.endsWith(".") ? "." : ""}` : text);
  return new StompError(withStatus(said ?? fallback), code, word("fqdn"));
}

export interface SubscribeOptions {
  accept?: string;
  /** The options object Page Builder sends as the `update-subscription` body. */
  body?: Record<string, unknown>;
  /** Resolve on the first payload of this type (default `update`) that `until` accepts; throw from it to stop waiting. */
  messageType?: "update" | "metadata" | "context-filters" | "view-info";
  until?: (data: unknown) => boolean;
  timeoutMs?: number;
  /** Called with each message type received and its top-level keys (never values), for the diagnostic log. */
  onMessage?: (type: string, keys: string[]) => void;
  /** Keeps this subscription's own three frames (SUBSCRIBE, SEND, UNSUBSCRIBE) out of the diagnostic log: for a read that
   * is one of many alike, which its caller sums up in a line of its own. The frames are checked and sent like any other. */
  quiet?: boolean;
  /** Gives the subscription up when it aborts: it is unsubscribed from at once and rejects with the code GIVEN_UP, and an
   * answer that still arrives for it is not read. Under a signal that has aborted already, nothing is sent. */
  signal?: AbortSignal;
}

export class StompConnection {
  private buffer = "";
  private escapeHeaders = false;
  private counter = 0;
  private heartbeat: ReturnType<typeof setInterval> | undefined;
  private readonly handlers = new Map<string, (frame: StompFrame) => void>();
  private readonly failures = new Set<(error: Error) => void>();
  private failure: Error | undefined;

  private constructor(private readonly socket: WebSocket, private readonly log: Log) {}

  /** Why the connection ended, if it has (a server error such as REDIRECTION_REQUIRED, or a close). */
  get failed(): Error | undefined { return this.failure; }

  /** `signal` stops the opening: no socket is opened once it has aborted, and a socket that is still connecting when it
   * aborts is closed at once, without waiting for the service to answer. Either way the promise rejects with the signal's
   * reason. Once the connection is open the signal does nothing more here. */
  static open(url: string, connectHeaders: Record<string, string>, log: Log, signal?: AbortSignal, timeoutMs = 30_000): Promise<StompConnection> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) { reject(signal.reason); return; }
      let settled = false;
      const socket = new WebSocket(url);
      socket.binaryType = "arraybuffer";
      const connection = new StompConnection(socket, log);
      let timer: ReturnType<typeof setTimeout> | undefined;
      const finish = (error?: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", stop);
        if (error === undefined) resolve(connection); else { connection.close(); reject(error); }
      };
      const stop = () => finish(signal?.reason ?? new StompError("stopped"));
      signal?.addEventListener("abort", stop, { once: true });
      timer = setTimeout(() => finish(new StompError("Timed out connecting to the model data service.")), timeoutMs);
      socket.addEventListener("open", () => {
        // The opening has ended already (stopped, or timed out) and the socket was closed: nothing is sent on it.
        if (settled) return;
        log("socket open; sending CONNECT");
        connection.send({ command: "CONNECT", headers: { "accept-version": "1.2,1.1,1.0", "heart-beat": "20000,0", ...connectHeaders }, body: "" });
      });
      socket.addEventListener("message", event => {
        const text = typeof event.data === "string" ? event.data : new TextDecoder().decode(event.data as ArrayBuffer);
        const { frames, rest } = decodeFrames(connection.buffer + text);
        connection.buffer = rest;
        for (const frame of frames) {
          if (frame.command === "CONNECTED") {
            // The opening has ended already (stopped, or timed out) and the socket is closing: no heart-beat is started for it.
            if (settled) continue;
            connection.escapeHeaders = frame.headers.version === "1.2";
            log(`CONNECTED version=${frame.headers.version ?? "?"} server=${frame.headers.server ?? "?"}`);
            connection.heartbeat = setInterval(() => { if (socket.readyState === WebSocket.OPEN) socket.send("\n"); }, 20_000);
            finish();
          } else if (frame.command === "ERROR") {
            const error = errorFromFrame(frame, frame.headers.message ?? "The model data service returned an error.");
            log(`ERROR frame: ${error.code ?? error.message}${error.fqdn ? ` (redirect to ${error.fqdn})` : ""}`);
            connection.fail(error);
            finish(error);
          } else if (frame.command === "MESSAGE") {
            connection.handlers.get(frame.headers.subscription ?? "")?.(frame);
          }
        }
      });
      socket.addEventListener("close", event => {
        log(`socket closed code=${event.code}${event.reason ? ` reason=${event.reason}` : ""}`);
        // Page Builder also treats a close whose reason is a host name as "reconnect there".
        const fqdn = ANAPLAN_HOST.test(event.reason) ? event.reason : undefined;
        const error = fqdn ? new StompError(`Redirected to ${fqdn}.`, "REDIRECTION_REQUIRED", fqdn)
          : new StompError(`Connection closed (code ${event.code}${event.reason ? `, ${event.reason}` : ""}).`, `CLOSE_${event.code}`);
        connection.fail(error);
        finish(error);
      });
      socket.addEventListener("error", () => log("socket error event"));
    });
  }

  /** `quiet` sends the frame without a line in the log (a subscription's `quiet` option). */
  private send(frame: StompFrame, quiet = false): void {
    const encoded = encodeFrame(frame, this.escapeHeaders);
    const { destination, id } = frame.headers;
    if (!quiet) this.log(`${frame.command}${destination ? ` ${destination}` : ""}${id ? ` id=${id}` : ""}${frame.headers["action-type"] ? ` action-type=${frame.headers["action-type"]}` : ""}`);
    this.socket.send(encoded);
  }

  private fail(error: Error): void {
    if (this.failure) return;
    this.failure = error;
    for (const notify of this.failures) notify(error);
    this.failures.clear();
    if (this.heartbeat) clearInterval(this.heartbeat);
  }

  subscribe(destination: string, options: SubscribeOptions = {}): Promise<unknown> {
    if (this.failure) return Promise.reject(this.failure);
    const givenUp = () => new StompError(`Gave up waiting for ${destination}.`, "GIVEN_UP");
    if (options.signal?.aborted) return Promise.reject(givenUp());
    const id = `json-${++this.counter}`;
    const until = options.until ?? (() => true);
    return new Promise<unknown>((resolve, reject) => {
      let done = false;
      const timer = setTimeout(() => stop(new StompError(`Timed out waiting for ${destination}.`, "TIMEOUT")), options.timeoutMs ?? 60_000);
      const onFailure = (error: Error) => stop(error);
      const onAbort = () => stop(givenUp());
      const stop = (error: Error | undefined, data?: unknown) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        this.handlers.delete(id);
        this.failures.delete(onFailure);
        options.signal?.removeEventListener("abort", onAbort);
        if (!this.failure && this.socket.readyState === WebSocket.OPEN) this.send({ command: "UNSUBSCRIBE", headers: { id }, body: "" }, options.quiet);
        if (error) reject(error); else resolve(data);
      };
      this.failures.add(onFailure);
      options.signal?.addEventListener("abort", onAbort, { once: true });
      this.handlers.set(id, frame => {
        const type = frame.headers["message-type"];
        if (type === "error") { stop(errorFromFrame(frame, `The data service rejected ${destination}.`)); return; }
        if (type === "action-status") {
          try {
            const status = JSON.parse(frame.body) as { status?: unknown };
            if (status.status !== "success") stop(errorFromFrame(frame, `The data service rejected ${destination}.`));
          } catch { stop(new StompError(`Unreadable status for ${destination}.`)); }
          return;
        }
        const wanted = options.messageType ?? "update";
        if (options.onMessage) {
          let keys: string[] = [];
          try { const parsed = JSON.parse(frame.body); keys = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? Object.keys(parsed) : []; } catch { /* reported below if wanted */ }
          options.onMessage(type ?? "(none)", keys);
        }
        if (type !== wanted) return;
        // As Page Builder does: a message for another revision predates the options this subscription sent (metadata is exempt).
        const revision = frame.headers["subscription-revision"];
        if (type !== "metadata" && revision && revision !== REVISION) return;
        let data: unknown;
        try { data = JSON.parse(frame.body); } catch { stop(new StompError(`Unreadable data for ${destination}.`)); return; }
        try { if (until(data)) stop(undefined, data); } catch (error) { stop(error instanceof Error ? error : new StompError(String(error))); }
      });
      this.send({ command: "SUBSCRIBE", headers: { id, destination, "page-visible": "true", ...(options.accept ? { accept: options.accept } : {}) }, body: "" }, options.quiet);
      this.send({
        command: "SEND",
        headers: { destination, "action-type": "update-subscription", "subscription-revision": REVISION, id, "action-id": `action-${this.counter}`, "page-visible": "true" },
        body: JSON.stringify(options.body ?? {}),
      }, options.quiet);
    });
  }

  close(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    try {
      if (this.socket.readyState === WebSocket.OPEN && !this.failure) this.send({ command: "DISCONNECT", headers: {}, body: "" });
      this.socket.close(1000);
    } catch { /* already closed */ }
  }
}
