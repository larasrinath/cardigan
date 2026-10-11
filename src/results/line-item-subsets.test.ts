import { describe, expect, it } from "vitest";
import type { AnalysisResult, ResultTable } from "../result-types.js";
import { cellLists, rowItems } from "./cell-lists.js";
import { columnsOf } from "./columns.js";
import { columnWidths, textWidth } from "./column-widths.js";
import { itemRows, type NamedRows } from "./item-links.js";
import { cellHtml, navItems, rowDrawerHtml, subsetMembershipHtml } from "./markup.js";
import { LINE_ITEM_NAMES, subsetOfRow } from "./line-item-subsets-view.js";
import { selectRows } from "./table-engine.js";
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
    const view = fileView(result, subsets).table;
    const columns = columnsOf(view, cellLists(result, view));
    expect(columns.map(column => column.label)).toEqual(["Name", "Modules", "Line Items", "Notes", "Line Item Names", "Subset ID", "New property"]);
    expect(columns.filter(column => !column.hidden).map(column => column.label)).toEqual(["Name", "Modules", "Line Items", "Notes", "New property"]);
    expect(columns.filter(column => column.filter).map(column => column.label)).toEqual(["Modules", "Line Items", "Line Item Names", "New property"]);
    const count = columns.find(column => column.label === "Line Items")!;
    expect(count).toMatchObject({ kind: "count", num: true, range: "number" });
    expect(cellHtml(count, view.rows[0], { page: false, card: false })).toContain("2 line items");
    expect(cellHtml(count, view.rows[1], { page: false, card: false })).toContain("1 line item");
    expect(view.rows.map(row => row[3])).toEqual([2, 1]);
    expect(columnWidths([count], [["", "", "", 123456]]).get(3)).toBeGreaterThan(textWidth("123,456 line items"));
    expect(subsets.rows[0][3]).toBe("'Demand'.'Units', 'Plan, next'.'Owner''s share'");
    expect(selectRows(view.rows, { search: "Owner's share", filters: new Map() })).toEqual([view.rows[0]]);
    expect(selectRows(view.rows, { search: "Units", filters: new Map() })).toEqual(view.rows);
    expect(selectRows(view.rows, { search: "share", filters: new Map() })).toEqual([view.rows[0]]);
    expect(selectRows(view.rows, { search: "", filters: new Map(), ranges: new Map([[3, { kind: "number", from: 2, to: 12, blanks: false, none: false }]]) }))
      .toEqual([view.rows[0]]);
    expect(fileView(result, table("Line Item Subsets", ["", "Notes"], [["Empty", ""]])).note).toContain("membership was not read");
  });

  it("splits member names safely and links modules, line items and Applies To in both directions", () => {
    const named = new Map<string, NamedRows>(result.tables.map(table => [table.file, { table, name: 0, ...(table === items ? { module: 1 } : {}) }]));
    const shown = fileView(result, subsets);
    const view = shown.table;
    const split = cellLists(result, view);
    expect(split.get(2)?.(String(view.rows[0][2]), view.rows[0])).toEqual(["Demand", "Plan, next"]);
    const members = subsetOfRow(result, view, view.rows[0], shown.exported?.get(view.rows[0]))!.members;
    expect(members).toEqual(["'Demand'.'Units'", "'Plan, next'.'Owner''s share'"]);
    expect(itemRows(view, LINE_ITEM_NAMES, members!, view.rows[0], named)).toEqual(items.rows.map(row => ({ file: items.file, row })));
    expect(itemRows(subsets, "Modules", ["Plan, next"], subsets.rows[0], named)).toEqual([{ file: modules.file, row: modules.rows[1] }]);
    for (const source of [modules, items]) {
      expect(itemRows(source, "Applies To", ["Planning measures", "Gone"], source.rows[0], named)).toEqual([{ file: subsets.file, row: subsets.rows[0] }, undefined]);
    }
    const ambiguous = table("General Lists", [""], [["Planning measures"]]);
    named.set(ambiguous.file, { table: ambiguous, name: 0 });
    expect(itemRows(modules, "Applies To", ["Planning measures"], modules.rows[0], named)).toEqual([undefined]);
  });

  it("shows resolved module names and hides raw IDs, including an unresolved ID", () => {
    const file = table("Line Item Subsets", ["", "Modules", "Line Items"], [["Measures", "102000000002,102000000099,102000000001", ""]]);
    const data: AnalysisResult = { ...result, moduleIds: [["Demand", "102000000001"], ["Plan, next", "102000000002"]] };
    const view = fileView(data, file).table;
    expect(view.rows[0]).toEqual(["Measures", "Demand, Plan, next, 102000000099", 0, "102000000002,102000000099,102000000001", ""]);
    expect(columnsOf(view).find(column => column.label === "Module IDs")?.hidden).toBe(true);
    expect(rowItems(cellLists(data, view), view.rows[0]).get(1)).toEqual(["Demand", "Plan, next", "102000000099"]);
    expect(cellHtml(columnsOf(view).find(column => column.label === "Line Items")!, view.rows[0], { page: false, card: false })).toContain("0 line items");
  });

  it("groups details in module and line item order with module headings and member links", () => {
    const file = table("Line Item Subsets", ["", "Modules", "Line Items"], [["Measures", "Demand, Plan, next", "'Plan, next'.'Owner''s share', 'Demand'.'Cost', 'Demand'.'Units'"]]);
    const lines = { ...items, rows: [...items.rows, ["Cost", "Demand", ""]] };
    const data = { ...result, tables: [modules, lines, file] };
    const shown = fileView(data, file);
    const view = shown.table;
    const grouped = subsetOfRow(data, view, view.rows[0], shown.exported?.get(view.rows[0]))!;
    expect(grouped.groups).toEqual([
      { module: "Demand", items: [{ name: "Units", index: 2 }, { name: "Cost", index: 1 }] },
      { module: "Plan, next", items: [{ name: "Owner's share", index: 0 }] },
    ]);
    const html = subsetMembershipHtml(grouped, [3, 4], [0, 1, 2]);
    expect(html).toContain("Line items · 3");
    expect(html).toContain('<h4><button type="button" class="link" data-act="item" data-item="3">Demand</button></h4>');
    expect(html).toContain('data-item="4">Plan, next</button>');
    expect(html).toContain('data-item="2">Units</button>');
    expect(html).toContain('data-item="1">Cost</button>');
    expect(html).toContain('data-item="0">Owner&#39;s share</button>');
    expect(html.indexOf("Units")).toBeLessThan(html.indexOf("Cost"));
    expect(html.indexOf("Cost")).toBeLessThan(html.indexOf("Plan, next"));
    const drawer = rowDrawerHtml(columnsOf(view), view.rows[0], { page: false, card: false }, undefined, undefined, undefined,
      undefined, undefined, undefined, undefined, undefined, { view: grouped, modules: [3, 4], members: [0, 1, 2] });
    expect(drawer).toContain(html);
    expect(drawer).not.toContain("<dt>Line Item Names</dt>");
    expect(drawer).not.toContain("<dt>Line Items</dt>");
  });

  it("says only the missing subset's members were not read, distinguishing a known empty subset", () => {
    const file = table("Line Item Subsets", ["", "Line Items", "Membership read"], [["Read", "'Demand'.'Units'", "true"], ["Missing", "", "false"], ["Empty", "", "true"]]);
    const view = fileView(result, file);
    expect(view.note).toBeUndefined();
    expect(view.table.rows.map(row => row[1])).toEqual([1, "", 0]);
    const details = view.table.rows.map(row => subsetMembershipHtml(subsetOfRow(result, view.table, row, view.exported?.get(row))!, [], []));
    expect(details[0]).toContain("Line items · 1");
    expect(details[1]).toContain("This subset&#39;s line items were not read.");
    expect(details[1]).not.toContain("Line items · 0");
    expect(details[2]).toContain("Line items · 0");
    expect(details[0] + details[2]).not.toContain("not read");
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
    const view = fileView(result, subsets).table;
    const columns = columnsOf(view, cellLists(result, view));
    const hidden = new Set([1, ...columns.filter(column => column.hidden).map(column => column.index)]);
    const ranges = new Map([[3, { fromText: "2", toText: "", from: 2, blanks: false }]]);
    const kept = keepTable({ columns, hidden, search: "share", filters: new Map([[2, new Set(["Demand"])]]), ranges, sort: { column: 0, dir: "desc" }, page: 0 }, () => ["Demand", "Plan, next"]);
    const restored = takeTable(kept!, columnsOf(fileView(result, subsets).table), () => ["Demand", "Plan, next"]);
    expect(restored.hidden).toEqual(hidden);
    expect(restored.search).toBe("share");
    expect(restored.ranges).toEqual(ranges);
    expect(restored.filters).toEqual(new Map([[2, new Set(["Demand"])]]));
    expect(restored.sort).toEqual({ column: 0, dir: "desc" });
  });
});
