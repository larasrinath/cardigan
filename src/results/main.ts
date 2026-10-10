import { buildModelGraph } from "../map/build-graph.js";
import type { ModelGraph, ModelMap, ModelMapOptions } from "../map/graph-types.js";
import { mountModelMap } from "../map/map-view.js";
import { CONTENT_SCRIPT_ORIGIN, PORT_NAME } from "../protocol.js";
import { plainResult, textOf } from "../result-plain.js";
import type { AnalysisResult, ResultTable } from "../result-types.js";
import { VERSION } from "../version.js";
import { cellLists, rowItems, type CellList } from "./cell-lists.js";
import { columnWidths } from "./column-widths.js";
import { cardsNamed, cardsOf, columnIndex, columnsOf, rowKeys, rowNameIndex, writesNone, type CardsTable, type Column, type RowKeys } from "./columns.js";
import { describeState, openedJustNow, repairTab, ResultsClient, runLabel, tabIdFrom, withoutOpened, type RunState } from "./connection.js";
import { analysedLine, notKeptNote } from "./keep-notes.js";
import { ResultKeeper } from "./keep-result.js";
import {
  cardDrawerHtml, cardDrawerSubHtml, colChooserHtml, colFilterHtml, headerMetaHtml, keptCopyHtml, MAP_FAILED, MAP_LABEL, mapHtml, MOON_ICON, navHtml, navItems, navMenuHtml,
  noteBannerHtml, NOT_REMOVED_LINE, objectDrawerHtml, objectDrawerSubHtml, overviewHtml, rowDrawerHtml, rowDrawerSubHtml, runBannerHtml, runHtml, SUN_ICON, tableHtml, tableParts,
  type KeptCopy, type Links, type NavEntry, type TableView,
} from "./markup.js";
import type { PageId } from "./page-ids.js";
import { LINE_ITEMS_FILE, MODULE_NAME } from "./line-items-view.js";
import { analysedOf, cardParts, detailsOf, detailValue, diagnosticLog, fileView, listedTables, MODULES_FILE, overviewOf, type FileView } from "./result-view.js";
import { cellText, NONE, pageOf, rememberingSelect, rowName, valueCounts, type Row, type Sort, type TableQuery } from "./table-engine.js";
import { EVERY_USE, objectOf, WHERE_USED_FILE, whereUsedView, type WhereUsedObject, type WhereUsedView } from "./where-used-view.js";

/** The results page (results.html): the design's script, on the real result. It connects to the Anaplan tab the address
 * names and says what that tab shows. The analysis starts by itself when the icon has just opened the page, and otherwise
 * with the run control. The page shows its progress and then the result: an overview, which also holds what the Details
 * file says, one table per file, and for a model its map. A result is shown here and nowhere else: the page makes no file
 * of it and offers none to download. The markup is built in markup.ts and the data work is done in the modules beside it; this file
 * only holds what the user chose and puts the pieces on the page. The map is src/map's: the page gives it a place and tells it when it is shown. */

const el = <T extends HTMLElement = HTMLElement>(id: PageId): T => document.getElementById(id) as T;
const find = <T extends HTMLElement = HTMLElement>(selector: string): T | null => document.querySelector<T>(selector);

/* ================= utilities ================= */
let toastTimer: ReturnType<typeof setTimeout> | undefined;
function toast(message: string): void {
  const node = el("toast");
  node.textContent = message;
  node.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove("show"), 2200);
}
function announce(message: string): void {
  el("live").textContent = message;
}

/** Gives the focus to the first of these that is on the page and can take it. After a part of the page is written again,
 * that is the control the user has just used, as it stands now, or the nearest thing to it. Without this the focus is left
 * on nothing, and a keyboard user starts again from the top of the page. */
function focusOn(...selectors: string[]): void {
  focusFirst(selectors, {});
}

/** The same for a control the page has just written again where it stood, in the table's head: a column's sort button
 * or its filter button. The browser is not let bring it into sight, for it is in sight where the user pressed it. A
 * browser that brings a control into sight scrolls the table's box sideways to it as soon as it is not wholly clear of
 * the first column, which stays at the left while the rest scrolls: the box keeps a band at its left for that column
 * (results.css `scroll-padding-left`), and a header in that band, or cut short at the box's right edge, would make the
 * table jump sideways under the pointer that pressed it. */
function focusInPlace(...selectors: string[]): void {
  focusFirst(selectors, { preventScroll: true });
}

/** Gives the focus to the first element these find that can take it, the browser being let scroll to it or not (`options`). */
function focusFirst(selectors: readonly string[], options: FocusOptions): void {
  for (const selector of selectors) {
    const node = find<HTMLButtonElement>(selector);
    if (node && !node.disabled && !node.hidden) {
      node.focus(options);
      return;
    }
  }
}

async function copyText(text: string, what = text): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast(`Copied ${what}`);
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    let copied = false;
    try { copied = document.execCommand("copy"); } catch { copied = false; }
    toast(copied ? `Copied ${what}` : "Copy failed");
    area.remove();
  }
}

/* ================= state ================= */
/** One file of the result as the page shows it: its columns, and what the user chose for it. The files are kept in the
 * order the navigation lists them in (result-view.ts `listedTables`). */
interface Shown {
  /** Its place in the result's tables, which is also its name in the navigation. */
  index: number;
  /** The file as the page shows it: the result's own table, unless the file has a rule of its own (result-view.ts
   * `fileView`). Then it is the table the rule gives, and `note` is the rule's line for under the table's name. */
  table: ResultTable;
  note: string | undefined;
  /** What the table says in the rows' place when the file's rule leaves it none of the file's rows to list. */
  none: string | undefined;
  /** What the table says in the rows' place when the file has no rows, for a file whose rule has a sentence for that. */
  empty: string | undefined;
  /** The column whose cell opens a row and names it, for a table in which the rule has that be another than the first. */
  opensFrom: number | undefined;
  /** The text that was read for each cell the table says in words, by the table's row and the column's place: a row's drawer shows both. */
  exported: FileView["exported"];
  /** For a column the rule made out of a column of the file: that column's name, under which the drawer names the text that was read. */
  readUnder: FileView["readUnder"];
  /** How the cells of each column that can list several items list them, by the column's place (cell-lists.ts): a row's
   * drawer lists such a cell's items one to a line. The table shows the cell as it is. */
  lists: ReadonlyMap<number, CellList>;
  columns: Column[];
  /** Each column's width, worked out from every row of `table` the first time the table is drawn (column-widths.ts),
   * once its columns are what they stay, and kept: the table is laid out by it whatever is shown of it. Not before: a
   * model's Line Items can have many thousands of rows, and many a table is never looked at. */
  widths?: ReadonlyMap<number, number>;
  keys: RowKeys;
  links: Links;
  /** Column -> the texts ticked in its filter; a column with every text ticked has no entry. */
  filters: Map<number, Set<string>>;
  hidden: Set<number>;
  sort: Sort | undefined;
  page: number;
  /** For a file the page shows in two ways, an app's Where Used: both of them, each with what the user chose for it. The
   * one that is shown is the file's entry among `shown`. */
  ways?: { object: Shown; use: Shown };
  /** For the way that lists the file by object (where-used-view.ts): the view, whose rows are this table's. */
  objects?: WhereUsedView;
  /** For a table whose rows name their card by its number alone, an app's Where Used as every use: the card's ID, for
   * each row whose card the result has. The card's number is a link in those rows. */
  cardIds?: ReadonlyMap<Row, string>;
}
/** What the page shows of the result: its overview, a model's map, or one of its files, named by its place in the result. */
type View = "overview" | "map" | number;

let result: AnalysisResult | undefined;
/** When the result was complete. A result that was brought back after a refresh of the page comes with the time it had:
 * the line above it says when it was analysed by this time. */
let received = new Date();
/** Whether the result on the page was brought back after a refresh (keep-result.ts), and not analysed since the page loaded. */
let broughtBack = false;
/** What the tab keeps of the result on the page for a refresh: a copy, once the result is kept and when it was brought
 * back; a copy no longer, once the user has had it forgotten; a copy that could not be removed, when the user asked for
 * that and the tab's storage did not let it go; none yet, while the result is still being kept; and none, when it could
 * not be kept. The overview says which, and offers to forget a copy that is kept or could not be removed. While the
 * result is being kept it holds the room for what it says of a kept copy, so that nothing moves when it says it. */
let keptCopy: KeptCopy = "none";
/** True while the page looks for a result it kept before a refresh. Until it knows, it draws no waiting view, which a
 * result that comes back would replace at once. */
let takingBack = false;
let details: ResultTable | undefined;
let cards: CardsTable | undefined;
let shown = new Map<number, Shown>();
const state = {
  view: "overview" as View,
  search: "",
  pageSize: 50,
  /** The page a jump to the Cards table keeps. */
  context: undefined as string | undefined,
  lastFocus: null as Element | null,
};
/** The rows on the page now, and the row the drawer shows: what a click on a link or a row refers to. */
let currentSlice: readonly Row[] = [];
let drawerRow: { entry: Shown; row: Row } | undefined;
/** The object the drawer shows, for a row of Where Used by object: what a click on one of its uses refers to, and whether
 * all of its uses are listed. */
