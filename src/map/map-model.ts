import type { EdgeKind, GraphEdge, GraphNode, ModelGraph, PageFilter, Unresolved, ViewFilter } from "./graph-types.js";
import type { Grouping } from "./map-groups.js";

/** A model's graph, looked up the ways the map asks for it: its modules and their line items, its sections, the links
 * that make a dependency (a formula's, and who may read or write), the links of filters, on page cards and in saved views,
 * and each node's links in and out. It reads the graph
 * and changes nothing in it. A link that names a node the graph does not hold, and a line item without a module of the
 * graph, are left out rather than trusted. */

/** The heading a module without one is filed under (graph-types.ts). */
export const UNGROUPED = "Ungrouped";

const FORMULA: ReadonlySet<EdgeKind> = new Set<EdgeKind>(["reference", "list_formula"]);
const ACCESS: ReadonlySet<EdgeKind> = new Set<EdgeKind>(["read_access", "write_access"]);
/** Whether a link is a formula's: what a line item's formula reads, or what a list's formula does. */
export const isFormula = (kind: EdgeKind): boolean => FORMULA.has(kind);
/** Whether a link says who may read or write, and not what a formula reads. */
export const isAccess = (kind: EdgeKind): boolean => ACCESS.has(kind);
/** Whether a link is a filter's: one on a page card, from its condition line item to a line item it filters, or to the
 * module it filters where which line items is not known (graph-types.ts `page_filter`); or one of a saved view, from its
 * condition line item to the saved view's module (`view_filter`). No formula reads it, and the map draws it only where
 * asked to, as it does the links of access. */
export const isFilter = (kind: EdgeKind): boolean => kind === "page_filter" || kind === "view_filter";

/** A line item that filters cards of a module on the pages built on the model, or a line item they show, with those
 * filters (graph-types.ts `PageFilter`), in the Page Filters table's order; and, for a module, the saved views of it whose
 * filters have the line item as their condition (`views`, graph-types.ts `ViewFilter`), where there are any, in the order
 * the page gave them. */
