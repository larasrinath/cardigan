import { describe, expect, it } from "vitest";
import type { SavedViewFilter, ViewFilterCheck } from "./graph-types.js";
import { moduleGraph, modulesGraph, sectionsGraph, type ViewGraph, type ViewNode } from "./map-graphs.js";
import { filterTipLines, inspect } from "./map-inspect.js";
import { indexModel, isAccess, isFilter, isFormula } from "./map-model.js";
import { traceNode } from "./map-trace.js";
import { viewFilterCheckLine, withSavedViewFilters } from "./map-view-filters.js";
import { GraphMaker, viewFilter, viewFilteredModel } from "./map-fakes.test-support.js";

const byName = (graph: ViewGraph, name: string): ViewNode => graph.nodes.find(node => node.fullName === name)!;
const at = (graph: ViewGraph, name: string): number => graph.nodes.findIndex(node => node.fullName === name);
const names = (graph: ViewGraph, places: ReadonlySet<number>): string[] => [...places].map(place => graph.nodes[place].fullName).sort();
/** The links of a graph that are filters', as "from > to: how many links each counts". */
const filterLinks = (graph: ViewGraph): string[] => graph.edges.filter(edge => edge.filter).map(edge => `${graph.nodes[edge.s].fullName} > ${graph.nodes[edge.t].fullName}: ${edge.w}`).sort();

/** The model of both kinds of filters, with the saved views' filters the page gives the map. */
function both() {
  const data = viewFilteredModel();
  const graph = withSavedViewFilters(data.graph, data.savedViewFilters);
  return { ...data, viewed: graph, model: indexModel(graph) };
}

