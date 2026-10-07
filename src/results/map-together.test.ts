import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelGraph, ModelMapOptions } from "../map/graph-types.js";
import type { Pen } from "../map/map-canvas.js";
import { FakePen } from "../map/map-fakes.test-support.js";
import type { MapEnvironment } from "../map/map-view.js";
import { RESULTS_PAGE, type TabMessage } from "../protocol.js";
import type { AnalysisResult, ResultTable } from "../result-types.js";
import { FakeElement, FakeInput, FakePage, FakeSelect } from "./dom.test-support.js";

// The page, the map's graph and the map's view together, each as it is built: a model's result arrives on the results
// page as the tab sends one, "Model map" is chosen, and the page's own script has the real builder (map/build-graph.ts)
// make the graph and the real view (map/map-view.ts) draw it, in the stand-in page. The other tests take the three one
// at a time: the page's with stand-ins for the map, the view's with graphs made by hand, the builder's without a view.
//
// One thing is stood in for: the browser around the map. The stand-in page has no canvas to draw on, lays nothing out
// and shows no pictures. The view takes those from the browser in `mountModelMap`, and from whoever calls it in
// `mountModelMapIn`, which is the same map. So the page's call is led to `mountModelMapIn` with a browser that hands
// out pens which write down what they draw, tells the map's size when the test says so, and draws the pictures asked
// for when the test says so. The view's own tests mount it the same way.
//
// Every name here is made up.

/** The browser around the map: its pens, the size of its canvas, and its frames. */
class Surroundings implements MapEnvironment {
  /** What is drawn on the map's canvas, and on its small picture. */
  readonly canvas = new FakePen();
  readonly small = new FakePen();
  private readonly frames = new Map<number, (time: number) => void>();
  private readonly watchers: { told: (width: number, height: number) => void; on: boolean }[] = [];
  private asked = 0;
  private time = 1000;

  pen(canvas: HTMLCanvasElement): Pen { return ((canvas as unknown as FakeElement).classList.contains("map-minimap") ? this.small : this.canvas) as unknown as Pen; }
  watchSize(_element: Element, told: (width: number, height: number) => void): () => void {
    const watcher = { told, on: true };
    this.watchers.push(watcher);
    return () => { watcher.on = false; };
  }
  token(): string { return ""; }
  requestFrame(callback: (time: number) => void): number {
    this.frames.set(++this.asked, callback);
    return this.asked;
  }
  cancelFrame(frame: number): void { this.frames.delete(frame); }
  reducedMotion(): boolean { return true; }
  pixelRatio(): number { return 1; }
  now(): number { return this.time; }

  /** The browser lays the page out and shows it: a map that is watching is told the size of its canvas, and every
   * picture asked for is drawn, until none is asked for. The pens then hold what was drawn in this showing. */
  shows(width = 1200, height = 800): void {
    this.canvas.clear();
    this.small.clear();
    for (const watcher of this.watchers) if (watcher.on) watcher.told(width, height);
    for (let turn = 0; this.frames.size && turn < 400; turn++) {
      this.time += 16;
      const callbacks = [...this.frames.values()];
      this.frames.clear();
      for (const callback of callbacks) callback(this.time);
    }
  }
  /** How many maps are watching the size of their canvas: one that was taken away has stopped. */
  get watching(): number { return this.watchers.filter(watcher => watcher.on).length; }
}

/** The browser of the page under test, where the page's call to mount the map finds it. */
const browser = vi.hoisted(() => ({ around: undefined as unknown }));
vi.mock("../map/map-view.js", async importOriginal => {
  const view = await importOriginal<typeof import("../map/map-view.js")>();
  return { ...view, mountModelMap: (host: HTMLElement, graph: ModelGraph, options: ModelMapOptions) => view.mountModelMapIn(host, graph, options, browser.around as MapEnvironment) };
});

/* ---------- a made-up model, as the export writes its result (model/export.ts) ---------- */

