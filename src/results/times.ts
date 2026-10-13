import type { Cell } from "../result-types.js";
import type { FileView } from "./result-view.js";
import { cellText } from "./table-engine.js";

/** The times the page shows, in the viewer's own time zone or in UTC, as the viewer chooses (the switch in the page's
 * header). Anaplan writes a time in UTC: an action's start in the Actions list ("2026-03-12 23:19:56", under a header that
 * ends "(UTC)"), and the export's own time in its Details file ("2026-10-03 14:02 UTC"), which the page keeps with the
 * result and does not show. The page shows an action's start as two columns, Start Date and Start Time (`splitTimes`), in
 * the zone chosen and in no other: each header names that zone in the place of "(UTC)", "Start Date (Europe/London)", and
 * a row's details say the two in it alone. A date with no time is no moment, and stays as it is: a day is no later in one
 * zone than in another. The result holds the times as they were read, whichever the page shows. Text in, text out:
 * nothing here reads a page. */

export type TimeMode = "local" | "utc";

/** Where the viewer's choice is kept: the browser's local storage, as the theme is, for every result and every tab. */
export const TIMES_KEY = "cardigan-times";

/** The viewer's choice, or the viewer's own zone where there is none: a page whose storage cannot be read shows local
 * times. */
export function storedTimeMode(): TimeMode {
  try {
    return localStorage.getItem(TIMES_KEY) === "utc" ? "utc" : "local";
  } catch {
    return "local";
  }
}

/** Keeps the viewer's choice, where the browser lets it: one that does not keeps it only while the page is open. */
export function storeTimeMode(mode: TimeMode): void {
  try {
    localStorage.setItem(TIMES_KEY, mode);
  } catch {
    /* not remembered */
  }
}

/** The viewer's time zone, as the browser names it ("Europe/London"), or nothing where the browser does not say. */
export function browserZone(): string | undefined {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof zone === "string" && zone !== "" ? zone : undefined;
  } catch {
    return undefined;
  }
}

/** A moment, and whether its text gave the seconds: the page says it again to the same second, or the same minute. */
export interface Moment { ms: number; seconds: boolean }

/** A date with a time, as Anaplan and the export write one: its year, month and day, then the hours and minutes, with
 * seconds or without, after a space or a "T", and after them "UTC", "Z", an offset such as "+05:30", or nothing, which
 * is UTC as well. */
const MOMENT_TEXT = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\s*(UTC|Z|[+-]\d{2}:?\d{2})?$/i;

/** The moment a text names, or nothing for a text that names none: no time with its date, or a day, an hour or a minute
 * no clock has, such as 30 February or 24:00. */
export function utcMoment(text: string): Moment | undefined {
  const match = MOMENT_TEXT.exec(text.trim());
  if (!match) return undefined;
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(part => (part === undefined ? 0 : Number(part)));
  if (hour > 23 || minute > 59 || second > 59) return undefined;
  const at = Date.UTC(year, month - 1, day, hour, minute, second);
  const date = new Date(at);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return undefined;
  const offset = match[7] && /^[+-]/.test(match[7]) ? offsetOf(match[7]) : 0;
  return offset === undefined ? undefined : { ms: at - offset, seconds: match[6] !== undefined };
}

/** An offset from UTC in milliseconds, "+05:30" as 5½ hours ahead; nothing for one no zone has. */
function offsetOf(text: string): number | undefined {
  const [, sign, hours, minutes] = /^([+-])(\d{2}):?(\d{2})$/.exec(text) ?? [];
  if (sign === undefined || Number(hours) > 14 || Number(minutes) > 59) return undefined;
  return (sign === "-" ? -1 : 1) * (Number(hours) * 60 + Number(minutes)) * 60_000;
}

/** The formats of a zone, by the zone and whether they give the seconds: made once each, as making one is slow. */
const formats = new Map<string, Intl.DateTimeFormat>();

/** A moment as a clock in a zone reads it, in the page's one way of writing a time whatever the browser's language:
 * "2026-03-13 04:49:56", or without the seconds. */
export function zoneText(moment: Moment, zone: string): string {
  const key = `${zone}\n${moment.seconds}`;
  let format = formats.get(key);
  if (!format) {
    format = new Intl.DateTimeFormat("en-GB", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit",
      minute: "2-digit", ...(moment.seconds ? { second: "2-digit" } : {}) });
    formats.set(key, format);
  }
  const parts = new Map(format.formatToParts(moment.ms).map(part => [part.type, part.value]));
  const time = `${parts.get("hour")}:${parts.get("minute")}${moment.seconds ? `:${parts.get("second")}` : ""}`;
  return `${parts.get("year")}-${parts.get("month")}-${parts.get("day")} ${time}`;
}

/** A moment as its day and its time of day on a zone's clock: "2026-03-13" and "04:49:56", or to the minute. */
export function dateAndTime(moment: Moment, zone: string): [date: string, time: string] {
  const text = zoneText(moment, zone);
  const space = text.indexOf(" ");
  return [text.slice(0, space), text.slice(space + 1)];
}

