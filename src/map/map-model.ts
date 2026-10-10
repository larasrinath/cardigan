import type { EdgeKind, GraphEdge, GraphNode, ModelGraph, Unresolved } from "./graph-types.js";
import type { Grouping } from "./map-groups.js";

/** A model's graph, looked up the ways the map asks for it: its modules and their line items, its sections, the links
 * that make a dependency (a formula's, and who may read or write), and each node's links in and out. It reads the graph
 * and changes nothing in it. A link that names a node the graph does not hold, and a line item without a module of the
 * graph, are left out rather than trusted. */

/** The heading a module without one is filed under (graph-types.ts). */
export const UNGROUPED = "Ungrouped";

const FORMULA: ReadonlySet<EdgeKind> = new Set<EdgeKind>(["reference", "list_formula"]);
const ACCESS: ReadonlySet<EdgeKind> = new Set<EdgeKind>(["read_access", "write_access"]);
/** Whether a link says who may read or write, and not what a formula reads. */
export const isAccess = (kind: EdgeKind): boolean => ACCESS.has(kind);

/** An action that loads into a module, works on it or takes it, and which of the three. */
export interface ModuleAction { action: GraphNode; kind: EdgeKind }

export interface MapModel {
  readonly graph: ModelGraph;
  /** In the graph's order, which is the order of the Line Items file. */
  readonly modules: readonly GraphNode[];
  /** Every line item that has a module. */
  readonly lineItems: readonly GraphNode[];
  /** The graph's sections, then any other heading a module names, in the modules' order. */
  readonly sections: readonly string[];
  readonly formulaEdges: readonly GraphEdge[];
  readonly accessEdges: readonly GraphEdge[];
  node(id: number | undefined): GraphNode | undefined;
  itemsOf(module: number): readonly GraphNode[];
  /** The section of a module, or of a line item's module. */
  sectionOf(node: GraphNode): string;
  /** A section's place among `sections`, or -1. */
  sectionIndex(section: string): number;
  /** The module a node belongs to: a module itself, a line item's module. Nothing else has one. */
  moduleOf(node: GraphNode | undefined): number | undefined;
  /** The formula and access links into a node, and out of it, in the graph's order. */
  incoming(id: number): readonly GraphEdge[];
  outgoing(id: number): readonly GraphEdge[];
  actionsOf(module: number): readonly ModuleAction[];
  unresolvedOf(id: number): readonly Unresolved[];
  /** How the modules are filed into the sections, where the map chose a grouping (`withGrouping`); none where the
   * sections are the heading rows the graph gives. */
  readonly grouping?: Grouping;
}

const NONE: readonly never[] = [];

export function indexModel(graph: ModelGraph): MapModel {
  const byId = new Map<number, GraphNode>();
  for (const node of graph.nodes) byId.set(node.id, node);

  const modules = graph.nodes.filter(node => node.kind === "module");
  const items = new Map<number, GraphNode[]>(modules.map(module => [module.id, []]));
  const lineItems: GraphNode[] = [];
  for (const node of graph.nodes) {
    if (node.kind !== "lineItem" || node.module === undefined) continue;
    const owned = items.get(node.module);
    if (!owned) continue;
    owned.push(node);
    lineItems.push(node);
  }

  const moduleOf = (node: GraphNode | undefined): number | undefined => {
    if (!node) return undefined;
    if (node.kind === "module") return node.id;
    return node.module !== undefined && items.has(node.module) ? node.module : undefined;
  };
  const sectionOf = (node: GraphNode): string => {
    const module = node.kind === "module" ? node : byId.get(moduleOf(node) ?? -1);
    return (module ?? node).group ?? UNGROUPED;
  };

  const sections = [...new Set(graph.sections)];
  const known = new Set(sections);
  for (const module of modules) {
    const section = sectionOf(module);
    if (!known.has(section)) {
      known.add(section);
      sections.push(section);
    }
  }
  const sectionPlace = new Map(sections.map((section, index) => [section, index]));

  const formulaEdges: GraphEdge[] = [];
  const accessEdges: GraphEdge[] = [];
  const into = new Map<number, GraphEdge[]>();
  const outOf = new Map<number, GraphEdge[]>();
  const actions = new Map<number, ModuleAction[]>();
  const file = (map: Map<number, GraphEdge[]>, id: number, edge: GraphEdge): void => {
    const edges = map.get(id);
    if (edges) edges.push(edge); else map.set(id, [edge]);
  };
  for (const edge of graph.edges) {
    const [from, to, kind] = edge;
    const first = byId.get(from);
    const second = byId.get(to);
    if (!first || !second) continue;
    if (FORMULA.has(kind) || ACCESS.has(kind)) {
      (FORMULA.has(kind) ? formulaEdges : accessEdges).push(edge);
      file(into, to, edge);
      file(outOf, from, edge);
      continue;
    }
    // An import loads into the module and an action works on it: the action is the first node. An export takes the
    // module: the action is the second.
    const [module, action] = kind === "export_source" ? [first, second] : kind === "import_target" || kind === "action_target" ? [second, first] : [undefined, undefined];
    if (module?.kind !== "module" || !action) continue;
    const listed = actions.get(module.id);
    if (listed) listed.push({ action, kind }); else actions.set(module.id, [{ action, kind }]);
  }

  const unresolved = new Map<number, Unresolved[]>();
  for (const entry of graph.unresolved) {
    const entries = unresolved.get(entry.source);
    if (entries) entries.push(entry); else unresolved.set(entry.source, [entry]);
  }

  return {
    graph, modules, lineItems, sections, formulaEdges, accessEdges, moduleOf, sectionOf,
    node: id => (id === undefined ? undefined : byId.get(id)),
    itemsOf: module => items.get(module) ?? NONE,
    sectionIndex: section => sectionPlace.get(section) ?? -1,
    incoming: id => into.get(id) ?? NONE,
    outgoing: id => outOf.get(id) ?? NONE,
    actionsOf: module => actions.get(module) ?? NONE,
    unresolvedOf: id => unresolved.get(id) ?? NONE,
  };
}

/** The same model with its modules filed by a grouping (map-groups.ts): its sections are the grouping's groups, and the
 * section of a module, and of its line items, is the module's group. Anything else keeps its own: a list its heading in
 * General Lists. Nothing else of the model changes. */
export function withGrouping(model: MapModel, grouping: Grouping): MapModel {
  const sections = [...grouping.groups];
  const place = new Map(sections.map((section, index) => [section, index]));
  const sectionOf = (node: GraphNode): string => {
    const module = model.moduleOf(node);
    return (module === undefined ? undefined : grouping.groupOf.get(module)) ?? model.sectionOf(node);
  };
  return { ...model, sections, sectionOf, sectionIndex: section => place.get(section) ?? -1, grouping };
}
