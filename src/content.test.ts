import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NO_CUSTOMER } from "./model-pages.js";
import { assemble } from "./pieces.test-support.js";
import type { AnalysisResult } from "./result-types.js";
import { EXTENSION, FakePort } from "./tab-port.test-support.js";
import { BUILD } from "./version.js";

// The two bundles' entry points run on import; each test imports one afresh against a stand-in page.
const WS = "0123456789abcdef0123456789abcdef";
const MODEL = "FEDCBA9876543210FEDCBA9876543210";
const APP = "01234567-89ab-cdef-0123-456789abcdef";
const PROTOCOL = "cardigan-model-export";
const [SHELL, CORE] = ["https://us1a.app.anaplan.com", "https://eu2a.app.anaplan.com"];
const MODEL_BUILDING = `/a/modeling/customers/${WS}/models/${MODEL}/modules`;

/** A model's export as the frame hands it over: its details and one grid. */
const exportedModel = (): AnalysisResult => ({ kind: "model", name: "Model one", id: MODEL, zipName: "Model one - Model Export - 2026-09-28.zip", summary: ["Versions: 1 rows"],
  tables: [{ file: "Model Details.csv", label: "Model Details", headers: ["Section", "Detail", "Value"], rows: [["Model", "Model", "Model one"], ["Model", "Workspace ID", WS]],
    guard: true, details: true }, { file: "Versions.csv", label: "Versions", headers: ["", "Is Actual"], rows: [["Actual", "true"]], guard: false }] });
/** That export as the results page gets it when the pages built on the model are not read, for `why` (model-pages.ts),
 * with what the step logged at the end of its diagnostic log. */
function withoutPages(why: string, logged: string[] = []): AnalysisResult {
  const result = exportedModel();
  const files = ["Module Usage", "Page Filters", "Page Actions"];
  result.summary.push(...files.map(file => `${file}: not exported (${why}).`));
  result.tables[0].rows.push(...files.map(file => ["Files", `${file}.csv`, `Not exported: ${why}`]), ...logged.map(line => ["Diagnostics", "01:59:09", line]));
  return result;
}

type Listener = (event: { data: unknown; origin: string; source: unknown }) => void;

/** A page whose DOM must not be touched: reading anything of the document but its cookies fails the test. */
const untouchable = () => new Proxy({}, {
  get: (_target, key) => { if (key === "cookie") return "other=1"; throw new Error(`the page's document was used: ${String(key)}`); },
  set: (_target, key) => { throw new Error(`the page's document was changed: ${String(key)}`); },
});

