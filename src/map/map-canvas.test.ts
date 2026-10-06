import { describe, expect, it } from "vitest";
import type { Camera } from "./map-camera.js";
import { createFonts, drawMinimap, drawScene, type Pen, type Scene } from "./map-canvas.js";
import { moduleGraph, modulesGraph, type ViewGraph } from "./map-graphs.js";
import { layoutGraph } from "./map-layout.js";
import { indexModel } from "./map-model.js";
import { FALLBACK } from "./map-palette.js";
import { lineWidth } from "./map-text.js";
import { traceNode } from "./map-trace.js";
import { FakePen, GraphMaker, HOSTILE } from "./map-fakes.test-support.js";

const PLAIN: Camera = { ox: 0, oy: 0, k: 1 };

/** Three modules in a row, A -> B -> C, and one of another section that feeds A. */
function sample() {
  const make = new GraphMaker();
  const outside = make.item(make.module("OUT - Outside", "00: Other"), "Value");
  const [a, b, c] = ["AAA - First Module", "BBB - Second Module", "CCC - Third Module"].map(name => make.item(make.module(name, "01: Main"), "Value"));
  make.link(outside, a).link(a, b).link(b, c);
  const model = indexModel(make.graph());
  const graph = modulesGraph(model, "01: Main", false);
  layoutGraph(graph);
  return { model, graph };
}

function sceneOf(graph: ViewGraph, extra: Partial<Scene> = {}): Scene {
  return { graph, camera: PLAIN, width: 2000, height: 1000, palette: FALLBACK, shown: new Uint8Array(graph.nodes.length).fill(1), ...extra };
}

function draw(scene: Scene): { pen: FakePen; traced: boolean } {
  const pen = new FakePen();
  const traced = drawScene(pen as unknown as Pen, scene, createFonts(pen as unknown as Pen, scene.palette));
  return { pen, traced };
}

const place = (graph: ViewGraph, name: string): number => graph.nodes.findIndex(node => node.fullName === name);

