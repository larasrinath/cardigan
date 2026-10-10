import { describe, expect, it } from "vitest";
import { rangeInForce, rangeSummary, readRange, type RangeState } from "./range-filter.js";
import { dayOf, type RangeKind } from "./table-engine.js";

/** A range as two boxes say it, read as the filter reads them. */
function state(kind: RangeKind, fromText: string, toText: string, blanks = true): RangeState {
  const read = readRange(kind, fromText, toText);
  if ("problem" in read) throw new Error(read.problem);
  return { fromText, toText, ...read, blanks };
}

describe("A range filter's two boxes", () => {
  it("reads what the boxes say: an empty box is an open end, both ends are kept, and a box that cannot be read says what is wrong", () => {
    expect([readRange("number", "10", " 1,000 "), readRange("number", "", ""), readRange("number", "-3.5", ""), readRange("number", "", "40%"), readRange("number", "7", "7")])
      .toEqual([{ from: 10, to: 1000 }, {}, { from: -3.5 }, { to: 40 }, { from: 7, to: 7 }]);
    // A word, or a code of figures, is no number; the box at fault is named.
    expect([readRange("number", "ten", "20"), readRange("number", "1", "0040")]).toEqual([
      { problem: 'From: "ten" is not a number. Write it as 1200, 1,200, -3.5 or 40%.', at: "from" },
      { problem: 'To: "0040" is not a number. Write it as 1200, 1,200, -3.5 or 40%.', at: "to" }]);
    // From after To keeps nothing, and says so at From.
    expect(readRange("number", "20", "10")).toEqual({ problem: "From is after To: nothing lies between them.", at: "from" });
    // Dates by the day, as a box for dates gives them; a day written otherwise, or no day at all, is said to be wrong.
    expect([readRange("date", "2026-03-01", "2026-03-31"), readRange("date", "03/01/2026", ""), readRange("date", "", "2026-02-30")]).toEqual([
      { from: dayOf("2026-03-01"), to: dayOf("2026-03-31") },
      { problem: 'From: "03/01/2026" is not a date. Write it as year, month and day: 2026-03-12.', at: "from" },
      { problem: 'To: "2026-02-30" is not a date. Write it as year, month and day: 2026-03-12.', at: "to" }]);
  });

  it("says what a range keeps in a few words, each end as it was typed, and whether it leaves any row out", () => {
    expect([state("number", "10", "100"), state("number", "10", ""), state("number", "", "100"), state("number", "3", "3"), state("number", "-5", "10"),
      state("number", "", "", false), state("number", "1,000", "", false)].map(range => rangeSummary("number", range)))
      .toEqual(["10–100", "≥ 10", "≤ 100", "= 3", "-5 to 10", "no blank cells", "≥ 1,000, no blanks"]);
    expect([state("date", "2026-01-01", "2026-03-31"), state("date", "2026-01-01", ""), state("date", "", "2026-03-31"), state("date", "2026-03-12", "2026-03-12")]
      .map(range => rangeSummary("date", range))).toEqual(["2026-01-01 to 2026-03-31", "from 2026-01-01", "until 2026-03-31", "on 2026-03-12"]);
    // A range with no end that keeps the blank cells keeps every row: it is no filter.
    expect([rangeInForce(undefined), rangeInForce(state("number", "", "")), rangeInForce(state("number", "", "", false)), rangeInForce(state("number", "1", ""))])
      .toEqual([false, false, true, true]);
  });
});
