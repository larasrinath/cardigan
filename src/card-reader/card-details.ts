import { copyDocument, isObject, MAX_DEPTH, MAX_NODES, NATIVE_CARD_TYPES, UNSAFE_KEYS } from "./definition-json.js";
import { UxDefinitionError, type UxPageType } from "./definition-types.js";
import type {
  UxActionButtonDetail, UxAxisDetail, UxAxisDimension, UxCardDetail, UxCardPlacement, UxCardSource, UxChartDetail, UxConditionalFormatRule,
  UxContextSelector, UxEntityKind, UxEntityRef, UxFieldDetail, UxFilterCondition, UxFilterDetail, UxGridPivot, UxGridRegion, UxImageDetail,
  UxKpiDetail, UxKpiIndicator, UxNavigationDetail, UxPageCardDetails, UxPageContext, UxPivotPage, UxSlideSummary, UxTextDetail, UxUnrecognisedField,
} from "./card-types.js";

/* Tolerant read-only projection of native page cards. definition-editor.ts validates for authoring and throws on
 * unfamiliar content; this reader describes what is present and reports the rest as warnings or `unrecognised`.
 * It throws only for unsafe/unbounded JSON, a non-object root or missing page identity. Shapes follow
 * docs/research/ux-designer/definitions.md and the public designer bundle: axis description queries are v1
 * (`regions` keyed by region ID) or v2 (`rowAxis`/`columnAxis` child axes plus a `regions` array of grid sections). */

type Obj = Record<string, unknown>;
interface CardEntry { id: string; card: Obj; wrapper?: Obj }

// Local output bounds, not Anaplan limits.
const MAX_TEXT = 200;
const MAX_PLAIN_TEXT = 500;
const MAX_URL = 500;
const MAX_UNRECOGNISED = 60;
const MAX_ITEMS = 50;
const MAX_REFERENCES = 5_000;
const MAX_WARNINGS = 100;
const ENTITY_ID = /^[1-9]\d{9,15}$/;
const SENSITIVE = /token|secret|password|credential/i;
const REDACTED = "[redacted]";
const LINE_ITEMS_DIMENSION = "20000000012";
const IDENTITY = ["pageGuid", "appGuid", "name", "customerId", "workspaceId", "modelId"] as const;
const LAYOUT_TYPES = new Set(["BOARD", "BOARD_CONTENT", "BOARD_SECTION", "BOARD_ROW", "BOARD_COLUMN", "BOARD_COLUMN_SPACER", "BOARD_COLUMN_WIDGET_SPACER",
  "INSIGHT_PANEL", "GRIDPAGE", "REPORT", "SLIDE", "LINKED_SLIDE"]);
const PAGE_KEYS = new Set<string>([...IDENTITY, "widgets", "layout", "rows", "contextOptions", "widgetGuids", "modelCount", "modelInfo", "modelInfos",
  "modelStatus", "categoryGuid", "categoryUpdatedAt", "currentDraftVersionGuid", "currentPublishedVersionGuid", "publishedAt", "updatedAt", "createdAt",
  "isMyPage", "isFavorite", "isAlm", "restrictions", "pageType", "identifier", "navLinks", "defaultRelatedWidgetGuid", "pageMetadata"]);
const LAYOUT_KEYS = new Set(["id", "type", "areas", "syncScroll", "syncBrowser", "defaultContext", "contextFilterOrder"]);
const CARD_IDENTITY_KEYS = ["type", "clientGuid", "widgetGuid", "customerId", "modelId", "workspaceId", "validVersions", "defaultTitle", "description"];
const WRAPPER_KEYS = new Set(["widgetDefinition", "widgetGuid", "guid", "height", "showPreview"]);
const SOURCE_KEYS = new Set(["widgetGuid", "dataSourceId", "subEntityId", "dataSourceType", "axisDescriptionQuery", "viewDescription"]);
const ADQ_KEYS = new Set(["id", "version", "regions", "rowAxis", "columnAxis", "moduleId", "conditionalFormattingRules", "breakbackSelections"]);
const V2_REGION_KEYS = new Set(["id", "moduleId", "regionType", "columnAxisKey", "rowAxisKey", "coordinates", "offAxisDimensions"]);
const AXIS_KEYS = new Set(["dimensions", "filters", "raggedShows", "raggedHides"]);
const DIMENSION_KEYS = new Set(["id", "levels", "sorts", "totalsPosition", "shows", "hides", "reorder"]);
const LEAF_RULE_KEYS = new Set(["selectedItems", "operator", "values", "identifier", "axisKey"]);
const CF_REGION_KEYS = ["targetRegionId", "targetRegion", "targetRegionCoordinates", "valuesRegion", "valuesRegionCoordinates"];
const CF_KEYS = new Set(["type", "sourceIdentifier", "targetIdentifier", "pegs", ...CF_REGION_KEYS]);
const SELECTOR_FLAGS = ["visible", "syncedToPage", "editable", "enableMultiSelect", "syncOnSelection"] as const;
const SELECTOR_DATA = ["defaultValue", "selections", "filter", "itemHierarchyLevels", "parentItem", "resolutionPolicy", "ancestry"] as const;
const SELECTOR_KEYS = new Set<string>(["dimensionId", "scope", ...SELECTOR_FLAGS, ...SELECTOR_DATA]);
const BUTTON_KEYS = new Set(["id", "type", "name", "actionToken", "runAutomatically", "actionDriverId", "destinationListId", "disableCancelButton", "style", "description",
  "moduleId", "lineItemId"]);
const NAVIGATION_KEYS = ["pageIdentifier", "pageAppIdentifier", "pageName", "pageType", "pageLinkType", "isTargetPagePublished"];
const IMAGE_KEYS = ["sourceType", "scaleType", "imageName", "imageSource", "opacity", "imageAlign"];
const KPI_KEYS = ["textStyle", "paddingStyle", "numberScale", "showSparkline", "showSparklineTooltips", "sparklineTimePeriod", "sparklineColor",
  "sparklineColorTheme", "textColor", "textColorTheme"];
// Source oWt/nWt: flat KPI conditional formatting, used when the card has no conditionalFormatting object.
const KPI_CF_PEGS = [["min", "cfMinValue", "cfMinColor"], ["mid", "cfMidValue", "cfMidColor"], ["max", "cfMaxValue", "cfMaxColor"]] as const;
const KPI_CF_KEYS = ["cfSourceIdentifier", "cfTargetIdentifier", ...KPI_CF_PEGS.flatMap(([, value, color]) => [value, color])];
const CHART_SETTINGS = new Set(["showTooltips", "showDataLabels", "legendPosition", "isEditable"]);
const SAVED_KEYS = ["customizations", "lineItemConfigs", "branchSync"];
const SETTING_KEYS = new Set(["isReadOnly", "pivotEnabled", "csvExportEnabled", "allowFiltering", "allowSorting", "showListFunctions", "allowCopyAcross",
  "allowCopyDown", "allowCellHistory", "allowExpandOrCollapseRows", "allowChartCreation", "allowZeroSuppression", "showBackground", "showMaximize",
  "showCommenting", "textStyle", "numberScale", "paddingStyle", "horizontalLayout", "version", "defaultColumnWidth", "defaultColumnLabelHeight",
  "style", "align", "colour"]);
const PRESENTATION_KEYS = new Set(["widgetStyles", "actionWidgetStyle", "gridColumnWidths", "lineItemWidthOverrides", "timeDimensionWidthOverrides"]);
// Keys whose ID-like values name a model entity of a known kind inside otherwise raw data.
const REF_KEYS = new Map<string, UxEntityKind>([["moduleId", "module"], ["lineItemId", "lineItem"], ["dimensionId", "dimension"], ["listId", "dimension"],
  ["listItemId", "listItem"], ["viewId", "view"], ["savedViewId", "view"], ["actionId", "action"]]);

function fail(code: string, message: string): never { throw new UxDefinitionError(code, message); }
const text = (value: unknown): string | undefined => typeof value === "string" && value.length > 0 ? value : undefined;
const num = (value: unknown): number | undefined => typeof value === "number" && Number.isFinite(value) ? value : undefined;
const bool = (value: unknown): boolean | undefined => typeof value === "boolean" ? value : undefined;
const cap = (value: string, max = MAX_TEXT): string => value.length > max ? `${value.slice(0, max - 1)}…` : value;
const capped = (value: unknown): string | undefined => { const found = text(value); return found === undefined ? undefined : cap(found); };
const isScalar = (value: unknown): value is string | number | boolean => typeof value === "string" || typeof value === "number" || typeof value === "boolean";
const scalar = (value: string | number | boolean) => typeof value === "string" ? cap(value) : value;
const isEmpty = (value: unknown): boolean => value === undefined || value === null || value === ""
  || (Array.isArray(value) && value.length === 0) || (isObject(value) && Object.keys(value).length === 0);
const compact = <T extends object>(value: T): T => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
const idOf = (value: unknown): string | undefined => {
  const candidate = typeof value === "number" && Number.isSafeInteger(value) ? String(value) : value;
  return typeof candidate === "string" && ENTITY_ID.test(candidate) ? candidate : undefined;
};
// Entity type prefix: 101 list, 102 module (its default view), 114 line-item subset, 115 dashboard (modeling Ce).
const isModuleId = (id: string): boolean => Math.floor(Number(id) / 1e9) === 102;
const listed = (ids: string[]): string => `${ids.slice(0, 3).map(id => cap(id, 40)).join(", ")}${ids.length > 3 ? ` (+${ids.length - 3} more)` : ""}`;

