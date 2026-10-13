import { Failure, REFRESH, SEND_LOG, type Log, type Stop } from "../progress.js";
import { message, SCOPE_ID, seconds, sleep } from "../util.js";
import { labelEntries, placesSaid, plainText, thousands, windowRows, type Grid, type GridRow } from "./grid.js";

/** Reads Model settings grids through the classic model building client, the way its own settings tabs do: a
 * MODEL_DEFINITION view of a row axis against a property-column axis (evidence: anaplan/settings/*.js).
 * Runs in the page's main world. Read-only by construction: requests are built only by the client's
 * view request generator, checked to carry no submissions, system actions or model summaries, and the page's model
 * cache is never updated from these reads. */

// The classic client is an untyped AMD module graph.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

export interface Native {
  cache: Any; aggregator: Any; helper: Any; ids: Any; constants: Any; RequestGenerator: Any; DataPage: Any; axisHelper: Any;
  workspaceId: string; modelId: string;
}

const MODULES = ["anaplan/data/ModelContentCache", "anaplan/data/Aggregator", "anaplan/data/ModelContentHelper", "anaplan/utils/EntityLongIdHelper",
  "anaplan/constants", "anaplan/data/ViewRequestRequestGenerator", "anaplan/data/DataPageCache/_DataPage", "anaplan/utils/AxisHelper"];
/** Cells requested per read, so large models are read in pages. */
const CELLS_PER_READ = 40_000;
/** The columns the first page of a grid is sized for, before the grid has said how many it has: more than any Model
 * settings grid has (Line Items, the widest, has 27). The pages after it are sized for the grid's own. */
const FIRST_PAGE_COLUMNS = 30;
const MAX_ROWS = 250_000;
/** How many reads in a row the model may refuse, with none answered between them, before a grid is given up: by then it
 * refuses every read, not one part of the grid. */
const REFUSED_IN_A_ROW = 12;
/** How long a read waits for the model's answer. With the wait for the page to be idle before it (`waitIdle`), that is less
 * than the time the page waits for a frame that sends nothing (bridge.ts `runInCore`), so a read the model never answers
 * ends as a failed read, not as a frame that has gone. */
const READ_TIMEOUT_MS = 180_000;
/** What the user is told when the page's client cannot be used (progress.ts `Failure`). */
const NOT_OPEN = "The model has not finished opening in the Anaplan tab. Wait until it shows, then choose Run again.";
const NO_CLIENT = `Cardigan could not read this model page. ${REFRESH} ${SEND_LOG}`;

/** The classic model building page exposes its AMD loader and the open model on window. */
export function modelOnPage(): string | undefined {
  const w = window as Any;
  return typeof w.require === "function" && typeof w.modelId === "string" && SCOPE_ID.test(w.modelId)
    && typeof w.workspaceId === "string" && SCOPE_ID.test(w.workspaceId) ? w.modelId : undefined;
}

export function loadNative(timeoutMs = 30_000): Promise<Native> {
  const w = window as Any;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Failure(NOT_OPEN, `the model page's client did not load in ${timeoutMs / 1000} s`)), timeoutMs);
    const unavailable = () => { clearTimeout(timer); reject(new Failure(NO_CLIENT, "the model page's client modules are not available")); };
    try {
      w.require(MODULES, (cache: Any, aggregator: Any, helper: Any, ids: Any, constants: Any, RequestGenerator: Any, DataPage: Any, axisHelper: Any) => {
        clearTimeout(timer);
        resolve({ cache, aggregator, helper, ids, constants, RequestGenerator, DataPage, axisHelper, workspaceId: w.workspaceId, modelId: w.modelId });
      }, unavailable);
    } catch { unavailable(); }
  });
}

/** A named system axis (`SYSTEM_AXIS_IDENTIFIER_<name>_IDENTIFIER`). */
export function axis(native: Native, name: string): string {
  const value = native.constants[`SYSTEM_AXIS_IDENTIFIER_${name}_IDENTIFIER`];
  if (typeof value !== "string") throw new Error(`This model page has no ${name} axis.`);
  return value;
}

