import type { GraphNode, ImportLoad } from "./graph-types.js";
import { formulaReferences } from "./map-formula.js";
import { isFormula, type MapModel } from "./map-model.js";
import { formatCount, plural } from "./map-text.js";

/** The source inputs of a line item: the line items without a formula that feed its values, directly or through other
 * line items, whatever they are called. They are what a user enters or an import loads, and so what can change the figure.
 * Everything here comes from the map's graph and from what the imports load (model/import-loads.ts): nothing is read.
 *
 * From the line item, the trace walks against the flow of values, once to each object, so that a circle (a PREVIOUS
 * chain, or two line items that read each other) ends:
 * - a formula's links (map-model.ts `isFormula`): the line items it reads, the mapping and lookup line items of its
 *   [SUM: ...] and [LOOKUP: ...] among them, as the graph has them from the export's Referenced By, and a list's
 *   property whose formula reads a line item. A list a formula names is no value of a line item, and the walk stops there;
 * - a summary's children: a line item that is a summary (graph-types.ts `isSummary`) gets its values from the line items
 *   whose Parent names it, so they feed it;
 * - a Ratio summary's two line items, its numerator and its denominator, by their names in its module, or the one line
 *   item of the model of that name;
 * - the list properties a formula reads, written behind their list's name and a dot. The graph has no link for them, so
 *   they are found in the formula's text, as a formula's references are read (map-formula.ts); a name
 *   that is a module's line item as well is the line item's, as build-graph.ts takes it. A property has a formula where
 *   the graph links something into it, as what its formula reads: the walk goes on through it. One without is a value
 *   entered in its list, and is named apart: it is no line item.
 *
 * An input is a line item reached that has no formula, is no heading (the format No Data) and is no summary (by Is Summary,
 * or by having children). The line item traced is never its own input: a link from a line item to itself is none, and
 * one that leads back to it ends there. The calculations are the line items, and the properties with a formula, on the
 * ways from the inputs to it. */

/** An input of the line item traced. */
export interface SourceInput {
  readonly node: GraphNode;
  /** Its module, where the map has it. */
  readonly module: GraphNode | undefined;
  /** The imports whose mapping names it, by their names, in the Imports table's order (`importedBy`); none for one that is
   * entered. */
  readonly imports: readonly string[];
  /** The imports that may load it without naming it: their mapping is not known, or their line items are matched by name when
   * they run, so any line item of the module without a formula may be theirs. */
  readonly mayImport?: readonly string[];
  /** The fewest links from it to the line item traced. */
  readonly steps: number;
  /** The first line item after it on one of its shortest ways to the line item traced: the line item traced itself where
   * it feeds it directly. */
  readonly feeds: GraphNode;
}

/** What a trace found. */
export interface SourceTrace {
  /** The line item traced, and its module. */
  readonly result: GraphNode;
  readonly module: GraphNode | undefined;
  /** Whether it has no formula and is no summary: it is an input itself, and nothing feeds it. */
  readonly input: boolean;
  /** Its inputs, by their steps, then their modules' names, then their own. */
  readonly inputs: readonly SourceInput[];
  /** The calculations on the ways from the inputs to it, in the graph's order: line items, and list properties that have a
   * formula. A calculation that no input feeds is on no such way, and is not among them. */
  readonly between: readonly GraphNode[];
  /** The links between it, its inputs and the calculations, from what feeds to what it feeds, each once, by their nodes in
   * the graph's order. None leads away from the line item traced. */
  readonly links: readonly (readonly [from: number, to: number])[];
  /** The list properties without a formula that it, or a calculation it reads, reads, the nearest first, then by their lists'
   * names and their own: named apart, never listed. */
  readonly properties: readonly GraphNode[];
}

const hasFormula = (node: GraphNode): boolean => (node.formula ?? "").trim() !== "";
const isHeading = (node: GraphNode): boolean => node.kind === "lineItem" && node.format?.toUpperCase() === "NONE";

/** What a trace looks up in a model, made once for its graph: each summary's children, the lists and their properties by
 * their names, the modules by their names, and the line items by theirs. */
