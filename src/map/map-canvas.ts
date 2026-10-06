import { minimapTransform, toWorld, type Camera, type MinimapTransform } from "./map-camera.js";
import type { ViewGraph, ViewNode } from "./map-graphs.js";
import { CARD, FULL_CARD_ZOOM, FULL_ITEM_ZOOM, hasSmallLine, ITEM } from "./map-layout.js";
import { layerColour, type MapPalette } from "./map-palette.js";
import { shorten, wrapLines, type TextMeasure } from "./map-text.js";
import type { Trace } from "./map-trace.js";

/** The map's drawing: one picture of a graph as the camera sees it, and the small picture of the whole graph beside it.
 * It draws what it is given and keeps nothing between two pictures but the widths of words it has measured. Text goes
 * to the canvas as text: nothing of a model is ever read as markup here. */

/** What one picture shows. */
export interface Scene {
  graph: ViewGraph;
  camera: Camera;
  /** The canvas's size in CSS pixels. */
  width: number;
  height: number;
  palette: MapPalette;
  /** For each node, by its place: 1 where it is shown. A link is shown when both its nodes are. */
  shown: Uint8Array;
  trace?: Trace;
  /** For each node: 1 where the search names it. Nothing when nothing is searched. */
  matches?: Uint8Array;
  /** The order the nodes are drawn in, by their places: a node that was dragged is drawn last, over the others. Nothing
   * for the order of the graph. */
  order?: readonly number[];
  /** The time in milliseconds that moves a trace's dashes. Nothing where nothing moves: the dashes then stand still. */
  time?: number;
}

/** The context's methods the map draws with. */
export type Pen = CanvasRenderingContext2D;

const GRID = 26;
/** Below this zoom a node is a patch of its colour: no border, no text. */
const PATCH_BELOW = 0.1;
/** The letters of a name in a box too small to be drawn in full; in a box with room for one low line only they are
 * half a pixel smaller, and that is the smallest a name is ever written. The least height of a box that holds a line. */
const SMALL_TYPE = 10;
const LEAST_TYPE = 9.5;
const LEAST_HEIGHT = 13;
/** The small line of a box drawn in full never has letters smaller than this, however small the box. */
const SMALL_LINE_LEAST = 9;
/** The size widths are measured at. A system font is set wider, for its size, when it is small: measured small, a word
 * never comes out wider than it was measured. */
const MEASURED_AT = 10;
/** A word is taken to be this much wider than measured, for the fonts that do not keep to the rule above. */
const SPARE = 1.02;
const WORDS_KEPT = 60000;
/** A trace's dashes: long for what leads to the node, short for what leads on from it, so that the two are told apart
 * without their colours. */
const DASH_UP = [7, 5];
const DASH_DOWN = [2, 4];
const DASH_SPEED = 24;
/** Up to this many links each is drawn in full strength, which stands 3 to 1 against the canvas. Beyond it they are
 * thinned, down to a fifth: thousands of links at full strength are one dark mass that hides the boxes' order. */
const LINKS_IN_FULL = 300;
const THINNEST = 0.2;

/** The zoom from which every box of a graph holds at least a line of letters: a view fitted smaller than that would be
 * boxes nobody can read. */
export function legibleFrom(graph: ViewGraph): number {
  let lowest = Infinity;
  for (const node of graph.nodes) lowest = Math.min(lowest, node.h);
  return Number.isFinite(lowest) ? LEAST_HEIGHT / lowest : 0;
}

type Role = "label" | "item" | "code";
const WEIGHT: Record<Role, number> = { label: 600, item: 500, code: 500 };

/** The fonts of the map's texts, and what measures a text in each. */
export interface Fonts {
  css(role: Role, size: number): string;
  measure(role: Role): TextMeasure;
}

export function createFonts(pen: Pen, palette: MapPalette): Fonts {
  const family = (role: Role): string => (role === "code" ? palette.mono : palette.sans);
  const css = (role: Role, size: number): string => `${WEIGHT[role]} ${size}px ${family(role)}`;
  const measures = new Map<Role, TextMeasure>();
  const measure = (role: Role): TextMeasure => {
    let made = measures.get(role);
    if (made) return made;
    const font = css(role, MEASURED_AT);
    const words = new Map<string, number>();
    const width = (text: string): number => {
      let known = words.get(text);
      if (known === undefined) {
        if (words.size >= WORDS_KEPT) words.clear();
        pen.font = font;
        words.set(text, known = pen.measureText(text).width / MEASURED_AT * SPARE);
      }
      return known;
    };
    made = { word: width, char: width, get space() { return width(" "); }, get ellipsis() { return width("…"); } };
    measures.set(role, made);
    return made;
  };
  return { css, measure };
}

