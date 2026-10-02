import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mountOnce, type PanelOptions } from "./panel.js";

/** Just enough of an element for the panel: properties, children, listeners and attributes. */
class FakeElement {
  static created: FakeElement[] = [];
  hidden = false;
  disabled = false;
  textContent = "";
  className = "";
  title = "";
  scrollTop = 0;
  scrollHeight = 0;
  readonly style: Record<string, string> = {};
  children: unknown[] = [];
  private readonly listeners = new Map<string, () => void>();
  private readonly attributes = new Set<string>();
  constructor(readonly tag: string) { FakeElement.created.push(this); }
  append(...nodes: unknown[]) { this.children.push(...nodes); }
  replaceChildren(...nodes: unknown[]) { this.children = nodes; }
  addEventListener(type: string, listener: () => void) { this.listeners.set(type, listener); }
  attachShadow() { return new FakeElement("#shadow-root"); }
  hasAttribute(name: string) { return this.attributes.has(name); }
  setAttribute(name: string) { this.attributes.add(name); }
  click() { this.listeners.get("click")?.(); }
}

const find = (className: string, textContent?: string) =>
  FakeElement.created.find(node => node.className === className && (textContent === undefined || node.textContent === textContent))!;

describe("Analyzer panel", () => {
  beforeEach(() => {
    FakeElement.created = [];
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.UTC(2026, 8, 28, 1, 59, 9)));
    const page: Record<string, unknown> = {};
    page.top = page;
    vi.stubGlobal("window", page);
    vi.stubGlobal("location", { host: "us1a.app.anaplan.com" });
    vi.stubGlobal("document", { createElement: (tag: string) => new FakeElement(tag), documentElement: new FakeElement("html") });
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  const options = (run: PanelOptions["run"]): PanelOptions => ({
    id: "demo-tool", launchLabel: "Open demo", title: "Demo", description: "Reads only.", startLabel: "Start demo", subject: () => "subject-1", run });

  it("stamps every diagnostic line with its time, starting with the tool, its version and the page", async () => {
    let diagnostic = "";
    let finished: () => void = () => undefined;
    const done = new Promise<void>(resolve => { finished = resolve; });
    mountOnce(options(async (subject, progress, diagnostics) => {
      expect(subject).toBe("subject-1");
      progress.status("Reading names…");
      vi.setSystemTime(new Date(Date.UTC(2026, 8, 28, 13, 0, 59, 999)));
      progress.log("3 rows");
      diagnostic = diagnostics();
      finished();
      return { zip: new Uint8Array(), fileName: "demo.zip", summary: ["3 rows"] };
    }));
    find("primary", "Start demo").click();
    await done;
    const lines = ["01:59:09 demo-tool vdev: subject-1 on us1a.app.anaplan.com", "01:59:09 Reading names…", "13:00:59 3 rows"];
    expect(diagnostic).toBe(lines.join("\r\n"));
    expect(find("log").textContent).toBe(lines.join("\n"));
  });

  it("logs why a run stopped, and mounts a tool only once per document", async () => {
    let runs = 0;
    const failing = options(async () => { runs++; throw new Error("The model frame stopped answering."); });
    mountOnce(failing);
    const elements = FakeElement.created.length;
    mountOnce(failing);
    expect(FakeElement.created.length).toBe(elements);
    find("primary", "Start demo").click();
    await vi.waitFor(() => expect(find("status").textContent).toBe("Stopped: The model frame stopped answering."));
    expect(runs).toBe(1);
    expect(find("log").textContent).toBe("01:59:09 demo-tool vdev: subject-1 on us1a.app.anaplan.com\n01:59:09 stopped: The model frame stopped answering.");
  });
});

// The two bundles' entry points run on import; each test imports one afresh against the fake document.
describe("Analyzer entry points", () => {
  const WS = "0123456789abcdef0123456789abcdef";
  const MODEL = "FEDCBA9876543210FEDCBA9876543210";
  const MODEL_EXPORT = "Exports this model's Model settings (line items, modules, lists, actions, time ranges, versions and source models) and the model calendar as CSV files. It only reads.";
  let root: FakeElement;

  beforeEach(() => {
    FakeElement.created = [];
    vi.resetModules();
    vi.useFakeTimers();
    root = new FakeElement("html");
    vi.stubGlobal("document", { createElement: (tag: string) => new FakeElement(tag), documentElement: root });
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  const texts = (className: string) => FakeElement.created.filter(node => node.className === className).map(node => node.textContent);
  /** What each mounted tool shows: its launch button and tooltip, panel title, description and start button. */
  const mounted = () => ({
    launch: FakeElement.created.filter(node => node.className === "launch primary").map(node => [node.textContent, node.title]),
    titles: texts("title"), descriptions: texts("status"), start: texts("primary").filter(text => text !== "Download CSVs (.zip)"),
  });

  it("offers the app analysis and the model export on the page the user sees", async () => {
    const page: Record<string, unknown> = { addEventListener: () => undefined, frames: [] };
    page.top = page;
    vi.stubGlobal("window", page);
    // An address that names an app and a model at once, so both tools show their description.
    vi.stubGlobal("location", { host: "us1a.app.anaplan.com", pathname: `/a/modeling/customers/${WS}/models/${MODEL}/apps/app/01234567-89ab-cdef-0123-456789abcdef` });
    await import("./content.js");
    expect(mounted()).toEqual({
      launch: [["Analyse app", "Page analyzer"], ["Export model", "Model export"]],
      titles: ["Page analyzer · vdev", "Model export · vdev"],
      descriptions: ["Exports every page in this app (cards, modules, line items, filters, conditional formatting and actions) as CSV files. It only reads.", MODEL_EXPORT],
      start: ["Export pages", "Export model"],
    });
    expect(["data-sam-page-analyzer", "data-sam-model-export-shell", "data-sam-model-export"].map(marker => root.hasAttribute(marker))).toEqual([true, true, false]);
  });

  it("offers the model export on a classic model page opened on its own, once the model is there", async () => {
    const page: Record<string, unknown> = { postMessage: () => undefined };
    page.top = page;
    vi.stubGlobal("window", page);
    vi.stubGlobal("location", { host: "eu2a.app.anaplan.com", pathname: "/core-webapp/anaplan/framework.jsp" });
    await import("./model-content.js");
    vi.advanceTimersByTime(1000);
    expect(mounted().launch).toEqual([]);
    Object.assign(page, { require: () => undefined, modelId: MODEL, workspaceId: WS });
    vi.advanceTimersByTime(1000);
    expect(mounted()).toEqual({ launch: [["Export model", "Model export"]], titles: ["Model export · vdev"], descriptions: [MODEL_EXPORT], start: ["Export model"] });
    expect(["data-sam-model-export", "data-sam-model-export-shell"].map(marker => root.hasAttribute(marker))).toEqual([true, false]);
  });

  it("shows no button in the model's core frame, and announces the model to the page instead", async () => {
    const posted: unknown[] = [];
    vi.stubGlobal("window", { require: () => undefined, modelId: MODEL, workspaceId: WS, addEventListener: () => undefined,
      top: { postMessage: (message: unknown) => { posted.push(message); } } });
    vi.stubGlobal("location", { host: "eu2a.app.anaplan.com", pathname: "/core-webapp/anaplan/framework.jsp" });
    await import("./model-content.js");
    vi.advanceTimersByTime(1000);
    expect(mounted().launch).toEqual([]);
    expect(posted).toContainEqual({ protocol: "sam-model-export", type: "core-ready", modelId: MODEL });
  });
});
