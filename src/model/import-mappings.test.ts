import { describe, expect, it } from "vitest";
import type { Grid } from "./grid.js";
import { fileImports, IMPORT_DEFINITION, importMappings, importNames, MAPPING_NOTES, readDefinition, type ImportNames } from "./import-mappings.js";
import type { Native } from "./native.js";

// Import definitions as Anaplan's import dialog saves them (anaplan/widgets/Mapping.js, view/ImportDefinitionModuleMapping.js,
// view/LineItemImportMapper.js, view/ImportDefinitionHierarchyMapping.js). Every name and ID is made up.

const [PRODUCTS, REGIONS, DIVISION, PRICES] = [101000000001, 101000000002, 101000000007, 102000000003];
const [UNITS, PRICE] = [1901000000011, 1901000000012];
const [MANAGER, ACTIVE] = [4100000000001, 4100000000002];
/** The names the export would give: a list and a line item it read, a property of the list the model page names. */
const NAMES: ImportNames = {
  list: id => new Map([[PRODUCTS, "Products"], [REGIONS, "+ Regions"], [DIVISION, "Division"]]).get(id),
  lineItem: (id, module) => (module === PRICES ? new Map([[UNITS, "Units"], [PRICE, "Price"]]).get(id) : undefined),
  property: (id, list) => (list === DIVISION ? new Map([[MANAGER, "Manager"]]).get(id) : undefined),
};
const id = (entity: number): string => `_${entity}_`;
const definition = (importType: string, target: number, mappings: unknown[], more: Record<string, unknown> = {}): string =>
  JSON.stringify({ importType, target: id(target), mappings, ...more });

