import { splitOutside, unquote } from "../map/graph-names.js";
import type { ResultTable } from "../result-types.js";
import type { Items } from "./cell-lists.js";
import { LINE_ITEMS_FILE } from "./line-items-view.js";
import { cellText, type Row } from "./table-engine.js";

/** Which row of the result an item of a row's details names, where the item is itself a row the page can open: a module,
 * a line item, a list, a process or an import. The details list such a cell one item to a line (cell-lists.ts), and an
 * item that is a row opens that row's details, as a click on it in its own table does. Nothing is guessed: an item is a
 * row only where its column names rows of one table, and only where exactly one row of that table has its name. An item
 * that no row has, or that several have, is said as text. Only a model's tables name their rows so; an app's never. */

/** A table of the page, as the details look a name up in it: the column that names its rows, and for Line Items the
 * column that names each line item's module. */
export interface NamedRows {
  table: ResultTable;
  name: number;
  module?: number;
}

/** The row an item names: in which file, and which row of the page's table of that file. */
export interface ItemRow {
  file: string;
  row: Row;
}

const MODULES_FILE = "Modules.csv";
const LISTS_FILE = "General Lists.csv";
const PROCESSES_FILE = "Processes.csv";
const IMPORTS_FILE = "Imports.csv";

/** The one row of `file` whose name is `name`, and whose module is `module` where one is given; none where no row, or
 * more than one, has it. */
function oneRow(tables: ReadonlyMap<string, NamedRows>, file: string, name: string, module?: string): ItemRow | undefined {
  const named = tables.get(file);
  if (!named || name.trim() === "") return undefined;
  if (module !== undefined && named.module === undefined) return undefined;
  const found = named.table.rows.filter(row => cellText(row[named.name]).trim() === name.trim()
    && (module === undefined || cellText(row[named.module!]).trim() === module.trim()));
  return found.length === 1 ? { file, row: found[0] } : undefined;
}

/** What an item names, by what its column names:
 * - a module, a list, a process or an import, by its name out of its quotes;
 * - a line item, by its module's name and its own, behind a dot (`'REV01 Revenue'.Price`), or by its own alone where the
 *   column is a module's own line items, or where a line item names another of its module.
 * A name that is both a module's and a line item's of the same module names neither: which is meant is not known. */
type Resolver = (item: string, row: Row, table: ResultTable, tables: ReadonlyMap<string, NamedRows>) => ItemRow | undefined;

const rowNamed = (file: string): Resolver => (item, _row, _table, tables) => oneRow(tables, file, unquote(item));

/** A module or a line item, as a cell that names objects writes them: a line item behind its module's name and a dot. A
 * name alone is a module, or, in a line item's own row, a line item of that line item's module. */
const objectNamed: Resolver = (item, row, table, tables) => {
  const parts = splitOutside(item, ".").map(unquote);
  if (parts.length === 2) return oneRow(tables, LINE_ITEMS_FILE, parts[1], parts[0]);
  if (parts.length !== 1) return undefined;
  const module = oneRow(tables, MODULES_FILE, parts[0]);
  const own = table.file === LINE_ITEMS_FILE ? tables.get(LINE_ITEMS_FILE) : undefined;
  const sibling = own?.module === undefined ? undefined : oneRow(tables, LINE_ITEMS_FILE, parts[0], cellText(row[own.module]));
  return module && sibling ? undefined : module ?? sibling;
};

/** A module's own line item, by its name alone: the row's module is the module the details are of. */
const ownLineItem: Resolver = (item, row, _table, tables) => oneRow(tables, LINE_ITEMS_FILE, item, cellText(row[0]));

/** File name -> header -> how its items name rows. A column that names nothing the page has rows of is not here: a list's
 * subsets and properties, the calendar's allowed values, and every column of an app's tables. */
const RESOLVERS: ReadonlyMap<string, ReadonlyMap<string, Resolver>> = new Map(Object.entries({
  [MODULES_FILE]: { "Applies To": rowNamed(LISTS_FILE), "Referenced By": objectNamed, "Line Items": ownLineItem },
  [LINE_ITEMS_FILE]: { "Applies To": rowNamed(LISTS_FILE), "Referenced By": objectNamed },
  [LISTS_FILE]: { "Referenced in Applies To": objectNamed, "Referenced as Format": objectNamed, "Referenced in Formula": objectNamed },
  [PROCESSES_FILE]: { "Used in Processes": rowNamed(PROCESSES_FILE) },
  [IMPORTS_FILE]: { "Used in Processes": rowNamed(PROCESSES_FILE) },
  "Exports.csv": { "Used in Processes": rowNamed(PROCESSES_FILE) },
  "Other Actions.csv": { "Used in Processes": rowNamed(PROCESSES_FILE) },
  "Import Data Sources.csv": { "Used in Imports": rowNamed(IMPORTS_FILE), Imports: rowNamed(IMPORTS_FILE) },
}).map(([file, columns]) => [file, new Map(Object.entries(columns))]));

/** For each item of a cell of `row`, in the cell's order, the row it names, or nothing for an item that is no row the
 * page can open. `header` is the cell's column, and `table` the page's table the row is of. */
export function itemRows(table: ResultTable, header: string, items: Items, row: Row, tables: ReadonlyMap<string, NamedRows>): (ItemRow | undefined)[] {
  const resolve = RESOLVERS.get(table.file)?.get(header);
  return items.map(item => (resolve ? resolve(item, row, table, tables) : undefined));
}
