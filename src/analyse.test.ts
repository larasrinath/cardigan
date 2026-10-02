import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UxPageCardDetails } from "../../../src/domains/ux-designer/card-types.js";
import { analyseApp, loadCatalog } from "./analyse.js";
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

function run(over = pages, on = scope) {
  const log: string[] = [];
  return { log, result: loadCatalog(on, over, new Map([["page-guid", "Inventory policy"]]), { status: () => undefined, log: line => { log.push(line); } }) };
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
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

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

  it("does not follow a redirect to a host outside anaplan.com", async () => {
    for (const fqdn of ["model.app.anaplan.com.example.net", "example.net", "anaplan.com", "model.app.anaplan.com:8443", "model.app.anaplan.com/a"]) {
      ScriptedSocket.sockets = [];
      vi.mocked(globalThis.fetch).mockClear();
      ScriptedSocket.reply = (socket, frame) => {
        if (frame.command === "CONNECT") socket.serve("CONNECTED\nversion:1.2\nserver:test\n\n\0");
        else if (frame.command === "SEND" && frame.headers.destination === `core://${WS}:${MODEL}`) socket.serve(`ERROR\n\n${JSON.stringify({ error: "REDIRECTION_REQUIRED", fqdn })}\0`);
      };
      const { log, result } = run();
      const { notes, failedActionTypes } = await result;
      expect(ScriptedSocket.sockets.map(socket => socket.host)).toEqual([FIRST]);
      expect(notes).toEqual(["Synthetic model: names from the model data service were not available (REDIRECTION_REQUIRED); IDs are shown instead."]);
      expect(log.filter(line => line.startsWith("redirected to"))).toEqual([]);
      // The action names are then read from the page's own host only.
      expect(failedActionTypes).toEqual([]);
      expect(vi.mocked(globalThis.fetch).mock.calls.map(([url]) => new URL(url as string).host)).toEqual([FIRST]);
    }
  });

  it("looks nothing up when the workspace or model ID is not a 32-character ID", async () => {
    for (const ids of [{ workspaceId: WS.slice(1) }, { workspaceId: `${WS}0` }, { modelId: MODEL.replace("F", "-") }, { modelId: "" }]) {
      const { catalog, notes, failedActionTypes } = await run(pages, { ...scope, ...ids }).result;
      expect(notes).toEqual(["Synthetic model: unexpected workspace or model ID; names were not looked up."]);
      expect(failedActionTypes).toEqual(["IMPORT", "EXPORT", "PROCESS"]);
      expect(catalog.pages.get("page-guid")).toBe("Inventory policy");
    }
    expect(ScriptedSocket.sockets).toEqual([]);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("reads imports, exports and processes in that order, the page's host before the model's, after the socket's notes", async () => {
    ScriptedSocket.reply = (socket, frame) => {
      if (frame.command === "CONNECT") { socket.serve("CONNECTED\nversion:1.2\nserver:test\n\n\0"); return; }
      if (frame.command !== "SEND") return;
      const { destination, id } = frame.headers;
      if (destination === `core://${WS}:${MODEL}`) {
        if (socket.host === FIRST) socket.serve(`ERROR\n\n${JSON.stringify({ error: "REDIRECTION_REQUIRED", fqdn: MODEL_HOST })}\0`);
      } else if (destination === `core://${WS}:${MODEL}/lists`) {
        socket.serve(`MESSAGE\nsubscription:${id}\nmessage-type:error\n\n${JSON.stringify({ error: "LISTS_UNAVAILABLE" })}\0`);
      } else socket.serve(update(id, { data: [] }));
    };
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    // Imports answer on the page's host, exports on neither host, processes only on the model's host.
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const { host, pathname } = new URL(url);
      const key = pathname.split("/").at(-1);
      if (key === "imports") return json({ imports: [{ id: "112000000901", name: "Import demand" }] });
      if (key === "exports") return new Response("{}", { status: host === FIRST ? 500 : 403 });
      if (host === FIRST) throw new TypeError("Failed to fetch");
      return json({ processes: [{ id: "118000000901", name: "Nightly load" }] });
    }));
    const references = [{ kind: "module", id: MODULE }, { kind: "action", id: "118000000901", actionType: "PROCESS" },
      { kind: "action", id: "116000000901", actionType: "EXPORT" }, { kind: "action", id: "112000000901", actionType: "IMPORT" }];
    const { log, result } = run([{ cards: [], references }] as unknown as UxPageCardDetails[]);
    const { catalog, notes, failedActionTypes } = await result;

    const path = `/a/collaboration-actions-service/workspaces/${WS}/models/${MODEL}`;
    expect(vi.mocked(globalThis.fetch).mock.calls.map(([url]) => url)).toEqual([`https://${FIRST}${path}/imports`, `https://${FIRST}${path}/exports`,
      `https://${MODEL_HOST}${path}/exports`, `https://${FIRST}${path}/processes`, `https://${MODEL_HOST}${path}/processes`]);
    expect([...catalog.actions]).toEqual([["112000000901", "Import demand"], ["118000000901", "Nightly load"]]);
    expect(failedActionTypes).toEqual(["EXPORT"]);
    expect(notes).toEqual(["Synthetic model: list names were not available (LISTS_UNAVAILABLE).",
      "Synthetic model: could not read the model's exports (HTTP_ERROR (HTTP 500)); their buttons show the card label."]);
    const totals = "Synthetic model: 0 modules, 0 saved views, 0 dimensions, 0 line items (1 modules read), 2 actions";
    expect(log.filter(line => line.startsWith("Synthetic model: "))).toEqual([
      `Synthetic model: 1 imports named (from ${FIRST})`,
      `Synthetic model: exports from ${FIRST} answered HTTP_ERROR (HTTP 500)`,
      `Synthetic model: exports from ${MODEL_HOST} answered HTTP_ERROR (HTTP 403)`,
      `Synthetic model: processes from ${FIRST} answered NETWORK_ERROR`,
      `Synthetic model: 1 processes named (from ${MODEL_HOST})`,
      totals]);
    expect(log.at(-1)).toBe(totals);
  });

  it("names the zip after the app, without characters a file name cannot hold", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.UTC(2026, 8, 28, 1, 59, 9)));
    const APP = "01234567-89ab-cdef-0123-456789abcdef";
    const analyse = async (name: unknown) => {
      vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ name, pages: [] }), { status: 200 })));
      return analyseApp(APP, { status: () => undefined, log: () => undefined }, () => "01:59:09 page-analyzer vdev");
    };
    const result = await analyse('Supply: "Plan" /\t2026');
    expect(result.fileName).toBe("Supply Plan 2026 - App Export - 2026-09-28.zip");
    expect(result.summary).toEqual(["0 of 0 pages analysed, 0 cards."]);
    expect(Array.from(result.zip.slice(0, 2))).toEqual([0x50, 0x4b]);
    expect((await analyse("???")).fileName).toBe("app - App Export - 2026-09-28.zip");
    expect((await analyse(undefined)).fileName).toBe("App - App Export - 2026-09-28.zip");
    expect((await analyse("a".repeat(100))).fileName).toBe(`${"a".repeat(80)} - App Export - 2026-09-28.zip`);
    await expect(analyseApp("not-an-app-id", { status: () => undefined, log: () => undefined }, () => "")).rejects.toThrow("Open an app first: the address has no app ID.");
  });
});
