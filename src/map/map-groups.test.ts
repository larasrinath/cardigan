import { describe, expect, it } from "vitest";
import type { ModelGraph } from "./graph-types.js";
import { automaticGrouping, BUILT, GOOD, groupingsOf, isBuilt, isGood, leadingCode, roleOf, type Flow, type Grouping, type GroupingKind } from "./map-groups.js";
import { indexModel, withGrouping } from "./map-model.js";
import { GraphMaker } from "./map-fakes.test-support.js";

/** The groupings of a graph, by kind. */
function groupingsBy(graph: ModelGraph): Map<GroupingKind, Grouping> {
  return new Map(groupingsOf(indexModel(graph)).map(grouping => [grouping.kind, grouping]));
}
/** Each module's group, by the module's name, in the model's order. */
const groupsOf = (graph: ModelGraph, grouping: Grouping | undefined): [string, string | undefined][] =>
  graph.nodes.filter(node => node.kind === "module").map(module => [module.name, grouping?.groupOf.get(module.id)]);

/** Modules whose part in the data flow the model's links say, named so that no name says it: a module named as an
 * input is the model's output, and the one named for revenue only takes data in. */
function flowSample() {
  const make = new GraphMaker();
  const products = make.list("Products");
  const facts = make.module("Revenue Facts");
  const units = make.item(facts, "Units");
  const price = make.item(facts, "Price");
  const settings = make.module("Settings");
  const year = make.item(settings, "Current Year");
  const assumptions = make.module("CAL99 Assumptions", undefined, { dimensions: [products] });
  const growth = make.item(assumptions, "Growth");
  make.item(assumptions, "Comment", { format: "TEXT" });
  const workings = make.module("Workings", undefined, { dimensions: [products] });
  const revenue = make.item(workings, "Revenue", { formula: "Revenue Facts.Units * Revenue Facts.Price * (1 + CAL99 Assumptions.Growth)" });
  const since = make.item(workings, "Since", { formula: "Settings.Current Year" });
  const totals = make.module("INP01 Totals", undefined, { dimensions: [products] });
  const total = make.item(totals, "Total", { formula: "Workings.Revenue" });
  const feed = make.module("Feed", undefined, { dimensions: [products] });
  const out = make.item(feed, "Out", { formula: "Settings.Current Year" });
  const notes = make.module("Notes");
  make.item(notes, "--- About ---", { format: "NONE" });
  const load = make.action("Load Facts", { actionType: "Import" });
  const send = make.action("Send Feed", { actionType: "Export" });
  make.link(units, revenue).link(price, revenue).link(growth, revenue).link(year, since).link(year, total).link(year, out).link(revenue, total)
    .link(load, facts, "import_target").link(feed, send, "export_source").link(products, revenue, "list_formula");
  return { graph: make.graph(), facts, settings, assumptions, workings, totals, feed, notes };
}