/** Wait while the page has its own requests in flight (for example the user's pending edits). */
async function waitIdle(native: Native): Promise<void> {
  const until = Date.now() + 15_000;
  while (native.aggregator.isDirty?.()) {
    if (Date.now() > until) throw new Error("The model page is busy; try again when it is idle.");
    await sleep(50);
  }
}

export function assertRead(request: Any): void {
  if (!request || typeof request !== "object" || (request.requestType !== undefined && request.requestType !== "VIEW_REQUEST_SET")
      || (Array.isArray(request.submissions) && request.submissions.length) || (Array.isArray(request.systemActions) && request.systemActions.length)
      || request.fetchAllModelSummaries) {
    throw new Error("Refusing to send anything but a read.");
  }
}

/** How much of the model's own words on a refused read the error and the log keep: the start of them. */
const REASON_SAID = 200;
/** The fields of a refusal that say why in words, and then those that name its kind, each looked for in this order. */
const REASON_WORDS = ["message", "errorMessage", "localizedMessage", "reason", "description", "detail"];
const REASON_KINDS = ["errorCode", "code", "errorType", "type", "status"];
/** The fields of a refusal never said where it is said whole: what was asked, an address, a session's secrets, a stack, and
 * the IDs of the model, its workspace, its customer and its user. */
const UNSAID = /request|^ur[il]|ur[il]s?$|href|session|token|cookie|password|stack|^(?:model|workspace|customer|tenant|user)(?:Id|Guid)?$/i;
/** An address, with its scheme or as a path of two parts or more; an ID of the shape of a customer's or a request's; and one
 * of the shape of a model's or a workspace's (util.ts `SCOPE_ID`). */
const ADDRESS = /\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>()]+|(?<![\w:])\/\/[^\s"'<>()]+|\bwww\.[^\s"'<>()]+|(?<![\w:./])\/[\w.~%-]+(?:\/[\w.~%-]*)+(?:\?[^\s"'<>()]*)?/gi;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const SCOPE_IDS = /(?<![0-9A-Za-z])[0-9A-Za-z]{32}(?![0-9A-Za-z])/g;

/** What a refusal says, before it is made plain: its words, with its kind after them where it names one; else its kind; else
 * all of it as JSON, but for the fields never said. Nothing for anything else. */
function refusalText(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (!value || typeof value !== "object") return undefined;
  const field = (keys: readonly string[]): string | undefined => {
    for (const key of keys) {
      const found: unknown = (value as Record<string, unknown>)[key];
      if (typeof found === "string" && found.trim() !== "") return found.trim();
      if (typeof found === "number" && Number.isFinite(found)) return String(found);
    }
    return undefined;
  };
  const words = field(REASON_WORDS);
  const kind = field(REASON_KINDS);
  if (words) return kind && !words.includes(kind) ? `${words} (${kind})` : words;
  return kind ?? JSON.stringify(value, (key, field: unknown) => (key !== "" && UNSAID.test(key) ? undefined : field));
}

/** The model's own words on why it refused a read (an answer's `error`, or its `errorInfo`), as plain text of one line: no
 * markup, no address, and no ID of a model, a workspace, a customer or a request, each put as a word in its place; then cut
 * to its first 200 characters. Nothing where it says nothing. It never throws: it runs inside the client's callback, which
 * must always settle the read. */
function reasonOf(value: unknown, native: Native): string | undefined {
  try {
    const text = refusalText(value);
    if (text === undefined) return undefined;
    let said = plainText(text.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]*>/g, " ")).replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, " ").replace(ADDRESS, "[address]");
    for (const id of [native.modelId, native.workspaceId]) {
      if (typeof id === "string" && id.length >= 8) said = said.replace(new RegExp(id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), "[ID]");
    }
    said = said.replace(UUID, "[ID]").replace(SCOPE_IDS, "[ID]").replace(/\s+/g, " ").trim();
    const characters = Array.from(said);
    return said === "" ? undefined : characters.length > REASON_SAID ? `${characters.slice(0, REASON_SAID - 1).join("").trimEnd()}…` : said;
  } catch {
    return undefined;
  }
}

