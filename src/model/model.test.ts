import { afterEach, describe, expect, it, vi } from "vitest";
import { stampLine } from "../details.js";
import { IMPORTS_ROW_REWORDED, MODEL_ACTIONS_COLUMN_ADDED, MODEL_ACTIONS_ROW_REWORDED, MODEL_COLUMN_ADDED, MODEL_COLUMNS_ADDED, MODEL_FILE_ADDED, MODEL_ROW_ADDED, MODEL_ROW_REWORDED, MODEL_ROWS_FOR_THE_PAGE, MODEL_ZIP_0_6_1, MODEL_ZIP_AS_NAMED, withColumnAdded, withDetailsSince, ZIPPED_AT } from "../golden-0.6.1.test-support.js";
import { ACCESS_CSV, ACCESS_FILE_ADDED, ACCESS_GRIDS, ACCESS_READS_0_8_1, ACCESS_ROWS_FOR_THE_PAGE, ACCESS_ROWS_REWORDED, ACCESS_ZIP_0_8_1, ACCESS_ZIP_WITH_FILE, MAPPINGS_ADDED,
  LIST_IDS_ADDED, MODULE_IDS_ADDED, PAGE_TIME, withAccessRows, withLinesSaid, withMappingsRead, withPageTimes } from "../golden-0.8.1.test-support.js";
import { NOT_SCOPE_IDS, SCOPE_IDS } from "../guards.test-support.js";
import { buildModelGraph } from "../map/build-graph.js";
import { Failure } from "../progress.js";
import { plainResult } from "../result-plain.js";
import { resultZip, tableCsv } from "../result-zip.test-support.js";
import { actionWords } from "../results/readable-cells.js";
import { parseCsv, sameBytes, toCsv, unzipText, zipEntries, zipStore } from "../zip.test-support.js";
import * as access from "./access.js";
import { ACCESS_HEADERS } from "./access.js";
import { againstMap } from "./access.test-support.js";
import { ACTION_LIST_COLUMN, actionKind, mergeImports, missingActionColumns, otherActionsTable } from "./actions.js";
import { CALENDAR_HEADERS, CALENDAR_PROPERTIES, calendarKind, calendarRows } from "./calendar.js";
import { exportModel, lineItemIdsOf, listIdsLine, listIdsOf, moduleIdsLine, moduleIdsOf } from "./export.js";
import { MAPPING_NOTES } from "./import-mappings.js";
import * as grids from "./grid.js";
import { cellText, gridTable, labelEntries, plainText, windowRows, type CellSource, type Grid, type GridRow } from "./grid.js";
import * as lineItems from "./lineitems.js";
import { FORMAT_LIST_COLUMN, lineItemsTable, RATIO_COLUMNS } from "./lineitems.js";
import { assertRead, modelOnPage, readGrid, type Native } from "./native.js";

// Synthetic IDs and names only. Entity type = ID / 1e9 (102 module, 118 process, 4 property), as the classic client encodes it.

/** A fake native `_DataPage`: a rectangle of cells starting at (startRow, 0). */
class FakePage implements CellSource {
  constructor(private readonly page: { startRow: number; rows: string[][] }) {}
  contains(row: number, column: number) { return row >= this.page.startRow && row < this.page.startRow + this.page.rows.length && column < (this.page.rows[0]?.length ?? 0); }
  getIndex(row: number, column: number) { return (row - this.page.startRow) * 1000 + column; }
  getCellText(index: number) { const text = this.page.rows[Math.floor(index / 1000)][index % 1000]; return text === "(null)" ? null : text; }
  getOriginalText(index: number) { return this.getCellText(index) ?? "raw"; }
}

