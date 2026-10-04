import type { TabName } from "../report.js";
import type { AnalysisResult, ResultTable } from "../result-types.js";
import { cellText } from "./table-engine.js";

/** The names of an app export's files, by the report table each holds. The analysis writes its files under these names
 * (analyse.ts), and whatever the page knows about one of them, here or in result-view.ts, is keyed by a name from this
 * one place. A model's files are not named anywhere: the page knows nothing about any of them in particular. */
export const APP_FILES: Record<TabName, string> = {
  Pages: "Pages.csv", Cards: "Cards.csv", "Grid sections": "Grid Sections.csv", Filters: "Filters.csv", Formatting: "Conditional Formatting.csv",
  Actions: "Action Buttons.csv", "Where used": "Where Used.csv",
};

/** How the results page shows each column. Columns come from a table's headers. The design's choices for the app's seven
 * files are kept by header name: which columns offer a filter, which start hidden, which are numbers, and which are shown
 * as an ID to copy, a tag or a link. Every cell shows its own text whatever the choice. A file or a header that is not
 * listed here (every file of a model export) gets a plain text column. In any file, a column that holds only a few
 * different texts offers a filter as well, so a model's tables can be filtered too.
 *
 * Two kinds of column start hidden in every one of the app's tables: the IDs, and what only numbers a row's place, a
 * card's number and a section's (`NUMBERS_HIDDEN`). A row says where it belongs in words, by its page and its card's
 * title or its own name. A hidden column is still in the column chooser, in the search, in the row's drawer and in the
 * CSV, which always has every column. */

export type ColumnKind = "text" | "id" | "tag" | "page" | "card";

export interface Column {
  /** The column's position in the table's headers and in each row. */
  index: number;
  /** The name the page shows: the header, or a name of the page's own for a header that is empty. Every file of a model
   * starts with such a column, the one that names each row. The CSV keeps the empty header. */
  label: string;
  kind: ColumnKind;
  /** Right-aligned, as the design shows numbers. */
  num: boolean;
  /** Offers a filter on its values: by the design's choice, or because it holds few enough different texts to tick. */
  filter: boolean;
  /** Hidden until chosen in the column chooser. */
  hidden: boolean;
}

interface Choice { kind?: ColumnKind; num?: true; filter?: true; hidden?: true }

/** The numbers that start hidden, by their header, wherever one of the app's tables has them. */
export const NUMBERS_HIDDEN: readonly string[] = ["Card #", "Section #"];

const PAGE: Choice = { kind: "page", filter: true };
/** A card's number where the row also holds the card's ID: it opens the card, from the row's drawer while it is hidden. */
const CARD_NUMBER: Choice = { kind: "card", num: true, hidden: true };
const NUM: Choice = { num: true };
const HIDDEN_NUM: Choice = { num: true, hidden: true };
const FILTER: Choice = { filter: true };
const TAG: Choice = { kind: "tag", filter: true };
const HIDDEN_ID: Choice = { kind: "id", hidden: true };

const CHOICES: Record<TabName, Record<string, Choice>> = {
  Pages: {
    "Category": FILTER, "Page": { kind: "page" }, "Page type": TAG, "Publish state": FILTER, "Model": FILTER,
    "Total cards": NUM, "Grid cards": NUM, "Chart cards": NUM, "KPI cards": NUM, "Field cards": NUM, "Action cards": NUM, "Text & image cards": NUM,
    "Page ID": HIDDEN_ID, "App ID": HIDDEN_ID, "Model ID": HIDDEN_ID,
  },
  Cards: {
    "Page": PAGE, "Card #": CARD_NUMBER, "Card title": { kind: "card" }, "Card type": TAG, "View type": TAG,
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
    "Page": PAGE, "Card #": CARD_NUMBER, "Section #": HIDDEN_NUM, "Format style": TAG, "Card ID": HIDDEN_ID, "Line item ID": HIDDEN_ID,
  },
  Actions: {
    "Page": PAGE, "Card #": CARD_NUMBER, "Action type": TAG, "Name source": FILTER, "Runs automatically": FILTER, "Cancel button": FILTER,
    "Card ID": HIDDEN_ID, "Action ID": HIDDEN_ID,
  },
  // Where Used has no Card ID, so its Card # opens nothing: it is a number only.
  "Where used": {
    "Object type": TAG, "Page": PAGE, "Card #": HIDDEN_NUM, "Used as": FILTER, "Object ID": HIDDEN_ID,
  },
};