/** A read the model answered with a refusal, or with no grid. The message says which, and the model's words on why where
 * it gave any (`reasonOf`); `said` gives those words, or what it gave in their place, for a line of the log. */
class Refusal extends Error {
  readonly said: string;
  constructor(what: string, instead: string, reason: string | undefined) {
    super(reason ? `${what}: ${reason}${/[.!?…]$/.test(reason) ? "" : "."}` : `${what}.`);
    this.said = reason ?? instead;
  }
}

/** A grid that failed once its first page was read, as the read that failed says it, with the columns that page gave: a
 * model's Line Items says its engine by them (model-engine.ts), also where its rows could not be read. */
export class GridFailure extends Error {
  constructor(message: string, readonly columns: readonly string[], options?: ErrorOptions) { super(message, options); }
}

function post(native: Native, request: Any): Promise<Any> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => { settled = true; reject(new Error("Timed out waiting for the model.")); }, READ_TIMEOUT_MS);
    native.aggregator.post(request, false, (response: Any) => {
      if (settled) return true;
      settled = true;
      clearTimeout(timer);
      if (!response?.result || response.error || response.result.errorInfo) {
        reject(new Refusal("The model rejected the read", "no reason given", reasonOf(response?.error, native) ?? reasonOf(response?.result?.errorInfo, native)));
      } else resolve(response.result);
      return true;
    }, () => {
      if (!settled) { settled = true; clearTimeout(timer); reject(new Error("The read did not reach the model.")); }
      return true;
    });
  });
}

async function readWindow(native: Native, viewDefinition: Any, startRow: number, rowCount: number, selectorLabels = false): Promise<Any> {
  await waitIdle(native);
  const generator = new native.RequestGenerator(native.workspaceId);
  let request: Any;
  try {
    request = generator.getRequest({ modelId: native.modelId, viewDefinition, pageRequests: [{ startRow, startColumn: 0, rowCount, columnCount: -1 }],
      cellSelectorLabelsRequired: selectorLabels, pageSelectorLabelsRequired: false, viewIndex: -1 });
  } finally {
    generator.uninitialize?.();
  }
  assertRead(request);
  const result = await post(native, request);
  const view = Array.isArray(result?.viewRequestResults) ? result.viewRequestResults[0] : undefined;
  if (!view || view.errorInfo) throw new Refusal("The model returned no grid for this read", "no grid", view ? reasonOf(view.errorInfo, native) : undefined);
  return view;
}

/** A cell whose value picks from a list (a month, a weekday, a calendar type) is stored as that choice's ID; the grid shows
 * the choice's label from the view's selector label pages (Time2.DataProvider._getSelectorLabelPage). */
function selectorLabel(view: Any, page: Any, index: number, periods?: Map<number, string>): string | undefined {
  try {
    const format = typeof page.getFormat === "function" ? page.getFormat(index) : undefined;
    const selector = view.selectorLabelPages?.[view.indexSelectorLabelPageMap?.[format?.hierarchyEntityLongId]];
    if (format?.dataType === "TIME_ENTITY") keepSelectorLabels(selector, periods);
    const ids: unknown[] | undefined = selector?.entityLongIds?.[0];
    const labels: unknown[] | undefined = selector?.labels?.[0];
    if (!Array.isArray(ids) || !Array.isArray(labels)) return undefined;
    const method = ["ENTITY", "TIME_ENTITY"].includes(format?.dataType) ? "getCellValue" : "getOriginalText";
    const value = typeof page[method] === "function" ? page[method](index) : undefined;
    const at = ids.findIndex(id => String(id) === String(value));
    return at >= 0 && typeof labels[at] === "string" ? labels[at] as string : undefined;
  } catch { return undefined; }
}

/** Retain choices already returned with a selector read, including periods other than the calendar's selected one.
 * IDs are globally unique within this model; no period arithmetic or extra request is needed. */
function keepSelectorLabels(page: Any, names: Map<number, string> | undefined): void {
  if (!names) return;
  const ids: unknown = page?.entityLongIds?.[0], labels: unknown = page?.labels?.[0];
  if (!Array.isArray(ids) || !Array.isArray(labels)) return;
  ids.forEach((value: unknown, at: number) => {
    const id = typeof value === "number" || typeof value === "string" && /^\d+$/.test(value) ? Number(value) : NaN;
    const label: unknown = labels[at];
    if (Number.isSafeInteger(id) && id > 0 && typeof label === "string" && label.trim()) names.set(id, plainText(label));
  });
}