describe("Model export: Model settings grids to tables", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); vi.restoreAllMocks(); });

  it("reads label pages with optional qualifiers, and cell text as the grid shows it", () => {
    const labels = labelEntries({ start: 0, count: 3, entityLongIds: [[102000000001, 1901000000001, 1901000000002], [-1, 102000000001, -1]],
      labels: [["Demand", "Volume &amp; mix", "Price"], [null, "Demand", null]] });
    expect(labels).toEqual([{ ids: [102000000001], labels: ["Demand"] }, { ids: [1901000000001, 102000000001], labels: ["Volume & mix", "Demand"] },
      { ids: [1901000000002], labels: ["Price"] }]);
    expect(plainText("A &lt;b&gt; &#39;c&#39; &#x41;<br/>next")).toBe("A <b> 'c' A\nnext");
    const pages = [new FakePage({ startRow: 10, rows: [["x", "(null)"]] })];
    expect([cellText(pages, 10, 0), cellText(pages, 10, 1), cellText(pages, 11, 0)]).toEqual(["x", "raw", ""]);
    expect(windowRows([{ ids: [1], labels: ["r"] }], 10, 2, pages)).toEqual([{ ids: [1], labels: ["r"], cells: ["x", "raw"] }]);
  });

  it("lays grids out as Anaplan exports them: unlabelled first column, every row, underlying values", () => {
    const grid: Grid = { columns: [{ ids: [4000000009], labels: ["Formula"] }, { ids: [4000000212], labels: ["Format"] }], rows: [
      { ids: [102000000001], labels: ["Demand"], cells: ["", ""] },
      { ids: [1901000000001], labels: ["Volume"], cells: ["Units * Price", '{"dataType":"NUMBER"}'] }] };
    expect(gridTable(grid)).toEqual({ headers: ["", "Formula", "Format"], rows: [["Demand", "", ""], ["Volume", "Units * Price", '{"dataType":"NUMBER"}']] });
    expect(gridTable(grid, row => Math.floor(row.ids[0] / 1e9) === 102).rows).toEqual([["Demand", "", ""]]);
    // The underlying value wins over the display text; display text only when there is none.
    const page: CellSource = { contains: () => true, getIndex: (_r, c) => c, getCellText: c => ["2,252,068", "Number", "Sum &amp; more"][c],
      getOriginalText: c => [2252068, '{"dataType":"NUMBER"}', null][c] };
    expect([0, 1, 2].map(c => cellText([page], 0, c))).toEqual(["2252068", '{"dataType":"NUMBER"}', "Sum & more"]);
    expect(toCsv(["", "Applies To"], [["-- MODEL ADMIN", "-"]], false)).toBe('\ufeff,Applies To\r\n-- MODEL ADMIN,-\r\n');
  });

  it("splits the Actions list at its headings: processes, imports and exports by entity type, everything else under Other Actions", () => {
    expect([actionKind(118, true, false), actionKind(112, false, true), actionKind(116, false, true), actionKind(117, true, true), actionKind(31, false, false)])
      .toEqual(["process", "import", "export", "other", "heading"]);
    // A row the model does not report as an action but that holds values is an action, not a heading.
    expect(actionKind(117, false, true)).toBe("other");
    const actions: Grid = { columns: [{ ids: [1], labels: ["Action"] }, { ids: [2], labels: ["Notes"] }], rows: [
      { ids: [31000000001], labels: ["Processes"], cells: ["", ""] }, { ids: [118000000001], labels: ["Nightly load"], cells: ["", "Runs at 2am"] },
      { ids: [31000000002], labels: ["Other Actions"], cells: ["", ""] }, { ids: [117000000001], labels: ["Delete old items"], cells: ['{"actionType":"DELETE_BY_SELECTION"}', ""] }] };
    const kinds = new Map(actions.rows.map(row => [row, actionKind(Math.floor(row.ids[0] / 1e9), false, row.cells.some(cell => cell !== ""))]));
    expect(gridTable(actions, row => kinds.get(row) === "process")).toEqual({ headers: ["", "Action", "Notes"], rows: [["Nightly load", "", "Runs at 2am"]] });
    expect(gridTable(actions, row => kinds.get(row) === "other").rows).toEqual([["Delete old items", '{"actionType":"DELETE_BY_SELECTION"}', ""]]);
  });

  it("merges the Imports tab with each import's Actions list columns, matched on the import's ID", () => {
    const tab: Grid = { columns: ["Source Label", "Source Object", "Source Type", "Target Object", "Target Type", "Production Data"].map((label, i) => ({ ids: [i], labels: [label] })),
      rows: [{ ids: [112000000001], labels: ["1.1 Load regions"], cells: ["Hub / Regions", "Hub / 'LIST - Regions'.Export", "SAVED VIEW", "Regions", "LIST", "false"] },
        { ids: [112000000002], labels: ["Prices from prices.csv"], cells: ["prices.csv", "-", "FILE", "Prices", "MODULE", "false"] }] };
    const columns = ["Action", "Start Date and Time (UTC)", "Most recent duration (ms)", "Notes", "Used in Processes", "Used in Dashboards"].map((label, i) => ({ ids: [i], labels: [label] }));
    // The Actions list may order its imports differently, and may have one the Imports tab did not return.
    const rows = [{ ids: [112000000002], labels: ["Prices from prices.csv"], cells: ["Import into Prices", "2026-03-12 23:19:56", "582", "", "Nightly load", ""] },
      { ids: [112000000001], labels: ["1.1 Load regions"], cells: ["Import into Regions", "", "", "From the hub", "Nightly load, Weekly load", ""] },
      { ids: [112000000003], labels: ["Old import"], cells: ["Import into Old", "", "", "", "", ""] }];
    const { table, matched } = mergeImports(tab, { columns, rows });
    expect(table.headers).toEqual(["", "Source Label", "Source Object", "Source Type", "Target Object", "Target Type", "Production Data",
      "Start Date and Time (UTC)", "Most recent duration (ms)", "Notes", "Used in Processes", "Used in Dashboards"]);
    expect(table.rows).toEqual([
      ["1.1 Load regions", "Hub / Regions", "Hub / 'LIST - Regions'.Export", "SAVED VIEW", "Regions", "LIST", "false", "", "", "From the hub", "Nightly load, Weekly load", ""],
      ["Prices from prices.csv", "prices.csv", "-", "FILE", "Prices", "MODULE", "false", "2026-03-12 23:19:56", "582", "", "Nightly load", ""],
      ["Old import", "", "", "", "", "", "", "", "", "", "", ""]]);
    expect(matched).toBe(2);
    // Without the Actions list, the Imports tab alone.
    expect(mergeImports(tab).table.headers).toEqual(["", "Source Label", "Source Object", "Source Type", "Target Object", "Target Type", "Production Data"]);
  });

  it("checks the Actions grid kept what the file promises: the processes that use each action, notes and last run", () => {
    // Anaplan's own export of the Actions grid has these columns.
    expect(missingActionColumns(["Action", "Start Date and Time (UTC)", "Most recent duration (ms)", "Notes", "Used in Processes", "Used in Dashboards"])).toEqual([]);
    expect(missingActionColumns([""])).toEqual(["Used in Processes", "Notes", "Start Date and Time (UTC)"]);
    expect(missingActionColumns(["Action", "Notes"])).toEqual(["Used in Processes", "Start Date and Time (UTC)"]);
  });

  it("fills the model calendar template by property ID, in the template's own words, blank where it does not apply", () => {
    const values = new Map<number, string>([[CALENDAR_PROPERTIES["Calendar Type"], "Weeks: 4-4-5, 4-5-4 or 5-4-4"],
      [CALENDAR_PROPERTIES["Fiscal Year Starts"], "January"], [CALENDAR_PROPERTIES["End of Fiscal Year is"], "Last in Month"],
      [CALENDAR_PROPERTIES["End of Fiscal Year - day"], "Saturday"], [CALENDAR_PROPERTIES["End of Fiscal Year - month"], "December"],
      [CALENDAR_PROPERTIES.Timescale, "false"], [CALENDAR_PROPERTIES["Fiscal Year Label is aligned with"], "false"],
      [CALENDAR_PROPERTIES["Include Total of All Periods"], "true"], [CALENDAR_PROPERTIES["Include Quarter Totals"], "False"],
      [CALENDAR_PROPERTIES["Include Year To Date"], "false"], [CALENDAR_PROPERTIES["Extra Period falls in Quarter"], "1"],
      [CALENDAR_PROPERTIES["Start Date"], "2019-04-04"], [CALENDAR_PROPERTIES["Number of Weeks"], "0"], [CALENDAR_PROPERTIES["Week Format"], "Numbered"],
      [CALENDAR_PROPERTIES["Current Fiscal Year"], "FY24: 31 Dec 2023 - 28 Dec 2024"], [CALENDAR_PROPERTIES["Number of Past Years"], "3"]]);
    const rows = calendarRows({ workspace: "Workspace one", model: "Model one", capturedOn: "2026-09-28", values, showsYearToDate: false });
    const value = (setting: string) => rows.find(row => row[1] === setting)?.[2];
    expect(CALENDAR_HEADERS).toEqual(["Section", "Setting", "Value", "Allowed values", "Applies to", "Notes"]);
    expect(rows).toHaveLength(31);
    expect([value("Workspace"), value("Model"), value("Model size (GB)"), value("Captured on"), value("Captured by")]).toEqual(["Workspace one", "Model one", "", "2026-09-28", ""]);
    // As the template's example (a 4-4-5 weeks calendar) shows them.
    expect(Object.fromEntries(["Calendar Type", "Fiscal Year Starts", "End of Fiscal Year is", "End of Fiscal Year - day", "End of Fiscal Year - month", "Timescale",
      "Fiscal Year Label is aligned with", "Current Fiscal Year", "Number of Past Years", "Extra Period falls in Quarter", "Week Format", "Start Date", "Number of Weeks",
      "Include Quarter Totals", "Include Year To Date", "Include Total of All Periods"].map(setting => [setting, value(setting)]))).toEqual({
      "Calendar Type": "Weeks: 4-4-5, 4-5-4 or 5-4-4", "Fiscal Year Starts": "", "End of Fiscal Year is": "Last", "End of Fiscal Year - day": "Sat",
      "End of Fiscal Year - month": "Dec", Timescale: "2-digit format", "Fiscal Year Label is aligned with": "End Week of the Fiscal Year",
      "Current Fiscal Year": "FY24: 31 Dec 2023 - 28 Dec 2024", "Number of Past Years": "3", "Extra Period falls in Quarter": "", "Week Format": "Numbered",
      "Start Date": "", "Number of Weeks": "", "Include Quarter Totals": "No", "Include Year To Date": "", "Include Total of All Periods": "Yes" });
    expect(calendarKind("Calendar Months/Quarters/Years")).toBe("Months");
    const months = calendarRows({ workspace: "", model: "", capturedOn: "", values: new Map([[CALENDAR_PROPERTIES["Calendar Type"], "Calendar Months/Quarters/Years"],
      [CALENDAR_PROPERTIES["Fiscal Year Starts"], "April"], [CALENDAR_PROPERTIES["End of Fiscal Year - day"], "Saturday"]]) });
    expect([months.find(row => row[1] === "Fiscal Year Starts")?.[2], months.find(row => row[1] === "End of Fiscal Year - day")?.[2]]).toEqual(["Apr", ""]);
    expect(rows[5]).toEqual(["Model Calendar", "Calendar Type", "Weeks: 4-4-5, 4-5-4 or 5-4-4",
      "Calendar Months/Quarters/Years | Weeks: 4-4-5, 4-5-4 or 5-4-4 | Weeks: 13 4-week Periods | Weeks: General", "All", "Decides which of the rows below apply; leave the others blank."]);
  });

  it("writes days and months by name when the grid gives Anaplan's stored IDs, and the current fiscal year with its dates", () => {
    const rows = (entries: [string, string][]) => calendarRows({ workspace: "", model: "", capturedOn: "",
      values: new Map(entries.map(([setting, value]) => [CALENDAR_PROPERTIES[setting], value] as [number, string])) });
    const value = (table: string[][], setting: string) => table.find(row => row[1] === setting)?.[2];
    // A 4-4-5 calendar ending on the last Saturday of December, as the settings grid returns it: stored IDs, not labels.
    const weeks = (current: string, extra: [string, string][] = []) => rows([["Calendar Type", "Weeks: 4-4-5, 4-5-4 or 5-4-4"],
      ["End of Fiscal Year is", "Last in Month"], ["End of Fiscal Year - day", "7"], ["End of Fiscal Year - month", "12"], ["Fiscal Year Label", "FY"],
      ["Timescale", "false"], ["Fiscal Year Label is aligned with", "false"], ["Current Fiscal Year", current], ...extra]);
    expect([value(weeks("FY24"), "End of Fiscal Year - day"), value(weeks("FY24"), "End of Fiscal Year - month")]).toEqual(["Sat", "Dec"]);
    // The template's own example, worked out from the stored "FY24" the way the Model Calendar tab works it out.
    expect(value(weeks("FY24"), "Current Fiscal Year")).toBe("FY24: 31 Dec 2023 - 28 Dec 2024");
    expect(value(weeks("FY20"), "Current Fiscal Year")).toBe("FY20: 29 Dec 2019 - 26 Dec 2020");
    // The Saturday nearest the end of December: 1 Jan 2022 is nearer than 25 Dec 2021, so FY22 starts on 2 Jan.
    expect(value(weeks("FY22", [["End of Fiscal Year is", "Nearest End of Month"]]), "Current Fiscal Year")).toBe("FY22: 2 Jan 2022 - 31 Dec 2022");
    // The nearest Saturday can also fall in the next month: FY21 ends on 1 Jan 2022, not on 25 Dec 2021.
    expect(value(weeks("FY21", [["End of Fiscal Year is", "Nearest End of Month"]]), "Current Fiscal Year")).toBe("FY21: 3 Jan 2021 - 1 Jan 2022");
    // Day 1 is Sunday: the last Sunday of December 2023 is the 31st, so FY24 starts on 1 Jan 2024.
    const sunday = weeks("FY24", [["End of Fiscal Year - day", "1"]]);
    expect([value(sunday, "End of Fiscal Year - day"), value(sunday, "Current Fiscal Year")]).toEqual(["Sun", "FY24: 1 Jan 2024 - 29 Dec 2024"]);
    // Days 2 to 6 are Monday to Friday: the year ends on the last such day of December.
    expect([2, 3, 4, 5, 6].map(day => value(weeks("FY24", [["End of Fiscal Year - day", String(day)]]), "Current Fiscal Year"))).toEqual([
      "FY24: 26 Dec 2023 - 30 Dec 2024", "FY24: 27 Dec 2023 - 31 Dec 2024", "FY24: 28 Dec 2023 - 25 Dec 2024", "FY24: 29 Dec 2023 - 26 Dec 2024",
      "FY24: 30 Dec 2023 - 27 Dec 2024"]);
    // The dates take the model's own year label; the stored ID still starts with FY.
    expect(value(weeks("FY24", [["Fiscal Year Label", "CY"]]), "Current Fiscal Year")).toBe("CY24: 31 Dec 2023 - 28 Dec 2024");
    // Aligned with the start week, a year takes the label of the day a week after it starts: the year starting on 31 Dec 2023
    // is still FY24, not the one starting on 29 Dec 2024. Ending on the last Tuesday of June, the alignment moves the label.
    // Dates here worked out independently with Python's datetime and with the archived FiscalYearForWeeksHelper.
    const start: [string, string] = ["Fiscal Year Label is aligned with", "true"];
    const june: [string, string][] = [["End of Fiscal Year - day", "3"], ["End of Fiscal Year - month", "6"]];
    expect(value(weeks("FY24", [start]), "Current Fiscal Year")).toBe("FY24: 31 Dec 2023 - 28 Dec 2024");
    expect([value(weeks("FY24", [start, ...june]), "Current Fiscal Year"), value(weeks("FY24", june), "Current Fiscal Year")])
      .toEqual(["FY24: 26 Jun 2024 - 24 Jun 2025", "FY24: 28 Jun 2023 - 25 Jun 2024"]);
    // The label day is a full week after the start: the year starting on 26 Dec 2021 is FY22 because 2 Jan 2022 is in 2022.
    expect(value(weeks("FY22", [start]), "Current Fiscal Year")).toBe("FY22: 26 Dec 2021 - 31 Dec 2022");
    // With 4-digit labels Anaplan stores a year from 2079 on with four digits (FY2079) and an earlier one with two (FY78).
    const fourDigit: [string, string][] = [["Timescale", "true"]];
    expect([value(weeks("FY2079", fourDigit), "Current Fiscal Year"), value(weeks("FY78", fourDigit), "Current Fiscal Year")])
      .toEqual(["FY2079: 1 Jan 2079 - 30 Dec 2079", "FY2078: 26 Dec 2077 - 31 Dec 2078"]);
    // Nearest to the end of December, a year can start in December and end in January: FY25 ends on 3 Jan 2026 (nearer than
    // 27 Dec 2025) and starts after 28 Dec 2024 (nearer than 4 Jan 2025); FY26 then starts on 4 Jan 2026.
    const nearest: [string, string][] = [["End of Fiscal Year is", "Nearest End of Month"]];
    expect([value(weeks("FY25", nearest), "Current Fiscal Year"), value(weeks("FY26", nearest), "Current Fiscal Year")])
      .toEqual(["FY25: 29 Dec 2024 - 3 Jan 2026", "FY26: 4 Jan 2026 - 2 Jan 2027"]);
    // 13 4-week periods is a week calendar too; the choices can also arrive as their labels instead of true and false.
    expect(value(weeks("FY24", [["Calendar Type", "Weeks: 13 4-week Periods"]]), "Current Fiscal Year")).toBe("FY24: 31 Dec 2023 - 28 Dec 2024");
    expect(value(weeks("FY24", [["Fiscal Year Label is aligned with", "Start Week of the Fiscal Year"], ...june]), "Current Fiscal Year")).toBe("FY24: 26 Jun 2024 - 24 Jun 2025");
    expect(value(weeks("FY2079", [["Timescale", "4-digit format"]]), "Current Fiscal Year")).toBe("FY2079: 1 Jan 2079 - 30 Dec 2079");
    // Month calendars: the year runs from the first of the start month; the label follows its end, or its start.
    const months = (entries: [string, string][]) => rows([["Calendar Type", "Calendar Months/Quarters/Years"], ["Fiscal Year Label", "FY"], ...entries]);
    const january = months([["Fiscal Year Starts", "1"], ["Timescale", "false"], ["Fiscal Year Label is aligned with", "false"], ["Current Fiscal Year", "FY23"]]);
    expect([value(january, "Fiscal Year Starts"), value(january, "Current Fiscal Year")]).toEqual(["Jan", "FY23: 1 Jan 2023 - 31 Dec 2023"]);
    const april = months([["Fiscal Year Starts", "4"], ["Timescale", "true"], ["Fiscal Year Label is aligned with", "true"], ["Current Fiscal Year", "FY24"]]);
    expect(value(april, "Current Fiscal Year")).toBe("FY2024: 1 Apr 2024 - 31 Mar 2025");
    // Aligned with the end, a year starting in March takes the label of the year it ends in (here through a leap day).
    const march = months([["Fiscal Year Starts", "3"], ["Timescale", "false"], ["Fiscal Year Label is aligned with", "false"], ["Current Fiscal Year", "FY24"]]);
    expect(value(march, "Current Fiscal Year")).toBe("FY24: 1 Mar 2023 - 29 Feb 2024");
    // Without the alignment and Timescale settings the tab's own defaults apply: aligned with the end, 2-digit years.
    expect(value(months([["Fiscal Year Starts", "4"], ["Current Fiscal Year", "FY24"]]), "Current Fiscal Year")).toBe("FY24: 1 Apr 2023 - 31 Mar 2024");
    // Without the settings the dates depend on, the stored value stays as it is; an ID out of range is written as given.
    expect(value(months([["Current Fiscal Year", "FY23"]]), "Current Fiscal Year")).toBe("FY23");
    expect(value(rows([["Calendar Type", "Weeks: 4-4-5, 4-5-4 or 5-4-4"], ["End of Fiscal Year is", "Last in Month"], ["End of Fiscal Year - day", "7"],
      ["End of Fiscal Year - month", "12"], ["Current Fiscal Year", "FY24"]]), "Current Fiscal Year")).toBe("FY24"); // no Fiscal Year Label
    expect(value(weeks("FY24", [["End of Fiscal Year - day", "9"]]), "End of Fiscal Year - day")).toBe("9");
    const thirteen = weeks("FY24", [["End of Fiscal Year - month", "13"]]);
    expect([value(thirteen, "End of Fiscal Year - month"), value(thirteen, "Current Fiscal Year")]).toEqual(["13", "FY24"]);
    // The stored value also stays for a day out of range, an end type that is neither last nor nearest, and no calendar type.
    expect(value(weeks("FY24", [["End of Fiscal Year - day", "9"]]), "Current Fiscal Year")).toBe("FY24");
    expect(value(weeks("FY24", [["End of Fiscal Year is", "First in Month"]]), "Current Fiscal Year")).toBe("FY24");
    expect(value(rows([["End of Fiscal Year is", "Last in Month"], ["End of Fiscal Year - day", "7"], ["End of Fiscal Year - month", "12"], ["Fiscal Year Label", "FY"],
      ["Current Fiscal Year", "FY24"]]), "Current Fiscal Year")).toBe("FY24");
    // Weeks: General has no current fiscal year: the row is blank whatever is stored.
    expect(value(weeks("FY24", [["Calendar Type", "Weeks: General"]]), "Current Fiscal Year")).toBe("");
  });

  it("names the line items a Ratio summary divides, from the grid's own row IDs", () => {
    const ratio = JSON.stringify({ summaryMethod: "RATIO", timeSummaryMethod: "SUM", ratioNumeratorIdentifier: "_1901000000002_",
      ratioDenominatorIdentifier: "_1901000000003_" });
    const grid: Grid = { columns: [{ ids: [4000000010], labels: ["Summary"] }, { ids: [4000000011], labels: ["Module Name"] }], rows: [
      { ids: [102000000001], labels: ["Margin"], cells: ["", ""] },
      { ids: [1901000000001], labels: ["Margin %"], cells: [ratio, "Margin"] },
      { ids: [1901000000002], labels: ["Profit"], cells: ['{"summaryMethod":"SUM","ratioNumeratorIdentifier":""}', "Margin"] },
      { ids: [1901000000003], labels: ["Revenue"], cells: ["not json", "Margin"] }] };
    const table = lineItemsTable(grid);
    expect(table.headers).toEqual(["", "Summary", "Module Name", "Ratio Numerator", "Ratio Denominator", "Format List"]);
    expect(table.rows.map(row => row.slice(3, 5))).toEqual([["", ""], ["Profit", "Revenue"], ["", ""], ["", ""]]);
    // Anaplan's own columns are untouched; an ID the grid does not hold stays blank rather than guessed.
    expect(table.rows[1].slice(0, 3)).toEqual(["Margin %", ratio, "Margin"]);
    expect(lineItemsTable({ ...grid, rows: grid.rows.slice(1, 2) }).rows[0].slice(3, 5)).toEqual(["", ""]);
  });

  it("names the list of a line item formatted as a list, from the General Lists grid's rows by ID, and nothing it would have to guess", () => {
    const list = (hierarchyEntityLongId: unknown, changes: Record<string, unknown> = {}): string =>
      JSON.stringify({ hierarchyEntityLongId, entityFormatFilter: null, selectiveAccessApplied: false, showAll: false, dataType: "ENTITY", ...changes });
    // The General Lists grid: each list's row under the list's ID, named by its label. The cells are the list's settings.
    const TOO_LONG = "101000000007000000007";
    const lists: Grid = { columns: [{ ids: [4000000101], labels: ["Top Level Item"] }], rows: [
      { ids: [101000000007], labels: ["Products"], cells: ["All Products"] },
      { ids: [101000000008], labels: ['Regions, "north" & south'], cells: [""] },
      { ids: [Number(TOO_LONG)], labels: ["Rounded"], cells: [""] }] };
    const NUMBER = '{"minimumSignificantDigits":4,"decimalPlaces":-1,"dataType":"NUMBER"}';
    /** Each line item's Format, and what its Format List cell holds. */
    const cases: [name: string, format: string, formatList: string][] = [
      ["Product", list(101000000007), "Products"],
      // The name is the list's own, whatever it holds and whatever else the format says.
      ["Region", list(101000000008, { selectiveAccessApplied: true, entityFormatFilter: { mappingHierarchy: "_101000000007_" } }), 'Regions, "north" & south'],
      // The ID as text, between underscores or not, is the same ID.
      ["As text", list("101000000007"), "Products"], ["As identifier", list("_101000000007_"), "Products"],
      // A list that is no row of General Lists is not named, and its ID is not written in the name's place: a list subset
      // and a line item subset (IDs of their entity types, 109 and 114), a built-in list such as Users, Versions or Time
      // (IDs the classic client's anaplan/constants.js has for those three), and a general list the grid does not hold.
      ["Subset", list(109000000004), ""], ["Line item subset", list(114000000002), ""], ["User", list(101999999999), ""], ["Version", list(20000000020), ""],
      ["Period", list(20000000003), ""], ["Gone", list(101000000009), ""],
      // A format that names no list, or names it by something that is no ID.
      ["No list", list(null), ""], ["None", list(-1), ""], ["Not set", '{"dataType":"ENTITY"}', ""], ["Half", list(101000000007.5), ""], ["Named", list("Products"), ""],
      ["Many", list([101000000007]), ""], ["Spaced", list(" 101000000007 "), ""], ["Powers", list("1.01000000007e11"), ""],
      // An ID of more digits than a number holds exactly is not looked up: two such IDs can be one number, as this one and its row's are.
      ["Too long", `{"hierarchyEntityLongId":${TOO_LONG},"dataType":"ENTITY"}`, ""], ["Too long as text", list(TOO_LONG), ""],
      // Any other format, also one that carries a list's ID; and a cell that is no format.
      ["Units", NUMBER, ""], ["Odd number", '{"hierarchyEntityLongId":101000000007,"dataType":"NUMBER"}', ""],
      ["Month", '{"periodType":{"entityId":"MONTH","entityLabel":"Month"},"hierarchyEntityLongId":101000000007,"dataType":"TIME_ENTITY"}', ""],
      ["Words", "List: Products", ""], ["Cut short", '{"hierarchyEntityLongId":101000000007,"dataType":"ENT', ""], ["Blank", "", ""]];
    const grid: Grid = { columns: [{ ids: [4000000212], labels: ["Format"] }, { ids: [4000000011], labels: ["Module Name"] }], rows: [
      { ids: [102000000001], labels: ["Orders"], cells: ["", ""] },
      ...cases.map(([name, format], index) => ({ ids: [1901000000001 + index], labels: [name], cells: [format, "Orders"] }))] };
    const table = lineItemsTable(grid, lists);
    // The column comes last, after the two of a ratio. A module's own row has no format, and so no list.
    expect(table.headers).toEqual(["", "Format", "Module Name", "Ratio Numerator", "Ratio Denominator", "Format List"]);
    expect(table.rows.map(row => [row[0], row[5]])).toEqual([["Orders", ""], ...cases.map(([name, , formatList]) => [name, formatList])]);
    // Anaplan's own columns are untouched, the Format among them: the CSV keeps the ID.
    expect(table.rows.map(row => row.slice(0, 5))).toEqual([["Orders", "", "", "", ""], ...cases.map(([name, format]) => [name, format, "Orders", "", ""])]);
    // Without the General Lists grid, or with one that has no rows, the column is there and empty: no list is named.
    for (const without of [lineItemsTable(grid), lineItemsTable(grid, undefined), lineItemsTable(grid, { ...lists, rows: [] })]) {
      expect([without.headers, without.rows.map(row => row[5])]).toEqual([table.headers, table.rows.map(() => "")]);
      expect(without.rows.map(row => row.slice(0, 5))).toEqual(table.rows.map(row => row.slice(0, 5)));
    }
    // A list is found by its row's ID alone: not by its name, not by a cell, and not by a line item's ID.
    const other: Grid = { columns: lists.columns, rows: [{ ids: [101000000001], labels: ["101000000007"], cells: ["101000000007"] }, { ids: [1901000000001], labels: ["Product"], cells: [""] }] };
    expect(lineItemsTable(grid, other).rows.map(row => row[5])).toEqual(table.rows.map(() => ""));
    // A grid without a Format column has the column too, empty, whatever a row's name and its other cells hold.
    const bare = lineItemsTable({ columns: [{ ids: [4000000009], labels: ["Formula"] }], rows: [{ ids: [1901000000001], labels: [list(101000000007)], cells: [list(101000000007)] }] }, lists);
    expect([bare.headers, bare.rows]).toEqual([["", "Formula", "Ratio Numerator", "Ratio Denominator", "Format List"], [[list(101000000007), list(101000000007), "", "", ""]]]);
  });

  it("leaves Format List empty for a list format that carries a module's or a line item's ID, or says its data type in lower case, and writes a list's name with the spaces it has", () => {
    const format = (hierarchyEntityLongId: number, dataType = "ENTITY"): string => JSON.stringify({ hierarchyEntityLongId, entityFormatFilter: null, dataType });
    const lists: Grid = { columns: [{ ids: [4000000101], labels: ["Top Level Item"] }], rows: [
      { ids: [101000000007], labels: ["Products"], cells: [""] },
      { ids: [101000000010], labels: [" Padded "], cells: [""] }] };
    const grid: Grid = { columns: [{ ids: [4000000212], labels: ["Format"] }], rows: [
      { ids: [102000000001], labels: ["Orders"], cells: [""] },
      { ids: [1901000000001], labels: ["Units"], cells: ['{"dataType":"NUMBER"}'] },
      // An ID this very grid has a row for, the module's own and a line item's, is no list's. The grid's rows name the line
      // items of a Ratio summary; a list's name comes from General Lists alone.
      { ids: [1901000000002], labels: ["By module"], cells: [format(102000000001)] },
      { ids: [1901000000003], labels: ["By line item"], cells: [format(1901000000001)] },
      // A name with a space at each end is written with both: the cell holds the name as General Lists has it.
      { ids: [1901000000004], labels: ["Spaced out"], cells: [format(101000000010)] },
      // The data type is read as Anaplan writes it, in capitals: in lower case the format is not taken for a list's.
      { ids: [1901000000005], labels: ["Lower case"], cells: [format(101000000007, "entity")] },
      { ids: [1901000000006], labels: ["Product"], cells: [format(101000000007)] }] };
    const table = lineItemsTable(grid, lists);
    expect(table.headers).toEqual(["", "Format", "Ratio Numerator", "Ratio Denominator", "Format List"]);
    expect(table.rows.map(row => [row[0], row[4]])).toEqual([["Orders", ""], ["Units", ""], ["By module", ""], ["By line item", ""], ["Spaced out", " Padded "], ["Lower case", ""],
      ["Product", "Products"]]);
  });

  it("names the list an action deletes from or orders, from the General Lists grid's rows by ID, and nothing it would have to guess", () => {
    const action = (actionType: unknown, hierarchyIdentifier?: unknown): string => JSON.stringify({ actionType, hierarchyIdentifier, filterLineItemIdentifier: "_1901000000031_" });
    // The General Lists grid: each list's row under the list's ID, named by its label. A name is written as it is, also one
    // that holds what `replace` would read as a pattern of its own.
    const TOO_LONG = "101000000007000000007";
    const lists: Grid = { columns: [{ ids: [4000000101], labels: ["Top Level Item"] }], rows: [
      { ids: [101000000007], labels: ["Products"], cells: ["All Products"] },
      { ids: [101000000008], labels: ['Regions, "north" & south'], cells: [""] },
      { ids: [101000000010], labels: ["$& <b>$1</b> $' List"], cells: [""] },
      { ids: [Number(TOO_LONG)], labels: ["Rounded"], cells: [""] }] };
    /** Each other action's Action cell, and what its Action List cell holds. */
    const cases: [name: string, cell: string, actionList: string][] = [
      ["Delete old products", action("DELETE_BY_SELECTION", "_101000000007_"), "Products"],
      ["Order regions", action("ORDER_HIERARCHY", "_101000000008_"), 'Regions, "north" & south'],
      ["Odd name", action("DELETE_BY_SELECTION", "_101000000010_"), "$& <b>$1</b> $' List"],
      // The ID as a number, or as digits alone, is the same ID.
      ["As number", action("ORDER_HIERARCHY", 101000000007), "Products"], ["As digits", action("DELETE_BY_SELECTION", "101000000007"), "Products"],
      // A list that is no row of General Lists is not named, and its ID is not written in the name's place: a general list
      // the grid does not hold, and IDs of the entity types of a list subset and a line item subset (109 and 114).
      ["Gone", action("DELETE_BY_SELECTION", "_101000000009_"), ""], ["Subset", action("ORDER_HIERARCHY", "_109000000004_"), ""],
      ["Line item subset", action("ORDER_HIERARCHY", "_114000000002_"), ""],
      // An action of those two kinds that names no list, or names it by something that is no ID.
      ["No list", action("DELETE_BY_SELECTION"), ""], ["Empty", action("DELETE_BY_SELECTION", ""), ""], ["None", action("ORDER_HIERARCHY", -1), ""],
      ["Named", action("DELETE_BY_SELECTION", "Products"), ""], ["Many", action("DELETE_BY_SELECTION", ["_101000000007_"]), ""],
      ["Object", action("ORDER_HIERARCHY", { id: 101000000007 }), ""], ["Spaced", action("DELETE_BY_SELECTION", " 101000000007 "), ""],
      // An ID of more digits than a number holds exactly is not looked up: this one and its row's are one number.
      ["Too long", action("DELETE_BY_SELECTION", `_${TOO_LONG}_`), ""],
      // Any other kind of action, also one whose definition carries a list's ID in that field, and a kind in other letters.
      ["Copy", action("BULK_COPY", "_101000000007_"), ""], ["Current period", action("UPDATE_CURRENT_PERIOD", "_101000000007_"), ""],
      ["Lower case", action("delete_by_selection", "_101000000007_"), ""], ["No kind", JSON.stringify({ hierarchyIdentifier: "_101000000007_" }), ""],
      ["Create", JSON.stringify({ actionType: "TASK_ELEMENT", taskElement: JSON.stringify({ taskElementType: "BULK_OPERATION", operation: "SIMPLE_CREATE", hierarchyEntityLongId: 101000000007 }) }), ""],
      // A cell that is no definition.
      ["Words", "Delete from Products using Selection", ""], ["Cut short", '{"actionType":"DELETE_BY_SELECTION","hierarchyIdentifier":"_1010', ""], ["Blank", "", ""]];
    const grid: Grid = { columns: [{ ids: [4000000001], labels: ["Action"] }, { ids: [4000000002], labels: ["Notes"] }], rows: [
      { ids: [31000000004], labels: ["Other Actions"], cells: ["", ""] },
      ...cases.map(([name, cell], index) => ({ ids: [117000000001 + index], labels: [name], cells: [cell, ""] }))] };
    const other = (row: GridRow): boolean => Math.floor(row.ids[0] / 1e9) === 117;
    const table = otherActionsTable(grid, other, lists);
    // The column comes last, after the Actions list's own, in the rows the split gives Other Actions. The Actions list's
    // own cells are untouched: the Action cell keeps the ID.
    expect(table.headers).toEqual(["", "Action", "Notes", ACTION_LIST_COLUMN]);
    expect(table.rows.map(row => [row[0], row[3]])).toEqual(cases.map(([name, , actionList]) => [name, actionList]));
    expect(table.rows.map(row => row.slice(0, 3))).toEqual(gridTable(grid, other).rows);
    // Without the General Lists grid, or with one that has no rows, the column is there and empty: no list is named.
    for (const without of [otherActionsTable(grid, other), otherActionsTable(grid, other, undefined), otherActionsTable(grid, other, { ...lists, rows: [] })]) {
      expect([without.headers, without.rows.map(row => row[3])]).toEqual([table.headers, cases.map(() => "")]);
    }
    // A list is found by its row's ID alone: not by its name, and not by a cell.
    const byName: Grid = { columns: lists.columns, rows: [{ ids: [101000000001], labels: ["101000000007"], cells: ["101000000007"] }] };
    expect(otherActionsTable(grid, other, byName).rows.map(row => row[3])).toEqual(cases.map(() => ""));
    // An Actions list without an Action column has the column too, empty, whatever a row's name and its other cells hold.
    const named = action("DELETE_BY_SELECTION", "_101000000007_");
    const bare: Grid = { columns: [{ ids: [4000000002], labels: ["Notes"] }], rows: [{ ids: [117000000001], labels: [named], cells: [named] }] };
    expect(otherActionsTable(bare, other, lists)).toEqual({ headers: ["", "Notes", ACTION_LIST_COLUMN], rows: [[named, named, ""]] });
  });

  it("names a list in Action List for the very kinds of action that the results page says with a list's name, and for no other kind", () => {
    const lists: Grid = { columns: [], rows: [{ ids: [101000000007], labels: ["Products"], cells: [] }] };
    // Each kind of action the page says in words, each with a list's ID in the field where the two that name a list hold it.
    const kinds = ["PROCESS", "BULK_COPY", "DELETE_BY_SELECTION", "ORDER_HIERARCHY", "UPDATE_CURRENT_PERIOD", "TASK_ELEMENT"];
    const cells = kinds.map(actionType => JSON.stringify({ actionType, hierarchyIdentifier: "_101000000007_",
      ...(actionType === "TASK_ELEMENT" ? { taskElement: JSON.stringify({ taskElementType: "DASHBOARD", hierarchyEntityLongId: 101000000007 }) } : {}) }));
    const grid: Grid = { columns: [{ ids: [4000000001], labels: ["Action"] }], rows: cells.map((cell, index) => ({ ids: [117000000001 + index], labels: [kinds[index]], cells: [cell] })) };
    const named = otherActionsTable(grid, () => true, lists).rows.map(row => row[2] !== "");
    // The page's words for the same cell, given that name for whatever list they ask for, hold it where the action names a list.
    const said = cells.map(cell => actionWords(cell, { listName: () => "Products" })?.includes("Products") === true);
    expect([named, said]).toEqual([[false, false, true, true, false, false], [false, false, true, true, false, false]]);
  });

  it("reads a large grid in row pages through the page's client, sending reads only", async () => {
    const total = 7;
    const columns = ["Formula", "Format"];
    const requests: { startRow: number; rowCount: number }[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const native: Native = { cache: { getAllCurrenciesLabelPage: () => undefined }, ids: {}, constants: {}, axisHelper: {}, workspaceId: "w".repeat(32), modelId: "m".repeat(32),
      helper: { getAxesForViewDefinition: (rows: string[], cols: string[]) => ({ rowAxis: rows[0], columnAxis: cols[0] }) },
      RequestGenerator: class { getRequest(params: any) { return { requestType: "VIEW_REQUEST_SET", submissions: [], systemActions: [], fetchAllModelSummaries: false, params }; } uninitialize() { /* */ } },
      DataPage: class extends FakePage { constructor({ page }: any) { super(page); } },
      aggregator: { isDirty: () => false, post: (request: any, _flag: boolean, ok: (response: unknown) => boolean) => {
        const { startRow, rowCount } = request.params.pageRequests[0];
        expect(request.params.viewDefinition).toMatchObject({ type: "MODEL_DEFINITION", rowAxis: "ROWS", columnAxis: "COLS" });
        requests.push({ startRow, rowCount });
        const ids = Array.from({ length: rowCount }, (_, i) => 1901000000000 + startRow + i);
        queueMicrotask(() => ok({ result: { viewRequestResults: [{ rowCount: total, columnCount: 2,
          rowLabelPages: [{ start: startRow, count: rowCount, entityLongIds: [ids], labels: [ids.map(id => `Item ${id % 1000}`)] }],
          columnLabelPages: [{ start: 0, count: 2, entityLongIds: [[4000000009, 4000000212]], labels: [columns] }],
          dataPages: [{ startRow, rows: ids.map(id => [`f${id % 1000}`, "NUMBER"]) }] }] } }));
        return true;
      } } } as never;
    const log: string[] = [];
    const grid = await readGrid(native, "ROWS", "COLS", "Line Items", line => log.push(line), 6);
    // Six cells a read: the first page, sized for thirty columns before the grid has said how many it has, is one row, and
    // it says the grid's size; the pages after it are three rows of the grid's two columns. No row is read twice.
    expect(requests).toEqual([{ startRow: 0, rowCount: 1 }, { startRow: 1, rowCount: 3 }, { startRow: 4, rowCount: 3 }]);
    expect(grid.columns.map(column => column.labels[0])).toEqual(columns);
    expect(grid.rows.map(row => [row.labels[0], ...row.cells])).toEqual(Array.from({ length: total }, (_, i) => [`Item ${i}`, `f${i}`, "NUMBER"]));
    // The grid's size, then, once it is read, how long each page took.
    expect([log[0], ...log.slice(1).map(line => line.replace(/ in \d+\.\d\d s$/, " in … s"))]).toEqual(["Line Items: 7 rows × 2 columns; columns: Formula | Format",
      "Line Items: rows 0–0 in … s", "Line Items: rows 1–3 in … s", "Line Items: rows 4–6 in … s"]);

    // A first page that holds fewer rows than were asked for: the next page starts after those it holds.
    requests.length = 0;
    const capped = { ...native as object, aggregator: { isDirty: () => false, post: (request: any, flag: boolean, ok: (response: unknown) => boolean) => {
      const page = request.params.pageRequests[0];
      return (native as any).aggregator.post({ ...request, params: { ...request.params, pageRequests: [{ ...page, rowCount: page.startRow === 0 ? 2 : page.rowCount }] } }, flag, ok);
    } } } as never;
    const short = await readGrid(capped, "ROWS", "COLS", "Line Items", () => undefined, 120);
    expect([requests, short.rows.map(row => row.labels[0])]).toEqual([[{ startRow: 0, rowCount: 2 }, { startRow: 2, rowCount: 5 }],
      Array.from({ length: total }, (_, i) => `Item ${i}`)]);

    // If the page's generator ever produced anything but a read, nothing is posted.
    let posted = 0;
    const unsafeNative = { ...native, RequestGenerator: class { getRequest() { return { requestType: "VIEW_REQUEST_SET", submissions: [{ change: 1 }] }; } },
      aggregator: { isDirty: () => false, post: () => { posted++; return true; } } } as never;
    await expect(readGrid(unsafeNative, "ROWS", "COLS", "Modules", () => undefined)).rejects.toThrow("Refusing to send anything but a read.");
    expect(posted).toBe(0);

    for (const unsafe of [{ submissions: [{}] }, { systemActions: [{}] }, { fetchAllModelSummaries: true }, { requestType: "SUBMISSION" }]) {
      expect(() => assertRead({ requestType: "VIEW_REQUEST_SET", ...unsafe })).toThrow("Refusing to send anything but a read.");
    }
    expect(() => assertRead({ requestType: "VIEW_REQUEST_SET", submissions: [], systemActions: [] })).not.toThrow();
  });

  it("reads no further window of a grid once the export was asked to stop, and no further grid", async () => {
    const stopped = new Error("The export was stopped.");
    // The page's client, serving grids of any size: every read is recorded, and the test decides during which one the stop comes.
    const reads: string[] = [];
    let stopDuring = "";
    let stop = (): void => undefined;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = (sizes: Record<string, number>): any => {
      const aggregator = { isDirty: () => false, post: (request: any, _flag: boolean, ok: (response: unknown) => boolean) => {
        const { viewDefinition: { rowAxis }, pageRequests: [{ startRow, rowCount }] } = request.params;
        reads.push(`${rowAxis} ${startRow}+${rowCount}`);
        if (reads.at(-1) === stopDuring) stop();
        const ids = Array.from({ length: Math.min(rowCount, sizes[rowAxis] - startRow) }, (_, index) => 1901000000000 + startRow + index);
        queueMicrotask(() => ok({ result: { viewRequestResults: [{ rowCount: sizes[rowAxis], columnCount: 3,
          rowLabelPages: [{ start: startRow, count: ids.length, entityLongIds: [ids], labels: [ids.map(id => `Item ${id % 100000}`)] }],
          columnLabelPages: [{ start: 0, count: 3, entityLongIds: [[4000000009, 4000000010, 4000000011]], labels: [["Formula", "Summary", "Notes"]] }],
          dataPages: [{ startRow, rows: ids.map(() => ["", "", ""]) }] }] } }));
        return true;
      } };
      return { cache: { getAllCurrenciesLabelPage: () => undefined, getModelName: () => "Plan" }, aggregator, ids: {},
        helper: { getAxesForViewDefinition: (rows: string[], columns: string[]) => ({ rowAxis: rows[0], columnAxis: columns[0] }) },
        constants: { SYSTEM_AXIS_IDENTIFIER_MODULE_WITH_LINE_ITEM_IDENTIFIER: "LINE ITEMS", SYSTEM_AXIS_IDENTIFIER_LINE_ITEM_PROPERTY_IDENTIFIER: "LINE ITEM PROPERTIES",
          SYSTEM_AXIS_IDENTIFIER_MODULE_ALL_IDENTIFIER: "MODULES" },
        RequestGenerator: class { getRequest(params: unknown) { return { requestType: "VIEW_REQUEST_SET", submissions: [], systemActions: [], params }; } },
        DataPage: class extends FakePage { constructor({ page }: any) { super(page); } },
        axisHelper: { getModuleSystemAxisIdentifier: () => "MODULE PROPERTIES" }, workspaceId: "0123456789abcdef0123456789abcdef", modelId: "FEDCBA9876543210FEDCBA9876543210" };
    };

    // One grid, read six cells at a time: 60 rows of 3 columns are a first window of one row, sized for thirty columns,
    // then thirty windows of two rows or fewer.
    const stopping = new AbortController();
    stop = () => stopping.abort(stopped);
    stopDuring = "ROWS 1+2";
    await expect(readGrid(client({ ROWS: 60 }), "ROWS", "COLS", "Line Items", () => undefined, 6, false, stopping.signal)).rejects.toBe(stopped);
    // The stop came while the second window was read: that read is let finish, and it is the last.
    expect(reads).toEqual(["ROWS 0+1", "ROWS 1+2"]);
    // Not stopped, the same grid is read to its end.
    reads.length = 0;
    expect((await readGrid(client({ ROWS: 60 }), "ROWS", "COLS", "Line Items", () => undefined, 6, false, new AbortController().signal)).rows).toHaveLength(60);
    expect(reads).toHaveLength(31);

    // The whole export, as the model's frame runs it (bridge.ts `serveCore`): once it was asked to stop, the check it is given
    // refuses, and so does every step. 30,000 line items of 3 columns are a first window of 1,333 rows, sized for thirty
    // columns, then windows of the 40,000 cells one read asks for.
    reads.length = 0;
    let asked = false;
    stop = () => { asked = true; };
    stopDuring = "LINE ITEMS 1333+13333";
    const check = { throwIfAborted: () => { if (asked) throw stopped; } };
    const page = client({ "LINE ITEMS": 30_000, MODULES: 2 });
    vi.stubGlobal("window", { workspaceId: page.workspaceId, modelId: page.modelId, require: (_modules: string[], loaded: (...modules: unknown[]) => void) =>
      loaded(page.cache, page.aggregator, page.helper, page.ids, page.constants, page.RequestGenerator, page.DataPage, page.axisHelper) });
    vi.stubGlobal("location", { host: "eu2a.app.anaplan.com", pathname: "/core-webapp/anaplan/framework.jsp" });
    await expect(exportModel({ status: check.throwIfAborted, log: check.throwIfAborted }, () => "", check)).rejects.toBe(stopped);
    expect(reads).toEqual(["LINE ITEMS 0+1333", "LINE ITEMS 1333+13333"]);
    // Not stopped, it reads the third window and goes on to the next grid.
    reads.length = 0;
    stopDuring = "";
    asked = false;
    expect((await exportModel({ status: check.throwIfAborted, log: check.throwIfAborted }, () => "", check)).summary.slice(0, 2)).toEqual(["Line Items: 30000 rows", "Modules: 2 rows"]);
    expect(reads).toEqual(["LINE ITEMS 0+1333", "LINE ITEMS 1333+13333", "LINE ITEMS 14666+13333", "LINE ITEMS 27999+2001", "MODULES 0+1333"]);
  });

  it("finds the open model only on a page with the classic client's loader and 32-character model and workspace IDs", () => {
    const [WS, MODEL] = ["0123456789abcdef0123456789abcdef", "FEDCBA9876543210FEDCBA9876543210"];
    const on = (page: Record<string, unknown>) => { vi.stubGlobal("window", page); return modelOnPage(); };
    expect(on({ require: () => undefined, modelId: MODEL, workspaceId: WS })).toBe(MODEL);
    for (const page of [{ modelId: MODEL, workspaceId: WS }, { require: () => undefined, modelId: MODEL }, { require: () => undefined, workspaceId: WS },
      { require: () => undefined, modelId: MODEL.slice(1), workspaceId: WS }, { require: () => undefined, modelId: MODEL, workspaceId: `${WS}0` },
      { require: () => undefined, modelId: MODEL.replace("F", "-"), workspaceId: WS }, { require: () => undefined, modelId: MODEL, workspaceId: WS.replace("0", "_") }]) {
      expect(on(page)).toBeUndefined();
    }

    // 32 letters or digits, hexadecimal or not; no character that could change a path or a destination.
    for (const [index, modelId] of SCOPE_IDS.entries()) {
      expect(on({ require: () => undefined, modelId, workspaceId: SCOPE_IDS[(index + 1) % SCOPE_IDS.length] })).toBe(modelId);
    }
    for (const id of NOT_SCOPE_IDS) {
      expect(on({ require: () => undefined, modelId: id, workspaceId: WS }), JSON.stringify(id)).toBeUndefined();
      expect(on({ require: () => undefined, modelId: MODEL, workspaceId: id }), JSON.stringify(id)).toBeUndefined();
    }
  });

  it("names the zip after the model, without characters a file name cannot hold", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.UTC(2026, 8, 28, 1, 59, 9)));
    const [WS, MODEL] = ["0123456789abcdef0123456789abcdef", "FEDCBA9876543210FEDCBA9876543210"];
    // A model page whose client knows only the Versions grid: every other file is reported as not exported.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const page = (modelName: unknown): any => {
      const cache = { getModelName: () => modelName, getWorkspaceInfo: () => ({ name: "Workspace one" }), getAllCurrenciesLabelPage: () => undefined };
      const aggregator = { isDirty: () => false, post: (_request: unknown, _flag: boolean, ok: (response: unknown) => boolean) => {
        queueMicrotask(() => ok({ result: { viewRequestResults: [{ rowCount: 1, columnCount: 1,
          rowLabelPages: [{ start: 0, count: 1, entityLongIds: [[107000000001]], labels: [["Actual"]] }],
          columnLabelPages: [{ start: 0, count: 1, entityLongIds: [[4000000301]], labels: [["Is Actual"]] }],
          dataPages: [{ startRow: 0, rows: [["true"]] }] }] } }));
        return true;
      } };
      const helper = { getAxesForViewDefinition: (rows: string[], columns: string[]) => ({ rowAxis: rows[0], columnAxis: columns[0] }) };
      const constants = { SYSTEM_AXIS_IDENTIFIER_VERSION_ALL_IDENTIFIER: "VERSIONS", SYSTEM_AXIS_IDENTIFIER_VERSION_PROPERTY_IDENTIFIER: "VERSION PROPERTIES" };
      class RequestGenerator { getRequest() { return { requestType: "VIEW_REQUEST_SET", submissions: [], systemActions: [] }; } }
      class DataPage extends FakePage { constructor({ page: data }: any) { super(data); } }
      return { workspaceId: WS, modelId: MODEL,
        require: (_modules: string[], loaded: (...modules: unknown[]) => void) => loaded(cache, aggregator, helper, {}, constants, RequestGenerator, DataPage, {}) };
    };
    const run = (modelName: unknown) => {
      vi.stubGlobal("window", page(modelName));
      vi.stubGlobal("location", { host: "eu2a.app.anaplan.com", pathname: "/core-webapp/anaplan/framework.jsp" });
      return exportModel({ status: () => undefined, log: () => undefined }, () => "01:59:09 model-export vdev");
    };
    const result = await run('Demand: "Plan" /\t2026');
    expect(result.zipName).toBe("Demand Plan 2026 - Model Export - 2026-09-28.zip");
    expect(result.summary[0]).toBe("Versions: 1 rows");
    expect(result.summary).toContain("Line Items: not exported (This model page has no MODULE_WITH_LINE_ITEM axis.).");
    expect(Array.from(resultZip(result).slice(0, 2))).toEqual([0x50, 0x4b]);
    expect((await run("???")).zipName).toBe("model - Model Export - 2026-09-28.zip");
    expect((await run(undefined)).zipName).toBe(`${MODEL} - Model Export - 2026-09-28.zip`);
    expect((await run("m".repeat(100))).zipName).toBe(`${"m".repeat(80)} - Model Export - 2026-09-28.zip`);
    // Every character Windows refuses in a file name, and control characters, become one space; anything else stays.
    expect((await run('a\\b/c:d*e?f"g<h>i|j\u0000k\u0001l\u001fm')).zipName).toBe("a b c d e f g h i j k l m - Model Export - 2026-09-28.zip");
    expect((await run("Plan #1 (R&D) - 50%+ [a] {b} ~ 'c' = d; e, f! @g $h ^i")).zipName).toBe("Plan #1 (R&D) - 50%+ [a] {b} ~ 'c' = d; e, f! @g $h ^i - Model Export - 2026-09-28.zip");
    // Any run of white space is one space, and the ends are trimmed before the name is cut to 80 characters, not after.
    expect((await run(" \u00a0Plan\u00a0\u2003 2026\n")).zipName).toBe("Plan 2026 - Model Export - 2026-09-28.zip");
    expect((await run(`${"m".repeat(79)} b`)).zipName).toBe(`${"m".repeat(79)}  - Model Export - 2026-09-28.zip`);
    // A name that is empty or not text is no name: the model's ID stands in.
    for (const name of ["", 42, null, ["Plan"], { name: "Plan" }]) expect((await run(name)).zipName, JSON.stringify(name)).toBe(`${MODEL} - Model Export - 2026-09-28.zip`);
  });

  it("fails in plain words when nothing could be read or the page's client cannot be used, instead of returning an export without files", async () => {
    const [WS, MODEL] = ["0123456789abcdef0123456789abcdef", "FEDCBA9876543210FEDCBA9876543210"];
    vi.stubGlobal("location", { host: "eu2a.app.anaplan.com", pathname: "/core-webapp/anaplan/framework.jsp" });
    /** How the export ended: the sentence the results page shows and the detail the diagnostic log keeps (progress.ts `Failure`). */
    const exporting = () => exportModel({ status: () => undefined, log: () => undefined }, () => "")
      .then(result => result.tables.map(table => table.file), (error: unknown) => (error instanceof Failure ? [error.message, error.detail] : error));
    const sendLog = "If it keeps happening, choose Copy diagnostic log and send the log.";

    // A model page whose client has none of the grids' axes: no file could be read, so there is no export, and why each
    // file could not be read is the detail.
    vi.stubGlobal("window", { workspaceId: WS, modelId: MODEL, require: (_modules: string[], loaded: (...modules: unknown[]) => void) => loaded({}, {}, {}, {}, {}, class {}, class {}, {}) });
    const reasons = [["Line Items", "MODULE_WITH_LINE_ITEM"], ["Modules", "MODULE_ALL"], ["General Lists", "HIERARCHY"], ["Processes", "ACTION_WITH_HEADING"],
      ["Exports", "ACTION_WITH_HEADING"], ["Other Actions", "ACTION_WITH_HEADING"], ["Imports", "IMPORT_ALL"], ["Import Data Sources", "IMPORT_DATA_SOURCE"],
      ["Time Ranges", "TIME_RANGE"], ["Versions", "VERSION_ALL"], ["Source Models", "REMOTE_MODEL"], ["Model Calendar", "TIMESCALE_PROPERTY"]];
    expect(await exporting()).toEqual([
      `Cardigan could not read any of this model's settings. Check that the model is open and that you can see its Model settings in Anaplan, then choose Run again. ${sendLog}`,
      reasons.map(([file, axis]) => `${file}: not exported (This model page has no ${axis} axis.).`).join(" ")]);

    // The page's loader cannot give the client's modules.
    vi.stubGlobal("window", { workspaceId: WS, modelId: MODEL, require: (_modules: string[], _loaded: unknown, failed: () => void) => failed() });
    expect(await exporting()).toEqual([`Cardigan could not read this model page. Refresh the Anaplan tab, then click the Cardigan icon again. ${sendLog}`,
      "the model page's client modules are not available"]);

    // The loader does not answer: the model is still opening. The export waits half a minute for it.
    vi.useFakeTimers();
    vi.stubGlobal("window", { workspaceId: WS, modelId: MODEL, require: () => undefined });
    const waiting = exporting();
    await vi.advanceTimersByTimeAsync(29_999);
    await vi.advanceTimersByTimeAsync(1);
    expect(await waiting).toEqual(["The model has not finished opening in the Anaplan tab. Wait until it shows, then choose Run again.", "the model page's client did not load in 30 s"]);
  });

  it("exports the Line Items grid with the ratio columns, naming each operand by its line item, not its module", async () => {
    const ratio = JSON.stringify({ summaryMethod: "RATIO", timeSummaryMethod: "RATIO", ratioNumeratorIdentifier: "_1901000000001_",
      ratioDenominatorIdentifier: "_1901000000002_" });
    // As the MODULE_WITH_LINE_ITEM axis returns them: each line item's row also carries its module (-1 on the module's own row),
    // and Summary is not the first column.
    const columns = [{ id: 4000000009, label: "Formula" }, { id: 4000000010, label: "Summary" }];
    const rows = [{ ids: [102000000001, -1], labels: ["Profitability", null], cells: ["", ""] },
      { ids: [1901000000001, 102000000001], labels: ["Profit", "Profitability"], cells: ["", '{"summaryMethod":"SUM"}'] },
      { ids: [1901000000002, 102000000001], labels: ["Revenue", "Profitability"], cells: ["", '{"summaryMethod":"SUM"}'] },
      { ids: [1901000000003, 102000000001], labels: ["Margin %", "Profitability"], cells: ["Profit / Revenue", ratio] }];
    const axes: string[][] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const aggregator = { isDirty: () => false, post: (request: any, _flag: boolean, ok: (response: unknown) => boolean) => {
      const { viewDefinition, pageRequests: [{ startRow, rowCount }] } = request.params;
      axes.push([viewDefinition.rowAxis, viewDefinition.columnAxis]);
      const slice = rows.slice(startRow, startRow + rowCount);
      queueMicrotask(() => ok({ result: { viewRequestResults: [{ rowCount: rows.length, columnCount: columns.length,
        rowLabelPages: [{ start: startRow, count: slice.length, entityLongIds: [0, 1].map(d => slice.map(row => row.ids[d])), labels: [0, 1].map(d => slice.map(row => row.labels[d])) }],
        columnLabelPages: [{ start: 0, count: columns.length, entityLongIds: [columns.map(column => column.id)], labels: [columns.map(column => column.label)] }],
        dataPages: [{ startRow, rows: slice.map(row => row.cells) }] }] } }));
      return true;
    } };
    const cache = { getModelName: () => "Plan", getWorkspaceInfo: () => ({ name: "Workspace one" }), getAllCurrenciesLabelPage: () => undefined };
    const helper = { getAxesForViewDefinition: (rowAxes: string[], columnAxes: string[]) => ({ rowAxis: rowAxes[0], columnAxis: columnAxes[0] }) };
    const constants = { SYSTEM_AXIS_IDENTIFIER_MODULE_WITH_LINE_ITEM_IDENTIFIER: "LINE ITEMS", SYSTEM_AXIS_IDENTIFIER_LINE_ITEM_PROPERTY_IDENTIFIER: "LINE ITEM PROPERTIES" };
    class RequestGenerator { getRequest(params: unknown) { return { requestType: "VIEW_REQUEST_SET", submissions: [], systemActions: [], params }; } }
    class DataPage extends FakePage { constructor({ page }: any) { super(page); } }
    vi.stubGlobal("window", { workspaceId: "0123456789abcdef0123456789abcdef", modelId: "FEDCBA9876543210FEDCBA9876543210",
      require: (_modules: string[], loaded: (...modules: unknown[]) => void) => loaded(cache, aggregator, helper, {}, constants, RequestGenerator, DataPage, {}) });
    vi.stubGlobal("location", { host: "eu2a.app.anaplan.com", pathname: "/core-webapp/anaplan/framework.jsp" });

    const result = await exportModel({ status: () => undefined, log: () => undefined }, () => "");
    expect(result.summary[0]).toBe("Line Items: 4 rows");
    expect(new Set(axes.map(pair => pair.join(" × ")))).toEqual(new Set(["LINE ITEMS × LINE ITEM PROPERTIES"]));
    const [headers, ...table] = parseCsv(unzipText(resultZip(result)).get("Line Items.csv") ?? "");
    expect(headers).toEqual(["", "Formula", "Summary", "Ratio Numerator", "Ratio Denominator", "Format List"]);
    expect(table).toEqual([["Profitability", "", "", "", "", ""], ["Profit", "", '{"summaryMethod":"SUM"}', "", "", ""],
      ["Revenue", "", '{"summaryMethod":"SUM"}', "", "", ""], ["Margin %", "Profit / Revenue", ratio, "Profit", "Revenue", ""]]);
  });

  it("exports Line Items.csv with each list format's list named from General Lists, which it reads after it and reads once", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.UTC(2026, 8, 28, 12, 30, 10)));
    const [LINE_ITEMS, LISTS] = ["LINE ITEMS × LINE ITEM PROPERTIES", "LISTS × LIST PROPERTIES"];
    const list = (id: number): string => JSON.stringify({ hierarchyEntityLongId: id, entityFormatFilter: null, dataType: "ENTITY" });
    const NUMBER = '{"dataType":"NUMBER"}';
    // The golden model with a Format column: two line items formatted as its two general lists, one as a list subset.
    const formatted: FakeGrid = { columns: ["Format", "Summary"], rows: [
      { ids: [102000000001, -1], labels: ["Profitability", null], cells: ["", ""] },
      { ids: [1901000000001, 102000000001], labels: ["Product", "Profitability"], cells: [list(101000000001), '{"summaryMethod":"NONE"}'] },
      { ids: [1901000000002, 102000000001], labels: ["Region", "Profitability"], cells: [list(101000000002), '{"summaryMethod":"NONE"}'] },
      { ids: [1901000000003, 102000000001], labels: ["Active product", "Profitability"], cells: [list(109000000001), '{"summaryMethod":"NONE"}'] },
      { ids: [1901000000004, 102000000001], labels: ["Profit", "Profitability"], cells: [NUMBER, '{"summaryMethod":"SUM"}'] }] };
    const grids = { ...GOLDEN_GRIDS, [LINE_ITEMS]: formatted };
    const reads: string[] = [];
    const result = await exportGoldenModel(grids, reads);
    const csv = (exported: typeof result, file: string) => parseCsv(unzipText(resultZip(exported, ZIPPED_AT)).get(file) ?? "");
    // The names are those of General Lists.csv's first column. A list subset is no row of it and is not named.
    expect(csv(result, "General Lists.csv").map(row => row[0])).toEqual(["", "Products", "+ Regions"]);
    expect(csv(result, "Line Items.csv")).toEqual([["", "Format", "Summary", "Ratio Numerator", "Ratio Denominator", "Format List"],
      ["Profitability", "", "", "", "", ""], ["Product", list(101000000001), '{"summaryMethod":"NONE"}', "", "", "Products"],
      ["Region", list(101000000002), '{"summaryMethod":"NONE"}', "", "", "+ Regions"], ["Active product", list(109000000001), '{"summaryMethod":"NONE"}', "", "", ""],
      ["Profit", NUMBER, '{"summaryMethod":"SUM"}', "", "", ""]]);
    // No grid is read for the names: every grid is read once, in the order it always was, Line Items first. The grid of
    // the imports' definitions is read with the Imports tab's row axis, right after it (MAPPINGS_ADDED).
    expect(reads).toEqual(withMappingsRead(["LINE ITEMS 0+1333", "MODULES 0+1333", "LISTS 0+1333", "ACTIONS 0+1333",
      "IMPORTS 0+1333", "DATA SOURCES 0+1333", "TIME RANGES 0+1333", "VERSIONS 0+1333", "CALENDAR 0+1333"]));
    // The file has its place and its count as ever. The Details file says what it says of the golden model, but for the
    // file's number of rows, and every other file is the golden model's own.
    expect(result.tables.map(table => table.file).slice(0, 4)).toEqual(["Model Details.csv", "Line Items.csv", "Modules.csv", "General Lists.csv"]);
    expect(result.summary.slice(0, 3)).toEqual(["Line Items: 5 rows", "Modules: 2 rows", "General Lists: 2 rows"]);
    const details = (exported: typeof result) => exported.tables[0].rows.filter(row => row[0] !== "Diagnostics");
    const golden = await exportGoldenModel();
    expect(details(result)).toEqual(details(golden).map(row => (row[1] === "Line Items.csv" ? ["Files", "Line Items.csv", "5 rows"] : row)));
    for (const table of golden.tables.slice(2)) expect(result.tables.find(other => other.file === table.file), table.file).toEqual(table);

    // General Lists cannot be read: Line Items.csv is exported all the same, with the column there and empty, and the
    // Details file and the summary say of both files what they said before the column was there.
    const { [LISTS]: _lists, ...withoutLists } = grids;
    const without = await exportGoldenModel(withoutLists);
    expect(csv(without, "Line Items.csv")).toEqual(csv(result, "Line Items.csv").map((row, index) => (index === 0 ? row : [...row.slice(0, 5), ""])));
    expect([without.tables.map(table => table.file).slice(0, 4), without.summary.slice(0, 2), without.summary.slice(-2)]).toEqual([
      ["Model Details.csv", "Line Items.csv", "Modules.csv", "Processes.csv"], ["Line Items: 5 rows", "Modules: 2 rows"],
      ["General Lists: not exported (The model rejected the read.).", "Source Models: not exported (This model page has no REMOTE_MODEL axis.)."]]);
    expect(details(without)).toEqual(details(result).map(row => (row[1] === "General Lists.csv" ? ["Files", "General Lists.csv", "Not exported: The model rejected the read."] : row)));
  });

  it("exports Other Actions.csv with the name of the list each action deletes from or orders, from General Lists, which it reads before the Actions list, and reads no grid more", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.UTC(2026, 8, 28, 12, 30, 10)));
    const [ACTIONS, LISTS] = ["ACTIONS × ACTION PROPERTIES", "LISTS × LIST PROPERTIES"];
    const action = (actionType: string, hierarchyIdentifier: string): string => JSON.stringify({ actionType, hierarchyIdentifier, filterLineItemIdentifier: "_1901000000031_" });
    // The golden model's Actions list with its one other action deleting from Products, and three other actions more: one
    // orders + Regions, whose name a spreadsheet would take for a formula, one orders by an ID of a list subset's entity
    // type, which General Lists does not hold, and a bulk copy, whose definition carries a list's ID as well.
    const others = [row(117000000001, "Delete old items", action("DELETE_BY_SELECTION", "_101000000001_"), "", "", "", "Nightly load", ""),
      row(117000000002, "Order regions", action("ORDER_HIERARCHY", "_101000000002_"), "", "", "", "", ""),
      row(117000000003, "Order active products", action("ORDER_HIERARCHY", "_109000000001_"), "", "", "", "", ""),
      row(117000000004, "Copy forecast", action("BULK_COPY", "_101000000001_"), "", "", "", "", "")];
    const grids = { ...GOLDEN_GRIDS, [ACTIONS]: { columns: ACTION_COLUMNS, rows: [...GOLDEN_GRIDS[ACTIONS].rows.slice(0, -1), ...others] } };
    const reads: string[] = [];
    const result = await exportGoldenModel(grids, reads);
    const csv = (exported: typeof result, file: string) => parseCsv(unzipText(resultZip(exported, ZIPPED_AT)).get(file) ?? "");
    // The column comes last, after the Actions list's own, which are as the grid has them. A name is written as General
    // Lists has it, with nothing before one that starts with a sign. A list General Lists does not hold, and a list's ID
    // in a kind of action that names no list, are named by nothing.
    expect(csv(result, "Other Actions.csv")).toEqual([["", ...ACTION_COLUMNS, ACTION_LIST_COLUMN],
      ...others.map(({ labels, cells }, index) => [labels[0], ...cells, ["Products", "+ Regions", "", ""][index]])]);
    // Processes and Exports have no such column: no process or export is said with a list's name.
    expect([csv(result, "Processes.csv")[0], csv(result, "Exports.csv")[0]]).toEqual([["", ...ACTION_COLUMNS], ["", ...ACTION_COLUMNS]]);
    // No grid is read for the names: every grid is read once, in the order it always was, General Lists before the Actions
    // list. The grid of the imports' definitions is read with the Imports tab's row axis, right after it (MAPPINGS_ADDED).
    expect(reads).toEqual(withMappingsRead(["LINE ITEMS 0+1333", "MODULES 0+1333", "LISTS 0+1333", "ACTIONS 0+1333",
      "IMPORTS 0+1333", "DATA SOURCES 0+1333", "TIME RANGES 0+1333", "VERSIONS 0+1333", "CALENDAR 0+1333"]));
    // General Lists cannot be read: Other Actions.csv is exported all the same, with the column there and empty.
    const { [LISTS]: _lists, ...withoutLists } = grids;
    const without = await exportGoldenModel(withoutLists);
    expect(csv(without, "Other Actions.csv")).toEqual(csv(result, "Other Actions.csv").map((cells, index) => (index === 0 ? cells : [...cells.slice(0, -1), ""])));
  });

  it("returns only text and finite numbers as cells, whatever a grid holds, without changing the CSV", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.UTC(2026, 8, 28, 12, 30, 10)));
    const odd = [["Actual", undefined, null, NaN], [true, { id: 7 }, -Infinity, 12]];
    vi.spyOn(grids, "gridTable").mockReturnValue({ headers: ["", "A", "B", "C"], rows: odd as never });
    const result = await exportGoldenModel();
    const versions = result.tables.find(table => table.file === "Versions.csv")!;
    expect(versions.rows).toEqual([["Actual", "", "", "NaN"], ["true", "[object Object]", "-Infinity", 12]]);
    // The file is what the grid's own rows give, unguarded, and is the same after the trip to the results page as JSON.
    const written = "\ufeff,A,B,C\r\nActual,,,NaN\r\ntrue,[object Object],-Infinity,12\r\n";
    expect(toCsv(versions.headers, odd, false)).toBe(written);
    // (Reading a file back as text drops its byte order mark.)
    expect(unzipText(resultZip(result)).get("Versions.csv")).toBe(written.slice(1));
    expect(unzipText(resultZip(JSON.parse(JSON.stringify(result)) as typeof result)).get("Versions.csv")).toBe(written.slice(1));
  });

  it("writes the zip 0.6.1 wrote for the same model, byte for byte but for the Format List column of Line Items.csv, the Action List column of Other Actions.csv and what Model Details.csv says of how to read the tables and of Dynamic Cell Access.csv, and returns each file as a table", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.UTC(2026, 8, 28, 12, 30, 10)));
    const result = await exportGoldenModel();
    // The export writes no zip: the result's tables are written as the files they were (result-zip.test-support.ts), and
    // held against the zip 0.6.1 wrote.
    const zip = resultZip(result, ZIPPED_AT);
    // Five things are deliberately not what 0.6.1 wrote, and each is named (golden-0.6.1.test-support.ts). Line Items.csv has
    // one column more, Format List, its last (MODEL_COLUMN_ADDED): this model's Line Items grid has no Format column, so the
    // column is empty in every row. Other Actions.csv has one column more, Action List, its last
    // (MODEL_ACTIONS_COLUMN_ADDED): this model's one other action names no list, so the column is empty in its row. The
    // "How to read" row of Model Details.csv about Line Items says what the three columns after Anaplan's own hold, where it
    // named the two there were, and what the page's table of line items lists (MODEL_ROW_REWORDED), and the one about the
    // Actions list's files says what Action List holds (MODEL_ACTIONS_ROW_REWORDED). Two more "How to read" rows, on the
    // layout and on the calendar, say what the results page shows, which is where a result is read, with no file of it to
    // download (MODEL_ROWS_FOR_THE_PAGE), and the one on Imports says that the page shows an import's Source Object as
    // three columns (IMPORTS_ROW_REWORDED). And Model Details.csv has two rows more, about a file the export has gained,
    // Dynamic Cell Access.csv (MODEL_FILE_ADDED): this model's Line Items grid has none of the columns the file is made
    // from, so the file is not written for it, and the rows say that and how to read the file. It has a third row more, of
    // "How to read" on Source Models, which the page shows with Mapped To as two columns (MODEL_ROW_ADDED): every model
    // has it, also one without that grid.
    // Everything else is what 0.6.1 wrote, byte for byte.
    // File by file first, so that a difference shows as text: 0.6.1's files in their order, each with its text; of Line
    // Items.csv and of Other Actions.csv every line with that one cell more at its end, and of Model Details.csv every line
    // but those five, with the three lines more.
    const [written, before] = [unzipText(zip), unzipText(MODEL_ZIP_0_6_1)];
    expect([...written.keys()]).toEqual([...before.keys()]);
    const since = (file: string, text: string): string => {
      const column = MODEL_COLUMNS_ADDED.find(added => added.file === file);
      return column ? withColumnAdded(text, column) : file === MODEL_ROW_REWORDED.file ? withDetailsSince(text) : text;
    };
    for (const [file, text] of before) expect(written.get(file), file).toBe(since(file, text));
    // The Line Items file's own cells are 0.6.1's, every one: the column is the last, under its name, and holds nothing.
    const [lineItems, lineItemsBefore] = [parseCsv(written.get(MODEL_COLUMN_ADDED.file)!), parseCsv(before.get(MODEL_COLUMN_ADDED.file)!)];
    expect(lineItems.map(row => row.slice(0, -1))).toEqual(lineItemsBefore);
    expect(lineItems.map(row => row.at(-1))).toEqual([MODEL_COLUMN_ADDED.header, "", "", "", ""]);
    // So are the Other Actions file's: its column is the last too, under its name, and holds nothing in the one row.
    const [actions, actionsBefore] = [parseCsv(written.get(MODEL_ACTIONS_COLUMN_ADDED.file)!), parseCsv(before.get(MODEL_ACTIONS_COLUMN_ADDED.file)!)];
    expect(actions.map(row => row.slice(0, -1))).toEqual(actionsBefore);
    expect(actions.map(row => row.at(-1))).toEqual([MODEL_ACTIONS_COLUMN_ADDED.header, ""]);
    // Model Details.csv has 0.6.1's rows, each in its place and all but five in 0.6.1's words, and three rows that 0.6.1
    // did not write: the rows named, each right after the row it is named to follow. Two are about Dynamic Cell
    // Access.csv: the Files row stands where the file would, after the row for Line Items.csv, and says why this model
    // has none, and the "How to read" row stands after the one on Line Items. The "How to read" row on Source Models is
    // the last of those rows, after the one on the calendar.
    const [details, detailsBefore] = [parseCsv(written.get(MODEL_ROW_REWORDED.file)!), parseCsv(before.get(MODEL_ROW_REWORDED.file)!)];
    const added = [MODEL_FILE_ADDED.notWritten, MODEL_FILE_ADDED.howToRead, MODEL_ROW_ADDED].map(row => ({ after: parseCsv(row.after)[0], row: parseCsv(row.line)[0] }));
    const places = added.map(({ row }) => details.findIndex(each => each.join("\n") === row.join("\n")));
    expect(places.map(place => details[place - 1])).toEqual(added.map(({ after }) => after));
    expect(added.map(({ row }) => row.slice(0, 2))).toEqual([["Files", MODEL_FILE_ADDED.file], ["How to read", "Dynamic Cell Access"], ["How to read", "Source Models"]]);
    expect(added[0].row[2]).toBe("Not exported: Line Items has no Module Name, Read Access Driver and Write Access Driver columns.");
    const kept = details.filter((_, index) => !places.includes(index));
    expect(kept.length).toBe(detailsBefore.length);
    // The four rows that are written otherwise are the four named, in the file's order: on the layout, on Line Items, on
    // the Actions list's files, on Imports and on the calendar.
    expect(kept.flatMap((row, index) => (row.join("\n") === detailsBefore[index].join("\n") ? [] : [[detailsBefore[index], row]])))
      .toEqual([MODEL_ROWS_FOR_THE_PAGE.layout, MODEL_ROW_REWORDED, MODEL_ACTIONS_ROW_REWORDED, IMPORTS_ROW_REWORDED, MODEL_ROWS_FOR_THE_PAGE.calendar].map(row => [parseCsv(row.was)[0], parseCsv(row.now)[0]]));
    // The row on Imports says what it said, and then how the page shows Source Object.
    expect(parseCsv(IMPORTS_ROW_REWORDED.now)[0][2].startsWith(parseCsv(IMPORTS_ROW_REWORDED.was)[0][2])).toBe(true);
    // The row on Line Items is the account of that table, and names each column the export adds to the grid's own; the
    // row on the Actions list's files names the one it adds to theirs.
    const [section, detail, howToRead] = parseCsv(MODEL_ROW_REWORDED.now)[0];
    expect([section, detail, [...RATIO_COLUMNS, FORMAT_LIST_COLUMN].filter(column => !howToRead.includes(column))]).toEqual(["How to read", "Line Items", []]);
    const [actionsSection, actionsDetail, actionsHowToRead] = parseCsv(MODEL_ACTIONS_ROW_REWORDED.now)[0];
    expect([actionsSection, actionsDetail, actionsHowToRead.includes(ACTION_LIST_COLUMN)]).toEqual(["How to read", "Processes, Exports and Other Actions", true]);
    // No "How to read" row names a file, a CSV or a zip, or says to download or to fill one in: the page's overview lists
    // these rows as they are. (Anaplan's own export of a grid, which the layout is said by, is Anaplan's.)
    const said = details.filter(row => row[0] === "How to read").map(row => row[2]);
    expect([said.length, said.filter(text => /\.csv|\bCSV\b|\bzip\b|\bfiles?\b|download|fill in|\bJSON\b/i.test(text))]).toEqual([8, []]);
    // Then every byte. The zip holds the twelve files it held, and no Dynamic Cell Access.csv; only those three have other
    // bytes than 0.6.1's.
    const [files, golden] = [zipEntries(zip), zipEntries(MODEL_ZIP_0_6_1)];
    expect([files.length, files.filter((file, index) => !sameBytes(file.data, golden[index].data)).map(file => file.name)])
      .toEqual([12, [MODEL_ROW_REWORDED.file, MODEL_COLUMN_ADDED.file, MODEL_ACTIONS_COLUMN_ADDED.file]]);
    expect(files.map(file => file.name)).not.toContain(MODEL_FILE_ADDED.file);
    // The zip around the files is written as 0.6.1 wrote it: from 0.6.1's own files, it is 0.6.1's zip.
    expect(sameBytes(zipStore(golden, ZIPPED_AT), MODEL_ZIP_0_6_1)).toBe(true);
    // So this run's zip is, byte for byte, 0.6.1's zip with those two columns added, those five rows reworded and those three rows added.
    expect(sameBytes(zip, MODEL_ZIP_AS_NAMED)).toBe(true);

    expect([result.kind, result.name, result.id, result.zipName])
      .toEqual(["model", "Demand: plan", "FEDCBA9876543210FEDCBA9876543210", "Demand plan - Model Export - 2026-09-28.zip"]);
    // The summary lists each file that was written, then each that was not, in the files' order: Dynamic Cell Access
    // comes right after Line Items, and so before Source Models.
    expect(result.summary).toEqual(["Line Items: 4 rows", "Modules: 2 rows", "General Lists: 2 rows", "Processes: 1 rows",
      "Imports: 3 rows (2 matched in the Actions list)", "Import Data Sources: 1 rows", "Exports: 1 rows", "Other Actions: 1 rows", "Time Ranges: 1 rows",
      "Versions: 2 rows", "Model Calendar: 31 rows", "Dynamic Cell Access: not exported (Line Items has no Module Name, Read Access Driver and Write Access Driver columns.).",
      "Source Models: not exported (This model page has no REMOTE_MODEL axis.)."]);
    // Only Model Details.csv guards formula-like cells: a grid is written exactly as Anaplan's own export writes it.
    expect(result.tables.map(table => [table.file, table.label, table.guard, table.details, table.rows.length])).toEqual([
      ["Model Details.csv", "Model Details", true, true, 30], ["Line Items.csv", "Line Items", false, undefined, 4], ["Modules.csv", "Modules", false, undefined, 2],
      ["General Lists.csv", "General Lists", false, undefined, 2], ["Processes.csv", "Processes", false, undefined, 1], ["Imports.csv", "Imports", false, undefined, 3],
      ["Import Data Sources.csv", "Import Data Sources", false, undefined, 1], ["Exports.csv", "Exports", false, undefined, 1],
      ["Other Actions.csv", "Other Actions", false, undefined, 1], ["Time Ranges.csv", "Time Ranges", false, undefined, 1], ["Versions.csv", "Versions", false, undefined, 2],
      ["Model Calendar.csv", "Model Calendar", false, undefined, 31]]);
    expect(result.tables[1].headers).toEqual(["", "Formula", "Summary", "Notes", "Ratio Numerator", "Ratio Denominator", "Format List"]);
    expect(result.tables[1].rows[1]).toEqual(["Profit", "=Revenue - Cost", '{"summaryMethod":"SUM"}', "First line\nSecond line", "", "", ""]);
    expect([result.tables[8].headers, result.tables[8].rows]).toEqual([["", ...ACTION_COLUMNS, ACTION_LIST_COLUMN],
      [["Delete old items", '{"actionType":"DELETE_BY_SELECTION"}', "", "", "", "Nightly load", "", ""]]]);
    // Plain data: the tables are the same after the trip to the results page as JSON, and so is the zip.
    const received = JSON.parse(JSON.stringify(result)) as typeof result;
    expect(received).toEqual(result);
    expect(sameBytes(resultZip(received, ZIPPED_AT), MODEL_ZIP_AS_NAMED)).toBe(true);
  });

  it("reads Line Items, Modules and General Lists in that order, and keeps each file's place whichever of them cannot be read", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.UTC(2026, 8, 28, 12, 30, 10)));
    const [LINE_ITEMS, MODULES, LISTS] = ["LINE ITEMS × LINE ITEM PROPERTIES", "MODULES × MODULE PROPERTIES", "LISTS × LIST PROPERTIES"];
    const REJECTED = "The model rejected the read.";
    const NO_SOURCE_MODELS = "Source Models: not exported (This model page has no REMOTE_MODEL axis.).";
    // Dynamic Cell Access is made from Line Items, and is no grid: nothing is read for it. This model gets none: its
    // Line Items grid has none of the three columns the file is made from, and without Line Items there is nothing to
    // make it from. The file's row of the Details file and its note stand right after those of Line Items all the same,
    // whichever grid cannot be read.
    const [NO_DRIVER_COLUMNS, NO_LINE_ITEMS] = ["Line Items has no Module Name, Read Access Driver and Write Access Driver columns.", "Line Items was not exported."];
    /** The golden model exported while the model rejects the reads of these grids: the reads of the three grids, the first
     * files of the zip, what the Details file's first four Files rows and the summary's first two lines say, and the notes. */
    const exported = async (...rejected: string[]) => {
      const reads: string[] = [];
      const result = await exportGoldenModel(Object.fromEntries(Object.entries(GOLDEN_GRIDS).filter(([grid]) => !rejected.includes(grid))), reads);
      return {
        reads: reads.filter(read => /^(LINE ITEMS|MODULES|LISTS) /.test(read)),
        zip: [...unzipText(resultZip(result)).keys()].slice(0, 4),
        files: result.tables[0].rows.filter(row => row[0] === "Files").slice(0, 4).map(row => `${row[1]}: ${row[2]}`),
        summary: result.summary.slice(0, 2),
        notes: result.summary.filter(line => line.includes("not exported")),
      };
    };
    // Every grid read: the three are read one after the other, a first row and then the rest, and their files come first.
    expect(await exported()).toEqual({
      reads: ["LINE ITEMS 0+1333", "MODULES 0+1333", "LISTS 0+1333"],
      zip: ["Model Details.csv", "Line Items.csv", "Modules.csv", "General Lists.csv"],
      files: ["Line Items.csv: 4 rows", `Dynamic Cell Access.csv: Not exported: ${NO_DRIVER_COLUMNS}`, "Modules.csv: 2 rows", "General Lists.csv: 2 rows"],
      summary: ["Line Items: 4 rows", "Modules: 2 rows"], notes: [`Dynamic Cell Access: not exported (${NO_DRIVER_COLUMNS}).`, NO_SOURCE_MODELS] });
    // A grid that cannot be read is tried in its turn, its row of the Details file stands where its file would, and the
    // other two files are exported, Line Items first whenever it was read.
    expect(await exported(LISTS)).toEqual({
      reads: ["LINE ITEMS 0+1333", "MODULES 0+1333", "LISTS 0+1333"],
      zip: ["Model Details.csv", "Line Items.csv", "Modules.csv", "Processes.csv"],
      files: ["Line Items.csv: 4 rows", `Dynamic Cell Access.csv: Not exported: ${NO_DRIVER_COLUMNS}`, "Modules.csv: 2 rows", `General Lists.csv: Not exported: ${REJECTED}`],
      summary: ["Line Items: 4 rows", "Modules: 2 rows"], notes: [`Dynamic Cell Access: not exported (${NO_DRIVER_COLUMNS}).`, `General Lists: not exported (${REJECTED}).`, NO_SOURCE_MODELS] });
    expect(await exported(MODULES)).toEqual({
      reads: ["LINE ITEMS 0+1333", "MODULES 0+1333", "LISTS 0+1333"],
      zip: ["Model Details.csv", "Line Items.csv", "General Lists.csv", "Processes.csv"],
      files: ["Line Items.csv: 4 rows", `Dynamic Cell Access.csv: Not exported: ${NO_DRIVER_COLUMNS}`, `Modules.csv: Not exported: ${REJECTED}`, "General Lists.csv: 2 rows"],
      summary: ["Line Items: 4 rows", "General Lists: 2 rows"], notes: [`Dynamic Cell Access: not exported (${NO_DRIVER_COLUMNS}).`, `Modules: not exported (${REJECTED}).`, NO_SOURCE_MODELS] });
    expect(await exported(MODULES, LISTS)).toEqual({
      reads: ["LINE ITEMS 0+1333", "MODULES 0+1333", "LISTS 0+1333"],
      zip: ["Model Details.csv", "Line Items.csv", "Processes.csv", "Imports.csv"],
      files: ["Line Items.csv: 4 rows", `Dynamic Cell Access.csv: Not exported: ${NO_DRIVER_COLUMNS}`, `Modules.csv: Not exported: ${REJECTED}`, `General Lists.csv: Not exported: ${REJECTED}`],
      summary: ["Line Items: 4 rows", "Processes: 1 rows"],
      notes: [`Dynamic Cell Access: not exported (${NO_DRIVER_COLUMNS}).`, `Modules: not exported (${REJECTED}).`, `General Lists: not exported (${REJECTED}).`, NO_SOURCE_MODELS] });
    // Without Line Items the file says so, after the row and the note that say why Line Items was not exported.
    expect(await exported(LINE_ITEMS)).toEqual({
      reads: ["LINE ITEMS 0+1333", "MODULES 0+1333", "LISTS 0+1333"],
      zip: ["Model Details.csv", "Modules.csv", "General Lists.csv", "Processes.csv"],
      files: [`Line Items.csv: Not exported: ${REJECTED}`, `Dynamic Cell Access.csv: Not exported: ${NO_LINE_ITEMS}`, "Modules.csv: 2 rows", "General Lists.csv: 2 rows"],
      summary: ["Modules: 2 rows", "General Lists: 2 rows"],
      notes: [`Line Items: not exported (${REJECTED}).`, `Dynamic Cell Access: not exported (${NO_LINE_ITEMS}).`, NO_SOURCE_MODELS] });
    expect(await exported(LINE_ITEMS, MODULES, LISTS)).toEqual({
      reads: ["LINE ITEMS 0+1333", "MODULES 0+1333", "LISTS 0+1333"],
      zip: ["Model Details.csv", "Processes.csv", "Imports.csv", "Import Data Sources.csv"],
      files: [`Line Items.csv: Not exported: ${REJECTED}`, `Dynamic Cell Access.csv: Not exported: ${NO_LINE_ITEMS}`, `Modules.csv: Not exported: ${REJECTED}`, `General Lists.csv: Not exported: ${REJECTED}`],
      summary: ["Processes: 1 rows", "Imports: 3 rows (2 matched in the Actions list)"],
      notes: [`Line Items: not exported (${REJECTED}).`, `Dynamic Cell Access: not exported (${NO_LINE_ITEMS}).`, `Modules: not exported (${REJECTED}).`, `General Lists: not exported (${REJECTED}).`,
        NO_SOURCE_MODELS] });
  });

  it("says in a note which of its columns the Actions list came without, and that the diagnostic log lists the columns it had", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.UTC(2026, 8, 28, 12, 30, 10)));
    const ACTIONS = "ACTIONS × ACTION PROPERTIES";
    // The golden model's Actions list without its Notes column: every other column is there.
    const kept = ACTION_COLUMNS.flatMap((column, index) => (column === "Notes" ? [] : [index]));
    const without: FakeGrid = { columns: kept.map(index => ACTION_COLUMNS[index]), rows: GOLDEN_GRIDS[ACTIONS].rows.map(each => ({ ...each, cells: kept.map(index => each.cells[index]) })) };
    const said: string[] = [];
    const result = await exportGoldenModel({ ...GOLDEN_GRIDS, [ACTIONS]: without }, [], said);
    // The note is a line of the summary and a Notes row of the Details file: the page's overview lists it under Notes.
    const NOTE = "the Actions list came without Notes; the diagnostic log lists the columns it had.";
    expect([result.summary.filter(line => line.startsWith("Actions: ")), result.tables[0].rows.filter(row => row[0] === "Notes")]).toEqual([[`Actions: ${NOTE}`], [["Notes", "Actions", NOTE]]]);
    // The log does list them, in the line of the read, and that line is in the log the result carries.
    const READ = "Actions: 10 rows × 5 columns; columns: Action | Start Date and Time (UTC) | Most recent duration (ms) | Used in Processes | Used in Dashboards";
    // After it, once the list is read, comes the time its one page took.
    const PAGE = "Actions: rows 0–9 in 0.00 s";
    expect([said.filter(line => line.includes(" Actions: ")), result.tables[0].rows.filter(row => row[0] === "Diagnostics" && String(row[2]).startsWith("Actions: ")).map(row => row[2])])
      .toEqual([[`12:30:10 ${READ}`, `12:30:10 ${PAGE}`], [READ, PAGE]]);
    // A list that has every column it is read for says nothing.
    expect((await exportGoldenModel()).tables[0].rows.filter(row => row[0] === "Notes")).toEqual([]);
  });

  it("takes a Line Items table that cannot be made for that file's failure, in the file's own place, and exports the other files", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.UTC(2026, 8, 28, 12, 30, 10)));
    vi.spyOn(lineItems, "lineItemsTable").mockImplementation(() => { throw new Error("no table"); });
    const result = await exportGoldenModel();
    expect(result.tables.map(table => table.file).slice(0, 4)).toEqual(["Model Details.csv", "Modules.csv", "General Lists.csv", "Processes.csv"]);
    // Dynamic Cell Access is made from the Line Items table: without that table it is not exported either, and says so
    // right after it.
    expect(result.tables[0].rows.filter(row => row[0] === "Files").slice(0, 4).map(row => `${row[1]}: ${row[2]}`))
      .toEqual(["Line Items.csv: Not exported: no table", "Dynamic Cell Access.csv: Not exported: Line Items was not exported.", "Modules.csv: 2 rows", "General Lists.csv: 2 rows"]);
    expect([result.summary.slice(0, 2), result.summary.slice(-3)]).toEqual([["Modules: 2 rows", "General Lists: 2 rows"],
      ["Line Items: not exported (no table).", "Dynamic Cell Access: not exported (Line Items was not exported.).", "Source Models: not exported (This model page has no REMOTE_MODEL axis.)."]]);
    // Its note stands first too, before the note of a file that could not be read after it.
    const { "MODULES × MODULE PROPERTIES": _modules, ...withoutModules } = GOLDEN_GRIDS;
    const both = await exportGoldenModel(withoutModules);
    expect(both.tables[0].rows.filter(row => row[0] === "Files").slice(0, 4).map(row => `${row[1]}: ${row[2]}`)).toEqual(["Line Items.csv: Not exported: no table",
      "Dynamic Cell Access.csv: Not exported: Line Items was not exported.", "Modules.csv: Not exported: The model rejected the read.", "General Lists.csv: 2 rows"]);
    expect(both.summary.filter(line => line.includes("not exported"))).toEqual(["Line Items: not exported (no table).", "Dynamic Cell Access: not exported (Line Items was not exported.).",
      "Modules: not exported (The model rejected the read.).", "Source Models: not exported (This model page has no REMOTE_MODEL axis.)."]);
  });

  it("writes Dynamic Cell Access.csv right after Line Items.csv for a model that drives access, and otherwise the zip 0.8.1 wrote for the same model, byte for byte but for the Action List column of Other Actions.csv and the rows of Model Details.csv that are named", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.UTC(2026, 8, 28, 12, 30, 10)));
    // The golden model with the Line Items and Modules grids of a made-up model whose line items drive one another's
    // access (golden-0.8.1.test-support.ts), exported as the model's frame exports it: its steps and log lines are its log.
    const [reads, said]: string[][] = [[], []];
    const result = await exportGoldenModel({ ...GOLDEN_GRIDS, ...ACCESS_GRIDS }, reads, said);
    const zip = resultZip(result, ZIPPED_AT);
    // 0.8.1 is the last version that did not make the file. What differs from the zip it wrote for this model is named
    // (golden-0.8.1.test-support.ts). The file, which stands right after Line Items.csv, and two rows of Model
    // Details.csv, which give the file's number of rows and say how to read it (ACCESS_FILE_ADDED). Three "How to read"
    // rows, which say what the results page shows since it is where a result is read, with no file of it to download
    // (ACCESS_ROWS_FOR_THE_PAGE). The column Other Actions.csv has gained, with the "How to read" row that says what it
    // holds, as they differ from 0.6.1's zip (MODEL_ACTIONS_COLUMN_ADDED and MODEL_ACTIONS_ROW_REWORDED): this model's one
    // other action names no list, so the column is empty in its row. And two "How to read" rows that every model's Model
    // Details.csv has changed: the one on Imports, reworded (IMPORTS_ROW_REWORDED), and one more, on Source Models
    // (MODEL_ROW_ADDED). Everything else is what 0.8.1 wrote, byte for byte.
    // File by file first, so that a difference shows as text: 0.8.1's files in their order, each with its text, of Other
    // Actions.csv every line with that one cell more at its end, of Model Details.csv every line but those five, with the
    // three lines more, and the file in its place with the text it is to have.
    const [written, before] = [unzipText(zip), unzipText(ACCESS_ZIP_0_8_1)];
    expect([...written.keys()]).toEqual([...before.keys()].flatMap(file => (file === ACCESS_FILE_ADDED.after ? [file, ACCESS_FILE_ADDED.file] : [file])));
    const since = (file: string, text: string): string =>
      (file === ACCESS_FILE_ADDED.details ? withAccessRows(text) : file === MODEL_ACTIONS_COLUMN_ADDED.file ? withColumnAdded(text, MODEL_ACTIONS_COLUMN_ADDED) : text);
    for (const [file, text] of before) expect(written.get(file), file).toBe(since(file, text));
    expect(written.get(ACCESS_FILE_ADDED.file)).toBe(ACCESS_CSV);
    // Row by row, Model Details.csv has 0.8.1's rows, each in its place, with the two rows about the file, the row on
    // Source Models, the Diagnostics row on the modules' IDs, the five on the imports' definitions, and after each of the
    // ten grids with rows the one on the time its page took, among them. The rows in other words than 0.8.1's are the five
    // named, in the file's order: on the layout, on Line Items, on the Actions list's files, on Imports and on the calendar.
    const lines = (text: string): string[] => parseCsv(text).map(row => row.join("\n"));
    const [details, detailsBefore] = [lines(written.get(ACCESS_FILE_ADDED.details)!), lines(before.get(ACCESS_FILE_ADDED.details)!)];
    const paged = details.filter(row => row.startsWith("Diagnostics\n") && PAGE_TIME.test(row.split("\n")[2] ?? ""));
    const gained = [...[ACCESS_FILE_ADDED.written, ACCESS_FILE_ADDED.howToRead, MODEL_ROW_ADDED, MODULE_IDS_ADDED.rows, LIST_IDS_ADDED.rows, MAPPINGS_ADDED.rows].flatMap(row => lines(row.line)),
      ...paged];
    const stayed = details.filter(row => !gained.includes(row));
    expect([details.length, stayed.length, gained.length, paged.length]).toEqual([detailsBefore.length + 20, detailsBefore.length, 20, 10]);
    expect(stayed.flatMap((row, index) => (row === detailsBefore[index] ? [] : [[detailsBefore[index], row]]))).toEqual(ACCESS_ROWS_REWORDED.map(row => [lines(row.was)[0], lines(row.now)[0]]));
    // Then every byte. Of 0.8.1's twelve files, Line Items.csv among them, only Model Details.csv and Other Actions.csv
    // have other bytes.
    const [files, golden] = [zipEntries(zip), zipEntries(ACCESS_ZIP_0_8_1)];
    const kept = files.filter(file => file.name !== ACCESS_FILE_ADDED.file);
    expect([files.length, golden.length, kept.filter((file, index) => !sameBytes(file.data, golden[index].data)).map(file => file.name)])
      .toEqual([13, 12, [ACCESS_FILE_ADDED.details, MODEL_ACTIONS_COLUMN_ADDED.file]]);
    // The zip around the files is written as 0.8.1 wrote it: from 0.8.1's own files, it is 0.8.1's zip.
    expect(sameBytes(zipStore(golden, ZIPPED_AT), ACCESS_ZIP_0_8_1)).toBe(true);
    // So this run's zip is, byte for byte, 0.8.1's zip with that one file put in, that column added, those five rows
    // reworded and those rows added.
    expect(sameBytes(zip, ACCESS_ZIP_WITH_FILE)).toBe(true);

    // Nothing is read for the file, and the export reports no step and no line more: the reads are 0.8.1's, in its order,
    // and so are the steps and the lines of the log, which the Diagnostics rows of Model Details.csv hold one by one, but
    // for the line on the modules' IDs, said right after the Modules grid's (MODULE_IDS_ADDED), and the grid of the
    // imports' definitions, read and said right after the Imports tab (MAPPINGS_ADDED).
    expect(reads).toEqual(withMappingsRead(ACCESS_READS_0_8_1));
    const log = (zipped: Map<string, string>): string[] => parseCsv(zipped.get(ACCESS_FILE_ADDED.details)!).filter(row => row[0] === "Diagnostics").map(row => `${row[1]} ${row[2]}`);
    expect(said).toEqual(withLinesSaid(log(before)));
    expect([log(written), said.filter(line => line.includes("Dynamic Cell Access"))]).toEqual([said, []]);

    // The file has its place right after Line Items in the result too: among the tables, in the summary and among the
    // Details file's Files rows, which say how many of its rows have a driver that could not be matched.
    const counted = "12 rows (2 with a driver that could not be matched)";
    expect(result.tables.map(table => table.file).slice(0, 4)).toEqual(["Model Details.csv", "Line Items.csv", "Dynamic Cell Access.csv", "Modules.csv"]);
    expect(result.summary.slice(0, 3)).toEqual(["Line Items: 16 rows", `Dynamic Cell Access: ${counted}`, "Modules: 5 rows"]);
    expect(result.tables[0].rows.filter(row => row[0] === "Files").slice(0, 3)).toEqual([["Files", "Line Items.csv", "16 rows"], ["Files", "Dynamic Cell Access.csv", counted], ["Files", "Modules.csv", "5 rows"]]);
    // It is a table like a grid's, written without a guard: a name is written as Line Items.csv writes it.
    const table = result.tables[2];
    expect([table.label, table.guard, table.details, table.headers, table.rows.length]).toEqual(["Dynamic Cell Access", false, undefined, ACCESS_HEADERS, 12]);
    expect(tableCsv(table)).toBe(`\ufeff${ACCESS_CSV}`);

    // The page builds the model map from these very tables (results/main.ts). The file's rows are that map's access
    // links, each once, and then the two driver cells the map could match to no line item.
    // The map places every row of this model's Line Items, so the file holds nothing beyond that.
    const held = againstMap(table.rows, result.tables);
    expect([held.placed, held.beyond]).toEqual([held.map, []]);
    expect(held.map.map(part => part.length)).toEqual([10, 2]);
    // And a row of the one table can be found in the other. What a row says is controlled is one row of Line Items.csv, by
    // its name and its Module Name, and so is its driver. A driver that was not matched is, to the character, the cell
    // that row of Line Items.csv has under the driver's column.
    const [lineItems, rows] = [parseCsv(written.get("Line Items.csv")!), parseCsv(written.get(ACCESS_FILE_ADDED.file)!).slice(1)];
    const column = (header: string): number => lineItems[0].indexOf(header);
    const found = (module: string, name: string): string[][] => lineItems.filter(row => row[0] === name && row[column("Module Name")] === module);
    expect(rows.map(([driverModule, driver, kind, module, name]) => [found(module, name).length,
      driverModule === "" ? found(module, name)[0]?.[column(`${kind} Access Driver`)] === driver : found(driverModule, driver).length === 1])).toEqual(rows.map(() => [1, true]));

    // Plain data: the tables are the same after the trip to the results page as JSON, and so is the zip.
    const received = JSON.parse(JSON.stringify(result)) as typeof result;
    expect(received).toEqual(result);
    expect(sameBytes(resultZip(received, ZIPPED_AT), ACCESS_ZIP_WITH_FILE)).toBe(true);
  });

  it("writes Dynamic Cell Access.csv without rows for a model that drives no access, and does not write it when Line Items lacks one of the three columns it is made from", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.UTC(2026, 8, 28, 12, 30, 10)));
    const LINE_ITEMS = "LINE ITEMS × LINE ITEM PROPERTIES";
    const [READ, WRITE, MODULE_NAME] = ["Read Access Driver", "Write Access Driver", "Module Name"];
    const grid = ACCESS_GRIDS[LINE_ITEMS];
    /** The model's Line Items grid with nothing in these columns, and without them. */
    const emptied = (...columns: string[]): FakeGrid => ({ ...grid, rows: grid.rows.map(row => ({ ...row, cells: row.cells.map((cell, index) => (columns.includes(grid.columns[index]) ? "" : cell)) })) });
    const lacking = (...columns: string[]): FakeGrid => ({ columns: grid.columns.filter(header => !columns.includes(header)),
      rows: grid.rows.map(row => ({ ...row, cells: row.cells.filter((_, index) => !columns.includes(grid.columns[index])) })) });
    /** The model exported with that Line Items grid: the file's text, the Details file's first three Files rows, what the
     * summary says of the file, and how many steps and lines the export reported. A file that is written is held against
     * the model map of the result's tables on the way: its rows are that map's access links, and what it could not match. */
    /** How many steps and lines the export reports of this model: 0.8.1's, those on the modules' IDs and on the imports'
     * definitions, and one on the time it took after each of the ten grids with rows, each of them one page. */
    const STEPS = 23 + MODULE_IDS_ADDED.said.length + LIST_IDS_ADDED.said.length + MAPPINGS_ADDED.said.length + 10;
    const exported = async (lineItems: FakeGrid) => {
      const said: string[] = [];
      const result = await exportGoldenModel({ ...GOLDEN_GRIDS, ...ACCESS_GRIDS, [LINE_ITEMS]: lineItems }, [], said);
      const zip = unzipText(resultZip(result, ZIPPED_AT));
      const table = result.tables.find(each => each.file === "Dynamic Cell Access.csv");
      const held = againstMap(table?.rows ?? [], table ? result.tables : []);
      expect([held.placed, held.beyond]).toEqual([held.map, []]);
      return { file: zip.get("Dynamic Cell Access.csv"), files: result.tables[0].rows.filter(row => row[0] === "Files").slice(0, 3).map(row => `${row[1]}: ${row[2]}`),
        summary: result.summary.filter(line => line.startsWith("Dynamic Cell Access")), said: said.length, lineItems: parseCsv(zip.get("Line Items.csv") ?? "")[0] };
    };
    const whole = await exported(grid);
    expect([whole.file, whole.said]).toEqual([ACCESS_CSV, STEPS]);
    // No line item has a driver: the two columns are there, and empty. The file is written, with its header and no row.
    const HEADER = "Driver Module,Driver Line Item,Access,Controlled Module,Controlled Line Item\r\n";
    expect(await exported(emptied(READ, WRITE))).toEqual({ file: HEADER, files: ["Line Items.csv: 16 rows", "Dynamic Cell Access.csv: 0 rows", "Modules.csv: 5 rows"],
      summary: ["Dynamic Cell Access: 0 rows"], said: STEPS, lineItems: whole.lineItems });
    // Only write drivers: the file's six Write rows, in the order they have among all twelve, the one that was not
    // matched last.
    const writes = await exported(emptied(READ));
    expect([writes.file, writes.files[1], writes.summary]).toEqual([[HEADER.trimEnd(), ...ACCESS_CSV.split("\r\n").filter(line => line.includes(",Write,")), ""].join("\r\n"),
      "Dynamic Cell Access.csv: 6 rows (1 with a driver that could not be matched)", ["Dynamic Cell Access: 6 rows (1 with a driver that could not be matched)"]]);
    // A Line Items grid without one of the two driver columns, or without both: the file is not written, and its row of
    // the Details file and the summary say which column is not there. Line Items.csv is written as the grid is, as ever.
    // The export reports the steps and the lines it reports of any model: a file that has nothing to be made from is no
    // failure, and no line of the log.
    const withoutWrite = await exported(lacking(WRITE));
    expect(withoutWrite).toEqual({ file: undefined, files: ["Line Items.csv: 16 rows", "Dynamic Cell Access.csv: Not exported: Line Items has no Write Access Driver column.", "Modules.csv: 5 rows"],
      summary: ["Dynamic Cell Access: not exported (Line Items has no Write Access Driver column.)."], said: STEPS, lineItems: whole.lineItems.filter(header => header !== WRITE) });
    expect([(await exported(lacking(READ))).files[1], (await exported(lacking(READ, WRITE))).files[1]]).toEqual([
      "Dynamic Cell Access.csv: Not exported: Line Items has no Read Access Driver column.",
      "Dynamic Cell Access.csv: Not exported: Line Items has no Read Access Driver and Write Access Driver columns."]);
    // Without Module Name no row of Line Items says which module it is in. The file would have rows that name none, or
    // no rows at all, and say of neither that the grid is at fault: it is not written, with both driver columns there.
    const withoutModuleName = await exported(lacking(MODULE_NAME));
    expect(withoutModuleName).toEqual({ file: undefined, files: ["Line Items.csv: 16 rows", "Dynamic Cell Access.csv: Not exported: Line Items has no Module Name column.", "Modules.csv: 5 rows"],
      summary: ["Dynamic Cell Access: not exported (Line Items has no Module Name column.)."], said: STEPS, lineItems: whole.lineItems.filter(header => header !== MODULE_NAME) });
    expect((await exported(lacking(MODULE_NAME, READ, WRITE))).files[1])
      .toBe("Dynamic Cell Access.csv: Not exported: Line Items has no Module Name, Read Access Driver and Write Access Driver columns.");
  });

  it("writes each name in Dynamic Cell Access.csv as Line Items.csv writes it, with nothing before a name that starts with a sign", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.UTC(2026, 8, 28, 12, 30, 10)));
    // A module and three line items whose names a spreadsheet would take for formulas. The model's page serves this grid alone.
    const [EXTRAS, FLAG, NUMBER] = [102000000001, '{"dataType":"BOOLEAN"}', '{"dataType":"NUMBER"}'];
    const lineItems: FakeGrid = { columns: ["Format", "Read Access Driver", "Write Access Driver", "Module Name"], rows: [
      { ids: [EXTRAS, -1], labels: ["+ Extras", null], cells: ["", "", "", ""] },
      { ids: [1901000000001, EXTRAS], labels: ["=Open?", "+ Extras"], cells: [FLAG, "", "", "+ Extras"] },
      { ids: [1901000000002, EXTRAS], labels: ["-Adjustment", "+ Extras"], cells: [NUMBER, "'=Open?'", "", "+ Extras"] },
      { ids: [1901000000003, EXTRAS], labels: ["@Home", "+ Extras"], cells: [NUMBER, "", "'+ Extras'.'=Open?'", "+ Extras"] }] };
    const result = await exportGoldenModel({ "LINE ITEMS × LINE ITEM PROPERTIES": lineItems });
    const zip = unzipText(resultZip(result));
    expect([...zip.keys()]).toEqual(["Model Details.csv", "Line Items.csv", "Dynamic Cell Access.csv"]);
    // The export guards only Model Details.csv. A grid's file is written as Anaplan's own export writes it, and so is
    // this one, which is made of a grid's names: a name here is, to the character, the name there.
    expect(zip.get("Dynamic Cell Access.csv")).toBe(["Driver Module,Driver Line Item,Access,Controlled Module,Controlled Line Item",
      "+ Extras,=Open?,Read,+ Extras,-Adjustment", "+ Extras,=Open?,Write,+ Extras,@Home", ""].join("\r\n"));
    expect(parseCsv(zip.get("Line Items.csv")!).slice(1).map(row => [row[0], row[4]])).toEqual([["+ Extras", ""], ["=Open?", "+ Extras"], ["-Adjustment", "+ Extras"], ["@Home", "+ Extras"]]);
    expect(result.tables.map(table => table.guard)).toEqual([true, false, false]);
    // The map of these tables has the same two links.
    const held = againstMap(result.tables[2].rows, result.tables);
    expect([held.placed, held.beyond, held.map[0].length]).toEqual([held.map, [], 2]);
  });

  it("writes a row for every driver cell of Line Items that says something, also in a row the model map leaves out, and counts the rows it wrote", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.UTC(2026, 8, 28, 12, 30, 10)));
    const [LINE_ITEMS, MODULES] = ["LINE ITEMS × LINE ITEM PROPERTIES", "MODULES × MODULE PROPERTIES"];
    const COLUMNS = ["Format", "Read Access Driver", "Write Access Driver", "Module Name"];
    const [NUMBER, FLAG] = ['{"dataType":"NUMBER"}', '{"dataType":"BOOLEAN"}'];
    type Line = [name: string, format: string, read: string, write: string, moduleName: string];
    /** A module's own row, a line item that is a tick box, and a line item with its two driver cells. */
    const own = (name: string, read = "", write = ""): Line => [name, "", read, write, ""];
    const flag = (inModule: string, name: string): Line => [name, FLAG, "", "", inModule];
    const line = (inModule: string, name: string, read = "", write = ""): Line => [name, NUMBER, read, write, inModule];
    /** The model exported from a page that serves these rows as its Line Items grid, in these columns, and these names as
     * its Modules grid: the rows that name no module and have no format, unless others are given, and no such grid for
     * `null`. It gives the file's text after its header, what the Details file and the summary say of the file, and the
     * map's count of the rows it left out. The file's rows are held against the map of the result's tables on the way. */
    const exported = async (lines: Line[], modules: string[] | null = lines.filter(each => each[1] === "" && each[4] === "").map(each => each[0]), columns = COLUMNS) => {
      const at = columns.map(column => COLUMNS.indexOf(column) + 1);
      const grids: Record<string, FakeGrid> = { [LINE_ITEMS]: { columns, rows: lines.map((each, index) => ({ ids: [1901000000001 + index, -1], labels: [each[0], null], cells: at.map(place => each[place]) })) },
        ...(modules ? { [MODULES]: { columns: ["Applies To"], rows: modules.map((name, index) => row(102000000001 + index, name, "")) } } : {}) };
      const result = await exportGoldenModel(grids);
      const table = result.tables.find(each => each.file === "Dynamic Cell Access.csv");
      const held = againstMap(table?.rows ?? [], table ? result.tables : []);
      expect([held.placed, held.unexplained, held.vanished]).toEqual([held.map, [], []]);
      // The Details file and the summary count the rows the file has, and those of them without a Driver Module.
      const unmatched = table?.rows.filter(each => each[0] === "").length;
      const counted = table && `${table.rows.length} rows${unmatched ? ` (${unmatched} with a driver that could not be matched)` : ""}`;
      const said = result.tables[0].rows.find(each => each[0] === "Files" && each[1] === "Dynamic Cell Access.csv")?.[2];
      if (table) expect([said, result.summary.filter(each => each.startsWith("Dynamic Cell Access"))]).toEqual([counted, [`Dynamic Cell Access: ${counted}`]]);
      return { rows: unzipText(resultZip(result)).get("Dynamic Cell Access.csv")?.split("\r\n").slice(1, -1), said, beyond: held.beyond.length,
        leftOut: buildModelGraph(result.tables).limitations.filter(each => /^\d+ .*left out/.test(each)).map(each => each.replace(/^(\d+) .* (is|are) left out.*$/, "$1")) };
    };

    // A module whose name reads as a heading, with line items: the map takes its row for a heading and leaves its two
    // line items out. One of them has a read driver and a write driver: both cells are rows, the one that names a line
    // item the map holds matched, the other, a name alone in a module of which the map holds no line item, as written.
    expect(await exported([own("Flags"), flag("Flags", "Open"), own("-- Archive 2025"), flag("-- Archive 2025", "Locked"), line("-- Archive 2025", "Old units", "Flags.Open", "Locked"),
      own("Sales"), line("Sales", "Units", "'-- Archive 2025'.Locked", "Flags.Open")])).toEqual({
      rows: ["Flags,Open,Read,-- Archive 2025,Old units", "Flags,Open,Write,Sales,Units", ",Locked,Write,-- Archive 2025,Old units", ",'-- Archive 2025'.Locked,Read,Sales,Units"],
      said: "4 rows (2 with a driver that could not be matched)", beyond: 2, leftOut: ["2"] });
    // A module named with dots alone, which is a heading to the map too, holds the model's only use of a driver.
    expect(await exported([own("Flags"), flag("Flags", "Open"), own("..."), line("...", "Units", "Flags.Open")]))
      .toEqual({ rows: ["Flags,Open,Read,...,Units"], said: "1 rows", beyond: 1, leftOut: ["1"] });
    // A line item whose Module Name cell is empty, and two that name no row above them: each is listed with its Module
    // Name cell as it is written, the first with none.
    expect(await exported([own("Flags"), flag("Flags", "Open"), own("Sales"), line("", "Units", "Flags.Open"), line("Sales ", "Price", "", "Flags.Open"),
      line("Old sales", "Cost", "Open", "'Flags'.Open")])).toEqual({
      rows: ["Flags,Open,Read,,Units", "Flags,Open,Write,Sales ,Price", "Flags,Open,Write,Old sales,Cost", ",Open,Read,Old sales,Cost"],
      said: "4 rows (1 with a driver that could not be matched)", beyond: 4, leftOut: ["1", "2"] });
    // A Line Items grid with both driver columns and no Module Name column: no row says its module, and no file is written.
    expect(await exported([own("Flags"), flag("Flags", "Open"), own("Sales"), line("Sales", "Units", "Flags.Open", "Flags.Open")], undefined, COLUMNS.slice(0, 3)))
      .toEqual({ rows: undefined, said: "Not exported: Line Items has no Module Name column.", beyond: 0, leftOut: ["2"] });

    // The file is made from every table the export holds, as the map is. Stray names no module and has no format: with
    // the Modules table, which does not list it, it is a line item whose module the file does not say, and is listed as
    // one. With a Modules table that lists it, and without that table, it is a module's own row.
    const stray = [own("Flags"), flag("Flags", "Open"), own("Stray", "Flags.Open")];
    expect([(await exported(stray, ["Flags"])).rows, (await exported(stray, ["Flags", "Stray"])).rows, (await exported(stray, null)).rows])
      .toEqual([["Flags,Open,Read,,Stray"], ["Flags,Open,Read,Stray,"], ["Flags,Open,Read,Stray,"]]);
  });

  it("takes a Dynamic Cell Access table that cannot be made for that file's failure, in the file's place and with the reason in the log, and exports the other files as they are", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.UTC(2026, 8, 28, 12, 30, 10)));
    const grids = { ...GOLDEN_GRIDS, ...ACCESS_GRIDS };
    const [said, saidWithout]: string[][] = [[], []];
    const whole = await exportGoldenModel(grids, [], said);
    vi.spyOn(access, "accessTable").mockImplementation(() => { throw new Error("no table"); });
    const result = await exportGoldenModel(grids, [], saidWithout);
    // The file is not in the zip, and its row of the Details file and its note stand where it would: after Line Items.
    expect(result.tables.map(table => table.file)).toEqual(whole.tables.map(table => table.file).filter(name => name !== "Dynamic Cell Access.csv"));
    expect(result.tables[0].rows.filter(row => row[0] === "Files").slice(0, 3).map(row => `${row[1]}: ${row[2]}`))
      .toEqual(["Line Items.csv: 16 rows", "Dynamic Cell Access.csv: Not exported: no table", "Modules.csv: 5 rows"]);
    expect([result.summary.slice(0, 2), result.summary.slice(-2)]).toEqual([["Line Items: 16 rows", "Modules: 5 rows"],
      ["Dynamic Cell Access: not exported (no table).", "Source Models: not exported (This model page has no REMOTE_MODEL axis.)."]]);
    // Every other file is the one the export writes when the table is made, cell for cell: no file depends on this one.
    for (const table of result.tables.slice(1)) expect(table, table.file).toEqual(whole.tables.find(other => other.file === table.file));
    // The reason is in the Details file's row and, as any other file's failure is, in the log: one line more, after
    // the lines of the last grid, since the file is made once every grid is read. The file is still no step of its own.
    // The steps and lines are 0.8.1's, with those on the modules' and the lists' IDs (MODULE_IDS_ADDED, LIST_IDS_ADDED)
    // and on the imports' definitions (MAPPINGS_ADDED), and after each grid's line that of the time its one page took, ten
    // in all.
    expect([said.length, saidWithout]).toEqual([23 + MODULE_IDS_ADDED.said.length + LIST_IDS_ADDED.said.length + MAPPINGS_ADDED.said.length + 10, [...said, "12:30:10 Dynamic Cell Access: no table"]]);
    expect([said.filter(line => PAGE_TIME.test(line)).length, withPageTimes(said.filter(line => !PAGE_TIME.test(line)))]).toEqual([10, said]);
    expect(result.tables[0].rows.filter(row => row[0] === "Diagnostics").at(-1)).toEqual(["Diagnostics", "12:30:10", "Dynamic Cell Access: no table"]);
  });
});

