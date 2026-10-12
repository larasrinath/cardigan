import { buildModelGraph } from "./map/build-graph.js";
import type { GraphEdge, GraphNode, ModelGraph } from "./map/graph-types.js";
import type { AnalysisResult, Cell, ResultTable } from "./result-types.js";
import { formulaReferences } from "./map/map-formula.js";

/** A formula's references, as the map reads them (map/map-formula.ts): Polaris's formula links are made from them. */
export const polarisReferences = formulaReferences;

/** The Classic graph builder expects a module heading before its line items. Supply those only to the map; the
 * Polaris table remains exactly one row per returned line item. Formula links are added here, outside src/map. */
export function buildPolarisGraph(result: AnalysisResult): ModelGraph {
  const modules = result.tables.find(table => table.file === "Modules.csv");
  const items = result.tables.find(table => table.file === "Line Items.csv");
  if (!items) return buildModelGraph(result.tables);
  const moduleAt = items.headers.indexOf("Module Name");
  const byModule = new Map<string, Cell[][]>();
  const rowNumbers = new Map<Cell[], number>();
  for (const [index, row] of items.rows.entries()) {
    const name = String(row[moduleAt] ?? "");
    if (!byModule.has(name)) byModule.set(name, []);
    byModule.get(name)!.push(row);
    rowNumbers.set(row, index + 2);
  }
  const moduleRows = modules?.rows ?? [...byModule.keys()].map(name => [name]);
  const mapRows: Cell[][] = [];
  const origins = new Map<number, { file: string; row: number }>();
  for (const [index, row] of moduleRows.entries()) {
    const name = String(row[0]);
    const get = (header: string): Cell => row[modules?.headers.indexOf(header) ?? -1] ?? "";
    const own = items.headers.map((header, index): Cell => index === 0 ? name : ["Time Scale", "Time Range", "Versions", "Notes"].includes(header) ? get(header)
      : header === "Applies To" ? get("Dimensions") || get("Applies To") : "");
    origins.set(mapRows.length + 2, { file: "Modules", row: index + 2 });
    mapRows.push(own);
    for (const item of byModule.get(name) ?? []) {
      origins.set(mapRows.length + 2, { file: "Line Items", row: rowNumbers.get(item)! });
      mapRows.push(item);
    }
  }
  const tables: ResultTable[] = result.tables.map(table => table === items ? { ...items, rows: mapRows } : table);
  const graph = buildModelGraph(tables);
  for (const node of graph.nodes) if (node.file === "Line Items") Object.assign(node, origins.get(node.row));
  const locals = new Map<string, GraphNode[]>();
  const qualified = new Map<string, GraphNode[]>();
  const lists = new Map<string, GraphNode[]>();
  const key = (module: string, name: string) => JSON.stringify([module, name]);
  const put = (map: Map<string, GraphNode[]>, key: string, node: GraphNode) => map.set(key, [...map.get(key) ?? [], node]);
  for (const node of graph.nodes) {
    if (node.kind === "lineItem") {
      const module = graph.nodes[node.module!]?.name ?? "";
      put(locals, key(module, node.name), node);
      put(qualified, key(module, node.name), node);
    } else if (node.kind === "list" || node.kind === "subset") put(lists, node.name, node);
  }
  // Duplicate source names must not silently become links to the builder's first kept row.
  const itemCounts = new Map<string, number>();
  for (const row of items.rows) {
    const id = key(String(row[moduleAt]), String(row[0]));
    itemCounts.set(id, (itemCounts.get(id) ?? 0) + 1);
  }
  const unique = (nodes: GraphNode[] | undefined): GraphNode | undefined => {
    if (nodes?.length !== 1) return undefined;
    const node = nodes[0];
    return node.kind === "lineItem" && itemCounts.get(key(graph.nodes[node.module!].name, node.name)) !== 1 ? undefined : node;
  };
  const added: GraphEdge[] = [];
  for (const node of graph.nodes) {
    if (node.kind !== "lineItem" || !node.formula) continue;
    const module = graph.nodes[node.module!].name;
    const seen = new Set<string>();
    for (const ref of formulaReferences(node.formula)) {
      if (seen.has(ref.written)) continue;
      seen.add(ref.written);
      const local = ref.parts.length === 1 ? locals.get(key(module, ref.parts[0])) : undefined;
      const source = ref.parts.length === 2 ? unique(qualified.get(key(ref.parts[0], ref.parts[1])))
        : ref.parts.length === 1 ? unique(local ?? lists.get(ref.parts[0])) : undefined;
      if (source) added.push([source.id, node.id, source.kind === "lineItem" ? "reference" : "list_formula"]);
      else graph.unresolved.push({ source: node.id, field: "Formula", reference: ref.written });
    }
  }
  graph.edges = [...new Map([...graph.edges, ...added].map(edge => [JSON.stringify(edge), edge])).values()]
    .sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2].localeCompare(b[2]));
  graph.limitations = graph.limitations.filter(line => !line.includes("no links from a line item to what refers to it") && !line.includes("no links from a list to the formulas that name it"));
  graph.limitations.push("Polaris formula links match names in the returned line items and lists; formulas are not evaluated, and unmatched or ambiguous references stay unresolved.");
  return graph;
}
