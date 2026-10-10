import type { MapView } from "../map/graph-types.js";
import type { Column } from "./columns.js";
import { readRange, type RangeState } from "./range-filter.js";
import { cellText, type Row, type Sort } from "./table-engine.js";

/** What a results page keeps of how its result is looked at, so that a refresh of the page shows the result as it was
 * left and not only the result: each table's filters, ranges, columns shown or hidden, order and page; the search and the
 * jump of the table shown; how many rows a page lists; the way an app's Where Used is shown; where the model map was; and
 * the row whose details were open.
 *
 * - Where: the tab's own session storage, under one key, beside the kept result (keep-result.ts), and for as long: until
 *   the tab is closed. A setting the user makes once for every tab, such as the theme or the map's grouping, is local
 *   storage's, and not this.
 * - Whose: the settings name the result they were made on, by its kind and ID (`subjectOf`). A refreshed page, and a run
 *   again on the same app or model, takes back what still fits its tables. Another app or model starts clean.
 * - By name: a table by its file's name, a column by its label (`columnKeys`), a row by what it holds (`rowKey`). A new run
 *   whose table has other columns keeps what still applies to the columns it has, and lets the rest go without a word.
 * - Small: the result kept beside it takes most of the room the storage gives, so the settings are kept to a few thousand
 *   characters (`MAX_VIEW_CHARS`). A filter's choice is kept as the shorter of the values ticked and the values left out.
 *
 * Nothing here touches the storage but `readKept`, `writeKept` and `forgetKept`, and none of them throws: a tab whose
 * storage is missing, full or refuses every write is one whose settings are not kept, and the page works the same. */

/** The one key the settings are kept under. The kept result's keys all start with another prefix (keep-result.ts). */
export const VIEW_KEY = "cardigan-view";

/** The most characters the settings take. The kept result leaves about 400,000 of the storage free; the settings use a
 * small part of that, so that a result kept later still fits. Filters of very many values are left out to stay under it. */
export const MAX_VIEW_CHARS = 20_000;

/** A filter as kept: the values left ticked (`t`) or those left out (`u`), whichever is the shorter list, and the values
 * left out where the two are as long. Kept as the values left out, a value that a new run brings is shown; kept as the
 * values ticked, it is not, as the user chose only those. */
export type KeptFilter = { t: string[] } | { u: string[] };

/** One table's settings, each column by its key (`columnKeys`). */
export interface KeptTable {
  filters?: Record<string, KeptFilter>;
  /** A range as the user typed its two ends, and whether it keeps the cells that say nothing. */
  ranges?: Record<string, { from: string; to: string; blanks: boolean }>;
  /** The columns shown that start hidden, and those hidden that start shown. A column the table did not have when the
   * settings were made starts as the page starts it. */
  shown?: string[];
  hidden?: string[];
  sort?: { column: string; dir: "asc" | "desc" };
  /** The page shown, counted from 0. A page the table no longer has is its last. */
  page?: number;
}

/** The details that were open: a row of a table, a card, or an object of an app's Where Used by object. */
export type KeptDrawer = { kind: "row" | "card"; file: string; key: string } | { kind: "object"; key: string };

export interface KeptView {
  /** Whose result the settings were made on (`subjectOf`). */
  subject: string;
  /** Each table's settings, by the table's key (`tableKey`). */
  tables: Record<string, KeptTable>;
  /** How many rows a page lists, where it is not the page's own 50. */
  pageSize?: number;
  /** Whether an app's Where Used is shown as every use. */
  everyUse?: boolean;
  /** The search and the jump of the table that was shown, with that table's view: they end with the view, as on the page. */
  search?: { view: string; text: string; context?: string };
  /** Where the model map was, as it last said (graph-types.ts `MapView`). */
  map?: MapView;
  drawer?: KeptDrawer;
}

/** The rows a page lists unless the user chose another number. */
export const DEFAULT_PAGE_SIZE = 50;
const PAGE_SIZES: ReadonlySet<number> = new Set([25, 50, 100]);

/** Whose result it is: its kind and its ID. A run again on the same app or model has the same subject. */
export const subjectOf = (result: { kind: string; id: string }): string => `${result.kind}:${result.id}`;

/** Each column's key: its label, and where two columns of the table have one label, the label and which of them it is
 * ("Notes #2"). The label is what the user knows a column by, and what a new run's table names it by too. */
