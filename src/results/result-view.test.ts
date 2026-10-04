import { describe, expect, it } from "vitest";
import { DETAILS_HEADERS, diagnosticRows, exportRows, type DetailRow } from "../details.js";
import { HEADERS, type TabName } from "../report.js";
import type { AnalysisResult, Cell, ResultTable } from "../result-types.js";
import { analysedOf, CARD_PARTS, cardSections, detailSections, detailsOf, detailValue, diagnosticLog, overviewOf, resultNotes } from "./result-view.js";

const FILES: Record<string, TabName> = {
  "Pages.csv": "Pages", "Cards.csv": "Cards", "Grid Sections.csv": "Grid sections", "Filters.csv": "Filters",
  "Conditional Formatting.csv": "Formatting", "Action Buttons.csv": "Actions", "Where Used.csv": "Where used",
};
const LOG = "14:02:05 page-analyzer v0.7.0: app on us1a.app.anaplan.com\r\n14:02:06 app: 2 pages\r\nplain line\r\n14:02:07 ";
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
    });
  });

  it("gives a model's overview its row counts and nothing made up", () => {
    const lineItems: ResultTable = { file: "Line Items.csv", label: "Line Items", headers: ["", "Formula"], rows: [["Revenue", "Units * Price"], ["Units", ""]], guard: false };
    const modules: ResultTable = { file: "Modules.csv", label: "Modules", headers: ["", "Card type", "Model"], rows: [["REP01", "x", "y"]], guard: false };
    expect(overviewOf(result("model", [modelDetails, lineItems, modules], ["Line Items: 2 rows", "Modules: 1 rows"]))).toEqual({
      tiles: [{ label: "Line Items", count: 2 }, { label: "Modules", count: 1 }], cardTypes: [], models: [],
      notes: ["Actions: the Actions list came without Notes; the Diagnostics rows list the columns it had."] });
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