// Each file is laid out as Anaplan's own export of the grid: an unnamed first column with each row's name, then the grid's
// columns under their own headers, every cell as text. Line Items has the headers a real model's file has, in its order
// (line-items-view.test.ts), with the three columns the export adds at the end. The files of actions have those of the
// Actions list and of the Imports tab, and Modules those of its grid (model/model.test.ts). General Lists has the columns
// the map reads, under the names the builder knows them by; Top Level Item and Numbered List are as the export's own
// tests write them. No test of the export holds that file's whole header row.
const LINE_ITEM_HEADERS = ["", "Format", "Formula", "Summary", "Applies To", "Time Scale", "Time Range", "Versions", "Style", "Cell Count", "Calculation Effort", "Notes",
  "Read Access Driver", "Write Access Driver", "Users List", "Parent", "Is Summary", "Formula Scope", "Code", "Use Switchover", "Breakback", "Brought-Forward", "Start of Section",
  "Data Tags", "Referenced By", "Module Name", "Ratio Numerator", "Ratio Denominator", "Format List"];
const MODULE_HEADERS = ["", "Applies To", "Cell Count"];
const LIST_HEADERS = ["", "Parent Hierarchy", "Top Level Item", "Numbered List", "Display Name Property", "Item Count", "Properties", "Subsets", "Production Data",
  "Referenced in Applies To", "Referenced as Format", "Referenced in Formula", "Notes"];
const ACTION_HEADERS = ["", "Action", "Start Date and Time (UTC)", "Most recent duration (ms)", "Notes", "Used in Processes", "Used in Dashboards"];
const IMPORT_HEADERS = ["", "Source Label", "Source Object", "Source Type", "Target Object", "Target Type", "Production Data", "Start Date and Time (UTC)", "Most recent duration (ms)", "Notes",
  "Used in Processes", "Used in Dashboards"];

/** A row's cells by their headers ("" is the row's name): every other cell is empty. */
type Cells = Record<string, string>;
const file = (label: string, headers: readonly string[], rows: readonly Cells[]): ResultTable =>
  ({ file: `${label}.csv`, label, headers: [...headers], rows: rows.map(cells => headers.map(header => cells[header] ?? "")), guard: false });

// A line item's Format and Summary are definitions, as Anaplan's export of the grid writes them. A definition names
// other objects by their IDs: the list of a list format, and the two line items a Ratio divides. The export's own three
// columns give their names (Format List, Ratio Numerator, Ratio Denominator).
const NUMBER = '{"minimumSignificantDigits":4,"decimalPlaces":-1,"dataType":"NUMBER"}';
const PERCENT = '{"minimumSignificantDigits":-1,"decimalPlaces":2,"unitsType":"PERCENTAGE","dataType":"NUMBER"}';
const LIST_OF_PRODUCTS = '{"hierarchyEntityLongId":101000000001,"entityFormatFilter":null,"selectiveAccessApplied":false,"showAll":false,"dataType":"ENTITY"}';
const SUM = '{"summaryMethod":"SUM","timeSummaryMethod":"SUM"}';
const NO_SUMMARY = '{"summaryMethod":"NONE","timeSummaryMethod":"NONE"}';
const RATIO = '{"summaryMethod":"RATIO","timeSummaryMethod":"RATIO","ratioNumeratorIdentifier":"_1901000000005_","ratioDenominatorIdentifier":"_1901000000003_"}';

/** A heading among the modules: a row with a name between dashes, and nothing else. */
const heading = (name: string): Cells => ({ "": name });
/** A module's own row: its dimensions, and no format, formula or summary. */
const moduleRow = (name: string, appliesTo: string): Cells => ({ "": name, "Applies To": appliesTo, "Time Scale": "Month", Versions: "All", "Cell Count": "480" });
/** A line item's row: a number that is summed, with its module's dimensions, unless the cells say otherwise. */
const lineItem = (inModule: string, name: string, cells: Cells = {}): Cells =>
  ({ "": name, "Module Name": inModule, Format: NUMBER, Summary: SUM, "Applies To": "-", "Time Scale": "Month", Versions: "All", "Cell Count": "480", "Is Summary": "false", ...cells });

const VOLUMES = "INP01 Volumes";
const PRICES = "INP02 Prices";
const REVENUE = "CAL01 Revenue";
const SUMMARY = "REP01 Summary";
const BOARD = "REP02 Board";

/** The rows of Line Items.csv: three headings, four modules and ten line items. Two input modules feed the one that
 * works revenue, cost and margin out, and that one feeds a report. Each line item names what reads it (Referenced By)
 * as a formula names things: a line item of its own module by its name, one of another behind that module and a dot,
 * and a name with a space or a sign in it in single quotes. */
