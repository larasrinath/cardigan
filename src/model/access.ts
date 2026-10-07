import { DRIVERS, graphOf } from "../map/build-graph.js";
import type { EdgeKind, GraphNode } from "../map/graph-types.js";
import type { ResultTable } from "../result-types.js";
import type { Table } from "./grid.js";

/** Dynamic Cell Access.csv: which line item drives who may read or write which, listed from the driver's side. Anaplan's
 * Line Items grid says it only on the line item that is controlled, in its Read Access Driver and Write Access Driver
 * columns: nothing on a driver's own row says what it controls. This file is those two columns turned round.
 *
 * It is no grid of Model settings, and nothing is read for it: it is made from the tables the export holds already. Which
 * line item a driver cell names is the model map's to say (map/build-graph.ts): a name in quotes or not, behind its
 * module and a dot or alone in the row's own module, and a line item with a dash, which has its module's driver. The
 * file is the map's access links written down, so the two cannot say different things, and none of those rules is
 * written a second time here.
 *
 * One row for each link: the driver's module and its name, Read or Write, and the module and the name of what it
 * controls, every name as Line Items.csv writes it. What is controlled is a line item, or a module's own row where that
 * row names a driver: such a row has no Controlled Line Item. The rows are in the order of the drivers in Line
 * Items.csv, for one driver Read before Write, and then in the order of what it controls.
 *
 * A driver cell that the map matched to no line item is not left out. Its row comes after the others, in the order of
 * the cells in Line Items.csv: Driver Module is empty, which it is in no other row, and Driver Line Item holds the cell
 * as it is written. Such a cell is one row, the row's that holds it: a module's own cell is not said again for each line
 * item that takes it. */

/** The file's label: its name without the extension, which is how export.ts names a file and what the page calls its table. */
export const ACCESS_LABEL = "Dynamic Cell Access";
export const ACCESS_HEADERS = ["Driver Module", "Driver Line Item", "Access", "Controlled Module", "Controlled Line Item"];

/** The file the table is made from, as export.ts writes the Line Items grid. */
const LINE_ITEMS_FILE = "Line Items.csv";

/** The map's two kinds of access link in the file's order, Read before Write, each with what a row says under Access. */
const ACCESS = [["read_access", "Read"], ["write_access", "Write"]] as const satisfies readonly (readonly [EdgeKind, string])[];
const accessOf = (kind: string | undefined): number => ACCESS.findIndex(([link]) => link === kind);

export interface AccessTable {
  table: Table;
  /** The rows whose driver was matched to no line item: the table's last. */
  unmatched: number;
}

/** A row, with the numbers that give its place among the others: compared one after the other. */
interface Use { place: readonly number[]; cells: string[] }
const byPlace = (a: Use, b: Use): number => {
  for (let index = 0; index < a.place.length; index++) if (a.place[index] !== b.place[index]) return a.place[index] - b.place[index];
  return 0;
};

/** The table, from the export's tables (the Details file need not be among them). It throws, with the reason as a
 * sentence, when there is no file to make it from: Line Items was not exported, or lacks one of the two columns. A
 * model that drives no access has both columns and gives a table without rows. */
export function accessTable(tables: readonly ResultTable[]): AccessTable {
  const lineItems = tables.find(table => table.file === LINE_ITEMS_FILE);
  if (!lineItems) throw new Error("Line Items was not exported.");
  // A column as the map finds it: the first of its name after the row's name.
  const lacking = DRIVERS.map(([column]) => column).filter(column => lineItems.headers.indexOf(column, 1) < 0);
  if (lacking.length) throw new Error(`Line Items has no ${lacking.join(" and ")} ${lacking.length === 1 ? "column" : "columns"}.`);

  const { nodes, edges, unresolved } = graphOf(tables);
  /** A module's own row or a line item, as two cells: its module's name, and its own where it is a line item. */
  const cells = (node: GraphNode): [string, string] => (node.module === undefined ? [node.name, ""] : [nodes[node.module].name, node.name]);
  const matched: Use[] = [];
  for (const [from, to, kind] of edges) {
    const access = accessOf(kind);
    if (access >= 0) matched.push({ place: [nodes[from].row, access, nodes[to].row], cells: [...cells(nodes[from]), ACCESS[access][1], ...cells(nodes[to])] });
  }
  // What the map could not match, it holds once for the cell, under the column's name, with the cell as it is written.
  const unmatched: Use[] = [];
  for (const { source, field, reference } of unresolved) {
    const access = accessOf(DRIVERS.find(([column]) => column === field)?.[1]);
    if (access >= 0) unmatched.push({ place: [nodes[source].row, access], cells: ["", reference, ACCESS[access][1], ...cells(nodes[source])] });
  }
  return { table: { headers: [...ACCESS_HEADERS], rows: [...matched.sort(byPlace), ...unmatched.sort(byPlace)].map(use => use.cells) }, unmatched: unmatched.length };
}
