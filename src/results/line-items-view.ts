import type { Cell, ResultTable } from "../result-types.js";
import { cellText } from "./table-engine.js";

/** The model's Line Items table as the results page shows it: a table of line items. The file is laid out as Anaplan's own
 * Line Items grid for all modules, which is every module's blueprint in one grid: a module's own row (its name and its
 * Applies To, no format and no summary), then that module's line items, where a line item with no dimensions of its own
 * shows a dash under Applies To. That is what the CSV holds, and the CSV stays as it is. The page leaves the modules' rows
 * out, names each line item's module directly after its own name, and shows under Applies To the dimensions the line item
 * really has. The table given is never changed, and a download is written from it, never from the view.
 *
 * A module's own row names no module under Module Name and has neither a Format nor a Summary. A line item's row names
 * its module there, and always has both (the classic client parses every line item's Format, and refuses a blank Summary).
 * That is how an export of a real model shows them. The classic client tells the two apart by the row's ID, which a table
 * does not hold. A row that names no module but has a Format or a Summary is a line item whose module is not known: the
 * read gave no Module Name for it, or the row is cut short. It stays in the view, with its Applies To as the file has it.
 * In a table without those two columns a row that names no module is a module's own. A table in which no row is a
 * module's own is not the grid as the view knows it, and is shown as it is.
 *
 * The rest is how the classic client itself reads this grid (anaplan/gridlet/_editor/ActionEditor.js, `LineItemsLoader`
 * and the editors that use it). A line item belongs to the nearest module's row above it. The view takes that row for the
 * line item's module only when its name is the line item's Module Name: otherwise the module's row is missing, and the
 * line item is shown as it is. A dash under Applies To stands for the module's Applies To. It does so whatever Start of
 * Section says: that is a break in how the blueprint shows a module's line items, not a change of dimensions (one of the
 * client's three editors reads it as one; the view does not follow it). Anything but a dash, the empty text included, is
 * the line item's own (a subsidiary view). */

/** The file the view is for: the one the model export writes the Line Items grid to (model/export.ts). */
export const LINE_ITEMS_FILE = "Line Items.csv";

/** The grid's own columns the view reads, by the headers Anaplan gives them. The row's name is the first column. */
export const MODULE_NAME = "Module Name";
export const APPLIES_TO = "Applies To";
/** The columns that hold what every line item has and a module's own row has not, where the table has them. */
const LINE_ITEM_HAS = ["Format", "Summary"];

/** The column the view adds after Applies To, and what it says of each line item's Applies To: the module's, the line
 * item's own, or the module's when the module is not known: its row was not found above the line item, or the line item
 * names none (the dash is then shown as it is). */
export const APPLIES_TO_FROM = "Applies To from";
export const APPLIES_TO_SOURCE = { module: "Module", lineItem: "Line item", notFound: "Module (not found)" } as const;

/** What a line item shows under Applies To when it has no dimensions of its own. */
const DASH = "-";

export interface LineItemsView {
  /** The table to show: headers and rows of flat cells, as columns.ts and table-engine.ts take them. It is the table
   * given, itself, when the view does not apply to it. It is for showing only: the CSV is written from the table given. */
  table: ResultTable;
  /** The modules' own rows left out of `table`. */
  moduleRows: number;
  /** The modules among them with no line items: no line item stands under their row. */
  emptyModules: number;
  /** One line for the page to show with the table: what was left out, and how many line items name no module. None when
   * the table is shown as it is. */
  note?: string;
}

interface ModuleRow { name: string; appliesTo: Cell; lineItems: boolean }

const count = (amount: number, one: string, many: string): string => (amount === 1 ? `1 ${one}` : `${amount} ${many}`);

/** What the page says of the view: how many modules' rows it left out, how many line items name no module, and how many
 * of the modules have no line items. That last part stays last: the page adds to it where those modules are listed
 * (result-view.ts). */
function noteOf(moduleRows: number, unnamed: number, emptyModules: number): string {
  const except = unnamed === 0 ? "" : `, except ${count(unnamed, "whose module is not known: it has", "whose module is not known: they have")} no ${MODULE_NAME} in the file`;
  const left = `${count(moduleRows, "module row is", "module rows are")} in the CSV only; each line item shows its module${except}.`;
  return emptyModules === 0 ? left : `${left} ${count(emptyModules, "module has no line items, so it is", "modules have no line items, so they are")} not in this table.`;
}

/** The view of the engine's Line Items table, or nothing for any other table: another file, one without a column the
 * view reads after the row's name, or one in which no row is a module's own (the view itself is such a table). */
function viewOf(table: ResultTable): LineItemsView | undefined {
  if (table.file !== LINE_ITEMS_FILE) return undefined;
  const { headers } = table;
  const moduleName = headers.indexOf(MODULE_NAME);
  const appliesTo = headers.indexOf(APPLIES_TO);
  if (moduleName < 1 || appliesTo < 1) return undefined;
  const lineItemHas = LINE_ITEM_HAS.map(header => headers.indexOf(header)).filter(index => index > 0);
  // The row's name, its module, then every other column in the file's order.
  const order = [0, moduleName, ...headers.map((_, index) => index).filter(index => index !== 0 && index !== moduleName)];

  const rows: Cell[][] = [];
  let moduleRows = 0;
  let withLineItems = 0;
  let unnamed = 0;
  // The nearest module's row above.
  let above: ModuleRow | undefined;
  for (const row of table.rows) {
    if (!Array.isArray(row)) return undefined;
    const inModule = cellText(row[moduleName]);
    const named = inModule.trim() !== "";
    if (!named && !lineItemHas.some(index => cellText(row[index]).trim() !== "")) {
      moduleRows++;
      above = { name: cellText(row[0]), appliesTo: row[appliesTo] ?? "", lineItems: false };
      continue;
    }
    // A line item, whatever module it names: the module's row above it is not one with nothing under it.
    if (above && !above.lineItems) {
      above.lineItems = true;
      withLineItems++;
    }
    if (!named) unnamed++;
    const itsModule = named && above?.name === inModule ? above : undefined;
    const own = row[appliesTo] ?? "";
    const dash = cellText(own).trim() === DASH;
    const [shown, from]: [Cell, string] = !dash ? [own, APPLIES_TO_SOURCE.lineItem]
      : itsModule ? [itsModule.appliesTo, APPLIES_TO_SOURCE.module]
      : [own, APPLIES_TO_SOURCE.notFound];
    const cells: Cell[] = order.flatMap(index => (index === appliesTo ? [shown, from] : [row[index] ?? ""]));
    // The cells a row holds beyond the headers stay after them, as the CSV has them.
    for (let index = headers.length; index < row.length; index++) cells.push(row[index] ?? "");
    rows.push(cells);
  }
  if (moduleRows === 0) return undefined;
  const emptyModules = moduleRows - withLineItems;
  return {
    table: { ...table, headers: order.flatMap(index => (index === appliesTo ? [headers[index], APPLIES_TO_FROM] : [headers[index]])), rows },
    moduleRows, emptyModules, note: noteOf(moduleRows, unnamed, emptyModules),
  };
}

/** The Line Items table as the page shows it, with what was left out. It never throws: a table the view does not apply
 * to, or one that cannot be read at all, comes back as it is, with no note, and the page shows it as any other table. */
export function lineItemsView(table: ResultTable): LineItemsView {
  const asItIs: LineItemsView = { table, moduleRows: 0, emptyModules: 0 };
  try {
    return viewOf(table) ?? asItIs;
  } catch {
    return asItIs;
  }
}
