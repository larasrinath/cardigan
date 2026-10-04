import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DETAILS_FILE } from "../analyse.js";
import { APP_ZIP_0_6_1 } from "../golden-0.6.1.test-support.js";
import { PORT_NAME, RESULTS_PAGE } from "../protocol.js";
import { resultZip, tableCsv } from "../result-zip.js";
import { UNSENT } from "../tab-port.js";
import { parseCsv, sameBytes, unzipText } from "../zip.test-support.js";
import { FakeElement, FakeInput, FakePage, FakeSelect } from "./dom.test-support.js";
import { APP_HOST, GOLDEN_APP, goldenApp, serveEngine, type EngineRun } from "./engine.test-support.js";
import { analysedLine } from "./keep-notes.js";
import { KEPT_PREFIX } from "./keep-result.js";
import { FakeTab } from "./port-pair.test-support.js";

// The results page itself against the engine: the page's script on results.html at one end of the port, the content
// script's real side around the real analysis of an app at the other, and Anaplan's answers scripted. From the address
// the icon gives the page to the bytes "Download all" saves, nothing in between is a stand-in but the browser.
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

/** Two zips are the same: file by file first, so that a difference shows as text, then every byte. */
function expectSameZip(saved: Uint8Array, expected: Uint8Array): void {
  expect(unzipText(saved)).toEqual(unzipText(expected));
  expect(sameBytes(saved, expected)).toBe(true);
}

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
  let saved: Blob[];
  /** What the tab's session storage holds, which a refresh of the page leaves as it is. Each test has its own. */
  let session: Map<string, string>;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    tab = new FakeTab();
    service = goldenApp();
    runs = serveEngine(tab, { host: APP_HOST, shows: { kind: "app", id: GOLDEN_APP } });
    connects = [];
    saved = [];
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
    vi.spyOn(URL, "createObjectURL").mockImplementation(blob => { saved.push(blob as Blob); return "blob:saved"; });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
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
  const bytes = async (blob: Blob): Promise<Uint8Array> => new Uint8Array(await blob.arrayBuffer());
  /** Saves what "Download all" gives, and returns its name and bytes. */
  const downloadAll = async (): Promise<[string, Uint8Array]> => {
    page.id("dlAll").press();
    return [page.downloads[page.downloads.length - 1].name, await bytes(saved[saved.length - 1])];
  };
  /** The navigation's tables: each one's name and number of rows. */
  const navigation = (): string[][] => page.all("#navList .nav-item").filter(item => item.querySelector(".cnt")).map(item => item.children.map(child => child.textContent));

  it("runs by itself for the page the icon has just opened, shows what the engine found, and saves the engine's own zip", async () => {
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

    // "Download all" saves the engine's result as its zip, byte for byte, under its name; file for file it is the zip 0.6.1 wrote.
    const [name, zip] = await downloadAll();
    expect(name).toBe("Planning app - App Export - 2026-09-28.zip");
    expectSameZip(zip, resultZip(result, NOW));
    expect(files(zip, DETAILS_FILE)).toEqual(files(APP_ZIP_0_6_1, DETAILS_FILE));
    // "Download this table" saves the table on screen as the engine's own CSV.
    page.id("dlCsv").press();
    expect([page.downloads[1].name, `\ufeff${await saved[1].text()}`]).toEqual(["Cards.csv", tableCsv(cards)]);
  });

  it("keeps the result on the page while the engine runs again, and through a run whose result cannot be sent", async () => {
    await open(clicked);
    await until(shown("Planning: app"), "the result on the page");
    const first = resultZip(runs[0].result!, NOW);

    // Run again, a minute later and with the app renamed meanwhile; Anaplan's answer about the board is slow.
    const later = new Date(NOW.getTime() + 65_000);
    vi.setSystemTime(later);
    service.name = "Planning: app, renamed";
    const board = service.hold(BOARD);
    page.id("runAgain").press();
    await until(() => board.waiting === 1, "the second run to reach the board");
    await tab.quiet();
    // The engine is in the middle of its second run. The page shows where that run is, above the first result, which is
    // all still there and is what the downloads give, with the time it was complete at.
    expect([page.id("bannerText").textContent, page.id("banners").textContent.includes("The results below are from the earlier run.")])
      .toEqual(["Reading page 1 of 2: Demand board", true]);
    expect([page.document.title, navigation().length, page.id("runAgain").disabled, page.id("dlAll").disabled]).toEqual(["Cardigan — Planning: app", 7, true, false]);
    expectSameZip((await downloadAll())[1], first);

    // Only when the engine's new result is whole does it take the first one's place.
    board.release();
    await until(shown("Planning: app, renamed"), "the second result on the page");
    expect([runs.length, page.id("banners").children, tab.ports.length]).toEqual([2, [], 1]);
    const second = resultZip(runs[1].result!, later);
    const [renamed, zip] = await downloadAll();
    expect(renamed).toBe("Planning app, renamed - App Export - 2026-09-28.zip");
    expectSameZip(zip, second);
    expect(sameBytes(second, first)).toBe(false);

    // On the next run Chrome refuses a piece of the result: an error comes in place of "done". The page shows nothing of
    // what did arrive as a result: the second result stays, and the engine's sentence stands above it.
    service.name = "Planning: app, renamed again";
    tab.ports[0].tab.refuses = message => (message as { type?: string; table?: number }).type === "rows" && (message as { table?: number }).table === 2;
    page.id("runAgain").press();
    await until(() => page.has("#runBanner") && page.id("runBanner").classList.contains("warn"), "the failure on the page");
    expect([runs.length, runs[2].result?.name]).toEqual([3, "Planning: app, renamed again"]);
    expect([page.id("bannerText").textContent, page.id("bannerHint").hidden, page.id("bannerCopy").hidden]).toEqual([UNSENT, true, false]);
    expect([page.document.title, page.id("runAgain").disabled]).toEqual(["Cardigan — Planning: app, renamed", false]);
    const [kept, still] = await downloadAll();
    expect(kept).toBe("Planning app, renamed - App Export - 2026-09-28.zip");
    expectSameZip(still, second);
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
    expectSameZip((await downloadAll())[1], resultZip(runs[0].result!, NOW));
  });
  it("brings the engine's result back after a refresh of the page, without asking the engine, and saves the same zip", async () => {
    await open(clicked);
    await until(shown("Planning: app"), "the result on the page");
    // The page keeps the result once it has drawn it; the storage holds nothing but the keeper's own keys.
    const head = (): string | undefined => session.get(`${KEPT_PREFIX}head`);
    await until(head, "the result to be kept");
    const first = head();
    expect([...session.keys()].filter(key => !key.startsWith(KEPT_PREFIX))).toEqual([]);
    const [name, before] = await downloadAll();
    expectSameZip(before, resultZip(runs[0].result!, NOW));

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
    // "Download all" saves the same bytes as before the refresh: the engine's result, with the time it was complete at.
    const [again, after] = await downloadAll();
    expect(again).toBe(name);
    expectSameZip(after, before);
    expect(files(after, DETAILS_FILE)).toEqual(files(APP_ZIP_0_6_1, DETAILS_FILE));
    expect(service.reads).toHaveLength(reads);

    // Run again asks the engine, on the port the page opened when it loaded, and the new result takes the kept one's place.
    service.name = "Planning: app, renamed";
    page.id("runAgain").press();
    await until(shown("Planning: app, renamed"), "the second result on the page");
    expect([runs.length, tab.ports.length, tab.ports[1].tab.heard, page.id("banners").children]).toEqual([2, 2, [{ type: "run" }], []]);
    await until(() => head() !== undefined && head() !== first, "the second result to be kept");
    await open("?tab=42");
    await until(shown("Planning: app, renamed"), "the second result to come back");
    expectSameZip((await downloadAll())[1], resultZip(runs[1].result!, later));
    expect(runs).toHaveLength(2);
  });
});
