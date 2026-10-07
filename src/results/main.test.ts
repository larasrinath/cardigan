import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelMapOptions } from "../map/graph-types.js";
import { CALENDAR_HEADERS, CALENDAR_PROPERTIES, calendarRows } from "../model/calendar.js";
import { FRESH_MS, PORT_NAME, RESULTS_PAGE, type TabMessage } from "../protocol.js";
import type { AnalysisResult, Cell } from "../result-types.js";
import { FakeElement, FakeInput, FakePage, FakeSelect, parseMarkup } from "./dom.test-support.js";
import { analysedLine, NOT_KEPT_NOTE, TOO_LARGE_NOTE } from "./keep-notes.js";
import { KEPT_PREFIX, ResultKeeper, type KeptStorage } from "./keep-result.js";
import { FORGOTTEN_LINE, keptCopyHtml, MAP_FAILED, NOT_REMOVED_LINE } from "./markup.js";
import { NARROW_WINDOW, NAVIGATION_KEY } from "./navigation.js";

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
      rows: [["Module", "REP01 Sales", "—", "Overview", 1, "Source module", "102000000001"], ["Module", "REP09 Copy", "—", "Overview (copy)", 1, "Source module", "102000000009"]] },
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
 * them about the model. */
const WITH_CALENDAR: AnalysisResult = {
  ...MODEL, summary: [...MODEL.summary, "Model Calendar: 31 rows"],
  tables: [...MODEL.tables, { file: "Model Calendar.csv", label: "Model Calendar", headers: [...CALENDAR_HEADERS], guard: false,
    rows: calendarRows({ workspace: "Main", model: "Model one", capturedOn: "2026-10-03", values: new Map([[CALENDAR_PROPERTIES["Calendar Type"], "Calendar Months/Quarters/Years"]]) }) }],
};

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
let ports: FakePort[];
let connects: unknown[][];
/** What the script put on the clipboard, and whether the clipboard refuses. */
let copied: string[];
let clipboardRefuses: boolean;
/** What the page keeps between visits, whether the system prefers a dark theme, and who asked to hear when that changes. */
let stored: Map<string, string>;
let systemDark: boolean;
let systemListeners: ((event: { matches: boolean }) => void)[];
/** Whether the window is as narrow as the stylesheet's narrow layout (navigation.ts `NARROW_WINDOW`), in which the
 * navigation slides in over the content, and who asked to hear when the window crosses that width. A test's window is
 * wide unless the test says otherwise. */
let narrowWindow: boolean;
let layoutListeners: ((event: { matches: boolean }) => void)[];
/** What the browser's store answers with, in the place of reading and of keeping, where a browser refuses both. */
let storeRefuses: Error | undefined;
let lastError: { message?: string } | undefined;
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
let mapThrows: Partial<Record<"build" | "mount" | "show" | "hide" | "themeChanged" | "destroy", unknown>>;
/** Whether the stand-in takes the focus into itself, to its button, each time it is shown. */
let mapTakesFocus: boolean;
/** What the stand-in tells the page of its stop while it is asked for one of these, or while it hears a click or a key
 * inside it: the reason it gives. Nothing unless a test sets it. */
let mapTells: Partial<Record<"mount" | "show" | "hide" | "themeChanged" | "destroy" | "click" | "keydown", string>>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  mapAsked = [];
  mapBuilds = [];
  mapMounts = [];
  mapThrows = {};
  mapTakesFocus = false;
  mapTells = {};
  const asked = (what: keyof typeof mapThrows, said: string) => {
    mapAsked.push(said);
    if (what in mapThrows) throw mapThrows[what];
  };
  mapStandIn.build = tables => {
    asked("build", "build");
    const graph = { nodes: [], edges: [], unresolved: [], sections: [], limitations: [] };
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
    };
  };
  ports = [];
  connects = [];
  copied = [];
  clipboardRefuses = false;
  stored = new Map();
  systemDark = false;
  systemListeners = [];
  narrowWindow = false;
  layoutListeners = [];
  storeRefuses = undefined;
  lastError = undefined;
  replaced = [];
  fixedAddress = false;
  vi.stubGlobal("history", { state: null, replaceState: (_state: unknown, _unused: string, address: string) => {
    if (fixedAddress) throw new Error("The address cannot be changed.");
    replaced.push(address);
    location.search = address.includes("?") ? address.slice(address.indexOf("?")) : "";
  } });
  vi.stubGlobal("window", {
    // The two things the page asks of the window's media: whether it is narrow, and whether the system's theme is dark.
    matchMedia: (query: string) => (query === NARROW_WINDOW
      ? { get matches() { return narrowWindow; }, addEventListener: (_type: string, listener: (event: { matches: boolean }) => void) => { layoutListeners.push(listener); } }
      : { get matches() { return systemDark; }, addEventListener: (_type: string, listener: (event: { matches: boolean }) => void) => { systemListeners.push(listener); } }),
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
    tabs: { connect: (...args: unknown[]) => { connects.push(args); const port = new FakePort(); ports.push(port); return port; } },
    runtime: { get lastError() { return lastError; } },
  });
  vi.stubGlobal("navigator", { clipboard: { writeText: async (text: string) => {
    if (clipboardRefuses) throw new Error("Write permission denied.");
    copied.push(text);
  } } });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

/** Loads the page at an address: a new page each time, as opening or reloading it gives. A page that finds no result kept
 * for it has said so to itself by the time this returns. */
