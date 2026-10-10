import { describe, expect, it } from "vitest";
import type { RangeState } from "./range-filter.js";
import {
  columnKeys, findRow, forgetKept, isMapAtStart, isPlain, keepTable, keptText, MAX_VIEW_CHARS, objectKey, readKept, rowKey, subjectOf, takeTable, VIEW_KEY,
  writeKept, type KeptView, type TableLooks, type ViewStorage,
} from "./view-keep.js";

/** A table's columns as the page holds them: by place, label, whether its filter is a range, and whether it starts hidden. */
const COLUMNS: TableLooks["columns"] = [
  { index: 0, label: "Name", hidden: false },
  { index: 1, label: "Format", hidden: false },
  { index: 2, label: "Cell Count", range: "number", hidden: false },
  { index: 3, label: "Notes", hidden: false },
  { index: 4, label: "Notes", hidden: false },
  { index: 5, label: "Line item ID", hidden: true },
];
/** The values each column's filter lists. */
const VALUES: Record<number, string[]> = { 1: ["Boolean", "Number", "Text", "Date"], 3: ["a", "b"], 4: ["x", "y", "z"] };
const valuesOf = (column: number): string[] => VALUES[column] ?? [];
const looks = (over: Partial<TableLooks> = {}): TableLooks => ({ columns: COLUMNS, filters: new Map(), ranges: new Map(), hidden: new Set([5]), sort: undefined, page: 0, ...over });
const range = (fromText: string, toText: string, blanks = true): RangeState => ({ fromText, toText, ...(fromText ? { from: Number(fromText) } : {}), ...(toText ? { to: Number(toText) } : {}), blanks });

/** A tab's session storage: what it holds, and the error it throws on every call, where it is set to. */
function storage(throws?: string): ViewStorage & { held: Map<string, string> } {
  const held = new Map<string, string>();
  const fail = () => { if (throws) throw Object.assign(new Error(throws), { name: throws }); };
  return {
    held,
    getItem: key => { fail(); return held.get(key) ?? null; },
    setItem: (key, value) => { fail(); held.set(key, value); },
    removeItem: key => { fail(); held.delete(key); },
  };
}

