import type { GraphNode, ModelGraph, ModelMap, ModelMapOptions } from "./graph-types.js";
import { boxAround, bringIntoView, centreOn, countInView, defaultInsets, easeCamera, fitCameraIn, hitNode, insetsOf, roomsBeside, stepFrom, toWorld, zoomAt, type Area, type Camera, type Direction, type Insets, type MinimapTransform } from "./map-camera.js";
import { createFonts, drawMinimap, drawScene, legibleFrom, type Fonts, type Pen } from "./map-canvas.js";
import { moduleGraph, modulesGraph, sectionsGraph, type ViewGraph, type ViewNode } from "./map-graphs.js";
import { inspect, statusWords, traceWords, viewSentence, type Inspection, type TraceWords } from "./map-inspect.js";
import { boundsOf, fullFrom, layoutGraph, sizeNodes } from "./map-layout.js";
import { brokenHtml, crumbsHtml, emptyHtml, inspectorHtml, legendHtml, listHtml, moduleOptionsHtml, notesHtml, resultsHtml, sectionOptionsHtml, shellHtml, tooltipHtml, tracebarHtml, type Tip } from "./map-markup.js";
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
 * without: it then keeps the size it was given first, draws in the colours it has by itself, and moves nothing. A
 * canvas that cannot be drawn on is the one thing it cannot go without (see `mountModelMapIn`). */
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
 * drawn until `show`. Its styles are in map.css.
 * It throws where the canvas gives no drawing context, or its size cannot be watched: a map that cannot draw is no
 * map, and the page says so in its own words. The host is then left as it was. `show` throws too where the first
 * picture cannot be drawn. A failure later on, in a picture drawn by itself or in answer to the user, has no caller
 * to tell: the map then stops, and says in its own place that it could not be drawn. */
export function mountModelMap(host: HTMLElement, graph: ModelGraph, options: ModelMapOptions): ModelMap {
  return mountModelMapIn(host, graph, options, browserEnvironment());
}

/** The minimap's size in CSS pixels (map.css gives its canvas the same). */
const MINIMAP = { width: 196, height: 128 } as const;
/** The room kept between the graph and the panels around it when it is fitted. */
const FIT_MARGIN = 20;
const ARROWS: Record<string, Direction> = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down" };
/** How soon and how near a second press must follow the first to go into the node, in milliseconds and CSS pixels. */
const DOUBLE_PRESS = { within: 450, near: 8 } as const;
/** Below this zoom a box picked from the search or the details is too small to be told from its neighbours: the camera
 * then goes to it. */
const TELLING_ZOOM = 0.62;
/** How long a trace's dashes move after a node is selected, in milliseconds: long enough to show which way the links
 * run, and then they stand still. */
