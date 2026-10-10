import { FILTER_USES, MODEL_PAGE_FILES, MODULE_USAGE_FILE, PAGE_ACTIONS_FILE, PAGE_FILTERS_FILE, PAGE_PLACE_HEADERS } from "../page-files.js";
import type { TabName } from "../report.js";
import type { AnalysisResult, ResultTable } from "../result-types.js";
import { FORMAT_TYPE, LINE_ITEMS_FILE } from "./line-items-view.js";
import { cellText, filterItems, type ItemsOf, type Row } from "./table-engine.js";

/** The names of an app export's files, by the report table each holds. The analysis writes its files under these names
 * (analyse.ts), and whatever the page knows about one of them, here or in result-view.ts, is keyed by a name from this
 * one place. A model's files are not named anywhere: the page knows nothing about any of them in particular. */
export const APP_FILES: Record<TabName, string> = {
  Pages: "Pages.csv", Cards: "Cards.csv", "Grid sections": "Grid Sections.csv", Filters: "Filters.csv", Formatting: "Conditional Formatting.csv",
  Actions: "Action Buttons.csv", "Where used": "Where Used.csv",
};

/** How the results page shows each column. Columns come from a table's headers. The design's choices for the app's seven
 * files are kept by header name: which columns offer a filter, which start hidden, which are numbers, and which are shown
 * as an ID to copy, a tag, a link or a count. Every cell shows its own text whatever the choice; a count shows it with its
 * thousands apart. Of a model export's files the page knows only the columns that count something (`MODEL_COUNTS`), those
 * that start hidden (`MODEL_HIDDEN`) and those that always offer a filter (`MODEL_FILTERED`); the tables of the pages
 * built on a model are shown as the app's tables they are made from (`PAGE_FILE_CHOICES`). A file or a header that is
 * not listed here gets a plain text column. In any file, almost every column offers a filter by what it holds as well
 * (`offersFilter`): one with a few different texts always, and one with many unless it is a row's name or a code, free
 * text, an ID or a measure. A column whose cells list items is filtered by each item.
 *
 * Two kinds of column start hidden in every one of the app's tables: the IDs, and what only numbers a row's place, a
 * card's number and a section's (`NUMBERS_HIDDEN`). A row says where it belongs in words, by its page and its card's
 * title or its own name. A hidden column is still in the column chooser, in the search and in the row's drawer. */

/** How a column's cells are shown: as plain text, an ID to copy, a tag, a link to a page or to a card, a formatting rule's
 * colour stops, each colour as a small square of that colour before its code, or a count, which is a number of things
 * shown with its thousands apart (table-engine.ts `groupedCount`). A count's column is right-aligned as any number's is,
 * and sorts as numbers wherever its cells are numbers, as any column does: the cells are not changed. A number that only
 * names or places something, as a card's number, an ID, a year or a code, is no count. */
export type ColumnKind = "text" | "id" | "tag" | "page" | "card" | "colours" | "count";

export interface Column {
  /** The column's position in the table's headers and in each row. */
  index: number;
  /** The name the page shows: the header, or a name of the page's own for a header that is empty. Every file of a model
   * starts with such a column, the one that names each row. The file keeps the empty header. */
  label: string;
  kind: ColumnKind;
  /** Right-aligned, as the design shows numbers. */
  num: boolean;
  /** Offers a filter on its values: by the design's choice, or by what it holds (`offersFilter`). */
  filter: boolean;
  /** Hidden until chosen in the column chooser. */
  hidden: boolean;
  /** Whether the dash alone in a cell (table-engine.ts `NONE`) says that there is nothing, as the page shows it, greyed: so
   * in a table of one of the app's files (`writesNone`). In any other table the dash is the cell's text like any other. */
  none: boolean;
}

interface Choice { kind?: ColumnKind; num?: true; filter?: true; hidden?: true }

/** The numbers that start hidden, by their header, wherever one of the app's tables has them. */
export const NUMBERS_HIDDEN: readonly string[] = ["Card #", "Section #"];

