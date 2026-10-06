import type { ViewLayer } from "./map-graphs.js";
import type { InspectLink, InspectList, Inspection } from "./map-inspect.js";
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

/** How many links of a list the inspector writes at first. A list a thousand formulas name stays quick to open. */
export const LIST_CAP = 100;

/** The names the view gives the elements that others point at. */
export interface ShellIds { results: string; hints: string }

/** Everything the map puts into its element, empty of the model but for its name: the view fills the parts as it goes.
 * The canvas comes first, under the panels; the panels follow in the order the Tab key takes them. The canvas is a
 * picture to a screen reader, with a name, and the hints say what the mouse and the keys do on it. */
export function shellHtml(ids: ShellIds, modelName: string, workspaceName: string | undefined): string {
  const workspace = workspaceName === undefined || workspaceName.trim() === "" ? undefined : workspaceName;
  return `<canvas class="map-canvas" role="img" tabindex="0" aria-label="Map of ${esc(modelName)}: its sections, modules and line items, and what feeds what. Search and the details panel reach every node." aria-describedby="${esc(ids.hints)}"></canvas>
<div class="map-chrome">
  <div class="map-panel map-title">
    <h2 class="map-title-name" title="${esc(modelName)}">${esc(modelName)}</h2>
    <div class="map-title-sub"${workspace === undefined ? "" : ` title="${esc(workspace)}"`}>${workspace === undefined ? "Model map" : `Workspace: ${esc(workspace)}`}</div>
    <div class="map-stats"></div>
    <details class="map-notes" hidden></details>
  </div>
  <div class="map-head">
    <div class="map-panel map-tabs" role="group" aria-label="What the map shows">
      <button type="button" class="map-tab" data-map-act="view" data-map-view="modules" aria-pressed="true">Modules</button>
      <button type="button" class="map-tab" data-map-act="view" data-map-view="drill" aria-pressed="false">Line items</button>
    </div>
    <nav class="map-panel map-crumbs" aria-label="Map breadcrumb"></nav>
  </div>
  <div class="map-panel map-controls" role="group" aria-label="Map controls">
    <button type="button" class="map-btn" data-map-act="group">Show all modules</button>
    <select class="map-select map-section-select" aria-label="Model section"></select>
    <select class="map-select map-module-select" aria-label="Module for line items" hidden></select>
    <button type="button" class="map-btn" data-map-act="external" hidden>Expand external items</button>
    <label class="map-check"><input type="checkbox" class="map-access">Access drivers</label>
    <button type="button" class="map-btn" data-map-act="focus" disabled>Focus trace</button>
    <button type="button" class="map-btn" data-map-act="fit" title="Fit the map (F)">Fit</button>
    <button type="button" class="map-btn map-icon" data-map-act="zoom-out" aria-label="Zoom out" title="Zoom out (-)">−</button>
    <button type="button" class="map-btn map-icon" data-map-act="zoom-in" aria-label="Zoom in" title="Zoom in (+)">+</button>
  </div>
  <div class="map-searchwrap">
    <div class="map-panel map-searchbox">
      ${SEARCH_ICON}
      <input class="map-search" type="search" placeholder="Search modules, line items…" aria-label="Search all sections, modules and line items" aria-controls="${esc(ids.results)}" autocomplete="off" spellcheck="false">
      <span class="map-search-count" aria-hidden="true"></span>
      <kbd title="Press / to search">/</kbd>
    </div>
    <div class="map-panel map-results" id="${esc(ids.results)}" role="group" aria-label="Search results" hidden></div>
  </div>
  <div class="map-right">
    <aside class="map-panel map-inspector" aria-label="Selected node details" hidden></aside>
    <div class="map-panel map-minimap-wrap"><canvas class="map-minimap" width="196" height="128" aria-hidden="true"></canvas></div>
  </div>
  <div class="map-left">
    <div class="map-panel map-legend" role="group" aria-label="Legend: shows and hides layers"></div>
    <div class="map-panel map-hints" id="${esc(ids.hints)}">
      <b>Click</b> trace · <b>Double-click</b> go in<br>
      <b>Drag</b> pan or move · <b>Scroll</b> zoom<br>
      <b>Esc</b> back · <b>F</b> fit · <b>/</b> search<br>
      <b>Arrows</b> next node · <b>Enter</b> go in
    </div>
  </div>
  <div class="map-panel map-tracebar" hidden></div>
  <div class="map-free"><div class="map-empty" hidden></div></div>
</div>
<div class="map-tooltip" aria-hidden="true"></div>
<p class="map-sr-only map-live" aria-live="polite"></p>`;
}

