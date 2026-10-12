import { describe, expect, it } from "vitest";
import type { AnalysisResult, Cell, ImportMapping, PageUses, ResultTable } from "../result-types.js";
import { UNUSED_LINE_ITEMS_FILE, UNUSED_LINE_ITEMS_HEADERS, UNUSED_MODULES_FILE, UNUSED_MODULES_HEADERS, WHY } from "../unused-files.js";
import { addUnused } from "./unused.js";

// Made-up names only: nothing here comes from a real model. The tables are written by hand in the shape of the export's
// (export.ts) and the run's (model-pages.ts): the unnamed first column with each row's name, then the grid's columns under
// Anaplan's own headers. Line Items has the headers a real model's grid has, in its order (results/line-items-view.test.ts),
// and the three the export adds.
const LINE_HEADERS = ["", "Format", "Formula", "Summary", "Applies To", "Time Scale", "Time Range", "Versions", "Style", "Cell Count", "Calculation Effort", "Notes",
  "Read Access Driver", "Write Access Driver", "Users List", "Parent", "Is Summary", "Formula Scope", "Code", "Use Switchover", "Breakback", "Brought-Forward", "Start of Section",
  "Data Tags", "Referenced By", "Module Name", "Ratio Numerator", "Ratio Denominator", "Format List"];
const MODULE_HEADERS = ["", "Functional Area", "Applies To", "Time Scale", "Cell Count", "Notes", "Used in Dashboards"];
const SUBSET_HEADERS = ["", "Modules", "Referenced in Applies To", "Referenced By", "Line Items"];
const IMPORT_HEADERS = ["", "Source Label", "Source Object", "Source Type", "Target Object", "Target Type"];
const ACTION_HEADERS = ["", "Action", "Used in Processes", "Notes"];
const FILTER_HEADERS = ["Condition line item's module", "Condition line item", "Filtered module", "Filtered dimension", "Filtered line items", "App", "Page"];

type Cells = Record<string, Cell>;
const file = (label: string, headers: readonly string[], rows: readonly Cells[]): ResultTable =>
  ({ file: `${label}.csv`, label, headers: [...headers], rows: rows.map(cells => headers.map(header => (Object.hasOwn(cells, header) ? cells[header] : ""))), guard: false });

const NUMBER = '{"minimumSignificantDigits":4,"decimalPlaces":-1,"dataType":"NUMBER"}';
const BOOLEAN = '{"dataType":"BOOLEAN"}';
const NO_DATA = '{"dataType":"NONE"}';
const SUM = '{"summaryMethod":"SUM","timeSummaryMethod":"SUM"}';
/** A module's own row of Line Items, and a line item's: a number that is summed, unless the cells say otherwise. */
const own = (name: string, cells: Cells = {}): Cells => ({ "": name, ...cells });
const item = (module: string, name: string, cells: Cells = {}): Cells => ({ "": name, "Module Name": module, Format: NUMBER, Summary: SUM, "Applies To": "-", "Cell Count": 120, ...cells });
const heading = (module: string, name: string): Cells => item(module, name, { Format: NO_DATA, Summary: "", "Cell Count": "" });
const lineItems = (...rows: Cells[]): ResultTable => file("Line Items", LINE_HEADERS, rows);
const modules = (...rows: Cells[]): ResultTable => file("Modules", MODULE_HEADERS, rows);

/** The IDs the export gives for each row of Line Items: a module's own row its own, a line item its own and its module's. */
function idsOf(table: ResultTable): { ids: [string, string][]; of: (module: string, name: string) => string } {
  const [moduleAt, found] = [table.headers.indexOf("Module Name"), new Map<string, string>()];
  let [moduleId, itemId] = [102000000000, 1901000000000];
  const ownIds = new Map<string, string>();
  const ids = table.rows.map((row): [string, string] => {
    const [name, module] = [String(row[0]), String(row[moduleAt])];
    if (module === "") {
      const id = String(++moduleId);
      ownIds.set(name, id);
      return [id, ""];
    }
    const id = String(++itemId);
    found.set(`${module}\n${name}`, id);
    return [id, ownIds.get(module) ?? ""];
  });
  return { ids, of: (module, name) => found.get(`${module}\n${name}`)! };
}

const details = (): ResultTable => ({ file: "Model Details.csv", label: "Model Details", headers: ["Section", "Detail", "Value"], guard: true, details: true,
  rows: [["Model", "Model", "Bike plan"], ["Files", "Line Items.csv", "3 rows"], ["Files", "Modules.csv", "2 rows"], ["Notes", "Actions", "An earlier note."],
    ["How to read", "Layout", "Words."], ["Diagnostics", "10:00:00", "An earlier line."]] });