// One model exported end to end, as the 0.6.1 zip in golden-0.6.1.test-support.ts was made: every Model settings grid the
// export reads, with the values a CSV has to quote (commas, quotes, line breaks) and text that looks like a formula, an
// import the Imports tab does not list, and one grid the page's client does not have (Source Models).
interface FakeGrid { columns: string[]; columnIds?: number[]; rows: { ids: number[]; labels: (string | null)[]; cells: string[] }[] }
const row = (id: number, label: string, ...cells: string[]) => ({ ids: [id], labels: [label], cells });
const ACTION_COLUMNS = ["Action", "Start Date and Time (UTC)", "Most recent duration (ms)", "Notes", "Used in Processes", "Used in Dashboards"];
const GOLDEN_RATIO = JSON.stringify({ summaryMethod: "RATIO", timeSummaryMethod: "RATIO", ratioNumeratorIdentifier: "_1901000000001_", ratioDenominatorIdentifier: "_1901000000002_" });
/** The definitions of the golden model's two imports, as Anaplan's import dialog saves them (model/import-mappings.ts),
 * in the grid of the imports against their properties, whose column of definitions the page's client knows by its ID.
 * The import from a file loads Products from its first column, Time from its second, the line items from its third and
 * their values from its fifth: its fourth column is not used. The other import loads a list from another model: its
 * mapping is not read. */
