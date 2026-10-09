import type { AnalysisResult, Cell, ResultTable } from "../result-types.js";
import { cellLists, type Items } from "./cell-lists.js";
import { APP_FILES, cardsNamed, columnIndex, COLUMN_CHOICES, type CardsTable } from "./columns.js";
import { LINE_ITEMS_FILE, lineItemsView } from "./line-items-view.js";
import { mappingWords, READABLE_HEADERS, readableCell, type CellNames } from "./readable-cells.js";
import { sourceObjectOf } from "./source-object.js";
import { cellText, NONE, type Row } from "./table-engine.js";

/** What the results page reads out of a result besides its tables: the Details file's sections, the diagnostic log, and
 * what the overview says: its counts and notes, and everything the Details file holds, which has no view of its own.
 * Everything is taken from cells as they stand: nothing that a table, its search or its filters read is split out of a
 * joined text. The one cut is for a drawer: a card's parts list a cell's items one to a line where the cell lists several,
 * cut where its producer joined them (cell-lists.ts). */

/** The one file about the export itself (App Details.csv, Model Details.csv): rows of Section, Detail, Value. */
export const detailsOf = (result: AnalysisResult): ResultTable | undefined => result.tables.find(table => table.details === true);

/** The sections details.ts and the two exports write that the page treats on their own. */
const DIAGNOSTICS = "Diagnostics";
const NOTES = "Notes";
const FILES = "Files";
const HOW_TO_READ = "How to read";

export interface DetailSection { section: string; rows: [detail: string, value: string][] }

/** The Details file's rows under their sections, in the file's order, without the diagnostic log. */
export function detailSections(details: ResultTable | undefined): DetailSection[] {
  const sections = new Map<string, DetailSection>();
  for (const row of details?.rows ?? []) {
    const section = cellText(row[0]);
    if (section === DIAGNOSTICS) continue;
    let entry = sections.get(section);
    if (!entry) {
      entry = { section, rows: [] };
      sections.set(section, entry);
    }
    entry.rows.push([cellText(row[1]), cellText(row[2])]);
  }
  return [...sections.values()];
}

/** The diagnostic log the Details file carries, one line per row, each with its time as details.ts `diagnosticRows` split it. */
export function diagnosticLog(details: ResultTable | undefined): string[] {
  return (details?.rows ?? []).filter(row => cellText(row[0]) === DIAGNOSTICS).map(row => {
    const time = cellText(row[1]);
    return time ? `${time} ${cellText(row[2])}` : cellText(row[2]);
  });
}

/** One value of the Details file, or undefined when it has no such row. */
export function detailValue(details: ResultTable | undefined, section: string, detail: string): string | undefined {
  const row = details?.rows.find(candidate => cellText(candidate[0]) === section && cellText(candidate[1]) === detail);
  return row ? cellText(row[2]) : undefined;
}

/** How a Files row of the Details file says that a file was not exported, before the reason (model/export.ts). */
const NOT_EXPORTED = "Not exported: ";

/** A file's name as the page says it where the result has no table of that name to ask: without its extension, which is
 * how the export labels a table (model/export.ts). No user is shown a file's name. */
const withoutExtension = (file: string): string => file.replace(/\.csv$/, "");

/** The summary lines that say what a Files row of the Details file says. A model's summary lists every file, and the
 * export writes each file's line and its Files row from the same words (model/export.ts): "Imports: 3 rows (2 matched in
 * the Actions list)" beside the row "Imports.csv", "3 rows (2 matched in the Actions list)"; and for a file that was not
 * exported, "Source Models: not exported (reason)." beside "Source Models.csv", "Not exported: reason". */
function saidWithFiles(details: ResultTable | undefined): Set<string> {
  const lines = new Set<string>();
  for (const row of details?.rows ?? []) {
    if (cellText(row[0]) !== FILES) continue;
    const label = withoutExtension(cellText(row[1]));
    const value = cellText(row[2]);
    lines.add(`${label}: ${value}`);
    if (value.startsWith(NOT_EXPORTED)) lines.add(`${label}: not exported (${value.slice(NOT_EXPORTED.length)}).`);
  }
  return lines;
}

/** The result's notes, one line each: its summary lines, then the Details file's Notes rows as "Detail: Value". A Notes row
 * whose text the summary already holds, word for word, is not said twice. Two kinds of summary line are no notes, since
 * the overview says them with the files, once:
 * - A line that says only how many rows a file has ("Line Items: 120 rows", as a model's summary lists every file): the
 *   file's tile says that number, also where its table lists fewer rows than the file has (`Overview.tiles`).
 * - A line that says what a Files row of the Details file says (`saidWithFiles`): that row is on the overview, under
 *   Tables or as the file's tile. */
export function resultNotes(result: AnalysisResult): string[] {
  const rowCounts = new Set(result.tables.flatMap(table => ["rows", "row"].map(word => `${cellText(table.label)}: ${table.rows.length} ${word}`)));
  const withFiles = saidWithFiles(detailsOf(result));
  const summary = result.summary.map(cellText).filter(line => line !== "");
  const said = new Set(summary);
  const notes = summary.filter(line => !rowCounts.has(line) && !withFiles.has(line));
  for (const row of detailsOf(result)?.rows ?? []) {
    if (cellText(row[0]) !== NOTES) continue;
    const detail = cellText(row[1]);
    const value = cellText(row[2]);
    const line = detail ? `${detail}: ${value}` : value;
    if (said.has(line) || said.has(value)) continue;
    said.add(line);
    notes.push(line);
  }
  return notes;
}

