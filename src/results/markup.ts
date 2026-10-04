import { rowColumns, type Column } from "./columns.js";
import type { Analysed, CardSection, Overview } from "./result-view.js";
import { cellText, NONE, pagerItems, type Row, type Sort } from "./table-engine.js";

/** The results page's markup, as the design writes it: each function turns data into the HTML text the page then shows.
 * Every string of a result was typed by an Anaplan user (card titles, text cards, names, formulas), so every value that
 * comes from a result goes through `esc`, in text and inside attributes alike, and no value is ever written as a tag, an
 * attribute name, a style or an address. What a click means is read from the row the page holds, never back out of the
 * markup: the only data attributes that carry a value hold a number the page counted itself, or an ID to copy. */

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
 * focus, which the Tab key gives it. The section's heading stands inside it; the stylesheet has no rule for a heading
 * there yet, so it takes the summary's look. */
const sectionSummary = (title: string): string => `<summary>${CARET}<h2 style="font:inherit">${title}</h2></summary>`;
/** The button that copies a diagnostic log. The messages of a failed run name it by these words (progress.ts). `act` says
 * which log: "copy-diag" the one a result carries, "copy-run-log" the one of the run the page is following or last followed. */
const copyLogButton = (act: "copy-diag" | "copy-run-log", attributes = ""): string => `<button type="button" class="btn sm" data-act="${act}"${attributes}>
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5.5" y="5.5" width="8" height="8" rx="2"/><path d="M10.5 5.5v-2a2 2 0 0 0-2-2h-5a2 2 0 0 0-2 2v5a2 2 0 0 0 2 2h2"/></svg>
          Copy diagnostic log</button>`;

/* ---------- cells ---------- */

/** An ID as a pill that copies it when clicked. */
export function idPill(id: unknown): string {
  const text = cellText(id);
  if (text === "") return "";
  if (text === NONE) return DASH;
  return `<button type="button" class="id-pill" data-copy="${esc(text)}" title="Copy ${esc(text)}" aria-label="Copy ID ${esc(text)}">${esc(text)}</button>`;
}

const plain = (text: string): string => `<span class="cell-t" title="${esc(text)}">${esc(text)}</span>`;

/** What a row's cells may link to: its page's cards and its card's details. Both need the result's Cards file and the
 * row's own Page or Card ID column. */
export interface Links { page: boolean; card: boolean }

/** One cell: always the cell's own text, shown the way its column is shown. An empty cell stays empty. `whole` is for the
 * drawer, where a value is read in full: there its text stands in a `cell-t` whatever the column's kind, and that is the
 * element in which the stylesheet keeps a value's line breaks and spaces (an ID is a pill, which it shows uncut). */
export function cellHtml(column: Column, row: Row, links: Links, whole = false): string {
  const text = cellText(row[column.index]);
  if (text === "") return "";
  if (text === NONE) return DASH;
  const shown = whole ? `<span class="cell-t">${esc(text)}</span>` : esc(text);
  switch (column.kind) {
    case "id":
      return idPill(text);
    case "tag":
      return `<span class="tag">${shown}</span>`;
    case "page":
      return links.page ? `<button type="button" class="link" data-act="page" title="Show cards on ${esc(text)}">${shown}</button>` : plain(text);
    case "card":
      return links.card ? `<button type="button" class="link" data-act="card" title="Open card details">${shown}</button>` : plain(text);
    default:
      return plain(text);
  }
}

const ROW_ICON = '<svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 3l6 5-6 5"/></svg>';

/** The first cell of a row on screen, which also opens the row, so that a row can be read in full from the keyboard: the
 * cell's content is a button. A cell that is already a link or an ID to copy keeps that, and a cell without text has
 * nothing to make a button of: there a small button stands before the cell's own content. */
