import { CONTENT_SCRIPT_ORIGIN } from "./protocol.js";
import type { AnalysisResult, AxisFilter, Cell, FileOptions, ImportHeader, ImportMapping, ItemMatch, MappedSource, MappedTarget, PageUses, ProcessActions, ProcessStep,
  ResultTable, SavedViewDetail, SavedViewFilter, TargetKind, ViewAxis, ViewCondition } from "./result-types.js";

/** A result leaves the place that made it as plain data: a window message from the model's core frame, then JSON on the port
 * to the results page. These keep it to what both carry unchanged, so a table is the same on either side, cell for
 * cell. */

/** A value as text, the way String makes it. String cannot convert an object whose own toString and valueOf are not
 * functions, and both JSON and a message from another window can hold one: it is written as any other object is. */
export const textOf = (value: unknown): string => { try { return String(value); } catch { return "[object Object]"; } };

/** A cell as text or a finite number, which JSON keeps as they are. Anything else becomes its text, as `String` makes it
 * (nothing for null and undefined): what the page shows for the cell is the same before and after. */
export const plainCell = (value: unknown): Cell =>
  typeof value === "string" || (typeof value === "number" && Number.isFinite(value)) ? value : value === null || value === undefined ? "" : textOf(value);

/** Rows of plain cells. A hole in a row is a cell that is not there, and is the empty text: `map` would keep the hole,
 * and JSON would turn it into null. */
export const plainRows = (rows: readonly (readonly unknown[])[]): Cell[][] => rows.map(row => Array.from(row, plainCell));

/** A file name as the analysis writes it: none of the characters a file name cannot hold (util.ts `fileSafe`), so a name
 * from another window can never be a path. */
