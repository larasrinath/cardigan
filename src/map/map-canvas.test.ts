import { describe, expect, it } from "vitest";
import type { Camera } from "./map-camera.js";
import { createFonts, drawMinimap, drawScene, legibleFrom, type Pen, type Scene } from "./map-canvas.js";
import { moduleGraph, modulesGraph, type ViewGraph, type ViewNode } from "./map-graphs.js";
import { CARD, FULL_CARD_ZOOM, FULL_ITEM_ZOOM, ITEM, layoutGraph, sizeNodes, type Room } from "./map-layout.js";
import { indexModel } from "./map-model.js";
import { FALLBACK } from "./map-palette.js";
import { lineWidth } from "./map-text.js";
import { traceNode } from "./map-trace.js";
import { FakePen, GraphMaker, HOSTILE, type PenCall } from "./map-fakes.test-support.js";

const PLAIN: Camera = { ox: 0, oy: 0, k: 1 };
/** A room wide enough for the ranks of a small graph at full size. */
const WIDE: Room = { width: 2400, height: 1200 };

/** Sizes a graph's boxes to their names and lays it out, as the view does before it draws: with the widths the pen
 * that draws them gives. */
const MEASURES = createFonts(new FakePen() as unknown as Pen, FALLBACK);
function ready(graph: ViewGraph, room: Room = WIDE): ViewGraph {
  sizeNodes(graph, MEASURES.measure("label"), MEASURES.measure("item"));
  layoutGraph(graph, [room]);
  return graph;
}

/** Three modules in a row, A -> B -> C, and one of another section that feeds A. */
function sample() {
  const make = new GraphMaker();
  const outside = make.item(make.module("OUT - Outside", "00: Other"), "Value");
  const [a, b, c] = ["AAA - First Module", "BBB - Second Module", "CCC - Third Module"].map(name => make.item(make.module(name, "01: Main"), "Value"));
  make.link(outside, a).link(a, b).link(b, c);
  const model = indexModel(make.graph());
  return { model, graph: ready(modulesGraph(model, "01: Main", false)) };
}

/** Modules of one section, linked as given, laid out for a room. */
function linked(count: number, pairs: readonly (readonly [number, number])[], room: Room = WIDE) {
  const make = new GraphMaker();
  const items = Array.from({ length: count }, (_, index) => make.item(make.module(`M${index}`, "01: Main"), "Value"));
  for (const [from, to] of pairs) make.link(items[from], items[to]);
  const model = indexModel(make.graph());
  return { model, graph: ready(modulesGraph(model, undefined, false), room) };
}

function sceneOf(graph: ViewGraph, extra: Partial<Scene> = {}): Scene {
  return { graph, camera: PLAIN, width: 2400, height: 1200, palette: FALLBACK, shown: new Uint8Array(graph.nodes.length).fill(1), ...extra };
}

function draw(scene: Scene): { pen: FakePen; traced: boolean } {
  const pen = new FakePen();
  const traced = drawScene(pen as unknown as Pen, scene, createFonts(pen as unknown as Pen, scene.palette));
  return { pen, traced };
}

const place = (graph: ViewGraph, name: string): number => graph.nodes.findIndex(node => node.fullName === name);
const named = (graph: ViewGraph, name: string): ViewNode => graph.nodes[place(graph, name)];
const middle = (node: ViewNode): number => node.y + node.h / 2;
const sizeOf = (call: PenCall): number => parseFloat(/([\d.]+)px/.exec(call.font)![1]);
/** The pen's calls from one filled or stroked shape back to where its path began. */
function shapeBefore(pen: FakePen, end: PenCall): PenCall[] {
  const at = pen.calls.indexOf(end);
  let start = at;
  while (start > 0 && pen.calls[start].name !== "beginPath") start--;
  return pen.calls.slice(start + 1, at);
}
/** The filled triangles of a colour, each as its three corners: arrowheads and the signs of a trace. */
function triangles(pen: FakePen, colour: string): number[][][] {
  const found: number[][][] = [];
  for (const call of pen.named("fill")) {
    if (call.fillStyle !== colour) continue;
    const shape = shapeBefore(pen, call);
    if (shape.map(each => each.name).join() === "moveTo,lineTo,lineTo,closePath") found.push(shape.slice(0, 3).map(each => each.args as number[]));
  }
  return found;
}
/** The links drawn: the strokes that end a curve. */
const linkStrokes = (pen: FakePen): PenCall[] => pen.named("stroke").filter(call => shapeBefore(pen, call).some(each => each.name === "bezierCurveTo"));

