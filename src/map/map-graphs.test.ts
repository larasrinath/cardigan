import { describe, expect, it } from "vitest";
import { LAYER, moduleGraph, modulesGraph, sectionLayer, sectionsGraph, type ViewGraph } from "./map-graphs.js";
import { indexModel } from "./map-model.js";
import { GraphMaker } from "./map-fakes.test-support.js";

/** Three sections. Inputs feed Calculations, Calculations feed Reporting and read each other, and a flag of the inputs
 * drives who may write a calculation. */
function sample() {
  const make = new GraphMaker();
  const volumes = make.module("INP01 - Volumes", "01: Inputs");
  const prices = make.module("INP02 - Prices", "01: Inputs");
  const revenue = make.module("CAL01 - Revenue", "02: Calculations");
  const margin = make.module("Margin Workings", "02: Calculations");
  const board = make.module("REP01 - Board", "Reporting");
  const units = make.item(volumes, "Units");
  const canEdit = make.item(volumes, "Can Edit", { format: "BOOLEAN" });
  const price = make.item(prices, "Price");
  const heading = make.item(revenue, "Workings", { format: "NONE" });
  const gross = make.item(revenue, "Gross", { formula: "Units * Price" });
  const net = make.item(revenue, "Net", { formula: "Gross - Margin Workings.Cost" });
  const cost = make.item(margin, "Cost");
  const marginPct = make.item(margin, "Margin %", { formula: "1 - Cost / CAL01 - Revenue.Gross" });
  const total = make.item(board, "Total", { formula: "CAL01 - Revenue.Net" });
  const running = make.item(board, "Running Total", { formula: "Total + PREVIOUS(Running Total)" });
  const products = make.list("Products", { count: 40 });
  const active = make.subset(products, "Active Products");
  const code = make.property(products, "Code");
  make.link(units, gross).link(price, gross).link(gross, net).link(cost, net).link(cost, marginPct).link(gross, marginPct).link(net, total).link(total, running).link(running, running)
    .link(active, gross, "list_formula").link(code, net).link(canEdit, net, "write_access").link(canEdit, gross, "read_access");
  return { model: indexModel(make.graph()), volumes, prices, revenue, margin, board, units, canEdit, price, heading, gross, net, cost, marginPct, total, running, products, active, code };
}

const links = (graph: ViewGraph): string[] => graph.edges.map(edge => `${graph.nodes[edge.s].id}>${graph.nodes[edge.t].id}:${edge.w}`).sort();
const ids = (graph: ViewGraph): string[] => graph.nodes.map(node => node.id);

describe("The graph of a model's sections", () => {
  it("has a node for each section, in the model's order, that says how much the section holds", () => {
    const { model, volumes, prices } = sample();
    const graph = sectionsGraph(model, false);
    expect(graph.kind).toBe("sections");
    // A section's name is its whole heading: a number before it is no code of its own.
    expect(graph.nodes.map(node => [node.id, node.kind, node.code, node.label, node.fullName, node.meta])).toEqual([
      ["section0", "section", "", "01: Inputs", "01: Inputs", "2 modules \u00b7 3 line items"],
      ["section1", "section", "", "02: Calculations", "02: Calculations", "2 modules \u00b7 5 line items"],
      ["section2", "section", "", "Reporting", "Reporting", "1 module \u00b7 2 line items"],
    ]);
    expect(graph.nodes[0].members).toEqual([volumes, prices]);
    expect(graph.nodes.map(node => [node.section, node.layer, node.external])).toEqual([[0, "s0", false], [1, "s1", false], [2, "s2", false]]);
    expect(graph.local).toBe(3);
  });
  it("counts together the links between two sections, and drops those inside one", () => {
    const { model } = sample();
    // Units and Price feed Gross: two links from Inputs to Calculations. Net feeds Total: one on to Reporting.
    expect(links(sectionsGraph(model, false))).toEqual(["section0>section1:2", "section1>section2:1"]);
    // With the access links: the flag drives two calculations.
    expect(links(sectionsGraph(model, true))).toEqual(["section0>section1:4", "section1>section2:1"]);
  });

  it("names each layer after its section, and counts the section's modules", () => {
    const { model } = sample();
    expect(sectionsGraph(model, false).layers).toEqual([{ key: "s0", label: "01: Inputs", count: 2 }, { key: "s1", label: "02: Calculations", count: 2 }, { key: "s2", label: "Reporting", count: 1 }]);
  });
  it("holds the lists its nodes read and feed, by their places", () => {
    const { model } = sample();
    const graph = sectionsGraph(model, false);
    expect(graph.out).toEqual([[1], [2], []]);
    expect(graph.in).toEqual([[], [0], [1]]);
    expect(graph.byId.get("section1")).toBe(graph.nodes[1]);
  });
});

