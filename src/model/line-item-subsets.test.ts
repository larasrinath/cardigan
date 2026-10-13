import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
const scopedMembership = Object.fromEntries(membership.columns.map((column, index) => [`_${column.ids[0]}_`, {
  columns: [column], rows: membership.rows.map(row => ({ ...row, cells: [row.cells[index]] })),
}]));
// The 0.31.4 trap: the context-free matrix claims every line item belongs to every subset.
const contextFree: Grid = { ...membership, rows: membership.rows.map(row => ({ ...row, cells: ["true", "true"] })) };

/** An invented client, using the real request generator boundary, label handling and row paging. */
function client(grids: Record<string, Grid> = { properties: definitions, subsets: contextFree, ...scopedMembership }, engine = "HYPERBLOCK") {
  const requests: any[] = [];
  const native: Native = {
    workspaceId: "a".repeat(32), modelId: "b".repeat(32),
    ids: { entityLongIdToEntityLongIdIdentifier: vi.fn((id: number) => `_${id}_`) }, axisHelper: {},
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
    aggregator: { isDirty: vi.fn(() => false), post(request: any, _flag: boolean, ok: (response: unknown) => void) {
      requests.push(request);
      const { viewDefinition, pageRequests: [{ startRow, rowCount }] } = request.params;
      const grid = grids[viewDefinition.staticContextIdentifiers[0] ?? viewDefinition.columnAxis];
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

beforeEach(() => vi.spyOn(Date, "now").mockReturnValue(1000));
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("Line Item Subsets through Model Building", () => {
  it.each(["HYPERBLOCK", "CALCULATION_ENGINE"])("reads each subset for %s through the guarded transport, ignoring the all-true context-free matrix", async engine => {
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
      { type: "MODEL_DEFINITION", staticContextIdentifiers: ["_114000000001_"], rowAxis: "items", columnAxis: "subsets" },
      { type: "MODEL_DEFINITION", staticContextIdentifiers: ["_114000000002_"], rowAxis: "items", columnAxis: "subsets" },
    ]);
    expect(native.ids.entityLongIdToEntityLongIdIdentifier.mock.calls).toEqual([[114000000001], [114000000002]]);
    expect(native.aggregator.isDirty).toHaveBeenCalledTimes(3);
    expect(requests.every(request => !request.submissions.length && !request.systemActions.length)).toBe(true);
    expect(log).toContain("Reading Line Item Subsets…");
    expect(log.filter(line => line.startsWith("Line Item Subsets"))).toEqual([
      "Line Item Subsets: 2 rows × 2 columns; columns: Modules | Notes",
      "Line Item Subsets: rows 0–1 in 0.00 s",
      "Line Item Subsets membership: subset 114000000001: 3 rows × 1 columns; columns: Planning measures",
      "Line Item Subsets membership: subset 114000000001: rows 0–2 in 0.00 s",
      "Line Item Subsets membership: subset 114000000002: 3 rows × 1 columns; columns: Review measures",
      "Line Item Subsets membership: subset 114000000002: rows 0–2 in 0.00 s",
      "Line Item Subsets membership: 2 subsets read in 0.00 s",
    ]);
  });

  it("keeps all returned columns and pages through the definition grid", async () => {
    const properties = { columns: [...definitions.columns, { ids: [4000000099], labels: ["New property"] }],
      rows: Array.from({ length: 1340 }, (_, index) => ({ ids: [114000000001 + index], labels: [`Subset ${index}`], cells: ["", "A note", "Kept"] })) };
    const { native, requests } = client({ properties });
    const result = await readLineItemSubsets(native, () => undefined);
    expect(result.table.headers).toEqual(["", "Modules", "Notes", "New property", "Line Items"]);
    expect(result.table.rows).toHaveLength(1340);
    expect(result.table.rows.at(-1)).toEqual(["Subset 1339", "", "A note", "Kept", ""]);
    expect(requests.map(request => request.params.pageRequests[0].startRow)).toEqual([0, 1333]);
  });

  it("keeps an empty grid without a membership request", async () => {
    const { native, requests } = client({ properties: { ...definitions, rows: [] } });
    expect(await readLineItemSubsets(native, () => undefined)).toEqual({ table: { headers: ["", "Modules", "Notes"], rows: [] } });
    expect(requests).toHaveLength(1);
  });

  it.each(["", "  ", null])("knows a subset with empty Modules (%j) has no members without reading it", async value => {
    const properties = structuredClone(definitions);
    properties.rows[0].cells[0] = value as string;
    const { native, requests } = client({ properties, ...scopedMembership });
    const log: string[] = [];
    const read = await readLineItemSubsets(native, line => log.push(line));
    expect(read.table.rows.map(row => row.at(-1))).toEqual(["", "'Demand'.'Rate, net'"]);
    expect(read.table.headers).not.toContain("Membership read");
    expect(read.note).toBeUndefined();
    expect(requests.map(request => request.params.viewDefinition.staticContextIdentifiers)).toEqual([[], ["_114000000002_"]]);
    expect(native.ids.entityLongIdToEntityLongIdIdentifier.mock.calls).toEqual([[114000000002]]);
    expect(log.at(-1)).toBe("Line Item Subsets membership: 1 subset read; 1 subset without Modules (no read) in 0.00 s");
  });

  it.each([0, 1])("leaves only failing subset %i unknown and still reads the others", async failed => {
    const grids = { properties: definitions, ...scopedMembership };
    delete grids[`_${definitions.rows[failed].ids[0]}_`];
    const { native, requests } = client(grids);
    const log: string[] = [];
    const read = await readLineItemSubsets(native, line => log.push(line));
    expect(read.note).toBeUndefined();
    expect(read.table.headers).toEqual(["", "Modules", "Notes", "Line Items", "Membership read"]);
    expect(read.table.rows.map(row => row.slice(-2))).toEqual([
      failed === 0 ? ["", "false"] : ["'Demand'.'Units'", "true"],
      failed === 1 ? ["", "false"] : ["'Demand'.'Rate, net'", "true"],
    ]);
    expect(requests).toHaveLength(3);
    expect(log).toContain(`Line Item Subsets membership: subset ${definitions.rows[failed].ids[0]} not read (The model rejected the read: not available.)`);
    expect(log.at(-1)).toBe("Line Item Subsets membership: 1 subset read; 1 subset not read in 0.00 s");
  });

  it("does not invent a static context when the native identifier helper is missing", async () => {
    const { native, requests } = client();
    native.ids = {};
    const log: string[] = [];
    const read = await readLineItemSubsets(native, line => log.push(line));
    expect(requests).toHaveLength(1);
    expect(read.table.rows.map(row => row.slice(-2))).toEqual([["", "false"], ["", "false"]]);
    expect(read.note).toBe(MEMBERSHIP_NOT_READ);
    expect(log.slice(-3)).toEqual([
      "Line Item Subsets membership: subset 114000000001 not read (the model page has no entityLongIdToEntityLongIdIdentifier helper)",
      "Line Item Subsets membership: subset 114000000002 not read (the model page has no entityLongIdToEntityLongIdIdentifier helper)",
      "Line Item Subsets membership: 0 subsets read; 2 subsets not read in 0.00 s",
    ]);
  });

  it("still knows an empty subset when the native identifier helper is missing", async () => {
    const properties = structuredClone(definitions);
    properties.rows[0].cells[0] = "";
    const { native, requests } = client({ properties });
    native.ids = {};
    const read = await readLineItemSubsets(native, () => undefined);
    expect(requests).toHaveLength(1);
    expect(read.table.rows.map(row => row.slice(-2))).toEqual([["", "true"], ["", "false"]]);
    expect(read.note).toBeUndefined();
  });

  it.each([false, true])("propagates a stop between subsets, including a failed current read (%j)", async fail => {
    const { native, requests } = client(fail ? { properties: definitions } : undefined);
    const stopping = new AbortController(), stopped = new Error("The export was stopped.");
    const post = native.aggregator.post;
    native.aggregator.post = (request: any, flag: boolean, ok: (response: unknown) => void) => {
      if (request.params.viewDefinition.staticContextIdentifiers.length) stopping.abort(stopped);
      post(request, flag, ok);
    };
    await expect(readLineItemSubsets(native, () => undefined, stopping.signal)).rejects.toBe(stopped);
    expect(requests.map(request => request.params.viewDefinition.staticContextIdentifiers)).toEqual([[], ["_114000000001_"]]);
  });

  it("waits for each subset's read before starting the next and logs total membership time once", async () => {
    const { native } = client();
    const post = native.aggregator.post;
    let active = 0, maximum = 0;
    native.aggregator.post = (request: any, flag: boolean, ok: (response: unknown) => void) => {
      maximum = Math.max(maximum, ++active);
      queueMicrotask(() => { active--; post(request, flag, ok); });
    };
    const log: string[] = [];
    await readLineItemSubsets(native, line => {
      log.push(line);
      if (line.startsWith("Line Item Subsets membership: subset 114000000001: rows")) vi.mocked(Date.now).mockReturnValue(1250);
    });
    expect(maximum).toBe(1);
    expect(native.aggregator.isDirty).toHaveBeenCalledTimes(3);
    expect(log.filter(line => /subsets read in/.test(line))).toEqual(["Line Item Subsets membership: 2 subsets read in 0.25 s"]);
  });

  it.each([
    ["102000000001", "102000000001,102000000002", "true", true],
    ["102000000001", "102000000001", "true", false],
    ["102000000001,102000000002", "102000000002, 102000000001", "true", false],
    ["102000000001", "102000000002", "false", false],
  ])("logs identical non-empty members only for different Modules (%s; %s; %s)", async (first, second, value, warned) => {
    const properties = structuredClone(definitions);
    properties.rows[0].cells[0] = first;
    properties.rows[1].cells[0] = second;
    const grid = (index: number): Grid => ({ columns: [{ ids: definitions.rows[index].ids, labels: definitions.rows[index].labels }],
      rows: [{ ids: [1901000000001, 102000000001], labels: ["Units", "Demand"], cells: [value] }] });
    const { native } = client({ properties, _114000000001_: grid(0), _114000000002_: grid(1) });
    const log: string[] = [];
    const read = await readLineItemSubsets(native, line => log.push(line), undefined, [["Demand", "102000000001"], ["Supply", "102000000002"]]);
    expect(read.table.rows.map(row => row.at(-1))).toEqual(Array(2).fill(value === "true" ? "'Demand'.'Units'" : ""));
    expect(read.table.headers).not.toContain("Membership read");
    expect(read.note).toBeUndefined();
    expect(log.filter(line => line.includes("identical non-empty"))).toEqual(warned ? [
      "Line Item Subsets membership: subsets 114000000001, 114000000002 have different Modules but identical non-empty member lists",
    ] : []);
  });

  it("does not trust a Line Items property in place of the native per-subset membership", async () => {
    const properties = { columns: [...definitions.columns, { ids: [4000000099], labels: ["Line Items"] }],
      rows: definitions.rows.map(row => ({ ...row, cells: [...row.cells, "Wrong member"] })) };
    const { native, requests } = client({ properties, ...scopedMembership });
    const { table } = await readLineItemSubsets(native, () => undefined);
    expect(table.headers).toEqual(["", "Modules", "Notes", "Line Items"]);
    expect(table.rows.map(row => row.at(-1))).toEqual(["'Demand'.'Units'", "'Demand'.'Rate, net'"]);
    expect(requests).toHaveLength(3);
  });

  it("keeps definitions and marks every membership unknown when every subset read fails", async () => {
    const { native } = client({ properties: definitions });
    const log: string[] = [];
    const result = await readLineItemSubsets(native, line => log.push(line));
    expect(result.note).toBe(MEMBERSHIP_NOT_READ);
    expect(result.table.headers).toEqual(["", "Modules", "Notes", "Line Items", "Membership read"]);
    expect(result.table.rows.map(row => row.slice(-2))).toEqual([["", "false"], ["", "false"]]);
    expect(log.slice(-3)).toEqual([
      "Line Item Subsets membership: subset 114000000001 not read (The model rejected the read: not available.)",
      "Line Item Subsets membership: subset 114000000002 not read (The model rejected the read: not available.)",
      "Line Item Subsets membership: 0 subsets read; 2 subsets not read in 0.00 s",
    ]);
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
    const { native } = client({ properties, ...scopedMembership });
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
    const { native } = client({ properties: definitions, ...scopedMembership, _114000000002_: grid });
    const log: string[] = [];
    const read = await readLineItemSubsets(native, line => log.push(line));
    expect(read.note).toBeUndefined();
    expect(read.table.headers).toEqual(["", "Modules", "Notes", "Line Items", "Membership read"]);
    expect(read.table.rows.map(row => row.slice(-2))).toEqual([["'Demand'.'Units'", "true"], ["", "false"]]);
    expect(log).toContain("Line Item Subsets membership: subset 114000000002 not read (column missing)");
    expect(log.at(-1)).toBe("Line Item Subsets membership: 1 subset read; 1 subset not read in 0.00 s");
  });

  it("leaves a subset unknown if its column ID occurs more than once", async () => {
    const column = scopedMembership._114000000001_.columns[0];
    const { native } = client({ properties: definitions, ...scopedMembership,
      _114000000001_: { columns: [column, column], rows: contextFree.rows } });
    const log: string[] = [];
    const read = await readLineItemSubsets(native, line => log.push(line));
    expect(read.table.rows.map(row => row.slice(-2))).toEqual([["", "false"], ["'Demand'.'Rate, net'", "true"]]);
    expect(log).toContain("Line Item Subsets membership: subset 114000000001 not read (column not identified once)");
  });
});
