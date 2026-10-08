import { entityKey, type UxCardSource, type UxEntityRef, type UxPageCardDetails, type UxResolvedNames } from "./card-types.js";

/** Name handling shared by the MCP service and the page analyzer extension: both resolve names their own way
 * (Integration metadata or the Page Builder socket) and then apply them to card descriptions here. */
const ENTITY_KINDS = new Set(["module", "lineItem", "dimension", "listItem", "view", "action", "page", "unknown"]);
/** Fill names (and a resolved kind or owning module) on every UxEntityRef-shaped object; nothing else changes. */
export function applyNames<T>(value: T, resolved: UxResolvedNames): T {
  const visit = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(visit);
    if (!node || typeof node !== "object") return node;
    const copy: Record<string, unknown> = Object.fromEntries(Object.entries(node).map(([key, child]) => [key, visit(child)]));
    if (typeof copy.kind === "string" && ENTITY_KINDS.has(copy.kind) && typeof copy.id === "string") {
      const key = entityKey(copy as unknown as UxEntityRef);
      if (copy.name === undefined && resolved.names[key] !== undefined) copy.name = resolved.names[key];
      if (copy.kind === "unknown" && resolved.kinds[key]) copy.resolvedKind = resolved.kinds[key];
      const owner = resolved.modules[key];
      if (owner) {
        copy.moduleId ??= owner.moduleId;
        if (owner.moduleName && copy.moduleId === owner.moduleId) copy.moduleName = owner.moduleName;
      }
    }
    return copy;
  };
  return visit(value) as T;
}
/** A filter rule stores its line item and filter context together (observed in Page Builder, 27 Sep 2026): a dimension
 * in that list means "- current -", the page selection. The line item comes last, after the context in Page Builder's
 * order (seen live, 7 Oct 2026: Time, Users and Quarter, then the line item). Derived when names established every
 * entry's kind; where they did not, when the last entry is the rule's one line item, and an entry of unknown kind is then
 * an item the context is fixed to. */
export function explainFilterRules<T>(value: T): T {
  const kindOf = (ref: Record<string, unknown>) => ref.kind === "unknown" ? ref.resolvedKind : ref.kind;
  const visit = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(visit);
    if (!node || typeof node !== "object") return node;
    const copy: Record<string, unknown> = Object.fromEntries(Object.entries(node).map(([key, child]) => [key, visit(child)]));
    const items = copy.selectedItems;
    // Only filter rule conditions: sorts also carry selectedItems (the header they sort by).
    const isFilterRule = typeof copy.operator === "string" && Array.isArray(copy.values);
    if (isFilterRule && Array.isArray(items) && items.length && items.every(item => item && typeof item === "object")) {
      const refs = items as Record<string, unknown>[];
      const lineItems = refs.filter(ref => kindOf(ref) === "lineItem");
      const known = refs.every(ref => typeof kindOf(ref) === "string");
      if (known || (lineItems.length === 1 && lineItems[0] === refs[refs.length - 1])) {
        if (lineItems.length === 1) copy.filterLineItem = lineItems[0];
        const context = refs.filter(ref => kindOf(ref) !== "lineItem")
          .map(ref => kindOf(ref) === "dimension" ? { dimension: ref, selection: "current" } : { item: ref });
        if (context.length) copy.filterContext = context;
      }
    }
    return copy;
  };
  return visit(value) as T;
}
const SAVED_VIEW_NOTE = "Saved view: its filters, sorts and show/hide are defined on the view in the model, not on the page, and Integration metadata does not include them.";
/** A saved-view source gains its owning module and dimension layout from name resolution. */
export function describeSavedViews(details: UxPageCardDetails, resolved?: UxResolvedNames): UxPageCardDetails {
  for (const card of details.cards) for (const source of (card.sources ?? []) as UxCardSource[]) {
    const view = source.view;
    if (!view) continue;
    if (!source.module && view.moduleId) source.module = { kind: "module", id: view.moduleId, ...(view.moduleName ? { name: view.moduleName } : {}) };
    const layout = resolved?.views?.[entityKey(view)];
    if (layout) source.viewLayout = layout;
    source.viewNote = SAVED_VIEW_NOTE;
  }
  return details;
}
/** The order the service applies them in: names first, filter rules explained only with names, saved views always. */
export function nameCardDetails(details: UxPageCardDetails, resolved?: UxResolvedNames): UxPageCardDetails {
  return describeSavedViews(resolved ? explainFilterRules(applyNames(details, resolved)) : details, resolved);
}
