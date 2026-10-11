import { describe, expect, it } from "vitest";
import { DETAILS_HEADERS, diagnosticRows, exportRows, type DetailRow } from "../details.js";
import { HEADERS, type TabName } from "../report.js";
import { CALENDAR_HEADERS, CALENDAR_PROPERTIES, calendarRows } from "../model/calendar.js";
import { PAGE_ACTIONS_HEADERS, PAGE_FILTERS_HEADERS } from "../model-pages.js";
import { MISSING_LINE_ITEMS_MODULE, MODULE_USAGE_FILE, MODULE_USAGE_HEADERS, PAGE_ACTIONS_FILE, PAGE_FILTERS_FILE } from "../page-files.js";
import type { AnalysisResult, Cell, ResultTable } from "../result-types.js";
import { APP_FILES, cardsOf, columnsOf } from "./columns.js";
import { lineItemsView } from "./line-items-view.js";
import { ABOUT_MODEL, ABOUT_SHOWN, ACCESS_FILE, analysedOf, CALENDAR_GUIDANCE, CARD_PARTS, cardParts, cardSections, detailSections, detailsOf, detailValue, diagnosticLog, FILE_RULES, fileView, IMPORTS_FILE,
  listedTables, matchedRemark, MODEL_CALENDAR_FILE, MODEL_FILE_ORDER, modelFacts, MODULES_FILE, overviewOf, resultNotes, SOURCE_MODELS_FILE, tableFullLabel, tableLabel,
  THIS_MODEL } from "./result-view.js";
import { NONE, tableText } from "./table-engine.js";

/** The app export's files, as the page names them, and the report table each holds. */
const blankTable = (table: ResultTable): ResultTable => ({ ...table, rows: table.rows.map(row => row.map(cell => cell === "-" ? "" : cell)) });

const FILES: Record<string, TabName> = Object.fromEntries((Object.keys(APP_FILES) as TabName[]).map(tab => [APP_FILES[tab], tab]));
// A run's log as the tab writes it: its first line names the build, what is read and the host (progress.ts `firstLine`).
const LOG = "14:02:05 Cardigan dev: app 01234567-89ab-cdef-0123-456789abcdef on us1a.app.anaplan.com\r\n14:02:06 app: 2 pages\r\nplain line\r\n14:02:07 ";
const detailsTable = (file: string, rows: DetailRow[]): ResultTable => ({ file, label: file.replace(/\.csv$/, ""), headers: DETAILS_HEADERS, rows, guard: true, details: true });
/** An app file with the report's real headers; each row gives only the columns it cares about, the rest are dashes. */
const appTable = (file: string, rows: Record<string, Cell>[]): ResultTable => {
  const headers = HEADERS[FILES[file]];
  return { file, label: file.replace(/\.csv$/, ""), headers, rows: rows.map(row => headers.map(header => row[header] ?? "-")), guard: true };
};
const result = (kind: "app" | "model", tables: ResultTable[], summary: string[] = []): AnalysisResult =>
  ({ kind, name: kind === "app" ? "Demo app" : "Model one", id: "id", zipName: "x.zip", tables, summary });

// The rows the two exports write (analyse.ts and model/export.ts), with details.ts' own rows for the export and the log.
const appDetails = detailsTable("App Details.csv", [
  ["App", "App", "Demo app"], ["App", "App ID", "01234567-89ab-cdef-0123-456789abcdef"], ["App", "Cards", 3],
  ...exportRows("us1a.app.anaplan.com", new Date(Date.UTC(2026, 9, 3, 14, 2, 5))),
  ["Files", "Pages.csv", "2 rows"], ["Files", "Cards.csv", "3 rows"],
  ["Notes", "Legacy archive", "Not published"], ["Notes", "Names", "Demo model: the model is closed, so IDs are shown instead of names."],
  ["How to read", "Page and Card #", "Identify a card in every table."],
  ...diagnosticRows(LOG),
]);
const modelDetails = detailsTable("Model Details.csv", [
  ["Model", "Model", "Model one"], ["Model", "Workspace", "Main"],
  ...exportRows("eu2a.app.anaplan.com", new Date(Date.UTC(2026, 9, 3, 9, 30, 0))),
  ["Files", "Line Items.csv", "120 rows"], ["Files", "Imports.csv", "Not exported: the grid did not load"],
  ["Notes", "Actions", "the Actions list came without Notes; the diagnostic log lists the columns it had."],
]);

