import { afterEach, describe, expect, it, vi } from "vitest";
import { describeProbe, probeFrame, PROTOCOL, runInCore, serveCore, watchCore, watchProbes, type CoreHandle, type Endpoint, type FrameProbe } from "./bridge.js";
import { NOT_SCOPE_IDS, SCOPE_IDS } from "./guards.test-support.js";
import type { Progress, TaskResult } from "./panel.js";

/** Two windows that talk like browser windows: posting to a window as another window holds it delivers a cloned message
 * there, from that other window's origin, with `source` set to the sender as the receiver holds it. */
class FakeWindow {
  private readonly listeners = new Set<(event: MessageEvent) => void>();
  private readonly handles = new Map<FakeWindow, Endpoint>();
  constructor(readonly origin: string) {}
  addEventListener(_type: "message", listener: (event: MessageEvent) => void) { this.listeners.add(listener); }
  removeEventListener(_type: "message", listener: (event: MessageEvent) => void) { this.listeners.delete(listener); }
  seenBy(other: FakeWindow): Endpoint {
    let handle = this.handles.get(other);
    if (!handle) {
      handle = {
        postMessage: (message: unknown, targetOrigin: string) => {
          if (targetOrigin !== "*" && targetOrigin !== this.origin) return; // browsers drop a message for another origin
          const event = { data: structuredClone(message), origin: other.origin, source: other.seenBy(this) } as unknown as MessageEvent;
          queueMicrotask(() => { for (const listener of [...this.listeners]) listener(event); });
        },
      };
      this.handles.set(other, handle);
    }
    return handle;
  }
}

const MODEL = "FEDCBA9876543210FEDCBA9876543210";
const settle = () => new Promise(resolve => setTimeout(resolve, 5));
const collect = () => {
  const lines: string[] = [];
  const progress: Progress = { status: text => lines.push(`status: ${text}`), log: line => lines.push(`log: ${line}`) };
  return { lines, progress };
};

