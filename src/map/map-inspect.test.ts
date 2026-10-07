import { describe, expect, it } from "vitest";
import { LAYER, moduleGraph, modulesGraph, sectionsGraph, type ViewGraph, type ViewNode } from "./map-graphs.js";
import { inspect, isHeading, layerOfObject, statusWords, traceWords, viewSentence } from "./map-inspect.js";
import { indexModel } from "./map-model.js";
import { GraphMaker } from "./map-fakes.test-support.js";

function sample() {
  const make = new GraphMaker();
  const products = make.list("Products", { count: 1200, topLevel: "All Products", numbered: false, displayName: "Label", row: 4 });
  const regions = make.list("Regions", { count: 12, parent: products });
  const active = make.subset(products, "Active Products");
  const code = make.property(products, "Code");
  const volumes = make.module("INP01 - Volumes", "01: Inputs", { cells: 48000, dimensions: [products, regions], timeScale: "Month", timeRange: "Model Calendar", versions: "All", notes: "Loaded each month." });
  const revenue = make.module("CAL01 - Revenue", "02: Calculations", { cells: 96000, dimensions: [active] });
  const units = make.item(volumes, "Units", { cells: 14400, dimensions: [products, regions], inheritsDimensions: true, summary: "SUM", timeScale: "Month", versions: "All", style: "Normal", code: "UNITS", row: 12 });
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
/** A detail of the details, by its label. */
const detail = (rows: readonly (readonly [string, string])[], label: string): string | undefined => rows.find(row => row[0] === label)?.[1];

describe("What the details say of a section", () => {
  it("says how much it holds, offers its modules, and lists what it feeds and its modules", () => {
    const { model, volumes } = sample();
    const graph = sectionsGraph(model, false);
    const inspection = inspect(model, graph, graph.nodes[0], false);
    expect(inspection).toMatchObject({ kind: "SECTION", layer: "s0", name: "01: Inputs", rows: [["Modules", "1"], ["Line items", "3"]], action: { label: "Open its 1 module", section: 0 }, texts: [] });
    expect(inspection.lists).toEqual([
      { key: "used", title: "It feeds directly · 1", open: true, links: [{ node: "section1", name: "02: Calculations", layer: "s1" }] },
      { key: "modules", title: "Its modules · 1", open: true, links: [{ raw: volumes, name: "INP01 - Volumes", layer: "s0" }] },
    ]);
    // The section that reads it has it among what feeds it.
    const reader = inspect(model, graph, graph.nodes[1], false);
    expect(reader.action).toEqual({ label: "Open its 1 module", section: 1 });
    expect(reader.lists.map(list => [list.key, list.title])).toEqual([["depends", "Feeds it directly · 1"], ["modules", "Its modules · 1"]]);
  });
});

describe("What the details say of a module", () => {
  it("gives its details under the names of the export's columns, the button into its line items, and the modules on screen it reads and feeds", () => {
    const { model, volumes, revenue, units, canEdit, owner } = sample();
    const graph = modulesGraph(model, undefined, false);
    const inspection = inspect(model, graph, byName(graph, "INP01 - Volumes"), false);
    expect(inspection.kind).toBe("MODULE");
    expect(inspection.rows).toEqual([["Section", "01: Inputs"], ["Line items", "3"], ["Applies To", "Products, Regions"], ["Cell Count", "48,000"], ["Time Scale", "Month"], ["Time Range", "Model Calendar"], ["Versions", "All"]]);
    expect(inspection.action).toEqual({ label: "Open its 3 line items", module: volumes });
    expect(inspection.lists.map(list => [list.key, list.title, list.open])).toEqual([["used", "It feeds directly · 1", true], ["items", "All its line items · 3", false]]);
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
      { key: "unresolved", title: "Names not matched to one object · 1", lines: ["Applies To: Old Regions"] },
    ]);
  });

  it("says None for a module that applies to nothing, leaves out what the export does not say, and offers no way into a module without line items", () => {
    const make = new GraphMaker();
    make.module("Bare", "01: All");
    const model = indexModel(make.graph());
    const graph = modulesGraph(model, undefined, false);
    const inspection = inspect(model, graph, graph.nodes[0], false);
    // A model of one section has no sections to tell its modules apart by: the details do not name one.
    expect(inspection.rows).toEqual([["Line items", "0"], ["Applies To", "None"]]);
    expect(inspection.action).toBeUndefined();
    expect(inspection.lists).toEqual([]);
    expect(inspection.notes).toBeUndefined();
  });

  it("lists the line items a module's node stands for in another module's graph", () => {
    const { model, revenue, units } = sample();
    const graph = moduleGraph(model, revenue, false, false);
    const inspection = inspect(model, graph, byName(graph, "INP01 - Volumes"), false);
    expect(inspection.kind).toBe("MODULE");
    expect(inspection.layer).toBe(LAYER.external);
    expect(inspection.lists.map(list => [list.key, list.title, list.open])).toEqual([["referenced", "Its line items linked here · 1", true], ["used", "It feeds directly · 1", true], ["items", "All its line items · 3", false]]);
    expect(inspection.lists[0].links.map(link => link.raw)).toEqual([units]);
    // What it feeds is a node of this graph: the link selects it here.
    expect(inspection.lists[1].links).toEqual([{ node: String(byName(graph, "Gross").id), name: "Gross", layer: LAYER.lineItem }]);
  });
});

