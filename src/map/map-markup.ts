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

/** What access drivers are, said where they are switched, in a modeller's words. */
export const ACCESS_SAYS = "Read and Write Access Drivers are line items that decide which cells of a module or line item someone can see or edit (Anaplan's dynamic cell access). Tick to draw an arrow from each driver to what it controls.";
/** What the links of formulas are, said beside the switch of the others: they are always drawn. */
export const FORMULAS_SAY = "Always drawn. An arrow from A to B: B reads A.";
/** What a line on the map means. */
export const LINK_SAYS = "An arrow from A to B: B reads A.";
/** Why a box beside a module's line items can be marked as part of a trace with no coloured link leading to it: there
 * the trace follows the model from line item to line item (map-trace.ts), and draws only the links of this module. */
export const BESIDE_SAYS = "Among a module's line items, a box that stands for another module can carry a sign without a coloured link: it feeds the line item selected, or is fed by it, by way of line items that are not on this map.";

/** The names the view gives the elements that others point at. */
export interface ShellIds { results: string; hints: string; legend: string; about: string; access: string; links: string; picker: string }

/** The chevron of a select, which draws its own (map.css `.map-select-wrap`): the one the results page's menus have. */
const SELECT_CHEVRON = '<svg class="map-select-chevron" width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6l4 4 4-4"/></svg>';
/** The same chevron after a button's words, as a menu's button has it. */
const BUTTON_CHEVRON = '<svg class="map-btn-chevron" width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6l4 4 4-4"/></svg>';
/** The full screen button's two faces: four corners going out, to fill the screen, and coming in, to leave it. */
const FULL_ICON = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10"/></svg>';
const LEAVE_FULL_ICON = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 2.5V6H2.5M13.5 6H10V2.5M10 13.5V10h3.5M2.5 10H6v3.5"/></svg>';
/** What the full screen button says it does, by whether the map fills the screen. */
export const FULL_SAYS = { enter: "Full screen", leave: "Exit full screen" } as const;
/** The full screen button's face, by whether the map fills the screen now. */
export const fullIconHtml = (whole: boolean): string => (whole ? LEAVE_FULL_ICON : FULL_ICON);

/** Everything the map puts into its element, empty of the model but for its name: the view fills the parts as it goes.
 * The canvas comes first, under the panels; then one bar, the details of the box selected, and what stands over the
 * canvas itself.
 *
 * The bar has three parts, each of which stays on one line: where a line is too short for all three, a part takes the
 * next line whole, never half of it.
 * - Where the map is, which is also how to go elsewhere: the view's switch, then the path from the model's name. In the
 *   Modules view the path's list says what is shown: the groups, all modules, or one group. In the Line items view it
 *   names the module's group, which narrows the module picker after it, and the module, picked by typing.
 * - How the map is built: how the modules are grouped, or whether the line items of other modules stand one by one.
 * - Its tools: which links are drawn, the search, and full screen.
 *
 * Over the canvas: at its foot on the left the
 * line that says what is shown, and over that line the legend and the notes about the map, both closed until asked
 * for; at its foot on the right the small picture with the zoom.
 * The canvas is a picture to a screen reader, with a name, and the keys' list is its description. The notes can be
 * longer than the map is high: they scroll, and take the focus so that the keyboard scrolls them too. */
