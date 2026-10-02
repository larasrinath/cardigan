import { afterEach, describe, expect, it, vi } from "vitest";
import { toCsv } from "../zip.js";
import { actionKind, mergeImports, missingActionColumns } from "./actions.js";
import { CALENDAR_HEADERS, CALENDAR_PROPERTIES, calendarKind, calendarRows } from "./calendar.js";
import { exportModel } from "./export.js";
import { cellText, gridTable, labelEntries, plainText, windowRows, type CellSource, type Grid } from "./grid.js";
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
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

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

  it("finds the open model only on a page with the classic client's loader and 32-character model and workspace IDs", () => {
    const [WS, MODEL] = ["0123456789abcdef0123456789abcdef", "FEDCBA9876543210FEDCBA9876543210"];
    const on = (page: Record<string, unknown>) => { vi.stubGlobal("window", page); return modelOnPage(); };
    expect(on({ require: () => undefined, modelId: MODEL, workspaceId: WS })).toBe(MODEL);
    for (const page of [{ modelId: MODEL, workspaceId: WS }, { require: () => undefined, modelId: MODEL }, { require: () => undefined, workspaceId: WS },
      { require: () => undefined, modelId: MODEL.slice(1), workspaceId: WS }, { require: () => undefined, modelId: MODEL, workspaceId: `${WS}0` },
      { require: () => undefined, modelId: MODEL.replace("F", "-"), workspaceId: WS }, { require: () => undefined, modelId: MODEL, workspaceId: WS.replace("0", "_") }]) {
      expect(on(page)).toBeUndefined();
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
    expect(result.fileName).toBe("Demand Plan 2026 - Model Export - 2026-09-28.zip");
    expect(result.summary[0]).toBe("Versions: 1 rows");
    expect(result.summary).toContain("Line Items: not exported (This model page has no MODULE_WITH_LINE_ITEM axis.).");
    expect(Array.from(result.zip.slice(0, 2))).toEqual([0x50, 0x4b]);
    expect((await run("???")).fileName).toBe("model - Model Export - 2026-09-28.zip");
    expect((await run(undefined)).fileName).toBe(`${MODEL} - Model Export - 2026-09-28.zip`);
    expect((await run("m".repeat(100))).fileName).toBe(`${"m".repeat(80)} - Model Export - 2026-09-28.zip`);
  });
});
