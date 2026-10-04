import { runLabel } from "./connection.js";
import type { KeepOutcome } from "./keep-result.js";

/** What the results page says about a result that is kept while its tab is refreshed (keep-result.ts): when a result that
 * was brought back after a refresh was analysed, and that a result will not be there after one. Each is a sentence of the
 * page's own; why a result could not be kept is the keeper's sentence, which goes into the run's log. */

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const two = (number: number): string => String(number).padStart(2, "0");
/** A time's day on the user's own clock, counted in days, so that two times of one calendar day give the same number. */
const dayOf = (time: Date): number => Date.UTC(time.getFullYear(), time.getMonth(), time.getDate()) / 86_400_000;

/** When a result was analysed, as someone who looks at the page at `now` would say it, on the user's own clock: "today at
 * 21:34", "yesterday at 09:05", or the day in full for anything else ("on 1 October 2026 at 21:34"), which a results tab
 * left open, or one the browser brings back, can be. */
export function analysedWhen(received: Date, now: Date): string {
  if (Number.isNaN(received.getTime())) return "earlier";
  const clock = `${two(received.getHours())}:${two(received.getMinutes())}`;
  const days = dayOf(now) - dayOf(received);
  if (days === 0) return `today at ${clock}`;
  if (days === 1) return `yesterday at ${clock}`;
  return `on ${received.getDate()} ${MONTHS[received.getMonth()]} ${received.getFullYear()} at ${clock}`;
}

/** The line above a result that was brought back after a refresh: when it was analysed, and what reads Anaplan anew. The
 * run control is named as it then reads. */
export const analysedLine = (received: Date, now: Date): string => `Analysed ${analysedWhen(received, now)}. Choose ${runLabel(true)} to read Anaplan again.`;

/** What the page says above a result that is too large to keep: a note, not a failure. The result is whole and on the page. */
export const TOO_LARGE_NOTE = "This result is too large to keep across a refresh. If you refresh this page, run the analysis again.";
/** And above one that could not be kept for another reason: the tab has no session storage, or keeping it failed. */
export const NOT_KEPT_NOTE = "This result will not survive a refresh of this page.";

/** The page's note for a result that was not kept, by the keeper's reason. Nothing for a result that a later one took the
 * place of before it was kept: that later one has its own outcome. */
export function notKeptNote(reason: Extract<KeepOutcome, { kept: false }>["reason"]): string | undefined {
  return reason === "superseded" ? undefined : reason === "too-large" ? TOO_LARGE_NOTE : NOT_KEPT_NOTE;
}
