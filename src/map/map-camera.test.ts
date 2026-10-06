import { describe, expect, it } from "vitest";
import {
  boxAround, centreOn, defaultInsets, easeCamera, fitCamera, fitCameraIn, FIT_ZOOM, hitNode, insetsOf, MAX_ZOOM, MIN_ZOOM, minimapTransform, reveal, roomsBeside, stepFrom, toScreen, toWorld, zoomAt,
  type Camera, type Insets,
} from "./map-camera.js";
import type { ViewNode } from "./map-graphs.js";

const NONE: Insets = { l: 0, r: 0, t: 0, b: 0 };
const node = (index: number, x: number, y: number, w = 100, h = 40): ViewNode =>
  ({ id: String(index), index, kind: "module", layer: "s0", code: "", label: `N${index}`, fullName: `N${index}`, meta: "", external: false, x, y, w, h });
const all = (): boolean => true;

describe("The map's camera", () => {
  it("turns a place in the graph into a place on the canvas, and back", () => {
    const camera: Camera = { ox: 30, oy: -10, k: 0.5 };
    expect(toScreen(camera, 100, 200)).toEqual([80, 90]);
    expect(toWorld(camera, 80, 90)).toEqual([100, 200]);
  });

  it("fits a box into the middle of the room the panels leave, as large as it goes", () => {
    // A box of 1000 by 500 in a canvas of 1200 by 800 with 100 taken at each side: the room is 1000 by 600.
    const camera = fitCamera({ x: 0, y: 0, w: 1000, h: 500 }, 1200, 800, { l: 100, r: 100, t: 100, b: 100 });
    expect(camera.k).toBe(1);
    expect(toScreen(camera, 0, 0)).toEqual([100, 150]);
    expect(toScreen(camera, 1000, 500)).toEqual([1100, 650]);
    // A box that starts elsewhere is brought to the same place.
    const moved = fitCamera({ x: -400, y: 250, w: 1000, h: 500 }, 1200, 800, { l: 100, r: 100, t: 100, b: 100 });
    expect(toScreen(moved, -400, 250)).toEqual([100, 150]);
  });

  it("shrinks a box that is too large, by the side that is shorter of room", () => {
    const wide = fitCamera({ x: 0, y: 0, w: 4000, h: 500 }, 1000, 800, NONE);
    expect(wide.k).toBe(0.25);
    expect(toScreen(wide, 0, 0)).toEqual([0, 337.5]);
    const high = fitCamera({ x: 0, y: 0, w: 500, h: 4000 }, 1000, 800, NONE);
    expect(high.k).toBe(0.2);
  });

  it("never enlarges a small graph beyond the fit's limit, nor shrinks one beyond the least zoom", () => {
    expect(fitCamera({ x: 0, y: 0, w: 10, h: 10 }, 1000, 800, NONE).k).toBe(FIT_ZOOM);
    expect(fitCamera({ x: 0, y: 0, w: 10, h: 10 }, 1000, 800, NONE, 2).k).toBe(2);
    expect(fitCamera({ x: 0, y: 0, w: 1e7, h: 1e7 }, 1000, 800, NONE).k).toBe(MIN_ZOOM);
    // An empty box does not divide by nothing.
    expect(Number.isFinite(fitCamera({ x: 0, y: 0, w: 0, h: 0 }, 1000, 800, NONE).ox)).toBe(true);
  });

  it("keeps a least room when the panels would leave none", () => {
    const camera = fitCamera({ x: 0, y: 0, w: 160, h: 150 }, 200, 200, { l: 150, r: 150, t: 150, b: 150 });
    expect(camera.k).toBe(1);
  });

  it("fits into the room that shows the box largest", () => {
    const box = { x: 0, y: 0, w: 1000, h: 400 };
    const low: Insets = { l: 0, r: 0, t: 0, b: 400 };
    const narrow: Insets = { l: 0, r: 600, t: 0, b: 0 };
    // 1000 by 400 of room shows a wide box whole; 400 by 800 shows it at 0.4.
    expect(fitCameraIn(box, 1000, 800, [narrow, low]).k).toBe(1);
    expect(fitCameraIn(box, 1000, 800, [low, narrow]).k).toBe(1);
    expect(fitCameraIn({ x: 0, y: 0, w: 400, h: 1000 }, 1000, 800, [low, narrow]).k).toBe(0.8);
    expect(fitCameraIn(box, 1000, 800, []).k).toBe(1);
  });

  it("zooms about a point, which stays where it is, within the limits", () => {
    const camera: Camera = { ox: 100, oy: 50, k: 1 };
    const [worldX, worldY] = toWorld(camera, 400, 300);
    const closer = zoomAt(camera, 2, 400, 300);
    expect(closer.k).toBe(2);
    expect(toScreen(closer, worldX, worldY)).toEqual([400, 300]);
    expect(zoomAt(camera, 100, 0, 0).k).toBe(MAX_ZOOM);
    expect(zoomAt(camera, 0.0001, 0, 0).k).toBe(MIN_ZOOM);
  });

  it("puts a place of the graph in the middle of the canvas at the same zoom", () => {
    const camera = centreOn({ ox: 0, oy: 0, k: 0.5 }, 1000, 600, 800, 400);
    expect(camera.k).toBe(0.5);
    expect(toScreen(camera, 1000, 600)).toEqual([400, 200]);
  });

  it("moves towards where it is going by the time that passed, and arrives exactly", () => {
    const from: Camera = { ox: 0, oy: 0, k: 1 };
    const to: Camera = { ox: 100, oy: 200, k: 2 };
    const step = easeCamera(from, to, 1000 / 60);
    expect(step.done).toBe(false);
    expect(step.camera.ox).toBeCloseTo(14, 5);
    expect(step.camera.k).toBeCloseTo(1.14, 5);
    // Two frames at 120 a second are one at 60.
    const half = easeCamera(easeCamera(from, to, 1000 / 120).camera, to, 1000 / 120);
    expect(half.camera.ox).toBeCloseTo(step.camera.ox, 5);
    // A frame of no time moves nothing; enough frames arrive, and the camera is then the target itself.
    expect(easeCamera(from, to, 0).camera).toEqual(from);
    let camera = from;
    let frames = 0;
    for (; frames < 200; frames++) {
      const next = easeCamera(camera, to, 1000 / 60);
      camera = next.camera;
      if (next.done) break;
    }
    expect(camera).toBe(to);
    expect(frames).toBeLessThan(60);
  });
});