/** Embedded JSON strings (chartConfig, text, actions, customizations...) get the same key/depth rules, but are reported, never thrown. */
function parseEmbedded(value: string): { ok: boolean; value?: unknown } {
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { return { ok: false }; }
  let count = 0;
  // JSON.parse keeps "__proto__" as an ordinary own key, so check it like the document copy does.
  const safe = (item: unknown, depth: number): boolean => {
    if (++count > MAX_NODES || depth > MAX_DEPTH) return false;
    if (Array.isArray(item)) return item.every(child => safe(child, depth + 1));
    return !isObject(item) || Object.entries(item).every(([key, child]) => !UNSAFE_KEYS.has(key) && safe(child, depth + 1));
  };
  return safe(parsed, 0) ? { ok: true, value: parsed } : { ok: false };
}

type RefExtra = Partial<Pick<UxEntityRef, "name" | "moduleId" | "actionType" | "dimensionId">>;

/** Every reference is returned as a fresh object and listed once by kind, ID and owning module. */
class Collector {
  readonly references: UxEntityRef[] = [];
  private readonly keys = new Set<string>();
  private readonly warnings: string[] = [];
  private droppedReferences = 0;
  private droppedWarnings = 0;
  ref(kind: UxEntityKind, id: string, extra: RefExtra = {}): UxEntityRef {
    const ref: UxEntityRef = compact({ kind, id: cap(id), name: extra.name === undefined ? undefined : cap(extra.name), moduleId: extra.moduleId,
      actionType: extra.actionType === undefined ? undefined : cap(extra.actionType), dimensionId: extra.dimensionId });
    const key = `${ref.kind}:${ref.id}:${ref.moduleId ?? ""}`;
    if (!this.keys.has(key)) {
      this.keys.add(key);
      if (this.references.length < MAX_REFERENCES) this.references.push({ ...ref });
      else this.droppedReferences++;
    }
    return ref;
  }
  warn(message: string): void {
    if (this.warnings.length < MAX_WARNINGS) this.warnings.push(cap(message));
    else this.droppedWarnings++;
  }
  finish(): string[] {
    if (this.droppedReferences) this.warnings.push(`${this.droppedReferences} further references were not listed for name resolution.`);
    if (this.droppedWarnings) this.warnings.push(`${this.droppedWarnings} further warnings were omitted.`);
    return this.warnings;
  }
}

/** Leaf paths of content SAM does not map. Values only for short primitives; credential-like keys/values redacted. */
class Unrecognised {
  readonly entries: UxUnrecognisedField[] = [];
  omitted = 0;
  add(path: string, value: unknown, depth = 0): void {
    if (isEmpty(value)) return;
    const key = path.slice(Math.max(path.lastIndexOf("."), path.lastIndexOf("[")) + 1);
    const valueType = Array.isArray(value) ? "array" : typeof value;
    if (SENSITIVE.test(key)) return this.push({ path, valueType, value: REDACTED });
    if (Array.isArray(value) || isObject(value)) {
      if (depth >= 6) return this.push({ path, valueType });
      if (Array.isArray(value)) value.forEach((item, index) => this.add(`${path}[${index}]`, item, depth + 1));
      else for (const [child, item] of Object.entries(value)) this.add(`${path}.${child}`, item, depth + 1);
      return;
    }
    const entry: UxUnrecognisedField = { path, valueType };
    if (typeof value === "string") { if (value.length <= MAX_TEXT) entry.value = SENSITIVE.test(value) ? REDACTED : value; }
    else if (isScalar(value)) entry.value = value;
    this.push(entry);
  }
  private push(entry: UxUnrecognisedField): void {
    if (this.entries.length < MAX_UNRECOGNISED) this.entries.push({ ...entry, path: cap(entry.path) });
    else this.omitted++;
  }
}

/** Bounded, redacted JSON copy. ID-like values under REF_KEYS become references (key without its `Id` suffix). */
function plain(value: unknown, out: Collector, moduleId?: string): unknown {
  let budget = 1_000;
  const visit = (item: unknown, depth: number, module: string | undefined): unknown => {
    if (item === null || item === undefined) return undefined;
    if (--budget < 0) return "[truncated]";
    if (typeof item === "string") return SENSITIVE.test(item) ? REDACTED : cap(item);
    if (typeof item !== "object") return item;
    if (depth >= 8) return "[nested]";
    if (Array.isArray(item)) {
      const list = item.slice(0, MAX_ITEMS).map(child => visit(child, depth + 1, module)).filter(child => child !== undefined);
      if (item.length > MAX_ITEMS) list.push(`[+${item.length - MAX_ITEMS} more]`);
      return list;
    }
    const source = item as Obj;
    const owner = idOf(source.moduleId) ?? module;
    const result: Obj = {};
    for (const [key, child] of Object.entries(source)) {
      if (SENSITIVE.test(key)) { result[key] = REDACTED; continue; }
      const kind = REF_KEYS.get(key);
      const id = kind && idOf(child);
      if (kind && id) {
        result[Object.hasOwn(source, key.slice(0, -2)) ? key : key.slice(0, -2)] = out.ref(kind, id, kind === "lineItem" ? { moduleId: owner } : {});
        continue;
      }
      const converted = visit(child, depth + 1, owner);
      if (!isEmpty(converted)) result[key] = converted;
    }
    return result;
  };
  return visit(value, 0, moduleId);
}

function identity(page: Obj, key: string): string {
  const value = page[key];
  if (typeof value !== "string" || value.length === 0) fail("UNSUPPORTED_DEFINITION", `${key} must be a nonempty string.`);
  return cap(value);
}

function cardEntries(pageType: UxPageType, page: Obj, out: Collector): CardEntry[] {
  const entries: CardEntry[] = [];
  const widgets = page.widgets;
  if (Array.isArray(widgets)) {
    if (pageType !== "GRID-PAGE") out.warn("Page widgets are an array; they are described as worksheet-style wrappers.");
    widgets.forEach((value, index) => {
      if (!isObject(value)) return out.warn(`Widget ${index} is not an object; it was not described.`);
      const wrapped = isObject(value.widgetDefinition);
      const card = wrapped ? value.widgetDefinition as Obj : value;
      const id = text(card.clientGuid);
      if (!id) return out.warn(`Widget ${index} has no clientGuid; it was not described.`);
      entries.push(wrapped ? { id, card, wrapper: value } : { id, card });
    });
  } else if (isObject(widgets)) {
    if (pageType === "GRID-PAGE") out.warn("Worksheet widgets are a map rather than wrappers; card order may not match the worksheet.");
    for (const [id, value] of Object.entries(widgets)) {
      if (!isObject(value)) { out.warn(`Widget ${cap(id, 60)} is not an object; it was not described.`); continue; }
      if (value.clientGuid !== undefined && value.clientGuid !== id) out.warn(`Widget ${cap(id, 60)} has a different clientGuid; it is described by its map key.`);
      entries.push({ id, card: value });
    }
  } else if (!isEmpty(widgets)) out.warn("Page widgets are neither a map nor an array; no cards were described.");
  const seen = new Set<string>();
  for (const { id } of entries) {
    if (seen.has(id)) out.warn(`Card ID ${cap(id, 60)} appears more than once.`);
    seen.add(id);
  }
  return entries;
}

interface Where { area?: string; sectionId?: string; rowId?: string; rowIndex?: number; rowHeight?: number; columnStart?: number; columnEnd?: number;
  slideId?: string; slideIndex?: number; slideTitle?: string; expanded?: boolean }