const fileName = (value: unknown, extension: string): value is string =>
  typeof value === "string" && value.endsWith(extension) && value.length > extension.length && !/[\\/:*?"<>|\u0000-\u001f]/.test(value);

/** A model's modules or lists and their IDs: pairs of a name and an ID of digits only, or nothing when anything else is
 * there. A result is not refused for them: the page only cannot open its modules or lists in Anaplan. */
function readIds(value: unknown): [string, string][] | undefined {
  if (!Array.isArray(value)) return undefined;
  const pairs: [string, string][] = [];
  for (const pair of Array.from(value as unknown[])) {
    if (!Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== "string" || typeof pair[1] !== "string" || !/^\d{1,19}$/.test(pair[1])) return undefined;
    pairs.push([pair[0], pair[1]]);
  }
  return pairs;
}

/** A model's Line Items rows' IDs (result-types.ts `lineItemIds`): pairs of an ID of digits and a module's ID of digits or
 * none, or nothing when anything else is there. As for the modules' IDs, a result is not refused for them: the pages
 * built on the model are only read without them. */
function readLineItemIds(value: unknown): [string, string][] | undefined {
  if (!Array.isArray(value)) return undefined;
  const pairs: [string, string][] = [];
  for (const pair of Array.from(value as unknown[])) {
    if (!Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== "string" || typeof pair[1] !== "string" || !/^\d{1,19}$/.test(pair[0])
        || !/^\d{0,19}$/.test(pair[1])) return undefined;
    pairs.push([pair[0], pair[1]]);
  }
  return pairs;
}

/** A model's Line Items columns (result-types.ts `lineItemColumns`): a list of texts, or nothing when anything else is
 * there. A result is not refused for them: the engine is then told by the Line Items table alone. */
function readTexts(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const texts = Array.from(value as unknown[]);
  return texts.every((text): text is string => typeof text === "string") ? texts : undefined;
}

/** Where a model was read: an Anaplan site's origin, as the content scripts run on, and a customer's ID, or nothing when
 * anything else is there. As for the modules' IDs, a result is not refused for it: the page only cannot open the model's
 * modules, apps and pages by it. */
function readSite(value: unknown): { origin: string; customer: string } | undefined {
  const site = value as { origin?: unknown; customer?: unknown } | null;
  return site && typeof site === "object" && typeof site.origin === "string" && CONTENT_SCRIPT_ORIGIN.test(site.origin) && typeof site.customer === "string"
    && /^[0-9A-Fa-f]{32}$/.test(site.customer) ? { origin: site.origin, customer: site.customer } : undefined;
}

/** What feeds a target of an import, by the result's word for it (result-types.ts `MappedSource`). */
const SOURCES: ReadonlySet<string> = new Set<MappedSource>(["column", "constant", "prompt", "ignore", "headerRow", "none", "numbered", "other"]);

/** A count of a mapping: a whole number, nought or more. */
const isCount = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

/** What a target of an import into a module is, by the result's word for it (result-types.ts `TargetKind`). */
const KINDS: ReadonlySet<string> = new Set<TargetKind>(["time", "versions", "list", "lineItems", "lineItem", "value", "other"]);

/** One target of an import's mapping, every field checked, or nothing when anything else is there. What a target of 0.38.0
 * holds more, a list's items mapped manually and the list's ID (`pairs`, `dimensionId`), is left out, whatever it is: the
 * page lists no list's items, only how many are mapped manually. */
function readTarget(value: unknown): MappedTarget | undefined {
  const target = value as Partial<MappedTarget> | null;
  if (!target || typeof target !== "object" || typeof target.target !== "string" || typeof target.source !== "string" || !SOURCES.has(target.source)
      || (target.column !== undefined && !(Number.isSafeInteger(target.column) && target.column >= 1)) || (target.text !== undefined && typeof target.text !== "string")
      || (target.id !== undefined && typeof target.id !== "string")
      || (target.items !== undefined && !(target.items && typeof target.items === "object" && isCount(target.items.byHand) && isCount(target.items.ignored)))
      || (target.periodFormat !== undefined && target.periodFormat !== null && typeof target.periodFormat !== "string")
      || (target.dateFormat !== undefined && typeof target.dateFormat !== "string")
      || (target.kind !== undefined && !(typeof target.kind === "string" && KINDS.has(target.kind))) || (target.area !== undefined && typeof target.area !== "string")) return undefined;
  return { target: target.target, source: target.source, ...(target.column !== undefined ? { column: target.column } : {}), ...(target.text !== undefined ? { text: target.text } : {}),
    ...(target.id !== undefined ? { id: target.id } : {}), ...(target.items !== undefined ? { items: { byHand: target.items.byHand, ignored: target.items.ignored } } : {}),
    ...(target.periodFormat !== undefined ? { periodFormat: target.periodFormat } : {}), ...(target.dateFormat !== undefined ? { dateFormat: target.dateFormat } : {}),
    ...(target.kind !== undefined ? { kind: target.kind } : {}), ...(target.area !== undefined ? { area: target.area } : {}) };
}

/** The File Options of an import's source, every field checked: undefined where there are none, and false where anything
 * else is there. Text for the encoding and the characters, and whole numbers from nought for the two rows. */
function readFileOptions(value: unknown): FileOptions | undefined | false {
  if (value === undefined) return undefined;
  const options = value as Partial<FileOptions> | null;
  const text = (field: unknown): boolean => field === undefined || typeof field === "string";
  if (!options || typeof options !== "object" || Array.isArray(options) || !text(options.encoding) || !text(options.separators) || !text(options.delimiter)
      || !text(options.decimal) || (options.headerRow !== undefined && !isCount(options.headerRow))
      || (options.firstDataRow !== undefined && !isCount(options.firstDataRow))) return false;
  return { ...(options.encoding !== undefined ? { encoding: options.encoding } : {}), ...(options.separators !== undefined ? { separators: options.separators } : {}),
    ...(options.delimiter !== undefined ? { delimiter: options.delimiter } : {}), ...(options.decimal !== undefined ? { decimal: options.decimal } : {}),
    ...(options.headerRow !== undefined ? { headerRow: options.headerRow } : {}), ...(options.firstDataRow !== undefined ? { firstDataRow: options.firstDataRow } : {}) };
}

/** The headers of an import mapped manually, every field checked: undefined where there are none, and false where anything
 * else is there. */
function readHeaders(value: unknown): ImportHeader[] | undefined | false {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return false;
  const headers: ImportHeader[] = [];
  for (const entry of Array.from(value as unknown[])) {
    const header = entry as Partial<ImportHeader> | null;
    if (!header || typeof header !== "object" || typeof header.header !== "string" || (header.lineItem !== undefined && typeof header.lineItem !== "string")) return false;
    headers.push({ header: header.header, ...(header.lineItem !== undefined ? { lineItem: header.lineItem } : {}) });
  }
  return headers;
}

/** How the ways an import into a list tells its items apart are written (result-types.ts `ItemMatch`). */
const MATCHES: ReadonlySet<string> = new Set<ItemMatch["by"]>(["nameOrCode", "name", "code", "properties"]);

/** How an import into a list tells its items apart, every field checked: undefined where there is none, and false where
 * anything else is there. */
function readMatch(value: unknown): ItemMatch | undefined | false {
  if (value === undefined) return undefined;
  const match = value as Partial<ItemMatch> | null;
  if (!match || typeof match !== "object" || typeof match.by !== "string" || !MATCHES.has(match.by)
      || (match.properties !== undefined && !(Array.isArray(match.properties) && Array.from(match.properties as unknown[]).every(name => typeof name === "string")))
      || (match.numbered !== undefined && typeof match.numbered !== "boolean")) return false;
  return { by: match.by, ...(match.properties !== undefined ? { properties: Array.from(match.properties) } : {}), ...(match.numbered !== undefined ? { numbered: match.numbered } : {}) };
}

/** A model's imports with their mappings (result-types.ts `ImportMapping`), every field checked, or nothing when anything
 * else is there. As for the modules' IDs, a result is not refused for them: the page only shows no mapping. The results
 * page checks a result's mappings so too before it shows one, whoever kept the result. A mapping an earlier version kept,
 * without a Source Type, a clear setting, File Options, whether its source is this model's or the kinds of its targets,
 * is read as it is. One that 0.38.0 kept is read without the module's ID it held for a list's items mapped manually
 * (`moduleId`), and without those items (`readTarget`), whatever they are: they never keep a result's mappings from being
 * read. */
export function readImportMappings(value: unknown): ImportMapping[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const mappings: ImportMapping[] = [];
  for (const entry of Array.from(value as unknown[])) {
    const mapping = entry as Partial<ImportMapping> | null;
    if (!mapping || typeof mapping !== "object" || typeof mapping.id !== "string" || !/^\d{0,19}$/.test(mapping.id) || typeof mapping.name !== "string"
        || typeof mapping.importType !== "string" || !Array.isArray(mapping.targets) || (mapping.note !== undefined && typeof mapping.note !== "string")
        || (mapping.sourceType !== undefined && typeof mapping.sourceType !== "string")
        || (mapping.clear !== undefined && mapping.clear !== "clear" && mapping.clear !== "update")
        || (mapping.sourceInThisModel !== undefined && typeof mapping.sourceInThisModel !== "boolean")) return undefined;
    const targets: MappedTarget[] = [];
    for (const item of Array.from(mapping.targets as unknown[])) {
      const target = readTarget(item);
      if (!target) return undefined;
      targets.push(target);
    }
    const matchedBy = readMatch(mapping.matchedBy);
    const headers = readHeaders(mapping.headers);
    const fileOptions = readFileOptions(mapping.fileOptions);
    if (matchedBy === false || headers === false || fileOptions === false) return undefined;
    mappings.push({ id: mapping.id, name: mapping.name, ...(mapping.sourceType !== undefined ? { sourceType: mapping.sourceType } : {}), importType: mapping.importType,
      targets, ...(matchedBy ? { matchedBy } : {}), ...(headers ? { headers } : {}), ...(mapping.clear !== undefined ? { clear: mapping.clear } : {}),
      ...(fileOptions ? { fileOptions } : {}), ...(mapping.sourceInThisModel !== undefined ? { sourceInThisModel: mapping.sourceInThisModel } : {}),
      ...(mapping.note !== undefined ? { note: mapping.note } : {}) });
  }
  return mappings;
}

/** A model's processes with the actions each runs (result-types.ts `ProcessActions`), every field checked, or nothing when
 * anything else is there. As for the mappings, a result is not refused for them: the page only lists no process's
 * actions by them. The results page checks them so too before it lists them, whoever kept the result. */
export function readProcessActions(value: unknown): ProcessActions[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const processes: ProcessActions[] = [];
  for (const entry of Array.from(value as unknown[])) {
    const process = entry as Partial<ProcessActions> | null;
    if (!process || typeof process !== "object" || typeof process.id !== "string" || !/^\d{0,19}$/.test(process.id) || typeof process.name !== "string"
        || !Array.isArray(process.actions) || (process.note !== undefined && typeof process.note !== "string")) return undefined;
    const actions: ProcessStep[] = [];
    for (const item of Array.from(process.actions as unknown[])) {
      const step = item as Partial<ProcessStep> | null;
      if (!step || typeof step !== "object" || typeof step.id !== "string" || !/^\d{0,19}$/.test(step.id) || typeof step.name !== "string" || typeof step.type !== "string") return undefined;
      actions.push({ id: step.id, name: step.name, type: step.type });
    }
    processes.push({ id: process.id, name: process.name, actions, ...(process.note !== undefined ? { note: process.note } : {}) });
  }
  return processes;
}

/** What the pages built on a model use of it by name (result-types.ts `PageUses`), every field checked, or nothing when
 * anything else is there. As for the mappings, a result is not refused for it. */
export function readPageUses(value: unknown): PageUses | undefined {
  const uses = value as Partial<PageUses> | null;
  if (!uses || typeof uses !== "object" || !Array.isArray(uses.lineItems) || !Array.isArray(uses.modules) || !isCount(uses.unread) || !isCount(uses.unnamed)) return undefined;
  const lineItems: [string, string][] = [];
  for (const pair of Array.from(uses.lineItems as unknown[])) {
    if (!Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== "string" || typeof pair[1] !== "string") return undefined;
    lineItems.push([pair[0], pair[1]]);
  }
  const modules = Array.from(uses.modules as unknown[]);
  if (!modules.every((module): module is string => typeof module === "string")) return undefined;
  return { lineItems, modules, unread: uses.unread, unnamed: uses.unnamed };
}

/** The axes of a view, by the result's words for them (result-types.ts `ViewAxis`). */
const AXES: ReadonlySet<string> = new Set<ViewAxis>(["Rows", "Columns", "Pages"]);
/** A list of texts, read entry by entry, or nothing where any entry is no text. */
const texts = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const entries = Array.from(value as unknown[]);
  return entries.every((entry): entry is string => typeof entry === "string") ? entries : undefined;
};

