import { describe, expect, it } from "vitest";
import type { ModelGraph } from "./graph-types.js";
import { indexModel, isAccess, UNGROUPED } from "./map-model.js";
import { GraphMaker } from "./map.test-support.js";

/** Two sections, three modules, one of them above the first heading. */
function sample() {
  const make = new GraphMaker();
  const loose = make.module("Scratch Pad");
  const inputs = make.module("INP01 - Volumes", "01: Inputs");
  const calc = make.module("CAL01 - Revenue", "02: Calculations");
  const units = make.item(inputs, "Units");
  const price = make.item(inputs, "Price");
  const revenue = make.item(calc, "Revenue", { formula: "Units * Price" });
  const note = make.item(loose, "Note", { format: "TEXT" });
  const products = make.list("Products", { count: 40 });
  const flag = make.item(inputs, "Can Edit", { format: "BOOLEAN" });
  make.link(units, revenue).link(price, revenue).link(products, revenue, "list_formula").link(flag, revenue, "write_access").link(products, calc, "applies");
  return { make, loose, inputs, calc, units, price, revenue, note, products, flag };
}

describe("The model the map looks things up in", () => {
  it("lists the modules in the graph's order, and each module's line items", () => {
    const { make, loose, inputs, calc, units, price, revenue, note, flag } = sample();
    const model = indexModel(make.graph());
    expect(model.modules.map(module => module.id)).toEqual([loose, inputs, calc]);
    expect(model.itemsOf(inputs).map(item => item.id)).toEqual([units, price, flag]);
    expect(model.itemsOf(calc).map(item => item.id)).toEqual([revenue]);
    expect(model.lineItems.map(item => item.id)).toEqual([units, price, revenue, note, flag]);
    expect(model.itemsOf(999)).toEqual([]);
  });

  it("takes the sections from the graph, and adds a heading a module names that the graph left out", () => {
    const { make, loose, inputs } = sample();
    const graph = make.graph();
    expect(graph.sections).toEqual(["01: Inputs", "02: Calculations"]);
    const model = indexModel(graph);
    // The module without a heading is filed under "Ungrouped", which the graph's own list did not name here.
    expect(model.sections).toEqual(["01: Inputs", "02: Calculations", UNGROUPED]);
    expect(model.sectionOf(model.node(loose)!)).toBe(UNGROUPED);
    expect(model.sectionOf(model.node(inputs)!)).toBe("01: Inputs");
    expect([model.sectionIndex("02: Calculations"), model.sectionIndex(UNGROUPED), model.sectionIndex("No such")]).toEqual([1, 2, -1]);
    // A section the graph names twice is one section.
    expect(indexModel({ ...graph, sections: ["01: Inputs", "01: Inputs", "02: Calculations"] }).sections).toEqual(["01: Inputs", "02: Calculations", UNGROUPED]);
  });

  it("says a line item's section is its module's, whatever the line item itself says", () => {
    const { make, revenue } = sample();
    const graph = make.graph();
    graph.nodes[revenue] = { ...graph.nodes[revenue], group: "Somewhere else" };
    expect(indexModel(graph).sectionOf(graph.nodes[revenue])).toBe("02: Calculations");
  });

  it("says which module a node belongs to: a module itself, a line item's module, nothing for a list", () => {
    const { make, inputs, units, products } = sample();
    const model = indexModel(make.graph());
    expect([model.moduleOf(model.node(inputs)), model.moduleOf(model.node(units)), model.moduleOf(model.node(products)), model.moduleOf(undefined)]).toEqual([inputs, inputs, undefined, undefined]);
  });

  it("keeps the links of formulas apart from those of who may read and write, and files both by their ends", () => {
    const { make, units, price, revenue, products, flag, calc } = sample();
    const model = indexModel(make.graph());
    expect(model.formulaEdges).toEqual([[units, revenue, "reference"], [price, revenue, "reference"], [products, revenue, "list_formula"]]);
    expect(model.accessEdges).toEqual([[flag, revenue, "write_access"]]);
    expect(model.incoming(revenue).map(edge => edge[0])).toEqual([units, price, products, flag]);
    expect(model.outgoing(units)).toEqual([[units, revenue, "reference"]]);
    // A list that is a module's dimension is no dependency: it is in neither list.
    expect(model.incoming(calc)).toEqual([]);
    expect(model.outgoing(products)).toEqual([[products, revenue, "list_formula"]]);
    expect([isAccess("read_access"), isAccess("write_access"), isAccess("reference"), isAccess("list_formula")]).toEqual([true, true, false, false]);
  });

  it("leaves out a link that names a node the graph does not hold, and a line item without a module of the graph", () => {
    const { make, units, revenue } = sample();
    const graph = make.graph();
    const broken: ModelGraph = {
      ...graph,
      nodes: [...graph.nodes, { id: graph.nodes.length, kind: "lineItem", name: "Orphan", file: "Line Items", row: 99 }, { id: graph.nodes.length + 1, kind: "lineItem", name: "Lost", file: "Line Items", row: 100, module: 4242 }],
      edges: [...graph.edges, [units, 4242, "reference"], [4243, revenue, "reference"]],
    };
    const model = indexModel(broken);
    expect(model.lineItems.map(item => item.name)).not.toContain("Orphan");
    expect(model.lineItems.map(item => item.name)).not.toContain("Lost");
    expect(model.formulaEdges).toHaveLength(3);
    expect(model.moduleOf(broken.nodes[broken.nodes.length - 1])).toBeUndefined();
  });

  it("finds a node by its id, also where the id is not the node's place", () => {
    const { make } = sample();
    const graph = make.graph();
    const shifted: ModelGraph = { ...graph, nodes: graph.nodes.map(node => ({ ...node, id: node.id + 100, ...(node.module === undefined ? {} : { module: node.module + 100 }) })), edges: graph.edges.map(([from, to, kind]) => [from + 100, to + 100, kind]) };
    const model = indexModel(shifted);
    expect(model.node(101)?.name).toBe("INP01 - Volumes");
    expect(model.node(1)).toBeUndefined();
    expect(model.itemsOf(101).map(item => item.name)).toEqual(["Units", "Price", "Can Edit"]);
    expect(model.formulaEdges).toHaveLength(3);
  });

  it("lists the actions that load into a module, work on it or take it", () => {
    const { make, inputs, calc, products } = sample();
    const load = make.action("Load Volumes", { actionType: "Import" });
    const send = make.action("Send Revenue", { actionType: "Export" });
    const tidy = make.action("Tidy Volumes", { actionType: "Delete" });
    const listLoad = make.action("Load Products", { actionType: "Import" });
    make.link(load, inputs, "import_target").link(calc, send, "export_source").link(tidy, inputs, "action_target").link(listLoad, products, "import_target");
    const model = indexModel(make.graph());
    expect(model.actionsOf(inputs).map(({ action, kind }) => [action.name, kind])).toEqual([["Load Volumes", "import_target"], ["Tidy Volumes", "action_target"]]);
    expect(model.actionsOf(calc).map(({ action, kind }) => [action.name, kind])).toEqual([["Send Revenue", "export_source"]]);
    // An action on a list is no action of a module, and no dependency either.
    expect(model.incoming(inputs)).toEqual([]);
    expect(model.outgoing(calc)).toEqual([]);
  });

  it("files the names that matched no object under the node whose row holds them", () => {
    const { make, revenue, units } = sample();
    make.unresolved.push({ source: revenue, field: "Referenced By", reference: "Old Module.Total" }, { source: revenue, field: "Applies To", reference: "Old List" });
    const model = indexModel(make.graph());
    expect(model.unresolvedOf(revenue).map(entry => entry.reference)).toEqual(["Old Module.Total", "Old List"]);
    expect(model.unresolvedOf(units)).toEqual([]);
  });
});
