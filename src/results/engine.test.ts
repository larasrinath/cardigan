import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DETAILS_FILE, TAB_FILES } from "../analyse.js";
import { APP_ZIP_0_6_1, MODEL_ZIP_0_6_1, ZIPPED_AT } from "../golden-0.6.1.test-support.js";
import { Failure, firstLine } from "../progress.js";
import { ROWS_MAX, type Subject } from "../protocol.js";
import type { AnalysisResult } from "../result-types.js";
import { resultZip } from "../result-zip.js";
import { BUSY, NOTHING_TO_ANALYSE, SIGNED_OUT, UNSENT } from "../tab-port.js";
import { parseCsv, sameBytes, unzipText } from "../zip.test-support.js";
import { APP_FILES } from "./columns.js";
import { describeState, ResultsClient, type RunState } from "./connection.js";
import { APP_HOST, GOLDEN_APP, GOLDEN_GRIDS, goldenApp, LINE_ITEMS, MODEL, MODEL_HOST, modelPage, serveEngine, SHELL_HOST, type EngineRun } from "./engine.test-support.js";
import { FakeTab, MESSAGE_MAX_BYTES, NOBODY, TOO_LARGE, type PortEnd } from "./port-pair.test-support.js";
import { detailsOf, diagnosticLog } from "./result-view.js";

// The results page's client against the engine: the content script's real side of the port around the real analysis of an
// app and the real export of a model in its frame, joined to the page by ports that pass messages as Chrome's do. What
// Anaplan answers is scripted; everything between Anaplan and what the page holds at the end is the extension's own code.

const NOW = new Date(Date.UTC(2026, 8, 28, 12, 30, 10));
/** A line of a log as it is stamped at a time; the clock stands still unless a test moves it. */
const stampedAt = (time: Date) => (line: string): string => `${time.toISOString().slice(11, 19)} ${line}`;
const stamped = stampedAt(NOW);

/** Waits until something holds, while the tab, the page and Anaplan's stand-ins take their turns. (vi.waitFor would move
 * the clock that stands still.) */