const LINE_ITEM_ROWS: Cells[] = [
  heading("--- 01 Inputs ---"),
  moduleRow(VOLUMES, "Products"),
  lineItem(VOLUMES, "Units", { "Referenced By": "'CAL01 Revenue'.Revenue, 'CAL01 Revenue'.Cost" }),
  moduleRow(PRICES, "Products"),
  lineItem(PRICES, "Price", { Summary: NO_SUMMARY, "Referenced By": "'CAL01 Revenue'.Revenue" }),
  lineItem(PRICES, "Unit Cost", { Formula: "Products.'Standard Cost'", Summary: NO_SUMMARY, "Referenced By": "'CAL01 Revenue'.Cost" }),
  heading("--- 02 Calculations ---"),
  moduleRow(REVENUE, "Products"),
  lineItem(REVENUE, "Revenue", { Formula: "'INP01 Volumes'.Units * 'INP02 Prices'.Price", "Referenced By": "Margin, 'Margin %', 'REP01 Summary'.'Total Revenue'" }),
  lineItem(REVENUE, "Cost", { Formula: "'INP01 Volumes'.Units * 'INP02 Prices'.'Unit Cost'", "Referenced By": "Margin" }),
  lineItem(REVENUE, "Margin", { Formula: "Revenue - Cost", "Referenced By": "'Margin %', 'REP01 Summary'.'Total Margin'" }),
  lineItem(REVENUE, "Margin %", { Formula: "Margin / Revenue", Format: PERCENT, Summary: RATIO, "Ratio Numerator": "Margin", "Ratio Denominator": "Revenue", Notes: "Margin as a share of revenue" }),
  heading("--- 03 Reporting ---"),
  moduleRow(SUMMARY, ""),
  lineItem(SUMMARY, "Total Revenue", { Formula: "'CAL01 Revenue'.Revenue" }),
  lineItem(SUMMARY, "Total Margin", { Formula: "'CAL01 Revenue'.Margin" }),
  lineItem(SUMMARY, "Top Product", { Format: LIST_OF_PRODUCTS, Summary: NO_SUMMARY, "Format List": "Products" }),
];

/** The same model a month on, as a second result: the report feeds a new module of one line item. */
const LATER_ROWS: Cells[] = [
  ...LINE_ITEM_ROWS.map(cells => (cells[""] === "Total Revenue" || cells[""] === "Total Margin" ? { ...cells, "Referenced By": "'REP02 Board'.'Margin share'" } : cells)),
  moduleRow(BOARD, ""),
  lineItem(BOARD, "Margin share", { Formula: "'REP01 Summary'.'Total Margin' / 'REP01 Summary'.'Total Revenue'", Format: PERCENT, Summary: NO_SUMMARY }),
];

/** A model's result with those rows as its Line Items file, in the files' order of the export, the Details file first. */
function modelResult(name: string, lineItemRows: readonly Cells[]): AnalysisResult {
  // In Anaplan's list of modules a heading is a module of its own, without line items: the Modules file lists it too.
  const modules = lineItemRows.filter(cells => !cells["Module Name"]);
  const tables = [
    file("Line Items", LINE_ITEM_HEADERS, lineItemRows),
    file("Modules", MODULE_HEADERS, modules.map(cells => ({ "": cells[""], "Applies To": cells["Applies To"] ?? "", "Cell Count": cells["Cell Count"] ?? "" }))),
    file("General Lists", LIST_HEADERS, [{ "": "Products", "Top Level Item": "All Products", "Numbered List": "false", "Item Count": "40", Properties: "Standard Cost: NUMBER", Subsets: "Core Products",
      "Production Data": "false", "Referenced in Applies To": "'INP01 Volumes', 'INP02 Prices', 'CAL01 Revenue'", "Referenced as Format": "'REP01 Summary'.'Top Product'",
      "Referenced in Formula": "'INP02 Prices'.'Unit Cost'" }]),
    file("Processes", ACTION_HEADERS, [{ "": "Month end", "Start Date and Time (UTC)": "2026-10-01 06:00:00", "Most recent duration (ms)": "5210", Notes: "Runs once the month is closed" }]),
    file("Imports", IMPORT_HEADERS, [{ "": "Load volumes", "Source Label": "volumes.csv", "Source Object": "-", "Source Type": "FILE", "Target Object": VOLUMES, "Target Type": "MODULE",
      "Production Data": "false", "Start Date and Time (UTC)": "2026-10-01 06:00:01", "Most recent duration (ms)": "3120", "Used in Processes": "Month end" }]),
    file("Exports", ACTION_HEADERS, [{ "": "Send summary", Action: '{"exportType":"GRID_CURRENT_PAGE"}', "Used in Processes": "Month end" }]),
    // The Actions list is one grid, which the export splits: it writes this file with the two above, also without rows.
    file("Other Actions", ACTION_HEADERS, []),
  ];
  return {
    kind: "model", name, id: "0123456789ABCDEF0123456789ABCDEF", zipName: `${name} - Model Export - 2026-10-05.zip`,
    summary: tables.map(table => `${table.label}: ${table.rows.length} rows`),
    tables: [
      { file: "Model Details.csv", label: "Model Details", headers: ["Section", "Detail", "Value"], guard: true, details: true, rows: [
        ["Model", "Model", name], ["Model", "Workspace", "Planning"], ["Model", "Model ID", "0123456789ABCDEF0123456789ABCDEF"], ["Model", "Workspace ID", "fedcba9876543210fedcba9876543210"],
        ["Export", "Exported on", "2026-10-05 14:02 UTC"], ["Export", "Exported with", "Cardigan dev"], ["Export", "Anaplan host", "us1a.app.anaplan.com"],
        ...tables.map(table => ["Files", table.file, `${table.rows.length} rows`]),
        ["Diagnostics", "14:02:05", `model ${name} in Planning`]] },
      ...tables,
    ],
  };
}
const MODEL = modelResult("Model one", LINE_ITEM_ROWS);
const LATER = modelResult("Model two", LATER_ROWS);

