import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HEADER_ROW_BY_HAND, MISSING_LINE_ITEM_NOTE, mappingView } from "../results/import-mapping-view.js";
import { exportModel } from "./export.js";
import type { Grid } from "./grid.js";
import { IMPORT_DEFINITION, importMappings, importNames, importsLine, MAPPING_NOTES, readDefinition, readImportMappings, SOURCE_DEFINITION, type ImportNames } from "./import-mappings.js";
import { readGrid, type Native } from "./native.js";

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
    // Each target says what it is: a dimension of the module (Time, Versions, a list or the line items), or a line item.
    // With no globalTargetAreaSpecification, the import clears its target first.
    expect(mapping).toEqual({ importType: "MODULE_DATA", clear: "clear", targets: [
      { target: "Products", source: "column", column: 1, text: "Product", kind: "list" },
      { target: "Time", source: "column", column: 2, text: "Month", kind: "time" },
      { target: "Versions", source: "constant", text: "Actual", kind: "versions" },
      { target: "+ Regions", source: "prompt", kind: "list" },
      // A list the model names nowhere is said by its ID, as the page says one elsewhere.
      { target: "ID 101000000099", source: "ignore", kind: "list" },
      { target: "Line Items", source: "headerRow", kind: "lineItems" },
      // A line item's column can be named by its heading alone, or by its place counted from 0, written as digits.
      { target: "Units", source: "column", text: "Units", kind: "lineItem" },
      { target: "Price", source: "column", column: 6, kind: "lineItem" },
      { target: "ID 1901000000099", source: "none", kind: "lineItem" }], headers: [{ header: "Units", lineItem: "Units" }] });
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
    // Each is the column of values where each row names its line item (the blank line item): a kind of its own.
    const sources = readDefinition(definition("MODULE_DATA", PRICES, mappings), NAMES).mapping.targets.map(({ target, kind, ...source }) => (target === "Value" && kind === "value" ? source : target));
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
    expect(readDefinition(definition("MODULE_DATA", PRICES, kinds), NAMES).mapping.targets).toEqual([["Line Items", "lineItems"], ["Value", "value"], ["Property", "other"],
      ["somethingNew", "other"]].map(([target, kind]) => ({ target, source: "none", kind })));
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

  it("reads what an import into a module holds of its sources: headers and items mapped manually or ignored, Time's period format and a date's format", () => {
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
    expect(mapping).toEqual({ importType: "MODULE_DATA", clear: "clear", targets: [
      // Each dimension fed by a column says how many of its items are mapped manually and ignored: none of either is the
      // dialog's Match on names or codes. A dimension that targetAreaSpecifications names says which items it clears.
      { target: "Products", source: "column", text: "Product", items: { byHand: 1, ignored: 1 }, kind: "list", area: "ALL_ITEMS" },
      { target: "Time", source: "column", column: 2, text: "Month", periodFormat: "MMM YY", kind: "time" },
      { target: "+ Regions", source: "column", column: 3, items: { byHand: 0, ignored: 0 }, kind: "list" },
      { target: "Line Items", source: "headerRow", items: { byHand: 2, ignored: 1 }, kind: "lineItems", area: "MATCHED_ITEMS" },
      { target: "Units", source: "column", text: "Units", kind: "lineItem" },
      { target: "Price", source: "column", text: "Price", dateFormat: "DD/MM/YYYY", kind: "lineItem" }],
    // The headers mapped manually, each with its line item, and the one ignored; a value that is no item's ID is no mapping.
    headers: [{ header: "Unit count", lineItem: "Units" }, { header: "Price (EUR)", lineItem: "Price" }, { header: "Notes" },
      { header: "Units", lineItem: "Units" }, { header: "Price", lineItem: "Price" }] });
    // The log says how each part is made, and no value of the import's source.
    expect(details[2]).toBe("valueMaps list of 3: 101000000001: 1 mapped, 1 ignored | 101000000002: 0 mapped, 0 ignored | line items: 2 mapped, 1 ignored, 2 of another kind "
      + "(text of 6 characters to an ID; text of 8 characters ignored); aliasMaps list of 1: line items: 0; "
      + "targetAreaSpecifications list of 2: 101000000001: ALL_ITEMS | line items: MATCHED_ITEMS; periodFormats list of 1: 9000000001: a format of 6 characters");
    expect(details[2]).not.toMatch(/Prod|Unit count|Notes|MMM|DD\/MM/);
  });

  it("keeps of a list's items mapped manually how many there are and how many are ignored, and nothing of the pairs: no value, no item, no list's or module's ID", () => {
    // As the dialog's tab of a list writes them with Map items manually (view/MappedDimensionImportOptions.js): a source
    // value to an item's ID, or to -1 where it is ignored. Division from a column, four values, one ignored; Regions from the
    // header row; Products matched on names or codes; Versions and the line items, from a column, mapped manually too.
    const [NORTH, SOUTH, EAST, REGION_A, PLAN] = [201000000011, 201000000012, 201000000013, 202000000001, 107000000001];
    const text = definition("MODULE_DATA", PRICES, [
      { targetType: "moduleDimension", target: id(DIVISION), sourceType: "column", sourceColumnId: "#1", sourceColumnName: "Division" },
      { targetType: "moduleDimension", target: id(REGIONS), sourceType: "headerRow" },
      { targetType: "moduleDimension", target: id(PRODUCTS), sourceType: "column", sourceColumnId: "#2" },
      { targetType: "moduleDimension", target: "_9000000002_", sourceType: "column", sourceColumnId: "#3" },
      { targetType: "moduleDimension", target: "", sourceType: "column", sourceColumnId: "#4" },
      // A list fed by no column or header row keeps nothing of a value map: the dialog shows it no such choice.
      { targetType: "moduleDimension", target: "_101000000098_", sourceType: "prompt" }], {
      valueMaps: [{ targetType: "moduleDimension", target: id(DIVISION), values: { North: NORTH, "South ": SOUTH, Unknown: -1, East: EAST } },
        { targetType: "moduleDimension", target: id(REGIONS), values: { "Region A": REGION_A } },
        { targetType: "moduleDimension", target: id(PRODUCTS), values: {} },
        { targetType: "moduleDimension", target: "_9000000002_", values: { Plan: PLAN } },
        { targetType: "moduleDimension", target: "", values: { "Units sold": UNITS } },
        { targetType: "moduleDimension", target: "_101000000098_", values: { Odd: NORTH } }] });
    const { mapping } = readDefinition(text, NAMES);
    // Every list, as Versions and the line items, says how many of its values are mapped manually, and how many ignored.
    expect(mapping.targets.map(({ target, items }) => ({ target, items }))).toEqual([
      { target: "Division", items: { byHand: 3, ignored: 1 } },
      { target: "+ Regions", items: { byHand: 1, ignored: 0 } },
      // Matched on names or codes: nothing is stored.
      { target: "Products", items: { byHand: 0, ignored: 0 } },
      { target: "Versions", items: { byHand: 1, ignored: 0 } },
      { target: "Line Items", items: { byHand: 1, ignored: 0 } },
      { target: "ID 101000000098", items: undefined }]);
    // And no more: the mapping holds none of the source values, none of the items they are mapped to, and neither the
    // lists' IDs nor the module's, which would name them. Only headers mapped to line items are kept pair by pair.
    const kept = JSON.stringify(mapping);
    expect([...["North", "South", "Unknown", "East", "Region A", "Plan", "Units sold", "Odd"], ...[NORTH, SOUTH, EAST, REGION_A, PLAN, DIVISION, REGIONS, PRICES].map(String)]
      .filter(words => kept.includes(words))).toEqual([]);
    expect([Object.keys(mapping).sort(), [...new Set(mapping.targets.flatMap(target => Object.keys(target)))].sort()])
      .toEqual([["clear", "importType", "targets"], ["column", "items", "kind", "source", "target", "text"]]);
  });

  it("says that Time's periods are matched by their names, takes the parts of no other make, and reads none of them for an import into a list", () => {
    const time = { targetType: "moduleDimension", target: "_9000000001_", sourceType: "column", sourceColumnId: "#1" };
    const read = (more: Record<string, unknown>, importType = "MODULE_DATA") => readDefinition(definition(importType, PRICES, [time,
      { targetType: "moduleDimension", target: id(PRODUCTS), sourceType: "column", sourceColumnId: "#2" }], more), NAMES).mapping.targets;
    expect(read({ periodFormats: [{ targetType: "moduleDimension", target: "_9000000001_", periodFormat: null }], valueMaps: [] })).toEqual([
      { target: "Time", source: "column", column: 1, periodFormat: null, kind: "time" }, { target: "Products", source: "column", column: 2, items: { byHand: 0, ignored: 0 }, kind: "list" }]);
    // Parts of another make say nothing: a value map that is no list, a period format with no format, entries that are no
    // objects, an area that is no word.
    expect(read({ periodFormats: [{ target: "_9000000001_", periodFormat: { locale: "en_GB" } }], valueMaps: { [id(PRODUCTS)]: { A: 1 } },
      targetAreaSpecifications: [{ target: "_9000000001_", area: "matched items" }, { target: id(PRODUCTS), area: 3 }] })).toEqual([
      { target: "Time", source: "column", column: 1, kind: "time" }, { target: "Products", source: "column", column: 2, kind: "list" }]);
    expect(read({ periodFormats: "MMM", valueMaps: [null, { target: id(PRODUCTS), values: [1] }], targetAreaSpecifications: { [id(PRODUCTS)]: "ALL_ITEMS" } })).toEqual([
      { target: "Time", source: "column", column: 1, kind: "time" }, { target: "Products", source: "column", column: 2, items: { byHand: 0, ignored: 0 }, kind: "list" }]);
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
    // One into a module that maps nothing has no target, and no note: it is read, with what it clears.
    expect(readDefinition(definition("MODULE_DATA", PRICES, []), NAMES).mapping).toEqual({ importType: "MODULE_DATA", targets: [], clear: "clear" });
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

describe("The mappings of a model's imports", () => {
  it("are those of every import of the Imports tab, whatever its Source Type, in the tab's order, each by its ID, name and Source Type", () => {
    const log: string[] = [];
    const mappings = importMappings(TAB, DEFINITIONS, NAMES, line => log.push(line));
    expect(mappings).toEqual([
      { id: "112000000001", name: "Division from HQ Network.csv", sourceType: "FILE", importType: "HIERARCHY_DATA", targets: [{ target: "Division", source: "column", column: 1 }],
        matchedBy: { by: "name" } },
      // The import of a saved view is read as any other: this one's definition is of no make Cardigan knows.
      { id: "112000000002", name: "Regions from the hub", sourceType: "SAVED VIEW", importType: "", targets: [], note: MAPPING_NOTES.unknown },
      // The Source Type as the tab writes it, without the spaces around it.
      { id: "112000000003", name: "Prices", sourceType: "file", importType: "MODULE_DATA", targets: [{ target: "Value", source: "column", column: 3, kind: "value" }], clear: "clear" },
      // An import the grid holds no definition for says so: none of the imports is left out.
      { id: "112000000004", name: "Gone", sourceType: "FILE", importType: "", targets: [], note: MAPPING_NOTES.noDefinition }]);
    // Each import has its lines, how its definition is made, writes its first column and holds the parts that could say
    // more, and the last line counts what was read and what the grid of definitions holds.
    const parts = "source absent; dataFormatDefinitions absent; dataFormatsByTarget absent";
    expect(log).toEqual(["Import mapping 112000000001: keys importType, target, mappings; 1 mappings: [targetType, target, sourceType, sourceColumnId] column ×1",
      'Import mapping 112000000001: first column: sourceColumnId text "#1", sourceColumnNumber absent, sourceColumnName absent', `Import mapping 112000000001: ${parts}`,
      "Import mapping 112000000002: keys ; mappings is not a list", "Import mapping 112000000002: no mapping from a column", `Import mapping 112000000002: ${parts}`,
      "Import mapping 112000000003: keys importType, target, mappings; 1 mappings: [targetType, target, sourceType, sourceColumnId] column ×1",
      'Import mapping 112000000003: first column: sourceColumnId text "#3", sourceColumnNumber absent, sourceColumnName absent', `Import mapping 112000000003: ${parts}`,
      "Import mapping 112000000004: not in the grid of definitions", "Import mappings: 2 of 4 read; 3 found in the grid of definitions"]);
    // What the tab holds, said before anything is read: its imports by Source Type, as Anaplan writes each, and how many
    // mappings are to be read: all of them.
    expect(importsLine(TAB)).toBe("Import mappings: 4 imports; Source Types: FILE ×2, SAVED VIEW ×1, file ×1; 4 mappings to read");
    expect(importsLine({ ...TAB, rows: TAB.rows.slice(1, 2).map(row => ({ ...row, cells: row.cells.map((cell, index) => (index === 2 ? " " : cell)) })) }))
      .toBe("Import mappings: 1 imports; Source Types: blank ×1; 1 mapping to read");
  });

  it("say that they could not be read where the model gave no definitions, or none under the definitions' ID", () => {
    const log: string[] = [];
    const unread = importMappings(TAB, undefined, NAMES, line => log.push(line));
    expect(unread.map(mapping => [mapping.name, mapping.note, mapping.targets])).toEqual([["Division from HQ Network.csv", MAPPING_NOTES.notRead, []],
      ["Regions from the hub", MAPPING_NOTES.notRead, []], ["Prices", MAPPING_NOTES.notRead, []], ["Gone", MAPPING_NOTES.notRead, []]]);
    expect(log).toEqual(["Import mappings: 0 of 4 read; the model gave no grid of definitions"]);
    // A client that numbers the column of definitions otherwise: the definitions are looked for under the ID the client
    // says, then under the column's label, and are not taken from another column.
    const elsewhere = importMappings(TAB, DEFINITIONS, NAMES, line => log.push(line), 4000009999);
    expect([elsewhere.map(mapping => mapping.note), log.at(-1)]).toEqual([[undefined, MAPPING_NOTES.unknown, undefined, MAPPING_NOTES.noDefinition],
      "Import mappings: 2 of 4 read; 3 found in the grid of definitions"]);
    log.length = 0;
    const unlabelled: Grid = { ...DEFINITIONS, columns: DEFINITIONS.columns.map(column => ({ ...column, labels: [column.labels[0] === "Import Definition" ? "Definition" : column.labels[0]] })) };
    const nowhere = importMappings(TAB, unlabelled, NAMES, line => log.push(line), 4000009999);
    expect([new Set(nowhere.map(mapping => mapping.note)), log]).toEqual([new Set([MAPPING_NOTES.notRead]),
      ["Import mappings: no column of definitions among the 2 given", "Import mappings: 0 of 4 read; the grid has no column of definitions"]]);
    // A tab without its Source Type column says so, and every import is read all the same, with no Source Type.
    const typeless: Grid = { columns: TAB.columns.filter(column => column.labels[0] !== "Source Type"), rows: TAB.rows.map(row => ({ ...row, cells: row.cells.filter((_, at) => at !== 2) })) };
    expect(importsLine(typeless)).toBe("Import mappings: 4 imports; the Imports tab has no Source Type column; 4 mappings to read");
    expect(importMappings(typeless, DEFINITIONS, NAMES, () => undefined).map(mapping => [mapping.name, mapping.sourceType])).toEqual([["Division from HQ Network.csv", ""],
      ["Regions from the hub", ""], ["Prices", ""], ["Gone", ""]]);
  });
});

// The sources of imports, and an import shaped as a live one the owner compared with Anaplan's dialog: Time from a column
// kept by its heading with a period format, a list prompted each run, the line items from the header row with three
// headers mapped manually, and the import clearing its target first. Every name and ID is made up.
const [BANDS, JOIN_BAND, STAFF_COSTS] = [102000000005, 101000000005, 102000000008];
const [BONUS, BAND_START, BAND_END] = [1901000000051, 1901000000052, 1901000000053];
const [STAFF_BONUS, START_MONTH, GONE_COLUMN] = [1901000000081, 1901000000082, 1901000000099];
const BAND_NAMES: ImportNames = {
  list: entity => new Map([[JOIN_BAND, "Join Band"]]).get(entity),
  lineItem: (entity, module) => (module === BANDS ? new Map([[BONUS, "Bonus Rate"], [BAND_START, "Band start"], [BAND_END, "Band end"]])
    : module === STAFF_COSTS ? new Map([[STAFF_BONUS, "Staff bonus"], [START_MONTH, "Start month"]]) : new Map<number, string>()).get(entity),
  property: () => undefined,
};
/** A data source's identifier, as an import's definition names it. */
const sourceId = (source: number): string => `_${source}_`;
/** The live import's shape, into the bands module, read from the data source `source`. */
const JOINERS = (source: number, more: Record<string, unknown> = {}) => definition("MODULE_DATA", BANDS, [
  { targetType: "moduleDimension", target: "_9000000001_", sourceType: "column", sourceColumnId: "Time", sourceColumnNumber: -1, sourceColumnName: null },
  { targetType: "moduleDimension", target: id(JOIN_BAND), sourceType: "prompt" },
  { targetType: "moduleDimension", target: "", sourceType: "headerRow" },
  { targetType: "moduleLineItem", target: "", sourceType: "undefined" }], {
  source: sourceId(source),
  valueMaps: [{ targetType: "moduleDimension", target: "", values: { "Bonus Rate": BONUS, "Band start": BAND_START, "Band end": BAND_END } },
    { targetType: "moduleDimension", target: id(JOIN_BAND), values: {} }, { targetType: "moduleDimension", target: "_9000000001_", values: {} }],
  targetAreaSpecifications: [{ target: "", area: "MAPPED_ITEMS_IN_SOURCE" }, { target: id(JOIN_BAND), area: "MATCHED_ITEMS" }, { target: "_9000000001_", area: "MATCHED_ITEMS" }],
  periodFormats: [{ targetType: "moduleDimension", target: "_9000000001_", periodFormat: { format: "M-Y", locale: "en_GB" } }], ...more });
/** An import of the staff costs module into the bands module: its Time and its list by the entities they are, one kept
 * with its name and one without; its line items from the header row, each from a line item of the source module, kept by
 * its name and the entity as digits, by an entity's identifier, and by an entity that nothing names. */
const FROM_STAFF_COSTS = (source: number) => definition("MODULE_DATA", BANDS, [
  { targetType: "moduleDimension", target: "_9000000001_", sourceType: "column", sourceColumnEntityLongId: 9000000001, sourceColumnName: "Time" },
  { targetType: "moduleDimension", target: id(JOIN_BAND), sourceType: "column", sourceColumnEntityLongId: JOIN_BAND },
  { targetType: "moduleDimension", target: "", sourceType: "headerRow" },
  { targetType: "moduleLineItem", target: id(BONUS), sourceType: "column", sourceColumnEntityLongId: String(STAFF_BONUS), sourceColumnName: "Bonus paid" },
  { targetType: "moduleLineItem", target: id(BAND_START), sourceType: "column", sourceColumnId: id(START_MONTH) },
  { targetType: "moduleLineItem", target: id(BAND_END), sourceType: "column", sourceColumnEntityLongId: GONE_COLUMN }],
{ source: sourceId(source), globalTargetAreaSpecification: "MAPPED_ITEMS_IN_SOURCE", targetAreaSpecifications: [{ target: id(JOIN_BAND), area: "ALL_ITEMS" }] });
/** Data sources as their definitions write them (anaplan-sam's definition-core.ts): uploaded data with its settings, the
 * rows as text; a model's object of this model, and of another, with every ID and name a definition holds. */
const UPLOADED = (settings: Record<string, unknown> = {}) => JSON.stringify({ dataSourceType: "UPLOADED_FILE", textEncoding: "ISO-8859-1", columnSeparators: ",",
  textDelimiter: "\"", decimalSeparator: ".", headerRow: "1", firstDataRow: "2", ...settings });
const THIS_MODEL = "4B7E0C1D9A2F4E3B8C6D5A4F3E2D1C0B";
const OTHER_MODEL = "7C1D2E3F4A5B4C6D8E9F0A1B2C3D4E5F";
const OWN_OBJECT = JSON.stringify({ dataSourceType: "MODEL_OBJECT", modelId: "", modelName: "Invented plan", objectId: STAFF_COSTS, objectName: "PLN08 Staff Costs",
  splitCompositeDimensions: "false" });
const OTHER_OBJECT = JSON.stringify({ dataSourceType: "MODEL_OBJECT", modelId: OTHER_MODEL, workspaceId: "8a81b09c5f4d2e01015f6c3d2a1b9999", modelName: "Invented hub",
  objectId: STAFF_COSTS, objectName: "HUB08 Hub Costs", splitCompositeDimensions: "true" });

describe("The sources of a model's imports", () => {
  /** The Imports tab: imports of uploaded data, two of one source; one with a source not set up, one written "null",
   * one whose source cannot be read, one whose definition names no source, one whose source is not in the grid; and two
   * imports of a model's module, of this model and of another. */
  const IMPORTS = grid([[4000000003, "Source Type"], [4000000004, "Target Object"]], [
    [112000000051, "Load joiners", "FILE", "PLN05 Join Bands"], [112000000052, "Load joiners again", "FILE", "PLN05 Join Bands"],
    [112000000053, "Load unset", "FILE", "PLN05 Join Bands"], [112000000054, "Load null", "FILE", "PLN05 Join Bands"],
    [112000000055, "Load broken", "FILE", "PLN05 Join Bands"], [112000000056, "Load sourceless", "FILE", "PLN05 Join Bands"],
    [112000000057, "Load elsewhere", "FILE", "PLN05 Join Bands"],
    [112000000058, "Bands from staff costs", "MODULE", "PLN05 Join Bands"], [112000000059, "Bands from the hub", "SAVED VIEW", "PLN05 Join Bands"]]);
  const DEFINED = grid([[IMPORT_DEFINITION, "Import Definition"]], [
    [112000000051, "Load joiners", JOINERS(113000000012)], [112000000052, "Load joiners again", JOINERS(113000000012)],
    [112000000053, "Load unset", JOINERS(113000000013)], [112000000054, "Load null", JOINERS(113000000014)],
    [112000000055, "Load broken", JOINERS(113000000015)], [112000000056, "Load sourceless", JOINERS(113000000012, { source: undefined })],
    [112000000057, "Load elsewhere", JOINERS(113000000099)],
    [112000000058, "Bands from staff costs", FROM_STAFF_COSTS(113000000016)], [112000000059, "Bands from the hub", FROM_STAFF_COSTS(113000000017)]]);
  /** The grid of the sources against their properties: a column before the definitions', found by its ID. */
  const SOURCES = grid([[4000001401, "Notes"], [SOURCE_DEFINITION, "Data Source Definition"]], [
    [113000000012, "joiners.csv", "", UPLOADED()], [113000000013, "unset.csv", "", ""], [113000000014, "null.csv", "", "null"],
    [113000000015, "broken.csv", "", '{"dataSourceType":"UPLOADED_FILE",'], [113000000016, "PLN08 Staff Costs", "", OWN_OBJECT],
    [113000000017, "Invented hub / HUB08", "", OTHER_OBJECT]]);
  const read = (log: string[] = []) => importMappings(IMPORTS, DEFINED, BAND_NAMES, line => log.push(line), IMPORT_DEFINITION,
    { grid: SOURCES, column: SOURCE_DEFINITION, model: THIS_MODEL });

  it("reads the live import's shape as its dialog keeps it: what it clears, each dimension's clear choice, Time's period format and the headers mapped manually", () => {
    const [joiners] = read();
    expect(joiners).toEqual({ id: "112000000051", name: "Load joiners", sourceType: "FILE", importType: "MODULE_DATA", clear: "clear", targets: [
      { target: "Time", source: "column", text: "Time", kind: "time", area: "MATCHED_ITEMS", periodFormat: "M-Y" },
      // The list is prompted each run: the dialog shows no clear choice for it, and none is kept.
      { target: "Join Band", source: "prompt", kind: "list" },
      { target: "Line Items", source: "headerRow", kind: "lineItems", area: "MAPPED_ITEMS_IN_SOURCE", items: { byHand: 3, ignored: 0 } }],
    headers: [{ header: "Bonus Rate", lineItem: "Bonus Rate" }, { header: "Band start", lineItem: "Band start" }, { header: "Band end", lineItem: "Band end" }],
    fileOptions: { encoding: "ISO-8859-1", separators: ",", delimiter: "\"", decimal: ".", headerRow: 1, firstDataRow: 2 } });
    // Any globalTargetAreaSpecification is the dialog's Only update imported cells.
    expect(readDefinition(JOINERS(113000000012, { globalTargetAreaSpecification: "MAPPED_ITEMS_IN_SOURCE" }), BAND_NAMES).mapping.clear).toBe("update");
    expect(readDefinition(JOINERS(113000000012, { globalTargetAreaSpecification: null }), BAND_NAMES).mapping.clear).toBe("clear");
  });

  it("keeps of uploaded data its File Options alone, for each import of one source, and says in one line of the log how the sources are made and why an import has none", () => {
    const log: string[] = [];
    const mappings = read(log);
    // Two imports of one source each keep its settings; the others have none, and nothing else of their sources.
    expect(mappings.map(mapping => [mapping.name, mapping.fileOptions?.encoding])).toEqual([["Load joiners", "ISO-8859-1"], ["Load joiners again", "ISO-8859-1"],
      ["Load unset", undefined], ["Load null", undefined], ["Load broken", undefined], ["Load sourceless", undefined], ["Load elsewhere", undefined],
      ["Bands from staff costs", undefined], ["Bands from the hub", undefined]]);
    // The line says how many definitions there are, of each type, how many imports of each kind found their sources, and
    // why the others did not: no setting, no name and no ID.
    const line = "Import mapping sources: 6 definitions: UPLOADED_FILE ×1, not set up ×2, not readable ×1, MODEL_OBJECT ×2; settings for 2 of 7 imports of uploaded data "
      + "(source not set up ×2, source not readable ×1, no source in the definition ×1, source not in the grid ×1); objects for 2 of 2 imports from a model, 1 in another model";
    expect(log.filter(entry => entry.startsWith("Import mapping sources:"))).toEqual([line]);
    expect(line).not.toMatch(/ISO|joiners|PLN08|Invented|HUB08|4B7E|7C1D|11300000|\bfiles?\b/i);
    // Its last lines: the mappings' line, then the sources'.
    expect(log.slice(-2)).toEqual(["Import mappings: 9 of 9 read; 9 found in the grid of definitions", line]);
    // A grid without its column of definitions says so, and keeps nothing.
    const without: string[] = [];
    const none = importMappings(IMPORTS, DEFINED, BAND_NAMES, entry => without.push(entry), IMPORT_DEFINITION, { grid: SOURCES, column: 4000009999, model: THIS_MODEL });
    expect([none.some(mapping => mapping.fileOptions), without.at(-1)]).toEqual([false, "Import mapping sources: no column of source definitions among the 2 given"]);
    // Without the sources' grid, which the export says why it has not, nothing is said of them.
    const unread: string[] = [];
    importMappings(IMPORTS, DEFINED, BAND_NAMES, entry => unread.push(entry));
    expect(unread.filter(entry => entry.startsWith("Import mapping sources"))).toEqual([]);
  });

  it("takes each setting the dialog reads where it is as the dialog writes it, and nothing else", () => {
    const options = (settings: Record<string, unknown>) => importMappings(grid([[1, "Source Type"]], [[112000000051, "Load joiners", "FILE"]]),
      grid([[IMPORT_DEFINITION, "Import Definition"]], [[112000000051, "Load joiners", JOINERS(113000000012)]]), BAND_NAMES, () => undefined, IMPORT_DEFINITION,
      { grid: grid([[SOURCE_DEFINITION, "Definition"]], [[113000000012, "joiners.csv", JSON.stringify(settings)]]), column: SOURCE_DEFINITION, model: THIS_MODEL })[0].fileOptions;
    // Every separator the dialog ticks, and another of the modeller's; each delimiter; a decimal comma; rows as numbers.
    expect(options({ dataSourceType: "UPLOADED_FILE", textEncoding: " UTF-8 ", columnSeparators: "\t,;|", textDelimiter: "'", decimalSeparator: ",", headerRow: 0, firstDataRow: 1 }))
      .toEqual({ encoding: "UTF-8", separators: "\t,;|", delimiter: "'", decimal: ",", headerRow: 0, firstDataRow: 1 });
    expect(options({ dataSourceType: "UPLOADED_FILE", columnSeparators: "", textDelimiter: "" })).toEqual({ separators: "", delimiter: "" });
    // A setting of another make is left out; a source of uploaded data without any has none; a name or an ID is never taken.
    expect(options({ dataSourceType: "UPLOADED_FILE", textEncoding: 7, columnSeparators: ",".repeat(21), textDelimiter: "\"\"\"\"\"", decimalSeparator: "",
      headerRow: "first", firstDataRow: -2, fileName: "joiners.csv", objectId: STAFF_COSTS })).toBeUndefined();
    expect(options({ dataSourceType: "UPLOADED_FILE", headerRow: "3", fileName: "joiners.csv", modelId: THIS_MODEL })).toEqual({ headerRow: 3 });
    // A model's object, or a source of another type, keeps no settings.
    expect([options({ dataSourceType: "MODEL_OBJECT", objectId: STAFF_COSTS, textEncoding: "UTF-8" }), options({ dataSourceType: "SALESFORCE_API", textEncoding: "UTF-8" })])
      .toEqual([undefined, undefined]);
  });

  it("names the columns of this model's object by this model's names, keeps the names the definition writes, and keeps nothing of the object", () => {
    const log: string[] = [];
    const mappings = read(log);
    const own = mappings.find(mapping => mapping.name === "Bands from staff costs")!;
    expect(own).toEqual({ id: "112000000058", name: "Bands from staff costs", sourceType: "MODULE", importType: "MODULE_DATA", clear: "update", targets: [
      // The name the definition writes stays as it is written.
      { target: "Time", source: "column", text: "Time", kind: "time" },
      // An entity the definition names by its ID alone is named as this model names it.
      { target: "Join Band", source: "column", text: "Join Band", kind: "list", area: "ALL_ITEMS" },
      { target: "Line Items", source: "headerRow", kind: "lineItems" },
      // A line item of the source module, by the name the definition writes for it (its ID written as digits), by its
      // identifier, and by an ID nothing names, which stays an ID.
      { target: "Bonus Rate", source: "column", text: "Bonus paid", kind: "lineItem" },
      { target: "Band start", source: "column", text: "Start month", kind: "lineItem" },
      { target: "Band end", source: "column", text: `ID ${GONE_COLUMN}`, kind: "lineItem" }],
    headers: [{ header: "Bonus paid", lineItem: "Bonus Rate" }, { header: "Start month", lineItem: "Band start" }, { header: `ID ${GONE_COLUMN}`, lineItem: "Band end" }] });
    // Nothing of the source is kept: no model, no workspace, no object, by name or by ID.
    expect(JSON.stringify(mappings)).not.toMatch(new RegExp(`${THIS_MODEL}|${OTHER_MODEL}|8a81b09c|${STAFF_COSTS}|PLN08|HUB08|Invented`));
    // The ID that stays is said in the log as any other, by what the client classes it as.
    const names: ImportNames = { ...BAND_NAMES, describe: entity => `ID ${entity} is described` };
    const described: string[] = [];
    importMappings(IMPORTS, DEFINED, names, line => described.push(line), IMPORT_DEFINITION, { grid: SOURCES, column: SOURCE_DEFINITION, model: THIS_MODEL });
    expect(described.filter(line => line.startsWith("Import mappings: Bands from"))).toEqual([`Import mappings: Bands from staff costs: ID ${GONE_COLUMN} is described`,
      "Import mappings: Bands from the hub: 3 source columns keep their IDs: the source is another model's"]);
  });

  it("gives the live import's dimensions and line items exactly as the owner chose to see them", () => {
    expect(mappingView(read()[0])).toEqual({ clear: "Clear target prior to import", rows: [],
      from: { label: "File", text: 'Header row 1 · data from row 2 · Comma · " · Dot · ISO-8859-1' },
      dimensions: [["Time", "Column: Time", "Periods, M-Y", "Matched items only"], ["Join Band", "Prompt each run", "", ""],
        ["Line Items", "Header row", "Mapped manually", "Mapped items in source"]],
      lineItems: { count: 3, heading: "Header", rows: [["Bonus Rate", "Bonus Rate"], ["Band start", "Band start"], ["Band end", "Band end"]], notes: [] },
      lines: ["Each column mapped is named by its heading alone, so Cardigan cannot say which columns are not used."] });
  });

  it("are read by the export in one grid more, once, after the imports' definitions, by the column's own ID where the client names none, and nothing else is sent", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const requests: any[] = [];
    const served: Record<string, Grid | undefined> = { importsTab: IMPORTS, importDefinitions: DEFINED, sourceDefinitions: SOURCES };
    const constants: Record<string, unknown> = { SYSTEM_AXIS_IDENTIFIER_IMPORT_ALL_IDENTIFIER: "imports", SYSTEM_AXIS_IDENTIFIER_IMPORT_DEFINITION_PROPERTY_IDENTIFIER: "importsTab",
      SYSTEM_AXIS_IDENTIFIER_IMPORT_PROPERTY_IDENTIFIER: "importDefinitions", SYSTEM_AXIS_IDENTIFIER_IMPORT_DATA_SOURCE_IDENTIFIER: "dataSources",
      SYSTEM_AXIS_IDENTIFIER_IMPORT_DATA_SOURCE_PROPERTY_IDENTIFIER: "sourceDefinitions" };
    const native = {
      workspaceId: "a".repeat(32), modelId: THIS_MODEL, cache: { getModelName: () => "Invented plan" }, ids: {}, axisHelper: {}, constants,
      helper: { getAxesForViewDefinition: (rows: string[], columns: string[]) => ({ rowAxis: rows[0], columnAxis: columns[0] }) },
      RequestGenerator: class { getRequest(params: unknown) { return { requestType: "VIEW_REQUEST_SET", submissions: [], systemActions: [], params }; } },
      DataPage: class {
        page: { startRow: number; rows: string[][] };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        constructor({ page }: any) { this.page = page; }
        contains(row: number, column: number) { return this.page.rows[row - this.page.startRow]?.[column] !== undefined; }
        getIndex(row: number, column: number) { return (row - this.page.startRow) * this.page.rows[0].length + column; }
        getOriginalText(index: number) { return this.page.rows.flat()[index]; }
        getCellText(index: number) { return this.getOriginalText(index); }
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      aggregator: { isDirty: () => false, post(request: any, _flag: boolean, ok: (response: unknown) => void) {
        requests.push(request);
        const { viewDefinition, pageRequests: [{ startRow, rowCount }] } = request.params;
        const read = served[viewDefinition.columnAxis];
        if (!read) { ok({ error: "unavailable" }); return; }
        const rows = read.rows.slice(startRow, startRow + rowCount);
        ok({ result: { viewRequestResults: [{ rowCount: read.rows.length, columnCount: read.columns.length,
          rowLabelPages: [{ count: rows.length, entityLongIds: [rows.map(row => row.ids[0])], labels: [rows.map(row => row.labels[0])] }],
          columnLabelPages: [{ count: read.columns.length, entityLongIds: [read.columns.map(column => column.ids[0])], labels: [read.columns.map(column => column.labels[0])] }],
          dataPages: [{ startRow, rows: rows.map(row => row.cells) }] }] } });
      } },
    };
    const run = async () => {
      vi.stubGlobal("window", { workspaceId: native.workspaceId, modelId: native.modelId, require: (_modules: string[], loaded: (...modules: unknown[]) => void) =>
        loaded(native.cache, native.aggregator, native.helper, native.ids, native.constants, native.RequestGenerator, native.DataPage, native.axisHelper) });
      vi.stubGlobal("location", { host: "example.test", pathname: "/model" });
      const log: string[] = [];
      requests.length = 0;
      const result = await exportModel({ status: () => undefined, log: line => log.push(line) }, () => "");
      vi.unstubAllGlobals();
      return { result, log };
    };
    const { result, log } = await run();
    // The tab, the imports' definitions and the sources' definitions, each a read of a view, and nothing else.
    expect(requests.map(request => `${request.params.viewDefinition.type} ${request.params.viewDefinition.rowAxis} × ${request.params.viewDefinition.columnAxis}`))
      .toEqual(["MODEL_DEFINITION imports × importsTab", "MODEL_DEFINITION imports × importDefinitions", "MODEL_DEFINITION dataSources × sourceDefinitions"]);
    expect(requests.every(request => request.requestType === "VIEW_REQUEST_SET" && !request.submissions.length && !request.systemActions.length)).toBe(true);
    expect(JSON.stringify(requests)).not.toMatch(/GET_IMPORT_SOURCE/);
    // The client names no column of the sources' definitions: it is found by SYSTEM_PROPERTY_IMPORT_DATA_SOURCE_DEFINITION's own ID.
    expect(result.importMappings?.map(mapping => mapping.fileOptions?.encoding)).toEqual(["ISO-8859-1", "ISO-8859-1", undefined, undefined, undefined, undefined, undefined, undefined, undefined]);
    expect(log.filter(line => line.startsWith("Import mapping sources"))).toEqual(["Import mapping sources: 6 rows × 2 columns; columns: Notes | Data Source Definition",
      expect.stringMatching(/^Import mapping sources: rows 0–5 in \d+\.\d\d s$/), expect.stringMatching(/^Import mapping sources: 6 definitions: UPLOADED_FILE ×1, not set up ×2, not readable ×1, MODEL_OBJECT ×2; settings for 2 of 7/)]);
    // A client that numbers it otherwise: none is taken for it.
    constants.SYSTEM_PROPERTY_IMPORT_DATA_SOURCE_DEFINITION = 4000009999;
    const elsewhere = await run();
    expect([elsewhere.result.importMappings?.some(mapping => mapping.fileOptions), elsewhere.log.at(-1)]).toEqual([false, "Import mapping sources: no column of source definitions among the 2 given"]);
    // A read the model refuses leaves the mappings as they are, and the log says why.
    delete constants.SYSTEM_PROPERTY_IMPORT_DATA_SOURCE_DEFINITION;
    served.sourceDefinitions = undefined;
    const refused = await run();
    expect(refused.result.importMappings?.map(mapping => mapping.targets)).toEqual(result.importMappings?.map(mapping => mapping.targets));
    expect([refused.result.importMappings?.some(mapping => mapping.fileOptions), refused.log.filter(line => line.startsWith("Import mapping sources"))])
      .toEqual([false, ["Import mapping sources: The model rejected the read."]]);
  });

  it("names no column of another model's object by this model's names: its entities are that model's", () => {
    const hub = read().find(mapping => mapping.name === "Bands from the hub")!;
    expect(hub.targets.map(target => [target.target, target.text])).toEqual([["Time", "Time"], ["Join Band", `ID ${JOIN_BAND}`], ["Line Items", undefined],
      ["Bonus Rate", "Bonus paid"], ["Band start", `ID ${START_MONTH}`], ["Band end", `ID ${GONE_COLUMN}`]]);
    // A model's import whose source is not known is named as one of another model: by the names it writes, and by IDs.
    const unknown = importMappings(IMPORTS, DEFINED, BAND_NAMES, () => undefined).find(mapping => mapping.name === "Bands from staff costs")!;
    expect(unknown.targets.map(target => target.text)).toEqual(["Time", `ID ${JOIN_BAND}`, undefined, "Bonus paid", `ID ${START_MONTH}`, `ID ${GONE_COLUMN}`]);
    // A model's own ID is this model's however it is written.
    const upper = importMappings(IMPORTS, DEFINED, BAND_NAMES, () => undefined, IMPORT_DEFINITION, { grid: { ...SOURCES, rows: SOURCES.rows.map(row => (row.ids[0] === 113000000017
      ? { ...row, cells: ["", OTHER_OBJECT.replace(OTHER_MODEL, THIS_MODEL.toLowerCase())] } : row)) }, column: SOURCE_DEFINITION, model: THIS_MODEL });
    expect(upper.find(mapping => mapping.name === "Bands from the hub")!.targets[1].text).toBe("Join Band");
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

  it.each([
    ["the property is missing from an existing propertiesLabelPage", { propertiesLabelPage: { entityLongIds: [MANAGER], labels: ["Manager"] } }],
    ["the list's info is absent altogether", undefined],
  ])("leaves a property unnamed when %s", (_cause, info) => {
    const names = importNames(native({
      getHierarchyInfo: () => info,
      getHierarchySubsetsLabelPage: () => ({ entityLongIds: [[109000000001]], labels: [["Active products"]] }),
    }), { lists });
    expect(names.property(ACTIVE, DIVISION)).toBeUndefined();
    const { mapping } = readDefinition(definition("HIERARCHY_DATA", DIVISION, [
      { targetType: "hierarchyProperty", target: id(ACTIVE), sourceType: "column", sourceColumnId: "#1" },
    ]), names);
    expect(mapping.targets).toEqual([{ target: `ID ${ACTIVE}`, source: "column", column: 1 }]);
  });

  it("are none, and no failure, where the model page has no such list or throws for it", () => {
    const fails = () => { throw new Error("The model is not loaded."); };
    const names = importNames(native({ getHierarchiesLabelPage: fails, getHierarchySubsetsLabelPage: () => ({ entityLongIds: "1", labels: [] }), getLineItemsLabelPage: fails }), {});
    expect([names.list(PRODUCTS), names.lineItem(UNITS, PRICES), names.property(MANAGER, DIVISION)]).toEqual([undefined, undefined, undefined]);
  });
});

describe("Missing import property names through Model Building", () => {
  const properties = grid([[4000000017, "Notes"]], [[MANAGER, "Manager from grid", ""], [ACTIVE, "Active &amp; available", ""]]);
  const lists = grid([], [[DIVISION, "Division"], [PRODUCTS, "Products"]]);
  const tab = grid([[4000001301, "Source Type"], [4000001302, "Target Object"]], [
    [112000000011, "Load division", "FILE", "Division"], [112000000012, "Update division", "FILE", "Division"],
  ]);
  const listDefinition = (list: number, ids = [MANAGER, ACTIVE], targetType = "hierarchyProperty") => definition("HIERARCHY_DATA", list,
    ids.map((target, index) => ({ targetType, target: id(target), sourceType: "column", sourceColumnId: `#${index + 1}` })));
  const definitions = grid([[IMPORT_DEFINITION, "Import Definition"]], [
    [112000000011, "Load division", listDefinition(DIVISION)], [112000000012, "Update division", listDefinition(DIVISION)],
  ]);

  /** Invented client label pages and transport. The real readGrid and assertRead guard every generated request. */
  function client(grids: Record<string, Grid> = { [id(DIVISION)]: properties }) {
    const requests: any[] = [];
    const native: Native = {
      workspaceId: "a".repeat(32), modelId: "b".repeat(32),
      cache: {
        getModelName: () => "Invented plan",
        getHierarchyInfo: vi.fn(() => ({ propertiesLabelPage: { entityLongIds: [MANAGER], labels: ["Manager"] } })),
        getHierarchySubsetsLabelPage: () => ({ entityLongIds: [[109000000001]], labels: [["Active products"]] }),
      },
      ids: { entityLongIdToEntityLongIdIdentifier: vi.fn(id) },
      axisHelper: { getHierarchySystemAxisIdentifier: () => "listProperties" },
      constants: {
        SYSTEM_AXIS_IDENTIFIER_CUSTOM_PROPERTY_IDENTIFIER: "customProperties",
        SYSTEM_AXIS_IDENTIFIER_PROPERTY_PROPERTY_IDENTIFIER: "propertyProperties",
        SYSTEM_AXIS_IDENTIFIER_IMPORT_ALL_IDENTIFIER: "imports",
        SYSTEM_AXIS_IDENTIFIER_IMPORT_DEFINITION_PROPERTY_IDENTIFIER: "importsTab",
        SYSTEM_AXIS_IDENTIFIER_IMPORT_PROPERTY_IDENTIFIER: "importDefinitions",
        SYSTEM_AXIS_IDENTIFIER_HIERARCHY_IDENTIFIER: "lists",
      },
      helper: { getAxesForViewDefinition: (rows: string[], columns: string[]) => ({ rowAxis: rows[0], columnAxis: columns[0] }) },
      RequestGenerator: class { getRequest(params: unknown) { return { requestType: "VIEW_REQUEST_SET", submissions: [], systemActions: [], params }; } },
      DataPage: class {
        page: { startRow: number; rows: string[][] };
        constructor({ page }: any) { this.page = page; }
        contains(row: number, column: number) { return this.page.rows[row - this.page.startRow]?.[column] !== undefined; }
        getIndex(row: number, column: number) { return (row - this.page.startRow) * this.page.rows[0].length + column; }
        getOriginalText(index: number) { return this.page.rows.flat()[index]; }
        getCellText(index: number) { return this.getOriginalText(index); }
      },
      aggregator: { isDirty: vi.fn(() => false), post(request: any, _flag: boolean, ok: (response: unknown) => void) {
        requests.push(request);
        const { viewDefinition, pageRequests: [{ startRow, rowCount }] } = request.params;
        const grid = grids[viewDefinition.staticContextIdentifiers[0] ?? viewDefinition.columnAxis];
        if (!grid) { ok({ error: "unavailable" }); return; }
        const rows = grid.rows.slice(startRow, startRow + rowCount);
        ok({ result: { viewRequestResults: [{ rowCount: grid.rows.length, columnCount: grid.columns.length,
          rowLabelPages: [{ count: rows.length, entityLongIds: [rows.map(row => row.ids[0])], labels: [rows.map(row => row.labels[0])] }],
          columnLabelPages: [{ count: grid.columns.length, entityLongIds: [grid.columns.map(column => column.ids[0])], labels: [grid.columns.map(column => column.labels[0])] }],
          dataPages: [{ startRow, rows: rows.map(row => row.cells) }] }] } });
      } },
    };
    return { native, requests };
  }
  beforeEach(() => vi.spyOn(Date, "now").mockReturnValue(1000));
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it.each(["hierarchyProperty", "hierarchyPropertyValue"].flatMap(targetType =>
    ["missing property", "missing list info"].map(cause => ({ targetType, cause }))))(
    "names $targetType targets with $cause from one scoped read for both imports", async ({ targetType, cause }) => {
    const { native, requests } = client();
    if (cause === "missing list info") native.cache.getHierarchyInfo.mockReturnValue(undefined);
    const targetDefinitions = { ...definitions, rows: definitions.rows.map(row => ({ ...row, cells: [listDefinition(DIVISION, undefined, targetType)] })) };
    const log: string[] = [];
    const names = importNames(native, { lists });
    const result = await readImportMappings(native, tab, targetDefinitions, names, line => log.push(line));
    expect(result.map(mapping => mapping.targets.map(target => target.target))).toEqual([
      [cause === "missing property" ? "Manager" : "Manager from grid", "Active & available"],
      [cause === "missing property" ? "Manager" : "Manager from grid", "Active & available"],
    ]);
    expect(requests.map(request => request.params.viewDefinition)).toEqual([
      { type: "MODEL_DEFINITION", staticContextIdentifiers: [id(DIVISION)], rowAxis: "customProperties", columnAxis: "propertyProperties" },
    ]);
    expect(native.ids.entityLongIdToEntityLongIdIdentifier.mock.calls).toEqual([[DIVISION]]);
    expect(requests.every(request => request.requestType === "VIEW_REQUEST_SET" && !request.submissions.length && !request.systemActions.length)).toBe(true);
    expect(log.filter(line => line.startsWith("Import mapping properties:") || line.startsWith("Import mappings: list"))).toEqual([
      "Import mapping properties: list 101000000007: 2 rows × 1 columns; columns: Notes",
      "Import mapping properties: list 101000000007: rows 0–1 in 0.00 s",
      `Import mappings: list Division (101000000007): properties grid held 2 properties; named ${cause === "missing property" ? "1 ID" : "2 IDs"}`,
    ]);
    // The page's cache was not filled by the read, and the next export gets a fresh grid.
    expect(names.property(ACTIVE, DIVISION)).toBeUndefined();
    await readImportMappings(native, tab, targetDefinitions, names, () => undefined);
    expect(requests).toHaveLength(2);
  });

  it("does not read when targetOf already names every target, including unfamiliar types", async () => {
    const { native, requests } = client();
    const namedDefinitions = grid([[IMPORT_DEFINITION, "Import Definition"]], [
      [112000000011, "Load division", definition("HIERARCHY_DATA", DIVISION, [
        { targetType: "hierarchyMemberEntityName", target: id(ACTIVE), sourceType: "undefined" },
        ...[4000000001, 4000000004, MANAGER, 109000000001].map(target => ({ targetType: "hierarchyProperty", target: id(target), sourceType: "undefined" })),
        ...[MANAGER, 109000000001, PRODUCTS].map(target => ({ targetType: "hierarchyPropertyValue", target: id(target), sourceType: "undefined" })),
        { targetType: "moduleDimension", target: "_9000000001_", sourceType: "undefined" },
      ])],
    ]);
    const log: string[] = [];
    const result = await readImportMappings(native, tab, namedDefinitions, importNames(native, { lists }), line => log.push(line));
    expect(result[0].targets.map(target => target.target)).toEqual(["Division", "Parent", "Code", "Manager", "Active products", "Manager", "Active products", "Products", "Time"]);
    expect(requests).toEqual([]);
    expect(native.ids.entityLongIdToEntityLongIdIdentifier).not.toHaveBeenCalled();
    expect(log.filter(line => line.startsWith("Import mappings: list"))).toEqual([]);
  });

  it("keeps IDs after a failed read and logs all remaining IDs once for the list", async () => {
    const { native, requests } = client({});
    native.cache.getHierarchyInfo.mockReturnValue(undefined);
    const log: string[] = [];
    const result = await readImportMappings(native, tab, definitions, importNames(native, { lists }), line => log.push(line));
    expect(result.map(mapping => mapping.targets.map(target => target.target))).toEqual([
      [`ID ${MANAGER}`, `ID ${ACTIVE}`], [`ID ${MANAGER}`, `ID ${ACTIVE}`],
    ]);
    expect(requests).toHaveLength(1);
    expect(log.filter(line => line.startsWith("Import mappings: list"))).toEqual([
      "Import mappings: list Division (101000000007): unnamed targets: ID 4100000000001 (targetType hierarchyProperty), ID 4100000000002 (targetType hierarchyProperty); properties grid not read (The model rejected the read.)",
    ]);
  });

  it("keeps and logs an ID absent from the grid without borrowing another list's rows", async () => {
    const otherTab = { ...tab, rows: [tab.rows[0], { ...tab.rows[1], cells: ["FILE", "Products"] }] };
    const otherDefinitions = { ...definitions, rows: [definitions.rows[0], { ...definitions.rows[1], cells: [listDefinition(PRODUCTS, undefined, "hierarchyPropertyValue")] }] };
    const { native, requests } = client({ [id(DIVISION)]: properties, [id(PRODUCTS)]: grid([[4000000017, "Notes"]], [[MANAGER, "Owner", ""]]) });
    native.cache.getHierarchyInfo.mockReturnValue(undefined);
    const log: string[] = [];
    const result = await readImportMappings(native, otherTab, otherDefinitions, importNames(native, { lists }), line => log.push(line));
    expect(result.map(mapping => mapping.targets.map(target => target.target))).toEqual([
      ["Manager from grid", "Active & available"], ["Owner", `ID ${ACTIVE}`],
    ]);
    expect(requests.map(request => request.params.viewDefinition.staticContextIdentifiers)).toEqual([[id(DIVISION)], [id(PRODUCTS)]]);
    expect(log.filter(line => line.startsWith("Import mappings: list"))).toEqual([
      "Import mappings: list Division (101000000007): properties grid held 2 properties; named 2 IDs",
      "Import mappings: list Products (101000000001): properties grid held 1 property; named 1 ID",
      "Import mappings: list Products (101000000001): unnamed targets: ID 4100000000002 (targetType hierarchyPropertyValue)",
    ]);
  });

  it("counts named IDs once across target types and logs each remaining kind once", async () => {
    const { native, requests } = client({ [id(DIVISION)]: { ...properties, rows: [properties.rows[0]] } });
    native.cache.getHierarchyInfo.mockReturnValue(undefined);
    const mixed = definition("HIERARCHY_DATA", DIVISION, ["hierarchyProperty", "hierarchyPropertyValue"].flatMap(targetType =>
      [MANAGER, ACTIVE].map(target => ({ targetType, target, sourceType: "undefined" }))));
    const mixedDefinitions = { ...definitions, rows: definitions.rows.map(row => ({ ...row, cells: [mixed] })) };
    const log: string[] = [];
    const result = await readImportMappings(native, tab, mixedDefinitions, importNames(native, { lists }), line => log.push(line));
    expect(result.map(mapping => mapping.targets.map(target => target.target))).toEqual([
      ["Manager from grid", `ID ${ACTIVE}`, "Manager from grid", `ID ${ACTIVE}`],
      ["Manager from grid", `ID ${ACTIVE}`, "Manager from grid", `ID ${ACTIVE}`],
    ]);
    expect(requests).toHaveLength(1);
    expect(log.filter(line => line.startsWith("Import mappings: list"))).toEqual([
      "Import mappings: list Division (101000000007): properties grid held 1 property; named 1 ID",
      "Import mappings: list Division (101000000007): unnamed targets: ID 4100000000002 (targetType hierarchyProperty), ID 4100000000002 (targetType hierarchyPropertyValue)",
    ]);
  });

  it.each([undefined, grid([], []), grid([[IMPORT_DEFINITION, "Import Definition"]], [
    [112000000011, "Load division", "{"], [112000000012, "Update division", listDefinition(DIVISION, [ACTIVE]).replace(id(DIVISION), "invalid")],
  ])])("does not read for missing or invalid definitions (%j)", async badDefinitions => {
    const { native, requests } = client();
    await readImportMappings(native, tab, badDefinitions, importNames(native, { lists }), () => undefined);
    expect(requests).toEqual([]);
  });

  it("reads the definitions of imports of a model's object as well, with the same one read of a list's properties", async () => {
    const { native, requests } = client();
    const modelTab = { ...tab, rows: tab.rows.map(row => ({ ...row, cells: ["SAVED VIEW", "Division"] })) };
    const result = await readImportMappings(native, modelTab, definitions, importNames(native, { lists }), () => undefined);
    expect(result.map(mapping => [mapping.sourceType, mapping.targets.map(target => target.target)])).toEqual([["SAVED VIEW", ["Manager", "Active & available"]],
      ["SAVED VIEW", ["Manager", "Active & available"]]]);
    expect(requests.map(request => request.params.viewDefinition.staticContextIdentifiers)).toEqual([[id(DIVISION)]]);
  });

  it("uses the existing Line Items grid when the module cache has no names, leaving constants alone", async () => {
    const { native, requests } = client();
    const lineItems: Grid = { columns: [], rows: [{ ids: [UNITS, PRICES], labels: ["Units", "Prices"], cells: [] }] };
    const moduleDefinitions = grid([[IMPORT_DEFINITION, "Import Definition"]], [[112000000011, "Load prices", definition("MODULE_DATA", PRICES, [
      { targetType: "moduleLineItem", target: id(UNITS), sourceType: "column", sourceColumnId: "#1" },
      { targetType: "moduleLineItem", target: id(PRICE), sourceType: "undefined" },
      { targetType: "moduleDimension", target: "_9000000001_", sourceType: "constant", sourceValue: "_5000000099_" },
    ])]]);
    const result = await readImportMappings(native, tab, moduleDefinitions, importNames(native, { lineItems }), () => undefined);
    expect(result[0].targets).toEqual([
      { target: "Units", source: "column", column: 1, kind: "lineItem" }, { target: `ID ${PRICE}`, source: "none", kind: "lineItem" },
      { target: "Time", source: "constant", text: "ID 5000000099", kind: "time" },
    ]);
    expect(requests).toEqual([]);
  });

  it.each(["submissions", "systemActions"])("refuses generated %s before posting", async field => {
    const { native, requests } = client();
    native.RequestGenerator = class { getRequest() { return { requestType: "VIEW_REQUEST_SET", [field]: [{}] }; } };
    const log: string[] = [];
    const result = await readImportMappings(native, tab, definitions, importNames(native, { lists }), line => log.push(line));
    expect(result[0].targets[1].target).toBe(`ID ${ACTIVE}`);
    expect(requests).toEqual([]);
    expect(log.filter(line => line.startsWith("Import mappings: list"))).toEqual([
      "Import mappings: list Division (101000000007): unnamed targets: ID 4100000000002 (targetType hierarchyProperty); properties grid not read (Refusing to send anything but a read.)",
    ]);
  });

  it("does not swallow cancellation or read a second list after the run stops", async () => {
    const { native, requests } = client();
    const stopping = new AbortController();
    const stopped = new Error("Stopped by the fixture");
    const post = native.aggregator.post;
    native.aggregator.post = (...args: any[]) => { stopping.abort(stopped); post(...args); };
    const otherDefinitions = { ...definitions, rows: [definitions.rows[0], { ...definitions.rows[1], cells: [listDefinition(PRODUCTS)] }] };
    await expect(readImportMappings(native, tab, otherDefinitions, importNames(native, { lists }), () => undefined,
      IMPORT_DEFINITION, stopping.signal)).rejects.toBe(stopped);
    expect(requests).toHaveLength(1);
  });

  it("includes grid property names in the model export's mappings", async () => {
    const { native, requests } = client({ [id(DIVISION)]: properties, importsTab: tab, importDefinitions: definitions, listProperties: lists });
    vi.stubGlobal("window", { workspaceId: native.workspaceId, modelId: native.modelId,
      require: (_modules: string[], loaded: (...args: unknown[]) => void) => loaded(native.cache, native.aggregator, native.helper,
        native.ids, native.constants, native.RequestGenerator, native.DataPage, native.axisHelper) });
    vi.stubGlobal("location", { host: "example.test", pathname: "/model" });
    const result = await exportModel({ status: () => undefined, log: () => undefined }, () => "");
    expect(result.importMappings?.map(mapping => mapping.targets.map(target => target.target))).toEqual([
      ["Manager", "Active & available"], ["Manager", "Active & available"],
    ]);
    expect(requests.filter(request => request.params.viewDefinition.rowAxis === "customProperties")).toHaveLength(1);
  });
});

describe("Mapping names from this model's entity information and calendar", () => {
  // Deliberately unrelated ID digits and type indexes: only the fixture client knows their classes.
  const [dynamic, missing, owner, item, period, unknownPeriod, module, lineItem] = [7300042, 8300053, 6500064, 7500075, 8600086, 9600097, 6700018, 7800029];
  const page = (ids: number[], labels: string[]) => ({ entityLongIds: [ids], labels: [labels] });
  const mappings = [
    { targetType: "moduleDimension", target: id(dynamic), sourceType: "column", sourceColumnName: "Market" },
    { targetType: "moduleDimension", target: "_9000000001_", sourceType: "constant", sourceValue: id(period) },
    { targetType: "moduleDimension", target: "", sourceType: "headerRow" },
    { targetType: "moduleLineItem", target: id(lineItem), sourceType: "column", sourceColumnName: "Planned units" },
  ];
  const tab = grid([[12, "Source Type"], [13, "Target Object"]], [[45, "Load outlook", "FILE", "Outlook"]]);
  const definitions = (entries = mappings) => grid([[IMPORT_DEFINITION, "Import Definition"]], [[45, "Load outlook", definition("MODULE_DATA", module, entries)]]);

  function client(type = 631) {
    const requests: any[] = [];
    const native: Native = {
      workspaceId: "a".repeat(32), modelId: "b".repeat(32), axisHelper: {},
      ids: { getEntityTypeIndex: vi.fn((id: number) => [dynamic, item, missing].includes(id) ? type : id === lineItem ? 817 : 923) },
      cache: {
        getModelName: () => "Invented outlook",
        getEntityType: vi.fn((index: number) => index === type ? { entityTypeClass: "CUSTOM", hierarchyEntityLongId: owner }
          : index === 817 ? { entityTypeClass: "LINE_ITEM" } : { entityTypeClass: "TIME" }),
        getHierarchyInfo: vi.fn((id: number) => id === owner ? { name: "Markets", itemsLabelPage: page([item], ["North &amp; West"]) } : undefined),
        getLineItemsLabelPage: vi.fn((id: number) => id === module ? page([lineItem], ["Units"]) : undefined),
      },
      constants: {
        SYSTEM_AXIS_IDENTIFIER_IMPORT_ALL_IDENTIFIER: "imports", SYSTEM_AXIS_IDENTIFIER_IMPORT_DEFINITION_PROPERTY_IDENTIFIER: "tab",
        SYSTEM_AXIS_IDENTIFIER_IMPORT_PROPERTY_IDENTIFIER: "definitions", SYSTEM_AXIS_IDENTIFIER_TIMESCALE_PROPERTY_IDENTIFIER: "calendar",
        SYSTEM_AXIS_IDENTIFIER_EMPTY_1_0_IDENTIFIER: "empty",
      },
      helper: { getAxesForViewDefinition: (rows: string[], columns: string[]) => ({ rowAxis: rows[0], columnAxis: columns[0] }) },
      RequestGenerator: class { getRequest(params: unknown) { return { requestType: "VIEW_REQUEST_SET", submissions: [], systemActions: [], params }; } },
      DataPage: class {
        constructor(private input: any) {}
        contains(row: number, column: number) { return this.input.page.rows[row]?.[column] !== undefined; }
        getIndex(row: number, column: number) { return row * this.input.page.rows[0].length + column; }
        getOriginalText(index: number) { return this.input.page.rows.flat()[index]; }
        getCellText(index: number) { return this.getOriginalText(index); }
        getCellValue(index: number) { return this.getOriginalText(index); }
        getFormat() { return this.input.page.calendar ? { dataType: "TIME_ENTITY", hierarchyEntityLongId: 5600031 } : { dataType: "TEXT" }; }
      },
      aggregator: { post(request: any, _flag: boolean, done: (response: unknown) => void) {
        requests.push(request);
        const calendar = request.params.viewDefinition.rowAxis === "calendar";
        const read = calendar ? grid([[11, "Value"]], [[14, "Current Period", String(period + 1)]])
          : request.params.viewDefinition.columnAxis === "tab" ? tab : definitions();
        done({ result: { viewRequestResults: [{ rowCount: read.rows.length, columnCount: read.columns.length,
          rowLabelPages: [page(read.rows.map(row => row.ids[0]), read.rows.map(row => row.labels[0]))],
          columnLabelPages: [page(read.columns.map(column => column.ids[0]), read.columns.map(column => column.labels[0]))],
          dataPages: [{ rows: read.rows.map(row => row.cells), calendar }],
          ...(calendar ? { indexSelectorLabelPageMap: { 5600031: 0 }, selectorLabelPages: [page([period, period + 1], ["Jan 24", "Feb 24"])] } : {}),
        }] } });
      } },
    };
    return { native, requests };
  }
  afterEach(() => vi.unstubAllGlobals());

  it.each([631, 1457])("names a list's dynamic type %i from the hierarchy, and its item by its own label and list", async type => {
    const { native, requests } = client(type);
    const names = importNames(native, {});
    const result = await readImportMappings(native, tab, definitions(), names, () => undefined);
    expect(result[0].targets[0].target).toBe("Markets");
    expect(names.entity?.(item, module, true)).toBe("North & West (Markets)");
    expect(names.entity?.(dynamic, module, true)).toBeUndefined();
    expect(native.ids.getEntityTypeIndex).toHaveBeenCalledWith(dynamic);
    expect(native.cache.getEntityType).toHaveBeenCalledWith(type);
    expect(requests).toEqual([]);
    // A different model's name is read afresh; no ID-to-name data survives a run.
    native.cache.getHierarchyInfo.mockReturnValue({ label: "Channels" });
    expect(importNames(native, {}).entity?.(dynamic, module)).toBe("Channels");
  });

  it("logs each unnamed ID once per import with the client's type and class", () => {
    const { native } = client();
    native.cache.getHierarchyInfo.mockReturnValue(undefined);
    const log: string[] = [];
    const entries = [mappings[0], { ...mappings[0], target: id(missing) }, mappings[0]];
    const result = importMappings(tab, definitions(entries), importNames(native, {}), line => log.push(line));
    expect(result[0].targets.map(target => target.target)).toEqual([`ID ${dynamic}`, `ID ${missing}`, `ID ${dynamic}`]);
    expect(log.filter(line => line.startsWith("Import mappings: Load outlook:"))).toEqual([
      "Import mappings: Load outlook: ID 7300042 is entity type 631 (class CUSTOM, list 6500064) with no name in the client; ID 8300053 is entity type 631 (class CUSTOM, list 6500064) with no name in the client",
    ]);
  });

  it("uses the same memory fallback for list-property targets and constants without reading another grid", async () => {
    const { native, requests } = client();
    const text = definition("HIERARCHY_DATA", owner, [
      { targetType: "hierarchyProperty", target: id(dynamic), sourceType: "constant", sourceValue: id(item) },
    ]);
    const result = await readImportMappings(native, tab, grid([[IMPORT_DEFINITION, "Import Definition"]], [[45, "Load outlook", text]]), importNames(native, {}), () => undefined);
    expect(result[0].targets).toEqual([{ target: "Markets", source: "constant", text: "North & West (Markets)" }]);
    expect(requests).toEqual([]);
  });

  it("uses hierarchy and module label pages and line-item ownership reported by the client", () => {
    const { native } = client();
    native.cache.getHierarchyInfo.mockReturnValue(undefined);
    native.cache.getHierarchiesLabelPage = () => page([owner], ["Districts"]);
    expect(importNames(native, {}).entity?.(dynamic, module)).toBe("Districts");
    native.cache.getEntityType = () => ({ entityTypeClass: "MODULE" });
    native.cache.getModulesLabelPage = () => page([dynamic], ["Outlook"]);
    expect(importNames(native, {}).entity?.(dynamic, module)).toBe("Outlook");
    native.cache.getModulesLabelPage = undefined;
    native.cache.getModuleInfo = () => ({ name: "Forecast" });
    expect(importNames(native, {}).entity?.(dynamic, module)).toBe("Forecast");
    native.cache.getEntityType = () => ({ entityTypeClass: "LINE_ITEM" });
    native.helper.getLineItemInfo = () => ({ moduleEntityLongId: owner });
    native.cache.getLineItemsLabelPage = (module: number) => module === owner ? page([dynamic], ["Demand"]) : undefined;
    expect(importNames(native, {}).entity?.(dynamic, module)).toBe("Demand");
    native.cache.getEntityType = () => ({ entityTypeClass: "SYSTEM" });
    native.cache.getLineItemSubsetsLabelPage = () => page([missing], ["Selected measures"]);
    expect(importNames(native, {}).entity?.(missing, module)).toBe("Selected measures");
  });

  it.each([false, true])("keeps an ID when entity methods are unavailable (throwing: %s)", throws => {
    const { native } = client();
    native.cache.getHierarchyInfo.mockReturnValue(undefined);
    native.ids.getEntityTypeIndex = throws ? () => { throw new Error("No entity information"); } : undefined;
    const names = importNames(native, {});
    const log: string[] = [];
    const result = importMappings(tab, definitions([mappings[0]]), names, line => log.push(line));
    expect(result[0].targets[0].target).toBe(`ID ${dynamic}`);
    expect(log.filter(line => line.startsWith("Import mappings: Load outlook:"))).toEqual([
      "Import mappings: Load outlook: ID 7300042 is entity type unknown (class unknown) with no name in the client",
    ]);
  });

  it("names periods from all dropdown choices, including one not selected, through the existing export reads", async () => {
    const { native, requests } = client();
    vi.stubGlobal("window", { require: (_modules: string[], ready: (...args: unknown[]) => void) => ready(native.cache, native.aggregator, native.helper,
      native.ids, native.constants, native.RequestGenerator, native.DataPage, native.axisHelper) });
    vi.stubGlobal("location", { host: "example.test", pathname: "/model" });
    const result = await exportModel({ status: () => undefined, log: () => undefined }, () => "");
    expect(result.importMappings?.[0].targets.slice(0, 3)).toEqual([
      { target: "Markets", source: "column", text: "Market", kind: "list" }, { target: "Time", source: "constant", text: "Jan 24", kind: "time" },
      { target: "Line Items", source: "headerRow", kind: "lineItems" },
    ]);
    expect(result.importMappings?.[0].headers).toEqual([{ header: "Planned units", lineItem: "Units" }]);
    expect(requests.map(request => request.params.viewDefinition.columnAxis)).toEqual(["tab", "definitions", "empty"]);
    expect(requests.map(request => request.params.cellSelectorLabelsRequired)).toEqual([false, false, true]);
    expect(requests.every(request => !request.submissions.length && !request.systemActions.length)).toBe(true);
  });

  it("names a period by the client's own label first, through the same export reads and nothing more", async () => {
    const { native, requests } = client();
    native.cache.getTimescaleSupersetInfo = vi.fn(() => ({ allowedTimeEntityPeriodTypes: [{ entityId: "WEEK" }],
      allowedTimeEntityPeriodTypeLabelPages: [page([period + 1, period], ["Week 6 FY24", "Week 2 FY24"])] }));
    vi.stubGlobal("window", { require: (_modules: string[], ready: (...args: unknown[]) => void) => ready(native.cache, native.aggregator, native.helper,
      native.ids, native.constants, native.RequestGenerator, native.DataPage, native.axisHelper) });
    vi.stubGlobal("location", { host: "example.test", pathname: "/model" });
    const result = await exportModel({ status: () => undefined, log: () => undefined }, () => "");
    // The client's label of the period comes before the calendar's choice of it ("Jan 24"), and is read from memory once.
    expect(result.importMappings?.[0].targets[1]).toEqual({ target: "Time", source: "constant", text: "Week 2 FY24", kind: "time" });
    expect(native.cache.getTimescaleSupersetInfo).toHaveBeenCalledTimes(1);
    expect(requests.map(request => request.params.viewDefinition.columnAxis)).toEqual(["tab", "definitions", "empty"]);
    expect(requests.every(request => !request.submissions.length && !request.systemActions.length)).toBe(true);
  });

  it("keeps unknown periods as IDs and says why once a run, across imports", () => {
    const { native } = client();
    const entries = [{ ...mappings[1], sourceValue: id(unknownPeriod) }];
    const log: string[] = [];
    const result = importMappings({ ...tab, rows: [...tab.rows, ...tab.rows] }, definitions(entries), importNames(native, {}, new Map([[period, "Jan 24"]])), line => log.push(line));
    expect(result.map(mapping => mapping.targets[0].text)).toEqual([`ID ${unknownPeriod}`, `ID ${unknownPeriod}`]);
    // Each import says what the client classes the ID as; the line on the periods is said once, after the first. This
    // client has no period label pages, and the calendar's one choice is another period.
    expect(log.filter(line => line.startsWith("Import mappings: Load outlook:") || line.startsWith("Import mappings: Time constant"))).toEqual([
      "Import mappings: Load outlook: ID 9600097 is entity type 923 (class TIME) with no name in the client",
      "Import mappings: Time constant ID 9600097 is not among the client's periods (getTimescaleSupersetInfo: missing; getTimescaleInfo: missing) or the Model Calendar's 1 period choice; unnamed Time constants keep their IDs.",
      "Import mappings: Load outlook: ID 9600097 is entity type 923 (class TIME) with no name in the client",
    ]);
    expect(log.some(line => line.includes("no period selector labels"))).toBe(false);
    expect(readDefinition(definition("MODULE_DATA", module, [{ ...mappings[1], sourceValue: String(period) }]), importNames(native, {}, new Map([[period, "Jan 24"]]))).mapping.targets[0].text).toBe("Jan 24");
  });

  it("keeps header mappings stored only on moduleLineItem entries, with no valueMaps and no duplicate pairs", () => {
    const { native } = client();
    const read = readDefinition(definition("MODULE_DATA", module, [...mappings, mappings[3],
      { ...mappings[3], target: id(missing), sourceColumnName: "Other count" },
      { targetType: "moduleLineItem", target: "", sourceType: "undefined" }]), importNames(native, {}));
    expect(read.mapping.headers).toEqual([{ header: "Planned units", lineItem: "Units" }, { header: "Other count", lineItem: "Markets" }]);
    expect(read.mapping.targets.some(target => target.target === "Value")).toBe(false);
  });

  const methods = ["getEntityType", "getHierarchyInfo", "getHierarchiesLabelPage", "getHierarchySubsetsLabelPage", "getHierarchyLabelPage",
    "getLineItemsLabelPage", "getModulesLabelPage", "getModuleInfo", "getLineItemSubsetsLabelPage", "getEntityTypeIndex", "getLineItemInfo",
    "getTimescaleSupersetInfo", "getTimescaleInfo"];
  it.each(methods.flatMap(method => ["missing", "throws"].map(failure => ({ method, failure }))))("guards $method when it $failure", ({ method, failure }) => {
    const { native } = client();
    const holder = method === "getEntityTypeIndex" ? native.ids : method === "getLineItemInfo" ? native.helper : native.cache;
    holder[method] = failure === "missing" ? undefined : () => { throw new Error("Fixture metadata unavailable"); };
    for (const kind of ["CUSTOM", "LINE_ITEM", "MODULE", "HIERARCHY", "SYSTEM"]) {
      if (method !== "getEntityType") native.cache.getEntityType = () => ({ entityTypeClass: kind, hierarchyEntityLongId: owner });
      const names = importNames(native, {});
      expect(() => [names.entity?.(dynamic, module), names.entity?.(missing, module, true), names.describe?.(missing),
        names.list(missing), names.lineItem(missing, module), names.property(missing, owner), names.period?.(period), names.periodsLine?.(period)]).not.toThrow();
    }
  });

  it.each(["getFormat", "getCellValue"])("guards calendar %s when missing or throwing and preserves readable cells", async method => {
    for (const replacement of [undefined, () => { throw new Error("Fixture selector unavailable"); }]) {
      const { native } = client();
      native.DataPage.prototype[method] = replacement;
      const periods = new Map<number, string>();
      const result = await readGrid(native, "calendar", "empty", "Model Calendar", () => undefined, undefined, true, undefined, [], periods);
      expect(result.rows[0].cells).toEqual([String(period + 1)]);
      expect(periods.size).toBe(method === "getFormat" ? 0 : 2);
    }
  });
});

describe("Periods named by the client's own labels, and line items the model doesn't have", () => {
  // Every ID is made up, with digits that say nothing of what it is: only the fixture client knows. Periods of two types,
  // months and quarters, each with a label page of its own.
  const [jan, feb, mar, q1, q2, apr, unknown] = [8600086, 7200311, 5300427, 4410052, 6930118, 3700295, 9600097];
  const [plan, units, shelf, gone, goneToo, odd] = [6710042, 7810031, 2860013, 6180093, 3130054, 5550061];
  const page = (ids: unknown[], labels: unknown[]) => ({ entityLongIds: [ids], labels: [labels] });
  const PERIOD_TYPES = [{ entityId: "MONTH", entityLabel: "Month" }, { entityId: "QUARTER", entityLabel: "Quarter" }];
  /** The time scale's superset holds January, February and the first quarter. The time scale itself holds January by a
   * label of its own, March and the second quarter. The Model Calendar's choices hold April alone. */
  const SUPERSET = { allowedTimeEntityPeriodTypes: PERIOD_TYPES, allowedTimeEntityPeriodTypeLabelPages: [page([jan, feb], ["Jan 26", "Feb 26"]), page([q1], ["Q1 FY26"])] };
  const TIMESCALE = { calendarTypeEntityIndex: 3, allowedTimeEntityPeriodTypes: PERIOD_TYPES,
    allowedTimeEntityPeriodTypeLabelPages: [page([jan, mar], ["January 2026", "Mar 26"]), page([q2], ["Q2 FY26"])] };
  const CALENDAR = new Map([[apr, "Apr 26"]]);
  const tab = grid([[12, "Source Type"], [13, "Target Object"]], [[45, "Load plan", "FILE", "Plan"], [46, "Load plan again", "FILE", "Plan"]]);
  /** The grid of definitions: one for each import of the tab, in its order, each of these mappings, into the plan. */
  const definitions = (...each: [mappings: unknown[], more?: Record<string, unknown>][]) => grid([[IMPORT_DEFINITION, "Import Definition"]],
    each.map(([mappings, more], at): [number, string, string] => [45 + at, tab.rows[at].labels[0] ?? "", definition("MODULE_DATA", plan, mappings, more)]));
  const timeConstant = (period: number) => ({ targetType: "moduleDimension", target: "_9000000001_", sourceType: "constant", sourceValue: id(period) });

  /** The classes of the fixture client's entity types, by their made-up indexes. */
  const CLASSES = new Map([[817, "LINE_ITEM"], [455, "SYSTEM"], [923, "TIME"]]);
  /** A model page's client that classes the line items as LINE_ITEM, one more ID as SYSTEM and the periods as TIME, and
   * names one line item of the plan on its own page. */
  function client(): Native {
    return {
      workspaceId: "a".repeat(32), modelId: "b".repeat(32),
      ids: { getEntityTypeIndex: vi.fn((entity: number) => ([units, shelf, gone, goneToo].includes(entity) ? 817 : entity === odd ? 455 : 923)) },
      cache: {
        getEntityType: vi.fn((index: number) => (CLASSES.has(index) ? { entityTypeClass: CLASSES.get(index) } : null)),
        getLineItemsLabelPage: vi.fn((module: number) => (module === plan ? page([units], ["Units"]) : undefined)),
        getTimescaleSupersetInfo: vi.fn(() => SUPERSET),
        getTimescaleInfo: vi.fn(() => TIMESCALE),
      },
      helper: { getLineItemInfo: vi.fn(() => null) },
    } as unknown as Native;
  }
  const getters = (native: Native): number[] => [native.cache.getTimescaleSupersetInfo, native.cache.getTimescaleInfo].map(getter => getter.mock.calls.length);

  it("names a constant into Time by the superset's period labels, then the time scale's, then the Model Calendar's choices", () => {
    const native = client();
    const names = importNames(native, {}, CALENDAR);
    // Nothing is asked of the client until a constant into Time needs a name.
    expect(getters(native)).toEqual([0, 0]);
    const said = [jan, feb, q1, mar, q2, apr, unknown].map(period => readDefinition(definition("MODULE_DATA", plan, [timeConstant(period)]), names).mapping.targets[0]);
    // January is in both infos: the superset's label is kept. March and the second quarter are in the time scale's alone,
    // April among the calendar's choices alone; the last is in none, and keeps its ID.
    expect(said.map(target => target.text)).toEqual(["Jan 26", "Feb 26", "Q1 FY26", "Mar 26", "Q2 FY26", "Apr 26", `ID ${unknown}`]);
    expect(said.every(target => target.target === "Time" && target.source === "constant")).toBe(true);
    // Each getter was asked once, for all of them.
    expect(getters(native)).toEqual([1, 1]);
  });

  it("keeps a constant into Time that nothing names as its ID, and says once a run what the client and the calendar held", () => {
    const native = client();
    const log: string[] = [];
    const result = importMappings(tab, definitions([[timeConstant(unknown)]], [[timeConstant(unknown)]]), importNames(native, {}, CALENDAR), line => log.push(line));
    expect(result.map(mapping => mapping.targets)).toEqual([1, 2].map(() => [{ target: "Time", source: "constant", text: `ID ${unknown}`, kind: "time" }]));
    expect(log.filter(line => /^Import mappings: (Load plan|Time constant)/.test(line))).toEqual([
      "Import mappings: Load plan: ID 9600097 is entity type 923 (class TIME) with no name in the client",
      "Import mappings: Time constant ID 9600097 is not among the client's periods (getTimescaleSupersetInfo: 2 label pages, 3 periods; getTimescaleInfo: 2 label pages, 3 periods) "
        + "or the Model Calendar's 1 period choice; unnamed Time constants keep their IDs.",
      "Import mappings: Load plan again: ID 9600097 is entity type 923 (class TIME) with no name in the client",
    ]);
    expect(getters(native)).toEqual([1, 1]);
    // A run with no constant into Time asks neither getter, and says nothing of periods.
    const other = client();
    log.length = 0;
    importMappings(tab, definitions([[{ targetType: "moduleLineItem", target: id(units), sourceType: "column", sourceColumnId: "#1" }]]), importNames(other, {}, CALENDAR),
      line => log.push(line));
    expect([getters(other), log.filter(line => line.includes("Time constant"))]).toEqual([[0, 0], []]);
  });

  it.each(["missing", "throws"])("names no period by the client's labels when both getters are %s, and says so", failure => {
    const native = client();
    for (const getter of ["getTimescaleSupersetInfo", "getTimescaleInfo"]) {
      native.cache[getter] = failure === "missing" ? undefined : vi.fn(() => { throw new Error("The model is not loaded."); });
    }
    const names = importNames(native, {}, CALENDAR);
    expect(() => [names.period?.(jan), names.period?.(mar)]).not.toThrow();
    // The calendar's choices still name their periods.
    expect([names.period?.(jan), names.period?.(apr)]).toEqual([undefined, "Apr 26"]);
    const log: string[] = [];
    const result = importMappings(tab, definitions([[timeConstant(jan)]]), names, line => log.push(line));
    expect(result[0].targets).toEqual([{ target: "Time", source: "constant", text: `ID ${jan}`, kind: "time" }]);
    const said = failure === "missing" ? "missing" : "threw";
    expect(log.filter(line => line.includes("Time constant"))).toEqual([`Import mappings: Time constant ID 8600086 is not among the client's periods (getTimescaleSupersetInfo: ${said}; `
      + `getTimescaleInfo: ${said}) or the Model Calendar's 1 period choice; unnamed Time constants keep their IDs.`]);
    // A getter that threw is not asked again in the run.
    if (failure === "throws") expect(getters(native)).toEqual([1, 1]);
  });

  it("takes only label pages of the client's own make: lists of IDs and of labels, IDs that are whole numbers above 0, labels that are text", () => {
    const native = client();
    native.cache.getTimescaleSupersetInfo = () => ({ allowedTimeEntityPeriodTypeLabelPages: [null, "page", { entityLongIds: [feb], labels: ["Flat"] },
      { entityLongIds: [[String(feb), 2 ** 53, -4, 0, 1.5, mar]], labels: [["Text ID", "Too long", "Below 0", "Zero", "Fraction", 42]] },
      page([q1, q2], ["  ", "Q2 &amp; spring"])] });
    native.cache.getTimescaleInfo = () => ({ allowedTimeEntityPeriodTypeLabelPages: "pages" });
    const names = importNames(native, {});
    expect([feb, mar, q1, q2].map(period => names.period?.(period))).toEqual([undefined, undefined, undefined, "Q2 & spring"]);
    // The pages counted are the two made of lists; the periods, the one with a whole-number ID and a label.
    expect(names.periodsLine?.(feb)).toBe("Time constant ID 7200311 is not among the client's periods (getTimescaleSupersetInfo: 2 label pages, 1 period; "
      + "getTimescaleInfo: 0 label pages, 0 periods) or the Model Calendar's 0 period choices; unnamed Time constants keep their IDs.");
  });

  it("says a line item the client classes as one that nothing names as missing, in a header pair and in a column target, and the Mapping says what that means", () => {
    const native = client();
    // The Line Items grid names one line item; the client's page of the plan's line items names another.
    const lineItems: Grid = { columns: [], rows: [{ ids: [shelf, plan], labels: ["Shelf units", "Plan"], cells: [] }] };
    const lists = grid([], [[PRODUCTS, "Products"]]);
    const mappings = [
      { targetType: "moduleDimension", target: id(PRODUCTS), sourceType: "column", sourceColumnId: "#1", sourceColumnName: "Product" },
      timeConstant(mar),
      { targetType: "moduleDimension", target: "", sourceType: "headerRow" },
      { targetType: "moduleLineItem", target: id(units), sourceType: "column", sourceColumnId: "#2" },
      { targetType: "moduleLineItem", target: id(goneToo), sourceType: "column", sourceColumnId: "#3" },
      { targetType: "moduleLineItem", target: id(odd), sourceType: "column", sourceColumnId: "#4" }];
    const valueMaps = [{ targetType: "moduleDimension", target: "", values: { "Unit count": units, Shelf: shelf, "Display share": gone, Comment: -1 } }];
    const log: string[] = [];
    const [mapping] = importMappings(tab, definitions([mappings, { valueMaps }]), importNames(native, { lists, lineItems }, CALENDAR), line => log.push(line));
    expect(mapping).toEqual({ id: "45", name: "Load plan", sourceType: "FILE", importType: "MODULE_DATA", clear: "clear", targets: [
      { target: "Products", source: "column", column: 1, text: "Product", items: { byHand: 0, ignored: 0 }, kind: "list" },
      { target: "Time", source: "constant", text: "Mar 26", kind: "time" },
      { target: "Line Items", source: "headerRow", items: { byHand: 3, ignored: 1 }, kind: "lineItems" },
      // Named line items stay named; one the client classes as a line item, that nothing names, is missing; an ID of another
      // class that nothing names stays an ID.
      { target: "Units", source: "column", column: 2, kind: "lineItem" },
      { target: "Missing line item (ID 3130054)", source: "column", column: 3, kind: "lineItem" },
      { target: "ID 5550061", source: "column", column: 4, kind: "lineItem" }],
    headers: [{ header: "Unit count", lineItem: "Units" }, { header: "Shelf", lineItem: "Shelf units" }, { header: "Display share", lineItem: "Missing line item (ID 6180093)" },
      { header: "Comment" }] });
    // The log says what the client classes each unnamed ID as, the missing line items among them.
    expect(log.filter(line => line.startsWith("Import mappings: Load plan:"))).toEqual([
      "Import mappings: Load plan: ID 3130054 is entity type 817 (class LINE_ITEM) with no name in the client; ID 5550061 is entity type 455 (class SYSTEM) with no name in the client; "
        + "ID 6180093 is entity type 817 (class LINE_ITEM) with no name in the client"]);
    // The Mapping shows both, among the line items: each line item's own column, then each header mapped manually. Its last
    // line says what a missing line item is. Time comes first, as the dialog lists it.
    expect(mappingView(mapping)).toEqual({ clear: "Clear target prior to import", rows: [],
      dimensions: [["Time", "Fixed: Mar 26", "", ""], ["Products", "Column 1: Product", "Matched on names or codes", ""], ["Line Items", "Header row", "Mapped manually", ""]],
      lineItems: { count: 7, heading: "Source", notes: [], rows: [["Column 2", "Units"], ["Column 3", "Missing line item (ID 3130054)"], ["Column 4", "ID 5550061"],
        ["Unit count", "Units"], ["Shelf", "Shelf units"], ["Display share", "Missing line item (ID 6180093)"], ["Comment", "Ignored"]] },
      lines: ["Items set to match on names or codes are paired when the import runs, so Anaplan saves no pairs for them.", "Columns 1 to 4 are all used.", MISSING_LINE_ITEM_NOTE] });
  });

  it("says the line items fed by a constant as missing too, and keeps an unnamed ID of another class as an ID, with no line on missing line items", () => {
    const lineItems: Grid = { columns: [], rows: [{ ids: [shelf, plan], labels: ["Shelf units", "Plan"], cells: [] }] };
    const names = importNames(client(), { lineItems });
    // The line items fed by a constant: one line item, which the model doesn't have.
    const constant = readDefinition(definition("MODULE_DATA", plan, [{ targetType: "moduleDimension", target: "", sourceType: "constant", sourceValue: id(gone) }]), names);
    expect(constant.mapping.targets).toEqual([{ target: "Line Items", source: "constant", text: "Missing line item (ID 6180093)", kind: "lineItems" }]);
    expect(mappingView({ id: "45", name: "Load plan", ...constant.mapping }).lines).toEqual(["No column is mapped.", MISSING_LINE_ITEM_NOTE]);
    const other = readDefinition(definition("MODULE_DATA", plan, [{ targetType: "moduleLineItem", target: id(odd), sourceType: "column", sourceColumnId: "#1" }]), names);
    expect(other.mapping.targets).toEqual([{ target: "ID 5550061", source: "column", column: 1, kind: "lineItem" }]);
    expect(mappingView({ id: "45", name: "Load plan", ...other.mapping }).lines).toEqual(["Column 1 is used."]);
  });

  it("keeps a line item's ID where no Line Items grid was read: nothing then proves the model lacks it", () => {
    const names = importNames(client(), {});
    const read = readDefinition(definition("MODULE_DATA", plan, [{ targetType: "moduleLineItem", target: id(gone), sourceType: "column", sourceColumnId: "#1" }]), names);
    expect(read.mapping.targets).toEqual([{ target: "ID 6180093", source: "column", column: 1, kind: "lineItem" }]);
    expect(mappingView({ id: "45", name: "Load plan", ...read.mapping }).lines).toEqual(["Column 1 is used."]);
  });
});
