import { describe, expect, it } from "vitest";
import { buildPolarisGraph, polarisReferences } from "./polaris-map.js";
import { hasModelMap } from "./polaris.js";
import { polarisFixture } from "./polaris.test-support.js";

describe("Polaris formula map adapter", () => {
  it("draws cross-module and local dependencies from formula names, preserves tables and keeps real row locations", () => {
    const { result } = polarisFixture();
    const before = JSON.stringify(result);
    const graph = buildPolarisGraph(result);
    expect(graph.nodes.filter(n => n.kind === "module").map(n => n.name)).toEqual(["Inputs", "Forecast", "Empty module"]);
    expect(graph.edges.filter(e => e[2] === "reference").map(([from, to]) => [graph.nodes[from].name, graph.nodes[to].name]))
      .toEqual([["Units", "Revenue"], ["Unit Price", "Revenue"], ["Revenue", "Adjusted Revenue"], ["Revenue", "Ready"]]);
    expect(graph.nodes.find(n => n.name === "Revenue")).toMatchObject({ file: "Line Items", row: 4 });
    expect(graph.nodes.find(n => n.name === "Forecast")).toMatchObject({ file: "Modules", row: 3 });
    expect(graph.unresolved.filter(ref => ref.field === "Formula")).toEqual([]);
    expect(JSON.stringify(result)).toBe(before);
    expect(hasModelMap(result)).toBe(true);
  });

  it("leaves unknown and ambiguous references visible and never treats numeric literals as object IDs", () => {
    const { result } = polarisFixture();
    const items = result.tables.find(t => t.label === "Line Items")!;
    items.rows.push([...items.rows[0]]); // Units is now ambiguous in Inputs.
    items.rows[2][4] = "'Inputs'.Units + 'Gone module'.'Gone item' + '12345678901' + 12345678901";
    const graph = buildPolarisGraph(result);
    const unresolved = graph.unresolved.filter(ref => ref.field === "Formula").map(ref => ref.reference);
    expect(unresolved).toEqual(["'Inputs'.Units", "'Gone module'.'Gone item'", "'12345678901'"]);
    expect(graph.edges.some(([from, to, kind]) => graph.nodes[from].name === "Units" && graph.nodes[to].name === "Revenue" && kind === "reference")).toBe(false);
  });

  it("ignores functions, string literals, keywords and aggregation labels, keeping quoted and bare names", () => {
    expect(polarisReferences('IF Ready THEN ROUND(Revenue, 2) ELSE \'Inputs\'.\'Unit Price\'[LOOKUP: Mapping] + "Revenue" + 1.05e3').map(r => r.parts))
      .toEqual([["Ready"], ["Revenue"], ["Inputs", "Unit Price"], ["Mapping"]]);
    expect(polarisReferences("'Owner''s total' + Unit Price").map(r => r.parts)).toEqual([["Owner's total"], ["Unit Price"]]);
  });

  it("keeps the map unavailable if no formula was read", () => {
    const { result } = polarisFixture();
    for (const row of result.tables.find(t => t.label === "Line Items")!.rows) row[4] = "";
    expect(hasModelMap(result)).toBe(false);
    expect(hasModelMap({ ...result, engine: undefined })).toBe(true);
  });
});