/** Walk any layout tolerantly: `areas` may be null/absent and unknown node types are traversed when they have areas. */
function placeCards(pageType: UxPageType, page: Obj, entries: CardEntry[], out: Collector, navLinks: unknown[]): Map<string, UxCardPlacement> {
  const result = new Map<string, UxCardPlacement>();
  if (pageType === "GRID-PAGE") {
    let mains = 0;
    let insights = 0;
    for (const { id, wrapper } of entries) {
      const main = id.startsWith("mainGrid");
      if (main && mains > 0) out.warn(`Worksheet has more than one main grid (${cap(id, 60)}).`);
      result.set(id, compact({ kind: "worksheet" as const, role: main ? "main" as const : "insight" as const, index: main ? mains++ : insights++,
        height: num(wrapper?.height), showPreview: bool(wrapper?.showPreview) }));
    }
  }
  const byId = new Map(entries.map(entry => [entry.id, entry]));
  const primary = new Map<string, UxCardPlacement>();
  const expandedOnly = new Map<string, UxCardPlacement>();
  const duplicates = new Set<string>();
  const missing: string[] = [];
  const unknownTypes = new Set<string>();
  let malformed = 0;
  const placement = (node: Obj, where: Where): UxCardPlacement => pageType === "REPORT"
    ? compact({ kind: "report" as const, slideId: where.slideId, slideIndex: where.slideIndex, slideTitle: where.slideTitle,
      position: isObject(node.position) ? Object.fromEntries(Object.entries(node.position).filter((entry): entry is [string, number] => num(entry[1]) !== undefined)) : undefined,
      locked: node.locked === true ? true : undefined })
    : compact({ kind: "board" as const, area: where.area, sectionId: where.sectionId, rowId: where.rowId, rowIndex: where.rowIndex, rowHeight: where.rowHeight,
      columnStart: where.columnStart, columnEnd: where.columnEnd, height: num(node.height) });
  const visit = (node: unknown, where: Where, index: number, root: boolean): void => {
    if (!isObject(node)) { malformed++; return; }
    const rawId = text(node.id);
    const id = rawId === undefined ? undefined : cap(rawId);
    const type = text(node.type) ?? "";
    const entry = root || rawId === undefined ? undefined : byId.get(rawId);
    if (entry) {
      const cardType = text(entry.card.type);
      if (type && cardType && type !== cardType) out.warn(`Layout places card ${cap(entry.id, 60)} as ${cap(type, 40)} but its widget is ${cap(cardType, 40)}.`);
      if (pageType === "GRID-PAGE") return;
      const found = placement(node, where);
      if (where.expanded) { if (!expandedOnly.has(entry.id)) expandedOnly.set(entry.id, found); }
      else if (primary.has(entry.id)) duplicates.add(entry.id);
      else primary.set(entry.id, found);
      return;
    }
    if (NATIVE_CARD_TYPES.has(type)) { missing.push(id ?? "(no id)"); return; }
    let next = where;
    if (type === "BOARD_SECTION") next = { ...where, sectionId: id };
    else if (type === "BOARD_ROW") next = { ...where, rowId: id, rowIndex: index, rowHeight: num(node.height) };
    else if (type === "BOARD_COLUMN" || type === "BOARD_COLUMN_SPACER") next = { ...where, columnStart: num(node.columnStart), columnEnd: num(node.columnEnd) };
    else if (type === "SLIDE" || type === "LINKED_SLIDE") next = { ...where, slideId: id, slideIndex: index, slideTitle: capped(node.title) };
    else if (!LAYOUT_TYPES.has(type)) unknownTypes.add(type ? cap(type, 40) : "(missing type)");
    if (node.areas === undefined || node.areas === null) return;
    if (!isObject(node.areas)) { malformed++; return; }
    for (const [area, children] of Object.entries(node.areas)) {
      if (children === undefined || children === null) continue;
      if (!Array.isArray(children)) { malformed++; continue; }
      // Loop rather than push(...children): spreading a huge native array can exceed the engine's argument limit.
      if (area === "navLinks") { for (const link of children) navLinks.push(link); continue; }
      const inner: Where = root && pageType === "BOARD" ? { ...next, area, expanded: area === "expanded" } : area === "expanded" ? { ...next, expanded: true } : next;
      children.forEach((child, childIndex) => visit(child, inner, childIndex, false));
    }
  };
  const layout = page.layout;
  if (layout === undefined || layout === null) {
    if (pageType !== "GRID-PAGE" && entries.length) out.warn("Page has no layout; its cards are unplaced.");
  } else if (!isObject(layout)) out.warn("Page layout is not an object; it was not described.");
  else {
    const expected = pageType === "GRID-PAGE" ? "GRIDPAGE" : pageType;
    if (text(layout.type) && layout.type !== expected) out.warn(`Layout type ${cap(String(layout.type), 40)} does not match page type ${pageType}.`);
    visit(layout, {}, 0, true);
  }
  if (pageType !== "GRID-PAGE") {
    const unplaced = entries.filter(({ id }) => !primary.has(id) && !expandedOnly.has(id)).map(({ id }) => id);
    for (const { id } of entries) result.set(id, primary.get(id) ?? expandedOnly.get(id) ?? { kind: "unplaced" });
    if (unplaced.length && isObject(layout)) out.warn(`${unplaced.length} card(s) are not placed in the layout: ${listed(unplaced)}.`);
    if (duplicates.size) out.warn(`Card(s) placed more than once; the first placement is described: ${listed([...duplicates])}.`);
  }
  if (missing.length) out.warn(`${missing.length} layout card(s) have no widget definition: ${listed(missing)}.`);
  if (unknownTypes.size) out.warn(`Unrecognised layout node types (traversed where they have areas): ${listed([...unknownTypes])}.`);
  if (malformed) out.warn(`${malformed} layout entries are not objects or have malformed areas; they were skipped.`);
  return result;
}

interface Selector { dimensionId: string; scope?: string; visible?: boolean; syncedToPage?: boolean }

function contextSelectors(raw: unknown, path: string, out: Collector, unrec: Unrecognised): { selectors: UxContextSelector[]; info: Selector[] } {
  const selectors: UxContextSelector[] = [];
  const info: Selector[] = [];
  if (!Array.isArray(raw)) { unrec.add(path, raw); return { selectors, info }; }
  raw.forEach((option, index) => {
    const at = `${path}[${index}]`;
    if (!isObject(option)) return unrec.add(at, option);
    const dimensionId = idOf(option.dimensionId);
    const scopeId = idOf(option.scope);
    const selector: UxContextSelector = dimensionId ? { dimension: out.ref("dimension", dimensionId) } : {};
    if (!dimensionId && text(option.dimensionId)) selector.dimensionKey = cap(option.dimensionId as string);
    else if (!dimensionId) unrec.add(`${at}.dimensionId`, option.dimensionId);
    for (const flag of SELECTOR_FLAGS) {
      const value = option[flag];
      if (typeof value === "boolean") selector[flag] = value;
      else unrec.add(`${at}.${flag}`, value);
    }
    if (scopeId) selector.scope = out.ref("module", scopeId);
    else if (!isEmpty(option.scope)) selector.scope = plain(option.scope, out);
    for (const key of SELECTOR_DATA) if (!isEmpty(option[key])) selector[key] = plain(option[key], out, scopeId);
    for (const [key, value] of Object.entries(option)) if (!SELECTOR_KEYS.has(key)) unrec.add(`${at}.${key}`, value);
    selectors.push(selector);
    if (dimensionId) info.push(compact({ dimensionId, scope: scopeId, visible: bool(option.visible), syncedToPage: bool(option.syncedToPage) }));
  });
  return { selectors, info };
}

function describePage(pageType: UxPageType, page: Obj, entries: CardEntry[], navLinks: unknown[], out: Collector): UxPageContext {
  const unrec = new Unrecognised();
  const context: UxPageContext = {};
  const layout = isObject(page.layout) ? page.layout : undefined;
  if (layout && text(layout.type)) context.layoutType = cap(layout.type as string);
  const { selectors } = contextSelectors(page.contextOptions, "contextOptions", out, unrec);
  if (selectors.length) context.contextSelectors = selectors;
  if (layout) {
    for (const key of ["defaultContext", "contextFilterOrder", "syncScroll"] as const) if (!isEmpty(layout[key])) context[key] = plain(layout[key], out);
    if (typeof layout.syncBrowser === "boolean") context.syncBrowser = layout.syncBrowser;
    const settings: Obj = {};
    for (const [key, value] of Object.entries(layout)) {
      if (LAYOUT_KEYS.has(key)) continue;
      if (isScalar(value) && !SENSITIVE.test(key)) settings[key] = scalar(value);
      else unrec.add(`layout.${key}`, value);
    }
    if (Object.keys(settings).length) context.layoutSettings = settings;
  }
  const modelCount = num(page.modelCount) ?? (Array.isArray(page.modelInfos) ? page.modelInfos.length : undefined);
  if (modelCount !== undefined) {
    context.modelCount = modelCount;
    if (modelCount > 1) out.warn(`Page spans ${modelCount} models; references are resolved against the page model only.`);
  }
  for (const key of ["categoryGuid", "currentDraftVersionGuid", "currentPublishedVersionGuid"] as const) { const value = capped(page[key]); if (value) context[key] = value; }
  for (const key of ["categoryUpdatedAt", "publishedAt", "updatedAt", "createdAt"] as const) {
    const value = page[key];
    if (typeof value === "number" || text(value)) context[key] = scalar(value as string | number) as string | number;
  }
  const relatedCard = capped(page.defaultRelatedWidgetGuid);
  if (relatedCard) context.defaultRelatedCardId = relatedCard;
  const links = [...(Array.isArray(page.navLinks) ? page.navLinks : []), ...navLinks];
  if (links.length) context.navLinks = plain(links, out);
  if (!isEmpty(page.navLinks) && !Array.isArray(page.navLinks)) unrec.add("navLinks", page.navLinks);
  if (!isEmpty(page.pageMetadata)) context.pageMetadata = plain(page.pageMetadata, out);
  if (pageType === "REPORT" && layout && isObject(layout.areas) && Array.isArray(layout.areas.main)) {
    context.slides = layout.areas.main.flatMap((slide, index): UxSlideSummary[] => {
      if (!isObject(slide)) return [];
      const cards = isObject(slide.areas) && Array.isArray(slide.areas.main) ? slide.areas.main.length : 0;
      const slideSelectors = contextSelectors(slide.contextOptions, `layout.areas.main[${index}].contextOptions`, out, unrec).selectors;
      return [compact({ id: capped(slide.id), index, type: capped(slide.type), title: capped(slide.title), orientation: capped(slide.orientation), cardCount: cards,
        contextSelectors: slideSelectors.length ? slideSelectors : undefined, source: capped(slide.source) })];
    });
  }
  if (pageType === "BOARD" && !isEmpty(page.rows)) {
    const count = Array.isArray(page.rows) ? page.rows.length : 1;
    out.warn(`Legacy row-based board layout (${count} rows) is not described; card placement may be incomplete.`);
  }
  if (page.widgetGuids !== undefined && page.widgetGuids !== null) {
    if (!Array.isArray(page.widgetGuids)) out.warn("widgetGuids is not an array; saved widget references were not checked.");
    else {
      const inline = new Set(entries.flatMap(({ card, wrapper }) => [text(card.widgetGuid), text(wrapper?.widgetGuid)].filter((guid): guid is string => !!guid)));
      const unresolved = page.widgetGuids.filter(guid => typeof guid !== "string" || !inline.has(guid)).length;
      if (unresolved) out.warn(`${unresolved} saved widget reference(s) have no inline definition and are not described.`);
    }
  }
  for (const [key, value] of Object.entries(page)) if (!PAGE_KEYS.has(key)) unrec.add(key, value);
  if (unrec.entries.length) context.unrecognised = unrec.entries;
  if (unrec.omitted) context.unrecognisedOmitted = unrec.omitted;
  return context;
}

