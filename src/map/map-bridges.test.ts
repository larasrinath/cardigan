import { describe, expect, it } from "vitest";
import { bridgesOver, bridgeWay, mayBridge } from "./map-bridges.js";
import { GraphMaker } from "./map-fakes.test-support.js";
import { LAYER, moduleGraph, sourcesGraph, type ViewGraph } from "./map-graphs.js";
import { indexModel } from "./map-model.js";
import { traceSources } from "./map-sources.js";
import { traceNode } from "./map-trace.js";

// Made-up names only: nothing here comes from a real model. No line item is named for what it is to the trace.

/** Total, in REP01 Board, reads Net; Net, in CAL01 Workings, reads Gross and Cost of CST01 Costs; Gross reads Units of
 * VOL01 Volumes and Price of PRC01 Prices. Three inputs in three modules feed the result through two calculations. */
function fedModel() {
  const make = new GraphMaker();
  const volumes = make.module("VOL01 Volumes", "Data");
  const prices = make.module("PRC01 Prices", "Data");
  const costs = make.module("CST01 Costs", "Data");
  const workings = make.module("CAL01 Workings", "Calculations");
  const board = make.module("REP01 Board", "Reporting");
  const units = make.item(volumes, "Units");
  const price = make.item(prices, "Price");
  const cost = make.item(costs, "Cost");
  const gross = make.item(workings, "Gross", { formula: "'VOL01 Volumes'.Units * 'PRC01 Prices'.Price" });
  const net = make.item(workings, "Net", { formula: "Gross - 'CST01 Costs'.Cost" });
  const total = make.item(board, "Total", { formula: "'CAL01 Workings'.Net" });
  make.link(units, gross).link(price, gross).link(gross, net).link(cost, net).link(net, total);
  return { make, workings, units, price, cost, gross, net, total };
}

/** A line item's source inputs as the map draws them (map-graphs.ts `sourcesGraph`), with the model they are of. */
function sourcesOf(make: GraphMaker, result: number) {
  const model = indexModel(make.graph());
  return { model, graph: sourcesGraph(model, traceSources(model, result)!) };
}

/** A graph's faint lines while the layers named are hidden, by their boxes' names. */
const faintOf = (graph: ViewGraph, hidden: readonly string[], formulas = true): string[] =>
  bridgesOver(graph, new Set(hidden), formulas).map(({ s, t }) => `${graph.nodes[s].label} > ${graph.nodes[t].label}`);
const place = (graph: ViewGraph, name: string): number => graph.nodes.findIndex(node => node.label === name);