let drawerObject: { view: WhereUsedView; object: WhereUsedObject; all: boolean } | undefined;
/** Which way an app's Where Used table is shown: by object unless Every use was chosen. The choice lasts while the page
 * is open, through other tables and through a new result. */
let everyUse = false;
let select = rememberingSelect();
/** A model's map (src/map), for the result on the page. Its graph is built and it is mounted the first time its entry is
 * chosen, not before: that takes a moment for a large model, and many a result is never looked at as a map. From then on
 * the page shows and hides it as the navigation goes, and it keeps what was done in it. "failed" once it could not be
 * drawn for this result, or was drawn and then stopped by itself: the view says so, and the page does not try again
 * until the map is dropped (`dropMap`). */
let modelMap: ModelMap | "failed" | undefined;
/** The graph of the model on the page: built once, for its map and for the button in a row's details that goes there. */
let modelGraph: ModelGraph | undefined;
/** True while a run is going, so that a run that starts is told from one that goes on. */
let running = false;

const defaultHidden = (columns: readonly Column[]): Set<number> => new Set(columns.filter(column => column.hidden).map(column => column.index));
const currentEntry = (): Shown | undefined => (typeof state.view === "number" ? shown.get(state.view) : undefined);

/* ================= header / theme ================= */
function currentTheme(): "dark" | "light" {
  let stored: string | null = null;
  try { stored = localStorage.getItem("cardigan-theme"); } catch { /* no storage: follow the system */ }
  if (stored === "dark" || stored === "light") return stored;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
function applyTheme(theme: "dark" | "light"): void {
  document.documentElement.dataset.theme = theme;
  el("themeToggle").innerHTML = theme === "dark" ? SUN_ICON : MOON_ICON;
  el("themeToggle").title = theme === "dark" ? "Switch to light theme" : "Switch to dark theme";
  // A mounted map draws with the page's colours: it reads them again, whether it is shown now or not.
  tellMap("themeChanged");
}
function toggleTheme(): void {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  try { localStorage.setItem("cardigan-theme", next); } catch { /* not remembered */ }
  applyTheme(next);
}
/** A text node, as Node.TEXT_NODE names it. */
const TEXT_NODE = 3;
/** Whether an analysis has been made for this page: one was asked for on it, or it shows a result, which a page that was
 * refreshed brings back without asking. The run control then says "again". */
const ranBefore = (): boolean => client.asked || result !== undefined;
/** The run control's words, after its icon: "Run" until an analysis has been made for this page, "Run again" after. */
function showRunLabel(): void {
  const button = el("runAgain");
  const label = runLabel(ranBefore());
  const words = [...button.childNodes].reverse().find(node => node.nodeType === TEXT_NODE && node.textContent?.trim());
  if (!words) button.append(label);
  else if (words.textContent !== label) words.textContent = label;
  button.title = ranBefore() ? "Analyse the Anaplan tab again" : "Analyse the Anaplan tab";
}
/** The run control follows what there is to act on. */
function updateActions(): void {
  const phase = client.state.phase;
  el<HTMLButtonElement>("runAgain").disabled = phase === "running" || phase === "no-tab";
  showRunLabel();
}

/* ================= views ================= */
/** The navigation's entries. A file's entry carries the file's name as the result has it, by which the navigation draws
 * its icon (markup.ts `FILE_ICONS`) and a model's places it in its group (markup.ts `NAV_GROUPS`): the name the analysis
 * gave the file, which the user never reads or types. */
function navEntries(): NavEntry[] {
  return [
    { id: "overview", label: "Overview" },
    ...[...shown.values()].map(entry => ({ id: String(entry.index), label: cellText(entry.table.label), file: entry.table.file })),
    // A model's map, after its files. An app has none.
    ...(result?.kind === "model" ? [{ id: "map", label: MAP_LABEL }] : []),
  ];
}

function query(entry: Shown): TableQuery {
  const column = entry.keys.page;
  return {
    search: state.search, filters: entry.filters, sort: entry.sort,
    context: state.context !== undefined && column !== undefined ? { column, value: state.context } : undefined,
    // The search finds a count as the table shows it too, with its commas: in every column of counts, shown or hidden.
    counts: new Set(entry.columns.filter(shown => shown.kind === "count").map(shown => shown.index)),
  };
}

/** What a table shows now: the page of rows the search, the filters, the sort and the jump leave, and what the user chose. */
function tableView(entry: Shown): TableView {
  const page = pageOf(select(entry.table.rows, query(entry)), entry.page, state.pageSize);
  entry.page = page.page;
  currentSlice = page.rows;
  // The columns' widths come from all the table's rows, whatever the search, the filters, the sort and the page leave.
  entry.widths ??= columnWidths(entry.columns, entry.table.rows);
  return {
    label: cellText(entry.table.label), note: entry.note, none: entry.none, empty: entry.empty, opensFrom: entry.opensFrom,
    ways: entry.ways && [{ way: "object", label: "By object", chosen: entry === entry.ways.object }, { way: "use", label: EVERY_USE, chosen: entry === entry.ways.use }],
    columns: entry.columns.filter(column => !entry.hidden.has(column.index)), widths: entry.widths, rows: page.rows,
    page: page.page, pages: page.pages, pageSize: state.pageSize, from: page.from, to: page.to, total: page.total, all: entry.table.rows.length,
    search: state.search, sort: entry.sort, filtered: new Set(entry.filters.keys()), context: state.context, links: entry.links,
    ...(opensModules(entry) ? { rowTitle: OPEN_IN_ANAPLAN } : {}),
  };
}
/** The shade at the foot of the table's box goes once there is nothing more to scroll to. */
function updateFade(wrap: HTMLElement): void {
  wrap.classList.toggle("at-end", wrap.scrollTop + wrap.clientHeight >= wrap.scrollHeight - 6);
  wrap.classList.toggle("no-scroll", wrap.scrollHeight <= wrap.clientHeight + 2);
}
const announceTable = (view: TableView): void =>
  announce(`${view.label}: ${view.total === 1 ? "1 row" : `${view.total} rows`}${view.context !== undefined ? `, filtered to ${view.context}` : ""}`);

/** Draws a table's view whole: its name, its toolbar with the search box, its rows and its pager. */
function renderTable(entry: Shown): void {
  const view = tableView(entry);
  el("view").innerHTML = tableHtml(view);
  const wrap = find("#tableWrap");
  if (wrap) {
    wrap.addEventListener("scroll", () => updateFade(wrap));
    updateFade(wrap);
  }
  const search = find<HTMLInputElement>("#tblSearch");
  if (search) search.selectionStart = search.selectionEnd = search.value.length;
  markPopOwner();
  announceTable(view);
}

/** Draws again what follows the search, the filters, the sort and the page: the rows, the pager, the count, and whether
 * Reset is offered. The rest of the view stays as it is, the search box above all: writing the box again while the user
 * types into it would move the caret and break a letter that is still being put together (a dead key, an input method).
 * The table's box stays too, with how far it was scrolled sideways: after a sort, a page, a search or a filter the table
 * written into it has the columns it had, each as wide as before (column-widths.ts), so the browser keeps the box where
 * it was. It is taken back to its top, where the new rows begin: another order, page, search or filter shows other rows,
 * and the head stays at the top of the box. */
function updateTable(entry: Shown): void {
  const wrap = find("#tableWrap");
  const pager = find("#pager");
  const count = find("#rowCount");
  if (!wrap || !pager || !count) return renderTable(entry);
  const view = tableView(entry);
  const parts = tableParts(view);
  wrap.innerHTML = parts.grid;
  wrap.scrollTop = 0;
  pager.innerHTML = parts.pager;
  count.textContent = parts.count;
  const reset = find("#resetBtn");
  if (reset) reset.hidden = !parts.modified;
  find("#searchWrap")?.classList.toggle("has-value", view.search !== "");
  updateFade(wrap);
  markPopOwner();
  announceTable(view);
}

function renderAll(): void {
  if (!result) return;
  const entry = currentEntry();
  // The map is a model's. Any other view that is no file of the result is the overview.
  const onMap = state.view === "map" && result.kind === "model";
  if (!entry && !onMap) state.view = "overview";
  // The navigation, in its two forms: its line, with a model's tables in groups, and the one menu that stands in the line's
  // place in a window too narrow for it, which names the view shown. The stylesheet shows the one the window has room
  // for. Each is drawn with its menus closed.
  const items = navItems(navEntries(), result.kind === "model");
  el("navList").innerHTML = navHtml(items, String(state.view));
  el("navCompact").innerHTML = navMenuHtml(items, String(state.view), entry ? cellText(entry.table.label) : onMap ? MAP_LABEL : "Overview");
  // The map gives its room back before another view is drawn, which measures the room it has.
  if (!onMap) leaveMap();
  if (entry) renderTable(entry);
  else if (onMap) enterMap(result);
  // Each tile opens its table: the tiles are in the navigation's order, which `listedTables` gives.
  else el("view").innerHTML = overviewHtml(overviewOf(result), keptCopy, listedTables(result).map(({ index }) => index));
  // The line above a result that was brought back says "today" by the clock: each view says it anew, so that it is still
  // true on a page left open past midnight.
  const line = broughtBack ? find("#noteText") : null;
  if (line) line.textContent = analysedLine(received, new Date());
  updateActions();
  markView();
}

/** A note of the page's own in the banner area above the result: when a result that was brought back was analysed, or
 * that a result will not be there after a refresh. `withLog` offers the button that copies the run's log, which then holds
 * the reason. The line is set as plain text. */
function showNote(line: string, withLog: boolean): void {
  el("banners").innerHTML = noteBannerHtml();
  const text = find("#noteText");
  if (text) text.textContent = line;
  const copy = find("#noteCopy");
  if (copy) copy.hidden = !withLog;
}

/** What the tab keeps of the result on the page has changed: the overview says it, in the place it has for that. Only
 * that place is written again, so the rest of the overview stays as it is: a section that was opened stays open, and the
 * focus stays where it is. Another view has no such place, and the overview says it when it is drawn. */
function setKeptCopy(next: KeptCopy): void {
  keptCopy = next;
  const place = find("#ovKept");
  if (place) place.innerHTML = keptCopyHtml(next);
}

/** The kept copy could not be removed (keep-result.ts `forget`): the overview says so in the line beside the control, and
 * the page says the same through its live region, which tells a screen reader once. The control stays as it is, with the
 * focus it has, for another try: the line alone is written again, and it is no longer the control's description, or a
 * screen reader might be told twice. The place then holds what `keptCopyHtml` writes for a copy that was not removed,
 * which is what the overview shows when it is drawn again. */
function showNotRemoved(): void {
  keptCopy = "not-removed";
  const line = find("#keptLine");
  if (line) line.textContent = NOT_REMOVED_LINE;
  find('#ovKept [data-act="forget"]')?.removeAttribute("aria-describedby");
  announce(NOT_REMOVED_LINE);
}

/** A result arrived, complete: the page becomes the design's results page for it. Only now does it take the place of an
 * earlier result, of which nothing is kept: not the rows on the page, the drawer's row, the last selection, its map, or the
 * banner of the run that has just ended. `back` is for a result the page kept before it was refreshed and has now brought back:
 * it is shown like any other, under a line that says when it was analysed. */
function showResult(next: AnalysisResult, at: Date, back = false): void {
  // Focus that is inside what the new result replaces moves to the new view; anywhere else, in the header, it stays.
  const replaced = [el("view"), el("mapHost"), el("drawer"), el("popover")].some(part => part.contains(document.activeElement));
  closePopover();
  closeDrawer();
  // The earlier result's map goes with it: the new result's is built when its entry is chosen.
  dropMap();
  currentSlice = [];
  drawerRow = undefined;
  drawerObject = undefined;
  select = rememberingSelect();
  el("banners").innerHTML = "";
  result = next;
  received = at;
  broughtBack = back;
  // A result that was brought back is kept: the tab's storage still holds what it came from. A run's result is not kept
  // yet: that follows once it is drawn (`keepLater`), and until it has succeeded there is no copy to forget. The overview
  // is drawn with the room for what it says of a kept copy, and `keepLater` fills that room or gives it up.
  keptCopy = back ? "kept" : "keeping";
  details = detailsOf(next);
  cards = cardsOf(next);
  shown = new Map();
  // An app's Where Used file by object (where-used-view.ts), when the result has what that takes: the file's first table.
  const byObject = whereUsedView(next);
  const whereUsed = byObject && next.tables.find(table => table.file === WHERE_USED_FILE);
  for (const { index, table: file } of listedTables(next)) {
    // What the page counts, filters and searches is the table as it shows it: the columns' filters follow its rows too.
    const { table, note, none, empty, opensFrom, exported, readUnder } = fileView(next, file);
    const columns = columnsOf(table);
    const keys = rowKeys(table);
    const page = cards !== undefined && keys.page !== undefined;
    const entry: Shown = {
      index, table, note, none, empty, opensFrom, exported, readUnder, lists: cellLists(next, table), columns, keys, links: { page, card: page && keys.cardId !== undefined },
      filters: new Map(), hidden: defaultHidden(columns), sort: undefined, page: 0,
    };
    // A number that could be more than one card's opens none of them: there it is plain text.
    if (entry.links.card) entry.links.hasCard = row => cardsOfRow(entry, row).length < 2;
    shown.set(index, entry);
    if (!byObject || file !== whereUsed) continue;
    // The file in two ways. By object, the table is the view's: one row an object, in the view's own order and with its
    // columns. Its cells link to nothing: a row opens the object, which lists its uses. Such a row opens the object's own
    // drawer, which lists the object's roles and uses a row each: no cell of the view is cut into items.
    const object: Shown = {
      index, table: { ...file, headers: byObject.headers, rows: byObject.rows }, note: byObject.note, none: undefined, empty: undefined, opensFrom: undefined,
      exported: undefined, readUnder: undefined, lists: new Map(), columns: byObject.columns,
      keys: { page: undefined, cardId: undefined, number: undefined }, links: { page: false, card: false },
      filters: new Map(), hidden: defaultHidden(byObject.columns), sort: undefined, page: 0, objects: byObject,
    };
    entry.ways = object.ways = { object, use: entry };
    // As every use, a row names its card by its number, and the file has no column of card IDs. The view knows each use's
    // card where the result has it: there the number opens the card, as it does from the object's drawer.
    const cardIds = new Map<Row, string>();
    for (const use of byObject.objects.flatMap(each => each.uses)) if (use.cardId !== undefined) cardIds.set(file.rows[use.row], use.cardId);
    entry.cardIds = cardIds;
    entry.columns = entry.columns.map(column => (column.label === "Card #" ? { ...column, kind: "card" } : column));
    entry.links = { ...entry.links, card: entry.links.page, hasCard: row => cardIds.has(row) };
    shown.set(index, everyUse ? entry : object);
  }
  state.view = "overview";
  state.search = "";
  state.context = undefined;
  const analysed = analysedOf(next);
  document.title = `Cardigan - ${analysed.name}`;
  el("hdMeta").innerHTML = headerMetaHtml(analysed);
  el("topnav").hidden = false;
  renderAll();
  if (replaced) el("view").focus({ preventScroll: true });
  if (!back) return announce(`Analysis finished: ${analysed.name}`);
  // Nothing was analysed just now: the page says what it shows, and from when.
  const line = analysedLine(at, new Date());
  showNote(line, false);
  announce(`${analysed.name}. ${line}`);
}

/** The page's title while it has no result: the shell's own. */
const TITLE = document.title;

/** Takes the page back to having no result, after `showResult` began to put one on it and could not: what it set, and
 * what it drew. Whatever made that fail may be in the way here too, so a part of the page that is not there is passed over. */
function clearResult(): void {
  dropMap();
  result = undefined;
  details = undefined;
  cards = undefined;
  shown = new Map();
  broughtBack = false;
  keptCopy = "none";
  currentSlice = [];
  drawerRow = undefined;
  drawerObject = undefined;
  state.view = "overview";
  state.search = "";
  state.context = undefined;
  document.title = TITLE;
  for (const id of ["hdMeta", "banners", "navList", "navCompact", "view"] as const satisfies readonly PageId[]) {
    const part = document.getElementById(id);
    if (part) part.innerHTML = "";
  }
}

/** Shows a result the page kept before it was refreshed (keep-result.ts). What comes back is read as a result once more,
 * field by field, as one from another window is (result-plain.ts): the keeper asks of it only what the page asks of the
 * pieces the tab sends, and what was kept may be another build's, or not a result's shape at all. False when it is no
 * result, or when showing it fails: the page is then without a result, as it was, and what was kept is to be forgotten,
 * or every refresh would find it again. */
function showKept(kept: unknown, at: Date): boolean {
  const back = plainResult(kept);
  if (!back) return false;
  try {
    showResult(back, at, true);
    return true;
  } catch {
    clearResult();
    return false;
  }
}

/** The states in which a run did not start or did not finish. */
const STOPPED: ReadonlySet<RunState["phase"]> = new Set(["unreachable", "not-anaplan", "tab-closed", "no-subject", "failed", "interrupted"]);

/** Connecting, running, or why there is no new result. Before the first result this is the whole view. Once a result is on
 * the page it stays there until a new one is complete, and the same words stand in the banner area above it: a run that
 * cannot start or does not finish takes nothing away. Every text is set as plain text. */
function showRun(runState: RunState): void {
  // A result that was brought back stands under its own line until an analysis is asked for on this page: that the tab was
  // reached, or was not, says nothing about it. And a page that may still bring one back draws no waiting view yet.
  if (result ? broughtBack && !client.asked : takingBack) return updateActions();
  const text = describeState(runState, ranBefore());
  const set = (selector: string, value: string) => {
    const node = find(selector);
    if (node) {
      node.textContent = value;
      node.hidden = value === "";
    }
  };
  if (result) {
    if (!find("#runBanner")) el("banners").innerHTML = runBannerHtml();
    const banner = find("#runBanner");
    banner?.classList.toggle("warn", STOPPED.has(runState.phase));
    banner?.classList.toggle("note", !STOPPED.has(runState.phase));
    set("#bannerTitle", text.title);
    set("#bannerText", text.message);
    set("#bannerHint", text.hint);
  } else {
    if (!find("#runStatus")) {
      // The page before its first result: there is nothing to navigate yet.
      el("topnav").hidden = true;
      el("view").innerHTML = runHtml();
    }
    set("#runTitle", text.title);
    set("#runStatus", text.message);
    set("#runHint", text.hint);
  }
  showLog(client.log);
  updateActions();
  announce(text.message);
}

/** The run's diagnostic log. Before the first result its latest lines are under the message, kept in view. Beside an
 * earlier result there is only the banner's button to copy it, which is there once the log has a line. */
function showLog(lines: readonly string[]): void {
  const copy = find("#bannerCopy");
  if (copy) copy.hidden = lines.length === 0;
  const block = find("#runLog");
  const log = find("#diagLog");
  if (result || !block || !log) return;
  block.hidden = lines.length === 0;
  log.textContent = lines.slice(-200).join("\n");
  log.scrollTop = log.scrollHeight;
}

/* ================= popovers (column filter / column chooser) ================= */
/** The control that opened the popover, as a selector: a filter's button is written again with the table's head while its
 * popover is open, so the element itself does not last. */
let popOwner: string | undefined;
/** Says on each button that opens a popover whether its popover is open now. The table's head is written with every one
 * closed, so this follows each draw of the table as well as each opening and closing. */
function markPopOwner(): void {
  for (const button of document.querySelectorAll("[data-colfilter], #colBtn")) button.setAttribute("aria-expanded", String(popOwner !== undefined && button.matches(popOwner)));
}
/** Closes the popover. `back` gives the focus back to the control that opened it: after Escape and after the popover's own
 * buttons, which would otherwise leave the focus on nothing. A click elsewhere takes the focus where it was made. The
 * control is where it was when it opened the popover, which stands over the page and moves nothing: a column's filter
 * button is written again with the table's head while the popover is open, in the same place, so the focus goes back to
 * it without moving the table's box (`focusInPlace`). */
function closePopover(back = false): void {
  const popover = el("popover");
  if (!popover.hidden) {
    popover.hidden = true;
    popover.innerHTML = "";
  }
  const owner = popOwner;
  popOwner = undefined;
  markPopOwner();
  if (back && owner) focusInPlace(owner);
}
/** Opens the popover under `anchor`, the button `owner` names. `name` is what the popover is, for a screen reader. */
function openPopover(owner: string, anchor: Element, name: string, html: string): void {
  const popover = el("popover");
  popover.innerHTML = html;
  popover.setAttribute("aria-label", name);
  popover.hidden = false;
  popOwner = owner;
  markPopOwner();
  const rect = anchor.getBoundingClientRect();
  const width = 260;
  let top = rect.bottom + 6;
  popover.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - width - 12))}px`;
  popover.style.top = "0px";
  popover.style.visibility = "hidden";
  requestAnimationFrame(() => {
    const height = Math.min(popover.offsetHeight, 340);
    if (top + height > window.innerHeight - 10) top = Math.max(10, rect.top - height - 6);
    popover.style.top = `${top}px`;
    popover.style.visibility = "visible";
    popover.querySelector<HTMLElement>("input,button")?.focus();
  });
}
function openColFilter(entry: Shown, column: Column, owner: string, anchor: Element): void {
  const values = valueCounts(entry.table.rows, column.index);
  openPopover(owner, anchor, `Filter: ${column.label}`, colFilterHtml(column, values, entry.filters.get(column.index)));
  const popover = el("popover");
  popover.querySelectorAll<HTMLInputElement>("input[data-fval]").forEach(input => {
    input.addEventListener("change", () => {
      const value = values[Number(input.dataset.fval)]?.[0];
      if (value === undefined) return;
      let selected = entry.filters.get(column.index);
      if (!selected) {
        selected = new Set(values.map(([text]) => text));
        entry.filters.set(column.index, selected);
      }
      if (input.checked) selected.add(value); else selected.delete(value);
      if (selected.size === values.length) entry.filters.delete(column.index);
      entry.page = 0;
      updateTable(entry);
    });
  });
  popover.querySelector('[data-popact="all"]')?.addEventListener("click", () => {
    entry.filters.delete(column.index);
    entry.page = 0;
    updateTable(entry);
    closePopover(true);
  });
}
function openColChooser(entry: Shown, anchor: Element): void {
  openPopover("#colBtn", anchor, "Show or hide columns", colChooserHtml(entry.columns, entry.hidden));
  const popover = el("popover");
  popover.querySelectorAll<HTMLInputElement>("input[data-col]").forEach(input => {
    input.addEventListener("change", () => {
      const column = Number(input.dataset.col);
      if (input.checked) entry.hidden.delete(column); else entry.hidden.add(column);
      updateTable(entry);
    });
  });
  popover.querySelector('[data-popact="defaults"]')?.addEventListener("click", () => {
    entry.hidden = defaultHidden(entry.columns);
    updateTable(entry);
    closePopover(true);
  });
}

/* ================= drawer ================= */
/** Hides the drawer once it has slid out. Opening it again first calls this off, so a drawer is never hidden while open. */
let drawerTimer: ReturnType<typeof setTimeout> | undefined;
/** What lies behind the open drawer: the link that skips to the results, the header, the navigation, the banner area and
 * the shell. The drawer says it is modal, so while it is open these are inert: the Tab key stays in the drawer, and a
 * screen reader does not read on into the page behind it. */
function setBehindDrawer(inert: boolean): void {
  for (const part of [find(".skip"), find(".hd"), el("topnav"), el("banners"), find(".shell")]) if (part) part.inert = inert;
}
/** Shows the drawer. The title is a text and is set as one; the line under it and the body are markup.ts' markup. What
 * the focus goes back to afterwards is what opened the drawer from the page: a link inside the drawer that opens another
 * card does not last, so it leaves that as it is. */
function openDrawer(title: string, subHtml: string, bodyHtml: string, opener?: Element | null): void {
  clearTimeout(drawerTimer);
  const from = opener ?? document.activeElement;
  if (!el("drawer").contains(from)) state.lastFocus = from;
  el("drawerTitle").textContent = title;
  el("drawerSub").innerHTML = subHtml;
  el("drawerBody").innerHTML = bodyHtml;
  // A row of a model's Line Items or Modules that has its box on the map: the button at the top takes the user there.
  el("drawerMap").hidden = !drawerRow || mapNodeOf(drawerRow.entry, drawerRow.row) === undefined;
  const drawer = el("drawer");
  const scrim = el("scrim");
  drawer.hidden = false;
  scrim.hidden = false;
  setBehindDrawer(true);
  requestAnimationFrame(() => {
    drawer.classList.add("show");
    scrim.classList.add("show");
  });
  el("drawerClose").focus();
  el("drawerBody").scrollTop = 0;
}
function closeDrawer(): void {
  const drawer = el("drawer");
  const scrim = el("scrim");
  drawer.classList.remove("show");
  scrim.classList.remove("show");
  clearTimeout(drawerTimer);
  drawerTimer = setTimeout(() => {
    drawer.hidden = true;
    scrim.hidden = true;
  }, 210);
  // The page behind takes part again before the focus goes back into it.
  setBehindDrawer(false);
  if (state.lastFocus instanceof HTMLElement && document.contains(state.lastFocus)) state.lastFocus.focus();
  state.lastFocus = null;
}
/** Any row, in full. Its heading is the row's own name: the cell of the column that names the file's rows (the one its
 * rows open from, where the file's rule names one, and else columns.ts `ROW_NAME_COLUMNS`), or, where the page knows no
 * such column or the cell says nothing, the first cell that does. A cell says nothing when it is empty, and in one of the
 * app's files when it is the dash the analysis writes for nothing to say (columns.ts `writesNone`): in a model's file
 * that dash is Anaplan's text, which names a row like any other. The line under the heading says which row of which
 * table it is, by its place among the rows the table lists, which a search, a filter or a sort does not change. */
function openRowDrawer(entry: Shown, row: Row, opener: Element): void {
  const object = entry.objects && objectOf(entry.objects, row);
  if (entry.objects && object) return openObjectDrawer(entry.objects, object, opener);
  drawerObject = undefined;
  drawerRow = { entry, row };
  const position = entry.table.rows.findIndex(candidate => candidate === row) + 1;
  const named = entry.opensFrom ?? rowNameIndex(entry.table);
  const none = writesNone(entry.table);
  const name = (named === undefined ? "" : rowName([row[named] ?? ""], none)) || rowName(row, none) || `Row ${position}`;
  openDrawer(name, rowDrawerSubHtml(position, cellText(entry.table.label)), rowDrawerHtml(entry.columns, row, entry.links, entry.exported?.get(row), rowItems(entry.lists, row), entry.readUnder), opener);
}
/** What an object's uses may link to: a page's cards and a card's details, where the result has the cards to show. */
const useLinks = (): Links => ({ page: cards !== undefined, card: cards !== undefined });
/** An object of Where Used by object: headed by its name, with what it is and where it is used under it, then its roles
 * and its uses. A page among its uses jumps to that page's cards, and a card's number opens the card. The object comes
 * from the app's Where Used file, so the dash the analysis writes for nothing to say is no name for it. */
function openObjectDrawer(view: WhereUsedView, object: WhereUsedObject, opener: Element): void {
  drawerRow = undefined;
  drawerObject = { view, object, all: false };
  openDrawer(rowName([object.name], true) || rowName([object.type], true) || "Object", objectDrawerSubHtml(object, view.multiModel), objectDrawerHtml(object, useLinks(), false), opener);
}
/** The cards a row names, as rows of the Cards file. A row of that file is its own card. A row of another file names its
 * card by its page's name and the card's ID (its own, or in a table without that column the one the row is known to
 * name), and by the card's number where the two are those of several cards (columns.ts `cardsNamed`). None: the export
 * has no such card. More than one: the files do not say which of them the row is on. */
function cardsOfRow(entry: Shown, row: Row): readonly Row[] {
  if (!cards || entry.keys.page === undefined) return [];
  if (entry.index === cards.index) return [row];
  const cardId = entry.keys.cardId !== undefined ? cellText(row[entry.keys.cardId]) : entry.cardIds?.get(row);
  if (cardId === undefined) return [];
  return cardsNamed(cards, cellText(row[entry.keys.page]), cardId, entry.keys.number === undefined ? undefined : cellText(row[entry.keys.number]));
}
/** Opens the card that a row or a use names, where that is one card. It never opens one of several: which of them is
 * meant is not known, and the first is not more likely than the next. */
function openCard(found: readonly Row[], opener: Element): void {
  if (found.length === 1) openCardDrawer(found[0], opener);
  else toast("Card not found in this export");
}
/** A card, by its row of the Cards file: that row, and the card's parts from the other files (result-view.ts
 * `cardParts`). Under the card's page, a line says so where its parts cannot be told from another card's. */
function openCardDrawer(row: Row, opener: Element): void {
  const found = cards;
  const entry = found && shown.get(found.index);
  if (!result || !found || !entry) return;
  const cell = (header: string): string => {
    const index = columnIndex(entry.table, header);
    return index === undefined ? "" : cellText(row[index]);
  };
  const title = cell("Card title");
  const { sections, note } = cardParts(result, found, row);
  drawerObject = undefined;
  drawerRow = { entry, row };
  openDrawer(`Card ${cell("Card #")}${title !== "" && title !== NONE ? ` - ${title}` : ""}`,
    cardDrawerSubHtml(cellText(row[found.page]), cell("Card type"), cellText(row[found.cardId]), note), cardDrawerHtml(entry.columns, row, entry.links, sections, rowItems(entry.lists, row)), opener);
}
/** The row a click belongs to: the drawer's row inside the drawer, otherwise the table row clicked. */
function rowFor(element: Element): { entry: Shown; row: Row } | undefined {
  if (el("drawer").contains(element)) return drawerRow;
  const tr = element.closest("#tableWrap tbody tr");
  const entry = currentEntry();
  if (!tr?.parentElement || !entry) return undefined;
  const row = currentSlice[Array.prototype.indexOf.call(tr.parentElement.children, tr)];
  return row ? { entry, row } : undefined;
}

/* ================= a module in Anaplan ================= */
/** What a row of a model's Line Items or Modules says it does on a double-click. */
const OPEN_IN_ANAPLAN = "Double-click to open its module in Anaplan";
/** As long as a double-click may take after the click that opened its row's details. */
const DOUBLE_CLICK_MS = 600;
const NO_MODULE_IDS = "This result has no IDs for the model's modules: an earlier version of Cardigan read it. Choose Run again, then double-click the row again.";
const NO_MODULE_ID = "Cardigan cannot open this row in Anaplan: the model gave no ID for its module.";
const NOT_IN_MODEL_BUILDING = "To open a module from here, open the model in Model Building, then click the Cardigan icon on that tab.";
const NO_WORKSPACE = "This result does not say which workspace the model is in. Choose Run again, then double-click the row again.";
const TAB_GONE = "The Anaplan tab is closed. Open the model in Model Building, then click the Cardigan icon there.";
const LONG_ID = /^[0-9A-Fa-f]{32}$/;

/** The row a click last opened, and when: what a double-click opens the module of (the listener for "dblclick"). */
let clickedRow: { entry: Shown; row: Row; at: number } | undefined;

/** Whether a table's rows open their module in Anaplan: a model's Line Items and Modules. */
const opensModules = (entry: Shown): boolean => result?.kind === "model" && (entry.table.file === LINE_ITEMS_FILE || entry.table.file === MODULES_FILE);

/** The module a row of a model's Line Items or Modules names: a line item's own module, or the module itself. None for any
 * other row, and for a row that names none. */
function moduleOfRow(entry: Shown, row: Row): string | undefined {
  if (!opensModules(entry)) return undefined;
  const at = entry.table.file === LINE_ITEMS_FILE ? columnIndex(entry.table, MODULE_NAME) : 0;
  const name = at === undefined ? "" : cellText(row[at]).trim();
  return name === "" ? undefined : name;
}

/** The address that opens a module of the model on the page in Model Building, on the Anaplan tab's own site, as Model
 * Building's own links write it (its `/tabs/` and the module's ID); or what is missing for it, in words for the user. The
 * site and the customer are what the tab said of itself; the workspace is the result's, and so is the model. */
function moduleLink(name: string): { url: string } | { problem: string } {
  if (result?.kind !== "model") return { problem: NO_MODULE_ID };
  if (!Array.isArray(result.moduleIds)) return { problem: NO_MODULE_IDS };
  const id = result.moduleIds.find(pair => Array.isArray(pair) && typeof pair[0] === "string" && pair[0].trim() === name)?.[1];
  if (typeof id !== "string" || !/^\d{1,19}$/.test(id)) return { problem: NO_MODULE_ID };
  const shown = client.shows;
  const origin = shown?.kind === "model" ? shown.origin : undefined;
  const customer = shown?.kind === "model" ? shown.customer : undefined;
  if (typeof origin !== "string" || !CONTENT_SCRIPT_ORIGIN.test(origin) || typeof customer !== "string" || !LONG_ID.test(customer)) return { problem: NOT_IN_MODEL_BUILDING };
  const workspace = detailValue(detailsOf(result), "Model", "Workspace ID");
  if (!workspace || !LONG_ID.test(workspace) || !/^[0-9A-Za-z]{32}$/.test(result.id)) return { problem: NO_WORKSPACE };
  return { url: `${origin}/a/modeling/customers/${customer}/workspaces/${workspace}/models/${result.id}/tabs/${id}` };
}

/** Opens a row's module in Model Building, in the Anaplan tab this page reads, and brings that tab and its window to the
 * front: the tab loads Model Building on the module. Model Building opens modules, not line items: a line item opens its
 * module. Where something needed is missing, the page says what to do. */
async function openInAnaplan(entry: Shown, row: Row): Promise<void> {
  const name = moduleOfRow(entry, row);
  if (name === undefined) return;
  const link = moduleLink(name);
  if ("problem" in link) return toast(link.problem);
  if (tabId === undefined) return toast(TAB_GONE);
  let tab: chrome.tabs.Tab | undefined;
  try {
    tab = await chrome.tabs.update(tabId, { url: link.url, active: true });
  } catch {
    return toast(TAB_GONE);
  }
  // The tab is shown; a window that cannot be brought forward leaves it where it is.
  if (tab?.windowId !== undefined) await chrome.windows.update(tab.windowId, { focused: true }).catch(() => undefined);
}

/* ================= model map ================= */
/** The model's graph, built the first time the map or a row's details asks for it. It throws what keeps it from being made. */
function graphFor(model: AnalysisResult): ModelGraph {
  modelGraph ??= buildModelGraph(model.tables);
  return modelGraph;
}

/** The map's box for a row of a model's Line Items or Modules: the line item in its module, or the module, by their names.
 * None for any other row, for a row the map does not draw (a heading, a line item that names no module), and where the
 * map cannot be drawn. */
function mapNodeOf(entry: Shown, row: Row): number | undefined {
  const file = entry.table.file;
  if (result?.kind !== "model" || modelMap === "failed" || (file !== LINE_ITEMS_FILE && file !== MODULES_FILE)) return undefined;
  let graph: ModelGraph;
  try {
    graph = graphFor(result);
  } catch {
    return undefined;
  }
  const name = cellText(row[0]).trim();
  if (file === MODULES_FILE) return graph.nodes.find(node => node.kind === "module" && node.name.trim() === name)?.id;
  const at = columnIndex(entry.table, MODULE_NAME);
  const module = at === undefined ? "" : cellText(row[at]).trim();
  return graph.nodes.find(node => node.kind === "lineItem" && node.name.trim() === name && node.module !== undefined
    && graph.nodes[node.module]?.name.trim() === module)?.id;
}

/** A line for the run's log about a call into the map that threw: which call, and the error's own words. */
const mapFailure = (call: string, error: unknown): string => `Model map: ${call} failed (${error instanceof Error ? `${error.name}: ${error.message}` : textOf(error)}).`;

/** A line for the run's log about a map that was drawn and stopped by itself later: the reason the map gives, kept to
 * the one line. A map that gives none has the line without it. */
const mapStopped = (reason: unknown): string => {
  const why = textOf(reason).replace(/\s+/g, " ").trim();
  return `Model map: stopped after it was drawn${why === "" ? "" : ` (${why})`}.`;
};

/** What the page tells the map about the model: its name, which is the result's, and its workspace's, which the Details
 * file has under Model (model/export.ts). A dash there says that the export found none, so a workspace that is called
 * by the dash alone is taken for none as well. With them goes the way for the map to tell the page that it has stopped
 * (graph-types.ts `onFailure`). */
function mapOptions(model: AnalysisResult, onFailure: (reason: string) => void): ModelMapOptions {
  const workspace = detailValue(detailsOf(model), "Model", "Workspace")?.trim() ?? "";
  return { modelName: cellText(model.name), ...(workspace === "" || workspace === NONE ? {} : { workspaceName: workspace }), onFailure };
}

/** Tells a map that it is hidden, that the theme has changed, or that it is to go: the mounted one, unless another is
 * given. The map is another module's work: a call that throws is noted in the run's log and passed over, so that the
 * page works on. */
function tellMap(call: "hide" | "themeChanged" | "destroy", map = modelMap): void {
  if (!map || map === "failed") return;
  try { map[call](); } catch (error) { client.note(mapFailure(call, error)); }
}

/** Takes the map of the result on the page away. A new result, a run that starts and a result that is forgotten each end
 * it: its entry builds it afresh when it is next chosen. The host is left as the page had it at first, hidden and empty,
 * whatever the map left in it. A page whose shell lacks the host is passed over, as in `clearResult`.
 * The map is no longer the page's from before it is told to go: what it tells the page while it goes is not heard. */
function dropMap(): void {
  const map = modelMap;
  modelMap = undefined;
  modelGraph = undefined;
  tellMap("destroy", map);
  const host = document.getElementById("mapHost" satisfies PageId);
  if (!host) return;
  host.hidden = true;
  host.innerHTML = "";
}

/** The map of the result on the page could not be drawn, or was drawn and has stopped by itself. What there is of it
 * is taken away, and the page remembers the failure for this result: the map's entry says so in a few plain words
 * (markup.ts `MAP_FAILED`) and tries nothing again until the map is dropped. */
function failMap(): void {
  dropMap();
  modelMap = "failed";
}

/** A map that was drawn tells the page that it has stopped, and why. The reason goes into the run's log, and the map is
 * taken for one that could not be drawn: every failure of the map has the one look, with the button that copies the log
 * beside it. Where the map is the view on screen, the view says so at once. Under another view nothing is seen to
 * change: the map's entry says so when it is next chosen.
 * The map is taken away while it is still telling, so its own words for its stop are not seen, and a click or a key that
 * ended it comes to the page afterwards with the map gone. */
function mapStoppedByItself(reason: string): void {
  client.note(mapStopped(reason));
  // Where the focus is, asked before the map is taken away. Inside the map it goes with the map: the view takes it
  // then. So it does where the focus is on nothing, as it is when the map had it and has written its own place anew.
  // On anything else of the page it stays.
  const focused = document.activeElement;
  const elsewhere = focused !== null && focused !== document.body && !el("mapHost").contains(focused);
  failMap();
  if (state.view !== "map") return;
  el("view").innerHTML = mapHtml(true);
  announce(MAP_FAILED);
  if (!elsewhere) el("view").focus({ preventScroll: true });
}

/** Leaves the map, for another view or to be shown anew (`navTo`): the map is told that it is hidden, and its host gives
 * the room back. */
function leaveMap(): void {
  const host = el("mapHost");
  if (host.hidden) return;
  tellMap("hide");
  host.hidden = true;
}

/** Shows a model's map in the view's place. The first time for a result, the graph is built from the result's tables
 * and the map is mounted: now, and not before. Coming back to a mounted map shows it again as it was left. The view
 * gives up its room first and the host is shown, so that the map finds the size it has to fill, both when it is put into
 * the host and when it draws.
 * A call that throws leaves no map: the view says so (markup.ts `MAP_FAILED`), the reason goes to the run's log,
 * which the view's button copies, and the rest of the page works on. A map that stops by itself later ends
 * the same way (`mapStoppedByItself`). */
function enterMap(model: AnalysisResult): void {
  const host = el("mapHost");
  el("view").innerHTML = mapHtml(modelMap === "failed");
  if (modelMap !== "failed" && host.hidden) {
    host.hidden = false;
    let call = "buildModelGraph";
    try {
      if (!modelMap) {
        const graph = graphFor(model);
        call = "mountModelMap";
        // Only the map the page holds is heard when it tells of its stop. One that is still being mounted is not: it
        // fails by throwing. Nor is one that the page has taken away, or has heard once already.
        const held: { map?: ModelMap } = {};
        held.map = modelMap = mountModelMap(host, graph, mapOptions(model, reason => {
          if (held.map !== undefined && modelMap === held.map) mapStoppedByItself(reason);
        }));
      }
      call = "show";
      modelMap.show();
    } catch (error) {
      client.note(mapFailure(call, error));
      failMap();
      el("view").innerHTML = mapHtml(true);
    }
  }
  announce(modelMap === "failed" ? MAP_FAILED : MAP_LABEL);
}

/** A run has started: the map of the result on the page ends with it, as it will with the result the run brings. Where
 * the map was the view shown, the overview takes its place under the run's banner, and focus that was inside the map
 * goes to it. The map's entry stays: it builds the map afresh from the result that is still on the page. */
function endMapForRun(): void {
  const inside = el("mapHost").contains(document.activeElement);
  dropMap();
  if (state.view !== "map") return;
  state.view = "overview";
  renderAll();
  if (inside) el("view").focus({ preventScroll: true });
}

/* ================= the view in the address ================= */
/** Marks the view shown in the page's address, so that a refreshed page opens on it once the result it kept is back
 * (`showMarked`): a table by its place among the result's tables, a number the page counted itself, and a model's map by
 * its own name. The overview has no mark. The address names nothing of the result, and changing it loads nothing. A page
 * that cannot change its address opens on the overview after a refresh. */
function markView(): void {
  const mark = typeof state.view === "number" ? `#${state.view}` : state.view === "map" ? "#map" : "";
  if (location.hash === mark) return;
  try {
    history.replaceState(history.state, "", `${location.pathname}${location.search}${mark}`);
  } catch { /* not marked: a refresh opens on the overview */ }
}