describe("The map's picture", () => {
  it("fills the whole canvas with the canvas's colour before anything else", () => {
    const { graph } = sample();
    const { pen } = draw(sceneOf(graph));
    const first = pen.calls.find(call => call.name === "fillRect")!;
    expect([first.args, first.fillStyle, first.globalAlpha]).toEqual([[0, 0, 2400, 1200], FALLBACK.canvas, 1]);
    expect(pen.calls.indexOf(first)).toBeLessThan(pen.calls.findIndex(call => call.name === "roundRect"));
  });

  it("draws each node at full size as a box with a small line (its code, and what it holds or where it belongs) and its name", () => {
    const { graph } = sample();
    const { pen } = draw(sceneOf(graph));
    expect(pen.named("roundRect").map(call => call.args.slice(0, 4))).toEqual(graph.nodes.map(node => [node.x, node.y, node.w, node.h]));
    // The section's own modules say how much they hold; the module of another section says which section it is of.
    expect(pen.texts()).toEqual(["OUT · 00: Other", "Outside", "AAA · 1 line item", "First Module", "BBB · 1 line item", "Second Module", "CCC · 1 line item", "Third Module"]);
    const drawn = new Map(pen.named("fillText").map(call => [String(call.args[0]), call]));
    expect([drawn.get("First Module")?.font, drawn.get("AAA · 1 line item")?.font]).toEqual(["600 12.5px sans-serif", "500 9.5px monospace"]);
    // A node's name is in the node's text colour, its small line in the quieter one; outside the section both are quiet.
    expect([drawn.get("First Module")?.fillStyle, drawn.get("AAA · 1 line item")?.fillStyle, drawn.get("Outside")?.fillStyle, drawn.get("OUT · 00: Other")?.fillStyle])
      .toEqual([FALLBACK.nodeText, FALLBACK.nodeTextMuted, FALLBACK.nodeTextMuted, FALLBACK.nodeTextMuted]);
    // Both start at the box's left padding; the name stands under the small line.
    const first = named(graph, "AAA - First Module");
    expect(drawn.get("First Module")?.args.slice(1)).toEqual([first.x + CARD.padLeft, first.y + CARD.top + CARD.small + CARD.gap + CARD.line * 0.74]);
    expect(drawn.get("AAA · 1 line item")?.args.slice(1)).toEqual([first.x + CARD.padLeft, first.y + CARD.top + 9]);
  });

  it("writes a name on as many lines as it was wrapped to, one under another", () => {
    const make = new GraphMaker();
    make.item(make.module("REV02 - Regional Revenue Planning by Product Family and Sales Channel", "01: Main"), "Value");
    const graph = ready(modulesGraph(indexModel(make.graph()), undefined, false));
    const { pen } = draw(sceneOf(graph));
    expect(pen.texts()).toEqual(["REV02 · 1 line item", "Regional Revenue Planning by", "Product Family and Sales Channel"]);
    const [, first, second] = pen.named("fillText");
    expect((second.args[2] as number) - (first.args[2] as number)).toBe(CARD.line);
  });

  it("writes a name on the canvas as the text it is, whatever it holds", () => {
    const make = new GraphMaker();
    HOSTILE.forEach(name => make.item(make.module(name, "01: Main"), name));
    const graph = ready(modulesGraph(indexModel(make.graph()), undefined, false));
    const { pen } = draw(sceneOf(graph, { camera: { ox: 0, oy: 0, k: 3 }, width: 20000, height: 20000 }));
    const drawn = pen.texts().join(" ");
    // Each name is there as typed, as far as its node has room for it.
    for (const name of HOSTILE) expect(drawn, name).toContain(name.slice(0, 12));
    // Nothing but text went to the canvas as text: the pen was never asked to make anything of it.
    expect(new Set(pen.calls.map(call => call.name))).not.toContain("drawImage");
  });

  it("gives a node of the section a strip of its section's colour, and a node outside it a dashed edge instead", () => {
    const { graph } = sample();
    const { pen } = draw(sceneOf(graph));
    const fills = pen.named("fill").map(call => call.fillStyle);
    // Three nodes of the second section in the model: its colour is the second of the eight.
    expect(fills.filter(colour => colour === FALLBACK.sections[1])).toHaveLength(3);
    expect(fills.filter(colour => colour === FALLBACK.nodeFill)).toHaveLength(4);
    const edges = pen.named("stroke").filter(call => call.strokeStyle === FALLBACK.external);
    expect(edges.map(call => call.dash)).toEqual([[4, 4]]);
    expect(pen.named("stroke").filter(call => call.strokeStyle === FALLBACK.nodeBorder).map(call => call.dash)).toEqual([[], [], []]);
  });

  it("leaves out a node that is not shown, and every link to it", () => {
    const { graph } = sample();
    const shown = new Uint8Array(graph.nodes.length).fill(1);
    shown[place(graph, "BBB - Second Module")] = 0;
    const { pen } = draw(sceneOf(graph, { shown }));
    expect(pen.named("roundRect")).toHaveLength(3);
    expect(pen.texts()).not.toContain("Second Module");
    // Of the three links only the one between the two nodes that are both shown is drawn.
    expect(pen.named("bezierCurveTo")).toHaveLength(1);
  });

  it("draws the nodes in the order it is given, so that a node brought forward lies over the others", () => {
    const { graph } = sample();
    const forward = draw(sceneOf(graph, { order: [1, 2, 3, 0] })).pen;
    expect(forward.named("roundRect").map(call => call.args.slice(0, 2))).toEqual([1, 2, 3, 0].map(index => [graph.nodes[index].x, graph.nodes[index].y]));
    expect(forward.texts().slice(-2)).toEqual(["OUT · 00: Other", "Outside"]);
  });

  it("draws nothing of a node or a link that is off the canvas", () => {
    const { graph } = sample();
    const { pen } = draw(sceneOf(graph, { camera: { ox: -100000, oy: 0, k: 1 } }));
    expect([pen.named("roundRect").length, pen.named("bezierCurveTo").length, pen.texts().length]).toEqual([0, 0, 0]);
  });

  it("draws a dot at each crossing of the grid while the grid is wide enough, as rows of dashes", () => {
    const { graph } = sample();
    const wide = draw(sceneOf(graph)).pen.named("stroke").find(call => call.strokeStyle === FALLBACK.grid);
    expect(wide?.dash).toEqual([1, 25]);
    expect(draw(sceneOf(graph, { camera: { ox: 0, oy: 0, k: 0.3 } })).pen.named("stroke").filter(call => call.strokeStyle === FALLBACK.grid)).toEqual([]);
  });
});