export function shellHtml(ids: ShellIds, modelName: string): string {
  return `<canvas class="map-canvas" role="img" tabindex="0" aria-label="Map of ${esc(modelName)}: its sections, modules and line items, and what feeds what. Search and the details panel reach every box." aria-describedby="${esc(ids.hints)}"></canvas>
<div class="map-chrome">
  <div class="map-panel map-bar">
    <div class="map-zone map-zone-path">
      <div class="map-tabs" role="group" aria-label="What the map shows">
        <button type="button" class="map-tab" data-map-act="view" data-map-view="modules" aria-pressed="true">Modules</button>
        <button type="button" class="map-tab" data-map-act="view" data-map-view="drill" aria-pressed="false">Line items</button>
      </div>
      <nav class="map-crumbs" aria-label="Where the map is">
        <span class="map-path-root"><h2 class="map-title-name map-here" aria-current="location">${esc(modelName)}</h2></span>
        <span class="map-sep" data-map-sep="show" aria-hidden="true">›</span>
        <span class="map-select-wrap"><select class="map-select map-show-select" aria-label="Show"></select>${SELECT_CHEVRON}</span>
        <span class="map-sep" data-map-sep="group" aria-hidden="true" hidden>›</span>
        <span class="map-select-wrap"><select class="map-select map-group-select" aria-label="Group" hidden></select>${SELECT_CHEVRON}</span>
        <span class="map-sep" data-map-sep="module" aria-hidden="true" hidden>›</span>
        <span class="map-picker" hidden>
          <input class="map-picker-input" type="text" role="combobox" aria-label="Module" aria-autocomplete="list" aria-expanded="false" aria-controls="${esc(ids.picker)}" autocomplete="off" spellcheck="false">${SELECT_CHEVRON}
          <div class="map-panel map-picker-pop" hidden><div class="map-picker-list" id="${esc(ids.picker)}" role="listbox" aria-label="Modules"></div><p class="map-picker-note" hidden></p></div>
        </span>
      </nav>
    </div>
    <div class="map-zone map-zone-build">
      <label class="map-field map-grouping-field" hidden><span class="map-field-label">Group by</span><span class="map-select-wrap"><select class="map-select map-grouping-select" aria-label="Group by"></select>${SELECT_CHEVRON}</span></label>
      <label class="map-check map-external-check" hidden><input type="checkbox" class="map-external">Other modules' line items</label>
    </div>
    <div class="map-zone map-zone-tools">
      <div class="map-links">
        <button type="button" class="map-btn map-links-btn" data-map-act="links" aria-expanded="false" aria-controls="${esc(ids.links)}">Links${BUTTON_CHEVRON}</button>
        <div class="map-panel map-links-pop" id="${esc(ids.links)}" role="group" aria-label="Links on the map" hidden>
          <h3 class="map-about-title">Links on the map</h3>
          <div class="map-links-row"><span class="map-links-tick" aria-hidden="true">✓</span><span><b>Formulas</b></span></div>
          <p class="map-links-note">${esc(FORMULAS_SAY)}</p>
          <label class="map-check map-links-row"><input type="checkbox" class="map-access" aria-describedby="${esc(ids.access)}"><b>Access drivers</b></label>
          <p class="map-links-note" id="${esc(ids.access)}">${esc(ACCESS_SAYS)}</p>
        </div>
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
      <button type="button" class="map-btn map-icon map-full-btn" data-map-act="fullscreen" aria-pressed="false" aria-label="${FULL_SAYS.enter}" title="${FULL_SAYS.enter}">${FULL_ICON}</button>
    </div>
  </div>
  <aside class="map-panel map-inspector" aria-label="Details of the box selected" hidden></aside>
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
      <button type="button" class="map-btn map-dock-btn" data-map-act="legend" aria-expanded="false" aria-controls="${esc(ids.legend)}">Legend</button>
      <button type="button" class="map-btn map-dock-btn" data-map-act="about" aria-expanded="false" aria-controls="${esc(ids.about)}">About this map</button>
      <div class="map-panel map-tracebar" hidden></div>
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
 * own sentences say it, with how many names matched no object, or more than one. `headings` is how many heading rows
 * stand among the model's modules: the page's Modules table counts each as a row, and the map counts none as a module,
 * so the two numbers differ by them, and the notes say why. */
export function notesHtml(model: { name: string; workspace?: string; modules: number; lineItems: number; headings?: number }, limitations: readonly string[], unresolved: number): string {
  const lines = [...limitations, ...(unresolved > 0 ? [`${formatCount(unresolved)} ${unresolved === 1 ? "name" : "names"} in the export matched no object, or more than one. A box's details list its own.`] : [])];
  const { modules, lineItems, headings = 0 } = model;
  const where = model.workspace !== undefined && model.workspace.trim() !== "" ? `, in the workspace ${esc(model.workspace)}` : "";
  const rows = headings <= 0 ? "" : `<p class="map-about-line">${esc(formatCount(headings))} heading ${headings === 1 ? "row stands" : "rows stand"} among the modules. The map counts ${headings === 1 ? "it" : "them"} as no module, and the page's Modules table counts ${headings === 1 ? "it as a row" : "each as a row"}: that table has more rows than the map has modules.</p>`;
  return `<h3 class="map-about-title">This model</h3><p class="map-about-line">${esc(model.name)}${where}: ${esc(formatCount(modules))} ${modules === 1 ? "module" : "modules"} · ${esc(formatCount(lineItems))} ${lineItems === 1 ? "line item" : "line items"}</p>${rows}${leftOutHtml(lines)}`;
}

/** The first step of the path: the model's name, which is the map's heading. Where the map shows the model whole it says
 * so; anywhere else it leads back there. The page's header names the workspace, so the path does not: the name says it on
 * hover, where the page gives one. */
