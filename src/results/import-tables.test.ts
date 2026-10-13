import { describe, expect, it } from "vitest";
import type { AnalysisResult, Cell, ImportMapping, ResultTable } from "../result-types.js";
import { columnsOf } from "./columns.js";
import { FILE_IMPORTS_FILE, IMPORT_TABLES, IN_MODEL_IMPORTS_FILE, MODEL_IMPORTS_FILE, importTableOf, resultFileOf } from "./import-files.js";
import { mappingOfRow, sourceLine } from "./import-mapping-view.js";
import { fileRowOf, importSplit, importSplitLine, importTables, mappingsByRow } from "./import-tables.js";
import { fileWords } from "./no-file.test-support.js";
import { fileView, listedTables, overviewOf } from "./result-view.js";

// A model's Imports file as the export writes it (model/actions.ts `mergeImports`): the Imports tab's columns, then the
// Actions list's. Every name and ID is made up.
const HEADERS = ["", "Source Label", "Source Object", "Source Type", "Target Object", "Target Type", "Production Data", "Start Date and Time (UTC)",
  "Most recent duration (ms)", "Notes", "Used in Processes", "Used in Dashboards"];
/** An import's row: its name, its Source Label, Source Object and Source Type, and its target; the rest as an import has it. */
const row = (name: string, label: string, object: string, type: string, target = "PRI01 Prices"): Cell[] =>
  [name, label, object, type, target, "MODULE", "false", "2026-10-05 06:00:14", "2210", "", "Nightly load", ""];
const imports = (rows: Cell[][], headers = HEADERS): ResultTable => ({ file: "Imports.csv", label: "Imports", headers, rows, guard: false });
const DETAILS: ResultTable = { file: "Model Details.csv", label: "Model Details", headers: ["Section", "Detail", "Value"], rows: [], guard: true, details: true };
const model = (file: ResultTable, importMappings?: ImportMapping[], name = "Invented plan"): AnalysisResult => ({
  kind: "model", name, id: "1234567890ABCDEF1234567890ABCDEF", zipName: "x.zip", summary: [], tables: [DETAILS, file], ...(importMappings ? { importMappings } : {}) });
/** A mapping as the export reads one, which says whether its source is this model's where its data source was read. */
const mapping = (name: string, sourceType: string, target: string, sourceInThisModel?: boolean): ImportMapping => ({
  id: "", name, sourceType, importType: "MODULE_DATA", targets: [{ target, source: "column", column: 1 }], ...(sourceInThisModel === undefined ? {} : { sourceInThisModel }) });

/** Imports of every kind, each with how it is to be placed. */
const ROWS: [row: Cell[], kind: string, toldBy: string][] = [
  [row("Load prices", "prices.csv", "-", "FILE"), "file", "type"],
  // Placed by what their data sources say: this model's, another's, and another model of this model's own name.
  [row("Copy budget", "BUD01 Budget", "'BUD01 Budget'", "MODULE"), "inModel", "source"],
  [row("Hub regions", "Hub / Regions", "Hub / 'LIST - Regions'.Export", "SAVED VIEW"), "model", "source"],
  [row("Namesake", "Invented plan / Feed", "Invented plan / 'FED01 Feed'.Export", "SAVED VIEW"), "model", "source"],
  // Placed by Source Model where the data source says nothing: this model by its name, or by no name; another by its name.
  [row("Own by name", "Next week", "Invented plan / 'SYS01 Time'.'Next week'", "SAVED VIEW"), "inModel", "sourceModel"],
  [row("Own unnamed", "SYS01 Time", "'SYS01 Time'.Current", "SAVED VIEW"), "inModel", "sourceModel"],
  [row("Hub data", "Hub / Data", "Hub / 'DAT01 Data'", "MODULE"), "model", "sourceModel"],
  // Lists, written as a module would be: this model's and another's.
  [row("Own list", "G1 Regions", "'G1 Regions'", "LIST"), "inModel", "sourceModel"],
  [row("Hub list", "Hub / Products", "Hub / Products", "LIST"), "model", "sourceModel"],
  // Not told: a list written in no way the page reads, no Source Type, a Source Type of no model's object, and a saved
  // view whose Source Object is not written as a model's object.
  [row("Loose list", "Hub / G1 Regions", "Hub / G1 Regions", "LIST"), "model", "unknown"],
  [row("Only in Actions", "", "", ""), "model", "unknown"],
  [row("Dataset", "", "Hub / 'M'.V", "DATASET"), "model", "unknown"],
  [row("Odd view", "", "Hub/M.V", "SAVED VIEW"), "model", "unknown"],
];
const FILE = imports(ROWS.map(([cells]) => cells));
const MAPPINGS = [mapping("Load prices", "FILE", "Price"), mapping("Copy budget", "MODULE", "Budget", true), mapping("Hub regions", "SAVED VIEW", "Region", false),
  mapping("Namesake", "SAVED VIEW", "Feed", false), mapping("Own by name", "SAVED VIEW", "Week")];
