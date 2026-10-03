import { gridTable, type Grid, type Table } from "./grid.js";

/** Two columns after Anaplan's own Line Items layout. A Ratio summary names its numerator and denominator only by ID in the
 * Summary cell (`"ratioNumeratorIdentifier":"_597000000011_"`), and the file has no ID column to match them against. Each
 * line item's ID is its own row's entity ID in the same grid, so the names come from there. */
export const RATIO_COLUMNS = ["Ratio Numerator", "Ratio Denominator"];

/** The Line Items grid as Anaplan exports it, plus the names of each Ratio summary's numerator and denominator (blank for
 * any other summary, or an ID the grid does not hold). */
export function lineItemsTable(grid: Grid): Table {
  const table = gridTable(grid);
  const summary = table.headers.indexOf("Summary");
  const names = new Map<number, string>();
  for (const row of grid.rows) if (Number.isFinite(row.ids[0])) names.set(row.ids[0], row.labels[0] ?? "");
  const name = (identifier: unknown): string => {
    const id = typeof identifier === "string" ? identifier.replace(/^_+|_+$/g, "") : "";
    return /^\d+$/.test(id) ? names.get(Number(id)) ?? "" : "";
  };
  return {
    headers: [...table.headers, ...RATIO_COLUMNS],
    rows: table.rows.map(cells => {
      let parsed: { ratioNumeratorIdentifier?: unknown; ratioDenominatorIdentifier?: unknown } | null = null;
      if (summary > 0 && cells[summary]?.startsWith("{")) {
        try { parsed = JSON.parse(cells[summary]); } catch { parsed = null; }
      }
      return [...cells, name(parsed?.ratioNumeratorIdentifier), name(parsed?.ratioDenominatorIdentifier)];
    }),
  };
}
