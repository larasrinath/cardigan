import { afterEach, describe, expect, it, vi } from "vitest";
import { MODEL_ZIP_0_6_1, ZIPPED_AT } from "../golden-0.6.1.test-support.js";
import { NOT_SCOPE_IDS, SCOPE_IDS } from "../guards.test-support.js";
import { Failure } from "../progress.js";
import { resultZip } from "../result-zip.js";
import { toCsv } from "../zip.js";
import { parseCsv, sameBytes, unzipText } from "../zip.test-support.js";
import { actionKind, mergeImports, missingActionColumns } from "./actions.js";
import { CALENDAR_HEADERS, CALENDAR_PROPERTIES, calendarKind, calendarRows } from "./calendar.js";
import { exportModel } from "./export.js";
import * as grids from "./grid.js";
import { cellText, gridTable, labelEntries, plainText, windowRows, type CellSource, type Grid } from "./grid.js";
import * as lineItems from "./lineitems.js";
import { lineItemsTable } from "./lineitems.js";
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
    expect(table.headers).toEqual(["", "Summary", "Module Name", "Ratio Numerator", "Ratio Denominator"]);
    expect(table.rows.map(row => row.slice(-2))).toEqual([["", ""], ["Profit", "Revenue"], ["", ""], ["", ""]]);
    // Anaplan's own columns are untouched; an ID the grid does not hold stays blank rather than guessed.
    expect(table.rows[1].slice(0, 3)).toEqual(["Margin %", ratio, "Margin"]);
    expect(lineItemsTable({ ...grid, rows: grid.rows.slice(1, 2) }).rows[0].slice(-2)).toEqual(["", ""]);
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
    expect(requests).toEqual([{ startRow: 0, rowCount: 1 }, { startRow: 0, rowCount: 3 }, { startRow: 3, rowCount: 3 }, { startRow: 6, rowCount: 1 }]);
    expect(grid.columns.map(column => column.labels[0])).toEqual(columns);
    expect(grid.rows.map(row => [row.labels[0], ...row.cells])).toEqual(Array.from({ length: total }, (_, i) => [`Item ${i}`, `f${i}`, "NUMBER"]));
    expect(log[0]).toBe("Line Items: 7 rows × 2 columns; columns: Formula | Format");

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

    // One grid, read six cells at a time: 60 rows of 3 columns are thirty windows of two rows after the first read.
    const stopping = new AbortController();
    stop = () => stopping.abort(stopped);
    stopDuring = "ROWS 2+2";
    await expect(readGrid(client({ ROWS: 60 }), "ROWS", "COLS", "Line Items", () => undefined, 6, false, stopping.signal)).rejects.toBe(stopped);
    // The stop came while the second window was read: that read is let finish, and it is the last.
    expect(reads).toEqual(["ROWS 0+1", "ROWS 0+2", "ROWS 2+2"]);
    // Not stopped, the same grid is read to its end.
    reads.length = 0;
    expect((await readGrid(client({ ROWS: 60 }), "ROWS", "COLS", "Line Items", () => undefined, 6, false, new AbortController().signal)).rows).toHaveLength(60);
    expect(reads).toHaveLength(31);

    // The whole export, as the model's frame runs it (bridge.ts `serveCore`): once it was asked to stop, the check it is given
    // refuses, and so does every step. 30,000 line items of 3 columns are three windows of the 40,000 cells one read asks for.
    reads.length = 0;
    let asked = false;
    stop = () => { asked = true; };
    stopDuring = "LINE ITEMS 13333+13333";
    const check = { throwIfAborted: () => { if (asked) throw stopped; } };
    const page = client({ "LINE ITEMS": 30_000, MODULES: 2 });
    vi.stubGlobal("window", { workspaceId: page.workspaceId, modelId: page.modelId, require: (_modules: string[], loaded: (...modules: unknown[]) => void) =>
      loaded(page.cache, page.aggregator, page.helper, page.ids, page.constants, page.RequestGenerator, page.DataPage, page.axisHelper) });
    vi.stubGlobal("location", { host: "eu2a.app.anaplan.com", pathname: "/core-webapp/anaplan/framework.jsp" });
    await expect(exportModel({ status: check.throwIfAborted, log: check.throwIfAborted }, () => "", check)).rejects.toBe(stopped);
    expect(reads).toEqual(["LINE ITEMS 0+1", "LINE ITEMS 0+13333", "LINE ITEMS 13333+13333"]);
    // Not stopped, it reads the third window and goes on to the next grid.
    reads.length = 0;
    stopDuring = "";
    asked = false;
    expect((await exportModel({ status: check.throwIfAborted, log: check.throwIfAborted }, () => "", check)).summary.slice(0, 2)).toEqual(["Line Items: 30000 rows", "Modules: 2 rows"]);
    expect(reads).toEqual(["LINE ITEMS 0+1", "LINE ITEMS 0+13333", "LINE ITEMS 13333+13333", "LINE ITEMS 26666+3334", "MODULES 0+1", "MODULES 0+2"]);
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
    expect(headers).toEqual(["", "Formula", "Summary", "Ratio Numerator", "Ratio Denominator"]);
    expect(table).toEqual([["Profitability", "", "", "", ""], ["Profit", "", '{"summaryMethod":"SUM"}', "", ""],
      ["Revenue", "", '{"summaryMethod":"SUM"}', "", ""], ["Margin %", "Profit / Revenue", ratio, "Profit", "Revenue"]]);
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

  it("writes the zip 0.6.1 wrote for the same model, byte for byte, and returns each file as a table", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.UTC(2026, 8, 28, 12, 30, 10)));
    const result = await exportGoldenModel();
    const zip = resultZip(result, ZIPPED_AT);
    // File by file first, so a difference shows as text; then every byte of the zip.
    expect(unzipText(zip)).toEqual(unzipText(MODEL_ZIP_0_6_1));
    expect(sameBytes(zip, MODEL_ZIP_0_6_1)).toBe(true);

    expect([result.kind, result.name, result.id, result.zipName])
      .toEqual(["model", "Demand: plan", "FEDCBA9876543210FEDCBA9876543210", "Demand plan - Model Export - 2026-09-28.zip"]);
    expect(result.summary).toEqual(["Line Items: 4 rows", "Modules: 2 rows", "General Lists: 2 rows", "Processes: 1 rows",
      "Imports: 3 rows (2 matched in the Actions list)", "Import Data Sources: 1 rows", "Exports: 1 rows", "Other Actions: 1 rows", "Time Ranges: 1 rows",
      "Versions: 2 rows", "Model Calendar: 31 rows", "Source Models: not exported (This model page has no REMOTE_MODEL axis.)."]);
    // Only Model Details.csv guards formula-like cells: a grid is written exactly as Anaplan's own export writes it.
    expect(result.tables.map(table => [table.file, table.label, table.guard, table.details, table.rows.length])).toEqual([
      ["Model Details.csv", "Model Details", true, true, 27], ["Line Items.csv", "Line Items", false, undefined, 4], ["Modules.csv", "Modules", false, undefined, 2],
      ["General Lists.csv", "General Lists", false, undefined, 2], ["Processes.csv", "Processes", false, undefined, 1], ["Imports.csv", "Imports", false, undefined, 3],
      ["Import Data Sources.csv", "Import Data Sources", false, undefined, 1], ["Exports.csv", "Exports", false, undefined, 1],
      ["Other Actions.csv", "Other Actions", false, undefined, 1], ["Time Ranges.csv", "Time Ranges", false, undefined, 1], ["Versions.csv", "Versions", false, undefined, 2],
      ["Model Calendar.csv", "Model Calendar", false, undefined, 31]]);
    expect(result.tables[1].headers).toEqual(["", "Formula", "Summary", "Notes", "Ratio Numerator", "Ratio Denominator"]);
    expect(result.tables[1].rows[1]).toEqual(["Profit", "=Revenue - Cost", '{"summaryMethod":"SUM"}', "First line\nSecond line", "", ""]);
    // Plain data: the tables are the same after the trip to the results page as JSON, and so is the zip.
    const received = JSON.parse(JSON.stringify(result)) as typeof result;
    expect(received).toEqual(result);
    expect(sameBytes(resultZip(received, ZIPPED_AT), MODEL_ZIP_0_6_1)).toBe(true);
  });

  it("reads Line Items, Modules and General Lists in that order, and keeps each file's place whichever of them cannot be read", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.UTC(2026, 8, 28, 12, 30, 10)));
    const [LINE_ITEMS, MODULES, LISTS] = ["LINE ITEMS × LINE ITEM PROPERTIES", "MODULES × MODULE PROPERTIES", "LISTS × LIST PROPERTIES"];
    const REJECTED = "The model rejected the read.";
    const NO_SOURCE_MODELS = "Source Models: not exported (This model page has no REMOTE_MODEL axis.).";
    /** The golden model exported while the model rejects the reads of these grids: the reads of the three grids, the first
     * files of the zip, what the Details file's first three Files rows and the summary's first two lines say, and the notes. */
    const exported = async (...rejected: string[]) => {
      const reads: string[] = [];
      const result = await exportGoldenModel(Object.fromEntries(Object.entries(GOLDEN_GRIDS).filter(([grid]) => !rejected.includes(grid))), reads);
      return {
        reads: reads.filter(read => /^(LINE ITEMS|MODULES|LISTS) /.test(read)),
        zip: [...unzipText(resultZip(result)).keys()].slice(0, 4),
        files: result.tables[0].rows.filter(row => row[0] === "Files").slice(0, 3).map(row => `${row[1]}: ${row[2]}`),
        summary: result.summary.slice(0, 2),
        notes: result.summary.filter(line => line.includes("not exported")),
      };
    };
    // Every grid read: the three are read one after the other, a first row and then the rest, and their files come first.
    expect(await exported()).toEqual({
      reads: ["LINE ITEMS 0+1", "LINE ITEMS 0+4", "MODULES 0+1", "MODULES 0+2", "LISTS 0+1", "LISTS 0+2"],
      zip: ["Model Details.csv", "Line Items.csv", "Modules.csv", "General Lists.csv"],
      files: ["Line Items.csv: 4 rows", "Modules.csv: 2 rows", "General Lists.csv: 2 rows"],
      summary: ["Line Items: 4 rows", "Modules: 2 rows"], notes: [NO_SOURCE_MODELS] });
    // A grid that cannot be read is tried in its turn, its row of the Details file stands where its file would, and the
    // other two files are exported, Line Items first whenever it was read.
    expect(await exported(LISTS)).toEqual({
      reads: ["LINE ITEMS 0+1", "LINE ITEMS 0+4", "MODULES 0+1", "MODULES 0+2", "LISTS 0+1"],
      zip: ["Model Details.csv", "Line Items.csv", "Modules.csv", "Processes.csv"],
      files: ["Line Items.csv: 4 rows", "Modules.csv: 2 rows", `General Lists.csv: Not exported: ${REJECTED}`],
      summary: ["Line Items: 4 rows", "Modules: 2 rows"], notes: [`General Lists: not exported (${REJECTED}).`, NO_SOURCE_MODELS] });
    expect(await exported(MODULES)).toEqual({
      reads: ["LINE ITEMS 0+1", "LINE ITEMS 0+4", "MODULES 0+1", "LISTS 0+1", "LISTS 0+2"],
      zip: ["Model Details.csv", "Line Items.csv", "General Lists.csv", "Processes.csv"],
      files: ["Line Items.csv: 4 rows", `Modules.csv: Not exported: ${REJECTED}`, "General Lists.csv: 2 rows"],
      summary: ["Line Items: 4 rows", "General Lists: 2 rows"], notes: [`Modules: not exported (${REJECTED}).`, NO_SOURCE_MODELS] });
    expect(await exported(MODULES, LISTS)).toEqual({
      reads: ["LINE ITEMS 0+1", "LINE ITEMS 0+4", "MODULES 0+1", "LISTS 0+1"],
      zip: ["Model Details.csv", "Line Items.csv", "Processes.csv", "Imports.csv"],
      files: ["Line Items.csv: 4 rows", `Modules.csv: Not exported: ${REJECTED}`, `General Lists.csv: Not exported: ${REJECTED}`],
      summary: ["Line Items: 4 rows", "Processes: 1 rows"],
      notes: [`Modules: not exported (${REJECTED}).`, `General Lists: not exported (${REJECTED}).`, NO_SOURCE_MODELS] });
    expect(await exported(LINE_ITEMS)).toEqual({
      reads: ["LINE ITEMS 0+1", "MODULES 0+1", "MODULES 0+2", "LISTS 0+1", "LISTS 0+2"],
      zip: ["Model Details.csv", "Modules.csv", "General Lists.csv", "Processes.csv"],
      files: [`Line Items.csv: Not exported: ${REJECTED}`, "Modules.csv: 2 rows", "General Lists.csv: 2 rows"],
      summary: ["Modules: 2 rows", "General Lists: 2 rows"], notes: [`Line Items: not exported (${REJECTED}).`, NO_SOURCE_MODELS] });
    expect(await exported(LINE_ITEMS, MODULES, LISTS)).toEqual({
      reads: ["LINE ITEMS 0+1", "MODULES 0+1", "LISTS 0+1"],
      zip: ["Model Details.csv", "Processes.csv", "Imports.csv", "Import Data Sources.csv"],
      files: [`Line Items.csv: Not exported: ${REJECTED}`, `Modules.csv: Not exported: ${REJECTED}`, `General Lists.csv: Not exported: ${REJECTED}`],
      summary: ["Processes: 1 rows", "Imports: 3 rows (2 matched in the Actions list)"],
      notes: [`Line Items: not exported (${REJECTED}).`, `Modules: not exported (${REJECTED}).`, `General Lists: not exported (${REJECTED}).`, NO_SOURCE_MODELS] });
  });

  it("takes a Line Items table that cannot be made for that file's failure, in the file's own place, and exports the other files", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.UTC(2026, 8, 28, 12, 30, 10)));
    vi.spyOn(lineItems, "lineItemsTable").mockImplementation(() => { throw new Error("no table"); });
    const result = await exportGoldenModel();
    expect(result.tables.map(table => table.file).slice(0, 4)).toEqual(["Model Details.csv", "Modules.csv", "General Lists.csv", "Processes.csv"]);
    expect(result.tables[0].rows.filter(row => row[0] === "Files").slice(0, 3).map(row => `${row[1]}: ${row[2]}`))
      .toEqual(["Line Items.csv: Not exported: no table", "Modules.csv: 2 rows", "General Lists.csv: 2 rows"]);
    expect([result.summary.slice(0, 2), result.summary.slice(-2)]).toEqual([["Modules: 2 rows", "General Lists: 2 rows"],
      ["Line Items: not exported (no table).", "Source Models: not exported (This model page has no REMOTE_MODEL axis.)."]]);
    // Its note stands first too, before the note of a file that could not be read after it.
    const { "MODULES × MODULE PROPERTIES": _modules, ...withoutModules } = GOLDEN_GRIDS;
    const both = await exportGoldenModel(withoutModules);
    expect(both.tables[0].rows.filter(row => row[0] === "Files").slice(0, 3).map(row => `${row[1]}: ${row[2]}`))
      .toEqual(["Line Items.csv: Not exported: no table", "Modules.csv: Not exported: The model rejected the read.", "General Lists.csv: 2 rows"]);
    expect(both.summary.filter(line => line.includes("not exported"))).toEqual(["Line Items: not exported (no table).", "Modules: not exported (The model rejected the read.).",
      "Source Models: not exported (This model page has no REMOTE_MODEL axis.)."]);
  });
});

