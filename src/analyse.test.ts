import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UxPageCardDetails } from "./card-reader/card-types.js";
import { analyseApp, DETAILS_FILE, forgetModelHosts, loadCatalog, loadCatalogWhen, TAB_FILES, VIEW_TRIAL, type CatalogInputs } from "./analyse.js";
import type { ExportedLineItems } from "./catalog.js";
import { APP_DASH_PLAIN, APP_ROW_ON_TWO_LINES, APP_ROW_REWORDED, APP_ROWS_FOR_THE_PAGE, APP_STOPS_IN_WORDS, APP_ZIP_0_6_1, APP_ZIP_REWORDED, withAppRowsSince, withPlainDash,
  withStopsInWords, ZIPPED_AT } from "./golden-0.6.1.test-support.js";
import { ANAPLAN_HOSTS, NOT_SCOPE_IDS, OTHER_HOSTS, SCOPE_IDS } from "./guards.test-support.js";
import { assemble } from "./pieces.test-support.js";
import { Failure } from "./progress.js";
import * as report from "./report.js";
import { NONE } from "./report.js";
import * as rest from "./rest.js";
import { resultZip } from "./result-zip.test-support.js";
import { decodeFrames, type StompFrame } from "./stomp.js";
import { serveTab } from "./tab-port.js";
import { EXTENSION, FakePort } from "./tab-port.test-support.js";
import { parseCsv, sameBytes, toCsv, unzipText, zipEntries, zipStore } from "./zip.test-support.js";

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
  /** When a socket that was closed says so: in a later turn, as a browser's does. A test can hold the event back. */
  static closing: (fire: () => void) => void = fire => { setTimeout(fire, 0); };
  readyState = 0;
  binaryType = "blob";
  readonly frames: StompFrame[] = [];
  private readonly listeners = new Map<string, Listener[]>();
  constructor(readonly url: string) {
    ScriptedSocket.sockets.push(this);
    // A socket that was closed while it connected does not open, as a browser's does not.
    setTimeout(() => { if (this.readyState !== 0) return; this.readyState = 1; this.emit("open", {}); }, 0);
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
    ScriptedSocket.closing(() => this.emit("close", { code, reason }));
  }
  emit(type: string, event: { data?: unknown; code?: number; reason?: string }) { for (const listener of this.listeners.get(type) ?? []) listener(event); }
  serve(frame: string) { if (this.readyState === 1) this.emit("message", { data: frame }); }
}

const update = (id: string, body: unknown) => `MESSAGE\nsubscription:${id}\nmessage-type:update\nsubscription-revision:00000001\n\n${JSON.stringify(body)}\0`;
const pages = [{ cards: [], references: [{ kind: "module", id: MODULE }, { kind: "action", id: "112000000901", actionType: "IMPORT" }] }] as unknown as UxPageCardDetails[];
const scope = { customerId: "customer-1", workspaceId: WS, modelId: MODEL, modelName: "Synthetic model" };

function run(over = pages, on = scope, signal?: AbortSignal) {
  const log: string[] = [];
  const statuses: string[] = [];
  return { log, statuses, result: loadCatalog(on, over, new Map([["page-guid", "Inventory policy"]]),
    { status: line => { statuses.push(line); }, log: line => { log.push(line); } }, signal) };
}

// The read phases after names and line items: module dimensions, item names, saved view layouts and filter line items.
const [LIST, LIST_2, VIEW, VIEW_2, MODULE_3] = ["101000000901", "101000000902", "130000000901", "130000000902", "102000000903"];
const [NORTH, SOUTH, LINE_ITEM, FILTER_ITEM] = ["201000000001", "201000000002", "1901000000001", "1903000000001"];
const candidate = (n: number) => String(102000001000 + n);
/** A module of the model's list that the model does not name for a filtered dimension, by its place in the list. */
const other = (n: number) => String(102000002000 + n);
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

// Filter rules whose items are stored as IDs. A list's items share an entity type, the digits before the last nine, and
// its top level item is its item zero. Role is formatted as the list Roles, which no grid shows.
const [REGIONS, ROLES, STAFFING, ROLE, STATUS] = ["101000000912", "101000000911", "102000000905", "1901000000011", "1901000000012"];
const ITEM = (type: number, index: number) => `${type}${String(index).padStart(9, "0")}`;
const rule = (selected: string[], values: unknown[], operator = "EQUALS") => ({ operator, values, selectedItems: selected.map(id => ({ kind: "unknown", id })) });
/** A grid of the module, with Product on rows and Time on columns, whose rows are filtered by the rules. */
const ruled = (...rules: unknown[]) => [{ cards: [{ id: "card-1", type: "TABLE", grid: { regions: [{ region: "SINGLE", module: { kind: "module", id: MODULE },
  rows: { dimensions: [{ dimension: { kind: "dimension", id: LIST } }], filter: { operator: "AND", match: "all", conditions: rules, groups: [] } },
  columns: { dimensions: [{ dimension: { kind: "dimension", id: "20000000003" } }] } }] } }], references: [{ kind: "module", id: MODULE }] }] as unknown as UxPageCardDetails[];
const listFormat = (list: string) => ({ lineItemInfo: { format: { dataType: "ENTITY", hierarchyEntityLongId: Number(list) } } });
/** The answer to a read of item labels: these entries, or of the items asked for, those a dimension has. */
const selection = (...items: [id: string, label: string][]) => (id: string) => update(id, { data: items.map(([itemId, label], index) => ({ itemId, label, index })) });
const labels = (has: Record<string, string>) => (id: string, asked: Any) => update(id, { data: (asked.itemIds as string[]).flatMap(itemId => (has[itemId] ? [{ itemId, label: has[itemId] }] : [])) });

/** One host's model data service: each SEND is answered by its destination (and, where the answer depends on it, by what
 * it asks for), or with no data. */
function serveModel(answers: Record<string, (id: string, asked: Any) => string> = {}) {
  ScriptedSocket.reply = (socket, frame) => {
    if (frame.command === "CONNECT") { socket.serve(CONNECTED); return; }
    if (frame.command !== "SEND") return;
    const { destination, id } = frame.headers;
    socket.serve(answers[destination]?.(id, JSON.parse(frame.body || "{}")) ?? update(id, { data: [] }));
  };
}
const sent = (command: string) => ScriptedSocket.sockets.flatMap(socket => socket.frames).filter(frame => frame.command === command);
const destinations = () => sent("SEND").map(frame => frame.headers.destination);
/** The model's list of modules: the grid's own, then these. */
const moduleList = (modules: readonly string[]) => (id: string) => update(id, { data: [MODULE, ...modules].map(module => ({ id: Number(module), name: `Module ${module}`, views: [] })), dimensions: {} });
/** The modules whose line items were asked for after the grid's own, in the order they were asked. */
const searched = () => destinations().flatMap(destination => /\/modules\/(\d+)\/lineItems$/.exec(destination)?.[1] ?? []).filter(module => module !== MODULE);
/** Makes the model slow: its answer to each read that `slow` picks comes only after `wait`. */
function slowly(slow: (destination: string) => boolean, wait: number) {
  const reply = ScriptedSocket.reply;
  ScriptedSocket.reply = (socket, frame) => {
    if (frame.command === "SEND" && slow(frame.headers.destination)) setTimeout(() => reply(socket, frame), wait); else reply(socket, frame);
  };
}
/** A read of line items that the search makes: of any module but the grid's own. */
const ofTheSearch = (destination: string) => destination.endsWith("/lineItems") && destination !== at(`/modules/${MODULE}/lineItems`);
/** Makes the model slow to list line items: those of each module but the grid's own are answered only after `wait`. */
const slowLineItems = (wait: number) => slowly(ofTheSearch, wait);
/** Every read that was asked for was also ended: unsubscribed from, when it was answered or given up. (All but the watch
 * on the model's status, which lasts as long as the socket.) */
const everyReadEnded = () => {
  const ended = new Set(sent("UNSUBSCRIBE").map(frame => frame.headers.id));
  return sent("SUBSCRIBE").filter(frame => frame.headers.destination !== at("")).every(frame => ended.has(frame.headers.id));
};