/** The moment a day begins in a zone: midnight there, for a day counted from 1 January 1970 as table-engine.ts `dayOf`
 * counts it. The zone's offset is taken at midnight UTC of that day and then again at the moment that gives, so that a
 * day on which the clocks change begins when the zone's clocks say. */
export function dayStart(day: number, zone: string): number {
  const midnight = day * DAY;
  const offset = (at: number): number => clockAsUtc(at, zone) - at;
  return midnight - offset(midnight - offset(midnight));
}
const DAY = 86_400_000;

/** What a zone's clock reads at a moment, as the moment UTC would be at that reading: its offset is the difference. */
function clockAsUtc(at: number, zone: string): number {
  const text = zoneText({ ms: at, seconds: true }, zone);
  const [, year, month, day, hour, minute, second] = /^(\d+)-(\d+)-(\d+) (\d+):(\d+):(\d+)$/.exec(text)?.map(Number) ?? [];
  return Date.UTC(year, month - 1, day, hour, minute, second);
}

/** The end of a header that says its column holds times in UTC, and the end the page gives it in the viewer's zone: the
 * zone's name, as the browser gives it. */
const UTC_END = /\s*\(UTC\)$/;
const zoneEnd = (zone: string): string => ` (${zone})`;

/** Whether a column, by its header, holds times in UTC, holds them in the viewer's zone (`zone`) as the page shows them,
 * or is no column of times. A viewer whose zone is UTC has no column of the other kind: the page says UTC either way. */
export function timesOf(header: string, zone: string): TimeMode | undefined {
  if (UTC_END.test(header)) return "utc";
  return zone !== "UTC" && header.endsWith(zoneEnd(zone)) ? "local" : undefined;
}

/** A column of times as the page shows it in the viewer's zone: "Start Date (Europe/London)". */
export const localHeader = (header: string, zone: string): string => header.replace(UTC_END, zoneEnd(zone));

/** A column's name as the page has it in UTC, whichever zone the page shows its times in: what the tab keeps a column's
 * settings by (view-keep.ts `columnKeys`), so that they are the same column's in either, and what a column is known by in
 * a model's layout and as a measure (columns.ts `MODEL_LAYOUTS`, `MEASURES`). Any other column's name is its own. */
export const fileLabel = (label: string, zone: string): string =>
  (timesOf(label, zone) === "local" ? `${label.slice(0, -zoneEnd(zone).length)} (UTC)` : label);

/** The file's column of an action's start, as Anaplan's Actions list writes it: the moment in UTC, its day and its time in
 * one cell ("2026-03-12 23:19:56"). */
export const START_COLUMN = "Start Date and Time (UTC)";
/** The two columns the page shows in its place (`splitTimes`), by their names in UTC: the day, and the time of day. */
export const START_DATE = "Start Date (UTC)";
export const START_TIME = "Start Time (UTC)";

/** The places of a table's Start Date and Start Time. */
export interface StartColumns { date: number; time: number }

/** Where a table shows an action's start (`splitTimes`), whether its two headers name UTC or the viewer's zone (`zone`);
 * nothing for a table without both. */
export function startColumns(headers: readonly Cell[], zone: string): StartColumns | undefined {
  const date = headers.findIndex(header => fileLabel(cellText(header), zone) === START_DATE);
  const time = headers.findIndex(header => fileLabel(cellText(header), zone) === START_TIME);
  return date < 0 || time < 0 ? undefined : { date, time };
}

/** A model's table with its actions' start as two columns, Start Date and Start Time, side by side in the place of the
 * file's one (`START_COLUMN`), in UTC as the file has them: `inTimeMode` says them again in the viewer's zone. The result
 * keeps its one column as Anaplan wrote it. This is how the page shows it, as it shows an import's Source Object as four
 * columns (result-view.ts `splitColumn`).
 * - A cell that names a moment is said as its day ("2026-03-12") and its time ("23:19:56", or to the minute where the text
 *   gives no seconds). The text that was read is kept for the row under Start Time (`exported`), named by the file's own
 *   header (`readUnder`): a row's details show it under As read, and the row is sorted, and kept by a range of days, by it.
 * - A cell that names no moment, empty or any other text, stands as it is under Start Date, and Start Time is empty.
 * What the view kept by a column's place (`exported`, `readUnder`, `opensFrom`) is kept by the place that column has now,
 * a cell beyond the headers stays after them, and a row the view shows as a heading is one in its copy too. A table
 * without the column is the view as it is. */