/** One condition of a view's filter, every field checked, or nothing when anything else is there. Its line item's ID is
 * digits; a condition an earlier version kept has none. */
function readCondition(value: unknown): ViewCondition | undefined {
  const condition = value as Partial<ViewCondition> | null;
  const values = texts(condition?.values);
  const contexts = texts(condition?.contexts);
  if (!condition || typeof condition !== "object" || typeof condition.lineItem !== "string" || (condition.lineItemModule !== undefined && typeof condition.lineItemModule !== "string")
      || (condition.lineItemId !== undefined && !(typeof condition.lineItemId === "string" && /^\d{1,19}$/.test(condition.lineItemId)))
      || typeof condition.operator !== "string" || typeof condition.dataType !== "string" || !values || !contexts || typeof condition.valid !== "boolean") return undefined;
  return { lineItem: condition.lineItem, ...(condition.lineItemModule !== undefined ? { lineItemModule: condition.lineItemModule } : {}),
    ...(condition.lineItemId !== undefined ? { lineItemId: condition.lineItemId } : {}), operator: condition.operator, dataType: condition.dataType, values, contexts,
    valid: condition.valid };
}

/** One axis's filter, every field checked, or nothing when anything else is there. Its dimensions, one by one, are texts; a
 * filter an earlier version kept has none. */