/** The view the page's address marks (`markView`). */
function markedView(): "map" | number | undefined {
  const mark = location.hash.slice(1);
  return mark === "map" ? "map" : /^\d{1,4}$/.test(mark) ? Number(mark) : undefined;
}

/** Shows the view the address marked when the page was loaded, once the result the page kept is back: a table the result
 * has, or a model's map. A mark that names no view of this result leaves the overview. The focus stays where it is. */
function showMarked(view: "map" | number | undefined): void {
  if (!result || view === undefined || view === state.view) return;
  if (view === "map" ? result.kind !== "model" : !shown.has(view)) return;
  state.view = view;
  renderAll();
}

/* ================= view switching ================= */
function navTo(view: View, context?: string): void {
  closePopover();
  // The search and the jump end with the view. The table that is left had its page counted among the rows they kept,
  // so it is shown from its first page when the user comes back to it.
  const left = currentEntry();
  if (left && (state.search.trim() !== "" || state.context !== undefined)) left.page = 0;
  // A choice made with the focus outside the map leaves the map before the view is drawn. For another view that is
  // all there is to it. For the map's own entry, chosen again while the map is shown, it has the map shown anew, as on
  // coming back to it: choosing the entry took the focus out of the map, to the entry, and the map's keys with it, and
  // a map that is shown anew takes the focus as it did when it was first shown. A map that still has the focus is left
  // as it is.
  // Whether the focus is in the map is asked here, while the map is as the user left it. A browser goes on naming an
  // element as the one with the focus after the element was hidden, until it next draws the page: asked once the view
  // is drawn, a focus that was in a map now hidden would still seem to be in it.
  const host = el("mapHost");
  if (!host.contains(document.activeElement)) leaveMap();
  state.view = view;
  state.search = "";
  state.context = context;
  renderAll();
  // The view takes the focus, unless a map that is shown has it: one that took it as it was shown, whose keys are its
  // own from the first one, or one that kept it through a choice of its own entry. A map that is hidden has no focus to
  // keep, whatever element the browser still names: so only a map that is shown is asked.
  if (host.hidden || !host.contains(document.activeElement)) el("view").focus({ preventScroll: true });
  window.scrollTo({ top: 0 });
}
/** The cards of one page: the Cards table, kept to that page. The drawer closes first when the jump starts in it: the page
 * behind it takes part again, so the view the jump opens can take the focus. */
