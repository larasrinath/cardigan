import type { GraphEdge, GraphNode } from "./graph-types.js";
import type { MapModel } from "./map-model.js";
import { plural, splitName } from "./map-text.js";

/** The three graphs the map draws of one model, each made of the model's own links counted together:
 * - its sections, linked where a line item of one reads a line item of another;
 * - the modules of one section, or all modules, linked the same way; a module of another section that one of the
 *   section's modules reads or feeds stands beside them as an external node;
 * - the line items of one module, with what they read and feed outside it: line items of other modules, as one node
 *   for each module or one by one, and the lists and properties their formulas name.
 * A link from a thing to itself is no link between two modules or sections; between line items it stays, as the loop a
 * formula that reads its own line item makes. */

export type ViewNodeKind = "section" | "module" | "lineItem" | "externalModule" | "externalItem" | "list" | "property";

/** What the legend groups nodes by, and what gives a node its colour: a module's section (`sectionLayer`), or one of
 * these for what is in a module's own graph. */
export const LAYER = { lineItem: "lineitem", heading: "heading", external: "external", list: "list", property: "property" } as const;
export const sectionLayer = (index: number): string => `s${index}`;

export interface ViewNode {
  /** The node's name in this graph: the object's number, "section" and the section's place, or "external" and the
   * module's number for the node that stands for a module's line items. */
  readonly id: string;
  /** Its place in the graph's `nodes`. */
  readonly index: number;
  readonly kind: ViewNodeKind;
  readonly layer: string;
  /** Its code, where its name starts with one; "" for none. The code and `meta` make the small line above the name. */
  readonly code: string;
  /** Its name without the code. */
  readonly label: string;
  readonly fullName: string;
  /** What the small line says after the code: how much it holds, or where it belongs; "" for nothing. */
  readonly meta: string;
  /** The name's lines at full zoom, once the boxes are sized (map-layout.ts). */
  lines: string[];
  /** The object the node stands for. A section is no object of the export. */
  readonly raw?: GraphNode;
  /** A section node's place among the model's sections. */
  readonly section?: number;
  /** A section's modules; for the node that stands for a module's line items, the line items it stands for. */
  readonly members?: readonly number[];
  /** Outside what the graph is of: drawn dashed. */
  readonly external: boolean;
  /** For an external node of a module's graph: whether it is read ("in"), fed ("out") or both. */
  readonly side?: "in" | "out" | "both";
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ViewEdge {
  /** The places of its two nodes in `nodes`: from what is read to what reads it. */
  readonly s: number;
  readonly t: number;
  /** How many of the model's links it counts together. */
  readonly w: number;
  /** Those links, in a module's graph: the trace follows them one by one. */
  readonly refs?: readonly GraphEdge[];
}

/** A layer of the legend: what its nodes are, and how many there are. In the graph of sections a layer is one section,
 * and its count is the section's modules. */
export interface ViewLayer { key: string; label: string; count: number }
export interface Box { x: number; y: number; w: number; h: number }

export interface ViewGraph {
  readonly kind: "sections" | "modules" | "drill";
  readonly name: string;
  readonly nodes: ViewNode[];
  readonly edges: ViewEdge[];
  readonly byId: ReadonlyMap<string, ViewNode>;
  /** For each node, the nodes it feeds and the nodes it reads, by their places. */
  readonly out: readonly (readonly number[])[];
  readonly in: readonly (readonly number[])[];
  /** The layers its nodes are in, in the order they first appear. */
  readonly layers: readonly ViewLayer[];
  /** How many of its nodes are what the graph is of: a module's own line items, a section's own modules. The others
   * stand beside them: what they read and feed elsewhere. */
  readonly local: number;
  /** What its nodes cover, once laid out (map-layout.ts). */
  bounds: Box;
}

/** A box's size before its name is measured (map-layout.ts `sizeNodes` gives the real one). */
const SIZE: Record<ViewNodeKind, readonly [width: number, height: number]> = {
  section: [232, 49], lineItem: [216, 32], module: [232, 49], externalModule: [232, 49], externalItem: [232, 49], list: [232, 49], property: [232, 49],
};

/** A node before it has its place in a graph. */
interface Draft {
  id: string;
  kind: ViewNodeKind;
  layer: string;
  code: string;
  label: string;
  fullName: string;
  meta: string;
  raw?: GraphNode;
  section?: number;
  members?: number[];
  external: boolean;
  side?: "in" | "out" | "both";
}
interface Link { s: string; t: string; w: number; refs?: GraphEdge[] }

const LAYER_LABELS: Record<string, string> = { [LAYER.lineItem]: "Line items", [LAYER.heading]: "No Data line items (headings)", [LAYER.list]: "Lists and subsets", [LAYER.property]: "List properties" };

/** What the layer of what stands beside the graph is called: by what it holds, and by the graph it stands beside. */
function externalLabel(kind: ViewGraph["kind"], nodes: readonly Draft[]): string {
  const kinds = new Set(nodes.filter(node => node.layer === LAYER.external).map(node => node.kind));
  if (kinds.size === 1 && kinds.has("externalItem")) return "Line items of other modules";
  if (![...kinds].every(each => each === "module" || each === "externalModule")) return "Other objects";
  return kind === "drill" ? "Other modules" : "Modules of other sections";
}

function finish(model: MapModel, kind: ViewGraph["kind"], name: string, drafts: readonly Draft[], links: readonly Link[], local = 0): ViewGraph {
  const nodes: ViewNode[] = drafts.map((draft, index) => ({ ...draft, index, lines: [draft.label], x: 0, y: 0, w: SIZE[draft.kind][0], h: SIZE[draft.kind][1] }));
  const byId = new Map(nodes.map(node => [node.id, node]));
  const out: number[][] = nodes.map(() => []);
  const into: number[][] = nodes.map(() => []);
  const edges: ViewEdge[] = [];
  for (const link of links) {
    const from = byId.get(link.s);
    const to = byId.get(link.t);
    if (!from || !to) continue;
    edges.push({ s: from.index, t: to.index, w: link.w, ...(link.refs ? { refs: link.refs } : {}) });
    out[from.index].push(to.index);
    into[to.index].push(from.index);
  }
  const layers: ViewLayer[] = [];
  const layerOf = new Map<string, ViewLayer>();
  for (const node of nodes) {
    let layer = layerOf.get(node.layer);
    if (!layer) {
      const section = /^s(\d+)$/.exec(node.layer);
      // The modules of a model that has one section, or none, are one layer: it is named for what they are.
      const ofSection = section ? (kind === "modules" && model.sections.length <= 1 ? "Modules" : model.sections[Number(section[1])] ?? node.layer) : undefined;
      const label = ofSection ?? (node.layer === LAYER.external ? externalLabel(kind, drafts) : LAYER_LABELS[node.layer] ?? node.layer);
      layer = { key: node.layer, label, count: 0 };
      layerOf.set(node.layer, layer);
      layers.push(layer);
    }
    layer.count += node.kind === "section" ? node.members?.length ?? 0 : 1;
  }
  return { kind, name, nodes, edges, byId, out, in: into, layers, local, bounds: { x: 0, y: 0, w: 1, h: 1 } };
}

/** The model's formula links, with those of who may read and write when `access` is on, in the graph's order. */
function activeEdges(model: MapModel, access: boolean): readonly GraphEdge[] {
  return access ? [...model.formulaEdges, ...model.accessEdges] : model.formulaEdges;
}

/** Links counted together by what each end belongs to. An end that belongs to nothing drops its link, and so does a
 * link whose two ends belong to the same thing. */
function aggregate(model: MapModel, edges: readonly GraphEdge[], endpoint: (node: GraphNode | undefined) => string | undefined): Link[] {
  const links = new Map<string, Link>();
  for (const [from, to] of edges) {
    const s = endpoint(model.node(from));
    const t = endpoint(model.node(to));
    if (s === undefined || t === undefined || s === t) continue;
    const key = `${s}>${t}`;
    const link = links.get(key);
    if (link) link.w++; else links.set(key, { s, t, w: 1 });
  }
  return [...links.values()];
}

/** The links between modules are the same for every section: they are counted once for a model, with and without the
 * access links. */
const moduleLinkCache = new WeakMap<MapModel, { plain?: Link[]; access?: Link[] }>();
function moduleLinks(model: MapModel, access: boolean): Link[] {
  let cached = moduleLinkCache.get(model);
  if (!cached) moduleLinkCache.set(model, cached = {});
  const which = access ? "access" : "plain";
  return cached[which] ??= aggregate(model, activeEdges(model, access), node => {
    const module = model.moduleOf(node);
    return module === undefined ? undefined : String(module);
  });
}

/** A module's box. Its small line says how many line items it has, or its section where the graph holds modules of
 * more than one (`inSection`): there the section is said in words, and not by the box's colour alone. */
function moduleDraft(model: MapModel, raw: GraphNode, external: boolean, inSection = false): Draft {
  return {
    id: String(raw.id), kind: "module", layer: external ? LAYER.external : sectionLayer(model.sectionIndex(model.sectionOf(raw))),
    ...splitName(raw.name), fullName: raw.name, meta: inSection ? model.sectionOf(raw) : plural(model.itemsOf(raw.id).length, "line item"), raw, external,
  };
}

/** The model's sections as nodes. */
export function sectionsGraph(model: MapModel, access: boolean): ViewGraph {
  const drafts: Draft[] = model.sections.map((section, index) => {
    const members = model.modules.filter(module => model.sectionOf(module) === section);
    const lineItems = members.reduce((count, module) => count + model.itemsOf(module.id).length, 0);
    return {
      id: `section${index}`, kind: "section", layer: sectionLayer(index), section: index, code: "",
      label: section, fullName: section, meta: `${plural(members.length, "module")} · ${plural(lineItems, "line item")}`,
      members: members.map(module => module.id), external: false,
    };
  });
  const links = aggregate(model, activeEdges(model, access), node => {
    const module = model.node(model.moduleOf(node));
    return module ? `section${model.sectionIndex(model.sectionOf(module))}` : undefined;
  });
  return finish(model, "sections", "Model sections", drafts, links, drafts.length);
}

/** The modules of one section, or all modules when no section is named. */
export function modulesGraph(model: MapModel, section: string | undefined, access: boolean): ViewGraph {
  const own = new Set<number>();
  for (const module of model.modules) if (section === undefined || model.sectionOf(module) === section) own.add(module.id);
  const links = moduleLinks(model, access).filter(link => own.has(Number(link.s)) || own.has(Number(link.t)));
  const shown = new Set(own);
  for (const link of links) {
    shown.add(Number(link.s));
    shown.add(Number(link.t));
  }
  // Among all modules every box says its section; among one section's, the boxes from other sections say theirs.
  const drafts = model.modules.filter(module => shown.has(module.id)).map(module => moduleDraft(model, module, !own.has(module.id), section === undefined ? model.sections.length > 1 : !own.has(module.id)));
  return finish(model, "modules", section ?? "All modules", drafts, links, own.size);
}

/** The line items of one module and what they read and feed outside it. `expanded` shows the line items of other
 * modules one by one; otherwise one node stands for all those of a module. */
export function moduleGraph(model: MapModel, moduleId: number, expanded: boolean, access: boolean): ViewGraph {
  const module = model.node(moduleId);
  const owned = model.itemsOf(moduleId);
  const own = new Set(owned.map(item => item.id));
  const drafts = new Map<string, Draft>();
  for (const item of owned) {
    drafts.set(String(item.id), {
      id: String(item.id), kind: "lineItem", layer: item.format?.toUpperCase() === "NONE" ? LAYER.heading : LAYER.lineItem,
      code: "", label: item.name, fullName: item.name, meta: "", raw: item, external: false,
    });
  }

  /** The line items of other modules that already stand in their module's node. */
  const grouped = new Set<number>();
  const endpoint = (id: number): string | undefined => {
    if (own.has(id)) return String(id);
    const raw = model.node(id);
    if (!raw) return undefined;
    const home = raw.kind === "lineItem" ? model.node(model.moduleOf(raw)) : undefined;
    if (home && !expanded) {
      const key = `external${home.id}`;
      let group = drafts.get(key);
      if (!group) drafts.set(key, group = { ...moduleDraft(model, home, true), id: key, kind: "externalModule", members: [] });
      if (!grouped.has(id)) {
        grouped.add(id);
        group.members!.push(id);
      }
      return key;
    }
    const key = String(id);
    if (!drafts.has(key)) {
      if (raw.kind === "module") drafts.set(key, moduleDraft(model, raw, true));
      // A line item of another module says which: the module's code, or its whole name where it has no code.
      else if (raw.kind === "lineItem") drafts.set(key, { id: key, kind: "externalItem", layer: LAYER.external, code: home ? splitName(home.name).code || home.name : "", label: raw.name, fullName: raw.name, meta: "", raw, external: true });
      else {
        const property = raw.kind === "property";
        const list = property ? model.node(raw.parent) : undefined;
        drafts.set(key, {
          id: key, kind: property ? "property" : "list", layer: property ? LAYER.property : LAYER.list, code: raw.kind.toUpperCase(), label: raw.name, fullName: raw.name,
          meta: property ? list?.name ?? "" : raw.count === undefined ? "" : plural(raw.count, "item"), raw, external: true,
        });
      }
    }
    return key;
  };

  const links = new Map<string, Link>();
  for (const edge of activeEdges(model, access)) {
    if (!own.has(edge[0]) && !own.has(edge[1])) continue;
    const s = endpoint(edge[0]);
    const t = endpoint(edge[1]);
    if (s === undefined || t === undefined) continue;
    const key = `${s}>${t}`;
    const link = links.get(key);
    if (link) {
      link.w++;
      link.refs!.push(edge);
    } else links.set(key, { s, t, w: 1, refs: [edge] });
  }

  const fed = new Set<string>();
  const read = new Set<string>();
  for (const link of links.values()) {
    fed.add(link.t);
    read.add(link.s);
  }
  for (const draft of drafts.values()) {
    if (draft.kind === "externalModule") draft.meta = `${plural(draft.members!.length, "line item")} linked`;
    if (draft.external) draft.side = fed.has(draft.id) && read.has(draft.id) ? "both" : fed.has(draft.id) ? "out" : "in";
  }
  return finish(model, "drill", module?.name ?? "", [...drafts.values()], [...links.values()], owned.length);
}