describe("What the tab keeps of how a result is looked at", () => {
  it("names a result by its kind and ID, a column by its label, and a second column of one label by which of them it is", () => {
    expect(subjectOf({ kind: "model", id: "ABC" })).toBe("model:ABC");
    expect(columnKeys(COLUMNS)).toEqual(["Name", "Format", "Cell Count", "Notes", "Notes #2", "Line item ID"]);
  });

  it("knows a row by what it holds, and finds it again only where no other row holds the same", () => {
    const rows = [["Revenue", "Number", 1], ["Cost", "Number", 2], ["Cost", "Number", 2], ["Margin", "Number", null]];
    expect(rowKey(rows[0])).toBe(rowKey(["Revenue", "Number", "1"]));
    expect(rowKey(rows[0])).not.toBe(rowKey(rows[3]));
    // Cells are told apart: "a" then "bc" is not "ab" then "c", and a row of more cells is another row.
    expect(rowKey(["a", "bc"])).not.toBe(rowKey(["ab", "c"]));
    expect(rowKey(["a"])).not.toBe(rowKey(["a", ""]));
    expect([findRow(rows, rowKey(rows[0])), findRow(rows, rowKey(rows[1])), findRow(rows, rowKey(["Gone"]))]).toEqual([rows[0], undefined, undefined]);
  });

  it("keeps nothing of a table as the page starts it, and a table's choices by its columns' names", () => {
    expect(keepTable(looks(), valuesOf)).toBeUndefined();
    const kept = keepTable(looks({
      // Format: one of four ticked, kept as that one; Notes #2: two of three ticked, kept as the one left out.
      filters: new Map([[1, new Set(["Number"])], [4, new Set(["x", "y"])]]),
      ranges: new Map([[2, range("10", "")]]),
      // Notes hidden, which starts shown; the ID shown, which starts hidden.
      hidden: new Set([3]),
      sort: { column: 4, dir: "desc" },
      page: 2,
    }), valuesOf);
    expect(kept).toEqual({
      filters: { Format: { t: ["Number"] }, "Notes #2": { u: ["z"] } },
      ranges: { "Cell Count": { from: "10", to: "", blanks: true } },
      shown: ["Line item ID"], hidden: ["Notes"],
      sort: { column: "Notes #2", dir: "desc" },
      page: 2,
    });
  });

  it("takes a table's choices back onto a table of other columns: what fits, by name, and nothing else", () => {
    const kept = keepTable(looks({
      filters: new Map([[1, new Set(["Number"])], [3, new Set(["a"])]]),
      ranges: new Map([[2, range("10", "20", false)]]), hidden: new Set([3, 5]), sort: { column: 1, dir: "asc" }, page: 1,
    }), valuesOf)!;
    // The same table: the same choices.
    expect(takeTable(kept, COLUMNS, valuesOf)).toEqual({
      filters: new Map([[1, new Set(["Number"])], [3, new Set(["a"])]]), ranges: new Map([[2, range("10", "20", false)]]), hidden: new Set([3, 5]), sort: { column: 1, dir: "asc" }, page: 1,
    });
    // A new run: Format is now the third column and lists a new value; Notes has gone; Cell Count is a column of text now;
    // and a column the settings never saw starts as the page starts it.
    const later: TableLooks["columns"] = [
      { index: 0, label: "Name", hidden: false }, { index: 1, label: "Cell Count", hidden: false }, { index: 2, label: "Format", hidden: false }, { index: 3, label: "Code", hidden: true },
    ];
    const laterValues = (column: number): string[] => (column === 2 ? ["Number", "Text", "Time Period"] : column === 1 ? ["12", "x"] : []);
    expect(takeTable(kept, later, laterValues)).toEqual({ filters: new Map([[2, new Set(["Number"])]]), ranges: new Map(), hidden: new Set([3]), sort: { column: 2, dir: "asc" }, page: 1 });
  });

  it("lets a new value in where the filter was kept as the values left out, and not where it was kept as the values ticked", () => {
    const columns: TableLooks["columns"] = [{ index: 0, label: "Format", hidden: false }];
    const before = (): string[] => ["Boolean", "Number", "Text"];
    const after = (): string[] => ["Boolean", "Number", "Text", "Date"];
    const leftOut = keepTable({ ...looks(), columns, hidden: new Set(), filters: new Map([[0, new Set(["Boolean", "Number"])]]) }, before)!;
    const ticked = keepTable({ ...looks(), columns, hidden: new Set(), filters: new Map([[0, new Set(["Text"])]]) }, before)!;
    expect([leftOut.filters, ticked.filters]).toEqual([{ Format: { u: ["Text"] } }, { Format: { t: ["Text"] } }]);
    expect(takeTable(leftOut, columns, after).filters).toEqual(new Map([[0, new Set(["Boolean", "Number", "Date"])]]));
    expect(takeTable(ticked, columns, after).filters).toEqual(new Map([[0, new Set(["Text"])]]));
    // A filter that would keep every value the column has now is no filter.
    expect(takeTable({ filters: { Format: { u: ["Gone"] } } }, columns, after).filters).toEqual(new Map());
  });

  it("keeps a column of times by the file's name for it in either zone, and a range of its days with the zone they were set in", () => {
    // Shown in the viewer's zone, the column's header names the zone; it is kept as the file names it, and taken back in UTC.
    const local: TableLooks["columns"] = [{ index: 0, label: "Name", hidden: false }, { index: 1, label: "Start Date and Time (Asia/Tokyo)", range: "date", hidden: false }];
    const utc: TableLooks["columns"] = [local[0], { ...local[1], label: "Start Date and Time (UTC)" }];
    expect([columnKeys(local, "Asia/Tokyo"), columnKeys(local)]).toEqual([["Name", "Start Date and Time (UTC)"], ["Name", "Start Date and Time (Asia/Tokyo)"]]);
    const set: RangeState = { fromText: "2026-03-13", toText: "", from: Date.parse("2026-03-13T00:00:00Z") / 86_400_000, blanks: true, zone: "Asia/Tokyo" };
    const kept = keepTable({ ...looks(), columns: local, hidden: new Set(), ranges: new Map([[1, set]]), sort: { column: 1, dir: "desc" } }, () => [], "Asia/Tokyo")!;
    expect(kept).toEqual({ ranges: { "Start Date and Time (UTC)": { from: "2026-03-13", to: "", blanks: true, zone: "Asia/Tokyo" } }, sort: { column: "Start Date and Time (UTC)", dir: "desc" } });
    const taken = takeTable(kept, utc, () => [], "Asia/Tokyo");
    expect([taken.ranges.get(1), taken.sort, takeTable(kept, local, () => [], "Asia/Tokyo").ranges.get(1)]).toEqual([set, { column: 1, dir: "desc" }, set]);
    // A range of another column, with no zone, is kept and taken back without one.
    expect(takeTable({ ranges: { "Start Date and Time (UTC)": { from: "2026-03-13", to: "", blanks: true } } }, utc, () => []).ranges.get(1)?.zone).toBeUndefined();
  });

  it("lets a range go whose ends cannot be read for the column, or that keeps every row", () => {
    const columns: TableLooks["columns"] = [{ index: 0, label: "Count", range: "number", hidden: false }, { index: 1, label: "When", range: "date", hidden: false }];
    const taken = takeTable({ ranges: { Count: { from: "ten", to: "", blanks: true }, When: { from: "", to: "", blanks: true } } }, columns, () => []);
    expect(taken.ranges).toEqual(new Map());
    expect(takeTable({ ranges: { When: { from: "2026-01-01", to: "", blanks: false } } }, columns, () => []).ranges.get(1)?.fromText).toBe("2026-01-01");
  });

  it("reads back only what has the shape the page writes, each part on its own", () => {
    const tab = storage();
    expect(readKept(tab)).toBeUndefined();
    tab.held.set(VIEW_KEY, "not JSON");
    expect(readKept(tab)).toBeUndefined();
    tab.held.set(VIEW_KEY, JSON.stringify({ tables: {} }));
    expect(readKept(tab)).toBeUndefined();
    tab.held.set(VIEW_KEY, JSON.stringify({
      subject: "model:ABC", pageSize: 30, everyUse: "yes", search: { view: "2", text: "rev", context: 4 },
      tables: { "Line Items.csv": { filters: { Format: { t: ["Number"] }, Bad: { t: [1] } }, ranges: { Count: { from: "1", to: "", blanks: "no" },
        Started: { from: "2026-03-13", to: "", blanks: true, zone: "Asia/Tokyo" }, Ended: { from: "2026-03-14", to: "", blanks: true, zone: 9 } },
        sort: { column: "Format", dir: "up" }, page: -1, hidden: ["Notes"] }, Odd: 3 },
      map: { view: "drill", module: "Revenue", others: true, access: "yes" }, drawer: { kind: "row", file: "Line Items.csv", key: "3:abc" },
    }));
    // A range's zone is read where it is a name, and left out where it is not: the range stays, set in no zone.
    expect(readKept(tab)).toEqual({
      subject: "model:ABC", search: { view: "2", text: "rev" },
      tables: { "Line Items.csv": { filters: { Format: { t: ["Number"] } }, ranges: { Started: { from: "2026-03-13", to: "", blanks: true, zone: "Asia/Tokyo" },
        Ended: { from: "2026-03-14", to: "", blanks: true } }, hidden: ["Notes"] } },
      map: { view: "drill", module: "Revenue", others: true }, drawer: { kind: "row", file: "Line Items.csv", key: "3:abc" },
    });
  });

  it("writes settings in the place of those kept before, and settings that say nothing take the place of none", () => {
    const tab = storage();
    const view: KeptView = { subject: "app:1", tables: { "Pages.csv": { page: 1 } }, pageSize: 100 };
    expect([writeKept(tab, view), readKept(tab)]).toEqual([true, view]);
    const plain: KeptView = { subject: "app:1", tables: {} };
    expect([isPlain(plain), isPlain(view)]).toEqual([true, false]);
    expect([writeKept(tab, plain), tab.held.has(VIEW_KEY)]).toEqual([true, false]);
    writeKept(tab, view);
    expect([forgetKept(tab), tab.held.size]).toEqual([true, 0]);
  });

  it("never throws: a tab without storage, or one that refuses, keeps nothing and says so", () => {
    const view: KeptView = { subject: "app:1", tables: {}, everyUse: true };
    expect([writeKept(undefined, view), readKept(undefined), forgetKept(undefined)]).toEqual([false, undefined, true]);
    const refusing = storage("QuotaExceededError");
    expect([writeKept(refusing, view), readKept(refusing), forgetKept(refusing)]).toEqual([false, undefined, false]);
  });

  it("stays small: the filters with the longest lists go first, and settings that are still too large are not written", () => {
    const many = (count: number): string[] => Array.from({ length: count }, (_, at) => `Value ${at}`);
    const view: KeptView = { subject: "model:ABC", tables: { "Line Items.csv": { filters: { Big: { t: many(2000) }, Small: { t: ["Number"] } }, page: 3 } } };
    const text = keptText(view)!;
    expect([text.length <= MAX_VIEW_CHARS, JSON.parse(text).tables["Line Items.csv"]]).toEqual([true, { filters: { Small: { t: ["Number"] } }, page: 3 }]);
    // The settings given are not changed by that.
    expect(Object.keys(view.tables["Line Items.csv"].filters ?? {})).toEqual(["Big", "Small"]);
    expect(keptText({ subject: "x".repeat(MAX_VIEW_CHARS), tables: {} })).toBeUndefined();
  });

  it("knows an object of Where Used by all four of its names, and the map where it opens by itself", () => {
    expect(objectKey({ type: "Module", name: "REP01", module: "-", model: "Model one" })).not.toBe(objectKey({ type: "Module", name: "REP01", module: "-", model: "Model two" }));
    expect([isMapAtStart({ view: "modules" }), isMapAtStart({ view: "modules", all: true }), isMapAtStart({ view: "modules", access: true }), isMapAtStart({ view: "drill", module: "A" })])
      .toEqual([true, false, false, false]);
  });
});