describe("Faint lines among a line item's source inputs", () => {
  it("give each of three inputs that feed the result through two hidden calculations one faint line to the result", () => {
    const { make, total } = fedModel();
    const { graph } = sourcesOf(make, total);
    expect(graph.layers.map(layer => [layer.key, layer.count])).toEqual([[LAYER.input, 3], [LAYER.calculation, 2], [LAYER.result, 1]]);
    // In the order of their first boxes: the inputs by their steps, then their modules' names.
    expect(faintOf(graph, [LAYER.calculation])).toEqual(["Cost > Total", "Price > Total", "Units > Total"]);
  });

  it("draw none from an input that also feeds the result directly: its link is drawn already", () => {
    const { make, cost, total } = fedModel();
    make.nodes[total].formula = "'CAL01 Workings'.Net + 'CST01 Costs'.Cost";
    make.link(cost, total);
    const { graph } = sourcesOf(make, total);
    expect(graph.edges.some(edge => edge.s === place(graph, "Cost") && edge.t === place(graph, "Total"))).toBe(true);
    expect(faintOf(graph, [LAYER.calculation])).toEqual(["Price > Total", "Units > Total"]);
  });

  it("draw none while nothing is hidden", () => {
    const { make, total } = fedModel();
    expect(faintOf(sourcesOf(make, total).graph, [])).toEqual([]);
  });

  it("draw none with the Inputs hidden, or the Result, whatever else is: nothing leads into an input, nor away from the result", () => {
    const { make, total } = fedModel();
    const { graph } = sourcesOf(make, total);
    for (const hidden of [[LAYER.input], [LAYER.result], [LAYER.input, LAYER.calculation], [LAYER.result, LAYER.calculation], [LAYER.input, LAYER.result],
      [LAYER.input, LAYER.calculation, LAYER.result]]) expect(faintOf(graph, hidden), hidden.join(" and ")).toEqual([]);
  });

  it("end a circle among the calculations hidden", () => {
    const make = new GraphMaker();
    const plan = make.module("PLN01 Plan", "Data");
    const board = make.module("REP01 Board", "Reporting");
    const units = make.item(plan, "Units");
    const running = make.item(plan, "Running", { formula: "Units + PREVIOUS(Carried)" });
    const carried = make.item(plan, "Carried", { formula: "Running * 2 + PREVIOUS(Carried)" });
    const total = make.item(board, "Total", { formula: "'PLN01 Plan'.Carried" });
    // Running and Carried read each other, and Carried reads itself.
    make.link(units, running).link(carried, running).link(running, carried).link(carried, carried).link(carried, total);
    const { graph } = sourcesOf(make, total);
    const feeds = (name: string): string[] => graph.out[place(graph, name)].map(index => graph.nodes[index].label).sort();
    expect([feeds("Running"), feeds("Carried")]).toEqual([["Carried"], ["Running", "Total"]]);
    expect(faintOf(graph, [LAYER.calculation])).toEqual(["Units > Total"]);
  });

  it("are only among a line item's source inputs, and only along the links drawn", () => {
    const { make, workings, total } = fedModel();
    const { model, graph } = sourcesOf(make, total);
    // Where formulas' links are left undrawn, there is no link to follow.
    expect(faintOf(graph, [LAYER.calculation], false)).toEqual([]);
    // A module's line items, with their own layer hidden, have none.
    const drill = moduleGraph(model, workings, false, false);
    expect([drill.kind, faintOf(drill, [LAYER.lineItem, LAYER.external])]).toEqual(["drill", []]);
  });

  it("follow the same rule over an input that a Ratio summary feeds, and never lead from a box back to itself", () => {
    const make = new GraphMaker();
    const plan = make.module("PLN01 Plan", "Data");
    const board = make.module("REP01 Board", "Reporting");
    const price = make.item(plan, "Price");
    make.item(plan, "Volume");
    const margin = make.item(plan, "Margin", { formula: "Price * Rate" });
    // No formula: an input, whose totals are its Ratio's two line items. Margin reads it, and it is fed by Margin.
    const rate = make.item(plan, "Rate", { summary: "RATIO", ratioNumerator: "Margin", ratioDenominator: "Volume" });
    const total = make.item(board, "Total", { formula: "'PLN01 Plan'.Rate * 2" });
    make.link(price, margin).link(rate, margin).link(rate, total);
    const { graph } = sourcesOf(make, total);
    expect(graph.nodes.map(node => [node.label, node.layer])).toEqual([["Rate", LAYER.input], ["Volume", LAYER.input], ["Price", LAYER.input], ["Margin", LAYER.calculation],
      ["Total", LAYER.result]]);
    // Links lead into Rate, so hiding the Inputs bridges over it, as over any hidden box.
    expect(faintOf(graph, [LAYER.input])).toEqual(["Margin > Total"]);
    // Rate's way through Margin comes back to Rate itself, which draws nothing; Price is given one over Margin to Rate.
    expect(faintOf(graph, [LAYER.calculation])).toEqual(["Price > Rate"]);
  });

  it("are worked out once for the layers hidden: asked again, they are the same, and for other layers worked out again", () => {
    const { make, total } = fedModel();
    const { graph } = sourcesOf(make, total);
    const first = bridgesOver(graph, new Set([LAYER.calculation]));
    expect(bridgesOver(graph, new Set([LAYER.calculation]))).toBe(first);
    expect(bridgesOver(graph, new Set([LAYER.calculation]), false)).toEqual([]);
    expect(bridgesOver(graph, new Set([LAYER.input]))).toEqual([]);
    expect(bridgesOver(graph, new Set([LAYER.calculation]))).toEqual(first);
  });
});

describe("The legend's line about faint lines", () => {
  it("is there where a box stands between two others, with the links drawn, among a line item's source inputs only", () => {
    const { make, workings, gross, total } = fedModel();
    const { model, graph } = sourcesOf(make, total);
    expect([mayBridge(graph), mayBridge(graph, false)]).toEqual([true, false]);
    // Gross is fed by its two inputs directly: nothing stands between them, and no faint line can be drawn.
    const direct = sourcesOf(make, gross).graph;
    expect([direct.layers.map(layer => layer.key), mayBridge(direct)]).toEqual([[LAYER.input, LAYER.result], false]);
    expect(mayBridge(moduleGraph(model, workings, false, false))).toBe(false);
  });
});

describe("A faint line on the trace of a box selected", () => {
  it("leads away from an input selected to the result, towards the result selected, and is off the trace of another input", () => {
    const { make, total } = fedModel();
    const { model, graph } = sourcesOf(make, total);
    const bridges = bridgesOver(graph, new Set([LAYER.calculation]));
    const ways = (name: string): number[] => bridges.map(bridge => bridgeWay(traceNode(graph, model, place(graph, name), false), bridge));
    // Cost > Total, Price > Total and Units > Total.
    expect(ways("Units")).toEqual([0, 0, 2]);
    expect(ways("Cost")).toEqual([2, 0, 0]);
    expect(ways("Total")).toEqual([1, 1, 1]);
    // A calculation selected, hidden as it is, stands in the middle of every way: a line from what feeds it to what it
    // feeds leads neither towards it nor away from it, as a link would not.
    expect(ways("Net")).toEqual([0, 0, 0]);
  });
});
