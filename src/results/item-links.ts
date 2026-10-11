import { splitOutside, unquote } from "../map/graph-names.js";
import { missingIn, MISSING_LINE_ITEMS_MODULE, MODULE_USAGE_FILE, PAGE_ACTIONS_FILE, PAGE_FILTERS_FILE } from "../page-files.js";
import type { ResultTable } from "../result-types.js";
import type { Items } from "./cell-lists.js";
import { columnIndex } from "./columns.js";
import { LINE_ITEMS_FILE } from "./line-items-view.js";
import { cellText, type Row } from "./table-engine.js";

/** Which row of the result an item of a row's details names, where the item is itself a row the page can open: a module,
 * a line item, a list, a process, or an action a process runs. The details list such a cell one item to a line
 * (cell-lists.ts), and an item that is a row opens that row's details, as a click on it in its own table does. Nothing is
 * guessed: an item is a row only where its column names rows of one table, or of the actions' tables together, and only
 * where exactly one of those rows has its name. An item that no row has, or that several have, is said as text. Only a
 * model's tables name their rows so; an app's never. */

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
/** The tables of the actions a process runs: every action of the Actions list but the processes. */
const ACTION_FILES = [IMPORTS_FILE, "Exports.csv", "Other Actions.csv"] as const;

/** The rows of `file` whose name is `name`, and whose module is `module` where one is given. */
function rowsNamed(tables: ReadonlyMap<string, NamedRows>, file: string, name: string, module?: string): ItemRow[] {
  const named = tables.get(file);
  if (!named || name.trim() === "") return [];
  if (module !== undefined && named.module === undefined) return [];
  return named.table.rows.filter(row => cellText(row[named.name]).trim() === name.trim()
    && (module === undefined || cellText(row[named.module!]).trim() === module.trim())).map(row => ({ file, row }));
}

/** The one row of `file` whose name is `name`, and whose module is `module` where one is given; none where no row, or
 * more than one, has it. */
function oneRow(tables: ReadonlyMap<string, NamedRows>, file: string, name: string, module?: string): ItemRow | undefined {
  const found = rowsNamed(tables, file, name, module);
  return found.length === 1 ? found[0] : undefined;
}

/** What an item names, by what its column names:
 * - a module, a list, a process or an import, by its name out of its quotes;
 * - an action a process runs, by its name, among the imports, the exports and the other actions together;
 * - a line item, by its module's name and its own, behind a dot (`'REV01 Revenue'.Price`), or by its own alone where the
 *   column is a module's own line items, or where a line item names another of its module.
 * A name that is both a module's and a line item's of the same module names neither: which is meant is not known. */
type Resolver = (item: string, row: Row, table: ResultTable, tables: ReadonlyMap<string, NamedRows>) => ItemRow | undefined;

const rowNamed = (file: string): Resolver => (item, _row, _table, tables) => oneRow(tables, file, unquote(item));

/** Applies To can name a general list or a line item subset. Ambiguous names stay plain. */
const dimensionNamed: Resolver = (item, _row, _table, tables) => {
  const found = [LISTS_FILE, "Line Item Subsets.csv"].flatMap(file => rowsNamed(tables, file, unquote(item)));
  return found.length === 1 ? found[0] : undefined;
};

/** An action a process runs, by its name as the Actions list gives it, without quotes: the one row of Imports, Exports and
 * Other Actions together that has it. An import and an export of one name name neither: which is meant is not known. */
const actionNamed: Resolver = (item, _row, _table, tables) => {
  const found = ACTION_FILES.flatMap(file => rowsNamed(tables, file, item));
  return found.length === 1 ? found[0] : undefined;
};

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

