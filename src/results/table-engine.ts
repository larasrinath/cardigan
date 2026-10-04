import type { Cell } from "../result-types.js";

/** The results page's table engine: search, column filters, sort and paging over a result table's rows. Plain data in,
 * plain data out, so it runs without a page. Columns are named by their position in the table's headers. */

export type Row = readonly Cell[];

/** A cell as the page shows it: its text as it stands, and nothing for a missing value. This is the text the CSV writes
 * before its guards for spreadsheets (zip.ts `toCsv`). */
export const cellText = (cell: unknown): string => (cell === null || cell === undefined ? "" : String(cell));

/** The dash the app export writes where there is nothing to say (report.ts `NONE`). The page shows it greyed, as text. */
export const NONE = "—";

/** A name for a row: the text of its first cell that says something, which is neither empty nor the dash. Nothing when no
 * cell does. A text far longer than a name is cut, since it stands as a heading; the cell itself is never cut. */
export function rowName(row: Row): string {
  for (const cell of row) {
    const text = cellText(cell).trim();
    if (text !== "" && text !== NONE) return text.length > ROW_NAME_MAX ? `${text.slice(0, ROW_NAME_MAX)}…` : text;
  }
  return "";
}
export const ROW_NAME_MAX = 120;

export interface Sort { column: number; dir: "asc" | "desc" }

export interface TableQuery {
  /** Keeps the rows with this text in any column, whatever its case. */
  search: string;
  /** More texts of a row for the search to read besides its cells: for a table that shows a cell otherwise than the CSV
   * has it, the CSV's text, so that what the file holds can be found as well as what the table shows. The same rows
   * always go with the same function. */
  also?: (row: Row) => Iterable<unknown> | undefined;
  /** Column -> the cell texts to keep. A column without a set keeps every row; an empty set keeps none. */
  filters: ReadonlyMap<number, ReadonlySet<string>>;
  sort?: Sort;
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
 * Rows that compare equal keep the file's order, in both directions. */
export function sortRows<T extends Row>(rows: readonly T[], sort: Sort): T[] {
  const texts = rows.map(row => cellText(row[sort.column]));
  const numbers = rows.map(row => sortNumber(row[sort.column]));
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

/** The rows a table shows for a query: the jump's rows, then the search, then every column filter, then the sort. The
 * rows given are never changed. */
export function selectRows<T extends Row>(rows: readonly T[], query: TableQuery): readonly T[] {
  let out = rows;
  const { context } = query;
  if (context) out = out.filter(row => cellText(row[context.column]) === context.value);
  const needle = query.search.trim().toLowerCase();
  if (needle) {
    const holds = (text: unknown): boolean => cellText(text).toLowerCase().includes(needle);
    const { also } = query;
    out = out.filter(row => {
      if (row.some(holds)) return true;
      for (const text of also?.(row) ?? []) if (holds(text)) return true;
      return false;
    });
  }
  for (const [column, values] of query.filters) out = out.filter(row => values.has(cellText(row[column])));
  return query.sort ? sortRows(out, query.sort) : out;
}

/** `selectRows` that remembers its last answer: the same rows and an equal query give the same list back without searching
 * and sorting again. Turning a page of a long sorted table asks for exactly that. */
export function rememberingSelect(): <T extends Row>(rows: readonly T[], query: TableQuery) => readonly T[] {
  let last: { rows: readonly Row[]; also: TableQuery["also"]; key: string; selected: readonly Row[] } | undefined;
  return <T extends Row>(rows: readonly T[], query: TableQuery): readonly T[] => {
    const key = JSON.stringify([query.search, [...query.filters].map(([column, values]) => [column, [...values]]), query.sort ?? null, query.context ?? null]);
    if (!last || last.rows !== rows || last.also !== query.also || last.key !== key) last = { rows, also: query.also, key, selected: selectRows(rows, query) };
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

/** The page numbers a pager offers, from 0: all of them up to seven, otherwise the first, the last and the ones around the
 * current page, with `undefined` where pages are left out. */
export function pagerItems(page: number, pages: number): (number | undefined)[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, index) => index);
  const low = Math.max(1, page - 1);
  const high = Math.min(pages - 2, page + 1);
  const items: (number | undefined)[] = [0];
  if (low > 1) items.push(undefined);
  for (let index = low; index <= high; index++) items.push(index);
  if (high < pages - 2) items.push(undefined);
  items.push(pages - 1);
  return items;
}

/** Each text a column holds, with the number of rows that hold it, in text order: what a column filter offers. */
export function valueCounts(rows: readonly Row[], column: number): [value: string, count: number][] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const value = cellText(row[column]);
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts].sort(([a], [b]) => collator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0));
}
