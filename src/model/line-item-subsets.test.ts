import { afterEach, describe, expect, it, vi } from "vitest";
import { exportModel } from "./export.js";
import type { Grid } from "./grid.js";
import { MEMBERSHIP_NOT_READ, readLineItemSubsets, subsetLineItems, subsetModules } from "./line-item-subsets.js";
import type { Native } from "./native.js";

const definitions: Grid = {
  columns: [{ ids: [4000001600], labels: ["Modules"] }, { ids: [4000000017], labels: ["Notes"] }],
  rows: [{ ids: [114000000001], labels: ["Planning measures"], cells: ["Demand", "For planning"] },
    { ids: [114000000002], labels: ["Review measures"], cells: ["Demand", "For review"] }],
};
const membership: Grid = {
  columns: [{ ids: [114000000002], labels: ["Review measures"] }, { ids: [114000000001], labels: ["Planning measures"] }],
  rows: [{ ids: [102000000001], labels: ["Demand"], cells: ["true", "true"] },
    { ids: [1901000000001, 102000000001], labels: ["Units", "Demand"], cells: ["false", "true"] },
    { ids: [1901000000002, 102000000001], labels: ["Rate, net", "Demand"], cells: ["true", "false"] }],
};

/** An invented client, using the real request generator boundary, label handling and row paging. */
function client(grids: Record<string, Grid> = { properties: definitions, subsets: membership }, engine = "HYPERBLOCK") {
  const requests: any[] = [];
  const native: Native = {
    workspaceId: "a".repeat(32), modelId: "b".repeat(32), ids: {}, axisHelper: {},
    cache: { getWorkspaceInfo: () => ({ name: "Invented workspace", dataEngineType: engine }), getModelName: () => "Invented plan" },
    constants: { SYSTEM_AXIS_IDENTIFIER_LINE_ITEM_SUBSET_IDENTIFIER: "subsets", SYSTEM_AXIS_IDENTIFIER_LINE_ITEM_SUBSET_PROPERTY_IDENTIFIER: "properties",
      SYSTEM_AXIS_IDENTIFIER_MODULE_WITH_LINE_ITEM_IDENTIFIER: "items" },
    helper: { getAxesForViewDefinition: (rows: string[], columns: string[]) => ({ rowAxis: rows[0], columnAxis: columns[0] }) },
    RequestGenerator: class { getRequest(params: unknown) { return { requestType: "VIEW_REQUEST_SET", submissions: [], systemActions: [], params }; } },
    DataPage: class {
      page: { startRow: number; rows: string[][] };
      constructor({ page }: any) { this.page = page; }
      contains(row: number, column: number) { return this.page.rows[row - this.page.startRow]?.[column] !== undefined; }
      getIndex(row: number, column: number) { return (row - this.page.startRow) * this.page.rows[0].length + column; }
      getOriginalText(index: number) { return this.page.rows.flat()[index]; }
      getCellText(index: number) { return this.getOriginalText(index); }
    },
    aggregator: { post(request: any, _flag: boolean, ok: (response: unknown) => void) {
      requests.push(request);
      const { viewDefinition, pageRequests: [{ startRow, rowCount }] } = request.params;
      const grid = grids[viewDefinition.columnAxis];
      if (!grid) { ok({ error: "not available" }); return; }
      const rows = grid.rows.slice(startRow, startRow + rowCount);
      const dimensions = Math.max(1, ...rows.map(row => row.ids.length));
      ok({ result: { viewRequestResults: [{ rowCount: grid.rows.length, columnCount: grid.columns.length,
        rowLabelPages: [{ count: rows.length, entityLongIds: Array.from({ length: dimensions }, (_, d) => rows.map(row => row.ids[d] ?? -1)),
          labels: Array.from({ length: dimensions }, (_, d) => rows.map(row => row.labels[d] ?? "")) }],
        columnLabelPages: [{ count: grid.columns.length, entityLongIds: [grid.columns.map(column => column.ids[0])], labels: [grid.columns.map(column => column.labels[0])] }],
        dataPages: [{ startRow, rows: rows.map(row => row.cells) }] }] } });
    } },
  };
  return { native, requests };
}

afterEach(() => vi.unstubAllGlobals());