/** Under the model's name: how large the model is, and what the graph on screen holds. `shown` is that second line as
 * pairs of a count and what it counts. */
export function statsHtml(modules: number, lineItems: number, shown: readonly (readonly [count: number, what: string])[]): string {
  const part = ([count, what]: readonly [number, string]): string => `<b>${esc(formatCount(count))}</b> ${esc(what)}`;
  return `<div>${part([modules, modules === 1 ? "module" : "modules"])} · ${part([lineItems, lineItems === 1 ? "line item" : "line items"])}</div><div>${shown.map(part).join(" · ")}</div>`;
}

/** What the graph could not hold, as the export's own sentences say it, and how many names matched no object. Nothing
 * for a graph with neither. */
export function notesHtml(limitations: readonly string[], unresolved: number): string {
  const lines = [...limitations, ...(unresolved > 0 ? [`${formatCount(unresolved)} ${unresolved === 1 ? "name" : "names"} in the export matched no object. A node's details list its own.`] : [])];
  if (!lines.length) return "";
  return `<summary>What this map leaves out · ${esc(formatCount(lines.length))}</summary><ul>${lines.map(line => `<li>${esc(line)}</li>`).join("")}</ul>`;
}

/** Where the map is: the workspace where the page names it, the model, and under it the section or the module on
 * screen. The model leads back to its sections; in a module's graph its section leads to that section's modules. */
export interface Crumbs {
  model: string;
  workspace?: string;
  /** The section named between the model and the module, with its place among the model's sections. */
  section?: { index: number; name: string };
  /** What is on screen under the model; nothing at the model's sections. */
  here?: string;
}

export function crumbsHtml(crumbs: Crumbs): string {
  const sep = '<span class="map-sep" aria-hidden="true">›</span>';
  const parts: string[] = [];
  if (crumbs.workspace !== undefined && crumbs.workspace.trim() !== "") parts.push(`<span class="map-crumb-ws" title="${esc(crumbs.workspace)}">${esc(crumbs.workspace)}</span>`);
  parts.push(crumbs.here === undefined
    ? `<span class="map-here" aria-current="location" title="${esc(crumbs.model)}">${esc(crumbs.model)}</span>`
    : `<button type="button" class="map-crumb" data-map-act="crumb" data-map-crumb="root" title="${esc(crumbs.model)}">${esc(crumbs.model)}</button>`);
  if (crumbs.here !== undefined) {
    if (crumbs.section) parts.push(`<button type="button" class="map-crumb" data-map-act="crumb" data-map-crumb="section" data-map-section="${esc(crumbs.section.index)}" title="${esc(crumbs.section.name)}">${esc(crumbs.section.name)}</button>`);
    parts.push(`<span class="map-here" aria-current="location" title="${esc(crumbs.here)}">${esc(crumbs.here)}</span>`);
  }
  return parts.join(sep);
}

/** The legend: each layer of the graph on screen with its colour and its number of nodes, as a button that hides the
 * layer and shows it again. A hidden layer says so in more than its colour: its name is struck through, and the button
 * is not pressed. */
export function legendHtml(title: string, layers: readonly ViewLayer[], hidden: ReadonlySet<string>): string {
  return `<div class="map-legend-title">${esc(title)}</div>${layers.map(layer => {
    const off = hidden.has(layer.key);
    return `<button type="button" class="map-legend-item${off ? " map-off" : ""}" data-map-act="layer" data-map-layer="${esc(layer.key)}" aria-pressed="${off ? "false" : "true"}">${dot(layer.key)}<span class="map-legend-name">${esc(layer.label)}</span><span class="map-legend-count">${esc(formatCount(layer.count))}</span></button>`;
  }).join("")}`;
}

/** The bar that says what is traced: the node, and how many nodes on screen feed it and it feeds. The two words stand
 * in an element of their own: a narrow map shows the arrows and the counts alone, and a screen reader still reads the
 * words (map.css). */
