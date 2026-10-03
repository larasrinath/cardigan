import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UxPageCardDetails } from "./card-reader/card-types.js";
import { analyseApp, loadCatalog } from "./analyse.js";
import { APP_ZIP_0_6_1, ZIPPED_AT } from "./golden-0.6.1.test-support.js";
import { ANAPLAN_HOSTS, NOT_SCOPE_IDS, OTHER_HOSTS, SCOPE_IDS } from "./guards.test-support.js";
import * as report from "./report.js";
import { resultZip } from "./result-zip.js";
import { decodeFrames, type StompFrame } from "./stomp.js";
import { toCsv } from "./zip.js";
import { parseCsv, sameBytes, unzipText } from "./zip.test-support.js";

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
  const statuses: string[] = [];
  return { log, statuses, result: loadCatalog(on, over, new Map([["page-guid", "Inventory policy"]]),
    { status: line => { statuses.push(line); }, log: line => { log.push(line); } }) };
}

// The read phases after names and line items: module dimensions, item names, saved view layouts and filter line items.
const [LIST, LIST_2, VIEW, VIEW_2, MODULE_3] = ["101000000901", "101000000902", "130000000901", "130000000902", "102000000903"];
const [NORTH, SOUTH, LINE_ITEM, FILTER_ITEM] = ["201000000001", "201000000002", "1901000000001", "1903000000001"];
const candidate = (n: number) => String(102000001000 + n);
const at = (path: string) => `core://${WS}:${MODEL}${path}`;
const MODULE_VIEWS = `core:/${WS}:${MODEL}/moduleViews`;
const CONNECTED = "CONNECTED\nversion:1.2\nserver:test\n\n\0";
const rejected = (id: string, error: string) => `MESSAGE\nsubscription:${id}\nmessage-type:error\n\n${JSON.stringify({ error })}\0`;
const metadata = (id: string, body: unknown) => `MESSAGE\nsubscription:${id}\nmessage-type:metadata\n\n${JSON.stringify(body)}\0`;
const SERVICE_DOWN = `ERROR\n\n${JSON.stringify({ error: "SERVICE_DOWN" })}\0`;
const UNAVAILABLE = "Synthetic model: names from the model data service were not available (SERVICE_DOWN); IDs are shown instead.";
/** A described grid card: Product rows with two hidden items, filtered on a line item that no card shows, and Time columns. */
const gridCard = { id: "card-1", type: "TABLE", grid: { regions: [{ region: "SINGLE", module: { kind: "module", id: MODULE },
  rows: { dimensions: [{ dimension: { kind: "dimension", id: LIST }, hides: [{ kind: "listItem", id: NORTH }, { kind: "listItem", id: SOUTH }] }],
    filter: { operator: "AND", match: "all", conditions: [{ operator: "EQUALS", values: ["true"], selectedItems: [{ kind: "unknown", id: FILTER_ITEM }] }], groups: [] } },
  columns: { dimensions: [{ dimension: { kind: "dimension", id: "20000000003" } }] } }] } };
const withGrid = (...references: unknown[]) => [{ cards: [gridCard], references: [{ kind: "module", id: MODULE }, ...references] }] as unknown as UxPageCardDetails[];

/** One host's model data service: each SEND is answered by its destination, or with no data. */
function serveModel(answers: Record<string, (id: string) => string> = {}) {
  ScriptedSocket.reply = (socket, frame) => {
    if (frame.command === "CONNECT") { socket.serve(CONNECTED); return; }
    if (frame.command !== "SEND") return;
    const { destination, id } = frame.headers;
    socket.serve(answers[destination]?.(id) ?? update(id, { data: [] }));
  };
}
const sent = (command: string) => ScriptedSocket.sockets.flatMap(socket => socket.frames).filter(frame => frame.command === command);
const destinations = () => sent("SEND").map(frame => frame.headers.destination);