function roundedRect(pen: Pen, x: number, y: number, width: number, height: number, radius: number): void {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  pen.beginPath();
  if (typeof pen.roundRect === "function") {
    pen.roundRect(x, y, width, height, r);
    return;
  }
  pen.moveTo(x + r, y);
  pen.arcTo(x + width, y, x + width, y + height, r);
  pen.arcTo(x + width, y + height, x, y + height, r);
  pen.arcTo(x, y + height, x, y, r);
  pen.arcTo(x, y, x + width, y, r);
  pen.closePath();
}

/** The strip of a node's colour down its left side: the part of the node's rounded shape left of a line. */
function rail(pen: Pen, x: number, y: number, width: number, height: number, radius: number): void {
  const r = Math.max(0.01, Math.min(radius, height / 2));
  const angle = width >= r ? Math.PI / 2 : Math.acos((r - width) / r);
  const rise = r - r * Math.sin(angle);
  pen.beginPath();
  pen.moveTo(x + width, y + rise);
  pen.arc(x + r, y + r, r, Math.PI + angle, Math.PI, true);
  pen.arc(x + r, y + height - r, r, Math.PI, Math.PI - angle, true);
  pen.lineTo(x + width, y + height - rise);
  pen.closePath();
}

/** A filled arrowhead with its tip at a point, pointing right or left. */
function arrowhead(pen: Pen, x: number, y: number, length: number, left: boolean): void {
  const back = left ? x + length : x - length;
  pen.beginPath();
  pen.moveTo(x, y);
  pen.lineTo(back, y - length * 0.42);
  pen.lineTo(back, y + length * 0.42);
  pen.closePath();
  pen.fill();
}

function drawGrid(pen: Pen, scene: Scene): void {
  const { camera, width, height } = scene;
  const step = GRID * camera.k;
  if (step <= 10) return;
  // A dot at every crossing of the grid: each row is one line of dashes a pixel long.
  const left = ((camera.ox % step) + step) % step;
  const top = ((camera.oy % step) + step) % step;
  pen.strokeStyle = scene.palette.grid;
  pen.lineWidth = 1;
  pen.setLineDash([1, step - 1]);
  pen.lineDashOffset = 0;
  pen.beginPath();
  for (let y = top; y < height; y += step) {
    pen.moveTo(left, y + 0.5);
    pen.lineTo(width, y + 0.5);
  }
  pen.stroke();
  pen.setLineDash([]);
}

/** Draws the links, and says whether one of them is a trace on screen: only then is there anything to keep moving.
 *
 * A link leaves the right of what is read and ends, with an arrowhead, at what reads it: at its left where that stands
 * further right, as most do. Between two boxes of one column it runs round the column's right side, and to a box
 * further left it runs straight back; both end at the right of the box, with the arrowhead pointing left. So no link
 * has to cross the column it starts in. */
