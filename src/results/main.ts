import { PORT_NAME } from "../protocol.js";
import type { AnalysisResult, ResultTable } from "../result-types.js";
import { resultZip, tableCsv } from "../result-zip.js";
import { VERSION } from "../version.js";
import { cardsOf, columnIndex, columnsOf, rowKeys, rowNameIndex, type CardsTable, type Column, type RowKeys } from "./columns.js";
import { describeState, openedJustNow, ResultsClient, runLabel, tabIdFrom, withoutOpened, type RunState } from "./connection.js";
import { CSV_FALLBACK, downloadName, ZIP_FALLBACK } from "./file-name.js";
import {
  cardDrawerHtml, cardDrawerSubHtml, colChooserHtml, colFilterHtml, crumbsHtml, headerMetaHtml, MOON_ICON, navHtml,
  overviewHtml, rowDrawerHtml, rowDrawerSubHtml, runBannerHtml, runHtml, SUN_ICON, tableHtml, tableParts, type Links, type NavEntry, type TableView,
} from "./markup.js";
import type { PageId } from "./page-ids.js";
import { analysedOf, cardSections, detailsOf, diagnosticLog, fileView, listedTables, overviewOf } from "./result-view.js";
import { cellText, NONE, pageOf, rememberingSelect, rowName, valueCounts, type Row, type Sort, type TableQuery } from "./table-engine.js";

