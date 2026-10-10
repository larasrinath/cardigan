import { declaredType, loadCatalog, loadCatalogWhen, nameDetails, readPublished, type CatalogInputs, type ModelScope } from "./analyse.js";
import { describePageCards } from "./card-reader/card-details.js";
import type { UxPageCardDetails } from "./card-reader/card-types.js";
import type { UxPageType } from "./card-reader/definition-types.js";
import { emptyCatalog, type ExportedLineItems, type ModelCatalog } from "./catalog.js";
import { diagnosticRows, stampLine, type DetailRow } from "./details.js";
import { separator } from "./map/graph-names.js";
import { FILTER_USES, MODULE_USAGE_FILE, MODULE_USAGE_HEADERS, NOT_ON_A_PAGE, PAGE_ACTIONS_FILE, PAGE_FILTERS_FILE, PAGE_PLACE_HEADERS } from "./page-files.js";
import type { Progress } from "./progress.js";
import { buildReport, HEADERS, NONE, PAGE_TYPE, type Cell, type PageInput } from "./report.js";
import { plainRows } from "./result-plain.js";
import type { AnalysisResult, ResultTable } from "./result-types.js";
import { getJson, RestError } from "./rest.js";
import { AT_A_TIME, eachAtMost, list, message, SCOPE_ID, seconds, stepTimes, text, type Obj } from "./util.js";

/** The pages built on a model, read in the Anaplan tab (content.ts) with the signed-in session and GET only, as an app's
 * pages are read (analyse.ts): Model Building's own list of the pages built on the model, each page's published version,
 * the apps of those pages, and the names in the model that their cards use. From them the model's result gets three
 * tables, Module Usage, Page Filters and Page Actions (page-files.ts), the apps under About this export, and a column in
 * Line Items. Only a card that works on this model counts: one that names no other model, on a page that names this
 * model or none. A button names no model of its own: its card's is the model of its action. Nothing here fails the
 * export: what cannot be read is a note, and a run that is stopped ends as one.
 *
 * Where the tab's address names the customer, the workspace and the model, the pages and the model's names are read
 * beside the model's export, which goes through the model's frame (`startModelPages`): neither needs anything of the
 * export until the line items and the tables, and the three are read by different services. Otherwise they are read
 * after it (`addModelPages`). */

const DEFINITION = "/a/springboard-definition-service/";
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** As many pages, and as many apps, as are read at a time: as many as a run reads of anything at a time (util.ts). */
export { AT_A_TIME };
/** The detail the Details file notes these reads under. */
const ABOUT = "Pages built on the model";
/** As many pages that could not be read as a note names. */
const NAMED_UNREAD = 5;
/** As many lines of its own as this step adds to the result's diagnostic log, the latest: as many as a run's log keeps
 * (tab-port.ts). */
const LOGGED_MAX = 3000;
/** Why the tables are not made where the tab's address names no customer: the classic model page opened on its own,
 * or a Model Building address without one. */
export const NO_CUSTOMER = "the page's address names no customer, and the pages built on a model are listed for its customer";
/** What the Apps detail says when the list of pages built on the model is empty. */
export const NO_APPS = "No app's pages use this model";

/** Page Filters and Page Actions hold an app's Filters and Action Buttons rows, with their app and where their page is
 * (`PAGE_PLACE_HEADERS`), in an order of their own (asked for by the user, 9 Oct 2026). A filter: what filters, the
 * condition line item and its module, then what is filtered, the module and the dimension, then the condition, then
 * where it is, by app, page, card and section, and last the columns that start hidden. A button: the model's action it
 * runs, by name and type, then where it is, by app, page, card and its label, then how it behaves, and last the columns
 * that start hidden. Every column of the app's table is there, and no other but the app and where the page is. */
export const PAGE_FILTERS_HEADERS: readonly string[] = ["Condition line item's module", "Condition line item", "Filtered module", "Filtered dimension", "Operator", "Value",
  "Show items that match", "Condition group", "Condition context", "Filter on", "App", "Page", "Card #", "Section #", ...PAGE_PLACE_HEADERS, "Card ID", "Line item ID"];
export const PAGE_ACTIONS_HEADERS: readonly string[] = ["Model action name", "Action type", "App", "Page", "Card #", "Button label", "Runs automatically", "Cancel button",
  "Name source", ...PAGE_PLACE_HEADERS, "Card ID", "Action ID"];

/** The three files, each with the label the page shows it under: its name without the extension, as the export's are. */
const FILES: readonly [file: string, label: string][] = [[MODULE_USAGE_FILE, "Module Usage"], [PAGE_FILTERS_FILE, "Page Filters"], [PAGE_ACTIONS_FILE, "Page Actions"]];

