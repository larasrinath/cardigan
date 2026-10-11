import { describe, expect, it } from "vitest";
import type { AnalysisResult, ResultTable } from "../result-types.js";
import { cellLists } from "./cell-lists.js";
import { columnsOf } from "./columns.js";
import { itemRows, type NamedRows } from "./item-links.js";
import { navItems } from "./markup.js";
import { fileView, listedTables, overviewOf } from "./result-view.js";
import { keepTable, takeTable } from "./view-keep.js";

const table = (label: string, headers: string[], rows: string[][]): ResultTable => ({ file: `${label}.csv`, label, headers, rows, guard: false });
const subsets = table("Line Item Subsets", ["", "Notes", "Modules", "Line Items", "Subset ID", "New property"], [
  ["Planning measures", "For planning", "Demand, Plan, next", "'Demand'.'Units', 'Plan, next'.'Owner''s share'", "114000000001", "One"],
  ["Review measures", "For review", "Demand", "'Demand'.'Units'", "114000000002", "Two"],
]);
const modules = table("Modules", ["", "Applies To"], [["Demand", "Planning measures"], ["Plan, next", "Review measures"]]);
const items = table("Line Items", ["", "Module Name", "Applies To"], [["Units", "Demand", "Planning measures"], ["Owner's share", "Plan, next", "Review measures"]]);
const lists = table("General Lists", [""], [["Products"]]);
const result: AnalysisResult = { kind: "model", name: "Invented plan", id: "invented", zipName: "unused", summary: [], tables: [modules, items, lists, subsets] };

describe("Line Item Subsets in results", () => {
  it("orders columns, hides IDs, keeps Anaplan's headings and gives membership columns filters", () => {
    const columns = columnsOf(subsets, cellLists(result, subsets));
    expect(columns.map(column => column.label)).toEqual(["Name", "Modules", "Line Items", "Notes", "Subset ID", "New property"]);
    expect(columns.filter(column => !column.hidden).map(column => column.label)).toEqual(["Name", "Modules", "Line Items", "Notes", "New property"]);
    expect(columns.filter(column => column.filter).map(column => column.label)).toEqual(["Modules", "Line Items", "New property"]);
    expect(fileView(result, subsets).table).toBe(subsets);
    expect(fileView(result, table("Line Item Subsets", ["", "Notes"], [["Empty", ""]])).note).toContain("membership was not read");
  });

  it("splits member names safely and links modules, line items and Applies To in both directions", () => {
    const named = new Map<string, NamedRows>(result.tables.map(table => [table.file, { table, name: 0, ...(table === items ? { module: 1 } : {}) }]));
    const split = cellLists(result, subsets);
    expect(split.get(2)?.(String(subsets.rows[0][2]), subsets.rows[0])).toEqual(["Demand", "Plan, next"]);
    const members = split.get(3)?.(String(subsets.rows[0][3]), subsets.rows[0]);
    expect(members).toEqual(["'Demand'.'Units'", "'Plan, next'.'Owner''s share'"]);
    expect(itemRows(subsets, "Line Items", members!, subsets.rows[0], named)).toEqual(items.rows.map(row => ({ file: items.file, row })));
    expect(itemRows(subsets, "Modules", ["Plan, next"], subsets.rows[0], named)).toEqual([{ file: modules.file, row: modules.rows[1] }]);
    for (const source of [modules, items]) {
      expect(itemRows(source, "Applies To", ["Planning measures", "Gone"], source.rows[0], named)).toEqual([{ file: subsets.file, row: subsets.rows[0] }, undefined]);
    }
    const ambiguous = table("General Lists", [""], [["Planning measures"]]);
    named.set(ambiguous.file, { table: ambiguous, name: 0 });
    expect(itemRows(modules, "Applies To", ["Planning measures"], modules.rows[0], named)).toEqual([undefined]);
  });

  it("places subsets under Lists, counts its tile and keeps only General Lists when subsets are empty or absent", () => {
    expect(listedTables(result).map(({ table }) => table.label)).toEqual(["General Lists", "Line Item Subsets", "Modules", "Line Items"]);
    expect(overviewOf(result).tiles.find(tile => tile.label === "Line Item Subsets")).toMatchObject({ count: 2 });
    for (const tables of [[lists, { ...subsets, rows: [] }], [lists]]) {
      const empty = { ...result, tables };
      expect(overviewOf(empty).tiles.map(tile => tile.label)).toEqual(["General Lists"]);
      const entries = listedTables(empty).map(({ table, index }) => ({ id: String(index), label: table.label, file: table.file }));
      expect(navItems(entries, true)).toMatchObject([{ group: { label: "Lists" }, entries: [{ label: "General Lists" }] }]);
    }
  });

  it("keeps filters, columns and sorting by name across a refresh", () => {
    const columns = columnsOf(subsets, cellLists(result, subsets));
    const kept = keepTable({ columns, hidden: new Set([1]), filters: new Map([[2, new Set(["Demand"])]]), ranges: new Map(), sort: { column: 0, dir: "desc" }, page: 0 }, () => ["Demand", "Plan, next"]);
    const restored = takeTable(kept!, columnsOf(subsets), () => ["Demand", "Plan, next"]);
    expect(restored.hidden).toEqual(new Set([1]));
    expect(restored.filters).toEqual(new Map([[2, new Set(["Demand"])]]));
    expect(restored.sort).toEqual({ column: 0, dir: "desc" });
  });
});