const TRACE_MOVES = 1400;
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
  root.innerHTML = shellHtml({ results: `map-results-${number}`, hints: `map-hints-${number}`, legend: `map-legend-${number}`, about: `map-about-${number}`, access: `map-access-${number}` }, options.modelName);
  host.appendChild(root);

  const part = <T extends HTMLElement = HTMLElement>(selector: string): T => root.querySelector(selector) as T;
  const canvas = part<HTMLCanvasElement>(".map-canvas");
  const miniCanvas = part<HTMLCanvasElement>(".map-minimap");
  const stats = part(".map-stats");
  const wholeButton = part<HTMLButtonElement>('[data-map-act="whole"]');
  const notes = part(".map-notes");
  const crumbs = part(".map-crumbs");
  const groupToggle = part<HTMLButtonElement>('[data-map-act="group"]');
  const sectionSelect = part<HTMLSelectElement>(".map-section-select");
  const moduleSelect = part<HTMLSelectElement>(".map-module-select");
  const externalToggle = part<HTMLButtonElement>('[data-map-act="external"]');
  const accessToggle = part<HTMLInputElement>(".map-access");
  const searchInput = part<HTMLInputElement>(".map-search");
  const searchCount = part(".map-search-count");
  const results = part(".map-results");
  const legend = part(".map-legend");
  const legendButton = part<HTMLButtonElement>('[data-map-act="legend"]');
  const about = part(".map-about");
  const aboutButton = part<HTMLButtonElement>('[data-map-act="about"]');
  const dock = part(".map-dock");
  const status = part(".map-status");
  const corner = part(".map-corner");
  const inspector = part(".map-inspector");
  const tracebar = part(".map-tracebar");
  const free = part(".map-free");
  const empty = part(".map-empty");
  const tooltip = part(".map-tooltip");
  const live = part(".map-live");

  const given = env.pen(canvas);
  if (!given) {
    root.remove();
    throw new Error("the canvas gave no context");
  }
  const pen: Pen = given;
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
  /** A model whose modules stand under one heading, or under none: it has no sections to show, and opens on its modules. */
  let single = false;
  let onScreen: ViewGraph | undefined;
  let camera: Camera = { ox: 0, oy: 0, k: 1 };
  /** Where the camera is going, while it is on its way. */
  let heading: Camera | undefined;
  /** Whether the camera shows the graph as it was fitted, the user not having moved it: it then follows the room. */
  let atFit = false;
  /** Whether a node was dragged: the graph then keeps its places when the room changes. */
  let moved = false;
  let selected: ViewNode | undefined;
  let trace: Trace | undefined;
  let traced: TraceWords | undefined;
  let inspection: Inspection | undefined;
  /** Whether the view keeps to the trace: only the node selected and what it reads and feeds are shown. */
  let onlyTrace = false;
  /** Until when a trace's dashes move. */
  let traceMovesUntil = 0;
  const hiddenLayers = new Set<string>();
  let shownNodes = new Uint8Array(0);
  let shownCount = 0;
  /** The order the nodes are drawn in, once a node was dragged: it is drawn last, so that it lies over the others. */
  let order: number[] | undefined;
  let typed = "";
  let matches: Uint8Array | undefined;
  let hits: SearchHit[] = [];
  let hovered: ViewNode | undefined;
  /** Whether the user opened or closed the legend: until then it is open where the picture has the room for it. */
  let legendWanted: boolean | undefined;
  let drag: { pointer: number; node: ViewNode | undefined; x: number; y: number; ox: number; oy: number; nodeX: number; nodeY: number; moved: boolean } | undefined;
  /** The last press on a node that was no drag: a second one at the same place soon after goes into that node. */
  let lastPress: { node: ViewNode; time: number; x: number; y: number } | undefined;
  /** The timer that lets presses through the details for a moment after a press opened them. */
  let arriving: ReturnType<typeof setTimeout> | undefined;
  /** Ends the watching of the canvas's size (set once the watching has begun). */
  let stopWatching: () => void = () => undefined;

  let width = 0;
  let height = 0;
  let ratio = 1;
  /** The size the camera was last set for: a new size keeps the middle of the picture where it was. */
  let laidOut: { width: number; height: number } | undefined;
  let needsFit = true;
  let shown = false;
  let destroyed = false;
  /** Whether the map stopped because something it did failed (`fail`): it then shows a sentence and does nothing more. */
  let broken = false;
  /** Whether a picture was drawn since this was last cleared: `show` asks for none where it has just drawn one. */
  let drawn = false;
  let palette: MapPalette = FALLBACK;
  let fonts: Fonts | undefined;
  let frame: number | undefined;
  let lastFrame = 0;
  let minimap: MinimapTransform | undefined;
  /** The camera the line of what is in view was last written for. */
  let countedFor: Camera | undefined;
  let inView = 0;

  const isShown = (index: number): boolean => shownNodes[index] === 1;
  const motion = (): boolean => !env.reducedMotion();

  /* ---------- drawing ---------- */

  function draw(time: number): void {
    frame = undefined;
    if (!shown || destroyed || broken || !fonts || !onScreen || width <= 0 || height <= 0) return;
    drawn = true;
    let moving = false;
    if (heading) {
      const step = easeCamera(camera, heading, lastFrame ? time - lastFrame : 1000 / 60);
      camera = step.camera;
      if (step.done) heading = undefined; else moving = true;
    }
    // A trace's dashes move for a moment after the node is selected, and stand where they stopped from then on.
    const moves = motion();
    const scene = { graph: onScreen, camera, width, height, palette, shown: shownNodes, trace, matches, order, time: moves ? Math.min(time, traceMovesUntil) : undefined };
    pen.setTransform(ratio, 0, 0, ratio, 0, 0);
    const tracing = drawScene(pen, scene, fonts);
    if (miniPen) {
      miniPen.setTransform(ratio, 0, 0, ratio, 0, 0);
      minimap = drawMinimap(miniPen, scene, MINIMAP.width, MINIMAP.height);
    }
    // Another picture is asked for only while something moves: the camera on its way, or a trace's dashes for a moment
    // after a selection. A picture that has settled is never drawn again by itself.
    if (moving || (tracing && moves && time < traceMovesUntil)) {
      lastFrame = time;
      frame = env.requestFrame(drawFrame);
    } else {
      lastFrame = 0;
      if (countedFor !== camera && !drag) renderStatus();
    }
  }

  /** A picture the browser asked back for: nobody called it who could be told of a failure. */
  const drawFrame = (time: number): void => guard(() => draw(time));

  /** Something on the canvas changed: one picture is drawn before the next is shown. Nothing while the map is hidden. */
  function invalidate(): void {
    if (!shown || destroyed || broken || frame !== undefined) return;
    frame = env.requestFrame(drawFrame);
  }

  /** Something the map did by itself, or in answer to the user, failed: there is no caller to tell. The map stops for
   * good: no picture, no timer and no watching of its size are left, and in its own place it says that it could not be
   * drawn, with the failure's own words. The page's calls do nothing more but show and hide that sentence and take the
   * map away. */
  function fail(error: unknown): void {
    if (broken || destroyed) return;
    broken = true;
    const inside = hasFocus();
    stopDrawing();
    settle();
    endDrag();
    stopWatching();
    root.innerHTML = brokenHtml(error instanceof Error ? error.message : String(error ?? ""));
    if (inside) focusOn(root.querySelector<HTMLElement>(".map-broken"));
  }

  /** Runs a step that has no caller to tell of a failure. A map that has stopped runs none. */
  function guard(step: () => void): void {
    if (broken) return;
    try { step(); } catch (error) { fail(error); }
  }
  /** A listener that keeps a failure of its own from going uncaught. */
  const guarded = <E extends Event>(listener: (event: E) => void) => (event: E): void => guard(() => listener(event));

  function stopDrawing(): void {
    if (frame !== undefined) env.cancelFrame(frame);
    frame = undefined;
    lastFrame = 0;
  }

  /** A value of the styles as a colour the canvas takes; nothing when it is no colour. The canvas itself says. */
  function colour(value: string): string | undefined {
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
    if (!fonts || palette.sans !== before.sans || palette.mono !== before.mono) fonts = createFonts(pen, palette);
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
    // A size is told in whole pixels by one source and in fractions by another: less than half a pixel is no new size.
    if (Math.abs(nextWidth - width) < 0.5 && Math.abs(nextHeight - height) < 0.5 && nextRatio === ratio) return;
    width = nextWidth;
    height = nextHeight;
    ratio = nextRatio;
    if (width <= 0 || height <= 0) return;
    sizeCanvases();
    // A picture that was fitted is fitted again, laid out for the new room, so that it grows and shrinks with its place.
    // One the user has moved keeps its middle where it was.
    if (needsFit || !laidOut || (atFit && !moved)) arrange();
    else if (atFit) fit(false);
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

  /** The rooms a graph can be fitted into, measured where the page is laid out: the part of the canvas under the bar and
   * beside the details (`map-free`), clear of what stands in it: the legend and the notes while they are open, the line
   * of what is shown, and the small picture. */
  function rooms(): Insets[] {
    const freeArea = areaOf(free);
    if (!freeArea || freeArea.right - freeArea.left <= 2 * FIT_MARGIN || freeArea.bottom - freeArea.top <= 2 * FIT_MARGIN) return [defaultInsets(width, height, selected !== undefined)];
    const panels = [areaOf(legend), areaOf(about), areaOf(dock), areaOf(corner)].filter((area): area is Area => area !== undefined);
    const found = roomsBeside(freeArea, panels).map(room => insetsOf(room, width, height, FIT_MARGIN)).filter(room => width - room.l - room.r > 80 && height - room.t - room.b > 60);
    return found.length ? found : [insetsOf(freeArea, width, height, FIT_MARGIN)];
  }

  function go(to: Camera, animate: boolean, fitted = false): void {
    if (animate && shown && motion()) heading = to;
    else {
      camera = to;
      heading = undefined;
    }
    atFit = fitted;
    hideTip();
    invalidate();
  }

  /** Shows the whole graph, as large as the room lets it be. */
  function fit(animate: boolean): void {
    if (!onScreen || width <= 0 || height <= 0) {
      needsFit = true;
      return;
    }
    needsFit = false;
    go(fitCameraIn(onScreen.bounds, width, height, rooms()), animate, true);
  }

  /** Lays the graph out for the room it has and shows it. Until the user says otherwise, the legend is open where the
   * picture still shows every box in full beside it, or loses next to nothing by it, and closed where it would cost the
   * picture its names.
   *
   * A graph that would be fitted too small for every box to hold a readable line is not shown whole: it opens on its
   * start at the zoom that shows every box in full, the line of what is shown says how much of it that is, and one
   * press shows it whole. */
  function arrange(): void {
    if (!onScreen) return;
    if (width <= 0 || height <= 0) {
      needsFit = true;
      return;
    }
    needsFit = false;
    const current = onScreen;
    const plan = (): Insets[] => {
      const list = rooms();
      layoutGraph(current, list.map(room => ({ width: width - room.l - room.r, height: height - room.t - room.b })));
      return list;
    };
    const zoomIn = (list: Insets[]): number => fitCameraIn(current.bounds, width, height, list).k;
    let list: Insets[];
    if (legendWanted === undefined && current.layers.length > 0) {
      legend.hidden = true;
      const closed = zoomIn(plan());
      legend.hidden = false;
      list = plan();
      const open = zoomIn(list);
      if (open < fullFrom(current) && open < closed * 0.94) {
        legend.hidden = true;
        list = plan();
      }
    } else {
      legend.hidden = !(legendWanted === true && current.layers.length > 0);
      list = plan();
    }
    legendButton.setAttribute("aria-expanded", String(!legend.hidden));
    order = undefined;
    moved = false;
    const fitted = fitCameraIn(current.bounds, width, height, list);
    if (fitted.k >= legibleFrom(current)) go(fitted, false, true);
    else {
      // The start of the graph, in the largest room, at the zoom that shows every box in full: what is read first is
      // at its top left.
      const room = list.reduce((best, each) => ((width - each.l - each.r) * (height - each.t - each.b) > (width - best.l - best.r) * (height - best.t - best.b) ? each : best));
      const k = fullFrom(current);
      go({ ox: room.l - current.bounds.x * k, oy: room.t - current.bounds.y * k, k }, false);
    }
  }

  function zoom(factor: number, x = width / 2, y = height / 2): void {
    camera = zoomAt(camera, factor, x, y);
    heading = undefined;
    atFit = false;
    hideTip();
    invalidate();
  }

  /** After the details opened or closed, or a node was selected: the picture is brought beside the details. A picture
   * that was fitted is fitted again into the room that is left. Otherwise the camera moves just far enough that the node
   * selected and the boxes it has links with are in view, and no nearer. */
  function keepInView(): void {
    if (!onScreen || width <= 0 || height <= 0) return;
    if (atFit) {
      go(fitCameraIn(onScreen.bounds, width, height, rooms()), true, true);
      return;
    }
    if (!selected) return;
    const near = [selected, ...onScreen.in[selected.index].map(index => onScreen!.nodes[index]), ...onScreen.out[selected.index].map(index => onScreen!.nodes[index])].filter(node => isShown(node.index));
    const box = boxAround(near.length ? near : [selected], 8);
    if (!box) return;
    const from = heading ?? camera;
    let best: Camera | undefined;
    for (const room of rooms()) {
      const to = bringIntoView(from, box, width, height, room);
      const cost = (each: Camera): number => (from.k - each.k) * 1e6 + Math.abs(each.ox - from.ox) + Math.abs(each.oy - from.oy);
      if (!best || cost(to) < cost(best)) best = to;
    }
    if (best && best !== from) go(best, true);
  }

  /* ---------- the panels ---------- */

  const announce = (sentence: string): void => { live.textContent = sentence; };

  function refreshShown(): void {
    if (!onScreen) return;
    shownNodes = new Uint8Array(onScreen.nodes.length);
    shownCount = 0;
    for (const node of onScreen.nodes) {
      if (!hiddenLayers.has(node.layer) && (!onlyTrace || !trace || inTrace(trace, node.index))) {
        shownNodes[node.index] = 1;
        shownCount++;
      }
    }
  }

  /** The line that says what is shown, counted now: what the graph holds, how much of it is drawn, and how much of
   * that is in view where the camera is, or is going. With part of it out of view, one press shows it whole. */
  function renderStatus(): void {
    if (!onScreen) return;
    countedFor = camera;
    // In view is what stands in the graph's own room: a box under the bar or the details is not.
    inView = width > 0 && height > 0 ? countInView(onScreen.nodes, isShown, heading ?? camera, areaOf(free) ?? { left: 0, top: 0, right: width, bottom: height }) : shownCount;
    const said = statusWords(onScreen, shownCount, inView);
    if (stats.textContent !== said) stats.textContent = said;
    wholeButton.hidden = inView >= shownCount;
    // Beside a selection the bar of what is traced stands in the line's place, unless the line has more to say than what
    // the graph holds: that part of it is not drawn, or is out of view.
    status.hidden = selected !== undefined && shownCount >= onScreen.nodes.length && inView >= shownCount;
  }

  function renderLegend(): void {
    if (!onScreen) return;
    legend.innerHTML = legendHtml(onScreen.kind === "drill" ? "On this map" : "Sections", onScreen.layers, hiddenLayers);
    legendButton.hidden = onScreen.layers.length === 0;
  }

  function renderCrumbs(): void {
    if (!model || !onScreen) return;
    const module = view === "drill" ? model.node(moduleId) : undefined;
    const home = module && !single ? model.sectionOf(module) : undefined;
    // The model whole: its sections, or all its modules where it has no sections to show.
    const whole = onScreen.kind === "sections" || (single && onScreen.kind === "modules");
    crumbs.innerHTML = crumbsHtml({
      model: options.modelName, workspace: options.workspaceName,
      ...(home !== undefined && model.sectionIndex(home) >= 0 ? { section: { index: model.sectionIndex(home), name: home } } : {}),
      ...(whole ? {} : { here: onScreen.name }),
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
    groupToggle.hidden = view !== "modules" || single;
    groupToggle.textContent = sections ? "Show all modules" : "Group by section";
    sectionSelect.hidden = view !== "modules" || single;
    sectionSelect.value = section === undefined ? "" : String(model.sectionIndex(section));
    moduleSelect.hidden = view !== "drill";
    moduleSelect.value = moduleId === undefined ? "" : String(moduleId);
    externalToggle.hidden = view !== "drill";
    externalToggle.textContent = expanded ? "Group external items" : "Expand external items";
    accessToggle.checked = access;
  }

  function renderInspector(): void {
    root.classList.toggle("map-has-inspector", selected !== undefined);
    if (!model || !onScreen || !selected || !trace) {
      inspection = undefined;
      traced = undefined;
      inspector.hidden = true;
      inspector.innerHTML = "";
      tracebar.hidden = true;
      tracebar.innerHTML = "";
      return;
    }
    inspection = inspect(model, onScreen, selected, access);
    traced = traceWords(inspection, trace.up.size, trace.down.size);
    inspector.innerHTML = inspectorHtml(inspection, traced);
    inspector.hidden = false;
    inspector.scrollTop = 0;
    renderTracebar();
  }

  function renderTracebar(): void {
    if (!selected || !traced) return;
    tracebar.innerHTML = tracebarHtml(selected.fullName, traced, onlyTrace);
    tracebar.hidden = false;
  }

  function renderEmpty(): void {
    if (!model || !onScreen) return;
    const nothing = onScreen.nodes.length === 0;
    empty.hidden = !nothing;
    if (!nothing) empty.innerHTML = "";
    // Why there are none is the graph's to say, in whichever of its sentences: all of them are listed under the map's own.
    else if (model.modules.length === 0) empty.innerHTML = emptyHtml("No modules to draw", "This export holds no modules, so there is nothing to map.", graph.limitations);
    else empty.innerHTML = emptyHtml("Nothing to show here", onScreen.kind === "drill" ? "This module has no line items." : "This section has no modules.");
  }

  function renderChrome(): void {
    renderLegend();
    renderCrumbs();
    renderControls();
    renderInspector();
    renderEmpty();
    renderStatus();
  }

  function hideTip(): void {
    hovered = undefined;
    tooltip.classList.remove("map-show");
    canvas.classList.remove("map-over-node");
  }

  function showTip(node: ViewNode, x: number, y: number): void {
    if (!model) return;
    if (hovered !== node) {
      hovered = node;
      const raw = node.raw;
      const module = raw && raw.kind !== "module" ? model.node(model.moduleOf(raw)) : undefined;
      const hint = node.kind === "section" ? "Double-click to open its modules" : raw?.kind === "module" ? "Double-click to open its line items" : node.kind === "externalItem" ? "Double-click to go to it in its module" : "";
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

  /** Closes the search's results. The picture is marked for a search only while its results are open: a search that is
   * left leaves the picture as it was, with its text still in the box to go on from. */
  function closeResults(): void {
    results.hidden = true;
    if (matches) {
      matches = undefined;
      invalidate();
    }
  }

  /* ---------- views and selection ---------- */

  /** Builds the graph the view asks for, sizes its boxes to their names, and lays it out for the room it has. */
  function build(): void {
    if (!model || !fonts) return;
    onScreen = view === "drill" && moduleId !== undefined ? moduleGraph(model, moduleId, expanded, access)
      : grouped && section === undefined ? sectionsGraph(model, access) : modulesGraph(model, section, access);
    sizeNodes(onScreen, fonts.measure("label"), fonts.measure("item"));
    selected = selected && onScreen.byId.get(selected.id);
    trace = selected ? traceNode(onScreen, model, selected.index, access) : undefined;
    if (!selected) onlyTrace = false;
    refreshShown();
    matches = undefined;
    renderChrome();
    arrange();
    renderStatus();
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
    if (onScreen) announce(viewSentence(onScreen, options.modelName));
  }

  function select(node: ViewNode | undefined): void {
    if (!model || !onScreen) return;
    const had = selected !== undefined;
    selected = node;
    onlyTrace = false;
    trace = node ? traceNode(onScreen, model, node.index, access) : undefined;
    traceMovesUntil = env.now() + TRACE_MOVES;
    refreshShown();
    renderInspector();
    renderControls();
    renderStatus();
    if (node && traced) announce(traced.sentence);
    else if (had) announce("Selection cleared.");
    invalidate();
    if (node || had) keepInView();
  }

  /** Selects a node of the graph on screen by its name there. Where the picture is too small to tell the node, or the
   * node is out of view, the camera goes to it and the boxes it has links with. */
  function pick(id: string): void {
    const node = onScreen?.byId.get(id);
    if (!node || !onScreen) return;
    select(node);
    if (atFit && (heading ?? camera).k < TELLING_ZOOM) {
      const near = [node, ...onScreen.in[node.index].map(index => onScreen!.nodes[index]), ...onScreen.out[node.index].map(index => onScreen!.nodes[index])];
      const box = boxAround(near, 24);
      if (box) go(fitCameraIn(box, width, height, rooms(), 1), true);
    }
  }

  function openSection(index: number): void {
    if (!model || model.sections[index] === undefined) return;
    section = model.sections[index];
    grouped = false;
    setView("modules");
  }

  /** The model whole: its sections, or all its modules where it has no sections to show. */
  function showSections(): void {
    section = undefined;
    grouped = !single;
    setView("modules");
  }

  /** Goes to an object of the model, wherever it is, and selects it: a module among its section's modules, a line item
   * among its module's line items, anything else where it is on screen. */
  function navigate(raw: GraphNode): void {
    if (!model) return;
    if (raw.kind === "module") {
      section = single ? undefined : model.sectionOf(raw);
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
      if (selected !== node) select(node);
      setOnlyTrace(true);
    }
  }

  function setOnlyTrace(on: boolean): void {
    if (!onScreen || !selected || !trace) return;
    onlyTrace = on;
    refreshShown();
    renderTracebar();
    renderStatus();
    announce(on ? `Showing only the trace: ${plural(shownCount, "box", "boxes")}.` : "Showing the full graph.");
    if (on) {
      const box = boxAround(onScreen.nodes.filter(node => isShown(node.index)));
      if (box) go(fitCameraIn(box, width, height, rooms()), true);
    } else fit(true);
    invalidate();
  }

  /** One step back, as Escape takes it: the selection goes first, then a module's line items give way to the modules
   * last shown, and those to the model whole. Says whether there was a step to take. */
  function back(): boolean {
    if (selected) select(undefined);
    else if (view === "drill") setView("modules");
    else if (!single && (section !== undefined || !grouped)) showSections();
    else return false;
    return true;
  }

  function runSearch(): void {
    if (!search || !onScreen || !model) return;
    typed = searchInput.value;
    matches = matchNodes(onScreen, model, typed);
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
    closeResults();
    if (hit.kind === "section" && hit.section !== undefined) {
      showSections();
      pick(`section${hit.section}`);
    } else if (hit.node) navigate(hit.node);
    focusDetails();
  }

  /** Opens or closes one of the two panels that stand over the canvas. A picture that was fitted is fitted again into
   * the room that is left. */
  function setPanel(panel: HTMLElement, button: HTMLElement, open: boolean): void {
    panel.hidden = !open;
    button.setAttribute("aria-expanded", String(open));
    if (atFit) fit(true);
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
      case "focus":
        setOnlyTrace(!onlyTrace);
        focusOn(tracebar.querySelector<HTMLElement>('[data-map-act="focus"]'));
        break;
      case "fit": case "whole":
        if (onlyTrace) {
          onlyTrace = false;
          refreshShown();
          renderTracebar();
        }
        fit(true);
        renderStatus();
        break;
      case "zoom-in": zoom(1.3); break;
      case "zoom-out": zoom(1 / 1.3); break;
      case "legend":
        legendWanted = legend.hidden;
        setPanel(legend, legendButton, legendWanted);
        break;
      case "about": setPanel(about, aboutButton, about.hidden); break;
      case "layer": {
        const layer = data.mapLayer ?? "";
        if (hiddenLayers.has(layer)) hiddenLayers.delete(layer); else hiddenLayers.add(layer);
        const off = hiddenLayers.has(layer);
        target.classList.toggle("map-off", off);
        target.setAttribute("aria-pressed", String(!off));
        refreshShown();
        renderStatus();
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

  root.addEventListener("click", guarded(event => {
    if (!shown) return;
    const target = (event.target as Element | null)?.closest<HTMLElement>("[data-map-act]");
    const details = target ? inspector.contains(target) : false;
    if (target) act(target);
    // The focus stays in the map, so that its keys go on working: what was clicked may be gone with what it stood in,
    // and a click on a part that takes no focus (a panel's edge, the small picture) would leave it with the page.
    if (!hasFocus()) {
      if (details) focusDetails(); else focusOn(canvas);
    }
  }));

  // Focus that goes on from the search to something else closes the results, as a press elsewhere does; focus that
  // comes back to a box that still holds a text takes the search up again.
  root.addEventListener("focusout", guarded(event => {
    const from = event.target as Element | null;
    const to = (event as FocusEvent).relatedTarget as Element | null;
    if (from?.closest(".map-searchwrap") && to && !to.closest(".map-searchwrap")) closeResults();
  }));
  root.addEventListener("focusin", guarded(event => {
    if (shown && event.target === searchInput && results.hidden && searchText(searchInput.value) !== "") runSearch();
  }));

  root.addEventListener("change", guarded(event => {
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
      if (onScreen) announce(`${access ? "Access driver links are drawn." : "Access driver links are not drawn."} ${viewSentence(onScreen, options.modelName)}`);
    }
  }));

  root.addEventListener("input", guarded(event => {
    if (shown && event.target === searchInput) runSearch();
  }));

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
      focusOn(searchInput);
      closeResults();
    } else if (event.key === "ArrowDown") focusOn(buttons[Math.min(buttons.length - 1, at + 1)]);
    else if (at <= 0) focusOn(searchInput);
    else focusOn(buttons[at - 1]);
    return true;
  }

  /** A key anywhere else in the map. Only while the map is shown, and only for a key pressed inside it: the listener
   * is on the map's own element. A key with Ctrl, Alt or the command key is the browser's. */
  root.addEventListener("keydown", guarded(event => {
    const target = event.target as HTMLElement | null;
    if (!shown || !onScreen || !target) return;
    if (target === searchInput) return searchKey(event);
    if (results.contains(target) && resultsKey(event, target)) return;
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName) || event.ctrlKey || event.metaKey || event.altKey) return;
    let used = true;
    const key = event.key;
    if (key === "Escape" && !about.hidden && (about.contains(target) || target === aboutButton)) {
      // The notes about the map were opened to be read: Escape from them closes them, and goes no step back.
      setPanel(about, aboutButton, false);
      focusOn(aboutButton);
    } else if (key === "Escape") {
      const focused = hasFocus();
      used = back();
      if (focused && !hasFocus()) focusOn(canvas);
    } else if (key === "f" || key === "F") {
      fit(true);
      renderStatus();
    } else if (key === "+" || key === "=") zoom(1.2);
    else if (key === "-") zoom(1 / 1.2);
    else if (key === "/") focusOn(searchInput);
    else if (target === canvas && ARROWS[key]) {
      const [nearX, nearY] = toWorld(camera, width / 2, height / 2);
      const next = stepFrom(onScreen.nodes, isShown, selected, ARROWS[key], nearX, nearY);
      if (next) select(next);
      else announce(selected ? `No box ${ARROWS[key] === "up" ? "above" : ARROWS[key] === "down" ? "below" : `to the ${ARROWS[key]} of`} ${selected.fullName}.` : "No box on the map.");
    } else if (target === canvas && key === "Enter" && selected) enter(selected);
    else used = false;
    if (used) {
      event.preventDefault();
      event.stopPropagation();
    }
  }));

  // A press outside the search closes its results. Only presses inside the map are heard.
  root.addEventListener("pointerdown", guarded(event => {
    const target = event.target as Element | null;
    if (target && !target.closest(".map-searchwrap")) closeResults();
  }));

  /** A pointer's place in the canvas, in CSS pixels from its top left corner. */
  const place = (event: { clientX: number; clientY: number }): [number, number] => {
    const box = canvas.getBoundingClientRect();
    return [event.clientX - box.left, event.clientY - box.top];
  };

  canvas.addEventListener("pointerdown", guarded(event => {
    if (event.button !== 0 || !onScreen) return;
    const [x, y] = place(event);
    const node = hitNode(onScreen.nodes, isShown, camera, x, y, order);
    if (heading) {
      heading = undefined;
      atFit = false;
    }
    drag = { pointer: event.pointerId, node, x, y, ox: camera.ox, oy: camera.oy, nodeX: node?.x ?? 0, nodeY: node?.y ?? 0, moved: false };
    // The canvas keeps the pointer while it is down, so that a drag goes on outside it. A pointer the browser does not
    // know cannot be kept, and the drag then ends at the canvas's edge.
    try { canvas.setPointerCapture?.(event.pointerId); } catch { /* not kept */ }
    canvas.classList.add("map-dragging");
    hideTip();
  }));

  canvas.addEventListener("pointermove", guarded(event => {
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
        moved = true;
      } else {
        camera = { ox: drag.ox + dx, oy: drag.oy + dy, k: camera.k };
        atFit = false;
      }
      invalidate();
      return;
    }
    const node = hitNode(onScreen.nodes, isShown, camera, x, y, order);
    if (node) {
      canvas.classList.add("map-over-node");
      showTip(node, x, y);
    } else hideTip();
  }));

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

  /** Ends a drag wherever it is: the canvas lets the pointer go, and no longer says that it is being dragged. */
  function endDrag(): void {
    if (drag) {
      try { if (canvas.hasPointerCapture?.(drag.pointer)) canvas.releasePointerCapture(drag.pointer); } catch { /* not kept */ }
    }
    drag = undefined;
    canvas.classList.remove("map-dragging");
  }

  canvas.addEventListener("pointerup", guarded(event => {
    if (!drag || !onScreen) return;
    const held = drag;
    endDrag();
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
    if (held.node) lastPress = { node: held.node, time: now, x: held.x, y: held.y };
    if (node) letThrough();
    select(node);
  }));

  canvas.addEventListener("pointercancel", guarded(() => endDrag()));

  canvas.addEventListener("pointerleave", guarded(() => hideTip()));

  canvas.addEventListener("wheel", guarded(event => {
    event.preventDefault();
    const [x, y] = place(event);
    const lines = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? height : 1;
    // A pinch on a trackpad comes as a wheel with Ctrl held, in small steps.
    const factor = Math.exp(-event.deltaY * lines * (event.ctrlKey ? 0.012 : 0.0012));
    zoom(Math.min(2, Math.max(0.5, factor)), x, y);
  }), { passive: false });

  miniCanvas.addEventListener("pointerdown", guarded(event => {
    if (!minimap) return;
    const box = miniCanvas.getBoundingClientRect();
    const scale = box.width > 0 ? MINIMAP.width / box.width : 1;
    const worldX = ((event.clientX - box.left) * scale - minimap.ox) / minimap.s;
    const worldY = ((event.clientY - box.top) * scale - minimap.oy) / minimap.s;
    go(centreOn(camera, worldX, worldY, width, height), true);
  }));

  // A size told while the map is hidden is no size to draw at: `show` measures the canvas itself. Where the size cannot
  // be watched at all the map is not mounted: its element is taken out again, and the page is told why.
  try {
    stopWatching = env.watchSize(canvas, (nextWidth, nextHeight) => {
      if (shown) guard(() => resize(nextWidth, nextHeight));
    });
  } catch (error) {
    root.remove();
    throw error;
  }

  // The browser can lose what a canvas is drawn with, when its graphics process starts again, and gives it back empty:
  // the picture is drawn again then, without waiting for the user to do something.
  canvas.addEventListener("contextrestored", guarded(() => invalidate()));
  miniCanvas.addEventListener("contextrestored", guarded(() => invalidate()));

  /** What is done once, at the first showing: the model is looked up, and the first view built. A model whose modules
   * stand under one heading, or under none, opens on its modules: one box named after that heading would say nothing. */
  function start(): void {
    if (model) return;
    model = indexModel(graph);
    single = model.sections.length <= 1;
    search = createSearch(model, !single);
    grouped = !single;
    sectionSelect.innerHTML = sectionOptionsHtml(model.sections);
    moduleSelect.innerHTML = moduleOptionsHtml(model.modules);
    notes.innerHTML = notesHtml({ name: options.modelName, workspace: options.workspaceName, modules: model.modules.length, lineItems: model.lineItems.length }, graph.limitations, graph.unresolved.length);
    build();
  }

  return {
    show() {
      if (destroyed) return;
      const wasShown = shown;
      shown = true;
      root.hidden = false;
      // A map that stopped after a failure has only its sentence to show.
      if (broken) return;
      readTheme();
      start();
      // The canvas is measured as its size is told from then on, in fractions of a pixel, so that the first telling is
      // no new size. A picture is drawn at once where the size is new, and asked for where it is not: one for each show.
      drawn = false;
      const box = canvas.getBoundingClientRect();
      if (box.width > 0 && box.height > 0) resize(box.width, box.height);
      if (!drawn) invalidate();
      if (!wasShown) takeFocus();
    },
    hide() {
      if (destroyed) return;
      shown = false;
      root.hidden = true;
      if (broken) return;
      stopDrawing();
      settle();
      hideTip();
      closeResults();
      endDrag();
    },
    themeChanged() {
      if (destroyed || broken || !shown) return;
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