/** How to read the three tables, as the overview lists them. */
const HOW_TO_READ: readonly [detail: string, value: string][] = [
  ["Module Usage", "Not a Model settings grid: the pages built on this model that use each module. One row for each module and page, in the Modules "
    + "table's order, then by app and page. A page uses a module when a card on it that works on this model shows the module, a saved view of it or "
    + `one of its line items, or filters or formats by one of its line items. A module that no page read uses has one row, which says ${NOT_ON_A_PAGE}. `
    + "After them come the modules a page uses that the Modules table does not list, by their IDs: one marked (not in the model) is one a card "
    + "still points at that the model no longer has, or that you cannot see. Only published pages are read, and only those you can open."],
  ["Page Filters", "The card filters on the pages built on this model, with the columns of an app's Filters table: those of the cards that work on "
    + "this model, by app, page and card. Each row says first what filters, the condition line item's module and the line item, then what it "
    + "filters, the module and the dimension, then the condition, and then where the filter is: its app, page, card and section. "
    + `The ${FILTER_USES} column of Line Items counts the rows that have each line item as `
    + "their condition. It is empty, not 0, where a page could not be read, or a filter's condition line item could not be named: the line item "
    + "may be the condition of that filter."],
  ["Page Actions", "The action buttons on the pages built on this model, with the columns of an app's Action Buttons table: those of the cards that "
    + "work on this model, by app, page and card. Each row says first the model's action a button runs, by name and type, then where the button "
    + "is, by app, page, card and label, and then how it behaves."],
];

/** What the work reads through: a test passes its own. `loadCatalogWhen` reads a model's names before the pages and the
 * export they are read for have come; without it, they are read with `loadCatalog` once those have come. */
export interface PageReads { getJson: typeof getJson; readPublished: typeof readPublished; loadCatalog: typeof loadCatalog; loadCatalogWhen?: typeof loadCatalogWhen }
const LIVE: PageReads = { getJson, readPublished, loadCatalog, loadCatalogWhen };

/** A page that was read, and what its cards are. */
interface ReadPage { type: UxPageType; native: Obj; details: UxPageCardDetails }
/** What reading the pages built on a model gives, before any name: Model Building's list, the entries of it that name a
 * page, the pages that were read, what could not be read and why, and the apps of the pages by their names. Or why the
 * tables are not made at all (`left`). */
interface PagesRead {
  entries: Obj[]; items: Obj[]; pages: ReadPage[]; unread: string[]; unpublished: number;
  appGuids: string[]; appNames: Map<string, string>; appsUnread: number;
}
/** The names a model's catalog gives, with its notes, as `loadCatalog` gives them. */
type Named = { catalog: ModelCatalog; notes: string[]; failedActionTypes: string[] };
const NO_NAMES = (): Named => ({ catalog: emptyCatalog(), notes: [], failedActionTypes: [] });
/** What a page gives the tables: its app and name, where it is (`PAGE_PLACE_HEADERS`, in their order), its rows of the two
 * tables, and the modules it uses. */
interface PageRows { app: string; page: string; place: Cell[]; filters: Cell[][]; actions: Cell[][]; modules: Set<string> }

const byText = (a: string, b: string): number => a.localeCompare(b, undefined, { sensitivity: "base", numeric: true });
const isObj = (value: unknown): value is Obj => !!value && typeof value === "object" && !Array.isArray(value);
const rows = (count: number): string => `${count} rows`;

/** Why the pages could not be read, in a few words for a note. */
function unreadWhy(error: unknown): string {
  if (error instanceof RestError && error.code === "SIGNED_OUT") return "you're signed out of Anaplan";
  if (error instanceof RestError && error.code === "HTTP_ERROR" && error.status === 403) return "Anaplan refused the list of the pages built on this model";
  return `the list of the pages built on this model could not be read (${message(error)})`;
}

/** The result's tables copied, so that what is added here changes nothing the export handed over. */
const copied = (result: AnalysisResult): AnalysisResult => ({
  ...result, summary: [...result.summary],
  tables: result.tables.map(table => ({ ...table, headers: [...table.headers], rows: table.rows.map(row => [...row]) })),
});

/** What is added to the result's Details file, each where its kind of row stands: a file's row after the files', a note
 * after the notes, a How to read row after those, and Apps right after Model ID. */
function addDetails(result: AnalysisResult, added: { files?: DetailRow[]; notes?: DetailRow[]; howToRead?: DetailRow[]; apps?: string }): void {
  const details = result.tables.find(table => table.details === true);
  if (!details) return;
  const lastOf = (section: string): number => details.rows.reduce((at, row, index) => (String(row[0]) === section ? index : at), -1);
  const after = (sections: readonly string[], each: readonly DetailRow[]): void => {
    if (!each.length) return;
    const at = Math.max(...sections.map(lastOf));
    details.rows.splice(at < 0 ? details.rows.length : at + 1, 0, ...plainRows(each));
  };
  after(["Files"], added.files ?? []);
  after(["Notes", "Files"], added.notes ?? []);
  after(["How to read"], added.howToRead ?? []);
  if (added.apps !== undefined) {
    const modelId = details.rows.findIndex(row => String(row[0]) === "Model" && String(row[1]) === "Model ID");
    details.rows.splice(modelId < 0 ? details.rows.length : modelId + 1, 0, ...plainRows([["Model", "Apps", added.apps]]));
  }
}

