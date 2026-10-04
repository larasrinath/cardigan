import { analyseApp } from "../analyse.js";
import { exportInCore, reportFrame, serveCore, watchCore, watchProbes, type CoreHandle, type Endpoint, type FrameProbe, type MessageTarget } from "../bridge.js";
import { CALENDAR_PROPERTIES } from "../model/calendar.js";
import { exportModel } from "../model/export.js";
import type { CellSource } from "../model/grid.js";
import { modelOnPage } from "../model/native.js";
import type { Subject } from "../protocol.js";
import { RestError } from "../rest.js";
import type { AnalysisResult } from "../result-types.js";
import { decodeFrames, type StompFrame } from "../stomp.js";
import { serveTab, type Seen } from "../tab-port.js";
import { later, type FakeTab } from "./port-pair.test-support.js";

/** The engine in an Anaplan tab, for tests that run the results page against it: the content script's real side of the port
 * (tab-port.ts) around the real analysis of an app and the real export of a model, which is made in the model's frame and
 * comes back over the real bridge (bridge.ts), and scripted stand-ins for what those two read: Anaplan's services for an
 * app, and the classic client of a model page. Tests only.
 *
 * The app and the model are the ones the 0.6.1 zips in golden-0.6.1.test-support.ts were made from. Their fixtures stand
 * inside analyse.test.ts and model/model.test.ts, which cannot be imported, so they are written out again here; the tests
 * that use them compare what comes out with those same zips, file by file, so the two copies cannot drift apart unseen. */

/* ---------- the extension's scripts in the tab ---------- */

/** One run of the engine: what it was asked to read, each step and log line the content script reported until the run
 * ended, in order, and how it ended. `late` is what it still reported after that, as a socket does when it says later that
 * it has closed. `result` is the result where it was made: the analysis's own for an app, and for a model the export's own
 * in the model's frame, before the bridge passed it on to the content script. */
export interface EngineRun { subject: Seen; said: string[]; late: string[]; result?: AnalysisResult; error?: unknown; ended: boolean }

/** A window of the tab, as far as the bridge uses one. It passes messages as a browser's windows do: what one window posts
 * to another as it holds it arrives there as a structured clone, in a later turn and in the order posted, from the sender's
 * origin and with the sender as the receiver holds it; a message addressed to another origin than the receiver's is dropped. */
class FakeWindow implements MessageTarget {
  /** The windows inside this one (bridge.ts `greetFrames`), which only a page still waiting for its model's frame asks. */
  readonly frames: Endpoint[] = [];
  private readonly listeners = new Set<(event: MessageEvent) => void>();
  private readonly held = new Map<FakeWindow, Endpoint>();
  constructor(readonly origin: string) {}
  addEventListener(_type: "message", listener: (event: MessageEvent) => void): void { this.listeners.add(listener); }
  removeEventListener(_type: "message", listener: (event: MessageEvent) => void): void { this.listeners.delete(listener); }
  /** This window as `other` holds it. */
  seenBy(other: FakeWindow): Endpoint {
    let handle = this.held.get(other);
    if (!handle) {
      handle = { postMessage: (message: unknown, targetOrigin: string): void => {
        if (targetOrigin !== "*" && targetOrigin !== this.origin) return;
        const event = { data: structuredClone(message), origin: other.origin, source: other.seenBy(this) } as unknown as MessageEvent;
        later(() => { for (const listener of [...this.listeners]) listener(event); });
      } };
      this.held.set(other, handle);
    }
    return handle;
  }
}

/** An interval that does not come round in a test, with an end at once: what the bridge would repeat for a while is said once. */
const ONCE = [2 ** 30, 0] as const;

/** Puts the extension's scripts into a tab, wired as content.ts and model-content.ts wire them. The content script of the
 * page the user sees answers the results page: an app it analyses itself, and a session that has ended is told by the
 * read's own code. A model is exported in its core frame, another window inside the page: the content script asks that
 * frame, and the export's steps, its log and its result come back as window messages (bridge.ts). `core` is that frame's
 * host, for a tab whose page holds a model, as a Model Building page does; the frame's script then reports what the frame
 * holds and serves the real export there. Returns the runs, as they are started. */