function gotoPage(page: string): void {
  const entry = cards && shown.get(cards.index);
  if (!entry) return;
  closeDrawer();
  entry.page = 0;
  navTo(entry.index, page);
}

/* ================= the navigation's menus ================= */
/** Opens or closes a menu of the navigation, by the button that controls it: a group's of a model's tables, or the one
 * menu of a narrow window. The button says whether its menu is open. The menu follows its button on the page, so the
 * focus stays on the button and Tab goes on into the menu. The menus have the look of the page's popovers, but each
 * stands in the navigation, after its button, rather than in the page's one popover, which is a dialog of its own. */
function setNavMenu(button: Element, open: boolean): void {
  const menu = document.getElementById(button.getAttribute("aria-controls") ?? "");
  if (!menu) return;
  menu.hidden = !open;
  button.setAttribute("aria-expanded", String(open));
}
/** Closes every open menu of the navigation but the one inside `keep`, and says whether it closed one. `back` gives the
 * focus back to the menu's button: after Escape, which a keyboard user presses inside the menu. */
function closeNavMenus(keep: Element | null = null, back = false): boolean {
  let closed = false;
  for (const button of document.querySelectorAll<HTMLElement>('#topnav [aria-expanded="true"]')) {
    if (keep?.contains(button)) continue;
    setNavMenu(button, false);
    if (back) button.focus();
    closed = true;
  }
  return closed;
}

