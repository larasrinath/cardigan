import { DETAILS_HEADERS, diagnosticRows, exportRows, type DetailRow } from "../details.js";
import { Failure, SEND_LOG, type Log, type Progress, type Stop } from "../progress.js";
import { plainRows } from "../result-plain.js";
import type { AnalysisResult, ImportMapping, ProcessActions, ResultTable } from "../result-types.js";
import { fileSafe, message, text } from "../util.js";
import { ACCESS_LABEL, accessTable } from "./access.js";
import { actionKind, mergeImports, missingActionColumns, otherActionsTable, type ActionKind } from "./actions.js";
import { CALENDAR_HEADERS, calendarRows } from "./calendar.js";
import { gridTable, type Grid, type GridRow, type Table } from "./grid.js";
import { fileImports, IMPORT_DEFINITION, importMappings, importNames, importsLine } from "./import-mappings.js";
import { lineItemsTable } from "./lineitems.js";
import { axis, loadNative, readGrid, typeIndex, type Native } from "./native.js";
import { PROCESS_DEFINITION, processActions, processesLine } from "./process-actions.js";

/** One table per Model settings grid, laid out as Anaplan's own export of that grid (compared with exports from Model
 * settings, 28 Sep 2026): the Actions list split at its headings with its imports merged into the Imports tab (actions.ts),
 * the model calendar in the assessment template, and Model Details.csv about the export itself. One file more is no
 * grid's: Dynamic Cell Access.csv, made from the tables of the others (access.ts). One grid is read for no table: the
 * imports' definitions, for the mapping of each import from a file, which the result carries beside its tables
 * (import-mappings.ts). A table is named as the CSV file it once was written to: the results page shows it under its
 * label, and makes no file.
 * Evidence for each grid's axes: the classic client's settings tabs (anaplan/settings/*.js, tabs/Settings.js). */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
/** How to read the tables, as the results page shows them: the overview lists these rows as they are. So they say what
 * the page's tables hold, where that is not the table as it is made here: the page says a definition in words
 * (results/readable-cells.ts), shows a module's own row of Line Items in bold and adds Format type (results/line-items-view.ts), and shows an
 * import's Source Object as three columns and a source model's Mapped To as two (results/result-view.ts). They speak of
 * no file: the page makes none. */