/** A file as the page shows it: the table it lists in the file's place, and a short line for under the table's name when
 * that table is not the file as it stands, or is a file that needs a line to say what it lists. What the page counts,
 * searches, filters and opens is this table. The file itself stays as the export wrote it: a model's map is built from
 * the result's own tables. */
export interface FileView {
  table: ResultTable;
  note?: string;
  /** For a table that lists no row although its file has rows, because the file's rule lists none of them: what the
   * table says in the rows' place. The file has rows, which `note` counts, so the table must not say that nothing was
   * found. */
  none?: string;
  /** For a file that has no rows: what its table says in the rows' place, where the page's own sentence, that nothing
   * was found, would not say what an empty file of this kind means. */
  empty?: string;
  /** The column whose cell opens a row and names it in its drawer, by its place in `table`, for a table in which that is
   * not the first column: there the first column says the same thing in many rows, and is not what a row is called by. */
  opensFrom?: number;
  /** For the cells of `table` that the page says in words: the text the file has in each one's place, as it was read,
   * by the row as `table` holds it and by the column's place in it. A row's drawer shows both. None when no cell is said
   * in words. */
  exported?: ReadonlyMap<readonly Cell[], ReadonlyMap<number, Cell>>;
  /** For a column of `table` that the file does not have, whose cells a rule said in words out of a column of the file:
   * the file's name for that column, by the column's place in `table`. A row's drawer names the text kept for such a
   * cell in `exported` by it, so that the text is said to be what that column of the file holds. Any other cell's text
   * is named by its own column. */
  readUnder?: ReadonlyMap<number, string>;
}

/** A rule for one file: what the page shows in its place. It gives nothing when the file is not as the rule expects it,
 * and then the file is shown as it stands. */
export type FileRule = (file: ResultTable, result: AnalysisResult) => FileView | undefined;

/** A model's Model Calendar file (model/export.ts writes it under this name) follows a template: its first rows are about
 * the model itself (its workspace, its name, when it was captured), under the Section "Model", and the rest are the
 * calendar's settings. The rows about the model are not the calendar's, so the page says them with the model, in the
 * overview, and the table lists the others. */
export const MODEL_CALENDAR_FILE = "Model Calendar.csv";
/** The Section of the Model Calendar file's rows about the model. */
export const ABOUT_MODEL = "Model";

/** The Model Calendar file's columns that guide whoever fills the template in by hand: which calendar types a setting is
 * for, and how to fill it in. The export fills the values in itself, so the page leaves the two out. */
export const CALENDAR_GUIDANCE = ["Applies to", "Notes"];

const calendarView: FileRule = file => {
  const about = columnIndex(file, "Section");
  const value = columnIndex(file, "Value");
  // A file without rows is shown as it stands: the page says that nothing was found for it.
  if (about === undefined || !file.rows.length) return undefined;
  const settings = file.rows.filter(row => cellText(row[about]) !== ABOUT_MODEL);
  const left = file.rows.length - settings.length;
  // A setting with no value does not apply to the model's calendar type, or the model does not show it (the export
  // leaves those blank): it says nothing of the model, so the table lists the settings that hold a value.
  const rows = value === undefined ? settings : settings.filter(row => cellText(row[value]) !== "");
  const blank = settings.length - rows.length;
  const notes: string[] = [];
  if (left) {
    // The line says where the rows are, so that the table's count is not taken for all the file has. The overview has
    // the setting and the value of each such row that holds a value, and of no other (`factsOf`): the export leaves the
    // value out where it cannot know it. So the line says how many of the rows the overview has, and where none holds a
    // value, or the file lacks the columns the overview reads them by, only that the rows are not shown.
    const valued = factsOf(file).length;
    const where = valued === 0 ? "not shown"
      : valued === left ? `not listed here: the Overview has ${left === 1 ? "its value" : "their values"}, under About this export`
      : `not listed here: ${valued} ${valued === 1 ? "holds" : "hold"} a value, which the Overview has under About this export`;
    notes.push(`${left} ${left === 1 ? "row about the model is" : "rows about the model are"} ${where}.`);
  }
  if (blank) {
    notes.push(`${blank} ${blank === 1 ? "setting has no value and is" : "settings have no value and are"} not listed: `
      + `${blank === 1 ? "it does" : "they do"} not apply to this calendar type, or the model does not show ${blank === 1 ? "it" : "them"}.`);
  }
  const kept = file.headers.flatMap((header, index) => (CALENDAR_GUIDANCE.includes(header) ? [] : [index]));
  // The rows are the template's, which the export fills in: they were not read as rows, so the table does not say so.
  return {
    table: { ...file, headers: kept.map(index => file.headers[index]), rows: rows.map(row => kept.map(index => row[index])) },
    ...(notes.length ? { note: notes.join(" ") } : {}),
    ...(rows.length ? {} : { none: settings.length ? "No setting of the calendar holds a value." : "Every row is about the model." }),
  };
};

/** A model's Modules file, which lists every module (model/export.ts writes it under this name). */
export const MODULES_FILE = "Modules.csv";

