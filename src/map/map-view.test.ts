import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeElement, FakePage } from "../results/dom.test-support.js";
import type { ModelGraph, ModelMap, ModelMapOptions } from "./graph-types.js";
import type { Pen } from "./map-canvas.js";
import { FALLBACK } from "./map-palette.js";
import { mountModelMap, mountModelMapIn, PICKER_CAP, type MapEnvironment } from "./map-view.js";
import { FakePen, GraphMaker, HOSTILE, type PenCall } from "./map-fakes.test-support.js";
import { ACCESS_SAYS, FULL_SAYS } from "./map-markup.js";

/** A page with a control outside the map, and the place the map is put into. */
const SHELL = '<!DOCTYPE html><html lang="en" data-theme="light"><head><title>Page</title></head><body><button type="button" id="outside">Outside</button><main id="main"><div id="host"></div></main></body></html>';

/** What stands in for the browser around the map: it hands out pens that write down what they draw, tells sizes when a
 * test says so, and runs a frame when a test says so. */
class FakeSurroundings implements MapEnvironment {
  readonly main = new FakePen();
  readonly mini = new FakePen();
  tokens: Record<string, string> = {};
  tokenReads = 0;
  reduced = true;
  ratio = 1;
  time = 1000;
  requested = 0;
  cancelled = 0;
  stopped = 0;
  private readonly pending = new Map<number, (time: number) => void>();
  private readonly watchers: { changed: (width: number, height: number) => void; on: boolean }[] = [];
  private last = 0;

  pen(canvas: HTMLCanvasElement): Pen { return ((canvas as unknown as FakeElement).classList.contains("map-minimap") ? this.mini : this.main) as unknown as Pen; }
  watchSize(_element: Element, changed: (width: number, height: number) => void): () => void {
    const watcher = { changed, on: true };
    this.watchers.push(watcher);
    return () => {
      watcher.on = false;
      this.stopped++;
    };
  }
  token(_element: Element, name: string): string {
    this.tokenReads++;
    return this.tokens[name] ?? "";
  }
  requestFrame(callback: (time: number) => void): number {
    this.requested++;
    this.pending.set(++this.last, callback);
    return this.last;
  }
  cancelFrame(frame: number): void { if (this.pending.delete(frame)) this.cancelled++; }
  reducedMotion(): boolean { return this.reduced; }
  pixelRatio(): number { return this.ratio; }
  now(): number { return this.time; }

  /** How many frames are asked for and not yet run. */
  get waiting(): number { return this.pending.size; }
  /** The browser shows a picture: every call asked for is made, with the time moved on. Says how many were made. */
  frame(elapsed = 16): number {
    this.time += elapsed;
    const callbacks = [...this.pending.values()];
    this.pending.clear();
    for (const callback of callbacks) callback(this.time);
    return callbacks.length;
  }
  /** Runs frames until none is asked for, at most `most`. Says how many it ran. */
  settle(most = 400): number {
    let ran = 0;
    while (this.pending.size && ran < most) {
      this.frame();
      ran++;
    }
    return ran;
  }
  /** The map's element has a new size. */
  resize(width: number, height: number): void { for (const watcher of this.watchers) if (watcher.on) watcher.changed(width, height); }

  /** The browser's full screen: the element it gives the screen, whether it refuses to, and how often it was asked to give
   * it and to take it back. As a browser does, it tells the element of each change. */
  holder: Element | null = null;
  refuses = false;
  asked = 0;
  left = 0;
  requestFullscreen(element: Element): Promise<void> {
    this.asked++;
    if (this.refuses) return Promise.reject(new Error("full screen is not allowed here"));
    this.holder = element;
    (element as unknown as FakeElement).dispatch("fullscreenchange");
    return Promise.resolve();
  }
  exitFullscreen(): Promise<void> {
    this.left++;
    const held = this.holder;
    this.holder = null;
    (held as unknown as FakeElement | null)?.dispatch("fullscreenchange");
    return Promise.resolve();
  }
  fullscreenElement(): Element | null { return this.holder; }
}

/** Three sections. Inputs feed Calculations, whose two modules read each other, and Calculations feed Reporting. */
function sample() {
  const make = new GraphMaker();
  const products = make.list("Products", { count: 40 });
  const volumes = make.module("INP01 - Volumes", "01: Inputs", { cells: 4800 });
  const prices = make.module("INP02 - Prices", "01: Inputs");
  const revenue = make.module("CAL01 - Revenue", "02: Calculations");
  const margin = make.module("Margin Workings", "02: Calculations");
  const board = make.module("REP01 - Board", "Reporting");
  const units = make.item(volumes, "Units");
  const canEdit = make.item(volumes, "Can Edit", { format: "BOOLEAN" });
  const price = make.item(prices, "Price");
  const heading = make.item(revenue, "Workings", { format: "NONE" });
  const gross = make.item(revenue, "Gross", { formula: "Units * Price" });
  const net = make.item(revenue, "Net", { formula: "Gross - Cost" });
  const cost = make.item(margin, "Cost");
  const marginPct = make.item(margin, "Margin %", { formula: "1 - Cost / Gross" });
  const total = make.item(board, "Total", { formula: "Net" });
  make.link(units, gross).link(price, gross).link(gross, net).link(cost, net).link(cost, marginPct).link(gross, marginPct).link(net, total)
    .link(products, gross, "list_formula").link(canEdit, net, "write_access");
  make.limitations.push("List members are not in the export.");
  return { graph: make.graph(), volumes, prices, revenue, margin, board, units, canEdit, price, heading, gross, net, cost, marginPct, total, products };
}

let page: FakePage;
let env: FakeSurroundings;
let host: FakeElement;
let map: ModelMap;

/** Whatever the map could keep things in or change the address with: touching any of them fails the test. */
function forbidden(name: string): object {
  const fail = (): never => { throw new Error(`The map touched ${name}`); };
  return new Proxy({}, { get: fail, set: fail, has: fail, ownKeys: fail, deleteProperty: fail });
}

