import { formatWords, summaryWords } from "../results/readable-cells.js";
import type { GraphNode, PageFilter } from "./graph-types.js";
import { edgeDrawn, LAYER, sectionLayer, type LinksDrawn, type ViewGraph, type ViewNode } from "./map-graphs.js";
import { isAccess, isFilter, type MapModel } from "./map-model.js";
import { formatCount, plural } from "./map-text.js";

/** What the map says in words about the graph on screen and the node selected, as plain data: the markup
 * (map-markup.ts) writes it out, and escapes every piece of it. Everything here is read from the model's graph; nothing
 * is worked out that the export does not say.
 *
 * The words are the results page's wherever the page has words for the same thing: a line item's Format and Summary
 * are said as its Line Items table says them (results/readable-cells.ts), and a detail is labelled as that table's
 * column is named. */

/** A link of the details: to an object of the model, wherever the map has to go to show it (`raw`), or to a node of
 * the graph on screen (`node`). */
export interface InspectLink {
  raw?: number;
  node?: string;
  name: string;
  /** Under the name: a line item's module, a property's list. */
  sub?: string;
  /** Under that: how it is linked, where that is not by a formula. */
  caption?: string;
  layer: string;
}
export interface InspectList { key: string; title: string; open: boolean; links: InspectLink[] }
export interface InspectText { key: string; title: string; lines: string[] }
/** The details' main button: open a section's modules, a module's line items, or the module of a line item that
 * stands beside another module's, with that line item selected. */
export interface InspectAction { label: string; section?: number; module?: number; select?: number }

export interface Inspection {
  /** What the node is: Module, Line item, Group... */
  kind: string;
  layer: string;
  name: string;
  rows: [label: string, value: string][];
  action?: InspectAction;
  formula?: string;
  /** In the formula's place, for a line item without one. */
  remark?: string;
  lists: InspectList[];
  texts: InspectText[];
  notes?: string;
  /** Structured cells as read, folded after the readable details. */
  asRead?: [label: string, value: string][];
}

/** As many of a line item's page filters as its details list: the rest are counted. */
export const FILTERS_LISTED = 10;

/** Where a filter is, as the Page Filters table has it: its app, its page and its card's number, and the dimension it
 * filters by. */
function whereWords(use: PageFilter): string {
  return [use.app, use.page, use.card === "" ? "" : `Card ${use.card}`, use.dimension === undefined ? "" : `by ${use.dimension}`].filter(part => part !== "").join(" · ");
}

/** What a link of a filter says under its name: where the filter is, the first of them, and how many more there are. */
function whereCaption(uses: readonly PageFilter[]): string {
  const [first] = uses;
  if (!first) return "";
  const more = uses.length - 1;
  return `${whereWords(first)}${more > 0 ? ` · ${plural(more, "more card")}` : ""}`;
}

/** What a filter with a line item as its condition filters among the line items, in a few words: how many the grid
 * shows but the line item itself, and the line item itself where the grid shows it too; or, for a module whose grid does
 * not say which line items it shows, that they are not known (graph-types.ts `PageFilter`). */
function filteredWords(model: MapModel, raw: GraphNode, use: PageFilter): string {
  const shown = use.lineItems ?? [];
  const known = new Set(shown.map(id => model.node(id)?.module));
  const others = shown.filter(id => id !== raw.id).length;
  const said = [others ? plural(others, "line item") : "", shown.includes(raw.id) ? "itself" : ""].filter(part => part !== "").join(" and ");
  const unknown = (use.modules ?? []).some(id => !known.has(id));
  return [said, unknown ? "line items not known" : ""].filter(part => part !== "").join(", ");
}

/** The filters on the pages built on the model that have a line item as their condition, a line each: what each
 * filters, the modules and how many of their line items, where it is and by which dimension, as the Page Filters table
 * has them. Of more than `FILTERS_LISTED`, the rest are counted, and the table has them all. */
