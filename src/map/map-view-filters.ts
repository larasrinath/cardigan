import type { GraphEdge, ModelGraph, SavedViewFilter, ViewFilter, ViewFilterCheck } from "./graph-types.js";

/** The filters of a model's saved views on the map. A saved view of a module can filter its rows or its columns by
 * conditions on line items: each condition filters the saved view's module by its line item, as a filter on a page card
 * filters the grid of a module by its condition line item (build-graph.ts `readPageFilters`). The page gives them to the
 * map apart from the export's tables (graph-types.ts `ModelMapOptions.savedViewFilters`), by names. The map finds each
 * condition's line item, and the saved view's module, by those names as it finds a page filter's (`looseNames`), and links
 * the line item to the module (`view_filter`). A saved view filters its whole module, so the link is to the module: no
 * line item of it stands for what it filters. A saved view of the line item's own module has no link, as a link from a
 * line item to its own module is no link between two modules: the module is marked for it where the map draws its
 * filters, as it is for a filter on a page card by one of its own line items (map-model.ts). The graph is built from the
 * export's tables alone (build-graph.ts), and so is the model's reader that builds it: what the page gives the map is
 * added to it here, and the reader is left as it is. */

/** A name as the page gave it: nothing for what is no text. */
const text = (value: unknown): string => (typeof value === "string" ? value : "");

/** Whether a name says nothing: it is empty, or the dash that stands for none (graph-names.ts `nothing`). */
const nothing = (name: string): boolean => {
  const trimmed = name.trim();
  return trimmed === "" || trimmed === "-";
};

/** A name without the spaces at its ends, and with each run of spaces inside it made one space. */
const spacedOnce = (name: string): string => name.trim().replace(/\s+/g, " ");

/** Names looked up loosely, by the rule the graph finds the rows of other tables by (build-graph.ts `looseNames`): as
 * written, or where nothing has that, without the spaces at their ends, or with each run of spaces made one, each where
 * one of the names alone has it. Two names that differ only so are taken for one. */
function looseNames(names: Iterable<readonly [string, number]>): (name: string) => number | undefined {
  const exact = new Map<string, number>();
  const trimmed = new Map<string, number | undefined>();
  const spaced = new Map<string, number | undefined>();
  for (const [name, id] of names) {
    if (!exact.has(name)) exact.set(name, id);
    const key = name.trim();
    trimmed.set(key, trimmed.has(key) ? undefined : id);
    const loose = spacedOnce(name);
    spaced.set(loose, spaced.has(loose) ? undefined : id);
  }
  return name => exact.get(name) ?? trimmed.get(name.trim()) ?? spaced.get(spacedOnce(name));
}

/** The graph with the saved views' filters (`filters`): each line item that is the condition of a filter of a saved view
 * whose module the map has, with those saved views (`GraphNode.viewFilters`), each once however many of its conditions
 * name the line item; and a link from the line item to each of their modules but its own, once however many saved views
 * of a module it filters. A condition whose line item or saved view's module the map does not have says nothing on the
 * map, and is counted (`ModelGraph.viewFilterCheck`). The graph given is not changed: the line items with saved views'
 * filters are new nodes in their places, every node keeps its place, and the links keep their fixed order. Without
 * filters, as for a result read before saved views' filters were, or an app's, it is the graph given, itself. */