describe("What the details say of a line item", () => {
  it("gives its details and its formula", () => {
    const { model, revenue } = sample();
    const graph = moduleGraph(model, revenue, false, false);
    const inspection = inspect(model, graph, byName(graph, "Gross"), false);
    expect(inspection).toMatchObject({ kind: "LINE ITEM", layer: LAYER.lineItem, name: "Gross", formula: "Units * 2", notes: "Before discounts." });
    expect(inspection.rows).toEqual([["Module", "CAL01 - Revenue"], ["Format", "NUMBER"], ["Applies To", "None"]]);
    expect(inspection.remark).toBeUndefined();
    // It is among its module's line items already: there is nowhere to open.
    expect(inspection.action).toBeUndefined();
  });

  it("offers the way into its own module, with it selected, for a line item that stands beside another module's", () => {
    const { model, revenue, volumes, units } = sample();
    const graph = moduleGraph(model, revenue, true, false);
    const inspection = inspect(model, graph, byName(graph, "Units"), false);
    expect(inspection.layer).toBe(LAYER.external);
    expect(inspection.action).toEqual({ label: "Open its module with it selected", module: volumes, select: units });
  });

  it("lists what feeds it and what it feeds across the whole model, each object once", () => {
    const { model, revenue, units, active, net } = sample();
    const graph = moduleGraph(model, revenue, false, false);
    const inspection = inspect(model, graph, byName(graph, "Gross"), false);
    expect(inspection.lists.map(list => [list.key, list.title, list.open])).toEqual([["depends", "Feeds it directly · 2", true], ["used", "It feeds directly · 1", true]]);
    // In the order of the graph's links, which is by the place of what is read.
    expect(inspection.lists[0].links).toEqual([{ raw: active, name: "Active Products", layer: LAYER.list }, { raw: units, name: "Units", layer: LAYER.lineItem, sub: "INP01 - Volumes" }]);
    expect(inspection.lists[1].links).toEqual([{ raw: net, name: "Net", layer: LAYER.lineItem, sub: "CAL01 - Revenue" }]);
  });

  it("adds its read and write access drivers when those links are shown, and says which a link is, from either end", () => {
    const { model, revenue, volumes, canEdit, gross } = sample();
    const graph = moduleGraph(model, revenue, false, true);
    const depends = inspect(model, graph, byName(graph, "Gross"), true).lists[0];
    expect(depends.title).toBe("Feeds it directly · 3");
    expect(depends.links.find(link => link.raw === canEdit)).toEqual({ raw: canEdit, name: "Can Edit", layer: LAYER.lineItem, sub: "INP01 - Volumes", caption: "read access driver, write access driver" });
    const source = moduleGraph(model, volumes, false, true);
    const driven = inspect(model, source, byName(source, "Can Edit"), true).lists;
    expect(driven.map(list => [list.key, list.title])).toEqual([["used", "It feeds directly · 1"]]);
    expect(driven[0].links).toEqual([{ raw: gross, name: "Gross", layer: LAYER.lineItem, sub: "CAL01 - Revenue", caption: "read access driven by this, write access driven by this" }]);
    // Without those links shown, the flag feeds nothing.
    const plain = moduleGraph(model, volumes, false, false);
    expect(inspect(model, plain, byName(plain, "Can Edit"), false).lists).toEqual([]);
  });

  it("labels its settings as the Line Items table names its columns, and says its dimensions are the module's where it has none of its own", () => {
    const { model, volumes } = sample();
    const graph = moduleGraph(model, volumes, false, false);
    expect(inspect(model, graph, byName(graph, "Units"), false).rows).toEqual([
      ["Module", "INP01 - Volumes"], ["Format", "NUMBER"], ["Summary", "SUM"], ["Applies To", "Products, Regions (the module's)"], ["Cell Count", "14,400"], ["Time Scale", "Month"], ["Versions", "All"], ["Style", "Normal"], ["Code", "UNITS"],
    ]);
  });

  it("says in the formula's place that a heading has none, and that a line item without one has none", () => {
    const { model, revenue } = sample();
    const graph = moduleGraph(model, revenue, false, false);
    const heading = inspect(model, graph, byName(graph, "Workings"), false);
    expect([heading.formula, heading.remark, heading.layer]).toEqual([undefined, "No formula. Its format is No Data: a heading among the line items.", LAYER.heading]);
    expect(inspect(model, graph, byName(graph, "Manual Adjustment"), false).remark).toBe("No formula.");
  });

  it("says which names of its row matched no object, and names no file and no row of one", () => {
    const { model, revenue, volumes } = sample();
    const graph = moduleGraph(model, revenue, false, false);
    const gross = inspect(model, graph, byName(graph, "Gross"), false);
    expect(gross.texts).toEqual([{ key: "unresolved", title: "Names not matched to one object · 1", lines: ["Referenced By: Retired.Total"] }]);
    // The graph knows the table and the row each node comes from. The details say neither: the row is counted as a
    // spreadsheet counts a file's rows, and the page has no file for the user to open.
    const units = moduleGraph(model, volumes, false, false);
    for (const inspection of [gross, inspect(model, units, byName(units, "Units"), false)]) {
      expect(inspection).not.toHaveProperty("source");
      expect(JSON.stringify(inspection)).not.toMatch(/\.csv|\brow \d/);
    }
  });
});