interface GridFlags { hasFilters: boolean; hasSorts: boolean; hasHiddenItems: boolean; hasLevelSelection: boolean }
interface Scope { out: Collector; unrec: Unrecognised; flags: GridFlags; warn: (message: string) => void }
interface Region { key: string; module?: string; detail: Omit<UxGridRegion, "pivot">; rowIds: string[]; columnIds: string[]; pageIds: string[] }

/** Unknown-kind references for ID-like items in native order; other items stay raw. */
function selectedItems(raw: unknown, scope: Scope): { selectedItems: UxEntityRef[]; otherItems?: unknown[] } {
  const list = Array.isArray(raw) ? raw : isEmpty(raw) ? [] : [raw];
  const refs: UxEntityRef[] = [];
  const other: unknown[] = [];
  for (const item of list.slice(0, MAX_ITEMS)) {
    const id = idOf(item);
    if (id) refs.push(scope.out.ref("unknown", id));
    else if (!isEmpty(item)) other.push(plain(item, scope.out));
  }
  if (list.length > MAX_ITEMS) other.push(`[+${list.length - MAX_ITEMS} more]`);
  return other.length ? { selectedItems: refs, otherItems: other } : { selectedItems: refs };
}

function boundedItems(list: unknown[], convert: (item: unknown) => unknown): unknown[] {
  const items = list.slice(0, MAX_ITEMS).map(convert).filter(item => item !== undefined);
  if (list.length > MAX_ITEMS) items.push(`[+${list.length - MAX_ITEMS} more]`);
  return items;
}

/** Items of a dimension: line items on the Line Items dimension, otherwise list items of that dimension. */
function itemRef(scope: Scope, id: string, dimensionId: string | undefined, module: string | undefined): UxEntityRef {
  return dimensionId === LINE_ITEMS_DIMENSION ? scope.out.ref("lineItem", id, { moduleId: module }) : scope.out.ref("listItem", id, { dimensionId });
}

function dimensionList(raw: unknown, path: string, scope: Scope, module: string | undefined): UxAxisDimension[] {
  if (!Array.isArray(raw)) { scope.unrec.add(path, raw); return []; }
  return raw.flatMap((value, index): UxAxisDimension[] => {
    const at = `${path}[${index}]`;
    if (!isObject(value)) { scope.unrec.add(at, value); return []; }
    const dimensionId = idOf(value.id);
    const detail: UxAxisDimension = dimensionId ? { dimension: scope.out.ref("dimension", dimensionId) } : {};
    if (!dimensionId && text(value.id)) detail.dimensionKey = cap(value.id as string);
    else if (!dimensionId) scope.unrec.add(`${at}.id`, value.id);
    const toItem = (item: unknown) => { const id = idOf(item); return id ? itemRef(scope, id, dimensionId, module) : plain(item, scope.out); };
    for (const key of ["levels", "sorts", "shows", "hides", "reorder"] as const) {
      const list = value[key];
      if (!Array.isArray(list)) { scope.unrec.add(`${at}.${key}`, list); continue; }
      if (!list.length) continue;
      if (key === "levels") { detail.levels = plain(list, scope.out) as unknown[]; scope.flags.hasLevelSelection = true; }
      else if (key === "sorts") {
        // Source iae: {selectedItems, direction, axisKey?}; the selected items identify the sorted column/row.
        detail.sorts = boundedItems(list, sort => isObject(sort) ? { ...plain(Object.fromEntries(Object.entries(sort).filter(([name]) => name !== "selectedItems")), scope.out) as Obj,
          ...(sort.selectedItems === undefined ? {} : selectedItems(sort.selectedItems, scope)) } : plain(sort, scope.out));
        scope.flags.hasSorts = true;
      } else {
        detail[key] = boundedItems(list, toItem);
        if (key !== "reorder") scope.flags.hasHiddenItems = true;
      }
    }
    if (text(value.totalsPosition)) detail.totalsPosition = cap(value.totalsPosition as string);
    else scope.unrec.add(`${at}.totalsPosition`, value.totalsPosition);
    for (const [key, item] of Object.entries(value)) if (!DIMENSION_KEYS.has(key)) scope.unrec.add(`${at}.${key}`, item);
    return [detail];
  });
}

/** Source P0t: ragged entries map dimension IDs to item IDs for nested hierarchies. */
function raggedList(raw: unknown, path: string, scope: Scope, module: string | undefined): unknown[] {
  if (!Array.isArray(raw)) { scope.unrec.add(path, raw); return []; }
  return boundedItems(raw, entry => {
    const id = idOf(entry);
    if (id) return scope.out.ref("listItem", id);
    if (isObject(entry) && !isEmpty(entry) && Object.entries(entry).every(([key, item]) => idOf(key) && idOf(item))) {
      return Object.entries(entry).map(([dimensionId, item]) => itemRef(scope, idOf(item) as string, dimensionId, module));
    }
    return plain(entry, scope.out);
  });
}

function filterLeaf(node: Obj, path: string, scope: Scope): UxFilterCondition | undefined {
  for (const [key, value] of Object.entries(node)) if (key !== "type" && key !== "rule") scope.unrec.add(`${path}.${key}`, value);
  const rule = node.rule;
  if (!isObject(rule)) { scope.unrec.add(`${path}.rule`, rule); return undefined; }
  const values = Array.isArray(rule.values) ? plain(rule.values, scope.out) as unknown[] : isEmpty(rule.values) ? [] : [plain(rule.values, scope.out)];
  const condition: UxFilterCondition = { operator: capped(rule.operator) ?? "", values, ...selectedItems(rule.selectedItems, scope) };
  const identifier = idOf(rule.identifier);
  if (identifier) condition.identifier = scope.out.ref("unknown", identifier);
  else if (text(rule.identifier)) condition.identifier = cap(rule.identifier as string);
  if (!isEmpty(rule.axisKey)) condition.axisKey = plain(rule.axisKey, scope.out);
  for (const [key, value] of Object.entries(rule)) if (!LEAF_RULE_KEYS.has(key)) scope.unrec.add(`${path}.rule.${key}`, value);
  return condition;
}

function filterBranch(node: Obj, path: string, scope: Scope, counter: { leaves: number }): UxFilterDetail {
  const operator = capped(node.operator) ?? "AND";
  const detail: UxFilterDetail = compact({ operator, match: operator === "AND" ? "all" as const : operator === "OR" ? "any" as const : undefined, conditions: [], groups: [] });
  const addLeaf = (leaf: Obj, at: string) => { const condition = filterLeaf(leaf, at, scope); if (condition) { detail.conditions.push(condition); counter.leaves++; } };
  if (node.type === "LEAF") { addLeaf(node, path); return detail; }
  if (node.type !== undefined && node.type !== "BRANCH") scope.unrec.add(`${path}.type`, node.type);
  if (Array.isArray(node.nodes)) {
    node.nodes.forEach((child, index) => {
      const at = `${path}.nodes[${index}]`;
      if (isObject(child) && child.type === "LEAF") addLeaf(child, at);
      else if (isObject(child) && (child.type === "BRANCH" || Array.isArray(child.nodes))) detail.groups.push(filterBranch(child, at, scope, counter));
      else scope.unrec.add(at, child);
    });
  } else scope.unrec.add(`${path}.nodes`, node.nodes);
  for (const [key, value] of Object.entries(node)) if (!["type", "operator", "nodes", "rule"].includes(key)) scope.unrec.add(`${path}.${key}`, value);
  return detail;
}

/** Keeps the whole BRANCH/LEAF tree in native order; a tree without any LEAF rule is omitted. */
function filterTree(raw: unknown, path: string, scope: Scope): UxFilterDetail | undefined {
  if (raw === undefined || raw === null) return undefined;
  const hasRoot = isObject(raw) && isObject(raw.rootNode);
  const root = hasRoot ? (raw as Obj).rootNode as Obj : isObject(raw) && (raw.type !== undefined || raw.nodes !== undefined) ? raw : undefined;
  if (!root) { scope.unrec.add(path, raw); return undefined; }
  if (hasRoot) for (const [key, value] of Object.entries(raw as Obj)) if (key !== "rootNode") scope.unrec.add(`${path}.${key}`, value);
  const counter = { leaves: 0 };
  const tree = filterBranch(root, hasRoot ? `${path}.rootNode` : path, scope, counter);
  if (!counter.leaves) return undefined;
  scope.flags.hasFilters = true;
  return tree;
}

