import { describe, expect, it } from "vitest";
import { parseMarkup } from "../results/dom.test-support.js";
import { buildModelGraph } from "./build-graph.js";
import { createFonts, drawScene, type Pen } from "./map-canvas.js";
import { accessMarkedModel, FakePen } from "./map-fakes.test-support.js";
import { drawLinks, moduleGraph, modulesGraph, sectionsGraph, type ViewGraph } from "./map-graphs.js";
import { accessTipLines, inspect } from "./map-inspect.js";
import { layoutGraph, sizeNodes } from "./map-layout.js";
import { ACCESS_MARK_SAYS, ACCESS_NONE, ACCESS_SAYS, ACCESS_UNMATCHED, ACCESS_UNREAD, accessNote, inspectorHtml, legendHtml } from "./map-markup.js";
import { KEY_PATH } from "./map-marks.js";
import { indexModel, withGrouping } from "./map-model.js";
import { FALLBACK } from "./map-palette.js";

const marks = (view: ViewGraph) => view.nodes.filter(node => node.accessMark).map(node => [node.fullName, node.accessMark]);

describe("Access marks and their meaning", () => {
  it("counts distinct drivers per module and modules per group, even when a driver reads and writes or controls its own module", () => {
    const { graph, home, checks, plan } = accessMarkedModel();
    const model = indexModel(graph);
    expect([model.accessDriversOf(home), model.accessDriversOf(checks), model.accessDriversOf(plan)]).toEqual([3, 1, 0]);
    expect(marks(sectionsGraph(model, true))).toEqual([["Access", 2]]);
    expect(marks(modulesGraph(model, undefined, true))).toEqual([["ACC01 Access", 3], ["ACC02 Checks", 1]]);
    expect(marks(moduleGraph(model, home, false, true))).toEqual([["Can read", 1], ["Can write", 1], ["Open and visible", 1]]);
    const grouped = withGrouping(model, { kind: "headings", label: "Refiled", source: "Test groups", groups: ["Together"], groupOf: new Map([[home, "Together"], [checks, "Together"], [plan, "Together"]]) });
    expect(marks(sectionsGraph(grouped, true))).toEqual([["Together", 2]]);
    // Modules alongside another module still count their own drivers; expanded driver boxes carry one key each.
    expect(marks(moduleGraph(model, plan, false, true))).toEqual([["ACC01 Access", 3], ["ACC02 Checks", 1]]);
    expect(marks(moduleGraph(model, plan, true, true))).toEqual([["Can read", 1], ["Can write", 1], ["Approved", 1]]);
  });

  it("removes all access marks when unticked or when there are no access edges, keeping the funnel independent", () => {
    const { graph, home, both } = accessMarkedModel();
    for (const model of [indexModel(graph), indexModel({ ...graph, edges: graph.edges.filter(edge => !edge[2].includes("access")) })]) {
      for (const access of [false, ...(model.accessEdges.length ? [] : [true])]) {
        for (const view of [sectionsGraph(model, access, true), modulesGraph(model, undefined, access, true), moduleGraph(model, home, true, access, true)]) expect(marks(view)).toEqual([]);
        expect(moduleGraph(model, home, false, access, true).byId.get(String(both))?.filterMark).toBe(1);
      }
    }
  });

  it("only overlays marks on placed boxes, including a box dragged by hand", () => {
    const { graph, home, both } = accessMarkedModel();
    const model = indexModel(graph);
    const places = moduleGraph(model, home, false, true, true);
    const fonts = createFonts(new FakePen() as unknown as Pen, FALLBACK);
    sizeNodes(places, fonts.measure("label"), fonts.measure("item"));
    layoutGraph(places, [{ width: 1000, height: 700 }]);
    places.byId.get(String(both))!.x += 37;
    const positions = (view: ViewGraph) => view.nodes.map(node => [node.id, node.x, node.y, node.w, node.h, node.lines]);
    for (const access of [true, false]) {
      const view = drawLinks(places, moduleGraph(model, home, false, access, true), true);
      expect(positions(view)).toEqual(positions(places));
      expect(view.byId.get(String(both))).toMatchObject({ accessMark: access ? 1 : undefined, filterMark: 1 });
    }
  });

  it("says read, write and both in hover cards and details, counting modules honestly", () => {
    const { graph, home, read, write, both, local, plan, price } = accessMarkedModel();
    const model = indexModel(graph);
    const view = moduleGraph(model, home, false, true);
    expect(accessTipLines(model, model.node(read)!)).toEqual(["Read access driver for 2 line items"]);
    expect(accessTipLines(model, model.node(write)!)).toEqual(["Write access driver for 1 line item"]);
    expect(accessTipLines(model, model.node(both)!)).toEqual(["Read access driver for 1 line item and 1 module", "Write access driver for 1 line item"]);
    for (const [id, role] of [[read, "Read"], [write, "Write"], [both, "Read and write"]] as const) {
      expect(inspect(model, view, view.byId.get(String(id))!, true).rows).toContainEqual(["Access driver", role]);
    }
    const driver = inspect(model, view, view.byId.get(String(both))!, true);
    expect(driver.lists.find(list => list.key === "controls")).toMatchObject({ title: "Controls · 2", open: true, links: [
      { raw: plan, name: "PLN01 Plan", caption: "Read access" }, { raw: local, name: "Local value", caption: "Read and write access" },
    ] });
    expect(driver.lists.find(list => list.key === "used")?.links.map(link => link.raw)).toEqual([local]);
    const controlled = inspect(model, view, view.byId.get(String(local))!, true);
    expect(controlled.lists.find(list => list.key === "accessDrivenBy")).toMatchObject({ title: "Access driven by · 1", links: [{ raw: both, caption: "Read and write access" }] });
    const planView = moduleGraph(model, plan, false, true);
    expect(inspect(model, planView, planView.byId.get(String(price))!, true).lists.find(list => list.key === "accessDrivenBy"))
      .toMatchObject({ title: "Access driven by · 2", links: [{ raw: read, caption: "Read access" }, { raw: write, caption: "Write access" }] });
    const html = parseMarkup(inspectorHtml(driver));
    expect(html.querySelector(`[data-map-raw="${local}"]`)).not.toBeNull();
    expect(html.querySelector(`[data-map-raw="${plan}"]`)).not.toBeNull();
  });

  it("explains the SVG key only when a mark is drawn, at each level", () => {
    for (const kind of ["sections", "modules", "drill"] as const) {
      const html = parseMarkup(legendHtml("On this map", [], new Set(), undefined, kind, undefined, kind));
      expect(html.querySelector(".map-legend-key")?.textContent).toBe(ACCESS_MARK_SAYS[kind]);
      expect(html.querySelector(".map-mark-access path")?.getAttribute("d")).toBe(KEY_PATH);
      expect(html.querySelector(".map-mark-filter")).not.toBeNull();
    }
    expect(legendHtml("On this map", [], new Set())).not.toContain("map-mark-access");
  });

  it("distinguishes no drivers, unread columns as on Polaris, and unmatched driver names", () => {
    const { graph } = accessMarkedModel();
    expect(accessNote(graph, true)).toBe(ACCESS_SAYS);
    expect(accessNote({ ...graph, edges: [] }, false)).toBe(ACCESS_NONE);
    const unread = buildModelGraph([{ file: "Line Items.csv", label: "Line Items", guard: false, headers: ["", "Module Name", "Format"], rows: [["Value", "Invented plan", "NUMBER"]] }]);
    expect(unread.accessDriversRead).toBe(false);
    expect(accessNote(unread, false)).toBe(ACCESS_UNREAD);
    expect(marks(modulesGraph(indexModel(unread), undefined, true))).toEqual([]);
    expect(accessNote({ ...graph, edges: [], unresolved: [{ source: 0, field: "Read Access Driver", reference: "Missing driver" }] }, false)).toBe(ACCESS_UNMATCHED);
  });

  it("draws separate funnel and key paths above the name, at readable zooms, and separate dots when small", () => {
    const { graph, home, both } = accessMarkedModel();
    const model = indexModel(graph);
    const view = moduleGraph(model, home, false, true, true);
    const pen = new FakePen();
    const fonts = createFonts(pen as unknown as Pen, FALLBACK);
    sizeNodes(view, fonts.measure("label"), fonts.measure("item"));
    const marked = view.byId.get(String(both))!;
    marked.x = 200;
    marked.y = 100;
    const shown = new Uint8Array(view.nodes.length);
    shown[marked.index] = 1;
    for (const k of [0.83, 1, 1.15, 2]) {
      pen.clear();
      drawScene(pen as unknown as Pen, { graph: view, palette: FALLBACK, camera: { k, ox: 0, oy: 0 }, width: 1200, height: 800, shown }, fonts);
      const pills = pen.calls.filter((call, index) => call.name === "roundRect" && [FALLBACK.access, FALLBACK.filter].includes(pen.calls[index + 1]?.fillStyle));
      expect(pills).toHaveLength(2);
      const [filter, key] = pills.map(call => call.args as number[]);
      expect(key[0] + key[2]).toBeLessThan(filter[0]);
      expect(key[0]).toBeGreaterThan(marked.x * k);
      const text = pen.named("fillText").find(call => call.fillStyle === FALLBACK.nodeText)!;
      const fontSize = Number(/([\d.]+)px/.exec(text.font)![1]);
      expect(key[1] + key[3]).toBeLessThan(Number(text.args[2]) - fontSize * 0.7);
      expect(pen.named("fill").filter(call => call.args[0] === "evenodd")).toHaveLength(1);
      expect(pen.texts()).toEqual(["Open and visible"]);
    }
    pen.clear();
    drawScene(pen as unknown as Pen, { graph: view, palette: FALLBACK, camera: { k: 0.2, ox: 0, oy: 0 }, width: 1200, height: 800, shown }, fonts);
    const dots = pen.named("arc").filter(call => [FALLBACK.access, FALLBACK.filter].includes(call.fillStyle));
    expect(dots).toHaveLength(2);
    expect(Math.abs(Number(dots[0].args[0]) - Number(dots[1].args[0]))).toBeGreaterThan(Number(dots[0].args[2]) * 2);
    expect(dots.map(call => call.args[1])).toEqual([20, 20]);
  });
});
