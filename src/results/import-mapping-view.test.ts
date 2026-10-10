import { describe, expect, it } from "vitest";
import type { AnalysisResult, ImportMapping, ItemMatch, MappedTarget, ResultTable } from "../result-types.js";
import { columnLines, HEADER_ROW_BY_HAND, HEADER_ROW_MATCHED, HEADER_ROW_UNSTORED, lineItemsOf, mappingOfRow, mappingView, matchWords, NO_MAPPING, numbersWords, sourceWords,
  unfedLine } from "./import-mapping-view.js";
import { fileView } from "./result-view.js";

// Mappings as the model export reads them out of an import's definition (model/import-mappings.ts). The first import is
// the user's example of an import into a list; every other name is made up.

/** A target fed by a column: by its place and its heading, or by either. */
const column = (target: string, place?: number, heading?: string): MappedTarget =>
  ({ target, source: "column", ...(place !== undefined ? { column: place } : {}), ...(heading !== undefined ? { text: heading } : {}) });
/** The page's words name no file: no-file.test-support.ts holds the page to that, and these are some of its words. */
const NAMES_A_FILE = /\.csv|\bcsv\b|\bzip\b|download|\bfiles?\b/i;

describe("An import's mapping, in the drawer's words", () => {
  it("says numbers in order, a run of three or more as one", () => {
    expect([numbersWords([3]), numbersWords([5, 3]), numbersWords([3, 5, 6]), numbersWords([3, 4, 5, 6, 7, 8, 9]), numbersWords([9, 1, 3, 4, 5, 6, 6]), numbersWords([2, 3, 7, 8])])
      .toEqual(["3", "3 and 5", "3, 5 and 6", "3 to 9", "1, 3 to 6 and 9", "2, 3, 7 and 8"]);
  });

  it("says what feeds a target: a column by its place and heading, a constant's value, a prompt, nothing, or a source of another kind", () => {
    const said = ([
      column("Division", 1, "Division Name"), column("Code", 4), column("Units", undefined, "Units"), { target: "Region", source: "column", id: "f12" }, column("Odd"),
      { target: "Versions", source: "constant", text: "Actual" }, { target: "Versions", source: "constant" },
      { target: "Products", source: "prompt" }, { target: "Regions", source: "ignore" }, { target: "Line Items", source: "headerRow" },
      { target: "Price", source: "none" }, { target: "Batch", source: "numbered" }, { target: "Manager", source: "other", text: "field" }, { target: "Manager", source: "other" },
    ] as MappedTarget[]).map(sourceWords);
    expect(said).toEqual(["Division Name", "Column 4", "Units", "Column with ID f12", "A column the definition neither numbers nor names",
      "Constant: Actual", "Constant, with no value given", "Prompt: chosen each time the import runs", "Ignored", "Header row: each column whose header is a line item's name or code",
      "Not mapped", "Not mapped: the list numbers its items itself", "A source Cardigan does not know (field)", "A source Cardigan does not know"]);
    expect(said.filter(words => NAMES_A_FILE.test(words))).toEqual([]);
  });

  it("says how an import into a list tells its items apart in the dialog's words, which name two choices otherwise for a numbered list", () => {
    expect(([{ by: "nameOrCode" }, { by: "name" }, { by: "name", numbered: true }, { by: "code" }, { by: "code", numbered: true }, { by: "code", numbered: false },
      { by: "properties", properties: ["Product"] }, { by: "properties", properties: ["Product", "Location", "Expiry Date"], numbered: true }, { by: "properties", properties: [] }] as ItemMatch[])
      .map(matchWords)).toEqual(["Items uniquely identified by: Name or code.", "Items uniquely identified by: Name only.", "Items uniquely identified by: Name (#ID).",
      "Items uniquely identified by: Code only.", "Items uniquely identified by: Code.", "Items uniquely identified by: Code only.",
      "Items uniquely identified by: Combination of properties: Product.", "Items uniquely identified by: Combination of properties: Product, Location and Expiry Date.",
      "Items uniquely identified by: Combination of properties, with none chosen."]);
  });

  it("shows the user's import into a numbered list as the dialog does: its items told apart by properties, each column named by its heading", () => {
    // As the user saw it (10 Oct 2026) before this was read right: every column "neither numbers nor names", under a line
    // that said each was named by its heading. The definition names each column by its heading alone.
    const INVENTORY: ImportMapping = { id: "112000000883", name: "DL032 from inventory", importType: "HIERARCHY_DATA",
      matchedBy: { by: "properties", properties: ["Product", "Location", "Production Date"], numbered: true },
      targets: [{ target: "DL032 - Inventory #", source: "numbered" }, { target: "Parent", source: "none" }, { target: "Code", source: "none" },
        column("Product", undefined, "Product"), column("Location", undefined, "Location"), column("Inventory Quantity (U)", undefined, "Qty")] };
    // Each source comes first, with the target it feeds; the targets nothing feeds are no rows, but names in a line.
    expect(mappingView(INVENTORY)).toEqual({ match: "Items uniquely identified by: Combination of properties: Product, Location and Production Date.",
      rows: [["Product", "Product"], ["Location", "Location"], ["Qty", "Inventory Quantity (U)"]],
      lines: ["Not mapped: DL032 - Inventory # (the list numbers its items itself), Parent and Code.",
        "Each column mapped is named by its heading alone, so Cardigan cannot say which columns are not used."] });
    // A mapping without a way to tell items apart, as one into a module, has no such line.
    expect(mappingView({ ...INVENTORY, matchedBy: undefined }).match).toBeUndefined();
  });

  it("names the columns before the last one mapped that no target takes, and says that what follows it is not known", () => {
    const AFTER = (last: number) => `Whether there are columns after column ${last} is not known: Anaplan keeps the import's mapping, not the header row it was made from.`;
    // The user's example: columns 3, 5 and 6 are not used, and the last one mapped is the 7th.
    expect(columnLines([column("Division", 1), column("Parent", 2), column("Code", 4), column("Manager", 7), { target: "Active", source: "none" }]))
      .toEqual(["Columns 3, 5 and 6 are not used.", AFTER(7)]);
    expect(columnLines([column("Division", 1), column("Parent", 3)])).toEqual(["Column 2 is not used.", AFTER(3)]);
    // A column that feeds two targets is used once; a gap of many is said as a run.
    expect(columnLines([column("Products", 2), column("Code", 2), column("Value", 9)])).toEqual(["Columns 1 and 3 to 8 are not used.", AFTER(9)]);
    expect(columnLines([column("Products", 1), column("Time", 2), column("Value", 3)])).toEqual(["Columns 1 to 3 are all used.", AFTER(3)]);
    expect(columnLines([column("Products", 1), column("Value", 2)])).toEqual(["Columns 1 and 2 are both used.", AFTER(2)]);
    expect(columnLines([column("Value", 1)])).toEqual(["Column 1 is used.", AFTER(1)]);
    // A target that names its column by its heading alone could take any column, so the columns no number takes may be used.
    expect(columnLines([column("Products", 1), column("Units", undefined, "Units"), column("Price", 4)]))
      .toEqual(["Columns 2 and 3 are not mapped by number. 1 target names its column by heading alone, and may use them.", AFTER(4)]);
    expect(columnLines([column("Products", 1), column("Units", undefined, "Units"), column("Price", undefined, "Price"), column("Value", 3)]))
      .toEqual(["Column 2 is not mapped by number. 2 targets name their columns by heading alone, and may use it.", AFTER(3)]);
    expect(columnLines([column("Units", undefined, "Units"), column("Price", undefined, "Price")]))
      .toEqual(["Each column mapped is named by its heading alone, so Cardigan cannot say which columns are not used."]);
    // A column given neither place nor heading is not said to be named by its heading, alone or with others.
    expect([columnLines([column("Units"), column("Price", undefined, "Price")]), columnLines([{ target: "Units", source: "column", id: "f12" }])])
      .toEqual([["The definition gives no column's place, so Cardigan cannot say which columns are not used."],
        ["The definition gives no column's place, so Cardigan cannot say which columns are not used."]]);
    expect(columnLines([column("Products", 1), column("Units"), column("Price", undefined, "Price"), column("Value", 4)]))
      .toEqual(["Columns 2 and 3 are not mapped by number. 2 targets give no place for their columns, and may use them.", AFTER(4)]);
    expect(columnLines([column("Products", 1), { target: "Units", source: "column", id: "f12" }, column("Value", 3)]))
      .toEqual(["Column 2 is not mapped by number. 1 target gives no place for its column, and may use it.", AFTER(3)]);
    // A mapping of constants and prompts alone maps no column.
    expect(columnLines([{ target: "Versions", source: "constant", text: "Actual" }, { target: "Products", source: "prompt" }])).toEqual(["No column is mapped."]);
  });

  it("names a target that is not mapped under the mapping, as the list's items' names of a list matched by its code are, and gives it no row", () => {
    // As the export reads the user's import into a numbered list matched by its code (model/import-mappings.test.ts).
    const BY_CODE: ImportMapping = { id: "112000000171", name: "Division by code", importType: "HIERARCHY_DATA",
      targets: [{ target: "Division", source: "none" }, column("Code", 1, "Code"), column("Parent", 2, "Region")] };
    expect(mappingView(BY_CODE)).toEqual({ rows: [["Code", "Code"], ["Region", "Parent"]],
      lines: ["Not mapped: Division.", "Columns 1 and 2 are both used.", "Whether there are columns after column 2 is not known: Anaplan keeps the import's mapping, not the header row it was made from."] });
  });

  it("shows a row of Source and Target for each source and the target it feeds, or what stands in their place", () => {
    const DIVISION: ImportMapping = { id: "112000000001", name: "Division from HQ Network.csv", importType: "HIERARCHY_DATA",
      targets: [column("Division", 1, "Division Name"), column("Parent", 2, "Region"), { target: "Code", source: "none" }] };
    expect(mappingView(DIVISION)).toEqual({ rows: [["Division Name", "Division"], ["Region", "Parent"]],
      lines: ["Not mapped: Code.", "Columns 1 and 2 are both used.", "Whether there are columns after column 2 is not known: Anaplan keeps the import's mapping, not the header row it was made from."] });
    // An import whose definition could not be read says why; one of another kind says what it loads.
    expect(mappingView({ ...DIVISION, importType: "", targets: [], note: "Cardigan could not read this import's mapping." }))
      .toEqual({ rows: [], lines: ["Cardigan could not read this import's mapping."] });
    expect([mappingView({ ...DIVISION, importType: "USERS", targets: [] }).lines, mappingView({ ...DIVISION, importType: "VERSIONS", targets: [] }).lines,
      mappingView({ ...DIVISION, importType: "LINE_ITEM_DEFINITION", targets: [] }).lines, mappingView({ ...DIVISION, importType: "", targets: [] }).lines]).toEqual([
      ["This import loads users. Cardigan lists the mapping of an import into a module or a list."],
      ["This import loads versions. Cardigan lists the mapping of an import into a module or a list."],
      ["This import loads line items into a module. Cardigan lists the mapping of an import into a module or a list."],
      ["This import loads neither a module nor a list. Cardigan lists the mapping of an import into a module or a list."]]);
    expect(mappingView({ ...DIVISION, importType: "MODULE_DATA", targets: [] })).toEqual({ rows: [], lines: ["The import's definition maps no target."] });
    expect(mappingView(undefined)).toEqual({ rows: [], lines: [NO_MAPPING] });
    expect([NO_MAPPING].filter(line => NAMES_A_FILE.test(line))).toEqual([]);
  });

  it("lists the sources first: each column with every target it feeds, those with a place in their order, then constants, prompts, the header row and a source of another kind", () => {
    const MIXED: ImportMapping = { id: "112000000010", name: "Sales", importType: "MODULE_DATA", targets: [
      { target: "Versions", source: "constant", text: "Actual" },
      // Column 4 by its heading alone, in another case: it stands with column 4, said by the header kept with its place.
      column("Discount", undefined, "price"),
      column("Value", 6, "Value"),
      { target: "Line Items", source: "headerRow" },
      column("Products", 4, "Price"),
      column("Regions", 2),
      // A column by its heading alone, of a heading no target gives a place for, and one by its identifier alone.
      column("Units", undefined, "Units"),
      { target: "Channel", source: "prompt" },
      { target: "Region code", source: "column", id: "f12" },
      { target: "Manager", source: "other", text: "field" },
      // Column 2 again: its two targets stand together.
      column("Territory", 2),
      { target: "Active", source: "none" },
    ] };
    expect(mappingView(MIXED)).toEqual({
      rows: [["Column 2", "Regions"], ["Column 2", "Territory"], ["Price", "Discount"], ["Price", "Products"], ["Value", "Value"], ["Units", "Units"],
        ["Column with ID f12", "Region code"], ["Constant: Actual", "Versions"], ["Prompt: chosen each time the import runs", "Channel"],
        [HEADER_ROW_MATCHED, "Line Items"], ["A source Cardigan does not know (field)", "Manager"]],
      lines: ["Not mapped: Active.", HEADER_ROW_UNSTORED, "Columns 1, 3 and 5 are not mapped by number. 3 targets give no place for their columns, and may use them.",
        "Whether there are columns after column 6 is not known: Anaplan keeps the import's mapping, not the header row it was made from."] });
    // Every target is on the page: in a row, or in the line under the mapping.
    const view = mappingView(MIXED);
    const words = [...view.rows.flat(), ...view.lines].join("\n");
    expect(MIXED.targets.filter(target => !words.includes(target.target)).map(target => target.target)).toEqual([]);
  });

  it("shows the user's import into a numbered list of levels: each header with the target it feeds, and the list's items and Parent in the line under them", () => {
    // As the user's IL010 showed on 10 Oct 2026: every column kept by its heading alone, the list told apart by two properties.
    const headings = ["Code", ...[1, 2, 3, 4, 5, 6, 7].flatMap(level => [`Level${level}`, `Level${level}Code`]), "Delete?", "ProcessLevel", "ProcessLevelCode", "TransactionLevel",
      "TransactionLevelCode"];
    const IL010: ImportMapping = { id: "112000000880", name: "IL010 - Product Hierarchy Import", importType: "HIERARCHY_DATA",
      matchedBy: { by: "properties", properties: ["ProcessLevelCode", "TransactionLevelCode"], numbered: true },
      targets: [{ target: "IL010 - Product Hierarchy Import", source: "numbered" }, { target: "Parent", source: "none" }, ...headings.map(heading => column(heading, undefined, heading))] };
    expect(mappingView(IL010)).toEqual({ match: "Items uniquely identified by: Combination of properties: ProcessLevelCode and TransactionLevelCode.",
      rows: headings.map(heading => [heading, heading]),
      lines: ["Not mapped: IL010 - Product Hierarchy Import (the list numbers its items itself) and Parent.",
        "Each column mapped is named by its heading alone, so Cardigan cannot say which columns are not used."] });
  });

  it("shows the headers of the header row mapped by hand, each with its line item, then those ignored, and says the definition keeps no other", () => {
    // As Anaplan keeps an import into a module whose line items come from the header row, two headers mapped to line
    // items by hand and one ignored (model/import-mappings.ts); Price's own column also names its header.
    const BY_HAND: ImportMapping = { id: "112000000020", name: "Rates", importType: "MODULE_DATA", targets: [
      { ...column("Resources #", undefined, "Resource"), items: { byHand: 0, ignored: 0 } },
      { target: "Line Items", source: "headerRow", items: { byHand: 2, ignored: 1 } },
      column("Price", undefined, "Price (EUR)")],
    headers: [{ header: "Price (EUR)", lineItem: "Price" }, { header: "Hours", lineItem: "Hours booked" }, { header: "Notes" }] };
    expect(mappingView(BY_HAND)).toEqual({
      // Price (EUR) is said once, by Price's own column; the header ignored feeds nothing, and stands after the columns.
      rows: [["Resource", "Resources #"], ["Price (EUR)", "Price"], ["Hours", "Hours booked"], ["Notes", "Ignored"],
        [HEADER_ROW_BY_HAND, "Line Items", "Mapped by hand: 2 headers, 1 ignored"]],
      lines: ["Items of Resources # are matched on their names or codes when the import runs.",
        "Anaplan stores the headers mapped by hand; any other header of the header row is not known.",
        "Each column mapped is named by its heading alone, so Cardigan cannot say which columns are not used."] });
  });

  it("says under the header row matched on names or codes the line items a header can match, the first five and how many more, and opens to all", () => {
    const MATCHED: ImportMapping = { id: "112000000021", name: "Resources", importType: "MODULE_DATA", targets: [
      { ...column("MDL3801 - Resources #", undefined, "Resource"), items: { byHand: 0, ignored: 0 } }, { target: "Line Items", source: "headerRow", items: { byHand: 0, ignored: 0 } }] };
    const many = ["Cost", "Hours", "Rate", "Start Date", "End Date", "Notes", "Active"];
    expect(mappingView(MATCHED, many)).toEqual({
      rows: [["Resource", "MDL3801 - Resources #"], [HEADER_ROW_MATCHED, "Line Items", "Line items a header can match: Cost, Hours, Rate, Start Date, End Date and 2 more", many]],
      lines: ["Items of MDL3801 - Resources # are matched on their names or codes when the import runs.", HEADER_ROW_UNSTORED,
        "Each column mapped is named by its heading alone, so Cardigan cannot say which columns are not used."] });
    // Five or fewer are said in full, and with none known the row says nothing more.
    expect(mappingView(MATCHED, ["Cost", "Hours"]).rows[1]).toEqual([HEADER_ROW_MATCHED, "Line Items", "Line items a header can match: Cost and Hours"]);
    expect(mappingView(MATCHED).rows[1]).toEqual([HEADER_ROW_MATCHED, "Line Items"]);
    // With no column but the header row, no line says that no column is mapped: the header row's columns are.
    expect(mappingView({ ...MATCHED, targets: [MATCHED.targets[1]] }).lines).toEqual([HEADER_ROW_UNSTORED]);
  });

  it("says under a source how it is read: items mapped by hand and ignored, Time's period format or names, a date line item's format", () => {
    const READ: ImportMapping = { id: "112000000022", name: "Sales", importType: "MODULE_DATA", targets: [
      { ...column("Products", 1, "Product"), items: { byHand: 3, ignored: 2 } },
      { ...column("Regions", 2, "Region"), items: { byHand: 1, ignored: 0 } },
      { ...column("Time", 3, "Month"), periodFormat: "MMM YY" },
      { ...column("Ship Date", 4, "Shipped"), dateFormat: "DD/MM/YYYY" },
      { ...column("Channel", 5, "Channel"), items: { byHand: 0, ignored: 0 } }] };
    expect(mappingView(READ)).toEqual({ rows: [["Product", "Products", "3 items mapped by hand, 2 ignored"], ["Region", "Regions", "1 item mapped by hand"],
      ["Month", "Time", "Period format: MMM YY"], ["Shipped", "Ship Date", "Date format: DD/MM/YYYY"], ["Channel", "Channel"]],
    lines: ["Items of Channel are matched on their names or codes when the import runs.", "Columns 1 to 5 are all used.",
      "Whether there are columns after column 5 is not known: Anaplan keeps the import's mapping, not the header row it was made from."] });
    expect(mappingView({ ...READ, targets: [{ ...column("Time", 1, "Month"), periodFormat: null }] }).rows).toEqual([["Month", "Time", "Periods matched by their names"]]);
    // No word of these names a file.
    const view = mappingView(READ);
    expect([...view.rows.flat(), ...view.lines, HEADER_ROW_MATCHED, HEADER_ROW_BY_HAND, HEADER_ROW_UNSTORED].filter(words => typeof words === "string" && NAMES_A_FILE.test(words))).toEqual([]);
  });

  it("names in one line the targets nothing feeds, with why where there is more to say, and has no such line where every target has a source", () => {
    expect(unfedLine([{ target: "Batch", source: "numbered" }, column("Code", 1), { target: "Parent", source: "none" }, { target: "Regions", source: "ignore" }]))
      .toBe("Not mapped: Batch (the list numbers its items itself), Parent and Regions (ignored).");
    expect(unfedLine([{ target: "Parent", source: "none" }])).toBe("Not mapped: Parent.");
    expect(unfedLine([column("Code", 1), { target: "Versions", source: "constant", text: "Actual" }, { target: "Products", source: "prompt" }])).toBeUndefined();
    // A mapping that feeds none of its targets has no row: the line names them all.
    expect(mappingView({ id: "112000000011", name: "Nothing", importType: "HIERARCHY_DATA", targets: [{ target: "Parent", source: "none" }, { target: "Code", source: "ignore" }] }))
      .toEqual({ rows: [], lines: ["Not mapped: Parent and Code (ignored).", "No column is mapped."] });
    expect(["Not mapped: Batch (the list numbers its items itself) and Regions (ignored)."].filter(line => NAMES_A_FILE.test(line))).toEqual([]);
  });
});