describe("A link in the map's picture", () => {
  it("runs from the right of what is read to the left of what reads it, and ends there in an arrowhead", () => {
    const { graph } = linked(2, [[0, 1]]);
    const { pen } = draw(sceneOf(graph));
    const [from, to] = graph.nodes;
    expect(to.x).toBeGreaterThan(from.x + from.w);
    const [stroke] = linkStrokes(pen);
    const shape = shapeBefore(pen, stroke);
    expect(shape.map(call => call.name)).toEqual(["moveTo", "bezierCurveTo"]);
    expect(shape[0].args).toEqual([from.x + from.w, middle(from)]);
    // The line stops just inside the arrowhead, whose tip touches the box that reads.
    expect(shape[1].args.slice(4)).toEqual([to.x - 8, middle(to)]);
    expect(triangles(pen, FALLBACK.edge)).toEqual([[[to.x, middle(to)], [to.x - 9, middle(to) - 9 * 0.42], [to.x - 9, middle(to) + 9 * 0.42]]]);
    // In the links' own colour, at full strength: it stands 3 to 1 against the canvas (map-palette.test.ts).
    expect([stroke.strokeStyle, stroke.globalAlpha, stroke.dash]).toEqual([FALLBACK.edge, 1, []]);
  });

  it("is heavier the more of the model's links it counts", () => {
    const make = new GraphMaker();
    const [first, second] = ["First", "Second"].map(name => make.module(name, "01: Main"));
    const target = make.item(second, "Target");
    for (const index of [0, 1, 2]) make.link(make.item(first, `Source ${index}`), target);
    make.link(target, make.item(make.module("Third", "01: Main"), "Single"));
    const graph = ready(modulesGraph(indexModel(make.graph()), undefined, false));
    // In the order of the graph's links: the one link on to the third module, then the three between the first two.
    expect(graph.edges.map(edge => edge.w)).toEqual([1, 3]);
    const widths = linkStrokes(draw(sceneOf(graph)).pen).map(call => call.lineWidth);
    expect(widths).toEqual([0.8 + Math.log2(2) * 0.35, 0.8 + Math.log2(4) * 0.35]);
  });

  it("keeps an arrowhead large enough to be seen however small the picture, and a line at least a pixel wide", () => {
    const { graph } = linked(2, [[0, 1]]);
    const { pen } = draw(sceneOf(graph, { camera: { ox: 0, oy: 0, k: 0.3 } }));
    const [[tip, back]] = triangles(pen, FALLBACK.edge);
    expect(tip[0] - back[0]).toBe(6.5);
    expect(linkStrokes(pen)[0].lineWidth).toBe(1);
    // And never larger than ten pixels, however near.
    const [[nearTip, nearBack]] = triangles(draw(sceneOf(graph, { camera: { ox: 0, oy: 0, k: 3 }, width: 9000, height: 9000 })).pen, FALLBACK.edge);
    expect(nearTip[0] - nearBack[0]).toBe(10);
  });

  it("runs round the right of the column between two boxes of one column, and ends at the right of the box that reads", () => {
    // Six modules in a chain, packed into two columns of three: M0 feeds M1, which stands under it.
    const { graph } = linked(6, [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5]], { width: 900, height: 600 });
    const [from, to] = [named(graph, "M0"), named(graph, "M1")];
    expect([to.x, to.y > from.y]).toEqual([from.x, true]);
    const { pen } = draw(sceneOf(graph));
    const right = from.x + from.w;
    const shape = shapeBefore(pen, linkStrokes(pen)[0]);
    // It leaves a little under the middle of the one and arrives a little over the middle of the other.
    expect(shape[0].args).toEqual([right, middle(from) + 7]);
    const curve = shape[1].args as number[];
    expect(curve.slice(4)).toEqual([right + 8, middle(to) - 7]);
    // Both of its bends are to the right of the column: it crosses no box of it.
    expect(Math.min(curve[0], curve[2])).toBeGreaterThan(right);
    expect(triangles(pen, FALLBACK.edge)[0]).toEqual([[right, middle(to) - 7], [right + 9, middle(to) - 7 - 9 * 0.42], [right + 9, middle(to) - 7 + 9 * 0.42]]);
    // The link from the foot of the first column to the head of the second is an ordinary one, from right to left.
    const [last, next] = [named(graph, "M2"), named(graph, "M3")];
    expect(triangles(pen, FALLBACK.edge)[2][0]).toEqual([next.x, middle(next)]);
    expect(shapeBefore(pen, linkStrokes(pen)[2])[0].args).toEqual([last.x + last.w, middle(last)]);
  });

  it("runs straight back to a box that stands further left, and ends at its right", () => {
    const { graph } = linked(2, [[0, 1]]);
    // The reader is put to the left of what it reads, as a packed graph or a dragged box can have it.
    const [from, to] = graph.nodes;
    from.x = 600;
    to.x = 0;
    to.y = 200;
    const { pen } = draw(sceneOf(graph));
    const shape = shapeBefore(pen, linkStrokes(pen)[0]);
    expect(shape[0].args).toEqual([600, middle(from)]);
    expect((shape[1].args as number[]).slice(4)).toEqual([to.w + 8, middle(to)]);
    expect(triangles(pen, FALLBACK.edge)[0][0]).toEqual([to.w, middle(to)]);
  });

  it("draws the link of a line item that reads itself over the line item's own top", () => {
    const make = new GraphMaker();
    const plan = make.module("PLN01 - Plan", "01: Main");
    const running = make.item(plan, "Running Total", { formula: "Value + PREVIOUS(Running Total)" });
    make.link(running, running);
    const graph = ready(moduleGraph(indexModel(make.graph()), plan, false, false));
    const { pen } = draw(sceneOf(graph));
    const [node] = graph.nodes;
    const shape = shapeBefore(pen, linkStrokes(pen)[0]);
    expect(shape.map(call => call.name)).toEqual(["moveTo", "bezierCurveTo", "lineTo", "bezierCurveTo"]);
    expect(shape[0].args).toEqual([node.x + node.w, middle(node)]);
    expect((shape[2].args as number[])[1]).toBe(node.y - 14);
    expect(triangles(pen, FALLBACK.edge)[0][0]).toEqual([node.x, middle(node)]);
  });

  it("draws each link lighter where there are more than three hundred of them, so that they do not hide the boxes", () => {
    const complete = (count: number) => linked(count, Array.from({ length: count }, (_, from) => Array.from({ length: count - from - 1 }, (_, step) => [from, from + step + 1] as const)).flat());
    const strength = (graph: ViewGraph): number => linkStrokes(draw(sceneOf(graph, { width: 100000, height: 100000 })).pen)[0].globalAlpha;
    // 45 links, 780 links, and 4,950 links: full strength, less, and never less than a fifth.
    expect(strength(complete(10).graph)).toBe(1);
    expect(strength(complete(40).graph)).toBeCloseTo(300 / 780, 5);
    expect(strength(complete(100).graph)).toBeCloseTo(0.2, 5);
    // A trace of many links is thinned the same way; one of a few is in full strength, and the rest stand back.
    const many = complete(40);
    const traced = linkStrokes(draw(sceneOf(many.graph, { trace: traceNode(many.graph, many.model, 0, false), width: 100000, height: 100000 })).pen);
    expect(traced).toHaveLength(780);
    expect(new Set(traced.map(call => call.strokeStyle))).toEqual(new Set([FALLBACK.traceDown]));
    expect(traced[0].globalAlpha).toBeCloseTo(300 / 780, 5);
    const few = linked(4, [[0, 1], [1, 2], [0, 3]]);
    const strokes = linkStrokes(draw(sceneOf(few.graph, { trace: traceNode(few.graph, few.model, place(few.graph, "M2"), false) })).pen);
    expect(strokes.map(call => [call.strokeStyle, call.globalAlpha])).toEqual([[FALLBACK.traceUp, 1], [FALLBACK.edge, 0.12], [FALLBACK.traceUp, 1]]);
  });
});

