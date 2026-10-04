import { afterEach, describe, expect, it, vi } from "vitest";
import { describeProbe, exportInCore, NO_MODEL, probeFrame, PROTOCOL, QUIET, runInCore, serveCore, UNREADABLE, watchCore, watchProbes, type CoreHandle, type Endpoint,
  type FrameProbe } from "./bridge.js";
import { NOT_SCOPE_IDS, SCOPE_IDS } from "./guards.test-support.js";
import { readGrid, type Native } from "./model/native.js";
import { Failure, UNEXPECTED, type Progress, type Stop } from "./progress.js";
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
/** How a failed run ended: the sentence the results page shows and the detail the diagnostic log keeps (progress.ts `Failure`). */
const failedWith = (error: unknown) => (error instanceof Failure ? [error.message, error.detail] : error);
const failed = (run: Promise<unknown>) => run.then(() => "not failed", failedWith);
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
async function connected(exporter: (progress: Progress, diagnostics: () => string, stop: Stop) => Promise<AnalysisResult>) {
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
    // Nor a run that names no run ID: its progress and its result could not be told from another run's.
    for (const nonce of [undefined, null, 7, {}, ["n"]]) core.seenBy(shell).postMessage({ protocol: PROTOCOL, type: "run", nonce }, "*");
    await settle();
    expect(runs).toBe(0);
    core.seenBy(shell).postMessage({ protocol: PROTOCOL, type: "run", nonce: "n" }, "*");
    await settle();
    expect(runs).toBe(1);
    stop();

    // A frame that stops answering is given up on, and told to stop: whatever it still reads for this run is for nobody.
    const asked: { type: string; nonce: string }[] = [];
    const silent: CoreHandle = { source: { postMessage: message => { asked.push(message as { type: string; nonce: string }); } }, origin: CORE, modelId: MODEL };
    expect(await failed(runInCore(shell, silent, collect().progress, 20))).toEqual([QUIET, "the model's frame sent nothing for 0.02 s"]);
    expect(asked.map(message => [message.type, message.nonce === asked[0].nonce])).toEqual([["run", true], ["stop", true]]);
  });

  it("says in plain words why the page could not get the model exported, and keeps the count and the cause for the log", () => {
    // Each says what happened and what to do next; the last sentence names the button beside the diagnostic log.
    expect(NO_MODEL).toBe("Cardigan could not reach the model inside this page. If the model is still opening, wait until it shows and choose Run again; "
      + "otherwise refresh the Anaplan tab, then click the Cardigan icon again. If it keeps happening, choose Copy diagnostic log and send the log.");
    expect(QUIET).toBe("The model stopped answering while Cardigan was reading it. Check that it is still open in the Anaplan tab, then choose Run again.");
    expect(UNREADABLE).toBe("Cardigan could not read what the model's page sent back. Refresh the Anaplan tab, then click the Cardigan icon again. "
      + "If it keeps happening, choose Copy diagnostic log and send the log.");
    expect(UNEXPECTED).toBe("Cardigan ran into a problem it did not expect. Choose Run again. If it keeps happening, choose Copy diagnostic log and send the log.");
    // No number, code or word a developer would use is left in them.
    for (const message of [NO_MODEL, QUIET, UNREADABLE, UNEXPECTED]) expect(message).not.toMatch(/\d|frame|HTTP|chrome:|extension/i);
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

  it("posts everything about a model to one origin only: the frame's as it announced itself, and the page's that asked", async () => {
    /** A window that only records what is posted to it, and to which origin. */
    const posts: [type: string, targetOrigin: string][] = [];
    const recording: Endpoint = { postMessage: (message, targetOrigin) => { posts.push([(message as { type: string }).type, targetOrigin]); } };

    // The page: the acknowledgement, the run with its ID and the stop go to the origin the frame announced itself from.
    const shell = new FakeWindow(SHELL);
    watchCore(shell, () => undefined);
    shell.receive({ protocol: PROTOCOL, type: "core-ready", modelId: MODEL }, CORE, recording);
    await settle();
    const stopping = new AbortController();
    const run = runInCore(shell, { source: recording, origin: CORE, modelId: MODEL }, collect().progress, 20, stopping.signal);
    stopping.abort(new Error("Stopped: the results page was closed."));
    await expect(run).rejects.toThrow("Stopped: the results page was closed.");
    // So does the stop for a frame that went quiet.
    await expect(runInCore(shell, { source: recording, origin: CORE, modelId: MODEL }, collect().progress, 20)).rejects.toThrow(QUIET);
    expect(posts).toEqual([["ack", CORE], ["run", CORE], ["stop", CORE], ["run", CORE], ["stop", CORE]]);

    // The frame: its steps, its log, its sign of life before a read, the result and a failure go to the origin that asked,
    // and to no other.
    posts.length = 0;
    const core = new FakeWindow(CORE);
    const exports: (() => AnalysisResult)[] = [exported, () => { throw new Failure("The model has not finished opening in the Anaplan tab."); }];
    const stop = serveCore(core, recording, () => MODEL, async (progress, _diagnostics, check) => {
      progress.status("Reading Versions…");
      check.throwIfAborted();
      progress.log("Versions: 2 rows");
      return exports.shift()!();
    }, 60_000);
    core.receive({ protocol: PROTOCOL, type: "run", nonce: "first" }, SHELL, recording);
    await settle();
    core.receive({ protocol: PROTOCOL, type: "run", nonce: "second" }, SHELL, recording);
    await settle();
    stop();
    // Only the announcement goes to whoever is on top, as it always has: it carries the model's ID and nothing of the model.
    expect(posts).toEqual([["core-ready", "*"], ["status", SHELL], ["alive", SHELL], ["log", SHELL], ["done", SHELL],
      ["status", SHELL], ["alive", SHELL], ["log", SHELL], ["error", SHELL]]);
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
      expect(await failed(answers(result)), why).toEqual([UNREADABLE, "the model's frame sent a result this page cannot read"]);
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
    // An error whose message is no text, or none at all, is not shown as it is: what there is of it goes to the log.
    for (const [sent, detail] of [[{ message: textless }, "[object Object]"], [{ message: "" }, ""], [{}, "undefined"], [{ message: 7, detail: textless }, "[object Object]"]] as const) {
      const unreadable = asking();
      unreadable.hears({ type: "error", ...sent });
      expect(await failed(unreadable.run), JSON.stringify(sent)).toEqual([UNEXPECTED, detail]);
    }
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
    // The export fails as a run tells its user (a sentence, and the detail for the log), then with an error of another kind.
    const failures: unknown[] = [new Failure("Cardigan could not read any of this model's settings.", "Line Items: not exported (This model page has no MODULE_WITH_LINE_ITEM axis.)."),
      new Failure("The model has not finished opening in the Anaplan tab."), new TypeError("Cannot read properties of undefined (reading 'getModelName')"), "plain text"];
    const stop = serveCore(core, shell.seenBy(core), () => MODEL, async () => { throw failures.shift(); }, 5);
    await settle();
    await settle();
    const seen = announcements;
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(announcements).toBe(seen);
    // The sentence and its detail cross to the page as they are; an error not written for the user is told as unexpected.
    expect(await failed(runInCore(shell, found!, collect().progress)))
      .toEqual(["Cardigan could not read any of this model's settings.", "Line Items: not exported (This model page has no MODULE_WITH_LINE_ITEM axis.)."]);
    expect(await failed(runInCore(shell, found!, collect().progress))).toEqual(["The model has not finished opening in the Anaplan tab.", undefined]);
    expect(await failed(runInCore(shell, found!, collect().progress))).toEqual([UNEXPECTED, "Cannot read properties of undefined (reading 'getModelName')"]);
    expect(await failed(runInCore(shell, found!, collect().progress))).toEqual([UNEXPECTED, "plain text"]);
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
    expect(await failed(runInCore(shell, handle, collect().progress, 30))).toEqual([QUIET, "the model's frame sent nothing for 0.03 s"]);
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

  it("does not let a run asked while another is going take the export from it", async () => {
    const { exporter, next, runs } = stepped();
    const { shell, handle, stop } = await connected(exporter);
    // Should the first run ever stop hearing of its export, it gives up after half a second instead of five minutes.
    const first = collect();
    const going = runInCore(shell, handle, first.progress, 500);
    await settle();
    const second = collect();
    runInCore(shell, handle, second.progress, 500).catch(() => undefined);
    await settle();
    await next(); await next(); await next();
    // The first run hears every step and gets the result; the second, which was never started, hears nothing.
    await expect(going).resolves.toEqual(exported());
    expect([runs(), first.lines, second.lines]).toEqual([1, ["status: Reading Line Items…", "status: Reading Modules…", "status: Reading Versions…"], []]);
    stop();
  });

  it("gives up on a frame only when it has sent nothing for the idle time: every message from it starts the wait again", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const shell = new FakeWindow(SHELL);
    const asked: { type: string; nonce: string }[] = [];
    const source: Endpoint = { postMessage: message => { asked.push(message as { type: string; nonce: string }); } };
    const { lines, progress } = collect();
    let outcome: unknown = "waiting";
    runInCore(shell, { source, origin: CORE, modelId: MODEL }, progress, 1000).then(result => { outcome = result; }, error => { outcome = failedWith(error); });
    const { nonce } = asked[0];
    // A step, a log line and the sign of life the frame gives before each page of a grid, each 900 ms after the one before:
    // 2.7 s in all.
    for (const message of [{ type: "status", text: "Reading Line Items…" }, { type: "log", text: "Line Items: 3 rows × 2 columns" }, { type: "alive" }]) {
      await vi.advanceTimersByTimeAsync(900);
      shell.receive({ protocol: PROTOCOL, nonce, ...message }, CORE, source);
      await vi.advanceTimersByTimeAsync(0);
    }
    await vi.advanceTimersByTimeAsync(999);
    // The sign of life is no step and no line of the log: it only starts the wait again.
    expect([outcome, lines]).toEqual(["waiting", ["status: Reading Line Items…", "log: Line Items: 3 rows × 2 columns"]]);
    // One that is not this run's, or not from the frame that was asked, at the origin it announced, does not count.
    const sibling = new FakeWindow(CORE);
    shell.receive({ protocol: PROTOCOL, nonce: "another-run", type: "alive" }, CORE, source);
    shell.receive({ protocol: PROTOCOL, type: "alive" }, CORE, source);
    shell.receive({ protocol: PROTOCOL, nonce, type: "alive" }, CORE, shell.seenBy(sibling));
    shell.receive({ protocol: PROTOCOL, nonce, type: "alive" }, SHELL, source);
    shell.receive({ protocol: PROTOCOL, nonce, type: "alive" }, "https://evil.example.com", source);
    shell.receive({ protocol: "another-protocol", nonce, type: "alive" }, CORE, source);
    await vi.advanceTimersByTimeAsync(1);
    expect(outcome).toEqual([QUIET, "the model's frame sent nothing for 1 s"]);
  });

  it("does not give up on a frame while it reads a grid of many pages, each within the idle time: before each page the frame says it is still there", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
    vi.setSystemTime(new Date(Date.UTC(2026, 8, 28, 1, 59, 9)));
    // A model page's client with one grid, 60 rows of 3 columns, that takes a minute to answer each read.
    const reads: string[] = [];
    let answers = true;
    const client = { cache: { getAllCurrenciesLabelPage: () => undefined }, ids: {}, constants: {}, axisHelper: {}, workspaceId: "w".repeat(32), modelId: MODEL,
      helper: { getAxesForViewDefinition: (rows: string[], columns: string[]) => ({ rowAxis: rows[0], columnAxis: columns[0] }) },
      RequestGenerator: class { getRequest(params: unknown) { return { requestType: "VIEW_REQUEST_SET", submissions: [], systemActions: [], params }; } },
      DataPage: class { contains() { return true; } getIndex() { return 0; } getCellText() { return "Units * Price"; } getOriginalText() { return "Units * Price"; } },
      aggregator: { isDirty: () => false, post: (request: { params: { pageRequests: { startRow: number; rowCount: number }[] } }, _flag: boolean, ok: (response: unknown) => boolean) => {
        const { startRow, rowCount } = request.params.pageRequests[0];
        reads.push(`${startRow}+${rowCount}`);
        const ids = Array.from({ length: rowCount }, (_, index) => 1901000000000 + startRow + index);
        if (answers) setTimeout(() => ok({ result: { viewRequestResults: [{ rowCount: 60, columnCount: 3,
          rowLabelPages: [{ start: startRow, count: rowCount, entityLongIds: [ids], labels: [ids.map(id => `Item ${id % 1000}`)] }],
          columnLabelPages: [{ start: 0, count: 3, entityLongIds: [[4000000009, 4000000010, 4000000011]], labels: [["Formula", "Summary", "Notes"]] }],
          dataPages: [{ startRow, rows: ids.map(() => ["", "", ""]) }] }] } }), 60_000);
        return true;
      } } } as unknown as Native;
    /** The export of that grid, six cells at a time: the first read, then thirty pages of two rows. Half an hour, and after
     * the line that follows the first read it has nothing to report until it is done. `asks` is whether it asks the frame's
     * check before each page, as the export does (model/native.ts `readGrid`). */
    let diagnostic = "";
    const reading = (asks: boolean) => async (progress: Progress, diagnostics: () => string, check: Stop) => {
      progress.status("Reading Line Items…");
      const grid = await readGrid(client, "ROWS", "COLS", "Line Items", progress.log, 6, false, asks ? check : undefined);
      diagnostic = diagnostics();
      return exported(grid.rows.map(row => [row.labels[0], row.cells[0]]));
    };
    /** Runs it in a frame, for a page that waits with its own idle time of five minutes, and lets forty minutes pass. */
    const exporting = async (asks: boolean) => {
      reads.length = 0;
      const [shell, core] = [new FakeWindow(SHELL), new FakeWindow(CORE)];
      let handle: CoreHandle | undefined;
      watchCore(shell, found => { handle = found; });
      const stop = serveCore(core, shell.seenBy(core), () => MODEL, reading(asks));
      await vi.advanceTimersByTimeAsync(0);
      const { lines, progress } = collect();
      const outcome = runInCore(shell, handle!, progress).then(result => result.tables[1].rows.length, failedWith);
      await vi.advanceTimersByTimeAsync(40 * 60_000);
      stop();
      return { lines, outcome: await outcome };
    };

    const kept = await exporting(true);
    expect(kept.outcome).toBe(60);
    expect(reads).toEqual(["0+1", ...Array.from({ length: 30 }, (_, page) => `${page * 2}+2`)]);
    // What keeps the page waiting is no step and no line: the page is shown nothing more, and the log the export writes
    // into Model Details.csv has no more rows.
    const logged = "Line Items: 60 rows × 3 columns; columns: Formula | Summary | Notes";
    expect(kept.lines).toEqual(["status: Reading Line Items…", `log: ${logged}`]);
    expect(diagnostic).toBe(`01:59:09 Reading Line Items…\r\n02:00:09 ${logged}`);

    // Read without asking before each page, as it was, the same grid is given up on five minutes after that line.
    expect((await exporting(false)).outcome).toEqual([QUIET, "the model's frame sent nothing for 300 s"]);

    // The other half of it: a read that is never answered ends by itself, as a failed read, sooner than the page gives up.
    answers = false;
    expect((await exporting(true)).outcome).toEqual([UNEXPECTED, "Timed out waiting for the model."]);
    expect(reads).toEqual(["0+1"]);
  });

  it("serves the classic model page opened on its own, where both sides are the same window", async () => {
    const page = new FakeWindow(CORE);
    const itself = page.seenBy(page);
    let found: CoreHandle | undefined;
    let announcements = 0;
    page.addEventListener("message", event => { if ((event.data as { type?: string }).type === "core-ready") announcements++; });
    watchCore(page, handle => { found = handle; });
    let runs = 0;
    const stop = serveCore(page, itself, () => MODEL, async (progress, _diagnostics, check) => {
      runs++;
      progress.status("Reading Versions…");
      check.throwIfAborted();
      return exported();
    }, 5);
    await settle();
    expect(found).toEqual({ source: itself, origin: CORE, modelId: MODEL });
    // Acknowledged like a frame: the announcements stop.
    await settle();
    const seen = announcements;
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(announcements).toBe(seen);

    // Each side also hears what it sends itself, the sign of life before a read included; neither takes its own message
    // for the other's.
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
      const outcome = failed(exportInCore(shell, () => undefined, () => probes, MODEL, progress));
      return { lines, outcome };
    };
    const nothing = failing([]);
    const something = failing([probe]);
    await vi.advanceTimersByTimeAsync(20_000);
    // The user is told the same either way; how many frames reported in is for the log.
    expect(await nothing.outcome).toEqual([NO_MODEL, "no frame reported in"]);
    expect(await something.outcome).toEqual([NO_MODEL, "the model's frame did not answer; 1 frame(s) reported in"]);
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
