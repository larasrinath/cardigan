import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FRESH_MS, ROWS_MAX, type TabMessage } from "../protocol.js";
import type { AnalysisResult, Cell } from "../result-types.js";
import { resultZip } from "../result-zip.test-support.js";
import { CONTENT_SCRIPT } from "../protocol.js";
import {
  describeState, MAX_LOG_LINES, NO_REASON, openedJustNow, repairTab, ResultsClient, runLabel, tabIdFrom, UNREADABLE, withoutOpened, type Repair, type RunState, type TabPort,
} from "./connection.js";

/** A port as the page holds it. What the page posts arrives as a copy, as Chrome delivers it, and so does what the tab sends. */
class FakePort implements TabPort {
  readonly posted: unknown[] = [];
  closedByPage = false;
  private closed = false;
  private readonly messageListeners: ((message: unknown) => void)[] = [];
  private readonly disconnectListeners: (() => void)[] = [];
  readonly onMessage = { addListener: (listener: (message: unknown) => void) => { this.messageListeners.push(listener); } };
  readonly onDisconnect = { addListener: (listener: () => void) => { this.disconnectListeners.push(listener); } };
  postMessage(message: unknown): void {
    if (this.closed) throw new Error("Attempting to use a disconnected port object");
    this.posted.push(structuredClone(message));
  }
  /** The tab's side has gone, and Chrome has not said so yet: posting throws before the port's closing is heard. */
  breakSilently(): void {
    this.closed = true;
  }
  disconnect(): void {
    this.closed = true;
    this.closedByPage = true;
  }
  /** The tab's content script sends a message. */
  send(message: TabMessage | Record<string, unknown> | null | string): void {
    for (const listener of this.messageListeners) listener(structuredClone(message));
  }
  /** The tab's side goes away: the tab closed, left the page, or never had a content script. */
  drop(): void {
    this.closed = true;
    for (const listener of this.disconnectListeners) listener();
  }
}

/** A page's client with every port it opened, every state it was told and the log as last shown. Unless a test says
 * otherwise, it is a page the icon has just opened. */
function page(options: { noTab?: boolean; closeReason?: string; connect?: () => TabPort; autoRun?: boolean; repair?: () => Promise<Repair>;
  retries?: { count: number; pauseMs: number }; tabGone?: () => Promise<boolean>; wait?: (ms: number) => Promise<void> } = {}) {
  const ports: FakePort[] = [];
  const states: RunState[] = [];
  let shownLog: string[] = [];
  const client = new ResultsClient({
    connect: options.noTab ? undefined : options.connect ?? (() => {
      const port = new FakePort();
      ports.push(port);
      return port;
    }),
    autoRun: options.autoRun ?? true,
    closeReason: () => options.closeReason,
    repair: options.repair,
    retries: options.retries,
    tabGone: options.tabGone,
    wait: options.wait,
    onState: state => states.push(state),
    onLog: lines => { shownLog = [...lines]; },
  });
  return { client, ports, states, phases: () => states.map(state => state.phase), log: () => shownLog };
}

const APP = { kind: "app", id: "01234567-89ab-cdef-0123-456789abcdef" } as const;
const MODEL = { kind: "model", id: "0123456789ABCDEF0123456789ABCDEF" } as const;
const RUN = { type: "run" };

/** A result as the tab holds it, and as it sends it: first with every table empty, then its rows in pieces. */
const full = (): AnalysisResult => ({
  kind: "app", name: "Demo app", id: APP.id, zipName: "Demo app - App Export - 2026-10-03.zip", summary: ["2 of 2 pages analysed, 3 cards."],
  tables: [
    { file: "App Details.csv", label: "App Details", headers: ["Section", "Detail", "Value"], rows: [["App", "App", "Demo app"], ["Notes", "Names", "All models answered."]], guard: true, details: true },
    { file: "Pages.csv", label: "Pages", headers: ["App", "Page", "Total cards"], rows: [["Demo app", "Overview", 2], ["Demo app", "Detail", 1]], guard: true },
    { file: "Cards.csv", label: "Cards", headers: ["Page", "Card #", "Card title"], rows: [["Overview", 1, "Sales"], ["Overview", 2, "=Margin"], ["Detail", 1, "Stores"]], guard: true },
    { file: "Filters.csv", label: "Filters", headers: ["Page", "Card #"], rows: [], guard: true },
  ],
});
const empty = (): AnalysisResult => ({ ...full(), tables: full().tables.map(table => ({ ...table, rows: [] })) });

