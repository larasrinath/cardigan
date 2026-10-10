import type { AnalysisResult, Cell } from "./result-types.js";

/** How the results page (an extension page in its own tab) and the content script in the Anaplan tab talk.
 * - The toolbar icon's click opens the results page next to the Anaplan tab, with that tab's ID in the address.
 * - The page opens one long-lived port to that tab's content script: chrome.tabs.connect(tabId, { name: PORT_NAME }).
 * - The content script answers only its own extension (port.sender.id === chrome.runtime.id) and only this port name.
 * - Nothing is read from Anaplan until the page sends "run".
 * - The page sends "run" by itself only when the icon has just opened it (OPENED_PARAM, FRESH_MS). A results page that is
 *   reloaded, restored from history or reopened later asks nothing until the user clicks Run again: by then its tab ID
 *   may belong to another tab.
 * - A tab whose content script does not answer may have been open since before the extension was installed, updated or
 *   reloaded: Chrome puts content scripts only into pages that load after that. The page then puts it into the tab itself
 *   (CONTENT_SCRIPT), which the icon's click allows for that tab, and only on an Anaplan page (results/connection.ts).
 * Every message is plain JSON. */

export const PORT_NAME = "cardigan-results";
/** The results page: chrome.runtime.getURL(RESULTS_PAGE) + "?" + TAB_PARAM + "=" + the Anaplan tab's ID. */
export const RESULTS_PAGE = "results.html";
/** The content script in the Anaplan tab's own world, as the manifest names it. */
export const CONTENT_SCRIPT = "dist/content.js";
/** The pages the content scripts run on, as the manifest's matches say: every region's app host, Australia's included. */
export const CONTENT_SCRIPT_ORIGIN = /^https:\/\/(?:[a-z0-9-]+\.)*app2?\.anaplan\.com$/i;
export const TAB_PARAM = "tab";
/** Also in the address: when the icon was clicked, as Date.now(). The page starts the analysis by itself only when that is
 * less than FRESH_MS ago, and then removes the parameter from its address, so a reload does not start another. */
export const OPENED_PARAM = "opened";
export const FRESH_MS = 60_000;

/** What the Anaplan tab shows: an app, a model, or neither. For a model in Model Building, also the tab's site
 * (`origin`) and the customer its address names (`customer`): what the results page opens one of its modules with. */
export type Subject = { kind: "app" | "model"; id: string; origin?: string; customer?: string } | { kind: "none" };

/** Page to tab. */
export type PageMessage =
  /** Analyse what the tab shows; progress and then the result follow. A "run" while one is in progress is ignored. */
  | { type: "run" }
  /** Open a module of `model` inside the Model Building page the tab shows, beside the modules open there, as Model
   * Building's own Modules list opens one. `module` is the module's ID. One "opened" answers it, with the same `nonce`;
   * it can be asked at any time, while a run goes on or without one. */
  | { type: "open"; nonce: string; model: string; module: string };

/** Tab to page. */
export type TabMessage =
  /** Sent once, as soon as the port opens. */
  | { type: "subject"; subject: Subject }
  /** While running: the current step. It replaces the previous status. */
  | { type: "status"; text: string }
  /** While running: one line of the diagnostic log, already stamped with its time (details.ts `stampLine`). */
  | { type: "log"; text: string }
  /** The result arrives as: one "result" whose tables all have `rows: []`; then, table by table in order, zero or more
   * "rows" messages, each appended to `result.tables[table].rows`; then one "done". */
  | { type: "result"; result: AnalysisResult }
  | { type: "rows"; table: number; rows: Cell[][] }
  | { type: "done" }
  /** The run failed; `message` is a plain sentence for the user. `code` is "SIGNED_OUT" when Anaplan's session has ended.
   * An "error" can also arrive after "result" and "rows", in place of "done", when a piece of the result could not be
   * sent: the result is then incomplete and must not be shown. */
  | { type: "error"; message: string; code?: "SIGNED_OUT" }
  /** The answer to an "open": whether the page took the module, and in a few words how, or why not, for the log. It
   * belongs to no run. */
  | { type: "opened"; nonce: string; opened: boolean; detail: string };

/** One "rows" message holds at most ROWS_MAX rows, and is cut earlier once the text of its cells passes ROWS_MAX_CHARS,
 * so a message stays far below Chrome's size limit however large a model is. */
export const ROWS_MAX = 500;
export const ROWS_MAX_CHARS = 1_000_000;
