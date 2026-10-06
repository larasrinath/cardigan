import { describe, expect, it } from "vitest";
import { LAYER, moduleGraph, modulesGraph, sectionsGraph, type ViewGraph, type ViewNode } from "./map-graphs.js";
import { inspect, isHeading, layerOfObject, selectionSentence } from "./map-inspect.js";
import { indexModel } from "./map-model.js";
import { GraphMaker } from "./map.test-support.js";

function sample() {
  const make = new GraphMaker();
  const products = make.list("Products", { count: 1200, topLevel: "All Products", numbered: false, displayName: "Label", row: 4 });
  const regions = make.list("Regions", { count: 12, parent: products });
  const active = make.subset(products, "Active Products");
  const code = make.property(products, "Code");
  const volumes = make.module("INP01 - Volumes", "01: Inputs", { cells: 48000, dimensions: [products, regions], timeScale: "Month", timeRange: "Model Calendar", versions: "All", notes: "Loaded each month." });
  const revenue = make.module("CAL01 - Revenue", "02: Calculations", { cells: 96000, dimensions: [active] });
  const units = make.item(volumes, "Units", { cells: 14400, dimensions: [products, regions], inheritsDimensions: true, summary: "SUM", timeScale: "Month", versions: "All", code: "UNITS", row: 12 });
  const canEdit = make.item(volumes, "Can Edit", { format: "BOOLEAN" });
  const owner = make.item(volumes, "Owner", { format: "ENTITY", formatList: regions });
  const heading = make.item(revenue, "Workings", { format: "NONE" });
  const gross = make.item(revenue, "Gross", { formula: "Units * 2", notes: "Before discounts." });
  const net = make.item(revenue, "Net", { formula: "Gross - 1" });
  const plain = make.item(revenue, "Manual Adjustment");
  const load = make.action("Load Volumes", { actionType: "Import" });
  const tidy = make.action("Tidy Volumes");
  make.link(units, gross).link(gross, net).link(active, gross, "list_formula").link(code, net).link(canEdit, gross, "write_access").link(canEdit, gross, "read_access")
    .link(load, volumes, "import_target").link(tidy, volumes, "action_target");
  make.unresolved.push({ source: gross, field: "Referenced By", reference: "Retired.Total" }, { source: volumes, field: "Applies To", reference: "Old Regions" });
  return { model: indexModel(make.graph()), products, regions, active, code, volumes, revenue, units, canEdit, owner, heading, gross, net, plain };
}

const byName = (graph: ViewGraph, name: string): ViewNode => graph.nodes.find(node => node.fullName === name)!;

describe("What the inspector says of a section", () => {
  it("says how much it holds, offers its modules, and lists them", () => {
    const { model, volumes } = sample();
    const graph = sectionsGraph(model, false);
    const inspection = inspect(model, graph, graph.nodes[0], false);
    expect(inspection).toMatchObject({ kind: "MODEL SECTION", layer: "s0", name: "01: Inputs", rows: [["modules", "1"], ["contents", "3 line items"]], action: { label: "Open modules", section: 0 }, texts: [] });
    expect(inspection.lists).toEqual([{ key: "modules", title: "Modules · 1", open: true, links: [{ raw: volumes, name: "INP01 - Volumes", layer: "s0" }] }]);
    // A section is no object of the export: it has no file and row.
    expect(inspection.source).toBeUndefined();
  });
});

