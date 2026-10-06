import type { ViewLayer } from "./map-graphs.js";
import type { InspectLink, InspectList, Inspection, TraceWords } from "./map-inspect.js";
import { layerClass } from "./map-palette.js";
import type { SearchOutcome } from "./map-search.js";
import { formatCount } from "./map-text.js";

/** The model map's markup: each function turns data into the HTML text the view then shows inside its own element.
 * Every name, note and formula of a model was typed by an Anaplan user, so every value that comes from the graph goes
 * through `esc`, in text and inside attributes alike, and none is ever written as a tag, an attribute name, a class, a
 * style or an address. What a click means is read from what the view holds, never back out of the markup: the data
 * attributes carry only numbers and names the view made itself. A colour is a class of the stylesheet's (map.css);
 * nothing here writes a style. Every element and class is the map's own, with the prefix "map-". */

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" };
/** A value as text that cannot end the text or the quoted attribute it is written into. */
export const esc = (value: unknown): string => String(value ?? "").replace(/[&<>"']/g, char => ESCAPES[char]);

const CLOSE_ICON = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M3 3l10 10M13 3 3 13"/></svg>';
const SEARCH_ICON = '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><circle cx="7" cy="7" r="4.6"/><path d="M10.6 10.6 14 14"/></svg>';
const dot = (layer: string): string => `<span class="map-dot ${layerClass(layer)}" aria-hidden="true"></span>`;
/** The sign a box of a trace carries, beside the words that say which side it is on: the same mark the canvas draws on
 * the box's edge (map-canvas.ts), so that the two sides are told apart by more than their colours. */
const SIGN = '<svg class="map-sign" width="9" height="10" viewBox="0 0 9 10" aria-hidden="true"><path d="M1 1l7 4-7 4z" fill="currentColor"/></svg>';

/** How many links of a list the details write at first. A list a thousand formulas name stays quick to open. */
export const LIST_CAP = 100;

/** What Access drivers does, said where it is switched. */
export const ACCESS_SAYS = "Also draws a link from each read access driver and write access driver to what it controls.";
/** What a line on the map means. */
export const LINK_SAYS = "An arrow from A to B: B reads A.";
/** Why a box beside a module's line items can be marked as part of a trace with no coloured link leading to it: there
 * the trace follows the model from line item to line item (map-trace.ts), and draws only the links of this module. */
export const BESIDE_SAYS = "Among a module's line items, a box that stands for another module can carry a sign without a coloured link: it feeds the line item selected, or is fed by it, by way of line items that are not on this map.";

/** The names the view gives the elements that others point at. */
export interface ShellIds { results: string; hints: string; legend: string; about: string; access: string }

/** Everything the map puts into its element, empty of the model but for its name: the view fills the parts as it goes.
 * The canvas comes first, under the panels; then one bar (the view's switch, where the map is, the view's controls and
 * the search), the details of the node selected, and what stands over the canvas itself: at its foot on the left the
 * line that says what is shown, and over that line the legend and the notes about the map, both closed until asked
 * for; at its foot on the right the small picture with the zoom.
 * The canvas is a picture to a screen reader, with a name, and the keys' list is its description. The notes can be
 * longer than the map is high: they scroll, and take the focus so that the keyboard scrolls them too. */
export function shellHtml(ids: ShellIds, modelName: string): string {
  return `<canvas class="map-canvas" role="img" tabindex="0" aria-label="Map of ${esc(modelName)}: its sections, modules and line items, and what feeds what. Search and the details panel reach every box." aria-describedby="${esc(ids.hints)}"></canvas>
<div class="map-chrome">
  <div class="map-panel map-bar">
    <div class="map-tabs" role="group" aria-label="What the map shows">
      <button type="button" class="map-tab" data-map-act="view" data-map-view="modules" aria-pressed="true">Modules</button>
      <button type="button" class="map-tab" data-map-act="view" data-map-view="drill" aria-pressed="false">Line items</button>
    </div>
    <nav class="map-crumbs" aria-label="Map breadcrumb"></nav>
    <div class="map-controls" role="group" aria-label="Map controls">
      <button type="button" class="map-btn" data-map-act="group">Show all modules</button>
      <select class="map-select map-section-select" aria-label="Model section"></select>
      <select class="map-select map-module-select" aria-label="Module for line items" hidden></select>
      <button type="button" class="map-btn" data-map-act="external" hidden>Expand external items</button>
      <label class="map-check" title="${esc(ACCESS_SAYS)}"><input type="checkbox" class="map-access" aria-describedby="${esc(ids.access)}">Access drivers</label>
      <span class="map-sr-only" id="${esc(ids.access)}">${esc(ACCESS_SAYS)}</span>
    </div>
    <div class="map-searchwrap">
      <div class="map-searchbox">
        ${SEARCH_ICON}
        <input class="map-search" type="search" placeholder="Search the model…" aria-label="Search all sections, modules and line items" aria-controls="${esc(ids.results)}" autocomplete="off" spellcheck="false">
        <span class="map-search-count" aria-hidden="true"></span>
        <kbd title="Press / to search">/</kbd>
      </div>
      <div class="map-panel map-results" id="${esc(ids.results)}" role="group" aria-label="Search results" hidden></div>
    </div>
  </div>
  <aside class="map-panel map-inspector" aria-label="Selected node details" hidden></aside>
  <div class="map-free">
    <div class="map-foot">
    <div class="map-over">
    <div class="map-panel map-legend" id="${esc(ids.legend)}" role="group" aria-label="Legend: shows and hides layers" hidden></div>
    <div class="map-panel map-about" id="${esc(ids.about)}" role="group" aria-label="About this map" tabindex="0" hidden>
      <div class="map-notes"></div>
      <h3 class="map-about-title">How to read the map</h3>
      <p class="map-about-line">${esc(LINK_SAYS)} Click a box to see everything that feeds it and everything it feeds: ${SIGN} at a box's right edge means it feeds the box selected, ${SIGN} at its left edge means the box selected feeds it.</p>
      <p class="map-about-line">${esc(BESIDE_SAYS)}</p>
      <h3 class="map-about-title">Mouse and keys</h3>
      <p class="map-hints" id="${esc(ids.hints)}">
        <b>Click</b> a box: what feeds it and what it feeds · <b>Double-click</b>: open it<br>
        <b>Drag</b> the background to move, a box to move the box · <b>Scroll</b> to zoom<br>
        <b>Esc</b> back · <b>F</b> whole map · <b>/</b> search · <b>+</b> <b>−</b> zoom<br>
        <b>Arrows</b> next box · <b>Enter</b> open it
      </p>
    </div>
    </div>
    <div class="map-dock">
      <div class="map-panel map-status"><span class="map-stats"></span><button type="button" class="map-btn map-small" data-map-act="whole" hidden>Whole map</button></div>
      <div class="map-panel map-tracebar" hidden></div>
      <button type="button" class="map-btn map-dock-btn" data-map-act="legend" aria-expanded="false" aria-controls="${esc(ids.legend)}">Legend</button>
      <button type="button" class="map-btn map-dock-btn" data-map-act="about" aria-expanded="false" aria-controls="${esc(ids.about)}">About this map</button>
    </div>
    </div>
    <div class="map-corner">
      <div class="map-zoom" role="group" aria-label="Zoom">
        <button type="button" class="map-btn map-icon" data-map-act="zoom-out" aria-label="Zoom out" title="Zoom out (-)">−</button>
        <button type="button" class="map-btn map-icon" data-map-act="zoom-in" aria-label="Zoom in" title="Zoom in (+)">+</button>
        <button type="button" class="map-btn" data-map-act="fit" title="Fit the whole map (F)">Fit</button>
      </div>
      <div class="map-panel map-minimap-wrap"><canvas class="map-minimap" width="196" height="128" aria-hidden="true"></canvas></div>
    </div>
    <div class="map-empty" hidden></div>
  </div>
</div>
<div class="map-tooltip" aria-hidden="true"></div>
<p class="map-sr-only map-live" aria-live="polite"></p>`;
}

/** What the map leaves out, under its heading: the graph's own sentences, one to a line however many there are.
 * Nothing for none. */
function leftOutHtml(lines: readonly string[]): string {
  if (!lines.length) return "";
  return `<h3 class="map-about-title">What this map leaves out · ${esc(formatCount(lines.length))}</h3><ul class="map-lines">${lines.map(line => `<li>${esc(line)}</li>`).join("")}</ul>`;
}

/** What the notes about the map say of this model: how large it is, and what the graph could not hold, as the export's
 * own sentences say it, with how many names matched no object, or more than one. */
export function notesHtml(model: { name: string; workspace?: string; modules: number; lineItems: number }, limitations: readonly string[], unresolved: number): string {
  const lines = [...limitations, ...(unresolved > 0 ? [`${formatCount(unresolved)} ${unresolved === 1 ? "name" : "names"} in the export matched no object, or more than one. A box's details list its own.`] : [])];
  const { modules, lineItems } = model;
  const where = model.workspace !== undefined && model.workspace.trim() !== "" ? `, in the workspace ${esc(model.workspace)}` : "";
  return `<h3 class="map-about-title">This model</h3><p class="map-about-line">${esc(model.name)}${where}: ${esc(formatCount(modules))} ${modules === 1 ? "module" : "modules"} · ${esc(formatCount(lineItems))} ${lineItems === 1 ? "line item" : "line items"}</p>${leftOutHtml(lines)}`;
}

/** Where the map is: the workspace where the page names it, the model, and under it the section or the module on
 * screen. The model's name is the map's heading; it leads back to the model's sections from anywhere else, and in a
 * module's graph its section leads to that section's modules. */
export interface Crumbs {
  model: string;
  workspace?: string;
  /** The section named between the model and the module, with its place among the model's sections. */
  section?: { index: number; name: string };
  /** What is on screen under the model; nothing where the map shows the model whole. */
  here?: string;
}

export function crumbsHtml(crumbs: Crumbs): string {
  const sep = '<span class="map-sep" aria-hidden="true">›</span>';
  const parts: string[] = [];
  // The workspace and the mark after it are one piece: where there is no room for the workspace, both go. It says how
  // much stands after it, for the stylesheet: before the model alone it has the most room (`map-crumb-ws-alone`), and
  // before a model, a section and a module the least (`map-crumb-ws-deep`, map.css).
  const named = crumbs.workspace !== undefined && crumbs.workspace.trim() !== "";
  const depth = crumbs.here === undefined ? " map-crumb-ws-alone" : crumbs.section ? " map-crumb-ws-deep" : "";
  const workspace = named ? `<span class="map-crumb-ws${depth}" title="Workspace: ${esc(crumbs.workspace)}"><span class="map-crumb-ws-name">${esc(crumbs.workspace)}</span>${sep}</span>` : "";
  // The model's name says its workspace on hover too: a narrow bar has no room to write it.
  const said = named ? `${crumbs.model} (workspace: ${crumbs.workspace})` : crumbs.model;
  parts.push(crumbs.here === undefined
    ? `<h2 class="map-title-name map-here" aria-current="location" title="${esc(said)}">${esc(crumbs.model)}</h2>`
    : `<h2 class="map-title-name"><button type="button" class="map-crumb" data-map-act="crumb" data-map-crumb="root" title="${esc(said)}">${esc(crumbs.model)}</button></h2>`);
  if (crumbs.here !== undefined) {
    if (crumbs.section) parts.push(`<button type="button" class="map-crumb" data-map-act="crumb" data-map-crumb="section" data-map-section="${esc(crumbs.section.index)}" title="${esc(crumbs.section.name)}">${esc(crumbs.section.name)}</button>`);
    parts.push(`<span class="map-here" aria-current="location" title="${esc(crumbs.here)}">${esc(crumbs.here)}</span>`);
  }
  return `${workspace}${parts.join(sep)}`;
}

/** The legend: each layer of the graph on screen with its colour and its number, as a button that hides the layer and
 * shows it again, and under them what a line means. A hidden layer says so in more than its colour: its name is
 * struck through, and the button is not pressed. */
export function legendHtml(title: string, layers: readonly ViewLayer[], hidden: ReadonlySet<string>): string {
  return `<div class="map-legend-title">${esc(title)}</div>${layers.map(layer => {
    const off = hidden.has(layer.key);
    return `<button type="button" class="map-legend-item${off ? " map-off" : ""}" data-map-act="layer" data-map-layer="${esc(layer.key)}" aria-pressed="${off ? "false" : "true"}">${dot(layer.key)}<span class="map-legend-name">${esc(layer.label)}</span><span class="map-legend-count">${esc(formatCount(layer.count))}</span></button>`;
  }).join("")}<p class="map-legend-note">${esc(LINK_SAYS)}</p>`;
}

/** The bar that says what is traced, as the picture runs, from left to right: how many boxes feed the node, the node,
 * and how many it feeds. Each side has its colour and the sign its boxes carry on the canvas. `focused` says the view
 * keeps to the trace. */
export function tracebarHtml(name: string, words: TraceWords, focused: boolean): string {
  return `<span class="map-trace-count map-trace-up">${SIGN}${esc(words.feeds)}</span>
    <span class="map-trace-name" title="${esc(name)}">${esc(name)}</span>
    <span class="map-trace-count map-trace-down">${SIGN}${esc(words.fed)}</span>
    <button type="button" class="map-btn map-small" data-map-act="focus">${focused ? "Show full graph" : "Focus trace"}</button>
    <button type="button" class="map-btn map-small" data-map-act="clear">Clear</button>`;
}

export interface Tip { layer: string; kind: string; name: string; lines: readonly string[]; formula?: string }
/** How much of a formula the tooltip shows. */
export const TIP_FORMULA = 350;

export function tooltipHtml(tip: Tip): string {
  const formula = tip.formula === undefined || tip.formula === "" ? "" : `<div class="map-tip-formula">${esc(tip.formula.slice(0, TIP_FORMULA))}${tip.formula.length > TIP_FORMULA ? "…" : ""}</div>`;
  const lines = tip.lines.filter(line => line !== "");
  return `<div class="map-tip-kind">${dot(tip.layer)}${esc(tip.kind)}</div><div class="map-tip-name">${esc(tip.name)}</div>${lines.length ? `<div class="map-tip-meta">${lines.map(esc).join("<br>")}</div>` : ""}${formula}`;
}

/** The search's results: a button for each hit, known by its place in the list, and a line when there are more than are
 * listed or none at all. */
export function resultsHtml(outcome: SearchOutcome): string {
  if (!outcome.hits.length) return '<p class="map-results-note">No matching sections, modules or line items.</p>';
  const more = outcome.total > outcome.hits.length ? `<p class="map-results-note">First ${esc(formatCount(outcome.hits.length))} of ${esc(formatCount(outcome.total))} matches. Keep typing to narrow.</p>` : "";
  return `${outcome.hits.map((hit, index) => `<button type="button" class="map-result" data-map-act="result" data-map-hit="${index}"><span>${esc(hit.name)}</span><small>${esc(hit.context)}</small></button>`).join("")}${more}`;
}

const linkHtml = (link: InspectLink): string => {
  const target = link.raw !== undefined ? `data-map-act="raw" data-map-raw="${esc(link.raw)}"` : `data-map-act="node" data-map-node="${esc(link.node)}"`;
  const under = [link.sub, link.caption].filter((text): text is string => text !== undefined && text !== "").map(text => `<small>${esc(text)}</small>`).join("");
  return `<button type="button" class="map-link" ${target}>${dot(link.layer)}<span class="map-link-text">${esc(link.name)}${under}</span></button>`;
};

/** What stands inside one of the details' lists: its heading and its links, the first `LIST_CAP` of them unless `all`,
 * with a button that lists the rest. */
export function listHtml(list: InspectList, all: boolean): string {
  const shown = all ? list.links : list.links.slice(0, LIST_CAP);
  const more = shown.length < list.links.length ? `<button type="button" class="map-more" data-map-act="more" data-map-list="${esc(list.key)}">Show all ${esc(formatCount(list.links.length))}</button>` : "";
  return `<summary>${esc(list.title)}</summary>${shown.map(linkHtml).join("")}${more}`;
}

/** The details of the node selected, in the order a modeller asks: what it is and its name, what the trace found, the
 * button that goes into it, its formula, its settings under the names of the Line Items table's columns, what feeds it
 * and what it feeds directly, and the file and row it comes from. */
export function inspectorHtml(inspection: Inspection, trace?: TraceWords): string {
  const rows = inspection.rows.length ? `<dl class="map-dl">${inspection.rows.map(([label, value]) => `<dt>${esc(label)}</dt><dd>${esc(value)}</dd>`).join("")}</dl>` : "";
  const action = inspection.action;
  const button = !action ? "" : `<button type="button" class="map-primary" data-map-act="open"${action.section === undefined ? "" : ` data-map-section="${esc(action.section)}"`}${
    action.module === undefined ? "" : ` data-map-module="${esc(action.module)}"`}${action.select === undefined ? "" : ` data-map-select="${esc(action.select)}"`}>${esc(action.label)} →</button>`;
  const formula = inspection.formula !== undefined ? `<h4 class="map-insp-sec">Formula</h4><pre class="map-formula">${esc(inspection.formula)}</pre>`
    : inspection.remark !== undefined ? `<p class="map-insp-note">${esc(inspection.remark)}</p>` : "";
  const traced = !trace ? "" : `<p class="map-insp-trace">On the map, directly or through others: <span class="map-trace-up">${SIGN}${esc(trace.feeds)}</span>, <span class="map-trace-down">${SIGN}${esc(trace.fed)}</span>.</p>`;
  const lists = inspection.lists.map(list => `<details class="map-details" data-map-list="${esc(list.key)}"${list.open ? " open" : ""}>${listHtml(list, false)}</details>`).join("");
  const texts = inspection.texts.map(text => `<details class="map-details"><summary>${esc(text.title)}</summary><ul class="map-lines">${text.lines.map(line => `<li>${esc(line)}</li>`).join("")}</ul></details>`).join("");
  const notes = inspection.notes === undefined ? "" : `<h4 class="map-insp-sec">Notes</h4><p class="map-insp-note">${esc(inspection.notes)}</p>`;
  const source = inspection.source === undefined ? "" : `<div class="map-source">${esc(inspection.source)}</div>`;
  return `<div class="map-insp-head"><span class="map-kind">${dot(inspection.layer)}${esc(inspection.kind)}</span><button type="button" class="map-icon-btn" data-map-act="close" aria-label="Close details" title="Close details">${CLOSE_ICON}</button></div>
    <h3 class="map-insp-name" tabindex="-1">${esc(inspection.name)}</h3>${traced}${button}${formula}${rows}${lists}${texts}${notes}${source}`;
}

/** What a map that stopped after a failure says in its own place: that it could not be drawn, the failure's own words
 * where it has any, and that the result is whole. It speaks at once to a screen reader, and can take the focus that
 * was in the map. */
export function brokenHtml(reason: string): string {
  const why = reason.trim() === "" ? "" : ` (${esc(reason)})`;
  return `<div class="map-broken" role="alert" tabindex="-1"><h2 class="map-empty-title">The map could not be drawn</h2><p class="map-empty-text">Drawing it failed${why}, and the map has stopped. The tables of this result are not affected.</p></div>`;
}

/** The choices of the section list: every section by its place, after the choice of all of them. */
export function sectionOptionsHtml(sections: readonly string[]): string {
  return `<option value="">All sections</option>${sections.map((section, index) => `<option value="${index}">${esc(section)}</option>`).join("")}`;
}

/** The choices of the module list: every module by its number. */
export function moduleOptionsHtml(modules: readonly { id: number; name: string }[]): string {
  return modules.map(module => `<option value="${esc(module.id)}">${esc(module.name)}</option>`).join("");
}

/** What stands in the middle of a map with nothing to draw: what is missing, in the map's own words, and under it what
 * the graph says it could not hold, listed as the notes about the map list it. The list can be longer than the map is
 * high: the box scrolls, and takes the focus so that the keyboard scrolls it too. */
export function emptyHtml(title: string, text: string, leftOut: readonly string[] = []): string {
  return `<div class="map-panel map-empty-box" role="group" aria-label="${esc(title)}" tabindex="0"><h3 class="map-empty-title">${esc(title)}</h3><p class="map-empty-text">${esc(text)}</p>${leftOutHtml(leftOut)}</div>`;
}