/** The Line Items table gets a column that counts, for each line item, the Page Filters rows that have it as their
 * condition. A module's own row has none. A line item that no row names is 0 only when every filter is known: where a page
 * could not be read, or a row's condition line item could not be named (it has no module, and the ID stands for its name),
 * the line item may be the condition of a filter, and its cell is empty. */
function addFilterUses(result: AnalysisResult, filters: readonly Cell[][], everyPageRead: boolean): void {
  const table = result.tables.find(each => each.file === "Line Items.csv");
  const moduleAt = table?.headers.indexOf("Module Name") ?? -1;
  if (!table || moduleAt < 0) return;
  const [lineItemAt, itsModuleAt] = [PAGE_FILTERS_HEADERS.indexOf("Condition line item"), PAGE_FILTERS_HEADERS.indexOf("Condition line item's module")];
  const key = (module: string, lineItem: string): string => `${module}\n${lineItem}`;
  const counts = new Map<string, number>();
  let unnamed = false;
  for (const row of filters) {
    const [lineItem, module] = [String(row[lineItemAt] ?? "").trim(), String(row[itsModuleAt] ?? "").trim()];
    if (lineItem === "" || lineItem === NONE) continue;
    if (module === "" || module === NONE) unnamed = true;
    else counts.set(key(module, lineItem), (counts.get(key(module, lineItem)) ?? 0) + 1);
  }
  const none: Cell = everyPageRead && !unnamed ? 0 : "";
  const width = table.headers.length;
  table.headers = [...table.headers, FILTER_USES];
  table.rows = table.rows.map(row => {
    const module = String(row[moduleAt] ?? "").trim();
    const count = module === "" ? "" : counts.get(key(module, String(row[0] ?? "").trim())) ?? none;
    // The cell goes in the column's place: a row may be short of the headers, or hold cells beyond them.
    const cells: Cell[] = [...row];
    while (cells.length < width) cells.push("");
    cells.splice(width, 0, count);
    return cells;
  });
}

/** The three tables are not made, and the result says why, as the export says it of a file it could not make: a line of
 * the summary and a Files row for each. The Line Items column is there, empty: nothing is known of the filters. */
function leftOut(result: AnalysisResult, why: string): AnalysisResult {
  result.summary.push(...FILES.map(([, label]) => `${label}: not exported (${why}).`));
  addDetails(result, { files: FILES.map(([file]): DetailRow => ["Files", file, `Not exported: ${why}`]) });
  addFilterUses(result, [], false);
  return result;
}

/** A Details value of the result's Model section, such as its Workspace ID. */
function modelDetail(result: AnalysisResult, detail: string): string | undefined {
  const row = result.tables.find(table => table.details === true)?.rows.find(each => String(each[0]) === "Model" && String(each[1]) === detail);
  return row === undefined ? undefined : String(row[2] ?? "");
}

/** The modules of the export's Modules table, in its order: each row's name, but for a heading's. */
function exportedModules(result: AnalysisResult): string[] {
  const table = result.tables.find(each => each.file === "Modules.csv");
  return (table?.rows ?? []).map(row => String(row[0] ?? "").trim()).filter(name => !separator(name));
}

/** Module Usage's rows: each module of the export in its order, with the pages that use it, and after them the modules the
 * pages use that the export does not list. A module that no page uses has its one row, with no page to say where it is. */
function moduleUsageRows(exported: readonly string[], pages: readonly PageRows[]): Cell[][] {
  const uses = new Map<string, PageRows[]>();
  for (const page of pages) {
    for (const module of page.modules) uses.set(module, [...(uses.get(module) ?? []), page]);
  }
  const rowsOf = (module: string): Cell[][] => {
    const at = uses.get(module);
    return at?.length ? at.map(page => [module, page.app, page.page, ...page.place]) : [[module, NONE, NOT_ON_A_PAGE, ...PAGE_PLACE_HEADERS.map(() => NONE)]];
  };
  const listed = new Set(exported);
  const rest = [...uses.keys()].filter(module => !listed.has(module)).sort(byText);
  return [...[...listed].flatMap(rowsOf), ...rest.flatMap(rowsOf)];
}

/** A module's ID: its entity type, 102, and nine digits more (model/export.ts `moduleIdsOf`). */
const MODULE_ID = /^102\d{9}$/;

