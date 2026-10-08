import { entityKey, type UxEntityRef, type UxResolvedNames, type UxViewLayout } from "./card-reader/card-types.js";
import { list, text, type Obj } from "./util.js";

/** Names for one model, gathered the way Page Builder gets them: modules, saved views, dimension labels, lists and line
 * items from the widget data socket, and import/export/process names from the actions service. */
export interface ModelCatalog {
  modules: Map<string, string>;
  views: Map<string, { name: string; moduleId: string }>;
  dimensions: Map<string, string>;
  lineItems: Map<string, { name: string; moduleId: string }>;
  /** What the line items listing says of each line item's format, for those it says it of. */
  lineItemFormats: Map<string, LineItemFormat>;
  actions: Map<string, string>;
  pages: Map<string, string>;
  /** Modules whose line items were read. */
  lineItemModules: Set<string>;
  /** Modules whose line items could not be read, so a second pass does not ask again. */
  unreadableModules: Set<string>;
  /** True once the module list arrived: a module missing from it is not in the model (or not visible to this user). */
  moduleListLoaded: boolean;
  /** Each module's dimensions, in the model's order: those on neither axis are the section's context selectors. */
  moduleDimensions: Map<string, { id: string; name: string }[]>;
  /** Item names (shown or hidden items, a filter rule's fixed context items and the items it compares with) by item ID. */
  listItems: Map<string, string>;
  /** A module and dimension that named an item, by the item's entity type (`entityType`). Only ever used to choose which
   * dimension to ask first for another item of that type: no name comes from it. */
  itemSources: Map<string, ItemSource>;
  /** Saved views' rows, columns and pages (context selectors), from the view's own metadata. */
  viewLayouts: Map<string, UxViewLayout>;
}

/** A line item's format as far as naming needs it, from the listing's `lineItemInfo.format`. Page Builder tells line items
 * apart by its `dataType`, in the classic client's words: there
 * a line item is formatted as a list when `format.dataType === "ENTITY"`, and the list is `format.hierarchyEntityLongId`.
 * No capture confirms that the listing names the list by that key: the diagnostic log shows the keys it has. */
export interface LineItemFormat {
  /** NONE, NUMBER, BOOLEAN, DATE, TEXT, ENTITY (formatted as a list) or TIME_ENTITY (as a time period), when the format says. */
  dataType?: string;
  /** The list, or Time, whose items the line item's values are. */
  listId?: string;
  /** The format's keys, and those of an object under a key (`key{its, keys}`), for the diagnostic log: never its values. */
  keys: string[];
}
export interface ItemSource { moduleId: string; dimensionId: string }

export function emptyCatalog(): ModelCatalog {
  return { modules: new Map(), views: new Map(), dimensions: new Map(), lineItems: new Map(), lineItemFormats: new Map(), actions: new Map(), pages: new Map(),
    lineItemModules: new Set(), unreadableModules: new Set(), moduleListLoaded: false, moduleDimensions: new Map(), listItems: new Map(), itemSources: new Map(),
    viewLayouts: new Map() };
}

/** An entity's ID, an item's or a list's: an entity type times a thousand million plus an index (EntityLongIdHelper in the
 * classic client), so ten digits or more. */
const LONG_ID = /^[1-9]\d{9,17}$/;
/** The entity type of an ID: the digits before its last nine. The items of one list share it, and the model keeps which
 * list that is (the client looks it up, `entityTypeList.hierarchyEntityLongIds`): it cannot be worked out from the ID. */
export const entityType = (id: string): string => id.slice(0, -9);
const TIME = "20000000003";
/** The formats whose values are no items (the classic client's `dataTypes`). */
const PLAIN_TYPES = new Set(["NONE", "NUMBER", "BOOLEAN", "DATE", "TEXT"]);

const idText = (value: unknown): string | undefined =>
  (typeof value === "string" && value) || (typeof value === "number" && Number.isSafeInteger(value) ? String(value) : undefined);

/** `core:/{ws}:{model}/moduleViews`: `data[] = {id, name, views[] = {viewId, viewName, default}}`, `dimensions = {id: {label}}`. */
export function addModuleViews(catalog: ModelCatalog, json: unknown): void {
  const root = json && typeof json === "object" ? (json as Obj) : {};
  if (Array.isArray(root.data)) catalog.moduleListLoaded = true;
  for (const module of list(root.data)) {
    const moduleId = idText(module.id);
    const moduleName = text(module.name) ?? text(module.label);
    if (!moduleId || !moduleName) continue;
    catalog.modules.set(moduleId, moduleName);
    for (const view of list(module.views)) {
      const viewId = idText(view.viewId);
      const viewName = text(view.viewName);
      if (viewId && viewName && viewId !== moduleId) catalog.views.set(viewId, { name: viewName, moduleId });
    }
  }
  if (root.dimensions && typeof root.dimensions === "object") {
    for (const [id, value] of Object.entries(root.dimensions as Obj)) {
      const label = value && typeof value === "object" ? text((value as Obj).label) ?? text((value as Obj).name) : text(value);
      if (label && !catalog.dimensions.has(id)) catalog.dimensions.set(id, label);
    }
  }
}