/** A model's Line Items file is every module's blueprint in one grid: a module's own row, then its line items. The page
 * shows it as a table of line items, each with its module and the dimensions it really has (line-items-view.ts), and the
 * line under the table's name says how many modules' rows that leaves out.
 *
 * The view is given the modules' names where the result has them: the first column of the Modules file, as the file has
 * it. A row that holds nothing but a name is then a module's own row only when the name is a module's, and otherwise a
 * line item whose module is not known, which stays in the table. A result without the Modules file, or with one that
 * lists nothing, has no names to give, and every such row is taken for a module's own. The line then says that, and
 * why: a line item of which only the name was read is among the rows it counts as modules' own, and nothing else on
 * the page tells that the names could not be checked.
 *
 * A module with no line items is in no row of the table. Where the names came from the Modules file, the line says that
 * the file lists such modules: a row with nothing under it is taken for a module's own because the file names it. */
const lineItemsRule: FileRule = (file, result) => {
  const modules = result.tables.find(table => table.file === MODULES_FILE);
  const names = modules?.rows.length ? new Set(modules.rows.map(row => cellText(row[0]))) : undefined;
  const view = lineItemsView(file, names);
  // The view gives the table itself back when it does not apply to it.
  if (view.table === file) return undefined;
  const where = modules && names && view.emptyModules > 0 ? ` ${view.emptyModules === 1 ? "It is" : "They are"} listed in the ${cellText(modules.label)} table.` : "";
  // A Modules file that was not exported is not among the result's tables; one without rows is, under its own label.
  const unchecked = names ? "" : ` The ${modules ? `${cellText(modules.label)} table lists no modules` : "Modules table was not exported"}, so a row with only a name is taken for a module's row.`;
  const none = view.table.rows.length ? {} : { none: "Every row that was read is a module's own: no module has a line item." };
  return { table: view.table, note: view.note === undefined ? undefined : `${view.note}${where}${unchecked}`, ...none };
};

/** A model's Dynamic Cell Access file (model/export.ts writes it under this name). It is no grid of Anaplan's: the
 * export makes it from the Line Items file's Read Access Driver and Write Access Driver columns, which name a driver on
 * the line item it controls. The file lists the same from the driver's side, one row for each use of a driver: the
 * driver, Read or Write, and what it controls (model/access.ts). */
export const ACCESS_FILE = "Dynamic Cell Access.csv";
/** The file's column for the module of the line item that drives. It is empty in the rows whose driver the export could
 * match to no line item, and in no other row: those rows hold the driver as the Line Items file has it. */
const DRIVER_MODULE = "Driver Module";
/** The file's column for the line item that drives: what a row of the table is called by. */
const DRIVER_LINE_ITEM = "Driver Line Item";

/** The table is the file as it stands. No column of Anaplan's is called as these are, so a line under the table's name
 * says what it lists, and how many of its rows name a driver that could not be matched. Those rows are the file's own:
 * the count is read from them, and is the same for a result that was kept or brought back. A file without rows is that
 * of a model that drives no access, and its table says so. A row opens from its driver's name, and is called by it: the
 * file's first column is the driver's module, which is one name down the rows of a model that keeps its drivers in one
 * module, and would read as a way to that module. */
const accessRule: FileRule = file => {
  const driverModule = columnIndex(file, DRIVER_MODULE);
  if (driverModule === undefined) return undefined;
  const unmatched = file.rows.filter(row => cellText(row[driverModule]) === "").length;
  const said = unmatched === 0 ? "" : ` ${unmatched === 1 ? "1 row has a driver that could not be matched to a line item: it comes" : `${unmatched} rows have a driver that could not be matched to a line item: they come`}`
    + ` last, with the driver as Line Items has it and no ${DRIVER_MODULE}.`;
  const opensFrom = columnIndex(file, DRIVER_LINE_ITEM);
  return {
    table: file, ...(opensFrom === undefined ? {} : { opensFrom }),
    note: "The Read Access Driver and Write Access Driver columns of Line Items, listed from the driver's side. "
      + `One row for each use of a driver: the driver, Read or Write, and the line item it controls.${said}`,
    empty: "No line item in this model has a read or write access driver.",
  };
};

/** A file with one of its columns shown as several, each said out of that column's cell, and what is kept for a row's
 * drawer (`FileView`). `unread` counts the rows whose cell was not read and says something. */
interface SplitView {
  table: ResultTable;
  exported: ReadonlyMap<readonly Cell[], ReadonlyMap<number, Cell>>;
  readUnder: ReadonlyMap<number, string>;
  unread: number;
}

/** Whether a cell says nothing: it is empty, or holds the dash Anaplan writes for none. */
const saysNothing = (cell: Cell): boolean => {
  const text = cellText(cell).trim();
  return text === "" || text === "-";
};

/** The file with its column at `at` shown as the columns `headers`, in its place, by what `split` reads out of each row's
 * cell there: as many cells as `headers`, or nothing for a cell it does not read. Every row stays, in the file's order,
 * so the table counts what the file counts, and the tile and the navigation say the file's own number.
 *
 * A cell that is not read is left as it is: its text stands under the first of the columns, the others are empty, and
 * nothing is kept for it, as a cell that cannot be said in words stays as it is in any of a model's tables (`inWords`).
 * For a cell that is read, the text that was read is kept (`exported`) under the last of the columns, and a row's drawer
 * names it by the file's own header for the column (`readUnder`): it is what each of them was read from, and is shown
 * once. Undefined when no cell is read: the file is then not as the rule expects it, and is shown as it stands, under
 * its own header, so that no column is named for what none of its cells holds. */