const PRICES_DEFINITION = JSON.stringify({ importType: "MODULE_DATA", target: "_102000000003_", mappings: [
  { targetType: "moduleDimension", target: "_101000000001_", sourceType: "column", sourceColumnId: "#1", sourceColumnName: "Product" },
  { targetType: "moduleDimension", target: "_9000000001_", sourceType: "column", sourceColumnId: "#2", sourceColumnName: "Month" },
  { targetType: "moduleDimension", target: "", sourceType: "column", sourceColumnId: "#3", sourceColumnName: "Line item" },
  { targetType: "moduleLineItem", target: "", sourceType: "column", sourceColumnId: "#5", sourceColumnName: "Price" }] });
const REGIONS_DEFINITION = JSON.stringify({ importType: "HIERARCHY_DATA", target: "_101000000002_", mappings: [
  { targetType: "hierarchyMemberEntityName", target: "", sourceType: "column", sourceColumnEntityLongId: 101000000009, sourceColumnName: "Region" }] });
const GOLDEN_GRIDS: Record<string, FakeGrid> = {
  "LINE ITEMS × LINE ITEM PROPERTIES": { columns: ["Formula", "Summary", "Notes"], rows: [
    { ids: [102000000001, -1], labels: ["Profitability", null], cells: ["", "", ""] },
    { ids: [1901000000001, 102000000001], labels: ["Profit", "Profitability"], cells: ["=Revenue - Cost", '{"summaryMethod":"SUM"}', "First line\nSecond line"] },
    { ids: [1901000000002, 102000000001], labels: ["Revenue", "Profitability"], cells: ["IF Units > 0 THEN Units * Price ELSE 0", '{"summaryMethod":"SUM"}', 'Says "gross", before tax'] },
    { ids: [1901000000003, 102000000001], labels: ["Margin %", "Profitability"], cells: ["Profit / Revenue", GOLDEN_RATIO, "-1+1"] }] },
  "MODULES × MODULE PROPERTIES": { columns: ["Applies To", "Cell Count"], rows: [row(102000000001, "Profitability", "Products, Time", "2252068"), row(102000000002, "-- MODEL ADMIN", "-", "12")] },
  "LISTS × LIST PROPERTIES": { columns: ["Top Level Item", "Production Data"], rows: [row(101000000001, "Products", "All Products", "true"), row(101000000002, "+ Regions", "", "false")] },
  "ACTIONS × ACTION PROPERTIES": { columns: ACTION_COLUMNS, rows: [
    row(31000000001, "Processes", "", "", "", "", "", ""),
    row(118000000001, "Nightly load", "", "2026-03-12 23:19:56", "582", "Runs at 2am", "", "Admin"),
    row(31000000002, "Imports", "", "", "", "", "", ""),
    row(112000000002, "Prices from prices.csv", "Import into Prices", "2026-03-12 23:19:56", "582", "", "Nightly load", ""),
    row(112000000001, "1.1 Load regions", "Import into Regions", "", "", "From the hub", "Nightly load, Weekly load", ""),
    row(112000000003, "Old import", "Import into Old", "", "", "", "", ""),
    row(31000000003, "Exports", "", "", "", "", "", ""),
    row(116000000001, "Send plan", '{"exportType":"GRID_CURRENT_PAGE"}', "", "", "", "", "Review"),
    row(31000000004, "Other Actions", "", "", "", "", "", ""),
    row(117000000001, "Delete old items", '{"actionType":"DELETE_BY_SELECTION"}', "", "", "", "Nightly load", "")] },
  "IMPORTS × IMPORT PROPERTIES": { columns: ["Source Label", "Source Object", "Source Type", "Target Object", "Target Type", "Production Data"], rows: [
    row(112000000001, "1.1 Load regions", "Hub / Regions", "Hub / 'LIST - Regions'.Export", "SAVED VIEW", "Regions", "LIST", "false"),
    row(112000000002, "Prices from prices.csv", "prices.csv", "-", "FILE", "Prices", "MODULE", "false")] },
  "IMPORTS × IMPORT DEFINITIONS": { columns: ["Notes", "Import Definition"], columnIds: [4000000017, 4000001300], rows: [
    row(112000000001, "1.1 Load regions", "", REGIONS_DEFINITION), row(112000000002, "Prices from prices.csv", "From the price list", PRICES_DEFINITION)] },
  "DATA SOURCES × DATA SOURCE PROPERTIES": { columns: ["Type", "Used in Imports"], rows: [row(113000000001, "prices.csv", "FILE", "Prices from prices.csv")] },
  "TIME RANGES × TIME RANGE PROPERTIES": { columns: ["Start Period", "End Period"], rows: [row(123000000001, "FY24-FY25", "FY24", "FY25")] },
  "VERSIONS × VERSION PROPERTIES": { columns: ["Is Actual", "Switchover"], rows: [row(107000000001, "Actual", "true", ""), row(107000000002, "Forecast", "false", "@Current Period")] },
  "CALENDAR × EMPTY": { columns: [""], rows: [row(CALENDAR_PROPERTIES["Calendar Type"], "Calendar Type", "Weeks: 4-4-5, 4-5-4 or 5-4-4"),
    row(CALENDAR_PROPERTIES["End of Fiscal Year is"], "End of Fiscal Year is", "Last in Month"), row(CALENDAR_PROPERTIES["End of Fiscal Year - day"], "Day", "7"),
    row(CALENDAR_PROPERTIES["End of Fiscal Year - month"], "Month", "12"), row(CALENDAR_PROPERTIES["Fiscal Year Label"], "Fiscal Year Label", "FY"),
    row(CALENDAR_PROPERTIES.Timescale, "Timescale", "false"), row(CALENDAR_PROPERTIES["Fiscal Year Label is aligned with"], "Aligned with", "false"),
    row(CALENDAR_PROPERTIES["Current Fiscal Year"], "Current Fiscal Year", "FY24"), row(CALENDAR_PROPERTIES["Number of Past Years"], "Past Years", "1"),
    row(CALENDAR_PROPERTIES["Include Quarter Totals"], "Quarter Totals", "true")] },
};
const GOLDEN_AXES: Record<string, string> = { MODULE_WITH_LINE_ITEM: "LINE ITEMS", LINE_ITEM_PROPERTY: "LINE ITEM PROPERTIES", MODULE_ALL: "MODULES", HIERARCHY: "LISTS",
  ACTION_WITH_HEADING: "ACTIONS", IMPORT_ALL: "IMPORTS", IMPORT_DEFINITION_PROPERTY: "IMPORT PROPERTIES", IMPORT_PROPERTY: "IMPORT DEFINITIONS", IMPORT_DATA_SOURCE: "DATA SOURCES",
  IMPORT_DATA_SOURCE_DETAILS_PROPERTY: "DATA SOURCE PROPERTIES", TIME_RANGE: "TIME RANGES", TIME_RANGE_PROPERTY: "TIME RANGE PROPERTIES", VERSION_ALL: "VERSIONS",
  VERSION_PROPERTY: "VERSION PROPERTIES", TIMESCALE_PROPERTY: "CALENDAR", EMPTY_1_0: "EMPTY" };