export function splitTimes(view: FileView): FileView {
  const { table } = view;
  const at = table.headers.findIndex(header => cellText(header) === START_COLUMN);
  if (at < 0) return view;
  const time = at + 1;
  const moved = (index: number): number => (index > at ? index + 1 : index);
  const exported = new Map<readonly Cell[], ReadonlyMap<number, Cell>>();
  const rows = table.rows.map(row => {
    const cell = row[at] ?? "";
    const moment = utcMoment(cellText(cell));
    const shown: Cell[] = [...Array.from({ length: at }, (_, index) => row[index] ?? ""), ...(moment ? dateAndTime(moment, "UTC") : [cell, ""]), ...row.slice(at + 1)];
    const kept = new Map([...(view.exported?.get(row) ?? [])].map(([index, text]): [number, Cell] => [moved(index), text]));
    if (moment) kept.set(time, cell);
    if (kept.size) exported.set(shown, kept);
    return shown;
  });
  const headers = table.headers.flatMap((header, index) => (index === at ? [START_DATE, START_TIME] : [header]));
  const readUnder = new Map([...(view.readUnder ?? [])].map(([index, name]): [number, string] => [moved(index), name]));
  readUnder.set(time, cellText(table.headers[at]));
  const headings = view.headings && new Set(rows.filter((_, index) => view.headings?.has(table.rows[index])));
  return {
    ...view, table: { ...table, headers, rows }, exported, readUnder,
    ...(view.opensFrom === undefined ? {} : { opensFrom: moved(view.opensFrom) }), ...(headings ? { headings } : {}),
  };
}

/** A table with its actions' start (`splitTimes`) in the zone chosen. In UTC the table is the one given, as the file has
 * its times, and so it is for a viewer whose zone is UTC. In another zone each row whose start names a moment says its
 * day and its time as the viewer's clock read them, from the text that was read, and the two headers name the zone
 * (`localHeader`); a row whose start named no moment is the table's own. The table has the same columns, rows and widths
 * in either zone: only the two columns' names and cells change. What the view kept of a row stays kept, in the copy of
 * the row with its times changed, and a row shown as a heading is one in its copy too. */
export function inTimeMode(view: FileView, mode: TimeMode, zone: string): FileView {
  const { table } = view;
  const start = startColumns(table.headers, "UTC");
  if (mode === "utc" || zone === "UTC" || !start) return view;
  const exported = new Map(view.exported ?? []);
  const rows = table.rows.map(row => {
    const kept = view.exported?.get(row);
    const moment = kept && utcMoment(cellText(kept.get(start.time)));
    if (!kept || !moment) return row;
    const said = [...row];
    [said[start.date], said[start.time]] = dateAndTime(moment, zone);
    exported.delete(row);
    exported.set(said, kept);
    return said;
  });
  const headers = table.headers.map((header, index) => (index === start.date || index === start.time ? localHeader(cellText(header), zone) : header));
  const headings = view.headings && new Set(rows.filter((_, index) => view.headings?.has(table.rows[index])));
  return { ...view, table: { ...table, headers, rows }, exported, ...(headings ? { headings } : {}) };
}

/** Whether a file's table shows an action's start (`splitTimes`), which the switch says again in another zone. */
export const hasTimes = (view: FileView): boolean => startColumns(view.table.headers, "UTC") !== undefined;

/** What a row is sorted by in Start Date and in Start Time alike: the moment, as the UTC text that was read says it,
 * which runs as the moments do, the date and the time together and also where the clock's own text runs back for an hour
 * when the clocks go back; or, for a row whose start named no moment, the text that stands under Start Date. */
export function startText(exported: FileView["exported"], row: readonly Cell[], start: StartColumns): string {
  return cellText(exported?.get(row)?.get(start.time) ?? row[start.date]);
}

/** A row as the file has its start: Start Date and Start Time one cell again, the text that was read, or the text that
 * stands under Start Date where it named no moment. A key an earlier version made of a whole row (view-keep.ts `rowKey`)
 * finds the row by it, in either zone. A table without the two columns has its rows as they are. */
export function fileRow(headers: readonly Cell[], exported: FileView["exported"], row: readonly Cell[], zone: string): readonly Cell[] {
  const start = startColumns(headers, zone);
  if (!start) return row;
  const read = exported?.get(row)?.get(start.time) ?? row[start.date] ?? "";
  return row.flatMap((cell, index) => (index === start.time ? [] : [index === start.date ? read : cell]));
}

/** The moment each row's start names, by the row, from the text that was read, which `exported` keeps under Start Time
 * (`index`): what a range of days set in one zone keeps rows by in either (`momentRange`). Nothing for a row whose start
 * named none. */
export function momentsOf(rows: readonly (readonly Cell[])[], exported: FileView["exported"], index: number): Map<readonly Cell[], number | undefined> {
  return new Map(rows.map(row => [row, utcMoment(cellText(exported?.get(row)?.get(index)))?.ms]));
}

/** A range of whole days set in a zone, as the moments it keeps: from the first moment of `from` to the last of `to` in
 * that zone, either end left open. The same rows are kept whichever zone the times are shown in. */
export function momentRange(from: number | undefined, to: number | undefined, zone: string): { from?: number; to?: number } {
  return { ...(from === undefined ? {} : { from: dayStart(from, zone) }), ...(to === undefined ? {} : { to: dayStart(to + 1, zone) - 1 }) };
}

/** How the page names a zone a range's days were set in: UTC, the viewer's own zone as "local", or any other by its
 * name, for days set in a zone the browser no longer has. */
export const zoneWords = (zone: string, own: string): string => (zone === "UTC" ? "UTC" : zone === own ? "local" : zone);
