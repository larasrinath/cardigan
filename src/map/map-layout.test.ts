import { describe, expect, it } from "vitest";
import { moduleGraph, modulesGraph, sectionsGraph, type ViewGraph, type ViewNode } from "./map-graphs.js";
import { boundsOf, components, layoutGraph } from "./map-layout.js";
import { indexModel } from "./map-model.js";
import { GraphMaker } from "./map.test-support.js";

/** A model of one section whose modules are linked as given: each pair is a module read and the module that reads it. */
function modulesOf(count: number, pairs: readonly (readonly [number, number])[]): ViewGraph {
  const make = new GraphMaker();
  const items: number[] = [];
  for (let index = 0; index < count; index++) items.push(make.item(make.module(`M${index}`, "01: All"), "Value"));
  for (const [from, to] of pairs) make.link(items[from], items[to]);
  const graph = modulesGraph(indexModel(make.graph()), undefined, false);
  layoutGraph(graph);
  return graph;
}

const at = (graph: ViewGraph, name: string): ViewNode => graph.nodes.find(node => node.fullName === name)!;
const overlap = (a: ViewNode, b: ViewNode): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const anyOverlap = (graph: ViewGraph): boolean => graph.nodes.some((node, index) => graph.nodes.slice(index + 1).some(other => overlap(node, other)));

describe("The circles of a graph", () => {
  it("puts nodes that reach each other in one circle, and every other node in one of its own", () => {
    // 0 -> 1 -> 2 -> 0 is a circle; 3 hangs off it; 4 stands alone.
    const { of, count } = components([[1], [2], [0, 3], [], []]);
    expect(count).toBe(3);
    expect(of[0] === of[1] && of[1] === of[2]).toBe(true);
    expect(new Set([of[0], of[3], of[4]]).size).toBe(3);
  });

  it("counts a node that links to itself as one circle, and an empty graph as none", () => {
    expect(components([[0], []]).count).toBe(2);
    expect(components([]).count).toBe(0);
  });

  it("follows a chain of many thousands of nodes without running out of stack", () => {
    const length = 60000;
    const chain = Array.from({ length }, (_, index) => (index + 1 < length ? [index + 1] : []));
    expect(components(chain).count).toBe(length);
    // And the same chain closed into one circle.
    chain[length - 1] = [0];
    expect(components(chain).count).toBe(1);
  });
});

