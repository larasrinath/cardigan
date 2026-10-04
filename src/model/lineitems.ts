import { gridTable, type Grid, type Table } from "./grid.js";

/** Two columns after Anaplan's own Line Items layout. A Ratio summary names its numerator and denominator only by ID in the
 * Summary cell (`"ratioNumeratorIdentifier":"_597000000011_"`), and the file has no ID column to match them against. Each
 * line item's ID is its own row's entity ID in the same grid, so the names come from there. */
export const RATIO_COLUMNS = ["Ratio Numerator", "Ratio Denominator"];

/** One more column, after those two. A line item formatted as a list names its list only by ID in the Format cell
 * (`"hierarchyEntityLongId":101000000007` beside `"dataType":"ENTITY"`). Each general list's ID is its own row's entity ID in
 * the General Lists grid, so the name comes from there: it is that file's name for the list.
 *
 * The ID is not always a general list's. It can be a list subset's or a line item subset's, where the classic client looks
 * a format's list up too (anaplan/data/ModelContentHelper.js `getHierarchyId`), or a built-in list's, such as Users,
 * Versions or Time. An ID that is no row of the General Lists grid is not named, and neither is any when that grid was
 * not read. The cell is then blank: never a guess, and never the ID, which the Format cell holds. */
export const FORMAT_LIST_COLUMN = "Format List";

/** The Line Items grid as Anaplan exports it, plus the names of each Ratio summary's numerator and denominator (blank for
 * any other summary, or an ID the grid does not hold), plus the name of each list format's list, by the rows of `lists`, the
 * General Lists grid (blank for any other format, for an ID that grid does not hold, and in every row without the grid). */
export function lineItemsTable(grid: Grid, lists?: Grid): Table {
  const table = gridTable(grid);
  const summary = table.headers.indexOf("Summary");
  const format = table.headers.indexOf("Format");
  const names = new Map<number, string>();
  for (const row of grid.rows) if (Number.isFinite(row.ids[0])) names.set(row.ids[0], row.labels[0] ?? "");
  const listNames = new Map<number, string>();
  for (const row of lists?.rows ?? []) if (Number.isFinite(row.ids[0])) listNames.set(row.ids[0], row.labels[0] ?? "");
  const name = (identifier: unknown): string => {
    const id = typeof identifier === "string" ? identifier.replace(/^_+|_+$/g, "") : "";
    return /^\d+$/.test(id) ? names.get(Number(id)) ?? "" : "";
  };
  /** A list format's list. The format holds the ID as a number; as text, between underscores or not, it is the same ID
   * (the results page reads it so too, results/readable-cells.ts `idOf`). An ID of more digits than a number holds exactly
   * is not looked up: it could be found under another ID's number. */
  const listName = (definition: { dataType?: unknown; hierarchyEntityLongId?: unknown } | null): string => {
    const identifier = definition?.dataType === "ENTITY" ? definition.hierarchyEntityLongId : undefined;
    const id = typeof identifier === "number" ? String(identifier) : typeof identifier === "string" ? identifier.replace(/^_+|_+$/g, "") : "";
    return /^\d+$/.test(id) && Number.isSafeInteger(Number(id)) ? listNames.get(Number(id)) ?? "" : "";
  };
  /** The definition a row holds as JSON in one of the grid's columns, or nothing: no such column, or no JSON in the cell. */
  const definitionOf = <T>(cells: string[], column: number): T | null => {
    if (column > 0 && cells[column]?.startsWith("{")) {
      try { return JSON.parse(cells[column]) as T; } catch { return null; }
    }
    return null;
  };
  return {
    headers: [...table.headers, ...RATIO_COLUMNS, FORMAT_LIST_COLUMN],
    rows: table.rows.map(cells => {
      const ratio = definitionOf<{ ratioNumeratorIdentifier?: unknown; ratioDenominatorIdentifier?: unknown }>(cells, summary);
      return [...cells, name(ratio?.ratioNumeratorIdentifier), name(ratio?.ratioDenominatorIdentifier), listName(definitionOf(cells, format))];
    }),
  };
}