export function serveEngine(tab: FakeTab, page: { host: string; shows: Subject; core?: string }): EngineRun[] {
  const runs: EngineRun[] = [];
  /** The run an export in the model's frame belongs to: the content script has one run at a time. */
  let exporting: EngineRun | undefined;
  // content.ts, in the page the user sees: it remembers the model's frame when that announces itself, and what each frame reports.
  const shell = new FakeWindow(`https://${page.host}`);
  let frame: CoreHandle | undefined;
  const probes = new Map<string, FrameProbe>();
  watchCore(shell, found => { frame = found; });
  watchProbes(shell, probe => { probes.set(`${probe.host}${probe.path}`, probe); });
  if (page.core !== undefined) {
    // model-content.ts, in the model's frame: the frame reports what it holds, and exports when the page around it asks.
    const core = new FakeWindow(`https://${page.core}`);
    const top = shell.seenBy(core);
    reportFrame(top, ...ONCE);
    serveCore(core, top, modelOnPage, async (progress, diagnostics, stop) => {
      const made = await exportModel(progress, diagnostics, stop);
      if (exporting) exporting.result = made;
      return made;
    }, ...ONCE);
  }
  serveTab(tab.runtime, {
    host: page.host,
    subject: () => page.shows,
    run: async (subject, progress, diagnostics, signal) => {
      const run: EngineRun = { subject, said: [], late: [], ended: false };
      runs.push(run);
      const note = (text: string) => { (run.ended ? run.late : run.said).push(text); };
      const heard = { status: (text: string) => { note(text); progress.status(text); }, log: (line: string) => { note(line); progress.log(line); } };
      try {
        if (subject.kind === "app") return (run.result = await analyseApp(subject.id, heard, diagnostics, signal));
        exporting = run;
        return await exportInCore(shell as unknown as Window, () => frame, () => probes.values(), subject.id, heard, signal);
      } catch (error) {
        run.error = error;
        throw error;
      } finally {
        run.ended = true;
      }
    },
    signedOut: error => error instanceof RestError && error.code === "SIGNED_OUT",
  });
  return runs;
}

/** A read that waits until the test lets it go on, so that a test can act in the middle of a run. */
export interface Hold { /** How many reads are waiting. */ readonly waiting: number; release(): void }

function holding(): { hold(matches: (read: string) => boolean): Hold; wait(read: string): Promise<void>; releaseAll(): void } {
  const holds: { matches: (read: string) => boolean; waiting: number; open: boolean; waiters: (() => void)[] }[] = [];
  return {
    hold(matches) {
      const held = { matches, waiting: 0, open: false, waiters: [] as (() => void)[] };
      holds.push(held);
      return { get waiting() { return held.waiting; }, release: () => { held.open = true; for (const go of held.waiters.splice(0)) go(); } };
    },
    async wait(read) {
      for (const held of holds) {
        if (held.open || !held.matches(read)) continue;
        held.waiting++;
        await new Promise<void>(go => { held.waiters.push(go); });
      }
    },
    releaseAll() { for (const held of holds) { held.open = true; for (const go of held.waiters.splice(0)) go(); } },
  };
}

/* ---------- an app: Anaplan's services ---------- */

// Synthetic IDs only, as in analyse.test.ts.
export const WS = "0123456789abcdef0123456789abcdef";
export const MODEL = "FEDCBA9876543210FEDCBA9876543210";
/** The host the app's page is on, which also serves its model. */
export const APP_HOST = "first.app.anaplan.com";
const MODULE = "102000000901";
const [LIST, LIST_2] = ["101000000901", "101000000902"];
const [NORTH, SOUTH, LINE_ITEM, FILTER_ITEM] = ["201000000001", "201000000002", "1901000000001", "1903000000001"];
const candidate = (n: number) => String(102000001000 + n);
const at = (path: string) => `core://${WS}:${MODEL}${path}`;
const MODULE_VIEWS = `core:/${WS}:${MODEL}/moduleViews`;
const CONNECTED = "CONNECTED\nversion:1.2\nserver:test\n\n\0";
const update = (id: string, body: unknown) => `MESSAGE\nsubscription:${id}\nmessage-type:update\nsubscription-revision:00000001\n\n${JSON.stringify(body)}\0`;

// One app: a published board with an action card, a custom view (a row filter, two hidden items and a formatting rule) and
// a text card whose text looks like a formula, and a page that was never published.
export const GOLDEN_APP = "01234567-89ab-cdef-0123-456789abcdef";
const guid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
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

