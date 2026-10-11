import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { engineCrossCheck, engineLine, knownDataEngineType, parseEngine } from "./model-engine.js";
import { dataEngineTypeOnPage } from "./model/native.js";

describe("Calculation engine from the model's page", () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    ["HYPERBLOCK", "classic", "Engine: Classic (dataEngineType HYPERBLOCK)"],
    ["CALCULATION_ENGINE", "polaris", "Engine: Polaris (dataEngineType CALCULATION_ENGINE)"],
    ...[undefined, null, 17, {}, "future_engine", "hyperblock", "Polaris"].map(value =>
      [value, "unknown", "Engine: unknown (dataEngineType missing or unrecognized)"]),
  ])("reads and maps %j without making any request", (raw, expected, line) => {
    const getWorkspaceInfo = vi.fn(function (this: unknown) { expect(this).toBe(cache); return { dataEngineType: raw }; });
    const cache = new Proxy({ getWorkspaceInfo }, {
      get(target, key) { if (key !== "getWorkspaceInfo") throw new Error("Only the workspace getter may be read"); return target.getWorkspaceInfo; },
      set() { throw new Error("The cache must not be changed"); },
    });
    const require = vi.fn((id: string) => { expect(id).toBe("anaplan/data/ModelContentCache"); return cache; });
    vi.stubGlobal("window", { require });
    vi.stubGlobal("fetch", vi.fn(() => { throw new Error("No requests"); }));
    vi.stubGlobal("WebSocket", vi.fn(() => { throw new Error("No requests"); }));
    const value = dataEngineTypeOnPage();
    expect(value).toBe(knownDataEngineType(raw));
    expect(parseEngine(value)).toBe(expected);
    expect(engineLine(value)).toBe(line);
    expect(getWorkspaceInfo).toHaveBeenCalledOnce();
    expect(require).toHaveBeenCalledExactlyOnceWith("anaplan/data/ModelContentCache");
    expect(fetch).not.toHaveBeenCalled();
    expect(WebSocket).not.toHaveBeenCalled();
  });

  it.each([undefined, null, [], 12, "cache", {}, { getWorkspaceInfo: 1 },
    ...[undefined, null, [], 12, "info", {}].map(info => ({ getWorkspaceInfo: () => info })),
    { getWorkspaceInfo() { throw new Error("Still opening"); } },
    { get getWorkspaceInfo() { throw new Error("Unavailable getter"); } },
    { getWorkspaceInfo: () => ({ get dataEngineType() { throw new Error("Unavailable field"); } }) },
  ])("leaves an unavailable or malformed cache unknown (%#)", cache => {
    vi.stubGlobal("window", { require: () => cache });
    expect(dataEngineTypeOnPage()).toBeUndefined();
  });

  it.each([{}, { require: true }, { require() { throw new Error("Module not loaded"); } },
    { get require() { throw new Error("Loader unavailable"); } }])("leaves an unavailable loader unknown (%#)", page => {
    vi.stubGlobal("window", page);
    expect(dataEngineTypeOnPage()).toBeUndefined();
  });

  it.each(["Populated Cell Count", "Calculation Complexity"])("cross-checks %s without replacing the decision", column => {
    expect(engineCrossCheck("classic", [column])).toBe("Engine cross-check: Polaris-only Line Items columns disagree with dataEngineType HYPERBLOCK (Classic).");
    expect(engineCrossCheck("unknown", [column])).toBe("Engine cross-check: Polaris-only Line Items columns found; dataEngineType is unknown.");
    expect(engineCrossCheck("polaris", [column])).toBeUndefined();
    for (const engine of ["classic", "polaris", "unknown"] as const) expect(engineCrossCheck(engine, ["Cell Count"])).toBeUndefined();
  });

  it("keeps NOTICE's request table aligned with the removed gateway probe", () => {
    const notice = readFileSync(new URL("../NOTICE.md", import.meta.url), "utf8");
    expect(notice).toContain("getWorkspaceInfo().dataEngineType");
    expect(notice).toContain("Model and workspace names, only for a read without a Classic client.");
    expect(notice).toContain("Workspace name, only when the model details did not supply it for a read without a Classic client.");
    expect(readFileSync(new URL("./model-engine.ts", import.meta.url), "utf8")).not.toMatch(/getJson|springboard-platform-gateway-service|ENGINE_FIELDS/);
    for (const route of ["modules", "versions", "line-items/{module}"]) {
      expect(notice).toContain(`/a/llm-data-service/meta-data/workspace/{workspace}/model/{model}/${route}`);
    }
  });
});