function pageFiltersText(model: MapModel, raw: GraphNode): InspectText[] {
  const filters = raw.pageFilters ?? [];
  if (!filters.length) return [];
  const lines = filters.slice(0, FILTERS_LISTED).map(use => {
    const modules = (use.modules ?? []).map(id => model.node(id)?.name).filter((name): name is string => name !== undefined);
    return [modules.join(", "), whereWords(use), filteredWords(model, raw, use)].filter(part => part !== "").join(" · ");
  });
  const more = filters.length - FILTERS_LISTED;
  if (more > 0) lines.push(`And ${formatCount(more)} more: the Page Filters table lists them all.`);
  return [{ key: "pageFilters", title: `Page filters · ${formatCount(filters.length)}`, lines }];
}

/** The line items a line item's page filters filter, each once, as links, in the graph's order: those the grids it
 * narrows show, but itself. They are listed open while they are few, and closed where they are many: a grid can show a
 * module's every line item. Nothing for a line item whose filters filter no line item of the map. */
function filtersLineItems(model: MapModel, raw: GraphNode): InspectList[] {
  const ids = [...new Set((raw.pageFilters ?? []).flatMap(use => use.lineItems ?? []))].filter(id => id !== raw.id).sort((a, b) => a - b);
  const links = ids.map(id => model.node(id)).filter((node): node is GraphNode => node !== undefined).map(node => objectLink(model, node));
  return links.length ? [{ key: "filtersItems", title: `Line items it filters on pages · ${formatCount(links.length)}`, open: links.length <= FILTERS_LISTED, links }] : [];
}

/** The line items whose page filters filter a line item, as the grids they narrow show it, as links, each with where it
 * filters: what the map's page filter links into it say, whether they are drawn or not. Nothing for a line item no
 * page filter filters. */
function itemFilteredBy(model: MapModel, raw: GraphNode): InspectList[] {
  const filters = model.filtersOfItem(raw.id);
  if (!filters.length) return [];
  return [{ key: "itemFilteredBy", title: `Filtered on pages by · ${formatCount(filters.length)}`, open: true, links: filters.map(({ item, uses }) => objectLink(model, item, whereCaption(uses))) }];
}

/** What the hover card says of a line item's page filters while the map draws them, a line for each side: where it
 * filters, the first of its filters with how many more there are; and what filters it, the first filter line item
 * (with its module where that is another) with how many more there are. Nothing for a line item no filter names. */
export function filterTipLines(model: MapModel, raw: GraphNode): string[] {
  const lines: string[] = [];
  const uses = raw.pageFilters ?? [];
  const more = (count: number): string => (count > 1 ? `, and ${formatCount(count - 1)} more` : "");
  if (uses.length) lines.push(`Page filter on ${whereWords(uses[0])}${more(uses.length)}`);
  const by = model.filtersOfItem(raw.id);
  if (by.length) {
    const [{ item }] = by;
    const home = item.module !== raw.module ? model.node(item.module)?.name : undefined;
    lines.push(`Filtered on pages by ${item.name}${home === undefined ? "" : ` of ${home}`}${more(by.length)}`);
  }
  return lines;
}

/** The modules a line item's page filters filter, each once, as links, with where the line item filters it: what the
 * map's page filter links say of it, whether they are drawn or not. Its own module is among them where a filter names
 * it. Nothing for a line item that filters no module of the map. */
function filtersModules(model: MapModel, raw: GraphNode): InspectList[] {
  const byModule = new Map<number, PageFilter[]>();
  for (const use of raw.pageFilters ?? []) {
    for (const id of use.modules ?? []) {
      const uses = byModule.get(id);
      if (uses) uses.push(use); else byModule.set(id, [use]);
    }
  }
  const links: InspectLink[] = [];
  for (const [id, uses] of byModule) {
    const module = model.node(id);
    if (module) links.push(objectLink(model, module, whereCaption(uses)));
  }
  return links.length ? [{ key: "filters", title: `Modules it filters on pages · ${formatCount(links.length)}`, open: true, links }] : [];
}