/** `core://{ws}:{model}/lists`: `data[] = {id, name}`. */
export function addLists(catalog: ModelCatalog, json: unknown): void {
  for (const item of list((json as Obj | undefined)?.data)) {
    const id = idText(item.id);
    const listName = text(item.name) ?? text(item.label);
    if (id && listName) catalog.dimensions.set(id, listName);
  }
}

/** An object's keys in order. One that is no plain word is written `?`: only the listing's own vocabulary reaches the log. */
function keysOf(value: Obj, nested = true): string[] {
  return Object.keys(value).sort().map(key => {
    const word = /^[A-Za-z_]\w{0,39}$/.test(key) ? key : "?";
    const under: unknown = value[key];
    return nested && under && typeof under === "object" && !Array.isArray(under) ? `${word}{${keysOf(under as Obj, false).join(", ")}}` : word;
  });
}

/** The list of a list format is `hierarchyEntityLongId` in the classic client. Should the listing name it otherwise, it is
 * the format's one value that is a dimension of this model; with two such values nothing is taken for it. */
function lineItemFormat(format: Obj, catalog: ModelCatalog): LineItemFormat {
  const dataType = typeof format.dataType === "string" && /^[A-Z][A-Z_]{0,29}$/.test(format.dataType) ? format.dataType : undefined;
  const keys = keysOf(format);
  if (dataType && PLAIN_TYPES.has(dataType)) return { dataType, keys };
  if (dataType === "TIME_ENTITY") return { dataType, listId: TIME, keys };
  const named = idText(format.hierarchyEntityLongId);
  const dimensions = [...new Set(Object.values(format).flatMap(value => { const id = idText(value); return id && catalog.dimensions.has(id) ? [id] : []; }))];
  const listId = named && LONG_ID.test(named) ? named : dimensions.length === 1 ? dimensions[0] : undefined;
  return { ...(dataType ? { dataType } : {}), ...(listId ? { listId } : {}), keys };
}

/** `core://{ws}:{model}/modules/{moduleId}/lineItems`: `data[] = {lineItemId, lineItemLabel, lineItemInfo: {format}}`. */
export function addLineItems(catalog: ModelCatalog, moduleId: string, json: unknown): void {
  catalog.lineItemModules.add(moduleId);
  for (const item of list((json as Obj | undefined)?.data)) {
    const id = idText(item.lineItemId);
    const label = text(item.lineItemLabel);
    if (!id || !label) continue;
    catalog.lineItems.set(id, { name: label, moduleId });
    const format: unknown = item.lineItemInfo?.format;
    if (format && typeof format === "object" && !Array.isArray(format)) catalog.lineItemFormats.set(id, lineItemFormat(format as Obj, catalog));
  }
}

/** `core://{ws}:{model}/applicableModules`: `data[] = {id, label}`; returns the module IDs. */
export function applicableModuleIds(catalog: ModelCatalog, json: unknown): string[] {
  const ids: string[] = [];
  for (const item of list((json as Obj | undefined)?.data)) {
    const id = idText(item.id);
    if (!id) continue;
    ids.push(id);
    const label = text(item.label) ?? text(item.name);
    if (label && !catalog.modules.has(id)) catalog.modules.set(id, label);
  }
  return ids;
}

/** `core://{ws}:{model}/dimensions` with `{moduleIds}`: `modules[<moduleId>].dimensions[] = {id, label}`. */
export function addModuleDimensions(catalog: ModelCatalog, json: unknown): string[] {
  const modules = (json as Obj | undefined)?.modules;
  if (!modules || typeof modules !== "object") return [];
  const read: string[] = [];
  for (const [moduleId, entry] of Object.entries(modules as Obj)) {
    const dimensions = list((entry as Obj | undefined)?.dimensions).flatMap(dimension => {
      const id = idText(dimension.id);
      const label = text(dimension.label) ?? text(dimension.name);
      return id && label ? [{ id, name: label }] : [];
    });
    catalog.moduleDimensions.set(moduleId, dimensions);
    for (const { id, name } of dimensions) if (!catalog.dimensions.has(id)) catalog.dimensions.set(id, name);
    read.push(moduleId);
  }
  return read;
}

