import { describePageCards } from "./card-reader/card-details.js";
import { nameCardDetails } from "./card-reader/card-naming.js";
import type { UxEntityRef, UxPageCardDetails } from "./card-reader/card-types.js";
import type { UxPageType } from "./card-reader/definition-types.js";
import {
  addActions, addExportedLineItems, addLineItems, addLists, addMetadataDimensionNames, addModuleDimensions, addModuleViews, addSelections, applicableModuleIds,
  describeFormat, describeSystemContext, emptyCatalog, entityType, filterItemNeeds, filterLineItemSearch, forgetExportedLineItems, listedLineItems, moduleViewsShape,
  nameFilterValues, resolveFromCatalog, selectionShape, unnamedDimensionIds, unnamedFilterRules, unresolvedFilterItems, viewLayoutFromMetadata, type ExportedLineItems,
  type ModelCatalog,
} from "./catalog.js";
import { DETAILS_HEADERS, diagnosticRows, exportRows, type DetailRow } from "./details.js";
import { Failure, REFRESH, SEND_LOG, type Log, type Progress } from "./progress.js";
import { buildReport, HEADERS, LINE_ITEMS, NONE, PAGE_TYPE, type PageInput, type TabName } from "./report.js";
import { plainRows } from "./result-plain.js";
import type { AnalysisResult, ResultTable } from "./result-types.js";
import { getJson, RestError } from "./rest.js";
import { StompConnection, StompError, type SubscribeOptions } from "./stomp.js";
import { ANAPLAN_HOST, AT_A_TIME, eachAtMost, fileSafe, list, message, SCOPE_ID, seconds, stepTimes, text, type Obj } from "./util.js";

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ENTITY_ID = /^[1-9]\d{0,17}$/;
const DEFINITION = "/a/springboard-definition-service/";
const PAGE_TYPES: UxPageType[] = ["BOARD", "GRID-PAGE", "REPORT"];
const ROUTE: Record<UxPageType, string> = { BOARD: "boards", "GRID-PAGE": "grid-pages", REPORT: "reports" };
/** As long as the search for filter line items that no card otherwise references may take in one model, its questions and
 * reads together, from the first: the names are a help to the reader, and nobody should wait minutes for them. */
const FILTER_LINE_ITEMS_BUDGET_MS = 45_000;
/** As long as one read of that search holds its place among those that are moving: after that another may start, and the
 * read goes on waiting for its answer. A module that does not answer holds nothing up for longer. */
const FILTER_LINE_ITEMS_READ_MS = 10_000;
/** As many places as that search has for the reads it keeps moving at a time. (After a late answer the modules it names
 * have them to themselves, beside the reads of other modules that were asked for before it: twice as many at most.) */
const FILTER_LINE_ITEMS_AT_A_TIME = 4;
/** The step says how far that search is no more often than this: every status is also a line of the diagnostic log. */
const FILTER_LINE_ITEMS_STATUS_MS = 5_000;
/** A model that is not open loads on the first data request, which can take minutes. */
const LOAD_MS = 300_000;
const LINE_ITEMS_MS = 120_000;
/** Naming the items of filter rules is tried in several places in turn, so a read that goes unanswered is given up sooner. */
const FILTER_ITEM_READ_MS = 10_000;
/** As long as naming the items of filter rules may take in one model, all its reads together: the names are a help to the
 * reader, and nobody should wait minutes for them. It leaves room for two reads that go unanswered and a third. */
const FILTER_ITEMS_BUDGET_MS = 30_000;
/** As many reads as naming the items of filter rules may take in one model. */
const MAX_FILTER_ITEM_READS = 40;
/** As many of the IDs, or of the rules, that were left unnamed as the log lists. */
const MAX_LOGGED = 30;
/** As long as one read may wait that looks for the name of a dimension no other answer named: the model is loaded by then. */
const DIMENSION_NAME_READ_MS = 10_000;
/** As long as those reads may take in one model, all together: the names are a help to the reader, and nobody should wait
 * minutes for them. */
const DIMENSION_NAMES_BUDGET_MS = 30_000;
/** As many dimensions still unnamed as the model is asked which modules have them; of the modules it names, two per
 * dimension have their dimensions read. */
const MAX_DIMENSION_QUESTIONS = 10;

/** A page entry's type as it says it, by any of the names it may use: an app record's page entry, or an entry of Model
 * Building's list of the pages built on a model (model-pages.ts). */
export function declaredType(entry: Obj): UxPageType | undefined {
  const raw = String(entry.pageType ?? entry.type ?? "").toUpperCase();
  if (raw.includes("BOARD")) return "BOARD";
  if (raw.includes("GRID") || raw.includes("WORKSHEET")) return "GRID-PAGE";
  if (raw.includes("REPORT")) return "REPORT";
  return undefined;
}

/** The app record's page entries may not state a type, so every route is tried: a wrong route answers an error, which is
 * harmless for a read. A problem is reported only when no route returns the page. */
export async function readPublished(guid: string, declared: UxPageType | undefined, log: Log): Promise<{ type: UxPageType; native: Obj } | { state: string }> {
  const order = declared ? [declared, ...PAGE_TYPES.filter(type => type !== declared)] : PAGE_TYPES;
  let problem: string | undefined;
  for (const type of order) {
    try {
      const native = await getJson(`${DEFINITION}${ROUTE[type]}/${guid}`);
      if (native && typeof native === "object" && !Array.isArray(native)) return { type, native: native as Obj };
      problem ??= "unexpected page format";
    } catch (error) {
      if (error instanceof RestError && error.code === "SIGNED_OUT") throw error;
      const status = error instanceof RestError ? error.status : undefined;
      log(`page ${guid}: ${ROUTE[type]} answered ${message(error)}`);
      if (status === 404 || status === 400) continue;
      problem ??= status === 403 ? "no access" : message(error);
    }
  }
  return { state: problem ? `Not analysed: ${problem}` : "Not published" };
}

/** The host the model data service sent each model to, by its workspace and model, as this tab has seen it: a later run
 * starts its socket there, and asks the actions service there first (`readActionNames`), instead of being sent there again.
 * It lasts as long as the content script, in this tab only, and is kept nowhere. */
const modelHosts = new Map<string, string>();
const hostKey = (scope: ModelScope): string => `${scope.workspaceId}:${scope.modelId}`.toUpperCase();
/** Forgets where each model was found, as a tab that has just been opened has never seen it: a test starts so. */
export function forgetModelHosts(): void {
  modelHosts.clear();
}

/** `work` gets the host that finally served the model, after any redirect. The socket starts on the host the service sent
 * this model to in an earlier run in this tab, where there was one; else on the host of the frame the model is read in
 * (`frameHost`, the model's own data centre), where that is another Anaplan host than the page's; and on the page's own
 * otherwise. The service sends a socket on the page's host on to the model's: starting there spares that (seen live, 10 Oct
 * 2026, on a model's first run in a tab). A socket that cannot be opened on the frame's host is opened on the page's, as
 * before. A run that `signal` has stopped opens no socket, and one stopped while its socket connects closes it at once,
 * without waiting for the service to answer: nothing is subscribed to for a stopped run. */
async function withSocket<T>(scope: ModelScope, log: Log, signal: AbortSignal | undefined, work: (connection: StompConnection, host: string) => Promise<T>,
  frameHost?: () => string | undefined): Promise<T> {
  const key = hostKey(scope);
  const remembered = modelHosts.get(key);
  const framed = remembered === undefined ? frameHost?.() : undefined;
  const fromFrame = framed && ANAPLAN_HOST.test(framed) && framed.toLowerCase() !== location.host.toLowerCase() ? framed : undefined;
  let host = remembered ?? fromFrame ?? location.host;
  if (remembered !== undefined && remembered !== location.host) log(`asking ${host} first: the model data service sent this model there before`);
  else if (fromFrame) log(`asking ${host} first: the model's frame is there`);
  let [redirected, fellBack] = [false, false];
  for (;;) {
    signal?.throwIfAborted();
    const session = crypto.randomUUID();
    const url = `wss://${host}/a/springboard-widget-data-service/ws?tracePath=springboard-ui&clientVersion=page-analyzer&clientSessionId=${session}`;
    let connection: StompConnection | undefined;
    try {
      connection = await StompConnection.open(url, {
        "enabled-features": "", "accept-language": navigator.language || "en", "close-mode": "error-frame", "page-visible": "true",
        ...(scope.customerId ? { "anaplan-customer": scope.customerId } : {}),
      }, log, signal);
      signal?.throwIfAborted();
      return await work(connection, host);
    } catch (error) {
      if (!redirected && error instanceof StompError && error.code === "REDIRECTION_REQUIRED" && error.fqdn && ANAPLAN_HOST.test(error.fqdn)) {
        log(`redirected to ${error.fqdn}`);
        host = error.fqdn;
        modelHosts.set(key, host);
        redirected = true;
        continue;
      }
      // A socket the frame's host did not open: the page's host is asked, as it always was.
      if (!connection && !fellBack && !redirected && host === fromFrame && !signal?.aborted) {
        log(`the model data service on ${host} could not be reached (${message(error)}): asking ${location.host}`);
        host = location.host;
        fellBack = true;
        continue;
      }
      throw error;
    } finally {
      connection?.close();
    }
  }
}

export interface ModelScope { customerId: string; workspaceId: string; modelId: string; modelName: string }

/** A page's cards with the names a model's catalog gives them: each reference named, the values of filter rules named,
 * the context the system sets said in words, and the context selectors a grid's dimensions make. As an app's pages are
 * named (`analyseApp`), and the pages built on a model too (model-pages.ts). */
export function nameDetails(details: UxPageCardDetails, catalog: ModelCatalog): UxPageCardDetails {
  const named = nameFilterValues(nameCardDetails(details, resolveFromCatalog(details.references, catalog)), catalog);
  return addDerivedContextSelectors(describeSystemContext(named, catalog), catalog);
}

const entityId = (value: unknown): string | undefined => (typeof value === "string" && ENTITY_ID.test(value) ? value : undefined);