export function columnKeys(columns: readonly Pick<Column, "label">[]): string[] {
  const seen = new Map<string, number>();
  return columns.map(({ label }) => {
    const count = (seen.get(label) ?? 0) + 1;
    seen.set(label, count);
    return count === 1 ? label : `${label} #${count}`;
  });
}

/** A row's key, from what it holds: every cell's text. The same row of the same result has the same key after a refresh,
 * and a row whose cells all stay the same keeps it through a new run. Two rows that hold the same have the same key: the
 * page then reopens neither (`findRow`). A 32-bit hash, FNV-1a, with the number of cells. */
export function rowKey(row: Row): string {
  let hash = 0x811c9dc5;
  const text = row.map(cellText).join("\u0001");
  for (let at = 0; at < text.length; at++) {
    hash ^= text.charCodeAt(at);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${row.length}:${(hash >>> 0).toString(36)}`;
}

/** The one row of these with this key, or none where no row has it or more than one does. */
export function findRow<T extends Row>(rows: readonly T[], key: string): T | undefined {
  let found: T | undefined;
  for (const row of rows) {
    if (rowKey(row) !== key) continue;
    if (found) return undefined;
    found = row;
  }
  return found;
}

/** What a table holds that its settings are made of, as the page holds it. */
export interface TableLooks {
  columns: readonly Pick<Column, "index" | "label" | "range" | "hidden">[];
  /** Column -> the values ticked; a column with every value ticked has no entry. */
  filters: ReadonlyMap<number, ReadonlySet<string>>;
  ranges: ReadonlyMap<number, RangeState>;
  hidden: ReadonlySet<number>;
  sort: Sort | undefined;
  page: number;
}

/** A table's settings as they are kept, or nothing where it has none: no filter, range, column shown or hidden otherwise
 * than the page starts it, order or page. `valuesOf` gives every value a column's filter lists, ticked or not. */
export function keepTable(looks: TableLooks, valuesOf: (column: number) => readonly string[]): KeptTable | undefined {
  const keys = columnKeys(looks.columns);
  const keyOf = (index: number): string | undefined => {
    const at = looks.columns.findIndex(column => column.index === index);
    return at < 0 ? undefined : keys[at];
  };
  const kept: KeptTable = {};
  const filters: Record<string, KeptFilter> = {};
  for (const [index, ticked] of looks.filters) {
    const key = keyOf(index);
    if (key === undefined) continue;
    const unticked = valuesOf(index).filter(value => !ticked.has(value));
    if (!unticked.length) continue;
    filters[key] = ticked.size < unticked.length ? { t: [...ticked] } : { u: unticked };
  }
  if (Object.keys(filters).length) kept.filters = filters;
  const ranges: NonNullable<KeptTable["ranges"]> = {};
  for (const [index, range] of looks.ranges) {
    const key = keyOf(index);
    if (key !== undefined) ranges[key] = { from: range.fromText, to: range.toText, blanks: range.blanks };
  }
  if (Object.keys(ranges).length) kept.ranges = ranges;
  const shown: string[] = [];
  const hidden: string[] = [];
  looks.columns.forEach((column, at) => {
    if (column.hidden && !looks.hidden.has(column.index)) shown.push(keys[at]);
    if (!column.hidden && looks.hidden.has(column.index)) hidden.push(keys[at]);
  });
  if (shown.length) kept.shown = shown;
  if (hidden.length) kept.hidden = hidden;
  const sortKey = looks.sort && keyOf(looks.sort.column);
  if (looks.sort && sortKey !== undefined) kept.sort = { column: sortKey, dir: looks.sort.dir };
  if (looks.page > 0) kept.page = looks.page;
  return Object.keys(kept).length ? kept : undefined;
}

/** What a table's settings give back: its filters, ranges, hidden columns, order and page, as the page holds them. */
export interface TakenTable {
  filters: Map<number, Set<string>>;
  ranges: Map<number, RangeState>;
  hidden: Set<number>;
  sort: Sort | undefined;
  page: number;
}

/** A table's settings taken back onto the table as it is now: by its columns' keys, so that what fits another table of
 * the same file is taken and the rest let go. A filter keeps only the values the column still has; one that would keep
 * every value is no filter. A range whose ends cannot be read for the column is let go, and so is one on a column that
 * is no longer one of numbers or of dates. */
export function takeTable(kept: KeptTable, columns: readonly Pick<Column, "index" | "label" | "range" | "hidden">[], valuesOf: (column: number) => readonly string[]): TakenTable {
  const keys = columnKeys(columns);
  const byKey = new Map(keys.map((key, at) => [key, columns[at]]));
  const filters = new Map<number, Set<string>>();
  for (const [key, filter] of Object.entries(kept.filters ?? {})) {
    const column = byKey.get(key);
    if (!column || column.range) continue;
    const values = valuesOf(column.index);
    const listed = new Set("t" in filter ? filter.t : filter.u);
    const ticked = new Set(values.filter(value => ("t" in filter ? listed.has(value) : !listed.has(value))));
    if (ticked.size < values.length) filters.set(column.index, ticked);
  }
  const ranges = new Map<number, RangeState>();
  for (const [key, range] of Object.entries(kept.ranges ?? {})) {
    const column = byKey.get(key);
    if (!column?.range) continue;
    const read = readRange(column.range, range.from, range.to);
    if ("problem" in read) continue;
    const state: RangeState = { fromText: range.from, toText: range.to, ...read, blanks: range.blanks };
    if (state.from !== undefined || state.to !== undefined || !state.blanks) ranges.set(column.index, state);
  }
  const hidden = new Set(columns.filter(column => column.hidden).map(column => column.index));
  for (const key of kept.shown ?? []) {
    const column = byKey.get(key);
    if (column) hidden.delete(column.index);
  }
  for (const key of kept.hidden ?? []) {
    const column = byKey.get(key);
    if (column) hidden.add(column.index);
  }
  const sortColumn = kept.sort && byKey.get(kept.sort.column);
  const sort: Sort | undefined = kept.sort && sortColumn ? { column: sortColumn.index, dir: kept.sort.dir } : undefined;
  return { filters, ranges, hidden, sort, page: kept.page ?? 0 };
}

/* ---------- the storage ---------- */

/** The tab's session storage, as far as the settings use it. */
export interface ViewStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(each => typeof each === "string");

/** One table's settings as read back: only what has the shape the page writes, each part on its own. */
function readTable(value: unknown): KeptTable | undefined {
  if (!isRecord(value)) return undefined;
  const table: KeptTable = {};
  if (isRecord(value.filters)) {
    const filters: Record<string, KeptFilter> = {};
    for (const [key, filter] of Object.entries(value.filters)) {
      if (isRecord(filter) && strings(filter.t)) filters[key] = { t: filter.t };
      else if (isRecord(filter) && strings(filter.u)) filters[key] = { u: filter.u };
    }
    table.filters = filters;
  }
  if (isRecord(value.ranges)) {
    const ranges: NonNullable<KeptTable["ranges"]> = {};
    for (const [key, range] of Object.entries(value.ranges)) {
      if (isRecord(range) && typeof range.from === "string" && typeof range.to === "string" && typeof range.blanks === "boolean") ranges[key] = { from: range.from, to: range.to, blanks: range.blanks };
    }
    table.ranges = ranges;
  }
  if (strings(value.shown)) table.shown = value.shown;
  if (strings(value.hidden)) table.hidden = value.hidden;
  if (isRecord(value.sort) && typeof value.sort.column === "string" && (value.sort.dir === "asc" || value.sort.dir === "desc")) table.sort = { column: value.sort.column, dir: value.sort.dir };
  if (Number.isSafeInteger(value.page) && (value.page as number) > 0) table.page = value.page as number;
  return table;
}

/** Where the map was, as read back: only what has the shape the map tells. */
function readMap(value: unknown): MapView | undefined {
  if (!isRecord(value) || (value.view !== "modules" && value.view !== "drill")) return undefined;
  return {
    view: value.view,
    ...(typeof value.group === "string" ? { group: value.group } : {}),
    ...(value.all === true ? { all: true } : {}),
    ...(typeof value.module === "string" ? { module: value.module } : {}),
    ...(value.others === true ? { others: true } : {}),
    ...(value.access === true ? { access: true } : {}),
  };
}

function readDrawer(value: unknown): KeptDrawer | undefined {
  if (!isRecord(value) || typeof value.key !== "string") return undefined;
  if (value.kind === "object") return { kind: "object", key: value.key };
  if ((value.kind === "row" || value.kind === "card") && typeof value.file === "string") return { kind: value.kind, file: value.file, key: value.key };
  return undefined;
}

/** The settings the tab keeps, or nothing: none kept, no storage, or what is kept is not settings of this page's making.
 * Each part that is not as the page writes it is left out, and the rest is taken. */
export function readKept(storage: ViewStorage | undefined): KeptView | undefined {
  let text: string | null = null;
  try { text = storage?.getItem(VIEW_KEY) ?? null; } catch { return undefined; }
  if (text === null) return undefined;
  let value: unknown;
  try { value = JSON.parse(text); } catch { return undefined; }
  if (!isRecord(value) || typeof value.subject !== "string") return undefined;
  const tables: Record<string, KeptTable> = {};
  if (isRecord(value.tables)) {
    for (const [key, table] of Object.entries(value.tables)) {
      const read = readTable(table);
      if (read) tables[key] = read;
    }
  }
  const view: KeptView = { subject: value.subject, tables };
  if (typeof value.pageSize === "number" && PAGE_SIZES.has(value.pageSize)) view.pageSize = value.pageSize;
  if (value.everyUse === true) view.everyUse = true;
  const search = value.search;
  if (isRecord(search) && typeof search.view === "string" && typeof search.text === "string") {
    view.search = { view: search.view, text: search.text, ...(typeof search.context === "string" ? { context: search.context } : {}) };
  }
  const map = readMap(value.map);
  if (map) view.map = map;
  const drawer = readDrawer(value.drawer);
  if (drawer) view.drawer = drawer;
  return view;
}

/** Whether the settings say nothing the page does not start with: then nothing needs keeping. */
export function isPlain(view: KeptView): boolean {
  return !Object.keys(view.tables).length && view.pageSize === undefined && view.everyUse === undefined && view.search === undefined
    && view.map === undefined && view.drawer === undefined;
}

/** An object of an app's Where Used by object, as the details that were open name it: by what it is, its name, its module
 * and its model. Two objects alike in all four have one key, and the page then opens neither. */
export const objectKey = (object: { type: string; name: string; module: string; model: string }): string =>
  [object.type, object.name, object.module, object.model].join("\u0001");

/** Whether the map is where it opens by itself: the Modules view, the groups as a whole, formulas' links only. Then the
 * map has nothing to keep. */
export const isMapAtStart = (map: MapView): boolean => map.view === "modules" && map.group === undefined && map.all !== true && map.access !== true;

/** The settings as written: at most `MAX_VIEW_CHARS` characters. Where they are more, the filters with the longest lists
 * of values are let go, one by one, until they fit; where the rest is still more, nothing is written. */
export function keptText(view: KeptView, most = MAX_VIEW_CHARS): string | undefined {
  let text = JSON.stringify(view);
  if (text.length <= most) return text;
  const lists: { table: string; column: string; size: number }[] = [];
  for (const [table, kept] of Object.entries(view.tables)) {
    for (const [column, filter] of Object.entries(kept.filters ?? {})) lists.push({ table, column, size: JSON.stringify(filter).length });
  }
  lists.sort((a, b) => b.size - a.size);
  const tables: Record<string, KeptTable> = Object.fromEntries(Object.entries(view.tables).map(([key, kept]) => [key, { ...kept, ...(kept.filters ? { filters: { ...kept.filters } } : {}) }]));
  for (const { table, column } of lists) {
    const filters = tables[table].filters;
    if (filters) delete filters[column];
    text = JSON.stringify({ ...view, tables });
    if (text.length <= most) return text;
  }
  return undefined;
}

/** Writes the settings, in the place of those kept before; settings that say nothing take nothing's place. True when the
 * storage holds them now. */
export function writeKept(storage: ViewStorage | undefined, view: KeptView): boolean {
  if (!storage) return false;
  if (isPlain(view)) return forgetKept(storage);
  const text = keptText(view);
  if (text === undefined) return false;
  try {
    storage.setItem(VIEW_KEY, text);
    return true;
  } catch {
    return false;
  }
}

/** Removes the settings the tab keeps. True when none is kept now. */
export function forgetKept(storage: ViewStorage | undefined): boolean {
  if (!storage) return true;
  try {
    if (storage.getItem(VIEW_KEY) !== null) storage.removeItem(VIEW_KEY);
    return true;
  } catch {
    return false;
  }
}