describe("The graph of a section's modules", () => {
  it("shows the section's modules, and beside them the modules of other sections they read or feed", () => {
    const { model, volumes, prices, revenue, margin, board } = sample();
    const graph = modulesGraph(model, "02: Calculations", false);
    expect([graph.name, graph.local]).toEqual(["02: Calculations", 2]);
    // In the model's order, whichever section a module is of.
    expect(ids(graph)).toEqual([volumes, prices, revenue, margin, board].map(String));
    expect(graph.nodes.map(node => [node.code, node.label, node.external, node.layer])).toEqual([
      ["INP01", "Volumes", true, LAYER.external], ["INP02", "Prices", true, LAYER.external],
      ["CAL01", "Revenue", false, sectionLayer(1)], ["", "Margin Workings", false, sectionLayer(1)], ["REP01", "Board", true, LAYER.external],
    ]);
    // The section's own modules say how much they hold; a module of another section says which section it is of.
    expect(graph.nodes.map(node => node.meta)).toEqual(["01: Inputs", "01: Inputs", "3 line items", "2 line items", "Reporting"]);
    expect(graph.layers).toEqual([{ key: LAYER.external, label: "Modules of other sections", count: 3 }, { key: "s1", label: "02: Calculations", count: 2 }]);
  });
  it("counts the links between two modules together, each way apart, and drops a module's links to itself", () => {
    const { model, volumes, prices, revenue, margin, board } = sample();
    expect(links(modulesGraph(model, "02: Calculations", false))).toEqual([
      `${margin}>${revenue}:1`, `${prices}>${revenue}:1`, `${revenue}>${board}:1`, `${revenue}>${margin}:1`, `${volumes}>${revenue}:1`,
    ].sort());
    // Who may read and write counts when asked for: the flag of Volumes drives two line items of Revenue.
    expect(links(modulesGraph(model, "02: Calculations", true))).toContain(`${volumes}>${revenue}:3`);
  });

  it("leaves out a module of another section that has no link with the section", () => {
    const { model, volumes, prices, revenue } = sample();
    const graph = modulesGraph(model, "01: Inputs", false);
    expect(ids(graph)).toEqual([volumes, prices, revenue].map(String));
    expect(graph.nodes.map(node => node.external)).toEqual([false, false, true]);
  });

  it("shows every module as its own section's when no section is named, each saying its section in words", () => {
    const { model } = sample();
    const graph = modulesGraph(model, undefined, false);
    expect([graph.name, graph.local]).toEqual(["All modules", 5]);
    expect(graph.nodes.map(node => [node.external, node.layer, node.meta])).toEqual([
      [false, "s0", "01: Inputs"], [false, "s0", "01: Inputs"], [false, "s1", "02: Calculations"], [false, "s1", "02: Calculations"], [false, "s2", "Reporting"],
    ]);
    expect(graph.edges).toHaveLength(5);
  });

  it("says how much each module holds where the model has one section, which every box would only repeat", () => {
    const make = new GraphMaker();
    const first = make.module("INP01 - Volumes", "Ungrouped");
    make.module("INP02 - Prices", "Ungrouped");
    make.item(first, "Units");
    const graph = modulesGraph(indexModel(make.graph()), undefined, false);
    expect(graph.nodes.map(node => node.meta)).toEqual(["1 line item", "0 line items"]);
    // And its legend has one entry for them, named for what they are: a heading nobody wrote is no section.
    expect(graph.layers).toEqual([{ key: "s0", label: "Modules", count: 2 }]);
  });
  it("gives an empty graph for a section without modules", () => {
    const { model } = sample();
    const graph = modulesGraph(model, "No such section", false);
    expect([graph.nodes.length, graph.edges.length, graph.layers.length]).toEqual([0, 0, 0]);
  });
});