/* ---------- the page, and what stands in for the browser around it ---------- */

const SHELL = readFileSync(new URL(`../../${RESULTS_PAGE}`, import.meta.url), "utf8");
const NOW = new Date(Date.UTC(2026, 9, 5, 14, 2, 5));

/** The port chrome.tabs.connect gives the page, with the tab's content script at the other end. */
class FakePort {
  readonly posted: unknown[] = [];
  private readonly listeners: ((message: unknown) => void)[] = [];
  readonly onMessage = { addListener: (listener: (message: unknown) => void) => { this.listeners.push(listener); } };
  readonly onDisconnect = { addListener: () => undefined };
  postMessage(message: unknown) { this.posted.push(structuredClone(message)); }
  disconnect() { /* the page let go */ }
  send(message: TabMessage) { for (const listener of this.listeners) listener(structuredClone(message)); }
}

let page: FakePage;
let port: FakePort;
let around: Surroundings;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  browser.around = around = new Surroundings();
  const held = new Map<string, string>();
  vi.stubGlobal("history", { state: null, replaceState: () => undefined });
  vi.stubGlobal("window", { matchMedia: () => ({ matches: false, addEventListener: () => undefined }), scrollTo: () => undefined, innerWidth: 1280, innerHeight: 800 });
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => undefined });
  vi.stubGlobal("sessionStorage", { get length() { return held.size; }, key: (index: number) => [...held.keys()][index] ?? null, getItem: (key: string) => held.get(key) ?? null,
    setItem: (key: string, value: string) => { held.set(key, value); }, removeItem: (key: string) => { held.delete(key); } });
  vi.stubGlobal("Element", FakeElement);
  vi.stubGlobal("HTMLElement", FakeElement);
  vi.stubGlobal("HTMLInputElement", FakeInput);
  vi.stubGlobal("HTMLSelectElement", FakeSelect);
  vi.stubGlobal("requestAnimationFrame", (callback: () => void) => { callback(); return 0; });
  vi.stubGlobal("navigator", { clipboard: { writeText: async () => undefined } });
  vi.stubGlobal("chrome", { tabs: { connect: () => port = new FakePort() }, runtime: { lastError: undefined } });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

/** A result as the tab sends it: what it is, then its rows table by table, then that it is complete. */
function send(result: AnalysisResult): void {
  port.send({ type: "result", result: { ...result, tables: result.tables.map(table => ({ ...table, rows: [] })) } });
  result.tables.forEach((table, index) => port.send({ type: "rows", table: index, rows: table.rows }));
  port.send({ type: "done" });
}