function readAxisFilter(value: unknown): AxisFilter | undefined {
  const filter = value as Partial<AxisFilter> | null;
  const dimensions = filter?.dimensions === undefined ? undefined : texts(filter.dimensions);
  if (!filter || typeof filter !== "object" || typeof filter.axis !== "string" || !AXES.has(filter.axis) || (filter.dimension !== undefined && typeof filter.dimension !== "string")
      || (filter.dimensions !== undefined && !dimensions)
      || typeof filter.active !== "boolean" || (filter.match !== "all" && filter.match !== "any") || !Array.isArray(filter.conditions)) return undefined;
  const conditions: ViewCondition[] = [];
  for (const entry of Array.from(filter.conditions as unknown[])) {
    const condition = readCondition(entry);
    if (!condition) return undefined;
    conditions.push(condition);
  }
  return { axis: filter.axis, ...(filter.dimension !== undefined ? { dimension: filter.dimension } : {}), ...(dimensions ? { dimensions } : {}), active: filter.active,
    match: filter.match, conditions };
}

/** A model's saved views with their filters (result-types.ts `SavedViewDetail`), every field checked, or nothing when
 * anything else is there. As for the mappings, a result is not refused for them: the page only lists no view's filters.
 * The results page checks them so too before it lists them, whoever kept the result. */
