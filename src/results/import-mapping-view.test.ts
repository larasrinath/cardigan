import { describe, expect, it } from "vitest";
import { readImportMappings } from "../result-plain.js";
import type { AnalysisResult, FileOptions, ImportMapping, ItemMatch, MappedTarget, ResultTable } from "../result-types.js";
import { areaWords, CLEAR_TARGET, columnLines, fileOptionsWords, HEADER_ROW_BY_HAND, HEADER_ROW_MATCHED, lineItemsOf, mappingOfRow, mappingView, matchWords, MISSING_LINE_ITEM_NOTE,
  moduleSourceWords, NO_MAPPING, numbersWords, ONLY_UPDATE, sourceLine, sourceWords, unfedLine } from "./import-mapping-view.js";
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
    // The user's example: columns 3, 5 and 6 are not used, and the last one mapped is the 7th.
    expect(columnLines([column("Division", 1), column("Parent", 2), column("Code", 4), column("Manager", 7), { target: "Active", source: "none" }]))
      .toEqual(["Columns 3, 5 and 6 are not used."]);
    expect(columnLines([column("Division", 1), column("Parent", 3)])).toEqual(["Column 2 is not used."]);
    // A column that feeds two targets is used once; a gap of many is said as a run.
    expect(columnLines([column("Products", 2), column("Code", 2), column("Value", 9)])).toEqual(["Columns 1 and 3 to 8 are not used."]);
    expect(columnLines([column("Products", 1), column("Time", 2), column("Value", 3)])).toEqual(["Columns 1 to 3 are all used."]);
    expect(columnLines([column("Products", 1), column("Value", 2)])).toEqual(["Columns 1 and 2 are both used."]);
    expect(columnLines([column("Value", 1)])).toEqual(["Column 1 is used."]);
    // A target that names its column by its heading alone could take any column, so the columns no number takes may be used.
    expect(columnLines([column("Products", 1), column("Units", undefined, "Units"), column("Price", 4)]))
      .toEqual(["Columns 2 and 3 are not mapped by number. 1 target names its column by heading alone, and may use them."]);
    expect(columnLines([column("Products", 1), column("Units", undefined, "Units"), column("Price", undefined, "Price"), column("Value", 3)]))
      .toEqual(["Column 2 is not mapped by number. 2 targets name their columns by heading alone, and may use it."]);
    expect(columnLines([column("Units", undefined, "Units"), column("Price", undefined, "Price")]))
      .toEqual(["Each column mapped is named by its heading alone, so Cardigan cannot say which columns are not used."]);
    // A column given neither place nor heading is not said to be named by its heading, alone or with others.
    expect([columnLines([column("Units"), column("Price", undefined, "Price")]), columnLines([{ target: "Units", source: "column", id: "f12" }])])
      .toEqual([["The definition gives no column's place, so Cardigan cannot say which columns are not used."],
        ["The definition gives no column's place, so Cardigan cannot say which columns are not used."]]);
    expect(columnLines([column("Products", 1), column("Units"), column("Price", undefined, "Price"), column("Value", 4)]))
      .toEqual(["Columns 2 and 3 are not mapped by number. 2 targets give no place for their columns, and may use them."]);
    expect(columnLines([column("Products", 1), { target: "Units", source: "column", id: "f12" }, column("Value", 3)]))
      .toEqual(["Column 2 is not mapped by number. 1 target gives no place for its column, and may use it."]);
    // A mapping of constants and prompts alone maps no column.
    expect(columnLines([{ target: "Versions", source: "constant", text: "Actual" }, { target: "Products", source: "prompt" }])).toEqual(["No column is mapped."]);
  });

  it("names a target that is not mapped under the mapping, as the list's items' names of a list matched by its code are, and gives it no row", () => {
    // As the export reads the user's import into a numbered list matched by its code (model/import-mappings.test.ts).
    const BY_CODE: ImportMapping = { id: "112000000171", name: "Division by code", importType: "HIERARCHY_DATA",
      targets: [{ target: "Division", source: "none" }, column("Code", 1, "Code"), column("Parent", 2, "Region")] };
    expect(mappingView(BY_CODE)).toEqual({ rows: [["Code", "Code"], ["Region", "Parent"]],
      lines: ["Not mapped: Division.", "Columns 1 and 2 are both used."] });
  });

  it("shows a row of Source and Target for each source and the target it feeds, or what stands in their place", () => {
    const DIVISION: ImportMapping = { id: "112000000001", name: "Division from HQ Network.csv", importType: "HIERARCHY_DATA",
      targets: [column("Division", 1, "Division Name"), column("Parent", 2, "Region"), { target: "Code", source: "none" }] };
    expect(mappingView(DIVISION)).toEqual({ rows: [["Division Name", "Division"], ["Region", "Parent"]],
      lines: ["Not mapped: Code.", "Columns 1 and 2 are both used."] });
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
      lines: ["Not mapped: Active.", "Columns 1, 3 and 5 are not mapped by number. 3 targets give no place for their columns, and may use them."] });
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

  it("shows the headers of the header row mapped manually, each with its line item, then those ignored, and says the definition keeps no other", () => {
    // As Anaplan keeps an import into a module whose line items come from the header row, two headers mapped to line
    // items manually and one ignored (model/import-mappings.ts); Price's own column also names its header.
    const BY_HAND: ImportMapping = { id: "112000000020", name: "Rates", importType: "MODULE_DATA", targets: [
      { ...column("Resources #", undefined, "Resource"), items: { byHand: 0, ignored: 0 } },
      { target: "Line Items", source: "headerRow", items: { byHand: 2, ignored: 1 } },
      column("Price", undefined, "Price (EUR)")],
    headers: [{ header: "Price (EUR)", lineItem: "Price" }, { header: "Hours", lineItem: "Hours booked" }, { header: "Notes" }] };
    expect(mappingView(BY_HAND)).toEqual({
      // Stored headers stand once under the header row, including the pair also held in Price's own mapping.
      rows: [["Resource", "Resources #"],
        [HEADER_ROW_BY_HAND, "Line Items", undefined, undefined, ["Price (EUR) to Price", "Hours to Hours booked", "Notes: Ignored"]]],
      lines: ["Items of Resources # are matched on their names or codes when the import runs.",
        "Each column mapped is named by its heading alone, so Cardigan cannot say which columns are not used."] });
  });

  it("says under the header row matched on names or codes the line items a header can match, the first five and how many more, and opens to all", () => {
    const MATCHED: ImportMapping = { id: "112000000021", name: "Resources", importType: "MODULE_DATA", targets: [
      { ...column("MDL3801 - Resources #", undefined, "Resource"), items: { byHand: 0, ignored: 0 } }, { target: "Line Items", source: "headerRow", items: { byHand: 0, ignored: 0 } }] };
    const many = ["Cost", "Hours", "Rate", "Start Date", "End Date", "Notes", "Active"];
    expect(mappingView(MATCHED, many)).toEqual({
      rows: [["Resource", "MDL3801 - Resources #"], [HEADER_ROW_MATCHED, "Line Items", "Line items a header can match: Cost, Hours, Rate, Start Date, End Date and 2 more", many]],
      lines: ["Items of MDL3801 - Resources # are matched on their names or codes when the import runs.",
        "Each column mapped is named by its heading alone, so Cardigan cannot say which columns are not used."] });
    // Five or fewer are said in full, and with none known the row says nothing more.
    expect(mappingView(MATCHED, ["Cost", "Hours"]).rows[1]).toEqual([HEADER_ROW_MATCHED, "Line Items", "Line items a header can match: Cost and Hours"]);
    expect(mappingView(MATCHED).rows[1]).toEqual([HEADER_ROW_MATCHED, "Line Items"]);
    // With no column but the header row, no line says that no column is mapped: the header row's columns are.
    expect(mappingView({ ...MATCHED, targets: [MATCHED.targets[1]] }).lines).toEqual([]);
  });

  it("keeps a date header's format visible beside its stored hand mapping", () => {
    const mapping: ImportMapping = { id: "45", name: "Load outlook", importType: "MODULE_DATA", targets: [
      { ...column("Start", undefined, "Start Date"), dateFormat: "DD/MM/YYYY" }, { target: "Line Items", source: "headerRow" },
    ], headers: [{ header: "Start Date", lineItem: "Start" }] };
    expect(mappingView(mapping).rows).toEqual([["Start Date", "Start", "Date format: DD/MM/YYYY"],
      [HEADER_ROW_BY_HAND, "Line Items", undefined, undefined, ["Start Date to Start"]]]);
  });

  it("says under a source how it is read: items mapped manually and ignored, Time's period format or names, a date line item's format", () => {
    const READ: ImportMapping = { id: "112000000022", name: "Sales", importType: "MODULE_DATA", targets: [
      { ...column("Products", 1, "Product"), items: { byHand: 3, ignored: 2 } },
      { ...column("Regions", 2, "Region"), items: { byHand: 1, ignored: 0 } },
      { ...column("Time", 3, "Month"), periodFormat: "MMM YY" },
      { ...column("Ship Date", 4, "Shipped"), dateFormat: "DD/MM/YYYY" },
      { ...column("Channel", 5, "Channel"), items: { byHand: 0, ignored: 0 } }] };
    expect(mappingView(READ)).toEqual({ rows: [["Product", "Products", "3 items mapped manually, 2 ignored"], ["Region", "Regions", "1 item mapped manually"],
      ["Month", "Time", "Period format: MMM YY"], ["Shipped", "Ship Date", "Date format: DD/MM/YYYY"], ["Channel", "Channel"]],
    lines: ["Items of Channel are matched on their names or codes when the import runs.", "Columns 1 to 5 are all used."] });
    expect(mappingView({ ...READ, targets: [{ ...column("Time", 1, "Month"), periodFormat: null }] }).rows).toEqual([["Month", "Time", "Periods matched by their names"]]);
    // No word of these names a file.
    const view = mappingView(READ);
    expect([...view.rows.flat(), ...view.lines, HEADER_ROW_MATCHED, HEADER_ROW_BY_HAND].filter(words => typeof words === "string" && NAMES_A_FILE.test(words))).toEqual([]);
  });

  it("says in its last line what a missing line item is, once, where the mapping names one: as a target, a constant, a header's line item or a property", () => {
    // As the export says a line item that the import still maps to and the model doesn't have (model/import-mappings.ts).
    const MISSING: ImportMapping = { id: "112000000030", name: "Load plan", importType: "MODULE_DATA", targets: [
      column("Units", 2), column("Missing line item (ID 3130054)", 3), { target: "Time", source: "constant", text: "Mar 26" }, { target: "Line Items", source: "headerRow" }],
    headers: [{ header: "Display share", lineItem: "Missing line item (ID 6180093)" }, { header: "Comment" }] };
    expect(mappingView(MISSING)).toEqual({ rows: [["Column 2", "Units"], ["Column 3", "Missing line item (ID 3130054)"], ["Constant: Mar 26", "Time"],
      [HEADER_ROW_BY_HAND, "Line Items", undefined, undefined, ["Display share to Missing line item (ID 6180093)", "Comment: Ignored"]]],
    lines: ["Column 1 is not used.", MISSING_LINE_ITEM_NOTE] });
    expect(MISSING_LINE_ITEM_NOTE).toBe("A missing line item is one this import still maps to that the model doesn't have: deleted since the import was saved, or hidden from you.");
    // Each place a name stands says it on its own: a header's line item, a constant, a target nothing feeds, a property.
    const plain: ImportMapping = { ...MISSING, targets: [column("Units", 1)], headers: undefined };
    for (const mapping of [{ ...plain, targets: [...plain.targets, { target: "Line Items", source: "headerRow" }], headers: MISSING.headers } as ImportMapping,
      { ...plain, targets: [...plain.targets, { target: "Line Items", source: "constant", text: "Missing line item (ID 6180093)" }] } as ImportMapping,
      { ...plain, targets: [...plain.targets, { target: "Missing line item (ID 6180093)", source: "none" }] } as ImportMapping,
      { ...plain, importType: "HIERARCHY_DATA", matchedBy: { by: "properties", properties: ["Missing line item (ID 6180093)"] } } as ImportMapping]) {
      expect(mappingView(mapping).lines.filter(line => line === MISSING_LINE_ITEM_NOTE)).toEqual([MISSING_LINE_ITEM_NOTE]);
      expect(mappingView(mapping).lines.at(-1)).toBe(MISSING_LINE_ITEM_NOTE);
    }
    // A column's heading or a header is the file's own text, and a mapping that names no missing line item has no such line.
    expect(mappingView({ ...plain, targets: [column("Units", 1, "Missing line item (ID 6180093)"), { target: "Line Items", source: "headerRow" }],
      headers: [{ header: "Missing line item (ID 3130054)", lineItem: "Units" }] }).lines).toEqual(["Column 1 is used."]);
    expect(mappingView(plain).lines).toEqual(["Column 1 is used."]);
    expect([MISSING_LINE_ITEM_NOTE].filter(line => NAMES_A_FILE.test(line))).toEqual([]);
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

/** File Options as the export keeps them from an import's data source: the live import's, which the owner read in Anaplan's
 * dialog (encoding ISO-8859-1, a comma between columns, '"' around text, a decimal dot, headers in row 1, data from row 2). */
const OPTIONS: FileOptions = { encoding: "ISO-8859-1", separators: ",", delimiter: "\"", decimal: ".", headerRow: 1, firstDataRow: 2 };
/** An import into a module shaped as that live import, with invented names: Time from a column kept by its heading, read
 * by a period format; a list prompted each run; the line items from the header row, three headers mapped manually; the
 * import clears its target first, and each dimension fed by a column or the header row has its clear choice. */
const JOINERS: ImportMapping = { id: "112000000051", name: "Load joiners", sourceType: "FILE", importType: "MODULE_DATA", clear: "clear", fileOptions: OPTIONS, targets: [
  { target: "Time", source: "column", text: "Time", kind: "time", area: "MATCHED_ITEMS", periodFormat: "M-Y" },
  { target: "Join Band", source: "prompt", kind: "list" },
  { target: "Line Items", source: "headerRow", kind: "lineItems", area: "MAPPED_ITEMS_IN_SOURCE", items: { byHand: 3, ignored: 0 } }],
headers: [{ header: "Bonus Rate", lineItem: "Bonus Rate" }, { header: "Band start", lineItem: "Band start" }, { header: "Band end", lineItem: "Band end" }] };

describe("An import into a module, laid out as Anaplan's import dialog lays it out", () => {
  it("shows the live import's shape as the owner chose: what it clears, how its file is read, its dimensions, then its line items", () => {
    expect(mappingView(JOINERS)).toEqual({ clear: "Clear target prior to import", rows: [],
      from: { label: "File", text: 'Header row 1 · data from row 2 · Comma · " · Dot · ISO-8859-1' },
      // DIMENSION, SOURCE, ITEMS and CLEAR, in the definition's order. The prompted list has nothing more to say.
      dimensions: [["Time", "Column: Time", "Periods, M-Y", "Matched items only"], ["Join Band", "Prompt each run", "", ""],
        ["Line Items", "Header row", "Mapped manually", "Mapped items in source"]],
      // LINE ITEMS (3): each header with the line item it is mapped to.
      lineItems: { count: 3, heading: "Header", rows: [["Bonus Rate", "Bonus Rate"], ["Band start", "Band start"], ["Band end", "Band end"]], notes: [] },
      lines: ["Each column mapped is named by its heading alone, so Cardigan cannot say which columns are not used."] });
    // An ignored header says so, and is counted among the rows.
    const ignored = mappingView({ ...JOINERS, targets: JOINERS.targets.map(target => (target.kind === "lineItems" ? { ...target, items: { byHand: 3, ignored: 1 } } : target)),
      headers: [...JOINERS.headers!, { header: "Comment" }] });
    expect([ignored.dimensions?.[2][2], ignored.lineItems?.count, ignored.lineItems?.rows.at(-1)]).toEqual(["Mapped manually", 4, ["Comment", "Ignored"]]);
    expect(CLEAR_TARGET).toBe("Clear target prior to import");
  });

  it("leaves every dimension's clear choice empty where the import only updates imported cells, as the dialog hides them then", () => {
    const view = mappingView({ ...JOINERS, clear: "update" });
    expect([view.clear, view.dimensions?.map(row => row[3])]).toEqual([ONLY_UPDATE, ["", "", ""]]);
    expect(ONLY_UPDATE).toBe("Only update imported cells");
    // A result that says nothing of what the import clears says nothing of it.
    expect(mappingView({ ...JOINERS, clear: undefined }).clear).toBeUndefined();
  });

  it("says each clear choice in the dialog's words, Time's matched items its own way, and a word the dialog has no label for as it is", () => {
    expect(["MATCHED_ITEMS", "MAPPED_ITEMS_IN_SOURCE", "ALL_MAPPED_ITEMS", "ALL_ITEMS", "SOME_NEW_AREA"].map(area => [areaWords(area), areaWords(area, true)])).toEqual([
      ["Matched items in source", "Matched items only"], ["Mapped items in source", "Mapped items in source"], ["All mapped items", "All mapped items"],
      ["All items", "All items"], ["SOME_NEW_AREA", "SOME_NEW_AREA"]]);
    // Each in its dimension's row.
    const areas = mappingView({ ...JOINERS, targets: [{ ...JOINERS.targets[0], area: "ALL_ITEMS" }, { target: "Join Band", source: "column", column: 2, kind: "list",
      area: "ALL_MAPPED_ITEMS", items: { byHand: 1, ignored: 0 } }, { ...JOINERS.targets[2], area: "MATCHED_ITEMS" }] });
    expect(areas.dimensions?.map(row => row[3])).toEqual(["All items", "All mapped items", "Matched items in source"]);
  });

  it("lists line items fed by columns of their own, each by its place, its heading or both, with its date format", () => {
    // Headers the export keeps for a line item's own column too: said once, by the column.
    const RATES: ImportMapping = { id: "112000000061", name: "Load rates", sourceType: "FILE", importType: "MODULE_DATA", clear: "update", targets: [
      { target: "Staff", source: "column", column: 1, text: "Employee", kind: "list", area: "ALL_ITEMS", items: { byHand: 0, ignored: 0 } },
      { target: "Line Items", source: "headerRow", kind: "lineItems", items: { byHand: 0, ignored: 0 } },
      { target: "Hours", source: "column", column: 3, kind: "lineItem" },
      { target: "Rate", source: "column", text: "Rate (EUR)", kind: "lineItem" },
      { target: "Start Date", source: "column", column: 5, text: "Start", kind: "lineItem", dateFormat: "DD/MM/YYYY" }],
    headers: [{ header: "Rate (EUR)", lineItem: "Rate" }, { header: "start", lineItem: "Start Date" }] };
    expect(mappingView(RATES)).toEqual({ clear: ONLY_UPDATE, rows: [],
      dimensions: [["Staff", "Column 1: Employee", "Matched on names or codes", ""], ["Line Items", "Header row", "Matched on names or codes", ""]],
      lineItems: { count: 3, heading: "Column", notes: [], rows: [["Column 3", "Hours"], ["Column: Rate (EUR)", "Rate"], ["Column 5: Start", "Start Date", "Date format: DD/MM/YYYY"]] },
      lines: ["Items set to match on names or codes are paired when the import runs, so Anaplan saves no pairs for them.",
        "Columns 2 and 4 are not mapped by number. 1 target names its column by heading alone, and may use them."] });
    // A header mapped manually that no line item's column says stands among them: the table's heading says both.
    const both = mappingView({ ...RATES, headers: [...RATES.headers!, { header: "Overtime", lineItem: "Overtime hours" }] }).lineItems;
    expect([both?.heading, both?.rows.at(-1), both?.count]).toEqual(["Source", ["Overtime", "Overtime hours"], 4]);
  });

  it("says the header row that holds Time's periods as periods, and has no line items a header can match", () => {
    const BY_PERIOD: ImportMapping = { id: "112000000062", name: "Load monthly units", sourceType: "FILE", importType: "MODULE_DATA", clear: "clear", targets: [
      { target: "Products", source: "column", column: 1, text: "Product", kind: "list", area: "ALL_ITEMS", items: { byHand: 2, ignored: 1 } },
      { target: "Time", source: "headerRow", kind: "time", area: "MATCHED_ITEMS", periodFormat: "MMM YY" },
      { target: "Line Items", source: "constant", text: "Units", kind: "lineItems" }] };
    const view = mappingView(BY_PERIOD, ["Units", "Price"]);
    // Time comes first, as the dialog lists it, though the definition maps Products before it.
    expect(view).toEqual({ clear: CLEAR_TARGET, rows: [],
      dimensions: [["Time", "Header row", "Periods, MMM YY", "Matched items only"], ["Products", "Column 1: Product", "Mapped manually: 2 items, 1 ignored", "All items"],
        ["Line Items", "Fixed: Units", "", ""]],
      // A constant feeding the line items says so, in the dialog's words.
      lineItems: { rows: [], notes: [{ text: "Fixed line item: Units. Every value loads into it." }] },
      lines: ["The periods are in the header row.", "Column 1 is used."] });
    expect(JSON.stringify(view)).not.toContain("a header can match");
    // Time's periods matched by their names.
    expect(mappingView({ ...BY_PERIOD, targets: [{ ...BY_PERIOD.targets[1], periodFormat: null }] }).dimensions).toEqual([["Time", "Header row", "Periods matched by their names", "Matched items only"]]);
    // A result an earlier version kept says the header row of Time so too, under its source, and no line item under it.
    const earlier = mappingView({ ...BY_PERIOD, sourceType: undefined, clear: undefined, targets: [{ target: "Time", source: "headerRow" }] }, ["Units", "Price"]);
    expect(earlier).toEqual({ rows: [["Header row: the periods", "Time"]], lines: [] });
  });

  it("says the header row that holds a list's items as that list's, and a column of line items with its items mapped manually", () => {
    const BY_REGION: ImportMapping = { id: "112000000063", name: "Load regional sales", sourceType: "FILE", importType: "MODULE_DATA", clear: "clear", targets: [
      { target: "Time", source: "column", column: 1, text: "Month", kind: "time", periodFormat: null },
      { target: "Regions", source: "headerRow", kind: "list", area: "MATCHED_ITEMS", items: { byHand: 0, ignored: 0 } },
      { target: "Line Items", source: "column", column: 2, text: "Measure", kind: "lineItems", area: "MATCHED_ITEMS", items: { byHand: 1, ignored: 1 } }] };
    expect(mappingView(BY_REGION, ["Units"])).toEqual({ clear: CLEAR_TARGET, rows: [],
      dimensions: [["Time", "Column 1: Month", "Periods matched by their names", ""], ["Regions", "Header row", "Matched on names or codes", "Matched items in source"],
        ["Line Items", "Column 2: Measure", "Mapped manually: 1 item, 1 ignored", "Matched items in source"]],
      lines: ["The items of Regions are in the header row.", "Items set to match on names or codes are paired when the import runs, so Anaplan saves no pairs for them.",
        "Columns 1 and 2 are both used."] });
    // A result an earlier version kept says it under the source.
    expect(sourceWords({ target: "Regions", source: "headerRow" })).toBe("Header row: the items of Regions");
  });

  it("names under the header row of line items matched on names or codes the line items a header can match, as possibilities, and the column of values where each row names its line item", () => {
    const MATCHED: ImportMapping = { ...JOINERS, fileOptions: undefined, headers: undefined, targets: [JOINERS.targets[0],
      { target: "Line Items", source: "headerRow", kind: "lineItems", items: { byHand: 0, ignored: 0 } }] };
    const many = ["Cost", "Hours", "Rate", "Start Date", "End Date", "Notes", "Active"];
    expect(mappingView(MATCHED, many).lineItems).toEqual({ count: 7, rows: [], notes: [{ text: "Line items a header can match: Cost, Hours, Rate, Start Date, End Date and 2 more", all: many }] });
    expect(mappingView(MATCHED, ["Cost", "Hours"]).lineItems).toEqual({ count: 2, rows: [], notes: [{ text: "Line items a header can match: Cost and Hours" }] });
    // Where the page knows none, the row of the line items says all there is.
    expect(mappingView(MATCHED).lineItems).toBeUndefined();
    // Each row names its line item, and one column holds the values: the dialog's Data values from. A line item's own
    // mapping that is not mapped is no row then: the dialog keeps none of them in such an import.
    const SINGLE: ImportMapping = { ...MATCHED, targets: [{ target: "Line Items", source: "column", column: 3, text: "Measure", kind: "lineItems", items: { byHand: 0, ignored: 0 } },
      { target: "Units", source: "none", kind: "lineItem" }, { target: "Value", source: "column", column: 5, text: "Amount", kind: "value" }] };
    expect(mappingView(SINGLE).lineItems).toEqual({ rows: [], notes: [{ text: "Data values from Column 5: Amount" }] });
    // Without one, a line item not mapped is a row of its own.
    expect(mappingView({ ...SINGLE, targets: SINGLE.targets.slice(0, 2) }).lineItems).toEqual({ count: 1, heading: "Column", rows: [["Not mapped", "Units"]], notes: [] });
  });

  it("says what feeds a dimension in the dialog's words: a column by its place and heading, the header row, a prompt, a fixed item, not applicable, not mapped", () => {
    expect(([column("A", 3, "Price"), column("A", undefined, "Price"), column("A", 3), { target: "A", source: "column", id: "f12" }, column("A"),
      { target: "A", source: "headerRow" }, { target: "A", source: "prompt" }, { target: "A", source: "constant", text: "Actual" }, { target: "A", source: "constant" },
      { target: "A", source: "ignore" }, { target: "A", source: "none" }, { target: "A", source: "other", text: "field" }] as MappedTarget[]).map(moduleSourceWords)).toEqual([
      "Column 3: Price", "Column: Price", "Column 3", "Column with ID f12", "A column the definition neither numbers nor names", "Header row", "Prompt each run",
      "Fixed: Actual", "Fixed, with no value given", "Not applicable", "Not mapped", "A source Cardigan does not know (field)"]);
    // Not mapped and not applicable stand in the table, not in a line under it, each dimension in the dialog's order.
    const unfed = mappingView({ ...JOINERS, targets: [...JOINERS.targets, { target: "Channels", source: "ignore", kind: "list" }, { target: "Versions", source: "none", kind: "versions" }] });
    expect([unfed.dimensions?.slice(2, 4), unfed.lines.some(line => line.startsWith("Not mapped:"))]).toEqual([[["Channels", "Not applicable", "", ""], ["Versions", "Not mapped", "", ""]], false]);
  });

  it("says the File Options in plain words, each separator and delimiter by its name or as itself, and an unusual one with what it is", () => {
    expect(fileOptionsWords(OPTIONS)).toBe('Header row 1 · data from row 2 · Comma · " · Dot · ISO-8859-1');
    const words = (options: FileOptions) => fileOptionsWords(options);
    expect(["\t", ",", ";", "|", " ", ",\t", "\t,;|", ";;", "", "\u001f"].map(separators => words({ separators }))).toEqual(["Tab", "Comma", "Semicolon", "|", "Space",
      "Comma and Tab", "Tab, Comma, Semicolon and |", "Semicolon", "No column separator", "U+001F"]);
    expect(["\"", "'", "", "\u0000", "~"].map(delimiter => words({ delimiter }))).toEqual(['"', "'", "no text delimiter", "no text delimiter", "~ as text delimiter"]);
    expect([".", ",", "_"].map(decimal => words({ decimal }))).toEqual(["Dot", "Comma", "_ as decimal separator"]);
    expect([words({ headerRow: 0, firstDataRow: 1 }), words({ firstDataRow: 3 }), words({ encoding: "  ", headerRow: 2 }), words({ encoding: "UTF-16LE" })])
      .toEqual(["No header row · data from row 1", "Data from row 3", "Header row 2", "UTF-16LE"]);
  });

  it("keeps an import into a list as it is, with its File line where its File Options were read", () => {
    const DIVISION: ImportMapping = { id: "112000000001", name: "Division from HQ Network.csv", sourceType: "FILE", importType: "HIERARCHY_DATA",
      targets: [column("Division", 1, "Division Name"), column("Parent", 2, "Region"), { target: "Code", source: "none" }] };
    const withFile = mappingView({ ...DIVISION, fileOptions: { ...OPTIONS, separators: "\t" } });
    expect(withFile).toEqual({ ...mappingView(DIVISION), from: { label: "File", text: 'Header row 1 · data from row 2 · Tab · " · Dot · ISO-8859-1' } });
    expect(withFile).toEqual({ from: withFile.from, rows: [["Division Name", "Division"], ["Region", "Parent"]], lines: ["Not mapped: Code.", "Columns 1 and 2 are both used."] });
  });

  it("names the object an import of a model's object reads in place of the File line, and says nothing of the columns it does not use", () => {
    const HUB: ImportMapping = { id: "112000000002", name: "Regions from the hub", sourceType: "SAVED VIEW", importType: "HIERARCHY_DATA",
      targets: [{ target: "+ Regions", source: "column", text: "Region" }] };
    expect(mappingView(HUB, undefined, "Model: Hub · Module: LIST - Regions · Saved view: Export")).toEqual({ from: { label: "Source", text: "Model: Hub · Module: LIST - Regions · Saved view: Export" },
      rows: [["Region", "+ Regions"]], lines: [] });
    // An import of a module into a module, laid out as any import into a module is.
    const STAFF: ImportMapping = { id: "112000000058", name: "Bands from staff costs", sourceType: "MODULE", importType: "MODULE_DATA", clear: "update", targets: [
      { target: "Time", source: "column", text: "Time", kind: "time" }, { target: "Join Band", source: "column", text: "Join Band", kind: "list", area: "ALL_ITEMS" },
      { target: "Line Items", source: "headerRow", kind: "lineItems" }, { target: "Bonus Rate", source: "column", text: "Bonus paid", kind: "lineItem" },
      { target: "Band end", source: "column", text: "ID 1901000000099", kind: "lineItem" }],
    headers: [{ header: "Bonus paid", lineItem: "Bonus Rate" }, { header: "ID 1901000000099", lineItem: "Band end" }] };
    expect(mappingView(STAFF, undefined, "Model: Invented plan · Module: PLN08 Staff Costs")).toEqual({ clear: ONLY_UPDATE, rows: [],
      from: { label: "Source", text: "Model: Invented plan · Module: PLN08 Staff Costs" },
      dimensions: [["Time", "Column: Time", "", ""], ["Join Band", "Column: Join Band", "", ""], ["Line Items", "Header row", "", ""]],
      lineItems: { count: 2, heading: "Column", notes: [], rows: [["Column: Bonus paid", "Bonus Rate"], ["Column: ID 1901000000099", "Band end"]] }, lines: [] });
  });

  it("orders the dimensions as the dialog does: Time, then the lists in the definition's order, then Versions, then the line items", () => {
    // A definition that maps the line items first, as one live import did, and Versions before Time.
    const FIRST: ImportMapping = { id: "112000000071", name: "Load targets", sourceType: "FILE", importType: "MODULE_DATA", clear: "clear", targets: [
      { target: "Line Items", source: "headerRow", kind: "lineItems", items: { byHand: 0, ignored: 0 } },
      { target: "Versions", source: "constant", text: "Plan", kind: "versions" },
      { target: "Sales Region", source: "column", column: 2, kind: "list", items: { byHand: 0, ignored: 0 } },
      { target: "Units", source: "column", column: 5, kind: "lineItem" },
      { target: "Time", source: "column", column: 1, kind: "time", periodFormat: null },
      { target: "somethingNew", source: "none", kind: "other" },
      { target: "Channel", source: "prompt", kind: "list" }] };
    expect(mappingView(FIRST).dimensions?.map(row => row[0])).toEqual(["Time", "Sales Region", "somethingNew", "Channel", "Versions", "Line Items"]);
    // In the dialog's order already, it stays as it is.
    expect(mappingView(JOINERS).dimensions?.map(row => row[0])).toEqual(["Time", "Join Band", "Line Items"]);
  });

  /** An import into a module with a list whose items are mapped manually, three and one ignored, as the export keeps it
   * (model/import-mappings.ts): the counts alone; another list matched on names or codes; and a header mapped manually to
   * its line item. Every name and ID is made up. */
  const DIVISIONS: ImportMapping = { id: "112000000072", name: "Load division costs", sourceType: "FILE", importType: "MODULE_DATA", clear: "clear", targets: [
    { target: "Line Items", source: "headerRow", kind: "lineItems", items: { byHand: 1, ignored: 0 } },
    { target: "Division", source: "column", column: 1, text: "Division", kind: "list", area: "ALL_ITEMS", items: { byHand: 3, ignored: 1 } },
    { target: "Time", source: "column", column: 2, text: "Month", kind: "time", periodFormat: "MMM YY" },
    { target: "Products", source: "column", column: 3, text: "Product", kind: "list", items: { byHand: 0, ignored: 0 } }],
  headers: [{ header: "Cost (EUR)", lineItem: "Cost" }] };

  it("says how many of a list's items are mapped manually, in its row of the dimensions, and lists none of them: only the line items, pair by pair", () => {
    const view = mappingView(DIVISIONS);
    // The list stands in the dimensions table with its count words; the line items' table lists the header with its line
    // item; and nothing more: no section of the list's items.
    expect(view).toEqual({ clear: CLEAR_TARGET, rows: [],
      dimensions: [["Time", "Column 2: Month", "Periods, MMM YY", ""], ["Division", "Column 1: Division", "Mapped manually: 3 items, 1 ignored", "All items"],
        ["Products", "Column 3: Product", "Matched on names or codes", ""], ["Line Items", "Header row", "Mapped manually", ""]],
      lineItems: { count: 1, heading: "Header", rows: [["Cost (EUR)", "Cost"]], notes: [] },
      lines: ["Items set to match on names or codes are paired when the import runs, so Anaplan saves no pairs for them.", "Columns 1 to 3 are all used."] });
    // The same import as 0.38.0 kept it, with the list's pairs, the list's ID and the module's, read as the page reads a
    // result's mappings (`mappingOfRow`): shown just as this version's.
    const kept = readImportMappings([{ ...DIVISIONS, moduleId: "102000000041", targets: DIVISIONS.targets.map(target => (target.target !== "Division" ? target
      : { ...target, dimensionId: "101000000041", pairs: [{ source: "North", item: "201000000011" }, { source: "Old office" }] })) }]);
    expect(kept?.map(mapping => mappingView(mapping))).toEqual([view]);
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
    // Where headers are mapped manually, the line items are not said; nor where the result has no Line Items.
    const byHand: AnalysisResult = { ...withLines, importMappings: [withLines.importMappings![0], { ...HEADER_ROW, headers: [{ header: "Cost", lineItem: "Price" }] }] };
    expect(mappingOfRow(byHand, table, table.rows[2])?.rows).toEqual([[HEADER_ROW_BY_HAND, "Line Items", undefined, undefined, ["Cost to Price"]]]);
    expect(lineItemsOf(MODEL, table, table.rows[2])).toBeUndefined();
  });

  it("is that of the import of the row's name and Source Type where the result keeps every import's, and names the object an import of a model's object reads", () => {
    const listed = (name: string, sourceType: string, target: string): ImportMapping => ({ id: "", name, sourceType, importType: "HIERARCHY_DATA", targets: [column(target, 1)] });
    const EVERY: AnalysisResult = { ...MODEL, importMappings: [listed("Division from HQ Network.csv", "FILE", "Division"),
      { ...listed("Regions from the hub", "SAVED VIEW", "Regions"), targets: [{ target: "Regions", source: "column", text: "Region" }] },
      listed("Prices", "FILE", "First"), listed("Prices", " file ", "Second"), listed("Prices", "SAVED VIEW", "Third")] };
    const table = fileView(EVERY, IMPORTS).table;
    // Each row has its own, among imports of one name by its Source Type and its place, the Source Type told in any case.
    expect(table.rows.map(row => mappingOfRow(EVERY, table, row)?.rows[0]?.[1])).toEqual(["Division", "Regions", "First", "Second", "Third"]);
    // The import of a saved view names the object it reads as its row does, in the File line's place, and says nothing of
    // its columns' places: the object has none.
    expect(mappingOfRow(EVERY, table, table.rows[1])).toEqual({ from: { label: "Source", text: "Model: Hub · Module: LIST - Regions · Saved view: Export" },
      rows: [["Region", "Regions"]], lines: [] });
    expect([sourceLine(table, table.rows[0]), sourceLine(table, table.rows[4])]).toEqual([undefined, "Model: Hub · Module: Prices · Saved view: Export"]);
    // An import of a list names it as the cell writes it.
    const list = { ...IMPORTS, rows: [["Regions list", "Hub / G1 Regions", "Hub / G1 Regions", "LIST", "Regions", "LIST"]] };
    const listTable = fileView({ ...EVERY, tables: [list] }, list).table;
    expect(sourceLine(listTable, listTable.rows[0])).toBe("List: Hub / G1 Regions");
    // A row without a Source Type, as one of an import the Actions list has and the Imports tab did not give, has none.
    const blank = { ...IMPORTS, rows: [...ROWS, ["Only in Actions", "", "", "", "", ""]] };
    const blankTable = fileView({ ...EVERY, tables: [blank] }, blank).table;
    expect(mappingOfRow({ ...EVERY, tables: [blank] }, blankTable, blankTable.rows[5])).toBeUndefined();
  });

  it("says that it has none where the result has mappings but none for the row's import", () => {
    const few: AnalysisResult = { ...MODEL, importMappings: [mapping("Prices", "First")] };
    const table = fileView(few, IMPORTS).table;
    // The mappings of a result an earlier version kept are those of imports from a file: a row of another Source Type has
    // none either, and its details say to run again, which reads it.
    expect(table.rows.map(row => mappingOfRow(few, table, row))).toEqual([{ rows: [], lines: [NO_MAPPING] }, { rows: [], lines: [NO_MAPPING] },
      { rows: [["Column 1", "First"]], lines: ["Column 1 is used."] },
      { rows: [], lines: [NO_MAPPING] }, { rows: [], lines: [NO_MAPPING] }]);
  });
});