describe("The graph of a module's line items", () => {
  it("shows the module's line items, a heading in its own layer, and one node for each other module they read or feed", () => {
    const { model, revenue, volumes, prices, margin, board, heading, gross, net, units, price, cost, marginPct, total } = sample();
    const graph = moduleGraph(model, revenue, false, false);
    expect([graph.kind, graph.name, graph.local]).toEqual(["drill", "CAL01 - Revenue", 3]);
    expect(graph.nodes.slice(0, 3).map(node => [node.id, node.kind, node.layer, node.label, node.external])).toEqual([
      [String(heading), "lineItem", LAYER.heading, "Workings", false], [String(gross), "lineItem", LAYER.lineItem, "Gross", false], [String(net), "lineItem", LAYER.lineItem, "Net", false],
    ]);
    const groups = graph.nodes.filter(node => node.kind === "externalModule");
    expect(groups.map(node => [node.id, node.code, node.label, node.meta, node.external, node.layer, node.side])).toEqual(expect.arrayContaining([
      [`external${volumes}`, "INP01", "Volumes", "1 line item linked", true, LAYER.external, "in"],
      [`external${prices}`, "INP02", "Prices", "1 line item linked", true, LAYER.external, "in"],
      // Margin Workings reads Gross and feeds Net: it is on both sides.
      [`external${margin}`, "", "Margin Workings", "2 line items linked", true, LAYER.external, "both"],
      [`external${board}`, "REP01", "Board", "1 line item linked", true, LAYER.external, "out"],
    ]));
    expect(groups).toHaveLength(4);
    expect(graph.byId.get(`external${volumes}`)?.members).toEqual([units]);
    expect(graph.byId.get(`external${prices}`)?.members).toEqual([price]);
    expect([...(graph.byId.get(`external${margin}`)?.members ?? [])].sort()).toEqual([cost, marginPct].sort());
    expect(graph.byId.get(`external${board}`)?.members).toEqual([total]);
    // The node of another module stands for that module.
    expect(graph.byId.get(`external${margin}`)?.raw?.id).toBe(margin);
  });

  it("shows the lists and properties the module's formulas name, as nodes of their own", () => {
    const { model, revenue, active, code, products } = sample();
    const graph = moduleGraph(model, revenue, false, false);
    expect([graph.byId.get(String(active))?.kind, graph.byId.get(String(active))?.code, graph.byId.get(String(active))?.layer]).toEqual(["list", "SUBSET", LAYER.list]);
    expect([graph.byId.get(String(code))?.kind, graph.byId.get(String(code))?.code, graph.byId.get(String(code))?.layer, graph.byId.get(String(code))?.meta]).toEqual(["property", "PROPERTY", LAYER.property, "Products"]);
    // The list itself is named by no formula of the module: it is not there.
    expect(graph.byId.has(String(products))).toBe(false);
    expect(graph.layers.map(layer => [layer.key, layer.label, layer.count])).toEqual([
      [LAYER.heading, "No Data line items (headings)", 1], [LAYER.lineItem, "Line items", 2], [LAYER.external, "Other modules", 4], [LAYER.list, "Lists and subsets", 1], [LAYER.property, "List properties", 1],
    ]);
  });

  it("carries with each link the model's links it counts together", () => {
    const { model, revenue, volumes, margin, units, gross, net, cost, marginPct, canEdit } = sample();
    const graph = moduleGraph(model, revenue, false, false);
    const edge = (from: string, to: string) => graph.edges.find(each => graph.nodes[each.s].id === from && graph.nodes[each.t].id === to);
    expect(edge(`external${volumes}`, String(gross))?.refs).toEqual([[units, gross, "reference"]]);
    expect(edge(String(gross), `external${margin}`)?.refs).toEqual([[gross, marginPct, "reference"]]);
    expect(edge(`external${margin}`, String(net))?.refs).toEqual([[cost, net, "reference"]]);
    expect(edge(String(gross), String(net))?.w).toBe(1);
    // With the access links, the flag's two links join the formula's link from the same module.
    const withAccess = moduleGraph(model, revenue, false, true);
    const fromVolumes = withAccess.edges.filter(each => withAccess.nodes[each.s].id === `external${volumes}`);
    expect(fromVolumes.map(each => [withAccess.nodes[each.t].id, each.w]).sort()).toEqual([[String(gross), 2], [String(net), 1]].sort());
    expect(withAccess.byId.get(`external${volumes}`)?.members).toEqual([units, canEdit]);
  });

  it("shows the line items of other modules one by one when asked to, each with its module's code", () => {
    const { model, revenue, units, price, cost, marginPct, total } = sample();
    const graph = moduleGraph(model, revenue, true, false);
    expect(graph.nodes.filter(node => node.kind === "externalModule")).toEqual([]);
    const outside = graph.nodes.filter(node => node.kind === "externalItem");
    expect(outside.map(node => node.id).sort()).toEqual([units, price, cost, marginPct, total].map(String).sort());
    expect(graph.byId.get(String(units))).toMatchObject({ code: "INP01", label: "Units", external: true, layer: LAYER.external, side: "in" });
    // A module without a code gives its whole name.
    expect(graph.byId.get(String(cost))).toMatchObject({ code: "Margin Workings", side: "in" });
    expect(graph.byId.get(String(marginPct))?.side).toBe("out");
    expect(graph.layers.find(layer => layer.key === LAYER.external)?.label).toBe("Line items of other modules");
    expect(graph.local).toBe(3);
  });

  it("names what stands beside the line items by what it is: modules, their line items, or both kinds of thing", () => {
    const make = new GraphMaker();
    const plan = make.module("PLN01 - Plan", "Planning");
    const review = make.module("PLN02 - Review", "Planning");
    const summary = make.module("PLN03 - Summary", "Planning");
    const units = make.item(plan, "Units");
    const seen = make.item(review, "Seen", { formula: "PLN01 - Plan.Units" });
    // The export can name a module where it says what a line item is referenced by.
    make.link(units, seen).link(units, summary);
    const model = indexModel(make.graph());
    const beside = (expanded: boolean) => moduleGraph(model, plan, expanded, false).layers.find(layer => layer.key === LAYER.external);
    expect(beside(false)).toEqual({ key: LAYER.external, label: "Other modules", count: 2 });
    expect(beside(true)).toEqual({ key: LAYER.external, label: "Other objects", count: 2 });
  });

  it("keeps a line item's link to itself, which a formula that reads its own line item makes", () => {
    const { model, board, running, total } = sample();
    const graph = moduleGraph(model, board, false, false);
    const self = graph.edges.find(edge => edge.s === edge.t);
    expect(self && graph.nodes[self.s].id).toBe(String(running));
    expect(graph.out[graph.byId.get(String(total))!.index]).toEqual([graph.byId.get(String(running))!.index]);
  });

  it("gives an empty graph for a module without line items, and for a module the model does not hold", () => {
    const make = new GraphMaker();
    const empty = make.module("EMPTY - Nothing Yet", "01: Inputs");
    const model = indexModel(make.graph());
    expect([moduleGraph(model, empty, false, false).nodes.length, moduleGraph(model, empty, false, false).name]).toEqual([0, "EMPTY - Nothing Yet"]);
    expect([moduleGraph(model, 77, false, false).nodes.length, moduleGraph(model, 77, false, false).name]).toEqual([0, ""]);
  });

  it("gives every node its name as one line and a size by its kind, until its name is measured", () => {
    const { model, revenue } = sample();
    const graph = moduleGraph(model, revenue, false, false);
    const sizes = new Map(graph.nodes.map(node => [node.kind, [node.w, node.h]]));
    expect([sizes.get("lineItem"), sizes.get("externalModule"), sizes.get("list"), sizes.get("property")]).toEqual([[216, 32], [232, 49], [232, 49], [232, 49]]);
    expect(sectionsGraph(model, false).nodes.map(node => [node.w, node.h])[0]).toEqual([232, 49]);
    expect(modulesGraph(model, undefined, false).nodes.map(node => [node.w, node.h])[0]).toEqual([232, 49]);
    expect(graph.nodes.every(node => node.lines.length === 1 && node.lines[0] === node.label)).toBe(true);
  });
});
