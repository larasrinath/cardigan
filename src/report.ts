import type { UxPageCardDetails } from "./card-reader/card-types.js";
import { list, type Obj } from "./util.js";

/** The analyser's seven tables, in the format agreed on the template (27 Sep 2026). Input is the named card description
 * from the card reader (card-reader/); everything here is presentation. */

export type Cell = string | number;
export interface Table { headers: string[]; rows: Cell[][] }
export type Report = Record<TabName, Table>;
export type TabName = "Pages" | "Cards" | "Grid sections" | "Filters" | "Formatting" | "Actions" | "Where used";

export interface PageInput {
  appName: string;
  categoryName: string;
  pageName: string;
  pageType: string;
  /** "Published (no unpublished changes)", "Published, draft differs", or why the page was not analysed. */
  state: string;
  modelName: string;
  workspaceName: string;
  publishedAt?: number | string;
  pageGuid: string;
  appGuid: string;
  modelId: string;
  details?: UxPageCardDetails;
  /** List names by ID, for hierarchy levels stored as `_<listId>_`. */
  dimensionNames?: ReadonlyMap<string, string>;
  /** Action types (IMPORT, EXPORT, PROCESS) whose model lookup failed, as opposed to a name not found. */
  failedActionTypes?: readonly string[];
}

/** What a cell holds where there is nothing to say: a plain hyphen. The results page shows it greyed in the app's tables
 * and takes it for no value wherever it reads them, so a hyphen that an Anaplan user typed alone, as a name or a value,
 * counts as no value there too: that is accepted (results/table-engine.ts `NONE`). */
export const NONE = "-";
export const LINE_ITEMS = "20000000012";
/** Column names in Page Builder's words where it has them ("Context selectors", "Show items that match"); every row that
 * belongs to a grid section names that section's module (reviewed with the user, 28 Sep 2026). */
export const HEADERS: Record<TabName, string[]> = {
  Pages: ["App", "Category", "Page", "Page type", "Publish state", "Model", "Workspace", "Total cards", "Grid cards", "Chart cards", "Grid & chart views",
    "KPI cards", "Field cards", "Action cards", "Text & image cards", "Last published", "Page ID", "App ID", "Model ID"],
  Cards: ["Page", "Card #", "Card title", "Card type", "View type", "Source module(s)", "Saved view", "Line items shown", "Rows", "Columns",
    "Context selectors", "Filters", "Sorts & hidden items", "Conditional formatting", "Buttons & links", "Text content", "Card settings", "Card ID", "Source IDs"],
  "Grid sections": ["Page", "Card #", "View type", "Section #", "Section layout", "Source module", "Saved view", "Rows", "Columns", "Context selectors",
    "Line items shown", "Row filter", "Column filter", "Sorts & hidden items", "Conditional formatting", "Card ID", "Section ID", "Module ID"],
  Filters: ["Page", "Card #", "Section #", "Filtered module", "Filter on", "Filtered dimension", "Condition group", "Show items that match",
    "Condition line item", "Condition line item's module", "Operator", "Value", "Condition context", "Card ID", "Line item ID"],
  Formatting: ["Page", "Card #", "Section #", "Formatted module", "Format style", "Formatted line item", "Colour driven by", "Colour stops", "Card ID", "Line item ID"],
  Actions: ["Page", "Card #", "Button label", "Action type", "Model action name", "Name source", "Runs automatically", "Cancel button", "Card ID", "Action ID"],
  "Where used": ["Object type", "Object name", "Object's module", "Page", "Card #", "Used as", "Object ID"],
};

const TYPE_LABEL: Record<string, string> = { TABLE: "Grid", CARD: "KPI", FIELD: "Field", COMBOCHART: "Chart", ACTION: "Action", TEXT: "Text", IMAGE: "Image",
  PRESENTATION_TABLE: "Report table" };