describe("A line item's Format and Summary, in the words of the page's Line Items table", () => {
  const NUMBER = '{"minimumSignificantDigits":4,"decimalPlaces":2,"dataType":"NUMBER"}';
  const SUM = '{"summaryMethod":"SUM","timeSummaryMethod":"SUM","timeSummarySameAsMainSummary":true}';

  function said(extra: (regions: number) => Parameters<GraphMaker["item"]>[2]): (label: string) => string | undefined {
    const make = new GraphMaker();
    const regions = make.list("Regions");
    const plan = make.module("PLN01 - Plan", "01: All");
    make.item(plan, "Item", extra(regions));
    const model = indexModel(make.graph());
    const graph = moduleGraph(model, plan, false, false);
    const { rows } = inspect(model, graph, byName(graph, "Item"), false);
    return label => detail(rows, label);
  }

  it("says the cells of the export in words, not as the export writes them", () => {
    const price = said(() => ({ format: "NUMBER", formatCell: NUMBER, summary: "SUM", summaryCell: SUM }));
    expect([price("Format"), price("Summary")]).toEqual(["Number, 2 decimal places", "Sum"]);
    const stock = said(() => ({ format: "NUMBER", formatCell: '{"dataType":"NUMBER"}', summary: "FORMULA", summaryCell: '{"summaryMethod":"FORMULA","timeSummaryMethod":"CLOSING_BALANCE","timeSummarySameAsMainSummary":false}' }));
    expect([stock("Format"), stock("Summary")]).toEqual(["Number", "Formula, Time: Closing Balance"]);
    expect(said(() => ({ format: "BOOLEAN", formatCell: '{"dataType":"BOOLEAN"}' }))("Format")).toBe("Boolean");
    expect(said(() => ({ format: "NONE", formatCell: '{"dataType":"NONE"}' }))("Format")).toBe("No Data");
    expect(said(() => ({ format: "TIME_ENTITY", formatCell: '{"periodType":{"entityId":"MONTH","entityLabel":"Month"},"dataType":"TIME_ENTITY"}' }))("Format")).toBe("Time Period: Month");
  });

  it("names the list of a line item formatted as a list, and says the list's ID where the export does not name it", () => {
    const cell = '{"hierarchyEntityLongId":101000000007,"entityFormatFilter":null,"dataType":"ENTITY"}';
    expect(said(regions => ({ format: "ENTITY", formatList: regions, formatCell: cell }))("Format")).toBe("List: Regions");
    expect(said(() => ({ format: "ENTITY", formatCell: cell }))("Format")).toBe("List: ID 101000000007");
  });

  it("says what a Ratio divides, by the names the export gives", () => {
    const ratio = '{"summaryMethod":"RATIO","timeSummaryMethod":"RATIO","timeSummarySameAsMainSummary":true}';
    expect(said(() => ({ summary: "RATIO", summaryCell: ratio, ratioNumerator: "Margin", ratioDenominator: "Revenue" }))("Summary")).toBe("Ratio = Margin / Revenue");
    expect(said(() => ({ summary: "RATIO", summaryCell: ratio }))("Summary")).toBe("Ratio");
  });

  it("falls back to what the graph says where a cell is missing or is not one the page reads", () => {
    // A graph without the cells: the format's data type and the summary's method, and a list by its name.
    const bare = said(() => ({ format: "NUMBER", summary: "SUM" }));
    expect([bare("Format"), bare("Summary")]).toEqual(["NUMBER", "SUM"]);
    expect(said(regions => ({ format: "ENTITY", formatList: regions }))("Format")).toBe("Regions");
    // A cell that is no definition the page reads is shown as the graph has it.
    const odd = said(() => ({ format: "Something Else", formatCell: "Something Else", summary: "A Method", summaryCell: "A Method" }));
    expect([odd("Format"), odd("Summary")]).toEqual(["Something Else", "A Method"]);
    // And a line item the export says nothing of has neither row.
    const nothing = said(() => ({ format: undefined }));
    expect([nothing("Format"), nothing("Summary")]).toEqual([undefined, undefined]);
  });
});