describe("What is under a point of the map", () => {
  const nodes = [node(0, 0, 0), node(1, 200, 0), node(2, 50, 20)];
  const camera: Camera = { ox: 10, oy: 10, k: 2 };

  it("finds the node under a point, the one drawn last where two overlap", () => {
    expect(hitNode(nodes, all, camera, 10 + 20, 10 + 20)?.index).toBe(0);
    expect(hitNode(nodes, all, camera, 10 + 2 * 250, 10 + 2 * 20)?.index).toBe(1);
    // (60, 30) in the graph is in the first node and in the third, which is drawn over it.
    expect(hitNode(nodes, all, camera, 10 + 2 * 60, 10 + 2 * 30)?.index).toBe(2);
    expect(hitNode(nodes, all, camera, 10 + 2 * 170, 10 + 2 * 30)).toBeUndefined();
    expect(hitNode(nodes, all, camera, 0, 0)).toBeUndefined();
  });

  it("goes by the order the nodes are drawn in, where a node was brought over the others", () => {
    // Drawn in the order 1, 2, 0: the first node now lies over the third where they overlap.
    expect(hitNode(nodes, all, camera, 10 + 2 * 60, 10 + 2 * 30, [1, 2, 0])?.index).toBe(0);
    expect(hitNode(nodes, all, camera, 10 + 2 * 60, 10 + 2 * 30, [0, 1, 2])?.index).toBe(2);
    expect(hitNode(nodes, index => index !== 0, camera, 10 + 2 * 60, 10 + 2 * 30, [1, 2, 0])?.index).toBe(2);
  });

  it("takes a node's edges as part of it, and passes over a node that is not shown", () => {
    expect(hitNode(nodes, all, camera, 10, 10)?.index).toBe(0);
    expect(hitNode(nodes, all, camera, 10 + 2 * 100, 10 + 2 * 40)?.index).toBe(2);
    expect(hitNode(nodes, index => index !== 2, camera, 10 + 2 * 60, 10 + 2 * 30)?.index).toBe(0);
    expect(hitNode(nodes, () => false, camera, 10 + 20, 10 + 20)).toBeUndefined();
    expect(hitNode([], all, camera, 0, 0)).toBeUndefined();
  });
});