export interface ModuleFilter { item: GraphNode; uses: readonly PageFilter[]; views?: readonly ViewFilter[] }

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
  /** Whether this line item drives read or write access, and how many distinct drivers its module holds. */
  isAccessDriver(lineItem: number): boolean;
  accessDriversOf(module: number): number;
  /** The links of filters, on page cards and in saved views (`isFilter`), in the graph's order. */
  readonly filterEdges: readonly GraphEdge[];
  node(id: number | undefined): GraphNode | undefined;
  itemsOf(module: number): readonly GraphNode[];
  /** The section of a module, or of a line item's module. */
  sectionOf(node: GraphNode): string;
  /** A section's place among `sections`, or -1. */
  sectionIndex(section: string): number;
  /** The module a node belongs to: a module itself, a line item's module. Nothing else has one. */
  moduleOf(node: GraphNode | undefined): number | undefined;
  /** The formula, access and filter links into a node, and out of it, in the graph's order. */
  incoming(id: number): readonly GraphEdge[];
  outgoing(id: number): readonly GraphEdge[];
  actionsOf(module: number): readonly ModuleAction[];
  /** The line items whose filters, on page cards or in saved views of it, filter a module, each once with those of its
   * filters, in the order of the line items: its own line items among them, which have no link to it. */
  filtersOf(module: number): readonly ModuleFilter[];
  /** The line items whose page filters filter a line item, as the grid they narrow shows it, each with those of its
   * filters, in the order of the line items. A line item that filters itself is not among its own. A saved view filters
   * its whole module, and no line item of it: none is among these. */
  filtersOfItem(lineItem: number): readonly ModuleFilter[];
  /** How many of a module's own line items filter it, on page cards or in saved views of it: a filter that no link between
   * modules can show, for its line item and the module it filters are one module. The map marks the module with it where
   * it draws the filters. */
  ownFiltersOf(module: number): number;
  /** Whether a line item filters itself, which no link shows: a grid of its own module on a page card that it filters
   * shows it too, or does not say which line items it shows; or it filters a saved view of its own module, which narrows
   * the whole module. The map marks the line item for it among its module's. */
  filtersItself(lineItem: number): boolean;
  /** How many modules their own line items filter. */
  readonly ownFiltered: number;
  /** How many of the filters' links join line items, or a line item and a module, of two modules: those the map draws
   * between modules. */
  readonly filtersBetween: number;
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
  const filterEdges: GraphEdge[] = [];
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
    if (FORMULA.has(kind) || ACCESS.has(kind) || isFilter(kind)) {
      (FORMULA.has(kind) ? formulaEdges : ACCESS.has(kind) ? accessEdges : filterEdges).push(edge);
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

  const accessDrivers = new Set(accessEdges.map(([from]) => from).filter(id => byId.get(id)?.kind === "lineItem"));
  const driversOf = new Map<number, number>();
  for (const item of lineItems) if (accessDrivers.has(item.id)) driversOf.set(item.module!, (driversOf.get(item.module!) ?? 0) + 1);

  // Each module's filters, on page cards and in saved views of it: the line items whose filters name it, its own
  // included, each once with both kinds of its filters.
  const filters = new Map<number, ModuleFilter[]>();
  for (const item of lineItems) {
    const byModule = new Map<number, { uses: PageFilter[]; views: ViewFilter[] }>();
    const of = (module: number): { uses: PageFilter[]; views: ViewFilter[] } => {
      let found = byModule.get(module);
      if (!found) byModule.set(module, found = { uses: [], views: [] });
      return found;
    };
    for (const use of item.pageFilters ?? []) {
      for (const module of use.modules ?? []) if (items.has(module)) of(module).uses.push(use);
    }
    for (const view of item.viewFilters ?? []) if (items.has(view.module)) of(view.module).views.push(view);
    for (const [module, { uses, views }] of byModule) {
      const filter: ModuleFilter = { item, uses, ...(views.length ? { views } : {}) };
      const listed = filters.get(module);
      if (listed) listed.push(filter); else filters.set(module, [filter]);
    }
  }

  // Each module's filters by its own line items, which no link between modules shows: how many of its line items.
  const ownFilters = new Map<number, number>();
  for (const [module, listed] of filters) {
    const own = listed.filter(({ item }) => item.module === module).length;
    if (own) ownFilters.set(module, own);
  }

  // Each line item's filters by the line items they filter, and the line items that filter themselves: those that a grid
  // of their own module shows as well, those that filter their own module where it is not known which line items, and
  // those that filter a saved view of their own module, which narrows it whole.
  const itemFilters = new Map<number, ModuleFilter[]>();
  const itself = new Set<number>();
  for (const item of lineItems) {
    if (item.viewFilters?.some(view => view.module === item.module)) itself.add(item.id);
    const byItem = new Map<number, PageFilter[]>();
    for (const use of item.pageFilters ?? []) {
      const shown = use.lineItems ?? [];
      const known = new Set(shown.map(id => byId.get(id)?.module));
      if (shown.includes(item.id) || (use.modules?.includes(item.module!) && !known.has(item.module))) itself.add(item.id);
      for (const id of shown) {
        if (id === item.id || byId.get(id)?.kind !== "lineItem") continue;
        const uses = byItem.get(id);
        if (uses) uses.push(use); else byItem.set(id, [use]);
      }
    }
    for (const [id, uses] of byItem) {
      const listed = itemFilters.get(id);
      if (listed) listed.push({ item, uses }); else itemFilters.set(id, [{ item, uses }]);
    }
  }
  const filtersBetween = filterEdges.filter(([from, to]) => moduleOf(byId.get(from)) !== moduleOf(byId.get(to))).length;

  const unresolved = new Map<number, Unresolved[]>();
  for (const entry of graph.unresolved) {
    const entries = unresolved.get(entry.source);
    if (entries) entries.push(entry); else unresolved.set(entry.source, [entry]);
  }

  return {
    graph, modules, lineItems, sections, formulaEdges, accessEdges, filterEdges, moduleOf, sectionOf,
    isAccessDriver: lineItem => accessDrivers.has(lineItem),
    accessDriversOf: module => driversOf.get(module) ?? 0,
    node: id => (id === undefined ? undefined : byId.get(id)),
    itemsOf: module => items.get(module) ?? NONE,
    sectionIndex: section => sectionPlace.get(section) ?? -1,
    incoming: id => into.get(id) ?? NONE,
    outgoing: id => outOf.get(id) ?? NONE,
    actionsOf: module => actions.get(module) ?? NONE,
    filtersOf: module => filters.get(module) ?? NONE,
    filtersOfItem: lineItem => itemFilters.get(lineItem) ?? NONE,
    ownFiltersOf: module => ownFilters.get(module) ?? 0,
    filtersItself: lineItem => itself.has(lineItem),
    ownFiltered: ownFilters.size,
    filtersBetween,
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
