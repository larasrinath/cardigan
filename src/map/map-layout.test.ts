import { describe, expect, it } from "vitest";
import { moduleGraph, modulesGraph, sectionsGraph, type ViewGraph, type ViewNode } from "./map-graphs.js";
import { boundsOf, CARD, components, FIT_ZOOM, FULL_CARD_ZOOM, hasSmallLine, ITEM, layoutGraph, sizeNodes, type Room } from "./map-layout.js";
import { indexModel } from "./map-model.js";
import { GraphMaker, HALF_EM } from "./map-fakes.test-support.js";

/** A room so wide that the ranks of a small graph fit it at full size. */
const WIDE: Room = { width: 2400, height: 1200 };
/** The room the map has in a window of 1440 by 900. */
const PAGE: Room = { width: 1134, height: 704 };

/** The modules of a model of one section, linked as given: each pair is a module read and the module that reads it. */
function linked(count: number, pairs: readonly (readonly [number, number])[]): ViewGraph {
  const make = new GraphMaker();
  const items: number[] = [];
  for (let index = 0; index < count; index++) items.push(make.item(make.module(`M${index}`, "01: All"), "Value"));
  for (const [from, to] of pairs) make.link(items[from], items[to]);
  return modulesGraph(indexModel(make.graph()), undefined, false);
}

/** The same, laid out for a room. */
function modulesOf(count: number, pairs: readonly (readonly [number, number])[], room: Room = WIDE): ViewGraph {
  const graph = linked(count, pairs);
  layoutGraph(graph, [room]);
  return graph;
}

const chain = (length: number): [number, number][] => Array.from({ length: length - 1 }, (_, index) => [index, index + 1]);
/** The zoom a laid out graph fits a room at, as the layout counts it. */
const fitted = (graph: ViewGraph, room: Room): number => Math.min(room.width / graph.bounds.w, room.height / graph.bounds.h, FIT_ZOOM);
const columnsOf = (graph: ViewGraph): number[] => [...new Set(graph.nodes.map(node => node.x))].sort((a, b) => a - b);

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

describe("How large the map's boxes are", () => {
  it("makes a module's box as high as its name needs at full size, up to four lines", () => {
    const make = new GraphMaker();
    make.module("REV01 - Revenue", "01: All");
    make.module("REV02 - Regional Revenue Planning by Product Family and Sales Channel", "01: All");
    make.module(`REV03 - ${Array.from({ length: 30 }, (_, index) => `Word${index}`).join(" ")}`, "01: All");
    const graph = modulesGraph(indexModel(make.graph()), undefined, false);
    sizeNodes(graph, HALF_EM, HALF_EM);
    // A small line of 12 and 3 under it, then the name's lines of 15.5, between 9 above and 9 below.
    expect(graph.nodes.map(node => [node.lines.length, node.w, node.h])).toEqual([[1, 232, 48.5], [2, 232, 64], [4, 232, 95]]);
    expect(graph.nodes[1].lines).toEqual(["Regional Revenue Planning by", "Product Family and Sales Channel"]);
    // What four lines do not hold is cut on the last, with the mark.
    expect(graph.nodes[2].lines[3].endsWith("…")).toBe(true);
    expect(graph.nodes[2].lines[0]).toBe("Word0 Word1 Word2 Word3 Word4 Word5");
  });

  it("makes a line item's box for its name alone, in its own letters", () => {
    const make = new GraphMaker();
    const plan = make.module("REV01 - Revenue", "01: All");
    make.item(plan, "Units");
    make.item(plan, "Units Sold Before Returns and Allowances by Region");
    const graph = moduleGraph(indexModel(make.graph()), plan, false, false);
    // The line item's measure is asked, not the box's: here it counts every letter twice as wide.
    const wide = { word: (text: string) => [...text].length, char: () => 1, space: 0.5, ellipsis: 1 };
    sizeNodes(graph, HALF_EM, wide);
    expect(graph.nodes.map(node => [node.lines.length, node.w, node.h])).toEqual([[1, 216, 32], [4, 216, 74]]);
    expect(graph.nodes[1].lines).toEqual(["Units Sold Before", "Returns and", "Allowances by", "Region"]);
    sizeNodes(graph, wide, HALF_EM);
    expect(graph.nodes.map(node => [node.lines, node.h])).toEqual([[["Units"], 32], [["Units Sold Before Returns and", "Allowances by Region"], 46]]);
  });

  it("leaves the room of the small line out of a box that has nothing to say there", () => {
    const graph = linked(1, []);
    sizeNodes(graph, HALF_EM, HALF_EM);
    const [node] = graph.nodes;
    expect([hasSmallLine(node), node.h]).toEqual([true, CARD.top + CARD.small + CARD.gap + CARD.line + CARD.bottom]);
    expect(hasSmallLine({ ...node, code: "", meta: "" })).toBe(false);
    expect(hasSmallLine({ ...node, kind: "lineItem" })).toBe(false);
    expect(ITEM.top + ITEM.line + ITEM.bottom).toBe(32);
  });
});

