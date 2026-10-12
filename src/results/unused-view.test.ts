import { describe, expect, it } from "vitest";
import { plainResult } from "../result-plain.js";
import type { AnalysisResult, Cell, ResultTable } from "../result-types.js";
import { UNUSED_CAVEAT, UNUSED_LINE_ITEMS_FILE, UNUSED_LINE_ITEMS_HEADERS, UNUSED_MODULES_FILE, UNUSED_MODULES_HEADERS } from "../unused-files.js";
import { cellLists, rowItems } from "./cell-lists.js";
import { columnsOf } from "./columns.js";
import { itemRows, type NamedRows } from "./item-links.js";
import { navItems } from "./markup.js";
import { fileView, listedTables, overviewOf } from "./result-view.js";
import { cellText } from "./table-engine.js";
import { unusedNotes } from "./unused-view.js";

// Made-up names only. The two tables as a model's run makes them (model/unused.ts), beside the tables they name.
const table = (file: string, headers: readonly string[], rows: Cell[][]): ResultTable => ({ file, label: file.replace(/\.csv$/, ""), headers: [...headers], rows, guard: file.startsWith("Unused") });
const MODULES = table("Modules.csv", ["", "Functional Area"], [["REV01 Revenue", "2 Sales"], ["OLD01 Archive", "9 Retired"], ["EMP01 Empty", ""]]);
const LINE_ITEMS = table("Line Items.csv", ["", "Module Name", "Referenced By"], [["REV01 Revenue", "", ""], ["Units", "REV01 Revenue", "Old Copy, 'OLD01 Archive'.Old Units"],
  ["Old Copy", "REV01 Revenue", ""], ["OLD01 Archive", "", ""], ["Old Units", "OLD01 Archive", ""]]);
const UNUSED_LINE_ITEMS = table(UNUSED_LINE_ITEMS_FILE, UNUSED_LINE_ITEMS_HEADERS, [
  ["Old Copy", "REV01 Revenue", "Read by nothing", "Number", 120, "", "Units", ""],
  ["Units", "REV01 Revenue", "Imported, never read", "Number", 1200, "Loaded nightly.", "", "Old Copy, 'OLD01 Archive'.Old Units"],
  ["Old Units", "OLD01 Archive", "Read by nothing", "Number", 480, "", "'REV01 Revenue'.Units", ""]]);
const UNUSED_MODULES = table(UNUSED_MODULES_FILE, UNUSED_MODULES_HEADERS, [["OLD01 Archive", "No line item used", 1, 480, "9 Retired", ""], ["EMP01 Empty", "Empty", 0, 0, "", ""]]);
const NOTE = "The pages built on this model could not be read, so page use is unknown: some line items may be used on pages after all.";
const details = (notes: string[] = [NOTE]): ResultTable => ({ file: "Model Details.csv", label: "Model Details", headers: ["Section", "Detail", "Value"], guard: true, details: true,
  rows: [["Model", "Model", "Bike plan"], ["Files", UNUSED_LINE_ITEMS_FILE, "3 rows"], ["Files", UNUSED_MODULES_FILE, "2 rows"], ...notes.map(note => ["Notes", "Unused Line Items", note]),
    ["How to read", "Unused Line Items", "Line items nothing uses."], ["How to read", "Unused Modules", "Modules nothing uses."]] });
const model = (tables: ResultTable[], notes?: string[]): AnalysisResult => ({ kind: "model", name: "Bike plan", id: "0123456789ABCDEF0123456789ABCDEF",
  zipName: "Bike plan - Model Export - 2026-10-12.zip", summary: ["Unused Line Items: 3 rows", "Unused Modules: 2 rows"], tables: [details(notes), ...tables] });