describe("Page analyzer name loading against the live socket behaviour", () => {
  beforeEach(() => {
    ScriptedSocket.sockets = [];
    vi.stubGlobal("WebSocket", ScriptedSocket);
    vi.stubGlobal("location", { host: FIRST, origin: `https://${FIRST}` });
    vi.stubGlobal("document", { cookie: "other=1; XSRF-TOKEN=xsrf-value" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ imports: [{ id: "112000000901", name: "Import demand" }] }),
      { status: 200, headers: { "content-type": "application/json" } })));
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); vi.restoreAllMocks(); });

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
    for (const fqdn of ["model.app.anaplan.com.example.net", "example.net", "anaplan.com", "model.app.anaplan.com:8443", "model.app.anaplan.com/a", ...OTHER_HOSTS]) {
      ScriptedSocket.sockets = [];
      vi.mocked(globalThis.fetch).mockClear();
      ScriptedSocket.reply = (socket, frame) => {
        if (frame.command === "CONNECT") socket.serve("CONNECTED\nversion:1.2\nserver:test\n\n\0");
        else if (frame.command === "SEND" && frame.headers.destination === `core://${WS}:${MODEL}`) socket.serve(`ERROR\n\n${JSON.stringify({ error: "REDIRECTION_REQUIRED", fqdn })}\0`);
      };
      const { log, result } = run();
      const { notes, failedActionTypes } = await result;
      expect(ScriptedSocket.sockets.map(socket => socket.host), fqdn).toEqual([FIRST]);
      expect(notes).toEqual(["Synthetic model: names from the model data service were not available (REDIRECTION_REQUIRED); IDs are shown instead."]);
      expect(log.filter(line => line.startsWith("redirected to"))).toEqual([]);
      // The action names are then read from the page's own host only.
      expect(failedActionTypes).toEqual([]);
      expect(vi.mocked(globalThis.fetch).mock.calls.map(([url]) => new URL(url as string).host)).toEqual([FIRST]);
    }
  });

  it("follows one redirect only: a second one is reported like any other failure", async () => {
    ScriptedSocket.reply = (socket, frame) => {
      if (frame.command === "CONNECT") socket.serve("CONNECTED\nversion:1.2\nserver:test\n\n\0");
      else if (frame.command === "SEND" && frame.headers.destination === `core://${WS}:${MODEL}`) {
        socket.serve(`ERROR\n\n${JSON.stringify({ error: "REDIRECTION_REQUIRED", fqdn: socket.host === FIRST ? MODEL_HOST : "third.app.anaplan.com" })}\0`);
      }
    };
    const { log, result } = run();
    const { catalog, notes, failedActionTypes } = await result;
    expect(ScriptedSocket.sockets.map(socket => socket.host)).toEqual([FIRST, MODEL_HOST]);
    expect(log.filter(line => line.startsWith("redirected to"))).toEqual([`redirected to ${MODEL_HOST}`]);
    expect(notes).toEqual(["Synthetic model: names from the model data service were not available (REDIRECTION_REQUIRED); IDs are shown instead."]);
    expect(failedActionTypes).toEqual([]);
    expect(catalog.actions.get("112000000901")).toBe("Import demand");
  });

  it("follows a redirect to any Anaplan host", async () => {
    for (const host of ANAPLAN_HOSTS) {
      ScriptedSocket.sockets = [];
      ScriptedSocket.reply = (socket, frame) => {
        if (frame.command === "CONNECT") socket.serve(CONNECTED);
        else if (frame.command === "SEND" && frame.headers.destination === at("") && socket === ScriptedSocket.sockets[0]) {
          socket.serve(`ERROR\n\n${JSON.stringify({ error: "REDIRECTION_REQUIRED", fqdn: host })}\0`);
        } else if (frame.command === "SEND") socket.serve(update(frame.headers.id, { data: [] }));
      };
      const { log, result } = run();
      const { notes } = await result;
      expect(notes, host).toEqual([]);
      expect(log.filter(line => line.startsWith("redirected to")), host).toEqual([`redirected to ${host}`]);
      // The URL keeps the host as the redirect named it; URL.host would lower-case it.
      expect(ScriptedSocket.sockets.map(socket => socket.url.split("/a/")[0]), host).toEqual([`wss://${FIRST}`, `wss://${host}`]);
    }
  });

  it("follows only a REDIRECTION_REQUIRED error, not another error that names an Anaplan host", async () => {
    ScriptedSocket.reply = (socket, frame) => {
      if (frame.command === "CONNECT") socket.serve(CONNECTED);
      else if (frame.command === "SEND" && frame.headers.destination === at("")) socket.serve(`ERROR\n\n${JSON.stringify({ error: "MODEL_UNAVAILABLE", fqdn: MODEL_HOST })}\0`);
    };
    const { log, result } = run();
    const { notes } = await result;
    expect(ScriptedSocket.sockets.map(socket => socket.host)).toEqual([FIRST]);
    expect(log.filter(line => line.startsWith("redirected to"))).toEqual([]);
    expect(notes).toEqual(["Synthetic model: names from the model data service were not available (MODEL_UNAVAILABLE); IDs are shown instead."]);
  });

  it("looks nothing up when the workspace or model ID is not a 32-character ID", async () => {
    for (const ids of [{ workspaceId: WS.slice(1) }, { workspaceId: `${WS}0` }, { modelId: MODEL.replace("F", "-") }, { modelId: "" },
      ...NOT_SCOPE_IDS.flatMap(id => [{ workspaceId: id }, { modelId: id }])]) {
      const { catalog, notes, failedActionTypes } = await run(pages, { ...scope, ...ids }).result;
      expect(notes, JSON.stringify(ids)).toEqual(["Synthetic model: unexpected workspace or model ID; names were not looked up."]);
      expect(failedActionTypes).toEqual(["IMPORT", "EXPORT", "PROCESS"]);
      expect(catalog.pages.get("page-guid")).toBe("Inventory policy");
    }
    expect(ScriptedSocket.sockets).toEqual([]);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("looks names up under any workspace and model ID of 32 letters or digits", async () => {
    for (const [index, workspaceId] of SCOPE_IDS.entries()) {
      const modelId = SCOPE_IDS[(index + 1) % SCOPE_IDS.length];
      ScriptedSocket.sockets = [];
      vi.mocked(globalThis.fetch).mockClear();
      ScriptedSocket.reply = (socket, frame) => {
        if (frame.command === "CONNECT") { socket.serve("CONNECTED\nversion:1.2\nserver:test\n\n\0"); return; }
        if (frame.command !== "SEND") return;
        const { destination, id } = frame.headers;
        if (destination === `core:/${workspaceId}:${modelId}/moduleViews`) socket.serve(update(id, { data: [{ id: Number(MODULE), name: "Demand", views: [] }], dimensions: {} }));
        if (destination === `core://${workspaceId}:${modelId}/lists`) socket.serve(update(id, { data: [{ id: "101000000901", name: "Product" }] }));
        if (destination === `core://${workspaceId}:${modelId}/modules/${MODULE}/lineItems`) socket.serve(update(id, { data: [{ lineItemId: "1901000000001", lineItemLabel: "Volume" }] }));
      };
      const { catalog, notes, failedActionTypes } = await run(pages, { ...scope, workspaceId, modelId }).result;
      expect([notes, failedActionTypes], workspaceId).toEqual([[], []]);
      expect([catalog.modules.get(MODULE), catalog.dimensions.get("101000000901"), catalog.lineItems.get("1901000000001")], workspaceId)
        .toEqual(["Demand", "Product", { name: "Volume", moduleId: MODULE }]);
      expect(vi.mocked(globalThis.fetch).mock.calls.map(([url]) => url))
        .toEqual([`https://${FIRST}/a/collaboration-actions-service/workspaces/${workspaceId}/models/${modelId}/imports`]);
    }
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

  it("asks a host once when the model is served from the page's own host", async () => {
    // No redirect: the socket settles on the page's host, so that host is both the page's and the model's.
    ScriptedSocket.reply = (socket, frame) => {
      if (frame.command === "CONNECT") socket.serve("CONNECTED\nversion:1.2\nserver:test\n\n\0");
      else if (frame.command === "SEND" && frame.headers.destination !== `core://${WS}:${MODEL}`) socket.serve(update(frame.headers.id, { data: [] }));
    };
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 500 })));
    const { log, result } = run();
    const { notes, failedActionTypes } = await result;

    expect(ScriptedSocket.sockets.map(socket => socket.host)).toEqual([FIRST]);
    // A read that fails is not sent to the same host a second time, and is logged once.
    expect(vi.mocked(globalThis.fetch).mock.calls.map(([url]) => url))
      .toEqual([`https://${FIRST}/a/collaboration-actions-service/workspaces/${WS}/models/${MODEL}/imports`]);
    expect(log.filter(line => line.includes(" answered "))).toEqual([`Synthetic model: imports from ${FIRST} answered HTTP_ERROR (HTTP 500)`]);
    expect(notes).toEqual(["Synthetic model: could not read the model's imports (HTTP_ERROR (HTTP 500)); their buttons show the card label."]);
    expect(failedActionTypes).toEqual(["IMPORT"]);
  });

  it("reads module dimensions, item names, saved view layouts and filter line items, in that order, after the names", async () => {
    serveModel({
      [at("")]: id => update(id, { status: "UNKNOWN" }),
      [MODULE_VIEWS]: id => update(id, { data: [{ id: Number(MODULE), name: "Demand", views: [] }], dimensions: {} }),
      [at("/lists")]: id => update(id, { data: [{ id: LIST, name: "Product" }] }),
      [at(`/modules/${MODULE}/lineItems`)]: id => update(id, { data: [{ lineItemId: LINE_ITEM, lineItemLabel: "Volume" }] }),
      [at("/dimensions")]: id => update(id, { modules: { [MODULE]: { dimensions: [{ id: LIST, label: "Product" }, { id: LIST_2, label: "Territory" }] } } }),
      [at(`/modules/${MODULE}/dimensions/${LIST}`)]: id => update(id, { data: [{ itemId: NORTH, label: "North" }] }),
      [at(`/views/${VIEW}`)]: id => metadata(id, { rows: [{ dimensionId: LIST, label: "Product" }], cols: [],
        contextFilters: [{ parent: LIST_2, label: "Territory", contextFilterType: "LIST" }] }),
      [at(`/views/${VIEW_2}`)]: id => metadata(id, { columnWidths: [] }),
      [at("/applicableModules")]: id => update(id, { data: [{ id: Number(MODULE), label: "Demand" }, { id: Number(candidate(1)), label: "Plan settings" },
        { id: Number(candidate(2)), label: "Filter flags" }] }),
      [at(`/modules/${candidate(2)}/lineItems`)]: id => update(id, { data: [{ lineItemId: FILTER_ITEM, lineItemLabel: "Include?" }] }),
    });
    const { log, statuses, result } = run(withGrid({ kind: "view", id: VIEW }, { kind: "view", id: VIEW_2 }));
    const { catalog, notes, failedActionTypes } = await result;

    expect([notes, failedActionTypes]).toEqual([["Synthetic model: 1 of 2 saved views' rows, columns and context selectors could not be read."], []]);
    const viewBody = { transforms: [], expandCollapseTransforms: [], clientQueryOptions: { useCellIdTemplate: false, canHandleDedupedAuxData: false, canHandleNullColumnWidths: false } };
    expect(sent("SEND").map(frame => [frame.headers.destination, JSON.parse(frame.body)])).toEqual([
      [at(""), {}], [MODULE_VIEWS, {}], [at("/lists"), {}], [at(`/modules/${MODULE}/lineItems`), {}], [at("/dimensions"), { moduleIds: [MODULE] }],
      [at(`/modules/${MODULE}/dimensions/${LIST}`), { itemIds: [NORTH, SOUTH], filter: "" }], [at(`/views/${VIEW}`), viewBody], [at(`/views/${VIEW_2}`), viewBody],
      [at("/applicableModules"), { dimensions: [101000000901] }], [at(`/modules/${candidate(1)}/lineItems`), {}], [at(`/modules/${candidate(2)}/lineItems`), {}]]);
    expect(sent("SUBSCRIBE").filter(frame => frame.headers.accept).map(frame => [frame.headers.destination, frame.headers.accept])).toEqual([
      [at(""), "widget/model"], [at(`/modules/${MODULE}/dimensions/${LIST}`), "widget/selection"], [at(`/views/${VIEW}`), "widget/grid"], [at(`/views/${VIEW_2}`), "widget/grid"]]);
    expect(statuses).toEqual(["Reading names in Synthetic model…", "Reading line items in Synthetic model…", "Reading module dimensions in Synthetic model…",
      "Reading item names in Synthetic model…", "Reading saved view layouts in Synthetic model…", "Finding filter line items in Synthetic model…"]);
    expect(log.filter(line => /^(dimensions of|module dimensions|items of|view |modules for|line items of)/.test(line))).toEqual(["dimensions of 1 of 1 modules",
      `items of dimension ${LIST} in module ${MODULE}: 1 of 2 named`, `view ${VIEW}: metadata {rows, cols, contextFilters}`, `view ${VIEW_2}: metadata {columnWidths}`,
      `view ${VIEW_2}: metadata without rows, columns or pages`]);
    expect(log.at(-1)).toBe("Synthetic model: 3 modules, 0 saved views, 2 dimensions, 2 line items (3 modules read), 0 actions");

    expect(catalog.moduleDimensions).toEqual(new Map([[MODULE, [{ id: LIST, name: "Product" }, { id: LIST_2, name: "Territory" }]]]));
    expect(catalog.listItems).toEqual(new Map([[NORTH, "North"]]));
    expect(catalog.viewLayouts).toEqual(new Map([[VIEW, { rows: [{ id: LIST, name: "Product" }], columns: [], pages: [{ id: LIST_2, name: "Territory" }] }]]));
    expect(catalog.modules).toEqual(new Map([[MODULE, "Demand"], [candidate(1), "Plan settings"], [candidate(2), "Filter flags"]]));
    expect(catalog.lineItems.get(FILTER_ITEM)).toEqual({ name: "Include?", moduleId: candidate(2) });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("logs a phase whose read the service refuses, adds a note where the report shows less, and goes on", async () => {
    serveModel({
      [at("/dimensions")]: id => rejected(id, "DIMENSIONS_UNAVAILABLE"),
      [at(`/modules/${MODULE}/dimensions/${LIST}`)]: id => rejected(id, "ITEMS_UNAVAILABLE"),
      [at(`/views/${VIEW}`)]: id => rejected(id, "VIEW_UNAVAILABLE"),
      [at("/applicableModules")]: id => rejected(id, "MODULES_UNAVAILABLE"),
    });
    const { log, statuses, result } = run(withGrid({ kind: "view", id: VIEW }));
    const { notes } = await result;

    expect(notes).toEqual([
      "Synthetic model: module dimensions were not available (DIMENSIONS_UNAVAILABLE); context selectors show only those saved on the page.",
      "Synthetic model: 1 of 1 saved views' rows, columns and context selectors could not be read."]);
    expect(log.filter(line => /^(dimensions of|module dimensions|items of|view |modules for)/.test(line))).toEqual(["module dimensions: DIMENSIONS_UNAVAILABLE",
      `items of dimension ${LIST} in module ${MODULE}: ITEMS_UNAVAILABLE`, `view ${VIEW}: VIEW_UNAVAILABLE`, `modules for dimension ${LIST}: MODULES_UNAVAILABLE`]);
    expect(destinations().slice(4)).toEqual([at("/dimensions"), at(`/modules/${MODULE}/dimensions/${LIST}`), at(`/views/${VIEW}`), at("/applicableModules")]);
    expect(statuses.at(-1)).toBe("Finding filter line items in Synthetic model…");
  });

  it("ends the socket work at once when the connection fails while reading module dimensions or the filtered dimension's modules", async () => {
    for (const failing of [at("/dimensions"), at("/applicableModules")]) {
      ScriptedSocket.sockets = [];
      serveModel({ [failing]: () => SERVICE_DOWN });
      const { log, result } = run(withGrid());
      const { notes, failedActionTypes } = await result;
      expect([notes, failedActionTypes], failing).toEqual([[UNAVAILABLE], []]);
      expect(destinations().at(-1), failing).toBe(failing);
      expect(log.filter(line => line.startsWith("module dimensions") || line.startsWith("modules for")), failing).toEqual([]);
    }
  });

  it("logs a connection failure while reading item names or a saved view, then ends the socket work", async () => {
    for (const [failing, line] of [[at(`/modules/${MODULE}/dimensions/${LIST}`), `items of dimension ${LIST} in module ${MODULE}: SERVICE_DOWN`],
      [at(`/views/${VIEW}`), `view ${VIEW}: SERVICE_DOWN`]]) {
      ScriptedSocket.sockets = [];
      serveModel({ [failing]: () => SERVICE_DOWN });
      const { log, result } = run(withGrid({ kind: "view", id: VIEW }));
      const { notes } = await result;
      // No note that the saved view could not be read: the failed connection is reported instead.
      expect(notes, failing).toEqual([UNAVAILABLE]);
      expect(destinations().at(-1), failing).toBe(failing);
      expect(log, failing).toContain(line);
    }
  });

  it("stops a later read that is still waiting when the model closes, and handles the stop by that phase's own rule", async () => {
    const closed = "the model is closed";
    const ended = `Synthetic model: names from the model data service were not available (${closed}); IDs are shown instead.`;
    const viewLayout = (id: string) => metadata(id, { rows: [{ dimensionId: LIST, label: "Product" }], cols: [] });
    // Module dimensions and the filtered dimension's modules log the stop as they log a refused read and go on, so the work
    // ends at the next read that waits on the socket (there is none after the modules search); item names and saved views
    // end it at once.
    for (const [waiting, notes, last, logged] of [
      [at("/dimensions"), [`Synthetic model: module dimensions were not available (${closed}); context selectors show only those saved on the page.`, ended],
        at(`/modules/${MODULE}/dimensions/${LIST}`), [`module dimensions: ${closed}`]],
      [at(`/modules/${MODULE}/dimensions/${LIST}`), [ended], at(`/modules/${MODULE}/dimensions/${LIST}`), []],
      [at(`/views/${VIEW}`), [ended], at(`/views/${VIEW}`), []],
      [at("/applicableModules"), [], at("/applicableModules"), [`modules for dimension ${LIST}: ${closed}`]],
    ] as const) {
      ScriptedSocket.sockets = [];
      let status = "";
      // The waiting read is never answered: the model status subscription reports the model closed instead.
      serveModel({ [at("")]: id => { status = id; return update(id, { status: "UNKNOWN" }); }, [at(`/views/${VIEW}`)]: viewLayout,
        [waiting]: () => update(status, { status: "CLOSED" }) });
      const started = Date.now();
      const { log, result } = run(withGrid({ kind: "view", id: VIEW }));
      const done = await result;
      expect(Date.now() - started, waiting).toBeLessThan(5_000);
      expect(done.notes, waiting).toEqual(notes);
      expect(destinations().at(-1), waiting).toBe(last);
      expect(log.slice(log.indexOf("model status CLOSED")).filter(line => /^(model status|module dimensions|modules for)/.test(line)), waiting)
        .toEqual(["model status CLOSED", ...logged]);
    }
  });

  it("does not look for filter line items once the shown modules' line items name every filter condition", async () => {
    serveModel({ [at(`/modules/${MODULE}/lineItems`)]: id => update(id, { data: [{ lineItemId: FILTER_ITEM, lineItemLabel: "Include?" }] }) });
    const { statuses, result } = run(withGrid());
    const { catalog, notes } = await result;

    expect(notes).toEqual([]);
    expect(catalog.lineItems.get(FILTER_ITEM)).toEqual({ name: "Include?", moduleId: MODULE });
    expect(destinations()).toEqual([at(""), MODULE_VIEWS, at("/lists"), at(`/modules/${MODULE}/lineItems`), at("/dimensions"),
      at(`/modules/${MODULE}/dimensions/${LIST}`)]);
    expect(statuses).toEqual(["Reading names in Synthetic model…", "Reading line items in Synthetic model…", "Reading module dimensions in Synthetic model…",
      "Reading item names in Synthetic model…"]);
  });

  it("reads no item names, and shows no status for them, when no grid shows or hides an item", async () => {
    const region = gridCard.grid.regions[0];
    const card = { ...gridCard, grid: { regions: [{ ...region, rows: { ...region.rows, dimensions: [{ dimension: { kind: "dimension", id: LIST } }] } }] } };
    serveModel();
    const { statuses, result } = run([{ cards: [card], references: [{ kind: "module", id: MODULE }] }] as unknown as UxPageCardDetails[]);
    const { notes } = await result;

    expect(notes).toEqual([]);
    expect(destinations()).toEqual([at(""), MODULE_VIEWS, at("/lists"), at(`/modules/${MODULE}/lineItems`), at("/dimensions"), at("/applicableModules")]);
    expect(statuses).toEqual(["Reading names in Synthetic model…", "Reading line items in Synthetic model…", "Reading module dimensions in Synthetic model…",
      "Finding filter line items in Synthetic model…"]);
  });

  it("adds no saved view note when every saved view's layout was read", async () => {
    const layout = (id: string) => metadata(id, { rows: [{ dimensionId: LIST, label: "Product" }], cols: [] });
    serveModel({ [at(`/views/${VIEW}`)]: layout, [at(`/views/${VIEW_2}`)]: layout });
    const { catalog, notes } = await run(withGrid({ kind: "view", id: VIEW }, { kind: "view", id: VIEW_2 })).result;
    expect(notes).toEqual([]);
    expect([...catalog.viewLayouts.keys()]).toEqual([VIEW, VIEW_2]);
  });

  it("looks for filter line items in the filtered dimension's modules not yet read, four at a time, until found or 60 were read", async () => {
    for (const [count, found, read, notes] of [[6, 2, 4, []], [60, 0, 60, []],
      [61, 0, 60, ["Synthetic model: some filter line items were not found in the first 60 candidate modules."]]] as const) {
      ScriptedSocket.sockets = [];
      const candidates = Array.from({ length: count }, (_, index) => candidate(index + 1));
      serveModel({
        // A module that was read already, or could not be read, is not a candidate.
        [at(`/modules/${MODULE_3}/lineItems`)]: id => rejected(id, "LINE_ITEMS_UNAVAILABLE"),
        [at("/applicableModules")]: id => update(id, { data: [MODULE, MODULE_3, ...candidates].map(module => ({ id: module, label: `Module ${module}` })) }),
        ...(found ? { [at(`/modules/${candidate(found)}/lineItems`)]: (id: string) => update(id, { data: [{ lineItemId: FILTER_ITEM, lineItemLabel: "Include?" }] }) } : {}),
      });
      const { log, result } = run(withGrid({ kind: "module", id: MODULE_3 }));
      const done = await result;
      expect(done.notes, String(count)).toEqual(notes);
      expect(destinations().filter(destination => destination.endsWith("/lineItems")), String(count))
        .toEqual([MODULE, MODULE_3, ...candidates.slice(0, read)].map(module => at(`/modules/${module}/lineItems`)));
      expect(log).toContain(`line items of module ${MODULE_3}: LINE_ITEMS_UNAVAILABLE`);
      expect(done.catalog.lineItems.has(FILTER_ITEM)).toBe(!!found);
    }
  });

  it("counts pages with no published version apart, so an app read in full says it was", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.UTC(2026, 8, 28, 1, 59, 9)));
    const pages = [{ guid: "11111111-2222-3333-4444-555555555555", name: "Draft", pageType: "BOARD", hasPublishedVersion: false }];
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ name: "Plan", pages }), { status: 200 })));
    const result = await analyseApp("01234567-89ab-cdef-0123-456789abcdef", { status: () => undefined, log: () => undefined }, () => "");
    expect(result.summary).toEqual(["0 of 0 pages analysed; 1 unpublished, not analysed, 0 cards."]);
  });

  it("counts a published page it could not read as published, so the export does not claim every published page was read", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.UTC(2026, 8, 28, 1, 59, 9)));
    const pages = [{ guid: "11111111-2222-3333-4444-555555555555", name: "Draft", pageType: "BOARD", hasPublishedVersion: false },
      { guid: "66666666-7777-8888-9999-aaaaaaaaaaaa", name: "Restricted", pageType: "BOARD", hasPublishedVersion: true }];
    // The app record answers; every route to the published page answers 403.
    vi.stubGlobal("fetch", vi.fn(async (url: string) => new URL(url).pathname.includes("/apps/")
      ? new Response(JSON.stringify({ name: "Plan", pages }), { status: 200 }) : new Response("{}", { status: 403 })));
    const result = await analyseApp("01234567-89ab-cdef-0123-456789abcdef", { status: () => undefined, log: () => undefined }, () => "");
    expect(vi.mocked(globalThis.fetch).mock.calls.map(([url]) => new URL(url as string).pathname.split("/")[3]))
      .toEqual(["apps", "boards", "grid-pages", "reports"]);
    expect(result.summary).toEqual(["0 of 1 pages analysed; 1 unpublished, not analysed, 0 cards."]);

    const files = unzipText(resultZip(result));
    const details = parseCsv(files.get("App Details.csv") ?? "");
    expect(details.find(row => row[1] === "Pages analysed")).toEqual(["App", "Pages analysed", "0 of 1 (published versions); 1 unpublished, not analysed"]);
    expect(details.filter(row => row[0] === "Notes" && row[1] !== "Names")).toEqual([["Notes", "Draft", "Not published"], ["Notes", "Restricted", "Not analysed: no access"]]);
    const [headers, ...rows] = parseCsv(files.get("Pages.csv") ?? "");
    const [page, state] = [headers.indexOf("Page"), headers.indexOf("Publish state")];
    expect(rows.map(row => [row[page], row[state]])).toEqual([["Draft", "Not published"], ["Restricted", "Not analysed: no access"]]);
    expect(rows.filter(row => row[state] === "Not published")).toHaveLength(1);
  });

  it("returns only text and finite numbers as cells, whatever the report holds, without changing the CSV", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.UTC(2026, 8, 28, 1, 59, 9)));
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ name: "Plan", pages: [] }), { status: 200 })));
    // The report reads described cards of no fixed shape: a cell could be left as anything.
    const odd = [["Board", undefined, null, NaN], [true, { id: 7 }, -Infinity, 12]];
    const tables = report.buildReport([]);
    vi.spyOn(report, "buildReport").mockReturnValue({ ...tables, Cards: { headers: ["Page", "Card #", "Card title", "Card type"], rows: odd as never } });
    const result = await analyseApp("01234567-89ab-cdef-0123-456789abcdef", { status: () => undefined, log: () => undefined }, () => "");
    const cards = result.tables.find(table => table.file === "Cards.csv")!;
    expect(cards.rows).toEqual([["Board", "", "", "NaN"], ["true", "[object Object]", "-Infinity", 12]]);
    // The file is what the report's own rows give, and is the same after the trip to the results page as JSON.
    const written = '\ufeffPage,Card #,Card title,Card type\r\nBoard,,,NaN\r\ntrue,[object Object],\'-Infinity,12\r\n';
    expect(toCsv(cards.headers, odd)).toBe(written);
    // (Reading a file back as text drops its byte order mark.)
    expect(unzipText(resultZip(result)).get("Cards.csv")).toBe(written.slice(1));
    expect(unzipText(resultZip(JSON.parse(JSON.stringify(result)) as typeof result)).get("Cards.csv")).toBe(written.slice(1));
    // The headers are the result's own copy of the report's.
    expect(result.tables[1].headers).toEqual(report.HEADERS.Pages);
    expect(result.tables[1].headers).not.toBe(report.HEADERS.Pages);
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
    expect(result.zipName).toBe("Supply Plan 2026 - App Export - 2026-09-28.zip");
    expect(result.summary).toEqual(["0 of 0 pages analysed, 0 cards."]);
    expect(Array.from(resultZip(result).slice(0, 2))).toEqual([0x50, 0x4b]);
    expect((await analyse("???")).zipName).toBe("app - App Export - 2026-09-28.zip");
    expect((await analyse(undefined)).zipName).toBe("App - App Export - 2026-09-28.zip");
    expect((await analyse("a".repeat(100))).zipName).toBe(`${"a".repeat(80)} - App Export - 2026-09-28.zip`);
    // Every character Windows refuses in a file name, and control characters, become one space; anything else stays.
    expect((await analyse('a\\b/c:d*e?f"g<h>i|j\u0000k\u0001l\u001fm')).zipName).toBe("a b c d e f g h i j k l m - App Export - 2026-09-28.zip");
    expect((await analyse("Plan #1 (R&D) - 50%+ [a] {b} ~ 'c' = d; e, f! @g $h ^i")).zipName).toBe("Plan #1 (R&D) - 50%+ [a] {b} ~ 'c' = d; e, f! @g $h ^i - App Export - 2026-09-28.zip");
    // Any run of white space is one space, and the ends are trimmed before the name is cut to 80 characters, not after.
    expect((await analyse(" \u00a0Plan\u00a0\u2003 2026\n")).zipName).toBe("Plan 2026 - App Export - 2026-09-28.zip");
    expect((await analyse(`${"a".repeat(79)} b`)).zipName).toBe(`${"a".repeat(79)}  - App Export - 2026-09-28.zip`);
    // A name that is empty or not text is no name.
    for (const name of ["", 42, null, ["Plan"], { name: "Plan" }]) expect((await analyse(name)).zipName, JSON.stringify(name)).toBe("App - App Export - 2026-09-28.zip");
    // Page and category entries that are not objects are skipped.
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ name: "Plan", pages: [null, 7, "x", true, []], categories: [null, 7, "x", true, []] }), { status: 200 })));
    const odd = await analyseApp(APP, { status: () => undefined, log: () => undefined }, () => "");
    expect([odd.zipName, odd.summary]).toEqual(["Plan - App Export - 2026-09-28.zip", ["0 of 0 pages analysed, 0 cards."]]);
    await expect(analyseApp("not-an-app-id", { status: () => undefined, log: () => undefined }, () => "")).rejects.toThrow("Open an app first: the address has no app ID.");
  });

  it("writes the zip 0.6.1 wrote for the same app, byte for byte, and returns each file as a table", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.UTC(2026, 8, 28, 12, 30, 10)));
    const result = await analyseGoldenApp();
    const zip = resultZip(result, ZIPPED_AT);
    // File by file first, so a difference shows as text; then every byte of the zip.
    expect(unzipText(zip)).toEqual(unzipText(APP_ZIP_0_6_1));
    expect(sameBytes(zip, APP_ZIP_0_6_1)).toBe(true);

    expect([result.kind, result.name, result.id, result.zipName]).toEqual(["app", "Planning: app", GOLDEN_APP, "Planning app - App Export - 2026-09-28.zip"]);
    expect(result.summary).toEqual(["1 of 1 pages analysed; 1 unpublished, not analysed, 3 cards."]);
    expect(result.tables.map(table => [table.file, table.label, table.guard, table.details, table.rows.length])).toEqual([
      ["App Details.csv", "App Details", true, true, 28], ["Pages.csv", "Pages", true, undefined, 2], ["Cards.csv", "Cards", true, undefined, 3],
      ["Grid Sections.csv", "Grid Sections", true, undefined, 1], ["Filters.csv", "Filters", true, undefined, 1],
      ["Conditional Formatting.csv", "Conditional Formatting", true, undefined, 1], ["Action Buttons.csv", "Action Buttons", true, undefined, 2],
      ["Where Used.csv", "Where Used", true, undefined, 10]]);
    // A cell is the value itself: the CSV's guard against formulas and its 12-digit IDs as text are added when it is written.
    const cards = result.tables[2];
    const cell = (row: number, header: string) => cards.rows[row][cards.headers.indexOf(header)];
    expect([cell(2, "Card #"), cell(2, "Card title"), cell(2, "Text content"), cell(1, "Source IDs")])
      .toEqual([3, "+ Notes", '=SUM(1) is text here, not a formula.\nSecond line, with a "quote".', MODULE]);
    // Plain data: the tables are the same after the trip to the results page as JSON, and so is the zip.
    const received = JSON.parse(JSON.stringify(result)) as typeof result;
    expect(received).toEqual(result);
    expect(sameBytes(resultZip(received, ZIPPED_AT), APP_ZIP_0_6_1)).toBe(true);
  });
});

