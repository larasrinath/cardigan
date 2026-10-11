import { ABOUT_PAGE, OPENED_PARAM, RESULTS_PAGE, TAB_PARAM } from "./protocol.js";

/** The service worker behind the toolbar icon. A click opens the results page in a new tab right after the clicked one, in
 * the same window, with that tab's ID and the time of the click in the address; the page then asks the tab's content script
 * for the analysis (protocol.ts). The icon's own menu, the one Chrome shows on a right-click, gets two items of Cardigan's:
 * About Cardigan, which opens the About page in a new tab, and the version, greyed out, to read. The worker keeps no state,
 * so Chrome can stop it between clicks. Opening a tab takes no permission, and it never reads the clicked tab's address or
 * content; the menu's items take "contextMenus", which comes with no warning. */

/** chrome.tabs.TAB_ID_NONE: the ID Chrome gives a tab that is not a browser tab, such as a DevTools window. */
const TAB_ID_NONE = -1;

/** The IDs of Cardigan's items in the toolbar icon's menu. */
export const ABOUT_ITEM = "cardigan-about";
export const VERSION_ITEM = "cardigan-version";

/** The Chrome APIs a click uses. A test passes a fake. */
export interface ClickApi {
  runtime: Pick<typeof chrome.runtime, "getURL">;
  tabs: Pick<typeof chrome.tabs, "create">;
}

/** The Chrome APIs the icon's title and menu use. A test passes a fake. */
export interface MenuApi {
  runtime: Pick<typeof chrome.runtime, "getManifest" | "lastError">;
  action: Pick<typeof chrome.action, "setTitle">;
  contextMenus: Pick<typeof chrome.contextMenus, "create" | "removeAll">;
}

/** Opens the results page for `tab`: right after it in its window, and with it as the opener. The address names the tab and
 * says when the icon was clicked, by which the page knows that the icon has just opened it (protocol.ts `OPENED_PARAM`).
 * A tab without an ID gets none. */
export async function openResults(api: ClickApi, tab: chrome.tabs.Tab): Promise<void> {
  if (tab.id === undefined || tab.id === TAB_ID_NONE) return;
  await api.tabs.create({ url: `${api.runtime.getURL(RESULTS_PAGE)}?${TAB_PARAM}=${tab.id}&${OPENED_PARAM}=${Date.now()}`, index: tab.index + 1, openerTabId: tab.id,
    ...(tab.windowId === undefined ? {} : { windowId: tab.windowId }) });
}

/** Gives the toolbar icon the version Chrome holds Cardigan at, from the manifest, Cardigan's one record of it: as its
 * title, and in its menu under About Cardigan, as an item that does nothing when chosen. The menu is made afresh: Chrome
 * keeps an extension's items from one start to the next, and an update would otherwise find the last version's there.
 * What Chrome refuses is the end of it, and nothing more is said: the icon keeps the title the manifest gives it. */
export function showVersion(api: MenuApi): void {
  const { version } = api.runtime.getManifest();
  api.action.setTitle({ title: `Cardigan ${version}` }).catch(() => undefined);
  // Reading lastError tells Chrome the outcome was looked at, so a refusal leaves no warning in the worker's console.
  const done = (): void => { void api.runtime.lastError; };
  api.contextMenus.removeAll(() => {
    api.contextMenus.create({ id: ABOUT_ITEM, title: "About Cardigan", contexts: ["action"] }, done);
    api.contextMenus.create({ id: VERSION_ITEM, title: `Version ${version}`, contexts: ["action"], enabled: false }, done);
  });
}

/** What choosing an item of the icon's menu does: About Cardigan opens the About page in a new tab. The version does
 * nothing, and Chrome does not offer it. */
export async function chooseItem(api: ClickApi, info: chrome.contextMenus.OnClickData): Promise<void> {
  if (info.menuItemId === ABOUT_ITEM) await api.tabs.create({ url: api.runtime.getURL(ABOUT_PAGE) });
}

// Registered as the worker starts, which is what lets Chrome wake a stopped worker for a click. A tab Chrome does not open
// (the clicked tab or its window has just closed) is the end of that click: there is nothing left to open it for, and
// the reason goes to the worker's console.
chrome.action.onClicked.addListener(tab => { openResults(chrome, tab).catch(error => console.warn("Cardigan could not open the results page:", error)); });
// The title and the menu, as Cardigan is installed or updated, and as the browser starts: Chrome sets the icon's title back
// to the manifest's when it starts.
chrome.runtime.onInstalled.addListener(() => showVersion(chrome));
chrome.runtime.onStartup.addListener(() => showVersion(chrome));
chrome.contextMenus.onClicked.addListener(info => { chooseItem(chrome, info).catch(error => console.warn("Cardigan could not open the About page:", error)); });
