import type { GraphNode, ModelGraph, ModelMap, ModelMapOptions } from "./graph-types.js";
import { boxAround, centreOn, defaultInsets, easeCamera, fitCameraIn, hitNode, insetsOf, reveal, roomsBeside, stepFrom, toWorld, zoomAt, type Area, type Camera, type Direction, type Insets, type MinimapTransform } from "./map-camera.js";
import { createFonts, drawMinimap, drawScene, type Fonts, type Pen } from "./map-canvas.js";
import { moduleGraph, modulesGraph, sectionsGraph, type ViewGraph, type ViewNode } from "./map-graphs.js";
import { inspect, selectionSentence, type Inspection } from "./map-inspect.js";
import { boundsOf, layoutGraph } from "./map-layout.js";
import { crumbsHtml, emptyHtml, inspectorHtml, legendHtml, listHtml, moduleOptionsHtml, notesHtml, resultsHtml, sectionOptionsHtml, shellHtml, statsHtml, tooltipHtml, tracebarHtml, type Tip } from "./map-markup.js";
import { indexModel, type MapModel } from "./map-model.js";
import { FALLBACK, readPalette, type MapPalette } from "./map-palette.js";
import { createSearch, matchNodes, searchText, type SearchHit } from "./map-search.js";
import { formatCount, plural } from "./map-text.js";
import { inTrace, traceNode, type Trace } from "./map-trace.js";

/** What the map asks of the browser around it. The page gives it none of this: `mountModelMap` takes it from the browser,
 * and a test hands in its own. */
export interface MapEnvironment {
  /** The drawing context of a canvas; nothing where the canvas cannot be drawn on. */
  pen(canvas: HTMLCanvasElement): Pen | null;
  /** Tells the size of an element's box, in CSS pixels, whenever it changes. Gives back what ends the telling. */
  watchSize(element: Element, changed: (width: number, height: number) => void): () => void;
  /** Reads a token of the styles in force on an element; "" for none. */
  token(element: Element, name: string): string;
  /** Asks for one call before the next picture is shown, with the time in milliseconds. */
  requestFrame(callback: (time: number) => void): number;
  cancelFrame(frame: number): void;
  /** Whether the user asked for less motion. Asked each time something could move. */
  reducedMotion(): boolean;
  /** How many of the screen's pixels a CSS pixel takes. */
  pixelRatio(): number;
  now(): number;
}

/** The browser as the map's surroundings. Where it lacks something (a page that is not a browser's), the map goes
 * without: it then keeps the size it was given first, draws in the colours it has by itself, and moves nothing. */
export function browserEnvironment(): MapEnvironment {
  return {
    pen: canvas => (typeof canvas.getContext === "function" ? canvas.getContext("2d") : null),
    watchSize: (element, changed) => {
      if (typeof ResizeObserver !== "function") return () => undefined;
      const observer = new ResizeObserver(entries => {
        const box = entries[entries.length - 1]?.contentRect;
        if (box) changed(box.width, box.height);
      });
      observer.observe(element);
      return () => observer.disconnect();
    },
    token: (element, name) => (typeof getComputedStyle === "function" ? getComputedStyle(element).getPropertyValue(name) : ""),
    requestFrame: callback => (typeof requestAnimationFrame === "function" ? requestAnimationFrame(callback) : 0),
    cancelFrame: frame => { if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(frame); },
    reducedMotion: () => typeof matchMedia !== "function" || matchMedia("(prefers-reduced-motion: reduce)").matches,
    pixelRatio: () => (typeof devicePixelRatio === "number" && devicePixelRatio > 0 ? devicePixelRatio : 1),
    now: () => (typeof performance === "object" ? performance.now() : Date.now()),
  };
}

/** Puts the model map into `host`, an empty element the page gives it, and returns the handle the page drives it with.
 * The map makes its own elements inside the host and nowhere else, is sized by the host, and starts hidden: nothing is
 * drawn until `show`. Its styles are in map.css. */
export function mountModelMap(host: HTMLElement, graph: ModelGraph, options: ModelMapOptions): ModelMap {
  return mountModelMapIn(host, graph, options, browserEnvironment());
}

/** The minimap's size in CSS pixels (map.css gives its canvas the same). */
const MINIMAP = { width: 196, height: 128 } as const;
/** The room kept between the graph and the panels around it when it is fitted. */
const FIT_MARGIN = 24;
const ARROWS: Record<string, Direction> = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down" };
/** How soon and how near a second press must follow the first to go into the node, in milliseconds and CSS pixels. */
const DOUBLE_PRESS = { within: 450, near: 8 } as const;
/** A colour no token holds: what a canvas still answers after a value it did not take was a colour. */
const NO_COLOUR = "#010203";

let mounted = 0;

