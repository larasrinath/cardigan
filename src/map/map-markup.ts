import type { MapOpen, ModelGraph } from "./graph-types.js";
import type { ViewGraph, ViewLayer } from "./map-graphs.js";
import type { InspectLink, InspectList, Inspection, TraceWords } from "./map-inspect.js";
import { layerClass } from "./map-palette.js";
import type { SearchOutcome } from "./map-search.js";
import { formatCount } from "./map-text.js";
import { KEY_PATH } from "./map-marks.js";

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
const openIcon = (label: MapOpen["label"]): string => `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" aria-hidden="true">${label === "Model"
  ? '<path d="M8 1.6 14 4.9v6.2L8 14.4 2 11.1V4.9Z"/><path d="M2 4.9 8 8.2l6-3.3M8 8.2v6.2"/>'
  : '<rect x="2" y="2" width="12" height="12" rx="1"/><path d="M2 6h12M2 10h12M6 2v12"/>'}</svg>`;
const SEARCH_ICON = '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><circle cx="7" cy="7" r="4.6"/><path d="M10.6 10.6 14 14"/></svg>';
const MINIMAP_ICON = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" aria-hidden="true"><rect x="1.5" y="2" width="13" height="12" rx="1.5"/><path d="M4 5h3v2H4zM9 9h3v2H9zM7 6h4v3"/><rect x="3" y="8.5" width="5" height="4" rx=".5"/></svg>';
const dot = (layer: string): string => `<span class="map-dot ${layerClass(layer)}" aria-hidden="true"></span>`;
/** The sign a box of a trace carries, beside the words that say which side it is on: the same mark the canvas draws on
 * the box's edge (map-canvas.ts), so that the two sides are told apart by more than their colours. */
const SIGN = '<svg class="map-sign" width="9" height="10" viewBox="0 0 9 10" aria-hidden="true"><path d="M1 1l7 4-7 4z" fill="currentColor"/></svg>';

/** How many links of a list the details write at first. A list a thousand formulas name stays quick to open. */
export const LIST_CAP = 100;

/** What access drivers are, said where they are switched, in a modeller's words. */
export const ACCESS_SAYS = "Read and Write Access Drivers are line items that decide which cells of a module or line item someone can see or edit (Anaplan's dynamic cell access). Tick to mark drivers with a key and draw an arrow from each driver to what it controls.";
export const ACCESS_NONE = "No Read or Write Access Drivers were found in this result.";
export const ACCESS_UNREAD = "Access drivers were not read in this result. Cardigan does not read them from Polaris models.";
export const ACCESS_UNMATCHED = "No access drivers could be matched to line items on the map. Each controlled box's details list its unmatched names.";
export function accessNote(graph: ModelGraph, links: boolean): string {
  if (links) return ACCESS_SAYS;
  if (graph.accessDriversRead === false) return ACCESS_UNREAD;
  if (graph.unresolved.some(entry => entry.field === "Read Access Driver" || entry.field === "Write Access Driver")) return ACCESS_UNMATCHED;
  return ACCESS_NONE;
}
/** What page filters are, said where their links are switched, in the same words: for a model whose filters are all
 * on modules other than their line items' own, which links show between modules, and among line items from each filter
 * line item to the line items it filters. */
export const FILTERS_SAY = "Boolean line items used as filters on the pages built on the model. Tick to draw an arrow from each filter line item to the line items it filters, and between their modules.";
/** The same, for a model whose filters are all on their line items' own modules: no link between modules can show
 * those, so the switch marks the modules, and among a module's line items draws the links. */
export const FILTERS_OWN_SAY = "Every filter on the pages built on this model is a line item of the module it filters. Tick to mark each such module with a funnel, and inside it to draw an arrow from each filter line item to the line items it filters.";
/** The same, for a model with filters of both kinds. */
export const FILTERS_BOTH_SAY = "Boolean line items used as filters on the pages built on the model. Tick to draw an arrow from each filter line item to the line items it filters, and between their modules. A module that its own line items filter gets a funnel.";
/** Said after what the switch shows, for a result whose Page Filters table does not say which line items a filter
 * filters, as one read before the table said so: its filters are drawn as before, to their modules. */