/** The page as the icon's click on a model's tab leaves it: loaded, the analysis run by itself, and its result shown. */
async function openWith(result: AnalysisResult): Promise<void> {
  vi.resetModules();
  page = new FakePage(SHELL);
  vi.stubGlobal("document", page.document);
  vi.stubGlobal("location", { search: `?tab=42&opened=${NOW.getTime() - 1500}`, pathname: `/${RESULTS_PAGE}`, hash: "" });
  await import("./main.js");
  port.send({ type: "subject", subject: { kind: "model", id: result.id } });
  send(result);
  expect(page.document.title).toBe(`Cardigan — ${result.name}`);
}

/** An entry of the page's navigation, by its words. */
const entry = (words: string): FakeElement => {
  const found = page.all("#navList .nav-item").find(item => item.children[0].textContent === words);
  if (!found) throw new Error(`The navigation has no entry ${words}`);
  return found;
};
/** Chooses an entry of the page's navigation, as a user does. */
const choose = (words: string): void => entry(words).press();
/** Chooses "Model map", and lets the browser lay the map out and draw it. */
const toMap = (): void => {
  choose("Model map");
  around.shows();
};

/** The page's place for the map, and what the map has put into it. */
const host = (): FakeElement => page.id("mapHost");
const part = (selector: string): FakeElement => page.find(`#mapHost ${selector}`);
const parts = (selector: string): FakeElement[] => page.all(`#mapHost ${selector}`);
const text = (selector: string): string => part(selector).textContent.replace(/\s+/g, " ").trim();
/** The line that says what the map shows. */
const status = (): string => text(".map-stats");
/** Where the map says it is: the model, and under it the section and the module on screen, each a step back but the last. */
const where = (): string[] => parts(".map-crumbs .map-crumb, .map-crumbs .map-here").map(crumb => crumb.textContent);
/** What is written on the canvas as the browser last showed it: each box's small line and its name. */
const written = (): string[] => [...new Set(around.canvas.texts())];
/** Whether one line written on the canvas holds all of these, each as a whole ("1 module" is not in "11 modules"): a
 * box's small line says several things, in the map's own way. The words asked for are letters, digits and spaces. */
const writes = (...words: string[]): boolean => written().some(line => words.every(word => new RegExp(`(?<![0-9A-Za-z])${word}(?![0-9A-Za-z])`).test(line)));
/** The line that says what the map shows, where the reader can see it: beside a selection the bar of what is traced
 * stands in its place. */
const shownStatus = (): string | undefined => (part(".map-status").hidden ? undefined : status());
/** The bar of what is traced, for the box selected: how many boxes feed it, its name, and how many it feeds. */
const traced = (): string[] => [".map-trace-up", ".map-trace-name", ".map-trace-down"].map(piece => text(`.map-tracebar ${piece}`));
/** The details of the box selected: each of its settings beside its value. */
const settings = (): Record<string, string> => Object.fromEntries(parts(".map-inspector .map-dl dt").map((term, index) => [term.textContent, parts(".map-inspector .map-dl dd")[index].textContent]));
/** One of the details' lists: each object it names, with what stands under the name (a line item's module). */
const listed = (list: string): string[][] => parts(`.map-inspector [data-map-list="${list}"] .map-link`).map(link =>
  [link.querySelector(".map-link-text")?.childNodes[0].textContent ?? "", link.querySelector("small")?.textContent ?? ""]);
/** The page's own table on screen: the cells of the row with this name, by the columns' headings. */
function tableRow(name: string): Record<string, string> {
  const headings = page.all("#tableWrap thead .th-sort").map(button => button.textContent.trim());
  const row = page.all("#tableWrap tbody tr").find(candidate => candidate.children[0].textContent.trim() === name);
  if (!row) throw new Error(`The table has no row ${name}`);
  return Object.fromEntries(headings.map((heading, index) => [heading, row.children[index].textContent.trim()]));
}

