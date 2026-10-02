import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UxPageCardDetails } from "../../../src/domains/ux-designer/card-types.js";
import { loadCatalog } from "./analyse.js";
import { decodeFrames, type StompFrame } from "./stomp.js";

// Synthetic IDs only. The flow replays the first live run (28 Sep 2026): the model status stays UNKNOWN, and the first
// host answers REDIRECTION_REQUIRED naming the host the model lives on.
const WS = "0123456789abcdef0123456789abcdef";
const MODEL = "FEDCBA9876543210FEDCBA9876543210";
const MODULE = "102000000901";
const [FIRST, MODEL_HOST] = ["first.app.anaplan.com", "model.app.anaplan.com"];

type Listener = (event: { data?: unknown; code?: number; reason?: string }) => void;

/** A WebSocket stand-in whose "server" answers each client frame through `reply`. */
class ScriptedSocket {
  static readonly OPEN = 1;
  static sockets: ScriptedSocket[] = [];
  static reply: (socket: ScriptedSocket, frame: StompFrame) => void = () => undefined;
  readyState = 0;
  binaryType = "blob";
  readonly frames: StompFrame[] = [];
  private readonly listeners = new Map<string, Listener[]>();
  constructor(readonly url: string) {
    ScriptedSocket.sockets.push(this);
    setTimeout(() => { this.readyState = 1; this.emit("open", {}); }, 0);
  }
  get host() { return new URL(this.url).host; }
  addEventListener(type: string, listener: Listener) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]); }
  send(data: string) {
    for (const frame of decodeFrames(data).frames) {
      this.frames.push(frame);
      setTimeout(() => ScriptedSocket.reply(this, frame), 0);
    }
  }
  close(code = 1000, reason = "") {
    if (this.readyState === 3) return;
    this.readyState = 3;
    setTimeout(() => this.emit("close", { code, reason }), 0);
  }
  emit(type: string, event: { data?: unknown; code?: number; reason?: string }) { for (const listener of this.listeners.get(type) ?? []) listener(event); }
  serve(frame: string) { if (this.readyState === 1) this.emit("message", { data: frame }); }
}

const update = (id: string, body: unknown) => `MESSAGE\nsubscription:${id}\nmessage-type:update\nsubscription-revision:00000001\n\n${JSON.stringify(body)}\0`;
const pages = [{ cards: [], references: [{ kind: "module", id: MODULE }, { kind: "action", id: "112000000901", actionType: "IMPORT" }] }] as unknown as UxPageCardDetails[];
const scope = { customerId: "customer-1", workspaceId: WS, modelId: MODEL, modelName: "Synthetic model" };

function run() {
  const log: string[] = [];
  return { log, result: loadCatalog(scope, pages, new Map([["page-guid", "Inventory policy"]]), { status: () => undefined, log: line => { log.push(line); } }) };
}