async function until(holds: () => unknown, what: string): Promise<void> {
  // Three seconds at most, which is less than a test may take: a wait in vain then says what it waited for.
  for (const started = performance.now(); performance.now() - started < 3000;) {
    if (holds()) return;
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  throw new Error(`Waited in vain for ${what}.`);
}

/** A results page as its client makes it: on a port to the tab, and told every state. `justOpened` is what the page's
 * script finds out from its address: whether the toolbar icon has just opened it. */
function resultsPage(tab: FakeTab, justOpened = true) {
  const states: RunState[] = [];
  const ports: PortEnd[] = [];
  const client = new ResultsClient({
    connect: () => { ports.push(tab.connect()); return ports[ports.length - 1]; },
    autoRun: justOpened,
    closeReason: () => tab.lastError?.message,
    onState: state => { states.push(state); },
  });
  client.start();
  return {
    client, states, ports,
    phases: (): string[] => states.map(state => state.phase),
    /** Each step the page showed while a run went, in order. */
    statuses: (): string[] => states.flatMap(state => (state.phase === "running" ? [state.status] : [])),
    /** The complete result the page holds, with the time it was complete at. */
    held(): { result: AnalysisResult; received: Date } {
      if (client.state.phase !== "done") throw new Error(`The page holds no result: it is ${client.state.phase}.`);
      return client.state;
    },
    /** What the page says for the state it is in. */
    says: () => describeState(client.state, client.asked),
    /** The page is closed or reloaded: its end of the port goes. */
    close: (): void => { ports[ports.length - 1].disconnect(); },
  };
}
type Page = ReturnType<typeof resultsPage>;
const done = (page: Page) => (): boolean => page.client.state.phase === "done";

/** What every finished run comes to: the page holds the result the engine made, cell for cell, and the zip it gives for
 * download is that result's zip for the same time, byte for byte. The rows are compared one by one, so that a difference
 * shows as the first row that differs: two tables of thousands of rows told apart as a whole take minutes to print. */
function expectEngineResult(page: Page, run: EngineRun): void {
  const { result, received } = page.held();
  const made = run.result;
  if (!made) throw new Error("The engine's run has no result.");
  expect(result).not.toBe(made);
  const outline = (whole: AnalysisResult) => ({ ...whole, tables: whole.tables.map(table => ({ ...table, rows: table.rows.length })) });
  expect(outline(result)).toEqual(outline(made));
  for (const [index, table] of result.tables.entries()) {
    const rows = made.tables[index].rows;
    const differs = table.rows.findIndex((row, at) => row.length !== rows[at].length || row.some((cell, column) => !Object.is(cell, rows[at][column])));
    expect([table.file, differs, table.rows[differs], rows[differs]]).toEqual([table.file, -1, undefined, undefined]);
  }
  expect(sameBytes(resultZip(result, received), resultZip(made, received))).toBe(true);
}

/** A zip's files as text. The Details file is given as its rows without the Diagnostics ones: a run's log is its own. */
function files(zip: Uint8Array, details: string): Map<string, string | string[][]> {
  return new Map([...unzipText(zip)].map(([name, text]): [string, string | string[][]] =>
    [name, name === details ? parseCsv(text).filter(row => row[0] !== "Diagnostics") : text]));
}

/** The last part of each REST path read: "apps/<id>", "boards/<id>", "imports". */
const read = (path: string): string => path.split("/").slice(3).join("/").replace(/^workspaces\/.*\//, "");
const BOARD = (path: string): boolean => path.includes("/boards/");

describe("The results page against the engine in the Anaplan tab", () => {
  let tab: FakeTab;
  let anaplan: ReturnType<typeof goldenApp> | undefined;
  let model: ReturnType<typeof modelPage> | undefined;
  /** What the tab shows, which a test can change, and the engine's runs for it. */
  let shown: { host: string; shows: Subject; core?: string };
  let runs: EngineRun[];

  /** The tab shows the app, and its content script is there. */
  const showApp = (): ReturnType<typeof goldenApp> => {
    const service = anaplan = goldenApp();
    vi.stubGlobal("fetch", service.fetch);
    vi.stubGlobal("WebSocket", service.WebSocket);
    vi.stubGlobal("location", service.location);
    vi.stubGlobal("document", service.document);
    shown = { host: APP_HOST, shows: { kind: "app", id: GOLDEN_APP } };
    runs = serveEngine(tab, shown);
    return service;
  };
  /** The tab shows the model in Model Building: the page's content script is there, and the model's frame inside the page. */
  const showModel = (page = modelPage()): ReturnType<typeof modelPage> => {
    model = page;
    vi.stubGlobal("window", page.window);
    vi.stubGlobal("location", page.location);
    shown = { host: SHELL_HOST, shows: { kind: "model", id: MODEL }, core: MODEL_HOST };
    runs = serveEngine(tab, shown);
    return page;
  };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    tab = new FakeTab();
    anaplan = model = undefined;
    runs = [];
    // Nothing may reach the network: a read that no stand-in answers fails.
    vi.stubGlobal("fetch", () => { throw new Error("A read without a stand-in for Anaplan."); });
    vi.stubGlobal("WebSocket", class { constructor() { throw new Error("A socket without a stand-in for Anaplan."); } });
  });
  afterEach(async () => {
    // Every run is let come to its end, so that none goes on into the next test; the stand-ins stay in the globals' place.
    anaplan?.releaseAll();
    model?.releaseAll();
    await until(() => runs.every(run => run.ended), "every run to end");
    await tab.quiet();
    vi.useRealTimers();
  });

  it("analyses an app for a page the icon has just opened: the page ends up holding the engine's own result", async () => {
    const service = showApp();
    const page = resultsPage(tab);
    await until(done(page), "the result");

    // One run was asked for, without a click, and the engine read the app once.
    expect(page.ports[0].other.heard).toEqual([{ type: "run" }]);
    expect(runs).toHaveLength(1);
    expect(service.reads.map(read)).toEqual([`apps/${GOLDEN_APP}`, "boards/00000000-0000-4000-8000-000000001000", "imports", "processes"]);
    expectEngineResult(page, runs[0]);

    // The page went from connecting through the engine's own steps to the result, and held nothing as a result before the end.
    expect(page.phases().filter((phase, index, all) => phase !== all[index - 1])).toEqual(["connecting", "running", "done"]);
    const steps = runs[0].said.filter(text => page.statuses().includes(text));
    expect(page.statuses()).toEqual(["Starting the analysis…", ...steps, "Receiving the result…"]);
    expect(steps.slice(0, 3)).toEqual(["Reading the app…", "Reading page 1 of 2: Demand board", "Reading page 2 of 2: Draft page"]);
    expect(steps.at(-1)).toBe("Building the report…");
    // Its log is the run's: the line that names the build, the app and the host, then every step and line the engine reported.
    expect(page.client.log).toEqual([firstLine("app", GOLDEN_APP, APP_HOST), ...runs[0].said].map(stamped));
    // And that log is the one the result carries, as the page reads it out of the Details file.
    const { result, received } = page.held();
    expect(diagnosticLog(detailsOf(result))).toEqual(page.client.log);
    expect(received).toEqual(NOW);
    // The socket to the app's model says that it has closed only after the result has gone out. The engine logs that, and
    // tells no page: "done" stays the last thing the page heard, and the log it shows stays the result's.
    await until(() => runs[0].late.length, "the socket's closing");
    await tab.quiet();
    expect(runs[0].late).toEqual(["socket closed code=1000"]);
    expect([page.ports[0].heard.at(-1), page.client.log.length, page.client.state.phase]).toEqual([{ type: "done" }, runs[0].said.length + 1, "done"]);

    // The files are the ones the page knows an app's files by, the Details file first.
    expect(result.tables.map(table => table.file)).toEqual([DETAILS_FILE, ...Object.values(TAB_FILES)]);
    expect(result.tables.map(table => table.file)).toEqual([detailsOf(result)?.file, ...Object.values(APP_FILES)]);
    // What the page would give for download is, file for file, the zip 0.6.1 wrote for this app.
    expect(files(resultZip(result, ZIPPED_AT), DETAILS_FILE)).toEqual(files(APP_ZIP_0_6_1, DETAILS_FILE));
    expect([result.kind, result.name, result.zipName, result.summary]).toEqual(["app", "Planning: app", "Planning app - App Export - 2026-09-28.zip",
      ["1 of 1 pages analysed; 1 unpublished, not analysed, 3 cards."]]);
  });

  it("exports a model the same way, from the model's frame inside the page", async () => {
    const settings = showModel();
    const page = resultsPage(tab);
    await until(done(page), "the result");
    expect(page.ports[0].other.heard).toEqual([{ type: "run" }]);
    expect(runs).toHaveLength(1);
    // The result was made in the model's frame: it crossed to the page's content script, and from there to the results page.
    expectEngineResult(page, runs[0]);
    expect(page.phases().filter((phase, index, all) => phase !== all[index - 1])).toEqual(["connecting", "running", "done"]);
    // The page's log is the content script's: the line that names the build, the model and the host of the page the user
    // sees, what the frame said it holds, and then each step and line of the export as the frame reported it.
    expect(page.client.log).toEqual([firstLine("model", MODEL, SHELL_HOST), ...runs[0].said].map(stamped));
    expect(runs[0].said.slice(0, 2)).toEqual([`frame ${MODEL_HOST}/core-webapp/anaplan/framework.jsp: loader=function model=id workspace=id`, "Loading the model page's client…"]);
    // Every grid was read through the frame's client, a first row and then the rest.
    expect(settings.reads.slice(0, 4)).toEqual(["LINE ITEMS 0+1", "LINE ITEMS 0+4", "MODULES 0+1", "MODULES 0+2"]);
    const { result } = page.held();
    expect(detailsOf(result)?.file).toBe("Model Details.csv");
    // The log the result carries is the frame's own, which begins with the export: inside Model Building it has neither
    // of the two lines the content script wrote before it asked the frame. From there on the two logs are the same.
    expect(diagnosticLog(detailsOf(result))).toEqual(page.client.log.slice(2));
    // What the page would give for download is, file for file, the zip 0.6.1 wrote for this model.
    expect(files(resultZip(result, ZIPPED_AT), "Model Details.csv")).toEqual(files(MODEL_ZIP_0_6_1, "Model Details.csv"));
    expect([result.kind, result.name, result.zipName]).toEqual(["model", "Demand: plan", "Demand plan - Model Export - 2026-09-28.zip"]);
    expect(result.summary.at(-1)).toBe("Source Models: not exported (This model page has no REMOTE_MODEL axis.).");
  });

  it("takes a model's line items, 5,000 rows of 26 columns, in the pieces the engine sends them in", async () => {
    const columns = ["Formula", "Summary", ...Array.from({ length: 21 }, (_, index) => `Property ${index + 1}`)];
    const rows = Array.from({ length: 5000 }, (_, index) => ({ ids: [1901000000000 + index, 102000000001], labels: [`Line item ${index}`, "Profitability"],
      cells: [`IF 'Flag ${index}' THEN Volume[SELECT: Versions.Actual] * Price ELSE 0`, '{"summaryMethod":"SUM"}', ...Array.from({ length: 21 }, (_, column) => `value ${index}.${column}`)] }));
    const settings = showModel(modelPage({ ...GOLDEN_GRIDS, [LINE_ITEMS]: { columns, rows } }));
    const page = resultsPage(tab);
    await until(done(page), "the result");

    // The engine read the grid a window of rows at a time, and sent the file's rows on in pieces of 500.
    expect(settings.reads.filter(entry => entry.startsWith("LINE ITEMS "))).toEqual(["LINE ITEMS 0+1", "LINE ITEMS 0+1739", "LINE ITEMS 1739+1739", "LINE ITEMS 3478+1522"]);
    const pieces = page.ports[0].heard.filter((message): message is { type: "rows"; table: number; rows: unknown[] } => (message as { type?: string }).type === "rows");
    expect(pieces.filter(piece => piece.table === 1).map(piece => piece.rows.length)).toEqual(Array(5000 / ROWS_MAX).fill(ROWS_MAX));
    // No message came near what Chrome allows one: the largest is a piece of rows, a few hundred kilobytes.
    expect(page.ports[0].other.largest).toBeGreaterThan(100_000);
    expect(page.ports[0].other.largest).toBeLessThan(MESSAGE_MAX_BYTES / 100);
    // While the pieces arrived the page said so and held no result: the one result it was told of came with the last message.
    expect(page.phases().filter(phase => phase === "done")).toHaveLength(1);
    expect([page.phases().at(-1), page.statuses().at(-1), page.ports[0].heard.at(-1)]).toEqual(["done", "Receiving the result…", { type: "done" }]);

    expectEngineResult(page, runs[0]);
    const lineItems = page.held().result.tables[1];
    expect([lineItems.file, lineItems.headers.length, lineItems.rows.length]).toEqual(["Line Items.csv", 26, 5000]);
    expect([lineItems.rows[0][0], lineItems.rows[4999][0], lineItems.rows[4999][25]]).toEqual(["Line item 0", "Line item 4999", ""]);
    expect(lineItems.rows.every((row, index) => row.length === 26 && row[3] === `value ${index}.0`)).toBe(true);
  });

  it("shows why the engine could not read the app in the engine's own sentence, with the detail in the log, and runs again", async () => {
    const service = showApp();
    service.answer = path => (path.includes("/apps/") ? new Response("{}", { status: 403 }) : undefined);
    const page = resultsPage(tab);
    await until(() => page.client.state.phase === "failed", "the failure");

    const refused = "Anaplan refused the request. You may not have access to this app: check that you can open it in Anaplan, then choose Run again.";
    expect(runs[0].error).toBeInstanceOf(Failure);
    expect([(runs[0].error as Failure).message, (runs[0].error as Failure).detail]).toEqual([refused, "HTTP_ERROR (HTTP 403)"]);
    // The page shows the sentence as it is, with nothing of its own under it; the code and the status are the log's last line.
    expect(page.client.state).toEqual({ phase: "failed", message: refused });
    expect(page.says()).toEqual({ title: "The analysis stopped", message: refused, hint: "" });
    expect(page.client.log).toEqual([firstLine("app", GOLDEN_APP, APP_HOST), "Reading the app…", "stopped: HTTP_ERROR (HTTP 403)"].map(stamped));
    expect(page.ports[0].heard.at(-1)).toEqual({ type: "error", message: refused });
    expect(page.phases()).not.toContain("done");

    // Anaplan answers again. Run again, as the sentence says: the same port, a new run with a log of its own, and the result.
    service.answer = () => undefined;
    page.client.runAgain();
    await until(done(page), "the result");
    expect([tab.ports.length, page.ports[0].other.heard, runs.length]).toEqual([1, [{ type: "run" }, { type: "run" }], 2]);
    expectEngineResult(page, runs[1]);
    expect(page.client.log).toEqual([firstLine("app", GOLDEN_APP, APP_HOST), ...runs[1].said].map(stamped));
  });

  it("says that Anaplan's session has ended when the engine is signed out", async () => {
    const service = showApp();
    service.answer = () => new Response("{}", { status: 401 });
    const page = resultsPage(tab);
    await until(() => page.client.state.phase === "failed", "the failure");
    // The engine tells it by a code of its own; the page shows the engine's sentence, which says what to do.
    expect(page.ports[0].heard.at(-1)).toEqual({ type: "error", message: SIGNED_OUT, code: "SIGNED_OUT" });
    expect(page.says()).toEqual({ title: "The analysis stopped", message: "You're signed out of Anaplan. Sign in and try again.", hint: "" });
    expect(page.client.log.at(-1)).toBe(stamped("stopped: SIGNED_OUT (HTTP 401)"));
    expect([service.reads.map(read), service.sockets]).toEqual([[`apps/${GOLDEN_APP}`], []]);
  });

  it("gives an error the engine sends without having started a run a line in the page's log", async () => {
    showApp();
    const board = anaplan!.hold(BOARD);
    const first = resultsPage(tab);
    await until(() => board.waiting === 1, "the run to reach the board");
    await tab.quiet();
    // The tab goes on to a model while its app is still being analysed for the first page: a second page is told to wait.
    shown.shows = { kind: "model", id: MODEL };
    const second = resultsPage(tab);
    await until(() => second.client.state.phase === "failed", "the second page to be refused");
    expect(second.ports[0].heard).toEqual([{ type: "subject", subject: { kind: "model", id: MODEL } }, { type: "error", message: BUSY }]);
    expect(second.says()).toEqual({ title: "The analysis stopped", message: BUSY, hint: "" });
    // The engine wrote no log for it: the page's own line is what "Copy diagnostic log" has to copy.
    expect(second.client.log).toEqual([stamped(`stopped: ${BUSY}`)]);
    expect(runs).toHaveLength(1);

    // The first page's run ends as an app's run; then the tab shows neither an app nor a model, and Run again finds nothing.
    shown.shows = { kind: "none" };
    board.release();
    await until(done(first), "the first page's result");
    expectEngineResult(first, runs[0]);
    first.client.runAgain();
    await until(() => first.client.state.phase === "failed", "the first page to be told");
    expect([first.client.state, first.client.log]).toEqual([{ phase: "failed", message: NOTHING_TO_ANALYSE }, [stamped(`stopped: ${NOTHING_TO_ANALYSE}`)]]);
    expect(runs).toHaveLength(1);
  });

  it("stops the engine's reading when the page goes away in the middle of a run, and runs for the next page once that run has ended", async () => {
    const service = showApp();
    const board = service.hold(BOARD);
    // The second time the app is read, which is the next page's run, waits too: so what the first run still reads shows.
    const secondRead = service.hold(path => path.includes("/apps/") && service.reads.filter(earlier => earlier.includes("/apps/")).length === 2);
    const page = resultsPage(tab);
    await until(() => board.waiting === 1, "the run to reach the board");
    // The run waits for Anaplan's answer about the board; the page has heard all that was sent so far.
    await tab.quiet();
    expect(page.client.state).toEqual({ phase: "running", status: "Reading page 1 of 2: Demand board" });
    const told = page.ports[0].heard.length;

    // The page is closed, and the icon is clicked again at once: the next page asks while the stopped run is still ending.
    page.close();
    await until(() => !page.ports[0].other.open, "the tab to hear that the page has gone");
    const next = resultsPage(tab);
    await tab.quiet();
    expect([next.client.state, runs.length]).toEqual([{ phase: "running", status: "Stopping the previous run…" }, 1]);

    board.release();
    await until(() => secondRead.waiting === 1, "the next run to start");
    // The read that was under way was let finish. Nothing was read after it for the page that is gone: no further page,
    // no names, no socket. Only then did the next page's run begin, with the app.
    expect([runs[0].ended, runs[0].error, runs[0].result]).toEqual([true, new Error("Stopped: the results page was closed."), undefined]);
    expect([service.reads.map(read), service.sockets]).toEqual([[`apps/${GOLDEN_APP}`, "boards/00000000-0000-4000-8000-000000001000", `apps/${GOLDEN_APP}`], []]);
    // And nothing more went to the page that is gone.
    expect(page.ports[0].heard).toHaveLength(told);

    // The next page gets a run, a log and a result of its own.
    secondRead.release();
    await until(done(next), "the next page's result");
    expect(runs).toHaveLength(2);
    expectEngineResult(next, runs[1]);
    expect(next.client.log).toEqual([firstLine("app", GOLDEN_APP, APP_HOST), ...runs[1].said].map(stamped));
    expect(next.statuses().slice(0, 3)).toEqual(["Starting the analysis…", "Stopping the previous run…", "Reading the app…"]);
  });

  it("gives a model's export that is under way to the next page when the page it was for has gone: the model is read once", async () => {
    const settings = showModel();
    const modules = settings.hold(read => read.startsWith("MODULES "));
    const page = resultsPage(tab);
    await until(() => modules.waiting === 1, "the export to reach the modules");
    await tab.quiet();
    expect(page.client.state).toEqual({ phase: "running", status: "Reading Modules…" });

    // The page is closed: the content script's run ends at once, and the frame is told to stop reading.
    page.close();
    await until(() => runs[0].ended, "the run to end");
    expect([runs[0].error, runs[0].result]).toEqual([new Error("Stopped: the results page was closed."), undefined]);
    // The icon is clicked again before the frame's read has come back. The frame has one export at a time, so the next
    // page's run takes over the one that is under way (bridge.ts `serveCore`) instead of starting a second beside it.
    const next = resultsPage(tab);
    await tab.quiet();
    expect([next.client.state, runs.length, settings.reads]).toEqual([{ phase: "running", status: "Starting the analysis…" }, 2, ["LINE ITEMS 0+1", "LINE ITEMS 0+4", "MODULES 0+1"]]);

    modules.release();
    await until(done(next), "the next page's result");
    // No grid was read a second time, and the result is whole: the rows read for the page that is gone are in it.
    expect([runs.length, settings.reads.filter((read, index, all) => all.indexOf(read) !== index)]).toEqual([2, []]);
    expectEngineResult(next, runs[1]);
    const { result } = next.held();
    expect(files(resultZip(result, ZIPPED_AT), "Model Details.csv")).toEqual(files(MODEL_ZIP_0_6_1, "Model Details.csv"));
    // The next page's log begins where it took over, after the two lines the content script writes for every run. The log
    // the result carries is the export's from its beginning: between them the two pages were told each line of it once.
    expect(next.client.log.slice(0, 3)).toEqual([firstLine("model", MODEL, SHELL_HOST), runs[1].said[0], "Modules: 2 rows × 2 columns; columns: Applies To | Cell Count"].map(stamped));
    expect(diagnosticLog(detailsOf(result))).toEqual([...page.client.log.slice(2), ...next.client.log.slice(2)]);
  });

  it("says that the Anaplan tab was closed or left the page when its port closes in the middle of a run, and connects anew on Run again", async () => {
    const service = showApp();
    const board = service.hold(BOARD);
    const page = resultsPage(tab);
    await until(() => board.waiting === 1, "the run to reach the board");
    await tab.quiet();

    // The Anaplan tab is refreshed: its content script goes, and with it the port.
    tab.leave();
    await until(() => page.client.state.phase === "interrupted", "the page to hear that the tab has gone");
    expect(page.says()).toEqual({ title: "The analysis stopped", message: "The Anaplan tab was closed or left the page before the analysis finished.",
      hint: "Open the app or model again, then click the Cardigan icon or choose Run again." });
    expect(page.client.log).toEqual([firstLine("app", GOLDEN_APP, APP_HOST), "Reading the app…", runs[0].said[1], "Reading page 1 of 2: Demand board",
      "The connection to the tab closed."].map(stamped));
    // (In a browser the content script's run ends with its page. Here it is let run out: what it still sends reaches nobody.)
    board.release();
    await until(() => runs[0].ended, "the old run to end");
    await tab.quiet();
    expect([page.client.state.phase, page.ports[0].open, page.phases()]).toEqual(["interrupted", false, ["connecting", "running", "running", "running", "interrupted"]]);

    // While the tab is still loading nobody answers there: Run again says so, with Chrome's reason in the log.
    page.client.runAgain();
    await until(() => page.client.state.phase === "unreachable", "the page to find nobody");
    expect(page.says().message).toBe("Cardigan cannot reach that tab.");
    expect(page.client.log).toEqual([stamped(`The tab did not answer: ${NOBODY}`)]);
    // Once the content script is back, Run again connects, hears what the tab shows and runs: the page asked for it.
    showApp();
    page.client.runAgain();
    await until(done(page), "the result");
    expect(page.ports).toHaveLength(3);
    expect(page.ports[2].other.heard).toEqual([{ type: "run" }]);
    expectEngineResult(page, runs[0]);
  });

  it("runs again on the same port, and is told of a new result only once all of it has arrived", async () => {
    const service = showApp();
    const page = resultsPage(tab);
    await until(done(page), "the result");
    const first = page.held();
    expectEngineResult(page, runs[0]);

    // The app was renamed meanwhile, and a minute has passed: the second run's result is another one.
    service.name = "Planning: app, renamed";
    const later = new Date(NOW.getTime() + 65_000);
    vi.setSystemTime(later);
    const told = page.states.length;
    page.client.runAgain();
    await until(() => page.states.length > told && done(page)(), "the second result");
    expect([tab.ports.length, page.ports[0].other.heard, runs.length]).toEqual([1, [{ type: "run" }, { type: "run" }], 2]);

    // From Run again to the end the page was told of steps only, so a page that keeps what it shows until it is told of a
    // result shows the first one throughout. The one result it was told of is the last state, and it is the second run's.
    const since = page.states.slice(told).map(state => state.phase);
    expect([since.slice(0, -1).every(phase => phase === "running"), since.at(-1), since.length > 5]).toEqual([true, "done", true]);
    expectEngineResult(page, runs[1]);
    expect([page.held().result.name, page.held().result.zipName, page.held().received]).toEqual(["Planning: app, renamed", "Planning app, renamed - App Export - 2026-09-28.zip", later]);
    expect(page.client.log).toEqual([firstLine("app", GOLDEN_APP, APP_HOST), ...runs[1].said].map(stampedAt(later)));
    // The first result is as it was: still the first run's, with the time it was complete at.
    expect([first.result, first.received]).toEqual([runs[0].result, NOW]);
    expect(first.result.name).toBe("Planning: app");
    expect(sameBytes(resultZip(first.result, first.received), resultZip(page.held().result, page.held().received))).toBe(false);
  });

  it("holds nothing as a result when the engine cannot send a piece of it: an error comes in place of done", async () => {
    showApp();
    const page = resultsPage(tab);
    await until(done(page), "the result");
    const first = page.held();
    expectEngineResult(page, runs[0]);

    // On Run again Chrome refuses one piece, the rows of the Cards file, although the port is open.
    const cards = 1 + Object.keys(TAB_FILES).indexOf("Cards");
    page.ports[0].other.refuses = message => (message as { type?: string; table?: number }).type === "rows" && (message as { table?: number }).table === cards;
    const told = page.states.length;
    const heard = page.ports[0].heard.length;
    page.client.runAgain();
    await until(() => page.client.state.phase === "failed", "the failure");
    // The engine had a whole result. The page was sent the result, the rows of the two files before Cards, and then, in
    // place of the rest and of "done", why it stopped and that the run failed.
    expect(runs[1].result).toBeDefined();
    expect(page.ports[0].types().slice(heard).filter(type => type !== "log" && type !== "status")).toEqual(["result", "rows", "rows", "error"]);
    expect(page.ports[0].heard.slice(-2)).toEqual([{ type: "log", text: stamped(`stopped: the result could not be sent (${TOO_LARGE})`) }, { type: "error", message: UNSENT }]);
    // The page took none of it for a result: it was told of steps and then of the failure, with the engine's sentence.
    expect(page.states.slice(told).map(state => state.phase).filter((phase, index, all) => phase !== all[index - 1])).toEqual(["running", "failed"]);
    expect(page.client.state).toEqual({ phase: "failed", message: UNSENT });
    expect(page.says().hint).toBe("");
    expect(page.client.log.at(-1)).toBe(stamped(`stopped: the result could not be sent (${TOO_LARGE})`));
    // What it held before is still whole.
    expect(first.result).toEqual(runs[0].result);

    // The port takes every piece again: Run again, as the sentence says, and the page is told of the whole result.
    page.ports[0].other.refuses = () => false;
    page.client.runAgain();
    await until(done(page), "the result");
    expectEngineResult(page, runs[2]);
  });

  it("asks nothing of the engine on a page the icon did not just open, until its run control is used", async () => {
    const service = showApp();
    const page = resultsPage(tab, false);
    await until(() => page.client.state.phase === "ready", "the page to hear what the tab shows");
    await tab.quiet();
    // The page knows what the tab shows, and that is all: no "run" went to the tab, and the engine read nothing.
    expect(page.client.state).toEqual({ phase: "ready", kind: "app" });
    expect(page.ports[0].heard).toEqual([{ type: "subject", subject: { kind: "app", id: GOLDEN_APP } }]);
    expect([page.ports[0].other.heard, runs, service.reads, service.sockets]).toEqual([[], [], [], []]);
    expect(page.says().hint).toBe("Choose Run to analyse it. This page starts by itself only when the Cardigan icon has just opened it.");

    page.client.runAgain();
    await until(done(page), "the result");
    expect([tab.ports.length, page.ports[0].other.heard, runs.length]).toEqual([1, [{ type: "run" }], 1]);
    expectEngineResult(page, runs[0]);
  });

  it("lets a second results page of the same tab follow the run in progress: both end up with the one result", async () => {
    const service = showApp();
    const board = service.hold(BOARD);
    const first = resultsPage(tab);
    await until(() => board.waiting === 1, "the run to reach the board");
    await tab.quiet();
    // The icon is clicked again: a second page, whose "run" finds the first page's run going. It is told where that run
    // is and every line of its log so far.
    const second = resultsPage(tab);
    await tab.quiet();
    expect(first.client.state).toEqual({ phase: "running", status: "Reading page 1 of 2: Demand board" });
    expect(second.client.state).toEqual(first.client.state);
    expect(second.client.log).toEqual(first.client.log);
    expect(second.client.log).toHaveLength(4);
    expect(runs).toHaveLength(1);

    board.release();
    await until(() => done(first)() && done(second)(), "both results");
    // One run, one read of the app, and each page holds the engine's result as its own copy.
    expect([runs.length, service.reads.filter(path => path.includes("/apps/")).length]).toEqual([1, 1]);
    expectEngineResult(first, runs[0]);
    expectEngineResult(second, runs[0]);
    expect(second.held().result).not.toBe(first.held().result);
    expect(second.client.log).toEqual(first.client.log);

    // Both ask again, and the first page is closed in the middle of that run: the run goes on for the second.
    const again = service.hold(BOARD);
    first.client.runAgain();
    await until(() => again.waiting === 1, "the second run to reach the board");
    second.client.runAgain();
    await tab.quiet();
    expect([second.client.state, second.client.log]).toEqual([first.client.state, first.client.log]);
    first.close();
    await until(() => !first.ports[0].other.open, "the tab to hear that the first page has gone");
    again.release();
    await until(done(second), "the second page's result");
    expect([runs.length, runs[1].error]).toEqual([2, undefined]);
    expectEngineResult(second, runs[1]);
    // The page that was closed heard no more of it.
    expect(first.client.state.phase).toBe("running");
  });
});
