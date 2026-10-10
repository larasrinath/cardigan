import { describe, expect, it } from "vitest";
import type { Cell, ResultTable } from "../result-types.js";
import { columnWidths, headerWidth, ROW_BUTTON, WIDEST } from "./column-widths.js";
import { columnsOf, type Column } from "./columns.js";
import { parseMarkup, type FakeElement } from "./dom.test-support.js";
import { cardDrawerHtml, cardDrawerSubHtml, cellHtml, colChooserHtml, colFilterHtml, FILE_ICONS, FILTER_FIND_FROM, FILTER_LISTED_MAX, filterMatches, filterOptionsHtml, filterStatusText,
  filterTickWords, FORGOTTEN_LINE, keptCopyHtml, MAP_FAILED, MAP_LABEL, mapHtml, NAV_ICONS, navHtml, navItems, navMenuHtml, NOT_REMOVED_LINE, objectDrawerHtml, objectDrawerSubHtml, overviewHtml, pagerHtml, rangeFilterHtml, rowCellHtml, rowDrawerHtml, tableHtml, USES_AT_FIRST, type KeptCopy, type Links, type NavItem,
  type TableView } from "./markup.js";
import type { Overview } from "./result-view.js";
import { dayOf, NONE, pageOf, rangeColumn, selectRows } from "./table-engine.js";
import type { WhereUsedObject } from "./where-used-view.js";

// What each piece of markup shows: the right value in the right place. markup.test.ts checks that no value can change the
// markup, with the same hostile texts everywhere; here every value is harmless and different from its neighbours, so a
// value in the wrong place, or a button that carries the wrong column, shows.

const LINKS: Links = { page: true, card: true };
const NO_LINKS: Links = { page: false, card: false };
const KINDS: Column["kind"][] = ["text", "id", "tag", "page", "card"];
/** A column of one of the app's tables, where the dash alone says that there is nothing (columns.ts `Column`). */
const column = (index: number, label: string, kind: Column["kind"] = "text", extra: Partial<Column> = {}): Column =>
  ({ index, label, kind, num: false, filter: false, hidden: false, none: true, ...extra });

// Cards.csv, so that its columns are the design's: Page a link with a filter, Card # a number, Card type a tag with a
// filter, Card ID an ID that starts hidden.
const CARDS: ResultTable = {
  file: "Cards.csv", label: "Cards", headers: ["Page", "Card #", "Card title", "Card type", "Card ID"], guard: true,
  rows: [["Overview", 1, "Sales by region", "Grid", "card-a"], ["Overview", 2, "Margin %", "KPI", "card-b"], ["Stores", 3, "", "Text", "-"]],
};
// A model's file: its first header is empty, and nothing is known about its columns.
const LINES: ResultTable = {
  file: "Line Items.csv", label: "Line Items", headers: ["", "Formula", "", "Format"], guard: false,
  rows: [["Revenue", "Units * Price", "x1", "Number"], ["Units", "", "x2", "Number"], ["Price", "12.5", "x3", "Text"]],
};

function viewOf(table: ResultTable, links: Links, overrides: Partial<TableView> = {}): TableView {
  const page = pageOf(selectRows(table.rows, { search: "", filters: new Map() }), 0, 50);
  return { label: table.label, columns: columnsOf(table), widths: columnWidths(columnsOf(table), table.rows), rows: page.rows, page: page.page, pages: page.pages, pageSize: 50,
    from: page.from, to: page.to, total: page.total, all: table.rows.length, search: "", sort: undefined, filtered: new Set(), context: undefined, links, note: undefined, ...overrides };
}
const text = (element: FakeElement | null | undefined): string => element?.textContent.trim() ?? "";
/** An overview that holds nothing but what a test gives it. */
const overviewWith = (parts: Partial<Overview>): Overview => ({ tiles: [], notes: [], about: [], files: [], howToRead: [], log: [], ...parts });
/** The body of a table's markup: the text of each cell, row by row. */
const cells = (html: string): string[][] => parseMarkup(html).querySelectorAll("tbody tr").map(row => row.children.map(text));