describe("The results page's address", () => {
  it("names the Anaplan tab to read, and nothing else counts as a tab", () => {
    expect([tabIdFrom("?tab=123"), tabIdFrom("?other=1&tab=7"), tabIdFrom("?tab=0")]).toEqual([123, 7, 0]);
    expect(["", "?", "?tab=", "?tab=abc", "?tab=12a", "?tab=-1", "?tab=1.5", "?tab= 1", "?tab=12345678901", "?table=1"].map(tabIdFrom).filter(id => id !== undefined)).toEqual([]);
  });

  it("says the icon has just opened the page only when the click it names is less than a minute old", () => {
    const now = Date.UTC(2026, 9, 3, 14, 2, 5);
    const at = (opened: number | string) => openedJustNow(`?tab=7&opened=${opened}`, now);
    expect([at(now), at(now - 1), at(now - FRESH_MS + 1)]).toEqual([true, true, true]);
    // A minute ago or more: a page that was reloaded, restored from history or after a restart, or kept as a bookmark.
    expect([at(now - FRESH_MS), at(now - 3_600_000), at(0)]).toEqual([false, false, false]);
    // A time still to come is not the icon's, and neither is anything that is not a time.
    expect([at(now + 1), at(now + FRESH_MS), at(""), at("now"), at("-1"), at("1.79e12"), at(`+${now}`), at(`${now}0000`)].filter(fresh => fresh)).toEqual([]);
    // Without the parameter nothing opened the page just now; the first value counts when it is there twice.
    expect([openedJustNow("", now), openedJustNow("?tab=7", now), openedJustNow(`?opened=${now}`, now), openedJustNow(`?opened=x&opened=${now}`, now)]).toEqual([false, false, true, false]);
  });

  it("gives the address without the time of the click, and says when there is none to take out", () => {
    expect(withoutOpened("?tab=7&opened=1790000000000")).toBe("?tab=7");
    expect(withoutOpened("?opened=1&tab=7&opened=2")).toBe("?tab=7");
    expect(withoutOpened("?opened=1")).toBe("");
    expect([withoutOpened("?tab=7"), withoutOpened(""), withoutOpened("?openedx=1")]).toEqual([undefined, undefined, undefined]);
    // The tab reads the same before and after, and what is left is no longer a click.
    const rest = withoutOpened(`?tab=123&opened=${Date.UTC(2026, 9, 3)}`) ?? "";
    expect([tabIdFrom(rest), openedJustNow(rest, Date.UTC(2026, 9, 3))]).toEqual([123, false]);
  });
});

