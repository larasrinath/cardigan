import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RESULTS_PAGE, TAB_PARAM } from "./protocol.js";

const EXTENSION = "chrome-extension://abcdefghijklmnopabcdefghijklmnop";

/** Just enough of `chrome` for the worker: it keeps the click listeners registered with it and the tabs it is asked for. */
class FakeChrome {
  readonly listeners: ((tab: chrome.tabs.Tab) => void)[] = [];
  readonly created: unknown[] = [];
  readonly action = { onClicked: { addListener: (listener: (tab: chrome.tabs.Tab) => void) => { this.listeners.push(listener); } } };
  readonly runtime = { getURL: (path: string) => `${this.origin}/${path}` };
  readonly tabs = { create: async (properties: unknown): Promise<chrome.tabs.Tab> => { this.created.push(properties); return { id: 99, index: 0 }; } };
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
  afterEach(() => { vi.unstubAllGlobals(); });

  it("opens the results page right after the clicked tab, with the tab's ID in the address and the tab as its opener", async () => {
    const { openResults } = await import("./background.js");
    // Through the API it is given, not the global one.
    const api = new FakeChrome("chrome-extension://ponmlkjihgfedcbaponmlkjihgfedcba");
    await openResults(api, { id: 412, index: 3 });
    expect(api.created).toEqual([{ url: "chrome-extension://ponmlkjihgfedcbaponmlkjihgfedcba/results.html?tab=412", index: 4, openerTabId: 412 }]);
    expect(browser.created).toEqual([]);
    // The address is the protocol's: the page named there, and the tab's ID where the page reads it.
    const address = new URL((api.created[0] as { url: string }).url);
    expect([address.pathname, address.search, address.searchParams.get(TAB_PARAM)]).toEqual([`/${RESULTS_PAGE}`, "?tab=412", "412"]);
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
    click({ id: 7, index: 0 });
    click({ index: 1 });
    click({ id: 9, index: 5 });
    expect(browser.created).toEqual([
      { url: `${EXTENSION}/results.html?tab=7`, index: 1, openerTabId: 7 },
      { url: `${EXTENSION}/results.html?tab=9`, index: 6, openerTabId: 9 },
    ]);
  });
});
