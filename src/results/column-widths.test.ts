import { describe, expect, it } from "vitest";
import type { Cell, ResultTable } from "../result-types.js";
import { columnWidths, headerWidth, textWidth, WIDEST } from "./column-widths.js";
import { columnsOf, type Column } from "./columns.js";
import { NONE, pageOf, selectRows, sortRows } from "./table-engine.js";

// The widths the results page gives a table's columns: worked out once from every row of the table, so that what is
// shown of the table, a page of it, in some order, under a search or a filter, cannot move its columns.

const column = (index: number, label: string, kind: Column["kind"] = "text", extra: Partial<Column> = {}): Column =>
  ({ index, label, kind, num: false, filter: false, hidden: false, ...extra });
/** What a user can type into a name, a formula or a note. */
const HOSTILE = ["<img src=x onerror=alert(1)>", "Bob's \"<b>Q4</b>\" plan", "\" onmouseover=\"alert(1)\" data-act=\"", "</td></tr></table><!-- ", "&lt;b&gt; &amp;amp;"];

/** A model's Line Items file, 120 rows long, whose longest texts are far down it: on the last of three pages, and on
 * rows a search for "revenue" leaves out. */
const LINES: ResultTable = {
  file: "Line Items.csv", label: "Line Items", headers: ["", "Format", "Formula", "Cell Count"], guard: false,
  rows: Array.from({ length: 120 }, (_, index): Cell[] => [
    index === 110 ? "Line item with a name far longer than the others" : `Line item ${index + 1}`, ["Number", "Text", "Boolean"][index % 3],
    index === 95 ? "IF Units > 0 THEN Units * Price * (1 + Uplift) ELSE 0" : index < 60 ? "Revenue" : "Cost", String(index * 7919 % 100000)]),
};

