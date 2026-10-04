import { describe, expect, it } from "vitest";
import { NONE as REPORT_NONE } from "../report.js";
import type { Cell } from "../result-types.js";
import { cellText, NONE, pageOf, pagerItems, rememberingSelect, ROW_NAME_MAX, rowName, selectRows, sortRows, valueCounts, type TableQuery } from "./table-engine.js";

// Page, Card #, Card title, Card type, Card ID
const CARDS: Cell[][] = [
  ["Overview", 1, "Sales by region", "Grid", "card-a"],
  ["Overview", 2, "Margin %", "KPI", "card-b"],
  ["Overview", 10, "How to use this page", "Text", "card-c"],
  ["Stores", 1, "Store plan", "Grid", "card-d"],
  ["Stores", 2, "sales value", "Chart", "card-e"],
  ["Admin", 1, "—", "Action", "card-f"],
];
const titles = (rows: readonly (readonly Cell[])[]) => rows.map(row => row[2]);
const all = (query: Partial<TableQuery> = {}): TableQuery => ({ search: "", filters: new Map(), ...query });

describe("The results page's table engine", () => {
  it("shows a cell as its own text, and a missing value as nothing", () => {
    expect([cellText("=A + B"), cellText(12), cellText(0), cellText(""), cellText(undefined), cellText(null), cellText(-1.5)]).toEqual(["=A + B", "12", "0", "", "", "", "-1.5"]);
    // The dash the page greys is the one the app export writes where it has nothing to say.
    expect(NONE).toBe(REPORT_NONE);
  });

  it("names a row by its first cell that says something", () => {
    expect([rowName(["Revenue", "Units * Price"]), rowName(["", "Units * Price"]), rowName(["—", "", 12, "x"]), rowName([0, "x"]), rowName(["   ", "\n", "  name  "])])
      .toEqual(["Revenue", "Units * Price", "12", "0", "name"]);
    // No cell says anything: the row has no name of its own.
    expect([rowName([]), rowName(["", "—", "  "])]).toEqual(["", ""]);
    // A text is a name as it stands, markup and all; only one far longer than a name is cut, and marked as cut.
    expect(rowName(["<b>Q4</b> plan"])).toBe("<b>Q4</b> plan");
    const long = "x".repeat(ROW_NAME_MAX + 30);
    expect([rowName(["x".repeat(ROW_NAME_MAX)]).length, rowName([long]), ROW_NAME_MAX]).toEqual([ROW_NAME_MAX, `${"x".repeat(ROW_NAME_MAX)}…`, 120]);
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
    const sections: Cell[][] = [[2], ["1, 2 (shared rows)"], [10], ["—"], [1]];
    const sorted = sortRows(sections, { column: 0, dir: "asc" }).flat();
    expect(sorted.filter(cell => cell !== "—")).toEqual([1, "1, 2 (shared rows)", 2, 10]);
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

  it("searches, filters and sorts together", () => {
    const query = all({ search: "s", filters: new Map([[3, new Set(["Grid", "Chart", "Text"])]]), sort: { column: 2, dir: "desc" } });
    expect(titles(selectRows(CARDS, query))).toEqual(["Store plan", "sales value", "Sales by region", "How to use this page"]);
  });

  it("does not search and sort again for the same rows and an equal query, and does for any other", () => {
    const select = rememberingSelect();
    const filters = new Map([[3, new Set(["Grid", "KPI"])]]);
    const query = (): TableQuery => ({ search: "s", filters, sort: { column: 2, dir: "asc" }, context: { column: 0, value: "Overview" } });
    const first = select(CARDS, query());
    expect(titles(first)).toEqual(["Sales by region"]);
    // Turning a page asks again with an equal query: the very same list comes back.
    expect(select(CARDS, query())).toBe(first);
    // Each part of the query counts, and so does a box ticked in a filter that stays the same object.
    for (const changed of [{ search: "sa" }, { sort: { column: 2, dir: "desc" as const } }, { sort: undefined }, { context: { column: 0, value: "Stores" } }, { context: undefined },
      { filters: new Map([[3, new Set(["Grid"])]]) }, { filters: new Map() }]) {
      const other = select(CARDS, { ...query(), ...changed });
      expect(other, JSON.stringify(changed)).not.toBe(first);
      expect(other).toEqual(selectRows(CARDS, { ...query(), ...changed }));
    }
    const before = select(CARDS, query());
    filters.get(3)?.add("Text");
    expect(titles(select(CARDS, query()))).toEqual(["How to use this page", "Sales by region"]);
    expect(select(CARDS, query())).not.toBe(before);
    // Other rows are another table, even with an equal query.
    expect(titles(select(CARDS.slice(0, 1), query()))).toEqual(["Sales by region"]);
    expect(select(CARDS.slice(0, 1), query())).not.toBe(select(CARDS.slice(0, 1), query()));
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

  it("offers every page number up to seven pages, and otherwise the ends and the pages around the current one", () => {
    expect(pagerItems(0, 1)).toEqual([0]);
    expect(pagerItems(3, 7)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(pagerItems(0, 8)).toEqual([0, 1, undefined, 7]);
    expect(pagerItems(0, 20)).toEqual([0, 1, undefined, 19]);
    expect(pagerItems(1, 20)).toEqual([0, 1, 2, undefined, 19]);
    expect(pagerItems(10, 20)).toEqual([0, undefined, 9, 10, 11, undefined, 19]);
    expect(pagerItems(18, 20)).toEqual([0, undefined, 17, 18, 19]);
    expect(pagerItems(19, 20)).toEqual([0, undefined, 18, 19]);
  });

  it("lists what a column holds for its filter: each text once, with its number of rows, in text order", () => {
    expect(valueCounts(CARDS, 3)).toEqual([["Action", 1], ["Chart", 1], ["Grid", 2], ["KPI", 1], ["Text", 1]]);
    expect(valueCounts(CARDS, 1)).toEqual([["1", 3], ["2", 2], ["10", 1]]);
    expect(valueCounts([["a", ""], ["b"], ["c", "x"]], 1)).toEqual([["", 2], ["x", 1]]);
    // Texts that differ only in case are two values, always in the same order.
    expect(valueCounts([["b"], ["B"], ["a"], ["b"]], 0)).toEqual([["a", 1], ["B", 1], ["b", 2]]);
  });
});