/** The pages built on the model, read, and naming nothing: what each test changes. */
const NO_USES: PageUses = { lineItems: [], modules: [], unread: 0, unnamed: 0 };
/** A model's result with these tables, beside the empty tables a model's export has that the test does not give. */
function model(tables: ResultTable[], more: Partial<AnalysisResult> = {}): AnalysisResult {
  const given = new Set(tables.map(table => table.file));
  const empty = [file("Line Item Subsets", SUBSET_HEADERS, []), file("Imports", IMPORT_HEADERS, []), file("Exports", ACTION_HEADERS, []), file("Other Actions", ACTION_HEADERS, [])]
    .filter(table => !given.has(table.file));
  return { kind: "model", name: "Bike plan", id: "0123456789ABCDEF0123456789ABCDEF", zipName: "Bike plan - Model Export - 2026-10-12.zip", summary: ["Line Items: 3 rows"],
    tables: [details(), ...tables, ...empty], importMappings: [], pageUses: NO_USES, ...more };
}

/** What the run makes of a result: the two tables' rows by name and why, its notes, and what it logs. */
function unused(result: AnalysisResult, ids?: [string, string][]) {
  const lines: string[] = [];
  const made = addUnused(result, ids, line => lines.push(line));
  const table = (name: string) => made.tables.find(each => each.file === name)!;
  return {
    made, lines,
    items: table(UNUSED_LINE_ITEMS_FILE).rows.map(row => `${row[1]} / ${row[0]}: ${row[2]}`),
    modules: table(UNUSED_MODULES_FILE).rows.map(row => `${row[0]}: ${row[1]}`),
    notes: made.tables[0].rows.filter(row => row[0] === "Notes" && row[1] === "Unused Line Items").map(row => String(row[2])),
  };
}