/** Modules of every grid or chart section, and the shown or hidden items to name, grouped by module and dimension. */
export function gridNeeds(pages: readonly UxPageCardDetails[]): { modules: Set<string>; items: { moduleId: string; dimensionId: string; itemIds: string[] }[] } {
  const modules = new Set<string>();
  const items = new Map<string, { moduleId: string; dimensionId: string; itemIds: Set<string> }>();
  for (const page of pages) for (const card of page.cards) for (const region of list((card as Obj).grid?.regions)) {
    const moduleId = entityId(region.module?.id);
    if (!moduleId) continue;
    modules.add(moduleId);
    for (const axis of ["rows", "columns"]) for (const entry of list(region[axis]?.dimensions)) {
      const dimensionId = entityId(entry.dimension?.id);
      if (!dimensionId || dimensionId === LINE_ITEMS) continue;
      for (const item of [...list(entry.shows), ...list(entry.hides)]) {
        const itemId = item.kind === "listItem" ? entityId(item.id) : undefined;
        if (!itemId) continue;
        const key = `${moduleId}|${dimensionId}`;
        const group = items.get(key) ?? { moduleId, dimensionId, itemIds: new Set<string>() };
        group.itemIds.add(itemId);
        items.set(key, group);
      }
    }
  }
  return { modules, items: [...items.values()].map(group => ({ ...group, itemIds: [...group.itemIds] })) };
}

/** Page Builder's Pivot data lists, for each section, every dimension of its module that is on neither axis as a context
 * selector, whether or not the page saved settings for it (observed live, 28 Sep 2026). Adds the ones the page did not save. */
export function addDerivedContextSelectors(details: UxPageCardDetails, catalog: ModelCatalog): UxPageCardDetails {
  for (const card of details.cards) for (const region of list((card as Obj).grid?.regions)) {
    const moduleId = entityId(region.module?.id);
    const dimensions = moduleId ? catalog.moduleDimensions.get(moduleId) : undefined;
    if (!dimensions) continue;
    const placed = new Set<string>(["rows", "columns"].flatMap(axis => list(region[axis]?.dimensions).map(entry => String(entry.dimension?.id))));
    region.pivot ??= { rows: [], columns: [], pages: [] };
    if (!Array.isArray(region.pivot.pages)) region.pivot.pages = [];
    for (const page of list(region.pivot.pages)) placed.add(String(page.dimension?.id));
    // Every module has a Line Items dimension, whether or not the dimension list names it.
    const all = dimensions.some(dimension => dimension.id === LINE_ITEMS) ? dimensions : [...dimensions, { id: LINE_ITEMS, name: "Line Items" }];
    for (const { id, name } of all) {
      if (!placed.has(id)) region.pivot.pages.push({ dimension: { kind: "dimension", id, name }, source: "module" });
    }
  }
  return details;
}

/** Import, export and process names. A model in another data centre is served from its own host: the page's host
 * answered the first live run with a redirect, which a same-origin read refuses (a network error, after a wait). So each
 * list is asked first of `modelHost`, the host the model data service settled on, when it connected, and only then, if
 * that fails, of the page's own. A run that `signal` has stopped reads no further list: the stop is rethrown. */
async function readActionNames(scope: ModelScope, refs: readonly UxEntityRef[], modelHost: string | undefined, catalog: ModelCatalog,
  progress: Progress, signal?: AbortSignal): Promise<{ notes: string[]; failedActionTypes: string[] }> {
  const { workspaceId: ws, modelId: model } = scope;
  const notes: string[] = [];
  const failedActionTypes: string[] = [];
  const actionTypes = new Set(refs.filter(ref => ref.kind === "action").map(ref => ref.actionType));
  for (const [type, key] of [["IMPORT", "imports"], ["EXPORT", "exports"], ["PROCESS", "processes"]] as const) {
    if (!actionTypes.has(type)) continue;
    const path = `/a/collaboration-actions-service/workspaces/${ws}/models/${model}/${key}`;
    const hosts = [...new Set([...(modelHost ? [modelHost] : []), location.host])];
    let problem: string | undefined;
    for (const host of hosts) {
      signal?.throwIfAborted();
      try {
        const before = catalog.actions.size;
        addActions(catalog, key, await getJson(path, { host }));
        progress.log(`${scope.modelName}: ${catalog.actions.size - before} ${key} named (from ${host})`);
        problem = undefined;
        break;
      } catch (error) {
        progress.log(`${scope.modelName}: ${key} from ${host} answered ${message(error)}`);
        problem ??= message(error);
      }
    }
    if (problem) {
      failedActionTypes.push(type);
      notes.push(`${scope.modelName}: could not read the model's ${key} (${problem}); their buttons show the card label.`);
    }
  }
  return { notes, failedActionTypes };
}

/** What loadCatalog's socket reads share. `subscribe` makes every read of every step: once the socket work has ended it
 * sends nothing, whichever step asks, and such a read waits for no answer. `settle` ends every step that waits on the
 * socket: a failed connection is rethrown. `halted` is true once the run was asked to stop: a step that logs a refused read
 * and goes on ends instead. `ended` is true once the socket work was ended for any reason, a model that is closed or gone
 * included. `signal` is the run's: a step that reads a list of things, a few at a time, starts no further read once it has
 * stopped the run. */
interface SocketReads {
  scope: ModelScope;
  signal: AbortSignal | undefined;
  connection: StompConnection;
  subscribe: StompConnection["subscribe"];
  settle: <T>(work: Promise<T>) => Promise<T>;
  halted: () => boolean;
  ended: () => boolean;
  catalog: ModelCatalog;
  /** The modules whose line items the listing gave (`readLineItems`), whichever step read them. */
  listed: Set<string>;
  notes: string[];
  progress: Progress;
  answers: NameAnswers;
}

/** The answers that name dimensions, as they came: for a dimension no answer named, the log says which of them hold its ID
 * at all (one that holds it unnamed would be read wrongly). */
interface NameAnswers { lists?: unknown; moduleViews?: unknown; moduleDimensions: unknown[] }

/** A module whose line items cannot be read is remembered, so the search for filter line items does not ask again. A read
 * that ended with the connection says nothing about its module: after a redirect it is read on the host the model lives on.
 * `givingUp` is the search's own: a read of the search writes no frame lines to the diagnostic log (the search makes
 * hundreds of them, and sums them up in lines of its own), and it is given up when the signal aborts. That is no refusal:
 * the module is not remembered, and nothing is logged. A read that is refused is logged either way. */
async function readLineItems(reads: SocketReads, moduleId: string, givingUp?: AbortSignal): Promise<void> {
  const { scope, connection, subscribe, catalog, listed, progress } = reads;
  const { workspaceId: ws, modelId: model } = scope;
  try {
    addLineItems(catalog, moduleId, await subscribe(`core://${ws}:${model}/modules/${moduleId}/lineItems`,
      { body: {}, timeoutMs: LINE_ITEMS_MS, ...(givingUp ? { quiet: true, signal: givingUp } : {}) }));
    listed.add(moduleId);
  } catch (error) {
    if (givingUp?.aborted) return;
    if (!connection.failed) catalog.unreadableModules.add(moduleId);
    progress.log(`line items of module ${moduleId}: ${message(error)}`);
  }
}

/** Whether the line items the export read (model-pages.ts) are those the listing gives. Of the modules the pages use, the
 * first that the export listed with line items is read from the listing all the same, and the two are compared line item
 * by line item, by ID and by name. Where they agree, the export's line items stand for the listing's for every other
 * module of theirs, and those modules are not read again. Where they differ, the export's are set aside, and every module
 * the pages use is read from the listing, as before: a mismatch costs time, never a name. A comparison that cannot be
 * made, because the listing refused the read, keeps the export's: their names are the model's own, from its Model
 * settings. Either way the module that was read keeps what the listing gave. A failed connection and a stopped run are
 * rethrown, as a read of any step rethrows them. Returns what the log says of it. */
async function compareExported(reads: SocketReads, used: ReadonlySet<string>, exported: ExportedLineItems): Promise<string> {
  const { scope, connection, subscribe, settle, halted, catalog, listed } = reads;
  const { workspaceId: ws, modelId: model } = scope;
  const ofModule = new Map<string, Map<string, string>>();
  for (const { id, name, moduleId } of exported.lineItems) {
    const items = ofModule.get(moduleId) ?? new Map<string, string>();
    items.set(id, name);
    ofModule.set(moduleId, items);
  }
  const moduleId = [...used].find(id => ofModule.has(id));
  if (moduleId === undefined) return "no page uses a module that the export listed with line items: nothing to compare";
  let json: unknown;
  try {
    json = await settle(subscribe(`core://${ws}:${model}/modules/${moduleId}/lineItems`, { body: {}, timeoutMs: LINE_ITEMS_MS }));
  } catch (error) {
    if (connection.failed || halted()) throw error;
    return `the listing of module ${moduleId} could not be read to compare (${message(error)}): the export's line items are used`;
  }
  const given = listedLineItems(json);
  const known = ofModule.get(moduleId)!;
  const alike = given.filter(item => known.get(item.id) === item.name).length;
  const agree = given.length > 0 && alike === given.length;
  if (!agree) forgetExportedLineItems(catalog, exported, listed);
  addLineItems(catalog, moduleId, json);
  listed.add(moduleId);
  return agree ? `the export and the listing agree on module ${moduleId}: ${alike} of ${given.length} line items alike, by ID and name`
    : `the export and the listing differ on module ${moduleId}: ${alike} of ${given.length} line items alike, by ID and name; the export's line items `
      + "are set aside, and every module the pages use is read from the listing";
}