describe("What the inspector says of a module", () => {
  it("gives its details, the button into its line items, and the modules on screen it reads and feeds", () => {
    const { model, volumes, revenue, units, canEdit, owner } = sample();
    const graph = modulesGraph(model, undefined, false);
    const inspection = inspect(model, graph, byName(graph, "INP01 - Volumes"), false);
    expect(inspection.kind).toBe("MODULE");
    expect(inspection.rows).toEqual([["section", "01: Inputs"], ["line items", "3"], ["cells", "48,000"], ["dimensions", "Products, Regions"], ["time scale", "Month"], ["time range", "Model Calendar"], ["versions", "All"]]);
    expect(inspection.action).toEqual({ label: "Open 3 line items", module: volumes });
    expect(inspection.lists.map(list => [list.key, list.title, list.open])).toEqual([["used", "Used by · 1", true], ["items", "All line items · 3", false]]);
    // The module it feeds is a node of the graph on screen; its own line items are objects of the model.
    expect(inspection.lists[0].links).toEqual([{ node: String(revenue), name: "CAL01 - Revenue", layer: "s1" }]);
    expect(inspection.lists[1].links.map(link => [link.raw, link.name, link.sub, link.layer])).toEqual([
      [units, "Units", "INP01 - Volumes", LAYER.lineItem], [canEdit, "Can Edit", "INP01 - Volumes", LAYER.lineItem], [owner, "Owner", "INP01 - Volumes", LAYER.lineItem],
    ]);
    expect(inspection.notes).toBe("Loaded each month.");
  });

  it("names the actions that load into it or work on it, and the names of its row that matched no object", () => {
    const { model } = sample();
    const graph = modulesGraph(model, undefined, false);
    const inspection = inspect(model, graph, byName(graph, "INP01 - Volumes"), false);
    expect(inspection.texts).toEqual([
      { key: "actions", title: "Actions · 2", lines: ["Load Volumes (Import)", "Tidy Volumes"] },
      { key: "unresolved", title: "Names not found · 1", lines: ["Applies To: Old Regions"] },
    ]);
  });

  it("says None for a module without dimensions, and leaves out what the export does not say", () => {
    const make = new GraphMaker();
    const module = make.module("Bare", "01: All");
    const model = indexModel(make.graph());
    const graph = modulesGraph(model, undefined, false);
    const inspection = inspect(model, graph, graph.nodes[0], false);
    expect(inspection.rows).toEqual([["section", "01: All"], ["line items", "0"], ["dimensions", "None"]]);
    expect(inspection.action).toEqual({ label: "Open 0 line items", module });
    expect(inspection.lists.map(list => list.key)).toEqual(["items"]);
    expect(inspection.notes).toBeUndefined();
  });

  it("lists the line items a module's node stands for in another module's graph", () => {
    const { model, revenue, units } = sample();
    const graph = moduleGraph(model, revenue, false, false);
    const inspection = inspect(model, graph, byName(graph, "INP01 - Volumes"), false);
    expect(inspection.kind).toBe("MODULE");
    expect(inspection.layer).toBe(LAYER.external);
    expect(inspection.lists.map(list => [list.key, list.title, list.open])).toEqual([["referenced", "Referenced line items · 1", true], ["used", "Used by · 1", true], ["items", "All line items · 3", false]]);
    expect(inspection.lists[0].links.map(link => link.raw)).toEqual([units]);
    // What it feeds is a node of this graph: the link selects it here.
    expect(inspection.lists[1].links).toEqual([{ node: String(byName(graph, "Gross").id), name: "Gross", layer: LAYER.lineItem }]);
  });
});

describe("What the inspector says of a line item", () => {
  it("gives its details and its formula, and the way into its module with it selected", () => {
    const { model, revenue, gross } = sample();
    const graph = moduleGraph(model, revenue, false, false);
    const inspection = inspect(model, graph, byName(graph, "Gross"), false);
    expect(inspection).toMatchObject({ kind: "LINE ITEM", layer: LAYER.lineItem, name: "Gross", formula: "Units * 2", notes: "Before discounts." });
    expect(inspection.rows).toEqual([["module", "CAL01 - Revenue"], ["format", "NUMBER"], ["dimensions", "None"]]);
    expect(inspection.action).toEqual({ label: "Open containing module", module: revenue, select: gross });
    expect(inspection.remark).toBeUndefined();
  });

  it("lists what it depends on and what uses it across the whole model, each object once", () => {
    const { model, revenue, units, active, net } = sample();
    const graph = moduleGraph(model, revenue, false, false);
    const inspection = inspect(model, graph, byName(graph, "Gross"), false);
    expect(inspection.lists.map(list => [list.key, list.title, list.open])).toEqual([["depends", "Depends on · 2", true], ["used", "Used by · 1", true]]);
    // In the order of the graph's links, which is by the place of what is read.
    expect(inspection.lists[0].links).toEqual([{ raw: active, name: "Active Products", layer: LAYER.list }, { raw: units, name: "Units", layer: LAYER.lineItem, sub: "INP01 - Volumes" }]);
    expect(inspection.lists[1].links).toEqual([{ raw: net, name: "Net", layer: LAYER.lineItem, sub: "CAL01 - Revenue" }]);
  });

  it("adds what drives who may read and write it when those links are shown, and says how", () => {
    const { model, revenue, canEdit } = sample();
    const graph = moduleGraph(model, revenue, false, true);
    const depends = inspect(model, graph, byName(graph, "Gross"), true).lists[0];
    expect(depends.title).toBe("Depends on · 3");
    expect(depends.links.find(link => link.raw === canEdit)).toEqual({ raw: canEdit, name: "Can Edit", layer: LAYER.lineItem, sub: "INP01 - Volumes", caption: "read access, write access" });
  });

  it("says its dimensions are the module's where it has none of its own, and names the list it is formatted as", () => {
    const { model, volumes } = sample();
    const graph = moduleGraph(model, volumes, false, false);
    expect(inspect(model, graph, byName(graph, "Units"), false).rows).toEqual([
      ["module", "INP01 - Volumes"], ["format", "NUMBER"], ["cells", "14,400"], ["dimensions", "Products, Regions (the module's)"], ["time scale", "Month"], ["versions", "All"], ["summary", "SUM"], ["code", "UNITS"],
    ]);
    expect(inspect(model, graph, byName(graph, "Owner"), false).rows).toContainEqual(["format", "Regions"]);
  });

  it("says in the formula's place that a heading has none, and that a line item without one has none in the export", () => {
    const { model, revenue } = sample();
    const graph = moduleGraph(model, revenue, false, false);
    const heading = inspect(model, graph, byName(graph, "Workings"), false);
    expect([heading.formula, heading.remark, heading.layer]).toEqual([undefined, "Exported heading; no formula.", LAYER.heading]);
    expect(inspect(model, graph, byName(graph, "Manual Adjustment"), false).remark).toBe("No formula in the export.");
  });

  it("says which file and row it comes from, and which names of its row matched no object", () => {
    const { model, revenue, volumes } = sample();
    const graph = moduleGraph(model, revenue, false, false);
    const gross = inspect(model, graph, byName(graph, "Gross"), false);
    expect(gross.source).toMatch(/^Line Items · row \d+$/);
    expect(gross.texts).toEqual([{ key: "unresolved", title: "Names not found · 1", lines: ["Referenced By: Retired.Total"] }]);
    const units = moduleGraph(model, volumes, false, false);
    expect(inspect(model, units, byName(units, "Units"), false).source).toBe("Line Items · row 12");
  });
});