/** `mountModelMap` with the surroundings handed in. */
export function mountModelMapIn(host: HTMLElement, graph: ModelGraph, options: ModelMapOptions, env: MapEnvironment): ModelMap {
  const page = host.ownerDocument ?? document;
  const number = ++mounted;
  const root = page.createElement("div");
  root.setAttribute("class", "map-root");
  root.hidden = true;
  root.innerHTML = shellHtml({ results: `map-results-${number}`, hints: `map-hints-${number}` }, options.modelName, options.workspaceName);
  host.appendChild(root);

  const part = <T extends HTMLElement = HTMLElement>(selector: string): T => root.querySelector(selector) as T;
  const canvas = part<HTMLCanvasElement>(".map-canvas");
  const miniCanvas = part<HTMLCanvasElement>(".map-minimap");
  const stats = part(".map-stats");
  const notes = part(".map-notes");
  const crumbs = part(".map-crumbs");
  const groupToggle = part<HTMLButtonElement>('[data-map-act="group"]');
  const sectionSelect = part<HTMLSelectElement>(".map-section-select");
  const moduleSelect = part<HTMLSelectElement>(".map-module-select");
  const externalToggle = part<HTMLButtonElement>('[data-map-act="external"]');
  const accessToggle = part<HTMLInputElement>(".map-access");
  const focusToggle = part<HTMLButtonElement>('[data-map-act="focus"]');
  const searchInput = part<HTMLInputElement>(".map-search");
  const searchCount = part(".map-search-count");
  const results = part(".map-results");
  const legend = part(".map-legend");
  const hints = part(".map-hints");
  const miniWrap = part(".map-minimap-wrap");
  const inspector = part(".map-inspector");
  const tracebar = part(".map-tracebar");
  const free = part(".map-free");
  const empty = part(".map-empty");
  const tooltip = part(".map-tooltip");
  const live = part(".map-live");

  const pen = env.pen(canvas);
  const miniPen = env.pen(miniCanvas);

  /* ---------- what the map holds ---------- */

  let model: MapModel | undefined;
  let search: ReturnType<typeof createSearch> | undefined;
  /** The view: the modules (as sections, of one section, or all) or the line items of one module. */
  let view: "modules" | "drill" = "modules";
  let grouped = true;
  let section: string | undefined;
  let moduleId: number | undefined;
  let expanded = false;
  let access = false;
  let onScreen: ViewGraph | undefined;
  let camera: Camera = { ox: 0, oy: 0, k: 1 };
  /** Where the camera is going, while it is on its way. */
  let heading: Camera | undefined;
  let selected: ViewNode | undefined;
  let trace: Trace | undefined;
  let inspection: Inspection | undefined;
  /** Whether the view keeps to the trace: only the node selected and what it reads and feeds are shown. */
  let onlyTrace = false;
  const hiddenLayers = new Set<string>();
  let shownNodes = new Uint8Array(0);
  /** The order the nodes are drawn in, once a node was dragged: it is drawn last, so that it lies over the others. */
  let order: number[] | undefined;
  let typed = "";
  let matches: Uint8Array | undefined;
  let hits: SearchHit[] = [];
  let hovered: ViewNode | undefined;
  let drag: { pointer: number; node: ViewNode | undefined; x: number; y: number; ox: number; oy: number; nodeX: number; nodeY: number; moved: boolean } | undefined;
  /** The last press on a node that was no drag: a second one at the same place soon after goes into that node. */
  let lastPress: { node: ViewNode; time: number; x: number; y: number } | undefined;
  /** The timer that lets presses through the details for a moment after a press opened them. */
  let arriving: ReturnType<typeof setTimeout> | undefined;

  let width = 0;
  let height = 0;
  let ratio = 1;
  /** The size the camera was last set for: a new size keeps the middle of the picture where it was. */
  let laidOut: { width: number; height: number } | undefined;
  let needsFit = true;
  let shown = false;
  let destroyed = false;
  let palette: MapPalette = FALLBACK;
  let fonts: Fonts | undefined;
  let frame: number | undefined;
  let lastFrame = 0;
  let minimap: MinimapTransform | undefined;

  const isShown = (index: number): boolean => shownNodes[index] === 1;
  const motion = (): boolean => !env.reducedMotion();

  /* ---------- drawing ---------- */

  function draw(time: number): void {
    frame = undefined;
    if (!shown || destroyed || !pen || !fonts || !onScreen || width <= 0 || height <= 0) return;
    let moving = false;
    if (heading) {
      const step = easeCamera(camera, heading, lastFrame ? time - lastFrame : 1000 / 60);
      camera = step.camera;
      if (step.done) heading = undefined; else moving = true;
    }
    const moves = motion();
    const scene = { graph: onScreen, camera, width, height, palette, shown: shownNodes, trace, matches, order, time: moves ? time : undefined };
    pen.setTransform(ratio, 0, 0, ratio, 0, 0);
    const traced = drawScene(pen, scene, fonts);
    if (miniPen) {
      miniPen.setTransform(ratio, 0, 0, ratio, 0, 0);
      minimap = drawMinimap(miniPen, scene, MINIMAP.width, MINIMAP.height);
    }
    // Another picture is asked for only while something moves: the camera on its way, or a trace's dashes.
    if (moving || (traced && moves)) {
      lastFrame = time;
      frame = env.requestFrame(draw);
    } else lastFrame = 0;
  }

  /** Something on the canvas changed: one picture is drawn before the next is shown. Nothing while the map is hidden. */
  function invalidate(): void {
    if (!shown || destroyed || !pen || frame !== undefined) return;
    frame = env.requestFrame(draw);
  }

  function stopDrawing(): void {
    if (frame !== undefined) env.cancelFrame(frame);
    frame = undefined;
    lastFrame = 0;
  }

  /** A value of the styles as a colour the canvas takes; nothing when it is no colour. The canvas itself says. */
  function colour(value: string): string | undefined {
    if (!pen) return value;
    pen.fillStyle = NO_COLOUR;
    pen.fillStyle = value;
    const taken = pen.fillStyle;
    if (typeof taken !== "string") return undefined;
    return taken === NO_COLOUR && value.trim().toLowerCase() !== NO_COLOUR ? undefined : taken;
  }

  function readTheme(): void {
    const before = palette;
    palette = readPalette(token => env.token(root, token), colour);
    // The words measured so far stay good while the fonts are the same: a theme changes colours.
    if (pen && (!fonts || palette.sans !== before.sans || palette.mono !== before.mono)) fonts = createFonts(pen, palette);
  }

  function sizeCanvases(): void {
    canvas.width = Math.max(1, Math.round(width * ratio));
    canvas.height = Math.max(1, Math.round(height * ratio));
    miniCanvas.width = Math.round(MINIMAP.width * ratio);
    miniCanvas.height = Math.round(MINIMAP.height * ratio);
  }

  function resize(nextWidth: number, nextHeight: number): void {
    if (destroyed) return;
    const nextRatio = Math.min(Math.max(env.pixelRatio(), 1), 2);
    if (nextWidth === width && nextHeight === height && nextRatio === ratio) return;
    width = nextWidth;
    height = nextHeight;
    ratio = nextRatio;
    if (width <= 0 || height <= 0) return;
    sizeCanvases();
    if (needsFit || !laidOut) fit(false);
    else {
      const shift = (to: Camera): Camera => ({ ox: to.ox + (width - laidOut!.width) / 2, oy: to.oy + (height - laidOut!.height) / 2, k: to.k });
      camera = shift(camera);
      if (heading) heading = shift(heading);
    }
    laidOut = { width, height };
    // A canvas that changes its size is cleared: it is drawn again at once, before the cleared one could be shown.
    if (shown) {
      stopDrawing();
      draw(env.now());
    }
  }

  /* ---------- the camera ---------- */

  /** An element's box within the canvas; nothing for one that is not laid out. */
  function areaOf(element: Element): Area | undefined {
    const outer = canvas.getBoundingClientRect();
    const box = element.getBoundingClientRect();
    if (!(box.width > 0 && box.height > 0)) return undefined;
    return { left: box.left - outer.left, top: box.top - outer.top, right: box.right - outer.left, bottom: box.bottom - outer.top };
  }

  /** The rooms a graph can be fitted into, measured where the page is laid out: the part of the canvas no panel covers
   * (`map-free`), above the small picture and the hints where they stand in its corners, or between them. */
  function rooms(): Insets[] {
    const freeArea = areaOf(free);
    if (!freeArea || freeArea.right - freeArea.left <= 2 * FIT_MARGIN || freeArea.bottom - freeArea.top <= 2 * FIT_MARGIN) return [defaultInsets(width, height, selected !== undefined)];
    const corners = [areaOf(miniWrap), areaOf(hints)].filter((area): area is Area => area !== undefined);
    return roomsBeside(freeArea, corners).map(room => insetsOf(room, width, height, FIT_MARGIN));
  }

  function go(to: Camera, animate: boolean): void {
    if (animate && shown && pen && motion()) heading = to;
    else {
      camera = to;
      heading = undefined;
    }
    hideTip();
    invalidate();
  }

  function fit(animate: boolean): void {
    if (!onScreen || width <= 0 || height <= 0) {
      needsFit = true;
      return;
    }
    needsFit = false;
    go(fitCameraIn(onScreen.bounds, width, height, rooms()), animate);
  }

  function fitNodes(nodes: readonly ViewNode[]): void {
    const box = boxAround(nodes);
    if (!box) return;
    if (width <= 0 || height <= 0) {
      needsFit = true;
      return;
    }
    needsFit = false;
    go(fitCameraIn(box, width, height, rooms()), true);
  }

  function zoom(factor: number, x = width / 2, y = height / 2): void {
    camera = zoomAt(camera, factor, x, y);
    heading = undefined;
    hideTip();
    invalidate();
  }

  /** Brings a node out from under the details, which open over the canvas when it is selected: the camera moves just
   * far enough, and not at all for a node the details do not cover. */
  function uncover(node: ViewNode): void {
    const details = areaOf(inspector);
    if (!details) return;
    const sheet = details.right - details.left > width * 0.6;
    const covered: Insets = sheet ? { l: 0, t: 0, r: 0, b: height - details.top } : { l: 0, t: 0, r: width - details.left, b: 0 };
    const to = reveal(camera, node, width, height, covered);
    if (to !== camera) go(to, true);
  }

  /* ---------- the panels ---------- */

  const announce = (sentence: string): void => { live.textContent = sentence; };

  function refreshShown(): void {
    if (!onScreen) return;
    shownNodes = new Uint8Array(onScreen.nodes.length);
    for (const node of onScreen.nodes) {
      if (!hiddenLayers.has(node.layer) && (!onlyTrace || !trace || inTrace(trace, node.index))) shownNodes[node.index] = 1;
    }
  }

  function renderStats(): void {
    if (!model || !onScreen) return;
    const links: [number, string] = [onScreen.edges.length, onScreen.edges.length === 1 ? "link" : "links"];
    const second: [number, string][] = onScreen.kind === "drill"
      ? [[onScreen.local, "local"], [onScreen.nodes.length - onScreen.local, onScreen.nodes.length - onScreen.local === 1 ? "external node" : "external nodes"]]
      : onScreen.kind === "sections" ? [[onScreen.nodes.length, onScreen.nodes.length === 1 ? "section" : "sections"], links]
      : [[onScreen.nodes.length, onScreen.nodes.length === 1 ? "visible module" : "visible modules"], links];
    stats.innerHTML = statsHtml(model.modules.length, model.lineItems.length, second);
  }

  function renderLegend(): void {
    if (!onScreen) return;
    legend.innerHTML = legendHtml(onScreen.kind === "drill" ? "Node types" : "Exported sections", onScreen.layers, hiddenLayers);
    legend.hidden = onScreen.layers.length === 0;
  }

  function renderCrumbs(): void {
    if (!model || !onScreen) return;
    const module = view === "drill" ? model.node(moduleId) : undefined;
    const home = module ? model.sectionOf(module) : undefined;
    crumbs.innerHTML = crumbsHtml({
      model: options.modelName, workspace: options.workspaceName,
      ...(home !== undefined && model.sectionIndex(home) >= 0 ? { section: { index: model.sectionIndex(home), name: home } } : {}),
      ...(onScreen.kind === "sections" ? {} : { here: onScreen.name }),
    });
  }

  function renderControls(): void {
    if (!model) return;
    for (const tab of root.querySelectorAll<HTMLButtonElement>(".map-tab")) {
      const active = tab.dataset.mapView === view;
      tab.classList.toggle("map-active", active);
      tab.setAttribute("aria-pressed", String(active));
      if (tab.dataset.mapView === "drill") tab.disabled = model.modules.length === 0;
    }
    const sections = grouped && section === undefined;
    groupToggle.hidden = view !== "modules";
    groupToggle.textContent = sections ? "Show all modules" : "Group by section";
    sectionSelect.hidden = view !== "modules";
    sectionSelect.value = section === undefined ? "" : String(model.sectionIndex(section));
    moduleSelect.hidden = view !== "drill";
    moduleSelect.value = moduleId === undefined ? "" : String(moduleId);
    externalToggle.hidden = view !== "drill";
    externalToggle.textContent = expanded ? "Group external items" : "Expand external items";
    accessToggle.checked = access;
    focusToggle.disabled = !selected;
    focusToggle.textContent = onlyTrace ? "Show full graph" : "Focus trace";
  }

  function renderInspector(): void {
    root.classList.toggle("map-has-inspector", selected !== undefined);
    if (!model || !onScreen || !selected) {
      inspection = undefined;
      inspector.hidden = true;
      inspector.innerHTML = "";
      return;
    }
    inspection = inspect(model, onScreen, selected, access);
    inspector.innerHTML = inspectorHtml(inspection);
    inspector.hidden = false;
    inspector.scrollTop = 0;
  }

  function renderTracebar(): void {
    if (!selected || !trace) {
      tracebar.hidden = true;
      tracebar.innerHTML = "";
      return;
    }
    tracebar.innerHTML = tracebarHtml(selected.fullName, trace.up.size, trace.down.size);
    tracebar.hidden = false;
  }

  function renderEmpty(): void {
    if (!model || !onScreen) return;
    const nothing = onScreen.nodes.length === 0;
    empty.hidden = !nothing;
    if (!nothing) empty.innerHTML = "";
    else if (model.modules.length === 0) empty.innerHTML = emptyHtml("No modules to map", graph.limitations[0] ?? "The export holds no module.");
    else empty.innerHTML = emptyHtml("Nothing to show here", onScreen.kind === "drill" ? "This module has no line items." : "This section has no modules.");
  }

  function renderChrome(): void {
    renderStats();
    renderLegend();
    renderCrumbs();
    renderControls();
    renderInspector();
    renderTracebar();
    renderEmpty();
  }

  function hideTip(): void {
    hovered = undefined;
    tooltip.classList.remove("map-show");
  }

  function showTip(node: ViewNode, x: number, y: number): void {
    if (!model) return;
    if (hovered !== node) {
      hovered = node;
      const raw = node.raw;
      const module = raw && raw.kind !== "module" ? model.node(model.moduleOf(raw)) : undefined;
      const hint = node.kind === "section" ? "Double-click for modules" : raw?.kind === "module" ? "Double-click for line items" : "";
      const tip: Tip = {
        layer: node.layer, kind: node.code || (raw ? raw.kind === "lineItem" ? "line item" : raw.kind : node.kind), name: node.fullName,
        lines: [node.meta, module?.name ?? "", hint], ...(raw?.formula ? { formula: raw.formula } : {}),
      };
      tooltip.innerHTML = tooltipHtml(tip);
      tooltip.classList.add("map-show");
    }
    tooltip.style.left = `${Math.max(8, Math.min(x + 16, width - (tooltip.offsetWidth || 0) - 12))}px`;
    tooltip.style.top = `${Math.max(8, Math.min(y + 16, height - (tooltip.offsetHeight || 0) - 12))}px`;
  }

  function closeResults(): void {
    results.hidden = true;
  }

  /* ---------- views and selection ---------- */

  function viewSentence(): string {
    if (!onScreen) return "";
    if (onScreen.kind === "sections") return `Sections of ${options.modelName}: ${plural(onScreen.nodes.length, "section")}, ${plural(onScreen.edges.length, "link")}.`;
    if (onScreen.kind === "modules") return `${onScreen.name}: ${plural(onScreen.nodes.length, "module")}, ${plural(onScreen.edges.length, "link")}.`;
    return `Line items of ${onScreen.name}: ${plural(onScreen.local, "line item")}, ${plural(onScreen.nodes.length - onScreen.local, "external node")}.`;
  }

  /** Builds the graph the view asks for, lays it out and fits it. */
  function build(): void {
    if (!model) return;
    onScreen = view === "drill" && moduleId !== undefined ? moduleGraph(model, moduleId, expanded, access)
      : grouped && section === undefined ? sectionsGraph(model, access) : modulesGraph(model, section, access);
    layoutGraph(onScreen);
    order = undefined;
    selected = selected && onScreen.byId.get(selected.id);
    trace = selected ? traceNode(onScreen, model, selected.index, access) : undefined;
    if (!selected) onlyTrace = false;
    refreshShown();
    matches = matchNodes(onScreen, typed);
    renderChrome();
    fit(false);
  }

  /** Goes to a view: the selection, the hidden layers and the search start afresh there. */
  function setView(next: "modules" | "drill", module?: number): void {
    if (!model) return;
    view = next;
    if (next === "drill") {
      moduleId = module !== undefined && model.node(module)?.kind === "module" ? module : moduleId ?? model.modules[0]?.id;
      if (moduleId === undefined) view = "modules";
    }
    selected = undefined;
    trace = undefined;
    onlyTrace = false;
    hiddenLayers.clear();
    typed = "";
    hits = [];
    searchInput.value = "";
    searchCount.textContent = "";
    closeResults();
    hideTip();
    build();
    announce(viewSentence());
  }

  function select(node: ViewNode | undefined): void {
    if (!model || !onScreen) return;
    const had = selected !== undefined;
    selected = node;
    onlyTrace = false;
    trace = node ? traceNode(onScreen, model, node.index, access) : undefined;
    refreshShown();
    renderInspector();
    renderTracebar();
    renderControls();
    if (node && inspection && trace) announce(selectionSentence(inspection, trace.up.size, trace.down.size));
    else if (had) announce("Selection cleared.");
    invalidate();
  }

  /** Selects a node of the graph on screen by its name there, and brings it into view. */
  function pick(id: string): void {
    const node = onScreen?.byId.get(id);
    if (!node) return;
    select(node);
    fitNodes([node]);
  }

  function openSection(index: number): void {
    if (!model || model.sections[index] === undefined) return;
    section = model.sections[index];
    grouped = false;
    setView("modules");
  }

  function showSections(): void {
    section = undefined;
    grouped = true;
    setView("modules");
  }

  /** Goes to an object of the model, wherever it is, and selects it: a module among its section's modules, a line item
   * among its module's line items, anything else where it is on screen. */
  function navigate(raw: GraphNode): void {
    if (!model) return;
    if (raw.kind === "module") {
      section = model.sectionOf(raw);
      grouped = false;
      setView("modules");
    } else if (raw.kind === "lineItem" && model.moduleOf(raw) !== undefined && (view !== "drill" || moduleId !== raw.module)) setView("drill", raw.module);
    pick(String(raw.id));
  }

  /** Goes into a node: a section's modules, a module's line items, a line item of another module in its own module.
   * A line item of the module on screen has nowhere to go into: the view keeps to its trace. */
  function enter(node: ViewNode): void {
    if (node.kind === "section" && node.section !== undefined) openSection(node.section);
    else if (node.raw?.kind === "module") setView("drill", node.raw.id);
    else if (node.external && node.raw?.kind === "lineItem") navigate(node.raw);
    else {
      select(node);
      setOnlyTrace(true);
    }
  }

  function setOnlyTrace(on: boolean): void {
    if (!onScreen || !selected || !trace) return;
    onlyTrace = on;
    refreshShown();
    renderControls();
    if (on) fitNodes(onScreen.nodes.filter(node => inTrace(trace!, node.index)));
    else fit(true);
    invalidate();
  }

  /** One step back, as Escape takes it: the selection goes first, then a module's line items give way to the modules
   * last shown, and those to the model's sections. Says whether there was a step to take. */
  function back(): boolean {
    if (selected) select(undefined);
    else if (view === "drill") setView("modules");
    else if (section !== undefined || !grouped) showSections();
    else return false;
    return true;
  }

  function runSearch(): void {
    if (!search || !onScreen) return;
    typed = searchInput.value;
    matches = matchNodes(onScreen, typed);
    invalidate();
    if (searchText(typed) === "") {
      hits = [];
      searchCount.textContent = "";
      closeResults();
      return;
    }
    const outcome = search(typed);
    hits = outcome.hits;
    searchCount.textContent = formatCount(outcome.total);
    results.innerHTML = resultsHtml(outcome);
    results.hidden = false;
    announce(outcome.total === 0 ? "No matches." : `${plural(outcome.total, "match", "matches")}.`);
  }

  function choose(hit: SearchHit | undefined): void {
    if (!hit) return;
    if (hit.kind === "section" && hit.section !== undefined) {
      showSections();
      pick(`section${hit.section}`);
    } else if (hit.node) navigate(hit.node);
    closeResults();
    focusDetails();
  }

  /* ---------- focus ---------- */

  const hasFocus = (): boolean => root.contains(page.activeElement);
  const focusOn = (element: HTMLElement | null | undefined): void => element?.focus({ preventScroll: true });
  /** The map takes the focus as it is shown, so that its keys work from the first one: Escape, F, plus, minus, the slash
   * and the arrows are heard only while the focus is inside it. The canvas takes it: it has a name, and the page's ring
   * when the focus came by the keyboard. Focus that is already in the map stays where it is.
   * A page may show the map while it still keeps the map's surroundings out of reach, as the results page does until it
   * has closed a narrow window's navigation: the canvas cannot take the focus then, and takes it once the page's own
   * step is over, if the map is still shown and still without it. */
  function takeFocus(): void {
    if (hasFocus()) return;
    focusOn(canvas);
    if (hasFocus()) return;
    queueMicrotask(() => {
      if (shown && !destroyed && !hasFocus()) focusOn(canvas);
    });
  }

  /** The details of the node selected take the focus, so that the keyboard goes on from there; the map itself otherwise. */
  function focusDetails(): void {
    focusOn(selected ? inspector.querySelector<HTMLElement>(".map-insp-name") ?? canvas : canvas);
  }

  /* ---------- what the user does ---------- */

  function act(target: HTMLElement): void {
    if (!model || !onScreen) return;
    const data = target.dataset;
    switch (data.mapAct) {
      case "view": setView(data.mapView === "drill" ? "drill" : "modules", moduleId); break;
      case "crumb": if (data.mapCrumb === "section") openSection(Number(data.mapSection)); else showSections(); break;
      case "group":
        if (grouped && section === undefined) {
          grouped = false;
          setView("modules");
        } else showSections();
        break;
      case "external": expanded = !expanded; setView("drill", moduleId); break;
      case "focus": setOnlyTrace(!onlyTrace); break;
      case "fit": onlyTrace = false; refreshShown(); renderControls(); fit(true); break;
      case "zoom-in": zoom(1.3); break;
      case "zoom-out": zoom(1 / 1.3); break;
      case "layer": {
        const layer = data.mapLayer ?? "";
        if (hiddenLayers.has(layer)) hiddenLayers.delete(layer); else hiddenLayers.add(layer);
        const off = hiddenLayers.has(layer);
        target.classList.toggle("map-off", off);
        target.setAttribute("aria-pressed", String(!off));
        refreshShown();
        invalidate();
        break;
      }
      case "close": case "clear": select(undefined); break;
      case "raw": { const raw = model.node(Number(data.mapRaw)); if (raw) navigate(raw); break; }
      case "node": pick(data.mapNode ?? ""); break;
      case "open":
        if (data.mapSection !== undefined) openSection(Number(data.mapSection));
        else if (data.mapModule !== undefined) {
          setView("drill", Number(data.mapModule));
          if (data.mapSelect !== undefined) pick(data.mapSelect);
        }
        break;
      case "more": {
        const list = inspection?.lists.find(each => each.key === data.mapList);
        const holder = target.closest<HTMLElement>(".map-details");
        if (!list || !holder) break;
        const before = holder.querySelectorAll(".map-link").length;
        holder.innerHTML = listHtml(list, true);
        focusOn(holder.querySelectorAll<HTMLElement>(".map-link")[before]);
        break;
      }
      case "result": choose(hits[Number(data.mapHit)]); break;
      default: break;
    }
  }

  root.addEventListener("click", event => {
    const target = (event.target as Element | null)?.closest<HTMLElement>("[data-map-act]");
    if (!target || !shown) return;
    const focused = hasFocus();
    const details = inspector.contains(target);
    act(target);
    // What was clicked may be gone with what it stood in: the focus then stays in the map.
    if (focused && !hasFocus()) {
      if (details) focusDetails(); else focusOn(canvas);
    }
  });

  root.addEventListener("change", event => {
    const target = event.target as HTMLElement | null;
    if (!model || !shown || !target) return;
    if (target === sectionSelect) {
      section = sectionSelect.value === "" ? undefined : model.sections[Number(sectionSelect.value)];
      grouped = false;
      setView("modules");
    } else if (target === moduleSelect) setView("drill", Number(moduleSelect.value));
    else if (target === accessToggle) {
      // The same view with other links: what is selected stays selected where it is still on screen.
      access = accessToggle.checked;
      onlyTrace = false;
      build();
    }
  });

  root.addEventListener("input", event => {
    if (shown && event.target === searchInput) runSearch();
  });

  /** A key in the search box: Enter goes to the first result, the down arrow into the results, Escape back to the map. */
  function searchKey(event: KeyboardEvent): void {
    if (event.key === "Enter" && hits.length) {
      event.preventDefault();
      choose(hits[0]);
    } else if (event.key === "ArrowDown" && !results.hidden) {
      event.preventDefault();
      focusOn(results.querySelector<HTMLElement>(".map-result"));
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeResults();
      focusOn(canvas);
    }
  }

  /** A key among the results: the arrows move through them, Escape goes back to the search box. Says whether it was one of those. */
  function resultsKey(event: KeyboardEvent, target: HTMLElement): boolean {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Escape") return false;
    event.preventDefault();
    event.stopPropagation();
    const buttons = [...results.querySelectorAll<HTMLElement>(".map-result")];
    const at = buttons.indexOf(target);
    if (event.key === "Escape") {
      closeResults();
      focusOn(searchInput);
    } else if (event.key === "ArrowDown") focusOn(buttons[Math.min(buttons.length - 1, at + 1)]);
    else if (at <= 0) focusOn(searchInput);
    else focusOn(buttons[at - 1]);
    return true;
  }

  /** A key anywhere else in the map. Only while the map is shown, and only for a key pressed inside it: the listener
   * is on the map's own element. A key with Ctrl, Alt or the command key is the browser's. */
  root.addEventListener("keydown", event => {
    const target = event.target as HTMLElement | null;
    if (!shown || !onScreen || !target) return;
    if (target === searchInput) return searchKey(event);
    if (results.contains(target) && resultsKey(event, target)) return;
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName) || event.ctrlKey || event.metaKey || event.altKey) return;
    let used = true;
    const key = event.key;
    if (key === "Escape") {
      const focused = hasFocus();
      used = back();
      if (focused && !hasFocus()) focusOn(canvas);
    } else if (key === "f" || key === "F") fit(true);
    else if (key === "+" || key === "=") zoom(1.2);
    else if (key === "-") zoom(1 / 1.2);
    else if (key === "/") focusOn(searchInput);
    else if (target === canvas && ARROWS[key]) {
      const [nearX, nearY] = toWorld(camera, width / 2, height / 2);
      const next = stepFrom(onScreen.nodes, isShown, selected, ARROWS[key], nearX, nearY);
      if (next) {
        select(next);
        go(reveal(camera, next, width, height, rooms()[0]), true);
      }
    } else if (target === canvas && key === "Enter" && selected) enter(selected);
    else used = false;
    if (used) {
      event.preventDefault();
      event.stopPropagation();
    }
  });

  // A press outside the search closes its results. Only presses inside the map are heard.
  root.addEventListener("pointerdown", event => {
    const target = event.target as Element | null;
    if (target && !target.closest(".map-searchwrap")) closeResults();
  });

  /** A pointer's place in the canvas, in CSS pixels from its top left corner. */
  const place = (event: { clientX: number; clientY: number }): [number, number] => {
    const box = canvas.getBoundingClientRect();
    return [event.clientX - box.left, event.clientY - box.top];
  };

  canvas.addEventListener("pointerdown", event => {
    if (event.button !== 0 || !onScreen) return;
    const [x, y] = place(event);
    const node = hitNode(onScreen.nodes, isShown, camera, x, y, order);
    heading = undefined;
    drag = { pointer: event.pointerId, node, x, y, ox: camera.ox, oy: camera.oy, nodeX: node?.x ?? 0, nodeY: node?.y ?? 0, moved: false };
    // The canvas keeps the pointer while it is down, so that a drag goes on outside it. A pointer the browser does not
    // know cannot be kept, and the drag then ends at the canvas's edge.
    try { canvas.setPointerCapture?.(event.pointerId); } catch { /* not kept */ }
    canvas.classList.add("map-dragging");
    hideTip();
  });

  canvas.addEventListener("pointermove", event => {
    if (!onScreen) return;
    const [x, y] = place(event);
    if (drag) {
      const dx = x - drag.x;
      const dy = y - drag.y;
      if (Math.hypot(dx, dy) > 4) drag.moved = true;
      if (!drag.moved) return;
      if (drag.node) {
        // The node dragged lies over the others from now on: where it is let go, it is not under another.
        const index = drag.node.index;
        order ??= onScreen.nodes.map(node => node.index);
        if (order[order.length - 1] !== index) {
          order.splice(order.indexOf(index), 1);
          order.push(index);
        }
        drag.node.x = drag.nodeX + dx / camera.k;
        drag.node.y = drag.nodeY + dy / camera.k;
      } else camera = { ox: drag.ox + dx, oy: drag.oy + dy, k: camera.k };
      invalidate();
      return;
    }
    const node = hitNode(onScreen.nodes, isShown, camera, x, y, order);
    canvas.classList.toggle("map-over-node", node !== undefined);
    if (node) showTip(node, x, y); else hideTip();
  });

  /** The details open over the canvas, and may open over the node just pressed. For a moment they let presses through,
   * so that the second press of a double press still reaches the canvas under them. */
  function letThrough(): void {
    if (arriving !== undefined) clearTimeout(arriving);
    root.classList.add("map-arriving");
    arriving = setTimeout(() => {
      arriving = undefined;
      root.classList.remove("map-arriving");
    }, DOUBLE_PRESS.within);
  }

  function settle(): void {
    if (arriving !== undefined) clearTimeout(arriving);
    arriving = undefined;
    root.classList.remove("map-arriving");
    lastPress = undefined;
  }

  canvas.addEventListener("pointerup", event => {
    if (!drag || !onScreen) return;
    const held = drag;
    try { if (canvas.hasPointerCapture?.(event.pointerId)) canvas.releasePointerCapture(event.pointerId); } catch { /* not kept */ }
    drag = undefined;
    canvas.classList.remove("map-dragging");
    invalidate();
    if (held.moved) {
      if (held.node) onScreen.bounds = boundsOf(onScreen.nodes);
      lastPress = undefined;
      return;
    }
    // A second press at the same place soon after the first goes into the node the first one was on, whatever is under
    // the pointer by now: the first press may have moved the camera.
    const now = env.now();
    const first = lastPress;
    lastPress = undefined;
    if (first && now - first.time < DOUBLE_PRESS.within && Math.hypot(held.x - first.x, held.y - first.y) < DOUBLE_PRESS.near && onScreen.nodes[first.node.index] === first.node) {
      settle();
      enter(first.node);
      return;
    }
    // A press without a move selects the node under it; on the node selected, or beside every node, it clears.
    const node = held.node && held.node !== selected ? held.node : undefined;
    select(node);
    if (held.node) lastPress = { node: held.node, time: now, x: held.x, y: held.y };
    if (node) {
      letThrough();
      uncover(node);
    }
  });

  canvas.addEventListener("pointercancel", () => {
    drag = undefined;
    canvas.classList.remove("map-dragging");
  });

  canvas.addEventListener("pointerleave", hideTip);

  canvas.addEventListener("wheel", event => {
    event.preventDefault();
    const [x, y] = place(event);
    const lines = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? height : 1;
    // A pinch on a trackpad comes as a wheel with Ctrl held, in small steps.
    const factor = Math.exp(-event.deltaY * lines * (event.ctrlKey ? 0.012 : 0.0012));
    zoom(Math.min(2, Math.max(0.5, factor)), x, y);
  }, { passive: false });

  miniCanvas.addEventListener("pointerdown", event => {
    if (!minimap) return;
    const box = miniCanvas.getBoundingClientRect();
    const scale = box.width > 0 ? MINIMAP.width / box.width : 1;
    const worldX = ((event.clientX - box.left) * scale - minimap.ox) / minimap.s;
    const worldY = ((event.clientY - box.top) * scale - minimap.oy) / minimap.s;
    go(centreOn(camera, worldX, worldY, width, height), true);
  });

  const stopWatching = env.watchSize(canvas, resize);

  /** What is done once, at the first showing: the model is looked up, and the first view built. */
  function start(): void {
    if (model) return;
    model = indexModel(graph);
    search = createSearch(model);
    sectionSelect.innerHTML = sectionOptionsHtml(model.sections);
    moduleSelect.innerHTML = moduleOptionsHtml(model.modules);
    const leftOut = notesHtml(graph.limitations, graph.unresolved.length);
    notes.innerHTML = leftOut;
    notes.hidden = leftOut === "";
    build();
  }

  return {
    show() {
      if (destroyed) return;
      const wasShown = shown;
      shown = true;
      root.hidden = false;
      readTheme();
      start();
      resize(canvas.clientWidth || 0, canvas.clientHeight || 0);
      invalidate();
      if (!wasShown) takeFocus();
    },
    hide() {
      if (destroyed) return;
      shown = false;
      root.hidden = true;
      stopDrawing();
      settle();
      hideTip();
      closeResults();
      drag = undefined;
    },
    themeChanged() {
      if (destroyed || !shown) return;
      readTheme();
      invalidate();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      shown = false;
      stopDrawing();
      settle();
      stopWatching();
      root.remove();
    },
  };
}