/* ================= global events ================= */
document.addEventListener("click", event => {
  if (!(event.target instanceof Element)) return;
  const target = event.target;
  // A menu of the navigation closes on a click anywhere but inside it or on its button: on the map too, which closing it
  // reads nothing of. A click on another menu's button opens that one instead, and closes a table's popover as any click
  // outside the popover does; choosing an entry draws the navigation again, with its menus closed.
  closeNavMenus(target.closest("#topnav .nav-group"));
  const menuButton = target.closest("#topnav [aria-controls]");
  if (menuButton) {
    closePopover();
    setNavMenu(menuButton, menuButton.getAttribute("aria-expanded") !== "true");
    return;
  }
  // What is clicked inside the map is the map's own: the page reads nothing there, whatever an element is marked with.
  // Nor does it read what is no longer on the page when the click gets here: a click that ended the map still comes up
  // to the page, with the map taken away.
  if (!target.isConnected || el("mapHost").contains(target)) return;
  const popover = el("popover");
  const anchorish = target.closest("[data-colfilter], #colBtn");
  if (!popover.hidden && !popover.contains(target) && !anchorish) closePopover();

  const copy = target.closest<HTMLElement>("[data-copy]");
  if (copy) {
    event.stopPropagation();
    void copyText(copy.dataset.copy ?? "");
    return;
  }

  const entry = currentEntry();
  const act = target.closest<HTMLElement>("[data-act]");
  if (act) {
    const from = rowFor(act);
    switch (act.dataset.act) {
      case "page":
        if (from && from.entry.keys.page !== undefined) gotoPage(cellText(from.row[from.entry.keys.page]));
        return;
      // The row's card: the row itself in the Cards table, and otherwise the one card that the row names.
      case "card":
        if (from) openCard(cardsOfRow(from.entry, from.row), act);
        return;
      // The row's box on the map: the details close, the map is shown, and the box is selected there as the map's own
      // search selects one, with its details beside it.
      case "map-node": {
        const node = from && mapNodeOf(from.entry, from.row);
        if (node === undefined) return;
        closeDrawer();
        navTo("map");
        if (modelMap && modelMap !== "failed" && !modelMap.reveal(node)) toast("Not found on the map");
        return;
      }
      case "row":
        if (from) {
          clickedRow = { ...from, at: Date.now() };
          openRowDrawer(from.entry, from.row, act);
        }
        return;
      // A use of the object in the drawer, by its place among the object's uses: its page's cards, or its card.
      case "use-page":
      case "use-card": {
        const use = drawerObject?.object.uses[Number(act.dataset.use)];
        if (!use) return;
        if (act.dataset.act === "use-page") gotoPage(use.page);
        else if (use.cardId !== undefined && cards) openCard(cardsNamed(cards, use.page, use.cardId, cellText(use.card)), act);
        return;
      }
      // Every use of the object in the drawer. The control goes with what it did: the first use it added takes the focus.
      case "more-uses":
        if (!drawerObject) return;
        drawerObject.all = true;
        el("drawerBody").innerHTML = objectDrawerHtml(drawerObject.object, useLinks(), true);
        focusOn("#usesRest", "#drawerClose");
        announce(`All ${drawerObject.object.uses.length} uses are listed.`);
        return;
      // Both of these go away with what they clear, so the focus moves on: to the view, and to the search box.
      case "clear-context":
        state.context = undefined;
        if (entry) entry.page = 0;
        renderAll();
        el("view").focus({ preventScroll: true });
        return;
      case "reset":
        state.search = "";
        state.context = undefined;
        if (entry) {
          entry.filters.clear();
          entry.sort = undefined;
          entry.page = 0;
        }
        renderAll();
        focusOn("#tblSearch");
        return;
      case "clear-search": {
        state.search = "";
        const box = find<HTMLInputElement>("#tblSearch");
        if (box) box.value = "";
        if (entry) {
          entry.page = 0;
          updateTable(entry);
        }
        box?.focus();
        return;
      }
      // The log a result carries, under Diagnostics on the overview; and the log of the run the page follows or last followed.
      case "copy-diag":
        void copyText(diagnosticLog(details).join("\n"), "the diagnostic log");
        return;
      case "copy-run-log":
        void copyText(client.log.join("\n"), "the diagnostic log");
        return;
      // The copy the tab keeps for a refresh goes: the result stays on the page, with its tables. A model's map that
      // was built from it goes with the copy, and its entry builds it afresh when it is next chosen.
      // The control goes with what it removed: the line that says so takes its place and the focus. The page
      // says that only of a copy that is gone. One that could not be removed keeps its control, and the page says so.
      // A screen reader reads the line where the focus now is. The live region does not say it too, or it would be read
      // twice: it is emptied, so that it does not go on saying what it said last, which may be that the copy could not
      // be removed.
      case "forget":
        if (!keeper.forget()) return showNotRemoved();
        dropMap();
        setKeptCopy("forgotten");
        focusOn("#keptLine", "#view");
        announce("");
        return;
    }
  }

  const nav = target.closest<HTMLElement>("[data-nav]");
  if (nav) {
    // A file is named by its place in the result, and a model's map by its own name. Any other name leads to the
    // overview: its own, and "details", the name of the view whose content the overview now holds.
    const id = nav.dataset.nav ?? "";
    navTo(/^\d+$/.test(id) ? Number(id) : id === "map" ? "map" : "overview");
    return;
  }

  const sortButton = target.closest<HTMLElement>("[data-sort]");
  if (sortButton && entry) {
    const column = Number(sortButton.dataset.sort);
    entry.sort = !entry.sort || entry.sort.column !== column ? { column, dir: "asc" } : entry.sort.dir === "asc" ? { column, dir: "desc" } : undefined;
    // Another order puts other rows on every page: the table is shown from its first page, as after a search or a filter.
    entry.page = 0;
    updateTable(entry);
    // The button pressed is written again with the table's head, where it was: it takes the focus there, and neither the
    // table's box nor the page moves to it.
    focusInPlace(`[data-sort="${column}"]`);
    return;
  }

  const filterButton = target.closest<HTMLElement>("[data-colfilter]");
  if (filterButton && entry) {
    const index = Number(filterButton.dataset.colfilter);
    const column = entry.columns[index];
    const owner = `[data-colfilter="${index}"]`;
    if ((!popover.hidden && popOwner === owner) || !column) closePopover();
    else openColFilter(entry, column, owner, filterButton);
    return;
  }
  // The switch of a file that is shown in two ways. Each way keeps what was chosen for it; the search goes with the user
  // from one to the other. The switch is drawn again, so the way's own button takes the focus back.
  const way = target.closest<HTMLElement>("[data-way]");
  if (way && entry?.ways) {
    closePopover();
    everyUse = way.dataset.way === "use";
    shown.set(entry.index, everyUse ? entry.ways.use : entry.ways.object);
    renderAll();
    focusOn(`[data-way="${everyUse ? "use" : "object"}"]`);
    return;
  }
  const chooser = target.closest("#colBtn");
  if (chooser && entry) {
    if (!popover.hidden && popOwner === "#colBtn") closePopover();
    else openColChooser(entry, chooser);
    return;
  }

  const pager = target.closest<HTMLButtonElement>(".pg-btn[data-page]");
  if (pager && !pager.disabled && entry) {
    // Previous or Next, by the name the pager gives each: the same button takes the focus back once the pager is drawn
    // again. A press that reaches the first or the last page leaves that button disabled, and a disabled button cannot
    // hold the focus, so the other one takes it: the one that turns the page back, which Enter then presses.
    const name = pager.getAttribute("aria-label") ?? "";
    const other = name === "Next page" ? "Previous page" : "Next page";
    entry.page = parseInt(pager.dataset.page ?? "", 10);
    updateTable(entry);
    focusOn(`.pg-btn[aria-label="${name}"]`, `.pg-btn[aria-label="${other}"]`);
    return;
  }

  // A click anywhere else on a row opens it too. The row's own button is what the focus goes back to afterwards.
  const tr = target.closest("#tableWrap tbody tr");
  if (tr && !target.closest("button, a, input, label, select")) {
    const from = rowFor(tr);
    if (from) {
      clickedRow = { ...from, at: Date.now() };
      openRowDrawer(from.entry, from.row, tr.querySelector('[data-act="row"]') ?? tr);
    }
  }
});
// A double-click on a row of a model's Line Items or Modules opens the row's module in Anaplan. Its first click opened the
// row's details, so its second fell on what the details put over the table: the row is the one the first click opened.
document.addEventListener("dblclick", () => {
  const clicked = clickedRow;
  clickedRow = undefined;
  if (!clicked || Date.now() - clicked.at > DOUBLE_CLICK_MS || moduleOfRow(clicked.entry, clicked.row) === undefined) return;
  // What the double-click selected is no selection the user meant.
  if (typeof window.getSelection === "function") window.getSelection()?.removeAllRanges();
  if (el("drawer").classList.contains("show")) closeDrawer();
  void openInAnaplan(clicked.entry, clicked.row);
});
document.addEventListener("input", event => {
  const entry = currentEntry();
  if (event.target instanceof HTMLInputElement && event.target.id === "tblSearch" && entry) {
    state.search = event.target.value;
    entry.page = 0;
    updateTable(entry);
  }
});
document.addEventListener("change", event => {
  const entry = currentEntry();
  if (event.target instanceof HTMLSelectElement && event.target.id === "pageSize" && entry) {
    state.pageSize = parseInt(event.target.value, 10) || 50;
    entry.page = 0;
    updateTable(entry);
    focusOn("#pageSize");
  }
});
document.addEventListener("keydown", event => {
  // While the focus is inside the map, a key is the map's: the page's own shortcuts leave it alone.
  if (el("mapHost").contains(document.activeElement)) return;
  if (event.key === "Escape") {
    if (closeNavMenus(null, true)) return;
    if (!el("popover").hidden) closePopover(true);
    else if (el("drawer").classList.contains("show")) closeDrawer();
    return;
  }
  if (event.key === "/" && currentEntry() && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName ?? "")) {
    event.preventDefault();
    find("#tblSearch")?.focus();
  }
});
// The focus leaving a menu of the navigation, by Tab or otherwise, closes it: a menu stays open only while it is in use.
document.addEventListener("focusin", event => {
  if (event.target instanceof Element) closeNavMenus(event.target.closest("#topnav .nav-group"));
});
el("drawerClose").addEventListener("click", closeDrawer);
// A click beside the drawer, on the scrim, closes it: the scrim is the drawer's alone.
el("scrim").addEventListener("click", closeDrawer);
el("themeToggle").addEventListener("click", toggleTheme);
el("runAgain").addEventListener("click", () => client.runAgain());
window.matchMedia?.("(prefers-color-scheme: dark)").addEventListener("change", event => {
  let stored: string | null = null;
  try { stored = localStorage.getItem("cardigan-theme"); } catch { /* no storage: follow the system */ }
  if (!stored) applyTheme(event.matches ? "dark" : "light");
});

