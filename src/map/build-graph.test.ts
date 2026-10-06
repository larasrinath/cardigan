import { describe, expect, it } from "vitest";
import type { Cell, ResultTable } from "../result-types.js";
import { buildModelGraph } from "./build-graph.js";
import { definitionOf, idOf, integer, knownSequence, separator, splitOutside, stripChars, unquote } from "./graph-names.js";
import type { EdgeKind, GraphNode, ModelGraph } from "./graph-types.js";

// Made-up names only: nothing here comes from a real model. The tables are written by hand in the shape of the export's
// files (model/export.ts): the unnamed first column with each row's name, then the grid's columns under Anaplan's own
// headers. Line Items has the headers a real model's file has, in its order (results/line-items-view.test.ts), and the
// two files of actions those of Anaplan's own Actions list and Imports tab (model/model.test.ts). General Lists has the
// columns the prototype read from Anaplan's own export of that grid, in an order made up here, and one the map does not read.
const LINE_HEADERS = ["", "Format", "Formula", "Summary", "Applies To", "Time Scale", "Time Range", "Versions", "Style", "Cell Count", "Calculation Effort", "Notes",
  "Read Access Driver", "Write Access Driver", "Users List", "Parent", "Is Summary", "Formula Scope", "Code", "Use Switchover", "Breakback", "Brought-Forward", "Start of Section",
  "Data Tags", "Referenced By", "Module Name", "Ratio Numerator", "Ratio Denominator", "Format List"];
const LIST_HEADERS = ["", "Parent Hierarchy", "Top Level", "Numbered", "Display Name Property", "Item Count", "Properties", "Subsets", "Production Data", "Referenced in Applies To",
  "Referenced as Format", "Referenced in Formula", "Notes"];
const MODULE_HEADERS = ["", "Applies To", "Cell Count"];
const ACTION_HEADERS = ["", "Action", "Start Date and Time (UTC)", "Most recent duration (ms)", "Notes", "Used in Processes", "Used in Dashboards"];
const IMPORT_HEADERS = ["", "Source Label", "Source Object", "Source Type", "Target Object", "Target Type", "Production Data", "Start Date and Time (UTC)", "Most recent duration (ms)", "Notes",
  "Used in Processes", "Used in Dashboards"];

/** A row's cells by their headers ("" is the row's name): every other cell is empty. */
type Cells = Record<string, Cell>;
const file = (label: string, headers: readonly string[], rows: Cell[][]): ResultTable => ({ file: `${label}.csv`, label, headers: [...headers], rows, guard: false });
const filled = (label: string, headers: readonly string[]) => (...rows: Cells[]): ResultTable =>
  file(label, headers, rows.map(cells => headers.map(header => (Object.hasOwn(cells, header) ? cells[header] : ""))));
const lineItems = filled("Line Items", LINE_HEADERS);
const generalLists = filled("General Lists", LIST_HEADERS);
const modulesFile = (...names: string[]): ResultTable => file("Modules", MODULE_HEADERS, names.map(name => [name, "", ""]));
const processesFile = filled("Processes", ACTION_HEADERS);
const importsFile = filled("Imports", IMPORT_HEADERS);
const exportsFile = filled("Exports", ACTION_HEADERS);
const otherActions = filled("Other Actions", ACTION_HEADERS);

const NUMBER = '{"minimumSignificantDigits":4,"decimalPlaces":-1,"dataType":"NUMBER"}';
const BOOLEAN = '{"dataType":"BOOLEAN"}';
const NO_DATA = '{"dataType":"NONE"}';
const SUM = '{"summaryMethod":"SUM","timeSummaryMethod":"SUM"}';
const NO_SUMMARY = '{"summaryMethod":"NONE","timeSummaryMethod":"NONE"}';
/** A list format, as a line item's Format holds it: the list by its ID. */
const listFormat = (id: number | string): string => JSON.stringify({ hierarchyEntityLongId: id, entityFormatFilter: null, selectiveAccessApplied: false, showAll: false, dataType: "ENTITY" });

/** A heading row: a name, and nothing else. */
const heading = (name: string): Cells => ({ "": name });
const list = (name: string, cells: Cells = {}): Cells => ({ "": name, Numbered: "false", "Production Data": "false", ...cells });
/** A module's own row: it names no module, and has no format, no formula and no summary. */
const moduleRow = (name: string, cells: Cells = {}): Cells => ({ "": name, ...cells });
/** A line item's row: a number that is summed, with its module's dimensions and no access driver, unless the cells say otherwise. */
const item = (inModule: string, name: string, cells: Cells = {}): Cells => ({ "": name, "Module Name": inModule, Format: NUMBER, Summary: SUM, "Applies To": "-", ...cells });
const action = (name: string, cells: Cells = {}): Cells => ({ "": name, ...cells });

/** What the map always says: what no export says, word for word. */
const STANDING = [
  "The export gives the number of items in each list, not the items.",
  "The export says which processes use an action, not the order in which a process runs its actions.",
  "Every link comes from a column of the export that names another object: formulas are kept as text and are not worked out.",
];
const IMPORT_SOURCES = "Where an import takes its data from is in the Imports table, not on the map.";
const NO_MODULES_FILE = "Modules was not exported, so a row of Line Items that holds only a name is taken for a module's own row.";
const NOT_EXPORTED = {
  lists: "General Lists was not exported: the map has no lists, no list subsets and no list properties.",
  lineItems: "Line Items was not exported: the map has no modules and no line items.",
  processes: "Processes was not exported: the map has no processes.",
  imports: "Imports was not exported: the map has no imports.",
  exports: "Exports was not exported: the map has no exports.",
  otherActions: "Other Actions was not exported: the map has none of the model's other actions.",
};
const NO_ACTIONS = [NOT_EXPORTED.processes, NOT_EXPORTED.imports, NOT_EXPORTED.exports, NOT_EXPORTED.otherActions];

/** A node as a reference would name it: a line item behind its module, a list's property behind its list. */
const called = (graph: ModelGraph, id: number): string => {
  const node = graph.nodes[id];
  return node.kind === "lineItem" ? `${graph.nodes[node.module!].name}.${node.name}` : node.kind === "property" ? `${graph.nodes[node.parent!].name}.${node.name}` : node.name;
};
/** In any order: what a test lists by hand need not follow the nodes' numbers. */
const anyOrder = (lines: readonly string[]): string[] => [...lines].sort();
/** The graph's links in words, in any order; of these kinds only, where kinds are given. */
const links = (graph: ModelGraph, ...kinds: EdgeKind[]): string[] =>
  anyOrder(graph.edges.filter(([, , kind]) => !kinds.length || kinds.includes(kind)).map(([from, to, kind]) => `${called(graph, from)} -> ${called(graph, to)} (${kind})`));
const unresolved = (graph: ModelGraph): string[] => graph.unresolved.map(entry => `${called(graph, entry.source)}: ${entry.field}: ${entry.reference}`);
const node = (graph: ModelGraph, name: string, kind?: GraphNode["kind"]): GraphNode => {
  const found = graph.nodes.filter(candidate => candidate.name === name && (kind === undefined || candidate.kind === kind));
  expect(found.map(candidate => candidate.kind), name).toHaveLength(1);
  return found[0];
};
const names = (graph: ModelGraph, ids: readonly number[] | undefined): string[] | undefined => ids?.map(id => called(graph, id));