const PAGE: Choice = { kind: "page", filter: true };
/** A card's number where the row also holds the card's ID: it opens the card, from the row's drawer while it is hidden. */
const CARD_NUMBER: Choice = { kind: "card", num: true, hidden: true };
const COUNT: Choice = { kind: "count", num: true };
const HIDDEN_NUM: Choice = { num: true, hidden: true };
const FILTER: Choice = { filter: true };
const TAG: Choice = { kind: "tag", filter: true };
const HIDDEN_ID: Choice = { kind: "id", hidden: true };
const COLOURS: Choice = { kind: "colours" };

const CHOICES: Record<TabName, Record<string, Choice>> = {
  Pages: {
    "Category": FILTER, "Page": { kind: "page" }, "Page type": TAG, "Publish state": FILTER, "Model": FILTER,
    "Total cards": COUNT, "Grid cards": COUNT, "Chart cards": COUNT, "KPI cards": COUNT, "Field cards": COUNT, "Action cards": COUNT, "Text & image cards": COUNT,
    "Page ID": HIDDEN_ID, "App ID": HIDDEN_ID, "Model ID": HIDDEN_ID,
  },
  Cards: {
    "Page": PAGE, "Card #": CARD_NUMBER, "Card title": { kind: "card" }, "Card type": TAG, "View type": TAG, "Conditional formatting": COLOURS,
    "Card ID": HIDDEN_ID, "Source IDs": { hidden: true },
  },
  "Grid sections": {
    "Page": PAGE, "Card #": CARD_NUMBER, "View type": TAG, "Section #": HIDDEN_NUM, "Section layout": FILTER,
    "Card ID": HIDDEN_ID, "Section ID": HIDDEN_ID, "Module ID": HIDDEN_ID,
  },
  Filters: {
    "Page": PAGE, "Card #": CARD_NUMBER, "Section #": HIDDEN_NUM, "Filter on": TAG, "Filtered dimension": FILTER, "Show items that match": TAG,
    "Operator": FILTER, "Card ID": HIDDEN_ID, "Line item ID": HIDDEN_ID,
  },
  Formatting: {
    "Page": PAGE, "Card #": CARD_NUMBER, "Section #": HIDDEN_NUM, "Format style": TAG, "Colour stops": COLOURS, "Card ID": HIDDEN_ID, "Line item ID": HIDDEN_ID,
  },
  Actions: {
    "Page": PAGE, "Card #": CARD_NUMBER, "Action type": TAG, "Name source": FILTER, "Runs automatically": FILTER, "Cancel button": FILTER,
    "Card ID": HIDDEN_ID, "Action ID": HIDDEN_ID,
  },
  // Where Used has no Card ID, so by its own columns its Card # is a number only. Listed as every use, the page makes it
  // the link to the card in each row whose card the view of the file names (main.ts `showResult`).
  "Where used": {
    "Object type": TAG, "Page": PAGE, "Card #": HIDDEN_NUM, "Used as": FILTER, "Object ID": HIDDEN_ID,
  },
};

/** File name -> header -> choice. The file names are the app export's (`APP_FILES`), the headers are report.ts `HEADERS`.
 * Maps, so that a file or a header with the name of an object's built-in property finds nothing. */
export const COLUMN_CHOICES: ReadonlyMap<string, ReadonlyMap<string, Choice>> = new Map(
  (Object.keys(CHOICES) as TabName[]).map((tab): [string, ReadonlyMap<string, Choice>] => [APP_FILES[tab], new Map(Object.entries(CHOICES[tab]))]));

/** The files the analysis writes by name: the app's, and the tables of the pages built on a model (page-files.ts). A set,
 * so that a file with the name of an object's built-in property is none of them. */
const WRITTEN_FILES: ReadonlySet<string> = new Set([...Object.values(APP_FILES), ...MODEL_PAGE_FILES]);

/** Whether a table is one the analysis writes (report.ts): one of the app's files, or a table of the pages built on a
 * model. There, and only there, the dash alone in a cell (table-engine.ts `NONE`) is the analysis's own, which says that
 * there is nothing. A model's other files are Anaplan's own grids, where Anaplan writes that dash itself, in Applies To on
 * a heading row of Modules and in Source Object of a file import, and the page leaves it in Applies To of a line item
 * whose module is not found (line-items-view.ts). There it is a text like any other, and the page shows it as one. */
export const writesNone = (table: ResultTable): boolean => WRITTEN_FILES.has(table.file);

