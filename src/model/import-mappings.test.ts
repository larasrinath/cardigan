import { describe, expect, it } from "vitest";
import type { Grid } from "./grid.js";
import { fileImports, IMPORT_DEFINITION, importMappings, importNames, importsLine, MAPPING_NOTES, readDefinition, type ImportNames } from "./import-mappings.js";
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
      { sourceType: "column", sourceColumnId: " # 7 " },
      // A `sourceColumnId` that is no "#" and number is the column's heading: the dialog finds the column in the header row
      // by it, as it does by `sourceColumnName` (view/ImportDefinitionModuleMapping.js `markColumn`). With no place the
      // definition gives (-1, or nothing), the column is said by its heading alone.
      { sourceType: "column", sourceColumnId: "Price", sourceColumnName: "  " },
      { sourceType: "column", sourceColumnNumber: -1, sourceColumnName: null, sourceColumnId: "Product " },
      { sourceType: "column", sourceColumnNumber: 2, sourceColumnName: null, sourceColumnId: "Location" },
      { sourceType: "column", sourceColumnNumber: "1", sourceColumnName: "Expiry", sourceColumnId: "Expiry Date" },
      // A column given neither place nor heading is said by what the definition identifies it by, where it gives anything.
      { sourceType: "column", sourceColumnId: "#0", sourceColumnNumber: -1 },
      { sourceType: "column", sourceColumnNumber: -1, sourceColumnName: "", sourceColumnId: null, sourceFieldId: "f12" },
      { sourceType: "column", sourceColumnEntityLongId: 101000000009 },
      { sourceType: "column", sourceColumnEntityLongId: -1, sourceColumnNumber: null },
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
    expect(sources).toEqual([{ source: "column", column: 4 }, { source: "column", column: 1 }, { source: "column", column: 7 },
      { source: "column", text: "Price" }, { source: "column", text: "Product" }, { source: "column", column: 3, text: "Location" }, { source: "column", column: 2, text: "Expiry" },
      { source: "column", id: "#0" }, { source: "column", id: "f12" }, { source: "column", id: "101000000009" }, { source: "column" },
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
      { target: "Manager", source: "column", column: 7 }, { target: "ID 4100000000002", source: "none" }], matchedBy: { by: "code" } });
    // A list the model's names miss is named as the Imports tab names the import's target, and else plainly.
    const unnamed = definition("HIERARCHY_DATA", 101000000050, [{ targetType: "hierarchyMemberEntityName", target: "", sourceType: "column", sourceColumnId: "#1" }]);
    expect([readDefinition(unnamed, NAMES, "Old list").mapping.targets[0].target, readDefinition(unnamed, NAMES).mapping.targets[0].target]).toEqual(["Old list", "Items"]);
  });

  it("reads a mapping that has no target at all, as a list matched by its code has for its items' names, by its target's kind", () => {
    // As the user's model has it (9 Oct 2026): a numbered list matched by its code, whose items' names are not mapped. The
    // dialog writes that mapping with no target, and the definition with every key a live one holds.
    const text = definition("HIERARCHY_DATA", DIVISION, [
      { targetType: "hierarchyMemberEntityName", sourceType: "undefined" },
      { targetType: "hierarchyProperty", target: "_4000000004_", sourceType: "column", sourceColumnNumber: 0, sourceColumnName: "Code", sourceColumnId: "#1" },
      { targetType: "hierarchyProperty", target: "_4000000001_", sourceType: "column", sourceColumnNumber: 1, sourceColumnName: "Region", sourceColumnId: "#2" }],
    { source: {}, propertyMatchKey: ["_4000000004_"], targetAreaSpecifications: [], periodFormats: {}, valueMaps: {}, aliasMaps: {}, dataFormatDefinitions: {},
      dataFormatsByTarget: {}, allowDuplicateKeysInTarget: false, allowDuplicateKeysInSource: false, allowNameMangling: false });
    const { mapping, shape } = readDefinition(text, NAMES);
    expect(mapping).toEqual({ importType: "HIERARCHY_DATA", targets: [{ target: "Division", source: "none" }, { target: "Code", source: "column", column: 1, text: "Code" },
      { target: "Parent", source: "column", column: 2, text: "Region" }], matchedBy: { by: "code" } });
    expect(shape).toBe("keys importType, target, mappings, source, propertyMatchKey, targetAreaSpecifications, periodFormats, valueMaps, aliasMaps, dataFormatDefinitions, "
      + "dataFormatsByTarget, allowDuplicateKeysInTarget, allowDuplicateKeysInSource, allowNameMangling; 3 mappings: [targetType, sourceType] undefined ×1; "
      + "[targetType, target, sourceType, sourceColumnNumber, sourceColumnName, sourceColumnId] column ×2");
    // A target of any other kind with no target is named as a blank one is: by what the kind says, or by the kind's word.
    const kinds = ["moduleDimension", "moduleLineItem", "hierarchyProperty", "somethingNew"].map(targetType => ({ targetType, sourceType: "undefined" }));
    expect(readDefinition(definition("MODULE_DATA", PRICES, kinds), NAMES).mapping.targets).toEqual(["Line Items", "Value", "Property", "somethingNew"]
      .map(target => ({ target, source: "none" })));
  });

  it("says how an import into a list tells the list's items apart, as the dialog's Items uniquely identified by says it", () => {
    const [NAME, PARENT, CODE] = [{ targetType: "hierarchyMemberEntityName", target: "", sourceType: "column", sourceColumnId: "#1" },
      { targetType: "hierarchyProperty", target: "_4000000001_", sourceType: "column", sourceColumnId: "#2" },
      { targetType: "hierarchyProperty", target: "_4000000004_", sourceType: "column", sourceColumnId: "#3" }];
    const unmapped = (mapping: Record<string, unknown>) => ({ ...mapping, sourceType: "undefined" });
    const matchOf = (mappings: unknown[], more: Record<string, unknown> = {}, names = NAMES) => readDefinition(definition("HIERARCHY_DATA", DIVISION, mappings, more), names).mapping.matchedBy;
    // Without a key, as the dialog takes a definition made before the choice: by what the definition maps.
    expect([matchOf([NAME, PARENT, unmapped(CODE)]), matchOf([unmapped(NAME), CODE]), matchOf([NAME, CODE]), matchOf([unmapped(NAME), PARENT])])
      .toEqual([{ by: "name" }, { by: "code" }, { by: "nameOrCode" }, { by: "nameOrCode" }]);
    // The key of names alone (SYSTEM_PROPERTY_ID), of codes alone, and of a combination of properties, each by its name.
    expect([matchOf([NAME], { propertyMatchKey: ["_4000000010_"] }), matchOf([CODE], { propertyMatchKey: ["_4000000004_"] }),
      matchOf([PARENT], { propertyMatchKey: [id(MANAGER), "_4000000001_", "_4000000004_", "_4100000000099_", "Odd"] }), matchOf([PARENT], { propertyMatchKey: [] })])
      .toEqual([{ by: "name" }, { by: "code" }, { by: "properties", properties: ["Manager", "Parent", "Code", "ID 4100000000099", "Odd"] }, { by: "properties", properties: [] }]);
    // A key that is no list says nothing; an import into a module has no items to tell apart.
    expect([matchOf([NAME], { propertyMatchKey: "_4000000004_" }), readDefinition(definition("MODULE_DATA", PRICES, [], { propertyMatchKey: [] }), NAMES).mapping.matchedBy])
      .toEqual([undefined, undefined]);
  });

  it("says that a numbered list told apart by code or by properties numbers its items itself, where the names know the list is numbered", () => {
    const numbered = (list: number) => (list === DIVISION ? true : undefined);
    const NUMBERED: ImportNames = { ...NAMES, numbered };
    // As the user's import into a numbered list (10 Oct 2026): its items' names, Parent and Code not mapped, and its
    // properties each from a column the definition names by its heading alone.
    const mappings = [{ targetType: "hierarchyMemberEntityName", sourceType: "undefined" }, { targetType: "hierarchyProperty", target: "_4000000001_", sourceType: "undefined" },
      { targetType: "hierarchyProperty", target: "_4000000004_", sourceType: "undefined" },
      { targetType: "hierarchyProperty", target: id(MANAGER), sourceType: "column", sourceColumnNumber: -1, sourceColumnName: null, sourceColumnId: "Manager" }];
    const read = (key: unknown, names: ImportNames) => readDefinition(definition("HIERARCHY_DATA", DIVISION, mappings, { propertyMatchKey: key }), names).mapping;
    expect(read([id(MANAGER)], NUMBERED)).toEqual({ importType: "HIERARCHY_DATA", matchedBy: { by: "properties", properties: ["Manager"], numbered: true }, targets: [
      { target: "Division", source: "numbered" }, { target: "Parent", source: "none" }, { target: "Code", source: "none" }, { target: "Manager", source: "column", text: "Manager" }] });
    expect(read(["_4000000004_"], NUMBERED).targets[0]).toEqual({ target: "Division", source: "numbered" });
    // By name (#ID), the list's items are named by the import; and where the names do not know the list, nothing is said of it.
    expect([read(["_4000000010_"], NUMBERED).targets[0], read([id(MANAGER)], NAMES).targets[0], read([id(MANAGER)], NAMES).matchedBy])
      .toEqual([{ target: "Division", source: "none" }, { target: "Division", source: "none" }, { by: "properties", properties: ["Manager"] }]);
    expect(read([id(MANAGER)], { ...NAMES, numbered: () => false }).matchedBy).toEqual({ by: "properties", properties: ["Manager"], numbered: false });
  });

  it("says for the log how the first column is written, each way by its type and a short value, and the parts that could say more, by their keys", () => {
    const text = definition("HIERARCHY_DATA", DIVISION, [{ targetType: "hierarchyMemberEntityName", sourceType: "undefined" },
      { targetType: "hierarchyProperty", target: id(MANAGER), sourceType: "column", sourceColumnNumber: -1, sourceColumnName: null, sourceColumnId: "Inventory Quantity (U)" },
      { targetType: "hierarchyProperty", target: "_4000000001_", sourceType: "column", sourceColumnId: "Secret second" }],
    { source: { type: "FILE", "label with spaces": "x" }, dataFormatDefinitions: { fmt1: { type: "date" } }, dataFormatsByTarget: { [id(MANAGER)]: "fmt1" }, valueMaps: { "Secret value": "x" } });
    expect(readDefinition(text, NAMES).details).toEqual([
      'first column: sourceColumnId text "Inventory Quantity (…", sourceColumnNumber number -1, sourceColumnName null',
      "source object of 2 keys: type, ?; dataFormatDefinitions object of 1 key: fmt1; dataFormatsByTarget object of 1 key: _4100000000001_",
      // The parts on how items are matched, where it holds any: a value map that is no list, by its keys, a value's as "?".
      "valueMaps object of 1 key: ?; aliasMaps absent; targetAreaSpecifications absent; periodFormats absent"]);
    // Every other kind of value is said by its type; a definition with no column, and parts it does not have, say so.
    const odd = definition("MODULE_DATA", PRICES, [{ targetType: "moduleLineItem", sourceType: "column", sourceColumnId: 3, sourceColumnNumber: true, sourceColumnName: ["a"] }],
      { source: [1, 2], dataFormatDefinitions: null, dataFormatsByTarget: "x" });
    expect(readDefinition(odd, NAMES).details).toEqual(["first column: sourceColumnId number 3, sourceColumnNumber truth true, sourceColumnName list of 1",
      "source list of 2; dataFormatDefinitions null; dataFormatsByTarget string"]);
    expect(readDefinition(definition("MODULE_DATA", PRICES, [{ targetType: "moduleLineItem", sourceType: "prompt" }]), NAMES).details)
      .toEqual(["no mapping from a column", "source absent; dataFormatDefinitions absent; dataFormatsByTarget absent"]);
    // No value of a part is said, nor of a mapping but the first column's three ways.
    expect(readDefinition(text, NAMES).details.join(" ")).not.toMatch(/Secret|FILE|date|"x"/);
    expect([readDefinition("", NAMES).details, readDefinition("{", NAMES).details, readDefinition("[]", NAMES).details]).toEqual([[], [], []]);
  });

  it("reads what an import into a module holds of its sources: headers and items mapped by hand or ignored, Time's period format and a date's format", () => {
    // As Anaplan's import dialog writes them (view/ImportDefinition.js `_getDimensionsInfo`, view/MappedDimensionImportOptions.js,
    // view/TimeDimensionImportOptions.js) and anaplan-sam reads them (definition-core.ts): a value map for each dimension
    // shown, the line items' with a blank target; -1 for a source value ignored; Time's period format; a date line item's
    // format behind its key.
    const SOLD = 200000000001;
    const text = definition("MODULE_DATA", PRICES, [
      { targetType: "moduleDimension", target: id(PRODUCTS), sourceType: "column", sourceColumnNumber: -1, sourceColumnName: null, sourceColumnId: "Product" },
      { targetType: "moduleDimension", target: "_9000000001_", sourceType: "column", sourceColumnId: "#2", sourceColumnName: "Month" },
      { targetType: "moduleDimension", target: id(REGIONS), sourceType: "column", sourceColumnId: "#3" },
      { targetType: "moduleDimension", target: "", sourceType: "headerRow" },
      { targetType: "moduleLineItem", target: id(UNITS), sourceType: "column", sourceColumnName: "Units" },
      { targetType: "moduleLineItem", target: id(PRICE), sourceType: "column", sourceColumnName: "Price" },
      // The line item a single column of values would feed, which the dialog does not ask for with the header row.
      { targetType: "moduleLineItem", target: "", sourceType: "undefined" }], {
      valueMaps: [{ targetType: "moduleDimension", target: id(PRODUCTS), values: { "Prod A": SOLD, "Old prod": -1 } },
        { targetType: "moduleDimension", target: id(REGIONS), values: {} },
        { targetType: "moduleDimension", target: "", values: { "Unit count": UNITS, "Price (EUR)": PRICE, Notes: -1, "Odd one": "x", "Nought": 0 } }],
      aliasMaps: [{ targetType: "moduleDimension", target: "", values: {} }],
      targetAreaSpecifications: [{ target: id(PRODUCTS), area: "ALL_ITEMS" }, { target: "", area: "MATCHED_ITEMS" }],
      periodFormats: [{ targetType: "moduleDimension", target: "_9000000001_", periodFormat: { format: "MMM YY", locale: "en_GB" } }],
      dataFormatDefinitions: { fmt: { type: "date", format: "DD/MM/YYYY", active: true }, num: { type: "number", format: "0.00" } },
      dataFormatsByTarget: { [id(PRICE)]: "fmt", [id(UNITS)]: "num" } });
    const { mapping, details } = readDefinition(text, NAMES);
    expect(mapping).toEqual({ importType: "MODULE_DATA", targets: [
      // Each dimension fed by a column says how many of its items are mapped by hand and ignored: none of either is the
      // dialog's Match on names or codes.
      { target: "Products", source: "column", text: "Product", items: { byHand: 1, ignored: 1 } },
      { target: "Time", source: "column", column: 2, text: "Month", periodFormat: "MMM YY" },
      { target: "+ Regions", source: "column", column: 3, items: { byHand: 0, ignored: 0 } },
      { target: "Line Items", source: "headerRow", items: { byHand: 2, ignored: 1 } },
      { target: "Units", source: "column", text: "Units" },
      { target: "Price", source: "column", text: "Price", dateFormat: "DD/MM/YYYY" }],
    // The headers mapped by hand, each with its line item, and the one ignored; a value that is no item's ID is no mapping.
    headers: [{ header: "Unit count", lineItem: "Units" }, { header: "Price (EUR)", lineItem: "Price" }, { header: "Notes" }] });
    // The log says how each part is made, and no value of the import's source.
    expect(details[2]).toBe("valueMaps list of 3: 101000000001: 1 mapped, 1 ignored | 101000000002: 0 mapped, 0 ignored | line items: 2 mapped, 1 ignored, 2 of another kind "
      + "(text of 6 characters to an ID; text of 8 characters ignored); aliasMaps list of 1: line items: 0; "
      + "targetAreaSpecifications list of 2: 101000000001: ALL_ITEMS | line items: MATCHED_ITEMS; periodFormats list of 1: 9000000001: a format of 6 characters");
    expect(details[2]).not.toMatch(/Prod|Unit count|Notes|MMM|DD\/MM/);
  });

  it("says that Time's periods are matched by their names, takes the parts of no other make, and reads none of them for an import into a list", () => {
    const time = { targetType: "moduleDimension", target: "_9000000001_", sourceType: "column", sourceColumnId: "#1" };
    const read = (more: Record<string, unknown>, importType = "MODULE_DATA") => readDefinition(definition(importType, PRICES, [time,
      { targetType: "moduleDimension", target: id(PRODUCTS), sourceType: "column", sourceColumnId: "#2" }], more), NAMES).mapping.targets;
    expect(read({ periodFormats: [{ targetType: "moduleDimension", target: "_9000000001_", periodFormat: null }], valueMaps: [] })).toEqual([
      { target: "Time", source: "column", column: 1, periodFormat: null }, { target: "Products", source: "column", column: 2, items: { byHand: 0, ignored: 0 } }]);
    // Parts of another make say nothing: a value map that is no list, a period format with no format, entries that are no objects.
    expect(read({ periodFormats: [{ target: "_9000000001_", periodFormat: { locale: "en_GB" } }], valueMaps: { [id(PRODUCTS)]: { A: 1 } } })).toEqual([
      { target: "Time", source: "column", column: 1 }, { target: "Products", source: "column", column: 2 }]);
    expect(read({ periodFormats: "MMM", valueMaps: [null, { target: id(PRODUCTS), values: [1] }] })).toEqual([
      { target: "Time", source: "column", column: 1 }, { target: "Products", source: "column", column: 2, items: { byHand: 0, ignored: 0 } }]);
    // An import into a list reads none of them; a definition with none of the parts says nothing of them, and the log has
    // no line on them.
    expect(read({ periodFormats: [{ target: "_9000000001_", periodFormat: null }], valueMaps: [] }, "HIERARCHY_DATA")).toEqual([
      { target: "Time", source: "column", column: 1 }, { target: "Products", source: "column", column: 2 }]);
    expect(readDefinition(definition("MODULE_DATA", PRICES, [time]), NAMES).details).toHaveLength(2);
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
      { id: "112000000001", name: "Division from HQ Network.csv", importType: "HIERARCHY_DATA", targets: [{ target: "Division", source: "column", column: 1 }], matchedBy: { by: "name" } },
      { id: "112000000003", name: "Prices", importType: "MODULE_DATA", targets: [{ target: "Value", source: "column", column: 3 }] },
      // An import the grid holds no definition for says so: none of the imports from a file is left out.
      { id: "112000000004", name: "Gone", importType: "", targets: [], note: MAPPING_NOTES.noDefinition }]);
    // The import from another model is neither read nor said; each import from a file has its lines, how its definition
    // is made, writes its first column and holds the parts that could say more, and the last line counts what was read
    // and what the grid of definitions holds.
    const parts = "source absent; dataFormatDefinitions absent; dataFormatsByTarget absent";
    expect(log).toEqual(["Import mapping 112000000001: keys importType, target, mappings; 1 mappings: [targetType, target, sourceType, sourceColumnId] column ×1",
      'Import mapping 112000000001: first column: sourceColumnId text "#1", sourceColumnNumber absent, sourceColumnName absent', `Import mapping 112000000001: ${parts}`,
      "Import mapping 112000000003: keys importType, target, mappings; 1 mappings: [targetType, target, sourceType, sourceColumnId] column ×1",
      'Import mapping 112000000003: first column: sourceColumnId text "#3", sourceColumnNumber absent, sourceColumnName absent', `Import mapping 112000000003: ${parts}`,
      "Import mapping 112000000004: not in the grid of definitions", "Import mappings: 2 of 3 read; 2 found in the grid of definitions"]);
    // What the tab holds, said before anything is read: its imports by Source Type, as Anaplan writes each, and how many
    // mappings are to be read.
    expect(importsLine(TAB)).toBe("Import mappings: 4 imports; Source Types: FILE ×2, SAVED VIEW ×1, file ×1; 3 mappings to read");
    expect(importsLine({ ...TAB, rows: TAB.rows.slice(1, 2).map(row => ({ ...row, cells: row.cells.map((cell, index) => (index === 2 ? " " : cell)) })) }))
      .toBe("Import mappings: 1 imports; Source Types: blank ×1; 0 mappings to read");
  });

  it("say that they could not be read where the model gave no definitions, or none under the definitions' ID", () => {
    const log: string[] = [];
    const unread = importMappings(TAB, undefined, NAMES, line => log.push(line));
    expect(unread.map(mapping => [mapping.name, mapping.note, mapping.targets])).toEqual([["Division from HQ Network.csv", MAPPING_NOTES.notRead, []],
      ["Prices", MAPPING_NOTES.notRead, []], ["Gone", MAPPING_NOTES.notRead, []]]);
    expect(log).toEqual(["Import mappings: 0 of 3 read; the model gave no grid of definitions"]);
    // A client that numbers the column of definitions otherwise: the definitions are looked for under the ID the client
    // says, then under the column's label, and are not taken from another column.
    const elsewhere = importMappings(TAB, DEFINITIONS, NAMES, line => log.push(line), 4000009999);
    expect([elsewhere.map(mapping => mapping.note), log.at(-1)]).toEqual([[undefined, undefined, MAPPING_NOTES.noDefinition], "Import mappings: 2 of 3 read; 2 found in the grid of definitions"]);
    log.length = 0;
    const unlabelled: Grid = { ...DEFINITIONS, columns: DEFINITIONS.columns.map(column => ({ ...column, labels: [column.labels[0] === "Import Definition" ? "Definition" : column.labels[0]] })) };
    const nowhere = importMappings(TAB, unlabelled, NAMES, line => log.push(line), 4000009999);
    expect([new Set(nowhere.map(mapping => mapping.note)), log]).toEqual([new Set([MAPPING_NOTES.notRead]),
      ["Import mappings: no column of definitions among the 2 given", "Import mappings: 0 of 3 read; the grid has no column of definitions"]]);
    // A tab without its Source Type column names no import from a file, and the line on it says so.
    expect(importsLine({ columns: TAB.columns.slice(0, 2), rows: TAB.rows })).toBe("Import mappings: 4 imports; the Imports tab has no Source Type column");
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

  it("say whether a list is numbered by its row's Numbered cell of General Lists, and nothing of a list the grid lacks", () => {
    const general = grid([[4000000020, "Top Level"], [4000000021, "Numbered"]], [[PRODUCTS, "Products", "All", "false"], [DIVISION, "Division", "", " TRUE "], [REGIONS, "Regions", "", ""]]);
    const names = importNames(native({}), { lists: general });
    expect([names.numbered?.(PRODUCTS), names.numbered?.(DIVISION), names.numbered?.(REGIONS), names.numbered?.(101000000099)]).toEqual([false, true, undefined, undefined]);
    // A grid without the column knows of no list whether it is numbered.
    expect(importNames(native({}), { lists: grid([[4000000020, "Top Level"]], [[DIVISION, "Division", ""]]) }).numbered?.(DIVISION)).toBeUndefined();
  });

  it("are none, and no failure, where the model page has no such list or throws for it", () => {
    const fails = () => { throw new Error("The model is not loaded."); };
    const names = importNames(native({ getHierarchiesLabelPage: fails, getHierarchySubsetsLabelPage: () => ({ entityLongIds: "1", labels: [] }), getLineItemsLabelPage: fails }), {});
    expect([names.list(PRODUCTS), names.lineItem(UNITS, PRICES), names.property(MANAGER, DIVISION)]).toEqual([undefined, undefined, undefined]);
  });
});