/** Runs the model export against a page whose classic client serves those grids, a few rows at a time. The model rejects
 * the read of a grid that is not among `grids`, and `reads` is given each read in order: its row axis and the rows asked for.
 * With `said`, the export's steps and log lines are kept there as the model's frame keeps them (bridge.ts `serveCore`):
 * each stamped as it is said, a step as a line, and all of them together the log the export is given for its Details file.
 * `client` can keep every request the page's client is given to send (`posted`), and make the requests its generator
 * makes (`request`), where they are not the reads it makes otherwise. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function exportGoldenModel(grids: Record<string, FakeGrid> = GOLDEN_GRIDS, reads: string[] = [], said?: string[], client: { posted?: any[]; request?: (params: any) => unknown } = {}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const aggregator = { isDirty: () => false, post: (request: any, _flag: boolean, ok: (response: unknown) => boolean) => {
    client.posted?.push(request);
    const { viewDefinition, pageRequests: [{ startRow, rowCount }] } = request.params;
    reads.push(`${viewDefinition.rowAxis} ${startRow}+${rowCount}`);
    const grid = grids[`${viewDefinition.rowAxis} × ${viewDefinition.columnAxis}`];
    if (!grid) {
      queueMicrotask(() => ok({ error: "no such grid" }));
      return true;
    }
    const slice = grid.rows.slice(startRow, startRow + rowCount);
    const dimensions = Math.max(...grid.rows.map(entry => entry.ids.length));
    queueMicrotask(() => ok({ result: { viewRequestResults: [{ rowCount: grid.rows.length, columnCount: grid.columns.length,
      rowLabelPages: [{ start: startRow, count: slice.length, entityLongIds: Array.from({ length: dimensions }, (_, d) => slice.map(entry => entry.ids[d] ?? -1)),
        labels: Array.from({ length: dimensions }, (_, d) => slice.map(entry => entry.labels[d] ?? null)) }],
      columnLabelPages: [{ start: 0, count: grid.columns.length, entityLongIds: [grid.columnIds ?? grid.columns.map((_, index) => 4000000001 + index)], labels: [grid.columns] }],
      dataPages: [{ startRow, rows: slice.map(entry => entry.cells) }] }] } }));
    return true;
  } };
  const cache = { getModelName: () => "Demand: plan", getWorkspaceInfo: () => ({ name: "Workspace one" }), getAllCurrenciesLabelPage: () => undefined,
    getActionInfo: (id: number) => (Math.floor(id / 1e9) === 31 ? null : { id }), getTimescaleInfo: () => ({ calendarTypeEntityIndex: 3 }),
    getApplicationPropertyEnabledOrNotSet: () => true };
  const helper = { getAxesForViewDefinition: (rowAxes: string[], columnAxes: string[]) => ({ rowAxis: rowAxes[0], columnAxis: columnAxes[0] }) };
  const constants = { ...Object.fromEntries(Object.entries(GOLDEN_AXES).map(([name, value]) => [`SYSTEM_AXIS_IDENTIFIER_${name}_IDENTIFIER`, value])),
    CALENDAR_TYPE_WEEKS_GENERAL_ENTITY_INDEX: 1, CALENDAR_TYPE_THIRTEEN_FOUR_WEEK_PERIODS_ENTITY_INDEX: 2, FEATURE_FLAGS: { TIME_SUMMARY: "timeSummary" } };
  const axisHelper = { getModuleSystemAxisIdentifier: () => "MODULE PROPERTIES", getHierarchySystemAxisIdentifier: () => "LIST PROPERTIES",
    getActionSystemAxisIdentifier: () => "ACTION PROPERTIES" };
  class RequestGenerator { getRequest(params: unknown) { return client.request?.(params) ?? { requestType: "VIEW_REQUEST_SET", submissions: [], systemActions: [], params }; } }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  class DataPage extends FakePage { constructor({ page }: any) { super(page); } }
  vi.stubGlobal("window", { workspaceId: "0123456789abcdef0123456789abcdef", modelId: "FEDCBA9876543210FEDCBA9876543210",
    require: (_modules: string[], loaded: (...modules: unknown[]) => void) =>
      loaded(cache, aggregator, helper, { getEntityTypeIndex: (id: number) => Math.floor(id / 1e9) }, constants, RequestGenerator, DataPage, axisHelper) });
  vi.stubGlobal("location", { host: "eu2a.app.anaplan.com", pathname: "/core-webapp/anaplan/framework.jsp" });
  const keep = (text: string): void => { said?.push(stampLine(text)); };
  return exportModel({ status: keep, log: keep },
    () => said?.join("\r\n") ?? "12:30:10 Loading the model page's client…\r\n12:30:10 Line Items: 4 rows × 3 columns; columns: Formula | Summary | Notes");
}

describe("The modules' IDs a model's result keeps", () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it("are those of Modules and of the module rows of Line Items, each name once, for opening a module in Model Building", async () => {
    // The golden model: its two modules, the heading among them, read in Modules before Line Items names Profitability again.
    expect((await exportGoldenModel()).moduleIds).toEqual([["Profitability", "102000000001"], ["-- MODEL ADMIN", "102000000002"]]);
    const grid = (rows: [number, string][]): Grid => ({ columns: [], rows: rows.map(([id, name]) => ({ ids: [id], labels: [name], cells: [] })) });
    // An ID is a module's by the type it starts with, as Anaplan's long IDs carry it, whatever the client can say.
    const blind = { ids: {} } as never;
    expect(moduleIdsOf(blind, [grid([[102000000005, "Sales"], [1901000000001, "Units"], [-1, "Gone"], [102000000006, ""], [Number.NaN, "Odd"]]), undefined,
      grid([[102000000007, "Sales"], [102000000008, "Costs"]])])).toEqual([["Sales", "102000000005"], ["Costs", "102000000008"]]);
    // A client whose numbers for the types are not the IDs' own takes no module away: one that calls every ID a list's, or
    // says another number for every one, leaves each module that its ID says is one.
    for (const type of [101, 5, Number.NaN]) {
      const other = { ids: { getEntityTypeIndex: () => type } } as never;
      expect(moduleIdsOf(other, [grid([[102000000009, "Listed"], [1901000000001, "Units"]])]), String(type)).toEqual([["Listed", "102000000009"]]);
    }
    // Its word adds an ID that does not start with a module's type, where it says the ID is a module's.
    const says = { ids: { getEntityTypeIndex: (id: number) => (id === 7 ? 102 : 101) } } as never;
    expect(moduleIdsOf(says, [grid([[7, "Small"], [8, "Other"], [102000000009, "Listed"]])])).toEqual([["Small", "7"], ["Listed", "102000000009"]]);
  });

  it("come with the IDs of each row of Line Items, beside its table, row for row: its own, and a line item's module's", async () => {
    const result = await exportGoldenModel();
    const table = result.tables.find(each => each.file === "Line Items.csv")!;
    expect([table.rows.map(row => row[0]), result.lineItemIds]).toEqual([["Profitability", "Profit", "Revenue", "Margin %"],
      [["102000000001", ""], ["1901000000001", "102000000001"], ["1901000000002", "102000000001"], ["1901000000003", "102000000001"]]]);
    // An ID that is no whole number above 0 is given as none.
    expect(lineItemIdsOf({ columns: [], rows: [{ ids: [Number.NaN, 102000000005], labels: ["Odd", "Sales"], cells: [] }, { ids: [0], labels: ["Zero"], cells: [] },
      { ids: [1901000000009, 1.5], labels: ["Half", "?"], cells: [] }] })).toEqual([["", "102000000005"], ["", ""], ["1901000000009", ""]]);
    // Without a Line Items table there are none.
    const rest = Object.fromEntries(Object.entries(GOLDEN_GRIDS).filter(([grid]) => grid !== "LINE ITEMS × LINE ITEM PROPERTIES"));
    expect(Object.hasOwn(await exportGoldenModel(rest), "lineItemIds")).toBe(false);
  });

  it("of the lists are General Lists', taken the same way, carried and said in the log the same way", async () => {
    // The golden model's two lists.
    expect((await exportGoldenModel()).listIds).toEqual([["Products", "101000000001"], ["+ Regions", "101000000002"]]);
    const grid = (rows: [number, string][]): Grid => ({ columns: [], rows: rows.map(([id, name]) => ({ ids: [id], labels: [name], cells: [] })) });
    // A list's ID by the type it starts with, a module's and a subset's not, and each name once; the client's word adds one.
    const blind = { ids: {} } as never;
    expect(listIdsOf(blind, [grid([[101000000017, "Products"], [102000000001, "Sales"], [101000000018, ""], [101000000019, "Products"], [109000000001, "Active"]])]))
      .toEqual([["Products", "101000000017"]]);
    const says = { ids: { getEntityTypeIndex: (id: number) => (id === 7 ? 101 : Math.floor(id / 1e9)) } } as never;
    expect(listIdsOf(says, [grid([[7, "Small"], [101000000020, "Regions"]]), undefined])).toEqual([["Small", "7"], ["Regions", "101000000020"]]);
    expect(listIdsOf(says, [undefined])).toEqual([]);
    expect(listIdsLine(says, [grid([[101000000017, "Products"]])], 1)).toBe("List IDs: 1 found; the first row listed has ID 101000000017, of type 101 by the model's client");
    expect(listIdsLine(says, [undefined], 0)).toBe("List IDs: 0 found; no grid lists a list");
  });

  it("are carried however many were found, and said in the log with the first row listed", () => {
    const grid = (rows: [number, string][]): Grid => ({ columns: [], rows: rows.map(([id, name]) => ({ ids: [id], labels: [name], cells: [] })) });
    const says = { ids: { getEntityTypeIndex: (id: number) => Math.floor(id / 1e9) } } as never;
    // The first row of Modules, or of Line Items where Modules has none or was not read: its ID and the client's type of it.
    expect(moduleIdsLine(says, [grid([[102000000004, "-- Inputs --"], [102000000005, "Sales"]]), grid([[102000000005, "Sales"]])], 2))
      .toBe("Module IDs: 2 found; the first row listed has ID 102000000004, of type 102 by the model's client");
    expect(moduleIdsLine(says, [undefined, grid([[114000000001, "Units"]])], 0)).toBe("Module IDs: 0 found; the first row listed has ID 114000000001, of type 114 by the model's client");
    expect(moduleIdsLine({ ids: {} } as never, [grid([[102000000004, "Sales"]])], 1)).toBe("Module IDs: 1 found; the first row listed has ID 102000000004, of type -1 by the model's client");
    expect(moduleIdsLine(says, [undefined, grid([])], 0)).toBe("Module IDs: 0 found; no grid lists a module");
  });
});

describe("The mappings of a model's imports from a file", () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
  const IMPORTS_TAB = "IMPORTS × IMPORT PROPERTIES";
  const DEFINITIONS = "IMPORTS × IMPORT DEFINITIONS";
  /** The golden model's import from a file with its mapping, as the export reads it out of the import's definition. */
  const PRICES_MAPPING = { id: "112000000002", name: "Prices from prices.csv", importType: "MODULE_DATA", targets: [
    { target: "Products", source: "column", column: 1, text: "Product" }, { target: "Time", source: "column", column: 2, text: "Month" },
    { target: "Line Items", source: "column", column: 3, text: "Line item" }, { target: "Value", source: "column", column: 5, text: "Price" }] };

  it("are read from the imports' definitions as Anaplan's import dialog reads them, one view and nothing else sent, for the imports from a file alone", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const posted: any[] = [];
    const result = await exportGoldenModel(GOLDEN_GRIDS, [], undefined, { posted });
    // The one import from a file has its mapping; the import from another model has none. Products is named as General
    // Lists names it.
    expect(result.importMappings).toEqual([PRICES_MAPPING]);
    // The definitions are a view of every import against the import properties, IMPORT_ALL against IMPORT_PROPERTY, read
    // after the Imports tab as any other grid is: its first page, which holds every row of a grid this small.
    const views = posted.map(request => `${request.params.viewDefinition.type} ${request.params.viewDefinition.rowAxis} × ${request.params.viewDefinition.columnAxis}`);
    expect(views.filter(view => view.includes("IMPORTS"))).toEqual(["MODEL_DEFINITION IMPORTS × IMPORT PROPERTIES", "MODEL_DEFINITION IMPORTS × IMPORT DEFINITIONS"]);
    // Every request the page's client was given to send is a read of a view: no submission, so no cell of a definition is
    // saved, and no system action, so not the one that asks for a file's columns.
    expect(posted.every(request => request.requestType === "VIEW_REQUEST_SET" && request.submissions.length === 0 && request.systemActions.length === 0)).toBe(true);
    expect(JSON.stringify(posted).includes("GET_IMPORT_SOURCE_FIELDS")).toBe(false);
    // The Imports table is as it is without them, and so is every other table: the mappings are carried beside the tables.
    const { [DEFINITIONS]: _definitions, ...without } = GOLDEN_GRIDS;
    const before = await exportGoldenModel(without);
    expect(result.tables).toEqual(before.tables);
  });

  it("send nothing if the page's client ever made anything but a read of the definitions, and say on each import that its mapping was not read", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const posted: any[] = [];
    const said: string[] = [];
    // A generator that would save a definition, or ask for a file's columns, where it is asked for the view of the definitions.
    const request = (params: { viewDefinition: { columnAxis: string } }) => (params.viewDefinition.columnAxis === "IMPORT DEFINITIONS"
      ? { requestType: "VIEW_REQUEST_SET", submissions: [{ entityLongIds: [4000001300, 112000000002], value: "{}" }], systemActions: [{ type: "GET_IMPORT_SOURCE_FIELDS" }], params } : undefined);
    const result = await exportGoldenModel(GOLDEN_GRIDS, [], said, { posted, request });
    expect(posted.filter(sent => sent.params.viewDefinition.columnAxis === "IMPORT DEFINITIONS")).toEqual([]);
    expect(result.importMappings).toEqual([{ id: "112000000002", name: "Prices from prices.csv", importType: "", targets: [], note: MAPPING_NOTES.notRead }]);
    expect(said.map(line => line.slice(9)).filter(line => line.includes("Import mapping"))).toEqual(["Import mappings: 2 imports; Source Types: SAVED VIEW ×1, FILE ×1; 1 mapping to read", "Reading Import mappings…",
      "Import mappings: Refusing to send anything but a read.", "Import mappings: 0 of 1 read; the model gave no grid of definitions"]);
    // The export goes on: every table is there, the Imports table as ever.
    expect(result.tables.map(table => table.file)).toEqual((await exportGoldenModel()).tables.map(table => table.file));
  });

  it("are not read for a model without an import from a file, and the result then has none, which the log says by the tab's Source Types", async () => {
    const [reads, said]: string[][] = [[], []];
    const tab = GOLDEN_GRIDS[IMPORTS_TAB];
    const noFile = { ...tab, rows: tab.rows.map(row => ({ ...row, cells: row.cells.map(cell => (cell === "FILE" ? "MODULE" : cell)) })) };
    const result = await exportGoldenModel({ ...GOLDEN_GRIDS, [IMPORTS_TAB]: noFile }, reads, said);
    // An empty list, not none: a result without mappings is one an earlier version made.
    expect([result.importMappings, reads.filter(read => read.startsWith("IMPORTS"))]).toEqual([[], ["IMPORTS 0+1333"]]);
    expect(said.map(line => line.slice(9)).filter(line => line.includes("Import mapping"))).toEqual(["Import mappings: 2 imports; Source Types: SAVED VIEW ×1, MODULE ×1; 0 mappings to read"]);
    // A Source Type that is no word is written as a question mark, and a word in other letters as it is; a tab without
    // the column says so.
    const odd = { ...tab, rows: tab.rows.map(row => ({ ...row, cells: row.cells.map(cell => (cell === "FILE" ? " file " : cell === "SAVED VIEW" ? "A <b>" : cell)) })) };
    const oddSaid: string[] = [];
    await exportGoldenModel({ ...GOLDEN_GRIDS, [IMPORTS_TAB]: odd }, [], oddSaid);
    expect(oddSaid.find(line => line.includes("Import mappings: 2 imports"))?.slice(9)).toBe("Import mappings: 2 imports; Source Types: ? ×1, file ×1; 1 mapping to read");
    const columnless = { columns: tab.columns.filter(column => column !== "Source Type"), rows: tab.rows.map(row => ({ ...row, cells: row.cells.filter((_, index) => tab.columns[index] !== "Source Type") })) };
    const columnlessSaid: string[] = [];
    expect((await exportGoldenModel({ ...GOLDEN_GRIDS, [IMPORTS_TAB]: columnless }, [], columnlessSaid)).importMappings).toEqual([]);
    expect(columnlessSaid.filter(line => line.includes("Import mapping")).map(line => line.slice(9))).toEqual(["Import mappings: 2 imports; the Imports tab has no Source Type column"]);
    // None where the Imports tab could not be read: its imports are not known.
    const { [IMPORTS_TAB]: _tab, ...withoutTab } = GOLDEN_GRIDS;
    expect((await exportGoldenModel(withoutTab)).importMappings).toBeUndefined();
  });

  it("are each said not to have been read where the model rejects the read, and the export goes on, the Imports table as ever", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.UTC(2026, 8, 28, 12, 30, 10)));
    const { [DEFINITIONS]: _definitions, ...without } = GOLDEN_GRIDS;
    const [reads, said]: string[][] = [[], []];
    const result = await exportGoldenModel(without, reads, said);
    expect(result.importMappings).toEqual([{ id: "112000000002", name: "Prices from prices.csv", importType: "", targets: [], note: MAPPING_NOTES.notRead }]);
    // The read was sent, once, and the next grid read after it: the reason is in the log, and no table says it.
    expect(reads.slice(reads.indexOf("IMPORTS 0+1333") + 1, reads.indexOf("IMPORTS 0+1333") + 3)).toEqual(["IMPORTS 0+1333", "DATA SOURCES 0+1333"]);
    expect(said.filter(line => line.includes("Import mapping"))).toEqual(["12:30:10 Import mappings: 2 imports; Source Types: SAVED VIEW ×1, FILE ×1; 1 mapping to read", "12:30:10 Reading Import mappings…",
      "12:30:10 Import mappings: The model rejected the read.", "12:30:10 Import mappings: 0 of 1 read; the model gave no grid of definitions"]);
    expect([result.summary.filter(line => /mapping/i.test(line)), result.tables[0].rows.filter(row => row[0] === "Notes")]).toEqual([[], []]);
    expect(result.tables.find(table => table.file === "Imports.csv")).toEqual((await exportGoldenModel()).tables.find(table => table.file === "Imports.csv"));
  });

  it("come through the trip to the results page as plain data, and a result an earlier version kept has none", async () => {
    const result = await exportGoldenModel();
    const received = plainResult(JSON.parse(JSON.stringify(result)));
    expect(received?.importMappings).toEqual([PRICES_MAPPING]);
    const { importMappings: _mappings, ...earlier } = result;
    expect(plainResult(JSON.parse(JSON.stringify(earlier)))?.importMappings).toBeUndefined();
  });
});