/* ================= init ================= */
/** Whether the toolbar icon has just opened this page: only then does the analysis start by itself (protocol.ts). The time
 * of the click is taken out of the address at once, so that a reload, a duplicate or a tab Chrome restores finds none and
 * waits for the run control. A page that cannot change its address starts nothing by itself either. */
function openedByIcon(): boolean {
  const rest = withoutOpened(location.search);
  if (rest === undefined) return false;
  const fresh = openedJustNow(location.search, Date.now());
  try {
    history.replaceState(history.state, "", `${location.pathname}${rest}${location.hash}`);
  } catch {
    return false;
  }
  return fresh;
}

/** How long the page waits for the frame that draws a result before it keeps the result all the same. */
const KEEP_WITHOUT_FRAME_MS = 1000;

/** Keeps a finished run's result for a refresh of this page (keep-result.ts), in the place of the one kept before. The
 * result is on screen first: writing it out and compressing it take a moment on the page's own thread, and that must not
 * hold up what the user sees. Once it is kept, the overview offers to forget the copy, in the room it held for that
 * since it was drawn. A result that cannot be kept is whole and on the page all the same: the page says so once, in a
 * note above it, and the keeper's reason goes into the run's log, which the note's button copies. */
function keepLater(kept: AnalysisResult, at: Date): void {
  let begun = false;
  const keep = (): void => {
    if (begun) return;
    begun = true;
    void keeper.keep(kept, at).then(outcome => {
      if (outcome.kept) {
        // Now there is a copy to forget, and the overview offers that. Unless the page has gone on to another result
        // meanwhile: what is kept is then not the result on the page, and that one is kept in its own turn.
        if (result === kept) setKeptCopy("kept");
        return;
      }
      // Not kept: no copy will come, and the overview gives up the room it held for one.
      if (result === kept) setKeptCopy("none");
      const note = notKeptNote(outcome.reason);
      // Nothing to say for a result that a later one replaced, nor once the page has gone on: to another result, or to a
      // run, whose banner stands where the note would.
      if (note === undefined || result !== kept || client.state.phase !== "done") return;
      client.note(outcome.message);
      showNote(note, true);
      announce(note);
    });
  };
  // After the frame that draws the result. A window that is not shown draws none: there the result is kept after a moment.
  requestAnimationFrame(() => setTimeout(keep, 0));
  setTimeout(keep, KEEP_WITHOUT_FRAME_MS);
}