function splitColumn(file: ResultTable, at: number, headers: readonly string[], split: (cell: Cell, row: readonly Cell[]) => readonly Cell[] | undefined): SplitView | undefined {
  if (!file.rows.every(row => Array.isArray(row))) return undefined;
  const said = file.rows.map(row => split(row[at] ?? "", row));
  if (said.every(cells => cells === undefined)) return undefined;
  const kept = at + headers.length - 1;
  const exported = new Map<readonly Cell[], ReadonlyMap<number, Cell>>();
  let unread = 0;
  const rows = file.rows.map((row, index) => {
    const cells = said[index];
    const cell = row[at] ?? "";
    if (cells === undefined && !saysNothing(cell)) unread++;
    const shown: Cell[] = file.headers.flatMap((_, column) => (column !== at ? [row[column] ?? ""] : cells ? [...cells] : [cell, ...headers.slice(1).map(() => "")]));
    // The cells a row holds beyond the headers stay after them, as the file has them.
    for (let column = file.headers.length; column < row.length; column++) shown.push(row[column] ?? "");
    if (cells) exported.set(shown, new Map([[kept, cell]]));
    return shown;
  });
  return {
    table: { ...file, headers: file.headers.flatMap((header, column) => (column === at ? [...headers] : [header])), rows },
    exported, readUnder: new Map([[kept, file.headers[at]]]), unread,
  };
}

/** What the line under a split table's name adds for the rows whose cell was not read and says something: how many, and
 * where their text is, so that it is not taken for what that column names. Nothing where there are none. */
function unreadLine(unread: number, column: string, why: string, under: string): string {
  if (unread === 0) return "";
  return unread === 1 ? ` 1 row has a ${column} that ${why}: its text stands as it is under ${under}.`
    : ` ${unread} rows have a ${column} that ${why}: their text stands as it is under ${under}.`;
}

/** A model's Imports file (model/export.ts writes it under this name): the Imports tab of Model settings, one import a
 * row, with the import's columns from the Actions list after the tab's own. */
export const IMPORTS_FILE = "Imports.csv";
/** The tab's columns for where an import takes its data from: the object it reads (source-object.ts), and what kind of
 * object that is. */
const SOURCE_OBJECT = "Source Object";
const SOURCE_TYPE = "Source Type";
/** The three columns the page shows in Source Object's place, in this order. */
const SOURCE_PARTS = ["Source Model", "Source Module", "Saved View"] as const;
/** What Source Model says for an import from one of this model's own modules where the export knew the model by its ID
 * alone (`ownModel`). */
export const THIS_MODEL = "This model";
/** The Source Types of the imports the three columns are for: one that reads a saved view, which the tab writes as
 * "SAVED VIEW", or a module. Any other import, of a file or of a list, names no module and no saved view. */
const READS_A_MODULE = /view|module/i;

/** The table is the file with three columns in the place of Source Object, for each import from a module or a saved view:
 * Source Model, Source Module and Saved View, each a name as the cell writes it, out of its quotes. An import from one of
 * this model's own modules names no model, and Source Model names this model (`ownModel`). A module read without a
 * saved view leaves Saved View empty.
 *
 * Only a row whose Source Type says that it reads a saved view or a module is read. A file's name is written as a module
 * and a saved view would be ("prices.csv"), and a list is no module: their rows, the dash Anaplan writes for a file's
 * import, and text that is not written as a model's object are left as they are, under Source Model (`splitColumn`).
 * The line under the table's name says what the three columns are, and counts the rows that are not read where their
 * cell says something. A file without the Source Type column, or without a row that is read, is shown as it stands.
 * The file itself stays as the export wrote it: a model's map is built from the result's own tables, and asks of this
 * column only whether the file has it (map/build-graph.ts). */
const importsRule: FileRule = (file, result) => {
  const at = columnIndex(file, SOURCE_OBJECT);
  const type = columnIndex(file, SOURCE_TYPE);
  const own = ownModel(result);
  const split = at === undefined || type === undefined ? undefined : splitColumn(file, at, SOURCE_PARTS, (cell, row) => {
    if (!READS_A_MODULE.test(cellText(row[type]))) return undefined;
    const object = sourceObjectOf(cell);
    return object && [object.model ?? own, object.module, object.view ?? ""];
  });
  if (!split) return undefined;
  const { unread, ...view } = split;
  const [sourceModel, sourceModule, savedView] = SOURCE_PARTS;
  return {
    ...view,
    note: `${SOURCE_OBJECT} is shown as three columns, ${sourceModel}, ${sourceModule} and ${savedView}, for an import from a module or a saved view. ${sourceModel} `
      + `${own === THIS_MODEL ? `says ${THIS_MODEL}` : "names this model"} where the import reads from this model itself. A row's details add ${SOURCE_OBJECT} as it was read.`
      + unreadLine(unread, SOURCE_OBJECT, "is not a module or a saved view", sourceModel),
  };
};

/** This model's name, which Source Model gives an import from one of its own modules: the result's name, unless the export
 * knew the model by its ID alone (model/export.ts), when Source Model says This model. */
