import { quoted, splitOutside, unquote } from "./map/graph-names.js";

/** The Filtered line items cell of a filter on a page (report.ts `filterRows`, and the Page Filters table of a model's
 * run): which line items the grid the filter narrows shows, the line items it filters. A person reads it in the table,
 * and the model map reads it back to draw a filter from its line item to each of those (map/build-graph.ts), so its form
 * is fixed here, both ways:
 * - Of a grid section, or of several that show the same: "All line items", "Only" or "All except" and the line items'
 *   names, each written as the export writes a name among others (map/graph-names.ts `quoted`), so that a name that
 *   holds a comma stays one name; or the words for line items that the Line Items selector picks one at a time, and for
 *   a section whose Line Items is on no axis and no selector, whose line items are not known.
 * - Of a combined grid's sections that share the filtered axis and show different line items: each section's module,
 *   always in single quotes, a colon and what it shows, with " | " between them.
 * The words are those the Cards and Grid sections tables have for what a section shows (report.ts `regionLineItems`). */

/** The column's header, in the app's Filters table and in a model's Page Filters table. */
export const FILTERED_LINE_ITEMS = "Filtered line items";

/** What a section shows, in the words of the Cards and Grid sections tables. */
export const ALL_LINE_ITEMS = "All line items";
export const BY_SELECTOR = "Chosen by the Line Items selector";
export const NOT_PLACED = "Line Items not on rows, columns or a selector";
const ONLY = "Only ";
const EXCEPT = "All except ";
const BETWEEN_SECTIONS = " | ";

/** Which line items a grid section shows: all of them, or any of them where the Line Items selector picks one at a time;
 * only some; or all but some. Each line item by its name. */
export type LineItemsShown = { all: true; selector?: true } | { only: readonly string[] } | { except: readonly string[] };

/** What a section of the filtered grid shows: nothing where that is not known. */
export interface SectionShown { module: string; shown: LineItemsShown | undefined }

/** A part of a cell as the map reads it back: the module it is of, where the cell names one (then each part names its
 * own), and what that module's section shows, or nothing where the cell does not say. */
export interface FilteredPart { module?: string; shown?: LineItemsShown }

function shownText(shown: LineItemsShown | undefined): string {
  if (!shown) return NOT_PLACED;
  if ("only" in shown) return ONLY + shown.only.map(quoted).join(", ");
  if ("except" in shown) return EXCEPT + shown.except.map(quoted).join(", ");
  return shown.selector ? BY_SELECTOR : ALL_LINE_ITEMS;
}

/** The cell of a filter on the sections of a grid that share its axis, in their order: what they show, once where they
 * all show the same, and otherwise each section's, after its module. The dash that says nothing where there is no
 * section. */
export function filteredLineItemsText(sections: readonly SectionShown[]): string {
  const texts = sections.map(section => shownText(section.shown));
  if (!texts.length) return "-";
  if (texts.every(text => text === texts[0])) return texts[0];
  return sections.map((section, index) => `'${section.module.replaceAll("'", "''")}': ${texts[index]}`).join(BETWEEN_SECTIONS);
}

/** Where the module a part starts with ends: at the single quote that closes it, the doubled ones inside it passed by. */
function quoteEnd(part: string): number {
  for (let index = 1; index < part.length; index++) {
    if (part[index] !== "'") continue;
    if (part[index + 1] === "'") index++;
    else return index;
  }
  return -1;
}

function shownOf(text: string): LineItemsShown | undefined {
  if (text === ALL_LINE_ITEMS) return { all: true };
  if (text === BY_SELECTOR) return { all: true, selector: true };
  if (text.startsWith(EXCEPT)) return { except: splitOutside(text.slice(EXCEPT.length)).map(unquote) };
  if (text.startsWith(ONLY)) return { only: splitOutside(text.slice(ONLY.length)).map(unquote) };
  return undefined;
}

/** A cell read back (`filteredLineItemsText`): its parts in order. None for a cell that says nothing, as a table made
 * before the column was has none: then nothing says which line items a filter filters. */
export function readFilteredLineItems(cell: string): FilteredPart[] {
  return splitOutside(cell, "|").map(part => {
    if (!part.startsWith("'")) return { shown: shownOf(part) };
    const end = quoteEnd(part);
    const rest = end < 0 ? "" : part.slice(end + 1).trimStart();
    if (!rest.startsWith(":")) return {};
    return { module: unquote(part.slice(0, end + 1)), shown: shownOf(rest.slice(1).trim()) };
  }).map(({ module, shown }) => ({ ...(module === undefined ? {} : { module }), ...(shown ? { shown } : {}) }));
}