describe("The names in a cell of a model export", () => {
  it("takes a row for a heading when its name starts with two dashes or is nothing but spaces, dots and dashes", () => {
    for (const name of ["-- MODEL ADMIN", "--- 01 : INPUTS ---", "--", "------", "-", "", " ", ". . . .", "- - -", " .-. "]) expect(separator(name), JSON.stringify(name)).toBe(true);
    // One dash and a name is a name, and so is a row of other strokes.
    for (const name of ["Revenue", "- Notes", "REV01 -- Revenue", " -- Indented", "======", "\u2014\u2014 Inputs \u2014\u2014", "_____"]) expect(separator(name), JSON.stringify(name)).toBe(false);
    expect([stripChars("-- 01 : INPUTS --", " -"), stripChars("------", " -"), stripChars("_101000000007_", "_"), stripChars("a-b", "-"), stripChars("", "-")])
      .toEqual(["01 : INPUTS", "", "101000000007", "a-b", ""]);
  });

  it("takes a name out of its single quotes, where two single quotes are one of the name's own", () => {
    expect(["Revenue", "'REV01 Revenue, net'", "'It''s a ''plan'''", " 'Padded' ", "''", "'a'b'"].map(unquote)).toEqual(["Revenue", "REV01 Revenue, net", "It's a 'plan'", "Padded", "", "a'b"]);
    // A quote at one end only is part of the name, and one quote alone is a name.
    expect(["'Unclosed", "Closed only'", "'", "It's"].map(unquote)).toEqual(["'Unclosed", "Closed only'", "'", "It's"]);
  });

  it("splits a cell of names only outside single quotes, and leaves out an empty part and a dash", () => {
    expect(splitOutside("Products, 'Regions, north & south',Channels")).toEqual(["Products", "'Regions, north & south'", "Channels"]);
    // Two single quotes inside a quoted name end nothing: the comma after them is still inside.
    expect(splitOutside("'It''s, here', 'O''Brien''s', x")).toEqual(["'It''s, here'", "'O''Brien''s'", "x"]);
    expect([splitOutside(""), splitOutside("-"), splitOutside(" - ,, -, Products , ")]).toEqual([[], [], ["Products"]]);
    // A quote that is never closed keeps the rest of the cell together.
    expect(splitOutside("Products, 'Regions, north, Channels")).toEqual(["Products", "'Regions, north, Channels"]);
    // A line item behind its module: the same split at a dot, where a dot inside quotes is part of a name.
    expect(splitOutside("'Plan v1.2'.'Rate, net (50%)'", ".")).toEqual(["'Plan v1.2'", "'Rate, net (50%)'"]);
    expect([splitOutside("REV01 Revenue.Units", "."), splitOutside("Units", "."), splitOutside("A..B", "."), splitOutside("A.-", "."), splitOutside(".", ".")])
      .toEqual([["REV01 Revenue", "Units"], ["Units"], ["A", "B"], ["A"], []]);
  });

  it("finds the known names in a cell that writes them without quotes, the longest first, and takes what is left for names as written", () => {
    const known = new Set(["Nightly load", "Nightly load, full", "Weekly"]);
    const longest = "Nightly load, full".length;
    const sequence = (text: string): string[] => knownSequence(text, known, longest);
    expect(sequence("Nightly load, Nightly load, full, Weekly")).toEqual(["Nightly load", "Nightly load, full", "Weekly"]);
    expect([sequence("Nightly load, full"), sequence("Nightly load"), sequence(" Weekly "), sequence("")]).toEqual([["Nightly load, full"], ["Nightly load"], ["Weekly"], []]);
    // A name that is not known ends at the next comma and space, and is given as it is written.
    expect(sequence("Gone, Weekly, Old, load")).toEqual(["Gone", "Weekly", "Old", "load"]);
    // A known name counts only where it ends at the cell's end or before a comma and a space.
    expect([sequence("Weekly load"), sequence("Weekly,Nightly load"), sequence("Weekly,  Weekly")]).toEqual([["Weekly load"], ["Weekly,Nightly load"], ["Weekly", "Weekly"]]);
    // Without known names every part is a name as written, and an empty part is one too: the caller finds it matches nothing.
    expect(knownSequence("a, , b", new Set(), 0)).toEqual(["a", "", "b"]);
  });

  it("reads a count, a definition and an ID, and nothing from a cell that holds none", () => {
    expect(["12", "1,234,567", " 40 ", "-3", "+7", "0", "-0"].map(integer)).toEqual([12, 1234567, 40, -3, 7, 0, 0]);
    expect(["", "12.5", "n/a", "1e3", "12 cells", "9007199254740993"].map(integer)).toEqual([undefined, undefined, undefined, undefined, undefined, undefined]);
    expect([definitionOf('{"dataType":"NUMBER"}'), definitionOf(' {"a":{"b":1}}')]).toEqual([{ dataType: "NUMBER" }, { a: { b: 1 } }]);
    // JSON that is no object is no definition, and neither is text that only starts as one.
    for (const text of ["", "Number", "[1,2]", '"TEXT"', "42", "null", "true", '{"dataType":"NUMB', "{not json}"]) expect(definitionOf(text), text).toBeUndefined();
    expect([101000000007, "101000000007", "_101000000007_"].map(idOf)).toEqual(["101000000007", "101000000007", "101000000007"]);
    for (const value of [-1, 1.5, 2 ** 60, "Products", "", " 101000000007 ", null, undefined, [101000000007], {}]) expect(idOf(value), JSON.stringify(value)).toBeUndefined();
  });
});