/** The line items whose page filters filter a module, as links, each with where it filters the module: what the map's
 * page filter links into it say, whether they are drawn or not. Nothing for a module no page filter names. */
function filteredBy(model: MapModel, module: GraphNode): InspectList[] {
  const filters = model.filtersOf(module.id);
  if (!filters.length) return [];
  return [{ key: "filteredBy", title: `Filtered on pages by · ${formatCount(filters.length)}`, open: true, links: filters.map(({ item, uses }) => objectLink(model, item, whereCaption(uses))) }];
}

const KIND_NAMES: Record<GraphNode["kind"], string> = { list: "List", subset: "List subset", property: "List property", module: "Module", lineItem: "Line item", process: "Process", action: "Action" };

/** A line item with the format No Data: a model's builders use one as a heading among a module's line items. */
export const isHeading = (node: GraphNode): boolean => node.kind === "lineItem" && node.format?.toUpperCase() === "NONE";

/** The layer an object of the model is drawn in, for the dot beside its name. */
export function layerOfObject(model: MapModel, node: GraphNode): string {
  if (node.kind === "module") return sectionLayer(model.sectionIndex(model.sectionOf(node)));
  if (node.kind === "lineItem") return isHeading(node) ? LAYER.heading : LAYER.lineItem;
  if (node.kind === "property") return LAYER.property;
  return node.kind === "list" || node.kind === "subset" ? LAYER.list : LAYER.external;
}

function objectLink(model: MapModel, node: GraphNode, caption?: string): InspectLink {
  const owner = node.kind === "lineItem" ? model.node(node.module) : node.kind === "property" ? model.node(node.parent) : undefined;
  return { raw: node.id, name: node.name, layer: layerOfObject(model, node), ...(owner ? { sub: owner.name } : {}), ...(caption ? { caption } : {}) };
}

const nodeLink = (node: ViewNode): InspectLink => ({ node: node.id, name: node.fullName, layer: node.layer });

/** What a module or a line item applies to, as the Line Items table's Applies To says it. */
function appliesTo(model: MapModel, node: GraphNode): string {
  const names = (node.dimensions ?? []).map(id => model.node(id)?.name).filter((name): name is string => name !== undefined && name !== "");
  if (!names.length) return "None";
  return `${names.join(", ")}${node.inheritsDimensions ? " (the module's)" : ""}`;
}

/** A line item's Format in the page's words: from the cell as exported where the graph has it, with its list's name.
 * A cell the page's reader does not read, and a graph without the cell, give what the graph says of the format. */
function formatOf(model: MapModel, node: GraphNode): string | undefined {
  const list = model.node(node.formatList)?.name;
  const words = node.formatCell === undefined ? undefined : formatWords(node.formatCell, { listName: () => list });
  return words ?? list ?? node.format;
}

/** A line item's Summary in the page's words, with the names of the two line items a Ratio divides. */
function summaryOf(node: GraphNode): string | undefined {
  const words = node.summaryCell === undefined ? undefined : summaryWords(node.summaryCell, { ratioNumerator: node.ratioNumerator, ratioDenominator: node.ratioDenominator });
  return words ?? node.summary;
}

/** What an object reads (`upstream`) or what reads it, one entry for each object, with the access it gives where the
 * link is one of who may read or write. The links of the pages' filters are no reading: the details list them on their
 * own (`filtersModules`, `filteredBy`). */
