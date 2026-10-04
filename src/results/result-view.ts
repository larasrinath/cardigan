import type { AnalysisResult, Cell, ResultTable } from "../result-types.js";
import { APP_FILES, cardsNamed, columnIndex, type CardsTable } from "./columns.js";
import { LINE_ITEMS_FILE, lineItemsView } from "./line-items-view.js";
import { READABLE_HEADERS, readableCell, type CellNames } from "./readable-cells.js";
import { cellText, compareText, NONE, type Row } from "./table-engine.js";

/** What the results page reads out of a result besides its tables: the Details file's sections, the diagnostic log, and
 * what the overview says: its counts and notes, and everything the Details file holds, which has no view of its own.
 * Everything is taken from cells as they stand: nothing is split out of a joined text. */

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

/** The summary lines that say what a Files row of the Details file says. A model's summary lists every file, and the
 * export writes each file's line and its Files row from the same words (model/export.ts): "Imports: 3 rows (2 matched in
 * the Actions list)" beside the row "Imports.csv", "3 rows (2 matched in the Actions list)"; and for a file that was not
 * exported, "Source Models: not exported (reason)." beside "Source Models.csv", "Not exported: reason". */
function saidWithFiles(details: ResultTable | undefined): Set<string> {
  const lines = new Set<string>();
  for (const row of details?.rows ?? []) {
    if (cellText(row[0]) !== FILES) continue;
    const label = cellText(row[1]).replace(/\.csv$/, "");
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
 *   Files or as the file's tile. */
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
 * that table is not the file as it stands. What the page counts, searches, filters and opens is this table; the CSV, as a
 * table's download and in the zip, is always the file as the export wrote it. */
export interface FileView {
  table: ResultTable;
  note?: string;
  /** For a table that lists no row although its file has rows, because the file's rule leaves every one of them to the
   * CSV: what the table says in the rows' place. The file was read and has rows, which `note` counts, so the table must
   * not say that nothing was found. */
  none?: string;
  /** For the cells of `table` that the page says in words: the text the CSV has in each one's place, by the row as `table`
   * holds it and by the column's place in it. A row's drawer shows both. None when no cell is said in words. */
  exported?: ReadonlyMap<readonly Cell[], ReadonlyMap<number, Cell>>;
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

const calendarView: FileRule = file => {
  const about = columnIndex(file, "Section");
  if (about === undefined) return undefined;
  const rows = file.rows.filter(row => cellText(row[about]) !== ABOUT_MODEL);
  const left = file.rows.length - rows.length;
  if (!left) return undefined;
  // The line says where the rows are, so that the table's count is not taken for the file's.
  const note = `${left} ${left === 1 ? "row about the model is" : "rows about the model are"} in the CSV only.`;
  return { table: { ...file, rows }, note, ...(rows.length ? {} : { none: "Every row of the file is about the model." }) };
};

/** A model's Modules file, which lists every module (model/export.ts writes it under this name). */
export const MODULES_FILE = "Modules.csv";

/** A model's Line Items file is every module's blueprint in one grid: a module's own row, then its line items. The page
 * shows it as a table of line items, each with its module and the dimensions it really has (line-items-view.ts), and the
 * line under the table's name says how many modules' rows that leaves to the CSV.
 *
 * The view is given the modules' names where the result has them: the first column of the Modules file, as the file has
 * it. A row that holds nothing but a name is then a module's own row only when the name is a module's, and otherwise a
 * line item whose module is not known, which stays in the table. A result without the Modules file, or with one that
 * lists nothing, has no names to give, and every such row is taken for a module's own.
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
  const none = view.table.rows.length ? {} : { none: "Every row of the file is a module's own: no module has a line item." };
  return { table: view.table, note: view.note === undefined ? undefined : `${view.note}${where}`, ...none };
};

/** The files the page shows otherwise than as they stand, each with its rule, by the kind of result and the file's name.
 * No other file is touched: a rule is a file's own, not a filter over all of them. */
export const FILE_RULES: Record<AnalysisResult["kind"], ReadonlyMap<string, FileRule>> = {
  app: new Map(),
  model: new Map([[MODEL_CALENDAR_FILE, calendarView], [LINE_ITEMS_FILE, lineItemsRule]]),
};

/** One of the result's files by its rule alone, or as it stands: the rows the page lists, before any cell is said in words. */
const ruledView = (result: AnalysisResult, file: ResultTable): FileView => FILE_RULES[result.kind].get(file.file)?.(file, result) ?? { table: file };

/** The Line Items file's columns that name what a Ratio summary divides (model/lineitems.ts adds them to the grid's own). */
const RATIO_NUMERATOR = "Ratio Numerator";
const RATIO_DENOMINATOR = "Ratio Denominator";
/** The Line Items file's column that names the list of a line item formatted as a list (model/lineitems.ts adds it after
 * those two). It is empty for a list the export could not name. */
const FORMAT_LIST = "Format List";

/** A model's table with its definitions said in words. Some cells of a model's grids hold a definition as JSON, because
 * Anaplan's own export of the grid writes that: a line item's Format and its Summary, an action's definition. The words
 * for such a cell (readable-cells.ts) take its place in the table, so the page searches, filters and sorts by them, and
 * `exported` keeps the text the CSV has. A cell the words are not known for stays as it is, and a row without such a cell
 * is the table's own row. A Ratio is said with the names in its own row's Ratio Numerator and Ratio Denominator cells. A
 * line item's list format is said with the name in its own row's Format List cell, and by the list's ID where that cell
 * is empty or the file has no such column. A result holds no names of lists by their IDs, so any other list is said by
 * its ID. */
function inWords(view: FileView): FileView {
  const { table } = view;
  const readable = table.headers.flatMap((header, index) => (READABLE_HEADERS.some(known => known === header) ? [index] : []));
  if (!readable.length) return view;
  const numerator = columnIndex(table, RATIO_NUMERATOR);
  const denominator = columnIndex(table, RATIO_DENOMINATOR);
  const formatList = table.file === LINE_ITEMS_FILE ? columnIndex(table, FORMAT_LIST) : undefined;
  const exported = new Map<readonly Cell[], Map<number, Cell>>();
  const rows = table.rows.map(row => {
    // The row's Format is the one cell of it that names a list, so the name is given whatever ID is asked for.
    const list = formatList === undefined ? "" : cellText(row[formatList]);
    const names: CellNames = { ratioNumerator: numerator === undefined ? undefined : cellText(row[numerator]), ratioDenominator: denominator === undefined ? undefined : cellText(row[denominator]),
      listName: list === "" ? undefined : () => list };
    let said: Cell[] | undefined;
    const texts = new Map<number, Cell>();
    for (const index of readable) {
      const words = readableCell(table.headers[index], row[index], names);
      if (words === undefined) continue;
      said ??= [...row];
      said[index] = words;
      texts.set(index, row[index]);
    }
    if (said) exported.set(said, texts);
    return said ?? row;
  });
  return exported.size ? { ...view, table: { ...table, rows }, exported } : view;
}

/** One of the result's files as the page shows it: by its rule, or as it stands, and for a model's result with its
 * definitions said in words, which comes after the rule (a rule moves columns and rows, and keeps the columns' names). An
 * app's tables are never put into words: its columns of those names hold other things. */
export function fileView(result: AnalysisResult, file: ResultTable): FileView {
  const view = ruledView(result, file);
  return result.kind === "model" ? inWords(view) : view;
}

/** What a model's Model Calendar file says about the model itself: each setting with its value, in the file's order. A
 * setting without a value, as the export leaves the ones it cannot know, is left out. */
export function modelFacts(result: AnalysisResult): [setting: string, value: string][] {
  const facts: [string, string][] = [];
  for (const table of result.kind === "model" ? result.tables.filter(candidate => candidate.file === MODEL_CALENDAR_FILE) : []) {
    const about = columnIndex(table, "Section");
    const setting = columnIndex(table, "Setting");
    const value = columnIndex(table, "Value");
    if (about === undefined || setting === undefined || value === undefined) continue;
    for (const row of table.rows) {
      if (cellText(row[about]) === ABOUT_MODEL && cellText(row[value]).trim() !== "") facts.push([cellText(row[setting]), cellText(row[value])]);
    }
  }
  return facts;
}

/** The order of a model's files in the navigation and among the overview's tiles: the order of Anaplan's own Model
 * settings, with the Actions list's files in the order the owner gave. Each file is known by the name model/export.ts
 * writes it under. Line Item Subsets is not exported yet, and has its place for when it is. A file of a result that is
 * not listed here comes after these, in the result's own order: a file that is renamed, or new, moves to the end and
 * does not go missing. */
export const MODEL_FILE_ORDER: readonly string[] = [
  MODEL_CALENDAR_FILE, "Time Ranges.csv", "Versions.csv", "General Lists.csv", "Line Item Subsets.csv", MODULES_FILE, LINE_ITEMS_FILE,
  "Processes.csv", "Imports.csv", "Import Data Sources.csv", "Exports.csv", "Other Actions.csv", "Source Models.csv",
];

/** The result's files as the page lists them, in the navigation and as the overview's tiles: every file but the Details
 * file, each with its place in the result's tables. An app's are in the result's order; a model's in `MODEL_FILE_ORDER`.
 * Only this list is ordered: the zip keeps the result's own order. */
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

export interface CardSection { title: string; none: string; headings: string[]; rows: string[][] }

/** A card's parts: the rows of the other files that carry its Card ID on its page. A card is known by both, because a
 * page copied in Anaplan may keep its cards' IDs. With `number`, the rows must give that number of the card as well: that
 * is for a card whose page's name and ID another card has too. A file the result does not have, or one without the
 * columns this reads, is left out. */
export function cardSections(result: AnalysisResult, page: string, cardId: string, number?: string): CardSection[] {
  const sections: CardSection[] = [];
  for (const part of CARD_PARTS) {
    const table = result.tables.find(candidate => candidate.file === part.file);
    const pageColumn = table && columnIndex(table, "Page");
    const idColumn = table && columnIndex(table, "Card ID");
    const numberColumn = table && number !== undefined ? columnIndex(table, "Card #") : undefined;
    if (!table || pageColumn === undefined || idColumn === undefined || (number !== undefined && numberColumn === undefined)) continue;
    const indexes = part.columns.map(([, headers]) => headers.map(header => columnIndex(table, header)));
    const rows = table.rows.filter(row => cellText(row[idColumn]) === cardId && cellText(row[pageColumn]) === page
      && (numberColumn === undefined || cellText(row[numberColumn]) === number));
    sections.push({
      title: part.title, none: part.none, headings: part.columns.map(([heading]) => heading),
      rows: rows.map(row => part.columns.map(([, , join], column) => {
        const texts = indexes[column].map(index => (index === undefined ? "" : cellText(row[index])));
        return texts.length === 1 ? texts[0] : texts.filter(text => text !== "" && text !== NONE).join(join ?? " ") || NONE;
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
      + `The CSV has only the name of a card's page, so their ${wordList(open.map(section => section.none))} cannot be told apart and are not listed here.`,
  };
}

/** The design's names for the overview's tiles, where a file is one of the app's: shorter than the file's own name, so
 * that a tile's name keeps to one line. Any other file's tile has the file's own label. */
const TILE_LABELS: ReadonlyMap<string, string> = new Map([
  [APP_FILES.Pages, "Pages"], [APP_FILES.Cards, "Cards"], [APP_FILES["Grid sections"], "Grid sections"], [APP_FILES.Filters, "Filters"],
  [APP_FILES.Formatting, "Formatting rules"], [APP_FILES.Actions, "Action buttons"], [APP_FILES["Where used"], "Where Used"],
]);

export interface ModelRow { model: string; workspace: string; modelId: string }
export interface Overview {
  /** Every file but the Details file, in the navigation's order (`listedTables`), with the number of rows its table lists.
   * Where that is not the number of rows the file has, because its table leaves rows to the CSV, `inCsv` is the file's own
   * number: the tile says both, so the count the Details file gives for the file is on the overview either way. */
  tiles: { label: string; count: number; inCsv?: number }[];
  /** An app's cards by the text of their Card type, most first. */
  cardTypes: [type: string, count: number][];
  /** An app's models: each different Model, Workspace and Model ID its pages name, in the pages' order. */
  models: ModelRow[];
  /** The result's notes (`resultNotes`). */
  notes: string[];
  /** About this export: the Details file's rows of every section but its files, its notes, how to read them and the log,
   * in the file's order; then what a model's Model Calendar file says about the model (`modelFacts`), without what those
   * rows have said already. */
  about: [detail: string, value: string][];
  /** The Details file's rows about files, as far as a file's tile does not say the same: a file that was not exported,
   * and a count that comes with a remark. A row that says only how many rows a file of the result has is left to the tile,
   * which says that very number: as its count, or as the rows the CSV has where its table lists another number. */
  files: [file: string, value: string][];
  /** How to read these files: the Details file's rows of that section. */
  howToRead: [detail: string, value: string][];
  /** The diagnostic log the result carries (`diagnosticLog`). */
  log: string[];
}

export function overviewOf(result: AnalysisResult): Overview {
  // A tile counts the rows the file's table lists, and says the file's own number beside it where the two differ. The
  // words change no row, so the count needs the file's rule only.
  const tiles = listedTables(result).map(({ table }) => {
    const count = ruledView(result, table).table.rows.length;
    return { label: TILE_LABELS.get(table.file) ?? cellText(table.label), count, ...(count === table.rows.length ? {} : { inCsv: table.rows.length }) };
  });

  const counts = new Map<string, number>();
  const cards = result.tables.find(table => table.file === APP_FILES.Cards);
  const type = cards && columnIndex(cards, "Card type");
  if (cards && type !== undefined) {
    for (const row of cards.rows) counts.set(cellText(row[type]), (counts.get(cellText(row[type])) ?? 0) + 1);
  }
  const cardTypes = [...counts].sort(([a, x], [b, y]) => y - x || compareText(a, b));

  const models = new Map<string, ModelRow>();
  const pages = result.tables.find(table => table.file === APP_FILES.Pages);
  const model = pages && columnIndex(pages, "Model");
  const workspace = pages && columnIndex(pages, "Workspace");
  const modelId = pages && columnIndex(pages, "Model ID");
  if (pages && model !== undefined && workspace !== undefined && modelId !== undefined) {
    for (const row of pages.rows) {
      const entry = { model: cellText(row[model]), workspace: cellText(row[workspace]), modelId: cellText(row[modelId]) };
      // A page that names no model at all (a dash in all three columns) is not a model.
      if (Object.values(entry).every(value => value === "" || value === NONE)) continue;
      const key = JSON.stringify(entry);
      if (!models.has(key)) models.set(key, entry);
    }
  }
  const sections = detailSections(detailsOf(result));
  const rowsOf = (name: string) => sections.find(section => section.section === name)?.rows ?? [];
  const about = sections.filter(section => ![FILES, NOTES, HOW_TO_READ].includes(section.section)).flatMap(section => section.rows);
  for (const fact of modelFacts(result)) {
    if (!about.some(([detail, value]) => detail === fact[0] && value === fact[1])) about.push(fact);
  }
  // A Files row that says only the file's own number of rows is said by the file's tile. The Details file says "1 rows"
  // too: a count is the file's number of rows and the word, whatever the number.
  const onlyCounted = new Map(result.tables.map(table => [table.file, `${table.rows.length} rows`]));
  const files = rowsOf(FILES).filter(([file, value]) => onlyCounted.get(file) !== value);
  return { tiles, cardTypes, models: [...models.values()], notes: resultNotes(result), about, files, howToRead: rowsOf(HOW_TO_READ), log: diagnosticLog(detailsOf(result)) };
}