function axis(raw: unknown, path: string, scope: Scope, module: string | undefined): UxAxisDetail | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!isObject(raw)) { scope.unrec.add(path, raw); return undefined; }
  const detail: UxAxisDetail = { dimensions: raw.dimensions === undefined ? [] : dimensionList(raw.dimensions, `${path}.dimensions`, scope, module) };
  const filter = filterTree(raw.filters, `${path}.filters`, scope);
  if (filter) detail.filter = filter;
  for (const key of ["raggedShows", "raggedHides"] as const) {
    const list = raw[key] === undefined ? [] : raggedList(raw[key], `${path}.${key}`, scope, module);
    if (list.length) { detail[key] = list; scope.flags.hasHiddenItems = true; }
  }
  for (const [key, value] of Object.entries(raw)) if (!AXIS_KEYS.has(key)) scope.unrec.add(`${path}.${key}`, value);
  return detail;
}

function makeRegion(key: string, module: string | undefined, parts: Omit<UxGridRegion, "region" | "module" | "pivot">, out: Collector): Region {
  const ids = (dimensions: UxAxisDimension[] | undefined) => (dimensions ?? []).flatMap(item => item.dimension ? [item.dimension.id] : []);
  return {
    key, module, detail: compact({ region: cap(key), module: module ? out.ref("module", module) : undefined, ...parts }),
    rowIds: ids(parts.rows?.dimensions), columnIds: ids(parts.columns?.dimensions), pageIds: [...ids(parts.pages), ...ids(parts.otherAxes?.pages?.dimensions)],
  };
}

function childAxes(raw: unknown, path: string, unrec: Unrecognised): Map<string, { value: Obj; path: string }> {
  const axes = new Map<string, { value: Obj; path: string }>();
  if (!isObject(raw)) { unrec.add(path, raw); return axes; }
  if (isObject(raw.childAxes)) {
    for (const [key, value] of Object.entries(raw.childAxes)) {
      if (isObject(value)) axes.set(key, { value, path: `${path}.childAxes.${key}` });
      else unrec.add(`${path}.childAxes.${key}`, value);
    }
    for (const [key, value] of Object.entries(raw)) if (key !== "childAxes") unrec.add(`${path}.${key}`, value);
  } else if (raw.dimensions !== undefined || raw.filters !== undefined) axes.set("", { value: raw, path }); // One axis without child sections.
  else unrec.add(path, raw);
  return axes;
}

/** Identifiers that look like entity IDs are line items of the targeted region's module (never assume the first
 * region), or of the card's own module when the card has no grid regions (KPI). */
function cfRule(raw: unknown, path: string, scope: Scope, regions: Region[], defaultType: string, cardModule?: string): UxConditionalFormatRule | undefined {
  if (!isObject(raw)) { scope.unrec.add(path, raw); return undefined; }
  const regionId = text(raw.targetRegionId);
  const modules = new Set(regions.map(region => region.module));
  const moduleId = !regions.length ? cardModule
    : regionId !== undefined ? regions.find(region => region.key === regionId)?.module : modules.size === 1 ? [...modules][0] : undefined;
  const identifier = (value: unknown): UxEntityRef | undefined => {
    const id = idOf(value);
    if (id) return scope.out.ref("lineItem", id, { moduleId });
    return text(value) ? scope.out.ref("unknown", value as string) : undefined;
  };
  const rule: UxConditionalFormatRule = { type: capped(raw.type) ?? defaultType };
  const source = identifier(raw.sourceIdentifier);
  const target = identifier(raw.targetIdentifier);
  if (source) rule.source = source;
  if (target) rule.target = target;
  if (!isEmpty(raw.pegs)) rule.pegs = plain(raw.pegs, scope.out);
  const regionInfo: Obj = {};
  for (const key of CF_REGION_KEYS) if (!isEmpty(raw[key])) regionInfo[key] = plain(raw[key], scope.out);
  if (Object.keys(regionInfo).length) rule.regions = regionInfo;
  const config: Obj = {};
  for (const [key, value] of Object.entries(raw)) {
    if (CF_KEYS.has(key) || isEmpty(value)) continue;
    if (SENSITIVE.test(key)) config[key] = REDACTED;
    else if (isScalar(value) && !Object.hasOwn(rule, key) && !["source", "target", "regions", "config"].includes(key)) rule[key] = scalar(value);
    else config[key] = isScalar(value) ? scalar(value) : plain(value, scope.out, moduleId);
  }
  if (Object.keys(config).length) rule.config = config;
  return rule;
}

function describeAdq(adq: Obj, path: string, scope: Scope): { regions: Region[]; rules: UxConditionalFormatRule[]; breakback: unknown[] } {
  const { unrec, out } = scope;
  const regions: Region[] = [];
  const fallback = idOf(adq.moduleId);
  if (!isEmpty(adq.moduleId) && !fallback) unrec.add(`${path}.moduleId`, adq.moduleId);
  if (adq.version !== undefined && adq.version !== 1 && adq.version !== 2) scope.warn(`uses axis description version ${cap(String(adq.version), 20)}; it is described by shape.`);
  // Source xo/bo: version 1 keys regions by ID; version 2 has row/column child axes and a regions array (grid sections).
  const v1 = isObject(adq.regions) && adq.version !== 2;
  if (v1) {
    for (const [key, value] of Object.entries(adq.regions as Obj)) {
      const at = `${path}.regions.${key}`;
      if (!isObject(value)) { unrec.add(at, value); continue; }
      const module = idOf(value.moduleId) ?? fallback;
      if (!idOf(value.moduleId)) unrec.add(`${at}.moduleId`, value.moduleId);
      const otherAxes: Record<string, UxAxisDetail> = {};
      for (const [name, item] of Object.entries(value)) {
        if (["moduleId", "rows", "columns", "offAxisDimensions"].includes(name)) continue;
        const described = isObject(item) && (Array.isArray(item.dimensions) || isObject(item.filters)) ? axis(item, `${at}.${name}`, scope, module) : undefined;
        if (described) otherAxes[name] = described;
        else unrec.add(`${at}.${name}`, item);
      }
      const pages = value.offAxisDimensions === undefined ? [] : dimensionList(value.offAxisDimensions, `${at}.offAxisDimensions`, scope, module);
      regions.push(makeRegion(key, module, compact({ rows: axis(value.rows, `${at}.rows`, scope, module), columns: axis(value.columns, `${at}.columns`, scope, module),
        pages: pages.length ? pages : undefined, otherAxes: Object.keys(otherAxes).length ? otherAxes : undefined }), out));
    }
    unrec.add(`${path}.rowAxis`, adq.rowAxis);
    unrec.add(`${path}.columnAxis`, adq.columnAxis);
  } else {
    const rowAxes = childAxes(adq.rowAxis, `${path}.rowAxis`, unrec);
    const columnAxes = childAxes(adq.columnAxis, `${path}.columnAxis`, unrec);
    // Child axes can be shared by several regions; describe each once per module.
    const cache = new Map<string, UxAxisDetail | undefined>();
    const childAxis = (axes: typeof rowAxes, key: string | undefined, module: string | undefined, label: string): UxAxisDetail | undefined => {
      if (key === undefined) return undefined;
      const found = axes.get(key);
      if (!found) { scope.warn(`grid region refers to a missing ${label} axis section ${cap(key, 40)}.`); return undefined; }
      const cacheKey = `${found.path}\u0000${module ?? ""}`;
      if (!cache.has(cacheKey)) cache.set(cacheKey, axis(found.value, found.path, scope, module));
      return cache.get(cacheKey);
    };
    const list = Array.isArray(adq.regions) ? adq.regions : [];
    if (!Array.isArray(adq.regions)) unrec.add(`${path}.regions`, adq.regions);
    list.forEach((value, index) => {
      const at = `${path}.regions[${index}]`;
      if (!isObject(value)) return unrec.add(at, value);
      const coordinates = Array.isArray(value.coordinates) ? value.coordinates : [];
      const columnKey = text(value.columnAxisKey) ?? text(coordinates[0]);
      const rowKey = text(value.rowAxisKey) ?? text(coordinates[1]);
      const module = idOf(value.moduleId) ?? fallback;
      if (!idOf(value.moduleId)) unrec.add(`${at}.moduleId`, value.moduleId);
      const pages = value.offAxisDimensions === undefined ? [] : dimensionList(value.offAxisDimensions, `${at}.offAxisDimensions`, scope, module);
      for (const [key, item] of Object.entries(value)) if (!V2_REGION_KEYS.has(key)) unrec.add(`${at}.${key}`, item);
      regions.push(makeRegion(text(value.id) ?? `#${index + 1}`, module, compact({ regionType: capped(value.regionType), rowAxisKey: rowKey === undefined ? undefined : cap(rowKey),
        columnAxisKey: columnKey === undefined ? undefined : cap(columnKey), rows: childAxis(rowAxes, rowKey, module, "row"),
        columns: childAxis(columnAxes, columnKey, module, "column"), pages: pages.length ? pages : undefined }), out));
    });
    if (!list.length && (rowAxes.size || columnAxes.size)) {
      const [rowKey] = rowAxes.keys();
      const [columnKey] = columnAxes.keys();
      if (rowAxes.size > 1 || columnAxes.size > 1) scope.warn("has axis sections but no grid regions; only the first section of each axis is described.");
      regions.push(makeRegion("(default)", fallback, compact({ rows: childAxis(rowAxes, rowKey, fallback, "row"), columns: childAxis(columnAxes, columnKey, fallback, "column") }), out));
    }
  }
  const rules: UxConditionalFormatRule[] = [];
  if (Array.isArray(adq.conditionalFormattingRules)) {
    adq.conditionalFormattingRules.forEach((rule, index) => {
      const described = cfRule(rule, `${path}.conditionalFormattingRules[${index}]`, scope, regions, "UNKNOWN");
      if (described) rules.push(described);
    });
  } else unrec.add(`${path}.conditionalFormattingRules`, adq.conditionalFormattingRules);
  const breakback = Array.isArray(adq.breakbackSelections) ? adq.breakbackSelections : [];
  if (!Array.isArray(adq.breakbackSelections)) unrec.add(`${path}.breakbackSelections`, adq.breakbackSelections);
  for (const [key, value] of Object.entries(adq)) if (!ADQ_KEYS.has(key)) unrec.add(`${path}.${key}`, value);
  return { regions, rules, breakback };
}