function ownModel(result: AnalysisResult): string {
  const name = cellText(result.name);
  return name.trim() === "" || name === cellText(result.id) ? THIS_MODEL : name;
}

/** A model's Source Models file (model/export.ts writes it under this name): one row for each model that this model's
 * imports read from, with what it is mapped to under Mapped To. Anaplan's own export of the grid writes that cell as an
 * object that names a workspace and a model, each by its ID and by its name (readable-cells.ts `mappingWords`), which is
 * no way to read who is mapped where. */
export const SOURCE_MODELS_FILE = "Source Models.csv";
/** The file's column that says which workspace and which model a source model is mapped to, as the grid labels it. */
const MAPPED_TO = "Mapped To";
/** The two columns the page shows in its place, in this order. */
const MAPPED_WORKSPACE = "Mapped Workspace";
const MAPPED_MODEL = "Mapped Model";

/** The table is the file with two columns in the place of Mapped To: Mapped Workspace and Mapped Model, each by its name,
 * or by its ID where the cell gives no name for it, and empty where the cell gives neither. A name is never made up.
 *
 * A cell that names neither a workspace nor a model is left as it is, under Mapped Workspace (`splitColumn`): an empty
 * cell, text that is no object, or an object without any of the four. The line under the table's name says what the two
 * columns are, and counts the rows whose cell could not be read where it says something, so that such a text is not
 * taken for a workspace's name. A file none of whose cells names either is shown as it stands, under the grid's own
 * label. The file itself stays as the export wrote it: a model's map is built from the result's own tables. */
const sourceModelsRule: FileRule = file => {
  const at = columnIndex(file, MAPPED_TO);
  const split = at === undefined ? undefined : splitColumn(file, at, [MAPPED_WORKSPACE, MAPPED_MODEL], cell => {
    const words = mappingWords(cell);
    return words && [words.workspace, words.model];
  });
  if (!split) return undefined;
  const { unread, ...view } = split;
  return {
    ...view,
    note: `${MAPPED_TO} is shown as two columns, ${MAPPED_WORKSPACE} and ${MAPPED_MODEL}: the workspace and the model each source model is mapped to, by name, `
      + `or by ID where ${MAPPED_TO} gives no name. A row's details add ${MAPPED_TO} as it was read.${unreadLine(unread, MAPPED_TO, "could not be read", MAPPED_WORKSPACE)}`,
  };
};

/** The files the page has a rule for, each with its rule, by the kind of result and the file's name: four that it shows
 * otherwise than as they stand, and one that it shows as it stands, under a line that says what it is. No other file is
 * touched: a rule is a file's own, not a filter over all of them. */
export const FILE_RULES: Record<AnalysisResult["kind"], ReadonlyMap<string, FileRule>> = {
  app: new Map(),
  model: new Map([[MODEL_CALENDAR_FILE, calendarView], [LINE_ITEMS_FILE, lineItemsRule], [ACCESS_FILE, accessRule], [IMPORTS_FILE, importsRule], [SOURCE_MODELS_FILE, sourceModelsRule]]),
};

/** One of the result's files by its rule alone, or as it stands: the rows the page lists, before any cell is said in words. */
const ruledView = (result: AnalysisResult, file: ResultTable): FileView => FILE_RULES[result.kind].get(file.file)?.(file, result) ?? { table: file };

/** The Line Items file's columns that name what a Ratio summary divides (model/lineitems.ts adds them to the grid's own). */
const RATIO_NUMERATOR = "Ratio Numerator";
const RATIO_DENOMINATOR = "Ratio Denominator";
/** The Line Items file's column that names the list of a line item formatted as a list (model/lineitems.ts adds it after
 * those two). It is empty for a list the export could not name. */
const FORMAT_LIST = "Format List";
/** A model's Other Actions file (model/export.ts writes it under this name), and its column that names the list an action
 * deletes from or orders (model/actions.ts adds it after the Actions list's own). It too is empty for a list the export
 * could not name. */
const OTHER_ACTIONS_FILE = "Other Actions.csv";
const ACTION_LIST = "Action List";
/** The two files that name the list of a row's definition in a column of their own, each with that column: Line Items,
 * for a line item's Format, and Other Actions, for an action's definition. A column of either name in any other file
 * names no list. */
const LIST_COLUMNS: ReadonlyMap<string, string> = new Map([[LINE_ITEMS_FILE, FORMAT_LIST], [OTHER_ACTIONS_FILE, ACTION_LIST]]);

/** A model's table with its definitions said in words. Some cells of a model's grids hold a definition as JSON, because
 * Anaplan's own export of the grid writes that: a line item's Format and its Summary, an action's definition. The words
 * for such a cell (readable-cells.ts) take its place in the table, so the page searches, filters and sorts by them, and
 * `exported` keeps the text that was read. A cell the words are not known for stays as it is, and a row without such a cell
 * is the table's own row. A Ratio is said with the names in its own row's Ratio Numerator and Ratio Denominator cells. A
 * line item's list format is said with the name in its own row's Format List cell, and an action that deletes from a list
 * or orders one with the name in its own row's Action List cell. Either is said by the list's ID where that cell is empty
 * or the file has no such column. A result holds no other names of lists by their IDs, so any other list is said by its
 * ID. What a file's own rule kept of a row stays kept, also in the copy of the row that is said in words, and a cell the
 * rule kept a text for is the rule's: it is not read again. */
