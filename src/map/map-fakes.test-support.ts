import type { EdgeKind, GraphEdge, GraphNode, ModelGraph, PageFilter, Unresolved } from "./graph-types.js";
import type { TextMeasure } from "./map-text.js";

/** Graphs made by hand for the map's tests, as build-graph.ts gives them: every node's id is its place, and the links
 * are in a fixed order. Every name in the map's tests is made up. Tests only. */
export class GraphMaker {
  readonly nodes: GraphNode[] = [];
  readonly unresolved: Unresolved[] = [];
  readonly limitations: string[] = [];
  private readonly links = new Map<string, GraphEdge>();
  private readonly sections: string[] = [];
  private rows = 1;

  private add(node: Omit<GraphNode, "id" | "file" | "row"> & { file?: string }): number {
    this.nodes.push({ file: "Line Items", row: ++this.rows, ...node, id: this.nodes.length });
    return this.nodes.length - 1;
  }

  /** A module under a heading; no heading files it under nothing, as a module above the first heading is. */
  module(name: string, group?: string, extra: Partial<GraphNode> = {}): number {
    if (group !== undefined && !this.sections.includes(group)) this.sections.push(group);
    return this.add({ kind: "module", name, ...(group === undefined ? {} : { group }), ...extra });
  }
  item(module: number, name: string, extra: Partial<GraphNode> = {}): number {
    const group = this.nodes[module].group;
    return this.add({ kind: "lineItem", name, module, format: "NUMBER", ...(group === undefined ? {} : { group }), ...extra });
  }
  list(name: string, extra: Partial<GraphNode> = {}): number {
    return this.add({ kind: "list", name, file: "General Lists", ...extra });
  }
  subset(list: number, name: string): number {
    const id = this.add({ kind: "subset", name, file: "General Lists", parent: list });
    this.link(list, id, "subset");
    return id;
  }
  property(list: number, name: string, format = "TEXT"): number {
    return this.add({ kind: "property", name, file: "General Lists", parent: list, format });
  }
  action(name: string, extra: Partial<GraphNode> = {}): number {
    return this.add({ kind: "action", name, file: "Actions", ...extra });
  }
  /** A link from what is read to what reads it; a formula's unless another kind is given. */
  link(from: number, to: number, kind: EdgeKind = "reference"): this {
    this.links.set(`${from}>${to}>${kind}`, [from, to, kind]);
    return this;
  }
  graph(): ModelGraph {
    const edges = [...this.links.values()].sort((a, b) => a[0] - b[0] || a[1] - b[1] || (a[2] < b[2] ? -1 : a[2] > b[2] ? 1 : 0));
    return { nodes: this.nodes, edges, unresolved: this.unresolved, sections: [...this.sections], limitations: this.limitations };
  }
}

/** A measure for tests: every character is half an em wide, a space a quarter, the mark for what was cut half an em. */
export const HALF_EM: TextMeasure = { word: text => [...text].length * 0.5, char: () => 0.5, space: 0.25, ellipsis: 0.5 };

/** What an Anaplan user can type into a name, a note or a formula, and what would be markup if it were written as such. */
export const HOSTILE = [
  "<img src=x onerror=alert(1)>",
  "Bob's \"<b>Q4</b>\" plan",
  "<script>alert(document.cookie)</script>",
  "\" onmouseover=\"alert(1)\" data-map-act=\"",
  "' onfocus='alert(1)' autofocus x='",
  "&lt;b&gt; &amp;amp; &quot;",
  "</button></details></div><iframe src=//evil.example></iframe><!-- ",
] as const;

/** What a pen did, with the styles it had at that moment. */
export interface PenCall {
  name: string;
  args: unknown[];
  fillStyle: string;
  strokeStyle: string;
  globalAlpha: number;
  font: string;
  dash: number[];
  /** Where the dashes start: what moves them along a line. */
  dashOffset: number;
  lineWidth: number;
  /** The ends of a line and of each of its dashes: "round" makes a dash of no length a dot. */
  lineCap: string;
}