describe("Saved views' filters on the map's graph", () => {
  it("links a filter's line item to its saved view's module, once for several saved views, and to no module of its own", () => {
    const { viewed, show, late, mine, rep, ord } = both();
    expect(viewed.edges.filter(([, , kind]) => kind === "view_filter")).toEqual([[show, rep, "view_filter"], [late, ord, "view_filter"]]);
    // Each line item keeps its saved views, each with its module, and whether its filter is on and valid.
    expect([viewed.nodes[show].viewFilters, viewed.nodes[late].viewFilters, viewed.nodes[mine].viewFilters]).toEqual([
      [{ view: "Open lines", module: rep, active: true, valid: true }, { view: "Closed lines", module: rep, active: false, valid: true }],
      [{ view: "Late", module: ord, active: true, valid: false }],
      [{ view: "Mine", module: rep, active: true, valid: true }]]);
    // A saved view of its own module is no link between two modules.
    expect(viewed.edges.some(([from]) => from === mine)).toBe(false);
  });

  it("counts what it made of the conditions: those on the map, on their own module or another, off or not valid, and those it leaves out, by name", () => {
    const { viewed } = both();
    expect(viewed.viewFilterCheck).toEqual({ conditions: 6, found: 4, own: 1, other: 3, off: 1, invalid: 1, noLineItem: 1, noModule: 1,
      missingLineItems: ["FLT01 - Filters · Gone?"], missingModules: ["ARC01 - Archive"] } satisfies ViewFilterCheck);
    // A line item the map does not have, and a saved view's module it does not have, are no link and no saved view of
    // a line item.
    expect(viewed.nodes.flatMap(node => node.viewFilters ?? []).map(view => view.view)).toEqual(["Open lines", "Closed lines", "Late", "Mine"]);
  });

  it("leaves the graph given as it was: every node in its place, the others the same objects, the links in their fixed order", () => {
    const { graph, savedViewFilters, show, units } = viewFilteredModel();
    const before = JSON.stringify(graph);
    const viewed = withSavedViewFilters(graph, savedViewFilters);
    expect(JSON.stringify(graph)).toBe(before);
    expect(viewed.nodes.map(node => node.id)).toEqual(graph.nodes.map(node => node.id));
    expect([viewed.nodes[units] === graph.nodes[units], viewed.nodes[show] === graph.nodes[show], graph.nodes[show].viewFilters]).toEqual([true, false, undefined]);
    const order = (a: readonly [number, number, string], b: readonly [number, number, string]): number => a[0] - b[0] || a[1] - b[1] || a[2].localeCompare(b[2]);
    expect(viewed.edges).toEqual([...viewed.edges].sort(order));
    expect(viewed.edges.filter(([, , kind]) => kind !== "view_filter")).toEqual(graph.edges);
  });

  it("is the graph given, itself, without saved views' filters; with none, it says the saved views have none and changes nothing else", () => {
    const { graph } = viewFilteredModel();
    expect(withSavedViewFilters(graph, undefined)).toBe(graph);
    const none = withSavedViewFilters(graph, []);
    expect([none.edges, none.nodes.every((node, index) => node === graph.nodes[index]), none.viewFilterCheck?.conditions]).toEqual([graph.edges, true, 0]);
  });

  it("names a saved view once for its line item however many of its conditions name it: on where one of them is, valid where all are", () => {
    const { graph, show, rep } = viewFilteredModel();
    const viewed = withSavedViewFilters(graph, [viewFilter("Open lines", "REP01 - Report", "FLT01 - Filters", "Show?", { active: false }),
      viewFilter("Open lines", "REP01 - Report", "FLT01 - Filters", "Show?", { axis: "Columns", valid: false })]);
    expect(viewed.nodes[show].viewFilters).toEqual([{ view: "Open lines", module: rep, active: true, valid: false }]);
    expect(viewed.edges.filter(([, , kind]) => kind === "view_filter")).toEqual([[show, rep, "view_filter"]]);
    expect([viewed.viewFilterCheck?.conditions, viewed.viewFilterCheck?.off, viewed.viewFilterCheck?.invalid]).toEqual([2, 1, 1]);
  });

  it("finds a module and a line item by their names as the page filters' rows are found: with spaces at their ends, or a run of spaces made one", () => {
    const make = new GraphMaker();
    const plan = make.module("PLN01  Plan", "01: Planning");
    const flag = make.item(make.module("REF01 Reference ", "01: Planning"), " Ready?", { format: "BOOLEAN" });
    const viewed = withSavedViewFilters(make.graph(), [viewFilter("Ready", "PLN01 Plan", "REF01 Reference", "Ready?")]);
    expect([viewed.edges, viewed.viewFilterCheck?.found]).toEqual([[[flag, plan, "view_filter"]], 1]);
  });

  it("takes what is no condition for none, a name that is no text for none, and anything but false for on and valid", () => {
    const { graph, show, rep } = viewFilteredModel();
    const odd = [null, "Open lines", { view: "Loose", module: "REP01 - Report", lineItem: "Show?", lineItemModule: "FLT01 - Filters" },
      { view: "Numbered", module: 7, lineItem: "Show?", lineItemModule: "FLT01 - Filters" }] as unknown as SavedViewFilter[];
    const viewed = withSavedViewFilters(graph, odd);
    expect([viewed.nodes[show].viewFilters, viewed.viewFilterCheck?.conditions, viewed.viewFilterCheck?.missingModules]).toEqual([
      [{ view: "Loose", module: rep, active: true, valid: true }], 2, ["-"]]);
  });
});

