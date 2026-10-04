import { describe, expect, it } from "vitest";
import type { Cell, ResultTable } from "../result-types.js";
import { columnsOf, type Column } from "./columns.js";
import { parseMarkup, type FakeElement } from "./dom.test-support.js";
import { cardDrawerSubHtml, cellHtml, colChooserHtml, colFilterHtml, FORGOTTEN_LINE, keptCopyHtml, navHtml, objectDrawerHtml, objectDrawerSubHtml, overviewHtml, pagerHtml, rowDrawerHtml, tableHtml,
  USES_AT_FIRST, type KeptCopy, type Links, type TableView } from "./markup.js";
import type { Overview } from "./result-view.js";
import { pageOf, selectRows } from "./table-engine.js";
import type { WhereUsedObject } from "./where-used-view.js";

// What each piece of markup shows: the right value in the right place. markup.test.ts checks that no value can change the
// markup, with the same hostile texts everywhere; here every value is harmless and different from its neighbours, so a
// value in the wrong place, or a button that carries the wrong column, shows.

const LINKS: Links = { page: true, card: true };
const NO_LINKS: Links = { page: false, card: false };
const KINDS: Column["kind"][] = ["text", "id", "tag", "page", "card"];
const column = (index: number, label: string, kind: Column["kind"] = "text", extra: Partial<Column> = {}): Column =>
  ({ index, label, kind, num: false, filter: false, hidden: false, ...extra });

// Cards.csv, so that its columns are the design's: Page a link with a filter, Card # a number, Card type a tag with a
// filter, Card ID an ID that starts hidden.
const CARDS: ResultTable = {
  file: "Cards.csv", label: "Cards", headers: ["Page", "Card #", "Card title", "Card type", "Card ID"], guard: true,
  rows: [["Overview", 1, "Sales by region", "Grid", "card-a"], ["Overview", 2, "Margin %", "KPI", "card-b"], ["Stores", 3, "", "Text", "—"]],
};
// A model's file: its first header is empty, and nothing is known about its columns.
const LINES: ResultTable = {
  file: "Line Items.csv", label: "Line Items", headers: ["", "Formula", "", "Format"], guard: false,
  rows: [["Revenue", "Units * Price", "x1", "Number"], ["Units", "", "x2", "Number"], ["Price", "12.5", "x3", "Text"]],
};

