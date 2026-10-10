import { knownNames, knownSequence, type KnownNames } from "../map/graph-names.js";
import { PAGE_FILTERS_FILE } from "../page-files.js";
import type { TabName } from "../report.js";
import type { AnalysisResult, ResultTable } from "../result-types.js";
import { APP_FILES, columnIndex } from "./columns.js";
import { LINE_ITEMS_FILE } from "./line-items-view.js";
import { cellText, type Row } from "./table-engine.js";

/** What a cell lists, item by item, for the drawer. Many cells of a result hold several items in one text: the dimensions
 * a line item applies to, what refers to it, a card's context selectors or its formatting rules. A table shows such a cell
 * as its text, and its search, its sort and its filters read that text as they read any cell. The drawer, where a row is
 * read in full, lists the items one to a line. Nothing here changes a cell: it only says where a cell's text divides.
 *
 * No item is guessed. A cell is cut only where the producer of its column put the separator between two items, and only
 * where that separator cannot stand inside an item:
 * - An app's tables are the report's (report.ts), which joins the items of a column with a separator of its own, "; " in
 *   some columns and " | " in others. Its items often hold a comma and a space themselves ("Territory (visible, synced to
 *   page)"), so an app's column is cut at a comma only where its items are the report's own words and nothing else. The
 *   report does not mark a separator that stands inside a name, so a name that holds one is cut there as well: nothing in
 *   the cell's text tells the two apart.
 * - A model's tables are Anaplan's own grids. A cell that names other objects writes them with a comma and a space between
 *   them, each name in single quotes where it needs them, with a quote of its own doubled (map/graph-names.ts), so a comma
 *   inside the quotes is the name's. Such a cell is cut only outside its quotes, and not at all where its quotes do not
 *   pair up: then where a name ends cannot be told.
 * - A model's cell that writes names without quotes, an action's Used in Processes, is cut only where every part is a name
 *   the result has, of the kind the column names, and the cell reads only one way: the model map reads it so too.
 * - The Model Calendar is the assessment template, whose lists are its own words (model/calendar.ts).
 * A cell that does not read as a list of two items or more is shown whole: one with a single item, an empty one, the dash
 * that says there is nothing, and any other. The items are the cell's own text and nothing else: written one after another
 * with the separator between them, they are the cell again. A file is known by the name its producer writes it under, and
 * a column by its header, never by a text that a user typed. */

/** A cell's items, in the cell's order: what the drawer lists one to a line. */
export type Items = readonly string[];

/** How the cells of one column list their items: a cell's items, or nothing for a cell that is not cut. The row is the
 * cell's own, for a column in which the separator depends on what the row is. */
export type CellList = (text: string, row: Row) => Items | undefined;

/** What makes a column's `CellList` for one of a result's tables, or nothing where the table or the result lacks what
 * that takes: then the column's cells are shown whole. */
type ListRule = (table: ResultTable, result: AnalysisResult) => CellList | undefined;

/** Parts that make a list: two or more, none of them empty or only spaces. A text that divides otherwise is not a list as
 * its producer writes one. */
const asList = (parts: string[]): Items | undefined => (parts.length > 1 && parts.every(part => part.trim() !== "") ? parts : undefined);

/** A text cut at every `separator`, for a column whose producer puts that separator between two items and nowhere else
 * of its own. */
const cut = (text: string, separator: string): Items | undefined => asList(text.split(separator));

const OPENS = "([{";
const CLOSES = ")]}";

/** A model's cell that names objects, cut at each comma and space outside its single quotes and, with `brackets`, outside
 * round, square and curly brackets as well. Two quotes inside a quoted name end the quoted text and open it again at once,
 * so nothing between them is cut: the model map reads a cell the same way (map/graph-names.ts `splitOutside`). Nothing
 * where the quotes or the brackets do not pair up: the cell is then not written as the export writes names, and a comma in
 * it may be a name's. */
function cutOutside(text: string, brackets: boolean): Items | undefined {
  const parts: string[] = [];
  let start = 0;
  let quoted = false;
  let depth = 0;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (character === "'") quoted = !quoted;
    else if (quoted) continue;
    else if (brackets && OPENS.includes(character)) depth++;
    else if (brackets && CLOSES.includes(character)) {
      if (depth === 0) return undefined;
      depth--;
    } else if (depth === 0 && character === "," && text[index + 1] === " ") {
      parts.push(text.slice(start, index));
      start = index + 2;
    }
  }
  if (quoted || depth > 0) return undefined;
  parts.push(text.slice(start));
  return asList(parts);
}

/** A model's cell that writes names without quotes, with a comma and a space between them, where a name may hold a comma
 * and a space itself ("Nightly load, full" is one process). It is cut only into names of `known`, where the cell reads
 * only one way (map/graph-names.ts `knownSequence`): a part that is no known name may hold a comma of its own, and a cell
 * with such a part is not cut at all. The names must make up the whole cell, so nothing of it is left out. */