describe("An import's mapping, read out of its definition", () => {
  it("names each target of an import into a module, its dimensions and then its line items, with what feeds it", () => {
    const text = definition("MODULE_DATA", PRICES, [
      { targetType: "moduleDimension", target: id(PRODUCTS), sourceType: "column", sourceColumnId: "#1", sourceColumnName: "Product" },
      { targetType: "moduleDimension", target: "_9000000001_", sourceType: "column", sourceColumnId: "#2", sourceColumnName: "Month" },
      { targetType: "moduleDimension", target: "_9000000002_", sourceType: "constant", sourceValue: "_107000000001_", sourceValueLabel: "Actual" },
      { targetType: "moduleDimension", target: id(REGIONS), sourceType: "prompt" },
      { targetType: "moduleDimension", target: "_101000000099_", sourceType: "ignore" },
      { targetType: "moduleDimension", target: "", sourceType: "headerRow" },
      { targetType: "moduleLineItem", target: id(UNITS), sourceType: "column", sourceColumnName: "Units" },
      { targetType: "moduleLineItem", target: id(PRICE), sourceType: "column", sourceColumnNumber: "5" },
      { targetType: "moduleLineItem", target: "_1901000000099_", sourceType: "undefined" }]);
    const { mapping } = readDefinition(text, NAMES);
    expect(mapping).toEqual({ importType: "MODULE_DATA", targets: [
      { target: "Products", source: "column", column: 1, text: "Product" },
      { target: "Time", source: "column", column: 2, text: "Month" },
      { target: "Versions", source: "constant", text: "Actual" },
      { target: "+ Regions", source: "prompt" },
      // A list the model names nowhere is said by its ID, as the page says one elsewhere.
      { target: "ID 101000000099", source: "ignore" },
      { target: "Line Items", source: "headerRow" },
      // A line item's column can be named by its heading alone, or by its place counted from 0, written as digits.
      { target: "Units", source: "column", text: "Units" },
      { target: "Price", source: "column", column: 6 },
      { target: "ID 1901000000099", source: "none" }] });
  });

  it("reads every way a definition writes a column and a constant, and keeps a source of another kind by its word", () => {
    const mappings = [
      // `sourceColumnId` counts from 1, and is what the dialog matches a column by; `sourceColumnNumber` counts from 0.
      { sourceType: "column", sourceColumnId: "#4", sourceColumnNumber: 3 },
      { sourceType: "column", sourceColumnNumber: 0 },
      { sourceType: "column", sourceColumnId: "Price", sourceColumnName: "  " },
      { sourceType: "column", sourceColumnId: "#0", sourceColumnNumber: -1 },
      // A constant by its label; by the identifier of a list's item, said by its ID; by a value of its own; with none.
      { sourceType: "constant", sourceValue: "_200000000123_" },
      { sourceType: "constant", sourceValue: 12.5 },
      { sourceType: "constant", sourceValue: "FY24" },
      { sourceType: "constant" },
      // A word the definition may hold that the dialog's mapping does not offer, and no word at all.
      { sourceType: "field", sourceFieldId: "label" },
      { sourceType: 7 },
      {}].map(mapping => ({ targetType: "moduleLineItem", target: "", ...mapping }));
    const sources = readDefinition(definition("MODULE_DATA", PRICES, mappings), NAMES).mapping.targets.map(({ target, ...source }) => (target === "Value" ? source : target));
    expect(sources).toEqual([{ source: "column", column: 4 }, { source: "column", column: 1 }, { source: "column" }, { source: "column" },
      { source: "constant", text: "ID 200000000123" }, { source: "constant", text: "12.5" }, { source: "constant", text: "FY24" }, { source: "constant" },
      { source: "other", text: "field" }, { source: "other" }, { source: "other" }]);
  });

  it("names each target of an import into a list: its items by the list's name, Parent, Code and its properties", () => {
    const text = definition("HIERARCHY_DATA", DIVISION, [
      { targetType: "hierarchyMemberEntityName", target: "", sourceType: "column", sourceColumnId: "#1" },
      { targetType: "hierarchyProperty", target: "_4000000001_", sourceType: "column", sourceColumnId: "#2" },
      { targetType: "hierarchyProperty", target: "_4000000004_", sourceType: "column", sourceColumnId: "#4" },
      { targetType: "hierarchyProperty", target: id(MANAGER), sourceType: "column", sourceColumnId: "#7" },
      { targetType: "hierarchyProperty", target: id(ACTIVE), sourceType: "undefined" }], { propertyMatchKey: ["_4000000004_"] });
    expect(readDefinition(text, NAMES).mapping).toEqual({ importType: "HIERARCHY_DATA", targets: [
      { target: "Division", source: "column", column: 1 }, { target: "Parent", source: "column", column: 2 }, { target: "Code", source: "column", column: 4 },
      { target: "Manager", source: "column", column: 7 }, { target: "ID 4100000000002", source: "none" }] });
    // A list the model's names miss is named as the Imports tab names the import's target, and else plainly.
    const unnamed = definition("HIERARCHY_DATA", 101000000050, [{ targetType: "hierarchyMemberEntityName", target: "", sourceType: "column", sourceColumnId: "#1" }]);
    expect([readDefinition(unnamed, NAMES, "Old list").mapping.targets[0].target, readDefinition(unnamed, NAMES).mapping.targets[0].target]).toEqual(["Old list", "Items"]);
  });

  it("lists no target of an import of another kind, which the page says what it loads of", () => {
    for (const kind of ["USERS", "VERSIONS", "LINE_ITEM_DEFINITION", "SOMETHING_NEW"]) {
      const text = definition(kind, 0, [{ targetType: "userData", target: "", item: "FIRST_NAME", sourceType: "column", sourceColumnId: "#2" }]);
      expect(readDefinition(text, NAMES).mapping, kind).toEqual({ importType: kind, targets: [] });
    }
    // A definition that names no kind is of another kind too.
    expect(readDefinition(JSON.stringify({ mappings: [] }), NAMES).mapping).toEqual({ importType: "", targets: [] });
    // One into a module that maps nothing has no target, and no note: it is read.
    expect(readDefinition(definition("MODULE_DATA", PRICES, []), NAMES).mapping).toEqual({ importType: "MODULE_DATA", targets: [] });
  });

  it("gives a note, not a failure, for a definition that is missing, no JSON, or JSON of another make", () => {
    const read = (text: string) => readDefinition(text, NAMES);
    expect(read("  ").mapping).toEqual({ importType: "", targets: [], note: MAPPING_NOTES.noDefinition });
    for (const text of ['{"importType":"MODULE_DATA","mappings":[', "Import into Prices", "[1,2]", "null", '"text"', "42",
      JSON.stringify({ importType: "MODULE_DATA", mappings: { 0: {} } }), JSON.stringify({ importType: "MODULE_DATA" }),
      JSON.stringify({ importType: "MODULE_DATA", mappings: [{ targetType: "moduleDimension", sourceType: "column" }, "column", null] })]) {
      expect(read(text).mapping.note, text).toBe(MAPPING_NOTES.unknown);
      expect(read(text).mapping.targets, text).toEqual([]);
    }
    // The words name no file: the page shows them, and no word of the page names one.
    expect(Object.values(MAPPING_NOTES).filter(note => /\.csv|\bcsv\b|\bzip\b|download|\bfiles?\b/i.test(note))).toEqual([]);
  });

  it("says for the log how a definition is made: its keys, and each mapping's keys with its sourceType, and no value", () => {
    const text = definition("MODULE_DATA", PRICES, [
      { targetType: "moduleDimension", target: id(PRODUCTS), sourceType: "column", sourceColumnId: "#1", sourceColumnName: "Secret heading" },
      { targetType: "moduleDimension", target: "_9000000001_", sourceType: "column", sourceColumnId: "#2", sourceColumnName: "Month" },
      { targetType: "moduleDimension", target: "_9000000002_", sourceType: "constant", sourceValue: "_107000000001_", sourceValueLabel: "Secret value" },
      { targetType: "moduleLineItem", target: id(UNITS), sourceType: "a value <b>", "key with spaces": 1 },
      "not an object"], { valueMaps: { "Secret source value": "_200000000001_" }, "weird key!": true });
    const { shape } = readDefinition(text, NAMES);
    expect(shape).toBe("keys importType, target, mappings, valueMaps, ?; 5 mappings: [targetType, target, sourceType, sourceColumnId, sourceColumnName] column ×2; "
      + "[targetType, target, sourceType, sourceValue, sourceValueLabel] constant ×1; [targetType, target, sourceType, ?] ? ×1; not an object ×1");
    expect(/Secret|Month|_10\d|<b>/.test(shape)).toBe(false);
    expect([readDefinition("", NAMES).shape, readDefinition("{", NAMES).shape, readDefinition("[]", NAMES).shape, readDefinition('{"mappings":7}', NAMES).shape])
      .toEqual(["no definition", "the definition is not JSON", "the definition is not an object", "keys mappings; mappings is not a list"]);
  });
});

