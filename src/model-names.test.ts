import { describe, expect, it, vi } from "vitest";
import { readModelNames } from "./model-names.js";
import { RestError } from "./rest.js";

const scope = { customerId: "A".repeat(32), workspaceId: "B".repeat(32), modelId: "C".repeat(32) };
const base = `/a/springboard-platform-gateway-service/customers/${scope.customerId}/workspaces`;
const progress = () => ({ status: vi.fn(), log: vi.fn() });

describe("Names for a read without a Classic client", () => {
  it("reads names only, ignoring every engine field, with no directory request when both names are present", async () => {
    const details = { label: "Practice plan", workspaceName: "Practice workspace" };
    for (const field of ["engine", "engineType", "calculationEngine", "modelType", "isPolaris", "dataEngineType"]) {
      Object.defineProperty(details, field, { get() { throw new Error("Engine fields must not be read"); } });
    }
    const read = vi.fn(async () => details), log = progress();
    expect(await readModelNames(scope, log, undefined, read)).toEqual({ modelName: "Practice plan", workspaceName: "Practice workspace" });
    expect(read).toHaveBeenCalledExactlyOnceWith(`${base}/${scope.workspaceId}/models/${scope.modelId}`, { timeoutMs: 5000 });
    expect(log.log).not.toHaveBeenCalled();
  });

  it("uses only the selected workspace's name when the model details do not supply it", async () => {
    const read = vi.fn().mockResolvedValueOnce({ name: "Practice plan", engine: "HYPERBLOCK" }).mockResolvedValueOnce([
      { WorkspaceGuid: "D".repeat(32), Name: "Another workspace" },
      { WorkspaceGuid: scope.workspaceId.toLowerCase(), Name: "Practice workspace", get dataEngineType() { throw new Error("Do not inspect"); } },
    ]);
    const log = progress();
    expect(await readModelNames(scope, log, undefined, read)).toEqual({ modelName: "Practice plan", workspaceName: "Practice workspace" });
    expect(read).toHaveBeenLastCalledWith(base, { timeoutMs: 5000 });
    expect(log.log).not.toHaveBeenCalled();
  });

  it("keeps names optional when the gateway refuses them or gives unfamiliar shapes", async () => {
    const log = progress();
    const read = vi.fn().mockRejectedValueOnce(new RestError("HTTP_ERROR", 403)).mockResolvedValueOnce({ items: [] });
    expect(await readModelNames(scope, log, undefined, read)).toEqual({ workspaceName: undefined });
    expect(log.log).toHaveBeenCalledExactlyOnceWith("Model name unavailable (HTTP_ERROR (HTTP 403))");
    expect(await readModelNames(scope, log, undefined, vi.fn().mockResolvedValueOnce({ label: 3, name: " ", workspaceName: [] }).mockResolvedValueOnce([])))
      .toEqual({ modelName: undefined, workspaceName: undefined });
  });

  it("reads no names without the scoped IDs, stops between reads, and preserves maintenance errors", async () => {
    const read = vi.fn(async () => ({}));
    expect(await readModelNames({ modelId: scope.modelId }, progress(), undefined, read)).toEqual({});
    expect(read).not.toHaveBeenCalled();
    const stop = new AbortController();
    read.mockImplementation(async () => { stop.abort(new Error("closed")); return {}; });
    await expect(readModelNames(scope, progress(), stop.signal, read)).rejects.toThrow("closed");
    expect(read).toHaveBeenCalledOnce();
    await expect(readModelNames(scope, progress(), undefined, vi.fn().mockRejectedValue(new RestError("MAINTENANCE", 503))))
      .rejects.toMatchObject({ code: "MAINTENANCE" });
  });
});
