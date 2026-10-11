import { edgeDrawn, type ViewGraph } from "./map-graphs.js";
import { isAccess, isFilter, isFormula, type MapModel } from "./map-model.js";

/** What feeds a node and what it feeds, in the graph on screen.
 *
 * Between sections and between modules the trace follows the graph's own links: everything that can be reached against
 * them is upstream, everything that can be reached along them is downstream.
 *
 * In a module's graph that would say too much: a node that stands for a whole module would pass a trace on from one of
 * its line items to another that has nothing to do with it. There the trace follows the model's links one by one, from
 * line item to line item through the whole model, and then says which nodes on screen hold something it reached. */

export interface Trace {
  /** The place of the node traced. */
  readonly selected: number;
  /** The places of the nodes that feed it, and of those it feeds. A node in a circle with it is in both. */
  readonly up: ReadonlySet<number>;
  readonly down: ReadonlySet<number>;
  /** For each link of the graph: 1 where it leads towards the node, 2 where it leads away from it, 0 otherwise. */
  readonly edges: Uint8Array;
}

/** Everything reached from a node along the lists of neighbours, without the node itself. */
function reach(start: number, neighbours: readonly (readonly number[])[]): Set<number> {
  const seen = new Set([start]);
  const queue = [start];
  for (let index = 0; index < queue.length; index++) {
    for (const next of neighbours[queue[index]]) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  seen.delete(start);
  return seen;
}

/** Every object of the model reached from the seeds against the links (`upstream`) or along them, without the seeds. The
 * links of formulas, of access drivers and of the pages' filters count only where they are drawn (`formulas`, `access`,
 * `filters`). */
function reachInModel(model: MapModel, seeds: readonly number[], upstream: boolean, access: boolean, filters: boolean, formulas: boolean): Set<number> {
  const seen = new Set(seeds);
  const queue = [...seeds];
  for (let index = 0; index < queue.length; index++) {
    for (const edge of upstream ? model.incoming(queue[index]) : model.outgoing(queue[index])) {
      if (!counts(edge[2], access, filters, formulas)) continue;
      const next = edge[upstream ? 0 : 1];
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  for (const seed of seeds) seen.delete(seed);
  return seen;
}

/** Whether a link of the model counts for a trace: one of a kind the map draws. */
function counts(kind: Parameters<typeof isAccess>[0], access: boolean, filters: boolean, formulas: boolean): boolean {
  return !((!access && isAccess(kind)) || (!filters && isFilter(kind)) || (!formulas && isFormula(kind)));
}

/** The lists of neighbours of the graph's nodes along the links it draws: all of them, or, where formulas are left
 * undrawn, those that count more than formulas' links. */
function drawnNeighbours(graph: ViewGraph, formulas: boolean): { into: number[][]; out: number[][] } | undefined {
  if (formulas) return undefined;
  const into: number[][] = graph.nodes.map(() => []);
  const out: number[][] = graph.nodes.map(() => []);
  for (const edge of graph.edges) {
    if (!edgeDrawn(edge, false)) continue;
    out[edge.s].push(edge.t);
    into[edge.t].push(edge.s);
  }
  return { into, out };
}

/** The trace of the node at `selected`. `access` says whether the links of who may read and write count, `filters`
 * whether those of the pages' filters do, and `formulas` whether those of formulas do: each only where the map draws
 * them. A link the map does not draw is never marked. */
export function traceNode(graph: ViewGraph, model: MapModel, selected: number, access: boolean, filters = false, formulas = true): Trace {
  const node = graph.nodes[selected];
  const edges = new Uint8Array(graph.edges.length);
  if (graph.kind !== "drill" || !node.raw) {
    const drawn = drawnNeighbours(graph, formulas);
    const up = reach(selected, drawn?.into ?? graph.in);
    const down = reach(selected, drawn?.out ?? graph.out);
    graph.edges.forEach((edge, index) => {
      if (!edgeDrawn(edge, formulas)) return;
      if ((edge.t === selected || up.has(edge.t)) && up.has(edge.s)) edges[index] = 1;
      else if ((edge.s === selected || down.has(edge.s)) && down.has(edge.t)) edges[index] = 2;
    });
    return { selected, up, down, edges };
  }

  // A grouped outside box also holds the module itself: access and older page filters can point straight at it.
  const seeds = [node.raw.id, ...(node.kind === "externalModule" ? node.members ?? [] : [])];
  const seedSet = new Set(seeds);
  const rawUp = reachInModel(model, seeds, true, access, filters, formulas);
  const rawDown = reachInModel(model, seeds, false, access, filters, formulas);
  const holds = (reached: ReadonlySet<number>): Set<number> => {
    const held = new Set<number>();
    for (const other of graph.nodes) {
      if (other.index === selected) continue;
      const objects = other.raw ? [other.raw.id, ...(other.kind === "externalModule" ? other.members ?? [] : [])] : [];
      if (objects.some(id => reached.has(id))) held.add(other.index);
    }
    return held;
  };
  graph.edges.forEach((edge, index) => {
    if (!edgeDrawn(edge, formulas)) return;
    const refs = (edge.refs ?? []).filter(([, , kind]) => counts(kind, access, filters, formulas));
    if (refs.some(([from, to]) => rawUp.has(from) && (rawUp.has(to) || seedSet.has(to)))) edges[index] = 1;
    else if (refs.some(([from, to]) => (rawDown.has(from) || seedSet.has(from)) && rawDown.has(to))) edges[index] = 2;
  });
  return { selected, up: holds(rawUp), down: holds(rawDown), edges };
}

/** Which nodes a trace shows when the view keeps to it: the node traced, what feeds it and what it feeds. */
export function inTrace(trace: Trace, index: number): boolean {
  return index === trace.selected || trace.up.has(index) || trace.down.has(index);
}