/** A grid as the page's client gives it, from rows of an ID, a name and cells. */
const grid = (columns: [id: number, label: string][], rows: [number, string, ...string[]][]): Grid =>
  ({ columns: columns.map(([entity, label]) => ({ ids: [entity], labels: [label] })), rows: rows.map(([entity, name, ...cells]) => ({ ids: [entity], labels: [name], cells })) });
/** The Imports tab, as the export reads it. */
const TAB = grid([[4000000001, "Source Label"], [4000000002, "Source Object"], [4000000003, "Source Type"], [4000000004, "Target Object"], [4000000005, "Target Type"]], [
  [112000000001, "Division from HQ Network.csv", "HQ Network.csv", "-", "FILE", "Division", "LIST"],
  [112000000002, "Regions from the hub", "Hub / Regions", "Hub / 'LIST - Regions'.Export", "SAVED VIEW", "+ Regions", "LIST"],
  [112000000003, "Prices", "prices.csv", "-", " file ", "Prices", "MODULE"],
  [112000000004, "Gone", "old.csv", "-", "FILE", "Old", "MODULE"]]);
const DIVISION_DEFINITION = definition("HIERARCHY_DATA", DIVISION, [{ targetType: "hierarchyMemberEntityName", target: "", sourceType: "column", sourceColumnId: "#1" }]);
const PRICES_DEFINITION = definition("MODULE_DATA", PRICES, [{ targetType: "moduleLineItem", target: "", sourceType: "column", sourceColumnId: "#3" }]);
/** The grid of the imports' definitions: a column before the definitions', which the export finds by its ID. */
const DEFINITIONS = grid([[4000000017, "Notes"], [IMPORT_DEFINITION, "Import Definition"]], [
  [112000000001, "Division from HQ Network.csv", "", DIVISION_DEFINITION], [112000000002, "Regions from the hub", "", "{}"], [112000000003, "Prices", "Weekly", PRICES_DEFINITION]]);