describe("The room for a graph among the panels", () => {
  it("measures the box around some nodes, with a margin", () => {
    expect(boxAround([node(0, 0, 0), node(1, 200, 100)])).toEqual({ x: -30, y: -30, w: 360, h: 200 });
    expect(boxAround([node(0, 10, 10)], 0)).toEqual({ x: 10, y: 10, w: 100, h: 40 });
    expect(boxAround([])).toBeUndefined();
  });

  it("offers the room above a panel in a corner, and the room beside it", () => {
    const free = { left: 200, top: 100, right: 1000, bottom: 700 };
    const corner = { left: 780, top: 550, right: 990, bottom: 690 };
    expect(roomsBeside(free, [corner])).toEqual([{ left: 200, top: 100, right: 1000, bottom: 550 }, { left: 200, top: 100, right: 780, bottom: 700 }]);
    // A panel in each lower corner: above both, or between them.
    const other = { left: 210, top: 600, right: 440, bottom: 690 };
    expect(roomsBeside(free, [corner, other])).toEqual([{ left: 200, top: 100, right: 1000, bottom: 550 }, { left: 440, top: 100, right: 780, bottom: 700 }]);
  });

  it("leaves the room as it is for a panel that does not reach into it", () => {
    const free = { left: 200, top: 100, right: 700, bottom: 700 };
    expect(roomsBeside(free, [{ left: 780, top: 550, right: 990, bottom: 690 }])).toEqual([free]);
    expect(roomsBeside(free, [])).toEqual([free]);
  });

  it("says what a room leaves at each side of the canvas, with a margin inside it", () => {
    expect(insetsOf({ left: 200, top: 100, right: 1000, bottom: 700 }, 1200, 800)).toEqual({ l: 200, t: 100, r: 200, b: 100 });
    expect(insetsOf({ left: 200, top: 100, right: 1000, bottom: 700 }, 1200, 800, 24)).toEqual({ l: 224, t: 124, r: 224, b: 124 });
  });

  it("has a room of its own for a page it cannot measure, smaller with the details open", () => {
    expect(defaultInsets(1200, 800, false)).toEqual({ l: 192, r: 55, t: 166, b: 100 });
    expect(defaultInsets(1200, 800, true).r).toBe(330);
    expect(defaultInsets(1600, 900, false).l).toBe(225);
    const narrow = defaultInsets(600, 800, true);
    expect([narrow.l, narrow.r, narrow.b]).toEqual([18, 18, 400]);
  });

  it("shows the whole graph small in the corner, in the middle of the small picture", () => {
    const transform = minimapTransform({ x: -100, y: 0, w: 1800, h: 560 }, 196, 128);
    expect(transform.s).toBe(0.1);
    // 180 by 56 in a picture of 196 by 128.
    expect([transform.ox + -100 * transform.s, transform.oy]).toEqual([8, 36]);
    expect(Number.isFinite(minimapTransform({ x: 0, y: 0, w: 0, h: 0 }, 196, 128).s)).toBe(true);
  });
});

