import type { Log, Stop } from "../progress.js";
import { message } from "../util.js";
import { gridTable, type Grid, type Table } from "./grid.js";
import { axis, readGrid, type Native } from "./native.js";

export const LINE_ITEM_SUBSETS = "Line Item Subsets";
export const LINE_ITEM_SUBSETS_FILE = `${LINE_ITEM_SUBSETS}.csv`;
export const MEMBERSHIP_NOT_READ = "Line item membership was not read. The diagnostic log says why.";

/** The client's tabs/Settings._getLineItemSubsetsViewDefinition uses LINE_ITEM_SUBSET against
 * LINE_ITEM_SUBSET_PROPERTY. Read every returned property with its own heading. Its membership view
 * (settings/LineItemSubsets._createTabs) uses MODULE_WITH_LINE_ITEM against LINE_ITEM_SUBSET. Request
 * it without a category filter and require every subset to be present. No editor, cache update or
 * system action is involved. */
export async function readLineItemSubsets(native: Native, log: Log, stop?: Stop): Promise<{ table: Table; note?: string }> {
  const definitions = await readGrid(native, axis(native, "LINE_ITEM_SUBSET"), axis(native, "LINE_ITEM_SUBSET_PROPERTY"), LINE_ITEM_SUBSETS, log, undefined, false, stop);
  const table = gridTable(definitions);
  if (!definitions.rows.length || table.headers.includes("Line Items")) return { table };
  try {
    const membership = await readGrid(native, axis(native, "MODULE_WITH_LINE_ITEM"), axis(native, "LINE_ITEM_SUBSET"), `${LINE_ITEM_SUBSETS} membership`, log, undefined, false, stop);
    const items = subsetLineItems(definitions, membership);
    table.headers.push("Line Items");
    table.rows.forEach((row, index) => row.push(items[index]));
    log(`${LINE_ITEM_SUBSETS} membership: ${items.length} subsets read`);
    return { table };
  } catch (error) {
    stop?.throwIfAborted();
    log(`${LINE_ITEM_SUBSETS} membership: not read (${message(error)})`);
    return { table, note: MEMBERSHIP_NOT_READ };
  }
}

/** Match by subset ID, never by a possibly repeated label. A module's own row is a heading, not a
 * member. Only explicit Boolean cells select line items. If any subset or cell cannot be interpreted,
 * leave membership out rather than present an incomplete list as complete. Quotes preserve dots,
 * commas and apostrophes in either name when the details resolve Module.Line Item. */
export function subsetLineItems(definitions: Grid, membership: Grid): string[] {
  const quote = (name: string): string => `'${name.replaceAll("'", "''")}'`;
  return definitions.rows.map(subset => {
    const id = subset.ids[0];
    const columns = membership.columns.flatMap((column, index) => column.ids[0] === id ? [index] : []);
    if (!Number.isSafeInteger(id) || id <= 0 || columns.length !== 1) throw new Error("The membership grid did not identify every subset once.");
    const items: string[] = [];
    for (const row of membership.rows) {
      if (row.ids.length < 2) {
        if (Math.floor(row.ids[0] / 1e9) === 102) continue;
        throw new Error("The membership grid did not identify a line item's module.");
      }
      const value = row.cells[columns[0]]?.trim().toLowerCase();
      if (value === "false" || value === "") continue;
      if (value !== "true" || !row.labels[0] || !row.labels[1]) throw new Error("The membership grid returned an unrecognised line item or selection.");
      items.push(`${quote(row.labels[1])}.${quote(row.labels[0])}`);
    }
    return items.join(", ");
  });
}