describe("What the results page reads out of a result", () => {
  it.each(["app", "model"] as const)("keeps every %s table listed and carries each nonempty tile's index and file for both engines", kind => {
    const table = (label: string, rows: Cell[][]): ResultTable => ({ file: `${label}.csv`, label, headers: ["Name"], rows, guard: true });
    const tables = [table("Exports", [["Practice export"]]), table("Line Item Subsets", []), modelDetails,
      table("Versions", [["Plan"], ["Actual"]]), table("Source Models", []), table("General Lists", [["Products"]])];
    for (const engine of [undefined, "polaris"] as const) {
      const mixed = { ...result(kind, tables), engine };
      expect(listedTables(mixed).map(({ index }) => index)).toEqual(kind === "model" ? [3, 5, 1, 0, 4] : [0, 1, 3, 4, 5]);
      const tiles = [
        { index: 0, file: "Exports.csv", label: "Exports", count: 1 },
        { index: 3, file: "Versions.csv", label: "Versions", count: 2 },
        { index: 5, file: "General Lists.csv", label: "General Lists", count: 1 },
      ];
      expect(overviewOf(mixed).tiles).toEqual(kind === "model" ? [tiles[1], tiles[2], tiles[0]] : tiles);
      const empty = { ...mixed, tables: tables.map(table => ({ ...table, rows: [] })) };
      expect(overviewOf(empty).tiles).toEqual([]);
      expect(listedTables(empty).map(({ index }) => index)).toEqual(listedTables(mixed).map(({ index }) => index));
    }
  });

  it("finds the Details file by its mark, not by its name or its place", () => {
    const lineItems: ResultTable = { file: "Line Items.csv", label: "Line Items", headers: ["", "Formula"], rows: [], guard: false };
    expect(detailsOf(result("model", [lineItems, modelDetails]))).toBe(modelDetails);
    expect(detailsOf(result("model", [lineItems]))).toBeUndefined();
    expect(detailsOf(result("model", []))).toBeUndefined();
    // A file with the Details file's name and columns but without the mark is a table like any other; one with the mark is
    // the Details file whatever it is called and wherever it stands.
    const { details: _mark, ...unmarked } = modelDetails;
    const marked: ResultTable = { ...lineItems, file: "About this export.csv", label: "About this export", details: true };
    expect(detailsOf(result("model", [unmarked, lineItems]))).toBeUndefined();
    expect(detailsOf(result("model", [unmarked, lineItems, marked]))).toBe(marked);
    expect(detailsOf(result("app", [{ ...appDetails, file: "Model Details.csv" }]))?.file).toBe("Model Details.csv");
    // What the page reads out of the Details file follows the mark too: the header's host, the notes and the tiles.
    const named = result("model", [unmarked, lineItems], []);
    expect([analysedOf(named).host, resultNotes(named), overviewOf(named).tiles.map(tile => tile.label)]).toEqual([undefined, [], ["Model Details"]]);
  });

  it("groups the Details file's rows by section, in the file's order, and keeps the diagnostic log apart", () => {
    const sections = detailSections(appDetails);
    expect(sections.map(section => section.section)).toEqual(["App", "Export", "Files", "Notes", "How to read"]);
    expect(sections[0].rows).toEqual([["App", "Demo app"], ["App ID", "01234567-89ab-cdef-0123-456789abcdef"], ["Cards", "3"]]);
    expect(sections[1].rows).toEqual([["Exported on", "2026-10-03 14:02 UTC"], ["Exported with", "Cardigan dev"], ["Anaplan host", "us1a.app.anaplan.com"]]);
    expect(sections[3].rows).toEqual([["Legacy archive", "Not published"], ["Names", "Demo model: the model is closed, so IDs are shown instead of names."]]);
    // Rows of one section that are not next to each other still come under the one heading.
    expect(detailSections(detailsTable("d.csv", [["A", "1", "x"], ["B", "2", "y"], ["A", "3", "z"]]))).toEqual([
      { section: "A", rows: [["1", "x"], ["3", "z"]] }, { section: "B", rows: [["2", "y"]] }]);
    expect(detailSections(undefined)).toEqual([]);
  });

  it("gives the diagnostic log back line for line, as the tab stamped it", () => {
    expect(diagnosticLog(appDetails)).toEqual(LOG.split("\r\n"));
    expect(diagnosticLog(modelDetails)).toEqual([]);
    expect(diagnosticLog(undefined)).toEqual([]);
  });

  it("reads one detail by its section and name", () => {
    expect(detailValue(appDetails, "App", "Cards")).toBe("3");
    expect(detailValue(appDetails, "Export", "Cards")).toBeUndefined();
    expect(detailValue(undefined, "App", "Cards")).toBeUndefined();
  });

  it("says in the header what was analysed, on which host and when", () => {
    expect(analysedOf(result("app", [appDetails]))).toEqual({ name: "Demo app", kind: "App", host: "us1a.app.anaplan.com", exportedOn: "2026-10-03 14:02 UTC" });
    expect(analysedOf(result("model", [modelDetails]))).toEqual({ name: "Model one", kind: "Model", host: "eu2a.app.anaplan.com", exportedOn: "2026-10-03 09:30 UTC" });
    expect(analysedOf(result("model", []))).toEqual({ name: "Model one", kind: "Model", host: undefined, exportedOn: undefined });
  });

  it("gives an app's notes, one line each: the summary, then the Notes rows the summary does not already say", () => {
    // analyse.ts puts each name note in the summary and in a Notes row called Names; pages not analysed are Notes rows only.
    const summary = ["2 of 2 pages analysed; 1 unpublished, not analysed, 3 cards.", "Demo model: the model is closed, so IDs are shown instead of names."];
    expect(resultNotes(result("app", [appDetails], summary))).toEqual([...summary, "Legacy archive: Not published"]);
    const answered = detailsTable("App Details.csv", [["Notes", "Names", "All models answered."]]);
    expect(resultNotes(result("app", [answered], ["2 of 2 pages analysed, 3 cards."]))).toEqual(["2 of 2 pages analysed, 3 cards.", "Names: All models answered."]);
  });

  it("gives a model's notes once, without the lines that only say how many rows a file has", () => {
    // model/export.ts lists every file's row count in the summary, and writes each note as a summary line and as a Notes row.
    const file = (label: string, rows: number): ResultTable => ({ file: `${label}.csv`, label, headers: ["", "Formula"], rows: Array.from({ length: rows }, (_, index) => [`Row ${index}`, ""]), guard: false });
    const tables = [modelDetails, file("Line Items", 120), file("Imports", 4), file("Versions", 1), file("Source Models", 0)];
    const said = ["Imports: 4 rows (3 matched in the Actions list)", "Exports: not exported (the grid did not load).",
      "Actions: the Actions list came without Notes; the diagnostic log lists the columns it had."];
    const summary = ["Line Items: 120 rows", said[0], "Versions: 1 rows", "Source Models: 0 rows", said[1], said[2]];
    expect(resultNotes(result("model", tables, summary))).toEqual(said);
    expect(resultNotes(result("model", tables, ["Versions: 1 row", "Line Items: 120 rows"]))).toEqual([said[2]]);
    // A count that is not the file's own, a file the result does not have, or a line that says more: each says something
    // the tiles do not, and stays.
    const other = ["Line Items: 119 rows", "Modules: 2 rows", "Line Items: 120 rows.", "line items: 120 rows", "Line Items: 120 rows read"];
    expect(resultNotes(result("model", [file("Line Items", 120)], other))).toEqual(other);
    // Without the summary line the Notes row is shown; twice the same row is shown once; a row without a name is its value.
    const twice = detailsTable("Model Details.csv", [["Notes", "Actions", "no columns"], ["Notes", "Actions", "no columns"], ["Notes", "", "On its own"]]);
    expect(resultNotes(result("model", [twice, file("Line Items", 120)], ["", "Line Items: 120 rows"]))).toEqual(["Actions: no columns", "On its own"]);
    expect(resultNotes(result("model", []))).toEqual([]);
  });

  it("says once what the summary and a Files row of the Details file both say: with the tables, not among the notes", () => {
    // model/export.ts writes each file's summary line and its Files row from the same words: a count with a remark, and a
    // file that was not exported, which the two word differently.
    const file = (label: string, rows: number): ResultTable => ({ file: `${label}.csv`, label, headers: ["", "Formula"], rows: Array.from({ length: rows }, (_, index) => [`Row ${index}`, ""]), guard: false });
    const details = detailsTable("Model Details.csv", [["Model", "Model", "Model one"],
      ["Files", "Line Items.csv", "120 rows"], ["Files", "Imports.csv", "3 rows (2 matched in the Actions list)"], ["Files", "Exports.csv", "Not exported: the grid did not load"],
      ["Files", "Source Models.csv", "Not exported: This model page has no REMOTE_MODEL axis."], ["Notes", "Actions", "the Actions list came without Notes."]]);
    const tables = [details, file("Line Items", 120), file("Imports", 3)];
    const summary = ["Line Items: 120 rows", "Imports: 3 rows (2 matched in the Actions list)", "Exports: not exported (the grid did not load).",
      "Source Models: not exported (This model page has no REMOTE_MODEL axis.).", "Actions: the Actions list came without Notes."];
    const overview = overviewOf(result("model", tables, summary));
    // The two that were not exported are under Tables, each once, by the name the page has for the table. The import of
    // three that could not be matched in the Actions list is a note after the export's own, which says what that means;
    // it is not said twice.
    const unmatched = "Imports: 1 of the 3 rows could not be matched between the Imports tab and the Actions list, so some of its columns are empty.";
    expect([overview.notes, overview.files]).toEqual([["Actions: the Actions list came without Notes.", unmatched],
      [["Exports", "Not exported: the grid did not load"], ["Source Models", "Not exported: This model page has no REMOTE_MODEL axis."]]]);
    expect([...resultNotes(result("model", tables, summary)), unmatched]).toEqual(overview.notes);
    // That name is the table's own label where the result has the file, whatever the file is called, and otherwise the
    // file's name without its extension: a file that was not exported has no table to ask. No file's name is shown.
    const named = overviewOf(result("model", [detailsTable("Model Details.csv", [["Files", "Imports.csv", "3 rows (2 matched)"], ["Files", "Gone.csv", "Not exported: no grid"],
      ["Files", "No extension", "Not exported: no grid"], ["Files", "Two.csv.csv", "Not exported: no grid"]]), { ...file("Imports", 3), label: "All imports" }]));
    expect(named.files).toEqual([["All imports", "3 rows (2 matched)"], ["Gone", "Not exported: no grid"], ["No extension", "Not exported: no grid"], ["Two.csv", "Not exported: no grid"]]);
    // A summary line that says something else than its file's row stays a note: another remark, another reason, another
    // file, or a line that only begins like one.
    const other = ["Imports: 3 rows (1 matched in the Actions list)", "Exports: not exported (the Actions list could not be read).", "Processes: not exported (the grid did not load).",
      "Source Models: not exported (This model page has no REMOTE_MODEL axis.)", "Imports: 3 rows (2 matched in the Actions list). Checked."];
    expect(resultNotes(result("model", tables, other))).toEqual([...other, "Actions: the Actions list came without Notes."]);
    // Without the Details file's row there is nothing that says it with the files: the summary's line is the note.
    expect(resultNotes(result("model", [file("Imports", 3)], summary.slice(1, 4)))).toEqual(summary.slice(1, 4));
  });

  it("counts for the overview each file's rows, and says nothing of an app's cards by type or of its models apart from what the Details file says", () => {
    const pages = appTable("Pages.csv", [
      { Page: "Overview", Model: "Demo model", Workspace: "Main", "Model ID": "0123456789ABCDEF0123456789ABCDEF" },
      { Page: "Stores", Model: "Demo model", Workspace: "Main", "Model ID": "0123456789ABCDEF0123456789ABCDEF" },
      { Page: "Archive", Model: "Other model", Workspace: "Old", "Model ID": "FEDCBA9876543210FEDCBA9876543210" },
      { Page: "Legacy archive" },
    ]);
    const cards = appTable("Cards.csv", [{ "Card type": "KPI" }, { "Card type": "Grid" }, { "Card type": "Text" }, { "Card type": "Grid" }, { "Card type": "Chart" }, { "Card type": "KPI" }]);
    expect(overviewOf(result("app", [appDetails, pages, cards, appTable("Filters.csv", [])]))).toEqual({
      tiles: [expect.objectContaining({ label: "Pages", count: 4 }), expect.objectContaining({ label: "Cards", count: 6 })],
      notes: ["Legacy archive: Not published", "Names: Demo model: the model is closed, so IDs are shown instead of names."],
      // What the Details file says besides: the app and its ID, and no more, under About this export; the tables whose row
      // says something else than the file's own number of rows (here the Details file was written for fewer rows); how to
      // read them; and the log.
      about: [["App", "Demo app"], ["App ID", "01234567-89ab-cdef-0123-456789abcdef"]],
      files: [["Pages", "2 rows"], ["Cards", "3 rows"]],
      howToRead: [["Page and Card #", "Identify a card in every table."]],
      log: diagnosticLog(appDetails),
    });
  });

  it("names an app's tiles by the design's shorter names, and any other file's by the file's own", () => {
    const every = (Object.values(APP_FILES)).map(file => appTable(file, [{}]));
    expect(overviewOf(result("app", [appDetails, ...every])).tiles.map(tile => tile.label)).toEqual(
      ["Pages", "Cards", "Grid sections", "Filters", "Formatting rules", "Action buttons", "Model objects"]);
    // The file's own label is not what names the tile, and a file the app export does not have keeps its label.
    const renamed: ResultTable = { ...appTable("Conditional Formatting.csv", [{}]), label: "Something else" };
    const other: ResultTable = { file: "Formatting rules.csv", label: "Formatting rules of mine", headers: [""], rows: [["a"]], guard: false };
    expect(overviewOf(result("app", [renamed, other])).tiles).toEqual([expect.objectContaining({ label: "Formatting rules", count: 1 }), expect.objectContaining({ label: "Formatting rules of mine", count: 1 })]);
    // The navigation and the table's own heading keep the file's name: only the tile is short.
    expect(appTable("Conditional Formatting.csv", []).label).toBe("Conditional Formatting");
  });

  it("gives a model's overview its row counts and nothing made up", () => {
    const lineItems: ResultTable = { file: "Line Items.csv", label: "Line Items", headers: ["", "Formula"], rows: [["Revenue", "Units * Price"], ["Units", ""]], guard: false };
    const modules: ResultTable = { file: "Modules.csv", label: "Modules", headers: ["", "Card type", "Model"], rows: [["REP01", "x", "y"]], guard: false };
    expect(overviewOf(result("model", [modelDetails, lineItems, modules], ["Line Items: 2 rows", "Modules: 1 rows"]))).toEqual({
      tiles: [expect.objectContaining({ label: "Modules", count: 1 }), expect.objectContaining({ label: "Line Items", count: 2 })],
      notes: ["Actions: the Actions list came without Notes; the diagnostic log lists the columns it had."],
      about: [["Workspace", "Main"], ["Model", "Model one"]],
      files: [["Line Items", "120 rows"], ["Imports", "Not exported: the grid did not load"]], howToRead: [], log: [] });
  });

  it("leaves the export's check of the imports matched in the Actions list to the tile where every one was, and says in a note how many were not", () => {
    const imports = (rows: number): ResultTable => ({ file: "Imports.csv", label: "Imports", headers: ["", "Source"], rows: Array.from({ length: rows }, (_, index) => [`Import ${index}`, ""]), guard: false });
    const overview = (value: string, rows = 372) => overviewOf(result("model", [detailsTable("Model Details.csv", [["Files", "Imports.csv", value]]), imports(rows)]));
    // Every row matched: the row says no more than the tile's count, so Tables has nothing of it, and there is no note.
    expect(overview("372 rows (372 matched in the Actions list)")).toMatchObject({ tiles: [expect.objectContaining({ label: "Imports", count: 372 })], files: [], notes: [] });
    // Some were not: a note says how many and what it means, with a word for one row and for several. Tables has nothing.
    expect(overview("372 rows (370 matched in the Actions list)")).toMatchObject({ files: [],
      notes: ["Imports: 2 of the 372 rows could not be matched between the Imports tab and the Actions list, so some of their columns are empty."] });
    expect(overview("372 rows (371 matched in the Actions list)").notes).toEqual(
      ["Imports: 1 of the 372 rows could not be matched between the Imports tab and the Actions list, so some of its columns are empty."]);
    // Another remark, the Actions list not read, or a count that is not the table's own number of rows: under Tables as it is.
    for (const value of ["372 rows (Imports tab only: the Actions list could not be read)", "371 rows (371 matched in the Actions list)", "372 rows (372 matched)"]) {
      expect([value, overview(value).files, overview(value).notes]).toEqual([value, [["Imports", value]], []]);
    }
    // The note says the table by the name the page has for it; a row with no table of its own is left as it is.
    expect(matchedRemark("All imports", "3 rows (2 matched in the Actions list)", 3)).toEqual(
      { note: "All imports: 1 of the 3 rows could not be matched between the Imports tab and the Actions list, so some of its columns are empty." });
    expect([matchedRemark("Imports", "3 rows (3 matched in the Actions list)", 3), matchedRemark("Imports", "3 rows (3 matched in the Actions list)", undefined)])
      .toEqual([{ counted: true }, undefined]);
  });

  it("holds on the overview every row of the Details file: none is dropped, and a file's row is left to its tile only when it says the tile's count", () => {
    const lineItems: ResultTable = { file: "Line Items.csv", label: "Line Items", headers: ["", "Formula"], rows: Array.from({ length: 120 }, (_, index) => [`Line item ${index}`, ""]), guard: false };
    const imports: ResultTable = { file: "Imports.csv", label: "Imports", headers: ["", "Source"], rows: [["Load", "a"], ["Other", "b"]], guard: false };
    const details = detailsTable("Model Details.csv", [
      ["Model", "Model", "Model one"], ["Model", "Workspace", "Main"], ["Model", "Model ID", "0123456789ABCDEF0123456789ABCDEF"],
      ...exportRows("eu2a.app.anaplan.com", new Date(Date.UTC(2026, 9, 3, 9, 30, 0))),
      ["Files", "Line Items.csv", "120 rows"], ["Files", "Imports.csv", "2 rows (2 matched in the Actions list)"], ["Files", "Source Models.csv", "Not exported: no such axis"],
      ["Notes", "Actions", "the Actions list came without Notes."], ["Something new", "A detail", "its value"],
      ["How to read", "Layout", "As Anaplan's own export."], ...diagnosticRows(LOG),
    ]);
    const overview = overviewOf(result("model", [details, lineItems, imports]));
    // The file whose row says only how many rows it has is the tile, and so is the Imports row whose every row was matched
    // in the Actions list; the other is said, with what it says.
    expect([overview.tiles, overview.files]).toEqual([[expect.objectContaining({ label: "Line Items", count: 120 }), expect.objectContaining({ label: "Imports", count: 2 })],
      [["Source Models", "Not exported: no such axis"]]]);
    // About this export says the workspace, the model and its ID, in that order, and no more: neither a section the page
    // does not know nor the export's host, time and tool.
    expect(overview.about.map(([detail]) => detail)).toEqual(["Workspace", "Model", "Model ID"]);
    // Every row of the Details file is somewhere on the overview.
    const held = (row: Cell[]): boolean => {
      const [section, detail, value] = row.map(String);
      const pair = ([first, second]: readonly [string, string]) => first === detail && second === value;
      if (section === "Diagnostics") return overview.log.includes(detail ? `${detail} ${value}` : value);
      if (section === "Notes") return overview.notes.includes(`${detail}: ${value}`);
      if (section === "How to read") return overview.howToRead.some(pair);
      // A Files row names its file; the overview says it under the table's name, among the tables or as the table's tile. A
      // count whose every row was matched in the Actions list is the tile's count.
      const matched = /^(\d+) rows \((\d+) matched in the Actions list\)$/.exec(value);
      const said = matched && matched[1] === matched[2] ? `${matched[1]} rows` : value;
      if (section === "Files") return [...overview.files, ...overview.tiles.map(tile => [tile.label, `${tile.count} rows`])].some(([table, shown]) => `${table}.csv` === detail && shown === said);
      return overview.about.some(pair);
    };
    // The rows About this export leaves out on purpose (`ABOUT_SHOWN`): where, when and with what the export was made,
    // and a section the page does not know. The overview does not say them; they stay in the result's Details file,
    // which the page keeps whole, and the export's version is the first line of its log.
    const leftOut = (row: Cell[]): boolean => !["Files", "Notes", "How to read", "Diagnostics"].includes(String(row[0])) && !ABOUT_SHOWN.includes(String(row[1]));
    expect(details.rows.filter(leftOut).map(row => String(row[1]))).toEqual(["Exported on", "Exported with", "Anaplan host", "A detail"]);
    // Every other row of the Details file is somewhere on the overview.
    expect([details.rows.length, details.rows.filter(row => !leftOut(row) && !held(row))]).toEqual([16, []]);
    // The same for the app's Details file, whose Files rows are said too where they differ from the files.
    const app = overviewOf(result("app", [appDetails]));
    const appLeftOut = appDetails.rows.filter(leftOut).map(row => String(row[1]));
    expect(appLeftOut).toEqual(["Cards", "Exported on", "Exported with", "Anaplan host"]);
    expect([app.about.length, app.files.length, app.notes.length, app.howToRead.length, app.log.length]).toEqual([2, 2, 2, 1, 4]);
    expect(app.about.length + appLeftOut.length + app.files.length + app.notes.length + app.howToRead.length + app.log.length).toBe(appDetails.rows.length);
    // Without a Details file the overview has none of it.
    expect(overviewOf(result("model", [lineItems]))).toMatchObject({ about: [], files: [], howToRead: [], log: [] });
  });

  it("counts only listed rows on tiles while preserving file counts in the result", () => {
    // A model as the export writes it: the Line Items grid with its modules' own rows, and the calendar with its rows about
    // the model. The Details file and the summary count each file's rows, all of them.
    const blueprint: ResultTable = { file: "Line Items.csv", label: "Line Items", guard: false, headers: ["", "Formula", "Applies To", "Module Name"], rows: [
      ["Revenue", "", "Products, Time", ""], ["Units", "", "-", "Revenue"], ["Price", "Units * 2", "Products", "Revenue"], ["Costs", "", "Regions", ""], ["Rent", "", "-", "Costs"]] };
    const modules: ResultTable = { file: MODULES_FILE, label: "Modules", headers: ["", "Applies To"], rows: [["Revenue", "Products, Time"], ["Costs", "Regions"]], guard: false };
    const details = detailsTable("Model Details.csv", [["Model", "Model", "Model one"],
      ["Files", "Line Items.csv", "5 rows"], ["Files", "Modules.csv", "2 rows"], ["Files", "Model Calendar.csv", "31 rows"], ["Files", "Imports.csv", "Not exported: the grid did not load"]]);
    const model = result("model", [details, blueprint, modules, calendar()], ["Line Items: 5 rows", "Modules: 2 rows", "Model Calendar: 31 rows", "Imports: not read"]);
    const overview = overviewOf(model);
    // The table lists the 5 of the calendar's 31 rows that are settings with a value. Its tile says what the calendar is,
    // a months one, and keeps the 5 it lists, which no line of it shows. A file whose table lists every row says the file's
    // own number; Line Items counts its three line items, leaving out the two modules' rows.
    expect(overview.tiles).toEqual([expect.objectContaining({ label: "Model Calendar", count: 5, value: "Monthly", title: "Model Calendar: Calendar Months/Quarters/Years" }), expect.objectContaining({ label: "Modules", count: 2 }), expect.objectContaining({ label: "Line Items", count: 3 })]);
    // So the three rows that only count a file are not said under Tables, and the three summary lines that only count one are no notes.
    expect([overview.files, overview.notes]).toEqual([[["Imports", "Not exported: the grid did not load"]], ["Imports: not read"]]);
    // Tables that leave rows out explain their view under the table's name. Their raw counts stay in the result.
    const counted = details.rows.filter(row => row[0] === "Files").map(row => [String(row[1]), String(row[2])]);
    const onTile = ([file, value]: string[]) => overview.tiles.some(tile => `${tile.label}.csv` === file && `${tile.count} rows` === value);
    expect(counted.map(row => (overview.files.some(([table, value]) => `${table}.csv` === row[0] && value === row[1]) ? "Tables" : onTile(row) ? "tile" : "under its table")))
      .toEqual(["under its table", "tile", "under its table", "Tables"]);
    // A count in the Details file that is not the file's own stays under Tables, whatever the tile says.
    const other = overviewOf(result("model", [detailsTable("Model Details.csv", [["Files", "Line Items.csv", "3 rows"], ["Files", "Model Calendar.csv", "26 rows"]]), blueprint, calendar()]));
    expect([other.tiles, other.files]).toEqual([[expect.objectContaining({ label: "Model Calendar", count: 5, value: "Monthly", title: "Model Calendar: Calendar Months/Quarters/Years" }), expect.objectContaining({ label: "Line Items", count: 3 })],
      [["Line Items", "3 rows"], ["Model Calendar", "26 rows"]]]);
    // An app's tiles say one number each too, a Where Used table by object's as well.
    expect(overviewOf(result("app", [appDetails, appTable("Pages.csv", [{ Page: "Overview" }]), appTable("Where Used.csv", [{ Page: "Overview" }, { Page: "Overview" }])])).tiles)
      .toEqual([expect.objectContaining({ label: "Pages", count: 1 }), expect.objectContaining({ label: "Model objects", count: 2 })]);
  });

  it("lists a model's files in the order of Anaplan's Model settings, and an app's as the result has them", () => {
    // Dynamic Cell Access is no setting of Anaplan's: the export makes it from Line Items, and it comes right after it.
    // After the settings, the tables of the pages built on the model, which a model's run adds (model-pages.ts): last
    // before the map.
    expect(MODEL_FILE_ORDER).toEqual(["Model Calendar.csv", "Time Ranges.csv", "Versions.csv", "General Lists.csv", "Line Item Subsets.csv", "Modules.csv", "Line Items.csv",
      "Dynamic Cell Access.csv", "Processes.csv", "Imports.csv", "Import Data Sources.csv", "Exports.csv", "Other Actions.csv", "Source Models.csv",
      "Module Usage.csv", "Page Filters.csv", "Page Actions.csv"]);
    expect([MODEL_FILE_ORDER[0], new Set(MODEL_FILE_ORDER).size, MODEL_FILE_ORDER[MODEL_FILE_ORDER.indexOf("Line Items.csv") + 1]]).toEqual([MODEL_CALENDAR_FILE, 17, ACCESS_FILE]);
    const file = (name: string): ResultTable => ({ file: name, label: name.replace(/\.csv$/, ""), headers: ["", "Value"], rows: [], guard: false });
    /** The files of a result as the page lists them: each one's name and its place in the result. */
    const listed = (kind: "app" | "model", ...names: string[]) => listedTables(result(kind, [modelDetails, ...names.map(file)])).map(({ index, table }) => `${index} ${table.file}`);
    // The export's own order (model/export.ts), after the Details file, and then the tables of the pages built on the
    // model: every file moves to its place, and keeps its place in the result as its name.
    const written = ["Line Items.csv", "Dynamic Cell Access.csv", "Modules.csv", "General Lists.csv", "Processes.csv", "Imports.csv", "Import Data Sources.csv", "Exports.csv", "Other Actions.csv",
      "Time Ranges.csv", "Versions.csv", "Source Models.csv", "Model Calendar.csv", "Module Usage.csv", "Page Filters.csv", "Page Actions.csv"];
    expect(listed("model", ...written)).toEqual(["13 Model Calendar.csv", "10 Time Ranges.csv", "11 Versions.csv", "4 General Lists.csv", "3 Modules.csv", "1 Line Items.csv",
      "2 Dynamic Cell Access.csv", "5 Processes.csv", "6 Imports.csv", "7 Import Data Sources.csv", "8 Exports.csv", "9 Other Actions.csv", "12 Source Models.csv",
      "14 Module Usage.csv", "15 Page Filters.csv", "16 Page Actions.csv"]);
    // Only the files the result has, in that order.
    expect(listed("model", "Imports.csv", "Line Items.csv", "Versions.csv")).toEqual(["3 Versions.csv", "2 Line Items.csv", "1 Imports.csv"]);
    // A file that is not in the order comes after those that are, in the result's order, and none is dropped: a renamed
    // file, a new one, one whose name differs in case. An empty Line Item Subsets table keeps its place.
    expect(listed("model", "Users.csv", "Line Items.csv", "modules.csv", "Line Item Subsets.csv", "Line Items (2).csv", "Model Calendar.csv"))
      .toEqual(["6 Model Calendar.csv", "4 Line Item Subsets.csv", "2 Line Items.csv", "1 Users.csv", "3 modules.csv", "5 Line Items (2).csv"]);
    // Two files of one name keep the result's order between them.
    expect(listed("model", "Versions.csv", "Line Items.csv", "Versions.csv")).toEqual(["1 Versions.csv", "3 Versions.csv", "2 Line Items.csv"]);
    // The Details file is not listed, wherever it stands; the result itself is left as it is.
    const mixed = result("model", [file("Line Items.csv"), modelDetails, file("Versions.csv")]);
    expect([listedTables(mixed).map(({ index, table }) => `${index} ${table.file}`), mixed.tables.map(table => table.file)])
      .toEqual([["2 Versions.csv", "0 Line Items.csv"], ["Line Items.csv", "Model Details.csv", "Versions.csv"]]);
    // An app's files are listed as the result has them, even ones with a model's names.
    expect(listed("app", "Pages.csv", "Cards.csv", "Line Items.csv", "Model Calendar.csv", "Where Used.csv"))
      .toEqual(["1 Pages.csv", "2 Cards.csv", "3 Line Items.csv", "4 Model Calendar.csv", "5 Where Used.csv"]);
    // The overview's tiles follow the same order. Two of them have the page's own names for their tables, by their files:
    // Data Sources for Import Data Sources, and DCA for Dynamic Cell Access, which says what it stands for in full.
    const tiles = overviewOf(result("model", [modelDetails, ...written.map(name => ({ ...file(name), rows: [["A row", "A value"]] }))])).tiles;
    expect(tiles.map(tile => tile.label)).toEqual(["Model Calendar", "Time Ranges", "Versions", "General Lists", "Modules",
      "Line Items", "DCA", "Processes", "Imports", "Data Sources", "Exports", "Other Actions", "Source Models", "Module Usage", "Page Filters", "Page Actions"]);
    expect(tiles.filter(tile => tile.full !== undefined)).toEqual([expect.objectContaining({ label: "DCA", count: 1, full: "Dynamic Cell Access (DCA)" })]);
  });

  // A model's Model Calendar file as the export writes it: the assessment template's rows, the first five about the model.
  // Its calendar is a calendar of months, five of whose settings hold a value; a setting of weeks calendars that the grid
  // gives a value all the same is left blank, as are the others of its twenty-six settings.
  const CALENDAR_VALUES = new Map([[CALENDAR_PROPERTIES["Calendar Type"], "Calendar Months/Quarters/Years"], [CALENDAR_PROPERTIES["Fiscal Year Starts"], "1"],
    [CALENDAR_PROPERTIES["Number of Past Years"], "1"], [CALENDAR_PROPERTIES["Number of Future Years"], "2"], [CALENDAR_PROPERTIES["Include Quarter Totals"], "true"],
    [CALENDAR_PROPERTIES["Week Format"], "Numbered"]]);
  const calendar = (workspace = "Main", model = "Model one"): ResultTable => ({ file: "Model Calendar.csv", label: "Model Calendar", headers: [...CALENDAR_HEADERS], guard: false,
    rows: calendarRows({ workspace, model, capturedOn: "2026-10-03", values: CALENDAR_VALUES }) });
  /** The warning under the calendar counts settings with no value. */
  const CALENDAR_NOTE = "21 settings have no value and are not listed: they do not apply to this calendar type, or the model does not show them.";

  it("lists every row of every file, but for the rows about the model in a model's Model Calendar file", () => {
    expect([MODEL_CALENDAR_FILE, ABOUT_MODEL]).toEqual(["Model Calendar.csv", "Model"]);
    const file = calendar();
    const lineItems: ResultTable = { file: "Line Items.csv", label: "Line Items", headers: ["Section", "Formula"], rows: [["Model", "a"], ["Model Calendar", "b"]], guard: false };
    const model = result("model", [modelDetails, lineItems, file]);
    // The template has five rows about the model and twenty-six about its calendar: the table lists those of the latter that
    // hold a value, without the two columns that guide whoever fills the template in by hand.
    const listed = fileView(model, file);
    expect([file.rows.length, listed.note, listed.table.rows.length, [...new Set(listed.table.rows.map(row => row[0]))]]).toEqual([31, CALENDAR_NOTE, 5, ["Model Calendar"]]);
    expect([CALENDAR_GUIDANCE, listed.table.headers]).toEqual([["Applies to", "Notes"], ["Section", "Setting", "Value", "Allowed values"]]);
    expect(listed.table.rows.map(row => [row[1], row[2]])).toEqual([["Calendar Type", "Calendar Months/Quarters/Years"], ["Fiscal Year Starts", "Jan"],
      ["Number of Past Years", "1"], ["Number of Future Years", "2"], ["Include Quarter Totals", "Yes"]]);
    expect(listed.table).toEqual({ ...file, headers: CALENDAR_HEADERS.slice(0, 4), rows: file.rows.filter(row => row[0] !== "Model" && row[2] !== "").map(row => row.slice(0, 4)) });
    expect(file.rows.filter(row => row[0] === "Model").map(row => row[1])).toEqual(["Workspace", "Model", "Model size (GB)", "Captured on", "Captured by"]);
    // The file itself is as it was: the overview reads the model's facts out of it.
    expect(file.rows).toHaveLength(31);
    // Any other file lists every row, the same rows, whatever its columns are called and hold; so does the Details file.
    expect([fileView(model, lineItems), fileView(model, modelDetails)]).toEqual([{ table: lineItems }, { table: modelDetails }]);
    expect(fileView(model, lineItems).table).toBe(lineItems);
    // The rules are few and each is one file's own, by the kind of result and the file's name.
    expect([[...FILE_RULES.model.keys()], [...FILE_RULES.app.keys()]]).toEqual([["Model Calendar.csv", "Line Items.csv", "Dynamic Cell Access.csv", "Processes.csv", "Imports.csv", "Source Models.csv",
      "Line Item Subsets.csv", "Module Usage.csv", "Page Filters.csv", "Page Actions.csv"], []]);
    // The rule is that file's alone: by its name, in a model's result, by its Section column.
    const renamed = { ...file, file: "Model Calendar (2).csv" };
    const regrouped = { ...file, headers: ["Group", ...file.headers.slice(1)] };
    expect([fileView(model, renamed), fileView(result("app", [appDetails, file]), file), fileView(model, regrouped)]).toEqual([{ table: renamed }, { table: file }, { table: regrouped }]);
    // A row is left out for being about the model, not for its place: wherever such a row stands, and only such a row.
    const mixed: ResultTable = { ...file, headers: ["Setting", "Section", "Value"], rows: [["Calendar Type", "Model Calendar", "x"], ["Model", "Model", "y"], ["Other", "Something else", "z"], ["Model", "model", "w"]] };
    expect(fileView(model, mixed)).toEqual({ table: { ...mixed, rows: [mixed.rows[0], mixed.rows[2], mixed.rows[3]] } });
    // A calendar file with no row about the model lists its settings that hold a value, under a line that counts the rest.
    const none: ResultTable = { ...file, rows: file.rows.slice(5) };
    expect([fileView(model, none).table.rows.length, fileView(model, none).note]).toEqual([5, CALENDAR_NOTE.slice(CALENDAR_NOTE.indexOf("21 settings"))]);
    // One whose every setting holds a value has no such line, and lists them all.
    const valued: ResultTable = { ...file, rows: file.rows.slice(5).filter(row => row[2] !== "") };
    expect([fileView(model, valued).table.rows.length, fileView(model, valued).note]).toEqual([5, undefined]);
    // A calendar file whose every row is about the model leaves its table none: the table then says so, in the rows' place,
    // and the line under its name counts the rows as ever. A table that has rows to list says nothing in their place.
    const only: ResultTable = { ...file, rows: file.rows.slice(0, 5) };
    expect(fileView(model, only)).toEqual({ table: { ...only, headers: CALENDAR_HEADERS.slice(0, 4), rows: [] },
      none: "Every row is about the model." });
    // One whose settings all have no value says that in the rows' place.
    const blank: ResultTable = { ...calendar(), rows: calendarRows({ workspace: "Main", model: "Model one", capturedOn: "2026-10-03", values: new Map() }) };
    expect([fileView(model, blank).table.rows.length, fileView(model, blank).none]).toEqual([0, "No setting of the calendar holds a value."]);
    expect([fileView(model, file).none, fileView(model, lineItems).none]).toEqual([undefined, undefined]);
    // The line says which of the rows' values the overview names: the workspace and the model, under About this export
    // (`ABOUT_SHOWN`). The template's five rows hold three values: the export cannot know the model's size or who captured
    // it, and leaves those two without one. The third, Captured on, is not said on the overview.
    expect(modelFacts(model)).toEqual([["Workspace", "Main"], ["Model", "Model one"], ["Captured on", "2026-10-03"]]);
    expect(overviewOf(model).about).toEqual(expect.arrayContaining(modelFacts(model).filter(([setting]) => ABOUT_SHOWN.includes(setting))));
    expect(overviewOf(model).about.some(([detail]) => detail === "Captured on")).toBe(false);
    expect(file.rows.filter(row => row[0] === "Model" && row[2] === "").map(row => row[1])).toEqual(["Model size (GB)", "Captured by"]);
    // Where the rows hold the workspace or the model's name, the line says the overview names it; where they hold neither,
    // only that the rows are not shown, which is all that is true of them. Spaces alone are no value.
    const facts = (...rows: [setting: string, value: string][]): ResultTable => ({ ...file, headers: ["Section", "Setting", "Value"],
      rows: [...rows.map(([setting, value]) => ["Model", setting, value]), ["Model Calendar", "Calendar Type", "Weeks: General"]] });
    expect([facts(["Workspace", "Main"], ["Captured on", "2026-10-03"]), facts(["Model", "One"], ["Workspace", " "], ["Other", "x"]), facts(["Fact 1", "a"], ["Fact 2", "b"]),
      facts(["Workspace", ""], ["Model", " "])].map(table => [fileView(model, table).note, modelFacts(result("model", [table])).length])).toEqual([
      [undefined, 2],
      [undefined, 2],
      [undefined, 2],
      [undefined, 0]]);
    // Of a file without one of the columns the overview reads them by it has nothing, and the line says the same.
    const bare: ResultTable = { ...file, headers: ["Section", "Setting"], rows: [["Model", "Workspace"], ["Model", "Model"], ["Model Calendar", "Calendar Type"]] };
    const one: ResultTable = { ...file, headers: ["Section", "Value"], rows: [["Model", "Main"], ["Model Calendar", "Weeks: General"]] };
    expect([fileView(model, bare).note, fileView(model, one).note, modelFacts(result("model", [bare])), modelFacts(result("model", [one]))])
      .toEqual([undefined, undefined, [], []]);
    expect(overviewOf(result("model", [only])).tiles).toEqual([]);
  });

  it("shows only line items, resolves their dimensions first, and keeps the result's full grid", () => {
    // The grid as the export writes it: each module's own row, then its line items; a dash under Applies To stands for the module's.
    const blueprint: ResultTable = { file: "Line Items.csv", label: "Line Items", guard: false, headers: ["", "Formula", "Applies To", "Module Name"], rows: [
      ["Revenue", "", "Products, Time", ""], ["Units", "", "-", "Revenue"], ["Price", "Units * 2", "Products", "Revenue"],
      ["--- Archive ---", "", "", ""], ["Costs", "", "Regions", ""], ["Rent", "", "-", "Costs"], ["Salaries", "", "-", "Costs"]] };
    const modules: ResultTable = { file: MODULES_FILE, label: "Modules", headers: ["", "Applies To"], rows: [["Revenue", "Products, Time"], ["--- Archive ---", ""], ["Costs", "Regions"]], guard: false };
    expect(MODULES_FILE).toBe("Modules.csv");
    const model = result("model", [modelDetails, blueprint, modules]);
    const shown = fileView(model, blueprint);
    // Each line item, with its module after its name and the dimensions it really has,
    // with where those came from.
    expect(shown.table).toEqual({ ...blueprint, headers: ["", "Module Name", "Formula", "Applies To", "Applies To from"], rows: [
      ["Units", "Revenue", "", "Products, Time", "Module"], ["Price", "Revenue", "Units * 2", "Products", "Line item"],
      ["Rent", "Costs", "", "Regions", "Module"], ["Salaries", "Costs", "", "Regions", "Module"]] });
    expect(shown.table).toEqual(lineItemsView(blueprint, undefined, { lineItemsOnly: true }).table);
    // No module or divider row stands in the page's table.
    expect(shown.table.rows.filter(row => shown.headings?.has(row)).map(row => row[0])).toEqual([]);
    // The note says what the table lists and where to find module settings.
    expect(shown.note).toBe("4 line items, each beside its module under Module Name. A module's own settings are in Modules.");
    expect(shown.none).toBeUndefined();
    const bare: ResultTable = { ...blueprint, rows: [blueprint.rows[0], blueprint.rows[4]] };
    const bareModel = result("model", [bare, modules]);
    expect(fileView(bareModel, bare).table.rows).toEqual([]);
    expect(fileView(bareModel, bare).note).toBe("0 line items, each beside its module under Module Name. A module's own settings are in Modules.");
    expect(overviewOf(bareModel).tiles.some(tile => tile.label === "Line Items")).toBe(false);
    expect(fileView(result("model", [blueprint]), blueprint).note).toBe("4 line items, each beside its module under Module Name. A module's own settings are in Modules. The Modules table was not exported, so a row with only a name is taken for a module's row.");
    // The file itself is as it was: a model's map is made of it.
    expect([blueprint.rows.length, blueprint.headers, blueprint.rows[1]]).toEqual([7, ["", "Formula", "Applies To", "Module Name"], ["Units", "", "-", "Revenue"]]);
    // The rule is that file's alone, in a model's result. An app's file of that name, a file of another name, and a Line
    // Items file that is not the grid (no column that names the module) are shown as they stand: the very table.
    const renamed: ResultTable = { ...blueprint, file: "Line Items (2).csv" };
    const flat: ResultTable = { ...blueprint, headers: ["", "Formula", "Applies To", "Module"] };
    expect([fileView(result("app", [appDetails, blueprint]), blueprint), fileView(model, renamed), fileView(model, flat)]).toEqual([{ table: blueprint }, { table: blankTable(renamed) }, { table: flat }]);
    expect(fileView(model, flat).table).toBe(flat);
    // The overview counts only line items; Modules still counts its own rows.
    expect(overviewOf(model).tiles).toEqual([expect.objectContaining({ label: "Modules", count: 3 }), expect.objectContaining({ label: "Line Items", count: 4 })]);
  });

  it("shows a model's Dynamic Cell Access file as it stands, under a line that says what it lists and how many of its rows have a driver that could not be matched", () => {
    // The file as the export writes it (model/access.ts): one row for each use of a driver, the driver first.
    const HEADERS = ["Driver Module", "Driver Line Item", "Access", "Controlled Module", "Controlled Line Item"];
    const file: ResultTable = { file: "Dynamic Cell Access.csv", label: "Dynamic Cell Access", guard: false, headers: HEADERS, rows: [
      ["ACC01 Access", "Can read", "Read", "REV01 Revenue", "Units"], ["ACC01 Access", "Can read", "Read", "REV01 Revenue", "Price"], ["ACC01 Access", "Can read", "Write", "REV01 Revenue", "Units"]] };
    expect(ACCESS_FILE).toBe("Dynamic Cell Access.csv");
    const model = result("model", [modelDetails, file]);
    const NO_DRIVERS = "No line item in this model has a read or write access driver.";
    // The table keeps every row and column, with no routine note. A row opens from the driver's name, its second column.
    const shown = fileView(model, file);
    expect([shown.table === file, shown.note, shown.opensFrom, shown.none, shown.exported]).toEqual([true, undefined, 1, undefined, undefined]);
    // A row whose driver the export matched to no line item has no Driver Module, and the driver as Line Items has it.
    // The line counts those rows, one and several, and says where they are and how to tell them.
    const unmatched: Cell[][] = [["", "Gone.Flag", "Read", "COST01 Costs", "Rates"], ["", "'Old access'.Can write", "Write", "COST01 Costs", ""]];
    const withOne: ResultTable = { ...file, rows: [...file.rows, unmatched[0]] };
    const withTwo: ResultTable = { ...file, rows: [...file.rows, ...unmatched] };
    expect([fileView(model, withOne).note, fileView(model, withTwo).note]).toEqual([
      `1 row has a driver that could not be matched to a line item: it comes last, with the driver as Line Items has it and no Driver Module.`,
      `2 rows have a driver that could not be matched to a line item: they come last, with the driver as Line Items has it and no Driver Module.`]);
    expect(fileView(model, withTwo).table).toBe(withTwo);
    // The count is read from the file's own rows, by that column wherever it stands and whatever the Details file says:
    // a row that names no module under Controlled Module is not counted for that. The row opens from the driver's name
    // wherever that column stands.
    const moved: ResultTable = { ...withTwo, headers: [...HEADERS.slice(1), HEADERS[0]], rows: [...withTwo.rows.map(row => [...row.slice(1), row[0]]), ["Can read", "Read", "", "Lost", "ACC01 Access"]] };
    expect([fileView(model, moved).note, fileView(model, moved).opensFrom]).toEqual([fileView(model, withTwo).note, 0]);
    // A model that drives no access has the file without rows; its empty state explains why.
    const empty: ResultTable = { ...file, rows: [] };
    expect(fileView(model, empty)).toEqual({ table: empty, note: undefined, empty: NO_DRIVERS, opensFrom: 1 });
    expect([shown.empty, fileView(model, modelDetails).empty, fileView(model, { ...file, file: "Versions.csv" }).empty]).toEqual([NO_DRIVERS, undefined, undefined]);
    // The tile and the navigation count every row of the file, the unmatched ones among them: the table leaves none out.
    expect(overviewOf(result("model", [modelDetails, withTwo])).tiles).toEqual([expect.objectContaining({ label: "DCA", count: 5, full: "Dynamic Cell Access (DCA)" })]);
    // The rule is that file's alone, in a model's result. An app's file of that name, a file of another name, and a file
    // of the name without the column are shown as they stand, without a line: the very table. A file of the name that
    // has the driver's module and not its name has the line, and opens its rows as any table does.
    const renamed: ResultTable = { ...file, file: "Dynamic Cell Access (2).csv" };
    const other: ResultTable = { ...file, headers: ["Driver", ...HEADERS.slice(1)] };
    expect([fileView(result("app", [appDetails, file]), file), fileView(model, renamed), fileView(model, other)]).toEqual([{ table: file }, { table: renamed }, { table: other }]);
    const unnamed: ResultTable = { ...file, headers: [HEADERS[0], "Driver", ...HEADERS.slice(2)] };
    expect(fileView(model, unnamed)).toEqual({ table: unnamed, note: undefined, empty: NO_DRIVERS });
  });

  // A model's Imports file as the export writes it: the Imports tab's own columns, then the import's columns from the
  // Actions list (model/actions.ts `mergeImports`). The first two Source Objects are the user's own examples; the names
  // are made up.
  const IMPORT_HEADERS = ["", "Source Label", "Source Object", "Source Type", "Target Object", "Target Type", "Used in Processes"];
  const imports = (rows: Cell[][], headers = IMPORT_HEADERS): ResultTable => ({ file: "Imports.csv", label: "Imports", guard: false, headers, rows });
  const HUB_VIEW = "M0 Data Hub [DEV] / 'HRY01 ORG Hierarchy Builder'.'DATA & LIST: ORG3 Area'";
  const OWN_VIEW = "'SYS ORG1 Campus #'.'DATA: SYS ORG1 Campus # (Reset)'";

  it("shows a model's Imports with Source Object as three columns, the source's model, module and saved view, and keeps the text that was read for a row's details", () => {
    const file = imports([
      ["Load areas", "M0 Data Hub [DEV] / HRY01 ORG Hierarchy Builder", HUB_VIEW, "SAVED VIEW", "ORG3 Area", "LIST", "Nightly load"],
      ["Reset campus", "SYS ORG1 Campus #", OWN_VIEW, "SAVED VIEW", "SYS ORG1 Campus", "MODULE", ""],
      ["Load regions", "Hub / Regions", "Hub / 'LIST - Regions'", "MODULE", "Regions", "LIST", ""],
      ["Prices from prices.csv", "prices.csv", "-", "FILE", "Prices", "MODULE", "Nightly load"]]);
    const kept = structuredClone(file);
    expect([IMPORTS_FILE, THIS_MODEL]).toEqual(["Imports.csv", "This model"]);
    const model = result("model", [modelDetails, file]);
    const shown = fileView(model, file);
    // The three columns stand in Source Object's place, and every other cell is the file's own, in its order.
    expect(shown.table.headers).toEqual(["", "Source Label", "Source Model", "Source Module", "Saved View", "Source Type", "Target Object", "Target Type", "Used in Processes"]);
    expect(shown.table.rows.map(row => [...row.slice(0, 2), ...row.slice(5)])).toEqual(file.rows.map(row => [...row.slice(0, 2), ...row.slice(3)]));
    expect(shown.table.rows.map(row => row.slice(2, 5))).toEqual([
      ["M0 Data Hub [DEV]", "HRY01 ORG Hierarchy Builder", "DATA & LIST: ORG3 Area"],
      // A Source Object that names no model reads from this model itself: Source Model names it.
      ["Model one", "SYS ORG1 Campus #", "DATA: SYS ORG1 Campus # (Reset)"],
      // A module named without a saved view leaves Saved View empty.
      ["Hub", "LIST - Regions", ""],
      // A file's import names no model's object: its dash shows blank.
      ["", "", ""]]);
    // The text that was read is kept for each row read, once: by the last of the three columns, and named as the file
    // names its column, so that a row's details show it as Source Object.
    expect([...shown.exported ?? []].map(([row, texts]) => [shown.table.rows.findIndex(candidate => candidate === row), [...texts]]))
      .toEqual([[0, [[4, HUB_VIEW]]], [1, [[4, OWN_VIEW]]], [2, [[4, "Hub / 'LIST - Regions'"]]]]);
    expect([[...shown.readUnder ?? []], shown.note]).toEqual([[[4, "Source Object"]], undefined]);
    // Where the export knew the model by its ID alone, Source Model says This model.
    const byId = fileView({ ...model, name: model.id }, file);
    expect([byId.table.rows[1].slice(2, 5), byId.note]).toEqual([[THIS_MODEL, "SYS ORG1 Campus #", "DATA: SYS ORG1 Campus # (Reset)"], undefined]);
    // The file itself is as it was: a model's map is made of the result's own tables. The rule keeps every row, so the tile
    // counts the file's own number.
    expect(file).toEqual(kept);
    expect(overviewOf(model).tiles).toEqual([expect.objectContaining({ label: "Imports", count: 4 })]);
    // The rule is that file's alone, in a model's result: an app's file of that name, and a file of another name, are shown as they stand.
    const renamed: ResultTable = { ...file, file: "Imports (2).csv" };
    expect([fileView(result("app", [appDetails, file]), file), fileView(model, renamed)]).toEqual([{ table: blankTable(file) }, { table: blankTable(renamed) }]);
  });

  it("reads an import's Source Object only where its Source Type is a saved view's or a module's, and leaves any other as it is under Source Model", () => {
    const file = imports([
      // Quoted names that hold a slash, a dot or a quote of their own.
      ["Slashed", "", "Hub / 'A / B'.'C.D'", "SAVED VIEW", "", "", ""],
      ["Quoted", "", "'Editor''s lock'.Grid", "Saved View", "", "", ""],
      // A file's import: the dash Anaplan writes, and a file's name, which is written as a module and a saved view would be.
      ["Dash", "prices.csv", "-", "FILE", "", "", ""],
      ["Named", "prices.csv", "prices.csv", "FILE", "", "", ""],
      // A list is no module, and a Source Type the rule does not know, or none, says no module either.
      ["List", "Hub / Products", "Hub / Products", "LIST", "", "", ""],
      ["Other", "", "Hub / 'M'.V", "DATASET", "", "", ""],
      ["Untyped", "", "Hub / 'M'.V", "", "", "", ""],
      // A saved view's import whose cell is not written as a model's object.
      ["Odd", "", "Hub/M.V", "SAVED VIEW", "", "", ""],
      // An import the Imports tab did not return: the row the Actions list gives it has nothing here.
      ["Old import", "", "", "", "", "", ""]]);
    const shown = fileView(result("model", [file]), file);
    expect(shown.table.rows.map(row => row.slice(2, 5))).toEqual([["Hub", "A / B", "C.D"], ["Model one", "Editor's lock", "Grid"],
      ...file.rows.slice(2).map(row => [tableText(row[2]), "", ""])]);
    expect([...shown.exported ?? []].map(([row]) => row[0])).toEqual(["Slashed", "Quoted"]);
    // The line counts the rows not read whose cell says something, and says where their text is: not the dash, and not an empty cell.
    expect(shown.note).toBe(`5 rows have a Source Object that is not a module or a saved view: their text stands as it is under Source Model.`);
    const one = imports([file.rows[0], file.rows[2], file.rows[4]]);
    expect(fileView(result("model", [one]), one).note).toBe(`1 row has a Source Object that is not a module or a saved view: its text stands as it is under Source Model.`);
    // A file without a row that is read, one without the Source Type column, and one without rows are shown as they stand,
    // with Source Object as the tab writes it: no column is named for what none of its cells holds.
    const files = imports(file.rows.slice(2, 4));
    const untyped = imports(file.rows.map(row => row.filter((_, index) => index !== 3)), IMPORT_HEADERS.filter(header => header !== "Source Type"));
    const none = imports([]);
    expect([fileView(result("model", [files]), files), fileView(result("model", [untyped]), untyped), fileView(result("model", [none]), none)])
      .toEqual([{ table: blankTable(files) }, { table: blankTable(untyped) }, { table: none }]);
  });

  // A model's Source Models file as the export writes it, as Anaplan's own export of the grid: each source model's name
  // first, then the grid's columns, with Mapped To as the mapping's definition. The keys are the ones a real model's cell
  // holds; the IDs and the names are made up.
  const WORKSPACE_ID = "aaaa1111bbbb2222cccc3333dddd4444";
  const MODEL_ID = "1111AAAA2222BBBB3333CCCC4444DDDD";
  const mapping = (fields: Record<string, unknown>): string => JSON.stringify(fields);
  const FINANCE = mapping({ workspaceId: WORKSPACE_ID, workspaceName: "Pedalwick Finance [DEV]", modelId: MODEL_ID, modelName: "Finance Hub" });
  const SALES = mapping({ workspaceId: "0123456789abcdef0123456789abcdef", workspaceName: "Sales", modelId: "FEDCBA9876543210FEDCBA9876543210", modelName: "Pipeline" });
  const sourceModels = (rows: Cell[][], headers = ["", "Mapped To", "Notes"]): ResultTable => ({ file: "Source Models.csv", label: "Source Models", guard: false, headers, rows });

  it("shows a model's Source Models file with Mapped To as two columns, the workspace and the model by name, and keeps the text that was read for a row's details", () => {
    const file = sourceModels([["Finance Hub (old)", FINANCE, "From the hub"], ["Pipeline", SALES, ""]]);
    const kept = structuredClone(file);
    expect(SOURCE_MODELS_FILE).toBe("Source Models.csv");
    const model = result("model", [modelDetails, file]);
    const shown = fileView(model, file);
    // The two columns stand in Mapped To's place, every other column stays where it was, and every row in its order.
    expect([shown.table.headers, shown.table.rows, shown.note]).toEqual([["", "Mapped Workspace", "Mapped Model", "Notes"],
      [["Finance Hub (old)", "Pedalwick Finance [DEV]", "Finance Hub", "From the hub"], ["Pipeline", "Sales", "Pipeline", ""]], undefined]);
    // The text that was read is kept for each row once, by the second of the two columns, and is named as the file names
    // its column: a row's details show it as Mapped To.
    expect([...shown.exported ?? []].map(([row, texts]) => [shown.table.rows.findIndex(candidate => candidate === row), [...texts]])).toEqual([[0, [[2, FINANCE]]], [1, [[2, SALES]]]]);
    expect([...shown.readUnder ?? []]).toEqual([[2, "Mapped To"]]);
    // The file itself is as it was: a model's map is made of the result's own tables.
    expect(file).toEqual(kept);
    // The rule keeps every row, so the tile counts the file's own number, and says no second one.
    expect(overviewOf(model).tiles).toEqual([expect.objectContaining({ label: "Source Models", count: 2 })]);
    // Wherever the column stands, the two take its place; a cell a row holds beyond the headers stays after them.
    const first = fileView(model, sourceModels([[FINANCE, "Finance Hub (old)", "beyond"]], ["Mapped To", ""]));
    expect([first.table.headers, first.table.rows, [...first.readUnder ?? []]])
      .toEqual([["Mapped Workspace", "Mapped Model", ""], [["Pedalwick Finance [DEV]", "Finance Hub", "Finance Hub (old)", "beyond"]], [[1, "Mapped To"]]]);
    // The rule is that file's alone, in a model's result. An app's file of that name, a file of another name, and a file
    // of the name without a column called exactly Mapped To are shown as they stand: the very table.
    const renamed: ResultTable = { ...file, file: "Source Models (2).csv" };
    const other = sourceModels(file.rows, ["", "Mapped to", "Notes"]);
    expect([fileView(result("app", [appDetails, file]), file), fileView(model, renamed), fileView(model, other)]).toEqual([{ table: file }, { table: renamed }, { table: other }]);
    expect(fileView(model, other).table).toBe(other);
  });

  it("says a source model's workspace or model by its ID where Mapped To gives no name for it, and never makes a name up", () => {
    const cases: [fields: Record<string, unknown>, workspace: string, model: string][] = [
      // No names at all: each by its ID, said as an ID.
      [{ workspaceId: WORKSPACE_ID, modelId: MODEL_ID }, `ID ${WORKSPACE_ID}`, `ID ${MODEL_ID}`],
      // A name that is empty, of spaces only, null or not text is no name.
      [{ workspaceId: WORKSPACE_ID, workspaceName: "", modelId: MODEL_ID, modelName: "   " }, `ID ${WORKSPACE_ID}`, `ID ${MODEL_ID}`],
      [{ workspaceId: WORKSPACE_ID, workspaceName: null, modelId: MODEL_ID, modelName: 42 }, `ID ${WORKSPACE_ID}`, `ID ${MODEL_ID}`],
      // One of the two by its name, the other by its ID.
      [{ workspaceId: WORKSPACE_ID, workspaceName: "Pedalwick Finance [DEV]", modelId: MODEL_ID }, "Pedalwick Finance [DEV]", `ID ${MODEL_ID}`],
      [{ workspaceId: WORKSPACE_ID, modelId: MODEL_ID, modelName: "Finance Hub" }, `ID ${WORKSPACE_ID}`, "Finance Hub"],
      // One of the two with neither its name nor its ID: its column says nothing, and nothing of the other stands in.
      [{ workspaceId: WORKSPACE_ID, workspaceName: "Pedalwick Finance [DEV]" }, "Pedalwick Finance [DEV]", ""],
      [{ workspaceId: "  ", modelId: MODEL_ID }, "", `ID ${MODEL_ID}`],
    ];
    const file = sourceModels(cases.map(([fields], index) => [`Source ${index + 1}`, mapping(fields), ""]));
    const shown = fileView(result("model", [file]), file);
    expect(shown.table.rows.map(row => [row[1], row[2]])).toEqual(cases.map(([, workspace, model]) => [workspace, model]));
    // Each cell was read: its text is kept for the row's details, where its IDs and all else it holds can be read.
    expect([...shown.exported ?? []].map(([, texts]) => texts.get(2))).toEqual(cases.map(([fields]) => mapping(fields)));
    expect(shown.note).toBe(undefined);
  });

  it("leaves a Mapped To that names neither a workspace nor a model as it is, and an empty one empty, and shows a file without a mapping as it stands", () => {
    const file = sourceModels([
      ["Finance Hub (old)", FINANCE, ""],
      // Text that is no JSON, text that only starts as an object, an object that names neither, and JSON that is no object.
      ["Typed", "Pedalwick Finance [DEV] / Finance Hub", ""], ["Cut short", '{"workspaceId":"aaaa1111bbbb2222cccc3333dddd4444","workspaceName":"Pedalwick', ""],
      ["Other keys", '{"workspace":"Finance","model":"Hub"}', ""], ["A list", '["Pedalwick Finance [DEV]","Finance Hub"]', ""],
      // Nothing: an empty cell, one of spaces only, and the dash Anaplan writes for none.
      ["Unmapped", "", ""], ["Blank", "  ", ""], ["Dashed", "-", ""]]);
    const shown = fileView(result("model", [file]), file);
    // Such a cell's text stands as it is under Mapped Workspace, and Mapped Model is empty. Nothing is kept for its row:
    // nothing of it was said in words.
    expect(shown.table.rows.map(row => row.slice(0, 3))).toEqual([["Finance Hub (old)", "Pedalwick Finance [DEV]", "Finance Hub"], ...file.rows.slice(1).map(row => [row[0], tableText(row[1]), ""])]);
    expect([...shown.exported ?? []].map(([row]) => row[0])).toEqual(["Finance Hub (old)"]);
    // The line counts the rows whose cell holds something that could not be read, and says where their text is, so that
    // it is not taken for a workspace's name. An empty cell, one of spaces only, or a dash says nothing, and is not counted.
    expect(shown.note).toBe(`4 rows have a Mapped To that could not be read: their text stands as it is under Mapped Workspace.`);
    const one = sourceModels([file.rows[0], file.rows[1], file.rows[5]]);
    expect(fileView(result("model", [one]), one).note).toBe(`1 row has a Mapped To that could not be read: its text stands as it is under Mapped Workspace.`);
    // A file none of whose cells is a mapping is not as the rule expects it: it is shown as it stands, under the grid's own
    // label, and no column is called a workspace that holds none. So is a file without rows; its tile counts none.
    const none = sourceModels(file.rows.slice(1));
    const empty = sourceModels([]);
    expect([fileView(result("model", [none]), none), fileView(result("model", [empty]), empty)]).toEqual([{ table: blankTable(none) }, { table: empty }]);
    expect([fileView(result("model", [none]), none).table === none, overviewOf(result("model", [empty])).tiles]).toEqual([false, []]);
  });

  it("says a model's definitions in words after the Source Models rule, and keeps the texts that both read", () => {
    // No Source Models grid has a Format column: one is made up here, to hold the words to what the rule kept.
    const NUMBER = '{"dataType":"NUMBER"}';
    const file = sourceModels([["Finance Hub (old)", FINANCE, NUMBER], ["Typed", "Finance / Hub", NUMBER]], ["", "Mapped To", "Format"]);
    const shown = fileView(result("model", [file]), file);
    expect(shown.table.rows).toEqual([["Finance Hub (old)", "Pedalwick Finance [DEV]", "Finance Hub", "Number"], ["Typed", "Finance / Hub", "", "Number"]]);
    // Each row is the one the drawer is given: what the rule kept of it is kept with what the words kept.
    expect([...shown.exported ?? []].map(([row, texts]) => [shown.table.rows.findIndex(candidate => candidate === row), [...texts]]))
      .toEqual([[0, [[2, FINANCE], [3, NUMBER]]], [1, [[3, NUMBER]]]]);
    expect([...shown.readUnder ?? []]).toEqual([[2, "Mapped To"]]);
  });

  it("tells a module's own row from a line item of which only the name was read, by the names in the Modules file", () => {
    const headers = ["", "Formula", "Applies To", "Module Name"];
    const grid = (rows: Cell[][]): ResultTable => ({ file: "Line Items.csv", label: "Line Items", guard: false, headers, rows });
    const modules: ResultTable = { file: MODULES_FILE, label: "Modules", headers: ["", "Applies To"], rows: [["Revenue", "Products, Time"], ["Costs", "Regions"]], guard: false };
    /** The table the page shows for the file, the line under its name, and what the overview's tile counts. */
    const shown = (file: ResultTable, others: ResultTable[]) => {
      const model = result("model", [file, ...others]);
      const view = fileView(model, file);
      return { rows: view.table.rows, note: view.note, tile: overviewOf(model).tiles.find(tile => tile.label === "Line Items") };
    };
    // A read that lost a row's cells gives of a line item only its name. Here that is Price, among its module's line
    // items. No module is called Price: it is a line item whose module is not known, the line counts it, and the line
    // item after it is still its module's.
    const among = grid([["Revenue", "", "Products, Time", ""], ["Units", "", "-", "Revenue"], ["Price", "", "", ""], ["Sales", "Units * Price", "-", "Revenue"]]);
    expect(shown(among, [modules])).toEqual({
      rows: [["Units", "Revenue", "", "Products, Time", "Module"], ["Price", "", "", "", ""],
        ["Sales", "Revenue", "Units * Price", "Products, Time", "Module"]],
      note: "3 line items, each beside its module under Module Name. A module's own settings are in Modules. 1 line item has no Module Name: its module is not known.",
      tile: expect.objectContaining({ label: "Line Items", count: 3 }) });
    // And here it is the last row under its module: it is a line item, not a module with nothing under its row.
    const last = grid([["Revenue", "", "Products, Time", ""], ["Units", "", "-", "Revenue"], ["Price", "", "", ""], ["Costs", "", "Regions", ""], ["Rent", "", "-", "Costs"]]);
    expect(shown(last, [modules])).toEqual({
      rows: [["Units", "Revenue", "", "Products, Time", "Module"], ["Price", "", "", "", ""],
        ["Rent", "Costs", "", "Regions", "Module"]],
      note: "3 line items, each beside its module under Module Name. A module's own settings are in Modules. 1 line item has no Module Name: its module is not known.",
      tile: expect.objectContaining({ label: "Line Items", count: 3 }) });
    // The names are the Modules file's first column, as the file has it: a module the file lists is a module's own row
    // also with nothing under it.
    const listed: ResultTable = { ...modules, rows: [...modules.rows, ["Price", ""]] };
    expect(shown(last, [listed])).toEqual({
      rows: [["Units", "Revenue", "", "Products, Time", "Module"], ["Rent", "Costs", "", "Regions", "Module"]],
      note: "2 line items, each beside its module under Module Name. A module's own settings are in Modules.",
      tile: expect.objectContaining({ label: "Line Items", count: 2 }) });
    // A name is the Modules file's only as the file writes it: listed with a space before or after it, Price is not the
    // row's name, and the row is a line item, as it is when the file does not list it at all.
    for (const spaced of [" Price", "Price ", " Price "]) {
      expect(shown(last, [{ ...modules, rows: [...modules.rows, [spaced, ""]] }]), JSON.stringify(spaced)).toEqual(shown(last, [modules]));
    }
    // A result without the Modules file, or with one that lists nothing, has no names to give: such a row is taken for a
    // module's own, as the view does by itself. The line says that the names could not be checked, and why: Price, of
    // which only the name was read, is among the rows it counts as modules' own.
    expect([shown(last, []).note, shown(last, [{ ...modules, rows: [] }]).note]).toEqual([
      `2 line items, each beside its module under Module Name. A module's own settings are in Modules. The Modules table was not exported, so a row with only a name is taken for a module's row.`,
      `2 line items, each beside its module under Module Name. A module's own settings are in Modules. The Modules table lists no modules, so a row with only a name is taken for a module's row.`]);
    expect([shown(last, []).rows, lineItemsView(last).warning]).toEqual([shown(last, [listed]).rows, undefined]);
    expect(shown(among, []).rows).toEqual([["Units", "Revenue", "", "Products, Time", "Module"], ["Sales", "Revenue", "Units * Price", "-", "Module (not found)"]]);
  });

  it("says under the Line Items table that no module's name could be checked, when the result has no Modules table with rows", () => {
    const headers = ["", "Formula", "Applies To", "Module Name"];
    const grid = (rows: Cell[][]): ResultTable => ({ file: "Line Items.csv", label: "Line Items", guard: false, headers, rows });
    const modules = (rows: Cell[][], label = "Modules"): ResultTable => ({ file: MODULES_FILE, label, headers: ["", "Applies To"], rows, guard: false });
    const note = (file: ResultTable, ...others: ResultTable[]) => fileView(result("model", [modelDetails, file, ...others]), file).note;
    const whole = grid([["Revenue", "", "Products, Time", ""], ["Units", "", "-", "Revenue"], ["Price", "Units * 2", "Products", "Revenue"]]);
    // The Modules file failed to export: the result has none. The line says so, and what that means for a row with only a name.
    expect(note(whole)).toBe(`2 line items, each beside its module under Module Name. A module's own settings are in Modules. The Modules table was not exported, so a row with only a name is taken for a module's row.`);
    // The file is there and lists nothing: the table is named as the page names it, and said to list no modules.
    expect(note(whole, modules([]))).toBe(`2 line items, each beside its module under Module Name. A module's own settings are in Modules. The Modules table lists no modules, so a row with only a name is taken for a module's row.`);
    expect(note(whole, modules([], "All modules"))).toBe(`2 line items, each beside its module under Module Name. A module's own settings are in Modules. The All modules table lists no modules, so a row with only a name is taken for a module's row.`);
    // With a Modules table that has rows the names were checked, and nothing is added: also when it does not list this module.
    expect([note(whole, modules([["Revenue", "Products, Time"]])), note(whole, modules([["Costs", "Regions"]]))]).toEqual(["2 line items, each beside its module under Module Name. A module's own settings are in Modules.", "2 line items, each beside its module under Module Name. A module's own settings are in Modules."]);
    // The sentence is the line's last: after the line items whose module is not known.
    const mixed = grid([["Revenue", "", "Products, Time", ""], ["Units", "", "-", "Revenue"], ["Lost", "Units * 2", "-", ""], ["--- Archive ---", "", "", ""]]);
    expect(note(mixed)).toBe("2 line items, each beside its module under Module Name. A module's own settings are in Modules. 1 line item has no Module Name: its module is not known. The Modules table was not exported, so a row with only a name is taken for a module's row.");
    // A grid with only modules' own rows lists zero line items and still explains the missing module names.
    const bare = grid([["Revenue", "", "Products, Time", ""], ["Costs", "", "Regions", ""]]);
    const bareShown = fileView(result("model", [bare]), bare);
    expect([bareShown.table.rows.length, bareShown.none, bareShown.note]).toEqual([0, undefined,
      "0 line items, each beside its module under Module Name. A module's own settings are in Modules. The Modules table was not exported, so a row with only a name is taken for a module's row."]);
    // A table already holding only line items still has the page's columns and note.
    const flat = grid([["Units", "", "-", "Revenue"], ["Price", "Units * 2", "Products", "Revenue"]]);
    expect(fileView(result("model", [flat, modules([["Revenue", "Products"]])]), flat).note).toBe("2 line items, each beside its module under Module Name. A module's own settings are in Modules.");
    expect(fileView(result("app", [appDetails, whole]), whole)).toEqual({ table: whole });
  });

  it("says a model's definitions in words in the table's place, and keeps the text that was read for each cell it says so", () => {
    const NUMBER = '{"dataType":"NUMBER"}';
    const PERCENT = '{"minimumSignificantDigits":-1,"decimalPlaces":2,"unitsType":"PERCENTAGE","dataType":"NUMBER"}';
    const LIST = '{"hierarchyEntityLongId":101000000047,"dataType":"ENTITY"}';
    const SUM = '{"summaryMethod":"SUM","timeSummaryMethod":"SUM"}';
    const NO_SUMMARY = '{"summaryMethod":"NONE","timeSummaryMethod":"NONE"}';
    const RATIO = '{"summaryMethod":"RATIO","timeSummaryMethod":"RATIO","ratioNumeratorIdentifier":"_1901000000003_","ratioDenominatorIdentifier":"_1901000000002_"}';
    const lineItems: ResultTable = { file: "Line Items.csv", label: "Line Items", guard: false, headers: ["", "Format", "Formula", "Summary", "Ratio Numerator", "Ratio Denominator"], rows: [
      ["Units", NUMBER, "", SUM, "", ""],
      ["Margin %", PERCENT, "Margin / Revenue", RATIO, "Margin", "Revenue"],
      ["Region", LIST, "", NO_SUMMARY, "", ""],
      ["--- Checks ---", "", "", "", "", ""],
      ["Odd", "Number", '{"dataType":"NUMBER"}', '{"summaryMethod":7}', "", ""]] };
    const kept = structuredClone(lineItems);
    const model = result("model", [modelDetails, lineItems]);
    const shown = fileView(model, lineItems);
    // A Format and a Summary are said as Anaplan says them. A Ratio names what it divides by its own row's two cells; a
    // list is said by its ID where the file has no Format List column to name it, as here.
    expect(shown.table).toEqual({ ...lineItems, rows: [
      ["Units", "Number", "", "Sum", "", ""],
      ["Margin %", "Number, 2 decimal places, %", "Margin / Revenue", "Ratio = Margin / Revenue", "Margin", "Revenue"],
      ["Region", "List: ID 101000000047", "", "None", "", ""],
      ["--- Checks ---", "", "", "", "", ""],
      // What is no definition stays as it is: a plain text, a definition under another column, one the words are not known for.
      ["Odd", "Number", '{"dataType":"NUMBER"}', '{"summaryMethod":7}', "", ""]] });
    // For each cell said in words, the text that was read, by the table's row and the column's place; a row with no such cell is the file's own row.
    expect([...shown.exported ?? []].map(([row, texts]) => [shown.table.rows.findIndex(candidate => candidate === row), [...texts]]))
      .toEqual([[0, [[1, NUMBER], [3, SUM]]], [1, [[1, PERCENT], [3, RATIO]]], [2, [[1, LIST], [3, NO_SUMMARY]]]]);
    expect([shown.table.rows[3] === lineItems.rows[3], shown.table.rows[4] === lineItems.rows[4], shown.table.rows[0] === lineItems.rows[0]]).toEqual([true, true, false]);
    // The file itself is as it was: a model's map is made of it.
    expect(lineItems).toEqual(kept);
    // Without the two columns a Ratio says its line items by their IDs.
    const bare: ResultTable = { ...lineItems, headers: ["", "Format", "Formula", "Summary"], rows: [["Margin %", PERCENT, "", RATIO]] };
    expect(fileView(result("model", [bare]), bare).table.rows).toEqual([["Margin %", "Number, 2 decimal places, %", "", "Ratio = ID 1901000000003 / ID 1901000000002"]]);

    // An action's definition, in any of a model's files: the words where they are known, the cell as it is where not.
    const actions: ResultTable = { file: "Other Actions.csv", label: "Other Actions", guard: false, headers: ["", "Action", "Notes"],
      rows: [["Delete old items", '{"actionType":"DELETE_BY_SELECTION"}', ""], ["Send plan", '{"exportType":"GRID_CURRENT_PAGE"}', '{"actionType":"PROCESS"}']] };
    const said = fileView(result("model", [actions]), actions);
    expect([said.table.rows, [...said.exported ?? []].map(([, texts]) => [...texts])])
      .toEqual([[["Delete old items", "Delete from List using Selection", ""], ["Send plan", '{"exportType":"GRID_CURRENT_PAGE"}', '{"actionType":"PROCESS"}']], [[[1, '{"actionType":"DELETE_BY_SELECTION"}']]]]);

    // A table with none of the three columns, and one none of whose cells is a definition, are the file as it stands, with nothing kept.
    const modules: ResultTable = { file: MODULES_FILE, label: "Modules", headers: ["", "Applies To"], rows: [["Revenue", '{"dataType":"NUMBER"}']], guard: false };
    const plain: ResultTable = { ...lineItems, rows: [["Units", "Number", "", "Sum", "", ""]] };
    expect([fileView(result("model", [modules]), modules), fileView(result("model", [plain]), plain)]).toEqual([{ table: modules }, { table: plain }]);
    expect(fileView(result("model", [plain]), plain).table).toBe(plain);
    // An app's tables are never said in words, whatever their columns are called and hold.
    const app = result("app", [appDetails, lineItems, actions]);
    expect([fileView(app, lineItems), fileView(app, actions)]).toEqual([{ table: lineItems }, { table: actions }]);
    expect(fileView(app, lineItems).table).toBe(lineItems);
  });

  it("says the words after a file's own rule: the Line Items table has them in the columns the view moved", () => {
    const NUMBER = '{"dataType":"NUMBER"}';
    const RATIO = '{"summaryMethod":"RATIO","timeSummaryMethod":"RATIO","ratioNumeratorIdentifier":"_1901000000003_","ratioDenominatorIdentifier":"_1901000000002_"}';
    const blueprint: ResultTable = { file: "Line Items.csv", label: "Line Items", guard: false, headers: ["", "Format", "Summary", "Applies To", "Module Name", "Ratio Numerator", "Ratio Denominator"], rows: [
      ["Revenue", "", "", "Products, Time", "", "", ""],
      ["Units", NUMBER, '{"summaryMethod":"SUM","timeSummaryMethod":"SUM"}', "-", "Revenue", "", ""],
      ["Margin %", NUMBER, RATIO, "-", "Revenue", "Margin", "Units"]] };
    const model = result("model", [modelDetails, blueprint]);
    const shown = fileView(model, blueprint);
    expect([shown.table.headers, shown.table.rows, shown.note]).toEqual([["", "Module Name", "Format", "Format type", "Summary", "Applies To", "Applies To from", "Ratio Numerator",
      "Ratio Denominator"], [
      ["Units", "Revenue", "Number", "Number", "Sum", "Products, Time", "Module", "", ""],
      ["Margin %", "Revenue", "Number", "Number", "Ratio = Margin / Units", "Products, Time", "Module", "Margin", "Units"]],
    "2 line items, each beside its module under Module Name. A module's own settings are in Modules. The Modules table was not exported, so a row with only a name is taken for a module's row."]);
    // What is kept is by the shown table's rows and columns: Format stands third there, and second in the file; Summary
    // stands after the format's data type, which is no definition and is not said again.
    expect([...shown.exported ?? []].map(([row, texts]) => [shown.table.rows.findIndex(candidate => candidate === row), [...texts]]))
      .toEqual([[0, [[2, NUMBER], [4, '{"summaryMethod":"SUM","timeSummaryMethod":"SUM"}']]], [1, [[2, NUMBER], [4, RATIO]]]]);
    // Saying the cells in words adds no module row back.
    expect(shown.table.rows.filter(row => shown.headings?.has(row)).map(row => row[0])).toEqual([]);
    // The words change no row: the tile counts the two line items.
    expect(overviewOf(model).tiles).toEqual([expect.objectContaining({ label: "Line Items", count: 2 })]);
    expect(blueprint.rows[1]).toEqual(["Units", NUMBER, '{"summaryMethod":"SUM","timeSummaryMethod":"SUM"}', "-", "Revenue", "", ""]);
  });

  it("says a list format with the list's name from its own row's Format List cell, and with the list's ID where that cell is empty", () => {
    const list = (id: number, changes: Record<string, unknown> = {}): string =>
      JSON.stringify({ hierarchyEntityLongId: id, entityFormatFilter: null, selectiveAccessApplied: false, showAll: false, dataType: "ENTITY", ...changes });
    const NUMBER = '{"dataType":"NUMBER"}';
    const SUM = '{"summaryMethod":"SUM","timeSummaryMethod":"SUM"}';
    const NO_SUMMARY = '{"summaryMethod":"NONE","timeSummaryMethod":"NONE"}';
    // The Line Items file as the export writes it: Format List last, with a general list's name and nothing for any other list.
    const headers = ["", "Format", "Summary", "Applies To", "Module Name", "Ratio Numerator", "Ratio Denominator", "Format List"];
    const lineItems: ResultTable = { file: "Line Items.csv", label: "Line Items", guard: false, headers, rows: [
      ["Orders", "", "", "Products, Time", "", "", "", ""],
      ["Product", list(101000000007), NO_SUMMARY, "-", "Orders", "", "", "Products"],
      ["Region", list(101000000008, { selectiveAccessApplied: true }), NO_SUMMARY, "-", "Orders", "", "", "Regions <b>& more</b>"],
      ["Active product", list(109000000004), NO_SUMMARY, "-", "Orders", "", "", ""],
      ["Units", NUMBER, SUM, "-", "Orders", "", "", ""],
      // What only the page could be given: a name of spaces, which says nothing; a name beside a format that is no list's;
      // and another name for a list a row above has named. The name is the row's own cell, asked of no other row.
      ["Spaces", list(101000000009), NO_SUMMARY, "-", "Orders", "", "", "  "],
      ["Named number", NUMBER, SUM, "-", "Orders", "", "", "Products"],
      ["Product again", list(101000000007), NO_SUMMARY, "-", "Orders", "", "", "Product catalogue"]] };
    const kept = structuredClone(lineItems);
    const model = result("model", [modelDetails, lineItems]);
    const shown = fileView(model, lineItems);
    // The view keeps the column where the file has it, the last; the words stand in the Format column, and the data type
    // after it says List for each of them.
    expect(shown.table.headers).toEqual(["", "Module Name", "Format", "Format type", "Summary", "Applies To", "Applies To from", "Ratio Numerator", "Ratio Denominator", "Format List"]);
    const cells = (header: string) => shown.table.rows.map(row => row[shown.table.headers.indexOf(header)]);
    expect([cells(""), cells("Format"), cells("Format type"), cells("Format List")]).toEqual([
      ["Product", "Region", "Active product", "Units", "Spaces", "Named number", "Product again"],
      ["List: Products", "List: Regions <b>& more</b>, filter: selective access", "List: ID 109000000004", "Number", "List: ID 101000000009", "Number", "List: Product catalogue"],
      ["List", "List", "List", "Number", "List", "Number", "List"],
      ["Products", "Regions <b>& more</b>", "", "", "  ", "Products", "Product catalogue"]]);
    // The text that was read is kept for the Format and the Summary, as before. The Format List cell is the file's own, and has none.
    expect([...shown.exported?.get(shown.table.rows[0]) ?? []]).toEqual([[2, list(101000000007)], [4, NO_SUMMARY]]);
    // These three columns start hidden and remain available, as plain text with a filter by list.
    expect(columnsOf(shown.table).slice(-3).map(column => [column.label, column.kind, column.hidden, column.filter])).toEqual([
      ["Ratio Numerator", "text", true, true], ["Ratio Denominator", "text", true, true], ["Format List", "text", true, true]]);
    // The file itself is as it was: a model's map is made of it.
    expect(lineItems).toEqual(kept);

    // The file as it stands (no row of it is a module's own) is said the same way.
    const flat: ResultTable = { ...lineItems, rows: lineItems.rows.slice(1, 3) };
    expect(fileView(result("model", [flat]), flat).table.rows.map(row => row[2])).toEqual(["List: Products", "List: Regions <b>& more</b>, filter: selective access"]);
    // Without the column, as a result of an earlier version has the file, a list is said by its ID.
    const before: ResultTable = { ...lineItems, headers: headers.slice(0, -1), rows: lineItems.rows.slice(1, 3).map(row => row.slice(0, -1)) };
    expect(fileView(result("model", [before]), before).table.rows.map(row => row[2])).toEqual(["List: ID 101000000007", "List: ID 101000000008, filter: selective access"]);
    // The column is the Line Items file's: in another of a model's files a column of that name names no list.
    const other: ResultTable = { ...flat, file: "Line Items (2).csv" };
    expect(fileView(result("model", [other]), other).table.rows.map(row => row[1])).toEqual(["List: ID 101000000007", "List: ID 101000000008, filter: selective access"]);
    // An app's tables are never said in words.
    expect(fileView(result("app", [appDetails, flat]), flat)).toEqual({ table: flat });
  });

  it("says an action that deletes from a list or orders one with the list's name from its own row's Action List cell, and with the list's ID where that cell is empty", () => {
    const action = (actionType: string, hierarchyIdentifier?: string): string => JSON.stringify({ actionType, hierarchyIdentifier, filterLineItemIdentifier: "_1901000000031_" });
    // The Other Actions file as the export writes it: the Actions list's own columns, then Action List, with a general
    // list's name for an action that names one, and nothing for any other list or action.
    const headers = ["", "Action", "Start Date and Time (UTC)", "Most recent duration (ms)", "Notes", "Used in Processes", "Used in Dashboards", "Action List"];
    const actions: ResultTable = { file: "Other Actions.csv", label: "Other Actions", guard: false, headers, rows: [
      ["Delete old products", action("DELETE_BY_SELECTION", "_101000000007_"), "", "", "", "Nightly load", "", "Products"],
      ["Order regions", action("ORDER_HIERARCHY", "_101000000008_"), "", "", "", "", "", "Regions <b>& more</b>"],
      // An ID that General Lists does not hold, here of a list subset's entity type: the export names no list for it, and
      // the page says the ID.
      ["Order active products", action("ORDER_HIERARCHY", "_109000000004_"), "", "", "", "", "", ""],
      // An action of those two kinds that names no list, and one of a kind that names none: each is said by its label.
      ["Delete flagged", action("DELETE_BY_SELECTION"), "", "", "", "", "", ""],
      ["Copy forecast", action("BULK_COPY", "_101000000007_"), "", "", "", "", "", ""],
      // What only the page could be given: a name that holds what `replace` would read as patterns of its own, a name of
      // spaces, which says nothing, and a name beside an action that names no list.
      ["Delete odd", action("DELETE_BY_SELECTION", "_101000000010_"), "", "", "", "", "", "$& <b>$1</b> $' List"],
      ["Order spaces", action("ORDER_HIERARCHY", "_101000000009_"), "", "", "", "", "", "  "],
      ["Update period", action("UPDATE_CURRENT_PERIOD"), "", "", "", "", "", "Products"]] };
    const kept = structuredClone(actions);
    const shown = fileView(result("model", [modelDetails, actions]), actions);
    // The words stand in the Action column. The Action List column is the file's own, cell for cell.
    expect(shown.table.headers).toEqual(headers);
    const cells = (header: string) => shown.table.rows.map(row => row[shown.table.headers.indexOf(header)]);
    expect([cells(""), cells("Action"), cells("Action List")]).toEqual([actions.rows.map(row => row[0]),
      ["Delete from Products using Selection", "Order Regions <b>& more</b>", "Order list ID 109000000004", "Delete from List using Selection", "Bulk Copy",
        "Delete from $& <b>$1</b> $' List using Selection", "Order list ID 101000000009", "Update Current Period"],
      actions.rows.map(row => row[7])]);
    // The text that was read is kept for each Action, as for any cell said in words.
    expect([...shown.exported?.get(shown.table.rows[0]) ?? []]).toEqual([[1, actions.rows[0][1]]]);
    // The column is a column like any other: plain text, shown, with a filter by list.
    expect(columnsOf(shown.table).filter(column => column.label === "Action List").map(column => [column.label, column.kind, column.hidden, column.filter])).toEqual([["Action List", "text", false, true]]);
    // The file itself is as it was: a model's map is made of it.
    expect(actions).toEqual(kept);

    // Without the column, as a result of an earlier version has the file, a list is said by its ID.
    const before: ResultTable = { ...actions, headers: headers.slice(0, -1), rows: actions.rows.slice(0, 2).map(row => row.slice(0, -1)) };
    const byId = ["Delete from list ID 101000000007 using Selection", "Order list ID 101000000008"];
    expect(fileView(result("model", [before]), before).table.rows.map(row => row[1])).toEqual(byId);
    // The column is the Other Actions file's: in another of a model's files a column of that name names no list, and in
    // this file a column named as Line Items names a list format's list names none. The Processes table keeps an Action
    // column that holds something, after the actions it adds.
    const other: ResultTable = { ...actions, file: "Processes.csv", rows: actions.rows.slice(0, 2) };
    const formatList: ResultTable = { ...actions, headers: [...headers.slice(0, -1), "Format List"], rows: actions.rows.slice(0, 2) };
    const actionCells = (table: ResultTable) => {
      const view = fileView(result("model", [table]), table).table;
      return view.rows.map(row => row[view.headers.indexOf("Action")]);
    };
    expect([other, formatList].map(actionCells)).toEqual([byId, byId]);
    // An app's tables are never said in words.
    expect(fileView(result("app", [appDetails, actions]), actions)).toEqual({ table: actions });
  });

  it("shows a model's Processes without Used in Processes or an Action that no process has, and with the actions each runs right after its name", () => {
    // The Processes file as the export writes it: the Actions list's own columns, of which Used in Processes and Action say
    // nothing of a process, as Anaplan runs no process inside another.
    const headers = ["", "Action", "Start Date and Time (UTC)", "Most recent duration (ms)", "Notes", "Used in Processes", "Used in Dashboards"];
    const processes: ResultTable = { file: "Processes.csv", label: "Processes", guard: false, headers, rows: [
      ["Nightly load", "", "2026-03-12 23:19:56", "582", "Runs at 2am", "", "Admin"], ["Weekly load", "", "", "", "", "", ""], ["Empty", "", "", "", "", "", ""],
      // Two processes of one name: each is the process in its place among them.
      ["Twin", "", "", "", "", "", ""], ["Twin", "", "", "", "", "", "", "beyond"]] };
    const used = ["", "Notes", "Used in Processes"];
    const imports: ResultTable = { file: "Imports.csv", label: "Imports", guard: false, headers: used,
      rows: [["Prices from the hub", "", "Nightly load"], ["1.1 Load regions", "", "Nightly load, Weekly load"]] };
    const exports: ResultTable = { file: "Exports.csv", label: "Exports", guard: false, headers: used, rows: [["Send plan", "", "Weekly load"]] };
    const others: ResultTable = { file: "Other Actions.csv", label: "Other Actions", guard: false, headers: used, rows: [["Delete old items", "", "Nightly load, Twin"]] };
    const tables = [modelDetails, processes, imports, exports, others];
    const kept = structuredClone(processes);
    const shownAs = (model: AnalysisResult) => {
      const view = fileView(model, processes).table;
      return [view.headers, view.rows];
    };
    // Each process with its actions, in the order it runs them, as the export reads them out of its definition: the
    // Actions column holds them, with a comma and a space between them. A process that runs none has the cell empty.
    const ordered: AnalysisResult = { ...result("model", tables), processActions: [
      { id: "118000000001", name: "Nightly load", actions: [{ id: "112000000002", name: "Prices from the hub", type: "IMPORT" },
        { id: "112000000001", name: "1.1 Load regions", type: "IMPORT" }, { id: "117000000001", name: "Delete old items", type: "ACTION" }] },
      { id: "118000000002", name: "Weekly load", actions: [{ id: "116000000001", name: "Send plan", type: "EXPORT" }, { id: "112000000099", name: "ID 112000000099", type: "IMPORT" }] },
      { id: "118000000003", name: "Empty", actions: [] },
      { id: "118000000004", name: "Twin", actions: [{ id: "116000000001", name: "Send plan", type: "EXPORT" }] },
      { id: "118000000005", name: "Twin", actions: [{ id: "117000000001", name: "Delete old items", type: "ACTION" }] }] };
    const kept1 = ["", "Actions", "Start Date and Time (UTC)", "Most recent duration (ms)", "Notes", "Used in Dashboards"];
    expect(shownAs(ordered)).toEqual([kept1, [
      ["Nightly load", "Prices from the hub, 1.1 Load regions, Delete old items", "2026-03-12 23:19:56", "582", "Runs at 2am", "Admin"],
      ["Weekly load", "Send plan, ID 112000000099", "", "", "", ""], ["Empty", "", "", "", "", ""],
      ["Twin", "Send plan", "", "", "", ""], ["Twin", "Delete old items", "", "", "", "", "beyond"]]]);
    // Without the processes' own actions, as a result of an earlier version has it, each lists the actions whose Used in
    // Processes names it, by kind: imports, then exports, then other actions. Both processes named Twin are named so.
    expect(shownAs(result("model", tables))[1].map(row => [row[0], row[1]])).toEqual([["Nightly load", "Prices from the hub, 1.1 Load regions, Delete old items"],
      ["Weekly load", "1.1 Load regions, Send plan"], ["Empty", ""], ["Twin", "Delete old items"], ["Twin", "Delete old items"]]);
    // A process whose definition could not be read is said by those too, beside the others' own.
    const unread = { ...ordered, processActions: ordered.processActions!.map(process => (process.name === "Weekly load" ? { ...process, actions: [], note: "Not read." } : process)) };
    expect(shownAs(unread)[1].map(row => row[1])).toEqual(["Prices from the hub, 1.1 Load regions, Delete old items", "1.1 Load regions, Send plan", "", "Send plan", "Delete old items"]);
    // An Action that a process has after all is kept, after the actions: only an Action no process has is left out.
    const withAction = { ...processes, rows: processes.rows.map((row, at) => (at === 1 ? row.map((cell, index) => (index === 1 ? "Something" : cell)) : row)) };
    expect(fileView(ordered, withAction).table.headers).toEqual(["", "Actions", "Action", "Start Date and Time (UTC)", "Most recent duration (ms)", "Notes", "Used in Dashboards"]);
    // The Actions column is a column like any other: plain text, shown, with a filter by each action (cell-lists.ts).
    expect(columnsOf(fileView(ordered, processes).table).slice(0, 2).map(column => [column.label, column.kind, column.hidden])).toEqual([["Name", "text", false], ["Actions", "text", false]]);
    // The file itself is as it was: the model map is made of it. The other actions' tables keep their Used in Processes.
    expect(processes).toEqual(kept);
    expect([imports, exports, others].map(table => fileView(ordered, table).table.headers)).toEqual([used, used, used]);
    // An app's tables are never shaped so, whatever they are called.
    expect(fileView(result("app", [appDetails, processes]), processes)).toEqual({ table: processes });
  });

  it("says under a table of the pages built on a model how many of its rows name something the model doesn't have, at what, and what to do", () => {
    const table = (file: string, headers: readonly string[], rows: Record<string, Cell>[]): ResultTable =>
      ({ file, label: file.replace(/\.csv$/, ""), headers: [...headers], rows: rows.map(row => headers.map(header => row[header] ?? NONE)), guard: true });
    const [GONE_MODULE, GONE_ITEM] = ["Missing module (ID 102000000556)", "Missing line item (ID 1916000000014)"];
    const page = (n: number) => ({ App: "Planning app", Page: `Board ${n}`, "Page type": "Board", "App ID": "0f1e2d3c-4b5a-4968-8778-695a4b3c2d1e", "Page ID": `page-${n}` });
    const filter = (n: number, card: string, cells: Record<string, Cell>) => ({ "Condition line item's module": "Demand", "Condition line item": "Volume", "Filtered module": "Demand",
      ...page(n), "Card ID": card, ...cells });
    // The row of the screenshot that asked what this is: a filter of a module and by a line item the model doesn't have.
    const gone = filter(1, "card-1", { "Condition line item's module": MISSING_LINE_ITEMS_MODULE, "Condition line item": GONE_ITEM, "Filtered module": GONE_MODULE });
    const filters = table(PAGE_FILTERS_FILE, PAGE_FILTERS_HEADERS, [gone, filter(1, "card-2", {})]);
    const model = result("model", [modelDetails, filters]);
    const OPEN = "deleted since the page was built, or hidden from you.";
    expect(fileView(model, filters)).toEqual({ table: { ...filters, rows: [blankTable(filters).rows[1], blankTable(filters).rows[0]] }, note: `1 filter points at a module and a line item this model doesn't have: ${OPEN} Open its page to fix the card.` });
    // Each thing is counted once by its ID, however many rows name it; the rows by card and by page.
    const more = table(PAGE_FILTERS_FILE, PAGE_FILTERS_HEADERS, [gone, filter(1, "card-1", { "Filtered module": GONE_MODULE }),
      filter(1, "card-3", { "Filtered module": "Demand; Missing module (ID 102000000557)" })]);
    expect(fileView(model, more).note).toBe(`3 filters point at 2 modules and a line item this model doesn't have: ${OPEN} Open the page to fix the cards.`);
    const pages = table(PAGE_FILTERS_FILE, PAGE_FILTERS_HEADERS, [gone, filter(2, "card-1", { "Condition line item's module": MISSING_LINE_ITEMS_MODULE,
      "Condition line item": "Missing line item (ID 1916000000015)" })]);
    expect(fileView(model, pages).note).toBe("2 filters point at a module and 2 line items this model doesn't have: deleted since the pages were built, or hidden from you. "
      + "Open their pages to fix the cards.");
    // A button, by the kind of the model's action it runs.
    const actions = table(PAGE_ACTIONS_FILE, PAGE_ACTIONS_HEADERS, [{ "Model action name": "Missing process (ID 118000000003)", "Action type": "Process", ...page(1), "Card ID": "card-4" },
      { "Model action name": "Missing import (ID 112000000009)", "Action type": "Import", ...page(1), "Card ID": "card-4" }, { "Model action name": "Load prices", ...page(1) }]);
    expect(fileView(model, actions).note).toBe(`2 buttons run an import and a process this model doesn't have: ${OPEN} Open the page to fix the card.`);
    // Module Usage counts the pages that use a module the model doesn't have.
    const usage = table(MODULE_USAGE_FILE, MODULE_USAGE_HEADERS, [{ Module: "Demand", ...page(1) }, { Module: GONE_MODULE, ...page(1) }, { Module: GONE_MODULE, ...page(2) },
      { Module: "Unused" }]);
    expect(fileView(model, usage).note).toBe("2 pages use a module this model doesn't have: deleted since the pages were built, or hidden from you. Open them to fix their cards.");
    const once = { ...usage, rows: usage.rows.slice(0, 2) };
    expect(fileView(model, once).note).toBe(`1 page uses a module this model doesn't have: ${OPEN} Open it to fix its cards.`);
    // A table that names nothing Missing is as it stands, with no line; so is one an earlier version kept, which said
    // "(not in the model)"; and an app's table is never touched.
    const fine = { ...filters, rows: filters.rows.slice(1) };
    const earlier = table(MODULE_USAGE_FILE, MODULE_USAGE_HEADERS, [{ Module: "102000000556 (not in the model)", ...page(1) }]);
    expect([fileView(model, fine), fileView(model, earlier), fileView(result("app", [appDetails, filters]), filters)]).toEqual([{ table: blankTable(fine) }, { table: blankTable(earlier) }, { table: blankTable(filters) }]);
    // The table is the file as it stands: its tile counts its rows, and the IDs are in the cells a search reads.
    expect(fileView(model, filters).table.rows).toEqual([blankTable(filters).rows[1], blankTable(filters).rows[0]]);
    expect(overviewOf(result("model", [modelDetails, filters])).tiles.find(tile => tile.label === "Page Filters")?.count).toBe(2);
  });

  it("says a Model Calendar's tile by the kind of its calendar and its current fiscal year, not by a count", () => {
    /** The tile of a model whose Model Calendar has these settings, and no other. */
    const tileOf = (settings: [setting: string, value: string][], kind: "model" | "app" = "model") => overviewOf(result(kind, [{ file: "Model Calendar.csv", label: "Model Calendar",
      headers: ["Section", "Setting", "Value"], rows: settings.map(([setting, value]) => ["Model Calendar", setting, value]), guard: false }])).tiles[0];
    const type = (value: string): [string, string] => ["Calendar Type", value];
    const year = (value: string): [string, string] => ["Current Fiscal Year", value];
    // A months calendar is Monthly, with its current fiscal year's label under it; the title has the type as written and the
    // year's dates, as the export writes them after the label.
    expect(tileOf([type("Calendar Months/Quarters/Years"), year("FY24: 1 Jan 2024 - 31 Dec 2024")])).toEqual(expect.objectContaining({ label: "Model Calendar", count: 2, value: "Monthly", detail: "FY24",
      title: "Model Calendar: Calendar Months/Quarters/Years, current fiscal year FY24 (1 Jan 2024 - 31 Dec 2024)" }));
    // Each of Anaplan's weeks calendars is Weekly. A 4-4-5 one says the grouping its setting gives, a 13-period one that it
    // has 13 periods, and a general one how many weeks it has, where its setting gives a number of them.
    expect(tileOf([type("Weeks: 4-4-5, 4-5-4 or 5-4-4"), ["Week Grouping into Months / Qtrs", "4-5-4"], year("FY2025")])).toEqual(expect.objectContaining({ label: "Model Calendar", count: 3,
      value: "Weekly", detail: "4-5-4 · FY2025", title: "Model Calendar: Weeks: 4-4-5, 4-5-4 or 5-4-4, grouped 4-5-4, current fiscal year FY2025" }));
    expect([tileOf([type("Weeks: 13 4-week Periods"), year("FY24: 31 Dec 2023 - 28 Dec 2024")]), tileOf([type("Weeks: General"), ["Number of Weeks", "52"]])]
      .map(tile => [tile.value, tile.detail])).toEqual([["Weekly", "13 periods · FY24"], ["Weekly", "52 weeks"]]);
    // A 4-4-5 calendar whose grouping is not given, and a general one of no weeks, say only that they are weekly.
    expect([tileOf([type("Weeks: 4-4-5, 4-5-4 or 5-4-4")]), tileOf([type("Weeks: General"), ["Number of Weeks", "0"]])].map(tile => [tile.value, tile.detail]))
      .toEqual([["Weekly", undefined], ["Weekly", undefined]]);
    // A type stored as its ID, where its label was not read, is the same type; a type of another text is said by what it
    // names, and otherwise as it is written, up to its first colon or slash.
    expect(["25000000000", "25000000001", "25000000002", "25000000003", "weeks: some new pattern", "Months of 5 weeks", "Quarters/Years", "Seasons: Spring"]
      .map(text => tileOf([type(text)]).value)).toEqual(["Monthly", "Weekly", "Weekly", "Weekly", "Weekly", "Monthly", "Quarters", "Seasons"]);
    // Without a type, the current year is the tile's value; without either, the tile counts the rows its table lists, as
    // every other tile does.
    expect(tileOf([year("FY24: 1 Jan 2024 - 31 Dec 2024")])).toEqual(expect.objectContaining({ label: "Model Calendar", count: 1, value: "FY24",
      title: "Model Calendar: current fiscal year FY24 (1 Jan 2024 - 31 Dec 2024)" }));
    expect([tileOf([["Fiscal Year Starts", "Jan"]]), tileOf([type(" "), year("")])]).toEqual([expect.objectContaining({ label: "Model Calendar", count: 1 }), expect.objectContaining({ label: "Model Calendar", count: 1 })]);
    // A file without the columns these are read by, and an app's file of that name, are counted.
    expect(overviewOf(result("model", [{ file: "Model Calendar.csv", label: "Model Calendar", headers: ["Section", "Name", "Value"], rows: [["Model Calendar", "Calendar Type", "Weeks: General"]],
      guard: false }])).tiles[0]).toEqual(expect.objectContaining({ label: "Model Calendar", count: 1 }));
    expect(tileOf([type("Weeks: General")], "app")).toEqual(expect.objectContaining({ label: "Model Calendar", count: 1 }));
  });

  it("says under About this export the workspace and its ID, what was read and its ID, and its apps or models: in that order and no more", () => {
    // A model's rows in another order, with every row About does not say among them.
    const model = detailsTable("Model Details.csv", [
      ["Model", "Apps", "Sales app\nOps app"], ...exportRows("eu2a.app.anaplan.com", new Date(Date.UTC(2026, 9, 3, 9, 30, 0))), ["Model", "Model ID", "0123456789ABCDEF0123456789ABCDEF"],
      ["Model", "Model", "Model one"], ["Something new", "A detail", "its value"], ["Model", "Workspace ID", "3333dddd4444eeee5555ffff6666aaaa"], ["Model", "Workspace", "Main"],
    ]);
    expect(overviewOf(result("model", [model, calendar()])).about).toEqual([["Workspace", "Main"], ["Workspace ID", "3333dddd4444eeee5555ffff6666aaaa"],
      ["Model", "Model one"], ["Model ID", "0123456789ABCDEF0123456789ABCDEF"], ["Apps", "Sales app\nOps app"]]);
    // A row the result does not have leaves no gap: here no apps and no workspace ID.
    expect(overviewOf(result("model", [detailsTable("Model Details.csv", [["Model", "Model ID", "X1"], ["Model", "Model", "Model one"], ["Model", "Workspace", "Main"]])])).about)
      .toEqual([["Workspace", "Main"], ["Model", "Model one"], ["Model ID", "X1"]]);
    // An app: the app and its ID, then the models it is built on; not its categories, pages or cards, nor the export's
    // host, time and tool. An app names no workspace of its own, so it has none.
    const app = detailsTable("App Details.csv", [
      ["App", "App", "Demo app"], ["App", "App ID", "01234567-89ab-cdef-0123-456789abcdef"], ["App", "Categories", "Demand"], ["App", "Pages", "3 (3 boards)"],
      ["App", "Pages analysed", "3 of 3 (published versions)"], ["App", "Cards", 12], ["App", "Models", "Model one (Main)"],
      ...exportRows("us1a.app.anaplan.com", new Date(Date.UTC(2026, 9, 3, 14, 2, 5))),
    ]);
    expect(overviewOf(result("app", [app])).about).toEqual([["App", "Demo app"], ["App ID", "01234567-89ab-cdef-0123-456789abcdef"], ["Models", "Model one (Main)"]]);
    // An app whose pages name no model says no models: the Details file's dash is no value.
    expect(overviewOf(result("app", [detailsTable("App Details.csv", [["App", "App", "Demo app"], ["App", "Models", NONE]])])).about).toEqual([["App", "Demo app"]]);
    // The list itself: the two kinds of result share it.
    expect(ABOUT_SHOWN).toEqual(["Workspace", "Workspace ID", "App", "App ID", "Model", "Model ID", "Models", "Apps"]);
  });

  it("reads the model's own facts out of its Model Calendar file, without the ones that have no value", () => {
    const model = result("model", [modelDetails, calendar("Main", "Demand: plan")]);
    // The export cannot know the model's size or who captured it: those two are empty, and are not facts.
    expect(modelFacts(model)).toEqual([["Workspace", "Main"], ["Model", "Demand: plan"], ["Captured on", "2026-10-03"]]);
    expect(modelFacts(result("model", [modelDetails, calendar("", "Demand: plan")]))).toEqual([["Model", "Demand: plan"], ["Captured on", "2026-10-03"]]);
    // A value that was filled in is one; a value of spaces only is none.
    const filled = calendar();
    filled.rows[2][2] = "12.5";
    filled.rows[4][2] = "  ";
    expect(modelFacts(result("model", [filled])).map(fact => fact[0])).toEqual(["Workspace", "Model", "Model size (GB)", "Captured on"]);
    // Nothing for an app, for a model without the file, and for a file without those columns.
    expect([modelFacts(result("app", [appDetails, calendar()])), modelFacts(result("model", [modelDetails])),
      modelFacts(result("model", [{ ...calendar(), headers: ["Section", "Name", "Value"] }]))]).toEqual([[], [], []]);
    // About this export names the workspace and the model once each, from the Details file: the calendar's Captured on and
    // the export's host, time and tool are not said there.
    const overview = overviewOf(result("model", [modelDetails, calendar()], ["Model Calendar: 31 rows"]));
    expect([overview.about, overview.tiles]).toEqual([[["Workspace", "Main"], ["Model", "Model one"]],
      [expect.objectContaining({ label: "Model Calendar", count: 5, value: "Monthly", title: "Model Calendar: Calendar Months/Quarters/Years" })]]);
    // Where the two say different things, the Details file's value is the one said; a fact fills in only what the Details
    // file does not say, or says with a dash.
    expect(overviewOf(result("model", [modelDetails, calendar("Another workspace")])).about).toEqual([["Workspace", "Main"], ["Model", "Model one"]]);
    const dashed = detailsTable("Model Details.csv", [["Model", "Model", "Model one"], ["Model", "Workspace", NONE]]);
    expect(overviewOf(result("model", [dashed, calendar("Another workspace")])).about).toEqual([["Workspace", "Another workspace"], ["Model", "Model one"]]);
    // Without a Details file the facts are all the overview has about the export.
    expect(overviewOf(result("model", [calendar()])).about).toEqual([["Workspace", "Main"], ["Model", "Model one"]]);
    // The summary's line that says how many rows the file has is still no note: it counts the file, as it was read.
    expect(overview.notes).toEqual(["Actions: the Actions list came without Notes; the diagnostic log lists the columns it had."]);
  });

  it("names, for a card's parts, only columns the app's files really have", () => {
    expect(CARD_PARTS.map(part => part.file).filter(file => !(file in FILES))).toEqual([]);
    for (const part of CARD_PARTS) {
      const headers = HEADERS[FILES[part.file]];
      expect(part.columns.flatMap(([, names]) => names).filter(name => !headers.includes(name)), part.file).toEqual([]);
      expect(["Page", "Card ID"].filter(name => !headers.includes(name)), part.file).toEqual([]);
    }
  });

  it("lists a card's parts: the rows of the other files with its Card ID on its page", () => {
    const sections = appTable("Grid Sections.csv", [
      { Page: "Overview", "Card ID": "card-a", "Section #": 1, "Section layout": "Own rows and columns", "Source module": "REP01 Sales", "Line items shown": "All line items (Line Items on columns)", "Row filter": "2 conditions, match all" },
      { Page: "Overview", "Card ID": "card-a", "Section #": 2, "Source module": "REP02 Margin" },
      { Page: "Overview", "Card ID": "card-b", "Section #": 1, "Source module": "REP03 Stores" },
      // A page copied in Anaplan may keep its cards' IDs: the same Card ID on another page is another card.
      { Page: "Overview (copy)", "Card ID": "card-a", "Section #": 1, "Source module": "REP09 Copy" },
    ]);
    const filters = appTable("Filters.csv", [
      { Page: "Overview", "Card ID": "card-a", "Section #": "1", "Filter on": "Rows", "Filtered dimension": "Products", "Condition group": "1", "Show items that match": "All",
        "Condition line item": "Sales", Operator: "is greater than", Value: "10,000", "Condition context": "Time = current" },
      { Page: "Overview", "Card ID": "card-a", "Section #": "1", "Filter on": "Rows", "Filtered dimension": "Products", "Condition group": "1.1", "Show items that match": "Any",
        "Condition line item": "Margin %", Operator: "is not blank" },
    ]);
    const buttons = appTable("Action Buttons.csv", []);
    const parts = cardSections(result("app", [appDetails, sections, filters, buttons]), "Overview", "card-a");
    expect(parts.map(part => [part.title, part.rows.length])).toEqual([["Grid sections", 2], ["Filters", 2], ["Buttons & links", 0]]);
    expect(parts[0].headings).toEqual(["#", "Layout", "Source module", "Saved view", "Line items shown", "Row filter", "Formatting"]);
    expect(parts[0].rows).toEqual([
      ["1", "Own rows and columns", "REP01 Sales", "-", "All line items (Line Items on columns)", "2 conditions, match all", "-"],
      ["2", "-", "REP02 Margin", "-", "-", "-", "-"],
    ]);
    // Group and Condition put several columns side by side; a dash among them is left out, and nothing at all is one dash.
    expect(parts[1].headings).toEqual(["Sec", "Filter on", "Dimension", "Group", "Condition", "Context"]);
    expect(parts[1].rows).toEqual([
      ["1", "Rows", "Products", "1 · All", "Sales is greater than 10,000", "Time = current"],
      ["1", "Rows", "Products", "1.1 · Any", "Margin % is not blank", "-"],
    ]);
    expect(parts[2]).toEqual({ title: "Buttons & links", none: "buttons", headings: ["Label", "Action type", "Model action", "Runs auto", "Cancel"],
      colours: [false, false, false, false, false], rows: [] });
    // The colour stops of a formatting rule are the one part of a card whose colours show as squares, a stop to a line.
    const formatting = appTable("Conditional Formatting.csv", [{ Page: "Overview", "Card ID": "card-a", "Section #": "1", "Format style": "Background",
      "Formatted line item": "Sales", "Colour driven by": "Sales", "Colour stops": "#FFFFFF at 0; #F9E95C at 3" }]);
    expect(cardSections(result("app", [formatting]), "Overview", "card-a").map(part => [part.title, part.colours, part.rows]))
      .toEqual([["Conditional formatting", [false, false, false, false, true], [["1", "Background", "Sales", "Sales", ["#FFFFFF at 0", "#F9E95C at 3"]]]]]);
    expect(parts.flatMap(part => part.colours)).not.toContain(true);
    expect(cardSections(result("app", [sections]), "Overview (copy)", "card-a")[0].rows.map(row => row[2])).toEqual(["REP09 Copy"]);
    expect(cardSections(result("app", [sections]), "Stores", "card-a")[0].rows).toEqual([]);
  });

  it("leaves out a part whose file is missing or cannot be matched to a card", () => {
    const noId: ResultTable = { file: "Filters.csv", label: "Filters", headers: ["Page", "Card #"], rows: [["Overview", 1]], guard: true };
    const composed: ResultTable = { file: "Filters.csv", label: "Filters", headers: ["Page", "Card ID", "Operator"], rows: [["Overview", "card-a", "is blank"], ["Overview", "card-a", "-"]], guard: true };
    expect(cardSections(result("app", [noId]), "Overview", "card-a")).toEqual([]);
    expect(cardSections(result("model", []), "Overview", "card-a")).toEqual([]);
    // A column the file lacks is an empty cell, or left out of a cell made of several.
    expect(cardSections(result("app", [composed]), "Overview", "card-a")[0].rows).toEqual([["", "", "", "-", "is blank", ""], ["", "", "", "-", "-", ""]]);
    // Asked for a card's number as well, a file without that column cannot be matched to the card either.
    expect(cardSections(result("app", [composed]), "Overview", "card-a", "1")).toEqual([]);
  });

  it("gives a part's cell that lists several items as those items, cut where the report joined them, and every other cell as its text", () => {
    const filters = appTable("Filters.csv", [
      { Page: "Overview", "Card ID": "card-a", "Section #": "1, 2 (shared rows)", "Filtered dimension": "Products, Regions", "Condition group": "1", "Show items that match": "All",
        "Condition line item": "Sales", Operator: "is greater than", Value: "10, 20", "Condition context": "Time = current; Version = Actual" },
      { Page: "Overview", "Card ID": "card-a", "Section #": "1", "Condition line item": "Margin %", Operator: "is not blank", "Condition context": "Time = current" }]);
    const formatting = appTable("Conditional Formatting.csv", [
      { Page: "Overview", "Card ID": "card-a", "Section #": "1", "Format style": "Background", "Formatted line item": "Sales", "Colour stops": "#FFFFFF at 0; #627786 at 100,000" },
      // A KPI's indicator says what it has in one sentence, whose semicolon is no join of the report's.
      { Page: "Overview", "Card ID": "card-a", "Format style": "KPI indicator – threshold icons", "Formatted line item": "KPI value",
        "Colour stops": "2 icons (arrow up, flag red); no threshold values set" }]);
    const [filterPart, formattingPart] = cardSections(result("app", [filters, formatting]), "Overview", "card-a");
    // The context is one column's cell, joined with "; ". The sections, the dimensions and the values hold a comma that a
    // name or a value may hold too, and a column of several put side by side is their texts as they stand.
    expect(filterPart.rows).toEqual([
      ["1, 2 (shared rows)", NONE, "Products, Regions", "1 · All", "Sales is greater than 10, 20", ["Time = current", "Version = Actual"]],
      ["1", NONE, NONE, NONE, "Margin % is not blank", "Time = current"]]);
    expect(formattingPart.rows).toEqual([["1", "Background", "Sales", NONE, ["#FFFFFF at 0", "#627786 at 100,000"]], [NONE, "KPI indicator – threshold icons", "KPI value", NONE,
      "2 icons (arrow up, flag red); no threshold values set"]]);
    // The tables themselves are as the report wrote them.
    expect([filters.rows[0][filters.headers.indexOf("Condition context")], formatting.rows[0][formatting.headers.indexOf("Colour stops")]])
      .toEqual(["Time = current; Version = Actual", "#FFFFFF at 0; #627786 at 100,000"]);
  });

  // Two pages are called Overview, and the second is a copy that kept its cards' IDs. The files have only a page's name,
  // so the cards of both are under the one name: Sales with one number and one ID on both, Margin moved to another place
  // on the copy, Notes with nothing in any other file, and a card of its own on each page. Another page has a card
  // with an ID of theirs.
  const sharedCards = appTable("Cards.csv", [
    { Page: "Overview", "Card #": 1, "Card title": "Sales", "Card ID": "card-a" },
    { Page: "Overview", "Card #": 2, "Card title": "Margin", "Card ID": "card-b" },
    { Page: "Overview", "Card #": 3, "Card title": "Notes", "Card ID": "card-n" },
    { Page: "Overview", "Card #": 4, "Card title": "Stock", "Card ID": "card-s" },
    { Page: "Overview", "Card #": 1, "Card title": "Sales, copied", "Card ID": "card-a" },
    { Page: "Overview", "Card #": 3, "Card title": "Notes, copied", "Card ID": "card-n" },
    { Page: "Overview", "Card #": 4, "Card title": "Costs", "Card ID": "card-c" },
    { Page: "Overview", "Card #": 5, "Card title": "Margin, moved", "Card ID": "card-b" },
    { Page: "Stores", "Card #": 1, "Card title": "Stores", "Card ID": "card-a" },
  ]);
  const sharedSections = appTable("Grid Sections.csv", [
    { Page: "Overview", "Card #": 1, "Card ID": "card-a", "Section #": 1, "Source module": "REP01 Sales" },
    { Page: "Overview", "Card #": 2, "Card ID": "card-b", "Section #": 1, "Source module": "REP02 Margin" },
    { Page: "Overview", "Card #": 4, "Card ID": "card-s", "Section #": 1, "Source module": "REP04 Stock" },
    { Page: "Overview", "Card #": 1, "Card ID": "card-a", "Section #": 1, "Source module": "REP09 Sales copy" },
    { Page: "Overview", "Card #": 4, "Card ID": "card-c", "Section #": 1, "Source module": "REP05 Costs" },
    { Page: "Overview", "Card #": 5, "Card ID": "card-b", "Section #": 1, "Source module": "REP08 Margin copy" },
    { Page: "Stores", "Card #": 1, "Card ID": "card-a", "Section #": 1, "Source module": "REP06 Stores" },
  ]);
  const sharedFilters = appTable("Filters.csv", [
    { Page: "Overview", "Card #": 1, "Card ID": "card-a", "Section #": 1, "Condition line item": "Sales", Operator: "is not blank" },
    { Page: "Overview", "Card #": 5, "Card ID": "card-b", "Section #": 1, "Condition line item": "Margin %", Operator: "is not blank" },
  ]);
  const shared = result("app", [appDetails, sharedCards, sharedSections, sharedFilters, appTable("Action Buttons.csv", [])]);
  /** A card's parts by the card's title: each part with what names its rows (a grid section's module, a filter's
   * condition), and the line about the parts that are left out. */
  const partsOf = (app: AnalysisResult, title: string) => {
    const cards = cardsOf(app);
    const row = cards?.table.rows.find(candidate => candidate[2] === title);
    if (!cards || !row) throw new Error(`The result has no card called ${title}.`);
    const { sections, note } = cardParts(app, cards, row);
    const named = (section: { headings: string[] }) => Math.max(section.headings.indexOf("Source module"), section.headings.indexOf("Condition"), 0);
    return { parts: sections.map(section => [section.title, section.rows.map(cells => cells[named(section)])]), note };
  };

  it("leaves out the parts of a card that cannot be told from another card's, and says so in their place", () => {
    // Sales is one card on each of the two pages, with one number and one ID. A grid section or a filter that carries
    // them is on either: it is not listed as this card's, whichever of the two the card is, and a line says why. A part
    // that no row carries them in is one that neither card has: it is listed, empty, as for any card.
    const note = '2 cards on pages named "Overview" have this number and this ID. '
      + "The tables have only the name of a card's page, so their grid sections and filters cannot be told apart and are not listed here.";
    for (const title of ["Sales", "Sales, copied"]) expect(partsOf(shared, title), title).toEqual({ parts: [["Buttons & links", []]], note });
    // The line names the parts it is about: here the grid sections alone, and three cards.
    const three = result("app", [appTable("Cards.csv", [1, 2, 3].map(copy => ({ Page: "Overview", "Card #": 1, "Card title": `Sales ${copy}`, "Card ID": "card-a" }))), sharedSections, appTable("Filters.csv", [])]);
    expect(partsOf(three, "Sales 2")).toEqual({ parts: [["Filters", []]],
      note: '3 cards on pages named "Overview" have this number and this ID. The tables have only the name of a card\'s page, so their grid sections cannot be told apart and are not listed here.' });
    // Notes is on both pages too, and no other file has a row of it: neither card has any part, and nothing is left to say.
    for (const title of ["Notes", "Notes, copied"]) expect(partsOf(shared, title), title).toEqual({ parts: [["Grid sections", []], ["Filters", []], ["Buttons & links", []]], note: undefined });
  });

  it("lists the parts of a card that the files do tell from every other, by its ID or by its number", () => {
    // Margin kept its ID on the copy and stands in another place there: each of the two has the rows with its own number.
    expect(partsOf(shared, "Margin")).toEqual({ parts: [["Grid sections", ["REP02 Margin"]], ["Filters", []], ["Buttons & links", []]], note: undefined });
    expect(partsOf(shared, "Margin, moved")).toEqual({ parts: [["Grid sections", ["REP08 Margin copy"]], ["Filters", ["Margin % is not blank"]], ["Buttons & links", []]], note: undefined });
    // Stock and Costs have one number, on the two pages, and each its own ID.
    expect([partsOf(shared, "Stock").parts[0], partsOf(shared, "Costs").parts[0], partsOf(shared, "Stock").note, partsOf(shared, "Costs").note])
      .toEqual([["Grid sections", ["REP04 Stock"]], ["Grid sections", ["REP05 Costs"]], undefined, undefined]);
    // A card on a page of another name has the ID of the Sales cards: it is known by its page.
    expect(partsOf(shared, "Stores")).toEqual({ parts: [["Grid sections", ["REP06 Stores"]], ["Filters", []], ["Buttons & links", []]], note: undefined });
    // A card that alone has its page's name and its ID is not asked for its number in the other files: its rows are those
    // with its page and its ID, as before.
    const unnumbered = result("app", [appTable("Cards.csv", [{ Page: "Overview", "Card #": 1, "Card title": "Sales", "Card ID": "card-a" }]),
      appTable("Grid Sections.csv", [{ Page: "Overview", "Card ID": "card-a", "Source module": "REP01 Sales" }])]);
    expect(partsOf(unnumbered, "Sales")).toEqual({ parts: [["Grid sections", ["REP01 Sales"]]], note: undefined });
  });

  it("says of cards without a number only that they share their ID", () => {
    // A Cards file without the Card # column: two cards of one page name and one ID are not told apart by anything.
    const cards: ResultTable = { file: "Cards.csv", label: "Cards", headers: ["Page", "Card title", "Card ID"], rows: [["Overview", "Sales", "card-a"], ["Overview", "Sales, copied", "card-a"]], guard: true };
    const app = result("app", [cards, sharedSections]);
    const found = cardsOf(app);
    if (!found) throw new Error("The result has a Cards file.");
    expect(cardParts(app, found, cards.rows[1])).toEqual({ sections: [],
      note: '2 cards on pages named "Overview" have this ID. The tables have only the name of a card\'s page, so their grid sections cannot be told apart and are not listed here.' });
  });
});