/** What the model data socket answers for that app's model, by destination. */
const SOCKET_ANSWERS: Record<string, (id: string) => string> = {
  [at("")]: id => update(id, { status: "READY" }),
  [MODULE_VIEWS]: id => update(id, { data: [{ id: Number(MODULE), name: "Demand", views: [] }], dimensions: { "20000000003": { label: "Time" } } }),
  [at("/lists")]: id => update(id, { data: [{ id: LIST, name: "Product" }, { id: LIST_2, name: "Territory" }] }),
  [at(`/modules/${MODULE}/lineItems`)]: id => update(id, { data: [{ lineItemId: LINE_ITEM, lineItemLabel: "Volume" }] }),
  [at("/dimensions")]: id => update(id, { modules: { [MODULE]: { dimensions: [{ id: LIST, label: "Product" }, { id: LIST_2, label: "Territory" }, { id: "20000000003", label: "Time" }] } } }),
  [at(`/modules/${MODULE}/dimensions/${LIST}`)]: id => update(id, { data: [{ itemId: NORTH, label: "North" }, { itemId: SOUTH, label: "South" }] }),
  [at("/applicableModules")]: id => update(id, { data: [{ id: Number(MODULE), label: "Demand" }, { id: Number(candidate(2)), label: "Filter flags" }] }),
  [at(`/modules/${candidate(2)}/lineItems`)]: id => update(id, { data: [{ lineItemId: FILTER_ITEM, lineItemLabel: "Include?" }] }),
};

type SocketListener = (event: { data?: unknown; code?: number; reason?: string }) => void;
/** A socket to the model data service, as far as a test looks at it. */
export interface ScriptedSocket { readonly url: string; readonly frames: StompFrame[]; readyState: number }

/** Anaplan as that app's page reads it: the definition service and the actions service (fetch) and the model data socket
 * (WebSocket), answering as they did when the 0.6.1 zip was made. A test puts `fetch`, `WebSocket`, `location` and
 * `document` in the globals' place. */
export function goldenApp() {
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  const app = { name: "Planning: app", categories: [{ guid: guid(1001), name: "Demand" }], pages: [
    { guid: guid(1000), name: "Demand board", pageType: "BOARD", categoryGuid: guid(1001), hasPublishedVersion: true },
    { guid: guid(2000), name: "Draft page", pageType: "BOARD", categoryGuid: guid(1001), hasPublishedVersion: false }] };
  const holds = holding();
  const sockets: ScriptedSocket[] = [];
  const service = {
    /** The path of every REST read, in order. */
    reads: [] as string[],
    /** Every socket opened to the model data service. */
    sockets,
    /** The app's name, which a test can change between two runs. */
    name: app.name,
    /** Another answer than the app's own for a read, by its path; nothing for the app's own. */
    answer: (_path: string): Response | undefined => undefined,
    /** Makes the reads whose path matches wait until the test releases them. */
    hold: (matches: (path: string) => boolean): Hold => holds.hold(matches),
    releaseAll: (): void => holds.releaseAll(),
    location: { host: APP_HOST, origin: `https://${APP_HOST}` },
    document: { cookie: "other=1; XSRF-TOKEN=xsrf-value" },
    fetch: async (url: string): Promise<Response> => {
      const path = new URL(url).pathname;
      service.reads.push(path);
      await holds.wait(path);
      const other = service.answer(path);
      if (other) return other;
      if (path.endsWith(`/apps/${GOLDEN_APP}`)) return json({ ...app, name: service.name });
      if (path.endsWith(`/boards/${guid(1000)}`)) return json(goldenBoard);
      if (path.endsWith("/imports")) return json({ imports: [{ id: "112000000901", name: "Import demand" }] });
      if (path.endsWith("/processes")) return json({ processes: [{ id: "118000000999", name: "Another process" }] });
      return new Response("{}", { status: 404 });
    },
    /** Each SEND is answered by its destination, or with no data; a socket says it has closed in a later turn. */
    WebSocket: class {
      static readonly OPEN = 1;
      readyState = 0;
      binaryType = "blob";
      readonly frames: StompFrame[] = [];
      readonly listeners = new Map<string, SocketListener[]>();
      constructor(readonly url: string) {
        sockets.push(this);
        setTimeout(() => { this.readyState = 1; this.emit("open", {}); }, 0);
      }
      addEventListener(type: string, listener: SocketListener): void { this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]); }
      send(data: string): void {
        for (const frame of decodeFrames(data).frames) {
          this.frames.push(frame);
          setTimeout(() => {
            if (frame.command === "CONNECT") this.serve(CONNECTED);
            else if (frame.command === "SEND") this.serve(SOCKET_ANSWERS[frame.headers.destination]?.(frame.headers.id) ?? update(frame.headers.id, { data: [] }));
          }, 0);
        }
      }
      close(code = 1000, reason = ""): void {
        if (this.readyState === 3) return;
        this.readyState = 3;
        setTimeout(() => this.emit("close", { code, reason }), 0);
      }
      emit(type: string, event: { data?: unknown; code?: number; reason?: string }): void { for (const listener of this.listeners.get(type) ?? []) listener(event); }
      serve(frame: string): void { if (this.readyState === 1) this.emit("message", { data: frame }); }
    },
  };
  return service;
}