/** File name -> header -> choice. The file names are the app export's (`APP_FILES`), the headers are report.ts `HEADERS`.
 * Maps, so that a file or a header with the name of an object's built-in property finds nothing. */
export const COLUMN_CHOICES: ReadonlyMap<string, ReadonlyMap<string, Choice>> = new Map(
  (Object.keys(CHOICES) as TabName[]).map((tab): [string, ReadonlyMap<string, Choice>] => [APP_FILES[tab], new Map(Object.entries(CHOICES[tab]))]));

/** A column of any file offers a filter when it holds at least this many different texts and at most that many: with one
 * there is nothing to choose, and more than thirty are a list to search, not to tick. */
export const FILTER_MIN = 2;
export const FILTER_MAX = 30;

/** For each column of a table, whether it holds few enough different texts for a filter. A cell a row does not have is
 * the blank text, as the filter lists it. Once a column has passed the most, its cells are no longer looked at. */
function fewTexts(table: ResultTable): boolean[] {
  const texts = table.headers.map(() => new Set<string>());
  for (const row of table.rows) {
    texts.forEach((seen, index) => {
      if (seen.size <= FILTER_MAX) seen.add(cellText(row[index]));
    });
  }
  return texts.map(seen => seen.size >= FILTER_MIN && seen.size <= FILTER_MAX);
}

/** A table's columns, in the order of its headers. The rows must be complete: which columns offer a filter depends on them. */
export function columnsOf(table: ResultTable): Column[] {
  const choices = COLUMN_CHOICES.get(table.file);
  const few = fewTexts(table);
  return table.headers.map((value, index) => {
    const header = cellText(value);
    const choice = choices?.get(header) ?? {};
    const label = header !== "" ? header : index === 0 ? "Name" : `Column ${index + 1}`;
    return { index, label, kind: choice.kind ?? "text", num: choice.num === true, filter: choice.filter === true || few[index], hidden: choice.hidden === true };
  });
}

/** The columns of one row in full: the table's, then one for each cell the row holds beyond its headers, under a name of
 * the page's own. The CSV holds those cells, so the place where a row is read in full shows them too. */
export function rowColumns(columns: readonly Column[], row: readonly unknown[]): Column[] {
  const beyond = Array.from({ length: Math.max(0, row.length - columns.length) }, (_, extra): Column => {
    const index = columns.length + extra;
    return { index, label: `Column ${index + 1}`, kind: "text", num: false, filter: false, hidden: false };
  });
  return [...columns, ...beyond];
}

/** The position of a header in a table, or undefined when the table has no such column. */
export function columnIndex(table: ResultTable, header: string): number | undefined {
  const index = table.headers.indexOf(header);
  return index < 0 ? undefined : index;
}

/** The columns a row's links read: its page, and its card's ID. */
export interface RowKeys { page: number | undefined; cardId: number | undefined }
export const rowKeys = (table: ResultTable): RowKeys => ({ page: columnIndex(table, "Page"), cardId: columnIndex(table, "Card ID") });

/** The Cards file of an app result with the columns that identify a card, or undefined when the result has none: then
 * nothing links to a card or to a page's cards. */
export interface CardsTable { index: number; table: ResultTable; page: number; cardId: number }
export function cardsOf(result: AnalysisResult): CardsTable | undefined {
  const index = result.tables.findIndex(table => table.file === APP_FILES.Cards);
  if (index < 0) return undefined;
  const table = result.tables[index];
  const { page, cardId } = rowKeys(table);
  return page === undefined || cardId === undefined ? undefined : { index, table, page, cardId };
}