export function rowCellHtml(column: Column, row: Row, links: Links): string {
  const text = cellText(row[column.index]);
  const own = cellHtml(column, row, links);
  const control = text !== NONE && (column.kind === "id" || (column.kind === "page" && links.page) || (column.kind === "card" && links.card));
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

export interface NavEntry { id: string; label: string; count?: number }

/** The navigation: one entry for each view, in the order given. `map` adds the model map as the last entry, which is for
 * a model only and still to come: it is listed, off, and says so. */
export function navHtml(entries: readonly NavEntry[], current: string, map: boolean): string {
  const items = entries.map(entry => {
    const cur = entry.id === current ? ' aria-current="page"' : "";
    const cnt = entry.count === undefined ? "" : `<span class="cnt">${esc(entry.count)}</span>`;
    return `<button type="button" class="nav-item" data-nav="${esc(entry.id)}"${cur}><span>${esc(entry.label)}</span>${cnt}</button>`;
  });
  if (map) {
    items.push(`<button type="button" class="nav-item disabled" aria-disabled="true" data-nav="map" title="Model map is coming in a later version">
    <span>Model map</span><span class="soon">coming soon</span></button>`);
  }
  return items.join("");
}

/** The breadcrumb: the overview alone, or the view under it with the page a jump keeps. */
export function crumbsHtml(label: string | undefined, context: string | undefined): string {
  if (label === undefined) return '<span aria-current="page"><strong>Overview</strong></span>';
  const crumbs = [
    '<button type="button" data-nav="overview">Overview</button>',
    '<span class="sep" aria-hidden="true">/</span>',
    `<span aria-current="page"><strong>${esc(label)}</strong></span>`,
  ];
  if (context !== undefined) {
    crumbs.push('<span class="sep" aria-hidden="true">/</span>');
    crumbs.push(`<span class="ctx">Page: ${esc(context)}
        <button type="button" data-act="clear-context" aria-label="Clear page filter">
          ${CLOSE_ICON}
        </button></span>`);
  }
  return crumbs.join("");
}

/* ---------- overview ---------- */

/** Details beside their values, as the design's details list holds them. */
const detailRows = (rows: readonly (readonly [detail: string, value: string])[]): string => rows.map(([detail, value]) => `<dt>${esc(detail)}</dt><dd>${esc(value)}</dd>`).join("");

/** The overview: everything about the run in one view. Under the tiles, what someone checks first: what was read and when,
 * then the notes, and for an app its cards by type and its models. After those, what is looked up now and then: files
 * that say more than their tile, and two sections that start closed, how to read the files and the diagnostic log.
 *
 * A view's heading is the page's h1, so what stands under it is an h2, also inside a section that starts closed. The
 * drawer's heading is an h2 of the page shell, and its sections are h3. No view goes from one level to one two below it. */
export function overviewHtml(overview: Overview): string {
  const most = overview.cardTypes.reduce((max, [, count]) => Math.max(max, count), 1);
  const types = overview.cardTypes.length ? `
      <section class="panel" aria-labelledby="ovt"><h2 id="ovt">Cards by type</h2>
        <div class="typebars">
          ${overview.cardTypes.map(([type, count]) => `
            <div class="typebar"><span>${type === "" ? BLANK : esc(type)}</span>
              <span class="tb-track"><span class="tb-fill" style="display:block;width:${Math.round(count / most * 100)}%"></span></span>
              <span class="tb-n">${esc(count)}</span></div>`).join("")}
        </div>
      </section>` : "";
  const models = overview.models.length ? `
      <section class="panel" aria-labelledby="ovm"><h2 id="ovm">Models</h2>
        ${overview.models.map(model => `
          <div class="model-row">
            <div class="m-name">${esc(model.model)} ${idPill(model.modelId)}</div>
            <div class="m-sub">Workspace: ${esc(model.workspace)}</div>
          </div>`).join("")}
      </section>` : "";
  const about = overview.about.length ? `
    <div class="d-sec" id="ovAbout"><h2>About this export</h2>
      <dl class="dl">${detailRows(overview.about)}</dl></div>` : "";
  const files = overview.files.length ? `
    <div class="d-sec" id="ovFiles"><h2>Files</h2>
      <dl class="dl">${detailRows(overview.files)}</dl></div>` : "";
  const howToRead = overview.howToRead.length ? `
    <details class="diag" id="ovHowTo" style="margin-bottom:12px">
      ${sectionSummary("How to read these files")}
      <div class="diag-body"><dl class="dl" style="margin-bottom:0">${detailRows(overview.howToRead)}</dl></div>
    </details>` : "";
  // The button stands above the log, so that it is in sight as soon as the section is open, however long the log is.
  const log = overview.log.length ? `
    <details class="diag" id="ovLog">
      ${sectionSummary("Diagnostics")}
      <div class="diag-body">
        <div style="margin-bottom:10px">${copyLogButton("copy-diag")}</div>
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
      ${overview.tiles.map(tile => `<div class="stat"><div class="s-lab">${esc(tile.label)}</div><div class="s-num">${esc(tile.count)}</div><div class="s-sub">${tile.count === 1 ? "row" : "rows"}</div></div>`).join("")}
    </div>${about}${notes}${types || models ? `
    <div class="ov-cols">${types}${models}
    </div>` : ""}${files}${howToRead}${log}`;
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
      ${copyLogButton("copy-run-log", ' id="bannerCopy" style="margin-left:auto;flex:none" hidden')}</div>`;
}

/** A note of the page's own above a result: one line, and the button that copies the run's log for a note whose reason
 * is in that log. It holds no text: the page sets the line as plain text, and shows the button when there is a reason. */
export function noteBannerHtml(): string {
  return `<div class="banner note" id="noteBanner">${INFO_ICON}
      <div><span id="noteText"></span></div>
      ${copyLogButton("copy-run-log", ' id="noteCopy" style="margin-left:auto;flex:none" hidden')}</div>`;
}

/* ---------- table ---------- */

export interface TableView {
  label: string;
  /** A line under the table's name, for a table that does not list every row of its file. */
  note: string | undefined;
  /** The columns shown, in the table's order. */
  columns: readonly Column[];
  /** The rows of the page shown. */
  rows: readonly Row[];
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
  /** The page a jump from another table keeps. */
  context: string | undefined;
  links: Links;
}

export function pagerHtml(page: number, pages: number, total: number, pageSize: number): string {
  if (total === 0) return "";
  const numbers = pagerItems(page, pages).map(item => (item === undefined ? '<span aria-hidden="true">…</span>'
    : `<button type="button" class="pg-btn" data-page="${item}" ${item === page ? 'aria-current="true"' : ""} aria-label="Page ${item + 1}">${item + 1}</button>`));
  return `
    <button type="button" class="pg-btn" data-page="${page - 1}" ${page === 0 ? "disabled" : ""} aria-label="Previous page">‹</button>
    <span class="pages">${numbers.join("")}</span>
    <button type="button" class="pg-btn" data-page="${page + 1}" ${page >= pages - 1 ? "disabled" : ""} aria-label="Next page">›</button>
    <span style="margin-left:auto">Rows per page
      <select id="pageSize" aria-label="Rows per page">
        ${[25, 50, 100].map(size => `<option value="${size}" ${size === pageSize ? "selected" : ""}>${size}</option>`).join("")}
      </select></span>`;
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

export function tableParts(view: TableView): TableParts {
  const label = esc(view.label);
  const searching = view.search.trim() !== "";
  const filtering = view.filtered.size > 0;
  const jumped = view.context !== undefined;

  const head = view.columns.map(column => {
    const dir = view.sort?.column === column.index ? view.sort.dir : undefined;
    const aria = dir ? (dir === "asc" ? "ascending" : "descending") : "none";
    const arrow = `<span class="dir" aria-hidden="true">${dir ? (dir === "asc" ? "▲" : "▼") : ""}</span>`;
    const name = esc(column.label);
    // A filter in force shows in more than the button's colour: the funnel is filled, where it is otherwise an outline,
    // and the button's name says so. The page sets aria-expanded while the button's popover is open.
    const active = view.filtered.has(column.index);
    const says = `Filter by ${name}${active ? " (filter on)" : ""}`;
    const filter = column.filter ? `<button type="button" class="th-filter ${active ? "active" : ""}"
        data-colfilter="${column.index}" aria-label="${says}" aria-haspopup="dialog" aria-expanded="false" title="${says}">
        <svg width="11" height="11" viewBox="0 0 16 16" ${active ? 'fill="currentColor"' : 'fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"'} aria-hidden="true">${FILTER_PATH}</svg></button>` : "";
    return `<th scope="col" class="${column.num ? "num" : ""}" aria-sort="${aria}">
      <div class="th-in"><button type="button" class="th-sort" data-sort="${column.index}">${name}${arrow}</button>${filter}</div></th>`;
  }).join("");

  let body = "";
  let empty = "";
  if (view.all === 0) {
    empty = `<div class="empty">
      <svg width="30" height="30" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" aria-hidden="true">${FILTER_PATH}</svg>
      <div class="e-title">${label} has no rows</div>
      <div class="e-sub">Nothing was found for this table in this analysis.</div>
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
    body = view.rows.map(row => `<tr>${view.columns.map((column, position) =>
      `<td class="${column.num ? "num" : ""}">${position === 0 ? rowCellHtml(column, row, view.links) : cellHtml(column, row, view.links)}</td>`).join("")}</tr>`).join("");
  }

  return {
    grid: `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
      ${empty}
      <div class="scroll-fade" aria-hidden="true"></div>`,
    pager: pagerHtml(view.page, view.pages, view.total, view.pageSize),
    count: (view.total === 0 ? "No rows" : `${view.from}–${view.to} of ${view.total} ${view.total === 1 ? "row" : "rows"}`) + (view.total !== view.all ? ` (filtered from ${view.all})` : ""),
    modified: searching || filtering || jumped || view.sort !== undefined,
  };
}