describe("The tables of what nothing in a model uses, on the results page", () => {
  it("shows each table as it stands, under a line that says what unused means and what the run could not see", () => {
    const result = model([MODULES, LINE_ITEMS, UNUSED_LINE_ITEMS, UNUSED_MODULES]);
    for (const shown of [UNUSED_LINE_ITEMS, UNUSED_MODULES]) {
      const view = fileView(result, shown);
      expect([view.table.rows, view.note]).toEqual([shown.rows, `${UNUSED_CAVEAT} ${NOTE}`]);
    }
    expect(UNUSED_CAVEAT).toBe("Unused means no use Cardigan can see: other models' imports, API reads, line items hidden in saved views and Workflow aren't visible.");
    // Without such a note, the line says what unused means alone; a table without rows says what that means.
    const quiet = model([MODULES, LINE_ITEMS, { ...UNUSED_LINE_ITEMS, rows: [] }, { ...UNUSED_MODULES, rows: [] }], []);
    expect(unusedNotes(quiet)).toEqual([]);
    expect([UNUSED_LINE_ITEMS, UNUSED_MODULES].map(each => fileView(quiet, { ...each, rows: [] })).map(view => [view.note, view.empty])).toEqual([
      [UNUSED_CAVEAT, "Every line item that holds data has a use Cardigan can see."], [UNUSED_CAVEAT, "Every module has a line item in use, or is used whole."]]);
    // The overview gives each a tile only where it has rows, under Modules' tables, and says the run's note once.
    const overview = overviewOf(result);
    expect([overview.tiles.map(tile => [tile.label, tile.count]), overview.notes, overview.howToRead]).toEqual([[["Modules", 3], ["Line Items", 5], ["Unused Line Items", 3],
      ["Unused Modules", 2]], [`Unused Line Items: ${NOTE}`], [["Unused Line Items", "Line items nothing uses."], ["Unused Modules", "Modules nothing uses."]]]);
    expect(overviewOf(quiet).tiles.map(tile => tile.label)).toEqual(["Modules", "Line Items"]);
  });

  it("lays the columns out with Formula, Referenced By and a module's Notes hidden in the chooser, and counts as counts", () => {
    const layout = (shown: ResultTable) => columnsOf(shown).map(column => `${column.label}${column.hidden ? " (hidden)" : ""}${column.kind === "count" ? " (count)" : ""}${column.filter ? " (filter)" : ""}`);
    expect(layout(UNUSED_LINE_ITEMS)).toEqual(["Line Item (filter)", "Module (filter)", "Why (filter)", "Format (filter)", "Cell Count (count) (filter)", "Notes", "Formula (hidden)",
      "Referenced By (hidden) (filter)"]);
    expect(layout(UNUSED_MODULES)).toEqual(["Module (filter)", "Why (filter)", "Line Items (count) (filter)", "Cell Count (count) (filter)", "Functional Area (filter)", "Notes (hidden)"]);
  });

  it("links a row's line item, its module and what its Referenced By names to their own rows, and lists Referenced By one to a line", () => {
    const tables = new Map<string, NamedRows>([[MODULES.file, { table: MODULES, name: 0 }], [LINE_ITEMS.file, { table: LINE_ITEMS, name: 0, module: 1 }]]);
    const named = (of: ResultTable, header: string, row: number, items: string[]) => itemRows(of, header, items, of.rows[row], tables)
      .map(found => (found ? `${found.file}: ${found.row.slice(0, found.file === LINE_ITEMS.file ? 2 : 1).map(cell => cellText(cell)).join(" / ")}` : undefined));
    expect([named(UNUSED_LINE_ITEMS, "Line Item", 0, ["Old Copy"]), named(UNUSED_LINE_ITEMS, "Module", 0, ["REV01 Revenue"]), named(UNUSED_MODULES, "Module", 0, ["OLD01 Archive"])])
      .toEqual([["Line Items.csv: Old Copy / REV01 Revenue"], ["Modules.csv: REV01 Revenue"], ["Modules.csv: OLD01 Archive"]]);
    // A name alone in Referenced By is a line item of the row's module, or a module; behind a module and a dot, that module's.
    const result = model([MODULES, LINE_ITEMS, UNUSED_LINE_ITEMS, UNUSED_MODULES]);
    const items = rowItems(cellLists(result, UNUSED_LINE_ITEMS), UNUSED_LINE_ITEMS.rows[1]);
    const referencedBy = UNUSED_LINE_ITEMS.headers.indexOf("Referenced By");
    expect(items.get(referencedBy)).toEqual(["Old Copy", "'OLD01 Archive'.Old Units"]);
    expect(named(UNUSED_LINE_ITEMS, "Referenced By", 1, [...items.get(referencedBy)!, "OLD01 Archive", "Gone"]))
      .toEqual(["Line Items.csv: Old Copy / REV01 Revenue", "Line Items.csv: Old Units / OLD01 Archive", "Modules.csv: OLD01 Archive", undefined]);
    // A line item's name in another table's column names no row of these: the module is the row's own.
    expect(named(UNUSED_LINE_ITEMS, "Line Item", 2, ["Old Copy"])).toEqual([undefined]);
  });

  it("leaves a result kept by an earlier version, without these tables, as it was: it reads, lists and shows its tables as before", () => {
    const earlier: AnalysisResult = { kind: "model", name: "Bike plan", id: "0123456789ABCDEF0123456789ABCDEF", zipName: "Bike plan - Model Export - 2026-10-01.zip", summary: [],
      tables: [{ ...details([]), rows: [["Model", "Model", "Bike plan"]] }, MODULES, LINE_ITEMS, table("Dynamic Cell Access.csv", ["Driver Module"], [])] };
    const read = plainResult(JSON.parse(JSON.stringify(earlier)));
    expect(read).toEqual(earlier);
    const listed = listedTables(read!).map(({ table: shown }) => shown.file);
    expect(listed).toEqual(["Modules.csv", "Line Items.csv", "Dynamic Cell Access.csv"]);
    const items = navItems(listed.map((file, index) => ({ id: String(index + 1), label: file.replace(/\.csv$/, ""), file })), true);
    expect(items.map(item => ("entries" in item ? `${item.group.label}: ${item.entries.map(entry => entry.label).join(", ")}` : item.label))).toEqual(["Modules: Modules, Line Items, Dynamic Cell Access"]);
    expect(overviewOf(read!).tiles.map(tile => tile.label)).toEqual(["Modules", "Line Items"]);
  });
});
