import { describe, expect, it } from "vitest";
import type { AnalysisResult, ImportMapping, MappedTarget, ResultTable } from "../result-types.js";
import { columnLines, mappingOfRow, mappingView, NO_MAPPING, numbersWords, sourceWords } from "./import-mapping-view.js";
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
      column("Division", 1, "Division Name"), column("Code", 4), column("Units", undefined, "Units"), column("Odd"),
      { target: "Versions", source: "constant", text: "Actual" }, { target: "Versions", source: "constant" },
      { target: "Products", source: "prompt" }, { target: "Regions", source: "ignore" }, { target: "Line Items", source: "headerRow" },
      { target: "Price", source: "none" }, { target: "Manager", source: "other", text: "field" }, { target: "Manager", source: "other" },
    ] as MappedTarget[]).map(sourceWords);
    expect(said).toEqual(["Column 1: Division Name", "Column 4", "Column headed Units", "A column the definition neither numbers nor names", "Constant: Actual",
      "Constant, with no value given", "Prompt: chosen each time the import runs", "Ignored", "Header row: each line item from the column it heads", "Not mapped",
      "A source Cardigan does not know (field)", "A source Cardigan does not know"]);
    expect(said.filter(words => NAMES_A_FILE.test(words))).toEqual([]);
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
    // A mapping of constants and prompts alone maps no column.
    expect(columnLines([{ target: "Versions", source: "constant", text: "Actual" }, { target: "Products", source: "prompt" }])).toEqual(["No column is mapped."]);
  });

  it("shows a target that is not mapped as Not mapped, as the list's items' names of a list matched by its code are", () => {
    // As the export reads the user's import into a numbered list matched by its code (model/import-mappings.test.ts).
    const BY_CODE: ImportMapping = { id: "112000000171", name: "Division by code", importType: "HIERARCHY_DATA",
      targets: [{ target: "Division", source: "none" }, column("Code", 1, "Code"), column("Parent", 2, "Region")] };
    expect(mappingView(BY_CODE)).toEqual({ rows: [["Division", "Not mapped"], ["Code", "Column 1: Code"], ["Parent", "Column 2: Region"]],
      lines: ["Columns 1 and 2 are both used.", "Whether there are columns after column 2 is not known: Anaplan keeps the import's mapping, not the header row it was made from."] });
  });

  it("shows a row of Target and Source for each target, or what stands in their place", () => {
    const DIVISION: ImportMapping = { id: "112000000001", name: "Division from HQ Network.csv", importType: "HIERARCHY_DATA",
      targets: [column("Division", 1, "Division Name"), column("Parent", 2, "Region"), { target: "Code", source: "none" }] };
    expect(mappingView(DIVISION)).toEqual({ rows: [["Division", "Column 1: Division Name"], ["Parent", "Column 2: Region"], ["Code", "Not mapped"]],
      lines: ["Columns 1 and 2 are both used.", "Whether there are columns after column 2 is not known: Anaplan keeps the import's mapping, not the header row it was made from."] });
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
    return table.rows.map(row => mappingOfRow(result, table, row)?.rows[0]?.[0]);
  };

  it("is that of the import of the row's name, among imports of one name the one in the row's place, for a row whose Source Type is FILE alone", () => {
    // The page shows Source Object as three columns, and keeps every row in its place: the mapping is found all the same.
    expect(fileView(MODEL, IMPORTS).table.headers).toContain("Source Model");
    expect(shown(MODEL)).toEqual(["Division", undefined, "First", "Second", undefined]);
    // The rule is the export's: a Source Type that says FILE in another case, or with spaces, reads a file too.
    const cased: AnalysisResult = { ...MODEL, tables: [{ ...IMPORTS, rows: ROWS.map(row => row.map(cell => (cell === "FILE" ? " file " : cell))) }] };
    const table = fileView(cased, cased.tables[0]).table;
    expect(table.rows.map(row => mappingOfRow(cased, table, row)?.rows[0]?.[0])).toEqual(["Division", undefined, "First", "Second", undefined]);
    // Names are told apart without the spaces around them: a row's and a mapping's, whichever has them.
    const spaced: AnalysisResult = { ...MODEL, tables: [{ ...IMPORTS, rows: ROWS.map((row, index) => (index === 3 ? [" Prices ", ...row.slice(1)] : row)) }],
      importMappings: [mapping("Division from HQ Network.csv ", "Division"), mapping("Prices", "First"), mapping(" Prices", "Second")] };
    const spacedTable = fileView(spaced, spaced.tables[0]).table;
    expect(spacedTable.rows.map(row => mappingOfRow(spaced, spacedTable, row)?.rows[0]?.[0])).toEqual(["Division", undefined, "First", "Second", undefined]);
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

  it("says that it has none where the result has mappings but none for the row's import", () => {
    const few: AnalysisResult = { ...MODEL, importMappings: [mapping("Prices", "First")] };
    const table = fileView(few, IMPORTS).table;
    expect(table.rows.map(row => mappingOfRow(few, table, row))).toEqual([{ rows: [], lines: [NO_MAPPING] }, undefined,
      { rows: [["First", "Column 1"]], lines: ["Column 1 is used.", "Whether there are columns after column 1 is not known: Anaplan keeps the import's mapping, not the header row it was made from."] },
      { rows: [], lines: [NO_MAPPING] }, undefined]);
  });
});
