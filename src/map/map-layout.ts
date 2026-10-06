import type { Box, ViewGraph, ViewNode } from "./map-graphs.js";

/** Where the nodes of a graph stand. Sections stand in a grid, in their order. Modules and line items stand in columns
 * from left to right, what is read before what reads it: nodes that read each other in a circle share a column, and the
 * nodes of a column are ordered to keep their links short. A graph too large for that, or one whose columns would make
 * a strip many times wider than it is high, is packed into columns of equal length in the same order: a long chain
 * would otherwise be fitted so small that no name on it could be read. The same graph always gets the same places. */

const SECTION_COLUMNS = 5;
const SECTION_STEP_X = 340;
const SECTION_STEP_Y = 132;
/** A column's width with the room beside it, and the room between two ranks. */
const COLUMN = 288;
const RANK_GAP = 120;
/** Above this many nodes the ranks give way to packed columns. So they do for a graph of more than `STRIP_ABOVE` nodes
 * that the ranks would lay out more than `STRIP_ASPECT` times wider than high. */
const PACK_ABOVE = 55;
const STRIP_ABOVE = 12;
const STRIP_ASPECT = 4;
const PACK_STEP_X = 340;
const PACK_GAP = 26;
const ORDER_PASSES = 8;

/** What a set of nodes covers; a box of 1 by 1 at the origin for none. */
export function boundsOf(nodes: readonly ViewNode[]): Box {
  if (!nodes.length) return { x: 0, y: 0, w: 1, h: 1 };
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const node of nodes) {
    left = Math.min(left, node.x);
    top = Math.min(top, node.y);
    right = Math.max(right, node.x + node.w);
    bottom = Math.max(bottom, node.y + node.h);
  }
  return { x: left, y: top, w: Math.max(1, right - left), h: Math.max(1, bottom - top) };
}

/** For each node, the number of the circle it is in (a node in no circle is one of its own), by Tarjan's method without
 * recursion: a chain of thousands of nodes must not run out of stack. */
export function components(out: readonly (readonly number[])[]): { of: Int32Array; count: number } {
  const size = out.length;
  const found = new Int32Array(size).fill(-1);
  const low = new Int32Array(size);
  const of = new Int32Array(size).fill(-1);
  const onStack = new Uint8Array(size);
  const stack: number[] = [];
  const path: number[] = [];
  const at = new Int32Array(size);
  let next = 0;
  let count = 0;
  for (let root = 0; root < size; root++) {
    if (found[root] !== -1) continue;
    path.push(root);
    while (path.length) {
      const node = path[path.length - 1];
      if (found[node] === -1) {
        found[node] = low[node] = next++;
        stack.push(node);
        onStack[node] = 1;
      }
      const targets = out[node];
      let deeper = false;
      while (at[node] < targets.length) {
        const target = targets[at[node]++];
        if (found[target] === -1) {
          path.push(target);
          deeper = true;
          break;
        }
        if (onStack[target]) low[node] = Math.min(low[node], found[target]);
      }
      if (deeper) continue;
      if (low[node] === found[node]) {
        let member: number;
        do {
          member = stack.pop()!;
          onStack[member] = 0;
          of[member] = count;
        } while (member !== node);
        count++;
      }
      path.pop();
      if (path.length) {
        const parent = path[path.length - 1];
        low[parent] = Math.min(low[parent], low[node]);
      }
    }
  }
  return { of, count };
}

/** Each node's rank: 0 for what reads nothing, and one more than the highest rank it reads. A circle has one rank. */
function ranksOf(graph: ViewGraph): { rank: Int32Array; highest: number } {
  const { of, count } = components(graph.out);
  const next: Set<number>[] = Array.from({ length: count }, () => new Set<number>());
  const waiting = new Int32Array(count);
  for (const edge of graph.edges) {
    const from = of[edge.s];
    const to = of[edge.t];
    if (from !== to && !next[from].has(to)) {
      next[from].add(to);
      waiting[to]++;
    }
  }
  const circleRank = new Int32Array(count);
  const queue: number[] = [];
  for (let circle = 0; circle < count; circle++) if (waiting[circle] === 0) queue.push(circle);
  for (let index = 0; index < queue.length; index++) {
    const circle = queue[index];
    for (const to of next[circle]) {
      circleRank[to] = Math.max(circleRank[to], circleRank[circle] + 1);
      if (--waiting[to] === 0) queue.push(to);
    }
  }
  const rank = new Int32Array(graph.nodes.length);
  let highest = 0;
  for (let node = 0; node < rank.length; node++) {
    rank[node] = circleRank[of[node]];
    highest = Math.max(highest, rank[node]);
  }
  return { rank, highest };
}