interface Lookups {
  children: Map<number, number[]>;
  lists: Map<string, GraphNode>;
  properties: Map<number, Map<string, GraphNode>>;
  modules: Map<string, GraphNode>;
  items: Map<number, Map<string, GraphNode>>;
  byName: Map<string, GraphNode[]>;
}
const looked = new WeakMap<MapModel["graph"], Lookups>();
function lookupsOf(model: MapModel): Lookups {
  const known = looked.get(model.graph);
  if (known) return known;
  const made: Lookups = { children: new Map(), lists: new Map(), properties: new Map(), modules: new Map(), items: new Map(), byName: new Map() };
  const first = <T>(map: Map<string, T>, name: string, value: T): void => {
    if (!map.has(name)) map.set(name, value);
  };
  for (const node of model.graph.nodes) {
    if (node.kind === "list") first(made.lists, node.name.trim(), node);
    else if (node.kind === "property" && node.parent !== undefined) {
      let ofList = made.properties.get(node.parent);
      if (!ofList) made.properties.set(node.parent, ofList = new Map());
      first(ofList, node.name.trim(), node);
    }
  }
  for (const module of model.modules) {
    first(made.modules, module.name.trim(), module);
    const items = new Map<string, GraphNode>();
    for (const item of model.itemsOf(module.id)) first(items, item.name.trim(), item);
    made.items.set(module.id, items);
  }
  for (const item of model.lineItems) {
    const named = made.byName.get(item.name.trim());
    if (named) named.push(item); else made.byName.set(item.name.trim(), [item]);
    const parent = item.summaryParent === undefined ? undefined : model.node(item.summaryParent);
    if (parent?.kind !== "lineItem" || parent.id === item.id) continue;
    const children = made.children.get(parent.id);
    if (children) children.push(item.id); else made.children.set(parent.id, [item.id]);
  }
  looked.set(model.graph, made);
  return made;
}

/** Whether a line item is a summary: its Is Summary says so, or other line items name it as their Parent. */
const isSummary = (look: Lookups, node: GraphNode): boolean => node.isSummary === true || (look.children.get(node.id)?.length ?? 0) > 0;

/** The two line items a Ratio summary divides, as the export names them: a line item of its module, or else the one line
 * item of the model of that name. A name that is neither is passed over. */
function ratioOperands(model: MapModel, look: Lookups, node: GraphNode): GraphNode[] {
  const found: GraphNode[] = [];
  for (const written of [node.ratioNumerator, node.ratioDenominator]) {
    const name = written?.trim() ?? "";
    if (name === "") continue;
    const module = model.moduleOf(node);
    const named = look.byName.get(name);
    const operand = (module === undefined ? undefined : look.items.get(module)?.get(name)) ?? (named?.length === 1 ? named[0] : undefined);
    if (operand && !found.includes(operand)) found.push(operand);
  }
  return found;
}

/** The list properties a line item's formula reads, behind their list's name and a dot, in the formula's order. A name that
 * a module's line item has as well is that line item: the graph links it already. */
function propertiesRead(look: Lookups, node: GraphNode): GraphNode[] {
  if (!hasFormula(node)) return [];
  const found: GraphNode[] = [];
  for (const { parts } of formulaReferences(node.formula!)) {
    if (parts.length !== 2) continue;
    const [owner, name] = parts.map(part => part.trim());
    const list = look.lists.get(owner);
    const property = list === undefined ? undefined : look.properties.get(list.id)?.get(name);
    if (!property || found.includes(property)) continue;
    const module = look.modules.get(owner);
    if (module !== undefined && look.items.get(module.id)?.has(name)) continue;
    found.push(property);
  }
  return found;
}

/** What feeds a node's values, as the trace walks: what its formula reads that holds values, and for a line item its
 * summary's children, its Ratio's two line items and the list properties its formula reads. Each once, in that order, and
 * never the node itself. */
function feedersOf(model: MapModel, look: Lookups, node: GraphNode): number[] {
  const found: number[] = [];
  const seen = new Set<number>([node.id]);
  const add = (id: number): void => {
    if (seen.has(id)) return;
    seen.add(id);
    found.push(id);
  };
  for (const [from, , kind] of model.incoming(node.id)) {
    const source = model.node(from);
    if (isFormula(kind) && (source?.kind === "lineItem" || source?.kind === "property")) add(from);
  }
  if (node.kind !== "lineItem") return found;
  for (const child of look.children.get(node.id) ?? []) add(child);
  for (const operand of ratioOperands(model, look, node)) add(operand.id);
  for (const property of propertiesRead(look, node)) add(property.id);
  return found;
}

