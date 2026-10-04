import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FRESH_MS, ROWS_MAX, type TabMessage } from "../protocol.js";
import type { AnalysisResult, Cell } from "../result-types.js";
import { resultZip } from "../result-zip.js";
import { describeState, MAX_LOG_LINES, openedJustNow, ResultsClient, runLabel, tabIdFrom, UNREADABLE, withoutOpened, type RunState, type TabPort } from "./connection.js";

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
function page(options: { noTab?: boolean; closeReason?: string; connect?: () => TabPort; autoRun?: boolean } = {}) {
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
    // What the page downloads is what the tab's own result gives, byte for byte.
    if (client.state.phase !== "done") throw new Error("no result");
    expect(resultZip(client.state.result, NOW)).toEqual(resultZip(expected, NOW));
    // The result keeps the one time it was complete at, so its zip is the same bytes however late it is downloaded.
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
    const { client, ports, phases } = page({ noTab: true });
    client.start();
    client.runAgain();
    expect(phases()).toEqual(["no-tab", "no-tab"]);
    expect(ports).toEqual([]);
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
      hint: "If it is an Anaplan app or model, refresh it, then click the Cardigan icon again." });
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
    expect(client.state).toEqual({ phase: "failed", message: "You're signed out of Anaplan. Sign in and try again.", signedOut: true });
    expect(describeState(client.state, client.asked)).toEqual({ title: "The analysis stopped", message: "You're signed out of Anaplan. Sign in and try again.",
      hint: "Choose Run again to try once more." });
    // The log of the failed run stays, to be copied.
    expect(client.log).toEqual(["14:02:05 GET /apps 401"]);

    client.runAgain();
    expect(ports).toHaveLength(1);
    expect(ports[0].posted).toEqual([RUN, RUN]);
    expect(client.state).toEqual({ phase: "running", status: "Starting the analysis…" });
    expect(client.log).toEqual([]);

    ports[0].send({ type: "error", message: "Stopped: the model frame did not answer." });
    expect(client.state).toEqual({ phase: "failed", message: "Stopped: the model frame did not answer.", signedOut: false });
    ports[0].send({ type: "run-again-please" });
    ports[0].send({ type: "error" });
    expect(client.state).toEqual({ phase: "failed", message: "Stopped: the model frame did not answer.", signedOut: false });
  });

  it("shows the text of an error without a code: nothing to analyse, or the tab busy with something else", () => {
    const { client, ports } = page();
    client.start();
    ports[0].send({ type: "subject", subject: MODEL });
    // The tab may first say it is stopping a run an earlier page asked for; that is a status like any other.
    ports[0].send({ type: "status", text: "Stopping the previous run…" });
    expect(describeState(client.state, client.asked).message).toBe("Stopping the previous run…");
    ports[0].send({ type: "error", message: "This page has no model to export yet." });
    expect(describeState(client.state, client.asked)).toEqual({ title: "The analysis stopped", message: "This page has no model to export yet.", hint: "Choose Run again to try once more." });
  });

  it("gives an error without words a message of its own", () => {
    const { client, ports } = page();
    client.start();
    ports[0].send({ type: "subject", subject: APP });
    ports[0].send({ type: "error", message: "" });
    expect(client.state).toEqual({ phase: "failed", message: "The analysis stopped without saying why.", signedOut: false });
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
    expect(client.state).toEqual({ phase: "failed", message: UNREADABLE, signedOut: false });
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
      "a result without a summary": [{ type: "result", result: { ...empty(), summary: undefined } }],
      "no result at all": [{ type: "result" }],
    };
    for (const [name, messages] of Object.entries(cases)) {
      const { client, ports } = page();
      client.start();
      ports[0].send({ type: "subject", subject: APP });
      for (const message of messages) ports[0].send(message);
      expect(client.state, name).toEqual({ phase: "failed", message: UNREADABLE, signedOut: false });
      // What still arrives of that run changes nothing.
      ports[0].send({ type: "rows", table: 1, rows: [["late"]] });
      ports[0].send({ type: "done" });
      expect(client.state.phase, name).toBe("failed");
    }
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