describe("The results page's connection to the Anaplan tab", () => {
  const NOW = new Date(Date.UTC(2026, 9, 3, 14, 2, 5));
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it("analyses an app by itself: one run as soon as the tab says what it shows, progress, then the result put together", () => {
    const { client, ports, states, phases, log } = page();
    client.start();
    expect(phases()).toEqual(["connecting"]);
    expect(ports).toHaveLength(1);
    // Nothing is asked of the tab until it says what it shows.
    expect(ports[0].posted).toEqual([]);

    ports[0].send({ type: "subject", subject: APP });
    expect(ports[0].posted).toEqual([RUN]);
    expect(client.state).toEqual({ phase: "running", status: "Starting the analysis…" });

    ports[0].send({ type: "status", text: "Reading page 1 of 2: Overview" });
    ports[0].send({ type: "log", text: "14:02:05 app: 2 pages" });
    ports[0].send({ type: "status", text: "Reading page 2 of 2: Detail" });
    ports[0].send({ type: "log", text: "14:02:06 Demo model: 3 modules" });
    expect(client.state).toEqual({ phase: "running", status: "Reading page 2 of 2: Detail" });
    expect(log()).toEqual(["14:02:05 app: 2 pages", "14:02:06 Demo model: 3 modules"]);

    // The result: first every table without its rows, then the rows table by table, in pieces, then "done".
    const expected = full();
    ports[0].send({ type: "result", result: empty() });
    expect(client.state).toEqual({ phase: "running", status: "Receiving the result…" });
    ports[0].send({ type: "rows", table: 0, rows: expected.tables[0].rows });
    ports[0].send({ type: "rows", table: 1, rows: expected.tables[1].rows.slice(0, 1) });
    ports[0].send({ type: "rows", table: 1, rows: expected.tables[1].rows.slice(1) });
    ports[0].send({ type: "rows", table: 2, rows: expected.tables[2].rows.slice(0, 2) });
    ports[0].send({ type: "rows", table: 2, rows: [] });
    ports[0].send({ type: "rows", table: 2, rows: expected.tables[2].rows.slice(2) });
    expect(client.state.phase).toBe("running");
    ports[0].send({ type: "done" });

    expect(client.state).toEqual({ phase: "done", result: expected, received: NOW });
    expect(states[states.length - 1]).toEqual({ phase: "done", result: expected, received: NOW });
    // What the page holds is the tab's own result: written as a zip, the two are the same bytes.
    if (client.state.phase !== "done") throw new Error("no result");
    expect(resultZip(client.state.result, NOW)).toEqual(resultZip(expected, NOW));
    // The result keeps the one time it was complete at, however late it is asked for: a zip stamped with it is the same bytes.
    const { result, received } = client.state;
    const first = resultZip(result, received);
    vi.setSystemTime(new Date(Date.UTC(2026, 9, 3, 16, 30, 0)));
    expect(resultZip(result, client.state.received)).toEqual(first);
    expect(resultZip(result)).not.toEqual(first);
    // Only one run was asked for, and the port stays open for the next.
    expect(ports[0].posted).toEqual([RUN]);
    expect(ports[0].closedByPage).toBe(false);
  });

  it("analyses a model the same way, however many pieces its rows come in", () => {
    const { client, ports } = page();
    client.start();
    ports[0].send({ type: "subject", subject: MODEL });
    expect(ports[0].posted).toEqual([RUN]);
    const rows: Cell[][] = Array.from({ length: ROWS_MAX * 2 + 7 }, (_, index) => [`Line item ${index}`, index, "=A + B"]);
    const result: AnalysisResult = {
      kind: "model", name: "Model one", id: MODEL.id, zipName: "Model one - Model Export - 2026-10-03.zip", summary: ["Line Items: 1007 rows"],
      tables: [
        { file: "Model Details.csv", label: "Model Details", headers: ["Section", "Detail", "Value"], rows: [["Model", "Model", "Model one"]], guard: true, details: true },
        { file: "Line Items.csv", label: "Line Items", headers: ["", "Cell Count", "Formula"], rows, guard: false },
      ],
    };
    ports[0].send({ type: "result", result: { ...result, tables: result.tables.map(table => ({ ...table, rows: [] })) } });
    ports[0].send({ type: "rows", table: 0, rows: result.tables[0].rows });
    for (let start = 0; start < rows.length; start += ROWS_MAX) ports[0].send({ type: "rows", table: 1, rows: rows.slice(start, start + ROWS_MAX) });
    ports[0].send({ type: "done" });
    expect(client.state).toEqual({ phase: "done", result, received: NOW });
  });

  it("reads nothing by itself on a page the icon did not just open: it says what the tab shows and waits for the run control", () => {
    for (const [subject, message] of [[APP, "That Anaplan tab shows an app."], [MODEL, "That Anaplan tab shows a model."]] as const) {
      const { client, ports, phases } = page({ autoRun: false });
      client.start();
      expect(client.asked).toBe(false);
      ports[0].send({ type: "subject", subject });
      expect(client.state).toEqual({ phase: "ready", kind: subject.kind });
      expect(describeState(client.state, client.asked)).toEqual({ title: "Ready to analyse", message,
        hint: "Choose Run to analyse it. This page starts by itself only when the Cardigan icon has just opened it." });
      // Nothing the tab sends afterwards starts a run either.
      ports[0].send({ type: "subject", subject: APP });
      ports[0].send({ type: "status", text: "late" });
      ports[0].send({ type: "done" });
      expect(ports[0].posted).toEqual([]);
      expect(phases()).toEqual(["connecting", "ready"]);

      // The run control: the analysis runs on the open port, and the control is Run again from then on.
      client.runAgain();
      expect(ports).toHaveLength(1);
      expect(ports[0].posted).toEqual([RUN]);
      expect([client.asked, client.state.phase]).toEqual([true, "running"]);
    }
  });

  it("names the run control as it reads: Run until an analysis was asked for, Run again after", () => {
    expect([runLabel(false), runLabel(true)]).toEqual(["Run", "Run again"]);
    const { client, ports } = page({ autoRun: false });
    client.start();
    ports[0].send({ type: "subject", subject: { kind: "none" } });
    expect(ports[0].posted).toEqual([]);
    expect(describeState(client.state, client.asked).hint).toBe(
      "Open an app, or a model in Model Building, in that tab; if it is still loading, give it a moment. Then choose Run.");
    // The control asks the tab afresh, and what the tab then shows is analysed without another click.
    client.runAgain();
    expect(client.asked).toBe(true);
    ports[1].send({ type: "subject", subject: { kind: "none" } });
    expect(describeState(client.state, client.asked).hint).toBe(
      "Open an app, or a model in Model Building, in that tab; if it is still loading, give it a moment. Then choose Run again.");
    client.runAgain();
    ports[2].send({ type: "subject", subject: APP });
    expect(ports[2].posted).toEqual([RUN]);
    // A page the icon has just opened has asked from the start.
    expect(page().client.asked).toBe(true);
  });

  it("on a page the icon did not just open, connects anew for the run control when the tab is gone", () => {
    const { client, ports, phases } = page({ autoRun: false });
    client.start();
    ports[0].send({ type: "subject", subject: APP });
    // The tab is closed, or leaves the page, while the page waits: the page still says what it was shown.
    ports[0].drop();
    expect(client.state).toEqual({ phase: "ready", kind: "app" });
    client.runAgain();
    expect(ports).toHaveLength(2);
    expect(ports[0].posted).toEqual([]);
    ports[1].drop();
    expect(phases()).toEqual(["connecting", "ready", "connecting", "unreachable"]);
    // And when it never answered at all.
    const never = page({ autoRun: false });
    never.client.start();
    never.ports[0].drop();
    expect(never.client.state).toEqual({ phase: "unreachable" });
    never.client.runAgain();
    never.ports[1].send({ type: "subject", subject: MODEL });
    expect(never.ports[1].posted).toEqual([RUN]);
  });

  it("says so when the address names no tab, and has nothing to run again", () => {
    // The icon has just opened the page, but the address names no tab: nothing is asked, so nothing has been asked for.
    const { client, ports, phases } = page({ noTab: true });
    expect([client.asked, runLabel(client.asked)]).toEqual([false, "Run"]);
    client.start();
    client.runAgain();
    expect(phases()).toEqual(["no-tab", "no-tab"]);
    expect(ports).toEqual([]);
    expect([client.asked, runLabel(client.asked)]).toEqual([false, "Run"]);
    expect(describeState(client.state, client.asked)).toEqual({ title: "No Anaplan tab", message: "This page was opened without an Anaplan tab to read.",
      hint: "Open an app or a model in Anaplan, then click the Cardigan icon on that tab." });
  });

  it("says an Anaplan page is not an app or a model, asks nothing of it, and asks afresh on Run again", () => {
    const { client, ports, phases } = page();
    client.start();
    ports[0].send({ type: "subject", subject: { kind: "none" } });
    expect(phases()).toEqual(["connecting", "no-subject"]);
    expect(ports[0].posted).toEqual([]);
    expect(describeState(client.state, client.asked)).toEqual({ title: "Nothing to analyse", message: "That Anaplan page is not an app or a model.",
      hint: "Open an app, or a model in Model Building, in that tab; if it is still loading, give it a moment. Then choose Run again." });

    // The tab says what it shows once per port, and a model page can say "none" for its first seconds, so Run again
    // opens a new port and asks again; the old one is closed.
    client.runAgain();
    expect(ports).toHaveLength(2);
    expect(ports[0].closedByPage).toBe(true);
    expect(ports[0].posted).toEqual([]);
    ports[1].send({ type: "subject", subject: APP });
    expect(ports[1].posted).toEqual([RUN]);
    expect(client.state.phase).toBe("running");
  });

  it("treats a subject it does not know as no app and no model", () => {
    for (const subject of [undefined, null, "app", { kind: "dashboard", id: "x" }, {}]) {
      const { client, ports } = page();
      client.start();
      ports[0].send({ type: "subject", subject });
      expect(client.state).toEqual({ phase: "no-subject" });
      expect(ports[0].posted).toEqual([]);
    }
  });

  it("says it cannot reach the tab, and to refresh an Anaplan one, when the port closes before any answer", () => {
    // One case for every tab without the content script: not an Anaplan page, not refreshed since the extension was
    // installed or reloaded, still loading, or closed. Chrome closes the port at once and says why.
    const { client, ports, phases, log } = page({ closeReason: "Could not establish connection. Receiving end does not exist." });
    client.start();
    ports[0].drop();
    expect(phases()).toEqual(["connecting", "unreachable"]);
    expect(describeState(client.state, client.asked)).toEqual({ title: "Not connected", message: "Cardigan cannot reach that tab.",
      hint: "If it is an Anaplan app or model that is still loading, wait for it, then choose Run again. Otherwise refresh it, then click the Cardigan icon on it." });
    expect(log()).toEqual(["14:02:05 The tab did not answer: Could not establish connection. Receiving end does not exist."]);

    // After the refresh the same tab answers: Run again connects anew and the analysis starts.
    client.runAgain();
    expect(ports).toHaveLength(2);
    expect(log()).toEqual([]);
    ports[1].send({ type: "subject", subject: MODEL });
    expect(ports[1].posted).toEqual([RUN]);
    expect(phases()).toEqual(["connecting", "unreachable", "connecting", "running"]);
  });

  it("says the same when Chrome refuses the connection outright", () => {
    const { client, phases, log } = page({ connect: () => { throw new Error("No tab with id: 99."); } });
    client.start();
    expect(phases()).toEqual(["connecting", "unreachable"]);
    expect(log()).toEqual(["14:02:05 The tab did not answer: No tab with id: 99."]);
  });

  it("shows the tab's own words when the run fails, and runs again on the same port", () => {
    const { client, ports } = page();
    client.start();
    ports[0].send({ type: "subject", subject: APP });
    ports[0].send({ type: "log", text: "14:02:05 GET /apps 401" });
    ports[0].send({ type: "error", message: "You're signed out of Anaplan. Sign in and try again.", code: "SIGNED_OUT" });
    expect(client.state).toEqual({ phase: "failed", message: "You're signed out of Anaplan. Sign in and try again." });
    // The tab's message says what to do: the page puts no advice of its own under it.
    expect(describeState(client.state, client.asked)).toEqual({ title: "The analysis stopped", message: "You're signed out of Anaplan. Sign in and try again.", hint: "" });
    // The log of the failed run stays, to be copied.
    expect(client.log).toEqual(["14:02:05 GET /apps 401"]);

    client.runAgain();
    expect(ports).toHaveLength(1);
    expect(ports[0].posted).toEqual([RUN, RUN]);
    expect(client.state).toEqual({ phase: "running", status: "Starting the analysis…" });
    expect(client.log).toEqual([]);

    ports[0].send({ type: "error", message: "Anaplan could not be reached. Check your connection, then choose Run again." });
    expect(client.state).toEqual({ phase: "failed", message: "Anaplan could not be reached. Check your connection, then choose Run again." });
    ports[0].send({ type: "run-again-please" });
    ports[0].send({ type: "error" });
    expect(client.state).toEqual({ phase: "failed", message: "Anaplan could not be reached. Check your connection, then choose Run again." });
  });

  it("shows the text of an error without a code: nothing to analyse, or the tab busy with something else", () => {
    const { client, ports } = page();
    client.start();
    ports[0].send({ type: "subject", subject: MODEL });
    // The tab may first say it is stopping a run an earlier page asked for; that is a status like any other.
    ports[0].send({ type: "status", text: "Stopping the previous run…" });
    expect(describeState(client.state, client.asked).message).toBe("Stopping the previous run…");
    const busy = "Cardigan is still analysing what this Anaplan tab showed before. Wait for that to finish, or close its results page, then choose Run again.";
    ports[0].send({ type: "error", message: busy });
    expect(describeState(client.state, client.asked)).toEqual({ title: "The analysis stopped", message: busy, hint: "" });
    // No run started in the tab, so the tab wrote nothing into a log: the page writes the one line, and there is a log to copy.
    expect(client.log).toEqual([`14:02:05 stopped: ${busy}`]);
    // A run that failed has its own lines, the tab's last one saying why: the page adds none.
    client.runAgain();
    ports[0].send({ type: "log", text: "14:02:06 stopped: GET /apps 503" });
    ports[0].send({ type: "error", message: "Anaplan could not be reached. Check your connection, then choose Run again." });
    expect(client.log).toEqual(["14:02:06 stopped: GET /apps 503"]);
  });

  it("gives an error without words a message of its own, which says what to do in the words the tab's messages use", () => {
    for (const error of [{ type: "error", message: "" }, { type: "error" }, { type: "error", message: 503 }]) {
      const { client, ports } = page();
      client.start();
      ports[0].send({ type: "subject", subject: APP });
      ports[0].send(error);
      expect(client.state).toEqual({ phase: "failed", message: NO_REASON });
      // The message names the button that copies the log, so there is a log: the page's own line.
      expect(client.log).toEqual([`14:02:05 stopped: ${NO_REASON}`]);
    }
    expect(NO_REASON).toBe("The analysis stopped without saying why. Choose Run again. If it keeps happening, choose Copy diagnostic log and send the log.");
  });

  it("takes an error in place of done as a failed run, and keeps nothing of the result that was arriving", () => {
    // A piece of the result could not be sent: the tab says why in a last line of the log, then that the run failed.
    const { client, ports, log } = page();
    client.start();
    ports[0].send({ type: "subject", subject: APP });
    ports[0].send({ type: "result", result: empty() });
    ports[0].send({ type: "rows", table: 0, rows: full().tables[0].rows });
    ports[0].send({ type: "rows", table: 1, rows: full().tables[1].rows.slice(0, 1) });
    ports[0].send({ type: "log", text: "14:02:07 stopped: the result could not be sent (Message length exceeded maximum allowed length.)" });
    const unsent = "Cardigan finished reading but could not pass the result to this page. Choose Run again. If it keeps happening, choose Copy diagnostic log and send the log.";
    ports[0].send({ type: "error", message: unsent });
    expect(client.state).toEqual({ phase: "failed", message: unsent });
    expect(log()).toEqual(["14:02:07 stopped: the result could not be sent (Message length exceeded maximum allowed length.)"]);
    // What still arrives of that run completes nothing.
    ports[0].send({ type: "rows", table: 1, rows: full().tables[1].rows.slice(1) });
    ports[0].send({ type: "done" });
    expect(client.state).toEqual({ phase: "failed", message: unsent });
    // The next run starts from its own "result": the rows that had arrived are not in it.
    client.runAgain();
    ports[0].send({ type: "result", result: empty() });
    ports[0].send({ type: "done" });
    if (client.state.phase !== "done") throw new Error("no result");
    expect(client.state.result.tables.map(table => table.rows.length)).toEqual([0, 0, 0, 0]);
  });

  it("says the Anaplan tab was closed or left the page when the port closes during a run, and reconnects on Run again", () => {
    const { client, ports, phases, log } = page();
    client.start();
    ports[0].send({ type: "subject", subject: APP });
    ports[0].send({ type: "log", text: "14:02:05 app: 2 pages" });
    ports[0].send({ type: "result", result: empty() });
    ports[0].drop();
    expect(phases()).toEqual(["connecting", "running", "running", "interrupted"]);
    expect(describeState(client.state, client.asked)).toEqual({ title: "The analysis stopped", message: "The Anaplan tab was closed or left the page before the analysis finished.",
      hint: "Open the app or model again, then click the Cardigan icon or choose Run again." });
    expect(log()).toEqual(["14:02:05 app: 2 pages", "14:02:05 The connection to the tab closed."]);

    client.runAgain();
    expect(ports).toHaveLength(2);
    ports[1].send({ type: "subject", subject: APP });
    // The half result of the run that was cut off is gone: this one starts from its own "result".
    ports[1].send({ type: "done" });
    expect(client.state).toEqual({ phase: "failed", message: UNREADABLE });
  });

  it("keeps a finished result when the tab is closed afterwards, and reconnects on Run again", () => {
    const { client, ports, phases } = page();
    client.start();
    ports[0].send({ type: "subject", subject: APP });
    ports[0].send({ type: "result", result: full() });
    ports[0].send({ type: "done" });
    ports[0].drop();
    expect(client.state).toEqual({ phase: "done", result: full(), received: NOW });

    client.runAgain();
    expect(ports).toHaveLength(2);
    expect(phases().slice(-1)).toEqual(["connecting"]);
    ports[1].drop();
    expect(client.state).toEqual({ phase: "unreachable" });
  });

  it("runs again on the open port after a result, and ignores Run again while a run is in progress", () => {
    const { client, ports } = page();
    client.start();
    client.runAgain(); // still connecting: asks afresh on a new port
    expect(ports).toHaveLength(2);
    ports[1].send({ type: "subject", subject: APP });
    client.runAgain();
    client.runAgain();
    expect(ports[1].posted).toEqual([RUN]);
    ports[1].send({ type: "result", result: full() });
    ports[1].send({ type: "done" });
    client.runAgain();
    expect(ports).toHaveLength(2);
    expect(ports[1].posted).toEqual([RUN, RUN]);
    // A second run's result replaces the first; it is not added to it.
    ports[1].send({ type: "result", result: empty() });
    ports[1].send({ type: "rows", table: 2, rows: [["Overview", 1, "Sales"]] });
    ports[1].send({ type: "done" });
    if (client.state.phase !== "done") throw new Error("no result");
    expect(client.state.result.tables.map(table => table.rows.length)).toEqual([0, 0, 1, 0]);
  });

  it("takes a port that throws on the first run as a tab that did not answer", () => {
    const { client, ports, phases, log } = page();
    client.start();
    ports[0].breakSilently();
    ports[0].send({ type: "subject", subject: APP });
    expect(phases()).toEqual(["connecting", "unreachable"]);
    expect([ports[0].posted, log(), client.asked]).toEqual([[], ["14:02:05 The tab did not answer."], true]);
    // Chrome's own word that the port closed, when it comes, changes nothing more.
    ports[0].drop();
    expect(phases()).toEqual(["connecting", "unreachable"]);
    // Run again connects anew, and what the tab then shows is analysed.
    client.runAgain();
    ports[1].send({ type: "subject", subject: APP });
    expect([ports.length, ports[1].posted, client.state.phase]).toEqual([2, [RUN], "running"]);
  });

  it("opens a new port for Run again when the open one throws, and runs on that", () => {
    const { client, ports, phases } = page();
    client.start();
    ports[0].send({ type: "subject", subject: APP });
    ports[0].send({ type: "result", result: full() });
    ports[0].send({ type: "done" });
    ports[0].breakSilently();
    client.runAgain();
    // Nothing went out on the broken port; the new one is asked what the tab shows, and then for the analysis.
    expect([ports.length, ports[0].posted, ports[0].closedByPage, phases().slice(-1)]).toEqual([2, [RUN], true, ["connecting"]]);
    ports[1].send({ type: "subject", subject: MODEL });
    expect([ports[1].posted, client.state]).toEqual([[RUN], { phase: "running", status: "Starting the analysis…" }]);
    // The same on a page that waits for the run control: its first run, on a port that has gone meanwhile.
    const waiting = page({ autoRun: false });
    waiting.client.start();
    waiting.ports[0].send({ type: "subject", subject: APP });
    waiting.ports[0].breakSilently();
    waiting.client.runAgain();
    expect([waiting.ports.length, waiting.ports[0].posted, waiting.client.state.phase]).toEqual([2, [], "connecting"]);
    waiting.ports[1].send({ type: "subject", subject: APP });
    expect(waiting.ports[1].posted).toEqual([RUN]);
  });

  it("no longer listens to a port it has replaced", () => {
    const { client, ports } = page();
    client.start();
    client.runAgain();
    ports[0].send({ type: "subject", subject: APP });
    ports[0].drop();
    expect(ports[0].posted).toEqual([]);
    expect(client.state).toEqual({ phase: "connecting" });
    ports[1].send({ type: "subject", subject: MODEL });
    ports[0].send({ type: "error", message: "late" });
    expect(client.state.phase).toBe("running");
  });

  it("starts a run only on the first subject of a port, so a result on the page is never replaced unasked", () => {
    const { client, ports } = page();
    client.start();
    ports[0].send({ type: "subject", subject: APP });
    ports[0].send({ type: "result", result: full() });
    ports[0].send({ type: "done" });
    ports[0].send({ type: "subject", subject: MODEL });
    ports[0].send({ type: "status", text: "late" });
    expect(ports[0].posted).toEqual([RUN]);
    expect(client.state.phase).toBe("done");
  });

  it("stops with a clear message, instead of showing a wrong result, when the pieces do not fit", () => {
    const cases: Record<string, (TabMessage | Record<string, unknown>)[]> = {
      "rows before the result": [{ type: "rows", table: 0, rows: [["a"]] }],
      "done before the result": [{ type: "done" }],
      "rows for a table the result does not have": [{ type: "result", result: empty() }, { type: "rows", table: 4, rows: [["a"]] }],
      "rows for a table that is not a number": [{ type: "result", result: empty() }, { type: "rows", table: "1", rows: [["a"]] }],
      "rows that are not rows": [{ type: "result", result: empty() }, { type: "rows", table: 1, rows: "a" }],
      "a row that is not a list of cells": [{ type: "result", result: empty() }, { type: "rows", table: 1, rows: [["a"], "b"] }],
      "a result without tables": [{ type: "result", result: { kind: "app", name: "x", summary: [] } }],
      "a result whose table has no rows": [{ type: "result", result: { ...empty(), tables: [{ file: "a.csv", headers: [] }] } }],
      "a result whose table has no headers": [{ type: "result", result: { ...empty(), tables: [{ file: "a.csv", label: "a", rows: [], guard: true }] } }],
      "a result whose headers are not a list": [{ type: "result", result: { ...empty(), tables: [{ file: "a.csv", headers: "Page", rows: [] }] } }],
      "a result with a table that is nothing": [{ type: "result", result: { ...empty(), tables: [...empty().tables, null] } }],
      "a result with a table that is a text": [{ type: "result", result: { ...empty(), tables: ["Cards.csv"] } }],
      "a result that is nothing": [{ type: "result", result: null }],
      "a result that is a text": [{ type: "result", result: "done" }],
      "a result without a summary": [{ type: "result", result: { ...empty(), summary: undefined } }],
      "no result at all": [{ type: "result" }],
    };
    const reasons = new Set<string>();
    for (const [name, messages] of Object.entries(cases)) {
      const { client, ports, log } = page();
      client.start();
      ports[0].send({ type: "subject", subject: APP });
      for (const message of messages) ports[0].send(message);
      expect(client.state, name).toEqual({ phase: "failed", message: UNREADABLE });
      // The message is for the user; the log says which piece did not fit, so there is something to copy and send.
      expect(log(), name).toHaveLength(1);
      expect(log()[0], name).toMatch(/^14:02:05 stopped: the tab (sent|said) /);
      reasons.add(log()[0]);
      // What still arrives of that run changes nothing.
      ports[0].send({ type: "rows", table: 1, rows: [["late"]] });
      ports[0].send({ type: "done" });
      expect(client.state.phase, name).toBe("failed");
    }
    // A result, its rows, and "done" each have their own reason.
    expect([...reasons].sort()).toEqual(["14:02:05 stopped: the tab said its result was complete before it sent one",
      "14:02:05 stopped: the tab sent a result the page cannot read", "14:02:05 stopped: the tab sent rows that fit no table of its result"]);
  });

  it("ignores what is not a message, and progress outside a run", () => {
    const { client, ports, phases, log } = page();
    client.start();
    for (const junk of [null, "run", { type: "status", text: "early" }, { type: "log", text: "early" }, { type: "done" }, {}]) ports[0].send(junk);
    expect(phases()).toEqual(["connecting"]);
    expect(log()).toEqual([]);
    ports[0].send({ type: "subject", subject: APP });
    for (const junk of [{ type: "status" }, { type: "status", text: 5 }, { type: "log", text: null }, { type: "unknown" }]) ports[0].send(junk);
    expect(client.state).toEqual({ phase: "running", status: "Starting the analysis…" });
    expect(log()).toEqual([]);
  });

  it("keeps the latest lines of a very long log", () => {
    const { client, ports } = page();
    client.start();
    ports[0].send({ type: "subject", subject: APP });
    for (let line = 0; line < MAX_LOG_LINES + 5; line++) ports[0].send({ type: "log", text: `line ${line}` });
    expect(client.log).toHaveLength(MAX_LOG_LINES);
    expect([client.log[0], client.log[MAX_LOG_LINES - 1]]).toEqual(["line 5", `line ${MAX_LOG_LINES + 4}`]);
  });

  it("takes a line of the page's own into the run's log, with its time, and tells the page; the next run starts without it", () => {
    const { client, ports, log } = page();
    client.start();
    ports[0].send({ type: "subject", subject: APP });
    ports[0].send({ type: "log", text: "14:02:05 app: 2 pages" });
    ports[0].send({ type: "result", result: empty() });
    ports[0].send({ type: "done" });
    // What became of the run's result on the page, after the run: the state is the result still.
    vi.setSystemTime(new Date(Date.UTC(2026, 9, 3, 14, 2, 9)));
    client.note("This result is not kept across a refresh: the tab's session storage is not available.");
    expect(client.log).toEqual(["14:02:05 app: 2 pages", "14:02:09 This result is not kept across a refresh: the tab's session storage is not available."]);
    expect([log(), client.state.phase]).toEqual([client.log, "done"]);
    // The log is the run's: Run again starts a new one, without the line.
    client.runAgain();
    expect([client.log, log()]).toEqual([[], []]);
  });

  it("does not change what the tab sent: the result is the page's own copy", () => {
    // A port that hands the client the very objects the tab sent, without the copy a real port makes.
    const listeners: ((message: unknown) => void)[] = [];
    const direct: TabPort = { postMessage: () => undefined, disconnect: () => undefined,
      onMessage: { addListener: listener => { listeners.push(listener); } }, onDisconnect: { addListener: () => undefined } };
    const { client } = page({ connect: () => direct });
    client.start();
    const sent = empty();
    for (const message of [{ type: "subject", subject: APP }, { type: "result", result: sent }, { type: "rows", table: 1, rows: [["Demo app", "Overview", 2]] }, { type: "done" }]) {
      for (const listener of listeners) listener(message);
    }
    expect(sent).toEqual(empty());
    if (client.state.phase !== "done") throw new Error("no result");
    expect(client.state.result.tables[1].rows).toEqual([["Demo app", "Overview", 2]]);
  });

  it("describes connecting and running in the tab's own words", () => {
    expect(describeState({ phase: "connecting" }, true)).toEqual({ title: "Connecting", message: "Connecting to the Anaplan tab…", hint: "" });
    expect(describeState({ phase: "running", status: "Reading Line Items…" }, true)).toEqual({ title: "Analysing", message: "Reading Line Items…",
      hint: "Keep the Anaplan tab open until this finishes." });
  });
});

