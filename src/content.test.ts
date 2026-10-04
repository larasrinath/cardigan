import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assemble } from "./pieces.test-support.js";
import type { AnalysisResult } from "./result-types.js";
import { EXTENSION, FakePort } from "./tab-port.test-support.js";

// The two bundles' entry points run on import; each test imports one afresh against a stand-in page.
const WS = "0123456789abcdef0123456789abcdef";
const MODEL = "FEDCBA9876543210FEDCBA9876543210";
const APP = "01234567-89ab-cdef-0123-456789abcdef";
const PROTOCOL = "cardigan-model-export";
const [SHELL, CORE] = ["https://us1a.app.anaplan.com", "https://eu2a.app.anaplan.com"];
const MODEL_BUILDING = `/a/modeling/customers/${WS}/models/${MODEL}/modules`;

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

  it("answers once however often the script is injected into the same page", async () => {
    at(`/a/apps/app/${APP}`);
    const connects: unknown[] = [];
    vi.stubGlobal("chrome", { runtime: { id: EXTENSION, onConnect: { addListener: (listener: (port: chrome.runtime.Port) => void) => { connects.push(listener); connect = listener; } } } });
    await import("./content.js");
    vi.resetModules();
    await import("./content.js");
    expect([connects.length, listeners.length]).toEqual([1, 2]);
    expect(open().received).toEqual([{ type: "subject", subject: { kind: "app", id: APP } }]);
    // A new page is a new window, and is served again.
    vi.resetModules();
    const next = { ...page, cardiganServing: undefined } as Record<string, unknown>;
    next.top = next;
    vi.stubGlobal("window", next);
    await import("./content.js");
    expect(connects).toHaveLength(2);
  });

  it("says what the page shows by its address: an app, a model in Model Building, or neither", async () => {
    for (const [pathname, subject] of [
      [`/a/apps/app/${APP}`, { kind: "app", id: APP }], [`/a/springboard/apps/app/${APP}/page/board/${APP}`, { kind: "app", id: APP }],
      [`/a/apps/app/${APP.toUpperCase()}/`, { kind: "app", id: APP.toUpperCase() }],
      [MODEL_BUILDING, { kind: "model", id: MODEL }], [`/a/modeling-ui/customers/${WS}/workspaces/${WS}/models/${MODEL}`, { kind: "model", id: MODEL }],
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
    hear({ protocol: PROTOCOL, type: "core-ready", modelId: MODEL }, CORE, frame);
    expect(open().received).toEqual([{ type: "subject", subject: { kind: "none" } }]);
    // Nor does anything that is not from an Anaplan origin, or names no model ID.
    hear({ protocol: PROTOCOL, type: "core-ready", modelId: MODEL }, "https://evil.example.com", page);
    hear({ protocol: PROTOCOL, type: "core-ready", modelId: "not-a-model" }, CORE, page);
    expect(open().received).toEqual([{ type: "subject", subject: { kind: "none" } }]);
    expect(posted).toEqual([]);

    // The main-world script of this same window announces the model it holds: acknowledged, and now a model page.
    hear({ protocol: PROTOCOL, type: "core-ready", modelId: MODEL }, CORE, page);
    expect(posted).toEqual([{ protocol: PROTOCOL, type: "ack" }]);
    expect(open().received).toEqual([{ type: "subject", subject: { kind: "model", id: MODEL } }]);
    // It stays one whatever a frame inside it announces afterwards, and it is this window that is asked to export.
    hear({ protocol: PROTOCOL, type: "core-ready", modelId: WS }, CORE, frame);
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

  it("exports a model through its core frame when the results page asks, and hands the files on in pieces", async () => {
    at(MODEL_BUILDING);
    await import("./content.js");
    const frame = { asked: [] as { type: string; nonce?: string }[], postMessage(message: { type: string; nonce?: string }) { this.asked.push(message); } };
    hear({ protocol: PROTOCOL, type: "core-ready", modelId: MODEL }, CORE, frame);
    expect(frame.asked).toEqual([{ protocol: PROTOCOL, type: "ack" }]);
    // The page's own window announcing a model does not take the frame's place: Model Building reads in the frame, as it always has.
    hear({ protocol: PROTOCOL, type: "core-ready", modelId: MODEL }, SHELL, page);
    posted.length = 0;

    const port = open();
    expect(port.take()).toEqual([{ type: "subject", subject: { kind: "model", id: MODEL } }]);
    port.say({ type: "run" });
    await vi.advanceTimersByTimeAsync(0);
    expect(frame.asked.map(message => message.type)).toEqual(["ack", "run"]);
    const { nonce } = frame.asked[1];

    const exported: AnalysisResult = { kind: "model", name: "Model one", id: MODEL, zipName: "Model one - Model Export - 2026-09-28.zip", summary: ["Versions: 1 rows"],
      tables: [{ file: "Model Details.csv", label: "Model Details", headers: ["Section", "Detail", "Value"], rows: [["Model", "Model", "Model one"]], guard: true, details: true },
        { file: "Versions.csv", label: "Versions", headers: ["", "Is Actual"], rows: [["Actual", "true"]], guard: false }] };
    hear({ protocol: PROTOCOL, type: "status", nonce, text: "Reading Versions…" }, CORE, frame);
    hear({ protocol: PROTOCOL, type: "done", nonce, result: exported }, CORE, frame);
    await vi.advanceTimersByTimeAsync(0);
    expect(port.types()).toEqual(["log", "status", "log", "result", "rows", "rows", "done"]);
    expect(port.received.slice(0, 3)).toEqual([{ type: "log", text: `01:59:09 Cardigan dev: model ${MODEL} on us1a.app.anaplan.com` },
      { type: "status", text: "Reading Versions…" }, { type: "log", text: "01:59:09 Reading Versions…" }]);
    expect(assemble(port.received)).toEqual(exported);
    // Nothing went to Anaplan from this window, and nothing was asked of it: the frame did the reading.
    expect([vi.mocked(globalThis.fetch).mock.calls, vi.mocked(globalThis.WebSocket).mock.calls, posted]).toEqual([[], [], []]);

    // The results page closes during the next run: the frame is told to stop.
    port.say({ type: "run" });
    await vi.advanceTimersByTimeAsync(0);
    port.close();
    expect(frame.asked.slice(2).map(message => [message.type, message.nonce === frame.asked[2].nonce])).toEqual([["run", true], ["stop", true]]);
  });

  it("announces the model from its core frame to the page around it, and puts nothing on the page", async () => {
    const top = { posted: [] as unknown[], postMessage(message: unknown) { this.posted.push(message); } };
    vi.stubGlobal("window", { require: () => undefined, modelId: MODEL, workspaceId: WS, addEventListener: () => undefined, top });
    at("/core-webapp/anaplan/framework.jsp", "eu2a.app.anaplan.com");
    await import("./model-content.js");
    vi.advanceTimersByTime(1000);
    expect(top.posted).toContainEqual({ protocol: PROTOCOL, type: "core-ready", modelId: MODEL });
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
    expect(posted).toContainEqual({ protocol: PROTOCOL, type: "core-ready", modelId: MODEL });
    // It serves this window: one listener, for what the content script of the same window asks.
    expect(listeners).toHaveLength(1);
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