export const PAGE_TYPE: Record<string, string> = { BOARD: "Board", "GRID-PAGE": "Worksheet", REPORT: "Report" };
const OPERATOR: Record<string, string> = {
  EQUALS: "is equal to", NOT_EQUALS: "is not equal to", LESS_THAN: "is less than", LESS_THAN_OR_EQUAL_TO: "is less than or equal to",
  GREATER_THAN: "is greater than", GREATER_THAN_OR_EQUAL_TO: "is greater than or equal to", BETWEEN_OR_EQUAL_TO: "is between",
  IS_BLANK: "is blank", IS_NOT_BLANK: "is not blank", CONTAINS: "contains", STARTS_WITH: "starts with", ENDS_WITH: "ends with",
};
const ACTION_TYPE: Record<string, string> = {
  IMPORT: "Import", EXPORT: "Export", PROCESS: "Process", BULK_COPY: "Bulk copy", ASSIGN: "Assign", COPY_BRANCH: "Copy branch",
  INTEGRATION: "Integration", FORECASTER: "Forecaster", WORKFLOW_TEMPLATE: "Workflow template", NOTIFICATION: "Notification", FORM: "Form",
  WRITEBACK: "Writeback", NAVIGATION: "Navigation", DMS_EXTRACT: "Data Orchestrator extract", DMS_LINK: "Data Orchestrator link",
};
const MODEL_ACTIONS = new Set(["IMPORT", "EXPORT", "PROCESS"]);
// Page Builder labels: every rule colours cells by value; the type says where the colour goes.
const CF_STYLE: Record<string, string> = { BG_COLOR: "Background", FONT: "Font colour", SLOT: "Border", MORSE: "Morse" };
// Shaped on the page, built in the model and only selected there, or several module sections in one card.
const VIEW_TYPE: Record<string, string> = { customView: "Custom view", savedView: "Saved view", moduleView: "Saved view", combinedGrid: "Combined grid" };
const VIEW_ORDER = ["Custom view", "Saved view", "Combined grid"];
const IN_MODEL = "Set in the model (saved view)";

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
const unique = <T>(values: T[]): T[] => [...new Set(values)];

export function name(ref: unknown): string {
  const obj = ref && typeof ref === "object" ? (ref as Obj) : {};
  return (typeof obj.name === "string" && obj.name) || (typeof obj.id === "string" && obj.id) || NONE;
}

function num(value: unknown): string {
  return typeof value === "number" ? value.toLocaleString("en-US", { maximumFractionDigits: 20 }) : String(value);
}

export function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function itemsText(items: unknown[]): string {
  const names = items.map(item => (item && typeof item === "object" ? name(item) : String(item)));
  return names.slice(0, 5).join(", ") + (names.length > 5 ? ` and ${names.length - 5} more` : "");
}

/** Hierarchy levels are stored as LEAF, TOTALS or `_<listId>_` (the level of that list; observed live, 28 Sep 2026). */
function levelLabel(level: unknown, names?: ReadonlyMap<string, string>): string {
  const text = String(level);
  if (text === "LEAF") return "lowest level";
  if (text === "TOTALS") return "top level";
  const listId = /^_(\d+)_$/.exec(text)?.[1];
  return listId ? names?.get(listId) ?? listId : text;
}

function dimLabel(entry: Obj, names?: ReadonlyMap<string, string>): string {
  let label = name(entry.dimension);
  const levels: unknown[] = Array.isArray(entry.levels) ? entry.levels : [];
  if (levels.length === 1 && levels[0] === "LEAF") label += " (lowest level only)";
  else if (levels.length) label += ` (levels: ${levels.map(level => levelLabel(level, names)).join(", ")})`;
  return label;
}

/** A context selector: saved on the page with its settings, or (source `axis` or `module`) placed there by the model. */
function selectorLabel(page: Obj): string {
  if (page.visible === undefined && (page.source === "axis" || page.source === "module")) return name(page.dimension);
  const flags = [page.visible ? "visible" : "hidden", ...(page.syncedToPage ? ["synced to page"] : [])];
  return `${name(page.dimension)} (${flags.join(", ")})`;
}

/** Saved views are named `Module.'View'` or `'Module'.'View'` in model metadata; the module has its own column. */
export function viewName(view: unknown): string {
  let text = name(view);
  const module = view && typeof view === "object" ? (view as Obj).moduleName : undefined;
  if (typeof module === "string" && module) {
    for (const prefix of [`'${module}'.`, `${module}.`]) {
      if (text.startsWith(prefix)) { text = text.slice(prefix.length); break; }
    }
  }
  return text.length > 1 && text[0] === "'" && text[text.length - 1] === "'" ? text.slice(1, -1) : text;
}