/** Context selectors: each section's module dimensions, the list Page Builder's grid section settings read. */
async function readModuleDimensions(reads: SocketReads, modules: ReadonlySet<string>): Promise<void> {
  const { scope, connection, subscribe, settle, halted, catalog, notes, progress, answers } = reads;
  const { workspaceId: ws, modelId: model } = scope;
  if (modules.size) {
    progress.status(`Reading module dimensions in ${scope.modelName}…`);
    try {
      const json = await settle(subscribe(`core://${ws}:${model}/dimensions`, { body: { moduleIds: [...modules] }, timeoutMs: LOAD_MS }));
      answers.moduleDimensions.push(json);
      const read = addModuleDimensions(catalog, json);
      progress.log(`dimensions of ${read.length} of ${modules.size} modules`);
    } catch (error) {
      if (connection.failed || halted()) throw error;
      progress.log(`module dimensions: ${message(error)}`);
      notes.push(`${scope.modelName}: module dimensions were not available (${message(error)}); context selectors show only those saved on the page.`);
    }
  }
}

/** Names of shown and hidden items, as Page Builder's show/hide chips read them. */
async function readItemNames(reads: SocketReads, items: readonly { moduleId: string; dimensionId: string; itemIds: string[] }[]): Promise<void> {
  const { scope, subscribe, settle, catalog, progress } = reads;
  const { workspaceId: ws, modelId: model } = scope;
  if (items.length) {
    progress.status(`Reading item names in ${scope.modelName}…`);
    await settle(eachAtMost(items, AT_A_TIME, reads.signal, async ({ moduleId, dimensionId, itemIds }) => {
      try {
        const named = addSelections(catalog, await subscribe(`core://${ws}:${model}/modules/${moduleId}/dimensions/${dimensionId}`,
          { accept: "widget/selection", body: { itemIds, filter: "" }, timeoutMs: LINE_ITEMS_MS }), { moduleId, dimensionId });
        progress.log(`items of dimension ${dimensionId} in module ${moduleId}: ${named} of ${itemIds.length} named`);
      } catch (error) {
        progress.log(`items of dimension ${dimensionId} in module ${moduleId}: ${message(error)}`);
      }
    }));
  }
}

/** How many of the saved views the cards use are read before the others: where the service refuses every one of them and
 * answers none, the others are not asked. A model's 233 saved views were refused one and all, live, in 5.3 s (10 Oct
 * 2026). A view that answers shows that the others may, and they are read. */
export const VIEW_TRIAL = 6;

/** What Page Builder sends to subscribe to a grid card's saved view (designer.js: the options `iae` makes, with the client
 * query options `nbt` adds): the view, by its ID, as an Anaplan grid's data source in this model, with no customisation and
 * no transform, so that the grid comes as the view saves it, its rows, columns and pages in its first metadata message.
 * Cardigan sent only the transforms and the client query options before, and the service refused every view (seen live,
 * 10 Oct 2026). */
export function viewOptions(workspaceId: string, modelId: string, viewId: string): Record<string, unknown> {
  return { dataSourceType: "ANAPLAN_GRID", dataSourceId: viewId, modelId, workspaceId,
    clientQueryOptions: { useCellIdTemplate: false, canHandleDedupedAuxData: false, canHandleNullColumnWidths: false }, transforms: [] };
}

/** Saved views: rows, columns and context selectors from the metadata Page Builder's grid receives (the message types and
 * top-level keys are logged, so a live run shows what the service sends). The first VIEW_TRIAL are read first; where the
 * service refuses each of them and answers none, the others are not asked, and the log and the note say so. A read that
 * was not answered in its time, or was given up, is no refusal. */
async function readViewLayouts(reads: SocketReads, refs: readonly UxEntityRef[]): Promise<void> {
  const { scope, subscribe, settle, catalog, notes, progress } = reads;
  const { workspaceId: ws, modelId: model } = scope;
  const viewIds = [...new Set(refs.filter(ref => ref.kind === "view").map(ref => entityId(ref.id)).filter((id): id is string => !!id))];
  if (!viewIds.length) return;
  progress.status(`Reading saved view layouts in ${scope.modelName}…`);
  let [answered, refused] = [0, 0];
  let why: string | undefined;
  const read = async (viewId: string): Promise<void> => {
    try {
      const metadata = await subscribe(`core://${ws}:${model}/views/${viewId}`, {
        accept: "widget/grid", messageType: "metadata", timeoutMs: 60_000, body: viewOptions(ws, model, viewId),
        onMessage: (type, keys) => progress.log(`view ${viewId}: ${type} {${keys.join(", ")}}`),
      });
      answered++;
      const layout = viewLayoutFromMetadata(metadata);
      addMetadataDimensionNames(catalog, metadata);
      if (layout) catalog.viewLayouts.set(viewId, layout);
      else progress.log(`view ${viewId}: metadata without rows, columns or pages`);
    } catch (error) {
      if (!(error instanceof StompError && (error.code === "TIMEOUT" || error.code === "GIVEN_UP"))) {
        refused++;
        why ??= message(error);
      }
      progress.log(`view ${viewId}: ${message(error)}`);
    }
  };
  const [trial, others] = [viewIds.slice(0, VIEW_TRIAL), viewIds.slice(VIEW_TRIAL)];
  await settle(eachAtMost(trial, AT_A_TIME, reads.signal, read));
  const skipped = others.length > 0 && answered === 0 && refused === trial.length;
  if (skipped) progress.log(`saved view layouts: the first ${trial.length} were refused (${why}), so the other ${others.length} were not asked`);
  else await settle(eachAtMost(others, AT_A_TIME, reads.signal, read));
  if (catalog.viewLayouts.size < viewIds.length) {
    notes.push(`${scope.modelName}: ${viewIds.length - catalog.viewLayouts.size} of ${viewIds.length} saved views' rows, columns and context selectors could not be read`
      + (skipped ? `: the service refused the first ${trial.length}, so the others were not asked.` : "."));
  }
}

/** Filters can use a line item from a module no card shows. It is looked for in the modules whose line items were not read
 * yet, until every such rule has its line item:
 * - first in those that have a dimension of the filtered axis, which the model names (the candidates), dimension by
 *   dimension, in the model's order: as they were read before the other modules were searched at all;
 * - then in every other module of the model's list, in the list's order.
 * Where the modules read so far bear it out, the entity types of the IDs put the likelier of those other modules first:
 * never before a candidate, so that no candidate is read later for it, however wrong it is. A rule that a module already
 * read rules out is spared the other modules: its IDs are looked for in the candidates only (catalog.ts
 * `filterLineItemSearch`). No module is asked twice, and one whose read is refused is remembered as one that cannot be read.
 *
 * Four reads are kept moving (FILTER_LINE_ITEMS_AT_A_TIME). A read holds one of the four places until it is answered, and
 * for FILTER_LINE_ITEMS_READ_MS at most: after that another read may start in its place, and it goes on waiting. Its
 * answer counts whenever it comes, and with every answer the search looks whether it is done. A late answer is likelier
 * than none (a busy model answers late), so no answer is thrown away for being late. The questions which modules have a
 * filtered dimension are asked together and waited for in the same way: the reading starts once they are answered, or
 * after FILTER_LINE_ITEMS_READ_MS with the candidates known by then, and a later answer puts its modules before the other
 * modules still to be read. Nor do they wait for a place held by a read that was asked for as another module's: the
 * candidates have the four places to themselves, so that each is asked for as soon as it was when the questions were
 * waited for, one after another, and the candidates read four at a time.
 *
 * The whole search has FILTER_LINE_ITEMS_BUDGET_MS in one model, from its first question (after a redirect it starts over,
 * on the host the model lives on). It ends when every rule has its line item, when nothing is left to start and nothing
 * is waiting, or when that time is up. A question counts as waiting only while its answer can name a module that is
 * left: once the reading has begun without it, it is not waited for when the model's list of modules arrived and every
 * module of that list was read or refused. (Without the list it is waited for as long as the time lasts; and so it is
 * once an answer of this search has named a module that the list does not hold, which shows that the list is not all a
 * question can name.) Nor is a read waited for that can add no line item: one of another module, when every ID that is
 * still looked for is looked for in the candidates only. What is still waiting when the search ends is given up: its
 * subscription is ended, it changes nothing afterwards, it is not remembered as unreadable (it was not refused) and
 * nothing is logged for it. A run that is stopped, a model that reports itself closed and a connection that fails end the
 * search at once, and nothing is asked after them. A rule whose line item was not found keeps its IDs.
 *
 * The diagnostic log is kept small: the reads of line items write no frame lines, and the step says how far the search is
 * no more often than FILTER_LINE_ITEMS_STATUS_MS. The search's own lines say how far it went, in IDs and counts only, and
 * a note says so when it ended with a rule still without its line item and something left undone. */
