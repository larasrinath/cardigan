import { PORT_NAME } from "../protocol.js";
import type { AnalysisResult, ResultTable } from "../result-types.js";
import { resultZip, tableCsv } from "../result-zip.js";
import { VERSION } from "../version.js";
import { cardsOf, columnIndex, columnsOf, rowKeys, type CardsTable, type Column, type RowKeys } from "./columns.js";
import { describeState, ResultsClient, tabIdFrom, type RunState } from "./connection.js";
import {
  bannersHtml, cardDrawerHtml, cardDrawerSubHtml, colChooserHtml, colFilterHtml, crumbsHtml, detailsHtml, esc, headerMetaHtml, MOON_ICON, navHtml,
  overviewHtml, rowDrawerHtml, runHtml, SUN_ICON, tableHtml, type Links, type NavEntry,
} from "./markup.js";
import type { PageId } from "./page-ids.js";
import { analysedOf, cardSections, detailSections, detailsOf, diagnosticLog, overviewOf, resultNotes } from "./result-view.js";
import { cellText, NONE, pageOf, rememberingSelect, valueCounts, type Row, type Sort, type TableQuery } from "./table-engine.js";

/** The results page (results.html): the design's script, on the real result. It connects to the Anaplan tab the address
 * names, lets the analysis run, shows its progress and then the result: an overview, one table per file, the details
 * and the downloads. The markup is built in markup.ts and the data work is done in the modules beside it; this file
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
/** One file of the result as the page shows it: its columns, and what the user chose for it. */
interface Shown {
  /** Its place in the result's tables, which is also its name in the navigation. */
  index: number;
  table: ResultTable;
  columns: Column[];
  keys: RowKeys;
  links: Links;
  /** Column -> the texts ticked in its filter; a column with every text ticked has no entry. */
  filters: Map<number, Set<string>>;
  hidden: Set<number>;
  sort: Sort | undefined;
  page: number;
}
type View = "overview" | "details" | number;

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
/** The file "Download this table" gives: the table shown, or the Details file on the details view. */
const currentTable = (): ResultTable | undefined => (state.view === "details" ? details : currentEntry()?.table);

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
/** The header's buttons follow what there is to act on. */
function updateActions(): void {
  const phase = client.state.phase;
  el<HTMLButtonElement>("runAgain").disabled = phase === "running" || phase === "no-tab";
  el<HTMLButtonElement>("dlAll").disabled = !result;
  const table = currentTable();
  const csv = el<HTMLButtonElement>("dlCsv");
  csv.disabled = !table;
  csv.title = table ? `Download ${cellText(table.file)}` : result ? "Open a table to download it" : "";
}

/* ================= views ================= */
function navEntries(): NavEntry[] {
  return [
    { id: "overview", label: "Overview" },
    ...[...shown.values()].map(entry => ({ id: String(entry.index), label: cellText(entry.table.label), count: entry.table.rows.length })),
    ...(details ? [{ id: "details", label: "Details" }] : []),
  ];
}

function query(entry: Shown): TableQuery {
  const column = entry.keys.page;
  return {
    search: state.search, filters: entry.filters, sort: entry.sort,
    context: state.context !== undefined && column !== undefined ? { column, value: state.context } : undefined,
  };
}

function renderTable(entry: Shown): void {
  const label = cellText(entry.table.label);
  const page = pageOf(select(entry.table.rows, query(entry)), entry.page, state.pageSize);
  entry.page = page.page;
  currentSlice = page.rows;
  el("view").innerHTML = tableHtml({
    label, columns: entry.columns.filter(column => !entry.hidden.has(column.index)), rows: page.rows,
    page: page.page, pages: page.pages, pageSize: state.pageSize, from: page.from, to: page.to, total: page.total, all: entry.table.rows.length,
    search: state.search, sort: entry.sort, filtered: new Set(entry.filters.keys()), context: state.context, links: entry.links,
  });
  const wrap = find("#tableWrap");
  if (wrap) {
    const updateFade = () => {
      wrap.classList.toggle("at-end", wrap.scrollTop + wrap.clientHeight >= wrap.scrollHeight - 6);
      wrap.classList.toggle("no-scroll", wrap.scrollHeight <= wrap.clientHeight + 2);
    };
    wrap.addEventListener("scroll", updateFade);
    updateFade();
  }
  const search = find<HTMLInputElement>("#tblSearch");
  if (search) search.selectionStart = search.selectionEnd = search.value.length;
  announce(`${label}: ${page.total} rows${state.context !== undefined ? `, filtered to ${state.context}` : ""}`);
}

