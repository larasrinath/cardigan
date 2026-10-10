import { afterEach, describe, expect, it, vi } from "vitest";
import type { Cell } from "../result-types.js";
import type { FileView } from "./result-view.js";
import { fixTimeZone } from "./time-zone.test-support.js";
import { bothTimes, browserZone, chosenTime, dayStart, fileLabel, fileRow, hasTimes, inTimeMode, localHeader, momentRange, momentsOf, readText, storedTimeMode,
  storeTimeMode, TIMES_KEY, timesOf, utcMoment, zoneText, zoneWords } from "./times.js";

const DAY = 86_400_000;
const at = (text: string): number => Date.parse(text);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Times in the viewer's zone or in UTC", () => {
  it("reads a moment as Anaplan and the export write one, in UTC, and no date without a time", () => {
    expect([utcMoment("2026-03-12 23:19:56"), utcMoment("2026-10-03 14:02 UTC"), utcMoment(" 2026-09-30T08:00:00.000Z "), utcMoment("2026-09-30T13:30:00+05:30")])
      .toEqual([{ ms: at("2026-03-12T23:19:56Z"), seconds: true }, { ms: at("2026-10-03T14:02:00Z"), seconds: false }, { ms: at("2026-09-30T08:00:00Z"), seconds: true },
        { ms: at("2026-09-30T08:00:00Z"), seconds: true }]);
    // A day alone, a day or an hour no calendar or clock has, an offset no zone has, and any other text name no moment.
    expect(["2026-03-12", "2026-02-30 10:00", "2026-03-12 24:00", "2026-03-12 10:61", "2026-03-12 10:00+15:00", "12/03/2026 10:00", "", "Yesterday"].map(utcMoment))
      .toEqual([undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined]);
  });

  it("says a moment as a zone's clock reads it, to the second or the minute as it was read, the same whatever the language", () => {
    const moment = { ms: at("2026-03-12T23:19:56Z"), seconds: true };
    expect([zoneText(moment, "UTC"), zoneText(moment, "Asia/Tokyo"), zoneText(moment, "America/New_York"), zoneText({ ...moment, seconds: false }, "Asia/Tokyo")])
      .toEqual(["2026-03-12 23:19:56", "2026-03-13 08:19:56", "2026-03-12 19:19:56", "2026-03-13 08:19"]);
    // Midnight is 00, never 24, and summer time is the zone's own: New York is four hours behind UTC in July, five in January.
    expect([zoneText({ ms: at("2026-07-01T04:00:00Z"), seconds: false }, "America/New_York"), zoneText({ ms: at("2026-01-01T05:00:00Z"), seconds: false }, "America/New_York")])
      .toEqual(["2026-07-01 00:00", "2026-01-01 00:00"]);
  });

  it("finds when a day begins in a zone, on a day the clocks change too", () => {
    const day = (text: string) => Date.parse(`${text}T00:00:00Z`) / DAY;
    expect([dayStart(day("2026-03-13"), "UTC"), dayStart(day("2026-03-13"), "Asia/Tokyo"), dayStart(day("2026-03-08"), "America/New_York"), dayStart(day("2026-03-09"), "America/New_York")])
      .toEqual([at("2026-03-13T00:00:00Z"), at("2026-03-12T15:00:00Z"), at("2026-03-08T05:00:00Z"), at("2026-03-09T04:00:00Z")]);
    // A range of days is the moments from the first one's start to the last one's end, either end left open.
    expect([momentRange(day("2026-03-13"), day("2026-03-13"), "Asia/Tokyo"), momentRange(undefined, day("2026-03-13"), "UTC"), momentRange(undefined, undefined, "UTC")])
      .toEqual([{ from: at("2026-03-12T15:00:00Z"), to: at("2026-03-13T15:00:00Z") - 1 }, { to: at("2026-03-14T00:00:00Z") - 1 }, {}]);
  });

  it("names a column of times by its header, in the viewer's zone as the page shows it, and the file's name for it in either zone", () => {
    expect(["Start Date and Time (UTC)", "Start Date and Time (Asia/Tokyo)", "Start Date and Time (Europe/Paris)", "Start Date and Time", "UTC offset"]
      .map(header => timesOf(header, "Asia/Tokyo"))).toEqual(["utc", "local", undefined, undefined, undefined]);
    // A viewer whose zone is UTC has no other: the header says UTC either way.
    expect([timesOf("Start Date and Time (UTC)", "UTC"), fileLabel("Start Date and Time (UTC)", "UTC")]).toEqual(["utc", "Start Date and Time (UTC)"]);
    expect([localHeader("Start Date and Time (UTC)", "Asia/Tokyo"), ...["Start Date and Time (Asia/Tokyo)", "Start Date and Time (UTC)", "Notes (Europe/Paris)", "Notes"].map(label => fileLabel(label, "Asia/Tokyo"))])
      .toEqual(["Start Date and Time (Asia/Tokyo)", "Start Date and Time (UTC)", "Start Date and Time (UTC)", "Notes (Europe/Paris)", "Notes"]);
    expect([zoneWords("UTC", "Asia/Tokyo"), zoneWords("Asia/Tokyo", "Asia/Tokyo"), zoneWords("Europe/Paris", "Asia/Tokyo")]).toEqual(["UTC", "local", "Europe/Paris"]);
  });

  it("says a file's times in the viewer's zone, keeping what was read for each, and leaves the file's own table in UTC", () => {
    const headers = ["", "Start Date and Time (UTC)", "Notes"];
    const rows: Cell[][] = [["Load", "2026-03-12 23:19:56", "Nightly"], ["Copy", "", ""], ["Odd", "soon", ""]];
    const heading = rows[2];
    const view: FileView = { table: { file: "Imports.csv", label: "Imports", headers, rows, guard: false }, exported: new Map([[rows[0], new Map([[2, "Nightly as read"]])]]),
      headings: new Set([heading]) };
    expect(inTimeMode(view, "utc", "Asia/Tokyo")).toBe(view);
    const local = inTimeMode(view, "local", "Asia/Tokyo");
    expect(inTimeMode(view, "local", "UTC")).toBe(view);
    expect([local.table.headers, local.table.rows]).toEqual([["", "Start Date and Time (Asia/Tokyo)", "Notes"], [["Load", "2026-03-13 08:19:56", "Nightly"], ["Copy", "", ""], ["Odd", "soon", ""]]]);
    // A changed row keeps what the view kept of it beside the time that was read; a row with no moment is the file's own,
    // a heading among them too.
    const [load] = local.table.rows;
    expect([[...(local.exported?.get(load) ?? [])], local.table.rows[1] === rows[1], local.headings?.has(heading), view.table.rows[0][1]])
      .toEqual([[[2, "Nightly as read"], [1, "2026-03-12 23:19:56"]], true, true, "2026-03-12 23:19:56"]);
    // A row is sorted and known by what was read: the same row in either zone.
    expect([readText(local.exported, load, 1), readText(local.exported, load, 2), fileRow(local.table.headers, local.exported, load, "Asia/Tokyo"), [...momentsOf(local.table.rows, local.exported, 1).values()]])
      .toEqual(["2026-03-12 23:19:56", "Nightly as read", ["Load", "2026-03-12 23:19:56", "Nightly"], [at("2026-03-12T23:19:56Z"), undefined, undefined]]);
    expect([hasTimes(view), hasTimes({ table: { ...view.table, headers: ["", "Notes"] } })]).toEqual([true, false]);
  });

  it("says a time on its own in the zone chosen, and in both, the chosen first", () => {
    expect([chosenTime("2026-10-03 14:02 UTC", "local", "Asia/Tokyo"), chosenTime("2026-10-03 14:02 UTC", "utc", "Asia/Tokyo"), chosenTime("2026-10-03", "local", "Asia/Tokyo")])
      .toEqual(["2026-10-03 23:02 local", "2026-10-03 14:02 UTC", "2026-10-03"]);
    expect([bothTimes("2026-03-12 23:19:56", "local", "Asia/Tokyo"), bothTimes("2026-03-12 23:19:56", "utc", "Asia/Tokyo"), bothTimes("Model one", "local", "UTC")])
      .toEqual(["2026-03-13 08:19:56 local · 2026-03-12 23:19:56 UTC", "2026-03-12 23:19:56 UTC · 2026-03-13 08:19:56 local", undefined]);
  });

  it("keeps the viewer's choice where the browser lets it, and shows local times where it does not", () => {
    const stored = new Map<string, string>();
    let refuses = false;
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => { if (refuses) throw new Error("No storage."); return stored.get(key) ?? null; },
      setItem: (key: string, value: string) => { if (refuses) throw new Error("No storage."); stored.set(key, value); },
    });
    expect(storedTimeMode()).toBe("local");
    storeTimeMode("utc");
    expect([stored.get(TIMES_KEY), storedTimeMode()]).toEqual(["utc", "utc"]);
    stored.set(TIMES_KEY, "Mars");
    expect(storedTimeMode()).toBe("local");
    refuses = true;
    expect(() => storeTimeMode("utc")).not.toThrow();
    expect(storedTimeMode()).toBe("local");
  });

  it("asks the browser for the viewer's zone", () => {
    fixTimeZone("Asia/Tokyo");
    expect(browserZone()).toBe("Asia/Tokyo");
  });
});