function inWords(view: FileView): FileView {
  const { table } = view;
  const readable = table.headers.flatMap((header, index) => (READABLE_HEADERS.some(known => known === header) ? [index] : []));
  if (!readable.length) return view;
  const numerator = columnIndex(table, RATIO_NUMERATOR);
  const denominator = columnIndex(table, RATIO_DENOMINATOR);
  const listHeader = LIST_COLUMNS.get(table.file);
  const listColumn = listHeader === undefined ? undefined : columnIndex(table, listHeader);
  const exported = new Map<readonly Cell[], ReadonlyMap<number, Cell>>();
  let changed = false;
  const rows = table.rows.map(row => {
    // The row's Format, or its Action, is the one cell of it that names a list, so the name is given whatever ID is asked for.
    const list = listColumn === undefined ? "" : cellText(row[listColumn]);
    const names: CellNames = { ratioNumerator: numerator === undefined ? undefined : cellText(row[numerator]), ratioDenominator: denominator === undefined ? undefined : cellText(row[denominator]),
      listName: list === "" ? undefined : () => list };
    const kept = view.exported?.get(row);
    let said: Cell[] | undefined;
    const texts = new Map<number, Cell>(kept ?? []);
    for (const index of readable) {
      if (kept?.has(index)) continue;
      const words = readableCell(table.headers[index], row[index], names);
      if (words === undefined) continue;
      said ??= [...row];
      said[index] = words;
      texts.set(index, row[index]);
    }
    if (said) {
      changed = true;
      exported.set(said, texts);
    } else if (kept) {
      exported.set(row, kept);
    }
    return said ?? row;
  });
  return changed ? { ...view, table: { ...table, rows }, exported } : view;
}

/** One of the result's files as the page shows it: by its rule, or as it stands, and for a model's result with its
 * definitions said in words, which comes after the rule (a rule moves columns and rows, and keeps the names of the columns
 * said in words; a rule that says a cell in words itself, as the Imports and the Source Models rules do, keeps what it
 * read, and that stays kept). An app's tables are never put into words: its columns of those names hold other things. */
export function fileView(result: AnalysisResult, file: ResultTable): FileView {
  const view = ruledView(result, file);
  return result.kind === "model" ? inWords(view) : view;
}

/** What a Model Calendar file says about the model itself: each setting with its value, in the file's order. A setting
 * without a value, as the export leaves the ones it cannot know, is left out. Nothing for a file without the columns
 * these are read by. */
function factsOf(table: ResultTable): [setting: string, value: string][] {
  const about = columnIndex(table, "Section");
  const setting = columnIndex(table, "Setting");
  const value = columnIndex(table, "Value");
  if (about === undefined || setting === undefined || value === undefined) return [];
  return table.rows.filter(row => cellText(row[about]) === ABOUT_MODEL && cellText(row[value]).trim() !== "").map(row => [cellText(row[setting]), cellText(row[value])]);
}

/** What a model's Model Calendar file says about the model itself (`factsOf`): what the overview says of it. */
export function modelFacts(result: AnalysisResult): [setting: string, value: string][] {
  return result.kind === "model" ? result.tables.filter(candidate => candidate.file === MODEL_CALENDAR_FILE).flatMap(factsOf) : [];
}

/** The order of a model's files in the navigation and among the overview's tiles: the order of Anaplan's own Model
 * settings, with the Actions list's files in the order the owner gave. Each file is known by the name model/export.ts
 * writes it under. Dynamic Cell Access is none of Anaplan's settings: it is made from Line Items, and comes right after
 * it. Line Item Subsets is not exported yet, and has its place for when it is. A file of a result that is not listed
 * here comes after these, in the result's own order: a file that is renamed, or new, moves to the end and does not go
 * missing. */
export const MODEL_FILE_ORDER: readonly string[] = [
  MODEL_CALENDAR_FILE, "Time Ranges.csv", "Versions.csv", "General Lists.csv", "Line Item Subsets.csv", MODULES_FILE, LINE_ITEMS_FILE, ACCESS_FILE,
  "Processes.csv", IMPORTS_FILE, "Import Data Sources.csv", "Exports.csv", OTHER_ACTIONS_FILE, SOURCE_MODELS_FILE,
];

/** The result's files as the page lists them, in the navigation and as the overview's tiles: every file but the Details
 * file, each with its place in the result's tables. An app's are in the result's order; a model's in `MODEL_FILE_ORDER`.
 * Only this list is ordered: the result keeps its own order. */
export function listedTables(result: AnalysisResult): { index: number; table: ResultTable }[] {
  const tables = result.tables.map((table, index) => ({ index, table })).filter(({ table }) => table.details !== true);
  if (result.kind !== "model") return tables;
  const rank = (table: ResultTable): number => {
    const place = MODEL_FILE_ORDER.indexOf(table.file);
    return place < 0 ? MODEL_FILE_ORDER.length : place;
  };
  // The sort keeps the result's order among the files that are not listed, and among files of one name.
  return tables.sort((a, b) => rank(a.table) - rank(b.table));
}

