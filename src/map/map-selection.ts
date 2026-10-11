import type { ViewGraph, ViewNode } from "./map-graphs.js";
import type { MapModel } from "./map-model.js";

/** Names survive a fresh reading whose node numbers, formulas and counts have changed. */
export function selectionKey(model: MapModel, node: ViewNode): string {
  const raw = node.raw;
  return JSON.stringify([node.kind, raw?.kind ?? "group", node.fullName,
    model.node(raw?.module)?.name ?? "", model.node(raw?.parent)?.name ?? ""]);
}

/** A missing or ambiguous name selects nothing. */
export function keptSelection(model: MapModel, graph: ViewGraph, key: string | undefined): ViewNode | undefined {
  if (key === undefined) return undefined;
  // Before outside module boxes were combined, a whole-module link could select a separate module box.
  const matches = graph.nodes.filter(node => selectionKey(model, node) === key
    || (node.kind === "externalModule" && selectionKey(model, { ...node, kind: "module" }) === key));
  return matches.length === 1 ? matches[0] : undefined;
}