async function findFilterLineItems(reads: SocketReads, pages: readonly UxPageCardDetails[]): Promise<void> {
  const { scope, connection, subscribe, settle, ended, catalog, notes, progress } = reads;
  const { workspaceId: ws, modelId: model } = scope;
  const cards = pages.flatMap(page => page.cards);
  const { itemIds, axisDimensionIds } = unresolvedFilterItems(cards, catalog);
  if (!itemIds.size) return;
  // A model that closed earlier, while its module dimensions were read, is only logged there. The search does not begin
  // for it: it shows no step and counts nothing, and what ended the work is thrown, as a read that waits throws it
  // (nothing would be sent in any case: `subscribe`). After this, every wait of the search is one that the end of the
  // work ends at once (`settle`), before an answer that came in the same breath is acted on.
  if (ended()) await settle(new Promise<never>(() => undefined));
  const started = Date.now();
  /** What is left of the time for the search. */
  const left = () => started + FILTER_LINE_ITEMS_BUDGET_MS - Date.now();
  const unread = (id: string) => ENTITY_ID.test(id) && !catalog.lineItemModules.has(id) && !catalog.unreadableModules.has(id);
  /** The modules there are to read: the candidates, as the model names them for each filtered dimension, in the order of
   * the dimensions whichever question is answered first (they were asked one after another before); and the other modules
   * of its list that were not read when the search began. */
  const named = new Map<string, string[]>();
  let candidates = new Set<string>();
  const listed = [...catalog.modules.keys()].filter(unread);
  const others = () => listed.filter(id => !candidates.has(id));
  /** The modules that the answers of this search named, and those of them that the model's list does not hold (the list
   * as it was when the search began: an answer adds the modules it names to the catalog's). One such module shows that
   * the list is not all that a question can name. */
  const inList = new Set(catalog.modules.keys());
  const [allNamed, beyond] = [new Set<string>(), new Set<string>()];
  /** Whether the model's list of modules arrived and every module of it was read or refused: a question that is still
   * unanswered then can name no module that is left, as far as this search has seen. (One whose read still waits is left.) */
  const whole = () => catalog.moduleListLoaded && !beyond.size && !listed.some(unread);
  /** Gives up, when the search ends, whatever of it is still waiting. */
  const givingUp = new AbortController();
  /** The questions that the model has not answered yet. */
  const questions = new Set<Promise<void>>();
  /** The modules whose line items were asked for and are not answered yet, each with when it was asked, and whether as a
   * candidate. */
  const waiting = new Map<string, { since: number; named: boolean; answered: Promise<void> }>();
  const asked = new Set<string>();
  const plan = (places: number) => filterLineItemSearch(unresolvedFilterItems(cards, catalog).rules, [...candidates].filter(id => !asked.has(id) && unread(id)),
    others().filter(id => !asked.has(id) && unread(id)), catalog, places);
  let [bracketed, givenUp, unsaid, spared, said] = [0, 0, 0, 0, started];
  let step = plan(0);
  progress.status(`Finding filter line items in ${scope.modelName}…`);
  try {
    for (const dimensionId of axisDimensionIds) {
      if (!ENTITY_ID.test(dimensionId)) continue;
      named.set(dimensionId, []);
      const question: Promise<void> = subscribe(`core://${ws}:${model}/applicableModules`, { body: { dimensions: [Number(dimensionId)] }, signal: givingUp.signal })
        .then(json => {
          const modules = applicableModuleIds(catalog, json).filter(id => ENTITY_ID.test(id));
          for (const id of modules) {
            allNamed.add(id);
            if (!inList.has(id)) beyond.add(id);
          }
          named.set(dimensionId, modules.filter(unread));
          candidates = new Set([...named.values()].flat());
        },
          // A question that was given up, or that ended with the connection, is not one the model refused.
          error => { if (!givingUp.signal.aborted && !connection.failed) progress.log(`modules for dimension ${dimensionId}: ${message(error)}`); })
        .finally(() => { questions.delete(question); });
      questions.add(question);
    }
    for (;;) {
      const now = Date.now();
      // The reading starts once the questions are answered, or after as long as a read holds its place.
      const begun = !questions.size || now - started >= FILTER_LINE_ITEMS_READ_MS;
      /** The reads that hold a place: those asked for less than FILTER_LINE_ITEMS_READ_MS ago. */
      const holding = [...waiting.values()].filter(read => now - read.since < FILTER_LINE_ITEMS_READ_MS);
      // A candidate does not wait for a place held by a read that was not asked for as a candidate's (but as another
      // module's, while the model had not yet said which modules have the filtered dimensions): it is asked for as soon as
      // it was before the other modules were searched at all.
      const toStart = [...candidates].filter(id => !asked.has(id) && unread(id)).length;
      const forCandidates = Math.min(toStart, FILTER_LINE_ITEMS_AT_A_TIME - holding.filter(read => read.named).length);
      step = plan(begun ? Math.max(FILTER_LINE_ITEMS_AT_A_TIME - holding.length, forCandidates) : 0);
      // Until every rule has its line item (what a rule then still holds unnamed is its context, which no module lists),
      // or the time is up.
      if (!(step.everywhere.length + step.candidatesOnly.length) || left() <= 0) break;
      if (now - said >= FILTER_LINE_ITEMS_STATUS_MS) {
        said = now;
        progress.status(`Finding filter line items in ${scope.modelName}: ${asked.size} of ${asked.size + step.toRead} modules…`);
      }
      for (const moduleId of step.modules) {
        asked.add(moduleId);
        const answered: Promise<void> = readLineItems(reads, moduleId, givingUp.signal).finally(() => { waiting.delete(moduleId); });
        waiting.set(moduleId, { since: now, named: candidates.has(moduleId), answered });
      }
      bracketed += step.bracketed;
      // Or until nothing is left to start and nothing is waiting that can still help. A read can while an ID is looked
      // for in every module, or when it is a candidate's: for IDs that are looked for in the candidates only, the read of
      // another module is not waited for. A question can while its answer can still name a module: once the reading has
      // begun without their answers, the questions are not waited for when none can.
      const helping = step.everywhere.length ? waiting.size : [...waiting.keys()].filter(id => candidates.has(id)).length;
      if (!helping && (!questions.size || (begun && whole()))) break;
      // What happens next: an answer; the end of the time; the moment the reading starts without the questions' answers;
      // or, while a module waits for a place, the moment a read has held its place long enough.
      const places = begun && step.toRead > step.modules.length
        ? [...waiting.values()].filter(read => now - read.since < FILTER_LINE_ITEMS_READ_MS).map(read => read.since + FILTER_LINE_ITEMS_READ_MS - now) : [];
      let timer: ReturnType<typeof setTimeout> | undefined;
      const moment = new Promise<void>(resolve => { timer = setTimeout(resolve, Math.min(left(), ...places, ...(begun ? [] : [started + FILTER_LINE_ITEMS_READ_MS - now]))); });
      try {
        await settle(Promise.race([moment, ...questions, ...[...waiting.values()].map(read => read.answered)]));
      } finally {
        clearTimeout(timer);
      }
    }
    // The questions still unanswered: those whose answers could have named a module that was left, and those that could not.
    [givenUp, unsaid, spared] = [waiting.size, whole() ? 0 : questions.size, whole() ? questions.size : 0];
  } finally {
    givingUp.abort();
  }
  // How far the search went, for the reader of a live run's log: a rule whose line item it did not find keeps its IDs.
  // Every ID that was looked for is found, or not found, or was the context of a rule that has its line item now.
  const read = (modules: Iterable<string>) => [...modules].filter(id => catalog.lineItemModules.has(id)).length;
  const found = [...itemIds].filter(id => catalog.lineItems.has(id));
  const missing = step.everywhere.length + step.candidatesOnly.length;
  const context = itemIds.size - found.length - missing;
  progress.log(`filter line items: ${itemIds.size} looked for in ${read(candidates)} of ${candidates.size} candidate modules that have the filtered dimensions and `
    + `${read(others())} of ${others().length} other modules, in ${Math.round((Date.now() - started) / 1000)} s, ${givenUp} reads given up while waiting: ${found.length} found`
    + `${found.length ? ` (${found.filter(id => candidates.has(catalog.lineItems.get(id)!.moduleId)).length} in candidate modules)` : ""}`
    + `${context ? `, ${context} the context of rules that now have their line item` : ""}, ${missing} not found`);
  // Whether the model names, for a filtered dimension, modules that its list of modules does not hold: a live run's log
  // shows it here. (Nothing is said when the list did not arrive: the summary shows that.)
  if (catalog.moduleListLoaded && beyond.size) progress.log(`filter line items: ${beyond.size} of the ${allNamed.size} modules the model named are not in its list of modules`);
  progress.log(`filter line items: the entity-type bracket chose ${bracketed} of the ${asked.size} modules asked for; ${step.evidence}`);
  if (step.candidatesOnly.length) {
    const beside = step.candidatesOnly.length - step.ruledOut.length;
    progress.log(`filter line items: of the ${missing} not found, ${step.candidatesOnly.length} looked for in the candidate modules only: ${step.ruledOut.length} ruled out, `
      + "each by a module that was read, which has the line items of its entity type and does not list it ("
      + step.ruledOut.slice(0, MAX_LOGGED).map(({ id, moduleId }) => `${id} by module ${moduleId}`).join(", ")
      + `${step.ruledOut.length > MAX_LOGGED ? ` and ${step.ruledOut.length - MAX_LOGGED} more` : ""})${beside ? `, and ${beside} in a rule with such an ID` : ""}`);
  }
  // A question the model had not answered when no module of its list was left to read is no case of the time running out:
  // the log says so, and no note.
  if (missing && spared) {
    progress.log(`filter line items: the model had not said which modules have ${spared} of the filtered dimensions when no module of its list was left to read: no answer could name another`);
  }
  // The search was cut short when it ended with an ID still not found and something left undone: a module that was to be
  // read for it (every module while an ID is looked for everywhere, else the candidates) and was neither read nor refused,
  // because it was never asked for or was given up while waiting; or a question the model had not answered, whose answer
  // could have named a module that was left. Only the end of the time leaves such a thing. The log and the note say the
  // same, and count every module that was not read.
  const due = step.everywhere.length ? [...candidates, ...others()] : [...candidates];
  if (missing && (due.some(unread) || unsaid)) {
    const notRead = due.length - read(due);
    const dimensions = `the model had not said which modules have ${unsaid} of the filtered dimensions`;
    progress.log(`filter line items: the ${FILTER_LINE_ITEMS_BUDGET_MS / 1000} seconds allowed for the search ran out: ${notRead} modules left unread${unsaid ? `, and ${dimensions}` : ""}`);
    notes.push(`${scope.modelName}: some filter line items were not found in the ${FILTER_LINE_ITEMS_BUDGET_MS / 1000} seconds allowed for the search: `
      + `${[...(notRead ? [`${notRead} of ${due.length} modules were not read`] : []), ...(unsaid ? [dimensions] : [])].join(", and ")}.`);
  }
}