describe("What the inspector says of a list, a subset and a property", () => {
  it("gives a subset its list and a property its list and format, with what uses them", () => {
    const { model, revenue, gross, net } = sample();
    const graph = moduleGraph(model, revenue, false, false);
    const subset = inspect(model, graph, byName(graph, "Active Products"), false);
    expect(subset).toMatchObject({ kind: "SUBSET", layer: LAYER.list, rows: [["parent", "Products"]], source: "General Lists · row 4" });
    expect(subset.lists).toEqual([{ key: "used", title: "Used by · 1", open: true, links: [{ raw: gross, name: "Gross", layer: LAYER.lineItem, sub: "CAL01 - Revenue" }] }]);
    expect(subset.action).toBeUndefined();
    expect(subset.remark).toBeUndefined();
    const property = inspect(model, graph, byName(graph, "Code"), false);
    expect(property).toMatchObject({ kind: "PROPERTY", layer: LAYER.property, rows: [["list", "Products"], ["format", "TEXT"]] });
    expect(property.lists[0].links.map(link => link.raw)).toEqual([net]);
  });

  it("gives a list its size, its top level, whether it is numbered and its display name", () => {
    const make = new GraphMaker();
    const parent = make.list("All Sites");
    const list = make.list("Sites", { count: 1200, topLevel: "Total Sites", numbered: true, displayName: "Label", parent });
    const module = make.module("MOD - Module", "01: All");
    make.link(list, make.item(module, "Uses The List"), "list_formula");
    const model = indexModel(make.graph());
    const graph = moduleGraph(model, module, false, false);
    expect(inspect(model, graph, byName(graph, "Sites"), false).rows).toEqual([["parent", "All Sites"], ["items", "1,200"], ["top level", "Total Sites"], ["numbered", "Yes"], ["display name", "Label"]]);
  });
});

describe("What the map says of an object", () => {
  it("tells a heading from a line item, and gives each object the layer it is drawn in", () => {
    const { model, heading, gross, volumes, products, active, code } = sample();
    expect([isHeading(model.node(heading)!), isHeading(model.node(gross)!), isHeading(model.node(volumes)!)]).toEqual([true, false, false]);
    expect([heading, gross, volumes, products, active, code].map(id => layerOfObject(model, model.node(id)!))).toEqual([LAYER.heading, LAYER.lineItem, "s0", LAYER.list, LAYER.list, LAYER.property]);
  });

  it("says a selection in one sentence, for a screen reader", () => {
    const { model, revenue } = sample();
    const graph = moduleGraph(model, revenue, false, false);
    expect(selectionSentence(inspect(model, graph, byName(graph, "Gross"), false), 1200, 1)).toBe("Line item Gross selected: 1,200 upstream, 1 downstream.");
    const sections = sectionsGraph(model, false);
    expect(selectionSentence(inspect(model, sections, sections.nodes[1], false), 1, 0)).toBe("Model section 02: Calculations selected: 1 upstream, 0 downstream.");
  });
});
