import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeElement, FakePage } from "../results/dom.test-support.js";
import type { ModelGraph, ModelMap } from "./graph-types.js";
import type { Pen } from "./map-canvas.js";
import { FALLBACK } from "./map-palette.js";
import { mountModelMap, mountModelMapIn, type MapEnvironment } from "./map-view.js";
import { FakePen, GraphMaker, HOSTILE } from "./map.test-support.js";

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

function mount(graph: ModelGraph = sample().graph, options = { modelName: "Demand Plan", workspaceName: "Sandbox" as string | undefined }): void {
  map = mountModelMapIn(host as unknown as HTMLElement, graph, options, env);
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
const tab = (view: string): FakeElement => part(`[data-map-view="${view}"]`);
const pointer = (type: string, x: number, y: number, target: FakeElement = canvas()): void => { target.dispatch(type, { clientX: x, clientY: y, button: 0, pointerId: 1 } as unknown as { key?: string }); };
const key = (name: string, extra: Record<string, unknown> = {}) => page.document.activeElement.dispatch("keydown", { key: name, ...extra });

/** Where each node is on the canvas: the middle of each box of the last picture, and the name the tooltip says when the
 * pointer is there. So a place comes from what was drawn, and a name from what the map itself says is under the pointer. */
function locate(): Map<string, [number, number]> {
  // A trace that moves never stops asking for frames: one frame is then enough for a picture.
  if (env.reduced) env.settle(); else env.frame();
  const calls = env.main.calls;
  let from = calls.length - 1;
  while (from > 0 && !(calls[from].name === "fillRect" && calls[from].args[0] === 0 && calls[from].args[1] === 0 && calls[from - 1]?.name !== "roundRect")) from--;
  const found = new Map<string, [number, number]>();
  const tip = part(".map-tooltip");
  for (let index = from; index < calls.length - 1; index++) {
    // A node's box is filled; the rings around a node are only drawn as lines.
    if (calls[index].name !== "roundRect" || calls[index + 1].name !== "fill") continue;
    const [x, y, width, height] = calls[index].args as number[];
    const middle: [number, number] = [x + width / 2, y + height / 2];
    pointer("pointermove", ...middle);
    if (tip.classList.contains("map-show")) found.set(tip.querySelector(".map-tip-name")?.textContent ?? "", middle);
  }
  canvas().dispatch("pointerleave");
  return found;
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
    expect(text(".map-here")).toBe("02: Calculations");
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

describe("The map's views", () => {
  it("opens on the model's sections, under the model's name", () => {
    open();
    expect([text(".map-title-name"), text(".map-title-sub")]).toEqual(["Demand Plan", "Workspace: Sandbox"]);
    expect(parts(".map-stats div").map(line => line.textContent)).toEqual(["5 modules · 9 line items", "3 sections · 2 links"]);
    expect(parts(".map-crumbs button")).toEqual([]);
    expect([text(".map-crumb-ws"), text(".map-here")]).toEqual(["Sandbox", "Demand Plan"]);
    expect(text(".map-legend-title")).toBe("Exported sections");
    expect(parts(".map-legend-name").map(name => name.textContent)).toEqual(["01: Inputs", "02: Calculations", "Reporting"]);
    expect([...locate().keys()].sort()).toEqual(["01: Inputs", "02: Calculations", "Reporting"]);
    expect([tab("modules").getAttribute("aria-pressed"), tab("drill").getAttribute("aria-pressed"), act("group").textContent]).toEqual(["true", "false", "Show all modules"]);
    expect([part(".map-module-select").hidden, act("external").hidden, part(".map-section-select").hidden, act("focus").disabled]).toEqual([true, true, false, true]);
    expect(text(".map-notes summary")).toBe("What this map leaves out · 1");
  });

  it("shows no workspace where the page names none", () => {
    mount(undefined, { modelName: "Demand Plan", workspaceName: undefined });
    map.show();
    expect(text(".map-title-sub")).toBe("Model map");
    expect(root().querySelector(".map-crumb-ws")).toBeNull();
  });

  it("goes from the sections to all modules and back with the grouping button", () => {
    open();
    act("group").press();
    expect([text(".map-here"), act("group").textContent, parts(".map-stats div")[1].textContent]).toEqual(["All modules", "Group by section", "5 visible modules · 5 links"]);
    expect([...locate().keys()].sort()).toEqual(["CAL01 - Revenue", "INP01 - Volumes", "INP02 - Prices", "Margin Workings", "REP01 - Board"]);
    expect(parts(".map-crumbs button").map(crumb => crumb.textContent)).toEqual(["Demand Plan"]);
    act("group").press();
    expect([text(".map-here"), act("group").textContent]).toEqual(["Demand Plan", "Show all modules"]);
  });

  it("shows one section's modules from the list of sections, with the modules of other sections beside them", () => {
    open();
    expect(parts(".map-section-select option").map(option => [option.getAttribute("value"), option.textContent])).toEqual([["", "All sections"], ["0", "01: Inputs"], ["1", "02: Calculations"], ["2", "Reporting"]]);
    part(".map-section-select").choose("1");
    expect([text(".map-here"), part(".map-section-select").value, act("group").textContent]).toEqual(["02: Calculations", "1", "Group by section"]);
    expect(parts(".map-legend-item").map(item => item.textContent)).toEqual(["External module3", "02: Calculations2"]);
    expect(locate().size).toBe(5);
    part(".map-section-select").choose("");
    expect(text(".map-here")).toBe("All modules");
    act("group").press();
    expect(text(".map-here")).toBe("Demand Plan");
  });

  it("goes into a section by a double press, by the details' button, and by Enter", () => {
    open();
    doubleClick("02: Calculations");
    expect(text(".map-here")).toBe("02: Calculations");
    act("crumb").press();
    expect(text(".map-here")).toBe("Demand Plan");
    clickNode("01: Inputs");
    expect(act("open").textContent).toBe("Open modules →");
    act("open").press();
    expect(text(".map-here")).toBe("01: Inputs");
    act("crumb").press();
    canvas().focus();
    key("ArrowRight");
    key("Enter");
    expect(part(".map-here").textContent).toMatch(/Inputs|Calculations|Reporting/);
    expect(parts(".map-crumbs button")).toHaveLength(1);
  });

  it("shows a module's line items from the Line items view, the list of modules, a double press and the details", () => {
    const { volumes, revenue } = sample();
    open();
    tab("drill").press();
    // The first module of the model, until one is chosen.
    expect([text(".map-here"), part(".map-module-select").value, tab("drill").getAttribute("aria-pressed"), tab("modules").getAttribute("aria-pressed")]).toEqual(["INP01 - Volumes", String(volumes), "true", "false"]);
    expect([part(".map-module-select").hidden, act("external").hidden, part(".map-section-select").hidden, act("group").hidden]).toEqual([false, false, true, true]);
    expect(parts(".map-module-select option").map(option => option.textContent)).toEqual(["INP01 - Volumes", "INP02 - Prices", "CAL01 - Revenue", "Margin Workings", "REP01 - Board"]);
    expect(text(".map-legend-title")).toBe("Node types");
    part(".map-module-select").choose(String(revenue));
    expect(text(".map-here")).toBe("CAL01 - Revenue");
    expect(parts(".map-stats div")[1].textContent).toBe("3 local · 5 external nodes");
    expect(parts(".map-legend-name").map(name => name.textContent)).toEqual(["Heading", "Line item", "List / subset", "External module"]);
    // Back to the modules, and into a module by a double press: the Line items view remembers the module.
    tab("modules").press();
    act("group").press();
    doubleClick("Margin Workings");
    expect(text(".map-here")).toBe("Margin Workings");
    tab("modules").press();
    tab("drill").press();
    expect(text(".map-here")).toBe("Margin Workings");
  });

  it("names the module's section between the model and the module, as the way to that section's modules", () => {
    open();
    tab("drill").press();
    part(".map-module-select").choose(String(sample().revenue));
    expect(parts(".map-crumbs button").map(crumb => [crumb.textContent, crumb.dataset.mapCrumb])).toEqual([["Demand Plan", "root"], ["02: Calculations", "section"]]);
    parts(".map-crumbs button")[1].press();
    expect([text(".map-here"), part(".map-section-select").value]).toEqual(["02: Calculations", "1"]);
    parts(".map-crumbs button")[0].press();
    expect(text(".map-here")).toBe("Demand Plan");
  });

  it("shows the line items of other modules one by one, and grouped again", () => {
    open();
    tab("drill").press();
    part(".map-module-select").choose(String(sample().revenue));
    expect(act("external").textContent).toBe("Expand external items");
    expect([...locate().keys()]).toContain("INP01 - Volumes");
    act("external").press();
    expect(act("external").textContent).toBe("Group external items");
    const names = [...locate().keys()];
    expect(names).toEqual(expect.arrayContaining(["Units", "Price", "Cost", "Margin %", "Total", "Gross"]));
    expect(names).not.toContain("INP01 - Volumes");
    expect(parts(".map-legend-name").map(name => name.textContent)).toContain("External line item");
    act("external").press();
    expect([...locate().keys()]).toContain("INP01 - Volumes");
  });

  it("counts who may read and write among the links when asked to, and keeps what is selected", () => {
    open();
    tab("drill").press();
    part(".map-module-select").choose(String(sample().revenue));
    clickNode("Net");
    expect(parts(".map-details summary").map(summary => summary.textContent)).toEqual(["Depends on · 2", "Used by · 1"]);
    part(".map-access").tick();
    expect(part(".map-access").checked).toBe(true);
    expect(text(".map-insp-name")).toBe("Net");
    expect(parts(".map-details summary").map(summary => summary.textContent)).toEqual(["Depends on · 3", "Used by · 1"]);
    expect(parts(".map-link small").map(small => small.textContent)).toContain("write access");
    part(".map-access").tick();
    expect(parts(".map-details summary")[0].textContent).toBe("Depends on · 2");
  });

  it("says a view that has nothing to draw, and a model without modules", () => {
    const make = new GraphMaker();
    make.module("EMPTY - Nothing Yet", "01: Inputs");
    open(make.graph());
    expect(part(".map-empty").hidden).toBe(true);
    tab("drill").press();
    expect([part(".map-empty").hidden, text(".map-empty-title"), text(".map-empty-text")]).toEqual([false, "Nothing to show here", "This module has no line items."]);
    tab("modules").press();
    expect(part(".map-empty").hidden).toBe(true);
    map.destroy();

    const bare = new GraphMaker();
    bare.list("Products");
    bare.limitations.push("The Line Items file was not exported: the map has no modules to show.");
    open(bare.graph());
    expect([text(".map-empty-title"), text(".map-empty-text")]).toEqual(["No modules to map", "The Line Items file was not exported: the map has no modules to show."]);
    expect(tab("drill").disabled).toBe(true);
    expect(part(".map-legend").hidden).toBe(true);
    tab("modules").press();
    key("f");
    key("ArrowRight");
    expect(root().querySelector(".map-insp-name")).toBeNull();
  });
});

describe("Selecting a node on the map", () => {
  it("opens the details of a node that is pressed, and says what feeds it and what it feeds", () => {
    open();
    clickNode("02: Calculations");
    expect([part(".map-inspector").hidden, text(".map-kind"), text(".map-insp-name")]).toEqual([false, "MODEL SECTION", "02: Calculations"]);
    expect(parts(".map-dl dt").map(term => term.textContent)).toEqual(["modules", "contents"]);
    expect(parts(".map-dl dd").map(value => value.textContent)).toEqual(["2", "5 line items"]);
    expect([part(".map-tracebar").hidden, text(".map-trace-name"), parts(".map-trace-count").map(count => count.textContent)]).toEqual([false, "02: Calculations", ["↑ 1 upstream", "↓ 1 downstream"]]);
    expect([act("focus").disabled, root().classList.contains("map-has-inspector")]).toEqual([false, true]);
    expect(text(".map-live")).toBe("Model section 02: Calculations selected: 1 upstream, 1 downstream.");
  });

  it("clears the selection by a press on the node selected, beside every node, with the details' button and with the bar's", () => {
    open();
    for (const clear of [() => clickNode("02: Calculations"), () => click(20, 780), () => act("close").press(), () => act("clear").press()]) {
      clickNode("02: Calculations");
      expect(part(".map-inspector").hidden).toBe(false);
      clear();
      expect([part(".map-inspector").hidden, part(".map-tracebar").hidden, act("focus").disabled, root().classList.contains("map-has-inspector")]).toEqual([true, true, true, false]);
      expect(part(".map-inspector").innerHTML).toBe("");
    }
    expect(text(".map-live")).toBe("Selection cleared.");
  });

  it("shows a line item's details: its module, its formula, what it depends on and what uses it, and where it comes from", () => {
    open();
    tab("drill").press();
    part(".map-module-select").choose(String(sample().revenue));
    clickNode("Gross");
    expect([text(".map-kind"), text(".map-insp-name"), text(".map-formula")]).toEqual(["LINE ITEM", "Gross", "Units * Price"]);
    expect(parts(".map-dl dd")[0].textContent).toBe("CAL01 - Revenue");
    expect(parts(".map-details summary").map(summary => summary.textContent)).toEqual(["Depends on · 3", "Used by · 2"]);
    expect(parts(".map-link").map(link => link.querySelector(".map-link-text")?.childNodes[0].textContent)).toEqual(["Products", "Units", "Price", "Net", "Margin %"]);
    expect(text(".map-source")).toMatch(/^Line Items · row \d+$/);
    expect(parts(".map-trace-count").map(count => count.textContent)).toEqual(["↑ 3 upstream", "↓ 3 downstream"]);
    clickNode("Workings");
    expect(parts(".map-insp-note").map(note => note.textContent)).toEqual(["Exported heading; no formula."]);
  });

  it("goes to an object the details name, wherever it is: a module among its section's, a line item in its own module", () => {
    const { volumes } = sample();
    open();
    clickNode("01: Inputs");
    // A module of the section: the map goes to the section's modules and selects it.
    part(`[data-map-raw="${volumes}"]`).press();
    expect([text(".map-here"), text(".map-insp-name"), text(".map-kind")]).toEqual(["01: Inputs", "INP01 - Volumes", "MODULE"]);
    // One of its line items: the map goes into the module and selects it.
    part(".map-details summary");
    const items = parts(".map-details").find(details => details.dataset.mapList === "items")!;
    items.querySelector("summary")!.press();
    items.querySelectorAll(".map-link")[0].press();
    expect([text(".map-here"), text(".map-insp-name"), text(".map-kind")]).toEqual(["INP01 - Volumes", "Units", "LINE ITEM"]);
    // What uses it is in another module: the map goes there.
    parts(".map-link").find(link => link.textContent.startsWith("Gross"))!.press();
    expect([text(".map-here"), text(".map-insp-name")]).toEqual(["CAL01 - Revenue", "Gross"]);
    // A list its formula names is on screen here: it is selected where it is.
    parts(".map-link").find(link => link.textContent.startsWith("Products"))!.press();
    expect([text(".map-here"), text(".map-insp-name"), text(".map-kind")]).toEqual(["CAL01 - Revenue", "Products", "LIST"]);
  });

  it("selects a node on screen from the details of a module, and opens a line item's module with it selected", () => {
    const { revenue } = sample();
    open();
    act("group").press();
    clickNode("CAL01 - Revenue");
    expect(parts(".map-details summary").map(summary => summary.textContent)).toEqual(["Depends on · 3", "Used by · 2", "All line items · 3"]);
    part('[data-map-node]').press();
    expect([text(".map-here"), text(".map-kind")]).toEqual(["All modules", "MODULE"]);
    expect(text(".map-insp-name")).not.toBe("CAL01 - Revenue");
    clickNode("CAL01 - Revenue");
    expect([act("open").textContent, act("open").dataset.mapModule]).toEqual(["Open 3 line items →", String(revenue)]);
    act("open").press();
    expect(text(".map-here")).toBe("CAL01 - Revenue");
    clickNode("Net");
    expect([act("open").textContent, act("open").dataset.mapSelect]).toEqual(["Open containing module →", String(sample().net)]);
    act("open").press();
    expect([text(".map-here"), text(".map-insp-name")]).toEqual(["CAL01 - Revenue", "Net"]);
  });

  it("lists the rest of a long list when asked to, and goes on from the first of the rest", () => {
    const make = new GraphMaker();
    const module = make.module("BIG - Many Lines", "01: All");
    for (let index = 0; index < 130; index++) make.item(module, `Line ${index}`);
    open(make.graph());
    act("group").press();
    clickNode("BIG - Many Lines");
    const items = (): FakeElement => parts(".map-details").find(details => details.dataset.mapList === "items")!;
    items().querySelector("summary")!.press();
    expect([items().querySelectorAll(".map-link").length, items().querySelector(".map-more")?.textContent]).toEqual([100, "Show all 130"]);
    items().querySelector(".map-more")!.press();
    expect([items().querySelectorAll(".map-link").length, items().querySelector(".map-more")]).toEqual([130, null]);
    expect(page.document.activeElement).toBe(items().querySelectorAll(".map-link")[100]);
    expect(items().hasAttribute("open")).toBe(true);
  });

  it("keeps the view to the trace and shows the full graph again", () => {
    open();
    act("group").press();
    clickNode("INP02 - Prices");
    expect(act("focus").textContent).toBe("Focus trace");
    act("focus").press();
    env.settle();
    expect(act("focus").textContent).toBe("Show full graph");
    // Prices feeds Revenue, which feeds Margin Workings and the Board: Volumes has no part in that.
    expect([...locate().keys()].sort()).toEqual(["CAL01 - Revenue", "INP02 - Prices", "Margin Workings", "REP01 - Board"]);
    act("focus").press();
    env.settle();
    expect(act("focus").textContent).toBe("Focus trace");
    expect(locate().size).toBe(5);
    act("focus").press();
    act("fit").press();
    env.settle();
    expect([act("focus").textContent, locate().size]).toEqual(["Focus trace", 5]);
  });

  it("keeps to the trace of a line item that has nowhere to go into", () => {
    open();
    tab("drill").press();
    part(".map-module-select").choose(String(sample().revenue));
    doubleClick("Net");
    env.settle();
    expect([text(".map-here"), text(".map-insp-name"), act("focus").textContent]).toEqual(["CAL01 - Revenue", "Net", "Show full graph"]);
    expect([...locate().keys()]).not.toContain("Workings");
  });

  it("goes to a line item of another module by a double press on it", () => {
    open();
    tab("drill").press();
    part(".map-module-select").choose(String(sample().revenue));
    act("external").press();
    doubleClick("Units");
    expect([text(".map-here"), text(".map-insp-name")]).toEqual(["INP01 - Volumes", "Units"]);
  });

  it("hides a layer and shows it again from the legend, and says which is hidden in more than its colour", () => {
    open();
    act("group").press();
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
    expect(moved.get("02: Calculations")).toEqual([x + 90, y + 140]);
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
    act("group").press();
    act("group").press();
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
      steps.push(`${text(".map-here")}|${part(".map-inspector").hidden ? "none" : text(".map-insp-name")}|${event.defaultPrevented}`);
    }
    expect(steps).toEqual(["CAL01 - Revenue|none|true", "02: Calculations|none|true", "Demand Plan|none|true", "Demand Plan|none|false"]);
    // From all modules, back is the sections.
    act("group").press();
    canvas().focus();
    key("Escape");
    expect(text(".map-here")).toBe("Demand Plan");
  });

  it("hears keys only while the focus is inside it", () => {
    open();
    act("group").press();
    clickNode("CAL01 - Revenue");
    page.id("outside").focus();
    const requested = env.requested;
    for (const name of ["Escape", "f", "+", "-", "/", "ArrowRight", "Enter"]) expect(page.key(name).defaultPrevented, name).toBe(false);
    expect([text(".map-here"), text(".map-insp-name"), env.requested, page.document.activeElement.id]).toEqual(["All modules", "CAL01 - Revenue", requested, "outside"]);
  });

  it("fits with F, zooms with plus and minus, and goes to the search with the slash, from anywhere in the map but a box", () => {
    open();
    act("group").focus();
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
    part(".map-section-select").focus();
    for (const name of ["f", "Escape", "ArrowDown"]) expect([name, key(name).defaultPrevented]).toEqual([name, false]);
    expect(text(".map-here")).toBe("Demand Plan");
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
    expect(text(".map-here")).toBe("Reporting");
    // The arrows are the canvas's alone: on a button they are not taken.
    act("fit").focus();
    expect(key("ArrowRight").defaultPrevented).toBe(false);
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
    parts(".map-link")[0].focus();
    parts(".map-link")[0].press();
    expect(page.document.activeElement).toBe(part(".map-insp-name"));
    parts(".map-crumbs button")[0].focus();
    parts(".map-crumbs button")[0].press();
    expect(page.document.activeElement).toBe(canvas());
    // Escape on a control of the details that go with the selection.
    clickNode("01: Inputs");
    act("open").focus();
    key("Escape");
    expect(page.document.activeElement).toBe(canvas());
  });
});

describe("The map's search", () => {
  it("lists what the text names anywhere in the model, counts it, and marks it on the canvas", () => {
    open();
    act("group").press();
    env.settle();
    env.main.clear();
    part(".map-search").type("revenue");
    expect([part(".map-results").hidden, text(".map-search-count")]).toEqual([false, "4"]);
    expect(parts(".map-result").map(result => [result.querySelector("span")?.textContent, result.querySelector("small")?.textContent])).toEqual([
      ["CAL01 - Revenue", "Module · 02: Calculations"], ["Workings", "CAL01 - Revenue"], ["Gross", "CAL01 - Revenue"], ["Net", "CAL01 - Revenue"],
    ]);
    expect(text(".map-live")).toBe("4 matches.");
    env.settle();
    expect(env.main.named("stroke").filter(call => call.strokeStyle === FALLBACK.match)).toHaveLength(1);
    part(".map-search").type("zzz");
    expect([text(".map-results"), text(".map-search-count"), text(".map-live")]).toEqual(["No matching sections, modules or line items.", "0", "No matches."]);
    part(".map-search").type("");
    expect([part(".map-results").hidden, text(".map-search-count")]).toEqual([true, ""]);
  });

  it("goes to the first hit with Enter, and to any hit by a press on it, and puts the focus on its details", () => {
    open();
    part(".map-search").type("gross");
    key("Enter");
    expect([text(".map-here"), text(".map-insp-name"), part(".map-results").hidden, part(".map-search").value]).toEqual(["CAL01 - Revenue", "Gross", true, ""]);
    expect(page.document.activeElement).toBe(part(".map-insp-name"));
    part(".map-search").type("inp0");
    parts(".map-result").find(result => result.textContent.startsWith("INP02 - Prices"))!.press();
    expect([text(".map-here"), text(".map-insp-name"), text(".map-kind")]).toEqual(["01: Inputs", "INP02 - Prices", "MODULE"]);
    expect(page.document.activeElement).toBe(part(".map-insp-name"));
    // A section is found too, and shown among the model's sections.
    part(".map-search").type("report");
    key("Enter");
    expect([text(".map-here"), text(".map-insp-name"), text(".map-kind")]).toEqual(["Demand Plan", "Reporting", "MODEL SECTION"]);
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
    expect([part(".map-results").hidden, part(".map-search").value, page.document.activeElement === canvas(), text(".map-here")]).toEqual([true, "in", true, "Demand Plan"]);
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

describe("What moves on the map", () => {
  it("moves nothing for a user who asked for less motion: the camera is where it goes at once, and a trace is a solid line", () => {
    env.reduced = true;
    open();
    act("group").press();
    clickNode("CAL01 - Revenue");
    expect(env.settle()).toBeLessThanOrEqual(1);
    act("fit").press();
    expect(env.settle()).toBe(1);
    env.time += 5000;
    expect(env.waiting).toBe(0);
    expect(env.main.named("setLineDash").filter(call => (call.args[0] as number[])[0] === 7)).toEqual([]);
  });

  it("keeps drawing only while a trace is on screen, and stops when it is cleared or the map is hidden", () => {
    env.reduced = false;
    open();
    expect(env.waiting).toBe(0);
    clickNode("02: Calculations");
    for (let frame = 0; frame < 5; frame++) expect(env.frame()).toBe(1);
    expect(env.waiting).toBe(1);
    expect(env.main.named("setLineDash").some(call => (call.args[0] as number[])[0] === 7)).toBe(true);
    act("clear").press();
    expect(env.settle()).toBe(1);
    env.time += 5000;
    expect(env.waiting).toBe(0);
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
    expect([text(".map-title-name"), part(".map-title-name").title, text(".map-here")]).toEqual([closers.trim(), closers, closers.trim()]);
    expect(parts(".map-notes li")[0].textContent).toBe(img);
    expect(parts(".map-section-select option").map(option => option.textContent)).toEqual(["All sections", quoted, entity]);
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
    expect(parts(".map-lines li").map(line => line.textContent)).toEqual([`${quoted}: ${script}`]);
    expect(parts(".map-link").map(link => link.querySelector(".map-link-text")?.childNodes[0].textContent)).toEqual([closers, single]);
    part(".map-search").type("alert");
    check();
    expect(parts(".map-result span").map(name => name.textContent)).toEqual(expect.arrayContaining([img, script, single]));
    expect(parts(".map-module-select option").map(option => option.textContent)).toEqual([img, `${breakOut} - ${single}`]);
    // The tooltip's name is the name as typed.
    pointer("pointermove", ...at(script));
    expect(part(".map-tip-name").textContent).toBe(script);
    check();
  });
});
