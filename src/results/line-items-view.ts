import type { Cell, ResultTable } from "../result-types.js";
import { formatType } from "./readable-cells.js";
import { cellText } from "./table-engine.js";

/** The model's Line Items table as the results page shows it. The file is laid out as Anaplan's own Line Items grid for all
 * modules, which is every module's blueprint in one grid: a module's own row (its name and its Applies To, no format and
 * no summary), then that module's line items, where a line item with no dimensions of its own shows a dash under Applies
 * To. That is what the file holds, and the file stays as it is. The page lists every row of it, in the file's order, so
 * that the table counts what the grid counts. It names each row's module directly after the row's own name (a module's
 * own row names itself), shows under Applies To the dimensions a line item really has, and after Format the data type of
 * the line item's format, which a module's own row has none of: a filter on that column lists the modules' rows, or the
 * line items alone. The page shows a module's own row as a heading above its line items. The table given is never
 * changed: a model's map is built from it, never from the view.
 *
 * A module's own row names no module under Module Name and has no Format, no Formula and no Summary. A line item's row
 * names its module there, and always has a Format and a Summary (the classic client parses every line item's Format, and
 * refuses a blank Summary). That is how an export of a real model shows them. The classic client tells the two apart by
 * the row's ID, which a table does not hold. A row that names no module but has one of the three is a line item whose
 * module is not known: the read gave no Module Name for it, or the row is cut short. It is shown as a line item, with its
 * Applies To as the file has it. In a table with none of the three columns a row that names no module is a module's own.
 *
 * A row with none of that, only its name, is a module's own row, or a line item of which the read gave nothing else. The
 * model's module names tell the two apart, where the caller has them: a row whose name is a module's is that module's
 * own, and any other is a line item whose module is not known. A name is a module's when it is one of those names, or
 * when a line item of the file gives it as its module. Without the names every such row is taken for a module's own. A
 * table in which no row is a module's own is not the grid as the view knows it, and is shown as it is.
 *
 * A module's name is compared whole and as it is written, wherever the view compares one: with the names given, with the
 * Module Names of the file's line items, and with the name of the module's row above a line item. A name that differs
 * from a module's only by spaces before or after it is another name. The classic client takes those spaces off a
 * module's name when the module is made or renamed (anaplan/view/NewModule.js, anaplan/gridlet/Gridlet.js `_endEdit`),
 * so a module's name has none, and a text that has them is not that name. Taken for it, a row could be shown as a
 * module's own, or a line item given another module's Applies To; compared as it is, the row is shown as a line item and
 * keeps what the file says. Only a Module Name of nothing but spaces is no name at all.
 *
 * The rest is how the classic client itself reads this grid (anaplan/gridlet/_editor/ActionEditor.js, `LineItemsLoader`
 * and the editors that use it). A line item belongs to the nearest module's row above it. The view takes that row for the
 * line item's module only when its name is the line item's Module Name: otherwise the module's row is missing, and the
 * line item is shown as it is. A dash under Applies To stands for the module's Applies To. It does so whatever Start of
 * Section says: that is a break in how the blueprint shows a module's line items, not a change of dimensions (one of the
 * client's three editors reads it as one; the view does not follow it). Anything but a dash, the empty text included, is
 * the line item's own (a subsidiary view). Only of an empty one on a line item that names no module is nothing said. */

/** The file the view is for: the one the model export writes the Line Items grid to (model/export.ts). */
export const LINE_ITEMS_FILE = "Line Items.csv";

/** The grid's own columns the view reads, by the headers Anaplan gives them. The row's name is the first column. */
export const MODULE_NAME = "Module Name";
export const APPLIES_TO = "Applies To";
const FORMAT = "Format";
/** The columns that hold what only a line item has, where the table has them: a module's own row has none of the three. */
const LINE_ITEM_HAS = [FORMAT, "Formula", "Summary"];

