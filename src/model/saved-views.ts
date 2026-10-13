import { definitionOf, idOf } from "../map/graph-names.js";
import { missingText } from "../page-files.js";
import type { Log, Stop } from "../progress.js";
import type { AxisFilter, ImportMapping, SavedViewDetail, SavedViewFilter, ViewAxis, ViewCondition } from "../result-types.js";
import { sourceObjectOf } from "../results/source-object.js";
import { filtersSummary, lineItemListed, READ_WORDS, SAVED_VIEW_HEADERS } from "../saved-view-filters.js";
import { message, seconds } from "../util.js";
import { plainText, type Grid, type GridRow, type Table } from "./grid.js";
import { readViewDefinition, Refusal, type Native } from "./native.js";

/** A model's saved views and the filters saved on them, as Model Building opens a view. The views are listed from the model
 * page's client, which holds them in its cache (ModelContentCache `getViewsLabelPage`, with each view's module in
 * `getViewsInfo`): no request lists them. Each view's definition is then read on its own, by its saved view's reference,
 * with no page of cells or labels asked for (native.ts `readViewDefinition`), one view after another: the model does not
 * take views opened at once from one session (seen live, 12 Oct 2026: of 160 views, 21 refused read four at a time, none
 * one at a time). Of a definition only its axes' filters are kept (`pageInfo`, each axis's `axisDefinition`'s
 * `sortAndFilterDefinition`), with the labels of each condition's line item, values and context items as the definition
 * gives them (`filterConditionInfos`), and each filtered axis's dimensions by the names the client's cache gives them
 * (`dimensionsOf`): nothing more is read for a name. A condition's line item is named by the Line
 * Items grid the export read, by its ID, and its module with it: the definition's own label is the name where that grid
 * has none of the ID, and one with neither is a missing line item, as a filter of a deleted line item is. The ID is kept
 * beside the name.
 *
 * The table, Saved Views, lists every view, with a filter or without, on or off, and each whose definition was not read, in
 * the cache's order, with the imports and the exports that read the view (`importsOf`, `exportsOf`). Which pages show it is
 * said once the pages built on the model are read (model-pages.ts), which then make the Saved View Filters table of the
 * filters of the views they show. `stop` is asked before each read; once it says the export was asked to stop, no further
 * view is read, and the views not read are said to be so, not left out. */

/** A saved view as the model page's client lists it: its ID, its name and its module's ID. */
export interface ListedView { id: number; name: string; moduleId: number }

/** What the client holds that is no list of views, said as why the table is not made. */
const NOT_LISTED = "the model page's client does not list its saved views";
const NOT_READABLE = "the model page's client lists its saved views in a form Cardigan does not read";

/** The model's saved views, as its client's cache lists them, in its order: IDs, names and modules side by side. It throws,
 * with why, where the client has no such list or holds it otherwise; an entry with no ID of a view is skipped. Nothing is
 * asked of the model for it. */
export function listSavedViews(native: Native): ListedView[] {
  const cache = native.cache;
  if (typeof cache?.getViewsLabelPage !== "function" || typeof cache.getViewsInfo !== "function") throw new Error(NOT_LISTED);
  let page: { count?: unknown; entityLongIds?: unknown[]; labels?: unknown[] } | undefined;
  let info: { moduleEntityLongIds?: unknown } | undefined;
  try {
    page = cache.getViewsLabelPage();
    info = cache.getViewsInfo();
  } catch (error) {
    throw new Error(`${NOT_LISTED} (${message(error)})`);
  }
  const ids: unknown = page?.entityLongIds?.[0];
  const labels: unknown = page?.labels?.[0];
  const modules: unknown = info?.moduleEntityLongIds;
  if (!Array.isArray(ids) || !Array.isArray(labels) || !Array.isArray(modules)) throw new Error(NOT_READABLE);
  const count = typeof page?.count === "number" && Number.isSafeInteger(page.count) && page.count >= 0 ? Math.min(page.count, ids.length) : ids.length;
  const views: ListedView[] = [];
  for (let at = 0; at < count; at++) {
    const id = Number(ids[at]);
    if (!Number.isSafeInteger(id) || id <= 0) continue;
    views.push({ id, name: plainText(labels[at]), moduleId: Number(modules[at]) });
  }
  return views;
}