// One app read end to end, as the 0.6.1 zip in zip-0.6.1.test-support.ts was made: a published board with an action card, a
// custom view (a row filter, two hidden items and a formatting rule) and a text card whose text looks like a formula, and a
// page that was never published. Names come from the socket and the actions service.
const GOLDEN_APP = "01234567-89ab-cdef-0123-456789abcdef";
const guid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
type Any = Record<string, any>;
const common = (n: number, type: string): Any => ({ type, customerId: "customer-1", defaultTitle: "", description: "", pageLinkType: "title", pageType: "NONE",
  contextOptions: [], clientGuid: guid(n), widgetGuid: guid(n + 100), version: 1, widgetActions: [], isTargetPagePublished: false, showCommenting: true,
  showMaximize: true, showBackground: true, validVersions: [1], widgetStyles: { titleColor: null, titleColorTheme: null, contextColor: null,
    contextColorTheme: null, contextPlacement: "BOTTOM", backgroundOptions: { backgroundColor: "#FFFFFF" } } });
const dim = (id: string, extra: Any = {}) => ({ id, levels: [], sorts: [], totalsPosition: "AFTER", shows: [], hides: [], reorder: [], ...extra });
const axis = (dimensions: unknown[], nodes: unknown[] = []) => ({ dimensions, filters: { rootNode: { type: "BRANCH", operator: "AND", nodes } }, raggedShows: [], raggedHides: [] });
const button = (id: string, type: string, name: string, extra: Any = {}) => ({ id, type, name, style: null, runAutomatically: null, actionDriverId: null,
  destinationListId: null, disableCancelButton: false, actionToken: "fake-token-value", description: null, ...extra });
