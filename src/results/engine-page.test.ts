import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DETAILS_FILE } from "../analyse.js";
import { APP_ZIP_REWORDED } from "../golden-0.6.1.test-support.js";
import { PORT_NAME, RESULTS_PAGE } from "../protocol.js";
import type { AnalysisResult } from "../result-types.js";
import { resultZip } from "../result-zip.test-support.js";
import { UNSENT } from "../tab-port.js";
import { parseCsv, unzipText } from "../zip.test-support.js";
import { FakeElement, FakeInput, FakePage, FakeSelect } from "./dom.test-support.js";
import { APP_HOST, GOLDEN_APP, goldenApp, serveEngine, type EngineRun } from "./engine.test-support.js";
import { analysedLine } from "./keep-notes.js";
import { KEPT_PREFIX } from "./keep-result.js";
import { fileWords, watchForFiles, type FileWatch } from "./no-file.test-support.js";
import { FakeTab } from "./port-pair.test-support.js";
import { overviewOf } from "./result-view.js";
import { fixTimeZone } from "./time-zone.test-support.js";
import { VIEW_KEY } from "./view-keep.js";

// The results page itself against the engine: the page's script on results.html at one end of the port, the content
// script's real side around the real analysis of an app at the other, and Anaplan's answers scripted. From the address
// the icon gives the page to the cells the page shows, nothing in between is a stand-in but the browser.
//
// In one process the page and the tab share the globals. What each reads of them does not overlap: the page's script the
// address's search, path and hash and the document's elements; the engine the address's host and origin and the cookies.

const SHELL = readFileSync(new URL(`../../${RESULTS_PAGE}`, import.meta.url), "utf8");
const NOW = new Date(Date.UTC(2026, 8, 28, 12, 30, 10));
const BOARD = (path: string): boolean => path.includes("/boards/");
/** What Anaplan itself calls a grid card's setting, which the Cards table says of a card as Anaplan names it. It is the
 * one text of this app's result that names a CSV, and it is Anaplan's. */
const ANAPLANS = /CSV export (?:on|off)/g;