/** Names of the items in filter rules, which are stored as IDs: an item a rule's context is fixed to, and an item a line
 * item that is formatted as a list is compared with. Both are read as Page Builder reads the labels of items, from a
 * module that has the item's dimension (the read `readItemNames` makes for shown and hidden items):
 * - A context item is an item of one of the dimensions of the rule's line item's module. Those are asked in turn.
 * - A compared item is an item of the list the line item is formatted as, which the line items listing names. It is asked
 *   of a module that has that list as a dimension: one whose dimensions are known, or one the model names for the list.
 *   When the listing does not say the list, the dimensions of the line item's own module are asked.
 * Where an item of the same entity type was named before, that module and dimension are asked first. Nothing is asked
 * twice, at most MAX_FILTER_ITEM_READS reads are made, and after two reads that went unanswered no more are made. All of
 * them together take FILTER_ITEMS_BUDGET_MS at most, from the first: when that time is up no further read is made, and
 * the one that is waiting is given up. An item no read names keeps its ID, and so does a value of a line item the listing
 * does not say is formatted as a list or a time period: nothing is asked about that one. The log says what was asked and
 * how much of it was named, in IDs only, and when the time ran out, how much was left unasked.
 * `asked` are the modules whose dimensions were asked for with the grids'. */
async function readFilterItemNames(reads: SocketReads, pages: readonly UxPageCardDetails[], asked: ReadonlySet<string>): Promise<void> {
  const { scope, connection, subscribe, settle, ended, catalog, progress } = reads;
  const { workspaceId: ws, modelId: model } = scope;
  const needs = filterItemNeeds(pages.flatMap(page => page.cards), catalog);
  for (const { lineItemId, values } of needs.unsaid) {
    progress.log(`${describeFormat(lineItemId, catalog)}; ${values} of its values look like IDs and are not asked for: it is not said to be formatted as a list`);
  }
  let left = MAX_FILTER_ITEM_READS;
  let unanswered = 0;
  /** When the time for these reads is up, once the first of them is made; and whether it stopped one. */
  let until = Infinity;
  let timeUp = false;
  /** The items a read asked for, answered or not. */
  const sent = new Set<string>();
  const unnamed = (itemIds: readonly string[]) => itemIds.filter(id => !catalog.listItems.has(id));
  /** One read, when there are reads and time left: the first shows the step and starts the time. A read waits for its
   * answer no longer than the time that is left. What it throws is logged, unless the socket work has ended.
   * `itemIds` are the items it asks for. */
  const read = async (what: string, destination: string, options: SubscribeOptions, done: (json: unknown) => string, itemIds: readonly string[] = []): Promise<void> => {
    if (left <= 0 || unanswered >= 2) return;
    if (left === MAX_FILTER_ITEM_READS) {
      progress.status(`Reading filter item names in ${scope.modelName}…`);
      until = Date.now() + FILTER_ITEMS_BUDGET_MS;
    }
    const time = until - Date.now();
    if (time <= 0) { timeUp = true; return; }
    left--;
    itemIds.forEach(id => sent.add(id));
    try {
      progress.log(`${what}${done(await settle(subscribe(destination, { ...options, timeoutMs: Math.min(FILTER_ITEM_READ_MS, time) })))}`);
    } catch (error) {
      if (connection.failed || ended()) throw error;
      // Given up because the time for all of them was up, a read is not one that went unanswered for as long as a read may.
      const waited = error instanceof StompError && error.code === "TIMEOUT";
      if (waited && Date.now() >= until) timeUp = true; else if (waited) unanswered++;
      progress.log(`${what}: ${message(error)}`);
    }
  };
  const dimensionsOf = (moduleId: string) => (catalog.moduleDimensions.get(moduleId) ?? []).map(dimension => dimension.id).filter(id => id !== LINE_ITEMS);
  const tried = new Map<string, Set<string>>();
  /** The items a place was not asked for, or not to the end, because the time was up: no read names them after that. */
  const cutShort = new Set<string>();
  /** Asks one module's dimension for the names of those of the items that are still unnamed and were not asked of it before.
   * A dimension whose ID is no ID (the listings are the service's own text) is not asked. */
  const ask = async (kind: string, moduleId: string, dimensionId: string, itemIds: readonly string[]): Promise<void> => {
    const before = tried.get(`${moduleId}|${dimensionId}`) ?? new Set<string>();
    const asking = unnamed(itemIds).filter(id => !before.has(id));
    if (!asking.length || !ENTITY_ID.test(dimensionId)) return;
    tried.set(`${moduleId}|${dimensionId}`, new Set([...before, ...asking]));
    await read(`${kind}: ${asking.length} asked of dimension ${dimensionId} in module ${moduleId}`, `core://${ws}:${model}/modules/${moduleId}/dimensions/${dimensionId}`,
      { accept: "widget/selection", body: { itemIds: asking, filter: "" } }, json => {
        addSelections(catalog, json, { moduleId, dimensionId });
        return `, ${asking.length - unnamed(asking).length} named (answer: ${selectionShape(json)})`;
      }, asking);
    if (timeUp) asking.forEach(id => cutShort.add(id));
  };
  /** First of all, where an item of the same entity type was named before. */
  const askKnownSources = async (kind: string, itemIds: readonly string[]): Promise<void> => {
    for (const id of itemIds) {
      const source = catalog.itemSources.get(entityType(id));
      if (source) await ask(kind, source.moduleId, source.dimensionId, itemIds.filter(other => entityType(other) === entityType(id)));
    }
  };

  // The dimensions of the line items' modules: read with the grids' for a module a grid shows, otherwise here.
  const modules = [...new Set([...needs.context, ...needs.values.filter(group => !group.listId)].map(group => group.moduleId))]
    .filter(moduleId => ENTITY_ID.test(moduleId) && !catalog.moduleDimensions.has(moduleId) && !asked.has(moduleId));
  if (modules.length) {
    await read(`dimensions of ${modules.length} modules of filter line items`, `core://${ws}:${model}/dimensions`, { body: { moduleIds: modules } },
      json => `: ${addModuleDimensions(catalog, json).length} read`);
  }

  const CONTEXT = "filter context items";
  for (const { moduleId, itemIds, unlikely } of needs.context) {
    await askKnownSources(CONTEXT, itemIds);
    const dimensions = dimensionsOf(moduleId);
    if (!dimensions.length && unnamed(itemIds).length) progress.log(`${CONTEXT}: ${unnamed(itemIds).length} of module ${moduleId} not asked: its dimensions are not known`);
    for (const dimensionId of [...dimensions.filter(id => !unlikely.includes(id)), ...dimensions.filter(id => unlikely.includes(id))]) {
      await ask(CONTEXT, moduleId, dimensionId, itemIds);
    }
  }

  const VALUES = "filter values";
  /** Modules that have a list as a dimension, two at most: those whose dimensions are known, otherwise those the model
   * names for the list, otherwise the line item's own all the same. */
  const modulesWith = new Map<string, string[]>();
  const modulesOf = async (listId: string, own: string): Promise<string[]> => {
    const has = (moduleId: string) => ENTITY_ID.test(moduleId) && dimensionsOf(moduleId).includes(listId);
    let found = modulesWith.get(listId) ?? [...catalog.moduleDimensions.keys()].filter(has).slice(0, 2);
    if (!found.length && ENTITY_ID.test(listId)) {
      await read(`modules with dimension ${listId}`, `core://${ws}:${model}/applicableModules`, { body: { dimensions: [Number(listId)] } }, json => {
        found = applicableModuleIds(catalog, json).filter(id => ENTITY_ID.test(id)).slice(0, 2);
        return `: ${found.length ? found.join(", ") : "none"}`;
      });
    }
    if (!found.length) found = [own];
    modulesWith.set(listId, found);
    return found;
  };
  for (const { lineItemId, moduleId, listId, itemIds } of needs.values) {
    progress.log(describeFormat(lineItemId, catalog));
    await askKnownSources(VALUES, itemIds);
    if (!unnamed(itemIds).length) continue;
    if (listId) for (const candidate of await modulesOf(listId, moduleId)) await ask(VALUES, candidate, listId, itemIds);
    else for (const dimensionId of dimensionsOf(moduleId)) await ask(VALUES, moduleId, dimensionId, itemIds);
  }

  for (const [kind, groups] of [[CONTEXT, needs.context], [VALUES, needs.values]] as const) {
    const itemIds = [...new Set(groups.flatMap(group => group.itemIds))];
    const rest = unnamed(itemIds);
    const listed = rest.slice(0, MAX_LOGGED).join(", ") + (rest.length > MAX_LOGGED ? ` and ${rest.length - MAX_LOGGED} more` : "");
    if (itemIds.length) progress.log(`${kind}: ${itemIds.length - rest.length} of ${itemIds.length} named${rest.length ? `; left as IDs: ${listed}` : ""}`);
  }
  if (left <= 0) progress.log(`filter item names: no more than ${MAX_FILTER_ITEM_READS} reads are made`);
  if (unanswered >= 2) progress.log("filter item names: two reads went unanswered, no more were made");
  if (timeUp) {
    const items = [...new Set([...needs.context, ...needs.values].flatMap(group => group.itemIds))];
    progress.log(`filter item names: the ${FILTER_ITEMS_BUDGET_MS / 1000} seconds allowed for them ran out after ${MAX_FILTER_ITEM_READS - left} reads: `
      + `${sent.size} items asked for, ${items.length - unnamed(items).length} named, the asking of ${cutShort.size} not finished`);
  }
}

/** Where the cards of the pages use a dimension, for the diagnostic log: counts only. */
function dimensionUse(pages: readonly UxPageCardDetails[], id: string): string {
  const has = (entries: unknown) => list(entries).some(entry => (entry.dimension?.id ?? entry.id) === id);
  let selectors = 0, synced = 0, axes = 0, branches = 0, pageSelectors = 0;
  for (const page of pages) {
    if (has((page as unknown as Obj).pageContext?.contextSelectors)) pageSelectors++;
    for (const card of page.cards as Obj[]) {
      const regions = list(card.grid?.regions);
      const chosen = [...list(card.contextSelectors), ...regions.flatMap(region => list(region.pivot?.pages))].filter(entry => entry.dimension?.id === id);
      if (chosen.length) selectors++;
      if (chosen.some(entry => entry.syncedToPage === true)) synced++;
      if (regions.some(region => has(region.pivot?.rows) || has(region.pivot?.columns))) axes++;
      if (has(card.savedCustomizations?.branchSync)) branches++;
    }
  }
  return `a context selector of ${selectors} cards (${synced} synced to the page), on the rows or columns of ${axes}, in the branch sync of ${branches}, `
    + `a selector of ${pageSelectors} pages`;
}