const goldenButtons = [button("112000000901", "IMPORT", "Reload plan"), button("118000000901", "PROCESS", "Run nightly", { runAutomatically: false, disableCancelButton: true })];
const goldenCards: Any[] = [
  { ...common(1, "ACTION"), actionWidgetStyle: { layoutType: "BUTTON" }, actions: JSON.stringify(goldenButtons), actionButtons: goldenButtons,
    widgetDataSources: [{ widgetGuid: guid(101), dataSourceId: "", subEntityId: "", dataSourceType: "CLASSIC", axisDescriptionQuery: null, viewDescription: null }] },
  { ...common(2, "TABLE"), defaultTitle: "Demand by product", branchSync: "[]", defaultColumnWidth: "", defaultColumnLabelHeight: "", gridColumnWidths: [],
    lineItemWidthOverrides: [], isReadOnly: true, pivotEnabled: true, customizations: "", lineItemConfigs: "", csvExportEnabled: true, allowFiltering: true,
    allowSorting: true, styleConfig: JSON.stringify({ themeId: "Base" }), showListFunctions: false, allowCopyAcross: true, allowCopyDown: true, allowCellHistory: true,
    allowExpandOrCollapseRows: false, allowChartCreation: true, allowZeroSuppression: true, timeDimensionWidthOverrides: {},
    widgetDataSources: [{ widgetGuid: guid(102), subEntityId: "", viewDescription: null, dataSourceId: guid(900), dataSourceType: "MULTI_AXIS_DESCRIPTION",
      axisDescriptionQuery: { id: guid(900), version: 1, regions: { SINGLE: { moduleId: MODULE,
        rows: axis([dim(LIST, { hides: [NORTH, SOUTH] })], [{ type: "LEAF", rule: { selectedItems: [LIST_2, FILTER_ITEM], operator: "NOT_EQUALS", values: ["0"], identifier: "", axisKey: null } }]),
        columns: axis([dim("20000000003", { levels: ["LEAF"] })]) } },
        conditionalFormattingRules: [{ targetIdentifier: LINE_ITEM, sourceIdentifier: LINE_ITEM, type: "BG_COLOR", targetRegionId: null,
          pegs: [{ value: -10, color: "#F5A5B1" }, { value: 100000, color: "#627786" }], targetRegionCoordinates: null, valuesRegionCoordinates: null }] } }] },
  { ...common(3, "TEXT"), defaultTitle: "+ Notes", text: "=SUM(1) is text here, not a formula.\nSecond line, with a \"quote\"." },
];
const goldenBoard: Any = {
  pageGuid: guid(1000), categoryGuid: guid(1001), appGuid: GOLDEN_APP, customerId: "customer-1", name: "Demand board", workspaceId: WS, modelId: MODEL, rows: [],
  contextOptions: [], isMyPage: false, modelStatus: "UNLOCKED", modelInfo: { modelName: "Model one", workspaceName: "Workspace one" },
  modelInfos: [{ workspaceId: WS, modelId: MODEL }], modelCount: 1, currentDraftVersionGuid: guid(1003), currentPublishedVersionGuid: guid(1003),
  publishedAt: 1_790_000_000_000, updatedAt: 1_790_000_000_000, isAlm: false, categoryUpdatedAt: null, restrictions: [],
  layout: { id: guid(1100), type: "BOARD", version: 2, syncScroll: [], syncBrowser: false, defaultContext: [], contextFilterOrder: [], commentSummary: true,
    commenting: true, openInsightsPanelByDefault: true, areas: { main: [{ type: "BOARD_CONTENT", id: guid(1101), areas: { sections: [{ type: "BOARD_SECTION", id: guid(1102),
      areas: { rows: goldenCards.map((card, index) => ({ id: guid(1200 + index * 10), type: "BOARD_ROW", height: 240, padding: "small", areas: { columns: [
        { type: "BOARD_COLUMN", id: guid(1201 + index * 10), columnStart: 0, columnEnd: 12, areas: { cards: [{ type: card.type, id: card.clientGuid, height: 240 }] } }] } })) } }] } }],
      sidepanel: [], expanded: [] } },
  widgets: Object.fromEntries(goldenCards.map(card => [card.clientGuid, card])),
};