/** Waits until something holds, while the tab, the page and Anaplan's stand-ins take their turns. */
async function until(holds: () => unknown, what: string): Promise<void> {
  // Three seconds at most, which is less than a test may take: a wait in vain then says what it waited for.
  for (const started = performance.now(); performance.now() - started < 3000;) {
    if (holds()) return;
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  throw new Error(`Waited in vain for ${what}.`);
}

/** A result's tables as text, by the names the page lists them under: each one's headers, then its rows cell for cell.
 * The Details file is no table of the page's: the overview says what it holds. */
const tablesOf = (result: AnalysisResult): Map<string, string[][]> =>
  new Map(result.tables.filter(table => table.details !== true).map(table => [table.label, [table.headers, ...table.rows.map(row => row.map(cell => String(cell).trim()))]]));

/** A zip's files as text. The Details file is given as its rows without the Diagnostics ones: a run's log is its own. */
function files(zip: Uint8Array, details: string): Map<string, string | string[][]> {
  return new Map([...unzipText(zip)].map(([name, text]): [string, string | string[][]] =>
    [name, name === details ? parseCsv(text).filter(row => row[0] !== "Diagnostics") : text]));
}

describe("The results page itself against the engine in the Anaplan tab", () => {
  let tab: FakeTab;
  let service: ReturnType<typeof goldenApp>;
  let runs: EngineRun[];
  let page: FakePage;
  /** The watch for a page that makes a file, starts a download or goes somewhere to save one (no-file.test-support.ts). */
  let watch: FileWatch;
  let connects: unknown[][];
  /** What the tab's session storage holds, which a refresh of the page leaves as it is. Each test has its own. */
  let session: Map<string, string>;
  /** What the pages loaded so far listen for as they go: a browser tells a page "pagehide" when a refresh replaces it,
   * and the page writes then what it would have written a moment later. A page that is never told so would write it
   * when its moment came: after the next page had loaded, or into the next test's storage. */
  let pageHides: (() => void)[] = [];
  /** The page goes, as a refresh or the end of a test takes it away: what it listens for as it goes is called once. */
  const hidePage = (): void => {
    const listeners = pageHides;
    pageHides = [];
    for (const listener of listeners) listener();
  };

  beforeEach(() => {
    pageHides = [];
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    watch = watchForFiles();
    tab = new FakeTab();
    service = goldenApp();
    runs = serveEngine(tab, { host: APP_HOST, shows: { kind: "app", id: GOLDEN_APP } });
    connects = [];
    vi.stubGlobal("fetch", service.fetch);
    vi.stubGlobal("WebSocket", service.WebSocket);
    vi.stubGlobal("history", { state: null, replaceState: (_state: unknown, _unused: string, address: string) => {
      (globalThis.location as { search: string }).search = address.includes("?") ? address.slice(address.indexOf("?")) : "";
    } });
    vi.stubGlobal("window", { matchMedia: () => ({ matches: false, addEventListener: () => undefined }), scrollTo: () => undefined, innerWidth: 1280, innerHeight: 800,
      addEventListener: (type: string, listener: () => void) => { if (type === "pagehide") pageHides.push(listener); } });
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => undefined });
    const held = session = new Map<string, string>();
    vi.stubGlobal("sessionStorage", { get length() { return held.size; }, key: (index: number) => [...held.keys()][index] ?? null, getItem: (key: string) => held.get(key) ?? null,
      setItem: (key: string, value: string) => { held.set(key, value); }, removeItem: (key: string) => { held.delete(key); } });
    vi.stubGlobal("Element", FakeElement);
    vi.stubGlobal("HTMLElement", FakeElement);
    vi.stubGlobal("getComputedStyle", () => ({ paddingLeft: "0px", paddingRight: "0px" }));
    vi.stubGlobal("HTMLInputElement", FakeInput);
    vi.stubGlobal("HTMLSelectElement", FakeSelect);
    vi.stubGlobal("requestAnimationFrame", (callback: () => void) => { callback(); return 0; });
    vi.stubGlobal("navigator", { clipboard: { writeText: async () => undefined } });
    // The viewer's clock is UTC's, on any machine: the page says its times in the viewer's zone (times.ts).
    fixTimeZone("UTC");
    // The extension's messaging as the page has it: chrome.tabs.connect opens a port to the tab.
    vi.stubGlobal("chrome", {
      tabs: { connect: (tabId: number, info: { name: string }) => { connects.push([tabId, info]); return tab.connect(info.name); } },
      runtime: { id: "cardigan-test", onMessage: { addListener: () => undefined }, get lastError() { return tab.lastError; } },
    });
  });
  afterEach(async () => {
    // Every run is let come to its end, so that none goes on into the next test; the stand-ins stay in the globals' place.
    service.releaseAll();
    await until(() => runs.every(run => run.ended), "every run to end");
    await tab.quiet();
    // The last page goes as the test ends: what it was about to write it writes now, into this test's storage.
    hidePage();
    // With the engine's own result on it, the page made no file, started no download and went nowhere to save one.
    const made = watch.stop(page);
    // And nothing it had for its user, from first to last, names a file, a CSV or a zip, or a download, but for that
    // setting of Anaplan's: before a result, while the engine ran, and with what the engine found.
    const named = page ? fileWords(page.words(), ANAPLANS) : [];
    vi.useRealTimers();
    vi.restoreAllMocks();
    expect([made, named]).toEqual([[], []]);
  });

  /** Loads the page at an address, in a tab of its own beside the Anaplan tab. */
  const open = async (search: string): Promise<void> => {
    // The page before goes first, as a refresh takes it: the browser tells it so before the next one loads.
    hidePage();
    vi.resetModules();
    page = new FakePage(SHELL);
    vi.stubGlobal("document", Object.assign(page.document, service.document));
    vi.stubGlobal("location", watch.location({ search, pathname: `/${RESULTS_PAGE}`, hash: "", ...service.location }));
    await import("./main.js");
  };
  /** The address the icon's click gives the page, a second and a half after the click. */
  const clicked = `?tab=42&opened=${NOW.getTime() - 1500}`;
  const shown = (name: string) => (): boolean => page.document.title === `Cardigan - ${name}`;
  /** The navigation's tables, by the words of each one's entry beside its icon: the entries named by a table's place in
   * the result, a number. The overview's and a map's are named by a word. */
  const navigation = (): string[] => page.all("#navList .nav-item").filter(item => /^\d+$/.test(item.dataset.nav ?? "")).map(item => item.querySelector("span")?.textContent ?? "");
  /** The table on screen with every column chosen, the ones that start hidden too: its headings, then its rows cell for
   * cell, as text. The columns are then as they started. An app's tables are short: every row is on the first page. */
  const onScreen = (): string[][] => {
    page.id("colBtn").press();
    for (const box of page.all("#popover input")) if (!box.checked) box.tick();
    const cells = [page.all("#tableWrap thead .th-sort").map(button => button.textContent.trim()), ...page.all("#tableWrap tbody tr").map(row => row.children.map(cell => cell.textContent.trim()))];
    page.find('#popover [data-popact="defaults"]').press();
    return cells;
  };
  /** Every table the navigation lists as the page shows it, by its name: its headings and its rows cell for cell, with
   * every column chosen and, of Where Used, every use. The page is then on the overview, with every table as it was. */
  const shownTables = (): Map<string, string[][]> => {
    const tables = new Map<string, string[][]>();
    for (const name of page.all("#navList [data-nav]").map(entry => entry.dataset.nav).filter(nav => nav !== "overview")) {
      page.find(`#navList [data-nav="${name}"]`).press();
      const byObject = page.has('#tableWays [data-way="object"]') && page.find('#tableWays [data-way="object"]').getAttribute("aria-pressed") === "true";
      if (byObject) page.find('#tableWays [data-way="use"]').press();
      tables.set(page.texts("#view h1")[0], onScreen());
      if (byObject) page.find('#tableWays [data-way="object"]').press();
    }
    page.find('#navList [data-nav="overview"]').press();
    return tables;
  };
  /** What the overview says, where the page is on it: its tiles, what it says about the export, its notes, how to read
   * the tables, and the diagnostic log, which stands in a section that starts closed. */
  const overviewSays = () => {
    const pairs = (place: string): string[][] => page.texts(`${place} dt`).map((detail, index) => [detail, page.texts(`${place} dd`)[index]]);
    return { tiles: page.all("#view .stat").map(tile => tile.children.map(child => child.textContent)), about: pairs("#ovAbout"), files: pairs("#ovFiles"), notes: page.texts("#view .warn-list li"),
      howToRead: pairs("#ovHowTo"), log: page.id("diagLog").textContent.split("\n") };
  };
  /** The same of a result, as the page reads it out of the result's Details file and counts its tables. */
  const overviewFor = (result: AnalysisResult) => {
    const { tiles, about, files: named, notes, howToRead, log } = overviewOf(result);
    return { tiles: tiles.map(tile => [tile.label, String(tile.count), tile.count === 1 ? "row" : "rows"]), about, files: named, notes, howToRead, log };
  };

  it("runs by itself for the page the icon has just opened, and shows what the engine found, cell for cell", async () => {
    await open(clicked);
    await until(shown("Planning: app"), "the result on the page");
    // The page connected to the tab its address names, and asked for the one run without a click.
    expect(connects).toEqual([[42, { name: PORT_NAME }]]);
    expect(tab.ports[0].tab.heard).toEqual([{ type: "run" }]);
    expect(runs).toHaveLength(1);
    const result = runs[0].result!;

    // It lists the engine's tables, and shows the engine's note.
    expect(navigation()).toEqual(result.tables.filter(table => table.details !== true).map(table => table.label));
    expect(page.texts("#view .warn-list li")).toEqual(["1 of 1 pages analysed; 1 unpublished, not analysed, 3 cards.", "Draft page: Not published", "Names: All models answered."]);
    page.find('#navList [data-nav="2"]').press();
    const cards = result.tables[2];
    // Of the engine's columns, the IDs and the card's number start hidden; each card's title is on screen.
    const headings = page.all("#tableWrap thead .th-sort").map(button => button.textContent.trim());
    expect(headings).toEqual(cards.headers.filter(header => !["Card #", "Card ID", "Source IDs"].includes(header)));
    expect(page.all("#tableWrap tbody tr").map(row => row.children[headings.indexOf("Card title")].textContent.trim())).toEqual(cards.rows.map(row => String(row[cards.headers.indexOf("Card title")])));

    // What the page shows is the engine's result: every table the navigation lists, with every column, cell for cell;
    // and on the overview what the engine's Details file says, with the log of the run.
    const tables = shownTables();
    expect(tables).toEqual(tablesOf(result));
    expect([...tables.keys()]).toEqual(["Pages", "Cards", "Grid Sections", "Filters", "Conditional Formatting", "Action Buttons", "Model Objects"]);
    const said = overviewSays();
    expect(said).toEqual(overviewFor(result));
    expect([said.about.length, said.howToRead.length > 0, said.log.length > 3, said.files]).toEqual([3, true, true, []]);
    // About this export says the app, its ID and the models it is built on, each model on a line of its own: this app is
    // built on one, which is one line. The app's categories and its pages are deliberately not said there, nor the
    // export's host, time and tool: the result's Details file keeps them, where a page left unpublished makes the pages
    // analysed two lines, and no line has a semicolon.
    const about = new Map(said.about.map(([detail, value]): [string, string[]] => [detail, value.split("\n")]));
    expect([[...about.keys()], about.get("Models")]).toEqual([["App", "App ID", "Models"], ["Model one (Workspace one)"]]);
    const kept = new Map((result.tables.find(table => table.file === DETAILS_FILE)?.rows ?? []).map(row => [String(row[1]), String(row[2]).split("\n")]));
    expect(["Categories", "Pages analysed", "Exported on"].map(detail => [about.has(detail), kept.get(detail)?.length])).toEqual([[false, 1], [false, 2], [false, 1]]);
    expect(kept.get("Pages analysed")).toEqual(["1 of 1 (published versions)", "1 unpublished, not analysed"]);
    // No word of it names a file, a CSV or a zip, or a download: the page is where a result is read. That is every cell
    // of every table, which `shownTables` has put on the page with every column, and in each view all the page says
    // and all it names or describes an element by, with a row's details and a card's where the view opens them. (A
    // grid card's "CSV export on" is that card's own setting in Anaplan, said as Anaplan names it.)
    const opened: string[] = [];
    for (const view of page.all("#navList [data-nav]").map(entry => entry.dataset.nav)) {
      page.find(`#navList [data-nav="${view}"]`).press();
      for (const details of ["row", "card"]) {
        if (!page.has(`#tableWrap tbody [data-act="${details}"]`)) continue;
        page.find(`#tableWrap tbody [data-act="${details}"]`).press();
        opened.push(`${page.texts("#view h1")[0]}: ${details}`);
        page.id("drawerClose").press();
      }
    }
    page.find('#navList [data-nav="overview"]').press();
    const words = page.words();
    expect(fileWords(words, ANAPLANS)).toEqual([]);
    // What was read is what a user reads. The engine's own words on how to read the tables, that setting of Anaplan's,
    // a cell of a column that starts hidden, what a control is named by, and the details of a row and of a card.
    expect([words.includes("A module or line item a card still points at but the model no longer has: deleted, or not visible to you. Search the Model Objects table for it to find the cards."),
      words.some(text => text.search(ANAPLANS) >= 0), words.includes(String(result.tables[2].rows[0][result.tables[2].headers.indexOf("Card ID")])), words.includes("Open this row"),
      words.includes("Close details panel"), opened]).toEqual([true, true, true, true, true,
      ["Pages: row", "Cards: row", "Cards: card", "Grid Sections: row", "Filters: row", "Conditional Formatting: row", "Action Buttons: row", "Model Objects: row"]]);
    // And that result is, file for file, the one 0.6.1 wrote as its zip, but for the five rows of the Details file and the
    // dash for nothing to say in the other files, which are deliberately written otherwise since (APP_ROW_REWORDED,
    // APP_ROWS_FOR_THE_PAGE, APP_ROW_ON_TWO_LINES and APP_DASH_PLAIN in golden-0.6.1.test-support.ts).
    expect(files(resultZip(result, NOW), DETAILS_FILE)).toEqual(files(APP_ZIP_REWORDED, DETAILS_FILE));
  });

  it("keeps a searched table and its open row through a real engine run with an edited cell", async () => {
    await open(clicked);
    await until(shown("Planning: app"), "the first result");
    page.find('#navList [data-nav="1"]').press();
    const heading = page.texts("#view h1");
    page.find('#tableWrap tbody [data-act="row"]').press();
    const title = page.id("drawerTitle").textContent;
    page.id("drawerClose").press();
    page.id("tblSearch").type(title);
    page.find('#tableWrap tbody [data-act="row"]').press();
    const table = page.id("tableWrap");
    const before = page.texts("#drawerBody dd");
    service.name = "Planning: app, edited";
    const board = service.hold(BOARD);
    page.id("runAgain").press();
    await until(() => board.waiting === 1, "the second run to pause");
    await tab.quiet();
    expect([page.id("tableWrap") === table, page.texts("#drawerBody dd"), page.has("#runBanner"), page.id("runAgain").textContent.trim()])
      .toEqual([true, before, false, "Reading"]);
    expect(page.id("runAgain").title).toBe(page.id("live").textContent);
    board.release();
    await until(shown("Planning: app, edited"), "the edited result");
    expect([page.texts("#view h1"), page.id("tblSearch").value, page.id("drawerTitle").textContent, page.id("drawer").classList.contains("show")])
      .toEqual([heading, title, title, true]);
    expect(page.texts("#drawerBody dd")).toContain("Planning: app, edited");
    expect(page.id("runAgain").textContent.trim()).toBe("Run again");
  });

  it("keeps the result on the page while the engine runs again, and through a run whose result cannot be sent", async () => {
    await open(clicked);
    await until(shown("Planning: app"), "the result on the page");
    const first = tablesOf(runs[0].result!);
    expect(shownTables()).toEqual(first);

    // Run again, a minute later and with the app renamed meanwhile; Anaplan's answer about the board is slow.
    const later = new Date(NOW.getTime() + 65_000);
    vi.setSystemTime(later);
    service.name = "Planning: app, renamed";
    const board = service.hold(BOARD);
    page.id("runAgain").press();
    await until(() => board.waiting === 1, "the second run to reach the board");
    await tab.quiet();
    // The engine is in the middle of its second run, which reads the app's pages a few at a time: it has begun the second
    // page beside the board. The page shows where that run is, above the first result, which is all still there, cell for cell.
    expect([page.id("runAgain").title, page.has("#runBanner")])
      .toEqual(["Reading page 2 of 2: Draft page", false]);
    expect([page.document.title, navigation().length, page.id("runAgain").disabled]).toEqual(["Cardigan - Planning: app", 7, true]);
    expect(shownTables()).toEqual(first);

    // Only when the engine's new result is whole does it take the first one's place.
    board.release();
    await until(shown("Planning: app, renamed"), "the second result on the page");
    expect([runs.length, page.id("banners").children, tab.ports.length]).toEqual([2, [], 1]);
    const second = tablesOf(runs[1].result!);
    expect(shownTables()).toEqual(second);
    // The two differ: every page's row names its app.
    expect([second.get("Pages")?.[1][0], first.get("Pages")?.[1][0]]).toEqual(["Planning: app, renamed", "Planning: app"]);

    // On the next run Chrome refuses a piece of the result: an error comes in place of "done". The page shows nothing of
    // what did arrive as a result: the second result stays, and the engine's sentence stands above it.
    service.name = "Planning: app, renamed again";
    tab.ports[0].tab.refuses = message => (message as { type?: string; table?: number }).type === "rows" && (message as { table?: number }).table === 2;
    page.id("runAgain").press();
    await until(() => page.has("#runBanner") && page.id("runBanner").classList.contains("warn"), "the failure on the page");
    expect([runs.length, runs[2].result?.name]).toEqual([3, "Planning: app, renamed again"]);
    expect([page.id("bannerText").textContent, page.id("bannerHint").hidden, page.id("bannerCopy").hidden]).toEqual([UNSENT, true, false]);
    expect([page.document.title, page.id("runAgain").disabled]).toEqual(["Cardigan - Planning: app, renamed", false]);
    expect(shownTables()).toEqual(second);
  });

  it("reads nothing for a page that was reloaded, until Run is chosen", async () => {
    // The address a reload finds: the time of the click was taken out when the icon opened the page.
    await open("?tab=42");
    await until(() => page.has("#runTitle") && page.id("runTitle").textContent === "Ready to analyse", "the page to say what the tab shows");
    await tab.quiet();
    expect([page.id("runStatus").textContent, page.id("runAgain").textContent.trim()]).toEqual(["That Anaplan tab shows an app.", "Run"]);
    // Nothing went to the tab but the connection, and the engine read nothing from Anaplan.
    expect([tab.ports[0].tab.heard, runs, service.reads, service.sockets]).toEqual([[], [], [], []]);

    page.id("runAgain").press();
    await until(shown("Planning: app"), "the result on the page");
    expect([tab.ports[0].tab.heard, runs.length, page.id("runAgain").textContent.trim()]).toEqual([[{ type: "run" }], 1, "Run again"]);
    expect(shownTables()).toEqual(tablesOf(runs[0].result!));
  });

  it("lists the engine's Where Used file by object, opens an object with its uses, and lists the engine's own file as every use", async () => {
    await open(clicked);
    await until(shown("Planning: app"), "the result on the page");
    const result = runs[0].result!;
    const index = result.tables.findIndex(table => table.file === "Where Used.csv");
    const file = result.tables[index];
    // The engine found ten uses: that is the file, and what the overview's tile counts.
    const tile = page.all("#view .stat").find(stat => stat.querySelector(".s-lab")?.textContent === "Model objects");
    expect([file.rows.length, tile?.querySelector(".s-num")?.textContent, page.texts(`#navList [data-nav="${index}"] span`)]).toEqual([10, "10", ["Model Objects"]]);
    page.find(`#navList [data-nav="${index}"]`).press();
    // By object at first: nine objects, in the order of an index. Territory is used twice by one card, and is one row.
    const cells = () => page.all("#tableWrap tbody tr").map(row => row.children.map(cell => cell.textContent.trim()));
    expect([page.texts("#view .view-note"), page.all("#tableWays button").map(button => [button.textContent.trim(), button.getAttribute("aria-pressed")]), page.id("rowCount").textContent])
      .toEqual([["10 uses of 9 objects. Choose Every use to list each one."], [["By object", "true"], ["Every use", "false"]], "1–9 of 9 rows"]);
    expect(cells()).toEqual([
      ["Module", "Demand", "-", "1", "1", "Data source (custom view)"],
      ["Line item", "Include?", "Filter flags", "1", "1", "Filter"],
      ["Line item", "Volume", "Demand", "1", "1", "Formatting"],
      ["Dimension", "Line Items", "-", "1", "1", "Page selector"],
      ["Dimension", "Product", "-", "1", "1", "Rows"],
      ["Dimension", "Territory", "-", "1", "1", "Page selector; Filter context"],
      ["Dimension", "Time", "-", "1", "1", "Columns"],
      ["Import", "Import demand", "-", "1", "1", "Action button"],
      ["Process", "Run nightly", "-", "1", "1", "Action button"]]);
    // Territory's drawer: what it is, its two roles, and its two uses on the one card, which the card's number opens.
    page.all('#tableWrap tbody [data-act="row"]')[5].press();
    const drawerRows = (section: number) => page.all("#drawerBody .d-sec")[section].querySelectorAll("tbody tr").map(row => row.children.map(cell => cell.textContent.trim()));
    expect([page.id("drawerTitle").textContent, page.id("drawerSub").textContent, drawerRows(0), drawerRows(1)]).toEqual(["Territory", "Dimension · 101000000902 · 1 page, 1 card",
      [["Page selector", "1"], ["Filter context", "1"]], [["Demand board", "2", "Page selector"], ["Demand board", "2", "Filter context"]]]);
    page.find('#drawerUses [data-act="use-card"]').press();
    expect([page.id("drawerTitle").textContent, page.texts("#drawerSub .link")]).toEqual(["Card 2 - Demand by product", ["Demand board"]]);
    page.id("drawerClose").press();
    // As every use, the table is the engine's file: its columns, the two that start hidden among them, and its ten rows.
    page.find('#tableWays [data-way="use"]').press();
    expect([cells().length, page.id("rowCount").textContent, page.all("#view .view-note").length]).toEqual([10, "1–10 of 10 rows", 0]);
    expect(onScreen()).toEqual(tablesOf(result).get("Model Objects"));
  });

  it("brings the engine's result back after a refresh of the page, without asking the engine, and shows the same cells", async () => {
    await open(clicked);
    await until(shown("Planning: app"), "the result on the page");
    // The page keeps the result once it has drawn it; the storage holds nothing but the keeper's own keys.
    const head = (): string | undefined => session.get(`${KEPT_PREFIX}head`);
    await until(head, "the result to be kept");
    const first = head();
    expect([...session.keys()].filter(key => !key.startsWith(KEPT_PREFIX))).toEqual([]);
    const before = { tables: shownTables(), overview: overviewSays() };
    expect([before.tables, before.overview]).toEqual([tablesOf(runs[0].result!), overviewFor(runs[0].result!)]);

    // A refresh, ten minutes later: the page's address holds no time of a click any more.
    const later = new Date(NOW.getTime() + 600_000);
    vi.setSystemTime(later);
    await open("?tab=42");
    await until(shown("Planning: app"), "the result to come back");
    await tab.quiet();
    // The engine made one result, and was asked for no second: the new page connected and sent nothing; nothing was read.
    const reads = service.reads.length;
    expect([runs.length, tab.ports.length, tab.ports[1].tab.heard, tab.ports[1].page.types()]).toEqual([1, 2, [], ["subject"]]);
    // The page lists the engine's tables again, under a line that says when they were analysed.
    const result = runs[0].result!;
    expect(navigation()).toEqual(result.tables.filter(table => table.details !== true).map(table => table.label));
    expect([page.id("noteText").textContent, page.id("runAgain").textContent.trim()]).toEqual([analysedLine(NOW, later), "Run again"]);
    // The page shows what it showed before the refresh: every table cell for cell, and on the overview what the engine's
    // Details file says, with the run's log.
    expect({ tables: shownTables(), overview: overviewSays() }).toEqual(before);
    expect(service.reads).toHaveLength(reads);

    // Run again asks the engine, on the port the page opened when it loaded, and the new result takes the kept one's place.
    service.name = "Planning: app, renamed";
    page.id("runAgain").press();
    await until(shown("Planning: app, renamed"), "the second result on the page");
    expect([runs.length, tab.ports.length, tab.ports[1].tab.heard, page.id("banners").children]).toEqual([2, 2, [{ type: "run" }], []]);
    await until(() => head() !== undefined && head() !== first, "the second result to be kept");
    await open("?tab=42");
    await until(shown("Planning: app, renamed"), "the second result to come back");
    expect(shownTables()).toEqual(tablesOf(runs[1].result!));
    expect(runs).toHaveLength(2);
  });

  it("writes a choice made just before a refresh as the page goes, and the page after it takes the choice back", async () => {
    await open(clicked);
    await until(shown("Planning: app"), "the result on the page");
    await until(() => session.get(`${KEPT_PREFIX}head`), "the result to be kept");
    const index = runs[0].result!.tables.findIndex(table => table.file === "Where Used.csv");
    page.find(`#navList [data-nav="${index}"]`).press();
    // Every use is chosen, and the page is refreshed at once: its moment to write has not come, and nothing is written yet.
    page.find('#tableWays [data-way="use"]').press();
    expect(session.has(VIEW_KEY)).toBe(false);
    // As it goes it writes what was chosen, into this tab's storage and nowhere later; the page after it takes it back.
    await open("?tab=42");
    await until(shown("Planning: app"), "the result to come back");
    expect(JSON.parse(session.get(VIEW_KEY) ?? "{}")).toMatchObject({ subject: `app:${GOLDEN_APP}`, everyUse: true });
    page.find(`#navList [data-nav="${index}"]`).press();
    expect(page.find('#tableWays [data-way="use"]').getAttribute("aria-pressed")).toBe("true");
  });
});