describe("The map's picture from far away and from near", () => {
  it("writes only the name, code and all, in letters that stay readable, where a box is too small to be drawn in full", () => {
    const { graph } = sample();
    // Half size: a box of 116 by 24 has room for one line of ten pixel letters.
    const half = draw(sceneOf(graph, { camera: { ox: 0, oy: 0, k: 0.5 } })).pen;
    expect(half.texts()).toEqual(["OUT - Outside", "AAA - First Module", "BBB - Second Module", "CCC - Third Module"]);
    expect(new Set(half.named("fillText").map(call => call.font))).toEqual(new Set(["600 10px sans-serif"]));
    // A box with room for more lines takes the name on as many as it needs, in the middle of the box.
    const long = new GraphMaker();
    long.item(long.module("REV02 - Regional Revenue Planning by Product Family", "01: Main"), "Value");
    const wrapped = ready(modulesGraph(indexModel(long.graph()), undefined, false));
    const lines = draw(sceneOf(wrapped, { camera: { ox: 0, oy: 0, k: 0.7 } })).pen.named("fillText");
    expect(lines.map(call => call.args[0])).toEqual(["REV02 - Regional Revenue", "Planning by Product Family"]);
    const [box] = wrapped.nodes;
    const text = { top: (lines[0].args[2] as number) - 10 * 0.86, bottom: (lines[1].args[2] as number) - 10 * 0.86 + 12 };
    expect(text.top - box.y * 0.7).toBeCloseTo((box.y + box.h) * 0.7 - text.bottom, 6);
  });

  it("goes on writing a line while a box is thirteen pixels high, and writes nothing in a lower one", () => {
    const { graph } = sample();
    const least = legibleFrom(graph);
    expect(least).toBeCloseTo(13 / 48.5, 10);
    const lowest = draw(sceneOf(graph, { camera: { ox: 0, oy: 0, k: least + 1e-6 } })).pen;
    expect(lowest.texts()).toHaveLength(4);
    // One low line: half a pixel smaller, cut to its box and saying so.
    expect(new Set(lowest.named("fillText").map(call => call.font))).toEqual(new Set(["600 9.5px sans-serif"]));
    expect(lowest.texts()[1]).toMatch(/^AAA - .*…$/);
    const below = draw(sceneOf(graph, { camera: { ox: 0, oy: 0, k: least - 0.01 } })).pen;
    expect(below.texts()).toEqual([]);
    expect(below.named("roundRect")).toHaveLength(4);
    // A graph with a line item is readable from a larger zoom: a line item's box is lower.
    const make = new GraphMaker();
    const plan = make.module("PLN01 - Plan", "01: Main");
    make.item(plan, "Units");
    expect(legibleFrom(ready(moduleGraph(indexModel(make.graph()), plan, false, false)))).toBeCloseTo(13 / 32, 10);
    expect(legibleFrom(ready(modulesGraph(indexModel(new GraphMaker().graph()), undefined, false)))).toBe(0);
  });

  it("draws a node as a patch of its colour below a tenth of full size", () => {
    const { graph } = sample();
    const patches = draw(sceneOf(graph, { camera: { ox: 0, oy: 0, k: 0.05 } })).pen;
    expect(patches.named("roundRect")).toEqual([]);
    expect(patches.texts()).toEqual([]);
    expect(patches.named("fillRect").slice(1).map(call => call.fillStyle)).toEqual([FALLBACK.external, FALLBACK.sections[1], FALLBACK.sections[1], FALLBACK.sections[1]]);
    // A patch never gets thinner than two pixels, however far away.
    for (const call of patches.named("fillRect").slice(1)) expect(Math.min(call.args[2] as number, call.args[3] as number)).toBeGreaterThanOrEqual(2);
  });

  it("draws a box in full from the zoom that leaves its name's letters nine and a half pixels, a line item from a larger one", () => {
    expect([CARD.font * FULL_CARD_ZOOM, Math.round(ITEM.font * FULL_ITEM_ZOOM * 10) / 10]).toEqual([9.5, 9.5]);
    const make = new GraphMaker();
    const source = make.module("SRC01 - Source", "01: Main");
    const plan = make.module("PLN01 - Plan", "01: Main");
    make.link(make.item(source, "Given"), make.item(plan, "Units Sold"));
    const graph = ready(moduleGraph(indexModel(make.graph()), plan, false, false));
    const fontsAt = (k: number): Map<string, string> => new Map(draw(sceneOf(graph, { camera: { ox: 0, oy: 0, k } })).pen.named("fillText").map(call => [String(call.args[0]), call.font]));
    // At 0.8 the other module's box is drawn in full, and the line item's name is written in the small letters.
    expect([...fontsAt(0.8)]).toEqual([["Units Sold", "500 10px sans-serif"], ["SRC01 · 1 line item linked", "500 9px monospace"], ["Source", "600 10px sans-serif"]]);
    expect(fontsAt(FULL_ITEM_ZOOM).get("Units Sold")).toBe(`500 ${ITEM.font * FULL_ITEM_ZOOM}px sans-serif`);
    expect([...fontsAt(FULL_CARD_ZOOM - 0.01).keys()]).toEqual(["Units Sold", "SRC01 - Source"]);
  });

  it("never lets the small line's letters shrink below nine pixels, and cuts the line to the room the box has left", () => {
    const make = new GraphMaker();
    make.item(make.module("OUT01 - Outside", "09: A Section With A Name That Is Far Too Long For A Small Line"), "Value");
    const inside = make.item(make.module("INS01 - Inside", "01: Main"), "Value");
    make.link(0 + 1, inside);
    const graph = ready(modulesGraph(indexModel(make.graph()), "01: Main", false));
    for (const k of [FULL_CARD_ZOOM, 0.9, 1, 2]) {
      const [small] = draw(sceneOf(graph, { camera: { ox: 0, oy: 0, k }, width: 9000, height: 9000 })).pen.named("fillText");
      const size = sizeOf(small);
      expect(size, `at ${k}`).toBe(Math.max(9, CARD.smallFont * k));
      const text = String(small.args[0]);
      expect(text, `at ${k}`).toMatch(/^OUT01 · 09: A Section.*…$/);
      // The pen's letters are half their size wide: the line ends inside the box's padding.
      expect([...text].length * size / 2, `at ${k}`).toBeLessThanOrEqual((CARD.width - CARD.padLeft - CARD.padRight) * k);
    }
  });

  it("never writes a line wider than its box, at any zoom", () => {
    const make = new GraphMaker();
    const endless = Array.from({ length: 60 }, (_, index) => `Word${index}`).join(" ");
    const module = make.module(`LONG - A Module With A Very Long Name That Cannot Possibly Fit On A Node ${endless}`, "01: Main");
    make.item(module, `An Equally Long Line Item Name That Goes On And On ${endless}`);
    const model = indexModel(make.graph());
    for (const k of [0.27, 0.3, 0.41, 0.5, 0.75, 0.76, 0.8, 0.83, 1, 1.7, 3]) {
      for (const graph of [ready(modulesGraph(model, undefined, false)), ready(moduleGraph(model, module, false, false))]) {
        const { pen } = draw(sceneOf(graph, { camera: { ox: 0, oy: 0, k }, width: 4000, height: 4000 }));
        const [node] = graph.nodes;
        for (const call of pen.named("fillText")) {
          const [text, x, y] = call.args as [string, number, number];
          // The pen's characters are half their size wide.
          expect(x + [...text].length * sizeOf(call) / 2, `${text} at ${k}`).toBeLessThanOrEqual((node.x + node.w) * k - 3);
          expect(x, `${text} at ${k}`).toBeGreaterThanOrEqual(node.x * k + 6);
          // And no line stands outside the box's height.
          expect(y - sizeOf(call) * 0.8, `${text} at ${k}`).toBeGreaterThanOrEqual(node.y * k);
          expect(y + 2, `${text} at ${k}`).toBeLessThanOrEqual((node.y + node.h) * k);
        }
        // Whatever is written of these names is cut, and says so; a box too low for a line has none.
        if (node.h * k >= 13) expect(pen.texts().some(text => text.endsWith("…")), `${graph.kind} at ${k}`).toBe(true);
        else expect(pen.texts(), `${graph.kind} at ${k}`).toEqual([]);
      }
    }
  });

  it("writes every text of its first picture in the letters it has in every later one, though the first measures the words", () => {
    // A long section's name, so that the small line has to be measured letter by letter to be cut.
    const make = new GraphMaker();
    const outside = make.item(make.module("OUT01 - Outside", "09: A Section With A Name That Is Far Too Long For A Small Line"), "Value");
    const plan = make.module("PLN01 - Regional Revenue Planning by Product Family and Sales Channel", "01: Main");
    make.link(outside, make.item(plan, "Units Sold Before Returns and Allowances by Region and by Channel"));
    const model = indexModel(make.graph());
    for (const graph of [ready(modulesGraph(model, "01: Main", false)), ready(moduleGraph(model, plan, false, false))]) {
      for (const k of [0.3, 0.5, 0.8, 1, 1.6]) {
        const pen = new FakePen();
        const fonts = createFonts(pen as unknown as Pen, FALLBACK);
        const scene = sceneOf(graph, { camera: { ox: 0, oy: 0, k }, width: 6000, height: 4000 });
        drawScene(pen as unknown as Pen, scene, fonts);
        const first = pen.named("fillText").map(call => [call.args[0], call.font]);
        expect(pen.measured.length, `${graph.kind} at ${k}`).toBeGreaterThan(0);
        pen.clear();
        drawScene(pen as unknown as Pen, scene, fonts);
        expect(first, `${graph.kind} at ${k}`).toEqual(pen.named("fillText").map(call => [call.args[0], call.font]));
        // No text is ever written in the letters the words are measured in, unless that is its own size.
        for (const [text, font] of first) expect(String(font) === "500 10px monospace", String(text)).toBe(false);
      }
    }
  });

  it("measures a word once for every zoom, at a small size", () => {
    const { graph } = sample();
    const pen = new FakePen();
    const fonts = createFonts(pen as unknown as Pen, FALLBACK);
    // Drawn in full, a box's name is written as it was wrapped: only the small lines are measured, to be cut.
    drawScene(pen as unknown as Pen, sceneOf(graph), fonts);
    const first = pen.measured.length;
    expect(first).toBeGreaterThan(0);
    expect(new Set(pen.measured).size).toBe(first);
    drawScene(pen as unknown as Pen, sceneOf(graph, { camera: { ox: 5, oy: 5, k: 1.3 } }), fonts);
    drawScene(pen as unknown as Pen, sceneOf(graph, { camera: { ox: 0, oy: 0, k: 0.8 } }), fonts);
    expect(pen.measured.length).toBe(first);
    // Drawn small, the names are wrapped anew: their words are measured, once for every zoom that follows.
    drawScene(pen as unknown as Pen, sceneOf(graph, { camera: { ox: 0, oy: 0, k: 0.5 } }), fonts);
    const small = pen.measured.length;
    expect(small).toBeGreaterThan(first);
    drawScene(pen as unknown as Pen, sceneOf(graph, { camera: { ox: 9, oy: 9, k: 0.5 } }), fonts);
    drawScene(pen as unknown as Pen, sceneOf(graph, { camera: { ox: 0, oy: 0, k: 0.6 } }), fonts);
    expect(pen.measured.length).toBe(small);
    // Every measurement was taken at ten pixels, whatever size the text was then written at.
    expect(pen.calls.filter(call => call.name === "fillText").some(call => sizeOf(call) !== 10)).toBe(true);
    // A word comes out a touch wider than measured, never narrower.
    expect(lineWidth("Module", fonts.measure("label"))).toBeCloseTo(3 * 1.02, 5);
    expect([fonts.css("label", 12.5), fonts.css("item", 10), fonts.css("code", 9)]).toEqual(["600 12.5px sans-serif", "500 10px sans-serif", "500 9px monospace"]);
  });
});