/** `core://{ws}:{model}/modules/{moduleId}/dimensions/{dimensionId}` with `accept: widget/selection` and `{itemIds}`:
 * `data[] = {itemId, label, index}` (Page Builder's filter and show/hide item chips). `source` is the module and dimension
 * that were asked: they are remembered as a place that names items of each named item's entity type. */
export function addSelections(catalog: ModelCatalog, json: unknown, source?: ItemSource): number {
  let named = 0;
  for (const item of list((json as Obj | undefined)?.data)) {
    const id = idText(item.itemId) ?? idText(item.id);
    const label = text(item.label) ?? text(item.name);
    if (!id || !label) continue;
    catalog.listItems.set(id, label);
    named++;
    if (source && LONG_ID.test(id) && !catalog.itemSources.has(entityType(id))) catalog.itemSources.set(entityType(id), source);
  }
  return named;
}

/** What an answer to that read holds, for the diagnostic log: how many entries, and the keys of the first (never a value). */
export function selectionShape(json: unknown): string {
  const data: unknown = (json as Obj | undefined)?.data;
  if (!Array.isArray(data)) return "no data list";
  const first: unknown = data[0];
  return `${data.length} entries${first && typeof first === "object" ? ` of {${keysOf(first as Obj, false).join(", ")}}` : ""}`;
}

/** A grid subscription's `metadata` message: `rows[]`/`cols[]` of `{dimensionId, label}` and `contextFilters[]` of
 * `{parent, label, contextFilterType}` (or `pages[]`), which Page Builder's Pivot data panel shows as-is. */
export function viewLayoutFromMetadata(json: unknown): UxViewLayout | undefined {
  const root = json && typeof json === "object" ? (json as Obj) : undefined;
  if (!root || (!Array.isArray(root.rows) && !Array.isArray(root.cols) && !Array.isArray(root.contextFilters) && !Array.isArray(root.pages))) return undefined;
  const axis = (items: unknown, idOf: (item: Obj) => unknown) => list(items).flatMap(item => {
    const id = idText(idOf(item));
    return id ? [{ id, name: text(item.label) ?? text(item.name) ?? BUILT_IN_DIMENSIONS[id] ?? id }] : [];
  });
  const pages = Array.isArray(root.contextFilters)
    ? axis(list(root.contextFilters).filter(item => item.contextFilterType !== "BRANCH_SYNC"), item => item.parent ?? item.dimensionId)
    : axis(root.pages, item => item.dimensionId ?? item.parent);
  return { rows: axis(root.rows, item => item.dimensionId ?? item.id), columns: axis(root.cols ?? root.columns, item => item.dimensionId ?? item.id), pages };
}

/** Actions service: `{imports: [{id, name}]}`, and likewise `exports` and `processes`. */
export function addActions(catalog: ModelCatalog, key: "imports" | "exports" | "processes", json: unknown): void {
  for (const item of list((json as Obj | undefined)?.[key])) {
    const id = idText(item.id);
    const actionName = text(item.name);
    if (id && actionName) catalog.actions.set(id, actionName);
  }
}

// System dimensions every model has; the socket's dimension labels normally name them too.
const BUILT_IN_DIMENSIONS: Record<string, string> = { "20000000012": "Line Items", "20000000003": "Time" };

/** A grid's metadata labels the dimensions it shows: those on rows and columns, its context selectors, and the lists it
 * filters by a branch of their hierarchy (`contextFilterType: "BRANCH_SYNC"`), which the saved view's layout leaves out.
 * Names the dimensions no other answer named; a name already known is kept, and the system dimensions keep theirs. */
export function addMetadataDimensionNames(catalog: ModelCatalog, json: unknown): void {
  const root = json && typeof json === "object" ? (json as Obj) : {};
  const entries: [unknown, string | undefined][] = [
    ...list(root.rows).map((item): [unknown, string | undefined] => [item.dimensionId ?? item.id, text(item.label) ?? text(item.name)]),
    ...list(root.cols ?? root.columns).map((item): [unknown, string | undefined] => [item.dimensionId ?? item.id, text(item.label) ?? text(item.name)]),
    ...list(root.contextFilters).map((item): [unknown, string | undefined] => [item.parent ?? item.dimensionId, text(item.label) ?? text(item.name)]),
    ...list(root.pages).map((item): [unknown, string | undefined] => [item.dimensionId ?? item.parent, text(item.label) ?? text(item.name)]),
  ];
  for (const [value, label] of entries) {
    const id = idText(value);
    if (id && label && LONG_ID.test(id) && !(id in BUILT_IN_DIMENSIONS) && !catalog.dimensions.has(id)) catalog.dimensions.set(id, label);
  }
}