/** What the export read before the saved views, which names what their filters use and what uses them: the Line Items grid,
 * the modules' names and IDs, this model's name, the Imports tab with each import's mapping and, by the import's ID, the
 * object of this model it reads (import-mappings.ts `sourceObjectsOf`), and the Actions list's exports with its columns. */
export interface SavedViewNames {
  lineItems?: Grid;
  moduleIds: readonly (readonly [name: string, id: string])[];
  model: string;
  imports?: Grid;
  mappings?: readonly ImportMapping[];
  sourceObjects?: ReadonlyMap<number, number>;
  exports?: { columns: Grid["columns"]; rows: readonly GridRow[] };
}

/** What the saved views give the result: the Saved Views table, a detail for each of its rows, each condition for the Model
 * map, each row's view's ID for the pages built on the model (content.ts takes them off the result), and the notes on views
 * not read. */
export interface SavedViewsRead { table: Table; details: SavedViewDetail[]; filters: SavedViewFilter[]; ids: string[]; notes: string[] }

/** What became of one view: its filters, or why its definition was not read. */
type Outcome = { read: true; filters: AxisFilter[] } | { read: false };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

/** A label page's first entry's labels, as plain text. */
const labelsOf = (page: Any): string[] => (Array.isArray(page?.labels?.[0]) ? Array.from(page.labels[0] as unknown[], plainText) : []);
/** An ID of an entity's identifier ("_2000000123_"), as a number; nothing for anything else. */
const entityOf = (identifier: unknown): number | undefined => {
  const id = idOf(identifier);
  return id === undefined || !Number.isSafeInteger(Number(id)) ? undefined : Number(id);
};
/** An entity said by its ID where no label names it, as the export says a target the model gave no name for. */
const asId = (identifier: unknown): string => `ID ${idOf(identifier) ?? String(identifier)}`;

/** The operators that compare with no value (OpInfo.js `_filterArity`: unary). */
const NO_VALUE: ReadonlySet<string> = new Set(["IS_BLANK", "IS_NOT_BLANK"]);
/** The data types whose values are a list's items or periods, which a condition's info gives labels for. */
const ITEMS: ReadonlySet<string> = new Set(["ENTITY", "TIME_ENTITY"]);

/** An axis's dimensions, each by the name the model's client gives it, in the axis's order (ModelContentHelper
 * `getAllDimensionIdentifiersForAxisSpecification` and `getLabelForDimensionIdentifier`, which read its cache, so nothing
 * is asked of the model for them): the rows', the columns' or a page's. Nothing where the client cannot say, or names none. */
function dimensionsOf(native: Native, specification: Any): string[] | undefined {
  try {
    const identifiers: unknown = native.helper.getAllDimensionIdentifiersForAxisSpecification?.(specification);
    if (!Array.isArray(identifiers)) return undefined;
    const names = identifiers.map(identifier => plainText(native.helper.getLabelForDimensionIdentifier?.(native.cache, identifier))).filter(name => name.trim() !== "");
    return names.length ? names : undefined;
  } catch {
    return undefined;
  }
}

/** One condition, in the result's words, with its line item named by its ID (`lineItemOf`), which is kept too. Its values are
 * the definition's own: a Boolean as True or False, a list's items and periods by the labels the condition's info gives
 * them, by their IDs where it gives none, and any other value as the definition holds it. */
