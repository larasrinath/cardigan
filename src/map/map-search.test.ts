import { describe, expect, it } from "vitest";
import { modulesGraph } from "./map-graphs.js";
import { indexModel } from "./map-model.js";
import { createSearch, matchNodes, SEARCH_LIMIT, searchText } from "./map-search.js";
import { GraphMaker } from "./map.test-support.js";

function sample() {
  const make = new GraphMaker();
  const volumes = make.module("INP01 - Volumes", "01: Inputs");
  const revenue = make.module("CAL01 - Revenue", "02: Revenue Calculations");
  make.item(volumes, "Units");
  make.item(volumes, "Revenue Share");
  make.item(revenue, "Revenue");
  make.item(revenue, "Net");
  make.list("Revenue Types");
  return { model: indexModel(make.graph()), volumes, revenue };
}

describe("The map's search", () => {
  it("finds sections, modules and line items by the text typed, anywhere in the name and whatever its case", () => {
    const search = createSearch(sample().model);
    const { hits, total } = search("  REVENUE ");
    expect(total).toBe(5);
    expect(hits.map(hit => [hit.kind, hit.name, hit.context])).toEqual([
      // What is named exactly as typed comes first.
      ["lineItem", "Revenue", "CAL01 - Revenue"],
      ["section", "02: Revenue Calculations", "Section · 1 module"],
      ["module", "CAL01 - Revenue", "Module · 02: Revenue Calculations"],
      ["lineItem", "Revenue Share", "INP01 - Volumes"],
      // A line item of a module that the text names is found by its module.
      ["lineItem", "Net", "CAL01 - Revenue"],
    ]);
  });

  it("says where a hit is: a section by its place, a module and a line item by their node", () => {
    const { model, volumes } = sample();
    const { hits } = createSearch(model)("inp");
    expect(hits.map(hit => [hit.kind, hit.section, hit.node?.id])).toEqual([["section", 0, undefined], ["module", undefined, volumes], ["lineItem", undefined, model.itemsOf(volumes)[0].id], ["lineItem", undefined, model.itemsOf(volumes)[1].id]]);
  });

  it("finds nothing for no text, and nothing among lists", () => {
    const search = createSearch(sample().model);
    expect(search("")).toEqual({ hits: [], total: 0 });
    expect(search("   ")).toEqual({ hits: [], total: 0 });
    expect(search("types")).toEqual({ hits: [], total: 0 });
    expect(searchText("  Net Revenue ")).toBe("net revenue");
  });

  it("lists the first fifty hits and counts them all, with an exact name first even when it comes late", () => {
    const make = new GraphMaker();
    const module = make.module("BIG - Many Lines", "01: All");
    for (let index = 0; index < 120; index++) make.item(module, `Line ${index}`);
    make.item(module, "line");
    const search = createSearch(indexModel(make.graph()));
    const { hits, total } = search("line");
    // The module's name holds the text too, and so does each of its line items by it.
    expect(total).toBe(122);
    expect(hits).toHaveLength(SEARCH_LIMIT);
    expect(hits[0].name).toBe("line");
    expect(hits[1].name).toBe("BIG - Many Lines");
    expect(search("line", 5).hits.map(hit => hit.name)).toEqual(["line", "BIG - Many Lines", "Line 0", "Line 1", "Line 2"]);
  });

  it("marks the nodes on screen that the text names, by name or by code", () => {
    const { model } = sample();
    const graph = modulesGraph(model, undefined, false);
    expect([...matchNodes(graph, "cal01")!]).toEqual([0, 1]);
    expect([...matchNodes(graph, "VOLUMES")!]).toEqual([1, 0]);
    expect([...matchNodes(graph, "zzz")!]).toEqual([0, 0]);
    expect(matchNodes(graph, "  ")).toBeUndefined();
  });
});
