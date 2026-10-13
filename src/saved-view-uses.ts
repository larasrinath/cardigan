import { plainRows, textOf } from "./result-plain.js";
import type { AnalysisResult, Cell } from "./result-types.js";
import { SAVED_VIEW_FILTERS_FILE, VIEW_FILTER_USES } from "./saved-view-filters.js";

/** What a model's saved views' filters use of its line items, made in the Anaplan tab from the export's result once it has
 * come (content.ts): nothing is read for it. The export read each saved view's filter and named each condition's line item
 * by the Line Items grid (model/saved-views.ts), which the result carries for the Model map (`savedViewFilters`).
 *
 * The Line Items table gets a column, beside the one that counts the custom view filters of the pages built on the model,
 * that counts for each line item the saved views whose filters use it, on or off. A module's own row has none. A line item
 * that no view's filter uses is 0 only where every saved view's definition was read: where one was not, or the saved
 * views could not be listed at all, its filter may use the line item, and the cell is empty. */

const LINE_ITEMS_FILE = "Line Items.csv";
const MODULE_NAME = "Module Name";

/** The result with the column added to its Line Items table, which is copied: the result given is not changed. A result
 * without that table, or without its Module Name column, is given back as it is. */
export function addViewFilterUses(given: AnalysisResult): AnalysisResult {
  const at = given.tables.findIndex(table => table.file === LINE_ITEMS_FILE);
  const table = given.tables[at];
  const moduleAt = table ? table.headers.indexOf(MODULE_NAME) : -1;
  if (!table || moduleAt < 0) return given;
  const key = (module: string, lineItem: string): string => `${module.trim()}\n${lineItem.trim()}`;
  const views = new Map<string, Set<string>>();
  for (const filter of given.savedViewFilters ?? []) {
    const viewsOf = views.get(key(filter.lineItemModule, filter.lineItem)) ?? new Set<string>();
    viewsOf.add(JSON.stringify([filter.module.trim(), filter.view.trim()]));
    views.set(key(filter.lineItemModule, filter.lineItem), viewsOf);
  }
  // Every view's definition read: the table lists none it could not read (Definition read says No in such a row).
  const everyViewRead = given.savedViewFilters !== undefined && given.savedViewDetails !== undefined && given.savedViewDetails.every(view => view.read)
    && given.tables.some(each => each.file === SAVED_VIEW_FILTERS_FILE);
  const none: Cell = everyViewRead ? 0 : "";
  const width = table.headers.length;
  const rows = table.rows.map(row => {
    const module = textOf(row[moduleAt] ?? "").trim();
    const count = module === "" ? "" : views.get(key(module, textOf(row[0] ?? "")))?.size ?? none;
    // The cell goes in the column's place: a row may be short of the headers, or hold cells beyond them.
    const cells: Cell[] = [...row];
    while (cells.length < width) cells.push("");
    cells.splice(width, 0, count);
    return cells;
  });
  const tables = [...given.tables];
  tables[at] = { ...table, headers: [...table.headers, VIEW_FILTER_USES], rows: plainRows(rows) };
  return { ...given, tables };
}