const RESULT = model(FILE, MAPPINGS);

describe("The three tables of a model's imports", () => {
  it("places each import by its Source Type: uploaded data apart, and a model's object by what its data source says, else by Source Model; any other is not told", () => {
    const split = importSplit(RESULT, FILE);
    expect(ROWS.map(([cells], at) => [cells[0], split?.kinds[at], split?.told[at]])).toEqual(ROWS.map(([cells, kind, toldBy]) => [cells[0], kind, toldBy]));
    // What the data source says comes first: an import of another model of this model's own name is that model's.
    expect(split?.kinds[3]).toBe("model");
    // Where the data source says nothing, the evidence is the model the Source Object names: the same import, without its
    // data source's word, is this model's.
    expect(importSplit(model(FILE, MAPPINGS.map(({ sourceInThisModel: _here, ...rest }) => rest)), FILE)?.kinds[3]).toBe("inModel");
    // A model the export knew by its ID alone has no name to tell by: an object of no model's name is its own.
    const byId = model(FILE, undefined, "1234567890ABCDEF1234567890ABCDEF");
    expect([importSplit(byId, FILE)?.kinds[4], importSplit(byId, FILE)?.kinds[5]]).toEqual(["model", "inModel"]);
  });

  it("shows the file as three tables in its place, each with the file's rows of its kind in the file's order, each named by a place of its own after the result's files", () => {
    const listed = listedTables(RESULT);
    expect(listed.map(({ index, table }) => [index, table.file, table.label, table.rows.map(cells => cells[0])])).toEqual([
      [2, FILE_IMPORTS_FILE, "File Imports", ["Load prices"]],
      [3, MODEL_IMPORTS_FILE, "Model-to-Model Imports", ["Hub regions", "Namesake", "Hub data", "Hub list", "Loose list", "Only in Actions", "Dataset", "Odd view"]],
      [4, IN_MODEL_IMPORTS_FILE, "In-Model Imports", ["Copy budget", "Own by name", "Own unnamed", "Own list"]]]);
    // The rows are the file's own, and the file is as it was: the map and everything else read it.
    expect(listed.flatMap(({ table }) => table.rows).every(cells => FILE.rows.includes(cells))).toBe(true);
    expect(RESULT.tables).toEqual([DETAILS, FILE]);
    // A table without rows is not listed, and has no tile; the tiles count the file's rows between them.
    const fileOnly = model(imports([ROWS[0][0]]));
    expect([listedTables(fileOnly).map(({ table }) => table.label), overviewOf(fileOnly).tiles.map(tile => [tile.label, tile.count, tile.index])])
      .toEqual([["File Imports"], [["File Imports", 1, 2]]]);
    expect(overviewOf(RESULT).tiles.map(tile => [tile.label, tile.count])).toEqual([["File Imports", 1], ["Model-to-Model Imports", 8], ["In-Model Imports", 4]]);
    // A file without the Source Type column or without rows is shown as it stands, as is an app's file, and a second
    // file of the name keeps its place as it stands.
    const untyped = imports(FILE.rows.map(cells => cells.filter((_, at) => at !== 3)), HEADERS.filter(header => header !== "Source Type"));
    const twice: AnalysisResult = { ...RESULT, tables: [DETAILS, FILE, FILE] };
    expect([listedTables(model(untyped)), listedTables(model(imports([]))), listedTables({ ...RESULT, kind: "app" })].map(listed => listed.map(({ index, table }) => [index, table.label])))
      .toEqual([[[1, "Imports"]], [[1, "Imports"]], [[1, "Imports"]]]);
    expect(listedTables(twice).map(({ index, table }) => [index, table.label])).toEqual([[2, "Imports"], [3, "File Imports"], [4, "Model-to-Model Imports"], [5, "In-Model Imports"]]);
    expect([importTables(model(untyped), 1), importTables(RESULT, 0), importTables(twice, 2), importSplit({ ...RESULT, kind: "app" }, FILE)])
      .toEqual([undefined, undefined, undefined, undefined]);
    // The tables are known by names of files no user reads, each standing for the Imports file.
    expect([IMPORT_TABLES.map(table => [table.kind, resultFileOf(table.file), importTableOf(table.file)?.label]), resultFileOf("Exports.csv"), importTableOf("Imports.csv")])
      .toEqual([[["file", "Imports.csv", "File Imports"], ["model", "Imports.csv", "Model-to-Model Imports"], ["inModel", "Imports.csv", "In-Model Imports"]], "Exports.csv", undefined]);
  });

  it("finds each row's mapping by the whole file: two imports of one name and Source Type in two tables each have their own", () => {
    // One import of this model's module and one of another model's, of the same name and Source Type, and a file's of the
    // name; the export reads them in the file's order.
    const file = imports([row("Load costs", "Hub / Costs", "Hub / 'COS01 Costs'", "MODULE"), row("Load costs", "COS01 Costs", "'COS01 Costs'", "MODULE"),
      row("Load costs", "costs.csv", "-", "FILE")]);
    const result = model(file, [mapping("Load costs", "MODULE", "From the hub", false), mapping("Load costs", "MODULE", "From this model", true), mapping("Load costs", "FILE", "From the file")]);
    expect(mappingsByRow(result, file).map(found => found?.targets[0].target)).toEqual(["From the hub", "From this model", "From the file"]);
    // Each table's row is its own row of the file, though the in-model import is the first of its table.
    const shown = listedTables(result).map(({ table }) => fileView(result, table).table);
    expect(shown.map(table => [table.label, table.rows.map(cells => mappingOfRow(result, table, cells)?.rows[0]?.[1])]))
      .toEqual([["File Imports", ["From the file"]], ["Model-to-Model Imports", ["From the hub"]], ["In-Model Imports", ["From this model"]]]);
    expect(IMPORT_TABLES.map(table => [0, 1].map(at => fileRowOf(result, table, at)))).toEqual([[2, undefined], [0, undefined], [1, undefined]]);
    // The same where the data sources say nothing, and the Source Objects tell: the second is this model's by its name.
    const unsaid = model(file, result.importMappings?.map(({ sourceInThisModel: _here, ...rest }) => rest));
    const tables = listedTables(unsaid).map(({ table }) => fileView(unsaid, table).table);
    expect(tables.map(table => table.rows.map(cells => mappingOfRow(unsaid, table, cells)?.rows[0]?.[1]))).toEqual([["From the file"], ["From the hub"], ["From this model"]]);
    // Each says the object it reads, as its row names it, in the File line's place: a list by its model and its list.
    const lists = model(imports([row("Hub list", "Hub / Products", "Hub / Products", "LIST"), row("Loose list", "Hub / G1 Regions", "Hub / G1 Regions", "LIST")]));
    const listTable = fileView(lists, listedTables(lists)[0].table).table;
    expect(listTable.rows.map(cells => sourceLine(listTable, cells))).toEqual(["Model: Hub · List: Products", "List: Hub / G1 Regions"]);
  });

  it("shows in each table the columns that apply to its imports, and hides the rest, every one of them still in the chooser", () => {
    const columns = (file: string) => {
      const table = fileView(RESULT, listedTables(RESULT).find(listed => listed.table.file === file)!.table).table;
      const all = columnsOf(table, undefined, "UTC");
      return { shown: all.filter(column => !column.hidden).map(column => column.label), hidden: all.filter(column => column.hidden).map(column => column.label), count: [all.length, table.headers.length] };
    };
    // Uploaded data: its file, under Source Label, and Production Data; no model's object, and FILE in every row.
    expect(columns(FILE_IMPORTS_FILE)).toEqual({ shown: ["Name", "Source Label", "Target Type", "Target Object", "Used in Processes", "Start Date (UTC)",
      "Start Time (UTC)", "Most recent duration (ms)", "Notes", "Production Data"], hidden: ["Source Type", "Source Model", "Source Module", "Saved View", "Source List", "Used in Dashboards"],
      count: [16, 16] });
    // Another model's object: the four parts of Source Object and the Source Type, which says module, saved view or list.
    expect(columns(MODEL_IMPORTS_FILE)).toEqual({ shown: ["Name", "Source Model", "Source Module", "Saved View", "Source List", "Source Type", "Target Type", "Target Object",
      "Used in Processes", "Start Date (UTC)", "Start Time (UTC)", "Most recent duration (ms)", "Notes"], hidden: ["Source Label", "Production Data", "Used in Dashboards"], count: [16, 16] });
    // This model's own: as another model's, but Source Model, this model in every row, starts hidden.
    expect(columns(IN_MODEL_IMPORTS_FILE)).toEqual({ shown: ["Name", "Source Module", "Saved View", "Source List", "Source Type", "Target Type", "Target Object",
      "Used in Processes", "Start Date (UTC)", "Start Time (UTC)", "Most recent duration (ms)", "Notes"], hidden: ["Source Model", "Source Label", "Production Data", "Used in Dashboards"],
      count: [16, 16] });
    // A list's name stands in a column shown in both tables of models' objects.
    const lists = (file: string) => {
      const table = fileView(RESULT, listedTables(RESULT).find(listed => listed.table.file === file)!.table).table;
      return table.rows.filter(cells => cells[0] === "Hub list" || cells[0] === "Own list").map(cells => cells[table.headers.indexOf("Source List")]);
    };
    expect([lists(MODEL_IMPORTS_FILE), lists(IN_MODEL_IMPORTS_FILE)]).toEqual([["Products"], ["G1 Regions"]]);
  });

  it("names no file of the page's by File Imports, the one name of the page's own that says File: any other word for a file is still caught", () => {
    expect(fileWords(["File Imports: 2 rows", "Search File Imports", "Model-to-Model Imports", "File imports", "Save the file", "Files", "Download"]))
      .toEqual(["File imports", "Save the file", "Files", "Download"]);
  });

  it("says in one line of the log how many imports each table lists and how they were placed, by counts alone", () => {
    expect(importSplitLine(RESULT)).toBe("Import tables: File Imports 1, Model-to-Model Imports 8, In-Model Imports 4; 3 placed by their data source and 5 by Source Model; "
      + "4 could not be placed, so Model-to-Model Imports lists them.");
    const one = model(imports([ROWS[0][0], ROWS[10][0]]));
    expect(importSplitLine(one)).toBe("Import tables: File Imports 1, Model-to-Model Imports 1, In-Model Imports 0; 0 placed by their data source and 0 by Source Model; "
      + "1 could not be placed, so Model-to-Model Imports lists it.");
    expect(importSplitLine(model(imports([ROWS[0][0]])))).toBe("Import tables: File Imports 1, Model-to-Model Imports 0, In-Model Imports 0; 0 placed by their data source and 0 by Source Model; "
      + "0 could not be placed.");
    expect(importSplitLine(model(imports([])))).toBeUndefined();
  });

  it("shows a result an earlier version kept the same way: its mappings, of imports from a file alone and without a Source Type, are found, and its imports of models' objects placed by Source Model", () => {
    // As 0.35 kept a result: mappings of the imports from a file, with no Source Type and nothing of their sources.
    const earlier = model(FILE, [{ id: "112000000001", name: "Load prices", importType: "MODULE_DATA", targets: [{ target: "Price", source: "column", column: 1 }] }]);
    const split = importSplit(earlier, FILE);
    expect(split?.told.filter(how => how === "source")).toEqual([]);
    expect(ROWS.map(([cells], at) => [cells[0], split?.kinds[at]]).filter(([, kind]) => kind === "inModel").map(([name]) => name))
      .toEqual(["Copy budget", "Namesake", "Own by name", "Own unnamed", "Own list"]);
    const files = fileView(earlier, listedTables(earlier)[0].table).table;
    expect(mappingOfRow(earlier, files, files.rows[0])?.rows).toEqual([["Column 1", "Price"]]);
  });
});