function drawEdges(pen: Pen, scene: Scene): boolean {
  const { graph, camera, width, height, shown, trace, matches, palette } = scene;
  const { k, ox, oy } = camera;
  const thin = (count: number, from: number): number => (count <= from ? 1 : Math.max(THINNEST, from / count));
  const idle = thin(graph.edges.length, LINKS_IN_FULL);
  let marked = 0;
  if (trace) for (let index = 0; index < trace.edges.length; index++) if (trace.edges[index]) marked++;
  const strong = thin(marked, LINKS_IN_FULL);
  const head = Math.max(6.5, Math.min(10, 9 * k));
  let traced = false;
  for (let index = 0; index < graph.edges.length; index++) {
    const edge = graph.edges[index];
    if (!shown[edge.s] || !shown[edge.t]) continue;
    const from = graph.nodes[edge.s];
    const to = graph.nodes[edge.t];
    const fromLeft = from.x * k + ox;
    const fromRight = fromLeft + from.w * k;
    const toLeft = to.x * k + ox;
    const toRight = toLeft + to.w * k;
    let y1 = (from.y + from.h / 2) * k + oy;
    let y2 = (to.y + to.h / 2) * k + oy;
    const reach = 70 * k;
    if ((fromRight < -reach && toRight < -reach) || (fromLeft > width + reach && toLeft > width + reach) || (y1 < -reach && y2 < -reach) || (y1 > height + reach && y2 > height + reach)) continue;
    const way = trace ? trace.edges[index] : 0;
    let alpha = trace ? (way ? strong : 0.12) : idle;
    if (matches && !matches[edge.s] && !matches[edge.t]) alpha *= 0.25;
    const colour = way === 1 ? palette.traceUp : way === 2 ? palette.traceDown : palette.edge;
    pen.globalAlpha = alpha;
    pen.strokeStyle = colour;
    pen.fillStyle = colour;
    pen.lineWidth = Math.max(1, Math.min(3, 0.8 + Math.log2(1 + edge.w) * 0.35) * Math.min(k, 1.2));
    let tip = toLeft;
    let pointsLeft = false;
    pen.beginPath();
    if (from === to) {
      // A line item that reads itself: over its own top, from its right to its left.
      const over = from.y * k + oy - 14 * k;
      pen.moveTo(fromRight, y1);
      pen.bezierCurveTo(fromRight + 26 * k, y1, fromRight + 26 * k, over, fromRight - 6 * k, over);
      pen.lineTo(fromLeft + 6 * k, over);
      pen.bezierCurveTo(fromLeft - 26 * k, over, fromLeft - 26 * k, y1, fromLeft - head + 1, y1);
    } else if (Math.abs(from.x - to.x) < 2) {
      const down = to.y > from.y ? 1 : -1;
      y1 += down * Math.min(7 * k, from.h * k * 0.22);
      y2 -= down * Math.min(7 * k, to.h * k * 0.22);
      const bulge = Math.min(50 * k, 16 * k + 0.18 * Math.abs(y2 - y1));
      tip = toRight;
      pointsLeft = true;
      pen.moveTo(fromRight, y1);
      pen.bezierCurveTo(fromRight + bulge, y1, toRight + bulge + head, y2, toRight + head - 1, y2);
    } else if (toLeft < fromLeft) {
      const bend = Math.max((fromLeft - toRight) * 0.38, 30 * k);
      tip = toRight;
      pointsLeft = true;
      pen.moveTo(fromLeft, y1);
      pen.bezierCurveTo(fromLeft - bend, y1, toRight + bend, y2, toRight + head - 1, y2);
    } else {
      const bend = Math.max((toLeft - fromRight) * 0.38, 30 * k);
      pen.moveTo(fromRight, y1);
      pen.bezierCurveTo(fromRight + bend, y1, toLeft - bend, y2, toLeft - head + 1, y2);
    }
    if (way) {
      traced = true;
      const dash = way === 1 ? DASH_UP : DASH_DOWN;
      pen.setLineDash(dash);
      pen.lineDashOffset = scene.time === undefined ? 0 : -((scene.time / 1000 * DASH_SPEED) % (dash[0] + dash[1]));
    }
    pen.stroke();
    if (way) pen.setLineDash([]);
    arrowhead(pen, tip, y2, head, pointsLeft);
  }
  pen.globalAlpha = 1;
  return traced;
}

/** A box's text. From `FULL_CARD_ZOOM` on (`FULL_ITEM_ZOOM` for a line item) it is the box in full: the small line (its
 * code, and what it holds or where it belongs) and the name as it was wrapped at full zoom, growing and shrinking with
 * the box; the small line stops shrinking where it would stop being readable, and is cut to its room. Below that zoom
 * the name's letters would be too small to read, so only the name is written, code and all, in letters that stay
 * readable, on as many lines as the box has room for; and nothing in a box too low for a line. */