/** Reads a whole grid in row pages. The first page is asked for at once, sized for `FIRST_PAGE_COLUMNS`, and its answer
 * says how many rows and columns the grid has, and the columns' labels: the classic client too asks for a page of a grid
 * before it knows the grid's size, and is given what there is (anaplan/gridlet/ViewRequestGridModel.js `_getPageRequests`).
 * The pages after it are sized for the grid's own columns. Should the first page give fewer rows than it was asked for,
 * the next page starts where it ended. `selectorLabels` shows list choices by label. `stop` is asked before each read: an
 * export that was asked to stop reads no further one. Asking is also how the model's frame tells the page that waits for
 * it that the export is still going (bridge.ts `serveCore`): nothing else is reported between two reads, so it has to be
 * asked before every one. Once the grid is read, the log says how long each of its pages took. `selectorNames`, where
 * supplied, keeps Time period choices from the same responses for import constants.
 *
 * A page after the first that the model refuses, or answers with no grid, is read again in two halves, of the same grid
 * and nothing else: each half it refuses too in two halves again, down to a single row, which is then left out of the
 * grid. Both halves of a part are asked for before either's halves, so that one row the model cannot give costs at most
 * two refusals in a row, wherever it is. The page after them is of the usual size again. The log says each refusal, with
 * the model's words on why, and once the grid is read how many of its rows were read and which were left out, each by
 * its place: counted from 0 in the grid's order, as the lines on its pages count rows. The grid says the same
 * (`Grid.refused`). Once the model has refused 12 reads in a row, with none answered between them, it refuses every read,
 * and the grid fails as one whose first page it refuses does, with the model's words. A failure once the first page was
 * read keeps that page's columns (`GridFailure`). */
