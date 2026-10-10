import type { GraphNode } from "./graph-types.js";
import type { MapModel } from "./map-model.js";

/** The ways the map can file a model's modules into its sections, and the one it opens on by itself. Each is worked out
 * from the model's own tables and from nothing else: none looks for a word of its own in a name. A line item is in its
 * module's group, and a list keeps the heading it has in General Lists.
 *
 * - Functional area: the Modules file's Functional Area, which the model's builders set.
 * - Headings: the heading rows of Line Items above the modules, as the map has always grouped them.
 * - Name prefix: the code a module's name starts with, where enough modules share it: learnt from the names themselves.
 * - Role in the data flow: Data, Input, System, Calculation or Output, worked out from what the model does with the
 *   module, never from its name (`roleOf`).
 * - App: the app whose pages use the module, from the Module Usage table.
 * - Main dimension: the first list the module applies to.
 *
 * The map opens on the first of functional area, headings and name prefix that groups the model well (`isGood`), and
 * otherwise on the role in the data flow, which every model with modules has (`automaticGrouping`). */

export type GroupingKind = "functionalArea" | "headings" | "prefix" | "role" | "app" | "dimension";

export interface Grouping {
  readonly kind: GroupingKind;
  /** Its name in the switch. */
  readonly label: string;
  /** Where a module's group comes from, as the details and the search say it after the group's name. */
  readonly source: string;
  /** The groups that hold a module, in the order the map shows them. */
  readonly groups: readonly string[];
  /** Each module's group, by the module's ID. */
  readonly groupOf: ReadonlyMap<number, string>;
  /** Why a module is in its group, by the module's ID, where the map worked the group out. */
  readonly whyOf?: ReadonlyMap<number, string>;
  /** The group of the modules the grouping has nothing to say of. */
  readonly rest?: string;
}

export const NO_FUNCTIONAL_AREA = "No functional area";
/** The group of a module with no heading row above it, or under one that is nothing but dashes (graph-types.ts `group`). */
export const UNGROUPED = "Ungrouped";
export const OTHER = "Other";
export const ROLES = { data: "Data", input: "Input", system: "System", calculation: "Calculation", output: "Output" } as const;
export const NO_LINE_ITEMS = "No line items";
export const SEVERAL_APPS = "Several apps";
/** As the Module Usage table says it of a module that no page uses (page-files.ts). */
export const NO_PAGE = "Not on any page";
export const TIME_ONLY = "Time only";
export const NO_DIMENSIONS = "No dimensions";

/** How a grouping is named, where its groups come from, the group of what it cannot place, and the groups that come
 * last whatever the order of their first modules. */
interface Spec {
  kind: GroupingKind;
  label: string;
  source: string;
  rest?: string;
  last?: readonly string[];
  /** The groups' order, where it is the grouping's own: a group not in it comes after them. */
  order?: readonly string[];
  whyOf?: ReadonlyMap<number, string>;
}

/** Every module of the model in the group `assign` gives it. The groups come in the order of their first modules in the
 * model, or in the spec's own order, and those of `last` after them, in that order. */
function grouped(model: MapModel, spec: Spec, assign: (module: GraphNode) => string): Grouping {
  const groupOf = new Map<number, string>();
  const seen = new Set<string>();
  for (const module of model.modules) {
    const group = assign(module);
    groupOf.set(module.id, group);
    seen.add(group);
  }
  const last = spec.last ?? (spec.rest === undefined ? [] : [spec.rest]);
  const first = [...(spec.order ?? []).filter(group => seen.has(group)), ...[...seen].filter(group => !spec.order?.includes(group))];
  const groups = [...first.filter(group => !last.includes(group)), ...last.filter(group => seen.has(group))];
  return {
    kind: spec.kind, label: spec.label, source: spec.source, groups, groupOf,
    ...(spec.whyOf ? { whyOf: spec.whyOf } : {}), ...(spec.rest === undefined ? {} : { rest: spec.rest }),
  };
}

/* ---------- functional area and headings: what the model's builders set ---------- */