function drawText(pen: Pen, scene: Scene, fonts: Fonts, node: ViewNode, x: number, y: number, width: number, height: number): void {
  const { palette } = scene;
  const k = scene.camera.k;
  const item = node.kind === "lineItem";
  const role: Role = item ? "item" : "label";
  const quiet = node.external || node.layer === "heading";
  if (k >= (item ? FULL_ITEM_ZOOM : FULL_CARD_ZOOM)) {
    const left = x + (item ? ITEM.padLeft : CARD.padLeft) * k;
    let top = y + (item ? ITEM.top : CARD.top) * k;
    if (!item && hasSmallLine(node)) {
      const size = Math.max(SMALL_LINE_LEAST, CARD.smallFont * k);
      // The line is cut before the pen is given its font: measuring a word sets the pen's font to the measure's own.
      const small = shorten([node.code, node.meta].filter(part => part !== "").join(" · "), (CARD.width - CARD.padLeft - CARD.padRight) * k / size, fonts.measure("code"));
      pen.font = fonts.css("code", size);
      pen.fillStyle = palette.nodeTextMuted;
      pen.fillText(small, left, top + 9 * k);
      top += (CARD.small + CARD.gap) * k;
    }
    const size = (item ? ITEM.font : CARD.font) * k;
    const step = (item ? ITEM.line : CARD.line) * k;
    pen.font = fonts.css(role, size);
    pen.fillStyle = quiet ? palette.nodeTextMuted : palette.nodeText;
    node.lines.forEach((line, index) => pen.fillText(line, left, top + step * index + step * 0.74));
    return;
  }
  if (height < LEAST_HEIGHT) return;
  const padLeft = Math.max(6, (item ? ITEM.padLeft : CARD.padLeft) * k);
  const room = width - padLeft - Math.max(4, 8 * k);
  const lines = Math.floor((height - 3) / (SMALL_TYPE + 2));
  // A box with room for one line only may be a little lower than a line of the small letters: they are then set half a
  // pixel smaller.
  const size = lines >= 1 ? SMALL_TYPE : LEAST_TYPE;
  const written = wrapLines(node.fullName, room / size, Math.max(1, lines), fonts.measure(role));
  pen.font = fonts.css(role, size);
  pen.fillStyle = quiet ? palette.nodeTextMuted : palette.nodeText;
  const step = size + 2;
  const first = y + (height - written.length * step) / 2 + size * 0.86;
  written.forEach((line, index) => pen.fillText(line, x + padLeft, first + index * step));
}

/** The sign of a box of a trace: an arrowhead on the edge the trace's links use. A box that feeds the node selected has
 * it at its right edge, where its links leave; a box the node feeds has it at its left edge, where they arrive. A box
 * in a circle with the node has both. The two sides are told apart by where the sign stands, not only by its colour. */
function drawSigns(pen: Pen, palette: MapPalette, x: number, y: number, width: number, height: number, feeds: boolean, fed: boolean, k: number): void {
  const size = Math.max(4.5, Math.min(7, 6 * k));
  const middle = y + height / 2;
  if (feeds) {
    pen.fillStyle = palette.traceUp;
    pen.beginPath();
    pen.moveTo(x + width + 2, middle - size);
    pen.lineTo(x + width + 2 + size * 1.25, middle);
    pen.lineTo(x + width + 2, middle + size);
    pen.closePath();
    pen.fill();
  }
  if (fed) {
    pen.fillStyle = palette.traceDown;
    pen.beginPath();
    pen.moveTo(x - 2 - size * 1.25, middle - size);
    pen.lineTo(x - 2, middle);
    pen.lineTo(x - 2 - size * 1.25, middle + size);
    pen.closePath();
    pen.fill();
  }
}

function drawNodes(pen: Pen, scene: Scene, fonts: Fonts): void {
  const { graph, camera, width, height, shown, trace, matches, palette } = scene;
  const { k, ox, oy } = camera;
  const colours = new Map<string, string>();
  const radius = Math.min(8, 8 * k);
  pen.textAlign = "left";
  pen.textBaseline = "alphabetic";
  for (let at = 0; at < graph.nodes.length; at++) {
    const node = graph.nodes[scene.order ? scene.order[at] : at];
    const index = node.index;
    if (!shown[index]) continue;
    const x = node.x * k + ox;
    const y = node.y * k + oy;
    const w = node.w * k;
    const h = node.h * k;
    if (x + w < -30 || y + h < -30 || x > width + 30 || y > height + 30) continue;
    let colour = colours.get(node.layer);
    if (colour === undefined) colours.set(node.layer, colour = layerColour(palette, node.layer));
    const selected = trace?.selected === index;
    const feeds = !!trace && !selected && trace.up.has(index);
    const fed = !!trace && !selected && trace.down.has(index);
    let alpha = trace && !selected && !feeds && !fed ? 0.18 : 1;
    if (matches && !matches[index]) alpha = Math.min(alpha, 0.18);

    if (k < PATCH_BELOW) {
      pen.globalAlpha = alpha * (node.external ? 0.45 : 0.85);
      pen.fillStyle = colour;
      pen.fillRect(x, y, Math.max(w, 2), Math.max(h, 2));
    } else {
      pen.globalAlpha = alpha;
      roundedRect(pen, x, y, w, h, radius);
      pen.fillStyle = selected ? palette.nodeFillSelected : palette.nodeFill;
      pen.fill();
      if (node.external) pen.setLineDash([4, 4]);
      pen.lineWidth = selected ? 1.8 : Math.max(1, 1.1 * k);
      pen.strokeStyle = selected ? palette.select : node.external ? palette.external : palette.nodeBorder;
      pen.stroke();
      if (node.external) pen.setLineDash([]);
      else {
        rail(pen, x, y, Math.min(w, Math.max(2.5, 4 * k)), h, radius);
        pen.fillStyle = colour;
        pen.fill();
      }
    }
    if (selected || feeds || fed) {
      pen.globalAlpha = alpha * 0.8;
      pen.lineWidth = 1.4;
      roundedRect(pen, x - 2, y - 2, w + 4, h + 4, radius + 2);
      pen.strokeStyle = selected ? palette.select : feeds ? palette.traceUp : palette.traceDown;
      pen.stroke();
      if (feeds && fed) {
        // In a circle with the node: a second ring, of the other side's colour.
        roundedRect(pen, x - 4.5, y - 4.5, w + 9, h + 9, radius + 4.5);
        pen.strokeStyle = palette.traceDown;
        pen.stroke();
      }
      pen.globalAlpha = alpha;
      if (k >= PATCH_BELOW) drawSigns(pen, palette, x, y, w, h, feeds, fed, k);
    }
    if (matches?.[index]) {
      roundedRect(pen, x - 3, y - 3, w + 6, h + 6, radius + 3);
      pen.globalAlpha = alpha * 0.8;
      pen.strokeStyle = palette.match;
      pen.lineWidth = 1.6;
      pen.stroke();
    }
    if (k >= PATCH_BELOW) {
      pen.globalAlpha = alpha;
      drawText(pen, scene, fonts, node, x, y, w, h);
    }
  }
  pen.globalAlpha = 1;
}