function related(model: MapModel, id: number, upstream: boolean, access: boolean): InspectLink[] {
  const found = new Map<number, Set<string>>();
  for (const edge of upstream ? model.incoming(id) : model.outgoing(id)) {
    if ((!access && isAccess(edge[2])) || isFilter(edge[2])) continue;
    const other = edge[upstream ? 0 : 1];
    let kinds = found.get(other);
    if (!kinds) found.set(other, kinds = new Set());
    kinds.add(edge[2]);
  }
  const links: InspectLink[] = [];
  for (const [other, kinds] of found) {
    const node = model.node(other);
    const driver = (kind: string): string => `${kind === "read_access" ? "read" : "write"} access ${upstream ? "driver" : "driven by this"}`;
    if (node) links.push(objectLink(model, node, [...kinds].filter(kind => kind.includes("access")).map(driver).join(", ")));
  }
  return links;
}

const row = (rows: [string, string][], label: string, value: string | number | undefined): void => {
  if (value !== undefined && value !== "") rows.push([label, String(value)]);
};

/** The two lists every node has: what feeds it directly, and what it feeds directly. The trace beside them counts
 * everything, through other objects too, so each title says which of the two it is. */
function linkLists(reads: InspectLink[], feeds: InspectLink[]): InspectList[] {
  const lists: InspectList[] = [];
  if (reads.length) lists.push({ key: "depends", title: `Feeds it directly · ${formatCount(reads.length)}`, open: true, links: reads });
  if (feeds.length) lists.push({ key: "used", title: `It feeds directly · ${formatCount(feeds.length)}`, open: true, links: feeds });
  return lists;
}

function inspectSection(model: MapModel, graph: ViewGraph, node: ViewNode): Inspection {
  const members = (node.members ?? []).map(id => model.node(id)).filter((member): member is GraphNode => member !== undefined);
  const lineItems = members.reduce((count, member) => count + model.itemsOf(member.id).length, 0);
  return {
    kind: "Group", layer: node.layer, name: node.fullName,
    rows: [["Modules", formatCount(members.length)], ["Line items", formatCount(lineItems)]],
    ...(members.length ? { action: { label: `Show its ${plural(members.length, "module")}`, section: node.section } } : {}),
    lists: [
      ...linkLists(graph.in[node.index].map(index => nodeLink(graph.nodes[index])), graph.out[node.index].map(index => nodeLink(graph.nodes[index]))),
      { key: "modules", title: `Its modules · ${formatCount(members.length)}`, open: true, links: members.map(member => objectLink(model, member)) },
    ],
    texts: [],
  };
}

function inspectModule(model: MapModel, graph: ViewGraph, node: ViewNode, raw: GraphNode): Inspection {
  const owned = model.itemsOf(raw.id);
  const rows: [string, string][] = [];
  // A model whose modules stand under one heading, or under none, has no sections to tell them apart by. Where the map
  // chose how to group the modules, the section says where it comes from, and a section the map worked out says why.
  if (model.sections.length > 1) {
    row(rows, "Group", model.grouping ? `${model.sectionOf(raw)} · ${model.grouping.source}` : model.sectionOf(raw));
    row(rows, "Why", model.grouping?.whyOf?.get(raw.id));
  }
  row(rows, "Line items", formatCount(owned.length));
  row(rows, "Applies To", appliesTo(model, raw));
  row(rows, "Cell Count", raw.cells === undefined ? undefined : formatCount(raw.cells));
  row(rows, "Time Scale", raw.timeScale);
  row(rows, "Time Range", raw.timeRange);
  row(rows, "Versions", raw.versions);
  const lists: InspectList[] = [];
  if (node.kind === "externalModule") {
    const members = (node.members ?? []).map(id => model.node(id)).filter((member): member is GraphNode => member !== undefined);
    lists.push({ key: "referenced", title: `Its line items linked here · ${formatCount(members.length)}`, open: true, links: members.map(member => objectLink(model, member)) });
  }
  lists.push(...linkLists(graph.in[node.index].map(index => nodeLink(graph.nodes[index])), graph.out[node.index].map(index => nodeLink(graph.nodes[index]))));
  lists.push(...filteredBy(model, raw));
  if (owned.length) lists.push({ key: "items", title: `All its line items · ${formatCount(owned.length)}`, open: false, links: owned.map(item => objectLink(model, item)) });
  const actions = model.actionsOf(raw.id);
  return {
    kind: KIND_NAMES.module, layer: node.layer, name: node.fullName, rows,
    // A module without line items has nothing to open.
    ...(owned.length ? { action: { label: `Show its ${plural(owned.length, "line item")}`, module: raw.id } } : {}),
    lists,
    texts: actions.length ? [{ key: "actions", title: `Actions · ${formatCount(actions.length)}`, lines: actions.map(({ action }) => (action.actionType ? `${action.name} (${action.actionType})` : action.name)) }] : [],
  };
}