describe("What the results page's markup shows", () => {
  it("shows in a cell the text of its own column, by the column's place in the row and not its place on screen", () => {
    const row: Cell[] = ["zero", "one", "two", "three"];
    for (const kind of KINDS) {
      for (const links of [LINKS, NO_LINKS]) {
        for (const index of [0, 1, 2, 3]) expect(text(parseMarkup(cellHtml(column(index, "Any", kind), row, links))), `${kind} ${index}`).toBe(row[index]);
      }
    }
    // A number shows as its digits, 0 included. An empty or missing cell shows nothing, and in an app's table the dash is
    // the greyed dash, in every kind of column. In a model's it is Anaplan's text, shown as any text is in its column.
    expect([text(parseMarkup(cellHtml(column(1, "Card #"), ["a", 0], NO_LINKS))), text(parseMarkup(cellHtml(column(1, "Card #"), ["a", -12.5], NO_LINKS)))]).toEqual(["0", "-12.5"]);
    for (const kind of KINDS) {
      expect([cellHtml(column(0, "Any", kind), [""], LINKS), cellHtml(column(3, "Any", kind), ["a"], LINKS)], kind).toEqual(["", ""]);
      const dash = parseMarkup(cellHtml(column(0, "Any", kind), [NONE], LINKS)).children;
      expect(dash.map(element => [element.localName, element.getAttribute("class"), element.textContent]), kind).toEqual([["span", "dash", NONE]]);
      const anaplans = parseMarkup(cellHtml(column(0, "Any", kind, { none: false }), [NONE], LINKS));
      expect([text(anaplans), anaplans.querySelectorAll(".dash").length], kind).toEqual([NONE, 0]);
    }
  });

  it("greys the dash in an app's table, where it says that there is nothing, and shows it as text in a model's, where it is Anaplan's", () => {
    // The app's Cards file with the dash for a card without a title, and a model's Modules file as Anaplan writes it: a
    // dash under Applies To on the rows that divide the list of modules, one of which is called by a dash alone.
    const cards: ResultTable = { ...CARDS, rows: [["Overview", 1, NONE, "Grid", "card-a"]] };
    const modules: ResultTable = { file: "Modules.csv", label: "Modules", headers: ["", "Applies To"], guard: false,
      rows: [["REV01 Revenue", "Products, Time"], ["--- Inputs ---", NONE], [NONE, NONE]] };
    const [app, model] = [columnsOf(cards), columnsOf(modules)];
    /** What a cell is made of: each element, by its name, its class, its text and its tooltip. */
    const made = (html: string) => parseMarkup(html).children.map(element => [element.localName, element.getAttribute("class"), element.textContent, element.title]);
    // In the app's table the dash is greyed, and is no text with a tooltip; in the table and in the drawer alike.
    expect([made(cellHtml(app[2], cards.rows[0], LINKS)), made(cellHtml(app[2], cards.rows[0], LINKS, true))]).toEqual([[["span", "dash", NONE, ""]], [["span", "dash", NONE, ""]]]);
    // In the model's table it is the cell's text like any other, with its tooltip, whichever column it is in.
    expect([made(cellHtml(model[1], modules.rows[1], NO_LINKS)), made(cellHtml(model[0], modules.rows[2], NO_LINKS))]).toEqual([[["span", "cell-t", NONE, NONE]], [["span", "cell-t", NONE, NONE]]]);
    // Where it is the cell that opens its row, it is the button's own content, as a name is, and the button is named by it.
    const [opens, ...others] = parseMarkup(rowCellHtml(model[0], modules.rows[2], NO_LINKS)).children;
    expect([others.length, opens.dataset.act, opens.getAttribute("aria-label"), opens.children.map(child => [child.getAttribute("class"), child.textContent])])
      .toEqual([0, "row", null, [["cell-t", NONE]]]);
    // Whole tables: the app's greys its one dash; the model's greys none of its three, and shows each as it was written.
    expect(parseMarkup(tableHtml(viewOf(cards, LINKS))).querySelectorAll("tbody .dash").map(text)).toEqual([NONE]);
    const shown = tableHtml(viewOf(modules, NO_LINKS));
    expect([parseMarkup(shown).querySelectorAll(".dash").length, cells(shown)]).toEqual([0, [["REV01 Revenue", "Products, Time"], ["--- Inputs ---", NONE], [NONE, NONE]]]);
  });

  it("shows a cell the way its column is shown: plain text, an ID to copy, a tag, or a link to a page or a card", () => {
    /** The one element a cell is made of: what it is, its class, what a click on it does, and its tooltip. */
    const made = (kind: Column["kind"], links: Links) => {
      const [element, ...others] = parseMarkup(cellHtml(column(1, "Any", kind), ["other", "Value one"], links)).children;
      return [others.length, element.localName, element.getAttribute("class"), element.dataset.act ?? element.dataset.copy ?? null, element.title, element.textContent];
    };
    expect(made("text", LINKS)).toEqual([0, "span", "cell-t", null, "Value one", "Value one"]);
    expect(made("tag", LINKS)).toEqual([0, "span", "tag", null, "", "Value one"]);
    expect(made("id", LINKS)).toEqual([0, "button", "id-pill", "Value one", "Copy Value one", "Value one"]);
    expect(made("page", LINKS)).toEqual([0, "button", "link", "page", "Show cards on Value one", "Value one"]);
    expect(made("card", LINKS)).toEqual([0, "button", "link", "card", "Open card details", "Value one"]);
    // Without the result's Cards file there is nothing to link to: a page or a card is plain text. An ID is still an ID.
    expect(made("page", NO_LINKS)).toEqual(made("text", NO_LINKS));
    expect(made("card", NO_LINKS)).toEqual(made("text", NO_LINKS));
    expect(made("id", NO_LINKS)).toEqual(made("id", LINKS));
    // A page's link needs only pages to link to, a card's link needs cards.
    expect([made("page", { page: true, card: false })[3], made("card", { page: true, card: false })[3]]).toEqual(["page", null]);
    expect(parseMarkup(cellHtml(column(0, "Card ID", "id"), ["card-a"], LINKS)).children[0].getAttribute("aria-label")).toBe("Copy ID card-a");
  });

  it("makes a card a link row by row where the table says which rows' cards the result has, in the table and in the row's drawer", () => {
    // A table whose rows name their card by its number alone, as every use of Where Used does.
    const columns = [column(0, "Object name"), column(1, "Page", "page"), column(2, "Card #", "card", { num: true })];
    const [found, lost]: Cell[][] = [["Time", "Overview", 1], ["Time", "Overview", 9]];
    const links: Links = { page: true, card: true, hasCard: row => row === found };
    const cards = (html: string) => parseMarkup(`<div>${html}</div>`).querySelectorAll('[data-act="card"]').map(button => [text(button), button.title]);
    // The card the result has is a link that opens it; the other is its number, as text.
    expect([cards(cellHtml(columns[2], found, links)), cards(cellHtml(columns[2], lost, links)), text(parseMarkup(`<div>${cellHtml(columns[2], lost, links)}</div>`))])
      .toEqual([[["1", "Open card details"]], [], "9"]);
    // The same in the row's drawer, where every column stands, shown or not; the page is a link in both rows.
    expect([cards(rowDrawerHtml(columns, found, links)), cards(rowDrawerHtml(columns, lost, links))]).toEqual([[["1", "Open card details"]], []]);
    expect([found, lost].map(row => parseMarkup(rowDrawerHtml(columns, row, links)).querySelectorAll('[data-act="page"]').length)).toEqual([1, 1]);
    // A table that links no cards links none, whatever is said of a row; one that does not say links every row's.
    expect([cards(cellHtml(columns[2], found, { ...links, card: false })), cards(cellHtml(columns[2], lost, { page: true, card: true }))]).toEqual([[], [["9", "Open card details"]]]);
  });

  it("heads a table with the columns shown, in their order, each with the sort button of that column", () => {
    /** Each heading: its name, the column its sort button carries, how it says it is sorted, the way its sort mark points
     * ("asc", "desc", or nothing) and whether it is a number's. The mark is drawn: the button's text is the name alone. */
    const heads = (view: TableView) => parseMarkup(tableHtml(view)).querySelectorAll("thead th").map(heading => {
      const button = heading.querySelector(".th-sort");
      const mark = heading.querySelector(".dir")?.dataset.dir ?? "";
      return [text(button), button?.dataset.sort, heading.getAttribute("aria-sort"), mark, heading.classList.contains("num")];
    });
    expect(heads(viewOf(CARDS, LINKS))).toEqual([["Page", "0", "none", "", false], ["Card #", "1", "none", "", true], ["Card title", "2", "none", "", false],
      ["Card type", "3", "none", "", false], ["Card ID", "4", "none", "", false]]);
    // With columns hidden, a heading still carries its own column, not its place among the ones shown.
    const some = columnsOf(CARDS).filter(entry => [1, 3, 4].includes(entry.index));
    expect(heads(viewOf(CARDS, LINKS, { columns: some, sort: { column: 3, dir: "asc" } }))).toEqual([["Card #", "1", "none", "", true],
      ["Card type", "3", "ascending", "asc", false], ["Card ID", "4", "none", "", false]]);
    expect(heads(viewOf(CARDS, LINKS, { columns: some, sort: { column: 4, dir: "desc" } })).map(heading => heading.slice(2, 4))).toEqual([["none", ""], ["none", ""], ["descending", "desc"]]);
    // A sort on a column that is not shown marks none of the ones that are.
    expect(heads(viewOf(CARDS, LINKS, { columns: some, sort: { column: 0, dir: "asc" } })).map(heading => heading[2])).toEqual(["none", "none", "none"]);
    // A model's file: the unnamed columns get the page's names, and each sort button its place among the file's headers.
    expect(heads(viewOf(LINES, NO_LINKS)).map(heading => heading.slice(0, 2))).toEqual([["Name", "0"], ["Formula", "1"], ["Column 3", "2"], ["Format", "3"]]);
    expect(heads(viewOf(LINES, NO_LINKS, { columns: columnsOf(LINES).slice(2) })).map(heading => heading.slice(0, 2))).toEqual([["Column 3", "2"], ["Format", "3"]]);
  });

  it("gives a filter button to the columns that offer a filter, each carrying its own column", () => {
    const filters = (view: TableView) => parseMarkup(tableHtml(view)).querySelectorAll("thead th").map(heading => heading.querySelector("[data-colfilter]")?.dataset.colfilter ?? null);
    /** The table's columns, with a filter on these and on no other. */
    const offering = (table: ResultTable, indexes: number[]) => columnsOf(table).map(entry => ({ ...entry, filter: indexes.includes(entry.index) }));
    expect(filters(viewOf(CARDS, LINKS, { columns: offering(CARDS, [0, 3]) }))).toEqual(["0", null, null, "3", null]);
    expect(filters(viewOf(CARDS, LINKS, { columns: offering(CARDS, [1, 2, 4]) }))).toEqual([null, "1", "2", null, "4"]);
    // With columns hidden, a filter button still carries its own column, not its place among the ones shown.
    expect(filters(viewOf(CARDS, LINKS, { columns: offering(CARDS, [0, 3]).filter(entry => [2, 3].includes(entry.index)) }))).toEqual([null, "3"]);
    expect(filters(viewOf(LINES, NO_LINKS, { columns: offering(LINES, [3]) }))).toEqual([null, null, null, "3"]);
    expect(filters(viewOf(LINES, NO_LINKS, { columns: offering(LINES, [2, 3]).slice(2) }))).toEqual(["2", "3"]);
    expect(filters(viewOf(LINES, NO_LINKS, { columns: offering(LINES, []) }))).toEqual([null, null, null, null]);
  });

  it("puts each cell under its own heading: the value of that column, for the rows of the page, in their order", () => {
    const all = columnsOf(CARDS);
    const expected = (rows: Cell[][], shown: number[]) => rows.map(row => shown.map(index => String(row[index])));
    for (const shown of [[0, 1, 2, 3, 4], [1, 3, 4], [4], [2, 0], [4, 3, 2, 1, 0]]) {
      const html = tableHtml(viewOf(CARDS, NO_LINKS, { columns: shown.map(index => all[index]) }));
      expect(cells(html), shown.join()).toEqual(expected(CARDS.rows, shown));
    }
    // The rows are the ones the view is given, in the order it gives them: a page of a sorted or searched table.
    const picked = [CARDS.rows[2], CARDS.rows[0]];
    expect(cells(tableHtml(viewOf(CARDS, LINKS, { rows: picked })))).toEqual(expected(picked, [0, 1, 2, 3, 4]));
    // A model's file, with a row that is shorter than the headers: the cells it lacks are empty.
    expect(cells(tableHtml(viewOf({ ...LINES, rows: [...LINES.rows, ["Short"]] }, NO_LINKS)))).toEqual([["Revenue", "Units * Price", "x1", "Number"], ["Units", "", "x2", "Number"],
      ["Price", "12.5", "x3", "Text"], ["Short", "", "", ""]]);
    // A number's column is marked in every row as in its heading.
    const numbers = parseMarkup(tableHtml(viewOf(CARDS, LINKS))).querySelectorAll("tbody tr").map(row => row.children.map(cell => cell.classList.contains("num")));
    expect(numbers).toEqual(Array(3).fill([false, true, false, false, false]));
  });

  it("lays a table out by a width for each column shown, in their order, each its own and the same for any rows shown", () => {
    /** The width each column's <col> says, in ch, in the order of the columns. */
    const widths = (view: TableView) => parseMarkup(tableHtml(view)).querySelectorAll("colgroup col").map(col => col.getAttribute("style"));
    const all = columnsOf(CARDS);
    const given = new Map([[0, 31], [1, 12], [2, 40], [3, 15], [4, 20]]);
    // One <col> for each column shown, before the head, each with its own column's width; the button that opens a row
    // stands before a page's link in the first cell, and that column has its room too.
    const table = parseMarkup(tableHtml(viewOf(CARDS, LINKS, { widths: given }))).querySelector("table");
    expect(table?.children.map(child => child.localName)).toEqual(["colgroup", "thead", "tbody"]);
    expect(widths(viewOf(CARDS, LINKS, { widths: given }))).toEqual([`--width:${31 + ROW_BUTTON}ch`, "--width:12ch", "--width:40ch", "--width:15ch", "--width:20ch"]);
    // A column carries its width wherever it is shown, and only the columns shown have one. The button's room goes with
    // the cell that opens the row: none where that cell's content is the button itself, as a card's title is without links.
    expect(widths(viewOf(CARDS, LINKS, { widths: given, columns: [all[4], all[2], all[1]] }))).toEqual([`--width:${20 + ROW_BUTTON}ch`, "--width:40ch", "--width:12ch"]);
    expect(widths(viewOf(CARDS, NO_LINKS, { widths: given, columns: [all[2], all[0]] }))).toEqual(["--width:40ch", "--width:31ch"]);
    expect(widths(viewOf(CARDS, NO_LINKS, { widths: given, columns: [all[0]], opensFrom: 2 }))).toEqual(["--width:31ch"]);
    // The rows shown, a page of them, sorted, searched, filtered or none at all, change no width.
    const whole = widths(viewOf(CARDS, LINKS));
    for (const overrides of [{ rows: [CARDS.rows[2]] }, { rows: [...CARDS.rows].reverse(), sort: { column: 2, dir: "desc" as const } }, { rows: [], total: 0, from: 0, to: 0, search: "zzz" },
      { filtered: new Set([3]), rows: CARDS.rows.slice(0, 1) }, { page: 1, pages: 2, from: 51, to: 52 }]) {
      expect(widths(viewOf(CARDS, LINKS, overrides)), JSON.stringify(overrides)).toEqual(whole);
    }
    // A column without a width of its own is as wide as its header; a width that is not a whole number is rounded, and
    // none is wider than a column gets.
    expect(widths(viewOf(CARDS, NO_LINKS, { widths: new Map([[2, 17.4], [3, 900]]), columns: [all[2], all[3], all[1]] })))
      .toEqual(["--width:17ch", `--width:${WIDEST}ch`, `--width:${headerWidth(all[1])}ch`]);
  });

  it("shows a count with its thousands apart, in the table, in its tooltip and in the drawer, and any other text of its column as it is", () => {
    const columns = [column(0, "Name"), column(1, "Cell Count", "count", { num: true }), column(2, "Module ID", "id"), column(3, "Code")];
    const rows: Cell[][] = [["Revenue", "15389009578", "102000000001", "102000000001"], ["Units", 1234, "x", "1234"], ["Empty", "", "", ""], ["None", NONE, NONE, NONE],
      ["Word", "n/a", "", ""], ["Fraction", "12.5", "", ""], ["Grouped", "2,400", "", ""], ["Code", "0012", "", ""], ["Open", "41+", "", ""], ["Small", "12", "", ""]];
    const shown = rows.map(row => text(parseMarkup(cellHtml(columns[1], row, NO_LINKS))));
    expect(shown).toEqual(["15,389,009,578", "1,234", "", NONE, "n/a", "12.5", "2,400", "0012", "41+", "12"]);
    // The tooltip says what the cell shows; the dash is the greyed dash, as in every column.
    expect(parseMarkup(cellHtml(columns[1], rows[0], NO_LINKS)).children[0].title).toBe("15,389,009,578");
    expect(parseMarkup(cellHtml(columns[1], rows[3], NO_LINKS)).children.map(element => element.getAttribute("class"))).toEqual(["dash"]);
    // An ID and a code of figures are not counts: they show as they are, in the table and in the drawer.
    expect([text(parseMarkup(cellHtml(columns[2], rows[0], NO_LINKS))), text(parseMarkup(cellHtml(columns[3], rows[0], NO_LINKS))), text(parseMarkup(cellHtml(columns[3], rows[1], NO_LINKS)))])
      .toEqual(["102000000001", "102000000001", "1234"]);
    const drawer = parseMarkup(rowDrawerHtml(columns, rows[0], NO_LINKS)).querySelectorAll("dd").map(text);
    expect(drawer).toEqual(["Revenue", "15,389,009,578", "102000000001", "102000000001"]);
    // The row is the result's own, and stays as it was: the commas are what the page shows of it.
    expect(rows[0]).toEqual(["Revenue", "15389009578", "102000000001", "102000000001"]);
    // In a table the count's column is a number's, right-aligned, and the row's own button shows the count too.
    const table = parseMarkup(tableHtml(viewOf({ file: "Modules.csv", label: "Modules", headers: ["", "Cell Count"], rows: [["Revenue", "15389009578"]], guard: false }, NO_LINKS)));
    expect(table.querySelectorAll("tbody td").map(cell => [text(cell), cell.classList.contains("num")])).toEqual([["Revenue", false], ["15,389,009,578", true]]);
    expect(text(parseMarkup(rowCellHtml(columns[1], rows[0], NO_LINKS)).querySelector('[data-act="row"]'))).toBe("15,389,009,578");
  });

  it("frames a table with its name, the search as typed, the count, and Reset when something is in force", () => {
    const frame = (overrides: Partial<TableView>) => {
      const view = parseMarkup(tableHtml(viewOf(CARDS, LINKS, overrides)));
      const box = view.querySelector("#tblSearch");
      return [text(view.querySelector("h1")), box?.getAttribute("value"), box?.getAttribute("aria-label"), view.querySelector("#searchWrap")?.classList.contains("has-value"),
        text(view.querySelector("#rowCount")), view.querySelector("#resetBtn")?.hidden, view.querySelector("#tableWrap")?.getAttribute("aria-label")];
    };
    expect(frame({})).toEqual(["Cards", "", "Search Cards", false, "1–3 of 3 rows", true, "Cards table"]);
    expect(frame({ search: "sales", total: 1, to: 1 })).toEqual(["Cards", "sales", "Search Cards", true, "1–1 of 1 row (filtered from 3)", false, "Cards table"]);
    expect(frame({ sort: { column: 0, dir: "asc" } }).slice(4, 6)).toEqual(["1–3 of 3 rows", false]);
    expect(frame({ from: 51, to: 100, total: 120, all: 120 })[4]).toBe("51–100 of 120 rows");
  });

  it("puts the pager at the right end of the toolbar, after the count, and nothing under the table", () => {
    /** What the view holds, in order, and what its toolbar holds: each element by its ID, or by its class. */
    const places = (overrides: Partial<TableView>) => {
      const view = parseMarkup(tableHtml(viewOf(CARDS, LINKS, overrides)));
      const name = (element: { id: string; localName: string; classList: { contains(name: string): boolean } }) => element.id || (element.classList.contains("toolbar") ? "toolbar" : element.localName);
      return [view.children.map(name), view.querySelector(".toolbar")?.children.map(name), view.querySelector("#pager")?.classList.contains("pager")];
    };
    const expected = [["h1", "toolbar", "tableWrap"], ["searchWrap", "colBtn", "resetBtn", "rowCount", "pager"], true];
    expect(places({})).toEqual(expected);
    // The same with several pages, with a search in force, and with no row to show, where the pager is empty.
    expect(places({ page: 1, pages: 3, from: 51, to: 100, total: 120, all: 120 })).toEqual(expected);
    expect(places({ search: "sales", total: 1, to: 1 })).toEqual(expected);
    expect(places({ rows: [], total: 0, from: 0, to: 0, search: "x" })).toEqual(expected);
    // The pager's controls are its own: the buttons that turn the page and the list of page sizes, with their names as they were.
    const pager = parseMarkup(tableHtml(viewOf(CARDS, LINKS, { page: 1, pages: 3, from: 51, to: 100, total: 120, all: 120 }))).querySelector("#pager");
    expect([pager?.querySelectorAll(".pg-btn[data-page]").map(button => button.getAttribute("aria-label")), pager?.querySelectorAll("select").map(list => list.id)])
      .toEqual([["Previous page", "Next page"], ["pageSize"]]);
  });

  it("says why a table shows no row: it has none, or nothing matches what is in force", () => {
    const empty = (overrides: Partial<TableView>) => {
      const view = parseMarkup(tableHtml(viewOf(CARDS, LINKS, { rows: [], total: 0, from: 0, to: 0, ...overrides })));
      return [text(view.querySelector(".empty .e-title")), text(view.querySelector(".empty .e-sub")), view.querySelectorAll(".empty [data-act]").map(button => `${button.dataset.act}: ${text(button)}`),
        view.querySelectorAll("tbody tr").length, text(view.querySelector("#pager"))];
    };
    const clear = ["reset: Clear search & filters"];
    expect(empty({ all: 0 })).toEqual(["Cards has no rows", "Nothing was found for this table in this analysis.", [], 0, ""]);
    expect(empty({ search: "x" })).toEqual(["No results", "Nothing in Cards matches the current search.", clear, 0, ""]);
    expect(empty({ filtered: new Set([3]) })).toEqual(["No results", "Nothing in Cards matches the current column filters.", clear, 0, ""]);
    expect(empty({ context: "Stores" })).toEqual(["No results", "Nothing in Cards matches the current page selection.", clear, 0, ""]);
    expect(empty({ search: "x", filtered: new Set([3]) })[1]).toBe("Nothing in Cards matches the current search and column filters.");
    expect(empty({ search: "x", context: "Stores" })[1]).toBe("Nothing in Cards matches the current search and page selection.");
    expect(empty({ search: "x", filtered: new Set([0, 3]), context: "Stores" })[1]).toBe("Nothing in Cards matches the current search and column filters and page selection.");
    // With rows to show there is no such message.
    expect(parseMarkup(tableHtml(viewOf(CARDS, LINKS))).querySelectorAll(".empty")).toEqual([]);
    // A table whose file has rows, none of which it lists, does not say that nothing was found: it says that none of
    // the rows is its own, in the words it is given, as text. The line under its name says how many rows there are.
    const left = { all: 0, note: "5 rows about the model are not listed here: 3 hold a value, which the Overview has under About this export.", none: "Every row is <b>about</b> the model." };
    expect(empty(left)).toEqual(["Cards has no rows of its own", "Every row is <b>about</b> the model.", [], 0, ""]);
    const view = parseMarkup(tableHtml(viewOf(CARDS, LINKS, { rows: [], total: 0, from: 0, to: 0, ...left })));
    expect([view.querySelectorAll(".view-note").map(text), view.querySelectorAll(".empty b").length, view.textContent.includes("Nothing was found")]).toEqual([["5 rows about the model are not listed here: 3 hold a value, which the Overview has under About this export."], 0, false]);
    // Those words are for a table without rows only: one that a search leaves empty says so as ever.
    expect(empty({ search: "x", none: left.none }).slice(0, 2)).toEqual(["No results", "Nothing in Cards matches the current search."]);
    // A table whose file has no rows may have a sentence of its own for that, said as text in the place of the usual one.
    const own = "No card of this app has a <b>title</b>.";
    expect(empty({ all: 0, empty: own })).toEqual(["Cards has no rows", own, [], 0, ""]);
    expect(parseMarkup(tableHtml(viewOf(CARDS, LINKS, { rows: [], total: 0, from: 0, to: 0, all: 0, empty: own }))).querySelectorAll(".empty b")).toEqual([]);
    // It is for a file without rows: where the file has rows of which the table lists none, that is what the table says,
    // and a search that leaves the table empty says so as ever. With rows to show it is not said at all.
    expect(empty({ ...left, empty: own }).slice(0, 2)).toEqual(["Cards has no rows of its own", left.none]);
    expect(empty({ search: "x", empty: own }).slice(0, 2)).toEqual(["No results", "Nothing in Cards matches the current search."]);
    expect(parseMarkup(tableHtml(viewOf(CARDS, LINKS, { empty: own }))).textContent.includes("No card of this app")).toBe(false);
  });

  it("offers Previous and Next, each with the page it goes to and disabled where there is no such page, and no page's number", () => {
    /** Which way a pager button's chevron points: it has no text, and its name is its aria-label. */
    const way = (button: FakeElement): string => {
      const drawn = { "M10 4 6 8l4 4": "left", "M6 4l4 4-4 4": "right" }[button.querySelector("svg.pg-chevron path")?.getAttribute("d") ?? ""];
      return text(button) === "" && drawn ? drawn : `text: ${text(button)}`;
    };
    /** Each button of the pager: its chevron's way, its name, the page it goes to (from 0), and "off" when it is disabled. */
    const pager = (page: number, pages: number) => parseMarkup(pagerHtml(page, pages, pages * 50, 50)).querySelectorAll(".pg-btn").map(button =>
      [way(button), button.getAttribute("aria-label"), button.dataset.page, button.disabled ? "off" : ""]);
    expect(pager(0, 3)).toEqual([["left", "Previous page", "-1", "off"], ["right", "Next page", "1", ""]]);
    expect(pager(1, 3)).toEqual([["left", "Previous page", "0", ""], ["right", "Next page", "2", ""]]);
    expect(pager(2, 3)).toEqual([["left", "Previous page", "1", ""], ["right", "Next page", "3", "off"]]);
    expect(pager(0, 1)).toEqual([["left", "Previous page", "-1", "off"], ["right", "Next page", "1", "off"]]);
    // Many pages: the same two buttons side by side and then the choice of rows per page, with no page's number between
    // them, no gap where numbers were left out, and nothing that marks a page as the one shown. The count that stands
    // before the pager says which rows are shown.
    const long = parseMarkup(`<div class="pager">${pagerHtml(10, 20, 1000, 50)}</div>`).querySelector(".pager");
    expect(long?.children.map(item => (item.localName === "button" ? `${way(item)}>${item.dataset.page}` : item.getAttribute("class"))))
      .toEqual(["left>9", "right>11", "per-page"]);
    expect([long?.querySelectorAll("[aria-current]").length, long?.textContent.includes("…")]).toEqual([0, false]);
    // Rows per page: the three sizes, with the one in force selected.
    for (const size of [25, 50, 100]) {
      const list = parseMarkup(pagerHtml(0, 3, 150, size)).querySelector("#pageSize");
      expect([list?.querySelectorAll("option").map(option => [option.getAttribute("value"), text(option), option.hasAttribute("selected")]), list?.value, list?.getAttribute("aria-label")])
        .toEqual([[["25", "25", size === 25], ["50", "50", size === 50], ["100", "100", size === 100]], String(size), "Rows per page"]);
    }
    // The choice ends the pager, in the element the stylesheet sets at the right of its line; the page writes no style of its own for it.
    const whole = parseMarkup(`<div class="pager">${pagerHtml(0, 3, 150, 50)}</div>`).querySelector(".pager");
    const last = whole?.children[whole.children.length - 1];
    expect([last?.classList.contains("per-page"), last?.querySelectorAll("select").map(list => list.id), whole?.querySelectorAll("[style]").length]).toEqual([true, ["pageSize"], 0]);
    // No rows, no pager.
    expect(pagerHtml(0, 1, 0, 50)).toBe("");
  });

  it("lists a filter's values with their counts, each ticked when its rows are shown", () => {
    const values = [["", 4], ["Grid", 12], ["KPI", 1]] as const;
    /** Each choice: its text, its count, whether it is ticked, and its place in the list, which is what a tick reads. */
    const choices = (selected: ReadonlySet<string> | undefined) => parseMarkup(colFilterHtml(column(3, "Card type"), values, selected)).querySelectorAll(".pop-opt").map(option => {
      const box = option.querySelector("input");
      return [text(option.children[1]), option.querySelector(".po-cnt")?.childNodes[0].textContent, box?.checked, box?.dataset.fval];
    });
    // Without a filter every value is shown, and so ticked.
    expect(choices(undefined)).toEqual([["(blank)", "4", true, "0"], ["Grid", "12", true, "1"], ["KPI", "1", true, "2"]]);
    expect(choices(new Set(["Grid"])).map(choice => choice[2])).toEqual([false, true, false]);
    expect(choices(new Set(["", "KPI"])).map(choice => choice[2])).toEqual([true, false, true]);
    expect(choices(new Set()).map(choice => choice[2])).toEqual([false, false, false]);
    const popover = parseMarkup(colFilterHtml(column(3, "Card type"), values, undefined));
    expect(popover.querySelectorAll(".pop-hd").map(text)).toEqual(["Filter: Card typeShow all", "ValueRows in the whole table"]);
    expect(popover.querySelectorAll("[data-popact]").map(button => [button.dataset.popact, text(button)])).toEqual([["all", "Show all"]]);
    expect(popover.querySelectorAll(".po-cnt .sr-only").map(text)).toEqual(["rows in the whole table", "rows in the whole table", "row in the whole table"]);
    // A column that holds nothing at all says so, and has nothing to count.
    const none = parseMarkup(colFilterHtml(column(3, "Card type"), [], undefined));
    expect([none.querySelectorAll(".pop-opt").length, text(none.querySelector(".pop-empty")), none.querySelectorAll(".pop-hd").map(text)]).toEqual([0, "No values", ["Filter: Card typeShow all"]]);
    // A count's column lists each count as its cells show it, with its thousands apart; a box still carries its place.
    const counts = [["", 1], ["12", 2], ["2252068", 1], ["n/a", 1]] as const;
    expect(parseMarkup(colFilterHtml(column(2, "Cell Count", "count"), counts, undefined)).querySelectorAll(".pop-opt").map(option => [text(option.children[1]), option.querySelector("input")?.dataset.fval]))
      .toEqual([["(blank)", "0"], ["12", "1"], ["2,252,068", "2"], ["n/a", "3"]]);
  });

  it("gives a filter of many values a box that finds them, two buttons that tick or untick what it finds, and a line that says how many", () => {
    expect([FILTER_FIND_FROM, FILTER_LISTED_MAX]).toEqual([15, 300]);
    /** A column's values: `count` texts, each in two rows, and a blank. */
    const values = (count: number) => [["", 3] as const, ...Array.from({ length: count }, (_, at) => [`Store ${String(at + 1).padStart(3, "0")}`, 2] as const)];
    // Up to fifteen values, the filter is the plain list it always was: no box, no buttons, no line.
    const few = parseMarkup(colFilterHtml(column(2, "Store"), values(14), undefined));
    expect([few.querySelectorAll("input[type=search]").length, few.querySelectorAll("[data-popact]").map(button => button.dataset.popact), few.querySelectorAll("[role=status]").length])
      .toEqual([0, ["all"], 0]);
    // More: a box to find a value, named for a screen reader and marked to have the focus first, the two buttons, and the line.
    const many = parseMarkup(colFilterHtml(column(2, "Store"), values(40), new Set(["Store 001"])));
    const box = many.querySelector("input[type=search]");
    expect([box?.getAttribute("aria-label"), box?.dataset.first !== undefined, box?.dataset.ffind !== undefined]).toEqual(["Find a value of Store", true, true]);
    expect(many.querySelectorAll("[data-popact]").map(button => [button.dataset.popact, text(button)])).toEqual([["all", "Show all"], ["tick", "Tick all"], ["untick", "Untick all"]]);
    expect([text(many.querySelector("[role=status]")), many.querySelectorAll(".pop-opt").length]).toEqual(["41 values.", 41]);
    // The box finds a value by its text as the list shows it, whatever the case: the blank by its word in brackets, and a
    // count with its thousands apart. Nothing typed finds every value.
    const stores = values(40);
    expect([filterMatches(column(2, "Store"), stores, "store 01").length, filterMatches(column(2, "Store"), stores, "BLANK"), filterMatches(column(2, "Store"), stores, " ").length])
      .toEqual([10, [0], 41]);
    expect(filterMatches(column(2, "Cell Count", "count"), [["2252068", 1], ["12", 1]], "2,252")).toEqual([0]);
    // What it finds is listed, each box with its place among all the values, ticked as the filter has it.
    const found = parseMarkup(filterOptionsHtml(column(2, "Store"), stores, [2, 5], new Set(["Store 002"])));
    expect(found.querySelectorAll(".pop-opt").map(option => [text(option.children[1]), option.querySelector("input")?.dataset.fval, option.querySelector("input")?.checked]))
      .toEqual([["Store 002", "2", true], ["Store 005", "5", false]]);
    expect([text(parseMarkup(filterOptionsHtml(column(2, "Store"), stores, [], undefined)).querySelector(".pop-empty")), filterStatusText(stores, [2, 5], "00"), filterStatusText(stores, [], "zz")])
      .toEqual(["No value matches", "2 of 41 values match.", "0 of 41 values match."]);
    // The buttons say what they tick: all while nothing is typed, the matches once something is.
    expect([filterTickWords(""), filterTickWords("st")]).toEqual([["Tick all", "Untick all"], ["Tick matches", "Untick matches"]]);
    // At most three hundred are listed at once, and the line says to type to narrow the list.
    const most = values(450);
    const listed = parseMarkup(colFilterHtml(column(2, "Store"), most, undefined));
    expect([listed.querySelectorAll(".pop-opt").length, text(listed.querySelector("[role=status]"))]).toEqual([300, "451 values. The first 300 are listed: type to narrow the list."]);
    // A column whose cells list items says how its rows are kept.
    expect([text(parseMarkup(colFilterHtml(column(2, "Applies To"), values(3), undefined, true)).querySelector(".pop-note")),
      parseMarkup(colFilterHtml(column(2, "Applies To"), values(3), undefined)).querySelectorAll(".pop-note").length])
      .toEqual(["Each item is listed on its own: a row shows when any of its items is ticked.", 0]);
  });

  it("gives a column of numbers a range: two boxes with its lowest and highest, the blank cells to keep or leave out, a line for what is wrong, and Apply", () => {
    const read = rangeColumn([["a", "113"], ["b", "9"], ["c", ""], ["d", "2252068"]], 1, "number", true);
    const sources = column(1, "Sources", "text", { filter: true, range: "number" });
    const popover = parseMarkup(rangeFilterHtml(sources, read, undefined));
    const [from, to] = [popover.querySelector("[data-rfrom]"), popover.querySelector("[data-rto]")];
    // Two boxes for figures, each named on its left, From to have the focus first, both empty and showing an edge of the column.
    expect([from?.getAttribute("type"), from?.getAttribute("inputmode"), from?.getAttribute("placeholder"), to?.getAttribute("placeholder"), from?.value, to?.value,
      from?.dataset.first !== undefined, to?.dataset.first]).toEqual(["text", "decimal", "9", "2252068", "", "", true, undefined]);
    expect([popover.querySelectorAll(".pr-field").map(field => text(field.querySelector("span"))), popover.querySelectorAll(".pop-hd").map(text)]).toEqual([["From", "To"], ["Filter: SourcesClear"]]);
    // The line under them names both edges and says how the ends work, and each box is described by it.
    expect([text(popover.querySelector("#rangeHint")), from?.getAttribute("aria-describedby"), to?.getAttribute("aria-describedby")])
      .toEqual(["Lowest 9, highest 2252068. Both ends kept; leave a box empty for no end there.", "rangeHint", "rangeHint"]);
    // The one blank cell is kept until unticked; the line for what is wrong is empty and hidden, and a screen reader hears it.
    const problem = popover.querySelector("[data-rerr]");
    expect([popover.querySelector("[data-rblanks]")?.checked, text(popover.querySelector(".pr-blanks .po-cnt")), problem?.hidden, problem?.getAttribute("role"), text(problem)])
      .toEqual([true, "1 row in the whole table", true, "alert", ""]);
    expect(popover.querySelectorAll("[data-popact]").map(button => [button.dataset.popact, text(button)])).toEqual([["clear", "Clear"], ["apply", "Apply"]]);
    // A count's edges show with their thousands apart; a range in force writes its boxes back as typed, and its blanks as left
    // out; a column with no blank cell has no box for them.
    const counted = parseMarkup(rangeFilterHtml({ ...sources, kind: "count" }, read, { fromText: "10", toText: "1,000", from: 10, to: 1000, blanks: false }));
    expect([counted.querySelector("[data-rto]")?.getAttribute("placeholder"), counted.querySelector("[data-rfrom]")?.value, counted.querySelector("[data-rto]")?.value,
      counted.querySelector("[data-rblanks]")?.checked]).toEqual(["2,252,068", "10", "1,000", false]);
    expect(parseMarkup(rangeFilterHtml(sources, rangeColumn([["a", "1"], ["b", "2"]], 1, "number", true), undefined)).querySelectorAll("[data-rblanks]").length).toBe(0);
  });

  it("gives a column of dates the browser's boxes for dates, held to its first and last day, and says that its times are UTC where its header does", () => {
    const started = column(1, "Start Date and Time (UTC)", "text", { filter: true, range: "date", none: false });
    const read = rangeColumn([["a", "2026-03-12 23:19:56"], ["b", "2026-10-09 08:00:00"]], 1, "date", false);
    const popover = parseMarkup(rangeFilterHtml(started, read, { fromText: "2026-03-01", toText: "", from: dayOf("2026-03-01"), blanks: true }));
    const from = popover.querySelector("[data-rfrom]");
    expect([from?.getAttribute("type"), from?.getAttribute("min"), from?.getAttribute("max"), from?.value, popover.querySelector("[data-rto]")?.value, popover.querySelectorAll("[data-rblanks]").length])
      .toEqual(["date", "2026-03-12", "2026-10-09", "2026-03-01", "", 0]);
    expect(text(popover.querySelector("#rangeHint"))).toBe("The column's dates and times are UTC. Earliest 2026-03-12, latest 2026-10-09. Whole days, both ends kept; leave a box empty for no end there.");
    // A column of dates whose header says nothing of UTC says nothing of it.
    expect(text(parseMarkup(rangeFilterHtml({ ...started, label: "Last published" }, read, undefined)).querySelector("#rangeHint")))
      .toBe("Earliest 2026-03-12, latest 2026-10-09. Whole days, both ends kept; leave a box empty for no end there.");
    // The page's own words for the zone take the place of the header's, for a column of times shown in the viewer's zone.
    expect(text(parseMarkup(rangeFilterHtml({ ...started, label: "Start Date and Time (local)" }, read, undefined, "The column's dates and times are in your time zone, Asia/Tokyo. "))
      .querySelector("#rangeHint"))).toBe("The column's dates and times are in your time zone, Asia/Tokyo. Earliest 2026-03-12, latest 2026-10-09. Whole days, both ends kept; leave a box empty for no end there.");
  });

  it("says a time in a row's drawer in both zones, the one the page shows first, and no text as read beside it", () => {
    const columns = [column(0, "Name"), column(1, "Start Date and Time (local)"), column(2, "Notes")];
    const shown = ["Load", "2026-03-13 08:19:56", "Nightly"];
    const local = parseMarkup(rowDrawerHtml(columns, shown, NO_LINKS, new Map([[1, "2026-03-12 23:19:56"]]), undefined, undefined, undefined, undefined, { mode: "local", zone: "Asia/Tokyo" }));
    expect([local.querySelectorAll("dt").map(text), local.querySelectorAll("dd").map(text)])
      .toEqual([["Name", "Start Date and Time (local)", "Notes"], ["Load", "2026-03-13 08:19:56 local · 2026-03-12 23:19:56 UTC", "Nightly"]]);
    // In UTC the cell is the time as it was read; the viewer's comes second.
    const utc = parseMarkup(rowDrawerHtml([columns[0], column(1, "Start Date and Time (UTC)"), columns[2]], ["Load", "2026-03-12 23:19:56", "Nightly"], NO_LINKS, undefined, undefined,
      undefined, undefined, undefined, { mode: "utc", zone: "Asia/Tokyo" }));
    expect(utc.querySelectorAll("dd").map(text)[1]).toBe("2026-03-12 23:19:56 UTC · 2026-03-13 08:19:56 local");
    // A cell that names no moment, and a drawer told nothing of times, show the cell as it is.
    expect(parseMarkup(rowDrawerHtml(columns, ["Copy", "", ""], NO_LINKS, undefined, undefined, undefined, undefined, undefined, { mode: "local", zone: "Asia/Tokyo" }))
      .querySelectorAll("dd").map(text)).toEqual(["Copy", "", ""]);
    expect(parseMarkup(rowDrawerHtml(columns, shown, NO_LINKS)).querySelectorAll("dd").map(text)[1]).toBe("2026-03-13 08:19:56");
  });

  it("says on a filter's button that its filter is on, and what a range in force keeps", () => {
    const button = (view: TableView, index: number) => parseMarkup(tableHtml(view)).querySelector(`[data-colfilter="${index}"]`);
    const columns = columnsOf(CARDS).map(entry => ({ ...entry, filter: true }));
    const view = viewOf(CARDS, LINKS, { columns, filtered: new Set([1, 3]), ranged: new Map([[1, "2–3"]]) });
    expect([1, 3, 0].map(index => [button(view, index)?.getAttribute("aria-label"), button(view, index)?.title, button(view, index)?.classList.contains("active")])).toEqual([
      ["Filter by Card # (filter on: 2–3)", "Filter by Card # (filter on: 2–3)", true], ["Filter by Card type (filter on)", "Filter by Card type (filter on)", true],
      ["Filter by Page", "Filter by Page", false]]);
  });

  it("lists every column in the chooser, ticked when shown, each box carrying its own column", () => {
    const columns = [column(0, "Page", "page"), column(5, "Card ID", "id", { hidden: true }), column(2, "Card title", "card"), column(9, "Source IDs", "text", { hidden: true }),
      column(1, "Card #", "card", { hidden: true, num: true }), column(4, "Total cards", "text", { num: true })];
    /** Each column: its name, the column its box carries, whether it is ticked, and its mark as IDs that start hidden. */
    const boxes = (hidden: number[]) => parseMarkup(colChooserHtml(columns, new Set(hidden))).querySelectorAll(".pop-opt").map(option => {
      const box = option.querySelector("input");
      return [text(option.children[1]), box?.dataset.col, box?.checked, text(option.querySelector(".po-cnt"))];
    });
    // A number that starts hidden, a card's, is not marked as an ID.
    expect(boxes([5, 9, 1])).toEqual([["Page", "0", true, ""], ["Card ID", "5", false, "ID"], ["Card title", "2", true, ""], ["Source IDs", "9", false, "ID"],
      ["Card #", "1", false, ""], ["Total cards", "4", true, ""]]);
    // What is ticked follows what is hidden now, not what starts hidden; the mark follows what starts hidden.
    expect(boxes([0, 2])).toEqual([["Page", "0", false, ""], ["Card ID", "5", true, "ID"], ["Card title", "2", false, ""], ["Source IDs", "9", true, "ID"],
      ["Card #", "1", true, ""], ["Total cards", "4", true, ""]]);
    expect(boxes([]).map(box => box[2])).toEqual([true, true, true, true, true, true]);
    const popover = parseMarkup(colChooserHtml(columns, new Set()));
    expect([text(popover.querySelector(".pop-hd span")), popover.querySelectorAll("[data-popact]").map(button => [button.dataset.popact, text(button)])]).toEqual(["Show / hide columns", [["defaults", "Defaults"]]]);
  });

  it("shows the overview's tiles and the notes, and no panel of an app's cards by type or of its models", () => {
    const view = parseMarkup(overviewHtml(overviewWith({
      tiles: [{ label: "Pages", count: 7 }, { label: "Cards", count: 1 }, { label: "Filters", count: 0 }],
      notes: ["A first note.", "A second note."],
    })));
    expect(view.querySelectorAll(".stat").map(tile => tile.children.map(text))).toEqual([["Pages", "7", "rows"], ["Cards", "1", "row"], ["Filters", "0", "rows"]]);
    // The notes are the overview's one panel. An app's cards by type have none, and nor have its models, which the
    // details of the export name.
    expect([view.querySelectorAll(".panel h2").map(text), view.querySelectorAll(".warn-list li").map(text)]).toEqual([["Notes"], ["A first note.", "A second note."]]);
    expect(view.querySelectorAll(".typebar, .model-row, .ov-cols, .id-pill")).toEqual([]);
    // A result may have no notes: then there is no panel at all, and without a Details file nothing else stands under the
    // tiles but the place for what the page keeps of the result, which holds nothing.
    // Given the place of each tile's table, a tile is a button that opens it, as the table's entry of the navigation does.
    const ways = parseMarkup(overviewHtml(overviewWith({ tiles: [{ label: "Line Items", count: 120 }, { label: "Modules", count: 1 }] }), "none", [3, 5]));
    expect(ways.querySelectorAll(".stat").map(tile => [tile.localName, tile.getAttribute("type"), tile.dataset.nav, tile.textContent])).toEqual([
      ["button", "button", "3", "Line Items120rows"], ["button", "button", "5", "Modules1row"]]);
    const bare = parseMarkup(overviewHtml(overviewWith({ tiles: [{ label: "Line Items", count: 120 }] })));
    expect([bare.querySelectorAll(".stat").map(tile => tile.children.map(text)), bare.querySelectorAll(".panel").length, bare.children.map(child => child.localName),
      bare.querySelector("#ovKept")?.innerHTML]).toEqual([[["Line Items", "120", "rows"]], 0, ["h1", "div", "p"], ""]);
  });

  it("says on a tile the one number of rows its table lists, with the word for a screen reader only, and the table's icon before its name", () => {
    const view = parseMarkup(overviewHtml(overviewWith({ tiles: [{ label: "Line Items", count: 3511 }, { label: "Model Calendar", count: 21 }, { label: "Odd", count: 1 }, { label: "Bare", count: 2 }] }),
      "none", [], ["Line Items.csv", "Model Calendar.csv", "Odd.csv"]));
    // The name, the number, and the word "rows" or "row", which only a screen reader is given: no line of how many there are in all.
    expect(view.querySelectorAll(".stat").map(tile => tile.children.map(child => [...["s-lab", "s-num", "sr-only"]].find(name => child.classList.contains(name))))).toEqual([
      ["s-lab", "s-num", "sr-only"], ["s-lab", "s-num", "sr-only"], ["s-lab", "s-num", "sr-only"], ["s-lab", "s-num", "sr-only"]]);
    expect(view.querySelectorAll(".stat").map(tile => tile.children.map(text))).toEqual([["Line Items", "3511", "rows"], ["Model Calendar", "21", "rows"], ["Odd", "1", "row"], ["Bare", "2", "rows"]]);
    expect(view.querySelectorAll(".stat").some(tile => /in all/.test(tile.textContent))).toBe(false);
    // The icon is the one the navigation has for the table's file, before its name. A file with no icon of its own has none,
    // and a tile that names no file has none either: no stand-in.
    const icons = view.querySelectorAll(".stat").map(tile => tile.querySelector(".s-lab svg")?.outerHTML);
    expect(icons.map(Boolean)).toEqual([true, true, false, false]);
    expect([icons[0] === parseMarkup(FILE_ICONS.get("Line Items.csv")!).querySelector("svg")?.outerHTML,
      icons[1] === parseMarkup(FILE_ICONS.get("Model Calendar.csv")!).querySelector("svg")?.outerHTML]).toEqual([true, true]);
    // The name is the tile's title as well, so that a name cut short by the tile is there whole.
    expect(view.querySelectorAll(".stat .s-lab").map(label => label.getAttribute("title"))).toEqual(["Line Items", "Model Calendar", "Odd", "Bare"]);
  });

  it("shows in a row's drawer, after a cell that is said in words, the text that was read in its place, named as that", () => {
    const columns = [column(0, "Name"), column(1, "Format"), column(2, "Formula"), column(3, "Summary", "tag")];
    const row = ["Margin %", "Number, 2 decimal places, %", "Margin / Revenue", "Ratio = Margin / Revenue"];
    const format = '{"decimalPlaces":2,"unitsType":"PERCENTAGE","dataType":"NUMBER"}';
    const summary = '{"summaryMethod":"RATIO"} <b>bold</b>\n  second line';
    const drawer = parseMarkup(rowDrawerHtml(columns, row, NO_LINKS, new Map([[1, format], [3, summary]])));
    // Each column's name beside its cell as the table shows it; after a cell said in words, the text that was read under "as read".
    expect(drawer.querySelectorAll("dt").map(name => name.textContent)).toEqual(["Name", "Format", "Format as read", "Formula", "Summary", "Summary as read"]);
    expect(drawer.querySelectorAll("dd").map(value => value.textContent)).toEqual(["Margin %", "Number, 2 decimal places, %", format, "Margin / Revenue", "Ratio = Margin / Revenue", summary]);
    // The text that was read is a text, whole: in the element that keeps its line breaks and spaces, whatever the column's kind, and never an element.
    expect(drawer.querySelectorAll("dd").map(value => [value.children.map(child => child.classList.contains("cell-t") || child.classList.contains("tag")), value.querySelector(".cell-t")?.textContent]))
      .toEqual([[[true], "Margin %"], [[true], "Number, 2 decimal places, %"], [[true], format], [[true], "Margin / Revenue"], [[true], "Ratio = Margin / Revenue"], [[true], summary]]);
    expect([drawer.querySelectorAll("b").length, drawer.querySelectorAll("h3").map(text)]).toEqual([0, ["All columns"]]);
    // A row none of whose cells is said in words, and a table that has no such cells, show the columns alone.
    for (const none of [rowDrawerHtml(columns, row, NO_LINKS, new Map()), rowDrawerHtml(columns, row, NO_LINKS)]) {
      expect(parseMarkup(none).querySelectorAll("dt").map(name => name.textContent)).toEqual(["Name", "Format", "Formula", "Summary"]);
    }
  });

  it("names the text that was read for a column the page made out of a column of the file by the file's name for that column, once", () => {
    // A source model's row as the page shows it: Mapped To as two columns, each said out of the one cell of the file.
    const columns = [column(0, "Name"), column(1, "Mapped Workspace"), column(2, "Mapped Model"), column(3, "Notes")];
    const row = ["Finance Hub (old)", "CL1 WU Finance [DEV-1]", "Finance Hub", "From the hub"];
    const mapping = '{"workspaceId":"dc56f2296af444ca894c1bca437ae1b4","workspaceName":"CL1 WU Finance [DEV-1]","modelId":"42FAAB38006B4E478C5A051DADA1B7C0","modelName":"Finance Hub"}';
    const names = (html: string) => parseMarkup(html).querySelectorAll("dt").map(name => name.textContent);
    const drawer = rowDrawerHtml(columns, row, NO_LINKS, new Map([[2, mapping]]), undefined, new Map([[2, "Mapped To"]]));
    // The two columns, then the text both were read from, once, under the file's name for it and "as read".
    expect(names(drawer)).toEqual(["Name", "Mapped Workspace", "Mapped Model", "Mapped To as read", "Notes"]);
    expect(parseMarkup(drawer).querySelectorAll("dd").map(value => value.textContent)).toEqual([...row.slice(0, 3), mapping, row[3]]);
    expect(parseMarkup(drawer).querySelectorAll("dd")[3].querySelector(".cell-t")?.textContent).toBe(mapping);
    // A file's name for a column whose cell has no text that was read adds nothing; and without such a name, the text that
    // was read is named by its own column, as for a Format or a Summary.
    expect(names(rowDrawerHtml(columns, row, NO_LINKS, new Map(), undefined, new Map([[2, "Mapped To"]])))).toEqual(["Name", "Mapped Workspace", "Mapped Model", "Notes"]);
    expect(names(rowDrawerHtml(columns, row, NO_LINKS, new Map([[2, mapping]])))).toEqual(["Name", "Mapped Workspace", "Mapped Model", "Mapped Model as read", "Notes"]);
  });

  it("lists in a drawer each item of a value that lists several, one to a line, and leaves the table's cell as it is", () => {
    const columns = [column(0, "Name"), column(1, "Applies To"), column(2, "Referenced By"), column(3, "Card ID", "id"), column(4, "Card type", "tag"), column(5, "Format")];
    const row = ["Revenue", "Products, 'Regions, north'", "Price, 'COST01 Costs'.Rent", "card-a; card-b", "Grid; KPI", "Number"];
    const items = new Map([[1, ["Products", "'Regions, north'"]], [2, ["Price", "'COST01 Costs'.Rent"]], [3, ["card-a", "card-b"]], [4, ["Grid", "KPI"]]]);
    /** Each value of the drawer: its items where it lists several, and otherwise its text, with what stands in the `dd`. */
    const values = (html: string) => parseMarkup(html).querySelectorAll(".d-dl dd").map(value => [value.children.map(child => child.getAttribute("class")),
      value.querySelectorAll("li").length ? value.querySelectorAll("li").map(item => item.children.map(child => [child.getAttribute("class"), child.textContent])) : value.textContent]);
    const drawer = rowDrawerHtml(columns, row, LINKS, new Map([[5, '{"dataType":"NUMBER"}']]), items);
    expect(values(drawer)).toEqual([
      [["cell-t"], "Revenue"],
      // A list, an item each, and in each item its text in the element that keeps a value's spaces: the cell's own text
      // cut where it was joined, quotes and all, with no separator left over and no text of the markup's own.
      [["cell-list"], [[["cell-t", "Products"]], [["cell-t", "'Regions, north'"]]]],
      [["cell-list"], [[["cell-t", "Price"]], [["cell-t", "'COST01 Costs'.Rent"]]]],
      // A column that is more than plain text stays what it is: one ID to copy, one tag.
      [["id-pill"], "card-a; card-b"],
      [["tag"], "Grid; KPI"],
      // A value said in words keeps the text that was read after it, as ever.
      [["cell-t"], "Number"],
      [["cell-t"], '{"dataType":"NUMBER"}'],
    ]);
    expect(parseMarkup(drawer).querySelectorAll(".d-dl dd").map(value => value.childNodes.filter(node => node.nodeType === 3).length)).toEqual([0, 0, 0, 0, 0, 0, 0]);
    // A value of one item is not a list, nor is one without items: the drawer is then the one a row without lists has.
    const plain = rowDrawerHtml(columns, row, LINKS);
    for (const none of [new Map(), new Map([[1, ["Products, 'Regions, north'"]]]), new Map([[2, []]])]) expect(rowDrawerHtml(columns, row, LINKS, undefined, none)).toBe(plain);
    // The table shows each cell as it is, on one line: the same cells, whatever a drawer lists.
    const table: ResultTable = { file: "Line Items.csv", label: "Line Items", headers: columns.map(entry => entry.label), rows: [row], guard: false };
    expect(cells(tableHtml(viewOf(table, LINKS, { columns })))).toEqual([row]);
  });

  it("lists in a card's drawer the items of its own cells and of its parts' cells that list several, and the rest as text", () => {
    const columns = [column(0, "Page", "page"), column(1, "Card title", "card"), column(2, "Context selectors"), column(3, "Card settings")];
    const row = ["Overview", "Sales", "Territory (visible, synced to page); Channel (hidden)", "Read-only"];
    const sections = [{ title: "Filters", none: "filters", headings: ["Sec", "Condition", "Context"], colours: [false, false, false],
      rows: [["1", "Sales is greater than 10", ["Territory = current", "Time = current"]], ["1", "Margin % is not blank", NONE]] }];
    const drawer = parseMarkup(cardDrawerHtml(columns, row, LINKS, sections, new Map([[2, ["Territory (visible, synced to page)", "Channel (hidden)"]]])));
    expect(drawer.querySelectorAll(".d-dl dd").map(value => (value.querySelector(".cell-list") ? value.querySelectorAll("li").map(text) : text(value))))
      .toEqual(["Overview", "Sales", ["Territory (visible, synced to page)", "Channel (hidden)"], "Read-only"]);
    // A part's cell is its text, or its items one to a line.
    expect(drawer.querySelectorAll(".mini tbody tr").map(entry => entry.children.map(cell => (cell.querySelector(".cell-list") ? cell.querySelectorAll("li .cell-t").map(text) : text(cell)))))
      .toEqual([["1", "Sales is greater than 10", ["Territory = current", "Time = current"]], ["1", "Margin % is not blank", NONE]]);
    // A card without lists has the drawer it had.
    expect(cardDrawerHtml(columns, row, LINKS, [], new Map())).toBe(cardDrawerHtml(columns, row, LINKS, []));
  });

  it("says under a card's name its page, its type and its ID, and on a line of its own what its drawer leaves out", () => {
    const sub = (note?: string) => parseMarkup(`<div>${cardDrawerSubHtml("Overview <b>north</b>", "Grid", "card-a", note)}</div>`).children[0];
    const parts = (line: FakeElement) => line.children.map(child => [child.localName, child.dataset.act ?? (child.classList.contains("id-pill") ? "ID" : ""), text(child)]);
    // The page is a jump to its cards, the ID is one to copy, and nothing stands under them for a card with its parts.
    expect([parts(sub()), text(sub())]).toEqual([[["button", "page", "Overview <b>north</b>"], ["button", "ID", "card-a"]], "Overview <b>north</b> · Grid · card-a"]);
    // The line about a card whose parts cannot be told from another card's follows, as text: it names the page as typed.
    const note = '2 cards on pages named "Overview <b>north</b>" have this number and this ID.';
    expect([parts(sub(note)), sub(note).querySelectorAll("b").length]).toEqual([[["button", "page", "Overview <b>north</b>"], ["button", "ID", "card-a"], ["div", "", note]], 0]);
  });

  it("puts the switch between a table's ways at the head of its toolbar: a button a way, the shown one said and filled", () => {
    const ways = [{ way: "object", label: "By object", chosen: true }, { way: "use", label: "Every use", chosen: false }];
    const view = parseMarkup(tableHtml(viewOf(CARDS, LINKS, { ways })));
    expect(view.querySelector(".toolbar")?.children.map(child => child.id)).toEqual(["tableWays", "searchWrap", "colBtn", "resetBtn", "rowCount", "pager"]);
    const group = view.querySelector("#tableWays");
    expect([group?.getAttribute("role"), group?.getAttribute("aria-label"), group?.children.map(child => child.localName)]).toEqual(["group", "How Cards is listed", ["button", "button"]]);
    expect(group?.children.map(button => [text(button), button.dataset.way, button.getAttribute("aria-pressed"), button.classList.contains("primary"), button.getAttribute("type")]))
      .toEqual([["By object", "object", "true", true, "button"], ["Every use", "use", "false", false, "button"]]);
    // The other way round, the other button is the shown one; a table of one way has no switch.
    const other = parseMarkup(tableHtml(viewOf(CARDS, LINKS, { ways: ways.map(way => ({ ...way, chosen: !way.chosen })) })));
    expect(other.querySelectorAll("#tableWays button").map(button => [button.getAttribute("aria-pressed"), button.classList.contains("primary")])).toEqual([["false", false], ["true", true]]);
    for (const none of [viewOf(CARDS, LINKS), viewOf(CARDS, LINKS, { ways: [] })]) expect(parseMarkup(tableHtml(none)).querySelectorAll("#tableWays, [data-way]")).toEqual([]);
  });

  it("shows an object in its drawer: what it is used as with its counts, and its uses by page, each use leading to its page and its card", () => {
    expect(USES_AT_FIRST).toBe(50);
    const object: WhereUsedObject = { type: "Dimension", name: "Time", module: "-", model: "Model one", pages: 2, cards: 3, id: "20000000003",
      roles: [["Column dimension", 2], ["", 1]], uses: [
        { row: 2, page: "Overview", card: 1, usedAs: "Column dimension", cardId: "card-a" },
        { row: 6, page: "Stores <b>north</b>", card: 1, usedAs: "Column dimension" },
        { row: 9, page: "Overview", card: "2", usedAs: "", cardId: "card-b" }] };
    const drawer = parseMarkup(objectDrawerHtml(object, LINKS, false));
    const rows = (section: number) => drawer.querySelectorAll(".d-sec")[section].querySelectorAll("tbody tr");
    expect(drawer.querySelectorAll("h3").map(text)).toEqual(["Used as", "Uses (3)"]);
    expect(drawer.querySelectorAll(".d-sec").map(section => section.querySelectorAll("th").map(text))).toEqual([["Used as", "Uses"], ["Page", "Card #", "Used as"]]);
    // Each role with its number of uses; a role that is blank is said to be.
    expect(rows(0).map(row => row.children.map(text))).toEqual([["Column dimension", "2"], ["(blank)", "1"]]);
    // The uses, grouped by page: the pages in the file's order, and under a page its uses in the file's order.
    expect(rows(1).map(row => row.children.map(text))).toEqual([["Overview", "1", "Column dimension"], ["Overview", "2", ""], ["Stores <b>north</b>", "1", "Column dimension"]]);
    // A page is named with its first use, as a link to its cards; with its other uses it is said to a screen reader only.
    // Each link carries the use's place among the object's uses, as the file has them: here the third use stands second.
    const links = (row: number, cell: number) => rows(1)[row].children[cell].querySelectorAll("button").map(button => [button.dataset.act, button.dataset.use, text(button), button.title]);
    expect([links(0, 0), links(1, 0), links(2, 0)]).toEqual([[["use-page", "0", "Overview", "Show cards on Overview"]], [], [["use-page", "1", "Stores <b>north</b>", "Show cards on Stores <b>north</b>"]]]);
    expect(rows(1).map(row => row.children[0].querySelectorAll(".sr-only").map(text))).toEqual([[], ["Overview"], []]);
    // A card's number opens the card where the use names its card; a use without one shows the number alone.
    expect([links(0, 1), links(1, 1), links(2, 1)]).toEqual([[["use-card", "0", "1", "Open card details"]], [["use-card", "2", "2", "Open card details"]], []]);
    expect([drawer.querySelectorAll("b").length, drawer.querySelectorAll('[data-act="more-uses"]').length, drawer.querySelector("#drawerUses")?.classList.contains("d-sec")]).toEqual([0, 0, true]);
    // Without the cards to show, nothing is a link: the uses are text.
    const plain = parseMarkup(objectDrawerHtml(object, NO_LINKS, false));
    expect([plain.querySelectorAll("button").length, plain.querySelectorAll(".d-sec")[1].querySelectorAll("tbody tr").map(row => row.children.map(text))])
      .toEqual([0, [["Overview", "1", "Column dimension"], ["Overview", "2", ""], ["Stores <b>north</b>", "1", "Column dimension"]]]);

    // The line under the object's name: what says something of its type, its module, its model in an app of several, its ID, and its counts.
    const sub = (changes: Partial<WhereUsedObject>, multiModel: boolean) => text(parseMarkup(`<div>${objectDrawerSubHtml({ ...object, ...changes }, multiModel)}</div>`));
    expect([sub({}, false), sub({}, true), sub({ module: "REP01 <i>Sales</i>", pages: 1, cards: 1 }, true), sub({ id: "-", model: "-", type: "" }, true)])
      .toEqual(["Dimension · 20000000003 · 2 pages, 3 cards", "Dimension · Model one · 20000000003 · 2 pages, 3 cards", "Dimension · REP01 <i>Sales</i> · Model one · 20000000003 · 1 page, 1 card", "2 pages, 3 cards"]);
    const pill = parseMarkup(`<div>${objectDrawerSubHtml(object, false)}</div>`).querySelector(".id-pill");
    expect([pill?.dataset.copy, pill?.getAttribute("aria-label")]).toEqual(["20000000003", "Copy ID 20000000003"]);
  });

  it("says of an object with uses on a page name that pages share that its counts are the least they can be, why, and which uses those are", () => {
    // Two pages are called Overview, and the file has only a page's name: this object's three uses there may be on either.
    const open: WhereUsedObject = { type: "Dimension", name: "Time", module: "-", model: "Model one", pages: 2, pagesMost: 3, cards: 3, cardsMost: 4, id: "20000000003",
      note: 'It has 3 uses on a page name that more than one page has: "Overview <b>north</b>" (2 pages). The table has only the name of a use\'s page, so which of those pages a use is on is not known. It is on 2 or 3 pages and on 3 or 4 cards.',
      roles: [["Column dimension", 3], ["Context selector", 1]], uses: [
        { row: 1, page: "Overview <b>north</b>", card: 1, usedAs: "Column dimension", pagesOfName: 2 },
        { row: 2, page: "Overview <b>north</b>", card: 1, usedAs: "Context selector", pagesOfName: 2 },
        { row: 5, page: "Stores", card: 1, usedAs: "Column dimension", cardId: "card-c" },
        { row: 7, page: "Overview <b>north</b>", card: 2, usedAs: "Column dimension", cardId: "card-b", pagesOfName: 2 }] };
    const sub = (object: WhereUsedObject, multiModel = false) => parseMarkup(`<div>${objectDrawerSubHtml(object, multiModel)}</div>`).children[0];
    // The line under the name says "at least" for each count that is open, and no number as exact that is not. The note
    // follows on a line of its own, as text: the page name in it holds a tag, and is shown as typed.
    const said = sub(open);
    expect([said.childNodes.filter(node => node.nodeType === 3).map(node => node.textContent).join("").trim(), said.children.map(child => [child.localName, child.classList.contains("id-pill") ? "ID" : text(child)])])
      .toEqual(["Dimension ·  · at least 2 pages, at least 3 cards", [["button", "ID"], ["div", open.note]]]);
    expect([said.querySelectorAll("b").length, text(said).includes("2 pages, 3 cards") && !text(said).includes("at least 2 pages, at least 3 cards")]).toEqual([0, false]);
    // One count open and the other exact: only the open one says "at least".
    expect(text(sub({ ...open, pagesMost: undefined }))).toContain(" · 2 pages, at least 3 cards");
    expect(text(sub({ ...open, pages: 1, cardsMost: undefined }))).toContain(" · at least 1 page, 3 cards");
    // An object none of whose uses is on a shared name reads exactly as it did: its counts as they are, and no note.
    const exact: WhereUsedObject = { ...open, pagesMost: undefined, cardsMost: undefined, note: undefined, uses: open.uses.map(({ pagesOfName: _shared, ...use }) => use) };
    expect([text(sub(exact)), sub(exact).querySelectorAll("div").length, text(sub(exact, true))]).toEqual(["Dimension · 20000000003 · 2 pages, 3 cards", 0, "Dimension · Model one · 20000000003 · 2 pages, 3 cards"]);
    expect([sub({ ...exact, note: "" }).querySelectorAll("div").length, sub({ ...exact, note: "  " }).querySelectorAll("div").length]).toEqual([0, 0]);

    // The uses: the shared name says how many pages have it, where it heads its uses and, for a screen reader, with each
    // of them; a page whose name is its own says nothing more. The name is the link to its cards either way.
    const rows = (object: WhereUsedObject, links: Links) => parseMarkup(objectDrawerHtml(object, links, false)).querySelectorAll("#drawerUses tbody tr");
    expect(rows(open, LINKS).map(row => text(row.children[0]))).toEqual(["Overview <b>north</b> (2 pages have this name)", "Overview <b>north</b>, 2 pages have this name", "Overview <b>north</b>, 2 pages have this name", "Stores"]);
    expect(rows(open, LINKS).map(row => [row.children[0].querySelectorAll("button").map(text), row.children[0].querySelectorAll(".sr-only").map(text)]))
      .toEqual([[["Overview <b>north</b>"], []], [[], ["Overview <b>north</b>, 2 pages have this name"]], [[], ["Overview <b>north</b>, 2 pages have this name"]], [["Stores"], []]]);
    expect(rows(open, NO_LINKS).map(row => [text(row.children[0]), row.querySelectorAll("button").length])).toEqual([["Overview <b>north</b> (2 pages have this name)", 0],
      ["Overview <b>north</b>, 2 pages have this name", 0], ["Overview <b>north</b>, 2 pages have this name", 0], ["Stores", 0]]);
    // A use on a shared name opens its card only where the use names one; the rest of the list is as for any object.
    expect(rows(open, LINKS).map(row => row.children[1].querySelectorAll('[data-act="use-card"]').map(button => button.dataset.use))).toEqual([[], [], ["3"], ["2"]]);
    expect(rows(exact, LINKS).map(row => text(row.children[0]))).toEqual(["Overview <b>north</b>", "Overview <b>north</b>", "Overview <b>north</b>", "Stores"]);
    // Three pages of the name are said as three.
    expect(text(rows({ ...open, uses: [{ ...open.uses[0], pagesOfName: 3 }] }, LINKS)[0].children[0])).toBe("Overview <b>north</b> (3 pages have this name)");
  });

  it("lists the first fifty of an object's uses, with a control for the rest, and all of them once asked", () => {
    const uses = Array.from({ length: 130 }, (_, index) => ({ row: index, page: `Page ${index % 65}`, card: index < 65 ? 1 : 2, usedAs: "Column dimension", cardId: `card-${index}` }));
    const object: WhereUsedObject = { type: "Dimension", name: "Time", module: "-", model: "-", pages: 65, cards: 130, id: "20000000003", roles: [["Column dimension", 130]], uses };
    const first = parseMarkup(objectDrawerHtml(object, LINKS, false));
    const listed = (drawer: FakeElement) => drawer.querySelectorAll("#drawerUses tbody tr");
    // The heading counts them all. Fifty are listed: the first twenty-five pages, each with both of its uses, although the
    // file lists each page's second use sixty-five rows after its first.
    expect([text(first.querySelectorAll("h3")[1]), listed(first).length, listed(first).slice(0, 3).map(row => row.children.map(text)), listed(first)[49].children.map(text)])
      .toEqual(["Uses (130)", 50, [["Page 0", "1", "Column dimension"], ["Page 0", "2", "Column dimension"], ["Page 1", "1", "Column dimension"]], ["Page 24", "2", "Column dimension"]]);
    expect(listed(first).slice(0, 2).map(row => row.querySelectorAll("[data-use]").map(button => button.dataset.use))).toEqual([["0", "0"], ["65"]]);
    // A line says so, with the control that lists the rest; no row is marked as where the rest begins.
    const more = first.querySelector("#drawerUses p");
    expect([more?.textContent.replace(/\s+/g, " ").trim(), more?.querySelectorAll("button").map(button => [button.dataset.act, text(button), button.getAttribute("type")]), first.querySelectorAll("#usesRest").length])
      .toEqual(["The first 50 of 130 uses are listed. Show all 130 uses", [["more-uses", "Show all 130 uses", "button"]], 0]);
    // All of them: every use once, no control, and the first of the rest can take the focus.
    const all = parseMarkup(objectDrawerHtml(object, LINKS, true));
    expect([listed(all).length, all.querySelectorAll('[data-act="more-uses"]').length, all.querySelectorAll("#drawerUses p").length]).toEqual([130, 0, 0]);
    expect(new Set(listed(all).map(row => row.querySelector('[data-act="use-card"]')?.dataset.use)).size).toBe(130);
    const rest = all.querySelector("#usesRest");
    expect([rest === listed(all)[50], rest?.getAttribute("tabindex"), rest?.children.map(text), listed(all).filter(row => row.id !== "").length]).toEqual([true, "-1", ["Page 25", "1", "Column dimension"], 1]);
    // An object with fifty uses or fewer lists them all at once, either way.
    const few = { ...object, uses: uses.slice(0, 50) };
    for (const asked of [false, true]) {
      const drawer = parseMarkup(objectDrawerHtml(few, LINKS, asked));
      expect([listed(drawer).length, drawer.querySelectorAll('[data-act="more-uses"]').length, drawer.querySelectorAll("#usesRest").length]).toEqual([50, 0, 0]);
    }
  });

  it("says under a table's name what the table leaves out, as text, and nothing for a table that lists every row", () => {
    const noted = parseMarkup(tableHtml(viewOf(CARDS, LINKS, { note: "5 rows about the model <i>are</i> not listed here." })));
    expect([noted.children.map(child => child.id || child.localName), noted.querySelectorAll(".view-note").map(text), noted.querySelectorAll("i").length])
      .toEqual([["h1", "p", "div", "tableWrap"], ["5 rows about the model <i>are</i> not listed here."], 0]);
    // Its look is the stylesheet's, by its class.
    expect([noted.querySelector("p")?.classList.contains("view-note"), noted.querySelector("p")?.hasAttribute("style")]).toEqual([true, false]);
    const plain = parseMarkup(tableHtml(viewOf(CARDS, LINKS)));
    expect([plain.children.map(child => child.id || child.localName), plain.querySelectorAll(".view-note").length]).toEqual([["h1", "div", "tableWrap"], 0]);
  });

  it("writes the navigation's entries in the order given, a model's map among them as an entry like the others, each with its icon before its words", () => {
    const entries = [{ id: "overview", label: "Overview" }, { id: "12", label: "Model Calendar", file: "Model Calendar.csv" }, { id: "1", label: "Line Items", file: "Line Items.csv" },
      { id: "details", label: "Details" }, { id: "map", label: MAP_LABEL }];
    /** Each entry: its name in the navigation, its words, and whether it is the current one. */
    const items = (current: string) => parseMarkup(navHtml(entries, current)).querySelectorAll(".nav-item").map(item =>
      [item.dataset.nav, text(item.querySelector("span")), item.getAttribute("aria-current") ?? ""]);
    expect(items("12")).toEqual([["overview", "Overview", ""], ["12", "Model Calendar", "page"], ["1", "Line Items", ""], ["details", "Details", ""], ["map", "Model map", ""]]);
    // An entry is its icon, then its words, and nothing else: no count, which the overview's tile says. The icon is a
    // drawing, hidden from a screen reader, with no text: the button's text is its words.
    expect(parseMarkup(navHtml(entries, "12")).querySelectorAll(".nav-item").map(item => [item.children.map(child => child.localName), item.children[0].getAttribute("aria-hidden"), text(item)]))
      .toEqual([[["svg", "span"], "true", "Overview"], [["svg", "span"], "true", "Model Calendar"], [["svg", "span"], "true", "Line Items"], [["svg", "span"], "true", "Details"],
        [["svg", "span"], "true", "Model map"]]);
    // The map's entry is written as every other: a button the Tab key reaches, which nothing marks as off or as still to
    // come, and the current one when its view is shown.
    const written = parseMarkup(navHtml(entries, "map")).querySelectorAll(".nav-item").map(item => [item.localName, item.getAttribute("type"), item.getAttribute("class"), item.focusable,
      [...item.attributes.keys()].filter(name => !["type", "class", "data-nav", "aria-current"].includes(name))]);
    expect(written).toEqual(Array(5).fill(["button", "button", "nav-item", true, []]));
    expect([items("map")[4], items("map").filter(item => item[2] !== "").length, parseMarkup(navHtml(entries, "map")).textContent.includes("coming")]).toEqual([["map", "Model map", "page"], 1, false]);
    // Nothing stands between the entries: no divider, no group.
    expect(parseMarkup(navHtml(entries, "overview")).children.every(child => child.classList.contains("nav-item"))).toBe(true);
  });

  it("gives each entry the icon of its view: the overview's, the map's, its file's for a known file, and a table's for any other", () => {
    const entries = [{ id: "overview", label: "Overview" }, { id: "2", label: "Cards", file: "Cards.csv" }, { id: "3", label: "Dashboards", file: "Dashboards.csv" },
      { id: "4", label: "Versions", file: "Versions.csv" }, { id: "map", label: MAP_LABEL }];
    const icons = parseMarkup(navHtml(entries, "2")).querySelectorAll(".nav-item svg").map(icon => icon.outerHTML);
    expect(icons).toEqual([NAV_ICONS.overview, FILE_ICONS.get("Cards.csv"), NAV_ICONS.table, FILE_ICONS.get("Versions.csv"), NAV_ICONS.map].map(icon => parseMarkup(icon ?? "").innerHTML));
    // Each a different drawing.
    expect(new Set(icons).size).toBe(5);
  });

  it("gathers a model's entries in its groups by their files' names, each group where its first table stands; a group of one table, and a file no group names, stay entries; an app's entries stay as they are", () => {
    const entry = (id: string, label: string) => ({ id, label, file: `${label}.csv` });
    const entries = [{ id: "overview", label: "Overview" }, entry("13", "Model Calendar"), entry("10", "Time Ranges"), entry("11", "Versions"), entry("4", "General Lists"), entry("3", "Modules"),
      entry("1", "Line Items"), entry("5", "Processes"), entry("12", "Source Models"), entry("14", "Dashboards"), { id: "map", label: MAP_LABEL }];
    /** The items by their words: a group by its name and its entries' words. */
    const words = (items: NavItem[]) => items.map(item => ("entries" in item ? `${item.group.label}: ${item.entries.map(each => each.label).join(", ")}` : item.label));
    expect(words(navItems(entries, true))).toEqual(["Overview", "Time: Model Calendar, Time Ranges", "Versions", "General Lists", "Modules: Modules, Line Items", "Processes", "Source Models",
      "Dashboards", "Model map"]);
    // A table's words play no part: one labelled as a group's table but of another file is no table of the group.
    expect(words(navItems([entry("1", "Time Ranges"), { id: "2", label: "Model Calendar", file: "Calendar of mine.csv" }, entry("3", "Model Calendar")], true)))
      .toEqual(["Time: Time Ranges, Model Calendar", "Model Calendar"]);
    // An app's entries stand as they are, whatever their files are called.
    expect(navItems(entries, false)).toEqual(entries);
  });

  it("writes a group as a button that names its menu, which follows it closed, with an icon, a name and a chevron: the group's, or the entry's of the view shown that it holds", () => {
    const items = navItems([{ id: "overview", label: "Overview" }, { id: "3", label: "Modules", file: "Modules.csv" }, { id: "1", label: "Line Items", file: "Line Items.csv" }], true);
    const line = parseMarkup(navHtml(items, "1"));
    const group = line.querySelector(".nav-group");
    const button = group?.querySelector(".nav-group-btn");
    const menu = group?.querySelector(".nav-menu");
    expect([line.children.map(child => child.getAttribute("class")), group?.children.map(child => child.localName), button?.getAttribute("type"), button?.getAttribute("aria-expanded"),
      button?.getAttribute("aria-controls"), menu?.id, menu?.hidden, button?.getAttribute("aria-current"), text(button), button?.children.map(child => child.localName), button?.hasAttribute("data-nav")])
      .toEqual([["nav-item", "nav-group"], ["button", "div"], "button", "false", "navGroupModules", "navGroupModules", true, "true", "Line Items", ["svg", "span", "svg"], false]);
    // The button says which table is shown: that entry's icon and name, then the chevron, the two drawings hidden from a
    // screen reader.
    expect([button?.children[0].outerHTML, button?.children[2].getAttribute("class"), button?.children.map(child => child.getAttribute("aria-hidden"))])
      .toEqual([parseMarkup(FILE_ICONS.get("Line Items.csv") ?? "").innerHTML, "nav-chevron", ["true", null, "true"]]);
    // The menu holds the group's entries, the one of the view shown marked as the page, which no other element of the line is.
    expect([menu?.querySelectorAll(".nav-item").map(item => [item.dataset.nav, text(item), item.getAttribute("aria-current")]), line.querySelectorAll('[aria-current="page"]').length])
      .toEqual([[["3", "Modules", null], ["1", "Line Items", "page"]], 1]);
    // A group that does not hold the view shown is not marked, and its button has the group's own icon and name.
    const elsewhere = parseMarkup(navHtml(items, "overview")).querySelector(".nav-group-btn");
    expect([elsewhere?.hasAttribute("aria-current"), text(elsewhere), elsewhere?.children[0].outerHTML]).toEqual([false, "Modules", parseMarkup(NAV_ICONS.modules).innerHTML]);
  });

  it("writes the one menu of a narrow window: a button that names the view shown, as text, and every item in the line's order, a model's groups each in a section under its name", () => {
    const items = navItems([{ id: "overview", label: "Overview" }, { id: "3", label: "Modules", file: "Modules.csv" }, { id: "1", label: "Line Items <b>x</b>", file: "Line Items.csv" },
      { id: "map", label: MAP_LABEL }], true);
    const compact = parseMarkup(navMenuHtml(items, "1", "Line Items <b>x</b>"));
    const button = compact.querySelector(".nav-group-btn");
    expect([button?.getAttribute("aria-controls"), button?.getAttribute("aria-expanded"), button?.hasAttribute("aria-current"), text(button), button?.children[0].outerHTML,
      compact.querySelectorAll("b").length, compact.querySelector("#navMenu")?.hidden])
      .toEqual(["navMenu", "false", false, "Line Items <b>x</b>", parseMarkup(NAV_ICONS.menu).innerHTML, 0, true]);
    // A group's section is a group to a screen reader, named by the group: its heading, seen, is not read twice.
    expect(compact.querySelector("#navMenu")?.children.map(child => (child.classList.contains("nav-section")
      ? [child.getAttribute("role"), child.getAttribute("aria-label"), child.children.map(each => [text(each), each.getAttribute("aria-hidden"), each.getAttribute("aria-current")])] : text(child))))
      .toEqual(["Overview", ["group", "Modules", [["Modules", "true", null], ["Modules", null, null], ["Line Items <b>x</b>", null, "page"]]], "Model map"]);
  });

  it("shows the page a jump keeps as a chip at the head of the toolbar, with the button that clears it, and nothing of it without a jump", () => {
    const chip = (overrides: Partial<TableView>) => parseMarkup(tableHtml(viewOf(CARDS, LINKS, overrides))).querySelector("#pageFilter");
    // The page's name as text, after the page's own word for it; a name that holds a tag is that text.
    const kept = chip({ context: "Stores <b>north</b>" });
    expect([kept?.localName, kept?.getAttribute("class"), text(kept), kept?.querySelectorAll("b").length]).toEqual(["span", "ctx", "Page: Stores <b>north</b>", 0]);
    // The button clears the jump; it has no words of its own to see, so it has a name.
    expect(kept?.querySelectorAll("button").map(button => [button.getAttribute("type"), button.dataset.act, button.getAttribute("aria-label"), button.focusable, button.querySelector("svg")?.getAttribute("aria-hidden")]))
      .toEqual([["button", "clear-context", "Clear page filter", true, "true"]]);
    // At the head of the toolbar, before the search box; after the switch of a table that has one.
    const toolbar = (overrides: Partial<TableView>) => parseMarkup(tableHtml(viewOf(CARDS, LINKS, overrides))).querySelector(".toolbar")?.children.map(child => child.id);
    expect(toolbar({ context: "Stores" })).toEqual(["pageFilter", "searchWrap", "colBtn", "resetBtn", "rowCount", "pager"]);
    expect(toolbar({ context: "Stores", ways: [{ way: "object", label: "By object", chosen: true }, { way: "use", label: "Every use", chosen: false }] }))
      .toEqual(["tableWays", "pageFilter", "searchWrap", "colBtn", "resetBtn", "rowCount", "pager"]);
    // Without a jump there is no chip: the page's name is not kept, and the toolbar is as it always was.
    expect([chip({}), toolbar({})]).toEqual([null, ["searchWrap", "colBtn", "resetBtn", "rowCount", "pager"]]);
    // Its look is the stylesheet's: the page writes no style for it.
    expect(kept?.hasAttribute("style")).toBe(false);
  });

  it("writes for a model's map a view that holds its heading alone, and when the map could not be drawn says so in plain statements, with the button that copies the log", () => {
    // Shown: the map stands in its own place beside the view, so the view has the heading only, for a screen reader.
    const shown = parseMarkup(mapHtml(false));
    expect(shown.children.map(child => [child.localName, child.getAttribute("class"), text(child)])).toEqual([["h1", "sr-only", "Model map"]]);
    // Not drawn: the heading as every view has it, then what happened, that the tables are not affected, and what to do,
    // each a plain statement of its own. The last names the button beside it as that reads.
    const failed = parseMarkup(mapHtml(true));
    expect(failed.children.map(child => [child.localName, child.getAttribute("class")])).toEqual([["h1", "view-title"], ["div", "banner warn"]]);
    expect([text(failed.querySelector("h1")), failed.querySelectorAll(".banner div").map(text)]).toEqual(["Model map", [MAP_FAILED]]);
    expect(MAP_FAILED).toBe("The model map could not be drawn. The tables are not affected. Choose Copy diagnostic log and send the log.");
    const button = failed.querySelector(".banner button");
    expect([button?.dataset.act, text(button), button?.getAttribute("type"), button?.focusable, MAP_FAILED.includes(`Choose ${text(button)} `)]).toEqual(["copy-run-log", "Copy diagnostic log", "button", true, true]);
    // Three statements, none hung on another by "then" or "as usual", and the icon is not read out.
    expect([MAP_FAILED.split(". ").length, MAP_FAILED.endsWith("."), /\bthen\b|as usual/.test(MAP_FAILED), failed.querySelector(".banner svg")?.getAttribute("aria-hidden")]).toEqual([3, true, false, "true"]);
  });

  it("shows on the overview what the Details file says: what was read first, then the tables that say more than their tile, and two sections that start closed", () => {
    const view = parseMarkup(overviewHtml(overviewWith({
      tiles: [{ label: "Pages", count: 7 }], notes: ["A note."],
      about: [["App", "Demo <b>app</b>"], ["Cards", "3"], ["Exported on", "2026-10-03 14:02 UTC"]],
      files: [["Imports", "Not exported: the grid did not load"]],
      howToRead: [["Layout", "Each table is laid out as the grid of the same name."], ["Line Items", "Line items only: each names its module."]],
      log: ["14:02:05 first line", "plain line", "14:02:07 last line"],
    })));
    /** A list of details: each detail beside its value. */
    const list = (selector: string) => {
      const names = view.querySelectorAll(`${selector} dt`).map(text);
      return names.map((name, index) => [name, text(view.querySelectorAll(`${selector} dd`)[index])]);
    };
    // The order under the heading: the tiles, what was read, the place for what the page keeps of it, the notes, the
    // tables that say more than their tile, how to read them, the log.
    expect(view.children.map(child => child.id || (child.classList.contains("panel") ? "notes" : child.classList.contains("ov-grid") ? "tiles" : child.localName)))
      .toEqual(["h1", "tiles", "ovAbout", "ovKept", "notes", "ovFiles", "ovHowTo", "ovLog"]);
    expect([text(view.querySelector("#ovAbout h2")), list("#ovAbout dl.dl")]).toEqual(["About this export", [["App", "Demo <b>app</b>"], ["Cards", "3"], ["Exported on", "2026-10-03 14:02 UTC"]]]);
    expect([text(view.querySelector("#ovFiles h2")), list("#ovFiles dl.dl")]).toEqual(["Tables", [["Imports", "Not exported: the grid did not load"]]]);
    expect(view.querySelectorAll("b").length).toBe(0);
    // The two sections that start closed: each is a details element whose first child is its summary, with the section's
    // heading in it; what the section holds comes after, and is out of sight until it is opened.
    for (const [id, title] of [["ovHowTo", "How to read these tables"], ["ovLog", "Diagnostics"]]) {
      const section = view.querySelector(`#${id}`);
      expect([section?.localName, section?.hasAttribute("open"), section?.classList.contains("diag"), section?.children.map(child => child.localName), text(section?.querySelector("summary h2")),
        section?.querySelector("summary")?.focusable, section?.querySelector(".diag-body")?.inClosedDetails], id).toEqual(["details", false, true, ["summary", "div"], title, true, true]);
    }
    expect(list("#ovHowTo dl.dl")).toEqual([["Layout", "Each table is laid out as the grid of the same name."], ["Line Items", "Line items only: each names its module."]]);
    // The log line for line, with the button that copies it above it, so that it is in sight as soon as the section is open.
    expect(view.querySelector("#diagLog")?.textContent).toBe("14:02:05 first line\nplain line\n14:02:07 last line");
    expect(view.querySelector("#ovLog .diag-body")?.children.map(child => child.localName)).toEqual(["button", "pre"]);
    // The sections' spacing and their headings' look are the stylesheet's: the page writes no style of its own for them.
    expect(view.querySelectorAll("#ovHowTo, #ovLog").flatMap(section => [section, ...section.querySelectorAll("[style]")]).filter(element => element.hasAttribute("style"))).toEqual([]);
    expect(view.querySelectorAll("#ovLog [data-act]").map(button => [button.localName, button.dataset.act, text(button)])).toEqual([["button", "copy-diag", "Copy diagnostic log"]]);
    // Each part is there only when it has something to say: without a log there is no Diagnostics section, and nothing to copy.
    const bare = parseMarkup(overviewHtml(overviewWith({ about: [["Model", "Model one"]] })));
    expect([bare.children.map(child => child.id || child.localName), bare.querySelectorAll("details").length, bare.querySelectorAll("[data-act]").length, text(bare.querySelector("h1"))])
      .toEqual([["h1", "div", "ovAbout", "ovKept"], 0, 0, "Overview"]);
  });

  it("says under the details of the export what the page keeps of the result for a refresh: the button that forgets a kept copy, one line once it is forgotten, and the button still when the copy could not be removed", () => {
    const parts: Partial<Overview> = { tiles: [{ label: "Pages", count: 7 }], about: [["App", "Demo app"], ["Exported on", "2026-10-03 14:02 UTC"]], notes: ["A note."] };
    const overview = (copy?: KeptCopy) => parseMarkup(copy === undefined ? overviewHtml(overviewWith(parts)) : overviewHtml(overviewWith(parts), copy));
    /** The place: what it is, where it stands in the overview, and what it holds, element by element. */
    const place = (copy?: KeptCopy) => {
      const view = overview(copy);
      const kept = view.querySelector("#ovKept");
      return [kept?.localName, kept?.getAttribute("class"), view.children.map(child => child.id || child.localName).slice(1, 4),
        kept?.children.map(child => [child.localName, child.id || child.dataset.act, text(child)])];
    };
    const where = ["p", "ov-kept", ["div", "ovAbout", "ovKept"]];
    // Nothing kept, as for a result that cannot be kept: the place is there and holds nothing at all, neither an element
    // nor a text, so that the stylesheet can give it no room. That is also the overview by itself.
    expect([place("none"), place(), overview("none").querySelector("#ovKept")?.innerHTML, keptCopyHtml("none")]).toEqual([[...where, []], [...where, []], "", ""]);
    // A result that is being kept: the room for the line and the button of a kept copy. It holds their words and the
    // button's look, so that it is as large as the two will be. Each part is marked as to come, which the stylesheet does
    // not show, and is kept from a screen reader. Neither is a button, takes the focus, has an ID or says what a click
    // on it does: nothing is said yet, and nothing can be forgotten yet.
    expect(place("keeping")).toEqual([...where, [["span", undefined, "A copy of this result is kept for a refresh of this page."], ["span", undefined, "Forget this result"]]]);
    expect(overview("keeping").querySelectorAll("#ovKept span").map(part => [part.getAttribute("class"), part.getAttribute("aria-hidden"), part.focusable, part.id]))
      .toEqual([["to-come", "true", false, ""], ["btn sm to-come", "true", false, ""]]);
    expect([overview("keeping").querySelectorAll("#ovKept button, #ovKept [data-act], #ovKept [tabindex], #ovKept [id]").length, overview("keeping").querySelector("#ovKept")?.textContent])
      .toEqual([0, overview("kept").querySelector("#ovKept")?.textContent]);
    // A copy is kept: a line that says so, and beside it the button that forgets the copy.
    expect(place("kept")).toEqual([...where, [["span", "keptLine", "A copy of this result is kept for a refresh of this page."], ["button", "forget", "Forget this result"]]]);
    const button = overview("kept").querySelector('#ovKept [data-act="forget"]');
    // It is the design's small button, one the Tab key reaches, and the line beside it describes it to a screen reader.
    expect([button?.getAttribute("type"), button?.getAttribute("class"), button?.focusable, button?.getAttribute("aria-describedby"), button?.hasAttribute("aria-label"),
      overview("kept").querySelector("#keptLine")?.hasAttribute("tabindex")]).toEqual(["button", "btn sm", true, "keptLine", false, false]);
    // Forgotten: the button is gone, and one line says what happened. It can take the focus the button had, by script only.
    expect(place("forgotten")).toEqual([...where, [["span", "keptLine", "The copy kept for refreshes is removed. This result stays here until you refresh or close this page."]]]);
    expect(FORGOTTEN_LINE).toBe("The copy kept for refreshes is removed. This result stays here until you refresh or close this page.");
    const line = overview("forgotten").querySelector("#keptLine");
    expect([line?.getAttribute("tabindex"), line?.focusable, overview("forgotten").querySelectorAll("#ovKept button").length]).toEqual(["-1", true, 0]);
    // A copy that could not be removed: one line says so and no more, and the button is still there, for another try.
    // The line is not the button's description, as the line of a kept copy is: the page says it through its live region.
    expect(place("not-removed")).toEqual([...where, [["span", "keptLine", "The copy kept for refreshes could not be removed."], ["button", "forget", "Forget this result"]]]);
    expect(NOT_REMOVED_LINE).toBe("The copy kept for refreshes could not be removed.");
    const again = overview("not-removed").querySelector('#ovKept [data-act="forget"]');
    expect([again?.getAttribute("type"), again?.getAttribute("class"), again?.focusable, again?.hasAttribute("aria-describedby"), overview("not-removed").querySelector("#keptLine")?.hasAttribute("tabindex")])
      .toEqual(["button", "btn sm", true, false, false]);
    for (const copy of ["none", "keeping", "kept", "not-removed", "forgotten"] as const) {
      // What the place holds is what the page writes into it when what is kept changes, to the character.
      expect(overview(copy).querySelector("#ovKept")?.innerHTML, copy).toBe(parseMarkup(keptCopyHtml(copy)).innerHTML);
      // Its look is the stylesheet's, and it has no heading: it stands under the one about the export.
      expect([overview(copy).querySelectorAll("#ovKept, #ovKept [style]").filter(element => element.hasAttribute("style")).length, overview(copy).querySelectorAll("#ovKept h2, #ovKept h3").length], copy).toEqual([0, 0]);
      // Without anything about the export, the place stands under the tiles.
      expect(parseMarkup(overviewHtml(overviewWith({ tiles: parts.tiles }), copy)).children.map(child => child.id || child.localName), copy).toEqual(["h1", "div", "ovKept"]);
    }
  });
});
