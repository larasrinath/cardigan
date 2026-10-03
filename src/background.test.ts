import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RESULTS_PAGE, TAB_PARAM } from "./protocol.js";

const EXTENSION = "chrome-extension://abcdefghijklmnopabcdefghijklmnop";

interface Manifest { icons: Record<string, string>; action: { default_title: string; default_icon: Record<string, string> }; background: { service_worker: string } }
const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8")) as Manifest;

/** Just enough of `chrome` for the worker: it keeps the click listeners registered with it and the tabs it is asked for. */
class FakeChrome {
  readonly listeners: ((tab: chrome.tabs.Tab) => void)[] = [];
  readonly created: unknown[] = [];
  readonly action = { onClicked: { addListener: (listener: (tab: chrome.tabs.Tab) => void) => { this.listeners.push(listener); } } };
  readonly runtime = { getURL: (path: string) => `${this.origin}/${path}` };
  /** Why Chrome opens no tab, when it does not: the clicked tab's window has just closed, say. */
  refusal: Error | undefined;
  readonly tabs = { create: async (properties: unknown): Promise<chrome.tabs.Tab> => {
    if (this.refusal) throw this.refusal;
    this.created.push(properties);
    return { id: 99, index: 0 };
  } };
  constructor(private readonly origin = EXTENSION) {}
}

// The worker runs on import; each test imports it afresh against a fake `chrome`.
describe("Toolbar icon's service worker", () => {
  let browser: FakeChrome;

  beforeEach(() => {
    vi.resetModules();
    browser = new FakeChrome();
    vi.stubGlobal("chrome", browser);
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it("is named in the manifest, behind a toolbar icon that has a title, the extension's icons and no popup", () => {
    // A popup would take the click: Chrome tells the worker only about a click on an icon that has none.
    expect(manifest.action).toEqual({
      default_title: "Cardigan: analyse this Anaplan app or model",
      default_icon: { 16: "icons/16.png", 32: "icons/32.png", 48: "icons/48.png", 128: "icons/128.png" },
    });
    expect(manifest.action.default_icon).toEqual(manifest.icons);
    expect(manifest.background).toEqual({ service_worker: "dist/background.js" });
  });

  it("opens the results page right after the clicked tab, in its window, with the tab's ID in the address and the tab as its opener", async () => {
    const { openResults } = await import("./background.js");
    // Through the API it is given, not the global one.
    const api = new FakeChrome("chrome-extension://ponmlkjihgfedcbaponmlkjihgfedcba");
    await openResults(api, { id: 412, index: 3, windowId: 28 });
    expect(api.created).toStrictEqual([{ url: "chrome-extension://ponmlkjihgfedcbaponmlkjihgfedcba/results.html?tab=412", index: 4, openerTabId: 412, windowId: 28 }]);
    expect(browser.created).toEqual([]);
    // The address is the protocol's: the page named there, and the tab's ID where the page reads it.
    const address = new URL((api.created[0] as { url: string }).url);
    expect([address.pathname, address.search, address.searchParams.get(TAB_PARAM)]).toEqual([`/${RESULTS_PAGE}`, "?tab=412", "412"]);

    // Chrome places the tab itself when the clicked tab names no window: none is passed, not even an empty one.
    await openResults(api, { id: 413, index: 0 });
    expect(api.created[1]).toStrictEqual({ url: "chrome-extension://ponmlkjihgfedcbaponmlkjihgfedcba/results.html?tab=413", index: 1, openerTabId: 413 });
  });

  it("opens nothing for a tab without an ID", async () => {
    const { openResults } = await import("./background.js");
    await openResults(browser, { index: 2 });
    // chrome.tabs.TAB_ID_NONE
    await openResults(browser, { id: -1, index: 2 });
    expect(browser.created).toEqual([]);
  });

  it("listens for the icon's click as it starts, and opens the page for every click", async () => {
    await import("./background.js");
    expect(browser.listeners).toHaveLength(1);
    const click = browser.listeners[0];
    click({ id: 7, index: 0, windowId: 2 });
    click({ index: 1, windowId: 2 });
    click({ id: 9, index: 5, windowId: 3 });
    expect(browser.created).toEqual([
      { url: `${EXTENSION}/results.html?tab=7`, index: 1, openerTabId: 7, windowId: 2 },
      { url: `${EXTENSION}/results.html?tab=9`, index: 6, openerTabId: 9, windowId: 3 },
    ]);
  });

  it("takes a results tab that cannot be opened as the end of the click: the reason goes to the worker's console, not to an unhandled rejection", async () => {
    const unhandled: unknown[] = [];
    const rejected = (reason: unknown) => { unhandled.push(reason); };
    process.on("unhandledRejection", rejected);
    const warned = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { openResults } = await import("./background.js");
    browser.refusal = new Error("No window with id: 2.");
    browser.listeners[0]({ id: 7, index: 0, windowId: 2 });
    // Node reports a rejection nothing handled once the turn it was made in has ended.
    await new Promise(resolve => setTimeout(resolve, 10));
    process.off("unhandledRejection", rejected);
    expect(unhandled).toEqual([]);
    expect(warned.mock.calls).toEqual([["Cardigan could not open the results page:", browser.refusal]]);
    // Whoever calls openResults itself is still told.
    await expect(openResults(browser, { id: 7, index: 0, windowId: 2 })).rejects.toBe(browser.refusal);
    // The next click is served as any other.
    browser.refusal = undefined;
    browser.listeners[0]({ id: 7, index: 0, windowId: 2 });
    expect(browser.created).toHaveLength(1);
  });
});