/** The model's line items as the export read them: each row of the result's Line Items table with the IDs the export gave
 * for it (`ids`, one pair for each row, in the table's order: the row's own ID, and the ID of a line item's module, which a
 * module's own row has none of). A line item is named as the table names it, and its format is the table's Format, the
 * classic client's definition, as the line items listing gives it. Every module of the table counts, one without line items
 * too. Nothing where the IDs do not fit the table, row for row: the log says so, and the pages' names are read as before. */
export function exportedLineItems(result: AnalysisResult, ids: readonly (readonly [string, string])[], log: (line: string) => void): ExportedLineItems | undefined {
  const table = result.tables.find(each => each.file === "Line Items.csv");
  if (!table || table.rows.length !== ids.length) {
    log(`line items: the export's IDs do not fit its Line Items table (${ids.length} IDs, ${table ? `${table.rows.length} rows` : "no table"}): every module the pages use is read from the listing`);
    return undefined;
  }
  const formatAt = table.headers.indexOf("Format");
  const lineItems: ExportedLineItems["lineItems"] = [];
  const modules = new Set<string>();
  table.rows.forEach((row, index) => {
    const [id, moduleId] = ids[index];
    if (moduleId === "") {
      if (MODULE_ID.test(id)) modules.add(id);
      return;
    }
    const name = String(row[0] ?? "");
    const cell = formatAt > 0 ? String(row[formatAt] ?? "") : "";
    let format: Obj | undefined;
    if (cell.startsWith("{")) {
      try {
        const parsed: unknown = JSON.parse(cell);
        format = isObj(parsed) ? parsed : undefined;
      } catch {
        format = undefined;
      }
    }
    modules.add(moduleId);
    if (name !== "") lineItems.push({ id, name, moduleId, ...(format ? { format } : {}) });
  });
  return { lineItems, modules: [...modules] };
}

/** The step's own lines after the export's in the result's diagnostic log: the export wrote that log in the model's page
 * before this step began, and it is what the Overview copies, a refresh too. */
function addLog(result: AnalysisResult, logged: readonly string[]): AnalysisResult {
  result.tables.find(table => table.details === true)?.rows.push(...plainRows(logged.flatMap(diagnosticRows)));
  return result;
}

/** The model's result with what the pages built on the model say: the three tables (page-files.ts), the apps under About
 * this export, the Line Items column, and the notes and How to read rows. `customerId` is the customer the Model Building
 * address names; without one, the tables are not made, and a note says why. The export was made before any of this is
 * read, so nothing here fails it: whatever goes wrong, but for a stop, leaves the three tables out with the reason. What
 * the step reports goes into the result's diagnostic log as well. `lineItemIds` are the IDs the export gave for the rows
 * of its Line Items table (content.ts takes them off its result): the names the cards use are then read with the line
 * items they make (`exportedLineItems`), and the modules of those are not read again. */
export async function addModelPages(given: AnalysisResult, customerId: string | undefined, progress: Progress, signal?: AbortSignal,
  reads: PageReads = LIVE, lineItemIds?: readonly (readonly [string, string])[]): Promise<AnalysisResult> {
  signal?.throwIfAborted();
  const logged: string[] = [];
  const keep = (line: string): void => {
    logged.push(stampLine(line));
    if (logged.length > LOGGED_MAX) logged.splice(0, logged.length - LOGGED_MAX);
  };
  const step: Progress = { status: text => { keep(text); progress.status(text); }, log: line => { keep(line); progress.log(line); } };
  try {
    return addLog(await withModelPages(copied(given), customerId, step, signal, reads, lineItemIds), logged);
  } catch (error) {
    if (signal?.aborted) throw signal.reason;
    step.log(`pages built on the model: ${message(error)}`);
    // From the export as it was handed over: the failed work may have added to its copy already.
    try {
      return addLog(leftOut(copied(given), error instanceof RestError ? unreadWhy(error) : `Cardigan could not make them: ${message(error)}`), logged);
    } catch {
      return given;
    }
  }
}

/** What a model's run started of the pages built on the model, before its export came (`startModelPages`). */
export interface ModelPagesStart {
  /** The model's result with what the pages built on it say, once its export has come, as `addModelPages` gives it. */
  finish(given: AnalysisResult, lineItemIds?: readonly (readonly [string, string])[]): Promise<AnalysisResult>;
  /** The export failed, or the run was stopped: what was started is given up, and nothing more is read for it. */
  abandon(reason: unknown): void;
}

/** What the tab's address says of the model: its customer, workspace and ID, and the host of the frame it is read in. */
export interface ModelPagesIds { customerId?: string; workspaceId?: string; modelId: string; frameHost?: () => string | undefined }

/** How a model's run reads the names its pages use: without the saved views' layouts, which only an app's Cards and Grid
 * Sections tables show (analyse.ts `LoadOptions`). */
const MODEL_NAMES = { viewLayouts: false } as const;

/** The name a model's name reads go by until its export has come, which names the model. */
const UNTIL_NAMED = "this model";