describe("The ways the map groups a model's modules", () => {
  it("groups modules by their Functional Area, the modules with none last, and offers it only where a module has one", () => {
    const make = new GraphMaker();
    make.module("Volumes", "Inputs", { functionalArea: "Sales" });
    make.module("Wages", "Inputs", { functionalArea: " Workforce " });
    make.module("Scratch", "Inputs");
    make.module("Prices", "Inputs", { functionalArea: "Sales" });
    const graph = make.graph();
    const area = groupingsBy(graph).get("functionalArea");
    expect([area?.groups, groupsOf(graph, area), area?.source, area?.rest]).toEqual([["Sales", "Workforce", "No functional area"],
      [["Volumes", "Sales"], ["Wages", "Workforce"], ["Scratch", "No functional area"], ["Prices", "Sales"]], "from functional areas", "No functional area"]);
    // A model none of whose modules has one has nothing to group by there.
    const plain = new GraphMaker();
    plain.module("Volumes", "Inputs");
    expect(groupingsBy(plain.graph()).has("functionalArea")).toBe(false);
  });

  it("lists the functional areas in the order of their names, numbers as numbers and whatever their case, as Anaplan lists them, the modules with none last", () => {
    const make = new GraphMaker();
    // In the model's order the areas come mixed up: the module list is not ordered by area.
    for (const [name, area] of [["Images", "004: Images"], ["Scratch", ""], ["Settings", "000: Global System"], ["Reports", "010: Reporting"], ["Volumes", "002: Parameters"],
      ["Admin", "003: Administration"], ["Users", "001: Users"], ["Prices", "002: Parameters"], ["Board", "board"], ["Archive", "Archive"]]) {
      make.module(name, undefined, area === "" ? {} : { functionalArea: area });
    }
    const graph = make.graph();
    const area = groupingsBy(graph).get("functionalArea");
    expect(area?.groups).toEqual(["000: Global System", "001: Users", "002: Parameters", "003: Administration", "004: Images", "010: Reporting", "Archive", "board", "No functional area"]);
    // The order is the groups' only: each module is in its own area still.
    expect(groupsOf(graph, area)).toEqual([["Images", "004: Images"], ["Scratch", "No functional area"], ["Settings", "000: Global System"], ["Reports", "010: Reporting"],
      ["Volumes", "002: Parameters"], ["Admin", "003: Administration"], ["Users", "001: Users"], ["Prices", "002: Parameters"], ["Board", "board"], ["Archive", "Archive"]]);
  });

  it("groups modules by the heading rows above them, in the model's order, as the map always has, and offers it only where a module has one", () => {
    const make = new GraphMaker();
    make.module("Scratch Pad");
    make.module("INP01 - Volumes", "01: Inputs");
    make.module("CAL01 - Revenue", "02: Calculations");
    const graph = make.graph();
    const headings = groupingsBy(graph).get("headings");
    // "Ungrouped" stands where the model's sections have it: after the headings the graph names.
    expect([headings?.groups, groupsOf(graph, headings), headings?.source]).toEqual([["01: Inputs", "02: Calculations", "Ungrouped"],
      [["Scratch Pad", "Ungrouped"], ["INP01 - Volumes", "01: Inputs"], ["CAL01 - Revenue", "02: Calculations"]], "from heading rows"]);
    const loose = new GraphMaker();
    loose.module("Scratch Pad");
    expect(groupingsBy(loose.graph()).has("headings")).toBe(false);
  });

  it("takes the code a module's name starts with: up to a space, an underscore, a dash, a dot, a colon or a bracket, its last digits left off where letters lead", () => {
    expect(["INP01 Sales", "FIN03", "REP_Sales", "SYS-01 Time", "1.2 Revenue", "01 Data Hub", "Sales Forecast", "A1B2 Mix", "OUT.Board", "DAT:Products", "(Old) Rates", " CAL02  Costs ", ""].map(leadingCode))
      .toEqual(["INP", "FIN", "REP", "SYS", "1", "01", "Sales", "A1B", "OUT", "DAT", "", "CAL", ""]);
  });

  it("learns name prefixes from the model: a code enough modules share is a group, whatever its case, and every other module is under Other", () => {
    const make = new GraphMaker();
    for (const name of ["INP01 Volumes", "INP02 Prices", "inp03 Rates", "CAL01 Revenue", "CAL02 Costs", "CAL03 Margin", "REP01 Board", "REP02 Summary", "Scratch", "(Old) Rates"]) make.module(name);
    const graph = make.graph();
    const prefix = groupingsBy(graph).get("prefix");
    // Three share INP and three CAL; two REP are too few, and the rest share nothing. A group is named as its first module
    // writes the code.
    expect([prefix?.groups, groupsOf(graph, prefix).map(([, group]) => group), prefix?.source, prefix?.rest])
      .toEqual([["INP", "CAL", "Other"], ["INP", "INP", "INP", "CAL", "CAL", "CAL", "Other", "Other", "Other", "Other"], "from module names", "Other"]);
    // Among 200 modules a group needs one in fifty of them: four. Three that share a code are then too few.
    const many = new GraphMaker();
    for (let index = 0; index < 197; index++) many.module(`M${index} Module`);
    for (const name of ["ABC1 One", "ABC2 Two", "ABC3 Three"]) many.module(name);
    expect(groupingsBy(many.graph()).get("prefix")?.groups).toEqual(["M", "Other"]);
    // Names that share no code give no grouping at all.
    const none = new GraphMaker();
    for (const name of ["Volumes", "Prices", "Rates"]) none.module(name);
    expect(groupingsBy(none.graph()).has("prefix")).toBe(false);
  });

  it("works out each module's role in the data flow from what the model does with it, never from its name, and says why", () => {
    const { graph, facts, settings, assumptions, workings, totals, feed, notes } = flowSample();
    const role = groupingsBy(graph).get("role");
    expect(role?.groups).toEqual(["Data", "Input", "System", "Calculation", "Output", "No line items"]);
    expect([facts, settings, assumptions, workings, totals, feed, notes].map(id => [graph.nodes[id].name, role?.groupOf.get(id), role?.whyOf?.get(id)])).toEqual([
      ["Revenue Facts", "Data", "Data: An import loads into it, and 2 of its 2 line items have no formula."],
      ["Settings", "System", "System: 3 other modules read it, and it applies to no list."],
      ["CAL99 Assumptions", "Input", "Input: 2 of its 2 line items have no formula, and no import loads into it."],
      ["Workings", "Calculation", "Calculation: 2 of its 2 line items have a formula, and another module reads it."],
      ["INP01 Totals", "Output", "Output: 1 of its 1 line item has a formula, and no other module reads it."],
      ["Feed", "Output", "Output: An export takes it."],
      ["Notes", "No line items", "No line items: Its line items are all headings, so nothing tells its role."],
    ]);
    expect([role?.source, role?.rest]).toEqual(["from the data flow", "No line items"]);
  });

  it("takes the first rule that holds for a role, and says where a page shows a module", () => {
    const flow = (over: Partial<Flow>): Flow => ({ items: 4, formulas: 0, headings: 0, readers: 0, imported: false, exported: false, lists: 1, onPage: false, ...over });
    // An import into a module that is mostly formulas does not make it Data: the formulas decide.
    expect(roleOf(flow({ imported: true, formulas: 3, readers: 1 })).role).toBe("Calculation");
    // Half its line items with a formula is no longer mostly without one.
    expect(roleOf(flow({ formulas: 2 })).role).toBe("Output");
    expect(roleOf(flow({ formulas: 1 })).role).toBe("Input");
    // Read by several, but by a list: no setting of the model as a whole.
    expect(roleOf(flow({ formulas: 4, readers: 5 })).role).toBe("Calculation");
    expect(roleOf(flow({ formulas: 4, readers: 3, lists: 0 })).role).toBe("System");
    expect(roleOf(flow({ formulas: 4, readers: 2, lists: 0 })).role).toBe("Calculation");
    // An export takes it, whatever reads it; but data loaded in and sent on stays Data.
    expect(roleOf(flow({ formulas: 4, readers: 9, exported: true })).role).toBe("Output");
    expect(roleOf(flow({ imported: true, exported: true })).role).toBe("Data");
    expect([roleOf(flow({ onPage: true })).why, roleOf(flow({ formulas: 4, onPage: true })).why]).toEqual([
      "4 of its 4 line items have no formula, and no import loads into it; a page shows it.", "4 of its 4 line items have a formula, and no other module reads it; a page shows it."]);
    expect(roleOf(flow({ items: 0 })).why).toBe("It has no line items, so nothing tells its role.");
  });

  it("groups modules by the app whose pages show them, only where the result has Module Usage", () => {
    const make = new GraphMaker();
    make.module("Volumes", undefined, { apps: ["Sales Planning"] });
    make.module("Prices", undefined, { apps: ["Sales Planning", "Pricing"] });
    make.module("Workings");
    make.module("Rates", undefined, { apps: ["Pricing"] });
    const graph = make.graph();
    expect(groupingsBy(graph).has("app")).toBe(false);
    const app = groupingsBy({ ...graph, moduleFacts: { functionalAreas: false, moduleUsage: true } }).get("app");
    expect([app?.groups, groupsOf(graph, app), app?.source]).toEqual([["Sales Planning", "Pricing", "Several apps", "Not on any page"],
      [["Volumes", "Sales Planning"], ["Prices", "Several apps"], ["Workings", "Not on any page"], ["Rates", "Pricing"]], "from Module Usage"]);
  });

  it("groups modules by the first list they apply to: a subset as its list, and those with no list by whether they have time", () => {
    const make = new GraphMaker();
    const products = make.list("Products");
    const regions = make.list("Regions");
    const north = make.subset(regions, "Northern Regions");
    make.module("Volumes", undefined, { dimensions: [products, regions], timeScale: "Month" });
    make.module("Targets", undefined, { dimensions: [north], timeScale: "Month" });
    make.module("Calendar", undefined, { timeScale: "Month" });
    make.module("Settings", undefined, { timeScale: "Not Applicable" });
    make.module("Prices", undefined, { dimensions: [products] });
    const graph = make.graph();
    const dimension = groupingsBy(graph).get("dimension");
    expect([dimension?.groups, groupsOf(graph, dimension), dimension?.source]).toEqual([["Products", "Regions", "Time only", "No dimensions"],
      [["Volumes", "Products"], ["Targets", "Regions"], ["Calendar", "Time only"], ["Settings", "No dimensions"], ["Prices", "Products"]], "from Applies To"]);
    const flat = new GraphMaker();
    flat.module("Settings");
    expect(groupingsBy(flat.graph()).has("dimension")).toBe(false);
  });

  it("offers the groupings a model has in the switch's order, and none for a model without modules", () => {
    const make = new GraphMaker();
    const products = make.list("Products");
    for (const [index, name] of ["INP01 Volumes", "INP02 Prices", "INP03 Rates"].entries()) make.module(name, `${index}`, { functionalArea: "Sales", dimensions: [products] });
    const graph: ModelGraph = { ...make.graph(), moduleFacts: { functionalAreas: true, moduleUsage: true } };
    expect(groupingsOf(indexModel(graph)).map(grouping => [grouping.kind, grouping.label])).toEqual([["functionalArea", "Functional area"], ["headings", "Headings"],
      ["prefix", "Name prefix"], ["role", "Role in the data flow"], ["app", "App"], ["dimension", "Main dimension"]]);
    expect(groupingsOf(indexModel(new GraphMaker().graph()))).toEqual([]);
  });
});

