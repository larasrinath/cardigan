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
import { FakeTab } from "./port-pair.test-support.js";
import { overviewOf } from "./result-view.js";

// The results page itself against the engine: the page's script on results.html at one end of the port, the content
// script's real side around the real analysis of an app at the other, and Anaplan's answers scripted. From the address
// the icon gives the page to the cells the page shows, nothing in between is a stand-in but the browser.
//
// In one process the page and the tab share the globals. What each reads of them does not overlap: the page's script the
// address's search, path and hash and the document's elements; the engine the address's host and origin and the cookies.

const SHELL = readFileSync(new URL(`../../${RESULTS_PAGE}`, import.meta.url), "utf8");
const NOW = new Date(Date.UTC(2026, 8, 28, 12, 30, 10));
const BOARD = (path: string): boolean => path.includes("/boards/");

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
  let connects: unknown[][];
  /** What the tab's session storage holds, which a refresh of the page leaves as it is. Each test has its own. */
  let session: Map<string, string>;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    tab = new FakeTab();
    service = goldenApp();
    runs = serveEngine(tab, { host: APP_HOST, shows: { kind: "app", id: GOLDEN_APP } });
    connects = [];
    vi.stubGlobal("fetch", service.fetch);
    vi.stubGlobal("WebSocket", service.WebSocket);
    vi.stubGlobal("history", { state: null, replaceState: (_state: unknown, _unused: string, address: string) => {
      (globalThis.location as { search: string }).search = address.includes("?") ? address.slice(address.indexOf("?")) : "";
    } });
    vi.stubGlobal("window", { matchMedia: () => ({ matches: false, addEventListener: () => undefined }), scrollTo: () => undefined, innerWidth: 1280, innerHeight: 800 });
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => undefined });
    const held = session = new Map<string, string>();
    vi.stubGlobal("sessionStorage", { get length() { return held.size; }, key: (index: number) => [...held.keys()][index] ?? null, getItem: (key: string) => held.get(key) ?? null,
      setItem: (key: string, value: string) => { held.set(key, value); }, removeItem: (key: string) => { held.delete(key); } });
    vi.stubGlobal("Element", FakeElement);
    vi.stubGlobal("HTMLElement", FakeElement);
    vi.stubGlobal("HTMLInputElement", FakeInput);
    vi.stubGlobal("HTMLSelectElement", FakeSelect);
    vi.stubGlobal("requestAnimationFrame", (callback: () => void) => { callback(); return 0; });
    vi.stubGlobal("navigator", { clipboard: { writeText: async () => undefined } });
    // The extension's messaging as the page has it: chrome.tabs.connect opens a port to the tab.
    vi.stubGlobal("chrome", {
      tabs: { connect: (tabId: number, info: { name: string }) => { connects.push([tabId, info]); return tab.connect(info.name); } },
      runtime: { get lastError() { return tab.lastError; } },
    });
  });
  afterEach(async () => {
    // Every run is let come to its end, so that none goes on into the next test; the stand-ins stay in the globals' place.
    service.releaseAll();
    await until(() => runs.every(run => run.ended), "every run to end");
    await tab.quiet();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  /** Loads the page at an address, in a tab of its own beside the Anaplan tab. */
  const open = async (search: string): Promise<void> => {
    vi.resetModules();
    page = new FakePage(SHELL);
    vi.stubGlobal("document", Object.assign(page.document, service.document));
    vi.stubGlobal("location", { search, pathname: `/${RESULTS_PAGE}`, hash: "", ...service.location });
    await import("./main.js");
  };
  /** The address the icon's click gives the page, a second and a half after the click. */
  const clicked = `?tab=42&opened=${NOW.getTime() - 1500}`;
  const shown = (name: string) => (): boolean => page.document.title === `Cardigan — ${name}`;
  /** The navigation's tables: each one's name and number of rows. */
  const navigation = (): string[][] => page.all("#navList .nav-item").filter(item => item.querySelector(".cnt")).map(item => item.children.map(child => child.textContent));
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

    // It shows the engine's tables, each with its rows, and the engine's note.
    expect(navigation()).toEqual(result.tables.filter(table => table.details !== true).map(table => [table.label, String(table.rows.length)]));
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
    expect([...tables.keys()]).toEqual(["Pages", "Cards", "Grid Sections", "Filters", "Conditional Formatting", "Action Buttons", "Where Used"]);
    const said = overviewSays();
    expect(said).toEqual(overviewFor(result));
    expect([said.about.length, said.howToRead.length > 0, said.log.length > 3, said.files]).toEqual([10, true, true, []]);
    // And that result is, file for file, the one 0.6.1 wrote as its zip, but for the one row of the Details file that is
    // deliberately reworded since (APP_ROW_REWORDED in golden-0.6.1.test-support.ts).
    expect(files(resultZip(result, NOW), DETAILS_FILE)).toEqual(files(APP_ZIP_REWORDED, DETAILS_FILE));
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
    // The engine is in the middle of its second run. The page shows where that run is, above the first result, which is
    // all still there, cell for cell.
    expect([page.id("bannerText").textContent, page.id("banners").textContent.includes("The results below are from the earlier run.")])
      .toEqual(["Reading page 1 of 2: Demand board", true]);
    expect([page.document.title, navigation().length, page.id("runAgain").disabled]).toEqual(["Cardigan — Planning: app", 7, true]);
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
    expect([page.document.title, page.id("runAgain").disabled]).toEqual(["Cardigan — Planning: app, renamed", false]);
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
    // The engine found ten uses: that is the file, and what the navigation counts.
    expect([file.rows.length, page.find(`#navList [data-nav="${index}"]`).children.map(child => child.textContent)]).toEqual([10, ["Where Used", "10"]]);
    page.find(`#navList [data-nav="${index}"]`).press();
    // By object at first: nine objects, in the order of an index. Territory is used twice by one card, and is one row.
    const cells = () => page.all("#tableWrap tbody tr").map(row => row.children.map(cell => cell.textContent.trim()));
    expect([page.texts("#view .view-note"), page.all("#tableWays button").map(button => [button.textContent.trim(), button.getAttribute("aria-pressed")]), page.id("rowCount").textContent])
      .toEqual([["10 uses of 9 objects. The CSV lists every use."], [["By object", "true"], ["Every use", "false"]], "1–9 of 9 rows"]);
    expect(cells()).toEqual([
      ["Module", "Demand", "—", "1", "1", "Data source (custom view)"],
      ["Line item", "Include?", "Filter flags", "1", "1", "Filter"],
      ["Line item", "Volume", "Demand", "1", "1", "Formatting"],
      ["Dimension", "Line Items", "—", "1", "1", "Page selector"],
      ["Dimension", "Product", "—", "1", "1", "Rows"],
      ["Dimension", "Territory", "—", "1", "1", "Page selector; Filter context"],
      ["Dimension", "Time", "—", "1", "1", "Columns"],
      ["Import", "Import demand", "—", "1", "1", "Action button"],
      ["Process", "Run nightly", "—", "1", "1", "Action button"]]);
    // Territory's drawer: what it is, its two roles, and its two uses on the one card, which the card's number opens.
    page.all('#tableWrap tbody [data-act="row"]')[5].press();
    const drawerRows = (section: number) => page.all("#drawerBody .d-sec")[section].querySelectorAll("tbody tr").map(row => row.children.map(cell => cell.textContent.trim()));
    expect([page.id("drawerTitle").textContent, page.id("drawerSub").textContent, drawerRows(0), drawerRows(1)]).toEqual(["Territory", "Dimension · 101000000902 · 1 page, 1 card",
      [["Page selector", "1"], ["Filter context", "1"]], [["Demand board", "2", "Page selector"], ["Demand board", "2", "Filter context"]]]);
    page.find('#drawerUses [data-act="use-card"]').press();
    expect([page.id("drawerTitle").textContent, page.texts("#drawerSub .link")]).toEqual(["Card 2 — Demand by product", ["Demand board"]]);
    page.id("drawerClose").press();
    // As every use, the table is the engine's file: its columns, the two that start hidden among them, and its ten rows.
    page.find('#tableWays [data-way="use"]').press();
    expect([cells().length, page.id("rowCount").textContent, page.all("#view .view-note").length]).toEqual([10, "1–10 of 10 rows", 0]);
    expect(onScreen()).toEqual(tablesOf(result).get("Where Used"));
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
    // The page shows the engine's tables again, under a line that says when they were analysed.
    const result = runs[0].result!;
    expect(navigation()).toEqual(result.tables.filter(table => table.details !== true).map(table => [table.label, String(table.rows.length)]));
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
});