/** A table view whole: its name, its toolbar, and the table's box under it, with the parts above in their places. The
 * toolbar holds the search box and the Columns and Reset buttons, and at its right end the count and then the pager, which
 * is its last child: nothing stands under the table. */
export function tableHtml(view: TableView): string {
  const label = esc(view.label);
  const parts = tableParts(view);
  // The line under the name has no style of its own in the stylesheet yet: it is written as the design's small muted text.
  const note = view.note === undefined ? "" : `
    <p class="view-note" style="font-size:12px;color:var(--text-2);margin:-6px 0 12px">${esc(view.note)}</p>`;
  return `
    <h1 class="view-title">${label}</h1>${note}
    <div class="toolbar">
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

/** A column's filter: each text the column holds with its number of rows, ticked when shown. The numbers count the rows
 * of the whole table, whatever the search, the other filters or a jump leave on screen, and a line above them says so. A
 * box is known by its place in the list, so no value is read back out of the page. */
export function colFilterHtml(column: Column, values: readonly (readonly [value: string, count: number])[], selected: ReadonlySet<string> | undefined): string {
  const checked = (value: string) => (!selected || selected.has(value) ? "checked" : "");
  return `
    <div class="pop-hd"><span>Filter: ${esc(column.label)}</span><button type="button" data-popact="all">Show all</button></div>
    ${values.length ? '<div class="pop-hd" aria-hidden="true"><span>Value</span><span>Rows in the whole table</span></div>' : ""}
    <div class="pop-bd">
      ${values.length ? values.map(([value, count], index) => `
        <label class="pop-opt"><input type="checkbox" data-fval="${index}" ${checked(value)}>
        <span style="overflow:hidden;text-overflow:ellipsis">${value === "" ? BLANK : esc(value)}</span>
        <span class="po-cnt">${esc(count)}<span class="sr-only"> ${count === 1 ? "row" : "rows"} in the whole table</span></span></label>`).join("")
      : '<div class="pop-empty">No values</div>'}
    </div>`;
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

/** A row whole: every one of its cells, also those beyond the table's headers, each with its value in full. Nothing but
 * the value stands in a `dd`, so no space of the markup's own is kept with it. `exported` has, for each cell the table
 * says in words, the text the CSV holds in its place, by the column's place: that text follows the words, under the
 * column's name and "in the CSV", so that it is clear which of the two is which. */
const allColumns = (columns: readonly Column[], row: Row, links: Links, exported?: ReadonlyMap<number, unknown>): string =>
  `<dl class="d-dl">${rowColumns(columns, row).map(column => {
    const shown = `<dt>${esc(column.label)}</dt><dd>${cellHtml(column, row, links, true)}</dd>`;
    return exported?.has(column.index) ? `${shown}<dt>${esc(column.label)} in the CSV</dt><dd><span class="cell-t">${esc(exported.get(column.index))}</span></dd>` : shown;
  }).join("")}</dl>`;

/** One row in full: every column, hidden ones included, with nothing cut short, and the CSV's text for each cell that is
 * said in words (`exported`). */
export function rowDrawerHtml(columns: readonly Column[], row: Row, links: Links, exported?: ReadonlyMap<number, unknown>): string {
  return `<div class="d-sec"><h3>All columns</h3>
    ${allColumns(columns, row, links, exported)}</div>`;
}

/** Under a row's name in the drawer: which row of which table it is. `position` is the row's place in the file, from 1. */
export function rowDrawerSubHtml(position: number, label: string): string {
  return `Row ${esc(position)} of ${esc(label)}`;
}

/** Under a card's name in the drawer: its page (a jump to that page's cards), its type and its ID. */
export function cardDrawerSubHtml(page: string, type: string, cardId: string): string {
  return `<button type="button" class="link" data-act="page">${esc(page)}</button> · ${esc(type)} · ${idPill(cardId)}`;
}

/** A card in full: its row of the Cards file, then the rows of the other files that carry its Card ID. */
export function cardDrawerHtml(columns: readonly Column[], row: Row, links: Links, sections: readonly CardSection[]): string {
  return `
    <div class="d-sec"><h3>Card details</h3>
      ${allColumns(columns, row, links)}</div>
    ${sections.map(section => `<div class="d-sec"><h3>${esc(section.title)} (${section.rows.length})</h3>
      ${section.rows.length ? `<table class="mini"><thead><tr>${section.headings.map(heading => `<th>${esc(heading)}</th>`).join("")}</tr></thead>
        <tbody>${section.rows.map(cells => `<tr>${cells.map(cell => `<td>${esc(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table>`
      : `<p style="font-size:12px;color:var(--text-3);margin:4px 0 0">No ${esc(section.none)} on this card.</p>`}</div>`).join("")}`;
}