describe("The arrow keys on the map", () => {
  // A row of three and one below the middle.
  const nodes = [node(0, 0, 0), node(1, 300, 0), node(2, 600, 0), node(3, 300, 200), node(4, 5000, 5000)];

  it("moves to the nearest node that lies the way of the arrow", () => {
    expect(stepFrom(nodes, all, nodes[0], "right", 0, 0)?.index).toBe(1);
    expect(stepFrom(nodes, all, nodes[1], "right", 0, 0)?.index).toBe(2);
    expect(stepFrom(nodes, all, nodes[1], "left", 0, 0)?.index).toBe(0);
    expect(stepFrom(nodes, all, nodes[1], "down", 0, 0)?.index).toBe(3);
    expect(stepFrom(nodes, all, nodes[3], "up", 0, 0)?.index).toBe(1);
  });

  it("prefers a node straight ahead to a nearer one off to the side, and leaves out one too far to the side", () => {
    // To the right of the first node: one a little nearer but well below, and one straight ahead. Straight ahead wins.
    const near = [node(0, 0, 0), node(1, 260, 90), node(2, 320, 0)];
    expect(stepFrom(near, all, near[0], "right", 0, 0)?.index).toBe(2);
    // Down from the first node: a node 60 below and 300 to the side is more aside than twice what it is ahead, and is
    // left out; the next one below is taken, far as it is.
    const aside = [node(0, 0, 0), node(1, 300, 60), node(2, 100, 900)];
    expect(stepFrom(aside, all, aside[0], "down", 0, 0)?.index).toBe(2);
    // The node below the middle of the row is 200 below and 300 aside: within reach of the down arrow.
    expect(stepFrom(nodes, all, nodes[0], "down", 0, 0)?.index).toBe(3);
  });

  it("stays where it is when nothing lies that way, and passes over a node that is not shown", () => {
    expect(stepFrom(nodes, all, nodes[0], "left", 0, 0)).toBeUndefined();
    expect(stepFrom(nodes, all, nodes[0], "up", 0, 0)).toBeUndefined();
    expect(stepFrom(nodes, index => index !== 1, nodes[0], "right", 0, 0)?.index).toBe(2);
  });

  it("starts at the node nearest to the middle of what is on screen", () => {
    expect(stepFrom(nodes, all, undefined, "right", 640, 30)?.index).toBe(2);
    expect(stepFrom(nodes, all, undefined, "up", 340, 190)?.index).toBe(3);
    expect(stepFrom(nodes, () => false, undefined, "right", 0, 0)).toBeUndefined();
  });
});

describe("Bringing a node into view", () => {
  const camera: Camera = { ox: 0, oy: 0, k: 1 };
  const room: Insets = { l: 100, r: 300, t: 50, b: 50 };

  it("leaves the camera as it is for a node that is whole inside the room", () => {
    expect(reveal(camera, node(0, 200, 200), 1000, 600, room)).toBe(camera);
  });

  it("moves just far enough for a node that is outside it", () => {
    // The room is 116 to 684 across and 66 to 534 down. A node from 650 to 750 is 66 too far right.
    expect(reveal(camera, node(0, 650, 200), 1000, 600, room)).toEqual({ ox: -66, oy: 0, k: 1 });
    expect(reveal(camera, node(0, 0, 0), 1000, 600, room)).toEqual({ ox: 116, oy: 66, k: 1 });
    expect(reveal(camera, node(0, 300, 520), 1000, 600, room)).toEqual({ ox: 0, oy: -26, k: 1 });
  });

  it("puts a node that is larger than the room in the middle of it", () => {
    const large = node(0, 0, 0, 2000, 40);
    const moved = reveal({ ox: 0, oy: 100, k: 1 }, large, 1000, 600, room);
    expect(moved.ox + 1000).toBe((116 + 684) / 2);
    expect(moved.oy).toBe(100);
  });
});