function conditionOf(condition: Any, info: Any, lineItemOf: (id: number) => { name: string; module: string } | undefined): ViewCondition {
  const id = entityOf(condition?.lineItemIdentifier);
  const named = id === undefined ? undefined : lineItemOf(id);
  const label = labelsOf(info?.lineItemLabelPage)[0]?.trim() ?? "";
  // A condition on the view's module itself, with no line item, is the dialog's "-- Current Module --".
  const lineItem = named?.name ?? (label !== "" ? label : id !== undefined ? missingText("line item", String(id)) : condition?.moduleIdentifier ? "Current Module" : "No line item");
  const operator = typeof condition?.comparisonOperator === "string" ? condition.comparisonOperator : "";
  const dataType = typeof condition?.comparisonDataType === "string" ? condition.comparisonDataType : "";
  const given: unknown[] = condition?.comparisonValue !== undefined && condition?.comparisonValue !== null ? [condition.comparisonValue]
    : Array.isArray(condition?.comparisonMultiValueOR) ? condition.comparisonMultiValueOR : [];
  const labels = labelsOf(info?.comparisonValuesLabelPage);
  const values = NO_VALUE.has(operator) ? [] : given.map((value, at) => {
    if (dataType === "BOOLEAN") return /^true$/i.test(String(value).trim()) ? "True" : /^false$/i.test(String(value).trim()) ? "False" : plainText(value);
    if (labels[at] !== undefined && labels[at].trim() !== "") return labels[at];
    return ITEMS.has(dataType) ? asId(value) : plainText(value);
  });
  const contextLabels = labelsOf(info?.contextLabelPage);
  const contexts = (Array.isArray(condition?.contextIdentifiers) ? condition.contextIdentifiers as unknown[] : [])
    .map((identifier, at) => (contextLabels[at] !== undefined && contextLabels[at].trim() !== "" ? contextLabels[at] : asId(identifier)));
  // The client takes a condition whose info does not say it is not valid for a valid one (Condition.js `isValid`).
  return { lineItem, ...(named ? { lineItemModule: named.module } : {}), ...(id !== undefined ? { lineItemId: String(id) } : {}), operator, dataType, values, contexts,
    valid: info?.isValid !== false };
}

/** The filters of a view's definition: Rows, Columns, then each page axis, each that has a condition, whether it is on or
 * not, with its conditions in their order, and the axis's dimensions by the client's names for them (`dimensionsOf`): one
 * by one for every axis, and for a page axis said as the filter dialog says it too, several joined with a slash. */
function filtersOf(native: Native, pageInfo: Any, lineItemOf: (id: number) => { name: string; module: string } | undefined): AxisFilter[] {
  const pages: unknown[] = Array.isArray(pageInfo?.pageAxisSpecifications) ? pageInfo.pageAxisSpecifications : [];
  const axes: [ViewAxis, Any][] = [["Rows", pageInfo?.rowAxisSpecification], ["Columns", pageInfo?.columnAxisSpecification], ...pages.map((page): [ViewAxis, Any] => ["Pages", page])];
  return axes.flatMap(([axis, specification]): AxisFilter[] => {
    const definition = specification?.axisDefinition?.sortAndFilterDefinition;
    const conditions: unknown[] = Array.isArray(definition?.filterConditions) ? definition.filterConditions : [];
    if (!conditions.length) return [];
    const infos: unknown[] = Array.isArray(definition.filterConditionInfos) ? definition.filterConditionInfos : [];
    const dimensions = dimensionsOf(native, specification);
    const dimension = axis === "Pages" && dimensions ? dimensions.join(" / ") : undefined;
    // The client's icon for a filter takes one that does not say it is active for one that is off (MainView.js `_getIconClass`).
    return [{ axis, ...(dimension ? { dimension } : {}), ...(dimensions ? { dimensions } : {}), active: definition.isActive === true,
      match: definition.filterMatchType === "ANY" ? "any" : "all", conditions: conditions.map((condition, at) => conditionOf(condition, infos[at], lineItemOf)) }];
  });
}

/** The views' places in `views`, by their modules' names and their own, each without the spaces around it: a view is one of
 * a module's, whose names Anaplan keeps apart. */