/** What the header says was analysed. */
export interface Analysed { name: string; kind: string; host: string | undefined; exportedOn: string | undefined }
export function analysedOf(result: AnalysisResult): Analysed {
  const details = detailsOf(result);
  return {
    name: cellText(result.name), kind: result.kind === "model" ? "Model" : "App",
    host: detailValue(details, "Export", "Anaplan host"), exportedOn: detailValue(details, "Export", "Exported on"),
  };
}

/** The files that list a card's parts, as the design's card details show them: a heading per column, holding one of the
 * file's columns or several put side by side (a dash or a blank among several is left out). */
export const CARD_PARTS: readonly { file: string; title: string; none: string; columns: readonly (readonly [heading: string, headers: readonly string[], join?: string])[] }[] = [
  { file: APP_FILES["Grid sections"], title: "Grid sections", none: "grid sections", columns: [
    ["#", ["Section #"]], ["Layout", ["Section layout"]], ["Source module", ["Source module"]], ["Saved view", ["Saved view"]],
    ["Line items shown", ["Line items shown"]], ["Row filter", ["Row filter"]], ["Formatting", ["Conditional formatting"]]] },
  { file: APP_FILES.Filters, title: "Filters", none: "filters", columns: [
    ["Sec", ["Section #"]], ["Filter on", ["Filter on"]], ["Dimension", ["Filtered dimension"]], ["Group", ["Condition group", "Show items that match"], " · "],
    ["Condition", ["Condition line item", "Operator", "Value"]], ["Context", ["Condition context"]]] },
  { file: APP_FILES.Formatting, title: "Conditional formatting", none: "formatting rules", columns: [
    ["Sec", ["Section #"]], ["Style", ["Format style"]], ["Line item", ["Formatted line item"]], ["Driven by", ["Colour driven by"]], ["Colour stops", ["Colour stops"]]] },
  { file: APP_FILES.Actions, title: "Buttons & links", none: "buttons", columns: [
    ["Label", ["Button label"]], ["Action type", ["Action type"]], ["Model action", ["Model action name"]], ["Runs auto", ["Runs automatically"]], ["Cancel", ["Cancel button"]]] },
];

/** A cell of a card's part: its text, or, for a cell of one column that lists several items, those items, which the drawer
 * lists one to a line (cell-lists.ts). */
export type SectionCell = string | Items;

/** `colours` says for each heading whether it holds a formatting rule's colour stops, as its file's column does. */
export interface CardSection { title: string; none: string; headings: string[]; colours: boolean[]; rows: SectionCell[][] }

/** A card's parts: the rows of the other files that carry its Card ID on its page. A card is known by both, because a
 * page copied in Anaplan may keep its cards' IDs. With `number`, the rows must give that number of the card as well: that
 * is for a card whose page's name and ID another card has too. A file the result does not have, or one without the
 * columns this reads, is left out. A heading that stands for one column of its file has that column's cell, as its items
 * where the cell lists several; one that puts several columns side by side has their texts, as they stand. */
export function cardSections(result: AnalysisResult, page: string, cardId: string, number?: string): CardSection[] {
  const sections: CardSection[] = [];
  for (const part of CARD_PARTS) {
    const table = result.tables.find(candidate => candidate.file === part.file);
    const pageColumn = table && columnIndex(table, "Page");
    const idColumn = table && columnIndex(table, "Card ID");
    const numberColumn = table && number !== undefined ? columnIndex(table, "Card #") : undefined;
    if (!table || pageColumn === undefined || idColumn === undefined || (number !== undefined && numberColumn === undefined)) continue;
    const indexes = part.columns.map(([, headers]) => headers.map(header => columnIndex(table, header)));
    const lists = cellLists(result, table);
    const rows = table.rows.filter(row => cellText(row[idColumn]) === cardId && cellText(row[pageColumn]) === page
      && (numberColumn === undefined || cellText(row[numberColumn]) === number));
    sections.push({
      title: part.title, none: part.none, headings: part.columns.map(([heading]) => heading),
      colours: part.columns.map(([, headers]) => headers.length === 1 && COLUMN_CHOICES.get(part.file)?.get(headers[0])?.kind === "colours"),
      rows: rows.map(row => part.columns.map(([, , join], column): SectionCell => {
        const texts = indexes[column].map(index => (index === undefined ? "" : cellText(row[index])));
        if (texts.length > 1) return texts.filter(text => text !== "" && text !== NONE).join(join ?? " ") || NONE;
        const index = indexes[column][0];
        return (index === undefined ? undefined : lists.get(index)?.(texts[0], row)) ?? texts[0];
      })),
    });
  }
  return sections;
}

/** A card's parts as its drawer shows them, and what the drawer says where it cannot show them. */
export interface CardParts { sections: CardSection[]; note?: string }

