import type { Column } from "./columns.js";
import type { Analysed, CardSection, DetailSection, Overview } from "./result-view.js";
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
const CLOSE_ICON = '<svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 3l10 10M13 3 3 13"/></svg>';
const SEARCH_PATH = '<circle cx="7" cy="7" r="4.6"/><path d="M10.6 10.6 14 14"/>';
const FILTER_PATH = '<path d="M2 3h12l-4.6 5.2v4.3L6.6 14V8.2L2 3Z"/>';
const INFO_ICON = '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="8" cy="8" r="6.4"/><path d="M8 7.4v3.4M8 5v.2"/></svg>';
export const SUN_ICON = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="8" cy="8" r="3.2"/><path d="M8 1.5v1.8M8 12.7v1.8M1.5 8h1.8M12.7 8h1.8M3.4 3.4l1.3 1.3M11.3 11.3l1.3 1.3M12.6 3.4l-1.3 1.3M4.7 11.3l-1.3 1.3"/></svg>';
export const MOON_ICON = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M13.5 9.5A5.8 5.8 0 0 1 6.5 2.5 5.8 5.8 0 1 0 13.5 9.5Z"/></svg>';
const DIAGNOSTICS_SUMMARY = '<summary><svg class="car" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 3l6 5-6 5"/></svg>Diagnostics</summary>';
const COPY_LOG_BUTTON = `<button type="button" class="btn sm" data-act="copy-diag">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="5.5" y="5.5" width="8" height="8" rx="2"/><path d="M10.5 5.5v-2a2 2 0 0 0-2-2h-5a2 2 0 0 0-2 2v5a2 2 0 0 0 2 2h2"/></svg>
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

/** One cell: always the cell's own text, shown the way its column is shown. An empty cell stays empty. */
export function cellHtml(column: Column, row: Row, links: Links): string {
  const text = cellText(row[column.index]);
  if (text === "") return "";
  if (text === NONE) return DASH;
  switch (column.kind) {
    case "id":
      return idPill(text);
    case "tag":
      return `<span class="tag">${esc(text)}</span>`;
    case "page":
      return links.page ? `<button type="button" class="link" data-act="page" title="Show cards on ${esc(text)}">${esc(text)}</button>` : plain(text);
    case "card":
      return links.card ? `<button type="button" class="link" data-act="card" title="Open card details">${esc(text)}</button>` : plain(text);
    default:
      return plain(text);
  }
}

/* ---------- header, banners, navigation ---------- */

export function headerMetaHtml(analysed: Analysed): string {
  const parts = [esc(analysed.kind)];
  if (analysed.host) parts.push(`<span style="font-family:var(--mono);font-size:11px">${esc(analysed.host)}</span>`);
  if (analysed.exportedOn) parts.push(`Exported ${esc(analysed.exportedOn)}`);
  return `<div class="meta-app">${esc(analysed.name)}</div>
     <div class="meta-sub">${parts.join('<span class="dotsep">·</span>')}</div>`;
}

/** The result's notes: its summary lines in one banner, and the notes the summary does not already say in another. */
export function bannersHtml(summary: readonly string[], notes: readonly string[]): string {
  const banners: string[] = [];
  if (summary.length) banners.push(`<div class="banner note">${INFO_ICON}<div>${summary.map(esc).join(" · ")}</div></div>`);
  if (notes.length) banners.push(`<div class="banner note">${INFO_ICON}<div>${notes.map(note => `<div>${esc(note)}</div>`).join("")}</div></div>`);
  return banners.join("");
}

export interface NavEntry { id: string; label: string; count?: number }

export function navHtml(entries: readonly NavEntry[], current: string): string {
  const items = entries.map(entry => {
    const cur = entry.id === current ? ' aria-current="page"' : "";
    const cnt = entry.count === undefined ? "" : `<span class="cnt">${esc(entry.count)}</span>`;
    return `<button type="button" class="nav-item" data-nav="${esc(entry.id)}"${cur}><span>${esc(entry.label)}</span>${cnt}</button>`;
  });
  items.push(`<button type="button" class="nav-item disabled" aria-disabled="true" data-nav="map" title="Model map is coming in a later version">
    <span>Model map</span><span class="soon">coming soon</span></button>`);
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

export function overviewHtml(overview: Overview): string {
  const most = overview.cardTypes.reduce((max, [, count]) => Math.max(max, count), 1);
  const types = overview.cardTypes.length ? `
      <section class="panel" aria-labelledby="ovt"><h3 id="ovt">Cards by type</h3>
        <div class="typebars">
          ${overview.cardTypes.map(([type, count]) => `
            <div class="typebar"><span>${type === "" ? BLANK : esc(type)}</span>
              <span class="tb-track"><span class="tb-fill" style="display:block;width:${Math.round(count / most * 100)}%"></span></span>
              <span class="tb-n">${esc(count)}</span></div>`).join("")}
        </div>
      </section>` : "";
  const models = overview.models.length ? `
      <section class="panel" aria-labelledby="ovm"><h3 id="ovm">Models</h3>
        ${overview.models.map(model => `
          <div class="model-row">
            <div class="m-name">${esc(model.model)} ${idPill(model.modelId)}</div>
            <div class="m-sub">Workspace: ${esc(model.workspace)}</div>
          </div>`).join("")}
      </section>` : "";
  return `
    <h1 class="view-title">Overview</h1>
    <div class="ov-grid">
      ${overview.tiles.map(tile => `<div class="stat"><div class="s-lab">${esc(tile.label)}</div><div class="s-num">${esc(tile.count)}</div><div class="s-sub">${tile.count === 1 ? "row" : "rows"}</div></div>`).join("")}
    </div>${types || models ? `
    <div class="ov-cols">${types}${models}
    </div>` : ""}`;
}

/* ---------- details ---------- */

/** The Details file's rows under their sections, then the diagnostic log it carries. */
export function detailsHtml(sections: readonly DetailSection[], log: readonly string[]): string {
  return `
    <h1 class="view-title">Details</h1>
    ${sections.map(section => `<div class="d-sec"><h3>${esc(section.section)}</h3>
      <dl class="dl">${section.rows.map(([detail, value]) => `<dt>${esc(detail)}</dt><dd>${esc(value)}</dd>`).join("")}</dl></div>`).join("")}
    ${log.length ? `<details class="diag">
      ${DIAGNOSTICS_SUMMARY}
      <div class="diag-body">
        <pre id="diagLog" tabindex="0">${esc(log.join("\n"))}</pre>
        ${COPY_LOG_BUTTON}
      </div>
    </details>` : ""}`;
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
        <pre id="diagLog" tabindex="0"></pre>
        ${COPY_LOG_BUTTON}
      </div>
    </details>`;
}

