import { describePageCards } from "../../../src/domains/ux-designer/card-details.js";
import { nameCardDetails } from "../../../src/domains/ux-designer/card-naming.js";
import type { UxPageCardDetails } from "../../../src/domains/ux-designer/card-types.js";
import type { UxPageType } from "../../../src/domains/ux-designer/definition-types.js";
import {
  addActions, addLineItems, addLists, addModuleDimensions, addModuleViews, addSelections, applicableModuleIds, emptyCatalog, resolveFromCatalog,
  unresolvedFilterItems, viewLayoutFromMetadata, type ModelCatalog,
} from "./catalog.js";
import { DETAILS_HEADERS, diagnosticRows, exportRows, type DetailRow } from "./details.js";
import type { Log, Progress, TaskResult } from "./panel.js";
import { buildReport, HEADERS, LINE_ITEMS, NONE, PAGE_TYPE, type PageInput, type TabName } from "./report.js";
import { getJson, RestError } from "./rest.js";
import { StompConnection, StompError } from "./stomp.js";
import { ANAPLAN_HOST, fileSafe, SCOPE_ID } from "./util.js";
import { toCsv, zipStore } from "./zip.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Obj = Record<string, any>;
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ENTITY_ID = /^[1-9]\d{0,17}$/;
const DEFINITION = "/a/springboard-definition-service/";
const PAGE_TYPES: UxPageType[] = ["BOARD", "GRID-PAGE", "REPORT"];
const ROUTE: Record<UxPageType, string> = { BOARD: "boards", "GRID-PAGE": "grid-pages", REPORT: "reports" };
/** Extra modules read to find filter line items that no card otherwise references. */
const MAX_EXTRA_MODULES = 60;
/** A model that is not open loads on the first data request, which can take minutes. */
const LOAD_MS = 300_000;
const LINE_ITEMS_MS = 120_000;

const list = (value: unknown): Obj[] => (Array.isArray(value) ? value.filter(item => item && typeof item === "object") : []);
const text = (value: unknown): string | undefined => (typeof value === "string" && value ? value : undefined);
const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

function declaredType(entry: Obj): UxPageType | undefined {
  const raw = String(entry.pageType ?? entry.type ?? "").toUpperCase();
  if (raw.includes("BOARD")) return "BOARD";
  if (raw.includes("GRID") || raw.includes("WORKSHEET")) return "GRID-PAGE";
  if (raw.includes("REPORT")) return "REPORT";
  return undefined;
}

/** The app record's page entries may not state a type, so every route is tried: a wrong route answers an error, which is
 * harmless for a read. A problem is reported only when no route returns the page. */
