import { describe, expect, it } from "vitest";
import { moduleGraph, modulesGraph, sectionsGraph, type ViewGraph } from "./map-graphs.js";
import { indexModel } from "./map-model.js";
import { inTrace, traceNode } from "./map-trace.js";
import { GraphMaker } from "./map.test-support.js";

const names = (graph: ViewGraph, places: ReadonlySet<number>): string[] => [...places].map(place => graph.nodes[place].fullName).sort();
const place = (graph: ViewGraph, name: string): number => graph.nodes.findIndex(node => node.fullName === name);
/** The graph's links that the trace marks, as "from > to" with the way they lead: 1 towards the node, 2 away from it. */
const marked = (graph: ViewGraph, edges: Uint8Array): string[] =>
  graph.edges.flatMap((edge, index) => (edges[index] ? [`${graph.nodes[edge.s].fullName} > ${graph.nodes[edge.t].fullName}: ${edges[index]}`] : [])).sort();

/** A chain of five modules with a side branch: A -> B -> C -> D -> E, and X -> C, and C -> Y. */
function chain() {
  const make = new GraphMaker();
  const item = Object.fromEntries(["A", "B", "C", "D", "E", "X", "Y", "Alone"].map(name => [name, make.item(make.module(name, name < "D" ? "01: First" : "02: Second"), "Value")]));
  make.link(item.A, item.B).link(item.B, item.C).link(item.C, item.D).link(item.D, item.E).link(item.X, item.C).link(item.C, item.Y);
  return { model: indexModel(make.graph()), item };
}

describe("The trace of a module or a section", () => {
  it("finds everything that feeds a node and everything it feeds, however far away", () => {
    const { model } = chain();
    const graph = modulesGraph(model, undefined, false);
    const trace = traceNode(graph, model, place(graph, "C"), false);
    expect(trace.selected).toBe(place(graph, "C"));
    expect(names(graph, trace.up)).toEqual(["A", "B", "X"]);
    expect(names(graph, trace.down)).toEqual(["D", "E", "Y"]);
  });

  it("marks the links that lead to the node and those that lead on from it, and no other", () => {
    const { model } = chain();
    const graph = modulesGraph(model, undefined, false);
    expect(marked(graph, traceNode(graph, model, place(graph, "C"), false).edges)).toEqual(["A > B: 1", "B > C: 1", "C > D: 2", "C > Y: 2", "D > E: 2", "X > C: 1"]);
    // From the end of the chain everything is upstream but the side branch that leaves it earlier.
    const fromEnd = traceNode(graph, model, place(graph, "E"), false);
    expect(names(graph, fromEnd.up)).toEqual(["A", "B", "C", "D", "X"]);
    expect(fromEnd.down.size).toBe(0);
    expect(marked(graph, fromEnd.edges)).not.toContain("C > Y: 2");
    expect(marked(graph, fromEnd.edges)).toHaveLength(5);
  });

  it("finds nothing for a node with no link", () => {
    const { model } = chain();
    const graph = modulesGraph(model, undefined, false);
    const trace = traceNode(graph, model, place(graph, "Alone"), false);
    expect([trace.up.size, trace.down.size, marked(graph, trace.edges)]).toEqual([0, 0, []]);
  });

  it("puts a node that is in a circle with the one traced both upstream and downstream, and ends", () => {
    const make = new GraphMaker();
    const [a, b, c] = ["A", "B", "C"].map(name => make.item(make.module(name, "01: All"), "Value"));
    make.link(a, b).link(b, a).link(b, c);
    const model = indexModel(make.graph());
    const graph = modulesGraph(model, undefined, false);
    const trace = traceNode(graph, model, place(graph, "A"), false);
    expect(names(graph, trace.up)).toEqual(["B"]);
    expect(names(graph, trace.down)).toEqual(["B", "C"]);
    // A link in a circle leads towards the node before it leads away from it.
    expect(marked(graph, trace.edges)).toEqual(["A > B: 2", "B > A: 1", "B > C: 2"]);
  });

  it("follows the sections' links in the graph of sections", () => {
    const make = new GraphMaker();
    const [first, second, third] = ["01: First", "02: Second", "03: Third"].map(section => make.item(make.module(`Module of ${section}`, section), "Value"));
    make.link(first, second).link(second, third);
    const model = indexModel(make.graph());
    const graph = sectionsGraph(model, false);
    const trace = traceNode(graph, model, 1, false);
    expect(names(graph, trace.up)).toEqual(["01: First"]);
    expect(names(graph, trace.down)).toEqual(["03: Third"]);
    expect(marked(graph, trace.edges)).toEqual(["01: First > 02: Second: 1", "02: Second > 03: Third: 2"]);
  });

  it("says which nodes a view that keeps to the trace shows", () => {
    const { model } = chain();
    const graph = modulesGraph(model, undefined, false);
    const trace = traceNode(graph, model, place(graph, "C"), false);
    expect(graph.nodes.filter(node => inTrace(trace, node.index)).map(node => node.fullName).sort()).toEqual(["A", "B", "C", "D", "E", "X", "Y"]);
    expect(inTrace(trace, place(graph, "Alone"))).toBe(false);
  });
});