function viewsByName(views: readonly ListedView[], modules: readonly string[]): (module: string, view: string) => number | undefined {
  const key = (module: string, view: string): string => JSON.stringify([module.trim(), view.trim()]);
  const places = new Map<string, number[]>();
  views.forEach((view, at) => places.set(key(modules[at], view.name), [...places.get(key(modules[at], view.name)) ?? [], at]));
  return (module, view) => {
    const found = places.get(key(module, view));
    return found?.length === 1 ? found[0] : undefined;
  };
}

/** The imports of this model that read each of the views, by the views' places in `views`: by the object its data source
 * names, where the export read that source, or else by its Source Object, a module and a saved view of this model, for an
 * import whose Source Type says it reads a saved view. In the Imports tab's order, each name once. */
function importsOf(views: readonly ListedView[], modules: readonly string[], names: SavedViewNames): string[][] {
  const used = views.map(() => [] as string[]);
  const tab = names.imports;
  if (!tab) return used;
  const column = (label: string): number => tab.columns.findIndex(entry => (entry.labels[0] ?? "").trim() === label);
  const [type, object] = [column("Source Type"), column("Source Object")];
  const byId = new Map(views.map((view, at) => [view.id, at]));
  const byName = viewsByName(views, modules);
  tab.rows.forEach((row, place) => {
    const name = row.labels[0] ?? "";
    let at = byId.get(names.sourceObjects?.get(row.ids[0]) ?? NaN);
    if (at === undefined && type >= 0 && object >= 0 && /view/i.test(row.cells[type] ?? "")) {
      const read = sourceObjectOf(row.cells[object] ?? "");
      const mapping = names.mappings?.[place];
      const here = mapping?.id === String(row.ids[0]) && mapping.sourceInThisModel !== undefined ? mapping.sourceInThisModel
        : read?.model === undefined || read.model.trim() === names.model.trim();
      if (read?.view !== undefined && here) at = byName(read.module, read.view);
    }
    if (at !== undefined && name !== "" && !used[at].includes(name)) used[at].push(name);
  });
  return used;
}

/** An Action cell of an export that says its source in words, as Anaplan's Actions list writes it (model/unused.ts). */
const EXPORT_WORDS = /^Export from (\S[^\n]*)$/;

/** The exports from each of the views, by the views' places in `views`: by the source its definition names by ID, where its
 * Action cell holds the definition, or by the module and the saved view its words name ("Export from 'Prices'.'Monthly'"),
 * of this model. In the Actions list's order, each name once. */
function exportsOf(views: readonly ListedView[], modules: readonly string[], names: SavedViewNames): string[][] {
  const used = views.map(() => [] as string[]);
  const exports = names.exports;
  const action = exports ? exports.columns.findIndex(entry => (entry.labels[0] ?? "").trim() === "Action") : -1;
  if (!exports || action < 0) return used;
  const byId = new Map(views.map((view, at) => [String(view.id), at]));
  const byName = viewsByName(views, modules);
  for (const row of exports.rows) {
    const name = row.labels[0] ?? "";
    const cell = (row.cells[action] ?? "").trim();
    const definition = definitionOf(cell);
    let at: number | undefined;
    if (definition) at = byId.get(idOf(definition.sourceEntityLongId) ?? "");
    else {
      const words = EXPORT_WORDS.exec(cell);
      const read = words ? sourceObjectOf(words[1]) : undefined;
      if (read?.view !== undefined && (read.model === undefined || read.model.trim() === names.model.trim())) at = byName(read.module, read.view);
    }
    if (at !== undefined && name !== "" && !used[at].includes(name)) used[at].push(name);
  }
  return used;
}

/** Each view's definition, one view after another, in the client's order, and the Saved Views table made from them, a row
 * for every view (`SavedViewsRead`). The log has a line for each view the model refused, by its ID, with the model's words
 * on why, a line for any answer that held data or label pages all the same, and one line on them all: how many views there
 * are, how many were read, how many of those have a filter, how many were refused, and how long it took. A stop leaves the
 * views after it unread: they are listed, and a note says how many. */