/** Draws the scene over the whole canvas. Says whether a trace is on screen, which is all that ever moves by itself. */
export function drawScene(pen: Pen, scene: Scene, fonts: Fonts): boolean {
  pen.globalAlpha = 1;
  pen.setLineDash([]);
  pen.fillStyle = scene.palette.canvas;
  pen.fillRect(0, 0, scene.width, scene.height);
  drawGrid(pen, scene);
  const traced = drawEdges(pen, scene);
  drawNodes(pen, scene, fonts);
  return traced;
}

/** Draws the whole graph small, each node a patch of its colour, with a frame around what the camera shows where that
 * is less than everything. Gives back how the graph was scaled, so that a click on the small picture can be read as a
 * place in the graph. */
export function drawMinimap(pen: Pen, scene: Scene, width: number, height: number): MinimapTransform | undefined {
  pen.globalAlpha = 1;
  pen.clearRect(0, 0, width, height);
  const { graph, palette, shown, trace } = scene;
  if (!graph.nodes.length) return undefined;
  const transform = minimapTransform(graph.bounds, width, height);
  const { s, ox, oy } = transform;
  const colours = new Map<string, string>();
  let last = "";
  for (const node of graph.nodes) {
    if (!shown[node.index]) continue;
    let colour = colours.get(node.layer);
    if (colour === undefined) colours.set(node.layer, colour = layerColour(palette, node.layer));
    if (colour !== last) pen.fillStyle = last = colour;
    pen.globalAlpha = trace?.selected === node.index ? 1 : 0.7;
    pen.fillRect(ox + node.x * s, oy + node.y * s, Math.max(node.w * s, 2), Math.max(node.h * s, 2));
  }
  const [worldLeft, worldTop] = toWorld(scene.camera, 0, 0);
  const [worldRight, worldBottom] = toWorld(scene.camera, scene.width, scene.height);
  // The frame says which part of the graph is on screen. With the whole graph on screen there is nothing to say, and a
  // frame cut off at the small picture's edge would be a stray line: it is drawn only around a part.
  const bounds = graph.bounds;
  const whole = worldLeft <= bounds.x && worldTop <= bounds.y && worldRight >= bounds.x + bounds.w && worldBottom >= bounds.y + bounds.h;
  if (!whole) {
    const left = Math.max(1, ox + worldLeft * s);
    const top = Math.max(1, oy + worldTop * s);
    const right = Math.min(width - 1, ox + worldRight * s);
    const bottom = Math.min(height - 1, oy + worldBottom * s);
    if (right > left && bottom > top) {
      pen.globalAlpha = 0.6;
      pen.strokeStyle = palette.select;
      pen.lineWidth = 1;
      pen.strokeRect(left, top, right - left, bottom - top);
    }
  }
  pen.globalAlpha = 1;
  return transform;
}
