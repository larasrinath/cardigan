import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assemble } from "./pieces.test-support.js";
import { Failure, OldReader, type Progress } from "./progress.js";
import { PORT_NAME, ROWS_MAX, type Subject, type TabMessage } from "./protocol.js";
import type { AnalysisResult, Cell } from "./result-types.js";
import { BUSY, NOTHING_TO_ANALYSE, serveTab, SIGNED_OUT, UNSENT, type Opened, type Seen, type Tab } from "./tab-port.js";
import { EXTENSION, FakePort } from "./tab-port.test-support.js";

const APP: Seen = { kind: "app", id: "01234567-89ab-cdef-0123-456789abcdef" };
const MODEL: Seen = { kind: "model", id: "FEDCBA9876543210FEDCBA9876543210" };
const HEADER = "01:59:09 Cardigan dev: app 01234567-89ab-cdef-0123-456789abcdef on us1a.app.anaplan.com";

const result = (rows: Cell[][] = [["Demand board", 1]]): AnalysisResult => ({ kind: "app", name: "Planning app", id: APP.id, zipName: "Planning app - App Export - 2026-09-28.zip",
  summary: ["1 of 1 pages analysed, 1 cards."], tables: [
    { file: "App Details.csv", label: "App Details", headers: ["Section", "Detail", "Value"], rows: [["App", "App", "Planning app"]], guard: true, details: true },
    { file: "Cards.csv", label: "Cards", headers: ["Page", "Card #"], rows, guard: true }] });
const RESULT_MESSAGES = [{ type: "result", result: { ...result(), tables: result().tables.map(table => ({ ...table, rows: [] })) } },
  { type: "rows", table: 0, rows: [["App", "App", "Planning app"]] }, { type: "rows", table: 1, rows: [["Demand board", 1]] }, { type: "done" }];
const SIGNED_OUT_ERROR = new Error("SIGNED_OUT (HTTP 401)");
/** What a page is told when a run fails with an error that was not written for its user. */
const UNEXPECTED = "Cardigan ran into a problem it did not expect. Choose Run again. If it keeps happening, choose Copy diagnostic log and send the log.";
/** A failure as a run tells it: the sentence for the user, and the detail for the diagnostic log. */
const QUIET = new Failure("The model stopped answering while Cardigan was reading it. Check that it is still open in the Anaplan tab, then choose Run again.",
  "the model's frame sent nothing for 300 s");
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

describe("A content script that a later copy has replaced", () => {
  it("leaves a results page to that copy, without closing the port", () => {
    let current = true;
    let connect: (port: chrome.runtime.Port) => void = () => undefined;
    serveTab({ id: EXTENSION, onConnect: { addListener: listener => { connect = listener; } } }, { host: "us1a.app.anaplan.com", subject: () => APP,
      run: () => new Promise<AnalysisResult>(() => undefined), signedOut: () => false, current: () => current });
    const first = new FakePort();
    connect(first as unknown as chrome.runtime.Port);
    expect(first.types()).toEqual(["subject"]);
    current = false;
    const port = new FakePort();
    connect(port as unknown as chrome.runtime.Port);
    expect([port.received, port.refused]).toEqual([[], false]);
  });
});

/** A content script's tab whose runs the test finishes by hand. */
function tab(shows: Subject = APP) {
  const runs: { subject: Seen; progress: Progress; diagnostics: () => string; signal: AbortSignal; finish(result: AnalysisResult): void; fail(error: unknown): void }[] = [];
  const state = { shows };
  let connect: (port: chrome.runtime.Port) => void = () => undefined;
  const served: Tab = {
    host: "us1a.app.anaplan.com",
    subject: () => state.shows,
    run: (subject, progress, diagnostics, signal) => new Promise<AnalysisResult>((finish, fail) => { runs.push({ subject, progress, diagnostics, signal, finish, fail }); }),
    signedOut: error => error === SIGNED_OUT_ERROR,
  };
  serveTab({ id: EXTENSION, onConnect: { addListener: listener => { connect = listener; } } }, served);
  const open = (port = new FakePort()) => { connect(port as unknown as chrome.runtime.Port); return port; };
  return { runs, state, open };
}