// One model exported end to end, as the 0.6.1 zip in golden-0.6.1.test-support.ts was made: every Model settings grid the
// export reads, with the values a CSV has to quote (commas, quotes, line breaks) and text that looks like a formula, an
// import the Imports tab does not list, and one grid the page's client does not have (Source Models).
interface FakeGrid { columns: string[]; rows: { ids: number[]; labels: (string | null)[]; cells: string[] }[] }
const row = (id: number, label: string, ...cells: string[]) => ({ ids: [id], labels: [label], cells });
const ACTION_COLUMNS = ["Action", "Start Date and Time (UTC)", "Most recent duration (ms)", "Notes", "Used in Processes", "Used in Dashboards"];
const GOLDEN_RATIO = JSON.stringify({ summaryMethod: "RATIO", timeSummaryMethod: "RATIO", ratioNumeratorIdentifier: "_1901000000001_", ratioDenominatorIdentifier: "_1901000000002_" });
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
  ACTION_WITH_HEADING: "ACTIONS", IMPORT_ALL: "IMPORTS", IMPORT_DEFINITION_PROPERTY: "IMPORT PROPERTIES", IMPORT_DATA_SOURCE: "DATA SOURCES",
  IMPORT_DATA_SOURCE_DETAILS_PROPERTY: "DATA SOURCE PROPERTIES", TIME_RANGE: "TIME RANGES", TIME_RANGE_PROPERTY: "TIME RANGE PROPERTIES", VERSION_ALL: "VERSIONS",
  VERSION_PROPERTY: "VERSION PROPERTIES", TIMESCALE_PROPERTY: "CALENDAR", EMPTY_1_0: "EMPTY" };