describe("The widths of a table's columns", () => {
  it("makes a column as wide as the widest of its cells among all the table's rows, whatever is on screen and in whatever order", () => {
    const columns = columnsOf(LINES);
    const widths = columnWidths(columns, LINES.rows);
    // One width for each column, by its place in the headers.
    expect([...widths.keys()]).toEqual([0, 1, 2, 3]);
    // The same widths from the rows in any order: a sort, either way, by any column.
    for (const [sortColumn, dir] of [[0, "asc"], [0, "desc"], [2, "asc"], [3, "desc"]] as const) {
      expect(columnWidths(columns, sortRows(LINES.rows, { column: sortColumn, dir }))).toEqual(widths);
    }
    // The long name and the long formula, far down the table, make their columns wider than the first page's rows alone
    // would: a table laid out by the rows on screen would have them change from page to page. The page measures all of
    // them, and gives the table the same widths on every page, and under any search or filter.
    const firstPage = pageOf(LINES.rows, 0, 50).rows;
    const searched = selectRows(LINES.rows, { search: "revenue", filters: new Map() });
    expect(columnWidths(columns, firstPage).get(0)).toBeLessThan(widths.get(0) ?? 0);
    expect(columnWidths(columns, searched).get(2)).toBeLessThan(widths.get(2) ?? 0);
    // A longer text is a wider column: the long formula's, then the long name's, then the formats'.
    expect([widths.get(2) ?? 0, widths.get(0) ?? 0, widths.get(1) ?? 0].every((width, index, all) => index === 0 || width < all[index - 1])).toBe(true);
  });

  it("gives every column at least its header's room: its name in capitals, the sort arrow's room and the filter button's", () => {
    // A column without rows, or whose cells are all short, is as wide as its header needs.
    const short = [column(0, "Applies To from"), column(1, "Applies To from", "text", { filter: true }), column(2, "ID")];
    const widths = columnWidths(short, [["x", "x", "x"]]);
    expect(short.map(entry => widths.get(entry.index))).toEqual(short.map(headerWidth));
    expect(columnWidths(short, [])).toEqual(widths);
    // The filter button takes room of its own; a longer name takes more. Even a header without a name has room for its
    // padding and the sort arrow, which a header keeps whether its column is sorted or not: a column is given its width
    // from its header and its cells, and from nothing about a sort. (markup.test.ts holds the header's markup to the same.)
    expect(headerWidth(short[1])).toBeGreaterThan(headerWidth(short[0]));
    expect(headerWidth(short[0])).toBeGreaterThan(headerWidth(short[2]));
    expect(headerWidth(column(0, ""))).toBe(7);
  });

  it("keeps a column to the widest a column gets, about the 340px the design gives one, and a text far longer than that measured only as far", () => {
    const formula = "IF ".repeat(7000);
    const widths = columnWidths([column(0, "Formula"), column(1, "A header far, far longer than any column of the table could ever be given")], [[formula, "x"]]);
    expect([widths.get(0), widths.get(1), WIDEST]).toEqual([WIDEST, WIDEST, 50]);
    expect(textWidth(formula, 20)).toBe(20);
    // A table of many thousands of rows, as a model's Line Items can be, is measured quickly: once a column is as wide as
    // a column gets, its other cells are not looked at, and a cell shorter than the widest so far is not measured.
    const rows = Array.from({ length: 200_000 }, (_, index): Cell[] => [`Line item ${index}`, formula, index % 7 ? "Number" : "Boolean", String(index * 31)]);
    const started = performance.now();
    const many = columnWidths(columnsOf({ ...LINES, rows }), rows);
    expect(performance.now() - started).toBeLessThan(1000);
    expect(many.get(1)).toBe(WIDEST);
  });

  it("measures each cell as its column shows it: a text, a tag, an ID in its pill, a count with its commas, and colours with their squares", () => {
    const width = (kind: Column["kind"], text: Cell) => columnWidths([column(0, "X", kind)], [[text]]).get(0);
    // A tag and an ID's pill take room besides their text; a pill is no wider than its 180px, however long its ID.
    expect(width("tag", "Text & image cards")).toBeGreaterThan(width("text", "Text & image cards") ?? Infinity);
    expect(width("id", "card-0123456789")).toBeGreaterThan(width("text", "card-0123456789") ?? Infinity);
    expect(width("id", "x".repeat(400))).toBeLessThan(WIDEST);
    // A count is as wide as it is shown, with its commas, and a number of the app's tables is measured as its text.
    expect(width("count", "15389009578")).toBe(width("text", "15,389,009,578"));
    expect(width("count", 1234567)).toBe(width("text", "1,234,567"));
    expect(width("count", "n/a")).toBe(width("text", "n/a"));
    // A rule's colour stops have a square before each colour's code, and each square takes room.
    const stops = "#FFFFFF at 0; #F9E95C at 50; #1F46B4 at 100";
    expect((width("colours", stops) ?? 0) - (width("text", stops) ?? 0)).toBeGreaterThanOrEqual(6);
    expect(width("colours", "Background")).toBe(width("text", "Background"));
    // An empty cell and the dash need no more than the header.
    expect([width("text", ""), width("id", NONE)]).toEqual([headerWidth(column(0, "X")), headerWidth(column(0, "X"))]);
  });

  it("estimates a text's width by its letters, in ch: a figure is 1ch, and capitals and wide letters take more than narrow ones", () => {
    expect([textWidth(""), textWidth("0123456789"), textWidth("15,389,009,578")]).toEqual([0, 10, 12.5]);
    expect(textWidth("iiiiiiiiii")).toBeLessThan(textWidth("nnnnnnnnnn"));
    expect(textWidth("nnnnnnnnnn")).toBeLessThan(textWidth("NNNNNNNNNN"));
    expect(textWidth("NNNNNNNNNN")).toBeLessThan(textWidth("WWWWWWWWWW"));
    // A letter of another alphabet is counted a little wider than a figure, and a Chinese or Japanese character, which is
    // about as wide as two, as two.
    expect(textWidth("日本語")).toBe(6);
    expect(textWidth("ÄÖÜ")).toBeCloseTo(3.3);
  });

  it("gives whole numbers of ch and nothing else, whatever the texts hold", () => {
    const columns = HOSTILE.map((text, index) => column(index, text, (["text", "id", "tag", "page", "count"] as const)[index]));
    const widths = columnWidths(columns, [HOSTILE, [...HOSTILE].reverse(), HOSTILE.map(text => text.repeat(9))]);
    expect([...widths.values()].filter(width => !Number.isInteger(width) || width < 1 || width > WIDEST)).toEqual([]);
    expect(widths.size).toBe(HOSTILE.length);
  });
});
