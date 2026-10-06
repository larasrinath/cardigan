import type { Box, ViewGraph, ViewNode } from "./map-graphs.js";
import { wrapLines, type TextMeasure } from "./map-text.js";

/** How large the map's boxes are and where they stand.
 *
 * A box is as high as its name needs: the name is wrapped at the size it has at full zoom, so that a box shows its
 * whole name whenever the zoom leaves the letters large enough to read.
 *
 * The places are chosen for the room the picture has: among the ways to lay a graph out, the one that fits that room at
 * the largest zoom wins, because a picture fitted small is one nobody can read. Sections stand in a grid. Modules and
 * line items stand in columns from left to right, what is read before what reads it, with circles sharing a column
 * ("ranks"); where that comes out too small to read they are packed into columns of equal length in the same order.
 * The same graph in the same room always gets the same places. */

/** A box that holds a small line and a name: a section, a module, a list. Sizes are in pixels at full zoom. A name
 * has up to four lines, which hold about a hundred and thirty letters: longer than that it is cut, with the mark. */
export const CARD = { width: 232, padLeft: 14, padRight: 10, top: 9, small: 12, gap: 3, line: 15.5, bottom: 9, font: 12.5, smallFont: 9.5, maxLines: 4 } as const;
/** A line item's box: its name alone. */
export const ITEM = { width: 216, padLeft: 13, padRight: 8, top: 9, line: 14, bottom: 9, font: 11.5, maxLines: 4 } as const;

/** A fit never enlarges a small graph beyond this. */
export const FIT_ZOOM = 1.15;
/** From this zoom on a box is drawn in full, its name at the size it was wrapped for: the letters of a name are then
 * 9.5 pixels or more. Below it only the name is written, in letters that stay readable (map-canvas.ts). A line item's
 * letters are smaller than a card's, so its box is drawn in full from a larger zoom. */
export const FULL_CARD_ZOOM = 0.76;
export const FULL_ITEM_ZOOM = 0.83;
/** The zoom from which every box of a graph is drawn in full. */
export const fullFrom = (graph: ViewGraph): number => (graph.nodes.some(node => node.kind === "lineItem") ? FULL_ITEM_ZOOM : FULL_CARD_ZOOM);

/** The room a picture is laid out for, in CSS pixels. */
export interface Room { width: number; height: number }
const DEFAULT_ROOM: Room = { width: 900, height: 600 };

/** The room between two columns, where the links run, and between two boxes of a column. */
const COLUMN_GAP = 64;
const ROW_GAP = 14;
/** Between two ranks, and between two columns of one rank. */
const RANK_GAP = 88;
const RANK_COLUMN_GAP = 28;
const SECTION_GAP_X = 56;
const SECTION_GAP_Y = 30;
const ORDER_PASSES = 8;
/** How many rows a rank may have before it breaks into columns: each is tried, the most first, so that of two ways that
 * fit equally large the one with its ranks whole is kept. */
const RANK_ROWS = [40, 24, 16, 12, 8, 6, 4, 3];
const MOST_COLUMNS = 48;

/** Whether a box has a small line above its name. */
export const hasSmallLine = (node: ViewNode): boolean => node.kind !== "lineItem" && (node.code !== "" || node.meta !== "");

/** Gives every box its name's lines and the size that holds them. `label` measures a box's name, `item` a line item's. */
export function sizeNodes(graph: ViewGraph, label: TextMeasure, item: TextMeasure): void {
  for (const node of graph.nodes) {
    if (node.kind === "lineItem") {
      node.lines = wrapLines(node.label, (ITEM.width - ITEM.padLeft - ITEM.padRight) / ITEM.font, ITEM.maxLines, item);
      node.w = ITEM.width;
      node.h = ITEM.top + Math.max(1, node.lines.length) * ITEM.line + ITEM.bottom;
    } else {
      node.lines = wrapLines(node.label, (CARD.width - CARD.padLeft - CARD.padRight) / CARD.font, CARD.maxLines, label);
      node.w = CARD.width;
      node.h = CARD.top + (hasSmallLine(node) ? CARD.small + CARD.gap : 0) + Math.max(1, node.lines.length) * CARD.line + CARD.bottom;
    }
  }
}

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