/** The dimensions the references name that no answer named, in the references' order: no list or module dimension listing
 * labelled them, and they are no system dimension. */
export function unnamedDimensionIds(refs: readonly UxEntityRef[], catalog: ModelCatalog): string[] {
  return [...new Set(refs.filter(ref => ref.kind === "dimension" && LONG_ID.test(ref.id)).map(ref => ref.id))]
    .filter(id => !catalog.dimensions.has(id) && !(id in BUILT_IN_DIMENSIONS));
}

/** What the module views listing holds, for the diagnostic log: how many modules, and how many dimensions it labels. */
export function moduleViewsShape(json: unknown): string {
  const root = json && typeof json === "object" ? (json as Obj) : {};
  if (!Array.isArray(root.data)) return "no data list";
  const labelled = root.dimensions && typeof root.dimensions === "object" ? Object.keys(root.dimensions as Obj).length : 0;
  return `${root.data.length} modules, ${labelled} dimensions labelled`;
}

/** Page Builder's Current User: what a filter rule's context is fixed to for the Users dimension when the rule follows
 * whoever views the page (seen live, 7 Oct 2026, with Page Builder showing "Users: Current User"). It is no item of the
 * Users list, so no read names it, and the model's own Users list is the dimension it stands for. */
export const CURRENT_USER = "111999999997";
const USERS = "101999999999";
/** Items no read names, by their ID. */
const SYSTEM_ITEMS: Record<string, string> = { [CURRENT_USER]: "Current User" };
const itemName = (catalog: ModelCatalog, id: string): string | undefined => catalog.listItems.get(id) ?? SYSTEM_ITEMS[id];

type Found = { name: string; kind: Exclude<UxEntityRef["kind"], "unknown">; moduleId?: string };

function lookup(ref: UxEntityRef, catalog: ModelCatalog): Found | undefined {
  const dimension = (id: string): Found | undefined => {
    const label = catalog.dimensions.get(id) ?? BUILT_IN_DIMENSIONS[id];
    return label ? { name: label, kind: "dimension" } : undefined;
  };
  const lineItem = (id: string): Found | undefined => {
    const item = catalog.lineItems.get(id);
    return item ? { name: item.name, kind: "lineItem", moduleId: item.moduleId } : undefined;
  };
  const module = (id: string): Found | undefined => {
    const moduleName = catalog.modules.get(id);
    return moduleName ? { name: moduleName, kind: "module" } : undefined;
  };
  const listItem = (id: string): Found | undefined => {
    const named = itemName(catalog, id);
    return named ? { name: named, kind: "listItem" } : undefined;
  };
  switch (ref.kind) {
    case "module": return module(ref.id);
    case "lineItem": return lineItem(ref.id);
    case "dimension": return dimension(ref.id);
    case "view": {
      const view = catalog.views.get(ref.id);
      return view ? { name: view.name, kind: "view", moduleId: view.moduleId } : undefined;
    }
    case "action": {
      const actionName = catalog.actions.get(ref.id);
      return actionName ? { name: actionName, kind: "action" } : undefined;
    }
    case "page": {
      const pageName = catalog.pages.get(ref.id);
      return pageName ? { name: pageName, kind: "page" } : undefined;
    }
    case "listItem": return listItem(ref.id);
    // Filter rule items: line items, then lists, then modules, then an item that was named: a rule's
    // context can fix a dimension to one of its items in place of the dimension itself.
    case "unknown": return lineItem(ref.id) ?? dimension(ref.id) ?? module(ref.id) ?? listItem(ref.id);
    default: return undefined;
  }
}

export const NOT_IN_MODEL = "not in the model";

/** A module absent from the loaded module list, or a line item absent from its module's loaded list (or from a module that
 * is itself absent), is not in the model: deleted, or not visible to this user. Anything else not found is only unknown. */
function missingFromModel(ref: UxEntityRef, catalog: ModelCatalog): boolean {
  const moduleMissing = (id: string) => catalog.moduleListLoaded && !catalog.modules.has(id);
  if (ref.kind === "module") return moduleMissing(ref.id);
  if (ref.kind === "lineItem" && ref.moduleId) return moduleMissing(ref.moduleId) || catalog.lineItemModules.has(ref.moduleId);
  return false;
}

/** The result shape the card reader's naming code takes (`UxResolvedNames`), so that code applies it unchanged. A reference
 * that is missing from the model is named `<id> (not in the model)` so broken cards stand out. */