describe("The model map's graph, from the tables of a model export", () => {
  it("makes a list, its subsets and its properties from General Lists, under the heading rows above them", () => {
    const graph = buildModelGraph([generalLists(
      heading("-- ORGANISATION --"),
      list("Regions", { "Top Level": "All Regions", "Item Count": "12", Subsets: "Active Regions, 'North, coastal'", Properties: "Code: TEXT, Manager: Users, Opened: Date: DATE, Odd",
        Notes: "Sales regions" }),
      list("Countries", { "Parent Hierarchy": "Regions", "Item Count": "1,204" }),
      list("Outlets", { "Parent Hierarchy": "Active Regions", "Item Count": "0" }),
      heading("--- Products"),
      list("Products", { "Top Level": "All Products", "Item Count": "n/a" }),
      list("Orders", { Numbered: "true", "Display Name Property": "Label", Properties: "Label: TEXT", "Parent Hierarchy": "Tastes" }),
    )]);
    const from = { file: "General Lists" };
    // The lists in the file's order, each with its row counted from 1, heading rows included. Then each list's subsets and
    // properties, which carry their list's row and group. A subset is named as the cell writes it, quotes and all; a
    // property's name ends at the last colon that a space follows; "Odd" names no format and is no property.
    expect(graph.nodes).toEqual([
      { id: 0, kind: "list", name: "Regions", ...from, row: 2, group: "ORGANISATION", topLevel: "All Regions", count: 12, numbered: false, notes: "Sales regions" },
      { id: 1, kind: "list", name: "Countries", ...from, row: 3, group: "ORGANISATION", count: 1204, numbered: false, parent: 0 },
      { id: 2, kind: "list", name: "Outlets", ...from, row: 4, group: "ORGANISATION", count: 0, numbered: false, parent: 5 },
      { id: 3, kind: "list", name: "Products", ...from, row: 6, group: "Products", topLevel: "All Products", numbered: false },
      { id: 4, kind: "list", name: "Orders", ...from, row: 7, group: "Products", numbered: true, displayName: "Label" },
      { id: 5, kind: "subset", name: "Active Regions", ...from, row: 2, group: "ORGANISATION", parent: 0 },
      { id: 6, kind: "subset", name: "'North, coastal'", ...from, row: 2, group: "ORGANISATION", parent: 0 },
      { id: 7, kind: "property", name: "Code", ...from, row: 2, group: "ORGANISATION", parent: 0, format: "TEXT" },
      { id: 8, kind: "property", name: "Manager", ...from, row: 2, group: "ORGANISATION", parent: 0, format: "Users" },
      { id: 9, kind: "property", name: "Opened: Date", ...from, row: 2, group: "ORGANISATION", parent: 0, format: "DATE" },
      { id: 10, kind: "property", name: "Label", ...from, row: 7, group: "Products", parent: 4, format: "TEXT" },
    ]);
    // A list's parent is a list or a subset; one that is neither is a name that matched nothing.
    expect(graph.edges).toEqual([[0, 1, "parent"], [0, 5, "subset"], [0, 6, "subset"], [5, 2, "parent"]]);
    expect(graph.unresolved).toEqual([{ source: 4, field: "Parent Hierarchy", reference: "Tastes" }]);
    // The sections are the modules', and there is no module.
    expect(graph.sections).toEqual([]);
  });

  it("links a list to what its three Referenced columns name: a module, a line item or a list's property", () => {
    const graph = buildModelGraph([
      lineItems(
        moduleRow("REV01 Revenue", { "Applies To": "Products" }),
        item("REV01 Revenue", "Product", { Format: listFormat(101000000001) }),
        item("REV01 Revenue", "Units"),
        moduleRow("COST01 Costs, direct"),
        item("COST01 Costs, direct", "Rate", { "Applies To": "Products" })),
      generalLists(
        list("Products", { "Referenced in Applies To": "REV01 Revenue, 'COST01 Costs, direct'.Rate, Old module", "Referenced as Format": "REV01 Revenue.Product, Customers.Favourite",
          "Referenced in Formula": "REV01 Revenue.Units, REV01 Revenue.'Gone item'" }),
        list("Customers", { Properties: "Favourite: Products" })),
    ]);
    expect(links(graph)).toEqual(anyOrder([
      // What the list's own columns name. The module's Applies To says the first of these too: it is one link.
      "Products -> REV01 Revenue (applies)", "Products -> COST01 Costs, direct.Rate (applies)",
      "Products -> REV01 Revenue.Product (format)", "Products -> Customers.Favourite (format)",
      "Products -> REV01 Revenue.Units (list_formula)",
      // And the two line items that have their module's dimensions.
      "Products -> REV01 Revenue.Product (applies)", "Products -> REV01 Revenue.Units (applies)",
    ]));
    expect(links(graph)).toHaveLength(7);
    expect(unresolved(graph)).toEqual(["Products: Referenced in Applies To: Old module", "Products: Referenced in Formula: REV01 Revenue.'Gone item'"]);
    // The list's Referenced as Format names the line item, so the line item's list is known.
    expect(node(graph, "Product").formatList).toBe(node(graph, "Products").id);
  });

  it("takes a row of Line Items that names no module for a heading or a module, and a row that names one for its line item", () => {
    const graph = buildModelGraph([lineItems(
      moduleRow("SYS00 Settings", { "Time Scale": "Not Applicable", Versions: "Not Applicable", "Cell Count": "3", Notes: "Model settings" }),
      item("SYS00 Settings", "Horizon", { Summary: NO_SUMMARY, "Cell Count": "3", Code: "H1", Style: "Normal", Notes: "Years planned", "Time Scale": "Not Applicable", Versions: "Not Applicable" }),
      heading("-- 01 : REVENUE --"),
      moduleRow("REV01 Revenue", { "Time Scale": "Month", "Time Range": "Model Calendar", Versions: "All", "Cell Count": "2,400" }),
      item("REV01 Revenue", "Revenue", { Formula: "Units * Price", "Cell Count": "1200", "Time Scale": "Month", Versions: "All" }),
      // A line item that divides its module's line items is a line item: it names its module.
      item("REV01 Revenue", "--- Checks ---", { Format: NO_DATA, Summary: NO_SUMMARY, Style: "Heading 1" }),
      heading("------"),
      moduleRow("REV02 Margin"),
      heading("-- 02 : COSTS --"),
      moduleRow("COST01 Costs"),
      heading("-- 03 : ARCHIVE --"),
    )]);
    const from = { file: "Line Items" };
    expect(graph.nodes).toEqual([
      { id: 0, kind: "module", name: "SYS00 Settings", ...from, row: 1, group: "Ungrouped", notes: "Model settings", cells: 3, timeScale: "Not Applicable", versions: "Not Applicable" },
      { id: 1, kind: "lineItem", name: "Horizon", ...from, row: 2, module: 0, group: "Ungrouped", format: "NUMBER", cells: 3, notes: "Years planned", style: "Normal",
        timeScale: "Not Applicable", versions: "Not Applicable", code: "H1", summary: "NONE", inheritsDimensions: true },
      { id: 2, kind: "module", name: "REV01 Revenue", ...from, row: 4, group: "01 : REVENUE", cells: 2400, timeScale: "Month", timeRange: "Model Calendar", versions: "All" },
      { id: 3, kind: "lineItem", name: "Revenue", ...from, row: 5, module: 2, group: "01 : REVENUE", formula: "Units * Price", format: "NUMBER", cells: 1200, timeScale: "Month",
        versions: "All", summary: "SUM", inheritsDimensions: true },
      { id: 4, kind: "lineItem", name: "--- Checks ---", ...from, row: 6, module: 2, group: "01 : REVENUE", format: "NONE", style: "Heading 1", summary: "NONE", inheritsDimensions: true },
      // A heading of nothing but dashes ends the group above it and names none.
      { id: 5, kind: "module", name: "REV02 Margin", ...from, row: 8, group: "Ungrouped" },
      { id: 6, kind: "module", name: "COST01 Costs", ...from, row: 10, group: "02 : COSTS" },
    ]);
    // The groups that a module is in, in the file's order, each once. A heading with no module under it is no section.
    expect(graph.sections).toEqual(["Ungrouped", "01 : REVENUE", "02 : COSTS"]);
    expect([graph.edges, graph.unresolved]).toEqual([[], []]);
  });

  it("reads a line item's format and summary from the cell's JSON, and keeps a Format that is no JSON as it is", () => {
    const formats: [cell: string, format: string | undefined][] = [
      [NUMBER, "NUMBER"], [NO_DATA, "NONE"], [listFormat(101000000007), "ENTITY"], ['{"periodType":{"entityId":"MONTH","entityLabel":"Month"},"dataType":"TIME_ENTITY"}', "TIME_ENTITY"],
      // No JSON, JSON that is cut short, JSON that is no object, and an object that names no data type: the cell as it is.
      ["Number", "Number"], ['{"dataType":"NUMB', '{"dataType":"NUMB'], ["[1,2]", "[1,2]"], ['"TEXT"', '"TEXT"'], ["42", "42"], ["null", "null"], ['{"other":1}', '{"other":1}'],
      ['{"dataType":7}', '{"dataType":7}'],
      // Nothing to say: an empty cell, and a data type that is null or empty.
      ["", undefined], ['{"dataType":null}', undefined], ['{"dataType":""}', undefined],
    ];
    const summaries: [cell: string, summary: string | undefined][] = [
      [SUM, "SUM"], ['{"summaryMethod":"RATIO","ratioNumeratorIdentifier":"_1901000000002_"}', "RATIO"],
      ["Sum", undefined], ["", undefined], ['{"timeSummaryMethod":"SUM"}', undefined], ['{"summaryMethod":null}', undefined], ['{"summaryMethod":["SUM"]}', undefined], ["[]", undefined],
    ];
    const graph = buildModelGraph([lineItems(moduleRow("REV01 Revenue"),
      ...formats.map(([cell], index) => item("REV01 Revenue", `Format ${index}`, { Format: cell })),
      ...summaries.map(([cell], index) => item("REV01 Revenue", `Summary ${index}`, { Summary: cell })))]);
    expect(formats.map((_, index) => node(graph, `Format ${index}`).format)).toEqual(formats.map(([, format]) => format));
    expect(summaries.map((_, index) => node(graph, `Summary ${index}`).summary)).toEqual(summaries.map(([, summary]) => summary));
    // A detail that says nothing is not on the node at all.
    expect(Object.keys(node(graph, "Format 12"))).toEqual(["id", "kind", "name", "file", "row", "module", "group", "summary", "inheritsDimensions"]);
    expect("format" in node(graph, "Format 13") || "summary" in node(graph, "Summary 2")).toBe(false);
  });

  it("gives a line item with a dash under Applies To its module's dimensions, and says that they are the module's", () => {
    const graph = buildModelGraph([
      lineItems(
        moduleRow("REV01 Revenue", { "Applies To": "Products, 'Regions, north', Users" }),
        item("REV01 Revenue", "Units"),
        item("REV01 Revenue", "Price", { "Applies To": "Products" }),
        item("REV01 Revenue", "Rate", { "Applies To": "" }),
        item("REV01 Revenue", "Core flag", { "Applies To": "Core Products" }),
        moduleRow("SYS00 Settings"),
        item("SYS00 Settings", "Horizon")),
      generalLists(list("Products", { Subsets: "Core Products" }), list("Regions, north")),
    ]);
    const dimensions = (name: string) => [names(graph, node(graph, name).dimensions), node(graph, name).inheritsDimensions];
    expect(dimensions("REV01 Revenue")).toEqual([["Products", "Regions, north"], undefined]);
    // The module's, in the module's order.
    expect(dimensions("Units")).toEqual([["Products", "Regions, north"], true]);
    // Its own: a list, a subset, or none at all, which an empty cell says and a dash does not.
    expect([dimensions("Price"), dimensions("Core flag"), dimensions("Rate")]).toEqual([[["Products"], undefined], [["Core Products"], undefined], [undefined, undefined]]);
    // A module without dimensions gives none, and the line item still has its module's.
    expect([dimensions("SYS00 Settings"), dimensions("Horizon")]).toEqual([[undefined, undefined], [undefined, true]]);
    expect(links(graph, "applies")).toEqual(anyOrder([
      "Products -> REV01 Revenue (applies)", "Regions, north -> REV01 Revenue (applies)", "Products -> REV01 Revenue.Units (applies)", "Regions, north -> REV01 Revenue.Units (applies)",
      "Products -> REV01 Revenue.Price (applies)", "Core Products -> REV01 Revenue.Core flag (applies)"]));
    // A dimension that is no list of General Lists is unresolved for the module, and for each line item that has the module's.
    expect(unresolved(graph)).toEqual(["REV01 Revenue: Applies To: Users", "REV01 Revenue.Units: Applies To: Users"]);
  });

  it("links what drives who may read and write a module or a line item, and gives a line item with a dash its module's driver", () => {
    const graph = buildModelGraph([lineItems(
      moduleRow("ACC01 Access"),
      item("ACC01 Access", "Can read", { Format: BOOLEAN }),
      item("ACC01 Access", "Can write", { Format: BOOLEAN }),
      moduleRow("REV01 Revenue", { "Read Access Driver": "'ACC01 Access'.Can read" }),
      item("REV01 Revenue", "Units", { "Read Access Driver": "-", "Write Access Driver": "ACC01 Access.Can write" }),
      // A bare name is a line item of the same module. The module has no write driver to give.
      item("REV01 Revenue", "Price", { "Read Access Driver": "Local flag", "Write Access Driver": "-" }),
      // An empty cell is no dash: nothing is taken from the module.
      item("REV01 Revenue", "Local flag", { Format: BOOLEAN }),
      item("REV01 Revenue", "Broken", { "Read Access Driver": "Gone.Driver" }),
    )]);
    expect(links(graph)).toEqual(anyOrder([
      "ACC01 Access.Can read -> REV01 Revenue (read_access)", "ACC01 Access.Can read -> REV01 Revenue.Units (read_access)",
      "ACC01 Access.Can write -> REV01 Revenue.Units (write_access)", "REV01 Revenue.Local flag -> REV01 Revenue.Price (read_access)"]));
    expect(unresolved(graph)).toEqual(["REV01 Revenue.Broken: Read Access Driver: Gone.Driver"]);
  });

  it("links a line item to what its Referenced By names, as a formula link, or as an access link where that one names it as its driver", () => {
    const graph = buildModelGraph([
      lineItems(
        moduleRow("REV01 Revenue"),
        item("REV01 Revenue", "Units", { "Referenced By": "Revenue, 'COST01 Costs'.Share", "Write Access Driver": "Open" }),
        item("REV01 Revenue", "Price", { "Referenced By": "Revenue" }),
        // A line item of another module, a list's property, a name that matches nothing, and a module by its bare name.
        item("REV01 Revenue", "Revenue", { "Referenced By": "'REP01 Report, monthly'.'Revenue, net', Customers.Spend, Gone.Item, 'REP01 Report, monthly'" }),
        // Units names it as its write driver and nothing more; Price's formula refers to it.
        item("REV01 Revenue", "Open", { Format: BOOLEAN, "Referenced By": "Units, Price" }),
        // A formula may refer to its own line item.
        item("REV01 Revenue", "Stock", { "Referenced By": "Stock, Stock" }),
        moduleRow("COST01 Costs"),
        item("COST01 Costs", "Share"),
        moduleRow("REP01 Report, monthly"),
        item("REP01 Report, monthly", "Revenue, net")),
      generalLists(list("Customers", { Properties: "Spend: NUMBER" })),
    ]);
    expect(links(graph)).toEqual(anyOrder([
      "REV01 Revenue.Units -> REV01 Revenue.Revenue (reference)", "REV01 Revenue.Units -> COST01 Costs.Share (reference)", "REV01 Revenue.Price -> REV01 Revenue.Revenue (reference)",
      "REV01 Revenue.Revenue -> REP01 Report, monthly.Revenue, net (reference)", "REV01 Revenue.Revenue -> Customers.Spend (reference)",
      "REV01 Revenue.Revenue -> REP01 Report, monthly (reference)",
      "REV01 Revenue.Open -> REV01 Revenue.Units (write_access)", "REV01 Revenue.Open -> REV01 Revenue.Price (reference)",
      "REV01 Revenue.Stock -> REV01 Revenue.Stock (reference)"]));
    expect(links(graph)).toHaveLength(9);
    expect(unresolved(graph)).toEqual(["REV01 Revenue.Revenue: Referenced By: Gone.Item"]);
  });

  it("reads the driver of what refers to a line item in that one's own module, and only from its own cell", () => {
    const graph = buildModelGraph([lineItems(
      moduleRow("ACC01 Access"),
      // Total's formula refers to this Flag. Total's driver is the Flag of its own module, which is another line item.
      item("ACC01 Access", "Flag", { Format: BOOLEAN, "Referenced By": "REP01 Report.Total, REP01 Report.Detail" }),
      moduleRow("REP01 Report", { "Read Access Driver": "ACC01 Access.Flag" }),
      item("REP01 Report", "Flag", { Format: BOOLEAN, "Referenced By": "Total" }),
      item("REP01 Report", "Total", { "Read Access Driver": "Flag" }),
      // Detail has the module's driver. Its own cell names none, so what its Referenced By says stays a formula link.
      item("REP01 Report", "Detail", { "Read Access Driver": "-" }),
    )]);
    expect(links(graph)).toEqual(anyOrder([
      "ACC01 Access.Flag -> REP01 Report.Total (reference)",
      "ACC01 Access.Flag -> REP01 Report.Detail (reference)", "ACC01 Access.Flag -> REP01 Report.Detail (read_access)",
      "ACC01 Access.Flag -> REP01 Report (read_access)",
      "REP01 Report.Flag -> REP01 Report.Total (read_access)"]));
    expect(unresolved(graph)).toEqual([]);
  });

  it("takes a name that several objects have for the nearest of them: a line item of the same module, then a module, a list, a subset", () => {
    const graph = buildModelGraph([
      lineItems(
        moduleRow("ACC01 Access"),
        item("ACC01 Access", "Shared", { Format: BOOLEAN }),
        // A bare name is a line item of the row's own module where the module has one of that name.
        item("ACC01 Access", "Own", { "Read Access Driver": "Shared" }),
        // A dimension is a list before it is a subset, and never a module or a line item.
        moduleRow("Shared", { "Applies To": "Shared" }),
        item("Shared", "Shared", { "Applies To": "Core" }),
        moduleRow("REP01 Report"),
        // In a module with no line item of the name, the bare name is the module. Behind a dot it is that module's line item.
        item("REP01 Report", "Other", { "Read Access Driver": "Shared", "Write Access Driver": "Shared.Shared" })),
      generalLists(
        list("Shared", { Subsets: "Core", Properties: "Shared: TEXT" }),
        // A parent is a list before it is a subset. A list's own columns name a module before a list, and a module's line
        // item before a list's property; a list with no module of its name is named for its property.
        list("Regions", { Subsets: "Shared", Properties: "Code: TEXT", "Parent Hierarchy": "Shared", "Referenced in Applies To": "Shared", "Referenced as Format": "Shared.Shared, Regions.Code" })),
    ]);
    const id = (name: string, kind: GraphNode["kind"]): number => node(graph, name, kind).id;
    const [sharedList, sharedSubset, sharedModule, sharedItem] = [id("Shared", "list"), id("Shared", "subset"), id("Shared", "module"),
      graph.nodes.findIndex(each => each.kind === "lineItem" && each.name === "Shared" && each.module === id("Shared", "module"))];
    const accessFlag = graph.nodes.findIndex(each => each.kind === "lineItem" && each.name === "Shared" && each.module === id("ACC01 Access", "module"));
    expect(graph.edges.filter(([, , kind]) => kind === "read_access" || kind === "write_access")).toEqual([
      [accessFlag, id("Own", "lineItem"), "read_access"], [sharedModule, id("Other", "lineItem"), "read_access"], [sharedItem, id("Other", "lineItem"), "write_access"]]);
    expect([graph.nodes[sharedModule].dimensions, graph.nodes[sharedItem].dimensions, node(graph, "Regions").parent]).toEqual([[sharedList], [id("Core", "subset")], sharedList]);
    expect(graph.edges.filter(([from]) => from === id("Regions", "list"))).toEqual([
      [id("Regions", "list"), sharedSubset, "subset"], [id("Regions", "list"), sharedModule, "applies"], [id("Regions", "list"), sharedItem, "format"],
      [id("Regions", "list"), id("Code", "property"), "format"]].sort((a, b) => Number(a[1]) - Number(b[1])));
    expect(graph.unresolved).toEqual([]);
  });

  it("matches names written in quotes, with commas, dots, apostrophes and doubled quotes inside", () => {
    const PLAN = "It's a 'plan', v1.2";
    const quotedPlan = "'It''s a ''plan'', v1.2'";
    const graph = buildModelGraph([
      lineItems(
        moduleRow(PLAN, { "Applies To": "'Regions, north & south', 'O''Brien''s', Products" }),
        item(PLAN, "Rate, net (50%)", { "Referenced By": "REP01 Report.Total, 'Margin.net'" }),
        item(PLAN, "Margin.net", { "Read Access Driver": `${quotedPlan}.'Rate, net (50%)'` }),
        moduleRow("REP01 Report"),
        item("REP01 Report", "Total", { "Referenced By": `${quotedPlan}.'Rate, net (50%)', ${quotedPlan}.Margin.net`, "Write Access Driver": `${quotedPlan}.'Margin.net'` })),
      generalLists(
        list("Regions, north & south", { "Referenced in Applies To": quotedPlan, "Referenced in Formula": `${quotedPlan}.'Rate, net (50%)'` }),
        list("O'Brien's"),
        list("Products")),
    ]);
    expect(names(graph, node(graph, PLAN).dimensions)).toEqual(["Regions, north & south", "O'Brien's", "Products"]);
    expect(links(graph, "reference", "read_access", "write_access", "list_formula")).toEqual(anyOrder([
      `Regions, north & south -> ${PLAN}.Rate, net (50%) (list_formula)`,
      `${PLAN}.Rate, net (50%) -> REP01 Report.Total (reference)`,
      // Margin.net names Rate as its read driver, and is named in Rate's Referenced By: the access link, and no other.
      `${PLAN}.Rate, net (50%) -> ${PLAN}.Margin.net (read_access)`,
      `REP01 Report.Total -> ${PLAN}.Rate, net (50%) (reference)`,
      `${PLAN}.Margin.net -> REP01 Report.Total (write_access)`]));
    // Without its quotes, a name with a dot in it reads as a module, a line item and one part too many.
    expect(unresolved(graph)).toEqual([`REP01 Report.Total: Referenced By: ${quotedPlan}.Margin.net`]);
  });

  it("names a line item's list by the Format List column, and by the list's ID where that column is empty", () => {
    const rows = [
      moduleRow("REV01 Revenue"),
      item("REV01 Revenue", "Product", { Format: listFormat(101000000001), "Format List": "Products" }),
      // No name in Format List: the list is the one whose Referenced as Format names a line item with this ID.
      item("REV01 Revenue", "Region", { Format: listFormat(101000000002) }),
      item("REV01 Revenue", "Other region", { Format: listFormat(101000000002) }),
      // Named by Format List alone: no list's Referenced as Format names it.
      item("REV01 Revenue", "Channel", { Format: listFormat(101000000003), "Format List": "Channels" }),
      // The same ID as text between underscores, in a row whose Format List is empty.
      item("REV01 Revenue", "Channel as text", { Format: listFormat("_101000000003_") }),
      // A list the export does not name: a subset's ID.
      item("REV01 Revenue", "Subset pick", { Format: listFormat(109000000004) }),
      // A number format that still carries a list's ID is formatted as no list.
      item("REV01 Revenue", "Stale", { Format: '{"hierarchyEntityLongId":101000000001,"dataType":"NUMBER"}' }),
      // A name in Format List that is no list of General Lists is unresolved, and nothing is put in its place.
      item("REV01 Revenue", "Flavour", { Format: listFormat(101000000002), "Format List": "Tastes" }),
    ];
    const lists = generalLists(list("Products", { "Referenced as Format": "REV01 Revenue.Product" }), list("Regions", { "Referenced as Format": "REV01 Revenue.Region" }), list("Channels"));
    const deleteChannels = otherActions(action("Delete old channels", { Action: '{"actionType":"DELETE_BY_SELECTION","hierarchyIdentifier":"_101000000003_"}' }));
    const graph = buildModelGraph([lineItems(...rows), lists, deleteChannels]);
    const listOf = (among: ModelGraph, name: string): string | undefined => names(among, [node(among, name).formatList].flatMap(id => (id === undefined ? [] : [id])))?.[0];
    expect(["Product", "Region", "Other region", "Channel", "Channel as text", "Subset pick", "Stale", "Flavour"].map(name => listOf(graph, name)))
      .toEqual(["Products", "Regions", "Regions", "Channels", "Channels", undefined, undefined, undefined]);
    expect(links(graph, "format")).toEqual(anyOrder(["Products -> REV01 Revenue.Product (format)", "Regions -> REV01 Revenue.Region (format)", "Regions -> REV01 Revenue.Other region (format)",
      "Channels -> REV01 Revenue.Channel (format)", "Channels -> REV01 Revenue.Channel as text (format)"]));
    // An action names its list by the same ID.
    expect(links(graph, "action_target")).toEqual(["Delete old channels -> Channels (action_target)"]);
    expect(unresolved(graph)).toEqual(["REV01 Revenue.Flavour: Format List: Tastes"]);

    // A file from before the export had the column: the prototype's rule alone. Channels' ID is then known from nothing.
    const before = buildModelGraph([file("Line Items", LINE_HEADERS.slice(0, -1), lineItems(...rows).rows.map(row => row.slice(0, -1))), lists, deleteChannels]);
    expect(["Product", "Region", "Other region", "Channel", "Channel as text", "Subset pick", "Stale", "Flavour"].map(name => listOf(before, name)))
      .toEqual(["Products", "Regions", "Regions", undefined, undefined, undefined, undefined, "Regions"]);
    expect(unresolved(before)).toEqual(["Delete old channels: hierarchyIdentifier: 101000000003"]);
    expect(before.limitations).toEqual(graph.limitations);
  });

  it("gives an ID that two lists claim to neither, and says so", () => {
    const rows = [
      moduleRow("REV01 Revenue"),
      item("REV01 Revenue", "Product", { Format: listFormat(101000000001) }),
      item("REV01 Revenue", "Second product", { Format: listFormat(101000000001) }),
      item("REV01 Revenue", "Third product", { Format: listFormat(101000000001) }),
    ];
    const lists = generalLists(list("Products", { "Referenced as Format": "REV01 Revenue.Product" }), list("Old products", { "Referenced as Format": "REV01 Revenue.'Second product'" }));
    const graph = buildModelGraph([lineItems(...rows), lists]);
    // What each list's own column names is still linked: that is what the export says. The ID settles nothing more.
    expect(links(graph)).toEqual(anyOrder(["Products -> REV01 Revenue.Product (format)", "Old products -> REV01 Revenue.Second product (format)"]));
    expect(graph.nodes.map(each => each.formatList)).toEqual([undefined, undefined, undefined, undefined, undefined, undefined]);
    expect(graph.limitations).toContain("1 list ID stands for more than one list in the export, and names none on the map.");
    // Format List says which list the ID is, and that settles it.
    const named = buildModelGraph([lineItems(...rows.map(row => (row["Module Name"] ? { ...row, "Format List": "Products" } : row))), lists]);
    expect(named.nodes.filter(each => each.kind === "lineItem").map(each => each.formatList)).toEqual([0, 0, 0]);
    expect(named.limitations.filter(line => line.includes("list ID"))).toEqual([]);
  });

  it("tells a module's own row from a line item's row of which only the name was read, by the Modules table's names, as the page does", () => {
    const rows = lineItems(
      moduleRow("REV01 Revenue"),
      item("REV01 Revenue", "Units"),
      // Only a name, and the name is no module's: a line item of which nothing else was read.
      moduleRow("Price"),
      // No Module Name, but a format: a line item whose module the file does not say.
      { "": "Margin", Format: NUMBER, Summary: SUM },
      // Only a name, and a module's: a module with no line items.
      moduleRow("ARC01 Archive"),
      // A module that only a line item names is one, whatever the Modules table lists.
      moduleRow("NEW01 Added"),
      item("NEW01 Added", "Note"));
    const graph = buildModelGraph([rows, modulesFile("REV01 Revenue", "ARC01 Archive")]);
    expect(graph.nodes.map(each => `${each.kind} ${each.name} row ${each.row}`)).toEqual(["module REV01 Revenue row 1", "lineItem Units row 2", "module ARC01 Archive row 5",
      "module NEW01 Added row 6", "lineItem Note row 7"]);
    expect(graph.limitations.slice(1, 2)).toEqual(["2 rows of Line Items are no module's own and name no module: they are left out."]);

    // Without the Modules table, or with one that lists nothing, a row with only a name is taken for a module's own.
    for (const [tables, why] of [[[rows], NO_MODULES_FILE], [[rows, modulesFile()], NO_MODULES_FILE.replace("Modules was not exported", "Modules lists no modules")]] as const) {
      const unchecked = buildModelGraph(tables);
      expect(unchecked.nodes.map(each => `${each.kind} ${each.name}`)).toEqual(["module REV01 Revenue", "lineItem Units", "module Price", "module ARC01 Archive", "module NEW01 Added",
        "lineItem Note"]);
      expect(unchecked.limitations.slice(1, 3)).toEqual([why, "1 row of Line Items is no module's own and names no module: it is left out."]);
    }
    // A heading is a module in the Modules table too, and stays a heading.
    const headed = buildModelGraph([lineItems(heading("-- INPUTS --"), moduleRow("REV01 Revenue")), modulesFile("-- INPUTS --", "REV01 Revenue")]);
    expect([headed.nodes.map(each => each.name), headed.sections]).toEqual([["REV01 Revenue"], ["INPUTS"]]);
  });

  it("makes the processes and the actions from their four tables, and links each action to its processes and to what it works on", () => {
    const run = { "Start Date and Time (UTC)": "2026-03-12 23:19:56", "Most recent duration (ms)": "1,582", Notes: "From the hub" };
    const graph = buildModelGraph([
      lineItems(
        moduleRow("Prices"), moduleRow("Plan"), moduleRow("REV01 Revenue"),
        item("REV01 Revenue", "Region", { Format: listFormat(101000000002), "Format List": "Regions" })),
      generalLists(list("Regions"), list("Plan")),
      processesFile(action("Nightly load", { Notes: "Runs at 2am" }), heading("-- LOADS --"), action("Nightly load, full"), action("Weekly")),
      importsFile(
        action("Load prices", { "Target Object": "Prices", "Target Type": "MODULE", "Used in Processes": "Nightly load, Nightly load, full", ...run }),
        action("Load regions", { "Target Object": "Regions", "Target Type": "LIST", "Used in Processes": "Nightly load, full, Gone process" }),
        // A module and a list of one name: Target Type says which, and without it the module comes first.
        action("Load plan list", { "Target Object": "Plan", "Target Type": "LIST" }),
        action("Load plan module", { "Target Object": "Plan", "Target Type": "Module" }),
        action("Load plan", { "Target Object": "Plan" }),
        // A target that is neither a module nor a list of the export, one of another kind than its type says, and none.
        action("Load users", { "Target Object": "Users", "Target Type": "USERS" }),
        action("Load regions as a module", { "Target Object": "Regions", "Target Type": "MODULE" }),
        action("Old import")),
      exportsFile(
        action("Send prices", { Action: "Export from 'Prices'", "Used in Processes": "Weekly" }),
        action("Send grid", { Action: '{"exportType":"GRID_CURRENT_PAGE"}' }),
        action("Send gone", { Action: "Export from 'Gone'" })),
      otherActions(
        action("Delete old regions", { Action: '{"actionType":"DELETE_BY_SELECTION","hierarchyIdentifier":"_101000000002_"}' }),
        action("Copy regions", { Action: '{"actionType":"BULK_COPY","sourceHierarchyIdentifier":101000000002,"targetHierarchyIdentifier":"_101000000009_"}' }),
        action("Open the review", { Action: "Open Dashboard" }),
        heading("-- OLD --"),
        action("No kind", { Action: '{"hierarchyIdentifier":"","sourceHierarchyIdentifier":0}' })),
    ]);
    // A heading row among the processes or the actions is no node. Each row is counted in its own table.
    expect(graph.nodes.filter(each => each.kind === "process")).toEqual([
      { id: 6, kind: "process", name: "Nightly load", file: "Processes", row: 1, notes: "Runs at 2am" },
      { id: 7, kind: "process", name: "Nightly load, full", file: "Processes", row: 3 },
      { id: 8, kind: "process", name: "Weekly", file: "Processes", row: 4 }]);
    expect(graph.nodes.filter(each => each.kind === "action")).toEqual([
      { id: 9, kind: "action", name: "Load prices", file: "Imports", row: 1, actionType: "Import", notes: "From the hub", lastRun: "2026-03-12 23:19:56", durationMs: 1582 },
      { id: 10, kind: "action", name: "Load regions", file: "Imports", row: 2, actionType: "Import" },
      { id: 11, kind: "action", name: "Load plan list", file: "Imports", row: 3, actionType: "Import" },
      { id: 12, kind: "action", name: "Load plan module", file: "Imports", row: 4, actionType: "Import" },
      { id: 13, kind: "action", name: "Load plan", file: "Imports", row: 5, actionType: "Import" },
      { id: 14, kind: "action", name: "Load users", file: "Imports", row: 6, actionType: "Import" },
      { id: 15, kind: "action", name: "Load regions as a module", file: "Imports", row: 7, actionType: "Import" },
      { id: 16, kind: "action", name: "Old import", file: "Imports", row: 8, actionType: "Import" },
      { id: 17, kind: "action", name: "Send prices", file: "Exports", row: 1, actionType: "Export", action: "Export from 'Prices'" },
      { id: 18, kind: "action", name: "Send grid", file: "Exports", row: 2, actionType: "Export", action: '{"exportType":"GRID_CURRENT_PAGE"}' },
      { id: 19, kind: "action", name: "Send gone", file: "Exports", row: 3, actionType: "Export", action: "Export from 'Gone'" },
      // Another action's kind is what its definition says, and "Other" where it says none.
      { id: 20, kind: "action", name: "Delete old regions", file: "Other Actions", row: 1, actionType: "DELETE_BY_SELECTION", action: '{"actionType":"DELETE_BY_SELECTION","hierarchyIdentifier":"_101000000002_"}' },
      { id: 21, kind: "action", name: "Copy regions", file: "Other Actions", row: 2, actionType: "BULK_COPY",
        action: '{"actionType":"BULK_COPY","sourceHierarchyIdentifier":101000000002,"targetHierarchyIdentifier":"_101000000009_"}' },
      { id: 22, kind: "action", name: "Open the review", file: "Other Actions", row: 3, actionType: "Other", action: "Open Dashboard" },
      { id: 23, kind: "action", name: "No kind", file: "Other Actions", row: 5, actionType: "Other", action: '{"hierarchyIdentifier":"","sourceHierarchyIdentifier":0}' }]);
    // The processes of an action are written without quotes: "Nightly load, full" is one process, not two.
    expect(links(graph, "process_action")).toEqual(anyOrder(["Nightly load -> Load prices (process_action)", "Nightly load, full -> Load prices (process_action)",
      "Nightly load, full -> Load regions (process_action)", "Weekly -> Send prices (process_action)"]));
    const [planModule, planList] = [node(graph, "Plan", "module").id, node(graph, "Plan", "list").id];
    expect(graph.edges.filter(([, , kind]) => kind === "import_target")).toEqual([[9, node(graph, "Prices").id, "import_target"], [10, node(graph, "Regions").id, "import_target"],
      [11, planList, "import_target"], [12, planModule, "import_target"], [13, planModule, "import_target"]]);
    // An export says what it takes in words; another action names its lists by their IDs, in a definition.
    expect(links(graph, "export_source", "action_target")).toEqual(anyOrder(["Prices -> Send prices (export_source)", "Delete old regions -> Regions (action_target)",
      "Copy regions -> Regions (action_target)"]));
    expect(unresolved(graph)).toEqual(["Load regions: Used in Processes: Gone process", "Load users: Target Object: Users", "Load regions as a module: Target Object: Regions",
      "Send gone: Action: Gone", "Copy regions: targetHierarchyIdentifier: 101000000009"]);
    // No row was left out. An import and an export that name no target are said, since nothing links them to one; another
    // action that names none is as it should be.
    expect(graph.limitations).toEqual([NO_MODULES_FILE,
      "1 import is linked to no module or list: its Target Object cell is empty.",
      "1 export is linked to no module or list: what it takes could not be read from its Action cell.",
      ...STANDING, IMPORT_SOURCES]);
    const several = buildModelGraph([importsFile(action("Old import"), action("Older import"), action("Load prices", { "Target Object": "Prices" })),
      exportsFile(action("Send grid", { Action: '{"exportType":"GRID_CURRENT_PAGE"}' }), action("Send plan"), action("Send prices", { Action: "Export from 'Prices'" }))]);
    expect(several.limitations.filter(line => /^\d/.test(line))).toEqual(["2 imports are linked to no module or list: their Target Object cell is empty.",
      "2 exports are linked to no module or list: what they take could not be read from their Action cell."]);
  });

  it("says what each table that was not exported leaves out, and builds from the tables there are", () => {
    expect(buildModelGraph([])).toEqual({ nodes: [], edges: [], unresolved: [], sections: [],
      limitations: [NOT_EXPORTED.lists, NOT_EXPORTED.lineItems, ...NO_ACTIONS, ...STANDING] });
    // Another export's tables are none of the map's.
    expect(buildModelGraph([file("Cards", ["Page", "Card #"], [["Sales", 1]]), file("Model Details", ["Section", "Detail", "Value"], [["Model", "Model", "Plan"]])]).limitations)
      .toEqual([NOT_EXPORTED.lists, NOT_EXPORTED.lineItems, ...NO_ACTIONS, ...STANDING]);

    // Line Items alone: the modules and line items, with the lists they name unresolved.
    const alone = buildModelGraph([lineItems(moduleRow("REV01 Revenue", { "Applies To": "Products" }), item("REV01 Revenue", "Units", { "Referenced By": "Revenue" }), item("REV01 Revenue", "Revenue"))]);
    expect([alone.nodes.map(each => each.name), links(alone), unresolved(alone)]).toEqual([["REV01 Revenue", "Units", "Revenue"], ["REV01 Revenue.Units -> REV01 Revenue.Revenue (reference)"],
      ["REV01 Revenue: Applies To: Products", "REV01 Revenue.Units: Applies To: Products", "REV01 Revenue.Revenue: Applies To: Products"]]);
    expect(alone.limitations).toEqual([NOT_EXPORTED.lists, NO_MODULES_FILE, ...NO_ACTIONS, ...STANDING]);

    // General Lists alone, and the actions alone.
    const lists = buildModelGraph([generalLists(list("Products", { Subsets: "Core Products", "Referenced in Applies To": "REV01 Revenue" }))]);
    expect([lists.nodes.map(each => each.name), links(lists), unresolved(lists)]).toEqual([["Products", "Core Products"], ["Products -> Core Products (subset)"],
      ["Products: Referenced in Applies To: REV01 Revenue"]]);
    expect(lists.limitations).toEqual([NOT_EXPORTED.lineItems, ...NO_ACTIONS, ...STANDING]);
    const actions = buildModelGraph([processesFile(action("Weekly")), importsFile(action("Load prices", { "Target Object": "Prices", "Target Type": "MODULE", "Used in Processes": "Weekly" }))]);
    expect([links(actions), unresolved(actions)]).toEqual([["Weekly -> Load prices (process_action)"], ["Load prices: Target Object: Prices"]]);
    expect(actions.limitations).toEqual([NOT_EXPORTED.lists, NOT_EXPORTED.lineItems, NOT_EXPORTED.exports, NOT_EXPORTED.otherActions, ...STANDING, IMPORT_SOURCES]);
  });

  it("says what each column a table lacks leaves out, and builds from the columns there are", () => {
    // Only the names: a module, a line item that says its module, and a list.
    const bare = buildModelGraph([
      file("Line Items", ["", "Module Name"], [["REV01 Revenue", ""], ["Units", "REV01 Revenue"]]),
      file("General Lists", [""], [["Products"]]),
      file("Processes", [""], [["Weekly"]]),
      file("Imports", [""], [["Load prices"]]),
      file("Exports", [""], [["Send prices"]]),
      file("Other Actions", [""], [["Delete old regions"]])]);
    expect(bare.nodes).toEqual([
      // Without the Numbered column a list is not said to be unnumbered.
      { id: 0, kind: "list", name: "Products", file: "General Lists", row: 1, group: "Ungrouped" },
      { id: 1, kind: "module", name: "REV01 Revenue", file: "Line Items", row: 1, group: "Ungrouped" },
      { id: 2, kind: "lineItem", name: "Units", file: "Line Items", row: 2, module: 1, group: "Ungrouped" },
      { id: 3, kind: "process", name: "Weekly", file: "Processes", row: 1 },
      { id: 4, kind: "action", name: "Load prices", file: "Imports", row: 1, actionType: "Import" },
      { id: 5, kind: "action", name: "Send prices", file: "Exports", row: 1, actionType: "Export" },
      { id: 6, kind: "action", name: "Delete old regions", file: "Other Actions", row: 1, actionType: "Other" }]);
    expect([bare.edges, bare.unresolved]).toEqual([[], []]);
    expect(bare.limitations).toEqual([
      "General Lists has no Subsets column: the map has no list subsets.",
      "General Lists has no Properties column: the map has no list properties.",
      "General Lists has no Parent Hierarchy column: the map does not say which list is the parent of another.",
      "General Lists has no Referenced in Applies To column: what a list applies to is known only from the Applies To column of Line Items.",
      "General Lists has no Referenced as Format column: the list of a line item formatted as a list is known only where the Format List column of Line Items names it.",
      "General Lists has no Referenced in Formula column: the map has no links from a list to the formulas that name it.",
      "General Lists has no Top Level, Item Count, Numbered, Notes and Display Name Property columns: lists come without them.",
      "Line Items has no Applies To column: modules and line items come without their dimensions.",
      "Line Items has no Format column: line items come without their format, and the list of one formatted as a list is known only where the Format List column names it.",
      "Line Items has no Read Access Driver column: the map has no read access links.",
      "Line Items has no Write Access Driver column: the map has no write access links.",
      "Line Items has no Referenced By column: the map has no links from a line item to what refers to it.",
      "Line Items has no Formula, Summary, Notes, Cell Count, Time Scale, Time Range, Versions, Style and Code columns: modules and line items come without them.",
      NO_MODULES_FILE,
      "Processes has no Notes column: processes come without it.",
      "Imports has no Target Object column: the map does not say what an import loads into.",
      "Imports has no Used in Processes column: the map does not say which processes run an import.",
      "Imports has no Notes, Start Date and Time (UTC) and Most recent duration (ms) columns: imports come without them.",
      "Exports has no Action column: exports come without their definition, and the map does not say what an export takes.",
      "Exports has no Used in Processes column: the map does not say which processes run an export.",
      "Exports has no Notes, Start Date and Time (UTC) and Most recent duration (ms) columns: exports come without them.",
      "Other Actions has no Action column: the other actions come without their kind and their definition, and the map does not say which list one works on.",
      "Other Actions has no Used in Processes column: the map does not say which processes run one of the other actions.",
      "Other Actions has no Notes, Start Date and Time (UTC) and Most recent duration (ms) columns: the other actions come without them.",
      ...STANDING, IMPORT_SOURCES]);

    // One column less than the export has: one sentence, and everything else as it is.
    const whole = [lineItems(moduleRow("REV01 Revenue", { "Applies To": "Products" }), item("REV01 Revenue", "Units", { "Referenced By": "Revenue", Notes: "Sold" }), item("REV01 Revenue", "Revenue")),
      generalLists(list("Products"))];
    const without = (table: ResultTable, header: string): ResultTable => {
      const at = table.headers.indexOf(header);
      return { ...table, headers: table.headers.filter((_, index) => index !== at), rows: table.rows.map(row => row.filter((_, index) => index !== at)) };
    };
    const lacking = (header: string): ModelGraph => buildModelGraph([without(whole[0], header), whole[1]]);
    expect(buildModelGraph(whole).limitations).toEqual([NO_MODULES_FILE, ...NO_ACTIONS, ...STANDING]);
    expect(lacking("Notes").limitations).toEqual(["Line Items has no Notes column: modules and line items come without it.", NO_MODULES_FILE, ...NO_ACTIONS, ...STANDING]);
    expect([links(lacking("Referenced By")), links(lacking("Notes")).length, node(lacking("Notes"), "Units").notes, node(buildModelGraph(whole), "Units").notes]).toEqual([
      anyOrder(["Products -> REV01 Revenue (applies)", "Products -> REV01 Revenue.Units (applies)", "Products -> REV01 Revenue.Revenue (applies)"]), 4, undefined, "Sold"]);
    // Without Module Name no row says its module: the rows that hold more than a name are left out, and counted.
    const unnamed = lacking("Module Name");
    expect([unnamed.nodes.map(each => `${each.kind} ${each.name}`), unnamed.limitations.slice(0, 3)]).toEqual([["list Products", "module REV01 Revenue"], [
      "Line Items has no Module Name column: no row says which module it is in, so the map has no line items.", NO_MODULES_FILE,
      "2 rows of Line Items are no module's own and name no module: they are left out."]]);
    // The Format List column is the export's own, and a file without it lacks nothing the map says.
    expect(lacking("Format List").limitations).toEqual(buildModelGraph(whole).limitations);
    // The Imports tab alone, as the export writes it when the Actions list could not be read.
    const tabOnly = buildModelGraph([file("Imports", IMPORT_HEADERS.slice(0, 7), [["Load prices", "prices.csv", "-", "FILE", "Prices", "MODULE", "false"]])]);
    expect(tabOnly.limitations).toEqual([NOT_EXPORTED.lists, NOT_EXPORTED.lineItems, NOT_EXPORTED.processes,
      "Imports has no Used in Processes column: the map does not say which processes run an import.",
      "Imports has no Notes, Start Date and Time (UTC) and Most recent duration (ms) columns: imports come without them.",
      NOT_EXPORTED.exports, NOT_EXPORTED.otherActions, ...STANDING, IMPORT_SOURCES]);
  });

  it("makes nothing of a table without rows, and says nothing of the columns it lacks", () => {
    const empty = [lineItems(), modulesFile(), generalLists(), processesFile(), importsFile(), exportsFile(), otherActions()];
    expect(buildModelGraph(empty)).toEqual({ nodes: [], edges: [], unresolved: [], sections: [], limitations: [...STANDING, IMPORT_SOURCES] });
    // Not even headers.
    const blank = ["Line Items", "Modules", "General Lists", "Processes", "Imports", "Exports", "Other Actions"].map(label => file(label, [], []));
    expect(buildModelGraph(blank)).toEqual(buildModelGraph(empty));
  });

  it("keeps the first of a name that occurs twice, leaves the others out and counts them", () => {
    const graph = buildModelGraph([
      lineItems(
        moduleRow("REV01 Revenue"),
        item("REV01 Revenue", "Units", { Formula: "1" }),
        item("REV01 Revenue", "Units", { Formula: "2" }),
        // The same name in another module is another line item.
        moduleRow("COST01 Costs"),
        item("COST01 Costs", "Units"),
        // A second row for a module is left out. Its line items name the module, which is the first row's.
        moduleRow("REV01 Revenue", { Notes: "Again" }),
        item("REV01 Revenue", "Units", { Formula: "3" }),
        item("REV01 Revenue", "Margin"),
        // A line item whose module has no row, and one that names a heading.
        item("OLD01 Gone", "Left over"),
        heading("-- NOTES --"),
        item("-- NOTES --", "Remark"),
        // A module's row below its line item comes too late for it.
        item("LATE01 Late", "Early"),
        moduleRow("LATE01 Late")),
      generalLists(
        list("Products", { Subsets: "Core, Core", "Item Count": "5" }),
        list("Regions", { Subsets: "Core, Northern" }),
        list("Products", { Subsets: "Second", "Item Count": "9" })),
      processesFile(action("Nightly", { Notes: "First" }), action("Nightly", { Notes: "Second" }), action("Nightly")),
      // Two actions may have one name: nothing names an action.
      otherActions(action("Tidy up"), action("Tidy up")),
    ]);
    expect(graph.nodes.map(each => `${each.kind} ${each.name} row ${each.row}`)).toEqual([
      "list Products row 1", "list Regions row 2", "subset Core row 1", "subset Northern row 2",
      "module REV01 Revenue row 1", "lineItem Units row 2", "module COST01 Costs row 4", "lineItem Units row 5", "lineItem Margin row 8", "module LATE01 Late row 13",
      "process Nightly row 1", "action Tidy up row 1", "action Tidy up row 2"]);
    expect([node(graph, "Products").count, node(graph, "Nightly").notes, graph.nodes[5].formula, node(graph, "REV01 Revenue").notes, node(graph, "Margin").module])
      .toEqual([5, "First", "1", undefined, node(graph, "REV01 Revenue").id]);
    expect(graph.limitations).toEqual([
      "1 row of General Lists repeats the name of a list above it and is left out.",
      "2 list subsets have the name of a subset before them and are left out.",
      NO_MODULES_FILE,
      "1 row of Line Items repeats the name of a module above it and is left out.",
      "1 line item names a heading row as its module and is left out: a heading is no module on the map.",
      "2 line items name a module that has no row above them in Line Items and are left out.",
      "2 line items have the name of a line item above them in the same module and are left out.",
      "2 rows of Processes repeat the name of a process above them and are left out.",
      NOT_EXPORTED.imports, NOT_EXPORTED.exports,
      ...STANDING]);
    // One of each is said as one.
    const one = buildModelGraph([lineItems(moduleRow("REV01 Revenue"), item("REV01 Revenue", "Units"), item("REV01 Revenue", "Units"), item("OLD01 Gone", "Left over")),
      generalLists(list("Products", { Subsets: "Core, Core" })), processesFile(action("Nightly"), action("Nightly"))]);
    expect(one.limitations.slice(0, 6)).toEqual([
      "1 list subset has the name of a subset before it and is left out.", NO_MODULES_FILE,
      "1 line item names a module that has no row above it in Line Items and is left out.",
      "1 line item has the name of a line item above it in the same module and is left out.",
      "1 row of Processes repeats the name of a process above it and is left out.", NOT_EXPORTED.imports]);
  });

  it("never throws, whatever the tables hold", () => {
    // Cells that are numbers: a name, a count, a module's name.
    const numbers = buildModelGraph([file("Line Items", ["", "Module Name", "Cell Count", "Applies To"], [[2026, "", 1200, 7], ["Units", 2026, 12.5, "-"]]),
      file("General Lists", ["", "Item Count", "Numbered"], [[7, 40, "true"]])]);
    expect(numbers.nodes).toEqual([
      { id: 0, kind: "list", name: "7", file: "General Lists", row: 1, group: "Ungrouped", count: 40, numbered: true },
      { id: 1, kind: "module", name: "2026", file: "Line Items", row: 1, group: "Ungrouped", cells: 1200, dimensions: [0] },
      { id: 2, kind: "lineItem", name: "Units", file: "Line Items", row: 2, module: 1, group: "Ungrouped", inheritsDimensions: true, dimensions: [0] }]);
    // A line item without a name is a line item all the same, and keeps the name it has.
    const unnamed = buildModelGraph([lineItems(moduleRow("REV01 Revenue"), item("REV01 Revenue", "", { Format: "", Summary: "", "Applies To": "" }))]);
    expect(unnamed.nodes[1]).toEqual({ id: 1, kind: "lineItem", name: "", file: "Line Items", row: 2, module: 0, group: "Ungrouped" });
    // A table of the wrong shape altogether: what can be read of it is read.
    const odd = [null, { file: "Line Items.csv", label: "Line Items", headers: null, rows: [null, ["REV01 Revenue"], 5, [null], [{ name: "x" }]] },
      { file: "General Lists.csv", label: "General Lists", headers: ["", "Subsets"], rows: "none" }, { file: "Processes.csv" }, "Imports.csv"] as unknown as ResultTable[];
    expect(() => buildModelGraph(odd)).not.toThrow();
    expect(buildModelGraph(odd).nodes.map(each => each.name)).toEqual(["REV01 Revenue", "[object Object]"]);
    // Definitions that are JSON of another shape than Anaplan writes.
    const shapes = buildModelGraph([
      lineItems(moduleRow("REV01 Revenue"), item("REV01 Revenue", "Units", { Format: '{"dataType":"ENTITY","hierarchyEntityLongId":{"id":1}}', Summary: '{"summaryMethod":{"a":1}}' }),
        item("REV01 Revenue", "Price", { Format: '{"__proto__":{"dataType":"NUMBER"},"constructor":1}', "Format List": "constructor" })),
      generalLists(list("constructor", { Properties: "toString: TEXT", "Referenced as Format": "REV01 Revenue.Units, __proto__.valueOf" })),
      otherActions(action("Odd", { Action: '{"actionType":["x"],"hierarchyIdentifier":{"a":1},"sourceHierarchyIdentifier":true,"targetHierarchyIdentifier":[1]}' }),
        action("hasOwnProperty", { Action: "null", "Used in Processes": "toString, __proto__" }))]);
    expect([node(shapes, "Units").format, node(shapes, "Units").summary, node(shapes, "Price").format, node(shapes, "Odd").actionType])
      .toEqual(["ENTITY", undefined, '{"__proto__":{"dataType":"NUMBER"},"constructor":1}', "Other"]);
    expect(unresolved(shapes)).toEqual(["constructor: Referenced as Format: __proto__.valueOf", "hasOwnProperty: Used in Processes: toString", "hasOwnProperty: Used in Processes: __proto__"]);
    // And what is no list of tables at all gives a graph of nothing, which says so.
    for (const tables of [undefined, null, 7, { tables: [] }]) {
      const graph = buildModelGraph(tables as unknown as ResultTable[]);
      expect({ ...graph, limitations: graph.limitations.map(line => line.replace(/\(.*\)/, "(why)")) })
        .toEqual({ nodes: [], edges: [], unresolved: [], sections: [], limitations: ["The map could not be made from this export's tables (why)."] });
    }
  });

  it("gives the same graph for the same tables: the nodes in the tables' order, each link once, the links in order", () => {
    const tables = (): ResultTable[] => [
      // The files in another order than the map reads them, as a result may hold them.
      otherActions(action("Delete old regions", { Action: '{"actionType":"DELETE_BY_SELECTION","hierarchyIdentifier":"_101000000002_"}', "Used in Processes": "Weekly, Weekly" })),
      importsFile(action("Load prices", { "Target Object": "REV01 Revenue", "Target Type": "MODULE", "Used in Processes": "Weekly" })),
      processesFile(action("Weekly")),
      generalLists(
        list("Products", { Subsets: "Core Products", "Referenced in Applies To": "REV01 Revenue, REV01 Revenue, REV01 Revenue.Units", "Referenced in Formula": "REV01 Revenue.Units, REV01 Revenue.Units" }),
        list("Regions", { "Parent Hierarchy": "Products", "Referenced as Format": "REV01 Revenue.Region" })),
      lineItems(
        moduleRow("REV01 Revenue", { "Applies To": "Products, Products, Core Products" }),
        // The same reference twice, and one that the other end says as well.
        item("REV01 Revenue", "Units", { "Referenced By": "Revenue, Revenue, 'REV01 Revenue'.Revenue", "Read Access Driver": "Open" }),
        item("REV01 Revenue", "Region", { Format: listFormat(101000000002), "Format List": "Regions" }),
        item("REV01 Revenue", "Revenue", { "Referenced By": "Units" }),
        item("REV01 Revenue", "Open", { Format: BOOLEAN, "Referenced By": "Units" })),
    ];
    const graph = buildModelGraph(tables());
    expect(graph.nodes.map(each => each.id)).toEqual(graph.nodes.map((_, index) => index));
    expect(graph.nodes.map(each => `${each.kind} ${each.name}`)).toEqual(["list Products", "list Regions", "subset Core Products", "module REV01 Revenue", "lineItem Units", "lineItem Region",
      "lineItem Revenue", "lineItem Open", "process Weekly", "action Load prices", "action Delete old regions"]);
    // By the first node, then the second, then the kind; no link twice, though the tables say several of them twice.
    expect(graph.edges).toEqual([
      [0, 1, "parent"], [0, 2, "subset"], [0, 3, "applies"], [0, 4, "applies"], [0, 4, "list_formula"], [0, 5, "applies"], [0, 6, "applies"], [0, 7, "applies"],
      [1, 5, "format"],
      [2, 3, "applies"], [2, 4, "applies"], [2, 5, "applies"], [2, 6, "applies"], [2, 7, "applies"],
      [4, 6, "reference"], [6, 4, "reference"], [7, 4, "read_access"],
      [8, 9, "process_action"], [8, 10, "process_action"], [9, 3, "import_target"], [10, 1, "action_target"]]);
    expect(new Set(graph.edges.map(edge => edge.join(" "))).size).toBe(graph.edges.length);
    // What the module's Applies To names twice is twice among its dimensions, as the cell has it.
    expect(node(graph, "REV01 Revenue").dimensions).toEqual([0, 0, 2]);
    // Built again, from the same tables and from a copy of them, it is the same graph, to the last character.
    expect(buildModelGraph(tables())).toEqual(graph);
    const given = tables();
    const kept = JSON.stringify(given);
    expect(JSON.stringify(buildModelGraph(given))).toBe(JSON.stringify(graph));
    expect(JSON.stringify(buildModelGraph(JSON.parse(kept) as ResultTable[]))).toBe(JSON.stringify(graph));
    // The tables given are never changed.
    expect(JSON.stringify(given)).toBe(kept);
  });

  it("builds a model of 250 modules, 5,000 line items and 15,000 links in well under a second", () => {
    const LISTS = 40;
    const PER_MODULE = 20;
    const moduleName = (index: number): string => `MOD${String(index).padStart(3, "0")} Made-up module, ${index}`;
    const lineName = (index: number): string => `Line item ${index}`;
    const written = (module: number, line: number): string => `'${moduleName(module)}'.${lineName(line)}`;
    const rows: Cells[] = [];
    for (let module = 0; module < 250; module++) {
      if (module % 25 === 0) rows.push(heading(`-- ${String(module / 25).padStart(2, "0")} : SECTION --`));
      rows.push(moduleRow(moduleName(module), { "Applies To": `List ${module % LISTS}, List ${(module + 7) % LISTS}`, "Cell Count": "48000" }));
      for (let line = 0; line < PER_MODULE; line++) {
        // Each line item is referred to by the next one of its module, and by two line items of other modules.
        const referencedBy = [lineName((line + 1) % PER_MODULE), written((module + 1) % 250, line), written((module + 113) % 250, (line + 5) % PER_MODULE)].join(", ");
        rows.push(item(moduleName(module), lineName(line), { Formula: `${lineName((line + PER_MODULE - 1) % PER_MODULE)} * 2`, "Referenced By": referencedBy, "Cell Count": "2400",
          ...(line === 0 ? { Format: listFormat(101000000000 + (module % LISTS)), "Format List": `List ${module % LISTS}` } : {}),
          ...(line === 1 ? { "Applies To": `List ${(module + 3) % LISTS}` } : {}),
          // The third line item names the second as its read driver, and the second's Referenced By names the third.
          ...(line === 2 ? { "Read Access Driver": lineName(1) } : {}) }));
      }
    }
    const tables = [
      lineItems(...rows),
      modulesFile(...rows.filter(row => !row["Module Name"]).map(row => String(row[""]))),
      generalLists(...Array.from({ length: LISTS }, (_, index) => list(`List ${index}`, { Subsets: `Subset ${index}`, Properties: "Code: TEXT", "Item Count": String(index * 10) }))),
      processesFile(...Array.from({ length: 30 }, (_, index) => action(`Process ${index}, nightly`))),
      importsFile(...Array.from({ length: 200 }, (_, index) => action(`Import ${index}`, { "Target Object": moduleName(index), "Target Type": "MODULE",
        "Used in Processes": `Process ${index % 30}, nightly, Process ${(index + 1) % 30}, nightly` }))),
    ];
    let graph = buildModelGraph(tables);
    let took = Infinity;
    for (let run = 0; run < 3; run++) {
      const started = performance.now();
      graph = buildModelGraph(tables);
      took = Math.min(took, performance.now() - started);
    }
    const kinds = (kind: GraphNode["kind"]): number => graph.nodes.filter(each => each.kind === kind).length;
    expect([kinds("module"), kinds("lineItem"), kinds("list"), kinds("subset"), kinds("property"), kinds("process"), kinds("action")]).toEqual([250, 5000, 40, 40, 40, 30, 200]);
    const linked = (kind: EdgeKind): number => graph.edges.filter(edge => edge[2] === kind).length;
    // Three references for each line item, less the 250 that are a driver's and so an access link.
    expect([linked("reference"), linked("read_access"), linked("format"), linked("import_target"), linked("process_action"), graph.unresolved.length]).toEqual([14750, 250, 250, 200, 400, 0]);
    expect(graph.edges.length).toBeGreaterThan(25_000);
    expect(graph.sections).toHaveLength(10);
    expect(graph.limitations).toEqual([NOT_EXPORTED.exports, NOT_EXPORTED.otherActions, ...STANDING, IMPORT_SOURCES]);
    // Loosely: the same build takes some tens of milliseconds on a laptop.
    expect(took).toBeLessThan(1_000);
  });
});