describe("The tables of what nothing in a model uses", () => {
  it("lists a line item nothing reads, and leaves out one that another line item's formula reads, as its Referenced By names that line item", () => {
    const { items, modules: listed } = unused(model([
      lineItems(own("REV01 Revenue"), item("REV01 Revenue", "Units", { "Referenced By": "Revenue" }), item("REV01 Revenue", "Price", { "Referenced By": "Revenue, 'REP01 Report'.Average Price" }),
        item("REV01 Revenue", "Revenue", { Formula: "Units * Price", "Referenced By": "'REP01 Report'.Total" }), item("REV01 Revenue", "Old Rate"),
        own("REP01 Report"), item("REP01 Report", "Total", { Formula: "'REV01 Revenue'.Revenue" }), item("REP01 Report", "Average Price", { Formula: "'REV01 Revenue'.Price" })),
      modules(own("REV01 Revenue"), own("REP01 Report"))], { pageUses: { ...NO_USES, lineItems: [["REP01 Report", "Total"]] } }));
    // Total is on a page; Revenue feeds it, and Units and Price feed Revenue. Average Price reads Price, and nothing reads it.
    expect(items).toEqual(["REV01 Revenue / Old Rate: Read by nothing", "REP01 Report / Average Price: Read by nothing"]);
    expect(listed).toEqual([]);
  });

  it("does not count a line item's reference to itself as a use", () => {
    const { items } = unused(model([lineItems(own("STK01 Stock"),
      item("STK01 Stock", "Opening Stock", { Formula: "PREVIOUS(Opening Stock)", "Referenced By": "Opening Stock" }),
      item("STK01 Stock", "Closing Stock", { Formula: "PREVIOUS(Closing Stock) + 1", "Referenced By": "Closing Stock, Stock Check" }),
      item("STK01 Stock", "Stock Check", { Formula: "Closing Stock" }))], { pageUses: { ...NO_USES, lineItems: [["STK01 Stock", "Stock Check"]] } }));
    expect(items).toEqual(["STK01 Stock / Opening Stock: Read by nothing"]);
  });

  it("follows a dead chain back from what really uses the model: three line items that only feed one another", () => {
    const { items } = unused(model([lineItems(own("PLN01 Plan"),
      item("PLN01 Plan", "Base Volume", { "Referenced By": "Adjusted Volume" }),
      item("PLN01 Plan", "Adjusted Volume", { Formula: "Base Volume * 1.1", "Referenced By": "Final Volume" }),
      item("PLN01 Plan", "Final Volume", { Formula: "Adjusted Volume" }),
      // The same chain, read by a line item on a page: none of it is listed.
      item("PLN01 Plan", "Live Base", { "Referenced By": "Live Final" }), item("PLN01 Plan", "Live Final", { Formula: "Live Base", "Referenced By": "Shown" }),
      item("PLN01 Plan", "Shown", { Formula: "Live Final" }))], { pageUses: { ...NO_USES, lineItems: [["PLN01 Plan", "Shown"]] } }));
    expect(items).toEqual(["PLN01 Plan / Base Volume: Only feeds unused line items", "PLN01 Plan / Adjusted Volume: Only feeds unused line items",
      "PLN01 Plan / Final Volume: Read by nothing"]);
  });

  it("counts a Ratio summary's numerator and denominator as used by the ratio's line item", () => {
    const { items } = unused(model([lineItems(own("MAR01 Margin"),
      item("MAR01 Margin", "Profit"), item("MAR01 Margin", "Sales"),
      item("MAR01 Margin", "Margin %", { Formula: "Profit / Sales", Summary: '{"summaryMethod":"RATIO"}', "Ratio Numerator": "Profit", "Ratio Denominator": "Sales" }),
      // An unused ratio leaves its operands unused too.
      item("MAR01 Margin", "Cost"), item("MAR01 Margin", "Old Ratio", { Summary: '{"summaryMethod":"RATIO"}', "Ratio Numerator": "Cost", "Ratio Denominator": "Sales" }))],
    { pageUses: { ...NO_USES, lineItems: [["MAR01 Margin", "Margin %"]] } }));
    expect(items).toEqual(["MAR01 Margin / Cost: Only feeds unused line items", "MAR01 Margin / Old Ratio: Read by nothing"]);
  });

  it("counts a summary parent and the line items summed into it as using one another", () => {
    const rows = [own("CST01 Costs"), item("CST01 Costs", "Total Costs", { "Is Summary": "true" }), item("CST01 Costs", "Rent", { Parent: "Total Costs" }),
      item("CST01 Costs", "Wages", { Parent: "Total Costs" }), item("CST01 Costs", "Fleet", { "Referenced By": "Fleet Total" }), item("CST01 Costs", "Fleet Total", { Formula: "Fleet" }),
      item("CST01 Costs", "Spare Total", { "Is Summary": "true" }), item("CST01 Costs", "Spare", { Parent: "Spare Total" })];
    // The parent on a page: the line items summed into it are used.
    expect(unused(model([lineItems(...rows)], { pageUses: { ...NO_USES, lineItems: [["CST01 Costs", "Total Costs"], ["CST01 Costs", "Fleet Total"]] } })).items)
      .toEqual(["CST01 Costs / Spare Total: Only feeds unused line items", "CST01 Costs / Spare: Only feeds unused line items"]);
    // A line item summed into it on a page: the parent is used, as another line item names it as its Parent, and so is the
    // parent's other line item, which is summed into it.
    expect(unused(model([lineItems(...rows)], { pageUses: { ...NO_USES, lineItems: [["CST01 Costs", "Wages"], ["CST01 Costs", "Fleet Total"]] } })).items)
      .toEqual(["CST01 Costs / Spare Total: Only feeds unused line items", "CST01 Costs / Spare: Only feeds unused line items"]);
  });

  it("counts an access driver as used, on a line item's row or on a module's own row, and the Dynamic Cell Access table's drivers too", () => {
    const { items, lines } = unused(model([lineItems(
      own("SYS01 Access"), item("SYS01 Access", "Can Edit", { Format: BOOLEAN }), item("SYS01 Access", "Can Read", { Format: BOOLEAN }), item("SYS01 Access", "Can Approve", { Format: BOOLEAN }),
      item("SYS01 Access", "Spare Flag", { Format: BOOLEAN }),
      own("INP01 Inputs", { "Read Access Driver": "'SYS01 Access'.Can Read" }), item("INP01 Inputs", "Volume", { "Write Access Driver": "'SYS01 Access'.Can Edit", "Read Access Driver": "-" })),
    file("Dynamic Cell Access", ["Driver Module", "Driver Line Item", "Access", "Controlled Module", "Controlled Line Item"], [{ "Driver Module": "SYS01 Access", "Driver Line Item": "Can Approve",
      Access: "Write", "Controlled Module": "INP01 Inputs", "Controlled Line Item": "Volume" }])],
    { pageUses: { ...NO_USES, lineItems: [["INP01 Inputs", "Volume"]] } }));
    expect(items).toEqual(["SYS01 Access / Spare Flag: Read by nothing"]);
    expect(lines[1]).toContain("driver cells 2");
  });

  it("says Imported, never read of a line item an import loads that nothing reads, by its target, its header pair, or every line item a header can match", () => {
    const rows = [own("SAL01 Sales"), item("SAL01 Sales", "Units Sold"), item("SAL01 Sales", "Returns"), item("SAL01 Sales", "Discount"),
      item("SAL01 Sales", "Net Units", { Formula: "Units Sold - Returns" }), item("SAL01 Sales", "Ignored"),
      own("SAL02 Prices"), item("SAL02 Prices", "List Price"), item("SAL02 Prices", "Promo Price"), item("SAL02 Prices", "Price Check", { Formula: "List Price" }), heading("SAL02 Prices", "Prices")];
    const imports = file("Imports", IMPORT_HEADERS, [{ "": "Load sales", "Source Type": "FILE", "Source Object": "-", "Target Object": "SAL01 Sales", "Target Type": "MODULE" },
      { "": "Load prices", "Source Type": "FILE", "Source Object": "-", "Target Object": "SAL02 Prices", "Target Type": "MODULE" }]);
    const mappings: ImportMapping[] = [
      { id: "112000000001", name: "Load sales", importType: "MODULE_DATA", targets: [{ target: "Units Sold", source: "column", column: 3 }, { target: "Ignored", source: "ignore" },
        { target: "Line Items", source: "headerRow" }], headers: [{ header: "Returns", lineItem: "Returns" }, { header: "Notes" }] },
      // The header row matched by name when the import runs: every line item without a formula that holds data.
      { id: "112000000002", name: "Load prices", importType: "MODULE_DATA", targets: [{ target: "Line Items", source: "headerRow" }] }];
    const { items } = unused(model([lineItems(...rows), imports], { importMappings: mappings }));
    expect(items).toEqual(["SAL01 Sales / Units Sold: Imported, never read", "SAL01 Sales / Returns: Imported, never read", "SAL01 Sales / Discount: Read by nothing",
      "SAL01 Sales / Net Units: Read by nothing", "SAL01 Sales / Ignored: Read by nothing", "SAL02 Prices / List Price: Imported, never read",
      "SAL02 Prices / Promo Price: Imported, never read", "SAL02 Prices / Price Check: Read by nothing"]);
    // An imported line item that only an unused line item reads is listed as imported too.
    const read = unused(model([lineItems(own("SAL01 Sales"), item("SAL01 Sales", "Units Sold", { "Referenced By": "Unused Copy" }), item("SAL01 Sales", "Unused Copy", { Formula: "Units Sold" })),
      imports], { importMappings: [mappings[0]] }));
    expect(read.items).toEqual(["SAL01 Sales / Units Sold: Imported, never read", "SAL01 Sales / Unused Copy: Read by nothing"]);
  });

  it("counts what a page names as used: a card's line items, a page filter's condition and the line items it filters", () => {
    const filters = file("Page Filters", FILTER_HEADERS, [
      { "Condition line item's module": "FLT01 Flags", "Condition line item": "Include?", "Filtered module": "DEM01 Demand", "Filtered line items": "Only Forecast, 'Plan, final'" }]);
    const { items } = unused(model([lineItems(own("FLT01 Flags"), item("FLT01 Flags", "Include?", { Format: BOOLEAN }), item("FLT01 Flags", "Exclude?", { Format: BOOLEAN }),
      own("DEM01 Demand"), item("DEM01 Demand", "Forecast"), item("DEM01 Demand", "Plan, final"), item("DEM01 Demand", "Actuals"), item("DEM01 Demand", "Button Target")), filters],
    { pageUses: { ...NO_USES, lineItems: [["DEM01 Demand", "Button Target"]] } }));
    expect(items).toEqual(["FLT01 Flags / Exclude?: Read by nothing", "DEM01 Demand / Actuals: Read by nothing"]);
  });

  it("counts the members of a line item subset as used where a module applies to the subset or something refers to it", () => {
    const subsets = file("Line Item Subsets", SUBSET_HEADERS, [{ "": "Key Measures", Modules: "KPI01 Measures", "Line Items": "'KPI01 Measures'.Revenue, 'KPI01 Measures'.'Units, net'" },
      { "": "Formats", Modules: "KPI01 Measures", "Referenced By": "'RPT01 Pack'.Measure Pick", "Line Items": "'KPI01 Measures'.Cost" },
      { "": "Spare Set", Modules: "KPI01 Measures", "Line Items": "'KPI01 Measures'.Spare" }]);
    const { items } = unused(model([lineItems(own("KPI01 Measures"), item("KPI01 Measures", "Revenue"), item("KPI01 Measures", "Units, net"), item("KPI01 Measures", "Cost"),
      item("KPI01 Measures", "Spare"), own("RPT01 Pack", { "Applies To": "Key Measures" })), modules(own("KPI01 Measures"), own("RPT01 Pack", { "Applies To": "Key Measures" })), subsets]));
    expect(items).toEqual(["KPI01 Measures / Spare: Read by nothing"]);
  });

  it("counts every line item of a module used whole: an export's source, an import's source in this model, a page's grid or Used in Dashboards", () => {
    const rows = [own("EXP01 Extract"), item("EXP01 Extract", "Sent Units"), item("EXP01 Extract", "Sent Value"), own("EXP02 Words"), item("EXP02 Words", "Shipped"),
      own("SRC01 Source"), item("SRC01 Source", "Feed"), own("GRD01 Grid"), item("GRD01 Grid", "Shown Whole"), own("DSH01 Dash"), item("DSH01 Dash", "On Dashboard"),
      own("NON01 None"), item("NON01 None", "Nothing")];
    const table = lineItems(...rows);
    const { ids } = idsOf(table);
    const result = model([table, modules(own("EXP01 Extract"), own("EXP02 Words"), own("SRC01 Source"), own("GRD01 Grid"), own("DSH01 Dash", { "Used in Dashboards": "Weekly review" }), own("NON01 None")),
      file("Exports", ACTION_HEADERS, [{ "": "Send extract", Action: JSON.stringify({ exportType: "GRID_ALL_PAGES", sourceEntityLongId: 102000000001 }) },
        { "": "Send words", Action: "Export from 'EXP02 Words'" }]),
      file("Imports", IMPORT_HEADERS, [{ "": "Copy feed", "Source Type": "SAVED VIEW", "Source Object": "'SRC01 Source'.'Feed view'", "Target Object": "Regions", "Target Type": "LIST" },
        { "": "From the hub", "Source Type": "MODULE", "Source Object": "Hub model / 'NON01 None'", "Target Object": "Regions", "Target Type": "LIST" }])],
    { moduleIds: [["EXP01 Extract", "102000000001"], ["EXP02 Words", "102000000002"]], pageUses: { ...NO_USES, modules: ["GRD01 Grid"] } });
    const { items, modules: listed } = unused(result, ids);
    // An import from another model's module of the same name is no use of this model's.
    expect(items).toEqual(["NON01 None / Nothing: Read by nothing"]);
    expect(listed).toEqual(["NON01 None: No line item used"]);
  });

  it("counts a line item an action's definition names by its ID: an export's filter, or another action's line item", () => {
    const table = lineItems(own("ACT01 Actions"), item("ACT01 Actions", "Delete Flag", { Format: BOOLEAN }), item("ACT01 Actions", "Export Filter", { Format: BOOLEAN }),
      item("ACT01 Actions", "Second Filter", { Format: BOOLEAN }), item("ACT01 Actions", "Not Named", { Format: BOOLEAN }));
    const { ids, of } = idsOf(table);
    const result = model([table,
      file("Exports", ACTION_HEADERS, [{ "": "Send flagged", Action: JSON.stringify({ exportType: "TABULAR_MULTI_COLUMN", filter0LineItemEntityLongId: Number(of("ACT01 Actions", "Export Filter")),
        filter1LineItemEntityLongId: of("ACT01 Actions", "Second Filter") }) }]),
      file("Other Actions", ACTION_HEADERS, [{ "": "Delete flagged", Action: JSON.stringify({ actionType: "DELETE_BY_SELECTION", hierarchyIdentifier: "_101000000001_",
        filterLineItemIdentifier: `_${of("ACT01 Actions", "Delete Flag")}_` }) }])]);
    const found = unused(result, ids);
    expect(found.items).toEqual(["ACT01 Actions / Not Named: Read by nothing"]);
    // The log says how the Action cells are written, by their keys and never their values.
    expect(found.lines[2]).toBe("Unused: Action cells of Exports: exportType ×1, filter0LineItemEntityLongId ×1, filter1LineItemEntityLongId ×1; "
      + "of Other Actions: actionType ×1, hierarchyIdentifier ×1, filterLineItemIdentifier ×1; exports whose source was not read: 1");
    // An export whose source is not read says so; without the line items' IDs, the actions' line items cannot be matched.
    const unmatched = unused(result);
    expect(unmatched.items).toHaveLength(4);
    expect(unmatched.notes).toEqual(["1 export's source couldn't be read, so a module it exports may be used after all.",
      "The line items that actions name by ID could not be matched, so some line items may be used by actions after all."]);
  });

  it("never lists a heading, and lists an empty module, one of headings only, and one whose every line item is unused, but no divider", () => {
    const result = model([lineItems(own("-- Inputs --"), own("HDR01 Titles"), heading("HDR01 Titles", "Section A"), heading("HDR01 Titles", "Section B"),
      own("OLD01 Archive"), item("OLD01 Archive", "Old Units", { Notes: "Kept for 2024.", "Referenced By": "Old Value" }), heading("OLD01 Archive", "Archive"),
      item("OLD01 Archive", "Old Value", { Formula: "Old Units * 2" }),
      own("LIV01 Live"), item("LIV01 Live", "Live Units"), item("LIV01 Live", "Spare Units")),
    modules(own("-- Inputs --"), own("HDR01 Titles"), own("OLD01 Archive", { "Functional Area": "9 Retired", "Cell Count": 480, Notes: "Retire in Q1." }), own("LIV01 Live"),
      own("EMP01 Empty", { "Functional Area": "1 Data", "Cell Count": 0 }))],
    { pageUses: { ...NO_USES, lineItems: [["LIV01 Live", "Live Units"]] } });
    const { items, modules: listed, made } = unused(result);
    expect(items).toEqual(["OLD01 Archive / Old Units: Only feeds unused line items", "OLD01 Archive / Old Value: Read by nothing", "LIV01 Live / Spare Units: Read by nothing"]);
    expect(listed).toEqual(["HDR01 Titles: Empty", "OLD01 Archive: No line item used", "EMP01 Empty: Empty"]);
    // Each table's columns, in order: the module's own cells of Modules, and a line item's of Line Items with its Format in words.
    const [lineTable, moduleTable] = [UNUSED_LINE_ITEMS_FILE, UNUSED_MODULES_FILE].map(name => made.tables.find(table => table.file === name)!);
    expect([lineTable.headers, moduleTable.headers, lineTable.guard, lineTable.label, moduleTable.label]).toEqual([UNUSED_LINE_ITEMS_HEADERS, UNUSED_MODULES_HEADERS, true, "Unused Line Items", "Unused Modules"]);
    expect(lineTable.rows[1]).toEqual(["Old Value", "OLD01 Archive", WHY.readByNothing, "Number", 120, "", "Old Units * 2", ""]);
    expect(lineTable.rows[0][5]).toBe("Kept for 2024.");
    expect(moduleTable.rows).toEqual([["HDR01 Titles", WHY.empty, 0, "", "", ""], ["OLD01 Archive", WHY.noLineItemUsed, 2, 480, "9 Retired", "Retire in Q1."],
      ["EMP01 Empty", WHY.empty, 0, 0, "1 Data", ""]]);
  });

  it("does not list a module used only on a page, nor any of its line items", () => {
    const tables = [lineItems(own("PAG01 Page Only"), item("PAG01 Page Only", "Shown A"), item("PAG01 Page Only", "Shown B")), modules(own("PAG01 Page Only"))];
    expect(unused(model(tables, { pageUses: { ...NO_USES, modules: ["PAG01 Page Only"] } }))).toMatchObject({ items: [], modules: [] });
    // Without the page, both line items and the module are listed.
    expect(unused(model(tables))).toMatchObject({ items: ["PAG01 Page Only / Shown A: Read by nothing", "PAG01 Page Only / Shown B: Read by nothing"],
      modules: ["PAG01 Page Only: No line item used"] });
  });

  it("makes both tables where the pages built on the model were not read, and says that page use is unknown", () => {
    const { items, notes, made } = unused(model([lineItems(own("REV01 Revenue"), item("REV01 Revenue", "Units"))], { pageUses: undefined }));
    expect(items).toEqual(["REV01 Revenue / Units: Read by nothing"]);
    expect(notes).toEqual(["The pages built on this model could not be read, so page use is unknown: some line items may be used on pages after all."]);
    expect(made.tables.slice(-2).map(table => table.label)).toEqual(["Unused Line Items", "Unused Modules"]);
    // Some pages not read, or names the pages use that could not be named, say so too.
    expect(unused(model([lineItems(own("REV01 Revenue"))], { pageUses: { ...NO_USES, unread: 2, unnamed: 1 } })).notes).toEqual([
      "2 pages built on this model could not be read, so some line items may be used on them after all.",
      "1 thing the pages use could not be named, so some line items may be used on pages after all."]);
  });

  it("says what else it could not see: Line Items, its Referenced By, the imports' mappings, the subsets and the actions", () => {
    // Without Line Items nothing is checked, and that is the one note.
    const none = unused(model([modules(own("REV01 Revenue"))], { pageUses: undefined }));
    expect([none.items, none.modules, none.notes]).toEqual([[], [], ["Line Items was not read, so no line item or module could be checked."]]);
    const table = lineItems(own("REV01 Revenue"), item("REV01 Revenue", "Units"));
    const noReferences: ResultTable = { ...table, headers: table.headers.map(header => (header === "Referenced By" ? "Referenced" : header)) };
    const imports = file("Imports", IMPORT_HEADERS, [{ "": "Load units", "Source Type": "FILE", "Target Object": "REV01 Revenue" }]);
    const result = model([noReferences, imports], { importMappings: undefined });
    result.tables = result.tables.filter(each => !["Line Item Subsets.csv", "Exports.csv", "Other Actions.csv"].includes(each.file));
    // Without its mapping, an import into a module may load any line item of it that has no formula.
    const found = unused(result);
    expect(found.notes).toEqual(["Line Items has no Referenced By column, so formula use is unknown: some line items may be read by formulas after all.",
      "Line Item Subsets was not read, so some line items may be used through a subset after all.",
      "The Actions list was not read, so exports and actions are not known: some line items may be used after all.",
      "The mapping of 1 import could not be read, so every line item without a formula in the module it loads counts as imported."]);
    expect(found.items).toEqual(["REV01 Revenue / Units: Imported, never read"]);
    // A mapping that could not be read, and a subset in use whose members were not read.
    const subsets = file("Line Item Subsets", [...SUBSET_HEADERS, "Membership read"], [{ "": "Key", "Referenced By": "Somewhere", "Membership read": "false" }]);
    expect(unused(model([table, imports, subsets], { importMappings: [{ id: "112000000001", name: "Load units", importType: "", targets: [], note: "Not read." }] })).notes).toEqual([
      "The members of 1 line item subset in use were not read, so some line items may be used through it after all.",
      "The mapping of 1 import could not be read, so every line item without a formula in the module it loads counts as imported."]);
  });

  it("says, where the model refused rows of Line Items, that line items used only by them may be listed, and their modules; what their formulas read is used", () => {
    // Line Items without the rows the model refused: REP01 Report's own and its Total, which reads Units. Units' Referenced By
    // names Total all the same, and a name that is no line item of the table counts as a use: Units is not listed.
    const result = model([lineItems(own("REV01 Revenue"), item("REV01 Revenue", "Units", { "Referenced By": "'REP01 Report'.Total" }), item("REV01 Revenue", "Price")),
      modules(own("REV01 Revenue"), own("REP01 Report"))]);
    const made = (refused?: number) => {
      const added = addUnused(result, undefined, () => undefined, refused);
      const rows = (name: string) => added.tables.find(each => each.file === name)!.rows;
      return { items: rows(UNUSED_LINE_ITEMS_FILE).map(row => `${row[1]} / ${row[0]}: ${row[2]}`), modules: rows(UNUSED_MODULES_FILE).map(row => `${row[0]}: ${row[1]}`),
        notes: added.tables[0].rows.filter(row => row[0] === "Notes" && row[1] === "Unused Line Items").map(row => String(row[2])) };
    };
    // What only the refused rows use but by a formula, as Price may be by a ratio, and a module whose rows were all refused,
    // as REP01 Report's were, are listed all the same: the note says they may be.
    expect(made(2)).toEqual({ items: ["REV01 Revenue / Price: Read by nothing"], modules: ["REP01 Report: Empty"],
      notes: ["2 rows of Line Items could not be read, so line items used only by them may be listed, and so may their modules."] });
    expect(made(1).notes).toEqual(["1 row of Line Items could not be read, so line items used only by it may be listed, and so may its module."]);
    // Where the model refused none, there is no such note.
    expect(made(0)).toEqual({ ...made(2), notes: [] });
    expect(made()).toEqual(made(0));
  });

  it("counts what an imported line item uses as used, as the summary parent it is summed into, and still lists the imported line item", () => {
    const imports = file("Imports", IMPORT_HEADERS, [{ "": "Load stock", "Source Type": "FILE", "Target Object": "STK01 Stock", "Target Type": "MODULE" }]);
    const { items } = unused(model([lineItems(own("STK01 Stock"), item("STK01 Stock", "Stock Total", { "Is Summary": "true" }), item("STK01 Stock", "Stock In", { Parent: "Stock Total" }),
      item("STK01 Stock", "Spare Total", { "Is Summary": "true" }), item("STK01 Stock", "Spare In", { Parent: "Spare Total" })), imports],
    { importMappings: [{ id: "112000000001", name: "Load stock", importType: "MODULE_DATA", targets: [{ target: "Stock In", source: "column", column: 2 }] }] }));
    expect(items).toEqual(["STK01 Stock / Stock In: Imported, never read", "STK01 Stock / Spare Total: Only feeds unused line items",
      "STK01 Stock / Spare In: Only feeds unused line items"]);
  });

  it("finds an import's mapping by its name and its place among the imports from a file of that name, whatever they load", () => {
    // A list import and a module import of one name: the second mapping of that name is the module import's.
    const imports = file("Imports", IMPORT_HEADERS, [{ "": "Load", "Source Type": "FILE", "Target Object": "Regions", "Target Type": "LIST" },
      { "": "Load", "Source Type": "FILE", "Target Object": "SAL01 Sales", "Target Type": "MODULE" }]);
    const { items, notes } = unused(model([lineItems(own("SAL01 Sales"), item("SAL01 Sales", "Units Sold"), item("SAL01 Sales", "Returns")), imports], { importMappings: [
      { id: "112000000001", name: "Load", importType: "HIERARCHY_DATA", targets: [{ target: "Regions", source: "column", column: 1 }] },
      { id: "112000000002", name: "Load", importType: "MODULE_DATA", targets: [{ target: "Units Sold", source: "column", column: 2 }] }] }));
    expect([items, notes]).toEqual([["SAL01 Sales / Units Sold: Imported, never read", "SAL01 Sales / Returns: Read by nothing"], []]);
  });

  it("counts every line item without a formula of a module an import from a model loads as imported where the result has no mapping for it", () => {
    const imports = file("Imports", IMPORT_HEADERS, [{ "": "Load orders from the hub", "Source Type": "SAVED VIEW", "Source Object": "Hub model / 'HUB03 Orders'.'Export to plan'",
      "Target Object": "ORD01 Orders", "Target Type": "MODULE" }, { "": "Load regions", "Source Type": "MODULE", "Source Object": "Hub model / 'HUB09 Regions'", "Target Object": "Regions",
      "Target Type": "LIST" }]);
    const { items } = unused(model([lineItems(own("ORD01 Orders"), item("ORD01 Orders", "Units Ordered", { "Referenced By": "Fill Rate" }),
      item("ORD01 Orders", "Fill Rate", { Formula: "Units Ordered / 2" }), heading("ORD01 Orders", "Orders"), own("REG01 Regions"), item("REG01 Regions", "Region Code")), imports]));
    expect(items).toEqual(["ORD01 Orders / Units Ordered: Imported, never read", "ORD01 Orders / Fill Rate: Read by nothing", "REG01 Regions / Region Code: Read by nothing"]);
  });

  it("uses the mapping of an import from a module or a saved view, found by its name among the imports of its Source Type", () => {
    // A file import and a module import of one name: each finds its own mapping by Source Type.
    const imports = file("Imports", IMPORT_HEADERS, [{ "": "Copy", "Source Type": "FILE", "Source Object": "-", "Target Object": "ORD01 Orders", "Target Type": "MODULE" },
      { "": "Copy", "Source Type": "MODULE", "Source Object": "Plan model / 'SRC01 Source'", "Target Object": "ORD01 Orders", "Target Type": "MODULE" }]);
    const { items, notes } = unused(model([lineItems(own("ORD01 Orders"), item("ORD01 Orders", "Units Ordered"), item("ORD01 Orders", "Units Shipped"),
      item("ORD01 Orders", "Units Returned")), imports], { importMappings: [
      { id: "112000000001", name: "Copy", sourceType: "FILE", importType: "MODULE_DATA", targets: [{ target: "Units Ordered", source: "column", column: 2 }] },
      { id: "112000000002", name: "Copy", sourceType: "MODULE", importType: "MODULE_DATA", targets: [{ target: "Units Shipped", source: "column", text: "Shipped" }] }] }));
    expect([items, notes]).toEqual([["ORD01 Orders / Units Ordered: Imported, never read", "ORD01 Orders / Units Shipped: Imported, never read",
      "ORD01 Orders / Units Returned: Read by nothing"], []]);
  });

  it("adds the tables after the result's others, each with its Files row, its notes among the notes, and its log lines, and changes nothing it was given", () => {
    const result = model([lineItems(own("REV01 Revenue"), item("REV01 Revenue", "Units"))], { pageUses: undefined });
    const before = JSON.stringify(result);
    const { made, lines } = unused(result);
    expect(JSON.stringify(result)).toBe(before);
    expect(made.tables.slice(0, -2)).toEqual(result.tables.map(table => (table.details ? { ...table, rows: made.tables[0].rows } : table)));
    expect(made.summary).toEqual(["Line Items: 3 rows", "Unused Line Items: 1 rows", "Unused Modules: 1 rows"]);
    const rows = made.tables[0].rows;
    expect(rows.slice(0, 7)).toEqual([["Model", "Model", "Bike plan"], ["Files", "Line Items.csv", "3 rows"], ["Files", "Modules.csv", "2 rows"],
      ["Files", "Unused Line Items.csv", "1 rows"], ["Files", "Unused Modules.csv", "1 rows"], ["Notes", "Actions", "An earlier note."],
      ["Notes", "Unused Line Items", "The pages built on this model could not be read, so page use is unknown: some line items may be used on pages after all."]]);
    expect(rows.slice(7, 9)).toEqual([["How to read", "Layout", "Words."], ["Diagnostics", "10:00:00", "An earlier line."]]);
    // The log's lines say how many of what were found, and no name: the run's log is written as each line comes.
    expect(rows.slice(9).map(row => [row[0], row[2]])).toEqual(lines.map(line => ["Diagnostics", line]));
    expect(lines[0]).toBe("Unused: 1 of 1 line items that hold data listed (Imported, never read ×0, Read by nothing ×1, Only feeds unused line items ×0); "
      + "1 of 1 modules listed (Empty ×0, No line item used ×1); 0 line items used directly, 0 modules used whole");
    expect(lines.join("\n")).not.toContain("REV01");
  });

  it("leaves both tables out, with why, where they cannot be made", () => {
    const result = model([{ ...lineItems(own("REV01 Revenue")), rows: null as unknown as Cell[][] }]);
    const { made, lines } = { made: addUnused(result, undefined), lines: [] };
    expect(made.tables.map(table => table.file)).not.toContain(UNUSED_LINE_ITEMS_FILE);
    expect(made.tables[0].rows.filter(row => String(row[1]).startsWith("Unused"))).toEqual([["Files", "Unused Line Items.csv", expect.stringMatching(/^Not exported: Cardigan could not make it: /)],
      ["Files", "Unused Modules.csv", expect.stringMatching(/^Not exported: Cardigan could not make it: /)]]);
    expect(made.summary.slice(-2)).toEqual([expect.stringMatching(/^Unused Line Items: not exported \(Cardigan could not make it: .+\)\.$/),
      expect.stringMatching(/^Unused Modules: not exported \(Cardigan could not make it: .+\)\.$/)]);
    expect(lines).toEqual([]);
  });
});