/** Whether a list's property has a formula, as far as the graph says: something is linked into it as what its formula
 * reads (build-graph.ts: a line item's Referenced By, a list's Referenced in Formula). */
const propertyHasFormula = (model: MapModel, property: GraphNode): boolean => model.incoming(property.id).some(([, , kind]) => isFormula(kind));

/** The imports that load each line item of the model, by the line item's node, from what each import loads (`ImportLoad`):
 * the line items its mapping names, found by their names among its module's, and where it can load any of them, each that
 * holds data (no heading) and has no formula. Each import once for a line item, in the Imports table's order. */
export interface ImportedBy {
  /** The imports whose mapping names the line item. */
  readonly sure: string[];
  /** The imports that may load it without naming it (`ImportLoad.any`). */
  readonly maybe: string[];
}

export function importedBy(model: MapModel, loads: readonly ImportLoad[] | undefined): Map<number, ImportedBy> {
  const look = lookupsOf(model);
  const by = new Map<number, ImportedBy>();
  const add = (item: GraphNode, name: string, maybe: boolean): void => {
    let names = by.get(item.id);
    if (!names) by.set(item.id, names = { sure: [], maybe: [] });
    if (maybe) {
      if (!names.sure.includes(name) && !names.maybe.includes(name)) names.maybe.push(name);
    } else if (!names.sure.includes(name)) {
      names.sure.push(name);
      const at = names.maybe.indexOf(name);
      if (at >= 0) names.maybe.splice(at, 1);
    }
  };
  for (const load of loads ?? []) {
    const module = look.modules.get(load.module.trim());
    if (module === undefined) continue;
    if (load.any) for (const item of model.itemsOf(module.id)) if (!isHeading(item) && !hasFormula(item)) add(item, load.name, true);
    for (const name of load.lineItems) {
      const item = look.items.get(module.id)?.get(name.trim());
      if (item) add(item, load.name, false);
    }
  }
  return by;
}

/** Whether a node is a line item whose source inputs can be found: a line item of a module of the map, and no heading. */
export const traceable = (model: MapModel, node: GraphNode | undefined): node is GraphNode =>
  node?.kind === "lineItem" && model.moduleOf(node) !== undefined && !isHeading(node);

/** The trace of a line item of the model, by its node (see above), with the imports that load each line item
 * (`importedBy`). Nothing for a node that is no line item of a module of the map, and for a heading, which holds no value. */
