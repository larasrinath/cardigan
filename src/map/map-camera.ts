import type { Box, ViewNode } from "./map-graphs.js";
import { boundsOf } from "./map-layout.js";

/** Where the map is looked at from, and what is under a point of it. A node has a place in the graph ("world"); the
 * camera says where that is in the canvas ("screen", in CSS pixels from the canvas's top left corner): screen = world
 * times `k` plus the offset. Nothing here reads the page. */

export interface Camera { ox: number; oy: number; k: number }
/** The room the panels take at each side of the canvas: a graph is fitted into what they leave. */
export interface Insets { l: number; r: number; t: number; b: number }

export const MIN_ZOOM = 0.025;
export const MAX_ZOOM = 3;
/** A fit never enlarges a small graph beyond this. */
export const FIT_ZOOM = 1.15;

const clamp = (value: number, low: number, high: number): number => Math.min(high, Math.max(low, value));

export const toScreen = (camera: Camera, x: number, y: number): [number, number] => [x * camera.k + camera.ox, y * camera.k + camera.oy];
export const toWorld = (camera: Camera, x: number, y: number): [number, number] => [(x - camera.ox) / camera.k, (y - camera.oy) / camera.k];

/** The room for the graph where the page cannot be measured: what the panels take in the wide layout and in the narrow
 * one (map.css), with the inspector open or not. */
export function defaultInsets(width: number, height: number, inspector: boolean): Insets {
  if (width < 760) return { l: 18, r: 18, t: 230, b: inspector ? Math.min(height * 0.5, 440) : 90 };
  return { l: Math.min(225, width * 0.16), r: inspector ? 330 : 55, t: 166, b: 100 };
}

/** The camera that shows a box whole, in the middle of what the insets leave of a canvas. */
export function fitCamera(box: Box, width: number, height: number, insets: Insets, maxZoom = FIT_ZOOM): Camera {
  const roomX = Math.max(160, width - insets.l - insets.r);
  const roomY = Math.max(150, height - insets.t - insets.b);
  const k = clamp(Math.min(roomX / Math.max(box.w, 1), roomY / Math.max(box.h, 1), maxZoom), MIN_ZOOM, MAX_ZOOM);
  return { ox: insets.l + (roomX - box.w * k) / 2 - box.x * k, oy: insets.t + (roomY - box.h * k) / 2 - box.y * k, k };
}

/** A part of the canvas, in CSS pixels from its top left corner. */
export interface Area { left: number; top: number; right: number; bottom: number }

/** What a free part of the canvas leaves when small panels stand in its corners: either what is above them all, or what
 * is between them, those in the left half on the one side and the others on the other. A panel that does not reach
 * into the free part changes nothing. A graph is fitted into whichever shows it larger (`fitCameraIn`). */
export function roomsBeside(free: Area, panels: readonly Area[]): Area[] {
  const inWay = panels.filter(panel => panel.right > free.left && panel.left < free.right && panel.bottom > free.top && panel.top < free.bottom);
  if (!inWay.length) return [free];
  const above = { ...free, bottom: Math.min(free.bottom, ...inWay.map(panel => panel.top)) };
  const between = { ...free };
  for (const panel of inWay) {
    if ((panel.left + panel.right) / 2 < (free.left + free.right) / 2) between.left = Math.max(between.left, panel.right);
    else between.right = Math.min(between.right, panel.left);
  }
  return [above, between].filter(room => room.right > room.left && room.bottom > room.top);
}

/** What an area leaves of a canvas at each side, with a margin kept inside the area. */
export function insetsOf(area: Area, width: number, height: number, margin = 0): Insets {
  return { l: area.left + margin, t: area.top + margin, r: width - area.right + margin, b: height - area.bottom + margin };
}

/** The camera that shows a box whole in the room that shows it largest. */
export function fitCameraIn(box: Box, width: number, height: number, rooms: readonly Insets[], maxZoom = FIT_ZOOM): Camera {
  let best: Camera | undefined;
  for (const room of rooms) {
    const camera = fitCamera(box, width, height, room, maxZoom);
    if (!best || camera.k > best.k) best = camera;
  }
  return best ?? fitCamera(box, width, height, { l: 0, r: 0, t: 0, b: 0 }, maxZoom);
}

/** The camera zoomed by a factor, with the point of the graph under (x, y) staying under it. */
export function zoomAt(camera: Camera, factor: number, x: number, y: number): Camera {
  const k = clamp(camera.k * factor, MIN_ZOOM, MAX_ZOOM);
  const ratio = k / camera.k;
  return { ox: x - (x - camera.ox) * ratio, oy: y - (y - camera.oy) * ratio, k };
}

/** The camera at the same zoom with a point of the graph in the middle of the canvas. */
export function centreOn(camera: Camera, worldX: number, worldY: number, width: number, height: number): Camera {
  return { ox: width / 2 - worldX * camera.k, oy: height / 2 - worldY * camera.k, k: camera.k };
}