/** The columns of a model export's files that count something, by file and header: a module's cells, a line item's cells
 * and a list's items. The files are named as model/export.ts writes them, and the headers are those of Anaplan's own
 * Model settings grids, which the export keeps: Modules and Line Items count their cells as Cell Count in a Classic model
 * and as Populated Cell Count in a Polaris one, and General Lists count their items as Item Count. Every other column
 * of a model's files is plain text: the grids' other numbers are no counts of things (Calculation Effort is a measure of
 * the work a line item takes, Most recent duration (ms) a time, Code a code), or they name a year, a period or an ID. A
 * model's run adds one count to Line Items, which is no column of Anaplan's: how many of the page filters have the line
 * item as their condition (model-pages.ts). */
const CELL_COUNTS = ["Cell Count", "Populated Cell Count"];
export const MODEL_COUNTS: ReadonlyMap<string, readonly string[]> = new Map([
  ["Modules.csv", CELL_COUNTS], ["Line Items.csv", [...CELL_COUNTS, FILTER_USES]], ["General Lists.csv", ["Item Count"]],
]);
/** The columns of a model export's files that start hidden: a Model Calendar setting's allowed values, which only guide
 * filling the template in by hand. Such a column is still in the column chooser, in the search and in the row's details. */
export const MODEL_HIDDEN: ReadonlyMap<string, readonly string[]> = new Map([["Model Calendar.csv", ["Allowed values"]]]);
/** The columns of a model's tables that always offer a filter, however many different texts they hold: the data type of a
 * line item's format, which the page adds to Line Items after Format (line-items-view.ts). Its filter lists the line items
 * alone without the blanks, which are the modules' own rows, and leaves out the headings without No Data. */
export const MODEL_FILTERED: ReadonlyMap<string, readonly string[]> = new Map([[LINE_ITEMS_FILE, [FORMAT_TYPE]]]);
/** The tables of the pages built on a model (page-files.ts), which the run writes from an app's tables: Page Filters and
 * Page Actions hold an app's Filters and Action Buttons with their app, and are shown as those are, with their IDs and
 * numbers hidden. Each of the three offers a filter on the app, and ends with where each page is, hidden: its type, as a
 * tag, and its app's ID and its own, as IDs to copy (page-files.ts `PAGE_PLACE_HEADERS`). */
const PAGE_PLACE: Readonly<Record<string, Choice>> = Object.fromEntries(PAGE_PLACE_HEADERS.map((header, index): [string, Choice] => [header, index === 0 ? { ...TAG, hidden: true } : HIDDEN_ID]));
export const PAGE_FILE_CHOICES: ReadonlyMap<string, Readonly<Record<string, Choice>>> = new Map([
  [MODULE_USAGE_FILE, { App: FILTER, ...PAGE_PLACE }], [PAGE_FILTERS_FILE, { App: FILTER, ...CHOICES.Filters, ...PAGE_PLACE }],
  [PAGE_ACTIONS_FILE, { App: FILTER, ...CHOICES.Actions, ...PAGE_PLACE }],
]);
const MODEL_CHOICES: ReadonlyMap<string, ReadonlyMap<string, Choice>> = new Map([
  ...[...new Set([...MODEL_COUNTS.keys(), ...MODEL_HIDDEN.keys(), ...MODEL_FILTERED.keys()])].map((file): [string, ReadonlyMap<string, Choice>] => [file,
    new Map<string, Choice>([...(MODEL_COUNTS.get(file) ?? []).map((header): [string, Choice] => [header, COUNT]),
      ...(MODEL_HIDDEN.get(file) ?? []).map((header): [string, Choice] => [header, { hidden: true }]),
      ...(MODEL_FILTERED.get(file) ?? []).map((header): [string, Choice] => [header, FILTER])])]),
  ...[...PAGE_FILE_CHOICES].map(([file, choices]): [string, ReadonlyMap<string, Choice>] => [file, new Map(Object.entries(choices))]),
]);

/** A column of any file offers a filter when it holds at least this many different texts and at most that many: with one
 * there is nothing to choose, and up to thirty are a short list to tick. */
export const FILTER_MIN = 2;
export const FILTER_MAX = 30;

/** The columns that hold text written freely, which is read whole and never picked out of a list: a line item's formula,
 * a note, a card's text. With more than thirty texts such a column offers no filter: the search finds a word in it. */