export async function readGrid(native: Native, rows: string, columns: string, name: string, log: Log, cellsPerRead = CELLS_PER_READ,
  selectorLabels = false, stop?: Stop, staticContextIdentifiers: string[] = [], selectorNames?: Map<number, string>): Promise<Grid> {
  const viewDefinition = { type: "MODEL_DEFINITION", staticContextIdentifiers, ...native.helper.getAxesForViewDefinition([rows], [columns]) };
  const firstRows = Math.max(1, Math.floor(cellsPerRead / FIRST_PAGE_COLUMNS));
  stop?.throwIfAborted();
  let asked = Date.now();
  const first = await readWindow(native, viewDefinition, 0, firstRows, selectorLabels);
  const rowCount = Number(first.rowCount) || 0;
  const columnCount = Number(first.columnCount) || 0;
  const columnLabels = labelEntries(first.columnLabelPages?.[0]);
  const headers = columnLabels.map(column => column.labels[0] ?? "");
  log(`${name}: ${rowCount} rows × ${columnCount} columns; columns: ${headers.join(" | ")}`);
  if (rowCount > MAX_ROWS) throw new GridFailure(`${name} has ${rowCount} rows, more than this export reads.`, headers);
  const grid: Grid = { columns: columnLabels, rows: [] };
  const perRead = Math.max(1, Math.floor(cellsPerRead / Math.max(1, columnCount)));
  const currencies = native.cache.getAllCurrenciesLabelPage?.();
  /** How long each page took, said once the grid is read: nothing is reported between two pages. */
  const took: string[] = [];
  /** The rows of each answer, by the first row asked for: a refused page's halves are not answered in the grid's order. */
  const parts: { start: number; rows: GridRow[] }[] = [];
  /** The place of each row the model refused, alone. */
  const refused: number[] = [];
  let refusedInARow = 0;
  let refusals = 0;
  /** Puts the rows of one answer, `count` rows from `start`, in the grid, and says how many it put: on the first page, as
   * many as it holds where it holds fewer than were asked for, and the next page starts after them. */
  const place = (view: Any, start: number, count: number): number => {
    const pages = (Array.isArray(view.dataPages) ? view.dataPages : []).map((page: Any) => {
      const data = new native.DataPage({ page, allCurrenciesLabelPage: currencies });
      if (!selectorLabels) return data;
      return { contains: (r: number, c: number) => data.contains(r, c), getIndex: (r: number, c: number) => data.getIndex(r, c),
        getOriginalText: (i: number) => selectorLabel(view, data, i, selectorNames) ?? data.getOriginalText(i), getCellText: (i: number) => selectorLabel(view, data, i, selectorNames) ?? data.getCellText(i) };
    });
    const labels = labelEntries(view.rowLabelPages?.[0]);
    if (labels.length !== count) log(`${name}: rows ${start}-${start + count - 1} returned ${labels.length} labels`);
    const read = start === 0 && labels.length > 0 && labels.length < count ? labels.length : count;
    took.push(`${name}: rows ${start}–${start + read - 1} in ${seconds(Date.now() - asked)}`);
    parts.push({ start, rows: windowRows(labels.slice(0, read), start, columnCount, pages) });
    return read;
  };
  /** Reads `count` rows from `start`, a page or a part of one, and puts them in the grid: false where the model refused
   * them, which the log then says. Any other failure is the grid's, and so is the refusal that makes 12 in a row. Only
   * the read is in the try: what was asked to stop, and a line of the log, which can be that ask too (bridge.ts
   * `serveCore`), fail as they are. */
  const tryRead = async (start: number, count: number): Promise<boolean> => {
    stop?.throwIfAborted();
    asked = Date.now();
    let view: Any;
    let refusal: Refusal | undefined;
    try {
      view = await readWindow(native, viewDefinition, start, count, selectorLabels);
    } catch (error) {
      if (!(error instanceof Refusal) || ++refusedInARow >= REFUSED_IN_A_ROW) throw new GridFailure(message(error), headers, { cause: error });
      refusal = error;
      refusals++;
    }
    if (refusal) {
      if (count > 1) log(`${name}: rows ${start}–${start + count - 1} refused by the model (${refusal.said}); reading them in smaller pages`);
      else {
        refused.push(start);
        log(`${name}: row ${start} refused by the model (${refusal.said}); left out`);
      }
      return false;
    }
    refusedInARow = 0;
    place(view, start, count);
    return true;
  };
  /** Reads again, in two halves, `count` rows from `start` that the model refused: both halves first, then each it refused,
   * in halves again. A single row is not read again. */
  const inHalves = async (start: number, count: number): Promise<void> => {
    if (count < 2) return;
    const half = Math.ceil(count / 2);
    const halves: [number, number][] = [[start, half], [start + half, count - half]];
    const answered: boolean[] = [];
    for (const [from, rows] of halves) answered.push(await tryRead(from, rows));
    for (const [index, [from, rows]] of halves.entries()) if (!answered[index]) await inHalves(from, rows);
  };
  for (let start = rowCount > 0 ? place(first, 0, Math.min(firstRows, rowCount)) : 0; start < rowCount;) {
    const count = Math.min(perRead, rowCount - start);
    if (!await tryRead(start, count)) await inHalves(start, count);
    start += count;
  }
  grid.rows = parts.sort((a, b) => a.start - b.start).flatMap(part => part.rows);
  for (const line of took) log(line);
  // A grid the model refused no read of says no more than it did. Rows read are those the grid holds: a part that gave
  // fewer rows than were asked for (said above) is not counted as whole.
  if (refusals) {
    refused.sort((a, b) => a - b);
    const many = refused.length === 1 ? "row" : "rows";
    log(`${name}: ${thousands(grid.rows.length)} of ${thousands(rowCount)} rows read${refused.length ? `; ${thousands(refused.length)} ${many} refused: ${placesSaid(refused)}` : ""}`);
    if (refused.length) grid.refused = { rowCount, places: refused };
  }
  return grid;
}

/** Entity type index of an ID (102 module, 101 list, 107 version, 123 time range, …). */
export function typeIndex(native: Native, id: number): number {
  try { return Number(native.ids.getEntityTypeIndex(id)); } catch { return -1; }
}