describe("Page analyzer name loading against the live socket behaviour", () => {
  beforeEach(() => {
    // Each test is a tab that has not seen the model yet: its first socket starts on the page's host.
    forgetModelHosts();
    ScriptedSocket.sockets = [];
    ScriptedSocket.closing = fire => { setTimeout(fire, 0); };
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

    // The import names are asked of the model's own host first, where the redirect sent the socket: cross-origin, so the
    // XSRF cookie is not echoed (it is only to the page's own origin).
    const fetch = vi.mocked(globalThis.fetch);
    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`https://${MODEL_HOST}/a/collaboration-actions-service/workspaces/${WS}/models/${MODEL}/imports`);
    expect(init).toMatchObject({ method: "GET", credentials: "include", mode: "cors", redirect: "error" });
    expect(init.headers).toMatchObject({ "X-TracePath": "springboard-ui" });
    expect(init.headers).not.toHaveProperty("X-XSRF-TOKEN");

    // Read-only on both connections: subscriptions, update-subscription and disconnects only.
    const sent = ScriptedSocket.sockets.flatMap(socket => socket.frames);
    expect(new Set(sent.map(frame => frame.command))).toEqual(new Set(["CONNECT", "SUBSCRIBE", "SEND", "UNSUBSCRIBE", "DISCONNECT"]));
    expect(sent.filter(frame => frame.command === "SEND").every(frame => frame.headers["action-type"] === "update-subscription")).toBe(true);
  });

  it("reads import names from the model's own host first, from the page's when the model's refuses, and reports a lookup that failed everywhere", async () => {
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
    expect(calls.map(([url]) => new URL(url).host)).toEqual([MODEL_HOST]);
    expect(calls[0][1]).toMatchObject({ method: "GET", mode: "cors", credentials: "include", redirect: "error" });
    expect(calls[0][1].headers).not.toHaveProperty("X-XSRF-TOKEN"); // the XSRF cookie is echoed only to the page's own origin

    // Where the model's host refuses, the page's own is asked, same-origin, with the XSRF cookie echoed.
    ScriptedSocket.sockets = [];
    vi.stubGlobal("fetch", answer(FIRST));
    const fallback = await run().result;
    expect(fallback.catalog.actions.get("112000000901")).toBe("Import demand");
    const asked = vi.mocked(globalThis.fetch).mock.calls as [string, RequestInit][];
    expect(asked.map(([url]) => new URL(url).host)).toEqual([MODEL_HOST, FIRST]);
    expect(asked[1][1]).toMatchObject({ method: "GET", mode: "same-origin" });
    expect(asked[1][1].headers).toMatchObject({ "X-XSRF-TOKEN": "xsrf-value" });

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
      // Each host in a tab of its own, which has not seen the model sent anywhere.
      forgetModelHosts();
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

  it("reads imports, exports and processes in that order, the model's host before the page's after a redirect, after the socket's notes", async () => {
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
    expect(vi.mocked(globalThis.fetch).mock.calls.map(([url]) => url)).toEqual([`https://${MODEL_HOST}${path}/imports`, `https://${MODEL_HOST}${path}/exports`,
      `https://${FIRST}${path}/exports`, `https://${MODEL_HOST}${path}/processes`]);
    expect([...catalog.actions]).toEqual([["112000000901", "Import demand"], ["118000000901", "Nightly load"]]);
    expect(failedActionTypes).toEqual(["EXPORT"]);
    expect(notes).toEqual(["Synthetic model: list names were not available (LISTS_UNAVAILABLE).",
      "Synthetic model: could not read the model's exports (HTTP_ERROR (HTTP 403)); their buttons show the card label."]);
    const totals = "Synthetic model: 0 modules, 0 saved views, 0 dimensions, 0 line items (1 modules read), 2 actions";
    // The page's host is not asked for the processes, which refuses a model it does not serve with a network error.
    expect(log.filter(line => line.startsWith("Synthetic model: "))).toEqual([
      `Synthetic model: 1 imports named (from ${MODEL_HOST})`,
      `Synthetic model: exports from ${MODEL_HOST} answered HTTP_ERROR (HTTP 403)`,
      `Synthetic model: exports from ${FIRST} answered HTTP_ERROR (HTTP 500)`,
      `Synthetic model: 1 processes named (from ${MODEL_HOST})`,
      totals]);
    expect(log.at(-1)).toBe(totals);
    // Before the totals, how long each step took, and the model's names in all.
    expect(log.at(-2)?.replace(/\d+\.\d\d s/g, "… s")).toBe("Time: connection … s, module and list names … s, line items … s, module dimensions … s, item names … s, "
      + "saved views … s, filter line items … s, filter item names … s, dimension names … s, action names … s; names of Synthetic model in all … s");
  });

  it("starts a later run in the tab on the host the model data service sent the model to, and asks nobody else first", async () => {
    // The first host sends the model to its own; the model's host answers everything with no data.
    ScriptedSocket.reply = (socket, frame) => {
      if (frame.command === "CONNECT") socket.serve(CONNECTED);
      else if (frame.command === "SEND" && frame.headers.destination === at("") && socket.host === FIRST) {
        socket.serve(`ERROR\n\n${JSON.stringify({ error: "REDIRECTION_REQUIRED", fqdn: MODEL_HOST })}\0`);
      } else if (frame.command === "SEND") socket.serve(update(frame.headers.id, { data: [] }));
    };
    const first = run();
    await first.result;
    expect(ScriptedSocket.sockets.map(socket => socket.host)).toEqual([FIRST, MODEL_HOST]);
    // The next run of the same model goes to the model's host at once, and says so; nothing is redirected.
    ScriptedSocket.sockets = [];
    const next = run();
    await next.result;
    expect(ScriptedSocket.sockets.map(socket => socket.host)).toEqual([MODEL_HOST]);
    expect(next.log.filter(line => /^(asking|redirected)/.test(line))).toEqual([`asking ${MODEL_HOST} first: the model data service sent this model there before`]);
    // Another model of the tab starts on the page's host, as any model does that the tab has not seen sent elsewhere.
    ScriptedSocket.sockets = [];
    await run(pages, { ...scope, modelId: "0123456789ABCDEF0123456789ABCDEF" }).result;
    expect(ScriptedSocket.sockets.map(socket => socket.host)).toEqual([FIRST]);
    // A tab that has just been opened has not seen it, and starts on the page's host again.
    forgetModelHosts();
    ScriptedSocket.sockets = [];
    await run().result;
    expect(ScriptedSocket.sockets.map(socket => socket.host)).toEqual([FIRST, MODEL_HOST]);
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
    // A saved view is asked for as Page Builder asks for a grid card's: as an Anaplan grid's data source, by its ID, in this model.
    const viewBody = (view: string) => ({ dataSourceType: "ANAPLAN_GRID", dataSourceId: view, modelId: MODEL, workspaceId: WS,
      clientQueryOptions: { useCellIdTemplate: false, canHandleDedupedAuxData: false, canHandleNullColumnWidths: false }, transforms: [] });
    expect(sent("SEND").map(frame => [frame.headers.destination, JSON.parse(frame.body)])).toEqual([
      [at(""), {}], [MODULE_VIEWS, {}], [at("/lists"), {}], [at(`/modules/${MODULE}/lineItems`), {}], [at("/dimensions"), { moduleIds: [MODULE] }],
      [at(`/modules/${MODULE}/dimensions/${LIST}`), { itemIds: [NORTH, SOUTH], filter: "" }], [at(`/views/${VIEW}`), viewBody(VIEW)], [at(`/views/${VIEW_2}`), viewBody(VIEW_2)],
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

  it(`reads the first ${VIEW_TRIAL} saved views before the others, and asks none of the others when each of those is refused and none answers`, async () => {
    const views = Array.from({ length: VIEW_TRIAL + 3 }, (_, index) => String(130000000901 + index));
    const viewRefs = views.map(id => ({ kind: "view", id }));
    // Every view is refused, as a live run had all 233 refused (10 Oct 2026).
    serveModel(Object.fromEntries(views.map(view => [at(`/views/${view}`), (id: string) => rejected(id, "VIEW_UNAVAILABLE")])));
    const refusedAll = run(withGrid(...viewRefs));
    const { notes } = await refusedAll.result;
    expect(destinations().filter(destination => destination.includes("/views/"))).toEqual(views.slice(0, VIEW_TRIAL).map(view => at(`/views/${view}`)));
    expect(refusedAll.log.filter(line => line.startsWith("saved view layouts"))).toEqual([`saved view layouts: the first ${VIEW_TRIAL} were refused (VIEW_UNAVAILABLE), so the other 3 were not asked`]);
    expect(notes).toContain(`Synthetic model: ${views.length} of ${views.length} saved views' rows, columns and context selectors could not be read: the service refused the first ${VIEW_TRIAL}, so the others were not asked.`);

    // One of the first that answers shows that the others may: every view is asked.
    ScriptedSocket.sockets = [];
    serveModel(Object.fromEntries(views.map((view, index) => [at(`/views/${view}`), (id: string) => (index === VIEW_TRIAL - 1
      ? metadata(id, { rows: [{ dimensionId: LIST, label: "Product" }], cols: [] }) : rejected(id, "VIEW_UNAVAILABLE"))])));
    const oneAnswers = run(withGrid(...viewRefs));
    const answered = await oneAnswers.result;
    expect(destinations().filter(destination => destination.includes("/views/"))).toHaveLength(views.length);
    expect(oneAnswers.log.filter(line => line.startsWith("saved view layouts"))).toEqual([]);
    expect(answered.notes).toContain(`Synthetic model: ${views.length - 1} of ${views.length} saved views' rows, columns and context selectors could not be read.`);
  });

  it("reads no saved view's layout for a model's run, whose tables show none, and says so", async () => {
    serveModel({ [at(`/views/${VIEW}`)]: id => metadata(id, { rows: [{ dimensionId: LIST, label: "Product" }], cols: [] }) });
    const log: string[] = [];
    const { catalog, notes } = await loadCatalog(scope, withGrid({ kind: "view", id: VIEW }), new Map(), { status: () => undefined, log: line => { log.push(line); } },
      undefined, undefined, { viewLayouts: false });
    expect([destinations().filter(destination => destination.includes("/views/")), catalog.viewLayouts.size, notes]).toEqual([[], 0, []]);
    expect(log).toContain("saved views: their rows, columns and context selectors are not read, as no table of a model's run shows them");
    expect(log.find(line => line.startsWith("Time: "))).not.toContain("saved views");
  });

  it("asks for the model's names of modules and lists at once, and waits for the pages and the export for the other steps, saying how long it waited", async () => {
    serveModel({
      [MODULE_VIEWS]: id => update(id, { data: [{ id: Number(MODULE), name: "Demand", views: [] }], dimensions: {} }),
      [at(`/modules/${MODULE}/lineItems`)]: id => update(id, { data: [{ lineItemId: LINE_ITEM, lineItemLabel: "Volume" }] }),
    });
    let give: (inputs: CatalogInputs) => void = () => undefined;
    const log: string[] = [];
    const loading = loadCatalogWhen(scope, new Promise<CatalogInputs>(resolve => { give = resolve; }), { status: () => undefined, log: line => { log.push(line); } });
    await vi.waitFor(() => expect(destinations()).toEqual([at(""), MODULE_VIEWS, at("/lists")]));
    // Nothing more is asked until the pages and the export have come.
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(destinations()).toEqual([at(""), MODULE_VIEWS, at("/lists")]);
    give({ pages, pageNames: new Map([["page-guid", "Inventory policy"]]) });
    const { catalog, notes } = await loading;
    expect([notes, catalog.modules.get(MODULE), catalog.lineItems.get(LINE_ITEM), catalog.pages.get("page-guid")]).toEqual([[], "Demand", { name: "Volume", moduleId: MODULE }, "Inventory policy"]);
    expect(destinations().slice(3)).toEqual([at(`/modules/${MODULE}/lineItems`)]);
    expect(log.find(line => line.startsWith("Time: "))?.replace(/\d+\.\d\d s/g, "… s")).toBe("Time: connection … s, module and list names … s, waiting for the pages and the export … s, "
      + "line items … s, module dimensions … s, item names … s, saved views … s, filter line items … s, filter item names … s, dimension names … s, action names … s; "
      + "names of Synthetic model in all … s");
  });

  it("ends the names' work when their inputs never come, as when the run's export failed: the socket is closed, and no action name is read", async () => {
    serveModel({});
    let fail: (reason: unknown) => void = () => undefined;
    const loading = loadCatalogWhen(scope, new Promise<CatalogInputs>((_, reject) => { fail = reject; }), { status: () => undefined, log: () => undefined });
    await vi.waitFor(() => expect(destinations()).toEqual([at(""), MODULE_VIEWS, at("/lists")]));
    fail(new Error("the export failed"));
    await expect(loading).rejects.toThrow("the export failed");
    await vi.waitFor(() => expect(ScriptedSocket.sockets.every(socket => socket.readyState === 3)).toBe(true));
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("starts the socket on the host of the frame the model is read in, the model's own, and on the page's where that host cannot be reached", async () => {
    // The page's host would send the model on to its own, as it did live on every first run (10 Oct 2026).
    const frame = { host: MODEL_HOST, unreachable: false, redirects: true };
    ScriptedSocket.reply = (socket, frame_) => {
      if (frame_.command === "CONNECT") {
        if (socket.host === MODEL_HOST && frame.unreachable) socket.close(1006);
        else socket.serve(CONNECTED);
      } else if (frame_.command === "SEND" && frame_.headers.destination === at("") && socket.host === FIRST && frame.redirects) {
        socket.serve(`ERROR\n\n${JSON.stringify({ error: "REDIRECTION_REQUIRED", fqdn: MODEL_HOST })}\0`);
      } else if (frame_.command === "SEND") socket.serve(update(frame_.headers.id, { data: [] }));
    };
    const names = (frameHost?: () => string | undefined) => {
      const log: string[] = [];
      return { log, result: loadCatalogWhen(scope, Promise.resolve({ pages, pageNames: new Map() }), { status: () => undefined, log: line => { log.push(line); } }, undefined, { frameHost }) };
    };
    const framed = names(() => frame.host);
    await framed.result;
    expect(ScriptedSocket.sockets.map(socket => socket.host)).toEqual([MODEL_HOST]);
    expect(framed.log.filter(line => /^(asking|redirected|the model data service)/.test(line))).toEqual([`asking ${MODEL_HOST} first: the model's frame is there`]);
    // The import names are asked of the model's host first, where the socket settled.
    expect(vi.mocked(globalThis.fetch).mock.calls.map(([url]) => new URL(String(url)).host)).toEqual([MODEL_HOST]);

    // The frame's host cannot be reached: the page's is asked, as before, and here serves the model itself.
    forgetModelHosts();
    ScriptedSocket.sockets = [];
    [frame.unreachable, frame.redirects] = [true, false];
    const fellBack = names(() => frame.host);
    await fellBack.result;
    expect(ScriptedSocket.sockets.map(socket => socket.host)).toEqual([MODEL_HOST, FIRST]);
    expect(fellBack.log.filter(line => /^(asking|redirected|the model data service)/.test(line))).toEqual([`asking ${MODEL_HOST} first: the model's frame is there`,
      `the model data service on ${MODEL_HOST} could not be reached (Connection closed (code 1006).): asking ${FIRST}`]);

    // A frame on the page's own host, or on a host that is not Anaplan's, changes nothing: the page's host is asked.
    for (const host of [FIRST, "frame.example.com", undefined]) {
      forgetModelHosts();
      ScriptedSocket.sockets = [];
      [frame.unreachable, frame.redirects] = [false, true];
      await names(() => host).result;
      expect(ScriptedSocket.sockets.map(socket => socket.host)[0], String(host)).toBe(FIRST);
    }
  });

  describe("a dimension no answer names", () => {
    // The page synced a hidden context selector to the card for a list that is no dimension of the card's module, so the
    // module's dimensions do not name it (seen live, 7 Oct 2026).
    const SYNCED = "101000000913";
    const synced = { kind: "dimension", id: SYNCED };
    const selectorPage = (card: Record<string, unknown> = {}, references: unknown[] = []) => [{
      pageContext: { contextSelectors: [{ dimension: synced, visible: true, syncedToPage: true }] },
      cards: [{ id: "card-1", type: "TABLE", contextSelectors: [{ dimension: synced, visible: false, syncedToPage: true }],
        grid: { regions: [{ region: "SINGLE", module: { kind: "module", id: MODULE }, rows: { dimensions: [{ dimension: { kind: "dimension", id: LIST } }] },
          columns: { dimensions: [{ dimension: { kind: "dimension", id: "20000000012" } }] },
          pivot: { rows: [{ kind: "dimension", id: LIST }], columns: [{ kind: "dimension", id: "20000000012" }],
            pages: [{ dimension: synced, source: "contextSelector", visible: false, syncedToPage: true }] } }] }, ...card }],
      references: [{ kind: "module", id: MODULE }, { kind: "dimension", id: LIST }, { kind: "dimension", id: "20000000012" }, synced, ...references],
    }] as unknown as UxPageCardDetails[];
    /** The model's answers before this step: the module and its one list, which the module's dimensions name too. */
    const named = (more: Record<string, (id: string, asked: Any) => string> = {}) => serveModel({
      [at("")]: id => update(id, { status: "UNKNOWN" }),
      [MODULE_VIEWS]: id => update(id, { data: [{ id: Number(MODULE), name: "Demand", views: [] }], dimensions: {} }),
      [at("/lists")]: id => update(id, { data: [{ id: LIST, name: "Product" }] }),
      [at("/dimensions")]: id => update(id, { modules: { [MODULE]: { dimensions: [{ id: LIST, label: "Product" }] } } }),
      ...more,
    });
    const after = (destination: string) => sent("SEND").map(frame => [frame.headers.destination, JSON.parse(frame.body)]).slice(destinations().indexOf(destination) + 1);

    it("looks for it among the lists with their subsets, after every other read, and asks nothing more once they name it", async () => {
      named({ [at("/lists?subsets=true")]: id => update(id, { data: [{ id: LIST, name: "Product" }, { id: Number(SYNCED), name: "Organization" }] }) });
      const { log, statuses, result } = run(selectorPage());
      const { catalog, notes } = await result;

      expect(notes).toEqual([]);
      expect(after(at("/dimensions"))).toEqual([[at("/lists?subsets=true"), {}]]);
      expect(catalog.dimensions.get(SYNCED)).toBe("Organization");
      expect(statuses.at(-1)).toBe("Reading dimension names in Synthetic model…");
      expect(log.filter(line => /^(module views:|lists|dimension names|dimension \d)/.test(line))).toEqual(["module views: 1 modules, 0 dimensions labelled", "lists: 1 entries of {id, name}",
        "lists with subsets: 2 entries of {id, name}", "dimension names: 1 of 1 named"]);
      expect(everyReadEnded()).toBe(true);
    });

    it("asks which modules have it when the lists do not name it, and reads their dimensions, which label it", async () => {
      named({
        [at("/applicableModules")]: id => update(id, { data: [{ id: Number(MODULE_3), label: "Org settings" }] }),
        [at("/dimensions")]: (id, asked) => update(id, { modules: (asked.moduleIds as string[]).includes(MODULE_3)
          ? { [MODULE_3]: { dimensions: [{ id: SYNCED, label: "Organization" }] } } : { [MODULE]: { dimensions: [{ id: LIST, label: "Product" }] } } }),
      });
      const { log, result } = run(selectorPage());
      const { catalog } = await result;

      expect(after(at("/lists?subsets=true"))).toEqual([[at("/applicableModules"), { dimensions: [101000000913] }], [at("/dimensions"), { moduleIds: [MODULE_3] }]]);
      expect(catalog.dimensions.get(SYNCED)).toBe("Organization");
      expect(catalog.modules.get(MODULE_3)).toBe("Org settings");
      expect(log.filter(line => /^(lists with|modules with|dimensions of 1 modules that|dimension names)/.test(line))).toEqual(["lists with subsets: 0 entries",
        `modules with dimension ${SYNCED}: ${MODULE_3}`, "dimensions of 1 modules that have an unnamed dimension: 1 read", "dimension names: 1 of 1 named"]);
    });

    it("logs, for each one still unnamed, how the cards use it and which answers hold its ID, without a name or a value", async () => {
      // The module views listing holds the ID with no label: it is there, and was read as nothing.
      named({ [MODULE_VIEWS]: id => update(id, { data: [{ id: Number(MODULE), name: "Demand", views: [] }], dimensions: { [SYNCED]: {} } }) });
      const { log, result } = run(selectorPage({ savedCustomizations: { branchSync: [{ dimension: synced, enabled: true }] } }));
      const { catalog } = await result;

      expect(catalog.dimensions.has(SYNCED)).toBe(false);
      expect(after(at("/lists?subsets=true"))).toEqual([[at("/applicableModules"), { dimensions: [101000000913] }]]);
      expect(log.filter(line => /^(modules with|dimension names|dimension \d)/.test(line))).toEqual([`modules with dimension ${SYNCED}: none`, "dimension names: 0 of 1 named",
        `dimension ${SYNCED} has no name: a context selector of 1 cards (1 synced to the page), on the rows or columns of 0, in the branch sync of 1, `
        + "a selector of 1 pages; its ID is in the answers of lists: no, lists with subsets: no, module views: yes, module dimensions: no; modules that have it: 0"]);
    });

    it("logs a read of this step that is refused and goes on to the next; a dimension still unnamed keeps its ID", async () => {
      named({ [at("/lists?subsets=true")]: id => rejected(id, "LISTS_UNAVAILABLE"), [at("/applicableModules")]: id => rejected(id, "MODULES_UNAVAILABLE") });
      const { log, result } = run(selectorPage());
      const { catalog, notes } = await result;

      expect(notes).toEqual([]);
      expect(catalog.dimensions.has(SYNCED)).toBe(false);
      expect(log.filter(line => /^(lists with|modules with|dimension names|dimension \d)/.test(line))).toEqual(["lists with subsets: LISTS_UNAVAILABLE",
        `modules with dimension ${SYNCED}: MODULES_UNAVAILABLE`, "dimension names: 0 of 1 named",
        `dimension ${SYNCED} has no name: a context selector of 1 cards (1 synced to the page), on the rows or columns of 0, in the branch sync of 0, `
        + "a selector of 1 pages; its ID is in the answers of lists: no, lists with subsets: no answer, module views: no, module dimensions: no; modules that have it: not asked"]);
    });

    it("names it from the branch of a hierarchy that a saved view's metadata filters by, and then asks nothing more for it", async () => {
      named({ [at(`/views/${VIEW}`)]: id => metadata(id, { rows: [{ dimensionId: LIST, label: "Product" }], cols: [],
        contextFilters: [{ parent: SYNCED, label: "Organization", contextFilterType: "BRANCH_SYNC" }] }) });
      const { result } = run(selectorPage({}, [{ kind: "view", id: VIEW }]));
      const { catalog } = await result;

      expect(catalog.dimensions.get(SYNCED)).toBe("Organization");
      expect(catalog.viewLayouts.get(VIEW)).toEqual({ rows: [{ id: LIST, name: "Product" }], columns: [], pages: [] });
      expect(destinations()).not.toContain(at("/lists?subsets=true"));
      expect(destinations()).not.toContain(at("/applicableModules"));
    });

    it("gives a read ten seconds and all of them thirty, and asks nothing more after two reads that went unanswered", async () => {
      const others = ["101000000914", "101000000915", "101000000916"];
      const more = others.map(id => ({ kind: "dimension", id }));
      const timedOut = (id: string) => `modules with dimension ${id}: Timed out waiting for ${at("/applicableModules")}.`;
      const steps = (log: string[]) => log.filter(line => /^(modules with|dimension names)/.test(line));
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });

      // The model never says which modules have a dimension: after two questions that went unanswered no third is asked.
      named({ [at("/applicableModules")]: () => "" });
      const silent = run(selectorPage({}, more));
      let outcome: unknown = "reading";
      silent.result.then(done => { outcome = done.notes; }, error => { outcome = error; });
      await vi.advanceTimersByTimeAsync(19_999);
      expect([outcome, after(at("/lists?subsets=true")).length]).toEqual(["reading", 2]);
      await vi.advanceTimersByTimeAsync(101);
      expect([outcome, after(at("/lists?subsets=true")).length]).toEqual([[], 2]);
      expect(steps(silent.log)).toEqual([timedOut(SYNCED), timedOut(others[0]), "dimension names: 0 of 4 named",
        "dimension names: two reads went unanswered, no more were made"]);
      // Each dimension still has its line, which says it was not asked about to the end.
      expect(silent.log.filter(line => /^dimension \d/.test(line)).map(line => line.split("; ").at(-1))).toEqual(Array(4).fill("modules that have it: not asked"));

      // The model answers each question after nine seconds: the fourth is given up when the thirty seconds are over, and
      // a read given up so is not one that went unanswered.
      ScriptedSocket.sockets = [];
      named();
      slowly(destination => destination === at("/applicableModules"), 9_000);
      const slow = run(selectorPage({}, more));
      await vi.advanceTimersByTimeAsync(30_100);
      expect((await slow.result).notes).toEqual([]);
      expect(after(at("/lists?subsets=true")).length).toBe(4);
      expect(steps(slow.log)).toEqual([...[SYNCED, ...others.slice(0, 2)].map(id => `modules with dimension ${id}: none`), timedOut(others[2]),
        "dimension names: 0 of 4 named", "dimension names: the 30 seconds allowed for them ran out"]);
      vi.useRealTimers();
    });

    it("does not begin after the model reported itself closed: it shows no step and asks nothing", async () => {
      let status = "";
      named({ [at("")]: id => { status = id; return update(id, { status: "UNKNOWN" }); },
        // The model gives the module's dimensions and reports itself closed in the same breath.
        [at("/dimensions")]: id => update(id, { modules: { [MODULE]: { dimensions: [{ id: LIST, label: "Product" }] } } }) + update(status, { status: "CLOSED" }) });
      const { statuses, result } = run(selectorPage());
      const { notes } = await result;
      await new Promise(resolve => { setTimeout(resolve, 20); });

      expect(notes).toEqual(["Synthetic model: names from the model data service were not available (the model is closed); IDs are shown instead."]);
      expect(destinations().at(-1)).toBe(at("/dimensions"));
      expect(statuses).not.toContain("Reading dimension names in Synthetic model…");
    });

    it("ends the socket work at once when the connection fails while it is looked for", async () => {
      for (const [failing, logged] of [[at("/lists?subsets=true"), []], [at("/applicableModules"), ["lists with subsets: 0 entries"]]] as const) {
        ScriptedSocket.sockets = [];
        named({ [failing]: () => SERVICE_DOWN });
        const { log, result } = run(selectorPage());
        const { notes } = await result;
        expect(notes, failing).toEqual([UNAVAILABLE]);
        expect(destinations().at(-1), failing).toBe(failing);
        expect(log.filter(line => /^(lists with|modules with|dimension names|dimension \d)/.test(line)), failing).toEqual(logged);
      }
    });
  });

  it("stops a later read that is still waiting when the model closes, and handles the stop by that phase's own rule", async () => {
    const closed = "the model is closed";
    const ended = `Synthetic model: names from the model data service were not available (${closed}); IDs are shown instead.`;
    const viewLayout = (id: string) => metadata(id, { rows: [{ dimensionId: LIST, label: "Product" }], cols: [] });
    // Module dimensions log the stop as they log a refused read and go on, and the work ends at the next step that would
    // read: its read is not sent, for nothing is asked of a model once the work has ended. (The read of the item names used
    // to go out before the work ended.) Item names, saved views and the filtered dimension's modules end it at once.
    for (const [waiting, notes, last, logged] of [
      [at("/dimensions"), [`Synthetic model: module dimensions were not available (${closed}); context selectors show only those saved on the page.`, ended],
        at("/dimensions"), [`module dimensions: ${closed}`]],
      [at(`/modules/${MODULE}/dimensions/${LIST}`), [ended], at(`/modules/${MODULE}/dimensions/${LIST}`), []],
      [at(`/views/${VIEW}`), [ended], at(`/views/${VIEW}`), []],
      [at("/applicableModules"), [ended], at("/applicableModules"), []],
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

  it("sends nothing more once the model has reported itself closed, whichever step would read next", async () => {
    const ended = "Synthetic model: names from the model data service were not available (the model is closed); IDs are shown instead.";
    const unavailable = "Synthetic model: module dimensions were not available (the model is closed); context selectors show only those saved on the page.";
    const dimensions = (id: string) => update(id, { modules: { [MODULE]: { dimensions: [{ id: LIST, label: "Product" }] } } });
    /** A grid of the module in which no item is shown or hidden, filtered by these rules; and what else the cards use. */
    const grid = (rules: unknown[], ...references: unknown[]) => [{ cards: ruled(...rules)[0].cards, references: [{ kind: "module", id: MODULE }, ...references] }] as unknown as UxPageCardDetails[];
    // After the grid's dimensions, the next read is a saved view's layout; or, with a rule that has its line item (the
    // grid's own) and a context item, the name of that item, which the last step asks the module's dimension for.
    const [savedView, contextItem] = [grid([], { kind: "view", id: VIEW }), grid([rule([ITEM(358, 2), LINE_ITEM], ["true"])])];
    const answers = { [at(`/modules/${MODULE}/lineItems`)]: (id: string) => update(id, { data: [{ lineItemId: LINE_ITEM, lineItemLabel: "Volume" }] }),
      [at(`/views/${VIEW}`)]: (id: string) => metadata(id, { rows: [{ dimensionId: LIST, label: "Product" }], cols: [] }) };
    let [status, closedAt] = ["", -1];
    for (const [pages, answer, notes] of [
      // The model reports itself closed where the grid's dimensions are asked for: that step logs it as a refused read and
      // goes on.
      [savedView, () => "", [unavailable, ended]],
      // The model gives the grid's dimensions and reports itself closed in the same breath: that step has its answer.
      [savedView, dimensions, [ended]],
      [contextItem, dimensions, [ended]],
    ] as const) {
      ScriptedSocket.sockets = [];
      serveModel({ ...answers, [at("")]: id => { status = id; return update(id, { status: "UNKNOWN" }); },
        [at("/dimensions")]: id => { closedAt = sent("SEND").length; return answer(id) + update(status, { status: "CLOSED" }); } });
      const done = await run(pages).result;
      await new Promise(resolve => { setTimeout(resolve, 20); });
      expect([done.notes, destinations().slice(closedAt)]).toEqual([notes, []]);
    }
    // (A model that stays open is asked for the saved view's layout, and for the context item.)
    for (const [pages, asked] of [[savedView, at(`/views/${VIEW}`)], [contextItem, at(`/modules/${MODULE}/dimensions/${LIST}`)]] as const) {
      ScriptedSocket.sockets = [];
      serveModel({ ...answers, [at("/dimensions")]: dimensions });
      expect((await run(pages).result).notes).toEqual([]);
      expect(destinations().at(-1)).toBe(asked);
    }
  });

  it("ends the socket work at once when the run is stopped, closes the socket and reads no action names", async () => {
    const stopped = new Error("Stopped: the results page was closed.");
    // The read that is waiting is never answered: the run is stopped while it waits, in each phase in turn. Module and list
    // names are asked for together, so the lists are the last read sent when the module names are the one that waits.
    for (const [waiting, last] of [[MODULE_VIEWS, at("/lists")], ...[at(`/modules/${MODULE}/lineItems`), at("/dimensions"), at(`/modules/${MODULE}/dimensions/${LIST}`),
      at(`/views/${VIEW}`), at("/applicableModules")].map(destination => [destination, destination])]) {
      ScriptedSocket.sockets = [];
      vi.mocked(globalThis.fetch).mockClear();
      const stopping = new AbortController();
      // A saved view's layout arrives as metadata; the read that waits is the one that stops the run.
      serveModel({ [at(`/views/${VIEW}`)]: id => metadata(id, { rows: [{ dimensionId: LIST, label: "Product" }], cols: [] }),
        [waiting]: () => { stopping.abort(stopped); return ""; } });
      const started = Date.now();
      const { log, result } = run(withGrid({ kind: "view", id: VIEW }, { kind: "action", id: "112000000901", actionType: "IMPORT" }), scope, stopping.signal);
      // The stop itself, not a note that names were not available.
      await expect(result, waiting).rejects.toBe(stopped);
      expect(Date.now() - started, waiting).toBeLessThan(5_000);
      expect(destinations().at(-1), waiting).toBe(last);
      expect(sent("DISCONNECT"), waiting).toHaveLength(1);
      expect(ScriptedSocket.sockets.map(socket => socket.readyState), waiting).toEqual([3]);
      expect(globalThis.fetch, waiting).not.toHaveBeenCalled();
      expect(log.filter(line => /imports|stopped/.test(line)), waiting).toEqual([]);
    }

    // Without a stop the same run reads its names and the import's name, as before.
    ScriptedSocket.sockets = [];
    serveModel();
    expect((await run(pages, scope, new AbortController().signal).result).catalog.actions.get("112000000901")).toBe("Import demand");
  });

  it("opens no socket for a run that was stopped already, and subscribes to nothing when it is stopped while the socket connects", async () => {
    const stopped = new Error("Stopped: the results page was closed.");
    /** Every frame sent on each socket: its command and, for a subscription or its data request, what it asks the model for. */
    const frames = () => ScriptedSocket.sockets.map(socket => socket.frames.map(({ command, headers: { destination } }) =>
      (destination === undefined ? command : `${command} ${destination.replace(/^core:\/+[^/]*/, "") || "status"}`)));
    /** The run's end, which comes at once, and then long enough for anything it left behind to be sent. `stop` stops the run
     * as soon as it has started. */
    const ended = async (signal: AbortSignal, stop: () => void = () => undefined) => {
      const { result } = run(pages, scope, signal);
      stop();
      let waiting: ReturnType<typeof setTimeout> | undefined;
      const outcome = await Promise.race([result.then(() => "read", (error: unknown) => error),
        new Promise(resolve => { waiting = setTimeout(() => resolve("still running"), 2_000); })]);
      clearTimeout(waiting);
      expect(outcome).toBe(stopped);
      await new Promise(resolve => setTimeout(resolve, 20));
      expect(globalThis.fetch).not.toHaveBeenCalled();
    };

    // Stopped before the names are asked for: subscribing can make Anaplan load the model, so not even a socket is opened.
    serveModel();
    const before = new AbortController();
    before.abort(stopped);
    await ended(before.signal);
    expect(ScriptedSocket.sockets).toEqual([]);

    // Stopped while the socket itself still connects: it is closed at once, before it opens, so not even CONNECT is sent.
    const opening = new AbortController();
    await ended(opening.signal, () => opening.abort(stopped));
    expect(frames()).toEqual([[]]);
    expect(ScriptedSocket.sockets.map(socket => socket.readyState)).toEqual([3]);

    // Stopped after CONNECT, which the service never answers: the socket is closed at once, without waiting half a minute
    // for the answer, with the DISCONNECT every open socket ends on.
    ScriptedSocket.sockets = [];
    const unanswered = new AbortController();
    ScriptedSocket.reply = (_, frame) => { if (frame.command === "CONNECT") unanswered.abort(stopped); };
    await ended(unanswered.signal);
    expect(frames()).toEqual([["CONNECT", "DISCONNECT"]]);
    expect(ScriptedSocket.sockets.map(socket => socket.readyState)).toEqual([3]);

    // Stopped just as the service has answered CONNECT: the socket is closed again, with nothing subscribed.
    ScriptedSocket.sockets = [];
    const connecting = new AbortController();
    ScriptedSocket.reply = (socket, frame) => {
      if (frame.command === "CONNECT") { socket.serve(CONNECTED); connecting.abort(stopped); } else if (frame.command === "SEND") socket.serve(update(frame.headers.id, { data: [] }));
    };
    await ended(connecting.signal);
    expect(frames()).toEqual([["CONNECT", "DISCONNECT"]]);
    expect(ScriptedSocket.sockets.map(socket => socket.readyState)).toEqual([3]);

    // Stopped as the first host answers with a redirect: the redirect is not followed, so the model's own host hears nothing.
    ScriptedSocket.sockets = [];
    const redirected = new AbortController();
    ScriptedSocket.reply = (socket, frame) => {
      if (frame.command === "CONNECT") socket.serve(CONNECTED);
      else if (frame.command === "SEND" && frame.headers.destination === at("")) {
        redirected.abort(stopped);
        socket.serve(`ERROR\n\n${JSON.stringify({ error: "REDIRECTION_REQUIRED", fqdn: MODEL_HOST })}\0`);
      }
    };
    await ended(redirected.signal);
    expect(ScriptedSocket.sockets.map(socket => socket.host)).toEqual([FIRST]);

    // Stopped while the socket to the model's own host connects, after the redirect: that one subscribes to nothing either.
    ScriptedSocket.sockets = [];
    const reconnecting = new AbortController();
    ScriptedSocket.reply = (socket, frame) => {
      if (frame.command === "CONNECT") { if (socket.host === MODEL_HOST) reconnecting.abort(stopped); socket.serve(CONNECTED); }
      else if (frame.command === "SEND" && frame.headers.destination === at("")) socket.serve(`ERROR\n\n${JSON.stringify({ error: "REDIRECTION_REQUIRED", fqdn: MODEL_HOST })}\0`);
    };
    await ended(reconnecting.signal);
    expect(frames()).toEqual([["CONNECT", "SUBSCRIBE status", "SEND status", "SUBSCRIBE /moduleViews", "SEND /moduleViews", "SUBSCRIBE /lists", "SEND /lists"],
      ["CONNECT", "DISCONNECT"]]);
  });

  it("reads no further page, and no names, once the run is stopped", async () => {
    const stopped = new Error("Stopped: the results page was closed.");
    const page = (n: number) => ({ guid: `11111111-2222-3333-4444-55555555555${n}`, name: `Page ${n}`, pageType: "BOARD", hasPublishedVersion: true });
    const stopping = new AbortController();
    // The app record answers; page 1 is not found on any route, and the run is stopped while it is being read.
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const path = new URL(url).pathname;
      if (path.includes("/apps/")) return new Response(JSON.stringify({ name: "Plan", pages: [page(1), page(2), page(3)] }), { status: 200 });
      if (path.endsWith("/boards/11111111-2222-3333-4444-555555555551")) stopping.abort(stopped);
      return new Response("{}", { status: 404 });
    }));
    const statuses: string[] = [];
    await expect(analyseApp("01234567-89ab-cdef-0123-456789abcdef", { status: text => { statuses.push(text); }, log: () => undefined }, () => "", stopping.signal))
      .rejects.toBe(stopped);
    expect(vi.mocked(globalThis.fetch).mock.calls.map(([url]) => new URL(url as string).pathname.split("/").slice(3).join("/"))).toEqual([
      "apps/01234567-89ab-cdef-0123-456789abcdef", "boards/11111111-2222-3333-4444-555555555551", "grid-pages/11111111-2222-3333-4444-555555555551",
      "reports/11111111-2222-3333-4444-555555555551"]);
    expect(statuses).toEqual(["Reading the app…", "Reading page 1 of 3: Page 1"]);
    expect(ScriptedSocket.sockets).toEqual([]);

    // Stopped after its last page: the model's names are not read either.
    const late = new AbortController();
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const path = new URL(url).pathname;
      if (path.includes("/apps/")) return new Response(JSON.stringify({ name: "Plan", pages: [{ ...page(1), guid: guid(1000) }] }), { status: 200 });
      late.abort(stopped);
      return new Response(JSON.stringify(goldenBoard), { status: 200 });
    }));
    await expect(analyseApp("01234567-89ab-cdef-0123-456789abcdef", { status: () => undefined, log: () => undefined }, () => "", late.signal)).rejects.toBe(stopped);
    expect(vi.mocked(globalThis.fetch).mock.calls).toHaveLength(2);
    expect(ScriptedSocket.sockets).toEqual([]);

    // Stopped while its only page is read, and no model's names are left to read: it still ends as a stopped run, with no report.
    const last = new AbortController();
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const path = new URL(url).pathname;
      if (path.includes("/apps/")) return new Response(JSON.stringify({ name: "Plan", pages: [page(1)] }), { status: 200 });
      last.abort(stopped);
      return new Response("{}", { status: 404 });
    }));
    statuses.length = 0;
    await expect(analyseApp("01234567-89ab-cdef-0123-456789abcdef", { status: text => { statuses.push(text); }, log: () => undefined }, () => "", last.signal))
      .rejects.toBe(stopped);
    expect(statuses).toEqual(["Reading the app…", "Reading page 1 of 1: Page 1"]);
  });

  it("ends the socket work of the analysis when it is stopped while a model's names are read, and reads nothing after it", async () => {
    const stopped = new Error("Stopped: the results page was closed.");
    serveGoldenApp();
    const answer = ScriptedSocket.reply;
    const stopping = new AbortController();
    // The run is stopped as the list names are asked for. They are still answered: nothing else ends the work.
    ScriptedSocket.reply = (socket, frame) => {
      if (frame.command === "SEND" && frame.headers.destination === at("/lists")) stopping.abort(stopped);
      answer(socket, frame);
    };
    await expect(analyseApp(GOLDEN_APP, { status: () => undefined, log: () => undefined }, () => "", stopping.signal)).rejects.toBe(stopped);
    // No line items, dimensions or item names are asked for; the socket is closed; the action names are not read.
    expect(destinations()).toEqual([at(""), MODULE_VIEWS, at("/lists")]);
    expect(sent("DISCONNECT")).toHaveLength(1);
    expect(vi.mocked(globalThis.fetch).mock.calls.map(([url]) => new URL(url as string).pathname.split("/")[2]))
      .toEqual(["springboard-definition-service", "springboard-definition-service"]);
  });

  it("reads no further list of action names once the run is stopped, from either host", async () => {
    const stopped = new Error("Stopped: the results page was closed.");
    const three = [{ cards: [], references: [{ kind: "action", id: "112000000901", actionType: "IMPORT" }, { kind: "action", id: "116000000901", actionType: "EXPORT" },
      { kind: "action", id: "118000000901", actionType: "PROCESS" }] }] as unknown as UxPageCardDetails[];
    // The model is served from its own host after a redirect, so each of the three lists is asked of the model's host and
    // then, if that fails, of the page's. The run is stopped while the first read is under way, whether that read answers or
    // fails.
    for (const answered of [200, 500]) {
      ScriptedSocket.sockets = [];
      ScriptedSocket.reply = (socket, frame) => {
        if (frame.command === "CONNECT") socket.serve(CONNECTED);
        else if (frame.command === "SEND" && frame.headers.destination === at("") && socket.host === FIRST) {
          socket.serve(`ERROR\n\n${JSON.stringify({ error: "REDIRECTION_REQUIRED", fqdn: MODEL_HOST })}\0`);
        } else if (frame.command === "SEND") socket.serve(update(frame.headers.id, { data: [] }));
      };
      const stopping = new AbortController();
      vi.stubGlobal("fetch", vi.fn(async () => { stopping.abort(stopped); return new Response("{}", { status: answered }); }));
      const { log, result } = run(three, scope, stopping.signal);
      await expect(result, String(answered)).rejects.toBe(stopped);
      expect(vi.mocked(globalThis.fetch).mock.calls.map(([url]) => url), String(answered))
        .toEqual([`https://${MODEL_HOST}/a/collaboration-actions-service/workspaces/${WS}/models/${MODEL}/imports`]);
      // Nor is the model summed up for the log: the run has ended.
      expect(log.filter(line => line.startsWith("Synthetic model: ")).map(line => line.replace(/^Synthetic model: /, "")), String(answered))
        .toEqual(answered === 200 ? [`0 imports named (from ${MODEL_HOST})`] : [`imports from ${MODEL_HOST} answered HTTP_ERROR (HTTP 500)`]);
    }
    // Not stopped, all three lists are read: from the page's host too where the model's fails.
    ScriptedSocket.sockets = [];
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 500 })));
    await run(three, scope, new AbortController().signal).result;
    expect(vi.mocked(globalThis.fetch).mock.calls.map(([url]) => new URL(url as string).host + new URL(url as string).pathname.replace(/.*\//, "/")))
      .toEqual([`${MODEL_HOST}/imports`, `${FIRST}/imports`, `${MODEL_HOST}/exports`, `${FIRST}/exports`, `${MODEL_HOST}/processes`, `${FIRST}/processes`]);
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

  describe("with the line items the model's export read", () => {
    const UNITS = "1901000000002";
    /** The export's line items: Units in the grid's module, the rule's line item in a module no card shows, and a module
     * with no line items. */
    const exported = (): ExportedLineItems => ({
      lineItems: [{ id: UNITS, name: "Units", moduleId: MODULE }, { id: FILTER_ITEM, name: "Include?", moduleId: MODULE_3, format: { dataType: "BOOLEAN" } }],
      modules: [MODULE, MODULE_3, candidate(1)],
    });
    const named = (pages: UxPageCardDetails[], lineItems: ExportedLineItems) => {
      const log: string[] = [];
      return { log, result: loadCatalog(scope, pages, new Map(), { status: () => undefined, log: line => { log.push(line); } }, undefined, lineItems) };
    };
    const lineItemsLine = (log: string[]) => log.filter(line => line.startsWith("line items:"));

    it("reads of their modules only one the pages use, to compare it with the listing, and the pages' other modules; the filter search has nothing to find", async () => {
      serveModel({ [at(`/modules/${MODULE}/lineItems`)]: id => update(id, { data: [{ lineItemId: UNITS, lineItemLabel: "Units" }] }),
        [at(`/modules/${candidate(2)}/lineItems`)]: id => update(id, { data: [{ lineItemId: LINE_ITEM, lineItemLabel: "Margin" }] }) });
      const { log, result } = named(withGrid({ kind: "module", id: candidate(2) }), exported());
      const { catalog, notes } = await result;
      expect(notes).toEqual([]);
      // The grid's module is read to compare; the module the export did not list is read as before; the rule's line item is
      // the export's, so its module is not read, and no question is asked about the filtered dimension.
      expect(destinations()).toEqual([at(""), MODULE_VIEWS, at("/lists"), at(`/modules/${MODULE}/lineItems`), at(`/modules/${candidate(2)}/lineItems`), at("/dimensions"),
        at(`/modules/${MODULE}/dimensions/${LIST}`)]);
      expect([catalog.lineItems.get(FILTER_ITEM), catalog.lineItemFormats.get(FILTER_ITEM)?.dataType, catalog.lineItems.get(LINE_ITEM), catalog.lineItems.get(UNITS)])
        .toEqual([{ name: "Include?", moduleId: MODULE_3 }, "BOOLEAN", { name: "Margin", moduleId: candidate(2) }, { name: "Units", moduleId: MODULE }]);
      // Every module of the export counts as read, one with no line items too.
      expect([MODULE_3, candidate(1)].map(module => catalog.lineItemModules.has(module))).toEqual([true, true]);
      expect(lineItemsLine(log)).toEqual([`line items: 1 named from the export, of 3 modules; 2 of the 2 modules the pages use read from the listing; `
        + `the export and the listing agree on module ${MODULE}: 1 of 1 line items alike, by ID and name`]);
      expect(log.at(-1)).toBe("Synthetic model: 0 modules, 0 saved views, 0 dimensions, 3 line items (2 modules read), 0 actions");
    });

    it("sets them aside where the listing differs, and reads every module the pages use as before, the filter search too", async () => {
      serveModel({ [at(`/modules/${MODULE}/lineItems`)]: id => update(id, { data: [{ lineItemId: "1901000000099", lineItemLabel: "Units" }] }),
        [at("/applicableModules")]: id => update(id, { data: [{ id: MODULE_3, label: "Module three" }] }),
        [at(`/modules/${MODULE_3}/lineItems`)]: id => update(id, { data: [{ lineItemId: FILTER_ITEM, lineItemLabel: "Include?" }] }) });
      const { log, result } = named(withGrid(), exported());
      const { catalog } = await result;
      // None of the export's line items is left; the listing's are there, and the search found the rule's line item.
      expect([catalog.lineItems.get(UNITS), catalog.lineItems.get("1901000000099"), catalog.lineItems.get(FILTER_ITEM), searched()])
        .toEqual([undefined, { name: "Units", moduleId: MODULE }, { name: "Include?", moduleId: MODULE_3 }, [MODULE_3]]);
      expect([catalog.lineItemModules.has(candidate(1)), catalog.lineItemFormats.has(FILTER_ITEM)]).toEqual([false, false]);
      expect(lineItemsLine(log)).toEqual([`line items: 0 named from the export, of 3 modules; 1 of the 1 modules the pages use read from the listing; `
        + `the export and the listing differ on module ${MODULE}: 0 of 1 line items alike, by ID and name; the export's line items are set aside, `
        + "and every module the pages use is read from the listing"]);
      // A listing with no line item for a module the export gives some differs from it too.
      serveModel();
      const empty = named(withGrid(), exported());
      await empty.result;
      expect(lineItemsLine(empty.log).at(-1)).toContain(`differ on module ${MODULE}: 0 of 0 line items alike`);
    });

    it("keeps them when the listing refuses the module read to compare them, and reads nothing else for them", async () => {
      serveModel({ [at(`/modules/${MODULE}/lineItems`)]: id => rejected(id, "LINE_ITEMS_UNAVAILABLE") });
      const { log, result } = named(withGrid(), exported());
      const { catalog } = await result;
      expect([catalog.lineItems.get(UNITS), catalog.lineItems.get(FILTER_ITEM), destinations().filter(destination => destination.endsWith("/lineItems") || destination.endsWith("/applicableModules"))])
        .toEqual([{ name: "Units", moduleId: MODULE }, { name: "Include?", moduleId: MODULE_3 }, [at(`/modules/${MODULE}/lineItems`)]]);
      expect(lineItemsLine(log)).toEqual([`line items: 2 named from the export, of 3 modules; 0 of the 1 modules the pages use read from the listing; `
        + `the listing of module ${MODULE} could not be read to compare (LINE_ITEMS_UNAVAILABLE): the export's line items are used`]);
      // Nothing to compare where no page uses a module of theirs: each module the pages use is read.
      serveModel();
      const elsewhere = named([{ cards: [], references: [{ kind: "module", id: candidate(3) }] }] as unknown as UxPageCardDetails[], exported());
      await elsewhere.result;
      expect(lineItemsLine(elsewhere.log)).toEqual(["line items: 2 named from the export, of 3 modules; 1 of the 1 modules the pages use read from the listing; "
        + "no page uses a module that the export listed with line items: nothing to compare"]);
    });
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

  it("looks for filter line items in the filtered dimension's modules not yet read, four at a time, until found: every one of them is asked, however many", async () => {
    // The clock stands still, so the search takes no time by it.
    vi.useFakeTimers({ toFake: ["Date"] });
    // Four reads are kept moving: one starts as another is answered. When the answer comes that has the rule's line item,
    // the three modules after it have been asked for too, and are given up. Sixty modules were once the most that were
    // read: the sixty-first is read now, and so is the hundred and twenty-seventh.
    for (const [count, found] of [[6, 2], [60, 0], [61, 0], [130, 127]] as const) {
      ScriptedSocket.sockets = [];
      const candidates = Array.from({ length: count }, (_, index) => candidate(index + 1));
      const asked = found ? Math.min(count, found + 3) : count;
      serveModel({
        // A module that was read already, or could not be read, is not a candidate.
        [at(`/modules/${MODULE_3}/lineItems`)]: id => rejected(id, "LINE_ITEMS_UNAVAILABLE"),
        [at("/applicableModules")]: id => update(id, { data: [MODULE, MODULE_3, ...candidates].map(module => ({ id: module, label: `Module ${module}` })) }),
        ...(found ? { [at(`/modules/${candidate(found)}/lineItems`)]: (id: string) => update(id, { data: [{ lineItemId: FILTER_ITEM, lineItemLabel: "Include?" }] }) } : {}),
      });
      const { log, result } = run(withGrid({ kind: "module", id: MODULE_3 }));
      const done = await result;
      // A line item that no module lists adds no note: every module there was to read was read.
      expect(done.notes, String(count)).toEqual([]);
      expect(destinations().filter(destination => destination.endsWith("/lineItems")), String(count))
        .toEqual([MODULE, MODULE_3, ...candidates.slice(0, asked)].map(module => at(`/modules/${module}/lineItems`)));
      expect(log).toContain(`line items of module ${MODULE_3}: LINE_ITEMS_UNAVAILABLE`);
      expect(done.catalog.lineItems.has(FILTER_ITEM)).toBe(!!found);
      // The log says how far the search went, in counts only: the IDs looked for, the modules read of those that have the
      // filtered dimensions and of the model's others (it has none here), the time, the reads given up while they waited,
      // what was found and where, and whether the IDs themselves ordered the search.
      expect(log.filter(line => line.startsWith("filter line items:")), String(count)).toEqual([
        `filter line items: 1 looked for in ${found || count} of ${count} candidate modules that have the filtered dimensions and 0 of 0 other modules, in 0 s, `
          + `${found ? asked - found : 0} reads given up while waiting: ${found ? "1 found (1 in candidate modules), 0" : "0 found, 1"} not found`,
        // (This made-up model's list of modules is empty: every module it names is one that its list does not hold.)
        `filter line items: ${count + 2} of the ${count + 2} modules the model named are not in its list of modules`,
        `filter line items: the entity-type bracket chose 0 of the ${asked} modules asked for; fewer than 3 modules with line items were read`]);
      // A read that was given up was not refused: nothing is logged for it.
      expect(log.filter(line => line.startsWith("line items of")), String(count)).toEqual([`line items of module ${MODULE_3}: LINE_ITEMS_UNAVAILABLE`]);
    }
  });

  it("goes on through the model's other modules, in its list's order, when no module that has the filtered dimensions lists a rule's line item", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const [candidates, others] = [[1, 2, 3, 4, 5].map(candidate), Array.from({ length: 14 }, (_, index) => other(index + 1))];
    /** The rule's line item is in the seventh of the model's other modules, and the second of them cannot be read. */
    const serve = (answers: Record<string, (id: string, asked: Any) => string>) => {
      ScriptedSocket.sockets = [];
      serveModel({ [MODULE_VIEWS]: moduleList(others), [at(`/modules/${other(2)}/lineItems`)]: id => rejected(id, "LINE_ITEMS_UNAVAILABLE"),
        [at(`/modules/${other(7)}/lineItems`)]: id => update(id, { data: [{ lineItemId: FILTER_ITEM, lineItemLabel: "Include?" }] }), ...answers });
    };
    const named = (id: string) => update(id, { data: [MODULE, ...candidates].map(module => ({ id: module, label: `Module ${module}` })) });

    serve({ [at("/applicableModules")]: named });
    const { log, statuses, result } = run(withGrid());
    const { catalog, notes } = await result;
    expect(notes).toEqual([]);
    expect(catalog.lineItems.get(FILTER_ITEM)).toEqual({ name: "Include?", moduleId: other(7) });
    // The modules the model named come first, as they always did, then the others of its list: four reads moving, each
    // module asked once, until the rule has its line item. The three modules after the seventh were asked for by then and
    // are given up; the four after those are never asked.
    expect(searched()).toEqual([...candidates, ...others.slice(0, 10)]);
    // The step is shown once: it says how far the search is only every five seconds, and here the clock stands still.
    expect(statuses.filter(line => line.startsWith("Finding filter line items"))).toEqual(["Finding filter line items in Synthetic model…"]);
    // The log tells the two kinds of module apart, and says in which the line item was found. A module that could not be
    // read is logged as it always was, and is not counted as read; one that was given up is not logged.
    expect(log.filter(line => /^(filter |line items of)/.test(line))).toEqual([`line items of module ${other(2)}: LINE_ITEMS_UNAVAILABLE`,
      "filter line items: 1 looked for in 5 of 5 candidate modules that have the filtered dimensions and 6 of 14 other modules, in 0 s, 3 reads given up while waiting: "
        + "1 found (0 in candidate modules), 0 not found",
      "filter line items: 5 of the 6 modules the model named are not in its list of modules",
      "filter line items: the entity-type bracket chose 0 of the 15 modules asked for; fewer than 3 modules with line items were read"]);

    // The model names no module for the filtered dimension, or refuses the question: its list is gone through all the same.
    for (const answer of [(id: string) => update(id, { data: [] }), (id: string) => rejected(id, "MODULES_UNAVAILABLE")]) {
      serve({ [at("/applicableModules")]: answer });
      const unnamed = await run(withGrid()).result;
      expect([unnamed.notes, unnamed.catalog.lineItems.get(FILTER_ITEM)]).toEqual([[], { name: "Include?", moduleId: other(7) }]);
      expect(searched()).toEqual(others.slice(0, 10));
    }

    // A line item that no module has: every module is asked once, and no note is added, as none was when every module that
    // has the filtered dimensions had been read. The rule keeps its ID.
    serve({ [at("/applicableModules")]: named, [at(`/modules/${other(7)}/lineItems`)]: id => update(id, { data: [] }) });
    const none = run(withGrid());
    expect((await none.result).notes).toEqual([]);
    expect(searched()).toEqual([...candidates, ...others]);
    expect(none.log.filter(line => line.startsWith("filter "))).toEqual([
      "filter line items: 1 looked for in 5 of 5 candidate modules that have the filtered dimensions and 13 of 14 other modules, in 0 s, 0 reads given up while waiting: 0 found, 1 not found",
      "filter line items: 5 of the 6 modules the model named are not in its list of modules",
      "filter line items: the entity-type bracket chose 0 of the 19 modules asked for; fewer than 3 modules with line items were read",
      `filter rule with an unnamed item (card card-1): unnamed ${FILTER_ITEM}`]);

    // Without the model's list of modules, which was not available, the modules it names for the dimension are all there is to read.
    serve({ [MODULE_VIEWS]: id => rejected(id, "MODULES_UNAVAILABLE"), [at("/applicableModules")]: named });
    expect((await run(withGrid()).result).notes).toEqual(["Synthetic model: module and saved view names were not available (MODULES_UNAVAILABLE)."]);
    expect(searched()).toEqual(candidates);

    // A module whose ID, in the model's list or among those it names, is no ID is never read: no destination is made of it.
    const odd = ["abc", `${other(3)}/../../lists`, `0${other(4)}`, `${other(5)}${other(5)}`, `${other(6)} `, `-${other(7)}`];
    ScriptedSocket.sockets = [];
    serveModel({ [MODULE_VIEWS]: id => update(id, { data: [{ id: Number(MODULE), name: "Demand", views: [] }, ...odd.map(module => ({ id: module, name: "Odd", views: [] })),
      { id: other(1), name: "As text", views: [] }, { id: Number(other(2)), name: "As a number", views: [] }], dimensions: {} }),
    [at("/applicableModules")]: id => update(id, { data: [...odd.slice(0, 2), candidate(1)].map(module => ({ id: module, label: "Named" })) }) });
    await run(withGrid()).result;
    expect(destinations().filter(destination => destination.endsWith("/lineItems"))).toEqual([MODULE, candidate(1), other(1), other(2)].map(module => at(`/modules/${module}/lineItems`)));
  });

  it("reads the modules the model names first, and then, of its other modules, those between the two whose line items bracket the ID looked for, when the modules read so far bear that order out", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    // A model of forty-one modules whose IDs and line item IDs rise together: the line items of the list's nth other module
    // have the entity type 2000 + n. The cards show four of the modules, and a rule's line item is the first of another.
    const others = Array.from({ length: 40 }, (_, index) => other(index + 1));
    const FAR = ITEM(2025, 0);
    const shown = [{ cards: ruled(rule([FAR], ["true"]))[0].cards, references: [MODULE, other(1), other(20), other(40)].map(id => ({ kind: "module", id })) }] as unknown as UxPageCardDetails[];
    /** The model, with the line items of these modules given another entity type, or no line items at all. */
    const serve = (types: Record<string, number | undefined>, named: string[] = []) => {
      ScriptedSocket.sockets = [];
      serveModel({ [MODULE_VIEWS]: moduleList(others), [at(`/modules/${MODULE}/lineItems`)]: id => update(id, { data: [{ lineItemId: LINE_ITEM, lineItemLabel: "Volume" }] }),
        [at("/applicableModules")]: id => update(id, { data: [MODULE, ...named].map(module => ({ id: module, label: `Module ${module}` })) }),
        ...Object.fromEntries(others.map((module, index) => {
          const type = module in types ? types[module] : 2001 + index;
          return [at(`/modules/${module}/lineItems`), (id: string) => update(id, { data: type === undefined ? [] : [0, 1].map(n => ({ lineItemId: ITEM(type, n), lineItemLabel: `Line item ${n} of ${module}` })) })];
        })) });
    };
    const lines = (log: string[]) => log.filter(line => line.startsWith("filter line items:"));

    // The line item's entity type lies between those of the twentieth and the fortieth module, which the cards show. The two
    // modules the model names are asked for first, as they were before the other modules were searched at all, and in the
    // two places they leave, two of the nineteen modules between the twentieth and the fortieth, spread evenly: the
    // twenty-seventh and the thirty-third. As each read is answered, another starts in its place: for the middle one of the
    // modules that are left between the two that bracket the type by then (the thirtieth and the thirty-first are asked
    // before the twenty-seventh has answered and narrowed them), and for the list's next module once none is left between
    // them. The twenty-fifth has the line item; the three reads that still wait then are given up.
    serve({}, [other(3), other(5)]);
    const { log, statuses, result } = run(shown);
    const { catalog, notes } = await result;
    expect(notes).toEqual([]);
    expect(catalog.lineItems.get(FAR)).toEqual({ name: `Line item 0 of ${other(25)}`, moduleId: other(25) });
    expect(searched()).toEqual([1, 20, 40, 3, 5, 27, 33, 30, 31, 24, 23, 25, 22, 26, 2].map(other));
    expect(statuses.at(-1)).toBe("Finding filter line items in Synthetic model…");
    expect(lines(log)).toEqual([
      "filter line items: 1 looked for in 2 of 2 candidate modules that have the filtered dimensions and 7 of 35 other modules, in 0 s, 3 reads given up while waiting: "
        + "1 found (0 in candidate modules), 0 not found",
      "filter line items: the entity-type bracket chose 9 of the 12 modules asked for; in the modules read, module IDs and line item entity types rise together (13 modules with line items)"]);

    // The order holds for the modules the cards show, and not for the module that has the line item: the fifth, whose line
    // items have the entity type that the twenty-fifth's would have. The model names no module here, so the bracket is read
    // first and has nothing; then the list is gone through in its order, and the line item is found there, under the name
    // its own module gives it. The wrong guess cost eight reads and no name.
    serve({ [other(5)]: 2025, [other(25)]: undefined });
    const astray = run(shown);
    expect((await astray.result).catalog.lineItems.get(FAR)).toEqual({ name: `Line item 0 of ${other(5)}`, moduleId: other(5) });
    expect(searched()).toEqual([1, 20, 40, 24, 28, 32, 36, 33, 26, 27, 25, 2, 3, 4, 5, 6, 7, 8].map(other));
    expect(lines(astray.log)).toEqual([
      "filter line items: 1 looked for in 0 of 0 candidate modules that have the filtered dimensions and 12 of 37 other modules, in 0 s, 3 reads given up while waiting: "
        + "1 found (0 in candidate modules), 0 not found",
      "filter line items: the entity-type bracket chose 8 of the 15 modules asked for; in the modules read, module IDs and line item entity types do not rise together"]);

    // The modules the cards show do not bear the order out: the twentieth's line items have a higher entity type than the
    // fortieth's. The IDs then order nothing: the list is gone through in its order, as far as the line item.
    serve({ [other(20)]: 2090 });
    const unordered = run(shown);
    expect((await unordered.result).catalog.lineItems.get(FAR)).toEqual({ name: `Line item 0 of ${other(25)}`, moduleId: other(25) });
    expect(searched()).toEqual([1, 20, 40, ...Array.from({ length: 27 }, (_, index) => index + 2).filter(n => n !== 20)].map(other));
    expect(lines(unordered.log)).toEqual([
      "filter line items: 1 looked for in 0 of 0 candidate modules that have the filtered dimensions and 23 of 37 other modules, in 0 s, 3 reads given up while waiting: "
        + "1 found (0 in candidate modules), 0 not found",
      "filter line items: the entity-type bracket chose 0 of the 26 modules asked for; in the modules read, module IDs and line item entity types do not rise together"]);
  });

  it("reads the modules the model names before any that the entity types point to: a slow model names a rule in the second of them as fast as it did", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
    // The cards show three modules whose IDs and line item entity types rise together, and the rule's ID has an entity type
    // above theirs: by that order its module comes after them, where the model's forty other modules are, and the eight
    // modules it names. Every read of the search takes eleven seconds.
    const [others, named, WANTED] = [Array.from({ length: 40 }, (_, index) => other(index + 1)), [1, 2, 3, 4, 5, 6, 7, 8].map(candidate), ITEM(1950, 0)];
    const lineItemsOf = (lineItemId: string) => (id: string) => update(id, { data: [{ lineItemId, lineItemLabel: `Line item ${lineItemId}` }] });
    serveModel({ [MODULE_VIEWS]: moduleList(others), [at("/applicableModules")]: id => update(id, { data: named.map(module => ({ id: module, label: `Module ${module}` })) }),
      [at(`/modules/${MODULE}/lineItems`)]: lineItemsOf(LINE_ITEM), [at(`/modules/${MODULE_3}/lineItems`)]: lineItemsOf(ITEM(1905, 1)), [at(`/modules/${STAFFING}/lineItems`)]: lineItemsOf(ITEM(1909, 1)),
      [at(`/modules/${candidate(2)}/lineItems`)]: lineItemsOf(WANTED) });
    slowly(destination => [...named, ...others].some(module => destination === at(`/modules/${module}/lineItems`)), 11_000);
    const slow = run([{ cards: ruled(rule([WANTED], ["true"]))[0].cards, references: [MODULE, MODULE_3, STAFFING].map(id => ({ kind: "module", id })) }] as unknown as UxPageCardDetails[]);
    // The first four reads are of the first four modules the model names, as they were before the other modules were
    // searched at all. None is of a module that the entity types point to: those have the places the named modules leave.
    await vi.advanceTimersByTimeAsync(9_900);
    expect(searched()).toEqual([MODULE_3, STAFFING, ...named.slice(0, 4)]);
    // The second has the line item, and the rule is named after eleven seconds. (The next four were asked for after ten.)
    await vi.advanceTimersByTimeAsync(1_300);
    const { catalog, notes } = await slow.result;
    expect([catalog.lineItems.get(WANTED), notes, searched()]).toEqual([{ name: `Line item ${WANTED}`, moduleId: candidate(2) }, [], [MODULE_3, STAFFING, ...named]]);
    expect(slow.log.filter(line => line.startsWith("filter line items:"))).toEqual([
      "filter line items: 1 looked for in 2 of 8 candidate modules that have the filtered dimensions and 0 of 40 other modules, in 11 s, 6 reads given up while waiting: "
        + "1 found (1 in candidate modules), 0 not found",
      "filter line items: 8 of the 8 modules the model named are not in its list of modules",
      "filter line items: the entity-type bracket chose 0 of the 8 modules asked for; in the modules read, module IDs and line item entity types rise together (4 modules with line items)"]);
  });

  it("spares the model's other modules a rule that a module already read rules out, and still looks for its IDs in every module the model names", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const [candidates, others] = [[1, 2, 3, 4, 5, 6].map(candidate), Array.from({ length: 10 }, (_, index) => other(index + 1))];
    /** A model whose modules have these line items. It names the six candidates for the filtered dimension, and its list
     * has ten other modules. */
    const serve = (lineItems: Record<string, string[]>) => {
      ScriptedSocket.sockets = [];
      serveModel({ [MODULE_VIEWS]: moduleList(others), [at("/applicableModules")]: id => update(id, { data: [MODULE, ...candidates].map(module => ({ id: module, label: `Module ${module}` })) }),
        ...Object.fromEntries(Object.entries(lineItems).map(([module, ids]) => [at(`/modules/${module}/lineItems`),
          (id: string) => update(id, { data: ids.map(lineItemId => ({ lineItemId, lineItemLabel: `Line item ${lineItemId}` })) })])) });
    };
    /** A rule on these IDs, in an app whose cards show these modules. */
    const showing = (ids: string[], ...modules: string[]) => [{ cards: ruled(rule(ids, ["true"]))[0].cards, references: modules.map(module => ({ kind: "module", id: module })) }] as unknown as UxPageCardDetails[];
    const lines = (log: string[]) => log.filter(line => line.startsWith("filter line items:"));
    const read = (looked: number, inCandidates: number, inOthers: number, outcome: string, givenUp = 0) => `filter line items: ${looked} looked for in ${inCandidates} of 6 candidate modules that have the filtered dimensions and `
      + `${inOthers} of 10 other modules, in 0 s, ${givenUp} reads given up while waiting: ${outcome}`;
    const rising = (modules: number) => `in the modules read, module IDs and line item entity types rise together (${modules} modules with line items)`;
    const ruledOut = (count: string, id: string, module: string, beside = "") => `filter line items: of the ${count} not found, ${count} looked for in the candidate modules only: 1 ruled out, `
      + `each by a module that was read, which has the line items of its entity type and does not list it (${id} by module ${module})${beside}`;
    /** The three modules the cards show, each with line items of an entity type of its own. */
    const shown = { [MODULE]: [LINE_ITEM], [MODULE_3]: [ITEM(1905, 1)], [STAFFING]: [ITEM(1909, 1)] };
    // Of the seven modules the model names, its list has the grid's own and not the six others.
    const unlisted = "filter line items: 6 of the 7 modules the model named are not in its list of modules";

    // A rule on a line item that the grid's own module no longer has: its ID has the entity type of that module's line items.
    // The six modules the model names are read all the same, as they always were, and none of the ten others is.
    const GONE = ITEM(1901, 77);
    serve(shown);
    const gone = run(showing([GONE], MODULE, MODULE_3, STAFFING));
    expect((await gone.result).notes).toEqual([]);
    expect(searched()).toEqual([MODULE_3, STAFFING, ...candidates]);
    // The log's counts add up: one ID looked for, none found, one not found, and that one in the candidate modules only.
    expect(lines(gone.log)).toEqual([read(1, 6, 0, "0 found, 1 not found"), unlisted,
      `filter line items: the entity-type bracket chose 0 of the 6 modules asked for; ${rising(3)}`, ruledOut("1", GONE, MODULE)]);

    // Nothing proves that two modules never have line items of one entity type. Here the first module the model names has
    // line items of the grid's module's type, the rule's among them: it is read, as it always was, and the rule has its name.
    // (The three modules asked for with it are given up when its answer comes.)
    serve({ ...shown, [candidate(1)]: [GONE] });
    const twin = run(showing([GONE], MODULE, MODULE_3, STAFFING));
    expect((await twin.result).catalog.lineItems.get(GONE)).toEqual({ name: `Line item ${GONE}`, moduleId: candidate(1) });
    expect(searched()).toEqual([MODULE_3, STAFFING, ...candidates.slice(0, 4)]);
    expect(lines(twin.log)).toEqual([read(1, 1, 0, "1 found (1 in candidate modules), 0 not found", 3), unlisted,
      "filter line items: the entity-type bracket chose 0 of the 4 modules asked for; in the modules read, a module's line items do not have one entity type of their own"]);

    // A rule holds one line item. When one of its IDs is ruled out, that one was it, and the rule's other ID is its context,
    // which no module lists: the other modules are spared that one too.
    serve(shown);
    const whole = run(showing([GONE, ITEM(7000, 3)], MODULE, MODULE_3, STAFFING));
    await whole.result;
    expect(searched()).toEqual([MODULE_3, STAFFING, ...candidates]);
    expect(lines(whole.log)).toEqual([read(2, 6, 0, "0 found, 2 not found"), unlisted,
      `filter line items: the entity-type bracket chose 0 of the 6 modules asked for; ${rising(3)}`, ruledOut("2", GONE, MODULE, ", and 1 in a rule with such an ID")]);

    // The same when the search itself reads the module that rules the ID out: the second module the model names has the
    // line items of its entity type, and does not list it. The named modules after it are read, and no other.
    const LOST = ITEM(1903, 77);
    serve({ [MODULE]: [LINE_ITEM], [candidate(1)]: [ITEM(1902, 1)], [candidate(2)]: [FILTER_ITEM], [candidate(3)]: [ITEM(1904, 1)] });
    const lost = run(showing([LOST], MODULE));
    expect((await lost.result).notes).toEqual([]);
    expect(searched()).toEqual(candidates);
    expect(lines(lost.log)).toEqual([read(1, 6, 0, "0 found, 1 not found"), unlisted,
      `filter line items: the entity-type bracket chose 0 of the 6 modules asked for; ${rising(4)}`, ruledOut("1", LOST, candidate(2))]);

    // All of that is taken from three modules with line items, and not from fewer: with the grid's module alone, every
    // module is read, the ten others too.
    serve({ [MODULE]: [LINE_ITEM] });
    const alone = run(showing([GONE], MODULE));
    await alone.result;
    expect(searched()).toEqual([...candidates, ...others]);
    expect(lines(alone.log)).toEqual([read(1, 6, 10, "0 found, 1 not found"), unlisted,
      "filter line items: the entity-type bracket chose 0 of the 16 modules asked for; fewer than 3 modules with line items were read"]);

    // Nor when two of the modules read have line items of one entity type: an ID then does not say which module it belongs
    // to. Nothing is ruled out, and every module is read.
    serve({ ...shown, [MODULE_3]: [ITEM(1901, 2)] });
    const shared = run(showing([GONE], MODULE, MODULE_3, STAFFING));
    await shared.result;
    expect(searched()).toEqual([MODULE_3, STAFFING, ...candidates, ...others]);
    expect(lines(shared.log)).toEqual([read(1, 6, 10, "0 found, 1 not found"), unlisted,
      "filter line items: the entity-type bracket chose 0 of the 16 modules asked for; in the modules read, a module's line items do not have one entity type of their own"]);

    // The log lists thirty of the IDs that are ruled out, and counts the rest.
    for (const count of [30, 33]) {
      const crowd = Array.from({ length: count }, (_, index) => ITEM(1901, 100 + index));
      serve(shown);
      const crowded = run(showing(crowd, MODULE, MODULE_3, STAFFING));
      await crowded.result;
      expect(lines(crowded.log).at(-1), String(count)).toBe(`filter line items: of the ${count} not found, ${count} looked for in the candidate modules only: ${count} ruled out, `
        + `each by a module that was read, which has the line items of its entity type and does not list it (${crowd.slice(0, 30).map(id => `${id} by module ${MODULE}`).join(", ")}`
        + `${count > 30 ? " and 3 more" : ""})`);
    }
  });

  it("writes six lines to the diagnostic log for a search through 249 modules, none of them for a module it reads, and says how far it is every five seconds", async () => {
    /** Everything a run writes to the diagnostic log, in order: its statuses, which are logged like its lines, and its lines. */
    const written = (pages: UxPageCardDetails[]) => {
      const lines: string[] = [];
      return { lines, result: loadCatalog(scope, pages, new Map(), { status: line => { lines.push(line); }, log: line => { lines.push(line); } }) };
    };
    const step = "Finding filter line items in Synthetic model…";
    /** Those of them that the search wrote: from its step to its last line. */
    const ofSearch = (lines: string[]) => lines.slice(lines.indexOf(step), lines.reduce((last, line, index) => (line.startsWith("filter line items:") ? index : last), -1) + 1);
    // The search's question is the run's sixth read, after the model's status, its modules, its lists, the grid's line items and its dimensions.
    const question = [`SUBSCRIBE ${at("/applicableModules")} id=json-6`, `SEND ${at("/applicableModules")} id=json-6 action-type=update-subscription`, "UNSUBSCRIBE id=json-6"];
    const few = "fewer than 3 modules with line items were read";
    const pages = () => ruled(rule([FILTER_ITEM], ["true"]));
    const progress = (lines: string[]) => lines.filter(line => line.startsWith("Finding filter line items"));
    /** An answer that comes this much later by the clock, which stands still otherwise. */
    const later = (ms: number) => (id: string) => { vi.setSystemTime(Date.now() + ms); return update(id, { data: [] }); };

    // A model of 249 modules that were not read, of which it names a hundred for the filtered dimension. None has the rule's
    // line item, so every one of them is read: 747 frames, and not one line of the log.
    vi.useFakeTimers({ toFake: ["Date"] });
    const others = Array.from({ length: 249 }, (_, index) => other(index + 1));
    serveModel({ [MODULE_VIEWS]: moduleList(others), [at("/applicableModules")]: id => update(id, { data: others.slice(0, 100).map(module => ({ id: module, label: `Module ${module}` })) }) });
    const whole = written(pages());
    await whole.result;
    expect([searched(), sent("SUBSCRIBE").filter(frame => ofTheSearch(frame.headers.destination)).length, everyReadEnded()]).toEqual([others, 249, true]);
    expect(ofSearch(whole.lines)).toEqual([step, ...question,
      "filter line items: 1 looked for in 100 of 100 candidate modules that have the filtered dimensions and 149 of 149 other modules, in 0 s, 0 reads given up while waiting: 0 found, 1 not found",
      `filter line items: the entity-type bracket chose 0 of the 249 modules asked for; ${few}`]);
    // Every other read is logged as it always was: the grid's own line items, say.
    expect(whole.lines.filter(line => line.includes("/lineItems"))).toEqual([`SUBSCRIBE ${at(`/modules/${MODULE}/lineItems`)} id=json-4`,
      `SEND ${at(`/modules/${MODULE}/lineItems`)} id=json-4 action-type=update-subscription`]);

    // A module of the search that cannot be read is logged as it always was.
    ScriptedSocket.sockets = [];
    serveModel({ [MODULE_VIEWS]: moduleList(others.slice(0, 5)), [at(`/modules/${other(3)}/lineItems`)]: id => rejected(id, "LINE_ITEMS_UNAVAILABLE") });
    const refused = written(pages());
    await refused.result;
    expect(ofSearch(refused.lines)).toEqual([step, ...question, `line items of module ${other(3)}: LINE_ITEMS_UNAVAILABLE`,
      "filter line items: 1 looked for in 0 of 0 candidate modules that have the filtered dimensions and 4 of 5 other modules, in 0 s, 0 reads given up while waiting: 0 found, 1 not found",
      `filter line items: the entity-type bracket chose 0 of the 5 modules asked for; ${few}`]);

    // The step says how far the search is once five seconds have passed since it last said anything, and not a millisecond
    // before: here the first answer comes 4.999 seconds after the search began, the second a millisecond later, and the
    // third and fourth as long after that again. It says how many modules were asked for, of how many there are to ask.
    ScriptedSocket.sockets = [];
    serveModel({ [MODULE_VIEWS]: moduleList(others.slice(0, 12)), [at(`/modules/${other(1)}/lineItems`)]: later(4_999), [at(`/modules/${other(2)}/lineItems`)]: later(1),
      [at(`/modules/${other(3)}/lineItems`)]: later(4_999), [at(`/modules/${other(4)}/lineItems`)]: later(1) });
    const paced = written(pages());
    await paced.result;
    expect(progress(paced.lines)).toEqual([step, "Finding filter line items in Synthetic model: 5 of 12 modules…", "Finding filter line items in Synthetic model: 7 of 12 modules…"]);
    expect(paced.lines.filter(line => line.startsWith("filter line items: 1 looked for"))).toEqual([
      "filter line items: 1 looked for in 0 of 0 candidate modules that have the filtered dimensions and 12 of 12 other modules, in 10 s, 0 reads given up while waiting: 0 found, 1 not found"]);

    // A rule that a module already read rules out is looked for in the modules the model names only: the step counts
    // those, and not the model's ten other modules, which are not to be read.
    ScriptedSocket.sockets = [];
    const named = Array.from({ length: 12 }, (_, index) => candidate(index + 1));
    const lineItemsOf = (lineItemId: string) => (id: string) => update(id, { data: [{ lineItemId, lineItemLabel: `Line item ${lineItemId}` }] });
    serveModel({ [MODULE_VIEWS]: moduleList(others.slice(0, 10)), [at("/applicableModules")]: id => update(id, { data: named.map(module => ({ id: module, label: `Module ${module}` })) }),
      [at(`/modules/${MODULE}/lineItems`)]: lineItemsOf(LINE_ITEM), [at(`/modules/${MODULE_3}/lineItems`)]: lineItemsOf(ITEM(1905, 1)), [at(`/modules/${STAFFING}/lineItems`)]: lineItemsOf(ITEM(1909, 1)),
      [at(`/modules/${candidate(1)}/lineItems`)]: later(4_999), [at(`/modules/${candidate(2)}/lineItems`)]: later(1) });
    const ruledOut = written([{ cards: ruled(rule([ITEM(1901, 77)], ["true"]))[0].cards, references: [MODULE, MODULE_3, STAFFING].map(id => ({ kind: "module", id })) }] as unknown as UxPageCardDetails[]);
    await ruledOut.result;
    expect([searched(), progress(ruledOut.lines)]).toEqual([[MODULE_3, STAFFING, ...named], [step, "Finding filter line items in Synthetic model: 5 of 12 modules…"]]);
  });

  describe("keeps four reads of the search moving, and throws no answer away for being late", () => {
    const timers = ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] as const;
    const lineItem = (id: string) => update(id, { data: [{ lineItemId: FILTER_ITEM, lineItemLabel: "Include?" }] });
    const named = (modules: readonly string[]) => (id: string) => update(id, { data: [MODULE, ...modules].map(module => ({ id: module, label: `Module ${module}` })) });
    const lines = (log: string[]) => log.filter(line => /^(filter |line items of|modules for)/.test(line));
    const few = (asked: number) => `filter line items: the entity-type bracket chose 0 of the ${asked} modules asked for; fewer than 3 modules with line items were read`;
    /** Where the made-up model names modules (the grid's own with them), its list of modules is empty: it holds none of them. */
    const unlisted = (named: number) => `filter line items: ${named} of the ${named} modules the model named are not in its list of modules`;
    /** Starts a run, under a clock the test moves on, and says what has become of it. */
    const start = () => {
      const { log, result } = run(withGrid());
      const seen: { done?: Awaited<typeof result> } = {};
      void result.then(done => { seen.done = done; });
      return { log, seen, named: () => seen.done?.catalog.lineItems.get(FILTER_ITEM) };
    };
    /** What the search left behind when it ended: nothing. Every read it asked for was ended, none is remembered as
     * unreadable, and when the answers it did not wait for come after all, they change nothing and nothing is logged. */
    const leavesNothingBehind = async ({ log, seen }: ReturnType<typeof start>) => {
      const [read, logged] = [[...seen.done!.catalog.lineItemModules], lines(log)];
      await vi.advanceTimersByTimeAsync(120_000);
      expect([[...seen.done!.catalog.lineItemModules], lines(log), [...seen.done!.catalog.unreadableModules], everyReadEnded()]).toEqual([read, logged, [], true]);
    };

    it("every read of line items takes eleven seconds, and the rule's is in the second of eight named modules: named after eleven seconds", async () => {
      vi.useFakeTimers({ toFake: [...timers] });
      const candidates = [1, 2, 3, 4, 5, 6, 7, 8].map(candidate);
      serveModel({ [at("/applicableModules")]: named(candidates), [at(`/modules/${candidate(2)}/lineItems`)]: lineItem });
      slowLineItems(11_000);
      const slow = start();
      // After ten seconds the first four have held their places long enough: the next four are asked for, and the first
      // four go on waiting.
      await vi.advanceTimersByTimeAsync(9_900);
      expect(searched()).toEqual(candidates.slice(0, 4));
      await vi.advanceTimersByTimeAsync(1_000);
      expect([searched(), slow.named()]).toEqual([candidates, undefined]);
      // Their answers come after eleven seconds and count like any other: the rule has its line item, and the search is over
      // at once. The six reads that still wait are given up, and nothing is logged for them.
      await vi.advanceTimersByTimeAsync(200);
      expect([slow.named(), slow.seen.done?.notes]).toEqual([{ name: "Include?", moduleId: candidate(2) }, []]);
      expect(lines(slow.log)).toEqual([
        "filter line items: 1 looked for in 2 of 8 candidate modules that have the filtered dimensions and 0 of 0 other modules, in 11 s, 6 reads given up while waiting: "
          + "1 found (1 in candidate modules), 0 not found", unlisted(9), few(8)]);
      await leavesNothingBehind(slow);
    });

    it("the model is busy for fifteen seconds, and the rule's line item is in one of the four modules being read then: named after fifteen seconds", async () => {
      vi.useFakeTimers({ toFake: [...timers] });
      const others = Array.from({ length: 40 }, (_, index) => other(index + 1));
      serveModel({ [MODULE_VIEWS]: moduleList(others), [at(`/modules/${other(10)}/lineItems`)]: lineItem });
      // From the moment its ninth module is asked for, the model says nothing about line items for fifteen seconds; then it
      // answers everything it was asked meanwhile.
      const reply = ScriptedSocket.reply;
      let busyUntil = 0;
      ScriptedSocket.reply = (socket, frame) => {
        if (frame.command === "SEND" && frame.headers.destination === at(`/modules/${other(9)}/lineItems`)) busyUntil = Date.now() + 15_000;
        if (frame.command === "SEND" && ofTheSearch(frame.headers.destination) && Date.now() < busyUntil) setTimeout(() => reply(socket, frame), busyUntil - Date.now());
        else reply(socket, frame);
      };
      const busy = start();
      // Eight modules are read at once; the four after them wait. After ten seconds they have held their places long enough:
      // four more are asked for, which wait too.
      await vi.advanceTimersByTimeAsync(9_900);
      expect(searched()).toEqual(others.slice(0, 12));
      await vi.advanceTimersByTimeAsync(5_000);
      expect([searched(), busy.named()]).toEqual([others.slice(0, 16), undefined]);
      // When the model answers again, the answers of the four that waited longest count: the tenth has the line item.
      await vi.advanceTimersByTimeAsync(200);
      expect([busy.named(), busy.seen.done?.notes]).toEqual([{ name: "Include?", moduleId: other(10) }, []]);
      expect(lines(busy.log)).toEqual([
        "filter line items: 1 looked for in 0 of 0 candidate modules that have the filtered dimensions and 10 of 40 other modules, in 15 s, 6 reads given up while waiting: "
          + "1 found (0 in candidate modules), 0 not found", few(16)]);
      await leavesNothingBehind(busy);
    });

    it("only the module that has the rule's line item takes twelve seconds: named after twelve seconds, the other modules read meanwhile", async () => {
      vi.useFakeTimers({ toFake: [...timers] });
      const candidates = [1, 2, 3, 4, 5, 6, 7, 8].map(candidate);
      serveModel({ [at("/applicableModules")]: named(candidates), [at(`/modules/${candidate(3)}/lineItems`)]: lineItem });
      slowly(destination => destination === at(`/modules/${candidate(3)}/lineItems`), 12_000);
      const one = start();
      // The seven other modules are read at once, in the three places the slow one leaves. Nothing is left to start, and
      // the search waits for the one answer it has not got: past the ten seconds, for as long as its own time lasts.
      await vi.advanceTimersByTimeAsync(11_900);
      expect([searched(), one.named(), [...one.seen.done?.catalog.lineItemModules ?? []]]).toEqual([candidates, undefined, []]);
      await vi.advanceTimersByTimeAsync(200);
      expect([one.named(), one.seen.done?.notes]).toEqual([{ name: "Include?", moduleId: candidate(3) }, []]);
      expect(lines(one.log)).toEqual([
        "filter line items: 1 looked for in 8 of 8 candidate modules that have the filtered dimensions and 0 of 0 other modules, in 12 s, 0 reads given up while waiting: "
          + "1 found (1 in candidate modules), 0 not found", unlisted(9), few(8)]);
      await leavesNothingBehind(one);
    });

    it("the question which modules have the filtered dimension is answered after twelve seconds, and the model's list of modules did not arrive: named after twelve seconds", async () => {
      vi.useFakeTimers({ toFake: [...timers] });
      const candidates = [1, 2].map(candidate);
      serveModel({ [MODULE_VIEWS]: id => rejected(id, "MODULES_UNAVAILABLE"), [at("/applicableModules")]: named(candidates), [at(`/modules/${candidate(1)}/lineItems`)]: lineItem });
      slowly(destination => destination === at("/applicableModules"), 12_000);
      const late = start();
      // After ten seconds the reading would start with the modules known by then: there are none, and no list to go
      // through. The question goes on waiting, and its answer counts when it comes: the two modules it names are read.
      await vi.advanceTimersByTimeAsync(11_900);
      expect([searched(), late.named()]).toEqual([[], undefined]);
      await vi.advanceTimersByTimeAsync(200);
      expect([searched(), late.named(), late.seen.done?.notes]).toEqual([candidates, { name: "Include?", moduleId: candidate(1) },
        ["Synthetic model: module and saved view names were not available (MODULES_UNAVAILABLE)."]]);
      expect(lines(late.log)).toEqual([
        "filter line items: 1 looked for in 1 of 2 candidate modules that have the filtered dimensions and 0 of 0 other modules, in 12 s, 1 reads given up while waiting: "
          + "1 found (1 in candidate modules), 0 not found", few(2)]);
      await leavesNothingBehind(late);
    });

    it("the first of eight named modules never answers, and the rule's line item is in the fifth: named at once", async () => {
      vi.useFakeTimers({ toFake: [...timers] });
      const candidates = [1, 2, 3, 4, 5, 6, 7, 8].map(candidate);
      serveModel({ [at("/applicableModules")]: named(candidates), [at(`/modules/${candidate(1)}/lineItems`)]: () => "", [at(`/modules/${candidate(5)}/lineItems`)]: lineItem });
      const silent = start();
      // The silent module holds one place. The three others go on moving: the fifth module is asked for as soon as the
      // second has answered, and has the line item.
      await vi.advanceTimersByTimeAsync(100);
      expect([silent.named(), silent.seen.done?.notes, searched()]).toEqual([{ name: "Include?", moduleId: candidate(5) }, [], candidates.slice(0, 7)]);
      // No timer of the search is left behind either: each of its waits ends its own.
      expect(vi.getTimerCount()).toBe(0);
      expect(lines(silent.log)).toEqual([
        "filter line items: 1 looked for in 4 of 8 candidate modules that have the filtered dimensions and 0 of 0 other modules, in 0 s, 3 reads given up while waiting: "
          + "1 found (1 in candidate modules), 0 not found", unlisted(9), few(7)]);
      await leavesNothingBehind(silent);
    });

    it("five modules never answer, one in every four, and the rule's line item is in the twenty-second: named after ten seconds", async () => {
      vi.useFakeTimers({ toFake: [...timers] });
      const candidates = Array.from({ length: 22 }, (_, index) => candidate(index + 1));
      serveModel({ [at("/applicableModules")]: named(candidates), [at(`/modules/${candidate(22)}/lineItems`)]: lineItem,
        ...Object.fromEntries([1, 5, 9, 13, 17].map(n => [at(`/modules/${candidate(n)}/lineItems`), () => ""])) });
      const silent = start();
      // The modules that answer are read as fast as they answer, until the four places are held by four that do not: the
      // first, the fifth, the ninth and the thirteenth.
      await vi.advanceTimersByTimeAsync(9_900);
      expect([searched(), silent.named()]).toEqual([candidates.slice(0, 13), undefined]);
      // After ten seconds they have held their places long enough, and the reading goes on, past the fifth silent module,
      // to the twenty-second. The five that never answered are given up then: they were not refused, and are not logged.
      await vi.advanceTimersByTimeAsync(300);
      expect([silent.named(), silent.seen.done?.notes, searched()]).toEqual([{ name: "Include?", moduleId: candidate(22) }, [], candidates]);
      expect(lines(silent.log)).toEqual([
        "filter line items: 1 looked for in 17 of 22 candidate modules that have the filtered dimensions and 0 of 0 other modules, in 10 s, 5 reads given up while waiting: "
          + "1 found (1 in candidate modules), 0 not found", unlisted(23), few(22)]);
      await leavesNothingBehind(silent);
    });
  });

  it("gives the search for filter line items forty-five seconds in all: nothing is asked for once they are over, what still waits is given up, and a note says how many modules were not read", async () => {
    const timers = ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] as const;
    const others = Array.from({ length: 30 }, (_, index) => other(index + 1));
    const note = (unread: number, of = 30) => `Synthetic model: some filter line items were not found in the 45 seconds allowed for the search: ${unread} of ${of} modules were not read.`;
    const unnamed = `filter rule with an unnamed item (card card-1): unnamed ${FILTER_ITEM}`;
    const few = "fewer than 3 modules with line items were read";

    // A model of thirty other modules, none of which has the rule's line item, that takes eight seconds over each, and
    // refuses to list the line items of the second.
    vi.useFakeTimers({ toFake: [...timers] });
    serveModel({ [MODULE_VIEWS]: moduleList(others), [at(`/modules/${other(2)}/lineItems`)]: id => rejected(id, "LINE_ITEMS_UNAVAILABLE") });
    slowLineItems(8_000);
    const slow = run(withGrid());
    let outcome: unknown = "reading";
    slow.result.then(done => { outcome = done.notes; }, error => { outcome = error; });
    // Four are asked for every eight seconds. The sixth four are asked for after forty and would be answered after
    // forty-eight: until the forty-five are over, they are waited for.
    await vi.advanceTimersByTimeAsync(44_900);
    expect([outcome, searched()]).toEqual(["reading", others.slice(0, 24)]);
    // Then the search is over: the four are given up, no more are asked for, and the run goes on to its end, with a note.
    // Its numbers are of every module that was not read: the four given up, the six never asked for and the one refused.
    await vi.advanceTimersByTimeAsync(200);
    expect([outcome, searched()]).toEqual([[note(11)], others.slice(0, 24)]);
    // The four were not refused: they are not remembered as unreadable, nothing is logged for them, their subscriptions
    // are ended, and their answers, which come three seconds later, change nothing.
    await vi.advanceTimersByTimeAsync(60_000);
    const { catalog } = await slow.result;
    expect([searched(), everyReadEnded(), [...catalog.unreadableModules], [...catalog.lineItemModules]])
      .toEqual([others.slice(0, 24), true, [other(2)], [MODULE, other(1), ...others.slice(2, 20)]]);
    expect(slow.statuses.slice(-6)).toEqual(["Finding filter line items in Synthetic model…",
      ...[4, 8, 12, 16, 20].map(asked => `Finding filter line items in Synthetic model: ${asked} of 30 modules…`)]);
    // The log says how many reads were given up while they waited, that the time ran out, and how many modules were left.
    expect(slow.log.filter(line => /^(filter |line items of)/.test(line))).toEqual([`line items of module ${other(2)}: LINE_ITEMS_UNAVAILABLE`,
      "filter line items: 1 looked for in 0 of 0 candidate modules that have the filtered dimensions and 19 of 30 other modules, in 45 s, 4 reads given up while waiting: 0 found, 1 not found",
      `filter line items: the entity-type bracket chose 0 of the 24 modules asked for; ${few}`,
      "filter line items: the 45 seconds allowed for the search ran out: 11 modules left unread", unnamed]);

    // A rule that a module already read rules out is looked for in the modules the model names only. When the time runs out
    // on those, the note counts them, and not the model's other modules, which were not to be read. Here the cards show
    // three modules, the rule's ID has the entity type of the grid's own line items, and the model names twenty-eight modules.
    ScriptedSocket.sockets = [];
    const [named, GONE] = [Array.from({ length: 28 }, (_, index) => candidate(index + 1)), ITEM(1901, 77)];
    const lineItemsOf = (lineItemId: string) => (id: string) => update(id, { data: [{ lineItemId, lineItemLabel: `Line item ${lineItemId}` }] });
    serveModel({ [MODULE_VIEWS]: moduleList(others.slice(0, 10)), [at("/applicableModules")]: id => update(id, { data: named.map(module => ({ id: module, label: `Module ${module}` })) }),
      [at(`/modules/${MODULE}/lineItems`)]: lineItemsOf(LINE_ITEM), [at(`/modules/${MODULE_3}/lineItems`)]: lineItemsOf(ITEM(1905, 1)), [at(`/modules/${STAFFING}/lineItems`)]: lineItemsOf(ITEM(1909, 1)) });
    slowLineItems(8_000);
    const ruledOut = run([{ cards: ruled(rule([GONE], ["true"]))[0].cards, references: [MODULE, MODULE_3, STAFFING].map(id => ({ kind: "module", id })) }] as unknown as UxPageCardDetails[]);
    // (The two other modules the cards show take their eight seconds before the search begins.)
    await vi.advanceTimersByTimeAsync(8_000 + 45_100);
    expect([(await ruledOut.result).notes, searched()]).toEqual([[note(8, 28)], [MODULE_3, STAFFING, ...named.slice(0, 24)]]);
    expect(ruledOut.log.filter(line => line.startsWith("filter line items:"))).toEqual([
      "filter line items: 1 looked for in 20 of 28 candidate modules that have the filtered dimensions and 0 of 10 other modules, in 45 s, 4 reads given up while waiting: 0 found, 1 not found",
      "filter line items: 28 of the 28 modules the model named are not in its list of modules",
      "filter line items: the entity-type bracket chose 0 of the 24 modules asked for; in the modules read, module IDs and line item entity types rise together (3 modules with line items)",
      `filter line items: of the 1 not found, 1 looked for in the candidate modules only: 1 ruled out, each by a module that was read, which has the line items of its entity type and does not list it (${GONE} by module ${MODULE})`,
      "filter line items: the 45 seconds allowed for the search ran out: 8 modules left unread"]);

    // A model that answers within the time is read whole, and a line item that none of its modules has adds no note.
    ScriptedSocket.sockets = [];
    serveModel({ [MODULE_VIEWS]: moduleList(others) });
    slowLineItems(5_000);
    const whole = run(withGrid());
    await vi.advanceTimersByTimeAsync(40_100);
    expect([(await whole.result).notes, searched()]).toEqual([[], others]);
    expect(whole.log.filter(line => line.startsWith("filter "))).toEqual([
      "filter line items: 1 looked for in 0 of 0 candidate modules that have the filtered dimensions and 30 of 30 other modules, in 40 s, 0 reads given up while waiting: 0 found, 1 not found",
      `filter line items: the entity-type bracket chose 0 of the 30 modules asked for; ${few}`, unnamed]);

    // The time is over with its forty-five thousandth millisecond, and not one later. Here the clock stands still but for
    // the first answer, which comes at that very moment: its place is free and twenty-six modules are left, and no read is
    // started. The three that were asked for with it are given up.
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ["Date"] });
    ScriptedSocket.sockets = [];
    serveModel({ [MODULE_VIEWS]: moduleList(others), [at(`/modules/${other(1)}/lineItems`)]: id => { vi.setSystemTime(Date.now() + 45_000); return update(id, { data: [] }); } });
    const sharp = run(withGrid());
    expect([(await sharp.result).notes, searched()]).toEqual([[note(29)], others.slice(0, 4)]);
    expect(sharp.log.filter(line => line.startsWith("filter line items: 1 looked for"))).toEqual([
      "filter line items: 1 looked for in 0 of 0 candidate modules that have the filtered dimensions and 1 of 30 other modules, in 45 s, 3 reads given up while waiting: 0 found, 1 not found"]);
  });

  it("asks its questions about the filtered dimensions together, starts reading after ten seconds whatever they say, and lets a late answer count", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
    // Six filtered dimensions, and a rule on a line item that no card shows. The axis has two more whose IDs are no IDs:
    // nothing is asked about those.
    const dimensions = [LIST, LIST_2, ...[3, 4, 5, 6].map(n => String(101000000900 + n))];
    const pages = ruled(rule([FILTER_ITEM], ["true"]));
    (pages[0].cards[0] as Any).grid.regions[0].rows.dimensions = [...dimensions, "versions", "0101000000907"].map(id => ({ dimension: { kind: "dimension", id } }));
    const questions = () => sent("SEND").filter(frame => frame.headers.destination === at("/applicableModules")).map(frame => String(JSON.parse(frame.body).dimensions[0]));
    const unsaid = "the model had not said which modules have 6 of the filtered dimensions";
    const note = (what: string) => `Synthetic model: some filter line items were not found in the 45 seconds allowed for the search: ${what}.`;
    const lines = (log: string[]) => log.filter(line => /^(filter |modules for|line items of)/.test(line));
    const few = (asked: number) => `filter line items: the entity-type bracket chose 0 of the ${asked} modules asked for; fewer than 3 modules with line items were read`;
    const unnamed = `filter rule with an unnamed item (card card-1): unnamed ${FILTER_ITEM}`;
    const others = Array.from({ length: 40 }, (_, index) => other(index + 1));

    // When each read was asked for, by the clock.
    const askedAt = new Map<string, number>();
    const send = ScriptedSocket.prototype.send;
    vi.spyOn(ScriptedSocket.prototype, "send").mockImplementation(function (this: ScriptedSocket, data: string) {
      for (const frame of decodeFrames(data).frames) if (frame.command === "SEND" && !askedAt.has(frame.headers.destination)) askedAt.set(frame.headers.destination, Date.now());
      send.call(this, data);
    });

    // The model answers none of the six questions, and its list has three other modules, none with the line item.
    serveModel({ [MODULE_VIEWS]: moduleList(others.slice(0, 3)), [at("/applicableModules")]: () => "" });
    const silent = run(pages);
    let outcome: unknown = "reading";
    silent.result.then(done => { outcome = done.notes; }, error => { outcome = error; });
    // The six are asked at once, and for ten seconds nothing else is.
    await vi.advanceTimersByTimeAsync(9_900);
    expect([outcome, questions(), searched()]).toEqual(["reading", dimensions, []]);
    // Then the reading starts with what is known, ten seconds to the millisecond after the questions were asked: no module
    // was named, so the model's list is gone through.
    await vi.advanceTimersByTimeAsync(200);
    expect(searched()).toEqual(others.slice(0, 3));
    expect(askedAt.get(at(`/modules/${other(1)}/lineItems`))! - askedAt.get(at("/applicableModules"))!).toBe(10_000);
    // Every module of the list is read then, and the six questions can name no module that is left: they are not waited
    // for any longer. The log says of all six that the model had not answered, and nothing was cut short: no note.
    expect([outcome, questions(), everyReadEnded()]).toEqual([[], dimensions, true]);
    expect(lines(silent.log)).toEqual([
      "filter line items: 1 looked for in 0 of 0 candidate modules that have the filtered dimensions and 3 of 3 other modules, in 10 s, 0 reads given up while waiting: 0 found, 1 not found",
      few(3), "filter line items: the model had not said which modules have 6 of the filtered dimensions when no module of its list was left to read: no answer could name another", unnamed]);

    // Without the model's list of modules any module could be named yet: the six are waited for until the time is up, there
    // is no module to read at all, and the note says of all six that the model had not answered.
    ScriptedSocket.sockets = [];
    serveModel({ [MODULE_VIEWS]: id => rejected(id, "MODULES_UNAVAILABLE"), [at("/applicableModules")]: () => "" });
    const listless = run(pages);
    await vi.advanceTimersByTimeAsync(45_100);
    expect([(await listless.result).notes, searched()]).toEqual([["Synthetic model: module and saved view names were not available (MODULES_UNAVAILABLE).", note(unsaid)], []]);

    // One question, answered after twelve seconds, in a model that takes two seconds over a module's line items. The
    // reading starts after ten seconds with the model's list. The answer names two modules that the list does not have, the
    // second with the line item: they go to the front of what is left to read.
    ScriptedSocket.sockets = [];
    const named = [1, 2].map(candidate);
    serveModel({ [MODULE_VIEWS]: moduleList(others), [at("/applicableModules")]: id => update(id, { data: named.map(module => ({ id: module, label: `Module ${module}` })) }),
      [at(`/modules/${named[1]}/lineItems`)]: id => update(id, { data: [{ lineItemId: FILTER_ITEM, lineItemLabel: "Include?" }] }) });
    slowly(destination => destination === at("/applicableModules"), 12_000);
    slowLineItems(2_000);
    const late = run(withGrid());
    await vi.advanceTimersByTimeAsync(11_900);
    expect(searched()).toEqual(others.slice(0, 4));
    await vi.advanceTimersByTimeAsync(200);
    expect(searched()).toEqual([...others.slice(0, 4), ...named, ...others.slice(4, 6)]);
    await vi.advanceTimersByTimeAsync(2_000);
    const done = await late.result;
    expect([done.notes, done.catalog.lineItems.get(FILTER_ITEM), searched()]).toEqual([[], { name: "Include?", moduleId: named[1] }, [...others.slice(0, 4), ...named, ...others.slice(4, 7)]]);
    expect(lines(late.log)).toEqual([
      "filter line items: 1 looked for in 2 of 2 candidate modules that have the filtered dimensions and 4 of 40 other modules, in 14 s, 3 reads given up while waiting: "
        + "1 found (1 in candidate modules), 0 not found", "filter line items: 2 of the 2 modules the model named are not in its list of modules", few(9)]);

    // Two filtered dimensions, each with two modules of its own, and the second question is answered first: the modules are
    // read in the order of the dimensions all the same, as they were when the questions were asked one after another.
    ScriptedSocket.sockets = [];
    const [ofFirst, ofSecond] = [[1, 2].map(candidate), [3, 4].map(candidate)];
    serveModel({ [MODULE_VIEWS]: moduleList([]),
      [at("/applicableModules")]: (id, asked) => update(id, { data: (asked.dimensions[0] === Number(LIST) ? ofFirst : ofSecond).map(module => ({ id: module, label: `Module ${module}` })) }) });
    const reply = ScriptedSocket.reply;
    ScriptedSocket.reply = (socket, frame) => {
      const first = frame.command === "SEND" && frame.headers.destination === at("/applicableModules") && JSON.parse(frame.body).dimensions[0] === Number(LIST);
      if (first) setTimeout(() => reply(socket, frame), 1_000); else reply(socket, frame);
    };
    const two = ruled(rule([FILTER_ITEM], ["true"]));
    (two[0].cards[0] as Any).grid.regions[0].rows.dimensions = [LIST, LIST_2].map(id => ({ dimension: { kind: "dimension", id } }));
    const ordered = run(two);
    await vi.advanceTimersByTimeAsync(900);
    expect([questions().slice(-2), searched()]).toEqual([[LIST, LIST_2], []]);
    await vi.advanceTimersByTimeAsync(200);
    await ordered.result;
    expect(searched()).toEqual([...ofFirst, ...ofSecond]);
  });

  it("asks for the modules that a late answer names at once: they do not wait for the places that reads of other modules hold", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
    const others = Array.from({ length: 40 }, (_, index) => other(index + 1));
    /** A model that says after twelve seconds which modules have the filtered dimension, and takes 10.9 seconds over a
     * module's line items. The last of the modules it names has the rule's line item. */
    const serve = (named: string[]) => {
      ScriptedSocket.sockets = [];
      serveModel({ [MODULE_VIEWS]: moduleList(others), [at("/applicableModules")]: id => update(id, { data: named.map(module => ({ id: module, label: `Module ${module}` })) }),
        [at(`/modules/${named.at(-1)}/lineItems`)]: id => update(id, { data: [{ lineItemId: FILTER_ITEM, lineItemLabel: "Include?" }] }) });
      slowly(destination => destination === at("/applicableModules"), 12_000);
      slowLineItems(10_900);
    };

    // Nine modules are named. After ten seconds the reading began with the model's list, and four of its modules hold the
    // four places when the answer comes. The first four named modules are asked for at once all the same, as soon as they
    // were when the questions were waited for; the next four ten seconds later.
    const nine = Array.from({ length: 9 }, (_, index) => candidate(index + 1));
    serve(nine);
    const late = run(withGrid());
    await vi.advanceTimersByTimeAsync(11_900);
    expect(searched()).toEqual(others.slice(0, 4));
    await vi.advanceTimersByTimeAsync(200);
    expect(searched()).toEqual([...others.slice(0, 4), ...nine.slice(0, 4)]);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(searched()).toEqual([...others.slice(0, 4), ...nine.slice(0, 8)]);
    // The ninth is asked for after thirty-two seconds and has the line item: the rule is named after forty-three. (Had the
    // named modules waited for the four places, the ninth would have been asked for after forty, and answered when the time
    // was over.) Seven of the list's modules were asked for in the places it left free, and are given up.
    await vi.advanceTimersByTimeAsync(21_000);
    const done = await late.result;
    expect([done.catalog.lineItems.get(FILTER_ITEM), done.notes, searched()]).toEqual([{ name: "Include?", moduleId: nine[8] }, [], [...others.slice(0, 4), ...nine, ...others.slice(4, 11)]]);
    expect(late.log.filter(line => line.startsWith("filter line items: 1 looked for"))).toEqual([
      "filter line items: 1 looked for in 9 of 9 candidate modules that have the filtered dimensions and 4 of 40 other modules, in 43 s, 7 reads given up while waiting: "
        + "1 found (1 in candidate modules), 0 not found"]);

    // One module is named: it is asked for at once, and no other module with it, for the four places are still held.
    serve([candidate(1)]);
    const one = run(withGrid());
    await vi.advanceTimersByTimeAsync(12_100);
    expect(searched()).toEqual([...others.slice(0, 4), candidate(1)]);
    await vi.advanceTimersByTimeAsync(11_000);
    expect((await one.result).catalog.lineItems.get(FILTER_ITEM)).toEqual({ name: "Include?", moduleId: candidate(1) });

    // Six modules of the list are named, two of them among the four that are being read. The four others are asked for at
    // once all the same: a read that was asked for as a list module's holds no place against a named module.
    serve([9, 2, 3, 10, 11, 12].map(other));
    const mixed = run(withGrid());
    await vi.advanceTimersByTimeAsync(12_100);
    expect(searched()).toEqual([...others.slice(0, 4), ...[9, 10, 11, 12].map(other)]);
    await vi.advanceTimersByTimeAsync(11_000);
    expect((await mixed.result).catalog.lineItems.get(FILTER_ITEM)).toEqual({ name: "Include?", moduleId: other(12) });
  });

  it("does not wait for a question that can name no module that is left: once every module of the model's list was read or refused, the search ends, and no note says that time ran out", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
    const others = [1, 2, 3].map(other);
    const lines = (log: string[]) => log.filter(line => /^(filter |modules for|line items of)/.test(line));
    const few = (asked: number) => `filter line items: the entity-type bracket chose 0 of the ${asked} modules asked for; fewer than 3 modules with line items were read`;
    const unnamed = `filter rule with an unnamed item (card card-1): unnamed ${FILTER_ITEM}`;
    const unanswered = "filter line items: the model had not said which modules have 1 of the filtered dimensions when no module of its list was left to read: no answer could name another";
    /** Starts a run against a model that never says which modules have the filtered dimension, and says what became of it. */
    const start = (answers: Record<string, (id: string, asked: Any) => string>) => {
      ScriptedSocket.sockets = [];
      serveModel({ [at("/applicableModules")]: () => "", ...answers });
      const { log, result } = run(withGrid());
      const seen: { notes?: string[] } = {};
      void result.then(done => { seen.notes = done.notes; });
      return { log, seen };
    };

    // The model's list has three other modules, none with the rule's line item. For ten seconds the question is waited for;
    // then the reading begins with the list, and is done at once. The question can name no module that is left now: the
    // search ends there, where it used to wait until its forty-five seconds were over.
    const whole = start({ [MODULE_VIEWS]: moduleList(others) });
    await vi.advanceTimersByTimeAsync(9_900);
    expect([whole.seen.notes, searched()]).toEqual([undefined, []]);
    await vi.advanceTimersByTimeAsync(200);
    // The rule keeps its ID, and nothing was cut short: no note. The log says that the model had not answered. The question
    // is given up like a read that waits: its subscription is ended, and nothing is logged for it, then or later.
    expect([whole.seen.notes, searched(), everyReadEnded()]).toEqual([[], others, true]);
    const logged = [
      "filter line items: 1 looked for in 0 of 0 candidate modules that have the filtered dimensions and 3 of 3 other modules, in 10 s, 0 reads given up while waiting: 0 found, 1 not found",
      few(3), unanswered, unnamed];
    expect(lines(whole.log)).toEqual(logged);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(lines(whole.log)).toEqual(logged);

    // A module whose read still waits is left, and one whose read was refused is not: here the second of the three takes
    // twenty seconds and the third is refused. The search waits for the second, and ends when it has answered.
    const slow = start({ [MODULE_VIEWS]: moduleList(others), [at(`/modules/${other(3)}/lineItems`)]: id => rejected(id, "LINE_ITEMS_UNAVAILABLE") });
    slowly(destination => destination === at(`/modules/${other(2)}/lineItems`), 20_000);
    await vi.advanceTimersByTimeAsync(29_900);
    expect(slow.seen.notes).toBeUndefined();
    await vi.advanceTimersByTimeAsync(200);
    expect(slow.seen.notes).toEqual([]);
    expect(lines(slow.log)).toEqual([`line items of module ${other(3)}: LINE_ITEMS_UNAVAILABLE`,
      "filter line items: 1 looked for in 0 of 0 candidate modules that have the filtered dimensions and 2 of 3 other modules, in 30 s, 0 reads given up while waiting: 0 found, 1 not found",
      few(3), unanswered, unnamed]);

    // A list whose modules the cards show already leaves nothing to read from the start. The question has its ten seconds
    // all the same, as every question has: an answer that comes within them is acted on, whatever it names.
    const shown = start({ [MODULE_VIEWS]: moduleList([]) });
    await vi.advanceTimersByTimeAsync(9_900);
    expect(shown.seen.notes).toBeUndefined();
    await vi.advanceTimersByTimeAsync(200);
    expect([shown.seen.notes, searched()]).toEqual([[], []]);

    // When every rule has its line item, a question that went unanswered is nothing to speak of. Here the model answers
    // for the first of two filtered dimensions, with the one other module of its list, which has the line item, and never
    // for the second.
    ScriptedSocket.sockets = [];
    serveModel({ [MODULE_VIEWS]: moduleList([other(1)]), [at("/applicableModules")]: (id, asked) => (asked.dimensions[0] === Number(LIST) ? update(id, { data: [{ id: other(1), label: "Module" }] }) : ""),
      [at(`/modules/${other(1)}/lineItems`)]: id => update(id, { data: [{ lineItemId: FILTER_ITEM, lineItemLabel: "Include?" }] }) });
    const two = ruled(rule([FILTER_ITEM], ["true"]));
    (two[0].cards[0] as Any).grid.regions[0].rows.dimensions = [LIST, LIST_2].map(id => ({ dimension: { kind: "dimension", id } }));
    const found = run(two);
    await vi.advanceTimersByTimeAsync(10_200);
    expect((await found.result).catalog.lineItems.get(FILTER_ITEM)).toEqual({ name: "Include?", moduleId: other(1) });
    expect(lines(found.log)).toEqual([
      "filter line items: 1 looked for in 1 of 1 candidate modules that have the filtered dimensions and 0 of 0 other modules, in 10 s, 0 reads given up while waiting: "
        + "1 found (1 in candidate modules), 0 not found", few(1)]);
  });

  it("goes on waiting for a question that can still name a module, as long as the time lasts: when the model's list did not arrive, or holds modules that were not read", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
    const unsaid = "the model had not said which modules have 1 of the filtered dimensions";
    const note = `Synthetic model: some filter line items were not found in the 45 seconds allowed for the search: ${unsaid}.`;
    const ranOut = `filter line items: the 45 seconds allowed for the search ran out: 0 modules left unread, and ${unsaid}`;
    const said = (log: string[]) => log.filter(line => /ran out|had not said/.test(line));

    // The model's list of modules did not arrive, and the model never says which modules have the filtered dimension: any
    // module could be named yet. The question is waited for until the forty-five seconds are over, and the note says so.
    serveModel({ [MODULE_VIEWS]: id => rejected(id, "MODULES_UNAVAILABLE"), [at("/applicableModules")]: () => "" });
    const listless = run(withGrid());
    const seen: { listless?: string[]; spared?: string[] } = {};
    void listless.result.then(done => { seen.listless = done.notes; });
    await vi.advanceTimersByTimeAsync(44_900);
    expect(seen.listless).toBeUndefined();
    await vi.advanceTimersByTimeAsync(200);
    expect([seen.listless, searched(), said(listless.log)]).toEqual([["Synthetic model: module and saved view names were not available (MODULES_UNAVAILABLE).", note], [], [ranOut]]);

    // The list arrived, but its three modules are not read for this rule: a module the cards show rules its ID out (the
    // three modules they show bear that out), so it is looked for in the modules the model names only. Which those are,
    // only the answer can say: it is waited for until the time is over, and the note says so.
    ScriptedSocket.sockets = [];
    const GONE = ITEM(1901, 77);
    const lineItemsOf = (lineItemId: string) => (id: string) => update(id, { data: [{ lineItemId, lineItemLabel: `Line item ${lineItemId}` }] });
    serveModel({ [MODULE_VIEWS]: moduleList([1, 2, 3].map(other)), [at("/applicableModules")]: () => "",
      [at(`/modules/${MODULE}/lineItems`)]: lineItemsOf(LINE_ITEM), [at(`/modules/${MODULE_3}/lineItems`)]: lineItemsOf(ITEM(1905, 1)), [at(`/modules/${STAFFING}/lineItems`)]: lineItemsOf(ITEM(1909, 1)) });
    const spared = run([{ cards: ruled(rule([GONE], ["true"]))[0].cards, references: [MODULE, MODULE_3, STAFFING].map(id => ({ kind: "module", id })) }] as unknown as UxPageCardDetails[]);
    void spared.result.then(done => { seen.spared = done.notes; });
    await vi.advanceTimersByTimeAsync(44_900);
    expect([seen.spared, searched()]).toEqual([undefined, [MODULE_3, STAFFING]]);
    await vi.advanceTimersByTimeAsync(200);
    expect([seen.spared, searched(), said(spared.log)]).toEqual([[note], [MODULE_3, STAFFING], [ranOut]]);
  });

  it("waits for a question after all once an answer has named a module that the model's list does not hold: the list is then not all that a question can name", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
    const [listed, outside, late] = [[1, 2].map(other), [1, 2, 3].map(candidate), candidate(4)];
    const unsaid = "the model had not said which modules have 1 of the filtered dimensions";
    // Two filtered dimensions, and a rule on a line item that no card shows.
    const pages = ruled(rule([FILTER_ITEM], ["true"]));
    (pages[0].cards[0] as Any).grid.regions[0].rows.dimensions = [LIST, LIST_2].map(id => ({ dimension: { kind: "dimension", id } }));
    /** A model whose list has two other modules. It says at once which modules have the first dimension: `first`. For the
     * second it names one more module, which its list does not hold and which has the rule's line item: after `wait`, or
     * never. */
    const start = (first: string[], wait?: number) => {
      ScriptedSocket.sockets = [];
      const naming = (modules: string[]) => (id: string) => update(id, { data: modules.map(module => ({ id: module, label: `Module ${module}` })) });
      serveModel({ [MODULE_VIEWS]: moduleList(listed), [at("/applicableModules")]: (id, asked) => (asked.dimensions[0] === Number(LIST) ? naming(first)(id) : wait ? naming([late])(id) : ""),
        [at(`/modules/${late}/lineItems`)]: id => update(id, { data: [{ lineItemId: FILTER_ITEM, lineItemLabel: "Include?" }] }) });
      const reply = ScriptedSocket.reply;
      ScriptedSocket.reply = (socket, frame) => {
        const second = frame.command === "SEND" && frame.headers.destination === at("/applicableModules") && JSON.parse(frame.body).dimensions[0] === Number(LIST_2);
        if (second && wait) setTimeout(() => reply(socket, frame), wait); else reply(socket, frame);
      };
      const { log, result } = run(pages);
      const seen: { done?: Awaited<typeof result> } = {};
      void result.then(done => { seen.done = done; });
      return { log, seen };
    };

    // The first answer names three modules that the list does not hold. After ten seconds they and the list's two are read,
    // and none has the line item. The search has seen that a question can name a module outside the list, so the second
    // question is waited for: its answer, after twenty seconds, names the module that has the line item.
    const named = start(outside, 20_000);
    await vi.advanceTimersByTimeAsync(19_900);
    expect([named.seen.done, searched()]).toEqual([undefined, [...outside, ...listed]]);
    await vi.advanceTimersByTimeAsync(200);
    expect([named.seen.done?.catalog.lineItems.get(FILTER_ITEM), named.seen.done?.notes, searched()]).toEqual([{ name: "Include?", moduleId: late }, [], [...outside, ...listed, late]]);
    expect(named.log.filter(line => line.startsWith("filter line items: 1 looked for"))).toEqual([
      "filter line items: 1 looked for in 4 of 4 candidate modules that have the filtered dimensions and 2 of 2 other modules, in 20 s, 0 reads given up while waiting: "
        + "1 found (1 in candidate modules), 0 not found"]);

    // When it never answers, it is waited for as long as the time lasts, and the note says so.
    const silent = start(outside);
    await vi.advanceTimersByTimeAsync(44_900);
    expect(silent.seen.done).toBeUndefined();
    await vi.advanceTimersByTimeAsync(200);
    expect(silent.seen.done?.notes).toEqual([`Synthetic model: some filter line items were not found in the 45 seconds allowed for the search: ${unsaid}.`]);

    // An answer that names modules of the list only shows no such thing: once they are read, no module of the list is
    // left, and the second question is not waited for.
    const within = start(listed);
    await vi.advanceTimersByTimeAsync(10_200);
    expect([within.seen.done?.notes, searched()]).toEqual([[], listed]);
    expect(within.log.filter(line => line.includes("had not said"))).toEqual([`filter line items: ${unsaid} when no module of its list was left to read: no answer could name another`]);
  });

  it("does not wait for the read of another module when every ID still looked for is looked for in the named modules only: it is given up, and the search ends", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
    // The cards show three modules whose line items bear out that a module's line items have an entity type of their own.
    // The rule's ID has the entity type of the line items of the first of the list's three other modules, which does not
    // list it; the other two never answer.
    const [others, WANTED] = [[1, 2, 3].map(other), ITEM(2001, 77)];
    const lineItemsOf = (lineItemId: string) => (id: string) => update(id, { data: [{ lineItemId, lineItemLabel: `Line item ${lineItemId}` }] });
    const shown = [{ cards: ruled(rule([WANTED], ["true"]))[0].cards, references: [MODULE, MODULE_3, STAFFING].map(id => ({ kind: "module", id })) }] as unknown as UxPageCardDetails[];
    const model = { [MODULE_VIEWS]: moduleList(others), [at(`/modules/${MODULE}/lineItems`)]: lineItemsOf(LINE_ITEM), [at(`/modules/${MODULE_3}/lineItems`)]: lineItemsOf(ITEM(1905, 1)),
      [at(`/modules/${STAFFING}/lineItems`)]: lineItemsOf(ITEM(1909, 1)), [at(`/modules/${other(1)}/lineItems`)]: lineItemsOf(ITEM(2001, 0)), [at(`/modules/${other(3)}/lineItems`)]: () => "" };
    const lines = (log: string[]) => log.filter(line => /^(filter line items:|line items of)/.test(line));

    // The model names no module. The three are asked for; the first answers, and rules the ID out: it is looked for in the
    // named modules only from then on, and there are none. The reads of the two others can add nothing: they are not
    // waited for (they used to be, until the forty-five seconds were over), but given up like any read at the search's end.
    serveModel({ ...model, [at(`/modules/${other(2)}/lineItems`)]: () => "" });
    const ended = run(shown);
    const seen: { notes?: string[] } = {};
    void ended.result.then(done => { seen.notes = done.notes; });
    await vi.advanceTimersByTimeAsync(100);
    expect([seen.notes, searched(), everyReadEnded()]).toEqual([[], [MODULE_3, STAFFING, ...others], true]);
    const logged = [
      "filter line items: 1 looked for in 0 of 0 candidate modules that have the filtered dimensions and 1 of 3 other modules, in 0 s, 2 reads given up while waiting: 0 found, 1 not found",
      "filter line items: the entity-type bracket chose 3 of the 3 modules asked for; in the modules read, module IDs and line item entity types rise together (4 modules with line items)",
      `filter line items: of the 1 not found, 1 looked for in the candidate modules only: 1 ruled out, each by a module that was read, which has the line items of its entity type and does not list it (${WANTED} by module ${other(1)})`];
    expect(lines(ended.log)).toEqual(logged);
    await vi.advanceTimersByTimeAsync(120_000);
    expect([lines(ended.log), [...(await ended.result).catalog.unreadableModules]]).toEqual([logged, []]);

    // The read of a module that the model names is waited for all the same: a ruled-out ID is still looked for in every
    // named module. Here the model names the second module, which takes twenty seconds and has the line item after all.
    ScriptedSocket.sockets = [];
    serveModel({ ...model, [at("/applicableModules")]: id => update(id, { data: [{ id: other(2), label: "Module" }] }), [at(`/modules/${other(2)}/lineItems`)]: lineItemsOf(WANTED) });
    slowly(destination => destination === at(`/modules/${other(2)}/lineItems`), 20_000);
    const waited = run(shown);
    const after: { done?: Awaited<typeof waited.result> } = {};
    void waited.result.then(done => { after.done = done; });
    await vi.advanceTimersByTimeAsync(19_900);
    expect(after.done).toBeUndefined();
    await vi.advanceTimersByTimeAsync(200);
    expect([after.done?.catalog.lineItems.get(WANTED), after.done?.notes]).toEqual([{ name: `Line item ${WANTED}`, moduleId: other(2) }, []]);
  });

  it("says how many of the modules the model named are not in its list of modules, when its list arrived and there are any", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    // Two filtered dimensions, a rule on a line item that no module has, and a model whose list has three other modules.
    const pages = ruled(rule([FILTER_ITEM], ["true"]));
    (pages[0].cards[0] as Any).grid.regions[0].rows.dimensions = [LIST, LIST_2].map(id => ({ dimension: { kind: "dimension", id } }));
    const listed = [1, 2, 3].map(other);
    const lines = (log: string[]) => log.filter(line => line.startsWith("filter line items:"));
    const read = (candidates: number, others: number) => `filter line items: 1 looked for in ${candidates} of ${candidates} candidate modules that have the filtered dimensions and `
      + `${others} of ${others} other modules, in 0 s, 0 reads given up while waiting: 0 found, 1 not found`;
    const few = (asked: number) => `filter line items: the entity-type bracket chose 0 of the ${asked} modules asked for; fewer than 3 modules with line items were read`;
    /** Runs against a model that names these modules for the first dimension and those for the second. */
    const logged = async (first: string[], second: string[], list = moduleList(listed)) => {
      ScriptedSocket.sockets = [];
      serveModel({ [MODULE_VIEWS]: list,
        [at("/applicableModules")]: (id, asked) => update(id, { data: (asked.dimensions[0] === Number(LIST) ? first : second).map(module => ({ id: module, label: `Module ${module}` })) }) });
      const { log, result } = run(pages);
      await result;
      return lines(log);
    };

    // The answers name five modules between them: the grid's own and two others of the list, and two that the list does
    // not hold, one of them for both dimensions. (What is no ID is no module.) The line follows the summary's first, and
    // counts each module once: a live run's log shows by it that a question can name a module outside the list.
    const some = [[MODULE, other(1), candidate(1), "abc"], [candidate(1), candidate(2), other(2)]];
    expect(await logged(some[0], some[1])).toEqual([read(4, 1), "filter line items: 2 of the 5 modules the model named are not in its list of modules", few(5)]);
    // Every module named is one of the list: nothing is said.
    expect(await logged([MODULE, other(1)], [other(2)])).toEqual([read(2, 1), few(3)]);
    // The list did not arrive: nothing is said either, for there is no list to hold them. (The summary shows that case: no
    // other module is counted.)
    expect(await logged(some[0], some[1], id => rejected(id, "MODULES_UNAVAILABLE"))).toEqual([read(4, 0), few(4)]);
  });

  it("adds no note when the search left nothing undone: every module was read, or every rule has its line item, although the time is over", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const [candidates, others] = [[1, 2, 3, 4, 5, 6, 7, 8].map(candidate), [1, 2, 3, 4].map(other)];
    /** An answer that comes fifty seconds later by the clock, as after the computer slept. */
    const late = (data: unknown[]) => (id: string) => { vi.setSystemTime(Date.now() + 50_000); return update(id, { data }); };
    const lines = (log: string[]) => log.filter(line => line.startsWith("filter line items:"));
    const few = (asked: number) => `filter line items: the entity-type bracket chose 0 of the ${asked} modules asked for; fewer than 3 modules with line items were read`;

    // The last of the model's four modules answers when the forty-five seconds are over, and none has the rule's line item.
    // Every module was read: no note says that the time ran out, and no line of the log.
    serveModel({ [MODULE_VIEWS]: moduleList(others), [at(`/modules/${other(4)}/lineItems`)]: late([]) });
    const whole = run(withGrid());
    expect((await whole.result).notes).toEqual([]);
    expect(searched()).toEqual(others);
    expect(lines(whole.log)).toEqual([
      "filter line items: 1 looked for in 0 of 0 candidate modules that have the filtered dimensions and 4 of 4 other modules, in 50 s, 0 reads given up while waiting: 0 found, 1 not found", few(4)]);

    // The module that has the rule's line item answers when the forty-five seconds are over. Modules the model named were
    // not read, three of them given up as they waited, and nothing is looked for in them any more: no note either.
    ScriptedSocket.sockets = [];
    serveModel({ [at("/applicableModules")]: id => update(id, { data: candidates.map(module => ({ id: module, label: `Module ${module}` })) }),
      [at(`/modules/${candidate(2)}/lineItems`)]: late([{ lineItemId: FILTER_ITEM, lineItemLabel: "Include?" }]) });
    const found = run(withGrid());
    expect((await found.result).notes).toEqual([]);
    expect(searched()).toEqual(candidates.slice(0, 5));
    expect(lines(found.log)).toEqual([
      "filter line items: 1 looked for in 2 of 8 candidate modules that have the filtered dimensions and 0 of 0 other modules, in 50 s, 3 reads given up while waiting: "
        + "1 found (1 in candidate modules), 0 not found", "filter line items: 8 of the 8 modules the model named are not in its list of modules", few(5)]);
  });

  it("ends the search for filter line items at once when the run is stopped, the model closes or the connection fails, and asks for no further module", async () => {
    const stopped = new Error("Stopped: the results page was closed.");
    const others = Array.from({ length: 16 }, (_, index) => other(index + 1));
    const closed = "Synthetic model: names from the model data service were not available (the model is closed); IDs are shown instead.";
    let status = "";
    const answers = (waiting: string, during: (id: string) => string) => ({ [at("")]: (id: string) => { status = id; return update(id, { status: "UNKNOWN" }); },
      [MODULE_VIEWS]: moduleList(others), [waiting]: during });
    // The model names no module for the filtered dimension, so its list is gone through, four reads moving. The sixth of
    // its other modules is the one whose line items are never answered: by the time it is asked, nine modules have been.
    const waiting = at(`/modules/${other(6)}/lineItems`);
    const failed = (log: string[]) => log.filter(line => /^(filter |line items of)/.test(line));
    const later = () => new Promise(resolve => { setTimeout(resolve, 20); });

    // Stopped while that read waits: no tenth module is asked for, the socket is closed, and the stop is what ends the run.
    // The reads that waited are given up with the search: nothing is logged for them, then or later.
    const stopping = new AbortController();
    serveModel(answers(waiting, () => { stopping.abort(stopped); return ""; }));
    const halted = run(withGrid(), scope, stopping.signal);
    await expect(halted.result).rejects.toBe(stopped);
    await later();
    expect([searched(), sent("DISCONNECT").length, ScriptedSocket.sockets.map(socket => socket.readyState), failed(halted.log)]).toEqual([others.slice(0, 9), 1, [3], []]);

    // The model closes: the same, and the names are reported as not available. The search, which did not come to its end,
    // logs nothing of how far it went.
    ScriptedSocket.sockets = [];
    serveModel(answers(waiting, () => update(status, { status: "CLOSED" })));
    const shut = run(withGrid());
    expect((await shut.result).notes).toEqual([closed]);
    await later();
    expect([searched(), failed(shut.log)]).toEqual([others.slice(0, 9), []]);

    // The connection fails: the same again. The four reads that ended with it are logged as failed, as they always were,
    // and are not remembered as unreadable.
    ScriptedSocket.sockets = [];
    serveModel(answers(waiting, () => SERVICE_DOWN));
    const down = run(withGrid());
    const { notes, catalog } = await down.result;
    await later();
    expect([notes, searched(), failed(down.log), [...catalog.unreadableModules]]).toEqual([[UNAVAILABLE], others.slice(0, 9),
      others.slice(5, 9).map(module => `line items of module ${module}: SERVICE_DOWN`), []]);
  });

  it("asks the model nothing more, in the search for filter line items, once it has reported itself closed", async () => {
    const closed = "Synthetic model: names from the model data service were not available (the model is closed); IDs are shown instead.";
    const [others, candidates] = [Array.from({ length: 12 }, (_, index) => other(index + 1)), [1, 2, 3, 4, 5, 6].map(candidate)];
    const named = { data: candidates.map(module => ({ id: module, label: `Module ${module}` })) };
    /** A grid whose rows have these dimensions and are filtered by a rule on these IDs, none of which a card shows. No item
     * is shown or hidden and no saved view is used, so nothing is read between the grid's dimensions and the search. */
    const rowsOf = (dimensions: string[], ids = [FILTER_ITEM]) => {
      const pages = ruled(rule(ids, ["true"]));
      (pages[0].cards[0] as Any).grid.regions[0].rows.dimensions = dimensions.map(id => ({ dimension: { kind: "dimension", id } }));
      return pages;
    };
    let [status, closedAt] = ["", -1];
    /** The model: its list has twelve modules that were not read, and `answers` are its other answers. */
    const serve = (answers: Record<string, (id: string, asked: Any) => string>) => {
      ScriptedSocket.sockets = [];
      closedAt = -1;
      serveModel({ [at("")]: id => { status = id; return update(id, { status: "UNKNOWN" }); }, [MODULE_VIEWS]: moduleList(others), ...answers });
    };
    const reportsClosed = () => { closedAt = sent("SEND").length; return update(status, { status: "CLOSED" }); };
    const read = (frame: StompFrame) => `${frame.headers.destination.replace(at(""), "")} ${frame.body}`;
    /** What the search asked: every read after the names, the grid's line items and its dimensions. And what was asked,
     * by any step, after the model had reported itself closed. */
    const asked = () => sent("SEND").slice(5).map(read);
    const afterwards = () => sent("SEND").slice(closedAt).map(read);
    const question = (dimension: string) => `/applicableModules {"dimensions":[${dimension}]}`;
    const [LIST_3, lines] = ["101000000903", (log: string[]) => log.filter(line => /^(module dimensions|modules for|filter |line items of)/.test(line))];
    const later = () => new Promise(resolve => { setTimeout(resolve, 20); });

    // Three filtered dimensions: the questions which modules have them are asked together, and the model closes while it
    // is asked the first. Nothing is asked after that, no module's line items either, and the names are reported as not
    // available. A question that ended with the socket work is not logged as one the model refused.
    serve({ [at("/applicableModules")]: reportsClosed });
    const first = run(rowsOf([LIST, LIST_2, LIST_3]));
    expect((await first.result).notes).toEqual([closed]);
    await later();
    expect([asked(), afterwards(), lines(first.log)]).toEqual([[question(LIST), question(LIST_2), question(LIST_3)], [], []]);

    // The first question names six modules, and the model closes as it comes to the second: none of the six is asked for.
    serve({ [at("/applicableModules")]: (id, body) => (body.dimensions[0] === Number(LIST) ? update(id, named) : body.dimensions[0] === Number(LIST_2) ? reportsClosed() : "") });
    const second = run(rowsOf([LIST, LIST_2, LIST_3]));
    expect((await second.result).notes).toEqual([closed]);
    await later();
    expect([asked(), afterwards(), lines(second.log)]).toEqual([[question(LIST), question(LIST_2), question(LIST_3)], [], []]);

    // The model answers the one question and reports itself closed in the same breath: the question has its answer, so
    // nothing that waits is ended by the report, and still none of the six modules is asked for.
    serve({ [at("/applicableModules")]: id => update(id, named) + reportsClosed() });
    const both = run(rowsOf([LIST]));
    expect((await both.result).notes).toEqual([closed]);
    await later();
    expect([asked(), afterwards(), lines(both.log)]).toEqual([[question(LIST)], [], []]);

    // The same with the search's last answer: the one module the model names has the rule's line item, and its answer
    // comes with the report. (Three modules of the list were asked for with it.) The rule's other ID is its context, which
    // the next step would ask the module's dimensions for: that step is not reached, and asks nothing.
    serve({ [at("/applicableModules")]: id => update(id, { data: [{ id: candidate(1), label: "Module" }] }),
      [at(`/modules/${candidate(1)}/lineItems`)]: id => update(id, { data: [{ lineItemId: FILTER_ITEM, lineItemLabel: "Include?" }] }) + reportsClosed() });
    const last = run(rowsOf([LIST], [ITEM(358, 2), FILTER_ITEM]));
    expect((await last.result).notes).toEqual([closed]);
    await later();
    expect([asked(), afterwards(), lines(last.log)]).toEqual([[question(LIST), ...[candidate(1), ...others.slice(0, 3)].map(module => `/modules/${module}/lineItems {}`)], [], []]);

    // And with the search's only answer. Here the model names no module and its list has no other, so the search ends with
    // the answer to its question; and another rule of the grid has its line item and a context item, which the next step
    // asks the module's dimension for. With the report in the same breath as that answer, the next step is not reached.
    const own = { [MODULE_VIEWS]: moduleList([]), [at(`/modules/${MODULE}/lineItems`)]: (id: string) => update(id, { data: [{ lineItemId: LINE_ITEM, lineItemLabel: "Volume" }] }),
      [at("/dimensions")]: (id: string) => update(id, { modules: { [MODULE]: { dimensions: [{ id: LIST, label: "Product" }] } } }) };
    const twoRules = () => ruled(rule([ITEM(358, 2), LINE_ITEM], ["true"]), rule([FILTER_ITEM], ["true"]));
    const contextItem = `/modules/${MODULE}/dimensions/${LIST} {"itemIds":["${ITEM(358, 2)}"],"filter":""}`;
    serve({ ...own, [at("/applicableModules")]: id => update(id, { data: [] }) + reportsClosed() });
    const only = run(twoRules());
    expect((await only.result).notes).toEqual([closed]);
    await later();
    expect([asked(), afterwards(), lines(only.log)]).toEqual([[question(LIST)], [], []]);
    // (A model that stays open is asked for the context item, once the search is over.)
    serve({ ...own });
    await run(twoRules()).result;
    expect(asked()).toEqual([question(LIST), contextItem]);

    // The model closed earlier, while the grid's module dimensions were read: that step logs it as a refused read and goes
    // on. The search then asks nothing at all, and ends as its first read would have ended.
    serve({ [at("/dimensions")]: reportsClosed });
    const earlier = run(rowsOf([LIST, LIST_2]));
    expect((await earlier.result).notes).toEqual(["Synthetic model: module dimensions were not available (the model is closed); context selectors show only those saved on the page.", closed]);
    await later();
    expect([asked(), afterwards(), lines(earlier.log), earlier.statuses.at(-1)]).toEqual([[], [], ["module dimensions: the model is closed"], "Reading module dimensions in Synthetic model…"]);
  });

  it("reads again, on the model's own host, the modules whose line items were being read when the first host redirected", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const candidates = [1, 2, 3, 4, 5, 6, 7, 8].map(candidate);
    // The model names eight modules for the filtered dimension, and the rule's line item is in the seventh. The first host
    // answers the read of the sixth with a redirect: that read, and the two that wait with it, end with the connection.
    let redirected = false;
    serveModel({ [at("/applicableModules")]: id => update(id, { data: [MODULE, ...candidates].map(module => ({ id: module, label: `Module ${module}` })) }),
      [at(`/modules/${candidate(6)}/lineItems`)]: id => {
        if (redirected) return update(id, { data: [] });
        redirected = true;
        return `ERROR\n\n${JSON.stringify({ error: "REDIRECTION_REQUIRED", fqdn: MODEL_HOST })}\0`;
      },
      [at(`/modules/${candidate(7)}/lineItems`)]: id => update(id, { data: [{ lineItemId: FILTER_ITEM, lineItemLabel: "Include?" }] }) });
    const { log, result } = run(withGrid());
    const { catalog, notes } = await result;
    expect(notes).toEqual([]);
    expect(ScriptedSocket.sockets.map(socket => socket.host)).toEqual([FIRST, MODEL_HOST]);
    // A read that ended with the connection says nothing about its module. On the model's own host those three are read;
    // the module the page shows and the five candidates that the first host had answered are not read again, and the rule
    // has its line item.
    const read = (socket: ScriptedSocket) => socket.frames.filter(frame => frame.command === "SEND").flatMap(frame => /\/modules\/(\d+)\/lineItems$/.exec(frame.headers.destination)?.[1] ?? []);
    expect(ScriptedSocket.sockets.map(read)).toEqual([[MODULE, ...candidates], candidates.slice(5)]);
    expect(catalog.lineItems.get(FILTER_ITEM)).toEqual({ name: "Include?", moduleId: candidate(7) });
    // Each is still logged as a read that failed, as it always was.
    expect(log.filter(line => line.startsWith("line items of"))).toEqual(candidates.slice(5).map(module => `line items of module ${module}: REDIRECTION_REQUIRED`));
  });

  it("names the item a filter rule's context is fixed to, and the items a list-formatted line item is compared with", async () => {
    serveModel({
      [MODULE_VIEWS]: id => update(id, { data: [{ id: Number(MODULE), name: "Demand", views: [] }], dimensions: {} }),
      [at("/lists")]: id => update(id, { data: [{ id: LIST, name: "Product" }, { id: REGIONS, name: "Region" }, { id: ROLES, name: "Roles" }] }),
      [at(`/modules/${MODULE}/lineItems`)]: id => update(id, { data: [{ lineItemId: ROLE, lineItemLabel: "Role", ...listFormat(ROLES) },
        { lineItemId: STATUS, lineItemLabel: "Status", ...listFormat(REGIONS) }] }),
      // Every module has the Line Items dimension, and its listing may name it: it holds line items, so it is not asked for items.
      [at("/dimensions")]: id => update(id, { modules: { [MODULE]: { dimensions: [{ id: "20000000012", label: "Line Items" }, { id: LIST, label: "Product" },
        { id: "20000000003", label: "Time" }, { id: REGIONS, label: "Region" }] } } }),
      [at(`/modules/${MODULE}/dimensions/${REGIONS}`)]: selection([ITEM(358, 0), "All regions"], [ITEM(358, 2), "North"]),
      [at("/applicableModules")]: id => update(id, { data: [{ id: Number(STAFFING), label: "Staffing" }, { id: Number(candidate(1)), label: "Other" }] }),
      [at(`/modules/${STAFFING}/dimensions/${ROLES}`)]: selection([ITEM(404, 3), "Planner"]),
    });
    const { log, statuses, result } = run(ruled(
      // What the owner saw: Time follows the page, a second dimension is fixed to its top level item, and the last is the
      // line item, which is compared with an item of the list it is formatted as.
      rule(["20000000003", ITEM(358, 0), ROLE], [ITEM(404, 3)]),
      // A line item formatted as a list its own module has as a dimension, compared with two of that list's items.
      rule([STATUS], [ITEM(358, 2), ITEM(358, 0)])));
    const { catalog, notes } = await result;

    expect(notes).toEqual([]);
    expect([...catalog.listItems]).toEqual([[ITEM(358, 0), "All regions"], [ITEM(358, 2), "North"], [ITEM(404, 3), "Planner"]]);
    // After the names, the line items and the grid's dimensions: one read of item labels per dimension, as for shown and hidden
    // items, and for a list no known module has as a dimension, first the modules that have it. The fixed item is asked of
    // the dimension the rule neither filters nor leaves to the page; nothing is asked twice, and nothing for what is named.
    expect(sent("SEND").slice(5).map(frame => [frame.headers.destination, JSON.parse(frame.body)])).toEqual([
      [at(`/modules/${MODULE}/dimensions/${REGIONS}`), { itemIds: [ITEM(358, 0)], filter: "" }],
      [at("/applicableModules"), { dimensions: [Number(ROLES)] }],
      [at(`/modules/${STAFFING}/dimensions/${ROLES}`), { itemIds: [ITEM(404, 3)], filter: "" }]]);
    expect(sent("SUBSCRIBE").slice(5).map(frame => frame.headers.accept)).toEqual(["widget/selection", undefined, "widget/selection"]);
    expect(statuses.at(-1)).toBe("Reading filter item names in Synthetic model…");
    // The log says per kind what was asked of which module and dimension and how much of it was named, in IDs and keys only.
    expect(log.filter(line => /^(filter |modules with|dimensions of \d+ modules of)/.test(line))).toEqual([
      `filter context items: 1 asked of dimension ${REGIONS} in module ${MODULE}, 1 named (answer: 2 entries of {index, itemId, label})`,
      `filter line item ${ROLE}: format {dataType, hierarchyEntityLongId}, data type ENTITY, items of dimension ${ROLES}`,
      `modules with dimension ${ROLES}: ${STAFFING}, ${candidate(1)}`,
      `filter values: 1 asked of dimension ${ROLES} in module ${STAFFING}, 1 named (answer: 1 entries of {index, itemId, label})`,
      `filter line item ${STATUS}: format {dataType, hierarchyEntityLongId}, data type ENTITY, items of dimension ${REGIONS}`,
      "filter context items: 1 of 1 named", "filter values: 3 of 3 named"]);
    expect(log.join("\n")).not.toMatch(/All regions|North|Planner|Roles|Region\b/);
  });

  it("reads the dimensions of a rule's line item's module that no grid shows, and stops looking for line items once every rule has its own", async () => {
    // The clock stands still, so the search for the line item takes no time by it.
    vi.useFakeTimers({ toFake: ["Date"] });
    const candidates = [1, 2, 3, 4, 5, 6].map(candidate);
    /** The rule's line item is in a module no card shows, with this format. */
    const serve = (dataType: string, list?: string) => {
      ScriptedSocket.sockets = [];
      serveModel({
        [at("/lists")]: id => update(id, { data: [{ id: LIST, name: "Product" }, { id: LIST_2, name: "Territory" }, { id: REGIONS, name: "Region" }] }),
        // The modules that have the filtered dimension: the rule's line item is in the second that was not read yet.
        [at("/applicableModules")]: id => update(id, { data: [MODULE, ...candidates].map(module => ({ id: module, label: `Module ${module}` })) }),
        [at(`/modules/${candidate(2)}/lineItems`)]: id => update(id, { data: [{ lineItemId: FILTER_ITEM, lineItemLabel: "Include?",
          lineItemInfo: { format: { dataType, ...(list ? { hierarchyEntityLongId: Number(list) } : {}) } } }] }),
        // The grid's module with the grids' dimensions; the line item's module only when it is asked for.
        [at("/dimensions")]: (id, asked) => update(id, { modules: Object.fromEntries((asked.moduleIds as string[]).map(module => [module,
          { dimensions: [{ id: LIST, label: "Product" }, { id: LIST_2, label: "Territory" }, ...(module === MODULE ? [] : [{ id: REGIONS, label: "Region" }])] }])) }),
        [at(`/modules/${candidate(2)}/dimensions/${REGIONS}`)]: labels({ [ITEM(358, 2)]: "North" }),
      });
    };
    const lastSent = (count: number) => sent("SEND").map(frame => [frame.headers.destination, JSON.parse(frame.body)]).slice(-count);
    // Territory follows the page, a second dimension is fixed to one item, and the line item is in a module no card shows.
    serve("BOOLEAN");
    const { log, statuses, result } = run(ruled(rule([LIST_2, ITEM(358, 2), FILTER_ITEM], ["true"])));
    const { catalog, notes } = await result;

    expect(notes).toEqual([]);
    expect([catalog.lineItems.get(FILTER_ITEM), [...catalog.listItems]]).toEqual([{ name: "Include?", moduleId: candidate(2) }, [[ITEM(358, 2), "North"]]]);
    // The search ends with the answer that has the line item: the item the rule's context is fixed to is no line item, so
    // the last module is not asked for it, and the three that were asked for by then are given up.
    expect(destinations().filter(destination => destination.endsWith("/lineItems"))).toEqual([MODULE, ...candidates.slice(0, 5)].map(module => at(`/modules/${module}/lineItems`)));
    // Then the module's dimensions, and the item from the one the rule neither filters nor leaves to the page.
    expect(lastSent(2)).toEqual([[at("/dimensions"), { moduleIds: [candidate(2)] }], [at(`/modules/${candidate(2)}/dimensions/${REGIONS}`), { itemIds: [ITEM(358, 2)], filter: "" }]]);
    expect(statuses.slice(-2)).toEqual(["Finding filter line items in Synthetic model…", "Reading filter item names in Synthetic model…"]);
    // The log says how far the search went: the IDs of the rule that had no line item, the modules read of those that have
    // the filtered dimension, and what became of each ID. One of the two was the line item; the other is the rule's
    // context, which is no longer looked for once the rule has its line item.
    expect(log.filter(line => /^(filter |dimensions of)/.test(line))).toEqual(["dimensions of 1 of 1 modules",
      "filter line items: 2 looked for in 2 of 6 candidate modules that have the filtered dimensions and 0 of 0 other modules, in 0 s, 3 reads given up while waiting: "
        + "1 found (1 in candidate modules), 1 the context of rules that now have their line item, 0 not found",
      "filter line items: 7 of the 7 modules the model named are not in its list of modules",
      "filter line items: the entity-type bracket chose 0 of the 5 modules asked for; fewer than 3 modules with line items were read",
      "dimensions of 1 modules of filter line items: 1 read",
      `filter context items: 1 asked of dimension ${REGIONS} in module ${candidate(2)}, 1 named (answer: 1 entries of {itemId, label})`,
      "filter context items: 1 of 1 named"]);
    // The value, true, is no item: nothing is asked for it, and the line item's format is not logged.
    expect(log.join("\n")).not.toContain("filter values");

    // The same for a line item of such a module that is compared with an item, when the listing says it is formatted as a
    // list and not which: the module's dimensions are read, to be asked in turn.
    serve("ENTITY");
    const compared = await run(ruled(rule([FILTER_ITEM], [ITEM(358, 2)]))).result;
    expect([...compared.catalog.listItems]).toEqual([[ITEM(358, 2), "North"]]);
    expect(lastSent(4)).toEqual([[at("/dimensions"), { moduleIds: [candidate(2)] }],
      ...[LIST, LIST_2, REGIONS].map(dimension => [at(`/modules/${candidate(2)}/dimensions/${dimension}`), { itemIds: [ITEM(358, 2)], filter: "" }])]);
    // When the listing does say which list, the item is asked where that list is a dimension: the dimensions of the line
    // item's own module are not needed, and not read.
    serve("ENTITY", ROLES);
    await run(ruled(rule([FILTER_ITEM], [ITEM(404, 3)]))).result;
    expect(destinations().filter(destination => destination === at("/dimensions"))).toHaveLength(1);
    expect(lastSent(3)).toEqual([[at("/applicableModules"), { dimensions: [Number(ROLES)] }],
      ...[MODULE, candidate(1)].map(module => [at(`/modules/${module}/dimensions/${ROLES}`), { itemIds: [ITEM(404, 3)], filter: "" }])]);

    // A module whose dimensions were asked for with the grids' and not given is not asked for them again: the item its rule is
    // fixed to is left as it is, the log says why, and no step is shown for reads that are not made.
    ScriptedSocket.sockets = [];
    serveModel({ [at(`/modules/${MODULE}/lineItems`)]: id => update(id, { data: [{ lineItemId: ROLE, lineItemLabel: "Role", ...listFormat(ROLES) }] }),
      [at("/dimensions")]: id => rejected(id, "DIMENSIONS_UNAVAILABLE") });
    const ungiven = run(ruled(rule(["20000000003", ITEM(358, 0), ROLE], ["true"])));
    expect((await ungiven.result).notes).toEqual(["Synthetic model: module dimensions were not available (DIMENSIONS_UNAVAILABLE); context selectors show only those saved on the page."]);
    expect([destinations().slice(4), ungiven.statuses.at(-1)]).toEqual([[at("/dimensions")], "Reading module dimensions in Synthetic model…"]);
    expect(ungiven.log.filter(line => line.startsWith("filter "))).toEqual([
      `filter context items: 1 of module ${MODULE} not asked: its dimensions are not known`,
      `filter context items: 0 of 1 named; left as IDs: ${ITEM(358, 0)}`,
      `filter rule with an unnamed item (card card-1): dimension 20000000003, unnamed ${ITEM(358, 0)}, line item ${ROLE} of module ${MODULE}`]);
  });

  it("asks for a compared item where its list is a dimension: a module whose dimensions are known, one the model names for the list, or the line item's own", async () => {
    const dimensions = (extra: Record<string, string[]> = {}) => (id: string) => update(id, { modules: Object.fromEntries(Object.entries({ [MODULE]: [LIST, "20000000003", REGIONS], ...extra })
      .map(([module, ids]) => [module, { dimensions: ids.map(dimension => ({ id: dimension, label: `Dimension ${dimension}` })) }])) });
    const DEPUTY = "1901000000013";
    const lineItems = (id: string) => update(id, { data: [{ lineItemId: ROLE, lineItemLabel: "Role", ...listFormat(ROLES) }, { lineItemId: STATUS, lineItemLabel: "Status", ...listFormat(REGIONS) },
      { lineItemId: DEPUTY, lineItemLabel: "Deputy", ...listFormat(ROLES) }] });
    /** The reads after the names, the line items and the grid's dimensions: what naming the rules' items asked. */
    const asked = () => sent("SEND").slice(5).map(frame => [frame.headers.destination.replace(at(""), ""), JSON.parse(frame.body)]);
    const [first, second] = [{ itemIds: [ITEM(404, 3), ITEM(404, 4)], filter: "" }, { itemIds: [ITEM(404, 4)], filter: "" }];
    const roles = rule([ROLE], [ITEM(404, 3), ITEM(404, 4)], "NOT_EQUALS");
    const planner = selection([ITEM(404, 3), "Planner"]);
    let asking: string[] = [];
    for (const [why, answers, pages, reads, left] of [
      // The line item's own module has the list as a dimension: it is asked, and no other.
      ["its own module", { [at(`/modules/${MODULE}/dimensions/${REGIONS}`)]: selection([ITEM(358, 2), "North"]) }, ruled(rule([STATUS], [ITEM(358, 2)])),
        [[`/modules/${MODULE}/dimensions/${REGIONS}`, { itemIds: [ITEM(358, 2)], filter: "" }]], []],
      // Another module whose dimensions are known has it: no need to ask the model which modules do.
      ["a known module", { [at("/dimensions")]: dimensions({ [STAFFING]: [ROLES] }), [at(`/modules/${STAFFING}/dimensions/${ROLES}`)]: selection([ITEM(404, 3), "Planner"], [ITEM(404, 4), "Buyer"]) },
        ruled(roles), [[`/modules/${STAFFING}/dimensions/${ROLES}`, first]], []],
      // Three such modules: the first names one of the two items, the second is asked for the other and has no name for it,
      // and a third is not asked.
      ["two of the known modules", { [at("/dimensions")]: dimensions({ [STAFFING]: [ROLES], [candidate(1)]: [LIST, ROLES], [candidate(2)]: [ROLES] }), [at(`/modules/${STAFFING}/dimensions/${ROLES}`)]: planner },
        ruled(roles), [[`/modules/${STAFFING}/dimensions/${ROLES}`, first], [`/modules/${candidate(1)}/dimensions/${ROLES}`, second]], [ITEM(404, 4)]],
      // The model names three modules for the list, after one whose ID is none: the same two are asked, in the same way.
      ["two of the model's", { [at("/applicableModules")]: (id: string) => update(id, { data: ["its/own", ...[STAFFING, candidate(1), candidate(2)].map(Number)].map(module => ({ id: module, label: "A module" })) }),
        [at(`/modules/${STAFFING}/dimensions/${ROLES}`)]: planner }, ruled(roles),
      [["/applicableModules", { dimensions: [Number(ROLES)] }], [`/modules/${STAFFING}/dimensions/${ROLES}`, first], [`/modules/${candidate(1)}/dimensions/${ROLES}`, second]], [ITEM(404, 4)]],
      // A second line item that is formatted as the same list: the modules found for the list are asked, not looked for again.
      ["the same list again", { [at("/applicableModules")]: (id: string) => update(id, { data: [{ id: Number(STAFFING), label: "A module" }] }), [at(`/modules/${STAFFING}/dimensions/${ROLES}`)]: planner },
        ruled(roles, rule([DEPUTY], [ITEM(404, 5)])),
        [["/applicableModules", { dimensions: [Number(ROLES)] }], [`/modules/${STAFFING}/dimensions/${ROLES}`, first], [`/modules/${STAFFING}/dimensions/${ROLES}`, { itemIds: [ITEM(404, 5)], filter: "" }]],
        [ITEM(404, 4), ITEM(404, 5)]],
      // The model names no module for the list, or does not answer the question: the line item's own module is asked all the same.
      ["none named", { [at(`/modules/${MODULE}/dimensions/${ROLES}`)]: selection([ITEM(404, 3), "Planner"], [ITEM(404, 4), "Buyer"]) }, ruled(roles),
        [["/applicableModules", { dimensions: [Number(ROLES)] }], [`/modules/${MODULE}/dimensions/${ROLES}`, first]], []],
      ["the question refused", { [at("/applicableModules")]: (id: string) => rejected(id, "MODULES_UNAVAILABLE") }, ruled(roles),
        [["/applicableModules", { dimensions: [Number(ROLES)] }], [`/modules/${MODULE}/dimensions/${ROLES}`, first]], [ITEM(404, 3), ITEM(404, 4)]],
    ] as const) {
      ScriptedSocket.sockets = [];
      serveModel({ [at(`/modules/${MODULE}/lineItems`)]: lineItems, [at("/dimensions")]: dimensions(), ...answers });
      const { log, result } = run(pages);
      const { catalog, notes } = await result;
      asking = log.filter(line => line.startsWith("modules with dimension") || line.includes(" asked of "));
      expect(asked(), why).toEqual(reads);
      // An item no read named keeps its ID: the log lists it, and no note is added.
      const values = pages[0].cards.flatMap(card => (card as Any).grid.regions[0].rows.filter.conditions.flatMap((condition: Any) => condition.values as string[]));
      expect(values.filter((value: string) => !catalog.listItems.has(value)), why).toEqual(left);
      expect(log.filter(line => line.startsWith("filter values: ")).at(-1), why)
        .toBe(`filter values: ${values.length - left.length} of ${values.length} named${left.length ? `; left as IDs: ${left.join(", ")}` : ""}`);
      expect(notes, why).toEqual([]);
    }
    // The refused question and the read that had no answer for the items, as the log has them.
    expect(asking).toEqual([`modules with dimension ${ROLES}: MODULES_UNAVAILABLE`,
      `filter values: 2 asked of dimension ${ROLES} in module ${MODULE}, 0 named (answer: 0 entries)`]);
  });

  it("asks for a value only where the listing says it is an item: a time period, or an item of a list; never under a plain format or one that is not given", async () => {
    const [MONTH, UNSAID, ODD, AMOUNT, NOTE, FLAG, DAY, BARE, LOOSE, LISTED] = [21, 22, 23, 24, 25, 26, 27, 28, 29, 30].map(n => `19010000000${n}`);
    const format = (dataType: string) => ({ lineItemInfo: { format: { dataType } } });
    const lineItems = (id: string) => update(id, { data: [{ lineItemId: MONTH, lineItemLabel: "Month", ...format("TIME_ENTITY") }, { lineItemId: UNSAID, lineItemLabel: "Unsaid" },
      { lineItemId: ODD, lineItemLabel: "Odd", ...format("SOMETHING_NEW") }, { lineItemId: AMOUNT, lineItemLabel: "Amount", ...format("NUMBER") },
      { lineItemId: NOTE, lineItemLabel: "Note", ...format("TEXT") }, { lineItemId: FLAG, lineItemLabel: "Flag", ...format("BOOLEAN") },
      { lineItemId: DAY, lineItemLabel: "Day", ...format("DATE") }, { lineItemId: BARE, lineItemLabel: "Bare", ...format("NONE") },
      { lineItemId: LOOSE, lineItemLabel: "Loose", ...format("ENTITY") }, { lineItemId: LISTED, lineItemLabel: "Listed", ...listFormat(ROLES) }] });
    const dimensions = (id: string) => update(id, { modules: { [MODULE]: { dimensions: [LIST, "20000000003", REGIONS].map(dimension => ({ id: dimension, label: `Dimension ${dimension}` })) } } });
    const serve = (answers: Record<string, (id: string, asked: Any) => string> = {}) => {
      ScriptedSocket.sockets = [];
      serveModel({ [at(`/modules/${MODULE}/lineItems`)]: lineItems, [at("/dimensions")]: dimensions, ...answers });
    };
    const asked = (from = 5) => sent("SEND").slice(from).map(frame => [frame.headers.destination.replace(at(""), ""), JSON.parse(frame.body).itemIds]);

    // A line item formatted as a time period is compared with periods: they are items of Time, which its module has.
    serve({ [at(`/modules/${MODULE}/dimensions/20000000003`)]: labels({ "5438300031": "Jan 26" }) });
    const period = await run(ruled(rule([MONTH], ["5438300031"]))).result;
    expect([asked(), [...period.catalog.listItems]]).toEqual([[[`/modules/${MODULE}/dimensions/20000000003`, ["5438300031"]]], [["5438300031", "Jan 26"]]]);

    // The listing says the line item is formatted as a list, and not which: the item is asked of each dimension of the line
    // item's own module in turn, until one names it.
    serve({ [at(`/modules/${MODULE}/dimensions/${REGIONS}`)]: labels({ [ITEM(318, 3)]: "Late" }) });
    const loose = run(ruled(rule([LOOSE], [ITEM(318, 3)], "NOT_EQUALS")));
    expect([...(await loose.result).catalog.listItems]).toEqual([[ITEM(318, 3), "Late"]]);
    expect(asked()).toEqual([LIST, "20000000003", REGIONS].map(dimension => [`/modules/${MODULE}/dimensions/${dimension}`, [ITEM(318, 3)]]));
    expect(loose.log.filter(line => line.startsWith("filter line item"))).toEqual([`filter line item ${LOOSE}: format {dataType}, data type ENTITY, no list named`]);
    // Where an item of the same entity type was named before (here a hidden item of the rows), that module and dimension
    // are asked first, for the items of that type: the item a rule is fixed to, then the items it compares with.
    serve({ [at(`/modules/${MODULE}/dimensions/${LIST}`)]: labels({ [ITEM(318, 9)]: "Old", [ITEM(318, 0)]: "All", [ITEM(318, 3)]: "Late" }) });
    const hiding = ruled(rule([ITEM(318, 0), LOOSE], [ITEM(318, 3), ITEM(318, 4), ITEM(319, 1)]));
    (hiding[0].cards[0] as Any).grid.regions[0].rows.dimensions[0].hides = [{ kind: "listItem", id: ITEM(318, 9) }];
    const hidden = await run(hiding).result;
    expect(asked()).toEqual([[`/modules/${MODULE}/dimensions/${LIST}`, [ITEM(318, 9)]], [`/modules/${MODULE}/dimensions/${LIST}`, [ITEM(318, 0)]],
      [`/modules/${MODULE}/dimensions/${LIST}`, [ITEM(318, 3), ITEM(318, 4)]],
      // What is still unnamed goes through the module's dimensions as before, and nothing is asked of a dimension twice:
      // the one that had no name for an item is asked only for the item of a type nothing was named of.
      [`/modules/${MODULE}/dimensions/${LIST}`, [ITEM(319, 1)]],
      ...["20000000003", REGIONS].map(dimension => [`/modules/${MODULE}/dimensions/${dimension}`, [ITEM(318, 4), ITEM(319, 1)]])]);
    expect([...hidden.catalog.listItems]).toEqual([[ITEM(318, 9), "Old"], [ITEM(318, 0), "All"], [ITEM(318, 3), "Late"]]);

    // A read that names a rule's item is remembered in the same way: the item a rule is compared with is asked where the
    // item it is fixed to, of the same type, was named. A dimension, or a module, whose ID in the service's listing is no
    // ID is never asked: no destination is built from it.
    const odd = (id: string) => update(id, { modules: { [MODULE]: { dimensions: [LIST, "20000000003", "its/own", REGIONS].map(dimension => ({ id: dimension, label: `Dimension ${dimension}` })) },
      "its/own": { dimensions: [{ id: ROLES, label: "Roles" }] } } });
    serve({ [at("/dimensions")]: odd, [at(`/modules/${MODULE}/dimensions/${REGIONS}`)]: labels({ [ITEM(358, 0)]: "All regions", [ITEM(358, 2)]: "North" }) });
    const remembered = await run(ruled(rule(["20000000003", ITEM(358, 0), LOOSE], [ITEM(358, 2)]), rule([LISTED], [ITEM(404, 3)]))).result;
    expect(asked()).toEqual([[`/modules/${MODULE}/dimensions/${REGIONS}`, [ITEM(358, 0)]], [`/modules/${MODULE}/dimensions/${REGIONS}`, [ITEM(358, 2)]],
      // The list of the second rule's line item: the only module known to have it has no ID, so the model is asked which have.
      ["/applicableModules", undefined], [`/modules/${MODULE}/dimensions/${ROLES}`, [ITEM(404, 3)]]]);
    expect([...remembered.catalog.listItems]).toEqual([[ITEM(358, 0), "All regions"], [ITEM(358, 2), "North"]]);

    // Named where an item of its type was named before, a compared item needs no module to be found for its list.
    ScriptedSocket.sockets = [];
    serveModel({ [at(`/modules/${MODULE}/lineItems`)]: lineItems, [at("/dimensions")]: id => update(id, { modules: {} }),
      [at(`/modules/${MODULE}/dimensions/${ROLES}`)]: labels({ [ITEM(404, 9)]: "Old", [ITEM(404, 3)]: "Planner" }) });
    const sameList = ruled(rule([LISTED], [ITEM(404, 3)]));
    (sameList[0].cards[0] as Any).grid.regions[0].rows.dimensions[0] = { dimension: { kind: "dimension", id: ROLES }, hides: [{ kind: "listItem", id: ITEM(404, 9) }] };
    expect([...(await run(sameList).result).catalog.listItems]).toEqual([[ITEM(404, 9), "Old"], [ITEM(404, 3), "Planner"]]);
    expect(asked()).toEqual([[`/modules/${MODULE}/dimensions/${ROLES}`, [ITEM(404, 9)]], [`/modules/${MODULE}/dimensions/${ROLES}`, [ITEM(404, 3)]]]);

    // The listing gives no format, or one that says nothing known: a value is not taken for an item, however much it looks
    // like an ID and although the model has a name for an item of that ID. Nothing is asked for it and no step is shown; the
    // log says what the listing gave and how many values were left, so that a live run shows a listing that names formats
    // otherwise.
    serve({ [at(`/modules/${MODULE}/dimensions/${REGIONS}`)]: labels({ [ITEM(318, 3)]: "Late" }) });
    const unsaid = run(ruled(rule([UNSAID], [ITEM(318, 3), ITEM(318, 4)]), rule([UNSAID], [ITEM(318, 3), "12"], "NOT_EQUALS"), rule([ODD], [ITEM(318, 3)])));
    expect([...(await unsaid.result).catalog.listItems]).toEqual([]);
    expect([asked(), unsaid.statuses.at(-1), unsaid.log.filter(line => line.startsWith("filter "))]).toEqual([[], "Reading module dimensions in Synthetic model…", [
      `filter line item ${UNSAID}: no format in the line items listing; 2 of its values look like IDs and are not asked for: it is not said to be formatted as a list`,
      `filter line item ${ODD}: format {dataType}, data type SOMETHING_NEW; 1 of its values look like IDs and are not asked for: it is not said to be formatted as a list`]]);

    // Under a plain format a value is never an item either, and that is all there is to it: nothing is asked, and nothing logged.
    serve();
    const { statuses, log, result } = run(ruled(...[AMOUNT, NOTE, FLAG, DAY, BARE].map(lineItem => rule([lineItem], [ITEM(318, 3)]))));
    await result;
    expect([asked(), statuses.at(-1), log.filter(line => line.startsWith("filter "))]).toEqual([[], "Reading module dimensions in Synthetic model…", []]);
  });

  it("keeps the reads that name filter items bounded, and the log: a refused read is logged and the next place is asked, two unanswered reads end the asking, and so do forty reads", async () => {
    const lineItems = (id: string) => update(id, { data: [{ lineItemId: ROLE, lineItemLabel: "Role", ...listFormat(ROLES) }] });
    const dimensionsOf = (ids: string[]) => (id: string) => update(id, { modules: { [MODULE]: { dimensions: ids.map(dimension => ({ id: dimension, label: `Dimension ${dimension}` })) } } });
    const fixed = ruled(rule(["20000000003", ITEM(358, 0), ROLE], ["true"]));
    const asked = () => destinations().slice(5).map(destination => destination.replace(at(`/modules/${MODULE}/dimensions/`), ""));
    const others = [1, 2, 3, 4].map(n => String(101000000920 + n));

    // The service refuses the read of one dimension: that is logged, and the next dimension is asked.
    serveModel({ [at(`/modules/${MODULE}/lineItems`)]: lineItems, [at("/dimensions")]: dimensionsOf([LIST, others[0], REGIONS]),
      [at(`/modules/${MODULE}/dimensions/${others[0]}`)]: id => rejected(id, "NOT_A_DIMENSION_OF_THE_MODULE"),
      [at(`/modules/${MODULE}/dimensions/${REGIONS}`)]: labels({ [ITEM(358, 0)]: "All regions" }) });
    const refused = run(fixed);
    expect([...(await refused.result).catalog.listItems]).toEqual([[ITEM(358, 0), "All regions"]]);
    expect(asked()).toEqual([others[0], REGIONS]);
    expect(refused.log.filter(line => line.startsWith("filter context items"))).toEqual([
      `filter context items: 1 asked of dimension ${others[0]} in module ${MODULE}: NOT_A_DIMENSION_OF_THE_MODULE`,
      `filter context items: 1 asked of dimension ${REGIONS} in module ${MODULE}, 1 named (answer: 1 entries of {itemId, label})`,
      "filter context items: 1 of 1 named"]);

    // The service does not answer: after ten seconds the next dimension is asked, and after two such reads no more are.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
    ScriptedSocket.sockets = [];
    serveModel({ [at(`/modules/${MODULE}/lineItems`)]: lineItems, [at("/dimensions")]: dimensionsOf([LIST, ...others]),
      ...Object.fromEntries(others.map(dimension => [at(`/modules/${MODULE}/dimensions/${dimension}`), () => ""])) });
    const unanswered = run(fixed);
    let outcome: unknown = "reading";
    unanswered.result.then(done => { outcome = done.notes; }, error => { outcome = error; });
    await vi.advanceTimersByTimeAsync(9_999);
    expect([outcome, asked()]).toEqual(["reading", others.slice(0, 1)]);
    await vi.advanceTimersByTimeAsync(10_000);
    expect([outcome, asked()]).toEqual(["reading", others.slice(0, 2)]);
    // Twenty seconds after the first: the run goes on at once, to its end.
    await vi.advanceTimersByTimeAsync(101);
    expect([outcome, asked()]).toEqual([[], others.slice(0, 2)]);
    expect(unanswered.log.filter(line => line.startsWith("filter "))).toEqual([
      ...others.slice(0, 2).map(dimension => `filter context items: 1 asked of dimension ${dimension} in module ${MODULE}: Timed out waiting for ${at(`/modules/${MODULE}/dimensions/${dimension}`)}.`),
      `filter context items: 0 of 1 named; left as IDs: ${ITEM(358, 0)}`, "filter item names: two reads went unanswered, no more were made",
      `filter rule with an unnamed item (card card-1): dimension 20000000003, unnamed ${ITEM(358, 0)}, line item ${ROLE} of module ${MODULE}`]);
    vi.useRealTimers();

    // A module of fifty dimensions, none of which has the item: forty are asked.
    const fifty = Array.from({ length: 50 }, (_, index) => String(101000001000 + index));
    ScriptedSocket.sockets = [];
    serveModel({ [at(`/modules/${MODULE}/lineItems`)]: lineItems, [at("/dimensions")]: dimensionsOf(fifty) });
    const many = run(fixed);
    expect((await many.result).notes).toEqual([]);
    expect(asked()).toEqual(fifty.slice(0, 40));
    expect(many.log.filter(line => line.startsWith("filter ")).slice(-3)).toEqual([`filter context items: 0 of 1 named; left as IDs: ${ITEM(358, 0)}`,
      "filter item names: no more than 40 reads are made",
      `filter rule with an unnamed item (card card-1): dimension 20000000003, unnamed ${ITEM(358, 0)}, line item ${ROLE} of module ${MODULE}`]);

    // The log is kept bounded too: of the IDs, and of the rules, that were left as they are, it lists thirty and counts the rest.
    const crowd = Array.from({ length: 33 }, (_, index) => ITEM(358, index));
    ScriptedSocket.sockets = [];
    serveModel({ [at(`/modules/${MODULE}/lineItems`)]: lineItems, [at("/dimensions")]: dimensionsOf([LIST, REGIONS]) });
    const crowded = run(ruled(...crowd.map(item => rule([item, ROLE], ["true"]))));
    await crowded.result;
    expect(crowded.log.filter(line => line.startsWith("filter "))).toEqual([
      ...[REGIONS, LIST].map(dimension => `filter context items: 33 asked of dimension ${dimension} in module ${MODULE}, 0 named (answer: 0 entries)`),
      `filter context items: 0 of 33 named; left as IDs: ${crowd.slice(0, 30).join(", ")} and 3 more`,
      ...crowd.slice(0, 30).map(item => `filter rule with an unnamed item (card card-1): unnamed ${item}, line item ${ROLE} of module ${MODULE}`),
      "filter rules with an unnamed item: 3 more are not listed"]);
  });

  it("gives the naming of filter items thirty seconds in all: no read is made once they are over, the one that waits is given up, and an item that was not reached keeps its ID as if the model had no name for it", async () => {
    /** Makes the model slow to name items: each read of item labels, and the question which modules have a list, is answered only after `wait`. */
    const slowly = (wait: number) => {
      const reply = ScriptedSocket.reply;
      ScriptedSocket.reply = (socket, frame) => {
        const naming = frame.command === "SEND" && /\/(dimensions\/\d+|applicableModules)$/.test(frame.headers.destination);
        if (naming) setTimeout(() => reply(socket, frame), wait); else reply(socket, frame);
      };
    };
    const timers = ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] as const;

    // A module of twelve dimensions, none of which has the item a rule is fixed to. The first never answers, and each of the
    // others says after three seconds that it has no name: no read waits ten seconds but the first, so neither the forty
    // reads nor the two unanswered ones end the asking.
    vi.useFakeTimers({ toFake: [...timers] });
    const places = Array.from({ length: 12 }, (_, index) => String(101000000940 + index));
    const lineItems = (id: string) => update(id, { data: [{ lineItemId: ROLE, lineItemLabel: "Role", ...listFormat(ROLES) }] });
    const dimensionsOf = (ids: string[]) => (id: string) => update(id, { modules: { [MODULE]: { dimensions: ids.map(dimension => ({ id: dimension, label: `Dimension ${dimension}` })) } } });
    const fixed = ruled(rule(["20000000003", ITEM(358, 0), ROLE], ["true"]));
    serveModel({ [at(`/modules/${MODULE}/lineItems`)]: lineItems, [at("/dimensions")]: dimensionsOf(places), [at(`/modules/${MODULE}/dimensions/${places[0]}`)]: () => "" });
    slowly(3_000);
    const slow = run(fixed);
    const asked = () => destinations().slice(5).map(destination => destination.replace(at(`/modules/${MODULE}/dimensions/`), ""));
    let outcome: unknown = "reading";
    slow.result.then(done => { outcome = [done.notes, [...done.catalog.listItems]]; }, error => { outcome = error; });
    // The eighth read is made 28 seconds after the first and would be answered after 31: until the thirty are over it waits.
    await vi.advanceTimersByTimeAsync(29_999);
    expect([outcome, asked()]).toEqual(["reading", places.slice(0, 8)]);
    // Then it is given up, no ninth is made, and the run goes on to its end: the item has no name, and no note is added.
    await vi.advanceTimersByTimeAsync(101);
    expect([outcome, asked()]).toEqual([[[], []], places.slice(0, 8)]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(asked()).toEqual(places.slice(0, 8));
    expect(slow.statuses.at(-1)).toBe("Reading filter item names in Synthetic model…");
    // The log says so, with what was asked, what was named and what was left unasked. A read that was given up because the
    // time was up is not one of the two that may go unanswered.
    const waited = (place: string) => `filter context items: 1 asked of dimension ${place} in module ${MODULE}: Timed out waiting for ${at(`/modules/${MODULE}/dimensions/${place}`)}.`;
    expect(slow.log.filter(line => line.startsWith("filter "))).toEqual([waited(places[0]),
      ...places.slice(1, 7).map(place => `filter context items: 1 asked of dimension ${place} in module ${MODULE}, 0 named (answer: 0 entries)`), waited(places[7]),
      `filter context items: 0 of 1 named; left as IDs: ${ITEM(358, 0)}`,
      "filter item names: the 30 seconds allowed for them ran out after 8 reads: 1 items asked for, 0 named, the asking of 1 not finished",
      `filter rule with an unnamed item (card card-1): dimension 20000000003, unnamed ${ITEM(358, 0)}, line item ${ROLE} of module ${MODULE}`]);

    // The read that is given up may be the last there was to make, and the only one that asked for an item. Four places
    // that take nine seconds each: the third names the item a rule is fixed to, and the fourth is the list Status is
    // formatted as. The item Status is compared with was asked for all the same, and not to the end.
    ScriptedSocket.sockets = [];
    serveModel({ [at(`/modules/${MODULE}/lineItems`)]: id => update(id, { data: [{ lineItemId: ROLE, lineItemLabel: "Role", ...listFormat(ROLES) },
      { lineItemId: STATUS, lineItemLabel: "Status", ...listFormat(places[3]) }] }), [at("/dimensions")]: dimensionsOf(places.slice(0, 4)),
    [at(`/modules/${MODULE}/dimensions/${places[2]}`)]: labels({ [ITEM(358, 0)]: "All regions" }), [at(`/modules/${MODULE}/dimensions/${places[3]}`)]: labels({ [ITEM(318, 1)]: "Open" }) });
    slowly(9_000);
    const last = run(ruled(rule(["20000000003", ITEM(358, 0), ROLE], ["true"]), rule([STATUS], [ITEM(318, 1)])));
    await vi.advanceTimersByTimeAsync(30_100);
    expect([[...(await last.result).catalog.listItems], asked()]).toEqual([[[ITEM(358, 0), "All regions"]], places.slice(0, 4)]);
    expect(last.log.filter(line => line.startsWith("filter ")).slice(-4)).toEqual([
      `filter values: 1 asked of dimension ${places[3]} in module ${MODULE}: Timed out waiting for ${at(`/modules/${MODULE}/dimensions/${places[3]}`)}.`,
      "filter context items: 1 of 1 named", `filter values: 0 of 1 named; left as IDs: ${ITEM(318, 1)}`,
      "filter item names: the 30 seconds allowed for them ran out after 4 reads: 2 items asked for, 1 named, the asking of 1 not finished"]);

    // The time may also be up between two reads, with none waiting: here the clock is 31 seconds further on when the first
    // place has answered, as after the computer slept. The next place is not asked, and the log says the same.
    ScriptedSocket.sockets = [];
    serveModel({ [at(`/modules/${MODULE}/lineItems`)]: lineItems, [at("/dimensions")]: dimensionsOf(places.slice(0, 3)),
      [at(`/modules/${MODULE}/dimensions/${places[0]}`)]: id => { vi.setSystemTime(Date.now() + 31_000); return update(id, { data: [] }); } });
    const slept = run(fixed);
    await vi.advanceTimersByTimeAsync(100);
    expect([(await slept.result).notes, asked()]).toEqual([[], places.slice(0, 1)]);
    expect(slept.log.filter(line => line.startsWith("filter "))).toEqual([`filter context items: 1 asked of dimension ${places[0]} in module ${MODULE}, 0 named (answer: 0 entries)`,
      `filter context items: 0 of 1 named; left as IDs: ${ITEM(358, 0)}`,
      "filter item names: the 30 seconds allowed for them ran out after 1 reads: 1 items asked for, 0 named, the asking of 1 not finished",
      `filter rule with an unnamed item (card card-1): dimension 20000000003, unnamed ${ITEM(358, 0)}, line item ${ROLE} of module ${MODULE}`]);

    // An app whose model takes nine seconds over each such read: the item a rule is fixed to is named after 18 seconds, the
    // two that Status is compared with after 27, and the thirty are over before the model has said where Role's list is.
    const names = { [at(`/modules/${MODULE}/dimensions/${REGIONS}`)]: labels({ [ITEM(358, 0)]: "All regions" }),
      [at(`/modules/${MODULE}/dimensions/${STATUSES}`)]: labels({ [ITEM(318, 1)]: "Open", [ITEM(318, 2)]: "Closed" }) };
    const lines: string[] = [];
    const analyse = () => analyseApp(GOLDEN_APP, { status: () => undefined, log: line => { lines.push(line); } }, () => "");
    vi.setSystemTime(new Date(Date.UTC(2026, 8, 28, 12, 30, 10)));
    serveStaffApp(names);
    slowly(9_000);
    let late: Awaited<ReturnType<typeof analyse>> | undefined;
    void analyse().then(result => { late = result; });
    await vi.advanceTimersByTimeAsync(29_999);
    expect(late).toBeUndefined();
    await vi.advanceTimersByTimeAsync(101);
    expect(late).toBeDefined();
    expect(lines.filter(line => /^(filter |modules with)/.test(line))).toEqual([
      `filter context items: 1 asked of dimension ${LIST_2} in module ${MODULE}, 0 named (answer: 0 entries)`,
      `filter context items: 1 asked of dimension ${REGIONS} in module ${MODULE}, 1 named (answer: 1 entries of {itemId, label})`,
      `filter line item ${STATUS}: format {dataType, hierarchyEntityLongId}, data type ENTITY, items of dimension ${STATUSES}`,
      `filter values: 2 asked of dimension ${STATUSES} in module ${MODULE}, 2 named (answer: 2 entries of {itemId, label})`,
      `filter line item ${ROLE}: format {dataType, hierarchyEntityLongId}, data type ENTITY, items of dimension ${ROLES}`,
      `modules with dimension ${ROLES}: Timed out waiting for ${at("/applicableModules")}.`,
      "filter context items: 1 of 1 named", `filter values: 2 of 3 named; left as IDs: ${ITEM(404, 3)}`,
      "filter item names: the 30 seconds allowed for them ran out after 4 reads: 3 items asked for, 3 named, the asking of 1 not finished"]);
    // The files have the names that were found in time, and the ID of the item that was not reached.
    const filters = late!.tables.find(table => table.file === "Filters.csv")!;
    expect(filters.rows.map(row => ["Condition line item", "Value", "Condition context"].map(header => row[filters.headers.indexOf(header)]))).toEqual([
      ["Status", "Closed", NONE], ["Status", "Open", NONE], ["Status", "Closed, Open", "Territory = current"], ["Role", ITEM(404, 3), "Time = current; All regions"]]);
    // They are, file for file, what they are when the model answers at once and has no name for that item.
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.UTC(2026, 8, 28, 12, 30, 10)));
    serveStaffApp(names);
    const unnamed = await analyse();
    expect(unnamed.tables.find(table => table.file === "Filters.csv")!.rows.at(-1)).toContain(ITEM(404, 3));
    expect([late!.tables, late!.summary, late!.zipName]).toEqual([unnamed.tables, unnamed.summary, unnamed.zipName]);
  });

  it("ends the socket work at once when the run is stopped, the model closes or the connection fails while filter items are named", async () => {
    const stopped = new Error("Stopped: the results page was closed.");
    const others = [1, 2].map(n => String(101000000920 + n));
    const fixed = ruled(rule(["20000000003", ITEM(358, 0), ROLE], ["true"]));
    const waiting = at(`/modules/${MODULE}/dimensions/${others[0]}`);
    const answers = (during: (id: string) => string) => ({ [at("")]: (id: string) => { status = id; return update(id, { status: "UNKNOWN" }); },
      [at(`/modules/${MODULE}/lineItems`)]: (id: string) => update(id, { data: [{ lineItemId: ROLE, lineItemLabel: "Role" }] }),
      [at("/dimensions")]: (id: string) => update(id, { modules: { [MODULE]: { dimensions: [LIST, ...others, REGIONS].map(dimension => ({ id: dimension, label: `Dimension ${dimension}` })) } } }),
      [waiting]: during });
    let status = "";

    // Stopped while the first dimension is asked: that read is the last, the socket is closed and the stop is what ends the run.
    const stopping = new AbortController();
    serveModel(answers(() => { stopping.abort(stopped); return ""; }));
    await expect(run(fixed, scope, stopping.signal).result).rejects.toBe(stopped);
    expect([destinations().at(-1), sent("DISCONNECT").length, ScriptedSocket.sockets.map(socket => socket.readyState)]).toEqual([waiting, 1, [3]]);

    // The model closes, or the connection fails: the next dimension is not asked, and the names are reported as not available.
    for (const [during, reason] of [[() => update(status, { status: "CLOSED" }), "the model is closed"], [() => SERVICE_DOWN, "SERVICE_DOWN"]] as const) {
      ScriptedSocket.sockets = [];
      serveModel(answers(during));
      const { log, result } = run(fixed);
      expect((await result).notes, reason).toEqual([`Synthetic model: names from the model data service were not available (${reason}); IDs are shown instead.`]);
      expect(destinations().at(-1), reason).toBe(waiting);
      expect(log.filter(line => line.startsWith("filter ")), reason).toEqual([]);
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

    // The Details file says the same, each number on a line of its own. (It is read from the result's own table here: a
    // file writes a cell's line break as " / ".)
    expect(result.tables[0].rows.find(row => row[1] === "Pages analysed")).toEqual(["App", "Pages analysed", "0 of 1 (published versions)\n1 unpublished, not analysed"]);
    const files = unzipText(resultZip(result));
    const details = parseCsv(files.get("App Details.csv") ?? "");
    expect(details.filter(row => row[0] === "Notes" && row[1] !== "Names")).toEqual([["Notes", "Draft", "Not published"], ["Notes", "Restricted", "Not analysed: no access"]]);
    const [headers, ...rows] = parseCsv(files.get("Pages.csv") ?? "");
    const [page, state] = [headers.indexOf("Page"), headers.indexOf("Publish state")];
    expect(rows.map(row => [row[page], row[state]])).toEqual([["Draft", "Not published"], ["Restricted", "Not analysed: no access"]]);
    expect(rows.filter(row => row[state] === "Not published")).toHaveLength(1);
  });

  it("reads an app's pages four at a time, started in the app's order, and lists them in that order whichever is answered first", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.UTC(2026, 8, 28, 1, 59, 9)));
    const pages = Array.from({ length: 6 }, (_, index) => ({ guid: guid(4001 + index), name: `Page ${index + 1}`, pageType: "BOARD", hasPublishedVersion: true }));
    // Each page's board waits until the test answers it; the other routes answer at once that there is no such page.
    const boards: { page: string; answer: () => void }[] = [];
    let [open, most] = [0, 0];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const path = new URL(url).pathname;
      if (path.includes("/apps/")) return new Response(JSON.stringify({ name: "Plan", pages }), { status: 200 });
      if (path.includes("/boards/")) {
        most = Math.max(most, ++open);
        await new Promise<void>(resolve => { boards.push({ page: path.split("/").pop()!, answer: resolve }); });
        open--;
      }
      return new Response("{}", { status: 404 });
    }));
    const [statuses, logged]: string[][] = [[], []];
    const done = analyseApp("01234567-89ab-cdef-0123-456789abcdef", { status: text => { statuses.push(text); }, log: line => { logged.push(line); } }, () => "");
    await vi.waitFor(() => expect(boards).toHaveLength(4));
    expect(boards.map(board => board.page)).toEqual(pages.slice(0, 4).map(page => page.guid));
    // The third page is answered first: the fifth starts in its place, the others still waiting.
    boards[2].answer();
    await vi.waitFor(() => expect(boards).toHaveLength(5));
    expect(boards[4].page).toBe(pages[4].guid);
    // The rest are answered last first, and the sixth page as soon as it is asked.
    for (const index of [4, 3, 1, 0]) boards[index].answer();
    await vi.waitFor(() => expect(boards).toHaveLength(6));
    boards[5].answer();
    const result = await done;
    expect([most, boards.map(board => board.page)]).toEqual([4, pages.map(page => page.guid)]);
    expect(statuses.slice(1, 7)).toEqual(pages.map((page, index) => `Reading page ${index + 1} of 6: ${page.name}`));
    const table = result.tables.find(each => each.file === TAB_FILES.Pages)!;
    expect(table.rows.map(row => row[table.headers.indexOf("Page")])).toEqual(pages.map(page => page.name));
    // The log says how long the app's record and its pages took to read, before the report is built.
    expect(logged.filter(line => line.startsWith("Time: ")).map(line => line.replace(/\d+\.\d\d s/g, "… s"))).toEqual(["Time: app … s, 6 pages, 4 at a time … s"]);
  });

  it("writes each category and each model of the app on a line of its own, and the pages left unpublished on a line after those analysed", async () => {
    // The app of the 0.6.1 zip with three categories, and with a second board, on a model of another workspace, beside
    // its own board and the page it never published. The second model is not scripted: it answers every read with no
    // data, which leaves its board's cards unnamed and changes nothing that is looked at here.
    const [SUPPLY, OTHER_WS, OTHER_MODEL] = [guid(3000), "11112222333344445555666677778888", "AAAABBBBCCCCDDDDEEEEFFFF00001111"];
    const supplyBoard: Any = { ...goldenBoard, pageGuid: SUPPLY, name: "Supply board", categoryGuid: guid(3001), workspaceId: OTHER_WS, modelId: OTHER_MODEL,
      modelInfo: { modelName: "Model two", workspaceName: "Workspace two" }, modelInfos: [{ workspaceId: OTHER_WS, modelId: OTHER_MODEL }] };
    const categories = [{ guid: guid(1001), name: "Demand" }, { guid: guid(3001), name: "Supply" }, { guid: guid(3002), name: "00 Admin" }];
    const pages = [{ guid: guid(1000), name: "Demand board", pageType: "BOARD", categoryGuid: guid(1001), hasPublishedVersion: true },
      { guid: SUPPLY, name: "Supply board", pageType: "BOARD", categoryGuid: guid(3001), hasPublishedVersion: true },
      { guid: guid(2000), name: "Draft page", pageType: "BOARD", categoryGuid: guid(3002), hasPublishedVersion: false }];
    /** What App Details.csv says of the categories, the models and the pages analysed of the app with these categories
     * and pages: each value as the result's own table holds it, for a file would write its line breaks as " / ". */
    const listed = async (app: { categories: Any[]; pages: Any[] }): Promise<string[]> => {
      serveGoldenApp();
      const golden = globalThis.fetch;
      const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
      vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
        const path = new URL(url).pathname;
        if (path.endsWith(`/apps/${GOLDEN_APP}`)) return json({ name: "Planning: app", ...app });
        return path.endsWith(`/boards/${SUPPLY}`) ? json(supplyBoard) : golden(url, init);
      }));
      const result = await analyseApp(GOLDEN_APP, { status: () => undefined, log: () => undefined }, () => "");
      return ["Categories", "Models", "Pages analysed"].map(detail => String(result.tables[0].rows.find(row => row[0] === "App" && row[1] === detail)?.[2]));
    };

    // Three categories and two models: each on a line of its own, in the order of the app's categories and of its pages,
    // and no semicolon between them. A page was left unpublished, and that is said on a line after the pages analysed.
    const several = await listed({ categories, pages });
    expect(several.map(value => value.split("\n"))).toEqual([["Demand", "Supply", "00 Admin"], ["Model one (Workspace one)", "Model two (Workspace two)"],
      ["2 of 2 (published versions)", "1 unpublished, not analysed"]]);
    expect(several.filter(value => value.includes(";"))).toEqual([]);
    // One category and one model, and no page left unpublished: each value is one line.
    expect(await listed({ categories: categories.slice(0, 1), pages: pages.slice(0, 1) })).toEqual(["Demand", "Model one (Workspace one)", "1 of 1 (published versions)"]);
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

  it("says in plain words why the app could not be read, by what Anaplan answered, and keeps the code and the status for the log", async () => {
    const read = vi.spyOn(rest, "getJson");
    const analyse = () => analyseApp("01234567-89ab-cdef-0123-456789abcdef", { status: () => undefined, log: () => undefined }, () => "");
    const failed = "Anaplan answered with an error. Wait a moment, then choose Run again. If it keeps happening, choose Copy diagnostic log and send the log.";
    const unreadable = "Cardigan could not read Anaplan's answer about this app. Refresh the Anaplan tab, then click the Cardigan icon again. "
      + "If it keeps happening, choose Copy diagnostic log and send the log.";
    for (const [error, said, detail] of [
      [new rest.RestError("HTTP_ERROR", 403), "Anaplan refused the request. You may not have access to this app: check that you can open it in Anaplan, then choose Run again.",
        "HTTP_ERROR (HTTP 403)"],
      [new rest.RestError("HTTP_ERROR", 404), "Anaplan could not find this app. It may have been deleted or moved: open it again in Anaplan, then click the Cardigan icon.",
        "HTTP_ERROR (HTTP 404)"],
      [new rest.RestError("HTTP_ERROR", 500), failed, "HTTP_ERROR (HTTP 500)"], [new rest.RestError("HTTP_ERROR", 400), failed, "HTTP_ERROR (HTTP 400)"],
      [new rest.RestError("NETWORK_ERROR"), "Anaplan could not be reached. Check your connection, then choose Run again.", "NETWORK_ERROR"],
      [new rest.RestError("TIMEOUT"), "Anaplan took too long to answer. Wait a moment, then choose Run again.", "TIMEOUT"],
      [new rest.RestError("INVALID_RESPONSE", 200), unreadable, "INVALID_RESPONSE (HTTP 200)"], [new rest.RestError("TOO_LARGE"), unreadable, "TOO_LARGE"],
      [new rest.RestError("INVALID_PATH"), unreadable, "INVALID_PATH"],
    ] as const) {
      read.mockRejectedValueOnce(error);
      const outcome = await analyse().catch((thrown: unknown) => thrown);
      // The sentence is what the results page shows; the read's own words are what the log's "stopped" line says.
      expect(outcome, detail).toBeInstanceOf(Failure);
      expect([(outcome as Failure).message, (outcome as Failure).detail], detail).toEqual([said, detail]);
      expect(said, detail).not.toMatch(/\d|HTTP|_|ERROR/);
    }
    // A session that has ended is passed on as it is (the content script tells it by its code), and so is anything else.
    for (const error of [new rest.RestError("SIGNED_OUT", 401), new rest.RestError("SIGNED_OUT", 498), new TypeError("no answer")]) {
      read.mockRejectedValueOnce(error);
      await expect(analyse(), error.message).rejects.toBe(error);
    }
    // An address without an app ID is told as it always was.
    const noApp = await analyseApp("not-an-app-id", { status: () => undefined, log: () => undefined }, () => "").catch((thrown: unknown) => thrown);
    expect(noApp).toBeInstanceOf(Failure);
    expect([(noApp as Failure).message, (noApp as Failure).detail]).toEqual(["Open an app first: the address has no app ID.", undefined]);
  });

  it("writes the zip 0.6.1 wrote for the same app, byte for byte but for five rows of App Details.csv, the dash for nothing to say and a rule's colour stops, which are named, and returns each file as a table", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.UTC(2026, 8, 28, 12, 30, 10)));
    const result = await analyseGoldenApp();
    // The engine writes no zip: the result's tables are written as the files they were (result-zip.test-support.ts), and
    // held against the zip 0.6.1 wrote.
    const zip = resultZip(result, ZIPPED_AT);
    // Five rows of App Details.csv are deliberately not what 0.6.1 wrote, and each is named (golden-0.6.1.test-support.ts).
    // The row on the pages analysed says its two numbers on two lines, as the overview shows them (APP_ROW_ON_TWO_LINES).
    // The four others are "How to read" rows. The row on a filter's context says how the items of a filter are shown
    // (APP_ROW_REWORDED). And since the results page is where a result is read, with no file of it to download, three
    // rows speak of the page's tables (APP_ROWS_FOR_THE_PAGE): two say "table" where they said "file" and named a file,
    // and the one on how long IDs are written for Excel is gone. The dash that the other files hold where there is
    // nothing to say is a plain hyphen where 0.6.1 wrote an em dash, guarded as any cell that starts with a hyphen
    // (APP_DASH_PLAIN). A rule's colour stops are each written as its colour and the value it stands at, where 0.6.1 wrote
    // the value, an arrow and the colour (APP_STOPS_IN_WORDS). (The two other known differences, the build's name in the
    // "Exported with" row and in the first Diagnostics line, do not show here.) Everything else is what 0.6.1 wrote, byte
    // for byte.
    // File by file first, so that a difference shows as text: 0.6.1's files in their order, each with its text, of
    // App Details.csv every line but those five, each of which stood there once, and in the other files each dash as the
    // hyphen and each rule's stops in words. Five of the seven files hold the dash and two hold stops, and no file holds
    // 0.6.1's dash or its arrow any more.
    const [written, before] = [unzipText(zip), unzipText(APP_ZIP_0_6_1)];
    expect([...written.keys()]).toEqual([...before.keys()]);
    for (const [file, text] of before) expect(written.get(file), file).toBe(withStopsInWords(withPlainDash(file === DETAILS_FILE ? withAppRowsSince(text) : text)));
    const dashed = [...before].filter(([, text]) => text.includes(APP_DASH_PLAIN.was)).map(([file]) => file);
    expect(dashed).toEqual(["Pages.csv", "Cards.csv", "Grid Sections.csv", "Action Buttons.csv", "Where Used.csv"]);
    expect([...written].filter(([, text]) => text.includes(APP_DASH_PLAIN.was)).map(([file]) => file)).toEqual([]);
    const stopped = [...before].filter(([, text]) => text.includes(APP_STOPS_IN_WORDS.was)).map(([file]) => file);
    expect(stopped).toEqual(["Cards.csv", "Conditional Formatting.csv"]);
    expect([...written].filter(([, text]) => text.includes(APP_STOPS_IN_WORDS.was.trim())).map(([file]) => file)).toEqual([]);
    // Row by row: the rows of 0.6.1's file that are no longer there are the five named, in the file's order, and the
    // rows that 0.6.1's file did not have are the four they are written as now. The fifth is written as nothing.
    const named = [APP_ROW_ON_TWO_LINES, APP_ROWS_FOR_THE_PAGE[0], APP_ROWS_FOR_THE_PAGE[1], APP_ROW_REWORDED, APP_ROWS_FOR_THE_PAGE[2]];
    const [details, detailsBefore] = [parseCsv(written.get(DETAILS_FILE)!), parseCsv(before.get(DETAILS_FILE)!)].map(rows => rows.map(row => row.join("\n")));
    expect(detailsBefore.filter(row => !details.includes(row))).toEqual(named.map(row => parseCsv(row.was)[0].join("\n")));
    expect(details.filter(row => !detailsBefore.includes(row))).toEqual(named.slice(0, 4).map(row => parseCsv(row.now)[0].join("\n")));
    expect([named[4].now, detailsBefore.length - details.length, details.filter(row => row.startsWith("How to read\n")).length]).toEqual(["", 1, 5]);
    // No "How to read" row names a file, a CSV or a zip, or says to download one: the overview lists these rows as they are.
    expect(details.filter(row => row.startsWith("How to read\n") && /\.csv|\bCSV\b|\bzip\b|\bfiles?\b|download|Excel/i.test(row))).toEqual([]);
    // The row on the pages analysed holds a line break, which the file writes as " / ": the table the page reads holds
    // the break itself, and no semicolon.
    expect(result.tables[0].rows.find(row => row[1] === "Pages analysed")).toEqual(["App", "Pages analysed", "1 of 1 (published versions)\n1 unpublished, not analysed"]);
    // Then every byte. Of the eight files, App Details.csv, the five that hold the dash and the two that hold colour stops
    // (Cards.csv holds both) have other bytes than 0.6.1's: Filters.csv has 0.6.1's own.
    const [files, golden] = [zipEntries(zip), zipEntries(APP_ZIP_0_6_1)];
    expect(files.filter((file, index) => !sameBytes(file.data, golden[index].data)).map(file => file.name))
      .toEqual(golden.map(file => file.name).filter(name => name === DETAILS_FILE || dashed.includes(name) || stopped.includes(name)));
    // The zip around the files is written as 0.6.1 wrote it: from 0.6.1's own files, it is 0.6.1's zip.
    expect(sameBytes(zipStore(golden, ZIPPED_AT), APP_ZIP_0_6_1)).toBe(true);
    // So this run's zip is, byte for byte, 0.6.1's zip with those five rows, the dash and the colour stops written as they
    // are named.
    expect(sameBytes(zip, APP_ZIP_REWORDED)).toBe(true);

    expect([result.kind, result.name, result.id, result.zipName]).toEqual(["app", "Planning: app", GOLDEN_APP, "Planning app - App Export - 2026-09-28.zip"]);
    expect(result.summary).toEqual(["1 of 1 pages analysed; 1 unpublished, not analysed, 3 cards."]);
    expect(result.tables.map(table => [table.file, table.label, table.guard, table.details, table.rows.length])).toEqual([
      ["App Details.csv", "App Details", true, true, 27], ["Pages.csv", "Pages", true, undefined, 2], ["Cards.csv", "Cards", true, undefined, 3],
      ["Grid Sections.csv", "Grid Sections", true, undefined, 1], ["Filters.csv", "Filters", true, undefined, 1],
      ["Conditional Formatting.csv", "Conditional Formatting", true, undefined, 1], ["Action Buttons.csv", "Action Buttons", true, undefined, 2],
      ["Where Used.csv", "Model Objects", true, undefined, 10]]);
    // The names by which the results page knows an app's files are the ones exported: the Details file, then a file per tab.
    expect(result.tables.map(table => table.file)).toEqual([DETAILS_FILE, ...Object.values(TAB_FILES)]);
    expect([DETAILS_FILE, TAB_FILES]).toEqual(["App Details.csv", { Pages: "Pages.csv", Cards: "Cards.csv", "Grid sections": "Grid Sections.csv", Filters: "Filters.csv",
      Formatting: "Conditional Formatting.csv", Actions: "Action Buttons.csv", "Where used": "Where Used.csv" }]);
    // A cell is the value itself: the CSV's guard against formulas and its 12-digit IDs as text are added when it is written.
    const cards = result.tables[2];
    const cell = (row: number, header: string) => cards.rows[row][cards.headers.indexOf(header)];
    expect([cell(2, "Card #"), cell(2, "Card title"), cell(2, "Text content"), cell(1, "Source IDs")])
      .toEqual([3, "+ Notes", '=SUM(1) is text here, not a formula.\nSecond line, with a "quote".', MODULE]);
    // Plain data: the tables are the same after the trip to the results page as JSON, and so is the zip.
    const received = JSON.parse(JSON.stringify(result)) as typeof result;
    expect(received).toEqual(result);
    expect(sameBytes(resultZip(received, ZIPPED_AT), APP_ZIP_REWORDED)).toBe(true);
  });

  it("writes the names of a filter rule's items where the model gives them, and their IDs as before where it does not", async () => {
    const lines: string[] = [];
    const analyse = () => analyseApp(GOLDEN_APP, { status: () => undefined, log: line => { lines.push(line); } }, () => "");
    const filters = (result: Awaited<ReturnType<typeof analyse>>) => {
      const table = result.tables.find(each => each.file === "Filters.csv")!;
      return table.rows.map(row => ["Condition line item", "Condition line item's module", "Operator", "Value", "Condition context", "Line item ID"].map(header => row[table.headers.indexOf(header)]));
    };
    const cell = (result: Awaited<ReturnType<typeof analyse>>, file: string, header: string) => {
      const table = result.tables.find(each => each.file === file)!;
      return table.rows.map(row => row[table.headers.indexOf(header)]);
    };
    const usedIn = (result: Awaited<ReturnType<typeof analyse>>) => result.tables.find(each => each.file === "Where Used.csv")!.rows
      .filter(row => String(row[5]).startsWith("Filter")).map(row => [row[0], row[1], row[2], row[5], row[6]]);

    // The model's item reads answer nothing, as if it knew none of the items: every file is what it was before.
    serveStaffApp({});
    const unnamed = await analyse();
    expect(filters(unnamed)).toEqual([
      ["Status", "Demand", "is equal to", ITEM(318, 2), NONE, STATUS], ["Status", "Demand", "is equal to", ITEM(318, 1), NONE, STATUS],
      ["Status", "Demand", "is equal to", `${ITEM(318, 2)}, ${ITEM(318, 1)}`, "Territory = current", STATUS],
      // The rule's line item is its last item: it is told from the others while one of them is unnamed, and the unnamed
      // one is shown by its ID in the context.
      ["Role", "Demand", "is equal to", ITEM(404, 3), `Time = current; ${ITEM(358, 0)}`, ROLE]]);
    expect(cell(unnamed, "Cards.csv", "Filters")).toEqual([[`Rows, match all: Status [Demand] is equal to ${ITEM(318, 2)}`, `Rows, match all: Status [Demand] is equal to ${ITEM(318, 1)}`,
      `Rows, match all: Status [Demand] is equal to ${ITEM(318, 2)}, ${ITEM(318, 1)} (context: Territory = current)`,
      `Rows, match all: Role [Demand] is equal to ${ITEM(404, 3)} (context: Time = current; ${ITEM(358, 0)})`].join(" | ")]);
    expect(usedIn(unnamed)).toEqual([["Line item", "Status", "Demand", "Filter", STATUS], ["Dimension", "Territory", NONE, "Filter context", LIST_2],
      ["Line item", "Role", "Demand", "Filter", ROLE], ["Dimension", "Time", NONE, "Filter context", "20000000003"]]);
    expect(unnamed.summary).toEqual(["1 of 1 pages analysed, 1 cards."]);

    // The model names them: each ID is the item's name wherever it stood, in the context of the fourth rule as well.
    lines.length = 0;
    serveStaffApp({ [at(`/modules/${MODULE}/dimensions/${REGIONS}`)]: labels({ [ITEM(358, 0)]: "All regions" }),
      [at(`/modules/${MODULE}/dimensions/${STATUSES}`)]: labels({ [ITEM(318, 1)]: "Open", [ITEM(318, 2)]: "Closed" }),
      [at("/applicableModules")]: id => update(id, { data: [{ id: Number(STAFFING), label: "Staffing" }] }),
      [at(`/modules/${STAFFING}/dimensions/${ROLES}`)]: labels({ [ITEM(404, 3)]: "Planner" }) });
    const named = await analyse();
    expect(filters(named)).toEqual([
      ["Status", "Demand", "is equal to", "Closed", NONE, STATUS], ["Status", "Demand", "is equal to", "Open", NONE, STATUS],
      ["Status", "Demand", "is equal to", "Closed, Open", "Territory = current", STATUS],
      ["Role", "Demand", "is equal to", "Planner", "Time = current; All regions", ROLE]]);
    expect(cell(named, "Cards.csv", "Filters")).toEqual([["Rows, match all: Status [Demand] is equal to Closed", "Rows, match all: Status [Demand] is equal to Open",
      "Rows, match all: Status [Demand] is equal to Closed, Open (context: Territory = current)",
      "Rows, match all: Role [Demand] is equal to Planner (context: Time = current; All regions)"].join(" | ")]);
    expect(usedIn(named)).toEqual([["Line item", "Status", "Demand", "Filter", STATUS], ["Dimension", "Territory", NONE, "Filter context", LIST_2],
      ["Line item", "Role", "Demand", "Filter", ROLE], ["Dimension", "Time", NONE, "Filter context", "20000000003"]]);
    // Nothing else differs between the two: the other columns of Filters.csv and of Cards.csv, and every other file. Where
    // Used.csv has the same rows: the rule was told apart either way. App Details.csv says when it was exported.
    const changing: Record<string, string[]> = { "Filters.csv": ["Value", "Condition context"], "Cards.csv": ["Filters"] };
    const others = (result: typeof named) => result.tables.map(table => [table.file,
      table.file === DETAILS_FILE ? table.rows.filter(row => row[1] !== "Exported on" && row[1] !== "Where Used.csv")
        : table.file === "Where Used.csv" ? table.rows.filter(row => !String(row[5]).startsWith("Filter"))
          : table.rows.map(row => row.filter((_, column) => !(changing[table.file] ?? []).includes(table.headers[column])))]);
    expect(others(named)).toEqual(others(unnamed));
    const used = (result: typeof named) => result.tables.find(each => each.file === "Where Used.csv")!.rows;
    expect(used(named)).toEqual(used(unnamed));
    expect([unnamed, named].map(result => result.tables[0].rows.find(row => row[1] === "Where Used.csv")?.[2])).toEqual([`${used(unnamed).length} rows`, `${used(named).length} rows`]);
    // The log names what was asked and how much was named, never an item, a list or a line item by its name.
    expect(lines.filter(line => line.startsWith("filter "))).toEqual([
      // The rule's context item is an item of one of its line item's module's dimensions: those the rule does not name are asked in turn.
      `filter context items: 1 asked of dimension ${LIST_2} in module ${MODULE}, 0 named (answer: 0 entries)`,
      `filter context items: 1 asked of dimension ${REGIONS} in module ${MODULE}, 1 named (answer: 1 entries of {itemId, label})`,
      `filter line item ${STATUS}: format {dataType, hierarchyEntityLongId}, data type ENTITY, items of dimension ${STATUSES}`,
      `filter values: 2 asked of dimension ${STATUSES} in module ${MODULE}, 2 named (answer: 2 entries of {itemId, label})`,
      `filter line item ${ROLE}: format {dataType, hierarchyEntityLongId}, data type ENTITY, items of dimension ${ROLES}`,
      `filter values: 1 asked of dimension ${ROLES} in module ${STAFFING}, 1 named (answer: 1 entries of {itemId, label})`,
      "filter context items: 1 of 1 named", "filter values: 3 of 3 named"]);
    expect(lines.join("\n")).not.toMatch(/All regions|Planner|Open|Closed|Status|Role\b|Staffing|Territory/);
  });

  it("names a rule whose line item is in a module that no card shows and the model does not name for the filtered dimension", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.UTC(2026, 8, 28, 12, 30, 10)));
    const lines: string[] = [];
    const analyse = () => analyseApp(GOLDEN_APP, { status: () => undefined, log: line => { lines.push(line); } }, () => "");
    const filters = (result: Awaited<ReturnType<typeof analyse>>) => {
      const table = result.tables.find(each => each.file === "Filters.csv")!;
      return table.rows.map(row => ["Condition line item", "Condition line item's module", "Operator", "Value", "Condition context", "Line item ID"].map(header => row[table.headers.indexOf(header)]));
    };
    /** The model has the grid's module and twelve others, of which `listed` are in the list it gives this user. Only the
     * grid's module is named for the filtered dimension. The rule's line item is the first of the ninth other module. */
    const others = Array.from({ length: 12 }, (_, index) => other(index + 1));
    const serve = (listed: string[]) => serveStaffApp({
      [MODULE_VIEWS]: id => update(id, { data: [[MODULE, "Demand"], ...listed.map(module => [module, module === APPROVALS ? "Approvals" : `Module ${module}`])]
        .map(([module, name]) => ({ id: Number(module), name, views: [] })), dimensions: { "20000000003": { label: "Time" } } }),
      [at(`/modules/${APPROVALS}/lineItems`)]: id => update(id, { data: [{ lineItemId: APPROVED_BY, lineItemLabel: "Approved by", ...listFormat(ROLES) }] }),
      [at("/applicableModules")]: (id, asked) => update(id, { data: [{ id: Number(asked.dimensions[0] === Number(ROLES) ? STAFFING : MODULE), label: "A module" }] }),
      [at(`/modules/${STAFFING}/dimensions/${ROLES}`)]: labels({ [ITEM(404, 3)]: "Planner" }),
    }, approvalBoard);

    // The module is not in that list: the rule stays as the owner saw one. Its three items are listed together, two
    // dimensions by name and the ID between them; it has no module, no context and no line item ID, and the item it is
    // compared with keeps its ID.
    serve(others.filter(module => module !== APPROVALS));
    const unfound = await analyse();
    expect(filters(unfound)).toEqual([[`Territory, ${APPROVED_BY}, Time`, NONE, "is equal to", ITEM(404, 3), NONE, NONE]]);
    expect(searched()).toEqual(others.filter(module => module !== APPROVALS));

    // The module is in the list: once the model's other modules are gone through, the rule has its line item, and with it
    // that item's module, the name of the item it is compared with, and its context.
    lines.length = 0;
    serve(others);
    const found = await analyse();
    expect(filters(found)).toEqual([["Approved by", "Approvals", "is equal to", "Planner", "Territory = current; Time = current", APPROVED_BY]]);
    expect(searched()).toEqual(others);
    expect([unfound.summary, found.summary]).toEqual([["1 of 1 pages analysed, 1 cards."], ["1 of 1 pages analysed, 1 cards."]]);
    // The log says where the line item was found, and names nothing.
    const logged = lines.filter(line => line.startsWith("filter "));
    expect(logged).toEqual([
      "filter line items: 1 looked for in 0 of 0 candidate modules that have the filtered dimensions and 9 of 12 other modules, in 0 s, 3 reads given up while waiting: "
        + "1 found (0 in candidate modules), 0 not found",
      "filter line items: the entity-type bracket chose 0 of the 12 modules asked for; fewer than 3 modules with line items were read",
      `filter line item ${APPROVED_BY}: format {dataType, hierarchyEntityLongId}, data type ENTITY, items of dimension ${ROLES}`,
      `filter values: 1 asked of dimension ${ROLES} in module ${STAFFING}, 1 named (answer: 1 entries of {itemId, label})`, "filter values: 1 of 1 named"]);
    expect(logged.join("\n")).not.toMatch(/Approv|Planner|Territory|Roles|Demand|Model one/);
  });

  it("ends with done when the same app is analysed for a results page, although the socket's closing is logged after it", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.UTC(2026, 8, 28, 12, 30, 10)));
    serveGoldenApp();
    // The socket to the app's one model says that it has closed only when the test lets it, which is after the result.
    let closes = (): void => undefined;
    ScriptedSocket.closing = fire => { closes = fire; };
    // The content script's end of the port, around the analysis; every line the analysis logs is also kept here.
    const logged: string[] = [];
    let connect: (port: chrome.runtime.Port) => void = () => undefined;
    serveTab({ id: EXTENSION, onConnect: { addListener: listener => { connect = listener; } } }, { host: FIRST, subject: () => ({ kind: "app", id: GOLDEN_APP }),
      run: (seen, progress, diagnostics, signal) => analyseApp(seen.id, { status: progress.status, log: line => { logged.push(line); progress.log(line); } }, diagnostics, signal),
      signedOut: () => false });
    const page = new FakePort();
    connect(page as unknown as chrome.runtime.Port);
    page.say({ type: "run" });
    await vi.waitFor(() => expect(page.types()).toContain("done"));
    // The close event fires after the result has gone out; the socket client logs it then, and it is sent to nobody.
    expect(logged).not.toContain("socket closed code=1000");
    closes();
    expect(logged.at(-1)).toBe("socket closed code=1000");
    expect(page.types().slice(-3)).toEqual(["rows", "rows", "done"]);
    expect(page.received.map(message => (message.type === "log" ? message.text : ""))).not.toContain("12:30:10 socket closed code=1000");
    // What arrived is the whole result: the same zip, its dash as it is written now (APP_DASH_PLAIN), and its Diagnostics
    // rows are the log up to the report.
    const result = assemble(page.received);
    expect(unzipText(resultZip(result, ZIPPED_AT)).get("Cards.csv")).toBe(unzipText(APP_ZIP_REWORDED).get("Cards.csv"));
    const diagnostics = result.tables[0].rows.filter(row => row[0] === "Diagnostics").map(row => row[2]);
    expect([diagnostics[0], diagnostics.at(-1)]).toEqual([`Cardigan dev: app ${GOLDEN_APP} on ${FIRST}`, "Building the report…"]);
  });
});

