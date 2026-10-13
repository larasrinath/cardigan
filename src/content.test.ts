import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NO_CUSTOMER } from "./model-pages.js";
import { addUnused } from "./model/unused.js";
import { assemble } from "./pieces.test-support.js";
import type { AnalysisResult } from "./result-types.js";
import { EXTENSION, FakePort } from "./tab-port.test-support.js";
import { BUILD } from "./version.js";
import { goldenApp } from "./results/engine.test-support.js";
import { overviewOf } from "./results/result-view.js";

// The two bundles' entry points run on import; each test imports one afresh against a stand-in page.
const WS = "0123456789abcdef0123456789abcdef";
const MODEL = "FEDCBA9876543210FEDCBA9876543210";
const APP = "01234567-89ab-cdef-0123-456789abcdef";
const PROTOCOL = "cardigan-model-export";
/** What every message of a run or of an ask to open carries: the run channel, and this build (bridge.ts). */
const RUN = { protocol: "cardigan-model-reader", build: BUILD };
const [SHELL, CORE] = ["https://us1a.app.anaplan.com", "https://eu2a.app.anaplan.com"];
const MODEL_BUILDING = `/a/modeling/customers/${WS}/models/${MODEL}/modules`;

/** A model's export as the frame hands it over: its details and one grid. */
const exportedModel = (): AnalysisResult => ({ kind: "model", name: "Model one", id: MODEL, zipName: "Model one - Model Export - 2026-09-28.zip", summary: ["Versions: 1 rows"],
  tables: [{ file: "Model Details.csv", label: "Model Details", headers: ["Section", "Detail", "Value"], rows: [["Model", "Model", "Model one"], ["Model", "Workspace ID", WS]],
    guard: true, details: true }, { file: "Versions.csv", label: "Versions", headers: ["", "Is Actual"], rows: [["Actual", "true"]], guard: false }] });
/** That export as the results page gets it when the pages built on the model are not read, for `why` (model-pages.ts),
 * with what the step logged at the end of its diagnostic log, and then the run's two tables of what nothing uses
 * (model/unused.ts): empty, since this export has no Line Items, with a note that says so and the lines they log. */
function withoutPages(why: string, logged: string[] = []): AnalysisResult {
  const result = exportedModel();
  const files = ["Module Usage", "Page Filters", "Page Actions"];
  result.summary.push(...files.map(file => `${file}: not exported (${why}).`));
  result.tables[0].rows.push(...files.map(file => ["Files", `${file}.csv`, `Not exported: ${why}`]), ...logged.map(line => ["Diagnostics", "01:59:09", line]));
  return addUnused(result, undefined);
}
/** The lines the run's tables of what nothing uses add to the run's log. */
const UNUSED_LINES = 3;

type Listener = (event: { data: unknown; origin: string; source: unknown }) => void;

/** A page whose document allows only cookies and maintenance title/heading checks; every write fails the test. */
const untouchable = () => new Proxy({}, {
  get: (_target, key) => { if (key === "cookie") return "other=1"; if (key === "title") return "Anaplan"; if (key === "querySelectorAll") return () => []; throw new Error(`the page's document was used: ${String(key)}`); },
  set: (_target, key) => { throw new Error(`the page's document was changed: ${String(key)}`); },
});

/** Compare the existing Classic export and progress separately from the new engine diagnostics. */
const classicMessages = (port: FakePort) => port.received.filter(message => !("text" in message && typeof message.text === "string"
  && /Engine:|Classic reader:/.test(message.text)));