/** Dimensions the cards name that no answer named so far. A page can save a card's context selector for a list that is no
 * dimension of the card's module (seen live, 7 Oct 2026), and the module's dimensions do not name it then. Such a dimension
 * is looked for once among the lists with their subsets; then, for at most MAX_DIMENSION_QUESTIONS of those still unnamed,
 * the model is asked which modules have it, and the dimensions of two of them per dimension are read, which label it. A
 * read that is refused or not answered is logged and the next is made. A read waits DIMENSION_NAME_READ_MS at most, all of
 * them together take DIMENSION_NAMES_BUDGET_MS at most, and after two reads that went unanswered no more are made; the log
 * says when the asking ended so. A connection that fails, a model that closes and a run that is stopped end the step, as
 * they end every step. Each dimension still unnamed after that has one line in the log: where the cards use it and which
 * answers hold its ID, in IDs, counts and yes or no only. */
async function readDimensionNames(reads: SocketReads, pages: readonly UxPageCardDetails[]): Promise<void> {
  const { scope, connection, subscribe, settle, ended, catalog, progress, answers } = reads;
  const { workspaceId: ws, modelId: model } = scope;
  const refs = pages.flatMap(page => page.references);
  const unnamed = () => unnamedDimensionIds(refs, catalog);
  const first = unnamed();
  if (!first.length) return;
  // After a model that closed earlier the step does not begin: it shows nothing, and what ended the work is thrown, as the
  // search for filter line items does.
  if (ended()) await settle(new Promise<never>(() => undefined));
  progress.status(`Reading dimension names in ${scope.modelName}…`);
  const until = Date.now() + DIMENSION_NAMES_BUDGET_MS;
  let unanswered = 0;
  let timeUp = false;
  /** One read, while there is time left and fewer than two went unanswered; otherwise nothing is asked. */
  const read = async (what: string, destination: string, body: Record<string, unknown>, done: (json: unknown) => string): Promise<unknown> => {
    const time = until - Date.now();
    if (time <= 0) timeUp = true;
    if (timeUp || unanswered >= 2) return undefined;
    try {
      const json = await settle(subscribe(destination, { body, timeoutMs: Math.min(DIMENSION_NAME_READ_MS, time) }));
      progress.log(`${what}${done(json)}`);
      return json;
    } catch (error) {
      if (connection.failed || ended()) throw error;
      // Given up because the time for all of them was up, a read is not one that went unanswered for as long as a read may.
      const waited = error instanceof StompError && error.code === "TIMEOUT";
      if (waited && Date.now() >= until) timeUp = true; else if (waited) unanswered++;
      progress.log(`${what}: ${message(error)}`);
      return undefined;
    }
  };
  const subsets = await read("lists with subsets", `core://${ws}:${model}/lists?subsets=true`, {}, json => {
    addLists(catalog, json);
    return `: ${selectionShape(json)}`;
  });
  const modulesOf = new Map<string, string[]>();
  for (const id of unnamed().slice(0, MAX_DIMENSION_QUESTIONS)) {
    await read(`modules with dimension ${id}`, `core://${ws}:${model}/applicableModules`, { dimensions: [Number(id)] }, json => {
      const found = applicableModuleIds(catalog, json).filter(module => ENTITY_ID.test(module));
      modulesOf.set(id, found);
      return `: ${found.length ? found.slice(0, MAX_LOGGED).join(", ") : "none"}`;
    });
  }
  const modules = [...new Set([...modulesOf.values()].flatMap(found => found.slice(0, 2)))].filter(module => !catalog.moduleDimensions.has(module));
  if (modules.length) {
    const json = await read(`dimensions of ${modules.length} modules that have an unnamed dimension`, `core://${ws}:${model}/dimensions`, { moduleIds: modules },
      answer => `: ${addModuleDimensions(catalog, answer).length} read`);
    if (json !== undefined) answers.moduleDimensions.push(json);
  }

  const left = unnamed();
  progress.log(`dimension names: ${first.length - left.length} of ${first.length} named`);
  if (unanswered >= 2) progress.log("dimension names: two reads went unanswered, no more were made");
  if (timeUp) progress.log(`dimension names: the ${DIMENSION_NAMES_BUDGET_MS / 1000} seconds allowed for them ran out`);
  if (!left.length) return;
  const asText = (json: unknown) => (json === undefined ? undefined : JSON.stringify(json) ?? "");
  const held = { lists: asText(answers.lists), subsets: asText(subsets), views: asText(answers.moduleViews),
    dimensions: answers.moduleDimensions.length ? answers.moduleDimensions.map(json => JSON.stringify(json) ?? "").join("\n") : undefined };
  const holds = (body: string | undefined, id: string) => (body === undefined ? "no answer" : new RegExp(`(?<!\\d)${id}(?!\\d)`).test(body) ? "yes" : "no");
  for (const id of left.slice(0, MAX_LOGGED)) {
    progress.log(`dimension ${id} has no name: ${dimensionUse(pages, id)}; its ID is in the answers of lists: ${holds(held.lists, id)}, `
      + `lists with subsets: ${holds(held.subsets, id)}, module views: ${holds(held.views, id)}, module dimensions: ${holds(held.dimensions, id)}; `
      + `modules that have it: ${modulesOf.get(id)?.length ?? "not asked"}`);
  }
  if (left.length > MAX_LOGGED) progress.log(`dimensions with no name: ${left.length - MAX_LOGGED} more are not listed`);
}

/** What the names of a model are read for: the pages' described cards, the pages' names by their IDs, and the model's
 * line items as its export read them, where the run has them (model-pages.ts). */
export interface CatalogInputs { pages: readonly UxPageCardDetails[]; pageNames: ReadonlyMap<string, string>; exported?: ExportedLineItems }

/** How the names of a model are read. `frameHost` is the host of the frame the model is read in: the socket starts there
 * (withSocket). `viewLayouts: false` reads no saved view's rows, columns and context selectors: they are for an app's
 * Cards and Grid Sections tables, which a model's run does not make (model-pages.ts), and a model's views can be many
 * (233 in a live run, 10 Oct 2026). */
export interface LoadOptions { frameHost?: () => string | undefined; viewLayouts?: boolean }

/** Names for one model, for pages that were read already: an app's (`analyseApp`), or the pages built on a model, read
 * after its export (model-pages.ts `addModelPages`). */
export function loadCatalog(scope: ModelScope, pages: readonly UxPageCardDetails[], pageNames: ReadonlyMap<string, string>,
  progress: Progress, signal?: AbortSignal, exported?: ExportedLineItems, options: LoadOptions = {}): Promise<{ catalog: ModelCatalog; notes: string[]; failedActionTypes: string[] }> {
  return loadCatalogWhen(scope, Promise.resolve({ pages, pageNames, ...(exported ? { exported } : {}) }), progress, signal, options);
}

/** Names for one model. Like Page Builder, it asks for the data straight away and lets the service load the model: a
 * model that is not open reports status UNKNOWN until a data request loads it (observed live, 28 Sep 2026), so the
 * status is watched and logged, never waited for. `exported` (of `inputs`) are the model's line items as its export read
 * them, where the run has them (model-pages.ts): they are taken before anything is asked of them, and a module of theirs
 * is not read from the listing (`compareExported` says when one is, and why). A connection-level error such as
 * REDIRECTION_REQUIRED fails every subscription and is rethrown, so withSocket reconnects to the host it names. When
 * `signal` asks the run to stop, the socket work ends at once, as it does for a closed model, and the stop is rethrown
 * instead of noted. A run that was stopped before its socket had connected asks the model for nothing at all: subscribing
 * can make the service load it. Stopped later, while the action names are read, it reads no further list of them.
 *
 * `inputs` may come later than the socket: a model's run reads its names while its export is being read (model-pages.ts
 * `startModelPages`), and the first step, the model's names of modules and lists, needs none of them. The socket connects
 * and asks for those at once; the other steps wait for the inputs, and the Time line says how long they waited. Inputs
 * that never come (the run's export failed, so its names are no longer wanted) end the work with that failure. */
