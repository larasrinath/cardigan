import { describe, expect, it } from "vitest";
import { formatCells, formatCount, lineWidth, plural, shorten, splitName, wrapLines } from "./map-text.js";
import { HALF_EM } from "./map-fakes.test-support.js";

describe("The map's names and numbers", () => {
  it("takes a first word for a module's code: the word before a dash, or a word of capitals and digits", () => {
    expect(splitName("REV01 - Revenue Plan")).toEqual({ code: "REV01", label: "Revenue Plan" });
    expect(splitName("REV01 - Plan - Draft")).toEqual({ code: "REV01", label: "Plan - Draft" });
    expect(splitName("REV01 \u2013 Revenue Plan")).toEqual({ code: "REV01", label: "Revenue Plan" });
    // Without a dash, the word has to look like a code.
    expect(splitName("SYS01 Time Settings")).toEqual({ code: "SYS01", label: "Time Settings" });
    expect(splitName("C3 Account Details")).toEqual({ code: "C3", label: "Account Details" });
    expect(splitName("REV01.2 Revenue by Region")).toEqual({ code: "REV01.2", label: "Revenue by Region" });
    expect(splitName("Revenue Plan")).toEqual({ code: "", label: "Revenue Plan" });
    expect(splitName("FY27 plan")).toEqual({ code: "FY27", label: "plan" });
    expect(splitName("2026 Plan")).toEqual({ code: "", label: "2026 Plan" });
    expect(splitName("Sys01 Time")).toEqual({ code: "", label: "Sys01 Time" });
  });

  it("reads a name with a very long run of spaces in the time it takes to pass over it", () => {
    const spaces = " ".repeat(200_000);
    const names = [
      `SYS01${spaces}`, `SYS01${spaces}- Time`, `SYS01 -${spaces}`, `SYS01 -${spaces}Time`, `${spaces}SYS01 - Time`, `Time${spaces}Settings${spaces}`,
      `A${spaces}-${spaces}`, `SYS01\n${spaces}- Time\n${spaces}`, `SYS01${"\t".repeat(200_000)}- Time`, `SYS01 ${"- ".repeat(100_000)}`,
    ];
    const start = performance.now();
    for (const name of names) splitName(name);
    // A pattern that tries every place in the run for every other takes minutes for these; passing over them once, a
    // few milliseconds. The bound is far from both.
    expect(performance.now() - start).toBeLessThan(1000);
    expect(splitName(`SYS01${spaces}- Time`)).toEqual({ code: "SYS01", label: "Time" });
    expect(splitName(`SYS01${spaces}Time`)).toEqual({ code: "SYS01", label: "Time" });
    expect(splitName(`Time${spaces}Settings`).code).toBe("");
  });

  it("leaves a name whole that has no code: no first word before a dash, more than one, or nothing after it", () => {
    expect(splitName("Revenue-Plan")).toEqual({ code: "", label: "Revenue-Plan" });
    expect(splitName("Stock Cover - Weekly")).toEqual({ code: "", label: "Stock Cover - Weekly" });
    expect(splitName("SYS01")).toEqual({ code: "", label: "SYS01" });
    expect(splitName("")).toEqual({ code: "", label: "" });
  });
  it("says a count with its thousands apart, and nothing as 0", () => {
    expect([formatCount(0), formatCount(999), formatCount(12345), formatCount(1234567), formatCount(undefined), formatCount(NaN)]).toEqual(["0", "999", "12,345", "1,234,567", "0", "0"]);
  });

  it("cuts a cell count short by thousands, millions and billions", () => {
    expect([formatCells(0), formatCells(999), formatCells(1000), formatCells(15499), formatCells(2_500_000), formatCells(3_210_000_000), formatCells(undefined)])
      .toEqual(["0", "999", "1.0K", "15.5K", "2.50M", "3.21B", "0"]);
  });

  it("says a count with its noun, one or many", () => {
    expect([plural(1, "module"), plural(0, "module"), plural(2300, "line item"), plural(2, "match", "matches"), plural(1, "match", "matches")])
      .toEqual(["1 module", "0 modules", "2,300 line items", "2 matches", "1 match"]);
  });
});

describe("A label cut to the room a node gives it", () => {
  it("measures a line as its words and the spaces between them", () => {
    expect(lineWidth("Units", HALF_EM)).toBe(2.5);
    expect(lineWidth("Net  Revenue", HALF_EM)).toBe(1.5 + 0.25 + 3.5);
    expect(lineWidth("", HALF_EM)).toBe(0);
  });

  it("leaves a line that fits as it is, and cuts one that does not where the mark still fits", () => {
    expect(shorten("Revenue", 3.5, HALF_EM)).toBe("Revenue");
    // Five characters and the mark are three ems.
    expect(shorten("Revenue Plan", 3, HALF_EM)).toBe("Reven…");
    // A space before the mark is dropped.
    expect(shorten("Net Revenue", 2.5, HALF_EM)).toBe("Net…");
    expect(shorten("Revenue", 0.2, HALF_EM)).toBe("…");
  });

  it("puts words on the next line when the line is full, up to the number of lines there is room for", () => {
    expect(wrapLines("Net Revenue Plan", 4, 2, HALF_EM)).toEqual(["Net", "Revenue…"]);
    expect(wrapLines("Net Revenue Plan", 6.5, 2, HALF_EM)).toEqual(["Net Revenue", "Plan"]);
    expect(wrapLines("Net Revenue Plan", 20, 2, HALF_EM)).toEqual(["Net Revenue Plan"]);
  });

  it("fills the last line before it leaves anything out", () => {
    // One line of six ems: "Volume" alone would leave half of it empty.
    expect(wrapLines("Volume Assumptions", 6, 1, HALF_EM)).toEqual(["Volume Assu…"]);
    expect(wrapLines("Opening Balance Brought Forward", 5, 2, HALF_EM)).toEqual(["Opening", "Balance B…"]);
  });

  it("cuts a word that is wider than the line, and gives nothing for an empty label", () => {
    expect(wrapLines("Supercalifragilistic", 3, 2, HALF_EM)).toEqual(["Super…"]);
    expect(wrapLines("A Supercalifragilistic", 3, 2, HALF_EM)).toEqual(["A", "Super…"]);
    expect(wrapLines("", 3, 2, HALF_EM)).toEqual([]);
    expect(wrapLines("   ", 3, 2, HALF_EM)).toEqual([]);
  });

  it("reads no more of a long text than the lines it gives can show", () => {
    const asked: string[] = [];
    const counting = { ...HALF_EM, word: (text: string) => { asked.push(text); return HALF_EM.word(text); } };
    const long = Array.from({ length: 50_000 }, (_, index) => `word${index}`).join(" ");
    // A line of ten ems holds three words of five letters, and the last line a little of a fourth before the mark.
    expect(wrapLines(long, 10, 2, counting)).toEqual(["word0 word1 word2", "word3 word4 word5 wo…"]);
    // Seven words were measured for that, and a few of their letters to cut the last line: not fifty thousand.
    expect([...new Set(asked.filter(text => text.length > 1))]).toEqual(["word0", "word1", "word2", "word3", "word4", "word5", "word6"]);
    expect(asked.length).toBeLessThan(40);
  });

  it("never gives more lines than asked for, and at least one", () => {
    expect(wrapLines("a b c d e f g h", 0.5, 3, HALF_EM)).toHaveLength(3);
    expect(wrapLines("a b c d", 0.5, 0, HALF_EM)).toHaveLength(1);
  });
});