describe("The run's log line for saved views' filters", () => {
  it("says in one line how they met the map, in the words of the page filters' line, its names cut to the first five", () => {
    const { viewed } = both();
    expect(viewFilterCheckLine(viewed.viewFilterCheck!)).toBe("Saved view filters: 6 conditions; 4 with the line item and the saved view's module on the map "
      + "(1 on the line item's own module, 3 on another module; 1 off, 1 not valid); 1 with a line item the map does not have: FLT01 - Filters · Gone?; "
      + "1 with a saved view's module the map does not have: ARC01 - Archive.");
    const empty: ViewFilterCheck = { conditions: 0, found: 0, own: 0, other: 0, off: 0, invalid: 0, noLineItem: 0, noModule: 0, missingLineItems: [], missingModules: [] };
    expect(viewFilterCheckLine(empty)).toBe("Saved view filters: 0 conditions; 0 with the line item and the saved view's module on the map; 0 with a line item the map does not have; "
      + "0 with a saved view's module the map does not have.");
    const missing = Array.from({ length: 7 }, (_, index) => `Module ${index + 1} · Line ${index + 1}`);
    expect(viewFilterCheckLine({ ...empty, conditions: 1, found: 1, other: 1, noLineItem: 7, missingLineItems: missing })).toBe("Saved view filters: 1 condition; 1 with the line item "
      + "and the saved view's module on the map (0 on the line item's own module, 1 on another module); 7 with a line item the map does not have: Module 1 · Line 1; Module 2 · Line 2; "
      + "Module 3 · Line 3; Module 4 · Line 4; Module 5 · Line 5; and 2 more; 0 with a saved view's module the map does not have.");
  });
});

describe("Saved views' filters in the model the map looks up", () => {
  it("are filters' links, as the page cards' are: no formula's and no access driver's", () => {
    expect([isFilter("view_filter"), isFilter("page_filter"), isFormula("view_filter"), isAccess("view_filter")]).toEqual([true, true, false, false]);
    const { model, show, late, rep, ord } = both();
    expect(model.filterEdges).toEqual([[show, rep, "page_filter"], [show, rep, "view_filter"], [late, ord, "view_filter"]]);
    expect([model.formulaEdges.length, model.accessEdges.length, model.filtersBetween]).toEqual([1, 0, 3]);
    expect([model.outgoing(late), model.incoming(ord)]).toEqual([[[late, ord, "view_filter"]], [[late, ord, "view_filter"]]]);
  });

  it("lists each line item once among a module's filters, with both kinds, and counts and marks a module that its own line item filters in a saved view", () => {
    const { model, show, late, mine, rep, ord, total } = both();
    const filters = (module: number): [string, string[], string[]][] => model.filtersOf(module).map(({ item, uses, views }) => [item.name, uses.map(use => use.card), (views ?? []).map(view => view.view)]);
    expect([filters(rep), filters(ord)]).toEqual([[["Show?", ["2"], ["Open lines", "Closed lines"]], ["Is Mine", [], ["Mine"]]], [["Late?", [], ["Late"]]]]);
    expect([model.ownFiltersOf(rep), model.ownFiltersOf(ord), model.ownFiltered]).toEqual([1, 0, 1]);
    expect([model.filtersItself(mine), model.filtersItself(show), model.filtersItself(late)]).toEqual([true, false, false]);
    // A saved view filters its whole module, and no line item of it on its own.
    expect(model.filtersOfItem(total)).toEqual([]);
  });

  it("is as it was without saved views' filters", () => {
    const { graph, rep, show, mine } = viewFilteredModel();
    const model = indexModel(withSavedViewFilters(graph, undefined));
    expect(model.filtersOf(rep)).toEqual([{ item: graph.nodes[show], uses: graph.nodes[show].pageFilters }]);
    expect(model.filtersItself(mine)).toBe(false);
    expect([model.filterEdges.length, model.ownFiltered, model.filtersBetween]).toEqual([1, 0, 1]);
  });
});