const HOW_TO_READ: readonly [detail: string, value: string][] = [
  ["Layout", "Each table is laid out as Anaplan's own export of the same Model settings grid: each row's name first, then the grid's columns, with each cell's underlying value. Where a Format, a Summary or an Action holds a definition that can be said in words, the table says the words, and a row's details add the definition as it was read."],
  ["Line Items", "The table lists every row of the grid: each module's own row, in bold, then its line items. Each row names its module under Module Name, after its own name, a module's own row its own name. Applies To holds the dimensions a line item has, its module's where it has none of its own, and Applies To from says which. Format type, after Format, is the data type of a line item's format, and is blank on a module's own row: without (blank) its filter lists only line items, and without No Data it leaves out the line items that are headings. Three columns follow Anaplan's own. Ratio Numerator and Ratio Denominator name the line items a Ratio summary divides: the Summary's definition gives only their IDs. Format List names the list of a line item formatted as a list, as the General Lists table names it: the Format's definition gives only the list's ID. It is empty for any other format, for a list that is not in General Lists, such as a list subset or a line item subset, and when General Lists was not exported."],
  ["Dynamic Cell Access", "Not a Model settings grid: the Read Access Driver and Write Access Driver columns of Line Items, listed from the driver's side. One row for each use of a driver: the driver, Read or Write, and what it controls, each by module and name as Line Items has them. Rows follow the drivers' order in Line Items, Read before Write. A row with no Controlled Line Item is a module's own: its driver is set on the module's own row, which the Line Items table shows above the module's line items. A line item that shows a dash is listed with its module's driver. A driver that could not be matched comes last, once for its cell, with no Driver Module and the cell as it is written. That includes a driver that sits in a row the model map leaves out, which About this map counts. The table is not made when Line Items was not exported or lacks its Module Name column or a driver column."],
  ["Processes, Exports and Other Actions", "The Actions list split at its headings, in its own columns: definition, last run (start time and duration), notes, the processes that use each action and the dashboards it appears on. One column follows Anaplan's own in Other Actions. Action List names the list an action deletes from or orders, as the General Lists table names it: the Action's definition gives only the list's ID. It is empty for any other action, for a list that is not in General Lists, and when General Lists was not exported. A process's row, in its details, lists the actions it runs, in the order it runs them, as the process's own definition holds them: each with its kind, and each opening its own row."],
  ["Imports", "The Imports tab (source and target), then each import's columns from the Actions list (last run, duration, notes, Used in Processes, Used in Dashboards), matched on the import's ID. The Actions list's \"Import into …\" text is left out: Target Object and Target Type say the same. Source Object is shown as three columns, Source Model, Source Module and Saved View, for an import from a module or a saved view: Source Model names this model where the import reads from this model itself. A row's details add Source Object as it was read. Any other Source Object stands as it is under Source Model. For an import of uploaded data, a row's details end with its Mapping, as the import's own definition holds it: what feeds each target, a column, a constant, a prompt or nothing, and which columns before the last one mapped are not used."],
  ["Import Data Sources", "Each data source, with the imports that use it."],
  ["Model Calendar", "Lists the calendar's settings that hold a value: those that do not apply to this calendar type, or that the model does not show, are left out. Months and days are their names, and Current Fiscal Year is shown with its dates, as the Model Calendar tab shows it."],
  ["Source Models", "Mapped To is shown as two columns, Mapped Workspace and Mapped Model: the workspace and the model each source model is mapped to, by name, or by ID where Mapped To gives no name. A row's details add Mapped To as it was read. A Mapped To that cannot be read stands as it is under Mapped Workspace."],
];

/** What the user is told when not one grid could be read (progress.ts `Failure`); why each could not is the detail. */
const NOTHING_READ = "Cardigan could not read any of this model's settings. Check that the model is open and that you can see its Model settings in Anaplan, "
  + `then choose Run again. ${SEND_LOG}`;

/** The entity types of a module and of a list (a hierarchy, to the client): the first three digits of their IDs, as
 * Anaplan's long IDs carry their type (102 or 101, and nine more digits), and the types the model's client says an ID is
 * of (native.ts `typeIndex`). */
const MODULE_TYPE = 102;
const LIST_TYPE = 101;

/** Each name and ID of one type of object, from the grids that list such objects. The results page opens a module or a list
 * in Model Building by its ID (results/main.ts). An ID is of the type by the type it starts with; the model's client is
 * asked only of an ID that does not start so, and adds it where it says it is of that type. Its word takes away no ID that
 * starts with the type: the client's numbers for the types could differ from the IDs' own, and then none would be found.
 * A name is kept once, with its first ID. */
function idsOfType(native: Native, grids: readonly (Grid | undefined)[], type: number): [string, string][] {
  const found = new Map<string, string>();
  for (const grid of grids) {
    for (const row of grid?.rows ?? []) {
      const [id] = row.ids;
      const name = row.labels[0] ?? "";
      if (!Number.isSafeInteger(id) || id <= 0 || name === "" || found.has(name)) continue;
      if (Math.floor(id / 1e9) === type || typeIndex(native, id) === type) found.set(name, String(id));
    }
  }
  return [...found];
}

/** Each module's name and ID, from the grids that list modules: Modules, and Line Items, which has a row of each module's
 * own above its line items. */
export const moduleIdsOf = (native: Native, grids: readonly (Grid | undefined)[]): [string, string][] => idsOfType(native, grids, MODULE_TYPE);
/** Each list's name and ID, from the grid that lists the lists: General Lists. */
export const listIdsOf = (native: Native, grids: readonly (Grid | undefined)[]): [string, string][] => idsOfType(native, grids, LIST_TYPE);

/** The log's line on the IDs of one type of object: how many were found, and the first row of the grids that list them, by
 * its ID and the type the model's client says it is of, which tell why an ID was not found. Nothing else of the row is
 * written. */