function inspectObject(model: MapModel, node: ViewNode, raw: GraphNode, access: boolean): Inspection {
  const rows: [string, string][] = [];
  const module = model.node(model.moduleOf(raw));
  row(rows, "Module", module?.name);
  if (raw.kind === "property") row(rows, "List", model.node(raw.parent)?.name);
  row(rows, "Format", formatOf(model, raw));
  row(rows, "Summary", summaryOf(raw));
  if (raw.kind === "lineItem") row(rows, "Applies To", appliesTo(model, raw));
  row(rows, "Cell Count", raw.cells === undefined ? undefined : formatCount(raw.cells));
  row(rows, "Time Scale", raw.timeScale);
  row(rows, "Time Range", raw.timeRange);
  row(rows, "Versions", raw.versions);
  row(rows, "Style", raw.style);
  row(rows, "Code", raw.code);
  if (raw.kind === "list" || raw.kind === "subset") {
    row(rows, raw.kind === "subset" ? "List" : "Parent Hierarchy", model.node(raw.parent)?.name);
    row(rows, "Item Count", raw.count === undefined ? undefined : formatCount(raw.count));
    row(rows, "Top Level", raw.topLevel);
    row(rows, "Numbered", raw.numbered === undefined ? undefined : raw.numbered ? "Yes" : "No");
    row(rows, "Display Name Property", raw.displayName);
  }
  const formula = raw.formula !== undefined && raw.formula !== "" ? raw.formula : undefined;
  return {
    kind: KIND_NAMES[raw.kind] ?? String(raw.kind).toUpperCase(), layer: node.layer, name: node.fullName, rows,
    // A line item of another module can be gone to in its own module. One of the module on screen is already there.
    ...(module && node.external ? { action: { label: "Show its module with it selected", module: module.id, select: raw.id } } : {}),
    ...(formula !== undefined ? { formula } : raw.kind === "lineItem" ? { remark: isHeading(raw) ? "No formula. Its format is No Data: a heading among the line items." : "No formula." } : {}),
    lists: [...linkLists(related(model, raw.id, true, access), related(model, raw.id, false, access)), ...filtersModules(model, raw), ...filtersLineItems(model, raw),
      ...itemFilteredBy(model, raw)], texts: pageFiltersText(model, raw),
  };
}

/** What the details say of a node of the graph on screen. `access` says whether the links of read and write access
 * drivers count among what feeds an object and what it feeds. */
export function inspect(model: MapModel, graph: ViewGraph, node: ViewNode, access: boolean): Inspection {
  const raw = node.raw;
  if (!raw) return inspectSection(model, graph, node);
  const inspection = raw.kind === "module" ? inspectModule(model, graph, node, raw) : inspectObject(model, node, raw, access);
  // What the export names in this object's row that the graph could not take for one object: none of that name, or
  // more than one with nothing to tell them apart.
  const unresolved = model.unresolvedOf(raw.id);
  if (unresolved.length) inspection.texts.push({ key: "unresolved", title: `Names not matched to one object · ${formatCount(unresolved.length)}`, lines: unresolved.map(entry => `${entry.field}: ${entry.reference}`) });
  if (raw.notes !== undefined && raw.notes !== "") inspection.notes = raw.notes;
  const asRead: [string, string][] = [];
  row(asRead, "Format", raw.formatCell);
  row(asRead, "Summary", raw.summaryCell);
  if (asRead.length) inspection.asRead = asRead;
  return inspection;
}