/** Starts reading the pages built on a model at once, beside its export (content.ts): the list, each page, the apps, and
 * the model's names. The pages and the first of the names need nothing of the export; the rest of the names wait for it
 * (analyse.ts `loadCatalogWhen`), and the tables are made once it has come (`finish`). Until then the export's status is
 * the one the results page shows: this step's is kept, and the latest is shown once the export has come. What it logs
 * goes to the run's log as it happens, and after the export's lines in the result's diagnostic log. It needs the customer,
 * the workspace and the model, from the tab's address: without them, or where the export names another workspace or
 * model, the pages are read after the export, as `addModelPages` reads them. A line of the log says how long the export,
 * the pages and the names took, and the run in all. */
export function startModelPages(ids: ModelPagesIds, progress: Progress, signal?: AbortSignal, reads: PageReads = LIVE): ModelPagesStart {
  const { customerId, workspaceId, modelId } = ids;
  const after: ModelPagesStart = { finish: (given, lineItemIds) => addModelPages(given, customerId, progress, signal, reads, lineItemIds), abandon: () => undefined };
  if (!customerId || !SCOPE_ID.test(customerId) || !workspaceId || !SCOPE_ID.test(workspaceId) || !SCOPE_ID.test(modelId) || signal?.aborted) return after;

  const began = Date.now();
  const logged: string[] = [];
  const keep = (line: string): void => {
    logged.push(stampLine(line));
    if (logged.length > LOGGED_MAX) logged.splice(0, logged.length - LOGGED_MAX);
  };
  let [shown, held] = [false, undefined as string | undefined];
  const step: Progress = { status: text => { keep(text); if (shown) progress.status(text); else held = text; }, log: line => { keep(line); progress.log(line); } };
  // A stopped run stops what was started; so does an export that failed (`abandon`).
  const background = new AbortController();
  const stop = (): void => background.abort(signal?.reason);
  signal?.addEventListener("abort", stop, { once: true });
  const time = stepTimes();
  const scope: ModelScope = { customerId, workspaceId, modelId, modelName: UNTIL_NAMED };
  let came: (export_: { given: AnalysisResult; lineItemIds?: readonly (readonly [string, string])[] }) => void = () => undefined;
  let failed: (reason: unknown) => void = () => undefined;
  const exportCame = new Promise<{ given: AnalysisResult; lineItemIds?: readonly (readonly [string, string])[] }>((resolve, reject) => { came = resolve; failed = reject; });
  exportCame.catch(() => undefined);

  let [pagesMs, namesMs] = [0, 0];
  const pagesWork = (async () => {
    const from = Date.now();
    try {
      return await readPagesOf(customerId, modelId, step, background.signal, reads, time);
    } finally {
      pagesMs = Date.now() - from;
    }
  })();
  pagesWork.catch(() => undefined);
  const loadWhen: typeof loadCatalogWhen = reads.loadCatalogWhen
    ?? ((on, inputs, progressOf, signalOf, options) => inputs.then(({ pages, pageNames, exported }) => reads.loadCatalog(on, pages, pageNames, progressOf, signalOf, exported, options)));
  const namesWork = pagesWork.then(async (read): Promise<Named> => {
    if ("left" in read || !read.pages.length) return NO_NAMES();
    const inputs = exportCame.then(({ given, lineItemIds }): CatalogInputs => {
      const exported = lineItemIds ? exportedLineItems(given, lineItemIds, step.log) : undefined;
      return { pages: read.pages.map(page => page.details), pageNames: pageNamesOf(read), ...(exported ? { exported } : {}) };
    });
    const from = Date.now();
    try {
      return await time.step("names", () => loadWhen(scope, inputs, step, background.signal, { ...MODEL_NAMES, frameHost: ids.frameHost }));
    } finally {
      namesMs = Date.now() - from;
    }
  });
  namesWork.catch(() => undefined);

  const abandon = (reason: unknown): void => {
    failed(reason);
    background.abort(reason);
    signal?.removeEventListener("abort", stop);
  };
  return {
    abandon,
    finish: async (given, lineItemIds) => {
      const exportMs = Date.now() - began;
      shown = true;
      if (held !== undefined) progress.status(held);
      // An export of another workspace or model than the address named: the pages are read for the export's, after it.
      const [itsWorkspace, itsModel] = [modelDetail(given, "Workspace ID") ?? "", given.id];
      if (itsWorkspace.toLowerCase() !== workspaceId.toLowerCase() || itsModel.toLowerCase() !== modelId.toLowerCase()) {
        abandon(new Error("the export is of another workspace or model than the tab's address names"));
        return after.finish(given, lineItemIds);
      }
      scope.modelName = given.name;
      came({ given, ...(lineItemIds ? { lineItemIds } : {}) });
      try {
        const result = copied(given);
        const read = await pagesWork;
        if ("left" in read) return addLog(leftOut(result, read.left), logged);
        const named = await namesWork;
        signal?.throwIfAborted();
        const built = tablesOf(result, read, named, step, time, [given.name, UNTIL_NAMED]);
        step.log(`Run: export ${seconds(exportMs)}, pages ${seconds(pagesMs)}, names ${seconds(namesMs)}, overlapped; in all ${seconds(Date.now() - began)}`);
        return addLog(built, logged);
      } catch (error) {
        if (signal?.aborted) throw signal.reason;
        step.log(`pages built on the model: ${message(error)}`);
        // From the export as it was handed over: the failed work may have added to its copy already.
        try {
          return addLog(leftOut(copied(given), error instanceof RestError ? unreadWhy(error) : `Cardigan could not make them: ${message(error)}`), logged);
        } catch {
          return given;
        }
      } finally {
        signal?.removeEventListener("abort", stop);
      }
    },
  };
}