describe("A model's result on the results page, with the map's real graph and the map's real view", () => {
  it("draws the made-up model as its sections and its modules, by name, under a line that counts them and their links", async () => {
    await openWith(MODEL);
    // Nothing of the map is on the page until its entry is chosen.
    expect([host().hidden, host().children.length, around.watching]).toEqual([true, 0, 0]);
    toMap();
    // The map stands in the page's place for it, under the page's own heading for the view, and has the focus on its picture.
    expect([host().hidden, host().children.map(child => child.getAttribute("class")), page.texts("#view h1"), page.document.activeElement === part(".map-canvas")])
      .toEqual([false, ["map-root"], ["Model map"], true]);
    // It says which model it is of, with the workspace the Details file names.
    expect([where(), text(".map-crumb-ws-name")]).toEqual([["Model one"], "Planning"]);

    // The model has three headings among its modules: the map opens on those three sections. Inputs feed
    // Calculations, and Calculations feed Reporting: two links, however many formulas make each.
    expect(shownStatus()).toBe("3 sections · 2 links");
    expect(parts(".map-section-select option").map(option => option.textContent)).toEqual(["All sections", "01 Inputs", "02 Calculations", "03 Reporting"]);
    // Each section is a box on the picture, named, with what it holds: its modules, and their line items.
    expect(written()).toEqual(expect.arrayContaining(["01 Inputs", "02 Calculations", "03 Reporting"]));
    expect([writes("2 modules", "3 line items"), writes("1 module", "4 line items"), writes("1 module", "3 line items")]).toEqual([true, true, true]);

    // All its modules: four, as the Line Items file has them under its headings. Volumes and Prices each feed Revenue,
    // and Revenue feeds Summary: three links.
    part('[data-map-act="group"]').press();
    around.shows();
    expect([shownStatus(), where()]).toEqual(["4 modules · 3 links", ["Model one", "All modules"]]);
    expect(parts(".map-module-select option").map(option => option.textContent)).toEqual([VOLUMES, PRICES, REVENUE, SUMMARY]);
    // Each module is a box, with its code and its section on the small line and its name under it.
    expect(written()).toEqual(expect.arrayContaining(["Volumes", "Prices", "Revenue", "Summary"]));
    expect([writes("INP01", "01 Inputs"), writes("INP02", "01 Inputs"), writes("CAL01", "02 Calculations"), writes("REP01", "03 Reporting")]).toEqual([true, true, true, true]);
    // The notes about the map say how large the model is. Its line items are as many as the page's own Line Items table
    // lists, which leaves the modules' rows and the headings out as the map does. And the notes say what the map leaves
    // out of this export: its one export, whose definition names no module. Every other name in the files was matched,
    // every file the map reads is there, and each has the columns the map reads.
    part('[data-map-act="about"]').press();
    expect([part(".map-about").hidden, text(".map-notes .map-about-line")]).toEqual([false, expect.stringMatching(/^Model one\b.*\bPlanning\b.*\b4 modules\b.*\b10 line items$/)]);
    expect(page.all("#navList .nav-item").find(item => item.children[0].textContent === "Line Items")?.children[1].textContent).toBe("10");
    const leftOut = parts(".map-notes li").map(line => line.textContent);
    expect(leftOut.filter(line => /^\d/.test(line))).toEqual([expect.stringMatching(/^1 export is linked to no module or list/)]);
    expect(leftOut.filter(line => /was not exported|has no .* columns?:/.test(line))).toEqual([]);
  });

  it("finds a line item by search and says its formula, its format and summary in the page's words, and its module, and names no file", async () => {
    await openWith(MODEL);
    // What the page's own Line Items table says of two line items: the Format and Summary in words, where the file holds definitions.
    choose("Line Items");
    const onThePage = tableRow("Margin %");
    const topProduct = tableRow("Top Product");
    expect([onThePage["Module Name"], onThePage.Format, onThePage.Summary, onThePage.Formula, topProduct.Format])
      .toEqual([REVENUE, "Number, 2 decimal places, %", "Ratio = Margin / Revenue", "Margin / Revenue", "List: Products"]);

    toMap();
    // A key pressed with the focus in the map is the map's: the slash goes to the map's own search.
    const slash = page.key("/");
    expect([slash.defaultPrevented, page.document.activeElement === part(".map-search")]).toEqual([true, true]);
    part(".map-search").type("margin");
    // Three line items have the word in their name: the one named exactly so comes first, each with its module.
    expect([text(".map-search-count"), part(".map-results").hidden]).toEqual(["3", false]);
    expect(parts(".map-result").map(result => [result.querySelector("span")?.textContent, result.querySelector("small")?.textContent]))
      .toEqual([["Margin", REVENUE], ["Margin %", REVENUE], ["Total Margin", SUMMARY]]);

    parts(".map-result")[1].press();
    around.shows();
    // The map goes to the line item's module and selects it there: the module's four line items, with the three
    // modules they read and feed beside them.
    expect([where(), text(".map-kind"), text(".map-insp-name"), part(".map-inspector").hidden]).toEqual([["Model one", "02 Calculations", REVENUE], "LINE ITEM", "Margin %", false]);
    expect(written()).toEqual(expect.arrayContaining(["Revenue", "Cost", "Margin", "Margin %", "Volumes", "Prices", "Summary"]));
    // Beside a selection the bar of what is traced stands where the line of what is shown stood. Margin and Revenue feed
    // it, Cost feeds Margin, and the two input modules feed those: five boxes. Nothing reads it.
    expect([shownStatus(), traced()]).toEqual([undefined, [expect.stringMatching(/^5 boxes\b/), "Margin %", expect.stringMatching(/\b0 boxes$/)]]);
    // Its formula as the file has it, and its settings under the names of the table's columns: the module it is in, and
    // its Format and Summary in the very words the page's table has for them.
    const said = settings();
    expect([text(".map-formula"), said.Module, said.Format, said.Summary]).toEqual(["Margin / Revenue", REVENUE, onThePage.Format, onThePage.Summary]);
    // Its dimensions are its module's, as the page's table says in a column of its own, and its notes are the file's.
    expect([onThePage["Applies To"], onThePage["Applies To from"], said["Applies To"], text(".map-inspector .map-insp-note")])
      .toEqual(["Products", "Module", expect.stringMatching(/^Products\b.*\bmodule/), "Margin as a share of revenue"]);
    // What feeds it directly, as its formula reads: the two line items whose Referenced By names it, each with its module.
    expect(listed("depends")).toEqual([["Revenue", REVENUE], ["Margin", REVENUE]]);
    // The details name no file, and no row of one: there is no file for the user to open. The line item is in the page's
    // Line Items table, under its name.
    expect(part(".map-inspector").textContent).not.toMatch(/\.csv|\brow \d/);
    // With the selection cleared, the line counts what this view holds: the module's four line items, the three modules
    // beside them, and the ten links among them.
    part('.map-tracebar [data-map-act="clear"]').press();
    expect([part(".map-inspector").hidden, shownStatus()]).toEqual([true, "4 line items · 3 outside the module · 10 links"]);

    // A line item formatted as a list says the list, which the export names beside the format's ID: in the page's words too.
    part(".map-search").type("top product");
    parts(".map-result")[0].press();
    expect([text(".map-insp-name"), settings().Module, settings().Format]).toEqual(["Top Product", SUMMARY, topProduct.Format]);
    // A module says what loads into it: the one import, by the Imports file's Target Object.
    part(".map-search").type("inp01");
    parts(".map-result")[0].press();
    expect([text(".map-kind"), text(".map-insp-name")]).toEqual(["MODULE", VOLUMES]);
    expect(parts(".map-inspector .map-lines li").map(line => line.textContent)).toEqual([expect.stringMatching(/^Load volumes\b.*\bImport\b/)]);

    // A list comes from General Lists. That file says which formulas name the list: the line item whose formula reads
    // the list's property is fed by the list, which is a box beside its module's line items.
    part(".map-search").type("unit cost");
    parts(".map-result")[0].press();
    around.shows();
    expect([text(".map-insp-name"), text(".map-formula"), listed("depends"), written().includes("Products")]).toEqual(["Unit Cost", "Products.'Standard Cost'", [["Products", ""]], true]);
    // The list's own details say how many items it has.
    part('.map-inspector [data-map-list="depends"] .map-link').press();
    expect([text(".map-kind"), text(".map-insp-name"), settings()["Item Count"], part(".map-inspector").textContent.includes(".csv")]).toEqual(["LIST", "Products", "40", false]);
  });

  it("keeps the map through another view of the page and back, and drops it when a new result takes the page", async () => {
    await openWith(MODEL);
    toMap();
    part(".map-search").type("margin %");
    parts(".map-result")[0].press();
    // A text is typed into the map's search and left there, with no result chosen.
    part(".map-search").type("cost");
    around.shows();
    const root = host().children[0];
    /** What the user has made of the map: where it is, the box selected and its trace, and the text in its search. */
    const left = () => [where(), text(".map-insp-name"), traced(), part(".map-search").value];
    const was = left();
    expect(was).toEqual([["Model one", "02 Calculations", REVENUE], "Margin %", [expect.stringMatching(/^5 boxes\b/), "Margin %", expect.stringMatching(/\b0 boxes$/)], "cost"]);

    // Another view: the map gives its place up, and what it made stays there, out of sight.
    choose("Line Items");
    expect([host().hidden, root.hidden, host().children[0] === root, page.texts("#view h1"), page.id("rowCount").textContent]).toEqual([true, true, true, ["Line Items"], "1–10 of 10 rows"]);
    // Back: the same map, where it was left: the module's line items, the line item selected, the text in its search.
    // It is drawn again, and has the focus on its picture.
    toMap();
    expect([host().hidden, root.hidden, host().children[0] === root, left(), around.watching]).toEqual([false, false, true, was, 1]);
    expect(written()).toEqual(expect.arrayContaining(["Revenue", "Cost", "Margin", "Margin %"]));
    expect(page.document.activeElement).toBe(part(".map-canvas"));
    // Its entry chosen again while it is shown takes nothing from it, and gives it the focus back from the entry.
    choose("Model map");
    expect([host().children[0] === root, left(), page.document.activeElement === part(".map-canvas")]).toEqual([true, was, true]);

    // Another view chosen while the focus is still inside the map, as a click that a script makes leaves it: here on the
    // heading of the details. The browser goes on naming that heading as the one with the focus after the map is hidden,
    // until it next draws the page. The view has the focus all the same, at once and when the page is drawn.
    part(".map-insp-name").press();
    const heading = page.document.activeElement;
    expect([heading === part(".map-insp-name"), heading.textContent]).toEqual([true, "Margin %"]);
    entry("Line Items").dispatch("click");
    expect([host().hidden, heading.isConnected, page.texts("#view h1"), page.document.activeElement === page.id("view")]).toEqual([true, true, ["Line Items"], true]);
    page.frame();
    expect(page.document.activeElement).toBe(page.id("view"));
    toMap();
    expect([host().children[0] === root, left(), page.document.activeElement === part(".map-canvas")]).toEqual([true, was, true]);

    // The header's button puts the navigation away and brings it back, and the map's place is wider and narrower by
    // it. The page tells the map nothing of that: the map watches the size of its place itself. Told the new size by
    // the browser, it draws again with what the user has made of it, at either width.
    page.id("navToggle").press();
    expect([page.document.documentElement.dataset.navigation, host().hidden, host().children[0] === root, root.hidden]).toEqual(["hidden", false, true, false]);
    around.shows(1436, 800);
    expect([left(), around.watching]).toEqual([was, 1]);
    expect(written()).toEqual(expect.arrayContaining(["Revenue", "Cost", "Margin", "Margin %"]));
    page.id("navToggle").press();
    around.shows(1200, 800);
    expect([page.document.documentElement.dataset.navigation, host().children[0] === root, left(), around.watching]).toEqual(["shown", true, was, 1]);

    // Run again: the map of the result on the page goes as the run starts, and the overview stands in its place.
    page.id("runAgain").press();
    expect([port.posted, host().hidden, host().children.length, root.isConnected, around.watching, page.texts("#view h1")]).toEqual([[{ type: "run" }, { type: "run" }], true, 0, false, 0, ["Overview"]]);
    // The earlier result is still on the page while the run goes: its entry draws its map afresh, from the start.
    toMap();
    expect([host().children[0] === root, where(), shownStatus(), part(".map-inspector").hidden, part(".map-search").value]).toEqual([false, ["Model one"], "3 sections · 2 links", true, ""]);

    // The new result takes the page: the earlier one's map goes with it.
    send(LATER);
    expect([page.document.title, host().hidden, host().children.length, around.watching, page.texts("#view h1")]).toEqual(["Cardigan — Model two", true, 0, 0, ["Overview"]]);
    // The new result's map is of the new model: its name, and the module and the link it has more.
    toMap();
    part('[data-map-act="group"]').press();
    around.shows();
    expect([where(), shownStatus()]).toEqual([["Model two", "All modules"], "5 modules · 4 links"]);
    expect(parts(".map-module-select option").map(option => option.textContent)).toEqual([VOLUMES, PRICES, REVENUE, SUMMARY, BOARD]);
    expect(text(".map-notes .map-about-line")).toMatch(/^Model two\b.*\bPlanning\b.*\b5 modules\b.*\b11 line items$/);
  });
});
