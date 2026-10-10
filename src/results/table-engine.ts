import type { Cell } from "../result-types.js";

/** The results page's table engine: search, column filters, sort and paging over a result table's rows. Plain data in,
 * plain data out, so it runs without a page. Columns are named by their position in the table's headers. */

export type Row = readonly Cell[];

/** A cell as the page shows it: its text as it stands, and nothing for a missing value. */
export const cellText = (cell: unknown): string => (cell === null || cell === undefined ? "" : String(cell));

/** The dash the app export writes where there is nothing to say (report.ts `NONE`): a plain hyphen, alone in its cell. In
 * an app's tables the page shows it greyed, as text, and wherever it reads an app's cells it takes it for no value. A
 * hyphen that an Anaplan user typed alone, as a card's title or an object's name, is then taken for no value as well:
 * that is accepted, as the two cannot be told apart. Anaplan writes the same hyphen in a model's grids, in Applies To on a
 * heading row of Modules and in Source Object of a file import, so in a model's tables it is the cell's text like any
 * other (columns.ts `writesNone`). */
export const NONE = "-";

/** A count as the page shows it: its digits with a comma between each group of three, counted from the right, so that
 * 15389009578 reads 15,389,009,578. The grouping is always this one, whatever language the browser speaks, so that the
 * page reads the same everywhere. It is worked on the digits as text, never as a number: a model's cell count can be
 * larger than a number holds exactly. Only a whole number written as plain digits, with a minus sign or not, is a count
 * to group. Anything else stays as it is: an empty cell, the dash, a word, a number with a fraction or already grouped,
 * and digits that begin with a zero, which are a code rather than a count. The cell itself is never changed: this is what
 * the page shows of it. */
export function groupedCount(text: string): string {
  const count = /^(-?)([1-9]\d*)$/.exec(text);
  return count ? `${count[1]}${count[2].replace(/\B(?=(\d{3})+$)/g, ",")}` : text;
}

/** A name for a row: the text of its first cell that says something, which is neither empty nor, in a table where the dash
 * says that there is nothing (`none`, columns.ts `writesNone`), the dash. Nothing when no cell does. A text far longer
 * than a name is cut, since it stands as a heading; the cell itself is never cut. */
export function rowName(row: Row, none: boolean): string {
  for (const cell of row) {
    const text = cellText(cell).trim();
    if (text !== "" && !(none && text === NONE)) return text.length > ROW_NAME_MAX ? `${text.slice(0, ROW_NAME_MAX)}…` : text;
  }
  return "";
}
export const ROW_NAME_MAX = 120;

export interface Sort { column: number; dir: "asc" | "desc" }

/** How a column's cells list their items, as cell-lists.ts says: a cell's items, or nothing for a cell that is not cut,
 * which is then one item, its whole text. The row is the cell's own. */
export type ItemsOf = (text: string, row: Row) => readonly string[] | undefined;

/** A cell's items as a column filter reads them: each item the cell lists, once, or the cell's whole text where it lists
 * none. An empty cell is the one item that is blank. */
export function filterItems(row: Row, column: number, items: ItemsOf | undefined): readonly string[] {
  const text = cellText(row[column]);
  const listed = items?.(text, row);
  return listed ? [...new Set(listed)] : [text];
}

/** A column of numbers or of dates, which a range filters rather than a list to tick (columns.ts `rangeOf`): numbers from
 * one to another, dates from one day to another. */
export type RangeKind = "number" | "date";

/** A number as a cell or a filter's box writes it: digits with a sign or without, their thousands apart with commas or
 * not ("1,582"), a fraction after a point, and a percent sign or not ("40%"). Digits that begin with a zero ("007") are a
 * code and no number, as they are no count to group (`groupedCount`). */
