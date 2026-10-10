import type { GraphNode, ModelGraph, ModelMap, ModelMapOptions } from "./graph-types.js";
import { boxAround, bringIntoView, centreOn, countInView, defaultInsets, easeCamera, fitCameraIn, hitNode, insetsOf, roomsBeside, stepFrom, toWorld, zoomAt, type Area, type Camera, type Direction, type Insets, type MinimapTransform } from "./map-camera.js";
import { createFonts, drawMinimap, drawScene, legibleFrom, type Fonts, type Pen } from "./map-canvas.js";
import { moduleGraph, modulesGraph, sectionsGraph, type Box, type ViewGraph, type ViewNode } from "./map-graphs.js";
import { inspect, statusWords, traceWords, viewSentence, type Inspection, type TraceWords } from "./map-inspect.js";
import { boundsOf, fullFrom, layoutGraph, sizeNodes } from "./map-layout.js";
import { automaticGrouping, groupingsOf, type Grouping } from "./map-groups.js";
import {
  brokenHtml, emptyHtml, FULL_SAYS, fullIconHtml, groupingOptionsHtml, groupOptionsHtml, inspectorHtml, legendHtml, listHtml, notesHtml, pathRootHtml, pickerOptionsHtml, resultsHtml,
  shellHtml, SHOW_GROUPS, SHOW_MODULES, showOptionsHtml, tooltipHtml, tracebarHtml, type Tip,
} from "./map-markup.js";
import { indexModel, withGrouping, type MapModel } from "./map-model.js";
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
  /** The browser's full screen: asks for an element to fill the screen, which fails where the browser refuses or has
   * none; leaves it; and says which element of the element's page fills the screen now, if any. */
  requestFullscreen(element: Element): Promise<void>;
  exitFullscreen(element: Element): Promise<void>;
  fullscreenElement(element: Element): Element | null;
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
    requestFullscreen: element => (typeof element.requestFullscreen === "function" ? element.requestFullscreen() : Promise.reject(new Error("this browser has no full screen"))),
    exitFullscreen: element => {
      const page = element.ownerDocument;
      return page.fullscreenElement && typeof page.exitFullscreen === "function" ? page.exitFullscreen() : Promise.resolve();
    },
    fullscreenElement: element => element.ownerDocument.fullscreenElement ?? null,
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
/** Up to this width of the map the legend and the notes about the map are not shown side by side (map.css puts the
 * details under the graph from the same width down). */
const NARROW = 760;
/** How many modules the module picker lists at once: a model of hundreds is narrowed by typing. */
export const PICKER_CAP = 200;
/** What the graph files a module under that has no heading row above it (graph-types.ts `group`). */
const NO_HEADING = "Ungrouped";
/** A colour no token holds: what a canvas still answers after a value it did not take was a colour. */
const NO_COLOUR = "#010203";

let mounted = 0;

/** A failure's own words: as the map says them in its own place, and as the page's log takes them, with the kind of
 * error before them. A value that cannot be made a text, or an error whose words cannot be read, has none. */
function reasonOf(error: unknown): { said: string; logged: string } {
  try {
    if (error instanceof Error) {
      const message = String(error.message ?? "");
      return { said: message, logged: `${String(error.name || "Error")}: ${message}` };
    }
    const text = String(error ?? "");
    return { said: text, logged: text === "" ? "no reason given" : text };
  } catch {
    return { said: "", logged: "a failure that cannot be put into words" };
  }
}