describe("Saved views' filters in the graphs the map draws", () => {
  it("draw one dashed link from a filter's module to each module it filters, whatever its kinds, and mark a module its own line item filters", () => {
    const { model } = both();
    const modules = modulesGraph(model, undefined, false, true);
    expect(filterLinks(modules)).toEqual(["FLT01 - Filters > ORD01 - Orders: 1", "FLT01 - Filters > REP01 - Report: 1"]);
    expect([byName(modules, "REP01 - Report").filterMark, byName(modules, "ORD01 - Orders").filterMark, byName(modules, "FLT01 - Filters").filterMark]).toEqual([1, undefined, undefined]);
    // Where filters are not drawn, neither are their links nor their marks.
    const plain = modulesGraph(model, undefined, false);
    expect([filterLinks(plain), byName(plain, "REP01 - Report").filterMark]).toEqual([[], undefined]);
    // Between groups, and on a group whose module its own line item filters.
    const sections = sectionsGraph(model, false, true);
    expect([filterLinks(sections), byName(sections, "02: Reporting").filterMark]).toEqual([["00: Inputs > 01: Data: 1", "00: Inputs > 02: Reporting: 1"], 1]);
  });

  it("draw a line item's link to the module its saved view filters among its module's line items, and mark one that filters its own module", () => {
    const { model, flt, rep } = both();
    const own = moduleGraph(model, flt, true, false, true);
    // Show?'s filter on a page card and its saved views' filters of REP01 are one link, which counts them both.
    expect(filterLinks(own)).toEqual(["Late? > ORD01 - Orders: 1", "Show? > REP01 - Report: 2"]);
    expect(own.edges.find(edge => edge.filter && own.nodes[edge.s].fullName === "Show?")?.refs?.map(([, , kind]) => kind)).toEqual(["page_filter", "view_filter"]);
    const report = moduleGraph(model, rep, true, false, true);
    expect([byName(report, "Is Mine").filterMark, byName(report, "Total").filterMark]).toEqual([1, undefined]);
    expect(byName(moduleGraph(model, rep, true, false, false), "Is Mine").filterMark).toBeUndefined();
  });
});

describe("The trace of saved views' filters", () => {
  it("follows a saved view filter's link as it follows a page filter's: only while filters are drawn", () => {
    const { model, flt } = both();
    const plain = modulesGraph(model, undefined, false);
    const drawn = modulesGraph(model, undefined, false, true);
    expect(names(plain, traceNode(plain, model, at(plain, "FLT01 - Filters"), false).down)).toEqual([]);
    expect(names(drawn, traceNode(drawn, model, at(drawn, "FLT01 - Filters"), false, true).down)).toEqual(["ORD01 - Orders", "REP01 - Report"]);
    expect(names(drawn, traceNode(drawn, model, at(drawn, "ORD01 - Orders"), false, true).up)).toEqual(["FLT01 - Filters"]);
    const own = moduleGraph(model, flt, true, false, true);
    expect(names(own, traceNode(own, model, at(own, "Late?"), false, true).down)).toEqual(["ORD01 - Orders"]);
    expect(names(own, traceNode(own, model, at(own, "Late?"), false, false).down)).toEqual([]);
  });
});