describe("A trace in the map's picture", () => {
  it("draws what leads to the node in one colour and what leads on from it in another, each with its own dashes", () => {
    const { model, graph } = sample();
    const trace = traceNode(graph, model, place(graph, "BBB - Second Module"), false);
    const { pen, traced } = draw(sceneOf(graph, { trace }));
    expect(traced).toBe(true);
    // Long dashes lead to the node and short ones lead on from it: the two are told apart without their colours.
    expect(linkStrokes(pen).map(call => [call.strokeStyle, call.dash, call.globalAlpha])).toEqual([[FALLBACK.traceUp, [7, 5], 1], [FALLBACK.traceUp, [7, 5], 1], [FALLBACK.traceDown, [2, 4], 1]]);
    // The node selected has the selection's edge and a ring; the nodes of its trace have a ring of their side's colour.
    const rings = pen.named("stroke").filter(call => call.lineWidth === 1.4).map(call => call.strokeStyle);
    expect(rings).toEqual([FALLBACK.traceUp, FALLBACK.traceUp, FALLBACK.select, FALLBACK.traceDown]);
    expect(pen.named("stroke").filter(call => call.lineWidth === 1.8).map(call => call.strokeStyle)).toEqual([FALLBACK.select]);
    expect(pen.named("fill").filter(call => call.fillStyle === FALLBACK.nodeFillSelected)).toHaveLength(1);
  });

  it("marks each box of a trace with a sign that is no colour: at its right edge where it feeds the node, at its left where the node feeds it", () => {
    const { model, graph } = sample();
    const trace = traceNode(graph, model, place(graph, "BBB - Second Module"), false);
    const { pen } = draw(sceneOf(graph, { trace }));
    const sign = (node: ViewNode, feeds: boolean): number[][] => (feeds
      ? [[node.x + node.w + 2, middle(node) - 6], [node.x + node.w + 2 + 7.5, middle(node)], [node.x + node.w + 2, middle(node) + 6]]
      : [[node.x - 2 - 7.5, middle(node) - 6], [node.x - 2, middle(node)], [node.x - 2 - 7.5, middle(node) + 6]]);
    const [outside, first, third] = ["OUT - Outside", "AAA - First Module", "CCC - Third Module"].map(name => named(graph, name));
    // Two links lead to the node and two boxes feed it: two arrowheads and two signs in that side's colour.
    expect(triangles(pen, FALLBACK.traceUp)).toHaveLength(4);
    expect(triangles(pen, FALLBACK.traceUp)).toEqual(expect.arrayContaining([sign(outside, true), sign(first, true)]));
    expect(triangles(pen, FALLBACK.traceDown)).toHaveLength(2);
    expect(triangles(pen, FALLBACK.traceDown)).toContainEqual(sign(third, false));
    // The node selected has no sign: its edge and its ring say which it is.
    const selected = named(graph, "BBB - Second Module");
    expect([...triangles(pen, FALLBACK.traceUp), ...triangles(pen, FALLBACK.traceDown)]).not.toContainEqual(sign(selected, true));
  });

  it("gives a box that both feeds the node and is fed by it both signs and a second ring", () => {
    const { model, graph } = linked(3, [[0, 1], [1, 0], [1, 2]]);
    const both = named(graph, "M1");
    const { pen } = draw(sceneOf(graph, { trace: traceNode(graph, model, place(graph, "M0"), false) }));
    expect(triangles(pen, FALLBACK.traceUp)).toContainEqual([[both.x + both.w + 2, middle(both) - 6], [both.x + both.w + 2 + 7.5, middle(both)], [both.x + both.w + 2, middle(both) + 6]]);
    expect(triangles(pen, FALLBACK.traceDown)).toContainEqual([[both.x - 2 - 7.5, middle(both) - 6], [both.x - 2, middle(both)], [both.x - 2 - 7.5, middle(both) + 6]]);
    const rings = pen.named("stroke").filter(call => call.lineWidth === 1.4).map(call => [call.strokeStyle, (shapeBefore(pen, call)[0].args as number[])[0]]);
    expect(rings).toContainEqual([FALLBACK.traceUp, both.x - 2]);
    expect(rings).toContainEqual([FALLBACK.traceDown, both.x - 4.5]);
    // The box it only feeds has one ring and one sign.
    const fed = named(graph, "M2");
    expect(rings.filter(ring => ring[1] === fed.x - 2 || ring[1] === fed.x - 4.5)).toEqual([[FALLBACK.traceDown, fed.x - 2]]);
  });

  it("fades what the trace does not reach", () => {
    const { model, graph } = linked(3, [[0, 1]]);
    const { pen } = draw(sceneOf(graph, { trace: traceNode(graph, model, 0, false) }));
    const boxes = pen.named("fill").filter(call => call.fillStyle === FALLBACK.nodeFill || call.fillStyle === FALLBACK.nodeFillSelected);
    expect(boxes.map(call => call.globalAlpha)).toEqual([1, 1, 0.18]);
    expect(pen.named("fillText").filter(call => call.args[0] === "M2").map(call => call.globalAlpha)).toEqual([0.18]);
  });

  it("moves a trace's dashes along by the time given, and lets them stand where no time is given", () => {
    const { model, graph } = sample();
    const trace = traceNode(graph, model, place(graph, "BBB - Second Module"), false);
    // An eighth of a second at 24 pixels a second: three pixels along, towards the arrowhead.
    const moving = linkStrokes(draw(sceneOf(graph, { trace, time: 125 })).pen);
    expect(moving.map(call => [call.dash, call.dashOffset])).toEqual([[[7, 5], -3], [[7, 5], -3], [[2, 4], -3]]);
    const later = linkStrokes(draw(sceneOf(graph, { trace, time: 625 })).pen);
    expect(later.map(call => call.dashOffset)).toEqual([-3, -3, -3]);
    expect(linkStrokes(draw(sceneOf(graph, { trace, time: 250 })).pen).map(call => call.dashOffset)).toEqual([-6, -6, -0]);
    // Where nothing may move the dashes are the same dashes, standing still: they still say which way a link runs.
    const still = linkStrokes(draw(sceneOf(graph, { trace })).pen);
    expect(still.map(call => [call.dash, call.dashOffset])).toEqual([[[7, 5], 0], [[7, 5], 0], [[2, 4], 0]]);
  });

  it("says no trace is on screen when there is none, or when it is off the canvas", () => {
    const { model, graph } = sample();
    expect(draw(sceneOf(graph)).traced).toBe(false);
    const trace = traceNode(graph, model, place(graph, "BBB - Second Module"), false);
    expect(draw(sceneOf(graph, { trace, camera: { ox: -100000, oy: 0, k: 1 } })).traced).toBe(false);
    const hidden = new Uint8Array(graph.nodes.length);
    hidden[place(graph, "BBB - Second Module")] = 1;
    expect(draw(sceneOf(graph, { trace, shown: hidden })).traced).toBe(false);
  });

  it("rings the nodes the search names, and fades the others and the links between them", () => {
    const { graph } = sample();
    const matches = new Uint8Array(graph.nodes.length);
    matches[place(graph, "AAA - First Module")] = 1;
    const { pen } = draw(sceneOf(graph, { matches }));
    expect(pen.named("stroke").filter(call => call.strokeStyle === FALLBACK.match)).toHaveLength(1);
    const boxes = pen.named("fill").filter(call => call.fillStyle === FALLBACK.nodeFill);
    expect(boxes.map(call => call.globalAlpha)).toEqual([0.18, 1, 0.18, 0.18]);
    // A link with an end the search names keeps its strength; one between two others stands back.
    expect(linkStrokes(pen).map(call => call.globalAlpha)).toEqual([1, 1, 0.25]);
  });
});

