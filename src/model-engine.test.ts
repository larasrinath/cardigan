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
    expect(await detectModelEngine(scope, () => true, log, undefined, read)).toEqual({ engine: parseEngine(engine), modelName: "Practice plan", workspaceName: "Practice workspace" });
    expect(read.mock.calls).toHaveLength(1);
    expect(read).toHaveBeenCalledWith(`${base}/${scope.workspaceId}/models/${scope.modelId}`, { timeoutMs: 5000 });
    expect(log.log).toHaveBeenCalledWith(`Engine detection: model.engine="${engine}"`);
  });

  it.each([{}, { engine: "future_engine" }])("uses only this workspace's engine after %j, before the frames", async model => {
    const read = vi.fn().mockResolvedValueOnce(model).mockResolvedValueOnce([
      { WorkspaceGuid: "D".repeat(32), dataEngineType: "hyperblock" },
      { WorkspaceGuid: scope.workspaceId.toLowerCase(), Name: "Practice workspace", dataEngineType: "calculation_engine" },
    ]);
    const log = progress();
    expect(await detectModelEngine(scope, () => true, log, undefined, read)).toMatchObject({ engine: "polaris" });
    expect(read).toHaveBeenLastCalledWith(base, { timeoutMs: 5000 });
    expect(log.log).toHaveBeenCalledWith('Engine detection: workspace.dataEngineType="calculation_engine"');
  });

  it.each([true, false])("survives refused or unfamiliar details, with a Classic frame: %s", async frame => {
    const read = vi.fn().mockRejectedValueOnce(new RestError("HTTP_ERROR", 403)).mockResolvedValueOnce([{ WorkspaceGuid: scope.workspaceId, dataEngineType: "other" }]);
    const log = progress();
    expect((await detectModelEngine(scope, () => frame, log, undefined, read)).engine).toBe(frame ? "classic" : "unknown");
    expect(log.log.mock.calls.at(-1)?.[0]).toContain(frame ? "Classic; reading model settings" : "unknown; continuing with the Classic reader");
  });

  it("does not request details without the scoped IDs, and stops between reads", async () => {
    const read = vi.fn(async () => ({}));
    expect((await detectModelEngine({ modelId: scope.modelId }, () => true, progress(), undefined, read)).engine).toBe("classic");
    expect(read).not.toHaveBeenCalled();
    const stop = new AbortController();
    read.mockImplementation(async () => { stop.abort(new Error("closed")); return {}; });
    await expect(detectModelEngine(scope, () => false, progress(), stop.signal, read)).rejects.toThrow("closed");
    expect(read).toHaveBeenCalledOnce();
  });
});
