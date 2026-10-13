import { afterEach, describe, expect, it, vi } from "vitest";
import type { Cell } from "../result-types.js";
import type { FileView } from "./result-view.js";
import { fixTimeZone } from "./time-zone.test-support.js";
import { browserZone, dateAndTime, dayStart, fileLabel, fileRow, hasTimes, inTimeMode, localHeader, momentRange, momentsOf, splitTimes, START_COLUMN, START_DATE,
  START_TIME, startColumns, startText, storedTimeMode, storeTimeMode, TIMES_KEY, timesOf, utcMoment, zoneText, zoneWords } from "./times.js";

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
    // Its day and its time of day apart, as Start Date and Start Time say them.
    expect([dateAndTime(moment, "UTC"), dateAndTime(moment, "Asia/Tokyo"), dateAndTime({ ...moment, seconds: false }, "America/New_York")])
      .toEqual([["2026-03-12", "23:19:56"], ["2026-03-13", "08:19:56"], ["2026-03-12", "19:19"]]);
  });

  it("finds when a day begins in a zone, on a day the clocks change too", () => {
    const day = (text: string) => Date.parse(`${text}T00:00:00Z`) / DAY;
    expect([dayStart(day("2026-03-13"), "UTC"), dayStart(day("2026-03-13"), "Asia/Tokyo"), dayStart(day("2026-03-08"), "America/New_York"), dayStart(day("2026-03-09"), "America/New_York")])
      .toEqual([at("2026-03-13T00:00:00Z"), at("2026-03-12T15:00:00Z"), at("2026-03-08T05:00:00Z"), at("2026-03-09T04:00:00Z")]);
    // A range of days is the moments from the first one's start to the last one's end, either end left open.
    expect([momentRange(day("2026-03-13"), day("2026-03-13"), "Asia/Tokyo"), momentRange(undefined, day("2026-03-13"), "UTC"), momentRange(undefined, undefined, "UTC")])
      .toEqual([{ from: at("2026-03-12T15:00:00Z"), to: at("2026-03-13T15:00:00Z") - 1 }, { to: at("2026-03-14T00:00:00Z") - 1 }, {}]);
  });

  it("names a column of times by its header, in the viewer's zone as the page shows it, and by its name in UTC in either zone", () => {
    expect(["Start Date (UTC)", "Start Time (Asia/Tokyo)", "Start Date (Europe/Paris)", "Start Date and Time", "UTC offset"]
      .map(header => timesOf(header, "Asia/Tokyo"))).toEqual(["utc", "local", undefined, undefined, undefined]);
    // A viewer whose zone is UTC has no other: the header says UTC either way.
    expect([timesOf(START_DATE, "UTC"), fileLabel(START_DATE, "UTC")]).toEqual(["utc", "Start Date (UTC)"]);
    expect([localHeader(START_TIME, "Asia/Tokyo"), ...["Start Date (Asia/Tokyo)", "Start Time (UTC)", "Notes (Europe/Paris)", "Notes"].map(label => fileLabel(label, "Asia/Tokyo"))])
      .toEqual(["Start Time (Asia/Tokyo)", "Start Date (UTC)", "Start Time (UTC)", "Notes (Europe/Paris)", "Notes"]);
    // A table's Start Date and Start Time, by their names in either zone; none where the start is one column, or one of
    // the two is missing.
    expect([startColumns(["", "Start Date (Asia/Tokyo)", "Start Time (Asia/Tokyo)"], "Asia/Tokyo"), startColumns(["", START_DATE, START_TIME], "Asia/Tokyo"),
      startColumns(["", "Notes", START_DATE, START_TIME], "UTC"), startColumns(["", START_COLUMN], "UTC"), startColumns(["", START_DATE], "UTC")])
      .toEqual([{ date: 1, time: 2 }, { date: 1, time: 2 }, { date: 2, time: 3 }, undefined, undefined]);
    expect([zoneWords("UTC", "Asia/Tokyo"), zoneWords("Asia/Tokyo", "Asia/Tokyo"), zoneWords("Europe/Paris", "Asia/Tokyo")]).toEqual(["UTC", "local", "Europe/Paris"]);
  });

  /** A model's file with an action's start, as its rule and the words left it: the Action said in words before the start,
   * Notes after it with its text as read, a column the view names by another of the file's, the rows opening from Notes,
   * a heading, and a cell beyond the headers. Every name is made up. */
  const started = (): FileView => {
    const rows: Cell[][] = [["Load", "Import into Prices", "2026-03-12 23:19:56", "Nightly", "x"], ["Hourly", "", "2026-03-12 23:19", "", "y"], ["Copy", "", "", "", "z"],
      ["Odd", "", "soon", "", "w"], ["Dated", "", "2026-03-12", "", "v", "beyond"]];
    return { table: { file: "Other Actions.csv", label: "Other Actions", headers: ["", "Action", START_COLUMN, "Notes", "Code"], rows, guard: false },
      exported: new Map([[rows[0], new Map<number, Cell>([[1, '{"actionType":"IMPORT"}'], [3, "Nightly as read"]])]]), readUnder: new Map([[4, "Code of the file"]]),
      opensFrom: 3, headings: new Set([rows[3]]) };
  };

  it("shows an action's start as its day and its time in UTC, keeps the text that was read under Start Time, and all the view kept by each column's new place", () => {
    const view = started();
    const split = splitTimes(view);
    expect(split.table.headers).toEqual(["", "Action", "Start Date (UTC)", "Start Time (UTC)", "Notes", "Code"]);
    // To the second or to the minute, as the text gives it. A start that names no moment, empty, another text or a day
    // alone, stands as it is under Start Date, with Start Time empty. A cell beyond the headers stays after them.
    expect(split.table.rows).toEqual([["Load", "Import into Prices", "2026-03-12", "23:19:56", "Nightly", "x"], ["Hourly", "", "2026-03-12", "23:19", "", "y"],
      ["Copy", "", "", "", "", "z"], ["Odd", "", "soon", "", "", "w"], ["Dated", "", "2026-03-12", "", "", "v", "beyond"]]);
    // The text that was read is kept under Start Time, named by the file's own header. What the view kept before the start
    // stays where it was, and what it kept after the start moves with its column; nothing is kept of a start that names no
    // moment. The rows open from Notes still, and the heading is one in its copy.
    const [load, hourly, copy] = split.table.rows;
    expect([[...(split.exported?.get(load) ?? [])], [...(split.exported?.get(hourly) ?? [])], split.exported?.has(copy), [...(split.readUnder ?? [])], split.opensFrom,
      split.headings?.has(split.table.rows[3]), split.headings?.size])
      .toEqual([[[1, '{"actionType":"IMPORT"}'], [4, "Nightly as read"], [3, "2026-03-12 23:19:56"]], [[3, "2026-03-12 23:19"]], false, [[5, "Code of the file"], [3, START_COLUMN]],
        4, true, 1]);
    // The file's own table is as it was, and a table without the column is the view as it is.
    expect([view.table.rows[0], view.table.headers]).toEqual([["Load", "Import into Prices", "2026-03-12 23:19:56", "Nightly", "x"], ["", "Action", START_COLUMN, "Notes", "Code"]]);
    const plain: FileView = { table: { ...view.table, headers: ["", "Action", "Started", "Notes", "Code"] } };
    expect(splitTimes(plain)).toBe(plain);
  });

  it("says each start's day and time in the viewer's zone, keeping what was read, and leaves the table in UTC as it is", () => {
    const split = splitTimes(started());
    expect([inTimeMode(split, "utc", "Asia/Tokyo"), inTimeMode(split, "local", "UTC")].every(view => view === split)).toBe(true);
    const local = inTimeMode(split, "local", "Asia/Tokyo");
    // Only the two columns change: their names, which say the zone, and each start's day and time on the viewer's clock.
    expect([local.table.headers, local.table.rows]).toEqual([["", "Action", "Start Date (Asia/Tokyo)", "Start Time (Asia/Tokyo)", "Notes", "Code"],
      [["Load", "Import into Prices", "2026-03-13", "08:19:56", "Nightly", "x"], ["Hourly", "", "2026-03-13", "08:19", "", "y"], ...split.table.rows.slice(2)]]);
    // A changed row keeps what the view kept of it, what was read among it; a row with no moment is the table's own, a
    // heading among them too.
    const [load] = local.table.rows;
    expect([[...(local.exported?.get(load) ?? [])], local.table.rows[2] === split.table.rows[2], local.headings?.has(split.table.rows[3]), split.table.rows[0][2]])
      .toEqual([[[1, '{"actionType":"IMPORT"}'], [4, "Nightly as read"], [3, "2026-03-12 23:19:56"]], true, true, "2026-03-12"]);
    // A row is sorted and known by what was read, the same in either zone: Start Date and Start Time sort by the whole
    // moment, and a start that named no moment by its text; the row as the file has it holds the start in one cell again.
    const start = startColumns(local.table.headers, "Asia/Tokyo");
    expect(start).toEqual({ date: 2, time: 3 });
    expect([local.table.rows.map(row => startText(local.exported, row, start!)), fileRow(local.table.headers, local.exported, load, "Asia/Tokyo"),
      fileRow(local.table.headers, local.exported, local.table.rows[4], "Asia/Tokyo"), [...momentsOf(local.table.rows, local.exported, start!.time).values()]])
      .toEqual([["2026-03-12 23:19:56", "2026-03-12 23:19", "", "soon", "2026-03-12"], ["Load", "Import into Prices", "2026-03-12 23:19:56", "Nightly", "x"],
        ["Dated", "", "2026-03-12", "", "v", "beyond"], [at("2026-03-12T23:19:56Z"), at("2026-03-12T23:19:00Z"), undefined, undefined, undefined]]);
    expect([hasTimes(split), hasTimes(started())]).toEqual([true, false]);
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