async function withModelPages(result: AnalysisResult, customerId: string | undefined, progress: Progress, signal: AbortSignal | undefined,
  reads: PageReads, lineItemIds: readonly (readonly [string, string])[] | undefined): Promise<AnalysisResult> {
  const workspaceId = modelDetail(result, "Workspace ID");
  if (!customerId || !SCOPE_ID.test(customerId)) return leftOut(result, NO_CUSTOMER);
  if (!workspaceId || !SCOPE_ID.test(workspaceId) || !SCOPE_ID.test(result.id)) return leftOut(result, "the model's workspace or model ID could not be read");

  /** How long each step took: the log's one line on it comes once the tables are made. */
  const time = stepTimes();
  const read = await readPagesOf(customerId, result.id, progress, signal, reads, time);
  if ("left" in read) return leftOut(result, read.left);

  // The names the cards use, from this model, as an app's pages are named. The line items the export read stand for the
  // listing's, so that the modules the cards use are not read again.
  const scope: ModelScope = { customerId, workspaceId, modelId: result.id, modelName: result.name };
  const exported = read.pages.length && lineItemIds ? exportedLineItems(result, lineItemIds, progress.log) : undefined;
  const named = read.pages.length
    ? await time.step("names", () => reads.loadCatalog(scope, read.pages.map(page => page.details), pageNamesOf(read), progress, signal, exported, MODEL_NAMES))
    : NO_NAMES();
  signal?.throwIfAborted();
  return tablesOf(result, read, named, progress, time, [result.name]);
}

/** The pages' names by their IDs, as the catalog names a page. */
const pageNamesOf = (read: PagesRead): Map<string, string> => new Map(read.pages.map(page => [page.details.pageGuid, page.details.name]));

/** Model Building's list of the pages built on the model, each page's published version, a few at a time in the list's
 * order, and the apps of those pages. A failed read of the list ends here, as does a session that has ended (it is
 * rethrown, and `addModelPages` says why the tables are not made); a list in a form Cardigan does not read gives `left`. */