export const FREE_TEXT: readonly string[] = ["Formula", "Notes", "Text content", "Description"];
/** The columns of a model's grids and of an app's files that hold a measure, a time or a running number, whatever the
 * cells look like: a module's or a line item's cells and memory, the work a line item takes, a list's items and its next
 * index, how long an action last took and when it started, and when a page was last published. With more than thirty
 * texts such a column offers no filter: a list of thousands of numbers to tick helps nobody. */
export const MEASURES: readonly string[] = ["Cell Count", "Populated Cell Count", "Memory Used", "Calculation Effort", "Item Count", "Next item index",
  "Most recent duration (ms)", "Start Date and Time (UTC)", "Last published"];

/** A text that is a number or a date, however it is written: digits with their signs, separators and a percent sign, or
 * a date that starts with its year or its day. A column of nothing else, past thirty texts, is a measure as well. */
const NUMBER_OR_DATE = /^(?:[-+]?[\d.,\s]*\d[\d.,\s]*%?|\d{4}-\d{1,2}-\d{1,2}\b.*|\d{1,2}[/.]\d{1,2}[/.]\d{2,4}\b.*)$/;

/** Whether a column offers a filter by what it holds. Each text counts once for each row it is in; in a column whose
 * cells list items (`items`), each item counts, as its filter lists them (table-engine.ts `filterItems`).
 * - From two to thirty different texts: always.
 * - More than thirty: only where `wide`, and only where some text that says something stands in two rows or more, and
 *   some such text is no number and no date. A column whose every text stands in one row alone is a name or a code of
 *   each row, which the search finds; a column of numbers or dates is a measure.
 * The rows are read until the answer is known: a column with many texts that repeat is known early. */
function offersFilter(rows: readonly Row[], index: number, items: ItemsOf | undefined, wide: boolean): boolean {
  const seen = new Set<string>();
  let repeated = false;
  let worded = false;
  const read = (item: string): void => {
    const says = item.trim() !== "";
    if (seen.has(item)) repeated ||= says;
    else seen.add(item);
    if (says && !worded && !NUMBER_OR_DATE.test(item.trim())) worded = true;
  };
  for (const row of rows) {
    if (items) filterItems(row, index, items).forEach(read);
    else read(cellText(row[index]));
    if (seen.size > FILTER_MAX && (!wide || (repeated && worded))) return wide;
  }
  return seen.size >= FILTER_MIN && (seen.size <= FILTER_MAX || (wide && repeated && worded));
}

/** Whether a column may offer a filter past thirty texts: every column but the row's own name, which a model's grid
 * leaves unnamed in its first place and the search serves; free text; an ID; a number, as a count or as what the design
 * shows as a number; and a measure. Those offer one only as any column with few texts does. */
function wideFilter(header: string, index: number, choice: Choice): boolean {
  if (index === 0 && header === "") return false;
  if (FREE_TEXT.includes(header) || MEASURES.includes(header) || / IDs?$/.test(header)) return false;
  return choice.kind !== "id" && choice.kind !== "count" && choice.num !== true;
}

/** A table's columns, in the order of its headers. The rows must be complete: which columns offer a filter depends on them.
 * `lists` are the columns whose cells list items, by their place (cell-lists.ts): their filters read each item. */
export function columnsOf(table: ResultTable, lists?: ReadonlyMap<number, ItemsOf>): Column[] {
  const choices = COLUMN_CHOICES.get(table.file) ?? MODEL_CHOICES.get(table.file);
  const none = writesNone(table);
  return table.headers.map((value, index) => {
    const header = cellText(value);
    const choice = choices?.get(header) ?? {};
    const label = header !== "" ? header : index === 0 ? "Name" : `Column ${index + 1}`;
    const filter = choice.filter === true || offersFilter(table.rows, index, lists?.get(index), wideFilter(header, index, choice));
    return { index, label, kind: choice.kind ?? "text", num: choice.num === true, filter, hidden: choice.hidden === true, none };
  });
}

/** The columns of one row in full: the table's, then one for each cell the row holds beyond its headers, under a name of
 * the page's own. The row holds those cells, so the place where a row is read in full shows them too. Such a cell is
 * the table's like any other: the dash alone in it says what it says in the table's own columns. */
