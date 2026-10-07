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

/** Rows in any order: what a test compares where the order is not what it is about. */
const anyOrder = (rows: readonly (readonly unknown[])[]): string[] => rows.map(row => JSON.stringify(row)).sort();

/** A Dynamic Cell Access table's rows beside the map's word for the same tables, for a test to expect the two equal:
 * each as the links, then the driver cells that were not matched, both in any order. The table's last rows are taken for
 * its unmatched ones, as many as the map has: so the table agrees with the map only when it has every link of the map
 * once, then every such cell once, and nothing else. */
export function againstMap(rows: readonly (readonly unknown[])[], tables: readonly ResultTable[]): { table: string[][]; map: string[][] } {
  const said = mapAccess(tables);
  const matched = Math.max(0, rows.length - said.unmatched.length);
  return { table: [anyOrder(rows.slice(0, matched)), anyOrder(rows.slice(matched))], map: [anyOrder(said.links), anyOrder(said.unmatched)] };
}