const cell = (table: ResultTable, row: Row, header: string): string => {
  const at = columnIndex(table, header);
  return at === undefined ? "" : cellText(row[at]).trim();
};
/** These columns give the module separately; never resolve the same line item name in another module. */
const lineItemIn = (header: string): Resolver => (item, row, table, tables) => {
  const module = cell(table, row, header);
  return module === "" ? undefined : oneRow(tables, LINE_ITEMS_FILE, item, module);
};
const targetObject: Resolver = (item, row, table, tables) => {
  const type = cell(table, row, "Target Type").toLowerCase();
  const files = type === "module" ? [MODULES_FILE] : type === "list" ? [LISTS_FILE] : [MODULES_FILE, LISTS_FILE];
  const found = files.flatMap(file => rowsNamed(tables, file, unquote(item)));
  return found.length === 1 ? found[0] : undefined;
};
/** Page buttons may run a process too. Their declared type disambiguates an import and an export of one name. */
const pageAction: Resolver = (item, row, table, tables) => {
  const type = cell(table, row, "Action type").toLowerCase();
  const file = new Map([["import", IMPORTS_FILE], ["export", "Exports.csv"], ["process", PROCESSES_FILE]]).get(type);
  const found = (file ? [file] : [...ACTION_FILES, PROCESSES_FILE]).flatMap(file => rowsNamed(tables, file, item));
  return found.length === 1 ? found[0] : undefined;
};

/** File name -> header -> how its items name rows. A column that names nothing the page has rows of is not here: a list's
 * subsets and properties, the calendar's allowed values, and every column of an app's tables. */
const RESOLVERS: ReadonlyMap<string, ReadonlyMap<string, Resolver>> = new Map(Object.entries({
  [MODULES_FILE]: { "Applies To": dimensionNamed, "Referenced By": objectNamed, "Line Items": ownLineItem },
  [LINE_ITEMS_FILE]: { "Module Name": rowNamed(MODULES_FILE), "Applies To": dimensionNamed, "Referenced By": objectNamed,
    "Read Access Driver": objectNamed, "Write Access Driver": objectNamed, "Ratio Numerator": objectNamed, "Ratio Denominator": objectNamed, "Format List": rowNamed(LISTS_FILE) },
  [LISTS_FILE]: { "Parent Hierarchy": rowNamed(LISTS_FILE), "Referenced in Applies To": objectNamed, "Referenced as Format": objectNamed, "Referenced in Formula": objectNamed },
  "Line Item Subsets.csv": { Modules: rowNamed(MODULES_FILE), "Line Items": objectNamed, "Referenced in Applies To": objectNamed, "Referenced By": objectNamed },
  [PROCESSES_FILE]: { Actions: actionNamed },
  [IMPORTS_FILE]: { "Used in Processes": rowNamed(PROCESSES_FILE), "Target Object": targetObject },
  "Exports.csv": { "Used in Processes": rowNamed(PROCESSES_FILE) },
  "Other Actions.csv": { "Used in Processes": rowNamed(PROCESSES_FILE), "Action List": rowNamed(LISTS_FILE) },
  "Import Data Sources.csv": { "Used in Imports": rowNamed(IMPORTS_FILE), Imports: rowNamed(IMPORTS_FILE), "Source Model": rowNamed("Source Models.csv") },
  "Dynamic Cell Access.csv": { "Driver Module": rowNamed(MODULES_FILE), "Driver Line Item": lineItemIn("Driver Module"),
    "Controlled Module": rowNamed(MODULES_FILE), "Controlled Line Item": lineItemIn("Controlled Module") },
  [MODULE_USAGE_FILE]: { Module: rowNamed(MODULES_FILE) },
  [PAGE_FILTERS_FILE]: { "Condition line item's module": rowNamed(MODULES_FILE), "Condition line item": lineItemIn("Condition line item's module"),
    "Filtered module": rowNamed(MODULES_FILE), "Filtered dimension": rowNamed(LISTS_FILE) },
  [PAGE_ACTIONS_FILE]: { "Model action name": pageAction },
}).map(([file, columns]) => [file, new Map(Object.entries(columns))]));

/** For each item of a cell of `row`, in the cell's order, the row it names, or nothing for an item that is no row the
 * page can open. `header` is the cell's column, and `table` the page's table the row is of. */
export function itemRows(table: ResultTable, header: string, items: Items, row: Row, tables: ReadonlyMap<string, NamedRows>): (ItemRow | undefined)[] {
  const resolve = RESOLVERS.get(table.file)?.get(header);
  return items.map(item => (resolve && item !== MISSING_LINE_ITEMS_MODULE && !missingIn(item).length ? resolve(item, row, table, tables) : undefined));
}
