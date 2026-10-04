import { describe, expect, it } from "vitest";
import { DETAILS_HEADERS, diagnosticRows, exportRows, type DetailRow } from "../details.js";
import { HEADERS, type TabName } from "../report.js";
import { CALENDAR_HEADERS, calendarRows } from "../model/calendar.js";
import type { AnalysisResult, Cell, ResultTable } from "../result-types.js";
import { APP_FILES } from "./columns.js";
import { ABOUT_MODEL, analysedOf, CARD_PARTS, cardSections, detailSections, detailsOf, detailValue, diagnosticLog, listedRows, listedTables, MODEL_CALENDAR_FILE, MODEL_FILE_ORDER, modelFacts,
  overviewOf, resultNotes, unlistedNote } from "./result-view.js";

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
  ["How to read", "Page and Card #", "Identify a card in every file."],
  ...diagnosticRows(LOG),
]);
const modelDetails = detailsTable("Model Details.csv", [
  ["Model", "Model", "Model one"], ["Model", "Workspace", "Main"],
  ...exportRows("eu2a.app.anaplan.com", new Date(Date.UTC(2026, 9, 3, 9, 30, 0))),
  ["Files", "Line Items.csv", "120 rows"], ["Files", "Imports.csv", "Not exported: the grid did not load"],
  ["Notes", "Actions", "the Actions list came without Notes; the Diagnostics rows list the columns it had."],
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
      "Actions: the Actions list came without Notes; the Diagnostics rows list the columns it had."];
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
      // What the Details file says besides: what was read, in the file's order; the files whose row says something else than
      // the file's own number of rows (here the Details file was written for fewer rows); how to read them; and the log.
      about: [["App", "Demo app"], ["App ID", "01234567-89ab-cdef-0123-456789abcdef"], ["Cards", "3"], ["Exported on", "2026-10-03 14:02 UTC"], ["Exported with", "Cardigan dev"],
        ["Anaplan host", "us1a.app.anaplan.com"]],
      files: [["Pages.csv", "2 rows"], ["Cards.csv", "3 rows"]],
      howToRead: [["Page and Card #", "Identify a card in every file."]],
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
      notes: ["Actions: the Actions list came without Notes; the Diagnostics rows list the columns it had."],
      about: [["Model", "Model one"], ["Workspace", "Main"], ["Exported on", "2026-10-03 09:30 UTC"], ["Exported with", "Cardigan dev"], ["Anaplan host", "eu2a.app.anaplan.com"]],
      files: [["Line Items.csv", "120 rows"], ["Imports.csv", "Not exported: the grid did not load"]], howToRead: [], log: [] });
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
      [["Imports.csv", "2 rows (2 matched in the Actions list)"], ["Source Models.csv", "Not exported: no such axis"]]]);
    // A section the page does not know is part of what the export is about: its rows are there too.
    expect(overview.about.slice(-1)).toEqual([["A detail", "its value"]]);
    // Every row of the Details file is somewhere on the overview.
    const held = (row: Cell[]): boolean => {
      const [section, detail, value] = row.map(String);
      const pair = ([first, second]: readonly [string, string]) => first === detail && second === value;
      if (section === "Diagnostics") return overview.log.includes(detail ? `${detail} ${value}` : value);
      if (section === "Notes") return overview.notes.includes(`${detail}: ${value}`);
      if (section === "How to read") return overview.howToRead.some(pair);
      if (section === "Files") return overview.files.some(pair) || overview.tiles.some(tile => `${tile.label}.csv` === detail && `${tile.count} rows` === value);
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

  it("lists a model's files in the order of Anaplan's Model settings, and an app's as the result has them", () => {
    expect(MODEL_FILE_ORDER).toEqual(["Model Calendar.csv", "Time Ranges.csv", "Versions.csv", "General Lists.csv", "Line Item Subsets.csv", "Modules.csv", "Line Items.csv",
      "Processes.csv", "Imports.csv", "Import Data Sources.csv", "Exports.csv", "Other Actions.csv", "Source Models.csv"]);
    expect([MODEL_FILE_ORDER[0], new Set(MODEL_FILE_ORDER).size]).toEqual([MODEL_CALENDAR_FILE, 13]);
    const file = (name: string): ResultTable => ({ file: name, label: name.replace(/\.csv$/, ""), headers: ["", "Value"], rows: [], guard: false });
    /** The files of a result as the page lists them: each one's name and its place in the result. */
    const listed = (kind: "app" | "model", ...names: string[]) => listedTables(result(kind, [modelDetails, ...names.map(file)])).map(({ index, table }) => `${index} ${table.file}`);
    // The export's own order (model/export.ts), after the Details file: every file moves to its place, and keeps its place in the result as its name.
    const written = ["Line Items.csv", "Modules.csv", "General Lists.csv", "Processes.csv", "Imports.csv", "Import Data Sources.csv", "Exports.csv", "Other Actions.csv", "Time Ranges.csv",
      "Versions.csv", "Source Models.csv", "Model Calendar.csv"];
    expect(listed("model", ...written)).toEqual(["12 Model Calendar.csv", "9 Time Ranges.csv", "10 Versions.csv", "3 General Lists.csv", "2 Modules.csv", "1 Line Items.csv", "4 Processes.csv",
      "5 Imports.csv", "6 Import Data Sources.csv", "7 Exports.csv", "8 Other Actions.csv", "11 Source Models.csv"]);
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
      "Line Items", "Processes", "Imports", "Import Data Sources", "Exports", "Other Actions", "Source Models"]);
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
    const listed = listedRows(model, file);
    expect([file.rows.length, listed.unlisted, listed.rows.length, [...new Set(listed.rows.map(row => row[0]))]]).toEqual([31, 5, 26, ["Model Calendar"]]);
    expect(listed.rows).toEqual(file.rows.filter(row => row[0] !== "Model"));
    expect(file.rows.filter(row => row[0] === "Model").map(row => row[1])).toEqual(["Workspace", "Model", "Model size (GB)", "Captured on", "Captured by"]);
    // The file itself is as it was: the CSV is made of it.
    expect(file.rows).toHaveLength(31);
    // Any other file lists every row, the same rows, whatever its columns are called and hold; so does the Details file.
    expect([listedRows(model, lineItems).rows === lineItems.rows, listedRows(model, lineItems).unlisted, listedRows(model, modelDetails).unlisted]).toEqual([true, 0, 0]);
    // The rule is that file's alone: by its name, in a model's result, by its Section column.
    expect(listedRows(model, { ...file, file: "Model Calendar (2).csv" }).unlisted).toBe(0);
    expect(listedRows(result("app", [appDetails, file]), file).unlisted).toBe(0);
    expect(listedRows(model, { ...file, headers: ["Group", ...file.headers.slice(1)] }).unlisted).toBe(0);
    // A row is left to the CSV for being about the model, not for its place: wherever such a row stands, and only such a row.
    const mixed: ResultTable = { ...file, headers: ["Setting", "Section", "Value"], rows: [["Calendar Type", "Model Calendar", "x"], ["Model", "Model", "y"], ["Other", "Something else", "z"], ["Model", "model", "w"]] };
    expect(listedRows(model, mixed)).toEqual({ rows: [mixed.rows[0], mixed.rows[2], mixed.rows[3]], unlisted: 1 });
    // A calendar file with no row about the model lists every row, and is the same list.
    const none: ResultTable = { ...file, rows: file.rows.slice(5) };
    expect([listedRows(model, none).rows === none.rows, listedRows(model, none).unlisted]).toEqual([true, 0]);
    // What the table then says about the rows it leaves out.
    expect([unlistedNote(5), unlistedNote(1)]).toEqual(["5 rows about the model are in the CSV only.", "1 row about the model is in the CSV only."]);
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
      ["Anaplan host", "eu2a.app.anaplan.com"], ["Captured on", "2026-10-03"]], [{ label: "Model Calendar", count: 26 }]]);
    // A fact that says something else than the Details file is said as well.
    expect(overviewOf(result("model", [modelDetails, calendar("Another workspace")])).about.slice(-2)).toEqual([["Workspace", "Another workspace"], ["Captured on", "2026-10-03"]]);
    // Without a Details file the facts are all the overview has about the export.
    expect(overviewOf(result("model", [calendar()])).about).toEqual([["Workspace", "Main"], ["Model", "Model one"], ["Captured on", "2026-10-03"]]);
    // The summary's line that says how many rows the file has is still no note: it counts the file, as the CSV has it.
    expect(overview.notes).toEqual(["Actions: the Actions list came without Notes; the Diagnostics rows list the columns it had."]);
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
  });
});