export function resolveFromCatalog(refs: readonly UxEntityRef[], catalog: ModelCatalog, missingReason = "Not found in the model's metadata."): UxResolvedNames {
  const result: UxResolvedNames = { names: {}, kinds: {}, modules: {}, unresolved: [], warnings: [] };
  const seen = new Set<string>();
  for (const ref of refs) {
    const key = entityKey(ref);
    if (seen.has(key)) continue;
    seen.add(key);
    const found = lookup(ref, catalog);
    if (!found) {
      const missing = missingFromModel(ref, catalog);
      if (missing) result.names[key] = `${ref.id} (${NOT_IN_MODEL})`;
      result.unresolved.push({ kind: ref.kind, id: ref.id,
        reason: missing ? "Not in the model: deleted, or not visible to this user." : ref.kind === "listItem" ? "List item names are not looked up." : missingReason });
      continue;
    }
    result.names[key] = found.name;
    if (ref.kind === "unknown") result.kinds[key] = found.kind;
    const layout = ref.kind === "view" ? catalog.viewLayouts.get(ref.id) : undefined;
    if (layout) (result.views ??= {})[key] = layout;
    if (found.moduleId) {
      const moduleName = catalog.modules.get(found.moduleId);
      result.modules[key] = { moduleId: found.moduleId, ...(moduleName ? { moduleName } : {}) };
    }
  }
  return result;
}

/** Every filter rule of the cards' grid sections, with the axis it filters and its card's ID. */
function filterRules(cards: readonly unknown[]): { condition: Obj; axis: Obj; cardId: string }[] {
  const conditionsOf = (node: unknown): Obj[] => {
    if (!node || typeof node !== "object") return [];
    const branch = node as Obj;
    return [...list(branch.conditions), ...list(branch.groups).flatMap(conditionsOf)];
  };
  return cards.flatMap(card => list((card as Obj)?.grid?.regions).flatMap(region => ["rows", "columns"].flatMap(name => {
    const axis: Obj | undefined = region[name];
    return axis ? conditionsOf(axis.filter).map(condition => ({ condition, axis, cardId: String((card as Obj).id) })) : [];
  })));
}

/** A rule's selected items against what the catalog names. A rule stores its line item together with its context: a
 * dimension in it follows the page's selection, and an ID that is none of these is taken for one item a dimension is fixed
 * to (the fixed form was not captured). */
function ruleItems(condition: Obj, catalog: ModelCatalog): { lineItems: string[]; dimensions: string[]; unknown: string[] } {
  const ids = list(condition.selectedItems).map(item => String(item.id));
  const dimension = (id: string) => catalog.dimensions.has(id) || id in BUILT_IN_DIMENSIONS;
  return { lineItems: ids.filter(id => catalog.lineItems.has(id)), dimensions: ids.filter(dimension),
    unknown: ids.filter(id => !catalog.lineItems.has(id) && !dimension(id) && !catalog.modules.has(id) && itemName(catalog, id) === undefined) };
}

/** IDs in filter rules that may be line items of a module not read yet, with the dimensions of the axis each rule filters.
 * A rule has one line item: once that is known, anything else unnamed in the rule is its context, not a line item to
 * look for. `rules` are the same IDs, rule by rule. */
export function unresolvedFilterItems(cards: readonly unknown[], catalog: ModelCatalog): { itemIds: Set<string>; axisDimensionIds: Set<string>; rules: string[][] } {
  const itemIds = new Set<string>();
  const axisDimensionIds = new Set<string>();
  const rules: string[][] = [];
  for (const { condition, axis } of filterRules(cards)) {
    const { lineItems, unknown } = ruleItems(condition, catalog);
    if (lineItems.length || !unknown.length) continue;
    unknown.forEach(id => itemIds.add(id));
    rules.push(unknown);
    for (const entry of list(axis.dimensions)) if (entry.dimension?.id) axisDimensionIds.add(String(entry.dimension.id));
  }
  return { itemIds, axisDimensionIds, rules };
}

/** IDs and entity types, which are digits without a leading zero, in the order of their numbers. They are not read as
 * numbers: an ID can have more digits than a number holds exactly. */
const byNumber = (a: string, b: string): number => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0);
/** As many modules with line items must have been read before their IDs are taken to say anything of the other modules. */
const TELLING_MODULES = 3;

