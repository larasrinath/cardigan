import type { GraphNode } from "./graph-types.js";
import { LAYER, sectionLayer, type ViewGraph, type ViewNode } from "./map-graphs.js";
import { isAccess, type MapModel } from "./map-model.js";
import { formatCount, plural } from "./map-text.js";

/** What the inspector says of the node selected, as plain data: the markup (map-markup.ts) writes it out, and escapes
 * every piece of it. Everything here is read from the model's graph; nothing is worked out that the export does not say. */

/** A link of the inspector: to an object of the model, wherever the map has to go to show it (`raw`), or to a node of
 * the graph on screen (`node`). */
export interface InspectLink {
  raw?: number;
  node?: string;
  name: string;
  /** Under the name: a line item's module, a property's list. */
  sub?: string;
  /** Under that: how it is linked, where that is not by a formula. */
  caption?: string;
  layer: string;
}
export interface InspectList { key: string; title: string; open: boolean; links: InspectLink[] }
export interface InspectText { key: string; title: string; lines: string[] }
/** The inspector's main button: open a section's modules, or a module's line items with one of them selected. */
export interface InspectAction { label: string; section?: number; module?: number; select?: number }

export interface Inspection {
  /** What the node is, in capitals: MODULE, LINE ITEM, MODEL SECTION... */
  kind: string;
  layer: string;
  name: string;
  rows: [label: string, value: string][];
  action?: InspectAction;
  formula?: string;
  /** In the formula's place, for a line item without one. */
  remark?: string;
  lists: InspectList[];
  texts: InspectText[];
  notes?: string;
  /** The file and the row the object comes from. */
  source?: string;
}

const KIND_NAMES: Record<GraphNode["kind"], string> = { list: "LIST", subset: "SUBSET", property: "PROPERTY", module: "MODULE", lineItem: "LINE ITEM", process: "PROCESS", action: "ACTION" };

export const isHeading = (node: GraphNode): boolean => node.kind === "lineItem" && node.format?.toUpperCase() === "NONE";

/** The layer an object of the model is drawn in, for the dot beside its name. */
export function layerOfObject(model: MapModel, node: GraphNode): string {
  if (node.kind === "module") return sectionLayer(model.sectionIndex(model.sectionOf(node)));
  if (node.kind === "lineItem") return isHeading(node) ? LAYER.heading : LAYER.lineItem;
  if (node.kind === "property") return LAYER.property;
  return node.kind === "list" || node.kind === "subset" ? LAYER.list : LAYER.external;
}

function objectLink(model: MapModel, node: GraphNode, caption?: string): InspectLink {
  const owner = node.kind === "lineItem" ? model.node(node.module) : node.kind === "property" ? model.node(node.parent) : undefined;
  return { raw: node.id, name: node.name, layer: layerOfObject(model, node), ...(owner ? { sub: owner.name } : {}), ...(caption ? { caption } : {}) };
}

const nodeLink = (node: ViewNode): InspectLink => ({ node: node.id, name: node.fullName, layer: node.layer });

function dimensions(model: MapModel, node: GraphNode): string {
  const names = (node.dimensions ?? []).map(id => model.node(id)?.name).filter((name): name is string => name !== undefined && name !== "");
  if (!names.length) return "None";
  return `${names.join(", ")}${node.inheritsDimensions ? " (the module's)" : ""}`;
}

/** What an object reads (`upstream`) or what reads it, one entry for each object, with the access it gives where the
 * link is one of who may read or write. */
function related(model: MapModel, id: number, upstream: boolean, access: boolean): InspectLink[] {
  const found = new Map<number, Set<string>>();
  for (const edge of upstream ? model.incoming(id) : model.outgoing(id)) {
    if (!access && isAccess(edge[2])) continue;
    const other = edge[upstream ? 0 : 1];
    let kinds = found.get(other);
    if (!kinds) found.set(other, kinds = new Set());
    kinds.add(edge[2]);
  }
  const links: InspectLink[] = [];
  for (const [other, kinds] of found) {
    const node = model.node(other);
    if (node) links.push(objectLink(model, node, [...kinds].filter(kind => kind.includes("access")).map(kind => kind.replace("_", " ")).join(", ")));
  }
  return links;
}

const row = (rows: [string, string][], label: string, value: string | number | undefined): void => {
  if (value !== undefined && value !== "") rows.push([label, String(value)]);
};

function inspectSection(model: MapModel, node: ViewNode): Inspection {
  const members = (node.members ?? []).map(id => model.node(id)).filter((member): member is GraphNode => member !== undefined);
  return {
    kind: "MODEL SECTION", layer: node.layer, name: node.fullName,
    rows: [["modules", formatCount(members.length)], ["contents", node.meta]],
    action: { label: "Open modules", section: node.section },
    lists: [{ key: "modules", title: `Modules · ${formatCount(members.length)}`, open: true, links: members.map(member => objectLink(model, member)) }],
    texts: [],
  };
}