function renderAll(): void {
  if (!result) return;
  const entry = currentEntry();
  if (!entry && state.view !== "details") state.view = "overview";
  el("navList").innerHTML = navHtml(navEntries(), String(state.view));
  el("crumbs").innerHTML = crumbsHtml(entry ? cellText(entry.table.label) : state.view === "details" ? "Details" : undefined, entry ? state.context : undefined);
  if (entry) renderTable(entry);
  else if (state.view === "details") el("view").innerHTML = detailsHtml(detailSections(details), diagnosticLog(details));
  else el("view").innerHTML = overviewHtml(overviewOf(result));
  updateActions();
}

/** A result arrived: the page becomes the design's results page for it. */
function showResult(next: AnalysisResult, at: Date): void {
  result = next;
  received = at;
  details = detailsOf(next);
  cards = cardsOf(next);
  shown = new Map();
  next.tables.forEach((table, index) => {
    if (table === details) return;
    const columns = columnsOf(table);
    const keys = rowKeys(table);
    const page = cards !== undefined && keys.page !== undefined;
    shown.set(index, {
      index, table, columns, keys, links: { page, card: page && keys.cardId !== undefined },
      filters: new Map(), hidden: defaultHidden(columns), sort: undefined, page: 0,
    });
  });
  state.view = "overview";
  state.search = "";
  state.context = undefined;
  const analysed = analysedOf(next);
  document.title = `Cardigan — ${analysed.name}`;
  el("hdMeta").innerHTML = headerMetaHtml(analysed);
  const notes = resultNotes(next);
  el("banners").innerHTML = bannersHtml(notes.summary, notes.notes);
  el("sidenav").hidden = false;
  el("navToggle").hidden = false;
  renderAll();
  announce(`Analysis finished: ${analysed.name}`);
}

/** Before there is a result: connecting, running, or why there is nothing to show. Every text is set as plain text. */
function showRun(runState: RunState): void {
  if (result || !find("#runStatus")) {
    result = undefined;
    details = undefined;
    cards = undefined;
    shown = new Map();
    // Nothing of the result that is being replaced is kept: not the rows on the page, the drawer's row or the last selection.
    currentSlice = [];
    drawerRow = undefined;
    select = rememberingSelect();
    closePopover();
    closeDrawer();
    document.title = "Cardigan";
    for (const id of ["hdMeta", "banners", "navList", "crumbs"] as const) el(id).innerHTML = "";
    el("sidenav").hidden = true;
    el("navToggle").hidden = true;
    el("view").innerHTML = runHtml();
  }
  const text = describeState(runState);
  const set = (selector: string, value: string) => {
    const node = find(selector);
    if (node) {
      node.textContent = value;
      node.hidden = value === "";
    }
  };
  set("#runTitle", text.title);
  set("#runStatus", text.message);
  set("#runHint", text.hint);
  showLog(client.log);
  updateActions();
  announce(text.message);
}

/** The run's diagnostic log while there is no result: its latest lines, kept in view. */
function showLog(lines: readonly string[]): void {
  const block = find("#runLog");
  const log = find("#diagLog");
  if (result || !block || !log) return;
  block.hidden = lines.length === 0;
  log.textContent = lines.slice(-200).join("\n");
  log.scrollTop = log.scrollHeight;
}

