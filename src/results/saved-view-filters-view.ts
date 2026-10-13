import { readSavedViewDetails } from "../result-plain.js";
import type { AnalysisResult, Cell, ResultTable, SavedViewDetail } from "../result-types.js";
import { SAVED_VIEW_FILTERS, SAVED_VIEW_FILTERS_FILE, SAVED_VIEW_HEADERS, SAVED_VIEWS, SAVED_VIEWS_FILE } from "../saved-view-filters.js";
import { columnIndex } from "./columns.js";
import { cellText, type Row } from "./table-engine.js";

/** The filters of a row of a model's Saved Views table, as its details list them (markup.ts `savedViewFiltersHtml`): the
 * result's detail of the row's saved view (result-types.ts `savedViewDetails`), checked as a result from elsewhere is
 * (result-plain.ts), found by the row's module and name, which tell a model's saved views apart; among rows of one name and
 * module, as a copy of a result could hold, by the row's place among them, as the details list them in the table's order.
 * None for any other row, for a result an earlier version kept, which has no such detail, and for a row no detail names. */
export function savedViewOfRow(result: AnalysisResult | undefined, table: ResultTable, row: Row): SavedViewDetail | undefined {
  if (result?.kind !== "model" || table.file !== SAVED_VIEWS_FILE) return undefined;
  const details = readSavedViewDetails(result.savedViewDetails);
  const [nameAt, moduleAt] = [columnIndex(table, "Name"), columnIndex(table, "Module")];
  if (!details || nameAt === undefined || moduleAt === undefined) return undefined;
  const key = (name: string, module: string): string => JSON.stringify([name.trim(), module.trim()]);
  const wanted = key(cellText(row[nameAt]), cellText(row[moduleAt]));
  const alike: readonly Row[] = table.rows.filter(each => key(cellText(each[nameAt]), cellText(each[moduleAt])) === wanted);
  const place = alike.indexOf(row);
  return place < 0 ? undefined : details.filter(view => key(view.name, view.module) === wanted)[place];
}

/** Whether a table of Saved View Filters.csv is the one 0.43.0 and 0.44.0 wrote: a row for each saved view, under the
 * columns of Saved Views (`SAVED_VIEW_HEADERS`), and none of the filters of the views the pages show, which this version
 * writes under that name, laid out as Custom View Filters (`SAVED_VIEW_FILTER_HEADERS`). */
const viewsAsFilters = (table: ResultTable): boolean => table.file === SAVED_VIEW_FILTERS_FILE
  && SAVED_VIEW_HEADERS.every(header => table.headers.includes(header)) && !table.headers.includes("Condition line item");

/** A model's result as the page shows it, where an earlier version kept it: 0.43.0 and 0.44.0 wrote their table of the saved
 * views, then those with a filter, as Saved View Filters.csv, which this version's run writes for the filters of the views
 * the pages show. Such a table is known by its columns (`viewsAsFilters`), and is shown as what it is, Saved Views, under
 * Modules: it gets that file's name and label, and the lines about it theirs, so that the overview says nothing of a table
 * the result does not have. Those are its Files row, its notes and its How to read row, under the name, and the summary's
 * lines that begin with it; what they say stays as that version wrote it. Its rows and its details stay as they are: each
 * row has its view's detail, as Saved Views' do. A result with a Saved Views table, or with no such table, is given back as
 * it is; the one given is never changed. */
export function withSavedViews(result: AnalysisResult): AnalysisResult {
  if (result.kind !== "model" || result.tables.some(table => table.file === SAVED_VIEWS_FILE) || !result.tables.some(viewsAsFilters)) return result;
  const detail = (row: readonly Cell[]): Cell[] => {
    const [section, name] = [cellText(row[0]), cellText(row[1])];
    if (section === "Files" && name === SAVED_VIEW_FILTERS_FILE) return [row[0], SAVED_VIEWS_FILE, ...row.slice(2)];
    if ((section === "Notes" || section === "How to read") && name === SAVED_VIEW_FILTERS) return [row[0], SAVED_VIEWS, ...row.slice(2)];
    return [...row];
  };
  const said = `${SAVED_VIEW_FILTERS}: `;
  return {
    ...result,
    tables: result.tables.map(table => (viewsAsFilters(table) ? { ...table, file: SAVED_VIEWS_FILE, label: SAVED_VIEWS }
      : table.details === true ? { ...table, rows: table.rows.map(detail) } : table)),
    summary: result.summary.map(line => (cellText(line).startsWith(said) ? `${SAVED_VIEWS}: ${cellText(line).slice(said.length)}` : line)),
  };
}