function byFunctionalArea(model: MapModel): Grouping | undefined {
  const areaOf = (module: GraphNode): string => module.functionalArea?.trim() ?? "";
  if (!model.modules.some(module => areaOf(module) !== "")) return undefined;
  return grouped(model, { kind: "functionalArea", label: "Functional area", source: "from functional areas", rest: NO_FUNCTIONAL_AREA },
    module => areaOf(module) || NO_FUNCTIONAL_AREA);
}

/** The heading rows, in the model's own order, as the map has always shown them: "Ungrouped" stands where the model's
 * sections have it. A model with no heading row above a module has none to group by. */
function byHeadings(model: MapModel): Grouping | undefined {
  const headingOf = (module: GraphNode): string => module.group ?? UNGROUPED;
  if (!model.modules.some(module => headingOf(module) !== UNGROUPED)) return undefined;
  return grouped(model, { kind: "headings", label: "Headings", source: "from heading rows", rest: UNGROUPED, last: [], order: model.sections }, headingOf);
}

/* ---------- name prefix: learnt from the names ---------- */

/** What ends the code a module's name starts with. */
const CODE_END = /[\s_\-.:()[\]{}]/;

/** The code a module's name starts with: its text up to the first space, underscore, dash, dot, colon or bracket,
 * without the digits at its end where letters come before them (INP01 is INP, FIN03 is FIN), and whole where it is
 * digits alone (the 1 of "1.2 Revenue"). Nothing for a name that starts with one of those. */
export function leadingCode(name: string): string {
  const [first = ""] = name.trim().split(CODE_END);
  const letters = first.replace(/\d+$/, "");
  return letters === "" ? first : letters;
}

/** How many modules must share a code for it to be a group: three, and at least one in fifty of the model's modules. */
export const PREFIX_SHARE = { least: 3, part: 0.02 } as const;

/** The codes enough modules share, each a group, compared whatever their case and named as the first module writes it.
 * Every other module, and one whose name starts with no code, is under "Other". */
function byPrefix(model: MapModel): Grouping | undefined {
  const keyOf = new Map<number, string>();
  const codes = new Map<string, { code: string; count: number }>();
  for (const module of model.modules) {
    const code = leadingCode(module.name);
    if (code === "") continue;
    const key = code.toUpperCase();
    keyOf.set(module.id, key);
    const known = codes.get(key);
    if (known) known.count++;
    else codes.set(key, { code, count: 1 });
  }
  const least = Math.max(PREFIX_SHARE.least, Math.ceil(model.modules.length * PREFIX_SHARE.part));
  const shared = new Map([...codes].filter(([, { count }]) => count >= least).map(([key, { code }]) => [key, code]));
  if (!shared.size) return undefined;
  return grouped(model, { kind: "prefix", label: "Name prefix", source: "from module names", rest: OTHER }, module => shared.get(keyOf.get(module.id) ?? "") ?? OTHER);
}

/* ---------- role in the data flow: what the model does with a module ---------- */

/** How many other modules make "several" that read a module. */
export const SEVERAL = 3;

/** What the model does with a module, as far as its tables say. */
export interface Flow {
  /** Its line items that are no heading (format No Data), how many of those have a formula, and how many headings it has. */
  items: number;
  formulas: number;
  headings: number;
  /** How many other modules have a formula that reads it. */
  readers: number;
  /** Whether an import loads into it, and whether an export takes it. */
  imported: boolean;
  exported: boolean;
  /** How many lists or subsets it applies to. */
  lists: number;
  /** Whether a page built on the model shows it, where the result says. */
  onPage: boolean;
}

/** Each module's flow, by its ID. Who reads a module is counted from the formulas' links: one from a line item of the
 * module (or the module itself) to a line item of another is that other module reading it. */
