import { DETAILS_HEADERS, diagnosticRows, exportRows, type DetailRow } from "../details.js";
import { Failure, SEND_LOG, type Log, type Progress, type Stop } from "../progress.js";
import { plainRows } from "../result-plain.js";
import type { AnalysisResult, ResultTable } from "../result-types.js";
import { fileSafe, message, text } from "../util.js";
import { ACCESS_LABEL, accessTable } from "./access.js";
import { actionKind, mergeImports, missingActionColumns, type ActionKind } from "./actions.js";
import { CALENDAR_HEADERS, calendarRows } from "./calendar.js";
import { gridTable, type Grid, type GridRow, type Table } from "./grid.js";
import { lineItemsTable } from "./lineitems.js";
import { axis, loadNative, readGrid, typeIndex } from "./native.js";

/** One CSV per Model settings grid, laid out as Anaplan's own export of that grid (compared with exports from Model
 * settings, 28 Sep 2026): the Actions list split at its headings with its imports merged into the Imports tab (actions.ts),
 * the model calendar in the assessment template, and Model Details.csv about the export itself. One file more is no
 * grid's: Dynamic Cell Access.csv, made from the tables of the others (access.ts).
 * Evidence for each grid's axes: the classic client's settings tabs (anaplan/settings/*.js, tabs/Settings.js). */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const HOW_TO_READ: readonly [detail: string, value: string][] = [
  ["Layout", "Each file is laid out as Anaplan's own export of the same Model settings grid: an unlabelled first column, then the grid's columns, with each cell's underlying value."],
  ["Line Items", "Each module's row sits above its line items. Anaplan's own columns come first and are unchanged, and three columns follow them. Ratio Numerator and Ratio Denominator name the line items a Ratio summary divides: the Summary JSON gives only their IDs. Format List names the list of a line item formatted as a list, as General Lists.csv names it: the Format JSON gives only the list's ID. It is empty for any other format, for a list that is not in General Lists.csv, such as a list subset or a line item subset, and when General Lists.csv was not exported."],
  ["Dynamic Cell Access", "Not a Model settings grid: the Read Access Driver and Write Access Driver columns of Line Items.csv, listed from the driver's side. One row for each use of a driver: the driver, Read or Write, and what it controls, each by its module and its name as Line Items.csv writes them. A line item that one driver controls for reading and for writing has two rows. The rows are in the order of the drivers in Line Items.csv, for one driver Read before Write, then in the order of what it controls. Where a module's own row names a driver, that row is listed with no Controlled Line Item, and each line item of the module that shows a dash in the column is listed with the same driver. A driver that could not be matched to a line item comes last, once for the cell that names it: Driver Module is empty, and Driver Line Item holds the cell as it is written. A driver is matched as the model map matches it, and only to a line item the map has: the map leaves some rows of Line Items.csv out, and About this map says how many. A driver named in such a row is listed here all the same, with the row's Module Name and its name as the file writes them. The file is not written when Line Items.csv was not exported, or lacks its Module Name column or one of the two driver columns."],
  ["Processes, Exports and Other Actions", "The Actions list split at its headings, in its own columns: definition, last run (start time and duration), notes, the processes that use each action and the dashboards it appears on."],
  ["Imports", "The Imports tab (source and target), then each import's columns from the Actions list (last run, duration, notes, Used in Processes, Used in Dashboards), matched on the import's ID. The Actions list's \"Import into …\" text is left out: Target Object and Target Type say the same."],
  ["Import Data Sources", "Each data source, with the imports that use it."],
  ["Model Calendar", "Follows the assessment template. Months and days are their names, and Current Fiscal Year is shown with its dates, as the Model Calendar tab shows it. Settings that do not apply to this calendar type are blank; Model size (GB) and Captured by are left for you to fill in."],
];

/** What the user is told when not one grid could be read (progress.ts `Failure`); why each could not is the detail. */
const NOTHING_READ = "Cardigan could not read any of this model's settings. Check that the model is open and that you can see its Model settings in Anaplan, "
  + `then choose Run again. ${SEND_LOG}`;

/** The model's settings as the zip's files: Model Details.csv, then one file per grid that could be read, with Dynamic
 * Cell Access.csv after Line Items.csv where that file has what it is made from. Once the export was asked to stop,
 * `progress` throws at its next step and `stop` before the next page of a grid's rows (bridge.ts `serveCore`), and that
 * ends it. */