/** The column the view adds after Applies To, and what it says of each row's Applies To: the module's, the line item's
 * own, or the module's when the module is not known: its row was not found above the line item, or the line item names
 * none (the dash is then shown as it is). A module's own row has its module's. It says nothing of an empty Applies To on
 * a line item that names no module: the read that gave no Module Name for it may have given no Applies To either. */
export const APPLIES_TO_FROM = "Applies To from";
export const APPLIES_TO_SOURCE = { module: "Module", lineItem: "Line item", notFound: "Module (not found)" } as const;

/** The column the view adds after Format, where the table has that column: the data type of the line item's format, by
 * the Format dialog's label (readable-cells.ts `formatType`). Empty for a module's own row, which has no format, and for a
 * line item whose Format names no data type. The page always offers a filter on it (columns.ts): without the blanks it
 * lists only line items, and without No Data it leaves out the line items that are headings. */
export const FORMAT_TYPE = "Format type";

/** What a line item shows under Applies To when it has no dimensions of its own. */
const DASH = "-";

export interface LineItemsView {
  /** The table to show: headers and rows of flat cells, as columns.ts and table-engine.ts take them. It is the table
   * given, itself, when the view does not apply to it. It is for showing only: the table given stays as it is. */
  table: ResultTable;
  /** How many of its rows are modules' own. */
  moduleRows: number;
  /** Those rows, as `table` holds them: the page shows each as a heading above its line items. None when the table is
   * shown as it is. */
  headings: ReadonlySet<readonly Cell[]>;
  /** One line for the page to show with the table: what its rows are, how the filter on Format type lists the line items
   * alone, and how many line items name no module. None when the table is shown as it is. */
  note?: string;
}

interface ModuleRow { name: string; appliesTo: Cell }

const count = (amount: number, one: string, many: string): string => (amount === 1 ? `1 ${one}` : `${amount} ${many}`);

/** What the page says of the view: that it lists every row of the grid, how many are line items and how many modules'
 * own, and where those stand; where the table has Format type and line items, how its filter lists them alone; and how
 * many line items name no module. */
function noteOf(lineItems: number, moduleRows: number, unnamed: number, typed: boolean): string {
  const where = `${moduleRows === 1 ? "" : "each "}in bold${lineItems === 0 ? "" : " above its line items"}`;
  const rows = `Every row of Anaplan's Line Items grid: ${lineItems === 0 ? "no line items" : count(lineItems, "line item", "line items")}, `
    + `and ${count(moduleRows, "module's own row", "modules' own rows")}, ${where}, with its own name under ${MODULE_NAME}.`;
  const filter = typed && lineItems > 0 ? ` To list only line items, untick (blank) in the filter of ${FORMAT_TYPE}, and No Data as well to leave out the line items that are headings.` : "";
  const unknown = unnamed === 0 ? "" : ` ${count(unnamed, "line item has no Module Name: its module is not known.", "line items have no Module Name: their module is not known.")}`;
  return `${rows}${filter}${unknown}`;
}

/** Whether a name is a module's, as far as the model's module names say: it is one of them, or a line item of the file
 * gives it as its module, which makes it one whatever the names hold. Either way it is that name as it is written, with
 * the spaces around it if it has any. Without the names any name may be a module's. */
function moduleNamed(rows: readonly Cell[][], moduleName: number, names: ReadonlySet<string> | undefined): (name: string) => boolean {
  const given = typeof names?.has === "function" ? names : undefined;
  if (!given) return () => true;
  const inFile = new Set<string>();
  for (const row of rows) {
    const named = Array.isArray(row) ? cellText(row[moduleName]) : "";
    if (named.trim() !== "") inFile.add(named);
  }
  return name => given.has(name) || inFile.has(name);
}

/** The view of the engine's Line Items table, or nothing for any other table: another file, one without a column the
 * view reads after the row's name, or one in which no row is a module's own (the view itself is such a table). */