export function pathRootHtml(model: string, workspace: string | undefined, whole: boolean): string {
  const said = workspace !== undefined && workspace.trim() !== "" ? `${model} (workspace: ${workspace})` : model;
  return whole
    ? `<h2 class="map-title-name map-here" aria-current="location" title="${esc(said)}">${esc(model)}</h2>`
    : `<h2 class="map-title-name"><button type="button" class="map-crumb" data-map-act="crumb" data-map-crumb="root" title="${esc(said)}">${esc(model)}</button></h2>`;
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

/** What the first button of the trace's bar does, in full: its face is short, for the bar to keep to one row. */
const ONLY_SAYS = "Show only these boxes";
const ALL_SAYS = "Show all boxes";

/** The bar that says what is traced, as the picture runs, from left to right: how many boxes feed the node, the node,
 * and how many it feeds. Each side has its colour and the sign its boxes carry on the canvas. Its first button keeps
 * the picture to those boxes, and shows all of them again: `focused` says which the picture does now. */
export function tracebarHtml(name: string, words: TraceWords, focused: boolean): string {
  return `<span class="map-trace-count map-trace-up">${SIGN}${esc(words.feeds)}</span>
    <span class="map-trace-name" title="${esc(name)}">${esc(name)}</span>
    <span class="map-trace-count map-trace-down">${SIGN}${esc(words.fed)}</span>
    <span class="map-trace-acts"><button type="button" class="map-btn map-small" data-map-act="focus" aria-label="${focused ? ALL_SAYS : ONLY_SAYS}" title="${focused ? ALL_SAYS : ONLY_SAYS}">${focused ? "All boxes" : "Only these"}</button>
    <button type="button" class="map-btn map-small" data-map-act="clear" aria-label="Clear the selection" title="Clear the selection">Clear</button></span>`;
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
 * and what it feeds directly, and its notes. */
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
  return `<div class="map-insp-head"><span class="map-kind">${dot(inspection.layer)}${esc(inspection.kind)}</span><button type="button" class="map-icon-btn" data-map-act="close" aria-label="Close details" title="Close details">${CLOSE_ICON}</button></div>
    <h3 class="map-insp-name" tabindex="-1">${esc(inspection.name)}</h3>${traced}${button}${formula}${rows}${lists}${texts}${notes}`;
}

/** What a map that stopped after a failure says in its own place: that it could not be drawn, the failure's own words
 * where it has any, and that the result is whole. It speaks at once to a screen reader, and can take the focus that
 * was in the map. */
export function brokenHtml(reason: string): string {
  const why = reason.trim() === "" ? "" : ` (${esc(reason)})`;
  return `<div class="map-broken" role="alert" tabindex="-1"><h2 class="map-empty-title">The map could not be drawn</h2><p class="map-empty-text">Drawing it failed${why}, and the map has stopped. The tables of this result are not affected.</p></div>`;
}

/** The choices of how to group the modules: each grouping the model has, by its kind (map-groups.ts), in the switch's
 * order, under the label "Group by". The one the map picks by itself says so. */
export function groupingOptionsHtml(groupings: readonly { kind: string; label: string }[], automatic: string | undefined): string {
  return groupings.map(grouping => `<option value="${esc(grouping.kind)}">${esc(grouping.label)}${grouping.kind === automatic ? " · automatic" : ""}</option>`).join("");
}

/** The values of the Show list that are no group's place. */
export const SHOW_GROUPS = "groups";
export const SHOW_MODULES = "modules";

/** Each group by its place among the model's groups, with how many modules it holds. */
const groupChoices = (groups: readonly string[], counts: readonly number[]): string => groups.map((group, index) => {
  const count = counts[index] ?? 0;
  return `<option value="${index}">${esc(group)} · ${esc(formatCount(count))} ${count === 1 ? "module" : "modules"}</option>`;
}).join("");

/** The choices of the path's Show list in the Modules view: the groups as a whole, every module, or one group. */
export function showOptionsHtml(groups: readonly string[], counts: readonly number[]): string {
  return `<option value="${SHOW_GROUPS}">All groups</option><option value="${SHOW_MODULES}">All modules</option>${groupChoices(groups, counts)}`;
}

/** The choices of the path's group list in the Line items view, which narrows the module picker: every group, or one. */
export function groupOptionsHtml(groups: readonly string[], counts: readonly number[]): string {
  return `<option value="">All groups</option>${groupChoices(groups, counts)}`;
}

/** The module picker's list: each module it offers, known by its place in the list, with its group where the list holds
 * more than one group's. The one the arrows are on is chosen. */
export function pickerOptionsHtml(listId: string, modules: readonly { name: string; group?: string }[], active: number): string {
  return modules.map((module, index) => `<div class="map-picker-opt${index === active ? " map-active" : ""}" role="option" id="${esc(listId)}-${index}" aria-selected="${index === active ? "true" : "false"}" data-map-pick="${index}"><span class="map-picker-name">${esc(module.name)}</span>${
    module.group === undefined ? "" : `<small>${esc(module.group)}</small>`}</div>`).join("");
}

/** What stands in the middle of a map with nothing to draw: what is missing, in the map's own words, and under it what
 * the graph says it could not hold, listed as the notes about the map list it. The list can be longer than the map is
 * high: the box scrolls, and takes the focus so that the keyboard scrolls it too. */
export function emptyHtml(title: string, text: string, leftOut: readonly string[] = []): string {
  return `<div class="map-panel map-empty-box" role="group" aria-label="${esc(title)}" tabindex="0"><h3 class="map-empty-title">${esc(title)}</h3><p class="map-empty-text">${esc(text)}</p>${leftOutHtml(leftOut)}</div>`;
}