const classicResult = (port: FakePort) => {
  const result = assemble(port.received);
  if (result) for (const table of result.tables) if (table.details) table.rows = table.rows.filter(row => !(row[0] === "Diagnostics" && String(row[2]).startsWith("Engine:")));
  return result;
};

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

  /** Puts the page at an address: the window's own location says it as well as the global one. */
  const at = (pathname: string, host = "us1a.app.anaplan.com") => {
    const location = { host, origin: `https://${host}`, pathname };
    page.location = location;
    vi.stubGlobal("location", location);
  };
  const open = () => { const port = new FakePort(); connect!(port as unknown as chrome.runtime.Port); return port; };
  const hear = (data: unknown, origin: string, source: unknown) => { for (const listener of [...listeners]) listener({ data, origin, source }); };

  it.each(["title", "heading"])("recognises the maintenance page by its %s before looking for a model", async where => {
    at("/maintenance");
    vi.stubGlobal("document", { title: where === "title" ? "Anaplan Maintenance" : "Anaplan", querySelectorAll: () => where === "heading" ? [{ textContent: "Down for maintenance" }] : [] });
    await import("./content.js");
    const port = open();
    expect(port.received[0]).toEqual({ type: "subject", subject: { kind: "none", maintenance: true } });
    port.say({ type: "run" });
    expect(port.received.at(-1)).toMatchObject({ type: "error", code: "MAINTENANCE", message: "Try again when it's back. Nothing was read." });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("passes an Anaplan HTTP 503 through the app reader as maintenance", async () => {
    at(`/a/apps/app/${APP}`);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("unavailable", { status: 503 })));
    await import("./content.js");
    const port = open();
    port.say({ type: "run" });
    await vi.advanceTimersByTimeAsync(50);
    expect(port.received.at(-1)).toMatchObject({ type: "error", code: "MAINTENANCE" });
    expect(port.received.some(message => message.type === "log" && message.text.includes("case=MAINTENANCE"))).toBe(true);
    expect(posted).toEqual([]);
  });

  it.each([
    { columns: ["Cell Count"], polaris: false },
    { columns: ["Populated Cell Count"], polaris: true },
    { columns: ["Calculation Complexity"], polaris: true },
    { columns: ["Populated Cell Count", "Calculation Complexity"], polaris: true },
  ])("uses the full export's columns $columns even when the frame arrives late", async ({ columns, polaris }) => {
    at(`/a/modeling/customers/${WS}/workspaces/${WS}/models/${MODEL}`);
    const service = goldenApp();
    service.answer = path => path.endsWith("/pages") ? new Response("[]") : undefined;
    vi.stubGlobal("fetch", vi.fn(service.fetch));
    vi.stubGlobal("WebSocket", service.WebSocket);
    await import("./content.js");
    const frame = { asked: [] as { type: string; nonce?: string }[], postMessage(message: { type: string; nonce?: string }) { this.asked.push(message); } };
    const port = open();
    port.say({ type: "run" });
    await vi.advanceTimersByTimeAsync(110_000);
    expect(port.types()).not.toContain("done");
    expect(port.types()).not.toContain("error");
    expect(service.reads).toEqual([]);
    expect(service.sockets).toEqual([]);
    hear({ protocol: PROTOCOL, type: "core-ready", modelId: MODEL, build: BUILD, engineAfterLoad: true }, CORE, frame);
    await vi.advanceTimersByTimeAsync(1000);
    expect(frame.asked.map(message => message.type)).toEqual(["ack", "run"]);
    expect(port.received.filter(message => message.type === "log" && message.text.includes("Engine:"))).toEqual([]);
    const decision = `Engine: ${polaris ? "Polaris" : "Classic"} (from the Line Items columns)`;
    const sent = exportedModel();
    sent.tables.push({ file: "Line Items.csv", label: "Line Items", headers: ["Name", ...columns], rows: [], guard: false });
    hear({ ...RUN, type: "done", nonce: frame.asked[1].nonce, result: sent }, CORE, frame);
    await vi.advanceTimersByTimeAsync(1000);
    expect(port.received.at(-1)?.type).toBe("done");
    const result = assemble(port.received)!;
    expect(result.tables.find(table => table.file === "Versions.csv")?.rows).toEqual([["Actual", "true"]]);
    expect(result.engine).toBeUndefined();
    expect(result.summary.join("\n")).not.toContain("Classic client didn't answer");
    expect(service.reads.some(path => path.includes("llm-data-service"))).toBe(false);
    expect(port.received.filter(message => message.type === "log" && message.text.includes("Engine:"))).toHaveLength(1);
    expect(result.tables[0].rows.filter(row => row[0] === "Diagnostics" && String(row[2]).startsWith("Engine:"))).toEqual([["Diagnostics", "02:01:00", decision]]);
    const note = "Polaris model, read in full through Model Building.";
    expect(overviewOf(result).notes.filter(line => line === note)).toEqual(polaris ? [note] : []);
    expect(overviewOf(result).about).toEqual([...overviewOf(exportedModel()).about, ["Apps", "No app's pages use this model"]]);
    expect(service.reads.some(path => path.includes("springboard-platform-gateway-service"))).toBe(false);
    expect(port.received).toContainEqual({ type: "log", text: expect.stringContaining("Classic reader: answered; starting model settings") });
  });

  it("keeps the partial read after the full wait without a client, with an unknown engine and the existing Overview note", async () => {
    at(`/a/modeling/customers/${WS}/workspaces/${WS}/models/${MODEL}`);
    const service = goldenApp();
    service.answer = path => path.includes("springboard-platform-gateway-service")
      ? new Response(JSON.stringify({ label: "Practice plan", workspaceName: "Practice workspace", dataEngineType: "CALCULATION_ENGINE" }))
      : path.endsWith("/pages") ? new Response("[]") : undefined;
    vi.stubGlobal("fetch", vi.fn(service.fetch));
    vi.stubGlobal("WebSocket", service.WebSocket);
    await import("./content.js");
    const port = open();
    port.say({ type: "run" });
    await vi.advanceTimersByTimeAsync(119_000);
    expect(port.types()).not.toContain("done");
    expect(port.types()).not.toContain("error");
    expect(service.reads).toEqual([]);
    expect(service.sockets).toEqual([]);
    await vi.advanceTimersByTimeAsync(2000);
    expect(port.received.at(-1)?.type).toBe("done");
    const result = assemble(port.received)!;
    expect(result.engine).toBe("polaris");
    expect(result.tables.find(table => table.file === "Modules.csv")?.rows[0][0]).toBe("Demand");
    expect(result.tables.find(table => table.file === "General Lists.csv")?.rows).toHaveLength(2);
    const note = "The model's Classic client didn't answer, so Cardigan read what it could without it.";
    expect(result.summary[0]).toBe(note);
    expect(overviewOf(result).notes.filter(line => line === note)).toEqual([note]);
    expect(result.tables[0].rows).toContainEqual(["Notes", "Classic client", note]);
    // No saved view without the Classic client: neither table, and a note says why, once, of Saved Views; nothing is said of
    // the saved views' filters on the pages, which the export never read.
    const noViews = "Saved Views: not read: Cardigan reads saved views and their filters through Model Building's client, which didn't answer.";
    expect([result.tables.some(table => ["Saved Views.csv", "Saved View Filters.csv"].includes(table.file)), overviewOf(result).notes.filter(line => line === noViews),
      overviewOf(result).notes.filter(line => line.startsWith("Saved View Filters"))]).toEqual([false, [noViews], []]);
    expect(result.tables[0].rows).toContainEqual(["Diagnostics", "02:01:09", "Engine: unknown (no Classic client)"]);
    expect(result.tables[0].rows).toContainEqual(["Diagnostics", "02:01:09", "Classic reader: no frame answered within the wait; reading a partial result without it"]);
    expect(service.reads.filter(path => path.includes("springboard-platform-gateway-service"))).toEqual([
      `/a/springboard-platform-gateway-service/customers/${WS}/workspaces/${WS}/models/${MODEL}`,
    ]);
    expect(result.name).toBe("Practice plan");
    expect(overviewOf(result).about).toContainEqual(["Workspace", "Practice workspace"]);
    expect(overviewOf(result).notes).not.toContain("Polaris model, read in full through Model Building.");
    expect(port.types()).not.toContain("error");
    expect(posted).toEqual([]);
  });

  it("ignores engine claims from check-ins and uses only the exported Line Items columns", async () => {
    at(`/a/modeling/workspaces/${WS}/models/${MODEL}`);
    await import("./content.js");
    const frame = { asked: [] as { type: string; nonce?: string }[], postMessage(message: { type: string; nonce?: string }) { this.asked.push(message); } };
    hear({ protocol: PROTOCOL, type: "core-ready", modelId: MODEL, build: BUILD, dataEngineType: "HYPERBLOCK" }, CORE, frame);
    const port = open();
    port.say({ type: "run" });
    await vi.advanceTimersByTimeAsync(0);
    // Neither check-in supplies the engine decision.
    hear({ protocol: PROTOCOL, type: "core-ready", modelId: MODEL, build: BUILD, dataEngineType: "CALCULATION_ENGINE" }, CORE, frame);
    const sent = exportedModel();
    sent.tables.push({ file: "Line Items.csv", label: "Line Items", headers: ["", "Populated Cell Count", "Calculation Complexity"], rows: [["Units", "1", "1"]], guard: false });
    hear({ ...RUN, type: "done", nonce: frame.asked[1].nonce, result: sent }, CORE, frame);
    await vi.advanceTimersByTimeAsync(0);
    const result = assemble(port.received)!;
    expect(port.received.filter(message => message.type === "log" && message.text.includes("Engine cross-check:"))).toEqual([]);
    expect(result.tables[0].rows.filter(row => row[0] === "Diagnostics" && String(row[2]).startsWith("Engine:")))
      .toEqual([["Diagnostics", "01:59:09", "Engine: Polaris (from the Line Items columns)"]]);
    expect(overviewOf(result).notes).toContain("Polaris model, read in full through Model Building.");
    expect(result.engine).toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
    expect(WebSocket).not.toHaveBeenCalled();
  });

  /** A model's run whose export the frame hands over as `sent`: the result the results page is given. */
  const runWith = async (sent: AnalysisResult): Promise<AnalysisResult> => {
    at(`/a/modeling/workspaces/${WS}/models/${MODEL}`);
    await import("./content.js");
    const frame = { asked: [] as { type: string; nonce?: string }[], postMessage(message: { type: string; nonce?: string }) { this.asked.push(message); } };
    hear({ protocol: PROTOCOL, type: "core-ready", modelId: MODEL, build: BUILD }, CORE, frame);
    const port = open();
    port.say({ type: "run" });
    await vi.advanceTimersByTimeAsync(0);
    hear({ ...RUN, type: "done", nonce: frame.asked[1].nonce, result: sent }, CORE, frame);
    await vi.advanceTimersByTimeAsync(0);
    return assemble(port.received)!;
  };
  const engineSaid = (result: AnalysisResult) => result.tables[0].rows.filter(row => row[0] === "Diagnostics" && String(row[2]).startsWith("Engine:")).map(row => row[2]);
  const POLARIS_NOTE = "Polaris model, read in full through Model Building.";

  it.each([
    { columns: ["Formula", "Populated Cell Count"], engine: "Polaris" },
    { columns: ["Formula", "Calculation Complexity", "Module Name"], engine: "Polaris" },
    { columns: ["Formula", "Cell Count", "Module Name"], engine: "Classic" },
  ])("tells the engine from the Line Items grid's columns $columns where the export has no Line Items table", async ({ columns, engine }) => {
    // The export of a model that refused every page of Line Items after the first: no table, but the columns that page gave.
    const result = await runWith({ ...exportedModel(), lineItemColumns: columns });
    expect(engineSaid(result)).toEqual([`Engine: ${engine} (from the Line Items columns)`]);
    expect(overviewOf(result).notes.includes(POLARIS_NOTE)).toBe(engine === "Polaris");
    // The columns go no further: the results page holds none.
    expect(Object.hasOwn(result, "lineItemColumns")).toBe(false);
  });

  it.each([
    { modules: ["", "Cell Count", "Populated Cell Count", "Memory Used"], said: "Engine: Polaris (from the Modules columns)" },
    { modules: ["", "Cell Count", "Notes"], said: "Engine: Classic (from the Modules columns)" },
    { modules: undefined, said: "Engine: Classic (from the Line Items columns)" },
  ])("tells the engine from the Modules table's columns $modules where Line Items gave none", async ({ modules, said }) => {
    const sent = exportedModel();
    if (modules) sent.tables.push({ file: "Modules.csv", label: "Modules", headers: modules, rows: [["Demand", "1", "1", "1"].slice(0, modules.length)], guard: false });
    const result = await runWith(sent);
    expect([engineSaid(result), overviewOf(result).notes.includes(POLARIS_NOTE)]).toEqual([[said], said.includes("Polaris")]);
    // Line Items' columns, where its first page gave them, still say it.
    expect(engineSaid(await runWith({ ...sent, lineItemColumns: ["Formula", "Cell Count"] }))).toEqual(["Engine: Classic (from the Line Items columns)"]);
  });

  it("counts in Line Items the saved views whose filters use each line item, finds a filter's line item used, and takes the views' IDs off the result", async () => {
    const sent = exportedModel();
    sent.tables.push({ file: "Line Items.csv", label: "Line Items", headers: ["", "Formula", "Referenced By", "Module Name"],
      rows: [["Demand", "", "", ""], ["Units", "", "", "Demand"], ["Flag", "", "", "Demand"]], guard: false },
    { file: "Saved Views.csv", label: "Saved Views", headers: ["Name", "Module", "Filters", "Filter Line Items", "Used on Pages", "Used by Imports", "Used by Exports", "Definition read"],
      rows: [["Flagged", "Demand", "Rows: Flag = True", "Demand.Flag", "", "", "", "Yes"]], guard: false });
    const result = await runWith({ ...sent, savedViewIds: ["105000000001"], savedViewDetails: [{ name: "Flagged", module: "Demand", read: true, filters: [] }],
      savedViewFilters: [{ view: "Flagged", module: "Demand", axis: "Rows", lineItem: "Flag", lineItemModule: "Demand", active: true, valid: true }] });
    const lineItems = result.tables.find(table => table.file === "Line Items.csv")!;
    expect(lineItems.rows.map(row => [row[0], row[lineItems.headers.indexOf("Saved View Filters")]])).toEqual([["Demand", ""], ["Units", 0], ["Flag", 1]]);
    // Flag is used by the view's filter; Units by nothing.
    expect(result.tables.find(table => table.file === "Unused Line Items.csv")?.rows.map(row => row[0])).toEqual(["Units"]);
    expect([Object.hasOwn(result, "savedViewIds"), result.savedViewFilters?.length, result.savedViewDetails?.length]).toEqual([false, 1, 1]);
  });

  it("tells Polaris from a Line Items table read in part, and says under Unused Line Items that what the refused rows use may be listed", async () => {
    const sent = { ...exportedModel(), lineItemColumns: ["Formula", "Calculation Complexity", "Referenced By", "Module Name"], lineItemsRefused: 2 };
    sent.tables.push({ file: "Line Items.csv", label: "Line Items", headers: ["", "Formula", "Calculation Complexity", "Referenced By", "Module Name"],
      rows: [["Demand", "", "", "", ""], ["Units", "", "1", "Price", "Demand"], ["Price", "Units * 2", "1", "", "Demand"]], guard: false });
    const result = await runWith(sent);
    expect([engineSaid(result), overviewOf(result).notes.includes(POLARIS_NOTE)]).toEqual([["Engine: Polaris (from the Line Items columns)"], true]);
    expect(result.tables[0].rows.filter(row => row[0] === "Notes" && row[1] === "Unused Line Items").map(row => row[2]))
      .toContain("2 rows of Line Items could not be read, so line items used only by them may be listed, and so may their modules.");
    // The count, like the columns, goes no further.
    expect([Object.hasOwn(result, "lineItemColumns"), Object.hasOwn(result, "lineItemsRefused")]).toEqual([false, false]);
  });

  it.each(["HYPERBLOCK", "CALCULATION_ENGINE"])("does not try the partial reader after an answering client fails: %s", async dataEngineType => {
    at(`/a/modeling/workspaces/${WS}/models/${MODEL}`);
    await import("./content.js");
    const frame = { asked: [] as { type: string; nonce?: string }[], postMessage(message: { type: string; nonce?: string }) { this.asked.push(message); } };
    hear({ protocol: PROTOCOL, type: "core-ready", modelId: MODEL, build: BUILD, dataEngineType }, CORE, frame);
    const port = open();
    port.say({ type: "run" });
    await vi.advanceTimersByTimeAsync(0);
    hear({ ...RUN, type: "error", nonce: frame.asked[1].nonce, message: "The model rejected the read." }, CORE, frame);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(port.received.at(-1)).toMatchObject({ type: "error", message: "The model rejected the read." });
    expect(frame.asked.map(message => message.type)).toEqual(["ack", "run"]);
    expect(fetch).not.toHaveBeenCalled();
    expect(WebSocket).not.toHaveBeenCalled();
  });

  it("keeps the not-a-model-page failure without trying either reader", async () => {
    at("/a/home");
    await import("./content.js");
    const port = open();
    port.say({ type: "run" });
    await vi.advanceTimersByTimeAsync(120_000);
    expect(port.received.at(-1)).toMatchObject({ type: "error", code: "NOT_MODEL_PAGE" });
    expect(fetch).not.toHaveBeenCalled();
    expect(WebSocket).not.toHaveBeenCalled();
    expect(posted).toEqual([]);
  });

  it("does not start the partial reader when the results page closes during the frame wait", async () => {
    at(MODEL_BUILDING);
    await import("./content.js");
    const port = open();
    port.say({ type: "run" });
    await vi.advanceTimersByTimeAsync(60_000);
    port.close();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(fetch).not.toHaveBeenCalled();
    expect(WebSocket).not.toHaveBeenCalled();
  });

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
    expect(port.received.filter(message => message.type === "status")).toEqual(Array(3).fill({ type: "status", text: "Waiting for the model to open…" }));
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

    hear({ ...RUN, type: "status", nonce, text: "Reading Versions…" }, CORE, frame);
    // The frame's sign of life before each page of a grid is for this script alone: the results page is sent nothing for it.
    hear({ ...RUN, type: "alive", nonce }, CORE, frame);
    // The export comes with the IDs of its line items, for reading the pages built on the model: they go no further.
    hear({ ...RUN, type: "done", nonce, result: { ...exportedModel(), lineItemIds: [["102000000001", ""], ["1901000000001", "102000000001"]] } }, CORE, frame);
    await vi.advanceTimersByTimeAsync(0);
    // Then this window reads the pages built on the model, for the customer the address names. Anaplan answers that the
    // session has ended: the export is handed on all the same, and says why it has no tables of those pages. The tables of
    // what nothing uses are made all the same, and log their lines.
    expect(classicMessages(port).map(message => message.type)).toEqual(["log", "status", "log", "status", "log", "log", ...Array(UNUSED_LINES).fill("log"), "result", "rows", "rows",
      "done"]);
    expect(classicMessages(port).slice(0, 6)).toEqual([{ type: "log", text: `01:59:09 Cardigan dev: model ${MODEL} on us1a.app.anaplan.com` },
      { type: "status", text: "Reading Versions…" }, { type: "log", text: "01:59:09 Reading Versions…" },
      { type: "status", text: "Reading the pages built on this model…" }, { type: "log", text: "01:59:09 Reading the pages built on this model…" },
      { type: "log", text: "01:59:09 pages built on the model: SIGNED_OUT (HTTP 401)" }]);
    // The result says where the model is, as the address said it: the results page opens its modules, apps and pages there.
    expect(classicResult(port)).toEqual({ ...withoutPages("you're signed out of Anaplan", ["Reading the pages built on this model…", "pages built on the model: SIGNED_OUT (HTTP 401)"]),
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

  it("reads the pages built on the model beside the export where the address names the customer, the workspace and the model, and shows the export's status meanwhile", async () => {
    at(`/a/modeling/customers/${WS}/workspaces/${WS}/models/${MODEL}/modules`);
    await import("./content.js");
    const frame = { asked: [] as { type: string; nonce?: string }[], postMessage(message: { type: string; nonce?: string }) { this.asked.push(message); } };
    hear({ protocol: PROTOCOL, type: "core-ready", modelId: MODEL, build: BUILD }, CORE, frame);
    const port = open();
    port.take();
    port.say({ type: "run" });
    await vi.advanceTimersByTimeAsync(0);
    const { nonce } = frame.asked[1];
    hear({ ...RUN, type: "status", nonce, text: "Reading Versions…" }, CORE, frame);
    await vi.advanceTimersByTimeAsync(0);
    // The frame is still exporting, and the list of the pages built on the model has been asked for already.
    expect(vi.mocked(globalThis.fetch).mock.calls.map(([url]) => url)).toEqual([`${SHELL}/a/springboard-definition-service/customer/${WS}/model/${MODEL}/pages`]);
    // The export's status is the one shown: nothing of the pages is said until the export has come.
    expect(classicMessages(port).filter(message => message.type === "status")).toEqual([{ type: "status", text: "Reading Versions…" }]);
    hear({ ...RUN, type: "done", nonce, result: { ...exportedModel(), lineItemIds: [["102000000001", ""]] } }, CORE, frame);
    await vi.advanceTimersByTimeAsync(0);
    // Then what the pages' reading said, as a run that read them after the export says it: Anaplan answered that the
    // session has ended, and the export is handed on all the same.
    expect(classicMessages(port).map(message => message.type)).toEqual(["log", "status", "log", "status", "log", "log", ...Array(UNUSED_LINES).fill("log"), "result", "rows", "rows",
      "done"]);
    expect(classicResult(port)).toEqual({ ...withoutPages("you're signed out of Anaplan", ["Reading the pages built on this model…", "pages built on the model: SIGNED_OUT (HTTP 401)"]),
      site: { origin: SHELL, customer: WS } });
    expect(vi.mocked(globalThis.fetch).mock.calls).toHaveLength(1);
  });

  it("gives up the pages it was reading beside an export that fails", async () => {
    at(`/a/modeling/customers/${WS}/workspaces/${WS}/models/${MODEL}/modules`);
    await import("./content.js");
    // The list of the pages answers only when the test says.
    let answer: (response: Response) => void = () => undefined;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(resolve => { answer = resolve; })));
    const frame = { asked: [] as { type: string; nonce?: string }[], postMessage(message: { type: string; nonce?: string }) { this.asked.push(message); } };
    hear({ protocol: PROTOCOL, type: "core-ready", modelId: MODEL, build: BUILD }, CORE, frame);
    const port = open();
    port.take();
    port.say({ type: "run" });
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledTimes(1);
    hear({ ...RUN, type: "error", nonce: frame.asked[1].nonce, message: "The Line Items grid did not load." }, CORE, frame);
    await vi.advanceTimersByTimeAsync(0);
    expect(port.received.filter(message => message.type === "error")).toEqual([expect.objectContaining({ type: "error" })]);
    // The list comes after the export failed: no page is asked for, and no socket opened.
    answer(new Response(JSON.stringify({ items: [{ guid: "00000000-0000-4000-8000-000000001000", name: "Demand board" }] }), { status: 200, headers: { "content-type": "application/json" } }));
    await vi.advanceTimersByTimeAsync(1000);
    expect([vi.mocked(globalThis.fetch).mock.calls.length, vi.mocked(globalThis.WebSocket).mock.calls]).toEqual([1, []]);
  });

  it("asks the reader of this build where a frame holds two, and refuses one of another build after a few seconds, saying whether the results page can reach its frame", async () => {
    at(MODEL_BUILDING);
    await import("./content.js");
    const frame = { asked: [] as { type: string; protocol?: string; build?: string }[], postMessage(message: { type: string }) { this.asked.push(message); } };
    // The reader Chrome put into the frame as the page loaded is of an earlier build; this build's checks in beside it, as
    // after the results page put it there, and each says so again when greeted: this build's is held.
    hear({ protocol: PROTOCOL, type: "core-ready", modelId: MODEL, build: "0a1b2c3d4e5f" }, CORE, frame);
    hear({ protocol: PROTOCOL, type: "core-ready", modelId: MODEL, build: BUILD }, CORE, frame);
    hear({ protocol: PROTOCOL, type: "core-ready", modelId: MODEL, build: "0a1b2c3d4e5f" }, CORE, frame);
    const port = open();
    port.take();
    port.say({ type: "run" });
    await vi.advanceTimersByTimeAsync(0);
    expect(frame.asked.filter(message => message.type === "run")).toEqual([{ ...RUN, type: "run", nonce: expect.any(String) }]);
    port.close();

    // A page whose frame holds only a reader of another build: on another Anaplan host than the page, then on its own.
    for (const [origin, renewable] of [[CORE, false], [SHELL, true]] as const) {
      vi.resetModules();
      listeners.length = 0;
      await import("./content.js");
      hear({ protocol: PROTOCOL, type: "core-ready", modelId: MODEL, build: "0a1b2c3d4e5f" }, origin, frame);
      const asking = open();
      asking.take();
      asking.say({ type: "run" });
      await vi.advanceTimersByTimeAsync(3999);
      expect(asking.types().filter(type => type === "error")).toEqual([]);
      await vi.advanceTimersByTimeAsync(1);
      expect(asking.received.filter(message => message.type === "error")).toEqual([{ type: "error", message: expect.stringContaining("still holds the earlier Cardigan's model reader"),
        code: "OLD_READER", renewable }]);
    }
    expect(frame.asked.filter(message => message.type === "run")).toHaveLength(1);
  });

  it("waits two minutes while Model Building has no Classic frame, on ordinary and refreshed runs", async () => {
    at(MODEL_BUILDING);
    await import("./content.js");
    hear({ protocol: PROTOCOL, type: "probe", probe: { host: "us1a.app.anaplan.com", path: "/a/modeling/", top: true } }, SHELL, page);
    const errors = (port: FakePort) => port.received.filter(message => message.type === "error").length;
    const port = open();
    port.take();
    port.say({ type: "run" });
    await vi.advanceTimersByTimeAsync(119_000);
    expect(errors(port)).toBe(0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(errors(port)).toBe(0);
    expect(port.received).toContainEqual({ type: "log", text: expect.stringContaining("Classic reader: no frame answered within the wait; reading a partial result without it") });
    port.close();
    const refreshed = open();
    refreshed.take();
    refreshed.say({ type: "run", afterRefresh: true });
    await vi.advanceTimersByTimeAsync(110_000);
    expect(errors(refreshed)).toBe(0);
    // The model shows: its frame checks in, and is asked.
    const frame = { asked: [] as { type: string }[], postMessage(message: { type: string }) { this.asked.push(message); } };
    hear({ protocol: PROTOCOL, type: "core-ready", modelId: MODEL, build: BUILD }, CORE, frame);
    await vi.advanceTimersByTimeAsync(1000);
    expect(frame.asked.map(message => message.type)).toEqual(["ack", "run"]);
    refreshed.close();
  });

  it("says in a model's export that this version made it, whichever version the model's reader is of", async () => {
    at(`/a/modeling/workspaces/${WS}/models/${MODEL}`);
    await import("./content.js");
    const frame = { asked: [] as { type: string; nonce?: string }[], postMessage(message: { type: string; nonce?: string }) { this.asked.push(message); } };
    hear({ protocol: PROTOCOL, type: "core-ready", modelId: MODEL, build: BUILD }, CORE, frame);
    const port = open();
    port.take();
    port.say({ type: "run" });
    await vi.advanceTimersByTimeAsync(0);
    // A reader of the same code as this build's, kept in the tab through an update that changed only the version.
    const result = exportedModel();
    result.tables[0].rows.push(["Export", "Exported with", "Cardigan 0.12.0"], ["Diagnostics", "01:59:09", `Cardigan 0.12.0: model ${MODEL} on eu2a.app.anaplan.com`],
      ["Diagnostics", "01:59:09", "Cardigan 0.12.0 was here"]);
    hear({ ...RUN, type: "done", nonce: frame.asked[1].nonce, result }, CORE, frame);
    await vi.advanceTimersByTimeAsync(0);
    const rows = assemble(port.received).tables[0].rows;
    expect(rows.filter(row => row[0] === "Export" || (row[0] === "Diagnostics" && String(row[2]).startsWith("Cardigan")))).toEqual([["Export", "Exported with", "Cardigan dev"],
      ["Diagnostics", "01:59:09", `Cardigan dev: model ${MODEL} on eu2a.app.anaplan.com`], ["Diagnostics", "01:59:09", "Cardigan 0.12.0 was here"]]);
  });

  it("opens a module inside the Model Building page through the model's frame when the results page asks, and says what came of it", async () => {
    at(MODEL_BUILDING);
    await import("./content.js");
    const frame = { asked: [] as { type: string; nonce?: string; model?: string; module?: string }[], postMessage(message: { type: string }) { this.asked.push(message); } };
    hear({ protocol: PROTOCOL, type: "core-ready", modelId: MODEL, build: BUILD }, CORE, frame);
    const port = open();
    port.take();
    const opened = () => port.take().filter(message => message.type === "opened");
    port.say({ type: "open", nonce: "ask-1", model: MODEL, object: "102000000001" });
    await vi.advanceTimersByTimeAsync(0);
    // The frame is asked, by the model's ID and the module's, and its answer goes back to the page for that very ask.
    const ask = frame.asked.find(message => message.type === "open")!;
    expect(ask).toEqual({ ...RUN, type: "open", nonce: expect.any(String), model: MODEL, object: "102000000001" });
    hear({ ...RUN, type: "opened", nonce: ask.nonce, opened: true }, CORE, frame);
    await vi.advanceTimersByTimeAsync(0);
    expect(opened()).toEqual([{ type: "opened", nonce: "ask-1", opened: true, detail: "Model Building opened it beside the tabs open there" }]);
    // A frame that says it could not, and one that says nothing in time.
    port.say({ type: "open", nonce: "ask-2", model: MODEL.toLowerCase(), object: "102000000002" });
    await vi.advanceTimersByTimeAsync(0);
    hear({ ...RUN, type: "opened", nonce: frame.asked.at(-1)!.nonce, opened: false }, CORE, frame);
    port.say({ type: "open", nonce: "ask-3", model: MODEL, object: "102000000003" });
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
      port.say({ type: "open", nonce, model: MODEL, object: "102000000001" });
      await vi.advanceTimersByTimeAsync(400);
      return port.take().filter(message => message.type === "opened").map(message => [(message as { detail: string }).detail, (message as { oldReader?: boolean }).oldReader === true]);
    };
    expect(await ask("another-model")).toEqual([["the tab shows another model", false]]);
    at(MODEL_BUILDING);
    expect(await ask("another-build")).toEqual([["the model's frame holds a reader of another build", true]]);
    at(`/a/springboard/apps/app/${APP}/page/board/${APP}`);
    expect(await ask("an-app")).toEqual([["the tab does not show Model Building", false]]);
    expect(frame.asked.map(message => message.type)).toEqual(["ack"]);
  });

  it("greets the frames when no model's frame has checked in, and opens nothing where none does", async () => {
    at(MODEL_BUILDING);
    const inner = { greeted: [] as unknown[], frames: [], postMessage(message: unknown) { this.greeted.push(message); } };
    page.frames = [inner];
    await import("./content.js");
    const port = open();
    port.take();
    port.say({ type: "open", nonce: "ask-1", model: MODEL, object: "102000000001" });
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
    for (const listener of [...heard]) listener({ data: { ...RUN, type: "open", nonce: "ask", model: MODEL, object: "102000000409" }, origin: SHELL, source: top });
    await vi.advanceTimersByTimeAsync(0);
    expect([published, top.posted.filter(message => (message as { type: string }).type === "opened")])
      .toEqual([[["anaplan/views", 102000000409]], [{ ...RUN, type: "opened", nonce: "ask", opened: true }]]);
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
    hear({ ...RUN, type: "done", nonce: frame.asked[1].nonce, result: { ...exportedModel(), lineItemIds: [["102000000001", ""]] } }, CORE, frame);
    await vi.advanceTimersByTimeAsync(0);
    // The IDs of the export's line items are not handed on, here either.
    expect(classicResult(port)).toEqual(withoutPages(NO_CUSTOMER));
    // The tables of what nothing uses are there, empty, since nothing could be checked, and a note says why.
    const read = classicResult(port)!;
    expect([read.tables.slice(-2).map(table => [table.label, table.rows.length]), read.tables[0].rows.filter(row => row[0] === "Notes"), read.lineItemIds])
      .toEqual([[["Unused Line Items", 0], ["Unused Modules", 0]], [["Notes", "Unused Line Items", "Line Items was not read, so no line item or module could be checked."]], undefined]);
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

  it.each(["HYPERBLOCK", "CALCULATION_ENGINE", undefined, "throw"])("checks in without reading the engine or loading the client: %s", async raw => {
    at("/core-webapp/anaplan/framework.jsp", "eu2a.app.anaplan.com");
    const top = { postMessage: vi.fn() };
    const getWorkspaceInfo = vi.fn(() => { if (raw === "throw") throw new Error("Not ready"); return { dataEngineType: raw }; });
    const require = vi.fn((id: string) => { expect(id).toBe("anaplan/data/ModelContentCache"); return { getWorkspaceInfo }; });
    Object.assign(page, { top, require, modelId: MODEL, workspaceId: WS });
    await import("./model-content.js");
    vi.advanceTimersByTime(1000);
    expect(top.postMessage).toHaveBeenCalledWith({ protocol: PROTOCOL, type: "core-ready", modelId: MODEL, build: BUILD }, "*");
    expect(require).not.toHaveBeenCalled();
    expect(getWorkspaceInfo).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(WebSocket).not.toHaveBeenCalled();
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
    // A diagnostic greeting listener and the reader that serves this window.
    expect(listeners).toHaveLength(2);
  });

  it.each(["throws", "poisons"])("completes a run without a workspace cache getter that %s the client state", async failure => {
    at("/core-webapp/anaplan/framework.jsp", "eu2a.app.anaplan.com");
    let broken = false;
    const crash = () => new TypeError("Cannot read properties of undefined (reading 'modelSummaries')");
    const getWorkspaceInfo = vi.fn(() => {
      broken = true;
      if (failure === "throws") throw crash();
      return {};
    });
    const cache = { getWorkspaceInfo, getModelName: () => { if (broken) throw crash(); return "Practice plan"; } };
    const answer = { rowCount: 1, columnCount: 1, rowLabelPages: [{ start: 0, count: 1, entityLongIds: [[107000000001]], labels: [["Actual"]] }],
      columnLabelPages: [{ start: 0, count: 1, entityLongIds: [[4000000301]], labels: [["Is Actual"]] }], dataPages: [{}] };
    const post = vi.fn((_request: unknown, _flag: boolean, ok: (response: unknown) => boolean) => {
      if (broken) throw crash();
      queueMicrotask(() => ok({ result: { viewRequestResults: [answer] } }));
    });
    const helper = { getAxesForViewDefinition: () => ({}) };
    const constants = { SYSTEM_AXIS_IDENTIFIER_VERSION_ALL_IDENTIFIER: "VERSIONS", SYSTEM_AXIS_IDENTIFIER_VERSION_PROPERTY_IDENTIFIER: "VERSION PROPERTIES" };
    class RequestGenerator { getRequest() { return { requestType: "VIEW_REQUEST_SET", submissions: [], systemActions: [] }; } }
    class DataPage { contains() { return true; } getIndex() { return 0; } getCellText() { return "true"; } getOriginalText() { return "true"; } }
    const require = vi.fn((_modules: string[], loaded: (...modules: unknown[]) => void) => {
      queueMicrotask(() => loaded(cache, { post }, helper, {}, constants, RequestGenerator, DataPage, {}));
    });
    Object.assign(page, { require, modelId: MODEL, workspaceId: WS, workspaceName: "Practice workspace",
      postMessage: (message: unknown) => { posted.push(message); queueMicrotask(() => hear(message, CORE, page)); } });
    await import("./content.js");
    await import("./model-content.js");
    await vi.advanceTimersByTimeAsync(1000);
    expect(require).not.toHaveBeenCalled();
    const port = open();
    port.say({ type: "run" });
    await vi.advanceTimersByTimeAsync(0);
    expect(port.received.at(-1)?.type).toBe("done");
    const result = assemble(port.received)!;
    expect(result.tables.find(table => table.file === "Versions.csv")?.rows).toEqual([["Actual", "true"]]);
    expect(overviewOf(result).about).toContainEqual(["Workspace", "Practice workspace"]);
    expect(getWorkspaceInfo).not.toHaveBeenCalled();
    expect(broken).toBe(false);
    expect(require).toHaveBeenCalledOnce();
    expect(post).toHaveBeenCalledOnce();
    expect(port.received.filter(message => message.type === "log" && message.text.includes("Loading the model page's client…"))).toHaveLength(1);
    expect(port.received.filter(message => message.type === "log" && message.text.includes("Engine:")))
      .toEqual([{ type: "log", text: expect.stringContaining("Engine: Classic (from the Line Items columns)") }]);
    expect(fetch).not.toHaveBeenCalled();
    expect(WebSocket).not.toHaveBeenCalled();
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
    hear({ ...RUN, type: "run", nonce: "own" }, CORE, page);
    await vi.advanceTimersByTimeAsync(0);
    // As 0.6.1 began the file's log on such a page, in the words the results page's log begins with now.
    expect(diagnostics(posted)!.slice(0, 2)).toEqual([["01:59:10", `Cardigan dev: model ${MODEL} on eu2a.app.anaplan.com`], ["01:59:10", "Loading the model page's client…"]]);
    // The line is not sent to the page as well: the content script writes the same one into the log it shows.
    expect(posted.filter(message => (message as { type: string }).type === "log").map(message => (message as { text: string }).text)).not.toContainEqual(expect.stringContaining("Cardigan"));
    // A page that no longer names its model gets no line that would name none.
    delete page.modelId;
    hear({ ...RUN, type: "run", nonce: "own again" }, CORE, page);
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
    for (const listener of [...heard]) listener({ data: { ...RUN, type: "run", nonce: "frame" }, origin: SHELL, source: top });
    await vi.advanceTimersByTimeAsync(0);
    expect(diagnostics(top.posted)![0]).toEqual(["01:59:11", "Loading the model page's client…"]);
  });

  it("stays inert on a page without a classic model, and stops looking after ten minutes", async () => {
    at("/a/home");
    await import("./model-content.js");
    vi.advanceTimersByTime(11 * 60_000);
    expect(vi.getTimerCount()).toBe(0);
    expect(listeners).toHaveLength(1); // diagnostics still answer greetings
    expect(posted.every(message => (message as { type: string }).type === "probe")).toBe(true);
    const before = posted.length;
    hear({ protocol: PROTOCOL, type: "hello" }, "https://elsewhere.example", page);
    expect(posted).toHaveLength(before);
    hear({ protocol: PROTOCOL, type: "hello" }, SHELL, page);
    expect(posted).toHaveLength(before + 1);
    expect([vi.mocked(globalThis.fetch).mock.calls, vi.mocked(globalThis.WebSocket).mock.calls]).toEqual([[], []]);
  });
});