describe("The names the page gives two of a model's tables", () => {
  const plain = (file: string, label: string, rows: Cell[][] = [["one", "x"]]): ResultTable => ({ file, label, headers: ["", "Value"], rows, guard: false });

  it("calls Import Data Sources Data Sources and Dynamic Cell Access DCA, by their files, whatever label a result carries, and any other table by its own label", () => {
    // A kept result's tables carry the export's labels, as a new result's do: the page names them by their files all the same.
    expect([tableLabel(plain("Import Data Sources.csv", "Import Data Sources")), tableLabel(plain(ACCESS_FILE, "Dynamic Cell Access")), tableLabel(plain(IMPORTS_FILE, "Imports"))])
      .toEqual(["Data Sources", "DCA", "Imports"]);
    // Only the short name that stands for a longer one says it in full.
    expect([tableFullLabel(plain(ACCESS_FILE, "Dynamic Cell Access")), tableFullLabel(plain("Import Data Sources.csv", "Import Data Sources")), tableFullLabel(plain(IMPORTS_FILE, "Imports"))])
      .toEqual(["Dynamic Cell Access (DCA)", undefined, undefined]);
  });

  it("says the overview's rows about files, how to read the tables and the notes under the page's names, and keeps the files' own names", () => {
    const details = detailsTable("Model Details.csv", [["Model", "Model", "Model one"],
      ["Files", "Import Data Sources.csv", "2 rows (1 of them a file)"], ["Files", ACCESS_FILE, "Not exported: Line Items has no driver columns."],
      ["Notes", "Import Data Sources", "One source could not be read."],
      ["How to read", "Import Data Sources", "Each data source."], ["How to read", "Dynamic Cell Access", "The drivers."], ["How to read", "Imports", "The imports."]]);
    const sources = plain("Import Data Sources.csv", "Import Data Sources", [["prices.csv", "x"], ["hub", "y"]]);
    const model = result("model", [details, sources], ["Import Data Sources: 2 rows (1 of them a file)"]);
    const overview = overviewOf(model);
    // A file the result has no table of, Dynamic Cell Access here, is named as the page names it too.
    expect(overview.files).toEqual([["Data Sources", "2 rows (1 of them a file)"], ["DCA", "Not exported: Line Items has no driver columns."]]);
    expect(overview.howToRead).toEqual([["Data Sources", "Each data source."], ["DCA", "The drivers."], ["Imports", "The imports."]]);
    expect(overview.notes).toEqual(["Data Sources: One source could not be read."]);
    expect(overview.tiles).toEqual([expect.objectContaining({ label: "Data Sources", count: 2 })]);
    // The result keeps the export's file and label: the page knows the table by its file everywhere else.
    expect([sources.file, sources.label, listedTables(model).map(({ table }) => table.file)]).toEqual(["Import Data Sources.csv", "Import Data Sources", ["Import Data Sources.csv"]]);
  });
});
