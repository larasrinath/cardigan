import { describe, expect, it } from "vitest";
import { DETAILS_HEADERS, diagnosticRows, exportRows, type DetailRow } from "../details.js";
import { HEADERS, type TabName } from "../report.js";
import { CALENDAR_HEADERS, calendarRows } from "../model/calendar.js";
import type { AnalysisResult, Cell, ResultTable } from "../result-types.js";
import { APP_FILES, cardsOf, columnsOf } from "./columns.js";
import { lineItemsView } from "./line-items-view.js";
import { ABOUT_MODEL, ACCESS_FILE, analysedOf, CARD_PARTS, cardParts, cardSections, detailSections, detailsOf, detailValue, diagnosticLog, FILE_RULES, fileView, listedTables, MODEL_CALENDAR_FILE, MODEL_FILE_ORDER,
  modelFacts, MODULES_FILE, overviewOf, resultNotes } from "./result-view.js";

/** The app export's files, as the page names them, and the report table each holds. */
const FILES: Record<string, TabName> = Object.fromEntries((Object.keys(APP_FILES) as TabName[]).map(tab => [APP_FILES[tab], tab]));
// A run's log as the tab writes it: its first line names the build, what is read and the host (progress.ts `firstLine`).
const LOG = "14:02:05 Cardigan dev: app 01234567-89ab-cdef-0123-456789abcdef on us1a.app.anaplan.com\r\n14:02:06 app: 2 pages\r\nplain line\r\n14:02:07 ";
const detailsTable = (file: string, rows: DetailRow[]): ResultTable => ({ file, label: file.replace(/\.csv$/, ""), headers: DETAILS_HEADERS, rows, guard: true, details: true });
/** An app file with the report's real headers; each row gives only the columns it cares about, the rest are dashes. */
const appTable = (file: string, rows: Record<string, Cell>[]): ResultTable => {
  const headers = HEADERS[FILES[file]];
  return { file, label: file.replace(/\.csv$/, ""), headers, rows: rows.map(row => headers.map(header => row[header] ?? "—")), guard: true };
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
    expect([analysedOf(named).host, resultNotes(named), overviewOf(named).tiles.map(tile => tile.label)]).toEqual([undefined, [], ["Line Items", "Model Details"]]);
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
    // The three are under Tables, each once, by the name the page has for the table; the note that is one is the only note.
    expect([overview.notes, overview.files]).toEqual([["Actions: the Actions list came without Notes."], [["Imports", "3 rows (2 matched in the Actions list)"],
      ["Exports", "Not exported: the grid did not load"], ["Source Models", "Not exported: This model page has no REMOTE_MODEL axis."]]]);
    expect(resultNotes(result("model", tables, summary))).toEqual(overview.notes);
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

  it("counts for the overview: each file's rows, an app's cards by type and its models", () => {
    const pages = appTable("Pages.csv", [
      { Page: "Overview", Model: "Demo model", Workspace: "Main", "Model ID": "0123456789ABCDEF0123456789ABCDEF" },
      { Page: "Stores", Model: "Demo model", Workspace: "Main", "Model ID": "0123456789ABCDEF0123456789ABCDEF" },
      { Page: "Archive", Model: "Other model", Workspace: "Old", "Model ID": "FEDCBA9876543210FEDCBA9876543210" },
      { Page: "Legacy archive" },
    ]);
    const cards = appTable("Cards.csv", [{ "Card type": "KPI" }, { "Card type": "Grid" }, { "Card type": "Text" }, { "Card type": "Grid" }, { "Card type": "Chart" }, { "Card type": "KPI" }]);
    expect(overviewOf(result("app", [appDetails, pages, cards, appTable("Filters.csv", [])]))).toEqual({
      tiles: [{ label: "Pages", count: 4 }, { label: "Cards", count: 6 }, { label: "Filters", count: 0 }],
      cardTypes: [["Grid", 2], ["KPI", 2], ["Chart", 1], ["Text", 1]],
      models: [{ model: "Demo model", workspace: "Main", modelId: "0123456789ABCDEF0123456789ABCDEF" }, { model: "Other model", workspace: "Old", modelId: "FEDCBA9876543210FEDCBA9876543210" }],
      notes: ["Legacy archive: Not published", "Names: Demo model: the model is closed, so IDs are shown instead of names."],
      // What the Details file says besides: what was read, in the file's order; the tables whose row says something else than
      // the file's own number of rows (here the Details file was written for fewer rows); how to read them; and the log.
      about: [["App", "Demo app"], ["App ID", "01234567-89ab-cdef-0123-456789abcdef"], ["Cards", "3"], ["Exported on", "2026-10-03 14:02 UTC"], ["Exported with", "Cardigan dev"],
        ["Anaplan host", "us1a.app.anaplan.com"]],
      files: [["Pages", "2 rows"], ["Cards", "3 rows"]],
      howToRead: [["Page and Card #", "Identify a card in every table."]],
      log: diagnosticLog(appDetails),
    });
  });

  it("names an app's tiles by the design's shorter names, and any other file's by the file's own", () => {
    const every = (Object.values(APP_FILES)).map(file => appTable(file, []));
    expect(overviewOf(result("app", [appDetails, ...every])).tiles.map(tile => tile.label)).toEqual(
      ["Pages", "Cards", "Grid sections", "Filters", "Formatting rules", "Action buttons", "Where Used"]);
    // The file's own label is not what names the tile, and a file the app export does not have keeps its label.
    const renamed: ResultTable = { ...appTable("Conditional Formatting.csv", []), label: "Something else" };
    const other: ResultTable = { file: "Formatting rules.csv", label: "Formatting rules of mine", headers: [""], rows: [["a"]], guard: false };
    expect(overviewOf(result("app", [renamed, other])).tiles).toEqual([{ label: "Formatting rules", count: 0 }, { label: "Formatting rules of mine", count: 1 }]);
    // The navigation and the table's own heading keep the file's name: only the tile is short.
    expect(appTable("Conditional Formatting.csv", []).label).toBe("Conditional Formatting");
  });

  it("lists two models of the same name as two when their IDs or their workspaces differ, and one model once", () => {
    const pages = appTable("Pages.csv", [
      { Page: "One", Model: "Planning", Workspace: "Main", "Model ID": "AAAA0000AAAA0000AAAA0000AAAA0000" },
      { Page: "Two", Model: "Planning", Workspace: "Main", "Model ID": "BBBB1111BBBB1111BBBB1111BBBB1111" },
      { Page: "Three", Model: "Planning", Workspace: "Archive", "Model ID": "AAAA0000AAAA0000AAAA0000AAAA0000" },
      { Page: "Four", Model: "Planning", Workspace: "Main", "Model ID": "AAAA0000AAAA0000AAAA0000AAAA0000" },
      // A page that names its model by an ID alone is still a model; one that names nothing is not.
      { Page: "Five", "Model ID": "CCCC2222CCCC2222CCCC2222CCCC2222" },
      { Page: "Six" },
    ]);
    expect(overviewOf(result("app", [pages])).models).toEqual([
      { model: "Planning", workspace: "Main", modelId: "AAAA0000AAAA0000AAAA0000AAAA0000" },
      { model: "Planning", workspace: "Main", modelId: "BBBB1111BBBB1111BBBB1111BBBB1111" },
      { model: "Planning", workspace: "Archive", modelId: "AAAA0000AAAA0000AAAA0000AAAA0000" },
      { model: "—", workspace: "—", modelId: "CCCC2222CCCC2222CCCC2222CCCC2222" },
    ]);
  });

  it("gives a model's overview its row counts and nothing made up", () => {
    const lineItems: ResultTable = { file: "Line Items.csv", label: "Line Items", headers: ["", "Formula"], rows: [["Revenue", "Units * Price"], ["Units", ""]], guard: false };
    const modules: ResultTable = { file: "Modules.csv", label: "Modules", headers: ["", "Card type", "Model"], rows: [["REP01", "x", "y"]], guard: false };
    expect(overviewOf(result("model", [modelDetails, lineItems, modules], ["Line Items: 2 rows", "Modules: 1 rows"]))).toEqual({
      tiles: [{ label: "Modules", count: 1 }, { label: "Line Items", count: 2 }], cardTypes: [], models: [],
      notes: ["Actions: the Actions list came without Notes; the diagnostic log lists the columns it had."],
      about: [["Model", "Model one"], ["Workspace", "Main"], ["Exported on", "2026-10-03 09:30 UTC"], ["Exported with", "Cardigan dev"], ["Anaplan host", "eu2a.app.anaplan.com"]],
      files: [["Line Items", "120 rows"], ["Imports", "Not exported: the grid did not load"]], howToRead: [], log: [] });
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
    // The file whose row says only how many rows it has is the tile; the others are said, with what they say.
    expect([overview.tiles, overview.files]).toEqual([[{ label: "Line Items", count: 120 }, { label: "Imports", count: 2 }],
      [["Imports", "2 rows (2 matched in the Actions list)"], ["Source Models", "Not exported: no such axis"]]]);
    // A section the page does not know is part of what the export is about: its rows are there too.
    expect(overview.about.slice(-1)).toEqual([["A detail", "its value"]]);
    // Every row of the Details file is somewhere on the overview.
    const held = (row: Cell[]): boolean => {
      const [section, detail, value] = row.map(String);
      const pair = ([first, second]: readonly [string, string]) => first === detail && second === value;
      if (section === "Diagnostics") return overview.log.includes(detail ? `${detail} ${value}` : value);
      if (section === "Notes") return overview.notes.includes(`${detail}: ${value}`);
      if (section === "How to read") return overview.howToRead.some(pair);
      // A Files row names its file; the overview says it under the table's name, among the tables or as the table's tile.
      if (section === "Files") return [...overview.files, ...overview.tiles.map(tile => [tile.label, `${tile.count} rows`])].some(([table, said]) => `${table}.csv` === detail && said === value);
      return overview.about.some(pair);
    };
    expect([details.rows.length, details.rows.filter(row => !held(row))]).toEqual([16, []]);
    // The same for the app's Details file, whose Files rows are said too where they differ from the files.
    const app = overviewOf(result("app", [appDetails]));
    expect([app.about.length, app.files.length, app.notes.length, app.howToRead.length, app.log.length]).toEqual([6, 2, 2, 1, 4]);
    expect(app.about.length + app.files.length + app.notes.length + app.howToRead.length + app.log.length).toBe(appDetails.rows.length);
    // Without a Details file the overview has none of it.
    expect(overviewOf(result("model", [lineItems]))).toMatchObject({ about: [], files: [], howToRead: [], log: [] });
  });

  it("says both numbers on the tile of a file whose table lists fewer rows than the file has: the Details file's count for it is not lost", () => {
    // A model as the export writes it: the Line Items grid with its modules' own rows, and the calendar with its rows about
    // the model. The Details file and the summary count each file's rows, all of them.
    const blueprint: ResultTable = { file: "Line Items.csv", label: "Line Items", guard: false, headers: ["", "Formula", "Applies To", "Module Name"], rows: [
      ["Revenue", "", "Products, Time", ""], ["Units", "", "-", "Revenue"], ["Price", "Units * 2", "Products", "Revenue"], ["Costs", "", "Regions", ""], ["Rent", "", "-", "Costs"]] };
    const modules: ResultTable = { file: MODULES_FILE, label: "Modules", headers: ["", "Applies To"], rows: [["Revenue", "Products, Time"], ["Costs", "Regions"]], guard: false };
    const details = detailsTable("Model Details.csv", [["Model", "Model", "Model one"],
      ["Files", "Line Items.csv", "5 rows"], ["Files", "Modules.csv", "2 rows"], ["Files", "Model Calendar.csv", "31 rows"], ["Files", "Imports.csv", "Not exported: the grid did not load"]]);
    const model = result("model", [details, blueprint, modules, calendar()], ["Line Items: 5 rows", "Modules: 2 rows", "Model Calendar: 31 rows", "Imports: not read"]);
    const overview = overviewOf(model);
    // The table lists 26 of the calendar's 31 rows and 3 line items of the grid's 5: each tile counts what its table lists,
    // and says how many rows there are in all. A file whose table lists every row says one number.
    expect(overview.tiles).toEqual([{ label: "Model Calendar", count: 26, inAll: 31 }, { label: "Modules", count: 2 }, { label: "Line Items", count: 3, inAll: 5 }]);
    // So the three rows that only count a file are left to the tiles, and the three summary lines that only count one are no notes.
    expect([overview.files, overview.notes]).toEqual([[["Imports", "Not exported: the grid did not load"]], ["Imports: not read"]]);
    // Every count the Details file gives is on the overview: under Tables, or on the file's tile, as one of its two numbers.
    const counted = details.rows.filter(row => row[0] === "Files").map(row => [String(row[1]), String(row[2])]);
    const onTile = ([file, value]: string[]) => overview.tiles.some(tile => `${tile.label}.csv` === file && [tile.count, tile.inAll].some(number => `${number} rows` === value));
    expect(counted.map(row => (overview.files.some(([table, value]) => `${table}.csv` === row[0] && value === row[1]) ? "Tables" : onTile(row) ? "tile" : "lost"))).toEqual(["tile", "tile", "tile", "Tables"]);
    // A count in the Details file that is not the file's own stays under Tables, whatever the tile says.
    const other = overviewOf(result("model", [detailsTable("Model Details.csv", [["Files", "Line Items.csv", "3 rows"], ["Files", "Model Calendar.csv", "26 rows"]]), blueprint, calendar()]));
    expect([other.tiles, other.files]).toEqual([[{ label: "Model Calendar", count: 26, inAll: 31 }, { label: "Line Items", count: 3, inAll: 5 }], [["Line Items", "3 rows"], ["Model Calendar", "26 rows"]]]);
    // An app's tables list every row: no tile of an app says a second number, a Where Used table by object neither.
    expect(overviewOf(result("app", [appDetails, appTable("Pages.csv", [{ Page: "Overview" }]), appTable("Where Used.csv", [{ Page: "Overview" }, { Page: "Overview" }])])).tiles)
      .toEqual([{ label: "Pages", count: 1 }, { label: "Where Used", count: 2 }]);
  });

  it("lists a model's files in the order of Anaplan's Model settings, and an app's as the result has them", () => {
    // Dynamic Cell Access is no setting of Anaplan's: the export makes it from Line Items, and it comes right after it.
    expect(MODEL_FILE_ORDER).toEqual(["Model Calendar.csv", "Time Ranges.csv", "Versions.csv", "General Lists.csv", "Line Item Subsets.csv", "Modules.csv", "Line Items.csv",
      "Dynamic Cell Access.csv", "Processes.csv", "Imports.csv", "Import Data Sources.csv", "Exports.csv", "Other Actions.csv", "Source Models.csv"]);
    expect([MODEL_FILE_ORDER[0], new Set(MODEL_FILE_ORDER).size, MODEL_FILE_ORDER[MODEL_FILE_ORDER.indexOf("Line Items.csv") + 1]]).toEqual([MODEL_CALENDAR_FILE, 14, ACCESS_FILE]);
    const file = (name: string): ResultTable => ({ file: name, label: name.replace(/\.csv$/, ""), headers: ["", "Value"], rows: [], guard: false });
    /** The files of a result as the page lists them: each one's name and its place in the result. */
    const listed = (kind: "app" | "model", ...names: string[]) => listedTables(result(kind, [modelDetails, ...names.map(file)])).map(({ index, table }) => `${index} ${table.file}`);
    // The export's own order (model/export.ts), after the Details file: every file moves to its place, and keeps its place in the result as its name.
    const written = ["Line Items.csv", "Dynamic Cell Access.csv", "Modules.csv", "General Lists.csv", "Processes.csv", "Imports.csv", "Import Data Sources.csv", "Exports.csv", "Other Actions.csv",
      "Time Ranges.csv", "Versions.csv", "Source Models.csv", "Model Calendar.csv"];
    expect(listed("model", ...written)).toEqual(["13 Model Calendar.csv", "10 Time Ranges.csv", "11 Versions.csv", "4 General Lists.csv", "3 Modules.csv", "1 Line Items.csv",
      "2 Dynamic Cell Access.csv", "5 Processes.csv", "6 Imports.csv", "7 Import Data Sources.csv", "8 Exports.csv", "9 Other Actions.csv", "12 Source Models.csv"]);
    // Only the files the result has, in that order.
    expect(listed("model", "Imports.csv", "Line Items.csv", "Versions.csv")).toEqual(["3 Versions.csv", "2 Line Items.csv", "1 Imports.csv"]);
    // A file that is not in the order comes after those that are, in the result's order, and none is dropped: a renamed
    // file, a new one, one whose name differs in case. Line Item Subsets has its place already.
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
    // The overview's tiles follow the same order.
    expect(overviewOf(result("model", [modelDetails, ...written.map(file)])).tiles.map(tile => tile.label)).toEqual(["Model Calendar", "Time Ranges", "Versions", "General Lists", "Modules",
      "Line Items", "Dynamic Cell Access", "Processes", "Imports", "Import Data Sources", "Exports", "Other Actions", "Source Models"]);
  });

  // A model's Model Calendar file as the export writes it: the assessment template's rows, the first five about the model.
  const calendar = (workspace = "Main", model = "Model one"): ResultTable => ({ file: "Model Calendar.csv", label: "Model Calendar", headers: [...CALENDAR_HEADERS], guard: false,
    rows: calendarRows({ workspace, model, capturedOn: "2026-10-03", values: new Map() }) });

  it("lists every row of every file, but for the rows about the model in a model's Model Calendar file", () => {
    expect([MODEL_CALENDAR_FILE, ABOUT_MODEL]).toEqual(["Model Calendar.csv", "Model"]);
    const file = calendar();
    const lineItems: ResultTable = { file: "Line Items.csv", label: "Line Items", headers: ["Section", "Formula"], rows: [["Model", "a"], ["Model Calendar", "b"]], guard: false };
    const model = result("model", [modelDetails, lineItems, file]);
    // The template has five rows about the model and twenty-six about its calendar: the table lists exactly the latter.
    const listed = fileView(model, file);
    expect([file.rows.length, listed.note, listed.table.rows.length, [...new Set(listed.table.rows.map(row => row[0]))]]).toEqual([31, "5 rows about the model are not listed here: 3 hold a value, which the Overview has under About this export.", 26, ["Model Calendar"]]);
    expect(listed.table).toEqual({ ...file, rows: file.rows.filter(row => row[0] !== "Model") });
    expect(file.rows.filter(row => row[0] === "Model").map(row => row[1])).toEqual(["Workspace", "Model", "Model size (GB)", "Captured on", "Captured by"]);
    // The file itself is as it was: the overview reads the model's facts out of it.
    expect(file.rows).toHaveLength(31);
    // Any other file lists every row, the same rows, whatever its columns are called and hold; so does the Details file.
    expect([fileView(model, lineItems), fileView(model, modelDetails)]).toEqual([{ table: lineItems }, { table: modelDetails }]);
    expect(fileView(model, lineItems).table).toBe(lineItems);
    // The rules are few and each is one file's own, by the kind of result and the file's name.
    expect([[...FILE_RULES.model.keys()], [...FILE_RULES.app.keys()]]).toEqual([["Model Calendar.csv", "Line Items.csv", "Dynamic Cell Access.csv"], []]);
    // The rule is that file's alone: by its name, in a model's result, by its Section column.
    const renamed = { ...file, file: "Model Calendar (2).csv" };
    const regrouped = { ...file, headers: ["Group", ...file.headers.slice(1)] };
    expect([fileView(model, renamed), fileView(result("app", [appDetails, file]), file), fileView(model, regrouped)]).toEqual([{ table: renamed }, { table: file }, { table: regrouped }]);
    // A row is left out for being about the model, not for its place: wherever such a row stands, and only such a row.
    const mixed: ResultTable = { ...file, headers: ["Setting", "Section", "Value"], rows: [["Calendar Type", "Model Calendar", "x"], ["Model", "Model", "y"], ["Other", "Something else", "z"], ["Model", "model", "w"]] };
    expect(fileView(model, mixed)).toEqual({ table: { ...mixed, rows: [mixed.rows[0], mixed.rows[2], mixed.rows[3]] }, note: "1 row about the model is not listed here: the Overview has its value, under About this export." });
    // A calendar file with no row about the model lists every row, and is the same list.
    const none: ResultTable = { ...file, rows: file.rows.slice(5) };
    expect([fileView(model, none).table === none, fileView(model, none).note]).toEqual([true, undefined]);
    // A calendar file whose every row is about the model leaves its table none: the table then says so, in the rows' place,
    // and the line under its name counts the rows as ever. A table that has rows to list says nothing in their place.
    const only: ResultTable = { ...file, rows: file.rows.slice(0, 5) };
    expect(fileView(model, only)).toEqual({ table: { ...only, rows: [] }, note: "5 rows about the model are not listed here: 3 hold a value, which the Overview has under About this export.", none: "Every row is about the model." });
    expect([fileView(model, file).none, fileView(model, lineItems).none]).toEqual([undefined, undefined]);
    // The line says where the rows' values are, which is on the overview: it has the setting and the value of each such
    // row that holds a value (`modelFacts`), and of no other. The template's five rows hold three: the export cannot
    // know the model's size or who captured it, and leaves those two without a value. So the line says three, and the
    // overview has those three.
    expect(modelFacts(model)).toEqual([["Workspace", "Main"], ["Model", "Model one"], ["Captured on", "2026-10-03"]]);
    expect(overviewOf(model).about).toEqual(expect.arrayContaining(modelFacts(model)));
    expect(file.rows.filter(row => row[0] === "Model" && row[2] === "").map(row => row[1])).toEqual(["Model size (GB)", "Captured by"]);
    // Where every such row holds a value the line says so of them all; where one of several does, of that one; and where
    // none does, that the rows are not shown, which is all that is true of them. Spaces alone are no value.
    const facts = (...values: string[]): ResultTable => ({ ...file, headers: ["Section", "Setting", "Value"],
      rows: [...values.map((value, index) => ["Model", `Fact ${index + 1}`, value]), ["Model Calendar", "Calendar Type", "Weeks: General"]] });
    expect([facts("a", "b"), facts("a", "", " "), facts("", " ")].map(table => [fileView(model, table).note, modelFacts(result("model", [table])).length])).toEqual([
      ["2 rows about the model are not listed here: the Overview has their values, under About this export.", 2],
      ["3 rows about the model are not listed here: 1 holds a value, which the Overview has under About this export.", 1],
      ["2 rows about the model are not shown.", 0]]);
    // Of a file without one of the columns the overview reads them by it has nothing, and the line says the same.
    const bare: ResultTable = { ...file, headers: ["Section", "Setting"], rows: [["Model", "Workspace"], ["Model", "Model"], ["Model Calendar", "Calendar Type"]] };
    const one: ResultTable = { ...file, headers: ["Section", "Value"], rows: [["Model", "Main"], ["Model Calendar", "Weeks: General"]] };
    expect([fileView(model, bare).note, fileView(model, one).note, modelFacts(result("model", [bare])), modelFacts(result("model", [one]))])
      .toEqual(["2 rows about the model are not shown.", "1 row about the model is not shown.", [], []]);
    expect(overviewOf(result("model", [only])).tiles).toEqual([{ label: "Model Calendar", count: 0, inAll: 5 }]);
  });

  it("shows a model's Line Items file as a table of line items, and says what that leaves out and where a module without line items is", () => {
    // The grid as the export writes it: each module's own row, then its line items; a dash under Applies To stands for the module's.
    const blueprint: ResultTable = { file: "Line Items.csv", label: "Line Items", guard: false, headers: ["", "Formula", "Applies To", "Module Name"], rows: [
      ["Revenue", "", "Products, Time", ""], ["Units", "", "-", "Revenue"], ["Price", "Units * 2", "Products", "Revenue"],
      ["--- Archive ---", "", "", ""], ["Costs", "", "Regions", ""], ["Rent", "", "-", "Costs"], ["Salaries", "", "-", "Costs"]] };
    const modules: ResultTable = { file: MODULES_FILE, label: "Modules", headers: ["", "Applies To"], rows: [["Revenue", "Products, Time"], ["--- Archive ---", ""], ["Costs", "Regions"]], guard: false };
    expect(MODULES_FILE).toBe("Modules.csv");
    const model = result("model", [modelDetails, blueprint, modules]);
    const shown = fileView(model, blueprint);
    // Line items only, each with its module after its name and the dimensions it really has, with where those came from.
    expect(shown.table).toEqual({ ...blueprint, headers: ["", "Module Name", "Formula", "Applies To", "Applies To from"], rows: [
      ["Units", "Revenue", "", "Products, Time", "Module"], ["Price", "Revenue", "Units * 2", "Products", "Line item"],
      ["Rent", "Costs", "", "Regions", "Module"], ["Salaries", "Costs", "", "Regions", "Module"]] });
    expect(shown.table).toEqual(lineItemsView(blueprint).table);
    // The line is the view's own. Since the result has the Modules file, it also says where the module without line items is.
    expect(shown.note).toBe("3 module rows are not listed here; each line item shows its module. 1 module has no line items, so it is not in this table. It is listed in the Modules table.");
    expect(shown.note).toBe(`${lineItemsView(blueprint).note} It is listed in the Modules table.`);
    expect(shown.none).toBeUndefined();
    // A grid of modules without line items leaves the table none of its rows: it says that, not that nothing was found.
    const bare: ResultTable = { ...blueprint, rows: [["Revenue", "", "Products, Time", ""], ["Costs", "", "Regions", ""]] };
    expect(fileView(result("model", [bare, modules]), bare)).toEqual({ table: { ...bare, headers: ["", "Module Name", "Formula", "Applies To", "Applies To from"], rows: [] },
      note: "2 module rows are not listed here; each line item shows its module. 2 modules have no line items, so they are not in this table. They are listed in the Modules table.",
      none: "Every row that was read is a module's own: no module has a line item." });
    // Without the Modules file there is no table to name, and no module's name to check a row against: the line says that
    // instead. With every module named by a line item there is nothing to add.
    expect(fileView(result("model", [modelDetails, blueprint]), blueprint).note)
      .toBe(`${lineItemsView(blueprint).note} The Modules table was not exported, so a row with only a name is taken for a module's row.`);
    const full: ResultTable = { ...blueprint, rows: blueprint.rows.filter(row => row[0] !== "--- Archive ---") };
    expect(fileView(result("model", [full, modules]), full).note).toBe("2 module rows are not listed here; each line item shows its module.");
    // Several such modules, and a Modules file under another label: the line names the table as the page does.
    const two: ResultTable = { ...blueprint, rows: [...blueprint.rows, ["--- End ---", "", "", ""]] };
    expect(fileView(result("model", [two, { ...modules, label: "All modules", rows: [...modules.rows, ["--- End ---", ""]] }]), two).note)
      .toBe("4 module rows are not listed here; each line item shows its module. 2 modules have no line items, so they are not in this table. They are listed in the All modules table.");
    // The file itself is as it was: a model's map is made of it.
    expect([blueprint.rows.length, blueprint.headers, blueprint.rows[1]]).toEqual([7, ["", "Formula", "Applies To", "Module Name"], ["Units", "", "-", "Revenue"]]);
    // The rule is that file's alone, in a model's result. An app's file of that name, a file of another name, and a Line
    // Items file that is not the grid (no column that names the module) are shown as they stand: the very table.
    const renamed: ResultTable = { ...blueprint, file: "Line Items (2).csv" };
    const flat: ResultTable = { ...blueprint, headers: ["", "Formula", "Applies To", "Module"] };
    expect([fileView(result("app", [appDetails, blueprint]), blueprint), fileView(model, renamed), fileView(model, flat)]).toEqual([{ table: blueprint }, { table: renamed }, { table: flat }]);
    expect(fileView(model, flat).table).toBe(flat);
    // The overview's tile counts the line items, as the navigation does; the modules' tile is the Modules file's.
    expect(overviewOf(model).tiles).toEqual([{ label: "Modules", count: 3 }, { label: "Line Items", count: 4, inAll: 7 }]);
  });

  it("shows a model's Dynamic Cell Access file as it stands, under a line that says what it lists and how many of its rows have a driver that could not be matched", () => {
    // The file as the export writes it (model/access.ts): one row for each use of a driver, the driver first.
    const HEADERS = ["Driver Module", "Driver Line Item", "Access", "Controlled Module", "Controlled Line Item"];
    const file: ResultTable = { file: "Dynamic Cell Access.csv", label: "Dynamic Cell Access", guard: false, headers: HEADERS, rows: [
      ["ACC01 Access", "Can read", "Read", "REV01 Revenue", "Units"], ["ACC01 Access", "Can read", "Read", "REV01 Revenue", "Price"], ["ACC01 Access", "Can read", "Write", "REV01 Revenue", "Units"]] };
    expect(ACCESS_FILE).toBe("Dynamic Cell Access.csv");
    const model = result("model", [modelDetails, file]);
    // What the table lists: a use of a driver is a row, so the line item that one driver controls for reading and for
    // writing is in two.
    const WHAT = "The Read Access Driver and Write Access Driver columns of Line Items, listed from the driver's side. One row for each use of a driver: the driver, Read or Write, and the line item it controls.";
    const NO_DRIVERS = "No line item in this model has a read or write access driver.";
    // The table is the file itself, every row and every column; none of its cells is one the page says in words. The line
    // says what the table lists: no grid of Anaplan's has these columns. A row opens from the driver's name, its second column.
    const shown = fileView(model, file);
    expect([shown.table === file, shown.note, shown.opensFrom, shown.none, shown.exported]).toEqual([true, WHAT, 1, undefined, undefined]);
    // A row whose driver the export matched to no line item has no Driver Module, and the driver as Line Items has it.
    // The line counts those rows, one and several, and says where they are and how to tell them.
    const unmatched: Cell[][] = [["", "Gone.Flag", "Read", "COST01 Costs", "Rates"], ["", "'Old access'.Can write", "Write", "COST01 Costs", ""]];
    const withOne: ResultTable = { ...file, rows: [...file.rows, unmatched[0]] };
    const withTwo: ResultTable = { ...file, rows: [...file.rows, ...unmatched] };
    expect([fileView(model, withOne).note, fileView(model, withTwo).note]).toEqual([
      `${WHAT} 1 row has a driver that could not be matched to a line item: it comes last, with the driver as Line Items has it and no Driver Module.`,
      `${WHAT} 2 rows have a driver that could not be matched to a line item: they come last, with the driver as Line Items has it and no Driver Module.`]);
    expect(fileView(model, withTwo).table).toBe(withTwo);
    // The count is read from the file's own rows, by that column wherever it stands and whatever the Details file says:
    // a row that names no module under Controlled Module is not counted for that. The row opens from the driver's name
    // wherever that column stands.
    const moved: ResultTable = { ...withTwo, headers: [...HEADERS.slice(1), HEADERS[0]], rows: [...withTwo.rows.map(row => [...row.slice(1), row[0]]), ["Can read", "Read", "", "Lost", "ACC01 Access"]] };
    expect([fileView(model, moved).note, fileView(model, moved).opensFrom]).toEqual([fileView(model, withTwo).note, 0]);
    // A model that drives no access has the file without rows. The line says what the table would list, and the table
    // says in the rows' place what an empty file of this kind means: not that nothing was found.
    const empty: ResultTable = { ...file, rows: [] };
    expect(fileView(model, empty)).toEqual({ table: empty, note: WHAT, empty: NO_DRIVERS, opensFrom: 1 });
    expect([shown.empty, fileView(model, modelDetails).empty, fileView(model, { ...file, file: "Versions.csv" }).empty]).toEqual([NO_DRIVERS, undefined, undefined]);
    // The tile and the navigation count every row of the file, the unmatched ones among them: the table leaves none out.
    expect(overviewOf(result("model", [modelDetails, withTwo])).tiles).toEqual([{ label: "Dynamic Cell Access", count: 5 }]);
    // The rule is that file's alone, in a model's result. An app's file of that name, a file of another name, and a file
    // of the name without the column are shown as they stand, without a line: the very table. A file of the name that
    // has the driver's module and not its name has the line, and opens its rows as any table does.
    const renamed: ResultTable = { ...file, file: "Dynamic Cell Access (2).csv" };
    const other: ResultTable = { ...file, headers: ["Driver", ...HEADERS.slice(1)] };
    expect([fileView(result("app", [appDetails, file]), file), fileView(model, renamed), fileView(model, other)]).toEqual([{ table: file }, { table: renamed }, { table: other }]);
    const unnamed: ResultTable = { ...file, headers: [HEADERS[0], "Driver", ...HEADERS.slice(2)] };
    expect(fileView(model, unnamed)).toEqual({ table: unnamed, note: WHAT, empty: NO_DRIVERS });
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
    // items. No module is called Price: it stays in the table, as a line item whose module is not known, the line counts
    // it, and the line item after it is still its module's.
    const among = grid([["Revenue", "", "Products, Time", ""], ["Units", "", "-", "Revenue"], ["Price", "", "", ""], ["Sales", "Units * Price", "-", "Revenue"]]);
    expect(shown(among, [modules])).toEqual({
      rows: [["Units", "Revenue", "", "Products, Time", "Module"], ["Price", "", "", "", ""], ["Sales", "Revenue", "Units * Price", "Products, Time", "Module"]],
      note: "1 module row is not listed here; each line item shows its module, except 1 whose module is not known: it has no Module Name.",
      tile: { label: "Line Items", count: 3, inAll: 4 } });
    // And here it is the last row under its module: it is not a module with no line items, which the Modules table would list.
    const last = grid([["Revenue", "", "Products, Time", ""], ["Units", "", "-", "Revenue"], ["Price", "", "", ""], ["Costs", "", "Regions", ""], ["Rent", "", "-", "Costs"]]);
    expect(shown(last, [modules])).toEqual({
      rows: [["Units", "Revenue", "", "Products, Time", "Module"], ["Price", "", "", "", ""], ["Rent", "Costs", "", "Regions", "Module"]],
      note: "2 module rows are not listed here; each line item shows its module, except 1 whose module is not known: it has no Module Name.",
      tile: { label: "Line Items", count: 3, inAll: 5 } });
    // The names are the Modules file's first column, as the file has it: a module the file lists is a module's own row
    // also with nothing under it, and the line says where it is listed.
    const listed: ResultTable = { ...modules, rows: [...modules.rows, ["Price", ""]] };
    expect(shown(last, [listed])).toEqual({
      rows: [["Units", "Revenue", "", "Products, Time", "Module"], ["Rent", "Costs", "", "Regions", "Module"]],
      note: "3 module rows are not listed here; each line item shows its module. 1 module has no line items, so it is not in this table. It is listed in the Modules table.",
      tile: { label: "Line Items", count: 2, inAll: 5 } });
    // A name is the Modules file's only as the file writes it: listed with a space before or after it, Price is not the
    // row's name, and the row stays in the table as it does when the file does not list it at all.
    for (const spaced of [" Price", "Price ", " Price "]) {
      expect(shown(last, [{ ...modules, rows: [...modules.rows, [spaced, ""]] }]), JSON.stringify(spaced)).toEqual(shown(last, [modules]));
    }
    // A result without the Modules file, or with one that lists nothing, has no names to give: such a row is taken for a
    // module's own, as the view does by itself, and no table is said to list a module. The line says that the names could
    // not be checked, and why: Price, of which only the name was read, is among the rows it counts as modules' own.
    const without = "3 module rows are not listed here; each line item shows its module. 1 module has no line items, so it is not in this table.";
    expect([shown(last, []).note, shown(last, [{ ...modules, rows: [] }]).note]).toEqual([
      `${without} The Modules table was not exported, so a row with only a name is taken for a module's row.`,
      `${without} The Modules table lists no modules, so a row with only a name is taken for a module's row.`]);
    expect([shown(last, []).rows, lineItemsView(last).note]).toEqual([[["Units", "Revenue", "", "Products, Time", "Module"], ["Rent", "Costs", "", "Regions", "Module"]], without]);
    expect(shown(among, []).rows).toEqual([["Units", "Revenue", "", "Products, Time", "Module"], ["Sales", "Revenue", "Units * Price", "-", "Module (not found)"]]);
  });

  it("says under the Line Items table that no module's name could be checked, when the result has no Modules table with rows", () => {
    const headers = ["", "Formula", "Applies To", "Module Name"];
    const grid = (rows: Cell[][]): ResultTable => ({ file: "Line Items.csv", label: "Line Items", guard: false, headers, rows });
    const modules = (rows: Cell[][], label = "Modules"): ResultTable => ({ file: MODULES_FILE, label, headers: ["", "Applies To"], rows, guard: false });
    const note = (file: ResultTable, ...others: ResultTable[]) => fileView(result("model", [modelDetails, file, ...others]), file).note;
    const counted = "1 module row is not listed here; each line item shows its module.";
    const whole = grid([["Revenue", "", "Products, Time", ""], ["Units", "", "-", "Revenue"], ["Price", "Units * 2", "Products", "Revenue"]]);
    // The Modules file failed to export: the result has none. The line says so, and what that means for a row with only a name.
    expect(note(whole)).toBe(`${counted} The Modules table was not exported, so a row with only a name is taken for a module's row.`);
    // The file is there and lists nothing: the table is named as the page names it, and said to list no modules.
    expect(note(whole, modules([]))).toBe(`${counted} The Modules table lists no modules, so a row with only a name is taken for a module's row.`);
    expect(note(whole, modules([], "All modules"))).toBe(`${counted} The All modules table lists no modules, so a row with only a name is taken for a module's row.`);
    // With a Modules table that has rows the names were checked, and nothing is added: also when it does not list this module.
    expect([note(whole, modules([["Revenue", "Products, Time"]])), note(whole, modules([["Costs", "Regions"]]))]).toEqual([counted, counted]);
    // The sentence is the line's last: after the line items whose module is not known, and after the modules without line
    // items, which no table is then said to list.
    const mixed = grid([["Revenue", "", "Products, Time", ""], ["Units", "", "-", "Revenue"], ["Lost", "Units * 2", "-", ""], ["--- Archive ---", "", "", ""]]);
    expect(note(mixed)).toBe("2 module rows are not listed here; each line item shows its module, except 1 whose module is not known: it has no Module Name. "
      + "1 module has no line items, so it is not in this table. The Modules table was not exported, so a row with only a name is taken for a module's row.");
    // A table none of whose rows is left says it too, under the line that counts them.
    const bare = grid([["Revenue", "", "Products, Time", ""], ["Costs", "", "Regions", ""]]);
    expect(fileView(result("model", [bare]), bare)).toMatchObject({ none: "Every row that was read is a module's own: no module has a line item.",
      note: "2 module rows are not listed here; each line item shows its module. 2 modules have no line items, so they are not in this table. "
        + "The Modules table was not exported, so a row with only a name is taken for a module's row." });
    // A file the view does not apply to has no line at all, whatever the result holds: nothing was left out of its table.
    const flat = grid([["Units", "", "-", "Revenue"], ["Price", "Units * 2", "Products", "Revenue"]]);
    expect([fileView(result("model", [flat]), flat), fileView(result("app", [appDetails, whole]), whole)]).toEqual([{ table: flat }, { table: whole }]);
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

  it("says the words after a file's own rule: the Line Items table of line items has them in the columns the view moved", () => {
    const NUMBER = '{"dataType":"NUMBER"}';
    const RATIO = '{"summaryMethod":"RATIO","timeSummaryMethod":"RATIO","ratioNumeratorIdentifier":"_1901000000003_","ratioDenominatorIdentifier":"_1901000000002_"}';
    const blueprint: ResultTable = { file: "Line Items.csv", label: "Line Items", guard: false, headers: ["", "Format", "Summary", "Applies To", "Module Name", "Ratio Numerator", "Ratio Denominator"], rows: [
      ["Revenue", "", "", "Products, Time", "", "", ""],
      ["Units", NUMBER, '{"summaryMethod":"SUM","timeSummaryMethod":"SUM"}', "-", "Revenue", "", ""],
      ["Margin %", NUMBER, RATIO, "-", "Revenue", "Margin", "Units"]] };
    const model = result("model", [modelDetails, blueprint]);
    const shown = fileView(model, blueprint);
    expect([shown.table.headers, shown.table.rows, shown.note]).toEqual([["", "Module Name", "Format", "Summary", "Applies To", "Applies To from", "Ratio Numerator", "Ratio Denominator"], [
      ["Units", "Revenue", "Number", "Sum", "Products, Time", "Module", "", ""],
      ["Margin %", "Revenue", "Number", "Ratio = Margin / Units", "Products, Time", "Module", "Margin", "Units"]],
    "1 module row is not listed here; each line item shows its module. The Modules table was not exported, so a row with only a name is taken for a module's row."]);
    // What is kept is by the shown table's rows and columns: Format stands third there, and second in the file.
    expect([...shown.exported ?? []].map(([row, texts]) => [shown.table.rows.findIndex(candidate => candidate === row), [...texts]]))
      .toEqual([[0, [[2, NUMBER], [3, '{"summaryMethod":"SUM","timeSummaryMethod":"SUM"}']]], [1, [[2, NUMBER], [3, RATIO]]]]);
    // The words change no row: the tile counts the line items, as before.
    expect(overviewOf(model).tiles).toEqual([{ label: "Line Items", count: 2, inAll: 3 }]);
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
    // The view of line items keeps the column where the file has it, the last; the words stand in the Format column.
    expect(shown.table.headers).toEqual(["", "Module Name", "Format", "Summary", "Applies To", "Applies To from", "Ratio Numerator", "Ratio Denominator", "Format List"]);
    const cells = (header: string) => shown.table.rows.map(row => row[shown.table.headers.indexOf(header)]);
    expect([cells(""), cells("Format"), cells("Format List")]).toEqual([
      ["Product", "Region", "Active product", "Units", "Spaces", "Named number", "Product again"],
      ["List: Products", "List: Regions <b>& more</b>, filter: selective access", "List: ID 109000000004", "Number", "List: ID 101000000009", "Number", "List: Product catalogue"],
      ["Products", "Regions <b>& more</b>", "", "", "  ", "Products", "Product catalogue"]]);
    // The text that was read is kept for the Format and the Summary, as before. The Format List cell is the file's own, and has none.
    expect([...shown.exported?.get(shown.table.rows[0]) ?? []]).toEqual([[2, list(101000000007)], [3, NO_SUMMARY]]);
    // The column starts shown, as the two of a ratio do, and is a column like any other: plain text, with a filter by list.
    expect(columnsOf(shown.table).slice(-3).map(column => [column.label, column.kind, column.hidden, column.filter])).toEqual([
      ["Ratio Numerator", "text", false, false], ["Ratio Denominator", "text", false, false], ["Format List", "text", false, true]]);
    // The file itself is as it was: a model's map is made of it.
    expect(lineItems).toEqual(kept);

    // The file as it stands (no row of it is a module's own) is said the same way.
    const flat: ResultTable = { ...lineItems, rows: lineItems.rows.slice(1, 3) };
    expect(fileView(result("model", [flat]), flat).table.rows.map(row => row[1])).toEqual(["List: Products", "List: Regions <b>& more</b>, filter: selective access"]);
    // Without the column, as a result of an earlier version has the file, a list is said by its ID.
    const before: ResultTable = { ...lineItems, headers: headers.slice(0, -1), rows: lineItems.rows.slice(1, 3).map(row => row.slice(0, -1)) };
    expect(fileView(result("model", [before]), before).table.rows.map(row => row[1])).toEqual(["List: ID 101000000007", "List: ID 101000000008, filter: selective access"]);
    // The column is the Line Items file's: in another of a model's files a column of that name names no list.
    const other: ResultTable = { ...flat, file: "Line Items (2).csv" };
    expect(fileView(result("model", [other]), other).table.rows.map(row => row[1])).toEqual(["List: ID 101000000007", "List: ID 101000000008, filter: selective access"]);
    // An app's tables are never said in words.
    expect(fileView(result("app", [appDetails, flat]), flat)).toEqual({ table: flat });
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
    // The overview says the facts with what the Details file says about the export, after its rows, and none of them twice:
    // the model's name and its workspace are in the Details file already.
    const overview = overviewOf(result("model", [modelDetails, calendar()], ["Model Calendar: 31 rows"]));
    expect([overview.about, overview.tiles]).toEqual([[["Model", "Model one"], ["Workspace", "Main"], ["Exported on", "2026-10-03 09:30 UTC"], ["Exported with", "Cardigan dev"],
      ["Anaplan host", "eu2a.app.anaplan.com"], ["Captured on", "2026-10-03"]], [{ label: "Model Calendar", count: 26, inAll: 31 }]]);
    // A fact that says something else than the Details file is said as well.
    expect(overviewOf(result("model", [modelDetails, calendar("Another workspace")])).about.slice(-2)).toEqual([["Workspace", "Another workspace"], ["Captured on", "2026-10-03"]]);
    // Without a Details file the facts are all the overview has about the export.
    expect(overviewOf(result("model", [calendar()])).about).toEqual([["Workspace", "Main"], ["Model", "Model one"], ["Captured on", "2026-10-03"]]);
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
      ["1", "Own rows and columns", "REP01 Sales", "—", "All line items (Line Items on columns)", "2 conditions, match all", "—"],
      ["2", "—", "REP02 Margin", "—", "—", "—", "—"],
    ]);
    // Group and Condition put several columns side by side; a dash among them is left out, and nothing at all is one dash.
    expect(parts[1].headings).toEqual(["Sec", "Filter on", "Dimension", "Group", "Condition", "Context"]);
    expect(parts[1].rows).toEqual([
      ["1", "Rows", "Products", "1 · All", "Sales is greater than 10,000", "Time = current"],
      ["1", "Rows", "Products", "1.1 · Any", "Margin % is not blank", "—"],
    ]);
    expect(parts[2]).toEqual({ title: "Buttons & links", none: "buttons", headings: ["Label", "Action type", "Model action", "Runs auto", "Cancel"], rows: [] });
    expect(cardSections(result("app", [sections]), "Overview (copy)", "card-a")[0].rows.map(row => row[2])).toEqual(["REP09 Copy"]);
    expect(cardSections(result("app", [sections]), "Stores", "card-a")[0].rows).toEqual([]);
  });

  it("leaves out a part whose file is missing or cannot be matched to a card", () => {
    const noId: ResultTable = { file: "Filters.csv", label: "Filters", headers: ["Page", "Card #"], rows: [["Overview", 1]], guard: true };
    const composed: ResultTable = { file: "Filters.csv", label: "Filters", headers: ["Page", "Card ID", "Operator"], rows: [["Overview", "card-a", "is blank"], ["Overview", "card-a", "—"]], guard: true };
    expect(cardSections(result("app", [noId]), "Overview", "card-a")).toEqual([]);
    expect(cardSections(result("model", []), "Overview", "card-a")).toEqual([]);
    // A column the file lacks is an empty cell, or left out of a cell made of several.
    expect(cardSections(result("app", [composed]), "Overview", "card-a")[0].rows).toEqual([["", "", "", "—", "is blank", ""], ["", "", "", "—", "—", ""]]);
    // Asked for a card's number as well, a file without that column cannot be matched to the card either.
    expect(cardSections(result("app", [composed]), "Overview", "card-a", "1")).toEqual([]);
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