describe("What the details say of a list, a subset and a property", () => {
  it("gives a subset its list and a property its list and format, with what they feed", () => {
    const { model, revenue, gross, net } = sample();
    const graph = moduleGraph(model, revenue, false, false);
    const subset = inspect(model, graph, byName(graph, "Active Products"), false);
    expect(subset).toMatchObject({ kind: "LIST SUBSET", layer: LAYER.list, rows: [["List", "Products"]] });
    // The details name no file and no row: the page has no file for the user to look a row up in.
    expect(subset).not.toHaveProperty("source");
    expect(subset.lists).toEqual([{ key: "used", title: "It feeds directly · 1", open: true, links: [{ raw: gross, name: "Gross", layer: LAYER.lineItem, sub: "CAL01 - Revenue" }] }]);
    expect(subset.action).toBeUndefined();
    expect(subset.remark).toBeUndefined();
    const property = inspect(model, graph, byName(graph, "Code"), false);
    expect(property).toMatchObject({ kind: "LIST PROPERTY", layer: LAYER.property, rows: [["List", "Products"], ["Format", "TEXT"]] });
    expect(property.lists[0].links.map(link => link.raw)).toEqual([net]);
  });

  it("gives a list its details under the names of the export's columns", () => {
    const make = new GraphMaker();
    const parent = make.list("All Sites");
    const list = make.list("Sites", { count: 1200, topLevel: "Total Sites", numbered: true, displayName: "Label", parent });
    const module = make.module("MOD - Module", "01: All");
    make.link(list, make.item(module, "Uses The List"), "list_formula");
    const model = indexModel(make.graph());
    const graph = moduleGraph(model, module, false, false);
    const inspection = inspect(model, graph, byName(graph, "Sites"), false);
    expect(inspection.kind).toBe("LIST");
    expect(inspection.rows).toEqual([["Parent Hierarchy", "All Sites"], ["Item Count", "1,200"], ["Top Level", "Total Sites"], ["Numbered", "Yes"], ["Display Name Property", "Label"]]);
  });
});

describe("What the map says of an object", () => {
  it("tells a heading from a line item, and gives each object the layer it is drawn in", () => {
    const { model, heading, gross, volumes, products, active, code } = sample();
    expect([isHeading(model.node(heading)!), isHeading(model.node(gross)!), isHeading(model.node(volumes)!)]).toEqual([true, false, false]);
    expect([heading, gross, volumes, products, active, code].map(id => layerOfObject(model, model.node(id)!))).toEqual([LAYER.heading, LAYER.lineItem, "s0", LAYER.list, LAYER.list, LAYER.property]);
  });
});