// One app read end to end, as the 0.6.1 zip in golden-0.6.1.test-support.ts was made: a published board with an action card, a
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

/** That app's definition service, model data socket and actions service, scripted. */
function serveGoldenApp() {
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
}

// An app with the filter rules the owner's first live run showed as IDs (all IDs here are made up): a line item formatted
// as a list is compared with one or two of that list's items, and a rule whose context fixes a dimension to its top level
// item. Status is formatted as a list the grid's module has as a dimension, Role as a list it has not.
const STATUSES = "101000000913";
const itemRule = (selectedItems: string[], values: string[]) => ({ type: "LEAF", rule: { selectedItems, operator: "EQUALS", values, identifier: "", axisKey: null } });
const staffCard: Any = { ...goldenCards[1], defaultTitle: "Staff by product", widgetDataSources: [{ ...goldenCards[1].widgetDataSources[0],
  axisDescriptionQuery: { id: guid(900), version: 1, conditionalFormattingRules: [], regions: { SINGLE: { moduleId: MODULE, columns: axis([dim("20000000003")]),
    rows: axis([dim(LIST)], [{ type: "BRANCH", operator: "AND", nodes: [itemRule([STATUS], [ITEM(318, 2)]), itemRule([STATUS], [ITEM(318, 1)]),
      itemRule([LIST_2, STATUS], [ITEM(318, 2), ITEM(318, 1)]), itemRule(["20000000003", ITEM(358, 0), ROLE], [ITEM(404, 3)])] }]) } } } }] };