async function readPublished(guid: string, declared: UxPageType | undefined, log: Log): Promise<{ type: UxPageType; native: Obj } | { state: string }> {
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

/** `work` gets the host that finally served the model, after any redirect. */
async function withSocket<T>(customerId: string, log: Log, work: (connection: StompConnection, host: string) => Promise<T>): Promise<T> {
  let host = location.host;
  for (let attempt = 0; attempt < 2; attempt++) {
    const session = crypto.randomUUID();
    const url = `wss://${host}/a/springboard-widget-data-service/ws?tracePath=springboard-ui&clientVersion=page-analyzer&clientSessionId=${session}`;
    let connection: StompConnection | undefined;
    try {
      connection = await StompConnection.open(url, {
        "enabled-features": "", "accept-language": navigator.language || "en", "close-mode": "error-frame", "page-visible": "true",
        ...(customerId ? { "anaplan-customer": customerId } : {}),
      }, log);
      return await work(connection, host);
    } catch (error) {
      if (attempt === 0 && error instanceof StompError && error.code === "REDIRECTION_REQUIRED" && error.fqdn && ANAPLAN_HOST.test(error.fqdn)) {
        log(`redirected to ${error.fqdn}`);
        host = error.fqdn;
        continue;
      }
      throw error;
    } finally {
      connection?.close();
    }
  }
  throw new StompError("The model data service redirected more than once.");
}

async function inBatches<T>(items: readonly T[], size: number, work: (item: T) => Promise<void>): Promise<void> {
  for (let i = 0; i < items.length; i += size) await Promise.all(items.slice(i, i + size).map(work));
}

export interface ModelScope { customerId: string; workspaceId: string; modelId: string; modelName: string }

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

/** Names for one model. Like Page Builder, it asks for the data straight away and lets the service load the model: a
 * model that is not open reports status UNKNOWN until a data request loads it (observed live, 28 Sep 2026), so the
 * status is watched and logged, never waited for. A connection-level error such as REDIRECTION_REQUIRED fails every
 * subscription and is rethrown, so withSocket reconnects to the host it names. */
export async function loadCatalog(scope: ModelScope, pages: readonly UxPageCardDetails[], pageNames: ReadonlyMap<string, string>,
  progress: Progress): Promise<{ catalog: ModelCatalog; notes: string[]; failedActionTypes: string[] }> {
  const { workspaceId: ws, modelId: model } = scope;
  const catalog = emptyCatalog();
  const notes: string[] = [];
  const failedActionTypes: string[] = [];
  for (const [guid, pageName] of pageNames) catalog.pages.set(guid, pageName);
  const refs = pages.flatMap(page => page.references);
  if (!SCOPE_ID.test(ws) || !SCOPE_ID.test(model)) {
    return { catalog, notes: [`${scope.modelName}: unexpected workspace or model ID; names were not looked up.`], failedActionTypes: ["IMPORT", "EXPORT", "PROCESS"] };
  }
  /** The host the model data service settled on (another data centre after a redirect). */
  let modelHost: string | undefined;

  const moduleIds = new Set<string>();
  for (const ref of refs) {
    if (ref.kind === "module" && ENTITY_ID.test(ref.id)) moduleIds.add(ref.id);
    if (ref.moduleId && ENTITY_ID.test(ref.moduleId)) moduleIds.add(ref.moduleId);
  }
  const readLineItems = async (connection: StompConnection, moduleId: string) => {
    try {
      addLineItems(catalog, moduleId, await connection.subscribe(`core://${ws}:${model}/modules/${moduleId}/lineItems`, { body: {}, timeoutMs: LINE_ITEMS_MS }));
    } catch (error) {
      catalog.unreadableModules.add(moduleId);
      progress.log(`line items of module ${moduleId}: ${message(error)}`);
    }
  };

  try {
    await withSocket(scope.customerId, progress.log, async (connection, host) => {
      modelHost = host;
      let status = "not reported yet";
      let stop: (error: Error) => void = () => undefined;
      const stopped = new Promise<never>((_, reject) => { stop = reject; });
      stopped.catch(() => undefined);
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
      const started = Date.now();
      const waiting = setInterval(() => progress.status(`Reading names in ${scope.modelName}: ${Math.round((Date.now() - started) / 1000)} s, `
        + `model status ${status}. A model that is not open can take a few minutes to load…`), 5_000);
      try {
        progress.status(`Reading names in ${scope.modelName}…`);
        const [views, lists] = await settle(Promise.allSettled([
          connection.subscribe(`core:/${ws}:${model}/moduleViews`, { body: {}, timeoutMs: LOAD_MS }),
          connection.subscribe(`core://${ws}:${model}/lists`, { body: {}, timeoutMs: LOAD_MS }),
        ]));
        clearInterval(waiting);
        if (views.status === "fulfilled") addModuleViews(catalog, views.value); else notes.push(`${scope.modelName}: module and saved view names were not available (${message(views.reason)}).`);
        if (lists.status === "fulfilled") addLists(catalog, lists.value); else notes.push(`${scope.modelName}: list names were not available (${message(lists.reason)}).`);
        progress.status(`Reading line items in ${scope.modelName}…`);
        await settle(inBatches([...moduleIds], 4, moduleId => readLineItems(connection, moduleId)));

        // Context selectors: each section's module dimensions, the list Page Builder's grid section settings read.
        const needs = gridNeeds(pages);
        if (needs.modules.size) {
          progress.status(`Reading module dimensions in ${scope.modelName}…`);
          try {
            const read = addModuleDimensions(catalog, await settle(connection.subscribe(`core://${ws}:${model}/dimensions`,
              { body: { moduleIds: [...needs.modules] }, timeoutMs: LOAD_MS })));
            progress.log(`dimensions of ${read.length} of ${needs.modules.size} modules`);
          } catch (error) {
            if (connection.failed) throw error;
            progress.log(`module dimensions: ${message(error)}`);
            notes.push(`${scope.modelName}: module dimensions were not available (${message(error)}); context selectors show only those saved on the page.`);
          }
        }
        // Names of shown and hidden items, as Page Builder's show/hide chips read them.
        if (needs.items.length) {
          progress.status(`Reading item names in ${scope.modelName}…`);
          await settle(inBatches(needs.items, 4, async ({ moduleId, dimensionId, itemIds }) => {
            try {
              const named = addSelections(catalog, await connection.subscribe(`core://${ws}:${model}/modules/${moduleId}/dimensions/${dimensionId}`,
                { accept: "widget/selection", body: { itemIds, filter: "" }, timeoutMs: LINE_ITEMS_MS }));
              progress.log(`items of dimension ${dimensionId} in module ${moduleId}: ${named} of ${itemIds.length} named`);
            } catch (error) {
              progress.log(`items of dimension ${dimensionId} in module ${moduleId}: ${message(error)}`);
            }
          }));
        }
        // Saved views: rows, columns and context selectors from the metadata Page Builder's grid receives (exploratory:
        // the message types and top-level keys are logged so a live run shows what the service sends).
        const viewIds = [...new Set(refs.filter(ref => ref.kind === "view").map(ref => entityId(ref.id)).filter((id): id is string => !!id))];
        if (viewIds.length) {
          progress.status(`Reading saved view layouts in ${scope.modelName}…`);
          await settle(inBatches(viewIds, 4, async viewId => {
            try {
              const metadata = await connection.subscribe(`core://${ws}:${model}/views/${viewId}`, {
                accept: "widget/grid", messageType: "metadata", timeoutMs: 60_000,
                body: { transforms: [], expandCollapseTransforms: [], clientQueryOptions: { useCellIdTemplate: false, canHandleDedupedAuxData: false, canHandleNullColumnWidths: false } },
                onMessage: (type, keys) => progress.log(`view ${viewId}: ${type} {${keys.join(", ")}}`),
              });
              const layout = viewLayoutFromMetadata(metadata);
              if (layout) catalog.viewLayouts.set(viewId, layout);
              else progress.log(`view ${viewId}: metadata without rows, columns or pages`);
            } catch (error) {
              progress.log(`view ${viewId}: ${message(error)}`);
            }
          }));
          if (catalog.viewLayouts.size < viewIds.length) {
            notes.push(`${scope.modelName}: ${viewIds.length - catalog.viewLayouts.size} of ${viewIds.length} saved views' rows, columns and context selectors could not be read.`);
          }
        }

        // Filters can use a line item from a module no card shows: look through modules that have the filtered dimension.
        const { itemIds, axisDimensionIds } = unresolvedFilterItems(pages.flatMap(page => page.cards), catalog);
        if (!itemIds.size) return;
        const candidates = new Set<string>();
        for (const dimensionId of axisDimensionIds) {
          if (!ENTITY_ID.test(dimensionId)) continue;
          try {
            const json = await settle(connection.subscribe(`core://${ws}:${model}/applicableModules`, { body: { dimensions: [Number(dimensionId)] } }));
            for (const id of applicableModuleIds(catalog, json)) {
              if (ENTITY_ID.test(id) && !catalog.lineItemModules.has(id) && !catalog.unreadableModules.has(id)) candidates.add(id);
            }
          } catch (error) {
            if (connection.failed) throw error;
            progress.log(`modules for dimension ${dimensionId}: ${message(error)}`);
          }
        }
        const extra = [...candidates];
        progress.status(`Finding filter line items in ${scope.modelName}…`);
        for (let i = 0; i < Math.min(extra.length, MAX_EXTRA_MODULES); i += 4) {
          await settle(inBatches(extra.slice(i, Math.min(i + 4, MAX_EXTRA_MODULES)), 4, moduleId => readLineItems(connection, moduleId)));
          if ([...itemIds].every(id => catalog.lineItems.has(id))) break;
        }
        if (extra.length > MAX_EXTRA_MODULES && ![...itemIds].every(id => catalog.lineItems.has(id))) {
          notes.push(`${scope.modelName}: some filter line items were not found in the first ${MAX_EXTRA_MODULES} candidate modules.`);
        }
      } finally {
        clearInterval(waiting);
      }
    });
  } catch (error) {
    notes.push(`${scope.modelName}: names from the model data service were not available (${message(error)}); IDs are shown instead.`);
  }

  // Import, export and process names. A model in another data centre is served from its own host: the page's host
  // answered the first live run with a redirect, which a same-origin read refuses (a network error).
  const actionTypes = new Set(refs.filter(ref => ref.kind === "action").map(ref => ref.actionType));
  for (const [type, key] of [["IMPORT", "imports"], ["EXPORT", "exports"], ["PROCESS", "processes"]] as const) {
    if (!actionTypes.has(type)) continue;
    const path = `/a/collaboration-actions-service/workspaces/${ws}/models/${model}/${key}`;
    const hosts = [...new Set([location.host, ...(modelHost ? [modelHost] : [])])];
    let problem: string | undefined;
    for (const host of hosts) {
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
  progress.log(`${scope.modelName}: ${catalog.modules.size} modules, ${catalog.views.size} saved views, ${catalog.dimensions.size} dimensions, `
    + `${catalog.lineItems.size} line items (${catalog.lineItemModules.size} modules read), ${catalog.actions.size} actions`);
  return { catalog, notes, failedActionTypes };
}

/** File names in the model export's style (asked for by the user, 28 Sep 2026); App Details.csv comes first. */
const DETAILS_FILE = "App Details.csv";
const TAB_FILES: Record<TabName, string> = {
  Pages: "Pages.csv", Cards: "Cards.csv", "Grid sections": "Grid Sections.csv", Filters: "Filters.csv", Formatting: "Conditional Formatting.csv",
  Actions: "Action Buttons.csv", "Where used": "Where Used.csv",
};
const HOW_TO_READ: readonly [detail: string, value: string][] = [
  ["Page and Card #", "Identify a card in every file. Card # counts cards row by row, left to right; Card ID is the stable key."],
  ["View type", "Custom view: a module shaped on the page. Saved view: a saved view or a module's default view, built in the model and only selected on the page. Combined grid: several module sections in one card."],
  ["Set in the model (saved view)", "A saved view's own filters, sorts and show/hide live in the model, not on the page."],
  ["(not in the model)", "A module or line item a card still points at but the model no longer has: deleted, or not visible to you. Search Where Used.csv for it to find the cards."],
  ["Filter context", "Filter-context items show their IDs; their names are not looked up."],
  ["Long IDs", "IDs of 12 or more digits are written as text so Excel shows every digit; the formula bar shows them as =\"…\"."],
];

export async function analyseApp(appGuid: string, progress: Progress, diagnostics: () => string): Promise<TaskResult> {
  if (!GUID.test(appGuid)) throw new Error("Open an app first: the address has no app ID.");
  progress.status("Reading the app…");
  const app = (await getJson(`${DEFINITION}apps/${appGuid}?includeUnpublished=true&includeReportPages=true`, { apiVersion: "2" })) as Obj;
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

  const inputs: PageInput[] = [];
  const described = new Map<PageInput, UxPageCardDetails>();
  for (const [index, entry] of entries.entries()) {
    const pageName = pageNames.get(entry.guid) ?? entry.guid;
    progress.status(`Reading page ${index + 1} of ${entries.length}: ${pageName}`);
    const read = entry.hasPublishedVersion === false ? { state: "Not published" } : await readPublished(entry.guid, declaredType(entry), progress.log);
    const base = { appName, pageName, pageGuid: entry.guid as string, appGuid, publishedAt: undefined as number | string | undefined };
    if ("state" in read) {
      const categoryGuid = text(entry.categoryGuid);
      inputs.push({ ...base, categoryName: categoryOf(categoryGuid, entry), pageType: declaredType(entry) ?? NONE,
        state: read.state, modelName: NONE, workspaceName: NONE, modelId: text(entry.modelId) ?? NONE });
      continue;
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
      described.set(input, describePageCards(type, native));
    } catch (error) {
      input.state = `Not analysed: ${message(error)}`;
    }
    inputs.push(input);
  }

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
    const { catalog, notes, failedActionTypes } = await loadCatalog(scope, group.map(input => described.get(input)!), pageNames, progress);
    summary.push(...notes);
    for (const input of group) {
      const details = described.get(input)!;
      input.details = addDerivedContextSelectors(nameCardDetails(details, resolveFromCatalog(details.references, catalog)), catalog);
      input.dimensionNames = catalog.dimensions;
      input.failedActionTypes = failedActionTypes;
    }
  }

  progress.status("Building the report…");
  const report = buildReport(inputs);
  const encoder = new TextEncoder();
  const analysed = inputs.filter(input => input.details).length;
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
  const details: DetailRow[] = [
    ["App", "App", appName],
    ["App", "App ID", appGuid],
    ["App", "Categories", categoryNames.join("; ") || NONE],
    ["App", "Pages", `${entries.length} (${[...pageTypes].map(([label, count]) => `${count} ${label}${count === 1 ? "" : "s"}`).join(", ")})`],
    ["App", "Pages analysed", `${analysed} of ${inputs.length} (published versions)`],
    ["App", "Cards", cards],
    ["App", "Models", modelsUsed.join("; ") || NONE],
    ...exportRows(location.host),
    ...tabs.map((tab): DetailRow => ["Files", TAB_FILES[tab], `${report[tab].rows.length} rows`]),
    ...inputs.filter(input => !input.details).map((input): DetailRow => ["Notes", input.pageName, input.state]),
    ...(summary.length ? summary.map((note): DetailRow => ["Notes", "Names", note]) : [["Notes", "Names", "All models answered."] as DetailRow]),
    ...HOW_TO_READ.map(([detail, value]): DetailRow => ["How to read", detail, value]),
    ...diagnosticRows(diagnostics()),
  ];
  const files = [
    { name: DETAILS_FILE, data: encoder.encode(toCsv(DETAILS_HEADERS, details)) },
    ...tabs.map(tab => ({ name: TAB_FILES[tab], data: encoder.encode(toCsv(report[tab].headers, report[tab].rows)) })),
  ];
  const date = new Date().toISOString().slice(0, 10);
  return {
    zip: zipStore(files), fileName: `${fileSafe(appName, "app")} - App Export - ${date}.zip`,
    summary: [`${analysed} of ${inputs.length} pages analysed, ${cards} cards.`, ...summary],
  };
}