const NUMBER_TEXT = /^([-+]?)(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?%?$/;
/** A date as a model's grids and an app's files write it: its year, month and day, and a time after them or not
 * ("2026-03-12 23:19:56", "2026-10-09"), which is also what a box for a date gives. */
const DATE_TEXT = /^(\d{4})-(\d{2})-(\d{2})(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;
const DAY = 86_400_000;

/** The number a text writes, or nothing for a text that is no number (`NUMBER_TEXT`). A percentage is its number: "40%" is
 * 40, as a box that says 40 reads it. A cell count larger than a number holds exactly is read near enough to compare. */
export function numberOf(text: string): number | undefined {
  const match = NUMBER_TEXT.exec(text.trim());
  if (!match || /^0\d/.test(match[2])) return undefined;
  const value = Number(`${match[1]}${match[2].replace(/,/g, "")}${match[3] ?? ""}`);
  return Number.isFinite(value) ? value : undefined;
}

/** The day a text names, counted from 1 January 1970, or nothing for a text that is no date (`DATE_TEXT`), or names a day
 * no calendar has, such as 30 February. A time after the date is left aside: a range of dates is one of whole days, so a
 * cell is kept on the day it names, at any time of it, and the time is the column's own, UTC where its header says so. */
export function dayOf(text: string): number | undefined {
  const match = DATE_TEXT.exec(text.trim());
  if (!match) return undefined;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const time = Date.UTC(year, month - 1, day);
  const date = new Date(time);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? time / DAY : undefined;
}

/** A day as a date's text, its year, month and day ("2026-03-12"): what a box for a date shows and takes. */
export const dayText = (day: number): string => new Date(day * DAY).toISOString().slice(0, 10);

/** What a text is worth in a range of this kind: its number, or its day. */
export const rangeValue = (text: string, kind: RangeKind): number | undefined => (kind === "number" ? numberOf(text) : dayOf(text));

/** Whether a cell says nothing, as a range reads it: it is empty, or in a table where the dash says that there is nothing
 * (`none`, columns.ts `writesNone`), it is the dash. */
export const saysNothing = (text: string, none: boolean): boolean => {
  const trimmed = text.trim();
  return trimmed === "" || (none && trimmed === NONE);
};

/** A column of numbers or of dates, read once (`rangeColumn`): each row's value by the row, nothing for a cell that says
 * nothing; the lowest and the highest, with the text of the first cell that holds each; and how many cells say nothing. A
 * range filter reads it when it opens and when it keeps rows, so a column's cells are read once however often it does. */
export interface RangeColumn {
  values: ReadonlyMap<Row, number | undefined>;
  lowest?: { value: number; text: string };
  highest?: { value: number; text: string };
  blanks: number;
}

export function rangeColumn(rows: readonly Row[], column: number, kind: RangeKind, none: boolean): RangeColumn {
  const values = new Map<Row, number | undefined>();
  let lowest: RangeColumn["lowest"];
  let highest: RangeColumn["highest"];
  let blanks = 0;
  for (const row of rows) {
    const text = cellText(row[column]).trim();
    const value = saysNothing(text, none) ? undefined : rangeValue(text, kind);
    values.set(row, value);
    if (value === undefined) {
      blanks++;
      continue;
    }
    if (!lowest || value < lowest.value) lowest = { value, text };
    if (!highest || value > highest.value) highest = { value, text };
  }
  return { values, ...(lowest ? { lowest } : {}), ...(highest ? { highest } : {}), blanks };
}

/** A range a column's rows are kept by: from and to, each in the column's own terms (a number, or a day, `rangeValue`),
 * either of them left open, both ends kept; and whether a cell that says nothing is kept. `values` is the column read once
 * (`rangeColumn`); without it, each cell is read where the range needs it. */
export interface RangeQuery {
  kind: RangeKind;
  from?: number;
  to?: number;
  blanks: boolean;
  /** Whether the table's dash says that there is nothing (columns.ts `writesNone`). */
  none: boolean;
  values?: ReadonlyMap<Row, number | undefined>;
}

/** Whether a row's cell lies within a range. A cell that says nothing, or that is no number or no date of the range's
 * kind, is kept only where the range keeps blank cells. */
function inRange(row: Row, column: number, range: RangeQuery): boolean {
  const value = range.values?.has(row) ? range.values.get(row) : (() => {
    const text = cellText(row[column]);
    return saysNothing(text, range.none) ? undefined : rangeValue(text, range.kind);
  })();
  if (value === undefined) return range.blanks;
  return (range.from === undefined || value >= range.from) && (range.to === undefined || value <= range.to);
}

export interface TableQuery {
  /** Keeps the rows with this text in any column, whatever its case. */
  search: string;
  /** The columns whose counts the page shows grouped (`groupedCount`). The search finds a count in them as it is shown as
   * well as by its own digits: "15,389" and "15389" both find 15,389,009,578. */
  counts?: ReadonlySet<number>;
  /** Column -> the cell texts to keep. A column without a set keeps every row; an empty set keeps none. In a column that
   * lists items (`lists`), the texts are items, and a row is kept when any of its items is one of them. */
  filters: ReadonlyMap<number, ReadonlySet<string>>;
  /** The columns whose cells list several items, by their place: their filters read each item (`filterItems`). */
  lists?: ReadonlyMap<number, ItemsOf>;
  /** Column -> the range its rows are kept by, for a column of numbers or of dates. A column without one keeps every row. */
  ranges?: ReadonlyMap<number, RangeQuery>;
  sort?: Sort;
  /** Column -> the text a row is sorted by in it, where that is not the cell's own: a time shown in the viewer's zone is
   * sorted by the UTC text that was read, which runs as the moments do (times.ts `readText`). */
  sortKeys?: ReadonlyMap<number, (row: Row) => string>;
  /** A jump from another table: keeps the rows whose cell in `column` is exactly `value`. */
  context?: { column: number; value: string };
}

// Names sort as people read them, whatever their case, and "Card 2" comes before "Card 10".
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "accent" });
export const compareText = (a: string, b: string): number => collator.compare(a, b);

