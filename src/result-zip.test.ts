import { describe, expect, it } from "vitest";
import type { AnalysisResult } from "./result-types.js";
import { resultZip, tableCsv } from "./result-zip.test-support.js";
import { toCsv, zipStore } from "./zip.test-support.js";

describe("A result's zip, built from its tables", () => {
  const result: AnalysisResult = {
    kind: "model", name: "Model one", id: "0123456789ABCDEF0123456789ABCDEF", zipName: "Model one - Model Export - 2026-10-03.zip", summary: [],
    tables: [
      { file: "Model Details.csv", label: "Model Details", headers: ["Section", "Detail", "Value"], rows: [["Model", "Model", "=Model one"]], guard: true, details: true },
      { file: "Line Items.csv", label: "Line Items", headers: ["", "Formula"], rows: [["Revenue", "=Units * Price"], ["Units", 12]], guard: false },
    ],
  };

  it("writes each file with its own guard setting, in the tables' order", () => {
    // Guarded: a formula-like cell is defused. Unguarded: the model's grids keep Anaplan's own text.
    expect(tableCsv(result.tables[0])).toBe(toCsv(["Section", "Detail", "Value"], [["Model", "Model", "=Model one"]], true));
    expect(tableCsv(result.tables[0])).toContain("'=Model one");
    expect(tableCsv(result.tables[1])).toContain("=Units * Price");
    expect(tableCsv(result.tables[1])).not.toContain("'=Units");
    const modified = new Date(2026, 9, 3, 12, 0, 0);
    const encoder = new TextEncoder();
    const expected = zipStore([
      { name: "Model Details.csv", data: encoder.encode(toCsv(result.tables[0].headers, result.tables[0].rows, true)) },
      { name: "Line Items.csv", data: encoder.encode(toCsv(result.tables[1].headers, result.tables[1].rows, false)) },
    ], modified);
    expect(resultZip(result, modified)).toEqual(expected);
  });
});
