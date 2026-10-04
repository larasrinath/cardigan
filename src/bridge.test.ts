import { afterEach, describe, expect, it, vi } from "vitest";
import { describeProbe, exportInCore, probeFrame, PROTOCOL, runInCore, serveCore, watchCore, watchProbes, type CoreHandle, type Endpoint, type FrameProbe } from "./bridge.js";
import { NOT_SCOPE_IDS, SCOPE_IDS } from "./guards.test-support.js";
import type { Progress } from "./progress.js";
import type { AnalysisResult, Cell } from "./result-types.js";

/** Two windows that talk like browser windows: posting to a window as another window holds it delivers a cloned message
 * there, from that other window's origin, with `source` set to the sender as the receiver holds it. A window can also hold
 * itself: the classic model page opened on its own has both sides of the bridge in one window. */
class FakeWindow {
  private readonly listeners = new Set<(event: MessageEvent) => void>();
  private readonly handles = new Map<FakeWindow, Endpoint>();
  /** The windows inside this one, as this window holds them (greetFrames). */
  frames: Endpoint[] = [];
  constructor(readonly origin: string) {}
  addEventListener(_type: "message", listener: (event: MessageEvent) => void) { this.listeners.add(listener); }
  removeEventListener(_type: "message", listener: (event: MessageEvent) => void) { this.listeners.delete(listener); }
  /** Delivers a message as the browser would, whoever it claims to come from. */
  receive(data: unknown, origin: string, source: unknown) {
    const event = { data: structuredClone(data), origin, source } as unknown as MessageEvent;
    queueMicrotask(() => { for (const listener of [...this.listeners]) listener(event); });
  }
  seenBy(other: FakeWindow): Endpoint {
    let handle = this.handles.get(other);
    if (!handle) {
      handle = {
        postMessage: (message: unknown, targetOrigin: string) => {
          if (targetOrigin !== "*" && targetOrigin !== this.origin) return; // browsers drop a message for another origin
          this.receive(message, other.origin, other.seenBy(this));
        },
      };
      this.handles.set(other, handle);
    }
    return handle;
  }
}

const MODEL = "FEDCBA9876543210FEDCBA9876543210";
const [SHELL, CORE] = ["https://us1a.app.anaplan.com", "https://eu2a.app.anaplan.com"];
const UNREADABLE = "The model frame sent a result this page cannot read.";
const settle = () => new Promise(resolve => setTimeout(resolve, 5));
const collect = () => {
  const lines: string[] = [];
  const progress: Progress = { status: text => lines.push(`status: ${text}`), log: line => lines.push(`log: ${line}`) };
  return { lines, progress };
};
/** A model export's result: Model Details.csv and one grid. */
const exported = (rows: Cell[][] = [["Revenue", "=Units * Price"], ["Units", ""]]): AnalysisResult => ({
  kind: "model", name: "Model one", id: MODEL, zipName: "Model one - Model Export - 2026-09-28.zip", summary: ["Line Items: 2 rows"],
  tables: [{ file: "Model Details.csv", label: "Model Details", headers: ["Section", "Detail", "Value"], rows: [["Model", "Model", "Model one"]], guard: true, details: true },
    { file: "Line Items.csv", label: "Line Items", headers: ["", "Formula"], rows, guard: false }] });
/** A shell page and a core frame that has announced itself to it. */
async function connected(exporter: (progress: Progress, diagnostics: () => string) => Promise<AnalysisResult>) {
  const shell = new FakeWindow(SHELL);
  const core = new FakeWindow(CORE);
  let found: CoreHandle | undefined;
  watchCore(shell, handle => { found = handle; });
  const stop = serveCore(core, shell.seenBy(core), () => MODEL, exporter, 5);
  await settle();
  return { shell, core, handle: found!, stop };
}
/** An export that reports each step it is given and waits before the next, so a test decides how far it gets. */
function stepped() {
  const steps: (() => void)[] = [];
  const reached: string[] = [];
  let runs = 0;
  let failure: unknown;
  const exporter = async (progress: Progress): Promise<AnalysisResult> => {
    runs++;
    try {
      for (const step of ["Reading Line Items…", "Reading Modules…", "Reading Versions…"]) {
        progress.status(step);
        reached.push(step);
        await new Promise<void>(resolve => { steps.push(resolve); });
      }
    } catch (error) { failure = error; throw error; }
    return exported();
  };
  /** Lets the export take its next step. */
  const next = async () => { steps.shift()?.(); await settle(); };
  return { exporter, next, reached, runs: () => runs, failure: () => failure };
}