export function readSavedViewDetails(value: unknown): SavedViewDetail[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const views: SavedViewDetail[] = [];
  for (const entry of Array.from(value as unknown[])) {
    const view = entry as Partial<SavedViewDetail> | null;
    if (!view || typeof view !== "object" || typeof view.name !== "string" || typeof view.module !== "string" || typeof view.read !== "boolean" || !Array.isArray(view.filters)) return undefined;
    const filters: AxisFilter[] = [];
    for (const item of Array.from(view.filters as unknown[])) {
      const filter = readAxisFilter(item);
      if (!filter) return undefined;
      filters.push(filter);
    }
    views.push({ name: view.name, module: view.module, read: view.read, filters });
  }
  return views;
}

/** The conditions of a model's saved views' filters, for the Model map (result-types.ts `savedViewFilters`), every field
 * checked, or nothing when anything else is there. A result is not refused for them. */
export function readSavedViewFilters(value: unknown): SavedViewFilter[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const filters: SavedViewFilter[] = [];
  for (const entry of Array.from(value as unknown[])) {
    const filter = entry as Partial<SavedViewFilter> | null;
    if (!filter || typeof filter !== "object" || typeof filter.view !== "string" || typeof filter.module !== "string" || typeof filter.axis !== "string" || !AXES.has(filter.axis)
        || typeof filter.lineItem !== "string" || typeof filter.lineItemModule !== "string" || typeof filter.active !== "boolean" || typeof filter.valid !== "boolean") return undefined;
    filters.push({ view: filter.view, module: filter.module, axis: filter.axis, lineItem: filter.lineItem, lineItemModule: filter.lineItemModule, active: filter.active, valid: filter.valid });
  }
  return filters;
}

/** The IDs of a model's saved views (result-types.ts `savedViewIds`): texts of digits, or nothing when anything else is
 * there. A result is not refused for them: the pages that show a view are only not found. */
function readViewIds(value: unknown): string[] | undefined {
  const ids = texts(value);
  return ids?.every(id => /^\d{1,19}$/.test(id)) ? ids : undefined;
}

