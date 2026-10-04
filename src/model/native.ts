import type { Log, Stop } from "../progress.js";
import { SCOPE_ID, sleep } from "../util.js";
import { labelEntries, windowRows, type Grid } from "./grid.js";

/** Reads Model settings grids through the classic model building client, the way its own settings tabs do: a
 * MODEL_DEFINITION view of a row axis against a property-column axis (evidence: anaplan/settings/*.js and SAM's Model
 * Builder reader). Runs in the page's main world. Read-only by construction: requests are built only by the client's
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
const MAX_ROWS = 250_000;
const READ_TIMEOUT_MS = 180_000;

/** The classic model building page exposes its AMD loader and the open model on window. */
export function modelOnPage(): string | undefined {
  const w = window as Any;
  return typeof w.require === "function" && typeof w.modelId === "string" && SCOPE_ID.test(w.modelId)
    && typeof w.workspaceId === "string" && SCOPE_ID.test(w.workspaceId) ? w.modelId : undefined;
}

export function loadNative(timeoutMs = 30_000): Promise<Native> {
  const w = window as Any;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("The model page's client did not load.")), timeoutMs);
    w.require(MODULES, (cache: Any, aggregator: Any, helper: Any, ids: Any, constants: Any, RequestGenerator: Any, DataPage: Any, axisHelper: Any) => {
      clearTimeout(timer);
      resolve({ cache, aggregator, helper, ids, constants, RequestGenerator, DataPage, axisHelper, workspaceId: w.workspaceId, modelId: w.modelId });
    }, () => { clearTimeout(timer); reject(new Error("The model page's client modules are not available.")); });
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

function post(native: Native, request: Any): Promise<Any> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => { settled = true; reject(new Error("Timed out waiting for the model.")); }, READ_TIMEOUT_MS);
    native.aggregator.post(request, false, (response: Any) => {
      if (settled) return true;
      settled = true;
      clearTimeout(timer);
      if (!response?.result || response.error || response.result.errorInfo) reject(new Error("The model rejected the read."));
      else resolve(response.result);
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
  if (!view || view.errorInfo) throw new Error("The model returned no grid for this read.");
  return view;
}

/** A cell whose value picks from a list (a month, a weekday, a calendar type) is stored as that choice's ID; the grid shows
 * the choice's label from the view's selector label pages (Time2.DataProvider._getSelectorLabelPage, as SAM reads it). */
function selectorLabel(view: Any, page: Any, index: number): string | undefined {
  const format = page.getFormat?.(index);
  const selector = view.selectorLabelPages?.[view.indexSelectorLabelPageMap?.[format?.hierarchyEntityLongId]];
  const ids: unknown[] | undefined = selector?.entityLongIds?.[0];
  const labels: unknown[] | undefined = selector?.labels?.[0];
  if (!Array.isArray(ids) || !Array.isArray(labels)) return undefined;
  const value = ["ENTITY", "TIME_ENTITY"].includes(format?.dataType) ? page.getCellValue?.(index) : page.getOriginalText?.(index);
  const at = ids.findIndex(id => String(id) === String(value));
  return at >= 0 && typeof labels[at] === "string" ? labels[at] as string : undefined;
}

/** Reads a whole grid in row pages; column labels come from the first read. `selectorLabels` shows list choices by label.
 * `stop` is asked before each page: an export that was asked to stop reads no further one. */
export async function readGrid(native: Native, rows: string, columns: string, name: string, log: Log, cellsPerRead = CELLS_PER_READ,
  selectorLabels = false, stop?: Stop): Promise<Grid> {
  const viewDefinition = { type: "MODEL_DEFINITION", staticContextIdentifiers: [], ...native.helper.getAxesForViewDefinition([rows], [columns]) };
  const first = await readWindow(native, viewDefinition, 0, 1, selectorLabels);
  const rowCount = Number(first.rowCount) || 0;
  const columnCount = Number(first.columnCount) || 0;
  const columnLabels = labelEntries(first.columnLabelPages?.[0]);
  log(`${name}: ${rowCount} rows × ${columnCount} columns; columns: ${columnLabels.map(column => column.labels[0]).join(" | ")}`);
  if (rowCount > MAX_ROWS) throw new Error(`${name} has ${rowCount} rows, more than this export reads.`);
  const grid: Grid = { columns: columnLabels, rows: [] };
  const perRead = Math.max(1, Math.floor(cellsPerRead / Math.max(1, columnCount)));
  const currencies = native.cache.getAllCurrenciesLabelPage?.();
  for (let start = 0; start < rowCount; start += perRead) {
    stop?.throwIfAborted();
    const count = Math.min(perRead, rowCount - start);
    const view = start === 0 && count === 1 ? first : await readWindow(native, viewDefinition, start, count, selectorLabels);
    const pages = (Array.isArray(view.dataPages) ? view.dataPages : []).map((page: Any) => {
      const data = new native.DataPage({ page, allCurrenciesLabelPage: currencies });
      if (!selectorLabels) return data;
      return { contains: (r: number, c: number) => data.contains(r, c), getIndex: (r: number, c: number) => data.getIndex(r, c),
        getOriginalText: (i: number) => selectorLabel(view, data, i) ?? data.getOriginalText(i), getCellText: (i: number) => selectorLabel(view, data, i) ?? data.getCellText(i) };
    });
    const labels = labelEntries(view.rowLabelPages?.[0]);
    if (labels.length !== count) log(`${name}: rows ${start}-${start + count - 1} returned ${labels.length} labels`);
    grid.rows.push(...windowRows(labels, start, columnCount, pages));
  }
  return grid;
}

/** Entity type index of an ID (102 module, 101 list, 107 version, 123 time range, …). */
export function typeIndex(native: Native, id: number): number {
  try { return Number(native.ids.getEntityTypeIndex(id)); } catch { return -1; }
}
