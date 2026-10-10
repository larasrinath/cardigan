/** The three tables a model's result has about the pages built on the model (model-pages.ts makes them in the Anaplan
 * tab; the results page lists them after the Model settings tables, before the model map). Here, apart from that work, so
 * that the results page and the map know them by name without taking in what reads them. */

/** Each module, with the pages that use it and their apps: one row for each module and page. */
export const MODULE_USAGE_FILE = "Module Usage.csv";
/** The card filters on those pages that work on this model: an app's Filters table, with the app in front. */
export const PAGE_FILTERS_FILE = "Page Filters.csv";
/** The action buttons on those pages that run this model's actions: an app's Action Buttons table, with the app in front. */
export const PAGE_ACTIONS_FILE = "Page Actions.csv";
export const MODEL_PAGE_FILES: readonly string[] = [MODULE_USAGE_FILE, PAGE_FILTERS_FILE, PAGE_ACTIONS_FILE];

export const MODULE_USAGE_HEADERS: readonly string[] = ["Module", "App", "Page"];

/** A module's one row in Module Usage when no page that was read uses it. */
export const NOT_ON_A_PAGE = "Not on any page";
/** The column added to a model's Line Items: how many of the Page Filters rows have the line item as their condition. */
export const FILTER_USES = "Page Filters";