describe("Page analyzer name loading against the live socket behaviour", () => {
  beforeEach(() => {
    ScriptedSocket.sockets = [];
    vi.stubGlobal("WebSocket", ScriptedSocket);
    vi.stubGlobal("location", { host: FIRST, origin: `https://${FIRST}` });
    vi.stubGlobal("document", { cookie: "other=1; XSRF-TOKEN=xsrf-value" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ imports: [{ id: "112000000901", name: "Import demand" }] }),
      { status: 200, headers: { "content-type": "application/json" } })));
  });
  afterEach(() => vi.unstubAllGlobals());

  it("follows the redirect and reads names without waiting for a READY status", async () => {
    ScriptedSocket.reply = (socket, frame) => {
      if (frame.command === "CONNECT") { socket.serve("CONNECTED\nversion:1.2\nserver:test\n\n\0"); return; }
      if (frame.command !== "SEND") return;
      const { destination, id } = frame.headers;
      if (destination === `core://${WS}:${MODEL}`) {
        socket.serve(update(id, { status: "UNKNOWN" }));
        if (socket.host === FIRST) socket.serve(`ERROR\n\n${JSON.stringify({ error: "REDIRECTION_REQUIRED", fqdn: MODEL_HOST })}\0`);
        return;
      }
      if (socket.host !== MODEL_HOST) return;
      if (destination === `core:/${WS}:${MODEL}/moduleViews`) socket.serve(update(id, { data: [{ id: Number(MODULE), name: "Demand", views: [] }], dimensions: {} }));
      if (destination === `core://${WS}:${MODEL}/lists`) socket.serve(update(id, { data: [{ id: "101000000901", name: "Product" }] }));
      if (destination === `core://${WS}:${MODEL}/modules/${MODULE}/lineItems`) socket.serve(update(id, { data: [{ lineItemId: "1901000000001", lineItemLabel: "Volume" }] }));
    };
    const { log, result } = run();
    const { catalog, notes } = await result;

    expect(notes).toEqual([]);
    expect(ScriptedSocket.sockets.map(socket => socket.host)).toEqual([FIRST, MODEL_HOST]);
    expect(catalog.modules.get(MODULE)).toBe("Demand");
    expect(catalog.dimensions.get("101000000901")).toBe("Product");
    expect(catalog.lineItems.get("1901000000001")).toEqual({ name: "Volume", moduleId: MODULE });
    expect(catalog.actions.get("112000000901")).toBe("Import demand");
    expect(log).toEqual(expect.arrayContaining(["model status UNKNOWN", `redirected to ${MODEL_HOST}`]));

    const fetch = vi.mocked(globalThis.fetch);
    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`https://${FIRST}/a/collaboration-actions-service/workspaces/${WS}/models/${MODEL}/imports`);
    expect(init).toMatchObject({ method: "GET", credentials: "include", mode: "same-origin", redirect: "error" });
    expect(init.headers).toMatchObject({ "X-XSRF-TOKEN": "xsrf-value", "X-TracePath": "springboard-ui" });

    // Read-only on both connections: subscriptions, update-subscription and disconnects only.
    const sent = ScriptedSocket.sockets.flatMap(socket => socket.frames);
    expect(new Set(sent.map(frame => frame.command))).toEqual(new Set(["CONNECT", "SUBSCRIBE", "SEND", "UNSUBSCRIBE", "DISCONNECT"]));
    expect(sent.filter(frame => frame.command === "SEND").every(frame => frame.headers["action-type"] === "update-subscription")).toBe(true);
  });

  it("reads import names from the model's own host when the page's host refuses, and reports a lookup that failed everywhere", async () => {
    ScriptedSocket.reply = (socket, frame) => {
      if (frame.command === "CONNECT") { socket.serve("CONNECTED\nversion:1.2\nserver:test\n\n\0"); return; }
      if (frame.command === "SEND" && frame.headers.destination === `core://${WS}:${MODEL}` && socket.host === FIRST) {
        socket.serve(`ERROR\n\n${JSON.stringify({ error: "REDIRECTION_REQUIRED", fqdn: MODEL_HOST })}\0`);
      } else if (frame.command === "SEND" && frame.headers.destination !== `core://${WS}:${MODEL}`) socket.serve(update(frame.headers.id, { data: [] }));
    };
    // The page's host redirects (a same-origin read refuses it as a network error); the model's host answers.
    const answer = (host: string) => vi.fn(async (url: string) => {
      if (!url.startsWith(`https://${host}/`)) throw new TypeError("Failed to fetch");
      return new Response(JSON.stringify({ imports: [{ id: "112000000901", name: "Import demand" }] }), { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", answer(MODEL_HOST));
    const { catalog, notes, failedActionTypes } = await run().result;
    expect(catalog.actions.get("112000000901")).toBe("Import demand");
    expect([notes, failedActionTypes]).toEqual([[], []]);
    const calls = vi.mocked(globalThis.fetch).mock.calls as [string, RequestInit][];
    expect(calls.map(([url]) => new URL(url).host)).toEqual([FIRST, MODEL_HOST]);
    expect(calls[1][1]).toMatchObject({ method: "GET", mode: "cors", credentials: "include", redirect: "error" });
    expect(calls[1][1].headers).not.toHaveProperty("X-XSRF-TOKEN"); // the XSRF cookie is echoed only to the page's own origin

    ScriptedSocket.sockets = [];
    vi.stubGlobal("fetch", answer("nowhere.app.anaplan.com"));
    const failed = await run().result;
    expect(failed.failedActionTypes).toEqual(["IMPORT"]);
    expect(failed.notes).toEqual(["Synthetic model: could not read the model's imports (NETWORK_ERROR); their buttons show the card label."]);
  });

  it("stops at once when the model does not exist, instead of waiting minutes for data", async () => {
    ScriptedSocket.reply = (socket, frame) => {
      if (frame.command === "CONNECT") socket.serve("CONNECTED\nversion:1.2\nserver:test\n\n\0");
      else if (frame.command === "SEND" && frame.headers.destination === `core://${WS}:${MODEL}`) socket.serve(update(frame.headers.id, { status: "NO_SUCH_MODEL" }));
    };
    const started = Date.now();
    const { notes, catalog } = await run().result;
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(notes).toEqual(["Synthetic model: names from the model data service were not available (the model is no such model); IDs are shown instead."]);
    expect(catalog.actions.get("112000000901")).toBe("Import demand");
  });
});