describe("Line Item Subsets through Model Building", () => {
  it.each(["HYPERBLOCK", "CALCULATION_ENGINE"])("reads settings and membership for %s through the same guarded transport", async engine => {
    const { native, requests } = client(undefined, engine);
    vi.stubGlobal("window", { workspaceId: native.workspaceId, modelId: native.modelId, require: (_names: string[], loaded: (...args: unknown[]) => void) =>
      loaded(native.cache, native.aggregator, native.helper, native.ids, native.constants, native.RequestGenerator, native.DataPage, native.axisHelper) });
    vi.stubGlobal("location", { host: "us1a.app.anaplan.com", pathname: "/core-webapp/anaplan/framework.jsp" });
    const log: string[] = [];
    const result = await exportModel({ status: line => log.push(line), log: line => log.push(line) }, () => log.join("\n"));
    expect(result.tables.find(table => table.file === "Line Item Subsets.csv")).toMatchObject({
      headers: ["", "Modules", "Notes", "Line Items"], rows: [
        ["Planning measures", "Demand", "For planning", "'Demand'.'Units'"], ["Review measures", "Demand", "For review", "'Demand'.'Rate, net'"]],
    });
    expect(requests.map(request => request.params.viewDefinition)).toEqual([
      { type: "MODEL_DEFINITION", staticContextIdentifiers: [], rowAxis: "subsets", columnAxis: "properties" },
      { type: "MODEL_DEFINITION", staticContextIdentifiers: [], rowAxis: "items", columnAxis: "subsets" },
    ]);
    expect(requests.every(request => !request.submissions.length && !request.systemActions.length)).toBe(true);
    expect(log).toEqual(expect.arrayContaining([
      "Reading Line Item Subsets…", "Line Item Subsets: 2 rows × 2 columns; columns: Modules | Notes",
      "Line Item Subsets membership: 3 rows × 2 columns; columns: Review measures | Planning measures", "Line Item Subsets membership: 2 subsets read",
    ]));
    expect(log.some(line => /^Line Item Subsets: rows 0–1 in /.test(line))).toBe(true);
  });

  it("keeps all returned columns and pages through the definition grid", async () => {
    const properties = { columns: [...definitions.columns, { ids: [4000000099], labels: ["Line Items"] }],
      rows: Array.from({ length: 1340 }, (_, index) => ({ ids: [114000000001 + index], labels: [`Subset ${index}`], cells: ["Demand", "A note", "'Demand'.'Units'"] })) };
    const { native, requests } = client({ properties });
    const result = await readLineItemSubsets(native, () => undefined);
    expect(result.table.headers).toEqual(["", "Modules", "Notes", "Line Items"]);
    expect(result.table.rows).toHaveLength(1340);
    expect(result.table.rows.at(-1)?.[0]).toBe("Subset 1339");
    expect(requests.map(request => request.params.pageRequests[0].startRow)).toEqual([0, 1333]);
  });

  it("keeps an empty grid without a membership request", async () => {
    const { native, requests } = client({ properties: { ...definitions, rows: [] } });
    expect(await readLineItemSubsets(native, () => undefined)).toEqual({ table: { headers: ["", "Modules", "Notes"], rows: [] } });
    expect(requests).toHaveLength(1);
  });

  it("keeps definitions and explains unavailable membership without an invented empty column", async () => {
    const { native } = client({ properties: definitions });
    const log: string[] = [];
    const result = await readLineItemSubsets(native, line => log.push(line));
    expect(result.note).toBe(MEMBERSHIP_NOT_READ);
    expect(result.table.headers).not.toContain("Line Items");
    expect(log.at(-1)).toBe("Line Item Subsets membership: not read (The model rejected the read.)");
  });

  it("refuses a generated write before posting it", async () => {
    const { native, requests } = client();
    native.RequestGenerator = class { getRequest() { return { submissions: [{}] }; } };
    await expect(readLineItemSubsets(native, () => undefined)).rejects.toThrow("Refusing to send anything but a read.");
    expect(requests).toEqual([]);
  });

  it("matches reordered subset IDs, skips module headings and preserves punctuation", () => {
    expect(subsetLineItems(definitions, membership)).toEqual(["'Demand'.'Units'", "'Demand'.'Rate, net'"]);
    const changed = structuredClone(membership);
    changed.rows[1].labels = ["Owner's share", "Plan.v2"];
    expect(subsetLineItems(definitions, changed)[0]).toBe("'Plan.v2'.'Owner''s share'");
    expect(subsetLineItems(definitions, { ...membership, columns: [] })).toEqual([undefined, undefined]);
    changed.rows[1].cells[1] = "unknown";
    expect(subsetLineItems(definitions, changed)[0]).toBe("");
    changed.rows[1].ids = [1901000000001];
    changed.rows[1].cells[1] = "true";
    changed.rows[1].labels = ["Units"];
    expect(subsetLineItems(definitions, changed)[0]).toBe("'Demand'.'Units'");
  });

  it("resolves IDs in model order, preserving raw IDs and logging unknown ones", async () => {
    const pairs: [string, string][] = [["Demand", "102000000001"], ["Plan, next", "102000000002"]];
    expect(subsetModules("102000000001", pairs)).toEqual({ names: ["Demand"], ids: "102000000001", unknown: [] });
    const properties = structuredClone(definitions);
    properties.rows[0].cells[0] = "102000000002,102000000001";
    properties.rows[1].cells[0] = "102000000099";
    const { native } = client({ properties, subsets: membership });
    const log: string[] = [];
    const { table } = await readLineItemSubsets(native, line => log.push(line), undefined, pairs);
    expect(table.headers).toEqual(["", "Modules", "Notes", "Module IDs", "Line Items"]);
    expect(table.rows[0]).toEqual(["Planning measures", "Demand, Plan, next", "For planning", "102000000002,102000000001", "'Demand'.'Units'"]);
    expect(table.rows[1][1]).toBe("102000000099");
    expect(log).toContain("Line Item Subsets: module ID 102000000099 has no name; kept as ID");
  });

  it("selects true values whatever their case or spaces, takes empty cells as not selected, and logs the first three distinct unexpected values with their counts", () => {
    const values = ["true", "false", "n/a", "", undefined, "n/a", null, "greyed", "disabled", "TRUE", " true ", 1, true, false];
    const grid = { columns: [membership.columns[1]], rows: values.map((value, index) => ({
      ids: [1901000000001 + index, 102000000001], labels: [`Measure ${index}`, "Demand"], cells: [value],
    })) } as Grid;
    const log: string[] = [];
    expect(subsetLineItems({ ...definitions, rows: [definitions.rows[0]] }, grid, line => log.push(line)))
      .toEqual(["'Demand'.'Measure 0', 'Demand'.'Measure 9', 'Demand'.'Measure 10', 'Demand'.'Measure 12'"]);
    expect(log).toEqual(['Line Item Subsets membership: 5 cells with an unrecognised value ("n/a" ×2, "greyed" ×1, "disabled" ×1), taken as not in the subset']);
  });

  it("uses module headings with or without IDs and skips odd rows without losing later members", () => {
    const grid: Grid = { columns: [membership.columns[1]], rows: [
      { ids: [1901000000009], labels: ["No module"], cells: ["true"] },
      { ids: [102000000001, -1], labels: ["Demand", ""], cells: ["true"] },
      { ids: [1901000000001], labels: ["Units"], cells: ["true"] },
      { ids: [], labels: ["Plan, next"], cells: ["true"] },
      { ids: [1901000000002], labels: ["Margin"], cells: ["true"] },
      { ids: [1901000000003], labels: [], cells: ["true"] },
      { ids: [1901000000004, 102000000001], labels: ["Cost", "Demand"], cells: ["true"] },
    ] };
    const log: string[] = [];
    expect(subsetLineItems({ ...definitions, rows: [definitions.rows[0]] }, grid, line => log.push(line)))
      .toEqual(["'Demand'.'Units', 'Plan, next'.'Margin', 'Demand'.'Cost'"]);
    expect(log).toEqual(["Line Item Subsets membership: 2 rows without a line item name or module skipped"]);
  });

  it("marks only a subset whose column is missing and keeps the successful read", async () => {
    const grid: Grid = { columns: [membership.columns[1]], rows: membership.rows.map(row => ({ ...row, cells: [row.cells[1]] })) };
    const { native } = client({ properties: definitions, subsets: grid });
    const log: string[] = [];
    const read = await readLineItemSubsets(native, line => log.push(line));
    expect(read.note).toBeUndefined();
    expect(read.table.headers).toEqual(["", "Modules", "Notes", "Line Items", "Membership read"]);
    expect(read.table.rows.map(row => row.slice(-2))).toEqual([["'Demand'.'Units'", "true"], ["", "false"]]);
    expect(log).toContain("Line Item Subsets membership: subset 114000000002 not read (column missing)");
    expect(log.at(-1)).toBe("Line Item Subsets membership: 1 subset read; 1 subset not read");
  });
});
