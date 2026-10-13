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

/** The column added to a model's Line Items: how many of the Page Filters rows have the line item as their condition. The
 * results page shows it, as it shows the Page Filters table, as Custom View Filters (`CUSTOM_VIEW_FILTERS`): the column and
 * the file keep their names, by which a result kept earlier and the view kept for it are read. */
export const FILTER_USES = "Page Filters";
/** What the results page calls the Page Filters table, and its column of Line Items: the filters of a card's custom view on
 * the pages built on the model, as against a saved view's own filters (Saved View Filters). */
export const CUSTOM_VIEW_FILTERS = "Custom View Filters";

/** What a card on a page can point at that the model does not have: a module, a line item, or a model's action. */
export type MissingKind = "module" | "line item" | "import" | "export" | "process";
/** How the three tables name what a card on a page points at and the model does not have, deleted since the page was built
 * or hidden from whoever read it (model-pages.ts): plainly, with its ID, so that a search finds it. A hidden column of IDs
 * holds the ID, never these words. */
export const missingText = (kind: MissingKind, id: string): string => `Missing ${kind} (ID ${id})`;
/** What Condition line item's module says where the condition line item is missing: nothing says which module it was in,
 * and that module may be in the model still. */
export const MISSING_LINE_ITEMS_MODULE = "Missing line item: module not known";

/** Each thing a cell names as missing (`missingText`), in its order: a cell that lists several names may hold one among
 * them. */
export function missingIn(cell: string): { kind: MissingKind; id: string }[] {
  return [...cell.matchAll(/Missing (module|line item|import|export|process) \(ID (\d+)\)/g)].map(([, kind, id]) => ({ kind: kind as MissingKind, id }));
}