export function withSavedViewFilters(graph: ModelGraph, filters: readonly SavedViewFilter[] | undefined): ModelGraph {
  if (!Array.isArray(filters)) return graph;
  // The modules, and each module's line items, found by their names: a line item among its own module's alone.
  const moduleNamed = looseNames(graph.nodes.flatMap(node => (node.kind === "module" ? [[node.name, node.id] as const] : [])));
  const itemsOf = new Map<number, [string, number][]>();
  for (const node of graph.nodes) {
    if (node.kind !== "lineItem" || node.module === undefined) continue;
    const items = itemsOf.get(node.module);
    if (items) items.push([node.name, node.id]); else itemsOf.set(node.module, [[node.name, node.id]]);
  }
  const named = new Map<number, (name: string) => number | undefined>();
  const lineItemNamed = (module: number, name: string): number | undefined => {
    let find = named.get(module);
    if (!find) named.set(module, find = looseNames(itemsOf.get(module) ?? []));
    return find(name);
  };

  const check: ViewFilterCheck = { conditions: 0, found: 0, own: 0, other: 0, off: 0, invalid: 0, noLineItem: 0, noModule: 0, missingLineItems: [], missingModules: [] };
  const missingLineItems = new Set<string>();
  const missingModules = new Set<string>();
  const views = new Map<number, ViewFilter[]>();
  const known = new Set(graph.edges.map(([from, to, kind]) => `${from} ${to} ${kind}`));
  const links = new Map<string, GraphEdge>();
  for (const filter of filters as readonly unknown[]) {
    if (filter === null || typeof filter !== "object") continue;
    const condition = filter as Partial<Record<keyof SavedViewFilter, unknown>>;
    check.conditions++;
    const [module, lineItem] = [text(condition.lineItemModule), text(condition.lineItem)];
    const home = nothing(module) ? undefined : moduleNamed(module);
    const id = home === undefined || nothing(lineItem) ? undefined : lineItemNamed(home, lineItem);
    if (id === undefined) {
      check.noLineItem++;
      missingLineItems.add(`${nothing(module) ? "-" : module.trim()} · ${nothing(lineItem) ? "-" : lineItem.trim()}`);
      continue;
    }
    const written = text(condition.module);
    const filtered = nothing(written) ? undefined : moduleNamed(written);
    if (filtered === undefined) {
      check.noModule++;
      missingModules.add(nothing(written) ? "-" : written.trim());
      continue;
    }
    check.found++;
    const own = filtered === graph.nodes[id].module;
    if (own) check.own++; else check.other++;
    // Anything but false is on, and valid: the page says so of each condition.
    const [active, valid] = [condition.active !== false, condition.valid !== false];
    if (!active) check.off++;
    if (!valid) check.invalid++;
    // A saved view is named once for the line item, whatever number of its conditions name it: its filter by the line
    // item is on where one of them is, and valid where all of them are.
    const view = text(condition.view).trim();
    const listed = views.get(id);
    const same = listed?.find(each => each.view === view && each.module === filtered);
    if (same) {
      same.active ||= active;
      same.valid &&= valid;
    } else if (listed) listed.push({ view, module: filtered, active, valid });
    else views.set(id, [{ view, module: filtered, active, valid }]);
    const key = `${id} ${filtered} view_filter`;
    if (!own && !known.has(key)) links.set(key, [id, filtered, "view_filter"]);
  }
  check.missingLineItems = [...missingLineItems];
  check.missingModules = [...missingModules];
  // The links in the graph's fixed order: by first node, second node and kind (build-graph.ts).
  const edges = [...graph.edges, ...links.values()].sort((a, b) => a[0] - b[0] || a[1] - b[1] || (a[2] < b[2] ? -1 : a[2] > b[2] ? 1 : 0));
  const nodes = graph.nodes.map(node => {
    const of = views.get(node.id);
    return of ? { ...node, viewFilters: of } : node;
  });
  return { ...graph, nodes, edges, viewFilterCheck: check };
}

/** How many names of a side the log line gives, as the graph's other lines do (build-graph.ts): the first of them, then
 * how many more there are. */
const NAMES_SAID = 5;

const count = (amount: number, one: string, many: string): string => (amount === 1 ? `1 ${one}` : `${amount} ${many}`);

/** The run's log line for how the saved views' filters met the map (`ViewFilterCheck`), in the words of the line for the
 * filters on page cards (build-graph.ts `pageFilterCheckLine`): how many conditions; how many have their line item and
 * their saved view's module on the map, and of those how many are on the line item's own module and how many on another,
 * with how many are off and how many not valid; then how many have a line item the map does not have, and how many a
 * saved view's module it does not have, with the first five names of each. */
export function viewFilterCheckLine(check: ViewFilterCheck): string {
  const names = (list: readonly string[]): string => (list.length === 0 ? "" : `: ${list.slice(0, NAMES_SAID).join("; ")}${list.length > NAMES_SAID ? `; and ${list.length - NAMES_SAID} more` : ""}`);
  const states = [check.off ? `${check.off} off` : "", check.invalid ? `${check.invalid} not valid` : ""].filter(part => part !== "").join(", ");
  const found = check.found === 0 ? "" : ` (${check.own} on the line item's own module, ${check.other} on another module${states ? `; ${states}` : ""})`;
  return `Saved view filters: ${count(check.conditions, "condition", "conditions")}; ${check.found} with the line item and the saved view's module on the map${found}; `
    + `${check.noLineItem} with a line item the map does not have${names(check.missingLineItems)}; `
    + `${check.noModule} with a saved view's module the map does not have${names(check.missingModules)}.`;
}
