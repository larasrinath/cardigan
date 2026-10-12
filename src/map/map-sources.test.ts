import { describe, expect, it } from "vitest";
import type { ImportLoad } from "./graph-types.js";
import { GraphMaker, HALF_EM } from "./map-fakes.test-support.js";
import { sourcesGraph } from "./map-graphs.js";
import { layoutGraph, sizeNodes } from "./map-layout.js";
import { indexModel, type MapModel } from "./map-model.js";
import { importedBy, kindWords, propertiesLine, traceable, traceSources, type SourceTrace } from "./map-sources.js";

// Made-up names only: nothing here comes from a real model. No line item is named for what it is to the trace: an input
// is found by having no formula, never by its name.

/** A trace's inputs as the list says them: line item, module, kind, steps and the line item it feeds. */
const rows = (trace: SourceTrace | undefined): string[][] =>
  (trace?.inputs ?? []).map(input => [input.node.name, input.module?.name ?? "", kindWords(input), String(input.steps), input.feeds.name]);
const names = (model: MapModel, ids: readonly number[]): string[] => ids.map(id => model.node(id)!.name);
const links = (model: MapModel, trace: SourceTrace | undefined): string[] => (trace?.links ?? []).map(([from, to]) => `${model.node(from)!.name} > ${model.node(to)!.name}`);

/** Net Revenue, in REV01 Revenue, is Gross Revenue less Discount Amount: Gross Revenue is Planned Units of VOL01 Volumes
 * times List Price of PRC01 Prices, and Discount Amount is Gross Revenue times Discount Rate of DSC01 Discounts. Fee is a
 * constant that feeds it too, Products is a list its formula names, and Can Edit drives who may write it. */
function revenueModel() {
  const make = new GraphMaker();
  const prices = make.module("PRC01 Prices", "Data");
  const volumes = make.module("VOL01 Volumes", "Data");
  const discounts = make.module("DSC01 Discounts", "Data");
  const revenue = make.module("REV01 Revenue", "Calculations");
  const products = make.list("Products");
  const price = make.item(prices, "List Price");
  const spare = make.item(prices, "Old Price");
  const units = make.item(volumes, "Planned Units");
  const canEdit = make.item(volumes, "Can Edit", { format: "BOOLEAN" });
  const rate = make.item(discounts, "Discount Rate");
  const gross = make.item(revenue, "Gross Revenue", { formula: "'VOL01 Volumes'.Planned Units * 'PRC01 Prices'.List Price * ITEM(Products)" });
  const discount = make.item(revenue, "Discount Amount", { formula: "Gross Revenue * 'DSC01 Discounts'.Discount Rate" });
  const fee = make.item(revenue, "Fee", { formula: "10" });
  const net = make.item(revenue, "Net Revenue", { formula: "Gross Revenue - Discount Amount - Fee" });
  make.link(units, gross).link(price, gross).link(products, gross, "list_formula").link(gross, discount).link(rate, discount).link(gross, net).link(discount, net).link(fee, net)
    .link(canEdit, net, "write_access").link(spare, spare);
  const model = indexModel(make.graph());
  return { make, model, prices, volumes, discounts, revenue, price, units, rate, gross, discount, fee, net, canEdit, spare };
}

