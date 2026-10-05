import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UxPageCardDetails } from "./card-reader/card-types.js";
import { analyseApp, DETAILS_FILE, loadCatalog, TAB_FILES } from "./analyse.js";
import { APP_ROW_REWORDED, APP_ZIP_0_6_1, APP_ZIP_REWORDED, ZIPPED_AT } from "./golden-0.6.1.test-support.js";
import { ANAPLAN_HOSTS, NOT_SCOPE_IDS, OTHER_HOSTS, SCOPE_IDS } from "./guards.test-support.js";
import { assemble } from "./pieces.test-support.js";
import { Failure } from "./progress.js";
import * as report from "./report.js";
import { NONE } from "./report.js";
import * as rest from "./rest.js";
import { resultZip } from "./result-zip.js";
import { decodeFrames, type StompFrame } from "./stomp.js";
import { serveTab } from "./tab-port.js";
import { EXTENSION, FakePort } from "./tab-port.test-support.js";
import { toCsv, zipStore } from "./zip.js";
import { parseCsv, sameBytes, unzipText, zipEntries } from "./zip.test-support.js";

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

describe("Page analyzer name loading against the live socket behaviour", () => {
  beforeEach(() => {
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
    // The model is served from its own host after a redirect, so each of the three lists is asked of the page's host and then,
    // if that fails, of the model's. The run is stopped while the first read is under way, whether that read answers or fails.
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
        .toEqual([`https://${FIRST}/a/collaboration-actions-service/workspaces/${WS}/models/${MODEL}/imports`]);
      // Nor is the model summed up for the log: the run has ended.
      expect(log.filter(line => line.startsWith("Synthetic model: ")).map(line => line.replace(/^Synthetic model: /, "")), String(answered))
        .toEqual(answered === 200 ? [`0 imports named (from ${FIRST})`] : [`imports from ${FIRST} answered HTTP_ERROR (HTTP 500)`]);
    }
    // Not stopped, all three lists are read: from the model's host too where the page's fails.
    ScriptedSocket.sockets = [];
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 500 })));
    await run(three, scope, new AbortController().signal).result;
    expect(vi.mocked(globalThis.fetch).mock.calls.map(([url]) => new URL(url as string).host + new URL(url as string).pathname.replace(/.*\//, "/")))
      .toEqual([`${FIRST}/imports`, `${MODEL_HOST}/imports`, `${FIRST}/exports`, `${MODEL_HOST}/exports`, `${FIRST}/processes`, `${MODEL_HOST}/processes`]);
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

  it("looks for filter line items in the filtered dimension's modules not yet read, four at a time, until found: every one of them is read, however many", async () => {
    // The clock stands still, so the search takes no time by it.
    vi.useFakeTimers({ toFake: ["Date"] });
    // Sixty modules were once the most that were read: the sixty-first is read now, and so is the hundred and twenty-seventh.
    for (const [count, found, read] of [[6, 2, 4], [60, 0, 60], [61, 0, 61], [130, 127, 128]] as const) {
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
      // A line item that no module lists adds no note: every module there was to read was read.
      expect(done.notes, String(count)).toEqual([]);
      expect(destinations().filter(destination => destination.endsWith("/lineItems")), String(count))
        .toEqual([MODULE, MODULE_3, ...candidates.slice(0, read)].map(module => at(`/modules/${module}/lineItems`)));
      expect(log).toContain(`line items of module ${MODULE_3}: LINE_ITEMS_UNAVAILABLE`);
      expect(done.catalog.lineItems.has(FILTER_ITEM)).toBe(!!found);
      // The log says how far the search went, in counts only: the IDs looked for, the modules read of those that have the
      // filtered dimensions and of the model's others (it has none here), the time, what was found and where, and whether
      // the IDs themselves ordered the search.
      expect(log.filter(line => line.startsWith("filter line items:")), String(count)).toEqual([
        `filter line items: 1 looked for in ${read} of ${count} candidate modules that have the filtered dimensions and 0 of 0 other modules, in 0 s: `
          + `${found ? "1 found (1 in candidate modules), 0" : "0 found, 1"} not found`,
        `filter line items: the entity-type bracket chose 0 of the ${read} modules asked for; fewer than 3 modules with line items were read`]);
    }
  });

  it("goes on through the model's other modules, in its list's order, when no module that has the filtered dimensions lists a rule's line item", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const [candidates, others] = [[1, 2, 3, 4, 5].map(candidate), Array.from({ length: 10 }, (_, index) => other(index + 1))];
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
    // The modules the model named come first, as they always did, then the others of its list: four at a time, each of
    // them once, until the rule has its line item. The three modules after that are not read.
    expect(searched()).toEqual([...candidates, ...others.slice(0, 7)]);
    // From its second read on, the step says how far the search is.
    expect(statuses.slice(-3)).toEqual(["Finding filter line items in Synthetic model…", "Finding filter line items in Synthetic model: 4 of 15 modules…",
      "Finding filter line items in Synthetic model: 8 of 15 modules…"]);
    // The log tells the two kinds of module apart, and says in which the line item was found. A module that could not be
    // read is logged as it always was, and is not counted as read.
    expect(log.filter(line => /^(filter |line items of)/.test(line))).toEqual([`line items of module ${other(2)}: LINE_ITEMS_UNAVAILABLE`,
      "filter line items: 1 looked for in 5 of 5 candidate modules that have the filtered dimensions and 6 of 10 other modules, in 0 s: 1 found (0 in candidate modules), 0 not found",
      "filter line items: the entity-type bracket chose 0 of the 12 modules asked for; fewer than 3 modules with line items were read"]);

    // The model names no module for the filtered dimension, or refuses the question: its list is gone through all the same.
    for (const answer of [(id: string) => update(id, { data: [] }), (id: string) => rejected(id, "MODULES_UNAVAILABLE")]) {
      serve({ [at("/applicableModules")]: answer });
      const unnamed = await run(withGrid()).result;
      expect([unnamed.notes, unnamed.catalog.lineItems.get(FILTER_ITEM)]).toEqual([[], { name: "Include?", moduleId: other(7) }]);
      expect(searched()).toEqual(others.slice(0, 8));
    }

    // A line item that no module has: every module is asked once, and no note is added, as none was when every module that
    // has the filtered dimensions had been read. The rule keeps its ID.
    serve({ [at("/applicableModules")]: named, [at(`/modules/${other(7)}/lineItems`)]: id => update(id, { data: [] }) });
    const none = run(withGrid());
    expect((await none.result).notes).toEqual([]);
    expect(searched()).toEqual([...candidates, ...others]);
    expect(none.log.filter(line => line.startsWith("filter "))).toEqual([
      "filter line items: 1 looked for in 5 of 5 candidate modules that have the filtered dimensions and 9 of 10 other modules, in 0 s: 0 found, 1 not found",
      "filter line items: the entity-type bracket chose 0 of the 15 modules asked for; fewer than 3 modules with line items were read",
      `filter rule with an unnamed item (card card-1): unnamed ${FILTER_ITEM}`]);

    // Without the model's list of modules, which was not available, the modules it names for the dimension are all there is to read.
    serve({ [MODULE_VIEWS]: id => rejected(id, "MODULES_UNAVAILABLE"), [at("/applicableModules")]: named });
    expect((await run(withGrid()).result).notes).toEqual(["Synthetic model: module and saved view names were not available (MODULES_UNAVAILABLE)."]);
    expect(searched()).toEqual(candidates);
  });

  it("reads first the modules between the two whose line items bracket the ID looked for, when the modules read so far bear that order out", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    // A model of forty-one modules whose IDs and line item IDs rise together: the line items of the list's nth other module
    // have the entity type 2000 + n. The cards show four of the modules, and a rule's line item is the first of another.
    const others = Array.from({ length: 40 }, (_, index) => other(index + 1));
    const FAR = ITEM(2027, 0);
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

    // The line item's entity type lies between those of the twentieth and the fortieth module, which the cards show. Four of
    // the nineteen modules between them are read, spread evenly; their answers leave three modules between two that bracket
    // it, and those are read next, with the first module the model named for the filtered dimension to fill the four.
    serve({}, [other(3), other(5)]);
    const { log, statuses, result } = run(shown);
    const { catalog, notes } = await result;
    expect(notes).toEqual([]);
    expect(catalog.lineItems.get(FAR)).toEqual({ name: `Line item 0 of ${other(27)}`, moduleId: other(27) });
    expect(searched()).toEqual([1, 20, 40, 24, 28, 32, 36, 25, 26, 27, 3].map(other));
    expect(statuses.slice(-2)).toEqual(["Finding filter line items in Synthetic model…", "Finding filter line items in Synthetic model: 4 of 37 modules…"]);
    expect(lines(log)).toEqual([
      "filter line items: 1 looked for in 1 of 2 candidate modules that have the filtered dimensions and 7 of 35 other modules, in 0 s: 1 found (0 in candidate modules), 0 not found",
      "filter line items: the entity-type bracket chose 7 of the 8 modules asked for; in the modules read, module IDs and line item entity types rise together (12 modules with line items)"]);

    // The order holds for the modules the cards show, and not for the module that has the line item: the fifth, whose line
    // items have the entity type that the twenty-seventh's would have. The bracket is read first and has nothing; then the
    // list is gone through in its order, and the line item is found there, under the name its own module gives it. The wrong
    // guess cost eight reads and no name.
    serve({ [other(5)]: 2027, [other(27)]: undefined });
    const astray = run(shown);
    expect((await astray.result).catalog.lineItems.get(FAR)).toEqual({ name: `Line item 0 of ${other(5)}`, moduleId: other(5) });
    expect(searched()).toEqual([1, 20, 40, 24, 28, 32, 36, 25, 26, 27, 2, 3, 4, 5, 6].map(other));
    expect(lines(astray.log)).toEqual([
      "filter line items: 1 looked for in 0 of 0 candidate modules that have the filtered dimensions and 12 of 37 other modules, in 0 s: 1 found (0 in candidate modules), 0 not found",
      "filter line items: the entity-type bracket chose 7 of the 12 modules asked for; in the modules read, module IDs and line item entity types do not rise together"]);

    // The modules the cards show do not bear the order out: the twentieth's line items have a higher entity type than the
    // fortieth's. The IDs then order nothing: the list is gone through in its order, as far as the line item.
    serve({ [other(20)]: 2090 });
    const unordered = run(shown);
    expect((await unordered.result).catalog.lineItems.get(FAR)).toEqual({ name: `Line item 0 of ${other(27)}`, moduleId: other(27) });
    expect(searched()).toEqual([1, 20, 40, ...Array.from({ length: 29 }, (_, index) => index + 2).filter(n => n !== 20)].map(other));
    expect(lines(unordered.log)).toEqual([
      "filter line items: 1 looked for in 0 of 0 candidate modules that have the filtered dimensions and 28 of 37 other modules, in 0 s: 1 found (0 in candidate modules), 0 not found",
      "filter line items: the entity-type bracket chose 0 of the 28 modules asked for; in the modules read, module IDs and line item entity types do not rise together"]);
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
    const read = (looked: number, inCandidates: number, inOthers: number, outcome: string) => `filter line items: ${looked} looked for in ${inCandidates} of 6 candidate modules that have the filtered dimensions and `
      + `${inOthers} of 10 other modules, in 0 s: ${outcome}`;
    const rising = (modules: number) => `in the modules read, module IDs and line item entity types rise together (${modules} modules with line items)`;
    const ruledOut = (count: string, id: string, module: string, beside = "") => `filter line items: of the ${count} not found, ${count} looked for in the candidate modules only: 1 ruled out, `
      + `each by a module that was read, which has the line items of its entity type and does not list it (${id} by module ${module})${beside}`;
    /** The three modules the cards show, each with line items of an entity type of its own. */
    const shown = { [MODULE]: [LINE_ITEM], [MODULE_3]: [ITEM(1905, 1)], [STAFFING]: [ITEM(1909, 1)] };

    // A rule on a line item that the grid's own module no longer has: its ID has the entity type of that module's line items.
    // The six modules the model names are read all the same, as they always were, and none of the ten others is.
    const GONE = ITEM(1901, 77);
    serve(shown);
    const gone = run(showing([GONE], MODULE, MODULE_3, STAFFING));
    expect((await gone.result).notes).toEqual([]);
    expect(searched()).toEqual([MODULE_3, STAFFING, ...candidates]);
    // The log's counts add up: one ID looked for, none found, one not found, and that one in the candidate modules only.
    expect(lines(gone.log)).toEqual([read(1, 6, 0, "0 found, 1 not found"),
      `filter line items: the entity-type bracket chose 0 of the 6 modules asked for; ${rising(3)}`, ruledOut("1", GONE, MODULE)]);

    // Nothing proves that two modules never have line items of one entity type. Here the first module the model names has
    // line items of the grid's module's type, the rule's among them: it is read, as it always was, and the rule has its name.
    serve({ ...shown, [candidate(1)]: [GONE] });
    const twin = run(showing([GONE], MODULE, MODULE_3, STAFFING));
    expect((await twin.result).catalog.lineItems.get(GONE)).toEqual({ name: `Line item ${GONE}`, moduleId: candidate(1) });
    expect(searched()).toEqual([MODULE_3, STAFFING, ...candidates.slice(0, 4)]);
    expect(lines(twin.log)).toEqual([read(1, 4, 0, "1 found (1 in candidate modules), 0 not found"),
      "filter line items: the entity-type bracket chose 0 of the 4 modules asked for; in the modules read, a module's line items do not have one entity type of their own"]);

    // A rule holds one line item. When one of its IDs is ruled out, that one was it, and the rule's other ID is its context,
    // which no module lists: the other modules are spared that one too.
    serve(shown);
    const whole = run(showing([GONE, ITEM(7000, 3)], MODULE, MODULE_3, STAFFING));
    await whole.result;
    expect(searched()).toEqual([MODULE_3, STAFFING, ...candidates]);
    expect(lines(whole.log)).toEqual([read(2, 6, 0, "0 found, 2 not found"),
      `filter line items: the entity-type bracket chose 0 of the 6 modules asked for; ${rising(3)}`, ruledOut("2", GONE, MODULE, ", and 1 in a rule with such an ID")]);

    // The same when the search itself reads the module that rules the ID out: the second module the model names has the
    // line items of its entity type, and does not list it. The two named modules after those four are read, and no other.
    const LOST = ITEM(1903, 77);
    serve({ [MODULE]: [LINE_ITEM], [candidate(1)]: [ITEM(1902, 1)], [candidate(2)]: [FILTER_ITEM], [candidate(3)]: [ITEM(1904, 1)] });
    const lost = run(showing([LOST], MODULE));
    expect((await lost.result).notes).toEqual([]);
    expect(searched()).toEqual(candidates);
    expect(lines(lost.log)).toEqual([read(1, 6, 0, "0 found, 1 not found"),
      `filter line items: the entity-type bracket chose 0 of the 6 modules asked for; ${rising(4)}`, ruledOut("1", LOST, candidate(2))]);

    // All of that is taken from three modules with line items, and not from fewer: with the grid's module alone, every
    // module is read, the ten others too.
    serve({ [MODULE]: [LINE_ITEM] });
    const alone = run(showing([GONE], MODULE));
    await alone.result;
    expect(searched()).toEqual([...candidates, ...others]);
    expect(lines(alone.log)).toEqual([read(1, 6, 10, "0 found, 1 not found"),
      "filter line items: the entity-type bracket chose 0 of the 16 modules asked for; fewer than 3 modules with line items were read"]);

    // Nor when two of the modules read have line items of one entity type: an ID then does not say which module it belongs
    // to. Nothing is ruled out, and every module is read.
    serve({ ...shown, [MODULE_3]: [ITEM(1901, 2)] });
    const shared = run(showing([GONE], MODULE, MODULE_3, STAFFING));
    await shared.result;
    expect(searched()).toEqual([MODULE_3, STAFFING, ...candidates, ...others]);
    expect(lines(shared.log)).toEqual([read(1, 6, 10, "0 found, 1 not found"),
      "filter line items: the entity-type bracket chose 0 of the 16 modules asked for; in the modules read, a module's line items do not have one entity type of their own"]);
  });

  it("gives the search for filter line items forty-five seconds in all: no module is read once they are over, the reads that wait are given up, and a note says how many modules were not read", async () => {
    const timers = ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] as const;
    const others = Array.from({ length: 30 }, (_, index) => other(index + 1));
    /** Makes the model slow: the line items of each module but the grid's own are answered only after `wait`. */
    const slowly = (wait: number) => {
      const reply = ScriptedSocket.reply;
      ScriptedSocket.reply = (socket, frame) => {
        const looking = frame.command === "SEND" && frame.headers.destination.endsWith("/lineItems") && frame.headers.destination !== at(`/modules/${MODULE}/lineItems`);
        if (looking) setTimeout(() => reply(socket, frame), wait); else reply(socket, frame);
      };
    };
    const note = (unread: number) => `Synthetic model: some filter line items were not found in the 45 seconds allowed for the search: ${unread} of 30 modules were not read.`;
    const waited = (module: string) => `line items of module ${module}: Timed out waiting for ${at(`/modules/${module}/lineItems`)}.`;
    const unnamed = `filter rule with an unnamed item (card card-1): unnamed ${FILTER_ITEM}`;

    // A model of thirty other modules, none of which has the rule's line item, that takes ten seconds over each four.
    vi.useFakeTimers({ toFake: [...timers] });
    serveModel({ [MODULE_VIEWS]: moduleList(others) });
    slowly(10_000);
    const slow = run(withGrid());
    let outcome: unknown = "reading";
    slow.result.then(done => { outcome = done.notes; }, error => { outcome = error; });
    // The fifth four are asked for forty seconds after the first and would be answered after fifty: until the forty-five are
    // over, they are waited for.
    await vi.advanceTimersByTimeAsync(44_999);
    expect([outcome, searched()]).toEqual(["reading", others.slice(0, 20)]);
    // Then they are given up, no sixth four are asked for, and the run goes on to its end, with a note.
    await vi.advanceTimersByTimeAsync(101);
    expect([outcome, searched()]).toEqual([[note(14)], others.slice(0, 20)]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(searched()).toEqual(others.slice(0, 20));
    expect(slow.statuses.slice(-5)).toEqual(["Finding filter line items in Synthetic model…",
      ...[4, 8, 12, 16].map(read => `Finding filter line items in Synthetic model: ${read} of 30 modules…`)]);
    // The log says that the time ran out and how many modules were left: the four given up and the ten never asked for.
    expect(slow.log.filter(line => /^(filter |line items of)/.test(line))).toEqual([...others.slice(16, 20).map(waited),
      "filter line items: 1 looked for in 0 of 0 candidate modules that have the filtered dimensions and 16 of 30 other modules, in 45 s: 0 found, 1 not found",
      "filter line items: the entity-type bracket chose 0 of the 20 modules asked for; fewer than 3 modules with line items were read",
      "filter line items: the 45 seconds allowed for the search ran out: 14 modules left unread", unnamed]);

    // The time is that of the whole search: the question which modules have the filtered dimension is waited for no longer,
    // and when it took all of it no module is read.
    ScriptedSocket.sockets = [];
    serveModel({ [MODULE_VIEWS]: moduleList(others), [at("/applicableModules")]: () => "" });
    const unanswered = run(withGrid());
    await vi.advanceTimersByTimeAsync(44_999);
    expect(destinations().at(-1)).toBe(at("/applicableModules"));
    await vi.advanceTimersByTimeAsync(101);
    expect([(await unanswered.result).notes, searched()]).toEqual([[note(30)], []]);
    expect(unanswered.log.filter(line => /^(filter |modules for)/.test(line))).toEqual([`modules for dimension ${LIST}: Timed out waiting for ${at("/applicableModules")}.`,
      "filter line items: 1 looked for in 0 of 0 candidate modules that have the filtered dimensions and 0 of 30 other modules, in 45 s: 0 found, 1 not found",
      "filter line items: the entity-type bracket chose 0 of the 0 modules asked for; fewer than 3 modules with line items were read",
      "filter line items: the 45 seconds allowed for the search ran out: 30 modules left unread", unnamed]);

    // A model that answers within the time is read whole, and a line item that none of its modules has adds no note.
    ScriptedSocket.sockets = [];
    serveModel({ [MODULE_VIEWS]: moduleList(others) });
    slowly(5_000);
    const whole = run(withGrid());
    await vi.advanceTimersByTimeAsync(40_100);
    expect([(await whole.result).notes, searched()]).toEqual([[], others]);
    expect(whole.log.filter(line => line.startsWith("filter "))).toEqual([
      "filter line items: 1 looked for in 0 of 0 candidate modules that have the filtered dimensions and 30 of 30 other modules, in 40 s: 0 found, 1 not found",
      "filter line items: the entity-type bracket chose 0 of the 30 modules asked for; fewer than 3 modules with line items were read", unnamed]);
  });

  it("ends the search for filter line items at once when the run is stopped, the model closes or the connection fails, and asks for no further module", async () => {
    const stopped = new Error("Stopped: the results page was closed.");
    const others = Array.from({ length: 12 }, (_, index) => other(index + 1));
    const closed = "Synthetic model: names from the model data service were not available (the model is closed); IDs are shown instead.";
    let status = "";
    const answers = (waiting: string, during: (id: string) => string) => ({ [at("")]: (id: string) => { status = id; return update(id, { status: "UNKNOWN" }); },
      [MODULE_VIEWS]: moduleList(others), [waiting]: during });
    // The model names no module for the filtered dimension, so its list is gone through: the sixth of its other modules, one
    // of the second four, is the one whose line items are never answered.
    const waiting = at(`/modules/${other(6)}/lineItems`);

    // Stopped while that read waits: the four it was asked with are the last, the socket is closed, and the stop is what
    // ends the run.
    const stopping = new AbortController();
    serveModel(answers(waiting, () => { stopping.abort(stopped); return ""; }));
    await expect(run(withGrid(), scope, stopping.signal).result).rejects.toBe(stopped);
    expect([searched(), sent("DISCONNECT").length, ScriptedSocket.sockets.map(socket => socket.readyState)]).toEqual([others.slice(0, 8), 1, [3]]);

    // The model closes, or the connection fails: the third four are not asked for, the names are reported as not available,
    // and the search, which did not come to its end, logs nothing of how far it went.
    for (const [during, note] of [[() => update(status, { status: "CLOSED" }), closed], [() => SERVICE_DOWN, UNAVAILABLE]] as const) {
      ScriptedSocket.sockets = [];
      serveModel(answers(waiting, during));
      const { log, result } = run(withGrid());
      expect((await result).notes, note).toEqual([note]);
      expect(searched(), note).toEqual(others.slice(0, 8));
      expect(log.filter(line => line.startsWith("filter ")), note).toEqual([]);
    }

    // The model closes while it is asked which modules have the filtered dimension. That is logged as a refused read, as it
    // always was. No module's line items are asked for after it, although the model's list has twelve that were not read:
    // the search ends there as its next read would have ended, with the names reported as not available.
    ScriptedSocket.sockets = [];
    serveModel(answers(at("/applicableModules"), () => update(status, { status: "CLOSED" })));
    const { log, result } = run(withGrid());
    expect((await result).notes).toEqual([closed]);
    expect([destinations().at(-1), searched()]).toEqual([at("/applicableModules"), []]);
    expect(log.filter(line => /^(modules for|filter )/.test(line))).toEqual([`modules for dimension ${LIST}: the model is closed`]);
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
    // A read that ended with the connection says nothing about its module. On the model's own host those three are read,
    // the five that the first host had answered are not read again, and the rule has its line item.
    const read = (socket: ScriptedSocket) => socket.frames.filter(frame => frame.command === "SEND").flatMap(frame => /\/modules\/(\d+)\/lineItems$/.exec(frame.headers.destination)?.[1] ?? []);
    expect(ScriptedSocket.sockets.map(read)).toEqual([[MODULE, ...candidates], [MODULE, ...candidates.slice(5)]]);
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
    // The search ends with the batch that found the line item: the item the rule's context is fixed to is no line item, so
    // the two modules left are not read for it.
    expect(destinations().filter(destination => destination.endsWith("/lineItems"))).toEqual([MODULE, ...candidates.slice(0, 4)].map(module => at(`/modules/${module}/lineItems`)));
    // Then the module's dimensions, and the item from the one the rule neither filters nor leaves to the page.
    expect(lastSent(2)).toEqual([[at("/dimensions"), { moduleIds: [candidate(2)] }], [at(`/modules/${candidate(2)}/dimensions/${REGIONS}`), { itemIds: [ITEM(358, 2)], filter: "" }]]);
    expect(statuses.slice(-2)).toEqual(["Finding filter line items in Synthetic model…", "Reading filter item names in Synthetic model…"]);
    // The log says how far the search went: the IDs of the rule that had no line item, the modules read of those that have
    // the filtered dimension, and what became of each ID. One of the two was the line item; the other is the rule's
    // context, which is no longer looked for once the rule has its line item.
    expect(log.filter(line => /^(filter |dimensions of)/.test(line))).toEqual(["dimensions of 1 of 1 modules",
      "filter line items: 2 looked for in 4 of 6 candidate modules that have the filtered dimensions and 0 of 0 other modules, in 0 s: 1 found (1 in candidate modules), "
        + "1 the context of rules that now have their line item, 0 not found",
      "filter line items: the entity-type bracket chose 0 of the 4 modules asked for; fewer than 3 modules with line items were read",
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

  it("writes the zip 0.6.1 wrote for the same app, byte for byte but for one reworded row of App Details.csv, and returns each file as a table", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.UTC(2026, 8, 28, 12, 30, 10)));
    const result = await analyseGoldenApp();
    const zip = resultZip(result, ZIPPED_AT);
    // One row of App Details.csv is deliberately not what 0.6.1 wrote: the "How to read" row on a filter's context, which now
    // says how the items of a filter are shown (APP_ROW_REWORDED; the two other known differences, the build's name in the
    // "Exported with" row and in the first Diagnostics line, do not show here). Everything else is what 0.6.1 wrote, byte
    // for byte.
    // File by file first, so that a difference shows as text: 0.6.1's files in their order, each with its text, and of
    // App Details.csv every line but that one, which stood there once.
    const [written, before] = [unzipText(zip), unzipText(APP_ZIP_0_6_1)];
    expect([...written.keys()]).toEqual([...before.keys()]);
    const lines = before.get(DETAILS_FILE)!.split(APP_ROW_REWORDED.was);
    expect(lines).toHaveLength(2);
    for (const [file, text] of before) expect(written.get(file), file).toBe(file === DETAILS_FILE ? lines.join(APP_ROW_REWORDED.now) : text);
    // Then every byte. Of the eight files, only App Details.csv has other bytes than 0.6.1's.
    const [files, golden] = [zipEntries(zip), zipEntries(APP_ZIP_0_6_1)];
    expect(files.filter((file, index) => !sameBytes(file.data, golden[index].data)).map(file => file.name)).toEqual([DETAILS_FILE]);
    // The zip around the files is written as 0.6.1 wrote it: from 0.6.1's own files, it is 0.6.1's zip.
    expect(sameBytes(zipStore(golden, ZIPPED_AT), APP_ZIP_0_6_1)).toBe(true);
    // So this run's zip is, byte for byte, 0.6.1's zip with that one row reworded.
    expect(sameBytes(zip, APP_ZIP_REWORDED)).toBe(true);

    expect([result.kind, result.name, result.id, result.zipName]).toEqual(["app", "Planning: app", GOLDEN_APP, "Planning app - App Export - 2026-09-28.zip"]);
    expect(result.summary).toEqual(["1 of 1 pages analysed; 1 unpublished, not analysed, 3 cards."]);
    expect(result.tables.map(table => [table.file, table.label, table.guard, table.details, table.rows.length])).toEqual([
      ["App Details.csv", "App Details", true, true, 28], ["Pages.csv", "Pages", true, undefined, 2], ["Cards.csv", "Cards", true, undefined, 3],
      ["Grid Sections.csv", "Grid Sections", true, undefined, 1], ["Filters.csv", "Filters", true, undefined, 1],
      ["Conditional Formatting.csv", "Conditional Formatting", true, undefined, 1], ["Action Buttons.csv", "Action Buttons", true, undefined, 2],
      ["Where Used.csv", "Where Used", true, undefined, 10]]);
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
      // No line item is told from the rule's other items while one of them is unnamed: all three are listed.
      [`Time, ${ITEM(358, 0)}, Role`, NONE, "is equal to", ITEM(404, 3), NONE, NONE]]);
    expect(cell(unnamed, "Cards.csv", "Filters")).toEqual([[`Rows, match all: Status [Demand] is equal to ${ITEM(318, 2)}`, `Rows, match all: Status [Demand] is equal to ${ITEM(318, 1)}`,
      `Rows, match all: Status [Demand] is equal to ${ITEM(318, 2)}, ${ITEM(318, 1)} (context: Territory = current)`,
      `Rows, match all: Time, ${ITEM(358, 0)}, Role [${NONE}] is equal to ${ITEM(404, 3)}`].join(" | ")]);
    expect(usedIn(unnamed)).toEqual([["Line item", "Status", "Demand", "Filter", STATUS], ["Dimension", "Territory", NONE, "Filter context", LIST_2],
      ["Line item", `Time, ${ITEM(358, 0)}, Role`, NONE, "Filter", NONE]]);
    expect(unnamed.summary).toEqual(["1 of 1 pages analysed, 1 cards."]);

    // The model names them: each ID is the item's name wherever it stood, and the fourth rule is told apart: its line item,
    // that item's module and ID, and its context.
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
    // Nothing else differs between the two: the other columns of Filters.csv and of Cards.csv, the other rows of Where
    // Used.csv, and every other file. App Details.csv counts the row that Where Used.csv gains for the rule that is told
    // apart (its context's dimension), and says when it was exported.
    const changing: Record<string, string[]> = { "Filters.csv": ["Condition line item", "Condition line item's module", "Value", "Condition context", "Line item ID"], "Cards.csv": ["Filters"] };
    const others = (result: typeof named) => result.tables.map(table => [table.file,
      table.file === DETAILS_FILE ? table.rows.filter(row => row[1] !== "Exported on" && row[1] !== "Where Used.csv")
        : table.file === "Where Used.csv" ? table.rows.filter(row => !String(row[5]).startsWith("Filter"))
          : table.rows.map(row => row.filter((_, column) => !(changing[table.file] ?? []).includes(table.headers[column])))]);
    expect(others(named)).toEqual(others(unnamed));
    const used = (result: typeof named) => result.tables.find(each => each.file === "Where Used.csv")!.rows.length;
    expect(used(named)).toBe(used(unnamed) + 1);
    expect([unnamed, named].map(result => result.tables[0].rows.find(row => row[1] === "Where Used.csv")?.[2])).toEqual([`${used(unnamed)} rows`, `${used(named)} rows`]);
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
      "filter line items: 1 looked for in 0 of 0 candidate modules that have the filtered dimensions and 12 of 12 other modules, in 0 s: 1 found (0 in candidate modules), 0 not found",
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
    // What arrived is the whole result: the same zip, and its Diagnostics rows are the log up to the report.
    const result = assemble(page.received);
    expect(unzipText(resultZip(result, ZIPPED_AT)).get("Cards.csv")).toBe(unzipText(APP_ZIP_0_6_1).get("Cards.csv"));
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
