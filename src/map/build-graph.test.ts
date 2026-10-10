import { describe, expect, it } from "vitest";
import { PAGE_FILTERS_HEADERS } from "../model-pages.js";
import { HEADERS } from "../report.js";
import type { Cell, ResultTable } from "../result-types.js";
import { areaCheckLine, buildModelGraph } from "./build-graph.js";
import { automaticGrouping, groupingsOf, type Grouping } from "./map-groups.js";
import { sectionsGraph } from "./map-graphs.js";
import { indexModel, withGrouping } from "./map-model.js";
import { definitionOf, idOf, integer, knownNames, knownSequence, nothing, separator, splitOutside, stripChars, unquote } from "./graph-names.js";
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
/** A table without one of its columns. */
const without = (table: ResultTable, ...headers: string[]): ResultTable => {
  const kept = table.headers.map((header, index) => (headers.includes(header) ? -1 : index)).filter(index => index >= 0);
  return { ...table, headers: kept.map(index => table.headers[index]), rows: table.rows.map(row => kept.map(index => row[index])) };
};

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

/** What the map says of every export it is true of, word for word. */
const LIST_ITEMS = "The export gives the number of items in each list, not the items.";
const NO_LIST_ITEMS = "The export does not give the items of a list.";
const PROCESS_ORDER = "The export says which processes use an action, not the order in which a process runs its actions.";
const LINKS = "Every link comes from a column of the export that names another object: formulas are kept as text and are not worked out.";
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
/** The same with each node's kind before its name, for where two objects have one name. */
const kindLinks = (graph: ModelGraph, ...kinds: EdgeKind[]): string[] =>
  anyOrder(graph.edges.filter(([, , kind]) => !kinds.length || kinds.includes(kind))
    .map(([from, to, kind]) => `${graph.nodes[from].kind} ${called(graph, from)} -> ${graph.nodes[to].kind} ${called(graph, to)} (${kind})`));
const unresolved = (graph: ModelGraph): string[] => graph.unresolved.map(entry => `${called(graph, entry.source)}: ${entry.field}: ${entry.reference}`);
const node = (graph: ModelGraph, name: string, kind?: GraphNode["kind"]): GraphNode => {
  const found = graph.nodes.filter(candidate => candidate.name === name && (kind === undefined || candidate.kind === kind));
  expect(found.map(candidate => candidate.kind), name).toHaveLength(1);
  return found[0];
};
const names = (graph: ModelGraph, ids: readonly number[] | undefined): string[] | undefined => ids?.map(id => called(graph, id));
/** The sentences that count what was left out or could not be linked: those that start with a number. */
const counted = (graph: ModelGraph): string[] => graph.limitations.filter(line => /^\d/.test(line));