type Condition = [group: string, match: string, condition: Obj];

/** Flattens a filter tree in native order. Page Builder wraps its rule group in an outer group; that reads as group 1. */
function conditions(node: unknown, group = "1"): Condition[] {
  if (!node || typeof node !== "object") return [];
  let current = node as Obj;
  while (!list(current.conditions).length && list(current.groups).length === 1) current = list(current.groups)[0];
  const match = capitalize(String(current.match || current.operator || ""));
  const out: Condition[] = list(current.conditions).map(condition => [group, match, condition]);
  list(current.groups).forEach((child, index) => out.push(...conditions(child, `${group}.${index + 1}`)));
  return out;
}

interface ConditionParts { lineItem: string; module: string; lineItemId: string; operator: string; value: string; context: string }

function conditionParts(condition: Obj): ConditionParts {
  const lineItem: Obj = condition.filterLineItem ?? { name: list(condition.selectedItems).map(ref => name(ref)).join(", ") };
  const context = list(condition.filterContext)
    .map(entry => (entry.dimension ? `${name(entry.dimension)} = ${entry.selection ?? "current"}` : name(entry.item)))
    .join("; ");
  const values: unknown[] = Array.isArray(condition.values) ? condition.values : [];
  return {
    lineItem: name(lineItem),
    module: lineItem.moduleName || NONE,
    lineItemId: lineItem.id ?? NONE,
    operator: OPERATOR[condition.operator] ?? String(condition.operator ?? ""),
    value: values.map(String).join(", ") || NONE,
    context: context || NONE,
  };
}

function conditionText(parts: ConditionParts): string {
  const text = `${parts.lineItem} [${parts.module}] ${parts.operator} ${parts.value}`;
  return parts.context === NONE ? text : `${text} (context: ${parts.context})`;
}

function cfRuleText(rule: Obj): string {
  return list(rule.pegs).map(peg => `${num(peg.value)} → ${peg.color}`).join("; ") || NONE;
}

function cfStyle(rule: Obj): string {
  return CF_STYLE[rule.type] ?? String(rule.type ?? NONE);
}

function settingsText(card: Obj): string {
  const s: Obj = card.settings ?? {};
  const parts: string[] = [];
  if (card.type === "TABLE") {
    parts.push(s.isReadOnly ? "Read-only" : "Editable", `pivot ${s.pivotEnabled ? "on" : "off"}`,
      `filter/sort ${s.allowFiltering && s.allowSorting ? "on" : "limited"}`, `CSV export ${s.csvExportEnabled ? "on" : "off"}`);
  }
  if (card.type === "CARD" && card.kpi) {
    const k: Obj = card.kpi;
    parts.push(`text ${k.textStyle ?? NONE}`, `scale ${k.numberScale ?? NONE}`, `sparkline ${k.showSparkline ? "on" : "off"}`);
  }
  if (card.type === "COMBOCHART" && card.chart) parts.push(`chart type ${card.chart.chartType ?? NONE}`);
  return parts.join(" · ") || NONE;
}

// Grid sections. A combined grid's sections that name the same row (or column) axis key share that axis: its dimensions and filter.
type Axis = "rows" | "columns";

function axisGroups(regions: Obj[], axis: Axis): number[][] {
  const key = axis === "rows" ? "rowAxisKey" : "columnAxisKey";
  const groups = new Map<string, number[]>();
  regions.forEach((region, index) => {
    const id = String(region[key] || region.region);
    groups.set(id, [...(groups.get(id) ?? []), index + 1]);
  });
  return [...groups.values()];
}

function sectionsText(orders: number[]): string {
  return orders.length === 1 ? `section ${orders[0]}` : `sections ${orders.slice(0, -1).join(", ")} and ${orders[orders.length - 1]}`;
}

function axisDims(region: Obj, axis: Axis, names?: ReadonlyMap<string, string>): string {
  return list(region[axis]?.dimensions).map(entry => dimLabel(entry, names)).join("; ") || NONE;
}

