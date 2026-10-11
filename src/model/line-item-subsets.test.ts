import { afterEach, describe, expect, it, vi } from "vitest";
import { exportModel } from "./export.js";
import type { Grid } from "./grid.js";
import { MEMBERSHIP_NOT_READ, readLineItemSubsets, subsetLineItems } from "./line-item-subsets.js";
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
    expect(() => subsetLineItems(definitions, { ...membership, columns: [] })).toThrow("identify every subset");
    changed.rows[1].cells[1] = "unknown";
    expect(() => subsetLineItems(definitions, changed)).toThrow("unrecognised");
    changed.rows[1].ids = [1901000000001];
    expect(() => subsetLineItems(definitions, changed)).toThrow("identify a line item's module");
  });
});
