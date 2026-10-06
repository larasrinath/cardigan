import { minimapTransform, toWorld, type Camera, type MinimapTransform } from "./map-camera.js";
import type { ViewGraph, ViewNode } from "./map-graphs.js";
import { layerColour, type MapPalette } from "./map-palette.js";
import { formatCells, shorten, wrapLines, type TextMeasure } from "./map-text.js";
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
  /** The time in milliseconds that moves a trace's dashes. Nothing where nothing may move: a trace is then a solid line. */
  time?: number;
}

/** The context's methods the map draws with. */
export type Pen = CanvasRenderingContext2D;

const GRID = 26;
/** Below this zoom a node is a patch of its colour: no border, no text. */
const PATCH_BELOW = 0.1;
const TEXT_FROM = 0.24;
/** The size widths are measured at. A system font is set wider, for its size, when it is small: measured small, a word
 * never comes out wider than it was measured. */
const MEASURED_AT = 10;
/** A word is taken to be this much wider than measured, for the fonts that do not keep to the rule above. */
const SPARE = 1.02;
const WORDS_KEPT = 60000;
const DASH = [7, 6];
const DASH_LENGTH = 13;
const DASH_SPEED = 25;

type Role = "label" | "item" | "code" | "meta";
const WEIGHT: Record<Role, number> = { label: 600, item: 500, code: 500, meta: 400 };

/** The fonts of the map's texts, and what measures a text in each. */
export interface Fonts {
  css(role: Role, size: number): string;
  measure(role: Role): TextMeasure;
}

