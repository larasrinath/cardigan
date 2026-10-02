import { DETAILS_HEADERS, diagnosticRows, exportRows, type DetailRow } from "../details.js";
import type { Log, Progress, TaskResult } from "../panel.js";
import { fileSafe } from "../util.js";
import { toCsv, zipStore } from "../zip.js";
import { actionKind, mergeImports, missingActionColumns, type ActionKind } from "./actions.js";
import { CALENDAR_HEADERS, calendarRows } from "./calendar.js";
import { gridTable, type Grid, type GridRow, type Table } from "./grid.js";
import { axis, loadNative, readGrid, typeIndex } from "./native.js";

/** One CSV per Model settings grid, laid out as Anaplan's own export of that grid (compared with exports from Model
 * settings, 28 Sep 2026): the Actions list split at its headings with its imports merged into the Imports tab (actions.ts),
 * the model calendar in the assessment template, and Model Details.csv about the export itself.
 * Evidence for each grid's axes: the classic client's settings tabs (anaplan/settings/*.js, tabs/Settings.js). */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
const HOW_TO_READ: readonly [detail: string, value: string][] = [
  ["Layout", "Each file is laid out as Anaplan's own export of the same Model settings grid: an unlabelled first column, then the grid's columns, with each cell's underlying value."],
  ["Line Items", "Each module's row sits above its line items."],
  ["Processes, Exports and Other Actions", "The Actions list split at its headings, in its own columns: definition, last run (start time and duration), notes, the processes that use each action and the dashboards it appears on."],
  ["Imports", "The Imports tab (source and target), then each import's columns from the Actions list (last run, duration, notes, Used in Processes, Used in Dashboards), matched on the import's ID. The Actions list's \"Import into …\" text is left out: Target Object and Target Type say the same."],
  ["Import Data Sources", "Each data source, with the imports that use it."],
  ["Model Calendar", "Follows the assessment template. Settings that do not apply to this calendar type are blank; Model size (GB) and Captured by are left for you to fill in."],
];

const text = (value: unknown): string | undefined => (typeof value === "string" && value ? value : undefined);

