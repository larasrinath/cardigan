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

/** A search over one model. What it compares is put in lower case once, at the first search. `sections` says whether
 * sections are found: a map that has no sections to show (map-view.ts) finds none. */
export function createSearch(model: MapModel, sections = true): (typed: string, limit?: number) => SearchOutcome {
  let entries: { hit: SearchHit; name: string; text: string }[] | undefined;
  const all = (): NonNullable<typeof entries> => entries ??= [
    ...(sections ? model.sections : []).map((section, index) => {
      const modules = model.modules.filter(module => model.sectionOf(module) === section).length;
      return { hit: { kind: "section" as const, section: index, name: section, context: `Section · ${plural(modules, "module")}` }, name: section.toLowerCase(), text: section.toLowerCase() };
    }),
    // A module says its section, where the map has sections to show, and where the section comes from where the map
    // chose how to group the modules.
    ...model.modules.map(module => ({
      hit: { kind: "module" as const, node: module, name: module.name, context: sections ? ["Module", model.sectionOf(module), ...(model.grouping ? [model.grouping.source] : [])].join(" · ") : "Module" },
      name: module.name.toLowerCase(), text: module.name.toLowerCase(),
    })),
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

/** Each object's name in lower case, made once for a model's graph, whichever grouping its modules are in. */
const lowered = new WeakMap<MapModel["graph"], Map<number, string>>();
function namesOf(model: MapModel): Map<number, string> {
  let names = lowered.get(model.graph);
  if (!names) {
    names = new Map(model.graph.nodes.map(node => [node.id, node.name.toLowerCase()]));
    lowered.set(model.graph, names);
  }
  return names;
}

/** Which boxes of the graph on screen the text leads to, by their place: a box the text names, and a box that holds
 * something the text names (a section its modules and their line items, a module its line items). So a search for a
 * line item marks its module and its section where those are what is on screen. Nothing when no text is typed, and
 * nothing when no box on screen is meant: the picture is then left as it is, not faded as a whole. */
export function matchNodes(graph: ViewGraph, model: MapModel, typed: string): Uint8Array | undefined {
  const query = searchText(typed);
  if (query === "") return undefined;
  const names = namesOf(model);
  const named = (id: number): boolean => names.get(id)?.includes(query) ?? false;
  /** The modules the text names, or that hold a line item it names. */
  const modules = new Set<number>();
  for (const module of model.modules) if (named(module.id)) modules.add(module.id);
  for (const item of model.lineItems) if (item.module !== undefined && named(item.id)) modules.add(item.module);
  const matches = new Uint8Array(graph.nodes.length);
  let any = false;
  for (const node of graph.nodes) {
    let hit = `${node.fullName} ${node.code}`.toLowerCase().includes(query);
    if (!hit && node.kind === "section") hit = (node.members ?? []).some(module => modules.has(module));
    else if (!hit && node.kind === "module" && node.raw) hit = modules.has(node.raw.id);
    else if (!hit && node.kind === "externalModule") hit = (node.members ?? []).some(named);
    if (hit) {
      matches[node.index] = 1;
      any = true;
    }
  }
  return any ? matches : undefined;
}