/* ================= popovers (column filter / column chooser) ================= */
let popAnchor: Element | null = null;
function closePopover(): void {
  const popover = el("popover");
  if (!popover.hidden) {
    popover.hidden = true;
    popover.innerHTML = "";
  }
  popAnchor = null;
}
function openPopover(anchor: Element, html: string): void {
  const popover = el("popover");
  popover.innerHTML = html;
  popover.hidden = false;
  popAnchor = anchor;
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
function openColFilter(entry: Shown, column: Column, anchor: Element): void {
  const values = valueCounts(entry.table.rows, column.index);
  openPopover(anchor, colFilterHtml(column, values, entry.filters.get(column.index)));
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
      renderTable(entry);
    });
  });
  popover.querySelector('[data-popact="all"]')?.addEventListener("click", () => {
    entry.filters.delete(column.index);
    entry.page = 0;
    closePopover();
    renderTable(entry);
  });
}
function openColChooser(entry: Shown, anchor: Element): void {
  openPopover(anchor, colChooserHtml(entry.columns, entry.hidden));
  const popover = el("popover");
  popover.querySelectorAll<HTMLInputElement>("input[data-col]").forEach(input => {
    input.addEventListener("change", () => {
      const column = Number(input.dataset.col);
      if (input.checked) entry.hidden.delete(column); else entry.hidden.add(column);
      renderTable(entry);
    });
  });
  popover.querySelector('[data-popact="defaults"]')?.addEventListener("click", () => {
    entry.hidden = defaultHidden(entry.columns);
    closePopover();
    renderTable(entry);
  });
}

