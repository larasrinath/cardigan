import type { AnalysisResult, ResultTable } from "../result-types.js";
import { cellText } from "./table-engine.js";

/** How the results page shows each column. Columns come from a table's headers. The design's choices for the app's seven
 * files are kept by header name: which columns offer a filter, which start hidden, which are numbers, and which are shown
 * as an ID to copy, a tag or a link. Every cell shows its own text whatever the choice. A file or a header that is not
 * listed here (every file of a model export) gets a plain text column. */

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
  /** Offers a filter on its values. */
  filter: boolean;
  /** Hidden until chosen in the column chooser. */
  hidden: boolean;
}

interface Choice { kind?: ColumnKind; num?: true; filter?: true; hidden?: true }

const PAGE: Choice = { kind: "page", filter: true };
const CARD_NUMBER: Choice = { kind: "card", num: true };
const NUM: Choice = { num: true };
const FILTER: Choice = { filter: true };
const TAG: Choice = { kind: "tag", filter: true };
const ID: Choice = { kind: "id" };
const HIDDEN_ID: Choice = { kind: "id", hidden: true };

const CHOICES: Record<string, Record<string, Choice>> = {
  "Pages.csv": {
    "Category": FILTER, "Page": { kind: "page" }, "Page type": TAG, "Publish state": FILTER, "Model": FILTER,
    "Total cards": NUM, "Grid cards": NUM, "Chart cards": NUM, "KPI cards": NUM, "Field cards": NUM, "Action cards": NUM, "Text & image cards": NUM,
    "Page ID": HIDDEN_ID, "App ID": HIDDEN_ID, "Model ID": HIDDEN_ID,
  },
  "Cards.csv": {
    "Page": PAGE, "Card #": CARD_NUMBER, "Card title": { kind: "card" }, "Card type": TAG, "View type": TAG,
    "Card ID": HIDDEN_ID, "Source IDs": { hidden: true },
  },
  "Grid Sections.csv": {
    "Page": PAGE, "Card #": CARD_NUMBER, "View type": TAG, "Section #": NUM, "Section layout": FILTER,
    "Card ID": ID, "Section ID": HIDDEN_ID, "Module ID": HIDDEN_ID,
  },
  "Filters.csv": {
    "Page": PAGE, "Card #": CARD_NUMBER, "Section #": NUM, "Filter on": TAG, "Filtered dimension": FILTER, "Show items that match": TAG,
    "Operator": FILTER, "Card ID": ID, "Line item ID": HIDDEN_ID,
  },
  "Conditional Formatting.csv": {
    "Page": PAGE, "Card #": CARD_NUMBER, "Section #": NUM, "Format style": TAG, "Card ID": ID, "Line item ID": HIDDEN_ID,
  },
  "Action Buttons.csv": {
    "Page": PAGE, "Card #": CARD_NUMBER, "Action type": TAG, "Name source": FILTER, "Runs automatically": FILTER, "Cancel button": FILTER,
    "Card ID": ID, "Action ID": HIDDEN_ID,
  },
  "Where Used.csv": {
    "Object type": TAG, "Page": PAGE, "Card #": NUM, "Used as": FILTER, "Object ID": HIDDEN_ID,
  },
};

/** File name -> header -> choice. The file names are the app export's (analyse.ts), the headers are report.ts `HEADERS`.
 * Maps, so that a file or a header with the name of an object's built-in property finds nothing. */
export const COLUMN_CHOICES: ReadonlyMap<string, ReadonlyMap<string, Choice>> = new Map(
  Object.entries(CHOICES).map(([file, choices]): [string, ReadonlyMap<string, Choice>] => [file, new Map(Object.entries(choices))]));

/** A table's columns, in the order of its headers. */
export function columnsOf(table: ResultTable): Column[] {
  const choices = COLUMN_CHOICES.get(table.file);
  return table.headers.map((value, index) => {
    const header = cellText(value);
    const choice = choices?.get(header) ?? {};
    const label = header !== "" ? header : index === 0 ? "Name" : `Column ${index + 1}`;
    return { index, label, kind: choice.kind ?? "text", num: choice.num === true, filter: choice.filter === true, hidden: choice.hidden === true };
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
  const index = result.tables.findIndex(table => table.file === "Cards.csv");
  if (index < 0) return undefined;
  const table = result.tables[index];
  const { page, cardId } = rowKeys(table);
  return page === undefined || cardId === undefined ? undefined : { index, table, page, cardId };
}
