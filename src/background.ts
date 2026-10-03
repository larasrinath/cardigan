import { RESULTS_PAGE, TAB_PARAM } from "./protocol.js";

/** The service worker behind the toolbar icon. A click opens the results page in a new tab right after the clicked one,
 * with that tab's ID in the address; the page then asks the tab's content script for the analysis (protocol.ts). The worker
 * keeps no state, so Chrome can stop it between clicks, and it needs no permission: opening a tab takes none, and it never
 * reads the clicked tab's address or content. */

/** chrome.tabs.TAB_ID_NONE: the ID Chrome gives a tab that is not a browser tab, such as a DevTools window. */
const TAB_ID_NONE = -1;

/** The Chrome APIs a click uses. A test passes a fake. */
export interface ClickApi {
  runtime: Pick<typeof chrome.runtime, "getURL">;
  tabs: Pick<typeof chrome.tabs, "create">;
}

/** Opens the results page for `tab`: right after it, and with it as the opener. A tab without an ID gets none. */
export async function openResults(api: ClickApi, tab: chrome.tabs.Tab): Promise<void> {
  if (tab.id === undefined || tab.id === TAB_ID_NONE) return;
  await api.tabs.create({ url: `${api.runtime.getURL(RESULTS_PAGE)}?${TAB_PARAM}=${tab.id}`, index: tab.index + 1, openerTabId: tab.id });
}

// Registered as the worker starts, which is what lets Chrome wake a stopped worker for a click.
chrome.action.onClicked.addListener(tab => { void openResults(chrome, tab); });
