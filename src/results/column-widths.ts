import type { Column } from "./columns.js";
import { cellText, groupedCount, NONE, type Row } from "./table-engine.js";

/** How wide the results page draws each column of a table. The table is laid out by the widths the page gives its
 * columns (results.css), not by the rows on screen: a browser that sized each column to the rows it shows would give
 * every page, every order and every search other widths, and the table would move under the user's hand whenever it was
 * sorted, paged, searched or filtered. So each column's width is worked out once, from every row of the table and the
 * column's header, and stays as it is whatever is shown of the table. A cell whose text is wider than its column ends in
 * an ellipsis, as it did when it was wider than the most a column was given.
 *
 * Widths are in ch, the width of a figure in the table's type, so that they follow the type. They are worked out from
 * each text's letters, as measured in Chrome in the page's type (Segoe UI at 12.5px, the first of its fonts that Windows
 * has; the others are of much the same widths). The estimate errs on the wide side by a little, and a text that is wider
 * still is cut short at the end of its column, never drawn over the next one. Plain data in, plain data out: every width
 * is a whole number the page counted itself, which markup.ts writes into the column's style, and no text of a result
 * ever reaches it. */

/** The most a column is given: about the 340px the design has always given a column at most, padding included. */
export const WIDEST = 50;
/** The room a cell takes besides its text: 10px of padding on either side. */
const CELL_ROOM = 3;
/** The room a header takes besides its name: its padding, the sort button's padding, and the 9px of the sort arrow with
 * the gap before it. The arrow's room is kept whether the column is sorted or not (results.css `.th-sort .dir`), so the
 * header is as wide either way. */
const HEAD_ROOM = 6;
/** The room the filter button of a column that has one takes, with the gap before it. */
const FILTER_ROOM = 3;
/** The room a tag takes besides its text, its padding and its border, and how much smaller its type is than a cell's. */
const TAG_ROOM = 2.5;
const TAG_TYPE = 0.92;
/** The room an ID's pill takes besides its text, and the most it is drawn at: 180px. Its type is a monospace one, about
 * 1ch a character. */
const PILL_ROOM = 2;
const PILL_MOST = 27;
/** The room a colour's square takes before its code (markup.ts `coloursHtml`): 11px and a 4px gap. Each square stands
 * before a `#` of the text, and the code after it is counted at far less than the most a character is counted at, so a
 * cell still needs no more than its length says. */
const SQUARE_ROOM = 2.25;
/** A header's name is in capitals of 11px, with a little space after each letter. */
const HEAD_TYPE = 0.88;
const HEAD_SPACING = 0.1;
/** The room the button that opens a row takes where it stands before the cell's link or ID (markup.ts `rowCellHtml`):
 * an 11px icon and a space. */
export const ROW_BUTTON = 3;
/** What is added to every estimate, so that a text a little wider than its letters say still fits. */
const SPARE = 1;
/** The most a character is counted at, and the most room a kind of cell takes besides its text: what bounds a cell's
 * need by its text's length alone. */
const WIDEST_CHARACTER = 2;
const MOST_ROOM = TAG_ROOM;

const NARROW = new Set(" iljIftr.,:;'!|");
const WIDE = new Set("MWmw@%");

/** One character's width in the table's type, in ch: about half for a space and for i, l, t and the like; 1 for a figure,
 * which is what 1ch is, and for a lowercase letter on average; a little more for a capital or a letter of another
 * alphabet; 1.7 for M, W, m and w; and 2 for what lies beyond, such as a dash or a Chinese or Japanese character. */
function characterWidth(character: string): number {
  if (NARROW.has(character)) return 0.5;
  if (WIDE.has(character)) return 1.7;
  if (character >= "A" && character <= "Z") return 1.15;
  const code = character.codePointAt(0) ?? 0;
  return code < 0x80 ? 1 : code < 0x2000 ? 1.1 : WIDEST_CHARACTER;
}

/** How wide a text is in the table's type, in ch. Counting stops once it reaches `most`: no column is wider than that. */
export function textWidth(text: string, most = Infinity): number {
  let width = 0;
  for (const character of text) {
    width += characterWidth(character);
    if (width >= most) return most;
  }
  return width;
}

/** The room a column's header needs: its name as the header shows it, the sort arrow's room, and the filter button where
 * the column has one. Nothing of it depends on whether or how the column is sorted. */
export function headerWidth(column: Column): number {
  const name = column.label.toUpperCase();
  const width = textWidth(name) * HEAD_TYPE + name.length * HEAD_SPACING + HEAD_ROOM + (column.filter ? FILTER_ROOM : 0) + SPARE;
  return Math.min(WIDEST, Math.ceil(width));
}

/** The room one cell's text needs, as its column shows it (markup.ts `cellHtml`), without the cell's own padding. */
function cellNeed(column: Column, text: string, most: number): number {
  if (text === "") return 0;
  if (text === NONE) return textWidth(NONE);
  switch (column.kind) {
    case "id":
      return Math.min(PILL_MOST, text.length + PILL_ROOM);
    case "tag":
      return textWidth(text, most) * TAG_TYPE + TAG_ROOM;
    case "count":
      return textWidth(groupedCount(text), most);
    case "colours":
      return Math.min(most, textWidth(text, most) + SQUARE_ROOM * (text.split("#").length - 1));
    default:
      return textWidth(text, most);
  }
}

/** Each column's width in ch, by the column's place in the table's headers: as wide as the widest of its cells needs,
 * among all the rows of the table, and as its header needs, and no wider than `WIDEST`. `rows` are the table's rows,
 * every one of them: not the rows a search, a filter or a jump leaves, nor a page of them, nor in the order of a sort. A
 * cell that cannot be wider than the widest found so far is not measured, and a column stops being measured once it is
 * as wide as a column gets, so that a table of many thousands of rows is quick to measure. */
export function columnWidths(columns: readonly Column[], rows: readonly Row[]): Map<number, number> {
  const widths = new Map<number, number>();
  const most = WIDEST - CELL_ROOM - SPARE;
  for (const column of columns) {
    let widest = 0;
    for (const row of rows) {
      const text = cellText(row[column.index]);
      if (text.length * WIDEST_CHARACTER + MOST_ROOM <= widest) continue;
      widest = Math.max(widest, cellNeed(column, text, most));
      if (widest >= most) break;
    }
    widths.set(column.index, Math.max(headerWidth(column), Math.min(WIDEST, Math.ceil(widest + CELL_ROOM + SPARE))));
  }
  return widths;
}