async function readPagesOf(customerId: string, modelId: string, progress: Progress, signal: AbortSignal | undefined, reads: PageReads,
  time: ReturnType<typeof stepTimes>): Promise<PagesRead | { left: string }> {
  progress.status("Reading the pages built on this model…");
  const answer = await time.step("list of pages", () => reads.getJson(`${DEFINITION}customer/${customerId}/model/${modelId}/pages`));
  const listed = Array.isArray(answer) ? answer : isObj(answer) && Array.isArray(answer.items) ? answer.items : undefined;
  if (!listed) {
    progress.log(`pages built on the model: the answer has no list of pages (${typeof answer})`);
    return { left: "Anaplan's list of the pages built on this model was not in a form Cardigan reads" };
  }
  const entries = list(listed);
  // The entries' fields, never their values: a live run's log shows what Model Building's list holds.
  progress.log(`pages built on the model: ${entries.length} entries; their fields: ${[...new Set(entries.flatMap(Object.keys))].sort().join(", ") || "none"}`
    + (isObj(answer) && typeof answer.isPageBuilder === "boolean" ? `; isPageBuilder ${answer.isPageBuilder}` : ""));

  // An entry that names no page is one that could not be read; an entry for a page listed already says nothing more.
  const unread: string[] = [];
  const seen = new Set<string>();
  const items = entries.filter(entry => {
    const guid = typeof entry.guid === "string" && GUID.test(entry.guid) ? entry.guid.toLowerCase() : undefined;
    if (!guid) unread.push(`${text(entry.name) ?? "an entry of the list"} (no page ID)`);
    if (!guid || seen.has(guid)) return false;
    seen.add(guid);
    return true;
  });

  // Each page's published version, a few at a time, in the list's order. A session that has ended ends the reads.
  const read: (ReadPage | undefined)[] = new Array(items.length);
  let [done, unpublished] = [0, 0];
  await time.step(`${items.length} pages, ${AT_A_TIME} at a time`, () => eachAtMost(items, AT_A_TIME, signal, async (item, index) => {
    const guid = item.guid as string;
    const page = item.hasPublishedVersion === false ? { state: "Not published" } : await reads.readPublished(guid, declaredType(item), progress.log);
    progress.status(`Reading the pages built on this model: ${++done} of ${items.length}`);
    if ("state" in page) {
      if (page.state === "Not published") unpublished++;
      else unread.push(`${text(item.name) ?? guid} (${page.state.replace(/^Not analysed: /, "")})`);
      return;
    }
    try {
      read[index] = { type: page.type, native: page.native, details: describePageCards(page.type, page.native) };
    } catch (error) {
      unread.push(`${text(page.native.name) ?? text(item.name) ?? guid} (${message(error)})`);
    }
  }));
  const pages = read.filter((page): page is ReadPage => page !== undefined);

  // The apps of the pages, by the name each app's record gives.
  const appGuids = [...new Set([...items.map(item => text(item.appGuid)), ...pages.map(page => page.details.appGuid)]
    .filter((guid): guid is string => !!guid && GUID.test(guid)).map(guid => guid.toLowerCase()))];
  const appNames = new Map<string, string>();
  let appsUnread = 0;
  if (appGuids.length) progress.status(`Reading the apps of the pages built on this model: ${appGuids.length}`);
  await time.step(`${appGuids.length} apps`, () => eachAtMost(appGuids, AT_A_TIME, signal, async guid => {
    try {
      const app = await reads.getJson(`${DEFINITION}apps/${guid}?includeUnpublished=true&includeReportPages=true`, { apiVersion: "2" });
      const name = text(isObj(app) ? app.name : undefined);
      if (name) appNames.set(guid, name);
      else appsUnread++;
    } catch (error) {
      if (error instanceof RestError && error.code === "SIGNED_OUT") throw error;
      appsUnread++;
      progress.log(`app ${guid}: ${message(error)}`);
    }
  }));
  return { entries, items, pages, unread, unpublished, appGuids, appNames, appsUnread };
}

/** The three tables, the Line Items column, and the notes and details, from the pages that were read and the names of the
 * model. The export read every module's name and ID from the model itself: a module the model data service did not name
 * is named by them. A note of the name reads that begins with the model's name (any of `names`, as the reads called it)
 * loses it here, where the model is the one the notes are about. */
