/** The three tables a model's result has about the pages built on the model (model-pages.ts makes them in the Anaplan
 * tab; the results page lists them after the Model settings tables, before the model map). Here, apart from that work, so
 * that the results page and the map know them by name without taking in what reads them. */

/** Each module, with the pages that use it and their apps: one row for each module and page. */
export const MODULE_USAGE_FILE = "Module Usage.csv";
/** The card filters on those pages that work on this model: an app's Filters rows, with their app, in an order of their own
 * (model-pages.ts `PAGE_FILTERS_HEADERS`). */
export const PAGE_FILTERS_FILE = "Page Filters.csv";
/** The action buttons on those pages that run this model's actions: an app's Action Buttons rows, with their app, in an
 * order of their own (model-pages.ts `PAGE_ACTIONS_HEADERS`). */
export const PAGE_ACTIONS_FILE = "Page Actions.csv";
export const MODEL_PAGE_FILES: readonly string[] = [MODULE_USAGE_FILE, PAGE_FILTERS_FILE, PAGE_ACTIONS_FILE];

/** Where a page is, by the columns each of the three tables ends with, hidden: the page's type, as an app's Pages table
 * says it (Board, Worksheet or Report), its app's ID and its own. The results page opens the app and the page in Anaplan
 * by them (results/main.ts). */
export const PAGE_PLACE_HEADERS: readonly string[] = ["Page type", "App ID", "Page ID"];
/** The part of a page's address in Anaplan for its type, by the type as the Page type column says it (report.ts
 * `PAGE_TYPE`), as Model Building's own links to the pages built on a model write it (modeling.js): a board's, a
 * worksheet's and a report's. A page of another type has no address here. */
export const PAGE_ROUTES: ReadonlyMap<string, string> = new Map([["Board", "boards"], ["Worksheet", "worksheets"], ["Report", "reports"]]);

export const MODULE_USAGE_HEADERS: readonly string[] = ["Module", "App", "Page", ...PAGE_PLACE_HEADERS];

/** A module's one row in Module Usage when no page that was read uses it. */
export const NOT_ON_A_PAGE = "Not on any page";
/** The column added to a model's Line Items: how many of the Page Filters rows have the line item as their condition. */
export const FILTER_USES = "Page Filters";