/** A generator of the same numbers every run, so that a case that fails can be made again. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

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
    // A cell that names one thing names nothing when it is empty or holds the dash the export writes for "none".
    expect(["", " ", "-", " - "].map(nothing)).toEqual([true, true, true, true]);
    expect(["--", "- -", "Prices", "'-'", "0"].map(nothing)).toEqual([false, false, false, false, false]);
  });

  it("splits a cell of names only outside single quotes, and leaves out an empty part and a dash", () => {
    expect(splitOutside("Products, 'Regions, north & south',Channels")).toEqual(["Products", "'Regions, north & south'", "Channels"]);
    // Two single quotes inside a quoted name end nothing: the comma after them is still inside.
    expect(splitOutside("'It''s, here', 'O''Brien''s', x")).toEqual(["'It''s, here'", "'O''Brien''s'", "x"]);
    expect(splitOutside("'a'',''b', c")).toEqual(["'a'',''b'", "c"]);
    expect([splitOutside(""), splitOutside("-"), splitOutside(" - ,, -, Products , ")]).toEqual([[], [], ["Products"]]);
    // A quote that is never closed keeps the rest of the cell together.
    expect(splitOutside("Products, 'Regions, north, Channels")).toEqual(["Products", "'Regions, north, Channels"]);
    // A line item behind its module: the same split at a dot, where a dot inside quotes is part of a name.
    expect(splitOutside("'Plan v1.2'.'Rate, net (50%)'", ".")).toEqual(["'Plan v1.2'", "'Rate, net (50%)'"]);
    expect([splitOutside("REV01 Revenue.Units", "."), splitOutside("Units", "."), splitOutside("A..B", "."), splitOutside("A.-", "."), splitOutside(".", ".")])
      .toEqual([["REV01 Revenue", "Units"], ["Units"], ["A", "B"], ["A"], []]);
    // Where a cell writes a format after each name, a comma inside brackets is the format's, and only there.
    expect(splitOutside("Rate: NUMBER (2 dp, %), Code: TEXT", ",", true)).toEqual(["Rate: NUMBER (2 dp, %)", "Code: TEXT"]);
    expect(splitOutside("Rate: NUMBER (2 dp, %), Code: TEXT")).toEqual(["Rate: NUMBER (2 dp", "%)", "Code: TEXT"]);
    expect(splitOutside("a [b, {c, d}], e), f, '(', g", ",", true)).toEqual(["a [b, {c, d}]", "e)", "f", "'('", "g"]);
  });

  it("finds the known names in a cell that writes them without quotes, and gives what is left as it is written", () => {
    const read = (text: string, ...known: string[]): string[] | undefined => knownSequence(text, knownNames(known))?.map(part => (part.known ? part.name : `?${part.name}`));
    const loads = ["Nightly load", "Nightly load, full", "Weekly"];
    // A name may hold a comma and a space: "Nightly load, full" is one process, where no process is called "full".
    expect(read("Nightly load, Nightly load, full, Weekly", ...loads)).toEqual(["Nightly load", "Nightly load, full", "Weekly"]);
    expect([read("Nightly load, full", ...loads), read("Nightly load", ...loads), read(" Weekly ", ...loads)]).toEqual([["Nightly load, full"], ["Nightly load"], ["Weekly"]]);
    // A part that is no known name ends at the next comma and space, and is given as it is written.
    expect(read("Gone, Weekly, Old, load", ...loads)).toEqual(["?Gone", "Weekly", "?Old", "?load"]);
    // A known name counts only where it ends at the cell's end or before a comma and a space.
    expect([read("Weekly load", ...loads), read("Weekly,Nightly load", ...loads), read("Weekly,  Weekly", ...loads)]).toEqual([["?Weekly load"], ["?Weekly,Nightly load"], ["Weekly", "? Weekly"]]);
    // An empty cell and a dash name nothing, and neither does an empty part, a dash or a stray comma among the names.
    expect([read("", ...loads), read("-", ...loads), read(" - ", ...loads), read("Weekly, , -, Weekly", ...loads), read("a, , b")]).toEqual([[], [], [], ["Weekly", "Weekly"], ["?a", "?b"]]);
    expect([read(",", ...loads), read("Weekly, ,", ...loads), read(", ,, Weekly,", ...loads)]).toEqual([[], ["Weekly"], ["?Weekly,"]]);
    // The cell is read as known names wherever it can be: the way that leaves the fewest parts over. Taking the longest
    // name first, as the prototype did, would leave C over.
    expect(read("A, B, C", "A", "A, B", "B, C")).toEqual(["A", "B, C"]);
    expect(read("A, B, C", "A, B")).toEqual(["A, B", "?C"]);
  });

  it("does not choose between two ways to read a cell: a name that is two other names with a comma between", () => {
    const read = (text: string, ...known: string[]): string[] | undefined => knownSequence(text, knownNames(known))?.map(part => (part.known ? part.name : `?${part.name}`));
    const times = ["Daily", "Weekly", "Daily, Weekly"];
    // Daily and Weekly, or the one process "Daily, Weekly": the cell does not say.
    expect(read("Daily, Weekly", ...times)).toBeUndefined();
    expect([read("Monthly, Daily, Weekly", ...times), read("Daily, Weekly, Daily", ...times)]).toEqual([undefined, undefined]);
    // Each alone is read, and so is the pair where only one way is all known names.
    expect([read("Daily", ...times), read("Weekly, Daily", ...times), read("Daily, Weekly", "Daily", "Daily, Weekly"), read("Daily, Weekly", "Daily, Weekly")])
      .toEqual([["Daily"], ["Weekly", "Daily"], ["Daily, Weekly"], ["Daily, Weekly"]]);
    // Two ways that each leave one part over are two ways as well.
    expect([read("A, B, C", "A, B", "B, C"), read("A, A, A", "A, A")]).toEqual([undefined, undefined]);
  });

  it("reads a cell of names as the one best way to cut it at its commas, checked against every way to cut it", () => {
    const random = seeded(20261006);
    const pick = <T>(from: readonly T[]): T => from[Math.floor(random() * from.length)];
    const upTo = (most: number): number => Math.floor(random() * (most + 1));
    let twoWays = 0;
    for (let round = 0; round < 4000; round++) {
      // Few parts to make names and cells of, so that a name is often the start of another and a cell often reads two ways.
      const known = new Set(Array.from({ length: 1 + upTo(5) }, () => Array.from({ length: 1 + upTo(2) }, () => pick(["a", "a", "b", "a b"])).join(", ")));
      const cell = Array.from({ length: upTo(8) }, () => pick(["a", "a", "a", "b", "b", "a b", "c", "", "-", ","])).join(", ");
      // A part that says nothing: empty, a dash, or nothing but a comma.
      const silent = (part: string): boolean => nothing(stripChars(part, ", "));
      const parts = silent(cell) ? [] : cell.trim().split(", ");
      // Every way to cut the cell: at each part, either a known name starts there, or the part alone is no known name.
      const ways: { over: number; names: string[] }[] = [];
      const cut = (at: number, over: number, soFar: string[]): void => {
        if (at === parts.length) {
          ways.push({ over, names: soFar });
          return;
        }
        cut(at + 1, over + (silent(parts[at]) ? 0 : 1), silent(parts[at]) ? soFar : [...soFar, `?${parts[at]}`]);
        for (let end = at + 1; end <= parts.length; end++) {
          const name = parts.slice(at, end).join(", ");
          if (known.has(name)) cut(end, over, [...soFar, name]);
        }
      };
      cut(0, 0, []);
      const fewest = Math.min(...ways.map(way => way.over));
      const best = ways.filter(way => way.over === fewest);
      if (best.length > 1) twoWays++;
      const read = knownSequence(cell, knownNames(known))?.map(part => (part.known ? part.name : `?${part.name}`));
      expect(read, `${JSON.stringify([...known])} in ${JSON.stringify(cell)}`).toEqual(best.length === 1 ? best[0].names : undefined);
    }
    // Both outcomes are well among the cases: about 200 of the 4,000 cells read two ways.
    expect(twoWays).toBeGreaterThan(100);
    expect(twoWays).toBeLessThan(1000);
  });

  it("reads a long cell in a time that grows with the cell, however long a known name is", () => {
    // One name of 3,000 characters, and one as long that is made of the cell's own parts.
    for (const long of ["p".repeat(3000), Array.from({ length: 750 }, () => "ab").join(", ")]) {
      const known = knownNames([long, "Weekly"]);
      const cell = [...Array.from({ length: 1000 }, () => "ab"), "Weekly"].join(", ");
      const started = performance.now();
      let read: ReturnType<typeof knownSequence>;
      for (let times = 0; times < 300; times++) read = knownSequence(cell, known);
      const took = performance.now() - started;
      // The long name of one part is found nowhere, and Weekly at the end. The long name of many parts is found at 251
      // places, each as good as the next, so the cell reads many ways.
      expect(read === undefined ? undefined : [read.length, read[read.length - 1]]).toEqual(long.includes(",") ? undefined : [1001, { name: "Weekly", known: true }]);
      // Loosely: 300 such cells take some tens of milliseconds. Looked up prefix by prefix they took minutes.
      expect(took).toBeLessThan(2_000);
    }
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
      list("Regions", { "Top Level": "All Regions", "Item Count": "12", Subsets: "Active Regions, 'North, coastal'", Notes: "Sales regions",
        Properties: "Code: TEXT, 'Opened, on': DATE, Rate: NUMBER (2 dp, %), Opened: Date: DATE, Odd, Tag:TEXT" }),
      list("Countries", { "Parent Hierarchy": "Regions", "Item Count": "1,204" }),
      list("Outlets", { "Parent Hierarchy": "Active Regions", "Item Count": "0" }),
      list("Docks", { "Parent Hierarchy": "'North, coastal'" }),
      heading("--- Products"),
      list("Products", { "Top Level": "All Products", "Item Count": "n/a", "Parent Hierarchy": "-" }),
      list("Orders", { Numbered: "true", "Display Name Property": "Label", Properties: "Label: TEXT", "Parent Hierarchy": "Tastes" }),
    )]);
    const from = { file: "General Lists" };
    // The lists in the file's order. A row is numbered as a spreadsheet numbers it: the header is row 1, the first heading
    // row 2. Then each list's subsets and properties, which carry their list's row and group. A subset and a property
    // are named out of their quotes, as what refers to them names them. A property's name ends at the last colon that a
    // space follows, and a comma in brackets is its format's.
    expect(graph.nodes).toEqual([
      { id: 0, kind: "list", name: "Regions", ...from, row: 3, group: "ORGANISATION", topLevel: "All Regions", count: 12, numbered: false, notes: "Sales regions" },
      { id: 1, kind: "list", name: "Countries", ...from, row: 4, group: "ORGANISATION", count: 1204, numbered: false, parent: 0 },
      { id: 2, kind: "list", name: "Outlets", ...from, row: 5, group: "ORGANISATION", count: 0, numbered: false, parent: 6 },
      { id: 3, kind: "list", name: "Docks", ...from, row: 6, group: "ORGANISATION", numbered: false, parent: 7 },
      { id: 4, kind: "list", name: "Products", ...from, row: 8, group: "Products", topLevel: "All Products", numbered: false },
      { id: 5, kind: "list", name: "Orders", ...from, row: 9, group: "Products", numbered: true, displayName: "Label" },
      { id: 6, kind: "subset", name: "Active Regions", ...from, row: 3, group: "ORGANISATION", parent: 0 },
      { id: 7, kind: "subset", name: "North, coastal", ...from, row: 3, group: "ORGANISATION", parent: 0 },
      { id: 8, kind: "property", name: "Code", ...from, row: 3, group: "ORGANISATION", parent: 0, format: "TEXT" },
      { id: 9, kind: "property", name: "Opened, on", ...from, row: 3, group: "ORGANISATION", parent: 0, format: "DATE" },
      { id: 10, kind: "property", name: "Rate", ...from, row: 3, group: "ORGANISATION", parent: 0, format: "NUMBER (2 dp, %)" },
      { id: 11, kind: "property", name: "Opened: Date", ...from, row: 3, group: "ORGANISATION", parent: 0, format: "DATE" },
      { id: 12, kind: "property", name: "Label", ...from, row: 9, group: "Products", parent: 5, format: "TEXT" },
    ]);
    // A list's parent is a list or a subset, as the cell writes it or out of its quotes. A dash is no parent, and a name
    // that is neither a list's nor a subset's matched nothing.
    expect(graph.edges).toEqual([[0, 1, "parent"], [0, 6, "subset"], [0, 7, "subset"], [6, 2, "parent"], [7, 3, "parent"]]);
    expect(graph.unresolved).toEqual([{ source: 5, field: "Parent Hierarchy", reference: "Tastes" }]);
    // "Odd" names no format, and "Tag:TEXT" has no space after its colon: neither is a property, and the map says so.
    expect(counted(graph)).toEqual(['2 parts of Properties cells do not read as "name: format" and are left out.']);
    expect(counted(buildModelGraph([generalLists(list("Regions", { Properties: "Odd" }))]))).toEqual(['1 part of a Properties cell does not read as "name: format" and is left out.']);
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
          "Referenced in Formula": "REV01 Revenue.Units, REV01 Revenue.'Gone item', Customers.Spend" }),
        list("Customers", { Properties: "Favourite: Products, Spend: NUMBER" })),
    ]);
    expect(links(graph)).toEqual(anyOrder([
      // What the list's own columns name. The module's Applies To says the first of these too: it is one link. A list's
      // property has a format and may have a formula, as a line item has.
      "Products -> REV01 Revenue (applies)", "Products -> COST01 Costs, direct.Rate (applies)",
      "Products -> REV01 Revenue.Product (format)", "Products -> Customers.Favourite (format)",
      "Products -> REV01 Revenue.Units (list_formula)", "Products -> Customers.Spend (list_formula)",
      // And the two line items that have their module's dimensions.
      "Products -> REV01 Revenue.Product (applies)", "Products -> REV01 Revenue.Units (applies)",
    ]));
    expect(links(graph)).toHaveLength(8);
    expect(unresolved(graph)).toEqual(["Products: Referenced in Applies To: Old module", "Products: Referenced in Formula: REV01 Revenue.'Gone item'"]);
    // The list's Referenced as Format names the line item, so the line item's list is known.
    expect(node(graph, "Product").formatList).toBe(node(graph, "Products").id);
  });

  it("links a list's Referenced columns only to what each can name, and leaves any other name unresolved", () => {
    const graph = buildModelGraph([
      lineItems(moduleRow("Sales plan"), item("Sales plan", "Volume")),
      generalLists(
        // A list applies to a module or a line item: not to a list, a subset or a list's property. It is the format, or in
        // the formula, of a line item or a list's property: not of a module, a list or a subset.
        list("Brands", { Properties: "Code: TEXT", "Referenced in Applies To": "Depots, Seasonal, Brands.Code, Sales plan",
          "Referenced as Format": "Sales plan, Depots, Sales plan.Volume, Brands.Code", "Referenced in Formula": "Sales plan, Seasonal, Brands.Code, Sales plan.Volume" }),
        list("Depots"),
        list("Seasons", { Subsets: "Seasonal" })),
    ]);
    expect(kindLinks(graph)).toEqual(anyOrder(["list Brands -> module Sales plan (applies)", "list Brands -> lineItem Sales plan.Volume (format)", "list Brands -> property Brands.Code (format)",
      "list Brands -> lineItem Sales plan.Volume (list_formula)", "list Brands -> property Brands.Code (list_formula)", "list Seasons -> subset Seasonal (subset)"]));
    expect(unresolved(graph)).toEqual(["Brands: Referenced in Applies To: Depots", "Brands: Referenced in Applies To: Seasonal", "Brands: Referenced in Applies To: Brands.Code",
      "Brands: Referenced as Format: Sales plan", "Brands: Referenced as Format: Depots", "Brands: Referenced in Formula: Sales plan", "Brands: Referenced in Formula: Seasonal"]);
    // No module here is named as a list is, so no name fits two objects.
    expect(counted(graph)).toEqual([]);
    // The list's column names Volume, and that is the link. Volume's own Format says it is a number: it is formatted as no list.
    expect([node(graph, "Volume").format, node(graph, "Volume").formatList]).toEqual(["NUMBER", undefined]);
  });

  it("takes a row of Line Items that names no module for a heading or a module, and a row that names one for its line item", () => {
    const graph = buildModelGraph([lineItems(
      moduleRow("SYS00 Settings", { "Time Scale": "Not Applicable", Versions: "Not Applicable", "Cell Count": "3", Notes: "Model settings" }),
      item("SYS00 Settings", "Horizon", { Summary: NO_SUMMARY, "Cell Count": "3", Code: "H1", Style: "Normal", Notes: "Years planned", "Time Scale": "Not Applicable", Versions: "Not Applicable" }),
      heading("-- 01 : REVENUE --"),
      // A Module Name, a Format, a Formula and a Summary of nothing but spaces say nothing: the row is the module's own.
      moduleRow("REV01 Revenue", { "Time Scale": "Month", "Time Range": "Model Calendar", Versions: "All", "Cell Count": "2,400", "Module Name": " ", Format: " ", Formula: "  ", Summary: " " }),
      item("REV01 Revenue", "Revenue", { Formula: "Units * Price", "Cell Count": "1200", "Time Scale": "Month", Versions: "All" }),
      // A line item that divides its module's line items is a line item: it names its module.
      item("REV01 Revenue", "--- Checks ---", { Format: NO_DATA, Summary: NO_SUMMARY, Style: "Heading 1" }),
      heading("------"),
      moduleRow("REV02 Margin"),
      heading("-- 02 : COSTS --"),
      moduleRow("COST01 Costs"),
      heading("-- 03 : ARCHIVE --"),
      // A line item's group is its module's, whatever heading stands nearest above its own row.
      item("REV01 Revenue", "Late"),
    )]);
    const from = { file: "Line Items" };
    expect(graph.nodes).toEqual([
      { id: 0, kind: "module", name: "SYS00 Settings", ...from, row: 2, group: "Ungrouped", notes: "Model settings", cells: 3, timeScale: "Not Applicable", versions: "Not Applicable" },
      // A line item says its format and its summary in a word, and keeps both cells as the export holds them.
      { id: 1, kind: "lineItem", name: "Horizon", ...from, row: 3, module: 0, group: "Ungrouped", format: "NUMBER", formatCell: NUMBER, cells: 3, notes: "Years planned", style: "Normal",
        timeScale: "Not Applicable", versions: "Not Applicable", code: "H1", summary: "NONE", summaryCell: NO_SUMMARY, inheritsDimensions: true },
      { id: 2, kind: "module", name: "REV01 Revenue", ...from, row: 5, group: "01 : REVENUE", cells: 2400, timeScale: "Month", timeRange: "Model Calendar", versions: "All" },
      { id: 3, kind: "lineItem", name: "Revenue", ...from, row: 6, module: 2, group: "01 : REVENUE", formula: "Units * Price", format: "NUMBER", formatCell: NUMBER, cells: 1200,
        timeScale: "Month", versions: "All", summary: "SUM", summaryCell: SUM, inheritsDimensions: true },
      { id: 4, kind: "lineItem", name: "--- Checks ---", ...from, row: 7, module: 2, group: "01 : REVENUE", format: "NONE", formatCell: NO_DATA, style: "Heading 1", summary: "NONE",
        summaryCell: NO_SUMMARY, inheritsDimensions: true },
      // A heading of nothing but dashes ends the group above it and names none.
      { id: 5, kind: "module", name: "REV02 Margin", ...from, row: 9, group: "Ungrouped" },
      { id: 6, kind: "module", name: "COST01 Costs", ...from, row: 11, group: "02 : COSTS" },
      { id: 7, kind: "lineItem", name: "Late", ...from, row: 13, module: 2, group: "01 : REVENUE", format: "NUMBER", formatCell: NUMBER, summary: "SUM", summaryCell: SUM, inheritsDimensions: true },
    ]);
    // The groups that a module is in, in the file's order, each once. A heading with no module under it is no section.
    expect(graph.sections).toEqual(["Ungrouped", "01 : REVENUE", "02 : COSTS"]);
    expect([graph.edges, graph.unresolved, counted(graph)]).toEqual([[], [], []]);
  });

  it("lists a line item's page filters from the Page Filters table, by its module's name and its own, and draws nothing of them", () => {
    const tables = [lineItems(moduleRow("REV01 Revenue"), item("REV01 Revenue", "Revenue"), item("REV01 Revenue", "Units"), moduleRow("REV02 Margin"),
      item("REV02 Margin", "Revenue"))];
    // The table as a model's run writes it (model-pages.ts), its condition's module first, and as 0.12.0's first runs
    // wrote it, an app's Filters rows with the app in front: each column is read by its name, the first one too.
    for (const headers of [PAGE_FILTERS_HEADERS, ["App", ...HEADERS.Filters]]) {
      const filter = (app: string, page: string, card: number, lineItem: string, module: string): Cell[] => headers.map(header =>
        ({ App: app, Page: page, "Card #": card, "Condition line item": lineItem, "Condition line item's module": module } as Record<string, Cell>)[header] ?? "-");
      const filters = file("Page Filters", [...headers], [filter("Planning app", "Demand board", 3, "Revenue", "REV01 Revenue"),
        filter("Another app", "Supply board", 1, "Revenue", "REV01 Revenue"), filter("Planning app", "Margins", 2, "Revenue", "REV02 Margin"),
        // A line item the map does not have, a condition that names none, and names with spaces at their ends.
        filter("Planning app", "Demand board", 4, "Gone", "REV01 Revenue"), filter("Planning app", "Demand board", 5, "-", "-"),
        filter("Planning app", "Spaced", 6, " Units ", "REV01 Revenue ")]);
      const graph = buildModelGraph([...tables, filters]);
      expect(graph.nodes.map(node => [node.name, node.pageFilters]), headers[0]).toEqual([["REV01 Revenue", undefined],
        ["Revenue", [{ app: "Planning app", page: "Demand board", card: "3" }, { app: "Another app", page: "Supply board", card: "1" }]],
        ["Units", [{ app: "Planning app", page: "Spaced", card: "6" }]], ["REV02 Margin", undefined], ["Revenue", [{ app: "Planning app", page: "Margins", card: "2" }]]]);
      // Nothing else changes: the same links, names and sentences as without the table.
      const plain = buildModelGraph(tables);
      expect([graph.edges, graph.unresolved, graph.limitations], headers[0]).toEqual([plain.edges, plain.unresolved, plain.limitations]);
    }
  });

  it("gives each module its Functional Area from Modules and its apps from Module Usage, and says which of the two the result has", () => {
    const tables = [lineItems(moduleRow("REV01 Revenue"), item("REV01 Revenue", "Revenue"), moduleRow("REV02 Margin"), item("REV02 Margin", "Margin"), moduleRow("SYS01 Time"))];
    const modules = file("Modules", ["", "Functional Area", "Applies To"], [["REV01 Revenue", " Sales ", ""], ["REV02 Margin", "-", ""], ["SYS01 Time", "Admin", ""], ["Gone", "Sales", ""], ["-- HEADING", "Sales", ""]]);
    // A row for each module and page, and one with no app for a module that no page uses (model-pages.ts).
    const usage = file("Module Usage", ["Module", "App", "Page", "Page type", "App ID", "Page ID"], [["REV01 Revenue", "Planning", "Board", "Board", "a", "p"],
      ["REV01 Revenue", "Planning", "Grid", "Worksheet", "a", "q"], ["REV01 Revenue", "Pricing", "Rates", "Board", "b", "r"], ["REV02 Margin", "-", "Not on any page", "-", "-", "-"],
      ["SYS01 Time ", "Admin app", "Setup", "Board", "c", "s"], ["Gone", "Planning", "Board", "Board", "a", "p"]]);
    const facts = (graph: ModelGraph): unknown[] => graph.nodes.filter(node => node.kind === "module").map(node => [node.name, node.functionalArea, node.apps]);
    const graph = buildModelGraph([...tables, modules, usage]);
    // A name is found as written, or without the spaces at its ends; a cell with nothing or a dash says nothing.
    expect([facts(graph), graph.moduleFacts]).toEqual([[["REV01 Revenue", "Sales", ["Planning", "Pricing"]], ["REV02 Margin", undefined, undefined], ["SYS01 Time", "Admin", ["Admin app"]]],
      { functionalAreas: true, moduleUsage: true }]);
    // Modules without the column, and no Module Usage: nothing of either. Nothing else of the graph changes with them.
    const plain = buildModelGraph([...tables, modulesFile("REV01 Revenue", "REV02 Margin", "SYS01 Time")]);
    expect([facts(plain), plain.moduleFacts]).toEqual([[["REV01 Revenue", undefined, undefined], ["REV02 Margin", undefined, undefined], ["SYS01 Time", undefined, undefined]], undefined]);
    expect([graph.edges, graph.unresolved, graph.limitations, graph.sections]).toEqual([plain.edges, plain.unresolved, plain.limitations, plain.sections]);
    expect(buildModelGraph([...tables, usage]).moduleFacts).toEqual({ functionalAreas: false, moduleUsage: true });
  });

  it("files each module of a model with 22 functional areas into its own area, whatever spaces its name has on either side, and says how Modules met the map", () => {
    // 22 modules, each with one to three line items, under two heading rows; the last two share an area. One module is
    // named as an area and a heading are, one is written with spaces in Line Items, another with spaces in Modules.
    const names = Array.from({ length: 22 }, (_, index) => `M${String(index).padStart(2, "0")} Module`);
    names[3] = " M03 Prices ";
    const rows: Cells[] = [heading("--- 000: Global System ---")];
    names.forEach((name, index) => {
      if (index === 11) rows.push(heading("--- 002: Parameters ---"));
      rows.push(moduleRow(name), ...Array.from({ length: (index % 3) + 1 }, (_, at) => item(name, `Value ${at + 1}`)));
    });
    for (const name of ["002: Parameters", "Loose", "Dashed", "Missing"]) rows.push(moduleRow(name), item(name, "Value 1"));
    const areaOf = (index: number): string => `${String(Math.min(index, 20)).padStart(3, "0")}: Area ${Math.min(index, 20)}`;
    // Modules lists the heading rows too, as an export does: each is a module of the model that only divides the list.
    const modules = file("Modules", ["", "Functional Area", "Applies To"], [["--- 000: Global System ---", "", ""], ["--- 002: Parameters ---", "000: Area 0", ""],
      ...names.map((name, index) => [index === 4 ? `  ${name} ` : name.trim(), areaOf(index), ""]),
      ["002: Parameters", "002: Parameters", ""], ["Loose", "", ""], ["Dashed", "-", ""], ["Gone", "009: Area 9", ""], ["-- HEADING", "000: Area 0", ""]]);
    const graph = buildModelGraph([lineItems(...rows), modules]);

    // Each module has the area its own row of Modules gives it, found by its name with or without the spaces at its ends;
    // a row with nothing or a dash gives none, and a module with no row has none.
    const areas = graph.nodes.filter(node => node.kind === "module").map(node => [node.name.trim(), node.functionalArea]);
    expect(areas).toEqual([...names.map((name, index) => [name.trim(), areaOf(index)]), ["002: Parameters", "002: Parameters"], ["Loose", undefined], ["Dashed", undefined], ["Missing", undefined]]);
    expect(graph.areaCheck).toEqual({ areas: 22, modules: 26, withArea: 23, rowsNotOnMap: ["Gone"], modulesNotInFile: ["Missing"] });
    expect(areaCheckLine(graph.areaCheck!)).toBe("Functional areas: 22 areas; 23 of the map's 26 modules have one; 1 row of Modules is no module of the map: Gone; "
      + "1 module of the map has no row in Modules: Missing.");

    // The map opens on the areas, 22 of them, in the order of their names, the modules with none last.
    const model = indexModel(graph);
    const area = groupingsOf(model).find(grouping => grouping.kind === "functionalArea")!;
    expect([automaticGrouping(groupingsOf(model))?.kind, area.groups.length, area.groups.slice(0, 4), area.groups.at(-1)])
      .toEqual(["functionalArea", 23, ["000: Area 0", "001: Area 1", "002: Area 2", "002: Parameters"], "No functional area"]);
    // Each box counts the modules of its own group and their line items: those of the grouping on screen, never those of
    // the heading rows.
    const boxes = (grouping: Grouping): [string, string][] => sectionsGraph(withGrouping(model, grouping), false).nodes.map(node => [node.label, node.meta]);
    const areaBoxes = new Map(boxes(area));
    expect([areaBoxes.get("000: Area 0"), areaBoxes.get("002: Parameters"), areaBoxes.get("020: Area 20"), areaBoxes.get("No functional area"), areaBoxes.size])
      .toEqual(["1 module · 1 line item", "1 module · 1 line item", "2 modules · 4 line items", "3 modules · 3 line items", 23]);
    const headings = groupingsOf(model).find(grouping => grouping.kind === "headings")!;
    expect(boxes(headings)).toEqual([["000: Global System", "11 modules · 21 line items"], ["002: Parameters", "15 modules · 26 line items"]]);
    // Without the Functional Area column, Modules says nothing of areas, and the log has no line for them.
    expect(buildModelGraph([lineItems(...rows), modulesFile(...names, "Loose")]).areaCheck).toBeUndefined();
  });

  it("says in one line how the Modules file's areas met the map, its lists of names cut to the first five", () => {
    expect(areaCheckLine({ areas: 1, modules: 1, withArea: 1, rowsNotOnMap: [], modulesNotInFile: [] }))
      .toBe("Functional areas: 1 area; 1 of the map's 1 module has one; 0 rows of Modules are no module of the map; 0 modules of the map have no row in Modules.");
    const many = Array.from({ length: 7 }, (_, index) => `Module ${index + 1}`);
    expect(areaCheckLine({ areas: 0, modules: 7, withArea: 0, rowsNotOnMap: many, modulesNotInFile: many }))
      .toBe("Functional areas: 0 areas; 0 of the map's 7 modules have one; 7 rows of Modules are no module of the map: Module 1; Module 2; Module 3; Module 4; Module 5; and 2 more; "
        + "7 modules of the map have no row in Modules: Module 1; Module 2; Module 3; Module 4; Module 5; and 2 more.");
  });

  it("takes a row with no Module Name for a line item, and leaves it out, when it has a format, a formula or a summary", () => {
    // Each of the three alone marks the row: a module's own row has none of them.
    const marked = (cells: Cells): string[] => {
      const graph = buildModelGraph([lineItems(moduleRow("REV01 Revenue"), { "": "Margin", ...cells }, item("REV01 Revenue", "Units"))]);
      return [graph.nodes.map(each => each.name).join(", "), ...counted(graph)];
    };
    const leftOut = ["REV01 Revenue, Units", "1 row of Line Items is no module's own and names no module: it is left out."];
    expect([marked({ Format: NUMBER }), marked({ Formula: "Units * 2" }), marked({ Summary: SUM })]).toEqual([leftOut, leftOut, leftOut]);
    expect(marked({ Notes: "Only a note" })).toEqual(["REV01 Revenue, Margin, Units"]);
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
    // Beside the word, the node keeps each cell exactly as the export holds it, whatever the cell is: the map says a format
    // and a summary in the page's words from the cells. Only an empty cell is not kept.
    expect(formats.map((_, index) => node(graph, `Format ${index}`).formatCell)).toEqual(formats.map(([cell]) => cell || undefined));
    expect(summaries.map((_, index) => node(graph, `Summary ${index}`).summaryCell)).toEqual(summaries.map(([cell]) => cell || undefined));
    // A detail that says nothing is not on the node at all.
    expect(Object.keys(node(graph, "Format 12"))).toEqual(["id", "kind", "name", "file", "row", "module", "group", "summary", "summaryCell", "inheritsDimensions"]);
    expect("format" in node(graph, "Format 13") || "summary" in node(graph, "Summary 2") || "formatCell" in node(graph, "Format 12") || "summaryCell" in node(graph, "Summary 3")).toBe(false);
  });

  it("keeps the names of the two line items a Ratio summary divides, from the export's own columns, where they are filled", () => {
    const RATIO = JSON.stringify({ summaryMethod: "RATIO", timeSummaryMethod: "RATIO", ratioNumeratorIdentifier: "_1901000000002_", ratioDenominatorIdentifier: "_1901000000003_" });
    const rows = lineItems(
      // A module's own row has neither cell, and no ratio.
      moduleRow("REV01 Revenue", { "Ratio Numerator": "Profit" }),
      item("REV01 Revenue", "Margin %", { Summary: RATIO, "Ratio Numerator": "Profit", "Ratio Denominator": "Revenue" }),
      // A name the export could not give is not there, and nothing is put in its place.
      item("REV01 Revenue", "Share %", { Summary: RATIO, "Ratio Denominator": "Revenue" }),
      item("REV01 Revenue", "Profit"),
      item("REV01 Revenue", "Revenue"));
    const graph = buildModelGraph([rows]);
    const ratio = (among: ModelGraph, name: string) => [node(among, name).summary, node(among, name).summaryCell, node(among, name).ratioNumerator, node(among, name).ratioDenominator];
    expect([ratio(graph, "Margin %"), ratio(graph, "Share %"), ratio(graph, "Profit")]).toEqual([["RATIO", RATIO, "Profit", "Revenue"], ["RATIO", RATIO, undefined, "Revenue"], ["SUM", SUM, undefined, undefined]]);
    expect(Object.keys(node(graph, "REV01 Revenue"))).toEqual(["id", "kind", "name", "file", "row", "group"]);
    // The names are kept as text: they are no links, and a name that is no line item's is not unresolved.
    expect([graph.edges, graph.unresolved]).toEqual([[], []]);
    // A file without the two columns, as the export wrote it before it had them, gives the same without the names, and
    // the map says nothing of the columns.
    const before = buildModelGraph([without(rows, "Ratio Numerator", "Ratio Denominator")]);
    expect([ratio(before, "Margin %"), before.limitations]).toEqual([["RATIO", RATIO, undefined, undefined], graph.limitations]);
    // Without the Format and Summary columns there are no cells to keep, and the map says which columns it lacks.
    const bare = buildModelGraph([without(rows, "Format", "Summary")]);
    expect([node(bare, "Margin %").formatCell, node(bare, "Margin %").summaryCell, node(bare, "Margin %").ratioNumerator]).toEqual([undefined, undefined, "Profit"]);
    expect(bare.limitations.filter(line => line.startsWith("Line Items has no"))).toEqual([
      "Line Items has no Format column: line items come without their format, and the list of one formatted as a list is known only where the Format List column names it.",
      "Line Items has no Summary column: modules and line items come without it."]);
  });

  it("gives a line item with a dash under Applies To its module's dimensions, and says that they are the module's", () => {
    const graph = buildModelGraph([
      lineItems(
        moduleRow("REV01 Revenue", { "Applies To": "Products, 'Regions, north', Users, Time" }),
        item("REV01 Revenue", "Units"),
        item("REV01 Revenue", "Price", { "Applies To": "Products" }),
        item("REV01 Revenue", "Rate", { "Applies To": "" }),
        item("REV01 Revenue", "Core flag", { "Applies To": "Core Products, Users, Users" }),
        item("REV01 Revenue", "Volume"),
        // A dash on a module's own row is no dimension, and the module has nothing to take them from.
        moduleRow("SYS00 Settings", { "Applies To": "-" }),
        item("SYS00 Settings", "Horizon")),
      generalLists(list("Products", { Subsets: "Core Products" }), list("Regions, north")),
    ]);
    const dimensions = (name: string) => [names(graph, node(graph, name).dimensions), node(graph, name).inheritsDimensions];
    expect(dimensions("REV01 Revenue")).toEqual([["Products", "Regions, north"], undefined]);
    // The module's, in the module's order.
    expect([dimensions("Units"), dimensions("Volume")]).toEqual([[["Products", "Regions, north"], true], [["Products", "Regions, north"], true]]);
    // Its own: a list, a subset, or none at all, which an empty cell says and a dash does not.
    expect([dimensions("Price"), dimensions("Core flag"), dimensions("Rate")]).toEqual([[["Products"], undefined], [["Core Products"], undefined], [undefined, undefined]]);
    // A module without dimensions gives none, and the line item still has its module's.
    expect([dimensions("SYS00 Settings"), dimensions("Horizon")]).toEqual([[undefined, undefined], [undefined, true]]);
    expect(links(graph, "applies")).toEqual(anyOrder([
      "Products -> REV01 Revenue (applies)", "Regions, north -> REV01 Revenue (applies)", "Products -> REV01 Revenue.Units (applies)", "Regions, north -> REV01 Revenue.Units (applies)",
      "Products -> REV01 Revenue.Volume (applies)", "Regions, north -> REV01 Revenue.Volume (applies)",
      "Products -> REV01 Revenue.Price (applies)", "Core Products -> REV01 Revenue.Core flag (applies)"]));
    // A dimension that is no list of General Lists is unresolved once, for the cell that holds it: the module's for the two
    // line items that take theirs from it, and a line item's own once though its cell says it twice.
    expect(unresolved(graph)).toEqual(["REV01 Revenue: Applies To: Users", "REV01 Revenue: Applies To: Time", "REV01 Revenue.Core flag: Applies To: Users"]);
  });

  it("links what drives who may read and write a module or a line item, and gives a line item with a dash its module's driver", () => {
    const graph = buildModelGraph([
      lineItems(
        moduleRow("ACC01 Access"),
        item("ACC01 Access", "Can read", { Format: BOOLEAN }),
        item("ACC01 Access", "Can write", { Format: BOOLEAN }),
        // A dash on a module's own row is no driver.
        moduleRow("REV01 Revenue", { "Read Access Driver": "'ACC01 Access'.Can read", "Write Access Driver": "-" }),
        item("REV01 Revenue", "Units", { "Read Access Driver": "-", "Write Access Driver": "ACC01 Access.Can write" }),
        // A bare name is a line item of the same module. The module has no write driver to give.
        item("REV01 Revenue", "Price", { "Read Access Driver": "Local flag", "Write Access Driver": "-" }),
        // An empty cell is no dash: nothing is taken from the module.
        item("REV01 Revenue", "Local flag", { Format: BOOLEAN }),
        item("REV01 Revenue", "Broken", { "Read Access Driver": "Gone.Driver" }),
        // A driver is a line item. A list, a module, a subset and a list's property of the name are none.
        item("REV01 Revenue", "By list", { "Read Access Driver": "Open periods", "Write Access Driver": "ACC01 Access" }),
        item("REV01 Revenue", "By subset", { "Read Access Driver": "Seasonal", "Write Access Driver": "Seasons.Code" }),
        // A driver that names nothing on a module's row is the module's to say, not each line item's that has it by a dash.
        moduleRow("COST01 Costs", { "Write Access Driver": "Gone.Flag" }),
        item("COST01 Costs", "Rent", { "Write Access Driver": "-" }),
        item("COST01 Costs", "Rates", { "Write Access Driver": "-" })),
      generalLists(list("Open periods"), list("Seasons", { Subsets: "Seasonal", Properties: "Code: TEXT" })),
    ]);
    expect(links(graph, "read_access", "write_access")).toEqual(anyOrder([
      "ACC01 Access.Can read -> REV01 Revenue (read_access)", "ACC01 Access.Can read -> REV01 Revenue.Units (read_access)",
      "ACC01 Access.Can write -> REV01 Revenue.Units (write_access)", "REV01 Revenue.Local flag -> REV01 Revenue.Price (read_access)"]));
    expect(unresolved(graph)).toEqual(["REV01 Revenue.Broken: Read Access Driver: Gone.Driver",
      "REV01 Revenue.By list: Read Access Driver: Open periods", "REV01 Revenue.By list: Write Access Driver: ACC01 Access",
      "REV01 Revenue.By subset: Read Access Driver: Seasonal", "REV01 Revenue.By subset: Write Access Driver: Seasons.Code",
      "COST01 Costs: Write Access Driver: Gone.Flag"]);
  });

  it("links a line item to what its Referenced By names, as a formula link, or as an access link where that one names it as its driver", () => {
    const graph = buildModelGraph([
      lineItems(
        // A module's own row has no Referenced By: a cell that holds one all the same is not read.
        moduleRow("REV01 Revenue", { "Referenced By": "Units" }),
        item("REV01 Revenue", "Units", { "Referenced By": "Revenue, 'COST01 Costs'.Share", "Write Access Driver": "Open" }),
        item("REV01 Revenue", "Price", { "Referenced By": "Revenue" }),
        // A line item of another module, a list's property, a name that matches nothing, a module by its bare name, and a
        // name of three parts, which names nothing though its first two are a line item's.
        item("REV01 Revenue", "Revenue", { "Referenced By": "'REP01 Report, monthly'.'Revenue, net', Customers.Spend, Gone.Item, 'REP01 Report, monthly', REV01 Revenue.Units.more" }),
        // Units names it as its write driver and nothing more; Price's formula refers to it.
        item("REV01 Revenue", "Open", { Format: BOOLEAN, "Referenced By": "Units, Price" }),
        // A formula may refer to its own line item. A list and a subset have no formula, and are not what refers to one.
        item("REV01 Revenue", "Stock", { "Referenced By": "Stock, Stock, Customers, Loyal" }),
        moduleRow("COST01 Costs"),
        item("COST01 Costs", "Share"),
        moduleRow("REP01 Report, monthly"),
        item("REP01 Report, monthly", "Revenue, net")),
      generalLists(list("Customers", { Properties: "Spend: NUMBER", Subsets: "Loyal" })),
    ]);
    expect(links(graph, "reference", "read_access", "write_access")).toEqual(anyOrder([
      "REV01 Revenue.Units -> REV01 Revenue.Revenue (reference)", "REV01 Revenue.Units -> COST01 Costs.Share (reference)", "REV01 Revenue.Price -> REV01 Revenue.Revenue (reference)",
      "REV01 Revenue.Revenue -> REP01 Report, monthly.Revenue, net (reference)", "REV01 Revenue.Revenue -> Customers.Spend (reference)",
      "REV01 Revenue.Revenue -> REP01 Report, monthly (reference)",
      "REV01 Revenue.Open -> REV01 Revenue.Units (write_access)", "REV01 Revenue.Open -> REV01 Revenue.Price (reference)",
      "REV01 Revenue.Stock -> REV01 Revenue.Stock (reference)"]));
    expect(unresolved(graph)).toEqual(["REV01 Revenue.Revenue: Referenced By: Gone.Item", "REV01 Revenue.Revenue: Referenced By: REV01 Revenue.Units.more",
      "REV01 Revenue.Stock: Referenced By: Customers", "REV01 Revenue.Stock: Referenced By: Loyal"]);
  });

  it("draws the access link alone for what a line item drives, also where the driver is the module's, taken through a dash", () => {
    const graph = buildModelGraph([lineItems(
      moduleRow("ACC01 Access"),
      // Total's formula refers to this Flag. Total's driver is the Flag of its own module, which is another line item.
      item("ACC01 Access", "Flag", { Format: BOOLEAN, "Referenced By": "REP01 Report.Total, REP01 Report.Detail" }),
      moduleRow("REP01 Report", { "Read Access Driver": "ACC01 Access.Flag" }),
      item("REP01 Report", "Flag", { Format: BOOLEAN, "Referenced By": "Total" }),
      item("REP01 Report", "Total", { "Read Access Driver": "Flag" }),
      // Detail has the module's driver, which is the first Flag: that is why the first Flag's Referenced By names it.
      item("REP01 Report", "Detail", { "Read Access Driver": "-" }),
    )]);
    expect(links(graph)).toEqual(anyOrder([
      "ACC01 Access.Flag -> REP01 Report.Total (reference)",
      "ACC01 Access.Flag -> REP01 Report.Detail (read_access)",
      "ACC01 Access.Flag -> REP01 Report (read_access)",
      "REP01 Report.Flag -> REP01 Report.Total (read_access)"]));
    expect(unresolved(graph)).toEqual([]);
  });

  it("reads a module's driver in that module: a line item of another module with the driver's name does not drive it", () => {
    const graph = buildModelGraph([lineItems(
      moduleRow("Access A"),
      // Report B's formula... a module has none: the export names the module here, and that is a formula link to it.
      item("Access A", "Flag", { Format: BOOLEAN, "Referenced By": "Report B" }),
      // The module's own row names its driver by a bare name, which is its own line item Flag.
      moduleRow("Report B", { "Read Access Driver": "Flag" }),
      item("Report B", "Flag", { Format: BOOLEAN, "Referenced By": "Report B" }),
      item("Report B", "Total"),
    )]);
    expect(links(graph)).toEqual(anyOrder(["Access A.Flag -> Report B (reference)", "Report B.Flag -> Report B (read_access)"]));
    expect(unresolved(graph)).toEqual([]);
  });

  it("takes a bare name for a line item of the row's own module first, and a dimension that a list and a subset both name for neither", () => {
    const graph = buildModelGraph([
      lineItems(
        moduleRow("ACC01 Access"),
        item("ACC01 Access", "Shared", { Format: BOOLEAN }),
        // A bare name is a line item of the row's own module where the module has one of that name, though a module, a
        // list and a subset have the name too.
        item("ACC01 Access", "Own", { "Read Access Driver": "Shared", "Referenced By": "Shared" }),
        // A list and a subset of one name: the dimension is neither's.
        moduleRow("Shared", { "Applies To": "Shared, Core" }),
        moduleRow("REP01 Report"),
        // In a module with no line item of the name, a bare name in Referenced By is the module, and a driver, which is
        // a line item, is nothing.
        item("REP01 Report", "Other", { "Write Access Driver": "Shared", "Referenced By": "Shared" })),
      generalLists(
        list("Shared", { Subsets: "Core" }),
        // A parent that a list and a subset both have the name of is neither. A list's own columns name the module of the name.
        list("Regions", { Subsets: "Shared", "Parent Hierarchy": "Shared", "Referenced in Applies To": "Shared" })),
    ]);
    expect(kindLinks(graph)).toEqual(anyOrder([
      "list Shared -> subset Core (subset)", "list Regions -> subset Shared (subset)",
      "lineItem ACC01 Access.Shared -> lineItem ACC01 Access.Own (read_access)", "lineItem ACC01 Access.Own -> lineItem ACC01 Access.Shared (reference)",
      "subset Core -> module Shared (applies)",
      "lineItem REP01 Report.Other -> module Shared (reference)",
      "list Regions -> module Shared (applies)"]));
    expect([node(graph, "Regions").parent, names(graph, node(graph, "Shared", "module").dimensions)]).toEqual([undefined, ["Core"]]);
    expect(unresolved(graph)).toEqual(["Regions: Parent Hierarchy: Shared", "Shared: Applies To: Shared", "REP01 Report.Other: Write Access Driver: Shared"]);
    expect(counted(graph)).toEqual([]);
  });

  it("takes a name that fits both a module's line item and a list's property for the line item, and counts each such name", () => {
    // A module named as its list is, with line items named as the list's properties are.
    const graph = buildModelGraph([
      lineItems(
        moduleRow("Products"),
        item("Products", "Code"),
        item("Products", "Price"),
        item("Products", "Margin"),
        moduleRow("REP01 Report"),
        // Behind a dot, Products.Code is the module's line item and the list's property. It is the line item in a
        // Referenced By, however it is written and however often. Products.Label is the property's alone, and
        // Products.Margin the line item's alone.
        item("REP01 Report", "Total", { "Referenced By": "Products.Code, 'Products'.Code, Products.'Code', Products.Label, Products.Margin", "Read Access Driver": "Products.Price" }),
        item("REP01 Report", "Detail", { "Referenced By": "Products.Code" })),
      generalLists(
        list("Products", { Properties: "Code: TEXT, Price: NUMBER, Label: TEXT" }),
        // And so in a list's Referenced as Format and Referenced in Formula.
        list("Regions", { "Referenced as Format": "Products.Code, Products.Label", "Referenced in Formula": "Products.Price, Products.Label" })),
    ]);
    expect(kindLinks(graph)).toEqual(anyOrder([
      "lineItem REP01 Report.Total -> lineItem Products.Code (reference)", "lineItem REP01 Report.Total -> property Products.Label (reference)",
      "lineItem REP01 Report.Total -> lineItem Products.Margin (reference)", "lineItem REP01 Report.Detail -> lineItem Products.Code (reference)",
      "lineItem Products.Price -> lineItem REP01 Report.Total (read_access)",
      "list Regions -> lineItem Products.Code (format)", "list Regions -> property Products.Label (format)",
      "list Regions -> lineItem Products.Price (list_formula)", "list Regions -> property Products.Label (list_formula)"]));
    expect(graph.unresolved).toEqual([]);
    // Two names fit both: Products.Code, said in four cells, and Products.Price, said in one. Each is counted once.
    const TWO = "2 names fit both a line item and a list property of the same name, and are taken for the line item.";
    expect(counted(graph)).toEqual([TWO]);
    // The sentence stands after what was left out and before what the map always says.
    expect(graph.limitations).toEqual([NO_MODULES_FILE, ...NO_ACTIONS, TWO, LIST_ITEMS, LINKS]);

    // One such name is said as one.
    const one = buildModelGraph([lineItems(moduleRow("Plan"), item("Plan", "Code", { "Referenced By": "Plan.Code" })), generalLists(list("Plan", { Properties: "Code: TEXT" }))]);
    expect([kindLinks(one), counted(one)]).toEqual([["lineItem Plan.Code -> lineItem Plan.Code (reference)"],
      ["1 name fits both a line item and a list property of the same name, and is taken for the line item."]]);
    // A name is counted only where it is read in a column that could mean the property. A driver is a line item, and a
    // list applies to a line item: there the name fits one object, and nothing is said.
    const certain = buildModelGraph([lineItems(moduleRow("Plan"), item("Plan", "Code"), item("Plan", "Units", { "Read Access Driver": "Plan.Code" })),
      generalLists(list("Plan", { Properties: "Code: TEXT", "Referenced in Applies To": "Plan.Code" }))]);
    expect([kindLinks(certain), counted(certain), certain.unresolved]).toEqual([anyOrder(["lineItem Plan.Code -> lineItem Plan.Units (read_access)", "list Plan -> lineItem Plan.Code (applies)"]), [], []]);
    // And a module and a list of one name whose line items and properties share no name give nothing to count.
    const apart = buildModelGraph([lineItems(moduleRow("Plan"), item("Plan", "Units", { "Referenced By": "Plan.Code, Plan.Units" })), generalLists(list("Plan", { Properties: "Code: TEXT" }))]);
    expect([kindLinks(apart), counted(apart)]).toEqual([anyOrder(["lineItem Plan.Units -> property Plan.Code (reference)", "lineItem Plan.Units -> lineItem Plan.Units (reference)"]), []]);
  });

  it("matches names written in quotes, with commas, dots, apostrophes and doubled quotes inside", () => {
    const PLAN = "It's a 'plan', v1.2";
    const quotedPlan = "'It''s a ''plan'', v1.2'";
    const graph = buildModelGraph([
      lineItems(
        moduleRow(PLAN, { "Applies To": "'Regions, north & south', 'O''Brien''s', Products, 'Top, sellers'" }),
        item(PLAN, "Rate, net (50%)", { "Referenced By": "REP01 Report.Total, 'Margin.net', Products.'Launch, first'" }),
        item(PLAN, "Margin.net", { "Read Access Driver": `${quotedPlan}.'Rate, net (50%)'` }),
        moduleRow("REP01 Report"),
        item("REP01 Report", "Total", { "Referenced By": `${quotedPlan}.'Rate, net (50%)', ${quotedPlan}.Margin.net`, "Write Access Driver": `${quotedPlan}.'Margin.net'` })),
      generalLists(
        list("Regions, north & south", { "Referenced in Applies To": quotedPlan, "Referenced in Formula": `${quotedPlan}.'Rate, net (50%)'` }),
        list("O'Brien's"),
        // A subset and a property written in quotes are found by what names them.
        list("Products", { Subsets: "'Top, sellers'", Properties: "'Launch, first': DATE" })),
    ]);
    expect(names(graph, node(graph, PLAN).dimensions)).toEqual(["Regions, north & south", "O'Brien's", "Products", "Top, sellers"]);
    expect(links(graph, "reference", "read_access", "write_access", "list_formula")).toEqual(anyOrder([
      `Regions, north & south -> ${PLAN}.Rate, net (50%) (list_formula)`,
      `${PLAN}.Rate, net (50%) -> REP01 Report.Total (reference)`,
      `${PLAN}.Rate, net (50%) -> Products.Launch, first (reference)`,
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
      // No name in Format List: the list is the one whose Referenced as Format names the line item, or one with this ID.
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
      // A name in Format List that is no list of General Lists is unresolved, and nothing is put in its place: not the
      // list of the ID, and not a subset of the name.
      item("REV01 Revenue", "Flavour", { Format: listFormat(101000000002), "Format List": "Tastes" }),
      item("REV01 Revenue", "Core pick", { Format: listFormat(101000000001), "Format List": "Core" }),
    ];
    const lists = generalLists(list("Products", { Subsets: "Core", "Referenced as Format": "REV01 Revenue.Product" }), list("Regions", { "Referenced as Format": "REV01 Revenue.Region" }),
      list("Channels"));
    const deleteChannels = otherActions(action("Delete old channels", { Action: '{"actionType":"DELETE_BY_SELECTION","hierarchyIdentifier":"_101000000003_"}' }));
    const graph = buildModelGraph([lineItems(...rows), lists, deleteChannels]);
    const all = ["Product", "Region", "Other region", "Channel", "Channel as text", "Subset pick", "Stale", "Flavour", "Core pick"];
    const listOf = (among: ModelGraph, name: string): string | undefined => names(among, [node(among, name).formatList].flatMap(id => (id === undefined ? [] : [id])))?.[0];
    expect(all.map(name => listOf(graph, name))).toEqual(["Products", "Regions", "Regions", "Channels", "Channels", undefined, undefined, undefined, undefined]);
    expect(links(graph, "format")).toEqual(anyOrder(["Products -> REV01 Revenue.Product (format)", "Regions -> REV01 Revenue.Region (format)", "Regions -> REV01 Revenue.Other region (format)",
      "Channels -> REV01 Revenue.Channel (format)", "Channels -> REV01 Revenue.Channel as text (format)"]));
    // An action names its list by the same ID.
    expect(links(graph, "action_target")).toEqual(["Delete old channels -> Channels (action_target)"]);
    expect(unresolved(graph)).toEqual(["REV01 Revenue.Flavour: Format List: Tastes", "REV01 Revenue.Core pick: Format List: Core"]);
    // The line item whose list the export does not name is counted: nothing links it to a list.
    expect(counted(graph)).toEqual(["1 line item is formatted as a list that the export does not name, and has no list on the map."]);

    // A file from before the export had the column: the prototype's rule alone. Channels' ID is then known from nothing.
    const before = buildModelGraph([without(lineItems(...rows), "Format List"), lists, deleteChannels]);
    expect(all.map(name => listOf(before, name))).toEqual(["Products", "Regions", "Regions", undefined, undefined, undefined, undefined, "Regions", "Products"]);
    expect(unresolved(before)).toEqual(["Delete old channels: hierarchyIdentifier: 101000000003"]);
    expect(counted(before)).toEqual(["3 line items are formatted as a list that the export does not name, and have no list on the map."]);
  });

  it("learns a list's ID only from what the list is the format of, not from what it applies to or what names it in a formula", () => {
    const graph = buildModelGraph([
      lineItems(
        moduleRow("Stock", { "Applies To": "Depots" }),
        item("Stock", "Product", { Format: listFormat(101000000002) }),
        item("Stock", "Other product", { Format: listFormat(101000000002) })),
      // Depots applies to Product and is named in its formula. Product is formatted as Products, and so is the ID.
      generalLists(list("Depots", { "Referenced in Applies To": "Stock, Stock.Product", "Referenced in Formula": "Stock.Product" }), list("Products", { "Referenced as Format": "Stock.Product" })),
    ]);
    expect(links(graph, "format")).toEqual(anyOrder(["Products -> Stock.Product (format)", "Products -> Stock.Other product (format)"]));
    expect([node(graph, "Product").formatList, node(graph, "Other product").formatList, counted(graph)]).toEqual([node(graph, "Products").id, node(graph, "Products").id, []]);
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
    // What each list's own column names is that list's: that is what the export says. The ID settles nothing more, and
    // the third line item, which only the ID could give a list, has none.
    expect(links(graph)).toEqual(anyOrder(["Products -> REV01 Revenue.Product (format)", "Old products -> REV01 Revenue.Second product (format)"]));
    expect(graph.nodes.filter(each => each.kind === "lineItem").map(each => each.formatList)).toEqual([0, 1, undefined]);
    // The sentence about the ID stands before the one that counts the line item, and both before what the map always says.
    expect(graph.limitations).toEqual([NO_MODULES_FILE, ...NO_ACTIONS, "1 list ID stands for more than one list in the export, and names none on the map.",
      "1 line item is formatted as a list that the export does not name, and has no list on the map.", LIST_ITEMS, LINKS]);
    // Format List says which list the ID is, and that settles it.
    const named = buildModelGraph([lineItems(...rows.map(row => (row["Module Name"] ? { ...row, "Format List": "Products" } : row))), lists]);
    expect(named.nodes.filter(each => each.kind === "lineItem").map(each => each.formatList)).toEqual([0, 0, 0]);
    expect(counted(named)).toEqual([]);
    // Unless Format List itself gives the ID to two lists. Each line item still has the list its own row names, and
    // the ID, which an action would name its list by, is neither's.
    const twice = buildModelGraph([
      lineItems(rows[0], { ...rows[1], "Format List": "Products" }, { ...rows[2], "Format List": "Old products" }, { ...rows[3], "Format List": "" }),
      generalLists(list("Products"), list("Old products")),
      otherActions(action("Delete old products", { Action: '{"actionType":"DELETE_BY_SELECTION","hierarchyIdentifier":"_101000000001_"}' }))]);
    expect(twice.nodes.filter(each => each.kind === "lineItem").map(each => each.formatList)).toEqual([0, 1, undefined]);
    expect([counted(twice), unresolved(twice)]).toEqual([
      ["1 list ID stands for more than one list in the export, and names none on the map.", "1 line item is formatted as a list that the export does not name, and has no list on the map."],
      ["Delete old products: hierarchyIdentifier: 101000000001"]]);
    // A line item that two lists' columns both name is neither's.
    const both = buildModelGraph([lineItems(rows[0], rows[1]), generalLists(list("Products", { "Referenced as Format": "REV01 Revenue.Product" }),
      list("Old products", { "Referenced as Format": "REV01 Revenue.Product" }))]);
    expect([both.nodes.filter(each => each.kind === "lineItem").map(each => each.formatList), links(both), counted(both)]).toEqual([[undefined],
      anyOrder(["Products -> REV01 Revenue.Product (format)", "Old products -> REV01 Revenue.Product (format)"]), ["1 list ID stands for more than one list in the export, and names none on the map."]]);
    const three = buildModelGraph([lineItems(rows[0], { ...rows[1], Format: listFormat(101000000002) }, rows[2], { ...rows[3], Format: listFormat(101000000002) }),
      generalLists(list("Products", { "Referenced as Format": "REV01 Revenue.Product, REV01 Revenue.'Second product'" }),
        list("Old products", { "Referenced as Format": "REV01 Revenue.'Second product', REV01 Revenue.'Third product'" }), list("Regions", { "Referenced as Format": "REV01 Revenue.Product" }))]);
    expect(counted(three)).toEqual(["2 list IDs each stand for more than one list in the export, and name none on the map."]);
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
    expect(graph.nodes.map(each => `${each.kind} ${each.name} row ${each.row}`)).toEqual(["module REV01 Revenue row 2", "lineItem Units row 3", "module ARC01 Archive row 6",
      "module NEW01 Added row 7", "lineItem Note row 8"]);
    expect(counted(graph)).toEqual(["2 rows of Line Items are no module's own and name no module: they are left out."]);

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

  it("makes the processes and the actions from their four tables, and links each action to the processes that use it", () => {
    const run = { "Start Date and Time (UTC)": "2026-03-12 23:19:56", "Most recent duration (ms)": "1,582", Notes: "From the hub" };
    const graph = buildModelGraph([
      processesFile(action("Nightly load", { Notes: "Runs at 2am" }), heading("-- LOADS --"), action("Nightly load, full"), action("Weekly"), action("Daily"), action("Daily, Weekly")),
      importsFile(
        action("Load prices", { "Used in Processes": "Nightly load, Nightly load, full", ...run }),
        action("Load regions", { "Used in Processes": "Nightly load, full, Gone process, Gone process" }),
        // Daily and Weekly, or the one process "Daily, Weekly": the cell reads two ways, and the whole of it is unresolved.
        action("Load plan", { "Used in Processes": "Nightly load, Daily, Weekly" }),
        heading("--- old imports ---"),
        // A dash is an empty cell.
        action("Old import", { "Used in Processes": "-" })),
      exportsFile(action("Send prices", { Action: "Export from 'Prices'", "Used in Processes": "Weekly" }), action("Send grid", { Action: '{"exportType":"GRID_CURRENT_PAGE"}' })),
      otherActions(
        action("Delete old regions", { Action: '{"actionType":"DELETE_BY_SELECTION","hierarchyIdentifier":"_101000000002_"}', "Used in Processes": "Daily, Weekly, Daily" }),
        action("Open the review", { Action: "Open Dashboard" }),
        heading("-- OLD --"),
        heading("........"),
        action("No kind", { Action: '{"hierarchyIdentifier":"","sourceHierarchyIdentifier":0}' })),
    ]);
    // Each row is numbered in its own table, the header as row 1. A row named as a heading is no node.
    expect(graph.nodes).toEqual([
      { id: 0, kind: "process", name: "Nightly load", file: "Processes", row: 2, notes: "Runs at 2am" },
      { id: 1, kind: "process", name: "Nightly load, full", file: "Processes", row: 4 },
      { id: 2, kind: "process", name: "Weekly", file: "Processes", row: 5 },
      { id: 3, kind: "process", name: "Daily", file: "Processes", row: 6 },
      { id: 4, kind: "process", name: "Daily, Weekly", file: "Processes", row: 7 },
      { id: 5, kind: "action", name: "Load prices", file: "Imports", row: 2, actionType: "Import", notes: "From the hub", lastRun: "2026-03-12 23:19:56", durationMs: 1582 },
      { id: 6, kind: "action", name: "Load regions", file: "Imports", row: 3, actionType: "Import" },
      { id: 7, kind: "action", name: "Load plan", file: "Imports", row: 4, actionType: "Import" },
      { id: 8, kind: "action", name: "Old import", file: "Imports", row: 6, actionType: "Import" },
      { id: 9, kind: "action", name: "Send prices", file: "Exports", row: 2, actionType: "Export", action: "Export from 'Prices'" },
      { id: 10, kind: "action", name: "Send grid", file: "Exports", row: 3, actionType: "Export", action: '{"exportType":"GRID_CURRENT_PAGE"}' },
      // Another action's kind is what its definition says, and "Other" where it says none.
      { id: 11, kind: "action", name: "Delete old regions", file: "Other Actions", row: 2, actionType: "DELETE_BY_SELECTION", action: '{"actionType":"DELETE_BY_SELECTION","hierarchyIdentifier":"_101000000002_"}' },
      { id: 12, kind: "action", name: "Open the review", file: "Other Actions", row: 3, actionType: "Other", action: "Open Dashboard" },
      { id: 13, kind: "action", name: "No kind", file: "Other Actions", row: 6, actionType: "Other", action: '{"hierarchyIdentifier":"","sourceHierarchyIdentifier":0}' }]);
    // The processes of an action are written without quotes: "Nightly load, full" is one process, not two.
    expect(links(graph)).toEqual(anyOrder(["Nightly load -> Load prices (process_action)", "Nightly load, full -> Load prices (process_action)",
      "Nightly load, full -> Load regions (process_action)", "Weekly -> Send prices (process_action)"]));
    // A name that is no process is unresolved once, though the cell says it twice.
    expect(unresolved(graph)).toEqual(["Load regions: Used in Processes: Gone process", "Load plan: Used in Processes: Nightly load, Daily, Weekly", "Send prices: Action: 'Prices'",
      "Delete old regions: Used in Processes: Daily, Weekly, Daily", "Delete old regions: hierarchyIdentifier: 101000000002"]);
    // The rows named as headings are counted for each table that has them, after what the table lacks.
    expect(graph.limitations).toEqual([NOT_EXPORTED.lists, NOT_EXPORTED.lineItems,
      "1 row of Processes is named as a heading is and is left out.",
      "1 row of Imports is named as a heading is and is left out.",
      "4 imports are linked to no module or list: their Target Object cell is empty.",
      "1 export is linked to no module or list: what it takes could not be read from its Action cell.",
      "2 rows of Other Actions are named as headings are and are left out.",
      PROCESS_ORDER, LINKS, IMPORT_SOURCES]);
  });

  it("links an import to the module or the list its Target Object names, of the kind its Target Type says by the word it holds", () => {
    const graph = buildModelGraph([
      lineItems(moduleRow("Prices"), moduleRow("Plan"), moduleRow("Versions"), moduleRow("'Quoted'"), moduleRow("Quoted"), moduleRow("Prices, net")),
      generalLists(list("Regions"), list("Plan"), list("It's new")),
      importsFile(
        action("Load prices", { "Target Object": "Prices", "Target Type": "MODULE" }),
        // The type is read whatever its case and the spaces round it.
        action("Load regions", { "Target Object": "Regions", "Target Type": " list " }),
        // A module and a list of one name: Target Type says which.
        action("Load plan list", { "Target Object": "Plan", "Target Type": "LIST" }),
        action("Load plan module", { "Target Object": "Plan", "Target Type": "Module" }),
        // A type says list or module by the word it holds, whatever else it holds and whatever stands between its words.
        action("Load regions numbered", { "Target Object": "Regions", "Target Type": "Numbered List" }),
        action("Load regions coded", { "Target Object": "Regions", "Target Type": "NUMBERED_LIST" }),
        action("Load plan numbered", { "Target Object": "Plan", "Target Type": "numbered list" }),
        action("Load prices now", { "Target Object": "Prices", "Target Type": "Module (current)" }),
        // Without a type, a name that only one of the two has is that one's, and a name both have is neither's. A cell of
        // nothing but spaces is no type.
        action("Load prices untyped", { "Target Object": "Prices" }),
        action("Load regions untyped", { "Target Object": "Regions", "Target Type": "  " }),
        action("Load plan untyped", { "Target Object": "Plan" }),
        // A type that holds neither word says neither: it is of a target the map does not have, though a module or a list
        // has the name. A longer word that only has "list" in it is another word. And a type that holds both words does
        // not say which.
        action("Load versions", { "Target Object": "Versions", "Target Type": "VERSIONS" }),
        action("Load regions listed", { "Target Object": "Regions", "Target Type": "Listing" }),
        action("Load plan both", { "Target Object": "Plan", "Target Type": "Module list" }),
        // The word decides the kind: under "module" a list of the name is not looked for, nor a module under "list".
        action("Load regions as a module", { "Target Object": "Regions", "Target Type": "MODULE" }),
        action("Load versions as a list", { "Target Object": "Versions", "Target Type": "Users List" }),
        action("Load users", { "Target Object": "Users", "Target Type": "LIST" }),
        // A target is the name as the cell writes it, and out of its quotes only where nothing has it as written.
        action("Load quoted", { "Target Object": "'Quoted'", "Target Type": "MODULE" }),
        action("Load net", { "Target Object": "'Prices, net'", "Target Type": "MODULE" }),
        action("Load new", { "Target Object": "'It''s new'" }),
        // An empty cell and a dash name no target.
        action("Old import"),
        action("Older import", { "Target Object": "-", "Target Type": "MODULE" })),
    ]);
    expect(kindLinks(graph)).toEqual(anyOrder([
      "action Load prices -> module Prices (import_target)", "action Load regions -> list Regions (import_target)",
      "action Load plan list -> list Plan (import_target)", "action Load plan module -> module Plan (import_target)",
      "action Load regions numbered -> list Regions (import_target)", "action Load regions coded -> list Regions (import_target)",
      "action Load plan numbered -> list Plan (import_target)", "action Load prices now -> module Prices (import_target)",
      "action Load prices untyped -> module Prices (import_target)", "action Load regions untyped -> list Regions (import_target)",
      "action Load quoted -> module 'Quoted' (import_target)", "action Load net -> module Prices, net (import_target)", "action Load new -> list It's new (import_target)"]));
    expect(unresolved(graph)).toEqual(["Load plan untyped: Target Object: Plan", "Load versions: Target Object: Versions", "Load regions listed: Target Object: Regions",
      "Load plan both: Target Object: Plan", "Load regions as a module: Target Object: Regions", "Load versions as a list: Target Object: Versions", "Load users: Target Object: Users"]);
    expect(counted(graph)).toEqual(["2 imports are linked to no module or list: their Target Object cell is empty."]);
  });

  it("links an export and another action to what its Action cell names, in words or by a list's ID", () => {
    const graph = buildModelGraph([
      lineItems(moduleRow("Prices"), moduleRow("Depots"), moduleRow("It's new"), moduleRow("REV01 Revenue"),
        item("REV01 Revenue", "Region", { Format: listFormat(101000000002), "Format List": "Regions" })),
      generalLists(list("Regions"), list("Depots")),
      exportsFile(
        action("Send prices", { Action: "Export from 'Prices'" }),
        // The words name a module or a list. A name that both have is neither's: nothing tells which the export takes.
        action("Send regions", { Action: "Export from 'Regions'" }),
        action("Send depots", { Action: "Export from 'Depots'" }),
        // In quotes, the name is read out of them, two single quotes for one; a name nothing has is unresolved.
        action("Send new", { Action: "Export from 'It''s new'" }),
        action("Send gone", { Action: "Export from 'Gone'" }),
        // Without quotes, the words are a target only where they are a name.
        action("Send prices plainly", { Action: "Export from Prices" }),
        action("Send depots plainly", { Action: "Export from Depots" }),
        action("Send from the hub", { Action: "Export from the hub" }),
        // The words are the whole cell: more before them or after the name is no target.
        action("Send late", { Action: "Export from 'Prices' nightly" }),
        action("Send early", { Action: "Now Export from 'Prices'" }),
        action("Send lines", { Action: "Export from 'Prices'\nnightly" }),
        action("Send lower", { Action: "export from 'Prices'" }),
        // A definition names a list by its ID, and an export that names one so is read.
        action("Send list", { Action: '{"exportType":"GRID_CURRENT_PAGE","hierarchyIdentifier":"_101000000002_"}' }),
        action("Send grid", { Action: '{"exportType":"GRID_CURRENT_PAGE"}' }),
        // Quotes with nothing between them name nothing, and neither does an empty cell.
        action("Send no name", { Action: "Export from ''" }),
        action("Send nothing")),
      otherActions(
        action("Delete old regions", { Action: '{"actionType":"DELETE_BY_SELECTION","hierarchyIdentifier":"_101000000002_"}' }),
        action("Copy regions", { Action: '{"actionType":"BULK_COPY","sourceHierarchyIdentifier":101000000002,"targetHierarchyIdentifier":"_101000000009_"}' }),
        // Whichever file an action is in, an Action cell that says "Import into" names what the action loads into.
        action("Reload prices", { Action: "Import into 'Prices'" }),
        action("Open the review", { Action: "Open Dashboard" })),
    ]);
    expect(kindLinks(graph, "export_source", "import_target", "action_target")).toEqual(anyOrder([
      "module Prices -> action Send prices (export_source)", "list Regions -> action Send regions (export_source)", "module It's new -> action Send new (export_source)",
      "module Prices -> action Send prices plainly (export_source)",
      "action Send list -> list Regions (action_target)", "action Delete old regions -> list Regions (action_target)", "action Copy regions -> list Regions (action_target)",
      "action Reload prices -> module Prices (import_target)"]));
    expect(unresolved(graph)).toEqual(["Send depots: Action: 'Depots'", "Send gone: Action: 'Gone'", "Send depots plainly: Action: Depots", "Copy regions: targetHierarchyIdentifier: 101000000009"]);
    // The exports whose Action says no target the map can read are counted. Another action that names none is as it should be.
    expect(counted(graph)).toEqual(["8 exports are linked to no module or list: what they take could not be read from their Action cell."]);
    expect(counted(buildModelGraph([exportsFile(action("Send grid", { Action: '{"exportType":"GRID_CURRENT_PAGE"}' })), importsFile(action("Old import"))]))).toEqual([
      "1 import is linked to no module or list: its Target Object cell is empty.", "1 export is linked to no module or list: what it takes could not be read from its Action cell."]);
  });

  it("says of an export only what is true of it: nothing of lists, of processes or of an import's source where it has none", () => {
    // No tables at all: no file is there to give anything. Only what holds of every export is said.
    expect(buildModelGraph([])).toEqual({ nodes: [], edges: [], unresolved: [], sections: [],
      limitations: [NOT_EXPORTED.lists, NOT_EXPORTED.lineItems, ...NO_ACTIONS, LINKS] });
    // Another export's tables are none of the map's.
    expect(buildModelGraph([file("Cards", ["Page", "Card #"], [["Sales", 1]]), file("Model Details", ["Section", "Detail", "Value"], [["Model", "Model", "Plan"]])]).limitations)
      .toEqual([NOT_EXPORTED.lists, NOT_EXPORTED.lineItems, ...NO_ACTIONS, LINKS]);
    const standing = (...tables: ResultTable[]): string[] => buildModelGraph(tables).limitations.filter(line => [LIST_ITEMS, NO_LIST_ITEMS, PROCESS_ORDER, LINKS, IMPORT_SOURCES].includes(line));
    // The number of items is given by a General Lists table with that column, and by no other.
    expect(standing(generalLists(list("Products", { "Item Count": "5" })))).toEqual([LIST_ITEMS, LINKS]);
    expect(standing(without(generalLists(list("Products")), "Item Count"))).toEqual([NO_LIST_ITEMS, LINKS]);
    expect(standing(generalLists())).toEqual([LINKS]);
    // Which processes use an action is said by an action's table with that column, whichever of the three it is.
    expect(standing(processesFile(action("Weekly")))).toEqual([LINKS]);
    expect(standing(exportsFile(action("Send prices")))).toEqual([PROCESS_ORDER, LINKS]);
    expect(standing(otherActions(action("Tidy up")))).toEqual([PROCESS_ORDER, LINKS]);
    expect(standing(without(otherActions(action("Tidy up")), "Used in Processes"), exportsFile())).toEqual([LINKS]);
    // Where an import takes its data from is in an Imports table that has one of the source's columns, and rows.
    expect(standing(importsFile(action("Load prices")))).toEqual([PROCESS_ORDER, LINKS, IMPORT_SOURCES]);
    expect(standing(without(importsFile(action("Load prices")), "Source Label", "Source Type"))).toEqual([PROCESS_ORDER, LINKS, IMPORT_SOURCES]);
    expect(standing(without(importsFile(action("Load prices")), "Source Label", "Source Object", "Source Type"))).toEqual([PROCESS_ORDER, LINKS]);
    expect(standing(file("Imports", [""], [["Load prices"]]))).toEqual([LINKS]);
    expect(standing(importsFile())).toEqual([LINKS]);
  });

  it("says what each table that was not exported leaves out, and builds from the tables there are", () => {
    // Line Items alone: the modules and line items, with the lists they name unresolved.
    const alone = buildModelGraph([lineItems(moduleRow("REV01 Revenue", { "Applies To": "Products" }), item("REV01 Revenue", "Units", { "Referenced By": "Revenue" }), item("REV01 Revenue", "Revenue"))]);
    expect([alone.nodes.map(each => each.name), links(alone), unresolved(alone)]).toEqual([["REV01 Revenue", "Units", "Revenue"], ["REV01 Revenue.Units -> REV01 Revenue.Revenue (reference)"],
      ["REV01 Revenue: Applies To: Products"]]);
    expect(alone.limitations).toEqual([NOT_EXPORTED.lists, NO_MODULES_FILE, ...NO_ACTIONS, LINKS]);

    // General Lists alone, and the actions alone.
    const lists = buildModelGraph([generalLists(list("Products", { Subsets: "Core Products", "Referenced in Applies To": "REV01 Revenue" }))]);
    expect([lists.nodes.map(each => each.name), links(lists), unresolved(lists)]).toEqual([["Products", "Core Products"], ["Products -> Core Products (subset)"],
      ["Products: Referenced in Applies To: REV01 Revenue"]]);
    expect(lists.limitations).toEqual([NOT_EXPORTED.lineItems, ...NO_ACTIONS, LIST_ITEMS, LINKS]);
    const actions = buildModelGraph([processesFile(action("Weekly")), importsFile(action("Load prices", { "Target Object": "Prices", "Target Type": "MODULE", "Used in Processes": "Weekly" }))]);
    expect([links(actions), unresolved(actions)]).toEqual([["Weekly -> Load prices (process_action)"], ["Load prices: Target Object: Prices"]]);
    expect(actions.limitations).toEqual([NOT_EXPORTED.lists, NOT_EXPORTED.lineItems, NOT_EXPORTED.exports, NOT_EXPORTED.otherActions, PROCESS_ORDER, LINKS, IMPORT_SOURCES]);
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
      { id: 0, kind: "list", name: "Products", file: "General Lists", row: 2, group: "Ungrouped" },
      { id: 1, kind: "module", name: "REV01 Revenue", file: "Line Items", row: 2, group: "Ungrouped" },
      { id: 2, kind: "lineItem", name: "Units", file: "Line Items", row: 3, module: 1, group: "Ungrouped" },
      { id: 3, kind: "process", name: "Weekly", file: "Processes", row: 2 },
      { id: 4, kind: "action", name: "Load prices", file: "Imports", row: 2, actionType: "Import" },
      { id: 5, kind: "action", name: "Send prices", file: "Exports", row: 2, actionType: "Export" },
      { id: 6, kind: "action", name: "Delete old regions", file: "Other Actions", row: 2, actionType: "Other" }]);
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
      NO_LIST_ITEMS, LINKS]);

    // One column less than the export has: one sentence, and everything else as it is.
    const whole = [lineItems(moduleRow("REV01 Revenue", { "Applies To": "Products" }), item("REV01 Revenue", "Units", { "Referenced By": "Revenue", Notes: "Sold" }), item("REV01 Revenue", "Revenue")),
      generalLists(list("Products"))];
    const lacking = (...headers: string[]): ModelGraph => buildModelGraph([without(whole[0], ...headers), whole[1]]);
    expect(buildModelGraph(whole).limitations).toEqual([NO_MODULES_FILE, ...NO_ACTIONS, LIST_ITEMS, LINKS]);
    expect(lacking("Notes").limitations).toEqual(["Line Items has no Notes column: modules and line items come without it.", NO_MODULES_FILE, ...NO_ACTIONS, LIST_ITEMS, LINKS]);
    // Two columns are named with "and" between them.
    expect(lacking("Notes", "Style").limitations[0]).toBe("Line Items has no Notes and Style columns: modules and line items come without them.");
    expect([links(lacking("Referenced By")), links(lacking("Notes")).length, node(lacking("Notes"), "Units").notes, node(buildModelGraph(whole), "Units").notes]).toEqual([
      anyOrder(["Products -> REV01 Revenue (applies)", "Products -> REV01 Revenue.Units (applies)", "Products -> REV01 Revenue.Revenue (applies)"]), 4, undefined, "Sold"]);
    // Without Module Name no row says its module: the rows that hold more than a name are left out, and counted.
    const unnamed = lacking("Module Name");
    expect([unnamed.nodes.map(each => `${each.kind} ${each.name}`), unnamed.limitations.slice(0, 3)]).toEqual([["list Products", "module REV01 Revenue"], [
      "Line Items has no Module Name column: no row says which module it is in, so the map has no line items.", NO_MODULES_FILE,
      "2 rows of Line Items are no module's own and name no module: they are left out."]]);
    // The Format List column is the export's own, and a file without it lacks nothing the map says.
    expect(lacking("Format List").limitations).toEqual(buildModelGraph(whole).limitations);
    // The Imports tab alone, as the export writes it when the Actions list could not be read. What the table lacks is
    // said beside the import that names no target, not in its place.
    const tabOnly = buildModelGraph([file("Imports", IMPORT_HEADERS.slice(0, 7), [["Load prices", "prices.csv", "-", "FILE", "Prices", "MODULE", "false"], ["Old import", "", "", "", "", "", ""]])]);
    expect(tabOnly.limitations).toEqual([NOT_EXPORTED.lists, NOT_EXPORTED.lineItems, NOT_EXPORTED.processes,
      "Imports has no Used in Processes column: the map does not say which processes run an import.",
      "Imports has no Notes, Start Date and Time (UTC) and Most recent duration (ms) columns: imports come without them.",
      "1 import is linked to no module or list: its Target Object cell is empty.",
      NOT_EXPORTED.exports, NOT_EXPORTED.otherActions, LINKS, IMPORT_SOURCES]);
  });

  it("reads a list's top level item and whether it is numbered under either of the two headers a file may have", () => {
    const headed = (topLevel: string, numbered: string): ModelGraph => buildModelGraph([file("General Lists", ["", topLevel, numbered, "Item Count"], [["Products", "All Products", "true", "5"],
      ["Regions", "", "false", "12"]])]);
    const nodes = [{ id: 0, kind: "list", name: "Products", file: "General Lists", row: 2, group: "Ungrouped", topLevel: "All Products", count: 5, numbered: true },
      { id: 1, kind: "list", name: "Regions", file: "General Lists", row: 3, group: "Ungrouped", count: 12, numbered: false }];
    for (const graph of [headed("Top Level", "Numbered"), headed("Top Level Item", "Numbered List"), headed("Top Level Item", "Numbered"), headed("Top Level", "Numbered List")]) {
      expect(graph.nodes).toEqual(nodes);
      expect(graph.limitations.filter(line => /Top Level|Numbered/.test(line))).toEqual([]);
    }
    // Where a file has both, the header the prototype read is the column.
    const both = buildModelGraph([file("General Lists", ["", "Top Level Item", "Top Level", "Numbered List", "Numbered"], [["Products", "Longer", "Shorter", "false", "true"]])]);
    expect([both.nodes[0].topLevel, both.nodes[0].numbered]).toEqual(["Shorter", true]);
    // A file with neither is said to lack the column by the shorter name.
    expect(buildModelGraph([file("General Lists", ["", "Item Count", "Notes", "Display Name Property"], [["Products", "5", "", ""]])]).limitations.slice(6, 7))
      .toEqual(["General Lists has no Top Level and Numbered columns: lists come without them."]);
  });

  it("reads the first table of a file's name, the first column of a header, and names a node's file as the table is labelled", () => {
    const graph = buildModelGraph([
      { ...generalLists(list("Products"), list("Regions")), label: "Lists" },
      generalLists(list("Channels")),
      // Two columns under one header: the first is the column.
      file("Line Items", ["", "Module Name", "Applies To", "Applies To"], [["REV01 Revenue", "", "Products", "Regions"], ["Units", "REV01 Revenue", "-", "Regions"]])]);
    expect(graph.nodes.map(each => `${each.kind} ${each.name} in ${each.file}`)).toEqual(["list Products in Lists", "list Regions in Lists", "module REV01 Revenue in Line Items",
      "lineItem Units in Line Items"]);
    expect(links(graph)).toEqual(anyOrder(["Products -> REV01 Revenue (applies)", "Products -> REV01 Revenue.Units (applies)"]));
  });

  it("makes nothing of a table without rows, and says nothing of the columns it lacks", () => {
    const empty = [lineItems(), modulesFile(), generalLists(), processesFile(), importsFile(), exportsFile(), otherActions()];
    expect(buildModelGraph(empty)).toEqual({ nodes: [], edges: [], unresolved: [], sections: [], limitations: [LINKS] });
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
        // The same subset written with quotes and without is one name.
        list("Products", { Subsets: "Core, 'Core'", "Item Count": "5" }),
        list("Regions", { Subsets: "Core, Northern" }),
        list("Products", { Subsets: "Second", "Item Count": "9" })),
      processesFile(action("Nightly", { Notes: "First" }), action("Nightly", { Notes: "Second" }), action("Nightly")),
      // Two actions may have one name: nothing names an action.
      otherActions(action("Tidy up"), action("Tidy up")),
    ]);
    expect(graph.nodes.map(each => `${each.kind} ${each.name} row ${each.row}`)).toEqual([
      "list Products row 2", "list Regions row 3", "subset Core row 2", "subset Northern row 3",
      "module REV01 Revenue row 2", "lineItem Units row 3", "module COST01 Costs row 5", "lineItem Units row 6", "lineItem Margin row 9", "module LATE01 Late row 14",
      "process Nightly row 2", "action Tidy up row 2", "action Tidy up row 3"]);
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
      LIST_ITEMS, PROCESS_ORDER, LINKS]);
    // One of each is said as one.
    const one = buildModelGraph([lineItems(moduleRow("REV01 Revenue"), item("REV01 Revenue", "Units"), item("REV01 Revenue", "Units"), item("OLD01 Gone", "Left over")),
      generalLists(list("Products", { Subsets: "Core, Core" })), processesFile(action("Nightly"), action("Nightly"))]);
    expect(counted(one)).toEqual([
      "1 list subset has the name of a subset before it and is left out.",
      "1 line item names a module that has no row above it in Line Items and is left out.",
      "1 line item has the name of a line item above it in the same module and is left out.",
      "1 row of Processes repeats the name of a process above it and is left out."]);
  });

  it("never throws, whatever the tables hold", () => {
    // Cells that are numbers: a name, a count, a module's name.
    const numbers = buildModelGraph([file("Line Items", ["", "Module Name", "Cell Count", "Applies To"], [[2026, "", 1200, 7], ["Units", 2026, 12.5, "-"]]),
      file("General Lists", ["", "Item Count", "Numbered"], [[7, 40, "true"]])]);
    expect(numbers.nodes).toEqual([
      { id: 0, kind: "list", name: "7", file: "General Lists", row: 2, group: "Ungrouped", count: 40, numbered: true },
      { id: 1, kind: "module", name: "2026", file: "Line Items", row: 2, group: "Ungrouped", cells: 1200, dimensions: [0] },
      { id: 2, kind: "lineItem", name: "Units", file: "Line Items", row: 3, module: 1, group: "Ungrouped", inheritsDimensions: true, dimensions: [0] }]);
    // A line item without a name is a line item all the same, and keeps the name it has.
    const unnamed = buildModelGraph([lineItems(moduleRow("REV01 Revenue"), item("REV01 Revenue", "", { Format: "", Summary: "", "Applies To": "" }))]);
    expect(unnamed.nodes[1]).toEqual({ id: 1, kind: "lineItem", name: "", file: "Line Items", row: 3, module: 0, group: "Ungrouped" });
    // A table of the wrong shape altogether: what can be read of it is read. A cell that cannot be made text is written
    // as any other object is.
    const odd = [null, { file: "Line Items.csv", label: "Line Items", headers: null, rows: [null, ["REV01 Revenue"], 5, [null], [{ name: "x" }], [Object.create(null)]] },
      { file: "General Lists.csv", label: "General Lists", headers: ["", "Subsets"], rows: "none" }, { file: "Processes.csv" }, "Imports.csv"] as unknown as ResultTable[];
    expect(() => buildModelGraph(odd)).not.toThrow();
    expect([buildModelGraph(odd).nodes.map(each => each.name), counted(buildModelGraph(odd))]).toEqual([["REV01 Revenue", "[object Object]"],
      ["1 row of Line Items repeats the name of a module above it and is left out."]]);
    // A hole among the rows is a row with nothing in it, as the CSV writes it.
    const holed = lineItems(moduleRow("REV01 Revenue"), item("REV01 Revenue", "Units"), item("REV01 Revenue", "Price"));
    delete holed.rows[1];
    expect(buildModelGraph([holed, modulesFile("REV01 Revenue")]).nodes.map(each => `${each.name} row ${each.row}`)).toEqual(["REV01 Revenue row 2", "Price row 4"]);
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
        // Products is in Units' formula, which is read before Units' own row says that Products is among its dimensions:
        // the two links between the same two nodes still come in the order of their kinds.
        list("Products", { Subsets: "Core Products", "Referenced in Applies To": "REV01 Revenue, REV01 Revenue", "Referenced in Formula": "REV01 Revenue.Units, REV01 Revenue.Units" }),
        list("Regions", { "Parent Hierarchy": "Products", "Referenced as Format": "REV01 Revenue.Region", "Referenced in Formula": "REV01 Revenue.Region" })),
      lineItems(
        moduleRow("REV01 Revenue", { "Applies To": "Products, Products, Core Products" }),
        // The same reference twice, and one that the other end says as well.
        item("REV01 Revenue", "Units", { "Referenced By": "Revenue, Revenue, 'REV01 Revenue'.Revenue", "Read Access Driver": "Open", "Write Access Driver": "Open" }),
        item("REV01 Revenue", "Region", { Format: listFormat(101000000002), "Format List": "Regions", "Applies To": "Regions" }),
        item("REV01 Revenue", "Revenue", { "Referenced By": "Units" }),
        item("REV01 Revenue", "Open", { Format: BOOLEAN, "Referenced By": "Units" })),
    ];
    const graph = buildModelGraph(tables());
    expect(graph.nodes.map(each => each.id)).toEqual(graph.nodes.map((_, index) => index));
    expect(graph.nodes.map(each => `${each.kind} ${each.name}`)).toEqual(["list Products", "list Regions", "subset Core Products", "module REV01 Revenue", "lineItem Units", "lineItem Region",
      "lineItem Revenue", "lineItem Open", "process Weekly", "action Load prices", "action Delete old regions"]);
    // By the first node, then the second, then the kind; no link twice, though the tables say several of them twice.
    expect(graph.edges).toEqual([
      [0, 1, "parent"], [0, 2, "subset"], [0, 3, "applies"], [0, 4, "applies"], [0, 4, "list_formula"], [0, 6, "applies"], [0, 7, "applies"],
      [1, 5, "applies"], [1, 5, "format"], [1, 5, "list_formula"],
      [2, 3, "applies"], [2, 4, "applies"], [2, 6, "applies"], [2, 7, "applies"],
      [4, 6, "reference"], [6, 4, "reference"], [7, 4, "read_access"], [7, 4, "write_access"],
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
      rows.push(moduleRow(moduleName(module), { "Applies To": `List ${module % LISTS}, List ${(module + 7) % LISTS}, Users`, "Cell Count": "48000" }));
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
    // Three references for each line item, less the 250 that are a driver's and so an access link. The dimension that
    // is no list is unresolved once for each module's row, not for each of the line items that take theirs from it.
    expect([linked("reference"), linked("read_access"), linked("format"), linked("import_target"), linked("process_action"), graph.unresolved.length]).toEqual([14750, 250, 250, 200, 400, 250]);
    expect(graph.edges.length).toBeGreaterThan(25_000);
    expect(graph.sections).toHaveLength(10);
    expect(graph.limitations).toEqual([NOT_EXPORTED.exports, NOT_EXPORTED.otherActions, LIST_ITEMS, PROCESS_ORDER, LINKS, IMPORT_SOURCES]);
    // Loosely: the same build takes some tens of milliseconds on a laptop.
    expect(took).toBeLessThan(1_000);
  });

  it("does not hang on long cells of names: 300 actions, each with 4,000 characters of processes, and a process name as long", () => {
    const cell = Array.from({ length: 1000 }, () => "ab").join(", ");
    for (const long of ["p".repeat(3000), Array.from({ length: 750 }, () => "ab").join(", ")]) {
      const tables = [processesFile(action(long), action("Weekly")), otherActions(...Array.from({ length: 300 }, (_, index) => action(`Tidy ${index}`, { "Used in Processes": `Weekly, ${cell}` })))];
      const started = performance.now();
      const graph = buildModelGraph(tables);
      const took = performance.now() - started;
      // One entry for each cell: the part that is no process, or the whole cell where it reads many ways.
      expect([graph.nodes.length, graph.unresolved.length]).toEqual([302, 300]);
      expect(graph.edges.length).toBe(long.includes(",") ? 0 : 300);
      // Loosely: it takes some tens of milliseconds. Looked up prefix by prefix it took minutes.
      expect(took).toBeLessThan(2_000);
    }
  });
});