/** How the search for the line items of filter rules goes on (analyse.ts `findFilterLineItems`). */
export interface FilterLineItemSearch {
  /** The IDs that are looked for in every module not read yet. */
  everywhere: string[];
  /** The IDs that are looked for in the candidate modules only: those of the rules that hold an ID that is ruled out. */
  candidatesOnly: string[];
  /** The IDs that are ruled out: each with the module that has the line items of its entity type and does not list it. */
  ruledOut: { id: string; moduleId: string }[];
  /** The modules to read next, as many as asked for at most: the candidates, then those of the other modules that the
   * bracket chose, then the first of the rest. None when nothing is left to read for the IDs. */
  modules: string[];
  /** How many modules are still to be read for the IDs, those given here among them. */
  toRead: number;
  /** How many of them the bracket chose. */
  bracketed: number;
  /** For the diagnostic log: what the modules read so far say of the two things taken from the IDs. */
  evidence: string;
}

/** Where to look next for the IDs in filter rules that may be line items. `rules` are those IDs rule by rule
 * (`unresolvedFilterItems`). `candidates` and `others` are the modules whose line items were not read yet: those the model
 * names for the filtered dimensions, and the other modules of its list, each in its order.
 * Two things are taken from the IDs themselves (an ID is an entity type and an index, `entityType`). No capture confirms
 * either, so each is used only as far as the modules read so far bear it out, and never on fewer than TELLING_MODULES
 * modules that have line items; the diagnostic log says what they show.
 * - The line items of a module share an entity type that no other module's have. While every module read shows that, an ID
 *   whose entity type is that of a module read, which does not list it, is ruled out: it should be a line item of no
 *   module. A rule holds one line item, so the other IDs of a rule that holds such an ID are its context. Nothing proves
 *   that two modules never share an entity type, so this only spares the other modules: the IDs of such a rule are still
 *   looked for in every candidate module, where they were looked for before the other modules were searched at all.
 * - Module IDs and those entity types rise together, as they would if both were numbered as the model's objects are made.
 *   While the modules read show that too, the module of an entity type lies between the two of them whose types bracket
 *   it: of the other modules, the unread ones there are read first, spread evenly so that each answer narrows the bracket.
 * The second only orders the search, and only its second part: the candidates are read before any module it chooses, in
 * the model's order, as they were read before the other modules were searched at all. Where it is wrong, the module is
 * found later among the other modules, and no candidate is read later for it. Neither names anything: a name comes only
 * from a listing that holds the very ID. */
export function filterLineItemSearch(rules: readonly (readonly string[])[], candidates: readonly string[], others: readonly string[], catalog: ModelCatalog,
  size: number): FilterLineItemSearch {
  // The module of each entity type among the line items read, and back, and whether every module has one type of its own.
  const moduleOf = new Map<string, string>();
  const typeOf = new Map<string, string>();
  let own = true;
  for (const [id, { moduleId }] of catalog.lineItems) {
    const type = entityType(id);
    own &&= LONG_ID.test(id) && (moduleOf.get(type) ?? moduleId) === moduleId && (typeOf.get(moduleId) ?? type) === type;
    moduleOf.set(type, moduleId);
    typeOf.set(moduleId, type);
  }
  // The modules read that have line items, in the order of their IDs, each with its entity type.
  const known = [...typeOf].sort(([a], [b]) => byNumber(a, b));
  const telling = own && known.length >= TELLING_MODULES;
  const rising = known.every(([, type], index) => index === 0 || byNumber(known[index - 1][1], type) < 0);
  /** The module that rules an ID out, when one does. (An ID too short to have an entity type is never ruled out: while
   * every module has a type of its own, every line item read has an ID long enough to have one.) */
  const rulesOut = (id: string): string | undefined => (telling ? moduleOf.get(entityType(id)) : undefined);
  const idsOf = (some: readonly (readonly string[])[]) => [...new Set(some.flat())];
  const everywhere = idsOf(rules.filter(rule => !rule.some(id => rulesOut(id))));
  const candidatesOnly = idsOf(rules.filter(rule => rule.some(id => rulesOut(id)))).filter(id => !everywhere.includes(id));
  const ruledOut = candidatesOnly.flatMap(id => {
    const moduleId = rulesOut(id);
    return moduleId ? [{ id, moduleId }] : [];
  });

  const unread = [...new Set([...candidates, ...others])];
  // The bracket chooses among the other modules, for the places that the candidates leave.
  const named = new Set(candidates);
  const places = size - named.size;
  const chosen: string[] = [];
  if (telling && rising && places > 0) {
    const sorted = unread.filter(id => !named.has(id)).sort(byNumber);
    // The unread modules between each pair of neighbours, among the modules read, that an entity type looked for falls between.
    const brackets = new Map<string, string[]>();
    for (const type of new Set(everywhere.filter(id => LONG_ID.test(id)).map(entityType))) {
      const above = known.findIndex(([, other]) => byNumber(other, type) > 0);
      const [lower, upper] = [(above < 0 ? known.at(-1) : known[above - 1])?.[0], known[above]?.[0]];
      const between = sorted.filter(id => (!lower || byNumber(id, lower) > 0) && (!upper || byNumber(id, upper) < 0));
      if (between.length) brackets.set(`${lower}|${upper}`, between);
    }
    // Each bracket has its part of the reads, the first ones one more while the reads do not divide evenly.
    const lists = [...brackets.values()];
    lists.forEach((between, index) => {
      const count = Math.min(between.length, Math.floor(places / lists.length) + (index < places % lists.length ? 1 : 0));
      for (let k = 1; k <= count; k++) chosen.push(between[Math.floor(k * between.length / (count + 1))]);
    });
  }
  const evidence = !own ? "in the modules read, a module's line items do not have one entity type of their own"
    : !telling ? `fewer than ${TELLING_MODULES} modules with line items were read`
      : rising ? `in the modules read, module IDs and line item entity types rise together (${known.length} modules with line items)`
        : "in the modules read, module IDs and line item entity types do not rise together";
  // Every module not read yet while an ID is looked for everywhere; the candidates alone for the rules with an ID ruled out.
  const rest = everywhere.length ? unread : candidatesOnly.length ? candidates : [];
  const ahead = [...rest.filter(id => named.has(id)), ...chosen];
  return { everywhere, candidatesOnly, ruledOut, modules: [...ahead, ...rest.filter(id => !named.has(id) && !chosen.includes(id))].slice(0, size), toRead: rest.length,
    bracketed: chosen.length, evidence };
}