export function flowsOf(model: MapModel): Map<number, Flow> {
  const readers = new Map<number, Set<number>>();
  for (const [from, to, kind] of model.formulaEdges) {
    if (kind !== "reference") continue;
    const read = model.moduleOf(model.node(from));
    const reader = model.moduleOf(model.node(to));
    if (read === undefined || reader === undefined || read === reader) continue;
    let set = readers.get(read);
    if (!set) readers.set(read, set = new Set());
    set.add(reader);
  }
  const flows = new Map<number, Flow>();
  for (const module of model.modules) {
    const all = model.itemsOf(module.id);
    const items = all.filter(item => item.format?.toUpperCase() !== "NONE");
    const actions = model.actionsOf(module.id);
    flows.set(module.id, {
      items: items.length, formulas: items.filter(item => (item.formula ?? "").trim() !== "").length, headings: all.length - items.length, readers: readers.get(module.id)?.size ?? 0,
      imported: actions.some(({ kind }) => kind === "import_target"), exported: actions.some(({ kind }) => kind === "export_source"),
      lists: (module.dimensions ?? []).filter(id => ["list", "subset"].includes(model.node(id)?.kind ?? "")).length,
      onPage: (module.apps?.length ?? 0) > 0,
    });
  }
  return flows;
}

/** "3 of its 5 line items have", "1 of its 1 line item has": a part of the line items, and the verb that goes with it. */
const partOf = (part: number, items: number): string => `${part} of its ${items} ${items === 1 ? "line item" : "line items"} ${part === 1 ? "has" : "have"}`;

/** A module's role in the data flow, and why, by what the model does with it and never by its name. The first rule that
 * holds gives it:
 * 1. It has no line items but headings: nothing tells its role ("No line items").
 * 2. Data: an import loads into it, and most of its line items have no formula. The model takes data in there.
 * 3. Output: an export takes it.
 * 4. System: several other modules (three or more) read it, and it applies to no list: a setting, or a lookup by time
 *    alone, that the rest of the model reads.
 * 5. Input: most of its line items have no formula, and no import loads into it: people type into it.
 * 6. Calculation: half or more of its line items have a formula, and another module reads it.
 * 7. Output: half or more of its line items have a formula, and no other module reads it: results end up there.
 * Line items are counted without the headings among them (format No Data). */
export function roleOf(flow: Flow): { role: string; why: string } {
  const { items, formulas, readers } = flow;
  const plain = items - formulas;
  const shown = flow.onPage ? "; a page shows it" : "";
  if (items === 0) return { role: NO_LINE_ITEMS, why: `${flow.headings ? "Its line items are all headings" : "It has no line items"}, so nothing tells its role.` };
  if (flow.imported && plain * 2 > items) return { role: ROLES.data, why: `An import loads into it, and ${partOf(plain, items)} no formula.` };
  if (flow.exported) return { role: ROLES.output, why: "An export takes it." };
  if (readers >= SEVERAL && flow.lists === 0) return { role: ROLES.system, why: `${readers} other modules read it, and it applies to no list.` };
  if (plain * 2 > items) return { role: ROLES.input, why: `${partOf(plain, items)} no formula, and no import loads into it${shown}.` };
  const read = readers === 0 ? "no other module reads it" : readers === 1 ? "another module reads it" : `${readers} other modules read it`;
  return { role: readers > 0 ? ROLES.calculation : ROLES.output, why: `${partOf(formulas, items)} a formula, and ${read}${readers > 0 ? "" : shown}.` };
}

function byRole(model: MapModel): Grouping {
  const whyOf = new Map<number, string>();
  const roles = new Map<number, string>();
  for (const [id, flow] of flowsOf(model)) {
    const { role, why } = roleOf(flow);
    roles.set(id, role);
    whyOf.set(id, `${role}: ${why}`);
  }
  return grouped(model, { kind: "role", label: "Role in the data flow", source: "from the data flow", rest: NO_LINE_ITEMS, order: Object.values(ROLES), whyOf },
    module => roles.get(module.id) ?? NO_LINE_ITEMS);
}

/* ---------- app and main dimension ---------- */

/** The app whose pages show a module; "Several apps" where pages of more than one do, and "Not on any page" where none
 * does. Only where the result has the Module Usage table. */
