import { describe, expect, it, vi } from "vitest";
import { detectModelEngine, parseEngine } from "./model-engine.js";
import { RestError } from "./rest.js";

const scope = { customerId: "A".repeat(32), workspaceId: "B".repeat(32), modelId: "C".repeat(32) };
const base = `/a/springboard-platform-gateway-service/customers/${scope.customerId}/workspaces`;
const progress = () => ({ status: vi.fn(), log: vi.fn() });

describe("Calculation engine detection", () => {
  it.each([["hyperblock", "classic"], ["calculation_engine", "polaris"], [undefined, "unknown"], ["future_engine", "unknown"],
    [null, "unknown"], [17, "unknown"], [{ engine: "hyperblock" }, "unknown"], ["CALCULATION_ENGINE", "polaris"]])("parses %j as %s", (raw, expected) => {
    expect(parseEngine(raw)).toBe(expected);
  });

  it.each(["hyperblock", "calculation_engine"])("reads one model before any fallback: %s", async engine => {
    const read = vi.fn(async () => ({ engine, label: "Practice plan", workspaceName: "Practice workspace" }));
    const log = progress();
    expect(await detectModelEngine(scope, log, undefined, read)).toEqual({ engine: parseEngine(engine), modelName: "Practice plan", workspaceName: "Practice workspace" });
    expect(read.mock.calls).toHaveLength(1);
    expect(read).toHaveBeenCalledWith(`${base}/${scope.workspaceId}/models/${scope.modelId}`, { timeoutMs: 5000 });
    expect(log.log).toHaveBeenCalledWith("Engine detection: model details fields: engine, label, workspaceName");
  });

  it.each([{}, { engine: "future_engine" }])("uses only this workspace's engine after %j, before the frames", async model => {
    const read = vi.fn().mockResolvedValueOnce(model).mockResolvedValueOnce([
      { WorkspaceGuid: "D".repeat(32), dataEngineType: "hyperblock" },
      { WorkspaceGuid: scope.workspaceId.toLowerCase(), Name: "Practice workspace", dataEngineType: "calculation_engine" },
    ]);
    const log = progress();
    expect(await detectModelEngine(scope, log, undefined, read)).toMatchObject({ engine: "polaris" });
    expect(read).toHaveBeenLastCalledWith(base, { timeoutMs: 5000 });
    expect(log.log).toHaveBeenCalledWith("Engine detection: workspace entry fields: Name, WorkspaceGuid, dataEngineType");
  });

  it("survives refused or unfamiliar details without claiming to know the engine", async () => {
    const read = vi.fn().mockRejectedValueOnce(new RestError("HTTP_ERROR", 403)).mockResolvedValueOnce([{ WorkspaceGuid: scope.workspaceId, dataEngineType: "other" }]);
    const log = progress();
    expect((await detectModelEngine(scope, log, undefined, read)).engine).toBe("unknown");
    expect(log.log.mock.calls.at(-1)?.[0]).toBe("Engine detection: unknown; trying the Classic reader first");
  });

  it("does not request details without the scoped IDs, and stops between reads", async () => {
    const read = vi.fn(async () => ({}));
    expect((await detectModelEngine({ modelId: scope.modelId }, progress(), undefined, read)).engine).toBe("unknown");
    expect(read).not.toHaveBeenCalled();
    const stop = new AbortController();
    read.mockImplementation(async () => { stop.abort(new Error("closed")); return {}; });
    await expect(detectModelEngine(scope, progress(), stop.signal, read)).rejects.toThrow("closed");
    expect(read).toHaveBeenCalledOnce();
  });

  it.each(["engine", "engineType", "calculationEngine", "modelType", "isPolaris", "dataEngineType"])("checks %s in either gateway response without logging values", async field => {
    for (const where of ["model", "workspace"]) for (const value of ["hyperblock", "CALCULATION_ENGINE"]) {
      const details = { engine: "unfamiliar private value", [field]: value, label: "Invented private name", nested: { secret: "Invented secret" } };
      const read = vi.fn().mockResolvedValueOnce(where === "model" ? details : {})
        .mockResolvedValueOnce([{ WorkspaceGuid: scope.workspaceId, ...details }]);
      const log = progress();
      expect((await detectModelEngine(scope, log, undefined, read)).engine).toBe(parseEngine(value));
      const lines = log.log.mock.calls.flat().join("\n");
      for (const secret of [value, "unfamiliar private value", "Invented private name", "Invented secret", scope.workspaceId]) expect(lines).not.toContain(secret);
      expect(lines).toContain(`Engine detection: ${where === "model" ? "model details" : "workspace entry"} fields:`);
    }
  });

  it.each([[true, "polaris"], [false, "classic"], ["true", "unknown"], [1, "unknown"], ["Polaris", "unknown"]])("recognises only a boolean isPolaris flag or the original engine strings: %j", async (isPolaris, expected) => {
    for (const where of ["model", "workspace"]) {
      const read = vi.fn().mockResolvedValueOnce(where === "model" ? { isPolaris } : {})
        .mockResolvedValueOnce(where === "workspace" ? [{ WorkspaceGuid: scope.workspaceId, isPolaris }] : []);
      expect((await detectModelEngine(scope, progress(), undefined, read)).engine).toBe(expected);
    }
  });
});