function tablesOf(result: AnalysisResult, read: PagesRead, named: Named, progress: Progress, time: ReturnType<typeof stepTimes>, names: readonly string[]): AnalysisResult {
  const { entries, items, pages, unread, unpublished, appGuids, appNames, appsUnread } = read;
  const appName = (guid: string): string => appNames.get(guid.toLowerCase()) ?? guid;
  for (const [module, id] of result.moduleIds ?? []) if (!named.catalog.modules.has(id)) named.catalog.modules.set(id, module);
  progress.status("Building the tables of the pages built on this model…");
  const model = result.id.toLowerCase();
  const built: PageRows[] = pages.map(({ type, native, details }) => {
    const app = appName(details.appGuid);
    const page = text(native.name) ?? details.name ?? details.pageGuid;
    const info: Obj = isObj(native.modelInfo) ? native.modelInfo : {};
    const input: PageInput = {
      appName: app, categoryName: NONE, pageName: page, pageType: type, pageGuid: details.pageGuid, appGuid: details.appGuid,
      state: native.currentDraftVersionGuid === native.currentPublishedVersionGuid ? "Published (no unpublished changes)" : "Published, draft differs",
      modelName: text(info.modelName) ?? NONE, workspaceName: text(info.workspaceName) ?? NONE, modelId: text(native.modelId) ?? NONE,
      publishedAt: typeof native.publishedAt === "number" || typeof native.publishedAt === "string" ? native.publishedAt : undefined,
      details: nameDetails(details, named.catalog), dimensionNames: named.catalog.dimensions, failedActionTypes: named.failedActionTypes,
    };
    // Every card is reported, so that each keeps the number the app's own tables give it; only this model's rows are kept.
    const report = buildReport([input]);
    const pageModel = (details.modelId ?? "").toLowerCase();
    const ours = new Set(details.cards.filter(card => {
      const its = (card.modelId ?? pageModel).toLowerCase();
      return its === "" || its === model;
    }).map(card => card.id));
    // Where the page is: its type in an app's Pages table's words, its app's ID and its own.
    const place: Cell[] = [PAGE_TYPE[type] ?? NONE, details.appGuid || NONE, details.pageGuid || NONE];
    const own: ReadonlyMap<string, Cell> = new Map<string, Cell>([["App", app], ...PAGE_PLACE_HEADERS.map((header, index): [string, Cell] => [header, place[index]])]);
    /** This model's rows of one of the app's tables (`from`, its headers), each laid out in the columns `to` names: each
     * cell under its own header, and the app and where the page is under theirs. */
    const kept = (to: readonly string[], from: readonly string[], each: readonly Cell[][]): Cell[][] => {
      const cardId = from.indexOf("Card ID");
      const at = to.map(header => from.indexOf(header));
      return each.filter(row => ours.has(String(row[cardId]))).map(row => to.map((header, index) => (at[index] >= 0 ? row[at[index]] : own.get(header)) ?? ""));
    };
    // A use names its card by its number: the Cards rows say which card has which.
    const [numberAt, idAt] = [HEADERS.Cards.indexOf("Card #"), HEADERS.Cards.indexOf("Card ID")];
    const cardOf = new Map(report.Cards.rows.map(row => [String(row[numberAt]), String(row[idAt])]));
    const used = HEADERS["Where used"];
    const [typeAt, nameAt, moduleAt, cardAt] = [used.indexOf("Object type"), used.indexOf("Object name"), used.indexOf("Object's module"), used.indexOf("Card #")];
    const modules = new Set<string>();
    for (const row of report["Where used"].rows) {
      if (!ours.has(cardOf.get(String(row[cardAt])) ?? "")) continue;
      const kind = String(row[typeAt]);
      const module = String(kind === "Module" ? row[nameAt] : kind === "Saved view" || kind === "Line item" ? row[moduleAt] : NONE).trim();
      if (module !== "" && module !== NONE) modules.add(module);
    }
    return { app, page, place, filters: kept(PAGE_FILTERS_HEADERS, HEADERS.Filters, report.Filters.rows), actions: kept(PAGE_ACTIONS_HEADERS, HEADERS.Actions, report.Actions.rows), modules };
  }).sort((a, b) => byText(a.app, b.app) || byText(a.page, b.page));

  const usage = moduleUsageRows(exportedModules(result), built);
  const filters = built.flatMap(page => page.filters);
  const actions = built.flatMap(page => page.actions);
  const counted: Record<string, Cell[][]> = { [MODULE_USAGE_FILE]: usage, [PAGE_FILTERS_FILE]: filters, [PAGE_ACTIONS_FILE]: actions };
  const headers: Record<string, readonly string[]> = { [MODULE_USAGE_FILE]: MODULE_USAGE_HEADERS, [PAGE_FILTERS_FILE]: PAGE_FILTERS_HEADERS, [PAGE_ACTIONS_FILE]: PAGE_ACTIONS_HEADERS };
  result.tables.push(...FILES.map(([file, label]): ResultTable => ({ file, label, headers: [...headers[file]], rows: plainRows(counted[file]), guard: true })));
  addFilterUses(result, filters, unread.length === 0);

  // The model's name starts a note of the name reads: here it is this model's.
  const notes: string[] = [
    ...(unpublished ? [`${unpublished} of the ${items.length} pages built on this model ${unpublished === 1 ? "has" : "have"} no published version, so ${unpublished === 1 ? "it is" : "they are"} not in these tables.`] : []),
    ...(unread.length ? [`${unread.length} ${unread.length === 1 ? "page" : "pages"} could not be read, so a module on ${unread.length === 1 ? "it" : "one of them"} may show as ${NOT_ON_A_PAGE.toLowerCase()}: `
      + `${unread.slice(0, NAMED_UNREAD).join("; ")}${unread.length > NAMED_UNREAD ? `; and ${unread.length - NAMED_UNREAD} more` : ""}.`] : []),
    ...(appsUnread ? [`The names of ${appsUnread} ${appsUnread === 1 ? "app" : "apps"} could not be read: ${appsUnread === 1 ? "it is" : "they are"} shown by ID.`] : []),
    ...named.notes.map(note => names.reduce((said, name) => (said === note && note.startsWith(`${name}: `) ? note.slice(name.length + 2) : said), note)),
  ];
  result.summary.push(...FILES.map(([file, label]) => `${label}: ${rows(counted[file].length)}`), ...notes.map(note => `${ABOUT}: ${note}`));
  // The apps the list's pages are in. Without a page to tell them by, the apps are not known, and none are said.
  const apps = [...new Set(appGuids.map(appName))].sort(byText);
  addDetails(result, {
    files: FILES.map(([file]): DetailRow => ["Files", file, rows(counted[file].length)]),
    notes: notes.map((note): DetailRow => ["Notes", ABOUT, note]),
    howToRead: HOW_TO_READ.map(([detail, value]): DetailRow => ["How to read", detail, value]),
    ...(entries.length === 0 ? { apps: NO_APPS } : apps.length ? { apps: apps.join("\n") } : {}),
  });
  progress.log(`pages built on the model: ${pages.length} read, ${unpublished} unpublished, ${unread.length} not read; ${apps.length} apps; `
    + `${usage.length} module usage rows, ${filters.length} page filters, ${actions.length} page actions`);
  progress.log(time.line());
  return result;
}
