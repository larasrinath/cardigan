import type { Cell, ResultTable } from "../result-types.js";
import { cellText } from "./table-engine.js";

/** The model's Line Items table as the results page shows it: a table of line items. The file is laid out as Anaplan's own
 * Line Items grid for all modules, which is every module's blueprint in one grid: a module's own row (its name and its
 * Applies To, no format and no summary), then that module's line items, where a line item with no dimensions of its own
 * shows a dash under Applies To. That is what the CSV holds, and the CSV stays as it is. The page leaves the modules' rows
 * out, names each line item's module directly after its own name, and shows under Applies To the dimensions the line item
 * really has. The table given is never changed, and a download is written from it, never from the view.
 *
 * A module's own row is one whose Module Name cell is empty; a line item's row names its module there. That is how an
 * export of a real model shows them. The classic client tells the two apart by the row's ID, which a table does not hold.
 * A table in which no row is a module's own is not the grid as the view knows it, and is shown as it is.
 *
 * The rest is how the classic client itself reads this grid (anaplan/gridlet/_editor/ActionEditor.js, `LineItemsLoader`
 * and the editors that use it). A line item belongs to the nearest module's row above it. The view takes that row for the
 * line item's module only when its name is the line item's Module Name: otherwise the module's row is missing, and the
 * line item is shown as it is. A dash under Applies To stands for the module's Applies To. After a line item that has
 * Start of Section ticked and an Applies To of its own, it stands for that line item's instead, until the next line item
 * with Start of Section ticked or the next module. Anything but a dash, the empty text included, is the line item's own
 * (a subsidiary view). */

/** The file the view is for: the one the model export writes the Line Items grid to (model/export.ts). */
export const LINE_ITEMS_FILE = "Line Items.csv";

/** The grid's own columns the view reads, by the headers Anaplan gives them. The row's name is the first column. */
export const MODULE_NAME = "Module Name";
export const APPLIES_TO = "Applies To";
export const START_OF_SECTION = "Start of Section";

/** The column the view adds after Applies To, and what it says of each line item's Applies To: the module's, that of the
 * line item that started its section, the line item's own, or the module's when the module's row was not found (the dash
 * is then shown as it is). */
export const APPLIES_TO_FROM = "Applies To from";
export const APPLIES_TO_SOURCE = { module: "Module", section: "Section", lineItem: "Line item", notFound: "Module (not found)" } as const;

/** What a line item shows under Applies To when it has no dimensions of its own. */
const DASH = "-";

export interface LineItemsView {
  /** The table to show: headers and rows of flat cells, as columns.ts and table-engine.ts take them. It is the table
   * given, itself, when the view does not apply to it. It is for showing only: the CSV is written from the table given. */
  table: ResultTable;
  /** The modules' own rows left out of `table`. */
  moduleRows: number;
  /** The modules among them with no line items: no row of `table` names them. */
  emptyModules: number;
  /** One line for the page to show with the table: what was left out. None when the table is shown as it is. */
  note?: string;
}

interface ModuleRow { name: string; appliesTo: Cell; named: boolean }

const count = (amount: number, one: string, many: string): string => (amount === 1 ? `1 ${one}` : `${amount} ${many}`);

/** What the page says of the rows left out: how many, and how many of them are modules that no line item names. */
function noteOf(moduleRows: number, emptyModules: number): string {
  const left = `${count(moduleRows, "module row is", "module rows are")} in the CSV only; each line item shows its module.`;
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
  const startOfSection = headers.indexOf(START_OF_SECTION);
  // The row's name, its module, then every other column in the file's order.
  const order = [0, moduleName, ...headers.map((_, index) => index).filter(index => index !== 0 && index !== moduleName)];

  const rows: Cell[][] = [];
  let moduleRows = 0;
  let namedModules = 0;
  // The nearest module's row above, and the Applies To of the line item that started the section, with its module's name.
  let above: ModuleRow | undefined;
  let section: { module: string; appliesTo: Cell } | undefined;
  for (const row of table.rows) {
    if (!Array.isArray(row)) return undefined;
    const inModule = cellText(row[moduleName]);
    if (inModule.trim() === "") {
      moduleRows++;
      above = { name: cellText(row[0]), appliesTo: row[appliesTo] ?? "", named: false };
      section = undefined;
      continue;
    }
    const itsModule = above?.name === inModule ? above : undefined;
    if (itsModule && !itsModule.named) {
      itsModule.named = true;
      namedModules++;
    }
    const own = row[appliesTo] ?? "";
    const dash = cellText(own).trim() === DASH;
    if (section?.module !== inModule) section = undefined;
    if (startOfSection >= 0 && cellText(row[startOfSection]).trim().toLowerCase() === "true") section = dash ? undefined : { module: inModule, appliesTo: own };
    const [shown, from]: [Cell, string] = !dash ? [own, APPLIES_TO_SOURCE.lineItem]
      : section ? [section.appliesTo, APPLIES_TO_SOURCE.section]
      : itsModule ? [itsModule.appliesTo, APPLIES_TO_SOURCE.module]
      : [own, APPLIES_TO_SOURCE.notFound];
    const cells: Cell[] = order.flatMap(index => (index === appliesTo ? [shown, from] : [row[index] ?? ""]));
    // The cells a row holds beyond the headers stay after them, as the CSV has them.
    for (let index = headers.length; index < row.length; index++) cells.push(row[index] ?? "");
    rows.push(cells);
  }
  if (moduleRows === 0) return undefined;
  const emptyModules = moduleRows - namedModules;
  return {
    table: { ...table, headers: order.flatMap(index => (index === appliesTo ? [headers[index], APPLIES_TO_FROM] : [headers[index]])), rows },
    moduleRows, emptyModules, note: noteOf(moduleRows, emptyModules),
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
