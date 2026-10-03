import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PORT_NAME, type TabMessage } from "../protocol.js";
import type { AnalysisResult } from "../result-types.js";
import { resultZip } from "../result-zip.js";
import { PAGE_IDS } from "./page-ids.js";

/** Just enough of an element for the page's script: what it sets, what it listens to and what it asks. */
class FakeElement {
  hidden = false;
  disabled = false;
  textContent = "";
  title = "";
  href = "";
  download = "";
  value = "";
  scrollTop = 0;
  scrollHeight = 0;
  clicks = 0;
  readonly dataset: Record<string, string> = {};
  readonly style: Record<string, string> = {};
  readonly classes = new Set<string>();
  readonly classList = {
    add: (name: string) => { this.classes.add(name); },
    remove: (name: string) => { this.classes.delete(name); },
    contains: (name: string) => this.classes.has(name),
    toggle: (name: string) => (this.classes.has(name) ? (this.classes.delete(name), false) : (this.classes.add(name), true)),
  };
  private html = "";
  private readonly listeners = new Map<string, () => void>();
  constructor(private readonly page: FakePage) {}
  get innerHTML(): string { return this.html; }
  /** New markup replaces whatever was looked up inside the old one. */
  set innerHTML(html: string) { this.html = html; this.page.found.clear(); }
  addEventListener(type: string, listener: () => void) { this.listeners.set(type, listener); }
  /** What the user's click does: runs the listener the script put on the element. */
  press() { this.listeners.get("click")?.(); }
  click() { this.clicks++; }
  setAttribute() { /* not looked at */ }
  appendChild() { /* not looked at */ }
  remove() { /* not looked at */ }
  focus() { /* not looked at */ }
  select() { /* not looked at */ }
  contains() { return false; }
}

/** The page as results.html gives it to the script: its own elements by ID, and the ones the script writes into them. */
class FakePage {
  readonly byId = new Map<string, FakeElement>(PAGE_IDS.map(id => [id, new FakeElement(this)]));
  readonly found = new Map<string, FakeElement>();
  readonly created: FakeElement[] = [];
  readonly document = {
    title: "",
    activeElement: null,
    documentElement: new FakeElement(this),
    body: new FakeElement(this),
    getElementById: (id: string) => this.byId.get(id) ?? null,
    /** An element the script wrote: there only while some markup on the page holds its ID. */
    querySelector: (selector: string) => {
      const id = /^#([A-Za-z]+)$/.exec(selector)?.[1];
      if (!id || ![...this.byId.values()].some(element => element.innerHTML.includes(`id="${id}"`))) return null;
      if (!this.found.has(id)) this.found.set(id, new FakeElement(this));
      return this.found.get(id);
    },
    createElement: () => {
      const element = new FakeElement(this);
      this.created.push(element);
      return element;
    },
    addEventListener: () => undefined,
    contains: () => false,
  };
  id(id: string): FakeElement { return this.byId.get(id)!; }
  written(id: string): FakeElement { return this.document.querySelector(`#${id}`)!; }
}

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

