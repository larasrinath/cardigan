import { buildModelGraph } from "../map/build-graph.js";
import type { ResultTable } from "../result-types.js";

/** What the model map says of who may read and write, for a test to hold Dynamic Cell Access.csv against. Tests only.
 *
 * The page builds its map from a result's tables with `buildModelGraph` (results/main.ts), and draws the graph's
 * `read_access` and `write_access` links when Access drivers is chosen; a box's details list the names in its row that
 * matched nothing. Here both are read off that same graph, each in the five cells of a row of the file: the driver's
 * module and its name, Read or Write, and the module and the name of what is controlled, where a module's own row has
 * no name of a line item. A driver cell that matched no line item has no driver's module, and the cell as it is written. */
export function mapAccess(tables: readonly ResultTable[]): { links: string[][]; unmatched: string[][] } {
  const graph = buildModelGraph(tables);
  const access = new Map([["read_access", "Read"], ["Read Access Driver", "Read"], ["write_access", "Write"], ["Write Access Driver", "Write"]]);
  const named = (id: number): string[] => {
    const node = graph.nodes[id];
    return node.kind === "lineItem" ? [graph.nodes[node.module!].name, node.name] : [node.name, ""];
  };
  return {
    links: graph.edges.flatMap(([from, to, kind]) => (access.has(kind) ? [[...named(from), access.get(kind)!, ...named(to)]] : [])),
    unmatched: graph.unresolved.flatMap(entry => (access.has(entry.field) ? [["", entry.reference, access.get(entry.field)!, ...named(entry.source)]] : [])),
  };
}

/** A driver cell of the Line Items table, as the file has it: Read or Write, the cell, and the Module Name cell and the
 * name of the row it is said of. `ofModule` marks a cell that is the row's module's: the row's own cell is a dash. */
export interface DriverCell { access: string; written: string; module: string; name: string; ofModule?: true }

/** The driver cells that say something for the rows of Line Items that the map does not place: the rows that are no
 * node of its graph, by the row each node says it comes from. A cell says something when it is neither empty nor a dash.
 * For a dash in a row that names a module, the cell is that of the first row above it that has the module's name and
 * can be a module's own, where that cell says something. This is read off the table and the graph's nodes, and not
 * with the code under test. */
export function cellsLeftOut(tables: readonly ResultTable[]): DriverCell[] {
  const lineItems = tables.find(table => table.file === "Line Items.csv");
  if (!lineItems) return [];
  const graph = buildModelGraph(tables);
  const placed = new Set(graph.nodes.filter(node => node.kind === "module" || node.kind === "lineItem").map(node => node.row));
  const text = (row: readonly unknown[], header: string): string => {
    const at = header === "" ? 0 : lineItems.headers.indexOf(header, 1);
    return at < 0 || row[at] === undefined || row[at] === null ? "" : String(row[at]);
  };
  const says = (written: string): boolean => written !== "" && written !== "-";
  /** Whether a row can be a module's own: it names no module, and has nothing of what only a line item has. */
  const ownRow = (row: readonly unknown[]): boolean => ["Module Name", "Format", "Formula", "Summary"].every(header => text(row, header).trim() === "");
  // The header is the file's row 1, so a table's first row is row 2.
  return lineItems.rows.flatMap((row, index) => (placed.has(index + 2) ? [] : ([["Read", "Read Access Driver"], ["Write", "Write Access Driver"]] as const).flatMap(([access, column]): DriverCell[] => {
    const [module, name, written] = [text(row, "Module Name"), text(row, ""), text(row, column)];
    if (says(written)) return [{ access, written, module, name }];
    const above = written === "-" && module.trim() !== "" ? lineItems.rows.slice(0, index).find(other => text(other, "") === module && ownRow(other)) : undefined;
    return above && says(text(above, column)) ? [{ access, written: text(above, column), module, name, ofModule: true }] : [];
  })));
}

/** Rows in any order: what a test compares where the order is not what it is about. */
const anyOrder = (rows: readonly (readonly unknown[])[]): string[] => rows.map(row => JSON.stringify(row)).sort();

/** A Dynamic Cell Access table's rows held against the map of the same tables, for a test to expect:
 * - `placed` equal to `map`: the table has every access link of the map once, and every driver cell the map could not
 *   match once. Each is the links, then those cells, in any order. The table and the map agree on every row of Line
 *   Items that the map places.
 * - `unexplained` and `vanished` both empty. What the table holds beyond the map's rows (`beyond`) is one row for each
 *   driver cell of a row the map does not place (`cellsLeftOut`): with that cell's Read or Write, and with that row
 *   under the two Controlled columns, as a line item by its Module Name cell and its name, or as a module's own row
 *   where it names no module. Such a row either has a driver's module, or has none and the cell as it is written. A
 *   cell that is the row's module's has a row only where it is matched: unmatched, it is the module's row's to say.
 *   `unexplained` are the rows beyond the map that no such cell accounts for, and `vanished` the cells with no row. */
export function againstMap(rows: readonly (readonly unknown[])[], tables: readonly ResultTable[]): { placed: string[][]; map: string[][]; beyond: string[][]; unexplained: string[][]; vanished: DriverCell[] } {
  const said = mapAccess(tables);
  const left = rows.map(row => row.map(cell => String(cell)));
  /** Takes out of the table's rows, once, each row that is one of these. */
  const taken = (wanted: readonly string[][]): string[][] => wanted.filter(row => {
    const at = left.findIndex(candidate => JSON.stringify(candidate) === JSON.stringify(row));
    if (at >= 0) left.splice(at, 1);
    return at >= 0;
  });
  const placed = [anyOrder(taken(said.links)), anyOrder(taken(said.unmatched))];
  const beyond = [...left];
  // A cell's row: one without a driver's module that has the cell as it is written, before one that has a driver's
  // module. Two rows of Line Items may have one name, and the cell of one of them be matched and that of the other not.
  // The cells that are a row's own find their rows first: a cell that is the row's module's need not have one.
  const cells = cellsLeftOut(tables);
  const vanished = [...cells.filter(cell => !cell.ofModule), ...cells.filter(cell => cell.ofModule)].filter(cell => {
    const says = ([, , access, module, name]: string[]): boolean => access === cell.access
      && ((module === cell.module && name === cell.name) || (cell.module.trim() === "" && module === cell.name && name === ""));
    const written = cell.ofModule ? -1 : left.findIndex(row => says(row) && row[0] === "" && row[1] === cell.written);
    const at = written >= 0 ? written : left.findIndex(row => says(row) && row[0] !== "");
    if (at >= 0) left.splice(at, 1);
    return at < 0 && !cell.ofModule;
  });
  return { placed, map: [anyOrder(said.links), anyOrder(said.unmatched)], beyond, unexplained: left, vanished };
}
