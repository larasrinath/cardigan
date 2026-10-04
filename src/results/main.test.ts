import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FRESH_MS, PORT_NAME, RESULTS_PAGE, type TabMessage } from "../protocol.js";
import type { AnalysisResult, Cell } from "../result-types.js";
import { resultZip, tableCsv } from "../result-zip.js";
import { FakeElement, FakeInput, FakePage, FakeSelect } from "./dom.test-support.js";

/** The page as it is packaged: the script runs on results.html itself, read by the stand-in page. */
const SHELL = readFileSync(new URL(`../../${RESULTS_PAGE}`, import.meta.url), "utf8");

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

// The page under test, and what stands in for the browser around it. A test loads the page with `open`.
let page: FakePage;
let ports: FakePort[];
let connects: unknown[][];
let saved: Blob[];
/** What the script put on the clipboard, and whether the clipboard refuses. */
let copied: string[];
let clipboardRefuses: boolean;
/** What the page keeps between visits, whether the system prefers a dark theme, and who asked to hear when that changes. */
let stored: Map<string, string>;
let systemDark: boolean;
let systemListeners: ((event: { matches: boolean }) => void)[];
let lastError: { message?: string } | undefined;
/** The page's address, each address the script changed it to, and whether changing it is refused. */
let location: { search: string; pathname: string; hash: string };
let replaced: string[];
let fixedAddress: boolean;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  ports = [];
  connects = [];
  saved = [];
  copied = [];
  clipboardRefuses = false;
  stored = new Map();
  systemDark = false;
  systemListeners = [];
  lastError = undefined;
  replaced = [];
  fixedAddress = false;
  vi.stubGlobal("history", { state: null, replaceState: (_state: unknown, _unused: string, address: string) => {
    if (fixedAddress) throw new Error("The address cannot be changed.");
    replaced.push(address);
    location.search = address.includes("?") ? address.slice(address.indexOf("?")) : "";
  } });
  vi.stubGlobal("window", {
    matchMedia: () => ({ get matches() { return systemDark; }, addEventListener: (_type: string, listener: (event: { matches: boolean }) => void) => { systemListeners.push(listener); } }),
    scrollTo: () => undefined, innerWidth: 1280, innerHeight: 800,
  });
  vi.stubGlobal("localStorage", { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => { stored.set(key, value); } });
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
  vi.spyOn(URL, "createObjectURL").mockImplementation(blob => { saved.push(blob as Blob); return "blob:saved"; });
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