function describeSources(card: Obj, scope: Scope, regions: Region[], rules: UxConditionalFormatRule[], breakback: unknown[]): UxCardSource[] {
  const { out, unrec } = scope;
  const sources: UxCardSource[] = [];
  const raw = card.widgetDataSources;
  if (Array.isArray(raw)) raw.forEach((value, index) => {
    const path = `widgetDataSources[${index}]`;
    if (!isObject(value)) return unrec.add(path, value);
    const type = text(value.dataSourceType) ?? "UNKNOWN";
    const source: UxCardSource = { dataSourceType: cap(type) };
    const moduleId = idOf(value.dataSourceId);
    const otherId = moduleId ? undefined : text(value.dataSourceId);
    const leftover = new Set<string>();
    if (type === "CLASSIC" || type === "VIEW_DESCRIPTION" || type === "LINE_ITEM") {
      // Source sg/yOt/ble: VIEW_DESCRIPTION IDs are modules; LINE_ITEM adds the line item as subEntityId. A CLASSIC ID is a
      // module's default view only with the module prefix (modeling oGe/E1); any other ID is a saved view (observed 27 Sep 2026).
      if (moduleId && type === "CLASSIC" && !isModuleId(moduleId)) source.view = out.ref("view", moduleId);
      else if (moduleId) source.module = out.ref("module", moduleId);
      else if (otherId && type === "VIEW_DESCRIPTION") source.descriptionId = cap(otherId);
      else if (!isEmpty(value.dataSourceId)) leftover.add("dataSourceId");
      const lineItemId = type === "LINE_ITEM" ? idOf(value.subEntityId) : undefined;
      if (lineItemId) source.lineItem = out.ref("lineItem", lineItemId, { moduleId });
      else if (!isEmpty(value.subEntityId)) leftover.add("subEntityId");
    } else if (type === "MULTI_AXIS_DESCRIPTION" || type === "CUSTOM_VIEW") {
      // Axis descriptions use a GUID; custom views use a `view:` identifier. Neither is a saved-view entity ID.
      const descriptionId = otherId ?? moduleId;
      if (descriptionId) source.descriptionId = cap(descriptionId);
      if (!isEmpty(value.subEntityId)) leftover.add("subEntityId");
    } else { leftover.add("dataSourceId"); leftover.add("subEntityId"); }
    const adq = value.axisDescriptionQuery;
    if (isObject(adq)) {
      const described = describeAdq(adq, `${path}.axisDescriptionQuery`, scope);
      for (const region of described.regions) regions.push(region);
      for (const rule of described.rules) rules.push(rule);
      for (const selection of described.breakback) breakback.push(selection);
      const modules = [...new Set([source.module?.id, ...described.regions.map(region => region.module)].filter((id): id is string => !!id))];
      if (!source.module && modules.length) source.module = out.ref("module", modules[0]);
      if (modules.length > 1) source.modules = modules.map(id => out.ref("module", id));
    } else if (!isEmpty(adq)) leftover.add("axisDescriptionQuery");
    if (!isEmpty(value.viewDescription)) leftover.add("viewDescription");
    for (const [key, item] of Object.entries(value)) if (!SOURCE_KEYS.has(key) || leftover.has(key)) unrec.add(`${path}.${key}`, item);
    sources.push(source);
  });
  else unrec.add("widgetDataSources", raw);
  // Card-level bindings (IMAGE, SAM-authored grids/KPIs) usually repeat a data source; list them only when they do not.
  const cardModule = idOf(card.dataSourceId);
  const cardLineItem = idOf(card.lineItemId);
  if (cardModule || cardLineItem) {
    const covered = sources.some(source => (!cardModule || source.module?.id === cardModule || source.view?.id === cardModule
      || !!source.modules?.some(ref => ref.id === cardModule)) && (!cardLineItem || source.lineItem?.id === cardLineItem));
    const cardView = cardModule && !cardLineItem && !isModuleId(cardModule);
    if (!covered) sources.push(compact({ dataSourceType: "CARD_LEVEL", module: cardModule && !cardView ? out.ref("module", cardModule) : undefined,
      view: cardView ? out.ref("view", cardModule) : undefined,
      lineItem: cardLineItem ? out.ref("lineItem", cardLineItem, { moduleId: cardModule }) : undefined }));
  } else if (text(card.dataSourceId)) {
    const descriptionId = cap(card.dataSourceId as string);
    if (!sources.some(source => source.descriptionId === descriptionId)) sources.push({ dataSourceType: "CARD_LEVEL", descriptionId });
  } else unrec.add("dataSourceId", card.dataSourceId);
  if (!cardLineItem) unrec.add("lineItemId", card.lineItemId);
  return sources;
}

function pivot(region: Region, regions: Region[], selectors: Selector[], out: Collector): UxGridPivot {
  const bySelector = new Map(selectors.map(selector => [selector.dimensionId, selector]));
  const visibility = (id: string) => { const found = bySelector.get(id); return found ? compact({ visible: found.visible, syncedToPage: found.syncedToPage }) : {}; };
  const pages: UxPivotPage[] = region.pageIds.map(id => ({ dimension: out.ref("dimension", id), source: "axis" as const, ...visibility(id) }));
  const placed = new Set([...region.rowIds, ...region.columnIds, ...region.pageIds]);
  for (const selector of selectors) {
    if (placed.has(selector.dimensionId)) continue;
    // A module-scoped selector (Line Items) belongs to the grid section that shows that module.
    if (selector.scope && selector.scope !== region.module && regions.some(other => other.module === selector.scope)) continue;
    placed.add(selector.dimensionId);
    pages.push({ dimension: out.ref("dimension", selector.dimensionId), source: "contextSelector", ...visibility(selector.dimensionId) });
  }
  return { rows: region.rowIds.map(id => out.ref("dimension", id)), columns: region.columnIds.map(id => out.ref("dimension", id)), pages };
}

function describeActions(card: Obj, scope: Scope): UxActionButtonDetail[] {
  const { out, unrec } = scope;
  // `actions` repeats the buttons as a JSON string that contains action tokens: parse it, never pass it through.
  let parsed: unknown[] | undefined;
  if (typeof card.actions === "string" && card.actions) {
    const result = parseEmbedded(card.actions);
    if (result.ok && Array.isArray(result.value)) parsed = result.value;
    else scope.warn("actions is not a valid JSON list; it was not described.");
  } else if (Array.isArray(card.actions)) parsed = card.actions;
  else if (!isEmpty(card.actions)) scope.warn("actions has an unrecognised shape; it was not described.");
  const native = Array.isArray(card.actionButtons) ? card.actionButtons : undefined;
  if (!native) unrec.add("actionButtons", card.actionButtons);
  if (native && parsed) {
    const ids = (list: unknown[]) => list.map(item => isObject(item) ? String(item.id) : "").join("\u0000");
    if (ids(native) !== ids(parsed)) scope.warn("actionButtons and actions list different actions; actionButtons is described.");
  }
  const path = native ? "actionButtons" : "actions";
  return (native ?? parsed ?? []).flatMap((button, index): UxActionButtonDetail[] => {
    const at = `${path}[${index}]`;
    const modelId = isObject(button) ? idOf(button.id) : undefined;
    const id = isObject(button) ? modelId ?? text(button.id) : undefined;
    if (!isObject(button) || !id) { unrec.add(at, button); return []; }
    // Numeric IDs are model actions named by Integration; others (FORECASTER hex IDs, WORKFLOW_TEMPLATE GUIDs, observed
    // 27 Sep 2026) are not model objects, so the button's stored name is their only name.
    const driver = idOf(button.actionDriverId);
    const list = idOf(button.destinationListId);
    if (!list) unrec.add(`${at}.destinationListId`, button.destinationListId);
    // WRITEBACK and NOTIFICATION buttons name the line item they use (designer bundle, 27 Sep 2026).
    const buttonModule = idOf(button.moduleId);
    const buttonLineItem = idOf(button.lineItemId);
    if (!buttonModule) unrec.add(`${at}.moduleId`, button.moduleId);
    if (!buttonLineItem) unrec.add(`${at}.lineItemId`, button.lineItemId);
    for (const [key, value] of Object.entries(button)) if (!BUTTON_KEYS.has(key)) unrec.add(`${at}.${key}`, value);
    return [compact({
      action: out.ref("action", id, { actionType: text(button.type), ...(modelId ? {} : { name: text(button.name) }) }),
      name: capped(button.name), runAutomatically: bool(button.runAutomatically),
      actionDriver: driver ? out.ref("unknown", driver) : isEmpty(button.actionDriverId) ? undefined : plain(button.actionDriverId, out),
      destinationList: list ? out.ref("dimension", list) : undefined, disableCancelButton: bool(button.disableCancelButton),
      module: buttonModule ? out.ref("module", buttonModule) : undefined,
      lineItem: buttonLineItem ? out.ref("lineItem", buttonLineItem, { moduleId: buttonModule }) : undefined,
      description: capped(button.description), style: isEmpty(button.style) ? undefined : plain(button.style, out),
    })];
  });
}