/** What a trace found, in the map's words: how many boxes on the map feed the node, directly or through others, and
 * how many it feeds. The counts are of boxes, which is why they can differ from the lists of the details: a box may
 * stand for a whole module. */
export interface TraceWords { feeds: string; fed: string; sentence: string }
export function traceWords(inspection: Inspection, up: number, down: number): TraceWords {
  const kind = inspection.kind.charAt(0) + inspection.kind.slice(1).toLowerCase();
  const feeds = `${plural(up, "box", "boxes")} ${up === 1 ? "feeds" : "feed"} it`;
  const fed = `it feeds ${plural(down, "box", "boxes")}`;
  return { feeds, fed, sentence: `${kind} ${inspection.name} selected. On the map ${feeds} and ${fed}, directly or through others.` };
}

/** What stands for a count of the graph's boxes, one and many. */
function boxesOf(graph: ViewGraph, count: number, kind: "own" | "others"): string {
  if (graph.kind === "sections") return plural(count, "group");
  if (graph.kind === "modules") return kind === "own" ? plural(count, "module") : `${plural(count, "module")} of other groups`;
  return kind === "own" ? plural(count, "line item") : `${formatCount(count)} outside the module`;
}

/** The links of the graph the map draws (`drawn`), in words: how many, or plainly none where no kind of link is ticked. */
function linksOf(graph: ViewGraph, drawn: LinksDrawn): string {
  if (drawn === "none") return "no links drawn";
  return plural(drawn === "all" ? graph.edges.length : graph.edges.filter(edge => edgeDrawn(edge, false)).length, "link");
}

/** The line that says what the map shows: the boxes of the graph, what stands beside them, and the links drawn
 * (`drawn`). `shown` is how many boxes are drawn (fewer than the graph has when a layer is hidden or the view keeps to a
 * trace), `inView` how many of those the reader has on screen. Every number is of what is there now. `brief` leaves out
 * what the graph holds and says only how much of it is drawn and in view: beside a selection, whose own bar stands
 * under the line. */
export function statusWords(graph: ViewGraph, shown: number, inView: number, brief = false, drawn: LinksDrawn = "all"): string {
  const total = graph.nodes.length;
  const others = total - graph.local;
  const parts = [boxesOf(graph, graph.local, "own"), ...(others > 0 ? [boxesOf(graph, others, "others")] : []), linksOf(graph, drawn)];
  const said = parts.join(" · ");
  if (total === 0) return said;
  const more = shown < total ? `Showing ${formatCount(shown)} of ${plural(total, "box", "boxes")}${inView < shown ? `, ${formatCount(inView)} in view` : ""}.`
    : inView < total ? `${formatCount(inView)} of ${plural(total, "box", "boxes")} in view.` : "";
  return more === "" ? said : brief ? more : `${said}. ${more}`;
}

/** What the map says aloud when a view opens: what it is of and how much it holds, of links those drawn (`drawn`). */
export function viewSentence(graph: ViewGraph, modelName: string, drawn: LinksDrawn = "all"): string {
  const others = graph.nodes.length - graph.local;
  const beside = others > 0 ? `, with ${boxesOf(graph, others, "others")}` : "";
  const links = linksOf(graph, drawn);
  if (graph.kind === "sections") return `Groups of ${modelName}: ${plural(graph.local, "group")}, ${links}.`;
  if (graph.kind === "modules") return `${graph.name}: ${plural(graph.local, "module")}${beside}, ${links}.`;
  return `Line items of ${graph.name}: ${plural(graph.local, "line item")}${beside}, ${links}.`;
}