describe("The grouping the map picks by itself", () => {
  /** A grouping of `sizes` modules in its groups, the last of them its group of what it cannot place where `rest`. */
  const sized = (kind: GroupingKind, sizes: number[], rest = false): Grouping => {
    const groupOf = new Map<number, string>();
    let id = 0;
    sizes.forEach((size, index) => { for (let count = 0; count < size; count++) groupOf.set(id++, `G${index}`); });
    return { kind, label: kind, source: kind, groups: sizes.map((_, index) => `G${index}`), groupOf, ...(rest ? { rest: `G${sizes.length - 1}` } : {}) };
  };

  it("takes a grouping for good with 3 to 15 groups, none with more than half the modules, and no more than a fifth it cannot place", () => {
    expect(GOOD).toEqual({ least: 3, most: 15, largest: 0.5, rest: 0.2 });
    expect([sized("prefix", [4, 3, 3]), sized("prefix", [5, 5]), sized("prefix", Array.from({ length: 15 }, () => 2)), sized("prefix", Array.from({ length: 16 }, () => 2))].map(isGood))
      .toEqual([true, false, true, false]);
    // Half the modules in one group is still good; more is not.
    expect([sized("prefix", [5, 3, 2]), sized("prefix", [6, 2, 2])].map(isGood)).toEqual([true, false]);
    // Two of ten that the grouping cannot place are a fifth; three are more.
    expect([sized("prefix", [4, 4, 2], true), sized("prefix", [4, 3, 3], true), sized("prefix", [4, 4, 2])].map(isGood)).toEqual([true, false, true]);
    expect(isGood({ kind: "role", label: "", source: "", groups: [], groupOf: new Map() })).toBe(false);
  });

  it("takes a grouping of the builders' for the map's own where it files most modules, in two groups or more, however many and however large", () => {
    expect(BUILT).toEqual({ share: 0.6, least: 2 });
    // Twenty areas of one module each, and one area that holds nearly all: both are the builders' own.
    expect([sized("functionalArea", Array.from({ length: 20 }, () => 1)), sized("functionalArea", [9, 1]), sized("functionalArea", [90, 5, 5])].map(isBuilt)).toEqual([true, true, true]);
    // Six of ten in the areas is most; five is not. The group of what it cannot place is no area.
    expect([sized("functionalArea", [3, 3, 4], true), sized("functionalArea", [3, 2, 5], true)].map(isBuilt)).toEqual([true, false]);
    // Every module in one area, or in one and the rest, files nothing apart.
    expect([sized("functionalArea", [10]), sized("functionalArea", [8, 2], true)].map(isBuilt)).toEqual([false, false]);
    expect(isBuilt({ kind: "headings", label: "", source: "", groups: [], groupOf: new Map() })).toBe(false);
  });

  it("opens on the functional areas or the heading rows where the builders filed most modules by them, then on name prefixes that are good, and otherwise on the role in the data flow", () => {
    const good = [3, 3, 4];
    const many = Array.from({ length: 22 }, () => 2);
    const pick = (...groupings: Grouping[]): GroupingKind | undefined => automaticGrouping(groupings)?.kind;
    expect(pick(sized("functionalArea", good), sized("headings", good), sized("prefix", good), sized("role", good))).toBe("functionalArea");
    // Twenty-two areas are more than a learnt grouping could have, and one area of nine modules beside one of a single
    // module is lopsided: both are still the builders' own, and the map opens on them.
    expect(pick(sized("functionalArea", many), sized("headings", good), sized("prefix", good), sized("role", good))).toBe("functionalArea");
    expect(pick(sized("functionalArea", [9, 1]), sized("headings", good), sized("prefix", good), sized("role", good))).toBe("functionalArea");
    // Areas on half the modules only: the headings, however many.
    expect(pick(sized("functionalArea", [2, 3, 5], true), sized("headings", many), sized("prefix", good), sized("role", good))).toBe("headings");
    // Neither filed most modules apart: the name prefixes where they are good, and the role in the data flow otherwise.
    expect(pick(sized("functionalArea", [10]), sized("headings", [8, 2], true), sized("prefix", good), sized("role", good))).toBe("prefix");
    expect(pick(sized("functionalArea", [10]), sized("prefix", [10]), sized("role", [10]), sized("app", good), sized("dimension", good))).toBe("role");
    // Prefixes are learnt: their own test holds them, however many modules they place.
    expect(pick(sized("prefix", many), sized("role", good))).toBe("role");
    // App and main dimension are never picked, but where they are all there is.
    expect(pick(sized("app", good))).toBe("app");
    expect(pick()).toBeUndefined();
  });

  it("picks for a real model: functional areas where its builders set them, else headings, else shared codes, else roles", () => {
    const named = (names: string[], extra: (index: number) => object = () => ({})): ModelGraph => {
      const make = new GraphMaker();
      names.forEach((name, index) => make.item(make.module(name, undefined, extra(index)), "Value"));
      return make.graph();
    };
    const codes = ["INP01 A", "INP02 B", "INP03 C", "CAL01 D", "CAL02 E", "CAL03 F", "REP01 G", "REP02 H", "REP03 I", "Other J"];
    const automatic = (graph: ModelGraph): GroupingKind | undefined => automaticGrouping(groupingsOf(indexModel(graph)))?.kind;
    expect(automatic(named(codes, index => ({ functionalArea: ["Sales", "Finance", "Workforce"][index % 3] })))).toBe("functionalArea");
    // A model whose builders keep 22 functional areas opens on them, as one with three does.
    const areas = Array.from({ length: 44 }, (_, index) => `M${index} Module`);
    expect(automatic(named(areas, index => ({ functionalArea: `${String(Math.floor(index / 2)).padStart(3, "0")}: Area` })))).toBe("functionalArea");
    // And one whose builders head 22 groups of modules opens on the heading rows.
    const headed = new GraphMaker();
    areas.forEach((name, index) => headed.item(headed.module(name, `${Math.floor(index / 2)}: Group`), "Value"));
    expect(automatic(headed.graph())).toBe("headings");
    const make = new GraphMaker();
    codes.forEach((name, index) => make.module(name, ["01 Data", "02 Inputs", "03 Reports"][index % 3]));
    expect(automatic(make.graph())).toBe("headings");
    expect(automatic(named(codes))).toBe("prefix");
    expect(automatic(named(["Volumes", "Prices", "Rates", "Margin"]))).toBe("role");
  });
});

describe("The model with its modules grouped", () => {
  it("files modules and their line items by the grouping, keeps a list's heading, and leaves the model it came from as it was", () => {
    const { graph, facts, settings } = flowSample();
    const base = indexModel(graph);
    const role = groupingsOf(base).find(grouping => grouping.kind === "role")!;
    const model = withGrouping(base, role);
    const units = graph.nodes.find(node => node.name === "Units")!;
    const products = graph.nodes.find(node => node.name === "Products")!;
    expect([model.sections, model.sectionOf(graph.nodes[facts]), model.sectionOf(units), model.sectionIndex("System"), model.sectionIndex("Nowhere"), model.grouping === role])
      .toEqual([["Data", "Input", "System", "Calculation", "Output", "No line items"], "Data", "Data", 2, -1, true]);
    expect(model.sectionOf(products)).toBe(base.sectionOf(products));
    expect([base.sections, base.sectionOf(graph.nodes[settings]), base.grouping]).toEqual([["Ungrouped"], "Ungrouped", undefined]);
    expect([model.modules, model.lineItems, model.formulaEdges]).toEqual([base.modules, base.lineItems, base.formulaEdges]);
  });
});