describe("Where the map's nodes stand", () => {
  function sections(count: number, rooms: readonly Room[]): ViewGraph {
    const make = new GraphMaker();
    for (let index = 0; index < count; index++) make.item(make.module(`M${index}`, `0${index}: Section ${index}`), "Value");
    const graph = sectionsGraph(indexModel(make.graph()), false);
    expect(layoutGraph(graph, rooms)).toBe("grid");
    return graph;
  }

  it("puts sections in a grid, in their order, with as many in a row as fills the room best", () => {
    // Seven boxes of 232 by 49, 56 apart and 30 under each other. In the page's room three in a row are the most that
    // still fit at full size.
    const graph = sections(7, [PAGE]);
    expect(graph.nodes.map(node => [node.x, node.y])).toEqual([[0, 0], [288, 0], [576, 0], [0, 79], [288, 79], [576, 79], [0, 158]]);
    expect(graph.bounds).toEqual({ x: 0, y: 0, w: 576 + 232, h: 158 + 49 });
    // A room that is wide and low takes them in one row, and a narrow one under each other.
    expect(sections(7, [{ width: 2400, height: 200 }]).nodes.map(node => [node.x, node.y])).toEqual(Array.from({ length: 7 }, (_, index) => [index * 288, 0]));
    expect(sections(7, [{ width: 400, height: 900 }]).nodes.map(node => [node.x, node.y])).toEqual(Array.from({ length: 7 }, (_, index) => [0, index * 79]));
  });

  it("lays a graph out for the room it fits largest, when there is more than one", () => {
    const narrow: Room = { width: 400, height: 900 };
    const low: Room = { width: 1500, height: 120 };
    // The narrow room takes seven sections at full size under each other; the low one only smaller, in two rows.
    expect(columnsOf(sections(7, [low, narrow]))).toEqual([0]);
    expect(columnsOf(sections(7, [narrow, low]))).toEqual([0]);
    expect(columnsOf(sections(7, [low]))).toHaveLength(5);
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

  it("breaks a rank of many nodes into columns, as many as fill the room best", () => {
    // One module that 30 others read: the second rank has 30 nodes.
    const star = Array.from({ length: 30 }, (_, index) => [0, index + 1] as const);
    const rowsIn = (room: Room): number[] => {
      const graph = linked(31, star);
      expect(layoutGraph(graph, [room])).toBe("ranked");
      expect(anyOverlap(graph)).toBe(false);
      const columns = new Map<number, number>();
      for (const node of graph.nodes.slice(1)) columns.set(node.x, (columns.get(node.x) ?? 0) + 1);
      return [...columns.values()];
    };
    expect(rowsIn({ width: 900, height: 600 })).toEqual([10, 10, 10]);
    expect(rowsIn({ width: 800, height: 1100 })).toEqual([15, 15]);
    expect(rowsIn({ width: 1800, height: 420 })).toEqual([6, 6, 6, 6, 6]);
  });

  it("keeps the ranks while every name on them is drawn in full, and packs the graph where they would come out smaller", () => {
    // Six modules in a chain are 1,832 wide as ranks: a room of 2,000 shows them in full, one of 900 at half the size.
    const wide: Room = { width: 2000, height: 600 };
    const ranks = linked(6, chain(6));
    expect(layoutGraph(ranks, [wide])).toBe("ranked");
    expect(columnsOf(ranks)).toEqual([0, 320, 640, 960, 1280, 1600]);
    expect(new Set(ranks.nodes.map(node => node.y)).size).toBe(1);
    expect(fitted(ranks, wide)).toBeGreaterThanOrEqual(FULL_CARD_ZOOM);

    const narrow: Room = { width: 900, height: 600 };
    const packed = linked(6, chain(6));
    expect(layoutGraph(packed, [narrow])).toBe("packed");
    // Two columns of three fit at full size, in the order of the chain: down the first column, then down the second.
    expect(packed.nodes.map(node => [node.fullName, node.x, node.y])).toEqual([["M0", 0, 0], ["M1", 0, 63], ["M2", 0, 126], ["M3", 296, 0], ["M4", 296, 63], ["M5", 296, 126]]);
    expect(fitted(packed, narrow)).toBe(FIT_ZOOM);
  });

  it("keeps ranks that are smaller than full size when packing would not make the picture larger", () => {
    // Sixty modules that nothing links are one rank, whose columns stand closer than packed ones: no links run between.
    const room: Room = { width: 900, height: 600 };
    const graph = linked(60, []);
    expect(layoutGraph(graph, [room])).toBe("ranked");
    expect(columnsOf(graph)).toEqual([0, 260, 520, 780, 1040]);
    expect(fitted(graph, room)).toBeLessThan(FULL_CARD_ZOOM);
    expect(anyOverlap(graph)).toBe(false);
  });

  it("keeps a rank whole where breaking it would not make the picture larger", () => {
    // Four modules that one reads: the four stand in one column, though two columns of two would fit as large.
    const graph = modulesOf(5, [[0, 4], [1, 4], [2, 4], [3, 4]], PAGE);
    expect(columnsOf(graph)).toEqual([0, 320]);
    expect(graph.nodes.filter(node => node.x === 0)).toHaveLength(4);
  });

  it("packs a large graph into columns of equal length, as many as fill the room best", () => {
    const graph = linked(60, chain(60));
    expect(layoutGraph(graph, [{ width: 900, height: 600 }])).toBe("packed");
    // Sixty boxes of 232 by 49, the columns 64 apart and the boxes 14: four columns of fifteen fit this room largest.
    expect(columnsOf(graph)).toEqual([0, 296, 592, 888]);
    expect(graph.nodes.filter(node => node.x === 0).map(node => node.fullName)).toEqual(Array.from({ length: 15 }, (_, index) => `M${index}`));
    expect(at(graph, "M15")).toMatchObject({ x: 296, y: 0 });
    expect(at(graph, "M1").y).toBe(49 + 14);
    expect(anyOverlap(graph)).toBe(false);
    // A room twice as wide takes more columns, and a narrow high one fewer.
    const wider = linked(60, chain(60));
    layoutGraph(wider, [{ width: 1800, height: 600 }]);
    expect(columnsOf(wider)).toHaveLength(6);
    const higher = linked(60, chain(60));
    layoutGraph(higher, [{ width: 600, height: 1400 }]);
    expect(columnsOf(higher)).toHaveLength(2);
  });

  it("never lays a graph out smaller than another way would fit the same room", () => {
    const rooms: Room[] = [{ width: 1134, height: 704 }, { width: 996, height: 604 }, { width: 600, height: 420 }, { width: 420, height: 800 }];
    for (const size of [3, 14, 31, 80, 250]) {
      // A chain with a link back every fifth node and a few modules that nothing links.
      const pairs = chain(size - 2).concat(Array.from({ length: Math.floor(size / 5) }, (_, index) => [index * 5 + 3, index * 5] as [number, number]));
      for (const room of rooms) {
        const graph = linked(size, pairs);
        const how = layoutGraph(graph, [room]);
        const zoom = fitted(graph, room);
        expect(anyOverlap(graph)).toBe(false);
        // One column, and one row of columns, are two of the ways: the chosen one is at least as large as either.
        const column = graph.nodes.reduce((height, node) => height + node.h + 14, -14);
        expect(zoom).toBeGreaterThanOrEqual(Math.min(room.width / 232, room.height / column, FIT_ZOOM) - 1e-9);
        if (how === "packed") expect(zoom).toBeLessThanOrEqual(FIT_ZOOM);
      }
    }
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
    const model = indexModel(make.graph());
    const graph = moduleGraph(model, middle, false, false);
    expect(layoutGraph(graph, [WIDE])).toBe("ranked");
    const x = (id: string): number => graph.byId.get(id)!.x;
    // The outside source stands before even the line item that reads nothing, and the outside reader after the last.
    expect(x(`external${source}`)).toBeLessThan(x(String(first)));
    expect(x(String(first))).toBeLessThan(x(String(second)));
    expect(x(String(second))).toBeLessThan(x(`external${target}`));
    expect(x(String(lone))).toBeGreaterThan(x(`external${target}`));
    expect(anyOverlap(graph)).toBe(false);
    // Packed into a narrow room, the boxes keep that order: down a column, then the next.
    const packed = moduleGraph(model, middle, false, false);
    expect(layoutGraph(packed, [{ width: 420, height: 800 }])).toBe("packed");
    const order = [...packed.nodes].sort((a, b) => a.x - b.x || a.y - b.y).map(node => node.id);
    expect(order).toEqual([`external${source}`, String(first), String(second), `external${target}`, String(lone)]);
  });

  it("keeps boxes of different heights the same distance apart in a column", () => {
    const make = new GraphMaker();
    const middle = make.module("MID - Middle", "01: All");
    const total = make.item(middle, "Total");
    const names = ["Source", "Source of the Regional Revenue Planning by Product Family", "Feed", "Source of Everything Else That the Planning Reads Every Month and Every Quarter of the Year"];
    names.forEach((name, index) => make.link(make.item(make.module(`SRC${index} - ${name}`, "01: All"), "Given"), total));
    const graph = moduleGraph(indexModel(make.graph()), middle, false, false);
    sizeNodes(graph, HALF_EM, HALF_EM);
    expect(layoutGraph(graph, [WIDE])).toBe("ranked");
    const outside = graph.nodes.filter(node => node.external).sort((a, b) => a.y - b.y);
    expect(new Set(outside.map(node => node.x)).size).toBe(1);
    expect(new Set(outside.map(node => node.h)).size).toBe(3);
    for (let index = 1; index < outside.length; index++) expect(outside[index].y - (outside[index - 1].y + outside[index - 1].h)).toBe(16);
    // The line item they all feed stands at the middle of their column.
    const column = outside[outside.length - 1].y + outside[outside.length - 1].h - outside[0].y;
    expect(graph.byId.get(String(total))!.y + 16).toBeCloseTo(outside[0].y + column / 2, 6);
  });

  it("gives the same graph the same places every time", () => {
    const pairs: [number, number][] = [[0, 1], [0, 2], [1, 3], [2, 3], [3, 4], [5, 4], [6, 0], [4, 7], [7, 3]];
    const places = (graph: ViewGraph): number[][] => graph.nodes.map(node => [node.x, node.y]);
    for (const room of [WIDE, PAGE, { width: 420, height: 800 }]) expect(places(modulesOf(9, pairs, room))).toEqual(places(modulesOf(9, pairs, room)));
  });

  it("lays a graph out for a room of 900 by 600 when none is given", () => {
    const places = (graph: ViewGraph): number[][] => graph.nodes.map(node => [node.x, node.y]);
    const unsaid = linked(20, chain(20));
    layoutGraph(unsaid);
    expect(places(unsaid)).toEqual(places(modulesOf(20, chain(20), { width: 900, height: 600 })));
    const none = linked(20, chain(20));
    layoutGraph(none, []);
    expect(places(none)).toEqual(places(unsaid));
  });

  it("measures what nodes cover, and an empty graph as a box of one by one", () => {
    const graph = modulesOf(2, [[0, 1]]);
    expect(graph.bounds).toEqual(boundsOf(graph.nodes));
    expect(graph.bounds.w).toBe(at(graph, "M1").x + 232);
    graph.nodes[0].x = -500;
    expect(boundsOf(graph.nodes).x).toBe(-500);
    expect(boundsOf([])).toEqual({ x: 0, y: 0, w: 1, h: 1 });
    const empty = linked(0, []);
    expect(layoutGraph(empty, [PAGE])).toBe("empty");
    expect(empty.bounds).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });
});