const open = async (search: string, shell = SHELL) => {
  vi.resetModules();
  page = new FakePage(shell);
  location = { search, pathname: "/results.html", hash: "" };
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
/** Opens one of the result's tables from the navigation, by its place among the result's files. */
const goTo = (table: number) => page.find(`#navList [data-nav="${table}"]`).press();
/** The rows on screen, by the text of their first cell. */
const firstCells = () => page.all("#tableWrap tbody tr").map(row => row.children[0].textContent.trim());
/** The column headings that offer a filter, by the column's name. */
const filterable = () => page.all("#tableWrap thead th").filter(heading => heading.querySelector("[data-colfilter]")).map(heading => heading.querySelector(".th-sort")?.textContent.trim());
/** The open filter's choices: each one's text, its count, and whether it is ticked. */
const choices = () => page.all("#popover .pop-opt").map(option => [option.children[1].textContent, option.querySelector(".po-cnt")?.childNodes[0].textContent, option.children[0].checked]);
/** The pager's buttons: each one's words, with a mark on the current page and brackets around one that is disabled. */
const pagerButtons = () => page.all("#pager .pg-btn").map(button => {
  const words = button.textContent.trim();
  return button.disabled ? `(${words})` : button.hasAttribute("aria-current") ? `[${words}]` : words;
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
    expect(page.id("sidenav").hidden).toBe(true);

    ports[0].send({ type: "status", text: "Reading page 1 of 1: Overview" });
    ports[0].send({ type: "log", text: "14:02:05 Reading page 1 of 1: Overview" });
    ports[0].send({ type: "log", text: "14:02:06 <b>app</b>: 1 page" });
    expect(page.id("runStatus").textContent).toBe("Reading page 1 of 1: Overview");
    expect(page.id("diagLog").textContent).toBe("14:02:05 Reading page 1 of 1: Overview\n14:02:06 <b>app</b>: 1 page");
    expect(page.id("runLog").hidden).toBe(false);

    sendResult(ports[0]);
    expect(page.document.title).toBe("Cardigan — Demo <img src=x onerror=alert(1)> app");
    // The header says what was analysed, as text: the name's own tag is not one on the page.
    expect(page.texts("#hdMeta .meta-app")).toEqual(["Demo <img src=x onerror=alert(1)> app"]);
    expect(page.has("img")).toBe(false);
    expect(page.find("#hdMeta .meta-sub").textContent).toContain("us1a.app.anaplan.com");
    // The notes are a panel of the overview, one line each: the summary, and the Notes rows of the Details file. The banner
    // area holds none of them.
    expect([page.texts("#view .panel h2"), page.texts("#view .warn-list li")]).toEqual([["Notes", "Cards by type"], ["1 of 1 pages analysed, 2 cards.", "Archive: Not published"]]);
    expect(page.id("banners").children).toEqual([]);
    // One navigation entry per file. The Details file has none: the overview says what it holds. An app has no model map.
    expect(page.all("#navList [data-nav]").map(entry => entry.dataset.nav)).toEqual(["overview", "1", "2"]);
    expect(page.texts("#view h1")).toEqual(["Overview"]);
    expect(page.id("sidenav").hidden).toBe(false);
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
    expect([banner()[2], page.has("img")]).toEqual([`Reading page 1 of 1: ${TAG}`, false]);

    // The earlier result is all still there: its name, its navigation, the table and the row the user was reading.
    const earlier = () => [page.document.title, page.texts("#hdMeta .meta-app"), page.all("#navList [data-nav]").length, page.texts("#view h1"), firstCells().length,
      page.id("drawer").hidden, page.texts("#drawerBody dd")[2]];
    expect(earlier()).toEqual(["Cardigan — Demo <img src=x onerror=alert(1)> app", ["Demo <img src=x onerror=alert(1)> app"], 3, ["Cards"], 2, false, "=Margin"]);
    expect(disabled("runAgain")).toEqual([true]);
    page.id("drawerClose").press();

    // The new result arrives in pieces: until it is complete, nothing of it is shown, and the user reads on.
    page.all('#tableWrap tbody [data-act="row"]')[0].press();
    expect(page.id("drawer").classList.contains("show")).toBe(true);
    const next: AnalysisResult = { ...RESULT, name: "Demo app, second run", zipName: "Second.zip", summary: ["1 of 1 pages analysed, 1 card."],
      tables: [RESULT.tables[0], RESULT.tables[1], { ...RESULT.tables[2], rows: [["Overview", 1, "Only card", "Grid", "card-z"]] }] };
    ports[0].send({ type: "result", result: { ...next, tables: next.tables.map(table => ({ ...table, rows: [] })) } });
    next.tables.forEach((table, index) => ports[0].send({ type: "rows", table: index, rows: table.rows }));
    expect([earlier().slice(0, 5), banner().slice(0, 3)]).toEqual([["Cardigan — Demo <img src=x onerror=alert(1)> app", ["Demo <img src=x onerror=alert(1)> app"], 3, ["Cards"], 2],
      ["note", "Analysing", "Receiving the result…"]]);
    ports[0].send({ type: "done" });
    // Now the page is the new result's: its overview, without the banner, and without the drawer that showed a row of the old one.
    expect([page.document.title, page.texts("#view h1"), page.texts("#navList .cnt"), page.id("banners").children, page.id("drawer").classList.contains("show")])
      .toEqual(["Cardigan — Demo app, second run", ["Overview"], ["1", "1"], [], false]);
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
    expect(banner()).toEqual(["warn", "Not connected", "Cardigan cannot reach that tab.", "If it is an Anaplan app or model, refresh it, then click the Cardigan icon again."]);
    // The result is where it was; Run again can be tried again.
    expect([page.document.title, page.texts("#view h1"), firstCells().length, page.id("sidenav").hidden]).toEqual(["Cardigan — Demo <img src=x onerror=alert(1)> app", ["Cards"], 2, false]);
    expect(disabled("runAgain")).toEqual([false]);
    // The banner's button copies the log of the run that failed, not the one the result carries.
    expect(page.id("bannerCopy").hidden).toBe(false);
    page.id("bannerCopy").press();
    await settle();
    expect(copied).toEqual(["14:02:05 The tab did not answer: Could not establish connection. Receiving end does not exist."]);
    expect(page.id("toast").textContent).toBe("Copied the diagnostic log");
  });

  it("keeps the result when the new run fails or is cut off, even after pieces of a new result have arrived", async () => {
    await openWith();
    const shown = () => [page.document.title, page.texts("#view h1"), page.texts("#navList .cnt")];
    const first = shown();
    // The tab says the run failed.
    page.id("runAgain").press();
    ports[0].send({ type: "log", text: "14:02:09 stopped: GET /apps 503" });
    ports[0].send({ type: "error", message: `Anaplan could not be reached. Check your connection, then choose Run again. ${TAG}` });
    expect(banner().slice(0, 3)).toEqual(["warn", "The analysis stopped", `Anaplan could not be reached. Check your connection, then choose Run again. ${TAG}`]);
    expect([shown(), page.has("img"), disabled("runAgain")]).toEqual([first, false, [false]]);

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
    expect(page.id("drawerTitle").textContent).toBe(`Card 1 — Sales ${TAG}`);
    expect(page.id("drawerTitle").children).toEqual([]);
    expect(page.texts("#drawerSub .link")).toEqual(["Overview"]);
    // A row whose own name holds the tag: the page named so, in the Pages table.
    page.id("drawerClose").press();
    goTo(1);
    page.all('#tableWrap tbody [data-act="row"]')[1].press();
    expect([page.id("drawerTitle").textContent, page.id("drawerTitle").children, page.id("drawerSub").textContent]).toEqual([`Stores ${TAG}`, [], "Row 2 of Pages"]);
    // None of the names became an element, anywhere on the page.
    expect([page.has("img"), page.all("[onerror]")]).toEqual([false, []]);
  });

  it("leaves the search box alone while the user types: only the rows, the count, the pager and Reset are drawn again", async () => {
    await openWith(MODEL);
    goTo(1);
    const box = page.id("tblSearch");
    const kept = [box, page.find(".toolbar"), page.id("tableWrap"), page.id("pager"), page.id("colBtn"), page.find("#view h1")];
    expect([page.id("rowCount").textContent, firstCells().length, page.id("resetBtn").hidden, pagerButtons()]).toEqual(["1–50 of 120 rows", 50, true, ["(‹)", "[1]", "2", "3", "›"]]);

    box.type("item 11");
    // The box is the very element the user is typing into, with what was typed and the focus still in it.
    expect(page.id("tblSearch")).toBe(box);
    expect([box.value, page.document.activeElement === box]).toEqual(["item 11", true]);
    expect(firstCells()).toEqual(["Line item 11", ...Array.from({ length: 10 }, (_, index) => `Line item ${110 + index}`)]);
    expect(page.id("live").textContent).toBe("Line Items: 11 rows");
    expect([page.id("rowCount").textContent, page.id("resetBtn").hidden, pagerButtons()]).toEqual(["1–11 of 11 rows (filtered from 120)", false, ["(‹)", "[1]", "(›)"]]);
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

  it("shows a table from its first page again after a sort, a search or a filter, and after leaving a search behind", async () => {
    await openWith(MODEL);
    goTo(1);
    const current = () => page.texts('#pager .pg-btn[aria-current="true"]')[0];
    const toPage = (number: number) => page.find(`.pg-btn[aria-label="Page ${number}"]`).press();
    // A sort puts other rows on every page: each of its three steps starts at the first page.
    for (const expected of ["Line item 1", "Line item 120", "Line item 1"]) {
      toPage(3);
      expect(current()).toBe("3");
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
    expect([page.texts("#view h1"), page.texts("#crumbs .ctx"), page.id("rowCount").textContent]).toEqual([["Cards"], ["Page: Stores"], "1–50 of 60 rows (filtered from 120)"]);
    page.find('.pg-btn[aria-label="Page 2"]').press();
    expect(page.id("rowCount").textContent).toBe("51–60 of 60 rows (filtered from 120)");
    // Leaving the jump by the navigation, and coming back to all the cards.
    goTo(1);
    goTo(2);
    expect([page.has("#crumbs .ctx"), page.id("rowCount").textContent]).toEqual([false, "1–50 of 120 rows"]);
    // The breadcrumb's cross ends the jump in place, and gives the view the focus.
    goTo(1);
    page.all('#tableWrap tbody [data-act="page"]')[0].press();
    page.find('.pg-btn[aria-label="Page 2"]').press();
    page.find('#crumbs [data-act="clear-context"]').press();
    expect([page.has("#crumbs .ctx"), page.id("rowCount").textContent, page.document.activeElement === page.id("view")]).toEqual([false, "1–50 of 120 rows", true]);
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

    // The pager: Next stays Next while there is a next page; on the last page it is disabled, and the page's own number takes the focus.
    page.find('.pg-btn[aria-label="Next page"]').press();
    expect([focus(), pagerButtons()]).toEqual([["Next page", true], ["‹", "1", "[2]", "3", "›"]]);
    page.document.activeElement.press();
    expect([focus(), pagerButtons()]).toEqual([["Page 3", true], ["‹", "1", "2", "[3]", "(›)"]]);
    // A page's number: that page's button, which is the current one now. Previous: the same, down to the first page.
    page.find('.pg-btn[aria-label="Page 2"]').press();
    expect([focus(), pagerButtons()]).toEqual([["Page 2", true], ["‹", "1", "[2]", "3", "›"]]);
    page.find('.pg-btn[aria-label="Previous page"]').press();
    expect([focus(), pagerButtons()]).toEqual([["Page 1", true], ["(‹)", "[1]", "2", "3", "›"]]);

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
    page.find('.pg-btn[aria-label="Page 3"]').press();
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
      rows: [["Revenue", formula, "beyond the headers", `more ${TAG}`], ["Units", "1"], ["", "—"]] }] };
    await openWith(odd);
    goTo(1);
    // The table keeps to its headers; the row's drawer has every cell the row holds.
    expect([page.all("#tableWrap thead th").length, page.all("#tableWrap tbody tr").map(row => row.children.length)]).toEqual([2, [2, 2, 2]]);
    page.all('#tableWrap tbody [data-act="row"]')[0].press();
    expect(page.texts("#drawerBody dt")).toEqual(["Name", "Formula", "Column 3", "Column 4"]);
    expect(page.all("#drawerBody dd").map(value => value.textContent)).toEqual(["Revenue", formula, "beyond the headers", `more ${TAG}`]);
    expect(page.all("#drawerBody dd .cell-t").map(value => value.textContent)).toEqual(["Revenue", formula, "beyond the headers", `more ${TAG}`]);
    expect(page.has("img")).toBe(false);
    page.id("drawerClose").press();
    page.all('#tableWrap tbody [data-act="row"]')[1].press();
    expect(page.texts("#drawerBody dt")).toEqual(["Name", "Formula"]);
    page.id("drawerClose").press();
    // A row no cell of which says anything has no name of its own: its drawer is headed by its place in the file.
    page.all('#tableWrap tbody [data-act="row"]')[2].press();
    expect([page.id("drawerTitle").textContent, page.id("drawerSub").textContent]).toEqual(["Row 3", "Row 3 of Line Items"]);
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
    expect(page.texts("#crumbs .ctx")).toEqual(["Page: Overview"]);
  });

  it("heads a row's drawer by the row's own name: the column that names the file's rows, and the first cell that says something where there is none", async () => {
    // The app's files, the Pages and the Action Buttons among them, and a card without a title.
    const app: AnalysisResult = { ...APP, tables: [...APP.tables.map((table, index) => (index === 2 ? { ...table, rows: [...table.rows, ["Overview", 3, "—", "Text", "card-c"], ["Overview", 4, "", "Text", "card-d"]] } : table)),
      { file: "Action Buttons.csv", label: "Action Buttons", headers: ["Page", "Card #", "Button label", "Action type", "Card ID"], guard: true, rows: [["Overview", 1, "Reload plan", "Import", "card-a"]] }] };
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
    // A model's rows are named by their first column, as they were.
    page.id("runAgain").press();
    sendResult(ports[0], MODEL);
    expect([heading(1, 2), heading(2, 1)]).toEqual([["Line item 3", "Row 3 of Line Items"], ["Cost", "Row 2 of Modules"]]);
  });

  it("keeps the keyboard inside the open drawer: what lies behind it is inert until it closes, however it closes", async () => {
    await openWith();
    goTo(2);
    const behind = () => [page.find(".skip"), page.find(".hd"), page.id("banners"), page.find(".shell")].map(part => part.inert);
    const rowButton = () => page.all('#tableWrap tbody [data-act="row"]')[0];
    expect(behind()).toEqual([false, false, false, false]);

    rowButton().press();
    expect(behind()).toEqual([true, true, true, true]);
    // Nothing behind the drawer takes the focus; the drawer's own controls do, and the drawer has it.
    expect([page.id("tblSearch"), page.id("runAgain"), page.find(".skip"), rowButton(), page.id("drawerClose"), page.find("#drawerBody .link")].map(control => control.focusable))
      .toEqual([false, false, false, false, true, true]);
    expect([page.id("drawer").inert, page.document.activeElement === page.id("drawerClose")]).toEqual([false, true]);
    // The message a copied ID gives is not behind the drawer: it is still announced.
    expect([page.id("toast"), page.id("live")].map(part => part.closest("[inert]"))).toEqual([null, null]);

    // Escape: the page takes part again, and the focus is back on the row's button, which can take it again.
    page.key("Escape");
    expect([behind(), page.document.activeElement === rowButton()]).toEqual([[false, false, false, false], true]);
    // The close button, a click beside the drawer, and a jump from the drawer to a page's cards.
    rowButton().press();
    page.id("drawerClose").press();
    expect(behind()).toEqual([false, false, false, false]);
    rowButton().press();
    page.id("scrim").press();
    expect(behind()).toEqual([false, false, false, false]);
    rowButton().press();
    page.find('#drawerBody [data-act="page"]').press();
    expect([behind(), page.texts("#crumbs .ctx")]).toEqual([[false, false, false, false], ["Page: Overview"]]);
    // The jump draws the view anew, so what opened the drawer is gone: the focus is on the view, not left in the drawer.
    expect(page.document.activeElement).toBe(page.id("view"));
    vi.advanceTimersByTime(210);
    expect([page.id("drawer").hidden, page.document.activeElement === page.id("view")]).toEqual([true, true]);
    // A card's drawer is the same drawer.
    page.find('#tableWrap tbody [data-act="card"]').press();
    expect(behind()).toEqual([true, true, true, true]);
    // A new result that takes the page while the drawer is open closes it, and the page takes part again.
    page.id("drawerClose").press();
    page.id("runAgain").press();
    page.find('#tableWrap tbody [data-act="card"]').press();
    expect(behind()).toEqual([true, true, true, true]);
    sendResult(ports[0]);
    expect([behind(), page.id("drawer").classList.contains("show"), page.texts("#view h1")]).toEqual([[false, false, false, false], false, ["Overview"]]);
  });

  it("goes down the page's headings one level at a time, in every view and in the drawer", async () => {
    await openWith();
    /** The levels of the headings inside a part of the page, in the order they stand. */
    const levels = (part: string) => page.all(`${part} h1, ${part} h2, ${part} h3, ${part} h4, ${part} h5, ${part} h6`).map(heading => Number(heading.localName[1]));
    // The overview: the view's heading, then its panels and sections one level under it, the one that starts closed too.
    expect([levels("#main"), page.texts("#main h2")]).toEqual([[1, 2, 2, 2, 2], ["About this export", "Notes", "Cards by type", "Diagnostics"]]);
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
    expect(page.all("#view .stat").map(tile => tile.children.map(child => child.textContent))).toEqual([["Model Calendar", "26", "rows", "31 rows in all"], ["Modules", "2", "rows"], ["Line Items", "120", "rows"]]);
    expect([page.texts("#ovAbout h2"), page.texts("#ovAbout dt"), page.texts("#ovAbout dd")])
      .toEqual([["About this export"], ["Model", "Anaplan host", "Workspace", "Captured on"], ["Model one", "us1a.app.anaplan.com", "Main", "2026-10-03"]]);
    // The navigation counts the same rows.
    expect(page.all("#navList .nav-item").filter(item => item.querySelector(".cnt")).map(item => item.children.map(child => child.textContent)))
      .toEqual([["Model Calendar", "26"], ["Modules", "2"], ["Line Items", "120"]]);

    // The table: the calendar's settings, none of the rows about the model, and a line that says where those are.
    goTo(3);
    const settings = () => page.all("#tableWrap tbody tr").map(row => row.children[1].textContent.trim());
    expect([page.texts("#view .view-note"), page.id("rowCount").textContent, page.id("live").textContent])
      .toEqual([["5 rows about the model are not listed here: 3 hold a value, which the Overview has under About this export."], "1–26 of 26 rows", "Model Calendar: 26 rows"]);
    expect([firstCells().every(section => section === "Model Calendar"), settings().slice(0, 2), settings().filter(setting => ["Workspace", "Model", "Captured on"].includes(setting))])
      .toEqual([true, ["Calendar Type", "Fiscal Year Starts"], []]);
    // The search reads the rows listed and no others: the calendar's type finds its row, the model's name finds none.
    const note = page.find("#view .view-note");
    page.id("tblSearch").type("quarters");
    expect([settings(), page.id("rowCount").textContent]).toEqual([["Calendar Type"], "1–1 of 1 row (filtered from 26)"]);
    page.id("tblSearch").type("Model one");
    expect([settings(), page.id("rowCount").textContent]).toEqual([[], "No rows (filtered from 26)"]);
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
    // The tile and the navigation count the rows the table lists, none, and the tile says the five there are in all.
    expect(page.all("#view .stat")[0].children.map(child => child.textContent)).toEqual(["Model Calendar", "0", "rows", "5 rows in all"]);
    expect(page.find('#navList [data-nav="3"]').children.map(child => child.textContent)).toEqual(["Model Calendar", "0"]);
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
    expect(page.texts("#navList .nav-item span").filter(text => !/^\d+$/.test(text)).slice(1, 3)).toEqual(["Modules", "Line Items"]);
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
    expect([page.id("runStatus").textContent, page.id("runHint").textContent]).toEqual(
      ["Cardigan cannot reach that tab.", "If it is an Anaplan app or model, refresh it, then click the Cardigan icon again."]);
    expect(page.id("diagLog").textContent).toBe("14:02:05 The tab did not answer: Could not establish connection. Receiving end does not exist.");
    expect(page.id("runAgain").disabled).toBe(false);
    page.id("runAgain").press();
    expect(connects).toEqual([[7, { name: PORT_NAME }], [7, { name: PORT_NAME }]]);
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

describe("What a click, a key and typing do on the results page", () => {
  const drawerShown = () => page.id("drawer").classList.contains("show");
  /** What the view, the navigation and the breadcrumb each say is shown. */
  const shows = () => [page.texts("#view h1")[0], page.texts('#navList [aria-current="page"] span')[0], page.texts("#crumbs strong")[0]];
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
    expect(shows()).toEqual(["Overview", "Overview", "Overview"]);
    expect([page.all("#navList .nav-item").map(item => item.children[0].textContent), page.has('#navList [data-nav="map"]'), page.texts("#view .s-lab")])
      .toEqual([["Overview", "Pages", "Cards", "Grid Sections", "Where Used"], false, ["Pages", "Cards", "Grid sections", "Where Used"]]);
    for (const [table, label, rows] of [[1, "Pages", 2], [2, "Cards", 4], [3, "Grid Sections", 3], [4, "Where Used", 2]] as const) {
      goTo(table);
      expect([shows(), firstCells().length]).toEqual([[label, label, label], rows]);
    }
    // The breadcrumb's Overview goes back to the overview.
    page.find('#crumbs [data-nav="overview"]').press();
    expect(shows()).toEqual(["Overview", "Overview", "Overview"]);
    // There is no Details view. A link that still names it, as the navigation's entry did, leads to the overview, which
    // holds what that view held; so does any name that is not a file's place.
    goTo(2);
    page.id("banners").innerHTML = '<button type="button" data-nav="details">Details</button><button type="button" data-nav="nowhere">Nowhere</button>';
    page.find('#banners [data-nav="details"]').press();
    expect([shows(), page.has("#tableWrap"), page.texts("#view h2").slice(0, 1), page.document.activeElement === page.id("view")]).toEqual([["Overview", "Overview", "Overview"], false, ["About this export"], true]);
    goTo(2);
    page.find('#banners [data-nav="nowhere"]').press();
    expect(shows()).toEqual(["Overview", "Overview", "Overview"]);
  });

  it("shows a model's Line Items table as line items only, each with its module and the dimensions it has; the counts are the table's", async () => {
    await openWith(BLUEPRINT);
    // The overview's tile and the navigation count the line items, not the file's rows, three of which are modules' own:
    // the tile says how many rows there are in all under that.
    expect(page.all("#view .stat").map(tile => tile.children.map(child => child.textContent))).toEqual([["Modules", "3", "rows"], ["Line Items", "5", "rows", "8 rows in all"]]);
    expect(page.all("#navList .nav-item").filter(item => item.querySelector(".cnt")).map(item => item.children.map(child => child.textContent))).toEqual([["Modules", "3"], ["Line Items", "5"]]);

    goTo(1);
    // The module stands directly after the name, and after Applies To where it came from; the other columns are in the file's order.
    expect(headings()).toEqual(["Name", "Module Name", "Format", "Formula", "Summary", "Applies To", "Applies To from", "Ratio Numerator", "Ratio Denominator"]);
    expect([column("Name"), column("Module Name")]).toEqual([["Units", "Price", "Revenue", "Margin %", "Cost"], ["REV01 Revenue", "REV01 Revenue", "REV01 Revenue", "REV01 Revenue", "COST01 Costs"]]);
    // A dash in the file is the module's Applies To here; a line item's own stays its own.
    expect([column("Applies To"), column("Applies To from")]).toEqual([["Products, Time", "Products", "Products, Time", "Products, Time", "Cost Centres"], ["Module", "Line item", "Module", "Module", "Module"]]);
    // The line under the table's name says what is not listed, and where the module without line items is.
    expect([page.texts("#view .view-note"), page.id("rowCount").textContent, page.id("live").textContent]).toEqual([
      ["3 module rows are not listed here; each line item shows its module. 1 module has no line items, so it is not in this table. It is listed in the Modules table."],
      "1–5 of 5 rows", "Line Items: 5 rows"]);

    // The search, the filters and the sort are the table's: a module's name finds its line items, and a module's own row is not there to find.
    page.id("tblSearch").type("cost01");
    expect([column("Name"), page.id("rowCount").textContent]).toEqual([["Cost"], "1–1 of 1 row (filtered from 5)"]);
    page.id("tblSearch").type("archive");
    expect(page.id("rowCount").textContent).toBe("No rows (filtered from 5)");
    page.id("tblSearch").type("");
    expect(filterable()).toEqual(expect.arrayContaining(["Module Name", "Applies To from"]));
    page.find('[data-colfilter="6"]').press();
    expect(choices()).toEqual([["Line item", "1", true], ["Module", "4", true]]);
    page.all("#popover input")[1].tick();
    expect(column("Name")).toEqual(["Price"]);
    page.key("Escape");
    page.id("resetBtn").press();
    page.find('[data-sort="1"]').press();
    expect(column("Name")).toEqual(["Cost", "Units", "Price", "Revenue", "Margin %"]);
    // A row's drawer is headed by the line item and says its place among the line items; it holds the view's columns.
    page.all('#tableWrap tbody [data-act="row"]')[0].press();
    expect([page.id("drawerTitle").textContent, page.id("drawerSub").textContent, page.texts("#drawerBody dt").slice(0, 2), page.texts("#drawerBody dd").slice(0, 2)])
      .toEqual(["Cost", "Row 5 of Line Items", ["Name", "Module Name"], ["Cost", "COST01 Costs"]]);
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
    expect(page.all("#navList .nav-item").filter(item => item.querySelector(".cnt")).map(item => item.children.map(child => child.textContent))).toEqual([["Line Items", "8"], ["Modules", "3"]]);
    goTo(1);
    expect([headings(), column("Name").slice(0, 2), column("Applies To").slice(0, 2), page.all("#view .view-note").length, page.id("rowCount").textContent])
      .toEqual([["Name", "Format", "Formula", "Summary", "Applies To", "Module Name", "Ratio Numerator", "Ratio Denominator"], ["REV01 Revenue", "Units"], ["Products, Time", "-"], 0, "1–8 of 8 rows"]);
  });

  it("shows a model's Dynamic Cell Access right after its Line Items, as the file stands, under a line that says what it lists and how many drivers could not be matched", async () => {
    await openWith(WITH_ACCESS);
    const file = WITH_ACCESS.tables[2];
    // The navigation has it after Line Items, where Anaplan's own order has no such entry, and the overview has its tile
    // there too. Both count the file's rows: the table lists every one.
    expect(page.all("#navList .nav-item").map(item => item.children.map(child => child.textContent))).toEqual([["Overview"], ["Modules", "3"], ["Line Items", "5"], ["Dynamic Cell Access", "5"], ["Model map"]]);
    expect(page.all("#view .stat").map(tile => tile.children.map(child => child.textContent))).toEqual([["Modules", "3", "rows"], ["Line Items", "5", "rows", "8 rows in all"], ["Dynamic Cell Access", "5", "rows"]]);

    goTo(2);
    expect(shows()).toEqual(["Dynamic Cell Access", "Dynamic Cell Access", "Dynamic Cell Access"]);
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
    expect(page.all("#tableWrap tbody tr").map(row => row.children.map(cell => cell.querySelectorAll('[data-act="row"]').length))[0]).toEqual([1, 0, 0, 0, 0, 0, 0, 0, 0]);

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
    expect([column("Format"), column("Summary")]).toEqual([["Number", "Number", "Number", "Number, 2 decimal places, %", "Number"],
      ["Sum", "None", "Sum", "Ratio = Margin / Revenue", "Sum, Time: Closing Balance"]]);
    // The search reads the words, not the text that was read in their place: a word is found where it is seen.
    page.id("tblSearch").type("closing balance");
    expect([column("Name"), page.id("rowCount").textContent]).toEqual([["Cost"], "1–1 of 1 row (filtered from 5)"]);
    // A common word finds the rows that show it and no others. Every Summary's definition holds "summaryMethod", so the
    // text that was read has "sum" in it in all five rows; three of them show the word.
    page.id("tblSearch").type("sum");
    expect([column("Name"), column("Summary"), page.id("rowCount").textContent])
      .toEqual([["Units", "Revenue", "Cost"], ["Sum", "Sum", "Sum, Time: Closing Balance"], "1–3 of 3 rows (filtered from 5)"]);
    // What only the text that was read holds finds nothing: a definition's keys, its values as the export writes them, its true and false.
    for (const word of ["summaryMethod", "CLOSING_BALANCE", "percentage", "decimalPlaces", "false"]) {
      page.id("tblSearch").type(word);
      expect(page.id("rowCount").textContent, word).toBe("No rows (filtered from 5)");
    }
    page.id("tblSearch").type("");
    // The Summary column's filter lists the words, each with its rows.
    page.find('[data-colfilter="4"]').press();
    expect(choices()).toEqual([["None", "1", true], ["Ratio = Margin / Revenue", "1", true], ["Sum", "2", true], ["Sum, Time: Closing Balance", "1", true]]);
    page.all("#popover input")[2].tick();
    expect([column("Name"), page.id("rowCount").textContent]).toEqual([["Price", "Margin %", "Cost"], "1–3 of 3 rows (filtered from 5)"]);
    page.key("Escape");
    page.id("resetBtn").press();
    // The sort is by the words: descending by Format, the one format that says more comes first.
    page.find('[data-sort="2"]').press();
    page.find('[data-sort="2"]').press();
    expect([column("Name")[0], column("Format")[0]]).toEqual(["Margin %", "Number, 2 decimal places, %"]);

    // The row's drawer: the words beside each column's name, and after them the text that was read, named as that.
    page.all('#tableWrap tbody [data-act="row"]')[0].press();
    expect([page.id("drawerTitle").textContent, page.id("drawerSub").textContent]).toEqual(["Margin %", "Row 4 of Line Items"]);
    expect(page.texts("#drawerBody dt")).toEqual(["Name", "Module Name", "Format", "Format as read", "Formula", "Summary", "Summary as read", "Applies To", "Applies To from",
      "Ratio Numerator", "Ratio Denominator"]);
    expect(page.all("#drawerBody dd").map(value => value.textContent)).toEqual(["Margin %", "REV01 Revenue", "Number, 2 decimal places, %", PERCENT, "Margin / Revenue", "Ratio = Margin / Revenue", RATIO,
      "Products, Time", "Module", "Margin", "Revenue"]);
    page.key("Escape");
    // Another row has its own: the drawer is the row's, after a sort as well.
    page.all('#tableWrap tbody [data-act="row"]')[4].press();
    expect([page.id("drawerTitle").textContent, page.texts("#drawerBody dd").slice(2, 4), page.texts("#drawerBody dd").slice(5, 7)]).toEqual(["Cost", ["Number", NUMBER], ["Sum, Time: Closing Balance", CLOSING]]);
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

  it("lists a model's files in the order of Anaplan's Model settings, whatever order the result has them in, and the model map last", async () => {
    /** A model's result with these files after its Details file, in this order; each has as many rows as its place in the result. */
    const model = (...files: string[]): AnalysisResult => ({ ...MODEL, summary: [], tables: [MODEL.tables[0], ...files.map((file, index) =>
      ({ file: `${file}.csv`, label: file, headers: ["", "Value"], rows: Array.from({ length: index + 1 }, (_, row): Cell[] => [`${file} ${row + 1}`, "x"]), guard: false }))] });
    /** The navigation's entries, by their words, and the overview's tiles. */
    const entries = () => page.all("#navList .nav-item").map(item => item.children[0].textContent);
    const tiles = () => page.texts("#view .s-lab");
    // The order the export writes its files in (model/export.ts), and the order the page lists them in. Dynamic Cell
    // Access, which the export makes from Line Items, comes right after it in both.
    const written = ["Line Items", "Dynamic Cell Access", "Modules", "General Lists", "Processes", "Imports", "Import Data Sources", "Exports", "Other Actions", "Time Ranges", "Versions", "Source Models",
      "Model Calendar"];
    const ordered = ["Model Calendar", "Time Ranges", "Versions", "General Lists", "Modules", "Line Items", "Dynamic Cell Access", "Processes", "Imports", "Import Data Sources", "Exports", "Other Actions",
      "Source Models"];
    await openWith(model(...written));
    expect([entries(), tiles()]).toEqual([["Overview", ...ordered, "Model map"], ordered]);
    // Each entry still opens its own file: its name in the navigation is the file's place in the result, and its count the file's.
    expect(page.all("#navList .nav-item").slice(1, 4).map(item => [item.dataset.nav, item.children[1].textContent])).toEqual([["13", "13"], ["10", "10"], ["11", "11"]]);
    goTo(10);
    expect([shows(), page.id("rowCount").textContent, firstCells()[0]]).toEqual([["Time Ranges", "Time Ranges", "Time Ranges"], "1–10 of 10 rows", "Time Ranges 1"]);
    // The model map is the last entry, named as its own view and not as a file: it has no place in the result, and no count.
    const map = page.all("#navList .nav-item")[14];
    expect([map.dataset.nav, map.children.map(child => child.textContent)]).toEqual(["map", ["Model map"]]);
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

  it("opens the card a link stands for: the one on that row's page, with its parts", async () => {
    await openWith(APP);
    goTo(2);
    /** The card in the drawer: its heading, its page, its sections, and the grid sections listed for it. */
    const card = () => [page.id("drawerTitle").textContent, page.texts("#drawerSub .link")[0], page.texts("#drawerBody h3"), page.texts("#drawerBody .mini td").slice(0, 3)];
    // In the Cards table a card's title opens it: one link a row. The second page is a copy of the first and kept its
    // cards' IDs: a card is the one of its own page.
    expect(cardLinks().map(link => link.textContent)).toEqual(["Sales", "Margin", "Sales, copied", "Margin, copied"]);
    cardLinks()[2].press();
    expect(card()).toEqual(["Card 1 — Sales, copied", "Overview (copy)", ["Card details", "Grid sections (1)"], ["1", "Own rows and columns", "REP09 Copy"]]);
    expect(page.texts("#drawerBody .d-dl dd")).toEqual(["Overview (copy)", "1", "Sales, copied", "Grid", "card-a"]);
    page.key("Escape");
    cardLinks()[0].press();
    expect(card()).toEqual(["Card 1 — Sales", "Overview", ["Card details", "Grid sections (1)"], ["1", "Own rows and columns", "REP01 Sales"]]);
    page.key("Escape");
    // A card without grid sections says so.
    cardLinks()[1].press();
    expect([card().slice(0, 3), page.texts("#drawerBody p")]).toEqual([["Card 2 — Margin", "Overview", ["Card details", "Grid sections (0)"]], ["No grid sections on this card."]]);
    page.key("Escape");
    // The card's number, once its column is shown, is a link as much as the title.
    toggleColumn("Card #");
    expect(cardLinks().slice(0, 2).map(link => link.textContent)).toEqual(["1", "Sales"]);
    cardLinks()[0].press();
    expect(card().slice(0, 2)).toEqual(["Card 1 — Sales", "Overview"]);
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
    expect(card()).toEqual(["Card 1 — Sales, copied", "Overview (copy)", ["Card details", "Grid sections (1)"], ["1", "Own rows and columns", "REP09 Copy"]]);
    // Inside the card's drawer, a card's link opens that card too: here the same one again, by its title.
    page.all('#drawerBody [data-act="card"]')[1].press();
    expect(card().slice(0, 2)).toEqual(["Card 1 — Sales, copied", "Overview (copy)"]);
    // The drawer then closes back to what opened it from the table, not to a link inside it, which is gone.
    page.key("Escape");
    expect(page.document.activeElement).toBe(rowButton());
    // With the column shown, the number opens the card from the table as well.
    toggleColumn("Card #");
    cardLinks()[1].press();
    expect(card().slice(0, 2)).toEqual(["Card 1 — Sales, copied", "Overview (copy)"]);
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
        rows: [["Overview", 1, "Sales", "Grid", "—", "card-a"], ["Overview", 2, "Margin", "KPI", "—", "card-b"], ["Overview", 3, "Stock", "Grid", "—", "card-s"],
          ["Overview", 1, "Sales, copied", "Grid", "1 rule", "card-a"], ["Overview", 3, "Costs", "Grid", "—", "card-c"], ["Overview", 4, "Margin, moved", "KPI", "—", "card-b"]] },
      { file: "Grid Sections.csv", label: "Grid Sections", headers: ["Page", "Card #", "Section #", "Section layout", "Source module", "Card ID"], guard: true,
        rows: [["Overview", 1, 1, "Own rows and columns", "REP01 Sales", "card-a"], ["Overview", 3, 1, "Own rows and columns", "REP04 Stock", "card-s"],
          ["Overview", 1, 1, "Own rows and columns", "REP09 Sales copy", "card-a"], ["Overview", 3, 1, "Own rows and columns", "REP05 Costs", "card-c"]] },
      { file: "Conditional Formatting.csv", label: "Conditional Formatting", headers: ["Page", "Card #", "Section #", "Format style", "Formatted line item", "Card ID"], guard: true,
        rows: [["Overview", 1, 1, "Colour scale", "Sales", "card-a"], ["Overview", 4, "—", "KPI indicator", "KPI value", "card-b"]] },
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
    expect(card()).toEqual({ title: "Card 1 — Sales, copied", cells: ["Overview", "1", "Sales, copied", "Grid", "1 rule", "card-a"], sections: ["Card details"], rows: [], note: [NOTE] });
    // Its grid sections and its formatting rules are in the other files under the same name, number and ID as the first
    // page's: neither card's are listed as this one's (two grid sections for a card that has one), and the line says why.
    // The line's page still leads to the cards under that name.
    expect(page.all("#drawerSub [data-act]").map(control => [control.dataset.act, control.textContent])).toEqual([["page", "Overview"]]);
    page.key("Escape");
    cardLinks()[0].press();
    expect(card()).toEqual({ title: "Card 1 — Sales", cells: ["Overview", "1", "Sales", "Grid", "—", "card-a"], sections: ["Card details"], rows: [], note: [NOTE] });
    // Inside the drawer the card's own links open the same card again, not its twin.
    page.all('#drawerBody [data-act="card"]')[1].press();
    expect(card().title).toBe("Card 1 — Sales");
    page.key("Escape");
    // Margin kept its ID on the copy and stands in another place there: the number tells the two apart, so each has its
    // own rows, and nothing is left out.
    cardLinks()[1].press();
    expect(card()).toMatchObject({ title: "Card 2 — Margin", sections: ["Card details", "Grid sections (0)", "Conditional formatting (0)"], rows: [], note: [] });
    page.key("Escape");
    cardLinks()[5].press();
    expect(card()).toMatchObject({ title: "Card 4 — Margin, moved", sections: ["Card details", "Grid sections (0)", "Conditional formatting (1)"],
      rows: [["—", "KPI indicator", "KPI value", "", ""]], note: [] });
    page.key("Escape");
    // Under the number 3 each page has a card of its own, with its own ID: each has its own grid section.
    cardLinks()[2].press();
    expect(card()).toMatchObject({ title: "Card 3 — Stock", sections: ["Card details", "Grid sections (1)", "Conditional formatting (0)"], rows: [["1", "Own rows and columns", "REP04 Stock", "", "", "", ""]], note: [] });
    page.key("Escape");
    cardLinks()[4].press();
    expect(card()).toMatchObject({ title: "Card 3 — Costs", rows: [["1", "Own rows and columns", "REP05 Costs", "", "", "", ""]], note: [] });
    page.key("Escape");

    // In another table a card's number opens the card where the row names one card. The two rows of Sales could each be
    // either card's: their number is plain text, in the table and in the row's drawer.
    goTo(3);
    toggleColumn("Card #");
    expect([column("Card #"), page.all("#tableWrap tbody tr").map(row => row.querySelectorAll('[data-act="card"]').length)]).toEqual([["1", "3", "1", "3"], [0, 1, 0, 1]]);
    cardLinks()[1].press();
    expect(card().title).toBe("Card 3 — Costs");
    page.key("Escape");
    cardLinks()[0].press();
    expect(card().title).toBe("Card 3 — Stock");
    page.key("Escape");
    page.all('#tableWrap tbody [data-act="row"]')[2].press();
    expect([page.id("drawerSub").textContent, page.texts("#drawerBody dd").slice(0, 2), page.all('#drawerBody [data-act="card"]').length]).toEqual(["Row 3 of Grid Sections", ["Overview", "1"], 0]);
    page.key("Escape");
    // A row of the moved card names it by its number among the two that have its ID.
    goTo(4);
    toggleColumn("Card #");
    expect([column("Card #"), page.all("#tableWrap tbody tr").map(row => row.querySelectorAll('[data-act="card"]').length)]).toEqual([["1", "4"], [0, 1]]);
    cardLinks()[0].press();
    expect(card().title).toBe("Card 4 — Margin, moved");
  });

  it("shows a page's cards on a click on the page's name, wherever the Page column stands, and from the drawer", async () => {
    await openWith(APP);
    const jumped = () => [shows(), page.texts("#crumbs .ctx"), column("Card title"), page.id("rowCount").textContent];
    const copies = [["Cards", "Cards", "Cards"], ["Page: Overview (copy)"], ["Sales, copied", "Margin, copied"], "1–2 of 2 rows (filtered from 4)"];
    // Where Used: the page is its fourth column.
    goTo(4);
    page.all('#tableWrap tbody [data-act="page"]')[1].press();
    expect(jumped()).toEqual(copies);
    // Pages: its second.
    goTo(1);
    page.all('#tableWrap tbody [data-act="page"]')[0].press();
    expect(jumped().slice(1, 3)).toEqual([["Page: Overview"], ["Sales", "Margin"]]);
    // In the Cards table itself the page's name narrows the table to that page.
    page.find('#crumbs [data-act="clear-context"]').press();
    page.all('#tableWrap tbody [data-act="page"]')[3].press();
    expect(jumped()).toEqual(copies);
    // From a card's drawer: the page under its heading, and the page among its details.
    page.find('#crumbs [data-act="clear-context"]').press();
    cardLinks()[0].press();
    page.find('#drawerSub [data-act="page"]').press();
    expect([jumped().slice(1, 3), drawerShown()]).toEqual([[["Page: Overview"], ["Sales", "Margin"]], false]);
    // The jump is a view of the Cards table: a search narrows it further, and the navigation's Cards shows them all again.
    page.id("tblSearch").type("sales");
    expect(column("Card title")).toEqual(["Sales"]);
    goTo(2);
    expect([page.has("#crumbs .ctx"), column("Card title").length, page.id("tblSearch").value]).toEqual([false, 4, ""]);
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
    const inForce = () => [column("Card title"), page.has("#crumbs .ctx"), page.id("tblSearch").value, page.all(".th-filter.active").length,
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
    expect(range()).toEqual(["Line item 1", "Line item 50", "1–50 of 120 rows", "(‹) [1] 2 3 ›"]);
    page.find('.pg-btn[aria-label="Next page"]').press();
    expect(range()).toEqual(["Line item 51", "Line item 100", "51–100 of 120 rows", "‹ 1 [2] 3 ›"]);
    page.find('.pg-btn[aria-label="Page 3"]').press();
    expect(range()).toEqual(["Line item 101", "Line item 120", "101–120 of 120 rows", "‹ 1 2 [3] (›)"]);
    // A button that is off does nothing.
    page.find('.pg-btn[aria-label="Next page"]').press();
    expect(range()[2]).toBe("101–120 of 120 rows");
    page.find('.pg-btn[aria-label="Previous page"]').press();
    expect(range().slice(0, 3)).toEqual(["Line item 51", "Line item 100", "51–100 of 120 rows"]);
    // Rows per page: the table starts again at its first page, and every table keeps the size.
    page.id("pageSize").choose("25");
    expect(range()).toEqual(["Line item 1", "Line item 25", "1–25 of 120 rows", "(‹) [1] 2 3 4 5 ›"]);
    page.id("pageSize").choose("100");
    expect(range()).toEqual(["Line item 1", "Line item 100", "1–100 of 120 rows", "(‹) [1] 2 ›"]);
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
    expect([page.id("rowCount").textContent, pagerButtons().join(" "), page.id("pager").contains(page.id("pageSize")), page.id("pageSize").value]).toEqual(["1–50 of 120 rows", "(‹) [1] 2 3 ›", true, "50"]);
    // A page turn, another number of rows per page and a search draw the pager again, where it stands.
    const pager = page.id("pager");
    page.find('.pg-btn[aria-label="Next page"]').press();
    page.id("pageSize").choose("25");
    page.id("tblSearch").type("item 1");
    expect([places(), page.id("pager") === pager, page.id("rowCount").textContent, pagerButtons().join(" ")]).toEqual([expected, true, "1–25 of 32 rows (filtered from 120)", "(‹) [1] 2 ›"]);
    // A table of one page has its count, its one page and the list of page sizes there as well.
    goTo(2);
    expect([places(), page.id("rowCount").textContent, pagerButtons().join(" "), page.id("pager").contains(page.id("pageSize")), page.id("pageSize").value])
      .toEqual([expected, "1–2 of 2 rows", "(‹) [1] (›)", true, "25"]);
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

  it("closes with Escape what is open: a popover, the drawer, the navigation of a narrow window", async () => {
    await openWith(APP);
    goTo(2);
    // Nothing open: nothing happens.
    page.key("Escape");
    expect([page.id("popover").hidden, drawerShown(), shows()[0]]).toEqual([true, false, "Cards"]);
    page.id("colBtn").press();
    page.key("Escape");
    expect(page.id("popover").hidden).toBe(true);
    cardLinks()[0].press();
    expect(drawerShown()).toBe(true);
    page.key("Escape");
    // The drawer slides out, and is out of the page once it has: with the scrim, unless the navigation still needs it.
    expect([drawerShown(), page.id("drawer").hidden, page.id("scrim").hidden]).toEqual([false, false, false]);
    vi.advanceTimersByTime(210);
    expect([page.id("drawer").hidden, page.id("scrim").hidden]).toEqual([true, true]);
    // Opened again before it has slid out, it stays.
    cardLinks()[0].press();
    page.key("Escape");
    cardLinks()[1].press();
    vi.advanceTimersByTime(500);
    expect([drawerShown(), page.id("drawer").hidden, page.id("drawerTitle").textContent]).toEqual([true, false, "Card 2 — Margin"]);
  });

  it("takes the focus into the navigation of a narrow window when its button opens it, and keeps the page behind out of reach until it closes", async () => {
    narrowWindow = true;
    await openWith(APP);
    const navigation = () => [page.id("sidenav").classList.contains("open"), page.id("navToggle").getAttribute("aria-expanded"), page.id("scrim").hidden];
    /** What the open navigation lies over: the link that skips to the results, the header, the banner area and the view. */
    const behind = () => [page.find(".skip"), page.find(".hd"), page.id("banners"), page.id("main")].map(part => part.inert);
    const open = [true, true, true, true];
    const closed = [false, false, false, false];
    expect([navigation(), behind()]).toEqual([[false, "false", true], closed]);
    goTo(2);
    page.id("navToggle").press();
    // Open: the focus is on the entry of the view shown. Nothing behind the navigation takes the focus, its own button
    // neither, which it covers; every entry does.
    expect([navigation(), behind(), page.document.activeElement === page.find('#navList [data-nav="2"]')]).toEqual([[true, "true", false], open, true]);
    expect([page.id("navToggle"), page.id("runAgain"), page.id("tblSearch"), page.find(".skip")].map(control => control.focusable)).toEqual([false, false, false, false]);
    expect(page.all("#navList .nav-item").map(item => item.focusable)).toEqual([true, true, true, true, true]);
    // Escape closes it: the page takes part again, and the focus is back on the button.
    page.key("Escape");
    expect([navigation(), behind(), page.document.activeElement === page.id("navToggle")]).toEqual([[false, "false", true], closed, true]);
    // A click beside it, on the scrim, does the same; the scrim goes once it has faded.
    page.id("navToggle").press();
    page.id("scrim").press();
    expect([navigation().slice(0, 2), behind(), page.document.activeElement === page.id("navToggle")]).toEqual([[false, "false"], closed, true]);
    vi.advanceTimersByTime(210);
    expect(page.id("scrim").hidden).toBe(true);
    // Choosing an entry closes it and shows that table, whose view takes the focus.
    page.id("navToggle").press();
    goTo(3);
    vi.advanceTimersByTime(210);
    expect([navigation(), behind(), shows()[0], page.document.activeElement === page.id("view")]).toEqual([[false, "false", true], closed, "Grid Sections", true]);
    // A new result that takes the page while the navigation is open closes it: the overview it shows is within reach.
    page.id("runAgain").press();
    page.id("navToggle").press();
    expect([navigation().slice(0, 2), behind()]).toEqual([[true, "true"], open]);
    sendResult(ports[0], APP);
    expect([navigation().slice(0, 2), behind(), shows()[0]]).toEqual([[false, "false"], closed, "Overview"]);
    // On the overview the focus goes to the overview's entry.
    page.id("navToggle").press();
    expect(page.document.activeElement).toBe(page.find('#navList [data-nav="overview"]'));
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
    const tiles = () => page.all("#navList .nav-item").filter(item => item.querySelector(".cnt")).flatMap((item, index) => {
      const tile = page.all("#view .stat")[index];
      const file = `${item.children[0].textContent}.csv`;
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
    expect(page.texts("#view h2")).toEqual(["About this export", "Notes", "Cards by type", "How to read these tables", "Diagnostics"]);
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

    // A model two of whose tables list fewer rows than their files have: the Line Items grid with its modules' own rows,
    // and the calendar with its rows about the model. The Details file counts all of each file's rows, 8 and 31.
    const left: AnalysisResult = { ...BLUEPRINT, summary: ["Line Items: 8 rows", "Modules: 3 rows", "Model Calendar: 31 rows"], tables: [...BLUEPRINT.tables, WITH_CALENDAR.tables[3]] };
    const counted = withFiles(left);
    expect(counted.tables[0].rows.filter(row => row[0] === "Files")).toEqual([["Files", "Line Items.csv", "8 rows"], ["Files", "Modules.csv", "3 rows"], ["Files", "Model Calendar.csv", "31 rows"]]);
    page.id("runAgain").press();
    sendResult(ports[0], counted);
    // The tiles count what the tables list, 5 line items and 26 settings, and say the 8 and 31 there are in all under that: neither
    // count of the Details file is lost, and no row of it is.
    expect(page.all("#view .stat").map(tile => tile.children.map(child => child.textContent))).toEqual([["Model Calendar", "26", "rows", "31 rows in all"], ["Modules", "3", "rows"],
      ["Line Items", "5", "rows", "8 rows in all"]]);
    expect([tiles(), unsaid(counted), page.has("#ovFiles"), page.has("#view .warn-list")]).toEqual([["Model Calendar.csv: 26 rows", "Model Calendar.csv: 31 rows", "Modules.csv: 3 rows",
      "Line Items.csv: 5 rows", "Line Items.csv: 8 rows"], [], false, false]);
  });

  it("says what was copied as text, whatever the ID holds, for a moment", async () => {
    // An ID is a cell like any other: it can hold what an Anaplan user typed.
    await openWith({ ...APP, tables: APP.tables.map((table, index) => (index === 3 ? { ...table, rows: [["Overview", 1, 1, "Own rows and columns", "REP01 Sales", `card ${TAG}`]] } : table)) });
    goTo(3);
    toggleColumn("Card ID");
    page.find("#tableWrap tbody .id-pill").press();
    await settle();
    expect([copied, page.id("toast").textContent, page.id("toast").children, page.has("img")]).toEqual([[`card ${TAG}`], `Copied card ${TAG}`, [], false]);
    // The same when the clipboard refuses and the text box is used instead.
    clipboardRefuses = true;
    page.commandWorks = true;
    page.find("#tableWrap tbody .id-pill").press();
    await settle();
    expect([page.created.map(element => element.value), page.id("toast").textContent, page.has("img")]).toEqual([[`card ${TAG}`], `Copied card ${TAG}`, false]);
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
    ["Module", "REP01 Sales", "—", "Overview", 1, "Source module", "102000000001"],
    ["Line item", "Revenue", "REP01 Sales", "Overview", 1, "Line item shown", "1901000000001"],
    ["Dimension", "Time", "—", "Overview", 1, "Column dimension", "20000000003"],
    ["Module", "REP01 Sales", "—", "Overview", 2, "Source module", "102000000001"],
    ["Dimension", "Time", "—", "Overview", 2, "Context selector", "20000000003"],
    ["Module", "REP02 Stores", "—", "Stores", 1, "Source module", "102000000002"],
    ["Dimension", "Time", "—", "Stores", 1, "Column dimension", "20000000003"],
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

  it("lists the file by object at first: one row an object, with its pages, its cards and what it is used as; the navigation and the tile count the uses", async () => {
    await openWith(WHERE);
    // The file's number of uses is what the navigation and the overview's tile say, whichever way the table lists them.
    expect(page.all("#navList .nav-item").filter(item => item.querySelector(".cnt")).map(item => item.children.map(child => child.textContent))).toEqual([["Pages", "2"], ["Cards", "3"], ["Where Used", "8"]]);
    expect(page.all("#view .stat").map(tile => tile.children.map(child => child.textContent))).toEqual([["Pages", "2", "rows"], ["Cards", "3", "rows"], ["Where Used", "8", "rows"]]);

    goTo(3);
    // The switch stands at the head of the toolbar, with By object shown: said to assistive technology, and filled.
    expect([page.find(".toolbar").children.map(child => child.id), page.id("tableWays").getAttribute("role"), page.id("tableWays").getAttribute("aria-label"), ways()])
      .toEqual([["tableWays", "searchWrap", "colBtn", "resetBtn", "rowCount", "pager"], "group", "How Where Used is listed", ["By object (shown) filled", "Every use"]]);
    expect(page.all("#tableWays button").every(button => button.localName === "button" && button.focusable)).toBe(true);
    // One row an object, in the order of an index: by type, then by name. The ID is there to choose, as in the file's own table.
    expect(headings()).toEqual(["Object type", "Object name", "Object's module", "Pages", "Cards", "Used as"]);
    expect(page.all("#tableWrap tbody tr").map(row => row.children.map(cell => cell.textContent.trim()))).toEqual([
      ["Module", "REP01 Sales", "—", "1", "2", "Source module"],
      ["Module", "REP02 Stores", "—", "1", "1", "Source module"],
      ["Line item", "Revenue", "REP01 Sales", "2", "2", "Line item shown; Filter line item"],
      ["Dimension", "Time", "—", "2", "3", "Column dimension; Context selector"]]);
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
    // The navigation's count is the same in both ways.
    expect(page.find('#navList [data-nav="3"] .cnt').textContent).toBe("8");

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
    expect([page.id("drawerTitle").textContent, page.texts("#drawerSub .link"), page.texts("#drawerBody h3")[0]]).toEqual(["Card 2 — Margin", ["Overview"], "Card details"]);
    // The drawer closes back to the row that opened it from the table.
    page.key("Escape");
    expect(page.document.activeElement).toBe(rowButton("Time"));
    // A page's name shows that page's cards: the third use is on Stores.
    rowButton("Time").press();
    uses()[2].children[0].querySelector("button")?.press();
    expect([page.texts("#view h1"), page.texts("#crumbs .ctx"), page.all("#tableWrap tbody tr").map(row => row.children[1].textContent.trim()), page.id("drawer").classList.contains("show")])
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
      ["Dimension", "Time", "—", "Overview", 1, "Column dimension", "20000000003"],
      ["Dimension", "Time", "—", "Overview", 1, "Context selector", "20000000003"],
      ["Dimension", "Time", "—", "Overview", 2, "Column dimension", "20000000003"],
      ["Module", "REP02 Stores", "—", "Stores", 1, "Source module", "102000000002"],
      ["Dimension", "Time", "—", "Stores", 1, "Column dimension", "20000000003"],
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
    expect([page.id("drawerTitle").textContent, page.texts("#drawerSub .link")]).toEqual(["Card 2 — Margin", ["Overview"]]);
    page.key("Escape");
    // The shared name still leads to the cards of that name: both pages'.
    rowButton("Time").press();
    listed()[0].children[0].querySelector("button")?.press();
    expect([page.texts("#crumbs .ctx"), page.all("#tableWrap tbody tr").map(row => row.children[1].textContent.trim())]).toEqual([["Page: Overview"], ["Sales", "Margin", "Sales, copied"]]);

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
    const uses = cards.map((card): Cell[] => ["Dimension", "Time", "—", card[0], card[1], "Column dimension", "20000000003"]);
    await openWith(whereUsed([...uses, ["Module", "REP01 Sales", "—", "Page 1", 1, "Source module", "102000000001"]], pages, cards));
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
    expect([page.id("drawerTitle").textContent, page.texts("#drawerSub .link")]).toEqual(["Card 2 — Second", ["Page 60"]]);
    // Opened again, the drawer lists the first fifty again.
    page.key("Escape");
    rowButton("Time").press();
    expect(listed().length).toBe(50);
  });

  it("opens a use's card from its row as every use too, where the result has the card: the card's number is a link in the row's drawer and in the table", async () => {
    // One more use, on a card the Cards file does not have.
    const gone: Cell[] = ["Module", "REP03 Gone", "—", "Overview", 9, "Source module", "102000000003"];
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
    expect([page.id("drawerTitle").textContent, page.texts("#drawerSub .link"), page.texts("#drawerBody h3")[0]]).toEqual(["Card 2 — Margin", ["Overview"], "Card details"]);
    // The drawer closes back to the row that opened it from the table.
    page.key("Escape");
    expect(page.document.activeElement).toBe(rowButton(4));
    // The card of the right page: card 1 of Stores, not card 1 of Overview.
    rowButton(6).press();
    page.find('#drawerBody [data-act="card"]').press();
    expect([page.id("drawerTitle").textContent, page.texts("#drawerSub .link")]).toEqual(["Card 1 — Stores grid", ["Stores"]]);
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
    expect(page.id("drawerTitle").textContent).toBe("Card 2 — Margin");
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
  const back = (name: string) => eventually(() => page.document.title === `Cardigan — ${name}`, "the result to come back");
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
    expect([page.texts("#view h1"), page.texts("#view .s-lab"), page.all("#navList .nav-item").map(item => item.children[0].textContent), page.id("sidenav").hidden])
      .toEqual([["Overview"], ["Pages", "Cards", "Grid sections", "Where Used"], ["Overview", "Pages", "Cards", "Grid Sections", "Where Used"], false]);
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
    expect([page.document.title, page.id("banners").children]).toEqual(["Cardigan — Demo <img src=x onerror=alert(1)> app", []]);
    await letKeep();
    // The new result is the one a refresh brings back now.
    await open(refreshed);
    await back("Demo <img src=x onerror=alert(1)> app");
    expect([page.texts("#view .s-lab"), page.has("img"), page.id("noteText").children]).toEqual([["Pages", "Cards"], false, []]);
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
      .toEqual([["note", "Analysing", "Reading the app…", "Keep the Anaplan tab open until this finishes."], false, true, 4, "Cardigan — Demo app"]);
    // And it is still what a refresh would bring back.
    expect(kept()).toBe(true);
    // The new result takes its place on the page once it is whole, and in what is kept once it is drawn.
    const next: AnalysisResult = { ...APP, name: "Demo app, read again", zipName: "Again.zip" };
    sendResult(ports[1], next);
    expect([page.document.title, page.id("banners").children, page.id("live").textContent]).toEqual(["Cardigan — Demo app, read again", [], "Analysis finished: Demo app, read again"]);
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
    expect([ports[1].posted, page.document.title]).toEqual([[{ type: "run" }], "Cardigan — Demo app, read again"]);
    await pass(50);
    expect([page.document.title, page.has("#noteBanner"), page.has("#runBanner"), page.id("live").textContent]).toEqual(["Cardigan — Demo app, read again", false, false, "Analysis finished: Demo app, read again"]);
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
      return [page.texts("#view h1"), page.has("#noteBanner"), page.document.title, session.held.size, page.id("sidenav").hidden];
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
    expect(page.document.title).toBe("Cardigan — Demo app");
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
    expect([page.texts("#view h1"), page.id("runStatus").textContent, page.has("#noteBanner"), page.id("navList").children, page.id("sidenav").hidden, page.document.title])
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
     * the navigation, the breadcrumb and the view's heading. */
    const parts = () => [page.document.title, page.id("hdMeta").textContent.trim(), page.id("banners").children.length, page.id("navList").children.length,
      page.id("crumbs").textContent.trim(), page.texts("#view h1")];
    // The kept result is not on the page yet: the keeper reads it in turns of its own.
    expect(parts()).toEqual(["Cardigan", "", 0, 0, "", []]);
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
    // Every part was there when it failed: the title, the header's line, the note, the navigation, the breadcrumb, the overview.
    expect(drawn).toEqual(["Cardigan — Demo app", expect.stringContaining("Demo app"), 1, 5, "Overview", ["Overview"]]);
    // All of it was taken off the page at once, the view too, and not only drawn over by what the page shows next.
    expect(cleared).toEqual(["Cardigan", "", 0, 0, "", []]);
    // The page is then the one that kept nothing: the waiting view, no navigation, and Run. What was kept is gone.
    expect(parts()).toEqual(["Cardigan", "", 0, 0, "", ["Connecting"]]);
    expect([page.id("runStatus").textContent, page.has("#noteBanner"), page.id("sidenav").hidden, said]).toEqual(["Connecting to the Anaplan tab…", false, true, "Connecting to the Anaplan tab…"]);
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
    expect(page.document.title).toBe("Cardigan — Demo app, read again");
    // Now the first result's keeping ends: the storage refused it. That is about a result which is no longer on the page.
    // The page says nothing: no note above the second result, no announcement, no line in the second run's log.
    await eventually(() => session.writes === 1, "the first result's keeping to end");
    await pass(30);
    expect([page.has("#noteBanner"), page.id("banners").children, page.id("live").textContent]).toEqual([false, [], "Analysis finished: Demo app, read again"]);
    // The second result is kept in a turn of its own, and the note it gets is its own, with one reason in the log.
    vi.advanceTimersByTime(0);
    await eventually(() => page.has("#noteBanner"), "the second result's note");
    expect([note(), session.writes, page.document.title]).toEqual([[TOO_LARGE_NOTE, "note", true], 2, "Cardigan — Demo app, read again"]);
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
    expect([keptPlace(), page.document.title]).toEqual([FORGOTTEN, "Cardigan — Noise"]);
  });

  it("leaves the result on the page when its kept copy is forgotten; the control goes, and one line says so in its place", async () => {
    await openWith(APP);
    await letKeep();
    const control = await offered();
    /** What the page shows of the result: its name, its overview, its navigation, the details of the export, and its controls. */
    const shown = () => [page.document.title, page.texts("#hdMeta .meta-app"), page.texts("#view h1"), page.texts("#view .s-lab"), page.all("#navList .nav-item").map(item => item.children[0].textContent),
      page.id("sidenav").hidden, page.texts("#ovAbout dd"), page.texts("#view h2"), disabled("runAgain"), runControl()[0], page.id("toast").textContent, page.id("banners").children.length];
    const was = shown();
    expect(was.slice(0, 3)).toEqual(["Cardigan — Demo app", ["Demo app"], ["Overview"]]);

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
    expect(page.id("drawerTitle").textContent).toBe("Card 2 — Margin");
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
    expect([page.texts("#view h1"), page.has("#noteBanner"), page.has("#ovKept"), page.document.title, page.id("sidenav").hidden, session.held.size])
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
    expect([note()[0], keptPlace(), page.document.title]).toEqual([line, FORGOTTEN, "Cardigan — Demo app"]);
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
    expect([keptPlace(), page.document.title, disabled("runAgain")]).toEqual([NOT_REMOVED, "Cardigan — Demo app", [false]]);

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
    expect([page.document.title, keptPlace(), session.held.size]).toEqual(["Cardigan — Demo app, read again", TO_COME, 0]);
    await letKeep();
    await offered();
    expect([keptPlace(), kept()]).toEqual([KEPT, true]);

    // Forgotten while a run is going: the copy of the result on the page goes, and the run's result is kept all the same.
    page.id("runAgain").press();
    page.find('#ovKept [data-act="forget"]').press();
    expect([banner().slice(0, 2), keptPlace(), session.held.size, page.document.title]).toEqual([["note", "Analysing"], FORGOTTEN, 0, "Cardigan — Demo app, read again"]);
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
    expect([page.document.title, keptPlace()]).toEqual(["Cardigan — Demo app, read again", TO_COME]);
    // Now the first result's keeping ends, and it is kept. The result on the page is the second, of which nothing is kept
    // yet: the page offers nothing.
    await eventually(kept, "the first result's keeping to end");
    await pass(30);
    expect([page.document.title, keptPlace(), page.has('[data-act="forget"]')]).toEqual(["Cardigan — Demo app, read again", TO_COME, false]);
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
      .toEqual([["note", "Analysing", "Reading the app…", "Keep the Anaplan tab open until this finishes."], "Cardigan — Demo app", TO_COME, 0]);
    // Now the compression ends, and the result is kept. It is still the result on the page, so the overview offers to
    // forget its copy, under the banner of the run that is going: a run on its way takes nothing from the result under it.
    compression.release();
    const control = await offered();
    expect([keptPlace(), kept(), banner().slice(0, 2), page.id("runAgain").disabled, control.localName, control.focusable, page.document.title])
      .toEqual([KEPT, true, ["note", "Analysing"], true, "button", true, "Cardigan — Demo app"]);
    // That run is cut off: the first result stays on the page, and the control for its copy with it.
    ports[0].drop();
    expect([banner().slice(0, 2), keptPlace(), kept(), page.document.title]).toEqual([["warn", "The analysis stopped"], KEPT, true, "Cardigan — Demo app"]);
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
    expect([page.document.title, keptPlace(), compression.asked]).toEqual(["Cardigan — Demo app, read again", KEPT, 2]);
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

describe("The navigation of the results page, shown or put away", () => {
  const root = () => page.document.documentElement;
  const button = () => page.id("navToggle");
  /** What the page says of the navigation: on its root, which the stylesheet reads, and on the button: whether the
   * navigation is shown, and what a press will do, as the button's name and as its title. */
  const says = () => [root().dataset.navigation, button().getAttribute("aria-expanded"), button().getAttribute("aria-label"), button().title];
  const SHOWN = ["shown", "true", "Hide navigation", "Hide navigation"];
  const HIDDEN = ["hidden", "false", "Show navigation", "Show navigation"];
  /** What the navigation of a narrow window lies over while it is open. */
  const behind = () => [page.find(".skip"), page.find(".hd"), page.id("banners"), page.id("main")].map(part => part.inert);
  const WITHIN_REACH = [false, false, false, false];
  const shows = () => [page.texts("#view h1")[0], page.texts("#crumbs strong")[0]];
  const openOver = () => page.id("sidenav").classList.contains("open");
  /** Whether the model's result is on the page. */
  const result = () => page.document.title === "Cardigan — Model one";
  /** The tab's port to the page as it was last opened: a test here opens the page more than once. */
  const tab = () => ports[ports.length - 1];
  const sendModel = () => {
    tab().send({ type: "subject", subject: { kind: "model", id: MODEL.id } });
    sendResult(tab(), MODEL);
  };
  /** The page as the icon's click leaves it, with the model's result on it. */
  const openWithModel = async () => {
    await open(clicked(42));
    sendModel();
  };

  it("puts the navigation of a wide window away in place with the header's first button, and brings it back; the button says what a press will do", async () => {
    // Before a result there is nothing to navigate: neither the navigation nor its button is there.
    await open(clicked(42));
    expect([button().hidden, page.id("sidenav").hidden]).toEqual([true, true]);
    sendModel();
    // With a result both are there. The button is the header's first control, and names the navigation as what it controls.
    expect([button().hidden, page.id("sidenav").hidden, page.find(".hd").children[0] === button(), button().getAttribute("aria-controls")]).toEqual([false, false, true, "sidenav"]);
    expect(says()).toEqual(SHOWN);
    goTo(1);
    const [table, entries] = [page.id("tableWrap"), page.all("#navList .nav-item").length];

    // Put away: the root says so, and the button says that a press brings the navigation back.
    button().press();
    expect(says()).toEqual(HIDDEN);
    // In place: nothing slides over the page or lies under a scrim, and nothing is out of reach. No view is drawn again:
    // the table on screen is the one that was there, and takes its new width by itself.
    expect([openOver(), page.id("scrim").hidden, behind(), page.id("tableWrap") === table, shows()]).toEqual([false, true, WITHIN_REACH, true, ["Line Items", "Line Items"]]);
    // The navigation is the page's still, with its entries, out of sight by the stylesheet's rule. The focus is where
    // the press put it: on the button, which is one press from bringing the navigation back.
    expect([page.id("sidenav").hidden, page.all("#navList .nav-item").length === entries, page.document.activeElement === button()]).toEqual([false, true, true]);
    button().press();
    expect([says(), page.id("tableWrap") === table, behind()]).toEqual([SHOWN, true, WITHIN_REACH]);
  });

  it("remembers for this browser whether the navigation is put away, and has it so before a result is drawn: the first, or one brought back after a refresh", async () => {
    await openWithModel();
    button().press();
    // The one thing the page keeps of it, under a name of its own.
    expect([says(), stored.get(NAVIGATION_KEY), [...stored.keys()]]).toEqual([HIDDEN, "hidden", ["cardigan-navigation"]]);

    // The icon opens the page again. The root says that the navigation is put away as soon as the script has run,
    // before the tab has said anything: the result that comes is never drawn with the navigation shown.
    await open(clicked(42));
    expect([says(), button().hidden, page.has("#runStatus"), result()]).toEqual([HIDDEN, true, true, false]);
    sendModel();
    expect([says(), button().hidden, page.id("sidenav").hidden, result()]).toEqual([HIDDEN, false, false, true]);
    // A refresh brings the result back that the page kept: put away from the first moment, and as the result is shown.
    await letKeep();
    await open("?tab=42");
    expect([says(), result()]).toEqual([HIDDEN, false]);
    await eventually(result, "the result to come back");
    expect([says(), button().hidden]).toEqual([HIDDEN, false]);

    // Brought back, it is remembered as shown.
    button().press();
    expect([says(), stored.get(NAVIGATION_KEY)]).toEqual([SHOWN, "shown"]);
    await open(clicked(42));
    expect(says()).toEqual(SHOWN);
    // Something else under the name is no choice: the navigation is shown.
    stored.set(NAVIGATION_KEY, "collapsed");
    await open(clicked(42));
    expect(says()).toEqual(SHOWN);
    // Nothing else was kept for it.
    expect([...stored.keys()]).toEqual([NAVIGATION_KEY]);
  });

  it("works in a browser that refuses its store, or has none: the navigation starts shown, and is put away for as long as the page is open", async () => {
    // The store holds a choice and refuses to be read or written: the navigation is shown, and the button works.
    stored.set(NAVIGATION_KEY, "hidden");
    storeRefuses = Object.assign(new Error("The operation is insecure."), { name: "SecurityError" });
    await openWithModel();
    expect(says()).toEqual(SHOWN);
    button().press();
    expect(says()).toEqual(HIDDEN);
    button().press();
    // Nothing was written: what the store held is what it holds.
    expect([says(), stored.get(NAVIGATION_KEY), stored.size]).toEqual([SHOWN, "hidden", 1]);
    // The same in a browser that has no store at all.
    vi.stubGlobal("localStorage", undefined);
    await openWithModel();
    expect(says()).toEqual(SHOWN);
    button().press();
    expect([says(), page.document.activeElement === button()]).toEqual([HIDDEN, true]);
  });

  it("gives the focus to the button when the navigation goes with the focus inside it, and leaves focus that is anywhere else; the breadcrumb still says where the user is and leads back", async () => {
    await openWithModel();
    goTo(1);
    // The focus is inside the navigation, on an entry, and the button is pressed without the focus moving, as by a
    // click that a script makes. What had the focus goes out of sight: the button takes it, at once and when the page
    // is drawn.
    page.find('#navList [data-nav="1"]').focus();
    expect(page.id("sidenav").contains(page.document.activeElement)).toBe(true);
    button().dispatch("click");
    expect([says(), page.document.activeElement === button()]).toEqual([HIDDEN, true]);
    page.frame();
    expect(page.document.activeElement).toBe(button());
    // Focus that is anywhere else stays where it is, when the navigation goes and when it comes back: here in the
    // table's search box.
    button().dispatch("click");
    page.id("tblSearch").focus();
    button().dispatch("click");
    expect([says(), page.document.activeElement.id]).toEqual([HIDDEN, "tblSearch"]);
    button().dispatch("click");
    expect([says(), page.document.activeElement.id]).toEqual([SHOWN, "tblSearch"]);
    // Focus inside the navigation as it comes back is left there: nothing went out of sight.
    button().dispatch("click");
    page.find('#navList [data-nav="2"]').focus();
    button().dispatch("click");
    expect([says(), page.document.activeElement === page.find('#navList [data-nav="2"]')]).toEqual([SHOWN, true]);

    // With the navigation put away the breadcrumb says which view is shown and leads back to the overview, and the
    // button is there, within reach of the Tab key, to bring the navigation back.
    button().press();
    expect([says(), page.texts("#crumbs strong"), page.texts("#crumbs button"), button().hidden, button().focusable]).toEqual([HIDDEN, ["Line Items"], ["Overview"], false, true]);
    page.find('#crumbs [data-nav="overview"]').press();
    expect([shows(), says(), page.document.activeElement === page.id("view")]).toEqual([["Overview", "Overview"], HIDDEN, true]);
  });

  it("asks nothing of a model's map when the navigation goes or comes back", async () => {
    await openWithModel();
    page.find('#navList [data-nav="map"]').press();
    const [host, drawn, asked] = [page.id("mapHost"), page.id("mapHost").children[0], [...mapAsked]];
    expect(asked).toEqual(["build", "mount 1", "show 1"]);
    // The map's place takes the new width by itself, and the map watches the size of its place: the page tells it
    // nothing, and takes nothing of it away.
    button().press();
    expect([says(), mapAsked, host.hidden, host.children[0] === drawn, page.texts("#view h1")]).toEqual([HIDDEN, asked, false, true, ["Model map"]]);
    button().press();
    button().press();
    expect([says(), mapAsked, host.hidden, host.children[0] === drawn]).toEqual([HIDDEN, asked, false, true]);
  });

  it("has no key of its own: the button alone puts the navigation away and brings it back", async () => {
    await openWithModel();
    goTo(1);
    const keys = ["[", "]", "\\", "b", "B", "n", "m", "s", "h", "Escape", "ArrowLeft", "ArrowRight", "Home", "F6"];
    for (const key of keys) {
      page.id("view").focus();
      page.key(key);
    }
    expect([says(), shows()]).toEqual([SHOWN, ["Line Items", "Line Items"]]);
    button().press();
    for (const key of keys) {
      page.id("view").focus();
      page.key(key);
    }
    expect([says(), shows()]).toEqual([HIDDEN, ["Line Items", "Line Items"]]);
  });

  it("opens the navigation over the content in a narrow window, as ever; what is remembered for a wide window is neither used nor changed there", async () => {
    stored.set(NAVIGATION_KEY, "hidden");
    narrowWindow = true;
    await openWithModel();
    // The root says what is remembered, which only the wide layout's rule reads. The button says what holds here: the
    // navigation is out of the way until the button opens it.
    expect([says(), openOver()]).toEqual([["hidden", "false", "Show navigation", "Show navigation"], false]);
    button().press();
    expect([openOver(), says(), behind(), page.id("scrim").hidden]).toEqual([true, ["hidden", "true", "Hide navigation", "Hide navigation"], [true, true, true, true], false]);
    page.key("Escape");
    expect([openOver(), says(), behind(), page.document.activeElement === button()]).toEqual([false, ["hidden", "false", "Show navigation", "Show navigation"], WITHIN_REACH, true]);
    // Nothing was written, and with nothing remembered the same holds: the root says shown, and the button the same words.
    expect([stored.get(NAVIGATION_KEY), stored.size]).toEqual(["hidden", 1]);
    stored.clear();
    await openWithModel();
    expect(says()).toEqual(["shown", "false", "Show navigation", "Show navigation"]);
    button().press();
    expect([openOver(), says().slice(1), stored.size]).toEqual([true, ["true", "Hide navigation", "Hide navigation"], 0]);
  });

  it("closes a navigation that lies over the content when the window grows wide, and says on the button what holds in the layout the window has", async () => {
    narrowWindow = true;
    await openWithModel();
    // The page keeps the result once it is drawn, which the clock below would start: that is let to its end first.
    await letKeep();
    button().press();
    expect([openOver(), behind()]).toEqual([true, [true, true, true, true]]);
    // The window grows wide: nothing lies over the page there. The navigation stands beside the content, shown.
    narrowWindow = false;
    expect(layoutListeners).toHaveLength(1);
    layoutListeners[0]({ matches: false });
    expect([openOver(), behind(), says()]).toEqual([false, WITHIN_REACH, SHOWN]);
    vi.advanceTimersByTime(210);
    expect(page.id("scrim").hidden).toBe(true);
    // There the button puts it away in place.
    button().press();
    expect([says(), openOver(), stored.get(NAVIGATION_KEY)]).toEqual([HIDDEN, false, "hidden"]);
    // Narrow again: the navigation is out of the way until it is opened, whatever was chosen for a wide window.
    narrowWindow = true;
    layoutListeners[0]({ matches: true });
    expect([says(), openOver()]).toEqual([["hidden", "false", "Show navigation", "Show navigation"], false]);
    button().press();
    expect([openOver(), says().slice(1)]).toEqual([true, ["true", "Hide navigation", "Hide navigation"]]);
    page.key("Escape");

    // The button says what holds in the layout the window has, each time the window crosses from one to the other
    // with nothing open: shown beside the content in a wide window, out of the way in a narrow one.
    narrowWindow = false;
    layoutListeners[0]({ matches: false });
    button().press();
    expect(says()).toEqual(SHOWN);
    narrowWindow = true;
    layoutListeners[0]({ matches: true });
    expect([says(), openOver()]).toEqual([["shown", "false", "Show navigation", "Show navigation"], false]);
    narrowWindow = false;
    layoutListeners[0]({ matches: false });
    expect([says(), openOver(), behind()]).toEqual([SHOWN, false, WITHIN_REACH]);
  });
});

describe("A model's map on the results page", () => {
  /** What the view, the navigation and the breadcrumb each say is shown. */
  const shows = () => [page.texts("#view h1")[0], page.texts('#navList [aria-current="page"] span')[0], page.texts("#crumbs strong")[0]];
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
    expect([shows(), mapAsked]).toEqual([["Overview", "Overview", "Overview"], []]);
    const entries = () => page.all("#navList .nav-item");
    expect(entries().map(item => item.children.map(child => child.textContent))).toEqual([["Overview"], ["Modules", "2"], ["Line Items", "120"], ["Model map"]]);
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
    expect([page.has('#navList [data-nav="map"]'), entries().map(item => item.children[0].textContent)]).toEqual([false, ["Overview", "Pages", "Cards", "Grid Sections", "Where Used"]]);
    goTo(2);
    page.id("banners").innerHTML = '<button type="button" data-nav="map">Map</button>';
    page.find('#banners [data-nav="map"]').press();
    expect([shows(), host().hidden, mapAsked]).toEqual([["Overview", "Overview", "Overview"], true, []]);
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
    expect(mapMounts[0].options).toEqual({ modelName: "Model one", workspaceName: "Planning", onFailure: expect.any(Function) });
    // What the map made is in its place, and nowhere else on the page.
    expect([host().children.length, host().contains(mapMounts[0].button), page.all("button").filter(button => button === mapMounts[0].button).length]).toEqual([1, true, 1]);

    // A dash where the workspace's name would be, which the export writes when it found none, is no name. Nor is an
    // empty cell, or a Details file without that row.
    for (const [what, result] of [["a dash", inWorkspace("—")], ["nothing", inWorkspace("")], ["no row", MODEL]] as const) {
      page.id("runAgain").press();
      sendResult(ports[0], result);
      toMap();
      const { options } = mapMounts[mapMounts.length - 1];
      expect([options, "workspaceName" in (options as object)], what).toEqual([{ modelName: "Model one", onFailure: expect.any(Function) }, false]);
    }
  });

  it("shows the map in the view's place and hides it for another view; coming back shows it as it was left, without building it again", async () => {
    await openWith(MODEL);
    goTo(1);
    page.id("tblSearch").type("item 11");
    toMap();
    // The view holds its heading alone, for a screen reader; the page's place for the map is shown; the navigation and
    // the breadcrumb say where the user is, and the breadcrumb leads back to the overview.
    expect([shows(), host().hidden, page.id("view").children.map(child => [child.localName, child.getAttribute("class")]), page.has("#tableWrap"), page.texts("#crumbs button")])
      .toEqual([["Model map", "Model map", "Model map"], false, [["h1", "sr-only"]], false, ["Overview"]]);
    // The view takes the focus, as every view does, and the page says what it shows.
    expect([page.document.activeElement === page.id("view"), page.id("live").textContent]).toEqual([true, "Model map"]);
    // The navigation gives up height to the map while it is shown, and the map's entry is its last: the page brings
    // the entry into sight, where the navigation has to scroll for that.
    expect(page.all("#navList .nav-item").map(item => item.broughtIntoSight)).toEqual([0, 0, 0, 1]);
    // A map that takes the focus into itself as it is shown keeps it: the page does not take it back to the view.
    toOverview();
    mapTakesFocus = true;
    toMap();
    expect([mapAsked.slice(3), page.document.activeElement === mapMounts[0].button, page.id("live").textContent]).toEqual([["hide 1", "show 1"], true, "Model map"]);
    mapTakesFocus = false;

    // Another view: the map is told that it is hidden, and its place gives the room back. The table is as any table
    // that was left: whole again.
    goTo(1);
    expect([mapAsked.slice(5), host().hidden, shows(), page.id("rowCount").textContent]).toEqual([["hide 1"], true, ["Line Items", "Line Items", "Line Items"], "1–50 of 120 rows"]);
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
    // The breadcrumb's Overview leaves the map as the navigation does.
    page.find('#crumbs [data-nav="overview"]').press();
    expect([mapAsked.slice(7), host().hidden, shows()]).toEqual([["hide 1"], true, ["Overview", "Overview", "Overview"]]);
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
      .toEqual([["hide 1", "show 1"], true, 1, 1, false, ["Model map", "Model map", "Model map"]]);
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
    // The breadcrumb's Overview, by a click that a script makes with the focus inside the map, is such a choice too.
    page.find('#crumbs [data-nav="overview"]').dispatch("click");
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
    expect([mapAsked.slice(3), host().hidden, host().childNodes.length, shows(), banner().slice(0, 2)]).toEqual([["destroy 1"], true, 0, ["Overview", "Overview", "Overview"], ["note", "Analysing"]]);
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
      .toEqual([["destroy 2"], true, 0, ["Overview", "Overview", "Overview"], "Cardigan — Model two", true]);
    // The new result's map is its own: built from its tables when its entry is chosen.
    toMap();
    expect([mapAsked.slice(8), mapBuilds[2].tables, mapMounts[2].options]).toEqual([["build", "mount 3", "show 3"], next.tables, { modelName: "Model two", workspaceName: "Planning", onFailure: expect.any(Function) }]);
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
    expect([banner().slice(0, 2), mapAsked, host().hidden, shows()[0]]).toEqual([["warn", "Not connected"], ["build", "mount 1", "show 1"], false, "Model map"]);
    // Run again once more, and this time the tab answers. Until it has said what it shows there is no run: the map is
    // still there, and the focus goes into it meanwhile.
    page.id("runAgain").press();
    mapMounts[0].button.focus();
    expect([mapAsked.length, page.document.activeElement === mapMounts[0].button]).toEqual([3, true]);
    // Now the run starts: the map goes, and the focus is on the overview that takes its place.
    ports[2].send({ type: "subject", subject: { kind: "model", id: MODEL.id } });
    expect([ports[2].posted, mapAsked.slice(3), host().hidden, host().childNodes.length, shows(), banner().slice(0, 2), page.document.activeElement === page.id("view")])
      .toEqual([[{ type: "run" }], ["destroy 1"], true, 0, ["Overview", "Overview", "Overview"], ["note", "Analysing"], true]);
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
    expect([kept(), mapAsked.slice(4), host().hidden, host().childNodes.length, page.document.title, shows()[0]]).toEqual([false, ["destroy 1"], true, 0, "Cardigan — Model one", "Overview"]);
    toMap();
    expect([mapAsked.slice(5), mapBuilds[1].tables, host().hidden]).toEqual([["build", "mount 2", "show 2"], MODEL.tables, false]);
  });

  it("opens the map of a result that was kept across a refresh like any other's", async () => {
    const model = inWorkspace("Planning");
    await openWith(model);
    await letKeep();
    // The page is refreshed: it brings the result back, and asks the tab nothing.
    await open("?tab=42");
    await eventually(() => page.document.title === "Cardigan — Model one", "the result to come back");
    // The result is there under the line that says when it was analysed, with its map's entry. Nothing is built yet.
    expect([page.id("noteText").textContent, page.all("#navList .nav-item").map(item => item.children[0].textContent), mapAsked, host().hidden])
      .toEqual([analysedLine(NOW, NOW), ["Overview", "Modules", "Line Items", "Model map"], [], true]);
    toMap();
    // Its map is built from the tables that came back, which are the result's, with the names the Details file gives.
    expect([mapAsked, mapBuilds[0].tables, mapMounts[0].options, mapMounts[0].host === host(), mapMounts[0].found, host().hidden])
      .toEqual([["build", "mount 1", "show 1"], model.tables, { modelName: "Model one", workspaceName: "Planning", onFailure: expect.any(Function) }, true, [false, 0, "Model map"], false]);
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
      .toEqual([["Model map", "Model map", "Model map"], [MAP_FAILED], MAP_FAILED, true, 0, ["build"]]);
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
      .toEqual([["build", "mount 3", "show 3", "destroy 3"], "Cardigan — Model two", "Overview", true, 0, []]);
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
    // says so under its heading, in the page's one sentence, and the page says it to a screen reader. The navigation
    // and the breadcrumb are the map's still.
    mapMounts[0].stops("Cannot read properties of undefined (reading 'x')");
    expect([mapAsked.slice(3), host().hidden, host().childNodes.length, button.isConnected, shows(), notDrawn(), page.id("live").textContent])
      .toEqual([["destroy 1"], true, 0, false, ["Model map", "Model map", "Model map"], [MAP_FAILED], MAP_FAILED]);
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