export async function exportModel(progress: Progress, diagnostics: () => string, stop?: Stop): Promise<AnalysisResult> {
  const log: Log = progress.log;
  progress.status("Loading the model page's client…");
  const native = await loadNative();
  const model = text(native.cache.getModelName?.(native.modelId)) ?? native.modelId;
  const workspaceInfo: Any = native.cache.getWorkspaceInfo?.() ?? {};
  const workspace = text(workspaceInfo.name) ?? text(workspaceInfo.workspaceName) ?? text((window as Any).workspaceName) ?? "";
  log(`model ${model}${workspace ? ` in ${workspace}` : ""}; page ${location.pathname}`);

  const tables: ResultTable[] = [];
  const summary: string[] = [];
  const notes: string[] = [];
  const fileRows: DetailRow[] = [];
  const noteRows: DetailRow[] = [];
  /** Where the next file goes: among the tables, the summary's lines, the notes and the Details file's Files rows. A file
   * whose table is made after later grids were read is put at the place that was taken when its own grid was read. */
  const place = () => ({ table: tables.length, line: summary.length, note: notes.length, row: fileRows.length });
  const add = (file: string, table: Table, detail?: string, at = place()) => {
    // No guard: a grid's values are written exactly as Anaplan's own export writes them (zip.ts `toCsv`).
    tables.splice(at.table, 0, { file: `${file}.csv`, label: file, headers: [...table.headers], rows: plainRows(table.rows), guard: false });
    const rows = `${table.rows.length} rows${detail ? ` (${detail})` : ""}`;
    summary.splice(at.line, 0, `${file}: ${rows}`);
    fileRows.splice(at.row, 0, ["Files", `${file}.csv`, rows]);
  };
  /** A file that is not in the zip, with the reason: among the notes, and as the file's row of the Details file. */
  const leftOut = (file: string, why: string, at = place()) => {
    notes.splice(at.note, 0, `${file}: not exported (${why}).`);
    fileRows.splice(at.row, 0, ["Files", `${file}.csv`, `Not exported: ${why}`]);
  };
  const fail = (file: string, error: unknown, at = place()) => {
    leftOut(file, message(error), at);
    log(`${file}: ${message(error)}`);
  };
  const note = (detail: string, text: string) => {
    notes.push(`${detail}: ${text}`);
    noteRows.push(["Notes", detail, text]);
  };
  /** One file's step: what its work gives, or nothing when the work failed, which is then the file's failure. */
  const step = async <T>(file: string, work: () => Promise<T>): Promise<T | undefined> => {
    progress.status(`Reading ${file}…`);
    try {
      return await work();
    } catch (error) {
      fail(file, error);
      return undefined;
    }
  };
  const grid = (file: string, rows: string, columns: string) => readGrid(native, rows, columns, file, log, undefined, false, stop);
  const plain = (file: string, rows: () => string, columns: () => string) => step(file, async () => add(file, gridTable(await grid(file, rows(), columns()))));

  // Line Items is read first, as ever, and its file keeps the first place. Its table is made only once General Lists has
  // been read or has failed: that grid's rows name the lists of its Format List column (lineitems.ts), and no grid is read
  // for the names. Nothing else moves: the reads, the steps and the lines of the log are in the order they had.
  const lineItemsAt = place();
  const lineItems = await step("Line Items", () => grid("Line Items", axis(native, "MODULE_WITH_LINE_ITEM"), axis(native, "LINE_ITEM_PROPERTY")));
  await plain("Modules", () => axis(native, "MODULE_ALL"), () => native.axisHelper.getModuleSystemAxisIdentifier());
  const lists = await step("General Lists", async () => {
    const read = await grid("General Lists", axis(native, "HIERARCHY"), native.axisHelper.getHierarchySystemAxisIdentifier());
    add("General Lists", gridTable(read));
    return read;
  });
  if (lineItems) {
    // A table that cannot be made is its file's failure, as it was while the table was made in the file's own step.
    try {
      add("Line Items", lineItemsTable(lineItems, lists), undefined, lineItemsAt);
    } catch (error) {
      fail("Line Items", error, lineItemsAt);
    }
  }
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
    const calendar = await readGrid(native, axis(native, "TIMESCALE_PROPERTY"), axis(native, "EMPTY_1_0"), "Model Calendar", log, undefined, true, stop);
    const values = new Map(calendar.rows.map(row => [row.ids[0], row.cells.find(cell => cell !== "") ?? ""] as [number, string]));
    // Year to date and year to go show only when the time summary setting is on (TimeRangeEditor).
    const flag = native.constants.FEATURE_FLAGS?.TIME_SUMMARY;
    const showsYearToDate = typeof native.cache.getApplicationPropertyEnabledOrNotSet === "function" && typeof flag === "string"
      ? native.cache.getApplicationPropertyEnabledOrNotSet(flag) !== false : undefined;
    add("Model Calendar", { headers: CALENDAR_HEADERS, rows: calendarRows({ workspace, model, capturedOn: new Date().toISOString().slice(0, 10), values, showsYearToDate }) });
  });

  if (!tables.length) throw new Failure(NOTHING_READ, notes.join(" ") || undefined);

  // Dynamic Cell Access is no grid's. It is the driver cells of Line Items listed from the driver's side, each read as the
  // model map reads it (access.ts), so it is made from the tables above now that every one of them is there: the results
  // page makes its map from these same tables. Nothing is read for the file and no step is reported: the reads, the steps
  // and the lines of the log are those of an export without it, but for the one line of a table that fails to be made.
  // Its place is right after Line Items, which stands at the place taken for it: as a table, with its line of the
  // summary, or, when it could not be exported, as a note; either way with its row of the Details file.
  const exported = tables[lineItemsAt.table]?.label === "Line Items";
  const accessAt = exported
    ? { table: lineItemsAt.table + 1, line: lineItemsAt.line + 1, note: lineItemsAt.note, row: lineItemsAt.row + 1 }
    : { ...lineItemsAt, note: lineItemsAt.note + 1, row: lineItemsAt.row + 1 };
  try {
    const access = accessTable(tables);
    // Without Line Items, or without a column of it that the file is made from, there is nothing to make the file from:
    // the Details file says so, as it does of a grid that could not be read. That is no failure, and no line of the log.
    if ("missing" in access) leftOut(ACCESS_LABEL, access.missing, accessAt);
    else add(ACCESS_LABEL, access.table, access.unmatched ? `${access.unmatched} with a driver that could not be matched` : undefined, accessAt);
  } catch (error) {
    // A table that cannot be made for any other reason is its file's failure, as a grid's is: the reason goes to the log too.
    fail(ACCESS_LABEL, error, accessAt);
  }

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
  tables.unshift({ file: "Model Details.csv", label: "Model Details", headers: [...DETAILS_HEADERS], rows: plainRows(details), guard: true, details: true });
  const date = new Date().toISOString().slice(0, 10);
  return { kind: "model", name: model, id: native.modelId, zipName: `${fileSafe(model, "model")} - Model Export - ${date}.zip`, tables,
    summary: [...summary, ...notes] };
}
