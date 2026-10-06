import type { GraphNode } from "./graph-types.js";
import type { ViewGraph } from "./map-graphs.js";
import type { MapModel } from "./map-model.js";
import { plural } from "./map-text.js";

/** The map's search: over the whole model, whatever is on screen. It finds sections by their name, modules by their
 * name, and line items by their name or their module's: the text typed, anywhere in it, whatever its case. */

export interface SearchHit {
  kind: "section" | "module" | "lineItem";
  /** A section's place among the model's sections. */
  section?: number;
  /** The module or the line item. */
  node?: GraphNode;
  name: string;
  /** Where it is: a module's section, a line item's module, a section's size. */
  context: string;
}

export interface SearchOutcome {
  /** The first hits, at most the limit asked for. */
  hits: SearchHit[];
  /** How many there are in all. */
  total: number;
}

export const SEARCH_LIMIT = 50;

/** What was typed, as the search compares it. */
export const searchText = (typed: string): string => typed.trim().toLowerCase();

/** A search over one model. What it compares is put in lower case once, at the first search. */
export function createSearch(model: MapModel): (typed: string, limit?: number) => SearchOutcome {
  let entries: { hit: SearchHit; name: string; text: string }[] | undefined;
  const all = (): NonNullable<typeof entries> => entries ??= [
    ...model.sections.map((section, index) => {
      const modules = model.modules.filter(module => model.sectionOf(module) === section).length;
      return { hit: { kind: "section" as const, section: index, name: section, context: `Section · ${plural(modules, "module")}` }, name: section.toLowerCase(), text: section.toLowerCase() };
    }),
    ...model.modules.map(module => ({ hit: { kind: "module" as const, node: module, name: module.name, context: `Module · ${model.sectionOf(module)}` }, name: module.name.toLowerCase(), text: module.name.toLowerCase() })),
    ...model.lineItems.map(item => {
      const module = model.node(item.module)?.name ?? "";
      return { hit: { kind: "lineItem" as const, node: item, name: item.name, context: module }, name: item.name.toLowerCase(), text: `${item.name} ${module}`.toLowerCase() };
    }),
  ];
  return (typed, limit = SEARCH_LIMIT) => {
    const query = searchText(typed);
    if (query === "") return { hits: [], total: 0 };
    // What is named exactly as typed comes first; the rest keeps the model's order.
    const exact: SearchHit[] = [];
    const rest: SearchHit[] = [];
    let total = 0;
    for (const entry of all()) {
      if (!entry.text.includes(query)) continue;
      total++;
      if (entry.name === query) exact.push(entry.hit);
      else if (exact.length + rest.length < limit) rest.push(entry.hit);
    }
    return { hits: [...exact, ...rest].slice(0, limit), total };
  };
}

/** Which nodes of the graph on screen the text names, by their place: the text anywhere in a node's name or code. */
export function matchNodes(graph: ViewGraph, typed: string): Uint8Array | undefined {
  const query = searchText(typed);
  if (query === "") return undefined;
  const matches = new Uint8Array(graph.nodes.length);
  for (const node of graph.nodes) if (`${node.fullName} ${node.code}`.toLowerCase().includes(query)) matches[node.index] = 1;
  return matches;
}