export function rowColumns(columns: readonly Column[], row: readonly unknown[]): Column[] {
  const none = columns.some(column => column.none);
  const beyond = Array.from({ length: Math.max(0, row.length - columns.length) }, (_, extra): Column => {
    const index = columns.length + extra;
    return { index, label: `Column ${index + 1}`, kind: "text", num: false, filter: false, hidden: false, none };
  });
  return [...columns, ...beyond];
}

/** The position of a header in a table, or undefined when the table has no such column. */
export function columnIndex(table: ResultTable, header: string): number | undefined {
  const index = table.headers.indexOf(header);
  return index < 0 ? undefined : index;
}

/** The column that names a row, in each of the app's files: what the row's drawer is headed by. An app's first column is
 * the app or the page, which every row of the page shares: the row's own name is the page in Pages, the card's title in
 * Cards, and in the other files what the row is about. A row of any other file (every file of a model) is named by the
 * first of its cells that says something, which there is the row's name. */
export const ROW_NAME_COLUMNS: Record<TabName, string> = {
  Pages: "Page", Cards: "Card title", "Grid sections": "Source module", Filters: "Condition line item", Formatting: "Formatted line item",
  Actions: "Button label", "Where used": "Object name",
};
/** Page Filters and Page Actions, which hold an app's Filters and Action Buttons rows, are named as those are. */
const ROW_NAMES: ReadonlyMap<string, string> = new Map([...(Object.keys(ROW_NAME_COLUMNS) as TabName[]).map((tab): [string, string] => [APP_FILES[tab], ROW_NAME_COLUMNS[tab]]),
  [PAGE_FILTERS_FILE, ROW_NAME_COLUMNS.Filters], [PAGE_ACTIONS_FILE, ROW_NAME_COLUMNS.Actions]]);

/** The place of the column that names a table's rows; undefined for a file the page knows no such column of, and for a
 * table that lacks it. */
export function rowNameIndex(table: ResultTable): number | undefined {
  const header = ROW_NAMES.get(table.file);
  return header === undefined ? undefined : columnIndex(table, header);
}

/** The columns a row's links read: its page, and its card's ID and number. */
export interface RowKeys { page: number | undefined; cardId: number | undefined; number: number | undefined }
export const rowKeys = (table: ResultTable): RowKeys => ({ page: columnIndex(table, "Page"), cardId: columnIndex(table, "Card ID"), number: columnIndex(table, "Card #") });

/** The Cards file of an app result with the columns that identify a card, or undefined when the result has none: then
 * nothing links to a card or to a page's cards. A card's number is read where the file has that column. */
export interface CardsTable {
  index: number;
  table: ResultTable;
  page: number;
  cardId: number;
  number: number | undefined;
  /** The file's rows by what names a card in every file, its page's name and its ID, so that a row's card is not looked
   * for among all of them each time a cell is drawn. */
  named: ReadonlyMap<string, readonly Row[]>;
}
const cardKey = (page: string, cardId: string): string => JSON.stringify([page, cardId]);
export function cardsOf(result: AnalysisResult): CardsTable | undefined {
  const index = result.tables.findIndex(table => table.file === APP_FILES.Cards);
  if (index < 0) return undefined;
  const table = result.tables[index];
  const { page, cardId, number } = rowKeys(table);
  if (page === undefined || cardId === undefined) return undefined;
  const named = new Map<string, Row[]>();
  for (const row of table.rows) {
    const key = cardKey(cellText(row[page]), cellText(row[cardId]));
    const rows = named.get(key);
    if (rows) rows.push(row); else named.set(key, [row]);
  }
  return { index, table, page, cardId, number, named };
}

/** The cards that a page's name and a Card ID name: the rows of the Cards file with both, in the file's order. The files
 * have only the name of a card's page, and a page copied in Anaplan may keep its cards' IDs, so under a name that pages
 * share this can be more than one card. The card's number, which every file has beside the ID, tells them apart where
 * it differs: with `number`, of several such cards only those of that number are given. More than one row is then more
 * than one card, and nothing in the files says which of them a row of another file is on. */
export function cardsNamed(cards: CardsTable, page: string, cardId: string, number?: string): readonly Row[] {
  const named = cards.named.get(cardKey(page, cardId)) ?? [];
  const at = cards.number;
  return named.length < 2 || number === undefined || at === undefined ? named : named.filter(row => cellText(row[at]) === number);
}