describe("What a trace found, in words", () => {
  it("says how many boxes feed the node and how many it feeds, one and many, and both in one sentence", () => {
    const { model, revenue } = sample();
    const graph = moduleGraph(model, revenue, false, false);
    const gross = inspect(model, graph, byName(graph, "Gross"), false);
    expect(traceWords(gross, 1200, 1)).toEqual({
      feeds: "1,200 boxes feed it", fed: "it feeds 1 box",
      sentence: "Line item Gross selected. On the map 1,200 boxes feed it and it feeds 1 box, directly or through others.",
    });
    expect(traceWords(gross, 1, 0)).toMatchObject({ feeds: "1 box feeds it", fed: "it feeds 0 boxes" });
    const sections = sectionsGraph(model, false);
    expect(traceWords(inspect(model, sections, sections.nodes[1], false), 1, 0).sentence).toBe("Section 02: Calculations selected. On the map 1 box feeds it and it feeds 0 boxes, directly or through others.");
    const subset = inspect(model, graph, byName(graph, "Active Products"), false);
    expect(traceWords(subset, 0, 2).sentence).toMatch(/^List subset Active Products selected\./);
  });
});

describe("The line that says what the map shows", () => {
  it("counts the graph's own boxes, what stands beside them and the links, in the words of each view", () => {
    const { model, revenue } = sample();
    const sections = sectionsGraph(model, false);
    expect(statusWords(sections, 2, 2)).toBe("2 sections · 1 link");
    const all = modulesGraph(model, undefined, false);
    expect(statusWords(all, 2, 2)).toBe("2 modules · 1 link");
    const one = modulesGraph(model, "02: Calculations", false);
    expect(statusWords(one, 2, 2)).toBe("1 module · 1 module of other sections · 1 link");
    const drill = moduleGraph(model, revenue, false, false);
    // Four line items of the module; beside them the module it reads, a subset and a property.
    expect(statusWords(drill, 7, 7)).toBe("4 line items · 3 outside the module · 4 links");
  });

  it("says how many boxes are drawn when a layer is hidden or the view keeps to a trace, and how many are in view", () => {
    const { model, revenue } = sample();
    const drill = moduleGraph(model, revenue, false, false);
    expect(statusWords(drill, 4, 4)).toBe("4 line items · 3 outside the module · 4 links. Showing 4 of 7 boxes.");
    expect(statusWords(drill, 4, 3)).toBe("4 line items · 3 outside the module · 4 links. Showing 4 of 7 boxes, 3 in view.");
    expect(statusWords(drill, 7, 5)).toBe("4 line items · 3 outside the module · 4 links. 5 of 7 boxes in view.");
    expect(statusWords(drill, 0, 0)).toBe("4 line items · 3 outside the module · 4 links. Showing 0 of 7 boxes.");
    // Beside a selection, whose own bar stands under the line, the line says only what it has more to say than that.
    expect([statusWords(drill, 4, 3, true), statusWords(drill, 7, 5, true), statusWords(drill, 4, 4, true)]).toEqual(["Showing 4 of 7 boxes, 3 in view.", "5 of 7 boxes in view.", "Showing 4 of 7 boxes."]);
    // With nothing more to say it is the line as ever (the view then shows the bar in its place).
    expect(statusWords(drill, 7, 7, true)).toBe("4 line items · 3 outside the module · 4 links");
  });

  it("says of an empty graph only what it would hold", () => {
    const model = indexModel(new GraphMaker().graph());
    expect(statusWords(modulesGraph(model, undefined, false), 0, 0)).toBe("0 modules · 0 links");
    expect(statusWords(sectionsGraph(model, false), 0, 0)).toBe("0 sections · 0 links");
  });
});

describe("What the map says aloud when a view opens", () => {
  it("names the view and counts what it is of apart from what stands beside it", () => {
    const { model, revenue } = sample();
    expect(viewSentence(sectionsGraph(model, false), "Demand Model")).toBe("Sections of Demand Model: 2 sections, 1 link.");
    expect(viewSentence(modulesGraph(model, undefined, false), "Demand Model")).toBe("All modules: 2 modules, 1 link.");
    // A section of one module, with the one module of another section it reads: not two modules.
    expect(viewSentence(modulesGraph(model, "02: Calculations", false), "Demand Model")).toBe("02: Calculations: 1 module, with 1 module of other sections, 1 link.");
    expect(viewSentence(moduleGraph(model, revenue, false, false), "Demand Model")).toBe("Line items of CAL01 - Revenue: 4 line items, with 3 outside the module, 4 links.");
  });
});