/** The graph's nodes by rank, each rank ordered so that a node stands near what it reads and feeds. What a module's
 * graph reads from outside stands before the first rank and what it feeds outside after the last; a node with no link
 * at all stands at the very end, with the others like it. */
function rankedBands(graph: ViewGraph): ViewNode[][] {
  const { rank, highest } = ranksOf(graph);
  const bands = new Map<number, ViewNode[]>();
  for (const node of graph.nodes) {
    let at = rank[node.index];
    if (node.external && node.side === "in") at = -1;
    if (node.external && node.side === "out") at = highest + 1;
    if (!graph.out[node.index].length && !graph.in[node.index].length) at = highest + 2;
    const band = bands.get(at);
    if (band) band.push(node); else bands.set(at, [node]);
  }
  const order = [...bands.keys()].sort((a, b) => a - b);
  const place = new Float64Array(graph.nodes.length);
  for (const band of bands.values()) band.forEach((node, index) => { place[node.index] = index; });
  for (let pass = 0; pass < ORDER_PASSES; pass++) {
    const backwards = pass % 2 === 1;
    const links = backwards ? graph.out : graph.in;
    const centre = (node: ViewNode): number => {
      const linked = links[node.index];
      return linked.length ? linked.reduce((sum, other) => sum + place[other], 0) / linked.length : place[node.index];
    };
    for (const at of backwards ? [...order].reverse() : order) {
      const band = bands.get(at)!;
      const centres = new Map(band.map(node => [node, centre(node)]));
      band.sort((a, b) => centres.get(a)! - centres.get(b)!);
      band.forEach((node, index) => { place[node.index] = index; });
    }
  }
  return order.map(at => bands.get(at)!);
}

/** Gives every node of the graph its place, and the graph its bounds. */
export function layoutGraph(graph: ViewGraph): void {
  const { nodes } = graph;
  if (graph.kind === "sections") {
    nodes.forEach((node, index) => {
      node.x = (index % SECTION_COLUMNS) * SECTION_STEP_X;
      node.y = Math.floor(index / SECTION_COLUMNS) * SECTION_STEP_Y;
    });
  } else {
    const bands = rankedBands(graph);
    // A rank of many nodes breaks into columns of at most this many, each centred on the highest column of all.
    const drill = graph.kind === "drill";
    const maxRows = drill ? 14 : 12;
    const gap = drill ? 30 : 32;
    const columnsOf = (band: readonly ViewNode[]): ViewNode[][] => {
      const rows = Math.ceil(band.length / Math.ceil(band.length / maxRows));
      const columns: ViewNode[][] = [];
      for (let start = 0; start < band.length; start += rows) columns.push(band.slice(start, start + rows));
      return columns;
    };
    const heightOf = (column: readonly ViewNode[]): number => column.reduce((height, node) => height + node.h, 0) + gap * (column.length - 1);
    const ranked = bands.map(columnsOf);
    const highest = Math.max(0, ...ranked.flat().map(heightOf));
    const across = ranked.reduce((width, columns) => width + columns.length * COLUMN, 0) + RANK_GAP * Math.max(0, ranked.length - 1);
    if (nodes.length > PACK_ABOVE || (nodes.length > STRIP_ABOVE && across > STRIP_ASPECT * highest)) {
      const ordered = bands.flat();
      const columns = Math.max(4, Math.ceil(Math.sqrt(ordered.length * 0.42)));
      const rows = Math.ceil(ordered.length / columns);
      const heights = new Float64Array(columns);
      ordered.forEach((node, index) => {
        const column = Math.floor(index / rows);
        node.x = column * PACK_STEP_X;
        node.y = heights[column];
        heights[column] += node.h + PACK_GAP;
      });
    } else {
      let x = 0;
      for (const columns of ranked) {
        columns.forEach((column, index) => {
          let y = (highest - heightOf(column)) / 2;
          for (const node of column) {
            node.x = x + index * COLUMN;
            node.y = y;
            y += node.h + gap;
          }
        });
        x += columns.length * COLUMN + RANK_GAP;
      }
    }
  }
  graph.bounds = boundsOf(nodes);
}
