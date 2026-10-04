import { describe, expect, it } from "vitest";
import { HEADERS, type TabName } from "../report.js";
import type { AnalysisResult, ResultTable } from "../result-types.js";
import { APP_FILES, cardsNamed, cardsOf, COLUMN_CHOICES, columnIndex, columnsOf, FILTER_MAX, FILTER_MIN, NUMBERS_HIDDEN, ROW_NAME_COLUMNS, rowColumns, rowKeys, rowNameIndex } from "./columns.js";

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

  it("keeps the design's choices for the Cards file: filters, what starts hidden, numbers, and what is a tag, an ID or a link", () => {
    const columns = columnsOf(appTable("Cards.csv"));
    expect(labels(columns.filter(column => column.filter))).toEqual(["Page", "Card type", "View type"]);
    expect(labels(columns.filter(column => column.hidden))).toEqual(["Card #", "Card ID", "Source IDs"]);
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
    expect(choices("Grid Sections.csv")).toEqual({
      filter: ["Page", "View type", "Section layout"], hidden: ["Card #", "Section #", "Card ID", "Section ID", "Module ID"], num: ["Card #", "Section #"] });
    expect(choices("Filters.csv")).toEqual({
      filter: ["Page", "Filter on", "Filtered dimension", "Show items that match", "Operator"], hidden: ["Card #", "Section #", "Card ID", "Line item ID"], num: ["Card #", "Section #"] });
    expect(choices("Conditional Formatting.csv")).toEqual({ filter: ["Page", "Format style"], hidden: ["Card #", "Section #", "Card ID", "Line item ID"], num: ["Card #", "Section #"] });
    expect(choices("Action Buttons.csv")).toEqual({
      filter: ["Page", "Action type", "Name source", "Runs automatically", "Cancel button"], hidden: ["Card #", "Card ID", "Action ID"], num: ["Card #"] });
    expect(choices("Where Used.csv")).toEqual({ filter: ["Object type", "Page", "Used as"], hidden: ["Card #", "Object ID"], num: ["Card #"] });
    // Every ID column is an ID to copy.
    for (const file of Object.keys(FILES)) {
      const columns = columnsOf(appTable(file));
      expect(labels(columns.filter(column => column.kind === "id")), file).toEqual(HEADERS[FILES[file]].filter(header => / ID$/.test(header)));
    }
    // The Pages file lists each page once, so its Page column has no filter; Where Used has no Card ID, so its Card # is a number only.
    expect(columnsOf(appTable("Pages.csv")).find(column => column.label === "Page")).toMatchObject({ kind: "page", filter: false });
    expect(columnsOf(appTable("Where Used.csv")).find(column => column.label === "Card #")).toMatchObject({ kind: "text", num: true });
  });

  it("starts every ID, every card's number and every section's number hidden, in each of the app's tables that has one", () => {
    expect(NUMBERS_HIDDEN).toEqual(["Card #", "Section #"]);
    const startsHidden = (header: string) => / IDs?$/.test(header) || NUMBERS_HIDDEN.includes(header);
    for (const file of Object.keys(FILES)) {
      const headers = HEADERS[FILES[file]];
      // Exactly those, by the names the analysis gives its columns: a table that gains such a column hides it too.
      expect(labels(columnsOf(appTable(file)).filter(column => column.hidden)), file).toEqual(headers.filter(startsHidden));
    }
    // Each of the three is in more than one table, and none of them is a table's first column: the cell that opens a row stays.
    const tablesWith = (header: string) => Object.keys(FILES).filter(file => HEADERS[FILES[file]].includes(header));
    expect([tablesWith("Card #").length, tablesWith("Section #").length, tablesWith("Card ID").length]).toEqual([6, 3, 5]);
    expect(Object.keys(FILES).map(file => labels(columnsOf(appTable(file)).filter(column => !column.hidden))[0]))
      .toEqual(["App", "Page", "Page", "Page", "Page", "Page", "Object type"]);
    // What opens a card is still told apart from a number: where the row holds the card's ID, the card's number is a link to it.
    expect(Object.fromEntries(Object.keys(FILES).filter(file => HEADERS[FILES[file]].includes("Card #")).map(file =>
      [file, columnsOf(appTable(file)).find(column => column.label === "Card #")?.kind]))).toEqual({
      "Cards.csv": "card", "Grid Sections.csv": "card", "Filters.csv": "card", "Conditional Formatting.csv": "card", "Action Buttons.csv": "card", "Where Used.csv": "text" });
    // A file the page has no choices for hides nothing, whatever its columns are called.
    expect(columnsOf(table("Line Items.csv", ["", "Card #", "Section #", "Card ID"])).some(column => column.hidden)).toBe(false);
  });

  it("gives the column Anaplan leaves unnamed a name of the page's own, and leaves the table's header as it is", () => {
    // Every file of a model export starts with an unnamed column that holds each row's name.
    const lineItems = table("Line Items.csv", ["", "Formula", "", "Format"]);
    expect(labels(columnsOf(lineItems))).toEqual(["Name", "Formula", "Column 3", "Format"]);
    expect(lineItems.headers).toEqual(["", "Formula", "", "Format"]);
    // A header that is really called Name keeps its place and its choices; an empty one picks up none.
    expect(columnsOf({ ...appTable("Cards.csv"), headers: ["", "Card #"] }).map(column => [column.label, column.kind])).toEqual([["Name", "text"], ["Card #", "card"]]);
  });

  it("keeps each column at its header's place when headers are unnamed, as in every file of a model", () => {
    // The place is what a sort, a filter and a cell are read by: the page's own names for unnamed headers change none of it.
    const lineItems = table("Line Items.csv", ["", "Formula", "", "Format", ""]);
    expect(columnsOf(lineItems).map(column => [column.index, column.label])).toEqual([[0, "Name"], [1, "Formula"], [2, "Column 3"], [3, "Format"], [4, "Column 5"]]);
    // A header is found by its own text: the first unnamed one by the empty text, and none by a name the page gave.
    expect([columnIndex(lineItems, ""), columnIndex(lineItems, "Format"), columnIndex(lineItems, "Name"), columnIndex(lineItems, "Column 3")]).toEqual([0, 3, undefined, undefined]);
    // Only a file whose every header is unnamed, and one with no headers at all.
    expect(columnsOf(table("Odd.csv", ["", "", ""])).map(column => [column.index, column.label])).toEqual([[0, "Name"], [1, "Column 2"], [2, "Column 3"]]);
    expect(columnsOf(table("Empty.csv", []))).toEqual([]);
  });

  it("shows every column of a file it has no choices for as plain text: a model's files, odd names", () => {
    const columns = columnsOf(table("Line Items.csv", ["", "Formula", "Page", "Card ID", "constructor", "__proto__", "Formula"]));
    expect(columns.map(column => [column.label, column.kind, column.num, column.filter, column.hidden]))
      .toEqual(["Name", "Formula", "Page", "Card ID", "constructor", "__proto__", "Formula"].map(label => [label, "text", false, false, false]));
    // Neither does a file, or a header, with the name of a built-in property pick up anything.
    expect(columnsOf(table("constructor", ["toString", "Page"])).map(column => column.kind)).toEqual(["text", "text"]);
    expect(columnsOf({ ...appTable("Cards.csv"), headers: ["hasOwnProperty", "Card #"] }).map(column => column.kind)).toEqual(["text", "card"]);
  });

  it("offers a filter on any column that holds between 2 and 30 different texts, in a model's files too", () => {
    expect([FILTER_MIN, FILTER_MAX]).toEqual([2, 30]);
    /** A column of `rows` rows that holds `different` different texts. */
    const values = (different: number, rows = 90) => Array.from({ length: rows }, (_, index) => `value ${index % different}`);
    const columns = { "": values(90), One: values(1), Two: values(2), Thirty: values(30), "Thirty-one": values(31), Numbers: values(90).map((_, index) => index % 3),
      // A blank is a text like any other, and so is the cell a short row does not have.
      Blank: values(90).map((_, index) => (index % 2 ? "" : "set")), "All blank": values(90).map(() => "") };
    const headers = Object.keys(columns);
    const rows = values(90).map((_, row) => Object.values(columns).map(column => column[row]));
    const lineItems: ResultTable = { ...table("Line Items.csv", [...headers, "Missing"]), rows: rows.map((row, index) => (index % 2 ? [...row, "there"] : row)) };
    expect(Object.fromEntries(columnsOf(lineItems).map(column => [column.label, column.filter]))).toEqual({
      Name: false, One: false, Two: true, Thirty: true, "Thirty-one": false, Numbers: true, Blank: true, "All blank": false, Missing: true });
    // Nothing else about the column changes with it.
    expect(columnsOf(lineItems).every(column => column.kind === "text" && !column.num && !column.hidden)).toBe(true);
    // Texts that differ only in case, or in a space, are different texts, as the filter lists them.
    const cased: ResultTable = { ...table("Modules.csv", ["", "Area"]), rows: [["a", "Sales"], ["b", "sales"], ["c", "Sales "]] };
    expect(columnsOf(cased).map(column => column.filter)).toEqual([true, true]);
    // Without rows no column of a model's file has anything to filter.
    expect(columnsOf(table("Line Items.csv", headers)).some(column => column.filter)).toBe(false);
  });

  it("keeps the design's filters in an app's files whatever their columns hold, and adds one where a column holds few texts", () => {
    const cards = appTable("Cards.csv");
    const at = (header: string) => cards.headers.indexOf(header);
    const row = (page: string, number: number, type: string, saved: string) => cards.headers.map((_, index) =>
      (index === at("Page") ? page : index === at("Card #") ? number : index === at("Card type") ? type : index === at("Saved view") ? saved : index === at("Card ID") ? `card-${page}-${number}` : "—"));
    const filters = (rows: ReturnType<typeof row>[]) => labels(columnsOf({ ...cards, rows }).filter(column => column.filter));
    // One page and one type: the design's three filters stay, although each has nothing to choose between.
    expect(filters([row("Overview", 1, "Grid", "—")])).toEqual(["Page", "Card type", "View type"]);
    // Forty pages: Page keeps its filter although it holds more than thirty texts. Card # and Saved view gain one.
    const many = Array.from({ length: 80 }, (_, index) => row(`Page ${index % 40}`, index % 2 + 1, index % 3 ? "Grid" : "KPI", index % 5 ? "—" : "Top 10"));
    expect(filters(many)).toEqual(["Page", "Card #", "Card type", "View type", "Saved view"]);
    // The column is still what the design made it: a hidden ID with few values is a hidden ID that can be filtered.
    const pages = appTable("Pages.csv");
    const twoModels = Array.from({ length: 6 }, (_, index) => pages.headers.map(header => (header === "Page" ? `Page ${index}` : header === "Model ID" ? `model-${index % 2}` : "—")));
    expect(columnsOf({ ...pages, rows: twoModels }).find(column => column.label === "Model ID")).toMatchObject({ kind: "id", hidden: true, filter: true });
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
    expect(rowKeys(filters)).toEqual({ page: 0, cardId: 13, number: 1 });
    expect(rowKeys(appTable("Where Used.csv"))).toEqual({ page: 3, cardId: undefined, number: 4 });
    expect(rowKeys(table("Modules.csv", ["", "Functional Area"]))).toEqual({ page: undefined, cardId: undefined, number: undefined });
  });

  it("names the column a row of each of the app's files is called by, and none for any other file", () => {
    expect(ROW_NAME_COLUMNS).toEqual({ Pages: "Page", Cards: "Card title", "Grid sections": "Source module", Filters: "Condition line item", Formatting: "Formatted line item",
      Actions: "Button label", "Where used": "Object name" });
    // One for each of the app's files, each a column the analysis really writes, and none of them the file's first column,
    // which is the app or the page that the rows of a page share.
    expect(Object.keys(ROW_NAME_COLUMNS)).toEqual(Object.keys(HEADERS));
    expect((Object.keys(HEADERS) as TabName[]).map(tab => HEADERS[tab].indexOf(ROW_NAME_COLUMNS[tab]))).toEqual([2, 2, 5, 8, 5, 2, 1]);
    expect(Object.keys(FILES).map(file => rowNameIndex(appTable(file)))).toEqual([2, 2, 5, 8, 5, 2, 1]);
    // A table that lacks the column, and a file the page knows no such column of: a model's, whatever its columns are called.
    expect([rowNameIndex(table("Cards.csv", ["Page", "Card #"])), rowNameIndex(table("Line Items.csv", ["", "Page", "Card title"])), rowNameIndex(table("constructor", ["Page"]))])
      .toEqual([undefined, undefined, undefined]);
  });

  it("links to cards only when the result has a Cards file with a Page and a Card ID", () => {
    const result = (tables: ResultTable[]): AnalysisResult => ({ kind: "app", name: "App", id: "id", zipName: "App.zip", tables, summary: [] });
    expect(cardsOf(result([appTable("Pages.csv"), appTable("Cards.csv")]))).toMatchObject({ index: 1, page: 0, cardId: 17, number: 1 });
    expect(cardsOf(result([table("Cards.csv", ["Page", "Card ID"])]))).toMatchObject({ index: 0, page: 0, cardId: 1, number: undefined });
    expect(cardsOf(result([appTable("Pages.csv")]))).toBeUndefined();
    expect(cardsOf(result([table("Cards.csv", ["Page", "Card #"])]))).toBeUndefined();
    expect(cardsOf(result([table("Line Items.csv", ["", "Formula"])]))).toBeUndefined();
  });

  it("finds the cards that a page's name and a Card ID name, and tells cards of one name and ID apart by their number", () => {
    const result = (cards: ResultTable): AnalysisResult => ({ kind: "app", name: "App", id: "id", zipName: "App.zip", tables: [cards], summary: [] });
    // Two pages are called Overview, and the second is a copy that kept its cards' IDs: one card stands where it stood,
    // one was moved to another place. The files have only a page's name, so both pages' cards are under the one name.
    const file: ResultTable = { ...table("Cards.csv", ["Page", "Card #", "Card title", "Card ID"]), rows: [
      ["Overview", 1, "Sales", "card-a"], ["Overview", 2, "Margin", "card-b"], ["Overview", 1, "Sales, copied", "card-a"], ["Overview", 3, "Margin, moved", "card-b"],
      ["Stores", 1, "Stores", "card-a"], ["constructor", 1, "Odd", "__proto__"]] };
    const cards = cardsOf(result(file));
    if (!cards) throw new Error("The result has a Cards file.");
    const titles = (page: string, cardId: string, number?: string) => cardsNamed(cards, page, cardId, number).map(row => row[2]);
    // By name and ID: each row with both, in the file's order. They are rows of the file itself, so that a card found is the row to open.
    expect([titles("Overview", "card-a"), titles("Overview", "card-b"), titles("Stores", "card-a")]).toEqual([["Sales", "Sales, copied"], ["Margin", "Margin, moved"], ["Stores"]]);
    expect(cardsNamed(cards, "Overview", "card-a")[1]).toBe(file.rows[2]);
    // The number tells cards of one name and ID apart where it differs, and does not where it is the same.
    expect([titles("Overview", "card-b", "2"), titles("Overview", "card-b", "3"), titles("Overview", "card-b", "9"), titles("Overview", "card-a", "1")])
      .toEqual([["Margin"], ["Margin, moved"], [], ["Sales", "Sales, copied"]]);
    // One card of a name and an ID is that card whatever number is asked: the number is only what tells several apart.
    expect([titles("Stores", "card-a", "1"), titles("Stores", "card-a", "7")]).toEqual([["Stores"], ["Stores"]]);
    // A name or an ID the file does not have, in another case, or the name of a built-in property: no card, or its own.
    expect([titles("Overview", "card-z"), titles("overview", "card-a"), titles("Stores", "card-b"), titles("toString", "card-a"), titles("constructor", "__proto__")])
      .toEqual([[], [], [], [], ["Odd"]]);
    // A Cards file without the number: every card of the name and the ID, whatever number is asked.
    const unnumbered = cardsOf(result({ ...table("Cards.csv", ["Page", "Card title", "Card ID"]), rows: [["Overview", "Sales", "card-a"], ["Overview", "Sales, copied", "card-a"]] }));
    if (!unnumbered) throw new Error("The result has a Cards file.");
    expect(cardsNamed(unnumbered, "Overview", "card-a", "1").map(row => row[1])).toEqual(["Sales", "Sales, copied"]);
  });
});