const staffLayout = structuredClone(goldenBoard.layout);
staffLayout.areas.main[0].areas.sections[0].areas.rows = [goldenBoard.layout.areas.main[0].areas.sections[0].areas.rows[1]];
const staffBoard: Any = { ...goldenBoard, name: "Staff board", layout: staffLayout, widgets: { [staffCard.clientGuid]: staffCard } };

// The same board with the one rule the owner's second live run showed as IDs (all IDs here are made up): two dimensions that
// follow the page and, between them, the rule's line item, which is the first line item of a module that no card shows. It
// is formatted as the list Roles.
const [APPROVALS, APPROVED_BY] = [other(9), ITEM(317, 0)];
const approvalCard: Any = { ...staffCard, defaultTitle: "Approvals by product", widgetDataSources: [{ ...staffCard.widgetDataSources[0],
  axisDescriptionQuery: { ...staffCard.widgetDataSources[0].axisDescriptionQuery, regions: { SINGLE: { moduleId: MODULE, columns: axis([dim("20000000003")]),
    rows: axis([dim(LIST)], [{ type: "BRANCH", operator: "AND", nodes: [itemRule([LIST_2, APPROVED_BY, "20000000003"], [ITEM(404, 3)])] }]) } } } }] };
const approvalBoard: Any = { ...staffBoard, widgets: { [approvalCard.clientGuid]: approvalCard } };