function viewOf(table: ResultTable, moduleNames: ReadonlySet<string> | undefined): LineItemsView | undefined {
  if (table.file !== LINE_ITEMS_FILE) return undefined;
  const { headers } = table;
  const moduleName = headers.indexOf(MODULE_NAME);
  const appliesTo = headers.indexOf(APPLIES_TO);
  if (moduleName < 1 || appliesTo < 1) return undefined;
  const format = headers.indexOf(FORMAT);
  const typed = format > 0;
  const lineItemHas = LINE_ITEM_HAS.map(header => headers.indexOf(header)).filter(index => index > 0);
  const isModule = moduleNamed(table.rows, moduleName, moduleNames);
  // The row's name, its module, then every other column in the file's order.
  const order = [0, moduleName, ...headers.map((_, index) => index).filter(index => index !== 0 && index !== moduleName)];
  // The view's own columns, each after the column it is made from.
  const added = (index: number): string[] => (index === appliesTo ? [APPLIES_TO_FROM] : typed && index === format ? [FORMAT_TYPE] : []);

  /** A row as the view shows it: its cells in that order, with the module it names, its Applies To and where that came
   * from, and its format's data type. The cells a row holds beyond the headers stay after them, as the file has them. */
  const shown = (row: readonly Cell[], module: Cell, applies: Cell, from: string, type: string): Cell[] => {
    const cells = order.flatMap((index): Cell[] => (index === moduleName ? [module] : index === appliesTo ? [applies, from]
      : typed && index === format ? [row[index] ?? "", type] : [row[index] ?? ""]));
    for (let index = headers.length; index < row.length; index++) cells.push(row[index] ?? "");
    return cells;
  };

  const rows: Cell[][] = [];
  const headings = new Set<readonly Cell[]>();
  let unnamed = 0;
  // The nearest module's row above.
  let above: ModuleRow | undefined;
  for (const row of table.rows) {
    if (!Array.isArray(row)) return undefined;
    const inModule = cellText(row[moduleName]);
    const named = inModule.trim() !== "";
    const own = row[appliesTo] ?? "";
    if (!named && !lineItemHas.some(index => cellText(row[index]).trim() !== "") && isModule(cellText(row[0]))) {
      above = { name: cellText(row[0]), appliesTo: own };
      // A module's own row names itself as its module, so that its module's filter and sort keep it with its line items.
      // Its Applies To is its module's, and it has no format.
      const cells = shown(row, row[0] ?? "", own, APPLIES_TO_SOURCE.module, "");
      headings.add(cells);
      rows.push(cells);
      continue;
    }
    if (!named) unnamed++;
    const itsModule = named && above?.name === inModule ? above : undefined;
    const ownText = cellText(own).trim();
    const [applies, from]: [Cell, string] = ownText !== DASH ? [own, ownText === "" && !named ? "" : APPLIES_TO_SOURCE.lineItem]
      : itsModule ? [itsModule.appliesTo, APPLIES_TO_SOURCE.module]
      : [own, APPLIES_TO_SOURCE.notFound];
    rows.push(shown(row, row[moduleName] ?? "", applies, from, typed ? formatType(row[format]) ?? "" : ""));
  }
  if (headings.size === 0) return undefined;
  return {
    table: { ...table, headers: order.flatMap(index => [headers[index], ...added(index)]), rows },
    moduleRows: headings.size, headings, note: noteOf(rows.length - headings.size, headings.size, unnamed, typed),
  };
}

/** The Line Items table as the page shows it, with which of its rows are modules' own. `moduleNames` are the names of the
 * model's modules, where the caller has them (the first column of the result's Modules file): they tell a module's own
 * row from a line item's row of which the file holds only the name. It never throws: a table the view does not apply to,
 * or one that cannot be read at all, comes back as it is, with no note, and the page shows it as any other table. */
export function lineItemsView(table: ResultTable, moduleNames?: ReadonlySet<string>): LineItemsView {
  const asItIs: LineItemsView = { table, moduleRows: 0, headings: new Set() };
  try {
    return viewOf(table, moduleNames) ?? asItIs;
  } catch {
    return asItIs;
  }
}