function describeNavigation(card: Obj, out: Collector, unrec: Unrecognised): UxNavigationDetail | undefined {
  const pageId = text(card.pageIdentifier);
  if (pageId) {
    return compact({ page: out.ref("page", pageId, { name: text(card.pageName) }), appGuid: capped(card.pageAppIdentifier), pageType: capped(card.pageType),
      linkType: capped(card.pageLinkType), targetPublished: bool(card.isTargetPagePublished) });
  }
  // Without a target, the native defaults (title link, NONE, unpublished) are noise.
  const defaults: Obj = { pageLinkType: "title", pageType: "NONE", isTargetPagePublished: false };
  for (const key of NAVIGATION_KEYS) if (card[key] !== defaults[key]) unrec.add(key, card[key]);
  return undefined;
}

function describeImage(card: Obj, out: Collector, unrec: Unrecognised): UxImageDetail {
  const moduleId = idOf(card.dataSourceId);
  const lineItemId = idOf(card.lineItemId);
  // Only the location is described: query strings and fragments can carry signed-access parameters.
  const location = text(card.imageSource)?.split(/[?#]/u)[0];
  const external = location !== undefined && /^https?:\/\//iu.test(location);
  for (const key of ["sourceType", "scaleType", "imageName", "imageAlign", "imageSource"]) if (typeof card[key] !== "string") unrec.add(key, card[key]);
  if (num(card.opacity) === undefined) unrec.add("opacity", card.opacity);
  return compact({
    sourceType: capped(card.sourceType), module: moduleId ? out.ref("module", moduleId) : undefined,
    lineItem: lineItemId ? out.ref("lineItem", lineItemId, { moduleId }) : undefined, scaleType: capped(card.scaleType), imageName: capped(card.imageName),
    url: external ? cap(location, MAX_URL) : undefined, imageSource: location && !external ? cap(location) : undefined,
    opacity: num(card.opacity), imageAlign: capped(card.imageAlign),
  });
}

function describeText(card: Obj, scope: Scope): UxTextDetail | undefined {
  const raw = card.text;
  if (typeof raw !== "string") { scope.unrec.add("text", raw); return undefined; }
  if (!raw) return undefined;
  let content: Obj | undefined;
  if (card.version === 2 || raw.trimStart().startsWith("{")) {
    const parsed = parseEmbedded(raw);
    if (parsed.ok && isObject(parsed.value) && Array.isArray(parsed.value.blocks)) content = parsed.value;
    else if (card.version === 2) {
      scope.warn("text is not valid Draft.js content.");
      scope.unrec.add("text", raw);
      return undefined;
    }
  }
  const blocks = content ? (content.blocks as unknown[]).filter(isObject) : [];
  const joined = content ? blocks.map(block => typeof block.text === "string" ? block.text : "").join("\n") : raw;
  const entityMap = content?.entityMap;
  const entities = isObject(entityMap) ? Object.values(entityMap) : Array.isArray(entityMap) ? entityMap : [];
  const distinct = (values: unknown[]) => [...new Set(values.flatMap(value => text(value) ? [cap(value as string, 60)] : []))].slice(0, 20);
  const entityTypes = distinct(entities.map(entity => isObject(entity) ? entity.type : undefined));
  return compact({
    plainText: joined.length > MAX_PLAIN_TEXT ? joined.slice(0, MAX_PLAIN_TEXT) : joined, truncated: joined.length > MAX_PLAIN_TEXT ? true : undefined,
    styles: distinct(blocks.map(block => block.type)), hasDynamicContent: entities.length > 0, entityTypes: entityTypes.length ? entityTypes : undefined,
  });
}

function describeFields(raw: unknown[], out: Collector, unrec: Unrecognised): UxFieldDetail[] {
  return raw.flatMap((field, index): UxFieldDetail[] => {
    const at = `fields[${index}]`;
    if (!isObject(field)) { unrec.add(at, field); return []; }
    const moduleId = idOf(field.moduleId);
    const lineItemId = idOf(field.lineItemId);
    if (!moduleId) unrec.add(`${at}.moduleId`, field.moduleId);
    if (!lineItemId) unrec.add(`${at}.lineItemId`, field.lineItemId);
    if (typeof field.label !== "string") unrec.add(`${at}.label`, field.label);
    for (const [key, value] of Object.entries(field)) if (!["moduleId", "lineItemId", "label", "formatSpecificProperties"].includes(key)) unrec.add(`${at}.${key}`, value);
    const format = isEmpty(field.formatSpecificProperties) ? undefined : plain(field.formatSpecificProperties, out, moduleId);
    return [compact({ module: moduleId ? out.ref("module", moduleId) : undefined, lineItem: lineItemId ? out.ref("lineItem", lineItemId, { moduleId }) : undefined,
      label: capped(field.label), formatSpecificProperties: isEmpty(format) ? undefined : format })];
  });
}

/** The flat KPI fields as the native `{sourceIdentifier, targetIdentifier, pegs}` object, or undefined when all are empty. */
function flatKpiRule(card: Obj, unrec: Unrecognised): Obj | undefined {
  for (const key of KPI_CF_KEYS) if (!isScalar(card[key])) unrec.add(key, card[key]);
  const pegs = KPI_CF_PEGS.flatMap(([position, valueKey, colorKey]) => {
    const raw = card[valueKey];
    const numeric = typeof raw === "string" && raw.trim() ? Number(raw) : num(raw);
    const value = numeric !== undefined && Number.isFinite(numeric) ? numeric : capped(raw);
    const color = capped(card[colorKey]);
    return value === undefined && color === undefined ? [] : [compact({ position, value, color })];
  });
  if (!text(card.cfSourceIdentifier) && !text(card.cfTargetIdentifier) && !pegs.length) return undefined;
  return compact({ sourceIdentifier: card.cfSourceIdentifier, targetIdentifier: card.cfTargetIdentifier, pegs: pegs.length ? pegs : undefined });
}

/** KPI `config` (an object; a JSON string is tolerated): indicator type, formatting targets and threshold/trend settings. */
function kpiIndicator(raw: unknown, moduleId: string | undefined, scope: Scope): UxKpiIndicator | undefined {
  const { out, unrec } = scope;
  const config = typeof raw === "string" ? parseEmbedded(raw).value : raw;
  if (!isObject(config)) {
    if (typeof raw === "string") scope.warn("config is not a valid JSON object.");
    unrec.add("config", raw);
    return undefined;
  }
  const indicator: UxKpiIndicator = {};
  for (const [key, value] of Object.entries(config)) {
    if (key === "iconIndicatorType" && text(value)) indicator.type = cap(value as string);
    else if (key === "conditionalFormatting" && isObject(value)) {
      for (const [name, item] of Object.entries(value)) {
        if (name === "targets" && !isEmpty(item)) indicator.targets = plain(item, out);
        else if (name !== "targets") unrec.add(`config.conditionalFormatting.${name}`, item);
      }
    } else if (key === "thresholdIndicatorConfig" && isObject(value)) {
      const threshold = plain(value, out, moduleId);
      if (!isEmpty(threshold)) indicator.threshold = threshold;
    } else if (key === "trendIndicatorConfig" && isObject(value)) {
      const { referenceLineItemId, ...rest } = value;
      const lineItemId = idOf(referenceLineItemId);
      if (!lineItemId) unrec.add("config.trendIndicatorConfig.referenceLineItemId", referenceLineItemId);
      const trend = compact({ ...plain(rest, out, moduleId) as Obj, referenceLineItem: lineItemId ? out.ref("lineItem", lineItemId, { moduleId }) : undefined });
      if (!isEmpty(trend)) indicator.trend = trend;
    } else unrec.add(`config.${key}`, value);
  }
  return isEmpty(indicator) ? undefined : indicator;
}

function describeKpi(card: Obj, sources: UxCardSource[], scope: Scope): UxKpiDetail {
  const { out, unrec } = scope;
  const bound = sources.find(source => source.lineItem) ?? sources.find(source => source.module);
  const moduleId = bound?.module?.id;
  const kpi: UxKpiDetail = compact({ module: moduleId ? out.ref("module", moduleId) : undefined,
    lineItem: bound?.lineItem ? out.ref("lineItem", bound.lineItem.id, { moduleId: bound.lineItem.moduleId }) : undefined });
  for (const key of KPI_KEYS) {
    const value = card[key];
    if (isScalar(value) && value !== "") kpi[key] = scalar(value);
    else unrec.add(key, value);
  }
  if (!isEmpty(card.config)) {
    const indicator = kpiIndicator(card.config, moduleId, scope);
    if (indicator) kpi.indicator = indicator;
  }
  return kpi;
}

function describeChart(raw: unknown, scope: Scope): UxChartDetail | undefined {
  if (isEmpty(raw)) return undefined;
  const config = typeof raw === "string" ? parseEmbedded(raw).value : raw;
  if (!isObject(config)) {
    scope.warn("chartConfig is not a valid JSON object.");
    scope.unrec.add("chartConfig", raw);
    return undefined;
  }
  const chart: UxChartDetail = {};
  const settings: Obj = {};
  for (const [key, value] of Object.entries(config)) {
    if (key === "chartType" && text(value)) chart.chartType = cap(value as string);
    else if (key === "series" && Array.isArray(value)) { if (value.length) chart.series = plain(value, scope.out); }
    else if (CHART_SETTINGS.has(key) && isScalar(value)) settings[key] = scalar(value);
    else scope.unrec.add(`chartConfig.${key}`, value);
  }
  if (Object.keys(settings).length) chart.settings = settings;
  return chart;
}

function describeCard({ id, card, wrapper }: CardEntry, placement: UxCardPlacement, pageModelId: string, out: Collector): UxCardDetail {
  const unrec = new Unrecognised();
  const warn = (message: string) => out.warn(`Card ${cap(id, 60)}: ${message}`);
  const scope: Scope = { out, unrec, warn, flags: { hasFilters: false, hasSorts: false, hasHiddenItems: false, hasLevelSelection: false } };
  const used = new Set<string>(CARD_IDENTITY_KEYS);
  const consume = (...keys: string[]) => keys.forEach(key => used.add(key));
  const type = text(card.type);
  if (!type) warn("has no card type.");
  const detail: UxCardDetail = compact({ id: cap(id), type: cap(type ?? "UNKNOWN"), title: capped(card.defaultTitle), description: capped(card.description),
    placement, hasSavedWidgetReference: !!(text(card.widgetGuid) || text(wrapper?.widgetGuid)) });
  const cardModel = text(card.modelId);
  if (cardModel && cardModel !== pageModelId) {
    detail.modelId = cap(cardModel);
    warn("names another model; its references are resolved against the page model.");
  }

  // Context selectors first: grid pivots list them as page dimensions.
  const { selectors, info } = contextSelectors(card.contextOptions, "contextOptions", out, unrec);
  const regions: Region[] = [];
  const rules: UxConditionalFormatRule[] = [];
  const breakback: unknown[] = [];
  const sources = describeSources(card, scope, regions, rules, breakback);
  consume("contextOptions", "widgetDataSources", "dataSourceId", "lineItemId", "conditionalFormattingRules", "conditionalFormatting", ...KPI_CF_KEYS);
  if (sources.length) detail.sources = sources;
  // Card-level rules (KPI): the conditionalFormatting object wins over the flat cf* fields, as in source `zde(e.conditionalFormatting ?? oWt(e))`.
  const cardModule = (sources.find(source => source.lineItem) ?? sources.find(source => source.module))?.module?.id;
  const flat = flatKpiRule(card, unrec);
  const cardRules: [string, unknown][] = [["conditionalFormattingRules", card.conditionalFormattingRules],
    ["conditionalFormatting", isEmpty(card.conditionalFormatting) ? flat : card.conditionalFormatting]];
  for (const [key, value] of cardRules) {
    if (isEmpty(value)) continue;
    (Array.isArray(value) ? value : [value]).forEach((rule, index) => {
      const described = cfRule(rule, Array.isArray(value) ? `${key}[${index}]` : key, scope, regions, "CARD_LEVEL", cardModule);
      if (described) rules.push(described);
    });
  }
  if (regions.length) {
    detail.grid = compact({
      sections: regions.map((region, index) => compact({ region: cap(region.key), module: region.module ? out.ref("module", region.module) : undefined, order: index + 1 })),
      regions: regions.map(region => ({ ...region.detail, pivot: pivot(region, regions, info, out) })),
      summary: { ...scope.flags, hasConditionalFormatting: rules.length > 0 },
      breakbackSelections: breakback.length ? plain(breakback, out) : undefined,
    });
  }
  // Page Builder's grid kinds: a module shaped on the page (custom view), a view built in the model and only selected
  // (a saved view or a module's default view) and several module sections (combined grid; observed 27 Sep 2026).
  if (type === "TABLE" || type === "COMBOCHART") {
    const selected = sources.find(source => (source.dataSourceType === "CLASSIC" || source.dataSourceType === "CARD_LEVEL") && (source.view || source.module));
    const viewType = regions.length > 1 ? "combinedGrid" : regions.length ? "customView" : selected?.view ? "savedView" : selected?.module ? "moduleView" : undefined;
    if (viewType) detail.viewType = viewType;
  }
  if (rules.length) detail.conditionalFormatting = rules;
  if (selectors.length) detail.contextSelectors = selectors;

  const actions = describeActions(card, scope);
  consume("actionButtons", "actions", "widgetActions", ...NAVIGATION_KEYS);
  if (actions.length) detail.actions = actions;
  if (Array.isArray(card.widgetActions)) { if (card.widgetActions.length) detail.widgetActions = plain(card.widgetActions, out); }
  else unrec.add("widgetActions", card.widgetActions);
  const navigation = describeNavigation(card, out, unrec);
  if (navigation) detail.navigation = navigation;
  if (type === "IMAGE" || IMAGE_KEYS.some(key => card[key] !== undefined)) {
    consume(...IMAGE_KEYS);
    detail.image = describeImage(card, out, unrec);
  }
  if (type === "TEXT" || card.text !== undefined) {
    consume("text");
    const described = describeText(card, scope);
    if (described) detail.text = described;
  }
  if (card.fields !== undefined) {
    consume("fields");
    if (Array.isArray(card.fields)) { const fields = describeFields(card.fields, out, unrec); if (fields.length) detail.fields = fields; }
    else unrec.add("fields", card.fields);
  }
  if (type === "CARD") {
    consume(...KPI_KEYS, "config");
    detail.kpi = describeKpi(card, sources, scope);
  }
  if (type === "COMBOCHART" || card.chartConfig !== undefined) {
    consume("chartConfig");
    const chart = describeChart(card.chartConfig, scope);
    if (chart) detail.chart = chart;
  }
  const saved: Obj = {};
  for (const key of SAVED_KEYS) {
    consume(key);
    const value = card[key];
    if (isEmpty(value)) continue;
    const parsed = typeof value === "string" ? parseEmbedded(value) : { ok: true, value };
    if (!parsed.ok) { warn(`${key} is not valid JSON.`); unrec.add(key, value); continue; }
    const converted = plain(parsed.value, out);
    if (!isEmpty(converted)) saved[key] = converted;
  }
  if (Object.keys(saved).length) detail.savedCustomizations = saved;

  const settings: Obj = {};
  for (const [key, value] of Object.entries(card)) {
    if (used.has(key)) continue;
    if (SETTING_KEYS.has(key)) {
      consume(key);
      if (isScalar(value) && value !== "") settings[key] = scalar(value);
      else unrec.add(key, value);
    } else if (PRESENTATION_KEYS.has(key)) {
      consume(key);
      const converted = plain(value, out);
      if (!isEmpty(converted)) settings[key] = converted;
    }
  }
  consume("styleConfig");
  if (!isEmpty(card.styleConfig)) {
    const style = typeof card.styleConfig === "string" ? parseEmbedded(card.styleConfig).value : card.styleConfig;
    if (!isObject(style)) { warn("styleConfig is not a valid JSON object."); unrec.add("styleConfig", card.styleConfig); }
    else for (const [key, value] of Object.entries(style)) {
      if (key === "themeId" && isScalar(value)) settings.themeId = scalar(value);
      else if (key === "themeOverrides") { const converted = plain(value, out); if (!isEmpty(converted)) settings.themeOverrides = converted; }
      else unrec.add(`styleConfig.${key}`, value);
    }
  }
  if (Object.keys(settings).length) detail.settings = settings;

  for (const [key, value] of Object.entries(card)) if (!used.has(key)) unrec.add(key, value);
  if (wrapper) for (const [key, value] of Object.entries(wrapper)) if (!WRAPPER_KEYS.has(key)) unrec.add(`wrapper.${key}`, value);
  if (unrec.entries.length) detail.unrecognised = unrec.entries;
  if (unrec.omitted) {
    detail.unrecognisedOmitted = unrec.omitted;
    warn(`${unrec.omitted} further unrecognised fields were omitted.`);
  }
  return detail;
}

/**
 * Describe every card on a native board, worksheet or report for read-only tools. Every model/page reference in the
 * result is a UxEntityRef, and `references` lists each once (kind + ID + owning module) for name resolution.
 * Throws UxDefinitionError only for unsafe/unbounded JSON, a non-object root or missing page identity.
 */
export function describePageCards(pageType: UxPageType, native: unknown): UxPageCardDetails {
  const page = copyDocument(native, { boundStringsEarly: true });
  const [pageGuid, appGuid, name, customerId, workspaceId, modelId] = IDENTITY.map(key => identity(page, key));
  const out = new Collector();
  const entries = cardEntries(pageType, page, out);
  const navLinks: unknown[] = [];
  const placements = placeCards(pageType, page, entries, out, navLinks);
  const pageContext = describePage(pageType, page, entries, navLinks, out);
  const cards = entries.map(entry => describeCard(entry, placements.get(entry.id) ?? { kind: "unplaced" }, page.modelId as string, out));
  return { pageType, pageGuid, appGuid, name, customerId, workspaceId, modelId, pageContext, cards, references: out.references, warnings: out.finish() };
}