/** One value when the sections share the axis, otherwise one value per group of sections. */
function perAxis(regions: Obj[], axis: Axis, names?: ReadonlyMap<string, string>): string {
  const groups = axisGroups(regions, axis);
  if (groups.length === 1) {
    const value = axisDims(regions[0], axis, names);
    return regions.length === 1 || value === NONE ? value : `${value} (shared by all sections)`;
  }
  return groups.map(orders => `${capitalize(sectionsText(orders))}: ${axisDims(regions[orders[0] - 1], axis, names)}`).join(" | ");
}

function axisExtras(region: Obj, axis: Axis): string[] {
  const out: string[] = [];
  for (const entry of list(region[axis]?.dimensions)) {
    const dim = name(entry.dimension);
    const sorts: unknown[] = Array.isArray(entry.sorts) ? entry.sorts : [];
    const shows: unknown[] = Array.isArray(entry.shows) ? entry.shows : [];
    const hides: unknown[] = Array.isArray(entry.hides) ? entry.hides : [];
    if (sorts.length) out.push(`${dim}: sorted (${plural(sorts.length, "sort key")})`);
    if (shows.length) out.push(`${dim}: only ${itemsText(shows)} shown`);
    if (hides.length) out.push(`${dim}: ${plural(hides.length, "item")} hidden (${itemsText(hides)})`);
  }
  return out;
}

function regionPages(region: Obj): string {
  return list(region.pivot?.pages).map(selectorLabel).join("; ") || NONE;
}

function regionLineItems(region: Obj): string {
  for (const axis of ["rows", "columns"] as const) {
    for (const entry of list(region[axis]?.dimensions)) {
      if (entry.dimension?.id !== LINE_ITEMS) continue;
      const where = `Line Items on ${axis}`;
      if (Array.isArray(entry.shows) && entry.shows.length) return `Only ${itemsText(entry.shows)} (${where})`;
      if (Array.isArray(entry.hides) && entry.hides.length) return `All except ${itemsText(entry.hides)} (${where})`;
      return `All line items (${where})`;
    }
  }
  if (list(region.pivot?.pages).some(page => page.dimension?.id === LINE_ITEMS)) return "Chosen by the Line Items selector";
  return "Line Items not on rows, columns or a selector";
}

function filterSummary(region: Obj, axis: Axis, sharedWith: number[]): string {
  const found = conditions(region[axis]?.filter);
  if (!found.length) return NONE;
  const matches = unique(found.map(([, match]) => match.toLowerCase())).sort().join("/");
  return `${plural(found.length, "condition")}, match ${matches}` + (sharedWith.length ? ` (shared with ${sectionsText(sharedWith)})` : "");
}

function ruleSection(rule: Obj, regions: Obj[]): string {
  if (!regions.length) return NONE;
  if (regions.length === 1) return "1";
  const target = rule.regions?.targetRegionId;
  const index = regions.findIndex(region => region.region === target);
  return index >= 0 ? String(index + 1) : NONE;
}

function arrangement(regions: Obj[], order: number): string {
  if (regions.length < 2) return NONE;
  const me = regions[order - 1];
  const sharing = (key: string) => regions.flatMap((region, index) =>
    index + 1 !== order && me[key] && region[key] === me[key] ? [index + 1] : []);
  const beside = sharing("rowAxisKey");
  const stacked = sharing("columnAxisKey");
  const parts = [...(beside.length ? [`beside ${sectionsText(beside)} (same rows)`] : []),
    ...(stacked.length ? [`above or below ${sectionsText(stacked)} (same columns)`] : [])];
  return parts.length ? capitalize(parts.join("; ")) : "Own rows and columns";
}

function layoutDims(layout: Obj | undefined, axis: "rows" | "columns" | "pages"): string {
  return list(layout?.[axis]).map(d => String(d.name)).join("; ") || NONE;
}

/** A saved view's context selectors are its pages; the page may also save settings (visible, synced) for some of them. */
function savedViewSelectors(card: Obj, layout: Obj | undefined): string[] {
  const saved = list(card.contextSelectors);
  const pages = list(layout?.pages).map(page => {
    const settings = saved.find(selector => selector.dimension?.id === page.id);
    return settings ? selectorLabel(settings) : String(page.name);
  });
  const inLayout = new Set(list(layout?.pages).map(page => String(page.id)));
  return [...pages, ...saved.filter(selector => !inLayout.has(String(selector.dimension?.id))).map(selectorLabel)];
}

