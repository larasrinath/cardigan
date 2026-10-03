import type { AnalysisResult, Cell } from "./result-types.js";

/** How the results page (an extension page in its own tab) and the content script in the Anaplan tab talk.
 * - The toolbar icon's click opens the results page next to the Anaplan tab, with that tab's ID in the address.
 * - The page opens one long-lived port to that tab's content script: chrome.tabs.connect(tabId, { name: PORT_NAME }).
 * - The content script answers only its own extension (port.sender.id === chrome.runtime.id) and only this port name.
 * - Nothing is read from Anaplan until the page sends "run".
 * Every message is plain JSON. */

export const PORT_NAME = "cardigan-results";
/** The results page: chrome.runtime.getURL(RESULTS_PAGE) + "?" + TAB_PARAM + "=" + the Anaplan tab's ID. */
export const RESULTS_PAGE = "results.html";
export const TAB_PARAM = "tab";

/** What the Anaplan tab shows: an app, a model, or neither. */
export type Subject = { kind: "app" | "model"; id: string } | { kind: "none" };

/** Page to tab. */
export type PageMessage =
  /** Analyse what the tab shows; progress and then the result follow. A "run" while one is in progress is ignored. */
  | { type: "run" };

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
  /** The run failed. `code` is "SIGNED_OUT" when Anaplan's session has ended. */
  | { type: "error"; message: string; code?: "SIGNED_OUT" };

/** One "rows" message holds at most ROWS_MAX rows, and is cut earlier once the text of its cells passes ROWS_MAX_CHARS,
 * so a message stays far below Chrome's size limit however large a model is. */
export const ROWS_MAX = 500;
export const ROWS_MAX_CHARS = 1_000_000;