function cutKnown(text: string, known: KnownNames): Items | undefined {
  const names = knownSequence(text, known);
  if (!names || names.some(name => !name.known)) return undefined;
  const parts = names.map(name => name.name);
  return parts.join(", ") === text ? asList(parts) : undefined;
}

/* ---------- the separators ---------- */

/** The separators that the producers write between two items of a column. */
const SEMICOLON = "; ";
const BAR = " | ";
const COMMA = ", ";
const MIDDLE_DOT = " · ";

/** A column whose items are joined with one separator in every row. */
const joinedWith = (separator: string): ListRule => () => text => cut(text, separator);

/* ---------- an app's tables (report.ts) ---------- */

/** What the report writes after a combined grid's View type, and after no other card's: its number of sections
 * (report.ts `buildReport`, `viewLabel`). A combined grid has two sections or more. */
const COMBINED = / \(\d+ sections\)$/;

/** A Cards column whose items the report joins with " | " in a combined grid's row, one item for each section, and with
 * "; " in any other card's row (report.ts `buildReport`: `combined ? " | " : "; "`). A section's item may hold "; " itself,
 * between that section's own items, and stays one item: it says which section they are. Which of the two a row has is read
 * from its View type, which is the report's own words. A table without that column has none of these cells cut. */
const byCard: ListRule = table => {
  const viewType = columnIndex(table, "View type");
  return viewType === undefined ? undefined : (text, row) => cut(text, COMBINED.test(cellText(row[viewType])) ? BAR : SEMICOLON);
};

/** The start of the Format style the report writes for a KPI card's indicator (report.ts `formattingRows`). Only a grid's
 * rule lists its colour stops, each a value and its colour; an indicator's row says in one sentence what it has instead
 * ("3 icons (arrow up, flag red); no threshold values set"), and that sentence is not cut. */
const KPI_INDICATOR = "KPI indicator";

/** Colour stops, joined with "; " (report.ts `cfRuleText`), but in a KPI indicator's row. A table without a Format style
 * column, which tells the two apart, has none of them cut. */
const colourStops: ListRule = table => {
  const style = columnIndex(table, "Format style");
  return style === undefined ? undefined : (text, row) => (cellText(row[style]).startsWith(KPI_INDICATOR) ? undefined : cut(text, SEMICOLON));
};

/** The app's columns that list items, by the report table they are in and their header (report.ts `HEADERS`), each with
 * how its items are joined. Many a column of the report holds one item that lists something in words, and is not cut:
 * - one sentence about a whole: a section's layout ("Beside section 2 (same rows); above or below section 3 (same
 *   columns)"), its line items, its row and column filters and its formatting rules, a filter's sections ("1, 2 (shared
 *   rows)") and a card's text;
 * - names or values with a comma and a space between them, which a name or a value may hold as well: a filter's
 *   dimensions, its line item when it is several items, and its values.
 * Every other column holds one value. */
const APP_LISTS: Record<TabName, Record<string, ListRule>> = {
  // The number of each kind of view on the page, in the report's words alone: "1 custom view, 2 saved views".
  Pages: { "Grid & chart views": joinedWith(COMMA) },
  Cards: {
    "Source module(s)": byCard, "Line items shown": byCard, Rows: byCard, Columns: byCard, "Context selectors": byCard,
    Filters: joinedWith(BAR), "Sorts & hidden items": joinedWith(SEMICOLON), "Conditional formatting": joinedWith(BAR), "Buttons & links": joinedWith(BAR),
    "Card settings": joinedWith(MIDDLE_DOT), "Source IDs": joinedWith(SEMICOLON),
  },
  "Grid sections": { Rows: joinedWith(SEMICOLON), Columns: joinedWith(SEMICOLON), "Context selectors": joinedWith(SEMICOLON), "Sorts & hidden items": joinedWith(SEMICOLON) },
  Filters: { "Filtered module": joinedWith(SEMICOLON), "Condition context": joinedWith(SEMICOLON) },
  Formatting: { "Colour stops": colourStops },
  Actions: {},
  "Where used": {},
};

/* ---------- a model's tables (Anaplan's own grids, model/export.ts) ---------- */

/** A cell that names objects, cut outside its quotes. */
const names: ListRule = () => text => cutOutside(text, false);

/** A list's Properties: each property's name, a colon and its format, where a format may hold a comma in brackets ("Rate:
 * NUMBER (2 dp, %)"). Cut outside quotes and brackets, as the model map reads the column (map/build-graph.ts `readLists`). */
const properties: ListRule = () => text => cutOutside(text, true);

/** The files of a model's export, by the names model/export.ts writes them under, which result-view.ts `MODEL_FILE_ORDER`
 * lists. They are named here, as the model map names them (map/build-graph.ts), because result-view.ts reads this module
 * for a card's parts and so cannot be read by it; a test holds each of them to that list. */