function inspectModule(model: MapModel, graph: ViewGraph, node: ViewNode, raw: GraphNode): Inspection {
  const owned = model.itemsOf(raw.id);
  const rows: [string, string][] = [];
  row(rows, "section", model.sectionOf(raw));
  row(rows, "line items", formatCount(owned.length));
  row(rows, "cells", raw.cells === undefined ? undefined : formatCount(raw.cells));
  row(rows, "dimensions", dimensions(model, raw));
  row(rows, "time scale", raw.timeScale);
  row(rows, "time range", raw.timeRange);
  row(rows, "versions", raw.versions);
  const lists: InspectList[] = [];
  if (node.kind === "externalModule") {
    const members = (node.members ?? []).map(id => model.node(id)).filter((member): member is GraphNode => member !== undefined);
    lists.push({ key: "referenced", title: `Referenced line items · ${formatCount(members.length)}`, open: true, links: members.map(member => objectLink(model, member)) });
  }
  const reads = graph.in[node.index].map(index => nodeLink(graph.nodes[index]));
  const feeds = graph.out[node.index].map(index => nodeLink(graph.nodes[index]));
  if (reads.length) lists.push({ key: "depends", title: `Depends on · ${formatCount(reads.length)}`, open: true, links: reads });
  if (feeds.length) lists.push({ key: "used", title: `Used by · ${formatCount(feeds.length)}`, open: true, links: feeds });
  lists.push({ key: "items", title: `All line items · ${formatCount(owned.length)}`, open: false, links: owned.map(item => objectLink(model, item)) });
  const actions = model.actionsOf(raw.id);
  return {
    kind: KIND_NAMES.module, layer: node.layer, name: node.fullName, rows,
    action: { label: `Open ${plural(owned.length, "line item")}`, module: raw.id },
    lists,
    texts: actions.length ? [{ key: "actions", title: `Actions · ${formatCount(actions.length)}`, lines: actions.map(({ action }) => (action.actionType ? `${action.name} (${action.actionType})` : action.name)) }] : [],
  };
}

function inspectObject(model: MapModel, node: ViewNode, raw: GraphNode, access: boolean): Inspection {
  const rows: [string, string][] = [];
  const module = model.node(model.moduleOf(raw));
  row(rows, "module", module?.name);
  if (raw.kind === "property") row(rows, "list", model.node(raw.parent)?.name);
  row(rows, "format", model.node(raw.formatList)?.name ?? raw.format);
  row(rows, "cells", raw.cells === undefined ? undefined : formatCount(raw.cells));
  if (raw.kind === "lineItem") row(rows, "dimensions", dimensions(model, raw));
  row(rows, "time scale", raw.timeScale);
  row(rows, "time range", raw.timeRange);
  row(rows, "versions", raw.versions);
  row(rows, "summary", raw.summary);
  row(rows, "code", raw.code);
  if (raw.kind === "list" || raw.kind === "subset") {
    row(rows, "parent", model.node(raw.parent)?.name);
    row(rows, "items", raw.count === undefined ? undefined : formatCount(raw.count));
    row(rows, "top level", raw.topLevel);
    row(rows, "numbered", raw.numbered === undefined ? undefined : raw.numbered ? "Yes" : "No");
    row(rows, "display name", raw.displayName);
  }
  const lists: InspectList[] = [];
  const reads = related(model, raw.id, true, access);
  const feeds = related(model, raw.id, false, access);
  if (reads.length) lists.push({ key: "depends", title: `Depends on · ${formatCount(reads.length)}`, open: true, links: reads });
  if (feeds.length) lists.push({ key: "used", title: `Used by · ${formatCount(feeds.length)}`, open: true, links: feeds });
  const formula = raw.formula !== undefined && raw.formula !== "" ? raw.formula : undefined;
  return {
    kind: KIND_NAMES[raw.kind] ?? String(raw.kind).toUpperCase(), layer: node.layer, name: node.fullName, rows,
    ...(module ? { action: { label: "Open containing module", module: module.id, select: raw.id } } : {}),
    ...(formula !== undefined ? { formula } : raw.kind === "lineItem" ? { remark: isHeading(raw) ? "Exported heading; no formula." : "No formula in the export." } : {}),
    lists, texts: [],
  };
}

/** What the inspector says of a node of the graph on screen. `access` says whether the links of who may read and write
 * count among what an object reads and what reads it. */
export function inspect(model: MapModel, graph: ViewGraph, node: ViewNode, access: boolean): Inspection {
  const raw = node.raw;
  if (!raw) return inspectSection(model, node);
  const inspection = raw.kind === "module" ? inspectModule(model, graph, node, raw) : inspectObject(model, node, raw, access);
  const unresolved = model.unresolvedOf(raw.id);
  if (unresolved.length) inspection.texts.push({ key: "unresolved", title: `Names not found · ${formatCount(unresolved.length)}`, lines: unresolved.map(entry => `${entry.field}: ${entry.reference}`) });
  if (raw.notes !== undefined && raw.notes !== "") inspection.notes = raw.notes;
  inspection.source = `${raw.file} · row ${formatCount(raw.row)}`;
  return inspection;
}

/** What the map says aloud when a node is selected: what it is, its name, and how much feeds it and it feeds. */
export function selectionSentence(inspection: Inspection, up: number, down: number): string {
  const kind = inspection.kind.charAt(0) + inspection.kind.slice(1).toLowerCase();
  return `${kind} ${inspection.name} selected: ${formatCount(up)} upstream, ${formatCount(down)} downstream.`;
}