describe("The mappings of a model's imports from a file", () => {
  it("are those of the Imports tab's imports whose Source Type is FILE, in the tab's order, each by its ID and name", () => {
    expect(fileImports(TAB).map(row => row.labels[0])).toEqual(["Division from HQ Network.csv", "Prices", "Gone"]);
    // A tab without the column names no import from a file.
    expect(fileImports({ columns: TAB.columns.slice(0, 2), rows: TAB.rows })).toEqual([]);
    const log: string[] = [];
    const mappings = importMappings(TAB, DEFINITIONS, NAMES, line => log.push(line));
    expect(mappings).toEqual([
      { id: "112000000001", name: "Division from HQ Network.csv", importType: "HIERARCHY_DATA", targets: [{ target: "Division", source: "column", column: 1 }] },
      { id: "112000000003", name: "Prices", importType: "MODULE_DATA", targets: [{ target: "Value", source: "column", column: 3 }] },
      // An import the grid holds no definition for says so: none of the imports from a file is left out.
      { id: "112000000004", name: "Gone", importType: "", targets: [], note: MAPPING_NOTES.noDefinition }]);
    // The import from another model is neither read nor said; each import from a file has its line, and the last line counts.
    expect(log).toEqual(["Import mapping 112000000001: keys importType, target, mappings; 1 mappings: [targetType, target, sourceType, sourceColumnId] column ×1",
      "Import mapping 112000000003: keys importType, target, mappings; 1 mappings: [targetType, target, sourceType, sourceColumnId] column ×1",
      "Import mapping 112000000004: not in the grid of definitions", "Import mappings: 2 of 3 read"]);
  });

  it("say that they could not be read where the model gave no definitions, or none under the definitions' ID", () => {
    const log: string[] = [];
    const unread = importMappings(TAB, undefined, NAMES, line => log.push(line));
    expect(unread.map(mapping => [mapping.name, mapping.note, mapping.targets])).toEqual([["Division from HQ Network.csv", MAPPING_NOTES.notRead, []],
      ["Prices", MAPPING_NOTES.notRead, []], ["Gone", MAPPING_NOTES.notRead, []]]);
    expect(log).toEqual(["Import mappings: 0 of 3 read"]);
    // A grid without the column of definitions, as a client that numbers it otherwise would give: the definitions are
    // looked for under the ID the client says, and are not taken from another column.
    const elsewhere = importMappings(TAB, DEFINITIONS, NAMES, line => log.push(line), 4000009999);
    expect([new Set(elsewhere.map(mapping => mapping.note)), log.slice(1)]).toEqual([new Set([MAPPING_NOTES.notRead]),
      ["Import mappings: no column of definitions among the 2 given", "Import mappings: 0 of 3 read"]]);
  });
});

describe("The names a definition's IDs are said by", () => {
  /** A model page's client whose own lists of names are these, or that throws for any of them. */
  const native = (cache: Record<string, unknown>): Native => ({ cache } as unknown as Native);
  const lists = grid([], [[PRODUCTS, "Products"], [REGIONS, ""]]);
  const lineItems: Grid = { columns: [], rows: [{ ids: [PRICES], labels: ["PRI01 Prices"], cells: [] }, { ids: [UNITS, PRICES], labels: ["Units", "PRI01 Prices"], cells: [] }] };

  it("are those of the grids the export read, then of the model page's own lists, in either shape a page of names has", () => {
    const names = importNames(native({
      getHierarchiesLabelPage: () => ({ entityLongIds: [[PRODUCTS, REGIONS]], labels: [["Products (page)", "Regions &amp; areas"]] }),
      getHierarchySubsetsLabelPage: () => ({ entityLongIds: [[109000000001]], labels: [["Active products"]] }),
      getLineItemsLabelPage: (module: number) => (module === PRICES ? { entityLongIds: [[UNITS, PRICE]], labels: [["Units (page)", "Price"]] } : null),
      // A list's properties: a page of plain lists, as the dialog reads it.
      getHierarchyInfo: (list: number) => (list === DIVISION ? { propertiesLabelPage: { entityLongIds: [MANAGER], labels: ["Manager"] } } : null),
    }), { lists, lineItems });
    expect([names.list(PRODUCTS), names.list(REGIONS), names.list(109000000001), names.list(101000000099)]).toEqual(["Products", "Regions & areas", "Active products", undefined]);
    expect([names.lineItem(UNITS, PRICES), names.lineItem(PRICE, PRICES), names.lineItem(PRICE, 102000000099)]).toEqual(["Units", "Price", undefined]);
    expect([names.property(MANAGER, DIVISION), names.property(MANAGER, PRODUCTS), names.property(109000000001, DIVISION)]).toEqual(["Manager", undefined, "Active products"]);
  });

  it("are none, and no failure, where the model page has no such list or throws for it", () => {
    const fails = () => { throw new Error("The model is not loaded."); };
    const names = importNames(native({ getHierarchiesLabelPage: fails, getHierarchySubsetsLabelPage: () => ({ entityLongIds: "1", labels: [] }), getLineItemsLabelPage: fails }), {});
    expect([names.list(PRODUCTS), names.lineItem(UNITS, PRICES), names.property(MANAGER, DIVISION)]).toEqual([undefined, undefined, undefined]);
  });
});
