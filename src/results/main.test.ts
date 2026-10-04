import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FRESH_MS, PORT_NAME, RESULTS_PAGE, type TabMessage } from "../protocol.js";
import type { AnalysisResult } from "../result-types.js";
import { resultZip } from "../result-zip.js";
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
/** The same app, with that tag in the Cards table's name and in a card's title. */
const NAMED: AnalysisResult = {
  ...RESULT, tables: [RESULT.tables[0], RESULT.tables[1], { ...RESULT.tables[2], label: `Cards ${TAG}`,
    rows: [["Overview", 1, `Sales ${TAG}`, "Grid", "card-a"], ["Overview", 2, "=Margin", "KPI", "card-b"]] }],
};

describe("The results page's script, on the page", () => {
  let page: FakePage;
  let ports: FakePort[];
  let connects: unknown[][];
  let saved: Blob[];
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
    lastError = undefined;
    replaced = [];
    fixedAddress = false;
    vi.stubGlobal("history", { state: null, replaceState: (_state: unknown, _unused: string, address: string) => {
      if (fixedAddress) throw new Error("The address cannot be changed.");
      replaced.push(address);
      location.search = address.includes("?") ? address.slice(address.indexOf("?")) : "";
    } });
    vi.stubGlobal("window", { matchMedia: () => ({ matches: false, addEventListener: () => undefined }), scrollTo: () => undefined, innerWidth: 1280, innerHeight: 800 });
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => undefined });
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
    // The notes: the summary, and the Notes rows of the Details file.
    expect(page.id("banners").textContent).toContain("1 of 1 pages analysed, 2 cards.");
    expect(page.id("banners").textContent).toContain("Archive: Not published");
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

  it("runs again when asked: on the same port after a result, and the old result leaves the page", async () => {
    await openWith();
    page.id("runAgain").press();
    expect(connects).toHaveLength(1);
    expect(ports[0].posted).toEqual([{ type: "run" }, { type: "run" }]);
    expect(page.id("runStatus").textContent).toBe("Starting the analysis…");
    expect(["hdMeta", "banners", "navList"].map(id => page.id(id).innerHTML)).toEqual(["", "", ""]);
    expect(page.document.title).toBe("Cardigan");
    expect(disabled("runAgain", "dlAll")).toEqual([true, true]);
    // Nothing is downloaded while there is no result.
    page.id("dlAll").press();
    page.id("dlCsv").press();
    expect(saved).toEqual([]);
  });

  it("opens a row and a card whose table and title hold a tag, and shows both names as text", async () => {
    await openWith(NAMED);
    page.find('#navList [data-nav="2"]').press();
    expect(page.texts("#view h1")).toEqual([`Cards ${TAG}`]);
    // A click on a row, outside its links, opens the row. The line under the drawer's title is the table's name.
    page.find("#tableWrap tbody tr .tag").press();
    expect(page.id("drawer").hidden).toBe(false);
    expect([page.id("drawerTitle").textContent, page.id("drawerSub").textContent]).toEqual(["Row 1", `Cards ${TAG}`]);
    expect(page.id("drawerSub").children).toEqual([]);
    expect(page.texts("#drawerBody dd")).toContain(`Sales ${TAG}`);
    // A card's number opens the card. The drawer's title is the card's own title.
    page.id("drawerClose").press();
    page.find('#tableWrap tbody [data-act="card"]').press();
    expect(page.id("drawerTitle").textContent).toBe(`Card 1 — Sales ${TAG}`);
    expect(page.id("drawerTitle").children).toEqual([]);
    expect(page.texts("#drawerSub .link")).toEqual(["Overview"]);
    // Neither name became an element, anywhere on the page.
    expect([page.has("img"), page.all("[onerror]")]).toEqual([false, []]);
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