describe("What the details say of saved views' filters", () => {
  it("list the saved views a line item filters beside its filters on page cards, as Saved view: view (module), with off and not valid where so", () => {
    const { model, flt } = both();
    const own = moduleGraph(model, flt, true, false, true);
    const show = inspect(model, own, byName(own, "Show?"), false);
    expect(show.texts.find(text => text.key === "pageFilters")).toEqual({ key: "pageFilters", title: "Filters · 3", lines: [
      "REP01 - Report · Sales · Review · Card 2 · line items not known", "Saved view: Open lines (REP01 - Report)", "Saved view: Closed lines (REP01 - Report) · off"] });
    const modules = show.lists.find(list => list.key === "filters");
    expect([modules?.title, modules?.links.map(link => [link.name, link.caption])]).toEqual(["Modules it filters · 1", [
      ["REP01 - Report", "Sales · Review · Card 2 · 2 saved views: Open lines, Closed lines (off)"]]]);
    const late = inspect(model, own, byName(own, "Late?"), false);
    expect([late.texts.find(text => text.key === "pageFilters"), late.lists.find(list => list.key === "filters")?.links.map(link => [link.name, link.caption])]).toEqual([
      { key: "pageFilters", title: "Filters · 1", lines: ["Saved view: Late (ORD01 - Orders) · not valid"] }, [["ORD01 - Orders", "Saved view: Late (not valid)"]]]);
  });

  it("list in a module's details the line items whose filters filter it, each once, with the saved views of it they filter", () => {
    const { model, show, mine, late } = both();
    const modules = modulesGraph(model, undefined, false, true);
    const by = (module: string) => inspect(model, modules, byName(modules, module), false).lists.find(list => list.key === "filteredBy");
    const report = by("REP01 - Report");
    expect([report?.title, report?.links.map(link => [link.raw, link.name, link.sub, link.caption])]).toEqual(["Filtered by · 2", [
      [show, "Show?", "FLT01 - Filters", "Sales · Review · Card 2 · 2 saved views: Open lines, Closed lines (off)"], [mine, "Is Mine", "REP01 - Report", "Saved view: Mine"]]]);
    expect(by("ORD01 - Orders")?.links.map(link => [link.raw, link.caption])).toEqual([[late, "Saved view: Late (not valid)"]]);
    expect(by("FLT01 - Filters")).toBeUndefined();
  });

  it("say in the hover card where a line item filters, on a page card first, then in a saved view", () => {
    const { model, show, late, mine, total } = both();
    expect([filterTipLines(model, model.node(show)!), filterTipLines(model, model.node(late)!), filterTipLines(model, model.node(mine)!), filterTipLines(model, model.node(total)!)]).toEqual([
      ["Filter on Sales · Review · Card 2, and 2 more"], ["Filter in saved view Late (ORD01 - Orders)"], ["Filter in saved view Mine (REP01 - Report)"], []]);
  });

  it("make one link of two saved views with the same filter, and count them: 2 under the line item's filters, both named under the module", () => {
    const { graph, late, ord } = viewFilteredModel();
    const viewed = withSavedViewFilters(graph, [viewFilter("Late", "ORD01 - Orders", "FLT01 - Filters", "Late?"), viewFilter("Overdue", "ORD01 - Orders", "FLT01 - Filters", "Late?")]);
    expect(viewed.edges.filter(([, , kind]) => kind === "view_filter")).toEqual([[late, ord, "view_filter"]]);
    const model = indexModel(viewed);
    const modules = modulesGraph(model, undefined, false, true);
    expect(filterLinks(modules)).toEqual(["FLT01 - Filters > ORD01 - Orders: 1", "FLT01 - Filters > REP01 - Report: 1"]);
    const own = moduleGraph(model, model.node(late)!.module!, true, false, true);
    expect(inspect(model, own, byName(own, "Late?"), false).texts.find(text => text.key === "pageFilters")).toEqual({ key: "pageFilters", title: "Filters · 2",
      lines: ["Saved view: Late (ORD01 - Orders)", "Saved view: Overdue (ORD01 - Orders)"] });
    expect(inspect(model, modules, byName(modules, "ORD01 - Orders"), false).lists.find(list => list.key === "filteredBy")?.links.map(link => link.caption))
      .toEqual(["2 saved views: Late, Overdue"]);
  });

  it("count a line item's filters of both kinds past the first ten, which the tables of filters list whole", () => {
    const { graph, show } = viewFilteredModel();
    const views = Array.from({ length: 11 }, (_, index) => viewFilter(`View ${index + 1}`, "REP01 - Report", "FLT01 - Filters", "Show?"));
    const model = indexModel(withSavedViewFilters(graph, views));
    const own = moduleGraph(model, model.node(show)!.module!, true, false, true);
    const text = inspect(model, own, byName(own, "Show?"), false).texts.find(each => each.key === "pageFilters");
    expect([text?.title, text?.lines.length, text?.lines[0], text?.lines[9], text?.lines.at(-1)]).toEqual(["Filters · 12", 11,
      "REP01 - Report · Sales · Review · Card 2 · line items not known", "Saved view: View 9 (REP01 - Report)", "And 2 more: the tables of filters list them all."]);
  });
});