function layoutLineItems(layout: Obj | undefined): string {
  for (const axis of ["rows", "columns", "pages"] as const) {
    if (list(layout?.[axis]).some(d => d.id === LINE_ITEMS)) return `Set by the saved view (Line Items on ${axis})`;
  }
  return "Set by the saved view";
}

function placementKey(card: Obj): [number, number] {
  const p: Obj = card.placement ?? {};
  return [p.rowIndex ?? p.slideIndex ?? p.index ?? 99, p.columnStart ?? p.position?.x ?? 0];
}

function publishedDate(value: number | string | undefined): string {
  if (value === undefined || value === null || value === "") return NONE;
  const date = new Date(typeof value === "number" ? value : String(value));
  return Number.isNaN(date.getTime()) ? NONE : date.toISOString().slice(0, 10);
}

/** Adds a Where used row; the first use of an object by a card in a role wins, so the order of the calls is the row order.
 * The card is a card of the page being read, whatever another page is called, and the object is the one with that type,
 * ID, name and module: another object of the same name, such as a line item of another module, is another object. */
type Use = (objType: string, obj: string, module: string, page: string, card: number, role: string, objId: string) => void;

/** Filters: once per native axis, so a rows filter shared by combined-grid sections is listed once. Returns the Cards row's
 * text for each condition. */
function filterRows(page: string, order: number, card: Obj, regions: Obj[], rows: Record<TabName, Cell[][]>, use: Use): string[] {
  const combined = regions.length > 1;
  const filterTexts: string[] = [];
  for (const axis of regions.length ? (["rows", "columns"] as const) : []) {
    for (const orders of axisGroups(regions, axis)) {
      const axisDetail: Obj = regions[orders[0] - 1][axis] ?? {};
      const section = orders.join(", ") + (orders.length > 1 ? ` (shared ${axis})` : "");
      const where = combined ? `${capitalize(axis)} (${sectionsText(orders)})` : capitalize(axis);
      const filtered = list(axisDetail.dimensions).map(entry => name(entry.dimension)).join(", ");
      // The grid (module) the filter narrows; sections sharing an axis share its filter.
      const filteredModule = unique(orders.map(o => name(regions[o - 1].module))).join("; ");
      for (const [group, match, condition] of conditions(axisDetail.filter)) {
        const parts = conditionParts(condition);
        filterTexts.push(`${where}, match ${match.toLowerCase()}: ${conditionText(parts)}`);
        rows.Filters.push([page, order, section, filteredModule, capitalize(axis), filtered, group, match, parts.lineItem, parts.module,
          parts.operator, parts.value, parts.context, card.id, parts.lineItemId]);
        use("Line item", parts.lineItem, parts.module, page, order, "Filter", parts.lineItemId);
        for (const context of list(condition.filterContext)) {
          if (context.dimension) use("Dimension", name(context.dimension), NONE, page, order, "Filter context", context.dimension.id);
        }
      }
    }
  }
  return filterTexts;
}

/** Conditional formatting (grid rules and the KPI indicator). Returns the Cards row's text for each rule. */
function formattingRows(page: string, order: number, card: Obj, regions: Obj[], sources: Obj[], rows: Record<TabName, Cell[][]>, use: Use): string[] {
  const combined = regions.length > 1;
  const cfTexts: string[] = [];
  for (const rule of list(card.conditionalFormatting)) {
    const style = cfStyle(rule);
    const target: Obj | undefined = rule.target;
    const source: Obj | undefined = rule.source;
    const section = ruleSection(rule, regions);
    const valuesFrom = name(target) === name(source) ? "" : ` (values from ${name(source)})`;
    const styleText = style.toLowerCase().includes("colour") ? style : `${style} colour`;
    cfTexts.push((combined ? `Section ${section}: ` : "") + `${styleText} on ${name(target)}${valuesFrom}: ${cfRuleText(rule)}`);
    const formattedModule = name(regions[Number(section) - 1]?.module ?? (regions.length ? undefined : sources[0]?.module));
    rows.Formatting.push([page, order, section, formattedModule, style, name(target), name(source), cfRuleText(rule), card.id, target?.id ?? NONE]);
    use("Line item", name(target), target?.moduleName ?? NONE, page, order, "Formatting", target?.id ?? NONE);
    if (name(target) !== name(source)) use("Line item", name(source), source?.moduleName ?? NONE, page, order, "Formatting values", source?.id ?? NONE);
  }
  const indicator: Obj | undefined = card.kpi?.indicator;
  if (indicator) {
    const icons = list(indicator.threshold?.icons);
    const iconNames = unique(icons.map(icon => String(icon.iconId ?? "").replace(/_/g, " ").toLowerCase())).sort();
    const type = String(indicator.type ?? "").toLowerCase();
    const text = `${icons.length} icons (${iconNames.join(", ")}); no threshold values set`;
    cfTexts.push(`KPI indicator (${type}): ${text}`);
    const kpiModule = card.kpi.module ?? card.kpi.lineItem?.moduleName ?? sources[0]?.module;
    rows.Formatting.push([page, order, NONE, typeof kpiModule === "string" ? kpiModule : name(kpiModule), `KPI indicator – ${type} icons`, "KPI value",
      name(card.kpi.lineItem), text, card.id, card.kpi.lineItem?.id ?? NONE]);
  }
  return cfTexts;
}

