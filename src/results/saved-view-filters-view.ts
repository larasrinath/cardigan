import { readSavedViewDetails } from "../result-plain.js";
import type { AnalysisResult, ResultTable, SavedViewDetail } from "../result-types.js";
import { SAVED_VIEW_FILTERS_FILE } from "../saved-view-filters.js";
import { columnIndex } from "./columns.js";
import { cellText, type Row } from "./table-engine.js";

/** The filters of a row of a model's Saved View Filters table, as its details list them (markup.ts `savedViewFiltersHtml`):
 * the result's detail of the row's saved view (result-types.ts `savedViewDetails`), checked as a result from elsewhere is
 * (result-plain.ts), found by the row's module and name, which tell a model's saved views apart; among rows of one name and
 * module, as a copy of a result could hold, by the row's place among them, as the details list them in the table's order.
 * None for any other row, for a result an earlier version kept, which has no such detail, and for a row no detail names. */
export function savedViewOfRow(result: AnalysisResult | undefined, table: ResultTable, row: Row): SavedViewDetail | undefined {
  if (result?.kind !== "model" || table.file !== SAVED_VIEW_FILTERS_FILE) return undefined;
  const details = readSavedViewDetails(result.savedViewDetails);
  const [nameAt, moduleAt] = [columnIndex(table, "Name"), columnIndex(table, "Module")];
  if (!details || nameAt === undefined || moduleAt === undefined) return undefined;
  const key = (name: string, module: string): string => JSON.stringify([name.trim(), module.trim()]);
  const wanted = key(cellText(row[nameAt]), cellText(row[moduleAt]));
  const alike: readonly Row[] = table.rows.filter(each => key(cellText(each[nameAt]), cellText(each[moduleAt])) === wanted);
  const place = alike.indexOf(row);
  return place < 0 ? undefined : details.filter(view => key(view.name, view.module) === wanted)[place];
}