describe("The mapping of a row of a model's Imports", () => {
  const HEADERS = ["", "Source Label", "Source Object", "Source Type", "Target Object", "Target Type"];
  const ROWS = [
    ["Division from HQ Network.csv", "HQ Network.csv", "-", "FILE", "Division", "LIST"],
    ["Regions from the hub", "Hub / Regions", "Hub / 'LIST - Regions'.Export", "SAVED VIEW", "+ Regions", "LIST"],
    ["Prices", "prices.csv", "-", "FILE", "Prices", "MODULE"],
    ["Prices", "prices (2).csv", "-", "FILE", "Prices", "MODULE"],
    ["Prices", "Hub / Prices", "Hub / Prices.Export", "SAVED VIEW", "Prices", "MODULE"]];
  const IMPORTS: ResultTable = { file: "Imports.csv", label: "Imports", headers: HEADERS, rows: ROWS, guard: false };
  const mapping = (name: string, target: string): ImportMapping => ({ id: "", name, importType: "MODULE_DATA", targets: [column(target, 1)] });
  const MODEL: AnalysisResult = { kind: "model", name: "Model one", id: "0123456789ABCDEF0123456789ABCDEF", zipName: "Model one - Model Export - 2026-10-09.zip", summary: [],
    tables: [IMPORTS], importMappings: [mapping("Division from HQ Network.csv", "Division"), mapping("Prices", "First"), mapping("Prices", "Second")] };
  /** The Imports table as the page shows it, its rows each in its place (result-view.ts `fileView`), and the mapping of each. */
  const shown = (result: AnalysisResult) => {
    const table = fileView(result, IMPORTS).table;
    return table.rows.map(row => mappingOfRow(result, table, row)?.rows[0]?.[1]);
  };

  it("is that of the import of the row's name, among imports of one name the one in the row's place, for a row whose Source Type is FILE alone", () => {
    // The page shows Source Object as three columns, and keeps every row in its place: the mapping is found all the same.
    expect(fileView(MODEL, IMPORTS).table.headers).toContain("Source Model");
    expect(shown(MODEL)).toEqual(["Division", undefined, "First", "Second", undefined]);
    // The rule is the export's: a Source Type that says FILE in another case, or with spaces, reads a file too.
    const cased: AnalysisResult = { ...MODEL, tables: [{ ...IMPORTS, rows: ROWS.map(row => row.map(cell => (cell === "FILE" ? " file " : cell))) }] };
    const table = fileView(cased, cased.tables[0]).table;
    expect(table.rows.map(row => mappingOfRow(cased, table, row)?.rows[0]?.[1])).toEqual(["Division", undefined, "First", "Second", undefined]);
    // Names are told apart without the spaces around them: a row's and a mapping's, whichever has them.
    const spaced: AnalysisResult = { ...MODEL, tables: [{ ...IMPORTS, rows: ROWS.map((row, index) => (index === 3 ? [" Prices ", ...row.slice(1)] : row)) }],
      importMappings: [mapping("Division from HQ Network.csv ", "Division"), mapping("Prices", "First"), mapping(" Prices", "Second")] };
    const spacedTable = fileView(spaced, spaced.tables[0]).table;
    expect(spacedTable.rows.map(row => mappingOfRow(spaced, spacedTable, row)?.rows[0]?.[1])).toEqual(["Division", undefined, "First", "Second", undefined]);
  });

  it("is none for a result without mappings, as one an earlier version kept, or whose mappings are not as they should be, and none outside a model's Imports", () => {
    const { importMappings: _mappings, ...earlier } = MODEL;
    expect(shown(earlier)).toEqual([undefined, undefined, undefined, undefined, undefined]);
    expect(shown({ ...MODEL, importMappings: [{ name: "Prices" }] as never })).toEqual([undefined, undefined, undefined, undefined, undefined]);
    expect(mappingOfRow({ ...MODEL, kind: "app" }, IMPORTS, ROWS[0])).toBeUndefined();
    expect(mappingOfRow(MODEL, { ...IMPORTS, file: "Import Data Sources.csv" }, ROWS[0])).toBeUndefined();
    expect(mappingOfRow(MODEL, { ...IMPORTS, headers: HEADERS.map(header => (header === "Source Type" ? "Kind" : header)) }, ROWS[0])).toBeUndefined();
    expect(mappingOfRow(undefined, IMPORTS, ROWS[0])).toBeUndefined();
  });

  it("knows the line items a header can match by the import's Target Object and the result's Line Items: the module's, but those that hold no data", () => {
    const LINE_ITEMS: ResultTable = { file: "Line Items.csv", label: "Line Items", guard: false, headers: ["", "Format", "Module Name"], rows: [
      ["Prices", "", ""], ["Price", '{"dataType":"NUMBER"}', "Prices"], ["-- Inputs --", '{"dataType":"NONE"}', "Prices"], ["Units", '{"dataType":"NUMBER"}', " Prices "],
      ["Other", '{"dataType":"NUMBER"}', "Costs"]] };
    const HEADER_ROW: ImportMapping = { id: "", name: "Prices", importType: "MODULE_DATA", targets: [{ target: "Line Items", source: "headerRow", items: { byHand: 0, ignored: 0 } }] };
    const withLines: AnalysisResult = { ...MODEL, tables: [IMPORTS, LINE_ITEMS], importMappings: [mapping("Division from HQ Network.csv", "Division"), HEADER_ROW] };
    const table = fileView(withLines, IMPORTS).table;
    expect(lineItemsOf(withLines, table, table.rows[2])).toEqual(["Price", "Units"]);
    expect(mappingOfRow(withLines, table, table.rows[2])?.rows).toEqual([[HEADER_ROW_MATCHED, "Line Items", "Line items a header can match: Price and Units"]]);
    // Where headers are mapped by hand, the line items are not said; nor where the result has no Line Items.
    const byHand: AnalysisResult = { ...withLines, importMappings: [withLines.importMappings![0], { ...HEADER_ROW, headers: [{ header: "Cost", lineItem: "Price" }] }] };
    expect(mappingOfRow(byHand, table, table.rows[2])?.rows).toEqual([["Cost", "Price"], [HEADER_ROW_BY_HAND, "Line Items"]]);
    expect(lineItemsOf(MODEL, table, table.rows[2])).toBeUndefined();
  });

  it("says that it has none where the result has mappings but none for the row's import", () => {
    const few: AnalysisResult = { ...MODEL, importMappings: [mapping("Prices", "First")] };
    const table = fileView(few, IMPORTS).table;
    expect(table.rows.map(row => mappingOfRow(few, table, row))).toEqual([{ rows: [], lines: [NO_MAPPING] }, undefined,
      { rows: [["Column 1", "First"]], lines: ["Column 1 is used.", "Whether there are columns after column 1 is not known: Anaplan keeps the import's mapping, not the header row it was made from."] },
      { rows: [], lines: [NO_MAPPING] }, undefined]);
  });
});