/** Actions and links. Returns the Cards row's text for each button and for a title link. */
function actionRows(page: string, order: number, card: Obj, failedActionTypes: readonly string[] | undefined, rows: Record<TabName, Cell[][]>,
  use: Use): string[] {
  const actionTexts: string[] = [];
  for (const button of list(card.actions)) {
    const action: Obj = button.action ?? {};
    const nativeType = String(action.actionType ?? "");
    const actionType = ACTION_TYPE[nativeType] ?? (nativeType || NONE);
    const modelAction = MODEL_ACTIONS.has(nativeType);
    const nameFrom = !modelAction ? "Card label (not a model object)" : action.name ? "Model"
      : failedActionTypes?.includes(nativeType) ? "Card label (model lookup failed)" : "Card label (not found in the model)";
    const modelName = nameFrom === "Model" ? String(action.name) : NONE;
    const label = typeof button.name === "string" ? button.name : NONE;
    actionTexts.push(`${actionType}: ${label}`);
    const runs = modelAction ? (button.runAutomatically === true ? "Yes" : button.runAutomatically === false ? "No (asks first)" : "Yes (default)") : "n/a";
    const cancel = nativeType === "PROCESS" ? (button.disableCancelButton ? "Cancel disabled" : "Cancel allowed") : "n/a";
    rows.Actions.push([page, order, label, actionType, modelName, nameFrom, runs, cancel, card.id, action.id ?? NONE]);
    use(actionType, modelName === NONE ? label : modelName, NONE, page, order, "Action button", action.id ?? NONE);
  }
  if (card.navigation?.page) {
    const nav: Obj = card.navigation;
    actionTexts.push(`Title links to ${(PAGE_TYPE[nav.pageType] ?? "page").toLowerCase()} ${name(nav.page)}`);
    use("Page", name(nav.page), NONE, page, order, "Link target", nav.page.id);
  }
  return actionTexts;
}

/** Grid sections: one row per section of every grid and chart, or one row for a saved view the card only selects. */
function sectionRows(page: string, order: number, card: Obj, regions: Obj[], viewLabel: string, selectedView: Obj | undefined, viewText: string,
  names: ReadonlyMap<string, string> | undefined, rows: Record<TabName, Cell[][]>): void {
  regions.forEach((region, index) => {
    const section = index + 1;
    const shared = (axis: Axis) => (axisGroups(regions, axis).find(group => group.includes(section)) ?? []).filter(other => other !== section);
    const rules = list(card.conditionalFormatting).filter(rule => ruleSection(rule, regions) === String(section));
    rows["Grid sections"].push([page, order, viewLabel, section, arrangement(regions, section), name(region.module), NONE,
      axisDims(region, "rows", names), axisDims(region, "columns", names), regionPages(region), regionLineItems(region),
      filterSummary(region, "rows", shared("rows")), filterSummary(region, "columns", shared("columns")),
      [...axisExtras(region, "rows"), ...axisExtras(region, "columns")].join("; ") || NONE,
      rules.length ? `${plural(rules.length, "rule")} (${unique(rules.map(cfStyle)).join(", ")})` : NONE,
      card.id, region.region, region.module?.id ?? NONE]);
  });
  if (selectedView && !regions.length) {
    const layout: Obj | undefined = selectedView.viewLayout;
    rows["Grid sections"].push([page, order, viewLabel, 1, NONE, name(selectedView.module), viewText,
      layoutDims(layout, "rows"), layoutDims(layout, "columns"), savedViewSelectors(card, layout).join("; ") || NONE, layoutLineItems(layout),
      IN_MODEL, IN_MODEL, IN_MODEL, NONE, card.id, NONE, selectedView.module?.id ?? NONE]);
  }
}