/** `mountModelMap` with the surroundings handed in. */
export function mountModelMapIn(host: HTMLElement, graph: ModelGraph, options: ModelMapOptions, env: MapEnvironment): ModelMap {
  const page = host.ownerDocument ?? document;
  const number = ++mounted;
  const root = page.createElement("div");
  root.setAttribute("class", "map-root");
  root.hidden = true;
  const pickerId = `map-picker-${number}`;
  root.innerHTML = shellHtml({ results: `map-results-${number}`, hints: `map-hints-${number}`, legend: `map-legend-${number}`, about: `map-about-${number}`, access: `map-access-${number}`, links: `map-links-${number}`, picker: pickerId }, options.modelName);
  host.appendChild(root);

  const part = <T extends HTMLElement = HTMLElement>(selector: string): T => root.querySelector(selector) as T;
  const canvas = part<HTMLCanvasElement>(".map-canvas");
  const miniCanvas = part<HTMLCanvasElement>(".map-minimap");
  const stats = part(".map-stats");
  const wholeButton = part<HTMLButtonElement>('[data-map-act="whole"]');
  const notes = part(".map-notes");
  const pathRoot = part(".map-path-root");
  const showSelect = part<HTMLSelectElement>(".map-show-select");
  const groupSelect = part<HTMLSelectElement>(".map-group-select");
  const picker = part(".map-picker");
  const pickerInput = part<HTMLInputElement>(".map-picker-input");
  const pickerPop = part(".map-picker-pop");
  const pickerList = part(".map-picker-list");
  const pickerNote = part(".map-picker-note");
  const separators = { show: part('[data-map-sep="show"]'), group: part('[data-map-sep="group"]'), module: part('[data-map-sep="module"]') };
  const buildZone = part(".map-zone-build");
  const groupingField = part(".map-grouping-field");
  const groupingSelect = part<HTMLSelectElement>(".map-grouping-select");
  const externalCheck = part(".map-external-check");
  const externalToggle = part<HTMLInputElement>(".map-external");
  const links = part(".map-links");
  const linksButton = part<HTMLButtonElement>('[data-map-act="links"]');
  const linksPop = part(".map-links-pop");
  const accessToggle = part<HTMLInputElement>(".map-access");
  const fullButton = part<HTMLButtonElement>('[data-map-act="fullscreen"]');
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
  /** The model with its sections as the graph's heading rows give them: what every grouping of its modules starts from. */
  let base: MapModel | undefined;
  /** The ways this model's modules can be grouped (map-groups.ts), and the one the map picks by itself. */
  let groupings: Grouping[] = [];
  let automatic: Grouping | undefined;
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
  /** Whether the picture is to show the whole graph: it was fitted so as it opened, or the user asked for the whole of
   * it (F, Fit, Whole map), and has not moved it since. It is then fitted again whenever its room changes, as far as
   * its names stay readable, and when a selection that moved it is cleared. */
  let wantsWhole = false;
  /** For a picture that is not to show the whole graph: where the camera stood before a selection moved it. It goes
   * back there when the selection is cleared, unless the user has moved it since. */
  let rest: Camera | undefined;
  /** Whether a node was dragged: the graph then keeps its places when the room changes. */
  let moved = false;
  let selected: ViewNode | undefined;
  let trace: Trace | undefined;
  let traced: TraceWords | undefined;
  let inspection: Inspection | undefined;
  /** Whether the view keeps to the trace: only the node selected and what it reads and feeds are shown. */
  let onlyTrace = false;
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
  let drag: { pointer: number; node: ViewNode | undefined; x: number; y: number; ox: number; oy: number; nodeX: number; nodeY: number; moved: boolean; home?: { wantsWhole: boolean; rest: Camera | undefined } } | undefined;
  /** The last press on a node that was no drag: a second one at the same place soon after goes into that node. */
  let lastPress: { node: ViewNode; time: number; x: number; y: number } | undefined;
  /** The timer that lets presses through the details for a moment after a press opened them. */
  let arriving: ReturnType<typeof setTimeout> | undefined;
  /** Ends the watching of the canvas's size (set once the watching has begun). */
  let stopWatching: () => void = () => undefined;
  /** The module picker of the Line items view: whether its list is open, what was typed into it since it opened, the
   * group the path's list narrowed it to (`pickerChosen`, where one was chosen there: no group is every group), the
   * modules it lists, and the one the arrows are on. Closed, it names the module shown. */
  let pickerOpen = false;
  let pickerQuery = "";
  let pickerChosen = false;
  let pickerGroup: string | undefined;
  let pickerModules: GraphNode[] = [];
  let pickerActive = -1;
  /** Whether the map fills the browser's window because the browser would not give it the screen. */
  let fullWindow = false;

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
    // A trace's dashes move for as long as the trace is on screen, unless the user asked for less motion: then they stand.
    const moves = motion();
    const scene = { graph: onScreen, camera, width, height, palette, shown: shownNodes, trace, matches, order, time: moves ? time : undefined };
    pen.setTransform(ratio, 0, 0, ratio, 0, 0);
    const tracing = drawScene(pen, scene, fonts);
    if (miniPen) {
      miniPen.setTransform(ratio, 0, 0, ratio, 0, 0);
      minimap = drawMinimap(miniPen, scene, MINIMAP.width, MINIMAP.height);
    }
    // The line at the foot says what is in view where the camera has come to rest: it is written for where the camera
    // is going as soon as it sets out (`go`), and here for a camera the user has moved.
    if (!moving && countedFor !== camera && !drag) renderStatus();
    // Another picture is asked for only while something moves: the camera on its way, or the dashes of a trace on
    // screen. A picture that has settled is never drawn again by itself.
    if (moving || (tracing && moves)) {
      lastFrame = time;
      frame = env.requestFrame(drawFrame);
    } else lastFrame = 0;
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
    const reason = reasonOf(error);
    root.innerHTML = brokenHtml(reason.said);
    if (inside) focusOn(root.querySelector<HTMLElement>(".map-broken"));
    // The page hears of it once, for its log. What the page then does is its own, and so is a failure of that.
    try { options.onFailure?.(reason.logged); } catch { /* the page's */ }
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
    // A picture that shows the whole graph is laid out for the new room and fitted again, so that it grows and shrinks
    // with its place; one in which a box was dragged keeps its places. One the user has moved keeps its middle where it was.
    if (needsFit || !laidOut || (wantsWhole && !moved)) arrange();
    else if (wantsWhole) reframe(false);
    else {
      const shift = (to: Camera): Camera => ({ ox: to.ox + (width - laidOut!.width) / 2, oy: to.oy + (height - laidOut!.height) / 2, k: to.k });
      camera = shift(camera);
      if (heading) heading = shift(heading);
      if (rest) rest = shift(rest);
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

  /** The rooms the panels leave the picture, measured where the page is laid out: the part of the canvas under the bar
   * and beside the details (`map-free`), clear of what stands in it: the legend and the notes while they are open, the
   * line of what is shown, and the small picture. None where the panels leave no room worth the name; nothing where
   * the page is not laid out. */
  function freeRooms(): Insets[] | undefined {
    const freeArea = areaOf(free);
    if (!freeArea || freeArea.right - freeArea.left <= 2 * FIT_MARGIN || freeArea.bottom - freeArea.top <= 2 * FIT_MARGIN) return undefined;
    const panels = [areaOf(legend), areaOf(about), areaOf(dock), areaOf(corner)].filter((area): area is Area => area !== undefined);
    return roomsBeside(freeArea, panels).map(room => insetsOf(room, width, height, FIT_MARGIN)).filter(room => width - room.l - room.r > 80 && height - room.t - room.b > 60);
  }

  /** The rooms a graph can be fitted into: those the panels leave it, or the whole free part where they leave none. */
  function rooms(): Insets[] {
    const found = freeRooms();
    if (!found) return [defaultInsets(width, height, selected !== undefined)];
    const freeArea = areaOf(free);
    return found.length || !freeArea ? found : [insetsOf(freeArea, width, height, FIT_MARGIN)];
  }

  /** Sets where the picture is seen from, at once or over a few frames. The line at the foot says from that moment what
   * is in view where the camera comes to rest. */
  function go(to: Camera, animate: boolean): void {
    if (animate && shown && motion()) heading = to;
    else {
      camera = to;
      heading = undefined;
    }
    hideTip();
    renderStatus();
    invalidate();
  }

  /** The user has taken the camera somewhere: it stays where they put it. */
  function ownCamera(): void {
    wantsWhole = false;
    rest = undefined;
  }

  /** What the whole picture covers: every box of the graph, or those of the trace while the view keeps to it. */
  function wholeBox(current: ViewGraph): Box {
    return (onlyTrace ? boxAround(current.nodes.filter(node => isShown(node.index))) : undefined) ?? current.bounds;
  }

  /** The least zoom a refit goes to: the zoom from which every box of the graph holds a readable line. A picture the
   * user has taken further away than that is taken no further. */
  const leastZoom = (current: ViewGraph, from: Camera): number => Math.min(legibleFrom(current), from.k) - 1e-9;

  /** Shows the whole picture at once, as the user asks for it (F, Fit, Whole map), however small that makes it. */
  function fit(animate: boolean): void {
    if (!onScreen || width <= 0 || height <= 0) {
      needsFit = true;
      return;
    }
    needsFit = false;
    wantsWhole = true;
    rest = undefined;
    footFor(true);
    go(fitCameraIn(wholeBox(onScreen), width, height, rooms()), animate);
  }

  /** Opens or closes the legend for the room there is now, until the user says which they want: open where every box is
   * drawn in full beside it, or where it costs the whole picture next to nothing and none of its names; closed
   * otherwise, so that in a small room the legend goes before the names do. `fitted` says how large the whole picture
   * is fitted into some rooms; where it also lays the graph out for them, each state of the legend is tried with its
   * own layout. Gives the rooms that are left. Focus that was in a legend that goes is kept in the map, on its button. */
  function settleLegend(current: ViewGraph, floor: number, fitted: (list: Insets[]) => number): Insets[] {
    const held = legend.contains(page.activeElement) ? (page.activeElement as HTMLElement) : undefined;
    let list: Insets[];
    if (legendWanted !== undefined || current.layers.length === 0) {
      legend.hidden = !(legendWanted === true && current.layers.length > 0);
      list = rooms();
      fitted(list);
    } else {
      legend.hidden = true;
      const closed = fitted(rooms());
      legend.hidden = false;
      list = rooms();
      const open = fitted(list);
      if (!(open >= fullFrom(current) || (open >= closed * 0.94 && open >= floor))) {
        legend.hidden = true;
        list = rooms();
        fitted(list);
      }
    }
    legendButton.setAttribute("aria-expanded", String(!legend.hidden));
    if (held) focusOn(legend.hidden ? legendButton : held);
    return list;
  }

  /** The camera that has a box of the graph in view in one of the rooms, from where the camera is: moved no further
   * than it must be and brought no nearer, with the boxes it has links with where those fit as well, and never further
   * away than `floor`. Where not even the box alone fits so, the camera stays. */
  function beside(current: ViewGraph, node: ViewNode, list: readonly Insets[], from: Camera, floor: number): Camera {
    const linked = [node, ...current.in[node.index].map(index => current.nodes[index]), ...current.out[node.index].map(index => current.nodes[index])].filter(each => isShown(each.index));
    const cost = (to: Camera): number => (from.k - to.k) * 1e6 + Math.abs(to.ox - from.ox) + Math.abs(to.oy - from.oy);
    for (const box of [boxAround(linked, 8), boxAround([node], 8)]) {
      if (!box) continue;
      let best: Camera | undefined;
      for (const room of list) {
        const to = bringIntoView(from, box, width, height, room);
        if (to.k >= floor && (!best || cost(to) < cost(best))) best = to;
      }
      if (best) return best;
    }
    return from;
  }

  /** Lays the graph out for the room it has and shows it, as a view opens and as its place changes size.
   *
   * A graph that would be fitted too small for every box to hold a readable line is not shown whole: it opens on its
   * start at the zoom that shows every box in full, the line at the foot says how much of it that is, and one press
   * shows it whole. This is the rule every later move of the camera keeps to (`reframe`). */
  function arrange(): void {
    if (!onScreen) return;
    if (width <= 0 || height <= 0) {
      needsFit = true;
      return;
    }
    needsFit = false;
    const current = onScreen;
    const floor = legibleFrom(current) - 1e-9;
    // The room is measured with the foot as it is beside a whole picture: with a box selected, the line of what is
    // shown gives way to the bar of what is traced.
    footFor(true);
    let list = settleLegend(current, floor, each => {
      layoutGraph(current, each.map(room => ({ width: width - room.l - room.r, height: height - room.t - room.b })));
      return fitCameraIn(current.bounds, width, height, each).k;
    });
    order = undefined;
    moved = false;
    rest = undefined;
    const whole = fitCameraIn(wholeBox(current), width, height, list);
    wantsWhole = whole.k >= floor;
    if (wantsWhole) {
      go(whole, false);
      return;
    }
    // The start of the graph, in the largest room, at the zoom that shows every box in full: what is read first is at
    // its top left. A box that is selected is brought into view from there. The line at the foot will say how much
    // is in view: the room is measured with it.
    footFor(false);
    list = rooms();
    const room = list.reduce((best, each) => ((width - each.l - each.r) * (height - each.t - each.b) > (width - best.l - best.r) * (height - best.t - best.b) ? each : best));
    const k = fullFrom(current);
    const start: Camera = { ox: room.l - current.bounds.x * k, oy: room.t - current.bounds.y * k, k };
    const to = selected ? beside(current, selected, list, start, floor) : start;
    if (to !== start) rest = start;
    go(to, false);
  }

  /** Puts the camera where the picture is to be seen from, for the room there is now: after a selection, and after the
   * details or a panel opened or closed. The opening's rule holds every time: the picture is never taken so far away
   * that a box no longer holds a readable line.
   * - A picture that is to show the whole graph is fitted whole where that can be read; in a room too small for it the
   *   legend closes first, where the user has not asked for it.
   * - Otherwise, with a box selected, the camera moves just far enough to have it in view beside the details, with the
   *   boxes it has links with where those fit too. With none selected, it goes back to where it stood before a
   *   selection moved it.
   * The line at the foot says how much of the graph is then in view. */
  function reframe(animate: boolean): void {
    if (!onScreen) return;
    if (width <= 0 || height <= 0) {
      needsFit = true;
      return;
    }
    const current = onScreen;
    const from = heading ?? camera;
    const floor = leastZoom(current, from);
    if (wantsWhole) {
      // Beside a whole picture the line at the foot gives way to the bar of what is traced: the room is measured so.
      footFor(true);
      const list = settleLegend(current, floor, each => fitCameraIn(wholeBox(current), width, height, each).k);
      const whole = fitCameraIn(wholeBox(current), width, height, list);
      if (whole.k >= floor) {
        go(whole, animate);
        return;
      }
    }
    if (selected) {
      // Not whole: the line may have to say how much is in view. The room is measured with it at the foot.
      footFor(false);
      const to = beside(current, selected, rooms(), from, floor);
      if (to === from) renderStatus();
      else {
        if (!wantsWhole) rest ??= from;
        go(to, animate);
      }
    } else if (rest) {
      const back = rest;
      rest = undefined;
      go(back, animate);
    } else renderStatus();
  }

  function zoom(factor: number, x = width / 2, y = height / 2): void {
    camera = zoomAt(camera, factor, x, y);
    heading = undefined;
    ownCamera();
    hideTip();
    invalidate();
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
   * that is in view where the camera is, or where it is going: the line says at once what will be true when the camera
   * has come to rest. With part of the graph out of view, one press shows it whole. */
  function renderStatus(): void {
    if (!onScreen) return;
    const at = heading ?? camera;
    countedFor = at;
    // The line's own words can move what it counts by: in a narrow foot a longer line, or its button, takes the foot to
    // another row, and the legend and the notes stand on the foot. So the count is made again with the foot as the line
    // has left it, until the two agree: at once wherever the foot keeps its height.
    let counted: string | undefined;
    for (let pass = 0; pass < 3; pass++) {
      // In view is what stands in the graph's own room: a box under the bar or the details is not, nor is one under the
      // legend, the notes or the small picture.
      const covered = [areaOf(legend), areaOf(about), areaOf(corner)].filter((area): area is Area => area !== undefined);
      const places = covered.map(area => `${area.left} ${area.top} ${area.right} ${area.bottom}`).join(", ");
      if (places === counted) break;
      counted = places;
      inView = width > 0 && height > 0 ? countInView(onScreen.nodes, isShown, at, areaOf(free) ?? { left: 0, top: 0, right: width, bottom: height }, covered) : shownCount;
      // Beside a selection the bar of what is traced stands in the line's place, unless the line has more to say than
      // what the graph holds: that part of it is not drawn, or is out of view. It then says that alone.
      const said = statusWords(onScreen, shownCount, inView, selected !== undefined);
      if (stats.textContent !== said) stats.textContent = said;
      wholeButton.hidden = inView >= shownCount;
      status.hidden = selected !== undefined && shownCount >= onScreen.nodes.length && inView >= shownCount;
    }
  }

  /** Puts the line at the foot as it will stand beside a picture that is whole, or beside one that is not, before the
   * room for the picture is measured: the line's words and its button can take the foot to another row, and the legend
   * and the notes stand on the foot. Once the camera is chosen, `renderStatus` says what is counted. */
  function footFor(whole: boolean): void {
    if (!onScreen) return;
    // Not whole: the longest the line can be, with one box out of view.
    const said = statusWords(onScreen, shownCount, whole ? shownCount : Math.max(0, shownCount - 1), selected !== undefined);
    if (stats.textContent !== said) stats.textContent = said;
    wholeButton.hidden = whole;
    status.hidden = whole && selected !== undefined && shownCount >= onScreen.nodes.length;
  }

  function renderLegend(): void {
    if (!onScreen) return;
    // A model that has no sections to show has none in its legend either: its modules are one entry, as what they are.
    legend.innerHTML = legendHtml(onScreen.kind === "drill" || single ? "On this map" : "Sections", onScreen.layers, hiddenLayers);
    legendButton.hidden = onScreen.layers.length === 0;
  }

  /** The group the module shown stands in, where the model has groups to show. */
  function homeOf(id: number | undefined): string | undefined {
    const module = model?.node(id);
    return model && module && !single ? model.sectionOf(module) : undefined;
  }

  /** The path says where the map is, and is the way elsewhere. Its first step is the model's name. In the Modules view
   * its list says what is shown: the groups as a whole, all modules, or one group's. In the Line items view it names the
   * module's group, which narrows the module picker after it, and the module. A model with no groups to show has no list
   * of them. */
  function renderPath(): void {
    if (!model || !onScreen) return;
    const drill = view === "drill";
    // The model whole: its groups, or all its modules where it has no groups to show.
    const whole = onScreen.kind === "sections" || (single && onScreen.kind === "modules");
    pathRoot.innerHTML = pathRootHtml(options.modelName, options.workspaceName, whole);
    showSelect.hidden = separators.show.hidden = drill || single;
    showSelect.value = section !== undefined ? String(model.sectionIndex(section)) : grouped ? SHOW_GROUPS : SHOW_MODULES;
    groupSelect.hidden = separators.group.hidden = !drill || single;
    picker.hidden = separators.module.hidden = !drill;
    // An open picker keeps what is being typed into it, and the group it was narrowed to.
    if (pickerOpen) return;
    pickerChosen = false;
    pickerGroup = undefined;
    const home = drill ? homeOf(moduleId) : undefined;
    groupSelect.value = home === undefined ? "" : String(model.sectionIndex(home));
    pickerInput.value = drill ? model.node(moduleId)?.name ?? "" : "";
  }

  function renderControls(): void {
    if (!model) return;
    for (const tab of root.querySelectorAll<HTMLButtonElement>(".map-tab")) {
      const active = tab.dataset.mapView === view;
      tab.classList.toggle("map-active", active);
      tab.setAttribute("aria-pressed", String(active));
      if (tab.dataset.mapView === "drill") tab.disabled = model.modules.length === 0;
    }
    // How the map is built: how the modules are grouped, where the model can be grouped more than one way, among the
    // modules; and among a module's line items, whether those of other modules stand one by one.
    groupingField.hidden = view !== "modules" || groupings.length < 2;
    groupingSelect.value = model.grouping?.kind ?? "";
    externalCheck.hidden = view !== "drill";
    externalToggle.checked = expanded;
    buildZone.hidden = groupingField.hidden && externalCheck.hidden;
    accessToggle.checked = access;
    // Which links are drawn is said on the button too, where more than formulas are.
    linksButton.classList.toggle("map-on", access);
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
    // With nothing drawn there is nothing to zoom, and no small picture of it.
    corner.hidden = nothing;
    if (!nothing) empty.innerHTML = "";
    // Why there are none is the graph's to say, in whichever of its sentences: all of them are listed under the map's own.
    else if (model.modules.length === 0) empty.innerHTML = emptyHtml("No modules to draw", "This export holds no modules, so there is nothing to map.", graph.limitations);
    else empty.innerHTML = emptyHtml("Nothing to show here", onScreen.kind === "drill" ? "This module has no line items." : "This section has no modules.");
  }

  function renderChrome(): void {
    renderLegend();
    renderPath();
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

  /* ---------- the module picker ---------- */

  /** The group the picker keeps to: the one chosen in the path's list, where one was; otherwise the module's own group
   * until something is typed, and then every group, for a name is looked for among all modules. */
  function pickerScope(): string | undefined {
    if (pickerChosen) return pickerGroup;
    return searchText(pickerQuery) === "" ? homeOf(moduleId) : undefined;
  }

  /** The modules the picker offers: those of the group it keeps to, or all, whose name holds what was typed. */
  function pickerMatches(): GraphNode[] {
    if (!model) return [];
    const typed = searchText(pickerQuery);
    const scope = pickerScope();
    return model.modules.filter(module => (scope === undefined || model?.sectionOf(module) === scope) && (typed === "" || module.name.toLowerCase().includes(typed)));
  }

  /** Writes the picker's list: the first of its modules, with the one the arrows are on, and a line where there are more. */
  function renderPicker(): void {
    if (!model) return;
    const all = pickerMatches();
    pickerModules = all.slice(0, PICKER_CAP);
    pickerActive = pickerModules.length ? Math.min(Math.max(pickerActive, 0), pickerModules.length - 1) : -1;
    // A list of one group's modules has no need to name the group on each line.
    const named = !single && pickerScope() === undefined;
    pickerList.innerHTML = pickerOptionsHtml(pickerId, pickerModules.map(module => ({ name: module.name, ...(named && model ? { group: model.sectionOf(module) } : {}) })), pickerActive);
    pickerNote.hidden = all.length > 0 && all.length <= pickerModules.length;
    pickerNote.textContent = all.length === 0 ? "No module's name holds that." : `First ${formatCount(pickerModules.length)} of ${formatCount(all.length)} modules. Type to narrow.`;
    if (pickerActive >= 0) pickerInput.setAttribute("aria-activedescendant", `${pickerId}-${pickerActive}`);
    else pickerInput.removeAttribute("aria-activedescendant");
    pickerList.querySelector<HTMLElement>(".map-active")?.scrollIntoView?.({ block: "nearest" });
  }

  /** Opens the picker's list: every module of its group until something is typed, from the module shown. */
  function openPicker(): void {
    if (!model || view !== "drill") return;
    closeLinks();
    pickerOpen = true;
    pickerQuery = "";
    pickerActive = Math.max(0, pickerMatches().findIndex(module => module.id === moduleId));
    renderPicker();
    pickerPop.hidden = false;
    pickerInput.setAttribute("aria-expanded", "true");
    pickerInput.select?.();
  }

  /** Closes the picker's list. The path names the module shown, and its group, again. */
  function closePicker(): void {
    if (!pickerOpen) return;
    pickerOpen = false;
    pickerPop.hidden = true;
    pickerList.innerHTML = "";
    pickerModules = [];
    pickerInput.setAttribute("aria-expanded", "false");
    pickerInput.removeAttribute("aria-activedescendant");
    renderPath();
  }

  /** Shows the line items of a module the picker lists, and gives the map the focus, for its keys. */
  function pickModule(index: number): void {
    const module = pickerModules[index];
    if (!module) return;
    closePicker();
    setView("drill", module.id);
    focusOn(canvas);
  }

  /** A key in the picker: the arrows go through its list, Enter shows the module the arrows are on, Escape closes the list,
   * and from a closed list goes back to the map. */
  function pickerKey(event: KeyboardEvent): void {
    const key = event.key;
    if (key !== "ArrowDown" && key !== "ArrowUp" && key !== "Enter" && key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    if (key === "Escape") {
      if (pickerOpen) closePicker(); else focusOn(canvas);
      return;
    }
    if (!pickerOpen) {
      openPicker();
      return;
    }
    if (key === "Enter") pickModule(pickerActive);
    else {
      pickerActive = key === "ArrowDown" ? Math.min(pickerModules.length - 1, pickerActive + 1) : Math.max(0, pickerActive - 1);
      renderPicker();
    }
  }

  /* ---------- the links shown, and full screen ---------- */

  function setLinks(open: boolean): void {
    if (open) closePicker();
    linksPop.hidden = !open;
    linksButton.setAttribute("aria-expanded", String(open));
  }
  /** Closes the panel of links. Focus that was in it is kept in the map, on its button. */
  function closeLinks(): void {
    if (linksPop.hidden) return;
    const held = linksPop.contains(page.activeElement);
    setLinks(false);
    if (held) focusOn(linksButton);
  }

  /** Whether the browser gives the map the screen now. */
  function onScreenWhole(): boolean {
    try {
      return env.fullscreenElement(root) === root;
    } catch {
      return false;
    }
  }

  /** The full screen button says what it does from the state the map is in, whichever way it came to be in it. */
  function renderFull(): void {
    const whole = fullWindow || onScreenWhole();
    root.classList.toggle("map-full-window", fullWindow);
    const said = whole ? FULL_SAYS.leave : FULL_SAYS.enter;
    fullButton.setAttribute("aria-pressed", String(whole));
    fullButton.setAttribute("aria-label", said);
    fullButton.title = said;
    fullButton.innerHTML = fullIconHtml(whole);
  }

  /** Fills the screen with the map, and leaves it. The browser is asked for the screen first; where it refuses, the map
   * fills the window instead. Either way the canvas is told its new size, and draws for it. */
  function setFull(on: boolean): void {
    if (on) {
      if (fullWindow || onScreenWhole()) return;
      let asked: Promise<void>;
      try {
        asked = env.requestFullscreen(root);
      } catch (error) {
        asked = Promise.reject(error);
      }
      asked.then(() => guard(renderFull), () => guard(() => {
        if (destroyed || !shown) return;
        fullWindow = true;
        renderFull();
        announce("The map fills the window. Escape leaves it.");
      }));
      return;
    }
    if (fullWindow) {
      fullWindow = false;
      renderFull();
      announce("The map is back in its place.");
    } else if (onScreenWhole()) {
      try {
        env.exitFullscreen(root).catch(() => undefined);
      } catch { /* the browser keeps it */ }
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
    refreshShown();
    renderInspector();
    if (node && traced) announce(traced.sentence);
    else if (had) announce("Selection cleared.");
    invalidate();
    // The details opened or closed, or another box is selected: the picture is brought beside them.
    if (node || had) reframe(true);
    else renderStatus();
  }

  /** Selects a box of the graph on screen by its name there: from the search, or from a link of the details. Where the
   * picture is too far away to tell the box, the camera comes to it: with the boxes it has links with where all of them
   * are then drawn in full, and otherwise to the box alone, drawn in full. */
  function pick(id: string): void {
    const current = onScreen;
    const node = current?.byId.get(id);
    if (!node || !current) return;
    select(node);
    const from = heading ?? camera;
    if (from.k >= TELLING_ZOOM || width <= 0 || height <= 0) return;
    const full = fullFrom(current);
    // The camera comes close: part of the graph will be out of view, and the line at the foot will say so.
    footFor(false);
    const list = rooms();
    const linked = boxAround([node, ...current.in[node.index].map(index => current.nodes[index]), ...current.out[node.index].map(index => current.nodes[index])], 24);
    let to = linked ? fitCameraIn(linked, width, height, list, 1) : undefined;
    if (!to || to.k < full) {
      const alone = boxAround([node], 24);
      to = alone ? fitCameraIn(alone, width, height, list, full) : from;
    }
    if (!wantsWhole) rest ??= from;
    go(to, true);
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
    announce(on ? `Showing only what feeds it and what it feeds: ${plural(shownCount, "box", "boxes")}.` : "Showing all boxes.");
    const from = heading ?? camera;
    // The boxes that are left, all in view at once where every one of them then holds its name.
    const kept = on && !wantsWhole && width > 0 && height > 0 ? fitCameraIn(wholeBox(onScreen), width, height, rooms()) : undefined;
    if (kept && kept.k >= leastZoom(onScreen, from)) {
      rest ??= from;
      go(kept, true);
    } else reframe(true);
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

  /** Opens or closes one of the two panels that stand over the canvas: the legend, or the notes about the map. Where
   * the map has no room for both (a narrow map, or one in which the two would leave the picture none), the one that
   * opens closes the other. The picture is then brought into the room that is left, as far as its names stay readable. */
  function setPanel(panel: HTMLElement, open: boolean): void {
    const show = (which: HTMLElement, shown: boolean): void => {
      which.hidden = !shown;
      (which === legend ? legendButton : aboutButton).setAttribute("aria-expanded", String(shown));
      if (which === legend) legendWanted = shown;
    };
    show(panel, open);
    const other = panel === legend ? about : legend;
    if (open && !other.hidden && (width <= NARROW || freeRooms()?.length === 0)) show(other, false);
    reframe(true);
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
      case "links": setLinks(linksPop.hidden); if (!linksPop.hidden) focusOn(accessToggle); break;
      case "fullscreen": setFull(!(fullWindow || onScreenWhole())); break;
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
        break;
      case "zoom-in": zoom(1.3); break;
      case "zoom-out": zoom(1 / 1.3); break;
      case "legend": setPanel(legend, legend.hidden); break;
      case "about": setPanel(about, about.hidden); break;
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
    // A module of the picker's list: it is known by its place in the list.
    const option = (event.target as Element | null)?.closest<HTMLElement>("[data-map-pick]");
    if (option && pickerList.contains(option)) {
      pickModule(Number(option.dataset.mapPick));
      return;
    }
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
    // So does the picker's list, and the panel of links.
    if (from?.closest(".map-picker") && to && !to.closest(".map-picker")) closePicker();
    if (from?.closest(".map-links") && to && !to.closest(".map-links")) setLinks(false);
  }));
  root.addEventListener("focusin", guarded(event => {
    if (shown && event.target === searchInput && results.hidden && searchText(searchInput.value) !== "") runSearch();
    if (shown && event.target === pickerInput && !pickerOpen) openPicker();
  }));

  root.addEventListener("change", guarded(event => {
    const target = event.target as HTMLElement | null;
    if (!model || !shown || !target) return;
    if (target === groupingSelect) {
      const grouping = groupings.find(each => each.kind === groupingSelect.value);
      if (!grouping || grouping === model.grouping) return;
      // The page keeps the choice for the viewer's next map; the map's own pick is kept as no choice at all. A page that
      // cannot keep it leaves the choice to hold here.
      try {
        options.onGrouping?.(grouping === automatic ? undefined : grouping.kind);
      } catch { /* not kept */ }
      // The model whole, grouped anew: the selection, the hidden layers and the search start afresh.
      applyGrouping(grouping);
      setView("modules");
      if (onScreen) announce(`Modules grouped by ${grouping.label.toLowerCase()}. ${viewSentence(onScreen, options.modelName)}`);
    } else if (target === showSelect) {
      // The groups as a whole, all modules, or one group's.
      if (showSelect.value === SHOW_GROUPS) showSections();
      else if (showSelect.value === SHOW_MODULES) {
        section = undefined;
        grouped = false;
        setView("modules");
      } else openSection(Number(showSelect.value));
    } else if (target === groupSelect) {
      // A group narrows the picker to its modules, which it then lists, for one of them to be picked; "All groups" lists
      // every module.
      openPicker();
      pickerChosen = true;
      pickerGroup = groupSelect.value === "" ? undefined : model.sections[Number(groupSelect.value)];
      pickerActive = Math.max(0, pickerMatches().findIndex(module => module.id === moduleId));
      renderPicker();
      focusOn(pickerInput);
    } else if (target === externalToggle) {
      expanded = externalToggle.checked;
      setView("drill", moduleId);
    } else if (target === accessToggle) {
      // The same view with other links: what is selected stays selected where it is still on screen.
      access = accessToggle.checked;
      onlyTrace = false;
      build();
      if (onScreen) announce(`${access ? "Access driver links are drawn." : "Access driver links are not drawn."} ${viewSentence(onScreen, options.modelName)}`);
    }
  }));

  root.addEventListener("input", guarded(event => {
    if (!shown) return;
    if (event.target === searchInput) runSearch();
    else if (event.target === pickerInput) {
      if (!pickerOpen) openPicker();
      pickerQuery = pickerInput.value;
      pickerActive = 0;
      renderPicker();
    }
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
    if (target === pickerInput) return pickerKey(event);
    if (results.contains(target) && resultsKey(event, target)) return;
    // Escape closes the panel of links from inside it or its button.
    if (event.key === "Escape" && links.contains(target) && !linksPop.hidden) {
      event.preventDefault();
      event.stopPropagation();
      closeLinks();
      focusOn(linksButton);
      return;
    }
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName) || event.ctrlKey || event.metaKey || event.altKey) return;
    let used = true;
    const key = event.key;
    if (key === "Escape" && fullWindow) {
      // A map that fills the window leaves it first, as one that fills the screen does: the browser takes that Escape.
      setFull(false);
    } else if (key === "Escape" && !about.hidden && (about.contains(target) || target === aboutButton)) {
      // The notes about the map were opened to be read: Escape from them closes them, and goes no step back.
      setPanel(about, false);
      focusOn(aboutButton);
    } else if (key === "Escape") {
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
      if (next) select(next);
      else announce(selected ? `No box ${ARROWS[key] === "up" ? "above" : ARROWS[key] === "down" ? "below" : `to the ${ARROWS[key]} of`} ${selected.fullName}.` : "No box on the map.");
    } else if (target === canvas && key === "Enter" && selected) enter(selected);
    else used = false;
    if (used) {
      event.preventDefault();
      event.stopPropagation();
    }
  }));

  // A press outside the search closes its results, and one outside the picker or the panel of links closes them. A press
  // on the picker's list keeps the focus in the picker, for the press to pick. Only presses inside the map are heard.
  root.addEventListener("pointerdown", guarded(event => {
    const target = event.target as Element | null;
    if (target && !target.closest(".map-searchwrap")) closeResults();
    if (target && !target.closest(".map-picker")) closePicker();
    else if (target && pickerPop.contains(target)) event.preventDefault();
    if (target && !target.closest(".map-links")) setLinks(false);
  }));

  // The browser gives the map the screen, or takes it back: by the button, or by its own Escape.
  root.addEventListener("fullscreenchange", guarded(() => {
    renderFull();
    announce(onScreenWhole() ? "The map fills the screen. Escape leaves it." : "The map is back in its place.");
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
    // A press stops a camera that is on its way, where it is. Should the press turn out to be a click and no drag, the
    // picture is still to go where it was going: what it was to show is kept for that.
    const home = heading ? { wantsWhole, rest } : undefined;
    if (heading) {
      heading = undefined;
      ownCamera();
    }
    drag = { pointer: event.pointerId, node, x, y, ox: camera.ox, oy: camera.oy, nodeX: node?.x ?? 0, nodeY: node?.y ?? 0, moved: false, ...(home ? { home } : {}) };
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
        ownCamera();
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
    // A click, and no drag: a camera it stopped on its way keeps what it was to show.
    if (held.home) ({ wantsWhole, rest } = held.home);
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
    ownCamera();
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

  /** Files the modules into the sections a grouping makes, or into the graph's heading rows where there is none: the
   * sections, the list of them and the search are then the grouping's, and the map is to show the model whole. A
   * grouping that makes one section, or none, has no sections to show: the map shows its modules. */
  function applyGrouping(grouping: Grouping | undefined): void {
    if (!base) return;
    model = grouping ? withGrouping(base, grouping) : base;
    single = model.sections.length <= 1;
    search = createSearch(model, !single);
    grouped = !single;
    section = undefined;
    // How many modules each group holds, said in the path's lists.
    const held = new Map<string, number>();
    for (const module of model.modules) {
      const group = model.sectionOf(module);
      held.set(group, (held.get(group) ?? 0) + 1);
    }
    const counts = model.sections.map(group => held.get(group) ?? 0);
    showSelect.innerHTML = showOptionsHtml(model.sections, counts);
    groupSelect.innerHTML = groupOptionsHtml(model.sections, counts);
  }

  /** What is done once, at the first showing: the model is looked up, its modules grouped, and the first view built.
   * The grouping is the one the viewer chose last where this model has it, and otherwise the map's own pick. */
  function start(): void {
    if (model) return;
    base = indexModel(graph);
    groupings = groupingsOf(base);
    automatic = automaticGrouping(groupings);
    groupingSelect.innerHTML = groupingOptionsHtml(groupings, automatic?.kind);
    applyGrouping(groupings.find(grouping => grouping.kind === options.grouping) ?? automatic);
    // A heading row is a section of the map: the name the graph files modules under where they have none is no heading.
    const headings = base.sections.filter(name => name !== NO_HEADING).length;
    notes.innerHTML = notesHtml({ name: options.modelName, workspace: options.workspaceName, modules: base.modules.length, lineItems: base.lineItems.length, headings }, graph.limitations, graph.unresolved.length);
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
      closePicker();
      setLinks(false);
      endDrag();
      // A hidden map fills nothing.
      setFull(false);
    },
    themeChanged() {
      if (destroyed || broken || !shown) return;
      readTheme();
      invalidate();
    },
    destroy() {
      if (destroyed) return;
      setFull(false);
      destroyed = true;
      shown = false;
      stopDrawing();
      settle();
      stopWatching();
      root.remove();
    },
    reveal(node) {
      if (destroyed || broken || !shown || !model) return false;
      const raw = graph.nodes[node];
      if (!raw) return false;
      navigate(raw);
      focusDetails();
      return selected?.raw?.id === raw.id;
    },
  };
}
