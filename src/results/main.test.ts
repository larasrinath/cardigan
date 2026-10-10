import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelMapOptions } from "../map/graph-types.js";
import { PAGE_ACTIONS_HEADERS, PAGE_FILTERS_HEADERS } from "../model-pages.js";
import { MODULE_USAGE_FILE, MODULE_USAGE_HEADERS, PAGE_ACTIONS_FILE, PAGE_FILTERS_FILE } from "../page-files.js";
import { CALENDAR_HEADERS, CALENDAR_PROPERTIES, calendarRows } from "../model/calendar.js";
import { FRESH_MS, PORT_NAME, RESULTS_PAGE, type TabMessage } from "../protocol.js";
import type { AnalysisResult, Cell, ImportMapping, ProcessActions, ResultTable } from "../result-types.js";
import { columnWidths } from "./column-widths.js";
import { columnsOf } from "./columns.js";
import { OPEN_WAIT_MS } from "./connection.js";
import { FakeElement, FakeInput, FakePage, FakeSelect, parseMarkup } from "./dom.test-support.js";
import { analysedLine, NOT_KEPT_NOTE, TOO_LARGE_NOTE } from "./keep-notes.js";
import { KEPT_PREFIX, ResultKeeper, type KeptStorage } from "./keep-result.js";
import { FILE_ICONS, FORGOTTEN_LINE, keptCopyHtml, MAP_FAILED, NAV_ICONS, NOT_REMOVED_LINE } from "./markup.js";
import { fileWords, watchForFiles, type FileWatch } from "./no-file.test-support.js";
import { PROCESS_LINES } from "./process-actions-view.js";
import { NONE } from "./table-engine.js";

/** What stands in for the model map (src/map). The page calls its two functions and drives what the second returns; how
 * a graph is built and a map drawn is not the page's, and is tested with them. Each test is given its own stand-ins. */
const mapStandIn = vi.hoisted(() => ({
  build: (_tables: unknown): unknown => { throw new Error("No test has set up the model map's stand-in."); },
  mount: (_host: unknown, _graph: unknown, _options: unknown): unknown => { throw new Error("No test has set up the model map's stand-in."); },
}));
vi.mock("../map/build-graph.js", () => ({ buildModelGraph: (tables: unknown) => mapStandIn.build(tables) }));
vi.mock("../map/map-view.js", () => ({ mountModelMap: (host: unknown, graph: unknown, options: unknown) => mapStandIn.mount(host, graph, options) }));

/** The page as it is packaged: the script runs on results.html itself, read by the stand-in page. */
const SHELL = readFileSync(new URL(`../../${RESULTS_PAGE}`, import.meta.url), "utf8");
/** The clock's own timer, taken before any test puts a faked one in its place. */
const realTimeout = setTimeout;

/** The port chrome.tabs.connect gives the page, with the tab's content script at the other end. */
class FakePort {
  readonly posted: unknown[] = [];
  private readonly messageListeners: ((message: unknown) => void)[] = [];
  private readonly disconnectListeners: (() => void)[] = [];
  readonly onMessage = { addListener: (listener: (message: unknown) => void) => { this.messageListeners.push(listener); } };
  readonly onDisconnect = { addListener: (listener: () => void) => { this.disconnectListeners.push(listener); } };
  postMessage(message: unknown) { this.posted.push(structuredClone(message)); }
  disconnect() { /* the page let go */ }
  send(message: TabMessage) { for (const listener of this.messageListeners) listener(structuredClone(message)); }
  drop() { for (const listener of this.disconnectListeners) listener(); }
}

const NOW = new Date(Date.UTC(2026, 9, 3, 14, 2, 5));
const RESULT: AnalysisResult = {
  kind: "app", name: "Demo <img src=x onerror=alert(1)> app", id: "01234567-89ab-cdef-0123-456789abcdef", zipName: "Demo app - App Export - 2026-10-03.zip",
  summary: ["1 of 1 pages analysed, 2 cards."],
  tables: [
    { file: "App Details.csv", label: "App Details", headers: ["Section", "Detail", "Value"], guard: true, details: true,
      rows: [["Export", "Anaplan host", "us1a.app.anaplan.com"], ["Notes", "Archive", "Not published"], ["Diagnostics", "14:02:05", "app: 1 page"]] },
    { file: "Pages.csv", label: "Pages", headers: ["Page", "Total cards"], rows: [["Overview", 2]], guard: true },
    { file: "Cards.csv", label: "Cards", headers: ["Page", "Card #", "Card title", "Card type", "Card ID"], rows: [["Overview", 1, "Sales", "Grid", "card-a"], ["Overview", 2, "=Margin", "KPI", "card-b"]], guard: true },
  ],
};

/** What an Anaplan user can type into a name: a tag with a handler, which would be one on the page if it were written as markup. */
const TAG = '<img src="x" onerror="alert(1)">';
/** The same app, with that tag in the Cards table's name, in a card's title and in a page's name. */
const NAMED: AnalysisResult = {
  ...RESULT, tables: [RESULT.tables[0], { ...RESULT.tables[1], rows: [["Overview", 2], [`Stores ${TAG}`, 0]] }, { ...RESULT.tables[2], label: `Cards ${TAG}`,
    rows: [["Overview", 1, `Sales ${TAG}`, "Grid", "card-a"], ["Overview", 2, "=Margin", "KPI", "card-b"]] }],
};

/** An app as the analysis names and lays out its files, with fewer columns: two pages, the second a copy of the first that
 * kept its cards' IDs, the files that list a card's parts, and one whose Page column is not its first. */
const APP: AnalysisResult = {
  kind: "app", name: "Demo app", id: "01234567-89ab-cdef-0123-456789abcdef", zipName: "Demo app - App Export - 2026-10-03.zip", summary: ["2 of 2 pages analysed, 4 cards."],
  tables: [
    { file: "App Details.csv", label: "App Details", headers: ["Section", "Detail", "Value"], guard: true, details: true,
      rows: [["App", "App", "Demo app"], ["Export", "Anaplan host", "us1a.app.anaplan.com"], ["Diagnostics", "14:02:05", "Cardigan dev: app 01234567 on us1a.app.anaplan.com"],
        ["Diagnostics", "14:02:06", "app: 2 pages"], ["Diagnostics", "", "a line without a time"]] },
    { file: "Pages.csv", label: "Pages", headers: ["App", "Page", "Total cards", "Page ID"], guard: true,
      rows: [["Demo app", "Overview", 2, "page-1"], ["Demo app", "Overview (copy)", 2, "page-2"]] },
    { file: "Cards.csv", label: "Cards", headers: ["Page", "Card #", "Card title", "Card type", "Card ID"], guard: true,
      rows: [["Overview", 1, "Sales", "Grid", "card-a"], ["Overview", 2, "Margin", "KPI", "card-b"],
        ["Overview (copy)", 1, "Sales, copied", "Grid", "card-a"], ["Overview (copy)", 2, "Margin, copied", "KPI", "card-b"]] },
    { file: "Grid Sections.csv", label: "Grid Sections", headers: ["Page", "Card #", "Section #", "Section layout", "Source module", "Card ID"], guard: true,
      rows: [["Overview", 1, 1, "Own rows and columns", "REP01 Sales", "card-a"], ["Overview (copy)", 1, 1, "Own rows and columns", "REP09 Copy", "card-a"],
        ["Overview", 3, 1, "Own rows and columns", "REP02 Gone", "card-gone"]] },
    { file: "Where Used.csv", label: "Where Used", headers: ["Object type", "Object name", "Object's module", "Page", "Card #", "Used as", "Object ID"], guard: true,
      rows: [["Module", "REP01 Sales", "-", "Overview", 1, "Source module", "102000000001"], ["Module", "REP09 Copy", "-", "Overview (copy)", 1, "Source module", "102000000009"]] },
  ],
};

/** A model's export: a Line Items file long enough for three pages, as Anaplan lays it out, with its first column unnamed. */
const LINES: Cell[][] = Array.from({ length: 120 }, (_, index) =>
  [`Line item ${index + 1}`, ["Number", "Text", "Boolean"][index % 3], `Source ${index + 1} * 2`, index < 60 ? "Revenue" : "Cost"]);
const MODEL: AnalysisResult = {
  kind: "model", name: "Model one", id: "0123456789ABCDEF0123456789ABCDEF", zipName: "Model one - Model Export - 2026-10-03.zip",
  summary: ["Line Items: 120 rows", "Modules: 2 rows"],
  tables: [
    { file: "Model Details.csv", label: "Model Details", headers: ["Section", "Detail", "Value"], guard: true, details: true,
      rows: [["Model", "Model", "Model one"], ["Export", "Anaplan host", "us1a.app.anaplan.com"], ["Diagnostics", "09:30:00", "Line Items: 120 rows"]] },
    { file: "Line Items.csv", label: "Line Items", headers: ["", "Format", "Formula", "Module"], rows: LINES, guard: false },
    { file: "Modules.csv", label: "Modules", headers: ["", "Functional Area"], rows: [["Revenue", "Sales"], ["Cost", "Finance"]], guard: false },
  ],
};

/** The same model with its Model Calendar file as the export writes it: the assessment template's rows, the first five of
 * them about the model. Its calendar is one of months, five of whose twenty-six settings hold a value. */
const WITH_CALENDAR: AnalysisResult = {
  ...MODEL, summary: [...MODEL.summary, "Model Calendar: 31 rows"],
  tables: [...MODEL.tables, { file: "Model Calendar.csv", label: "Model Calendar", headers: [...CALENDAR_HEADERS], guard: false,
    rows: calendarRows({ workspace: "Main", model: "Model one", capturedOn: "2026-10-03", values: new Map([[CALENDAR_PROPERTIES["Calendar Type"], "Calendar Months/Quarters/Years"],
      [CALENDAR_PROPERTIES["Fiscal Year Starts"], "1"], [CALENDAR_PROPERTIES["Number of Past Years"], "1"], [CALENDAR_PROPERTIES["Number of Future Years"], "2"],
      [CALENDAR_PROPERTIES["Include Quarter Totals"], "true"]]) }) }],
};
/** The line under the Model Calendar table of that model. */
const CALENDAR_NOTE = "5 rows about the model are not listed here: 3 hold a value, which the Overview has under About this export. "
  + "21 settings have no value and are not listed: they do not apply to this calendar type, or the model does not show them.";

/** A model whose Line Items file is laid out as the export writes it, with some of the grid's columns: each module's own
 * row, then its line items, which name their module under Module Name and show a dash under Applies To where they take
 * the module's. Format and Summary hold a definition, as Anaplan's own export of the grid does. One module has no line
 * items. */
const NUMBER = '{"dataType":"NUMBER"}';
const PERCENT = '{"minimumSignificantDigits":-1,"decimalPlaces":2,"unitsType":"PERCENTAGE","dataType":"NUMBER"}';
const SUM = '{"summaryMethod":"SUM","timeSummaryMethod":"SUM"}';
const NO_SUMMARY = '{"summaryMethod":"NONE","timeSummaryMethod":"NONE"}';
const CLOSING = '{"summaryMethod":"SUM","timeSummaryMethod":"CLOSING_BALANCE","timeSummarySameAsMainSummary":false}';
const RATIO = '{"summaryMethod":"RATIO","timeSummaryMethod":"RATIO","ratioNumeratorIdentifier":"_1901000000003_","ratioDenominatorIdentifier":"_1901000000002_"}';
const BLUEPRINT: AnalysisResult = {
  ...MODEL, summary: ["Line Items: 8 rows", "Modules: 3 rows"],
  tables: [MODEL.tables[0],
    { file: "Line Items.csv", label: "Line Items", guard: false, headers: ["", "Format", "Formula", "Summary", "Applies To", "Module Name", "Ratio Numerator", "Ratio Denominator"], rows: [
      ["REV01 Revenue", "", "", "", "Products, Time", "", "", ""],
      ["Units", NUMBER, "", SUM, "-", "REV01 Revenue", "", ""],
      ["Price", NUMBER, "", NO_SUMMARY, "Products", "REV01 Revenue", "", ""],
      ["Revenue", NUMBER, "Units * Price", SUM, "-", "REV01 Revenue", "", ""],
      ["Margin %", PERCENT, "Margin / Revenue", RATIO, "-", "REV01 Revenue", "Margin", "Revenue"],
      ["--- Archive ---", "", "", "", "", "", "", ""],
      ["COST01 Costs", "", "", "", "Cost Centres", "", "", ""],
      ["Cost", NUMBER, "", CLOSING, "-", "COST01 Costs", "", ""]] },
    { file: "Modules.csv", label: "Modules", headers: ["", "Applies To"], rows: [["REV01 Revenue", "Products, Time"], ["--- Archive ---", ""], ["COST01 Costs", "Cost Centres"]], guard: false }],
};

/** The same model with a Dynamic Cell Access file laid out as the export writes one (model/access.ts), in its place after
 * Line Items: one row for each use of a driver, the driver first. The last row is one whose driver the
 * export matched to no line item: it has no Driver Module, and the driver as a cell of Line Items writes it. One name
 * looks like a formula. The rows are written by hand: the page reads the file as it stands, and nothing of it out of the
 * Line Items file above, which has no driver columns. */
const WITH_ACCESS: AnalysisResult = {
  ...BLUEPRINT, summary: ["Line Items: 8 rows", "Dynamic Cell Access: 5 rows (1 with a driver that could not be matched)", "Modules: 3 rows"],
  tables: [BLUEPRINT.tables[0], BLUEPRINT.tables[1],
    { file: "Dynamic Cell Access.csv", label: "Dynamic Cell Access", guard: false, headers: ["Driver Module", "Driver Line Item", "Access", "Controlled Module", "Controlled Line Item"], rows: [
      ["ACC01 Access", "Can read", "Read", "REV01 Revenue", "Units"],
      ["ACC01 Access", "Can read", "Read", "REV01 Revenue", "Price"],
      ["ACC01 Access", "Can read", "Read", "COST01 Costs", "Cost"],
      ["ACC01 Access", "=Can write", "Write", "REV01 Revenue", "Units"],
      ["", "'Old access'.Flag", "Write", "COST01 Costs", "Cost"]] },
    BLUEPRINT.tables[2]],
};

// The page under test, and what stands in for the browser around it. A test loads the page with `open`.
let page: FakePage;
/** The watch for a page that makes a file, starts a download or goes somewhere to save one (no-file.test-support.ts):
 * it is on from before each test to after it, whatever the test does with the page. */
let watch: FileWatch;
let ports: FakePort[];
let connects: unknown[][];
/** What the script put on the clipboard, and whether the clipboard refuses. */
let copied: string[];
let clipboardRefuses: boolean;
/** What the page keeps between visits, whether the system prefers a dark theme, and who asked to hear when that changes. */
let stored: Map<string, string>;
let systemDark: boolean;
let systemListeners: ((event: { matches: boolean }) => void)[];
/** Each query the page asked of the window's media, in order. */
let mediaAsked: string[];
/** What the browser's store answers with, in the place of reading and of keeping, where a browser refuses both. */
let storeRefuses: Error | undefined;
let lastError: { message?: string } | undefined;
/** Whether the Anaplan tab the page was opened for has been closed, as chrome.tabs.get finds. */
let tabClosed: boolean;
/** What a test's model itself names as a file, which the page shows as it was read (no-file.test-support.ts
 * `fileWords`): an import's Source Type, FILE, and the name of the file it reads. None but in a test that sets it: no word
 * of the page's own names a file in any test. */
let theirs: RegExp | undefined;
/** What the page asked of chrome.tabs.update, chrome.tabs.create and chrome.windows.update, in order. A tab the page
 * opens is numbered from 101, and the browser says which tab opened it. While `tabsRefuse` holds, the browser refuses to
 * take any tab anywhere or to open one. `closedTabs` are tabs the page opened that the user has closed since. */
let tabUpdates: unknown[][];
let tabCreates: unknown[][];
let windowUpdates: unknown[][];
let tabsRefuse: boolean;
let closedTabs: Set<number>;
/** What the page asked Chrome to put into a tab, in order, whether Chrome lets it, and each tab it asked Chrome to refresh. */
let injected: unknown[];
let scriptingAllows: boolean;
let tabReloads: number[];
/** The tab the results page itself is in, as chrome.tabs.getCurrent says it, after the Anaplan tab it was opened for. */
const OWN_TAB = { id: 50, index: 2, windowId: 3 };
/** The page's address, each address the script changed it to, and whether changing it is refused. */
let location: { search: string; pathname: string; hash: string };
let replaced: string[];
let fixedAddress: boolean;
/** The tab's session storage, which a refresh of the page leaves as it is: what it holds, and the name of the error it
 * refuses every write with, if it refuses. Each test has its own, so that a result one test's page is still keeping when
 * the test ends cannot turn up in the next. */
let session: { held: Map<string, string>; refuses: string; writes: number; storage: KeptStorage };
/** What the page asked of the model map's stand-in, in order: "build", then for each map by its number, counted from the
 * first one mounted, "mount 1", "show 1", "hide 1", "themeChanged 1 dark" (with the page's theme at that moment) and
 * "destroy 1". */
let mapAsked: string[];
/** The tables each graph was built from, with the graph given for them. */
let mapBuilds: { tables: unknown; graph: object }[];
/** Each map that was mounted: what the page handed over, what the map found in its host and in the view at that moment,
 * the button the map put into its host, which can take the focus, and the map's way of telling the page that it has
 * stopped by itself, and why, as its contract has it (graph-types.ts `onFailure`). */
let mapMounts: { host: FakeElement; graph: unknown; options: unknown; found: unknown[]; button: FakeElement; stops(reason: string): void }[];
/** What the stand-in throws when it is asked for one of these, in the place of doing it: nothing unless a test sets it. */
let mapThrows: Partial<Record<"build" | "mount" | "show" | "hide" | "themeChanged" | "destroy" | "reveal", unknown>>;
/** The nodes of the graph the stand-in builds: none unless a test gives them. */
let mapNodes: object[];
/** Whether the stand-in takes the focus into itself, to its button, each time it is shown. */
let mapTakesFocus: boolean;
/** What the stand-in tells the page of its stop while it is asked for one of these, or while it hears a click or a key
 * inside it: the reason it gives. Nothing unless a test sets it. */
let mapTells: Partial<Record<"mount" | "show" | "hide" | "themeChanged" | "destroy" | "click" | "keydown", string>>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  watch = watchForFiles();
  mapAsked = [];
  mapBuilds = [];
  mapMounts = [];
  mapThrows = {};
  mapNodes = [];
  mapTakesFocus = false;
  mapTells = {};
  const asked = (what: keyof typeof mapThrows, said: string) => {
    mapAsked.push(said);
    if (what in mapThrows) throw mapThrows[what];
  };
  mapStandIn.build = tables => {
    asked("build", "build");
    const graph = { nodes: mapNodes, edges: [], unresolved: [], sections: [], limitations: [] };
    mapBuilds.push({ tables, graph });
    return graph;
  };
  mapStandIn.mount = (given, graph, options) => {
    const host = given as FakeElement;
    const number = mapMounts.length + 1;
    const found = [host.hidden, host.childNodes.length, page.id("view").textContent];
    // The map's own elements, inside its host and nowhere else. They are there before a mount that fails gives up.
    const root = page.document.createElement("div");
    const button = page.document.createElement("button");
    root.append(button);
    host.append(root);
    const stops = (reason: string): void => (options as ModelMapOptions).onFailure?.(reason);
    const tells = (when: keyof typeof mapTells): void => {
      const reason = mapTells[when];
      if (reason !== undefined) stops(reason);
    };
    // What the map hears inside it, as its own listeners hear it before the page does.
    for (const type of ["click", "keydown"] as const) root.addEventListener(type, () => tells(type));
    mapAsked.push(`mount ${number}`);
    tells("mount");
    if ("mount" in mapThrows) throw mapThrows.mount;
    mapMounts.push({ host, graph, options, found, button, stops });
    return {
      // A map that is told to draw while its host is not shown has no size to draw at.
      show: () => {
        asked("show", `show ${number}${host.hidden ? " in a hidden host" : ""}`);
        if (mapTakesFocus) button.focus();
        tells("show");
      },
      hide: () => { asked("hide", `hide ${number}`); tells("hide"); },
      themeChanged: () => { asked("themeChanged", `themeChanged ${number} ${page.document.documentElement.dataset.theme}`); tells("themeChanged"); },
      destroy: () => { asked("destroy", `destroy ${number}`); root.remove(); tells("destroy"); },
      reveal: (node: number) => { asked("reveal", `reveal ${number} ${node}`); return true; },
    };
  };
  ports = [];
  connects = [];
  tabClosed = false;
  theirs = undefined;
  tabUpdates = [];
  tabCreates = [];
  windowUpdates = [];
  tabsRefuse = false;
  closedTabs = new Set();
  injected = [];
  scriptingAllows = false;
  tabReloads = [];
  copied = [];
  clipboardRefuses = false;
  stored = new Map();
  systemDark = false;
  systemListeners = [];
  mediaAsked = [];
  storeRefuses = undefined;
  lastError = undefined;
  replaced = [];
  fixedAddress = false;
  vi.stubGlobal("history", { state: null, replaceState: (_state: unknown, _unused: string, address: string) => {
    if (fixedAddress) throw new Error("The address cannot be changed.");
    replaced.push(address);
    const [path, hash = ""] = address.split(/(?=#)/);
    location.search = path.includes("?") ? path.slice(path.indexOf("?")) : "";
    location.hash = hash;
  } });
  vi.stubGlobal("window", {
    // What the page asks of the window's media is whether the system's theme is dark. Each query is noted: a test can say
    // that the page asks nothing else, such as how wide the window is.
    matchMedia: (query: string) => {
      mediaAsked.push(query);
      return { get matches() { return systemDark; }, addEventListener: (_type: string, listener: (event: { matches: boolean }) => void) => { systemListeners.push(listener); } };
    },
    scrollTo: () => undefined, innerWidth: 1280, innerHeight: 800,
  });
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => { if (storeRefuses) throw storeRefuses; return stored.get(key) ?? null; },
    setItem: (key: string, value: string) => { if (storeRefuses) throw storeRefuses; stored.set(key, value); },
  });
  const own = session = { held: new Map<string, string>(), refuses: "", writes: 0, storage: {
    get length() { return own.held.size; },
    key: (index: number) => [...own.held.keys()][index] ?? null,
    getItem: (key: string) => own.held.get(key) ?? null,
    setItem: (key: string, value: string) => {
      own.writes++;
      if (own.refuses) throw Object.assign(new Error(`The storage refused to hold ${key}.`), { name: own.refuses });
      own.held.set(key, value);
    },
    removeItem: (key: string) => { own.held.delete(key); },
  } };
  vi.stubGlobal("sessionStorage", own.storage);
  // The kinds of element the script tells apart.
  vi.stubGlobal("Element", FakeElement);
  vi.stubGlobal("HTMLElement", FakeElement);
  vi.stubGlobal("HTMLInputElement", FakeInput);
  vi.stubGlobal("HTMLSelectElement", FakeSelect);
  vi.stubGlobal("requestAnimationFrame", (callback: () => void) => { callback(); return 0; });
  vi.stubGlobal("chrome", {
    tabs: {
      connect: (...args: unknown[]) => { connects.push(args); const port = new FakePort(); ports.push(port); return port; },
      get: async (id: number) => {
        if ((tabClosed && id <= 100) || closedTabs.has(id)) throw new Error(`No tab with id: ${id}.`);
        const opener = id > 100 ? (tabCreates[id - 101]?.[0] as { openerTabId?: number } | undefined)?.openerTabId : undefined;
        return { id, index: 0, status: "complete", ...(opener === undefined ? {} : { openerTabId: opener }) };
      },
      getCurrent: async () => OWN_TAB,
      // `tabClosed` closes the tab the page was opened for, and none it opened itself; `closedTabs`, those it opened.
      update: async (id: number, properties: unknown) => {
        tabUpdates.push([id, properties]);
        if (tabsRefuse || (tabClosed && id <= 100) || closedTabs.has(id)) throw new Error(`No tab with id: ${id}.`);
        return { id, index: 0, windowId: 3 };
      },
      create: async (properties: unknown) => {
        if (tabsRefuse) throw new Error("Tabs cannot be edited right now.");
        tabCreates.push([properties]);
        return { id: 100 + tabCreates.length, index: 1, windowId: 3 };
      },
      reload: async (id: number) => { tabReloads.push(id); },
    },
    // As in a tab the icon was not just clicked on: Chrome lets nothing be put into it.
    scripting: { executeScript: async (injection: unknown) => {
      injected.push(injection);
      if (scriptingAllows) return [{ frameId: 0 }, { frameId: 5 }];
      throw new Error("Cannot access contents of the page. Extension manifest must request permission to access the respective host.");
    } },
    windows: { update: async (id: number, info: unknown) => { windowUpdates.push([id, info]); } },
    runtime: { get lastError() { return lastError; } },
  });
  vi.stubGlobal("navigator", { clipboard: { writeText: async (text: string) => {
    if (clipboardRefuses) throw new Error("Write permission denied.");
    copied.push(text);
  } } });
});
afterEach(async () => {
  // A page that was left asking a tab again takes its next step now, while this test's clock and Chrome stand in: its
  // next try then waits on this clock, which goes with the test, and opens no port in the next one.
  for (let turn = 0; turn < 50; turn++) await Promise.resolve();
  // Whatever the test did with the page, the page made no file of anything, started no download, and went nowhere to
  // save one: no blob, no address for one, and no element or address of the page's that is a file.
  const made = watch.stop(page);
  // And nothing the page had for its user, from the markup it was made of to the last thing written to it, names a
  // file, a CSV or a zip, or a download: with a result and without one, in a view, a row's details, a popover, a
  // banner or a message, as text or as what an element is named or described by (dom.test-support.ts `words`).
  const named = page ? fileWords(page.words(), theirs) : [];
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  expect([made, named]).toEqual([[], []]);
});

/** Loads the page at an address, its query and the mark after a "#" where it has one: a new page each time, as opening or
 * reloading it gives. A page that finds no result kept for it has said so to itself by the time this returns. */
const open = async (address: string, shell = SHELL) => {
  vi.resetModules();
  page = new FakePage(shell);
  const [search, hash = ""] = address.split(/(?=#)/);
  location = watch.location({ search, pathname: "/results.html", hash });
  vi.stubGlobal("document", page.document);
  vi.stubGlobal("location", location);
  await import("./main.js");
  for (let turn = 0; turn < 5; turn++) await Promise.resolve();
};
/** Waits for something the page started off its own thread, such as compressing a result, in real turns of the event loop:
 * the faked timers neither hold that up nor bring it about. */
const eventually = async (holds: () => boolean, what: string) => {
  for (let turn = 0; turn < 3000 && !holds(); turn++) await new Promise(resolve => realTimeout(resolve, 1));
  if (!holds()) throw new Error(`Waited in vain for ${what}.`);
};
/** Lets that many real milliseconds pass, for what must not happen by itself. */
const pass = (milliseconds: number) => new Promise(resolve => realTimeout(resolve, milliseconds));
/** Whether a result is kept in the tab's session storage: the keeper's head is there, which it writes last. */
const kept = () => session.held.has(`${KEPT_PREFIX}head`);
/** Lets the page keep the result it has just drawn, which it does in a turn of its own after drawing, and waits for that. */
const letKeep = async () => {
  vi.advanceTimersByTime(0);
  await eventually(kept, "the result to be kept");
};
/** The address the icon's click gives the page, a second and a half after the click. */
const clicked = (tab: number) => `?tab=${tab}&opened=${NOW.getTime() - 1500}`;
/** What the run control reads, beside its icon. */
const runControl = () => [page.id("runAgain").textContent.trim(), page.id("runAgain").title, page.all("#runAgain svg").length];
/** Lets what the script started without waiting for it, such as a copy to the clipboard, come to its end. */
const settle = async () => { for (let turn = 0; turn < 5; turn++) await Promise.resolve(); };
/** What Chrome says when it closes a port to a tab without the content script. */
const NO_RECEIVER = "Could not establish connection. Receiving end does not exist.";
/** Lets the page ask a tab whose content script never answers again, until it gives up: each port it opens meanwhile
 * closes at once, as Chrome closes one to such a tab. */
const neverAnswers = async () => {
  let seen = ports.length;
  for (let round = 0; round < 20; round++) {
    await vi.advanceTimersByTimeAsync(500);
    while (seen < ports.length) { lastError = { message: NO_RECEIVER }; ports[seen++].drop(); lastError = undefined; }
  }
};
/** The banner above a result: its kind, and its heading, message and hint as far as they are shown. */
const banner = () => (page.has("#runBanner")
  ? [page.id("runBanner").classList.contains("warn") ? "warn" : "note", ...["bannerTitle", "bannerText", "bannerHint"].filter(id => !page.id(id).hidden).map(id => page.id(id).textContent)]
  : []);
const sendResult = (port: FakePort, result = RESULT) => {
  port.send({ type: "result", result: { ...result, tables: result.tables.map(table => ({ ...table, rows: [] })) } });
  result.tables.forEach((table, index) => port.send({ type: "rows", table: index, rows: table.rows }));
  port.send({ type: "done" });
};
/** The page with a result on it, as the icon's click leaves it. */
const openWith = async (result = RESULT) => {
  await open(clicked(42));
  ports[0].send({ type: "subject", subject: { kind: "app", id: result.id } });
  sendResult(ports[0], result);
};
const disabled = (...ids: string[]) => ids.map(id => page.id(id).disabled);
/** Chooses a view from the navigation's line as a user does, by the name the entry gives it: an entry of a group's menu
 * once the group's button has opened the menu. */
const choose = (nav: string) => {
  const entry = page.find(`#navList [data-nav="${nav}"]`);
  const menu = entry.closest(".nav-menu");
  if (menu?.hidden) page.find(`#navList [aria-controls="${menu.id}"]`).press();
  entry.press();
};
/** Opens one of the result's tables from the navigation, by its place among the result's files. */
const goTo = (table: number) => choose(String(table));
/** What an entry of the navigation says: its words. Its icon is a drawing, which says nothing. */
const entryLabel = (item: FakeElement): string => item.querySelector("span")?.textContent ?? "";
/** The navigation's entries of the result's tables: those named by the table's place in the result, a number. The
 * overview's entry and a model map's are named by a word. */
const tableEntries = (): FakeElement[] => page.all("#navList .nav-item").filter(item => /^\d+$/.test(item.dataset.nav ?? ""));
/** Whether the page holds an img element other than the extension's icon beside its name, which results.html holds
 * itself: one that a name holding a tag would have become. */
const strayImg = (): boolean => page.all("img").some(image => !image.closest(".brand"));
/** The icon of each entry of the navigation, as the page holds it: the drawing's markup, as the stand-in page writes it out. */
const entryIcons = (): (string | undefined)[] => page.all("#navList .nav-item").map(item => item.querySelector("svg")?.outerHTML);
/** Icons of markup.ts as the page holds them once they are drawn, to be compared with an entry's. */
const drawnIcons = (...icons: (string | undefined)[]): (string | undefined)[] => icons.map(icon => (icon === undefined ? undefined : parseMarkup(icon).innerHTML));
/** The rows on screen, by the text of their first cell. */
const firstCells = () => page.all("#tableWrap tbody tr").map(row => row.children[0].textContent.trim());
/** The column headings that offer a filter, by the column's name. */
const filterable = () => page.all("#tableWrap thead th").filter(heading => heading.querySelector("[data-colfilter]")).map(heading => heading.querySelector(".th-sort")?.textContent.trim());
/** The open filter's choices: each one's text, its count, and whether it is ticked. */
const choices = () => page.all("#popover .pop-opt").map(option => [option.children[1].textContent, option.querySelector(".po-cnt")?.childNodes[0].textContent, option.children[0].checked]);
/** The pager's buttons: each one's words, with brackets around one that is disabled. */
const pagerButtons = () => page.all("#pager .pg-btn").map(button => {
  const words = button.textContent.trim();
  return button.disabled ? `(${words})` : words;
});

describe("The results page's script, on the page", () => {
  it("connects to the tab its address names, lets the analysis run by itself, shows the progress and then the result", async () => {
    await open(clicked(42));
    expect(page.id("version").textContent).toBe("vdev");
    expect(connects).toEqual([[42, { name: PORT_NAME }]]);
    expect(page.id("runStatus").textContent).toBe("Connecting to the Anaplan tab…");
    expect(ports[0].posted).toEqual([]);
    // The time of the click has left the address, and the tab's ID has stayed.
    expect([replaced, location.search]).toEqual([["/results.html?tab=42"], "?tab=42"]);
    expect(runControl()).toEqual(["Run again", "Analyse the Anaplan tab again", 1]);

    // The tab says what it shows: the page asks for the analysis at once, without a click.
    ports[0].send({ type: "subject", subject: { kind: "app", id: RESULT.id } });
    expect(ports[0].posted).toEqual([{ type: "run" }]);
    expect([page.id("runTitle").textContent, page.id("runStatus").textContent]).toEqual(["Analysing", "Starting the analysis…"]);
    expect(disabled("runAgain")).toEqual([true]);
    expect(page.id("topnav").hidden).toBe(true);

    ports[0].send({ type: "status", text: "Reading page 1 of 1: Overview" });
    ports[0].send({ type: "log", text: "14:02:05 Reading page 1 of 1: Overview" });
    ports[0].send({ type: "log", text: "14:02:06 <b>app</b>: 1 page" });
    expect(page.id("runStatus").textContent).toBe("Reading page 1 of 1: Overview");
    expect(page.id("diagLog").textContent).toBe("14:02:05 Reading page 1 of 1: Overview\n14:02:06 <b>app</b>: 1 page");
    expect(page.id("runLog").hidden).toBe(false);

    sendResult(ports[0]);
    expect(page.document.title).toBe("Cardigan - Demo <img src=x onerror=alert(1)> app");
    // The header says what was analysed, as text: the name's own tag is not one on the page.
    expect(page.texts("#hdMeta .meta-app")).toEqual(["Demo <img src=x onerror=alert(1)> app"]);
    expect(strayImg()).toBe(false);
    expect(page.find("#hdMeta .meta-sub").textContent).toContain("us1a.app.anaplan.com");
    // The notes are a panel of the overview, one line each: the summary, and the Notes rows of the Details file. The banner
    // area holds none of them.
    expect([page.texts("#view .panel h2"), page.texts("#view .warn-list li")]).toEqual([["Notes"], ["1 of 1 pages analysed, 2 cards.", "Archive: Not published"]]);
    expect(page.id("banners").children).toEqual([]);
    // One navigation entry per file. The Details file has none: the overview says what it holds. An app has no model map.
    expect(page.all("#navList [data-nav]").map(entry => entry.dataset.nav)).toEqual(["overview", "1", "2"]);
    expect(page.texts("#view h1")).toEqual(["Overview"]);
    expect(page.id("topnav").hidden).toBe(false);
    // Run again is there now.
    expect(disabled("runAgain")).toEqual([false]);
  });

  it("starts nothing by itself when the icon did not open it just now: it says what the tab shows, and Run analyses it", async () => {
    // Reloaded or duplicated (the time of the click is gone), restored later (it is a minute old or more), or opened by
    // hand with a time that is none or is still to come.
    const addresses = ["?tab=42", `?tab=42&opened=${NOW.getTime() - FRESH_MS}`, `?tab=42&opened=${NOW.getTime() - 86_400_000}`,
      `?tab=42&opened=${NOW.getTime() + 5000}`, "?tab=42&opened=now"];
    for (const [index, address] of addresses.entries()) {
      await open(address);
      expect(connects[index], address).toEqual([42, { name: PORT_NAME }]);
      ports[index].send({ type: "subject", subject: { kind: "app", id: RESULT.id } });
      expect(ports[index].posted, address).toEqual([]);
      expect(["runTitle", "runStatus", "runHint"].map(id => page.id(id).textContent), address).toEqual(["Ready to analyse", "That Anaplan tab shows an app.",
        "Choose Run to analyse it. This page starts by itself only when the Cardigan icon has just opened it."]);
      expect(runControl(), address).toEqual(["Run", "Analyse the Anaplan tab", 1]);
      expect(disabled("runAgain"), address).toEqual([false]);
      // A time that is in the address goes, fresh or not.
      expect(location.search, address).toBe("?tab=42");

      page.id("runAgain").press();
      expect(ports[index].posted, address).toEqual([{ type: "run" }]);
      expect([page.id("runTitle").textContent, page.id("runStatus").textContent], address).toEqual(["Analysing", "Starting the analysis…"]);
      expect(runControl(), address).toEqual(["Run again", "Analyse the Anaplan tab again", 1]);
    }
    expect(replaced).toEqual(Array(4).fill("/results.html?tab=42"));
  });

  it("says a model is a model, and analyses it on Run", async () => {
    await open("?tab=42");
    ports[0].send({ type: "subject", subject: { kind: "model", id: "0123456789ABCDEF0123456789ABCDEF" } });
    expect(page.id("runStatus").textContent).toBe("That Anaplan tab shows a model.");
    page.id("runAgain").press();
    expect(ports[0].posted).toEqual([{ type: "run" }]);
  });

  it("does not start again when the page the icon opened is reloaded", async () => {
    await open(clicked(42));
    ports[0].send({ type: "subject", subject: { kind: "app", id: RESULT.id } });
    expect(ports[0].posted).toEqual([{ type: "run" }]);
    // A reload loads the address the page left behind, still within the minute.
    await open(location.search);
    ports[1].send({ type: "subject", subject: { kind: "app", id: RESULT.id } });
    expect(ports[1].posted).toEqual([]);
    expect([page.id("runTitle").textContent, runControl()[0]]).toEqual(["Ready to analyse", "Run"]);
    expect(replaced).toEqual(["/results.html?tab=42"]);
  });

  it("starts nothing by itself when it cannot take the time of the click out of its address", async () => {
    fixedAddress = true;
    await open(clicked(42));
    ports[0].send({ type: "subject", subject: { kind: "app", id: RESULT.id } });
    expect(ports[0].posted).toEqual([]);
    expect(page.id("runTitle").textContent).toBe("Ready to analyse");
  });

  it("keeps the result on the page while it runs again, and replaces it only with a complete new one", async () => {
    await openWith();
    goTo(2);
    page.id("runAgain").press();
    page.all('#tableWrap tbody [data-act="row"]')[1].press();
    // The run is on the same port, and its progress stands above the result, as text.
    expect(connects).toHaveLength(1);
    expect(ports[0].posted).toEqual([{ type: "run" }, { type: "run" }]);
    expect(banner()).toEqual(["note", "Analysing", "Starting the analysis…", "Keep the Anaplan tab open until this finishes."]);
    expect(page.id("banners").textContent).toContain("The results below are from the earlier run.");
    ports[0].send({ type: "status", text: `Reading page 1 of 1: ${TAG}` });
    ports[0].send({ type: "log", text: "14:02:09 Reading page 1 of 1" });
    expect([banner()[2], strayImg()]).toEqual([`Reading page 1 of 1: ${TAG}`, false]);

    // The earlier result is all still there: its name, its navigation, the table and the row the user was reading.
    const earlier = () => [page.document.title, page.texts("#hdMeta .meta-app"), page.all("#navList [data-nav]").length, page.texts("#view h1"), firstCells().length,
      page.id("drawer").hidden, page.texts("#drawerBody dd")[2]];
    expect(earlier()).toEqual(["Cardigan - Demo <img src=x onerror=alert(1)> app", ["Demo <img src=x onerror=alert(1)> app"], 3, ["Cards"], 2, false, "=Margin"]);
    expect(disabled("runAgain")).toEqual([true]);
    page.id("drawerClose").press();

    // The new result arrives in pieces: until it is complete, nothing of it is shown, and the user reads on.
    page.all('#tableWrap tbody [data-act="row"]')[0].press();
    expect(page.id("drawer").classList.contains("show")).toBe(true);
    const next: AnalysisResult = { ...RESULT, name: "Demo app, second run", zipName: "Second.zip", summary: ["1 of 1 pages analysed, 1 card."],
      tables: [RESULT.tables[0], RESULT.tables[1], { ...RESULT.tables[2], rows: [["Overview", 1, "Only card", "Grid", "card-z"]] }] };
    ports[0].send({ type: "result", result: { ...next, tables: next.tables.map(table => ({ ...table, rows: [] })) } });
    next.tables.forEach((table, index) => ports[0].send({ type: "rows", table: index, rows: table.rows }));
    expect([earlier().slice(0, 5), banner().slice(0, 3)]).toEqual([["Cardigan - Demo <img src=x onerror=alert(1)> app", ["Demo <img src=x onerror=alert(1)> app"], 3, ["Cards"], 2],
      ["note", "Analysing", "Receiving the result…"]]);
    ports[0].send({ type: "done" });
    // Now the page is the new result's: its overview, whose tiles count its rows, without the banner, and without the
    // drawer that showed a row of the old one.
    expect([page.document.title, page.texts("#view h1"), page.texts("#view .s-num"), page.id("banners").children, page.id("drawer").classList.contains("show")])
      .toEqual(["Cardigan - Demo app, second run", ["Overview"], ["1", "1"], [], false]);
    // The focus was in that drawer: it is on the new view now, not on nothing.
    expect(page.document.activeElement).toBe(page.id("view"));
    expect(disabled("runAgain")).toEqual([false]);
    // The tables are the new result's from now on.
    goTo(2);
    expect(page.all("#tableWrap tbody tr").map(row => row.children[1].textContent.trim())).toEqual(["Only card"]);
  });

  it("closes a popover of the old result's table when the new result takes its place", async () => {
    await openWith();
    goTo(2);
    page.id("runAgain").press();
    page.find('[data-colfilter="3"]').press();
    expect(page.id("popover").hidden).toBe(false);
    sendResult(ports[0]);
    expect([page.id("popover").hidden, page.id("popover").children, page.texts("#view h1")]).toEqual([true, [], ["Overview"]]);
    expect(page.document.activeElement).toBe(page.id("view"));
    // Focus outside what was replaced stays where it is: on a button of the header.
    page.id("runAgain").press();
    page.id("themeToggle").press();
    sendResult(ports[0]);
    expect(page.document.activeElement).toBe(page.id("themeToggle"));
  });

  it("keeps the result when Run again cannot reach the tab, and says so above it with that run's log to copy", async () => {
    await openWith();
    goTo(2);
    // The Anaplan tab was closed after the analysis: its port has gone.
    ports[0].drop();
    lastError = { message: "Could not establish connection. Receiving end does not exist." };
    page.id("runAgain").press();
    expect(connects).toHaveLength(2);
    expect([banner(), page.id("bannerCopy").hidden]).toEqual([["note", "Connecting", "Connecting to the Anaplan tab…"], true]);
    ports[1].drop();
    lastError = undefined;
    // It asks again for a while, as for a tab that is still loading, and then says so.
    expect(banner().slice(0, 2)).toEqual(["note", "Connecting"]);
    await neverAnswers();
    expect(banner()).toEqual(["warn", "Not connected", "Cardigan cannot reach that tab.", "If it is an Anaplan app or model that is still loading, wait for it, then choose Run again. Otherwise refresh it, then click the Cardigan icon on it."]);
    // The result is where it was; Run again can be tried again.
    expect([page.document.title, page.texts("#view h1"), firstCells().length, page.id("topnav").hidden]).toEqual(["Cardigan - Demo <img src=x onerror=alert(1)> app", ["Cards"], 2, false]);
    expect(disabled("runAgain")).toEqual([false]);
    // The banner's button copies the log of the run that failed, not the one the result carries.
    expect(page.id("bannerCopy").hidden).toBe(false);
    page.id("bannerCopy").press();
    await settle();
    expect(copied).toEqual(["14:02:05 The tab did not answer: Could not establish connection. Receiving end does not exist.\n14:02:10 No answer after 10 more tries."]);
    expect(page.id("toast").textContent).toBe("Copied the diagnostic log");
  });

  it("keeps the result when the new run fails or is cut off, even after pieces of a new result have arrived", async () => {
    await openWith();
    /** What the page shows of the result: its name, the view's heading, and the overview's counts, which stays on screen. */
    const shown = () => [page.document.title, page.texts("#view h1"), page.texts("#view .s-num")];
    const first = shown();
    // The tab says the run failed.
    page.id("runAgain").press();
    ports[0].send({ type: "log", text: "14:02:09 stopped: GET /apps 503" });
    ports[0].send({ type: "error", message: `Anaplan could not be reached. Check your connection, then choose Run again. ${TAG}` });
    expect(banner().slice(0, 3)).toEqual(["warn", "The analysis stopped", `Anaplan could not be reached. Check your connection, then choose Run again. ${TAG}`]);
    expect([shown(), strayImg(), disabled("runAgain")]).toEqual([first, false, [false]]);

    // A piece of the result could not be sent: an error takes the place of "done", after the result and some of its rows.
    page.id("runAgain").press();
    ports[0].send({ type: "result", result: { ...RESULT, name: "Half", tables: RESULT.tables.map(table => ({ ...table, rows: [] })) } });
    ports[0].send({ type: "rows", table: 1, rows: [["Half a page", 1]] });
    ports[0].send({ type: "log", text: "14:02:10 stopped: the result could not be sent (Message length exceeded maximum allowed length.)" });
    ports[0].send({ type: "error", message: "Cardigan finished reading but could not pass the result to this page. Choose Run again." });
    ports[0].send({ type: "done" });
    expect([shown(), banner()[2]]).toEqual([first, "Cardigan finished reading but could not pass the result to this page. Choose Run again."]);
    page.id("bannerCopy").press();
    await settle();
    expect(copied).toEqual(["14:02:10 stopped: the result could not be sent (Message length exceeded maximum allowed length.)"]);

    // The tab is closed in the middle of the run.
    page.id("runAgain").press();
    ports[0].send({ type: "result", result: { ...RESULT, name: "Half", tables: RESULT.tables.map(table => ({ ...table, rows: [] })) } });
    ports[0].drop();
    expect(banner().slice(0, 3)).toEqual(["warn", "The analysis stopped", "The Anaplan tab was closed or left the page before the analysis finished."]);
    expect(shown()).toEqual(first);
    // The overview still shows, and copies, the log the result carries.
    page.find('#navList [data-nav="overview"]').press();
    page.find("#ovLog summary").press();
    page.find('#view [data-act="copy-diag"]').press();
    await settle();
    expect(copied[1]).toBe("14:02:05 app: 1 page");
  });

  it("opens a row and a card whose table and title hold a tag, and shows both names as text", async () => {
    await openWith(NAMED);
    page.find('#navList [data-nav="2"]').press();
    expect(page.texts("#view h1")).toEqual([`Cards ${TAG}`]);
    // A click on a row, outside its links, opens the row. The drawer's title is the row's own name, which for a card is
    // its title, and the line under it says which row of which table it is.
    page.find("#tableWrap tbody tr .tag").press();
    expect(page.id("drawer").hidden).toBe(false);
    expect([page.id("drawerTitle").textContent, page.id("drawerSub").textContent]).toEqual([`Sales ${TAG}`, `Row 1 of Cards ${TAG}`]);
    expect([page.id("drawerTitle").children, page.id("drawerSub").children]).toEqual([[], []]);
    expect(page.texts("#drawerBody dd")).toContain(`Sales ${TAG}`);
    // A card's number opens the card. The drawer's title is the card's own title.
    page.id("drawerClose").press();
    page.find('#tableWrap tbody [data-act="card"]').press();
    expect(page.id("drawerTitle").textContent).toBe(`Card 1 - Sales ${TAG}`);
    expect(page.id("drawerTitle").children).toEqual([]);
    expect(page.texts("#drawerSub .link")).toEqual(["Overview"]);
    // A row whose own name holds the tag: the page named so, in the Pages table.
    page.id("drawerClose").press();
    goTo(1);
    page.all('#tableWrap tbody [data-act="row"]')[1].press();
    expect([page.id("drawerTitle").textContent, page.id("drawerTitle").children, page.id("drawerSub").textContent]).toEqual([`Stores ${TAG}`, [], "Row 2 of Pages"]);
    // None of the names became an element, anywhere on the page.
    expect([strayImg(), page.all("[onerror]")]).toEqual([false, []]);
  });

  it("leaves the search box alone while the user types: only the rows, the count, the pager and Reset are drawn again", async () => {
    await openWith(MODEL);
    goTo(1);
    const box = page.id("tblSearch");
    const kept = [box, page.find(".toolbar"), page.id("tableWrap"), page.id("pager"), page.id("colBtn"), page.find("#view h1")];
    expect([page.id("rowCount").textContent, firstCells().length, page.id("resetBtn").hidden, pagerButtons()]).toEqual(["1–50 of 120 rows", 50, true, ["(‹)", "›"]]);

    box.type("item 11");
    // The box is the very element the user is typing into, with what was typed and the focus still in it.
    expect(page.id("tblSearch")).toBe(box);
    expect([box.value, page.document.activeElement === box]).toEqual(["item 11", true]);
    expect(firstCells()).toEqual(["Line item 11", ...Array.from({ length: 10 }, (_, index) => `Line item ${110 + index}`)]);
    expect(page.id("live").textContent).toBe("Line Items: 11 rows");
    expect([page.id("rowCount").textContent, page.id("resetBtn").hidden, pagerButtons()]).toEqual(["1–11 of 11 rows (filtered from 120)", false, ["(‹)", "(›)"]]);
    expect(page.id("searchWrap").classList.contains("has-value")).toBe(true);

    // Each further letter does the same, and so does taking letters away.
    box.type("item 119");
    expect([firstCells(), page.id("rowCount").textContent, page.id("live").textContent]).toEqual([["Line item 119"], "1–1 of 1 row (filtered from 120)", "Line Items: 1 row"]);
    box.type("item 119x");
    expect([firstCells(), page.texts("#tableWrap .e-title"), pagerButtons(), page.id("rowCount").textContent]).toEqual([[], ["No results"], [], "No rows (filtered from 120)"]);
    box.type("");
    expect([firstCells().length, page.id("rowCount").textContent, page.id("resetBtn").hidden, page.id("searchWrap").classList.contains("has-value")])
      .toEqual([50, "1–50 of 120 rows", true, false]);
    // The rest of the view was never written again either.
    expect([page.id("tblSearch"), page.find(".toolbar"), page.id("tableWrap"), page.id("pager"), page.id("colBtn"), page.find("#view h1")].map((element, index) => element === kept[index]))
      .toEqual(Array(6).fill(true));

    // The cross in the box empties it where it stands and gives it the focus back.
    box.type("item 12");
    page.find('[data-act="clear-search"]').press();
    expect(page.id("tblSearch")).toBe(box);
    expect([box.value, page.document.activeElement === box, page.id("rowCount").textContent]).toEqual(["", true, "1–50 of 120 rows"]);
  });

  it("offers a filter in a model's table on each column that holds few different values, and filters by it", async () => {
    await openWith(MODEL);
    goTo(1);
    // Format holds three values and Module two; every name and every formula is different.
    expect(filterable()).toEqual(["Format", "Module"]);
    page.find('[data-colfilter="3"]').press();
    expect(choices()).toEqual([["Cost", "60", true], ["Revenue", "60", true]]);
    // The popover says what its numbers count: to the eye above the list, and to a screen reader with each number.
    expect([page.texts("#popover .pop-hd"), page.texts("#popover .po-cnt")]).toEqual([["Filter: ModuleShow all", "ValueRows in the whole table"], ["60 rows in the whole table", "60 rows in the whole table"]]);
    page.all("#popover input")[0].tick();
    expect([page.id("rowCount").textContent, firstCells()[0], page.find('[data-colfilter="3"]').classList.contains("active")]).toEqual(["1–50 of 60 rows (filtered from 120)", "Line item 1", true]);
    // A second column's filter narrows what the first left.
    page.find('[data-colfilter="1"]').press();
    expect(choices()).toEqual([["Boolean", "40", true], ["Number", "40", true], ["Text", "40", true]]);
    page.all("#popover input")[0].tick();
    page.all("#popover input")[2].tick();
    expect([page.id("rowCount").textContent, firstCells().slice(0, 3)]).toEqual(["1–20 of 20 rows (filtered from 120)", ["Line item 1", "Line item 4", "Line item 7"]]);
    // The Modules table: two rows, two areas.
    page.key("Escape");
    goTo(2);
    expect(filterable()).toEqual(["Name", "Functional Area"]);
  });

  it("filters a column of lists by each item, and a filter of many values by what its box finds: its buttons tick or untick all of that", async () => {
    // Sixty modules, each applying to Products and to one of twenty regions, as a model's grid writes names, each region in
    // three modules; and each in one of three functional areas.
    const region = (at: number) => `Region ${String((at % 20) + 1).padStart(2, "0")}`;
    const MANY: AnalysisResult = { ...MODEL, summary: ["Modules: 60 rows"], tables: [MODEL.tables[0], { file: "Modules.csv", label: "Modules",
      headers: ["", "Applies To", "Functional Area"], guard: false, rows: Array.from({ length: 60 }, (_, at) => [`Module ${at + 1}`, `Products, ${region(at)}`, `Area ${at % 3}`]) }] };
    await openWith(MANY);
    goTo(1);
    // Every cell of Applies To is its own, but its items repeat: the column offers a filter. The modules' names do not.
    expect(filterable()).toEqual(["Applies To", "Functional Area"]);
    page.find('[data-colfilter="1"]').press();
    // Each item once, with the rows that list it, Products first; with more than fifteen, a box finds them, and has the focus.
    const box = page.find("#popover [data-ffind]");
    expect([choices().length, choices()[0], choices()[1], page.document.activeElement === box, page.find("#popover [data-fstatus]").textContent, page.find("#popover .pop-note").textContent])
      .toEqual([21, ["Products", "60", true], ["Region 01", "3", true], true, "21 values.", "Each item is listed on its own: a row shows when any of its items is ticked."]);
    // The box narrows the list, whatever the case, and the buttons say they work on what it finds.
    box.type("region 0");
    expect([choices().map(([value]) => value), page.find("#popover [data-fstatus]").textContent, page.texts("#popover [data-popact]")])
      .toEqual([Array.from({ length: 9 }, (_, at) => `Region 0${at + 1}`), "9 of 21 values match.", ["Show all", "Tick matches", "Untick matches"]]);
    // Unticking what it finds keeps every row while Products, which each of them lists, is ticked.
    page.find('#popover [data-popact="untick"]').press();
    expect([choices().every(([, , ticked]) => !ticked), page.id("rowCount").textContent, page.find('[data-colfilter="1"]').classList.contains("active")])
      .toEqual([true, "1–50 of 60 rows", true]);
    // Without Products, a row shows only by its region: the nine regions found are gone, and their twenty-seven modules.
    box.type("PRODUCTS");
    page.find('#popover [data-popact="untick"]').press();
    expect([choices(), page.id("rowCount").textContent]).toEqual([[["Products", "60", false]], "1–33 of 33 rows (filtered from 60)"]);
    // Ticking what it finds brings its rows back; with nothing typed, the buttons work on every value.
    box.type("");
    expect([page.texts("#popover [data-popact]"), page.find("#popover [data-fstatus]").textContent]).toEqual([["Show all", "Tick all", "Untick all"], "21 values."]);
    page.find('#popover [data-popact="tick"]').press();
    expect([choices().every(([, , ticked]) => ticked), page.id("rowCount").textContent, page.find('[data-colfilter="1"]').classList.contains("active")])
      .toEqual([true, "1–50 of 60 rows", false]);
    // A box ticked in the narrowed list is the value it shows, whatever its place in the list.
    box.type("region 20");
    page.all("#popover .pop-opt input")[0].tick();
    expect([choices(), page.id("rowCount").textContent]).toEqual([[["Region 20", "3", false]], "1–50 of 60 rows"]);
    page.find('#popover [data-popact="all"]').press();
    expect([page.id("popover").hidden, page.find('[data-colfilter="1"]').classList.contains("active")]).toEqual([true, false]);
  });

  it("shows a table from its first page again after a sort, a search or a filter, and after leaving a search behind", async () => {
    await openWith(MODEL);
    goTo(1);
    /** The page shown, by its number from 1, as the count says it: by the first row it shows, of the fifty a page holds. */
    const current = () => String(Math.ceil(parseInt(page.id("rowCount").textContent, 10) / 50));
    /** Turns from the first page to the page of this number by Next, as a user does, and checks that it got there. */
    const toPage = (number: number) => {
      for (let turn = 1; turn < number; turn++) page.find('.pg-btn[aria-label="Next page"]').press();
      expect(current(), `page ${number}`).toBe(String(number));
    };
    // A sort puts other rows on every page: each of its three steps starts at the first page.
    for (const expected of ["Line item 1", "Line item 120", "Line item 1"]) {
      toPage(3);
      page.find('[data-sort="0"]').press();
      expect([current(), firstCells()[0]]).toEqual(["1", expected]);
    }
    // A filter and a search do the same: a box ticked, and Show all.
    toPage(2);
    page.find('[data-colfilter="1"]').press();
    page.all("#popover input")[0].tick();
    expect([current(), page.id("rowCount").textContent]).toEqual(["1", "1–50 of 80 rows (filtered from 120)"]);
    toPage(2);
    page.find('[data-colfilter="1"]').press();
    page.find('#popover [data-popact="all"]').press();
    expect([current(), page.id("rowCount").textContent]).toEqual(["1", "1–50 of 120 rows"]);
    toPage(3);
    page.id("tblSearch").type("revenue");
    expect([current(), page.id("rowCount").textContent]).toEqual(["1", "1–50 of 60 rows (filtered from 120)"]);
    // Rows per page and the columns shown change no row's place: only the page size starts again.
    toPage(2);
    page.id("colBtn").press();
    page.all("#popover input")[1].tick();
    page.key("Escape");
    expect(current()).toBe("2");

    // The search ends when the user leaves the table: coming back, the table is whole again, and on its first page.
    goTo(2);
    goTo(1);
    expect([page.id("tblSearch").value, current(), page.id("rowCount").textContent]).toEqual(["", "1", "1–50 of 120 rows"]);
    // Without a search, a table keeps the page the user left it on.
    toPage(3);
    goTo(2);
    goTo(1);
    expect([current(), page.id("rowCount").textContent]).toEqual(["3", "101–120 of 120 rows"]);
  });

  it("shows a table from its first page again after a jump to a page's cards is left behind", async () => {
    // An app with sixty cards on one page and sixty on another.
    const cards = Array.from({ length: 120 }, (_, index): Cell[] => [index < 60 ? "Overview" : "Stores", index % 60 + 1, `Card ${index + 1}`, "Grid", `card-${index}`]);
    await openWith({ ...RESULT, tables: [RESULT.tables[0], { ...RESULT.tables[1], rows: [["Overview", 60], ["Stores", 60]] }, { ...RESULT.tables[2], rows: cards }] });
    goTo(1);
    page.all('#tableWrap tbody [data-act="page"]')[1].press();
    expect([page.texts("#view h1"), page.texts("#pageFilter"), page.id("rowCount").textContent]).toEqual([["Cards"], ["Page: Stores"], "1–50 of 60 rows (filtered from 120)"]);
    page.find('.pg-btn[aria-label="Next page"]').press();
    expect(page.id("rowCount").textContent).toBe("51–60 of 60 rows (filtered from 120)");
    // Leaving the jump by the navigation, and coming back to all the cards.
    goTo(1);
    goTo(2);
    expect([page.has("#pageFilter"), page.id("rowCount").textContent]).toEqual([false, "1–50 of 120 rows"]);
    // The chip's cross ends the jump in place, and gives the view the focus: the chip goes with what it cleared.
    goTo(1);
    page.all('#tableWrap tbody [data-act="page"]')[0].press();
    page.find('.pg-btn[aria-label="Next page"]').press();
    page.find('#pageFilter [data-act="clear-context"]').press();
    expect([page.has("#pageFilter"), page.id("rowCount").textContent, page.document.activeElement === page.id("view")]).toEqual([false, "1–50 of 120 rows", true]);
  });

  it("keeps the focus on the control the user has just used when the table is drawn again", async () => {
    await openWith(MODEL);
    goTo(1);
    /** What has the focus: its sort column, its name in the pager or its ID, and whether it is on the page as it stands now. */
    const focus = () => {
      const active = page.document.activeElement;
      return [active.dataset.sort ?? active.getAttribute("aria-label") ?? active.id, active.isConnected && active !== page.document.body];
    };
    // A sort: the same column's button, through ascending, descending and back to the file's order.
    for (const direction of ["ascending", "descending", "none"]) {
      page.find('[data-sort="2"]').press();
      expect([focus(), page.find('[data-sort="2"]').closest("th")?.getAttribute("aria-sort")], direction).toEqual([["2", true], direction]);
      expect(page.document.activeElement).toBe(page.find('[data-sort="2"]'));
    }

    // The pager: Next stays Next while there is a next page; on the last page it is disabled, and Previous takes the focus.
    page.find('.pg-btn[aria-label="Next page"]').press();
    expect([focus(), pagerButtons(), page.id("rowCount").textContent]).toEqual([["Next page", true], ["‹", "›"], "51–100 of 120 rows"]);
    page.document.activeElement.press();
    expect([focus(), pagerButtons(), page.id("rowCount").textContent]).toEqual([["Previous page", true], ["‹", "(›)"], "101–120 of 120 rows"]);

    // Rows per page: the list itself, with what was chosen.
    page.id("pageSize").choose("100");
    expect([focus(), page.id("pageSize").value, page.id("rowCount").textContent]).toEqual([["Rows per page", true], "100", "1–100 of 120 rows"]);
    expect(page.document.activeElement).toBe(page.id("pageSize"));

    // Reset goes away with what it resets: the focus moves to the search box. So does "Clear search & filters" under no rows.
    page.find('[data-sort="1"]').press();
    page.id("resetBtn").press();
    expect([focus(), page.id("resetBtn").hidden]).toEqual([["Search Line Items", true], true]);
    page.id("tblSearch").type("no such line");
    page.find('.empty [data-act="reset"]').press();
    expect([focus(), page.id("tblSearch").value, firstCells().length]).toEqual([["Search Line Items", true], "", 100]);
  });

  it("hands the focus to the other arrow when a page turn leaves the one pressed disabled, so that Enter alone walks a table to its end and back", async () => {
    await openWith(MODEL);
    goTo(1);
    // Five pages of 25 rows, and Next pressed once: from there on the keyboard user presses Enter on whatever has the focus.
    page.id("pageSize").choose("25");
    page.find('.pg-btn[aria-label="Next page"]').press();
    /** What has the focus, by its name, and whether it is on the page as it stands now; then the rows shown and the pager's buttons. */
    const where = () => {
      const active = page.document.activeElement;
      return [active.getAttribute("aria-label"), active.isConnected && active !== page.document.body, page.id("rowCount").textContent, pagerButtons().join(" ")];
    };
    const steps = [where()];
    for (let press = 0; press < 9; press++) {
      page.document.activeElement.press();
      steps.push(where());
    }
    expect(steps).toEqual([
      ["Next page", true, "26–50 of 120 rows", "‹ ›"],
      ["Next page", true, "51–75 of 120 rows", "‹ ›"],
      ["Next page", true, "76–100 of 120 rows", "‹ ›"],
      // The last page: Next is disabled, so Previous has the focus, and the next Enter turns the page back.
      ["Previous page", true, "101–120 of 120 rows", "‹ (›)"],
      ["Previous page", true, "76–100 of 120 rows", "‹ ›"],
      ["Previous page", true, "51–75 of 120 rows", "‹ ›"],
      ["Previous page", true, "26–50 of 120 rows", "‹ ›"],
      // The first page: Previous is disabled, so Next has the focus, and the walk goes on forward.
      ["Next page", true, "1–25 of 120 rows", "(‹) ›"],
      ["Next page", true, "26–50 of 120 rows", "‹ ›"],
      ["Next page", true, "51–75 of 120 rows", "‹ ›"],
    ]);
  });

  it("keeps each column of a table as wide through a sort, a page, a search and a filter: its width is the whole table's", async () => {
    // The Line Items table's longest name is on its last page, and its longest formula on its second, in a row that a
    // search for "revenue" leaves out.
    const lines = LINES.map((row, index) => (index === 110 ? ["Line item 111, whose name is far longer than any other line item's", ...row.slice(1)]
      : index === 75 ? [row[0], row[1], "IF Units > 0 THEN Units * Price * (1 + Uplift) ELSE 0", row[3]] : row));
    await openWith({ ...MODEL, tables: [MODEL.tables[0], { ...MODEL.tables[1], rows: lines }, MODEL.tables[2]] });
    goTo(1);
    /** The width each column is given, as its <col> says it. */
    const widths = () => page.all("#tableWrap colgroup col").map(col => col.getAttribute("style"));
    const first = widths();
    expect([first.length, firstCells()[0], page.id("rowCount").textContent]).toEqual([4, "Line item 1", "1–50 of 120 rows"]);
    const steps: [step: string, act: () => void][] = [
      ["sort ascending", () => page.find('[data-sort="2"]').press()],
      ["sort descending", () => page.find('[data-sort="2"]').press()],
      ["sort off", () => page.find('[data-sort="2"]').press()],
      ["sort by another column", () => page.find('[data-sort="0"]').press()],
      ["page 3", () => { page.find('.pg-btn[aria-label="Next page"]').press(); page.find('.pg-btn[aria-label="Next page"]').press(); }],
      ["100 rows a page", () => page.id("pageSize").choose("100")],
      ["search", () => page.id("tblSearch").type("revenue")],
      ["search that finds nothing", () => page.id("tblSearch").type("no such line")],
      ["search cleared", () => page.id("tblSearch").type("")],
      ["filter", () => { page.find('[data-colfilter="1"]').press(); page.all("#popover input")[0].tick(); }],
      ["filter closed", () => page.key("Escape")],
      ["filter shown all", () => { page.find('[data-colfilter="1"]').press(); page.find('#popover [data-popact="all"]').press(); }],
    ];
    const seen = new Set<string>();
    for (const [step, act] of steps) {
      act();
      seen.add(`${firstCells()[0]} | ${page.id("rowCount").textContent}`);
      expect(widths(), step).toEqual(first);
    }
    // The steps showed eight different sets of rows among them, by their first row and their count: not one view drawn again.
    expect(seen.size).toBe(8);
    // The widths are the whole table's: the long name and the long formula widen their columns on the first page, where
    // neither is shown. Measured by the first page's rows alone, as a browser lays out a table by the rows it has, those
    // two columns would be narrower there than on the pages that show them.
    const table: ResultTable = { ...MODEL.tables[1], rows: lines };
    const ch = (style: string | null | undefined) => Number(/^--width:(\d+)ch$/.exec(style ?? "")?.[1]);
    const byFirstPage = columnWidths(columnsOf(table), lines.slice(0, 50));
    expect([ch(first[0]), ch(first[2])]).toEqual([columnWidths(columnsOf(table), lines).get(0), columnWidths(columnsOf(table), lines).get(2)]);
    expect([(byFirstPage.get(0) ?? Infinity) < ch(first[0]), (byFirstPage.get(2) ?? Infinity) < ch(first[2])]).toEqual([true, true]);
  });

  it("gives the focus back to the sort button pressed where it stands, moving neither the table's box sideways nor the page", async () => {
    await openWith(MODEL);
    goTo(1);
    const scrolled: unknown[] = [];
    vi.spyOn(window, "scrollTo").mockImplementation((...args: unknown[]) => { scrolled.push(args); });
    // The table is scrolled sideways and down its rows.
    const wrap = page.id("tableWrap");
    wrap.scrollLeft = 240;
    wrap.scrollTop = 120;
    for (const direction of ["ascending", "descending", "none"]) {
      page.find('[data-sort="2"]').press();
      const button = page.find('[data-sort="2"]');
      // The box is the one that was scrolled, and stays where it was sideways; it is back at the top of its rows, where
      // the new order begins. The button pressed is the one with the focus, and it took it without the browser being
      // let scroll to it: it stands where it was pressed, and a browser that scrolls to a header near the first column
      // takes the table back sideways.
      expect([page.id("tableWrap") === wrap, wrap.scrollLeft, wrap.scrollTop, page.document.activeElement === button, button.focusedIntoSight, button.closest("th")?.getAttribute("aria-sort")], direction)
        .toEqual([true, 240, 0, true, 0, direction]);
      wrap.scrollTop = 120;
    }
    // The same for a column's filter button, which takes the focus back when its popover closes.
    page.find('[data-colfilter="1"]').press();
    page.all("#popover input")[0].tick();
    page.key("Escape");
    const filter = page.find('[data-colfilter="1"]');
    expect([page.document.activeElement === filter, filter.focusedIntoSight, page.id("tableWrap") === wrap, wrap.scrollLeft]).toEqual([true, 0, true, 240]);
    // The page itself was not scrolled by any of it.
    expect(scrolled).toEqual([]);
  });

  it("opens a row from the keyboard: each row's first cell holds a button for it, in a model's tables too", async () => {
    await openWith(MODEL);
    goTo(1);
    // A model's table has no link of its own: the row's name is the button, one per row on screen.
    const buttons = () => page.all('#tableWrap tbody [data-act="row"]');
    expect([buttons().length, buttons().slice(0, 3).map(button => button.textContent), buttons().every(button => button.localName === "button" && button.focusable)])
      .toEqual([50, ["Line item 1", "Line item 2", "Line item 3"], true]);
    expect(page.all("#tableWrap tbody tr").every(row => row.children[0].contains(row.querySelector('[data-act="row"]')))).toBe(true);
    // The button opens its own row, not a neighbour, and the drawer shows the row whole.
    buttons()[2].press();
    expect([page.id("drawer").hidden, page.texts("#drawerBody dd")]).toEqual([false, ["Line item 3", "Boolean", "Source 3 * 2", "Revenue"]]);
    // Escape closes the drawer and the focus is back on that row's button.
    page.key("Escape");
    vi.advanceTimersByTime(300);
    expect([page.id("drawer").hidden, page.document.activeElement === buttons()[2]]).toEqual([true, true]);
    // After a sort and on another page of the table, the button still opens the row it stands in.
    page.find('[data-sort="0"]').press();
    page.find('[data-sort="0"]').press();
    page.find('.pg-btn[aria-label="Next page"]').press();
    page.find('.pg-btn[aria-label="Next page"]').press();
    expect(firstCells().slice(0, 2)).toEqual(["Line item 20", "Line item 19"]);
    buttons()[1].press();
    expect(page.texts("#drawerBody dd")).toEqual(["Line item 19", "Number", "Source 19 * 2", "Revenue"]);
    // The drawer is headed by the row's own name, and says where the row is in the file, not on screen.
    expect([page.id("drawerTitle").textContent, page.id("drawerSub").textContent]).toEqual(["Line item 19", "Row 19 of Line Items"]);
    page.id("drawerClose").press();

    // A click on the row itself opens it as before, and the focus then goes back to the row's button.
    page.all("#tableWrap tbody tr")[4].children[2].press();
    expect(page.texts("#drawerBody dd")[0]).toBe("Line item 16");
    page.key("Escape");
    expect(page.document.activeElement).toBe(buttons()[4]);

    // With the first column hidden, the first one shown opens the row.
    page.id("colBtn").press();
    page.all("#popover input")[0].tick();
    page.key("Escape");
    expect(buttons().slice(0, 2).map(button => button.textContent)).toEqual(["Text", "Number"]);
    buttons()[0].press();
    expect(page.texts("#drawerBody dd")[0]).toBe("Line item 20");
  });

  it("shows a row whole in its drawer: each cell as it is, and the cells it holds beyond the table's headers", async () => {
    const formula = "IF a THEN\n    b  *  c\nELSE d";
    const odd: AnalysisResult = { ...MODEL, tables: [MODEL.tables[0], { file: "Line Items.csv", label: "Line Items", headers: ["", "Formula"], guard: false,
      rows: [["Revenue", formula, "beyond the headers", `more ${TAG}`], ["Units", "1"], ["", "-"]] }] };
    await openWith(odd);
    goTo(1);
    // The table keeps to its headers; the row's drawer has every cell the row holds.
    expect([page.all("#tableWrap thead th").length, page.all("#tableWrap tbody tr").map(row => row.children.length)]).toEqual([2, [2, 2, 2]]);
    page.all('#tableWrap tbody [data-act="row"]')[0].press();
    expect(page.texts("#drawerBody dt")).toEqual(["Name", "Formula", "Column 3", "Column 4"]);
    expect(page.all("#drawerBody dd").map(value => value.textContent)).toEqual(["Revenue", formula, "beyond the headers", `more ${TAG}`]);
    expect(page.all("#drawerBody dd .cell-t").map(value => value.textContent)).toEqual(["Revenue", formula, "beyond the headers", `more ${TAG}`]);
    expect(strayImg()).toBe(false);
    page.id("drawerClose").press();
    page.all('#tableWrap tbody [data-act="row"]')[1].press();
    expect(page.texts("#drawerBody dt")).toEqual(["Name", "Formula"]);
    page.id("drawerClose").press();
    // A dash in a model's file is Anaplan's own text, as Anaplan wrote it: shown as the text it is, with its tooltip, and
    // not greyed as the dash an app's file has for nothing to say. A row with nothing else names itself by it.
    const dash = page.all("#tableWrap tbody tr")[2].children[1];
    expect([dash.querySelectorAll(".cell-t").map(text => [text.textContent, text.title]), page.has("#tableWrap .dash")]).toEqual([[["-", "-"]], false]);
    page.all('#tableWrap tbody [data-act="row"]')[2].press();
    expect([page.id("drawerTitle").textContent, page.id("drawerSub").textContent, page.has("#drawerBody .dash")]).toEqual(["-", "Row 3 of Line Items", false]);
  });

  it("keeps a page's link in an app's first column, with the row's button before it", async () => {
    await openWith();
    goTo(2);
    const first = page.all("#tableWrap tbody tr").map(row => row.children[0].querySelectorAll("button").map(button => [button.dataset.act, button.textContent, button.getAttribute("aria-label")]));
    expect(first).toEqual([[["row", "", "Open this row"], ["page", "Overview", null]], [["row", "", "Open this row"], ["page", "Overview", null]]]);
    // The row's button opens the row, not the card and not the page's cards.
    page.all('#tableWrap tbody [data-act="row"]')[1].press();
    expect([page.id("drawerTitle").textContent, page.id("drawerSub").textContent, page.texts("#drawerBody h3"), page.texts("#drawerBody dd")])
      .toEqual(["=Margin", "Row 2 of Cards", ["All columns"], ["Overview", "2", "=Margin", "KPI", "card-b"]]);
    page.key("Escape");
    // And the page's name still shows that page's cards.
    page.find('#tableWrap tbody [data-act="page"]').press();
    expect(page.texts("#pageFilter")).toEqual(["Page: Overview"]);
  });

  it("heads a row's drawer by the row's own name: the column that names the file's rows, and the first cell that says something where there is none", async () => {
    // The app's files, the Pages and the Action Buttons among them, and a card without a title.
    const app: AnalysisResult = { ...APP, tables: [...APP.tables.map((table, index) => (index === 2 ? { ...table, rows: [...table.rows, ["Overview", 3, "-", "Text", "card-c"], ["Overview", 4, "", "Text", "card-d"]] } : table)),
      { file: "Action Buttons.csv", label: "Action Buttons", headers: ["Page", "Card #", "Button label", "Action type", "Card ID"], guard: true,
        rows: [["Overview", 1, "Reload plan", "Import", "card-a"], ["", "", "-", "-", ""]] }] };
    await openWith(app);
    /** The heading and the line under it of the drawer that a row's button opens. */
    const heading = (table: number, row: number) => {
      goTo(table);
      page.all('#tableWrap tbody [data-act="row"]')[row].press();
      const title = [page.id("drawerTitle").textContent, page.id("drawerSub").textContent];
      page.key("Escape");
      return title;
    };
    // Pages: the page, not the app that every row begins with. Cards: the card's title, not its page.
    expect([heading(1, 0), heading(1, 1)]).toEqual([["Overview", "Row 1 of Pages"], ["Overview (copy)", "Row 2 of Pages"]]);
    expect([heading(2, 1), heading(2, 3)]).toEqual([["Margin", "Row 2 of Cards"], ["Margin, copied", "Row 4 of Cards"]]);
    // The other files: what the row is about. A grid section's source module, an object's name, a button's label.
    expect([heading(3, 2), heading(4, 1), heading(5, 0)]).toEqual([["REP02 Gone", "Row 3 of Grid Sections"], ["REP09 Copy", "Row 2 of Where Used"], ["Reload plan", "Row 1 of Action Buttons"]]);
    // A card without a title, a dash or nothing in its place: the first cell of the row that says something.
    expect([heading(2, 4), heading(2, 5)]).toEqual([["Overview", "Row 5 of Cards"], ["Overview", "Row 6 of Cards"]]);
    // A row no cell of which says anything, only the dash for nothing to say and empty cells, has no name of its own: its
    // drawer is headed by its place in the file.
    expect(heading(5, 1)).toEqual(["Row 2", "Row 2 of Action Buttons"]);
    // A model's rows are named by their first column, as they were.
    page.id("runAgain").press();
    sendResult(ports[0], MODEL);
    expect([heading(1, 2), heading(2, 1)]).toEqual([["Line item 3", "Row 3 of Line Items"], ["Cost", "Row 2 of Modules"]]);
  });

  it("keeps the keyboard inside the open drawer: what lies behind it is inert until it closes, however it closes", async () => {
    await openWith();
    goTo(2);
    /** What lies behind the drawer, each part by whether it is inert: the link that skips to the results, the header, the
     * navigation under it, the banner area and the shell. */
    const behind = () => [page.find(".skip"), page.find(".hd"), page.id("topnav"), page.id("banners"), page.find(".shell")].map(part => part.inert);
    const IN_REACH = [false, false, false, false, false];
    const OUT_OF_REACH = [true, true, true, true, true];
    const rowButton = () => page.all('#tableWrap tbody [data-act="row"]')[0];
    expect(behind()).toEqual(IN_REACH);

    rowButton().press();
    expect(behind()).toEqual(OUT_OF_REACH);
    // Nothing behind the drawer takes the focus, an entry of the navigation neither; the drawer's own controls do, and
    // the drawer has it.
    expect([page.id("tblSearch"), page.id("runAgain"), page.find(".skip"), page.find("#navList .nav-item"), rowButton(), page.id("drawerClose"), page.find("#drawerBody .link")]
      .map(control => control.focusable)).toEqual([false, false, false, false, false, true, true]);
    expect([page.id("drawer").inert, page.document.activeElement === page.id("drawerClose")]).toEqual([false, true]);
    // The message a copied ID gives is not behind the drawer: it is still announced.
    expect([page.id("toast"), page.id("live")].map(part => part.closest("[inert]"))).toEqual([null, null]);

    // Escape: the page takes part again, and the focus is back on the row's button, which can take it again.
    page.key("Escape");
    expect([behind(), page.document.activeElement === rowButton()]).toEqual([IN_REACH, true]);
    // The close button, a click beside the drawer, and a jump from the drawer to a page's cards.
    rowButton().press();
    page.id("drawerClose").press();
    expect(behind()).toEqual(IN_REACH);
    rowButton().press();
    page.id("scrim").press();
    expect(behind()).toEqual(IN_REACH);
    rowButton().press();
    page.find('#drawerBody [data-act="page"]').press();
    expect([behind(), page.texts("#pageFilter")]).toEqual([IN_REACH, ["Page: Overview"]]);
    // The jump draws the view anew, so what opened the drawer is gone: the focus is on the view, not left in the drawer.
    expect(page.document.activeElement).toBe(page.id("view"));
    vi.advanceTimersByTime(210);
    expect([page.id("drawer").hidden, page.document.activeElement === page.id("view")]).toEqual([true, true]);
    // A card's drawer is the same drawer.
    page.find('#tableWrap tbody [data-act="card"]').press();
    expect(behind()).toEqual(OUT_OF_REACH);
    // A new result that takes the page while the drawer is open closes it, and the page takes part again.
    page.id("drawerClose").press();
    page.id("runAgain").press();
    page.find('#tableWrap tbody [data-act="card"]').press();
    expect(behind()).toEqual(OUT_OF_REACH);
    sendResult(ports[0]);
    expect([behind(), page.id("drawer").classList.contains("show"), page.texts("#view h1")]).toEqual([IN_REACH, false, ["Overview"]]);
  });

  it("goes down the page's headings one level at a time, in every view and in the drawer", async () => {
    await openWith();
    /** The levels of the headings inside a part of the page, in the order they stand. */
    const levels = (part: string) => page.all(`${part} h1, ${part} h2, ${part} h3, ${part} h4, ${part} h5, ${part} h6`).map(heading => Number(heading.localName[1]));
    // The overview: the view's heading, then its panels and sections one level under it, the one that starts closed too.
    expect([levels("#main"), page.texts("#main h2")]).toEqual([[1, 2, 2, 2], ["About this export", "Notes", "Diagnostics"]]);
    // A table has its one heading. The drawer's own heading is an h2, and its sections stand one level under that.
    goTo(2);
    expect(levels("#main")).toEqual([1]);
    page.find('#tableWrap tbody [data-act="card"]').press();
    expect([levels("#drawer"), page.texts("#drawer h3")]).toEqual([[2, 3], ["Card details"]]);
  });

  it("says on each button that opens a popover whether its popover is open, and says what the popover is", async () => {
    await openWith();
    goTo(2);
    /** The buttons whose popover is said to be open, by the column they filter or by their ID. */
    const open = () => page.all("[data-colfilter], #colBtn").filter(button => button.getAttribute("aria-expanded") === "true").map(button => button.dataset.colfilter ?? button.id);
    const said = () => page.all("[data-colfilter], #colBtn").map(button => button.getAttribute("aria-expanded"));
    expect([open(), new Set(said())]).toEqual([[], new Set(["false"])]);
    page.find('[data-colfilter="3"]').press();
    expect([open(), page.id("popover").getAttribute("aria-label")]).toEqual([["3"], "Filter: Card type"]);
    // A ticked box writes the table's head again, with the popover still open over it: the new button says so too, and
    // says, not by its colour alone, that its filter is in force.
    page.all("#popover input")[0].tick();
    const button = page.find('[data-colfilter="3"]');
    expect([open(), button.getAttribute("aria-label"), button.title, button.querySelector("svg")?.getAttribute("fill")]).toEqual([["3"], "Filter by Card type (filter on)", "Filter by Card type (filter on)", "currentColor"]);
    expect([page.find('[data-colfilter="0"]').getAttribute("aria-label"), page.find('[data-colfilter="0"] svg').getAttribute("fill")]).toEqual(["Filter by Page", "none"]);
    page.key("Escape");
    expect([open(), new Set(said())]).toEqual([[], new Set(["false"])]);
    // The column chooser, closed by a click elsewhere.
    page.id("colBtn").press();
    expect([open(), page.id("popover").getAttribute("aria-label")]).toEqual([["colBtn"], "Show or hide columns"]);
    page.find('[data-colfilter="0"]').press();
    expect([open(), page.id("popover").getAttribute("aria-label")]).toEqual([["0"], "Filter: Page"]);
    page.id("tblSearch").press();
    expect(open()).toEqual([]);
  });

  it("gives the focus back to the button that opened a popover when the popover closes itself", async () => {
    await openWith();
    goTo(2);
    const active = () => page.document.activeElement;
    // Escape, in a column's filter and in the column chooser.
    page.find('[data-colfilter="3"]').press();
    expect([page.id("popover").hidden, page.id("popover").contains(active())]).toEqual([false, true]);
    page.key("Escape");
    expect([page.id("popover").hidden, active() === page.find('[data-colfilter="3"]')]).toEqual([true, true]);
    page.id("colBtn").press();
    page.key("Escape");
    expect([page.id("popover").hidden, active() === page.id("colBtn")]).toEqual([true, true]);

    // A box ticked in the filter draws the table's head again, the filter's button with it: the popover stays open with
    // the focus in it, and Escape then finds the button as it stands now.
    page.find('[data-colfilter="3"]').press();
    const before = page.find('[data-colfilter="3"]');
    page.all("#popover input")[0].tick();
    expect([firstCells(), page.id("popover").hidden, page.id("popover").contains(active()), before.isConnected]).toEqual([["Overview"], false, true, false]);
    page.key("Escape");
    expect(active()).toBe(page.find('[data-colfilter="3"]'));
    // The button that opened the popover also closes it, written again or not.
    page.find('[data-colfilter="3"]').press();
    page.find('[data-colfilter="3"]').press();
    expect(page.id("popover").hidden).toBe(true);

    // The popover's own buttons close it: Show all and Defaults.
    page.find('[data-colfilter="3"]').press();
    page.find('#popover [data-popact="all"]').press();
    expect([page.id("popover").hidden, active() === page.find('[data-colfilter="3"]'), firstCells().length]).toEqual([true, true, 2]);
    page.id("colBtn").press();
    page.find('#popover [data-popact="defaults"]').press();
    expect([page.id("popover").hidden, active() === page.id("colBtn")]).toEqual([true, true]);

    // A click elsewhere closes it too, and the focus stays where the click put it.
    page.id("colBtn").press();
    page.id("tblSearch").press();
    expect([page.id("popover").hidden, active() === page.id("tblSearch")]).toEqual([true, true]);
  });

  it("lists the calendar's rows only in a model's Model Calendar table and says so, with the model's facts on the overview", async () => {
    await openWith(WITH_CALENDAR);
    const file = WITH_CALENDAR.tables[3];
    expect([file.rows.length, file.rows.filter(row => row[0] === "Model").length]).toEqual([31, 5]);
    // The overview: the file's tile counts the rows its table lists. What the file says about the model stands with what
    // the Details file says about the export, after it, and without the model's name, which that has said.
    expect(page.all("#view .stat").map(tile => tile.children.map(child => child.textContent))).toEqual([["Model Calendar", "5", "rows", "31 rows in all"], ["Modules", "2", "rows"], ["Line Items", "120", "rows"]]);
    expect([page.texts("#ovAbout h2"), page.texts("#ovAbout dt"), page.texts("#ovAbout dd")])
      .toEqual([["About this export"], ["Model", "Anaplan host", "Workspace", "Captured on"], ["Model one", "us1a.app.anaplan.com", "Main", "2026-10-03"]]);
    // The navigation lists the same tables in the same order, and counts nothing: the tiles count the rows.
    expect(tableEntries().map(entryLabel)).toEqual(["Model Calendar", "Modules", "Line Items"]);

    // The table: the calendar's settings that hold a value, none of the rows about the model, and a line that says where
    // those are and how many settings have no value. The template's guidance for filling it in by hand is not shown.
    goTo(3);
    const settings = () => page.all("#tableWrap tbody tr").map(row => row.children[1].textContent.trim());
    expect([page.texts("#view .view-note"), page.id("rowCount").textContent, page.id("live").textContent])
      .toEqual([[CALENDAR_NOTE], "1–5 of 5 rows", "Model Calendar: 5 rows"]);
    expect([firstCells().every(section => section === "Model Calendar"), settings(), settings().filter(setting => ["Workspace", "Model", "Captured on"].includes(setting))])
      .toEqual([true, ["Calendar Type", "Fiscal Year Starts", "Number of Past Years", "Number of Future Years", "Include Quarter Totals"], []]);
    expect(page.all("#tableWrap thead th").map(cell => cell.textContent.trim()).filter(text => ["Applies to", "Notes"].includes(text))).toEqual([]);
    // The search reads the rows listed and no others: the calendar's type finds its row, the model's name finds none.
    const note = page.find("#view .view-note");
    page.id("tblSearch").type("quarters");
    expect([settings(), page.id("rowCount").textContent]).toEqual([["Calendar Type"], "1–1 of 1 row (filtered from 5)"]);
    page.id("tblSearch").type("Model one");
    expect([settings(), page.id("rowCount").textContent]).toEqual([[], "No rows (filtered from 5)"]);
    page.id("tblSearch").type("");
    // The line under the name was not written again meanwhile. Section holds one text in the rows listed: it offers no filter.
    expect([page.find("#view .view-note") === note, filterable().includes("Section")]).toEqual([true, false]);
    // A row's drawer says its place among the rows the table lists.
    page.all('#tableWrap tbody [data-act="row"]')[0].press();
    expect([page.id("drawerSub").textContent, page.texts("#drawerBody dd").slice(0, 3)]).toEqual(["Row 1 of Model Calendar", ["Model Calendar", "Calendar Type", "Calendar Months/Quarters/Years"]]);
    page.key("Escape");

    // The page's own table is whole, the rows about the model first: a model's map is built from the result's tables.
    page.find('#navList [data-nav="map"]').press();
    expect([mapBuilds.length, mapBuilds[0].tables]).toEqual([1, WITH_CALENDAR.tables]);

    // Another table lists every row of its file, and says nothing under its name.
    goTo(1);
    expect([page.all("#view .view-note").length, page.id("rowCount").textContent]).toEqual([0, "1–50 of 120 rows"]);
  });

  it("says of a Model Calendar whose every row is about the model that it has no rows of its own, not that nothing was found", async () => {
    // The calendar's settings could not be read: the file has the template's five rows about the model, and no other.
    const file = WITH_CALENDAR.tables[3];
    const only: AnalysisResult = { ...WITH_CALENDAR, tables: [...WITH_CALENDAR.tables.slice(0, 3), { ...file, rows: file.rows.slice(0, 5) }] };
    await openWith(only);
    // The tile counts the rows the table lists, none, and says the five there are in all. The table keeps its entry in the
    // navigation.
    expect(page.all("#view .stat")[0].children.map(child => child.textContent)).toEqual(["Model Calendar", "0", "rows", "5 rows in all"]);
    expect(entryLabel(page.find('#navList [data-nav="3"]'))).toBe("Model Calendar");
    goTo(3);
    // The line under the name says where the five rows are. In the rows' place the table says that none is the calendar's
    // own, which does not contradict it; "Nothing was found" would.
    expect([page.texts("#view .view-note"), page.texts("#tableWrap .e-title"), page.texts("#tableWrap .e-sub"), page.id("rowCount").textContent])
      .toEqual([["5 rows about the model are not listed here: 3 hold a value, which the Overview has under About this export."], ["Model Calendar has no rows of its own"], ["Every row is about the model."], "No rows"]);
    expect([page.id("view").textContent.includes("Nothing was found"), page.all("#tableWrap tbody tr").length, page.id("pager").children]).toEqual([false, 0, []]);
    // The page's own table has the five rows still: a model's map is built from the result's tables.
    page.find('#navList [data-nav="map"]').press();
    expect([mapBuilds.length, mapBuilds[0].tables]).toEqual([1, only.tables]);
    // A file without rows at all says, as ever, that nothing was found for it.
    page.id("runAgain").press();
    sendResult(ports[0], { ...WITH_CALENDAR, tables: [...WITH_CALENDAR.tables.slice(0, 3), { ...file, rows: [] }] });
    goTo(3);
    expect([page.all("#view .view-note").length, page.texts("#tableWrap .e-title"), page.texts("#tableWrap .e-sub")])
      .toEqual([0, ["Model Calendar has no rows"], ["Nothing was found for this table in this analysis."]]);
  });

  it("shows no Notes panel for a model whose summary only says how many rows each file has", async () => {
    await openWith(MODEL);
    expect([page.texts("#view h1"), page.texts("#view .s-lab"), page.has("#view .warn-list"), page.id("banners").children]).toEqual([["Overview"], ["Modules", "Line Items"], false, []]);
    // A model's tiles carry its files' own names; the navigation does too, in the same order.
    expect(tableEntries().map(entryLabel)).toEqual(["Modules", "Line Items"]);
    // A table's view has no notes either: they are on the overview only.
    goTo(1);
    expect([page.has(".warn-list"), page.id("banners").children]).toEqual([false, []]);
  });

  it("says so when the address names no tab, and connects to nothing", async () => {
    await open("");
    expect(connects).toEqual([]);
    expect([page.id("runTitle").textContent, page.id("runStatus").textContent]).toEqual(["No Anaplan tab", "This page was opened without an Anaplan tab to read."]);
    expect([page.id("runAgain").disabled, runControl().slice(0, 2)]).toEqual([true, ["Run", "Analyse the Anaplan tab"]]);
    page.id("runAgain").press();
    expect(connects).toEqual([]);
    // The same when the icon's click is in the address but no tab that can be read: no analysis was asked for, so the
    // control, which is off, does not say "again".
    for (const search of [`?opened=${NOW.getTime() - 1500}`, `?tab=x&opened=${NOW.getTime() - 1500}`]) {
      await open(search);
      expect([connects, page.id("runTitle").textContent, page.id("runAgain").disabled, runControl().slice(0, 2)], search).toEqual([[], "No Anaplan tab", true, ["Run", "Analyse the Anaplan tab"]]);
    }
  });

  it("says it cannot reach the tab when Chrome closes the port at once, with Chrome's reason in the log, and reconnects on Run again", async () => {
    await open(clicked(7));
    lastError = { message: "Could not establish connection. Receiving end does not exist." };
    ports[0].drop();
    lastError = undefined;
    await neverAnswers();
    expect([page.id("runStatus").textContent, page.id("runHint").textContent]).toEqual(["Cardigan cannot reach that tab.", "If it is an Anaplan app or model that is still loading, wait for it, then choose Run again. Otherwise refresh it, then click the Cardigan icon on it."]);
    // The first try's reason, and a count of the tries after it.
    expect(page.id("diagLog").textContent).toBe("14:02:05 The tab did not answer: Could not establish connection. Receiving end does not exist.\n14:02:10 No answer after 10 more tries.");
    expect(page.id("runAgain").disabled).toBe(false);
    expect(connects).toHaveLength(11);
    page.id("runAgain").press();
    expect(connects).toHaveLength(12);
    expect(new Set(connects.map(args => JSON.stringify(args)))).toEqual(new Set([JSON.stringify([7, { name: PORT_NAME }])]));
  });

  it("says a closed Anaplan tab is closed, at once", async () => {
    await open(clicked(7));
    tabClosed = true;
    lastError = { message: NO_RECEIVER };
    ports[0].drop();
    lastError = undefined;
    await settle();
    expect([page.id("runTitle").textContent, page.id("runStatus").textContent, page.id("runHint").textContent, connects.length]).toEqual(
      ["Tab closed", "The Anaplan tab this page was opened for has been closed.", "Open the app or model in Anaplan again, then click the Cardigan icon on that tab.", 1]);
  });

  it("shows a failed run's message as it is, with nothing of the page's own under it, and the button that copies its log beside it", async () => {
    await open(clicked(42));
    ports[0].send({ type: "subject", subject: { kind: "app", id: RESULT.id } });
    ports[0].send({ type: "log", text: `14:02:05 Cardigan dev: app ${RESULT.id} on us1a.app.anaplan.com` });
    ports[0].send({ type: "log", text: "14:02:06 stopped: GET /a/springboard-definition-service/apps 503" });
    const message = "Anaplan could not be reached. Check your connection, then choose Run again. If it keeps happening, choose Copy diagnostic log and send the log.";
    ports[0].send({ type: "error", message });
    expect([page.id("runTitle").textContent, page.id("runStatus").textContent, page.id("runHint").textContent, page.id("runHint").hidden]).toEqual(["The analysis stopped", message, "", true]);
    // The two controls the message names are there, and read exactly as it names them.
    const copy = page.find('#view [data-act="copy-run-log"]');
    expect([runControl()[0], page.id("runAgain").disabled, copy.textContent.trim(), page.id("runLog").hidden]).toEqual(["Run again", false, "Copy diagnostic log", false]);
    copy.press();
    await settle();
    expect(copied).toEqual([`14:02:05 Cardigan dev: app ${RESULT.id} on us1a.app.anaplan.com\n14:02:06 stopped: GET /a/springboard-definition-service/apps 503`]);

    // A result the page cannot read is the page's own failure: its log says what did not fit, so there is a log to copy.
    page.id("runAgain").press();
    ports[0].send({ type: "done" });
    expect([page.id("runStatus").textContent, page.id("runHint").hidden, page.id("runLog").hidden, page.id("diagLog").textContent]).toEqual([
      "Cardigan received a result it could not read. Refresh the Anaplan tab, then click the Cardigan icon again.", true, false,
      "14:02:05 stopped: the tab said its result was complete before it sent one"]);
    // An error the tab sends without having started a run comes without a log: the page writes the one line, so the
    // button is beside this message too.
    page.id("runAgain").press();
    const busy = "Cardigan is still analysing what this Anaplan tab showed before. Wait for that to finish, or close its results page, then choose Run again.";
    ports[0].send({ type: "error", message: busy });
    expect([page.id("runStatus").textContent, page.id("runLog").hidden, page.id("diagLog").textContent, page.has('#view [data-act="copy-run-log"]')]).toEqual([busy, false, `14:02:05 stopped: ${busy}`, true]);
  });

  it("shows the tab's error as text, and keeps Run again usable on an Anaplan page that is not an app or a model", async () => {
    await open(clicked(42));
    ports[0].send({ type: "subject", subject: { kind: "none" } });
    expect(page.id("runStatus").textContent).toBe("That Anaplan page is not an app or a model.");
    expect(page.id("runAgain").disabled).toBe(false);
    page.id("runAgain").press();
    expect(connects).toHaveLength(2);
    ports[1].send({ type: "subject", subject: { kind: "model", id: "0123456789ABCDEF0123456789ABCDEF" } });
    ports[1].send({ type: "error", message: "You're signed out of <b>Anaplan</b>. Sign in and try again.", code: "SIGNED_OUT" });
    expect([page.id("runTitle").textContent, page.id("runStatus").textContent]).toEqual(["The analysis stopped", "You're signed out of <b>Anaplan</b>. Sign in and try again."]);
    // The message was set as text, not written into the page's markup: its tag is no element.
    expect(page.has("#view b")).toBe(false);
  });
});

describe("A model tab that still holds the reader of an earlier Cardigan", () => {
  const SUBJECT = { kind: "model", id: "0123456789ABCDEF0123456789ABCDEF", origin: "https://us1a.app.anaplan.com", customer: "0123456789abcdef0123456789abcdef" } as const;
  const STALE = "This Anaplan tab was open before Cardigan was updated or reloaded, and still holds the earlier Cardigan's model reader.";
  /** The tab says a run found the reader of an earlier build: its log's line, then the error with its code. */
  const stale = (port: FakePort, renewable: boolean) => {
    port.send({ type: "log", text: "14:02:05 stopped: the model's reader is build 0a1b2c3d4e5f; this script is build dev" });
    port.send({ type: "error", message: `${STALE} Refresh the Anaplan tab, wait until the model shows, then choose Run again.`, code: "OLD_READER", renewable });
  };
  const READER = { target: { tabId: 42, allFrames: true }, files: ["dist/model-export.js"], world: "MAIN" };

  it("puts its reader into the tab's frames where it can, and otherwise offers the one button that refreshes the tab, which only a click presses", async () => {
    await open(clicked(42));
    ports[0].send({ type: "subject", subject: SUBJECT });
    // The model's frame is on the page's own origin: the page asks Chrome to put this build's reader into every frame it
    // may reach, in the page's world. Chrome refuses here, so the tab needs a refresh.
    stale(ports[0], true);
    await settle();
    expect(injected).toEqual([READER]);
    const button = page.id("runRefresh");
    expect([page.id("runTitle").textContent, page.id("runStatus").textContent, page.id("runHint").textContent, button.hidden, button.textContent.trim()]).toEqual([
      "The Anaplan tab needs a refresh", `${STALE} Cardigan could not put its new reader into the open page.`,
      "Choose Refresh the Anaplan tab and run: the tab reloads, and Cardigan reads the model as soon as it shows. The refresh closes the modules and lists you have open in Model Building.",
      false, "Refresh the Anaplan tab and run"]);
    expect(page.id("diagLog").textContent.split("\n").at(-1)).toBe(
      "14:02:05 Cardigan could not put its model reader into the tab: Cannot access contents of the page. Extension manifest must request permission to access the respective host.");
    // Nothing refreshes the tab by itself, however long the page waits, and Run again tries the reader once more.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(tabReloads).toEqual([]);
    page.id("runAgain").press();
    stale(ports[0], false);
    await settle();
    expect([injected.length, page.id("runStatus").textContent]).toEqual([1,
      `${STALE} The model is served from another Anaplan host than the page around it, where Chrome lets Cardigan put its new reader only when the tab is refreshed.`]);

    // The click: the tab is refreshed, and once it has loaded the page connects again and reads the model, waiting for its
    // frame as long as a model takes to open again.
    button.press();
    await settle();
    expect([tabReloads, page.id("runStatus").textContent, button.hidden]).toEqual([[42], "Refreshing the Anaplan tab…", true]);
    await vi.advanceTimersByTimeAsync(500);
    expect(connects).toHaveLength(2);
    ports[1].send({ type: "subject", subject: SUBJECT });
    expect(ports[1].posted).toEqual([{ type: "run", afterRefresh: true }]);
    expect(page.id("diagLog").textContent).toContain("Refreshing the Anaplan tab, as asked, so that it loads this build's model reader.");
  });

  it("offers the same button above an earlier result, in the banner, and hides it again once a run goes on", async () => {
    await open(clicked(42));
    ports[0].send({ type: "subject", subject: { kind: "app", id: RESULT.id } });
    sendResult(ports[0]);
    page.id("runAgain").press();
    stale(ports[0], false);
    await settle();
    expect([banner(), page.id("bannerRefresh").hidden]).toEqual([["warn", "The Anaplan tab needs a refresh",
      `${STALE} The model is served from another Anaplan host than the page around it, where Chrome lets Cardigan put its new reader only when the tab is refreshed.`,
      "Choose Refresh the Anaplan tab and run: the tab reloads, and Cardigan reads the model as soon as it shows. The refresh closes the modules and lists you have open in Model Building."], false]);
    expect(injected).toEqual([]);
    page.id("runAgain").press();
    expect(page.id("bannerRefresh").hidden).toBe(true);
    expect(tabReloads).toEqual([]);
  });
});

describe("What a click, a key and typing do on the results page", () => {
  const drawerShown = () => page.id("drawer").classList.contains("show");
  /** What the view and the navigation each say is shown: the view's heading, and the words of the entry marked as current. */
  const shows = () => [page.texts("#view h1")[0], page.texts('#navList [aria-current="page"] span')[0]];
  /** The headings of the columns on screen. */
  const headings = () => page.all("#tableWrap thead .th-sort").map(button => button.textContent.trim().replace(/[▲▼]$/, ""));
  /** The rows on screen, by the text of one column, which is named by its heading. */
  const column = (heading: string) => page.all("#tableWrap tbody tr").map(row => row.children[headings().indexOf(heading)].textContent.trim());
  /** The links of the rows on screen that open a card. In the Cards table that is each row's title; a card's number is
   * one too, in the tables that have it, once the column is shown. */
  const cardLinks = () => page.all('#tableWrap tbody [data-act="card"]');
  /** Ticks or unticks a column in the chooser, by its name, and closes the chooser. */
  const toggleColumn = (name: string) => {
    page.id("colBtn").press();
    page.all("#popover .pop-opt").find(option => option.children[1].textContent === name)?.children[0].tick();
    page.key("Escape");
  };

  it("opens the table the navigation names, and the overview; an app's navigation is in the result's order, without a Details entry or a model map", async () => {
    await openWith(APP);
    expect(shows()).toEqual(["Overview", "Overview"]);
    expect([page.all("#navList .nav-item").map(entryLabel), page.has('#navList [data-nav="map"]'), page.texts("#view .s-lab")])
      .toEqual([["Overview", "Pages", "Cards", "Grid Sections", "Where Used"], false, ["Pages", "Cards", "Grid sections", "Model objects"]]);
    for (const [table, label, rows] of [[1, "Pages", 2], [2, "Cards", 4], [3, "Grid Sections", 3], [4, "Where Used", 2]] as const) {
      goTo(table);
      expect([shows(), firstCells().length]).toEqual([[label, label], rows]);
    }
    // The navigation's Overview goes back to the overview.
    page.find('#navList [data-nav="overview"]').press();
    expect(shows()).toEqual(["Overview", "Overview"]);
    // There is no Details view. A link that still names it, as the navigation's entry did, leads to the overview, which
    // holds what that view held; so does any name that is not a file's place.
    goTo(2);
    page.id("banners").innerHTML = '<button type="button" data-nav="details">Details</button><button type="button" data-nav="nowhere">Nowhere</button>';
    page.find('#banners [data-nav="details"]').press();
    expect([shows(), page.has("#tableWrap"), page.texts("#view h2").slice(0, 1), page.document.activeElement === page.id("view")]).toEqual([["Overview", "Overview"], false, ["About this export"], true]);
    goTo(2);
    page.find('#banners [data-nav="nowhere"]').press();
    expect(shows()).toEqual(["Overview", "Overview"]);
  });

  it("shows a model's Line Items table with every row, each with its module and the dimensions it has, a module's own row as a heading; the counts are the file's", async () => {
    await openWith(BLUEPRINT);
    // The overview's tile counts every row of the file, as Anaplan's grid does: the modules' own rows are in the table.
    expect(page.all("#view .stat").map(tile => tile.children.map(child => child.textContent))).toEqual([["Modules", "3", "rows"], ["Line Items", "8", "rows"]]);

    goTo(1);
    // The module stands directly after the name, the format's data type after Format, and after Applies To where it came
    // from; the other columns are in the file's order.
    expect(headings()).toEqual(["Name", "Module Name", "Format", "Format type", "Formula", "Summary", "Applies To", "Applies To from", "Ratio Numerator", "Ratio Denominator"]);
    expect([column("Name"), column("Module Name")]).toEqual([["REV01 Revenue", "Units", "Price", "Revenue", "Margin %", "--- Archive ---", "COST01 Costs", "Cost"],
      ["REV01 Revenue", "REV01 Revenue", "REV01 Revenue", "REV01 Revenue", "REV01 Revenue", "--- Archive ---", "COST01 Costs", "COST01 Costs"]]);
    // A dash in the file is the module's Applies To here; a line item's own stays its own. A module's own row has its own.
    expect([column("Applies To"), column("Applies To from")]).toEqual([["Products, Time", "Products, Time", "Products", "Products, Time", "Products, Time", "", "Cost Centres", "Cost Centres"],
      ["Module", "Module", "Line item", "Module", "Module", "Module", "Module", "Module"]]);
    // A module's own row has no format, and stands out as a heading above its line items.
    expect([column("Format type"), page.all("#tableWrap tbody tr").map(row => row.classList.contains("heading"))])
      .toEqual([["", "Number", "Number", "Number", "Number", "", "", "Number"], [true, false, false, false, false, true, true, false]]);
    // The line under the table's name says what the rows are, and how to list the line items alone.
    expect([page.texts("#view .view-note"), page.id("rowCount").textContent, page.id("live").textContent]).toEqual([["Every row of Anaplan's Line Items grid: 5 line items, and 3 modules' own rows, each in bold above its line items, with its own name under Module Name. To list only line items, untick (blank) in the filter of Format type, and No Data as well to leave out the line items that are headings."], "1–8 of 8 rows", "Line Items: 8 rows"]);

    // The search, the filters and the sort are the table's: a module's name finds its own row and its line items.
    page.id("tblSearch").type("cost01");
    expect([column("Name"), page.id("rowCount").textContent]).toEqual([["COST01 Costs", "Cost"], "1–2 of 2 rows (filtered from 8)"]);
    page.id("tblSearch").type("archive");
    expect([column("Name"), page.id("rowCount").textContent]).toEqual([["--- Archive ---"], "1–1 of 1 row (filtered from 8)"]);
    page.id("tblSearch").type("");
    expect(filterable()).toEqual(expect.arrayContaining(["Module Name", "Format type", "Applies To from"]));
    page.find('[data-colfilter="7"]').press();
    expect(choices()).toEqual([["Line item", "1", true], ["Module", "7", true]]);
    page.all("#popover input")[1].tick();
    expect(column("Name")).toEqual(["Price"]);
    page.key("Escape");
    page.id("resetBtn").press();
    // The filter on the format's data type lists the modules' own rows as blanks: without them, the line items alone.
    page.find('[data-colfilter="3"]').press();
    expect(choices()).toEqual([["(blank)", "3", true], ["Number", "5", true]]);
    page.all("#popover input")[0].tick();
    expect([column("Name"), page.id("rowCount").textContent]).toEqual([["Units", "Price", "Revenue", "Margin %", "Cost"], "1–5 of 5 rows (filtered from 8)"]);
    expect(page.all("#tableWrap tbody tr").some(row => row.classList.contains("heading"))).toBe(false);
    page.key("Escape");
    page.id("resetBtn").press();
    // A sort by module keeps each module's own row with its line items, above them.
    page.find('[data-sort="1"]').press();
    expect(column("Name")).toEqual(["--- Archive ---", "COST01 Costs", "Cost", "REV01 Revenue", "Units", "Price", "Revenue", "Margin %"]);
    // A row's drawer is headed by the row's name and says its place among the table's rows; it holds the view's columns.
    page.all('#tableWrap tbody [data-act="row"]')[2].press();
    expect([page.id("drawerTitle").textContent, page.id("drawerSub").textContent, page.texts("#drawerBody dt").slice(0, 2), page.texts("#drawerBody dd").slice(0, 2)])
      .toEqual(["Cost", "Row 8 of Line Items", ["Name", "Module Name"], ["Cost", "COST01 Costs"]]);
    page.key("Escape");
    page.all('#tableWrap tbody [data-act="row"]')[1].press();
    expect([page.id("drawerTitle").textContent, page.id("drawerSub").textContent, page.texts("#drawerBody dd").slice(0, 2)])
      .toEqual(["COST01 Costs", "Row 7 of Line Items", ["COST01 Costs", "COST01 Costs"]]);
    page.key("Escape");

    // The page's own table is the file as the export wrote it, with the modules' rows, the dashes and the file's own
    // columns: a model's map is built from the result's tables.
    page.find('#navList [data-nav="map"]').press();
    expect([mapBuilds.length, mapBuilds[0].tables]).toEqual([1, BLUEPRINT.tables]);

    // The Modules table is the Modules file as it stands, and an app's file of the same name and layout is too.
    goTo(2);
    expect([headings(), page.all("#view .view-note").length, page.id("rowCount").textContent]).toEqual([["Name", "Applies To"], 0, "1–3 of 3 rows"]);
    page.id("runAgain").press();
    sendResult(ports[0], { ...BLUEPRINT, kind: "app" });
    // As an app's, the files are listed in the result's order, and their tiles count their own rows.
    expect([tableEntries().map(entryLabel), page.all("#view .stat").map(tile => tile.children.map(child => child.textContent))])
      .toEqual([["Line Items", "Modules"], [["Line Items", "8", "rows"], ["Modules", "3", "rows"]]]);
    goTo(1);
    expect([headings(), column("Name").slice(0, 2), column("Applies To").slice(0, 2), page.all("#view .view-note").length, page.id("rowCount").textContent])
      .toEqual([["Name", "Format", "Formula", "Summary", "Applies To", "Module Name", "Ratio Numerator", "Ratio Denominator"], ["REV01 Revenue", "Units"], ["Products, Time", "-"], 0, "1–8 of 8 rows"]);
  });

  it("shows a model's counts with their thousands apart, right-aligned, sorted by their numbers and found with or without commas, and keeps the result as it was", async () => {
    const counted: AnalysisResult = { ...MODEL, summary: ["Modules: 4 rows", "General Lists: 2 rows"], tables: [MODEL.tables[0],
      { ...MODEL.tables[1], headers: [...MODEL.tables[1].headers, "Cell Count"], rows: LINES.map((row, index) => [...row, String(index * 123457)]) },
      { file: "Modules.csv", label: "Modules", headers: ["", "Functional Area", "Cell Count"], guard: false,
        rows: [["Revenue", "Sales", "15389009578"], ["Cost", "Finance", "2252068"], ["Settings", "Admin", "12"], ["Archive", "", ""]] },
      { file: "General Lists.csv", label: "General Lists", headers: ["", "Item Count", "Code"], guard: false, rows: [["Products", "1204", "1204"], ["Regions", "40", "0040"]] }] };
    await openWith(counted);
    goTo(2);
    const cells = (heading: string) => page.all("#tableWrap tbody tr").map(row => row.children[headings().indexOf(heading)]);
    expect([column("Name"), column("Cell Count"), cells("Cell Count").every(cell => cell.classList.contains("num")), cells("Functional Area").some(cell => cell.classList.contains("num"))])
      .toEqual([["Revenue", "Cost", "Settings", "Archive"], ["15,389,009,578", "2,252,068", "12", ""], true, false]);
    // A count sorts by its number, an empty one first, and shows its commas in either order.
    page.find('[data-sort="2"]').press();
    expect([column("Name"), column("Cell Count")]).toEqual([["Archive", "Settings", "Cost", "Revenue"], ["", "12", "2,252,068", "15,389,009,578"]]);
    page.find('[data-sort="2"]').press();
    expect(column("Name")).toEqual(["Revenue", "Cost", "Settings", "Archive"]);
    // The search finds a count as it is shown, with its commas, and as the user may type it, without them.
    for (const [search, found] of [["15,389", ["Revenue"]], ["15389", ["Revenue"]], ["2,252,068", ["Cost"]], ["2252", ["Cost"]], ["389,009,5", ["Revenue"]], ["52,0", ["Cost"]], ["38,900", []]] as const) {
      page.id("tblSearch").type(search);
      expect(column("Name"), search).toEqual(found);
    }
    page.id("tblSearch").type("");
    // The column's filter lists the counts as they are shown, and the row's drawer shows its count so as well.
    page.find('[data-colfilter="2"]').press();
    expect(choices().map(([value]) => value)).toEqual(["(blank)", "12", "2,252,068", "15,389,009,578"]);
    page.all("#popover input")[0].tick();
    expect(column("Name")).toEqual(["Revenue", "Cost", "Settings"]);
    page.key("Escape");
    page.all('#tableWrap tbody [data-act="row"]')[0].press();
    expect([page.id("drawerTitle").textContent, page.texts("#drawerBody dd")]).toEqual(["Revenue", ["Revenue", "Sales", "15,389,009,578"]]);
    page.key("Escape");
    // General Lists counts its items; a code of figures beside it is no count, and shows as it is.
    goTo(3);
    expect([column("Item Count"), column("Code"), cells("Code").some(cell => cell.classList.contains("num"))]).toEqual([["1,204", "40"], ["1204", "0040"], false]);
    // Line Items counts its cells.
    goTo(1);
    expect(column("Cell Count").slice(0, 3)).toEqual(["0", "123,457", "246,914"]);
    // What the page shows is its own: the result's tables hold their counts as they were read, as the map is given them.
    page.find('#navList [data-nav="map"]').press();
    expect(mapBuilds[0].tables).toEqual(counted.tables);
  });

  it("shows a model's Dynamic Cell Access right after its Line Items, as the file stands, under a line that says what it lists and how many drivers could not be matched", async () => {
    await openWith(WITH_ACCESS);
    const file = WITH_ACCESS.tables[2];
    // The navigation has it after Line Items, where Anaplan's own order has no such entry, and the overview has its tile
    // there too, which counts the file's rows: the table lists every one.
    expect(page.all("#navList .nav-item").map(entryLabel)).toEqual(["Overview", "Modules", "Line Items", "Dynamic Cell Access", "Model map"]);
    expect(page.all("#view .stat").map(tile => tile.children.map(child => child.textContent))).toEqual([["Modules", "3", "rows"], ["Line Items", "8", "rows"], ["Dynamic Cell Access", "5", "rows"]]);

    goTo(2);
    expect(shows()).toEqual(["Dynamic Cell Access", "Dynamic Cell Access"]);
    // The file's own columns, under their own names, and its rows in its own order: the driver first, the one that could
    // not be matched last.
    expect(headings()).toEqual(["Driver Module", "Driver Line Item", "Access", "Controlled Module", "Controlled Line Item"]);
    expect([column("Driver Module"), column("Driver Line Item"), column("Controlled Line Item")]).toEqual([["ACC01 Access", "ACC01 Access", "ACC01 Access", "ACC01 Access", ""],
      ["Can read", "Can read", "Can read", "=Can write", "'Old access'.Flag"], ["Units", "Price", "Cost", "Units", "Cost"]]);
    // Under the table's name, one line: what the table is, and how many of its drivers could not be matched.
    expect([page.texts("#view .view-note"), page.id("rowCount").textContent, page.id("live").textContent]).toEqual([
      ["The Read Access Driver and Write Access Driver columns of Line Items, listed from the driver's side. One row for each use of a driver: the driver, Read or Write, and the line item it controls. "
        + "1 row has a driver that could not be matched to a line item: it comes last, with the driver as Line Items has it and no Driver Module."],
      "1–5 of 5 rows", "Dynamic Cell Access: 5 rows"]);
    // A row opens from its driver's name, the second cell, in every row. The first cell, the driver's module, is the same
    // name down the rows, and is plain text: as the row's button it would read as a way to that module.
    const opens = () => page.all("#tableWrap tbody tr").map(row => row.children.map(cell => cell.querySelector('[data-act="row"]')?.textContent.trim()));
    expect(opens()).toEqual(["Can read", "Can read", "Can read", "=Can write", "'Old access'.Flag"].map(name => [undefined, name, undefined, undefined, undefined]));
    expect(page.all("#tableWrap tbody tr").map(row => row.children[0].querySelectorAll("button").length)).toEqual([0, 0, 0, 0, 0]);

    // It is a table like the model's others. The search finds a driver by its name, and what it controls by its own.
    page.id("tblSearch").type("can read");
    expect([column("Controlled Line Item"), page.id("rowCount").textContent]).toEqual([["Units", "Price", "Cost"], "1–3 of 3 rows (filtered from 5)"]);
    page.id("tblSearch").type("old access");
    expect([column("Driver Line Item"), page.id("rowCount").textContent]).toEqual([["'Old access'.Flag"], "1–1 of 1 row (filtered from 5)"]);
    page.id("tblSearch").type("");
    // Read or Write is a filter, as any column of a few texts is; so are the modules.
    expect(filterable()).toEqual(["Driver Module", "Driver Line Item", "Access", "Controlled Module", "Controlled Line Item"]);
    page.find('[data-colfilter="2"]').press();
    expect(choices()).toEqual([["Read", "3", true], ["Write", "2", true]]);
    page.all("#popover input")[0].tick();
    expect([column("Access"), column("Driver Line Item")]).toEqual([["Write", "Write"], ["=Can write", "'Old access'.Flag"]]);
    page.key("Escape");
    page.id("resetBtn").press();
    // A column's name sorts by it: here by what is controlled, the rows of one line item in the file's order.
    page.find('[data-sort="4"]').press();
    expect([column("Controlled Line Item"), column("Driver Line Item")]).toEqual([["Cost", "Cost", "Price", "Units", "Units"], ["Can read", "'Old access'.Flag", "Can read", "Can read", "=Can write"]]);
    page.id("resetBtn").press();
    // A row opens in full, headed by its driver's name: the line item's, or for a row without a Driver Module the driver
    // as it is written. The focus goes back to the button it was opened from.
    const rowButtons = () => page.all('#tableWrap tbody [data-act="row"]');
    rowButtons()[0].press();
    expect([page.id("drawerTitle").textContent, page.id("drawerSub").textContent, page.texts("#drawerBody dd")]).toEqual(["Can read", "Row 1 of Dynamic Cell Access", ["ACC01 Access", "Can read", "Read", "REV01 Revenue", "Units"]]);
    page.key("Escape");
    expect(page.document.activeElement).toBe(rowButtons()[0]);
    rowButtons()[4].press();
    expect([page.id("drawerTitle").textContent, page.id("drawerSub").textContent, page.texts("#drawerBody dt"), page.texts("#drawerBody dd").slice(1)])
      .toEqual(["'Old access'.Flag", "Row 5 of Dynamic Cell Access", ["Driver Module", "Driver Line Item", "Access", "Controlled Module", "Controlled Line Item"], ["'Old access'.Flag", "Write", "COST01 Costs", "Cost"]]);
    page.key("Escape");
    // With the driver's name hidden, the first column shown opens the row, as in any table: the module, and for the row
    // that has none, a button of its own before the empty cell. The row is still called by its driver.
    page.id("colBtn").press();
    page.all("#popover input")[1].tick();
    page.key("Escape");
    expect([headings(), opens().map(cells => cells[0])]).toEqual([["Driver Module", "Access", "Controlled Module", "Controlled Line Item"], ["ACC01 Access", "ACC01 Access", "ACC01 Access", "ACC01 Access", ""]]);
    rowButtons()[3].press();
    expect(page.id("drawerTitle").textContent).toBe("=Can write");
    page.key("Escape");
    page.id("colBtn").press();
    page.all("#popover input")[1].tick();
    page.key("Escape");
    expect(opens()[0]).toEqual([undefined, "Can read", undefined, undefined, undefined]);

    // The page's own table is the file as the export wrote it, every name as it is, in its place after Line Items: a
    // model's map is built from the result's tables.
    page.find('#navList [data-nav="map"]').press();
    expect([mapBuilds.length, mapBuilds[0].tables]).toEqual([1, WITH_ACCESS.tables]);
    expect(WITH_ACCESS.tables.map(table => table.file)).toEqual(["Model Details.csv", "Line Items.csv", "Dynamic Cell Access.csv", "Modules.csv"]);

    // Another table of the model opens its rows from its first column, as ever: the choice is this file's alone.
    goTo(1);
    expect(page.all("#tableWrap tbody tr").map(row => row.children.map(cell => cell.querySelectorAll('[data-act="row"]').length))[0]).toEqual([1, 0, 0, 0, 0, 0, 0, 0, 0, 0]);

    // A model that drives no access has the file without rows. The line still says what the table would list, and the
    // table says in the rows' place what that means, in the place of the page's sentence for a table without rows.
    page.id("runAgain").press();
    sendResult(ports[0], { ...WITH_ACCESS, tables: WITH_ACCESS.tables.map(table => (table === file ? { ...file, rows: [] } : table)) });
    goTo(2);
    expect([page.texts("#view .view-note"), page.texts("#tableWrap .e-title"), page.texts("#tableWrap .e-sub"), page.id("rowCount").textContent]).toEqual([
      ["The Read Access Driver and Write Access Driver columns of Line Items, listed from the driver's side. One row for each use of a driver: the driver, Read or Write, and the line item it controls."],
      ["Dynamic Cell Access has no rows"], ["No line item in this model has a read or write access driver."], "No rows"]);
    // Any other table without rows says what it said: that nothing was found for it.
    page.id("runAgain").press();
    sendResult(ports[0], { ...WITH_ACCESS, tables: WITH_ACCESS.tables.map(table => (table.file === "Modules.csv" ? { ...table, rows: [] } : table)) });
    goTo(3);
    expect([page.texts("#tableWrap .e-title"), page.texts("#tableWrap .e-sub")]).toEqual([["Modules has no rows"], ["Nothing was found for this table in this analysis."]]);
  });

  it("says a model's Format and Summary in words in the table, for the search, the filter and the sort as well; the row's drawer has the text that was read too", async () => {
    await openWith(BLUEPRINT);
    const file = BLUEPRINT.tables[1];
    goTo(1);
    // The words, as Anaplan says them; a Ratio with the names its own row holds.
    expect([column("Format"), column("Summary")]).toEqual([["", "Number", "Number", "Number", "Number, 2 decimal places, %", "", "", "Number"],
      ["", "Sum", "None", "Sum", "Ratio = Margin / Revenue", "", "", "Sum, Time: Closing Balance"]]);
    // The search reads the words, not the text that was read in their place: a word is found where it is seen.
    page.id("tblSearch").type("closing balance");
    expect([column("Name"), page.id("rowCount").textContent]).toEqual([["Cost"], "1–1 of 1 row (filtered from 8)"]);
    // A common word finds the rows that show it and no others. Every Summary's definition holds "summaryMethod", so the
    // text that was read has "sum" in it in all five line items; three of them show the word.
    page.id("tblSearch").type("sum");
    expect([column("Name"), column("Summary"), page.id("rowCount").textContent])
      .toEqual([["Units", "Revenue", "Cost"], ["Sum", "Sum", "Sum, Time: Closing Balance"], "1–3 of 3 rows (filtered from 8)"]);
    // What only the text that was read holds finds nothing: a definition's keys, its values as the export writes them, its true and false.
    for (const word of ["summaryMethod", "CLOSING_BALANCE", "percentage", "decimalPlaces", "false"]) {
      page.id("tblSearch").type(word);
      expect(page.id("rowCount").textContent, word).toBe("No rows (filtered from 8)");
    }
    page.id("tblSearch").type("");
    // The Summary column's filter lists the words, each with its rows, and the modules' own rows, which have none, as blanks.
    page.find('[data-colfilter="5"]').press();
    expect(choices()).toEqual([["(blank)", "3", true], ["None", "1", true], ["Ratio = Margin / Revenue", "1", true], ["Sum", "2", true], ["Sum, Time: Closing Balance", "1", true]]);
    page.all("#popover input")[3].tick();
    expect([column("Name"), page.id("rowCount").textContent]).toEqual([["REV01 Revenue", "Price", "Margin %", "--- Archive ---", "COST01 Costs", "Cost"], "1–6 of 6 rows (filtered from 8)"]);
    page.key("Escape");
    page.id("resetBtn").press();
    // The sort is by the words: descending by Format, the one format that says more comes first.
    page.find('[data-sort="2"]').press();
    page.find('[data-sort="2"]').press();
    expect([column("Name")[0], column("Format")[0]]).toEqual(["Margin %", "Number, 2 decimal places, %"]);

    // The row's drawer: the words beside each column's name, and after them the text that was read, named as that. The
    // dimensions the line item has from its module are listed one to a line there, and the table says them as the file
    // has them, on one line, in the very row that was opened.
    page.all('#tableWrap tbody [data-act="row"]')[0].press();
    expect([page.id("drawerTitle").textContent, page.id("drawerSub").textContent]).toEqual(["Margin %", "Row 5 of Line Items"]);
    expect(page.texts("#drawerBody dt")).toEqual(["Name", "Module Name", "Format", "Format as read", "Format type", "Formula", "Summary", "Summary as read", "Applies To",
      "Applies To from", "Ratio Numerator", "Ratio Denominator"]);
    /** A value of the drawer: its items where it lists several, and otherwise its text. */
    const value = (dd: FakeElement) => (dd.querySelectorAll("li").length ? dd.querySelectorAll(".cell-list li .cell-t").map(item => item.textContent) : dd.textContent);
    expect(page.all("#drawerBody dd").map(value)).toEqual(["Margin %", "REV01 Revenue", "Number, 2 decimal places, %", PERCENT, "Number", "Margin / Revenue", "Ratio = Margin / Revenue",
      RATIO, ["Products", "Time"], "Module", "Margin", "Revenue"]);
    expect([column("Name")[0], column("Applies To")[0]]).toEqual(["Margin %", "Products, Time"]);
    page.key("Escape");
    // The search finds the dimensions as the table shows them, the comma between them as well: the module's own row and
    // the three line items that have its dimensions, whatever order the sort in force puts them in.
    page.id("tblSearch").type("products, time");
    expect([[...column("Name")].sort(), page.id("rowCount").textContent]).toEqual([["Margin %", "REV01 Revenue", "Revenue", "Units"], "1–4 of 4 rows (filtered from 8)"]);
    page.id("tblSearch").type("");
    // Another row has its own: the drawer is the row's, after a sort as well.
    page.all('#tableWrap tbody [data-act="row"]')[4].press();
    expect([page.id("drawerTitle").textContent, page.texts("#drawerBody dd").slice(2, 5), page.texts("#drawerBody dd").slice(6, 8)])
      .toEqual(["Cost", ["Number", NUMBER, "Number"], ["Sum, Time: Closing Balance", CLOSING]]);
    page.key("Escape");

    // The page's own table is the file as the export wrote it: Anaplan's text, and none of the words. A model's map is
    // built from the result's tables.
    page.find('#navList [data-nav="map"]').press();
    expect([mapBuilds.length, mapBuilds[0].tables]).toEqual([1, BLUEPRINT.tables]);
    expect(file.rows[4].slice(0, 4)).toEqual(["Margin %", PERCENT, "Margin / Revenue", RATIO]);

    // A table without such cells has nothing to add in its drawer.
    goTo(2);
    page.all('#tableWrap tbody [data-act="row"]')[0].press();
    expect(page.texts("#drawerBody dt")).toEqual(["Name", "Applies To"]);
    page.key("Escape");
    // An app's tables are never said in words, whatever their columns are called: the cells are as the file has them.
    page.id("runAgain").press();
    sendResult(ports[0], { ...BLUEPRINT, kind: "app" });
    goTo(1);
    expect([column("Format").slice(0, 2), column("Summary").slice(0, 2)]).toEqual([["", NUMBER], ["", SUM]]);
    page.all('#tableWrap tbody [data-act="row"]')[1].press();
    expect(page.texts("#drawerBody dt")).toEqual(["Name", "Format", "Formula", "Summary", "Applies To", "Module Name", "Ratio Numerator", "Ratio Denominator"]);
  });

  it("shows a model's Source Models with Mapped To as two columns, the workspace and the model by name; the row's drawer has Mapped To as it was read, and the map the file as it is", async () => {
    // A Source Models file as the export writes it, as Anaplan's own export of the grid: Mapped To holds the mapping's
    // definition. One names its workspace and its model, one only their IDs; one is empty, and one holds text that is no mapping.
    const FINANCE = JSON.stringify({ workspaceId: "dc56f2296af444ca894c1bca437ae1b4", workspaceName: "CL1 WU Finance [DEV-1]", modelId: "42FAAB38006B4E478C5A051DADA1B7C0", modelName: "Finance Hub" });
    const UNNAMED = JSON.stringify({ workspaceId: "0123456789abcdef0123456789abcdef", modelId: "FEDCBA9876543210FEDCBA9876543210" });
    const sources = { file: "Source Models.csv", label: "Source Models", guard: false, headers: ["", "Mapped To"],
      rows: [["Finance Hub (old)", FINANCE], ["Archive", UNNAMED], ["Unmapped", ""], ["Typed", "CL1 WU Finance / Finance Hub"]] };
    const WITH_SOURCES: AnalysisResult = { ...BLUEPRINT, summary: [...BLUEPRINT.summary, "Source Models: 4 rows"], tables: [...BLUEPRINT.tables, sources] };
    await openWith(WITH_SOURCES);
    // The tile counts every row of the file, and the bar has its entry: the table lists them all.
    expect(page.all("#view .stat").map(tile => tile.children.map(child => child.textContent))).toEqual([["Modules", "3", "rows"], ["Line Items", "8", "rows"], ["Source Models", "4", "rows"]]);
    expect(entryLabel(page.find('#navList [data-nav="3"]'))).toBe("Source Models");

    goTo(3);
    // Two columns in the place of Mapped To, each by name, or by ID where the cell gives no name. An empty cell says nothing,
    // and text that is no mapping stands as it is under Mapped Workspace: the line under the table's name says where.
    expect(headings()).toEqual(["Name", "Mapped Workspace", "Mapped Model"]);
    expect([column("Mapped Workspace"), column("Mapped Model")]).toEqual([["CL1 WU Finance [DEV-1]", "ID 0123456789abcdef0123456789abcdef", "", "CL1 WU Finance / Finance Hub"],
      ["Finance Hub", "ID FEDCBA9876543210FEDCBA9876543210", "", ""]]);
    expect([page.texts("#view .view-note"), page.id("rowCount").textContent]).toEqual([["Mapped To is shown as two columns, Mapped Workspace and Mapped Model: the workspace and the model "
      + "each source model is mapped to, by name, or by ID where Mapped To gives no name. A row's details add Mapped To as it was read. "
      + "1 row has a Mapped To that could not be read: its text stands as it is under Mapped Workspace."], "1–4 of 4 rows"]);
    // The search reads the names, as it reads any words the page says, and not the text that was read in their place.
    page.id("tblSearch").type("finance hub");
    expect(column("Name")).toEqual(["Finance Hub (old)", "Typed"]);
    page.id("tblSearch").type("workspaceName");
    expect(page.id("rowCount").textContent).toBe("No rows (filtered from 4)");
    page.id("tblSearch").type("");

    // The row's drawer: the two columns, then Mapped To as it was read, once, under the file's own name for it.
    page.all('#tableWrap tbody [data-act="row"]')[0].press();
    expect([page.id("drawerTitle").textContent, page.texts("#drawerBody dt"), page.all("#drawerBody dd").map(value => value.textContent)])
      .toEqual(["Finance Hub (old)", ["Name", "Mapped Workspace", "Mapped Model", "Mapped To as read"], ["Finance Hub (old)", "CL1 WU Finance [DEV-1]", "Finance Hub", FINANCE]]);
    page.key("Escape");
    page.all('#tableWrap tbody [data-act="row"]')[1].press();
    expect(page.all("#drawerBody dd").map(value => value.textContent)).toEqual(["Archive", "ID 0123456789abcdef0123456789abcdef", "ID FEDCBA9876543210FEDCBA9876543210", UNNAMED]);
    page.key("Escape");
    // A row whose cell names neither has nothing said in words, and so nothing as read: its cell is in the table as it is.
    for (const at of [2, 3]) {
      page.all('#tableWrap tbody [data-act="row"]')[at].press();
      expect([page.texts("#drawerBody dt"), page.all("#drawerBody dd").map(value => value.textContent)]).toEqual([["Name", "Mapped Workspace", "Mapped Model"], [...sources.rows[at], ""]]);
      page.key("Escape");
    }

    // The model map is handed the result's own tables, in which Mapped To is as the export wrote it.
    page.find('#navList [data-nav="map"]').press();
    expect([mapBuilds.length, mapBuilds[0].tables, sources.rows[0]]).toEqual([1, WITH_SOURCES.tables, ["Finance Hub (old)", FINANCE]]);
  });

  it("shows a model's Imports with Source Object as three columns, the source's model, module and saved view; the row's drawer has Source Object as it was read, and the map the file as it is", async () => {
    // An Imports file as the export writes it: the Imports tab's columns, then the Actions list's. One import reads a saved
    // view of another model, one a saved view of this model's own module, and one a list of another model.
    const HUB = "M0 Data Hub [DEV] / 'HRY01 ORG Hierarchy Builder'.'DATA & LIST: ORG3 Area'";
    const OWN = "'SYS ORG1 Campus #'.'DATA: SYS ORG1 Campus # (Reset)'";
    const imports = { file: "Imports.csv", label: "Imports", guard: false, headers: ["", "Source Label", "Source Object", "Source Type", "Target Object", "Target Type", "Used in Processes"],
      rows: [["Load areas", "M0 Data Hub [DEV] / HRY01 ORG Hierarchy Builder", HUB, "SAVED VIEW", "ORG3 Area", "LIST", "Nightly load"],
        ["Reset campus", "SYS ORG1 Campus #", OWN, "SAVED VIEW", "SYS ORG1 Campus", "MODULE", ""],
        ["Products from the hub", "Hub / Products", "Hub / Products", "LIST", "Products", "LIST", "Nightly load"]] };
    const WITH_IMPORTS: AnalysisResult = { ...BLUEPRINT, summary: [...BLUEPRINT.summary, "Imports: 3 rows"], tables: [...BLUEPRINT.tables, imports] };
    await openWith(WITH_IMPORTS);
    // The tile counts every row of the file: the table lists them all.
    expect(page.all("#view .stat").map(tile => tile.children.map(child => child.textContent)).at(-1)).toEqual(["Imports", "3", "rows"]);

    goTo(3);
    // Three columns in the place of Source Object. An import from this model's own module names this model; a list is no
    // module, and its Source Object stands as it is, which the line under the table's name says.
    expect(headings()).toEqual(["Name", "Source Label", "Source Model", "Source Module", "Saved View", "Source Type", "Target Object", "Target Type", "Used in Processes"]);
    expect([column("Source Model"), column("Source Module"), column("Saved View")]).toEqual([["M0 Data Hub [DEV]", "Model one", "Hub / Products"],
      ["HRY01 ORG Hierarchy Builder", "SYS ORG1 Campus #", ""], ["DATA & LIST: ORG3 Area", "DATA: SYS ORG1 Campus # (Reset)", ""]]);
    expect(page.texts("#view .view-note")).toEqual(["Source Object is shown as three columns, Source Model, Source Module and Saved View, for an import from a module or a saved view. "
      + "Source Model names this model where the import reads from this model itself. A row's details add Source Object as it was read. "
      + "1 row has a Source Object that is not a module or a saved view: its text stands as it is under Source Model."]);
    // A column of names offers a filter by them, as any column of few texts does.
    page.find(`[data-colfilter="${headings().indexOf("Source Model")}"]`).press();
    expect(choices()).toEqual([["Hub / Products", "1", true], ["M0 Data Hub [DEV]", "1", true], ["Model one", "1", true]]);
    page.key("Escape");

    // The row's drawer: the three columns, then Source Object as it was read, once, under the file's own name for it.
    page.all('#tableWrap tbody [data-act="row"]')[0].press();
    expect([page.texts("#drawerBody dt").slice(2, 6), page.all("#drawerBody dd").map(value => value.textContent).slice(2, 6)])
      .toEqual([["Source Model", "Source Module", "Saved View", "Source Object as read"], ["M0 Data Hub [DEV]", "HRY01 ORG Hierarchy Builder", "DATA & LIST: ORG3 Area", HUB]]);
    page.key("Escape");
    // The list's import has nothing that was read in words, and so nothing as read.
    page.all('#tableWrap tbody [data-act="row"]')[2].press();
    expect([page.texts("#drawerBody dt").slice(2, 6), page.all("#drawerBody dd").map(value => value.textContent).slice(2, 6)])
      .toEqual([["Source Model", "Source Module", "Saved View", "Source Type"], ["Hub / Products", "", "", "LIST"]]);
    page.key("Escape");

    // The model map is handed the result's own tables, in which Source Object is as the export wrote it.
    page.find('#navList [data-nav="map"]').press();
    expect([mapBuilds.length, mapBuilds[0].tables, imports.rows[0][2]]).toEqual([1, WITH_IMPORTS.tables, HUB]);
  });

  it("lists a model's files in the order of Anaplan's Model settings, whatever order the result has them in, and the model map last; each entry has its own file's icon", async () => {
    /** A model's result with these files after its Details file, in this order; each has as many rows as its place in the result. */
    const model = (...files: string[]): AnalysisResult => ({ ...MODEL, summary: [], tables: [MODEL.tables[0], ...files.map((file, index) =>
      ({ file: `${file}.csv`, label: file, headers: ["", "Value"], rows: Array.from({ length: index + 1 }, (_, row): Cell[] => [`${file} ${row + 1}`, "x"]), guard: false }))] });
    /** The navigation's entries, by their words, and the overview's tiles. */
    const entries = () => page.all("#navList .nav-item").map(entryLabel);
    const tiles = () => page.texts("#view .s-lab");
    /** The icons of files by their names (markup.ts `FILE_ICONS`), as the page draws them. */
    const iconsOf = (...names: string[]) => drawnIcons(...names.map(name => FILE_ICONS.get(`${name}.csv`)));
    // The order the export writes its files in (model/export.ts), and the order the page lists them in. Dynamic Cell
    // Access, which the export makes from Line Items, comes right after it in both.
    const written = ["Line Items", "Dynamic Cell Access", "Modules", "General Lists", "Processes", "Imports", "Import Data Sources", "Exports", "Other Actions", "Time Ranges", "Versions", "Source Models",
      "Model Calendar"];
    const ordered = ["Model Calendar", "Time Ranges", "Versions", "General Lists", "Modules", "Line Items", "Dynamic Cell Access", "Processes", "Imports", "Import Data Sources", "Exports", "Other Actions",
      "Source Models"];
    await openWith(model(...written));
    expect([entries(), tiles()]).toEqual([["Overview", ...ordered, "Model map"], ordered]);
    // Each entry has its own file's icon, wherever the file stands in the result, and the overview and the map theirs.
    expect(entryIcons()).toEqual([...drawnIcons(NAV_ICONS.overview), ...iconsOf(...ordered), ...drawnIcons(NAV_ICONS.map)]);
    // Each entry still opens its own file: its name in the navigation is the file's place in the result, which here is
    // also the number of the file's rows.
    expect(page.all("#navList .nav-item").slice(1, 4).map(item => [item.dataset.nav, entryLabel(item)])).toEqual([["13", "Model Calendar"], ["10", "Time Ranges"], ["11", "Versions"]]);
    goTo(10);
    expect([shows(), page.id("rowCount").textContent, firstCells()[0]]).toEqual([["Time Ranges", "Time Ranges"], "1–10 of 10 rows", "Time Ranges 1"]);
    // The model map is the last entry, named as its own view and not as a file: it has no place in the result.
    const map = page.all("#navList .nav-item")[14];
    expect([map.dataset.nav, entryLabel(map)]).toEqual(["map", "Model map"]);
    // Only the page's list is ordered: the result's own tables are in the order the result has them, which is how a
    // model's map is handed them.
    map.press();
    expect([mapBuilds.length, mapBuilds[0].tables]).toEqual([1, model(...written).tables]);

    // A result without some of the files lists the ones it has, in the same order.
    page.id("runAgain").press();
    sendResult(ports[0], model("Imports", "Line Items", "Versions"));
    expect([entries(), tiles()]).toEqual([["Overview", "Versions", "Line Items", "Imports", "Model map"], ["Versions", "Line Items", "Imports"]]);
    // A file the order does not name comes after the ones it names, in the result's order: none goes missing. Line Item
    // Subsets, which the export does not write yet, has its place between General Lists and Modules.
    page.id("runAgain").press();
    sendResult(ports[0], model("Dashboards", "Line Items", "Line Item Subsets", "Users", "Modules", "General Lists"));
    expect([entries(), tiles()]).toEqual([["Overview", "General Lists", "Line Item Subsets", "Modules", "Line Items", "Dashboards", "Users", "Model map"],
      ["General Lists", "Line Item Subsets", "Modules", "Line Items", "Dashboards", "Users"]]);
    // A file the page knows nothing of has the icon of a table: its name is not one the page knows a drawing for.
    expect(entryIcons()).toEqual([...drawnIcons(NAV_ICONS.overview), ...iconsOf("General Lists", "Line Item Subsets", "Modules", "Line Items"),
      ...drawnIcons(NAV_ICONS.table, NAV_ICONS.table, NAV_ICONS.map)]);
  });

  it("opens the row that was clicked, not its neighbour, on a click anywhere in the row but on a control", async () => {
    await openWith(APP);
    goTo(3);
    expect(headings()).toEqual(["Page", "Section layout", "Source module"]);
    for (const [index, row] of APP.tables[3].rows.entries()) {
      // On a plain cell of the row: its section layout.
      page.all("#tableWrap tbody tr")[index].children[1].press();
      expect([page.all("#drawerBody dd").map(value => value.textContent), page.id("drawerSub").textContent], `row ${index + 1}`).toEqual([row.map(String), `Row ${index + 1} of Grid Sections`]);
      page.key("Escape");
    }
    // On the cell itself, beside its text, as well as on the text.
    page.all("#tableWrap tbody tr")[1].children[2].querySelector(".cell-t")?.press();
    expect(page.texts("#drawerBody dd")[4]).toBe("REP09 Copy");
    page.key("Escape");
    // A control in a row does what it does and does not open the row: the ID's pill, once its column is shown, copies the ID.
    toggleColumn("Card ID");
    page.all("#tableWrap tbody .id-pill")[1].press();
    await settle();
    expect([copied, page.id("toast").textContent, drawerShown()]).toEqual([["card-a"], "Copied card-a", false]);
    page.all("#tableWrap tbody .id-pill")[2].press();
    await settle();
    expect(copied).toEqual(["card-a", "card-gone"]);
  });

  it("lists one to a line, in a row's drawer and in a card's, a cell that the report joined from several items; the table and its search read the cell as it is, its filter each item", async () => {
    /** An app whose Cards table has a grid of one section and a combined grid, with the columns the report joins, and a
     * filter whose context is two dimensions. */
    const JOINED: AnalysisResult = { ...APP, tables: [APP.tables[0], APP.tables[1],
      { file: "Cards.csv", label: "Cards", headers: ["Page", "Card #", "Card title", "View type", "Context selectors", "Text content", "Card ID"], guard: true, rows: [
        ["Overview", 1, "Sales", "Custom view", "Territory (visible, synced to page); Channel (hidden)", "Check the plan; then submit.", "card-a"],
        ["Overview", 2, "Plan", "Combined grid (2 sections)", "Section 1: Territory (visible, synced to page); Channel (hidden) | Section 2: Store (hidden)", NONE, "card-b"]] },
      { file: "Filters.csv", label: "Filters", headers: ["Page", "Card #", "Section #", "Condition line item", "Condition context", "Card ID"], guard: true,
        rows: [["Overview", 1, "1", "Sales", "Time = current; Version = Actual", "card-a"]] }] };
    await openWith(JOINED);
    goTo(2);
    const SELECTORS = ["Territory (visible, synced to page); Channel (hidden)", "Section 1: Territory (visible, synced to page); Channel (hidden) | Section 2: Store (hidden)"];
    expect(column("Context selectors")).toEqual(SELECTORS);
    /** The drawer's values by their names: the items of one that lists several, and the text of any other. */
    const values = () => new Map(page.all("#drawerBody .d-dl dt").map((name, at) => {
      const value = page.all("#drawerBody .d-dl dd")[at];
      return [name.textContent, value.querySelector(".cell-list") ? value.querySelectorAll(".cell-list li").map(item => item.textContent) : value.textContent];
    }));
    // A row's drawer: the grid's selectors one to a line, a comma inside one of them its own; the text card's words whole.
    page.all('#tableWrap tbody [data-act="row"]')[0].press();
    expect([values().get("Context selectors"), values().get("Text content")]).toEqual([["Territory (visible, synced to page)", "Channel (hidden)"], "Check the plan; then submit."]);
    page.key("Escape");
    // A card's drawer: a combined grid's selectors one section to a line, each section's own semicolon in its line.
    cardLinks()[1].press();
    const title = page.id("drawerTitle").textContent;
    expect([title.startsWith("Card 2 "), title.endsWith(" Plan"), values().get("Context selectors")]).toEqual([true, true,
      ["Section 1: Territory (visible, synced to page); Channel (hidden)", "Section 2: Store (hidden)"]]);
    page.key("Escape");
    // The other card's filter, among its parts, lists its context one dimension to a line. (The table has neither the
    // axis nor the dimensions a filter is on, which are empty here; nor the condition's group, which is a dash.)
    cardLinks()[0].press();
    expect(page.all("#drawerBody .mini tbody tr").map(entry => entry.children.map(cell => (cell.querySelector(".cell-list") ? cell.querySelectorAll("li").map(text => text.textContent) : cell.textContent))))
      .toEqual([["1", "", "", NONE, "Sales", ["Time = current", "Version = Actual"]]]);
    page.key("Escape");
    // The search finds the cell as the table shows it, the report's separator and all. The filter lists each item the
    // drawer lists, once, with the rows that list it: a section of the combined grid is one item, its own semicolon and all.
    page.id("tblSearch").type("channel (hidden) | section 2");
    expect([column("Card title"), page.id("rowCount").textContent]).toEqual([["Plan"], "1–1 of 1 row (filtered from 2)"]);
    page.id("tblSearch").type("");
    page.find(`[data-colfilter="${4}"]`).press();
    expect(choices().map(([value, count]) => [value, count]).sort()).toEqual([["Channel (hidden)", "1"], ["Section 1: Territory (visible, synced to page); Channel (hidden)", "1"],
      ["Section 2: Store (hidden)", "1"], ["Territory (visible, synced to page)", "1"]]);
    // A row shows when any of its items is ticked: without the first card's two items, the combined grid stays.
    page.all("#popover input").filter((_, at) => ["Channel (hidden)", "Territory (visible, synced to page)"].includes(choices()[at][0])).forEach(box => box.tick());
    expect([column("Card title"), page.id("rowCount").textContent]).toEqual([["Plan"], "1–1 of 1 row (filtered from 2)"]);
  });

  it("opens the card a link stands for: the one on that row's page, with its parts", async () => {
    await openWith(APP);
    goTo(2);
    /** The card in the drawer: its heading, its page, its sections, and the grid sections listed for it. */
    const card = () => [page.id("drawerTitle").textContent, page.texts("#drawerSub .link")[0], page.texts("#drawerBody h3"), page.texts("#drawerBody .mini td").slice(0, 3)];
    // In the Cards table a card's title opens it: one link a row. The second page is a copy of the first and kept its
    // cards' IDs: a card is the one of its own page.
    expect(cardLinks().map(link => link.textContent)).toEqual(["Sales", "Margin", "Sales, copied", "Margin, copied"]);
    cardLinks()[2].press();
    expect(card()).toEqual(["Card 1 - Sales, copied", "Overview (copy)", ["Card details", "Grid sections (1)"], ["1", "Own rows and columns", "REP09 Copy"]]);
    expect(page.texts("#drawerBody .d-dl dd")).toEqual(["Overview (copy)", "1", "Sales, copied", "Grid", "card-a"]);
    page.key("Escape");
    cardLinks()[0].press();
    expect(card()).toEqual(["Card 1 - Sales", "Overview", ["Card details", "Grid sections (1)"], ["1", "Own rows and columns", "REP01 Sales"]]);
    page.key("Escape");
    // A card without grid sections says so.
    cardLinks()[1].press();
    expect([card().slice(0, 3), page.texts("#drawerBody p")]).toEqual([["Card 2 - Margin", "Overview", ["Card details", "Grid sections (0)"]], ["No grid sections on this card."]]);
    page.key("Escape");
    // The card's number, once its column is shown, is a link as much as the title.
    toggleColumn("Card #");
    expect(cardLinks().slice(0, 2).map(link => link.textContent)).toEqual(["1", "Sales"]);
    cardLinks()[0].press();
    expect(card().slice(0, 2)).toEqual(["Card 1 - Sales", "Overview"]);
    page.key("Escape");

    // Another table has no card's title, and its card's number starts hidden: no cell on screen opens a card. The row's
    // drawer shows the number, and there it opens the card of that row, by the row's page and Card ID.
    goTo(3);
    expect([headings(), cardLinks()]).toEqual([["Page", "Section layout", "Source module"], []]);
    const rowButton = () => page.all('#tableWrap tbody [data-act="row"]')[1];
    rowButton().press();
    expect([page.id("drawerSub").textContent, page.texts("#drawerBody dt").slice(0, 3), page.all('#drawerBody [data-act="card"]').map(link => [link.textContent, link.title])])
      .toEqual(["Row 2 of Grid Sections", ["Page", "Card #", "Section #"], [["1", "Open card details"]]]);
    page.find('#drawerBody [data-act="card"]').press();
    expect(card()).toEqual(["Card 1 - Sales, copied", "Overview (copy)", ["Card details", "Grid sections (1)"], ["1", "Own rows and columns", "REP09 Copy"]]);
    // Inside the card's drawer, a card's link opens that card too: here the same one again, by its title.
    page.all('#drawerBody [data-act="card"]')[1].press();
    expect(card().slice(0, 2)).toEqual(["Card 1 - Sales, copied", "Overview (copy)"]);
    // The drawer then closes back to what opened it from the table, not to a link inside it, which is gone.
    page.key("Escape");
    expect(page.document.activeElement).toBe(rowButton());
    // With the column shown, the number opens the card from the table as well.
    toggleColumn("Card #");
    cardLinks()[1].press();
    expect(card().slice(0, 2)).toEqual(["Card 1 - Sales, copied", "Overview (copy)"]);
    page.key("Escape");
    expect(page.document.activeElement).toBe(cardLinks()[1]);
    // A row whose card the export does not have: a word about it, and no drawer.
    cardLinks()[2].press();
    expect([page.id("toast").textContent, drawerShown(), page.find(".shell").inert]).toEqual(["Card not found in this export", false, false]);
  });

  /** An app with two pages of one name, the second a copy that kept its cards' IDs. The files have only a page's name, so
   * the cards of both pages stand under it: Sales with one number and one ID on both, Margin moved to another place on the
   * copy, and under the number 3 a card of its own on each page. Only the copy's Sales has a formatting rule. */
  const TWINS: AnalysisResult = {
    ...APP, summary: ["2 of 2 pages analysed, 6 cards."],
    tables: [
      APP.tables[0],
      { file: "Pages.csv", label: "Pages", headers: ["App", "Page", "Total cards", "Page ID"], guard: true, rows: [["Demo app", "Overview", 3, "page-1"], ["Demo app", "Overview", 3, "page-2"]] },
      { file: "Cards.csv", label: "Cards", headers: ["Page", "Card #", "Card title", "Card type", "Conditional formatting", "Card ID"], guard: true,
        rows: [["Overview", 1, "Sales", "Grid", "-", "card-a"], ["Overview", 2, "Margin", "KPI", "-", "card-b"], ["Overview", 3, "Stock", "Grid", "-", "card-s"],
          ["Overview", 1, "Sales, copied", "Grid", "1 rule", "card-a"], ["Overview", 3, "Costs", "Grid", "-", "card-c"], ["Overview", 4, "Margin, moved", "KPI", "-", "card-b"]] },
      { file: "Grid Sections.csv", label: "Grid Sections", headers: ["Page", "Card #", "Section #", "Section layout", "Source module", "Card ID"], guard: true,
        rows: [["Overview", 1, 1, "Own rows and columns", "REP01 Sales", "card-a"], ["Overview", 3, 1, "Own rows and columns", "REP04 Stock", "card-s"],
          ["Overview", 1, 1, "Own rows and columns", "REP09 Sales copy", "card-a"], ["Overview", 3, 1, "Own rows and columns", "REP05 Costs", "card-c"]] },
      { file: "Conditional Formatting.csv", label: "Conditional Formatting", headers: ["Page", "Card #", "Section #", "Format style", "Formatted line item", "Card ID"], guard: true,
        rows: [["Overview", 1, 1, "Colour scale", "Sales", "card-a"], ["Overview", 4, "-", "KPI indicator", "KPI value", "card-b"]] },
    ],
  };

  it("opens the card of the row clicked where two pages share a name and their cards an ID, and does not list another card's parts as its own", async () => {
    await openWith(TWINS);
    goTo(2);
    /** The card in the drawer: its heading, its own cells, its sections, the rows listed under them, and the line about what is left out. */
    const card = () => ({ title: page.id("drawerTitle").textContent, cells: page.texts("#drawerBody .d-dl dd"), sections: page.texts("#drawerBody h3"),
      rows: page.all("#drawerBody .mini tbody tr").map(row => row.children.map(cell => cell.textContent)), note: page.texts("#drawerSub div") });
    const NOTE = '2 cards on pages named "Overview" have this number and this ID. '
      + "The tables have only the name of a card's page, so their grid sections and formatting rules cannot be told apart and are not listed here.";
    expect(cardLinks().map(link => link.textContent)).toEqual(["Sales", "Margin", "Stock", "Sales, copied", "Costs", "Margin, moved"]);
    // Sales is on both pages with one number and one ID. Each row opens its own card: the copy's title and its formatting
    // rule, not those of the first card that has the page's name and the ID.
    cardLinks()[3].press();
    expect(card()).toEqual({ title: "Card 1 - Sales, copied", cells: ["Overview", "1", "Sales, copied", "Grid", "1 rule", "card-a"], sections: ["Card details"], rows: [], note: [NOTE] });
    // Its grid sections and its formatting rules are in the other files under the same name, number and ID as the first
    // page's: neither card's are listed as this one's (two grid sections for a card that has one), and the line says why.
    // The line's page still leads to the cards under that name.
    expect(page.all("#drawerSub [data-act]").map(control => [control.dataset.act, control.textContent])).toEqual([["page", "Overview"]]);
    page.key("Escape");
    cardLinks()[0].press();
    expect(card()).toEqual({ title: "Card 1 - Sales", cells: ["Overview", "1", "Sales", "Grid", "-", "card-a"], sections: ["Card details"], rows: [], note: [NOTE] });
    // Inside the drawer the card's own links open the same card again, not its twin.
    page.all('#drawerBody [data-act="card"]')[1].press();
    expect(card().title).toBe("Card 1 - Sales");
    page.key("Escape");
    // Margin kept its ID on the copy and stands in another place there: the number tells the two apart, so each has its
    // own rows, and nothing is left out.
    cardLinks()[1].press();
    expect(card()).toMatchObject({ title: "Card 2 - Margin", sections: ["Card details", "Grid sections (0)", "Conditional formatting (0)"], rows: [], note: [] });
    page.key("Escape");
    cardLinks()[5].press();
    expect(card()).toMatchObject({ title: "Card 4 - Margin, moved", sections: ["Card details", "Grid sections (0)", "Conditional formatting (1)"],
      rows: [["-", "KPI indicator", "KPI value", "", ""]], note: [] });
    page.key("Escape");
    // Under the number 3 each page has a card of its own, with its own ID: each has its own grid section.
    cardLinks()[2].press();
    expect(card()).toMatchObject({ title: "Card 3 - Stock", sections: ["Card details", "Grid sections (1)", "Conditional formatting (0)"], rows: [["1", "Own rows and columns", "REP04 Stock", "", "", "", ""]], note: [] });
    page.key("Escape");
    cardLinks()[4].press();
    expect(card()).toMatchObject({ title: "Card 3 - Costs", rows: [["1", "Own rows and columns", "REP05 Costs", "", "", "", ""]], note: [] });
    page.key("Escape");

    // In another table a card's number opens the card where the row names one card. The two rows of Sales could each be
    // either card's: their number is plain text, in the table and in the row's drawer.
    goTo(3);
    toggleColumn("Card #");
    expect([column("Card #"), page.all("#tableWrap tbody tr").map(row => row.querySelectorAll('[data-act="card"]').length)]).toEqual([["1", "3", "1", "3"], [0, 1, 0, 1]]);
    cardLinks()[1].press();
    expect(card().title).toBe("Card 3 - Costs");
    page.key("Escape");
    cardLinks()[0].press();
    expect(card().title).toBe("Card 3 - Stock");
    page.key("Escape");
    page.all('#tableWrap tbody [data-act="row"]')[2].press();
    expect([page.id("drawerSub").textContent, page.texts("#drawerBody dd").slice(0, 2), page.all('#drawerBody [data-act="card"]').length]).toEqual(["Row 3 of Grid Sections", ["Overview", "1"], 0]);
    page.key("Escape");
    // A row of the moved card names it by its number among the two that have its ID.
    goTo(4);
    toggleColumn("Card #");
    expect([column("Card #"), page.all("#tableWrap tbody tr").map(row => row.querySelectorAll('[data-act="card"]').length)]).toEqual([["1", "4"], [0, 1]]);
    cardLinks()[0].press();
    expect(card().title).toBe("Card 4 - Margin, moved");
  });

  it("shows a page's cards on a click on the page's name, wherever the Page column stands, and from the drawer", async () => {
    await openWith(APP);
    const jumped = () => [shows(), page.texts("#pageFilter"), column("Card title"), page.id("rowCount").textContent];
    const copies = [["Cards", "Cards"], ["Page: Overview (copy)"], ["Sales, copied", "Margin, copied"], "1–2 of 2 rows (filtered from 4)"];
    // Where Used: the page is its fourth column.
    goTo(4);
    page.all('#tableWrap tbody [data-act="page"]')[1].press();
    expect(jumped()).toEqual(copies);
    // The page stands as a chip at the head of the table's toolbar, before the search box, with the button that clears it.
    expect([page.find(".toolbar").children.map(child => child.id), page.find('#pageFilter [data-act="clear-context"]').getAttribute("aria-label")])
      .toEqual([["pageFilter", "searchWrap", "colBtn", "resetBtn", "rowCount", "pager"], "Clear page filter"]);
    // Pages: its second.
    goTo(1);
    page.all('#tableWrap tbody [data-act="page"]')[0].press();
    expect(jumped().slice(1, 3)).toEqual([["Page: Overview"], ["Sales", "Margin"]]);
    // In the Cards table itself the page's name narrows the table to that page.
    page.find('#pageFilter [data-act="clear-context"]').press();
    page.all('#tableWrap tbody [data-act="page"]')[3].press();
    expect(jumped()).toEqual(copies);
    // From a card's drawer: the page under its heading, and the page among its details.
    page.find('#pageFilter [data-act="clear-context"]').press();
    cardLinks()[0].press();
    page.find('#drawerSub [data-act="page"]').press();
    expect([jumped().slice(1, 3), drawerShown()]).toEqual([[["Page: Overview"], ["Sales", "Margin"]], false]);
    // The jump is a view of the Cards table: a search narrows it further, and the navigation's Cards shows them all again.
    page.id("tblSearch").type("sales");
    expect(column("Card title")).toEqual(["Sales"]);
    goTo(2);
    expect([page.has("#pageFilter"), column("Card title").length, page.id("tblSearch").value]).toEqual([false, 4, ""]);
  });

  it("sorts by a column on its button: ascending, descending, then the file's order again; another column starts ascending", async () => {
    await openWith(APP);
    goTo(2);
    const sorted = () => page.all("#tableWrap thead th").map(heading => heading.getAttribute("aria-sort")).filter(direction => direction !== "none").length;
    const titles = () => column("Card title");
    expect([titles(), sorted()]).toEqual([["Sales", "Margin", "Sales, copied", "Margin, copied"], 0]);
    page.find('[data-sort="2"]').press();
    expect([titles(), page.find('[data-sort="2"]').closest("th")?.getAttribute("aria-sort"), sorted()]).toEqual([["Margin", "Margin, copied", "Sales", "Sales, copied"], "ascending", 1]);
    page.find('[data-sort="2"]').press();
    expect([titles(), page.find('[data-sort="2"]').closest("th")?.getAttribute("aria-sort")]).toEqual([["Sales, copied", "Sales", "Margin, copied", "Margin"], "descending"]);
    // Another column, the card's type, while this one is descending: that column, ascending, and only it. Rows that sort the same keep the file's order.
    page.find('[data-sort="3"]').press();
    expect([titles(), page.find('[data-sort="3"]').closest("th")?.getAttribute("aria-sort"), sorted()]).toEqual([["Sales", "Sales, copied", "Margin", "Margin, copied"], "ascending", 1]);
    page.find('[data-sort="3"]').press();
    expect(titles()).toEqual(["Margin", "Margin, copied", "Sales", "Sales, copied"]);
    page.find('[data-sort="3"]').press();
    expect([titles(), sorted(), page.id("resetBtn").hidden]).toEqual([["Sales", "Margin", "Sales, copied", "Margin, copied"], 0, true]);
  });

  it("filters a column by the boxes ticked, and has no filter left once every box is ticked again", async () => {
    await openWith(APP);
    goTo(2);
    const state = () => [column("Card title"), page.find('[data-colfilter="3"]').classList.contains("active"), page.id("resetBtn").hidden, page.id("rowCount").textContent];
    page.find('[data-colfilter="3"]').press();
    expect(choices()).toEqual([["Grid", "2", true], ["KPI", "2", true]]);
    page.all("#popover input")[1].tick();
    expect(state()).toEqual([["Sales", "Sales, copied"], true, false, "1–2 of 2 rows (filtered from 4)"]);
    // Nothing ticked shows nothing, and says that the filter is why.
    page.all("#popover input")[0].tick();
    expect([state()[0], page.texts("#tableWrap .e-sub"), page.id("rowCount").textContent]).toEqual([[], ["Nothing in Cards matches the current column filters."], "No rows (filtered from 4)"]);
    page.all("#popover input")[1].tick();
    expect(state()).toEqual([["Margin", "Margin, copied"], true, false, "1–2 of 2 rows (filtered from 4)"]);
    // Every box ticked again is no filter: nothing is in force, and Reset is not offered.
    page.all("#popover input")[0].tick();
    expect(state()).toEqual([["Sales", "Margin", "Sales, copied", "Margin, copied"], false, true, "1–4 of 4 rows"]);
    // The popover opened again shows what is ticked; a filter on a second column narrows what the first leaves.
    page.all("#popover input")[0].tick();
    page.key("Escape");
    page.find('[data-colfilter="3"]').press();
    expect(choices()).toEqual([["Grid", "2", false], ["KPI", "2", true]]);
    page.find('[data-colfilter="0"]').press();
    expect(choices()).toEqual([["Overview", "2", true], ["Overview (copy)", "2", true]]);
    page.all("#popover input")[0].tick();
    expect(column("Card title")).toEqual(["Margin, copied"]);
  });

  it("clears the search, the filters, the sort and the jump with Reset", async () => {
    await openWith(APP);
    goTo(1);
    page.all('#tableWrap tbody [data-act="page"]')[1].press();
    page.id("tblSearch").type("copied");
    page.find('[data-sort="2"]').press();
    page.find('[data-colfilter="3"]').press();
    page.all("#popover input")[0].tick();
    page.key("Escape");
    const inForce = () => [column("Card title"), page.has("#pageFilter"), page.id("tblSearch").value, page.all(".th-filter.active").length,
      page.all("#tableWrap thead th").filter(heading => heading.getAttribute("aria-sort") !== "none").length, page.id("resetBtn").hidden];
    expect(inForce()).toEqual([["Margin, copied"], true, "copied", 1, 1, false]);
    page.id("resetBtn").press();
    expect(inForce()).toEqual([["Sales", "Margin", "Sales, copied", "Margin, copied"], false, "", 0, 0, true]);
    // The filter is gone, not merely unshown: its popover has every box ticked again.
    page.find('[data-colfilter="3"]').press();
    expect(choices().map(choice => choice[2])).toEqual([true, true]);
  });

  it("hides and shows columns in the chooser, and puts back with Defaults the ones that start hidden", async () => {
    await openWith(APP);
    goTo(2);
    const boxes = () => page.all("#popover .pop-opt").map(option => `${option.children[1].textContent}${option.children[0].checked ? " ✓" : ""}`);
    // The card's number and its ID start hidden. Both are in the chooser, unticked; the ID is marked as one.
    expect(headings()).toEqual(["Page", "Card title", "Card type"]);
    page.id("colBtn").press();
    expect(boxes()).toEqual(["Page ✓", "Card #", "Card title ✓", "Card type ✓", "Card ID"]);
    expect(page.all("#popover .pop-opt").map(option => option.querySelector(".po-cnt")?.textContent ?? "")).toEqual(["", "", "", "", "ID"]);
    // A column that starts hidden is shown, a column that is shown is hidden: each box acts on its own column.
    page.all("#popover input")[4].tick();
    expect([headings(), column("Card ID")]).toEqual([["Page", "Card title", "Card type", "Card ID"], ["card-a", "card-b", "card-a", "card-b"]]);
    page.all("#popover input")[1].tick();
    expect([headings(), column("Card #")]).toEqual([["Page", "Card #", "Card title", "Card type", "Card ID"], ["1", "2", "1", "2"]]);
    page.all("#popover input")[3].tick();
    expect([headings(), column("Card title"), boxes()]).toEqual([["Page", "Card #", "Card title", "Card ID"], ["Sales", "Margin", "Sales, copied", "Margin, copied"],
      ["Page ✓", "Card # ✓", "Card title ✓", "Card type", "Card ID ✓"]]);
    // The choice is the table's own: another table is as it was, and this one is as it was left.
    page.key("Escape");
    goTo(3);
    expect(headings()).toEqual(["Page", "Section layout", "Source module"]);
    page.id("colBtn").press();
    expect(boxes()).toEqual(["Page ✓", "Card #", "Section #", "Section layout ✓", "Source module ✓", "Card ID"]);
    page.key("Escape");
    // The search reads the columns that are not shown as well: a card's ID finds its row.
    page.id("tblSearch").type("card-gone");
    expect([column("Source module"), page.id("rowCount").textContent]).toEqual([["REP02 Gone"], "1–1 of 1 row (filtered from 3)"]);
    goTo(2);
    expect(headings()).toEqual(["Page", "Card #", "Card title", "Card ID"]);
    page.id("colBtn").press();
    page.find('#popover [data-popact="defaults"]').press();
    expect([headings(), page.id("popover").hidden]).toEqual([["Page", "Card title", "Card type"], true]);
    // Where Used keeps its card's number out of sight too; there it is a number only, in the row's drawer as well.
    goTo(4);
    expect(headings()).toEqual(["Object type", "Object name", "Object's module", "Page", "Used as"]);
    page.all('#tableWrap tbody [data-act="row"]')[0].press();
    expect([page.texts("#drawerBody dt"), page.texts("#drawerBody dd")[4], page.all('#drawerBody [data-act="card"]')])
      .toEqual([["Object type", "Object name", "Object's module", "Page", "Card #", "Used as", "Object ID"], "1", []]);
  });

  it("turns a table's pages and changes how many rows a page holds, with the rows that belong there", async () => {
    await openWith(MODEL);
    goTo(1);
    const range = () => [firstCells()[0], firstCells()[firstCells().length - 1], page.id("rowCount").textContent, pagerButtons().join(" ")];
    expect(range()).toEqual(["Line item 1", "Line item 50", "1–50 of 120 rows", "(‹) ›"]);
    page.find('.pg-btn[aria-label="Next page"]').press();
    expect(range()).toEqual(["Line item 51", "Line item 100", "51–100 of 120 rows", "‹ ›"]);
    page.find('.pg-btn[aria-label="Next page"]').press();
    expect(range()).toEqual(["Line item 101", "Line item 120", "101–120 of 120 rows", "‹ (›)"]);
    // A button that is off does nothing.
    page.find('.pg-btn[aria-label="Next page"]').press();
    expect(range()[2]).toBe("101–120 of 120 rows");
    page.find('.pg-btn[aria-label="Previous page"]').press();
    expect(range().slice(0, 3)).toEqual(["Line item 51", "Line item 100", "51–100 of 120 rows"]);
    // Rows per page: the table starts again at its first page, and every table keeps the size.
    page.id("pageSize").choose("25");
    expect(range()).toEqual(["Line item 1", "Line item 25", "1–25 of 120 rows", "(‹) ›"]);
    page.id("pageSize").choose("100");
    expect(range()).toEqual(["Line item 1", "Line item 100", "1–100 of 120 rows", "(‹) ›"]);
    goTo(2);
    expect(page.id("pageSize").value).toBe("100");
  });

  it("keeps the pager in the toolbar above the table, after the count, through every draw; nothing stands under the table", async () => {
    await openWith(MODEL);
    goTo(1);
    /** What the view holds, in order, and what the toolbar holds: each element by its ID, or its kind. */
    const places = () => [page.id("view").children.map(child => child.id || child.localName), page.find(".toolbar").children.map(child => child.id)];
    const expected = [["h1", "div", "tableWrap"], ["searchWrap", "colBtn", "resetBtn", "rowCount", "pager"]];
    expect(places()).toEqual(expected);
    expect([page.id("rowCount").textContent, pagerButtons().join(" "), page.id("pager").contains(page.id("pageSize")), page.id("pageSize").value]).toEqual(["1–50 of 120 rows", "(‹) ›", true, "50"]);
    // A page turn, another number of rows per page and a search draw the pager again, where it stands.
    const pager = page.id("pager");
    page.find('.pg-btn[aria-label="Next page"]').press();
    page.id("pageSize").choose("25");
    page.id("tblSearch").type("item 1");
    expect([places(), page.id("pager") === pager, page.id("rowCount").textContent, pagerButtons().join(" ")]).toEqual([expected, true, "1–25 of 32 rows (filtered from 120)", "(‹) ›"]);
    // A table of one page has its count, its two buttons, both disabled, and the list of page sizes there as well.
    goTo(2);
    expect([places(), page.id("rowCount").textContent, pagerButtons().join(" "), page.id("pager").contains(page.id("pageSize")), page.id("pageSize").value])
      .toEqual([expected, "1–2 of 2 rows", "(‹) (›)", true, "25"]);
    // With no row to show, the count says so and the pager is there, empty.
    page.id("tblSearch").type("no such module");
    expect([places(), page.id("rowCount").textContent, page.id("pager").children]).toEqual([expected, "No rows (filtered from 2)", []]);
  });

  it("takes the slash key to the search box, and leaves a slash that is typed into a box alone", async () => {
    await openWith(APP);
    // The overview has no search box: the key is left to the browser.
    expect(page.key("/").defaultPrevented).toBe(false);
    goTo(2);
    expect(page.document.activeElement).toBe(page.id("view"));
    const slash = page.key("/");
    expect([slash.defaultPrevented, page.document.activeElement === page.id("tblSearch")]).toEqual([true, true]);
    // In the box, and in the list of page sizes, the key is a character like any other.
    expect(page.key("/").defaultPrevented).toBe(false);
    page.id("pageSize").focus();
    expect([page.key("/").defaultPrevented, page.document.activeElement === page.id("pageSize")]).toEqual([false, true]);
    // Other keys are not taken either.
    page.id("view").focus();
    expect([page.key("a").defaultPrevented, page.key("Enter").defaultPrevented, page.document.activeElement === page.id("view")]).toEqual([false, false, true]);
  });

  it("closes with Escape what is open: a popover, the drawer", async () => {
    await openWith(APP);
    goTo(2);
    // Nothing open: nothing happens. The navigation is not something to close: it stays where it is.
    page.key("Escape");
    expect([page.id("popover").hidden, drawerShown(), shows(), page.id("topnav").hidden]).toEqual([true, false, ["Cards", "Cards"], false]);
    page.id("colBtn").press();
    page.key("Escape");
    expect(page.id("popover").hidden).toBe(true);
    cardLinks()[0].press();
    expect(drawerShown()).toBe(true);
    page.key("Escape");
    // The drawer slides out, and is out of the page once it has, with the scrim.
    expect([drawerShown(), page.id("drawer").hidden, page.id("scrim").hidden]).toEqual([false, false, false]);
    vi.advanceTimersByTime(210);
    expect([page.id("drawer").hidden, page.id("scrim").hidden]).toEqual([true, true]);
    // Opened again before it has slid out, it stays.
    cardLinks()[0].press();
    page.key("Escape");
    cardLinks()[1].press();
    vi.advanceTimersByTime(500);
    expect([drawerShown(), page.id("drawer").hidden, page.id("drawerTitle").textContent]).toEqual([true, false, "Card 2 - Margin"]);
  });

  it("follows the system's colour theme until one is chosen, and keeps the choice", async () => {
    systemDark = true;
    await open(clicked(42));
    const theme = () => [page.document.documentElement.dataset.theme, page.id("themeToggle").title, page.all("#themeToggle svg").length];
    expect(theme()).toEqual(["dark", "Switch to light theme", 1]);
    // The system changes its theme: the page follows, as long as none was chosen here.
    systemListeners[0]({ matches: false });
    expect(theme()).toEqual(["light", "Switch to dark theme", 1]);
    // The button changes the theme and remembers it.
    page.id("themeToggle").press();
    expect([theme(), stored.get("cardigan-theme")]).toEqual([["dark", "Switch to light theme", 1], "dark"]);
    page.id("themeToggle").press();
    expect([theme(), stored.get("cardigan-theme")]).toEqual([["light", "Switch to dark theme", 1], "light"]);
    // A chosen theme stays when the system changes, and when the page is opened again.
    systemListeners[0]({ matches: true });
    expect(theme()[0]).toBe("light");
    await open(clicked(42));
    expect([systemDark, theme()[0]]).toEqual([true, "light"]);
    // Something else under that name is no choice.
    stored.set("cardigan-theme", "sepia");
    await open(clicked(42));
    expect(theme()[0]).toBe("dark");
  });

  it("opens the overview's closed sections from the keyboard, and copies the result's diagnostic log line for line", async () => {
    await openWith(APP);
    const log = "14:02:05 Cardigan dev: app 01234567 on us1a.app.anaplan.com\n14:02:06 app: 2 pages\na line without a time";
    const section = page.find("#ovLog");
    const summary = page.find("#ovLog summary");
    const copy = page.find('#view [data-act="copy-diag"]');
    // Diagnostics starts closed: its summary takes the focus with the Tab key, and what it holds is out of reach.
    expect([section.localName, section.hasAttribute("open"), summary.focusable, summary.textContent.trim(), copy.focusable, page.id("diagLog").focusable]).toEqual(["details", false, true, "Diagnostics", false, false]);
    expect(() => copy.press()).toThrow("it is in a closed <details>");
    // Enter on the summary opens it: the log is there line for line, and the button that copies it can be chosen.
    summary.focus();
    page.document.activeElement.press();
    expect([section.hasAttribute("open"), copy.focusable, page.id("diagLog").focusable, page.id("diagLog").textContent]).toEqual([true, true, true, log]);
    copy.press();
    await settle();
    expect([copied, page.id("toast").textContent]).toEqual([[log], "Copied the diagnostic log"]);
    // Enter again closes it. The page's own keys leave the section alone: Escape and the slash do nothing to it.
    summary.press();
    expect(section.hasAttribute("open")).toBe(false);
    summary.press();
    expect([page.key("Escape").defaultPrevented, page.key("/").defaultPrevented, section.hasAttribute("open")]).toEqual([false, false, true]);
  });

  it("says on the overview everything the Details file holds, for an app and for a model: no row is dropped", async () => {
    /** Every text the overview shows, with its closed sections' as well. */
    const texts = () => [...page.texts("#view dt"), ...page.texts("#view dd"), ...page.texts("#view .warn-list li"), ...page.id("diagLog").textContent.split("\n")];
    /** What each file's tile says of its rows, by the file's own name, which is its entry's in the navigation (the tiles
     * stand in the same order): the number its table lists, and under it the number there is in all where that is another. */
    const tiles = () => tableEntries().flatMap((item, index) => {
      const tile = page.all("#view .stat")[index];
      const file = `${entryLabel(item)}.csv`;
      return [`${file}: ${tile.querySelector(".s-num")?.textContent} rows`, ...tile.querySelectorAll(".s-sub").slice(1).map(line => `${file}: ${line.textContent.replace(/ in all$/, "")}`)];
    });
    /** The rows of a result's Details file that the overview does not say: a detail and its value, a note, a line of the log, or a file's tile. */
    const unsaid = (result: AnalysisResult) => {
      const shown = texts();
      return result.tables[0].rows.map(row => row.map(String)).filter(([section, detail, value]) => {
        if (section === "Diagnostics") return !shown.includes(detail ? `${detail} ${value}` : value);
        if (section === "Notes") return !shown.includes(`${detail}: ${value}`);
        if (section === "Files" && /^\d+ rows$/.test(value)) return !tiles().includes(`${detail}: ${value}`);
        // Any other Files row is said under the name the page has for the table: the file's own name is shown nowhere.
        if (section === "Files") return !(shown.includes(detail.replace(/\.csv$/, "")) && shown.includes(value));
        return !(shown.includes(detail) && shown.includes(value));
      });
    };
    const withFiles = (result: AnalysisResult, ...more: Cell[][]): AnalysisResult => ({ ...result, tables: [{ ...result.tables[0], rows: [...result.tables[0].rows,
      ...result.tables.slice(1).map((table): Cell[] => ["Files", table.file, `${table.rows.length} rows`]), ...more] }, ...result.tables.slice(1)] });
    // An app: what it is and how it was exported, a note, and how to read the tables.
    const app = withFiles(APP, ["Notes", "Archive", "Not published"], ["How to read", "Page and Card #", "Identify a card in every table."]);
    await openWith(app);
    expect([app.tables[0].rows.length, unsaid(app)]).toEqual([11, []]);
    expect(page.texts("#view h2")).toEqual(["About this export", "Notes", "How to read these tables", "Diagnostics"]);
    expect([page.texts("#ovAbout dt"), page.has("#ovFiles")]).toEqual([["App", "Anaplan host"], false]);
    // A model, one of whose files was not exported and another counted with a remark: those two are said under Tables,
    // each by the name the page has for the table.
    const model = withFiles(MODEL, ["Files", "Source Models.csv", "Not exported: This model page has no REMOTE_MODEL axis."], ["How to read", "Layout", "As Anaplan's own export."]);
    model.tables[0].rows[4] = ["Files", "Modules.csv", "2 rows (as listed)"];
    page.id("runAgain").press();
    sendResult(ports[0], model);
    expect([model.tables[0].rows.length, unsaid(model)]).toEqual([7, []]);
    expect([page.texts("#view h2"), page.texts("#ovFiles dt"), page.texts("#ovFiles dd")]).toEqual([["About this export", "Tables", "How to read these tables", "Diagnostics"],
      ["Modules", "Source Models"], ["2 rows (as listed)", "Not exported: This model page has no REMOTE_MODEL axis."]]);
    // No file's name is on the page: a table is said by its name alone.
    expect(page.id("view").textContent).not.toMatch(/\.csv/);

    // What the export says both in its summary and in a Files row is on the page once, with the tables: the Notes panel
    // has only what is a note.
    const twice: AnalysisResult = { ...model, summary: ["Line Items: 120 rows", "Modules: 2 rows (as listed)", "Source Models: not exported (This model page has no REMOTE_MODEL axis.).",
      "Actions: the Actions list came without Notes."] };
    page.id("runAgain").press();
    sendResult(ports[0], twice);
    expect([page.texts("#view .warn-list li"), page.texts("#ovFiles dt"), page.texts("#ovFiles dd")]).toEqual([["Actions: the Actions list came without Notes."],
      ["Modules", "Source Models"], ["2 rows (as listed)", "Not exported: This model page has no REMOTE_MODEL axis."]]);
    expect(["2 rows (as listed)", "REMOTE_MODEL"].map(said => page.id("view").textContent.split(said).length - 1)).toEqual([1, 1]);

    // A model one of whose tables lists fewer rows than its file has: the calendar, with its rows about the model. The
    // Details file counts all of each file's rows, 8 and 31.
    const left: AnalysisResult = { ...BLUEPRINT, summary: ["Line Items: 8 rows", "Modules: 3 rows", "Model Calendar: 31 rows"], tables: [...BLUEPRINT.tables, WITH_CALENDAR.tables[3]] };
    const counted = withFiles(left);
    expect(counted.tables[0].rows.filter(row => row[0] === "Files")).toEqual([["Files", "Line Items.csv", "8 rows"], ["Files", "Modules.csv", "3 rows"], ["Files", "Model Calendar.csv", "31 rows"]]);
    page.id("runAgain").press();
    sendResult(ports[0], counted);
    // The tiles count what the tables list, 5 settings and every row of Line Items, and the calendar's says the 31 there
    // are in all under that: no count of the Details file is lost, and no row of it is.
    expect(page.all("#view .stat").map(tile => tile.children.map(child => child.textContent))).toEqual([["Model Calendar", "5", "rows", "31 rows in all"], ["Modules", "3", "rows"],
      ["Line Items", "8", "rows"]]);
    expect([tiles(), unsaid(counted), page.has("#ovFiles"), page.has("#view .warn-list")]).toEqual([["Model Calendar.csv: 5 rows", "Model Calendar.csv: 31 rows", "Modules.csv: 3 rows",
      "Line Items.csv: 8 rows"], [], false, false]);
  });

  it("says what was copied as text, whatever the ID holds, for a moment", async () => {
    // An ID is a cell like any other: it can hold what an Anaplan user typed.
    await openWith({ ...APP, tables: APP.tables.map((table, index) => (index === 3 ? { ...table, rows: [["Overview", 1, 1, "Own rows and columns", "REP01 Sales", `card ${TAG}`]] } : table)) });
    goTo(3);
    toggleColumn("Card ID");
    page.find("#tableWrap tbody .id-pill").press();
    await settle();
    expect([copied, page.id("toast").textContent, page.id("toast").children, strayImg()]).toEqual([[`card ${TAG}`], `Copied card ${TAG}`, [], false]);
    // The same when the clipboard refuses and the text box is used instead.
    clipboardRefuses = true;
    page.commandWorks = true;
    page.find("#tableWrap tbody .id-pill").press();
    await settle();
    expect([page.created.map(element => element.value), page.id("toast").textContent, strayImg()]).toEqual([[`card ${TAG}`], `Copied card ${TAG}`, false]);
    // The page says so for a moment, counted from the last copy. (The result is kept first: the page does that in a turn
    // of its own once the clock moves, and would still be at it when the test ends.)
    await letKeep();
    vi.advanceTimersByTime(1500);
    page.find("#tableWrap tbody .id-pill").press();
    await settle();
    expect(page.id("toast").classList.contains("show")).toBe(true);
    vi.advanceTimersByTime(2199);
    expect(page.id("toast").classList.contains("show")).toBe(true);
    vi.advanceTimersByTime(1);
    expect(page.id("toast").classList.contains("show")).toBe(false);
  });

  it("copies through a text box when the clipboard refuses, and says so when that fails too", async () => {
    await openWith(APP);
    goTo(3);
    toggleColumn("Card ID");
    clipboardRefuses = true;
    page.commandWorks = true;
    page.find("#tableWrap tbody .id-pill").press();
    await settle();
    // The text box held the ID, was asked to copy it, and is gone again.
    expect([page.commands, page.id("toast").textContent, copied]).toEqual([["copy"], "Copied card-a", []]);
    expect(page.created.map(element => [element.localName, element.value, element.isConnected])).toEqual([["textarea", "card-a", false]]);
    page.commandWorks = false;
    page.find("#tableWrap tbody .id-pill").press();
    await settle();
    expect([page.commands, page.id("toast").textContent, page.has("textarea")]).toEqual([["copy", "copy"], "Copy failed", false]);
  });
});

describe("An app's Where Used table, by object and by use", () => {
  /** An app as the analysis lays its files out, with the columns the by-object view reads: two pages of one model, three
   * cards, and eight uses of four objects, in page and card order as the file has them. */
  const USES: Cell[][] = [
    ["Module", "REP01 Sales", "-", "Overview", 1, "Source module", "102000000001"],
    ["Line item", "Revenue", "REP01 Sales", "Overview", 1, "Line item shown", "1901000000001"],
    ["Dimension", "Time", "-", "Overview", 1, "Column dimension", "20000000003"],
    ["Module", "REP01 Sales", "-", "Overview", 2, "Source module", "102000000001"],
    ["Dimension", "Time", "-", "Overview", 2, "Context selector", "20000000003"],
    ["Module", "REP02 Stores", "-", "Stores", 1, "Source module", "102000000002"],
    ["Dimension", "Time", "-", "Stores", 1, "Column dimension", "20000000003"],
    ["Line item", "Revenue", "REP01 Sales", "Stores", 1, "Filter line item", "1901000000001"],
  ];
  const whereUsed = (uses: Cell[][], pages: Cell[][], cards: Cell[][]): AnalysisResult => ({
    kind: "app", name: "Demo app", id: "01234567-89ab-cdef-0123-456789abcdef", zipName: "Demo app - App Export - 2026-10-03.zip", summary: [],
    tables: [
      { file: "App Details.csv", label: "App Details", headers: ["Section", "Detail", "Value"], guard: true, details: true, rows: [["App", "App", "Demo app"]] },
      { file: "Pages.csv", label: "Pages", headers: ["App", "Page", "Model", "Workspace", "Model ID"], guard: true, rows: pages },
      { file: "Cards.csv", label: "Cards", headers: ["Page", "Card #", "Card title", "Card type", "Card ID"], guard: true, rows: cards },
      { file: "Where Used.csv", label: "Where Used", headers: ["Object type", "Object name", "Object's module", "Page", "Card #", "Used as", "Object ID"], guard: true, rows: uses },
    ],
  });
  const MODEL_ID = "0A".repeat(16);
  const WHERE = whereUsed(USES, [["Demo app", "Overview", "Model one", "Main", MODEL_ID], ["Demo app", "Stores", "Model one", "Main", MODEL_ID]],
    [["Overview", 1, "Sales", "Grid", "card-a"], ["Overview", 2, "Margin", "KPI", "card-b"], ["Stores", 1, "Stores grid", "Grid", "card-c"]]);

  /** The headings of the columns on screen, and the rows on screen by the text of one column. */
  const headings = () => page.all("#tableWrap thead .th-sort").map(button => button.textContent.trim().replace(/[▲▼]$/, ""));
  const column = (heading: string) => page.all("#tableWrap tbody tr").map(row => row.children[headings().indexOf(heading)].textContent.trim());
  /** The switch: each way's words, with a mark on the one that is shown, as assistive technology is told and as it looks. */
  const ways = () => page.all("#tableWays button").map(button => `${button.textContent.trim()}${button.getAttribute("aria-pressed") === "true" ? " (shown)" : ""}${button.classList.contains("primary") ? " filled" : ""}`);
  const way = (name: "object" | "use") => page.find(`#tableWays [data-way="${name}"]`);
  /** The rows of a table in the drawer, cell by cell. */
  const drawerRows = (section: number) => page.all("#drawerBody .d-sec")[section].querySelectorAll("tbody tr").map(row => row.children.map(cell => cell.textContent.trim()));
  const rowButton = (name: string) => page.all('#tableWrap tbody [data-act="row"]')[column("Object name").indexOf(name)];

  it("lists the file by object at first: one row an object, with its pages, its cards and what it is used as; the tile counts the uses", async () => {
    await openWith(WHERE);
    // The file's number of uses is what the overview's tile says, whichever way the table lists them.
    expect(page.all("#view .stat").map(tile => tile.children.map(child => child.textContent))).toEqual([["Pages", "2", "rows"], ["Cards", "3", "rows"], ["Model objects", "8", "rows"]]);

    goTo(3);
    // The switch stands at the head of the toolbar, with By object shown: said to assistive technology, and filled.
    expect([page.find(".toolbar").children.map(child => child.id), page.id("tableWays").getAttribute("role"), page.id("tableWays").getAttribute("aria-label"), ways()])
      .toEqual([["tableWays", "searchWrap", "colBtn", "resetBtn", "rowCount", "pager"], "group", "How Where Used is listed", ["By object (shown) filled", "Every use"]]);
    expect(page.all("#tableWays button").every(button => button.localName === "button" && button.focusable)).toBe(true);
    // One row an object, in the order of an index: by type, then by name. The ID is there to choose, as in the file's own table.
    expect(headings()).toEqual(["Object type", "Object name", "Object's module", "Pages", "Cards", "Used as"]);
    expect(page.all("#tableWrap tbody tr").map(row => row.children.map(cell => cell.textContent.trim()))).toEqual([
      ["Module", "REP01 Sales", "-", "1", "2", "Source module"],
      ["Module", "REP02 Stores", "-", "1", "1", "Source module"],
      ["Line item", "Revenue", "REP01 Sales", "2", "2", "Line item shown; Filter line item"],
      ["Dimension", "Time", "-", "2", "3", "Column dimension; Context selector"]]);
    // The line under the name says how many uses that is, and of how many objects, and where each of them is listed: it
    // names the switch's other button as that reads. The count beside the pager is the table's.
    expect([page.texts("#view .view-note"), page.id("rowCount").textContent, page.id("live").textContent, page.texts("#view h1")])
      .toEqual([["8 uses of 4 objects. Choose Every use to list each one."], "1–4 of 4 rows", "Where Used: 4 rows", ["Where Used"]]);
    expect(page.texts("#view .view-note")[0]).toContain(`Choose ${page.find('#tableWays [data-way="use"]').textContent.trim()} to list`);
    // No cell of it leads anywhere by itself: a row opens its object.
    expect([page.all('#tableWrap tbody [data-act="page"]').length, page.all('#tableWrap tbody [data-act="card"]').length, page.all('#tableWrap tbody [data-act="row"]').length]).toEqual([0, 0, 4]);

    // The search, a column's filter, the sort and the chooser work on the objects.
    page.id("tblSearch").type("revenue");
    expect([column("Object name"), page.id("rowCount").textContent]).toEqual([["Revenue"], "1–1 of 1 row (filtered from 4)"]);
    page.id("tblSearch").type("");
    page.find('[data-colfilter="0"]').press();
    expect(choices()).toEqual([["Dimension", "1", true], ["Line item", "1", true], ["Module", "2", true]]);
    page.all("#popover input")[2].tick();
    expect(column("Object name")).toEqual(["Revenue", "Time"]);
    page.key("Escape");
    page.id("resetBtn").press();
    // The two counts are numbers, and sort as numbers; until a sort is chosen the table keeps the order it came in.
    page.find('[data-sort="4"]').press();
    page.find('[data-sort="4"]').press();
    expect([column("Object name"), column("Cards")]).toEqual([["Time", "REP01 Sales", "Revenue", "REP02 Stores"], ["3", "2", "2", "1"]]);
    page.id("resetBtn").press();
    expect(column("Object name")).toEqual(["REP01 Sales", "REP02 Stores", "Revenue", "Time"]);
    page.id("colBtn").press();
    expect(page.all("#popover .pop-opt").map(option => `${option.children[1].textContent}${option.children[0].checked ? " ✓" : ""}`))
      .toEqual(["Object type ✓", "Object name ✓", "Object's module ✓", "Pages ✓", "Cards ✓", "Used as ✓", "Object ID"]);
    page.all("#popover input")[6].tick();
    expect(column("Object ID")).toEqual(["102000000001", "102000000002", "1901000000001", "20000000003"]);
  });

  it("shows every use with the switch, and by object again; each way keeps what was chosen for it, and the choice lasts while the page is open", async () => {
    await openWith(WHERE);
    goTo(3);
    page.find('[data-sort="4"]').press();
    way("use").press();
    // Every use: the file's own table as before, one row a use, with nothing under its name. The switch has the focus still.
    expect([ways(), page.document.activeElement === way("use"), page.all("#view .view-note").length]).toEqual([["By object", "Every use (shown) filled"], true, 0]);
    expect([headings(), page.id("rowCount").textContent, column("Object name"), column("Page")]).toEqual([["Object type", "Object name", "Object's module", "Page", "Used as"], "1–8 of 8 rows",
      USES.map(use => String(use[1])), USES.map(use => String(use[3]))]);
    // Its page is a link again, and the sort chosen by object is not its own.
    expect([page.all('#tableWrap tbody [data-act="page"]').length, page.all("#tableWrap thead th").filter(heading => heading.getAttribute("aria-sort") !== "none").length, page.id("resetBtn").hidden]).toEqual([8, 0, true]);
    // The navigation is the same in both ways: one entry for the file, the one marked as shown.
    expect([tableEntries().map(entryLabel), page.find('#navList [aria-current="page"]').dataset.nav]).toEqual([["Pages", "Cards", "Where Used"], "3"]);

    // Back by object: the sort chosen there is still in force.
    way("object").press();
    expect([ways(), page.document.activeElement === way("object"), column("Object name"), page.texts("#view .view-note")])
      .toEqual([["By object (shown) filled", "Every use"], true, ["REP02 Stores", "REP01 Sales", "Revenue", "Time"], ["8 uses of 4 objects. Choose Every use to list each one."]]);
    // The search goes with the user from one way to the other: the object that was looked for, and then its uses.
    page.id("tblSearch").type("time");
    expect(column("Object name")).toEqual(["Time"]);
    way("use").press();
    expect([page.id("tblSearch").value, column("Used as"), page.id("rowCount").textContent]).toEqual(["time", ["Column dimension", "Context selector", "Column dimension"], "1–3 of 3 rows (filtered from 8)"]);

    // The choice lasts: through another table and back, and through a new result.
    goTo(1);
    goTo(3);
    expect([ways(), page.id("rowCount").textContent]).toEqual([["By object", "Every use (shown) filled"], "1–8 of 8 rows"]);
    page.id("runAgain").press();
    sendResult(ports[0], WHERE);
    goTo(3);
    expect([ways(), page.id("rowCount").textContent]).toEqual([["By object", "Every use (shown) filled"], "1–8 of 8 rows"]);
    way("object").press();
    expect([ways(), page.id("rowCount").textContent]).toEqual([["By object (shown) filled", "Every use"], "1–4 of 4 rows"]);
  });

  it("opens an object from its row: what it is, what it is used as, and its uses by page; a use's page shows that page's cards and its card opens the card", async () => {
    await openWith(WHERE);
    goTo(3);
    rowButton("Time").press();
    // Headed by the object's name. Under it its type, its ID to copy, and on how many pages and cards it is used; its
    // module says nothing, and an app of one model has no model to tell it apart by.
    expect([page.id("drawer").hidden, page.id("drawerTitle").textContent, page.id("drawerSub").textContent, page.find("#drawerSub .id-pill").dataset.copy])
      .toEqual([false, "Time", "Dimension · 20000000003 · 2 pages, 3 cards", "20000000003"]);
    expect(page.texts("#drawerBody h3")).toEqual(["Used as", "Uses (3)"]);
    // Each role with its number of uses, the most used first.
    expect(drawerRows(0)).toEqual([["Column dimension", "2"], ["Context selector", "1"]]);
    // Its uses in the file's order, by page: a page is named with its first use, and to a screen reader with each.
    expect(drawerRows(1)).toEqual([["Overview", "1", "Column dimension"], ["Overview", "2", "Context selector"], ["Stores", "1", "Column dimension"]]);
    const uses = () => page.all("#drawerUses tbody tr");
    expect(uses().map(row => [row.children[0].querySelectorAll("button").length, row.children[0].querySelectorAll(".sr-only").length, row.children[1].querySelectorAll("button").length]))
      .toEqual([[1, 0, 1], [0, 1, 1], [1, 0, 1]]);
    expect(page.has("#drawerBody [data-act=\"more-uses\"]")).toBe(false);

    // A card's number opens that card: the second use is on card 2 of Overview.
    uses()[1].children[1].querySelector("button")?.press();
    expect([page.id("drawerTitle").textContent, page.texts("#drawerSub .link"), page.texts("#drawerBody h3")[0]]).toEqual(["Card 2 - Margin", ["Overview"], "Card details"]);
    // The drawer closes back to the row that opened it from the table.
    page.key("Escape");
    expect(page.document.activeElement).toBe(rowButton("Time"));
    // A page's name shows that page's cards: the third use is on Stores.
    rowButton("Time").press();
    uses()[2].children[0].querySelector("button")?.press();
    expect([page.texts("#view h1"), page.texts("#pageFilter"), page.all("#tableWrap tbody tr").map(row => row.children[1].textContent.trim()), page.id("drawer").classList.contains("show")])
      .toEqual([["Cards"], ["Page: Stores"], ["Stores grid"], false]);

    // An object with a module says it; the ID's pill copies the ID.
    goTo(3);
    rowButton("Revenue").press();
    expect([page.id("drawerTitle").textContent, page.id("drawerSub").textContent, drawerRows(0), drawerRows(1)]).toEqual(["Revenue", "Line item · REP01 Sales · 1901000000001 · 2 pages, 2 cards",
      [["Line item shown", "1"], ["Filter line item", "1"]], [["Overview", "1", "Line item shown"], ["Stores", "1", "Filter line item"]]]);
    page.find("#drawerSub .id-pill").press();
    await settle();
    expect(copied).toEqual(["1901000000001"]);
    page.key("Escape");
    // In the other way a row is a use, and opens as any row does.
    way("use").press();
    page.all('#tableWrap tbody [data-act="row"]')[2].press();
    expect([page.id("drawerTitle").textContent, page.id("drawerSub").textContent, page.texts("#drawerBody h3")]).toEqual(["Time", "Row 3 of Where Used", ["All columns"]]);
  });

  it("says of an object used on a page name that two pages share that its counts are at least that many, why, and which of its uses those are", async () => {
    // Two pages are called Overview, and the file has only a page's name. Time is used there on card 1 in two ways and on
    // card 2: on one of the two pages, or on both. REP02 Stores is used on Stores only.
    const uses: Cell[][] = [
      ["Dimension", "Time", "-", "Overview", 1, "Column dimension", "20000000003"],
      ["Dimension", "Time", "-", "Overview", 1, "Context selector", "20000000003"],
      ["Dimension", "Time", "-", "Overview", 2, "Column dimension", "20000000003"],
      ["Module", "REP02 Stores", "-", "Stores", 1, "Source module", "102000000002"],
      ["Dimension", "Time", "-", "Stores", 1, "Column dimension", "20000000003"],
    ];
    const pages: Cell[][] = [["Demo app", "Overview", "Model one", "Main", MODEL_ID], ["Demo app", "Overview", "Model one", "Main", MODEL_ID], ["Demo app", "Stores", "Model one", "Main", MODEL_ID]];
    // Both Overview pages have a card 1; only one of them has a card 2.
    const cards: Cell[][] = [["Overview", 1, "Sales", "Grid", "card-a"], ["Overview", 2, "Margin", "KPI", "card-b"], ["Overview", 1, "Sales, copied", "Grid", "card-x"], ["Stores", 1, "Stores grid", "Grid", "card-c"]];
    await openWith(whereUsed(uses, pages, cards));
    goTo(3);
    // The table says so in the cells, with a plus sign, and in the line under its name.
    expect([column("Object name"), column("Pages"), column("Cards")]).toEqual([["REP02 Stores", "Time"], ["1", "2+"], ["1", "3+"]]);
    expect(page.texts("#view .view-note")[0]).toContain('1 page name is shared by more than one page: "Overview" (2 pages).');

    // The object's drawer says the same of its counts, in words: at least so many. No number is said as exact that is not.
    rowButton("Time").press();
    const said = page.id("drawerSub");
    expect([page.id("drawerTitle").textContent, said.childNodes.filter(node => node.nodeType === 3).map(node => node.textContent).join("").trim(), said.textContent.includes("2 pages, 3 cards")])
      .toEqual(["Time", "Dimension ·  · at least 2 pages, at least 3 cards", false]);
    // Under that line, why: which name is shared, and what the counts can be.
    expect(said.querySelectorAll("div").map(note => note.textContent)).toEqual(['It has 3 uses on a page name that more than one page has: "Overview" (2 pages). '
      + "The table has only the name of a use's page, so which of those pages a use is on is not known. It is on 2 or 3 pages and on 3 or 4 cards."]);
    // Its uses: the three under Overview may be on either page of that name, and the name says that two pages have it,
    // to the eye where it heads them and to a screen reader with each. Stores is one page.
    const listed = () => page.all("#drawerUses tbody tr");
    expect(listed().map(row => row.children.map(cell => cell.textContent.trim()))).toEqual([["Overview (2 pages have this name)", "1", "Column dimension"],
      ["Overview, 2 pages have this name", "1", "Context selector"], ["Overview, 2 pages have this name", "2", "Column dimension"], ["Stores", "1", "Column dimension"]]);
    expect(listed().map(row => [row.children[0].querySelectorAll("button").length, row.children[0].querySelectorAll(".sr-only").length])).toEqual([[1, 0], [0, 1], [0, 1], [1, 0]]);
    // Card 1 of Overview is two cards, so its number is no link; card 2 is one card, and opens.
    expect(listed().map(row => row.children[1].querySelectorAll("button").length)).toEqual([0, 0, 1, 1]);
    listed()[2].children[1].querySelector("button")?.press();
    expect([page.id("drawerTitle").textContent, page.texts("#drawerSub .link")]).toEqual(["Card 2 - Margin", ["Overview"]]);
    page.key("Escape");
    // The shared name still leads to the cards of that name: both pages'.
    rowButton("Time").press();
    listed()[0].children[0].querySelector("button")?.press();
    expect([page.texts("#pageFilter"), page.all("#tableWrap tbody tr").map(row => row.children[1].textContent.trim())]).toEqual([["Page: Overview"], ["Sales", "Margin", "Sales, copied"]]);

    // An object none of whose uses is on a shared name reads exactly as before: its counts as they are, no note, no mark.
    goTo(3);
    rowButton("REP02 Stores").press();
    expect([page.id("drawerSub").textContent, page.id("drawerSub").querySelectorAll("div").length, listed().map(row => row.children.map(cell => cell.textContent.trim()))])
      .toEqual(["Module · 102000000002 · 1 page, 1 card", 0, [["Stores", "1", "Source module"]]]);
  });

  it("lists the first fifty of an object's uses, by page, and all of them on request", async () => {
    // Sixty pages of two cards, each card with Time as its columns: 120 uses of one object, and one of another.
    const pages = Array.from({ length: 60 }, (_, index): Cell[] => ["Demo app", `Page ${index + 1}`, "Model one", "Main", MODEL_ID]);
    const cards = pages.flatMap((entry, index): Cell[][] => [[entry[1], 1, "First", "Grid", `card-${index}-1`], [entry[1], 2, "Second", "Grid", `card-${index}-2`]]);
    const uses = cards.map((card): Cell[] => ["Dimension", "Time", "-", card[0], card[1], "Column dimension", "20000000003"]);
    await openWith(whereUsed([...uses, ["Module", "REP01 Sales", "-", "Page 1", 1, "Source module", "102000000001"]], pages, cards));
    goTo(3);
    expect([page.texts("#view .view-note"), column("Pages"), column("Cards")]).toEqual([["121 uses of 2 objects. Choose Every use to list each one."], ["1", "60"], ["1", "120"]]);
    rowButton("Time").press();
    const listed = () => page.all("#drawerUses tbody tr");
    expect([page.id("drawerSub").textContent, page.texts("#drawerBody h3"), listed().length]).toEqual(["Dimension · 20000000003 · 60 pages, 120 cards", ["Used as", "Uses (120)"], 50]);
    // The first fifty, which is twenty-five pages of two: each page named once.
    expect([listed()[0].children.map(cell => cell.textContent.trim()), listed()[49].children.map(cell => cell.textContent.trim()), page.all('#drawerUses [data-act="use-page"]').length])
      .toEqual([["Page 1", "1", "Column dimension"], ["Page 25", "2", "Column dimension"], 25]);
    expect(page.find("#drawerUses p").textContent.replace(/\s+/g, " ").trim()).toBe("The first 50 of 120 uses are listed. Show all 120 uses");
    // The control lists them all, and goes with that: the first use it added takes the focus.
    const more = page.find('#drawerUses [data-act="more-uses"]');
    expect([more.localName, more.focusable]).toEqual(["button", true]);
    more.press();
    expect([listed().length, page.has('#drawerUses [data-act="more-uses"]'), page.has("#drawerUses p"), page.id("live").textContent]).toEqual([120, false, false, "All 120 uses are listed."]);
    expect([page.document.activeElement === listed()[50], listed()[50].children.map(cell => cell.textContent.trim()), listed()[119].children.map(cell => cell.textContent.trim())])
      .toEqual([true, ["Page 26", "1", "Column dimension"], ["Page 60", "2", "Column dimension"]]);
    // A use beyond the first fifty leads where it says: card 2 of Page 60.
    listed()[119].children[1].querySelector("button")?.press();
    expect([page.id("drawerTitle").textContent, page.texts("#drawerSub .link")]).toEqual(["Card 2 - Second", ["Page 60"]]);
    // Opened again, the drawer lists the first fifty again.
    page.key("Escape");
    rowButton("Time").press();
    expect(listed().length).toBe(50);
  });

  it("opens a use's card from its row as every use too, where the result has the card: the card's number is a link in the row's drawer and in the table", async () => {
    // One more use, on a card the Cards file does not have.
    const gone: Cell[] = ["Module", "REP03 Gone", "-", "Overview", 9, "Source module", "102000000003"];
    await openWith(whereUsed([...USES, gone], WHERE.tables[1].rows, WHERE.tables[2].rows));
    goTo(3);
    way("use").press();
    // The card's number starts hidden, as in every table. The row's drawer lists every column: there the number opens the
    // card the use is on, as it does from the object's drawer by object.
    expect(headings()).toEqual(["Object type", "Object name", "Object's module", "Page", "Used as"]);
    const rowButton = (index: number) => page.all('#tableWrap tbody [data-act="row"]')[index];
    rowButton(4).press();
    expect([page.id("drawerTitle").textContent, page.id("drawerSub").textContent, page.texts("#drawerBody dt")])
      .toEqual(["Time", "Row 5 of Where Used", ["Object type", "Object name", "Object's module", "Page", "Card #", "Used as", "Object ID"]]);
    expect(page.all('#drawerBody [data-act="card"]').map(link => [link.textContent, link.title])).toEqual([["2", "Open card details"]]);
    page.find('#drawerBody [data-act="card"]').press();
    expect([page.id("drawerTitle").textContent, page.texts("#drawerSub .link"), page.texts("#drawerBody h3")[0]]).toEqual(["Card 2 - Margin", ["Overview"], "Card details"]);
    // The drawer closes back to the row that opened it from the table.
    page.key("Escape");
    expect(page.document.activeElement).toBe(rowButton(4));
    // The card of the right page: card 1 of Stores, not card 1 of Overview.
    rowButton(6).press();
    page.find('#drawerBody [data-act="card"]').press();
    expect([page.id("drawerTitle").textContent, page.texts("#drawerSub .link")]).toEqual(["Card 1 - Stores grid", ["Stores"]]);
    page.key("Escape");
    // A use on a card the result does not have: its number is a number, and the row's page is a link still.
    rowButton(8).press();
    expect([page.id("drawerTitle").textContent, page.texts("#drawerBody dd")[4], page.all('#drawerBody [data-act="card"]').length, page.all('#drawerBody [data-act="page"]').length])
      .toEqual(["REP03 Gone", "9", 0, 1]);
    page.key("Escape");
    // With the column shown, the same holds in the table: a link in each row whose card is there, the number alone in the other.
    page.id("colBtn").press();
    page.all("#popover .pop-opt").find(option => option.children[1].textContent === "Card #")?.children[0].tick();
    page.key("Escape");
    expect([column("Card #"), page.all("#tableWrap tbody tr").map(row => row.querySelectorAll('[data-act="card"]').length)]).toEqual([["1", "1", "1", "2", "2", "1", "1", "1", "9"], [1, 1, 1, 1, 1, 1, 1, 1, 0]]);
    page.all('#tableWrap tbody [data-act="card"]')[3].press();
    expect(page.id("drawerTitle").textContent).toBe("Card 2 - Margin");
  });

  it("shows the file's own table, without a switch, where the result does not have what the view by object takes", async () => {
    // An app whose Pages file names no model: the same table as ever.
    await openWith(APP);
    goTo(4);
    expect([page.has("#tableWays"), page.find(".toolbar").children.map(child => child.id), page.all("#view .view-note").length, page.id("rowCount").textContent,
      page.all('#tableWrap tbody [data-act="page"]').length]).toEqual([false, ["searchWrap", "colBtn", "resetBtn", "rowCount", "pager"], 0, "1–2 of 2 rows", 2]);
    page.all('#tableWrap tbody [data-act="row"]')[0].press();
    expect(page.texts("#drawerBody h3")).toEqual(["All columns"]);
    page.key("Escape");
    // A model's file of that name is a model's file.
    page.id("runAgain").press();
    sendResult(ports[0], { ...WHERE, kind: "model" });
    goTo(3);
    expect([page.has("#tableWays"), page.id("rowCount").textContent]).toEqual([false, "1–8 of 8 rows"]);
    // No other table of the app has a switch.
    page.id("runAgain").press();
    sendResult(ports[0], WHERE);
    goTo(2);
    expect(page.has("#tableWays")).toBe(false);
  });
});

describe("A result kept while the results page is refreshed", () => {
  /** The page's address once it has taken the time of the icon's click out of it: what a refresh loads. */
  const refreshed = "?tab=42";
  /** The note above the result: its line, its kind, and whether it offers the run's log to copy. */
  const note = () => (page.has("#noteBanner") ? [page.id("noteText").textContent, page.id("noteBanner").classList.contains("warn") ? "warn" : "note", !page.id("noteCopy").hidden] : []);
  const back = (name: string) => eventually(() => page.document.title === `Cardigan - ${name}`, "the result to come back");
  /** What the page shows of the result on it, view by view as the navigation lists them: each view's own words, which
   * for a table are its name, its line, its toolbar and the rows of its first page. The page is left on the overview. */
  const everyView = (): string[] => {
    // The navigation is written again with each view: an entry is looked up by its name when its turn comes.
    const views = page.all("#navList [data-nav]").map(entry => entry.dataset.nav).map(name => {
      page.find(`#navList [data-nav="${name}"]`).press();
      return page.id("view").textContent.replace(/\s+/g, " ").trim();
    });
    page.find('#navList [data-nav="overview"]').press();
    return views;
  };

  it("brings the result back after a refresh, under a line that says when it was analysed, and asks the tab nothing; every view shows what it showed", async () => {
    await openWith(APP);
    // The result is drawn first. The page keeps it in a turn of its own after that, and not before.
    expect([page.texts("#view h1"), session.held.size]).toEqual([["Overview"], 0]);
    await pass(30);
    expect(session.held.size).toBe(0);
    await letKeep();
    // Kept, under the keeper's own keys, and nothing on the page says so: the result is there as before.
    expect([page.id("banners").children, [...session.held.keys()].every(key => key.startsWith(KEPT_PREFIX)), page.id("live").textContent]).toEqual([[], true, "Analysis finished: Demo app"]);
    // Kept once: the moment the page would have waited for a frame passes, and nothing is written again.
    const writes = session.writes;
    vi.advanceTimersByTime(5000);
    await pass(30);
    expect([session.writes, kept()]).toEqual([writes, true]);
    const before = everyView();
    expect([before.length, before[2].startsWith("Cards "), before[2].includes("Sales, copied")]).toEqual([5, true, true]);

    // The page is refreshed twenty minutes later. Its address no longer holds the time of the icon's click.
    expect(location.search).toBe(refreshed);
    const later = new Date(NOW.getTime() + 20 * 60_000);
    vi.setSystemTime(later);
    await open(refreshed);
    // While the page looks for what it kept, it draws no waiting view and says nothing; it has connected to the tab meanwhile.
    expect([page.has("#runStatus"), page.id("live").textContent, connects.length]).toEqual([false, "", 2]);
    await back("Demo app");
    // The result is on the page as after a run: its overview, its navigation, its tables.
    expect([page.texts("#view h1"), page.texts("#view .s-lab"), page.all("#navList .nav-item").map(entryLabel), page.id("topnav").hidden])
      .toEqual([["Overview"], ["Pages", "Cards", "Grid sections", "Model objects"], ["Overview", "Pages", "Cards", "Grid Sections", "Where Used"], false]);
    // A line above it says when it was analysed and what reads Anaplan anew. It is a note, with no log to copy, and it is
    // what the page announces: nothing was analysed just now.
    const line = analysedLine(NOW, later);
    expect(line).toMatch(/^Analysed (today|yesterday) at \d\d:\d\d\. Choose Run again to read Anaplan again\.$/);
    expect([note(), page.id("banners").children.length, page.id("live").textContent]).toEqual([[line, "note", false], 1, `Demo app. ${line}`]);
    // The run control says "again".
    expect([runControl().slice(0, 2), disabled("runAgain")]).toEqual([["Run again", "Analyse the Anaplan tab again"], [false]]);
    // The page has asked the tab nothing. When the tab says what it shows, nothing changes either: no run starts by itself.
    expect(ports[1].posted).toEqual([]);
    ports[1].send({ type: "subject", subject: { kind: "app", id: APP.id } });
    expect([ports[1].posted, note()[0], page.has("#runBanner"), page.texts("#view h1"), runControl()[0]]).toEqual([[], line, false, ["Overview"], "Run again"]);
    // Every view of the result shows what it showed before the refresh, word for word.
    expect(everyView()).toEqual(before);
    // The result's tables work as ever, under the same line.
    goTo(2);
    expect([firstCells().length, page.id("rowCount").textContent, note()[0]]).toEqual([4, "1–4 of 4 rows", line]);
    // On a page left open into the next day, the line says so with the next view: it does not go on saying "today".
    const nextDay = new Date(NOW.getTime() + 24 * 3_600_000);
    vi.setSystemTime(nextDay);
    goTo(1);
    expect([note(), analysedLine(NOW, nextDay) === line, /^Analysed (yesterday at|on) /.test(analysedLine(NOW, nextDay))]).toEqual([[analysedLine(NOW, nextDay), "note", false], false, true]);
    vi.setSystemTime(later);
    goTo(2);
    expect(note()[0]).toBe(line);

    // It stays kept: a second refresh brings it back again, and a tab that cannot be reached takes nothing from it.
    await open(refreshed);
    await back("Demo app");
    lastError = { message: "Could not establish connection. Receiving end does not exist." };
    ports[2].drop();
    expect([ports[2].posted, note(), page.has("#runBanner"), runControl()[0]]).toEqual([[], [line, "note", false], false, "Run again"]);
  });

  it("takes nothing back on a page the icon has just opened: it analyses anew, and keeps the new result in the old one's place", async () => {
    await openWith(APP);
    await letKeep();
    const first = new Map(session.held);
    // The icon is clicked again for the same tab: the page that opens shows no earlier result, and runs by itself.
    await open(clicked(42));
    await pass(30);
    expect([page.texts("#view h1"), page.has("#noteBanner"), page.document.title, page.all("#view .stat").length]).toEqual([["Connecting"], false, "Cardigan", 0]);
    ports[1].send({ type: "subject", subject: { kind: "app", id: RESULT.id } });
    expect([ports[1].posted, page.id("runTitle").textContent]).toEqual([[{ type: "run" }], "Analysing"]);
    // What was kept is untouched while the new run goes.
    expect(new Map(session.held)).toEqual(first);
    sendResult(ports[1], RESULT);
    expect([page.document.title, page.id("banners").children]).toEqual(["Cardigan - Demo <img src=x onerror=alert(1)> app", []]);
    await letKeep();
    // The new result is the one a refresh brings back now.
    await open(refreshed);
    await back("Demo <img src=x onerror=alert(1)> app");
    expect([page.texts("#view .s-lab"), strayImg(), page.id("noteText").children]).toEqual([["Pages", "Cards"], false, []]);
  });

  it("opens a refreshed page on the view it showed, which its address marks by the table's place, and on the overview where it marks none", async () => {
    await openWith(APP);
    await letKeep();
    // The overview has no mark. A table is marked by its place among the result's tables, a number the page counted.
    expect(location.hash).toBe("");
    goTo(2);
    const cards = page.id("view").textContent;
    expect([location.search, location.hash]).toEqual([refreshed, "#2"]);
    await open(`${refreshed}#2`);
    await back("Demo app");
    // The result comes back on that table, as it was, under the line that says when it was analysed.
    expect([page.id("view").textContent, page.find('#navList [aria-current="page"]').dataset.nav, location.hash, page.has("#noteBanner")]).toEqual([cards, "2", "#2", true]);
    // Back on the overview, the mark goes. A mark that names no table of the result, or a map that an app has not, or
    // nothing the page writes, opens the overview, and goes.
    choose("overview");
    expect(location.hash).toBe("");
    for (const mark of ["#9", "#map", "#x"]) {
      await open(`${refreshed}${mark}`);
      await back("Demo app");
      expect([page.texts("#view h1"), location.hash], mark).toEqual([["Overview"], ""]);
    }
  });

  it("keeps the result that was brought back on the page while Run again reads Anaplan anew, and then keeps the new one", async () => {
    await openWith(APP);
    await letKeep();
    await open(refreshed);
    await back("Demo app");
    ports[1].send({ type: "subject", subject: { kind: "app", id: APP.id } });
    goTo(2);
    // Run again, an hour later: now the page asks the tab, on the port it opened when it loaded.
    const again = new Date(NOW.getTime() + 3_600_000);
    vi.setSystemTime(again);
    page.id("runAgain").press();
    expect([ports[1].posted, connects.length]).toEqual([[{ type: "run" }], 2]);
    // The run's progress stands above the result that was brought back, in the place of the line about it; the result is all still there.
    ports[1].send({ type: "status", text: "Reading the app…" });
    expect([banner(), page.has("#noteBanner"), page.id("banners").textContent.includes("The results below are from the earlier run."), firstCells().length, page.document.title])
      .toEqual([["note", "Analysing", "Reading the app…", "Keep the Anaplan tab open until this finishes."], false, true, 4, "Cardigan - Demo app"]);
    // And it is still what a refresh would bring back.
    expect(kept()).toBe(true);
    // The new result takes its place on the page once it is whole, and in what is kept once it is drawn.
    const next: AnalysisResult = { ...APP, name: "Demo app, read again", zipName: "Again.zip" };
    sendResult(ports[1], next);
    expect([page.document.title, page.id("banners").children, page.id("live").textContent]).toEqual(["Cardigan - Demo app, read again", [], "Analysis finished: Demo app, read again"]);
    await letKeep();
    const before = everyView();
    await open(refreshed);
    await back("Demo app, read again");
    const line = analysedLine(again, again);
    expect([note()[0], line.startsWith("Analysed today at ")]).toEqual([line, true]);
    expect(everyView()).toEqual(before);
  });

  it("leaves a result that a run brought meanwhile where it is: the one that was kept is the older", async () => {
    await openWith(APP);
    await letKeep();
    await open(refreshed);
    // Before the page has what it kept, Run is chosen, and the tab answers at once with a whole result.
    ports[1].send({ type: "subject", subject: { kind: "app", id: APP.id } });
    page.id("runAgain").press();
    sendResult(ports[1], { ...APP, name: "Demo app, read again" });
    expect([ports[1].posted, page.document.title]).toEqual([[{ type: "run" }], "Cardigan - Demo app, read again"]);
    await pass(50);
    expect([page.document.title, page.has("#noteBanner"), page.has("#runBanner"), page.id("live").textContent]).toEqual(["Cardigan - Demo app, read again", false, false, "Analysis finished: Demo app, read again"]);
  });

  it("puts the run's progress above a result that comes back while a run it was asked for is going", async () => {
    await openWith(APP);
    await letKeep();
    await open(refreshed);
    ports[1].send({ type: "subject", subject: { kind: "app", id: APP.id } });
    page.id("runAgain").press();
    ports[1].send({ type: "status", text: "Reading the app…" });
    await back("Demo app");
    expect([banner(), page.has("#noteBanner"), page.texts("#view h1"), page.id("runAgain").disabled])
      .toEqual([["note", "Analysing", "Reading the app…", "Keep the Anaplan tab open until this finishes."], false, ["Overview"], true]);
  });

  it("keeps a result after a moment in a window that is not shown, where the frame that draws it does not come", async () => {
    await open(clicked(42));
    // A window that is not shown is given no frame.
    vi.stubGlobal("requestAnimationFrame", () => 0);
    ports[0].send({ type: "subject", subject: { kind: "app", id: APP.id } });
    sendResult(ports[0], APP);
    vi.advanceTimersByTime(999);
    await pass(30);
    expect(session.writes).toBe(0);
    vi.advanceTimersByTime(1);
    await eventually(kept, "the result to be kept");
    expect(page.id("banners").children).toEqual([]);
  });

  it("says once, in a quiet note, that a result is too large to keep, with the reason in the run's log; the result is whole and on the page", async () => {
    session.refuses = "QuotaExceededError";
    await openWith(APP);
    vi.advanceTimersByTime(0);
    await eventually(() => page.has("#noteBanner"), "the note");
    // A note, not a failure: the result is there. Nothing of it is in the storage.
    expect(note()).toEqual([TOO_LARGE_NOTE, "note", true]);
    expect([page.id("banners").children.length, page.id("live").textContent, page.texts("#view h1"), disabled("runAgain"), session.held.size])
      .toEqual([1, TOO_LARGE_NOTE, ["Overview"], [false], 0]);
    // Why is in the run's log, which the note's button copies, and not on the page.
    page.id("noteCopy").press();
    await settle();
    expect(copied).toHaveLength(1);
    expect(copied[0]).toMatch(/^\d\d:\d\d:\d\d This result is too large to keep across a refresh: the tab's session storage is full \(The storage refused to hold cardigan-kept:0\.\)\.$/);
    expect(page.id("banners").textContent).not.toContain("session storage");
    // It is said once: it stays as it is through the views, and no second note comes.
    goTo(2);
    vi.advanceTimersByTime(5000);
    await pass(30);
    expect([note(), page.id("banners").children.length]).toEqual([[TOO_LARGE_NOTE, "note", true], 1]);
    // A refresh finds nothing kept: the page waits for Run, as one that never had a result.
    await open(refreshed);
    await pass(30);
    expect([page.id("runTitle").textContent, page.has("#noteBanner"), runControl()[0]]).toEqual(["Connecting", false, "Run"]);
  });

  it("says that a result will not survive a refresh when the tab has no session storage, or keeping it fails, with the reason in the log", async () => {
    vi.stubGlobal("sessionStorage", undefined);
    await openWith(APP);
    vi.advanceTimersByTime(0);
    await eventually(() => page.has("#noteBanner"), "the note");
    expect([note(), page.id("live").textContent, page.texts("#view h1")]).toEqual([[NOT_KEPT_NOTE, "note", true], NOT_KEPT_NOTE, ["Overview"]]);
    page.id("noteCopy").press();
    await settle();
    expect(copied[0]).toMatch(/^\d\d:\d\d:\d\d This result is not kept across a refresh: the tab's session storage is not available\.$/);
    // A run after it has its own banner in the note's place, and its result gets a note of its own, with its own reason.
    vi.stubGlobal("sessionStorage", session.storage);
    session.refuses = "SecurityError";
    page.id("runAgain").press();
    expect([page.has("#noteBanner"), banner().slice(0, 2)]).toEqual([false, ["note", "Analysing"]]);
    sendResult(ports[0], APP);
    expect(page.id("banners").children).toEqual([]);
    vi.advanceTimersByTime(0);
    await eventually(() => page.has("#noteBanner"), "the second note");
    expect(note()).toEqual([NOT_KEPT_NOTE, "note", true]);
    page.id("noteCopy").press();
    await settle();
    expect(copied[1]).toMatch(/^\d\d:\d\d:\d\d This result is not kept across a refresh: the tab's session storage refused it \(The storage refused to hold cardigan-kept:0\.\)\.$/);
  });

  it("says nothing about keeping once the page has gone on to another run: that run's banner stands where the note would", async () => {
    session.refuses = "QuotaExceededError";
    await openWith(APP);
    // Run again is chosen before the page has tried to keep the first result.
    page.id("runAgain").press();
    vi.advanceTimersByTime(0);
    await pass(50);
    expect([page.has("#noteBanner"), banner().slice(0, 2), page.texts("#view h1")]).toEqual([false, ["note", "Analysing"], ["Overview"]]);
    // The new run's log has no line about the earlier result either: it is empty, so its banner offers nothing to copy yet.
    expect(page.id("bannerCopy").hidden).toBe(true);
  });

  it("forgets a kept value that is not a result's shape, and waits for Run: the page is not left blank, and a refresh does not find it again", async () => {
    /** Puts a value into the tab's storage as this very build would keep a result for this tab. */
    const keep = async (value: unknown) => expect((await new ResultKeeper({ tabId: 42, storage: session.storage }).keep(value as AnalysisResult, NOW)).kept).toBe(true);
    /** What the page shows once it has looked: its view's heading, whether a result is on it, and what the storage still holds. */
    const looked = async () => {
      await eventually(() => page.has("#runTitle") || page.has("#view .stat"), "the page to have looked for what it kept");
      await pass(20);
      return [page.texts("#view h1"), page.has("#noteBanner"), page.document.title, session.held.size, page.id("topnav").hidden];
    };
    // Each of these passes the keeper's own check, which asks only for lists of tables, headers and rows: a value another
    // build of the same version kept, say. None is a result the page can show.
    const { kind: _kind, ...kindless } = APP;
    const shapes: [what: string, value: unknown][] = [
      ["no kind", kindless],
      ["a kind the page does not know", { ...APP, kind: "dashboard" }],
      ["no name for its zip", { ...APP, zipName: undefined }],
      ["a table without a file name", { ...APP, tables: [APP.tables[0], { ...APP.tables[1], file: undefined }] }],
      ["a table that does not say whether its cells are guarded", { ...APP, tables: [{ headers: ["Page"], rows: [["Overview"]], file: "Pages.csv", label: "Pages" }] }],
    ];
    for (const [what, value] of shapes) {
      await keep(value);
      expect(kept(), what).toBe(true);
      await open(refreshed);
      // The waiting view, as on a page that kept nothing; what was kept is gone, so the next refresh starts clean.
      expect(await looked(), what).toEqual([["Connecting"], false, "Cardigan", 0, true]);
      ports[ports.length - 1].send({ type: "subject", subject: { kind: "app", id: APP.id } });
      expect([page.id("runTitle").textContent, runControl()[0], ports[ports.length - 1].posted], what).toEqual(["Ready to analyse", "Run", []]);
    }
    // Run works from there, and its result is kept in the usual way.
    page.id("runAgain").press();
    sendResult(ports[ports.length - 1], APP);
    expect(page.document.title).toBe("Cardigan - Demo app");
    await letKeep();
    await open(refreshed);
    await back("Demo app");
  });

  it("shows a kept result one of whose cells is no text or number, with that cell as text: what comes back is read as a result once more", async () => {
    // A cell that `String` cannot convert, as JSON can hold one: an object whose own toString is not a function. And others
    // that are no plain cells: nothing at all, a list, a yes.
    const odd: AnalysisResult = { ...APP, tables: APP.tables.map((table, index) => (index === 1
      ? { ...table, rows: [["Demo app", { toString: null }, null, ["a", "b"]], ["Demo app", "Overview (copy)", true, "page-2"]] as unknown as Cell[][] } : table)) };
    expect((await new ResultKeeper({ tabId: 42, storage: session.storage }).keep(odd, NOW)).kept).toBe(true);
    await open(refreshed);
    await back("Demo app");
    expect([page.texts("#view h1"), page.has("#noteBanner"), kept()]).toEqual([["Overview"], true, true]);
    goTo(1);
    expect(page.all("#tableWrap tbody tr").map(row => row.children.map(cell => cell.textContent.trim()))).toEqual([["Demo app", "[object Object]", ""], ["Demo app", "Overview (copy)", "true"]]);
    // A row's drawer has the cell of the column that starts hidden as well, as text too.
    page.all('#tableWrap tbody [data-act="row"]')[0].press();
    expect(page.all("#drawerBody dd").map(value => value.textContent)).toEqual(["Demo app", "[object Object]", "", "a,b"]);
  });

  it("forgets a kept result that it fails to show, and shows the waiting view in its place", async () => {
    await openWith(APP);
    await letKeep();
    // A page on which showing a result fails part of the way: here its shell lacks the place for the result's name.
    const broken = SHELL.replace('<div class="meta" id="hdMeta"></div>', "");
    expect(broken).not.toBe(SHELL);
    await open(refreshed, broken);
    await eventually(() => page.has("#runTitle"), "the waiting view");
    await pass(20);
    // Nothing of the result is left on the page: no navigation, no note, no title; the run control is as on a page that
    // kept nothing, and what was kept is gone.
    expect([page.texts("#view h1"), page.id("runStatus").textContent, page.has("#noteBanner"), page.id("navList").children, page.id("topnav").hidden, page.document.title])
      .toEqual([["Connecting"], "Connecting to the Anaplan tab…", false, [], true, "Cardigan"]);
    expect([session.held.size, runControl()[0], disabled("runAgain")]).toEqual([0, "Run", [false]]);
    ports[1].send({ type: "subject", subject: { kind: "app", id: APP.id } });
    expect([page.id("runTitle").textContent, page.id("runHint").textContent, ports[1].posted])
      .toEqual(["Ready to analyse", "Choose Run to analyse it. This page starts by itself only when the Cardigan icon has just opened it.", []]);
  });

  it("takes everything a kept result had drawn off the page again when showing it fails at its last step", async () => {
    await openWith(APP);
    await letKeep();
    await open(refreshed);
    /** What the page holds of a result, part by part: the tab's title, the result's name in the header, the note above it,
     * the navigation's entries and the view's heading. */
    const parts = () => [page.document.title, page.id("hdMeta").textContent.trim(), page.id("banners").children.length, page.id("navList").children.length,
      page.texts("#view h1")];
    // The kept result is not on the page yet: the keeper reads it in turns of its own.
    expect(parts()).toEqual(["Cardigan", "", 0, 0, []]);
    // Showing it fails at the very end, when all of it is drawn: the last thing the page does is to say the result to a
    // screen reader, and here that fails, once. What the page holds at that moment is noted.
    const live = page.id("live");
    let said = "";
    let drawn: unknown[] | undefined;
    Object.defineProperty(live, "textContent", { configurable: true, get: () => said, set: (message: string) => {
      if (!drawn && message.startsWith(`${APP.name}. Analysed`)) {
        drawn = parts();
        throw new Error("The announcement failed.");
      }
      said = message;
    } });
    // The page then forgets what it kept, before it draws anything in the result's place: what it holds then is noted too.
    let cleared: unknown[] | undefined;
    const { removeItem } = session.storage;
    session.storage.removeItem = (key: string) => {
      if (drawn) cleared ??= parts();
      removeItem(key);
    };
    await eventually(() => drawn !== undefined, "the kept result to be shown");
    await eventually(() => page.has("#runTitle"), "the waiting view");
    await pass(20);
    // Every part was there when it failed: the title, the header's line, the note, the navigation, the overview.
    expect(drawn).toEqual(["Cardigan - Demo app", expect.stringContaining("Demo app"), 1, 5, ["Overview"]]);
    // All of it was taken off the page at once, the view too, and not only drawn over by what the page shows next.
    expect(cleared).toEqual(["Cardigan", "", 0, 0, []]);
    // The page is then the one that kept nothing: the waiting view, no navigation, and Run. What was kept is gone.
    expect(parts()).toEqual(["Cardigan", "", 0, 0, ["Connecting"]]);
    expect([page.id("runStatus").textContent, page.has("#noteBanner"), page.id("topnav").hidden, said]).toEqual(["Connecting to the Anaplan tab…", false, true, "Connecting to the Anaplan tab…"]);
    expect([session.held.size, runControl()[0], disabled("runAgain")]).toEqual([0, "Run", [false]]);
  });

  it("shows no note about a result that another result has replaced by the time its keeping ends", async () => {
    session.refuses = "QuotaExceededError";
    await openWith(APP);
    // The page begins to keep the first result: it is being compressed, and nothing has been written yet.
    vi.advanceTimersByTime(0);
    expect(session.writes).toBe(0);
    // Before that ends, Run again brings a second result, whole, which takes the first one's place on the page.
    page.id("runAgain").press();
    sendResult(ports[0], { ...APP, name: "Demo app, read again" });
    expect(page.document.title).toBe("Cardigan - Demo app, read again");
    // Now the first result's keeping ends: the storage refused it. That is about a result which is no longer on the page.
    // The page says nothing: no note above the second result, no announcement, no line in the second run's log.
    await eventually(() => session.writes === 1, "the first result's keeping to end");
    await pass(30);
    expect([page.has("#noteBanner"), page.id("banners").children, page.id("live").textContent]).toEqual([false, [], "Analysis finished: Demo app, read again"]);
    // The second result is kept in a turn of its own, and the note it gets is its own, with one reason in the log.
    vi.advanceTimersByTime(0);
    await eventually(() => page.has("#noteBanner"), "the second result's note");
    expect([note(), session.writes, page.document.title]).toEqual([[TOO_LARGE_NOTE, "note", true], 2, "Cardigan - Demo app, read again"]);
    page.id("noteCopy").press();
    await settle();
    expect(copied[0].split("\n").filter(line => line.includes("too large to keep"))).toHaveLength(1);
  });

  it("shows nothing that was kept for another Anaplan tab, or by another version of the extension: the page waits for Run", async () => {
    await openWith(APP);
    await letKeep();
    // The same results tab, with the address of another Anaplan tab.
    await open("?tab=43");
    await pass(30);
    expect([page.id("runTitle").textContent, page.has("#noteBanner"), page.document.title, session.held.size, connects[1]]).toEqual(["Connecting", false, "Cardigan", 0, [43, { name: PORT_NAME }]]);
    ports[1].send({ type: "subject", subject: { kind: "app", id: APP.id } });
    expect([page.id("runTitle").textContent, runControl()[0], ports[1].posted]).toEqual(["Ready to analyse", "Run", []]);
    // A result that another version kept, for this very tab.
    expect((await new ResultKeeper({ tabId: 42, version: "0.0.1", storage: session.storage }).keep(APP, NOW)).kept).toBe(true);
    expect(kept()).toBe(true);
    await open(refreshed);
    await pass(30);
    expect([page.id("runTitle").textContent, page.has("#noteBanner"), session.held.size]).toEqual(["Connecting", false, 0]);
  });

  /* ---------- forgetting the kept result ---------- */

  /** The overview's place for what the tab keeps of the result, element by element: each one's ID, or what a click on it
   * does, or that it only holds the room for what is to come, and its text. Nothing on a view that has no such place. */
  const keptPlace = () => (page.has("#ovKept")
    ? page.id("ovKept").children.map(child => [child.id || child.dataset.act || (child.classList.contains("to-come") ? "to come" : ""), child.textContent]) : undefined);
  const KEPT = [["keptLine", "A copy of this result is kept for a refresh of this page."], ["forget", "Forget this result"]];
  /** While a result is being kept: the room for the line and the control of a kept copy, which holds their words. */
  const TO_COME = [["to come", "A copy of this result is kept for a refresh of this page."], ["to come", "Forget this result"]];
  const FORGOTTEN = [["keptLine", FORGOTTEN_LINE]];
  const NOT_REMOVED = [["keptLine", NOT_REMOVED_LINE], ["forget", "Forget this result"]];
  /** The control that forgets the kept result, once the overview offers it. */
  const offered = async () => {
    await eventually(() => page.has('#ovKept [data-act="forget"]'), "the control that forgets the kept result");
    return page.find('#ovKept [data-act="forget"]');
  };
  const toOverview = () => page.find('#navList [data-nav="overview"]').press();

  it("offers Forget this result on the overview once a copy is kept, and not before: neither without a result nor while the result is still being kept", async () => {
    await open(clicked(42));
    // Before any result the page has its waiting view, and that has no such control.
    expect([page.texts("#view h1"), page.has("#ovKept"), page.has('[data-act="forget"]')]).toEqual([["Connecting"], false, false]);
    ports[0].send({ type: "subject", subject: { kind: "app", id: APP.id } });
    expect([page.texts("#view h1"), page.has('[data-act="forget"]')]).toEqual([["Analysing"], false]);
    sendResult(ports[0], APP);
    // The result is on the page, and nothing of it is kept yet: the overview's place holds the room for what it will say
    // of a kept copy, and no control.
    expect([page.texts("#view h1"), keptPlace(), page.has('[data-act="forget"]'), page.all("#ovKept button").length, session.held.size]).toEqual([["Overview"], TO_COME, false, 0, 0]);
    // Meanwhile Diagnostics is opened, from the keyboard.
    const summary = page.find("#ovLog summary");
    summary.focus();
    page.document.activeElement.press();
    await pass(30);
    expect([keptPlace(), session.held.size, page.find("#ovLog").hasAttribute("open")]).toEqual([TO_COME, 0, true]);

    await letKeep();
    const control = await offered();
    // Kept: under the details of the export a line says so, and beside it stands the control, a button the Tab key reaches.
    const parts = page.id("view").children.map(part => part.id);
    expect([keptPlace(), kept(), parts.indexOf("ovAbout") >= 0, parts.indexOf("ovKept") - parts.indexOf("ovAbout")]).toEqual([KEPT, true, true, 1]);
    expect([control.localName, control.getAttribute("type"), control.focusable, page.id("keptLine").focusable]).toEqual(["button", "button", true, false]);
    // Only that place was written: the overview is the one that was drawn, with its opened section still open and the
    // focus where it was. Nothing is said about it either: no banner, and no announcement, for nothing happened to the result.
    expect([page.find("#ovLog summary") === summary, page.find("#ovLog").hasAttribute("open"), page.document.activeElement === summary]).toEqual([true, true, true]);
    expect([page.id("banners").children, page.id("live").textContent]).toEqual([[], "Analysis finished: Demo app"]);
    // The control is the overview's: a table's view has none, and the overview has it again when it is shown again.
    goTo(2);
    expect([page.texts("#view h1"), page.has("#ovKept"), page.has('[data-act="forget"]')]).toEqual([["Cards"], false, false]);
    toOverview();
    expect(keptPlace()).toEqual(KEPT);
  });

  it("offers Forget this result on the overview also when the result was kept while a table was shown", async () => {
    await openWith(APP);
    goTo(2);
    await letKeep();
    await pass(30);
    // The table's view has no place for it, and is left as it is.
    expect([kept(), page.texts("#view h1"), page.has("#ovKept"), firstCells().length]).toEqual([true, ["Cards"], false, 4]);
    toOverview();
    expect(keptPlace()).toEqual(KEPT);
  });

  it("offers Forget this result for a result that was brought back after a refresh, which is still kept", async () => {
    await openWith(APP);
    await letKeep();
    await open(refreshed);
    await back("Demo app");
    // With the result, at once: the tab's storage holds what it came from.
    expect([keptPlace(), kept(), note()[0]]).toEqual([KEPT, true, analysedLine(NOW, NOW)]);
    const control = page.find('#ovKept [data-act="forget"]');
    expect([control.localName, control.focusable]).toEqual(["button", true]);
    // The tab's answer and the views change nothing about it.
    ports[1].send({ type: "subject", subject: { kind: "app", id: APP.id } });
    goTo(1);
    toOverview();
    expect([keptPlace(), kept()]).toEqual([KEPT, true]);
  });

  it("removes every key the keeper wrote when Forget this result is used, and no other key of the tab's storage", async () => {
    // What else the tab's storage may hold. None of these is the keeper's, though some look like one of its own.
    const others: Record<string, string> = { "cardigan-theme": "dark", "cardigan-kept": "not the keeper's", "cardigan-kepthead": "nor this", "Cardigan-kept:0": "another case",
      " cardigan-kept:0": "a space first", "kept:0": "x", "head": "x", "0": "x" };
    for (const [key, value] of Object.entries(others)) session.held.set(key, value);
    // A result whose text hardly compresses, made up from a seed, so that keeping it takes several keys.
    let seed = 20261004;
    const digits = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0).toString(36).padStart(7, "0");
    const noise: AnalysisResult = { ...APP, name: "Noise", tables: [APP.tables[0], { file: "Noise.csv", label: "Noise", headers: ["#", "Text"], guard: true,
      rows: Array.from({ length: 900 }, (_, index): Cell[] => [index, Array.from({ length: 120 }, digits).join("")]) }] };
    await openWith(noise);
    await letKeep();
    const control = await offered();
    // The keeper wrote its head and several parts, each under its own prefix.
    const written = [...session.held.keys()].filter(key => !(key in others));
    expect([written.length > 3, written.every(key => key.startsWith(KEPT_PREFIX)), written.includes(`${KEPT_PREFIX}head`), written.includes(`${KEPT_PREFIX}2`)]).toEqual([true, true, true, true]);
    control.press();
    // Every one of them is gone, at once, and what else the storage held is as it was.
    expect(Object.fromEntries(session.held)).toEqual(others);
    expect([keptPlace(), page.document.title]).toEqual([FORGOTTEN, "Cardigan - Noise"]);
  });

  it("leaves the result on the page when its kept copy is forgotten; the control goes, and one line says so in its place", async () => {
    await openWith(APP);
    await letKeep();
    const control = await offered();
    /** What the page shows of the result: its name, its overview, its navigation, the details of the export, and its controls. */
    const shown = () => [page.document.title, page.texts("#hdMeta .meta-app"), page.texts("#view h1"), page.texts("#view .s-lab"), page.all("#navList .nav-item").map(entryLabel),
      page.id("topnav").hidden, page.texts("#ovAbout dd"), page.texts("#view h2"), disabled("runAgain"), runControl()[0], page.id("toast").textContent, page.id("banners").children.length];
    const was = shown();
    expect(was.slice(0, 3)).toEqual(["Cardigan - Demo app", ["Demo app"], ["Overview"]]);

    // From the keyboard: the button takes the focus, and Enter presses it.
    control.focus();
    expect(page.document.activeElement).toBe(control);
    page.document.activeElement.press();
    // The copy is gone. So is the control: one line stands in its place, and it has the focus the control had.
    expect([kept(), session.held.size]).toEqual([false, 0]);
    expect([keptPlace(), page.has('[data-act="forget"]'), control.isConnected]).toEqual([FORGOTTEN, false, false]);
    expect([page.document.activeElement === page.id("keptLine"), page.document.activeElement === page.document.body, page.id("view").contains(page.document.activeElement)]).toEqual([true, false, true]);
    // The line is said once: it has the focus, where a screen reader reads it, and the page does not say it through its
    // live region as well, which says nothing now. The sentence stands on the page once. Nothing else is said: no banner.
    expect([page.id("keptLine").textContent, page.id("live").textContent, page.find("body").textContent.split(FORGOTTEN_LINE).length - 1])
      .toEqual(["The copy kept for refreshes is removed. This result stays here until you refresh or close this page.", "", 1]);
    // The result is on the page as it was, every part of it.
    expect(shown()).toEqual(was);

    // Its tables work as ever, and a card still opens.
    goTo(2);
    expect([firstCells().length, page.id("rowCount").textContent]).toEqual([4, "1–4 of 4 rows"]);
    page.all('#tableWrap tbody [data-act="card"]')[1].press();
    expect(page.id("drawerTitle").textContent).toBe("Card 2 - Margin");
    page.key("Escape");
    // The line stays for as long as the result does: the overview says it again when it is shown again, without the control.
    toOverview();
    expect([keptPlace(), page.has('[data-act="forget"]')]).toEqual([FORGOTTEN, false]);
  });

  it("shows the waiting view after a refresh once the kept copy is forgotten, and asks the tab nothing", async () => {
    await openWith(APP);
    await letKeep();
    (await offered()).press();
    await open(refreshed);
    await eventually(() => page.has("#runTitle"), "the waiting view");
    await pass(30);
    // The page that kept nothing: no result, no line about one, no navigation, and Run.
    expect([page.texts("#view h1"), page.has("#noteBanner"), page.has("#ovKept"), page.document.title, page.id("topnav").hidden, session.held.size])
      .toEqual([["Connecting"], false, false, "Cardigan", true, 0]);
    ports[1].send({ type: "subject", subject: { kind: "app", id: APP.id } });
    expect([page.id("runTitle").textContent, runControl()[0], ports[1].posted, disabled("runAgain")]).toEqual(["Ready to analyse", "Run", [], [false]]);

    // The same for a result that a refresh had brought back: forgotten there, the next refresh finds nothing.
    page.id("runAgain").press();
    sendResult(ports[1], APP);
    await letKeep();
    await open(refreshed);
    await back("Demo app");
    const line = note()[0];
    expect([line, keptPlace()]).toEqual([analysedLine(NOW, NOW), KEPT]);
    page.find('#ovKept [data-act="forget"]').press();
    // The line above the result still says when it was analysed, here and in every view: that is as true as before.
    expect([keptPlace(), kept(), note(), page.id("live").textContent, page.document.activeElement === page.id("keptLine")]).toEqual([FORGOTTEN, false, [line, "note", false], "", true]);
    goTo(2);
    toOverview();
    expect([note()[0], keptPlace(), page.document.title]).toEqual([line, FORGOTTEN, "Cardigan - Demo app"]);
    await open(refreshed);
    await eventually(() => page.has("#runTitle"), "the waiting view");
    await pass(30);
    expect([page.texts("#view h1"), page.has("#noteBanner"), page.document.title, session.held.size]).toEqual([["Connecting"], false, "Cardigan", 0]);
    ports[3].send({ type: "subject", subject: { kind: "app", id: APP.id } });
    expect([page.id("runTitle").textContent, runControl()[0], ports[3].posted]).toEqual(["Ready to analyse", "Run", []]);
  });

  it("says that the kept copy could not be removed when the tab's storage does not let it go, and keeps the control: nothing says it is removed, and a refresh brings the result back", async () => {
    await openWith(APP);
    await letKeep();
    const control = await offered();
    const keys = [...session.held.keys()].sort();
    expect(keys).toEqual([`${KEPT_PREFIX}0`, `${KEPT_PREFIX}head`]);
    // From now on the tab's storage refuses every removal.
    const { removeItem } = session.storage;
    session.storage.removeItem = () => { throw new Error("The storage refused to remove a key."); };
    control.focus();
    page.document.activeElement.press();
    // Nothing is removed: both of the keeper's keys are there.
    expect([...session.held.keys()].sort()).toEqual(keys);
    // The page says so in one sentence, in the line beside the control and through its live region. Nowhere does it say
    // that the copy is removed, and it says nothing else: no banner.
    expect([keptPlace(), page.id("live").textContent, NOT_REMOVED_LINE]).toEqual([NOT_REMOVED, NOT_REMOVED_LINE, "The copy kept for refreshes could not be removed."]);
    expect([page.find("body").textContent.includes("is removed"), FORGOTTEN_LINE.includes("is removed"), page.id("banners").children]).toEqual([false, true, []]);
    // The control is the one that was pressed, where it was, and the focus is on it still, for another try. The line is
    // no longer its description: the live region has said it.
    expect([page.find('#ovKept [data-act="forget"]') === control, page.document.activeElement === control, control.focusable, control.hasAttribute("aria-describedby")])
      .toEqual([true, true, true, false]);
    // The place holds what the overview writes for a copy that was not removed, to the character, and the overview writes
    // that when it is shown again. The result is on the page.
    expect(page.id("ovKept").innerHTML).toBe(parseMarkup(keptCopyHtml("not-removed")).innerHTML);
    goTo(2);
    toOverview();
    expect([keptPlace(), page.document.title, disabled("runAgain")]).toEqual([NOT_REMOVED, "Cardigan - Demo app", [false]]);

    // A refresh brings the result back, and nothing said it would not. The line then says that a copy is kept, which is true.
    await open(refreshed);
    await back("Demo app");
    expect([keptPlace(), kept(), note()[0]]).toEqual([KEPT, true, analysedLine(NOW, NOW)]);
    // Refused again, the page says so again.
    page.find('#ovKept [data-act="forget"]').press();
    expect([keptPlace(), kept(), page.id("live").textContent]).toEqual([NOT_REMOVED, true, NOT_REMOVED_LINE]);

    // Now the storage lets go, and the person tries again: the copy is removed, and only now does the page say that.
    session.storage.removeItem = removeItem;
    page.find('#ovKept [data-act="forget"]').press();
    expect([keptPlace(), kept(), session.held.size, page.has('[data-act="forget"]'), page.document.activeElement === page.id("keptLine")]).toEqual([FORGOTTEN, false, 0, false, true]);
    // The live region no longer says that the copy could not be removed: nothing on the page does.
    expect([page.id("live").textContent, page.find("body").textContent.includes("could not be removed")]).toEqual(["", false]);
    // A refresh finds nothing kept.
    await open(refreshed);
    await eventually(() => page.has("#runTitle"), "the waiting view");
    await pass(30);
    expect([page.texts("#view h1"), page.document.title, session.held.size]).toEqual([["Connecting"], "Cardigan", 0]);
  });

  it("keeps the next result as ever after a forgetting, and offers to forget that one: Run again brings the control back", async () => {
    await openWith(APP);
    await letKeep();
    (await offered()).press();
    expect([keptPlace(), kept()]).toEqual([FORGOTTEN, false]);
    // Run again, with the forgotten result still on the page: the line stays under the run's banner, and nothing is kept.
    page.id("runAgain").press();
    expect([banner().slice(0, 2), keptPlace(), session.held.size]).toEqual([["note", "Analysing"], FORGOTTEN, 0]);
    const next: AnalysisResult = { ...APP, name: "Demo app, read again", zipName: "Again.zip" };
    sendResult(ports[0], next);
    // The new result is on the page and is not kept yet: the place holds neither the line nor the control, only their room.
    expect([page.document.title, keptPlace(), session.held.size]).toEqual(["Cardigan - Demo app, read again", TO_COME, 0]);
    await letKeep();
    await offered();
    expect([keptPlace(), kept()]).toEqual([KEPT, true]);

    // Forgotten while a run is going: the copy of the result on the page goes, and the run's result is kept all the same.
    page.id("runAgain").press();
    page.find('#ovKept [data-act="forget"]').press();
    expect([banner().slice(0, 2), keptPlace(), session.held.size, page.document.title]).toEqual([["note", "Analysing"], FORGOTTEN, 0, "Cardigan - Demo app, read again"]);
    const third: AnalysisResult = { ...APP, name: "Demo app, a third time" };
    sendResult(ports[0], third);
    expect(keptPlace()).toEqual(TO_COME);
    await letKeep();
    await offered();
    // It is that result a refresh brings back, with the control.
    await open(refreshed);
    await back("Demo app, a third time");
    expect([keptPlace(), kept()]).toEqual([KEPT, true]);
  });

  it("offers nothing to forget for a result that is too large to keep, or that could not be kept", async () => {
    session.refuses = "QuotaExceededError";
    await openWith(APP);
    vi.advanceTimersByTime(0);
    await eventually(() => page.has("#noteBanner"), "the note");
    // The note above the result says that it is not kept. The overview's place holds nothing: there is no copy to forget.
    expect([note()[0], keptPlace(), page.has('[data-act="forget"]'), session.held.size]).toEqual([TOO_LARGE_NOTE, [], false, 0]);
    goTo(2);
    toOverview();
    await pass(30);
    expect([keptPlace(), page.has('[data-act="forget"]')]).toEqual([[], false]);
    // The same when the storage refuses the result for another reason, and on a page without session storage.
    session.refuses = "SecurityError";
    page.id("runAgain").press();
    sendResult(ports[0], APP);
    vi.advanceTimersByTime(0);
    await eventually(() => page.has("#noteBanner"), "the second note");
    expect([note()[0], keptPlace(), session.held.size]).toEqual([NOT_KEPT_NOTE, [], 0]);
    vi.stubGlobal("sessionStorage", undefined);
    page.id("runAgain").press();
    sendResult(ports[0], APP);
    vi.advanceTimersByTime(0);
    await eventually(() => page.has("#noteBanner"), "the third note");
    expect([note()[0], keptPlace()]).toEqual([NOT_KEPT_NOTE, []]);
    // A result that is kept after those gets the control, and no note.
    vi.stubGlobal("sessionStorage", session.storage);
    session.refuses = "";
    page.id("runAgain").press();
    sendResult(ports[0], APP);
    await letKeep();
    await offered();
    expect([keptPlace(), page.has("#noteBanner"), kept()]).toEqual([KEPT, false, true]);
  });

  it("does not offer to forget the result on the page while what is kept is an earlier result: its keeping ended after the page had gone on", async () => {
    await openWith(APP);
    // The page begins to keep the first result: it is being compressed, and nothing has been written yet.
    vi.advanceTimersByTime(0);
    expect(session.writes).toBe(0);
    // Before that ends, Run again brings a second result, whole, which takes the first one's place on the page.
    page.id("runAgain").press();
    sendResult(ports[0], { ...APP, name: "Demo app, read again" });
    expect([page.document.title, keptPlace()]).toEqual(["Cardigan - Demo app, read again", TO_COME]);
    // Now the first result's keeping ends, and it is kept. The result on the page is the second, of which nothing is kept
    // yet: the page offers nothing.
    await eventually(kept, "the first result's keeping to end");
    await pass(30);
    expect([page.document.title, keptPlace(), page.has('[data-act="forget"]')]).toEqual(["Cardigan - Demo app, read again", TO_COME, false]);
    // The second result is kept in its own turn, in the first one's place. Then the control is there, and it is that
    // result a refresh brings back.
    vi.advanceTimersByTime(0);
    await offered();
    expect([keptPlace(), kept()]).toEqual([KEPT, true]);
    await open(refreshed);
    await back("Demo app, read again");
  });

  /** Holds the page's compression of a result until the test lets it go: the stream the keeper compresses with takes the
   * result's bytes and passes none of them on before that. `asked` counts the results handed over to be compressed.
   * `only` holds that many of them, from the first, and lets the later ones through as they come. */
  const holdCompression = (only = Infinity) => {
    const Compression = CompressionStream;
    const held = { asked: 0, release: (): void => undefined };
    const released = new Promise<void>(resolve => { held.release = resolve; });
    vi.stubGlobal("CompressionStream", class {
      readonly readable: ReadableStream<Uint8Array>;
      readonly writable: WritableStream<Uint8Array<ArrayBuffer>>;
      constructor(format: CompressionFormat) {
        const waits = ++held.asked <= only;
        const gate = new TransformStream<Uint8Array<ArrayBuffer>, Uint8Array<ArrayBuffer>>({ transform: async (bytes, controller) => {
          if (waits) await released;
          controller.enqueue(bytes);
        } });
        this.writable = gate.writable;
        this.readable = gate.readable.pipeThrough(new Compression(format));
      }
    });
    return held;
  };

  it("offers Forget this result under the banner of a run that is going, when the keeping of the result on the page ends meanwhile", async () => {
    const compression = holdCompression();
    await openWith(APP);
    // The page begins to keep the result. Its compression does not end yet: nothing is written, and nothing is offered.
    vi.advanceTimersByTime(0);
    await pass(30);
    expect([compression.asked, session.writes, keptPlace()]).toEqual([1, 0, TO_COME]);
    // Meanwhile Run again is chosen, and that run goes on: its progress stands above the first result, which stays on the page.
    page.id("runAgain").press();
    ports[0].send({ type: "status", text: "Reading the app…" });
    await pass(30);
    expect([banner(), page.document.title, keptPlace(), session.writes])
      .toEqual([["note", "Analysing", "Reading the app…", "Keep the Anaplan tab open until this finishes."], "Cardigan - Demo app", TO_COME, 0]);
    // Now the compression ends, and the result is kept. It is still the result on the page, so the overview offers to
    // forget its copy, under the banner of the run that is going: a run on its way takes nothing from the result under it.
    compression.release();
    const control = await offered();
    expect([keptPlace(), kept(), banner().slice(0, 2), page.id("runAgain").disabled, control.localName, control.focusable, page.document.title])
      .toEqual([KEPT, true, ["note", "Analysing"], true, "button", true, "Cardigan - Demo app"]);
    // That run is cut off: the first result stays on the page, and the control for its copy with it.
    ports[0].drop();
    expect([banner().slice(0, 2), keptPlace(), kept(), page.document.title]).toEqual([["warn", "The analysis stopped"], KEPT, true, "Cardigan - Demo app"]);
  });

  it("takes nothing from the place of the result on the page when an earlier result's keeping ends late and comes to nothing", async () => {
    // Only the first result's compression is held.
    const compression = holdCompression(1);
    await openWith(APP);
    vi.advanceTimersByTime(0);
    await pass(30);
    expect([compression.asked, session.writes]).toEqual([1, 0]);
    // Run again brings a second result, which takes the page and is kept at once: the overview offers to forget its copy.
    page.id("runAgain").press();
    sendResult(ports[0], { ...APP, name: "Demo app, read again" });
    await letKeep();
    await offered();
    expect([page.document.title, keptPlace(), compression.asked]).toEqual(["Cardigan - Demo app, read again", KEPT, 2]);
    const holds = new Map(session.held);
    // Only now does the first result's compression end. The second took its place meanwhile, so nothing of the first is
    // kept. That is not about the result on the page: its control stays, what is kept stays, and the page says nothing.
    compression.release();
    await pass(50);
    expect([keptPlace(), new Map(session.held), page.has("#noteBanner"), page.id("live").textContent]).toEqual([KEPT, holds, false, "Analysis finished: Demo app, read again"]);
    // It is the second result a refresh brings back.
    await open(refreshed);
    await back("Demo app, read again");
  });

  it("holds the room for the line and the control of a kept copy from the moment a result is drawn, unseen and unsaid, and gives it back when the result cannot be kept", async () => {
    const compression = holdCompression();
    await openWith(APP);
    /** What the place holds, part by part: its kind, its class, whether a screen reader is kept from it, whether it takes
     * the focus, and whether it has an ID or says what a click on it does. */
    const parts = () => page.id("ovKept").children.map(part => [part.localName, part.getAttribute("class"), part.getAttribute("aria-hidden"), part.focusable, part.id !== "" || part.hasAttribute("data-act")]);
    // As the result is drawn, before the page has begun to keep it: the words of the line and of the control, each marked
    // as to come, which the stylesheet does not show, and kept from a screen reader. The second has the control's look,
    // and so its size. Neither is a control, or anything the page looks up: nothing here takes the focus or a click.
    expect([keptPlace(), compression.asked]).toEqual([TO_COME, 0]);
    expect(parts()).toEqual([["span", "to-come", "true", false, false], ["span", "btn sm to-come", "true", false, false]]);
    expect([page.has('[data-act="forget"]'), page.has("#keptLine"), page.all("#ovKept button, #ovKept [tabindex]").length]).toEqual([false, false, 0]);
    const held = page.id("ovKept").textContent;
    // While it is being kept, the same, also when the overview is drawn again.
    vi.advanceTimersByTime(0);
    await pass(30);
    goTo(2);
    toOverview();
    expect([compression.asked, session.writes, keptPlace()]).toEqual([1, 0, TO_COME]);
    // Kept: the line and the control stand in the room that was held. They are the words it held, in their order, and the
    // control has the look its room had, so nothing under the place has to move for them. Nothing is left that is to come.
    compression.release();
    const control = await offered();
    expect([keptPlace(), page.id("ovKept").textContent === held, control.getAttribute("class"), page.all("#ovKept .to-come").length]).toEqual([KEPT, true, "btn sm", 0]);

    // A result that cannot be kept has the room as it is drawn, and while the page tries to keep it.
    session.refuses = "QuotaExceededError";
    page.id("runAgain").press();
    sendResult(ports[0], APP);
    expect(keptPlace()).toEqual(TO_COME);
    vi.advanceTimersByTime(0);
    expect(keptPlace()).toEqual(TO_COME);
    // Once the keeper says that it is not kept, no copy will come: the place holds nothing at all, neither an element
    // nor a text, so that the stylesheet gives it no room. The note above the result says why.
    await eventually(() => page.has("#noteBanner"), "the note");
    expect([keptPlace(), page.id("ovKept").innerHTML, page.id("ovKept").childNodes.length, note()[0]]).toEqual([[], "", 0, TOO_LARGE_NOTE]);

    // The same when the keeping comes to nothing while the next run is going. That run's banner stands where the note
    // would, so the page says nothing of it; the room is given back all the same, and is not held for as long as the
    // result stays on the page.
    page.id("runAgain").press();
    sendResult(ports[0], APP);
    page.id("runAgain").press();
    expect([keptPlace(), banner().slice(0, 2)]).toEqual([TO_COME, ["note", "Analysing"]]);
    const writes = session.writes;
    vi.advanceTimersByTime(0);
    await eventually(() => session.writes > writes, "the keeping to come to nothing");
    await pass(30);
    expect([keptPlace(), page.has("#noteBanner"), banner().slice(0, 2)]).toEqual([[], false, ["note", "Analysing"]]);

    // A result that a refresh brings back is kept already: it has the line and the control at once, and no room is held.
    session.refuses = "";
    sendResult(ports[0], APP);
    await letKeep();
    await open(refreshed);
    await back("Demo app");
    expect([keptPlace(), page.all("#ovKept .to-come").length]).toEqual([KEPT, 0]);
  });
});

describe("The navigation bar of the results page", () => {
  /** The page as the icon's click leaves it, with the model's result on it. */
  const openWithModel = async () => {
    await open(clicked(42));
    ports[ports.length - 1].send({ type: "subject", subject: { kind: "model", id: MODEL.id } });
    sendResult(ports[ports.length - 1], MODEL);
  };
  /** An entry by its words, marked where it is the entry of the view shown. */
  const mark = (item: FakeElement) => `${entryLabel(item)}${item.getAttribute("aria-current") === "page" ? " (shown)" : ""}`;
  /** The navigation's entries by their words, those of its groups' menus among them, each marked where it is the view shown. */
  const marked = () => page.all("#navList .nav-item").map(mark);
  /** The navigation's line, item by item: an entry by its words, and a group by its name and its entries, its button
   * marked where it holds the view shown and its menu where it is open. */
  const line = () => page.id("navList").children.map(item => {
    if (!item.classList.contains("nav-group")) return mark(item);
    const button = item.querySelector(".nav-group-btn");
    const menu = item.querySelector(".nav-menu");
    return `${entryLabel(button ?? item)}${button?.getAttribute("aria-current") === "true" ? " (holds the view shown)" : ""}${menu?.hidden ? "" : " (open)"}: ${item.querySelectorAll(".nav-item").map(mark).join(", ")}`;
  });
  /** A model's result with these files after its Details file, in this order, each with a row of its own. */
  const withFiles = (...files: string[]): AnalysisResult => ({ ...MODEL, summary: [], tables: [MODEL.tables[0],
    ...files.map(file => ({ file: `${file}.csv`, label: file, headers: ["", "Value"], rows: [[`${file} 1`, "x"]], guard: false }))] });
  /** Every file the export writes for a model, in the order it writes them (model/export.ts). */
  const EXPORTED = ["Line Items", "Dynamic Cell Access", "Modules", "General Lists", "Processes", "Imports", "Import Data Sources", "Exports", "Other Actions", "Time Ranges", "Versions",
    "Source Models", "Model Calendar"];
  /** The menus of the navigation that are open, by their IDs. */
  const openMenus = () => page.all('#topnav [aria-expanded="true"]').map(button => button.getAttribute("aria-controls"));

  it("stands under the header as a bar of its own once there is a result, with nothing to put it away and nothing that lies over the page", async () => {
    // Before a result there is nothing to navigate: the bar is there, hidden and without an entry.
    await open(clicked(42));
    expect([page.id("topnav").hidden, page.id("navList").children]).toEqual([true, []]);
    ports[0].send({ type: "subject", subject: { kind: "model", id: MODEL.id } });
    sendResult(ports[0], MODEL);
    // With a result it is shown: a landmark of its own, named, under the header, in the top of the page that the two share.
    const bar = page.id("topnav");
    expect([bar.hidden, bar.localName, bar.getAttribute("aria-label"), bar.parentElement?.getAttribute("class"), bar.parentElement?.children.map(child => child.localName)])
      .toEqual([false, "nav", "Result tables", "top", ["header", "nav"]]);
    expect(marked()).toEqual(["Overview (shown)", "Modules", "Line Items", "Model map"]);
    // Nothing is left of the button that put the old navigation away: the header holds the brand, the name of what was
    // analysed and the actions, and the page's root says nothing of the navigation.
    expect([page.has("#navToggle"), page.find(".hd").children.map(child => child.id || child.getAttribute("class")), page.document.documentElement.hasAttribute("data-navigation")])
      .toEqual([false, ["brand", "hdMeta", "hd-actions"], false]);
    // Nothing slides in over the page, at any width: the page asks the window nothing of its width, nothing is put out of
    // reach, and the scrim is the drawer's alone.
    goTo(1);
    expect([[...new Set(mediaAsked)], page.all("[inert]"), page.id("scrim").hidden]).toEqual([["(prefers-color-scheme: dark)"], [], true]);
  });

  it("marks the entry of the view shown and the button of the group that holds it; the line's buttons are in the Tab key's reach, a menu's entries once it is open, and the view takes the focus on a choice", async () => {
    await openWithModel();
    // The model's two tables stand in its Modules group: the line is the overview's entry, the group and the map's entry.
    expect(line()).toEqual(["Overview (shown)", "Modules: Modules, Line Items", "Model map"]);
    expect(page.id("navList").children.map(item => (item.querySelector("button") ?? item).focusable)).toEqual([true, true, true]);
    expect(page.all("#navGroupModules .nav-item").map(item => item.focusable)).toEqual([false, false]);
    goTo(1);
    expect([line(), page.document.activeElement === page.id("view")]).toEqual([["Overview", "Line Items (holds the view shown): Modules, Line Items (shown)", "Model map"], true]);
    // The entry is the one marked as the page; its group's button is marked as current, not as the page.
    expect([page.all('#navList [aria-current="page"]').map(entryLabel), page.all('#navList [aria-current="true"]').map(button => button.getAttribute("aria-controls"))])
      .toEqual([["Line Items"], ["navGroupModules"]]);
    // From the keyboard: Enter on the group's button opens its menu, whose entries the Tab key then reaches, and Enter on
    // one of them shows its view, which then has the focus.
    const group = page.find('#navList [aria-controls="navGroupModules"]');
    group.focus();
    page.document.activeElement.press();
    expect([openMenus(), page.all("#navGroupModules .nav-item").map(item => item.focusable)]).toEqual([["navGroupModules"], [true, true]]);
    page.find('#navGroupModules [data-nav="2"]').focus();
    page.document.activeElement.press();
    expect([line(), page.texts("#view h1"), page.document.activeElement === page.id("view")]).toEqual([["Overview", "Modules (holds the view shown): Modules (shown), Line Items", "Model map"], ["Modules"], true]);
    // A view shown from elsewhere moves the mark as well: a new result, which shows its overview.
    page.id("runAgain").press();
    sendResult(ports[0], MODEL);
    expect(line()).toEqual(["Overview (shown)", "Modules: Modules, Line Items", "Model map"]);
  });

  it("gathers a model's tables in groups on one line, in the order of Model settings, each group with the tables the result has; a group of one table, and a file no group names, stand on their own", async () => {
    await openWith(withFiles(...EXPORTED));
    // Every file the export writes: Time, Versions, the one list file, Modules, Actions, Source Models, and the map.
    expect(line()).toEqual(["Overview (shown)", "Time: Model Calendar, Time Ranges", "Versions", "General Lists", "Modules: Modules, Line Items, Dynamic Cell Access",
      "Actions: Processes, Imports, Import Data Sources, Exports, Other Actions", "Source Models", "Model map"]);
    // Each group's button has the group's own icon, its name and a chevron, and holds no view's name of its own.
    const buttons = page.all("#navList .nav-group-btn");
    expect(buttons.map(button => [button.querySelector("svg")?.outerHTML, button.querySelectorAll(".nav-chevron").length, button.hasAttribute("data-nav")]))
      .toEqual(drawnIcons(NAV_ICONS.time, NAV_ICONS.modules, NAV_ICONS.actions).map(icon => [icon, 1, false]));
    // Line Item Subsets makes the lists two, and a group of their own. A group the result has no table of is not there,
    // a group of one table is that table's entry, and a file no group names stands after the groups, before the map.
    page.id("runAgain").press();
    sendResult(ports[0], withFiles("Line Item Subsets", "Imports", "Dashboards", "General Lists", "Versions"));
    expect(line()).toEqual(["Overview (shown)", "Versions", "Lists: General Lists, Line Item Subsets", "Imports", "Dashboards", "Model map"]);
    // Nothing is left out: the navigation's entries are the result's files, each once.
    expect(marked()).toEqual(["Overview (shown)", "Versions", "General Lists", "Line Item Subsets", "Imports", "Dashboards", "Model map"]);
  });

  it("keeps an app's line as it was, an entry for each table and no group, whatever its files are called", async () => {
    await openWith(APP);
    expect([line(), page.has("#navList .nav-group")]).toEqual([["Overview (shown)", "Pages", "Cards", "Grid Sections", "Where Used"], false]);
    // An app whose files are called as a model's are is an app still: the groups are a model's, by the result's kind.
    page.id("runAgain").press();
    sendResult(ports[0], { ...BLUEPRINT, kind: "app" });
    expect([line(), page.has("#navList .nav-group")]).toEqual([["Overview (shown)", "Line Items", "Modules"], false]);
  });

  it("opens a group's menu from its button, and closes it with Escape, back on its button; on a click outside it, the map's too; on a choice; on another group's button; and when the focus leaves it", async () => {
    await openWith(withFiles("Model Calendar", "Time Ranges", "Modules", "Line Items", "Processes", "Imports"));
    const button = (id: string) => page.find(`#navList [aria-controls="${id}"]`);
    // A click on the button opens its menu, under it, and a second closes it.
    button("navGroupTime").press();
    expect([openMenus(), page.id("navGroupTime").hidden, button("navGroupTime").getAttribute("aria-expanded")]).toEqual([["navGroupTime"], false, "true"]);
    button("navGroupTime").press();
    expect([openMenus(), page.id("navGroupTime").hidden]).toEqual([[], true]);
    // Enter on the focused button opens it, and the focus stays on the button, the Tab key going on into the menu. Escape
    // pressed in the menu closes it, and gives the focus back to the button.
    button("navGroupTime").focus();
    page.document.activeElement.press();
    page.find('#navGroupTime [data-nav="2"]').focus();
    page.key("Escape");
    expect([openMenus(), page.id("navGroupTime").hidden, page.document.activeElement === button("navGroupTime")]).toEqual([[], true, true]);
    // Another group's button opens its menu and closes the first.
    button("navGroupTime").press();
    button("navGroupModules").press();
    expect(openMenus()).toEqual(["navGroupModules"]);
    // A click outside it closes it, and does what it does: here on the view.
    page.find("#view h1").press();
    expect(openMenus()).toEqual([]);
    // The focus leaving the menu closes it; the focus moving inside it does not.
    button("navGroupModules").press();
    page.find("#navGroupModules .nav-item").dispatch("focusin");
    expect(openMenus()).toEqual(["navGroupModules"]);
    page.id("runAgain").dispatch("focusin");
    expect(openMenus()).toEqual([]);
    // Choosing an entry shows its view, and the line is drawn again with its menus closed.
    goTo(3);
    expect([openMenus(), page.texts("#view h1")]).toEqual([[], ["Modules"]]);
    // A menu that opens closes a popover of the table, as a click outside a popover does, and the reverse holds too.
    page.id("colBtn").press();
    button("navGroupTime").press();
    expect([page.id("popover").hidden, openMenus()]).toEqual([true, ["navGroupTime"]]);
    page.id("colBtn").press();
    expect([page.id("popover").hidden, openMenus()]).toEqual([false, []]);
    page.key("Escape");
    // On the map: a click inside it closes a menu that is open, and the map has the click as its own, the page reading
    // nothing of it.
    page.find('#navList [data-nav="map"]').press();
    const asked = [...mapAsked];
    button("navGroupActions").press();
    mapMounts[0].button.press();
    expect([openMenus(), mapAsked, page.texts("#view h1")]).toEqual([[], asked, ["Model map"]]);
  });

  it("has one menu in the line's place for a narrow window: a button that names the view shown, and every view in the line's order, a model's groups under their names", async () => {
    await openWith(withFiles(...EXPORTED));
    goTo(2);
    const button = () => page.find('#navCompact [aria-controls="navMenu"]');
    /** The menu, item by item: an entry by its words, and a group by its name and its entries. */
    const listed = () => page.id("navMenu").children.map(item => (item.classList.contains("nav-section")
      ? `${item.getAttribute("aria-label")}: ${item.querySelectorAll(".nav-item").map(mark).join(", ")}` : mark(item)));
    // The button names the view shown, with the menu's icon, and opens the menu, which is closed at first.
    expect([button().textContent.trim(), button().querySelector("svg")?.outerHTML, button().getAttribute("aria-expanded"), page.id("navMenu").hidden])
      .toEqual(["Dynamic Cell Access", drawnIcons(NAV_ICONS.menu)[0], "false", true]);
    button().press();
    expect([openMenus(), listed()]).toEqual([["navMenu"], ["Overview", "Time: Model Calendar, Time Ranges", "Versions", "General Lists", "Modules: Modules, Line Items, Dynamic Cell Access (shown)",
      "Actions: Processes, Imports, Import Data Sources, Exports, Other Actions", "Source Models", "Model map"]]);
    // A group's name heads its entries, a heading that a screen reader is told as the name of the group.
    expect(page.all("#navMenu .nav-section").map(section => [section.getAttribute("role"), section.querySelector(".nav-heading")?.textContent, section.querySelector(".nav-heading")?.getAttribute("aria-hidden")]))
      .toEqual([["group", "Time", "true"], ["group", "Modules", "true"], ["group", "Actions", "true"]]);
    // Choosing from it shows that view; the menu is drawn again, closed, and its button names the new view.
    page.find('#navMenu [data-nav="11"]').press();
    expect([page.texts("#view h1"), button().textContent.trim(), page.id("navMenu").hidden]).toEqual([["Versions"], "Versions", true]);
    // Escape closes it, back on its button.
    button().press();
    page.find("#navMenu .nav-item").focus();
    page.key("Escape");
    expect([openMenus(), page.document.activeElement === button()]).toEqual([[], true]);
    // An app's menu lists its tables as its line does, with no heading.
    page.id("runAgain").press();
    sendResult(ports[0], APP);
    button().press();
    expect([button().textContent.trim(), listed(), page.has("#navMenu .nav-section")]).toEqual(["Overview", ["Overview (shown)", "Pages", "Cards", "Grid Sections", "Where Used"], false]);
  });

  it("keeps nothing about the navigation in the browser's store: a choice that an earlier version kept there changes nothing, and is left as it is", async () => {
    // An earlier version could put the navigation away, and kept the choice under this name.
    stored.set("cardigan-navigation", "hidden");
    await openWithModel();
    expect([page.id("topnav").hidden, page.document.documentElement.hasAttribute("data-navigation"), marked()]).toEqual([false, false, ["Overview (shown)", "Modules", "Line Items", "Model map"]]);
    goTo(1);
    goTo(2);
    page.find('#navList [data-nav="overview"]').press();
    // The page wrote nothing to the store meanwhile, and left the old choice as it found it.
    expect(Object.fromEntries(stored)).toEqual({ "cardigan-navigation": "hidden" });
  });

  it("brings no entry into sight, whatever shows a view: the bar wraps its entries rather than scroll, and the page does not move for it", async () => {
    await openWithModel();
    /** How often each entry, as the bar holds it now, was asked to be brought into sight. The bar is drawn anew with
     * each view, so each count is the latest drawing's. */
    const sight = () => page.all("#navList .nav-item").map(item => item.broughtIntoSight);
    const NONE_ASKED = [0, 0, 0, 0];
    expect(sight()).toEqual(NONE_ASKED);
    // An entry chosen: a table, and the map's, the last of all.
    goTo(1);
    expect(sight()).toEqual(NONE_ASKED);
    page.find('#navList [data-nav="map"]').press();
    expect(sight()).toEqual(NONE_ASKED);
    // A link that names a table, and a new result, which shows its overview.
    page.id("banners").innerHTML = '<button type="button" data-nav="2">Modules</button>';
    page.find('#banners [data-nav="2"]').press();
    expect(sight()).toEqual(NONE_ASKED);
    page.id("runAgain").press();
    sendResult(ports[0], MODEL);
    expect([sight(), marked()]).toEqual([NONE_ASKED, ["Overview (shown)", "Modules", "Line Items", "Model map"]]);
  });

  it("draws before each entry's words the icon of its view: the overview's, its file's for a table, chosen by the file's name and never by the entry's words", async () => {
    // Each of the app's seven files, and one whose name the page does not know.
    const more = ["Filters", "Conditional Formatting", "Action Buttons", "Comments"].map(label => ({ file: `${label}.csv`, label, headers: ["Page"], rows: [], guard: true }));
    await openWith({ ...APP, tables: [...APP.tables, ...more] });
    const names = ["Pages", "Cards", "Grid Sections", "Where Used", "Filters", "Conditional Formatting", "Action Buttons"];
    expect(page.all("#navList .nav-item").map(entryLabel)).toEqual(["Overview", ...names, "Comments"]);
    expect(entryIcons()).toEqual(drawnIcons(NAV_ICONS.overview, ...names.map(name => FILE_ICONS.get(`${name}.csv`)), NAV_ICONS.table));
    // The icon stands first, before the words, and is hidden from a screen reader: the words say the entry. Nothing
    // follows the words: no entry has a count.
    expect(page.all("#navList .nav-item").map(item => [item.children.map(child => child.localName).join(" "), item.querySelector("svg")?.getAttribute("aria-hidden")]))
      .toEqual(Array(9).fill(["svg span", "true"]));
    // The icon follows the file's name, which the analysis gives it, and not the words, which are the result's: a Cards
    // file under another label has the cards' icon, and a file the page does not know, labelled Cards, a table's.
    page.id("runAgain").press();
    sendResult(ports[0], { ...APP, tables: [APP.tables[0], { ...APP.tables[2], label: "Pages" }, { file: "Comments.csv", label: "Cards", headers: ["Page"], rows: [], guard: true }] });
    expect([page.all("#navList .nav-item").map(entryLabel), entryIcons()])
      .toEqual([["Overview", "Pages", "Cards"], drawnIcons(NAV_ICONS.overview, FILE_ICONS.get("Cards.csv"), NAV_ICONS.table)]);
  });
});

describe("A model's map on the results page", () => {
  /** What the view and the navigation each say is shown: the view's heading, and the words of the entry marked as current. */
  const shows = () => [page.texts("#view h1")[0], page.texts('#navList [aria-current="page"] span')[0]];
  /** The page's place for the map. */
  const host = () => page.id("mapHost");
  const toMap = () => page.find('#navList [data-nav="map"]').press();
  const toOverview = () => page.find('#navList [data-nav="overview"]').press();
  /** What the view says where the map could not be drawn: nothing while it is drawn. */
  const notDrawn = () => page.texts("#view .banner div");
  /** MODEL with what its Details file says of its workspace, as the model's export writes it. */
  const inWorkspace = (workspace: string): AnalysisResult => ({ ...MODEL,
    tables: [{ ...MODEL.tables[0], rows: [MODEL.tables[0].rows[0], ["Model", "Workspace", workspace], ...MODEL.tables[0].rows.slice(1)] }, ...MODEL.tables.slice(1)] });

  it("lists Model map last in a model's navigation, as an entry like any other, and builds nothing for it; an app has none", async () => {
    // Before there is a result there is no map: a link that names one builds nothing, and the result comes to its overview.
    await open("?tab=42");
    page.id("banners").innerHTML = '<button type="button" data-nav="map">Map</button>';
    page.find('#banners [data-nav="map"]').press();
    ports[0].send({ type: "subject", subject: { kind: "model", id: MODEL.id } });
    expect([page.id("runTitle").textContent, mapAsked]).toEqual(["Ready to analyse", []]);
    page.id("runAgain").press();
    sendResult(ports[0], MODEL);
    expect([shows(), mapAsked]).toEqual([["Overview", "Overview"], []]);
    const entries = () => page.all("#navList .nav-item");
    expect(entries().map(entryLabel)).toEqual(["Overview", "Modules", "Line Items", "Model map"]);
    // An entry like the others: a button the Tab key reaches, which nothing marks as off or as still to come.
    const entry = entries()[3];
    expect([entry.localName, entry.getAttribute("type"), entry.getAttribute("class"), entry.dataset.nav, entry.focusable, entry.hasAttribute("aria-disabled"), entry.hasAttribute("title")])
      .toEqual(["button", "button", "nav-item", "map", true, false, false]);
    expect(page.find("body").textContent).not.toMatch(/coming/i);
    // Listing it builds nothing, and the page's place for the map is hidden and empty.
    expect([mapAsked, host().hidden, host().childNodes.length]).toEqual([[], true, 0]);

    // An app has no map: no entry, and a link that names one leads to the overview, as any name that is no file's does.
    page.id("runAgain").press();
    sendResult(ports[0], APP);
    expect([page.has('#navList [data-nav="map"]'), entries().map(entryLabel)]).toEqual([false, ["Overview", "Pages", "Cards", "Grid Sections", "Where Used"]]);
    goTo(2);
    page.id("banners").innerHTML = '<button type="button" data-nav="map">Map</button>';
    page.find('#banners [data-nav="map"]').press();
    expect([shows(), host().hidden, mapAsked]).toEqual([["Overview", "Overview"], true, []]);
  });

  it("builds the graph and mounts the map when its entry is first chosen, not before: from the result's tables, in the page's place for it, with the model's name and its workspace's", async () => {
    const model = inWorkspace("Planning");
    await openWith(model);
    // Not when the result arrives, and not for any other view.
    goTo(1);
    goTo(2);
    toOverview();
    expect([mapAsked, host().hidden]).toEqual([[], true]);

    toMap();
    // The graph is built once, from the result's own tables: the files as the export wrote them, not as the page lists them.
    expect(mapAsked).toEqual(["build", "mount 1", "show 1"]);
    expect([mapBuilds.length, mapBuilds[0].tables]).toEqual([1, model.tables]);
    // That very graph is mounted, in the page's place for the map. The map finds the place shown and empty, and the
    // view's room given up, so that it has its size from the first moment; it is told to draw only after that.
    expect([mapMounts.length, mapMounts[0].graph === mapBuilds[0].graph, mapMounts[0].host === host(), mapMounts[0].found]).toEqual([1, true, true, [false, 0, "Model map"]]);
    // The model's name is the result's, and its workspace's is the Details file's. With them the map is given the way to
    // tell the page that it has stopped.
    expect(mapMounts[0].options).toEqual({ modelName: "Model one", workspaceName: "Planning", onFailure: expect.any(Function), onGrouping: expect.any(Function) });
    // What the map made is in its place, and nowhere else on the page.
    expect([host().children.length, host().contains(mapMounts[0].button), page.all("button").filter(button => button === mapMounts[0].button).length]).toEqual([1, true, 1]);

    // A dash where the workspace's name would be, which the export writes when it found none, is no name. Nor is an
    // empty cell, or a Details file without that row.
    for (const [what, result] of [["a dash", inWorkspace("-")], ["nothing", inWorkspace("")], ["no row", MODEL]] as const) {
      page.id("runAgain").press();
      sendResult(ports[0], result);
      toMap();
      const { options } = mapMounts[mapMounts.length - 1];
      expect([options, "workspaceName" in (options as object)], what).toEqual([{ modelName: "Model one", onFailure: expect.any(Function), onGrouping: expect.any(Function) }, false]);
    }
  });

  it("gives the map the grouping the viewer chose last, and keeps a new choice for the next map: the map's own pick as no choice", async () => {
    stored.set("cardigan-map-grouping", "role");
    await openWith(inWorkspace("Planning"));
    toMap();
    const { options } = mapMounts[0];
    expect((options as { grouping?: string }).grouping).toBe("role");
    const tell = (options as { onGrouping: (kind: string | undefined) => void }).onGrouping;
    tell("dimension");
    expect(stored.get("cardigan-map-grouping")).toBe("dimension");
    tell(undefined);
    expect(stored.get("cardigan-map-grouping")).toBe("");
    // A browser that keeps nothing: the map is given no choice, and a new one is not kept, with nothing thrown.
    storeRefuses = new Error("The storage is off.");
    page.id("runAgain").press();
    sendResult(ports[0], inWorkspace("Planning"));
    toMap();
    expect("grouping" in (mapMounts[mapMounts.length - 1].options as object)).toBe(false);
    expect(() => (mapMounts[mapMounts.length - 1].options as { onGrouping: (kind: string) => void }).onGrouping("app")).not.toThrow();
  });

  it("shows the map in the view's place and hides it for another view; coming back shows it as it was left, without building it again", async () => {
    await openWith(MODEL);
    goTo(1);
    page.id("tblSearch").type("item 11");
    toMap();
    // The view holds its heading alone, for a screen reader; the page's place for the map is shown; the navigation says
    // where the user is, with the map's entry marked as the view shown.
    expect([shows(), host().hidden, page.id("view").children.map(child => [child.localName, child.getAttribute("class")]), page.has("#tableWrap")])
      .toEqual([["Model map", "Model map"], false, [["h1", "sr-only"]], false]);
    // The view takes the focus, as every view does, and the page says what it shows.
    expect([page.document.activeElement === page.id("view"), page.id("live").textContent]).toEqual([true, "Model map"]);
    // A map that takes the focus into itself as it is shown keeps it: the page does not take it back to the view.
    toOverview();
    mapTakesFocus = true;
    toMap();
    expect([mapAsked.slice(3), page.document.activeElement === mapMounts[0].button, page.id("live").textContent]).toEqual([["hide 1", "show 1"], true, "Model map"]);
    mapTakesFocus = false;

    // Another view: the map is told that it is hidden, and its place gives the room back. The table is as any table
    // that was left: whole again.
    goTo(1);
    expect([mapAsked.slice(5), host().hidden, shows(), page.id("rowCount").textContent]).toEqual([["hide 1"], true, ["Line Items", "Line Items"], "1–50 of 120 rows"]);
    // What the map made stays in its place, out of reach while it is hidden, and the view that is shown has the focus.
    expect([host().children.length, mapMounts[0].button.isConnected, mapMounts[0].button.focusable, page.document.activeElement === page.id("view")]).toEqual([1, true, false, true]);
    // Going on from view to view asks nothing of a map that is hidden.
    goTo(2);
    toOverview();
    expect(mapAsked).toHaveLength(6);

    // Back to the map: the same one is shown again, in its place that is shown first. Nothing is built or mounted anew.
    toMap();
    expect([mapAsked.slice(6), mapBuilds.length, mapMounts.length, host().hidden, mapMounts[0].button.focusable, shows()[0], page.document.activeElement === page.id("view")])
      .toEqual([["show 1"], 1, 1, false, true, "Model map", true]);
    // The overview's entry leaves the map as any other entry does.
    toOverview();
    expect([mapAsked.slice(7), host().hidden, shows()]).toEqual([["hide 1"], true, ["Overview", "Overview"]]);
  });

  it("gives the map the focus back when its entry is chosen again while it is shown: the map is shown anew, and is not built again", async () => {
    mapTakesFocus = true;
    await openWith(MODEL);
    toMap();
    const button = mapMounts[0].button;
    // The first choice: the map takes the focus as it is shown, and the page leaves it there.
    expect([mapAsked, page.document.activeElement === button]).toEqual([["build", "mount 1", "show 1"], true]);
    // The entry is chosen again, with the mouse or with Enter. Either way the focus is on the entry by then, out of the
    // map, and the map's keys with it. The page leaves the map and shows it anew, as on coming back to it, so the map
    // takes the focus as it did the first time. Nothing is built or mounted again, and the view is the map's still.
    toMap();
    expect([mapAsked.slice(3), page.document.activeElement === button, mapBuilds.length, mapMounts.length, host().hidden, shows()])
      .toEqual([["hide 1", "show 1"], true, 1, 1, false, ["Model map", "Model map"]]);
    // As often as it is chosen.
    toMap();
    expect([mapAsked.slice(5), page.document.activeElement === button]).toEqual([["hide 1", "show 1"], true]);
    // A choice that leaves the focus inside the map, as a click that a script makes does, takes nothing from the map:
    // the page asks nothing of it, and the focus stays where it is.
    page.find('#navList [data-nav="map"]').dispatch("click");
    expect([mapAsked.length, page.document.activeElement === button, host().hidden, shows()[0]]).toEqual([7, true, false, "Model map"]);
    // Another view chosen by such a click leaves the map as any choice of that view does: the map is hidden once, and
    // the view that is shown has the focus. The page gives it the focus although the browser, asked at that moment,
    // still names the map's button as the one with the focus: a browser names a hidden element so until it next draws
    // the page, and then leaves the focus on nothing. The view has it at once, and still has it when the page is drawn.
    page.find('#navList [data-nav="1"]').dispatch("click");
    expect([mapAsked.slice(7), host().hidden, shows()[0], page.document.activeElement === page.id("view")]).toEqual([["hide 1"], true, "Line Items", true]);
    page.frame();
    expect([page.document.activeElement === page.id("view"), button.focusable]).toEqual([true, false]);
    // From another view the map is shown once, as ever: it was hidden when that view was chosen.
    toMap();
    expect([mapAsked.slice(8), page.document.activeElement === button]).toEqual([["show 1"], true]);
    // The overview's entry, by a click that a script makes with the focus inside the map, is such a choice too.
    page.find('#navList [data-nav="overview"]').dispatch("click");
    page.frame();
    expect([mapAsked.slice(9), host().hidden, shows()[0], page.document.activeElement === page.id("view")]).toEqual([["hide 1"], true, "Overview", true]);
    toMap();
    expect([mapAsked.slice(10), page.document.activeElement === button]).toEqual([["show 1"], true]);

    // A map that does not take the focus is shown anew as well, and the view has the focus then, as after its first choice.
    mapTakesFocus = false;
    toMap();
    expect([mapAsked.slice(11), page.document.activeElement === page.id("view"), host().hidden]).toEqual([["hide 1", "show 1"], true, false]);
    // A map that cannot draw when it is shown anew is taken away, and the view says so, as when it cannot be shown at first.
    mapThrows.show = new Error("Nothing to draw on.");
    toMap();
    expect([mapAsked.slice(13), notDrawn(), host().hidden]).toEqual([["hide 1", "show 1", "destroy 1"], [MAP_FAILED], true]);
    // Its entry, chosen again, has no map to show anew: nothing is asked, and the view says the same.
    toMap();
    expect([mapAsked.length, notDrawn(), page.document.activeElement === page.id("view")]).toEqual([16, [MAP_FAILED], true]);
  });

  it("tells a mounted map that the theme has changed, shown or hidden, once the page has the new theme; a map that is not mounted is told nothing", async () => {
    await openWith(MODEL);
    toMap();
    // The system's theme changes, and the page follows it while no theme was chosen here: the map is told.
    systemListeners[0]({ matches: true });
    expect([mapAsked.slice(3), page.document.documentElement.dataset.theme]).toEqual([["themeChanged 1 dark"], "dark"]);
    // The page's own switch.
    page.id("themeToggle").press();
    expect(mapAsked.slice(4)).toEqual(["themeChanged 1 light"]);
    // A map that is hidden is told as well: it is shown again in the theme the page then has.
    goTo(1);
    page.id("themeToggle").press();
    expect(mapAsked.slice(5)).toEqual(["hide 1", "themeChanged 1 dark"]);
    // A change of the system's theme that the page does not follow, a theme having been chosen, is nothing to tell.
    systemListeners[0]({ matches: false });
    expect([mapAsked.length, page.document.documentElement.dataset.theme]).toEqual([7, "dark"]);
    // Once the map is gone, the switch changes the page's theme and tells nothing.
    page.id("runAgain").press();
    expect(mapAsked.slice(7)).toEqual(["destroy 1"]);
    page.id("themeToggle").press();
    expect([mapAsked.length, page.document.documentElement.dataset.theme]).toEqual([8, "light"]);
  });

  it("removes the map when a run starts and when a new result takes the page; its entry then builds it afresh", async () => {
    await openWith(MODEL);
    toMap();
    // Run again while the map is shown: the map goes at once, its place is hidden and empty, and the overview stands in
    // its place under the run's banner.
    page.id("runAgain").press();
    expect([mapAsked.slice(3), host().hidden, host().childNodes.length, shows(), banner().slice(0, 2)]).toEqual([["destroy 1"], true, 0, ["Overview", "Overview"], ["note", "Analysing"]]);
    // The earlier result stays on the page while the run goes, and its map's entry with it: chosen now, it builds the
    // map afresh from that result.
    ports[0].send({ type: "status", text: "Reading the model…" });
    toMap();
    expect([mapAsked.slice(4), mapBuilds[1].tables, mapMounts[1].found, host().hidden, shows()[0]]).toEqual([["build", "mount 2", "show 2"], MODEL.tables, [false, 0, "Model map"], false, "Model map"]);
    // A run that goes on takes nothing away: only its start did.
    ports[0].send({ type: "status", text: "Reading line items…" });
    ports[0].send({ type: "log", text: "14:02:09 Line Items: 120 rows" });
    expect([mapAsked.length, host().hidden, banner()[2]]).toEqual([7, false, "Reading line items…"]);

    // The new result takes the page: the earlier one's map goes with it, and the focus, which was inside the map, is on
    // the new result's view and not on nothing.
    mapMounts[1].button.focus();
    expect(page.document.activeElement).toBe(mapMounts[1].button);
    const next: AnalysisResult = { ...inWorkspace("Planning"), name: "Model two", zipName: "Model two - Model Export - 2026-10-03.zip" };
    sendResult(ports[0], next);
    expect([mapAsked.slice(7), host().hidden, host().childNodes.length, shows(), page.document.title, page.document.activeElement === page.id("view")])
      .toEqual([["destroy 2"], true, 0, ["Overview", "Overview"], "Cardigan - Model two", true]);
    // The new result's map is its own: built from its tables when its entry is chosen.
    toMap();
    expect([mapAsked.slice(8), mapBuilds[2].tables, mapMounts[2].options]).toEqual([["build", "mount 3", "show 3"], next.tables, { modelName: "Model two", workspaceName: "Planning", onFailure: expect.any(Function), onGrouping: expect.any(Function) }]);
    // A run that starts while another view is shown ends the map too, and leaves that view where it is.
    goTo(1);
    page.id("runAgain").press();
    expect([mapAsked.slice(11), host().childNodes.length, shows()[0], firstCells().length]).toEqual([["hide 3", "destroy 3"], 0, "Line Items", 50]);
  });

  it("keeps the map when Run again cannot reach the tab: only a run that starts ends it", async () => {
    await openWith(MODEL);
    toMap();
    // The Anaplan tab was closed after the analysis: Run again finds nothing to run on.
    ports[0].drop();
    lastError = { message: "Could not establish connection. Receiving end does not exist." };
    page.id("runAgain").press();
    ports[1].drop();
    lastError = undefined;
    await neverAnswers();
    expect([banner().slice(0, 2), mapAsked, host().hidden, shows()[0]]).toEqual([["warn", "Not connected"], ["build", "mount 1", "show 1"], false, "Model map"]);
    // Run again once more, and this time the tab answers. Until it has said what it shows there is no run: the map is
    // still there, and the focus goes into it meanwhile.
    page.id("runAgain").press();
    mapMounts[0].button.focus();
    expect([mapAsked.length, page.document.activeElement === mapMounts[0].button]).toEqual([3, true]);
    // Now the run starts: the map goes, and the focus is on the overview that takes its place.
    ports.at(-1)!.send({ type: "subject", subject: { kind: "model", id: MODEL.id } });
    expect([ports.at(-1)!.posted, mapAsked.slice(3), host().hidden, host().childNodes.length, shows(), banner().slice(0, 2), page.document.activeElement === page.id("view")])
      .toEqual([[{ type: "run" }], ["destroy 1"], true, 0, ["Overview", "Overview"], ["note", "Analysing"], true]);
  });

  it("removes the map when the result is forgotten, and not when its kept copy could not be removed", async () => {
    await openWith(MODEL);
    await letKeep();
    await eventually(() => page.has('#ovKept [data-act="forget"]'), "the control that forgets the kept result");
    toMap();
    toOverview();
    expect(mapAsked).toEqual(["build", "mount 1", "show 1", "hide 1"]);
    // The tab's storage does not let the copy go: nothing is forgotten, and the map stays as it is.
    const { removeItem } = session.storage;
    session.storage.removeItem = () => { throw new Error("The storage refused to remove a key."); };
    page.find('#ovKept [data-act="forget"]').press();
    expect([page.id("live").textContent, kept(), mapAsked.length, host().children.length]).toEqual([NOT_REMOVED_LINE, true, 4, 1]);
    // Now it does. The copy goes, and the map that was built from the result with it. The result stays on the page, and
    // its entry builds the map afresh.
    session.storage.removeItem = removeItem;
    page.find('#ovKept [data-act="forget"]').press();
    expect([kept(), mapAsked.slice(4), host().hidden, host().childNodes.length, page.document.title, shows()[0]]).toEqual([false, ["destroy 1"], true, 0, "Cardigan - Model one", "Overview"]);
    toMap();
    expect([mapAsked.slice(5), mapBuilds[1].tables, host().hidden]).toEqual([["build", "mount 2", "show 2"], MODEL.tables, false]);
  });

  it("opens the map of a result that was kept across a refresh like any other's", async () => {
    const model = inWorkspace("Planning");
    await openWith(model);
    await letKeep();
    // The page is refreshed: it brings the result back, and asks the tab nothing.
    await open("?tab=42");
    await eventually(() => page.document.title === "Cardigan - Model one", "the result to come back");
    // The result is there under the line that says when it was analysed, with its map's entry. Nothing is built yet.
    expect([page.id("noteText").textContent, page.all("#navList .nav-item").map(entryLabel), mapAsked, host().hidden])
      .toEqual([analysedLine(NOW, NOW), ["Overview", "Modules", "Line Items", "Model map"], [], true]);
    toMap();
    // Its map is built from the tables that came back, which are the result's, with the names the Details file gives.
    expect([mapAsked, mapBuilds[0].tables, mapMounts[0].options, mapMounts[0].host === host(), mapMounts[0].found, host().hidden])
      .toEqual([["build", "mount 1", "show 1"], model.tables, { modelName: "Model one", workspaceName: "Planning", onFailure: expect.any(Function), onGrouping: expect.any(Function) }, true, [false, 0, "Model map"], false]);
    // It is shown and hidden as any other, under the same line, and the tab has still been asked nothing.
    toOverview();
    toMap();
    expect([mapAsked.slice(3), shows()[0], page.id("noteText").textContent, ports[1].posted]).toEqual([["hide 1", "show 1"], "Model map", analysedLine(NOW, NOW), []]);
    // Run again reads Anaplan anew: the map of the result that was brought back ends with that run's start.
    ports[1].send({ type: "subject", subject: { kind: "model", id: MODEL.id } });
    expect(mapAsked).toHaveLength(5);
    page.id("runAgain").press();
    expect([ports[1].posted, mapAsked.slice(5), shows()[0]]).toEqual([[{ type: "run" }], ["destroy 1"], "Overview"]);
  });

  it("says in one sentence that the map could not be drawn when its graph cannot be built, puts the reason in the run's log, and works on", async () => {
    mapThrows.build = new TypeError("Cannot read properties of undefined (reading 'rows')");
    await open(clicked(42));
    ports[0].send({ type: "subject", subject: { kind: "model", id: MODEL.id } });
    ports[0].send({ type: "log", text: "09:30:00 Line Items: 120 rows" });
    sendResult(ports[0], MODEL);
    goTo(1);
    toMap();
    // The view says so under its heading, with what to do, and the page says it to a screen reader.
    // The page's place for the map is hidden and empty, and nothing was mounted.
    expect([shows(), notDrawn(), page.id("live").textContent, host().hidden, host().childNodes.length, mapAsked])
      .toEqual([["Model map", "Model map"], [MAP_FAILED], MAP_FAILED, true, 0, ["build"]]);
    expect(MAP_FAILED).toBe("The model map could not be drawn. The tables are not affected. Choose Copy diagnostic log and send the log.");
    // Why is not on the page. It is in the run's log, after the run's own lines, and the button the sentence names copies that.
    expect(page.find("body").textContent).not.toContain("Cannot read");
    const copy = page.find('#view [data-act="copy-run-log"]');
    expect([copy.localName, copy.textContent.trim(), copy.focusable]).toEqual(["button", "Copy diagnostic log", true]);
    copy.press();
    await settle();
    expect([copied.length, copied[0].split("\n")[0], page.id("toast").textContent]).toEqual([1, "09:30:00 Line Items: 120 rows", "Copied the diagnostic log"]);
    expect(copied[0].split("\n")[1]).toMatch(/^\d\d:\d\d:\d\d Model map: buildModelGraph failed \(TypeError: Cannot read properties of undefined \(reading 'rows'\)\)\.$/);
    expect(copied[0].split("\n")).toHaveLength(2);

    // The rest of the page works on: Run again is there, and the tables open.
    expect(disabled("runAgain")).toEqual([false]);
    goTo(1);
    expect([shows()[0], firstCells().length, page.has("#view .banner")]).toEqual(["Line Items", 50, false]);
    // Chosen again, the entry says the same without another try: the graph is not built twice for one result, and the
    // log has its one line.
    toMap();
    expect([notDrawn(), mapAsked, host().hidden]).toEqual([[MAP_FAILED], ["build"], true]);
    page.find('#view [data-act="copy-run-log"]').press();
    await settle();
    expect(copied[1]).toBe(copied[0]);

    // A new result is tried anew, and its map is drawn when it can be.
    delete mapThrows.build;
    page.id("runAgain").press();
    sendResult(ports[0], MODEL);
    toMap();
    expect([mapAsked, notDrawn(), host().hidden, page.id("live").textContent]).toEqual([["build", "build", "mount 1", "show 1"], [], false, "Model map"]);
  });

  it("says the same when the map cannot be mounted or cannot be shown, and takes away what it had put into its place", async () => {
    // Mounting fails part of the way, with something that is no error: the map had put its elements into the host.
    mapThrows.mount = "the canvas gave no context";
    await openWith(MODEL);
    toMap();
    expect([notDrawn(), host().hidden, host().childNodes.length, mapAsked, shows()[0]]).toEqual([[MAP_FAILED], true, 0, ["build", "mount 1"], "Model map"]);
    page.find('#view [data-act="copy-run-log"]').press();
    await settle();
    expect(copied[0]).toMatch(/^\d\d:\d\d:\d\d Model map: mountModelMap failed \(the canvas gave no context\)\.$/);

    // Mounted, and then it cannot draw: the map is told to go, and its place is hidden and empty again.
    delete mapThrows.mount;
    mapThrows.show = new RangeError("The host has no size.");
    page.id("runAgain").press();
    sendResult(ports[0], MODEL);
    toMap();
    expect([notDrawn(), host().hidden, host().childNodes.length, mapAsked.slice(2)]).toEqual([[MAP_FAILED], true, 0, ["build", "mount 1", "show 1", "destroy 1"]]);
    page.find('#view [data-act="copy-run-log"]').press();
    await settle();
    expect(copied[1]).toMatch(/^\d\d:\d\d:\d\d Model map: show failed \(RangeError: The host has no size\.\)\.$/);
    // The page is whole: its other views are as they were.
    goTo(2);
    expect([shows()[0], firstCells()]).toEqual(["Modules", ["Revenue", "Cost"]]);
  });

  it("works on when the map itself fails as it is told of the theme, hidden or removed: each reason is in the run's log", async () => {
    await openWith(MODEL);
    toMap();
    // Told of the theme: the page has its new theme all the same.
    mapThrows.themeChanged = new Error("No colours.");
    page.id("themeToggle").press();
    expect([page.document.documentElement.dataset.theme, page.id("themeToggle").title]).toEqual(["dark", "Switch to light theme"]);
    // Hidden: the view the user asked for is drawn, and the map's place gives its room back.
    mapThrows.hide = new Error("Still drawing.");
    goTo(1);
    expect([shows()[0], firstCells().length, host().hidden]).toEqual(["Line Items", 50, true]);
    // Shown again, it cannot draw, and told to go it fails once more, before it has taken its elements away: the page
    // empties the place itself, and the view says that the map could not be drawn.
    mapThrows.show = new Error("Nothing to draw on.");
    mapThrows.destroy = new Error("Nothing to remove.");
    toMap();
    expect([mapAsked, notDrawn(), host().hidden, host().childNodes.length]).toEqual([["build", "mount 1", "show 1", "themeChanged 1 dark", "hide 1", "show 1", "destroy 1"], [MAP_FAILED], true, 0]);
    page.find('#view [data-act="copy-run-log"]').press();
    await settle();
    expect(copied[0].split("\n").map(line => line.replace(/^\d\d:\d\d:\d\d /, ""))).toEqual(["Model map: themeChanged failed (Error: No colours.).", "Model map: hide failed (Error: Still drawing.).",
      "Model map: show failed (Error: Nothing to draw on.).", "Model map: destroy failed (Error: Nothing to remove.)."]);

    // A map that cannot be removed stops neither a run nor the result it brings: each takes the page as ever.
    delete mapThrows.show;
    page.id("runAgain").press();
    sendResult(ports[0], MODEL);
    toMap();
    page.id("runAgain").press();
    expect([mapAsked.slice(7), shows()[0], banner().slice(0, 2), host().hidden, host().childNodes.length]).toEqual([["build", "mount 2", "show 2", "destroy 2"], "Overview", ["note", "Analysing"], true, 0]);
    toMap();
    sendResult(ports[0], { ...MODEL, name: "Model two" });
    expect([mapAsked.slice(11), page.document.title, shows()[0], host().hidden, host().childNodes.length, page.id("banners").children])
      .toEqual([["build", "mount 3", "show 3", "destroy 3"], "Cardigan - Model two", "Overview", true, 0, []]);
  });

  it("takes a map that stops by itself for one that could not be drawn: its reason is in the run's log, the view says so beside the button that copies the log, and it is not tried again", async () => {
    mapTakesFocus = true;
    await open(clicked(42));
    ports[0].send({ type: "subject", subject: { kind: "model", id: MODEL.id } });
    ports[0].send({ type: "log", text: "09:30:00 Line Items: 120 rows" });
    sendResult(ports[0], MODEL);
    toMap();
    const button = mapMounts[0].button;
    expect([mapAsked, host().hidden, notDrawn(), page.document.activeElement === button]).toEqual([["build", "mount 1", "show 1"], false, [], true]);

    // The map was drawn. Later it stops by itself, and tells the page why (graph-types.ts `onFailure`). The page takes it
    // away as it does a map that could not be drawn: the map is told to go, and its place is hidden and empty. The view
    // says so under its heading, in the page's one sentence, and the page says it to a screen reader. The navigation's
    // mark is on the map's entry still.
    mapMounts[0].stops("Cannot read properties of undefined (reading 'x')");
    expect([mapAsked.slice(3), host().hidden, host().childNodes.length, button.isConnected, shows(), notDrawn(), page.id("live").textContent])
      .toEqual([["destroy 1"], true, 0, false, ["Model map", "Model map"], [MAP_FAILED], MAP_FAILED]);
    // The focus was inside the map, which is gone: the view has it, at once and when the page is drawn.
    expect(page.document.activeElement).toBe(page.id("view"));
    page.frame();
    expect(page.document.activeElement).toBe(page.id("view"));
    // Why is not on the page. It is one line of the run's log, after the run's own, with its time, and the button the
    // sentence names copies the log with it.
    expect(page.find("body").textContent).not.toContain("Cannot read");
    const copy = page.find('#view [data-act="copy-run-log"]');
    expect([copy.localName, copy.textContent.trim(), copy.focusable]).toEqual(["button", "Copy diagnostic log", true]);
    copy.press();
    await settle();
    expect([copied.length, copied[0].split("\n")[0], page.id("toast").textContent]).toEqual([1, "09:30:00 Line Items: 120 rows", "Copied the diagnostic log"]);
    expect(copied[0].split("\n")[1]).toMatch(/^\d\d:\d\d:\d\d Model map: stopped after it was drawn \(Cannot read properties of undefined \(reading 'x'\)\)\.$/);
    expect(copied[0].split("\n")).toHaveLength(2);

    // The rest of the page works on: Run again is there, and the tables open.
    expect(disabled("runAgain")).toEqual([false]);
    goTo(1);
    expect([shows()[0], firstCells().length, page.has("#view .banner")]).toEqual(["Line Items", 50, false]);
    // The failure is remembered for this result, as one of building the graph is: the entry, chosen again, says the same
    // without another try. A map that was taken away is not heard any more, whatever it tells: the log has its one line.
    mapMounts[0].stops("And once more.");
    toMap();
    expect([notDrawn(), mapAsked, host().hidden, page.id("live").textContent]).toEqual([[MAP_FAILED], ["build", "mount 1", "show 1", "destroy 1"], true, MAP_FAILED]);
    page.find('#view [data-act="copy-run-log"]').press();
    await settle();
    expect(copied[1]).toBe(copied[0]);

    // A new result is tried anew, and its map is drawn. Each map has its own line: a reason that runs over several
    // lines is kept to the one, and a map that gives no reason has the line without one. The run that brought the new
    // result began the log anew.
    for (const [reason, line] of [["The canvas was lost.\n    at draw (map-view.js:1:1)", "Model map: stopped after it was drawn (The canvas was lost. at draw (map-view.js:1:1))."],
      ["  ", "Model map: stopped after it was drawn."]]) {
      page.id("runAgain").press();
      sendResult(ports[0], MODEL);
      toMap();
      expect([mapAsked.slice(-3).map(asked => asked.replace(/ \d+$/, "")), notDrawn(), host().hidden, page.id("live").textContent], reason).toEqual([["build", "mount", "show"], [], false, "Model map"]);
      mapMounts[mapMounts.length - 1].stops(reason);
      page.find('#view [data-act="copy-run-log"]').press();
      await settle();
      expect(copied[copied.length - 1].split("\n").map(each => each.replace(/^\d\d:\d\d:\d\d /, "")), reason).toEqual([line]);
    }
    expect(mapMounts).toHaveLength(3);
  });

  it("says that the map could not be drawn when its entry is next chosen, where the map stops under another view; and leaves the focus where it is on something else of the page", async () => {
    await openWith(MODEL);
    toMap();
    goTo(1);
    page.id("tblSearch").type("item 1");
    const table = () => [shows(), firstCells(), page.id("rowCount").textContent, page.id("live").textContent, page.id("tblSearch").value];
    const before = table();
    // The map stops while a table is on screen. It is taken away at once, and nothing that is seen changes: the table
    // is as it was, the page says nothing, and the focus stays in the search box.
    mapMounts[0].stops("The canvas was lost.");
    expect([mapAsked.slice(3), host().hidden, host().childNodes.length]).toEqual([["hide 1", "destroy 1"], true, 0]);
    expect([table(), page.document.activeElement.id, page.has("#view .banner"), page.id("banners").children.length]).toEqual([before, "tblSearch", false, 0]);
    // The sentence is what the user finds at the map's entry, with the log to copy, which holds the reason. Nothing is
    // built or mounted again.
    toMap();
    expect([notDrawn(), mapAsked.length, host().hidden, page.id("live").textContent, page.document.activeElement === page.id("view")]).toEqual([[MAP_FAILED], 5, true, MAP_FAILED, true]);
    page.find('#view [data-act="copy-run-log"]').press();
    await settle();
    expect(copied[0]).toMatch(/^\d\d:\d\d:\d\d Model map: stopped after it was drawn \(The canvas was lost\.\)\.$/);

    // With the map on screen, the focus on something else of the page stays there: here on the theme's button.
    page.id("runAgain").press();
    sendResult(ports[0], MODEL);
    toMap();
    page.id("themeToggle").focus();
    mapMounts[1].stops("Lost again.");
    expect([notDrawn(), host().hidden, page.document.activeElement.id]).toEqual([[MAP_FAILED], true, "themeToggle"]);
    // The focus on nothing goes to the view, as the focus inside the map does. It is on nothing when the map had it and
    // has written its own place anew before it tells the page.
    mapTakesFocus = true;
    page.id("runAgain").press();
    sendResult(ports[0], MODEL);
    toMap();
    mapMounts[2].button.remove();
    expect(page.document.activeElement).toBe(page.document.body);
    mapMounts[2].stops("And again.");
    expect([notDrawn(), host().hidden, page.document.activeElement === page.id("view")]).toEqual([[MAP_FAILED], true, true]);
  });

  it("takes the map away in the same way when the map tells of its stop while the page tells it something, or from a click or a key inside it", async () => {
    await openWith(MODEL);
    toMap();
    // While it is told of the theme: the page has its new theme, the map is told to go, and the view says so. The focus
    // stays on the theme's button.
    mapTells = { themeChanged: "No colours." };
    page.id("themeToggle").press();
    expect([page.document.documentElement.dataset.theme, mapAsked, notDrawn(), host().hidden, host().childNodes.length, page.document.activeElement.id])
      .toEqual(["dark", ["build", "mount 1", "show 1", "themeChanged 1 dark", "destroy 1"], [MAP_FAILED], true, 0, "themeToggle"]);

    // While it is hidden for another view: that view is drawn as it was chosen, with the focus, and says nothing of the
    // map. The map is told to go once, and its entry says afterwards that it could not be drawn.
    mapTells = {};
    page.id("runAgain").press();
    sendResult(ports[0], MODEL);
    toMap();
    mapTells = { hide: "Still drawing." };
    goTo(1);
    expect([mapAsked.slice(5), shows()[0], firstCells().length, host().hidden, page.has("#view .banner"), page.document.activeElement === page.id("view")])
      .toEqual([["build", "mount 2", "show 2", "hide 2", "destroy 2"], "Line Items", 50, true, false, true]);
    toMap();
    expect([notDrawn(), mapAsked.length, page.id("live").textContent]).toEqual([[MAP_FAILED], 10, MAP_FAILED]);

    // While it is shown again on coming back to it: the view says so, and has the focus.
    mapTells = {};
    page.id("runAgain").press();
    sendResult(ports[0], MODEL);
    toMap();
    goTo(1);
    mapTells = { show: "Nothing to draw on." };
    toMap();
    expect([mapAsked.slice(10), notDrawn(), host().hidden, host().childNodes.length, page.id("live").textContent, page.document.activeElement === page.id("view")])
      .toEqual([["build", "mount 3", "show 3", "hide 3", "show 3", "destroy 3"], [MAP_FAILED], true, 0, MAP_FAILED, true]);

    // From a click inside it, as when the map's own listener fails: the click still comes up to the page, with the map
    // gone. The page reads nothing of it, whatever the element that was clicked is marked with: no view is opened and
    // nothing is copied.
    mapTells = {};
    mapTakesFocus = true;
    page.id("runAgain").press();
    sendResult(ports[0], MODEL);
    toMap();
    const button = mapMounts[3].button;
    button.setAttribute("data-nav", "1");
    button.setAttribute("data-copy", "a text the page would copy");
    mapTells = { click: "The click failed." };
    button.press();
    await settle();
    expect([mapAsked.slice(16), shows()[0], notDrawn(), host().hidden, copied, page.id("toast").textContent, page.document.activeElement === page.id("view")])
      .toEqual([["build", "mount 4", "show 4", "destroy 4"], "Model map", [MAP_FAILED], true, [], "", true]);

    // From a key inside it: the key comes up to the page with the focus on the view by then, and does nothing there.
    mapTells = {};
    page.id("runAgain").press();
    sendResult(ports[0], MODEL);
    toMap();
    mapTells = { keydown: "The key failed." };
    expect([page.document.activeElement === mapMounts[4].button, page.key("/").defaultPrevented]).toEqual([true, false]);
    expect([mapAsked.slice(20), shows()[0], notDrawn(), host().hidden, page.document.activeElement === page.id("view")]).toEqual([["build", "mount 5", "show 5", "destroy 5"], "Model map", [MAP_FAILED], true, true]);
    // Each of the five has its line in the log of its run: here the last one's.
    page.find('#view [data-act="copy-run-log"]').press();
    await settle();
    expect(copied[0].split("\n").map(each => each.replace(/^\d\d:\d\d:\d\d /, ""))).toEqual(["Model map: stopped after it was drawn (The key failed.)."]);
  });

  it("does not hear a map that is not the page's: one that is still being mounted, one that is told to go, and one of an earlier result", async () => {
    /** The run's log, by the button of the view that says the map could not be drawn, without the times. */
    const log = async () => {
      page.find('#view [data-act="copy-run-log"]').press();
      await settle();
      return copied[copied.length - 1].split("\n").map(each => each.replace(/^\d\d:\d\d:\d\d /, ""));
    };
    // A map that tells of a stop while it is being mounted is not heard: one that cannot be mounted throws, and the
    // page says of that what it says of any call that throws.
    mapTells = { mount: "Not yet." };
    mapThrows.mount = new Error("No canvas.");
    await openWith(MODEL);
    toMap();
    expect([mapAsked, notDrawn(), host().hidden, host().childNodes.length]).toEqual([["build", "mount 1"], [MAP_FAILED], true, 0]);
    expect(await log()).toEqual(["Model map: mountModelMap failed (Error: No canvas.)."]);
    // One that tells so and is mounted all the same is the map from then on, drawn as any other. (The stand-in numbers
    // the maps that were mounted: the one that threw is not among them.)
    delete mapThrows.mount;
    page.id("runAgain").press();
    sendResult(ports[0], MODEL);
    toMap();
    expect([mapAsked.slice(2), mapMounts.length, notDrawn(), host().hidden, host().children.length, page.id("live").textContent]).toEqual([["build", "mount 1", "show 1"], 1, [], false, 1, "Model map"]);

    // A map that is told to go is no longer the page's: what it tells while it goes is not heard, and it is told to go
    // once. Here a run starts: the result it brings has its own map, tried anew.
    mapTells = { destroy: "Too late." };
    page.id("runAgain").press();
    expect([mapAsked.slice(5), host().hidden, host().childNodes.length, shows()[0]]).toEqual([["destroy 1"], true, 0, "Overview"]);
    mapTells = {};
    sendResult(ports[0], MODEL);
    toMap();
    expect([mapAsked.slice(6), notDrawn(), host().hidden]).toEqual([["build", "mount 2", "show 2"], [], false]);
    // Nor is the map of the earlier result heard, when it tells of itself after its result has gone: the map on the
    // page stays as it is.
    mapMounts[0].stops("From an earlier result.");
    expect([mapAsked.length, notDrawn(), host().hidden, host().children.length, shows()[0]]).toEqual([9, [], false, 1, "Model map"]);
    // The log of this run has none of those lines: only that of its own map, once that stops.
    mapMounts[1].stops("This one.");
    expect([mapAsked.slice(9), notDrawn()]).toEqual([["destroy 2"], [MAP_FAILED]]);
    expect(await log()).toEqual(["Model map: stopped after it was drawn (This one.)."]);
  });

  it("leaves a key alone while the focus is inside the map, and a click there too: the page's own shortcuts and marks are for the rest of the page", async () => {
    await openWith(MODEL);
    toMap();
    const button = mapMounts[0].button;
    button.focus();
    expect(page.document.activeElement).toBe(button);
    // The slash and Escape, which the page takes elsewhere, and any other key: none is taken, and the focus stays where
    // it is. Nothing is asked of the map either: its keys are its own to hear.
    for (const key of ["/", "Escape", "Enter", "a"]) expect([key, page.key(key).defaultPrevented, page.document.activeElement === button]).toEqual([key, false, true]);
    expect([mapAsked.length, shows()[0]]).toEqual([3, "Model map"]);
    // A click inside the map is the map's as well. The page reads what it marks its own controls with only outside the
    // map: here neither a name of a view nor a text to copy.
    button.setAttribute("data-nav", "1");
    button.setAttribute("data-copy", "a text the page would copy");
    button.press();
    await settle();
    expect([shows()[0], host().hidden, copied, page.id("toast").textContent, mapAsked.length]).toEqual(["Model map", false, [], "", 3]);

    // The rule is the place's, not the view's. To show that, the focus is put into the map's place while a table is on
    // screen, which the page itself never does: there the slash would go to the table's search, and Escape would close
    // a popover. Inside the map's place both are left alone; outside it the page takes them as ever.
    goTo(1);
    host().hidden = false;
    button.focus();
    expect([page.key("/").defaultPrevented, page.document.activeElement === button]).toEqual([false, true]);
    page.id("view").focus();
    expect([page.key("/").defaultPrevented, page.document.activeElement === page.id("tblSearch")]).toEqual([true, true]);
    page.id("colBtn").press();
    button.focus();
    page.key("Escape");
    expect(page.id("popover").hidden).toBe(false);
    page.id("colBtn").focus();
    page.key("Escape");
    expect(page.id("popover").hidden).toBe(true);
  });
});

describe("The ways from a count or a row to where it leads", () => {
  /** BLUEPRINT's modules and line items, as the map's graph holds them: what the button in a row's details reads. */
  const blueprintNodes = () => [
    { id: 0, kind: "module", name: "REV01 Revenue" }, { id: 1, kind: "lineItem", name: "Units", module: 0 }, { id: 2, kind: "lineItem", name: "Price", module: 0 },
    { id: 3, kind: "lineItem", name: "Revenue", module: 0 }, { id: 4, kind: "lineItem", name: "Margin %", module: 0 },
    { id: 5, kind: "module", name: "COST01 Costs" }, { id: 6, kind: "lineItem", name: "Cost", module: 5 },
  ];
  const shows = () => [page.texts("#view h1")[0], page.texts('#navList [aria-current="page"] span')[0]];
  /** Opens a row's details by its first cell. */
  const openRow = (name: string) => {
    const at = firstCells().indexOf(name);
    page.all('#tableWrap tbody [data-act="row"]')[at].press();
  };
  const drawerOpen = () => page.id("drawer").classList.contains("show");
  /** The details' button that shows the row on the map, by its words and its title, if it has one. */
  const mapButton = () => page.all("#drawerOpens button").find(button => button.textContent.trim() === "Model map");

  it("opens a line item's box on the model map from the button at the top right of its details, and a module's", async () => {
    mapNodes = blueprintNodes();
    await openWith(BLUEPRINT);
    goTo(1);
    openRow("Revenue");
    expect([page.id("drawerTitle").textContent, page.id("drawerOpens").hidden, mapButton()?.title, mapButton()?.querySelectorAll("svg").length])
      .toEqual(["Revenue", false, "Show Revenue on the Model map", 1]);
    mapButton()!.press();
    // The details close, the map is shown, and the line item is selected on it.
    expect([drawerOpen(), shows(), mapAsked]).toEqual([false, ["Model map", "Model map"], ["build", "mount 1", "show 1", "reveal 1 3"]]);
    // A module's row: the module, among its section's.
    goTo(2);
    openRow("COST01 Costs");
    mapButton()!.press();
    expect([drawerOpen(), shows()[0], mapAsked.slice(4)]).toEqual([false, "Model map", ["hide 1", "show 1", "reveal 1 5"]]);
    // The graph is built once, for the button and the map both.
    expect(mapBuilds).toHaveLength(1);
  });

  it("opens a module's box from its own row of Line Items, which the table shows as a heading", async () => {
    mapNodes = blueprintNodes();
    await openWith(BLUEPRINT);
    goTo(1);
    openRow("COST01 Costs");
    expect([page.id("drawerTitle").textContent, mapButton()?.title]).toEqual(["COST01 Costs", "Show COST01 Costs on the Model map"]);
    mapButton()!.press();
    expect([drawerOpen(), shows()[0], mapAsked]).toEqual([false, "Model map", ["build", "mount 1", "show 1", "reveal 1 5"]]);
    // A heading's own row there, which the map draws as no module, has none.
    goTo(1);
    openRow("--- Archive ---");
    expect([drawerOpen(), mapButton()]).toEqual([true, undefined]);
  });

  it("opens a module's box on the model map from its row of Module Usage", async () => {
    mapNodes = blueprintNodes();
    const usage: ResultTable = { file: MODULE_USAGE_FILE, label: "Module Usage", guard: true, headers: [...MODULE_USAGE_HEADERS],
      rows: [["COST01 Costs", NONE, "Not on any page", NONE, NONE, NONE], ["Gone (not in the model)", NONE, "Not on any page", NONE, NONE, NONE]] };
    await openWith({ ...BLUEPRINT, tables: [...BLUEPRINT.tables, usage] });
    goTo(3);
    openRow("Gone (not in the model)");
    expect(mapButton()).toBeUndefined();
    page.key("Escape");
    openRow("COST01 Costs");
    mapButton()!.press();
    expect([drawerOpen(), shows()[0], mapAsked.at(-1)]).toEqual([false, "Model map", "reveal 1 5"]);
  });

  it("has no such button for a heading of Modules, nor for a line item the map does not draw", async () => {
    mapNodes = blueprintNodes().filter(node => node.name !== "Cost");
    await openWith(BLUEPRINT);
    goTo(2);
    openRow("--- Archive ---");
    expect(mapButton()).toBeUndefined();
    page.id("drawerClose").press();
    goTo(1);
    openRow("Cost");
    expect(mapButton()).toBeUndefined();
  });

  it("has no such button for an app's rows, which have no map", async () => {
    await openWith(RESULT);
    goTo(2);
    page.all('#tableWrap tbody [data-act="row"]')[0].press();
    expect([drawerOpen(), page.id("drawerOpens").hidden, mapAsked]).toEqual([true, true, []]);
  });

  it("has no such button where the model's graph cannot be made", async () => {
    mapNodes = blueprintNodes();
    mapThrows = { build: new Error("No modules.") };
    await openWith(BLUEPRINT);
    goTo(1);
    openRow("Revenue");
    expect([drawerOpen(), mapButton()]).toEqual([true, undefined]);
  });

  it("opens the table a tile of the overview counts, for an app", async () => {
    await openWith(RESULT);
    const tiles = page.all("#view .stat");
    expect(tiles.map(tile => [tile.localName, tile.dataset.nav])).toEqual([["button", "1"], ["button", "2"]]);
    tiles[1].press();
    expect(shows()).toEqual(["Cards", "Cards"]);
  });

  it("opens the table a tile of the overview counts, for a model", async () => {
    await openWith(BLUEPRINT);
    page.all("#view .stat").find(tile => tile.querySelector(".s-lab")?.textContent === "Modules")!.press();
    expect(shows()).toEqual(["Modules", "Modules"]);
  });
});

describe("The buttons at the top right of a row's details that open it in Anaplan", () => {
  const CUSTOMER = "8a81b01368a3d0e30168b1c7a8d6000b";
  const WORKSPACE = "8a81b08a5ce3b9c4015d0f4b2a3c00aa";
  const ORIGIN = "https://us1a.app.anaplan.com";
  const [APP, BOARD, SHEET, REPORT] = ["0f1e2d3c-4b5a-4968-8778-695a4b3c2d1e", "11111111-2222-4333-8444-555555555555", "22222222-3333-4444-8555-666666666666",
    "33333333-4444-4555-8666-777777777777"];
  /** BLUEPRINT as the export makes it now: its workspace in the Details file, and its modules' IDs. The heading has none. */
  const OPENS: AnalysisResult = {
    ...BLUEPRINT, tables: [{ ...BLUEPRINT.tables[0], rows: [...BLUEPRINT.tables[0].rows, ["Model", "Workspace ID", WORKSPACE]] }, ...BLUEPRINT.tables.slice(1)],
    moduleIds: [["REV01 Revenue", "102000000001"], ["COST01 Costs", "102000000002"]],
  };
  /** A row of one of the tables of the pages built on a model, by its cells under these headers, the rest a dash. */
  const pageRow = (headers: readonly string[], cells: Record<string, Cell>): Cell[] => headers.map(header => cells[header] ?? NONE);
  const place = (type: string, page: string) => ({ App: `Planning ${TAG}`, "Page type": type, "App ID": APP, "Page ID": page });
  /** The same model with the three tables of the pages built on it, as a run writes them (model-pages.ts). */
  const WITH_PAGES: AnalysisResult = { ...OPENS, tables: [...OPENS.tables,
    { file: MODULE_USAGE_FILE, label: "Module Usage", guard: true, headers: [...MODULE_USAGE_HEADERS], rows: [
      pageRow(MODULE_USAGE_HEADERS, { Module: "REV01 Revenue", Page: "Revenue board", ...place("Board", BOARD) }),
      pageRow(MODULE_USAGE_HEADERS, { Module: "REV01 Revenue", Page: "Revenue sheet", ...place("Worksheet", SHEET) }),
      pageRow(MODULE_USAGE_HEADERS, { Module: "COST01 Costs", Page: "Cost report", ...place("Report", REPORT) }),
      pageRow(MODULE_USAGE_HEADERS, { Module: "COST01 Costs", Page: "Odd page", ...place("Planning page", BOARD) }),
      pageRow(MODULE_USAGE_HEADERS, { Module: "--- Archive ---", Page: "Not on any page" })] },
    { file: PAGE_FILTERS_FILE, label: "Page Filters", guard: true, headers: [...PAGE_FILTERS_HEADERS], rows: [
      pageRow(PAGE_FILTERS_HEADERS, { "Condition line item's module": "REV01 Revenue", "Condition line item": "Units", "Filtered module": "COST01 Costs", Page: "Revenue board",
        ...place("Board", BOARD) }),
      pageRow(PAGE_FILTERS_HEADERS, { "Condition line item's module": "REV01 Revenue", "Condition line item": "Price", "Filtered module": "REV01 Revenue", Page: "Revenue sheet",
        ...place("Worksheet", SHEET) })] },
    { file: PAGE_ACTIONS_FILE, label: "Page Actions", guard: true, headers: [...PAGE_ACTIONS_HEADERS], rows: [
      pageRow(PAGE_ACTIONS_HEADERS, { "Model action name": "Import prices", "Button label": "Load prices", Page: "Cost report", ...place("Report", REPORT) })] }] };
  const link = (module: string) => `${ORIGIN}/a/modeling/customers/${CUSTOMER}/workspaces/${WORKSPACE}/models/${BLUEPRINT.id}/tabs/${module}`;
  /** How the content script answers the page's ask to open a module inside the Model Building page it shows: that it did,
   * that it could not, or nothing at all, as a content script of an earlier build that does not know the ask. */
  let inPage: "opened" | "not" | "silent" | "old-reader";
  beforeEach(() => {
    inPage = "not";
    // Every port to the tab has the content script at its other end, which answers asks to open a module.
    const tabs = (globalThis as unknown as { chrome: { tabs: { connect: (...args: unknown[]) => FakePort } } }).chrome.tabs;
    const connect = tabs.connect;
    tabs.connect = (...args: unknown[]) => {
      const port = connect(...args);
      answerOpens(port);
      return port;
    };
  });
  /** The content script at the other end of a port answers each ask to open a module as `inPage` says. */
  const answerOpens = (port: FakePort) => {
    const post = port.postMessage.bind(port);
    port.postMessage = (message: unknown) => {
      post(message);
      const asked = message as { type?: string; nonce?: string };
      if (asked.type !== "open" || inPage === "silent") return;
      // A frame that holds the reader of an earlier build says so once; with this build's reader put beside it, it opens.
      if (inPage === "old-reader") {
        inPage = "opened";
        queueMicrotask(() => port.send({ type: "opened", nonce: String(asked.nonce), opened: false, detail: "the model's frame holds a reader of another build", oldReader: true }));
        return;
      }
      const opened = inPage === "opened";
      queueMicrotask(() => port.send({ type: "opened", nonce: String(asked.nonce), opened, detail: opened ? "Model Building opened it beside the modules open there" : "the tab shows another model" }));
    };
  };
  /** What the page asked the content script to open inside its page, in order. */
  const asks = () => ports.flatMap(port => port.posted.filter(message => (message as { type?: string }).type === "open"));
  /** The lines of the run's log that say how a module was opened, without their times, as the page's button beside a run
   * copies that log: one of its kind is put on the page for the moment, and pressed. */
  const openedLines = async () => {
    const copy = page.document.createElement("button");
    copy.dataset.act = "copy-run-log";
    page.document.body.append(copy);
    copy.press();
    await settle();
    copy.remove();
    return (copied.at(-1) ?? "").split("\n").filter(line => / Opened /.test(line)).map(line => line.replace(/^\d\d:\d\d:\d\d /, ""));
  };
  /** Opens the page on a model the tab shows in Model Building, as the content script says it: with its site and customer. */
  const openModel = async (result: AnalysisResult = OPENS, subject: object = { kind: "model", id: result.id, origin: ORIGIN, customer: CUSTOMER }) => {
    await open(clicked(7));
    ports[0].send({ type: "subject", subject });
    sendResult(ports[0], result);
    // The result is kept for a refresh before the test goes on, so that no keeping is left to end after the test.
    await letKeep();
  };
  /** Opens a row's details, by the text of its first cell. */
  const openRow = (name: string) => page.all('#tableWrap tbody [data-act="row"]')[firstCells().indexOf(name)].press();
  /** The buttons at the top right of the details: each one's words and its title. */
  const opens = () => page.all("#drawerOpens button").map(button => [button.textContent.trim(), button.title]);
  /** Presses the button of the details that says these words, and lets what it starts come to its end: a module is asked
   * of the tab first, which answers in a turn of its own. */
  const press = async (label: string) => {
    page.all("#drawerOpens button").find(button => button.textContent.trim() === label)!.press();
    for (let turn = 0; turn < 20; turn++) await Promise.resolve();
  };
  /** The line under the details' header, while it is shown. */
  const why = () => (page.id("drawerWhy").hidden ? undefined : page.id("drawerWhy").textContent);
  const drawerOpen = () => page.id("drawer").classList.contains("show");
  const toastSays = () => page.id("toast").textContent;

  it("gives a tab whose model's frame still holds an earlier reader this build's, and then opens the module inside the page after all; where Chrome refuses, it loads the address", async () => {
    await openModel();
    goTo(1);
    openRow("Revenue");
    inPage = "old-reader";
    scriptingAllows = true;
    await press("Model");
    // The reader goes into every frame Chrome lets the page reach, in the page's own world, and nothing is asked meanwhile.
    expect([injected, asks()]).toEqual([[{ target: { tabId: 7, allFrames: true }, files: ["dist/model-export.js"], world: "MAIN" }], [expect.objectContaining({ type: "open" })]]);
    await vi.advanceTimersByTimeAsync(1500);
    for (let turn = 0; turn < 20; turn++) await Promise.resolve();
    // Asked again once the reader has had time to check in: Model Building opens the module beside the ones open there,
    // and no address is loaded.
    expect(asks()).toHaveLength(2);
    expect(tabUpdates).toEqual([[7, { active: true }]]);
    expect(await openedLines()).toEqual(["Opened the module REV01 Revenue inside the Model Building page of the Anaplan tab Cardigan read: Model Building opened it beside the modules open there."]);

    // Where Chrome refuses, the page loads the module's address, as it always has, and asks nothing again.
    tabUpdates.length = 0;
    inPage = "old-reader";
    scriptingAllows = false;
    await press("Model");
    expect([asks().length, tabUpdates]).toEqual([3, [[7, { url: link("102000000001"), active: true }]]]);
    expect(tabReloads).toEqual([]);
  });

  it("opens a line item's module, and a module, in Model Building in the Anaplan tab Cardigan read, by its address where the tab cannot open it inside its page, and brings that tab's window to the front", async () => {
    await openModel();
    goTo(1);
    // No row says that a double-click does anything, and a double-click does nothing.
    expect(page.all("#tableWrap tbody tr").map(row => row.getAttribute("title"))).toEqual(Array(8).fill(null));
    openRow("Revenue");
    expect([opens(), page.id("drawerOpens").hidden, why()]).toEqual([[["Model", "Open REV01 Revenue in Model Building"]], false, undefined]);
    page.id("scrim").dispatch("dblclick");
    await settle();
    expect([tabUpdates, asks()]).toEqual([[], []]);
    // The tab is asked first, and says it cannot: it goes to the module's address and comes to the front, and so does its
    // window; the details stay open behind it.
    await press("Model");
    expect(asks()).toEqual([{ type: "open", nonce: expect.any(String), model: OPENS.id, object: "102000000001" }]);
    expect([tabUpdates, windowUpdates, drawerOpen()]).toEqual([[[7, { url: link("102000000001"), active: true }]], [[3, { focused: true }]], true]);
    page.key("Escape");
    goTo(2);
    openRow("COST01 Costs");
    await press("Model");
    expect([tabUpdates.at(-1), windowUpdates.length, tabCreates]).toEqual([[7, { url: link("102000000002"), active: true }], 2, []]);
    // The diagnostic log says which way each was opened, and why.
    expect(await openedLines()).toEqual(["Opened the module REV01 Revenue by its address in the Anaplan tab Cardigan read, which loads Model Building afresh: the tab shows another model.",
      "Opened the module COST01 Costs by its address in the Anaplan tab Cardigan read, which loads Model Building afresh: the tab shows another model."]);
  });

  it("opens a module inside the Model Building page where the tab can, beside the modules open there: the tab is only brought to the front, with its window", async () => {
    inPage = "opened";
    await openModel();
    goTo(1);
    openRow("Revenue");
    await press("Model");
    // The tab is asked for the module by the model's ID and the module's; it opens it, and is not sent anywhere.
    expect(asks()).toEqual([{ type: "open", nonce: expect.any(String), model: OPENS.id, object: "102000000001" }]);
    expect([tabUpdates, windowUpdates, tabCreates, drawerOpen()]).toEqual([[[7, { active: true }]], [[3, { focused: true }]], [], true]);
    expect(await openedLines()).toEqual(["Opened the module REV01 Revenue inside the Model Building page of the Anaplan tab Cardigan read: Model Building opened it beside the modules open there."]);
    // Each ask has a nonce of its own.
    page.key("Escape");
    goTo(2);
    openRow("COST01 Costs");
    await press("Model");
    expect([asks().length, new Set(asks().map(ask => (ask as { nonce: string }).nonce)).size, tabUpdates.at(-1)]).toEqual([2, 2, [7, { active: true }]]);
  });

  it("loads the module's address where the tab says nothing in time, as one with an earlier Cardigan's script, and asks again on a port of its own once the tab has loaded it", async () => {
    inPage = "silent";
    await openModel();
    goTo(1);
    openRow("Revenue");
    await press("Model");
    // The page waits for the answer a while, and the tab stays where it is meanwhile.
    expect([asks().length, tabUpdates]).toEqual([1, []]);
    await vi.advanceTimersByTimeAsync(OPEN_WAIT_MS - 1);
    expect(tabUpdates).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect([tabUpdates, windowUpdates]).toEqual([[[7, { url: link("102000000001"), active: true }]], [[3, { focused: true }]]]);
    expect(await openedLines()).toEqual(["Opened the module REV01 Revenue by its address in the Anaplan tab Cardigan read, which loads Model Building afresh: the Anaplan tab did not answer."]);
    // The port the page followed the tab on has closed, as once the tab has loaded the module's address: the page asks
    // the tab again on a port of the ask's own, and the tab, now with this build's script, opens the module inside its page.
    ports[0].drop();
    inPage = "opened";
    await press("Model");
    expect([connects.length, asks().length, tabUpdates.slice(1)]).toEqual([2, 2, [[7, { active: true }]]]);
  });

  it("opens a module from its own row of Line Items, as from its row of Modules, with the map's button above", async () => {
    mapNodes = [{ id: 0, kind: "module", name: "REV01 Revenue" }, { id: 5, kind: "module", name: "COST01 Costs" }];
    await openModel();
    goTo(1);
    openRow("COST01 Costs");
    expect(opens()).toEqual([["Model map", "Show COST01 Costs on the Model map"], ["Model", "Open COST01 Costs in Model Building"]]);
    await press("Model");
    expect(tabUpdates).toEqual([[7, { url: link("102000000002"), active: true }]]);
    // A heading's own row has neither: the map draws no module of it, and the export found no ID for it.
    page.key("Escape");
    openRow("--- Archive ---");
    expect([opens(), page.id("drawerOpens").hidden]).toEqual([[], true]);
  });

  it("has the button only for a row whose module the export found an ID for: none for a heading, nor for a module without one", async () => {
    await openModel({ ...OPENS, moduleIds: [["REV01 Revenue", "102000000001"]] });
    goTo(2);
    for (const name of ["--- Archive ---", "COST01 Costs"]) {
      openRow(name);
      expect([name, opens(), page.id("drawerOpens").hidden, why()]).toEqual([name, [], true, undefined]);
      page.key("Escape");
    }
  });

  it("says why under the header where the result keeps every module from opening: one an earlier version kept", async () => {
    const { moduleIds: _ids, ...earlier } = OPENS;
    await openModel(earlier);
    goTo(1);
    openRow("Units");
    expect([opens(), why()]).toEqual([[], "This result has no IDs for the model's modules: an earlier version of Cardigan read it. Choose Run again to open modules from here."]);
  });

  it("says why where the export found no module's ID, and asks for the log", async () => {
    await openModel({ ...OPENS, moduleIds: [] });
    goTo(1);
    openRow("Units");
    expect([opens(), why()]).toEqual([[], "Cardigan found no IDs for this model's modules, so it cannot open them in Model Building. "
      + "Choose Copy diagnostic log on the Overview and send the log."]);
  });

  it("says why where neither the result nor the tab says where the model is, as for the classic model page", async () => {
    await openModel(OPENS, { kind: "model", id: OPENS.id });
    goTo(1);
    openRow("Units");
    expect([opens(), why()]).toEqual([[], "To open modules, apps and pages from here, open the model in Model Building, then click the Cardigan icon on that tab."]);
  });

  it("says why where the result does not say the model's workspace", async () => {
    await openModel({ ...OPENS, tables: BLUEPRINT.tables });
    goTo(1);
    openRow("Units");
    expect([opens(), why()]).toEqual([[], "This result does not say which workspace the model is in, so Cardigan cannot open its modules. Choose Run again."]);
  });

  it("opens the model where its result says it is, whatever the tab shows now", async () => {
    await openModel({ ...OPENS, site: { origin: "https://eu2a.app.anaplan.com", customer: CUSTOMER.toUpperCase() } }, { kind: "app", id: APP });
    goTo(1);
    openRow("Units");
    await press("Model");
    expect(tabUpdates).toEqual([[7, { url: `https://eu2a.app.anaplan.com/a/modeling/customers/${CUSTOMER.toUpperCase()}/workspaces/${WORKSPACE}/models/${OPENS.id}/tabs/102000000001`,
      active: true }]]);
  });

  it("opens a module, its app and its page from Module Usage, each page by its type's address, and nothing for a page of a type it does not know", async () => {
    await openModel(WITH_PAGES);
    choose(String(WITH_PAGES.tables.findIndex(table => table.file === MODULE_USAGE_FILE)));
    const app = `${ORIGIN}/a/apps/app/${APP}`;
    const pages = [["Revenue board", `${app}/boards/${BOARD}`], ["Revenue sheet", `${app}/worksheets/${SHEET}`], ["Cost report", `${app}/reports/${REPORT}`]];
    const addresses: string[] = [];
    for (const [row, [name, address]] of pages.entries()) {
      page.all('#tableWrap tbody [data-act="row"]')[row].press();
      expect(opens().map(([label]) => label), name).toEqual(["Model", "App", "Page"]);
      expect(opens().slice(1).map(([, title]) => title), name).toEqual([`Open the app Planning ${TAG} in Anaplan`, `Open the page ${name} in Anaplan`]);
      await press("App");
      await press("Page");
      addresses.push(app, address);
      page.key("Escape");
    }
    // The first app opens the tab of apps and pages, after the results page's own, and every address after it goes there.
    expect(tabCreates).toEqual([[{ url: app, active: true, index: OWN_TAB.index + 1, openerTabId: OWN_TAB.id }]]);
    expect(tabUpdates).toEqual(addresses.slice(1).map(url => [101, { url, active: true }]));
    // A page whose type has no address of its own here: its app is opened, and it is not.
    page.all('#tableWrap tbody [data-act="row"]')[3].press();
    expect(opens().map(([label]) => label)).toEqual(["Model", "App"]);
    page.key("Escape");
    // A module on no page has no app and no page to open, and the heading no ID: nothing, and nothing to say.
    page.all('#tableWrap tbody [data-act="row"]')[4].press();
    expect([opens(), why()]).toEqual([[], undefined]);
    // An app's name is written as text, in the title too.
    expect(strayImg()).toBe(false);
    // The model's tab never goes to an app: it is asked to open nothing inside its page, and is sent nowhere.
    expect([asks(), tabUpdates.filter(([tab]) => tab === 7)]).toEqual([[], []]);
  });

  it("opens a filter's two modules, its app and its page from Page Filters, one module where the two are one, and a button's app and page from Page Actions", async () => {
    await openModel(WITH_PAGES);
    choose(String(WITH_PAGES.tables.findIndex(table => table.file === PAGE_FILTERS_FILE)));
    openRow("REV01 Revenue");
    expect(opens()).toEqual([["Condition module", "Open REV01 Revenue in Model Building"], ["Filtered module", "Open COST01 Costs in Model Building"],
      ["App", `Open the app Planning ${TAG} in Anaplan`], ["Page", "Open the page Revenue board in Anaplan"]]);
    await press("Condition module");
    await press("Filtered module");
    expect(tabUpdates.map(([, properties]) => (properties as { url: string }).url)).toEqual([link("102000000001"), link("102000000002")]);
    page.key("Escape");
    page.all('#tableWrap tbody [data-act="row"]')[1].press();
    expect(opens().map(([label]) => label)).toEqual(["Model", "App", "Page"]);
    page.key("Escape");
    choose(String(WITH_PAGES.tables.findIndex(table => table.file === PAGE_ACTIONS_FILE)));
    openRow("Import prices");
    // The model's action is on the Actions page of Model Building.
    expect(opens()).toEqual([["Model", "Open Actions in Model Building"], ["App", `Open the app Planning ${TAG} in Anaplan`], ["Page", "Open the page Cost report in Anaplan"]]);
    await press("Page");
    expect([tabUpdates.length, tabCreates]).toEqual([2, [[{ url: `${ORIGIN}/a/apps/app/${APP}/reports/${REPORT}`, active: true, index: OWN_TAB.index + 1, openerTabId: OWN_TAB.id }]]]);
  });

  it("says why the tables of the pages built on a model open no app and no page in a result an earlier version kept", async () => {
    const earlier = { ...WITH_PAGES, tables: WITH_PAGES.tables.map(table => (table.file === PAGE_ACTIONS_FILE
      ? { ...table, headers: table.headers.filter(header => !["Page type", "App ID", "Page ID"].includes(header)), rows: table.rows.map(row => row.slice(0, 9).concat(row.slice(12))) }
      : table)) };
    await openModel(earlier);
    choose(String(earlier.tables.findIndex(table => table.file === PAGE_ACTIONS_FILE)));
    openRow("Import prices");
    expect([opens(), why()]).toEqual([[["Model", "Open Actions in Model Building"]],
      "This result has no IDs for its apps and pages: an earlier version of Cardigan read it. Choose Run again to open them from here."]);
  });

  it("opens one tab in the place of the Anaplan tab once that is closed, and every later address in that one", async () => {
    await openModel();
    tabClosed = true;
    goTo(1);
    openRow("Units");
    await press("Model");
    // The closed tab is asked first; then one tab is opened, and comes to the front with its window.
    expect([tabUpdates.map(([tab]) => tab), tabCreates, windowUpdates]).toEqual([[7], [[{ url: link("102000000001"), active: true, index: OWN_TAB.index + 1, openerTabId: OWN_TAB.id }]],
      [[3, { focused: true }]]]);
    page.key("Escape");
    goTo(2);
    openRow("COST01 Costs");
    await press("Model");
    // The next address goes to that tab, and no other is opened. That tab is not the one this page is connected to: it is
    // asked to open nothing inside its page.
    expect([tabUpdates.map(([tab]) => tab), tabCreates.length, windowUpdates.length, asks().length]).toEqual([[7, 101], 1, 2, 1]);
    // A tab that can be neither used nor opened: the page says so.
    tabsRefuse = true;
    await press("Model");
    expect([toastSays(), tabCreates.length]).toEqual(["Cardigan could not open that in Anaplan.", 1]);
  });

  it("keeps the tab that took the closed Anaplan tab's place for a refresh of the results page, and sends the next module there", async () => {
    // The result says where the model is, as a run in Model Building makes it: a refreshed page has no tab to say it.
    await openModel({ ...OPENS, site: { origin: ORIGIN, customer: CUSTOMER } });
    tabClosed = true;
    goTo(1);
    openRow("Units");
    await press("Model");
    expect(tabCreates.length).toBe(1);
    // A refresh shows the kept result; the next module goes to that same tab, and no other is opened.
    await refresh();
    goTo(1);
    openRow("Units");
    await press("Model");
    expect([tabCreates.length, tabUpdates.at(-1)]).toEqual([1, [101, { url: link("102000000001"), active: true }]]);
  });

  /** The model with its General Lists, the lists' IDs, and filters on a list, on one of its subsets and on Time. */
  const LISTS: ResultTable = { file: "General Lists.csv", label: "General Lists", guard: false, headers: ["", "Subsets", "Item Count"],
    rows: [["Products", "Active Products", "120"], ["Regions", "", "8"], ["--- Archive ---", "", "0"]] };
  const filterOn = (dimension: string, module = "COST01 Costs") => pageRow(PAGE_FILTERS_HEADERS, { "Condition line item's module": "REV01 Revenue",
    "Condition line item": "Units", "Filtered module": module, "Filtered dimension": dimension, Page: "Revenue board", ...place("Board", BOARD) });
  const WITH_LISTS: AnalysisResult = { ...OPENS, listIds: [["Products", "101000000017"], ["Regions", "101000000018"]],
    tables: [...OPENS.tables, LISTS, { file: PAGE_FILTERS_FILE, label: "Page Filters", guard: true, headers: [...PAGE_FILTERS_HEADERS],
      rows: [filterOn("Products"), filterOn("Active Products", "REV01 Revenue"), filterOn("Time")] }] };
  const table = (result: AnalysisResult, file: string) => choose(String(result.tables.findIndex(each => each.file === file)));
  /** Refreshes the results page, which shows the result it kept once it has read it back. */
  const refresh = async () => {
    await open("?tab=7");
    await eventually(() => page.has('#navList [data-nav="1"]'), "the kept result to come back");
  };

  it("opens a list from its row of General Lists: on the map, and in Model Building, inside the page where the tab can", async () => {
    mapNodes = [{ id: 3, kind: "list", name: "Products" }, { id: 4, kind: "subset", name: "Active Products", parent: 3 }];
    inPage = "opened";
    await openModel(WITH_LISTS);
    table(WITH_LISTS, "General Lists.csv");
    openRow("Products");
    expect([opens(), why()]).toEqual([[["Model map", "Show Products on the Model map"], ["Model", "Open Products in Model Building"]], undefined]);
    await press("Model");
    // The tab is asked for the list by its ID, as for a module, and opens it beside the tabs open there.
    expect(asks()).toEqual([{ type: "open", nonce: expect.any(String), model: OPENS.id, object: "101000000017" }]);
    expect([tabUpdates, tabCreates]).toEqual([[[7, { active: true }]], []]);
    page.key("Escape");
    // Where the tab cannot, the list's own Model Building link is loaded in the model's tab.
    inPage = "not";
    openRow("Regions");
    expect(opens()).toEqual([["Model", "Open Regions in Model Building"]]);
    await press("Model");
    expect(tabUpdates.at(-1)).toEqual([7, { url: link("101000000018"), active: true }]);
    expect(await openedLines()).toEqual(["Opened the list Products inside the Model Building page of the Anaplan tab Cardigan read: Model Building opened it beside the modules open there.",
      "Opened the list Regions by its address in the Anaplan tab Cardigan read, which loads Model Building afresh: the tab shows another model."]);
    page.key("Escape");
    // A list the export found no ID for has no Model button, and nothing is said of it.
    openRow("--- Archive ---");
    expect([opens(), why()]).toEqual([[], undefined]);
  });

  it("says why no list opens in a result an earlier version kept, and nothing of a filter's dimension", async () => {
    const { listIds: _ids, ...earlier } = WITH_LISTS;
    await openModel(earlier);
    table(earlier, "General Lists.csv");
    openRow("Products");
    expect([opens(), why()]).toEqual([[], "This result has no IDs for the model's lists: an earlier version of Cardigan read it. Choose Run again to open lists from here."]);
    page.key("Escape");
    // A filter's dimension says nothing of it: its modules still open.
    table(earlier, PAGE_FILTERS_FILE);
    page.all('#tableWrap tbody [data-act="row"]')[0].press();
    expect([opens().map(([label]) => label), why()]).toEqual([["Condition module", "Filtered module", "App", "Page"], undefined]);
  });

  it("says why no list opens where the export found no list's ID, and asks for the log", async () => {
    await openModel({ ...WITH_LISTS, listIds: [] });
    table(WITH_LISTS, "General Lists.csv");
    openRow("Products");
    expect([opens(), why()]).toEqual([[], "Cardigan found no IDs for this model's lists, so it cannot open them in Model Building. "
      + "Choose Copy diagnostic log on the Overview and send the log."]);
  });

  it("opens the list a filter's dimension is from Page Filters, a subset's list too, and none for Time", async () => {
    mapNodes = [{ id: 3, kind: "list", name: "Products" }, { id: 4, kind: "subset", name: "Active Products", parent: 3 }];
    await openModel(WITH_LISTS);
    table(WITH_LISTS, PAGE_FILTERS_FILE);
    const row = (at: number) => page.all('#tableWrap tbody [data-act="row"]')[at].press();
    row(0);
    expect(opens()).toEqual([["Condition module", "Open REV01 Revenue in Model Building"], ["Filtered module", "Open COST01 Costs in Model Building"],
      ["Filtered list", "Open Products in Model Building"], ["App", `Open the app Planning ${TAG} in Anaplan`], ["Page", "Open the page Revenue board in Anaplan"]]);
    await press("Filtered list");
    expect(tabUpdates).toEqual([[7, { url: link("101000000017"), active: true }]]);
    page.key("Escape");
    // A subset opens its list; the one module of the filter is one Model button.
    row(1);
    expect(opens().map(([label, title]) => `${label}: ${title}`).slice(0, 2)).toEqual(["Model: Open REV01 Revenue in Model Building", "Filtered list: Open Products in Model Building"]);
    page.key("Escape");
    // Time is no list of the model's: no button for it.
    row(2);
    expect(opens().map(([label]) => label)).toEqual(["Condition module", "Filtered module", "App", "Page"]);
  });

  it("opens the Model Building page each table of the model's settings is on, by its address in the model's tab: Time, Versions, Line Item Subsets, Actions, Source Models", async () => {
    const one = (file: string, first: string): ResultTable => ({ file, label: file.replace(/\.csv$/, ""), guard: false, headers: ["", "Notes"], rows: [[first, "Kept"]] });
    const pages: [file: string, row: string, page: string, id: string][] = [["Time Ranges.csv", "FY24 range", "Time", "9000000001"], ["Versions.csv", "Actual", "Versions", "9000000002"],
      ["Line Item Subsets.csv", "Cost lines", "Line Item Subsets", "-5"], ["Processes.csv", "Nightly load", "Actions", "-19"], ["Imports.csv", "Prices from the hub", "Actions", "-19"],
      ["Exports.csv", "Plan export", "Actions", "-19"], ["Other Actions.csv", "Order regions", "Actions", "-19"], ["Import Data Sources.csv", "Hub data", "Actions", "-19"],
      ["Source Models.csv", "Hub", "Source Models", "-13"]];
    const calendar = WITH_CALENDAR.tables.find(each => each.file === "Model Calendar.csv")!;
    const SETTINGS: AnalysisResult = { ...OPENS, tables: [...OPENS.tables, calendar, ...pages.map(([file, row]) => one(file, row))] };
    await openModel(SETTINGS);
    for (const [file, row, name, id] of pages) {
      table(SETTINGS, file);
      openRow(row);
      expect(opens(), file).toEqual([["Model", `Open ${name} in Model Building`]]);
      await press("Model");
      expect(tabUpdates.at(-1), file).toEqual([7, { url: link(id), active: true }]);
      page.key("Escape");
    }
    // Model Calendar is on the Time page too.
    table(SETTINGS, "Model Calendar.csv");
    page.all('#tableWrap tbody [data-act="row"]')[0].press();
    expect(opens()).toEqual([["Model", "Open Time in Model Building"]]);
    // A page is opened by its address alone: the tab is asked to open nothing inside its page, and the log says the page.
    expect([asks(), (await openedLines()).at(-1)]).toEqual([[], "Opened the Source Models page by its address in the Anaplan tab Cardigan read, which loads Model Building afresh."]);
  });

  it("opens a Dynamic Cell Access row's two modules, the driver's and the controlled one, one Model where they are one", async () => {
    const access: ResultTable = { file: "Dynamic Cell Access.csv", label: "Dynamic Cell Access", guard: false,
      headers: ["Driver Module", "Driver Line Item", "Access", "Controlled Module", "Controlled Line Item"],
      rows: [["REV01 Revenue", "Open", "Write", "COST01 Costs", "Units"], ["REV01 Revenue", "Locked", "Read", "REV01 Revenue", "Price"]] };
    const ACCESS: AnalysisResult = { ...OPENS, tables: [...OPENS.tables, access] };
    await openModel(ACCESS);
    table(ACCESS, "Dynamic Cell Access.csv");
    const rows = () => page.all('#tableWrap tbody [data-act="row"]');
    rows()[0].press();
    expect(opens()).toEqual([["Driver module", "Open REV01 Revenue in Model Building"], ["Controlled module", "Open COST01 Costs in Model Building"]]);
    await press("Controlled module");
    expect(tabUpdates.at(-1)).toEqual([7, { url: link("102000000002"), active: true }]);
    page.key("Escape");
    rows()[1].press();
    expect(opens()).toEqual([["Model", "Open REV01 Revenue in Model Building"]]);
  });

  it("says why no settings page opens where neither the result nor the tab says where the model is", async () => {
    const versions: ResultTable = { file: "Versions.csv", label: "Versions", guard: false, headers: ["", "Notes"], rows: [["Actual", "Kept"]] };
    const SETTINGS: AnalysisResult = { ...OPENS, tables: [...OPENS.tables, versions] };
    await openModel(SETTINGS, { kind: "model", id: OPENS.id });
    table(SETTINGS, "Versions.csv");
    openRow("Actual");
    expect([opens(), why()]).toEqual([[], "To open modules, apps and pages from here, open the model in Model Building, then click the Cardigan icon on that tab."]);
  });

  it("opens apps and pages in a tab of their own after the results page, every later one in that tab, and never sends the model's tab to an app", async () => {
    await openModel(WITH_PAGES);
    table(WITH_PAGES, MODULE_USAGE_FILE);
    const app = `${ORIGIN}/a/apps/app/${APP}`;
    page.all('#tableWrap tbody [data-act="row"]')[0].press();
    await press("App");
    // The first opens a tab after the results page's own, which it opened, and brings it to the front with its window.
    expect([tabCreates, tabUpdates, windowUpdates]).toEqual([[[{ url: app, active: true, index: OWN_TAB.index + 1, openerTabId: OWN_TAB.id }]], [], [[3, { focused: true }]]]);
    await press("Page");
    expect([tabCreates.length, tabUpdates]).toEqual([1, [[101, { url: `${app}/boards/${BOARD}`, active: true }]]]);
    // The module goes to the model's tab, which the tab of apps and pages leaves alone, and back.
    await press("Model");
    await press("App");
    expect(tabUpdates.map(([tab]) => tab)).toEqual([101, 7, 101]);
    expect(await openedLines()).toEqual([`Opened the app Planning ${TAG} in a new tab: later apps and pages open there.`, "Opened the page Revenue board in the tab of apps and pages.",
      "Opened the module REV01 Revenue by its address in the Anaplan tab Cardigan read, which loads Model Building afresh: the tab shows another model.",
      `Opened the app Planning ${TAG} in the tab of apps and pages.`]);
  });

  it("opens a new tab of apps and pages where the user closed the one before, and uses that one after", async () => {
    await openModel(WITH_PAGES);
    table(WITH_PAGES, MODULE_USAGE_FILE);
    page.all('#tableWrap tbody [data-act="row"]')[0].press();
    await press("App");
    closedTabs.add(101);
    await press("Page");
    await press("App");
    expect([tabCreates.map(([properties]) => (properties as { url: string }).url), tabUpdates.map(([tab]) => tab)])
      .toEqual([[`${ORIGIN}/a/apps/app/${APP}`, `${ORIGIN}/a/apps/app/${APP}/boards/${BOARD}`], [101, 102]]);
    expect((await openedLines())[1]).toBe("Opened the page Revenue board in a new tab, as the tab of apps and pages was closed: later apps and pages open there.");
    // A tab that can be neither used nor opened: the page says so, and the model's tab is not used in its place.
    tabsRefuse = true;
    await press("Page");
    expect([toastSays(), tabUpdates.filter(([tab]) => tab === 7)]).toEqual(["Cardigan could not open that in Anaplan.", []]);
  });

  it("keeps the tab of apps and pages for a refresh of the results page, and uses a kept tab only where the browser says this page opened it", async () => {
    await openModel({ ...WITH_PAGES, site: { origin: ORIGIN, customer: CUSTOMER } });
    table(WITH_PAGES, MODULE_USAGE_FILE);
    page.all('#tableWrap tbody [data-act="row"]')[0].press();
    await press("App");
    expect(session.held.get("cardigan-app-tab")).toBe("101");
    await refresh();
    table(WITH_PAGES, MODULE_USAGE_FILE);
    page.all('#tableWrap tbody [data-act="row"]')[0].press();
    await press("Page");
    expect([tabCreates.length, tabUpdates]).toEqual([1, [[101, { url: `${ORIGIN}/a/apps/app/${APP}/boards/${BOARD}`, active: true }]]]);
    // A tab ID kept for this page that the browser does not say it opened, as after a restart: it is sent nowhere.
    session.held.set("cardigan-app-tab", "7");
    await refresh();
    table(WITH_PAGES, MODULE_USAGE_FILE);
    page.all('#tableWrap tbody [data-act="row"]')[0].press();
    await press("App");
    expect([tabCreates.length, tabUpdates.length, session.held.get("cardigan-app-tab")]).toEqual([2, 1, "102"]);
  });

  it("has no buttons for an app's rows, which have no module to open", async () => {
    await openWith(RESULT);
    await letKeep();
    goTo(2);
    page.all('#tableWrap tbody [data-act="row"]')[0].press();
    expect([page.id("drawer").classList.contains("show"), opens(), page.id("drawerOpens").hidden, why()]).toEqual([true, [], true, undefined]);
  });
});

describe("The mapping of an import from a file, in its row's details", () => {
  /** A model's Imports as the export writes them: the Imports tab's columns, then the Actions list's. The first import is
   * the user's example, into a list, from a file that is no longer available; the second reads a saved view of another
   * model; the third loads a module from a file. */
  const IMPORTS: ResultTable = { file: "Imports.csv", label: "Imports", guard: false, headers: ["", "Source Label", "Source Object", "Source Type", "Target Object", "Target Type", "Used in Processes"],
    rows: [["Division from HQ Network.csv", "HQ Network.csv", "-", "FILE", "Division", "LIST", "Nightly load"],
      ["Regions from the hub", "Hub / Regions", "Hub / 'LIST - Regions'.Export", "SAVED VIEW", "+ Regions", "LIST", ""],
      ["Prices from prices.csv", "prices.csv", "-", "FILE", "PRI01 Prices", "MODULE", ""]] };
  /** The file of the first import is no longer available: Import Data Sources says so, as Anaplan's own message does. */
  const SOURCES: ResultTable = { file: "Import Data Sources.csv", label: "Import Data Sources", guard: false, headers: ["", "Type", "Used in Imports", "Status"],
    rows: [["HQ Network.csv", "FILE", "Division from HQ Network.csv", "The uploaded file is no longer available; please upload the file again"],
      ["prices.csv", "FILE", "Prices from prices.csv", ""]] };
  /** Each import from a file with its mapping, as the export reads it out of the import's own definition. */
  const MAPPINGS: ImportMapping[] = [
    { id: "112000000001", name: "Division from HQ Network.csv", importType: "HIERARCHY_DATA", targets: [
      { target: "Division", source: "column", column: 1, text: "Division Name" }, { target: "Parent", source: "column", column: 2, text: "Region" },
      { target: "Code", source: "column", column: 4 }, { target: "Manager", source: "column", column: 7, text: "Manager" }, { target: "Active", source: "none" }] },
    { id: "112000000003", name: "Prices from prices.csv", importType: "MODULE_DATA", targets: [
      { target: "Products", source: "column", column: 1, text: "Product" }, { target: "Versions", source: "constant", text: "Actual" },
      { target: "Line Items", source: "headerRow" }, { target: "Price", source: "column", text: "Price" }] }];
  const WITH_MAPPINGS: AnalysisResult = { ...BLUEPRINT, summary: [...BLUEPRINT.summary, "Imports: 3 rows", "Import Data Sources: 2 rows"],
    tables: [...BLUEPRINT.tables, IMPORTS, SOURCES], importMappings: MAPPINGS };
  /** The drawer's sections by their headings, and the Mapping section's rows and lines. */
  const sections = () => page.all("#drawerBody .d-sec").map(section => section.querySelector("h3")?.textContent);
  const mapping = () => [page.all("#drawerMapping tbody tr").map(row => row.children.map(cell => cell.textContent)), page.texts("#drawerMapping p")];
  const openImport = (name: string) => {
    page.all('#tableWrap tbody [data-act="row"]')[firstCells().indexOf(name)].press();
  };

  beforeEach(() => {
    // The models of these tests name their files and say FILE of them: the page shows that as it was read.
    theirs = /\bFILE\b|HQ Network\.csv|prices\.csv|The uploaded file is no longer available; please upload the file again/g;
  });

  it("ends the details of an import from a file with its mapping, below All columns: each target with what feeds it, then the columns it does not use", async () => {
    await openWith(WITH_MAPPINGS);
    goTo(3);
    openImport("Division from HQ Network.csv");
    expect([page.id("drawerTitle").textContent, sections()]).toEqual(["Division from HQ Network.csv", ["All columns", "Mapping"]]);
    // The import's file is no longer available, and its mapping is shown all the same: the mapping is the import's own.
    expect(mapping()).toEqual([[["Division", "Column 1: Division Name"], ["Parent", "Column 2: Region"], ["Code", "Column 4"], ["Manager", "Column 7: Manager"], ["Active", "Not mapped"]],
      ["Columns 3, 5 and 6 are not used.", "Whether there are columns after column 7 is not known: Anaplan keeps the import's mapping, not the header row it was made from."]]);
    expect(page.texts("#drawerMapping th")).toEqual(["Target", "Source"]);
    page.key("Escape");
    // An import into a module: a constant, the line items from the header row, a line item by its column's heading alone.
    openImport("Prices from prices.csv");
    expect(mapping()).toEqual([[["Products", "Column 1: Product"], ["Versions", "Constant: Actual"], ["Line Items", "Header row: each line item from the column it heads"],
      ["Price", "Column headed Price"]], ["Column 1 is used.",
      "Whether there are columns after column 1 is not known: Anaplan keeps the import's mapping, not the header row it was made from."]]);
    page.key("Escape");
    // An import from another model has no mapping: its details are All columns alone.
    openImport("Regions from the hub");
    expect(sections()).toEqual(["All columns"]);
    page.key("Escape");
    // Nor has a row of another table, though it names an import from a file.
    goTo(4);
    page.all('#tableWrap tbody [data-act="row"]')[0].press();
    expect(sections()).toEqual(["All columns"]);
  });

  it("shows no mapping for a result an earlier version kept, which has none", async () => {
    const { importMappings: _mappings, ...earlier } = WITH_MAPPINGS;
    await openWith(earlier);
    goTo(3);
    openImport("Division from HQ Network.csv");
    expect(sections()).toEqual(["All columns"]);
  });

  it("keeps the mappings with a result kept for a refresh, which brings them back with it", async () => {
    await openWith(WITH_MAPPINGS);
    await letKeep();
    await open("?tab=42");
    await eventually(() => page.document.title === `Cardigan - ${WITH_MAPPINGS.name}`, "the result to come back");
    goTo(3);
    openImport("Prices from prices.csv");
    expect([sections(), mapping()[0][0]]).toEqual([["All columns", "Mapping"], ["Products", "Column 1: Product"]]);
  });

  it("says why there is no mapping to show: one that could not be read, or an import of another kind", async () => {
    const NOT_READ = "Cardigan could not read this import's mapping: the model did not give the imports' definitions. The diagnostic log says why.";
    await openWith({ ...WITH_MAPPINGS, importMappings: [{ ...MAPPINGS[0], importType: "", targets: [], note: NOT_READ }, { ...MAPPINGS[1], importType: "USERS", targets: [] }] });
    goTo(3);
    openImport("Division from HQ Network.csv");
    expect([sections(), mapping()]).toEqual([["All columns", "Mapping"], [[], [NOT_READ]]]);
    expect(page.has("#drawerMapping table")).toBe(false);
    page.key("Escape");
    openImport("Prices from prices.csv");
    expect(mapping()).toEqual([[], ["This import loads users. Cardigan lists the mapping of an import into a module or a list."]]);
  });

  it("says that it has none for an import the result's mappings do not hold, and to run again", async () => {
    await openWith({ ...WITH_MAPPINGS, importMappings: [MAPPINGS[1]] });
    goTo(3);
    openImport("Division from HQ Network.csv");
    expect(mapping()).toEqual([[], ["Cardigan has no mapping for this import: choose Run again to read it."]]);
  });

  it("writes every name, heading and value of a mapping as text", async () => {
    await openWith({ ...WITH_MAPPINGS, importMappings: [{ ...MAPPINGS[0], targets: [{ target: `Division ${TAG}`, source: "column", column: 1, text: `Name ${TAG}` },
      { target: "Parent", source: "constant", text: TAG }, { target: "Code", source: "other", text: TAG }] }] });
    goTo(3);
    openImport("Division from HQ Network.csv");
    expect([strayImg(), mapping()[0]]).toEqual([false, [[`Division ${TAG}`, `Column 1: Name ${TAG}`], ["Parent", `Constant: ${TAG}`], ["Code", `A source Cardigan does not know (${TAG})`]]]);
  });
});

describe("The actions of a process, in its row's details", () => {
  const USED = "Used in Processes";
  /** A model's Processes, then three tables of the actions they run, each with its Used in Processes, as the export writes
   * them: the Actions list split at its headings, the imports merged into the Imports tab. */
  const PROCESSES: ResultTable = { file: "Processes.csv", label: "Processes", guard: false, headers: ["", "Notes", USED, "Used in Dashboards"],
    rows: [["Nightly load", "Runs at 2am", "", "Admin"], ["Weekly load", "", "", ""], ["Empty", "", "", ""]] };
  const IMPORTS: ResultTable = { file: "Imports.csv", label: "Imports", guard: false, headers: ["", "Source Label", "Source Type", "Target Object", USED],
    rows: [["Prices from the hub", "Hub / Prices", "SAVED VIEW", "Prices", "Nightly load"], ["1.1 Load regions", "Hub / Regions", "SAVED VIEW", "Regions", "Nightly load, Weekly load"]] };
  const EXPORTS: ResultTable = { file: "Exports.csv", label: "Exports", guard: false, headers: ["", "Notes", USED], rows: [["Send plan", "", "Weekly load"]] };
  const OTHERS: ResultTable = { file: "Other Actions.csv", label: "Other Actions", guard: false, headers: ["", "Notes", USED], rows: [["Delete old items", "", "Nightly load"]] };
  /** Each process with its actions, in the order it runs them, as the export reads them out of the process's definition.
   * Weekly load runs an action the Actions list does not have, and one of a kind Cardigan does not know. */
  const PROCESS_ACTIONS: ProcessActions[] = [
    { id: "118000000001", name: "Nightly load", actions: [{ id: "112000000002", name: "Prices from the hub", type: "IMPORT" },
      { id: "112000000001", name: "1.1 Load regions", type: "IMPORT" }, { id: "117000000001", name: "Delete old items", type: "ACTION" }] },
    { id: "118000000002", name: "Weekly load", actions: [{ id: "116000000001", name: "Send plan", type: "EXPORT" }, { id: "112000000001", name: "1.1 Load regions", type: "IMPORT" },
      { id: "112000000099", name: "ID 112000000099", type: "IMPORT" }, { id: "117000000002", name: "Optimise", type: "OPTIMIZER" }] },
    { id: "118000000003", name: "Empty", actions: [] }];
  const WITH_PROCESSES: AnalysisResult = { ...BLUEPRINT, summary: [...BLUEPRINT.summary, "Processes: 3 rows", "Imports: 2 rows", "Exports: 1 rows", "Other Actions: 1 rows"],
    tables: [...BLUEPRINT.tables, PROCESSES, IMPORTS, EXPORTS, OTHERS], processActions: PROCESS_ACTIONS };
  /** The drawer's sections by their headings, and the Actions section's headings, rows and lines. */
  const sections = () => page.all("#drawerBody .d-sec").map(section => section.querySelector("h3")?.textContent);
  const steps = () => [page.texts("#drawerSteps th"), page.all("#drawerSteps tbody tr").map(row => row.children.map(cell => cell.textContent)), page.texts("#drawerSteps p")];
  const links = () => page.all('#drawerSteps [data-act="step"]').map(link => link.textContent);
  const openProcess = (name: string) => {
    page.all('#tableWrap tbody [data-act="row"]')[firstCells().indexOf(name)].press();
  };

  it("lists the actions a process runs below All columns, numbered in the order it runs them, each with its kind, and each opens its own row's details", async () => {
    await openWith(WITH_PROCESSES);
    goTo(3);
    openProcess("Nightly load");
    expect([page.id("drawerTitle").textContent, sections()]).toEqual(["Nightly load", ["All columns", "Actions (3)"]]);
    expect(steps()).toEqual([["#", "Action", "Kind"], [["1", "Prices from the hub", "Import"], ["2", "1.1 Load regions", "Import"], ["3", "Delete old items", "Other action"]], []]);
    expect(links()).toEqual(["Prices from the hub", "1.1 Load regions", "Delete old items"]);
    // An action's name opens its row of its own table, as a click on that row does.
    page.all('#drawerSteps [data-act="step"]')[1].press();
    expect([page.id("drawerTitle").textContent, page.id("drawerSub").textContent, sections()]).toEqual(["1.1 Load regions", "Row 2 of Imports", ["All columns"]]);
    page.key("Escape");
    openProcess("Nightly load");
    page.all('#drawerSteps [data-act="step"]')[2].press();
    expect([page.id("drawerTitle").textContent, page.id("drawerSub").textContent]).toEqual(["Delete old items", "Row 1 of Other Actions"]);
  });

  it("names as text an action whose row it cannot open, says a kind it does not know as Anaplan does, and says that a process runs none", async () => {
    await openWith(WITH_PROCESSES);
    goTo(3);
    openProcess("Weekly load");
    expect(steps()).toEqual([["#", "Action", "Kind"], [["1", "Send plan", "Export"], ["2", "1.1 Load regions", "Import"], ["3", "ID 112000000099", "Import"], ["4", "Optimise", "OPTIMIZER"]], []]);
    // The action the Actions list does not have has no row; the other is of a kind no table lists.
    expect(links()).toEqual(["Send plan", "1.1 Load regions"]);
    page.key("Escape");
    openProcess("Empty");
    expect([sections(), steps(), page.has("#drawerSteps table")]).toEqual([["All columns", "Actions (0)"], [[], [], ["This process runs no action."]], false]);
    page.key("Escape");
    // A row of another table has no actions to list, though it names a process.
    goTo(4);
    page.all('#tableWrap tbody [data-act="row"]')[0].press();
    expect(sections()).toEqual(["All columns"]);
  });

  it("lists, where the result has no process's own actions, those whose Used in Processes names it, by kind, and says that the order is not known", async () => {
    const { processActions: _actions, ...earlier } = WITH_PROCESSES;
    await openWith(earlier);
    goTo(3);
    openProcess("Nightly load");
    expect(steps()).toEqual([["Action", "Kind"], [["Prices from the hub", "Import"], ["1.1 Load regions", "Import"], ["Delete old items", "Other action"]],
      [PROCESS_LINES.unordered, PROCESS_LINES.earlier]]);
    expect(links()).toEqual(["Prices from the hub", "1.1 Load regions", "Delete old items"]);
    page.key("Escape");
    // A cell that names several processes names this one among them.
    openProcess("Weekly load");
    expect(steps()[1]).toEqual([["1.1 Load regions", "Import"], ["Send plan", "Export"]]);
    page.key("Escape");
    openProcess("Empty");
    expect(steps()).toEqual([[], [], [PROCESS_LINES.noneUsed, PROCESS_LINES.earlier]]);
  });

  it("says why, where a process's definition could not be read, under the actions whose Used in Processes names it", async () => {
    const NOT_READ = "Cardigan could not read the actions of this process: the model did not give the processes' definitions. The diagnostic log says why.";
    await openWith({ ...WITH_PROCESSES, processActions: PROCESS_ACTIONS.map(process => ({ ...process, actions: [], note: NOT_READ })) });
    goTo(3);
    openProcess("Nightly load");
    expect(steps()).toEqual([["Action", "Kind"], [["Prices from the hub", "Import"], ["1.1 Load regions", "Import"], ["Delete old items", "Other action"]],
      [PROCESS_LINES.unordered, NOT_READ]]);
  });

  it("writes every name and kind of a process's actions as text", async () => {
    await openWith({ ...WITH_PROCESSES, processActions: [{ ...PROCESS_ACTIONS[0], actions: [{ id: "", name: `Load ${TAG}`, type: TAG }] }] });
    goTo(3);
    openProcess("Nightly load");
    expect([strayImg(), steps()[1]]).toEqual([false, [["1", `Load ${TAG}`, TAG]]]);
  });
});
