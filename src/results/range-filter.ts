import { rangeValue, type RangeKind } from "./table-engine.js";

/** A range filter as the user set it, for a column of numbers or of dates (columns.ts `rangeOf`): what its two boxes say,
 * as typed, and what they are worth in the column's terms, a number or a day (table-engine.ts `rangeValue`), either of
 * them left open; and whether the cells that say nothing are kept. The page keeps one for each column whose range leaves
 * out a row, and none for a column whose filter keeps every row. */
export interface RangeState {
  fromText: string;
  toText: string;
  from?: number;
  to?: number;
  blanks: boolean;
}

/** What two boxes of a range say: their values, or why they say nothing a range can keep, with the box at fault. A box
 * left empty is an open end. Nothing is taken from a box that cannot be read: the range stays as it was, and the box says
 * what is wrong. */
export type RangeRead = { from?: number; to?: number } | { problem: string; at: "from" | "to" };

export function readRange(kind: RangeKind, fromText: string, toText: string): RangeRead {
  const ends: Record<"from" | "to", number | undefined> = { from: undefined, to: undefined };
  for (const [at, text, name] of [["from", fromText, "From"], ["to", toText, "To"]] as const) {
    const typed = text.trim();
    if (typed === "") continue;
    const value = rangeValue(typed, kind);
    if (value === undefined) {
      return { problem: kind === "date" ? `${name}: "${typed}" is not a date. Write it as year, month and day: 2026-03-12.`
        : `${name}: "${typed}" is not a number. Write it as 1200, 1,200, -3.5 or 40%.`, at };
    }
    ends[at] = value;
  }
  if (ends.from !== undefined && ends.to !== undefined && ends.from > ends.to) return { problem: "From is after To: nothing lies between them.", at: "from" };
  return { ...(ends.from === undefined ? {} : { from: ends.from }), ...(ends.to === undefined ? {} : { to: ends.to }) };
}

/** Whether a range leaves a row out: it has an end, or it leaves out the cells that say nothing. */
export const rangeInForce = (state: RangeState | undefined): boolean => state !== undefined && (state.from !== undefined || state.to !== undefined || !state.blanks);

/** What a range keeps, in a few words, as the column's filter button says it: "≥ 10", "≤ 100", "10–100", "= 3", and for
 * dates "from 2026-01-01", "until 2026-03-31", "2026-01-01 to 2026-03-31", "on 2026-03-12"; with ", no blanks" where the
 * cells that say nothing are left out, which alone is "no blank cells". Each end is said as it was typed. */
export function rangeSummary(kind: RangeKind, state: RangeState): string {
  const from = state.from === undefined ? undefined : state.fromText.trim();
  const to = state.to === undefined ? undefined : state.toText.trim();
  let ends = "";
  if (from !== undefined && to !== undefined) {
    if (state.from === state.to) ends = kind === "date" ? `on ${from}` : `= ${from}`;
    else ends = kind === "date" ? `${from} to ${to}` : from.startsWith("-") || to.startsWith("-") ? `${from} to ${to}` : `${from}–${to}`;
  } else if (from !== undefined) ends = kind === "date" ? `from ${from}` : `≥ ${from}`;
  else if (to !== undefined) ends = kind === "date" ? `until ${to}` : `≤ ${to}`;
  if (state.blanks) return ends;
  return ends === "" ? "no blank cells" : `${ends}, no blanks`;
}