/* ================= drawer ================= */
/** Hides the drawer once it has slid out. Opening it again first calls this off, so a drawer is never hidden while open. */
let drawerTimer: ReturnType<typeof setTimeout> | undefined;
/** The scrim goes once neither the drawer nor the narrow-screen navigation needs it. */
function settleScrim(): void {
  if (el("drawer").hidden && !el("sidenav").classList.contains("open")) el("scrim").hidden = true;
}
function openDrawer(title: string, subHtml: string, bodyHtml: string, opener?: Element | null): void {
  clearTimeout(drawerTimer);
  state.lastFocus = opener ?? document.activeElement;
  el("drawerTitle").textContent = title;
  el("drawerSub").innerHTML = subHtml;
  el("drawerBody").innerHTML = bodyHtml;
  const drawer = el("drawer");
  const scrim = el("scrim");
  drawer.hidden = false;
  scrim.hidden = false;
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
  el("sidenav").classList.remove("open");
  el("navToggle").setAttribute("aria-expanded", "false");
  clearTimeout(drawerTimer);
  drawerTimer = setTimeout(() => {
    drawer.hidden = true;
    settleScrim();
  }, 210);
  if (state.lastFocus instanceof HTMLElement && document.contains(state.lastFocus)) state.lastFocus.focus();
  state.lastFocus = null;
}
/** Any row, in full. */
function openRowDrawer(entry: Shown, row: Row, opener: Element): void {
  drawerRow = { entry, row };
  const position = entry.table.rows.findIndex(candidate => candidate === row) + 1;
  openDrawer(`Row ${position}`, esc(entry.table.label), rowDrawerHtml(entry.columns, row, entry.links), opener);
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
  state.view = view;
  state.search = "";
  state.context = context;
  renderAll();
  el("view").focus({ preventScroll: true });
  el("sidenav").classList.remove("open");
  el("navToggle").setAttribute("aria-expanded", "false");
  el("scrim").classList.remove("show");
  setTimeout(settleScrim, 210);
  window.scrollTo({ top: 0 });
}
/** The cards of one page: the Cards table, kept to that page. */
function gotoPage(page: string): void {
  const entry = cards && shown.get(cards.index);
  if (!entry) return;
  entry.page = 0;
  navTo(entry.index, page);
  closeDrawer();
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
      case "clear-context":
        state.context = undefined;
        if (entry) entry.page = 0;
        renderAll();
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
        return;
      case "clear-search":
        state.search = "";
        if (entry) {
          entry.page = 0;
          renderTable(entry);
          find("#tblSearch")?.focus();
        }
        return;
      case "copy-diag":
        void copyText((result ? diagnosticLog(details) : client.log).join("\n"), "the diagnostic log");
        return;
    }
  }

  const nav = target.closest<HTMLElement>("[data-nav]");
  if (nav) {
    if (nav.classList.contains("disabled")) {
      toast("Model map is coming in a later version");
      return;
    }
    const id = nav.dataset.nav ?? "";
    navTo(id === "overview" || id === "details" ? id : Number(id));
    return;
  }

  const sortButton = target.closest<HTMLElement>("[data-sort]");
  if (sortButton && entry) {
    const column = Number(sortButton.dataset.sort);
    entry.sort = !entry.sort || entry.sort.column !== column ? { column, dir: "asc" } : entry.sort.dir === "asc" ? { column, dir: "desc" } : undefined;
    renderTable(entry);
    return;
  }

  const filterButton = target.closest<HTMLElement>("[data-colfilter]");
  if (filterButton && entry) {
    const column = entry.columns[Number(filterButton.dataset.colfilter)];
    if ((!popover.hidden && popAnchor === filterButton) || !column) closePopover();
    else openColFilter(entry, column, filterButton);
    return;
  }
  const chooser = target.closest("#colBtn");
  if (chooser && entry) {
    if (!popover.hidden && popAnchor === chooser) closePopover();
    else openColChooser(entry, chooser);
    return;
  }

  const pager = target.closest<HTMLButtonElement>(".pg-btn[data-page]");
  if (pager && !pager.disabled && entry) {
    entry.page = parseInt(pager.dataset.page ?? "", 10);
    renderTable(entry);
    const wrap = find("#tableWrap");
    if (wrap) wrap.scrollTop = 0;
    return;
  }

  const tr = target.closest("#tableWrap tbody tr");
  if (tr && !target.closest("button, a, input, label, select")) {
    const from = rowFor(tr);
    if (from) openRowDrawer(from.entry, from.row, tr);
  }
});
document.addEventListener("input", event => {
  const entry = currentEntry();
  if (event.target instanceof HTMLInputElement && event.target.id === "tblSearch" && entry) {
    state.search = event.target.value;
    entry.page = 0;
    renderTable(entry);
    find("#tblSearch")?.focus();
  }
});
document.addEventListener("change", event => {
  const entry = currentEntry();
  if (event.target instanceof HTMLSelectElement && event.target.id === "pageSize" && entry) {
    state.pageSize = parseInt(event.target.value, 10) || 50;
    entry.page = 0;
    renderTable(entry);
  }
});
document.addEventListener("keydown", event => {
  if (event.key === "Escape") {
    if (!el("popover").hidden) {
      closePopover();
      return;
    }
    if (el("drawer").classList.contains("show")) {
      closeDrawer();
      return;
    }
    if (el("sidenav").classList.contains("open")) {
      el("sidenav").classList.remove("open");
      el("scrim").classList.remove("show");
      el("scrim").hidden = true;
      el("navToggle").setAttribute("aria-expanded", "false");
      el("navToggle").focus();
    }
    return;
  }
  if (event.key === "/" && currentEntry() && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName ?? "")) {
    event.preventDefault();
    find("#tblSearch")?.focus();
  }
});
el("drawerClose").addEventListener("click", closeDrawer);
el("scrim").addEventListener("click", closeDrawer);
el("navToggle").addEventListener("click", () => {
  const open = el("sidenav").classList.toggle("open");
  el("navToggle").setAttribute("aria-expanded", String(open));
  const scrim = el("scrim");
  if (open) {
    scrim.hidden = false;
    requestAnimationFrame(() => scrim.classList.add("show"));
  } else {
    scrim.classList.remove("show");
    setTimeout(settleScrim, 210);
  }
});
el("themeToggle").addEventListener("click", toggleTheme);
el("dlAll").addEventListener("click", () => {
  if (!result) return;
  const name = cellText(result.zipName) || "Cardigan export.zip";
  downloadFile(name, resultZip(result, received), "application/zip");
  toast(`Downloaded ${name}`);
});
el("dlCsv").addEventListener("click", () => {
  const table = currentTable();
  if (!table) return;
  const name = cellText(table.file) || "table.csv";
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
el("version").textContent = `v${VERSION}`;
applyTheme(currentTheme());
const tabId = tabIdFrom(location.search);
const client = new ResultsClient({
  connect: tabId === undefined ? undefined : () => chrome.tabs.connect(tabId, { name: PORT_NAME }),
  closeReason: () => chrome.runtime.lastError?.message,
  onState: next => (next.phase === "done" ? showResult(next.result, next.received) : showRun(next)),
  onLog: showLog,
});
client.start();
