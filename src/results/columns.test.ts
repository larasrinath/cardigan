import { describe, expect, it } from "vitest";
import { PAGE_ACTIONS_HEADERS, PAGE_FILTERS_HEADERS } from "../model-pages.js";
import { MODEL_PAGE_FILES, MODULE_USAGE_FILE, MODULE_USAGE_HEADERS, PAGE_ACTIONS_FILE, PAGE_FILTERS_FILE, PAGE_PLACE_HEADERS } from "../page-files.js";
import { HEADERS, type TabName } from "../report.js";
import type { AnalysisResult, ResultTable } from "../result-types.js";
import { APP_FILES, cardsNamed, cardsOf, COLUMN_CHOICES, columnIndex, columnsOf, FILTER_MAX, FILTER_MIN, FREE_TEXT, MEASURES, MODEL_COUNTS, MODEL_FILTERED, MODEL_HIDDEN, NUMBERS_HIDDEN,
  ROW_NAME_COLUMNS, rowColumns, rowKeys, rowNameIndex, writesNone } from "./columns.js";
import { cellText } from "./table-engine.js";
import { MODEL_FILE_ORDER } from "./result-view.js";

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
      "Page": "page", "Card #": "card", "Card title": "card", "Card type": "tag", "View type": "tag", "Conditional formatting": "colours", "Card ID": "id" });
  });

  it("shows the colours of formatting rules as squares where the files write their colour stops: in Cards and in Conditional Formatting", () => {
    const colours = (file: string) => labels(columnsOf(appTable(file)).filter(column => column.kind === "colours"));
    expect(colours("Cards.csv")).toEqual(["Conditional formatting"]);
    expect(colours("Conditional Formatting.csv")).toEqual(["Colour stops"]);
    // Grid Sections counts a section's rules and names no colour.
    expect(colours("Grid Sections.csv")).toEqual([]);
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

  it("shows a count as a count: an app's numbers of cards on a page, and a model's cells and list items, by file and header", () => {
    /** Each column that is not plain text, with its kind and whether it is a number. */
    const shown = (table: ResultTable) => columnsOf(table).filter(column => column.kind !== "text" || column.num).map(column => [column.label, column.kind, column.num]);
    // The Pages file's numbers of cards are counts. A card's number and a section's are not: they only name a card or a
    // section on its page, and stay as they are, as does every ID.
    expect(shown(appTable("Pages.csv")).filter(([, kind]) => kind === "count").map(([label]) => label))
      .toEqual(["Total cards", "Grid cards", "Chart cards", "KPI cards", "Field cards", "Action cards", "Text & image cards"]);
    for (const file of Object.keys(FILES)) {
      const columns = columnsOf(appTable(file));
      expect(columns.filter(column => NUMBERS_HIDDEN.includes(column.label)).map(column => column.kind).filter(kind => kind === "count"), file).toEqual([]);
      expect(columns.filter(column => / ID$/.test(column.label)).every(column => column.kind === "id"), file).toBe(true);
    }
    // A model's files, as model/export.ts names them, and the headers of Anaplan's own grids: each count is a count, right-
    // aligned as a number is, and every other column of the file stays plain text, whatever number it holds.
    // Line Items also counts the page filters that have each line item as their condition, which a model's run adds.
    expect([...MODEL_COUNTS]).toEqual([["Modules.csv", ["Cell Count", "Populated Cell Count"]], ["Line Items.csv", ["Cell Count", "Populated Cell Count", "Page Filters"]],
      ["General Lists.csv", ["Item Count"]]]);
    expect(shown(table("Modules.csv", ["", "Applies To", "Cell Count", "Functional Area", "Notes"]))).toEqual([["Cell Count", "count", true]]);
    expect(shown(table("General Lists.csv", ["", "Parent Hierarchy", "Top Level Item", "Numbered List", "Item Count", "Next Item Index", "Notes"]))).toEqual([["Item Count", "count", true]]);
    expect(shown(table("Line Items.csv", ["", "Format", "Time Range", "Cell Count", "Populated Cell Count", "Calculation Effort", "Code", "Module Name", "Page Filters"])))
      .toEqual([["Cell Count", "count", true], ["Populated Cell Count", "count", true], ["Page Filters", "count", true]]);
    // Another model file with a column of the same name is not known to count anything, nor is a count's header in
    // another case, and the files of actions keep their times and durations as text.
    expect([shown(table("Versions.csv", ["", "Cell Count"])), shown(table("Modules.csv", ["", "cell count"])),
      shown(table("Processes.csv", ["", "Start Date and Time (UTC)", "Most recent duration (ms)"])), shown(table("Time Ranges.csv", ["", "Start Period", "End Period"]))]).toEqual([[], [], [], []]);
    // Every file named is one the page knows a model's files by: it lists them all in the navigation's order.
    expect([...MODEL_COUNTS.keys(), ...MODEL_HIDDEN.keys(), ...MODEL_FILTERED.keys()].filter(file => !MODEL_FILE_ORDER.includes(file))).toEqual([]);
    // A Model Calendar setting's allowed values only guide filling the template in by hand: the column starts hidden.
    const calendar = columnsOf(table("Model Calendar.csv", ["Section", "Setting", "Value", "Allowed values"]));
    expect(calendar.map(column => [column.label, column.hidden])).toEqual([["Section", false], ["Setting", false], ["Value", false], ["Allowed values", true]]);
  });

  it("shows the tables of the pages built on a model as the app's tables they are made from, each with a filter on the app", () => {
    const choices = (file: string, headers: readonly string[]) => columnsOf(table(file, [...headers])).map(column => [column.label, column.kind, column.filter, column.hidden]);
    // Where each page is ends every one of the three, hidden: its type as a tag, and its app's ID and its own as IDs.
    const place = [["Page type", "tag", true, true], ["App ID", "id", false, true], ["Page ID", "id", false, true]];
    expect(choices(MODULE_USAGE_FILE, MODULE_USAGE_HEADERS)).toEqual([["Module", "text", false, false], ["App", "text", true, false], ["Page", "text", false, false], ...place]);
    // Page Filters and Page Actions hold an app's Filters and Action Buttons in an order of their own, with the app and
    // where the page is: each of the app's columns is shown as in the app's table, IDs and numbers hidden.
    for (const [file, headers, tab] of [[PAGE_FILTERS_FILE, PAGE_FILTERS_HEADERS, "Filters"], [PAGE_ACTIONS_FILE, PAGE_ACTIONS_HEADERS, "Actions"]] as const) {
      const own = new Map(choices(APP_FILES[tab], HEADERS[tab]).map(choice => [choice[0], choice]));
      const theirs = new Map([["App", ["App", "text", true, false]], ...place.map(choice => [choice[0], choice] as const)]);
      expect(choices(file, headers), file).toEqual(headers.map(header => own.get(header) ?? theirs.get(header)));
      expect(columnsOf(table(file, [...headers])).filter(column => column.hidden).map(column => column.label).sort(), file)
        .toEqual([...columnsOf(appTable(APP_FILES[tab])).filter(column => column.hidden).map(column => column.label), ...PAGE_PLACE_HEADERS].sort());
    }
    // The run writes them, so the dash alone says there is nothing, and a row is named as the app's own tables name one.
    expect(MODEL_PAGE_FILES.map(file => writesNone(table(file, ["App"])))).toEqual([true, true, true]);
    expect([rowNameIndex(table(PAGE_FILTERS_FILE, [...PAGE_FILTERS_HEADERS])), rowNameIndex(table(PAGE_ACTIONS_FILE, [...PAGE_ACTIONS_HEADERS])),
      rowNameIndex(table(MODULE_USAGE_FILE, [...MODULE_USAGE_HEADERS]))]).toEqual([1, 5, undefined]);
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
    // Thirty-one texts that each stand in three rows offer one too: a column of many texts does, as long as they repeat.
    expect(Object.fromEntries(columnsOf(lineItems).map(column => [column.label, column.filter]))).toEqual({
      Name: false, One: false, Two: true, Thirty: true, "Thirty-one": true, Numbers: true, Blank: true, "All blank": false, Missing: true });
    // Nothing else about the column changes with it.
    expect(columnsOf(lineItems).every(column => column.kind === "text" && !column.num && !column.hidden)).toBe(true);
    // Texts that differ only in case, or in a space, are different texts, as the filter lists them.
    const cased: ResultTable = { ...table("Modules.csv", ["", "Area"]), rows: [["a", "Sales"], ["b", "sales"], ["c", "Sales "]] };
    expect(columnsOf(cased).map(column => column.filter)).toEqual([true, true]);
    // Without rows no column of a model's file has anything to filter.
    expect(columnsOf(table("Line Items.csv", headers)).some(column => column.filter)).toBe(false);
  });

  it("offers a filter past thirty texts where they repeat, but not on a row's name, free text, an ID or texts each in one row; numbers and dates have a range", () => {
    expect([FREE_TEXT, MEASURES]).toEqual([["Formula", "Notes", "Text content", "Description"], ["Cell Count", "Populated Cell Count", "Memory Used", "Calculation Effort",
      "Item Count", "Next item index", "Most recent duration (ms)", "Start Date and Time (UTC)", "Last published"]]);
    const pad = (number: number) => String(number).padStart(2, "0");
    /** Ninety rows of a model's Line Items, and what each column holds in each. */
    const cells: Record<string, (row: number) => string> = {
      // The row's own name: forty-five names, each in two rows. The search finds a name.
      "": row => `Line ${row % 45}`,
      // Forty modules, each in several rows: the filter lists them.
      "Module Name": row => `Module ${row % 40}`,
      // Free text, an ID and a measure, each by its header, with forty texts that repeat. The measure holds numbers.
      Formula: row => `Units * ${row % 40}`, Notes: row => `Note ${row % 40}`, "Line item ID": row => `li-${row % 40}`, "Cell Count": row => String(row % 40),
      // Numbers, a share and dates, by what they hold, under headers the page knows nothing of: each is filtered by a range.
      Size: row => String(1000 + (row % 40)), Share: row => `${(row % 40) / 10}%`, Started: row => `2026-${pad(1 + (row % 12))}-${pad(1 + (row % 28))}`,
      // Codes, each in one row, beside blanks: the blank says nothing, so nothing that says something repeats.
      Code: row => (row % 3 ? "" : `C${row}`),
      // Names listed in a cell: each cell is its own, but its first item stands in two rows.
      "Applies To": row => `List ${row % 45}, Time ${row}`,
      // Few texts: a filter, whatever they are.
      "Is Summary": row => (row % 2 ? "true" : "false"), Few: row => String(row % 5),
    };
    const headers = Object.keys(cells);
    const lineItems: ResultTable = { ...table("Line Items.csv", headers), rows: Array.from({ length: 90 }, (_, row) => headers.map(header => cells[header](row))) };
    const listed = new Map([[headers.indexOf("Applies To"), (text: string) => text.split(", ")]]);
    expect(Object.fromEntries(columnsOf(lineItems, listed).map(column => [column.label, column.filter]))).toEqual({
      Name: false, "Module Name": true, Formula: false, Notes: false, "Line item ID": false, "Cell Count": true, Size: true, Share: true, Started: true, Code: false,
      "Applies To": true, "Is Summary": true, Few: true });
    // The measure, the numbers, the share, the dates and the few figures are each filtered by a range; nothing else is.
    expect(Object.fromEntries(columnsOf(lineItems, listed).filter(column => column.range).map(column => [column.label, column.range])))
      .toEqual({ "Cell Count": "number", Size: "number", Share: "number", Started: "date", Few: "number" });
    // Read whole, each cell of Applies To stands in one row alone: it is the list's items that repeat.
    expect(columnsOf(lineItems).find(column => column.label === "Applies To")?.filter).toBe(false);
    // With thirty texts or fewer, each of them offers a filter, as it always did: a name, free text, an ID and a measure too.
    const few: ResultTable = { ...lineItems, rows: lineItems.rows.map(row => row.map(cell => cellText(cell).replace(/\d+/g, digits => String(Number(digits) % 3)))) };
    expect(columnsOf(few, listed).filter(column => !column.filter).map(column => column.label)).toEqual([]);
    // In an app's table, any column of many texts that repeat offers a list to tick, a button's action; its card's number,
    // a number in each of ninety rows, is filtered by a range.
    const actions: ResultTable = { ...appTable("Action Buttons.csv"), rows: Array.from({ length: 90 }, (_, row) => HEADERS.Actions.map(header =>
      (header === "Card #" ? row : header === "Model action name" ? `Action ${row % 40}` : header === "Page" ? "Overview" : "-"))) };
    const offered = columnsOf(actions).filter(column => column.filter).map(column => [column.label, column.range ?? "list"]);
    expect([offered.find(([label]) => label === "Model action name"), offered.find(([label]) => label === "Card #")]).toEqual([["Model action name", "list"], ["Card #", "number"]]);
  });

  it("filters a column of numbers or of dates by a range rather than a list to tick: figures, counts, measures, a card's number, a date", () => {
    // Source Models: five sources, whose Sources and Imports are figures. A list of 9, 10, 12 and 113 to tick says less than a range.
    const sources: ResultTable = { ...table("Source Models.csv", ["", "Sources", "Imports", "Mapped To"]),
      rows: [["Model A", "113", "113", "Products"], ["Model B", "10", "10", "Regions"], ["Model C", "10", "10", "Products"], ["Model D", "12", "14", "Time"], ["Model E", "9", "9", "Regions"]] };
    expect(columnsOf(sources).map(column => [column.label, column.filter, column.range])).toEqual([
      ["Name", true, undefined], ["Sources", true, "number"], ["Imports", true, "number"], ["Mapped To", true, undefined]]);
    // An action's start, in UTC, and how long it last took, its thousands apart: a date and a number, by what they hold.
    const actions: ResultTable = { ...table("Imports.csv", ["", "Start Date and Time (UTC)", "Most recent duration (ms)", "Source Type"]),
      rows: [["Load", "2026-03-12 23:19:56", "1,582", "FILE"], ["Sort", "2026-03-13 08:00:00", "40", "FILE"], ["Copy", "", "", "MODEL"]] };
    expect(columnsOf(actions).map(column => column.range)).toEqual([undefined, "date", "number", undefined]);
    // In an app's files: a page's cards, a count, and when it was last published, where the dash says that it never was; a
    // card's number, which the design shows as a number and a link.
    const pages: ResultTable = { ...appTable("Pages.csv"), rows: [["App", "Overview", 12, "2026-10-01"], ["App", "Detail", 4, "-"]].map(([app, page, total, published]) =>
      HEADERS.Pages.map(header => (header === "App" ? app : header === "Page" ? page : header === "Total cards" ? total : header === "Last published" ? published : "-"))) };
    expect(Object.fromEntries(columnsOf(pages).filter(column => column.range).map(column => [column.label, column.range]))).toEqual({ "Total cards": "number", "Last published": "date" });
    const cards: ResultTable = { ...appTable("Cards.csv"), rows: [1, 2, 3].map(number => HEADERS.Cards.map(header => (header === "Card #" ? number : header === "Card title" ? `Card ${number}` : "-"))) };
    expect(columnsOf(cards).find(column => column.label === "Card #")).toMatchObject({ kind: "card", num: true, hidden: true, filter: true, range: "number" });
  });

  it("filters no row's name, ID, code or list of items by a range, and needs two texts, a blank among them, as any filter does", () => {
    const rows = (...cells: string[][]) => cells;
    const headers = ["", "Line item ID", "Code", "Parts", "Only", "Once", "Mixed", "Zeros"];
    const lineItems: ResultTable = { ...table("Line Items.csv", headers), rows: rows(
      ["101", "102000000001", "11", "1, 2", "5", "5", "7", "0040"],
      ["202", "102000000002", "12", "3", "5", "", "seven", "0041"],
      ["303", "102000000003", "13", "4, 5", "5", "", "8", "0042"]) };
    const listed = new Map([[headers.indexOf("Parts"), (text: string) => text.split(", ")]]);
    // The row's name, an ID and a code are figures here, and none of them a range; a list's items are ticked one by one; a
    // column of one figure has nothing to choose, and one figure beside blanks keeps or leaves out the blanks; figures beside
    // a word, and figures that begin with a zero, which are codes, are ticked.
    expect(columnsOf(lineItems, listed).map(column => [column.label, column.filter, column.range ?? "list"])).toEqual([
      ["Name", true, "list"], ["Line item ID", true, "list"], ["Code", true, "list"], ["Parts", true, "list"], ["Only", false, "list"], ["Once", true, "number"],
      ["Mixed", true, "list"], ["Zeros", true, "list"]]);
    // A column of IDs by the design's choice is no range either, whatever it holds.
    const pages: ResultTable = { ...appTable("Pages.csv"), rows: [1, 2].map(at => HEADERS.Pages.map(header => (header === "Page" ? `Page ${at}` : header === "Page ID" ? String(at) : "-"))) };
    expect(columnsOf(pages).find(column => column.label === "Page ID")).toMatchObject({ kind: "id", filter: true });
    expect(columnsOf(pages).find(column => column.label === "Page ID")?.range).toBeUndefined();
  });

  it("always offers a filter on the data type of a line item's format, which the page adds to a model's Line Items, however many texts it holds", () => {
    expect([...MODEL_FILTERED]).toEqual([["Line Items.csv", ["Format type"]]]);
    /** A Line Items table as the page shows it, with as many different texts under Format type as `different`. */
    const typed = (different: number): ResultTable => ({ ...table("Line Items.csv", ["", "Module Name", "Format", "Format type"]),
      rows: Array.from({ length: 40 }, (_, index) => [`Item ${index}`, "Plan", `Format ${index}`, `Type ${index % different}`]) });
    // One text, or more than thirty: the filter is there either way. The other columns offer one as any column does.
    for (const different of [1, 2, 31, 40]) {
      expect(columnsOf(typed(different)).map(column => [column.label, column.filter]), String(different))
        .toEqual([["Name", false], ["Module Name", false], ["Format", false], ["Format type", true]]);
    }
    // Nothing else about the column changes with it: plain text, shown.
    expect(columnsOf(typed(40)).find(column => column.label === "Format type")).toMatchObject({ kind: "text", num: false, hidden: false, filter: true });
    // Only there: another file's column of that name, or one under another name, offers a filter only as any column does.
    expect(columnsOf({ ...typed(40), file: "Modules.csv" }).find(column => column.label === "Format type")?.filter).toBe(false);
    expect(columnsOf({ ...typed(40), headers: ["", "Module Name", "Format", "format type"] }).find(column => column.label === "format type")?.filter).toBe(false);
  });

  it("keeps the design's filters in an app's files whatever their columns hold, and adds one where a column holds few texts", () => {
    const cards = appTable("Cards.csv");
    const at = (header: string) => cards.headers.indexOf(header);
    const row = (page: string, number: number, type: string, saved: string) => cards.headers.map((_, index) =>
      (index === at("Page") ? page : index === at("Card #") ? number : index === at("Card type") ? type : index === at("Saved view") ? saved : index === at("Card ID") ? `card-${page}-${number}` : "-"));
    const filters = (rows: ReturnType<typeof row>[]) => labels(columnsOf({ ...cards, rows }).filter(column => column.filter));
    // One page and one type: the design's three filters stay, although each has nothing to choose between.
    expect(filters([row("Overview", 1, "Grid", "-")])).toEqual(["Page", "Card type", "View type"]);
    // Forty pages: Page keeps its filter although it holds more than thirty texts. Card # and Saved view gain one.
    const many = Array.from({ length: 80 }, (_, index) => row(`Page ${index % 40}`, index % 2 + 1, index % 3 ? "Grid" : "KPI", index % 5 ? "-" : "Top 10"));
    expect(filters(many)).toEqual(["Page", "Card #", "Card type", "View type", "Saved view"]);
    // The column is still what the design made it: a hidden ID with few values is a hidden ID that can be filtered.
    const pages = appTable("Pages.csv");
    const twoModels = Array.from({ length: 6 }, (_, index) => pages.headers.map(header => (header === "Page" ? `Page ${index}` : header === "Model ID" ? `model-${index % 2}` : "-")));
    expect(columnsOf({ ...pages, rows: twoModels }).find(column => column.label === "Model ID")).toMatchObject({ kind: "id", hidden: true, filter: true });
  });

  it("takes the dash alone for nothing to say in the app's files only: in a model's file it is Anaplan's own text", () => {
    // Each of the app's files is written by the analysis, which writes the dash where it has nothing to say: in every
    // column the dash says that.
    for (const file of Object.keys(FILES)) {
      expect([writesNone(appTable(file)), columnsOf(appTable(file)).every(column => column.none)], file).toEqual([true, true]);
    }
    // A model's file is Anaplan's grid, where Anaplan writes a dash itself, and a file the page knows nothing about is no
    // file of the app's either: whatever its name or its columns, the dash is its text.
    for (const other of [table("Modules.csv", ["", "Applies To"]), table("Imports.csv", ["", "Source Object"]), table("Line Items.csv", ["", "Page", "Card ID"]),
      table("constructor", ["Page"]), table("__proto__", ["Page"]), table("", ["Page"])]) {
      expect([writesNone(other), columnsOf(other).some(column => column.none)], other.file).toEqual([false, false]);
    }
    // A cell beyond a row's headers is its table's like any other.
    const beyond = (file: string, headers: string[]) => rowColumns(columnsOf(table(file, headers)), ["a", "b", "c"]).map(column => column.none);
    expect([beyond("Cards.csv", ["Page"]), beyond("Line Items.csv", [""])]).toEqual([[true, true, true], [false, false, false]]);
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