describe("The Anaplan tab's end of the port to the results page", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.UTC(2026, 8, 28, 1, 59, 9)));
  });
  afterEach(() => { vi.useRealTimers(); });

  it("answers only its own extension, and only the results page's port", () => {
    const { runs, open } = tab();
    for (const port of [new FakePort(PORT_NAME, { id: "ponmlkjihgfedcbaponmlkjihgfedcba" }), new FakePort(PORT_NAME, {}), new FakePort(PORT_NAME, null),
      new FakePort("another-port"), new FakePort(""), new FakePort(`${PORT_NAME} `), new FakePort(PORT_NAME.toUpperCase())]) {
      open(port);
      port.say({ type: "run" });
      expect([port.refused, port.received, port.listening], `${port.name} from ${JSON.stringify(port.sender)}`).toEqual([true, [], 0]);
    }
    expect(runs).toEqual([]);
    const page = open();
    expect([page.refused, page.received]).toEqual([false, [{ type: "subject", subject: APP }]]);

    // An extension that has lost its own ID answers nobody: a port that names no sender is not "the same" as no ID.
    let connect: (port: chrome.runtime.Port) => void = () => undefined;
    serveTab({ id: undefined as never, onConnect: { addListener: listener => { connect = listener; } } },
      { host: "us1a.app.anaplan.com", subject: () => APP, run: () => new Promise(() => undefined), signedOut: () => false });
    for (const port of [new FakePort(PORT_NAME, null), new FakePort(PORT_NAME, {}), new FakePort()]) {
      connect(port as unknown as chrome.runtime.Port);
      expect([port.refused, port.received], JSON.stringify(port.sender)).toEqual([true, []]);
    }
  });

  it("says what the tab shows as soon as the port opens, and reads nothing until it is asked to run", () => {
    for (const shows of [APP, MODEL, { kind: "none" }] as Subject[]) {
      const { runs, open } = tab(shows);
      const page = open();
      expect(page.received, shows.kind).toEqual([{ type: "subject", subject: shows }]);
      // Anything but "run" starts nothing.
      for (const message of [undefined, null, "run", 7, {}, { type: "RUN" }, { type: "start" }, { run: true }, ["run"]]) page.say(message);
      expect(runs, shows.kind).toEqual([]);
    }
    const { runs, open } = tab(MODEL);
    const page = open();
    page.say({ type: "run" });
    expect(runs.map(run => run.subject)).toEqual([MODEL]);
    expect(page.take().slice(1)).toEqual([{ type: "log", text: "01:59:09 Cardigan dev: model FEDCBA9876543210FEDCBA9876543210 on us1a.app.anaplan.com" }]);
  });

  it("opens a module inside the tab's page when the page asks, and answers that very ask with what came of it, while a run goes on as well", async () => {
    const asked: string[][] = [];
    let answer = (): Promise<Opened> => Promise.resolve({ opened: true, detail: "Model Building opened it beside the modules open there" });
    let connect: (port: chrome.runtime.Port) => void = () => undefined;
    const runs: Seen[] = [];
    serveTab({ id: EXTENSION, onConnect: { addListener: listener => { connect = listener; } } }, { host: "us1a.app.anaplan.com", subject: () => MODEL,
      run: subject => { runs.push(subject); return new Promise<AnalysisResult>(() => undefined); }, signedOut: () => false,
      open: (model, module) => { asked.push([model, module]); return answer(); } });
    const page = new FakePort();
    connect(page as unknown as chrome.runtime.Port);
    page.say({ type: "run" });
    page.take();
    const opened = () => page.take().filter(message => message.type === "opened");
    page.say({ type: "open", nonce: "ask-1", model: MODEL.id, object: "102000000001" });
    await settle();
    expect([opened(), asked, runs]).toEqual([[{ type: "opened", nonce: "ask-1", opened: true, detail: "Model Building opened it beside the modules open there" }],
      [[MODEL.id, "102000000001"]], [MODEL]]);
    // The tab could not, and says why; an open that fails says what failed.
    answer = () => Promise.resolve({ opened: false, detail: "the tab shows another model" });
    page.say({ type: "open", nonce: "ask-2", model: MODEL.id, object: "102000000002" });
    answer = () => Promise.reject(new Error("the model's frame went away"));
    page.say({ type: "open", nonce: "ask-3", model: MODEL.id, object: "102000000003" });
    await settle();
    expect(opened()).toEqual([{ type: "opened", nonce: "ask-2", opened: false, detail: "the tab shows another model" },
      { type: "opened", nonce: "ask-3", opened: false, detail: "the model's frame went away" }]);
    // An ask that is not as the page writes one opens nothing and is not answered: no nonce to answer with, a nonce that is
    // no plain word, a model that is no 32-character ID, a module that is no ID in digits.
    for (const odd of [{ type: "open" }, { type: "open", model: MODEL.id, object: "1" }, { type: "open", nonce: "an ask", model: MODEL.id, object: "1" },
      { type: "open", nonce: "ask-4", model: "FEDCBA98", object: "1" }, { type: "open", nonce: "ask-5", model: MODEL.id, object: "10200000000x" },
      { type: "open", nonce: "ask-6", model: MODEL.id, object: 102000000001 }, { type: "OPEN", nonce: "ask-7", model: MODEL.id, object: "1" }]) page.say(odd);
    await settle();
    expect([opened(), asked.length]).toEqual([[], 3]);
    // A settings page's ID is a number too, and may be below nought: it is asked of the tab as a module's is. One that is
    // no number is not.
    answer = () => Promise.resolve({ opened: true, detail: "Model Building opened it beside the tabs open there" });
    page.say({ type: "open", nonce: "ask-8", model: MODEL.id, object: "-19" });
    page.say({ type: "open", nonce: "ask-9", model: MODEL.id, object: "9000000002" });
    for (const odd of ["--19", "-", "19-", "-1a"]) page.say({ type: "open", nonce: "ask-10", model: MODEL.id, object: odd });
    await settle();
    expect([opened().map(message => (message as { nonce?: string }).nonce), asked.slice(3)]).toEqual([["ask-8", "ask-9"], [[MODEL.id, "-19"], [MODEL.id, "9000000002"]]]);
  });

  it("answers that it opens nothing in its page where the tab cannot, as one of a page that is no Model Building", async () => {
    const { open } = tab(APP);
    const page = open();
    page.take();
    page.say({ type: "open", nonce: "ask-1", model: MODEL.id, object: "102000000001" });
    await settle();
    expect(page.take()).toEqual([{ type: "opened", nonce: "ask-1", opened: false, detail: "this tab opens nothing in its page" }]);
  });

  it("streams each step and each line of the log, stamped with its time, then the result in pieces and done", async () => {
    const { runs, open } = tab();
    const page = open();
    page.say({ type: "run" });
    const [run] = runs;
    run.progress.status("Reading the app…");
    vi.setSystemTime(new Date(Date.UTC(2026, 8, 28, 13, 0, 59, 999)));
    run.progress.log("app: 2 pages");
    // What the analysis writes into App Details.csv: every line so far, the first one naming the build, the subject and the host.
    expect(run.diagnostics()).toBe([HEADER, "01:59:09 Reading the app…", "13:00:59 app: 2 pages"].join("\r\n"));
    run.finish(result());
    await settle();
    expect(page.received).toEqual([{ type: "subject", subject: APP }, { type: "log", text: HEADER }, { type: "status", text: "Reading the app…" },
      { type: "log", text: "01:59:09 Reading the app…" }, { type: "log", text: "13:00:59 app: 2 pages" }, ...RESULT_MESSAGES]);
    expect(assemble(page.received)).toEqual(result());
  });

  it("ignores a run while one is in progress, and runs again when asked after it has ended", async () => {
    const { runs, open } = tab();
    const page = open();
    page.say({ type: "run" });
    page.say({ type: "run" });
    page.say({ type: "run" });
    expect(runs).toHaveLength(1);
    expect(page.types()).toEqual(["subject", "log"]);
    runs[0].finish(result());
    await settle();
    expect(page.take().map(message => message.type)).toEqual(["subject", "log", "result", "rows", "rows", "done"]);

    // Run again: a new run, with a log of its own.
    page.say({ type: "run" });
    expect(runs).toHaveLength(2);
    runs[1].progress.log("app: 2 pages");
    expect(runs[1].diagnostics()).toBe(`${HEADER}\r\n01:59:09 app: 2 pages`);
    runs[1].finish(result([["Demand board", 2]]));
    await settle();
    expect(assemble(page.take()).tables[1].rows).toEqual([["Demand board", 2]]);
  });

  it("reports why a run stopped in a sentence for the user, with the detail in the log, and a signed-out session by its code", async () => {
    const { runs, open } = tab();
    const page = open();
    page.say({ type: "run" });
    runs[0].progress.status("Reading page 1 of 2: Demand board");
    runs[0].fail(QUIET);
    await settle();
    // The page shows the message as it is: the count, the code or the status number is in the line of the log before it.
    expect(page.take().slice(4)).toEqual([{ type: "log", text: "01:59:09 stopped: the model's frame sent nothing for 300 s" }, { type: "error", message: QUIET.message }]);
    // A failure that has no detail of its own is logged in its own words.
    page.say({ type: "run" });
    runs[1].fail(new Failure("Open an app first: the address has no app ID."));
    await settle();
    expect(page.take().slice(1)).toEqual([{ type: "log", text: "01:59:09 stopped: Open an app first: the address has no app ID." },
      { type: "error", message: "Open an app first: the address has no app ID." }]);

    page.say({ type: "run" });
    runs[2].fail(SIGNED_OUT_ERROR);
    await settle();
    expect(page.take().slice(1)).toEqual([{ type: "log", text: "01:59:09 stopped: SIGNED_OUT (HTTP 401)" },
      { type: "error", message: "You're signed out of Anaplan. Sign in and try again.", code: "SIGNED_OUT" }]);
    expect(SIGNED_OUT).toBe("You're signed out of Anaplan. Sign in and try again.");

    // Any other error was not written for the user: its own text goes to the log, whether it is an Error or not.
    for (const [thrown, logged] of [[new TypeError("Cannot read properties of undefined (reading 'rows')"), "Cannot read properties of undefined (reading 'rows')"],
      [new Error("HTTP_ERROR (HTTP 403)"), "HTTP_ERROR (HTTP 403)"], ["plain text", "plain text"], [undefined, "undefined"], [{ toString: 1 }, "[object Object]"]] as const) {
      page.say({ type: "run" });
      runs.at(-1)!.fail(thrown);
      await settle();
      expect(page.take().slice(1), logged).toEqual([{ type: "log", text: `01:59:09 stopped: ${logged}` }, { type: "error", message: UNEXPECTED }]);
    }
    // A run that fails before it returns a promise.
    let connect: (port: chrome.runtime.Port) => void = () => undefined;
    serveTab({ id: EXTENSION, onConnect: { addListener: listener => { connect = listener; } } },
      { host: "us1a.app.anaplan.com", subject: () => APP, run: () => { throw new Failure("Open an app first: the address has no app ID."); }, signedOut: () => false });
    const other = new FakePort();
    connect(other as unknown as chrome.runtime.Port);
    other.say({ type: "run" });
    await settle();
    expect(other.received.at(-1)).toEqual({ type: "error", message: "Open an app first: the address has no app ID." });
    // It can be asked again afterwards.
    other.say({ type: "run" });
    await settle();
    expect(other.types().filter(type => type === "error")).toHaveLength(2);
  });

  it("tells a run that found a model's reader of another build by its code, with whether the page can reach its frame, and hands each run how the page asked for it", async () => {
    const asked: unknown[] = [];
    const fails: ((error: unknown) => void)[] = [];
    let connect: (port: chrome.runtime.Port) => void = () => undefined;
    serveTab({ id: EXTENSION, onConnect: { addListener: listener => { connect = listener; } } }, { host: "us1a.app.anaplan.com", subject: () => MODEL, signedOut: () => false,
      run: (_subject, _progress, _diagnostics, _signal, how) => { asked.push(how); return new Promise<AnalysisResult>((_finish, fail) => { fails.push(fail); }); } });
    const page = new FakePort();
    connect(page as unknown as chrome.runtime.Port);
    page.say({ type: "run" });
    const stale = "This Anaplan tab was open before Cardigan was updated or reloaded, and still holds the earlier Cardigan's model reader.";
    fails[0](new OldReader(stale, "the model's reader is build 0a1b2c3d4e5f; this script is build dev; its frame is on the page's own origin", true));
    await settle();
    expect(page.take().slice(-2)).toEqual([{ type: "log", text: "01:59:09 stopped: the model's reader is build 0a1b2c3d4e5f; this script is build dev; its frame is on the page's own origin" },
      { type: "error", message: stale, code: "OLD_READER", renewable: true }]);
    // A run asked for right after the page refreshed the tab says so to the tab; nothing else counts as that.
    page.say({ type: "run", afterRefresh: true });
    fails[1](new OldReader(stale, "its frame is on another host", false));
    await settle();
    expect(page.take().at(-1)).toEqual({ type: "error", message: stale, code: "OLD_READER", renewable: false });
    page.say({ type: "run", afterRefresh: "yes" });
    expect(asked).toEqual([{}, { afterRefresh: true }, {}]);
  });

  it("sends nothing for a run after its done or its error, whatever the run still reports, and none of it in the next run", async () => {
    const { runs, open } = tab();
    const page = open();
    page.say({ type: "run" });
    runs[0].finish(result());
    await settle();
    expect(page.take().at(-1)).toEqual({ type: "done" });
    // The socket to the last model closes after the result has gone out, and stomp.ts logs it when it does.
    runs[0].progress.log("socket closed code=1000");
    runs[0].progress.status("Reading names in Model one…");
    expect(page.received).toEqual([]);

    // Run again on the same port: what the earlier run still reports is no part of this run, which has its own log.
    page.say({ type: "run" });
    runs[0].progress.log("socket closed code=1000");
    runs[1].progress.log("app: 2 pages");
    runs[0].progress.status("Reading names in Model one…");
    expect(page.take()).toEqual([{ type: "log", text: HEADER }, { type: "log", text: "01:59:09 app: 2 pages" }]);
    expect(runs[1].diagnostics()).toBe(`${HEADER}\r\n01:59:09 app: 2 pages`);

    // The same after an error: the line that says why the run stopped is the last of its log.
    runs[1].fail(QUIET);
    await settle();
    expect(page.take()).toEqual([{ type: "log", text: "01:59:09 stopped: the model's frame sent nothing for 300 s" }, { type: "error", message: QUIET.message }]);
    runs[1].progress.status("Reading Versions…");
    runs[1].progress.log("Versions: 2 rows");
    expect(page.received).toEqual([]);

    // A second page that followed the run is told nothing more either.
    const [first, second] = [open(), open()];
    first.say({ type: "run" });
    second.say({ type: "run" });
    runs[2].finish(result());
    await settle();
    expect([first.take().at(-1), second.take().at(-1)]).toEqual([{ type: "done" }, { type: "done" }]);
    runs[2].progress.log("socket closed code=1000");
    expect([first.received, second.received]).toEqual([[], []]);
  });

  it("says so when the tab shows neither an app nor a model, and analyses what it shows at the time it is asked", async () => {
    const { runs, state, open } = tab({ kind: "none" });
    const page = open();
    page.say({ type: "run" });
    expect(runs).toEqual([]);
    expect(page.take()).toEqual([{ type: "subject", subject: { kind: "none" } }, { type: "error", message: NOTHING_TO_ANALYSE }]);
    expect(NOTHING_TO_ANALYSE).toBe("This tab is not showing an Anaplan app or a model. Open an app, or a model in Model Building, then choose Run again.");

    // The user opens a model in the same tab, then runs again: the subject is sent once, the run reads what is there now.
    state.shows = MODEL;
    page.say({ type: "run" });
    expect(runs.map(run => run.subject)).toEqual([MODEL]);
    expect(page.types()).toEqual(["log"]);
  });

  it("stops the run when the page goes away, and sends nothing to a closed port", async () => {
    const { runs, open } = tab();
    const page = open();
    page.say({ type: "run" });
    runs[0].progress.status("Reading page 1 of 40: Demand board");
    expect(runs[0].signal.aborted).toBe(false);
    const told = page.received.length;

    page.close();
    expect(runs[0].signal.aborted).toBe(true);
    expect(runs[0].signal.reason).toEqual(new Error("Stopped: the results page was closed."));
    // Whatever the run still reports, and however it ends, nothing is posted to the port and nothing throws.
    expect(() => { runs[0].progress.status("Reading page 2 of 40: Supply board"); runs[0].progress.log("page: late line"); }).not.toThrow();
    runs[0].finish(result());
    await settle();
    expect(page.received).toHaveLength(told);

    // The same for a run that ends in an error after it was stopped.
    const next = open();
    next.say({ type: "run" });
    next.close();
    runs[1].fail(runs[1].signal.reason);
    await settle();
    expect(next.types()).toEqual(["subject", "log"]);

    // A port that fails although no disconnect was seen does not stop the run for anyone else, or break it.
    const [watching, broken] = [open(), open()];
    watching.say({ type: "run" });
    broken.say({ type: "run" });
    broken.disconnect();
    runs[2].progress.status("Reading the app…");
    runs[2].finish(result());
    await settle();
    expect(runs[2].signal.aborted).toBe(false);
    expect(watching.types().slice(-4)).toEqual(["result", "rows", "rows", "done"]);
  });

  it("tells a page the run failed when a piece of the result cannot be sent to it, instead of done for a result that lacks rows", async () => {
    const { runs, open } = tab();
    const [page, other] = [open(), open()];
    page.say({ type: "run" });
    other.say({ type: "run" });
    // The page's port does not take the second table's rows, although it is open; the other page's port takes everything.
    page.refuses = message => message.type === "rows" && message.table === 1;
    runs[0].finish(result());
    await settle();
    // In place of the rest and of done: why, as the last line of the page's log, and the sentence for its user.
    const unsent = [{ type: "log", text: "01:59:09 stopped: the result could not be sent (Message length exceeded maximum allowed length.)" },
      { type: "error", message: "Cardigan finished reading but could not pass the result to this page. Choose Run again. If it keeps happening, choose Copy diagnostic log and send the log." }];
    expect(UNSENT).toBe(unsent[1].message);
    // What the page holds is not taken for a result.
    expect(page.take().slice(2)).toEqual([...RESULT_MESSAGES.slice(0, 2), ...unsent]);
    expect(other.take().slice(2)).toEqual(RESULT_MESSAGES);

    // The same whichever piece it is: the result itself, a table's first rows, or done. The run is over each time.
    for (const [refused, sent] of [["result", 0], ["rows", 1], ["done", 3]] as const) {
      page.refuses = message => message.type === refused;
      page.say({ type: "run" });
      runs.at(-1)!.finish(result());
      await settle();
      expect(page.take().slice(1), refused).toEqual([...RESULT_MESSAGES.slice(0, sent), ...unsent]);
    }
    expect(runs).toHaveLength(4);
  });

  it("starts the next run only once a stopped run has ended, for the page that asked meanwhile", async () => {
    const { runs, open } = tab();
    const first = open();
    first.say({ type: "run" });
    first.close();

    const second = open();
    second.say({ type: "run" });
    second.say({ type: "run" });
    // One run at a time: the stopped one is still ending.
    expect(runs).toHaveLength(1);
    expect(second.take()).toEqual([{ type: "subject", subject: APP }, { type: "status", text: "Stopping the previous run…" },
      { type: "status", text: "Stopping the previous run…" }]);

    runs[0].fail(runs[0].signal.reason);
    await settle();
    expect(runs).toHaveLength(2);
    expect(runs[1].signal.aborted).toBe(false);
    expect(second.take()).toEqual([{ type: "log", text: HEADER }]);
    runs[1].finish(result());
    await settle();
    expect(second.take()).toEqual(RESULT_MESSAGES);

    // A page that stopped waiting is not run for.
    const third = open();
    third.say({ type: "run" });
    third.close();
    const fourth = open();
    fourth.say({ type: "run" });
    fourth.close();
    runs[2].fail(runs[2].signal.reason);
    await settle();
    expect(runs).toHaveLength(3);
  });

  it("lets a second results page of the same tab follow the run in progress, and stops only when the last one goes", async () => {
    const { runs, open } = tab();
    const first = open();
    first.say({ type: "run" });
    runs[0].progress.status("Reading page 1 of 2: Demand board");
    runs[0].progress.log("page: boards answered 200");

    const second = open();
    second.say({ type: "run" });
    expect(runs).toHaveLength(1);
    // It is told where the run is and every line so far, then follows.
    expect(second.take()).toEqual([{ type: "subject", subject: APP }, { type: "status", text: "Reading page 1 of 2: Demand board" }, { type: "log", text: HEADER },
      { type: "log", text: "01:59:09 Reading page 1 of 2: Demand board" }, { type: "log", text: "01:59:09 page: boards answered 200" }]);
    second.say({ type: "run" });
    expect(second.received).toEqual([]);

    first.close();
    expect(runs[0].signal.aborted).toBe(false);
    runs[0].progress.status("Reading page 2 of 2: Draft page");
    runs[0].finish(result());
    await settle();
    expect(second.take()).toEqual([{ type: "status", text: "Reading page 2 of 2: Draft page" }, { type: "log", text: "01:59:09 Reading page 2 of 2: Draft page" },
      ...RESULT_MESSAGES]);
    expect(first.types()).toEqual(["subject", "log", "status", "log", "log"]);

    // Two following, both gone: stopped.
    const [third, fourth] = [open(), open()];
    third.say({ type: "run" });
    fourth.say({ type: "run" });
    third.close();
    expect(runs[1].signal.aborted).toBe(false);
    fourth.close();
    expect(runs[1].signal.aborted).toBe(true);
  });

  it("does not let a page follow a run of something else than the tab shows now", () => {
    const { runs, state, open } = tab();
    const first = open();
    first.say({ type: "run" });
    // The tab moved on to a model while its app is still being analysed for the first page.
    state.shows = MODEL;
    const second = open();
    second.say({ type: "run" });
    expect(runs).toHaveLength(1);
    expect(second.received).toEqual([{ type: "subject", subject: MODEL }, { type: "error", message: BUSY }]);
    expect(BUSY).toBe("Cardigan is still analysing what this Anaplan tab showed before. Wait for that to finish, or close its results page, then choose Run again.");
    state.shows = { kind: "app", id: "ffffffff-89ab-cdef-0123-456789abcdef" };
    const third = open();
    third.say({ type: "run" });
    expect(third.received.at(-1)).toEqual({ type: "error", message: BUSY });
    expect(runs[0].signal.aborted).toBe(false);
  });

  it("keeps the last 3,000 lines of a run's log", () => {
    const { runs, open } = tab();
    const page = open();
    page.say({ type: "run" });
    for (let line = 1; line <= 3004; line++) runs[0].progress.log(`line ${line}`);
    const kept = runs[0].diagnostics().split("\r\n");
    expect([kept.length, kept[0], kept.at(-1)]).toEqual([3000, "01:59:09 line 5", "01:59:09 line 3004"]);
    // The page was sent every line as it was written.
    expect(page.received).toHaveLength(1 + 1 + 3004);
  });

  it("sends a model's line items, several thousand rows, piece by piece within the size a message may have", async () => {
    const headers = ["", ...Array.from({ length: 25 }, (_, column) => `Column ${column + 1}`)];
    const rows = Array.from({ length: 5000 }, (_, index): Cell[] => [`Line item ${index}`, `IF 'Flag ${index}' THEN Volume[SELECT: Versions.Actual] * Price ELSE 0`,
      '{"dataType":"NUMBER","minimumSignificantDigits":4,"decimalPlaces":2,"units":"NONE"}', ...Array.from({ length: 23 }, (_, column) => `value ${index}.${column}`)]);
    const exported: AnalysisResult = { kind: "model", name: "Model one", id: MODEL.id, zipName: "Model one - Model Export - 2026-09-28.zip", summary: ["Line Items: 5000 rows"],
      tables: [{ file: "Model Details.csv", label: "Model Details", headers: ["Section", "Detail", "Value"], rows: [["Model", "Model", "Model one"]], guard: true, details: true },
        { file: "Line Items.csv", label: "Line Items", headers, rows, guard: false }] };
    const { runs, open } = tab(MODEL);
    const page = open();
    page.say({ type: "run" });
    runs[0].finish(exported);
    await settle();

    const sent = page.received.filter((message): message is Extract<TabMessage, { type: "rows" }> => message.type === "rows");
    expect(sent.map(piece => [piece.table, piece.rows.length])).toEqual([[0, 1], ...Array(10).fill([1, ROWS_MAX])]);
    // Half a megabyte at most here; Chrome allows a message 64 MB.
    expect(page.largest).toBeLessThan(500_000);
    expect(page.types()).toEqual(["subject", "log", "result", ...Array(11).fill("rows"), "done"]);
    expect(assemble(page.received)).toEqual(exported);
  });
});
