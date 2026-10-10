import type { Cell } from "../result-types.js";
import type { FileView } from "./result-view.js";
import { cellText } from "./table-engine.js";

/** The times the page shows, in the viewer's own time zone or in UTC, as the viewer chooses (the switch in the page's
 * header). Anaplan writes a time in UTC: an action's start in the Actions list ("2026-03-12 23:19:56", under a header that
 * ends "(UTC)"), and the export's own time in its Details file ("2026-10-03 14:02 UTC"). In the viewer's zone the page says
 * the same moment as the viewer's clock read it, and says which zone that is: a column's header names the zone in the
 * place of "(UTC)", "Start Date and Time (Europe/London)". A date with no time is no moment, and stays as it is: a day is
 * no later in one zone than in another. The result holds the times as they were read, whichever the page shows. Text in,
 * text out: nothing here reads a page. */

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

/** A column of times as the page shows it in the viewer's zone: "Start Date and Time (Europe/London)". */
export const localHeader = (header: string, zone: string): string => header.replace(UTC_END, zoneEnd(zone));

/** A column's name as the file has it, whichever zone the page shows its times in: what the tab keeps a column's settings
 * by (view-keep.ts `columnKeys`), so that they are the same column's in either, and what a column is known by as a
 * measure (columns.ts `MEASURES`). Any other column's name is its own. */
export const fileLabel = (label: string, zone: string): string =>
  (timesOf(label, zone) === "local" ? `${label.slice(0, -zoneEnd(zone).length)} (UTC)` : label);

/** A file's table with its times in the zone chosen. In UTC the table is the file's, as it was read, and so it is for a
 * viewer whose zone is UTC. In another zone each cell of a column of UTC times that names a moment says it as the viewer's
 * clock read it, the column's header names the zone (`localHeader`), and the text that was read is kept for the cell in
 * `exported`, as a cell said in words keeps its own: a row's drawer shows both times, and the table is sorted by the
 * moment (`sortKey`). A cell that names no moment stays as it is. What the view kept of a row before stays kept, also in
 * the copy of the row with its times changed, and a row shown as a heading is one in its copy too. */
export function inTimeMode(view: FileView, mode: TimeMode, zone: string): FileView {
  const { table } = view;
  const columns = table.headers.flatMap((header, index) => (UTC_END.test(cellText(header)) ? [index] : []));
  if (mode === "utc" || zone === "UTC" || !columns.length) return view;
  const exported = new Map(view.exported ?? []);
  const rows = table.rows.map(row => {
    let said: Cell[] | undefined;
    const texts = new Map<number, Cell>(view.exported?.get(row) ?? []);
    for (const index of columns) {
      const moment = utcMoment(cellText(row[index]));
      if (!moment) continue;
      said ??= [...row];
      said[index] = zoneText(moment, zone);
      texts.set(index, row[index]);
    }
    if (!said) return row;
    exported.delete(row);
    exported.set(said, texts);
    return said;
  });
  const headers = table.headers.map((header, index) => (columns.includes(index) ? localHeader(cellText(header), zone) : header));
  const headings = view.headings && new Set(rows.filter((row, index) => view.headings?.has(table.rows[index])));
  return { ...view, table: { ...table, headers, rows }, exported, ...(headings ? { headings } : {}) };
}

/** Whether a file's table has a column of UTC times, which the switch says again in another zone. */
export const hasTimes = (view: FileView): boolean => view.table.headers.some(header => UTC_END.test(cellText(header)));

/** A cell of a column of times as the file has it: the UTC text that was read, where the page says the cell in the
 * viewer's zone, and else the cell's own text. A row is sorted by it, as it runs as the moments do where the clock's own
 * text runs back for an hour when the clocks go back; and a row is known by it (`fileRow`). */
export function readText(exported: FileView["exported"], row: readonly Cell[], index: number): string {
  return cellText(exported?.get(row)?.get(index) ?? row[index]);
}

/** A row as the file has its times: each cell of a column of times in the viewer's zone (`zone`) as it was read, every
 * other cell as the page shows it. What the tab keeps a row by (view-keep.ts `rowKey`) is the same in either zone. */
export function fileRow(headers: readonly Cell[], exported: FileView["exported"], row: readonly Cell[], zone: string): readonly Cell[] {
  const said = exported?.get(row);
  if (!said) return row;
  let copy: Cell[] | undefined;
  headers.forEach((header, index) => {
    if (timesOf(cellText(header), zone) !== "local" || !said.has(index)) return;
    copy ??= [...row];
    copy[index] = said.get(index) ?? "";
  });
  return copy ?? row;
}

/** The moment each row's cell names in a column of times, by the row, from the text that was read: what a range of days
 * set in one zone keeps rows by in either (`momentRange`). Nothing for a cell that names none. */
export function momentsOf(rows: readonly (readonly Cell[])[], exported: FileView["exported"], index: number): Map<readonly Cell[], number | undefined> {
  return new Map(rows.map(row => [row, utcMoment(readText(exported, row, index))?.ms]));
}

/** A range of whole days set in a zone, as the moments it keeps: from the first moment of `from` to the last of `to` in
 * that zone, either end left open. The same rows are kept whichever zone the times are shown in. */
export function momentRange(from: number | undefined, to: number | undefined, zone: string): { from?: number; to?: number } {
  return { ...(from === undefined ? {} : { from: dayStart(from, zone) }), ...(to === undefined ? {} : { to: dayStart(to + 1, zone) - 1 }) };
}

/** How the page names a zone a range's days were set in: UTC, the viewer's own zone as "local", or any other by its
 * name, for days set in a zone the browser no longer has. */
export const zoneWords = (zone: string, own: string): string => (zone === "UTC" ? "UTC" : zone === own ? "local" : zone);

/** A time in both zones, the one chosen first: "2026-03-13 04:49:56 local · 2026-03-12 23:19:56 UTC", from the UTC text
 * the file holds (`read`). Nothing for a text that names no moment. */
export function bothTimes(read: string, mode: TimeMode, zone: string): string | undefined {
  const moment = utcMoment(read);
  if (!moment) return undefined;
  const local = `${zoneText(moment, zone)} local`;
  const utc = `${zoneText(moment, "UTC")} UTC`;
  return mode === "local" ? `${local} · ${utc}` : `${utc} · ${local}`;
}

/** A time the page says on its own, such as when the export was made: in the zone chosen, said with "local" or "UTC" after
 * it. A text that names no moment stays as it is. */
export function chosenTime(read: string, mode: TimeMode, zone: string): string {
  const moment = utcMoment(read);
  if (!moment) return read;
  return mode === "local" ? `${zoneText(moment, zone)} local` : `${zoneText(moment, "UTC")} UTC`;
}