/* ---------- table ---------- */

export interface TableView {
  label: string;
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

export function tableHtml(view: TableView): string {
  const label = esc(view.label);
  const searching = view.search.trim() !== "";
  const filtering = view.filtered.size > 0;
  const jumped = view.context !== undefined;
  const modified = searching || filtering || jumped || view.sort !== undefined;

  const head = view.columns.map(column => {
    const dir = view.sort?.column === column.index ? view.sort.dir : undefined;
    const aria = dir ? (dir === "asc" ? "ascending" : "descending") : "none";
    const arrow = `<span class="dir" aria-hidden="true">${dir ? (dir === "asc" ? "▲" : "▼") : ""}</span>`;
    const name = esc(column.label);
    const filter = column.filter ? `<button type="button" class="th-filter ${view.filtered.has(column.index) ? "active" : ""}"
        data-colfilter="${column.index}" aria-label="Filter by ${name}" aria-haspopup="dialog" title="Filter by ${name}">
        <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">${FILTER_PATH}</svg></button>` : "";
    return `<th scope="col" class="${column.num ? "num" : ""}" aria-sort="${aria}">
      <div class="th-in"><button type="button" class="th-sort" data-sort="${column.index}">${name}${arrow}</button>${filter}</div></th>`;
  }).join("");

  let body = "";
  let empty = "";
  if (view.all === 0) {
    empty = `<div class="empty">
      <svg width="30" height="30" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round">${FILTER_PATH}</svg>
      <div class="e-title">${label} has no rows</div>
      <div class="e-sub">Nothing was found for this file in this analysis.</div>
      </div>`;
  } else if (view.total === 0) {
    const what = [...(searching ? ["search"] : []), ...(filtering ? ["column filters"] : []), ...(jumped ? ["page selection"] : [])].join(" and ");
    empty = `<div class="empty">
      <svg width="30" height="30" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round">${SEARCH_PATH}</svg>
      <div class="e-title">No results</div>
      <div class="e-sub">Nothing in ${label} matches the current ${what}.</div>
      <button type="button" class="btn sm" data-act="reset">Clear search &amp; filters</button>
      </div>`;
  } else {
    body = view.rows.map(row => `<tr>${view.columns.map(column =>
      `<td class="${column.num ? "num" : ""}">${cellHtml(column, row, view.links)}</td>`).join("")}</tr>`).join("");
  }

  const count = `${view.from}–${view.to} of ${view.total} rows` + (view.total !== view.all ? ` (filtered from ${view.all})` : "");
  return `
    <h1 class="view-title">${label}</h1>
    <div class="toolbar">
      <div class="search-wrap ${view.search ? "has-value" : ""}">
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true">${SEARCH_PATH}</svg>
        <input id="tblSearch" type="search" value="${esc(view.search)}" placeholder="Search all columns…" aria-label="Search ${label}">
        <button type="button" class="search-clear" data-act="clear-search" aria-label="Clear search">
          ${CLOSE_ICON}</button>
        <kbd title="Press / to focus search">/</kbd>
      </div>
      <button type="button" class="btn sm" id="colBtn" aria-haspopup="dialog">
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11"/></svg>
        Columns</button>
      <button type="button" class="btn sm" data-act="reset" ${modified ? "" : "hidden"}>Reset</button>
      <span class="rowcount" id="rowCount">${count}</span>
    </div>
    <div class="table-wrap" id="tableWrap" tabindex="0" role="region" aria-label="${label} table">
      <table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
      ${empty}
      <div class="scroll-fade" aria-hidden="true"></div>
    </div>
    <div class="pager" id="pager">${pagerHtml(view.page, view.pages, view.total, view.pageSize)}</div>`;
}

/* ---------- popovers ---------- */

/** A column's filter: each text the column holds with its number of rows, ticked when shown. A box is known by its place
 * in the list, so no value is read back out of the page. */
export function colFilterHtml(column: Column, values: readonly (readonly [value: string, count: number])[], selected: ReadonlySet<string> | undefined): string {
  const checked = (value: string) => (!selected || selected.has(value) ? "checked" : "");
  return `
    <div class="pop-hd"><span>Filter: ${esc(column.label)}</span><button type="button" data-popact="all">Show all</button></div>
    <div class="pop-bd">
      ${values.length ? values.map(([value, count], index) => `
        <label class="pop-opt"><input type="checkbox" data-fval="${index}" ${checked(value)}>
        <span style="overflow:hidden;text-overflow:ellipsis">${value === "" ? BLANK : esc(value)}</span>
        <span class="po-cnt">${esc(count)}</span></label>`).join("")
      : '<div class="pop-empty">No values</div>'}
    </div>`;
}

export function colChooserHtml(columns: readonly Column[], hidden: ReadonlySet<number>): string {
  return `
    <div class="pop-hd"><span>Show / hide columns</span><button type="button" data-popact="defaults">Defaults</button></div>
    <div class="pop-bd">
      ${columns.map(column => `
        <label class="pop-opt"><input type="checkbox" data-col="${column.index}" ${hidden.has(column.index) ? "" : "checked"}>
        <span>${esc(column.label)}</span>${column.hidden ? '<span class="po-cnt">ID</span>' : ""}</label>`).join("")}
    </div>`;
}

/* ---------- drawer ---------- */

const allColumns = (columns: readonly Column[], row: Row, links: Links): string =>
  `<dl class="d-dl">${columns.map(column => `<dt>${esc(column.label)}</dt><dd>${cellHtml(column, row, links)}</dd>`).join("")}</dl>`;

/** One row in full: every column, hidden ones included, with nothing cut short. */
export function rowDrawerHtml(columns: readonly Column[], row: Row, links: Links): string {
  return `<div class="d-sec"><h3>All columns</h3>
    ${allColumns(columns, row, links)}</div>`;
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