/** Loads the page at an address: a new page each time, as opening or reloading it gives. */
const open = async (search: string) => {
  vi.resetModules();
  page = new FakePage(SHELL);
  location = { search, pathname: "/results.html", hash: "" };
  vi.stubGlobal("document", page.document);
  vi.stubGlobal("location", location);
  await import("./main.js");
};
/** The address the icon's click gives the page, a second and a half after the click. */
const clicked = (tab: number) => `?tab=${tab}&opened=${NOW.getTime() - 1500}`;
/** What the run control reads, beside its icon. */
const runControl = () => [page.id("runAgain").textContent.trim(), page.id("runAgain").title, page.all("#runAgain svg").length];
const bytes = async (blob: Blob) => new Uint8Array(await blob.arrayBuffer());
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
    expect(disabled("runAgain", "dlAll", "dlCsv")).toEqual([true, true, true]);
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
    expect([page.texts("#view .panel h2"), page.texts("#view .warn-list li")]).toEqual([["Cards by type", "Notes"], ["1 of 1 pages analysed, 2 cards.", "Archive: Not published"]]);
    expect(page.id("banners").children).toEqual([]);
    // One navigation entry per file, the Details file as Details, and the model map as coming later.
    expect(page.all("#navList [data-nav]").map(entry => entry.dataset.nav)).toEqual(["overview", "1", "2", "details", "map"]);
    expect(page.find('#navList [data-nav="map"]').title).toBe("Model map is coming in a later version");
    expect(page.texts("#view h1")).toEqual(["Overview"]);
    expect(page.id("sidenav").hidden).toBe(false);
    // Downloads and Run again are there now; "this table" has no table on the overview.
    expect(disabled("runAgain", "dlAll", "dlCsv")).toEqual([false, false, true]);
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
      expect(disabled("runAgain", "dlAll", "dlCsv"), address).toEqual([false, true, true]);
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

  it("downloads the result's zip under its own name, the same bytes however late and however often", async () => {
    await openWith();
    page.id("dlAll").press();
    vi.setSystemTime(new Date(Date.UTC(2026, 9, 3, 18, 45, 0)));
    page.id("dlAll").press();
    expect(page.downloads).toEqual([{ name: RESULT.zipName, href: "blob:saved" }, { name: RESULT.zipName, href: "blob:saved" }]);
    // The link the script made for each download is clicked once and does not stay on the page.
    expect(page.created.map(link => [link.localName, link.clicks, link.isConnected])).toEqual([["a", 1, false], ["a", 1, false]]);
    expect(saved.map(blob => blob.type)).toEqual(["application/zip", "application/zip"]);
    const expected = resultZip(RESULT, NOW);
    expect(await bytes(saved[0])).toEqual(expected);
    expect(await bytes(saved[1])).toEqual(expected);
    expect(page.id("toast").textContent).toBe(`Downloaded ${RESULT.zipName}`);
  });

  it("gives a download a fixed name when the result's own name is not a plain file name, and the same content", async () => {
    // A path in the zip's name, a character that turns the text round in one file's name, and a path in another's.
    const named: AnalysisResult = { ...RESULT, zipName: "..\\..\\evil.zip",
      tables: [RESULT.tables[0], { ...RESULT.tables[1], file: `Pages${String.fromCodePoint(0x202e)}vsc.csv` }, { ...RESULT.tables[2], file: "../Cards.csv" }] };
    await openWith(named);
    page.id("dlAll").press();
    expect(page.id("toast").textContent).toBe("Downloaded Cardigan export.zip");
    goTo(1);
    expect(page.id("dlCsv").title).toBe("Download table.csv");
    page.id("dlCsv").press();
    goTo(2);
    page.id("dlCsv").press();
    expect(page.downloads.map(download => download.name)).toEqual(["Cardigan export.zip", "table.csv", "table.csv"]);
    expect(page.id("toast").textContent).toBe("Downloaded table.csv");
    // What is saved is the result's own zip and files, as they are.
    expect(await bytes(saved[0])).toEqual(resultZip(named, NOW));
    expect([await saved[1].text(), await saved[2].text()]).toEqual([named.tables[1], named.tables[2]].map(table => tableCsv(table).replace(/^\ufeff/, "")));
    // A plain name is used as it is.
    page.find('#navList [data-nav="details"]').press();
    expect(page.id("dlCsv").title).toBe("Download App Details.csv");
    page.id("dlCsv").press();
    expect(page.downloads[3].name).toBe("App Details.csv");
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
    expect(earlier()).toEqual(["Cardigan — Demo <img src=x onerror=alert(1)> app", ["Demo <img src=x onerror=alert(1)> app"], 5, ["Cards"], 2, false, "=Margin"]);
    expect(disabled("runAgain", "dlAll", "dlCsv")).toEqual([true, false, false]);
    // And it is what the downloads give, with the time it was complete at.
    vi.setSystemTime(new Date(Date.UTC(2026, 9, 3, 15, 0, 0)));
    page.id("drawerClose").press();
    page.id("dlAll").press();
    page.id("dlCsv").press();
    expect(page.downloads.map(download => download.name)).toEqual([RESULT.zipName, "Cards.csv"]);
    expect(await bytes(saved[0])).toEqual(resultZip(RESULT, NOW));
    expect(await saved[1].text()).toBe(tableCsv(RESULT.tables[2]).replace(/^\ufeff/, ""));

    // The new result arrives in pieces: until it is complete, nothing of it is shown, and the user reads on.
    page.all('#tableWrap tbody [data-act="row"]')[0].press();
    expect(page.id("drawer").classList.contains("show")).toBe(true);
    const next: AnalysisResult = { ...RESULT, name: "Demo app, second run", zipName: "Second.zip", summary: ["1 of 1 pages analysed, 1 card."],
      tables: [RESULT.tables[0], RESULT.tables[1], { ...RESULT.tables[2], rows: [["Overview", 1, "Only card", "Grid", "card-z"]] }] };
    ports[0].send({ type: "result", result: { ...next, tables: next.tables.map(table => ({ ...table, rows: [] })) } });
    next.tables.forEach((table, index) => ports[0].send({ type: "rows", table: index, rows: table.rows }));
    expect([earlier().slice(0, 5), banner().slice(0, 3)]).toEqual([["Cardigan — Demo <img src=x onerror=alert(1)> app", ["Demo <img src=x onerror=alert(1)> app"], 5, ["Cards"], 2],
      ["note", "Analysing", "Receiving the result…"]]);
    ports[0].send({ type: "done" });
    // Now the page is the new result's: its overview, without the banner, and without the drawer that showed a row of the old one.
    expect([page.document.title, page.texts("#view h1"), page.texts("#navList .cnt"), page.id("banners").children, page.id("drawer").classList.contains("show")])
      .toEqual(["Cardigan — Demo app, second run", ["Overview"], ["1", "1"], [], false]);
    // The focus was in that drawer: it is on the new view now, not on nothing.
    expect(page.document.activeElement).toBe(page.id("view"));
    expect(disabled("runAgain", "dlAll", "dlCsv")).toEqual([false, false, true]);
    // The downloads are the new result's from now on, with its own time.
    page.id("dlAll").press();
    expect(page.downloads[2].name).toBe("Second.zip");
    expect(await bytes(saved[2])).toEqual(resultZip(next, new Date(Date.UTC(2026, 9, 3, 15, 0, 0))));
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
    // The result is where it was, and so are its downloads; Run again can be tried again.
    expect([page.document.title, page.texts("#view h1"), firstCells().length, page.id("sidenav").hidden]).toEqual(["Cardigan — Demo <img src=x onerror=alert(1)> app", ["Cards"], 2, false]);
    expect(disabled("runAgain", "dlAll", "dlCsv")).toEqual([false, false, false]);
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
    expect([shown(), page.has("img"), disabled("runAgain", "dlAll")]).toEqual([first, false, [false, false]]);

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
    // The Details view still shows, and copies, the log the result carries.
    page.find('#navList [data-nav="details"]').press();
    page.find('#view [data-act="copy-diag"]').press();
    await settle();
    expect(copied[1]).toBe("14:02:05 app: 1 page");
  });

  it("opens a row and a card whose table and title hold a tag, and shows both names as text", async () => {
    await openWith(NAMED);
    page.find('#navList [data-nav="2"]').press();
    expect(page.texts("#view h1")).toEqual([`Cards ${TAG}`]);
    // A click on a row, outside its links, opens the row. The drawer's title is the row's own name, its first cell, and
    // the line under it says which row of which table it is.
    page.find("#tableWrap tbody tr .tag").press();
    expect(page.id("drawer").hidden).toBe(false);
    expect([page.id("drawerTitle").textContent, page.id("drawerSub").textContent]).toEqual(["Overview", `Row 1 of Cards ${TAG}`]);
    expect(page.id("drawerSub").children).toEqual([]);
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
    // The table keeps to its headers; the row's drawer has every cell, as the CSV has.
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
    page.id("drawerClose").press();
    page.id("dlCsv").press();
    expect(await saved[0].text()).toContain("beyond the headers");
  });

  it("keeps a page's link in an app's first column, with the row's button before it", async () => {
    await openWith();
    goTo(2);
    const first = page.all("#tableWrap tbody tr").map(row => row.children[0].querySelectorAll("button").map(button => [button.dataset.act, button.textContent, button.getAttribute("aria-label")]));
    expect(first).toEqual([[["row", "", "Open this row"], ["page", "Overview", null]], [["row", "", "Open this row"], ["page", "Overview", null]]]);
    // The row's button opens the row, not the card and not the page's cards.
    page.all('#tableWrap tbody [data-act="row"]')[1].press();
    expect([page.id("drawerTitle").textContent, page.id("drawerSub").textContent, page.texts("#drawerBody h3"), page.texts("#drawerBody dd")])
      .toEqual(["Overview", "Row 2 of Cards", ["All columns"], ["Overview", "2", "=Margin", "KPI", "card-b"]]);
    page.key("Escape");
    // And the page's name still shows that page's cards.
    page.find('#tableWrap tbody [data-act="page"]').press();
    expect(page.texts("#crumbs .ctx")).toEqual(["Page: Overview"]);
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
    // The overview and the details: the view's heading, then its panels and sections one level under it.
    expect([levels("#main"), page.texts("#main h2")]).toEqual([[1, 2, 2], ["Cards by type", "Notes"]]);
    page.find('#navList [data-nav="details"]').press();
    expect([levels("#main"), page.texts("#main h2")]).toEqual([[1, 2, 2], ["Export", "Notes"]]);
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

  it("shows no Notes panel for a model whose summary only says how many rows each file has", async () => {
    await openWith(MODEL);
    expect([page.texts("#view h1"), page.texts("#view .s-lab"), page.has("#view .warn-list"), page.id("banners").children]).toEqual([["Overview"], ["Line Items", "Modules"], false, []]);
    // A model's tiles carry its files' own names; the navigation does too.
    expect(page.texts("#navList .nav-item span").filter(text => !/^\d+$/.test(text)).slice(1, 3)).toEqual(["Line Items", "Modules"]);
    // A table's view has no notes either: they are on the overview only.
    goTo(1);
    expect([page.has(".warn-list"), page.id("banners").children]).toEqual([false, []]);
  });

  it("says so when the address names no tab, and connects to nothing", async () => {
    await open("");
    expect(connects).toEqual([]);
    expect([page.id("runTitle").textContent, page.id("runStatus").textContent]).toEqual(["No Anaplan tab", "This page was opened without an Anaplan tab to read."]);
    expect(page.id("runAgain").disabled).toBe(true);
    page.id("runAgain").press();
    expect(connects).toEqual([]);
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

  it("opens the table the navigation names, the overview and the details, and says that the model map is to come", async () => {
    await openWith(APP);
    expect(shows()).toEqual(["Overview", "Overview", "Overview"]);
    for (const [table, label, rows] of [[1, "Pages", 2], [2, "Cards", 4], [3, "Grid Sections", 3], [4, "Where Used", 2]] as const) {
      goTo(table);
      expect([shows(), firstCells().length, page.id("dlCsv").title]).toEqual([[label, label, label], rows, `Download ${label}.csv`]);
    }
    page.find('#navList [data-nav="details"]').press();
    expect([shows(), page.has("#tableWrap")]).toEqual([["Details", "Details", "Details"], false]);
    // The breadcrumb's Overview goes back to the overview.
    page.find('#crumbs [data-nav="overview"]').press();
    expect(shows()).toEqual(["Overview", "Overview", "Overview"]);
    // The model map is listed as to come: a click says so, for a moment, and the view stays.
    page.find('#navList [data-nav="map"]').press();
    expect([page.id("toast").textContent, page.id("toast").classList.contains("show"), shows()[0]]).toEqual(["Model map is coming in a later version", true, "Overview"]);
    vi.advanceTimersByTime(2199);
    expect(page.id("toast").classList.contains("show")).toBe(true);
    vi.advanceTimersByTime(1);
    expect(page.id("toast").classList.contains("show")).toBe(false);
  });

  it("saves with Download this table the table on screen, whole, and the Details file on the details view", async () => {
    await openWith(APP);
    const last = async () => [page.downloads[page.downloads.length - 1].name, saved[saved.length - 1].type, await saved[saved.length - 1].text()];
    const csv = (file: string) => tableCsv(APP.tables.find(table => table.file === file)!).replace(/^\ufeff/, "");
    for (const [where, file] of [[3, "Grid Sections.csv"], [1, "Pages.csv"], ["details", "App Details.csv"], [4, "Where Used.csv"], [2, "Cards.csv"]] as const) {
      page.find(`#navList [data-nav="${where}"]`).press();
      page.id("dlCsv").press();
      expect(await last(), file).toEqual([file, "text/csv;charset=utf-8", csv(file)]);
      expect(page.id("toast").textContent).toBe(`Downloaded ${file}`);
    }
    // What is searched, filtered, sorted or hidden on screen does not change the file: it is the table as the zip holds it.
    page.id("tblSearch").type("margin");
    page.find('[data-sort="2"]').press();
    page.id("colBtn").press();
    page.all("#popover input")[0].tick();
    expect(firstCells().length).toBe(2);
    page.id("dlCsv").press();
    expect((await last())[2]).toBe(csv("Cards.csv"));
    // On the overview there is no table on screen: the button is off, and a click saves nothing.
    page.find('#navList [data-nav="overview"]').press();
    const before = saved.length;
    page.id("dlCsv").press();
    expect([page.id("dlCsv").disabled, page.id("dlCsv").title, saved.length]).toEqual([true, "Open a table to download it", before]);
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

  it("opens and closes the navigation of a narrow window with its button, with Escape and with a click beside it", async () => {
    await openWith(APP);
    const navigation = () => [page.id("sidenav").classList.contains("open"), page.id("navToggle").getAttribute("aria-expanded"), page.id("scrim").hidden];
    expect(navigation()).toEqual([false, "false", true]);
    page.id("navToggle").press();
    expect(navigation()).toEqual([true, "true", false]);
    // Escape closes it and gives the focus back to its button.
    page.id("navList").children[1].focus();
    page.key("Escape");
    expect([navigation(), page.document.activeElement === page.id("navToggle")]).toEqual([[false, "false", true], true]);
    // The button closes it again; the scrim goes once it has faded.
    page.id("navToggle").press();
    page.id("navToggle").press();
    expect(navigation().slice(0, 2)).toEqual([false, "false"]);
    vi.advanceTimersByTime(210);
    expect(page.id("scrim").hidden).toBe(true);
    // A click beside it, on the scrim, closes it; so does choosing a table, which is then shown.
    page.id("navToggle").press();
    page.id("scrim").press();
    vi.advanceTimersByTime(210);
    expect(navigation()).toEqual([false, "false", true]);
    page.id("navToggle").press();
    goTo(3);
    vi.advanceTimersByTime(210);
    expect([navigation(), shows()[0]]).toEqual([[false, "false", true], "Grid Sections"]);
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

  it("copies the result's diagnostic log line for line from the details view", async () => {
    await openWith(APP);
    page.find('#navList [data-nav="details"]').press();
    const log = "14:02:05 Cardigan dev: app 01234567 on us1a.app.anaplan.com\n14:02:06 app: 2 pages\na line without a time";
    expect(page.id("diagLog").textContent).toBe(log);
    page.find('#view [data-act="copy-diag"]').press();
    await settle();
    expect([copied, page.id("toast").textContent]).toEqual([[log], "Copied the diagnostic log"]);
  });

  it("says what was copied as text, whatever the ID holds", async () => {
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