describe("The content scripts on an Anaplan page", () => {
  let connect: ((port: chrome.runtime.Port) => void) | undefined;
  let listeners: Listener[];
  let posted: unknown[];
  let page: Record<string, unknown>;

  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.UTC(2026, 8, 28, 1, 59, 9)));
    connect = undefined;
    listeners = [];
    posted = [];
    // The top window: it hears messages, and a message posted to it is recorded.
    page = { addEventListener: (_type: string, listener: Listener) => { listeners.push(listener); }, removeEventListener: () => undefined, frames: [],
      postMessage: (message: unknown) => { posted.push(message); } };
    page.top = page;
    vi.stubGlobal("window", page);
    vi.stubGlobal("document", untouchable());
    vi.stubGlobal("chrome", { runtime: { id: EXTENSION, onConnect: { addListener: (listener: (port: chrome.runtime.Port) => void) => { connect = listener; } } } });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 401 })));
    vi.stubGlobal("WebSocket", vi.fn());
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  const at = (pathname: string, host = "us1a.app.anaplan.com") => vi.stubGlobal("location", { host, origin: `https://${host}`, pathname });
  const open = () => { const port = new FakePort(); connect!(port as unknown as chrome.runtime.Port); return port; };
  const hear = (data: unknown, origin: string, source: unknown) => { for (const listener of [...listeners]) listener({ data, origin, source }); };

  it("puts nothing on the page and reads nothing when an Anaplan page is merely visited", async () => {
    at(`/a/springboard/apps/app/${APP}/page/board/${APP}`);
    await import("./content.js");
    // It waits to be connected to, and listens for the model's frame; that is all.
    expect(connect).toBeTypeOf("function");
    expect(listeners).toHaveLength(2);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect([vi.mocked(globalThis.fetch).mock.calls, vi.mocked(globalThis.WebSocket).mock.calls, posted]).toEqual([[], [], []]);

    // Connected to, it says what the page shows, and still reads nothing.
    expect(open().received).toEqual([{ type: "subject", subject: { kind: "app", id: APP } }]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect([vi.mocked(globalThis.fetch).mock.calls, vi.mocked(globalThis.WebSocket).mock.calls, vi.getTimerCount()]).toEqual([[], [], 0]);
  });

  it("answers once however often the script is injected into the same page: the latest copy answers", async () => {
    at(`/a/apps/app/${APP}`);
    const connects: ((port: chrome.runtime.Port) => void)[] = [];
    vi.stubGlobal("chrome", { runtime: { id: EXTENSION, onConnect: { addListener: (listener: (port: chrome.runtime.Port) => void) => { connects.push(listener); connect = listener; } } } });
    await import("./content.js");
    vi.resetModules();
    // The results page puts the script into a page whose copy no longer answers, as after Cardigan was reloaded.
    await import("./content.js");
    // Chrome hands a new port to every copy's listener: only the latest answers, and the earlier one leaves the port open.
    const port = new FakePort();
    for (const listener of connects) listener(port as unknown as chrome.runtime.Port);
    expect(connects).toHaveLength(2);
    expect(port.received).toEqual([{ type: "subject", subject: { kind: "app", id: APP } }]);
    expect(port.refused).toBe(false);
    // A new page is a new window, and is served again.
    vi.resetModules();
    const next = { ...page, cardiganServing: undefined } as Record<string, unknown>;
    next.top = next;
    vi.stubGlobal("window", next);
    await import("./content.js");
    expect(connects).toHaveLength(3);
  });

  it("says what the page shows by its address: an app, a model in Model Building, or neither", async () => {
    for (const [pathname, subject] of [
      [`/a/apps/app/${APP}`, { kind: "app", id: APP }], [`/a/springboard/apps/app/${APP}/page/board/${APP}`, { kind: "app", id: APP }],
      [`/a/apps/app/${APP.toUpperCase()}/`, { kind: "app", id: APP.toUpperCase() }],
      // A model in Model Building says where it is, its site and the customer its address names: the results page opens
      // one of its modules there.
      [MODEL_BUILDING, { kind: "model", id: MODEL, origin: SHELL, customer: WS }],
      [`/a/modeling-ui/customers/${WS}/workspaces/${WS}/models/${MODEL}`, { kind: "model", id: MODEL, origin: SHELL, customer: WS }],
      [`/a/modeling/workspaces/${WS}/models/${MODEL}`, { kind: "model", id: MODEL }], [`/a/modeling/customers/${WS.slice(1)}/models/${MODEL}`, { kind: "model", id: MODEL }],
      // An address that names both is the app's.
      [`/a/modeling/customers/${WS}/models/${MODEL}/apps/app/${APP}`, { kind: "app", id: APP }],
      ["/a/home", { kind: "none" }], ["/", { kind: "none" }], [`/a/apps/app/${APP.slice(1)}`, { kind: "none" }], [`/a/apps/app/${APP}x`, { kind: "none" }],
      [`/a/modeling/customers/${WS}/models/${MODEL.slice(1)}/modules`, { kind: "none" }], [`/a/other/models/${MODEL}`, { kind: "none" }],
      ["/core-webapp/anaplan/framework.jsp", { kind: "none" }],
    ] as const) {
      // Each address is another page: a new window and a new copy of the script.
      vi.resetModules();
      delete page.cardiganServing;
      at(pathname);
      await import("./content.js");
      expect(open().received, pathname).toEqual([{ type: "subject", subject }]);
    }
  });

  it("takes a classic model page opened on its own for a model page once this window's own script has announced the model", async () => {
    at("/core-webapp/anaplan/framework.jsp", "eu2a.app.anaplan.com");
    await import("./content.js");
    expect(open().received).toEqual([{ type: "subject", subject: { kind: "none" } }]);

    // A frame inside the page that holds a model does not make the page a model page: only a Model Building address does.
    const frame = { postMessage: vi.fn() };
    hear({ protocol: PROTOCOL, type: "core-ready", modelId: MODEL, build: BUILD }, CORE, frame);
    expect(open().received).toEqual([{ type: "subject", subject: { kind: "none" } }]);
    // Nor does anything that is not from an Anaplan origin, or names no model ID.
    hear({ protocol: PROTOCOL, type: "core-ready", modelId: MODEL, build: BUILD }, "https://evil.example.com", page);
    hear({ protocol: PROTOCOL, type: "core-ready", modelId: "not-a-model" }, CORE, page);
    expect(open().received).toEqual([{ type: "subject", subject: { kind: "none" } }]);
    expect(posted).toEqual([]);

    // The main-world script of this same window announces the model it holds: acknowledged, and now a model page.
    hear({ protocol: PROTOCOL, type: "core-ready", modelId: MODEL, build: BUILD }, CORE, page);
    expect(posted).toEqual([{ protocol: PROTOCOL, type: "ack" }]);
    expect(open().received).toEqual([{ type: "subject", subject: { kind: "model", id: MODEL } }]);
    // It stays one whatever a frame inside it announces afterwards, and it is this window that is asked to export.
    hear({ protocol: PROTOCOL, type: "core-ready", modelId: WS, build: BUILD }, CORE, frame);
    const port = open();
    expect(port.received).toEqual([{ type: "subject", subject: { kind: "model", id: MODEL } }]);
    port.say({ type: "run" });
    await vi.advanceTimersByTimeAsync(0);
    expect(posted.map(message => (message as { type: string }).type)).toEqual(["ack", "run"]);
    expect(frame.postMessage.mock.calls.map(([message]) => (message as { type: string }).type)).toEqual(["ack", "ack"]);
  });

  it("does nothing in a frame", async () => {
    vi.stubGlobal("window", { ...page, top: {} });
    at(`/a/apps/app/${APP}`);
    await import("./content.js");
    expect([connect, listeners, vi.getTimerCount()]).toEqual([undefined, [], 0]);
  });

  it("analyses the app only when the results page asks, and reports a signed-out session by its code", async () => {
    at(`/a/apps/app/${APP}`);
    await import("./content.js");
    const port = open();
    expect(globalThis.fetch).not.toHaveBeenCalled();

    port.say({ type: "run" });
    await vi.waitFor(() => expect(port.received.at(-1)?.type).toBe("error"));
    expect(vi.mocked(globalThis.fetch).mock.calls.map(([url]) => url))
      .toEqual([`https://us1a.app.anaplan.com/a/springboard-definition-service/apps/${APP}?includeUnpublished=true&includeReportPages=true`]);
    expect(port.received).toEqual([{ type: "subject", subject: { kind: "app", id: APP } },
      { type: "log", text: `01:59:09 Cardigan dev: app ${APP} on us1a.app.anaplan.com` }, { type: "status", text: "Reading the app…" },
      { type: "log", text: "01:59:09 Reading the app…" }, { type: "log", text: "01:59:09 stopped: SIGNED_OUT (HTTP 401)" },
      { type: "error", message: "You're signed out of Anaplan. Sign in and try again.", code: "SIGNED_OUT" }]);

    // Another failure carries no code: the page is told in plain words, and the status Anaplan answered with is in the log.
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 403 })));
    port.take();
    port.say({ type: "run" });
    await vi.waitFor(() => expect(port.received.at(-1)?.type).toBe("error"));
    expect(port.received.slice(-2)).toEqual([{ type: "log", text: "01:59:09 stopped: HTTP_ERROR (HTTP 403)" },
      { type: "error", message: "Anaplan refused the request. You may not have access to this app: check that you can open it in Anaplan, then choose Run again." }]);
  });

  it("stops the app's analysis when the results page is closed: the page being read is finished, and no further one is started", async () => {
    at(`/a/apps/app/${APP}`);
    const pageGuid = (n: number) => `11111111-2222-3333-4444-55555555555${n}`;
    const pages = [1, 2, 3].map(n => ({ guid: pageGuid(n), name: `Page ${n}`, pageType: "BOARD", hasPublishedVersion: true }));
    const read: string[] = [];
    let port: FakePort | undefined;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const path = new URL(url).pathname.split("/").slice(3).join("/");
      read.push(path);
      if (path.startsWith("apps/")) return new Response(JSON.stringify({ name: "Plan", pages }), { status: 200 });
      // The results page is closed while page 1 is being read. No route returns the page, so all three are tried.
      if (path === `boards/${pageGuid(1)}`) port!.close();
      return new Response("{}", { status: 404 });
    }));
    await import("./content.js");
    port = open();
    port.say({ type: "run" });
    await vi.advanceTimersByTimeAsync(1000);
    expect(read).toEqual([`apps/${APP}`, `boards/${pageGuid(1)}`, `grid-pages/${pageGuid(1)}`, `reports/${pageGuid(1)}`]);
    expect(vi.mocked(globalThis.WebSocket).mock.calls).toEqual([]);
  });

  it("waits for the model's frame on a Model Building page even when the page's own window has announced a model", async () => {
    at(MODEL_BUILDING);
    await import("./content.js");
    // Only this window itself says it holds a model: no frame has checked in.
    hear({ protocol: PROTOCOL, type: "core-ready", modelId: MODEL, build: BUILD }, SHELL, page);
    expect(posted).toEqual([{ protocol: PROTOCOL, type: "ack" }]);
    const port = open();
    port.say({ type: "run" });
    await vi.advanceTimersByTimeAsync(2500);
    // Acknowledged, and never asked to export: Model Building reads in the frame, so the page goes on waiting for it.
    expect(posted.map(message => (message as { type: string }).type)).toEqual(["ack"]);
    expect(port.received.filter(message => message.type === "status")).toEqual(Array(3).fill({ type: "status", text: "Waiting for the model's frame…" }));
    port.close();
  });

  it("exports a model through its core frame when the results page asks, and hands the files on in pieces", async () => {
    at(MODEL_BUILDING);
    await import("./content.js");
    const frame = { asked: [] as { type: string; nonce?: string }[], postMessage(message: { type: string; nonce?: string }) { this.asked.push(message); } };
    hear({ protocol: PROTOCOL, type: "core-ready", modelId: MODEL, build: BUILD }, CORE, frame);
    expect(frame.asked).toEqual([{ protocol: PROTOCOL, type: "ack" }]);
    // The page's own window announcing a model does not take the frame's place: Model Building reads in the frame, as it always has.
    hear({ protocol: PROTOCOL, type: "core-ready", modelId: MODEL, build: BUILD }, SHELL, page);
    posted.length = 0;

    const port = open();
    expect(port.take()).toEqual([{ type: "subject", subject: { kind: "model", id: MODEL, origin: SHELL, customer: WS } }]);
    port.say({ type: "run" });
    await vi.advanceTimersByTimeAsync(0);
    expect(frame.asked.map(message => message.type)).toEqual(["ack", "run"]);
    const { nonce } = frame.asked[1];

    hear({ protocol: PROTOCOL, type: "status", nonce, text: "Reading Versions…" }, CORE, frame);
    // The frame's sign of life before each page of a grid is for this script alone: the results page is sent nothing for it.
    hear({ protocol: PROTOCOL, type: "alive", nonce }, CORE, frame);
    hear({ protocol: PROTOCOL, type: "done", nonce, result: exportedModel() }, CORE, frame);
    await vi.advanceTimersByTimeAsync(0);
    // Then this window reads the pages built on the model, for the customer the address names. Anaplan answers that the
    // session has ended: the export is handed on all the same, and says why it has no tables of those pages.
    expect(port.types()).toEqual(["log", "status", "log", "status", "log", "log", "result", "rows", "rows", "done"]);
    expect(port.received.slice(0, 6)).toEqual([{ type: "log", text: `01:59:09 Cardigan dev: model ${MODEL} on us1a.app.anaplan.com` },
      { type: "status", text: "Reading Versions…" }, { type: "log", text: "01:59:09 Reading Versions…" },
      { type: "status", text: "Reading the pages built on this model…" }, { type: "log", text: "01:59:09 Reading the pages built on this model…" },
      { type: "log", text: "01:59:09 pages built on the model: SIGNED_OUT (HTTP 401)" }]);
    // The result says where the model is, as the address said it: the results page opens its modules, apps and pages there.
    expect(assemble(port.received)).toEqual({ ...withoutPages("you're signed out of Anaplan", ["Reading the pages built on this model…", "pages built on the model: SIGNED_OUT (HTTP 401)"]),
      site: { origin: SHELL, customer: WS } });
    // The frame did the export's reading. This window asked Anaplan for one thing, with GET, opened no socket, and asked the frame nothing more.
    expect(vi.mocked(globalThis.fetch).mock.calls.map(([url, init]) => [url, init?.method]))
      .toEqual([[`${SHELL}/a/springboard-definition-service/customer/${WS}/model/${MODEL}/pages`, "GET"]]);
    expect([vi.mocked(globalThis.WebSocket).mock.calls, posted]).toEqual([[], []]);

    // The results page closes during the next run: the frame is told to stop.
    port.say({ type: "run" });
    await vi.advanceTimersByTimeAsync(0);
    port.close();
    expect(frame.asked.slice(2).map(message => [message.type, message.nonce === frame.asked[2].nonce])).toEqual([["run", true], ["stop", true]]);
  });

  it("opens a module inside the Model Building page through the model's frame when the results page asks, and says what came of it", async () => {
    at(MODEL_BUILDING);
    await import("./content.js");
    const frame = { asked: [] as { type: string; nonce?: string; model?: string; module?: string }[], postMessage(message: { type: string }) { this.asked.push(message); } };
    hear({ protocol: PROTOCOL, type: "core-ready", modelId: MODEL, build: BUILD }, CORE, frame);
    const port = open();
    port.take();
    const opened = () => port.take().filter(message => message.type === "opened");
    port.say({ type: "open", nonce: "ask-1", model: MODEL, module: "102000000001" });
    await vi.advanceTimersByTimeAsync(0);
    // The frame is asked, by the model's ID and the module's, and its answer goes back to the page for that very ask.
    const ask = frame.asked.find(message => message.type === "open")!;
    expect(ask).toEqual({ protocol: PROTOCOL, type: "open", nonce: expect.any(String), model: MODEL, module: "102000000001" });
    hear({ protocol: PROTOCOL, type: "opened", nonce: ask.nonce, opened: true }, CORE, frame);
    await vi.advanceTimersByTimeAsync(0);
    expect(opened()).toEqual([{ type: "opened", nonce: "ask-1", opened: true, detail: "Model Building opened it beside the modules open there" }]);
    // A frame that says it could not, and one that says nothing in time.
    port.say({ type: "open", nonce: "ask-2", model: MODEL.toLowerCase(), module: "102000000002" });
    await vi.advanceTimersByTimeAsync(0);
    hear({ protocol: PROTOCOL, type: "opened", nonce: frame.asked.at(-1)!.nonce, opened: false }, CORE, frame);
    port.say({ type: "open", nonce: "ask-3", model: MODEL, module: "102000000003" });
    await vi.advanceTimersByTimeAsync(1000);
    expect(opened()).toEqual([{ type: "opened", nonce: "ask-2", opened: false, detail: "the model's frame did not open it" },
      { type: "opened", nonce: "ask-3", opened: false, detail: "the model's frame did not open it" }]);
    // Nothing of it was read from Anaplan, and nothing was put on the page.
    expect([vi.mocked(globalThis.fetch).mock.calls, vi.mocked(globalThis.WebSocket).mock.calls]).toEqual([[], []]);
  });

  it("opens no module inside the page where the page shows another model, no Model Building, or a frame of another build or none", async () => {
    at(`/a/modeling/customers/${WS}/models/0123456789ABCDEF0123456789ABCDEF/modules`);
    await import("./content.js");
    const frame = { asked: [] as { type: string }[], postMessage(message: { type: string }) { this.asked.push(message); } };
    hear({ protocol: PROTOCOL, type: "core-ready", modelId: MODEL, build: "0a1b2c3d4e5f" }, CORE, frame);
    const port = open();
    port.take();
    const ask = async (nonce: string) => {
      port.say({ type: "open", nonce, model: MODEL, module: "102000000001" });
      await vi.advanceTimersByTimeAsync(400);
      return port.take().filter(message => message.type === "opened").map(message => (message as { detail: string }).detail);
    };
    expect(await ask("another-model")).toEqual(["the tab shows another model"]);
    at(MODEL_BUILDING);
    expect(await ask("another-build")).toEqual(["the model's frame holds a reader of another build"]);
    at(`/a/springboard/apps/app/${APP}/page/board/${APP}`);
    expect(await ask("an-app")).toEqual(["the tab does not show Model Building"]);
    expect(frame.asked.map(message => message.type)).toEqual(["ack"]);
  });

  it("greets the frames when no model's frame has checked in, and opens nothing where none does", async () => {
    at(MODEL_BUILDING);
    const inner = { greeted: [] as unknown[], frames: [], postMessage(message: unknown) { this.greeted.push(message); } };
    page.frames = [inner];
    await import("./content.js");
    const port = open();
    port.take();
    port.say({ type: "open", nonce: "ask-1", model: MODEL, module: "102000000001" });
    await vi.advanceTimersByTimeAsync(400);
    expect([inner.greeted, port.take()]).toEqual([[{ protocol: PROTOCOL, type: "hello" }],
      [{ type: "opened", nonce: "ask-1", opened: false, detail: "the model's frame has not checked in" }]]);
  });

  it("opens a module from the model's frame inside Model Building when the page around it asks, through the classic client's own topic", async () => {
    const heard: Listener[] = [];
    const top = { posted: [] as unknown[], postMessage(message: unknown) { this.posted.push(message); } };
    const published: unknown[][] = [];
    const topic = { publish: (...args: unknown[]) => { published.push(args); } };
    vi.stubGlobal("window", { modelId: MODEL, workspaceId: WS, require: (_modules: string[], ready: (topic: unknown) => void) => ready(topic),
      addEventListener: (_type: string, listener: Listener) => { heard.push(listener); }, removeEventListener: () => undefined, top });
    at("/core-webapp/anaplan/framework.jsp", "eu2a.app.anaplan.com");
    await import("./model-content.js");
    vi.advanceTimersByTime(1000);
    for (const listener of [...heard]) listener({ data: { protocol: PROTOCOL, type: "open", nonce: "ask", model: MODEL, module: "102000000409" }, origin: SHELL, source: top });
    await vi.advanceTimersByTimeAsync(0);
    expect([published, top.posted.filter(message => (message as { type: string }).type === "opened")])
      .toEqual([[["anaplan/views", 102000000409]], [{ protocol: PROTOCOL, type: "opened", nonce: "ask", opened: true }]]);
  });

  it("reads nothing of the pages built on a model where the address names no customer, and says so", async () => {
    at(`/a/modeling/workspaces/${WS}/models/${MODEL}`);
    await import("./content.js");
    const frame = { asked: [] as { type: string; nonce?: string }[], postMessage(message: { type: string; nonce?: string }) { this.asked.push(message); } };
    hear({ protocol: PROTOCOL, type: "core-ready", modelId: MODEL, build: BUILD }, CORE, frame);
    const port = open();
    expect(port.take()).toEqual([{ type: "subject", subject: { kind: "model", id: MODEL } }]);
    port.say({ type: "run" });
    await vi.advanceTimersByTimeAsync(0);
    hear({ protocol: PROTOCOL, type: "done", nonce: frame.asked[1].nonce, result: exportedModel() }, CORE, frame);
    await vi.advanceTimersByTimeAsync(0);
    expect(assemble(port.received)).toEqual(withoutPages(NO_CUSTOMER));
    expect([vi.mocked(globalThis.fetch).mock.calls, vi.mocked(globalThis.WebSocket).mock.calls]).toEqual([[], []]);
  });

  it("announces the model from its core frame to the page around it, and puts nothing on the page", async () => {
    const top = { posted: [] as unknown[], postMessage(message: unknown) { this.posted.push(message); } };
    vi.stubGlobal("window", { require: () => undefined, modelId: MODEL, workspaceId: WS, addEventListener: () => undefined, top });
    at("/core-webapp/anaplan/framework.jsp", "eu2a.app.anaplan.com");
    await import("./model-content.js");
    vi.advanceTimersByTime(1000);
    expect(top.posted).toContainEqual({ protocol: PROTOCOL, type: "core-ready", modelId: MODEL, build: BUILD });
    expect(connect).toBeUndefined();
  });

  it("announces the model of a classic model page opened on its own to its own window, once the model is there", async () => {
    at("/core-webapp/anaplan/framework.jsp", "eu2a.app.anaplan.com");
    await import("./model-content.js");
    vi.advanceTimersByTime(1000);
    // No model yet: only what this frame sees, as shapes.
    expect(posted).toEqual([{ protocol: PROTOCOL, type: "probe", probe: { host: "eu2a.app.anaplan.com", path: "/core-webapp/anaplan/framework.jsp", top: true,
      loader: "undefined", model: "undefined", workspace: "undefined" } }]);
    Object.assign(page, { require: () => undefined, modelId: MODEL, workspaceId: WS });
    vi.advanceTimersByTime(1000);
    expect(posted).toContainEqual({ protocol: PROTOCOL, type: "core-ready", modelId: MODEL, build: BUILD });
    // It serves this window: one listener, for what the content script of the same window asks.
    expect(listeners).toHaveLength(1);
  });

  it("begins the export's own log with the build, the model and the host on a classic model page opened on its own, and not inside Model Building", async () => {
    // A page's classic client that knows one grid, Versions; every other file is reported as not exported.
    const client = () => {
      const answer = { rowCount: 1, columnCount: 1, rowLabelPages: [{ start: 0, count: 1, entityLongIds: [[107000000001]], labels: [["Actual"]] }],
        columnLabelPages: [{ start: 0, count: 1, entityLongIds: [[4000000301]], labels: [["Is Actual"]] }], dataPages: [{ startRow: 0, rows: [["true"]] }] };
      const aggregator = { isDirty: () => false, post: (_request: unknown, _flag: boolean, ok: (response: unknown) => boolean) => {
        queueMicrotask(() => ok({ result: { viewRequestResults: [answer] } }));
        return true;
      } };
      const cache = { getModelName: () => "Model one", getWorkspaceInfo: () => ({ name: "Workspace one" }), getAllCurrenciesLabelPage: () => undefined };
      const helper = { getAxesForViewDefinition: (rows: string[], columns: string[]) => ({ rowAxis: rows[0], columnAxis: columns[0] }) };
      const constants = { SYSTEM_AXIS_IDENTIFIER_VERSION_ALL_IDENTIFIER: "VERSIONS", SYSTEM_AXIS_IDENTIFIER_VERSION_PROPERTY_IDENTIFIER: "VERSION PROPERTIES" };
      class RequestGenerator { getRequest() { return { requestType: "VIEW_REQUEST_SET", submissions: [], systemActions: [] }; } }
      class DataPage { contains() { return true; } getIndex() { return 0; } getCellText() { return "true"; } getOriginalText() { return "true"; } }
      return { workspaceId: WS, modelId: MODEL,
        require: (_modules: string[], loaded: (...modules: unknown[]) => void) => loaded(cache, aggregator, helper, {}, constants, RequestGenerator, DataPage, {}) };
    };
    /** The Diagnostics rows of Model Details.csv in the last result a window was sent. */
    const diagnostics = (sent: unknown[]) => {
      const done = sent.filter((message): message is { result: AnalysisResult } => (message as { type: string }).type === "done").at(-1);
      return done?.result.tables[0].rows.filter(row => row[0] === "Diagnostics").map(row => row.slice(1));
    };
    at("/core-webapp/anaplan/framework.jsp", "eu2a.app.anaplan.com");

    // Opened on its own: the main-world script serves this same window, whose content script asks it to export.
    Object.assign(page, client());
    await import("./model-content.js");
    vi.advanceTimersByTime(1000);
    hear({ protocol: PROTOCOL, type: "run", nonce: "own" }, CORE, page);
    await vi.advanceTimersByTimeAsync(0);
    // As 0.6.1 began the file's log on such a page, in the words the results page's log begins with now.
    expect(diagnostics(posted)!.slice(0, 2)).toEqual([["01:59:10", `Cardigan dev: model ${MODEL} on eu2a.app.anaplan.com`], ["01:59:10", "Loading the model page's client…"]]);
    // The line is not sent to the page as well: the content script writes the same one into the log it shows.
    expect(posted.filter(message => (message as { type: string }).type === "log").map(message => (message as { text: string }).text)).not.toContainEqual(expect.stringContaining("Cardigan"));
    // A page that no longer names its model gets no line that would name none.
    delete page.modelId;
    hear({ protocol: PROTOCOL, type: "run", nonce: "own again" }, CORE, page);
    await vi.advanceTimersByTimeAsync(0);
    expect(posted.filter(message => (message as { type: string }).type === "done")).toHaveLength(2);
    expect(diagnostics(posted)![0]).toEqual(["01:59:10", "Loading the model page's client…"]);

    // Inside Model Building the frame's log, and so the file, has never had that line.
    vi.resetModules();
    const heard: Listener[] = [];
    const top = { posted: [] as unknown[], postMessage(message: unknown) { this.posted.push(message); } };
    vi.stubGlobal("window", { ...client(), addEventListener: (_type: string, listener: Listener) => { heard.push(listener); }, removeEventListener: () => undefined, top });
    await import("./model-content.js");
    vi.advanceTimersByTime(1000);
    for (const listener of [...heard]) listener({ data: { protocol: PROTOCOL, type: "run", nonce: "frame" }, origin: SHELL, source: top });
    await vi.advanceTimersByTimeAsync(0);
    expect(diagnostics(top.posted)![0]).toEqual(["01:59:11", "Loading the model page's client…"]);
  });

  it("stays inert on a page without a classic model, and stops looking after ten minutes", async () => {
    at("/a/home");
    await import("./model-content.js");
    vi.advanceTimersByTime(11 * 60_000);
    expect(vi.getTimerCount()).toBe(0);
    expect(listeners).toEqual([]);
    expect(posted.every(message => (message as { type: string }).type === "probe")).toBe(true);
    expect([vi.mocked(globalThis.fetch).mock.calls, vi.mocked(globalThis.WebSocket).mock.calls]).toEqual([[], []]);
  });
});