/** A stand-in for a canvas's drawing context: it draws nothing and writes down everything it is asked to draw. Like a
 * canvas, it keeps the colour it had when it is given something that is no colour. A character is half its font's size
 * wide. Tests only. */
export class FakePen {
  readonly calls: PenCall[] = [];
  /** Every text whose width was asked for. */
  readonly measured: string[] = [];
  globalAlpha = 1;
  lineWidth = 1;
  lineDashOffset = 0;
  lineCap = "butt";
  font = "10px sans-serif";
  textAlign = "start";
  textBaseline = "alphabetic";
  private fillColour = "#000000";
  private strokeColour = "#000000";
  private dash: number[] = [];

  get fillStyle(): string { return this.fillColour; }
  set fillStyle(value: string) { if (isColour(value)) this.fillColour = value; }
  get strokeStyle(): string { return this.strokeColour; }
  set strokeStyle(value: string) { if (isColour(value)) this.strokeColour = value; }

  private note(name: string, args: unknown[]): void {
    this.calls.push({ name, args, fillStyle: this.fillColour, strokeStyle: this.strokeColour, globalAlpha: this.globalAlpha, font: this.font, dash: [...this.dash], dashOffset: this.lineDashOffset, lineWidth: this.lineWidth, lineCap: this.lineCap });
  }
  setTransform(...args: number[]): void { this.note("setTransform", args); }
  clearRect(...args: number[]): void { this.note("clearRect", args); }
  fillRect(...args: number[]): void { this.note("fillRect", args); }
  strokeRect(...args: number[]): void { this.note("strokeRect", args); }
  beginPath(): void { this.note("beginPath", []); }
  closePath(): void { this.note("closePath", []); }
  moveTo(...args: number[]): void { this.note("moveTo", args); }
  lineTo(...args: number[]): void { this.note("lineTo", args); }
  bezierCurveTo(...args: number[]): void { this.note("bezierCurveTo", args); }
  arc(...args: unknown[]): void { this.note("arc", args); }
  arcTo(...args: number[]): void { this.note("arcTo", args); }
  roundRect(...args: number[]): void { this.note("roundRect", args); }
  fill(...args: unknown[]): void { this.note("fill", args); }
  stroke(): void { this.note("stroke", []); }
  fillText(...args: unknown[]): void { this.note("fillText", args); }
  setLineDash(dash: number[]): void {
    this.dash = [...dash];
    this.note("setLineDash", [dash]);
  }
  measureText(text: string): { width: number } {
    this.measured.push(text);
    return { width: [...text].length * (parseFloat(/([\d.]+)px/.exec(this.font)?.[1] ?? "10") / 2) };
  }

  named(name: string): PenCall[] { return this.calls.filter(call => call.name === name); }
  /** The texts drawn, in order. */
  texts(): string[] { return this.named("fillText").map(call => String(call.args[0])); }
  clear(): void { this.calls.length = 0; }
}