/** The results page (results.html): the design's script, on the real result. It connects to the Anaplan tab the address
 * names and says what that tab shows. The analysis starts by itself when the icon has just opened the page, and otherwise
 * with the run control. The page shows its progress and then the result: an overview, which also holds what the Details
 * file says, one table per file, and the downloads. The markup is built in markup.ts and the data work is done in the modules beside it; this file
 * only holds what the user chose and puts the pieces on the page. */

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
  for (const selector of selectors) {
    const node = find<HTMLButtonElement>(selector);
    if (node && !node.disabled && !node.hidden) {
      node.focus();
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
/** Saves `data` as a download. `name` is a plain file name (file-name.ts), never a name a result gave unchecked. */
function downloadFile(name: string, data: BlobPart, type: string): void {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/* ================= state ================= */
/** One file of the result as the page shows it: its columns, and what the user chose for it. The files are kept in the
 * order the navigation lists them in (result-view.ts `listedTables`). */
interface Shown {
  /** Its place in the result's tables, which is also its name in the navigation. */
  index: number;
  /** The file as the result holds it: what a download gives. */
  file: ResultTable;
  /** The file as the page shows it: the same, unless the file has a rule of its own (result-view.ts `fileView`). Then it
   * is the table the rule gives, and `note` is the line under the table's name that says so. */
  table: ResultTable;
  note: string | undefined;
  columns: Column[];
  keys: RowKeys;
  links: Links;
  /** Column -> the texts ticked in its filter; a column with every text ticked has no entry. */
  filters: Map<number, Set<string>>;
  hidden: Set<number>;
  sort: Sort | undefined;
  page: number;
}
type View = "overview" | number;

let result: AnalysisResult | undefined;
/** When the result was complete: its zip carries this time, so downloading it twice gives the same bytes. */
let received = new Date();
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
let select = rememberingSelect();

const defaultHidden = (columns: readonly Column[]): Set<number> => new Set(columns.filter(column => column.hidden).map(column => column.index));
const currentEntry = (): Shown | undefined => (typeof state.view === "number" ? shown.get(state.view) : undefined);
/** The file "Download this table" gives: the file of the table shown, whole; on the overview, the Details file, which
 * is what the overview shows. */
const currentTable = (): ResultTable | undefined => currentEntry()?.file ?? (state.view === "overview" ? details : undefined);

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
}
function toggleTheme(): void {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  try { localStorage.setItem("cardigan-theme", next); } catch { /* not remembered */ }
  applyTheme(next);
}
/** A text node, as Node.TEXT_NODE names it. */
const TEXT_NODE = 3;
/** The run control's words, after its icon: "Run" until an analysis has been asked for on this page, "Run again" after. */
function showRunLabel(): void {
  const button = el("runAgain");
  const label = runLabel(client.asked);
  const words = [...button.childNodes].reverse().find(node => node.nodeType === TEXT_NODE && node.textContent?.trim());
  if (!words) button.append(label);
  else if (words.textContent !== label) words.textContent = label;
  button.title = client.asked ? "Analyse the Anaplan tab again" : "Analyse the Anaplan tab";
}
/** The header's buttons follow what there is to act on. */
function updateActions(): void {
  const phase = client.state.phase;
  el<HTMLButtonElement>("runAgain").disabled = phase === "running" || phase === "no-tab";
  showRunLabel();
  el<HTMLButtonElement>("dlAll").disabled = !result;
  const table = currentTable();
  const csv = el<HTMLButtonElement>("dlCsv");
  csv.disabled = !table;
  csv.title = table ? `Download ${downloadName(table.file, ".csv", CSV_FALLBACK)}` : "";
}

/* ================= views ================= */
function navEntries(): NavEntry[] {
  return [
    { id: "overview", label: "Overview" },
    ...[...shown.values()].map(entry => ({ id: String(entry.index), label: cellText(entry.table.label), count: entry.table.rows.length })),
  ];
}

function query(entry: Shown): TableQuery {
  const column = entry.keys.page;
  return {
    search: state.search, filters: entry.filters, sort: entry.sort,
    context: state.context !== undefined && column !== undefined ? { column, value: state.context } : undefined,
  };
}

/** What a table shows now: the page of rows the search, the filters, the sort and the jump leave, and what the user chose. */
function tableView(entry: Shown): TableView {
  const page = pageOf(select(entry.table.rows, query(entry)), entry.page, state.pageSize);
  entry.page = page.page;
  currentSlice = page.rows;
  return {
    label: cellText(entry.table.label), note: entry.note,
    columns: entry.columns.filter(column => !entry.hidden.has(column.index)), rows: page.rows,
    page: page.page, pages: page.pages, pageSize: state.pageSize, from: page.from, to: page.to, total: page.total, all: entry.table.rows.length,
    search: state.search, sort: entry.sort, filtered: new Set(entry.filters.keys()), context: state.context, links: entry.links,
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
 * types into it would move the caret and break a letter that is still being put together (a dead key, an input method). */
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
  if (!entry) state.view = "overview";
  el("navList").innerHTML = navHtml(navEntries(), String(state.view), result.kind === "model");
  el("crumbs").innerHTML = crumbsHtml(entry ? cellText(entry.table.label) : undefined, entry ? state.context : undefined);
  if (entry) renderTable(entry);
  else el("view").innerHTML = overviewHtml(overviewOf(result));
  updateActions();
}

/** A result arrived, complete: the page becomes the design's results page for it. Only now does it take the place of an
 * earlier result, of which nothing is kept: not the rows on the page, the drawer's row, the last selection, or the banner
 * of the run that has just ended. */
function showResult(next: AnalysisResult, at: Date): void {
  // Focus that is inside what the new result replaces moves to the new view; anywhere else, in the header, it stays.
  const replaced = [el("view"), el("drawer"), el("popover")].some(part => part.contains(document.activeElement));
  closePopover();
  closeDrawer();
  currentSlice = [];
  drawerRow = undefined;
  select = rememberingSelect();
  el("banners").innerHTML = "";
  result = next;
  received = at;
  details = detailsOf(next);
  cards = cardsOf(next);
  shown = new Map();
  for (const { index, table: file } of listedTables(next)) {
    // What the page counts, filters and searches is the table as it shows it: the columns' filters follow its rows too.
    const { table, note } = fileView(next, file);
    const columns = columnsOf(table);
    const keys = rowKeys(table);
    const page = cards !== undefined && keys.page !== undefined;
    shown.set(index, {
      index, file, table, note, columns, keys, links: { page, card: page && keys.cardId !== undefined },
      filters: new Map(), hidden: defaultHidden(columns), sort: undefined, page: 0,
    });
  }
  state.view = "overview";
  state.search = "";
  state.context = undefined;
  const analysed = analysedOf(next);
  document.title = `Cardigan — ${analysed.name}`;
  el("hdMeta").innerHTML = headerMetaHtml(analysed);
  el("sidenav").hidden = false;
  el("navToggle").hidden = false;
  renderAll();
  if (replaced) el("view").focus({ preventScroll: true });
  announce(`Analysis finished: ${analysed.name}`);
}

/** The states in which a run did not start or did not finish. */
const STOPPED: ReadonlySet<RunState["phase"]> = new Set(["unreachable", "no-subject", "failed", "interrupted"]);

/** Connecting, running, or why there is no new result. Before the first result this is the whole view. Once a result is on
 * the page it stays there until a new one is complete, and the same words stand in the banner area above it: a run that
 * cannot start or does not finish takes nothing away. Every text is set as plain text. */
function showRun(runState: RunState): void {
  const text = describeState(runState, client.asked);
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
      el("sidenav").hidden = true;
      el("navToggle").hidden = true;
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
 * buttons, which would otherwise leave the focus on nothing. A click elsewhere takes the focus where it was made. */
function closePopover(back = false): void {
  const popover = el("popover");
  if (!popover.hidden) {
    popover.hidden = true;
    popover.innerHTML = "";
  }
  const owner = popOwner;
  popOwner = undefined;
  markPopOwner();
  if (back && owner) focusOn(owner);
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
/** The scrim goes once neither the drawer nor the narrow-screen navigation needs it. */
function settleScrim(): void {
  if (el("drawer").hidden && !el("sidenav").classList.contains("open")) el("scrim").hidden = true;
}
/** What lies behind the open drawer: the link that skips to the results, the header, the banner area and the shell. The
 * drawer says it is modal, so while it is open these are inert: the Tab key stays in the drawer, and a screen reader does
 * not read on into the page behind it. */
function setBehindDrawer(inert: boolean): void {
  for (const part of [find(".skip"), find(".hd"), el("banners"), find(".shell")]) if (part) part.inert = inert;
}
/** What lies behind the open navigation of a narrow window, where it slides over the page: the link that skips to the
 * results, the header, the banner area and the view. While the navigation is open these are inert, so the Tab key stays
 * among its entries and a screen reader does not read on into the page behind it. */
function setBehindNav(inert: boolean): void {
  for (const part of [find(".skip"), find(".hd"), el("banners"), find("#main")]) if (part) part.inert = inert;
}
/** Opens the navigation of a narrow window and takes the focus into it: to the entry of the view shown. */
function openNav(): void {
  el("sidenav").classList.add("open");
  el("navToggle").setAttribute("aria-expanded", "true");
  const scrim = el("scrim");
  scrim.hidden = false;
  requestAnimationFrame(() => scrim.classList.add("show"));
  setBehindNav(true);
  focusOn('#navList [aria-current="page"]', "#navList .nav-item");
}
/** Closes it, when it is open. `back` gives the focus back to the button that opens it: after Escape and after a click
 * beside it. An entry that is chosen takes the focus to its view instead. */
function closeNav(back: boolean): void {
  if (!el("sidenav").classList.contains("open")) return;
  el("sidenav").classList.remove("open");
  el("navToggle").setAttribute("aria-expanded", "false");
  el("scrim").classList.remove("show");
  setTimeout(settleScrim, 210);
  // The page behind takes part again before the focus goes back into it.
  setBehindNav(false);
  if (back) el("navToggle").focus();
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
  closeNav(false);
  clearTimeout(drawerTimer);
  drawerTimer = setTimeout(() => {
    drawer.hidden = true;
    settleScrim();
  }, 210);
  // The page behind takes part again before the focus goes back into it.
  setBehindDrawer(false);
  if (state.lastFocus instanceof HTMLElement && document.contains(state.lastFocus)) state.lastFocus.focus();
  state.lastFocus = null;
}
/** Any row, in full. Its heading is the row's own name: the cell of the column that names the file's rows (columns.ts
 * `ROW_NAME_COLUMNS`), or, where the page knows no such column or the cell says nothing, the first cell that does. The
 * line under it says which row of which table it is, by its place among the rows the table lists, which a search, a
 * filter or a sort does not change. */
function openRowDrawer(entry: Shown, row: Row, opener: Element): void {
  drawerRow = { entry, row };
  const position = entry.table.rows.findIndex(candidate => candidate === row) + 1;
  const named = rowNameIndex(entry.table);
  const name = (named === undefined ? "" : rowName([row[named] ?? ""])) || rowName(row) || `Row ${position}`;
  openDrawer(name, rowDrawerSubHtml(position, cellText(entry.table.label)), rowDrawerHtml(entry.columns, row, entry.links), opener);
}
/** A card: its row of the Cards file, and the rows of the other files that carry its Card ID on its page. */
function openCardDrawer(page: string, cardId: string, opener: Element): void {
  const found = cards;
  const entry = found && shown.get(found.index);
  const row = found?.table.rows.find(candidate => cellText(candidate[found.cardId]) === cardId && cellText(candidate[found.page]) === page);
  if (!result || !entry || !row) {
    toast("Card not found in this export");
    return;
  }
  const cell = (header: string): string => {
    const index = columnIndex(entry.table, header);
    return index === undefined ? "" : cellText(row[index]);
  };
  const title = cell("Card title");
  drawerRow = { entry, row };
  openDrawer(`Card ${cell("Card #")}${title !== "" && title !== NONE ? ` — ${title}` : ""}`, cardDrawerSubHtml(page, cell("Card type"), cardId),
    cardDrawerHtml(entry.columns, row, entry.links, cardSections(result, page, cardId)), opener);
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

/* ================= view switching ================= */
function navTo(view: View, context?: string): void {
  closePopover();
  // The search and the jump end with the view. The table that is left had its page counted among the rows they kept,
  // so it is shown from its first page when the user comes back to it.
  const left = currentEntry();
  if (left && (state.search.trim() !== "" || state.context !== undefined)) left.page = 0;
  state.view = view;
  state.search = "";
  state.context = context;
  renderAll();
  // The navigation of a narrow window closes on a choice, before the view takes the focus: until then the view is behind it.
  closeNav(false);
  el("view").focus({ preventScroll: true });
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

/* ================= global events ================= */
document.addEventListener("click", event => {
  if (!(event.target instanceof Element)) return;
  const target = event.target;
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
      case "card":
        if (from && from.entry.keys.page !== undefined && from.entry.keys.cardId !== undefined) {
          openCardDrawer(cellText(from.row[from.entry.keys.page]), cellText(from.row[from.entry.keys.cardId]), act);
        }
        return;
      case "row":
        if (from) openRowDrawer(from.entry, from.row, act);
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
    }
  }

  const nav = target.closest<HTMLElement>("[data-nav]");
  if (nav) {
    if (nav.classList.contains("disabled")) {
      toast("Model map is coming in a later version");
      return;
    }
    // A file is named by its place in the result. Any other name leads to the overview: its own, and "details", the
    // name of the view whose content the overview now holds.
    const id = nav.dataset.nav ?? "";
    navTo(/^\d+$/.test(id) ? Number(id) : "overview");
    return;
  }

  const sortButton = target.closest<HTMLElement>("[data-sort]");
  if (sortButton && entry) {
    const column = Number(sortButton.dataset.sort);
    entry.sort = !entry.sort || entry.sort.column !== column ? { column, dir: "asc" } : entry.sort.dir === "asc" ? { column, dir: "desc" } : undefined;
    // Another order puts other rows on every page: the table is shown from its first page, as after a search or a filter.
    entry.page = 0;
    updateTable(entry);
    focusOn(`[data-sort="${column}"]`);
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
  const chooser = target.closest("#colBtn");
  if (chooser && entry) {
    if (!popover.hidden && popOwner === "#colBtn") closePopover();
    else openColChooser(entry, chooser);
    return;
  }

  const pager = target.closest<HTMLButtonElement>(".pg-btn[data-page]");
  if (pager && !pager.disabled && entry) {
    // Previous, Next or a page's number, by the name the pager gives each: the page's number is the current page after this.
    const name = pager.getAttribute("aria-label") ?? "";
    entry.page = parseInt(pager.dataset.page ?? "", 10);
    updateTable(entry);
    focusOn(`.pg-btn[aria-label="${name}"]`, '.pg-btn[aria-current="true"]');
    return;
  }

  // A click anywhere else on a row opens it too. The row's own button is what the focus goes back to afterwards.
  const tr = target.closest("#tableWrap tbody tr");
  if (tr && !target.closest("button, a, input, label, select")) {
    const from = rowFor(tr);
    if (from) openRowDrawer(from.entry, from.row, tr.querySelector('[data-act="row"]') ?? tr);
  }
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
  if (event.key === "Escape") {
    if (!el("popover").hidden) {
      closePopover(true);
      return;
    }
    if (el("drawer").classList.contains("show")) {
      closeDrawer();
      return;
    }
    if (el("sidenav").classList.contains("open")) {
      closeNav(true);
      el("scrim").hidden = true;
    }
    return;
  }
  if (event.key === "/" && currentEntry() && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName ?? "")) {
    event.preventDefault();
    find("#tblSearch")?.focus();
  }
});
el("drawerClose").addEventListener("click", closeDrawer);
// A click beside what is open closes it: the navigation of a narrow window, or the drawer.
el("scrim").addEventListener("click", () => {
  if (el("sidenav").classList.contains("open")) closeNav(true);
  else closeDrawer();
});
el("navToggle").addEventListener("click", () => {
  if (el("sidenav").classList.contains("open")) closeNav(true);
  else openNav();
});
el("themeToggle").addEventListener("click", toggleTheme);
el("dlAll").addEventListener("click", () => {
  if (!result) return;
  const name = downloadName(result.zipName, ".zip", ZIP_FALLBACK);
  downloadFile(name, resultZip(result, received), "application/zip");
  toast(`Downloaded ${name}`);
});
el("dlCsv").addEventListener("click", () => {
  const table = currentTable();
  if (!table) return;
  const name = downloadName(table.file, ".csv", CSV_FALLBACK);
  downloadFile(name, tableCsv(table), "text/csv;charset=utf-8");
  toast(`Downloaded ${name}`);
});
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

el("version").textContent = `v${VERSION}`;
applyTheme(currentTheme());
const tabId = tabIdFrom(location.search);
const client = new ResultsClient({
  connect: tabId === undefined ? undefined : () => chrome.tabs.connect(tabId, { name: PORT_NAME }),
  autoRun: openedByIcon(),
  closeReason: () => chrome.runtime.lastError?.message,
  onState: next => (next.phase === "done" ? showResult(next.result, next.received) : showRun(next)),
  onLog: showLog,
});
client.start();