const NUMBER = /^-?\d+(?:\.\d+)?$/;
function sortNumber(cell: unknown): number | undefined {
  if (typeof cell === "number") return Number.isFinite(cell) ? cell : undefined;
  return typeof cell === "string" && NUMBER.test(cell) ? Number(cell) : undefined;
}

/** The rows in the order of one column. A column that holds only numbers and blanks sorts as numbers, blanks first; any
 * other column sorts as text. The rule is taken once for the column, not per pair of cells, so the order is consistent.
 * Rows that compare equal keep the file's order, in both directions. `key` gives the text a row sorts by where that is
 * not its cell's: such a column sorts as text. */
export function sortRows<T extends Row>(rows: readonly T[], sort: Sort, key?: (row: Row) => string): T[] {
  const texts = rows.map(row => (key ? key(row) : cellText(row[sort.column])));
  const numbers = rows.map(row => (key ? undefined : sortNumber(row[sort.column])));
  const numeric = numbers.some(value => value !== undefined) && numbers.every((value, index) => value !== undefined || texts[index] === "");
  const compare = numeric
    ? (a: number, b: number) => {
      const x = numbers[a];
      const y = numbers[b];
      return x === undefined ? (y === undefined ? 0 : -1) : y === undefined ? 1 : x - y;
    }
    : (a: number, b: number) => collator.compare(texts[a], texts[b]);
  const sign = sort.dir === "desc" ? -1 : 1;
  return rows.map((_, index) => index).sort((a, b) => sign * compare(a, b) || a - b).map(index => rows[index]);
}

/** The rows a table shows for a query: the jump's rows, then the search, then every column filter, a list's and a range's,
 * then the sort. The rows given are never changed. */
export function selectRows<T extends Row>(rows: readonly T[], query: TableQuery): readonly T[] {
  let out = rows;
  const { context } = query;
  if (context) out = out.filter(row => cellText(row[context.column]) === context.value);
  const needle = query.search.trim().toLowerCase();
  const counts = query.counts;
  // A count is found by what the page shows of it too: its digits as the cell holds them, and with their commas.
  const found = (cell: unknown, column: number): boolean => {
    const text = cellText(cell);
    return text.toLowerCase().includes(needle) || (counts?.has(column) === true && groupedCount(text).includes(needle));
  };
  if (needle) out = out.filter(row => row.some(found));
  for (const [column, values] of query.filters) {
    const items = query.lists?.get(column);
    out = items ? out.filter(row => filterItems(row, column, items).some(item => values.has(item))) : out.filter(row => values.has(cellText(row[column])));
  }
  for (const [column, range] of query.ranges ?? []) out = out.filter(row => inRange(row, column, range));
  return query.sort ? sortRows(out, query.sort, query.sortKeys?.get(query.sort.column)) : out;
}

/** `selectRows` that remembers its last answer: the same rows and an equal query give the same list back without searching
 * and sorting again. Turning a page of a long sorted table asks for exactly that. */
export function rememberingSelect(): <T extends Row>(rows: readonly T[], query: TableQuery) => readonly T[] {
  let last: { rows: readonly Row[]; key: string; selected: readonly Row[] } | undefined;
  return <T extends Row>(rows: readonly T[], query: TableQuery): readonly T[] => {
    const key = JSON.stringify([query.search, [...query.filters].map(([column, values]) => [column, [...values]]), query.sort ?? null, query.context ?? null,
      [...(query.counts ?? [])], [...(query.ranges ?? [])].map(([column, range]) => [column, range.kind, range.from ?? null, range.to ?? null, range.blanks, range.none]),
      [...(query.sortKeys?.keys() ?? [])]]);
    if (!last || last.rows !== rows || last.key !== key) last = { rows, key, selected: selectRows(rows, query) };
    return last.selected as readonly T[];
  };
}

export interface Page<T> {
  rows: T[];
  /** The page shown, from 0: the one asked for, or the last one when there are fewer. */
  page: number;
  pages: number;
  /** The first and last row shown, counted from 1; both 0 when there is no row. */
  from: number;
  to: number;
  total: number;
}

/** One page of rows. Only a page of rows is ever put on the page, which keeps a table of any length quick to draw. */
export function pageOf<T>(rows: readonly T[], page: number, size: number): Page<T> {
  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / size));
  const current = Number.isInteger(page) ? Math.min(Math.max(0, page), pages - 1) : 0;
  const start = current * size;
  return { rows: rows.slice(start, start + size), page: current, pages, from: total === 0 ? 0 : start + 1, to: Math.min(total, start + size), total };
}

/** Each text a column holds, with the number of rows that hold it, in text order: what a column filter offers. A column
 * that lists items (`items`) offers each item, with the number of rows that list it. */
export function valueCounts(rows: readonly Row[], column: number, items?: ItemsOf): [value: string, count: number][] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    for (const value of items ? filterItems(row, column, items) : [cellText(row[column])]) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts].sort(([a], [b]) => collator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0));
}