export function createFonts(pen: Pen, palette: MapPalette): Fonts {
  const family = (role: Role): string => (role === "code" || role === "meta" ? palette.mono : palette.sans);
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

/** Draws the links, and says whether one of them is a trace on screen: only then is there anything to keep moving. */
function drawEdges(pen: Pen, scene: Scene): boolean {
  const { graph, camera, width, height, shown, trace, matches, palette } = scene;
  const { k, ox, oy } = camera;
  // Many links over each other make one dark patch: beyond a few hundred each is drawn fainter, down to a third.
  const thin = (count: number, from: number): number => Math.min(1, Math.max(0.35, from / Math.max(1, count)));
  const idle = (graph.kind === "sections" ? 0.22 : 0.3) * thin(graph.edges.length, 600);
  let marked = 0;
  if (trace) for (let index = 0; index < trace.edges.length; index++) if (trace.edges[index]) marked++;
  const strong = 0.85 * thin(marked, 250);
  const head = Math.max(2, Math.min(5 * k, 6));
  let traced = false;
  for (let index = 0; index < graph.edges.length; index++) {
    const edge = graph.edges[index];
    if (!shown[edge.s] || !shown[edge.t]) continue;
    const from = graph.nodes[edge.s];
    const to = graph.nodes[edge.t];
    const x1 = (from.x + from.w) * k + ox;
    const y1 = (from.y + from.h / 2) * k + oy;
    const x2 = to.x * k + ox;
    const y2 = (to.y + to.h / 2) * k + oy;
    if ((x1 < 0 && x2 < 0) || (x1 > width && x2 > width) || (y1 < 0 && y2 < 0) || (y1 > height && y2 > height)) continue;
    const way = trace ? trace.edges[index] : 0;
    let alpha = trace ? (way ? strong : 0.05) : idle;
    if (matches && !matches[edge.s] && !matches[edge.t]) alpha *= 0.25;
    pen.beginPath();
    pen.moveTo(x1, y1);
    if (x2 >= x1) {
      const bend = Math.max(Math.abs(x2 - x1) * 0.38, 40 * k);
      pen.bezierCurveTo(x1 + bend, y1, x2 - bend, y2, x2, y2);
    } else if (Math.abs(y1 - y2) > 8 * k) {
      pen.bezierCurveTo(x1 + 70 * k, y1, x2 - 70 * k, y2, x2, y2);
    } else {
      // Back to a node at the same height, or to the node itself: over the top.
      const over = Math.min(y1, y2) - 65 * k;
      pen.bezierCurveTo(x1 + 55 * k, y1, x1 + 55 * k, over, x1, over);
      pen.lineTo(x2, over);
      pen.bezierCurveTo(x2 - 55 * k, over, x2 - 55 * k, y2, x2, y2);
    }
    const colour = way === 1 ? palette.traceUp : way === 2 ? palette.traceDown : palette.edge;
    pen.globalAlpha = alpha;
    pen.strokeStyle = colour;
    pen.lineWidth = Math.max(0.6, Math.min(4.5, 0.8 + Math.log2(1 + edge.w) * 0.45) * Math.min(k, 1.4));
    if (way) {
      traced = true;
      if (scene.time !== undefined) {
        pen.setLineDash(DASH);
        pen.lineDashOffset = -((scene.time / 1000 * DASH_SPEED) % DASH_LENGTH);
      }
    }
    pen.stroke();
    if (way && scene.time !== undefined) pen.setLineDash([]);
    if (k > 0.16) {
      pen.beginPath();
      pen.moveTo(x2, y2);
      pen.lineTo(x2 - head * 1.6, y2 - head * 0.72);
      pen.lineTo(x2 - head * 1.6, y2 + head * 0.72);
      pen.closePath();
      pen.fillStyle = colour;
      pen.fill();
    }
  }
  pen.globalAlpha = 1;
  return traced;
}

const KIND_LINE: Record<ViewNode["kind"], string> = { section: "SECTION", module: "MODULE", lineItem: "LINE ITEM", externalModule: "EXTERNAL MODULE", externalItem: "EXTERNAL", list: "LIST", property: "PROPERTY" };

function drawText(pen: Pen, scene: Scene, fonts: Fonts, node: ViewNode, x: number, y: number, width: number, height: number): void {
  const { palette } = scene;
  const k = scene.camera.k;
  const pad = Math.max(9, 14 * k);
  const room = Math.max(0, width - pad - 8);
  if (node.kind === "lineItem") {
    const size = Math.max(10, 11.5 * k);
    if (height < size + 4) return;
    const lines = wrapLines(node.label, room / size, height > 2 * (size + 2) + 4 ? 2 : 1, fonts.measure("item"));
    pen.font = fonts.css("item", size);
    pen.fillStyle = node.layer === "heading" ? palette.nodeTextMuted : palette.nodeText;
    const step = size + 2;
    const first = y + height / 2 - (lines.length - 1) * step / 2 + size * 0.35;
    lines.forEach((line, index) => pen.fillText(line, x + pad, first + index * step));
    return;
  }
  const size = Math.max(10.5, 12.5 * k);
  if (height < 34) {
    // Too low for two lines: the whole name on one, which says more than a code alone.
    pen.font = fonts.css("label", size);
    pen.fillStyle = node.external ? palette.nodeTextMuted : palette.nodeText;
    pen.fillText(shorten(node.fullName, room / size, fonts.measure("label")), x + pad, y + height / 2 + size * 0.35);
    return;
  }
  const small = k < 0.8;
  const codeSize = Math.max(9, 9.5 * k);
  pen.font = fonts.css("code", codeSize);
  pen.fillStyle = palette.nodeTextMuted;
  pen.fillText(shorten(node.code || KIND_LINE[node.kind], room / codeSize, fonts.measure("code")), x + pad, y + Math.max(11, 16 * k));
  const lines = wrapLines(node.label, room / size, small && height <= 44 ? 1 : 2, fonts.measure("label"));
  pen.font = fonts.css("label", size);
  pen.fillStyle = node.external ? palette.nodeTextMuted : palette.nodeText;
  const first = y + Math.max(24, 34 * k);
  lines.forEach((line, index) => pen.fillText(line, x + pad, first + index * (size + 2)));
  if (small) return;
  const meta = node.meta || (node.raw?.cells !== undefined ? `${formatCells(node.raw.cells)} cells` : "");
  if (meta === "") return;
  const metaSize = Math.max(9, 9.5 * k);
  pen.font = fonts.css("meta", metaSize);
  pen.fillStyle = palette.nodeTextMuted;
  pen.fillText(shorten(meta, room / metaSize, fonts.measure("meta")), x + pad, y + height - 10 * k);
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
    const way = !trace || selected ? 0 : trace.up.has(index) ? 1 : trace.down.has(index) ? 2 : 0;
    let alpha = trace && !selected && !way ? 0.18 : 1;
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
    if (selected || way) {
      roundedRect(pen, x - 2, y - 2, w + 4, h + 4, radius + 2);
      pen.globalAlpha = alpha * 0.7;
      pen.strokeStyle = selected ? palette.select : way === 1 ? palette.traceUp : palette.traceDown;
      pen.lineWidth = 1.4;
      pen.stroke();
    }
    if (matches?.[index]) {
      roundedRect(pen, x - 3, y - 3, w + 6, h + 6, radius + 3);
      pen.globalAlpha = alpha * 0.75;
      pen.strokeStyle = palette.match;
      pen.lineWidth = 1.4;
      pen.stroke();
    }
    if (k >= TEXT_FROM) {
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

/** Draws the whole graph small, each node a patch of its colour, with a frame around what the camera shows. Gives back
 * how the graph was scaled, so that a click on the small picture can be read as a place in the graph. */
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
  const [left, top] = toWorld(scene.camera, 0, 0);
  const [right, bottom] = toWorld(scene.camera, scene.width, scene.height);
  pen.globalAlpha = 0.55;
  pen.strokeStyle = palette.select;
  pen.lineWidth = 1;
  pen.strokeRect(ox + left * s, oy + top * s, (right - left) * s, (bottom - top) * s);
  pen.globalAlpha = 1;
  return transform;
}