export function tracebarHtml(name: string, up: number, down: number): string {
  return `<span class="map-trace-name" title="${esc(name)}">${esc(name)}</span>
    <span class="map-trace-count"><span class="map-swatch map-c-up" aria-hidden="true"></span>↑ ${esc(formatCount(up))}<span class="map-trace-word"> upstream</span></span>
    <span class="map-trace-count"><span class="map-swatch map-c-down" aria-hidden="true"></span>↓ ${esc(formatCount(down))}<span class="map-trace-word"> downstream</span></span>
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

/** What stands inside one of the inspector's lists: its heading and its links, the first `LIST_CAP` of them unless `all`,
 * with a button that lists the rest. */
export function listHtml(list: InspectList, all: boolean): string {
  const shown = all ? list.links : list.links.slice(0, LIST_CAP);
  const more = shown.length < list.links.length ? `<button type="button" class="map-more" data-map-act="more" data-map-list="${esc(list.key)}">Show all ${esc(formatCount(list.links.length))}</button>` : "";
  return `<summary>${esc(list.title)}</summary>${shown.map(linkHtml).join("")}${more}`;
}

/** The inspector of the node selected: what it is and its name, its details, the button that goes into it, its formula,
 * what it depends on and what uses it, and the file and row it comes from. */
export function inspectorHtml(inspection: Inspection): string {
  const rows = inspection.rows.length ? `<dl class="map-dl">${inspection.rows.map(([label, value]) => `<dt>${esc(label)}</dt><dd>${esc(value)}</dd>`).join("")}</dl>` : "";
  const action = inspection.action;
  const button = !action ? "" : `<button type="button" class="map-primary" data-map-act="open"${action.section === undefined ? "" : ` data-map-section="${esc(action.section)}"`}${
    action.module === undefined ? "" : ` data-map-module="${esc(action.module)}"`}${action.select === undefined ? "" : ` data-map-select="${esc(action.select)}"`}>${esc(action.label)} →</button>`;
  const formula = inspection.formula !== undefined ? `<h4 class="map-insp-sec">Formula</h4><pre class="map-formula">${esc(inspection.formula)}</pre>`
    : inspection.remark !== undefined ? `<p class="map-insp-note">${esc(inspection.remark)}</p>` : "";
  const lists = inspection.lists.map(list => `<details class="map-details" data-map-list="${esc(list.key)}"${list.open ? " open" : ""}>${listHtml(list, false)}</details>`).join("");
  const texts = inspection.texts.map(text => `<details class="map-details"><summary>${esc(text.title)}</summary><ul class="map-lines">${text.lines.map(line => `<li>${esc(line)}</li>`).join("")}</ul></details>`).join("");
  const notes = inspection.notes === undefined ? "" : `<p class="map-insp-note">${esc(inspection.notes)}</p>`;
  const source = inspection.source === undefined ? "" : `<div class="map-source">${esc(inspection.source)}</div>`;
  return `<div class="map-insp-head"><span class="map-kind">${dot(inspection.layer)}${esc(inspection.kind)}</span><button type="button" class="map-icon-btn" data-map-act="close" aria-label="Close details" title="Close details">${CLOSE_ICON}</button></div>
    <h3 class="map-insp-name" tabindex="-1">${esc(inspection.name)}</h3>${rows}${button}${formula}${lists}${texts}${notes}${source}
    <div class="map-tracekey"><span class="map-swatch map-c-up" aria-hidden="true"></span> upstream <span class="map-swatch map-c-down" aria-hidden="true"></span> downstream<br>Trace counts apply to the graph on screen.</div>`;
}

/** The choices of the section list: every section by its place, after the choice of all of them. */
export function sectionOptionsHtml(sections: readonly string[]): string {
  return `<option value="">All sections</option>${sections.map((section, index) => `<option value="${index}">${esc(section)}</option>`).join("")}`;
}

/** The choices of the module list: every module by its number. */
export function moduleOptionsHtml(modules: readonly { id: number; name: string }[]): string {
  return modules.map(module => `<option value="${esc(module.id)}">${esc(module.name)}</option>`).join("");
}

/** What stands in the middle of a map with nothing to draw. */
export function emptyHtml(title: string, text: string): string {
  return `<div class="map-empty-title">${esc(title)}</div><div class="map-empty-text">${esc(text)}</div>`;
}