function idsLine(what: "Module" | "List", native: Native, grids: readonly (Grid | undefined)[], found: number): string {
  const row = grids.find(grid => grid?.rows.length)?.rows[0];
  return `${what} IDs: ${found} found; ${row ? `the first row listed has ID ${row.ids[0]}, of type ${typeIndex(native, row.ids[0])} by the model's client`
    : `no grid lists a ${what.toLowerCase()}`}`;
}
export const moduleIdsLine = (native: Native, grids: readonly (Grid | undefined)[], found: number): string => idsLine("Module", native, grids, found);
export const listIdsLine = (native: Native, grids: readonly (Grid | undefined)[], found: number): string => idsLine("List", native, grids, found);

/** The IDs of each row of the Line Items grid, as the result carries them beside its Line Items table, row for row
 * (result-types.ts `lineItemIds`): the row's own, and for a line item its module's, the label's second entity, which a
 * module's own row does not have. An ID that is no whole number above 0 is given as none. */
export function lineItemIdsOf(grid: Grid): [string, string][] {
  const id = (value: number | undefined): string => (value !== undefined && Number.isSafeInteger(value) && value > 0 ? String(value) : "");
  return grid.rows.map(row => [id(row.ids[0]), row.ids.length > 1 ? id(row.ids[1]) : ""]);
}

/** The model's settings as the result's tables: Model Details.csv, then one file per grid that could be read, with Dynamic
 * Cell Access.csv after Line Items.csv where that file has what it is made from. Once the export was asked to stop,
 * `progress` throws at its next step and `stop` before the next page of a grid's rows (bridge.ts `serveCore`), and that
 * ends it. The result carries the modules' IDs and the lists', none found or not: a result without them is one an earlier
 * version made. */

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
    // No guard: a grid's values are kept exactly as Anaplan's own export writes them. (The mark is read by the tests'
    // writer of a CSV, zip.test-support.ts `toCsv`: the page writes none.)
    tables.splice(at.table, 0, { file: `${file}.csv`, label: file, headers: [...table.headers], rows: plainRows(table.rows), guard: false });
    const rows = `${table.rows.length} rows${detail ? ` (${detail})` : ""}`;
    summary.splice(at.line, 0, `${file}: ${rows}`);
    fileRows.splice(at.row, 0, ["Files", `${file}.csv`, rows]);
  };
  /** A file that is not in the result, with the reason: among the notes, and as the file's row of the Details file. */
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
  // Its grid is kept for the modules' IDs, which no table holds.
  const modules = await step("Modules", async () => {
    const read = await grid("Modules", axis(native, "MODULE_ALL"), native.axisHelper.getModuleSystemAxisIdentifier());
    add("Modules", gridTable(read));
    return read;
  });
  // Both grids that list modules have been read, or have failed: the modules' IDs are taken now, and the log says how many.
  const moduleIds = moduleIdsOf(native, [modules, lineItems]);
  log(moduleIdsLine(native, [modules, lineItems], moduleIds.length));
  const lists = await step("General Lists", async () => {
    const read = await grid("General Lists", axis(native, "HIERARCHY"), native.axisHelper.getHierarchySystemAxisIdentifier());
    add("General Lists", gridTable(read));
    return read;
  });
  // General Lists has been read, or has failed: the lists' IDs are taken now, and the log says how many.
  const listIds = listIdsOf(native, [lists]);
  log(listIdsLine(native, [lists], listIds.length));
  /** The IDs of the Line Items table's rows, where the table was made: the pages built on the model are read with them. */
  let lineItemIds: [string, string][] | undefined;
  if (lineItems) {
    // A table that cannot be made is its file's failure, as it was while the table was made in the file's own step.
    try {
      add("Line Items", lineItemsTable(lineItems, lists), undefined, lineItemsAt);
      lineItemIds = lineItemIdsOf(lineItems);
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
    if (missing.length) note("Actions", `the Actions list came without ${missing.join(", ")}; the diagnostic log lists the columns it had.`);
  } catch (error) {
    for (const file of ["Processes", "Exports", "Other Actions"]) fail(file, error);
  }
  const ofKind = (kind: ActionKind) => (row: GridRow) => kinds.get(row) === kind;
  if (actions) add("Processes", gridTable(actions, ofKind("process")));
  // Each process with the actions it runs, in their order, out of its own definition (process-actions.ts): one grid more,
  // read only where the Actions list names a process, as the imports' definitions are read only where the Imports tab
  // names an import from a file. It is no table, and its failure is none: the Processes table stands as it is, each
  // process says that its actions could not be read, and the log says why. The result carries the processes once the
  // Actions list was read, none or not: a result without them is one an earlier version made.
  let processes: ProcessActions[] | undefined;
  const own = actions?.rows.filter(ofKind("process")) ?? [];
  if (actions) processes = [];
  if (actions && own.length) {
    log(processesLine(own.length));
    progress.status("Reading Process actions…");
    let definitions: Grid | undefined;
    try {
      definitions = await grid("Process actions", axis(native, "PROCESS"), axis(native, "PROCESS_PROPERTY"));
    } catch (error) {
      log(`Process actions: ${message(error)}`);
    }
    const column = native.constants.SYSTEM_PROPERTY_PROCESS_DEFINITION;
    processes = processActions(own, definitions, actions.rows, log, typeof column === "number" ? column : PROCESS_DEFINITION);
  }
  // The Imports tab is kept for the mappings of the imports from a file, which it names.
  const imports = await step("Imports", async () => {
    const tab = await grid("Imports", axis(native, "IMPORT_ALL"), axis(native, "IMPORT_DEFINITION_PROPERTY"));
    const merged = mergeImports(tab, actions && { columns: actions.columns, rows: actions.rows.filter(ofKind("import")) });
    add("Imports", merged.table, actions ? `${merged.matched} matched in the Actions list` : "Imports tab only: the Actions list could not be read");
    return tab;
  });
  // Each import from a file with its mapping, out of its own definition (import-mappings.ts): one grid more, read only where
  // the Imports tab names such an import. It is no table, and its failure is none: the Imports table stands as it is, each
  // of those imports says that its mapping could not be read, and the log says why. The step is reported before the read,
  // as every grid's is, so that an export asked to stop reads nothing more. The log says first what the Imports tab holds,
  // whether an import reads a file or not, and the result carries the mappings once the tab was read, none or not: a
  // result without them is one an earlier version made.
  let mappings: ImportMapping[] | undefined;
  if (imports) {
    log(importsLine(imports));
    mappings = [];
  }
  if (imports && fileImports(imports).length) {
    progress.status("Reading Import mappings…");
    let definitions: Grid | undefined;
    try {
      definitions = await grid("Import mappings", axis(native, "IMPORT_ALL"), axis(native, "IMPORT_PROPERTY"));
    } catch (error) {
      log(`Import mappings: ${message(error)}`);
    }
    const column = native.constants.SYSTEM_PROPERTY_IMPORT_DEFINITION;
    mappings = importMappings(imports, definitions, importNames(native, { lists, lineItems }), log, typeof column === "number" ? column : IMPORT_DEFINITION);
  }
  await plain("Import Data Sources", () => axis(native, "IMPORT_DATA_SOURCE"), () => axis(native, "IMPORT_DATA_SOURCE_DETAILS_PROPERTY"));
  if (actions) {
    add("Exports", gridTable(actions, ofKind("export")));
    // General Lists has been read, or has failed, before the Actions list: its rows name the lists of the Action List
    // column of Other Actions (actions.ts), as they name those of Format List, and no grid is read for the names.
    add("Other Actions", otherActionsTable(actions, ofKind("other"), lists));
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
    // A dash where no workspace was found, which the results page reads as no name (results/main.ts `mapOptions`).
    ["Model", "Workspace", workspace || "-"],
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
    summary: [...summary, ...notes], moduleIds, listIds, ...(mappings ? { importMappings: mappings } : {}), ...(processes ? { processActions: processes } : {}),
    ...(lineItemIds ? { lineItemIds } : {}) };
}