function viewOf(table: ResultTable, links: Links, overrides: Partial<TableView> = {}): TableView {
  const page = pageOf(selectRows(table.rows, { search: "", filters: new Map() }), 0, 50);
  return { label: table.label, columns: columnsOf(table), rows: page.rows, page: page.page, pages: page.pages, pageSize: 50, from: page.from, to: page.to,
    total: page.total, all: table.rows.length, search: "", sort: undefined, filtered: new Set(), context: undefined, links, note: undefined, ...overrides };
}
const text = (element: FakeElement | null | undefined): string => element?.textContent.trim() ?? "";
/** An overview that holds nothing but what a test gives it. */
const overviewWith = (parts: Partial<Overview>): Overview => ({ tiles: [], cardTypes: [], models: [], notes: [], about: [], files: [], howToRead: [], log: [], ...parts });
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
    // A number shows as its digits, 0 included. An empty or missing cell shows nothing, and the dash is the greyed dash, in every kind of column.
    expect([text(parseMarkup(cellHtml(column(1, "Card #"), ["a", 0], NO_LINKS))), text(parseMarkup(cellHtml(column(1, "Card #"), ["a", -12.5], NO_LINKS)))]).toEqual(["0", "-12.5"]);
    for (const kind of KINDS) {
      expect([cellHtml(column(0, "Any", kind), [""], LINKS), cellHtml(column(3, "Any", kind), ["a"], LINKS)], kind).toEqual(["", ""]);
      const dash = parseMarkup(cellHtml(column(0, "Any", kind), ["—"], LINKS)).children;
      expect(dash.map(element => [element.localName, element.getAttribute("class"), element.textContent]), kind).toEqual([["span", "dash", "—"]]);
    }
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
    /** Each heading: its name, the column its sort button carries, how it says it is sorted and the arrow it shows. */
    const heads = (view: TableView) => parseMarkup(tableHtml(view)).querySelectorAll("thead th").map(heading => {
      const button = heading.querySelector(".th-sort");
      const arrow = text(heading.querySelector(".dir"));
      return [text(button).slice(0, text(button).length - arrow.length), button?.dataset.sort, heading.getAttribute("aria-sort"), arrow, heading.classList.contains("num")];
    });
    expect(heads(viewOf(CARDS, LINKS))).toEqual([["Page", "0", "none", "", false], ["Card #", "1", "none", "", true], ["Card title", "2", "none", "", false],
      ["Card type", "3", "none", "", false], ["Card ID", "4", "none", "", false]]);
    // With columns hidden, a heading still carries its own column, not its place among the ones shown.
    const some = columnsOf(CARDS).filter(entry => [1, 3, 4].includes(entry.index));
    expect(heads(viewOf(CARDS, LINKS, { columns: some, sort: { column: 3, dir: "asc" } }))).toEqual([["Card #", "1", "none", "", true],
      ["Card type", "3", "ascending", "▲", false], ["Card ID", "4", "none", "", false]]);
    expect(heads(viewOf(CARDS, LINKS, { columns: some, sort: { column: 4, dir: "desc" } })).map(heading => heading.slice(2, 4))).toEqual([["none", ""], ["none", ""], ["descending", "▼"]]);
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
      .toEqual([["Previous page", "Page 1", "Page 2", "Page 3", "Next page"], ["pageSize"]]);
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
    // A table whose file has rows, all of them left to the CSV, does not say that nothing was found: it says that none of
    // the rows is its own, in the words it is given, as text. The line under its name says how many rows the CSV has.
    const left = { all: 0, note: "5 rows about the model are in the CSV only.", none: "Every row of the file is <b>about</b> the model." };
    expect(empty(left)).toEqual(["Cards has no rows of its own", "Every row of the file is <b>about</b> the model.", [], 0, ""]);
    const view = parseMarkup(tableHtml(viewOf(CARDS, LINKS, { rows: [], total: 0, from: 0, to: 0, ...left })));
    expect([view.querySelectorAll(".view-note").map(text), view.querySelectorAll(".empty b").length, view.textContent.includes("Nothing was found")]).toEqual([["5 rows about the model are in the CSV only."], 0, false]);
    // Those words are for a table without rows only: one that a search leaves empty says so as ever.
    expect(empty({ search: "x", none: left.none }).slice(0, 2)).toEqual(["No results", "Nothing in Cards matches the current search."]);
  });

  it("offers Previous, the page numbers and Next, each with the page it goes to, and marks the page shown", () => {
    /** Each button of the pager: its words, its name, the page it goes to (from 0), and "off" or "here" when disabled or current. */
    const pager = (page: number, pages: number) => parseMarkup(pagerHtml(page, pages, pages * 50, 50)).querySelectorAll(".pg-btn").map(button =>
      [text(button), button.getAttribute("aria-label"), button.dataset.page, button.disabled ? "off" : button.getAttribute("aria-current") === "true" ? "here" : ""]);
    expect(pager(0, 3)).toEqual([["‹", "Previous page", "-1", "off"], ["1", "Page 1", "0", "here"], ["2", "Page 2", "1", ""], ["3", "Page 3", "2", ""], ["›", "Next page", "1", ""]]);
    expect(pager(1, 3)).toEqual([["‹", "Previous page", "0", ""], ["1", "Page 1", "0", ""], ["2", "Page 2", "1", "here"], ["3", "Page 3", "2", ""], ["›", "Next page", "2", ""]]);
    expect(pager(2, 3)).toEqual([["‹", "Previous page", "1", ""], ["1", "Page 1", "0", ""], ["2", "Page 2", "1", ""], ["3", "Page 3", "2", "here"], ["›", "Next page", "3", "off"]]);
    expect(pager(0, 1)).toEqual([["‹", "Previous page", "-1", "off"], ["1", "Page 1", "0", "here"], ["›", "Next page", "1", "off"]]);
    // Many pages: the ends, the pages around the one shown, and a gap where pages are left out.
    const long = parseMarkup(pagerHtml(10, 20, 1000, 50)).querySelector(".pages");
    expect(long?.children.map(item => (item.localName === "button" ? `${text(item)}>${item.dataset.page}${item.getAttribute("aria-current") ? "!" : ""}` : text(item))))
      .toEqual(["1>0", "…", "10>9", "11>10!", "12>11", "…", "20>19"]);
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

  it("shows the overview's tiles, an app's cards by type as bars, its models and the notes", () => {
    const view = parseMarkup(overviewHtml(overviewWith({
      tiles: [{ label: "Pages", count: 7 }, { label: "Cards", count: 1 }, { label: "Filters", count: 0 }],
      cardTypes: [["Grid", 8], ["KPI", 2], ["", 1]],
      models: [{ model: "Model one", workspace: "Main", modelId: "id-1" }, { model: "Model two", workspace: "Other", modelId: "—" }],
      notes: ["A first note.", "A second note."],
    })));
    expect(view.querySelectorAll(".stat").map(tile => tile.children.map(text))).toEqual([["Pages", "7", "rows"], ["Cards", "1", "row"], ["Filters", "0", "rows"]]);
    // A bar is as long as its type's share of the largest; a type without a name is called blank.
    expect(view.querySelectorAll(".typebar").map(bar => [text(bar.children[0]), text(bar.querySelector(".tb-n")), bar.querySelector(".tb-fill")?.getAttribute("style")])).toEqual([
      ["Grid", "8", "display:block;width:100%"], ["KPI", "2", "display:block;width:25%"], ["(blank)", "1", "display:block;width:13%"]]);
    // A model: its name, its ID to copy (a dash where there is none), and its workspace.
    expect(view.querySelectorAll(".model-row").map(model => [model.querySelector(".m-name")?.childNodes[0].textContent.trim(), model.querySelector(".id-pill")?.dataset.copy ?? text(model.querySelector(".dash")),
      text(model.querySelector(".m-sub"))])).toEqual([["Model one", "id-1", "Workspace: Main"], ["Model two", "—", "Workspace: Other"]]);
    // The notes stand above the cards by type and the models.
    expect([view.querySelectorAll(".panel h2").map(text), view.querySelectorAll(".warn-list li").map(text)]).toEqual([["Notes", "Cards by type", "Models"], ["A first note.", "A second note."]]);
    // A model's export has neither cards nor models, and a result may have no notes: then there is no panel for them, and
    // without a Details file nothing else stands under the tiles but the place for what the page keeps of the result,
    // which holds nothing.
    const bare = parseMarkup(overviewHtml(overviewWith({ tiles: [{ label: "Line Items", count: 120 }] })));
    expect([bare.querySelectorAll(".stat").map(tile => tile.children.map(text)), bare.querySelectorAll(".panel").length, bare.querySelectorAll(".ov-cols").length,
      bare.children.map(child => child.localName), bare.querySelector("#ovKept")?.innerHTML]).toEqual([[["Line Items", "120", "rows"]], 0, 0, ["h1", "div", "p"], ""]);
    const one = parseMarkup(overviewHtml(overviewWith({ cardTypes: [["Grid", 3]] })));
    expect([one.querySelectorAll(".panel h2").map(text), one.querySelector(".tb-fill")?.getAttribute("style")]).toEqual([["Cards by type"], "display:block;width:100%"]);
  });

  it("says on a tile how many rows the CSV has, under the rows its table lists, where the two are not the same number", () => {
    const view = parseMarkup(overviewHtml(overviewWith({ tiles: [{ label: "Line Items", count: 3511, inCsv: 3632 }, { label: "Model Calendar", count: 0, inCsv: 1 }, { label: "Modules", count: 121 },
      { label: "Odd", count: 1, inCsv: 0 }] })));
    // The number in large is the table's; the line under it says the file's, each with its own word for one row and for several.
    expect(view.querySelectorAll(".stat").map(tile => tile.children.map(text))).toEqual([["Line Items", "3511", "rows", "3632 rows in the CSV"], ["Model Calendar", "0", "rows", "1 row in the CSV"],
      ["Modules", "121", "rows"], ["Odd", "1", "row", "0 rows in the CSV"]]);
    // Both lines under the number are the tile's small lines: the second needs no style of its own.
    expect(view.querySelectorAll(".stat").map(tile => tile.children.map(child => [...["s-lab", "s-num", "s-sub"]].find(name => child.classList.contains(name))))).toEqual([
      ["s-lab", "s-num", "s-sub", "s-sub"], ["s-lab", "s-num", "s-sub", "s-sub"], ["s-lab", "s-num", "s-sub"], ["s-lab", "s-num", "s-sub", "s-sub"]]);
  });

  it("shows in a row's drawer, after a cell that is said in words, the text the CSV has in its place, named as the CSV's", () => {
    const columns = [column(0, "Name"), column(1, "Format"), column(2, "Formula"), column(3, "Summary", "tag")];
    const row = ["Margin %", "Number, 2 decimal places, %", "Margin / Revenue", "Ratio = Margin / Revenue"];
    const format = '{"decimalPlaces":2,"unitsType":"PERCENTAGE","dataType":"NUMBER"}';
    const summary = '{"summaryMethod":"RATIO"} <b>bold</b>\n  second line';
    const drawer = parseMarkup(rowDrawerHtml(columns, row, NO_LINKS, new Map([[1, format], [3, summary]])));
    // Each column's name beside its cell as the table shows it; after a cell said in words, the CSV's text under "in the CSV".
    expect(drawer.querySelectorAll("dt").map(name => name.textContent)).toEqual(["Name", "Format", "Format in the CSV", "Formula", "Summary", "Summary in the CSV"]);
    expect(drawer.querySelectorAll("dd").map(value => value.textContent)).toEqual(["Margin %", "Number, 2 decimal places, %", format, "Margin / Revenue", "Ratio = Margin / Revenue", summary]);
    // The CSV's text is a text, whole: in the element that keeps its line breaks and spaces, whatever the column's kind, and never an element.
    expect(drawer.querySelectorAll("dd").map(value => [value.children.map(child => child.classList.contains("cell-t") || child.classList.contains("tag")), value.querySelector(".cell-t")?.textContent]))
      .toEqual([[[true], "Margin %"], [[true], "Number, 2 decimal places, %"], [[true], format], [[true], "Margin / Revenue"], [[true], "Ratio = Margin / Revenue"], [[true], summary]]);
    expect([drawer.querySelectorAll("b").length, drawer.querySelectorAll("h3").map(text)]).toEqual([0, ["All columns"]]);
    // A row none of whose cells is said in words, and a table that has no such cells, show the columns alone.
    for (const none of [rowDrawerHtml(columns, row, NO_LINKS, new Map()), rowDrawerHtml(columns, row, NO_LINKS)]) {
      expect(parseMarkup(none).querySelectorAll("dt").map(name => name.textContent)).toEqual(["Name", "Format", "Formula", "Summary"]);
    }
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
    const object: WhereUsedObject = { type: "Dimension", name: "Time", module: "—", model: "Model one", pages: 2, cards: 3, id: "20000000003",
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
    expect([sub({}, false), sub({}, true), sub({ module: "REP01 <i>Sales</i>", pages: 1, cards: 1 }, true), sub({ id: "—", model: "—", type: "" }, true)])
      .toEqual(["Dimension · 20000000003 · 2 pages, 3 cards", "Dimension · Model one · 20000000003 · 2 pages, 3 cards", "Dimension · REP01 <i>Sales</i> · Model one · 20000000003 · 1 page, 1 card", "2 pages, 3 cards"]);
    const pill = parseMarkup(`<div>${objectDrawerSubHtml(object, false)}</div>`).querySelector(".id-pill");
    expect([pill?.dataset.copy, pill?.getAttribute("aria-label")]).toEqual(["20000000003", "Copy ID 20000000003"]);
  });

  it("says of an object with uses on a page name that pages share that its counts are the least they can be, why, and which uses those are", () => {
    // Two pages are called Overview, and the file has only a page's name: this object's three uses there may be on either.
    const open: WhereUsedObject = { type: "Dimension", name: "Time", module: "—", model: "Model one", pages: 2, pagesMost: 3, cards: 3, cardsMost: 4, id: "20000000003",
      note: 'It has 3 uses on a page name that more than one page has: "Overview <b>north</b>" (2 pages). The CSV has only the name of a use\'s page, so which of those pages a use is on is not known. It is on 2 or 3 pages and on 3 or 4 cards.',
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
    const object: WhereUsedObject = { type: "Dimension", name: "Time", module: "—", model: "—", pages: 65, cards: 130, id: "20000000003", roles: [["Column dimension", 130]], uses };
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

  it("says under a table's name what the table leaves to the CSV, as text, and nothing for a table that lists every row", () => {
    const noted = parseMarkup(tableHtml(viewOf(CARDS, LINKS, { note: "5 rows about the model <i>are</i> in the CSV only." })));
    expect([noted.children.map(child => child.id || child.localName), noted.querySelectorAll(".view-note").map(text), noted.querySelectorAll("i").length])
      .toEqual([["h1", "p", "div", "tableWrap"], ["5 rows about the model <i>are</i> in the CSV only."], 0]);
    // Its look is the stylesheet's, by its class.
    expect([noted.querySelector("p")?.classList.contains("view-note"), noted.querySelector("p")?.hasAttribute("style")]).toEqual([true, false]);
    const plain = parseMarkup(tableHtml(viewOf(CARDS, LINKS)));
    expect([plain.children.map(child => child.id || child.localName), plain.querySelectorAll(".view-note").length]).toEqual([["h1", "div", "tableWrap"], 0]);
  });

  it("writes the navigation's entries in the order given, and the model map after them only when asked for it", () => {
    const entries = [{ id: "overview", label: "Overview" }, { id: "12", label: "Model Calendar", count: 26 }, { id: "1", label: "Line Items", count: 120 }, { id: "details", label: "Details" }];
    /** Each entry: its name in the navigation, its words, its count, and whether it is the current one or off. */
    const items = (map: boolean) => parseMarkup(navHtml(entries, "12", map)).querySelectorAll(".nav-item").map(item =>
      [item.dataset.nav, text(item.children[0]), text(item.querySelector(".cnt")), item.getAttribute("aria-current") ?? (item.classList.contains("disabled") ? "off" : "")]);
    const listed = [["overview", "Overview", "", ""], ["12", "Model Calendar", "26", "page"], ["1", "Line Items", "120", ""], ["details", "Details", "", ""]];
    expect(items(false)).toEqual(listed);
    expect(items(true)).toEqual([...listed, ["map", "Model map", "", "off"]]);
    // The model map is a button like the others, so the Tab key reaches it in its place, and it says that it is to come.
    const map = parseMarkup(navHtml(entries, "overview", true)).querySelectorAll(".nav-item")[4];
    expect([map.localName, map.getAttribute("aria-disabled"), map.title, text(map.querySelector(".soon"))]).toEqual(["button", "true", "Model map is coming in a later version", "coming soon"]);
    // Nothing stands between the entries: no divider, no group.
    expect(parseMarkup(navHtml(entries, "overview", true)).children.every(child => child.classList.contains("nav-item"))).toBe(true);
  });

  it("shows on the overview what the Details file says: what was read first, then the files that say more than their tile, and two sections that start closed", () => {
    const view = parseMarkup(overviewHtml(overviewWith({
      tiles: [{ label: "Pages", count: 7 }], cardTypes: [["Grid", 8]], models: [{ model: "Model one", workspace: "Main", modelId: "id-1" }], notes: ["A note."],
      about: [["App", "Demo <b>app</b>"], ["Cards", "3"], ["Exported on", "2026-10-03 14:02 UTC"]],
      files: [["Imports.csv", "Not exported: the grid did not load"]],
      howToRead: [["Layout", "Each file is laid out as Anaplan's own export."], ["Line Items", "Each module's row sits above its line items."]],
      log: ["14:02:05 first line", "plain line", "14:02:07 last line"],
    })));
    /** A list of details: each detail beside its value. */
    const list = (selector: string) => {
      const names = view.querySelectorAll(`${selector} dt`).map(text);
      return names.map((name, index) => [name, text(view.querySelectorAll(`${selector} dd`)[index])]);
    };
    // The order under the heading: the tiles, what was read, the place for what the page keeps of it, the notes, an app's
    // panels, the files, how to read them, the log.
    expect(view.children.map(child => child.id || (child.classList.contains("panel") ? "notes" : child.classList.contains("ov-grid") ? "tiles" : child.classList.contains("ov-cols") ? "panels" : child.localName)))
      .toEqual(["h1", "tiles", "ovAbout", "ovKept", "notes", "panels", "ovFiles", "ovHowTo", "ovLog"]);
    expect([text(view.querySelector("#ovAbout h2")), list("#ovAbout dl.dl")]).toEqual(["About this export", [["App", "Demo <b>app</b>"], ["Cards", "3"], ["Exported on", "2026-10-03 14:02 UTC"]]]);
    expect([text(view.querySelector("#ovFiles h2")), list("#ovFiles dl.dl")]).toEqual(["Files", [["Imports.csv", "Not exported: the grid did not load"]]]);
    expect(view.querySelectorAll("b").length).toBe(0);
    // The two sections that start closed: each is a details element whose first child is its summary, with the section's
    // heading in it; what the section holds comes after, and is out of sight until it is opened.
    for (const [id, title] of [["ovHowTo", "How to read these files"], ["ovLog", "Diagnostics"]]) {
      const section = view.querySelector(`#${id}`);
      expect([section?.localName, section?.hasAttribute("open"), section?.classList.contains("diag"), section?.children.map(child => child.localName), text(section?.querySelector("summary h2")),
        section?.querySelector("summary")?.focusable, section?.querySelector(".diag-body")?.inClosedDetails], id).toEqual(["details", false, true, ["summary", "div"], title, true, true]);
    }
    expect(list("#ovHowTo dl.dl")).toEqual([["Layout", "Each file is laid out as Anaplan's own export."], ["Line Items", "Each module's row sits above its line items."]]);
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

  it("says under the details of the export what the page keeps of the result for a refresh: the button that forgets a kept copy, and one line once it is forgotten", () => {
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
    // Nothing kept, as before a result is kept and for one that cannot be: the place is there and holds nothing at all,
    // neither an element nor a text, so that the stylesheet can give it no room. That is also the overview by itself.
    expect([place("none"), place(), overview("none").querySelector("#ovKept")?.innerHTML, keptCopyHtml("none")]).toEqual([[...where, []], [...where, []], "", ""]);
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
    for (const copy of ["none", "kept", "forgotten"] as const) {
      // What the place holds is what the page writes into it when what is kept changes, to the character.
      expect(overview(copy).querySelector("#ovKept")?.innerHTML, copy).toBe(parseMarkup(keptCopyHtml(copy)).innerHTML);
      // Its look is the stylesheet's, and it has no heading: it stands under the one about the export.
      expect([overview(copy).querySelectorAll("#ovKept, #ovKept [style]").filter(element => element.hasAttribute("style")).length, overview(copy).querySelectorAll("#ovKept h2, #ovKept h3").length], copy).toEqual([0, 0]);
      // Without anything about the export, the place stands under the tiles.
      expect(parseMarkup(overviewHtml(overviewWith({ tiles: parts.tiles }), copy)).children.map(child => child.id || child.localName), copy).toEqual(["h1", "div", "ovKept"]);
    }
  });
});