el("version").textContent = `v${VERSION}`;
applyTheme(currentTheme());
const tabId = tabIdFrom(location.search);
const byIcon = openedByIcon();
const keeper = new ResultKeeper({ tabId });
const client = new ResultsClient({
  connect: tabId === undefined ? undefined : () => chrome.tabs.connect(tabId, { name: PORT_NAME }),
  autoRun: byIcon,
  closeReason: () => chrome.runtime.lastError?.message,
  // A tab open since before Cardigan was installed, updated or reloaded has no content script until the page puts it there,
  // which the icon's click allows. A tab that is still loading answers within a few seconds.
  repair: tabId === undefined ? undefined : () => repairTab(chrome.scripting, tabId),
  retries: { count: 10, pauseMs: 500 },
  tabGone: tabId === undefined ? undefined : () => chrome.tabs.get(tabId).then(() => false, () => true),
  onState: next => {
    // Only a run that starts ends the map: one that goes on says "running" again with each step.
    if (next.phase === "running" && !running) endMapForRun();
    running = next.phase === "running";
    if (next.phase !== "done") return showRun(next);
    // Only a run's result is kept, and only once it is drawn: a result that was brought back is kept already.
    showResult(next.result, next.received);
    keepLater(next.result, next.received);
  },
  onLog: showLog,
});
// A page the icon has just opened analyses anew, and takes nothing back. Any other page may be one that was refreshed: it
// looks for the result it kept, and shows it at once, having asked the tab nothing. Meanwhile it connects to the tab as
// ever, so that the run control works.
// The view the address marks, read before anything is drawn: drawing the overview takes the mark away.
const marked = markedView();
takingBack = !byIcon;
client.start();
if (takingBack) {
  void keeper.takeBack().then(back => {
    takingBack = false;
    // A run that finished meanwhile has the page: its result is the newer one. What came back and cannot be shown is
    // forgotten: the page then waits for the run control, as one that kept nothing. What is shown opens on the view the
    // address marked.
    if (back.found && !result) {
      if (showKept(back.result, back.received)) showMarked(marked);
      else keeper.forget();
    }
    // The state the page held back, or the one that belongs above the result: a run asked for meanwhile has its banner.
    if (client.state.phase !== "done") showRun(client.state);
  });
}