const LISTS_FILE = "General Lists.csv";
const MODULES_FILE = "Modules.csv";
const PROCESSES_FILE = "Processes.csv";
const IMPORTS_FILE = "Imports.csv";
const DATA_SOURCES_FILE = "Import Data Sources.csv";
const EXPORTS_FILE = "Exports.csv";
const OTHER_ACTIONS_FILE = "Other Actions.csv";
const CALENDAR_FILE = "Model Calendar.csv";

/** A column that names rows of `file` without quotes: its cells are cut only into names that file's rows have (the name is
 * a row's first cell). Without the file, or with none of its rows, nothing is known to cut by. */
const namesIn = (file: string): ListRule => (_table, result) => {
  const rows = result.tables.find(table => table.file === file)?.rows ?? [];
  if (!rows.length) return undefined;
  const known = knownNames(new Set(rows.map(row => cellText(row[0])).filter(name => name !== "")));
  return text => cutKnown(text, known);
};
const usedInProcesses = namesIn(PROCESSES_FILE);

/** A model's columns that list items, by file and header. The names a cell gives are written as the export writes names
 * (map/graph-names.ts), which the model map reads in the same columns: a list's subsets, its properties and the three
 * columns that say what uses it, and what a module or a line item applies to and what refers to a line item. An action's
 * processes, and a data source's imports, are named without quotes, and are cut into the names of the Processes and the
 * Imports tables. The Model Calendar's list is the template's: its allowed values, joined with " | ", since a value may
 * hold a comma ("Weeks: 4-4-5, 4-5-4 or 5-4-4"). The kinds of calendar a row applies to are the template's guidance,
 * which the page leaves out (result-view.ts `CALENDAR_GUIDANCE`).
 *
 * Some columns that may list names are not cut, since nothing says how they write a name that holds a comma and the
 * result has no names of their kind to cut by: an action's Used in Dashboards, and a line item's Data Tags. A list's
 * Parent Hierarchy is one name, as are a driver and a format's list. */
const MODEL_LISTS: Record<string, Record<string, ListRule>> = {
  // An app's Filters rows with their app (page-files.ts): its cells list as that table's do, column by column.
  [PAGE_FILTERS_FILE]: APP_LISTS.Filters,
  [LISTS_FILE]: { Subsets: names, Properties: properties, "Referenced in Applies To": names, "Referenced as Format": names, "Referenced in Formula": names },
  [MODULES_FILE]: { "Applies To": names },
  [LINE_ITEMS_FILE]: { "Applies To": names, "Referenced By": names },
  [PROCESSES_FILE]: { "Used in Processes": usedInProcesses },
  [IMPORTS_FILE]: { "Used in Processes": usedInProcesses },
  [DATA_SOURCES_FILE]: { "Used in Imports": namesIn(IMPORTS_FILE) },
  [EXPORTS_FILE]: { "Used in Processes": usedInProcesses },
  [OTHER_ACTIONS_FILE]: { "Used in Processes": usedInProcesses },
  [CALENDAR_FILE]: { "Allowed values": joinedWith(BAR) },
};

/** File name -> header -> rule, for each kind of result. Maps, so that a file or a header with the name of an object's
 * built-in property finds nothing. A rule is for its kind's files only: an app's file is never read by a model's rule. */
export const LISTED_COLUMNS: Record<AnalysisResult["kind"], ReadonlyMap<string, ReadonlyMap<string, ListRule>>> = {
  app: new Map((Object.keys(APP_LISTS) as TabName[]).map(tab => [APP_FILES[tab], new Map(Object.entries(APP_LISTS[tab]))])),
  model: new Map(Object.entries(MODEL_LISTS).map(([file, columns]) => [file, new Map(Object.entries(columns))])),
};

/** How the columns of one of the result's tables list their items, by the column's place: only the columns whose cells
 * can list several items. The table is the one the page shows (result-view.ts `fileView`), whose columns may stand in
 * other places than in the file: a column is known by its header wherever it stands. */
export function cellLists(result: AnalysisResult, table: ResultTable): ReadonlyMap<number, CellList> {
  const lists = new Map<number, CellList>();
  const rules = LISTED_COLUMNS[result.kind]?.get(table.file);
  if (!rules) return lists;
  table.headers.forEach((header, index) => {
    const list = rules.get(cellText(header))?.(table, result);
    if (list) lists.set(index, list);
  });
  return lists;
}

/** The cells of a row that list several items, each with its items, by the column's place: what the row's drawer lists
 * one to a line. A row with none gives an empty map, and its drawer is as it would be without lists. */
export function rowItems(lists: ReadonlyMap<number, CellList>, row: Row): ReadonlyMap<number, Items> {
  const items = new Map<number, Items>();
  for (const [index, list] of lists) {
    const found = list(cellText(row[index]), row);
    if (found) items.set(index, found);
  }
  return items;
}