describe("The map's picture", () => {
  it("fills the whole canvas with the canvas's colour before anything else", () => {
    const { graph } = sample();
    const { pen } = draw(sceneOf(graph));
    const first = pen.calls.find(call => call.name === "fillRect")!;
    expect([first.args, first.fillStyle, first.globalAlpha]).toEqual([[0, 0, 2000, 1000], FALLBACK.canvas, 1]);
    expect(pen.calls.indexOf(first)).toBeLessThan(pen.calls.findIndex(call => call.name === "roundRect"));
  });

  it("draws each node as a box with its code, its name and what it holds", () => {
    const { graph } = sample();
    const { pen } = draw(sceneOf(graph));
    expect(pen.named("roundRect").map(call => call.args.slice(0, 4))).toEqual(graph.nodes.map(node => [node.x, node.y, node.w, node.h]));
    expect(pen.texts()).toEqual(["OUT", "Outside", "1 line item", "AAA", "First Module", "1 line item", "BBB", "Second Module", "1 line item", "CCC", "Third Module", "1 line item"]);
    // A node's name is in the node's text colour, its small lines in the quieter one; outside the section both are quiet.
    const colours = new Map(pen.named("fillText").map(call => [String(call.args[0]), call.fillStyle]));
    expect([colours.get("First Module"), colours.get("AAA"), colours.get("1 line item"), colours.get("Outside")]).toEqual([FALLBACK.nodeText, FALLBACK.nodeTextMuted, FALLBACK.nodeTextMuted, FALLBACK.nodeTextMuted]);
  });

  it("writes a name on the canvas as the text it is, whatever it holds", () => {
    const make = new GraphMaker();
    HOSTILE.forEach(name => make.item(make.module(name, "01: Main"), name));
    const graph = modulesGraph(indexModel(make.graph()), undefined, false);
    layoutGraph(graph);
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

  it("draws a link from the right of what is read to the left of what reads it, heavier the more links it counts", () => {
    const make = new GraphMaker();
    const [first, second] = ["First", "Second"].map(name => make.module(name, "01: Main"));
    const sources = [0, 1, 2].map(index => make.item(first, `Source ${index}`));
    const target = make.item(second, "Target");
    for (const source of sources) make.link(source, target);
    const single = make.item(make.module("Third", "01: Main"), "Single");
    make.link(target, single);
    const graph = modulesGraph(indexModel(make.graph()), undefined, false);
    layoutGraph(graph);
    const { pen } = draw(sceneOf(graph));
    const [from, to] = [graph.nodes[0], graph.nodes[1]];
    const start = pen.named("moveTo").find(call => call.args[0] === from.x + from.w && call.args[1] === from.y + from.h / 2);
    expect(start).toBeDefined();
    expect(pen.named("bezierCurveTo").some(call => call.args[4] === to.x && call.args[5] === to.y + to.h / 2)).toBe(true);
    const widths = pen.named("stroke").filter(call => call.strokeStyle === FALLBACK.edge).map(call => call.lineWidth);
    expect(widths).toHaveLength(2);
    expect(widths[0]).toBeGreaterThan(widths[1]);
  });

  it("draws each link fainter where there are many hundreds of them, so that they do not make one dark patch", () => {
    const linked = (count: number): ViewGraph => {
      const make = new GraphMaker();
      const items = Array.from({ length: count }, (_, index) => make.item(make.module(`M${index}`, "01: Main"), "Value"));
      for (let from = 0; from < count; from++) for (let to = from + 1; to < count; to++) make.link(items[from], items[to]);
      const graph = modulesGraph(indexModel(make.graph()), undefined, false);
      layoutGraph(graph);
      return graph;
    };
    const strength = (graph: ViewGraph): number => draw(sceneOf(graph, { width: 100000, height: 100000 })).pen.named("stroke").find(call => call.strokeStyle === FALLBACK.edge)!.globalAlpha;
    // 45 links, 780 links, and 4,950 links: full strength, less, and never less than about a third.
    expect(strength(linked(10))).toBeCloseTo(0.3, 5);
    expect(strength(linked(40))).toBeCloseTo(0.3 * 600 / 780, 5);
    expect(strength(linked(100))).toBeCloseTo(0.3 * 0.35, 5);
    // A trace of many links is thinned the same way, from 250 on.
    const many = linked(40);
    const trace = traceNode(many, indexModel(new GraphMaker().graph()), 0, false);
    const traced = draw(sceneOf(many, { trace, width: 100000, height: 100000 })).pen.named("stroke").filter(call => call.strokeStyle === FALLBACK.traceDown && call.lineWidth !== 1.4);
    expect(traced).toHaveLength(780);
    expect(traced[0].globalAlpha).toBeCloseTo(0.85 * 0.35, 5);
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
    expect(forward.named("roundRect").map(call => call.args.slice(0, 2))).toEqual([1, 2, 3, 0].map(place => [graph.nodes[place].x, graph.nodes[place].y]));
    expect(forward.texts().slice(-3)).toEqual(["OUT", "Outside", "1 line item"]);
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

describe("The map's picture from far away and from near", () => {
  it("writes no text below a quarter of full size, and draws a node as a patch of its colour below a tenth", () => {
    const { graph } = sample();
    const far = draw(sceneOf(graph, { camera: { ox: 0, oy: 0, k: 0.2 } })).pen;
    expect(far.texts()).toEqual([]);
    expect(far.named("roundRect")).toHaveLength(4);
    const patches = draw(sceneOf(graph, { camera: { ox: 0, oy: 0, k: 0.05 } })).pen;
    expect(patches.named("roundRect")).toEqual([]);
    expect(patches.named("fillRect").slice(1).map(call => call.fillStyle)).toEqual([FALLBACK.external, FALLBACK.sections[1], FALLBACK.sections[1], FALLBACK.sections[1]]);
    // A patch never gets thinner than two pixels, however far away.
    for (const call of patches.named("fillRect").slice(1)) expect(Math.min(call.args[2] as number, call.args[3] as number)).toBeGreaterThanOrEqual(2);
  });

  it("writes the whole name on one line where a node is too low for two", () => {
    const { graph } = sample();
    const { pen } = draw(sceneOf(graph, { camera: { ox: 0, oy: 0, k: 0.4 } }));
    expect(pen.texts()).toHaveLength(4);
    expect(pen.texts()[1]).toMatch(/^AAA - /);
  });

  it("cuts a name to the room its node has, and never writes a line wider than that", () => {
    const make = new GraphMaker();
    const module = make.module("LONG - A Module With A Very Long Name That Cannot Possibly Fit On A Node However Hard It Tries", "01: Main");
    make.item(module, "An Equally Long Line Item Name That Goes On And On Until It Is Cut Short Somewhere");
    const model = indexModel(make.graph());
    for (const k of [0.3, 0.5, 0.8, 1, 1.7, 3]) {
      for (const graph of [modulesGraph(model, undefined, false), moduleGraph(model, module, false, false)]) {
        layoutGraph(graph);
        const pen = new FakePen();
        const fonts = createFonts(pen as unknown as Pen, FALLBACK);
        drawScene(pen as unknown as Pen, sceneOf(graph, { camera: { ox: 0, oy: 0, k }, width: 4000, height: 4000 }), fonts);
        const node = graph.nodes[0];
        const room = node.w * k - Math.max(9, 14 * k) - 8;
        for (const call of pen.named("fillText")) {
          const size = parseFloat(/([\d.]+)px/.exec(call.font)![1]);
          // The pen's characters are half their size wide.
          expect([...String(call.args[0])].length * size / 2, `${call.args[0]} at ${k}`).toBeLessThanOrEqual(room + 0.001);
          expect(call.args[1]).toBe(node.x * k + Math.max(9, 14 * k));
        }
        // A line item too low for its text has none; whatever is written of these names is cut, and says so.
        if (graph.kind === "modules" || node.h * k >= 14) expect(pen.texts().some(text => text.endsWith("…")), `${graph.kind} at ${k}`).toBe(true);
        else expect(pen.texts()).toEqual([]);
      }
    }
  });

  it("measures a word once for every zoom, at a small size", () => {
    const { graph } = sample();
    const pen = new FakePen();
    const fonts = createFonts(pen as unknown as Pen, FALLBACK);
    drawScene(pen as unknown as Pen, sceneOf(graph), fonts);
    const first = pen.measured.length;
    expect(first).toBeGreaterThan(0);
    expect(new Set(pen.measured).size).toBeGreaterThanOrEqual(first - 3);
    drawScene(pen as unknown as Pen, sceneOf(graph, { camera: { ox: 5, oy: 5, k: 1.3 } }), fonts);
    drawScene(pen as unknown as Pen, sceneOf(graph, { camera: { ox: 0, oy: 0, k: 0.6 } }), fonts);
    expect(pen.measured.length).toBe(first);
    // A word comes out a touch wider than measured, never narrower.
    expect(lineWidth("Module", fonts.measure("label"))).toBeCloseTo(3 * 1.02, 5);
    expect([fonts.css("label", 12.5), fonts.css("item", 10), fonts.css("code", 9), fonts.css("meta", 9)]).toEqual(["600 12.5px sans-serif", "500 10px sans-serif", "500 9px monospace", "400 9px monospace"]);
  });
});

describe("A trace in the map's picture", () => {
  it("draws what leads to the node in one colour and what leads on from it in another, and fades the rest", () => {
    const { model, graph } = sample();
    const trace = traceNode(graph, model, place(graph, "BBB - Second Module"), false);
    const { pen, traced } = draw(sceneOf(graph, { trace }));
    expect(traced).toBe(true);
    const links = pen.named("stroke").filter(call => [FALLBACK.traceUp, FALLBACK.traceDown, FALLBACK.edge].includes(call.strokeStyle) && call.lineWidth < 1.4);
    expect(links.map(call => call.strokeStyle)).toEqual([FALLBACK.traceUp, FALLBACK.traceUp, FALLBACK.traceDown]);
    // The node selected has the selection's edge and a ring; the nodes of its trace have a ring of their side's colour.
    const rings = pen.named("stroke").filter(call => call.lineWidth === 1.4).map(call => call.strokeStyle);
    expect(rings).toEqual([FALLBACK.traceUp, FALLBACK.traceUp, FALLBACK.select, FALLBACK.traceDown]);
    expect(pen.named("stroke").filter(call => call.lineWidth === 1.8).map(call => call.strokeStyle)).toEqual([FALLBACK.select]);
    expect(pen.named("fill").filter(call => call.fillStyle === FALLBACK.nodeFillSelected)).toHaveLength(1);
  });

  it("fades what the trace does not reach", () => {
    const make = new GraphMaker();
    const [a, b, alone] = ["A", "B", "Alone"].map(name => make.item(make.module(name, "01: Main"), "Value"));
    make.link(a, b);
    void alone;
    const model = indexModel(make.graph());
    const graph = modulesGraph(model, undefined, false);
    layoutGraph(graph);
    const { pen } = draw(sceneOf(graph, { trace: traceNode(graph, model, 0, false) }));
    const boxes = pen.named("fill").filter(call => call.fillStyle === FALLBACK.nodeFill || call.fillStyle === FALLBACK.nodeFillSelected);
    expect(boxes.map(call => call.globalAlpha)).toEqual([1, 1, 0.18]);
    expect(pen.named("fillText").filter(call => call.args[0] === "Alone").map(call => call.globalAlpha)).toEqual([0.18]);
  });

  it("moves a trace's dashes by the time given, and draws a solid line where nothing may move", () => {
    const { model, graph } = sample();
    const trace = traceNode(graph, model, place(graph, "BBB - Second Module"), false);
    const moving = draw(sceneOf(graph, { trace, time: 1000 })).pen;
    const dashed = moving.named("stroke").filter(call => call.dash.length === 2 && call.dash[0] === 7);
    expect(dashed).toHaveLength(3);
    expect(moving.lineDashOffset).toBe(-(25 % 13));
    const still = draw(sceneOf(graph, { trace })).pen;
    expect(still.named("stroke").filter(call => call.dash.length === 2 && call.dash[0] === 7)).toEqual([]);
    expect(still.named("setLineDash").filter(call => (call.args[0] as number[])[0] === 7)).toEqual([]);
  });

  it("says no trace is on screen when there is none, or when it is off the canvas", () => {
    const { model, graph } = sample();
    expect(draw(sceneOf(graph)).traced).toBe(false);
    const trace = traceNode(graph, model, place(graph, "BBB - Second Module"), false);
    expect(draw(sceneOf(graph, { trace, camera: { ox: -100000, oy: 0, k: 1 } })).traced).toBe(false);
    const lone = traceNode(graph, model, place(graph, "BBB - Second Module"), false);
    const hidden = new Uint8Array(graph.nodes.length);
    hidden[place(graph, "BBB - Second Module")] = 1;
    expect(draw(sceneOf(graph, { trace: lone, shown: hidden })).traced).toBe(false);
  });

  it("rings the nodes the search names, and fades the others and the links between them", () => {
    const { graph } = sample();
    const matches = new Uint8Array(graph.nodes.length);
    matches[place(graph, "AAA - First Module")] = 1;
    const { pen } = draw(sceneOf(graph, { matches }));
    expect(pen.named("stroke").filter(call => call.strokeStyle === FALLBACK.match)).toHaveLength(1);
    const boxes = pen.named("fill").filter(call => call.fillStyle === FALLBACK.nodeFill);
    expect(boxes.map(call => call.globalAlpha)).toEqual([0.18, 1, 0.18, 0.18]);
    const links = pen.named("stroke").filter(call => call.strokeStyle === FALLBACK.edge).map(call => call.globalAlpha);
    expect(links[0]).toBeGreaterThan(links[2]);
    expect(links[2]).toBeCloseTo(links[0] / 4, 5);
  });
});

describe("The small picture of the whole graph", () => {
  it("draws every node shown as a patch of its colour, and a frame around what the camera shows", () => {
    const { model, graph } = sample();
    const pen = new FakePen();
    const scene = sceneOf(graph, { trace: traceNode(graph, model, 1, false), camera: { ox: -100, oy: -20, k: 2 }, width: 800, height: 400 });
    const transform = drawMinimap(pen as unknown as Pen, scene, 196, 128)!;
    expect(pen.calls[0]).toMatchObject({ name: "clearRect", args: [0, 0, 196, 128] });
    const patches = pen.named("fillRect");
    expect(patches.map(call => call.fillStyle)).toEqual([FALLBACK.external, FALLBACK.sections[1], FALLBACK.sections[1], FALLBACK.sections[1]]);
    expect(patches[0].args.slice(0, 2)).toEqual([transform.ox + graph.nodes[0].x * transform.s, transform.oy + graph.nodes[0].y * transform.s]);
    // The node selected is drawn in full strength.
    expect(patches.map(call => call.globalAlpha)).toEqual([0.7, 1, 0.7, 0.7]);
    const frame = pen.named("strokeRect")[0];
    expect(frame.strokeStyle).toBe(FALLBACK.select);
    expect(frame.args).toEqual([transform.ox + 50 * transform.s, transform.oy + 10 * transform.s, 400 * transform.s, 200 * transform.s]);
  });

  it("leaves out what is not shown, and draws nothing for an empty graph", () => {
    const { graph } = sample();
    const shown = new Uint8Array(graph.nodes.length);
    shown[2] = 1;
    const pen = new FakePen();
    drawMinimap(pen as unknown as Pen, sceneOf(graph, { shown }), 196, 128);
    expect(pen.named("fillRect")).toHaveLength(1);
    const empty = modulesGraph(indexModel(new GraphMaker().graph()), undefined, false);
    layoutGraph(empty);
    const blank = new FakePen();
    expect(drawMinimap(blank as unknown as Pen, sceneOf(empty), 196, 128)).toBeUndefined();
    expect(blank.calls.map(call => call.name)).toEqual(["clearRect"]);
  });
});