function byApp(model: MapModel): Grouping | undefined {
  if (!model.graph.moduleFacts?.moduleUsage) return undefined;
  return grouped(model, { kind: "app", label: "App", source: "from Module Usage", rest: NO_PAGE, last: [SEVERAL_APPS, NO_PAGE] }, module => {
    const apps = module.apps ?? [];
    return apps.length === 0 ? NO_PAGE : apps.length === 1 ? apps[0] : SEVERAL_APPS;
  });
}

/** Whether a module has a time scale: one that says nothing, or Not Applicable, is none. */
const hasTime = (module: GraphNode): boolean => {
  const scale = (module.timeScale ?? "").trim();
  return scale !== "" && scale !== "-" && !/^not applicable$/i.test(scale);
};

/** The first list among what a module applies to, in the order its Applies To names them: a subset is its list, and
 * Time and Versions, which are no list, never count. Nothing for a module that applies to no list. */
function mainDimension(model: MapModel, module: GraphNode): string | undefined {
  for (const id of module.dimensions ?? []) {
    const node = model.node(id);
    if (node?.kind !== "list" && node?.kind !== "subset") continue;
    const list = node.kind === "subset" ? model.node(node.parent) ?? node : node;
    if (!/^(?:time|versions)$/i.test(list.name.trim())) return list.name;
  }
  return undefined;
}

/** A module's first list. One that applies to no list is under "Time only" where it has a time scale, and under "No
 * dimensions" where it has none either. */
function byDimension(model: MapModel): Grouping | undefined {
  if (!model.modules.some(module => mainDimension(model, module) !== undefined)) return undefined;
  return grouped(model, { kind: "dimension", label: "Main dimension", source: "from Applies To", rest: NO_DIMENSIONS, last: [TIME_ONLY, NO_DIMENSIONS] },
    module => mainDimension(model, module) ?? (hasTime(module) ? TIME_ONLY : NO_DIMENSIONS));
}

/* ---------- the groupings a model has, and the map's own pick ---------- */

/** The groupings a model has, in the switch's order. One that would put every module in one group is left out: a model
 * without a functional area, a heading row, a shared code or a list to apply to has none of those. App is there only
 * where the result has the Module Usage table, and a model without modules has none at all. */
export function groupingsOf(model: MapModel): Grouping[] {
  if (!model.modules.length) return [];
  return [byFunctionalArea(model), byHeadings(model), byPrefix(model), byRole(model), byApp(model), byDimension(model)].filter((each): each is Grouping => each !== undefined);
}

/** What groups a model well enough for the map to open on by itself: from 3 to 15 groups, none holding more than half
 * the modules, and no more than a fifth of them in the group of what the grouping cannot place. */
export const GOOD = { least: 3, most: 15, largest: 0.5, rest: 0.2 } as const;

export function isGood(grouping: Grouping): boolean {
  const total = grouping.groupOf.size;
  if (total === 0) return false;
  const sizes = new Map<string, number>();
  for (const group of grouping.groupOf.values()) sizes.set(group, (sizes.get(group) ?? 0) + 1);
  const largest = Math.max(...sizes.values());
  const rest = grouping.rest === undefined ? 0 : sizes.get(grouping.rest) ?? 0;
  return sizes.size >= GOOD.least && sizes.size <= GOOD.most && largest <= total * GOOD.largest && rest <= total * GOOD.rest;
}

/** The order the map tries groupings in when it opens. */
export const AUTOMATIC: readonly GroupingKind[] = ["functionalArea", "headings", "prefix", "role"];

/** The grouping the map opens on by itself: the first of `AUTOMATIC` that is good, and otherwise the role in the data
 * flow. Nothing for a model with no grouping at all. */
export function automaticGrouping(groupings: readonly Grouping[]): Grouping | undefined {
  const of = (kind: GroupingKind): Grouping | undefined => groupings.find(grouping => grouping.kind === kind);
  for (const kind of AUTOMATIC) {
    const grouping = of(kind);
    if (grouping && isGood(grouping)) return grouping;
  }
  return of("role") ?? groupings[0];
}