describe("The source inputs of a line item", () => {
  it("finds three inputs in three modules through two calculations, each with its module, kind, steps and what it feeds", () => {
    const { model, net, gross, discount } = revenueModel();
    const trace = traceSources(model, net);
    expect(rows(trace)).toEqual([
      ["Discount Rate", "DSC01 Discounts", "Entered", "2", "Discount Amount"],
      ["List Price", "PRC01 Prices", "Entered", "2", "Gross Revenue"],
      ["Planned Units", "VOL01 Volumes", "Entered", "2", "Gross Revenue"]]);
    // The calculations on the ways from them: not Fee, which no input feeds, nor the list its formula names, nor the
    // driver of who may write it.
    expect([trace!.input, names(model, trace!.between.map(node => node.id)), trace!.properties]).toEqual([false, ["Gross Revenue", "Discount Amount"], []]);
    expect(links(model, trace)).toEqual(["List Price > Gross Revenue", "Planned Units > Gross Revenue", "Discount Rate > Discount Amount", "Gross Revenue > Discount Amount",
      "Gross Revenue > Net Revenue", "Discount Amount > Net Revenue"]);
    // A calculation on the way has its own inputs: some of the same.
    expect(rows(traceSources(model, discount)).map(row => [row[0], row[3], row[4]])).toEqual([["Discount Rate", "1", "Discount Amount"], ["List Price", "2", "Gross Revenue"],
      ["Planned Units", "2", "Gross Revenue"]]);
    expect(rows(traceSources(model, gross)).map(row => row[0])).toEqual(["List Price", "Planned Units"]);
  });

  it("says a line item without a formula is an input itself, and traces nothing for a heading, a module or a list", () => {
    const { make, model, units, revenue } = revenueModel();
    expect(traceSources(model, units)).toEqual({ result: model.node(units), module: model.node(model.moduleOf(model.node(units))), input: true, inputs: [], between: [], links: [], properties: [] });
    const heading = make.item(revenue, "--- Workings ---", { format: "NONE" });
    const remade = indexModel(make.graph());
    expect([traceSources(remade, heading), traceSources(remade, revenue), traceable(remade, remade.node(heading)), traceable(remade, remade.node(units))]).toEqual([undefined, undefined, false, true]);
  });

  it("takes a mapping or lookup line item of a [SUM: ...] or [LOOKUP: ...] for an input, as the graph links it", () => {
    const make = new GraphMaker();
    const volumes = make.module("VOL01 Volumes");
    const mappings = make.module("MAP01 Mappings");
    const report = make.module("REP01 Brand Report");
    const units = make.item(volumes, "Units");
    const brandOf = make.item(mappings, "Product to Brand", { format: "ENTITY" });
    const regionOf = make.item(mappings, "Brand to Region", { format: "ENTITY" });
    const byBrand = make.item(report, "Units by Brand", { formula: "'VOL01 Volumes'.Units[SUM: 'MAP01 Mappings'.Product to Brand]" });
    const byRegion = make.item(report, "Units by Region", { formula: "Units by Brand[LOOKUP: 'MAP01 Mappings'.Brand to Region]" });
    make.link(units, byBrand).link(brandOf, byBrand).link(byBrand, byRegion).link(regionOf, byRegion);
    const model = indexModel(make.graph());
    expect(rows(traceSources(model, byRegion))).toEqual([["Brand to Region", "MAP01 Mappings", "Entered", "1", "Units by Region"],
      ["Product to Brand", "MAP01 Mappings", "Entered", "2", "Units by Brand"], ["Units", "VOL01 Volumes", "Entered", "2", "Units by Brand"]]);
  });

  it("counts a summary's children as what feeds it: the summary is a calculation without a formula, and they may be inputs or calculations", () => {
    const make = new GraphMaker();
    const costs = make.module("CST01 Costs");
    const volumes = make.module("VOL01 Volumes");
    const units = make.item(volumes, "Units");
    const total = make.item(costs, "Total Costs", { isSummary: true });
    const rent = make.item(costs, "Rent");
    const hours = make.item(costs, "Hours");
    const pay = make.item(costs, "Pay Rate");
    const wages = make.item(costs, "Wages", { formula: "Hours * Pay Rate" });
    const perUnit = make.item(costs, "Cost per Unit", { formula: "Total Costs / 'VOL01 Volumes'.Units" });
    make.nodes[rent].summaryParent = total;
    make.nodes[wages].summaryParent = total;
    make.link(hours, wages).link(pay, wages).link(total, perUnit).link(units, perUnit);
    const model = indexModel(make.graph());
    const trace = traceSources(model, perUnit);
    expect(rows(trace)).toEqual([["Units", "VOL01 Volumes", "Entered", "1", "Cost per Unit"], ["Rent", "CST01 Costs", "Entered", "2", "Total Costs"],
      ["Hours", "CST01 Costs", "Entered", "3", "Wages"], ["Pay Rate", "CST01 Costs", "Entered", "3", "Wages"]]);
    expect(names(model, trace!.between.map(node => node.id))).toEqual(["Total Costs", "Wages"]);
    expect(links(model, trace)).toContain("Rent > Total Costs");
    // The summary traced itself is no input, though it has no formula. So is one that only its children make a summary.
    expect(rows(traceSources(model, total)).map(row => row[0])).toEqual(["Rent", "Hours", "Pay Rate"]);
    make.nodes[total].isSummary = undefined;
    expect(traceSources(indexModel(make.graph()), total)?.input).toBe(false);
  });

  it("counts the two line items of a Ratio summary as what feeds it, its module's first, then the one line item of the model of that name", () => {
    const make = new GraphMaker();
    const margin = make.module("MAR01 Margin");
    const volumes = make.module("VOL01 Volumes");
    const base = make.item(margin, "Base Price");
    const revenue = make.item(margin, "Revenue");
    make.item(volumes, "Revenue");
    const units = make.item(volumes, "Units");
    // Its formula reads Base Price alone: its numerator and its denominator are found by their names.
    const average = make.item(margin, "Average Price", { formula: "Base Price", summary: "RATIO", ratioNumerator: "Revenue", ratioDenominator: "Units" });
    make.link(base, average);
    const model = indexModel(make.graph());
    expect(rows(traceSources(model, average))).toEqual([["Base Price", "MAR01 Margin", "Entered", "1", "Average Price"], ["Revenue", "MAR01 Margin", "Entered", "1", "Average Price"],
      ["Units", "VOL01 Volumes", "Entered", "1", "Average Price"]]);
    expect(model.node(revenue)!.module).toBe(margin);
  });

  it("walks on through a list property with a formula, and names one without in a line of its own, never listing it", () => {
    const make = new GraphMaker();
    const rates = make.module("RAT01 Rates");
    const shipping = make.module("SHP01 Shipping");
    const regionsModule = make.module("Regions");
    const products = make.list("Products");
    const regions = make.list("Regions");
    const bandRate = make.item(rates, "Band Rate");
    const band = make.property(products, "Price Band", "NUMBER");
    const weight = make.property(products, "Weight", "NUMBER");
    const colour = make.property(products, "Colour");
    make.property(regions, "Rate", "NUMBER");
    const regionRate = make.item(regionsModule, "Rate");
    // Regions.Rate is the module's line item: the graph links it. Products.Weight and Products.Price Band are the list's
    // properties; Colour is in a text in quotes, which names nothing.
    const cost = make.item(shipping, "Shipping Cost", { formula: "Products.Weight * Regions.Rate + 'Products'.'Price Band' & \"Products.Colour\"" });
    make.link(bandRate, band).link(products, band, "list_formula").link(products, cost, "list_formula").link(regionRate, cost);
    const model = indexModel(make.graph());
    const trace = traceSources(model, cost);
    // The first line item after Band Rate on its way is the line item traced: the property between is passed over.
    expect(rows(trace)).toEqual([["Rate", "Regions", "Entered", "1", "Shipping Cost"], ["Band Rate", "RAT01 Rates", "Entered", "2", "Shipping Cost"]]);
    expect([names(model, trace!.between.map(node => node.id)), trace!.properties.map(node => node.id), links(model, trace)])
      .toEqual([["Price Band"], [weight], ["Band Rate > Price Band", "Price Band > Shipping Cost", "Rate > Shipping Cost"]]);
    expect([propertiesLine(model, trace!.properties), propertiesLine(model, [])]).toEqual(["It also reads 1 list property: Products.Weight.", undefined]);
    expect(trace!.properties.map(node => node.id)).not.toContain(colour);
    const many = Array.from({ length: 7 }, (_, index) => make.property(products, `Extra ${index}`, "NUMBER"));
    expect(propertiesLine(indexModel(make.graph()), many.map(id => make.nodes[id])))
      .toBe("It also reads 7 list properties: Products.Extra 0, Products.Extra 1, Products.Extra 2, Products.Extra 3, Products.Extra 4 and 2 more.");
  });

  it("ends a PREVIOUS that reads its own line item, and a circle, and never takes the line item traced for its own input", () => {
    const make = new GraphMaker();
    const stock = make.module("STK01 Stock");
    const receipts = make.item(stock, "Receipts");
    const shipments = make.item(stock, "Shipments");
    const closing = make.item(stock, "Closing Stock", { formula: "PREVIOUS(Closing Stock) + Receipts - Shipments" });
    make.link(closing, closing).link(receipts, closing).link(shipments, closing);
    // Opening and Moved read each other, and Moved reads the line item traced: a circle through it.
    const opening = make.item(stock, "Opening", { formula: "PREVIOUS(Moved)" });
    const moved = make.item(stock, "Moved", { formula: "Opening + Adjustment + PREVIOUS(Cover)" });
    const adjustment = make.item(stock, "Adjustment");
    const cover = make.item(stock, "Cover", { formula: "Opening / 4" });
    make.link(moved, opening).link(opening, moved).link(adjustment, moved).link(cover, moved).link(opening, cover);
    const model = indexModel(make.graph());
    const own = traceSources(model, closing);
    expect([rows(own).map(row => row[0]), links(model, own)]).toEqual([["Receipts", "Shipments"], ["Receipts > Closing Stock", "Shipments > Closing Stock"]]);
    const circle = traceSources(model, cover);
    expect([rows(circle), names(model, circle!.between.map(node => node.id)), links(model, circle)]).toEqual([[["Adjustment", "STK01 Stock", "Entered", "3", "Moved"]],
      ["Opening", "Moved"], ["Opening > Moved", "Opening > Cover", "Moved > Opening", "Adjustment > Moved"]]);
  });

  it("labels an input an import loads with the import, by what its mapping names or any line item it can load", () => {
    const { model, net, price } = revenueModel();
    const loads: ImportLoad[] = [
      { name: "Load volumes", module: "VOL01 Volumes", lineItems: ["Products", "Planned Units"], any: false, unread: false },
      { name: "Load prices", module: " PRC01 Prices ", lineItems: [], any: true, unread: true },
      { name: "Copy prices", module: "PRC01 Prices", lineItems: ["List Price", "Gone"], any: false, unread: false },
      { name: "Into nothing", module: "Nowhere", lineItems: ["List Price"], any: true, unread: false },
    ];
    const imported = importedBy(model, loads);
    expect(rows(traceSources(model, net, imported)).map(row => [row[0], row[2]])).toEqual([["Discount Rate", "Entered"],
      ["List Price", "Imported by Copy prices; may be imported by Load prices"], ["Planned Units", "Imported by Load volumes"]]);
    // Any line item it can load holds data and has no formula; a calculation is loaded by name alone.
    expect([...imported.keys()].map(id => model.node(id)!.name).sort()).toEqual(["List Price", "Old Price", "Planned Units"]);
    expect(imported.get(price)).toEqual({ sure: ["Copy prices"], maybe: ["Load prices"] });
    expect([kindWords({ imports: ["A", "B", "C"] }), kindWords({ imports: [], mayImport: ["D"] }), kindWords({ imports: [], mayImport: [] }), importedBy(model, undefined).size])
      .toEqual(["Imported by A, B and C", "May be imported by D", "Entered", 0]);
  });

  it("lists no heading, even one linked as what feeds the line item traced", () => {
    const { make, model: before, revenue, net } = revenueModel();
    const heading = make.item(revenue, "--- Inputs ---", { format: "NONE" });
    make.link(heading, net);
    const model = indexModel(make.graph());
    const trace = traceSources(model, net);
    expect([rows(trace).map(row => row[0]), trace!.between.map(node => node.id)]).toEqual([rows(traceSources(before, net)).map(row => row[0]), traceSources(before, net)!.between.map(node => node.id)]);
  });

  it("counts the fewest links to each input, and names the first line item after it on one of its shortest ways", () => {
    const make = new GraphMaker();
    const plan = make.module("PLN01 Plan");
    const direct = make.item(plan, "Direct");
    const deep = make.item(plan, "Deep");
    const first = make.item(plan, "First Step", { formula: "Deep + Direct" });
    const second = make.item(plan, "Second Step", { formula: "First Step * 2" });
    const result = make.item(plan, "Result", { formula: "Second Step + Direct" });
    make.link(deep, first).link(direct, first).link(first, second).link(second, result).link(direct, result);
    const model = indexModel(make.graph());
    expect(rows(traceSources(model, result)).map(row => [row[0], row[3], row[4]])).toEqual([["Direct", "1", "Result"], ["Deep", "3", "First Step"]]);
  });

  it("lays their map out from the inputs at the left to the line item at the right, by depth, however small that makes it", () => {
    const { model, net } = revenueModel();
    const graph = sourcesGraph(model, traceSources(model, net)!);
    sizeNodes(graph, HALF_EM, HALF_EM);
    // A room too small for the ranks to be read whole keeps them all the same: the depth is what this map shows.
    expect(layoutGraph(graph, [{ width: 300, height: 200 }])).toBe("ranked");
    const x = (name: string): number => graph.nodes.find(node => node.fullName === name)!.x;
    expect([x("Discount Rate"), x("List Price")]).toEqual([x("Planned Units"), x("Planned Units")]);
    expect(x("Planned Units") < x("Gross Revenue") && x("Gross Revenue") < x("Discount Amount") && x("Discount Amount") < x("Net Revenue")).toBe(true);
  });
});