/** The item IDs of filter rules that no read has named yet. */
export interface FilterItemNeeds {
  /** Items a rule's context is fixed to, by the module of the rule's line item: they are items of that module's dimensions.
   * `unlikely` are the dimensions the same rules filter or leave to the page's selection: a rule's fixed item is not one
   * of theirs, but another rule's may be, so they are asked last. */
  context: { moduleId: string; itemIds: string[]; unlikely: string[] }[];
  /** Values a rule compares its line item with, where they are items: by line item, with the list it is formatted as when
   * the listing said. */
  values: { lineItemId: string; moduleId: string; listId?: string; itemIds: string[] }[];
  /** Line items whose rules compare them with values that look like IDs, as many as `values`, while the listing does not
   * say what their values are: nothing is asked about those, and they stay as they are. For the diagnostic log. */
  unsaid: { lineItemId: string; values: number }[];
}

/** Those of a rule's values that look like an entity's ID. A rule holds every value as text, a number as much as an item,
 * so only the line item's format tells the two apart. */
const idValues = (condition: Obj): string[] => (Array.isArray(condition.values) ? condition.values as unknown[] : [])
  .flatMap(value => ((typeof value === "string" || typeof value === "number") && LONG_ID.test(String(value)) ? [String(value)] : []));

/** Whether the listing says a line item's values are items: it is formatted as a list or a time period, or its format
 * names a list. The classic client's filter editor picks its value editor by the same test (view/FilterV2/Condition.js:
 * an item of `hierarchyEntityLongId` for ENTITY, a period for TIME_ENTITY). */
const holdsItems = (format: LineItemFormat | undefined): boolean => format?.listId !== undefined || format?.dataType === "ENTITY";

/** Those of a rule's values that are items: the values that look like an ID, of a line item whose values the listing says
 * are items. Under any other format, or none, a value is never taken for an item, whatever it looks like. */
function comparedItems(condition: Obj, format: LineItemFormat | undefined): string[] {
  return holdsItems(format) ? idValues(condition) : [];
}