describe("The trace of a line item in its module's graph", () => {
  /** A module in the middle. Outside it, one module holds two line items that have nothing to do with each other: one
   * feeds the middle's First, the other its Second. Further out, a module feeds the first of those, and the middle's
   * Last feeds a module that feeds another. */
  function exact() {
    const make = new GraphMaker();
    const far = make.module("FAR - Far Source", "01: All");
    const source = make.module("SRC - Source", "01: All");
    const middle = make.module("MID - Middle", "01: All");
    const target = make.module("TGT - Target", "01: All");
    const beyond = make.module("BYD - Beyond", "01: All");
    const origin = make.item(far, "Origin");
    const one = make.item(source, "One");
    const two = make.item(source, "Two");
    const first = make.item(middle, "First");
    const second = make.item(middle, "Second");
    const last = make.item(middle, "Last");
    const taken = make.item(target, "Taken");
    const end = make.item(beyond, "End");
    const flag = make.item(far, "Flag", { format: "BOOLEAN" });
    make.link(origin, one).link(one, first).link(two, second).link(first, last).link(last, taken).link(taken, end).link(flag, second, "read_access");
    return { model: indexModel(make.graph()), source, middle, target, first, second, last };
  }

  it("follows the model's links one by one, and does not pass on through a node that stands for a whole module", () => {
    const { model, middle, source, target } = exact();
    const graph = moduleGraph(model, middle, false, false);
    const trace = traceNode(graph, model, place(graph, "Last"), false);
    // First feeds Last, and One of the source module feeds First: that module's node is upstream. Second is not, though
    // the same node also feeds it.
    expect(names(graph, trace.up)).toEqual(["First", "SRC - Source"]);
    expect(names(graph, trace.down)).toEqual(["TGT - Target"]);
    expect(marked(graph, trace.edges)).toEqual(["First > Last: 1", "Last > TGT - Target: 2", "SRC - Source > First: 1"]);
    expect(graph.byId.has(`external${source}`) && graph.byId.has(`external${target}`)).toBe(true);
  });

  it("reaches through the whole model, beyond what is on screen", () => {
    const { model, middle } = exact();
    const graph = moduleGraph(model, middle, false, false);
    // Second reads Two, which nothing feeds. First reads One, which the far module feeds: that module is not on screen,
    // and the trace of First still ends at the source module's node.
    expect(names(graph, traceNode(graph, model, place(graph, "Second"), false).up)).toEqual(["SRC - Source"]);
    expect(names(graph, traceNode(graph, model, place(graph, "First"), false).down)).toEqual(["Last", "TGT - Target"]);
  });

  it("traces a module's node from the line items it stands for", () => {
    const { model, middle } = exact();
    const graph = moduleGraph(model, middle, false, false);
    const trace = traceNode(graph, model, place(graph, "SRC - Source"), false);
    // One feeds First and so Last; Two feeds Second.
    expect(names(graph, trace.down)).toEqual(["First", "Last", "Second", "TGT - Target"]);
    expect(trace.up.size).toBe(0);
    expect(marked(graph, trace.edges)).toEqual(["First > Last: 2", "Last > TGT - Target: 2", "SRC - Source > First: 2", "SRC - Source > Second: 2"]);
  });

  it("counts the links of who may read and write only when they are shown", () => {
    const { model, middle } = exact();
    const plain = moduleGraph(model, middle, false, false);
    expect(names(plain, traceNode(plain, model, place(plain, "Second"), false).up)).toEqual(["SRC - Source"]);
    const withAccess = moduleGraph(model, middle, false, true);
    expect(names(withAccess, traceNode(withAccess, model, place(withAccess, "Second"), true).up)).toEqual(["FAR - Far Source", "SRC - Source"]);
  });

  it("traces line items shown one by one the same way", () => {
    const { model, middle } = exact();
    const graph = moduleGraph(model, middle, true, false);
    const trace = traceNode(graph, model, place(graph, "Last"), false);
    expect(names(graph, trace.up)).toEqual(["First", "One"]);
    expect(names(graph, trace.down)).toEqual(["Taken"]);
  });

  it("does not count a line item that reads itself as feeding itself", () => {
    const make = new GraphMaker();
    const module = make.module("RUN - Running", "01: All");
    const total = make.item(module, "Total");
    const running = make.item(module, "Running Total");
    make.link(total, running).link(running, running);
    const model = indexModel(make.graph());
    const graph = moduleGraph(model, module, false, false);
    const trace = traceNode(graph, model, place(graph, "Running Total"), false);
    expect(names(graph, trace.up)).toEqual(["Total"]);
    expect(trace.down.size).toBe(0);
    expect(marked(graph, trace.edges)).toEqual(["Total > Running Total: 1"]);
  });
});