export function buildReport(pages: readonly PageInput[]): Report {
  const rows: Record<TabName, Cell[][]> = { Pages: [], Cards: [], "Grid sections": [], Filters: [], Formatting: [], Actions: [], "Where used": [] };

  for (const input of pages) {
    const page = input.pageName;
    // The uses already written, of this page only: a page of the same name has its own.
    const used = new Set<string>();
    const use: Use = (objType, obj, module, usedOn, card, role, objId) => {
      const key = JSON.stringify([objType, obj, module, objId, card, role]);
      if (used.has(key)) return;
      used.add(key);
      rows["Where used"].push([objType, obj, module, usedOn, card, role, objId]);
    };
    const typeCounts: Record<string, number> = Object.fromEntries(Object.values(TYPE_LABEL).map(label => [label, 0]));
    const viewCounts: Record<string, number> = Object.fromEntries(VIEW_ORDER.map(label => [label, 0]));
    const cards = [...(input.details?.cards ?? [])].map(card => card as Obj)
      .map((card, index) => ({ card, index }))
      .sort((a, b) => {
        const [ra, ca] = placementKey(a.card);
        const [rb, cb] = placementKey(b.card);
        return ra - rb || ca - cb || a.index - b.index;
      })
      .map(({ card }) => card);

    cards.forEach((card, position) => {
      const order = position + 1;
      const kind = TYPE_LABEL[card.type] ?? capitalize(String(card.type ?? "Card"));
      typeCounts[kind] = (typeCounts[kind] ?? 0) + 1;
      const title = card.title || NONE;
      const viewType: string | undefined = card.viewType;
      const regions = list(card.grid?.regions);
      const combined = regions.length > 1;
      const sources = list(card.sources);
      const saved = sources.find(source => source.view);
      const selectedView = saved ?? (viewType === "moduleView" ? sources.find(source => source.module) : undefined);
      const viewLabel = (viewType && VIEW_TYPE[viewType] ? VIEW_TYPE[viewType] : NONE) + (combined ? ` (${regions.length} sections)` : "");
      if (viewType && VIEW_TYPE[viewType]) viewCounts[VIEW_TYPE[viewType]] += 1;

      // Modules and saved views
      const modules: [number | undefined, Obj][] = combined
        ? regions.flatMap((region, index) => (region.module ? [[index + 1, region.module] as [number, Obj]] : []))
        : [...new Map(sources.filter(source => source.module).map(source => [source.module.id, [undefined, source.module] as [undefined, Obj]])).values()];
      const role = ({ customView: "Data source (custom view)", savedView: "Data source (via saved view)", moduleView: "Data source (default view)" } as Record<string, string>)[viewType ?? ""] ?? "Data source";
      for (const [section, module] of modules) {
        use("Module", name(module), NONE, page, order, section ? `Data source (combined grid section ${section})` : role, module.id);
      }
      let viewText = NONE;
      if (saved) {
        viewText = viewName(saved.view);
        use("Saved view", viewText, saved.view.moduleName ?? NONE, page, order, "Data source", saved.view.id);
      } else if (viewType === "moduleView") viewText = "Default view of the module";
      const moduleText = combined ? modules.map(([section, module]) => `Section ${section}: ${name(module)}`).join(" | ") : modules.map(([, module]) => name(module)).join("; ");

      // Line items shown, axes and selectors
      const lineItems: string[] = [];
      const pagesDims: string[] = [];
      let extras: string[] = [];
      let rowsText = NONE;
      let colsText = NONE;
      if (card.kpi?.lineItem) {
        const li = card.kpi.lineItem;
        lineItems.push(name(li));
        use("Line item", name(li), li.moduleName ?? NONE, page, order, "KPI value", li.id);
      }
      for (const field of list(card.fields)) {
        if (!field.lineItem) continue;
        lineItems.push(name(field.lineItem));
        use("Line item", name(field.lineItem), field.lineItem.moduleName ?? NONE, page, order, "Field", field.lineItem.id);
      }
      if (card.image?.lineItem) {
        const li = card.image.lineItem;
        lineItems.push(`${name(li)} (image)`);
        use("Line item", name(li), li.moduleName ?? NONE, page, order, "Image", li.id);
      }
      if (regions.length) {
        rowsText = perAxis(regions, "rows", input.dimensionNames);
        colsText = perAxis(regions, "columns", input.dimensionNames);
        regions.forEach((region, index) => {
          const prefix = combined ? `Section ${index + 1}: ` : "";
          lineItems.push(prefix + regionLineItems(region));
          if (regionPages(region) !== NONE) pagesDims.push(prefix + regionPages(region));
          for (const axis of ["rows", "columns"] as const) {
            for (const entry of list(region[axis]?.dimensions)) {
              if (entry.dimension) use("Dimension", name(entry.dimension), NONE, page, order, capitalize(axis), entry.dimension.id);
            }
          }
          for (const pivotPage of list(region.pivot?.pages)) {
            if (pivotPage.dimension) use("Dimension", name(pivotPage.dimension), NONE, page, order, "Page selector", pivotPage.dimension.id);
          }
        });
        for (const axis of ["rows", "columns"] as const) {
          for (const orders of axisGroups(regions, axis)) {
            const prefix = combined ? `${capitalize(axis)} (${sectionsText(orders)}): ` : "";
            extras.push(...axisExtras(regions[orders[0] - 1], axis).map(extra => prefix + extra));
          }
        }
      } else if (selectedView) {
        const layout: Obj | undefined = selectedView.viewLayout;
        rowsText = layoutDims(layout, "rows");
        colsText = layoutDims(layout, "columns");
        pagesDims.push(...savedViewSelectors(card, layout));
        lineItems.push(layoutLineItems(layout));
        extras = [IN_MODEL];
        for (const axis of ["rows", "columns", "pages"] as const) {
          for (const d of list(layout?.[axis])) use("Dimension", String(d.name), NONE, page, order, `${capitalize(axis)} (saved view)`, String(d.id));
        }
      } else {
        pagesDims.push(...list(card.contextSelectors).map(selectorLabel));
      }

      const filterTexts = filterRows(page, order, card, regions, rows, use);
      if (selectedView) filterTexts.push(IN_MODEL);
      const cfTexts = formattingRows(page, order, card, regions, sources, rows, use);
      const actionTexts = actionRows(page, order, card, input.failedActionTypes, rows, use);
      const text: string | undefined = card.text?.plainText;
      sectionRows(page, order, card, regions, viewLabel, selectedView, viewText, input.dimensionNames, rows);

      const join = combined ? " | " : "; ";
      rows.Cards.push([page, order, title, kind, viewLabel, moduleText || NONE, viewText,
        unique(lineItems).join(join) || NONE, rowsText, colsText, pagesDims.join(join) || NONE,
        filterTexts.join(" | ") || NONE, unique(extras).join("; ") || NONE, cfTexts.join(" | ") || NONE,
        actionTexts.join(" | ") || NONE, text || NONE, settingsText(card), card.id,
        unique([...modules.map(([, module]) => String(module.id)), ...(saved ? [String(saved.view.id)] : [])]).join("; ") || NONE]);
    });

    rows.Pages.push([input.appName, input.categoryName, page, PAGE_TYPE[input.pageType] ?? input.pageType, input.state, input.modelName,
      input.workspaceName, cards.length, typeCounts.Grid, typeCounts.Chart,
      VIEW_ORDER.filter(label => viewCounts[label]).map(label => plural(viewCounts[label], label.toLowerCase())).join(", ") || NONE,
      typeCounts.KPI, typeCounts.Field, typeCounts.Action, typeCounts.Text + typeCounts.Image, publishedDate(input.publishedAt),
      input.pageGuid, input.appGuid, input.modelId]);
  }

  return Object.fromEntries((Object.keys(HEADERS) as TabName[]).map(tab => [tab, { headers: HEADERS[tab], rows: rows[tab] }])) as Report;
}