/** Lists are read entry by entry (Array.from), so a hole counts as an entry that is not there: `every` would pass over it.
 * Only the fields read here are kept: the names of the items its imports map manually that a result of 0.38.0 holds
 * (`importItemNames`) are left out, whatever they are. */
function readResult(value: unknown): AnalysisResult | undefined {
  const data = value as Partial<AnalysisResult> | null;
  if (!data || typeof data !== "object" || (data.kind !== "app" && data.kind !== "model") || typeof data.name !== "string" || typeof data.id !== "string"
      || !fileName(data.zipName, ".zip") || !Array.isArray(data.tables) || !Array.isArray(data.summary)) return undefined;
  const tables: ResultTable[] = [];
  for (const table of data.tables as (Partial<ResultTable> | null)[]) {
    if (!table || typeof table !== "object" || !fileName(table.file, ".csv") || typeof table.label !== "string" || typeof table.guard !== "boolean"
        || !Array.isArray(table.headers) || !Array.isArray(table.rows)) return undefined;
    // A row that is missing is no more a list than one that is text.
    const rows: unknown[] = Array.from(table.rows);
    if (!rows.every(row => Array.isArray(row))) return undefined;
    tables.push({ file: table.file, label: table.label, headers: Array.from(table.headers, textOf), rows: plainRows(rows as unknown[][]), guard: table.guard,
      ...(table.details === true ? { details: true as const } : {}) });
  }
  const moduleIds = data.kind === "model" ? readIds(data.moduleIds) : undefined;
  const listIds = data.kind === "model" ? readIds(data.listIds) : undefined;
  const importMappings = data.kind === "model" ? readImportMappings(data.importMappings) : undefined;
  const processActions = data.kind === "model" ? readProcessActions(data.processActions) : undefined;
  const site = data.kind === "model" ? readSite(data.site) : undefined;
  const lineItemIds = data.kind === "model" ? readLineItemIds(data.lineItemIds) : undefined;
  const pageUses = data.kind === "model" ? readPageUses(data.pageUses) : undefined;
  const lineItemColumns = data.kind === "model" ? readTexts(data.lineItemColumns) : undefined;
  // A count of rows the model refused: a whole number above nought, as the export gives one only where it refused some.
  const lineItemsRefused = data.kind === "model" && isCount(data.lineItemsRefused) && data.lineItemsRefused > 0 ? data.lineItemsRefused : undefined;
  const savedViewDetails = data.kind === "model" ? readSavedViewDetails(data.savedViewDetails) : undefined;
  const savedViewFilters = data.kind === "model" ? readSavedViewFilters(data.savedViewFilters) : undefined;
  const savedViewIds = data.kind === "model" ? readViewIds(data.savedViewIds) : undefined;
  return { kind: data.kind, name: data.name, id: data.id, zipName: data.zipName, tables, summary: Array.from(data.summary, textOf), ...(moduleIds ? { moduleIds } : {}), ...(listIds ? { listIds } : {}),
    ...(data.kind === "model" && data.engine === "polaris" ? { engine: "polaris" } : {}),
    ...(importMappings ? { importMappings } : {}), ...(processActions ? { processActions } : {}), ...(site ? { site } : {}), ...(lineItemIds ? { lineItemIds } : {}),
    ...(pageUses ? { pageUses } : {}), ...(lineItemColumns ? { lineItemColumns } : {}), ...(lineItemsRefused ? { lineItemsRefused } : {}),
    ...(savedViewDetails ? { savedViewDetails } : {}), ...(savedViewFilters ? { savedViewFilters } : {}), ...(savedViewIds ? { savedViewIds } : {}) };
}

/** A result received from another window, with every field checked before use and nothing else kept; undefined when it is
 * not a result. It never throws: whoever calls it is in the middle of a run and must not be left waiting, so a value that
 * cannot even be read is not a result either. */
export function plainResult(value: unknown): AnalysisResult | undefined {
  try { return readResult(value); } catch { return undefined; }
}