describe("Model export bridge between the Model Building page and the model's core frame", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

  it("shows the core frame to the page, runs the export there and brings the zip back", async () => {
    const shell = new FakeWindow("https://us1a.app.anaplan.com");
    const core = new FakeWindow("https://eu2a.app.anaplan.com");
    let found: CoreHandle | undefined;
    watchCore(shell, handle => { found = handle; });
    let runs = 0;
    const exporter = async (progress: Progress, diagnostics: () => string): Promise<TaskResult> => {
      runs++;
      progress.status("Reading Line Items…");
      progress.log("Line Items: 3 rows × 2 columns");
      expect(diagnostics()).toContain("Line Items: 3 rows × 2 columns");
      return { zip: new Uint8Array([80, 75, 5, 6]), fileName: "Model one - model export.zip", summary: ["Line Items: 3 rows"] };
    };
    const stop = serveCore(core, shell.seenBy(core), () => MODEL, exporter, 5);
    await settle();
    expect(found).toMatchObject({ origin: "https://eu2a.app.anaplan.com", modelId: MODEL });

    const { lines, progress } = collect();
    const result = await runInCore(shell, found!, progress);
    expect(runs).toBe(1);
    expect(result.fileName).toBe("Model one - model export.zip");
    expect(Array.from(result.zip)).toEqual([80, 75, 5, 6]);
    expect(result.summary).toEqual(["Line Items: 3 rows"]);
    expect(lines).toEqual(["status: Reading Line Items…", "log: Line Items: 3 rows × 2 columns"]);
    stop();
  });

  it("ignores other origins and other windows, and gives up on a frame that stops answering", async () => {
    const shell = new FakeWindow("https://us1a.app.anaplan.com");
    const stranger = new FakeWindow("https://evil.example.com");
    let found: CoreHandle | undefined;
    watchCore(shell, handle => { found = handle; });
    shell.seenBy(stranger).postMessage({ protocol: PROTOCOL, type: "core-ready", modelId: MODEL }, "*");
    await settle();
    expect(found).toBeUndefined();

    // A core frame runs only what its own top window asks for.
    const core = new FakeWindow("https://eu2a.app.anaplan.com");
    const sibling = new FakeWindow("https://us1a.app.anaplan.com");
    let runs = 0;
    const stop = serveCore(core, shell.seenBy(core), () => MODEL, async () => { runs++; return { zip: new Uint8Array(), fileName: "x", summary: [] }; }, 5);
    core.seenBy(sibling).postMessage({ protocol: PROTOCOL, type: "run", nonce: "n" }, "*");
    await settle();
    expect(runs).toBe(0);
    stop();

    const silent: CoreHandle = { source: { postMessage: () => undefined }, origin: "https://eu2a.app.anaplan.com", modelId: MODEL };
    await expect(runInCore(shell, silent, collect().progress, 20)).rejects.toThrow("The model frame stopped answering.");
  });

  it("checks in again when the page greets it, and reports what each frame sees", async () => {
    const shell = new FakeWindow("https://us1a.app.anaplan.com");
    const core = new FakeWindow("https://eu2a.app.anaplan.com");
    const readies: string[] = [];
    shell.addEventListener("message", event => { const data = event.data as { type?: string }; if (data.type === "core-ready") readies.push(data.type); });
    watchCore(shell, () => undefined);
    const stop = serveCore(core, shell.seenBy(core), () => MODEL, async () => ({ zip: new Uint8Array(), fileName: "x", summary: [] }), 5);
    await settle();
    await settle();
    const before = readies.length;
    core.seenBy(shell).postMessage({ protocol: PROTOCOL, type: "hello" }, "*");
    await settle();
    expect(readies.length).toBe(before + 1);
    stop();

    const probes: FrameProbe[] = [];
    watchProbes(shell, probe => probes.push(probe));
    shell.seenBy(core).postMessage({ protocol: PROTOCOL, type: "probe", probe: { host: "eu2a.app.anaplan.com", path: "/core-webapp-<id>/anaplan/framework.jsp",
      top: false, loader: "function", model: "id", workspace: "id" } }, "*");
    await settle();
    expect(probes.map(describeProbe)).toEqual(["frame eu2a.app.anaplan.com/core-webapp-<id>/anaplan/framework.jsp: loader=function model=id workspace=id"]);
  });

  it("stops announcing once the page acknowledges, and reports a failed export", async () => {
    const shell = new FakeWindow("https://us1a.app.anaplan.com");
    const core = new FakeWindow("https://eu2a.app.anaplan.com");
    let announcements = 0;
    shell.addEventListener("message", event => { if ((event.data as { type?: string }).type === "core-ready") announcements++; });
    let found: CoreHandle | undefined;
    watchCore(shell, handle => { found = handle; });
    const stop = serveCore(core, shell.seenBy(core), () => MODEL, async () => { throw new Error("This model page has no REMOTE_MODEL axis."); }, 5);
    await settle();
    await settle();
    const seen = announcements;
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(announcements).toBe(seen);
    await expect(runInCore(shell, found!, collect().progress)).rejects.toThrow("This model page has no REMOTE_MODEL axis.");
    stop();
  });

  it("accepts a core frame only when it names a 32-character model ID", async () => {
    const shell = new FakeWindow("https://us1a.app.anaplan.com");
    const core = new FakeWindow("https://eu2a.app.anaplan.com");
    const found: string[] = [];
    watchCore(shell, handle => { found.push(handle.modelId); });
    for (const modelId of [MODEL.slice(1), `${MODEL}0`, MODEL.replace("F", "-"), "", 42, undefined, MODEL.toLowerCase()]) {
      shell.seenBy(core).postMessage({ protocol: PROTOCOL, type: "core-ready", modelId }, "*");
    }
    await settle();
    expect(found).toEqual([MODEL.toLowerCase()]);

    // 32 letters or digits, hexadecimal or not; no character that could change a path or a destination.
    found.length = 0;
    for (const modelId of [...NOT_SCOPE_IDS, ...SCOPE_IDS]) shell.seenBy(core).postMessage({ protocol: PROTOCOL, type: "core-ready", modelId }, "*");
    await settle();
    expect(found).toEqual(SCOPE_IDS);
  });

  it("reports a frame's model and workspace as shapes, never as values", () => {
    const page: Record<string, unknown> = { require: () => undefined, modelId: MODEL, workspaceId: "0123456789abcdef" };
    page.top = page;
    vi.stubGlobal("window", page);
    vi.stubGlobal("location", { host: "eu2a.app.anaplan.com", pathname: `/a/modeling/customers/0123456789abcdef0123456789abcdef/models/${MODEL}/modules` });
    expect(probeFrame()).toEqual({ host: "eu2a.app.anaplan.com", path: "/a/modeling/customers/<id>/models/<id>/modules", top: true,
      loader: "function", model: "id", workspace: "text(16)" });
    vi.stubGlobal("window", { top: page, modelId: 7 });
    expect(probeFrame()).toMatchObject({ top: false, loader: "undefined", model: "number", workspace: "undefined" });

    for (const [index, id] of SCOPE_IDS.entries()) {
      vi.stubGlobal("window", { modelId: id, workspaceId: SCOPE_IDS[(index + 1) % SCOPE_IDS.length] });
      expect(probeFrame(), id).toMatchObject({ model: "id", workspace: "id" });
    }
    for (const id of NOT_SCOPE_IDS) {
      vi.stubGlobal("window", { modelId: id, workspaceId: id });
      expect(probeFrame(), JSON.stringify(id)).toMatchObject({ model: `text(${id.length})`, workspace: `text(${id.length})` });
    }
  });

  it("stamps every status and log line of the core frame's diagnostics with its time", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.UTC(2026, 8, 28, 1, 59, 9)));
    const shell = new FakeWindow("https://us1a.app.anaplan.com");
    const core = new FakeWindow("https://eu2a.app.anaplan.com");
    let found: CoreHandle | undefined;
    watchCore(shell, handle => { found = handle; });
    let diagnostic = "";
    const stop = serveCore(core, shell.seenBy(core), () => MODEL, async (progress, diagnostics) => {
      progress.status("Reading Line Items…");
      vi.setSystemTime(new Date(Date.UTC(2026, 8, 28, 13, 0, 59, 999)));
      progress.log("Line Items: 3 rows × 2 columns");
      diagnostic = diagnostics();
      return { zip: new Uint8Array(), fileName: "x", summary: [] };
    }, 5);
    await settle();
    await runInCore(shell, found!, collect().progress);
    expect(diagnostic).toBe("01:59:09 Reading Line Items…\r\n13:00:59 Line Items: 3 rows × 2 columns");
    stop();
  });
});