export async function loadCatalogWhen(scope: ModelScope, inputs: Promise<CatalogInputs>, progress: Progress, signal?: AbortSignal,
  options: LoadOptions = {}): Promise<{ catalog: ModelCatalog; notes: string[]; failedActionTypes: string[] }> {
  const { workspaceId: ws, modelId: model } = scope;
  const catalog = emptyCatalog();
  const notes: string[] = [];
  /** The inputs once they have come, taken into the catalog as they come: the pages' names, and the export's line items. */
  let given: CatalogInputs | undefined;
  let refs: UxEntityRef[] = [];
  const moduleIds = new Set<string>();
  const arrived = inputs.then(value => {
    given = value;
    for (const [guid, pageName] of value.pageNames) catalog.pages.set(guid, pageName);
    refs = value.pages.flatMap(page => page.references);
    for (const ref of refs) {
      if (ref.kind === "module" && ENTITY_ID.test(ref.id)) moduleIds.add(ref.id);
      if (ref.moduleId && ENTITY_ID.test(ref.moduleId)) moduleIds.add(ref.moduleId);
    }
    if (value.exported) addExportedLineItems(catalog, value.exported);
    return value;
  });
  arrived.catch(() => undefined);
  if (!SCOPE_ID.test(ws) || !SCOPE_ID.test(model)) {
    await arrived;
    return { catalog, notes: [`${scope.modelName}: unexpected workspace or model ID; names were not looked up.`], failedActionTypes: ["IMPORT", "EXPORT", "PROCESS"] };
  }
  /** The host the model data service settled on (another data centre after a redirect). */
  let modelHost: string | undefined;
  /** The modules whose line items the listing gave, and what the comparison of the export's line items with it said: it is
   * made once, on the host that answers it (after a redirect, the model's own). */
  const listed = new Set<string>();
  let compared: string | undefined;
  /** How long each step took, from the first: those of the host the socket settled on, after a redirect the model's own. */
  let time = stepTimes();
  const began = Date.now();

  try {
    await withSocket(scope, progress.log, signal, async (connection, host) => {
      modelHost = host;
      let status = "not reported yet";
      let stop: (error: Error) => void = () => undefined;
      let ended = false;
      const stopped = new Promise<never>((_, reject) => { stop = error => { ended = true; reject(error); }; });
      stopped.catch(() => undefined);
      const halt = () => stop(new StompError("stopped"));
      signal?.addEventListener("abort", halt, { once: true });
      connection.subscribe(`core://${ws}:${model}`, {
        accept: "widget/model", body: {}, timeoutMs: 30 * 60_000,
        until: data => {
          status = String((data as Obj | null)?.status ?? "not reported");
          progress.log(`model status ${status}`);
          if (status === "NO_SUCH_MODEL" || status === "CLOSED") stop(new StompError(`the model is ${status.toLowerCase().replace(/_/g, " ")}`, status));
          return false;
        },
      }).catch(() => undefined);
      // Every step ends here: a failed connection (a redirect, or a close) is rethrown instead of read as "no data".
      const settle = async <T>(work: Promise<T>): Promise<T> => {
        const result = await Promise.race([work, stopped]);
        if (connection.failed) throw connection.failed;
        return result;
      };
      // Every read of every step is made here. Once the socket work has ended nothing more is sent, whichever step asks: one
      // that comes after a step which logged the end as a refused read and went on, or after an answer that came in the
      // same breath as the end. Such a read waits for no answer, and the step's own `settle` ends it. (The watch on the
      // model's status above is no read of a step: it is what says that the model closed.)
      const subscribe: StompConnection["subscribe"] = (destination, options) => (ended ? new Promise<never>(() => undefined) : connection.subscribe(destination, options));
      const answers: NameAnswers = { moduleDimensions: [] };
      const reads: SocketReads = { scope, signal, connection, subscribe, settle, halted: () => signal?.aborted === true, ended: () => ended, catalog, listed, notes, progress,
        answers };
      // The connection's time, from the first try: a redirect, and the try before it, included.
      time = stepTimes();
      time.took("connection", Date.now() - began);
      const started = Date.now();
      const waiting = setInterval(() => progress.status(`Reading names in ${scope.modelName}: ${Math.round((Date.now() - started) / 1000)} s, `
        + `model status ${status}. A model that is not open can take a few minutes to load…`), 5_000);
      try {
        progress.status(`Reading names in ${scope.modelName}…`);
        const [views, lists] = await time.step("module and list names", async () => {
          const answered = await settle(Promise.allSettled([
            subscribe(`core:/${ws}:${model}/moduleViews`, { body: {}, timeoutMs: LOAD_MS }),
            subscribe(`core://${ws}:${model}/lists`, { body: {}, timeoutMs: LOAD_MS }),
          ]));
          return answered;
        });
        clearInterval(waiting);
        if (views.status === "fulfilled") {
          addModuleViews(catalog, views.value);
          answers.moduleViews = views.value;
          progress.log(`module views: ${moduleViewsShape(views.value)}`);
        } else notes.push(`${scope.modelName}: module and saved view names were not available (${message(views.reason)}).`);
        if (lists.status === "fulfilled") {
          addLists(catalog, lists.value);
          answers.lists = lists.value;
          progress.log(`lists: ${selectionShape(lists.value)}`);
        } else notes.push(`${scope.modelName}: list names were not available (${message(lists.reason)}).`);
        // What the other steps read for: the pages and the export, which a model's run may still be reading.
        const { pages, exported } = given ?? await time.step("waiting for the pages and the export", () => settle(arrived));
        progress.status(`Reading line items in ${scope.modelName}…`);
        await time.step("line items", async () => {
          if (exported && compared === undefined) compared = await compareExported(reads, moduleIds, exported);
          // Only the modules whose line items are not known yet: from the export, or from a read before a redirect.
          const unknown = [...moduleIds].filter(id => !catalog.lineItemModules.has(id));
          await settle(eachAtMost(unknown, AT_A_TIME, signal, moduleId => readLineItems(reads, moduleId)));
        });
        if (exported) {
          const named = [...catalog.lineItems.values()].filter(item => !listed.has(item.moduleId)).length;
          progress.log(`line items: ${named} named from the export, of ${exported.modules.length} modules; ${listed.size} of the ${moduleIds.size} modules the pages use `
            + `read from the listing; ${compared}`);
        }

        const needs = gridNeeds(pages);
        await time.step("module dimensions", () => readModuleDimensions(reads, needs.modules));
        await time.step("item names", () => readItemNames(reads, needs.items));
        if (options.viewLayouts !== false) await time.step("saved views", () => readViewLayouts(reads, refs));
        else if (refs.some(ref => ref.kind === "view")) progress.log("saved views: their rows, columns and context selectors are not read, as no table of a model's run shows them");
        await time.step("filter line items", () => findFilterLineItems(reads, pages));
        await time.step("filter item names", () => readFilterItemNames(reads, pages, needs.modules));
        await time.step("dimension names", () => readDimensionNames(reads, pages));
        // Whatever a rule still holds unnamed, by what the rule's items are: it shows a live run's reader what was not found.
        const unnamed = unnamedFilterRules(pages.flatMap(page => page.cards), catalog);
        for (const line of unnamed.slice(0, MAX_LOGGED)) progress.log(line);
        if (unnamed.length > MAX_LOGGED) progress.log(`filter rules with an unnamed item: ${unnamed.length - MAX_LOGGED} more are not listed`);
      } finally {
        clearInterval(waiting);
        signal?.removeEventListener("abort", halt);
      }
    }, options.frameHost);
  } catch (error) {
    notes.push(`${scope.modelName}: names from the model data service were not available (${message(error)}); IDs are shown instead.`);
  }
  signal?.throwIfAborted();
  // The inputs, if they have not come yet: their failure ends the work, for its names are no longer wanted.
  await arrived;

  const actions = await time.step("action names", () => readActionNames(scope, refs, modelHost, catalog, progress, signal));
  notes.push(...actions.notes);
  progress.log(`${time.line()}; names of ${scope.modelName} in all ${seconds(Date.now() - began)}`);
  progress.log(`${scope.modelName}: ${catalog.modules.size} modules, ${catalog.views.size} saved views, ${catalog.dimensions.size} dimensions, `
    + `${catalog.lineItems.size} line items (${listed.size} modules read), ${catalog.actions.size} actions`);
  return { catalog, notes, failedActionTypes: actions.failedActionTypes };
}

/** File names in the model export's style (asked for by the user, 28 Sep 2026); App Details.csv comes first. Exported so
 * that the results page, which knows an app's tables by these names, can pin them in a test. No user sees them: the page
 * shows a table under its label, and makes no file. */
export const DETAILS_FILE = "App Details.csv";
export const TAB_FILES: Record<TabName, string> = {
  Pages: "Pages.csv", Cards: "Cards.csv", "Grid sections": "Grid Sections.csv", Filters: "Filters.csv", Formatting: "Conditional Formatting.csv",
  Actions: "Action Buttons.csv", "Where used": "Where Used.csv",
};

/** The name a table is shown under where it is not its file's: an app's Where Used file lists the model's objects that
 * the app uses, and where each is used. */
const TAB_LABELS: ReadonlyMap<string, string> = new Map([[TAB_FILES["Where used"], "Model Objects"]]);
/** How to read the tables, as the results page shows them: the overview lists these rows as they are. They speak of the
 * page's tables, never of a file: the page makes none. */
const HOW_TO_READ: readonly [detail: string, value: string][] = [
  ["Page and Card #", "Identify a card in every table. Card # counts cards row by row, left to right; Card ID is the stable key."],
  ["View type", "Custom view: a module shaped on the page. Saved view: a saved view or a module's default view, built in the model and only selected on the page. Combined grid: several module sections in one card."],
  ["Set in the model (saved view)", "A saved view's own filters, sorts and show/hide live in the model, not on the page."],
  ["(not in the model)", "A module or line item a card still points at but the model no longer has: deleted, or not visible to you. Search the Model Objects table for it to find the cards."],
  ["Filter context and values", "An item in a filter rule, whether chosen as the filter context or compared with a line item formatted as a list, is shown by its name where the model gives one, and by its ID otherwise. A rule's line item has its own columns, and its context gives each other dimension as current, which follows the page, or as the item it is fixed to: Users = Current User is whoever views the page. Only where the rule's line item is not found are the line item and its context listed together in place of the line item's name."],
];

/** What the user is told when the app itself cannot be read (progress.ts `Failure`), by what Anaplan answered. */
const APP_UNREAD = {
  refused: "Anaplan refused the request. You may not have access to this app: check that you can open it in Anaplan, then choose Run again.",
  missing: "Anaplan could not find this app. It may have been deleted or moved: open it again in Anaplan, then click the Cardigan icon.",
  failed: `Anaplan answered with an error. Wait a moment, then choose Run again. ${SEND_LOG}`,
  unreachable: "Anaplan could not be reached. Check your connection, then choose Run again.",
  slow: "Anaplan took too long to answer. Wait a moment, then choose Run again.",
  unreadable: `Cardigan could not read Anaplan's answer about this app. ${REFRESH} ${SEND_LOG}`,
};

/** A failed read of the app as the sentence for the user, with the read's own code and HTTP status as the detail for the
 * log. A session that has ended is passed on as it is: the content script tells it by its code. */
function appUnread(error: unknown): unknown {
  if (!(error instanceof RestError) || error.code === "SIGNED_OUT") return error;
  const said = error.code === "HTTP_ERROR" ? (error.status === 403 ? APP_UNREAD.refused : error.status === 404 ? APP_UNREAD.missing : APP_UNREAD.failed)
    : error.code === "NETWORK_ERROR" ? APP_UNREAD.unreachable : error.code === "TIMEOUT" ? APP_UNREAD.slow : APP_UNREAD.unreadable;
  return new Failure(said, error.message);
}

