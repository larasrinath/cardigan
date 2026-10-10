import { describe, expect, it } from "vitest";
import { NONE as REPORT_NONE } from "../report.js";
import type { Cell } from "../result-types.js";
import { cellText, dayOf, dayText, filterItems, groupedCount, NONE, numberOf, pageOf, rangeColumn, rememberingSelect, ROW_NAME_MAX, rowName, saysNothing, selectRows,
  sortRows, valueCounts, type ItemsOf, type RangeQuery, type TableQuery } from "./table-engine.js";

// Page, Card #, Card title, Card type, Card ID
const CARDS: Cell[][] = [
  ["Overview", 1, "Sales by region", "Grid", "card-a"],
  ["Overview", 2, "Margin %", "KPI", "card-b"],
  ["Overview", 10, "How to use this page", "Text", "card-c"],
  ["Stores", 1, "Store plan", "Grid", "card-d"],
  ["Stores", 2, "sales value", "Chart", "card-e"],
  ["Admin", 1, "-", "Action", "card-f"],
];
const titles = (rows: readonly (readonly Cell[])[]) => rows.map(row => row[2]);
const all = (query: Partial<TableQuery> = {}): TableQuery => ({ search: "", filters: new Map(), ...query });

describe("The results page's table engine", () => {
  it("shows a cell as its own text, and a missing value as nothing", () => {
    expect([cellText("=A + B"), cellText(12), cellText(0), cellText(""), cellText(undefined), cellText(null), cellText(-1.5)]).toEqual(["=A + B", "12", "0", "", "", "", "-1.5"]);
    // The dash the page greys is the one the app export writes where it has nothing to say: a plain hyphen.
    expect([NONE, REPORT_NONE]).toEqual(["-", "-"]);
  });

  it("names a row by its first cell that says something: the dash says nothing in an app's table, and is a name in a model's", () => {
    // In one of the app's files the dash is what the analysis writes where it has nothing to say: it names no row.
    expect([rowName(["Revenue", "Units * Price"], true), rowName(["", "Units * Price"], true), rowName([NONE, "", 12, "x"], true), rowName([0, "x"], true), rowName(["   ", "\n", "  name  "], true)])
      .toEqual(["Revenue", "Units * Price", "12", "0", "name"]);
    // No cell says anything: the row has no name of its own.
    expect([rowName([], true), rowName(["", NONE, "  "], true), rowName([], false), rowName(["", "  "], false)]).toEqual(["", "", "", ""]);
    // In a model's file the same dash is Anaplan's text, such as the name of a row that divides a list: a name like any other.
    expect([rowName([NONE, "", 12, "x"], false), rowName(["", NONE, "  "], false), rowName(["Revenue", NONE], false)]).toEqual([NONE, NONE, "Revenue"]);
    // A text is a name as it stands, markup and all; only one far longer than a name is cut, and marked as cut.
    expect(rowName(["<b>Q4</b> plan"], true)).toBe("<b>Q4</b> plan");
    const long = "x".repeat(ROW_NAME_MAX + 30);
    expect([rowName(["x".repeat(ROW_NAME_MAX)], true).length, rowName([long], true), ROW_NAME_MAX]).toEqual([ROW_NAME_MAX, `${"x".repeat(ROW_NAME_MAX)}…`, 120]);
  });

  it("keeps the file's rows and order when nothing is asked", () => {
    expect(selectRows(CARDS, all())).toEqual(CARDS);
    expect(selectRows([], all({ search: "x" }))).toEqual([]);
  });

  it("searches every column, whatever the case, numbers and IDs included", () => {
    expect(titles(selectRows(CARDS, all({ search: "SALES" })))).toEqual(["Sales by region", "sales value"]);
    expect(titles(selectRows(CARDS, all({ search: "  kpi " })))).toEqual(["Margin %"]);
    expect(titles(selectRows(CARDS, all({ search: "card-d" })))).toEqual(["Store plan"]);
    expect(titles(selectRows(CARDS, all({ search: "10" })))).toEqual(["How to use this page"]);
    expect(selectRows(CARDS, all({ search: "nothing like this" }))).toEqual([]);
    // Only spaces is no search. A search is plain text, not a pattern.
    expect(selectRows(CARDS, all({ search: "   " }))).toHaveLength(6);
    expect(titles(selectRows(CARDS, all({ search: "%" })))).toEqual(["Margin %"]);
    expect(selectRows(CARDS, all({ search: ".*" }))).toEqual([]);
  });

  it("shows a count with a comma between each three of its figures, the same wherever the page is opened, and anything else as it is", () => {
    expect(["15389009578", "2252068", "1000000", "123456", "12345", "1234", "999", "12", "1", "-1234567"].map(groupedCount))
      .toEqual(["15,389,009,578", "2,252,068", "1,000,000", "123,456", "12,345", "1,234", "999", "12", "1", "-1,234,567"]);
    // A count larger than a number holds exactly is grouped figure for figure: it is worked on as text.
    expect(groupedCount("123456789012345678901234567890")).toBe("123,456,789,012,345,678,901,234,567,890");
    // What is no whole number written as plain figures stays as it is: nothing, the dash, a word, a fraction, a number
    // already grouped or written otherwise, figures with spaces, and figures that begin with a zero, which are a code.
    const asItIs = ["", "0", NONE, "n/a", "12.5", "1234.5", "2,400", "1 234", " 1234", "1234 ", "+1234", "1e21", "0012", "007", "41+", "1234+", "١٢٣٤", "１２３４"];
    expect(asItIs.map(groupedCount)).toEqual(asItIs);
    // Whatever the browser's language: the grouping is the page's own, not the one the language would choose.
    expect(groupedCount("1234567")).not.toBe((1234567).toLocaleString("de-DE"));
  });

  it("finds a count as the table shows it, with its commas, and as the cell holds it, by its figures alone", () => {
    // Name, Cell Count: the counts arrive as text, as a model's grids give them.
    const modules: Cell[][] = [["REV01 Revenue", "15389009578"], ["COST01 Costs", "2252068"], ["SYS01 Settings", "12"], ["Archive 1,000", ""]];
    const names = (search: string, counts?: ReadonlySet<number>) => selectRows(modules, all({ search, counts })).map(row => row[0]);
    const counted = new Set([1]);
    // With or without its commas, whole or in part: as the user reads it, or as they type the figures.
    expect([names("15,389,009,578", counted), names("15389009578", counted), names("15,389", counted), names("9,578", counted), names("389009", counted)])
      .toEqual([["REV01 Revenue"], ["REV01 Revenue"], ["REV01 Revenue"], ["REV01 Revenue"], ["REV01 Revenue"]]);
    expect([names("2,252,068", counted), names("2252", counted), names(",252", counted)]).toEqual([["COST01 Costs"], ["COST01 Costs"], ["COST01 Costs"]]);
    // A grouping the count does not have finds nothing, and a comma alone finds what shows one: a grouped count, and a
    // name that holds one in its own text.
    expect([names("38,900", counted), names("1,5", counted), names(",", counted)]).toEqual([[], [], ["REV01 Revenue", "COST01 Costs", "Archive 1,000"]]);
    // Only a count's column is searched as it is shown. Another column is searched as its cells hold their text.
    expect([names("15,389"), names("15,389", new Set([0])), names("1,000", counted)]).toEqual([[], [], ["Archive 1,000"]]);
    // The cells are not changed by any of it, and a count's column still sorts by its numbers.
    expect(modules.map(row => row[1])).toEqual(["15389009578", "2252068", "12", ""]);
    expect(sortRows(modules, { column: 1, dir: "desc" }).map(row => row[0])).toEqual(["REV01 Revenue", "COST01 Costs", "SYS01 Settings", "Archive 1,000"]);
    // The memory of the last search tells a query whose counts are searched as shown from one whose are not.
    const select = rememberingSelect();
    expect([select(modules, all({ search: "15,389", counts: counted })).length, select(modules, all({ search: "15,389" })).length]).toEqual([1, 0]);
  });

  it("filters a column to the texts ticked, and several columns together", () => {
    expect(titles(selectRows(CARDS, all({ filters: new Map([[3, new Set(["Grid", "KPI"])]]) })))).toEqual(["Sales by region", "Margin %", "Store plan"]);
    expect(titles(selectRows(CARDS, all({ filters: new Map([[3, new Set(["Grid", "KPI"])], [0, new Set(["Stores"])]]) })))).toEqual(["Store plan"]);
    // A number is matched by its text, as the filter lists it.
    expect(titles(selectRows(CARDS, all({ filters: new Map([[1, new Set(["2"])]]) })))).toEqual(["Margin %", "sales value"]);
    // Nothing ticked shows nothing; a column with no filter shows every row.
    expect(selectRows(CARDS, all({ filters: new Map([[3, new Set<string>()]]) }))).toEqual([]);
    // A missing cell is the blank value.
    const ragged: Cell[][] = [["a", "x"], ["b"], ["c", ""]];
    expect(selectRows(ragged, all({ filters: new Map([[1, new Set([""])]]) }))).toEqual([["b"], ["c", ""]]);
  });

  it("filters a column whose cells list items by each item: a row shows when any of its items is ticked", () => {
    // Modules and what each applies to, as a model's grid writes them: names with a comma and a space between them. The
    // cells are cut as cell-lists.ts cuts them; a cell that is no list is one item, its whole text, the blank included.
    const modules: Cell[][] = [["Revenue", "Products, Regions, Time"], ["Cost", "Regions, Time"], ["Rates", "Products"], ["Notes", ""], ["Doubled", "Time, Time"]];
    const items: ItemsOf = text => (text.includes(", ") ? text.split(", ") : undefined);
    const lists = new Map([[1, items]]);
    const names = (rows: readonly (readonly Cell[])[]) => rows.map(row => row[0]);
    expect(names(selectRows(modules, all({ filters: new Map([[1, new Set(["Products"])]]), lists })))).toEqual(["Revenue", "Rates"]);
    expect(names(selectRows(modules, all({ filters: new Map([[1, new Set(["Regions", ""])]]), lists })))).toEqual(["Revenue", "Cost", "Notes"]);
    // Without the column's list, the filter reads the cell whole, as it always did.
    expect(names(selectRows(modules, all({ filters: new Map([[1, new Set(["Products"])]]) })))).toEqual(["Rates"]);
    // Its values are the items, each counted once for each row that lists it, however often the row lists it.
    expect(valueCounts(modules, 1, items)).toEqual([["", 1], ["Products", 2], ["Regions", 2], ["Time", 3]]);
    expect([filterItems(modules[4], 1, items), filterItems(modules[3], 1, items), filterItems(["x"], 1, items), filterItems(modules[2], 1, undefined)])
      .toEqual([["Time"], [""], [""], ["Products"]]);
  });

  it("keeps the rows of the page a jump names, then applies the search and the filters to them", () => {
    expect(titles(selectRows(CARDS, all({ context: { column: 0, value: "Stores" } })))).toEqual(["Store plan", "sales value"]);
    expect(titles(selectRows(CARDS, all({ context: { column: 0, value: "Stores" }, search: "sales" })))).toEqual(["sales value"]);
    expect(titles(selectRows(CARDS, all({ context: { column: 0, value: "Stores" }, filters: new Map([[3, new Set(["Grid"])]]) })))).toEqual(["Store plan"]);
    // The page's whole name, not a part of it.
    expect(selectRows(CARDS, all({ context: { column: 0, value: "Store" } }))).toEqual([]);
  });

  it("sorts numbers as numbers, in both directions, and leaves the rows it was given as they were", () => {
    const before = structuredClone(CARDS);
    expect(selectRows(CARDS, all({ sort: { column: 1, dir: "asc" } })).map(row => row[1])).toEqual([1, 1, 1, 2, 2, 10]);
    expect(selectRows(CARDS, all({ sort: { column: 1, dir: "desc" } })).map(row => row[1])).toEqual([10, 2, 2, 1, 1, 1]);
    expect(CARDS).toEqual(before);
  });

  it("keeps the file's order among rows that sort the same, in both directions", () => {
    expect(selectRows(CARDS, all({ sort: { column: 1, dir: "asc" } })).map(row => row[4])).toEqual(["card-a", "card-d", "card-f", "card-b", "card-e", "card-c"]);
    expect(selectRows(CARDS, all({ sort: { column: 1, dir: "desc" } })).map(row => row[4])).toEqual(["card-c", "card-b", "card-e", "card-a", "card-d", "card-f"]);
  });

  it("sorts text whatever its case, and a number inside a name by its value", () => {
    const lettered: Cell[][] = [["store plan"], ["Sales by region"], ["sales value"], ["Margin %"], ["how to use"]];
    expect(sortRows(lettered, { column: 0, dir: "asc" }).flat()).toEqual(["how to use", "Margin %", "Sales by region", "sales value", "store plan"]);
    const names: Cell[][] = [["Card 10"], ["card 2"], ["Card 1"], ["card 9"]];
    expect(sortRows(names, { column: 0, dir: "asc" }).flat()).toEqual(["Card 1", "card 2", "card 9", "Card 10"]);
    expect(sortRows(names, { column: 0, dir: "desc" }).flat()).toEqual(["Card 10", "card 9", "card 2", "Card 1"]);
  });

  it("sorts a model's numbers, which arrive as text, as numbers, blanks first", () => {
    const cells: Cell[][] = [["Revenue", "1200"], ["Units", "90"], ["Module", ""], ["Price", "13.5"], ["Loss", "-4"], ["Tax", "13.25"]];
    expect(sortRows(cells, { column: 1, dir: "asc" }).map(row => row[1])).toEqual(["", "-4", "13.25", "13.5", "90", "1200"]);
    expect(sortRows(cells, { column: 1, dir: "desc" }).map(row => row[1])).toEqual(["1200", "90", "13.5", "13.25", "-4", ""]);
  });

  it("sorts a column that mixes numbers and other text as text, by one rule for the whole column", () => {
    const sections: Cell[][] = [[2], ["1, 2 (shared rows)"], [10], ["-"], [1]];
    const sorted = sortRows(sections, { column: 0, dir: "asc" }).flat();
    expect(sorted.filter(cell => cell !== "-")).toEqual([1, "1, 2 (shared rows)", 2, 10]);
    expect(sortRows(sections, { column: 0, dir: "desc" }).flat()).toEqual([...sorted].reverse());
    // The same three cells in any order of arrival give the same order: no pair is compared by another rule.
    const tricky: Cell[] = ["1.5", "1.25", "1.10x"];
    const orders = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]].map(order => sortRows(order.map(index => [tricky[index]]), { column: 0, dir: "asc" }).flat());
    expect(new Set(orders.map(order => order.join(" < "))).size).toBe(1);
  });

  it("sorts on a column some rows do not have", () => {
    const ragged: Cell[][] = [["b", "2"], ["a"], ["c", "1"]];
    expect(sortRows(ragged, { column: 1, dir: "asc" })).toEqual([["a"], ["c", "1"], ["b", "2"]]);
  });

  it("sorts a column by the text a query gives for each row, where that is not its cell's: a time by the moment it names", () => {
    // New York's clocks went back an hour at 06:00 UTC on 1 November 2026: its clock read 01:30 twice. As the clock's text
    // the later moment would come first; by the UTC text that was read, as the moments run.
    const read = new Map<Cell[], string>();
    const row = (name: string, shown: string, utc: string): Cell[] => {
      const cells = [name, shown];
      read.set(cells, utc);
      return cells;
    };
    const rows = [row("first", "2026-11-01 01:30", "2026-11-01 05:30"), row("second", "2026-11-01 01:10", "2026-11-01 06:10"), row("never", "", "")];
    const sortKeys = new Map([[1, (cells: readonly Cell[]) => read.get(cells as Cell[]) ?? ""]]);
    expect([selectRows(rows, { search: "", filters: new Map(), sort: { column: 1, dir: "asc" }, sortKeys }).map(cells => cells[0]),
      selectRows(rows, { search: "", filters: new Map(), sort: { column: 1, dir: "asc" } }).map(cells => cells[0])])
      .toEqual([["never", "first", "second"], ["never", "second", "first"]]);
    // A key of figures alone is still text: the column is not taken for numbers.
    expect(sortRows([["a", "10"], ["b", "9"]], { column: 1, dir: "asc" }, cells => String(cells[1])).map(cells => cells[0])).toEqual(["b", "a"]);
  });

  it("searches, filters and sorts together", () => {
    const query = all({ search: "s", filters: new Map([[3, new Set(["Grid", "Chart", "Text"])]]), sort: { column: 2, dir: "desc" } });
    expect(titles(selectRows(CARDS, query))).toEqual(["Store plan", "sales value", "Sales by region", "How to use this page"]);
  });

  it("does not search and sort again for the same rows and an equal query, and does for any other", () => {
    const select = rememberingSelect();
    const filters = new Map([[3, new Set(["Grid", "KPI", "Text"])]]);
    const query = (): TableQuery => ({ search: "e", filters, sort: { column: 2, dir: "asc" } });
    const first = select(CARDS, query());
    // Several rows, so that an order shows.
    expect(titles(first)).toEqual(["How to use this page", "Margin %", "Sales by region", "Store plan"]);
    // Turning a page asks again with an equal query: the very same list comes back.
    expect(select(CARDS, query())).toBe(first);
    // Each part of the query counts. Every other query is asked straight after the first one, which is what is remembered
    // then, and each gives other rows or another order than it: a part left out of what is compared would show here.
    const others: Partial<TableQuery>[] = [{ search: "sa" }, { sort: { column: 2, dir: "desc" } }, { sort: { column: 1, dir: "asc" } }, { sort: undefined },
      { context: { column: 0, value: "Stores" } }, { filters: new Map([[3, new Set(["Grid"])]]) }, { filters: new Map() },
      { ranges: new Map([[1, { kind: "number", from: 2, blanks: true, none: true }]]) }];
    for (const changed of others) {
      const base = select(CARDS, query());
      const other = select(CARDS, { ...query(), ...changed });
      expect(other, JSON.stringify(changed)).not.toBe(base);
      expect(titles(other), JSON.stringify(changed)).toEqual(titles(selectRows(CARDS, { ...query(), ...changed })));
      expect(titles(other), JSON.stringify(changed)).not.toEqual(titles(base));
    }
    expect(titles(select(CARDS, { ...query(), sort: { column: 2, dir: "desc" } }))).toEqual(["Store plan", "Sales by region", "Margin %", "How to use this page"]);
    // A jump is told from another jump, too.
    const stores = select(CARDS, { ...query(), context: { column: 0, value: "Stores" } });
    expect([titles(stores), titles(select(CARDS, { ...query(), context: { column: 0, value: "Overview" } }))]).toEqual([["Store plan"], ["How to use this page", "Margin %", "Sales by region"]]);
    // So does a box ticked in a filter that stays the same object.
    const before = select(CARDS, query());
    filters.get(3)?.delete("Text");
    expect(titles(select(CARDS, query()))).toEqual(["Margin %", "Sales by region", "Store plan"]);
    expect(select(CARDS, query())).not.toBe(before);
    // Other rows are another table, even with an equal query.
    expect(titles(select(CARDS.slice(0, 2), query()))).toEqual(["Margin %", "Sales by region"]);
    expect(select(CARDS.slice(0, 2), query())).not.toBe(select(CARDS.slice(0, 2), query()));
    // Each table view keeps its own memory.
    expect(rememberingSelect()(CARDS, query())).not.toBe(select(CARDS, query()));
  });

  it("cuts the rows into pages and says which rows a page shows", () => {
    const rows = Array.from({ length: 120 }, (_, index) => [index]);
    expect(pageOf(rows, 0, 50)).toMatchObject({ page: 0, pages: 3, from: 1, to: 50, total: 120 });
    expect(pageOf(rows, 0, 50).rows).toEqual(rows.slice(0, 50));
    expect(pageOf(rows, 2, 50)).toMatchObject({ page: 2, pages: 3, from: 101, to: 120, total: 120 });
    expect(pageOf(rows, 2, 50).rows).toEqual(rows.slice(100));
    expect(pageOf(rows, 1, 25)).toMatchObject({ page: 1, pages: 5, from: 26, to: 50 });
    expect(pageOf(rows.slice(0, 100), 1, 50)).toMatchObject({ page: 1, pages: 2, from: 51, to: 100 });
  });

  it("stays on a page that exists when the rows get fewer or the page asked for is no page", () => {
    const rows = Array.from({ length: 60 }, (_, index) => [index]);
    expect(pageOf(rows, 7, 50)).toMatchObject({ page: 1, pages: 2, from: 51, to: 60 });
    expect(pageOf(rows, -1, 50)).toMatchObject({ page: 0, from: 1, to: 50 });
    expect(pageOf(rows, Number.NaN, 50)).toMatchObject({ page: 0, from: 1, to: 50 });
    expect(pageOf(rows, 1.5, 50)).toMatchObject({ page: 0, from: 1, to: 50 });
    expect(pageOf([], 3, 50)).toEqual({ rows: [], page: 0, pages: 1, from: 0, to: 0, total: 0 });
  });

  it("lists what a column holds for its filter: each text once, with its number of rows, in text order", () => {
    expect(valueCounts(CARDS, 3)).toEqual([["Action", 1], ["Chart", 1], ["Grid", 2], ["KPI", 1], ["Text", 1]]);
    expect(valueCounts(CARDS, 1)).toEqual([["1", 3], ["2", 2], ["10", 1]]);
    expect(valueCounts([["a", ""], ["b"], ["c", "x"]], 1)).toEqual([["", 2], ["x", 1]]);
    // Texts that differ only in case are two values, always in the same order.
    expect(valueCounts([["b"], ["B"], ["a"], ["b"]], 0)).toEqual([["a", 1], ["B", 1], ["b", 2]]);
  });

  it("reads a number as a cell or a filter's box writes it: a sign, its thousands apart or not, a fraction, a percent sign", () => {
    expect(["12", "1,582", "15,389,009,578", "-3.5", "+7", "40%", "0", "0.25", " 9 "].map(numberOf)).toEqual([12, 1582, 15389009578, -3.5, 7, 40, 0, 0.25, 9]);
    // No number: a word; figures that begin with a zero, which are a code; thousands set apart wrongly, or by a space; a
    // comma for a point; two points; nothing; the dash; a date.
    expect(["twelve", "007", "0040", "1,58", "12,5", "1 582", "1.2.3", "", "-", "2026-03-12"].map(numberOf)).toEqual(Array(10).fill(undefined));
  });

  it("reads a date by the day it names, at any time of it, and only a day the calendar has", () => {
    expect(["1970-01-01", "1970-01-02", "2026-03-12", "2026-03-12 23:19:56", "2026-03-12T00:00:00Z", "2026-03-12T08:30+05:30"].map(dayOf)).toEqual([0, 1, 20524, 20524, 20524, 20524]);
    expect(["2026-02-30", "2026-13-01", "12/03/2026", "2026-3-12", "yesterday", "20524", ""].map(dayOf)).toEqual(Array(7).fill(undefined));
    // A day back as a date's text, which a box for a date shows and takes.
    expect([dayText(0), dayText(20524)]).toEqual(["1970-01-01", "2026-03-12"]);
    // A cell says nothing when it is empty, and, where the table's dash says so, when it is the dash.
    expect([saysNothing(" ", false), saysNothing("-", true), saysNothing("-", false), saysNothing(" - ", true), saysNothing("-5", true)]).toEqual([true, true, false, true, false]);
  });

  it("keeps the rows within a range of numbers, either end open, both ends kept, and the cells that say nothing only where the range keeps them", () => {
    // A source model, its Sources and its Imports, as Source Models lists them: a blank, a dash and a thousand among them.
    const rows: Cell[][] = [["A", "113", "113"], ["B", "10", "10"], ["C", "12", "14"], ["D", "9", "9"], ["E", "", "-"], ["F", "1,000", "2"]];
    const range = (from?: number, to?: number, blanks = true, none = false): RangeQuery => ({ kind: "number", from, to, blanks, none });
    const names = (...ranges: [number, RangeQuery][]) => selectRows(rows, all({ ranges: new Map(ranges) })).map(row => row[0]);
    expect(names([1, range(10, 113)])).toEqual(["A", "B", "C", "E"]);
    // An open end: at least ten, a thousand among them; at most ten.
    expect([names([1, range(10)]), names([1, range(undefined, 10)])]).toEqual([["A", "B", "C", "E", "F"], ["B", "D", "E"]]);
    // One number, and no blank.
    expect(names([1, range(12, 12, false)])).toEqual(["C"]);
    // Only the blank left out: an empty cell; the dash where the table's dash says nothing, and, in a model's table, where
    // it is no number either, which a range cannot place.
    expect([names([1, range(undefined, undefined, false)]), names([2, range(undefined, undefined, false, true)]), names([2, range(undefined, undefined, false, false)])])
      .toEqual([["A", "B", "C", "D", "F"], ["A", "B", "C", "D", "F"], ["A", "B", "C", "D", "F"]]);
    // Two ranges narrow each other; a blank kept by both stays.
    expect(names([1, range(9, 12)], [2, range(10)])).toEqual(["B", "C", "E"]);
    // A range works with a list's filter, the search and the sort, after them.
    expect(selectRows(rows, all({ search: "1", filters: new Map([[0, new Set(["A", "B", "C", "F"])]]), ranges: new Map([[2, range(undefined, 100)]]), sort: { column: 0, dir: "desc" } }))
      .map(row => row[0])).toEqual(["F", "C", "B"]);
  });

  it("keeps the rows within a range of dates by whole days, at any time of each day", () => {
    const rows: Cell[][] = [["Load", "2026-03-12 23:19:56"], ["Sort", "2026-03-13 00:00:01"], ["Old", "2025-12-31 12:00:00"], ["Never", ""]];
    const range = (from?: string, to?: string, blanks = true): RangeQuery => ({ kind: "date", from: from === undefined ? undefined : dayOf(from), to: to === undefined ? undefined : dayOf(to), blanks, none: false });
    const names = (query: RangeQuery) => selectRows(rows, all({ ranges: new Map([[1, query]]) })).map(row => row[0]);
    expect([names(range("2026-03-12", "2026-03-12")), names(range("2026-01-01", undefined, false)), names(range(undefined, "2026-03-12", false))])
      .toEqual([["Load", "Never"], ["Load", "Sort"], ["Load", "Old"]]);
  });

  it("reads a column for its range once: each row's value, the lowest and the highest with the text of their cells, and how many say nothing", () => {
    const rows: Cell[][] = [["a", "1,582"], ["b", "-"], ["c", "-3.5"], ["d", ""], ["e", 15389009578]];
    const read = rangeColumn(rows, 1, "number", true);
    expect([[...read.values.values()], read.lowest, read.highest, read.blanks])
      .toEqual([[1582, undefined, -3.5, undefined, 15389009578], { value: -3.5, text: "-3.5" }, { value: 15389009578, text: "15389009578" }, 2]);
    // A column of nothing but blanks has no lowest and no highest.
    const blank: Cell[][] = [["a", ""], ["b", "-"]];
    expect(rangeColumn(blank, 1, "number", true)).toEqual({ values: new Map([[blank[0], undefined], [blank[1], undefined]]), blanks: 2 });
    // A range given the column read keeps rows by what was read, and does not read the cells again: here what was read says
    // that the first row holds 5.
    const values = new Map(read.values);
    values.set(rows[0], 5);
    expect(selectRows(rows, all({ ranges: new Map([[1, { kind: "number", from: 4, to: 6, blanks: false, none: true, values }]]) })).map(row => row[0])).toEqual(["a"]);
  });
});