describe("A tab whose content script does not answer", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.UTC(2026, 9, 9, 14, 2, 5)));
  });
  afterEach(() => { vi.useRealTimers(); });
  /** Lets the steps that wait on a promise go on. */
  const settle = async () => { for (let step = 0; step < 10; step++) await Promise.resolve(); };
  const now = async () => undefined;

  it("gets the content script put back, as a tab open since before Cardigan was reloaded needs, and then runs", async () => {
    const repair = vi.fn(async (): Promise<Repair> => ({ put: true }));
    const { client, ports, phases, log } = page({ repair, retries: { count: 3, pauseMs: 500 }, wait: now, closeReason: "Receiving end does not exist." });
    client.start();
    ports[0].drop();
    await settle();
    expect(repair).toHaveBeenCalledTimes(1);
    ports[1].send({ type: "subject", subject: APP });
    expect(ports[1].posted).toEqual([RUN]);
    expect(phases()).toEqual(["connecting", "connecting", "running"]);
    // A run starts its own log; until then the log said why the page connected again.
    expect(log()).toEqual([]);
  });

  it("says a tab that is not Anaplan is not, and asks it nothing more", async () => {
    const { client, ports, log } = page({ repair: async () => ({ put: false, notAnaplan: "https://www.example.net" }), retries: { count: 3, pauseMs: 500 }, wait: now });
    client.start();
    ports[0].drop();
    await settle();
    expect(client.state).toEqual({ phase: "not-anaplan", shows: "https://www.example.net" });
    expect(ports).toHaveLength(1);
    expect(describeState(client.state, client.asked)).toEqual({ title: "Not an Anaplan tab", message: "That tab shows https://www.example.net, not Anaplan.",
      hint: "Open an app or a model in Anaplan, then click the Cardigan icon on that tab." });
    expect(log()).toEqual(["14:02:05 The tab did not answer."]);
  });

  it("asks a tab that may be loading again for a while, then says it cannot reach it, and a closed tab that it is closed", async () => {
    const waits: number[] = [];
    const { client, ports, phases, log } = page({ repair: async () => ({ put: false }), retries: { count: 2, pauseMs: 500 },
      wait: async ms => { waits.push(ms); }, tabGone: async () => false });
    client.start();
    for (let attempt = 0; attempt < 3; attempt++) { ports[attempt].drop(); await settle(); }
    expect(ports).toHaveLength(3);
    expect(phases()).toEqual(["connecting", "connecting", "connecting", "unreachable"]);
    expect(waits).toEqual([500, 500]);
    // The first try's line, and a count of the tries after it.
    expect(log()).toEqual(["14:02:05 The tab did not answer.", "14:02:05 No answer after 2 more tries."]);
    // A closed tab is asked nothing more.
    const repair = vi.fn(async (): Promise<Repair> => ({ put: false }));
    const closed = page({ repair, retries: { count: 2, pauseMs: 500 }, wait: now, tabGone: async () => true });
    closed.client.start();
    closed.ports[0].drop();
    await settle();
    expect([closed.ports.length, closed.phases(), repair.mock.calls.length]).toEqual([1, ["connecting", "tab-closed"], 0]);
    expect(describeState({ phase: "tab-closed" }, true)).toEqual({ title: "Tab closed", message: "The Anaplan tab this page was opened for has been closed.",
      hint: "Open the app or model in Anaplan again, then click the Cardigan icon on that tab." });
    // A loading tab that answers on a later try is read.
    const loading = page({ repair: async () => ({ put: false }), retries: { count: 5, pauseMs: 500 }, wait: now });
    loading.client.start();
    loading.ports[0].drop();
    await settle();
    loading.ports[1].send({ type: "subject", subject: MODEL });
    expect(loading.ports[1].posted).toEqual([RUN]);
  });

  it("drops the tries of a connection the run control has replaced", async () => {
    let finish: (repair: Repair) => void = () => undefined;
    const { client, ports, phases } = page({ repair: () => new Promise<Repair>(resolve => { finish = resolve; }), retries: { count: 3, pauseMs: 500 }, wait: now });
    client.start();
    ports[0].drop();
    client.runAgain();
    expect(ports).toHaveLength(2);
    finish({ put: true });
    await settle();
    expect(ports).toHaveLength(2);
    ports[1].send({ type: "subject", subject: APP });
    expect(phases()).toEqual(["connecting", "connecting", "running"]);
  });

  it("puts the content script only into an Anaplan page, and nothing anywhere when Chrome refuses", async () => {
    const calls: unknown[] = [];
    const scripting = (origin: string | Error) => ({
      executeScript: vi.fn(async (injection: { target: { tabId: number }; files?: string[]; func?: () => unknown }) => {
        calls.push(injection.files ?? "probe");
        if (origin instanceof Error) throw origin;
        return injection.func ? [{ result: origin, frameId: 0 }] : [{ frameId: 0 }];
      }),
    });
    expect(await repairTab(scripting("https://us1a.app.anaplan.com"), 7)).toEqual({ put: true });
    expect(calls).toEqual(["probe", [CONTENT_SCRIPT]]);
    calls.length = 0;
    expect(await repairTab(scripting("https://au1a.app2.anaplan.com"), 7)).toEqual({ put: true });
    calls.length = 0;
    expect(await repairTab(scripting("https://www.anaplan.com"), 7)).toEqual({ put: false, notAnaplan: "https://www.anaplan.com" });
    expect(await repairTab(scripting(""), 7)).toEqual({ put: false, notAnaplan: "a page Cardigan cannot read" });
    expect(calls).toEqual(["probe", "probe"]);
    expect(await repairTab(scripting(new Error("Cannot access contents of the page.")), 7)).toEqual({ put: false });
  });
});