export const FILTERS_UNSAID = "This result does not say which line items each filter filters: run the model again to see them.";
/** Why the pages' filters cannot be shown, said in the switch's place, which is then off and not to be ticked: the result
 * has no Page Filters table; the table has no row; none of its rows has a line item of the map as its condition; or
 * those that have one name no module of the map as what they filter. `links` is said for a graph that does not say how
 * the table met the map (`ModelGraph.pageFilterCheck`). */
export const FILTERS_NONE = {
  table: "This result has no Page Filters table, so the map has no page filter links. Run the model again to read the pages built on it.",
  links: "None of the filters on the pages built on this model has one of its line items as its condition, so the map has no page filter links.",
  empty: "The pages built on this model have no filters, so the map has none to show.",
  unfound: (rows: number): string => (rows === 1
    ? "The Page Filters table has 1 filter, but its condition line item is no line item of the map, so the map has nothing to show for it. The run's diagnostic log names it."
    : `The Page Filters table has ${formatCount(rows)} filters, but none of their condition line items is a line item of the map, so the map has nothing to show for them. The run's diagnostic log names them.`),
  nowhere: "The filters on the pages built on this model name no module of the map as what they filter, so the map has nothing to show for them.",
} as const;

/** What the switch of the pages' filters says under it: what ticking it shows, by what the model has to show (its links
 * between modules, `links`, and its modules filtered by their own line items, `marks`), and for a result that does not
 * say which line items its filters filter, that running the model again shows them; or, where it has nothing, why. */
export function filtersNote(graph: Pick<ModelGraph, "pageFilterTable" | "pageFilterCheck">, links: boolean, marks: boolean): string {
  const check = graph.pageFilterCheck;
  const shows = links && marks ? FILTERS_BOTH_SAY : links ? FILTERS_SAY : marks ? FILTERS_OWN_SAY : undefined;
  if (shows) return check && !check.said ? `${shows} ${FILTERS_UNSAID}` : shows;
  if (!graph.pageFilterTable) return FILTERS_NONE.table;
  if (!check) return FILTERS_NONE.links;
  if (check.rows === 0) return FILTERS_NONE.empty;
  if (check.found === 0) return FILTERS_NONE.unfound(check.rows);
  return FILTERS_NONE.nowhere;
}
/** What a page filter's link looks like and means, by the kind of picture, said in the legend while those links are
 * drawn: among a module's line items it ends at a line item it filters, or at the module of others, as one link stands
 * for those; between modules and groups it stands for the filter of one module's grid. */
export const FILTER_LINK_SAYS: Readonly<Record<ViewGraph["kind"], string>> = {
  sections: "Dashed: a page filter, from the group of its line item to the group of a module it filters.",
  modules: "Dashed: a page filter, from the module of its line item to a module it filters.",
  drill: "Dashed: a page filter, from its line item to a line item it filters, or to the module of those.",
};
/** What a filter mark on a box means (map-canvas.ts `drawMarks`), by the kind of picture, said in the legend while
 * one is drawn. */
export const FILTER_MARK_SAYS: Readonly<Record<ViewGraph["kind"], string>> = {
  sections: "Filter mark: how many of the group's modules their own line items filter on pages.",
  modules: "Filter mark: how many of the module's own line items filter it on pages.",
  drill: "Filter mark: the line item filters itself on a page: the grid it filters shows it too, or does not say which line items it shows.",
};
/** A filter mark's funnel, as the canvas draws it (map-canvas.ts `funnel`). */
const FUNNEL = '<svg class="map-mark-funnel" width="9" height="9" viewBox="0 0 10 10" aria-hidden="true"><path d="M0 .8h10L6.2 5.2v3.4L3.8 10V5.2Z"/></svg>';
export const ACCESS_MARK_SAYS: Readonly<Record<ViewGraph["kind"], string>> = {
  sections: "Key mark: how many of the group's modules hold access drivers.",
  modules: "Key mark: how many of the module's line items are access drivers.",
  drill: "Key mark: the line item is a read or write access driver. On another module, how many of its line items are drivers.",
};
const KEY = `<svg width="14" height="8" viewBox="0 0 14 8" fill="currentColor" aria-hidden="true"><path d="${KEY_PATH}" fill-rule="evenodd"/></svg>`;
/** What the links of formulas are, said under their switch, which is ticked unless the viewer unticks it. */
export const FORMULAS_SAY = "An arrow from A to B: B reads A. Untick to see only access drivers and page filters.";
/** What a line on the map means. */
export const LINK_SAYS = "An arrow from A to B: B reads A.";
/** What an access driver's link means, said in the legend while the picture draws some. */
export const ACCESS_LINK_SAYS = "An arrow from an access driver to what it controls.";
/** What the legend says where the Links panel has no kind of link ticked. */
export const NO_LINKS_SAYS = "No links are drawn. Tick Formulas, Access drivers or Page filters under Links.";
/** Why a box beside a module's line items can be marked as part of a trace with no coloured link leading to it: there
 * the trace follows the model from line item to line item (map-trace.ts), and draws only the links of this module. */