describe("Model export bridge between the Model Building page and the model's core frame", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

  it("shows the core frame to the page, runs the export there and brings the result back", async () => {
    let runs = 0;
    const sent = exported();
    const { shell, handle, stop } = await connected(async (progress, diagnostics) => {
      runs++;
      progress.status("Reading Line Items…");
      progress.log("Line Items: 3 rows × 2 columns");
      expect(diagnostics()).toContain("Line Items: 3 rows × 2 columns");
      return sent;
    });
    expect(handle).toMatchObject({ origin: CORE, modelId: MODEL });

    const { lines, progress } = collect();
    const result = await runInCore(shell, handle, progress);
    expect(runs).toBe(1);
    // Every file of the export, as tables: a copy of what the core frame made, not the same object.
    expect(result).toEqual(exported());
    expect(result).not.toBe(sent);
    expect(result.zipName).toBe("Model one - Model Export - 2026-09-28.zip");
    expect(result.tables.map(table => [table.file, table.guard, table.details, table.rows])).toEqual([
      ["Model Details.csv", true, true, [["Model", "Model", "Model one"]]], ["Line Items.csv", false, undefined, [["Revenue", "=Units * Price"], ["Units", ""]]]]);
    expect(result.summary).toEqual(["Line Items: 2 rows"]);
    expect(lines).toEqual(["status: Reading Line Items…", "log: Line Items: 3 rows × 2 columns"]);
    stop();
  });

  it("ignores other origins and other windows, and gives up on a frame that stops answering", async () => {
    const shell = new FakeWindow(SHELL);
    const stranger = new FakeWindow("https://evil.example.com");
    let found: CoreHandle | undefined;
    watchCore(shell, handle => { found = handle; });
    shell.seenBy(stranger).postMessage({ protocol: PROTOCOL, type: "core-ready", modelId: MODEL }, "*");
    await settle();
    expect(found).toBeUndefined();

    // A core frame runs only what its own top window asks for.
    const core = new FakeWindow(CORE);
    const sibling = new FakeWindow(SHELL);
    let runs = 0;
    const stop = serveCore(core, shell.seenBy(core), () => MODEL, async () => { runs++; return exported(); }, 5);
    core.seenBy(sibling).postMessage({ protocol: PROTOCOL, type: "run", nonce: "n" }, "*");
    await settle();
    expect(runs).toBe(0);
    stop();

    // A frame that stops answering is given up on, and told to stop: whatever it still reads for this run is for nobody.
    const asked: { type: string; nonce: string }[] = [];
    const silent: CoreHandle = { source: { postMessage: message => { asked.push(message as { type: string; nonce: string }); } }, origin: CORE, modelId: MODEL };
    await expect(runInCore(shell, silent, collect().progress, 20)).rejects.toThrow("The model frame stopped answering.");
    expect(asked.map(message => [message.type, message.nonce === asked[0].nonce])).toEqual([["run", true], ["stop", true]]);
  });

  it("takes progress and the result only from the frame it asked, from that frame's origin and for its own run", async () => {
    const shell = new FakeWindow(SHELL);
    const sibling = new FakeWindow(CORE);
    // A core frame that only records what it is asked, so the test answers in its place.
    const asked: { type: string; nonce: string }[] = [];
    const source: Endpoint = { postMessage: message => { asked.push(message as { type: string; nonce: string }); } };
    const { lines, progress } = collect();
    let outcome: unknown = "waiting";
    runInCore(shell, { source, origin: CORE, modelId: MODEL }, progress).then(result => { outcome = result; }, error => { outcome = error; });
    expect(asked.map(message => message.type)).toEqual(["run"]);
    const { nonce } = asked[0];
    const done = { protocol: PROTOCOL, type: "done", nonce, result: exported() };

    shell.receive(done, CORE, shell.seenBy(sibling));                                        // another window, the right origin and run
    shell.receive(done, "https://evil.example.com", source);                                // the frame, from an origin that is not Anaplan's
    shell.receive(done, SHELL, source);                                                     // the frame, from another Anaplan origin than it announced
    shell.receive({ ...done, nonce: "another-run" }, CORE, source);                         // the frame, for a run this page did not ask for
    shell.receive({ ...done, protocol: "another-protocol" }, CORE, source);
    shell.receive({ protocol: PROTOCOL, type: "status", nonce, text: "forged" }, CORE, shell.seenBy(sibling));
    await settle();
    expect([outcome, lines]).toEqual(["waiting", []]);

    shell.receive({ protocol: PROTOCOL, type: "status", nonce, text: "Reading Versions…" }, CORE, source);
    shell.receive(done, CORE, source);
    await settle();
    expect(outcome).toEqual(exported());
    expect(lines).toEqual(["status: Reading Versions…"]);
  });

  it("checks every field of the result before use: only a model's files, with file names that are no path", async () => {
    const answers = async (result: unknown) => {
      const shell = new FakeWindow(SHELL);
      const asked: { nonce: string }[] = [];
      const source: Endpoint = { postMessage: message => { asked.push(message as { nonce: string }); } };
      const run = runInCore(shell, { source, origin: CORE, modelId: MODEL }, collect().progress);
      shell.receive({ protocol: PROTOCOL, type: "done", nonce: asked[0].nonce, result }, CORE, source);
      return run;
    };
    const table = exported().tables[1];
    /** A list whose first entry is a hole, which a message between windows keeps. */
    const missing = (value: unknown) => { const list: unknown[] = []; list[1] = value; return list; };
    for (const [why, result] of [
      ["no result", undefined], ["a zip, as 0.6.1 sent", { zip: new ArrayBuffer(4), fileName: "x.zip", summary: [] }], ["text", "result"], ["null", null],
      ["an app's result", { ...exported(), kind: "app" }], ["no kind", { ...exported(), kind: undefined }], ["no name", { ...exported(), name: 7 }],
      ["no ID", { ...exported(), id: undefined }], ["no summary", { ...exported(), summary: "Line Items: 2 rows" }], ["no tables", { ...exported(), tables: {} }],
      ["a zip name that is a path", { ...exported(), zipName: "../Model one.zip" }], ["a zip name that is no zip", { ...exported(), zipName: "Model one.exe" }],
      ["a zip name that is only its extension", { ...exported(), zipName: ".zip" }],
      ["a file name that is a path", { ...exported(), tables: [{ ...table, file: "..\\Line Items.csv" }] }],
      ["a file name with a drive", { ...exported(), tables: [{ ...table, file: "C:Line Items.csv" }] }],
      ["a file name with a line break", { ...exported(), tables: [{ ...table, file: "Line\nItems.csv" }] }],
      ["a file that is no CSV", { ...exported(), tables: [{ ...table, file: "Line Items.html" }] }],
      ["a table without a label", { ...exported(), tables: [{ ...table, label: undefined }] }],
      ["a table without a guard setting", { ...exported(), tables: [{ ...table, guard: "false" }] }],
      ["headers that are no list", { ...exported(), tables: [{ ...table, headers: "Formula" }] }],
      ["rows that are no list", { ...exported(), tables: [{ ...table, rows: "Revenue" }] }],
      ["a row that is no list", { ...exported(), tables: [{ ...table, rows: [["Revenue", ""], "Units"] }] }],
      ["a row that is missing", { ...exported(), tables: [{ ...table, rows: missing(["Units", ""]) }] }],
      ["a table that is nothing", { ...exported(), tables: [null] }], ["a table that is missing", { ...exported(), tables: missing(table) }],
    ] as const) {
      await expect(answers(result), why).rejects.toThrow(UNREADABLE);
    }
    // What is kept is the contract's fields and nothing else, with every cell as text or a finite number.
    const odd = { ...exported([["Revenue", undefined as never], [null as never, NaN], [true as never, 12]]), extra: "dropped",
      tables: exported([["Revenue", undefined as never], [null as never, NaN], [true as never, 12]]).tables.map(entry => ({ ...entry, extra: "dropped", details: entry.details ?? "yes" })) };
    const kept = await answers(odd);
    expect(kept).toEqual(exported([["Revenue", ""], ["", "NaN"], ["true", 12]]));
    expect(JSON.stringify(kept)).not.toContain("dropped");
  });

  it("is never left waiting by a message it cannot make text of: an object without a usable toString is written as any object is", async () => {
    const textless = { toString: 1, valueOf: 1 };
    const asking = () => {
      const shell = new FakeWindow(SHELL);
      const asked: { nonce: string }[] = [];
      const source: Endpoint = { postMessage: message => { asked.push(message as { nonce: string }); } };
      const { lines, progress } = collect();
      // Half a second without a readable answer would be the frame "not answering": no run here takes that long.
      const run = runInCore(shell, { source, origin: CORE, modelId: MODEL }, progress, 500);
      const hears = (message: Record<string, unknown>) => shell.receive({ protocol: PROTOCOL, nonce: asked[0].nonce, ...message }, CORE, source);
      return { run, hears, lines };
    };
    // In a step, a log line, a cell, a header and a summary line.
    const { run, hears, lines } = asking();
    hears({ type: "status", text: textless });
    hears({ type: "log", text: textless });
    hears({ type: "done", result: { ...exported(), summary: [textless], tables: [{ ...exported().tables[1], headers: ["", textless], rows: [["Revenue", textless]] }] } });
    await expect(run).resolves.toEqual({ ...exported(), summary: ["[object Object]"],
      tables: [{ ...exported().tables[1], headers: ["", "[object Object]"], rows: [["Revenue", "[object Object]"]] }] });
    expect(lines).toEqual(["status: [object Object]", "log: [object Object]"]);
    // In the reason an export failed.
    const failed = asking();
    failed.hears({ type: "error", message: textless });
    await expect(failed.run).rejects.toThrow("[object Object]");
  });

  it("checks in again when the page greets it, and reports what each frame sees", async () => {
    const shell = new FakeWindow(SHELL);
    const core = new FakeWindow(CORE);
    const readies: string[] = [];
    shell.addEventListener("message", event => { const data = event.data as { type?: string }; if (data.type === "core-ready") readies.push(data.type); });
    watchCore(shell, () => undefined);
    const stop = serveCore(core, shell.seenBy(core), () => MODEL, async () => exported(), 5);
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
    const shell = new FakeWindow(SHELL);
    const core = new FakeWindow(CORE);
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
    const shell = new FakeWindow(SHELL);
    const core = new FakeWindow(CORE);
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
    let diagnostic = "";
    const { shell, handle, stop } = await connected(async (progress, diagnostics) => {
      progress.status("Reading Line Items…");
      vi.setSystemTime(new Date(Date.UTC(2026, 8, 28, 13, 0, 59, 999)));
      progress.log("Line Items: 3 rows × 2 columns");
      diagnostic = diagnostics();
      return exported();
    });
    await runInCore(shell, handle, collect().progress);
    expect(diagnostic).toBe("01:59:09 Reading Line Items…\r\n13:00:59 Line Items: 3 rows × 2 columns");
    stop();
  });

  it("stops the export at its next step when the run is stopped, and only for the page that asked", async () => {
    const { exporter, next, reached, runs, failure } = stepped();
    const { shell, core, handle, stop } = await connected(exporter);
    const sibling = new FakeWindow(SHELL);
    const stopping = new AbortController();
    const { lines, progress } = collect();
    const run = runInCore(shell, handle, progress, undefined, stopping.signal);
    await settle();
    expect(reached).toEqual(["Reading Line Items…"]);

    // Neither another window nor another run's "stop" ends this export.
    core.seenBy(sibling).postMessage({ protocol: PROTOCOL, type: "stop", nonce: "n" }, "*");
    core.seenBy(shell).postMessage({ protocol: PROTOCOL, type: "stop", nonce: "another-run" }, "*");
    await next();
    expect(reached).toEqual(["Reading Line Items…", "Reading Modules…"]);

    stopping.abort(new Error("Stopped: the results page was closed."));
    await expect(run).rejects.toThrow("Stopped: the results page was closed.");
    // The frame reads nothing further: its next step is refused, and the page hears no more of it.
    await next();
    expect(reached).toEqual(["Reading Line Items…", "Reading Modules…"]);
    expect(failure()).toEqual(new Error("The export was stopped."));
    expect(lines).toEqual(["status: Reading Line Items…", "status: Reading Modules…"]);

    // The frame is free again: the next run starts a new export.
    const again = runInCore(shell, handle, collect().progress);
    await settle();
    expect(runs()).toBe(2);
    await next(); await next(); await next();
    await expect(again).resolves.toEqual(exported());
    stop();
  });

  it("stops the export of a frame it gave up on, which is then free for the next run", async () => {
    const { exporter, next, reached, runs, failure } = stepped();
    const { shell, handle, stop } = await connected(exporter);
    // The export reports its first step and then nothing for longer than the page waits.
    await expect(runInCore(shell, handle, collect().progress, 30)).rejects.toThrow("The model frame stopped answering.");
    await next();
    expect([reached, failure()]).toEqual([["Reading Line Items…"], new Error("The export was stopped.")]);
    const again = runInCore(shell, handle, collect().progress);
    await settle();
    expect(runs()).toBe(2);
    await next(); await next(); await next();
    await expect(again).resolves.toEqual(exported());
    stop();
  });

  it("gives the export a check to make before each read, which refuses once the run was stopped unless a new run has taken the export over", async () => {
    // An export that reads one grid window by window, with no step in between that could end it.
    const waits: (() => void)[] = [];
    const windows: number[][] = [];
    let failure: unknown;
    const { shell, handle, stop } = await connected(async (progress, _diagnostics, check) => {
      const read: number[] = [];
      windows.push(read);
      progress.status("Reading Line Items…");
      try {
        for (let window = 0; window < 4; window++) {
          check.throwIfAborted();
          read.push(window);
          await new Promise<void>(resolve => { waits.push(resolve); });
        }
      } catch (error) { failure = error; throw error; }
      return exported();
    });
    const next = async () => { waits.shift()?.(); await settle(); };

    const stopping = new AbortController();
    const run = runInCore(shell, handle, collect().progress, undefined, stopping.signal);
    await settle();
    await next();
    // Stopped while the second window is read: that read is let finish, and it is the last.
    stopping.abort(new Error("Stopped: the results page was closed."));
    await expect(run).rejects.toThrow("Stopped: the results page was closed.");
    await next();
    expect([windows, failure]).toEqual([[[0, 1]], new Error("The export was stopped.")]);

    // A run that asks before the stopped export's next read takes it over: the check lets it read on to the end.
    const first = runInCore(shell, handle, collect().progress, undefined, stopping.signal);
    await expect(first).rejects.toThrow("Stopped: the results page was closed.");
    const second = runInCore(shell, handle, collect().progress);
    await settle();
    await next(); await next(); await next(); await next();
    await expect(second).resolves.toEqual(exported());
    expect(windows).toEqual([[0, 1], [0, 1, 2, 3]]);
    stop();
  });

  it("does not start a run that was stopped before it began", async () => {
    const { exporter, runs } = stepped();
    const { shell, handle, stop } = await connected(exporter);
    const stopping = new AbortController();
    stopping.abort(new Error("Stopped: the results page was closed."));
    await expect(runInCore(shell, handle, collect().progress, undefined, stopping.signal)).rejects.toThrow("Stopped: the results page was closed.");
    await settle();
    expect(runs()).toBe(0);
    stop();
  });

  it("never runs two exports at once: a run asked before a stopped export's next step takes that export over", async () => {
    const { exporter, next, reached, runs } = stepped();
    const { shell, handle, stop } = await connected(exporter);
    const stopping = new AbortController();
    const first = runInCore(shell, handle, collect().progress, undefined, stopping.signal);
    await settle();

    // A second run while the first is going is not started, and is given nothing.
    const { lines: ignored, progress: unheard } = collect();
    runInCore(shell, handle, unheard, 60).catch(() => undefined);
    await settle();
    expect([runs(), ignored]).toEqual([1, []]);

    stopping.abort(new Error("Stopped: the results page was closed."));
    await expect(first).rejects.toThrow("Stopped: the results page was closed.");
    const { lines, progress } = collect();
    const second = runInCore(shell, handle, progress);
    await settle();
    await next(); await next(); await next();
    await expect(second).resolves.toEqual(exported());
    // One export, carried on from where it was: the new page sees the steps from then on.
    expect(runs()).toBe(1);
    expect(reached).toEqual(["Reading Line Items…", "Reading Modules…", "Reading Versions…"]);
    expect(lines).toEqual(["status: Reading Modules…", "status: Reading Versions…"]);
    stop();
  });

  it("serves the classic model page opened on its own, where both sides are the same window", async () => {
    const page = new FakeWindow(CORE);
    const itself = page.seenBy(page);
    let found: CoreHandle | undefined;
    let announcements = 0;
    page.addEventListener("message", event => { if ((event.data as { type?: string }).type === "core-ready") announcements++; });
    watchCore(page, handle => { found = handle; });
    let runs = 0;
    const stop = serveCore(page, itself, () => MODEL, async progress => { runs++; progress.status("Reading Versions…"); return exported(); }, 5);
    await settle();
    expect(found).toEqual({ source: itself, origin: CORE, modelId: MODEL });
    // Acknowledged like a frame: the announcements stop.
    await settle();
    const seen = announcements;
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(announcements).toBe(seen);

    // Each side also hears what it sends itself; neither takes its own message for the other's.
    const { lines, progress } = collect();
    await expect(runInCore(page, found!, progress)).resolves.toEqual(exported());
    expect([runs, lines]).toEqual([1, ["status: Reading Versions…"]]);
    stop();
  });

  it("waits for the model's frame to check in, greeting every frame, then exports there", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const shell = new FakeWindow(SHELL);
    const greeted: unknown[] = [];
    shell.frames = [{ postMessage: message => { greeted.push(message); } }];
    Object.assign(shell.frames[0], { frames: [] });
    const asked: { type: string; nonce: string }[] = [];
    const source: Endpoint = { postMessage: message => { asked.push(message as { type: string; nonce: string }); } };
    let core: CoreHandle | undefined;
    const probe: FrameProbe = { host: "eu2a.app.anaplan.com", path: "/core-webapp-<id>/anaplan/framework.jsp", top: false, loader: "function", model: "id", workspace: "id" };
    const { lines, progress } = collect();
    const run = exportInCore(shell as unknown as Window, () => core, () => [probe], MODEL.toLowerCase(), progress);
    await vi.advanceTimersByTimeAsync(2500);
    // Asked three times, a second apart, and nothing run yet.
    expect(greeted).toEqual(Array(3).fill({ protocol: PROTOCOL, type: "hello" }));
    expect(asked).toEqual([]);

    core = { source, origin: CORE, modelId: MODEL };
    await vi.advanceTimersByTimeAsync(1000);
    expect(asked.map(message => message.type)).toEqual(["run"]);
    shell.receive({ protocol: PROTOCOL, type: "done", nonce: asked[0].nonce, result: exported() }, CORE, source);
    await expect(run).resolves.toEqual(exported());
    // The same model in another case is the same model: nothing is logged about it.
    expect(lines).toEqual([...Array(3).fill("status: Waiting for the model's frame…"),
      "log: frame eu2a.app.anaplan.com/core-webapp-<id>/anaplan/framework.jsp: loader=function model=id workspace=id"]);
  });

  it("says what reported in when no frame holds the model, and when the frame holds another model than the address names", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const shell = new FakeWindow(SHELL) as unknown as Window;
    const probe: FrameProbe = { host: "us1a.app.anaplan.com", path: "/a/modeling/", top: true, loader: "undefined", model: "undefined", workspace: "undefined" };
    const failing = (probes: FrameProbe[]) => {
      const { lines, progress } = collect();
      const outcome = exportInCore(shell, () => undefined, () => probes, MODEL, progress).then(() => "exported", (error: Error) => error.message);
      return { lines, outcome };
    };
    const nothing = failing([]);
    const something = failing([probe]);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(await nothing.outcome).toBe("No frame reported in. Reload the extension in chrome://extensions, refresh the Anaplan tab and try again.");
    expect(await something.outcome).toBe("The model's frame did not answer. 1 frame(s) reported; copy the diagnostic log and send it.");
    expect(nothing.lines).toEqual(Array(20).fill("status: Waiting for the model's frame…"));
    expect(something.lines.at(-1)).toBe("log: page us1a.app.anaplan.com/a/modeling/: loader=undefined model=undefined workspace=undefined");

    // A frame that is there at once is asked at once; a different model than the address names is noted, and still exported.
    const asked: { nonce: string }[] = [];
    const source: Endpoint = { postMessage: message => { asked.push(message as { nonce: string }); } };
    const { lines, progress } = collect();
    const run = exportInCore(shell, () => ({ source, origin: CORE, modelId: SCOPE_IDS[0] }), () => [], MODEL, progress);
    await vi.advanceTimersByTimeAsync(0);
    (shell as unknown as FakeWindow).receive({ protocol: PROTOCOL, type: "done", nonce: asked[0].nonce, result: exported() }, CORE, source);
    await expect(run).resolves.toEqual(exported());
    expect(lines).toEqual(["log: the model frame reports a different model than this page's address"]);
  });

  it("stops waiting for the model's frame when the run is stopped", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const shell = new FakeWindow(SHELL) as unknown as Window;
    const stopping = new AbortController();
    const { lines, progress } = collect();
    const outcome = exportInCore(shell, () => undefined, () => [], MODEL, progress, stopping.signal).then(() => "exported", (error: Error) => error.message);
    await vi.advanceTimersByTimeAsync(1500);
    stopping.abort(new Error("Stopped: the results page was closed."));
    await vi.advanceTimersByTimeAsync(1000);
    expect(await outcome).toBe("Stopped: the results page was closed.");
    expect(lines).toEqual(Array(2).fill("status: Waiting for the model's frame…"));
  });
});