describe("Where the map's nodes stand", () => {
  it("puts sections in rows of five, in their order", () => {
    const make = new GraphMaker();
    for (let index = 0; index < 7; index++) make.item(make.module(`M${index}`, `0${index}: Section ${index}`), "Value");
    const graph = sectionsGraph(indexModel(make.graph()), false);
    layoutGraph(graph);
    expect(graph.nodes.map(node => [node.x, node.y])).toEqual([[0, 0], [340, 0], [680, 0], [1020, 0], [1360, 0], [0, 132], [340, 132]]);
    expect(graph.bounds).toEqual({ x: 0, y: 0, w: 1360 + 260, h: 132 + 82 });
  });

  it("puts what is read to the left of what reads it, a rank to a column", () => {
    const graph = modulesOf(4, [[0, 1], [1, 2], [0, 3]]);
    expect(at(graph, "M0").x).toBeLessThan(at(graph, "M1").x);
    expect(at(graph, "M1").x).toBeLessThan(at(graph, "M2").x);
    // M1 and M3 both read M0 alone: they share a column.
    expect(at(graph, "M3").x).toBe(at(graph, "M1").x);
    expect(at(graph, "M3").y).not.toBe(at(graph, "M1").y);
    expect(anyOverlap(graph)).toBe(false);
  });

  it("ranks a node after the longest way to it", () => {
    // M3 reads M0 directly and through M1 and M2: it stands after M2.
    const graph = modulesOf(4, [[0, 1], [1, 2], [2, 3], [0, 3]]);
    expect(at(graph, "M3").x).toBeGreaterThan(at(graph, "M2").x);
  });

  it("gives nodes that read each other in a circle one column", () => {
    const graph = modulesOf(4, [[0, 1], [1, 2], [2, 1], [2, 3]]);
    expect(at(graph, "M1").x).toBe(at(graph, "M2").x);
    expect(at(graph, "M0").x).toBeLessThan(at(graph, "M1").x);
    expect(at(graph, "M3").x).toBeGreaterThan(at(graph, "M2").x);
    expect(anyOverlap(graph)).toBe(false);
  });

  it("puts nodes with no link at all after everything else, together", () => {
    const graph = modulesOf(5, [[0, 1], [1, 2]]);
    expect(at(graph, "M3").x).toBe(at(graph, "M4").x);
    expect(at(graph, "M3").x).toBeGreaterThan(at(graph, "M2").x);
  });

  it("orders a column so that a node stands near what it reads", () => {
    // Two chains side by side: a0 -> a1 and b0 -> b1. Whatever the order of the first column, the second follows it.
    const graph = modulesOf(4, [[0, 3], [1, 2]]);
    const above = (first: string, second: string): boolean => at(graph, first).y < at(graph, second).y;
    expect(above("M0", "M1")).toBe(above("M3", "M2"));
  });

  it("breaks a rank of many nodes into columns of at most twelve modules", () => {
    // One module that 30 others read: the second rank has 30 nodes.
    const graph = modulesOf(31, Array.from({ length: 30 }, (_, index) => [0, index + 1] as const));
    const columns = new Map<number, number>();
    for (const node of graph.nodes.slice(1)) columns.set(node.x, (columns.get(node.x) ?? 0) + 1);
    expect([...columns.values()].sort()).toEqual([10, 10, 10]);
    expect(anyOverlap(graph)).toBe(false);
  });

  it("packs a graph of more than 55 nodes into columns of equal length, in the order of the ranks", () => {
    const pairs = Array.from({ length: 59 }, (_, index) => [index, index + 1] as const);
    const graph = modulesOf(60, pairs);
    const columns = [...new Set(graph.nodes.map(node => node.x))].sort((a, b) => a - b);
    // Sixty nodes: six columns of ten.
    expect(columns).toEqual([0, 340, 680, 1020, 1360, 1700]);
    expect(graph.nodes.filter(node => node.x === 0).map(node => node.fullName)).toEqual(Array.from({ length: 10 }, (_, index) => `M${index}`));
    expect(at(graph, "M10")).toMatchObject({ x: 340, y: 0 });
    expect(at(graph, "M1").y).toBe(76 + 26);
    expect(anyOverlap(graph)).toBe(false);
  });

  it("packs a long chain of a few nodes too, which the ranks would lay out as a strip many times wider than high", () => {
    const chain = modulesOf(16, Array.from({ length: 15 }, (_, index) => [index, index + 1] as const));
    expect(new Set(chain.nodes.map(node => node.x)).size).toBe(4);
    expect(chain.bounds.w / chain.bounds.h).toBeLessThan(4);
    // A short chain keeps its ranks: one column for each node.
    const short = modulesOf(6, Array.from({ length: 5 }, (_, index) => [index, index + 1] as const));
    expect(new Set(short.nodes.map(node => node.x)).size).toBe(6);
    expect(new Set(short.nodes.map(node => node.y)).size).toBe(1);
  });

  it("puts what a module reads from outside before its line items, and what it feeds outside after them", () => {
    const make = new GraphMaker();
    const source = make.module("SRC - Source", "01: All");
    const middle = make.module("MID - Middle", "01: All");
    const target = make.module("TGT - Target", "01: All");
    const given = make.item(source, "Given");
    const first = make.item(middle, "First");
    const second = make.item(middle, "Second");
    const lone = make.item(middle, "Lone");
    const taken = make.item(target, "Taken");
    make.link(given, second).link(first, second).link(second, taken);
    const graph = moduleGraph(indexModel(make.graph()), middle, false, false);
    layoutGraph(graph);
    const x = (id: string): number => graph.byId.get(id)!.x;
    // The outside source stands before even the line item that reads nothing, and the outside reader after the last.
    expect(x(`external${source}`)).toBeLessThan(x(String(first)));
    expect(x(String(first))).toBeLessThan(x(String(second)));
    expect(x(String(second))).toBeLessThan(x(`external${target}`));
    expect(x(String(lone))).toBeGreaterThan(x(`external${target}`));
    expect(anyOverlap(graph)).toBe(false);
  });

  it("keeps nodes of different heights apart in one column", () => {
    const make = new GraphMaker();
    const middle = make.module("MID - Middle", "01: All");
    const total = make.item(middle, "Total");
    for (let index = 0; index < 4; index++) make.link(make.item(make.module(`SRC${index} - Source`, "01: All"), "Given"), total);
    const graph = moduleGraph(indexModel(make.graph()), middle, false, false);
    layoutGraph(graph);
    const outside = graph.nodes.filter(node => node.external).sort((a, b) => a.y - b.y);
    expect(new Set(outside.map(node => node.x)).size).toBe(1);
    for (let index = 1; index < outside.length; index++) expect(outside[index].y - (outside[index - 1].y + outside[index - 1].h)).toBe(30);
  });

  it("gives the same graph the same places every time", () => {
    const pairs: [number, number][] = [[0, 1], [0, 2], [1, 3], [2, 3], [3, 4], [5, 4], [6, 0], [4, 7], [7, 3]];
    const places = (graph: ViewGraph): number[][] => graph.nodes.map(node => [node.x, node.y]);
    expect(places(modulesOf(9, pairs))).toEqual(places(modulesOf(9, pairs)));
  });

  it("measures what nodes cover, and an empty graph as a box of one by one", () => {
    const graph = modulesOf(2, [[0, 1]]);
    expect(graph.bounds).toEqual(boundsOf(graph.nodes));
    expect(graph.bounds.w).toBe(at(graph, "M1").x + 248);
    graph.nodes[0].x = -500;
    expect(boundsOf(graph.nodes).x).toBe(-500);
    expect(boundsOf([])).toEqual({ x: 0, y: 0, w: 1, h: 1 });
    const empty = modulesOf(0, []);
    expect(empty.bounds).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });
});