export async function exportModel(progress: Progress, diagnostics: () => string): Promise<TaskResult> {
  const log: Log = progress.log;
  progress.status("Loading the model page's client…");
  const native = await loadNative();
  const model = text(native.cache.getModelName?.(native.modelId)) ?? native.modelId;
  const workspaceInfo: Any = native.cache.getWorkspaceInfo?.() ?? {};
  const workspace = text(workspaceInfo.name) ?? text(workspaceInfo.workspaceName) ?? text((window as Any).workspaceName) ?? "";
  log(`model ${model}${workspace ? ` in ${workspace}` : ""}; page ${location.pathname}`);

  const files: { name: string; data: Uint8Array }[] = [];
  const summary: string[] = [];
  const notes: string[] = [];
  const fileRows: DetailRow[] = [];
  const noteRows: DetailRow[] = [];
  const encoder = new TextEncoder();
  const add = (file: string, table: Table, detail?: string) => {
    files.push({ name: `${file}.csv`, data: encoder.encode(toCsv(table.headers, table.rows, false)) });
    const rows = `${table.rows.length} rows${detail ? ` (${detail})` : ""}`;
    summary.push(`${file}: ${rows}`);
    fileRows.push(["Files", `${file}.csv`, rows]);
  };
  const fail = (file: string, error: unknown) => {
    notes.push(`${file}: not exported (${message(error)}).`);
    fileRows.push(["Files", `${file}.csv`, `Not exported: ${message(error)}`]);
    log(`${file}: ${message(error)}`);
  };
  const note = (detail: string, text: string) => {
    notes.push(`${detail}: ${text}`);
    noteRows.push(["Notes", detail, text]);
  };
  const step = async (file: string, work: () => Promise<void>) => {
    progress.status(`Reading ${file}…`);
    try {
      await work();
    } catch (error) {
      fail(file, error);
    }
  };
  const grid = (file: string, rows: string, columns: string) => readGrid(native, rows, columns, file, log);
  const plain = (file: string, rows: () => string, columns: () => string) => step(file, async () => add(file, gridTable(await grid(file, rows(), columns()))));

  await plain("Line Items", () => axis(native, "MODULE_WITH_LINE_ITEM"), () => axis(native, "LINE_ITEM_PROPERTY"));
  await plain("Modules", () => axis(native, "MODULE_ALL"), () => native.axisHelper.getModuleSystemAxisIdentifier());
  await plain("General Lists", () => axis(native, "HIERARCHY"), () => native.axisHelper.getHierarchySystemAxisIdentifier());
  // The Actions list, split at its headings (Processes, Imports, Exports, Other Actions); no combined Actions file.
  progress.status("Reading Actions…");
  let actions: Grid | undefined;
  const kinds = new Map<GridRow, ActionKind>();
  try {
    actions = await grid("Actions", axis(native, "ACTION_WITH_HEADING"), native.axisHelper.getActionSystemAxisIdentifier());
    const counts = new Map<string, number>();
    for (const row of actions.rows) {
      let info: Any = null;
      try { info = native.cache.getActionInfo?.(row.ids[0]); } catch { info = null; }
      const entityType = typeIndex(native, row.ids[0]);
      const kind = actionKind(entityType, !!info, row.cells.some(cell => cell !== ""));
      kinds.set(row, kind);
      counts.set(`${entityType}:${kind}`, (counts.get(`${entityType}:${kind}`) ?? 0) + 1);
    }
    log(`Actions rows by entity type: ${[...counts].map(([key, count]) => `${key}×${count}`).join(", ")}`);
    const missing = missingActionColumns(actions.columns.map(column => column.labels[0] ?? ""));
    if (missing.length) note("Actions", `the Actions list came without ${missing.join(", ")}; the Diagnostics rows list the columns it had.`);
  } catch (error) {
    for (const file of ["Processes", "Exports", "Other Actions"]) fail(file, error);
  }
  const ofKind = (kind: ActionKind) => (row: GridRow) => kinds.get(row) === kind;
  if (actions) add("Processes", gridTable(actions, ofKind("process")));
  await step("Imports", async () => {
    const tab = await grid("Imports", axis(native, "IMPORT_ALL"), axis(native, "IMPORT_DEFINITION_PROPERTY"));
    const merged = mergeImports(tab, actions && { columns: actions.columns, rows: actions.rows.filter(ofKind("import")) });
    add("Imports", merged.table, actions ? `${merged.matched} matched in the Actions list` : "Imports tab only: the Actions list could not be read");
  });
  await plain("Import Data Sources", () => axis(native, "IMPORT_DATA_SOURCE"), () => axis(native, "IMPORT_DATA_SOURCE_DETAILS_PROPERTY"));
  if (actions) {
    add("Exports", gridTable(actions, ofKind("export")));
    add("Other Actions", gridTable(actions, ofKind("other")));
  }
  await plain("Time Ranges", () => axis(native, "TIME_RANGE"), () => {
    const calendar = native.cache.getTimescaleInfo?.()?.calendarTypeEntityIndex;
    const c = native.constants;
    if (calendar !== undefined && calendar === c.CALENDAR_TYPE_WEEKS_GENERAL_ENTITY_INDEX) return axis(native, "TIME_RANGE_WEEKS_GENERAL_PROPERTY");
    if (calendar !== undefined && calendar === c.CALENDAR_TYPE_THIRTEEN_FOUR_WEEK_PERIODS_ENTITY_INDEX) return axis(native, "TIME_RANGE_WEEKS_13_4_PROPERTY");
    return axis(native, "TIME_RANGE_PROPERTY");
  });
  await plain("Versions", () => axis(native, "VERSION_ALL"), () => axis(native, "VERSION_PROPERTY"));
  await plain("Source Models", () => axis(native, "REMOTE_MODEL"), () => axis(native, "REMOTE_MODEL_PROPERTY"));
  await step("Model Calendar", async () => {
    const calendar = await readGrid(native, axis(native, "TIMESCALE_PROPERTY"), axis(native, "EMPTY_1_0"), "Model Calendar", log, undefined, true);
    const values = new Map(calendar.rows.map(row => [row.ids[0], row.cells.find(cell => cell !== "") ?? ""] as [number, string]));
    // Year to date and year to go show only when the time summary setting is on (TimeRangeEditor, as SAM reads it).
    const flag = native.constants.FEATURE_FLAGS?.TIME_SUMMARY;
    const showsYearToDate = typeof native.cache.getApplicationPropertyEnabledOrNotSet === "function" && typeof flag === "string"
      ? native.cache.getApplicationPropertyEnabledOrNotSet(flag) !== false : undefined;
    add("Model Calendar", { headers: CALENDAR_HEADERS, rows: calendarRows({ workspace, model, capturedOn: new Date().toISOString().slice(0, 10), values, showsYearToDate }) });
  });

  if (!files.length) throw new Error(notes.join(" ") || "Nothing could be read from this model page.");
  const details: DetailRow[] = [
    ["Model", "Model", model],
    ["Model", "Workspace", workspace || "—"],
    ["Model", "Model ID", native.modelId],
    ["Model", "Workspace ID", native.workspaceId],
    ...exportRows(location.host),
    ...fileRows,
    ...noteRows,
    ...HOW_TO_READ.map(([detail, value]): DetailRow => ["How to read", detail, value]),
    ...diagnosticRows(diagnostics()),
  ];
  files.unshift({ name: "Model Details.csv", data: encoder.encode(toCsv(DETAILS_HEADERS, details)) });
  const date = new Date().toISOString().slice(0, 10);
  return { zip: zipStore(files), fileName: `${fileSafe(model, "model")} - Model Export - ${date}.zip`, summary: [...summary, ...notes] };
}