export function filterItemNeeds(cards: readonly unknown[], catalog: ModelCatalog): FilterItemNeeds {
  const context = new Map<string, { itemIds: Set<string>; unlikely: Set<string> }>();
  const values = new Map<string, { moduleId: string; listId?: string; itemIds: Set<string> }>();
  const unsaid = new Map<string, Set<string>>();
  for (const { condition, axis } of filterRules(cards)) {
    const { lineItems, dimensions, unknown } = ruleItems(condition, catalog);
    if (lineItems.length !== 1) continue;
    const [lineItemId] = lineItems;
    const { moduleId } = catalog.lineItems.get(lineItemId)!;
    if (unknown.length) {
      const group = context.get(moduleId) ?? { itemIds: new Set<string>(), unlikely: new Set<string>() };
      unknown.forEach(id => group.itemIds.add(id));
      for (const id of [...dimensions, ...list(axis.dimensions).flatMap(entry => (entry.dimension?.id ? [String(entry.dimension.id)] : []))]) group.unlikely.add(id);
      context.set(moduleId, group);
    }
    const format = catalog.lineItemFormats.get(lineItemId);
    const unnamed = comparedItems(condition, format).filter(id => itemName(catalog, id) === undefined);
    if (unnamed.length) {
      const group = values.get(lineItemId) ?? { moduleId, ...(format?.listId ? { listId: format.listId } : {}), itemIds: new Set<string>() };
      unnamed.forEach(id => group.itemIds.add(id));
      values.set(lineItemId, group);
    }
    // A plain format says its values are no items; one that is not given, or says nothing known, leaves it unsaid.
    if (!holdsItems(format) && !(format?.dataType && PLAIN_TYPES.has(format.dataType))) {
      for (const id of idValues(condition)) unsaid.set(lineItemId, (unsaid.get(lineItemId) ?? new Set<string>()).add(id));
    }
  }
  return { context: [...context].map(([moduleId, group]) => ({ moduleId, itemIds: [...group.itemIds], unlikely: [...group.unlikely] })),
    values: [...values].map(([lineItemId, group]) => ({ lineItemId, moduleId: group.moduleId, ...(group.listId ? { listId: group.listId } : {}), itemIds: [...group.itemIds] })),
    unsaid: [...unsaid].map(([lineItemId, ids]) => ({ lineItemId, values: ids.size })) };
}

/** Puts the names of the items a rule compares its line item with in place of their IDs, in card details that have been
 * named. A value stays as it is unless it is such an item (`comparedItems`) and the model named exactly that ID. */
export function nameFilterValues<T extends { cards: readonly unknown[] }>(details: T, catalog: ModelCatalog): T {
  for (const { condition } of filterRules(details.cards)) {
    const { lineItems } = ruleItems(condition, catalog);
    if (lineItems.length !== 1) continue;
    const items = new Set(comparedItems(condition, catalog.lineItemFormats.get(lineItems[0])));
    if (items.size) condition.values = (condition.values as unknown[]).map(value => (items.has(String(value)) ? itemName(catalog, String(value)) ?? value : value));
  }
  return details;
}

/** A rule's context fixed to Current User, in card details whose rules were read (card-naming.ts `explainFilterRules`),
 * as Page Builder shows it: the Users dimension, with Current User as its selection. The model's own name for its Users
 * list is used where an answer gave one. */
export function describeSystemContext<T extends { cards: readonly unknown[] }>(details: T, catalog: ModelCatalog): T {
  for (const { condition } of filterRules(details.cards)) {
    if (!Array.isArray(condition.filterContext)) continue;
    condition.filterContext = (condition.filterContext as Obj[]).map(entry => (entry.item?.id === CURRENT_USER
      ? { dimension: { kind: "dimension", id: USERS, name: catalog.dimensions.get(USERS) ?? "Users" }, selection: "Current User" } : entry));
  }
  return details;
}

/** For the diagnostic log, IDs only: each rule that still holds an item nothing named, as what its selected items are, in
 * their order, with its card. It shows whether the unnamed one stands where a line item or where a context item would. */
export function unnamedFilterRules(cards: readonly unknown[], catalog: ModelCatalog): string[] {
  const kind = (id: string) => {
    const lineItem = catalog.lineItems.get(id);
    return lineItem ? `line item ${id} of module ${lineItem.moduleId}` : catalog.dimensions.has(id) || id in BUILT_IN_DIMENSIONS ? `dimension ${id}`
      : catalog.modules.has(id) ? `module ${id}` : itemName(catalog, id) !== undefined ? `item ${id}` : `unnamed ${id}`;
  };
  return [...new Set(filterRules(cards).filter(({ condition }) => ruleItems(condition, catalog).unknown.length)
    .map(({ condition, cardId }) => `filter rule with an unnamed item (card ${cardId}): ${list(condition.selectedItems).map(item => kind(String(item.id))).join(", ")}`))];
}

/** For the diagnostic log: what the line items listing said of a line item's format (its keys, its data type and the
 * dimension its values are items of; no other value). It shows a live run's reader how the listing names a list format. */
export function describeFormat(lineItemId: string, catalog: ModelCatalog): string {
  const format = catalog.lineItemFormats.get(lineItemId);
  if (!format) return `filter line item ${lineItemId}: no format in the line items listing`;
  return `filter line item ${lineItemId}: format {${format.keys.join(", ")}}${format.dataType ? `, data type ${format.dataType}` : ""}`
    + (format.listId ? `, items of dimension ${format.listId}` : format.dataType === "ENTITY" ? ", no list named" : "");
}