/** One step of the camera's way to where it is going: most of the way in a quarter of a second, whatever the frame
 * rate. `done` says it has arrived, and the camera is then the target itself. */
export function easeCamera(camera: Camera, target: Camera, elapsedMs: number): { camera: Camera; done: boolean } {
  const share = 1 - Math.pow(1 - 0.14, Math.max(0, elapsedMs) / (1000 / 60));
  const next = { ox: camera.ox + (target.ox - camera.ox) * share, oy: camera.oy + (target.oy - camera.oy) * share, k: camera.k + (target.k - camera.k) * share };
  const done = Math.abs(target.ox - next.ox) < 0.5 && Math.abs(target.oy - next.oy) < 0.5 && Math.abs(target.k - next.k) < 0.001;
  return done ? { camera: target, done } : { camera: next, done };
}

/** The node under a point of the canvas: the one drawn last where two overlap, and none that is not shown. */
export function hitNode(nodes: readonly ViewNode[], shown: (index: number) => boolean, camera: Camera, x: number, y: number): ViewNode | undefined {
  const [worldX, worldY] = toWorld(camera, x, y);
  for (let index = nodes.length - 1; index >= 0; index--) {
    const node = nodes[index];
    if (worldX >= node.x && worldX <= node.x + node.w && worldY >= node.y && worldY <= node.y + node.h && shown(index)) return node;
  }
  return undefined;
}

/** The box around some nodes, with a margin. */
export function boxAround(nodes: readonly ViewNode[], margin = 30): Box | undefined {
  if (!nodes.length) return undefined;
  const box = boundsOf(nodes);
  return { x: box.x - margin, y: box.y - margin, w: box.w + 2 * margin, h: box.h + 2 * margin };
}

/** How the minimap shows a graph's bounds in its own canvas: scaled to fit, with 8 pixels around, in the middle. */
export interface MinimapTransform { s: number; ox: number; oy: number }
export function minimapTransform(bounds: Box, width: number, height: number): MinimapTransform {
  const s = Math.min((width - 16) / Math.max(bounds.w, 1), (height - 16) / Math.max(bounds.h, 1));
  return { s, ox: (width - bounds.w * s) / 2 - bounds.x * s, oy: (height - bounds.h * s) / 2 - bounds.y * s };
}

export type Direction = "left" | "right" | "up" | "down";

/** The node the selection moves to for an arrow key: from the node selected, the nearest shown node that lies that way,
 * one straight ahead before one off to the side. With nothing selected, the shown node nearest to a point (the middle
 * of what is on screen). Nothing when no node lies that way. */
export function stepFrom(nodes: readonly ViewNode[], shown: (index: number) => boolean, from: ViewNode | undefined, direction: Direction, nearX: number, nearY: number): ViewNode | undefined {
  let best: ViewNode | undefined;
  let bestCost = Infinity;
  const fromX = from ? from.x + from.w / 2 : nearX;
  const fromY = from ? from.y + from.h / 2 : nearY;
  for (const node of nodes) {
    if (node === from || !shown(node.index)) continue;
    const dx = node.x + node.w / 2 - fromX;
    const dy = node.y + node.h / 2 - fromY;
    let cost: number;
    if (!from) cost = Math.hypot(dx, dy);
    else {
      const ahead = direction === "left" ? -dx : direction === "right" ? dx : direction === "up" ? -dy : dy;
      const aside = Math.abs(direction === "left" || direction === "right" ? dy : dx);
      if (ahead <= 0 || aside > ahead * 2) continue;
      cost = ahead + aside * 2;
    }
    if (cost < bestCost) {
      best = node;
      bestCost = cost;
    }
  }
  return best;
}

/** The camera moved just far enough that a node is whole inside what the insets leave of the canvas: the camera itself
 * when the node already is, and the node in the middle of that room when it is larger than the room. */
export function reveal(camera: Camera, node: ViewNode, width: number, height: number, insets: Insets, margin = 16): Camera {
  const [left, top] = toScreen(camera, node.x, node.y);
  const right = left + node.w * camera.k;
  const bottom = top + node.h * camera.k;
  const minX = insets.l + margin;
  const maxX = width - insets.r - margin;
  const minY = insets.t + margin;
  const maxY = height - insets.b - margin;
  const shift = (low: number, high: number, min: number, max: number): number => {
    if (high - low > max - min) return (min + max) / 2 - (low + high) / 2;
    return low < min ? min - low : high > max ? max - high : 0;
  };
  const dx = shift(left, right, minX, maxX);
  const dy = shift(top, bottom, minY, maxY);
  return dx === 0 && dy === 0 ? camera : { ox: camera.ox + dx, oy: camera.oy + dy, k: camera.k };
}