/* ---------- a model: the classic client of its page ---------- */

/** The host of the Model Building page the user sees, and the host of the model's frame inside it, which is where the
 * model's classic client runs, often at another data centre. */
export const SHELL_HOST = "us1a.app.anaplan.com";
export const MODEL_HOST = "eu2a.app.anaplan.com";

/** A stand-in for the client's `_DataPage`: a rectangle of cells starting at (startRow, 0). */
class FakeDataPage implements CellSource {
  constructor(private readonly page: { startRow: number; rows: string[][] }) {}
  contains(row: number, column: number): boolean { return row >= this.page.startRow && row < this.page.startRow + this.page.rows.length && column < (this.page.rows[0]?.length ?? 0); }
  getIndex(row: number, column: number): number { return (row - this.page.startRow) * 1000 + column; }
  getCellText(index: number): string | null { const text = this.page.rows[Math.floor(index / 1000)][index % 1000]; return text === "(null)" ? null : text; }
  getOriginalText(index: number): string { return this.getCellText(index) ?? "raw"; }
}

// One model: every Model settings grid the export reads, with the values a CSV has to quote (commas, quotes, line breaks)
// and text that looks like a formula, an import the Imports tab does not list, and one grid the page's client does not have
// (Source Models).
export interface FakeGrid { columns: string[]; rows: { ids: number[]; labels: (string | null)[]; cells: string[] }[] }
const row = (id: number, label: string, ...cells: string[]) => ({ ids: [id], labels: [label], cells });
const ACTION_COLUMNS = ["Action", "Start Date and Time (UTC)", "Most recent duration (ms)", "Notes", "Used in Processes", "Used in Dashboards"];
const GOLDEN_RATIO = JSON.stringify({ summaryMethod: "RATIO", timeSummaryMethod: "RATIO", ratioNumeratorIdentifier: "_1901000000001_", ratioDenominatorIdentifier: "_1901000000002_" });
export const GOLDEN_GRIDS: Record<string, FakeGrid> = {
  "LINE ITEMS × LINE ITEM PROPERTIES": { columns: ["Formula", "Summary", "Notes"], rows: [
    { ids: [102000000001, -1], labels: ["Profitability", null], cells: ["", "", ""] },
    { ids: [1901000000001, 102000000001], labels: ["Profit", "Profitability"], cells: ["=Revenue - Cost", '{"summaryMethod":"SUM"}', "First line\nSecond line"] },
    { ids: [1901000000002, 102000000001], labels: ["Revenue", "Profitability"], cells: ["IF Units > 0 THEN Units * Price ELSE 0", '{"summaryMethod":"SUM"}', 'Says "gross", before tax'] },
    { ids: [1901000000003, 102000000001], labels: ["Margin %", "Profitability"], cells: ["Profit / Revenue", GOLDEN_RATIO, "-1+1"] }] },
  "MODULES × MODULE PROPERTIES": { columns: ["Applies To", "Cell Count"], rows: [row(102000000001, "Profitability", "Products, Time", "2252068"), row(102000000002, "-- MODEL ADMIN", "-", "12")] },
  "LISTS × LIST PROPERTIES": { columns: ["Top Level Item", "Production Data"], rows: [row(101000000001, "Products", "All Products", "true"), row(101000000002, "+ Regions", "", "false")] },
  "ACTIONS × ACTION PROPERTIES": { columns: ACTION_COLUMNS, rows: [
    row(31000000001, "Processes", "", "", "", "", "", ""),
    row(118000000001, "Nightly load", "", "2026-03-12 23:19:56", "582", "Runs at 2am", "", "Admin"),
    row(31000000002, "Imports", "", "", "", "", "", ""),
    row(112000000002, "Prices from prices.csv", "Import into Prices", "2026-03-12 23:19:56", "582", "", "Nightly load", ""),
    row(112000000001, "1.1 Load regions", "Import into Regions", "", "", "From the hub", "Nightly load, Weekly load", ""),
    row(112000000003, "Old import", "Import into Old", "", "", "", "", ""),
    row(31000000003, "Exports", "", "", "", "", "", ""),
    row(116000000001, "Send plan", '{"exportType":"GRID_CURRENT_PAGE"}', "", "", "", "", "Review"),
    row(31000000004, "Other Actions", "", "", "", "", "", ""),
    row(117000000001, "Delete old items", '{"actionType":"DELETE_BY_SELECTION"}', "", "", "", "Nightly load", "")] },
  "IMPORTS × IMPORT PROPERTIES": { columns: ["Source Label", "Source Object", "Source Type", "Target Object", "Target Type", "Production Data"], rows: [
    row(112000000001, "1.1 Load regions", "Hub / Regions", "Hub / 'LIST - Regions'.Export", "SAVED VIEW", "Regions", "LIST", "false"),
    row(112000000002, "Prices from prices.csv", "prices.csv", "-", "FILE", "Prices", "MODULE", "false")] },
  "DATA SOURCES × DATA SOURCE PROPERTIES": { columns: ["Type", "Used in Imports"], rows: [row(113000000001, "prices.csv", "FILE", "Prices from prices.csv")] },
  "TIME RANGES × TIME RANGE PROPERTIES": { columns: ["Start Period", "End Period"], rows: [row(123000000001, "FY24-FY25", "FY24", "FY25")] },
  "VERSIONS × VERSION PROPERTIES": { columns: ["Is Actual", "Switchover"], rows: [row(107000000001, "Actual", "true", ""), row(107000000002, "Forecast", "false", "@Current Period")] },
  "CALENDAR × EMPTY": { columns: [""], rows: [row(CALENDAR_PROPERTIES["Calendar Type"], "Calendar Type", "Weeks: 4-4-5, 4-5-4 or 5-4-4"),
    row(CALENDAR_PROPERTIES["End of Fiscal Year is"], "End of Fiscal Year is", "Last in Month"), row(CALENDAR_PROPERTIES["End of Fiscal Year - day"], "Day", "7"),
    row(CALENDAR_PROPERTIES["End of Fiscal Year - month"], "Month", "12"), row(CALENDAR_PROPERTIES["Fiscal Year Label"], "Fiscal Year Label", "FY"),
    row(CALENDAR_PROPERTIES.Timescale, "Timescale", "false"), row(CALENDAR_PROPERTIES["Fiscal Year Label is aligned with"], "Aligned with", "false"),
    row(CALENDAR_PROPERTIES["Current Fiscal Year"], "Current Fiscal Year", "FY24"), row(CALENDAR_PROPERTIES["Number of Past Years"], "Past Years", "1"),
    row(CALENDAR_PROPERTIES["Include Quarter Totals"], "Quarter Totals", "true")] },
};
const GOLDEN_AXES: Record<string, string> = { MODULE_WITH_LINE_ITEM: "LINE ITEMS", LINE_ITEM_PROPERTY: "LINE ITEM PROPERTIES", MODULE_ALL: "MODULES", HIERARCHY: "LISTS",
  ACTION_WITH_HEADING: "ACTIONS", IMPORT_ALL: "IMPORTS", IMPORT_DEFINITION_PROPERTY: "IMPORT PROPERTIES", IMPORT_DATA_SOURCE: "DATA SOURCES",
  IMPORT_DATA_SOURCE_DETAILS_PROPERTY: "DATA SOURCE PROPERTIES", TIME_RANGE: "TIME RANGES", TIME_RANGE_PROPERTY: "TIME RANGE PROPERTIES", VERSION_ALL: "VERSIONS",
  VERSION_PROPERTY: "VERSION PROPERTIES", TIMESCALE_PROPERTY: "CALENDAR", EMPTY_1_0: "EMPTY" };