/** Runs the analysis of that app against a scripted definition service, model data socket and actions service. */
async function analyseGoldenApp() {
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  const app = { name: "Planning: app", categories: [{ guid: guid(1001), name: "Demand" }], pages: [
    { guid: guid(1000), name: "Demand board", pageType: "BOARD", categoryGuid: guid(1001), hasPublishedVersion: true },
    { guid: guid(2000), name: "Draft page", pageType: "BOARD", categoryGuid: guid(1001), hasPublishedVersion: false }] };
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const path = new URL(url).pathname;
    if (path.endsWith(`/apps/${GOLDEN_APP}`)) return json(app);
    if (path.endsWith(`/boards/${guid(1000)}`)) return json(goldenBoard);
    if (path.endsWith("/imports")) return json({ imports: [{ id: "112000000901", name: "Import demand" }] });
    if (path.endsWith("/processes")) return json({ processes: [{ id: "118000000999", name: "Another process" }] });
    return new Response("{}", { status: 404 });
  }));
  serveModel({
    [at("")]: id => update(id, { status: "READY" }),
    [MODULE_VIEWS]: id => update(id, { data: [{ id: Number(MODULE), name: "Demand", views: [] }], dimensions: { "20000000003": { label: "Time" } } }),
    [at("/lists")]: id => update(id, { data: [{ id: LIST, name: "Product" }, { id: LIST_2, name: "Territory" }] }),
    [at(`/modules/${MODULE}/lineItems`)]: id => update(id, { data: [{ lineItemId: LINE_ITEM, lineItemLabel: "Volume" }] }),
    [at("/dimensions")]: id => update(id, { modules: { [MODULE]: { dimensions: [{ id: LIST, label: "Product" }, { id: LIST_2, label: "Territory" }, { id: "20000000003", label: "Time" }] } } }),
    [at(`/modules/${MODULE}/dimensions/${LIST}`)]: id => update(id, { data: [{ itemId: NORTH, label: "North" }, { itemId: SOUTH, label: "South" }] }),
    [at("/applicableModules")]: id => update(id, { data: [{ id: Number(MODULE), label: "Demand" }, { id: Number(candidate(2)), label: "Filter flags" }] }),
    [at(`/modules/${candidate(2)}/lineItems`)]: id => update(id, { data: [{ lineItemId: FILTER_ITEM, lineItemLabel: "Include?" }] }),
  });
  return analyseApp(GOLDEN_APP, { status: () => undefined, log: () => undefined },
    () => "12:30:10 page-analyzer vdev: app on first.app.anaplan.com\r\n12:30:10 Reading the app…\r\nunstamped line");
}
