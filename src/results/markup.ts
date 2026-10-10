import { MODULE_USAGE_FILE, PAGE_ACTIONS_FILE, PAGE_FILTERS_FILE } from "../page-files.js";
import type { Items } from "./cell-lists.js";
import { headerWidth, ROW_BUTTON, WIDEST } from "./column-widths.js";
import { APP_FILES, rowColumns, type Column } from "./columns.js";
import { REFRESH_AND_RUN } from "./connection.js";
import type { MappingView } from "./import-mapping-view.js";
import type { ProcessView } from "./process-actions-view.js";
import { LINE_ITEMS_FILE } from "./line-items-view.js";
import type { RangeState } from "./range-filter.js";
import { ACCESS_FILE, MODEL_CALENDAR_FILE, MODULES_FILE, type Analysed, type CardSection, type Overview, type SectionCell } from "./result-view.js";
import { cellText, dayText, groupedCount, NONE, type RangeColumn, type Row, type Sort } from "./table-engine.js";
import { usedOn, type WhereUsedObject } from "./where-used-view.js";

/** The results page's markup, as the design writes it: each function turns data into the HTML text the page then shows.
 * Every string of a result was typed by an Anaplan user (card titles, text cards, names, formulas), so every value that
 * comes from a result goes through `esc`, in text and inside attributes alike, and no value is ever written as a tag, an
 * attribute name, a style or an address. One part of a value is written into a style, and only as the page matched it: a
 * formatting rule's colour, `#` and hexadecimal digits, which fills its square (`coloursHtml`). The only other style that
 * carries a value holds a number the page worked out itself: a column's width. What a click means is read from the row
 * the page holds, never back out of the markup: the only data attributes that carry a value hold a number the page
 * counted itself, or an ID to copy. In a drawer, a value that lists several items decides one thing more than its text:
 * how many items its list has. Each item is escaped text, in a list of the page's own elements. */

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" };
/** A value as text that cannot end the text or the quoted attribute it is written into. */
export const esc = (value: unknown): string => cellText(value).replace(/[&<>"']/g, char => ESCAPES[char]);

const DASH = `<span class="dash">${NONE}</span>`;
const BLANK = "<em>(blank)</em>";
const CLOSE_ICON = '<svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M3 3l10 10M13 3 3 13"/></svg>';
const SEARCH_PATH = '<circle cx="7" cy="7" r="4.6"/><path d="M10.6 10.6 14 14"/>';
const FILTER_PATH = '<path d="M2 3h12l-4.6 5.2v4.3L6.6 14V8.2L2 3Z"/>';
export const SUN_ICON = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><circle cx="8" cy="8" r="3.2"/><path d="M8 1.5v1.8M8 12.7v1.8M1.5 8h1.8M12.7 8h1.8M3.4 3.4l1.3 1.3M11.3 11.3l1.3 1.3M12.6 3.4l-1.3 1.3M4.7 11.3l-1.3 1.3"/></svg>';
export const MOON_ICON = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13.5 9.5A5.8 5.8 0 0 1 6.5 2.5 5.8 5.8 0 1 0 13.5 9.5Z"/></svg>';
const INFO_ICON = '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><circle cx="8" cy="8" r="6.4"/><path d="M8 7.4v3.4M8 5v.2"/></svg>';
const CARET = '<svg class="car" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 3l6 5-6 5"/></svg>';
const DIAGNOSTICS_SUMMARY = `<summary>${CARET}Diagnostics</summary>`;
/** What opens and closes a section of the overview that starts closed: a click on it, or Enter or Space while it has the
 * focus, which the Tab key gives it. The section's heading stands inside it, and takes its look by the stylesheet. */
const sectionSummary = (title: string): string => `<summary>${CARET}<h2>${title}</h2></summary>`;
/** The button that copies a diagnostic log. The messages of a failed run name it by these words (progress.ts). `act` says
 * which log: "copy-diag" the one a result carries, "copy-run-log" the one of the run the page is following or last followed. */
const copyLogButton = (act: "copy-diag" | "copy-run-log", attributes = ""): string => `<button type="button" class="btn sm" data-act="${act}"${attributes}>
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5.5" y="5.5" width="8" height="8" rx="2"/><path d="M10.5 5.5v-2a2 2 0 0 0-2-2h-5a2 2 0 0 0-2 2v5a2 2 0 0 0 2 2h2"/></svg>
          Copy diagnostic log</button>`;

/* ---------- cells ---------- */

/** An ID as a pill that copies it when clicked. */
const pill = (text: string): string =>
  `<button type="button" class="id-pill" data-copy="${esc(text)}" title="Copy ${esc(text)}" aria-label="Copy ID ${esc(text)}">${esc(text)}</button>`;

/** An ID from the app's files as a pill that copies it, where it stands outside a table: a card's or an object's, in the
 * drawer. There the dash says that the files have no such ID. A cell of a table is shown the way its column is shown
 * (`cellHtml`). */
export function idPill(id: unknown): string {
  const text = cellText(id);
  if (text === "") return "";
  if (text === NONE) return DASH;
  return pill(text);
}

/** Whether a cell is the dash that says that there is nothing: the dash alone, in a column where it says so (columns.ts
 * `Column`). */
const isNone = (column: Column, text: string): boolean => column.none && text === NONE;

const plain = (text: string): string => `<span class="cell-t" title="${esc(text)}">${esc(text)}</span>`;

/** A colour stop as report.ts `cfRuleText` writes it, its value, an arrow and its colour, where the colour is `#` and three
 * or six hexadecimal digits and ends the stop. A colour written in any other way stays text. */
const COLOUR_STOP = /(→ )(#(?:[0-9A-Fa-f]{6}|[0-9A-Fa-f]{3}))(?=;|\s|$)/g;

/** A text that holds colour stops, each colour as a small square of that colour before its code, as design tools show a
 * colour. The square only shows what the code says, so screen readers skip it. The colour is written into its style only
 * as COLOUR_STOP matched it; the rest of the text is escaped as any text. */
export function coloursHtml(text: string): string {
  let html = "";
  let from = 0;
  for (const match of text.matchAll(COLOUR_STOP)) {
    const at = (match.index ?? 0) + match[1].length;
    const colour = match[2];
    html += `${esc(text.slice(from, at))}<span class="colour"><span class="swatch" style="--swatch:${colour}" aria-hidden="true"></span>${colour}</span>`;
    from = at + colour.length;
  }
  return html + esc(text.slice(from));
}

/** What a row's cells may link to: its page's cards and its card's details. Both need the result's Cards file and the
 * row's own Page or Card ID column. `hasCard` says for each row whether its card is one to open: a table whose rows name
 * their card by its number alone says whether the result has that card, and any table says no for a row whose card
 * could be more than one. Only where it says yes is the row's card a link; elsewhere its number is plain text. */
export interface Links { page: boolean; card: boolean; hasCard?: (row: Row) => boolean }

/** Whether a row's card is a link: the table's cards are, and this row's card is one to open. */
const cardLinked = (links: Links, row: Row): boolean => links.card && (links.hasCard?.(row) ?? true);

/** One cell: always the cell's own text, shown the way its column is shown. An empty cell stays empty, and the dash that
 * says that there is nothing is greyed (`isNone`). `whole` is for the drawer, where a value is read in full: there its
 * text stands in a `cell-t` whatever the column's kind, and that is the element in which the stylesheet keeps a value's
 * line breaks and spaces (an ID is a pill, which it shows uncut). A count is its text with its thousands apart, in the
 * table and in the drawer alike: what the page shows of the cell, which is not changed. A cell of a count's column that
 * is no plain number shows as it is. */
export function cellHtml(column: Column, row: Row, links: Links, whole = false): string {
  const text = cellText(row[column.index]);
  if (text === "") return "";
  if (isNone(column, text)) return DASH;
  const shown = whole ? `<span class="cell-t">${esc(text)}</span>` : esc(text);
  switch (column.kind) {
    case "id":
      return pill(text);
    case "tag":
      return `<span class="tag">${shown}</span>`;
    case "page":
      return links.page ? `<button type="button" class="link" data-act="page" title="Show cards on ${esc(text)}">${shown}</button>` : plain(text);
    case "card":
      return cardLinked(links, row) ? `<button type="button" class="link" data-act="card" title="Open card details">${shown}</button>` : plain(text);
    case "colours":
      return whole ? `<span class="cell-t">${coloursHtml(text)}</span>` : `<span class="cell-t" title="${esc(text)}">${coloursHtml(text)}</span>`;
    case "count":
      return whole ? `<span class="cell-t">${esc(groupedCount(text))}</span>` : plain(groupedCount(text));
    default:
      return plain(text);
  }
}

const ROW_ICON = '<svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 3l6 5-6 5"/></svg>';

/** The cell of a row on screen that also opens the row, so that a row can be read in full from the keyboard: the cell's
 * content is a button. It is the row's first cell, unless the table has another column for it (`TableView.opensFrom`). A
 * cell that is already a link or an ID to copy keeps that, and a cell without text has nothing to make a button of:
 * there a small button stands before the cell's own content. */
export function rowCellHtml(column: Column, row: Row, links: Links): string {
  const text = cellText(row[column.index]);
  const own = cellHtml(column, row, links);
  const control = !isNone(column, text) && (column.kind === "id" || (column.kind === "page" && links.page) || (column.kind === "card" && cardLinked(links, row)));
  if (text === "" || control) return `<button type="button" class="link" data-act="row" aria-label="Open this row" title="Open this row">${ROW_ICON}</button> ${own}`;
  return `<button type="button" class="link" data-act="row" title="Open this row">${own}</button>`;
}

/* ---------- header, navigation ---------- */

export function headerMetaHtml(analysed: Analysed): string {
  const parts = [esc(analysed.kind)];
  if (analysed.host) parts.push(`<span style="font-family:var(--mono);font-size:11px">${esc(analysed.host)}</span>`);
  if (analysed.exportedOn) parts.push(`Exported ${esc(analysed.exportedOn)}`);
  return `<div class="meta-app">${esc(analysed.name)}</div>
     <div class="meta-sub">${parts.join('<span class="dotsep">·</span>')}</div>`;
}

export interface NavEntry {
  id: string;
  label: string;
  /** For the entry of a file: the file's name as the analysis writes it ("Cards.csv"), by which its icon is chosen. */
  file?: string;
}

/** An icon of the navigation: a small drawing before an entry's words, drawn as the page's other icons are, and hidden from
 * a screen reader, for the words beside it say what the entry is. Each is the page's own markup, written once, here:
 * nothing of a result goes into one. */
const navIcon = (drawing: string): string =>
  `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${drawing}</svg>`;

/** The icons of the views that are no file the page knows: the overview, a model's map, and the table of any other file;
 * of the groups a model's tables stand in (`NAV_GROUPS`); and of the one menu of a window too narrow for the bar. */
export const NAV_ICONS = {
  /** Panels of different sizes, as on a board: everything about the run in one view. */
  overview: navIcon('<rect x="2" y="2" width="5" height="6" rx="1.2"/><rect x="9" y="2" width="5" height="3.5" rx="1.2"/><rect x="9" y="7.5" width="5" height="6.5" rx="1.2"/><rect x="2" y="10" width="5" height="4" rx="1.2"/>'),
  /** A folded map. */
  map: navIcon('<path d="M1.8 4.2 5.8 2.5l4.4 1.8 4-1.7v9.2l-4 1.7-4.4-1.8-4 1.7Z"/><path d="M5.8 2.5v9.2M10.2 4.3v9.2"/>'),
  /** A table, with its row of headers and its first column. */
  table: navIcon('<rect x="2" y="2.5" width="12" height="11" rx="1.5"/><path d="M2 6.2h12M6.2 2.5v11"/>'),
  /** An hourglass: the model's time. */
  time: navIcon('<path d="M4.5 1.8h7M4.5 14.2h7"/><path d="M5.2 1.8v2.4c0 1.6 2.8 2.6 2.8 3.8S5.2 10.2 5.2 11.8v2.4M10.8 1.8v2.4c0 1.6-2.8 2.6-2.8 3.8s2.8 2.2 2.8 3.8v2.4"/>'),
  /** A hierarchy, as a list's items stand under their parents. */
  lists: navIcon('<rect x="5.8" y="1.8" width="4.4" height="3.4" rx="1"/><rect x="1.8" y="10.8" width="4.4" height="3.4" rx="1"/><rect x="9.8" y="10.8" width="4.4" height="3.4" rx="1"/><path d="M8 5.2v2.8M4 10.8V8h8v2.8"/>'),
  /** Blocks of one size, side by side: the model's modules. */
  modules: navIcon('<rect x="2" y="2" width="5" height="5" rx="1.2"/><rect x="9" y="2" width="5" height="5" rx="1.2"/><rect x="2" y="9" width="5" height="5" rx="1.2"/><rect x="9" y="9" width="5" height="5" rx="1.2"/>'),
  /** A button that runs something: the model's actions. */
  actions: navIcon('<circle cx="8" cy="8" r="6.2"/><path d="M6.6 5.4v5.2l4.2-2.6Z"/>'),
  /** Three lines: a menu of every view. */
  menu: navIcon('<path d="M2.5 4h11M2.5 8h11M2.5 12h11"/>'),
} as const;

/** The chevron after the words of a button that opens a menu of the navigation, turned over while the menu is open. */
const NAV_CHEVRON = '<svg class="nav-chevron" width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6l4 4 4-4"/></svg>';
/** The same chevron for the choice of rows per page, which draws its own (results.css `.select`). */
const SELECT_CHEVRON = NAV_CHEVRON.replace('class="nav-chevron"', 'class="select-chevron"');

/** The icon of each file the page knows by name, a drawing of what the file lists: the app's seven (columns.ts
 * `APP_FILES`) and a model's (result-view.ts `MODEL_FILE_ORDER`), the tables of the pages built on it among them, each
 * under the name the analysis writes it under. An
 * entry's icon is found by that name and by nothing else, never by the entry's words: those are the file's label, which
 * is a result's like any of its texts. A file of any other name has the table's icon (`NAV_ICONS.table`). A map, so that a
 * name like that of an object's built-in property finds nothing. */
export const FILE_ICONS: ReadonlyMap<string, string> = new Map([
  // A page with its text.
  [APP_FILES.Pages, navIcon('<path d="M9.2 1.8H4.5A1.5 1.5 0 0 0 3 3.3v9.4a1.5 1.5 0 0 0 1.5 1.5h7a1.5 1.5 0 0 0 1.5-1.5V5.6Z"/><path d="M9.2 1.8v3.8H13M5.8 8.6h4.4M5.8 11.2h4.4"/>')],
  // A card, with more cards stacked behind it.
  [APP_FILES.Cards, navIcon('<path d="M5.5 2h5M3.8 4.6h8.4"/><rect x="2.2" y="7.2" width="11.6" height="7" rx="1.5"/>')],
  // A grid.
  [APP_FILES["Grid sections"], navIcon('<rect x="2" y="2" width="12" height="12" rx="1.5"/><path d="M2 6h12M2 10h12M6 2v12M10 2v12"/>')],
  // A funnel, as on the buttons of a table's filters.
  [APP_FILES.Filters, navIcon(FILTER_PATH)],
  // A painter's palette: a card's colours, set by a rule.
  [APP_FILES.Formatting, navIcon('<path d="M8 1.8a6.2 6.2 0 0 0 0 12.4c.8 0 1.3-.5 1.3-1.2 0-.6-.5-1-.5-1.6 0-.7.5-1.2 1.2-1.2h1.5a2.8 2.8 0 0 0 2.8-2.8C14.3 4.4 11.5 1.8 8 1.8Z"/>'
    + '<circle cx="4.9" cy="8.4" r="1" fill="currentColor" stroke="none"/><circle cx="6.3" cy="5.1" r="1" fill="currentColor" stroke="none"/><circle cx="9.8" cy="4.6" r="1" fill="currentColor" stroke="none"/>')],
  // A pointer that clicks.
  [APP_FILES.Actions, navIcon('<path d="M6.2 6.2 13.6 9.2l-3.1.9-.9 3.1Z"/><path d="M4.6 1.8l.5 2M1.8 4.6l2 .5M9.4 2.6 8.2 4M2.6 9.4 4 8.2"/>')],
  // A pin: where an object is used.
  [APP_FILES["Where used"], navIcon('<path d="M8 14.3s-4.6-4.2-4.6-7.7a4.6 4.6 0 0 1 9.2 0c0 3.5-4.6 7.7-4.6 7.7Z"/><circle cx="8" cy="6.6" r="1.7"/>')],
  // A calendar.
  [MODEL_CALENDAR_FILE, navIcon('<rect x="2" y="3" width="12" height="11" rx="1.5"/><path d="M2 6.6h12M5.4 1.8v2.4M10.6 1.8v2.4"/>')],
  // A clock.
  ["Time Ranges.csv", navIcon('<circle cx="8" cy="8" r="6.2"/><path d="M8 4.6V8l2.3 1.5"/>')],
  // Layers, one over another, as a model's versions are.
  ["Versions.csv", navIcon('<path d="M8 1.8 14.2 5 8 8.2 1.8 5Z"/><path d="M1.8 8.2 8 11.4l6.2-3.2M1.8 11.2 8 14.4l6.2-3.2"/>')],
  // A list, item under item.
  ["General Lists.csv", navIcon('<path d="M6 4h8M6 8h8M6 12h8"/><path d="M2.8 4h.01M2.8 8h.01M2.8 12h.01" stroke-width="2.2"/>')],
  // A list with some of its items ticked.
  ["Line Item Subsets.csv", navIcon('<path d="M2 4.6l1.3 1.3 2.6-2.6M2 11.1l1.3 1.3 2.6-2.6M8 4h6M8 8h6M8 12h6"/>')],
  // A box: a module.
  [MODULES_FILE, navIcon('<path d="M8 1.8 13.6 5v6.2L8 14.4 2.4 11.2V5Z"/><path d="M2.4 5 8 8.2 13.6 5M8 8.2v6.2"/>')],
  // Lines that hang from a line: a module's line items.
  [LINE_ITEMS_FILE, navIcon('<path d="M5.3 4H14M8.7 8H14M8.7 12H14M2 4v2.7c0 .7.6 1.3 1.3 1.3h2M2 6.7v4c0 .7.6 1.3 1.3 1.3h2"/>')],
  // A padlock: who may read a cell, and who may write it.
  [ACCESS_FILE, navIcon('<rect x="3" y="7.2" width="10" height="7" rx="1.5"/><path d="M5.5 7.2V5.2a2.5 2.5 0 0 1 5 0v2"/>')],
  // One step that leads to the next.
  ["Processes.csv", navIcon('<rect x="2" y="2" width="5.3" height="5.3" rx="1.3"/><rect x="8.7" y="8.7" width="5.3" height="5.3" rx="1.3"/><path d="M4.7 7.3V10A1.3 1.3 0 0 0 6 11.3h2.7"/>')],
  // An arrow that goes in.
  ["Imports.csv", navIcon('<path d="M10 2h2.7A1.3 1.3 0 0 1 14 3.3v9.4a1.3 1.3 0 0 1-1.3 1.3H10"/><path d="M6.7 11.3 10 8 6.7 4.7M10 8H2"/>')],
  // A store of data.
  ["Import Data Sources.csv", navIcon('<path d="M2.2 3.7a5.8 2 0 1 0 11.6 0a5.8 2 0 1 0-11.6 0"/><path d="M2.2 3.7v8.6a5.8 2 0 0 0 11.6 0V3.7M2.2 8a5.8 2 0 0 0 11.6 0"/>')],
  // An arrow that goes out.
  ["Exports.csv", navIcon('<path d="M6 14H3.3A1.3 1.3 0 0 1 2 12.7V3.3A1.3 1.3 0 0 1 3.3 2H6"/><path d="M10.7 11.3 14 8l-3.3-3.3M14 8H6"/>')],
  // A bolt: an action of another kind.
  ["Other Actions.csv", navIcon('<path d="M9 1.8 3 9.2h4.6L7 14.2l6-7.4H8.4Z"/>')],
  // A server: the other models that an import reads from.
  ["Source Models.csv", navIcon('<rect x="2" y="2.2" width="12" height="5" rx="1.3"/><rect x="2" y="8.8" width="12" height="5" rx="1.3"/><path d="M4.8 4.7h.01M4.8 11.3h.01" stroke-width="2"/>')],
  // A box on a page: a module where a page shows it.
  [MODULE_USAGE_FILE, navIcon('<path d="M9.2 1.8H4.5A1.5 1.5 0 0 0 3 3.3v9.4a1.5 1.5 0 0 0 1.5 1.5h7a1.5 1.5 0 0 0 1.5-1.5V5.6Z"/><path d="M9.2 1.8v3.8H13"/>'
    + '<rect x="5.4" y="8" width="5.2" height="3.8" rx="0.9"/>')],
  // A funnel beside lines: the filters of a page's cards.
  [PAGE_FILTERS_FILE, navIcon('<path d="M1.8 3h7.4L6.4 6.6v4.6l-1.8 1.4v-6Z"/><path d="M11.4 4h2.8M11.4 8h2.8M11.4 12h2.8"/>')],
  // A button that a pointer clicks: the buttons of a page's cards.
  [PAGE_ACTIONS_FILE, navIcon('<rect x="1.8" y="2.2" width="10.4" height="5.6" rx="2.8"/><path d="M8.6 8.6l5.4 2.2-2.3.7-.7 2.3Z"/>')],
]);

/** An entry's icon: the overview's, a model's map's, or that of the entry's file, by the file's name alone. */
const entryIcon = (entry: NavEntry): string =>
  (entry.id === "overview" ? NAV_ICONS.overview : entry.id === "map" ? NAV_ICONS.map : FILE_ICONS.get(entry.file ?? "") ?? NAV_ICONS.table);

/** The groups a model's navigation gathers its tables in, each a button that opens a menu of the group's tables: in the
 * order of Anaplan's Model settings (result-view.ts `MODEL_FILE_ORDER`), each group by the names the analysis writes its
 * files under, never by a table's words. Versions and Source Models are one file each, and stand in the bar on their own,
 * as does a file that no group names: none is left out. Each group's ID is the ID of its menu. The page's own words and
 * drawings only: nothing of a result. */
export const NAV_GROUPS: readonly { id: string; label: string; icon: string; files: readonly string[] }[] = [
  { id: "navGroupTime", label: "Time", icon: NAV_ICONS.time, files: [MODEL_CALENDAR_FILE, "Time Ranges.csv"] },
  { id: "navGroupLists", label: "Lists", icon: NAV_ICONS.lists, files: ["General Lists.csv", "Line Item Subsets.csv"] },
  { id: "navGroupModules", label: "Modules", icon: NAV_ICONS.modules, files: [MODULES_FILE, LINE_ITEMS_FILE, ACCESS_FILE] },
  { id: "navGroupActions", label: "Actions", icon: NAV_ICONS.actions, files: ["Processes.csv", "Imports.csv", "Import Data Sources.csv", "Exports.csv", "Other Actions.csv"] },
];

/** A group of a model's navigation, with the entries of the tables it holds, in their order. */
export interface NavGroup { group: (typeof NAV_GROUPS)[number]; entries: NavEntry[] }
/** What stands in the navigation: an entry, or a group of entries. */
export type NavItem = NavEntry | NavGroup;
const isGroup = (item: NavItem): item is NavGroup => "entries" in item;

/** The navigation's items. A model's tables stand in their groups (`NAV_GROUPS`), each group where its first table stands,
 * with the tables of its files that the result has: a group with none is not there. A group of one table is that table's
 * own entry, as Versions is: a menu of one entry would be a press more for nothing. Every other entry keeps its place.
 * An app's entries stand as they are, whatever their files are called: `grouped` is the result's kind, never a file's name. */
export function navItems(entries: readonly NavEntry[], grouped: boolean): NavItem[] {
  if (!grouped) return [...entries];
  const items: NavItem[] = [];
  const started = new Map<string, NavGroup>();
  for (const entry of entries) {
    const group = NAV_GROUPS.find(each => entry.file !== undefined && each.files.includes(entry.file));
    const held = group && started.get(group.id);
    if (held) held.entries.push(entry);
    else if (group) {
      const made: NavGroup = { group, entries: [entry] };
      started.set(group.id, made);
      items.push(made);
    } else items.push(entry);
  }
  return items.map(item => (isGroup(item) && item.entries.length === 1 ? item.entries[0] : item));
}

/** An entry: a button with its icon and its words, marked where it is the view shown. How many rows a table has is the
 * overview's to say, on the table's tile. */
const entryHtml = (entry: NavEntry, current: string): string =>
  `<button type="button" class="nav-item" data-nav="${esc(entry.id)}"${entry.id === current ? ' aria-current="page"' : ""}>${entryIcon(entry)}<span>${esc(entry.label)}</span></button>`;

/** A button that opens a menu, and the menu, which follows it on the page, so that Tab goes from the button into it: the
 * disclosure pattern. The button says whether its menu is open (main.ts opens and closes it), and names the menu it
 * controls by the menu's ID, which is the page's own. `here` marks the button of a group that holds the view shown. */
const menuHtml = (id: string, button: string, here: boolean, menu: string): string =>
  `<div class="nav-group"><button type="button" class="nav-group-btn" aria-expanded="false" aria-controls="${id}"${here ? ' aria-current="true"' : ""}>${button}${NAV_CHEVRON}</button>`
  + `<div class="nav-menu" id="${id}" hidden>${menu}</div></div>`;

/** The navigation as one line of items, in the order given: the overview, a model's groups among its tables, and a
 * model's map last (main.ts `navEntries`). A group is a button with an icon, a name and a chevron: the group's own, or,
 * where the group holds the view shown, that entry's, so that the bar says which table is shown. The entry of the view
 * shown is marked as the page, and the button of the group that holds it as current. */
export function navHtml(items: readonly NavItem[], current: string): string {
  return items.map(item => {
    if (!isGroup(item)) return entryHtml(item, current);
    const shown = item.entries.find(entry => entry.id === current);
    const button = shown ? `${entryIcon(shown)}<span>${esc(shown.label)}</span>` : `${item.group.icon}<span>${item.group.label}</span>`;
    return menuHtml(item.group.id, button, shown !== undefined, item.entries.map(entry => entryHtml(entry, current)).join(""));
  }).join("");
}

/** The navigation as one menu, for a window too narrow for its line: a button that names the view shown, `here`, which
 * opens a menu of every item in the same order, a model's groups each under its name. */
export function navMenuHtml(items: readonly NavItem[], current: string, here: string): string {
  const listed = items.map(item => (isGroup(item)
    ? `<div class="nav-section" role="group" aria-label="${item.group.label}"><p class="nav-heading" aria-hidden="true">${item.group.label}</p>${item.entries.map(entry => entryHtml(entry, current)).join("")}</div>`
    : entryHtml(item, current))).join("");
  return menuHtml("navMenu", `${NAV_ICONS.menu}<span>${esc(here)}</span>`, false, listed);
}

/* ---------- overview ---------- */

/** Details beside their values, as the design's details list holds them. A value is written as its text, line breaks and
 * all: no tag stands for a line break, and nothing but the value stands in its element, for where the stylesheet shows a
 * value's lines (results.css `#ovAbout`) a space or a line break around the value would show as well. */
const detailRows = (rows: readonly (readonly [detail: string, value: string])[]): string => rows.map(([detail, value]) => `<dt>${esc(detail)}</dt><dd>${esc(value)}</dd>`).join("");

/** What the page keeps of the result on it for a refresh of the page (keep-result.ts), as the overview says it: "keeping"
 * while the result is being kept and there is no copy yet, "kept" while a copy is kept for the tab, "forgotten" once the
 * user has had that copy removed, "not-removed" when the user asked for that and the copy could not be removed, and
 * "none" otherwise: for a result that could not be kept. */
export type KeptCopy = "none" | "keeping" | "kept" | "not-removed" | "forgotten";

const KEPT_LINE = "A copy of this result is kept for a refresh of this page.";
/** What the overview says once the kept copy is removed. The line takes the focus, and a screen reader reads it there:
 * the page does not say it through its live region as well. */
export const FORGOTTEN_LINE = "The copy kept for refreshes is removed. This result stays here until you refresh or close this page.";
/** What the overview says when the kept copy could not be removed: no more than that, for the copy may still be there.
 * The page says it through its live region as well. */
export const NOT_REMOVED_LINE = "The copy kept for refreshes could not be removed.";

/** What stands in the overview's place for the kept copy (`#ovKept`). While a copy is kept: a line that says so, and the
 * button that forgets it, which the line describes. Once it is forgotten: the line that says so, which takes the focus the
 * button had. When it could not be removed: the line that says so, and the button still, for another try. That line is
 * news of what the button did, which the page's live region tells a screen reader once, so it is not the button's
 * description as well. Otherwise nothing at all, so that the place is empty and takes no room. Every word is the page's
 * own: the place holds nothing of a result.
 *
 * While the result is being kept, which ends a moment after it is drawn, the place holds the room for the line and the
 * button of a kept copy, so that what stands under it does not move when the two are shown. The room is their own words,
 * in the button's look, marked `to-come`: the stylesheet shows nothing of what is so marked, and a screen reader is told
 * nothing of it. It says nothing yet, for no copy is kept yet, and it is no control: there is nothing to forget. */
export function keptCopyHtml(copy: KeptCopy): string {
  const forget = (attributes = ""): string => `<button type="button" class="btn sm" data-act="forget"${attributes}>Forget this result</button>`;
  if (copy === "keeping") return `<span class="to-come" aria-hidden="true">${esc(KEPT_LINE)}</span><span class="btn sm to-come" aria-hidden="true">Forget this result</span>`;
  if (copy === "kept") return `<span id="keptLine">${esc(KEPT_LINE)}</span>${forget(' aria-describedby="keptLine"')}`;
  if (copy === "not-removed") return `<span id="keptLine">${esc(NOT_REMOVED_LINE)}</span>${forget()}`;
  return copy === "forgotten" ? `<span id="keptLine" tabindex="-1">${esc(FORGOTTEN_LINE)}</span>` : "";
}

/** The overview: everything about the run in one view. Under the tiles, what someone checks first: what was read and when,
 * with what the page keeps of the result for a refresh (`copy`) close under it, then the notes. After those, what is
 * looked up now and then: tables that say more than their tile, and two sections that start closed, how to read the
 * tables and the diagnostic log.
 *
 * A view's heading is the page's h1, so what stands under it is an h2, also inside a section that starts closed. The
 * drawer's heading is an h2 of the page shell, and its sections are h3. No view goes from one level to one two below it. */
/** `views`: for each tile, the place in the result of the table it counts. A tile with one opens that table, as the table's
 * entry of the navigation does; one without stays a tile to read. */
export function overviewHtml(overview: Overview, copy: KeptCopy = "none", views: readonly number[] = []): string {
  const about = overview.about.length ? `
    <div class="d-sec" id="ovAbout"><h2>About this export</h2>
      <dl class="dl">${detailRows(overview.about)}</dl></div>` : "";
  const files = overview.files.length ? `
    <div class="d-sec" id="ovFiles"><h2>Tables</h2>
      <dl class="dl">${detailRows(overview.files)}</dl></div>` : "";
  const howToRead = overview.howToRead.length ? `
    <details class="diag" id="ovHowTo">
      ${sectionSummary("How to read these tables")}
      <div class="diag-body"><dl class="dl">${detailRows(overview.howToRead)}</dl></div>
    </details>` : "";
  // The button stands above the log, so that it is in sight as soon as the section is open, however long the log is.
  const log = overview.log.length ? `
    <details class="diag" id="ovLog">
      ${sectionSummary("Diagnostics")}
      <div class="diag-body">
        ${copyLogButton("copy-diag")}
        <pre id="diagLog" tabindex="0" role="region" aria-label="Diagnostic log">${esc(overview.log.join("\n"))}</pre>
      </div>
    </details>` : "";
  // The design's Warnings panel, without its coloured dots: a note has no severity.
  const notes = overview.notes.length ? `
    <section class="panel" aria-labelledby="ovn" style="margin-bottom:12px"><h2 id="ovn">Notes</h2>
      <ul class="warn-list">
        ${overview.notes.map(note => `<li><span class="wl-ink">${esc(note)}</span></li>`).join("")}
      </ul>
    </section>` : "";
  return `
    <h1 class="view-title">Overview</h1>
    <div class="ov-grid">
      ${overview.tiles.map((tile, at) => {
        // A table that does not list every row of its file: the tile counts the rows listed, and says how many there
        // are in all. It does not say that they were read: a Model Calendar's rows are a template's, which the export fills in.
        const parts = `<span class="s-lab">${esc(tile.label)}</span><span class="s-num">${esc(tile.count)}</span><span class="s-sub">${tile.count === 1 ? "row" : "rows"}</span>${
          tile.inAll === undefined ? "" : `<span class="s-sub">${esc(tile.inAll)} ${tile.inAll === 1 ? "row" : "rows"} in all</span>`}`;
        const view = views[at];
        return view === undefined ? `<div class="stat">${parts}</div>` : `<button type="button" class="stat stat-open" data-nav="${view}">${parts}</button>`;
      }).join("")}
    </div>${about}
    <p class="ov-kept" id="ovKept">${keptCopyHtml(copy)}</p>${notes}${files}${howToRead}${log}`;
}

/* ---------- the run, before there is a result ---------- */

/** The view while the page connects and the analysis runs, and when it could not: a heading, the status or the message,
 * what to do, and the diagnostic log. It holds no text of its own: the page sets each part as plain text. */
export function runHtml(): string {
  return `
    <h1 class="view-title" id="runTitle"></h1>
    <div class="panel" style="margin-bottom:12px"><div class="empty">
      <div class="e-title" id="runStatus"></div>
      <div class="e-sub" id="runHint"></div>
      ${refreshButton("runRefresh")}
    </div></div>
    <details class="diag" id="runLog" open hidden>
      ${DIAGNOSTICS_SUMMARY}
      <div class="diag-body">
        <pre id="diagLog" tabindex="0" role="region" aria-label="Diagnostic log"></pre>
        ${copyLogButton("copy-run-log")}
      </div>
    </details>`;
}

/** The banner a run's progress or failure stands in while an earlier result stays on the page: a heading, the status or
 * the message, what to do, and the button that copies that run's log. Like the run's own view it holds no text of the run:
 * the page sets each part as plain text. */
export function runBannerHtml(): string {
  return `<div class="banner note" id="runBanner">${INFO_ICON}
      <div><div><strong id="bannerTitle"></strong></div>
        <div><span id="bannerText"></span> <span id="bannerHint"></span></div>
        <div>The results below are from the earlier run.</div></div>
      ${refreshButton("bannerRefresh")}
      ${copyLogButton("copy-run-log", ' id="bannerCopy" style="margin-left:auto;flex:none" hidden')}</div>`;
}

/** The button that refreshes the Anaplan tab and runs again, when the tab still holds the model reader of an earlier
 * build (results/connection.ts "old-reader"). Hidden in every other state: it is the only thing on the page that
 * refreshes the tab. */
function refreshButton(id: string): string {
  return `<button type="button" class="btn primary" data-act="refresh-run" id="${id}" hidden>${esc(REFRESH_AND_RUN)}</button>`;
}

/** A note of the page's own above a result: one line, and the button that copies the run's log for a note whose reason
 * is in that log. It holds no text: the page sets the line as plain text, and shows the button when there is a reason. */
export function noteBannerHtml(): string {
  return `<div class="banner note" id="noteBanner">${INFO_ICON}
      <div><span id="noteText"></span></div>
      ${copyLogButton("copy-run-log", ' id="noteCopy" style="margin-left:auto;flex:none" hidden')}</div>`;
}

/* ---------- the model map ---------- */

/** What a model's map is called: in the navigation and as its view's heading. */
export const MAP_LABEL = "Model map";
/** What the view says when the map could not be drawn: that it could not, that the tables are as they were, each under
 * its own entry, and what to do. It names the button beside it as that reads; the reason is in the log the button copies. */
export const MAP_FAILED = "The model map could not be drawn. The tables are not affected. Choose Copy diagnostic log and send the log.";

/** The view while a model's map is shown. The map itself stands in a place of its own beside the view (results.html
 * `#mapHost`), which takes all the room there is. So the view holds its heading and no more, for a screen reader only:
 * to the eye the map's entry in the navigation, marked as the view shown, says the same. When the map could not be drawn
 * (`failed`) the view says so instead, under the heading, with the button that copies the run's log, where the reason
 * is. Every word is the page's own: the view holds nothing of a result. */
export function mapHtml(failed: boolean): string {
  if (!failed) return `<h1 class="sr-only">${MAP_LABEL}</h1>`;
  return `
    <h1 class="view-title">${MAP_LABEL}</h1>
    <div class="banner warn">${INFO_ICON}
      <div>${MAP_FAILED}</div>
      ${copyLogButton("copy-run-log", ' style="margin-left:auto;flex:none"')}</div>`;
}

/* ---------- table ---------- */

/** One of the ways a table can be shown, for a file the page shows in more than one: its name among the page's own, the
 * words on its button, and whether it is the one shown. */
export interface TableWay { way: string; label: string; chosen: boolean }

export interface TableView {
  label: string;
  /** A line under the table's name, for a table that does not list every row of its file, or that needs a line to say
   * what it lists. */
  note: string | undefined;
  /** The ways the table can be shown, when it has more than one: a switch stands at the head of its toolbar. */
  ways?: readonly TableWay[];
  /** For a table that lists no row although its file has rows, which `note` says: what it says in the rows' place. */
  none?: string;
  /** For a table whose file has no rows: what it says in the rows' place, where a file has a sentence of its own for that. */
  empty?: string;
  /** The column whose cell opens a row, by its place in the table, for a table in which that is not the first column
   * shown. While that column is not among those shown, the first one opens the row, as in any table. */
  opensFrom?: number;
  /** The columns shown, in the table's order. */
  columns: readonly Column[];
  /** Each column's width in ch, by its place in the table's headers, worked out from every row of the table and not
   * from the rows on screen (column-widths.ts `columnWidths`): the same whatever the sort, the page, the search, the
   * filters or a jump, so that none of them moves the table's columns. A column without one is as wide as its header. */
  widths: ReadonlyMap<number, number>;
  /** The rows of the page shown. */
  rows: readonly Row[];
  /** The rows of the table that are headings, which it shows in bold above the rows they head: a module's own row of a
   * model's Line Items. */
  headings?: ReadonlySet<Row>;
  page: number;
  pages: number;
  pageSize: number;
  from: number;
  to: number;
  /** The rows left by the search, the filters and a jump, and the rows the file has. */
  total: number;
  all: number;
  search: string;
  sort: Sort | undefined;
  /** The columns with a filter in force. */
  filtered: ReadonlySet<number>;
  /** For a column whose range is in force, what it keeps in a few words (range-filter.ts `rangeSummary`): its filter's
   * button says it. */
  ranged?: ReadonlyMap<number, string>;
  /** The page a jump from another table keeps. */
  context: string | undefined;
  links: Links;
}

/** The pager: Previous and Next, each disabled where there is no page to turn to, and the choice of rows per page. It
 * names no page by its number: the count that stands just before it says which rows are shown and of how many
 * ("51–100 of 229 rows"), and that is what tells the user where they are in the table. */
export function pagerHtml(page: number, pages: number, total: number, pageSize: number): string {
  if (total === 0) return "";
  return `
    <button type="button" class="pg-btn" data-page="${page - 1}" ${page === 0 ? "disabled" : ""} aria-label="Previous page">‹</button>
    <button type="button" class="pg-btn" data-page="${page + 1}" ${page >= pages - 1 ? "disabled" : ""} aria-label="Next page">›</button>
    <span class="per-page">Rows per page
      <span class="select"><select id="pageSize" aria-label="Rows per page">
        ${[25, 50, 100].map(size => `<option value="${size}" ${size === pageSize ? "selected" : ""}>${size}</option>`).join("")}
      </select>${SELECT_CHEVRON}</span></span>`;
}

/** The parts of a table view that follow what the user asked for: the search, the filters, the sort and the page. The
 * page writes these again while the user types, and leaves the rest of the view, the search box above all, as it is. */
export interface TableParts {
  /** What the table's box holds: the table, or why it shows no row. */
  grid: string;
  pager: string;
  /** Which rows are shown, as text: "1–50 of 120 rows". */
  count: string;
  /** Whether a search, a filter, a sort or a jump is in force: Reset is offered then. */
  modified: boolean;
}

/** A column's width as the page writes it into the column's style: a whole number of ch, which the page worked out
 * itself (column-widths.ts) and which no text of a result can be. Anything but a number is the widest a column gets. */
const colWidth = (width: number): number => (Number.isFinite(width) ? Math.min(WIDEST, Math.max(1, Math.round(width))) : WIDEST);

/** Whether a row's opening button stands before the content of a cell of this column, rather than being its content:
 * where the cell is a link or an ID to copy (`rowCellHtml`). The column of such cells takes the button's room as well,
 * when it is the one that opens the row. */
const besideButton = (column: Column, links: Links): boolean => column.kind === "id" || (column.kind === "page" && links.page) || (column.kind === "card" && links.card);

export function tableParts(view: TableView): TableParts {
  const label = esc(view.label);
  const searching = view.search.trim() !== "";
  const filtering = view.filtered.size > 0;
  const jumped = view.context !== undefined;
  // The cell that opens the row: the first one shown, or that of the column the table has for it, where it is shown.
  const opens = Math.max(0, view.columns.findIndex(column => column.index === view.opensFrom));

  // The table is laid out by these widths, one for each column shown, and by nothing it shows (results.css): a column
  // is as wide on every page, in every order and under every search and filter. The stylesheet reads each width from
  // the column's style, where it is the only value, and keeps the first column to half the table's box.
  const cols = view.columns.map((column, position) => {
    const width = (view.widths.get(column.index) ?? headerWidth(column)) + (position === opens && besideButton(column, view.links) ? ROW_BUTTON : 0);
    return `<col style="--width:${colWidth(width)}ch">`;
  }).join("");

  const head = view.columns.map(column => {
    const dir = view.sort?.column === column.index ? view.sort.dir : undefined;
    const aria = dir ? (dir === "asc" ? "ascending" : "descending") : "none";
    // The arrow's place is in every header, empty where the column is not sorted, and the stylesheet gives it the same
    // room either way (`.th-sort .dir`): a sort changes what it shows, not how wide the header is.
    const arrow = `<span class="dir" aria-hidden="true">${dir ? (dir === "asc" ? "▲" : "▼") : ""}</span>`;
    const name = esc(column.label);
    // A filter in force shows in more than the button's colour: the funnel is filled, where it is otherwise an outline,
    // and the button's name says so, with what a range keeps. The page sets aria-expanded while the button's popover is open.
    const active = view.filtered.has(column.index);
    const range = active ? view.ranged?.get(column.index) : undefined;
    const says = `Filter by ${name}${active ? ` (filter on${range ? `: ${esc(range)}` : ""})` : ""}`;
    const filter = column.filter ? `<button type="button" class="th-filter ${active ? "active" : ""}"
        data-colfilter="${column.index}" aria-label="${says}" aria-haspopup="dialog" aria-expanded="false" title="${says}">
        <svg width="11" height="11" viewBox="0 0 16 16" ${active ? 'fill="currentColor"' : 'fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"'} aria-hidden="true">${FILTER_PATH}</svg></button>` : "";
    return `<th scope="col" class="${column.num ? "num" : ""}" aria-sort="${aria}">
      <div class="th-in"><button type="button" class="th-sort" data-sort="${column.index}">${name}${arrow}</button>${filter}</div></th>`;
  }).join("");

  let body = "";
  let empty = "";
  if (view.all === 0) {
    // A table without rows says that nothing was found, unless its file has rows that the table does not list: the line
    // under its name counts those, and here the table says that none of them is its own.
    empty = `<div class="empty">
      <svg width="30" height="30" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" aria-hidden="true">${FILTER_PATH}</svg>
      <div class="e-title">${label} has no rows${view.none === undefined ? "" : " of its own"}</div>
      <div class="e-sub">${esc(view.none ?? view.empty ?? "Nothing was found for this table in this analysis.")}</div>
      </div>`;
  } else if (view.total === 0) {
    const what = [...(searching ? ["search"] : []), ...(filtering ? ["column filters"] : []), ...(jumped ? ["page selection"] : [])].join(" and ");
    empty = `<div class="empty">
      <svg width="30" height="30" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" aria-hidden="true">${SEARCH_PATH}</svg>
      <div class="e-title">No results</div>
      <div class="e-sub">Nothing in ${label} matches the current ${what}.</div>
      <button type="button" class="btn sm" data-act="reset">Clear search &amp; filters</button>
      </div>`;
  } else {
    body = view.rows.map(row => `<tr${view.headings?.has(row) ? ' class="heading"' : ""}>${view.columns.map((column, position) =>
      `<td class="${column.num ? "num" : ""}">${position === opens ? rowCellHtml(column, row, view.links) : cellHtml(column, row, view.links)}</td>`).join("")}</tr>`).join("");
  }

  return {
    grid: `<table><colgroup>${cols}</colgroup><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
      ${empty}
      <div class="scroll-fade" aria-hidden="true"></div>`,
    pager: pagerHtml(view.page, view.pages, view.total, view.pageSize),
    count: (view.total === 0 ? "No rows" : `${view.from}–${view.to} of ${view.total} ${view.total === 1 ? "row" : "rows"}`) + (view.total !== view.all ? ` (filtered from ${view.all})` : ""),
    modified: searching || filtering || jumped || view.sort !== undefined,
  };
}

/** A table view whole: its name, its toolbar, and the table's box under it, with the parts above in their places. The
 * toolbar holds the search box and the Columns and Reset buttons, and at its right end the count and then the pager, which
 * is its last child: nothing stands under the table. A table that can be shown in more than one way has the switch
 * between them at the toolbar's head: a button for each way, which says whether it is the one shown (aria-pressed), and
 * the one shown is also the filled one. Where a jump keeps the table to one page's cards, that page stands next, before
 * the search box, as a chip with the button that clears it: the same filter as the search and Reset, beside them. */
export function tableHtml(view: TableView): string {
  const label = esc(view.label);
  const parts = tableParts(view);
  const ways = view.ways?.length ? `
      <div class="ways" id="tableWays" role="group" aria-label="How ${label} is listed">
        ${view.ways.map(way => `<button type="button" class="btn sm${way.chosen ? " primary" : ""}" data-way="${esc(way.way)}" aria-pressed="${way.chosen ? "true" : "false"}">${esc(way.label)}</button>`).join("\n        ")}
      </div>` : "";
  const context = view.context === undefined ? "" : `
      <span class="ctx" id="pageFilter">Page: ${esc(view.context)}
        <button type="button" data-act="clear-context" aria-label="Clear page filter">
          ${CLOSE_ICON}
        </button></span>`;
  const note = view.note === undefined ? "" : `
    <p class="view-note">${esc(view.note)}</p>`;
  return `
    <h1 class="view-title">${label}</h1>${note}
    <div class="toolbar">${ways}${context}
      <div class="search-wrap ${view.search ? "has-value" : ""}" id="searchWrap">
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true">${SEARCH_PATH}</svg>
        <input id="tblSearch" type="search" value="${esc(view.search)}" placeholder="Search all columns…" aria-label="Search ${label}">
        <button type="button" class="search-clear" data-act="clear-search" aria-label="Clear search">
          ${CLOSE_ICON}</button>
        <kbd title="Press / to focus search">/</kbd>
      </div>
      <button type="button" class="btn sm" id="colBtn" aria-haspopup="dialog" aria-expanded="false">
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11"/></svg>
        Columns</button>
      <button type="button" class="btn sm" data-act="reset" id="resetBtn" ${parts.modified ? "" : "hidden"}>Reset</button>
      <span class="rowcount" id="rowCount">${esc(parts.count)}</span>
      <div class="pager" id="pager">${parts.pager}</div>
    </div>
    <div class="table-wrap" id="tableWrap" tabindex="0" role="region" aria-label="${label} table">
      ${parts.grid}
    </div>`;
}

/* ---------- popovers ---------- */

/** A column filter's values: each text the column holds, or each item its cells list, with its number of rows. */
export type FilterValues = readonly (readonly [value: string, count: number])[];

/** A filter has a box to find its values once it has more than this many: a longer list is read by searching it. */
export const FILTER_FIND_FROM = 15;
/** A filter lists at most this many of its values at once, and says how many more there are: the box finds the others.
 * The page stays quick to open a filter whatever a column holds, a model's line items' many modules included. */
export const FILTER_LISTED_MAX = 300;

/** A filter's value as its list shows it, which is also what its box finds it by: a blank as the word in brackets, and a
 * count with its thousands apart, as its cells show it. */
export const filterValueText = (column: Column, value: string): string => (value === "" ? "(blank)" : column.kind === "count" ? groupedCount(value) : value);

/** The values a filter's box finds for `find`, by their places in `values`: those whose shown text holds it, whatever its
 * case. Every value when nothing is typed. */
export function filterMatches(column: Column, values: FilterValues, find: string): number[] {
  const needle = find.trim().toLowerCase();
  return values.flatMap(([value], index) => (!needle || filterValueText(column, value).toLowerCase().includes(needle) ? [index] : []));
}

/** The boxes of a filter's values: those of `matches` (places in `values`), at most `FILTER_LISTED_MAX` of them, each
 * ticked when shown. A box is known by its value's place in `values`, so no value is read back out of the page. */
export function filterOptionsHtml(column: Column, values: FilterValues, matches: readonly number[], selected: ReadonlySet<string> | undefined): string {
  if (!values.length) return '<div class="pop-empty">No values</div>';
  if (!matches.length) return '<div class="pop-empty">No value matches</div>';
  return matches.slice(0, FILTER_LISTED_MAX).map(index => {
    const [value, count] = values[index];
    return `
        <label class="pop-opt"><input type="checkbox" data-fval="${index}" ${!selected || selected.has(value) ? "checked" : ""}>
        <span style="overflow:hidden;text-overflow:ellipsis">${value === "" ? BLANK : esc(filterValueText(column, value))}</span>
        <span class="po-cnt">${esc(count)}<span class="sr-only"> ${count === 1 ? "row" : "rows"} in the whole table</span></span></label>`;
  }).join("");
}

/** What a filter with a box says of its list, for a screen reader as well: how many values it has, how many the box finds,
 * and that only the first are listed when there are more than the list holds. */
export function filterStatusText(values: FilterValues, matches: readonly number[], find: string): string {
  const found = find.trim() !== "";
  const said = found ? `${matches.length} of ${values.length} ${values.length === 1 ? "value matches" : "values match"}` : `${values.length} values`;
  return matches.length > FILTER_LISTED_MAX ? `${said}. The first ${FILTER_LISTED_MAX} are listed: type to narrow the list.` : `${said}.`;
}

/** The words of the two buttons that tick or untick every value the box finds: all of them while nothing is typed. */
export const filterTickWords = (find: string): [tick: string, untick: string] => (find.trim() === "" ? ["Tick all", "Untick all"] : ["Tick matches", "Untick matches"]);

/** A column's filter: each text the column holds with its number of rows, ticked when shown. The numbers count the rows
 * of the whole table, whatever the search, the other filters or a jump leave on screen, and a line above them says so. A
 * count's column lists each count as its cells show it, with its thousands apart. A column whose cells list items (`list`)
 * lists each item, and says that a row shows when any of its items is ticked. A filter of many values has a box to find
 * them, which has the focus when the filter opens, two buttons that tick or untick what it finds, and a line that says how
 * many it finds: only the first `FILTER_LISTED_MAX` are listed at once. */
export function colFilterHtml(column: Column, values: FilterValues, selected: ReadonlySet<string> | undefined, list = false): string {
  const finding = values.length > FILTER_FIND_FROM;
  const all = values.map((_, index) => index);
  const [tick, untick] = filterTickWords("");
  return `
    <div class="pop-hd"><span>Filter: ${esc(column.label)}</span><button type="button" data-popact="all">Show all</button></div>
    ${finding ? `<div class="pop-find"><input type="search" data-ffind data-first autocomplete="off" spellcheck="false" placeholder="Find a value" aria-label="Find a value of ${esc(column.label)}"></div>
    <div class="pop-acts"><button type="button" data-popact="tick">${tick}</button><button type="button" data-popact="untick">${untick}</button></div>` : ""}
    ${list ? '<div class="pop-note">Each item is listed on its own: a row shows when any of its items is ticked.</div>' : ""}
    ${values.length ? '<div class="pop-hd" aria-hidden="true"><span>Value</span><span>Rows in the whole table</span></div>' : ""}
    <div class="pop-bd">
      ${filterOptionsHtml(column, values, all, selected)}
    </div>
    ${finding ? `<div class="pop-note" role="status" data-fstatus>${esc(filterStatusText(values, all, ""))}</div>` : ""}`;
}

/** The filter of a column of numbers or of dates (columns.ts `range`): a range, from one value to another, in two boxes
 * one under the other. A box left empty is an open end, and both ends are kept. A box for numbers shows the column's
 * lowest or highest value as its placeholder, as the cells show it; a box for dates is the browser's own, held to the
 * column's first and last day, and a line under them names both, and says that the column's times are UTC where its
 * header says so. A column with cells that say nothing offers to keep them or leave them out, with how many there are.
 * A line, empty until something cannot be read, says what is wrong, and a screen reader hears it at once. `state` is
 * the range in force, whose boxes are written back as they were typed. */
export function rangeFilterHtml(column: Column, read: RangeColumn, state: RangeState | undefined): string {
  const date = column.range === "date";
  const shown = (text: string) => (column.kind === "count" ? groupedCount(text) : text);
  const lowest = read.lowest ? (date ? dayText(read.lowest.value) : shown(read.lowest.text)) : "";
  const highest = read.highest ? (date ? dayText(read.highest.value) : shown(read.highest.text)) : "";
  const box = (end: "from" | "to", label: string, edge: string, typed: string) => date
    ? `<label class="pr-field"><span>${label}</span><input type="date" data-r${end} ${end === "from" ? "data-first" : ""} value="${esc(typed)}"
        ${lowest ? `min="${esc(lowest)}" max="${esc(highest)}"` : ""} aria-describedby="rangeHint"></label>`
    : `<label class="pr-field"><span>${label}</span><input type="text" inputmode="decimal" data-r${end} ${end === "from" ? "data-first" : ""} value="${esc(typed)}"
        placeholder="${esc(edge)}" autocomplete="off" spellcheck="false" aria-describedby="rangeHint"></label>`;
  const edges = lowest ? `${date ? "Earliest" : "Lowest"} ${lowest}, ${date ? "latest" : "highest"} ${highest}. ` : "";
  const utc = date && /\bUTC\b/.test(column.label) ? "The column's dates and times are UTC. " : "";
  const keep = state?.blanks !== false;
  return `
    <div class="pop-hd"><span>Filter: ${esc(column.label)}</span><button type="button" data-popact="clear">Clear</button></div>
    <div class="pop-range">${box("from", "From", lowest, state?.fromText ?? "")}${box("to", "To", highest, state?.toText ?? "")}</div>
    <div class="pop-note" id="rangeHint">${esc(utc)}${esc(edges)}${date ? "Whole days, both ends kept" : "Both ends kept"}; leave a box empty for no end there.</div>
    ${read.blanks ? `<label class="pop-opt pr-blanks"><input type="checkbox" data-rblanks ${keep ? "checked" : ""}><span>Keep blank cells</span>
      <span class="po-cnt">${esc(read.blanks)}<span class="sr-only"> ${read.blanks === 1 ? "row" : "rows"} in the whole table</span></span></label>` : ""}
    <div class="pop-err" role="alert" data-rerr hidden></div>
    <div class="pop-range-acts"><button type="button" class="btn sm primary" data-popact="apply">Apply</button></div>`;
}

/** The column chooser. A column that starts hidden because it holds IDs is marked as one; a number that starts hidden, a
 * card's or a section's, has no mark. */
export function colChooserHtml(columns: readonly Column[], hidden: ReadonlySet<number>): string {
  return `
    <div class="pop-hd"><span>Show / hide columns</span><button type="button" data-popact="defaults">Defaults</button></div>
    <div class="pop-bd">
      ${columns.map(column => `
        <label class="pop-opt"><input type="checkbox" data-col="${column.index}" ${hidden.has(column.index) ? "" : "checked"}>
        <span>${esc(column.label)}</span>${column.hidden && !column.num ? '<span class="po-cnt">ID</span>' : ""}</label>`).join("")}
    </div>`;
}

/* ---------- drawer ---------- */

/** A value that lists several items, as the drawer shows it: one item to a line, in the order the cell has them. Each item
 * stands in a `cell-t`, as a value of the drawer does, and the list holds nothing else: no separator of the cell's and no
 * space of the markup's own. */
/** Items one to a line; the items of a column of colour stops each with the square of its colour (`coloursHtml`). */
const itemsHtml = (items: Items, colours = false): string => `<ul class="cell-list">${items.map(item => `<li><span class="cell-t">${colours ? coloursHtml(item) : esc(item)}</span></li>`).join("")}</ul>`;

/** A row whole: every one of its cells, also those beyond the table's headers, each with its value in full. Nothing but
 * the value stands in a `dd`, so no space of the markup's own is kept with it. `exported` has, for each cell the table
 * says in words, the text that was read in its place, by the column's place: that text follows the words, under the
 * column's name and "as read", so that it is clear which of the two is which. Where the column is no column of the file,
 * `readUnder` has the name of the file's column the text was read from, by the column's place, and the text is named by
 * that name instead (result-view.ts `FileView`). `items` has, for each cell that lists several items (cell-lists.ts), those
 * items, by the column's place: the cell is listed one item to a line. Only a column of plain text or of colour stops is
 * listed so, the colour stops each with its square: an ID, a tag and a link stay what they are. */
const allColumns = (columns: readonly Column[], row: Row, links: Links, exported?: ReadonlyMap<number, unknown>, items?: ReadonlyMap<number, Items>,
  readUnder?: ReadonlyMap<number, string>): string =>
  `<dl class="d-dl">${rowColumns(columns, row).map(column => {
    const listed = column.kind === "text" || column.kind === "colours" ? items?.get(column.index) : undefined;
    const shown = `<dt>${esc(column.label)}</dt><dd>${listed && listed.length > 1 ? itemsHtml(listed, column.kind === "colours") : cellHtml(column, row, links, true)}</dd>`;
    return exported?.has(column.index)
      ? `${shown}<dt>${esc(readUnder?.get(column.index) ?? column.label)} as read</dt><dd><span class="cell-t">${esc(exported.get(column.index))}</span></dd>` : shown;
  }).join("")}</dl>`;

/** A line under a drawer's table, in the small, quiet type of the card drawer's own line for a part it has none of. */
const drawerLine = (text: string): string => `<p style="font-size:12px;color:var(--text-3);margin:4px 0 0">${esc(text)}</p>`;

/** The mapping of an import from a file (import-mapping-view.ts): for an import into a list, how it tells the list's items
 * apart; a row of Source and Target for each source and a target it feeds; then the lines under them, about the targets
 * nothing feeds and the columns it does not use, or about why there is no row to show. */
export function importMappingHtml(mapping: MappingView): string {
  const match = mapping.match === undefined ? "" : `<p style="font-size:12px;color:var(--text-2);margin:0 0 6px">${esc(mapping.match)}</p>`;
  const table = mapping.rows.length ? `<table class="mini"><thead><tr><th>Source</th><th>Target</th></tr></thead>
      <tbody>${mapping.rows.map(([source, target]) => `<tr><td>${esc(source)}</td><td>${esc(target)}</td></tr>`).join("")}</tbody></table>` : "";
  return `<div class="d-sec" id="drawerMapping"><h3>Mapping</h3>
      ${match}${table}${mapping.lines.map(drawerLine).join("")}</div>`;
}

/** The actions of a process (process-actions-view.ts), with their number in the order the process runs them where that is
 * known, each with its kind, then the lines under them. An action whose row the page can open, `opens` says by its place,
 * is named by a link that opens that row's details; any other is named as text. */
export function processActionsHtml(process: ProcessView, opens: readonly boolean[]): string {
  const name = (step: ProcessView["steps"][number], index: number): string => (opens[index]
    ? `<button type="button" class="link" data-act="step" data-step="${index}">${esc(step.name)}</button>` : esc(step.name));
  const table = process.steps.length ? `<table class="mini"><thead><tr>${process.ordered ? "<th>#</th>" : ""}<th>Action</th><th>Kind</th></tr></thead>
      <tbody>${process.steps.map((step, index) => `<tr>${process.ordered ? `<td>${index + 1}</td>` : ""}<td>${name(step, index)}</td><td>${esc(step.kind)}</td></tr>`).join("")}</tbody></table>` : "";
  return `<div class="d-sec" id="drawerSteps"><h3>Actions (${process.steps.length})</h3>
      ${table}${process.lines.map(drawerLine).join("")}</div>`;
}

/** One row in full: every column, hidden ones included, with nothing cut short, for each cell that is said in words the
 * text that was read (`exported`), named by the file's column it was read from where that is another (`readUnder`), and
 * for each cell that lists several items those items, one to a line (`items`). A row of an import from a file has its
 * mapping after the columns (`mapping`), and a row of a process the actions it runs (`process`). */
export function rowDrawerHtml(columns: readonly Column[], row: Row, links: Links, exported?: ReadonlyMap<number, unknown>, items?: ReadonlyMap<number, Items>,
  readUnder?: ReadonlyMap<number, string>, mapping?: MappingView, process?: { view: ProcessView; opens: readonly boolean[] }): string {
  return `<div class="d-sec"><h3>All columns</h3>
    ${allColumns(columns, row, links, exported, items, readUnder)}</div>${mapping ? importMappingHtml(mapping) : ""}${process ? processActionsHtml(process.view, process.opens) : ""}`;
}

/** Where a button at the top right of a row's details leads: the model map, a module or a list of the model in Model
 * Building, an app, or a page of an app. */
export type OpenKind = "map" | "module" | "app" | "page";
/** One such button: where it leads, its few words, and what it opens, by name, which its title says. */
export interface OpenButton { kind: OpenKind; label: string; title: string }

/** The icon of each kind of button, a drawing of where it leads: the map's folded map, as the navigation's; the model, as a
 * box, for a module or a list opened in it; an app as a window with its bar; and a page with its text, as the Pages
 * table's. */
export const OPEN_ICONS: Readonly<Record<OpenKind, string>> = {
  map: NAV_ICONS.map,
  module: navIcon('<path d="M8 1.6 14 4.9v6.2L8 14.4 2 11.1V4.9Z"/><path d="M2 4.9 8 8.2l6-3.3M8 8.2v6.2"/>'),
  app: navIcon('<rect x="1.8" y="2.6" width="12.4" height="10.8" rx="2"/><path d="M1.8 6h12.4"/><path d="M4.2 4.3h.01M6.2 4.3h.01" stroke-width="1.8"/>'),
  page: FILE_ICONS.get(APP_FILES.Pages) ?? NAV_ICONS.table,
};

/** The buttons at the top right of a row's details, one under another, each with its icon and its words, and its title
 * naming what it opens. A button is named by its place among them, a number the page counts itself: what it opens is the
 * page's, read from the row it holds, never from the markup. */
export function opensHtml(opens: readonly OpenButton[]): string {
  return opens.map((open, index) =>
    `<button type="button" class="btn primary sm" data-act="open" data-open="${index}" title="${esc(open.title)}">${OPEN_ICONS[open.kind]}<span>${esc(open.label)}</span></button>`).join("");
}

/** Under a row's name in the drawer: which row of which table it is. `position` is the row's place in the file, from 1. */
export function rowDrawerSubHtml(position: number, label: string): string {
  return `Row ${esc(position)} of ${esc(label)}`;
}

/** Under a card's name in the drawer: its page (a jump to that page's cards), its type and its ID. `note` follows on a
 * line of its own: what the drawer says of a card whose parts it cannot list (result-view.ts `cardParts`). */
export function cardDrawerSubHtml(page: string, type: string, cardId: string, note?: string): string {
  const line = `<button type="button" class="link" data-act="page">${esc(page)}</button> · ${esc(type)} · ${idPill(cardId)}`;
  return note === undefined ? line : `${line}<div>${esc(note)}</div>`;
}

/** A cell of a card's part: its text, or its items one to a line where it lists several. */
const sectionCellHtml = (cell: SectionCell, colours = false): string => (typeof cell === "string" ? (colours ? coloursHtml(cell) : esc(cell)) : itemsHtml(cell, colours));

/** A card in full: its row of the Cards file, with each cell that lists several items listed one to a line (`items`, as
 * for any row), then its parts: the rows of the other files that carry its Card ID. */
export function cardDrawerHtml(columns: readonly Column[], row: Row, links: Links, sections: readonly CardSection[], items?: ReadonlyMap<number, Items>): string {
  return `
    <div class="d-sec"><h3>Card details</h3>
      ${allColumns(columns, row, links, undefined, items)}</div>
    ${sections.map(section => `<div class="d-sec"><h3>${esc(section.title)} (${section.rows.length})</h3>
      ${section.rows.length ? `<table class="mini"><thead><tr>${section.headings.map(heading => `<th>${esc(heading)}</th>`).join("")}</tr></thead>
        <tbody>${section.rows.map(cells => `<tr>${cells.map((cell, index) => `<td>${sectionCellHtml(cell, section.colours[index])}</td>`).join("")}</tr>`).join("")}</tbody></table>`
      : `<p style="font-size:12px;color:var(--text-3);margin:4px 0 0">No ${esc(section.none)} on this card.</p>`}</div>`).join("")}`;
}

/** How many of an object's uses its drawer lists at first. An object such as Time can have hundreds. */
export const USES_AT_FIRST = 50;

const saysSomething = (text: string): boolean => text.trim() !== "" && text.trim() !== NONE;

/** Under an object's name in its drawer: its type, its module, its model in an app of several, its ID to copy, and on how
 * many pages and cards it is used. A part that says nothing is left out. The pages and cards are said in the view's own
 * words (where-used-view.ts `usedOn`): a count that the file leaves open, because pages share a name, is "at least" that
 * many, as its cell in the table says with a plus sign. For such an object the view's note follows on a line of its own:
 * which names are shared, and what the counts can be. */
export function objectDrawerSubHtml(object: WhereUsedObject, multiModel: boolean): string {
  const line = [
    saysSomething(object.type) ? esc(object.type) : "",
    saysSomething(object.module) ? esc(object.module) : "",
    multiModel && saysSomething(object.model) ? esc(object.model) : "",
    saysSomething(object.id) ? idPill(object.id) : "",
    esc(usedOn(object)),
  ].filter(part => part !== "").join(" · ");
  return object.note === undefined || !saysSomething(object.note) ? line : `${line}<div>${esc(object.note)}</div>`;
}

/** An object of the Where Used table in full: each role it is used in with its number of uses, then its uses, as Page,
 * Card # and Used as. The uses are grouped by page, the pages in the file's order and each page's uses in the file's
 * order: a page is named with the first of its uses, and for a screen reader with each of them. A page's name jumps to
 * that page's cards, and a card's number opens the card, where the result has the cards to show (`links`) and, for a
 * card, the use names its card. A use is known by its place among the object's uses, which the page counted itself.
 * Where more than one page has a page's name, the file does not say which of them a use is on (`pagesOfName`): the name
 * then says how many pages have it, so that their uses under the one name are not read as one page's.
 * At first the drawer lists `USES_AT_FIRST` uses, with a control that lists them all (`all`): the first of the rest then
 * takes the focus. */
export function objectDrawerHtml(object: WhereUsedObject, links: Links, all: boolean): string {
  const byPage = new Map<string, number[]>();
  object.uses.forEach((use, index) => {
    const uses = byPage.get(use.page);
    if (uses) uses.push(index); else byPage.set(use.page, [index]);
  });
  const grouped = [...byPage.values()].flat();
  const listed = all ? grouped : grouped.slice(0, USES_AT_FIRST);
  const rows = listed.map((index, at) => {
    const use = object.uses[index];
    const first = at === 0 || object.uses[listed[at - 1]].page !== use.page;
    const shared = use.pagesOfName === undefined ? "" : `${esc(use.pagesOfName)} pages have this name`;
    const page = !first ? `<span class="sr-only">${esc(use.page)}${shared === "" ? "" : `, ${shared}`}</span>`
      : `${links.page && saysSomething(use.page) ? `<button type="button" class="link" data-act="use-page" data-use="${index}" title="Show cards on ${esc(use.page)}">${esc(use.page)}</button>`
        : esc(use.page)}${shared === "" ? "" : ` (${shared})`}`;
    const card = links.card && use.cardId !== undefined ? `<button type="button" class="link" data-act="use-card" data-use="${index}" title="Open card details">${esc(use.card)}</button>` : esc(use.card);
    // The first use that the control added is where the reader goes on: it can take the focus.
    return `<tr${all && at === USES_AT_FIRST ? ' id="usesRest" tabindex="-1"' : ""}><td>${page}</td><td>${card}</td><td>${esc(use.usedAs)}</td></tr>`;
  });
  const more = listed.length < grouped.length ? `
      <p style="font-size:12px;color:var(--text-3);margin:4px 0 0">The first ${listed.length} of ${grouped.length} uses are listed.
        <button type="button" class="link" data-act="more-uses">Show all ${grouped.length} uses</button></p>` : "";
  return `
    <div class="d-sec"><h3>Used as</h3>
      <table class="mini"><thead><tr><th>Used as</th><th>Uses</th></tr></thead>
        <tbody>${object.roles.map(([role, uses]) => `<tr><td>${role === "" ? BLANK : esc(role)}</td><td>${esc(uses)}</td></tr>`).join("")}</tbody></table></div>
    <div class="d-sec" id="drawerUses"><h3>Uses (${grouped.length})</h3>
      <table class="mini"><thead><tr><th>Page</th><th>Card #</th><th>Used as</th></tr></thead>
        <tbody>${rows.join("")}</tbody></table>${more}</div>`;
}