/** The grid the Line Items file is read from, by its two axes. */
export const LINE_ITEMS = "LINE ITEMS × LINE ITEM PROPERTIES";

/** A model's frame whose classic client serves those grids, or the ones a test gives it, a window of rows at a time. A test
 * puts `window` and `location` in the globals' place: they are that frame's, where the export runs. */
export function modelPage(grids: Record<string, FakeGrid> = GOLDEN_GRIDS) {
  const holds = holding();
  const page = {
    /** Every read of a grid, in order: its row axis and the rows asked for, as "LINE ITEMS 0+1". */
    reads: [] as string[],
    /** Makes the reads that match wait until the test releases them. */
    hold: (matches: (read: string) => boolean): Hold => holds.hold(matches),
    releaseAll: (): void => holds.releaseAll(),
    location: { host: MODEL_HOST, pathname: "/core-webapp/anaplan/framework.jsp" },
    window: undefined as unknown,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const aggregator = { isDirty: () => false, post: (request: any, _flag: boolean, ok: (response: unknown) => boolean) => {
    const { viewDefinition, pageRequests: [{ startRow, rowCount }] } = request.params;
    const read = `${viewDefinition.rowAxis} ${startRow}+${rowCount}`;
    page.reads.push(read);
    const grid = grids[`${viewDefinition.rowAxis} × ${viewDefinition.columnAxis}`];
    const slice = grid.rows.slice(startRow, startRow + rowCount);
    const dimensions = Math.max(...grid.rows.map(entry => entry.ids.length));
    void holds.wait(read).then(() => ok({ result: { viewRequestResults: [{ rowCount: grid.rows.length, columnCount: grid.columns.length,
      rowLabelPages: [{ start: startRow, count: slice.length, entityLongIds: Array.from({ length: dimensions }, (_, d) => slice.map(entry => entry.ids[d] ?? -1)),
        labels: Array.from({ length: dimensions }, (_, d) => slice.map(entry => entry.labels[d] ?? null)) }],
      columnLabelPages: [{ start: 0, count: grid.columns.length, entityLongIds: [grid.columns.map((_, index) => 4000000001 + index)], labels: [grid.columns] }],
      dataPages: [{ startRow, rows: slice.map(entry => entry.cells) }] }] } }));
    return true;
  } };
  const cache = { getModelName: () => "Demand: plan", getWorkspaceInfo: () => ({ name: "Workspace one" }), getAllCurrenciesLabelPage: () => undefined,
    getActionInfo: (id: number) => (Math.floor(id / 1e9) === 31 ? null : { id }), getTimescaleInfo: () => ({ calendarTypeEntityIndex: 3 }),
    getApplicationPropertyEnabledOrNotSet: () => true };
  const helper = { getAxesForViewDefinition: (rowAxes: string[], columnAxes: string[]) => ({ rowAxis: rowAxes[0], columnAxis: columnAxes[0] }) };
  const constants = { ...Object.fromEntries(Object.entries(GOLDEN_AXES).map(([name, value]) => [`SYSTEM_AXIS_IDENTIFIER_${name}_IDENTIFIER`, value])),
    CALENDAR_TYPE_WEEKS_GENERAL_ENTITY_INDEX: 1, CALENDAR_TYPE_THIRTEEN_FOUR_WEEK_PERIODS_ENTITY_INDEX: 2, FEATURE_FLAGS: { TIME_SUMMARY: "timeSummary" } };
  const axisHelper = { getModuleSystemAxisIdentifier: () => "MODULE PROPERTIES", getHierarchySystemAxisIdentifier: () => "LIST PROPERTIES",
    getActionSystemAxisIdentifier: () => "ACTION PROPERTIES" };
  class RequestGenerator { getRequest(params: unknown) { return { requestType: "VIEW_REQUEST_SET", submissions: [], systemActions: [], params }; } }
  class DataPage extends FakeDataPage { constructor({ page: data }: { page: { startRow: number; rows: string[][] } }) { super(data); } }
  page.window = { workspaceId: WS, modelId: MODEL,
    require: (_modules: string[], loaded: (...modules: unknown[]) => void) =>
      loaded(cache, aggregator, helper, { getEntityTypeIndex: (id: number) => Math.floor(id / 1e9) }, constants, RequestGenerator, DataPage, axisHelper) };
  return page;
}