export async function readSavedViews(native: Native, views: readonly ListedView[], names: SavedViewNames, log: Log, stop?: Stop): Promise<SavedViewsRead> {
  const started = Date.now();
  const moduleNames = new Map(names.moduleIds.map(([name, id]) => [id, name]));
  const modules = views.map(view => moduleNames.get(String(view.moduleId)) ?? `ID ${view.moduleId}`);
  const lineItems = new Map<number, { name: string; module: string }>();
  for (const row of names.lineItems?.rows ?? []) {
    const [id, moduleId] = row.ids;
    if (row.ids.length < 2 || !Number.isSafeInteger(id) || id <= 0) continue;
    const module = row.labels[1] || moduleNames.get(String(moduleId));
    if (module && row.labels[0]) lineItems.set(id, { name: row.labels[0], module });
  }
  const lineItemOf = (id: number) => lineItems.get(id);

  const outcomes: Outcome[] = [];
  let refused = 0;
  for (const view of views) {
    // A stop ends the reads, not the table: the views after it are listed as not read.
    try {
      stop?.throwIfAborted();
    } catch {
      break;
    }
    try {
      const definition = await readViewDefinition(native, view.id);
      if (definition.ignored) log(`Saved view ${view.id}: the answer held ${definition.ignored} data or label pages, which were left unread`);
      outcomes.push({ read: true, filters: filtersOf(native, definition.pageInfo, lineItemOf) });
    } catch (error) {
      refused++;
      log(`Saved view ${view.id}: refused (${error instanceof Refusal ? error.said : message(error)})`);
      outcomes.push({ read: false });
    }
  }
  const stopped = views.length - outcomes.length;
  const read = outcomes.filter(outcome => outcome.read).length;
  const filtered = outcomes.filter(outcome => outcome.read && outcome.filters.length).length;
  log(`Saved views: ${views.length}; filters read for ${read}, ${filtered} with a filter; ${refused} refused`
    + `${stopped ? `; ${stopped} not read: the export was stopped` : ""}; in ${seconds(Date.now() - started)}`);

  const imports = importsOf(views, modules, names);
  const exports = exportsOf(views, modules, names);
  const result: SavedViewsRead = { table: { headers: [...SAVED_VIEW_HEADERS], rows: [] }, details: [], filters: [], ids: [], notes: [] };
  views.forEach((view, at) => {
    const outcome = outcomes[at] ?? { read: false };
    const filters = outcome.read ? outcome.filters : [];
    const module = modules[at];
    const used = new Map<string, string>();
    for (const condition of filters.flatMap(filter => filter.conditions)) {
      const listed = lineItemListed(condition.lineItem, condition.lineItemModule);
      used.set(listed, listed);
    }
    result.table.rows.push([view.name, module, filtersSummary(filters), [...used.values()].join(", "), "", imports[at].join(", "), exports[at].join(", "),
      outcome.read ? READ_WORDS.yes : READ_WORDS.no]);
    result.details.push({ name: view.name, module, read: outcome.read, filters });
    result.ids.push(String(view.id));
    for (const filter of filters) {
      for (const condition of filter.conditions) {
        if (condition.lineItemModule === undefined) continue;
        result.filters.push({ view: view.name, module, axis: filter.axis, lineItem: condition.lineItem, lineItemModule: condition.lineItemModule, active: filter.active, valid: condition.valid });
      }
    }
  });
  const of = (count: number): string => `${count} of the ${views.length} saved views`;
  if (refused) result.notes.push(`${of(refused)} could not be read, so their filters are not known: Definition read says No in their rows, and the diagnostic log says why.`);
  if (stopped) result.notes.push(`${of(stopped)} were not read: the export was stopped before them. Definition read says No in their rows.`);
  return result;
}
