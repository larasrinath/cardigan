import type { ViewGraph, ViewNode } from "./map-graphs.js";
import type { MapModel } from "./map-model.js";

/** Names survive a fresh reading whose node numbers, formulas and counts have changed. */
export function selectionKey(model: MapModel, node: ViewNode): string {
  const raw = node.raw;
  return JSON.stringify([node.kind, raw?.kind ?? "group", node.fullName,
    model.node(raw?.module)?.name ?? "", model.node(raw?.parent)?.name ?? ""]);
}

/** A missing or ambiguous name selects nothing, and so does a box the view does not have: another module's box, kept
 * while other modules' line items stood grouped, where they now stand one by one. */
export function keptSelection(model: MapModel, graph: ViewGraph, key: string | undefined): ViewNode | undefined {
  if (key === undefined) return undefined;
  // Before outside module boxes were combined, a whole-module link could select a separate module box.
  const matches = graph.nodes.filter(node => selectionKey(model, node) === key
    || (node.kind === "externalModule" && selectionKey(model, { ...node, kind: "module" }) === key));
  return matches.length === 1 ? matches[0] : undefined;
}

/** The line item whose source inputs the map shows, as the page keeps it (graph-types.ts `MapView.sources`): by its
 * module's name and its own, which a fresh reading keeps. Nothing for a node that is no line item of a module. */
export function sourcesKey(model: MapModel, lineItem: number): string | undefined {
  const node = model.node(lineItem);
  const module = model.node(model.moduleOf(node));
  return node?.kind === "lineItem" && module ? JSON.stringify([module.name, node.name]) : undefined;
}

/** That line item again, by its key: nothing where the model has no line item of those names, or more than one, and for a
 * key that is not one. */
export function keptSources(model: MapModel, key: string | undefined): number | undefined {
  let names: unknown;
  try { names = key === undefined ? undefined : JSON.parse(key); } catch { return undefined; }
  if (!Array.isArray(names) || names.length !== 2 || !names.every(name => typeof name === "string")) return undefined;
  const found = model.lineItems.filter(item => item.name === names[1] && model.node(item.module)?.name === names[0]);
  return found.length === 1 ? found[0].id : undefined;
}
