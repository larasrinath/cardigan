import { DRIVERS, readAccess } from "../map/build-graph.js";
import type { EdgeKind, GraphNode } from "../map/graph-types.js";
import type { ResultTable } from "../result-types.js";
import type { Table } from "./grid.js";

/** Dynamic Cell Access.csv: which line item drives who may read or write which, listed from the driver's side. The Line
 * Items list names a driver on the line item it controls, in that row's Read Access Driver and Write Access Driver
 * cells. This file lists the same uses with the driver first.
 *
 * It is no grid of Model settings, and nothing is read for it: it is made from the tables the export holds already. Which
 * line item a driver cell names is the model map's to say (map/build-graph.ts): a name in quotes or not, behind its
 * module and a dot or alone in the row's own module, and a line item with a dash, which has its module's driver. None
 * of those rules is written a second time here.
 *
 * One row for each use of a driver: the driver's module and its name, Read or Write, and the module and the name of what
 * it controls, every name as Line Items.csv writes it. A line item that one driver controls for reading and for writing
 * has two rows. What is controlled is a line item, or a module's own row where that row names a driver: such a row has
 * no Controlled Line Item. The rows are in the order of the drivers in Line Items.csv, for one driver Read before Write,
 * and then in the order of what it controls.
 *
 * A driver cell that names no line item the map holds is not left out. Its row comes after the others, in the order of
 * the cells in Line Items.csv: Driver Module is empty, which it is in no other row, and Driver Line Item holds the cell
 * as it is written.
 *
 * No driver cell that says something is in no row. For every row of Line Items that the map places, the file's rows are
 * the map's access links and the driver cells the map could not match, so there the two cannot say different things: a
 * line item with a dash has a row for its module's driver, as the map links it, and a module's own cell that could not
 * be matched is one row, not one more for each line item that takes it.
 *
 * The file holds more than the map where the map leaves rows of Line Items out, which it counts under About this map:
 * a line item under a heading, one whose module the file does not say or has no row for, a second line item or module
 * of a name. The map has no link for such a row, and its driver cells have their rows here all the same. What is
 * controlled is the row as the file writes it: a line item by its Module Name cell and its name, a module's own row by
 * its name. The driver is what the map's own reading of the cell gives (`readAccess`), by the rules it has for a row
 * it places, a dash for the driver of the module's own row above; the cell is among the unmatched where that names no
 * line item the map holds. */

/** The file's label: its name without the extension, which is how export.ts names a file and what the page calls its table. */
export const ACCESS_LABEL = "Dynamic Cell Access";
export const ACCESS_HEADERS = ["Driver Module", "Driver Line Item", "Access", "Controlled Module", "Controlled Line Item"];

/** The map's two kinds of access link in the file's order, Read before Write, each with what a row says under Access. */
const ACCESS = [["read_access", "Read"], ["write_access", "Write"]] as const satisfies readonly (readonly [EdgeKind, string])[];
const accessOf = (kind: string | undefined): number => ACCESS.findIndex(([link]) => link === kind);

export interface AccessTable {
  table: Table;
  /** The rows whose driver was matched to no line item: the table's last. */
  unmatched: number;
}

/** Why there is no table: the export lacks what it is made from. A sentence, as the Details file says it of the file. */
export interface NoAccessTable { missing: string }

/** A row, with the numbers that give its place among the others: compared one after the other. */
interface Use { place: readonly number[]; cells: string[] }
const byPlace = (a: Use, b: Use): number => {
  for (let index = 0; index < a.place.length; index++) if (a.place[index] !== b.place[index]) return a.place[index] - b.place[index];
  return 0;
};

/** Names in a sentence: "Module Name", "Module Name and Read Access Driver", "Module Name, Read Access Driver and Write Access Driver". */
const listed = (names: readonly string[]): string => (names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`);

/** The table, from the export's tables (the Details file need not be among them), or what is missing where there is
 * nothing to make it from: Line Items was not exported, or lacks the column that says which module a line item is in or
 * one of the two that name a driver. A model that drives no access has the three columns and gives a table without
 * rows. Anything else that keeps the table from being made is thrown. */
export function accessTable(tables: readonly ResultTable[]): AccessTable | NoAccessTable {
  const { graph: { nodes, edges, unresolved }, exported, lacks, leftOut } = readAccess(tables);
  if (!exported) return { missing: "Line Items was not exported." };
  if (lacks.length) return { missing: `Line Items has no ${listed(lacks)} ${lacks.length === 1 ? "column" : "columns"}.` };

  /** A module's own row or a line item, as two cells: its module's name, and its own where it is a line item. */
  const cells = (node: GraphNode): [string, string] => (node.module === undefined ? [node.name, ""] : [nodes[node.module].name, node.name]);
  const matched: Use[] = [];
  const unmatched: Use[] = [];
  // The rows of Line Items the map places: its links, and what it could not match, which it holds once for the cell,
  // under the column's name, with the cell as it is written.
  for (const [from, to, kind] of edges) {
    const access = accessOf(kind);
    if (access >= 0) matched.push({ place: [nodes[from].row, access, nodes[to].row], cells: [...cells(nodes[from]), ACCESS[access][1], ...cells(nodes[to])] });
  }
  for (const { source, field, reference } of unresolved) {
    const access = accessOf(DRIVERS.find(([column]) => column === field)?.[1]);
    if (access >= 0) unmatched.push({ place: [nodes[source].row, access], cells: ["", reference, ACCESS[access][1], ...cells(nodes[source])] });
  }
  // The rows the map leaves out: each driver cell of theirs, with what the map reads it as.
  for (const { row, module, lineItem, kind, written, driver } of leftOut) {
    const access = accessOf(kind);
    if (driver === undefined) unmatched.push({ place: [row, access], cells: ["", written, ACCESS[access][1], module, lineItem] });
    else matched.push({ place: [nodes[driver].row, access, row], cells: [...cells(nodes[driver]), ACCESS[access][1], module, lineItem] });
  }
  return { table: { headers: [...ACCESS_HEADERS], rows: [...matched.sort(byPlace), ...unmatched.sort(byPlace)].map(use => use.cells) }, unmatched: unmatched.length };
}
