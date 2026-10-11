import { describe, expect, it, vi } from "vitest";
import { addLists, addModuleViews, emptyCatalog } from "./catalog.js";
import { readPolarisModel, type PageReads } from "./model-pages.js";
import { POLARIS_NOTE, polarisResult } from "./polaris.js";
import { plainResult } from "./result-plain.js";
import { listedTables, overviewOf } from "./results/result-view.js";

const ids = { customerId: "A".repeat(32), workspaceId: "B".repeat(32), modelId: "C".repeat(32) };
const engine = { engine: "polaris", modelName: "Practice plan", workspaceName: "Practice workspace" } as const;
function inventory() {
  const catalog = emptyCatalog();
  addModuleViews(catalog, { data: [
    { id: "102000000001", name: "Demand", dimensions: ["101000000001", { id: "20000000003", label: "Time" }] },
    { id: "102000000002", name: "Assumptions" },
  ], dimensions: { "101000000001": { label: "Products" }, "20000000003": { label: "Time" } } });
  addLists(catalog, { data: [{ id: "101000000001", name: "Products" }] });
  return catalog;
}

describe("Polaris partial results", () => {
  it("keeps socket membership, separates lists from other dimensions, and preserves the partial marker across storage", () => {
    const catalog = inventory();
    expect(catalog.moduleDimensions.size).toBe(0); // existing Classic page naming is unchanged
    const result = plainResult(polarisResult(ids, engine, catalog))!;
    expect(result.engine).toBe("polaris");
    expect(result.tables[1].rows).toEqual([["Demand", "Products, Time", "102000000001"], ["Assumptions", "", "102000000002"]]);
    expect(result.tables[2].rows).toEqual([["Products", "101000000001"]]);
    expect(overviewOf(result).notes).toContain(POLARIS_NOTE);
    expect(listedTables(result).map(({ table }) => table.label)).toEqual(["General Lists", "Modules"]);
    expect(result.moduleIds).toEqual([["Demand", "102000000001"], ["Assumptions", "102000000002"]]);
  });

  it.each([false, true])("reads the inventory even with no pages; directory refused: %s", async refused => {
    const catalog = inventory();
    const reads: PageReads = {
      getJson: vi.fn(async () => { if (refused) throw new Error("refused"); return []; }),
      readPublished: vi.fn(), loadCatalog: vi.fn(async () => ({ catalog, notes: [], failedActionTypes: [] })),
    };
    const log = { status: vi.fn(), log: vi.fn() };
    const result = await readPolarisModel(ids, engine, log, undefined, reads);
    expect(reads.loadCatalog).toHaveBeenCalledOnce();
    expect(result.tables.map(table => table.label)).toEqual(["Model Details", "Modules", "General Lists", ...(refused ? [] : ["Module Usage"])]);
    expect(overviewOf(result).about.map(([label]) => label)).toEqual(["Workspace", "Workspace ID", "Model", "Model ID", "Apps"]);
    expect(log.log.mock.calls.at(-1)?.[0]).toContain("Polaris partial result: 2 modules, 1 general lists");
  });

  it("shows no empty tabs when the inventory is unavailable", async () => {
    const result = await readPolarisModel(ids, engine, { status: vi.fn(), log: vi.fn() }, undefined, {
      getJson: vi.fn(async () => []), readPublished: vi.fn(), loadCatalog: vi.fn(async () => ({ catalog: emptyCatalog(), notes: ["Names unavailable"], failedActionTypes: [] })),
    });
    expect(listedTables(result)).toEqual([]);
    expect(overviewOf(result).notes).toContain(POLARIS_NOTE);
    expect(overviewOf(result).notes.join(" ")).toContain("Names unavailable");
  });

  it("keeps names with commas whole, and never treats the Line Items axis as a module dimension", () => {
    const catalog = inventory();
    catalog.dimensions.set("101000000001", "Products, active");
    catalog.moduleViewDimensions.get("102000000001")!.push({ id: "20000000012", name: "Line Items" });
    expect(polarisResult(ids, engine, catalog).tables[1].rows[0][1]).toBe("'Products, active', Time");
  });

  it("keeps the result partial if name enrichment fails, and starts no read after cancellation", async () => {
    const reads: PageReads = { getJson: vi.fn(async () => []), readPublished: vi.fn(), loadCatalog: vi.fn(async () => { throw new Error("names refused"); }) };
    const result = await readPolarisModel(ids, engine, { status: vi.fn(), log: vi.fn() }, undefined, reads);
    expect(result.engine).toBe("polaris");
    expect(overviewOf(result).notes.join(" ")).toContain("names refused");
    vi.mocked(reads.getJson).mockClear();
    await expect(readPolarisModel(ids, engine, { status: vi.fn(), log: vi.fn() }, AbortSignal.abort(new Error("closed")), reads)).rejects.toThrow("closed");
    expect(reads.getJson).not.toHaveBeenCalled();
  });
});
