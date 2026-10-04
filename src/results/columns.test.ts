import { describe, expect, it } from "vitest";
import { HEADERS, type TabName } from "../report.js";
import type { AnalysisResult, ResultTable } from "../result-types.js";
import { APP_FILES, cardsOf, COLUMN_CHOICES, columnIndex, columnsOf, rowColumns, rowKeys } from "./columns.js";

/** The app export's files, as the page names them, and the report table each holds. */
const FILES: Record<string, TabName> = Object.fromEntries((Object.keys(APP_FILES) as TabName[]).map(tab => [APP_FILES[tab], tab]));
const table = (file: string, headers: string[]): ResultTable => ({ file, label: file.replace(/\.csv$/, ""), headers, rows: [], guard: true });
const appTable = (file: string): ResultTable => table(file, HEADERS[FILES[file]]);
const labels = (columns: { label: string }[]) => columns.map(column => column.label);

describe("The results page's columns", () => {
  it("names an app's files in one place: one for each of the report's tables, each a CSV file of its own", () => {
    // analyse.ts writes the files under these very names; a test beside it holds the two lists together.
    expect(APP_FILES).toEqual({ Pages: "Pages.csv", Cards: "Cards.csv", "Grid sections": "Grid Sections.csv", Filters: "Filters.csv",
      Formatting: "Conditional Formatting.csv", Actions: "Action Buttons.csv", "Where used": "Where Used.csv" });
    expect(Object.keys(APP_FILES)).toEqual(Object.keys(HEADERS));
    expect(new Set(Object.values(APP_FILES)).size).toBe(7);
  });

  it("makes its choices only for columns the app's files really have", () => {
    expect([...COLUMN_CHOICES.keys()]).toEqual(Object.values(APP_FILES));
    for (const [file, choices] of COLUMN_CHOICES) {
      expect([...choices.keys()].filter(header => !HEADERS[FILES[file]].includes(header)), file).toEqual([]);
    }
  });

  it("takes a table's columns from its headers, in their order, each at its own place in a row", () => {
    const columns = columnsOf(appTable("Cards.csv"));
    expect(labels(columns)).toEqual(HEADERS.Cards);
    expect(columns.map(column => column.index)).toEqual(HEADERS.Cards.map((_, index) => index));
  });

  it("keeps the design's choices for the Cards file: filters, hidden IDs, numbers, and what is a tag, an ID or a link", () => {
    const columns = columnsOf(appTable("Cards.csv"));
    expect(labels(columns.filter(column => column.filter))).toEqual(["Page", "Card type", "View type"]);
    expect(labels(columns.filter(column => column.hidden))).toEqual(["Card ID", "Source IDs"]);
    expect(labels(columns.filter(column => column.num))).toEqual(["Card #"]);
    expect(Object.fromEntries(columns.filter(column => column.kind !== "text").map(column => [column.label, column.kind]))).toEqual({
      "Page": "page", "Card #": "card", "Card title": "card", "Card type": "tag", "View type": "tag", "Card ID": "id" });
  });

  it("keeps them for the other six files", () => {
    const choices = (file: string) => {
      const columns = columnsOf(appTable(file));
      return { filter: labels(columns.filter(column => column.filter)), hidden: labels(columns.filter(column => column.hidden)), num: labels(columns.filter(column => column.num)) };
    };
    expect(choices("Pages.csv")).toEqual({
      filter: ["Category", "Page type", "Publish state", "Model"], hidden: ["Page ID", "App ID", "Model ID"],
      num: ["Total cards", "Grid cards", "Chart cards", "KPI cards", "Field cards", "Action cards", "Text & image cards"] });
    expect(choices("Grid Sections.csv")).toEqual({ filter: ["Page", "View type", "Section layout"], hidden: ["Section ID", "Module ID"], num: ["Card #", "Section #"] });
    expect(choices("Filters.csv")).toEqual({
      filter: ["Page", "Filter on", "Filtered dimension", "Show items that match", "Operator"], hidden: ["Line item ID"], num: ["Card #", "Section #"] });
    expect(choices("Conditional Formatting.csv")).toEqual({ filter: ["Page", "Format style"], hidden: ["Line item ID"], num: ["Card #", "Section #"] });
    expect(choices("Action Buttons.csv")).toEqual({
      filter: ["Page", "Action type", "Name source", "Runs automatically", "Cancel button"], hidden: ["Action ID"], num: ["Card #"] });
    expect(choices("Where Used.csv")).toEqual({ filter: ["Object type", "Page", "Used as"], hidden: ["Object ID"], num: ["Card #"] });
    // Every ID column is an ID to copy; Card ID is shown where it is the way back to the card, and hidden on the card's own row.
    for (const file of Object.keys(FILES)) {
      const columns = columnsOf(appTable(file));
      expect(labels(columns.filter(column => column.kind === "id")), file).toEqual(HEADERS[FILES[file]].filter(header => / ID$/.test(header)));
    }
    expect(columnsOf(appTable("Filters.csv")).find(column => column.label === "Card ID")).toMatchObject({ kind: "id", hidden: false });
    // The Pages file lists each page once, so its Page column has no filter; Where Used has no Card ID, so its Card # is a number only.
    expect(columnsOf(appTable("Pages.csv")).find(column => column.label === "Page")).toMatchObject({ kind: "page", filter: false });
    expect(columnsOf(appTable("Where Used.csv")).find(column => column.label === "Card #")).toMatchObject({ kind: "text", num: true });
  });

  it("gives the column Anaplan leaves unnamed a name of the page's own, and leaves the table's header as it is", () => {
    // Every file of a model export starts with an unnamed column that holds each row's name.
    const lineItems = table("Line Items.csv", ["", "Formula", "", "Format"]);
    expect(labels(columnsOf(lineItems))).toEqual(["Name", "Formula", "Column 3", "Format"]);
    expect(lineItems.headers).toEqual(["", "Formula", "", "Format"]);
    // A header that is really called Name keeps its place and its choices; an empty one picks up none.
    expect(columnsOf({ ...appTable("Cards.csv"), headers: ["", "Card #"] }).map(column => [column.label, column.kind])).toEqual([["Name", "text"], ["Card #", "card"]]);
  });

  it("shows every column of a file it has no choices for as plain text: a model's files, odd names", () => {
    const columns = columnsOf(table("Line Items.csv", ["", "Formula", "Page", "Card ID", "constructor", "__proto__", "Formula"]));
    expect(columns.map(column => [column.label, column.kind, column.num, column.filter, column.hidden]))
      .toEqual(["Name", "Formula", "Page", "Card ID", "constructor", "__proto__", "Formula"].map(label => [label, "text", false, false, false]));
    // Neither does a file, or a header, with the name of a built-in property pick up anything.
    expect(columnsOf(table("constructor", ["toString", "Page"])).map(column => column.kind)).toEqual(["text", "text"]);
    expect(columnsOf({ ...appTable("Cards.csv"), headers: ["hasOwnProperty", "Card #"] }).map(column => column.kind)).toEqual(["text", "card"]);
  });

  it("gives a row its table's columns, and one more for each cell it holds beyond the headers", () => {
    const columns = columnsOf(table("Line Items.csv", ["", "Formula"]));
    expect(rowColumns(columns, ["Revenue", "Units * Price"])).toEqual(columns);
    expect(rowColumns(columns, ["Short"])).toEqual(columns);
    expect(rowColumns(columns, [])).toEqual(columns);
    expect(rowColumns(columns, ["Revenue", "Units * Price", "x", "", 5]).map(column => [column.index, column.label, column.kind, column.hidden])).toEqual([
      [0, "Name", "text", false], [1, "Formula", "text", false], [2, "Column 3", "text", false], [3, "Column 4", "text", false], [4, "Column 5", "text", false]]);
    // The table's own columns are not touched.
    expect(labels(columns)).toEqual(["Name", "Formula"]);
  });

  it("finds a header's place, and the columns that identify a row's page and card", () => {
    const filters = appTable("Filters.csv");
    expect([columnIndex(filters, "Page"), columnIndex(filters, "Card ID"), columnIndex(filters, "Nothing")]).toEqual([0, 13, undefined]);
    expect(rowKeys(filters)).toEqual({ page: 0, cardId: 13 });
    expect(rowKeys(appTable("Where Used.csv"))).toEqual({ page: 3, cardId: undefined });
    expect(rowKeys(table("Modules.csv", ["", "Functional Area"]))).toEqual({ page: undefined, cardId: undefined });
  });

  it("links to cards only when the result has a Cards file with a Page and a Card ID", () => {
    const result = (tables: ResultTable[]): AnalysisResult => ({ kind: "app", name: "App", id: "id", zipName: "App.zip", tables, summary: [] });
    expect(cardsOf(result([appTable("Pages.csv"), appTable("Cards.csv")]))).toMatchObject({ index: 1, page: 0, cardId: 17 });
    expect(cardsOf(result([appTable("Pages.csv")]))).toBeUndefined();
    expect(cardsOf(result([table("Cards.csv", ["Page", "Card #"])]))).toBeUndefined();
    expect(cardsOf(result([table("Line Items.csv", ["", "Formula"])]))).toBeUndefined();
  });
});
