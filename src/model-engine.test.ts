import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { engineColumns, engineFromColumns, engineLine } from "./model-engine.js";

describe("Calculation engine from the Line Items columns", () => {
  it.each([
    { columns: ["Name", "Cell Count"], engine: "classic", line: "Engine: Classic (from the Line Items columns)" },
    { columns: [], engine: "classic", line: "Engine: Classic (from the Line Items columns)" },
    ...[["Populated Cell Count"], ["Calculation Complexity"], ["Populated Cell Count", "Calculation Complexity"]].map(columns =>
      ({ columns, engine: "polaris", line: "Engine: Polaris (from the Line Items columns)" })),
  ])("identifies $engine from $columns", ({ columns, engine, line }) => {
    expect(engineFromColumns(columns)).toBe(engine);
    expect(engineLine(engineFromColumns(columns))).toBe(line);
  });

  it("keeps an unknown engine when no Classic client answers", () => {
    expect(engineLine("unknown")).toBe("Engine: unknown (no Classic client)");
  });

  it("takes the Modules table's columns where Line Items gave none, and says so; Line Items' come first, even with none of the two", () => {
    const POLARIS_MODULES = ["", "Cell Count", "Populated Cell Count", "Memory Used"];
    const told = engineColumns(undefined, POLARIS_MODULES);
    expect([told.from, engineFromColumns(told.columns), engineLine(engineFromColumns(told.columns), told.from)])
      .toEqual(["Modules", "polaris", "Engine: Polaris (from the Modules columns)"]);
    expect(engineColumns(["", "Cell Count"], POLARIS_MODULES)).toEqual({ columns: ["", "Cell Count"], from: "Line Items" });
    expect(engineColumns(undefined, undefined)).toEqual({ columns: [], from: "Line Items" });
    expect(engineLine(engineFromColumns(engineColumns(undefined, ["", "Cell Count"]).columns), "Modules")).toBe("Engine: Classic (from the Modules columns)");
  });

  it("keeps NOTICE's request table aligned with the removed gateway probe", () => {
    const notice = readFileSync(new URL("../NOTICE.md", import.meta.url), "utf8");
    expect(notice).toContain("engine from the export's Line Items columns");
    expect(notice).not.toContain("getWorkspaceInfo");
    expect(notice).toContain("Model and workspace names, only for a read without a Classic client.");
    expect(notice).toContain("Workspace name, only when the model details did not supply it for a read without a Classic client.");
    expect(readFileSync(new URL("./model-engine.ts", import.meta.url), "utf8")).not.toMatch(/getJson|springboard-platform-gateway-service|ENGINE_FIELDS/);
    for (const route of ["modules", "versions", "line-items/{module}"]) {
      expect(notice).toContain(`/a/llm-data-service/meta-data/workspace/{workspace}/model/{model}/${route}`);
    }
  });
});