/** Columns of boxes side by side, each column's boxes one under another, the columns' middles in one line where asked. */
function placeColumns(columns: readonly (readonly ViewNode[])[], starts: readonly number[], rowGap: number, centred: boolean): void {
  const heightOf = (column: readonly ViewNode[]): number => column.reduce((height, node) => height + node.h, 0) + rowGap * Math.max(0, column.length - 1);
  const highest = centred ? Math.max(0, ...columns.map(heightOf)) : 0;
  columns.forEach((column, index) => {
    let y = centred ? (highest - heightOf(column)) / 2 : 0;
    for (const node of column) {
      node.x = starts[index];
      node.y = y;
      y += node.h + rowGap;
    }
  });
}

/** The ranks from left to right; a rank of more than `maxRows` boxes breaks into columns of equal length. */
function placeRanked(bands: readonly (readonly ViewNode[])[], maxRows: number): void {
  const columns: ViewNode[][] = [];
  const starts: number[] = [];
  let x = 0;
  for (const band of bands) {
    const rows = Math.ceil(band.length / Math.ceil(band.length / maxRows));
    const width = Math.max(...band.map(node => node.w));
    for (let start = 0; start < band.length; start += rows) {
      columns.push(band.slice(start, start + rows));
      starts.push(x);
      x += width + RANK_COLUMN_GAP;
    }
    x += RANK_GAP - RANK_COLUMN_GAP;
  }
  placeColumns(columns, starts, ROW_GAP + 2, true);
}

/** The boxes in their order, packed into a number of columns of equal length. */
function placePacked(ordered: readonly ViewNode[], count: number, gapX: number, gapY: number): void {
  const rows = Math.ceil(ordered.length / count);
  const width = Math.max(...ordered.map(node => node.w));
  const columns: ViewNode[][] = [];
  for (let start = 0; start < ordered.length; start += rows) columns.push(ordered.slice(start, start + rows));
  placeColumns(columns, columns.map((_, index) => index * (width + gapX)), gapY, false);
}

/** Sections in rows of a number of boxes, in their order: the boxes of a row are as high as its highest. */
function placeGrid(nodes: readonly ViewNode[], count: number): void {
  const width = Math.max(...nodes.map(node => node.w));
  let y = 0;
  for (let start = 0; start < nodes.length; start += count) {
    const row = nodes.slice(start, start + count);
    row.forEach((node, index) => {
      node.x = index * (width + SECTION_GAP_X);
      node.y = y;
    });
    y += Math.max(...row.map(node => node.h)) + SECTION_GAP_Y;
  }
}

/** Gives every node of the graph its place, and the graph its bounds. `rooms` are the rooms the picture may be fitted
 * into (map-camera.ts): the layout that fits one of them largest is taken. Says how the graph was laid out. */
export function layoutGraph(graph: ViewGraph, rooms: readonly Room[] = [DEFAULT_ROOM]): "grid" | "ranked" | "packed" | "empty" {
  const { nodes } = graph;
  if (!nodes.length) {
    graph.bounds = boundsOf(nodes);
    return "empty";
  }
  const zoomOf = (): number => {
    const box = boundsOf(nodes);
    let best = 0;
    for (const room of rooms.length ? rooms : [DEFAULT_ROOM]) best = Math.max(best, Math.min(room.width / box.w, room.height / box.h, FIT_ZOOM));
    return best;
  };
  /** Tries each way and keeps the first that fits largest: `ways` are in the order they are preferred in. */
  const best = (ways: readonly (() => void)[]): { way: () => void; zoom: number } => {
    let chosen = ways[0];
    let zoom = -1;
    for (const way of ways) {
      way();
      const fitted = zoomOf();
      if (fitted > zoom + 1e-9) {
        chosen = way;
        zoom = fitted;
      }
    }
    return { way: chosen, zoom };
  };
  const most = Math.min(nodes.length, MOST_COLUMNS);
  // More columns come first: of two grids that fit equally large, the wider reads more like the model's own order.
  const counts = Array.from({ length: most }, (_, index) => most - index);
  let how: "grid" | "ranked" | "packed";
  if (graph.kind === "sections") {
    best(counts.map(count => () => placeGrid(nodes, count))).way();
    how = "grid";
  } else {
    const bands = rankedBands(graph);
    const ordered = bands.flat();
    const ranked = best(RANK_ROWS.map(rows => () => placeRanked(bands, rows)));
    const packed = best(counts.map(count => () => placePacked(ordered, count, COLUMN_GAP, ROW_GAP)));
    // The ranks show what feeds what at a glance: they are kept while every name on them can be read in full.
    how = ranked.zoom >= fullFrom(graph) || ranked.zoom >= packed.zoom ? "ranked" : "packed";
    (how === "ranked" ? ranked : packed).way();
  }
  graph.bounds = boundsOf(nodes);
  return how;
}