describe("The small picture of the whole graph", () => {
  it("draws every node shown as a patch of its colour, and a frame around the part the camera shows", () => {
    const { model, graph } = sample();
    const pen = new FakePen();
    const scene = sceneOf(graph, { trace: traceNode(graph, model, 1, false), camera: { ox: -100, oy: -20, k: 2 }, width: 800, height: 40 });
    const transform = drawMinimap(pen as unknown as Pen, scene, 196, 128)!;
    expect(pen.calls[0]).toMatchObject({ name: "clearRect", args: [0, 0, 196, 128] });
    const patches = pen.named("fillRect");
    expect(patches.map(call => call.fillStyle)).toEqual([FALLBACK.external, FALLBACK.sections[1], FALLBACK.sections[1], FALLBACK.sections[1]]);
    expect(patches[0].args.slice(0, 2)).toEqual([transform.ox + graph.nodes[0].x * transform.s, transform.oy + graph.nodes[0].y * transform.s]);
    // The node selected is drawn in full strength.
    expect(patches.map(call => call.globalAlpha)).toEqual([0.7, 1, 0.7, 0.7]);
    // The camera shows the graph from 50 to 450 across and from 10 to 30 down.
    const frame = pen.named("strokeRect")[0];
    expect(frame.strokeStyle).toBe(FALLBACK.select);
    const expected = [transform.ox + 50 * transform.s, transform.oy + 10 * transform.s, 400 * transform.s, 20 * transform.s];
    (frame.args as number[]).forEach((value, index) => expect(value).toBeCloseTo(expected[index], 8));
  });

  it("draws no frame while the whole graph is in view, and keeps a frame inside the small picture's own edge", () => {
    const { graph } = sample();
    const whole = new FakePen();
    drawMinimap(whole as unknown as Pen, sceneOf(graph), 196, 128);
    expect(whole.named("strokeRect")).toEqual([]);
    // A camera that looks past the graph's right end: the frame stops a pixel inside the picture.
    const pen = new FakePen();
    drawMinimap(pen as unknown as Pen, sceneOf(graph, { camera: { ox: -600, oy: 400, k: 1 }, width: 5000, height: 5000 }), 196, 128);
    const [left, top, wide, high] = pen.named("strokeRect")[0].args as number[];
    expect([top, left + wide, top + high]).toEqual([1, 195, 127]);
    expect(left).toBeGreaterThan(1);
  });

  it("leaves out what is not shown, and draws nothing for an empty graph", () => {
    const { graph } = sample();
    const shown = new Uint8Array(graph.nodes.length);
    shown[2] = 1;
    const pen = new FakePen();
    drawMinimap(pen as unknown as Pen, sceneOf(graph, { shown }), 196, 128);
    expect(pen.named("fillRect")).toHaveLength(1);
    const empty = ready(modulesGraph(indexModel(new GraphMaker().graph()), undefined, false));
    const blank = new FakePen();
    expect(drawMinimap(blank as unknown as Pen, sceneOf(empty), 196, 128)).toBeUndefined();
    expect(blank.calls.map(call => call.name)).toEqual(["clearRect"]);
  });
});