/** That app's services, or those of the same app with another board. `items` are the answers of the model's item reads;
 * without one, a read has no item to name. */
function serveStaffApp(items: Record<string, (id: string, asked: Any) => string>, board: Any = staffBoard) {
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const path = new URL(url).pathname;
    if (path.endsWith(`/apps/${GOLDEN_APP}`)) return json({ name: "Staffing app", pages: [{ guid: guid(1000), name: "Staff board", pageType: "BOARD", hasPublishedVersion: true }] });
    return path.endsWith(`/boards/${guid(1000)}`) ? json(board) : new Response("{}", { status: 404 });
  }));
  ScriptedSocket.sockets = [];
  serveModel({
    [MODULE_VIEWS]: id => update(id, { data: [{ id: Number(MODULE), name: "Demand", views: [] }], dimensions: { "20000000003": { label: "Time" } } }),
    [at("/lists")]: id => update(id, { data: [[LIST, "Product"], [LIST_2, "Territory"], [REGIONS, "Region"], [ROLES, "Roles"], [STATUSES, "Statuses"]].map(([id_, name]) => ({ id: id_, name })) }),
    [at(`/modules/${MODULE}/lineItems`)]: id => update(id, { data: [{ lineItemId: STATUS, lineItemLabel: "Status", ...listFormat(STATUSES) },
      { lineItemId: ROLE, lineItemLabel: "Role", ...listFormat(ROLES) }] }),
    [at("/dimensions")]: id => update(id, { modules: { [MODULE]: { dimensions: [[LIST, "Product"], ["20000000003", "Time"], [LIST_2, "Territory"], [REGIONS, "Region"], [STATUSES, "Statuses"]]
      .map(([id_, label]) => ({ id: id_, label })) } } }),
    ...items,
  });
}

/** Runs the analysis of that app against them, with the diagnostic log 0.6.1 was given. */
async function analyseGoldenApp() {
  serveGoldenApp();
  return analyseApp(GOLDEN_APP, { status: () => undefined, log: () => undefined },
    () => "12:30:10 page-analyzer vdev: app on first.app.anaplan.com\r\n12:30:10 Reading the app…\r\nunstamped line");
}
