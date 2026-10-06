import type { EdgeKind, GraphEdge, GraphNode, ModelGraph, Unresolved } from "./graph-types.js";
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
  lineWidth: number;
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
    this.calls.push({ name, args, fillStyle: this.fillColour, strokeStyle: this.strokeColour, globalAlpha: this.globalAlpha, font: this.font, dash: [...this.dash], lineWidth: this.lineWidth });
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
  fill(): void { this.note("fill", []); }
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
