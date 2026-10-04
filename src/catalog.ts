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
 * apart by its `dataType` (docs/research/card-formats-designer.md, sections 1 and 6), in the classic client's words: there
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
    const itemName = catalog.listItems.get(id);
    return itemName ? { name: itemName, kind: "listItem" } : undefined;
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
    // Filter rule items: SAM's resolver order (line items, then lists, then modules), then an item that was named: a rule's
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

/** The same result shape as SAM's Integration name resolver, so the shared naming code applies it unchanged. A reference
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
 * to (docs/research/card-details.md, section 2: the fixed form was not captured). */
function ruleItems(condition: Obj, catalog: ModelCatalog): { lineItems: string[]; dimensions: string[]; unknown: string[] } {
  const ids = list(condition.selectedItems).map(item => String(item.id));
  const dimension = (id: string) => catalog.dimensions.has(id) || id in BUILT_IN_DIMENSIONS;
  return { lineItems: ids.filter(id => catalog.lineItems.has(id)), dimensions: ids.filter(dimension),
    unknown: ids.filter(id => !catalog.lineItems.has(id) && !dimension(id) && !catalog.modules.has(id) && !catalog.listItems.has(id)) };
}

/** IDs in filter rules that may be line items of a module not read yet, with the dimensions of the axis each rule filters.
 * A rule has one line item: once that is known, anything else unnamed in the rule is its context, not a line item to
 * look for. */
export function unresolvedFilterItems(cards: readonly unknown[], catalog: ModelCatalog): { itemIds: Set<string>; axisDimensionIds: Set<string> } {
  const itemIds = new Set<string>();
  const axisDimensionIds = new Set<string>();
  for (const { condition, axis } of filterRules(cards)) {
    const { lineItems, unknown } = ruleItems(condition, catalog);
    if (lineItems.length || !unknown.length) continue;
    unknown.forEach(id => itemIds.add(id));
    for (const entry of list(axis.dimensions)) if (entry.dimension?.id) axisDimensionIds.add(String(entry.dimension.id));
  }
  return { itemIds, axisDimensionIds };
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

/** Those of a rule's values that look like an entity's ID. A rule holds every value as text, a number as much as an item
 * (docs/research/card-details.md, section 2), so only the line item's format tells the two apart. */
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
    const unnamed = comparedItems(condition, format).filter(id => !catalog.listItems.has(id));
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
    if (items.size) condition.values = (condition.values as unknown[]).map(value => (items.has(String(value)) ? catalog.listItems.get(String(value)) ?? value : value));
  }
  return details;
}

/** For the diagnostic log, IDs only: each rule that still holds an item nothing named, as what its selected items are, in
 * their order, with its card. It shows whether the unnamed one stands where a line item or where a context item would. */
export function unnamedFilterRules(cards: readonly unknown[], catalog: ModelCatalog): string[] {
  const kind = (id: string) => {
    const lineItem = catalog.lineItems.get(id);
    return lineItem ? `line item ${id} of module ${lineItem.moduleId}` : catalog.dimensions.has(id) || id in BUILT_IN_DIMENSIONS ? `dimension ${id}`
      : catalog.modules.has(id) ? `module ${id}` : catalog.listItems.has(id) ? `item ${id}` : `unnamed ${id}`;
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
