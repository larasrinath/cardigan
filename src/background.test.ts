import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ABOUT_PAGE, FIND_RESULTS, FRESH_MS, OPENED_PARAM, RESULTS_PAGE, REUSE_RESULTS, TAB_PARAM } from "./protocol.js";

const EXTENSION = "chrome-extension://abcdefghijklmnopabcdefghijklmnop";
/** When the icon is clicked, as Date.now() gives it. */
const CLICKED = Date.UTC(2026, 8, 28, 1, 59, 9);

interface Manifest { version: string; icons: Record<string, string>; action: { default_title: string; default_icon: Record<string, string> }; background: { service_worker: string } }
const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8")) as Manifest;

/** One item of the toolbar icon's menu, as the worker asks Chrome to make it. */
type MenuItem = { id: string; title: string; contexts: "action"[]; enabled?: boolean };

/** Just enough of `chrome` for the worker: it keeps the listeners registered with it, the tabs it is asked for, the icon's
 * title and the items of the icon's menu, in the order Chrome is asked for them. */
class FakeChrome {
  readonly messages: unknown[] = [];
  readonly activated: unknown[] = [];
  readonly focused: unknown[] = [];
  answer: (message: unknown) => Promise<unknown> = async () => undefined;
  readonly windows = { update: async (id: number, info: unknown) => { this.focused.push([id, info]); } };
  readonly listeners: ((tab: chrome.tabs.Tab) => void)[] = [];
  readonly installed: (() => void)[] = [];
  readonly started: (() => void)[] = [];
  readonly chosen: ((info: chrome.contextMenus.OnClickData) => void)[] = [];
  readonly created: unknown[] = [];
  /** What the worker asked of the icon's title and menu, in order. */
  readonly asked: unknown[] = [];
  /** The menu's items as Chrome holds them. */
  menu: MenuItem[] = [];
  /** Why Chrome refuses the icon's title, when it does. */
  titleRefusal: Error | undefined;
  readonly action = {
    onClicked: { addListener: (listener: (tab: chrome.tabs.Tab) => void) => { this.listeners.push(listener); } },
    setTitle: async (details: { title: string }): Promise<void> => {
      this.asked.push(["setTitle", details]);
      if (this.titleRefusal) throw this.titleRefusal;
    },
  };
  readonly contextMenus = {
    create: (properties: MenuItem, callback?: () => void): string => {
      this.asked.push(["create", properties]);
      this.menu.push(properties);
      callback?.();
      return properties.id;
    },
    removeAll: (callback?: () => void): void => {
      this.asked.push(["removeAll"]);
      this.menu = [];
      callback?.();
    },
    onClicked: { addListener: (listener: (info: chrome.contextMenus.OnClickData) => void) => { this.chosen.push(listener); } },
  };
  readonly runtime = {
    sendMessage: (message: unknown) => { this.messages.push(message); return this.answer(message); },
    getURL: (path: string) => `${this.origin}/${path}`,
    getManifest: () => ({ name: "Cardigan", version: manifest.version }),
    lastError: undefined as { message?: string } | undefined,
    onInstalled: { addListener: (listener: () => void) => { this.installed.push(listener); } },
    onStartup: { addListener: (listener: () => void) => { this.started.push(listener); } },
  };
  /** Why Chrome opens no tab, when it does not: the clicked tab's window has just closed, say. */
  refusal: Error | undefined;
  readonly tabs = { update: async (id: number, info: unknown) => { this.activated.push([id, info]); return { id, index: 0, windowId: 81 }; }, create: async (properties: unknown): Promise<chrome.tabs.Tab> => {
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
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(CLICKED);
    browser = new FakeChrome();
    vi.stubGlobal("chrome", browser);
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); vi.restoreAllMocks(); });

  it("is named in the manifest, behind a toolbar icon that has a title, the extension's icons and no popup", () => {
    // A popup would take the click: Chrome tells the worker only about a click on an icon that has none. The title is the
    // name alone: the worker adds the version to it as it starts (below).
    expect(manifest.action).toEqual({
      default_title: "Cardigan",
      default_icon: { 16: "icons/16.png", 32: "icons/32.png", 48: "icons/48.png", 128: "icons/128.png" },
    });
    expect(manifest.action.default_icon).toEqual(manifest.icons);
    expect(manifest.background).toEqual({ service_worker: "dist/background.js" });
  });

  it("opens the results page right after the clicked tab, in its window, with the tab as its opener and its ID and the time of the click in the address", async () => {
    const { openResults } = await import("./background.js");
    // Through the API it is given, not the global one.
    const api = new FakeChrome("chrome-extension://ponmlkjihgfedcbaponmlkjihgfedcba");
    await openResults(api, { id: 412, index: 3, windowId: 28 });
    expect(api.created).toStrictEqual([{ url: `chrome-extension://ponmlkjihgfedcbaponmlkjihgfedcba/results.html?tab=412&opened=${CLICKED}`, index: 4, openerTabId: 412, windowId: 28 }]);
    expect(browser.created).toEqual([]);
    // The address is the protocol's: the page named there, the tab's ID and when the icon was clicked, each where the page reads it.
    const address = new URL((api.created[0] as { url: string }).url);
    expect([address.pathname, address.search, address.searchParams.get(TAB_PARAM), address.searchParams.get(OPENED_PARAM)])
      .toEqual([`/${RESULTS_PAGE}`, "?tab=412&opened=1790560749000", "412", "1790560749000"]);
    // By that the page knows the icon has just opened it: a number it reads back, less than FRESH_MS old.
    expect(Date.now() - Number(address.searchParams.get(OPENED_PARAM))).toBeLessThan(FRESH_MS);

    // Chrome places the tab itself when the clicked tab names no window: none is passed, not even an empty one.
    await openResults(api, { id: 413, index: 0 });
    expect(api.created[1]).toStrictEqual({ url: `chrome-extension://ponmlkjihgfedcbaponmlkjihgfedcba/results.html?tab=413&opened=${CLICKED}`, index: 1, openerTabId: 413 });
    // Each click carries its own time.
    vi.setSystemTime(CLICKED + 61_000);
    await openResults(api, { id: 412, index: 3, windowId: 28 });
    expect((api.created[2] as { url: string }).url).toBe(`chrome-extension://ponmlkjihgfedcbaponmlkjihgfedcba/results.html?tab=412&opened=${CLICKED + 61_000}`);
  });

  it("opens nothing for a tab without an ID", async () => {
    const { openResults } = await import("./background.js");
    await openResults(browser, { index: 2 });
    // chrome.tabs.TAB_ID_NONE
    await openResults(browser, { id: -1, index: 2 });
    expect(browser.created).toEqual([]);
  });

  it.each([false, true])("brings the answering results tab and its window forward; running=%s", async running => {
    const { openResults } = await import("./background.js");
    browser.answer = async () => ({ tabId: 7, resultsTabId: 90, running });
    await openResults(browser, { id: 7, index: 1, windowId: 2 });
    expect(browser.messages).toEqual([{ type: FIND_RESULTS, tabId: 7 }, ...(running ? [] : [{ type: REUSE_RESULTS, tabId: 7, resultsTabId: 90 }])]);
    expect(browser.activated).toEqual([[90, { active: true }]]);
    expect(browser.focused).toEqual([[81, { focused: true }]]);
    expect(browser.created).toEqual([]);
  });

  it("opens a new page after 300 ms and a late probe answer cannot start a run", async () => {
    vi.useFakeTimers();
    const { openResults } = await import("./background.js");
    let answer!: (value: unknown) => void;
    browser.answer = () => new Promise(resolve => { answer = resolve; });
    const clicked = openResults(browser, { id: 7, index: 1 });
    await vi.advanceTimersByTimeAsync(299);
    expect(browser.created).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    await clicked;
    expect(browser.created).toHaveLength(1);
    answer({ tabId: 7, resultsTabId: 90, running: false });
    await Promise.resolve();
    expect(browser.messages).toEqual([{ type: FIND_RESULTS, tabId: 7 }]);
    expect(browser.activated).toEqual([]);
  });

  it("rejects an answer for another Anaplan tab and handles a missing or closed receiver", async () => {
    const { openResults } = await import("./background.js");
    browser.answer = async () => ({ tabId: 8, resultsTabId: 90, running: false });
    await openResults(browser, { id: 7, index: 1 });
    browser.answer = async () => { throw new Error("No receiver"); };
    await openResults(browser, { id: 7, index: 1 });
    browser.answer = async () => ({ tabId: 7, resultsTabId: 90, running: false });
    browser.tabs.update = async () => { throw new Error("Tab closed"); };
    await openResults(browser, { id: 7, index: 1 });
    expect(browser.created).toHaveLength(3);
    expect(browser.activated).toEqual([]);
  });

  it("listens for the icon's click as it starts, and opens the page for every click", async () => {
    await import("./background.js");
    expect(browser.listeners).toHaveLength(1);
    const click = browser.listeners[0];
    click({ id: 7, index: 0, windowId: 2 });
    click({ index: 1, windowId: 2 });
    click({ id: 9, index: 5, windowId: 3 });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(browser.created).toEqual([
      { url: `${EXTENSION}/results.html?tab=7&opened=${CLICKED}`, index: 1, openerTabId: 7, windowId: 2 },
      { url: `${EXTENSION}/results.html?tab=9&opened=${CLICKED}`, index: 6, openerTabId: 9, windowId: 3 },
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
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(browser.created).toHaveLength(1);
  });

  it("gives the toolbar icon the version as its title, and its menu About Cardigan and the version, as Cardigan is installed and as the browser starts", async () => {
    const { ABOUT_ITEM, VERSION_ITEM } = await import("./background.js");
    // Nothing is asked of Chrome until it says Cardigan was installed or the browser started.
    expect([browser.installed.length, browser.started.length, browser.chosen.length, browser.asked]).toEqual([1, 1, 1, []]);
    browser.installed[0]();
    // The title and the menu say the version the manifest gives, Cardigan's one record of it. The menu is made afresh, its
    // last items removed first: About Cardigan, then the version, which does nothing when chosen and is greyed out.
    const version = manifest.version;
    expect(browser.asked).toEqual([
      ["setTitle", { title: `Cardigan ${version}` }],
      ["removeAll"],
      ["create", { id: ABOUT_ITEM, title: "About Cardigan", contexts: ["action"] }],
      ["create", { id: VERSION_ITEM, title: `Version ${version}`, contexts: ["action"], enabled: false }],
    ]);
    // Only the icon's menu: no page or link of any site gets an item.
    expect(browser.menu.flatMap(item => item.contexts)).toEqual(["action", "action"]);
    // As the browser starts it does the same, and the menu still holds the two items once each.
    browser.started[0]();
    expect([browser.asked.length, browser.menu.map(item => item.title)]).toEqual([8, ["About Cardigan", `Version ${version}`]]);
  });

  it("takes a title Chrome refuses as the end of it: no unhandled rejection, and the menu is made all the same", async () => {
    const unhandled: unknown[] = [];
    const rejected = (reason: unknown) => { unhandled.push(reason); };
    process.on("unhandledRejection", rejected);
    browser.titleRefusal = new Error("The extension is being reloaded.");
    await import("./background.js");
    browser.installed[0]();
    await new Promise(resolve => setTimeout(resolve, 10));
    process.off("unhandledRejection", rejected);
    expect([unhandled, browser.menu.length]).toEqual([[], 2]);
  });

  it("opens the About page in a new tab when About Cardigan is chosen, and nothing for any other item", async () => {
    const { ABOUT_ITEM, VERSION_ITEM, chooseItem } = await import("./background.js");
    browser.chosen[0]({ menuItemId: ABOUT_ITEM });
    browser.chosen[0]({ menuItemId: VERSION_ITEM });
    browser.chosen[0]({ menuItemId: "another extension's item" });
    expect(browser.created).toEqual([{ url: `${EXTENSION}/${ABOUT_PAGE}` }]);
    // Through the API it is given, not the global one; a tab Chrome does not open goes to the worker's console.
    const api = new FakeChrome("chrome-extension://ponmlkjihgfedcbaponmlkjihgfedcba");
    await chooseItem(api, { menuItemId: ABOUT_ITEM });
    expect(api.created).toEqual([{ url: "chrome-extension://ponmlkjihgfedcbaponmlkjihgfedcba/about.html" }]);
    const warned = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    browser.refusal = new Error("No current window.");
    browser.chosen[0]({ menuItemId: ABOUT_ITEM });
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(warned.mock.calls).toEqual([["Cardigan could not open the About page:", browser.refusal]]);
  });
});