const isColour = (value: unknown): value is string => typeof value === "string" && /^(#[0-9a-f]{3,8}|rgba?\([^)]*\)|color\([^)]*\))$/i.test(value.trim());

/** Invented access drivers: read, write, both, and a second module in the same group. The shared driver also filters
 * its own grid, and controls both a line item and a module. */
export function accessMarkedModel() {
  const make = new GraphMaker();
  const home = make.module("ACC01 Access", "Access");
  const checks = make.module("ACC02 Checks", "Access");
  const plan = make.module("PLN01 Plan", "Planning");
  const read = make.item(home, "Can read", { format: "BOOLEAN" });
  const write = make.item(home, "Can write", { format: "BOOLEAN" });
  const both = make.item(home, "Open and visible", { format: "BOOLEAN" });
  const local = make.item(home, "Local value");
  const second = make.item(checks, "Approved", { format: "BOOLEAN" });
  const units = make.item(plan, "Units");
  const price = make.item(plan, "Price");
  make.nodes[both].pageFilters = [{ app: "Invented planning", page: "Access review", card: "1", modules: [home], lineItems: [both, local] }];
  make.link(read, units, "read_access").link(read, price, "read_access").link(write, price, "write_access")
    .link(both, local, "read_access").link(both, local, "write_access").link(both, plan, "read_access")
    .link(second, units, "write_access").link(both, local, "page_filter").link(both, local);
  return { graph: { ...make.graph(), pageFilterTable: true, accessDriversRead: true }, home, checks, plan, read, write, both, local, second, units, price };
}

/** One outside module reached through its line item and as a whole module. The two used to become twin boxes.
 * The second filter card has no line-item selection, as in results read before 0.21.0. Names and data are invented. */
export function twinBoxesModel() {
  const make = new GraphMaker();
  const home = make.module("ACC01 Access", "Access");
  const plan = make.module("PLN01 Forecast", "Planning");
  const read = make.item(home, "Can read", { format: "BOOLEAN", formula: "'PLN01 Forecast'.Forecast > 0" });
  const write = make.item(home, "Can write", { format: "BOOLEAN" });
  const both = make.item(home, "Open and visible", { format: "BOOLEAN" });
  const forecast = make.item(plan, "Forecast", { formula: "IF 'ACC01 Access'.Can write THEN 1 ELSE 0" });
  make.nodes[both].pageFilters = [
    { app: "Invented planning", page: "Forecast review", card: "1", modules: [plan], lineItems: [forecast] },
    { app: "Invented planning", page: "Forecast review", card: "2", modules: [plan] },
  ];
  make.link(forecast, read).link(write, forecast)
    .link(read, forecast, "read_access").link(write, forecast, "write_access").link(both, plan, "read_access")
    .link(both, forecast, "page_filter").link(both, plan, "page_filter");
  return { make, graph: { ...make.graph(), pageFilterTable: true, accessDriversRead: true }, home, plan, read, write, both, forecast };
}

/** A model whose filters on the pages built on it are, as in a live model, on the modules of their own line items, which
 * no link can show: MDM380 - Customer Entity # is filtered by its own Incomplete Records and Missing DisplayName, and
 * MDM381 - Resources # by its own Incomplete Records, both modules in 01: Master Data; REP01 - Report, in 02: Reporting,
 * reads Customer Entity's Incomplete Records and is filtered by nothing. With `mixed`, FLT01 - Filters, in 00: Inputs, has
 * Show?, which filters REP01 - Report: a filter on another module, which a link shows. The result has the Page Filters
 * table. Tests only. */
export function ownFilteredModel(mixed = false) {
  const make = new GraphMaker();
  const flt = mixed ? make.module("FLT01 - Filters", "00: Inputs") : undefined;
  const cust = make.module("MDM380 - Customer Entity #", "01: Master Data");
  const res = make.module("MDM381 - Resources #", "01: Master Data");
  const rep = make.module("REP01 - Report", "02: Reporting");
  const use = (card: string, ...modules: number[]): PageFilter => ({ app: "Data Hub", page: "Admin", card, modules });
  const incomplete = make.item(cust, "Incomplete Records", { format: "BOOLEAN", pageFilters: [use("1", cust)] });
  const missing = make.item(cust, "Missing DisplayName", { format: "BOOLEAN", pageFilters: [use("2", cust)] });
  const resIncomplete = make.item(res, "Incomplete Records", { format: "BOOLEAN", pageFilters: [use("3", res)] });
  const total = make.item(rep, "Total", { formula: "'MDM380 - Customer Entity #'.Incomplete Records" });
  make.link(incomplete, total);
  const show = flt === undefined ? undefined : make.item(flt, "Show?", { format: "BOOLEAN", pageFilters: [use("4", rep)] });
  if (show !== undefined) make.link(show, rep, "page_filter");
  const graph: ModelGraph = { ...make.graph(), pageFilterTable: true };
  return { graph, cust, res, rep, flt, incomplete, missing, resIncomplete, total, show };
}

/** A model whose filters on the pages built on it say which line items their grids show, as a run reads them now. MDM380 -
 * Customer Entity #, in 01: Master Data, is filtered by its own Incomplete Records, on a grid that shows every line item
 * of the module but its heading, Incomplete Records among them; and by its own Missing DisplayName, on a grid that shows
 * only Name and Code. Name feeds Missing Name, which feeds Incomplete Records. FLT01 - Filters' Show?, in 00: Inputs,
 * filters a grid of REP01 - Report, in 02: Reporting, that shows Total and Count. The result has the Page Filters table.
 * Tests only. */
export function lineFilteredModel() {
  const make = new GraphMaker();
  const flt = make.module("FLT01 - Filters", "00: Inputs");
  const cust = make.module("MDM380 - Customer Entity #", "01: Master Data");
  const rep = make.module("REP01 - Report", "02: Reporting");
  const heading = make.item(cust, "--- Checks ---", { format: "NONE" });
  const name = make.item(cust, "Name", { format: "TEXT" });
  const code = make.item(cust, "Code", { format: "TEXT" });
  const missingName = make.item(cust, "Missing Name", { format: "BOOLEAN", formula: "ISBLANK(Name)" });
  const incomplete = make.item(cust, "Incomplete Records", { format: "BOOLEAN", formula: "Missing Name" });
  const missing = make.item(cust, "Missing DisplayName", { format: "BOOLEAN" });
  const total = make.item(rep, "Total");
  const count = make.item(rep, "Count");
  const show = make.item(flt, "Show?", { format: "BOOLEAN" });
  const use = (card: string, module: number, lineItems: number[]): PageFilter => ({ app: "Data Hub", page: "Admin", card, modules: [module], dimension: "Customers", lineItems });
  make.nodes[incomplete].pageFilters = [use("1", cust, [name, code, missingName, incomplete, missing])];
  make.nodes[missing].pageFilters = [use("2", cust, [name, code])];
  make.nodes[show].pageFilters = [use("3", rep, [total, count])];
  make.link(name, missingName).link(missingName, incomplete);
  for (const target of [name, code, missingName, missing]) make.link(incomplete, target, "page_filter");
  for (const target of [name, code]) make.link(missing, target, "page_filter");
  for (const target of [total, count]) make.link(show, target, "page_filter");
  const graph: ModelGraph = { ...make.graph(), pageFilterTable: true };
  return { graph, flt, cust, rep, heading, name, code, missingName, incomplete, missing, total, count, show };
}

/** A model whose filter line item, Show?, is the condition of filters on the pages built on it: on two cards of REV01 -
 * Revenue, the second of them also filtering MAR01 - Margin, each by Products. Revenue's formula also reads Show?; nothing
 * reads Margin. Each module is in a section of its own. Without `filters` it is the same model with no page filters at
 * all. Tests only. */
export function filteredModel(filters = true) {
  const make = new GraphMaker();
  const flt = make.module("FLT01 - Filters", "01: Inputs");
  const rev = make.module("REV01 - Revenue", "02: Calculations");
  const mar = make.module("MAR01 - Margin", "03: Reporting");
  const use = (card: string, ...modules: number[]): PageFilter => ({ app: "Planning", page: "Demand", card, modules, dimension: "Products" });
  const show = make.item(flt, "Show?", { format: "BOOLEAN", ...(filters ? { pageFilters: [use("3", rev), use("4", rev, mar)] } : {}) });
  const revenue = make.item(rev, "Revenue", { formula: "Show? * 2" });
  const margin = make.item(mar, "Margin");
  make.link(show, revenue);
  if (filters) make.link(show, rev, "page_filter").link(show, mar, "page_filter");
  return { graph: make.graph(), flt, rev, mar, show, revenue, margin };
}
