import { describe, expect, it } from "vitest";
import type { Cell, ImportMapping, ResultTable } from "../result-types.js";
import { importLoads } from "./import-loads.js";

// Made-up names only: nothing here comes from a real model. The Imports table has the Imports tab's own columns, the
// unnamed first column with each import's name among them.
const IMPORT_HEADERS = ["", "Source Label", "Source Object", "Source Type", "Target Object", "Target Type"];
type Cells = Record<string, Cell>;
const imports = (...rows: Cells[]): ResultTable =>
  ({ file: "Imports.csv", label: "Imports", headers: [...IMPORT_HEADERS], rows: rows.map(cells => IMPORT_HEADERS.map(header => cells[header] ?? "")), guard: false });
const row = (name: string, target: string, type = "MODULE", source = "FILE"): Cells => ({ "": name, "Source Type": source, "Target Object": target, "Target Type": type });
const MODULES = new Set(["VOL01 Volumes", "PRC01 Prices"]);
const isModule = (name: string): boolean => MODULES.has(name);

describe("What each import loads into a module's line items", () => {
  it("names the line items a mapping loads: its line item targets, a constant into Line Items and each header mapped manually", () => {
    const mappings: ImportMapping[] = [
      { id: "112000000001", name: "Load volumes", sourceType: "FILE", importType: "MODULE_DATA", targets: [
        { target: "Products", source: "column", column: 1 }, { target: "Planned Units", source: "column", column: 2 }, { target: "Ignored Units", source: "ignore" },
        { target: "Not Mapped", source: "none" }, { target: "Value", source: "column", column: 3 }] },
      { id: "112000000002", name: "Set the price", sourceType: "FILE", importType: "MODULE_DATA", targets: [{ target: "Line Items", source: "constant", text: "List Price" }] },
      { id: "112000000003", name: "Load headers", sourceType: "FILE", importType: "MODULE_DATA", targets: [{ target: "Line Items", source: "headerRow" }],
        headers: [{ header: "Units", lineItem: "Planned Units" }, { header: "Note" }] },
    ];
    expect(importLoads(imports(row("Load volumes", "VOL01 Volumes"), row("Set the price", "'PRC01 Prices'"), row(" Load headers ", " VOL01 Volumes ")), mappings, isModule)).toEqual([
      // A list's name is among the names: a reader finds no line item of it.
      { name: "Load volumes", module: "VOL01 Volumes", lineItems: ["Products", "Planned Units"], any: false, unread: false },
      { name: "Set the price", module: "PRC01 Prices", lineItems: ["List Price"], any: false, unread: false },
      { name: "Load headers", module: "VOL01 Volumes", lineItems: ["Planned Units"], any: false, unread: false },
    ]);
  });

  it("loads any line item where the line items come from a column or a header row matched by name, or the mapping is not known", () => {
    const mappings: ImportMapping[] = [
      { id: "112000000001", name: "By column", sourceType: "FILE", importType: "MODULE_DATA", targets: [{ target: "Line Items", source: "column", column: 4 }] },
      { id: "112000000002", name: "By heading", sourceType: "FILE", importType: "MODULE_DATA", targets: [{ target: "Line Items", source: "headerRow" }] },
      { id: "112000000003", name: "Not read", sourceType: "FILE", importType: "", targets: [], note: "The definition could not be read." },
    ];
    expect(importLoads(imports(row("By column", "VOL01 Volumes"), row("By heading", "VOL01 Volumes"), row("Not read", "PRC01 Prices"), row("Missing", "PRC01 Prices")), mappings, isModule)
      .map(({ name, any, unread }) => [name, any, unread])).toEqual([["By column", true, false], ["By heading", true, false], ["Not read", true, true], ["Missing", true, true]]);
  });

  it("finds a mapping by its name and Source Type, in its place among imports of both alike", () => {
    const mappings: ImportMapping[] = [
      { id: "112000000001", name: "Copy", sourceType: "MODULE", importType: "MODULE_DATA", targets: [{ target: "Planned Units", source: "column" }] },
      { id: "112000000002", name: "Copy", sourceType: "FILE", importType: "MODULE_DATA", targets: [{ target: "List Price", source: "column" }] },
      { id: "112000000003", name: "Copy", sourceType: "FILE", importType: "MODULE_DATA", targets: [{ target: "Discount", source: "column" }] },
    ];
    const table = imports(row("Copy", "PRC01 Prices", "MODULE", "FILE"), row("Copy", "VOL01 Volumes", "MODULE", "MODULE"), row("Copy", "PRC01 Prices", "MODULE", "FILE"));
    expect(importLoads(table, mappings, isModule).map(load => load.lineItems)).toEqual([["List Price"], ["Planned Units"], ["Discount"]]);
  });

  it("loads no line item into a list, nor by an import of anything but module data, and takes a target of no type for a module only where one has its name", () => {
    const mappings: ImportMapping[] = [
      { id: "112000000001", name: "Into a list", sourceType: "FILE", importType: "HIERARCHY_DATA", targets: [] },
      { id: "112000000002", name: "Users", sourceType: "FILE", importType: "USERS", targets: [] },
      { id: "112000000003", name: "Untyped", sourceType: "FILE", importType: "MODULE_DATA", targets: [{ target: "Planned Units", source: "column" }] },
      { id: "112000000004", name: "Unknown", sourceType: "FILE", importType: "MODULE_DATA", targets: [{ target: "Planned Units", source: "column" }] },
    ];
    expect(importLoads(imports(row("Into a list", "Products", "LIST"), row("Users", "VOL01 Volumes"), row("Untyped", "VOL01 Volumes", ""), row("Unknown", "Nowhere", "")), mappings, isModule))
      .toEqual([{ name: "Untyped", module: "VOL01 Volumes", lineItems: ["Planned Units"], any: false, unread: false }]);
  });

  it("counts no mapping as unread for an import from a model in a result an earlier version kept, and nothing without the table", () => {
    const earlier: ImportMapping[] = [{ id: "112000000001", name: "From a file", importType: "MODULE_DATA", targets: [{ target: "List Price", source: "column" }] }];
    expect(importLoads(imports(row("From a file", "PRC01 Prices"), row("From a module", "VOL01 Volumes", "MODULE", "MODULE")), earlier, isModule)
      .map(({ name, lineItems, any, unread }) => [name, lineItems, any, unread])).toEqual([["From a file", ["List Price"], false, false], ["From a module", [], true, false]]);
    expect(importLoads(undefined, earlier, isModule)).toEqual([]);
    expect(importLoads(imports(row("No mappings", "PRC01 Prices")), undefined, isModule)).toEqual([{ name: "No mappings", module: "PRC01 Prices", lineItems: [], any: true, unread: true }]);
  });
});
