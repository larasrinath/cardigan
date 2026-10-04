import { describe, expect, it } from "vitest";
import { analysedLine, analysedWhen, NOT_KEPT_NOTE, notKeptNote, TOO_LARGE_NOTE } from "./keep-notes.js";

// Times are made on the clock of whoever runs the tests, as the page reads them on its user's: the same on every clock.
const at = (year: number, month: number, day: number, hour: number, minute: number, second = 0): Date => new Date(year, month - 1, day, hour, minute, second);

describe("What the results page says about a result kept across a refresh", () => {
  it("says when a result was analysed as someone looking at the page now would: today, yesterday, or the day in full", () => {
    const now = at(2026, 10, 3, 22, 10);
    expect(analysedWhen(at(2026, 10, 3, 21, 34), now)).toBe("today at 21:34");
    // The clock is the day's 24 hours, each part with two digits; the seconds are not said.
    expect(analysedWhen(at(2026, 10, 3, 9, 5, 59), now)).toBe("today at 09:05");
    expect(analysedWhen(at(2026, 10, 3, 0, 0), now)).toBe("today at 00:00");
    // The day is the calendar's, not the last 24 hours: a minute before midnight was yesterday, a minute after was today.
    expect(analysedWhen(at(2026, 10, 2, 23, 59), at(2026, 10, 3, 0, 1))).toBe("yesterday at 23:59");
    expect(analysedWhen(at(2026, 10, 3, 0, 1), at(2026, 10, 3, 23, 59))).toBe("today at 00:01");
    expect(analysedWhen(at(2026, 10, 2, 0, 0), now)).toBe("yesterday at 00:00");
    // Anything else is said by its day in full, which a tab left open for days, or one the browser brings back, can be.
    expect(analysedWhen(at(2026, 10, 1, 21, 34), now)).toBe("on 1 October 2026 at 21:34");
    expect(analysedWhen(at(2025, 12, 31, 7, 3), now)).toBe("on 31 December 2025 at 07:03");
    // Across a month's and a year's end, yesterday is still yesterday.
    expect([analysedWhen(at(2026, 9, 30, 8, 0), at(2026, 10, 1, 8, 0)), analysedWhen(at(2025, 12, 31, 8, 0), at(2026, 1, 1, 8, 0))]).toEqual(["yesterday at 08:00", "yesterday at 08:00"]);
    // A time after now, as a clock that was set back gives: the same day is today, a later day is said in full.
    expect([analysedWhen(at(2026, 10, 3, 23, 0), now), analysedWhen(at(2026, 10, 4, 1, 0), now)]).toEqual(["today at 23:00", "on 4 October 2026 at 01:00"]);
    // A time that is none is not said as one.
    expect(analysedWhen(new Date(NaN), now)).toBe("earlier");
  });

  it("puts that in a line that also says what reads Anaplan anew, by the run control's name", () => {
    const now = at(2026, 10, 3, 22, 10);
    expect(analysedLine(at(2026, 10, 3, 21, 34), now)).toBe("Analysed today at 21:34. Choose Run again to read Anaplan again.");
    expect(analysedLine(at(2026, 9, 28, 6, 0), now)).toBe("Analysed on 28 September 2026 at 06:00. Choose Run again to read Anaplan again.");
    expect(analysedLine(new Date(NaN), now)).toBe("Analysed earlier. Choose Run again to read Anaplan again.");
  });

  it("has a note for a result that is too large to keep, another for one that could not be kept, and none for one a later result replaced", () => {
    expect([TOO_LARGE_NOTE, NOT_KEPT_NOTE]).toEqual(["This result is too large to keep across a refresh. If you refresh this page, run the analysis again.",
      "This result will not survive a refresh of this page."]);
    expect([notKeptNote("too-large"), notKeptNote("unavailable"), notKeptNote("failed"), notKeptNote("superseded")]).toEqual([TOO_LARGE_NOTE, NOT_KEPT_NOTE, NOT_KEPT_NOTE, undefined]);
    // Neither note calls it a failure of the analysis: the result is on the page.
    for (const note of [TOO_LARGE_NOTE, NOT_KEPT_NOTE]) expect(note).not.toMatch(/fail|error|stopped/i);
  });
});