/** Words as a sentence lists them: "filters", "filters and buttons", "grid sections, filters and buttons". */
const wordList = (words: readonly string[]): string => (words.length < 2 ? words.join("") : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`);

/** The parts of one card, given by its row of the Cards file. The files have only the name of a card's page, so a card is
 * known by that name, its ID and its number (columns.ts `cardsNamed`). Where pages share a name and a copy kept its
 * cards' numbers and IDs, more than one card is known by the same three, and a row of another file that carries them is
 * a row of any of those cards. Such rows are not listed as this card's: the part is left out, and `note` says so. A part
 * without such a row is one that none of those cards has, so it is listed, empty, as for any card. */
export function cardParts(result: AnalysisResult, cards: CardsTable, row: Row): CardParts {
  const page = cellText(row[cards.page]);
  const cardId = cellText(row[cards.cardId]);
  const number = cards.number === undefined ? undefined : cellText(row[cards.number]);
  // The number is asked of the other files' rows only where the name and the ID are those of several cards.
  const sections = cardSections(result, page, cardId, cardsNamed(cards, page, cardId).length > 1 ? number : undefined);
  const alike = cardsNamed(cards, page, cardId, number).length;
  const open = alike > 1 ? sections.filter(section => section.rows.length > 0) : [];
  if (!open.length) return { sections };
  return {
    sections: sections.filter(section => !open.includes(section)),
    note: `${alike} cards on pages named "${page}" have ${number === undefined ? "this ID" : "this number and this ID"}. `
      + `The tables have only the name of a card's page, so their ${wordList(open.map(section => section.none))} cannot be told apart and are not listed here.`,
  };
}

/** The design's names for the overview's tiles, where a file is one of the app's: shorter than the file's own name, so
 * that a tile's name keeps to one line. Any other file's tile has the file's own label. */
const TILE_LABELS: ReadonlyMap<string, string> = new Map([
  [APP_FILES.Pages, "Pages"], [APP_FILES.Cards, "Cards"], [APP_FILES["Grid sections"], "Grid sections"], [APP_FILES.Filters, "Filters"],
  [APP_FILES.Formatting, "Formatting rules"], [APP_FILES.Actions, "Action buttons"], [APP_FILES["Where used"], "Model objects"],
]);

export interface Overview {
  /** Every file but the Details file, in the navigation's order (`listedTables`), with the number of rows its table lists.
   * Where that is not the number of rows the file has, because its table does not list them all, `inAll` is the file's
   * own number: the tile says both, so the count the Details file gives for the file is on the overview either way. */
  tiles: { label: string; count: number; inAll?: number }[];
  /** The result's notes (`resultNotes`). */
  notes: string[];
  /** About this export: the Details file's rows of every section but its files, its notes, how to read them and the log,
   * in the file's order, but for an app's models, which follow its ID; then what a model's Model Calendar file says about
   * the model (`modelFacts`), without what those
   * rows have said already. A value is as the file has it: one that lists several things, such as an app's categories,
   * has each on a line of its own, and the overview shows its lines. */
  about: [detail: string, value: string][];
  /** The Details file's rows about files, as far as a file's tile does not say the same: a file that was not exported,
   * and a count that comes with a remark. Each is named as the page names the table: by the table's own label where the
   * result has the file, and otherwise by the file's name without its extension. A row that says only how many rows a
   * file of the result has is left to the tile, which says that very number: as its count, or as the rows there are
   * in all where its table lists another number. */
  files: [table: string, value: string][];
  /** How to read these tables: the Details file's rows of that section. */
  howToRead: [detail: string, value: string][];
  /** The diagnostic log the result carries (`diagnosticLog`). */
  log: string[];
}

/** Moves the row of one detail to right after the row of another, where the rows have both. */
function followOn(rows: [detail: string, value: string][], after: string, detail: string): void {
  const from = rows.findIndex(([name]) => name === detail);
  if (from < 0 || !rows.some(([name]) => name === after)) return;
  const [row] = rows.splice(from, 1);
  rows.splice(rows.findIndex(([name]) => name === after) + 1, 0, row);
}

export function overviewOf(result: AnalysisResult): Overview {
  // A tile counts the rows the file's table lists, and says the file's own number beside it where the two differ. The
  // words change no row, so the count needs the file's rule only.
  // In the order of `listedTables`, which is the navigation's: the page opens a tile's table by that order.
  const tiles = listedTables(result).map(({ table }) => {
    const count = ruledView(result, table).table.rows.length;
    return { label: TILE_LABELS.get(table.file) ?? cellText(table.label), count, ...(count === table.rows.length ? {} : { inAll: table.rows.length }) };
  });

  const sections = detailSections(detailsOf(result));
  const rowsOf = (name: string) => sections.find(section => section.section === name)?.rows ?? [];
  const about = sections.filter(section => ![FILES, NOTES, HOW_TO_READ].includes(section.section)).flatMap(section => section.rows);
  for (const fact of modelFacts(result)) {
    if (!about.some(([detail, value]) => detail === fact[0] && value === fact[1])) about.push(fact);
  }
  // What an app is built on is said with what the app is: its models follow its ID, before its categories and pages.
  if (result.kind === "app") followOn(about, "App ID", "Models");
  // A Files row that says only the file's own number of rows is said by the file's tile. The Details file says "1 rows"
  // too: a count is the file's number of rows and the word, whatever the number.
  const onlyCounted = new Map(result.tables.map(table => [table.file, `${table.rows.length} rows`]));
  // A row names its file, extension and all, which no user is to see: it is said under the name the page has for the table.
  const labels = new Map(result.tables.map(table => [table.file, cellText(table.label)]));
  const files = rowsOf(FILES).filter(([file, value]) => onlyCounted.get(file) !== value)
    .map(([file, value]): [string, string] => [labels.get(file) ?? withoutExtension(file), value]);
  return { tiles, notes: resultNotes(result), about, files, howToRead: rowsOf(HOW_TO_READ), log: diagnosticLog(detailsOf(result)) };
}