export const BESIDE_SAYS = "Among a module's line items, a box that stands for another module can carry a sign without a coloured link: it feeds the line item selected, or is fed by it, by way of line items that are not on this map.";

/** The names the view gives the elements that others point at. */
export interface ShellIds { results: string; hints: string; legend: string; about: string; formulas: string; access: string; filters: string; links: string; picker: string }

/** The chevron of a select, which draws its own (map.css `.map-select-wrap`): the one the results page's menus have. */
/** What stands between two parts of the map's path: a chevron pointing on, drawn as the bar's other chevrons are. */
const PATH_CHEVRON = '<svg class="map-sep-chevron" width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 4l4 4-4 4"/></svg>';
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
 * The path takes its own line before its full names wrap.
 * - Where the map is: the model name goes to the top; Group by, Group and Module open their lists.
 * - Its tools: which links are drawn, the search, and full screen.
 *
 * One slim bar at the foot holds the status, Legend, About this map, zoom and the minimap toggle.
 * The panels float above it. The minimap starts hidden; its button keeps the tab's choice.
 * The canvas is a picture to a screen reader, with a name, and the keys' list is its description. The notes can be
 * longer than the map is high: they scroll, and take the focus so that the keyboard scrolls them too. */
export function shellHtml(ids: ShellIds, modelName: string): string {
  return `<canvas class="map-canvas" role="img" tabindex="0" aria-label="Map of ${esc(modelName)}: its groups, modules and line items, and what feeds what. Search and the details panel reach every box." aria-describedby="${esc(ids.hints)}"></canvas>
<div class="map-chrome">
  <div class="map-panel map-bar">
    <div class="map-zone map-zone-path">
      <nav class="map-crumbs" aria-label="Where the map is">
        <span class="map-path-root"></span>
        <span class="map-sep" aria-hidden="true">${PATH_CHEVRON}</span>
        <span class="map-grouping-field">
          <span class="map-picker map-grouping-picker">
            <button type="button" class="map-step" data-map-act="groupings" aria-label="Group by" aria-haspopup="listbox" aria-expanded="false" aria-controls="${esc(ids.picker)}-groupings"><span class="map-step-name map-grouping-name">Group by</span>${BUTTON_CHEVRON}</button>
            <div class="map-panel map-picker-pop map-grouping-pop" hidden>
              <div class="map-grouping-list" id="${esc(ids.picker)}-groupings" role="listbox" aria-label="Group by"></div>
            </div>
          </span>
          <span class="map-grouping-info">
            <button type="button" class="map-icon-btn" data-map-act="grouping-info" aria-label="Why this grouping" aria-expanded="false" aria-controls="${esc(ids.picker)}-reason" aria-describedby="${esc(ids.picker)}-reason"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><circle cx="8" cy="8" r="6.2"/><path d="M8 7v5M8 4v1"/></svg></button>
            <div class="map-panel map-grouping-reason" id="${esc(ids.picker)}-reason" role="note" tabindex="-1" hidden></div>
          </span>
        </span>
        <span class="map-sep" aria-hidden="true">${PATH_CHEVRON}</span>
        <span class="map-picker map-group-picker">
          <button type="button" class="map-step" data-map-act="groups" aria-label="Choose a group" aria-haspopup="listbox" aria-expanded="false" aria-controls="${esc(ids.picker)}-groups"><span class="map-step-name map-group-name">Group</span>${BUTTON_CHEVRON}</button>
          <div class="map-panel map-picker-pop map-group-pop" hidden>
            <div class="map-group-list" id="${esc(ids.picker)}-groups" role="listbox" aria-label="Groups"></div>
          </div>
        </span>
        <span class="map-sep" aria-hidden="true">${PATH_CHEVRON}</span>
        <span class="map-picker map-module-picker">
          <button type="button" class="map-step" data-map-act="modules" aria-label="Choose a module" aria-haspopup="listbox" aria-expanded="false" aria-controls="${esc(ids.picker)}"><span class="map-step-name map-module-name">Module</span>${BUTTON_CHEVRON}</button>
          <div class="map-panel map-picker-pop" id="${esc(ids.picker)}-pop" hidden>
            <input class="map-picker-input" type="text" role="combobox" aria-label="Find a module" placeholder="Find a module…" aria-autocomplete="list" aria-expanded="false" aria-controls="${esc(ids.picker)}" autocomplete="off" spellcheck="false">
            <div class="map-picker-list" id="${esc(ids.picker)}" role="listbox" aria-label="Modules"></div><p class="map-picker-note" hidden></p>
          </div>
        </span>
      </nav>
    </div>
    <div class="map-zone map-zone-tools">
      <div class="map-links">
        <button type="button" class="map-btn map-links-btn" data-map-act="links" aria-expanded="false" aria-controls="${esc(ids.links)}">Links${BUTTON_CHEVRON}</button>
        <div class="map-panel map-links-pop" id="${esc(ids.links)}" role="group" aria-label="Links on the map" hidden>
          <h3 class="map-about-title">Links on the map</h3>
          <label class="map-check map-links-row"><input type="checkbox" class="map-formulas" checked aria-describedby="${esc(ids.formulas)}"><b>Formulas</b></label>
          <p class="map-links-note" id="${esc(ids.formulas)}">${esc(FORMULAS_SAY)}</p>
          <label class="map-check map-links-row"><input type="checkbox" class="map-access" aria-describedby="${esc(ids.access)}"><b>Access drivers</b></label>
          <p class="map-links-note map-access-note" id="${esc(ids.access)}">${esc(ACCESS_SAYS)}</p>
          <label class="map-check map-links-row map-filters-row"><input type="checkbox" class="map-filters" aria-describedby="${esc(ids.filters)}"><b>Page filters</b></label>
          <p class="map-links-note map-filters-note" id="${esc(ids.filters)}">${esc(FILTERS_SAY)}</p>
          <label class="map-check map-links-row map-external-check" hidden><input type="checkbox" class="map-external">Other modules' line items</label>
        </div>
      </div>
      <div class="map-searchwrap">
        <div class="map-searchbox">
          ${SEARCH_ICON}
          <input class="map-search" type="search" placeholder="Search the model…" aria-label="Search all groups, modules and line items" aria-controls="${esc(ids.results)}" autocomplete="off" spellcheck="false" title="Search the model. Press / to jump here." aria-keyshortcuts="/">
          <span class="map-search-count" aria-hidden="true"></span>
        </div>
        <div class="map-panel map-results" id="${esc(ids.results)}" role="group" aria-label="Search results" hidden></div>
      </div>
      <button type="button" class="map-btn map-icon map-full-btn" data-map-act="fullscreen" aria-pressed="false" aria-label="${FULL_SAYS.enter}" title="${FULL_SAYS.enter}">${FULL_ICON}</button>
    </div>
  </div>
  <div class="map-selection">
    <aside class="map-panel map-inspector" aria-label="Details of the box selected" hidden></aside>
  </div>
  <div class="map-free">
    <div class="map-foot">
    <div class="map-dock">
      <div class="map-status"><span class="map-stats"></span></div>
      <button type="button" class="map-btn map-dock-btn" data-map-act="legend" aria-expanded="false" aria-controls="${esc(ids.legend)}">Legend</button>
      <button type="button" class="map-btn map-dock-btn" data-map-act="about" aria-expanded="false" aria-controls="${esc(ids.about)}">About this map</button>
      <div class="map-corner">
        <div class="map-zoom" role="group" aria-label="Zoom">
          <button type="button" class="map-btn map-icon" data-map-act="zoom-out" aria-label="Zoom out" title="Zoom out (-)">−</button>
          <button type="button" class="map-btn map-icon" data-map-act="zoom-in" aria-label="Zoom in" title="Zoom in (+)">+</button>
          <button type="button" class="map-btn" data-map-act="fit" title="Fit the whole map (F)">Fit</button>
        </div>
        <button type="button" class="map-btn map-icon" data-map-act="minimap" aria-label="Minimap" title="Minimap" aria-pressed="false" aria-controls="${esc(ids.legend)}-minimap">${MINIMAP_ICON}</button>
      </div>
    </div>
    <div class="map-over">
    <div class="map-panel map-legend" id="${esc(ids.legend)}" role="group" aria-label="Legend: shows and hides layers" hidden></div>
    <div class="map-panel map-about" id="${esc(ids.about)}" role="group" aria-label="About this map" tabindex="0" hidden>
      <div class="map-notes"></div>
      <h3 class="map-about-title">How to read the map</h3>
      <p class="map-about-line">${esc(LINK_SAYS)} Click a box to see everything that feeds it and everything it feeds: ${SIGN} at a box's right edge means it feeds the box selected, ${SIGN} at its left edge means the box selected feeds it.</p>
      <p class="map-about-line">${esc(BESIDE_SAYS)}</p>
      <h3 class="map-about-title">Mouse and keys</h3>
      <p class="map-hints" id="${esc(ids.hints)}">
        <b>Click</b> a box: what feeds it and what it feeds · <b>Double-click</b>: show what is inside<br>
        <b>Drag</b> the background to move, a box to move the box · <b>Scroll</b> to zoom<br>
        <b>Esc</b> back · <b>F</b> whole map · <b>/</b> search · <b>+</b> <b>−</b> zoom<br>
        <b>Arrows</b> next box · <b>Enter</b> show what is inside
      </p>
    </div>
    </div>
    <div class="map-panel map-minimap-wrap" id="${esc(ids.legend)}-minimap" hidden><canvas class="map-minimap" width="196" height="128" aria-hidden="true"></canvas></div>
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
  return `<h2 class="map-title-name"><button type="button" class="map-crumb${whole ? " map-here" : ""}" data-map-act="crumb" data-map-crumb="root"${whole ? ' aria-current="location"' : ""} title="${esc(said)}">${esc(model)}</button></h2>`;
}

/** Which links the legend speaks of, besides those of page filters: formulas' where they are drawn, access drivers'
 * where the picture draws some, and, where the Links panel has no kind of link ticked, that none is drawn. */
export interface LegendLinks { formulas: boolean; access: boolean; none: boolean }
const FORMULAS_ONLY: LegendLinks = { formulas: true, access: false, none: false };

/** The legend: each layer of the graph on screen with its colour and its number, as a button that hides the layer and
 * shows it again, and under them what a line means, for only the kinds of link drawn (`links`): while the links of page
 * filters are drawn, what theirs means on that kind of picture too (`filters`), beside a piece of the line they are drawn
 * in; and while a box of the picture has a filter mark, what the mark means on that kind of picture (`marks`), beside
 * one. Where no kind of link
 * is ticked, it says so plainly. A hidden layer says so in more than its colour: its name is struck through, and the
 * button is not pressed. */
export function legendHtml(title: string, layers: readonly ViewLayer[], hidden: ReadonlySet<string>, filters?: ViewGraph["kind"], marks?: ViewGraph["kind"],
  links: LegendLinks = FORMULAS_ONLY, accessMarks?: ViewGraph["kind"]): string {
  return `<div class="map-legend-title">${esc(title)}</div>${layers.map(layer => {
    const off = hidden.has(layer.key);
    return `<button type="button" class="map-legend-item${off ? " map-off" : ""}" data-map-act="layer" data-map-layer="${esc(layer.key)}" aria-pressed="${off ? "false" : "true"}">${dot(layer.key)}<span class="map-legend-name">${esc(layer.label)}</span><span class="map-legend-count">${esc(formatCount(layer.count))}</span></button>`;
  }).join("")}${links.formulas ? `<p class="map-legend-note">${esc(LINK_SAYS)}</p>` : ""}${
    links.access ? `<p class="map-legend-note map-legend-access">${esc(ACCESS_LINK_SAYS)}</p>` : ""}${
    links.none ? `<p class="map-legend-note map-legend-none">${esc(NO_LINKS_SAYS)}</p>` : ""}${filters ? `<p class="map-legend-note map-legend-filter"><span class="map-line-filter" aria-hidden="true"></span>${esc(FILTER_LINK_SAYS[filters])}</p>` : ""}${
    marks ? `<p class="map-legend-note map-legend-mark"><span class="map-mark-filter" aria-hidden="true">${FUNNEL}</span>${esc(FILTER_MARK_SAYS[marks])}</p>` : ""}${
    accessMarks ? `<p class="map-legend-note map-legend-mark map-legend-key"><span class="map-mark-access" aria-hidden="true">${KEY}</span>${esc(ACCESS_MARK_SAYS[accessMarks])}</p>` : ""}`;
}

/** What the first button of the trace's bar does, in full: its face is short, for the bar to keep to one row. */
const ONLY_SAYS = "Show only these boxes";
const ALL_SAYS = "Show all boxes";

/** The trace lives once, below the details' opening buttons. */
export function traceHtml(words: TraceWords, focused: boolean): string {
  return `<p class="map-trace-counts"><span class="map-trace-count map-trace-up">${SIGN}${esc(words.feeds)}</span>, <span class="map-trace-count map-trace-down">${SIGN}${esc(words.fed)}</span>.</p>
    <p class="map-trace-note">On the map, directly or through others.</p>
    <button type="button" class="map-btn map-small" data-map-act="focus" aria-label="${focused ? ALL_SAYS : ONLY_SAYS}" title="${focused ? ALL_SAYS : ONLY_SAYS}" aria-pressed="${focused}">${focused ? "All boxes" : "Only these"}</button>`;
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
  if (!outcome.hits.length) return '<p class="map-results-note">No matching groups, modules or line items.</p>';
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
  return `<summary>${PATH_CHEVRON}${esc(list.title)}</summary>${shown.map(linkHtml).join("")}${more}`;
}

/** The name and kind, opening buttons, trace, readable details, then folded raw values. */
export function inspectorHtml(inspection: Inspection, trace?: TraceWords, opens: readonly MapOpen[] = [], focused = false): string {
  const rows = inspection.rows.length ? `<dl class="map-dl">${inspection.rows.map(([label, value]) => `<dt>${esc(label)}</dt><dd>${esc(value)}</dd>`).join("")}</dl>` : "";
  const action = inspection.action;
  const button = !action ? "" : `<button type="button" class="map-btn map-small map-primary" data-map-act="open"${action.section === undefined ? "" : ` data-map-section="${esc(action.section)}"`}${
    action.module === undefined ? "" : ` data-map-module="${esc(action.module)}"`}${action.select === undefined ? "" : ` data-map-select="${esc(action.select)}"`}>${esc(action.label)}</button>`;
  const formula = inspection.formula !== undefined ? `<h4 class="map-insp-sec">Formula</h4><pre class="map-formula">${esc(inspection.formula)}</pre>`
    : inspection.remark !== undefined ? `<p class="map-insp-note">${esc(inspection.remark)}</p>` : "";
  const buttons = button + opens.map((open, index) => `<button type="button" class="map-btn map-small" data-map-act="page-open" data-map-open="${index}" title="${esc(open.title)}">${openIcon(open.label)}${esc(open.label)}</button>`).join("");
  const traced = !trace ? "" : `<div class="map-insp-trace">${traceHtml(trace, focused)}</div>`;
  const lists = inspection.lists.map(list => `<details class="map-details" data-map-list="${esc(list.key)}"${list.open ? " open" : ""}>${listHtml(list, false)}</details>`).join("");
  const texts = inspection.texts.map(text => `<details class="map-details"><summary>${PATH_CHEVRON}${esc(text.title)}</summary><ul class="map-lines">${text.lines.map(line => `<li>${esc(line)}</li>`).join("")}</ul></details>`).join("");
  const notes = inspection.notes === undefined ? "" : `<h4 class="map-insp-sec">Notes</h4><p class="map-insp-note">${esc(inspection.notes)}</p>`;
  const raw = !inspection.asRead?.length ? "" : `<details class="map-details map-as-read"><summary>${PATH_CHEVRON}As read</summary>${inspection.asRead.map(([label, value]) => `<h4 class="map-insp-sec">${esc(label)}</h4><pre class="map-formula">${esc(value)}</pre>`).join("")}</details>`;
  return `<div class="map-insp-head"><div><h3 class="map-insp-name" tabindex="-1">${esc(inspection.name)}</h3><span class="map-kind">${dot(inspection.layer)}${esc(inspection.kind)}</span></div><button type="button" class="map-icon-btn" data-map-act="close" aria-label="Close details" title="Close details">${CLOSE_ICON}</button></div>
    ${buttons ? `<div class="map-insp-opens">${buttons}</div>` : ""}${traced}${formula}${rows}${lists}${texts}${notes}${raw}`;
}

/** What a map that stopped after a failure says in its own place: that it could not be drawn, the failure's own words
 * where it has any, and that the result is whole. It speaks at once to a screen reader, and can take the focus that
 * was in the map. */
export function brokenHtml(reason: string): string {
  const why = reason.trim() === "" ? "" : ` (${esc(reason)})`;
  return `<div class="map-broken" role="alert" tabindex="-1"><h2 class="map-empty-title">The map could not be drawn</h2><p class="map-empty-text">Drawing it failed${why}, and the map has stopped. The tables of this result are not affected.</p></div>`;
}

/** Automatic stays a separate choice even when the viewer picks the same grouping by name. */
export function groupingOptionsHtml(groupings: readonly { kind: string; label: string }[], automatic: string | undefined): string {
  const label = groupings.find(grouping => grouping.kind === automatic)?.label;
  return [{ kind: "automatic", label: `Automatic${label ? ` · ${label}` : ""}` }, ...groupings]
    .map(grouping => `<button type="button" class="map-picker-opt" role="option" aria-selected="false" tabindex="-1" data-map-act="grouping" data-map-grouping="${esc(grouping.kind)}">${esc(grouping.label)}</button>`).join("");
}

/** The values of the Show list that are no group's place. */
export const SHOW_GROUPS = "groups";
export const SHOW_MODULES = "modules";

/** Choosing a group always navigates; All groups returns to the overview. */
export function groupOptionsHtml(groups: readonly string[], counts: readonly number[]): string {
  return [{ value: SHOW_GROUPS, name: "All groups" },
    ...groups.map((name, index) => ({ value: String(index), name: `${name} · ${formatCount(counts[index] ?? 0)} ${(counts[index] ?? 0) === 1 ? "module" : "modules"}` }))]
    .map(group => `<button type="button" class="map-picker-opt" role="option" aria-selected="false" tabindex="-1" data-map-act="group" data-map-group="${esc(group.value)}">${esc(group.name)}</button>`).join("");
}

/** Modules arrive in group order. A group heading is written once, with its options beneath it. Keyboard focus and the
 * current module have separate marks: moving through the list does not change which module the map shows. */
export function pickerOptionsHtml(listId: string, modules: readonly { name: string; group?: string; current?: boolean }[], active: number, all?: { current: boolean }): string {
  let previous: string | undefined;
  const first = all ? `<div class="map-picker-opt${active === -1 ? " map-active" : ""}${all.current ? " map-current" : ""}" role="option" id="${esc(listId)}-all" aria-selected="${all.current}" data-map-pick="-1">All modules</div>` : "";
  return first + modules.map((module, index) => {
    const heading = index === 0 || module.group !== previous;
    const end = index === modules.length - 1 || module.group !== modules[index + 1].group;
    previous = module.group;
    return `${heading ? `<div role="group" aria-label="${esc(module.group ?? "Modules")}"><div class="map-picker-heading" aria-hidden="true">${esc(module.group ?? "Modules")}</div>` : ""}<div class="map-picker-opt${index === active ? " map-active" : ""}${module.current ? " map-current" : ""}" role="option" id="${esc(listId)}-${index}" aria-selected="${module.current ? "true" : "false"}" data-map-pick="${index}"><span class="map-picker-name">${esc(module.name)}</span>${module.current ? '<small>Current module</small>' : ""}</div>${end ? "</div>" : ""}`;
  }).join("");
}

/** What stands in the middle of a map with nothing to draw: what is missing, in the map's own words, and under it what
 * the graph says it could not hold, listed as the notes about the map list it. The list can be longer than the map is
 * high: the box scrolls, and takes the focus so that the keyboard scrolls it too. */
export function emptyHtml(title: string, text: string, leftOut: readonly string[] = []): string {
  return `<div class="map-panel map-empty-box" role="group" aria-label="${esc(title)}" tabindex="0"><h3 class="map-empty-title">${esc(title)}</h3><p class="map-empty-text">${esc(text)}</p>${leftOutHtml(leftOut)}</div>`;
}