/** The app's pages as the result's tables: App Details.csv, then the seven tables. The pages are read a few at a time
 * (`AT_A_TIME`), started in the app's order, and the report takes them in that order whichever is answered first. `signal`
 * stops the run (the results page that asked for it went away): it starts no further page and asks nothing more for a
 * model's names (loadCatalog), and it rejects with the signal's reason. Only the pages that are being read are finished
 * first: the routes still to be tried for them are tried. */
export async function analyseApp(appGuid: string, progress: Progress, diagnostics: () => string, signal?: AbortSignal): Promise<AnalysisResult> {
  if (!GUID.test(appGuid)) throw new Failure("Open an app first: the address has no app ID.");
  progress.status("Reading the app…");
  /** How long each step took: the log's one line on it comes before the report is built. */
  const time = stepTimes();
  const app = (await time.step("app", () => getJson(`${DEFINITION}apps/${appGuid}?includeUnpublished=true&includeReportPages=true`, { apiVersion: "2" }))
    .catch(error => { throw appUnread(error); })) as Obj;
  const appName = text(app?.name) ?? "App";
  const categories = new Map<string, string>();
  for (const category of list(app?.categories)) if (text(category.guid) && text(category.name)) categories.set(category.guid, category.name);
  const entries = list(app?.pages).filter(entry => typeof entry.guid === "string" && GUID.test(entry.guid));
  const pageNames = new Map(entries.map(entry => [entry.guid as string, text(entry.name) ?? entry.guid]));
  const types = new Map<string, number>();
  for (const entry of entries) types.set(String(entry.pageType ?? "?"), (types.get(String(entry.pageType ?? "?")) ?? 0) + 1);
  progress.log(`app: ${entries.length} pages (${[...types].map(([type, count]) => `${type} ${count}`).join(", ")}), ${categories.size} categories; `
    + `page entry fields: ${[...new Set(entries.flatMap(Object.keys))].sort().join(", ")}`);
  // The app record's page entries also carry the category name (observed live, 28 Sep 2026).
  const categoryOf = (guid: string | undefined, entry: Obj) => (guid ? categories.get(guid) : undefined) ?? text(entry.categoryName) ?? NONE;

  /** Each page as the report takes it, at the page's place in the app's list, with what its cards are where it was read. */
  const slots: { input: PageInput; details?: UxPageCardDetails }[] = new Array(entries.length);
  await time.step(`${entries.length} pages, ${AT_A_TIME} at a time`, () => eachAtMost(entries, AT_A_TIME, signal, async (entry, index) => {
    const pageName = pageNames.get(entry.guid) ?? entry.guid;
    progress.status(`Reading page ${index + 1} of ${entries.length}: ${pageName}`);
    const read = entry.hasPublishedVersion === false ? { state: "Not published" } : await readPublished(entry.guid, declaredType(entry), progress.log);
    const base = { appName, pageName, pageGuid: entry.guid as string, appGuid, publishedAt: undefined as number | string | undefined };
    if ("state" in read) {
      const categoryGuid = text(entry.categoryGuid);
      slots[index] = { input: { ...base, categoryName: categoryOf(categoryGuid, entry), pageType: declaredType(entry) ?? NONE,
        state: read.state, modelName: NONE, workspaceName: NONE, modelId: text(entry.modelId) ?? NONE } };
      return;
    }
    const { type, native } = read;
    const categoryGuid = text(native.categoryGuid) ?? text(entry.categoryGuid);
    const info: Obj = native.modelInfo ?? {};
    const input: PageInput = {
      ...base, pageType: type, categoryName: categoryOf(categoryGuid, entry),
      state: native.currentDraftVersionGuid === native.currentPublishedVersionGuid ? "Published (no unpublished changes)" : "Published, draft differs",
      modelName: text(info.modelName) ?? NONE, workspaceName: text(info.workspaceName) ?? NONE, modelId: text(native.modelId) ?? NONE,
      publishedAt: typeof native.publishedAt === "number" || typeof native.publishedAt === "string" ? native.publishedAt : undefined,
    };
    try {
      slots[index] = { input, details: describePageCards(type, native) };
    } catch (error) {
      input.state = `Not analysed: ${message(error)}`;
      slots[index] = { input };
    }
  }));
  const inputs: PageInput[] = slots.map(slot => slot.input);
  const described = new Map<PageInput, UxPageCardDetails>(slots.flatMap(slot => (slot.details ? [[slot.input, slot.details] as const] : [])));

  // Report pages carry no model name (observed live, 28 Sep 2026): borrow it from another page on the same model.
  for (const [input, details] of described) if (input.modelId === NONE) input.modelId = details.modelId;
  const modelNames = new Map<string, { modelName: string; workspaceName: string }>();
  for (const input of inputs) if (input.modelName !== NONE && input.modelId !== NONE) modelNames.set(input.modelId, { modelName: input.modelName, workspaceName: input.workspaceName });
  for (const input of inputs) {
    const known = input.modelName === NONE ? modelNames.get(input.modelId) : undefined;
    if (known) Object.assign(input, known);
  }

  // Names, one model at a time: subscribing may make the service load the model.
  const summary: string[] = [];
  const models = new Map<string, { scope: ModelScope; inputs: PageInput[] }>();
  for (const [input, details] of described) {
    const key = `${details.workspaceId}:${details.modelId}`;
    const group = models.get(key) ?? { scope: { customerId: details.customerId, workspaceId: details.workspaceId, modelId: details.modelId, modelName: input.modelName !== NONE ? input.modelName : details.modelId }, inputs: [] };
    group.inputs.push(input);
    models.set(key, group);
  }
  for (const { scope, inputs: group } of models.values()) {
    signal?.throwIfAborted();
    const { catalog, notes, failedActionTypes } = await time.step(`names of ${scope.modelName}`,
      () => loadCatalog(scope, group.map(input => described.get(input)!), pageNames, progress, signal));
    summary.push(...notes);
    for (const input of group) {
      input.details = nameDetails(described.get(input)!, catalog);
      input.dimensionNames = catalog.dimensions;
      input.failedActionTypes = failedActionTypes;
    }
  }

  // Stopped during its last read, the run had nothing left to be stopped before: it ends here, as a stopped run.
  signal?.throwIfAborted();
  progress.log(time.line());
  progress.status("Building the report…");
  const report = buildReport(inputs);
  const analysed = inputs.filter(input => input.details).length;
  // An unpublished page has no published version to read, so it is counted apart: "93 of 93", not "93 of 96".
  const unpublished = inputs.filter(input => input.state === "Not published").length;
  const published = inputs.length - unpublished;
  const skipped = unpublished ? [`${unpublished} unpublished, not analysed`] : [];
  const cards = report.Cards.rows.length;
  const tabs = Object.keys(HEADERS) as TabName[];
  const pageTypes = new Map<string, number>();
  for (const entry of entries) {
    const label = PAGE_TYPE[declaredType(entry) ?? ""]?.toLowerCase() ?? "other page";
    pageTypes.set(label, (pageTypes.get(label) ?? 0) + 1);
  }
  const categoryNames = [...new Set([...categories.values(), ...inputs.map(input => input.categoryName).filter(name => name !== NONE)])];
  const modelsUsed = [...new Set(inputs.filter(input => input.modelName !== NONE)
    .map(input => (input.workspaceName !== NONE ? `${input.modelName} (${input.workspaceName})` : input.modelName)))];
  // The overview lists these rows under About this export. A value that lists several things, the categories or the
  // models, has each on a line of its own, and so has the value that says two: how many published pages were analysed,
  // and how many pages were left unpublished. The line breaks are the value's own, and the overview shows them as they
  // are (results.css `#ovAbout`). The page splits no value: splitting at semicolons would also split a name that has one.
  const lines = (items: readonly string[]): string => items.join("\n");
  const details: DetailRow[] = [
    ["App", "App", appName],
    ["App", "App ID", appGuid],
    ["App", "Categories", lines(categoryNames) || NONE],
    ["App", "Pages", `${entries.length} (${[...pageTypes].map(([label, count]) => `${count} ${label}${count === 1 ? "" : "s"}`).join(", ")})`],
    ["App", "Pages analysed", lines([`${analysed} of ${published} (published versions)`, ...skipped])],
    ["App", "Cards", cards],
    ["App", "Models", lines(modelsUsed) || NONE],
    ...exportRows(location.host),
    ...tabs.map((tab): DetailRow => ["Files", TAB_FILES[tab], `${report[tab].rows.length} rows`]),
    ...inputs.filter(input => !input.details).map((input): DetailRow => ["Notes", input.pageName, input.state]),
    ...(summary.length ? summary.map((note): DetailRow => ["Notes", "Names", note]) : [["Notes", "Names", "All models answered."] as DetailRow]),
    ...HOW_TO_READ.map(([detail, value]): DetailRow => ["How to read", detail, value]),
    ...diagnosticRows(diagnostics()),
  ];
  // Every file is marked as one that guards formula-like cells when it is written as a CSV, as the page analysis always
  // was. The page writes none: the mark is read by the tests' writer (zip.test-support.ts `toCsv`).
  const table = (file: string, headers: readonly string[], rows: readonly (readonly unknown[])[]): ResultTable =>
    ({ file, label: TAB_LABELS.get(file) ?? file.replace(/\.csv$/, ""), headers: [...headers], rows: plainRows(rows), guard: true });
  const tables: ResultTable[] = [
    { ...table(DETAILS_FILE, DETAILS_HEADERS, details), details: true },
    ...tabs.map(tab => table(TAB_FILES[tab], report[tab].headers, report[tab].rows)),
  ];
  const date = new Date().toISOString().slice(0, 10);
  return {
    kind: "app", name: appName, id: appGuid, zipName: `${fileSafe(appName, "app")} - App Export - ${date}.zip`, tables,
    // The summary is a sentence among the overview's notes, and says the same in one line, as it always did.
    summary: [`${[`${analysed} of ${published} pages analysed`, ...skipped].join("; ")}, ${cards} cards.`, ...summary],
  };
}