beforeEach(() => {
  page = new FakePage(SHELL);
  env = new FakeSurroundings();
  host = page.id("host");
  vi.stubGlobal("document", page.document);
  for (const name of ["localStorage", "sessionStorage", "history", "location", "indexedDB", "caches"]) vi.stubGlobal(name, forbidden(name));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Mounts the map. Its sections are the graph's heading rows, as if the viewer had chosen that grouping, unless the
 * options say otherwise: the tests of how the map groups modules by itself are in a block of their own. */
function mount(graph: ModelGraph = sample().graph, options: ModelMapOptions = { modelName: "Demand Plan", workspaceName: "Sandbox" }): void {
  map = mountModelMapIn(host as unknown as HTMLElement, graph, { grouping: "headings", ...options }, env);
}
/** Mounts the map, shows it at a size, and lets the first picture be drawn. */
function open(graph?: ModelGraph, width = 1200, height = 800): void {
  mount(graph);
  map.show();
  env.resize(width, height);
  env.settle();
}

const root = (): FakeElement => host.children[0];
const part = (selector: string): FakeElement => root().querySelector(selector) ?? (() => { throw new Error(`The map has no ${selector}`); })();
const parts = (selector: string): FakeElement[] => root().querySelectorAll(selector);
const text = (selector: string): string => part(selector).textContent.replace(/\s+/g, " ").trim();
const canvas = (): FakeElement => part(".map-canvas");
const act = (name: string): FakeElement => part(`[data-map-act="${name}"]`);
/** Where the path says the map is: the module of the Line items view, the group or "All modules" its Show list has
 * chosen, or the model's name where the map shows the model whole. */
function here(): string {
  if (!part(".map-picker").hidden) return part(".map-picker-input").value;
  const show = part(".map-show-select");
  if (!show.hidden && show.value !== "groups") {
    const option = show.querySelectorAll("option").find(each => each.getAttribute("value") === show.value);
    return (option?.textContent ?? "").replace(/ · [\d,]+ modules?$/, "");
  }
  return text(".map-title-name");
}
/** Goes from the groups to all modules, and from anywhere else to the groups, by the path's Show list. */
function toggleGroups(): void {
  const show = part(".map-show-select");
  show.choose(show.value === "groups" ? "modules" : "groups");
}
/** Shows a module's line items by the picker: its name typed, and Enter. */
function pickModule(name: string): void {
  part(".map-picker-input").type(name);
  key("Enter");
}
/** Goes to a box by the search: its name typed, and Enter. */
function goTo(name: string): void {
  part(".map-search").type(name);
  key("Enter");
}
/** Puts the focus in the module picker, as a press or Tab does, which opens its list. */
function openPicker(): void {
  const input = part(".map-picker-input");
  input.focus();
  input.dispatch("focusin");
}
/** The names the picker lists now. */
const picked = (): string[] => parts(".map-picker-opt .map-picker-name").map(option => option.textContent);
/** Ticks Access drivers in the panel of links, which is opened for it where it is closed. */
function tickAccess(): void {
  if (part(".map-links-pop").hidden) act("links").press();
  part(".map-access").tick();
}
/** The line that says what the map shows. */
const status = (): string => text(".map-stats");
/** The links of the last picture: the lines drawn that end a curve. */
function linksDrawn(): PenCall[] {
  const calls = lastPicture();
  return calls.filter((call, index) => {
    if (call.name !== "stroke") return false;
    for (let at = index - 1; at >= 0 && calls[at].name !== "beginPath"; at--) if (calls[at].name === "bezierCurveTo") return true;
    return false;
  });
}
/** The boxes of the last picture, each as how strongly it is drawn. */
const boxStrengths = (): number[] => {
  const calls = lastPicture();
  return calls.filter((call, index) => call.name === "fill" && calls[index - 1]?.name === "roundRect").map(call => call.globalAlpha);
};
const tab = (view: string): FakeElement => part(`[data-map-view="${view}"]`);
const pointer = (type: string, x: number, y: number, target: FakeElement = canvas()): void => { target.dispatch(type, { clientX: x, clientY: y, button: 0, pointerId: 1 } as unknown as { key?: string }); };
const key = (name: string, extra: Record<string, unknown> = {}) => page.document.activeElement.dispatch("keydown", { key: name, ...extra });

/** The calls of the last picture drawn on the canvas: from the fill of the whole canvas on. */
function lastPicture(): PenCall[] {
  const calls = env.main.calls;
  let from = calls.length - 1;
  while (from > 0 && !(calls[from].name === "fillRect" && calls[from].args[0] === 0 && calls[from].args[1] === 0 && calls[from - 1]?.name !== "roundRect")) from--;
  return calls.slice(Math.max(0, from));
}

/** Where each node is on the canvas: each box of the last picture, by the name the tooltip says when the pointer is at
 * its middle. So a place comes from what was drawn, and a name from what the map itself says is under the pointer. */
function boxes(): Map<string, { x: number; y: number; w: number; h: number }> {
  // A picture that still moves asks for frame after frame: one frame is then enough for a picture.
  if (env.reduced) env.settle(); else env.frame();
  const calls = lastPicture();
  const found = new Map<string, { x: number; y: number; w: number; h: number }>();
  const tip = part(".map-tooltip");
  for (let index = 0; index < calls.length - 1; index++) {
    // A node's box is filled; the rings around a node are only drawn as lines.
    if (calls[index].name !== "roundRect" || calls[index + 1].name !== "fill") continue;
    const [x, y, w, h] = calls[index].args as number[];
    pointer("pointermove", x + w / 2, y + h / 2);
    if (tip.classList.contains("map-show")) found.set(tip.querySelector(".map-tip-name")?.textContent ?? "", { x, y, w, h });
  }
  canvas().dispatch("pointerleave");
  return found;
}
/** The middle of each box of the last picture. */
function locate(): Map<string, [number, number]> {
  return new Map([...boxes()].map(([name, box]) => [name, [box.x + box.w / 2, box.y + box.h / 2]]));
}
function at(name: string): [number, number] {
  const point = locate().get(name);
  if (!point) throw new Error(`No node named ${name} is on the canvas`);
  return point;
}
/** A press and a release at one place, with the clock moved on so that two of them are no double press. */
function click(x: number, y: number): void {
  env.time += 1000;
  pointer("pointerdown", x, y);
  pointer("pointerup", x, y);
}
const clickNode = (name: string): void => click(...at(name));
function doubleClick(name: string): void {
  const [x, y] = at(name);
  click(x, y);
  env.time += 120;
  pointer("pointerdown", x, y);
  pointer("pointerup", x, y);
}

/** Many modules that nothing links: fitted whole into the map's place they are small, and still hold their names. */
const manyModules = (count: number): ModelGraph => {
  const make = new GraphMaker();
  for (let index = 0; index < count; index++) make.item(make.module(`M${index} - Module ${index}`, `${index % 4}: Section ${index % 4}`), "Value");
  return make.graph();
};
/** How many boxes of the last picture hold no name: a box is drawn, and no text is written in it. */
function blankBoxes(): number {
  const calls = lastPicture();
  const texts = calls.filter(call => call.name === "fillText").map(call => call.args as [string, number, number]);
  let blank = 0;
  calls.forEach((call, index) => {
    if (call.name !== "roundRect" || calls[index + 1]?.name !== "fill") return;
    const [x, y, w, h] = call.args as number[];
    if (x + w < 0 || y + h < 0 || x > 1200 || y > 800) return;
    if (!texts.some(([, tx, ty]) => tx >= x && tx <= x + w && ty >= y && ty <= y + h + 2)) blank++;
  });
  return blank;
}

describe("The map in the place the page gives it", () => {
  it("puts one element of its own into the host, hidden, and draws nothing until it is shown", () => {
    mount();
    expect(host.children).toHaveLength(1);
    expect([root().localName, root().getAttribute("class"), root().hidden]).toEqual(["div", "map-root", true]);
    expect([env.requested, env.main.calls.length, env.mini.calls.length, env.tokenReads]).toEqual([0, 0, 0, 0]);
    // A size that comes before it is shown changes nothing of that.
    env.resize(1200, 800);
    expect([env.requested, env.main.named("fillRect").length]).toEqual([0, 0]);
  });

  it("makes nothing outside the host, and looks nothing up on the page", () => {
    const before = page.document.body.outerHTML.replace(host.outerHTML, "");
    const lookups: string[] = [];
    vi.stubGlobal("document", new Proxy(page.document, { get: (target, name) => {
      if (name === "getElementById" || name === "querySelector" || name === "querySelectorAll" || name === "body" || name === "documentElement") lookups.push(String(name));
      return Reflect.get(target, name);
    } }));
    open();
    clickNode("02: Calculations");
    act("open").press();
    expect(lookups).toEqual([]);
    expect(page.document.body.outerHTML.replace(host.outerHTML, "")).toBe(before);
    // Every element the script made is inside the map's own element.
    for (const element of page.created) expect(element === root() || !element.isConnected || root().contains(element)).toBe(true);
  });

  it("names every element, class and id of its own with the map's prefix, in every view", () => {
    open();
    const check = (): void => {
      for (const element of [root(), ...parts("[class]"), ...parts("[id]")]) {
        for (const name of (element.getAttribute("class") ?? "").split(/\s+/).filter(each => each !== "")) expect(name, element.outerHTML.slice(0, 80)).toMatch(/^map-/);
        if (element.hasAttribute("id")) expect(element.id).toMatch(/^map-/);
      }
    };
    check();
    clickNode("02: Calculations");
    check();
    act("open").press();
    clickNode("CAL01 - Revenue");
    act("open").press();
    clickNode("Gross");
    part(".map-search").type("gross");
    check();
  });

  it("gives two maps on one page ids of their own", () => {
    mount();
    const other = page.document.createElement("div");
    page.document.body.append(other);
    mountModelMapIn(other as unknown as HTMLElement, sample().graph, { modelName: "Other" }, new FakeSurroundings());
    const ids = (element: FakeElement): string[] => element.querySelectorAll("[id]").map(each => each.id);
    expect(ids(host).length).toBeGreaterThan(0);
    expect(ids(host).filter(id => ids(other).includes(id))).toEqual([]);
    expect(ids(other).every(id => id.startsWith("map-"))).toBe(true);
  });

  it("shows itself, draws one picture, and asks for no other while nothing changes", () => {
    mount();
    map.show();
    expect(root().hidden).toBe(false);
    env.resize(1200, 800);
    expect(env.main.named("fillRect")[0]).toMatchObject({ args: [0, 0, 1200, 800], fillStyle: FALLBACK.canvas });
    expect(env.settle()).toBeLessThanOrEqual(1);
    const [requested, drawn] = [env.requested, env.main.calls.length];
    // Time passes, the pointer moves over the canvas: nothing is drawn and no frame is asked for.
    env.time += 60000;
    pointer("pointermove", 600, 400);
    pointer("pointermove", 30, 30);
    expect([env.requested, env.waiting, env.main.calls.length]).toEqual([requested, 0, drawn]);
  });

  it("draws on a canvas as large as the place it has, in the screen's own pixels", () => {
    env.ratio = 2;
    open(undefined, 1000, 600);
    expect([canvas().getAttribute("role"), (canvas() as unknown as HTMLCanvasElement).width, (canvas() as unknown as HTMLCanvasElement).height]).toEqual(["img", 2000, 1200]);
    expect(env.main.named("setTransform").at(-1)?.args).toEqual([2, 0, 0, 2, 0, 0]);
    expect((part(".map-minimap") as unknown as HTMLCanvasElement).width).toBe(392);
    // A screen with more than two pixels to one is drawn at two.
    env.ratio = 3;
    env.resize(1000, 600);
    expect((canvas() as unknown as HTMLCanvasElement).width).toBe(2000);
  });

  it("follows the size of its place, draws again at once, and keeps the middle of the picture where it was", () => {
    open();
    const before = locate();
    expect(before.size).toBe(3);
    env.main.clear();
    env.resize(1400, 900);
    // The new picture is drawn in the same step: a canvas that changed its size is never shown cleared.
    expect(env.main.named("fillRect")[0]?.args).toEqual([0, 0, 1400, 900]);
    expect(env.waiting).toBe(0);
    const after = locate();
    for (const [name, [x, y]] of before) expect(after.get(name), name).toEqual([x + 100, y + 50]);
    // The same size again draws nothing.
    env.main.clear();
    env.resize(1400, 900);
    expect(env.main.calls).toEqual([]);
  });

  it("keeps nothing anywhere and never changes the address: the page's storage and history are never touched", () => {
    open();
    clickNode("02: Calculations");
    act("open").press();
    clickNode("CAL01 - Revenue");
    act("open").press();
    part(".map-search").type("net");
    key("Enter");
    key("Escape");
    map.hide();
    map.show();
    map.destroy();
    // The stand-ins for storage, history and the address throw when touched; getting here says none was.
    expect(host.children).toEqual([]);
  });

  it("refuses to mount where the canvas cannot be drawn on, and leaves the host as it was", () => {
    // The stand-in page's canvas gives no drawing context, as a browser's may refuse one.
    expect(() => mountModelMap(host as unknown as HTMLElement, sample().graph, { modelName: "Demand Plan" })).toThrow("the canvas gave no context");
    expect(host.children).toEqual([]);
    class NoPen extends FakeSurroundings {
      override pen(): Pen { return null as unknown as Pen; }
    }
    const without = new NoPen();
    expect(() => mountModelMapIn(host as unknown as HTMLElement, sample().graph, { modelName: "Demand Plan" }, without)).toThrow("the canvas gave no context");
    expect([host.children.length, without.requested, without.stopped]).toEqual([0, 0, 0]);
  });

  it("refuses to mount where its size cannot be watched, and leaves the host as it was", () => {
    class NoWatching extends FakeSurroundings {
      override watchSize(): () => void { throw new Error("no observer here"); }
    }
    const without = new NoWatching();
    expect(() => mountModelMapIn(host as unknown as HTMLElement, sample().graph, { modelName: "Demand Plan" }, without)).toThrow("no observer here");
    expect([host.children.length, without.requested]).toEqual([0, 0]);
  });

  it("goes without the small picture where only that canvas cannot be drawn on", () => {
    class NoSmallPen extends FakeSurroundings {
      override pen(canvas: HTMLCanvasElement): Pen { return ((canvas as unknown as FakeElement).classList.contains("map-minimap") ? null : this.main) as unknown as Pen; }
    }
    env = new NoSmallPen();
    open();
    expect(env.main.named("fillRect").length).toBeGreaterThan(0);
    expect(env.mini.calls).toEqual([]);
    // A press on the small picture that was never drawn does nothing.
    pointer("pointerdown", 20, 20, part(".map-minimap"));
    expect(env.waiting).toBe(0);
  });
});

describe("Showing, hiding and ending the map", () => {
  it("takes the focus as it is shown, so that its keys work from the first one", () => {
    page.id("outside").focus();
    mount();
    expect(page.document.activeElement.id).toBe("outside");
    map.show();
    expect(page.document.activeElement).toBe(canvas());
    env.resize(1200, 800);
    key("f");
    expect(env.waiting).toBe(1);
  });

  it("leaves focus that is already inside it where it is, and does not take it again while it stays shown", () => {
    open();
    part(".map-search").focus();
    map.show();
    expect(page.document.activeElement).toBe(part(".map-search"));
    page.id("outside").focus();
    map.show();
    expect(page.document.activeElement.id).toBe("outside");
    map.hide();
    map.show();
    expect(page.document.activeElement).toBe(canvas());
  });

  it("takes the focus once the page's own step is over, where the page still keeps the map out of reach as it shows it", async () => {
    const main = page.id("main");
    page.id("outside").focus();
    mount();
    main.inert = true;
    map.show();
    expect(page.document.activeElement.id).toBe("outside");
    main.inert = false;
    await Promise.resolve();
    expect(page.document.activeElement).toBe(canvas());
  });

  it("does not take the focus later for a map that was hidden or ended in the meantime", async () => {
    const main = page.id("main");
    page.id("outside").focus();
    mount();
    main.inert = true;
    map.show();
    map.hide();
    main.inert = false;
    await Promise.resolve();
    expect(page.document.activeElement.id).toBe("outside");
    map.show();
    main.inert = true;
    page.id("outside").focus();
    map.hide();
    map.show();
    map.destroy();
    main.inert = false;
    await Promise.resolve();
    expect(page.document.activeElement.id).toBe("outside");
  });

  it("draws nothing while hidden, and comes back as it was left", () => {
    open();
    clickNode("02: Calculations");
    act("open").press();
    env.settle();
    const places = [...locate()];
    key("f");
    expect(env.waiting).toBe(1);
    const cancelled = env.cancelled;
    map.hide();
    // The picture that was asked for is called off.
    expect([root().hidden, env.waiting, env.cancelled - cancelled]).toEqual([true, 0, 1]);
    const [requested, drawn] = [env.requested, env.main.calls.length];
    // Hidden, its place has no size, and nothing it is told draws anything.
    env.resize(0, 0);
    map.themeChanged();
    expect([env.requested, env.main.calls.length]).toEqual([requested, drawn]);
    map.show();
    env.resize(1200, 800);
    env.settle();
    expect(here()).toBe("02: Calculations");
    expect([...locate()]).toEqual(places);
  });

  it("reads the colours when it is shown and when the theme changes, and draws with the new ones", () => {
    env.tokens = { "--map-canvas-bg": "#101010", "--map-node-fill": "#202020", "--sans": "Inter, sans-serif" };
    open();
    expect(env.main.named("fillRect")[0].fillStyle).toBe("#101010");
    expect(env.main.named("fillText").some(call => call.font.endsWith("Inter, sans-serif"))).toBe(true);
    const reads = env.tokenReads;
    env.tokens = { "--map-canvas-bg": "#fafafa", "--map-node-fill": "not a colour" };
    env.main.clear();
    map.themeChanged();
    expect(env.tokenReads).toBeGreaterThan(reads);
    expect(env.settle()).toBe(1);
    expect(env.main.named("fillRect")[0].fillStyle).toBe("#fafafa");
    // What is no colour is drawn in the map's own colour for it.
    expect(env.main.named("fill").some(call => call.fillStyle === FALLBACK.nodeFill)).toBe(true);
    // The fonts are the same: no word is measured again for the new colours.
    const measured = env.main.measured.length;
    env.tokens = { "--map-canvas-bg": "#fafafa", "--sans": "Inter, sans-serif" };
    map.themeChanged();
    env.settle();
    expect(env.main.measured.length).toBeGreaterThan(measured);
    const again = env.main.measured.length;
    env.tokens = { "--map-canvas-bg": "#eeeeee", "--sans": "Inter, sans-serif" };
    map.themeChanged();
    env.settle();
    expect(env.main.measured.length).toBe(again);
    // Hidden, a change of theme is read when the map is next shown.
    map.hide();
    const hiddenReads = env.tokenReads;
    env.tokens = { "--map-canvas-bg": "#303030" };
    map.themeChanged();
    expect(env.tokenReads).toBe(hiddenReads);
    env.main.clear();
    map.show();
    env.resize(1200, 800);
    env.settle();
    expect(env.main.named("fillRect")[0].fillStyle).toBe("#303030");
  });

  it("sizes its canvas and draws one picture for each show, whether its size is told in whole pixels or in fractions", () => {
    mount();
    // A canvas as a browser lays it out, at a height that is no whole number of pixels.
    canvas().getBoundingClientRect = () => ({ left: 0, top: 0, right: 1200, bottom: 735.6, width: 1200, height: 735.6 });
    let sized = 0;
    let wide = 0;
    Object.defineProperty(canvas(), "width", { get: () => wide, set: (value: number) => { wide = value; sized++; } });
    const pictures = (): number => env.main.calls.filter(call => call.name === "fillRect" && call.args[0] === 0 && call.args[1] === 0 && call.args[2] === 1200).length;
    map.show();
    // The browser then tells the size it watched: the same one, in fractions, and rounded by another source.
    env.resize(1200, 735.6);
    env.resize(1200, 736);
    env.settle();
    expect([pictures(), sized, wide]).toEqual([1, 1, 1200]);
    // A size that really is another is followed.
    env.resize(1200, 700);
    env.settle();
    expect([pictures(), sized]).toEqual([2, 2]);
    env.resize(1200, 735.6);
    env.settle();
    // Shown again at the size it had: one picture, and the canvas keeps its size.
    map.hide();
    env.resize(0, 0);
    map.show();
    env.resize(1200, 735.6);
    env.settle();
    expect([pictures(), sized]).toEqual([4, 3]);
  });

  it("ends a drag, closes the tooltip and the search's results, and forgets a first press when it is hidden", () => {
    open();
    toggleGroups();
    // The pointer over a node: its tooltip, and the hand.
    const [x, y] = at("CAL01 - Revenue");
    pointer("pointermove", x, y);
    expect([part(".map-tooltip").classList.contains("map-show"), canvas().classList.contains("map-over-node")]).toEqual([true, true]);
    map.hide();
    expect([part(".map-tooltip").classList.contains("map-show"), canvas().classList.contains("map-over-node")]).toEqual([false, false]);
    map.show();
    env.settle();
    // A search with its results open, and the picture marked for it.
    part(".map-search").type("revenue");
    env.settle();
    expect([part(".map-results").hidden, boxStrengths().some(strength => strength < 1)]).toEqual([false, true]);
    map.hide();
    expect(part(".map-results").hidden).toBe(true);
    map.show();
    env.settle();
    expect([part(".map-search").value, boxStrengths()]).toEqual(["revenue", [1, 1, 1, 1, 1]]);
    // A node in the middle of being dragged: the canvas no longer says so, and the pointer that comes back moves nothing.
    const before = boxes();
    const from = before.get("INP02 - Prices")!;
    pointer("pointerdown", from.x + 20, from.y + 10);
    pointer("pointermove", from.x + 80, from.y + 90);
    expect(canvas().classList.contains("map-dragging")).toBe(true);
    map.hide();
    expect(canvas().classList.contains("map-dragging")).toBe(false);
    map.show();
    env.settle();
    const dropped = boxes().get("INP02 - Prices")!;
    pointer("pointermove", from.x + 200, from.y + 200);
    pointer("pointerup", from.x + 200, from.y + 200);
    env.settle();
    expect(boxes().get("INP02 - Prices")).toEqual(dropped);
    expect(part(".map-inspector").hidden).toBe(true);
    // A first press, and the map hidden before the second: shown again, a press at the same place is a first press.
    const [nodeX, nodeY] = at("CAL01 - Revenue");
    click(nodeX, nodeY);
    map.hide();
    map.show();
    env.settle();
    act("clear").press();
    const [againX, againY] = at("CAL01 - Revenue");
    env.time += 100;
    pointer("pointerdown", againX, againY);
    pointer("pointerup", againX, againY);
    expect([here(), text(".map-insp-name")]).toEqual(["All modules", "CAL01 - Revenue"]);
  });

  it("stops the timer of a press when it is ended", () => {
    vi.useFakeTimers();
    open();
    clickNode("02: Calculations");
    expect([root().classList.contains("map-arriving"), vi.getTimerCount()]).toEqual([true, 1]);
    map.destroy();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(1000);
    expect(host.children).toEqual([]);
  });

  it("draws again when the browser gives a lost canvas back, and only while it is shown", () => {
    open();
    const pictures = (): number => env.main.calls.filter(call => call.name === "fillRect" && call.args[0] === 0 && call.args[1] === 0 && call.args[2] === 1200).length;
    const before = pictures();
    canvas().dispatch("contextrestored");
    expect(env.waiting).toBe(1);
    env.settle();
    expect(pictures()).toBe(before + 1);
    // The small picture's canvas too: the two are drawn together.
    part(".map-minimap").dispatch("contextrestored");
    env.settle();
    expect(pictures()).toBe(before + 2);
    map.hide();
    canvas().dispatch("contextrestored");
    expect([env.waiting, pictures()]).toEqual([0, before + 2]);
    // Shown again, the picture is drawn as at any show.
    map.show();
    env.settle();
    expect(pictures()).toBe(before + 3);
  });

  it("takes its element out of the host and stops everything when it is ended", () => {
    open();
    clickNode("02: Calculations");
    key("f");
    const outside = canvas();
    map.destroy();
    expect(host.children).toEqual([]);
    expect([env.waiting, env.stopped]).toEqual([0, 1]);
    const requested = env.requested;
    // Nothing it is told or sent afterwards does anything.
    map.show();
    map.themeChanged();
    map.hide();
    map.destroy();
    env.resize(900, 700);
    outside.dispatch("keydown", { key: "f" });
    expect([env.requested, host.children.length]).toEqual([requested, 0]);
  });

  it("lets presses through the details only for a moment, and not at all once it is hidden", () => {
    vi.useFakeTimers();
    open();
    clickNode("02: Calculations");
    expect(root().classList.contains("map-arriving")).toBe(true);
    vi.advanceTimersByTime(500);
    expect(root().classList.contains("map-arriving")).toBe(false);
    clickNode("01: Inputs");
    map.hide();
    expect(root().classList.contains("map-arriving")).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("A map that fails", () => {
  const failing = (words: string) => (): never => { throw new Error(words); };
  const SENTENCE = (reason: string): string => `Drawing it failed (${reason}), and the map has stopped. The tables of this result are not affected.`;

  it("lets a failure of the first picture go to the page that asked for it to be shown", () => {
    mount();
    canvas().getBoundingClientRect = () => ({ left: 0, top: 0, right: 1200, bottom: 800, width: 1200, height: 800 });
    env.main.fillRect = failing("no picture can be drawn");
    // The page shows its own sentence then, and takes the map away.
    expect(() => map.show()).toThrow("no picture can be drawn");
    map.destroy();
    expect([host.children.length, env.waiting, env.stopped]).toEqual([0, 0, 1]);
  });

  it("stops and says in its own place that it could not be drawn, when a picture drawn later fails", () => {
    open();
    clickNode("02: Calculations");
    canvas().focus();
    env.main.fillRect = failing("the canvas is gone");
    key("f");
    expect(env.waiting).toBe(1);
    // Nothing is thrown at the browser: the picture was asked for by the map itself.
    expect(() => env.settle()).not.toThrow();
    expect([part(".map-broken").getAttribute("role"), text(".map-broken .map-empty-title"), text(".map-broken .map-empty-text")]).toEqual(["alert", "The map could not be drawn", SENTENCE("the canvas is gone")]);
    // Nothing of the map is left around the sentence, and the focus that was in the map is on it.
    expect([root().children.length, root().querySelector("canvas"), root().querySelector("button")]).toEqual([1, null, null]);
    expect(page.document.activeElement).toBe(part(".map-broken"));
    expect([env.waiting, env.stopped]).toEqual([0, 1]);
    // Whatever it is told or sent from now on, it draws nothing and asks for nothing.
    const [requested, drawn] = [env.requested, env.main.calls.length];
    map.themeChanged();
    env.resize(900, 700);
    key("f");
    key("Escape");
    part(".map-broken").press();
    expect([env.requested, env.main.calls.length, text(".map-empty-title")]).toEqual([requested, drawn, "The map could not be drawn"]);
    // The page still hides it, shows it and takes it away.
    map.hide();
    expect(root().hidden).toBe(true);
    map.show();
    expect([root().hidden, text(".map-empty-title"), env.requested]).toEqual([false, "The map could not be drawn", requested]);
    map.destroy();
    expect(host.children).toEqual([]);
  });

  it("stops in the same way when what the user does fails, and when a size it is told cannot be drawn at", () => {
    open();
    // A press that builds another view, whose names cannot be measured.
    env.main.measureText = failing("no text can be measured");
    expect(() => toggleGroups()).not.toThrow();
    expect(text(".map-broken .map-empty-text")).toBe(SENTENCE("no text can be measured"));
    expect(env.waiting).toBe(0);
    map.destroy();

    env = new FakeSurroundings();
    open();
    env.main.fillRect = failing("no room");
    expect(() => env.resize(1000, 700)).not.toThrow();
    expect(text(".map-broken .map-empty-text")).toBe(SENTENCE("no room"));
    map.destroy();

    // A press on the canvas, and what is thrown is no Error.
    env = new FakeSurroundings();
    open();
    const [x, y] = at("02: Calculations");
    env.main.roundRect = () => { throw "a string was thrown"; };
    env.reduced = false;
    page.id("outside").focus();
    click(x, y);
    expect(() => env.frame()).not.toThrow();
    expect(text(".map-broken .map-empty-text")).toBe(SENTENCE("a string was thrown"));
    // The focus was not in the map: it is not taken.
    expect(page.document.activeElement.id).toBe("outside");
  });

  it("tells the page once, with the reason, when a map that was drawn stops", () => {
    const heard: string[] = [];
    const mountHearing = (onFailure: (reason: string) => void = reason => { heard.push(reason); }): void => {
      env = new FakeSurroundings();
      map = mountModelMapIn(host as unknown as HTMLElement, sample().graph, { modelName: "Demand Plan", onFailure }, env);
      map.show();
      env.resize(1200, 800);
      env.settle();
    };
    mountHearing();
    expect(heard).toEqual([]);
    env.main.fillRect = (): never => { throw new RangeError("the canvas is gone"); };
    canvas().focus();
    key("f");
    env.settle();
    // The kind of error and its words, as the page's own lines about the map have them.
    expect(heard).toEqual(["RangeError: the canvas is gone"]);
    // Nothing that happens to the stopped map is told again.
    map.themeChanged();
    env.resize(900, 700);
    map.hide();
    map.show();
    expect(heard).toEqual(["RangeError: the canvas is gone"]);
    map.destroy();

    // What is thrown is no error: its text is the reason. And a value that cannot be made a text has a reason all the same.
    mountHearing();
    env.main.fillRect = (): never => { throw "a string was thrown"; };
    env.resize(1000, 700);
    expect(heard.slice(1)).toEqual(["a string was thrown"]);
    map.destroy();
    mountHearing();
    env.main.fillRect = (): never => { throw Object.create(null); };
    expect(() => env.resize(1000, 700)).not.toThrow();
    expect(heard.slice(2)).toEqual(["a failure that cannot be put into words"]);
    expect(text(".map-broken .map-empty-text")).toBe("Drawing it failed, and the map has stopped. The tables of this result are not affected.");
    map.destroy();
    mountHearing();
    env.main.fillRect = (): never => { throw Object.defineProperty(new Error("x"), "message", { get: (): string => { throw new Error("no words"); } }); };
    expect(() => env.resize(1000, 700)).not.toThrow();
    expect(heard.slice(3)).toEqual(["a failure that cannot be put into words"]);
    map.destroy();

    // A page whose own listener fails is the page's affair: the map has said its sentence and stopped.
    mountHearing(() => { throw new Error("the page's log is full"); });
    env.main.fillRect = (): never => { throw new Error("the canvas is gone"); };
    expect(() => env.resize(1000, 700)).not.toThrow();
    expect(text(".map-broken .map-empty-title")).toBe("The map could not be drawn");
    map.destroy();

    // A first picture that cannot be drawn is thrown to the page, which says so itself: nothing is told a second way.
    env = new FakeSurroundings();
    map = mountModelMapIn(host as unknown as HTMLElement, sample().graph, { modelName: "Demand Plan", onFailure: reason => { heard.push(`first: ${reason}`); } }, env);
    canvas().getBoundingClientRect = () => ({ left: 0, top: 0, right: 1200, bottom: 800, width: 1200, height: 800 });
    env.main.fillRect = (): never => { throw new Error("no picture can be drawn"); };
    expect(() => map.show()).toThrow("no picture can be drawn");
    expect(heard.filter(reason => reason.startsWith("first"))).toEqual([]);
  });

  it("writes the failure's words as text, whatever they are", () => {
    open();
    env.main.fillRect = failing(HOSTILE[0]);
    canvas().focus();
    key("f");
    env.settle();
    expect(text(".map-broken .map-empty-text")).toBe(SENTENCE(HOSTILE[0]));
    expect(parts("img, script, iframe, a")).toEqual([]);
  });
});

describe("The map's views", () => {
  it("opens on the model's sections, under the model's name, which starts the path", () => {
    open();
    // The model's name is the map's heading and the start of the path. The page's header names the workspace: the path
    // does not, and the name says it on hover.
    expect([part(".map-title-name").localName, text(".map-title-name"), part(".map-title-name").getAttribute("aria-current"), part(".map-title-name").getAttribute("title")]).toEqual(["h2", "Demand Plan", "location", "Demand Plan (workspace: Sandbox)"]);
    expect([parts(".map-crumbs button"), root().querySelector(".map-crumb-ws"), here(), part(".map-crumbs").textContent.includes("Sandbox")]).toEqual([[], null, "Demand Plan", false]);
    expect([status(), part(".map-status").hidden, act("whole").hidden]).toEqual(["3 sections · 2 links", false, true]);
    expect(text(".map-legend-title")).toBe("Sections");
    // Each section's entry counts the section's modules.
    expect(parts(".map-legend-item").map(item => [item.querySelector(".map-legend-name")?.textContent, item.querySelector(".map-legend-count")?.textContent])).toEqual([["01: Inputs", "2"], ["02: Calculations", "2"], ["Reporting", "1"]]);
    expect([...locate().keys()].sort()).toEqual(["01: Inputs", "02: Calculations", "Reporting"]);
    // The path's list says what is shown: the groups whole. The module picker and its group are the Line items view's.
    expect([tab("modules").getAttribute("aria-pressed"), tab("drill").getAttribute("aria-pressed"), part(".map-show-select").value]).toEqual(["true", "false", "groups"]);
    expect([part(".map-picker").hidden, part(".map-group-select").hidden, part(".map-external-check").hidden, part(".map-show-select").hidden, part(".map-tracebar").hidden, part(".map-inspector").hidden])
      .toEqual([true, true, true, false, true, true]);
    // A section's box says how much the section holds.
    expect(lastPicture().filter(call => call.name === "fillText").map(call => call.args[0])).toEqual(["2 modules · 3 line items", "01: Inputs", "2 modules · 5 line items", "02: Calculations", "1 module · 1 line item", "Reporting"]);
  });
  it("names the workspace in the notes about the map and on the model's name where the page names one, and never in the path", () => {
    mount(undefined, { modelName: "Demand Plan", workspaceName: undefined });
    map.show();
    expect(part(".map-title-name").getAttribute("title")).toBe("Demand Plan");
    expect(text(".map-notes .map-about-line")).toBe("Demand Plan: 5 modules · 9 line items");
    map.destroy();
    open();
    expect(text(".map-notes .map-about-line")).toBe("Demand Plan, in the workspace Sandbox: 5 modules · 9 line items");
    // In every view the path starts with the model's name, which says the workspace on hover alone.
    for (const go of [toggleGroups, () => tab("drill").press()]) {
      go();
      expect([part(".map-crumb").getAttribute("title"), part(".map-crumbs").textContent.includes("Sandbox")]).toEqual(["Demand Plan (workspace: Sandbox)", false]);
    }
  });
  it("opens a model whose modules stand under one heading on its modules: it has no sections to show", () => {
    const make = new GraphMaker();
    const units = make.item(make.module("INP01 - Volumes", "Ungrouped"), "Units");
    const gross = make.item(make.module("CAL01 - Revenue", "Ungrouped"), "Gross");
    make.link(units, gross);
    open(make.graph());
    expect([...locate().keys()].sort()).toEqual(["CAL01 - Revenue", "INP01 - Volumes"]);
    // The model whole: its name alone in the breadcrumb, and nothing that leads to sections.
    expect([here(), parts(".map-crumbs button").length, part(".map-show-select").hidden, part(".map-show-select").hidden]).toEqual(["Demand Plan", 0, true, true]);
    expect(status()).toBe("2 modules · 1 link");
    // A box says how much its module holds: the one heading would be the same on every box.
    expect(lastPicture().filter(call => call.name === "fillText").map(call => call.args[0])).toEqual(["INP01 · 1 line item", "Volumes", "CAL01 · 1 line item", "Revenue"]);
    // Into a module and back: the breadcrumb and Escape lead to the modules, and no further.
    doubleClick("CAL01 - Revenue");
    expect([here(), parts(".map-crumbs button").map(crumb => crumb.textContent)]).toEqual(["CAL01 - Revenue", ["Demand Plan"]]);
    canvas().focus();
    expect(key("Escape").defaultPrevented).toBe(true);
    expect([here(), locate().size, part(".map-show-select").hidden]).toEqual(["Demand Plan", 2, true]);
    expect(key("Escape").defaultPrevented).toBe(false);
    // The search finds modules and line items, and no section: there is none to go to.
    part(".map-search").type("ungrouped");
    expect([text(".map-search-count"), parts(".map-result").length]).toEqual(["0", 0]);
    part(".map-search").type("inp");
    expect(parts(".map-result").map(result => [result.querySelector("span")?.textContent, result.querySelector("small")?.textContent])).toEqual([["INP01 - Volumes", "Module"], ["Units", "INP01 - Volumes"]]);
    // Its legend names what is on the map, and no section: the modules are one entry.
    expect([text(".map-legend-title"), parts(".map-legend-item").map(item => item.textContent)]).toEqual(["On this map", ["Modules2"]]);
    key("Enter");
    expect([here(), text(".map-insp-name"), locate().size]).toEqual(["Demand Plan", "INP01 - Volumes", 2]);
    map.destroy();
    // A model of two sections still opens on them.
    open();
    expect([...locate().keys()]).toContain("01: Inputs");
  });

  it("opens and closes the legend and the notes about the map with their buttons, and says which is open", () => {
    open();
    // In the stand-in page nothing is measured, so the legend costs the picture nothing: it starts open.
    expect([part(".map-legend").hidden, act("legend").getAttribute("aria-expanded")]).toEqual([false, "true"]);
    act("legend").press();
    expect([part(".map-legend").hidden, act("legend").getAttribute("aria-expanded")]).toEqual([true, "false"]);
    // What the user chose holds from view to view.
    toggleGroups();
    expect(part(".map-legend").hidden).toBe(true);
    act("legend").press();
    tab("drill").press();
    expect([part(".map-legend").hidden, act("legend").getAttribute("aria-expanded"), text(".map-legend-title")]).toEqual([false, "true", "On this map"]);
    // The notes about the map are closed until asked for.
    expect([part(".map-about").hidden, act("about").getAttribute("aria-expanded")]).toEqual([true, "false"]);
    act("about").press();
    expect([part(".map-about").hidden, act("about").getAttribute("aria-expanded")]).toEqual([false, "true"]);
    expect(parts(".map-about h3").map(title => title.textContent)).toEqual(["This model", "What this map leaves out · 1", "How to read the map", "Mouse and keys"]);
    expect(parts(".map-notes li").map(line => line.textContent)).toEqual(["List members are not in the export."]);
    // The model has three heading rows among its modules: the notes say why the page's Modules table has more rows.
    expect(parts(".map-notes .map-about-line").map(line => line.textContent)).toEqual([
      "Demand Plan, in the workspace Sandbox: 5 modules · 9 line items",
      "3 heading rows stand among the modules. The map counts them as no module, and the page's Modules table counts each as a row: that table has more rows than the map has modules.",
    ]);
    // Escape from the notes closes them, and steps nowhere back.
    expect(key("Escape").defaultPrevented).toBe(true);
    expect([part(".map-about").hidden, act("about").getAttribute("aria-expanded"), here(), page.document.activeElement === act("about")]).toEqual([true, "false", "INP01 - Volumes", true]);
    expect(key("Escape").defaultPrevented).toBe(true);
    expect(here()).toBe("All modules");
    // From inside the notes too, where they take the focus to be scrolled.
    act("about").press();
    part(".map-about").focus();
    key("Escape");
    expect([part(".map-about").hidden, here()]).toEqual([true, "All modules"]);
  });

  it("shows one of the legend and the notes at a time on a narrow map, which has no room for both", () => {
    open(undefined, 700, 600);
    expect([part(".map-legend").hidden, part(".map-about").hidden]).toEqual([false, true]);
    act("about").press();
    expect([part(".map-legend").hidden, act("legend").getAttribute("aria-expanded"), part(".map-about").hidden, act("about").getAttribute("aria-expanded")]).toEqual([true, "false", false, "true"]);
    act("legend").press();
    expect([part(".map-legend").hidden, act("legend").getAttribute("aria-expanded"), part(".map-about").hidden, act("about").getAttribute("aria-expanded")]).toEqual([false, "true", true, "false"]);
    // Closing one opens nothing.
    act("legend").press();
    expect([part(".map-legend").hidden, part(".map-about").hidden]).toEqual([true, true]);
    map.destroy();
    // A wide map has both side by side.
    open();
    act("about").press();
    expect([part(".map-legend").hidden, part(".map-about").hidden]).toEqual([false, false]);
  });

  it("lists everything the map leaves out, a dozen sentences as well as one", () => {
    const make = new GraphMaker();
    const item = make.item(make.module("INP01 - Volumes", "01: Inputs"), "Units");
    const dozen = Array.from({ length: 12 }, (_, index) => `Line Items has no column number ${index + 1}: line items come without what it would say.`);
    make.limitations.push(...dozen);
    make.unresolved.push({ source: item, field: "Applies To", reference: "Old Regions" }, { source: item, field: "Referenced By", reference: "Retired.Total" });
    open(make.graph());
    act("about").press();
    expect(text(".map-notes .map-about-line")).toBe("Demand Plan, in the workspace Sandbox: 1 module · 1 line item");
    expect(parts(".map-notes h3").map(title => title.textContent)).toEqual(["This model", "What this map leaves out · 13"]);
    expect(parts(".map-notes ul")).toHaveLength(1);
    expect(parts(".map-notes li").map(line => line.textContent)).toEqual([...dozen, "2 names in the export matched no object, or more than one. A box's details list its own."]);
    map.destroy();
    // A graph that lacks nothing has no such heading. Its one heading row is said as one.
    const whole = new GraphMaker();
    whole.item(whole.module("INP01 - Volumes", "01: Inputs"), "Units");
    open(whole.graph());
    expect(parts(".map-notes h3").map(title => title.textContent)).toEqual(["This model"]);
    expect(parts(".map-notes .map-about-line")[1].textContent).toMatch(/^1 heading row stands among the modules\. /);
    map.destroy();
    // Modules that stand under no heading are filed under a name the graph gives them: that is no heading row.
    const bare = new GraphMaker();
    bare.item(bare.module("INP01 - Volumes", "Ungrouped"), "Units");
    open(bare.graph());
    expect(parts(".map-notes .map-about-line").map(line => line.textContent)).toEqual(["Demand Plan, in the workspace Sandbox: 1 module · 1 line item"]);
  });

  it("keeps the path in step with the map whichever way it moved: its list, the crumb, a double press, the search and Escape", () => {
    open();
    const show = (): string => part(".map-show-select").value;
    expect([show(), here()]).toEqual(["groups", "Demand Plan"]);
    doubleClick("02: Calculations");
    expect([show(), here(), parts(".map-crumbs button").map(crumb => crumb.textContent)]).toEqual(["1", "02: Calculations", ["Demand Plan"]]);
    act("crumb").press();
    expect([show(), here()]).toEqual(["groups", "Demand Plan"]);
    // A module the search finds is shown among its group's modules.
    part(".map-search").type("board");
    key("Enter");
    expect([show(), here(), text(".map-insp-name")]).toEqual(["2", "Reporting", "REP01 - Board"]);
    canvas().focus();
    key("Escape");
    key("Escape");
    expect([show(), here()]).toEqual(["groups", "Demand Plan"]);
    // A group the search finds is selected among the groups.
    part(".map-search").type("inputs");
    key("Enter");
    expect([show(), here(), text(".map-insp-name")]).toEqual(["groups", "Demand Plan", "01: Inputs"]);
    // A line item the search finds is shown in its module, which the path names after its group.
    part(".map-search").type("margin %");
    key("Enter");
    expect([here(), part(".map-group-select").value, part(".map-show-select").hidden, text(".map-insp-name")]).toEqual(["Margin Workings", "1", true, "Margin %"]);
  });
  it("goes from the sections to all modules and back with the path's list", () => {
    open();
    part(".map-show-select").choose("modules");
    expect([here(), part(".map-show-select").value, status()]).toEqual(["All modules", "modules", "5 modules · 5 links"]);
    expect([...locate().keys()].sort()).toEqual(["CAL01 - Revenue", "INP01 - Volumes", "INP02 - Prices", "Margin Workings", "REP01 - Board"]);
    expect(parts(".map-crumbs button").map(crumb => crumb.textContent)).toEqual(["Demand Plan"]);
    // Among all modules each box says its section in words: its colour alone would not.
    expect(lastPicture().filter(call => call.name === "fillText").map(call => call.args[0])).toEqual(expect.arrayContaining(["INP01 · 01: Inputs", "CAL01 · 02: Calculations", "02: Calculations", "REP01 · Reporting"]));
    expect(text(".map-live")).toBe("All modules: 5 modules, 5 links.");
    part(".map-show-select").choose("groups");
    expect([here(), part(".map-show-select").value, text(".map-live")]).toEqual(["Demand Plan", "groups", "Sections of Demand Plan: 3 sections, 2 links."]);
  });
  it("shows one section's modules from the path's list, with the modules of other sections beside them", () => {
    open();
    expect(parts(".map-show-select option").map(option => [option.getAttribute("value"), option.textContent]))
      .toEqual([["groups", "All groups"], ["modules", "All modules"], ["0", "01: Inputs · 2 modules"], ["1", "02: Calculations · 2 modules"], ["2", "Reporting · 1 module"]]);
    part(".map-show-select").choose("1");
    expect([here(), part(".map-show-select").value]).toEqual(["02: Calculations", "1"]);
    expect(parts(".map-legend-item").map(item => item.textContent)).toEqual(["Modules of other sections3", "02: Calculations2"]);
    expect(locate().size).toBe(5);
    // The section's own modules are counted apart from those that stand beside them, on screen and aloud.
    expect([status(), text(".map-live")]).toEqual(["2 modules · 3 modules of other sections · 5 links", "02: Calculations: 2 modules, with 3 modules of other sections, 5 links."]);
    part(".map-show-select").choose("modules");
    expect(here()).toBe("All modules");
    toggleGroups();
    expect(here()).toBe("Demand Plan");
  });
  it("goes into a section by a double press, by the details' button, and by Enter", () => {
    open();
    doubleClick("02: Calculations");
    expect(here()).toBe("02: Calculations");
    act("crumb").press();
    expect(here()).toBe("Demand Plan");
    clickNode("01: Inputs");
    expect(act("open").textContent).toBe("Open its 2 modules");
    act("open").press();
    expect(here()).toBe("01: Inputs");
    act("crumb").press();
    canvas().focus();
    key("ArrowRight");
    key("Enter");
    expect(here()).toMatch(/Inputs|Calculations|Reporting/);
    expect(parts(".map-crumbs button")).toHaveLength(1);
  });

  it("shows a module's line items from the Line items view, the module picker, a double press and the details", () => {
    open();
    tab("drill").press();
    // The first module of the model, until one is picked: the path names its group, then the module.
    expect([here(), part(".map-group-select").value, tab("drill").getAttribute("aria-pressed"), tab("modules").getAttribute("aria-pressed")]).toEqual(["INP01 - Volumes", "0", "true", "false"]);
    expect([part(".map-picker").hidden, part(".map-group-select").hidden, part(".map-external-check").hidden, part(".map-show-select").hidden]).toEqual([false, false, false, true]);
    expect(text(".map-legend-title")).toBe("On this map");
    // The picker lists the modules of the module's group until a name is typed, and then every module whose name holds it.
    openPicker();
    expect([part(".map-picker-input").getAttribute("aria-expanded"), picked(), part(".map-picker-note").hidden]).toEqual(["true", ["INP01 - Volumes", "INP02 - Prices"], true]);
    part(".map-picker-input").type("rev");
    expect(picked()).toEqual(["CAL01 - Revenue"]);
    key("Enter");
    expect([here(), part(".map-group-select").value, part(".map-picker-input").getAttribute("aria-expanded"), page.document.activeElement === canvas()]).toEqual(["CAL01 - Revenue", "1", "false", true]);
    expect([status(), text(".map-live")]).toEqual(["3 line items · 5 outside the module · 7 links", "Line items of CAL01 - Revenue: 3 line items, with 5 outside the module, 7 links."]);
    expect(parts(".map-legend-name").map(name => name.textContent)).toEqual(["No Data line items (headings)", "Line items", "Lists and subsets", "Other modules"]);
    // Back to the modules, and into a module by a double press: the Line items view remembers the module.
    tab("modules").press();
    toggleGroups();
    doubleClick("Margin Workings");
    expect(here()).toBe("Margin Workings");
    tab("modules").press();
    tab("drill").press();
    expect(here()).toBe("Margin Workings");
  });
  it("names the module's group in the path, which narrows the picker to that group's modules, or opens it to every group's", () => {
    open();
    tab("drill").press();
    pickModule("CAL01 - Revenue");
    expect(parts(".map-crumbs button").map(crumb => [crumb.textContent, crumb.dataset.mapCrumb])).toEqual([["Demand Plan", "root"]]);
    expect([part(".map-group-select").value, parts(".map-group-select option").map(option => option.textContent)]).toEqual(["1", ["All groups", "01: Inputs · 2 modules", "02: Calculations · 2 modules", "Reporting · 1 module"]]);
    // Another group: the picker opens on its modules, for one of them to be picked.
    part(".map-group-select").choose("0");
    expect([page.document.activeElement === part(".map-picker-input"), part(".map-picker-input").getAttribute("aria-expanded"), picked()]).toEqual([true, "true", ["INP01 - Volumes", "INP02 - Prices"]]);
    // What is typed is looked for among that group's modules alone.
    part(".map-picker-input").type("rev");
    expect([picked(), text(".map-picker-note")]).toEqual([[], "No module's name holds that."]);
    // Escape closes the list: the path names the module shown, and its group, again.
    key("Escape");
    expect([here(), part(".map-group-select").value, part(".map-picker-pop").hidden]).toEqual(["CAL01 - Revenue", "1", true]);
    // Every group: the picker lists every module, each with its group.
    part(".map-group-select").choose("");
    expect(parts(".map-picker-opt").map(option => [option.querySelector(".map-picker-name")?.textContent, option.querySelector("small")?.textContent])).toEqual([
      ["INP01 - Volumes", "01: Inputs"], ["INP02 - Prices", "01: Inputs"], ["CAL01 - Revenue", "02: Calculations"], ["Margin Workings", "02: Calculations"], ["REP01 - Board", "Reporting"]]);
    key("ArrowDown");
    key("Enter");
    expect([here(), part(".map-group-select").value]).toEqual(["Margin Workings", "1"]);
    // The model's name leads to the groups whole.
    parts(".map-crumbs button")[0].press();
    expect([here(), part(".map-show-select").value]).toEqual(["Demand Plan", "groups"]);
  });
  it("shows the line items of other modules one by one, and grouped again, by a box that says which it does", () => {
    open();
    tab("drill").press();
    pickModule("CAL01 - Revenue");
    // The box says what it shows in the legend's own words, and is ticked where they stand one by one.
    expect([part(".map-external").checked, text(".map-external-check"), parts(".map-legend-name").map(name => name.textContent)]).toEqual([false, "Other modules' line items", expect.arrayContaining(["Other modules"])]);
    expect([...locate().keys()]).toContain("INP01 - Volumes");
    part(".map-external").tick();
    expect([part(".map-external").checked, here()]).toEqual([true, "CAL01 - Revenue"]);
    const names = [...locate().keys()];
    expect(names).toEqual(expect.arrayContaining(["Units", "Price", "Cost", "Margin %", "Total", "Gross"]));
    expect(names).not.toContain("INP01 - Volumes");
    expect(parts(".map-legend-name").map(name => name.textContent)).toContain("Line items of other modules");
    part(".map-external").tick();
    expect([...locate().keys()]).toContain("INP01 - Volumes");
    expect(part(".map-external").checked).toBe(false);
  });
  it("draws the links of read and write access drivers when asked to, says so, and keeps what is selected", () => {
    open();
    tab("drill").press();
    pickModule("CAL01 - Revenue");
    clickNode("Net");
    expect(parts(".map-details summary").map(summary => summary.textContent)).toEqual(["Feeds it directly · 2", "It feeds directly · 1"]);
    tickAccess();
    expect(part(".map-access").checked).toBe(true);
    expect(text(".map-insp-name")).toBe("Net");
    expect(parts(".map-details summary").map(summary => summary.textContent)).toEqual(["Feeds it directly · 3", "It feeds directly · 1"]);
    expect(parts(".map-link small").map(small => small.textContent)).toContain("write access driver");
    expect(text(".map-live")).toBe("Access driver links are drawn. Line items of CAL01 - Revenue: 3 line items, with 5 outside the module, 8 links.");
    tickAccess();
    expect(parts(".map-details summary")[0].textContent).toBe("Feeds it directly · 2");
    expect(text(".map-live")).toBe("Access driver links are not drawn. Line items of CAL01 - Revenue: 3 line items, with 5 outside the module, 7 links.");
    // What access drivers are is said beside the box, and is its description to a screen reader.
    expect(text(`#${part(".map-access").getAttribute("aria-describedby")}`)).toBe(ACCESS_SAYS);
  });
  it("says a view that has nothing to draw", () => {
    const make = new GraphMaker();
    make.module("EMPTY - Nothing Yet", "01: Inputs");
    open(make.graph());
    expect(part(".map-empty").hidden).toBe(true);
    tab("drill").press();
    expect([part(".map-empty").hidden, text(".map-empty-title"), text(".map-empty-text")]).toEqual([false, "Nothing to show here", "This module has no line items."]);
    expect(root().querySelector(".map-empty ul")).toBeNull();
    // Nothing to zoom, and no small picture of nothing.
    expect([status(), part(".map-corner").hidden]).toEqual(["0 line items · 0 links", true]);
    tab("modules").press();
    expect([part(".map-empty").hidden, part(".map-empty").innerHTML, part(".map-corner").hidden]).toEqual([true, "", false]);
  });

  it("says in its own words that an export holds no modules to draw, and lists under it everything the map leaves out", () => {
    const bare = new GraphMaker();
    bare.list("Products");
    // Whatever the graph's sentences say and whichever comes first: none of them is taken for the reason.
    const sentences = ["A link between two objects is drawn only where the export names both.", "Modules was not exported.", "List members are not in the export."];
    bare.limitations.push(...sentences);
    open(bare.graph());
    expect([part(".map-empty").hidden, text(".map-empty-title"), text(".map-empty-text")]).toEqual([false, "No modules to draw", "This export holds no modules, so there is nothing to map."]);
    expect(text(".map-empty .map-about-title")).toBe("What this map leaves out · 3");
    expect(parts(".map-empty li").map(line => line.textContent)).toEqual(sentences);
    expect(tab("drill").disabled).toBe(true);
    expect([part(".map-legend").hidden, act("legend").hidden, part(".map-show-select").hidden, part(".map-show-select").hidden]).toEqual([true, true, true, true]);
    expect(status()).toBe("0 modules · 0 links");
    // Nothing on it can be selected, and the keys say so.
    tab("modules").press();
    key("f");
    canvas().focus();
    key("ArrowRight");
    expect(root().querySelector(".map-insp-name")).toBeNull();
    expect(text(".map-live")).toBe("No box on the map.");
    map.destroy();
    // An export that says nothing at all of what it lacks has nothing listed.
    open(new GraphMaker().graph());
    expect([text(".map-empty-text"), root().querySelector(".map-empty ul")]).toEqual(["This export holds no modules, so there is nothing to map.", null]);
  });
});

describe("Selecting a node on the map", () => {
  it("opens the details of a node that is pressed, and says what feeds it and what it feeds", () => {
    open();
    clickNode("02: Calculations");
    expect([part(".map-inspector").hidden, text(".map-kind"), text(".map-insp-name")]).toEqual([false, "SECTION", "02: Calculations"]);
    expect(parts(".map-dl dt").map(term => term.textContent)).toEqual(["Modules", "Line items"]);
    expect(parts(".map-dl dd").map(value => value.textContent)).toEqual(["2", "5"]);
    expect([part(".map-tracebar").hidden, text(".map-trace-name"), parts(".map-tracebar .map-trace-count").map(count => count.textContent)]).toEqual([false, "02: Calculations", ["1 box feeds it", "it feeds 1 box"]]);
    expect(text(".map-insp-trace")).toBe("On the map, directly or through others: 1 box feeds it, it feeds 1 box.");
    expect([act("focus").textContent, root().classList.contains("map-has-inspector"), part(".map-inspector").getAttribute("aria-label")]).toEqual(["Only these", true, "Details of the box selected"]);
    expect(text(".map-live")).toBe("Section 02: Calculations selected. On the map 1 box feeds it and it feeds 1 box, directly or through others.");
    // The bar of what is traced stands where the line of what is shown stood: that line has nothing more to say.
    expect(part(".map-status").hidden).toBe(true);
  });
  it("clears the selection by a press on the node selected, beside every node, with the details' button and with the bar's", () => {
    open();
    for (const clear of [() => clickNode("02: Calculations"), () => click(20, 780), () => act("close").press(), () => act("clear").press()]) {
      clickNode("02: Calculations");
      expect(part(".map-inspector").hidden).toBe(false);
      clear();
      expect([part(".map-inspector").hidden, part(".map-tracebar").hidden, part(".map-status").hidden, root().classList.contains("map-has-inspector")]).toEqual([true, true, false, false]);
      expect([part(".map-inspector").innerHTML, part(".map-tracebar").innerHTML]).toEqual(["", ""]);
    }
    expect(text(".map-live")).toBe("Selection cleared.");
  });
  it("shows a line item's details: its formula, its module, what feeds it and what it feeds, and where it comes from", () => {
    open();
    tab("drill").press();
    pickModule("CAL01 - Revenue");
    clickNode("Gross");
    expect([text(".map-kind"), text(".map-insp-name"), text(".map-formula")]).toEqual(["LINE ITEM", "Gross", "Units * Price"]);
    expect(parts(".map-dl dt").map(term => term.textContent)).toEqual(["Module", "Format", "Applies To"]);
    expect(parts(".map-dl dd")[0].textContent).toBe("CAL01 - Revenue");
    expect(parts(".map-details summary").map(summary => summary.textContent)).toEqual(["Feeds it directly · 3", "It feeds directly · 2"]);
    expect(parts(".map-link").map(link => link.querySelector(".map-link-text")?.childNodes[0].textContent)).toEqual(["Products", "Units", "Price", "Net", "Margin %"]);
    // The details name no file and no row of one.
    expect(part(".map-inspector").textContent).not.toMatch(/\.csv|\brow \d/);
    expect(parts(".map-tracebar .map-trace-count").map(count => count.textContent)).toEqual(["3 boxes feed it", "it feeds 3 boxes"]);
    // It is among its module's line items already: the details offer no way that leads nowhere.
    expect(root().querySelector('[data-map-act="open"]')).toBeNull();
    clickNode("Workings");
    expect(parts(".map-insp-note").map(note => note.textContent)).toEqual(["No formula. Its format is No Data: a heading among the line items."]);
  });
  it("goes to an object the details name, wherever it is: a module among its section's, a line item in its own module", () => {
    const { volumes } = sample();
    open();
    clickNode("01: Inputs");
    // A module of the section: the map goes to the section's modules and selects it.
    part(`[data-map-raw="${volumes}"]`).press();
    expect([here(), text(".map-insp-name"), text(".map-kind")]).toEqual(["01: Inputs", "INP01 - Volumes", "MODULE"]);
    // One of its line items: the map goes into the module and selects it.
    part(".map-details summary");
    const items = parts(".map-details").find(details => details.dataset.mapList === "items")!;
    items.querySelector("summary")!.press();
    items.querySelectorAll(".map-link")[0].press();
    expect([here(), text(".map-insp-name"), text(".map-kind")]).toEqual(["INP01 - Volumes", "Units", "LINE ITEM"]);
    // What uses it is in another module: the map goes there.
    parts(".map-link").find(link => link.textContent.startsWith("Gross"))!.press();
    expect([here(), text(".map-insp-name")]).toEqual(["CAL01 - Revenue", "Gross"]);
    // A list its formula names is on screen here: it is selected where it is.
    parts(".map-link").find(link => link.textContent.startsWith("Products"))!.press();
    expect([here(), text(".map-insp-name"), text(".map-kind")]).toEqual(["CAL01 - Revenue", "Products", "LIST"]);
  });

  it("selects a node on screen from the details of a module, and opens the module of a line item that stands beside another's", () => {
    const { revenue, units } = sample();
    open();
    toggleGroups();
    clickNode("CAL01 - Revenue");
    expect(parts(".map-details summary").map(summary => summary.textContent)).toEqual(["Feeds it directly · 3", "It feeds directly · 2", "All its line items · 3"]);
    part('[data-map-node]').press();
    expect([here(), text(".map-kind")]).toEqual(["All modules", "MODULE"]);
    expect(text(".map-insp-name")).not.toBe("CAL01 - Revenue");
    clickNode("CAL01 - Revenue");
    expect([act("open").textContent, act("open").dataset.mapModule]).toEqual(["Open its 3 line items", String(revenue)]);
    act("open").press();
    expect(here()).toBe("CAL01 - Revenue");
    // With the line items of other modules shown one by one, each leads to its own module.
    part(".map-external").tick();
    clickNode("Units");
    expect([act("open").textContent, act("open").dataset.mapSelect]).toEqual(["Open its module with it selected", String(units)]);
    act("open").press();
    expect([here(), text(".map-insp-name")]).toEqual(["INP01 - Volumes", "Units"]);
  });
  it("lists the rest of a long list when asked to, and goes on from the first of the rest", () => {
    const make = new GraphMaker();
    const module = make.module("BIG - Many Lines", "01: All");
    for (let index = 0; index < 130; index++) make.item(module, `Line ${index}`);
    open(make.graph());
    clickNode("BIG - Many Lines");
    const items = (): FakeElement => parts(".map-details").find(details => details.dataset.mapList === "items")!;
    items().querySelector("summary")!.press();
    expect([items().querySelectorAll(".map-link").length, items().querySelector(".map-more")?.textContent]).toEqual([100, "Show all 130"]);
    items().querySelector(".map-more")!.press();
    expect([items().querySelectorAll(".map-link").length, items().querySelector(".map-more")]).toEqual([130, null]);
    expect(page.document.activeElement).toBe(items().querySelectorAll(".map-link")[100]);
    expect(items().hasAttribute("open")).toBe(true);
  });
  it("keeps the view to the boxes of a trace, and shows all boxes again", () => {
    open();
    toggleGroups();
    clickNode("INP02 - Prices");
    expect(act("focus").textContent).toBe("Only these");
    act("focus").press();
    env.settle();
    expect(act("focus").textContent).toBe("All boxes");
    // Prices feeds Revenue, which feeds Margin Workings and the Board: Volumes has no part in that.
    expect([...locate().keys()].sort()).toEqual(["CAL01 - Revenue", "INP02 - Prices", "Margin Workings", "REP01 - Board"]);
    act("focus").press();
    env.settle();
    expect(act("focus").textContent).toBe("Only these");
    expect(locate().size).toBe(5);
    act("focus").press();
    act("fit").press();
    env.settle();
    expect([act("focus").textContent, locate().size]).toEqual(["Only these", 5]);
  });
  it("keeps to the trace of a line item that has nowhere to go into", () => {
    open();
    tab("drill").press();
    pickModule("CAL01 - Revenue");
    doubleClick("Net");
    env.settle();
    expect([here(), text(".map-insp-name"), act("focus").textContent]).toEqual(["CAL01 - Revenue", "Net", "All boxes"]);
    expect([...locate().keys()]).not.toContain("Workings");
  });

  it("goes to a line item of another module by a double press on it", () => {
    open();
    tab("drill").press();
    pickModule("CAL01 - Revenue");
    part(".map-external").tick();
    doubleClick("Units");
    expect([here(), text(".map-insp-name")]).toEqual(["INP01 - Volumes", "Units"]);
  });

  it("counts what is shown truly while a layer is hidden and while the view keeps to a trace", () => {
    open();
    toggleGroups();
    expect(status()).toBe("5 modules · 5 links");
    // The two modules of the first section are hidden: the graph still has five, and three of them are drawn.
    parts(".map-legend-item")[0].press();
    expect(status()).toBe("5 modules · 5 links. Showing 3 of 5 boxes.");
    parts(".map-legend-item")[0].press();
    expect(status()).toBe("5 modules · 5 links");
    clickNode("INP02 - Prices");
    expect(part(".map-status").hidden).toBe(true);
    // Kept to the trace, the line comes back to say how much of the graph that is, and it is said aloud.
    act("focus").press();
    expect([part(".map-status").hidden, status(), text(".map-live")]).toEqual([false, "Showing 4 of 5 boxes.", "Showing only what feeds it and what it feeds: 4 boxes."]);
    expect(locate().size).toBe(4);
    act("focus").press();
    expect([part(".map-status").hidden, text(".map-live"), locate().size]).toEqual([true, "Showing all boxes.", 5]);
  });

  it("moves the picture for a box pressed where the details open by no more than uncovers the box, at the size it had", () => {
    open();
    toggleGroups();
    // Fitted into the whole width, the last module stands where the details will open.
    const before = boxes();
    const board = before.get("REP01 - Board")!;
    expect(board.x + board.w).toBeGreaterThan(852);
    click(board.x + board.w / 2, board.y + board.h / 2);
    const after = boxes();
    expect([after.size, text(".map-insp-name")]).toEqual([5, "REP01 - Board"]);
    // The box has come clear of the details, which take the right 316 pixels and a margin, with a little room beside it.
    const moved = after.get("REP01 - Board")!;
    expect(moved.x + moved.w).toBeCloseTo(852 - 8 * (board.w / 232), 6);
    // Every box moved with it, sideways and by as much: the picture was moved at the size it had, and not fitted again.
    const shift = moved.x - board.x;
    for (const [name, box] of after) {
      const was = before.get(name)!;
      expect([box.x - was.x - shift, box.y - was.y, box.w - was.w].every(gap => Math.abs(gap) < 1e-6), name).toBe(true);
    }
    // Cleared, the picture stays where it is.
    act("clear").press();
    expect(boxes()).toEqual(after);
  });

  it("moves nothing when one box after another is pressed in view, nor when the selection is cleared", () => {
    open();
    const before = boxes();
    for (const name of ["01: Inputs", "02: Calculations", "01: Inputs"]) {
      const box = before.get(name)!;
      expect(box.x + box.w, name).toBeLessThan(852);
      click(box.x + box.w / 2, box.y + box.h / 2);
      expect([text(".map-insp-name"), boxes()]).toEqual([name, before]);
    }
    // Escape clears the selection: nothing moves either.
    canvas().focus();
    key("Escape");
    expect([part(".map-inspector").hidden, boxes()]).toEqual([true, before]);
  });

  it("brings a box pressed at the edge into view by itself, and moves nothing for it once it is in view or for a selection cleared", () => {
    open();
    // Zoomed in by the user: the last section stands at the right edge, where the details will open.
    act("zoom-in").press();
    env.settle();
    const before = boxes();
    const reporting = before.get("Reporting")!;
    expect(reporting.x + reporting.w).toBeGreaterThan(1100);
    click(reporting.x + 20, reporting.y + reporting.h / 2);
    env.settle();
    const after = boxes();
    // At the size it had, the camera moved just far enough to clear the details, with a little room around the box.
    const moved = after.get("Reporting")!;
    expect(moved.w).toBeCloseTo(reporting.w, 6);
    expect(moved.x + moved.w).toBeCloseTo(852 - 8 * (reporting.w / 232), 4);
    expect(moved.y).toBeCloseTo(reporting.y, 6);
    // The section that feeds it moved with the picture and no further: a press does not fetch what the box has links with.
    expect(after.get("02: Calculations")!.x - before.get("02: Calculations")!.x).toBeCloseTo(moved.x - reporting.x, 6);
    // The selection cleared by a press beside every node: nothing moves.
    click(20, 780);
    env.settle();
    expect(boxes()).toEqual(after);
    // The same box again, in view now: nothing moves.
    click(moved.x + 20, moved.y + moved.h / 2);
    env.settle();
    expect([text(".map-insp-name"), boxes()]).toEqual(["Reporting", after]);
  });

  it("brings a box gone to with the arrow keys into view beside the details, with the boxes it has links with, moving no further than it must", () => {
    open();
    act("zoom-in").press();
    env.settle();
    const reporting = boxes().get("Reporting")!;
    // The arrows go first to the section nearest the middle: the second, which has links with both others. The three do
    // not fit beside the details at this size, so the camera goes back until they do, and no further.
    canvas().focus();
    key("ArrowRight");
    env.settle();
    expect(text(".map-insp-name")).toBe("02: Calculations");
    const all = boxes();
    expect(all.size).toBe(3);
    for (const [name, box] of all) {
      expect(box.x, name).toBeGreaterThanOrEqual(32);
      expect(box.x + box.w, name).toBeLessThanOrEqual(852);
    }
    expect(all.get("Reporting")!.w).toBeLessThan(reporting.w);
    expect(all.get("Reporting")!.x + all.get("Reporting")!.w).toBeGreaterThan(820);
  });

  it("never takes the picture so far away for a selection that its boxes lose their names: it keeps its size, and says how much of it is in view", () => {
    open(manyModules(420));
    toggleGroups();
    env.settle();
    // Fitted whole, every one of the 420 boxes holds its name, though only just: the letters are as small as they get.
    const before = boxes();
    const size = [...before.values()][0].w;
    expect([before.size, blankBoxes(), status(), act("whole").hidden]).toEqual([420, 0, "420 modules · 0 links", true]);
    expect(size / 232).toBeGreaterThan(13 / 48.5);
    expect(size / 232 * (820 / 1136)).toBeLessThan(13 / 48.5);
    // A box at the right, where the details will open. The whole picture beside the details would be too small to read.
    const far = [...before].sort((a, b) => b[1].x - a[1].x || a[1].y - b[1].y)[0];
    click(far[1].x + far[1].w / 2, far[1].y + far[1].h / 2);
    env.settle();
    const after = boxes();
    const selected = after.get(far[0])!;
    // So it is not fitted again: the boxes are the size they were, and none of those on the canvas is blank.
    expect([text(".map-insp-name"), selected.w, blankBoxes()]).toEqual([far[0], size, 0]);
    // The box selected has come into the room beside the details, and the picture has moved no further than that.
    expect(selected.x + selected.w).toBeLessThanOrEqual(852);
    expect(selected.x + selected.w).toBeGreaterThan(852 - 12);
    expect(Math.abs(selected.y - far[1].y)).toBeLessThan(4);
    // The line at the foot says how much of the graph is in view now, and offers the whole of it in one press.
    const said = /^(\d+) of 420 boxes in view\.$/.exec(status());
    expect([part(".map-status").hidden, said !== null, act("whole").hidden]).toEqual([false, true, false]);
    expect(Number(said![1])).toBeGreaterThan(200);
    expect(Number(said![1])).toBeLessThan(420);
    // Another box selected from there: the same size still.
    const [otherName, other] = [...after].find(([name, box]) => name !== far[0] && box.x > 40 && box.x + box.w < 800 && box.y > 100 && box.y < 700)!;
    click(other.x + other.w / 2, other.y + other.h / 2);
    env.settle();
    expect([text(".map-insp-name"), boxes().get(otherName)!.w, blankBoxes()]).toEqual([otherName, size, 0]);
    // The details closed: nothing moves, and the line still offers the whole picture in one press.
    act("close").press();
    env.settle();
    expect([boxes().get(far[0]), act("whole").hidden, blankBoxes()]).toEqual([selected, false, 0]);
    expect(status()).toMatch(/^420 modules · 0 links\. \d+ of 420 boxes in view\.$/);
  });

  it("keeps a whole picture as it is when a box clear of the details is pressed, and when the selection is cleared", () => {
    open(manyModules(120));
    toggleGroups();
    env.settle();
    const before = boxes();
    // A box at the left, clear of where the details open: nothing moves, and nothing is fitted again.
    const [name, box] = [...before].find(([, each]) => each.x > 40 && each.x + each.w < 700 && each.y > 100)!;
    click(box.x + box.w / 2, box.y + box.h / 2);
    env.settle();
    expect([text(".map-insp-name"), boxes()]).toEqual([name, before]);
    act("clear").press();
    env.settle();
    expect(boxes()).toEqual(before);
  });

  it("takes a picture the user asked for whole no further away for a box pressed, and leaves it where the press took it", () => {
    open(manyModules(900));
    toggleGroups();
    env.settle();
    // Too many boxes to read when fitted: the picture opens on its start, and the user asks for the whole of it.
    expect(act("whole").hidden).toBe(false);
    act("whole").press();
    env.settle();
    const whole = boxes();
    const size = [...whole.values()][0].w;
    expect([whole.size, status(), size / 232 < 13 / 48.5]).toEqual([900, "900 modules · 0 links", true]);
    // A box at the right selected: the picture keeps the size the user gave it, and moves to have the box in view.
    const far = [...whole].sort((a, b) => b[1].x - a[1].x || a[1].y - b[1].y)[0];
    click(far[1].x + far[1].w / 2, far[1].y + far[1].h / 2);
    env.settle();
    const selected = boxes().get(far[0])!;
    expect(selected.w).toBe(size);
    expect(selected.x + selected.w).toBeLessThanOrEqual(852);
    // Cleared: it stays where the press took it, and the line offers the whole picture again in one press.
    act("clear").press();
    env.settle();
    expect([boxes().get(far[0]), act("whole").hidden]).toEqual([selected, false]);
    expect(status()).toMatch(/^900 modules · 0 links\. \d+ of 900 boxes in view\.$/);
  });

  it("does not go further away for the boxes a selection has links with than its names can be read from", () => {
    // A module of 400 line items, the first of which every other reads: fitted whole it could not be read, so it opens
    // on its start, in full.
    const make = new GraphMaker();
    const hub = make.module("HUB01 - Everything", "01: All");
    const first = make.item(hub, "Read By All");
    for (let index = 1; index < 400; index++) make.link(first, make.item(hub, `Reader ${index}`, { formula: "Read By All" }));
    open(make.graph());
    tab("drill").press();
    env.settle();
    const before = boxes().get("Read By All")!;
    expect([before.w / 216, status().includes("of 400 boxes in view")]).toEqual([0.83, true]);
    // It is selected. Everything it has links with is the whole graph, which does not fit beside the details at a size
    // its names can be read at: the camera stays as near as it was, and every box on the canvas keeps its name.
    click(before.x + before.w / 2, before.y + before.h / 2);
    env.settle();
    const after = boxes().get("Read By All")!;
    expect([after.w, blankBoxes(), text(".map-insp-name")]).toEqual([before.w, 0, "Read By All"]);
    expect(after.x + after.w).toBeLessThanOrEqual(852);
    expect(status()).toMatch(/^\d+ of 400 boxes in view\.$/);
    // Kept to what it feeds, which is every box there is: they are not all fitted in at once, blank. And shown all again.
    act("focus").press();
    env.settle();
    expect([act("focus").textContent, boxes().get("Read By All")!.w, blankBoxes()]).toEqual(["All boxes", before.w, 0]);
    act("focus").press();
    env.settle();
    expect([act("focus").textContent, boxes().get("Read By All")!.w, blankBoxes()]).toEqual(["Only these", before.w, 0]);
    // A reader has links with the first line item alone: the two fit, and the camera goes no further than it must.
    const reader = [...boxes()].find(([name, box]) => name.startsWith("Reader") && box.x > 300 && box.x + box.w < 800 && box.y > 120 && box.y < 600)!;
    click(reader[1].x + reader[1].w / 2, reader[1].y + reader[1].h / 2);
    env.settle();
    const both = boxes();
    expect([text(".map-insp-name"), both.has("Read By All"), blankBoxes()]).toEqual([reader[0], true, 0]);
    expect(both.get(reader[0])!.w / 216).toBeGreaterThanOrEqual(13 / 32 - 1e-9);
    for (const name of [reader[0], "Read By All"]) expect([both.get(name)!.x >= 32, both.get(name)!.x + both.get(name)!.w <= 852, both.get(name)!.y >= 82]).toEqual([true, true, true]);
  });

  it("stops the camera where a press finds it on its way, and moves it no further for the box pressed", () => {
    env.reduced = false;
    open(manyModules(120));
    toggleGroups();
    env.settle();
    // Nearer, and then the whole picture asked for: the camera sets out for it.
    act("zoom-in").press();
    act("zoom-in").press();
    act("fit").press();
    env.frame();
    env.frame();
    // A box pressed while the camera is on its way, in view and clear of the details: the camera stops where it is.
    const onItsWay = boxes();
    const [name, box] = [...onItsWay].find(([, each]) => each.x > 40 && each.x + each.w < 700 && each.y > 100 && each.y + each.h < 700)!;
    click(box.x + box.w / 2, box.y + box.h / 2);
    expect(text(".map-insp-name")).toBe(name);
    let frames = 0;
    while (env.waiting && frames++ < 60) env.frame();
    expect(boxes().get(name)).toEqual(box);
    // Cleared, it stays there too.
    act("clear").press();
    frames = 0;
    while (env.waiting && frames++ < 60) env.frame();
    expect(boxes().get(name)).toEqual(box);
  });

  it("moves a box pressed where the details open into view, and leaves the picture there when the selection is cleared", () => {
    const make = new GraphMaker();
    const big = make.module("BIG01 - Everything", "01: All");
    for (let index = 0; index < 600; index++) make.item(big, `Line Item ${index}`);
    open(make.graph());
    tab("drill").press();
    env.settle();
    const start = boxes();
    const first = start.get("Line Item 0")!;
    expect([first.x, first.y]).toEqual([32, 82]);
    // A line item at the right edge of what is in view: the details would open over it.
    const far = [...start].filter(([, box]) => box.x + box.w <= 1200 && box.y > 100 && box.y < 600).sort((a, b) => b[1].x - a[1].x)[0];
    expect(far[1].x + far[1].w).toBeGreaterThan(852);
    click(far[1].x + far[1].w / 2, far[1].y + far[1].h / 2);
    env.settle();
    const moved = boxes();
    expect([moved.get(far[0])!.w, moved.get(far[0])!.x + moved.get(far[0])!.w <= 852, blankBoxes()]).toEqual([far[1].w, true, 0]);
    expect(moved.get("Line Item 0")?.x).not.toBe(32);
    // Cleared: the picture stays where the press took it.
    act("close").press();
    env.settle();
    expect(boxes()).toEqual(moved);
    // A camera the user has moved since stays where they put it as well.
    const there = moved.get(far[0])!;
    click(there.x + there.w / 2, there.y + there.h / 2);
    env.settle();
    act("zoom-out").press();
    env.settle();
    const own = boxes().get(far[0])!;
    expect(own.w).toBeLessThan(far[1].w);
    act("close").press();
    env.settle();
    expect(boxes().get(far[0])).toEqual(own);
  });

  it("says in the line at the foot, as soon as a box is selected, what is in view once the camera has come to rest", () => {
    env.reduced = false;
    open(manyModules(420));
    toggleGroups();
    env.settle();
    const far = [...boxes()].sort((a, b) => b[1].x - a[1].x || a[1].y - b[1].y)[0];
    click(far[1].x + far[1].w / 2, far[1].y + far[1].h / 2);
    // The camera has not moved yet, and the dashes of the trace move for as long as the node is selected.
    const atOnce = [status(), part(".map-status").hidden, act("whole").hidden];
    expect(env.waiting).toBe(1);
    let frames = 0;
    while (env.waiting && frames++ < 400) env.frame();
    expect([status(), part(".map-status").hidden, act("whole").hidden]).toEqual(atOnce);
    expect(atOnce[0]).toMatch(/^\d+ of 420 boxes in view\.$/);
    // The selection cleared: nothing moves, and the line says at once how much is in view.
    act("clear").press();
    expect([/^420 modules · 0 links\. \d+ of 420 boxes in view\.$/.test(status()), act("whole").hidden]).toEqual([true, false]);
  });

  it("comes to a box found by the search and draws it in full, where the picture is too far away to tell it", () => {
    // One section, so that the search leads to a module among all the others. One module reads sixty that stand all over.
    const make = new GraphMaker();
    const items = Array.from({ length: 420 }, (_, index) => make.item(make.module(`M${index} - Module ${index}`, "0: All"), "Value"));
    for (let index = 0; index < 60; index++) make.link(items[index * 7], items[137]);
    open(make.graph());
    const fonts = (name: string): string[] => lastPicture().filter(call => call.name === "fillText" && String(call.args[0]).includes(name)).map(call => call.font);
    const found = (name: string): { x: number; y: number; w: number; h: number } => boxes().get(name)!;
    expect([...boxes().values()][0].w / 232).toBeLessThan(0.62);

    // A module with no links: it is shown by itself, at full size.
    part(".map-search").type("module 300");
    key("Enter");
    env.settle();
    expect([text(".map-insp-name"), found("M300 - Module 300").w, fonts("Module 300")]).toEqual(["M300 - Module 300", 232, ["600 12.5px sans-serif"]]);
    expect([found("M300 - Module 300").x >= 32, found("M300 - Module 300").x + 232 <= 852]).toEqual([true, true]);
    expect(status()).toMatch(/^\d+ of 420 boxes in view\.$/);
    // The module that reads sixty others: they do not all fit beside it with every name in full, so it is shown alone,
    // at the smallest size that draws a box in full.
    part(".map-search").type("module 137");
    key("Enter");
    env.settle();
    expect([text(".map-insp-name"), found("M137 - Module 137").w / 232, fonts("Module 137")]).toEqual(["M137 - Module 137", 0.76, ["600 9.5px sans-serif"]]);
    expect(blankBoxes()).toBe(0);
    // The details closed: the picture stays where the search took it, and one press shows it whole again.
    act("close").press();
    env.settle();
    expect([/^420 modules · 60 links\. \d+ of 420 boxes in view\.$/.test(status()), act("whole").hidden]).toEqual([true, false]);
    act("whole").press();
    env.settle();
    expect([status(), act("whole").hidden, boxes().size]).toEqual(["420 modules · 60 links", true, 420]);
  });
  it("hides a layer and shows it again from the legend, and says which is hidden in more than its colour", () => {
    open();
    toggleGroups();
    const item = (): FakeElement => parts(".map-legend-item")[0];
    expect([item().textContent, item().getAttribute("aria-pressed"), item().classList.contains("map-off")]).toEqual(["01: Inputs2", "true", false]);
    item().press();
    expect([item().getAttribute("aria-pressed"), item().classList.contains("map-off")]).toEqual(["false", true]);
    expect([...locate().keys()].sort()).toEqual(["CAL01 - Revenue", "Margin Workings", "REP01 - Board"]);
    // The button is the same one: the focus stays on it.
    expect(page.document.activeElement).toBe(item());
    item().press();
    expect([item().getAttribute("aria-pressed"), locate().size]).toEqual(["true", 5]);
    // A new view shows every layer again.
    item().press();
    tab("drill").press();
    tab("modules").press();
    expect(parts(".map-legend-item").map(each => each.getAttribute("aria-pressed"))).toEqual(["true", "true", "true"]);
  });

  it("moves a node that is dragged, and the whole picture when the canvas is", () => {
    open();
    const [x, y] = at("02: Calculations");
    const [otherX, otherY] = at("01: Inputs");
    pointer("pointerdown", x, y);
    pointer("pointermove", x + 2, y + 1);
    pointer("pointermove", x + 90, y + 140);
    expect(env.waiting).toBe(1);
    pointer("pointerup", x + 90, y + 140);
    env.settle();
    // A drag selects nothing, and the other nodes stay where they were.
    expect(part(".map-inspector").hidden).toBe(true);
    const moved = locate();
    expect(moved.get("02: Calculations")![0]).toBeCloseTo(x + 90, 6);
    expect(moved.get("02: Calculations")![1]).toBeCloseTo(y + 140, 6);
    expect(moved.get("01: Inputs")).toEqual([otherX, otherY]);
    pointer("pointerdown", 30, 700);
    pointer("pointermove", 80, 660);
    pointer("pointerup", 80, 660);
    env.settle();
    const panned = locate();
    expect(panned.get("01: Inputs")).toEqual([otherX + 50, otherY - 40]);
    expect(part(".map-inspector").hidden).toBe(true);
  });

  it("lays a node that is dragged over the others, and keeps it there", () => {
    open();
    const places = locate();
    const [x, y] = places.get("01: Inputs")!;
    const [onX, onY] = places.get("02: Calculations")!;
    // The first section is dragged onto the second, which is drawn after it.
    pointer("pointerdown", x, y);
    pointer("pointermove", onX + 10, onY + 6);
    pointer("pointerup", onX + 10, onY + 6);
    env.main.clear();
    env.settle();
    pointer("pointermove", onX + 4, onY + 2);
    expect(part(".map-tip-name").textContent).toBe("01: Inputs");
    // It is the last box of the picture.
    const boxes = env.main.calls.filter((call, index) => call.name === "roundRect" && env.main.calls[index + 1].name === "fill");
    expect([boxes.at(-1)!.args[0], boxes.at(-1)!.args[1]]).toEqual([onX + 10 - (boxes.at(-1)!.args[2] as number) / 2, onY + 6 - (boxes.at(-1)!.args[3] as number) / 2]);
    // A press there selects it, and another view starts in the graph's own order again.
    click(onX + 4, onY + 2);
    expect(text(".map-insp-name")).toBe("01: Inputs");
    toggleGroups();
    toggleGroups();
    expect([...locate().keys()]).toEqual(["01: Inputs", "02: Calculations", "Reporting"]);
  });

  it("zooms about the pointer with the wheel, and from the middle with the buttons", () => {
    open();
    const [x, y] = at("02: Calculations");
    const wheel = (deltaY: number): { defaultPrevented: boolean } => canvas().dispatch("wheel", { clientX: x, clientY: y, deltaY, deltaMode: 0 } as unknown as { key?: string });
    expect(wheel(-400).defaultPrevented).toBe(true);
    env.settle();
    const closer = locate();
    // The node under the pointer stays under it, and the others move away from it.
    expect(closer.get("02: Calculations")![0]).toBeCloseTo(x, 6);
    expect(closer.get("02: Calculations")![1]).toBeCloseTo(y, 6);
    const spread = (places: Map<string, [number, number]>): number => Math.abs((places.get("Reporting")?.[0] ?? 5000) - (places.get("01: Inputs")?.[0] ?? -5000));
    act("zoom-out").press();
    act("zoom-out").press();
    env.settle();
    const further = locate();
    expect(spread(further)).toBeLessThan(spread(closer));
    act("zoom-in").press();
    env.settle();
    expect(spread(locate())).toBeGreaterThan(spread(further));
  });

  it("takes a press that shakes a little for a click and no drag, more for a finger than for a mouse", () => {
    open();
    /** A press on a box, a move of so many pixels to the right while it is down, and the release there. */
    const press = (name: string, by: number, pointerType?: string): void => {
      const [x, y] = at(name);
      env.time += 1000;
      for (const [type, dx] of [["pointerdown", 0], ["pointermove", by], ["pointerup", by]] as const) {
        canvas().dispatch(type, { clientX: x + dx, clientY: y, button: 0, pointerId: 1, ...(pointerType ? { pointerType } : {}) } as unknown as { key?: string });
      }
    };
    const before = boxes();
    // A mouse that moves 5 pixels while it is pressed clicks: the box is selected, and neither it nor the picture moves.
    press("02: Calculations", 5);
    expect([text(".map-insp-name"), boxes()]).toEqual(["02: Calculations", before]);
    act("clear").press();
    // 6 pixels is a drag of the box: nothing is selected, and the box has moved with the pointer.
    press("02: Calculations", 6);
    expect(part(".map-inspector").hidden).toBe(true);
    expect(boxes().get("02: Calculations")!.x - before.get("02: Calculations")!.x).toBeCloseTo(6, 6);
    // A finger shakes more: 9 pixels is still a press, and 11 a drag.
    press("01: Inputs", 9, "touch");
    expect(text(".map-insp-name")).toBe("01: Inputs");
    act("clear").press();
    const inputs = boxes().get("01: Inputs")!;
    press("01: Inputs", 11, "touch");
    expect(part(".map-inspector").hidden).toBe(true);
    expect(boxes().get("01: Inputs")!.x - inputs.x).toBeCloseTo(11, 6);
  });

  it("moves to where the small picture is pressed", () => {
    open();
    const before = at("01: Inputs");
    pointer("pointerdown", 20, 64, part(".map-minimap"));
    env.settle();
    const after = locate().get("01: Inputs");
    expect(after === undefined || Math.abs(after[0] - before[0]) > 20).toBe(true);
  });
});

describe("The map's keys", () => {
  it("steps back with Escape: from a selection, from a module's line items, from a section, and no further than the sections", () => {
    open();
    clickNode("02: Calculations");
    act("open").press();
    clickNode("CAL01 - Revenue");
    act("open").press();
    clickNode("Gross");
    canvas().focus();
    const steps: string[] = [];
    for (let step = 0; step < 4; step++) {
      const event = key("Escape");
      steps.push(`${here()}|${part(".map-inspector").hidden ? "none" : text(".map-insp-name")}|${event.defaultPrevented}`);
    }
    expect(steps).toEqual(["CAL01 - Revenue|none|true", "02: Calculations|none|true", "Demand Plan|none|true", "Demand Plan|none|false"]);
    // From all modules, back is the sections.
    toggleGroups();
    canvas().focus();
    key("Escape");
    expect(here()).toBe("Demand Plan");
  });

  it("hears keys only while the focus is inside it", () => {
    open();
    toggleGroups();
    clickNode("CAL01 - Revenue");
    page.id("outside").focus();
    const requested = env.requested;
    for (const name of ["Escape", "f", "+", "-", "/", "ArrowRight", "Enter"]) expect(page.key(name).defaultPrevented, name).toBe(false);
    expect([here(), text(".map-insp-name"), env.requested, page.document.activeElement.id]).toEqual(["All modules", "CAL01 - Revenue", requested, "outside"]);
  });

  it("fits with F, zooms with plus and minus, and goes to the search with the slash, from anywhere in the map but a box", () => {
    open();
    act("links").focus();
    for (const name of ["f", "F", "+", "=", "-"]) {
      env.settle();
      const event = key(name);
      expect([name, event.defaultPrevented, env.waiting]).toEqual([name, true, 1]);
    }
    expect(key("/").defaultPrevented).toBe(true);
    expect(page.document.activeElement).toBe(part(".map-search"));
    // In the search box and in a list the same keys are typed, not taken.
    env.settle();
    for (const name of ["f", "+", "-", "/"]) expect([name, key(name).defaultPrevented, env.waiting]).toEqual([name, false, 0]);
    part(".map-show-select").focus();
    for (const name of ["f", "Escape", "ArrowDown"]) expect([name, key(name).defaultPrevented]).toEqual([name, false]);
    expect(here()).toBe("Demand Plan");
  });

  it("leaves a key with Ctrl, Alt or the command key to the browser", () => {
    open();
    canvas().focus();
    env.settle();
    for (const held of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }]) expect(key("f", held).defaultPrevented).toBe(false);
    expect(env.waiting).toBe(0);
  });

  it("moves from node to node with the arrow keys on the canvas, and goes in with Enter", () => {
    open();
    canvas().focus();
    key("ArrowRight");
    const first = text(".map-insp-name");
    expect(["01: Inputs", "02: Calculations", "Reporting"]).toContain(first);
    // The focus stays on the canvas, so that the next arrow is heard.
    expect(page.document.activeElement).toBe(canvas());
    const seen = new Set([first]);
    for (const name of ["ArrowLeft", "ArrowLeft", "ArrowRight", "ArrowRight", "ArrowRight"]) {
      expect(key(name).defaultPrevented).toBe(true);
      seen.add(text(".map-insp-name"));
    }
    expect([...seen].sort()).toEqual(["01: Inputs", "02: Calculations", "Reporting"]);
    expect(text(".map-insp-name")).toBe("Reporting");
    key("Enter");
    expect(here()).toBe("Reporting");
    // The arrows are the canvas's alone: on a button they are not taken.
    act("fit").focus();
    expect(key("ArrowRight").defaultPrevented).toBe(false);
  });

  it("says so when no box lies the way an arrow key points", () => {
    open();
    clickNode("Reporting");
    canvas().focus();
    // The sections stand in one row, and Reporting is the last of it.
    for (const [name, said] of [["ArrowRight", "No box to the right of Reporting."], ["ArrowUp", "No box above Reporting."], ["ArrowDown", "No box below Reporting."]]) {
      expect(key(name).defaultPrevented).toBe(true);
      expect([text(".map-live"), text(".map-insp-name")]).toEqual([said, "Reporting"]);
    }
    key("ArrowLeft");
    expect(text(".map-insp-name")).toBe("02: Calculations");
    key("ArrowLeft");
    key("ArrowLeft");
    expect([text(".map-live"), text(".map-insp-name")]).toEqual(["No box to the left of 01: Inputs.", "01: Inputs"]);
  });

  it("takes the pointer's hand and the tooltip away when the picture changes under the pointer", () => {
    open();
    const [x, y] = at("02: Calculations");
    const over = (): boolean[] => [canvas().classList.contains("map-over-node"), part(".map-tooltip").classList.contains("map-show")];
    pointer("pointermove", x, y);
    expect(over()).toEqual([true, true]);
    // The picture is fitted again: what was under the pointer may no longer be.
    canvas().focus();
    key("f");
    expect(over()).toEqual([false, false]);
    pointer("pointermove", x, y);
    expect(over()).toEqual([true, true]);
    // Another view altogether.
    toggleGroups();
    expect(over()).toEqual([false, false]);
  });

  it("keeps the focus in the map after a press on a part of it that takes none", () => {
    open();
    canvas().focus();
    // A panel's own surface is no control: in a browser a press on it would leave the focus with the page.
    part(".map-legend-title").press();
    expect(page.document.activeElement).toBe(canvas());
    part(".map-stats").press();
    expect(page.document.activeElement).toBe(canvas());
    key("f");
    expect(env.waiting).toBe(1);
    // A press on a control leaves the focus on the control.
    act("fit").press();
    expect(page.document.activeElement).toBe(act("fit"));
  });

  it("closes the search's results when the focus goes on to something else in the map", () => {
    open();
    part(".map-search").type("in");
    expect(part(".map-results").hidden).toBe(false);
    // The focus moves within the search: the results stay.
    part(".map-search").dispatch("focusout", { relatedTarget: parts(".map-result")[0] } as unknown as { key?: string });
    expect(part(".map-results").hidden).toBe(false);
    // It leaves the window altogether: they stay too, for when it comes back.
    part(".map-search").dispatch("focusout", { relatedTarget: null } as unknown as { key?: string });
    expect(part(".map-results").hidden).toBe(false);
    part(".map-search").dispatch("focusout", { relatedTarget: act("fit") } as unknown as { key?: string });
    expect(part(".map-results").hidden).toBe(true);
  });

  it("keeps the focus in the map when what had it goes", () => {
    const { volumes } = sample();
    open();
    clickNode("02: Calculations");
    act("close").focus();
    act("close").press();
    expect(page.document.activeElement).toBe(canvas());
    clickNode("02: Calculations");
    act("clear").focus();
    act("clear").press();
    expect(page.document.activeElement).toBe(canvas());
    // A link of the details leads to other details: the focus goes to their heading.
    clickNode("01: Inputs");
    part(`[data-map-raw="${volumes}"]`).focus();
    part(`[data-map-raw="${volumes}"]`).press();
    expect([text(".map-insp-name"), page.document.activeElement === part(".map-insp-name")]).toEqual(["INP01 - Volumes", true]);
    parts(".map-crumbs button")[0].focus();
    parts(".map-crumbs button")[0].press();
    expect(page.document.activeElement).toBe(canvas());
    // Escape on a control of the details that go with the selection.
    clickNode("01: Inputs");
    act("open").focus();
    key("Escape");
    expect(page.document.activeElement).toBe(canvas());
    // The button that keeps the view to the trace is written anew when it is pressed: the focus stays on it.
    clickNode("01: Inputs");
    act("focus").press();
    expect([act("focus").textContent, page.document.activeElement === act("focus")]).toEqual(["All boxes", true]);
  });
});

describe("The map's search", () => {
  it("lists what the text names anywhere in the model, counts it, and marks it on the canvas", () => {
    open();
    toggleGroups();
    env.settle();
    env.main.clear();
    part(".map-search").type("revenue");
    expect([part(".map-results").hidden, text(".map-search-count")]).toEqual([false, "4"]);
    expect(parts(".map-result").map(result => [result.querySelector("span")?.textContent, result.querySelector("small")?.textContent])).toEqual([
      ["CAL01 - Revenue", "Module · 02: Calculations · from heading rows"], ["Workings", "CAL01 - Revenue"], ["Gross", "CAL01 - Revenue"], ["Net", "CAL01 - Revenue"],
    ]);
    expect(text(".map-live")).toBe("4 matches.");
    env.settle();
    expect(env.main.named("stroke").filter(call => call.strokeStyle === FALLBACK.match)).toHaveLength(1);
    part(".map-search").type("zzz");
    expect([text(".map-results"), text(".map-search-count"), text(".map-live")]).toEqual(["No matching sections, modules or line items.", "0", "No matches."]);
    part(".map-search").type("");
    expect([part(".map-results").hidden, text(".map-search-count")]).toEqual([true, ""]);
  });

  it("marks the picture only while the results are open: a search that is left leaves the map as it was", () => {
    open();
    toggleGroups();
    const rings = (): number => lastPicture().filter(call => call.name === "stroke" && call.strokeStyle === FALLBACK.match).length;
    part(".map-search").type("revenue");
    env.settle();
    expect([rings(), boxStrengths().filter(strength => strength < 1).length]).toEqual([1, 4]);
    // Left with Escape: the text stays in the box, and nothing on the map is faded or ringed.
    key("Escape");
    env.settle();
    expect([part(".map-search").value, part(".map-results").hidden, rings(), boxStrengths()]).toEqual(["revenue", true, 0, [1, 1, 1, 1, 1]]);
    // Back in the box, the search is taken up where it was left.
    part(".map-search").focus();
    part(".map-search").dispatch("focusin");
    env.settle();
    expect([part(".map-results").hidden, rings()]).toEqual([false, 1]);
    // Left by a press on the map, and by the focus going on to another control.
    pointer("pointerdown", 40, 700);
    pointer("pointerup", 40, 700);
    env.settle();
    expect([rings(), boxStrengths()]).toEqual([0, [1, 1, 1, 1, 1]]);
    part(".map-search").dispatch("focusin");
    part(".map-search").dispatch("focusout", { relatedTarget: act("fit") } as unknown as { key?: string });
    env.settle();
    expect([part(".map-results").hidden, rings(), boxStrengths()]).toEqual([true, 0, [1, 1, 1, 1, 1]]);
  });

  it("marks the box that holds what is searched for, and fades nothing when no box on screen is meant", () => {
    open();
    const rings = (): number => lastPicture().filter(call => call.name === "stroke" && call.strokeStyle === FALLBACK.match).length;
    // Among the sections, a line item is in the section of its module: Gross is a line item of the Calculations.
    part(".map-search").type("gross");
    env.settle();
    expect([text(".map-search-count"), rings(), boxStrengths()]).toEqual(["1", 1, [0.18, 1, 0.18]]);
    // A module's name marks its section.
    part(".map-search").type("inp02");
    env.settle();
    expect([rings(), boxStrengths()]).toEqual([1, [1, 0.18, 0.18]]);
    // Nothing found: the picture is not faded as a whole.
    part(".map-search").type("zzz");
    env.settle();
    expect([text(".map-search-count"), rings(), boxStrengths()]).toEqual(["0", 0, [1, 1, 1]]);
    // Among one module's line items, a line item of another module marks nothing here.
    tab("drill").press();
    part(".map-search").type("price");
    env.settle();
    expect([here(), rings(), boxStrengths().every(strength => strength === 1)]).toEqual(["INP01 - Volumes", 0, true]);
  });

  it("goes to the first hit with Enter, and to any hit by a press on it, and puts the focus on its details", () => {
    open();
    part(".map-search").type("gross");
    key("Enter");
    expect([here(), text(".map-insp-name"), part(".map-results").hidden, part(".map-search").value]).toEqual(["CAL01 - Revenue", "Gross", true, ""]);
    expect(page.document.activeElement).toBe(part(".map-insp-name"));
    part(".map-search").type("inp0");
    parts(".map-result").find(result => result.textContent.startsWith("INP02 - Prices"))!.press();
    expect([here(), text(".map-insp-name"), text(".map-kind")]).toEqual(["01: Inputs", "INP02 - Prices", "MODULE"]);
    expect(page.document.activeElement).toBe(part(".map-insp-name"));
    // A section is found too, and shown among the model's sections.
    part(".map-search").type("report");
    key("Enter");
    expect([here(), text(".map-insp-name"), text(".map-kind")]).toEqual(["Demand Plan", "Reporting", "SECTION"]);
  });

  it("goes into the results with the down arrow, through them with the arrows, and back out with Escape", () => {
    open();
    part(".map-search").type("in");
    const results = parts(".map-result");
    expect(results.length).toBeGreaterThan(2);
    expect(key("ArrowDown").defaultPrevented).toBe(true);
    expect(page.document.activeElement).toBe(results[0]);
    key("ArrowDown");
    expect(page.document.activeElement).toBe(results[1]);
    key("ArrowUp");
    key("ArrowUp");
    expect(page.document.activeElement).toBe(part(".map-search"));
    key("ArrowDown");
    key("Escape");
    expect([part(".map-results").hidden, page.document.activeElement === part(".map-search")]).toEqual([true, true]);
    // Escape in the box itself leaves the text and goes to the map.
    part(".map-search").type("in");
    expect(key("Escape").defaultPrevented).toBe(true);
    expect([part(".map-results").hidden, part(".map-search").value, page.document.activeElement === canvas(), here()]).toEqual([true, "in", true, "Demand Plan"]);
  });

  it("closes the results at a press elsewhere in the map, and not at one in the search", () => {
    open();
    part(".map-search").type("in");
    pointer("pointerdown", 0, 0, part(".map-search"));
    expect(part(".map-results").hidden).toBe(false);
    pointer("pointerdown", 0, 0, parts(".map-result")[0]);
    expect(part(".map-results").hidden).toBe(false);
    pointer("pointerdown", 40, 700);
    pointer("pointerup", 40, 700);
    expect(part(".map-results").hidden).toBe(true);
  });
});

describe("The room the map's picture has", () => {
  const NOWHERE = { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
  type Place = [left: number, top: number, right: number, bottom: number];
  /** Gives parts of the map the boxes a browser would lay them out at: a part that is hidden, or in something hidden, has none. */
  function layOut(places: Record<string, Place | (() => Place)>): void {
    for (const [selector, place] of Object.entries(places)) {
      const element = part(selector);
      element.getBoundingClientRect = () => {
        for (let node: FakeElement | null = element; node && node !== host; node = node.parentElement) if (node.hidden) return NOWHERE;
        const [left, top, right, bottom] = typeof place === "function" ? place() : place;
        return { left, top, right, bottom, width: right - left, height: bottom - top };
      };
    }
  }
  const LEGEND: Place = [10, 520, 236, 750];
  const DOCK: Place = [10, 760, 330, 790];
  const CORNER: Place = [982, 622, 1190, 790];
  /** A map of 1200 by 800 laid out as its stylesheet lays it out: the bar across the top, the graph's room under it, the
   * details in a column at the right, the legend over the foot's line at the left, the small picture at the right. */
  function openLaidOut(graph?: ModelGraph, legend: Place = LEGEND): void {
    mount(graph);
    layOut({
      ".map-canvas": [0, 0, 1200, 800],
      ".map-free": () => (root().classList.contains("map-has-inspector") ? [10, 56, 864, 790] : [10, 56, 1190, 790]),
      ".map-legend": legend, ".map-dock": DOCK, ".map-corner": CORNER,
    });
    map.show();
    env.resize(1200, 800);
    env.settle();
  }
  const sectionsOf = (count: number): ModelGraph => {
    const make = new GraphMaker();
    for (let index = 0; index < count; index++) make.item(make.module(`M${index} - Module ${index}`, `${index + 1}: Section ${index + 1}`), "Value");
    return make.graph();
  };
  const overlaps = (box: { x: number; y: number; w: number; h: number }, [left, top, right, bottom]: Place): boolean => box.x < right && box.x + box.w > left && box.y < bottom && box.y + box.h > top;

  it("fits the picture into what is free of the canvas: under the bar, and clear of the legend, the line at the foot and the small picture", () => {
    openLaidOut();
    const drawn = boxes();
    expect(drawn.size).toBe(3);
    for (const [name, box] of drawn) {
      // Inside the graph's room, with a margin, and under none of what stands in it.
      expect([box.x >= 30, box.x + box.w <= 1170, box.y >= 76, box.y + box.h <= 770], name).toEqual([true, true, true, true]);
      for (const panel of [LEGEND, DOCK, CORNER]) expect(overlaps(box, panel), name).toBe(false);
    }
    // Three sections fit at full size in a row above the legend: the legend stays open.
    expect([part(".map-legend").hidden, act("legend").getAttribute("aria-expanded")]).toEqual([false, "true"]);
    expect([...drawn.values()].map(box => Math.round(box.w * 1000) / 1000)).toEqual([266.8, 266.8, 266.8]);
  });

  it("opens with the legend closed where the legend would cost the picture its names, and leaves it to the user from then on", () => {
    // A legend so large that, beside it, twelve sections fit only one under another, too small to be drawn in full.
    openLaidOut(sectionsOf(12), [10, 80, 900, 750]);
    expect([part(".map-legend").hidden, act("legend").getAttribute("aria-expanded")]).toEqual([true, "false"]);
    const widths = (): number[] => [...boxes().values()].map(box => box.w);
    const closed = widths();
    expect(closed).toHaveLength(12);
    expect(Math.min(...closed)).toBeGreaterThanOrEqual(232 * 0.76);
    // The user opens it: it stays open, here and in the next view, and the picture is fitted into the room that is left.
    act("legend").press();
    expect(part(".map-legend").hidden).toBe(false);
    expect(Math.max(...widths())).toBeLessThan(Math.min(...closed));
    for (const box of boxes().values()) expect(overlaps(box, [10, 80, 900, 750])).toBe(false);
    toggleGroups();
    expect([part(".map-legend").hidden, act("legend").getAttribute("aria-expanded")]).toEqual([false, "true"]);
    map.destroy();
    // Beside a legend of the usual size the same twelve are drawn in full: it is open from the start.
    openLaidOut(sectionsOf(12));
    expect(part(".map-legend").hidden).toBe(false);
    expect(Math.min(...widths())).toBeGreaterThanOrEqual(232 * 0.76);
  });

  it("closes the legend first where the details of a box gone to make the room small; a legend the user opened stays", () => {
    const high: Place = [10, 380, 236, 750];
    openLaidOut(sectionsOf(24), high);
    const size = (): number => [...boxes().values()][0].w;
    const names = (): number => lastPicture().filter(call => call.name === "fillText" && /^\d+: Section \d+$/.test(String(call.args[0]))).length;
    const opened = size();
    expect([part(".map-legend").hidden, act("legend").getAttribute("aria-expanded"), names()]).toEqual([false, "true", 24]);
    // A section gone to by the search: the details take a column, and beside both them and the legend the picture would
    // lose its small lines. The legend goes instead, and the picture is no smaller than it was.
    goTo("24: Section 24");
    env.settle();
    expect([part(".map-legend").hidden, act("legend").getAttribute("aria-expanded"), names(), size() >= opened]).toEqual([true, "false", 24, true]);
    // The selection cleared: nothing moves, and the legend stays as it is.
    const there = boxes();
    act("clear").press();
    env.settle();
    expect([part(".map-legend").hidden, boxes()]).toEqual([true, there]);
    // The user opens the legend: it is theirs now, and stays beside a box gone to. The picture is fitted beside both,
    // smaller, with every name still in its box.
    act("legend").press();
    goTo("24: Section 24");
    env.settle();
    expect([part(".map-legend").hidden, names(), size() < opened, size() / 232 >= 13 / 48.5]).toEqual([false, 24, true, true]);
    for (const box of boxes().values()) expect([overlaps(box, high), box.x + box.w <= 864]).toEqual([false, true]);
  });

  it("opens with the legend closed where the picture cannot be shown whole, and keeps every name when the notes are opened beside a selection", () => {
    // Too many sections to read when fitted into this room: the picture opens on its start, and the legend stays shut.
    openLaidOut(sectionsOf(400));
    expect([part(".map-legend").hidden, act("whole").hidden]).toEqual([true, false]);
    expect(status()).toMatch(/^400 sections · 0 links\. \d+ of 400 boxes in view\.$/);
    map.destroy();

    // A picture that is whole only just, and a small legend that would cost it a few hundredths of its size: next to
    // nothing, but the last of the room its names need. The legend stays shut, and the picture opens whole.
    env = new FakeSurroundings();
    openLaidOut(sectionsOf(354), [10, 700, 70, 750]);
    const fitted = [...boxes().values()][0].w / 232;
    expect([part(".map-legend").hidden, status(), act("whole").hidden, boxes().size, blankBoxes()]).toEqual([true, "354 sections · 0 links", true, 354, 0]);
    expect([fitted >= 13 / 48.5, fitted < 13 / 48.5 / 0.94]).toEqual([true, true]);
    map.destroy();

    // Twenty-four sections, one selected, and the notes about the map opened: a panel from the top of the graph's room
    // to its foot, which leaves a strip beside the details.
    let high: Place = [10, 380, 236, 750];
    let notes: Place = [246, 66, 606, 750];
    env = new FakeSurroundings();
    openLaidOut(sectionsOf(24), high);
    layOut({ ".map-about": () => notes, ".map-legend": () => high });
    const size = (): number => [...boxes().values()][0].w;
    const least = 232 * 13 / 48.5 - 1e-6;
    click(...at("12: Section 12"));
    env.settle();
    act("about").press();
    env.settle();
    // The whole picture is fitted into the strip: small, and no smaller than its names can be read at. Every box holds
    // its name, and none lies under the notes or the details.
    expect([part(".map-about").hidden, boxes().size, blankBoxes(), size() >= least]).toEqual([false, 24, 0, true]);
    for (const box of boxes().values()) expect([overlaps(box, notes), box.x + box.w <= 864]).toEqual([false, true]);
    // The notes wider and the legend higher, opened by the user: the two leave the whole picture no readable room. The
    // picture is not shrunk to fit: it keeps its size, the box selected is brought into what room there is, and the
    // line at the foot says how much of the graph is in view.
    notes = [246, 66, 860, 750];
    high = [10, 200, 236, 750];
    act("legend").press();
    act("legend").press();
    env.settle();
    expect([part(".map-legend").hidden, part(".map-about").hidden, blankBoxes(), size() >= least]).toEqual([false, false, 0, true]);
    const selected = boxes().get("12: Section 12")!;
    expect([overlaps(selected, notes), overlaps(selected, high), selected.x >= 10, selected.x + selected.w <= 864, selected.y >= 56]).toEqual([false, false, true, true, true]);
    expect([part(".map-status").hidden, act("whole").hidden]).toEqual([false, false]);
    expect(status()).toMatch(/^\d+ of 24 boxes in view\.$/);
    // Both closed and the selection cleared: the picture is whole again, in letters as large as it opened with.
    act("about").press();
    act("legend").press();
    act("clear").press();
    env.settle();
    expect([boxes().size, status(), act("whole").hidden, size() > 150]).toEqual([24, "24 sections · 0 links", true, true]);
  });
  it("measures the room beside a box gone to with the foot as it will be: without the line that a whole picture does not need", () => {
    mount(sectionsOf(170));
    layOut({
      ".map-canvas": [0, 0, 1200, 800],
      ".map-free": () => (root().classList.contains("map-has-inspector") ? [10, 56, 864, 790] : [10, 56, 1190, 790]),
      ".map-legend": [10, 700, 60, 750],
      // The foot has one row beside a whole picture, and is much higher where the line of what is shown stands over the
      // bar of what is traced.
      ".map-dock": () => (part(".map-tracebar").hidden || part(".map-status").hidden ? [10, 760, 864, 790] : [10, 300, 864, 790]),
      ".map-corner": CORNER,
    });
    map.show();
    env.resize(1200, 800);
    env.settle();
    const opened = [...boxes().values()][0].w;
    expect([boxes().size, status(), part(".map-status").hidden]).toEqual([170, "170 sections · 0 links", false]);
    // A section gone to with the arrow keys. With the line still at the foot there would be no room for the whole picture
    // at a size its names can be read at; without it there is, and the line is not needed: the picture is whole, and the
    // line gone.
    canvas().focus();
    key("ArrowRight");
    env.settle();
    const after = [...boxes().values()];
    expect([after.length, part(".map-status").hidden, part(".map-tracebar").hidden, blankBoxes()]).toEqual([170, true, false, 0]);
    expect([after[0].w < opened, after[0].w / 232 >= 13 / 48.5]).toEqual([true, true]);
    for (const box of after) expect([box.x + box.w <= 864, box.y + box.h <= 760]).toEqual([true, true]);
  });

  /** A map whose foot is narrow, as in a small window: the line of what is in view, with its button, takes the foot to
   * more rows, and it stands high. Beside a whole picture the foot has one row. */
  const HIGH_FOOT: Place = [10, 300, 864, 790];
  function openWithNarrowFoot(graph: ModelGraph): void {
    mount(graph);
    layOut({
      ".map-canvas": [0, 0, 1200, 800],
      ".map-free": () => (root().classList.contains("map-has-inspector") ? [10, 56, 864, 790] : [10, 56, 1190, 790]),
      ".map-legend": [10, 700, 70, 750],
      ".map-dock": () => (!part(".map-status").hidden && !act("whole").hidden && / in view\.$/.test(status()) ? HIGH_FOOT : [10, 760, 864, 790]),
      ".map-corner": CORNER,
    });
    map.show();
    env.resize(1200, 800);
    env.settle();
  }

  it("measures the room for a box pressed beside a picture that is no longer whole with the line at the foot, which will say so", () => {
    // The picture is whole only just: beside the details it cannot be, at a size its names can be read at.
    openWithNarrowFoot(sectionsOf(354));
    const opened = boxes();
    expect([status(), act("whole").hidden, opened.size]).toEqual(["354 sections · 0 links", true, 354]);
    // A box in the lower half, left of where the details will open: it is in view as it stands, but for the foot, which
    // is high once the line of what is in view stands in it with its button.
    const low = [...opened].filter(([, box]) => box.y > 450 && box.y < 700 && box.x > 100 && box.x + box.w < 800)[0];
    click(low[1].x + low[1].w / 2, low[1].y + low[1].h / 2);
    env.settle();
    const selected = boxes().get(low[0])!;
    expect([part(".map-status").hidden, act("whole").hidden, /^\d+ of 354 boxes in view\.$/.test(status()), selected.w]).toEqual([false, false, true, low[1].w]);
    // The box selected stands over that foot, not under it.
    expect([overlaps(selected, HIGH_FOOT), selected.y + selected.h <= 300]).toEqual([false, true]);
    // The selection cleared: nothing moves, and the line still says how much is in view.
    const there = boxes();
    act("clear").press();
    env.settle();
    expect([/^354 sections · 0 links\. \d+ of 354 boxes in view\.$/.test(status()), act("whole").hidden]).toEqual([true, false]);
    expect(boxes()).toEqual(there);
  });

  it("fits the whole picture, when asked for it, for the foot a whole picture has", () => {
    openWithNarrowFoot(sectionsOf(354));
    const opened = boxes();
    // Nearer, part of the graph is out of view: the line says so, and the foot stands high.
    act("zoom-in").press();
    act("zoom-in").press();
    env.settle();
    expect([/^354 sections · 0 links\. \d+ of 354 boxes in view\.$/.test(status()), act("whole").hidden]).toEqual([true, false]);
    // Whole again: into the room there is once the line has no more to say, not into the little that the high foot left.
    act("whole").press();
    env.settle();
    expect([status(), act("whole").hidden]).toEqual(["354 sections · 0 links", true]);
    expect(boxes()).toEqual(opened);
  });

  it("opens a view whole where it can be, measured with the foot a whole picture has and not the one the view before left", () => {
    openWithNarrowFoot(sectionsOf(354));
    act("zoom-in").press();
    act("zoom-in").press();
    env.settle();
    expect(act("whole").hidden).toBe(false);
    // All modules: as many boxes, as large. The foot was high when the view was asked for.
    toggleGroups();
    env.settle();
    expect([status(), act("whole").hidden, boxes().size, blankBoxes()]).toEqual(["354 modules · 0 links", true, 354, 0]);
  });

  it("brings a box that stays selected over the high foot when its view is built again", () => {
    // Too many sections to show whole: the picture opens on its start, and the line says how much of it is in view.
    openWithNarrowFoot(sectionsOf(400));
    expect(act("whole").hidden).toBe(false);
    const low = [...boxes()].filter(([, box]) => box.y > 450 && box.y < 700 && box.x > 100 && box.x + box.w < 800)[0];
    click(low[1].x + low[1].w / 2, low[1].y + low[1].h / 2);
    env.settle();
    expect(boxes().get(low[0])!.y + low[1].h).toBeLessThanOrEqual(300);
    // The same view with other links: it is laid out and placed again, on its start, where the box stands low.
    tickAccess();
    env.settle();
    const again = boxes().get(low[0])!;
    expect([text(".map-insp-name"), overlaps(again, HIGH_FOOT), again.y + again.h <= 300, again.w]).toEqual([low[0], false, true, low[1].w]);
    expect(status()).toMatch(/^\d+ of 400 boxes in view\.$/);
  });

  it("measures the room for a box the search comes to with the line at the foot, which will say how much is in view", () => {
    // The picture is whole beside the details too, but too far away to tell a box: the search comes close to the one
    // found, which has no links and is shown by itself at full size.
    openWithNarrowFoot(sectionsOf(170));
    expect([...boxes().values()][0].w / 232).toBeLessThan(0.62);
    part(".map-search").type("section 90");
    key("Enter");
    env.settle();
    const found = boxes().get("90: Section 90")!;
    expect([text(".map-insp-name"), found.w, part(".map-status").hidden, act("whole").hidden]).toEqual(["90: Section 90", 232, false, false]);
    expect(status()).toMatch(/^\d+ of 170 boxes in view\.$/);
    expect([overlaps(found, HIGH_FOOT), found.y + found.h <= 300, found.x + found.w <= 864]).toEqual([false, true, true]);
  });

  it("counts what is in view with the legend where the line's own button leaves it", () => {
    // A narrow foot again: with the line's button it takes another row, and the legend, which stands on it, stands higher.
    const lower: Place = [10, 620, 400, 750];
    const higher: Place = [10, 420, 400, 750];
    mount(sectionsOf(60));
    layOut({ ".map-canvas": [0, 0, 1200, 800], ".map-free": [10, 56, 1190, 790], ".map-legend": () => (act("whole").hidden ? lower : higher), ".map-dock": DOCK, ".map-corner": CORNER });
    map.show();
    env.resize(1200, 800);
    env.settle();
    // Sixty sections are shown whole with the legend open, as the map opens.
    expect([part(".map-legend").hidden, status(), act("whole").hidden]).toEqual([false, "60 sections · 0 links", true]);
    act("zoom-in").press();
    act("zoom-in").press();
    env.settle();
    // In view by the picture itself: the boxes whose middle is in the graph's room, under neither the legend nor the
    // small picture. With the legend where it stood before the line had its button, more of them would be.
    const inView = (legend: Place): number => [...boxes().values()].filter(box => {
      const [x, y] = [box.x + box.w / 2, box.y + box.h / 2];
      return x >= 10 && x <= 1190 && y >= 56 && y <= 790 && ![legend, CORNER].some(([left, top, right, bottom]) => x >= left && x <= right && y >= top && y <= bottom);
    }).length;
    expect(inView(higher)).toBeLessThan(inView(lower));
    expect([act("whole").hidden, status()]).toEqual([false, `60 sections · 0 links. ${inView(higher)} of 60 boxes in view.`]);
  });

  it("lets the panel that opens close the other where the two would leave the picture no room at all", () => {
    openLaidOut(sectionsOf(6));
    // The notes laid out so that, with the legend, nothing of the graph's room is left.
    layOut({ ".map-about": [240, 60, 1186, 750], ".map-legend": [10, 60, 236, 750] });
    act("about").press();
    expect([part(".map-about").hidden, part(".map-legend").hidden, act("legend").getAttribute("aria-expanded")]).toEqual([false, true, "false"]);
    act("legend").press();
    expect([part(".map-about").hidden, part(".map-legend").hidden, act("about").getAttribute("aria-expanded")]).toEqual([true, false, "false"]);
  });

  it("keeps the focus in the map when the legend closes under it as the map's place shrinks", () => {
    let legendBox: Place = LEGEND;
    mount(sectionsOf(24));
    layOut({ ".map-canvas": [0, 0, 1200, 800], ".map-free": [10, 56, 1190, 790], ".map-legend": () => legendBox, ".map-dock": DOCK, ".map-corner": CORNER });
    map.show();
    env.resize(1200, 800);
    env.settle();
    const item = parts(".map-legend-item")[3];
    item.focus();
    expect([part(".map-legend").hidden, page.document.activeElement === item]).toEqual([false, true]);
    // The same size told again changes nothing, and leaves the focus where it is.
    env.resize(1200, 800);
    expect(page.document.activeElement).toBe(item);
    // A smaller place, in which the legend would cost the picture its names: it closes, and its button has the focus.
    legendBox = [10, 100, 900, 750];
    env.resize(1190, 790);
    expect([part(".map-legend").hidden, page.document.activeElement === act("legend")]).toEqual([true, true]);
    // A place with room for it again: it opens by itself, and the focus stays on the button.
    legendBox = LEGEND;
    env.resize(1200, 800);
    expect([part(".map-legend").hidden, page.document.activeElement === act("legend")]).toEqual([false, true]);
  });

  it("lays the picture out again for a new room while it is still as it was fitted, so that it grows with its place", () => {
    const make = new GraphMaker();
    const items = Array.from({ length: 12 }, (_, index) => make.item(make.module(`M${index} - Module ${index}`, "01: All"), "Value"));
    for (let index = 0; index < 11; index++) make.link(items[index], items[index + 1]);
    open(make.graph(), 700, 500);
    const columns = (): number => new Set([...boxes().values()].map(box => Math.round(box.x))).size;
    // A small place: the chain of twelve is packed into two columns of six, smaller than full size.
    expect(columns()).toBe(2);
    const small = boxes().get("M0 - Module 0")!.w;
    expect(small).toBeLessThan(232);
    env.resize(2200, 900);
    // A large one: six columns of two, the most that still fit at the largest size a fit gives.
    expect([columns(), Math.round(boxes().get("M0 - Module 0")!.w * 10) / 10]).toEqual([6, 266.8]);
    env.resize(700, 500);
    expect([columns(), boxes().get("M0 - Module 0")!.w]).toEqual([2, small]);
    // Once the user has moved the picture, it keeps its places and its size, and only its middle follows the room.
    pointer("pointerdown", 30, 450);
    pointer("pointermove", 60, 430);
    pointer("pointerup", 60, 430);
    env.settle();
    const moved = boxes().get("M0 - Module 0")!;
    env.resize(2200, 900);
    const kept = boxes().get("M0 - Module 0")!;
    expect([columns(), kept.w, kept.x, kept.y]).toEqual([2, moved.w, moved.x + 750, moved.y + 200]);
  });

  it("keeps the places of a picture in which a box was dragged, and fits it again", () => {
    open(undefined, 1200, 800);
    const [x, y] = at("02: Calculations");
    pointer("pointerdown", x, y);
    pointer("pointermove", x + 40, y + 200);
    pointer("pointerup", x + 40, y + 200);
    env.settle();
    env.resize(1400, 900);
    const after = boxes();
    // The box is still under the row it was dragged out of: the graph was not laid out anew.
    expect(after.get("02: Calculations")!.y).toBeGreaterThan(after.get("01: Inputs")!.y + 100);
    expect(after.size).toBe(3);
  });

  it("opens a graph too large to be read when fitted on its start, at a size that shows every name, and says how much of it that is", () => {
    const make = new GraphMaker();
    const big = make.module("BIG01 - Everything", "01: All");
    for (let index = 0; index < 600; index++) make.item(big, `Line Item ${index}`);
    open(make.graph());
    tab("drill").press();
    env.settle();
    const said = /^600 line items · 0 links\. (\d+) of 600 boxes in view\.$/.exec(status());
    expect(said, status()).not.toBeNull();
    const inView = Number(said![1]);
    expect(inView).toBeGreaterThan(40);
    expect(inView).toBeLessThan(200);
    // Every box drawn has its name in full, in letters of nine and a half pixels.
    const written = lastPicture().filter(call => call.name === "fillText");
    expect(written.length).toBeGreaterThanOrEqual(inView);
    expect(new Set(written.map(call => call.font))).toEqual(new Set([`500 ${11.5 * 0.83}px sans-serif`]));
    expect(written.every(call => /^Line Item \d+$/.test(String(call.args[0])))).toBe(true);
    // The graph's first line item stands at the start of the picture's room, under the bar.
    const first = boxes().get("Line Item 0")!;
    expect([first.x, first.y]).toEqual([32, 82]);
    // One press shows the whole picture, and the line says no more than what it holds.
    expect([act("whole").hidden, act("whole").textContent]).toEqual([false, "Whole map"]);
    act("whole").press();
    env.settle();
    expect([status(), act("whole").hidden]).toEqual(["600 line items · 0 links", true]);
    // And the line follows the camera: zoomed in again, part of the graph is out of view.
    act("zoom-in").press();
    act("zoom-in").press();
    env.settle();
    expect(status()).toMatch(/^600 line items · 0 links\. \d+ of 600 boxes in view\.$/);
    expect(act("whole").hidden).toBe(false);
  });

  it("shows a graph whole that can be read when fitted, however many boxes it has", () => {
    const make = new GraphMaker();
    for (let index = 0; index < 120; index++) make.item(make.module(`M${index} - Module ${index}`, `${index % 4}: Section ${index % 4}`), "Value");
    open(make.graph());
    toggleGroups();
    env.settle();
    expect([status(), act("whole").hidden]).toEqual(["120 modules · 0 links", true]);
    // Every one of the 120 boxes has at least a line of its name, in letters of ten pixels or nearly.
    const written = lastPicture().filter(call => call.name === "fillText");
    expect(written.length).toBeGreaterThanOrEqual(120);
    for (const call of written) expect(parseFloat(/([\d.]+)px/.exec(call.font)![1])).toBeGreaterThanOrEqual(9);
  });
});

describe("What moves on the map", () => {
  it("moves nothing for a user who asked for less motion: the camera is where it goes at once, and a trace's dashes stand still", () => {
    env.reduced = true;
    open();
    toggleGroups();
    clickNode("CAL01 - Revenue");
    expect(env.settle()).toBeLessThanOrEqual(1);
    act("fit").press();
    expect(env.settle()).toBe(1);
    env.time += 5000;
    expect(env.waiting).toBe(0);
    // The dashes are drawn all the same, long towards the node and short on from it: they say which way a link runs.
    // Each starts where its line starts, in every picture.
    const traced = linksDrawn().filter(call => call.dash.length === 2);
    expect(new Set(traced.map(call => call.dash.join()))).toEqual(new Set(["7,5", "2,4"]));
    expect(new Set(traced.map(call => call.dashOffset))).toEqual(new Set([0]));
  });
  it("moves a trace's dashes for as long as a node is selected, and asks for no picture once none is", () => {
    env.reduced = false;
    open();
    expect(env.waiting).toBe(0);
    clickNode("02: Calculations");
    const offsets = (): number[] => linksDrawn().filter(call => call.dash.length === 2).map(call => call.dashOffset);
    env.frame();
    const first = offsets();
    env.frame();
    expect(offsets()).not.toEqual(first);
    // A minute of frames on, the next picture is still asked for, and it has the dashes further along.
    for (let frames = 0; frames < 3600; frames++) env.frame();
    const later = offsets();
    expect([later.length, env.waiting]).toEqual([2, 1]);
    env.frame();
    expect(offsets()).not.toEqual(later);
    // With the selection cleared there is no trace: once the camera is back, no other picture is asked for.
    act("clear").press();
    expect(env.settle()).toBeLessThan(100);
    expect(env.waiting).toBe(0);
    // Another node selected, and they move again.
    clickNode("01: Inputs");
    env.frame();
    const again = offsets();
    env.frame();
    expect(offsets()).not.toEqual(again);
    expect(env.waiting).toBe(1);
    // Cleared or hidden, nothing more is drawn.
    act("clear").press();
    expect(env.settle()).toBeLessThan(40);
    clickNode("02: Calculations");
    env.frame();
    expect(env.waiting).toBe(1);
    map.hide();
    expect(env.waiting).toBe(0);
    env.time += 5000;
    expect(env.frame()).toBe(0);
  });
  it("takes the camera to a fit over a few frames, and then asks for no more", () => {
    env.reduced = false;
    open();
    const before = at("Reporting");
    env.main.clear();
    canvas().dispatch("wheel", { clientX: 600, clientY: 400, deltaY: -600, deltaMode: 0 } as unknown as { key?: string });
    env.settle();
    expect(locate().get("Reporting")).not.toEqual(before);
    act("fit").press();
    const frames = env.settle();
    expect(frames).toBeGreaterThan(3);
    expect(frames).toBeLessThan(80);
    expect(locate().get("Reporting")).toEqual(before);
    expect(env.waiting).toBe(0);
  });

  it("stops the camera where it is when the canvas is pressed", () => {
    env.reduced = false;
    open();
    canvas().dispatch("wheel", { clientX: 600, clientY: 400, deltaY: -600, deltaMode: 0 } as unknown as { key?: string });
    env.settle();
    act("fit").press();
    env.frame();
    env.frame();
    pointer("pointerdown", 20, 780);
    pointer("pointerup", 20, 780);
    expect(env.settle()).toBeLessThanOrEqual(1);
  });
});

describe("A model's texts on the map", () => {
  it("shows every name, note and formula as text, and makes no element out of any", () => {
    const make = new GraphMaker();
    const [img, quoted, script, breakOut, single, entity, closers] = HOSTILE;
    const list = make.list(closers);
    const first = make.module(img, quoted, { notes: script });
    const second = make.module(`${breakOut} - ${single}`, entity);
    const item = make.item(first, script, { formula: closers, notes: breakOut });
    const other = make.item(second, single, { formula: img });
    make.link(item, other).link(list, item, "list_formula");
    make.limitations.push(img);
    make.unresolved.push({ source: item, field: quoted, reference: script });
    mount(make.graph(), { modelName: closers, workspaceName: breakOut });
    map.show();
    env.resize(1200, 800);
    env.settle();
    const made = new Set(["div", "canvas", "h2", "h3", "h4", "details", "summary", "nav", "button", "select", "option", "label", "input", "span", "svg", "circle", "path", "kbd", "aside", "b", "br", "p", "ul", "li", "dl", "dt", "dd", "pre", "small"]);
    const check = (): void => {
      for (const element of parts("div, span, button, p, li, pre, small, option, summary, dd, dt, h2, h3, h4, nav, aside, details, ul, dl, label, input, select, canvas, svg, kbd, b, br, circle, path, img, script, iframe, a")) {
        expect(made, element.localName).toContain(element.localName);
        for (const name of element.attributes.keys()) expect(name, element.outerHTML.slice(0, 120)).not.toMatch(/^on|^style$|^href$|^src$|^autofocus$|^x$/);
      }
      expect(parts("img, script, iframe, a")).toEqual([]);
      for (const control of parts("[data-map-act]")) expect(["button"]).toContain(control.localName);
    };
    check();
    expect([text(".map-title-name"), part(".map-title-name").title, here(), root().querySelector(".map-crumb-ws")]).toEqual([closers.trim(), `${closers} (workspace: ${breakOut})`, closers.trim(), null]);
    expect(part(".map-canvas").getAttribute("aria-label")).toContain(`Map of ${closers}: `);
    expect([text(".map-notes .map-about-line"), parts(".map-notes li")[0].textContent]).toEqual([`${closers}, in the workspace ${breakOut}: 2 modules · 2 line items`.replace(/\s+/g, " ").trim(), img]);
    expect(parts(".map-show-select option").map(option => option.textContent)).toEqual(["All groups", "All modules", `${quoted} · 1 module`, `${entity} · 1 module`]);
    expect(parts(".map-legend-name").map(name => name.textContent)).toEqual([quoted, entity]);
    clickNode(quoted);
    check();
    expect(text(".map-insp-name")).toBe(quoted);
    act("open").press();
    clickNode(img);
    check();
    expect([text(".map-insp-name"), parts(".map-insp-note").map(note => note.textContent)]).toEqual([img, [script]]);
    act("open").press();
    clickNode(script);
    check();
    expect([text(".map-insp-name"), part(".map-formula").textContent, parts(".map-insp-note").map(note => note.textContent)]).toEqual([script, closers, [breakOut]]);
    expect(parts(".map-inspector .map-lines li").map(line => line.textContent)).toEqual([`${quoted}: ${script}`]);
    expect(parts(".map-notes li").map(line => line.textContent)).toEqual([img, "1 name in the export matched no object, or more than one. A box's details list its own."]);
    expect(parts(".map-link").map(link => link.querySelector(".map-link-text")?.childNodes[0].textContent)).toEqual([closers, single]);
    part(".map-search").type("alert");
    check();
    expect(parts(".map-result span").map(name => name.textContent)).toEqual(expect.arrayContaining([img, script, single]));
    // The picker names the module shown, and lists every module, each by its name as typed.
    expect(part(".map-picker-input").value).toBe(img);
    part(".map-group-select").choose("");
    expect(picked()).toEqual([img, `${breakOut} - ${single}`]);
    check();
    key("Escape");
    // The tooltip's name is the name as typed.
    pointer("pointermove", ...at(script));
    expect(part(".map-tip-name").textContent).toBe(script);
    check();
  });
});

describe("Going to an object the page names", () => {
  it("goes to a line item in its module's view and to a module among its section's, selected, with the details in focus", () => {
    const { graph, gross, margin } = sample();
    mount(graph);
    // A map that is not shown goes nowhere.
    expect(map.reveal(gross)).toBe(false);
    map.show();
    env.resize(1200, 800);
    env.settle();
    expect(map.reveal(gross)).toBe(true);
    expect(text(".map-insp-name")).toBe("Gross");
    expect(page.document.activeElement).toBe(part(".map-insp-name"));
    expect(map.reveal(margin)).toBe(true);
    expect(text(".map-insp-name")).toBe("Margin Workings");
    // A node the graph does not have is not gone to.
    expect(map.reveal(graph.nodes.length)).toBe(false);
    expect(text(".map-insp-name")).toBe("Margin Workings");
    map.destroy();
    expect(map.reveal(gross)).toBe(false);
  });

  it("goes to a list beside the line items of the first module it is linked with, and keeps the path in step with each place it goes to", () => {
    const { graph, gross, margin, products } = sample();
    open(graph);
    // From the groups whole: the list stands among the line items of CAL01 - Revenue, whose Gross it formats.
    expect(map.reveal(products)).toBe(true);
    expect([text(".map-insp-name"), here(), part(".map-group-select").value, tab("drill").getAttribute("aria-pressed"), page.document.activeElement === part(".map-insp-name")])
      .toEqual(["Products", "CAL01 - Revenue", "1", "true", true]);
    // A module: the path's list names its group.
    expect(map.reveal(margin)).toBe(true);
    expect([here(), part(".map-show-select").value, part(".map-picker").hidden]).toEqual(["02: Calculations", "1", true]);
    // A line item: the path names its module, after its group.
    expect(map.reveal(gross)).toBe(true);
    expect([here(), part(".map-group-select").value]).toEqual(["CAL01 - Revenue", "1"]);
    // A list on screen already is selected where it stands.
    expect(map.reveal(products)).toBe(true);
    expect([text(".map-insp-name"), here()]).toEqual(["Products", "CAL01 - Revenue"]);
    map.destroy();
    // A list linked with no line item is on no map.
    const make = new GraphMaker();
    const lonely = make.list("Regions");
    make.item(make.module("INP01 - Volumes", "01: Inputs"), "Units");
    open(make.graph());
    expect([map.reveal(lonely), here()]).toEqual([false, "Demand Plan"]);
  });
});

describe("The bar's tools and the module picker", () => {
  /** Lets the promises of the browser's full screen settle. */
  const settled = (): Promise<void> => new Promise(resolve => { setTimeout(resolve, 0); });

  it("opens the panel of links from its button, by a press or the keyboard, and closes it by the button, Escape and a press elsewhere", () => {
    open();
    const button = act("links");
    expect([button.getAttribute("aria-expanded"), part(".map-links-pop").hidden]).toEqual(["false", true]);
    // Enter on the button is a press: the panel opens, with the focus on its box.
    button.focus();
    button.press();
    expect([button.getAttribute("aria-expanded"), part(".map-links-pop").hidden, page.document.activeElement === part(".map-access")]).toEqual(["true", false, true]);
    // Escape from inside it closes it, and the focus goes back to its button: the map steps nowhere back.
    expect(key("Escape").defaultPrevented).toBe(true);
    expect([button.getAttribute("aria-expanded"), part(".map-links-pop").hidden, page.document.activeElement === button, here()]).toEqual(["false", true, true, "Demand Plan"]);
    button.press();
    button.press();
    expect(part(".map-links-pop").hidden).toBe(true);
    // A press elsewhere in the map closes it.
    button.press();
    pointer("pointerdown", 600, 700);
    pointer("pointerup", 600, 700);
    expect([part(".map-links-pop").hidden, button.getAttribute("aria-expanded")]).toEqual([true, "false"]);
    // Where more than formulas are drawn, the button says so with a dot, with the panel closed.
    expect(button.classList.contains("map-on")).toBe(false);
    tickAccess();
    expect([button.classList.contains("map-on"), part(".map-access").checked]).toEqual([true, true]);
  });

  it("goes through the module picker with the arrows, names for a screen reader the module they are on, and lists a long list's first modules until a name narrows it", () => {
    open(manyModules(250));
    tab("drill").press();
    openPicker();
    // The module's own group: every fourth module of the model.
    expect([picked().length, picked()[0], part(".map-picker-note").hidden]).toEqual([63, "M0 - Module 0", true]);
    // Every group: more than the list shows at once.
    part(".map-group-select").choose("");
    expect([picked().length, text(".map-picker-note")]).toEqual([PICKER_CAP, `First ${PICKER_CAP} of 250 modules. Type to narrow.`]);
    const input = part(".map-picker-input");
    expect(input.getAttribute("aria-activedescendant")).toBe(part(".map-picker-opt.map-active").id);
    key("ArrowDown");
    key("ArrowDown");
    const active = part(".map-picker-opt.map-active");
    expect([text(".map-picker-opt.map-active .map-picker-name"), active.getAttribute("aria-selected"), input.getAttribute("aria-activedescendant")]).toEqual(["M2 - Module 2", "true", active.id]);
    expect(parts('.map-picker-opt[aria-selected="true"]')).toHaveLength(1);
    // Typing narrows the list, whatever the group the arrows were in.
    input.type("module 24");
    expect([picked(), part(".map-picker-note").hidden]).toEqual([["M24 - Module 24", ...Array.from({ length: 10 }, (_, index) => `M24${index} - Module 24${index}`)], true]);
    // Escape closes the list and names the module shown again; a second Escape goes back to the map.
    key("Escape");
    expect([input.getAttribute("aria-expanded"), input.value, part(".map-picker-pop").hidden]).toEqual(["false", "M0 - Module 0", true]);
    key("Escape");
    expect(page.document.activeElement).toBe(canvas());
    // The arrows open a closed list, and Enter picks the module they are on.
    input.focus();
    key("ArrowDown");
    expect(input.getAttribute("aria-expanded")).toBe("true");
    key("ArrowDown");
    key("Enter");
    expect(here()).toBe("M4 - Module 4");
    // A press on a module of the list picks it, and keeps the focus where it was while it is pressed.
    openPicker();
    const option = parts(".map-picker-opt")[2];
    expect(option.dispatch("pointerdown").defaultPrevented).toBe(true);
    option.press();
    expect(here()).toBe("M8 - Module 8");
  });

  it("fills the screen from its button, and leaves it by the button or by the browser's own Escape, saying each time which the button does", async () => {
    open();
    const button = act("fullscreen");
    expect([button.getAttribute("aria-pressed"), button.getAttribute("aria-label"), button.title]).toEqual(["false", FULL_SAYS.enter, FULL_SAYS.enter]);
    button.press();
    await settled();
    expect([env.asked, env.holder === (root() as unknown as Element), button.getAttribute("aria-pressed"), button.getAttribute("aria-label"), button.title, text(".map-live")])
      .toEqual([1, true, "true", FULL_SAYS.leave, FULL_SAYS.leave, "The map fills the screen. Escape leaves it."]);
    // The map is told its new size, and draws for it at once.
    env.main.clear();
    env.resize(1920, 1080);
    expect(env.main.named("fillRect")[0]?.args).toEqual([0, 0, 1920, 1080]);
    // The search is still a slash away.
    canvas().focus();
    key("/");
    expect(page.document.activeElement).toBe(part(".map-search"));
    // The button gives the screen back.
    button.press();
    await settled();
    expect([env.left, env.holder, button.getAttribute("aria-pressed"), button.getAttribute("aria-label"), text(".map-live")]).toEqual([1, null, "false", FULL_SAYS.enter, "The map is back in its place."]);
    // So does the browser's own Escape, which the map hears of: the button follows.
    button.press();
    await settled();
    expect(button.getAttribute("aria-pressed")).toBe("true");
    env.holder = null;
    root().dispatch("fullscreenchange");
    expect([button.getAttribute("aria-pressed"), button.getAttribute("aria-label")]).toEqual(["false", FULL_SAYS.enter]);
    // A map that is hidden gives the screen back.
    button.press();
    await settled();
    map.hide();
    expect([env.holder, env.left]).toEqual([null, 2]);
  });

  it("fills the window instead where the browser will not give it the screen, and leaves it by the button, Escape and hiding", async () => {
    env.refuses = true;
    open();
    const button = act("fullscreen");
    button.press();
    await settled();
    expect([env.asked, root().classList.contains("map-full-window"), button.getAttribute("aria-pressed"), button.getAttribute("aria-label"), text(".map-live")])
      .toEqual([1, true, "true", FULL_SAYS.leave, "The map fills the window. Escape leaves it."]);
    // Escape leaves the window before it steps back on the map, as the browser's Escape does.
    clickNode("01: Inputs");
    canvas().focus();
    expect(key("Escape").defaultPrevented).toBe(true);
    expect([root().classList.contains("map-full-window"), button.getAttribute("aria-pressed"), button.getAttribute("aria-label"), text(".map-insp-name")]).toEqual([false, "false", FULL_SAYS.enter, "01: Inputs"]);
    // The button leaves it too.
    button.press();
    await settled();
    button.press();
    expect([root().classList.contains("map-full-window"), button.getAttribute("aria-pressed")]).toEqual([false, "false"]);
    // And a map that is hidden fills nothing.
    button.press();
    await settled();
    map.hide();
    expect([root().classList.contains("map-full-window"), button.getAttribute("aria-pressed")]).toEqual([false, "false"]);
  });
});

describe("How the map groups modules", () => {
  /** Ten modules whose names start with codes three of them share, under no heading: the codes group them well. Each
   * up to REP03 Trend reads the one before it, and an import loads the first. */
  function coded() {
    const make = new GraphMaker();
    const names = ["INP01 Volumes", "INP02 Prices", "INP03 Rates", "CAL01 Revenue", "CAL02 Costs", "CAL03 Margin", "REP01 Board", "REP02 Summary", "REP03 Trend", "Scratch"];
    const modules = names.map(name => make.module(name));
    const items = modules.map((module, index) => make.item(module, "Value", index >= 3 && index < 9 ? { formula: "x" } : {}));
    // REP03 Trend is the last that reads one: no module reads it.
    items.slice(1, 9).forEach((item, index) => make.link(items[index], item));
    make.link(make.action("Load Volumes", { actionType: "Import" }), modules[0], "import_target");
    return make.graph();
  }
  const choices = (): [string | null, string][] => parts(".map-grouping-select option").map(option => [option.getAttribute("value"), option.textContent]);
  const sectionNames = (): string[] => parts(".map-legend-name").map(name => name.textContent);
  const heard: (string | undefined)[] = [];
  const openGrouped = (graph: ModelGraph, grouping?: string): void => {
    heard.length = 0;
    map = mountModelMapIn(host as unknown as HTMLElement, graph, { modelName: "Demand Plan", ...(grouping === undefined ? {} : { grouping }), onGrouping: kind => { heard.push(kind); } }, env);
    map.show();
    env.resize(1200, 800);
    env.settle();
  };

  it("opens on the grouping it picks itself, which the switch says, and names each module's section with where it comes from", () => {
    openGrouped(coded());
    expect(choices()).toEqual([["prefix", "Name prefix · automatic"], ["role", "Role in the data flow"]]);
    expect([part(".map-grouping-field").hidden, text(".map-grouping-field .map-field-label"), part(".map-grouping-select").value]).toEqual([false, "Group by", "prefix"]);
    expect(sectionNames()).toEqual(["INP", "CAL", "REP", "Other"]);
    expect(parts(".map-show-select option").map(option => option.textContent)).toEqual(["All groups", "All modules", "INP · 3 modules", "CAL · 3 modules", "REP · 3 modules", "Other · 1 module"]);
    // A module's details and the search say its section and where that comes from.
    toggleGroups();
    env.settle();
    clickNode("CAL02 Costs");
    expect(parts(".map-dl dt").map(term => term.textContent).slice(0, 2)).toEqual(["Section", "Line items"]);
    expect(parts(".map-dl dd")[0].textContent).toBe("CAL · from module names");
    part(".map-search").type("costs");
    expect(parts(".map-result").map(result => result.querySelector("small")?.textContent)[0]).toBe("Module · CAL · from module names");
    expect(heard).toEqual([]);
  });

  it("groups the modules anew from the switch, shows the model whole, says so, and tells the page the choice: the map's own pick as none", () => {
    openGrouped(coded());
    clickNode("CAL");
    part(".map-grouping-select").choose("role");
    env.settle();
    // The whole model, in the new sections, with nothing selected.
    expect([sectionNames(), part(".map-inspector").hidden, part(".map-grouping-select").value]).toEqual([["Data", "Input", "Calculation", "Output"], true, "role"]);
    expect(text(".map-live")).toMatch(/^Modules grouped by role in the data flow\. Sections of Demand Plan: 4 sections/);
    // The details say why a module is where the map put it.
    clickNode("Calculation");
    act("open").press();
    env.settle();
    clickNode("REP01 Board");
    expect(parts(".map-dl dt").map(term => term.textContent).slice(0, 2)).toEqual(["Section", "Why"]);
    expect(parts(".map-dl dd").map(value => value.textContent).slice(0, 2)).toEqual(["Calculation · from the data flow", "Calculation: 1 of its 1 line item has a formula, and another module reads it."]);
    part(".map-grouping-select").choose("prefix");
    env.settle();
    expect([sectionNames(), heard]).toEqual([["INP", "CAL", "REP", "Other"], ["role", undefined]]);
    // The grouping on screen chosen again: nothing changes, and nothing is told.
    part(".map-grouping-select").choose("prefix");
    expect(heard).toEqual(["role", undefined]);
  });

  it("opens on the grouping the viewer chose last where the model has it, and on its own pick where it has not", () => {
    openGrouped(coded(), "role");
    expect([part(".map-grouping-select").value, sectionNames()]).toEqual(["role", ["Data", "Input", "Calculation", "Output"]]);
    map.destroy();
    openGrouped(coded(), "functionalArea");
    expect([part(".map-grouping-select").value, sectionNames()]).toEqual(["prefix", ["INP", "CAL", "REP", "Other"]]);
  });

  it("keeps the switch to the modules, and hides it where a model can be grouped only one way", () => {
    openGrouped(coded());
    tab("drill").press();
    env.settle();
    expect([part(".map-grouping-field").hidden, part(".map-zone-build").hidden]).toEqual([true, false]);
    map.destroy();
    // Names that share no code, no heading, no list: only the role in the data flow, which makes one section here.
    const make = new GraphMaker();
    for (const name of ["Volumes", "Prices", "Rates"]) make.item(make.module(name), "Value");
    openGrouped(make.graph());
    // How the map is built has nothing to choose in the Modules view then: that part of the bar goes.
    expect([choices(), part(".map-grouping-field").hidden, part(".map-zone-build").hidden, part(".map-show-select").hidden, sectionNames()]).toEqual([[["role", "Role in the data flow · automatic"]], true, true, true, ["Modules"]]);
  });

  it("goes on when the page cannot keep the choice", () => {
    map = mountModelMapIn(host as unknown as HTMLElement, coded(), { modelName: "Demand Plan", onGrouping: () => { throw new Error("no storage"); } }, env);
    map.show();
    env.resize(1200, 800);
    env.settle();
    part(".map-grouping-select").choose("role");
    env.settle();
    expect([sectionNames(), parts(".map-broken").length]).toEqual([["Data", "Input", "Calculation", "Output"], 0]);
  });
});
