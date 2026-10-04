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
  /** Item names (shown or hidden items, filter context items) by item ID. */
  listItems: Map<string, string>;
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

export function emptyCatalog(): ModelCatalog {
  return { modules: new Map(), views: new Map(), dimensions: new Map(), lineItems: new Map(), lineItemFormats: new Map(), actions: new Map(), pages: new Map(),
    lineItemModules: new Set(), unreadableModules: new Set(), moduleListLoaded: false, moduleDimensions: new Map(), listItems: new Map(), viewLayouts: new Map() };
}

/** An entity's ID, an item's or a list's: an entity type times a thousand million plus an index (EntityLongIdHelper in the
 * classic client), so ten digits or more. */
const LONG_ID = /^[1-9]\d{9,17}$/;
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
 * `data[] = {itemId, label, index}` (Page Builder's filter and show/hide item chips). */
export function addSelections(catalog: ModelCatalog, json: unknown): number {
  let named = 0;
  for (const item of list((json as Obj | undefined)?.data)) {
    const id = idText(item.itemId) ?? idText(item.id);
    const label = text(item.label) ?? text(item.name);
    if (id && label) { catalog.listItems.set(id, label); named++; }
  }
  return named;
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
    case "listItem": {
      const itemName = catalog.listItems.get(ref.id);
      return itemName ? { name: itemName, kind: "listItem" } : undefined;
    }
    // Filter rule items: SAM's resolver order (line items, then lists, then modules).
    case "unknown": return lineItem(ref.id) ?? dimension(ref.id) ?? module(ref.id);
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

/** IDs in filter conditions that no loaded listing names yet, with the dimensions of the axis each filters. */
export function unresolvedFilterItems(cards: readonly unknown[], catalog: ModelCatalog): { itemIds: Set<string>; axisDimensionIds: Set<string> } {
  const itemIds = new Set<string>();
  const axisDimensionIds = new Set<string>();
  const known = (id: string) => catalog.lineItems.has(id) || catalog.dimensions.has(id) || catalog.modules.has(id) || id in BUILT_IN_DIMENSIONS;
  const conditionsOf = (node: unknown): Obj[] => {
    if (!node || typeof node !== "object") return [];
    const branch = node as Obj;
    return [...list(branch.conditions), ...list(branch.groups).flatMap(conditionsOf)];
  };
  for (const card of cards) {
    for (const region of list((card as Obj)?.grid?.regions)) {
      for (const axis of ["rows", "columns"]) {
        const detail: Obj | undefined = region[axis];
        const missing = conditionsOf(detail?.filter).flatMap(condition => list(condition.selectedItems)).map(item => String(item.id)).filter(id => !known(id));
        if (!missing.length) continue;
        missing.forEach(id => itemIds.add(id));
        for (const entry of list(detail?.dimensions)) if (entry.dimension?.id) axisDimensionIds.add(String(entry.dimension.id));
      }
    }
  }
  return { itemIds, axisDimensionIds };
}

/** For the diagnostic log: what the line items listing said of a line item's format (its keys, its data type and the
 * dimension its values are items of; no other value). It shows a live run's reader how the listing names a list format. */
export function describeFormat(lineItemId: string, catalog: ModelCatalog): string {
  const format = catalog.lineItemFormats.get(lineItemId);
  if (!format) return `filter line item ${lineItemId}: no format in the line items listing`;
  return `filter line item ${lineItemId}: format {${format.keys.join(", ")}}${format.dataType ? `, data type ${format.dataType}` : ""}`
    + (format.listId ? `, items of dimension ${format.listId}` : format.dataType === "ENTITY" ? ", no list named" : "");
}