/** Runs the model export against a page whose classic client serves those grids, a few rows at a time. The model rejects
 * the read of a grid that is not among `grids`, and `reads` is given each read in order: its row axis and the rows asked for. */
async function exportGoldenModel(grids: Record<string, FakeGrid> = GOLDEN_GRIDS, reads: string[] = []) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const aggregator = { isDirty: () => false, post: (request: any, _flag: boolean, ok: (response: unknown) => boolean) => {
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
      columnLabelPages: [{ start: 0, count: grid.columns.length, entityLongIds: [grid.columns.map((_, index) => 4000000001 + index)], labels: [grid.columns] }],
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
  class RequestGenerator { getRequest(params: unknown) { return { requestType: "VIEW_REQUEST_SET", submissions: [], systemActions: [], params }; } }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  class DataPage extends FakePage { constructor({ page }: any) { super(page); } }
  vi.stubGlobal("window", { workspaceId: "0123456789abcdef0123456789abcdef", modelId: "FEDCBA9876543210FEDCBA9876543210",
    require: (_modules: string[], loaded: (...modules: unknown[]) => void) =>
      loaded(cache, aggregator, helper, { getEntityTypeIndex: (id: number) => Math.floor(id / 1e9) }, constants, RequestGenerator, DataPage, axisHelper) });
  vi.stubGlobal("location", { host: "eu2a.app.anaplan.com", pathname: "/core-webapp/anaplan/framework.jsp" });
  return exportModel({ status: () => undefined, log: () => undefined },
    () => "12:30:10 Loading the model page's client…\r\n12:30:10 Line Items: 4 rows × 3 columns; columns: Formula | Summary | Notes");
}