describe("The results page's script, on the page", () => {
  let page: FakePage;
  let ports: FakePort[];
  let connects: unknown[][];
  let saved: Blob[];
  let lastError: { message?: string } | undefined;

  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    page = new FakePage();
    ports = [];
    connects = [];
    saved = [];
    lastError = undefined;
    vi.stubGlobal("document", page.document);
    vi.stubGlobal("window", { matchMedia: () => ({ matches: false, addEventListener: () => undefined }), scrollTo: () => undefined, innerWidth: 1280, innerHeight: 800 });
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => undefined });
    vi.stubGlobal("HTMLElement", FakeElement);
    vi.stubGlobal("requestAnimationFrame", (callback: () => void) => { callback(); return 0; });
    vi.stubGlobal("chrome", {
      tabs: { connect: (...args: unknown[]) => { connects.push(args); const port = new FakePort(); ports.push(port); return port; } },
      runtime: { get lastError() { return lastError; } },
    });
    vi.spyOn(URL, "createObjectURL").mockImplementation(blob => { saved.push(blob as Blob); return "blob:saved"; });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  const open = async (search: string) => {
    vi.stubGlobal("location", { search });
    await import("./main.js");
  };
  const bytes = async (blob: Blob) => new Uint8Array(await blob.arrayBuffer());
  const sendResult = (port: FakePort) => {
    port.send({ type: "result", result: { ...RESULT, tables: RESULT.tables.map(table => ({ ...table, rows: [] })) } });
    RESULT.tables.forEach((table, index) => port.send({ type: "rows", table: index, rows: table.rows }));
    port.send({ type: "done" });
  };

  it("connects to the tab its address names, lets the analysis run by itself, shows the progress and then the result", async () => {
    await open("?tab=42");
    expect(page.id("version").textContent).toBe("vdev");
    expect(connects).toEqual([[42, { name: PORT_NAME }]]);
    expect(page.written("runStatus").textContent).toBe("Connecting to the Anaplan tab…");
    expect(ports[0].posted).toEqual([]);

    // The tab says what it shows: the page asks for the analysis at once, without a click.
    ports[0].send({ type: "subject", subject: { kind: "app", id: RESULT.id } });
    expect(ports[0].posted).toEqual([{ type: "run" }]);
    expect([page.written("runTitle").textContent, page.written("runStatus").textContent]).toEqual(["Analysing", "Starting the analysis…"]);
    expect([page.id("runAgain").disabled, page.id("dlAll").disabled, page.id("dlCsv").disabled]).toEqual([true, true, true]);
    expect(page.id("sidenav").hidden).toBe(true);

    ports[0].send({ type: "status", text: "Reading page 1 of 1: Overview" });
    ports[0].send({ type: "log", text: "14:02:05 Reading page 1 of 1: Overview" });
    ports[0].send({ type: "log", text: "14:02:06 <b>app</b>: 1 page" });
    expect(page.written("runStatus").textContent).toBe("Reading page 1 of 1: Overview");
    expect(page.written("diagLog").textContent).toBe("14:02:05 Reading page 1 of 1: Overview\n14:02:06 <b>app</b>: 1 page");
    expect(page.written("runLog").hidden).toBe(false);

    sendResult(ports[0]);
    expect(page.document.title).toBe("Cardigan — Demo <img src=x onerror=alert(1)> app");
    // The header says what was analysed, as text: the name's own tag is not one on the page.
    expect(page.id("hdMeta").innerHTML).toContain("Demo &lt;img src=x onerror=alert(1)&gt; app");
    expect(page.id("hdMeta").innerHTML).not.toContain("<img");
    expect(page.id("hdMeta").innerHTML).toContain("us1a.app.anaplan.com");
    // The notes: the summary, and the Notes rows of the Details file.
    expect(page.id("banners").innerHTML).toContain("1 of 1 pages analysed, 2 cards.");
    expect(page.id("banners").innerHTML).toContain("Archive: Not published");
    // One navigation entry per file, the Details file as Details, and the model map as coming later.
    const nav = page.id("navList").innerHTML;
    expect([...nav.matchAll(/data-nav="([^"]*)"/g)].map(match => match[1])).toEqual(["overview", "1", "2", "details", "map"]);
    expect(nav).toContain("Model map is coming in a later version");
    expect(page.id("view").innerHTML).toContain("<h1 class=\"view-title\">Overview</h1>");
    expect(page.id("sidenav").hidden).toBe(false);
    // Downloads and Run again are there now; "this table" has no table on the overview.
    expect([page.id("runAgain").disabled, page.id("dlAll").disabled, page.id("dlCsv").disabled]).toEqual([false, false, true]);
  });

  it("downloads the result's zip under its own name, the same bytes however late and however often", async () => {
    await open("?tab=42");
    ports[0].send({ type: "subject", subject: { kind: "app", id: RESULT.id } });
    sendResult(ports[0]);
    page.id("dlAll").press();
    vi.setSystemTime(new Date(Date.UTC(2026, 9, 3, 18, 45, 0)));
    page.id("dlAll").press();
    expect(page.created.map(link => [link.download, link.href, link.clicks])).toEqual([[RESULT.zipName, "blob:saved", 1], [RESULT.zipName, "blob:saved", 1]]);
    expect(saved.map(blob => blob.type)).toEqual(["application/zip", "application/zip"]);
    const expected = resultZip(RESULT, NOW);
    expect(await bytes(saved[0])).toEqual(expected);
    expect(await bytes(saved[1])).toEqual(expected);
    expect(page.id("toast").textContent).toBe(`Downloaded ${RESULT.zipName}`);
  });

  it("runs again when asked: on the same port after a result, and the old result leaves the page", async () => {
    await open("?tab=42");
    ports[0].send({ type: "subject", subject: { kind: "app", id: RESULT.id } });
    sendResult(ports[0]);
    page.id("runAgain").press();
    expect(connects).toHaveLength(1);
    expect(ports[0].posted).toEqual([{ type: "run" }, { type: "run" }]);
    expect(page.written("runStatus").textContent).toBe("Starting the analysis…");
    expect([page.id("hdMeta").innerHTML, page.id("banners").innerHTML, page.id("navList").innerHTML]).toEqual(["", "", ""]);
    expect(page.document.title).toBe("Cardigan");
    expect([page.id("runAgain").disabled, page.id("dlAll").disabled]).toEqual([true, true]);
    // Nothing is downloaded while there is no result.
    page.id("dlAll").press();
    page.id("dlCsv").press();
    expect(saved).toEqual([]);
  });

  it("says so when the address names no tab, and connects to nothing", async () => {
    await open("");
    expect(connects).toEqual([]);
    expect([page.written("runTitle").textContent, page.written("runStatus").textContent]).toEqual(["No Anaplan tab", "This page was opened without an Anaplan tab to read."]);
    expect(page.id("runAgain").disabled).toBe(true);
    page.id("runAgain").press();
    expect(connects).toEqual([]);
  });

  it("says it cannot reach the tab when Chrome closes the port at once, with Chrome's reason in the log, and reconnects on Run again", async () => {
    await open("?tab=7");
    lastError = { message: "Could not establish connection. Receiving end does not exist." };
    ports[0].drop();
    lastError = undefined;
    expect([page.written("runStatus").textContent, page.written("runHint").textContent]).toEqual(
      ["Cardigan cannot reach that tab.", "If it is an Anaplan app or model, refresh it, then click the Cardigan icon again."]);
    expect(page.written("diagLog").textContent).toBe("14:02:05 The tab did not answer: Could not establish connection. Receiving end does not exist.");
    expect(page.id("runAgain").disabled).toBe(false);
    page.id("runAgain").press();
    expect(connects).toEqual([[7, { name: PORT_NAME }], [7, { name: PORT_NAME }]]);
  });

  it("shows the tab's error as text, and keeps Run again usable on an Anaplan page that is not an app or a model", async () => {
    await open("?tab=42");
    ports[0].send({ type: "subject", subject: { kind: "none" } });
    expect(page.written("runStatus").textContent).toBe("That Anaplan page is not an app or a model.");
    expect(page.id("runAgain").disabled).toBe(false);
    page.id("runAgain").press();
    expect(connects).toHaveLength(2);
    ports[1].send({ type: "subject", subject: { kind: "model", id: "0123456789ABCDEF0123456789ABCDEF" } });
    ports[1].send({ type: "error", message: "You're signed out of <b>Anaplan</b>. Sign in and try again.", code: "SIGNED_OUT" });
    expect([page.written("runTitle").textContent, page.written("runStatus").textContent]).toEqual(["The analysis stopped", "You're signed out of <b>Anaplan</b>. Sign in and try again."]);
    // The message was set as text, not written into the page's markup.
    expect(page.id("view").innerHTML).not.toContain("signed out");
  });
});