export function traceSources(model: MapModel, lineItem: number, imported: ReadonlyMap<number, ImportedBy> = new Map()): SourceTrace | undefined {
  const result = model.node(lineItem);
  if (!traceable(model, result)) return undefined;
  const look = lookupsOf(model);
  const module = model.node(model.moduleOf(result));
  if (!hasFormula(result) && !isSummary(look, result)) return { result, module, input: true, inputs: [], between: [], links: [], properties: [] };

  // Against the flow, once to each object: how many links away from the line item it is, and what it was reached from,
  // the next object on one of its shortest ways there.
  const steps = new Map<number, number>([[result.id, 0]]);
  const towards = new Map<number, number>();
  const feeders = new Map<number, number[]>();
  const queue = [result.id];
  for (let at = 0; at < queue.length; at++) {
    const id = queue[at];
    const node = model.node(id)!;
    // A list property without a formula holds its own values: nothing feeds it on the way.
    const fed = node.kind === "property" && !propertyHasFormula(model, node) ? [] : feedersOf(model, look, node);
    feeders.set(id, fed);
    for (const feeder of fed) {
      if (steps.has(feeder)) continue;
      steps.set(feeder, steps.get(id)! + 1);
      towards.set(feeder, id);
      queue.push(feeder);
    }
  }

  const reached = queue.slice(1).map(id => model.node(id)!);
  const isInput = (node: GraphNode): boolean => node.kind === "lineItem" && !isHeading(node) && !hasFormula(node) && !isSummary(look, node);
  const inputs = reached.filter(isInput);
  const ownerOf = (node: GraphNode): string => model.node(node.parent)?.name ?? "";
  const properties = reached.filter(node => node.kind === "property" && !propertyHasFormula(model, node))
    .sort((a, b) => steps.get(a.id)! - steps.get(b.id)! || ownerOf(a).localeCompare(ownerOf(b)) || a.name.localeCompare(b.name) || a.id - b.id);
  const calculations = new Set(reached.filter(node => !isInput(node) && (node.kind === "lineItem" || (node.kind === "property" && propertyHasFormula(model, node)))).map(node => node.id));

  // The ways from the inputs on: what they feed, and what that feeds, up to the line item traced. A link that leads away
  // from it is on no such way.
  const feeds = new Map<number, number[]>();
  for (const [id, fed] of feeders) {
    for (const feeder of fed) {
      if (feeder === result.id) continue;
      const onward = feeds.get(feeder);
      if (onward) onward.push(id); else feeds.set(feeder, [id]);
    }
  }
  const onWay = new Set(inputs.map(input => input.id));
  const ahead = [...onWay];
  for (let at = 0; at < ahead.length; at++) {
    for (const next of feeds.get(ahead[at]) ?? []) {
      if (onWay.has(next) || next === result.id) continue;
      onWay.add(next);
      ahead.push(next);
    }
  }
  const between = [...calculations].filter(id => onWay.has(id)).sort((a, b) => a - b).map(id => model.node(id)!);
  const shown = new Set([result.id, ...inputs.map(input => input.id), ...between.map(node => node.id)]);
  const links: [number, number][] = [];
  for (const [id, fed] of feeders) {
    if (!shown.has(id)) continue;
    for (const feeder of fed) if (feeder !== result.id && shown.has(feeder)) links.push([feeder, id]);
  }
  links.sort((a, b) => a[0] - b[0] || a[1] - b[1]);

  const named = (node: GraphNode | undefined): string => node?.name ?? "";
  const listed = inputs.map((node): SourceInput => {
    // The first line item on its way: a property between is passed over.
    let next = towards.get(node.id);
    while (next !== undefined && model.node(next)?.kind !== "lineItem") next = towards.get(next);
    const by = imported.get(node.id);
    return { node, module: model.node(model.moduleOf(node)), imports: by?.sure ?? [], mayImport: by?.maybe ?? [], steps: steps.get(node.id)!, feeds: model.node(next) ?? result };
  }).sort((a, b) => a.steps - b.steps || named(a.module).localeCompare(named(b.module)) || a.node.name.localeCompare(b.node.name) || a.node.id - b.node.id);
  return { result, module, input: false, inputs: listed, between, links, properties };
}

/** How an input comes by its values, in the list's words: Imported by the imports whose mapping names it, May be imported by
 * those that only may load it, or Entered where no import can. */
export function kindWords(input: Pick<SourceInput, "imports" | "mayImport">): string {
  const maybe = input.mayImport ?? [];
  if (input.imports.length) return `Imported by ${sentence(input.imports)}${maybe.length ? `; may be imported by ${sentence(maybe)}` : ""}`;
  return maybe.length ? `May be imported by ${sentence(maybe)}` : "Entered";
}

/** Names in a sentence: "A", "A and B", "A, B and C". */
function sentence(names: readonly string[]): string {
  return names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** How many list properties the line about them names; the rest are counted. */
export const PROPERTIES_NAMED = 5;

/** The line about the list properties without a formula a trace reached: how many, and their names, each behind its list's.
 * Nothing for none. */
export function propertiesLine(model: MapModel, properties: readonly GraphNode[]): string | undefined {
  if (!properties.length) return undefined;
  const names = properties.slice(0, PROPERTIES_NAMED).map(property => `${model.node(property.parent)?.name ?? ""}.${property.name}`);
  const more = properties.length - PROPERTIES_NAMED;
  const said = more > 0 ? `${names.join(", ")} and ${formatCount(more)} more` : sentence(names);
  return `It also reads ${plural(properties.length, "list property", "list properties")}: ${said}.`;
}
