import { afterEach, describe, expect, it, vi } from "vitest";
import { ANAPLAN_HOSTS, NOT_SCOPE_IDS, OTHER_HOSTS, SCOPE_IDS } from "./guards.test-support.js";
import { ANAPLAN_HOST, AT_A_TIME, eachAtMost, fileSafe, list, message, SCOPE_ID, seconds, sleep, stepTimes, text } from "./util.js";

describe("Page analyzer shared patterns and helpers", () => {
  afterEach(() => { vi.useRealTimers(); });

  it("takes only a host under anaplan.com as an Anaplan host", () => {
    expect(ANAPLAN_HOSTS.filter(host => !ANAPLAN_HOST.test(host))).toEqual([]);
    expect(OTHER_HOSTS.filter(host => ANAPLAN_HOST.test(host))).toEqual([]);
  });

  it("takes only 32 letters or digits as a workspace or model ID", () => {
    expect(SCOPE_IDS.filter(id => !SCOPE_ID.test(id))).toEqual([]);
    expect(NOT_SCOPE_IDS.filter(id => SCOPE_ID.test(id))).toEqual([]);
  });

  it("keeps no state in a shared pattern: the same value gets the same answer every time", () => {
    // A g or y flag would make .test() remember where the last match ended, so one caller's check would change the next one's.
    expect([ANAPLAN_HOST.flags, SCOPE_ID.flags]).toEqual(["i", ""]);
    expect([1, 2, 3].map(() => ANAPLAN_HOST.test(ANAPLAN_HOSTS[0]))).toEqual([true, true, true]);
    expect([1, 2, 3].map(() => SCOPE_ID.test(SCOPE_IDS[0]))).toEqual([true, true, true]);
    expect([ANAPLAN_HOST.lastIndex, SCOPE_ID.lastIndex]).toEqual([0, 0]);
  });

  it("reads text and lists out of JSON of no fixed shape", () => {
    expect([text("Plan"), text(" "), text(""), text(42), text(0), text(true), text(null), text(undefined), text(["Plan"]), text({ name: "Plan" })])
      .toEqual(["Plan", " ", undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined]);
    const [entry, nested] = [{ a: 1 }, ["y"]];
    const entries = list([1, null, entry, "x", undefined, true, nested, 0, ""]);
    expect(entries).toEqual([entry, nested]);
    expect(entries[0]).toBe(entry);
    expect([list(undefined), list(null), list("ab"), list(7), list(entry), list({ length: 1, 0: entry })]).toEqual([[], [], [], [], [], []]);
  });

  it("reads an error's message, and anything else thrown as text", () => {
    expect([message(new Error("No access")), message(new TypeError("Failed to fetch")), message("plain"), message(404), message(undefined), message(null),
      message({ message: "not an error" })]).toEqual(["No access", "Failed to fetch", "plain", "404", "undefined", "null", "[object Object]"]);
  });

  it("makes a name safe as part of a file name, and falls back when nothing of it is left", () => {
    expect(fileSafe('a\\b/c:d*e?f"g<h>i|j\u0000k\u0001l\u001fm', "x")).toBe("a b c d e f g h i j k l m");
    expect(fileSafe('Supply: "Plan" /\t2026', "x")).toBe("Supply Plan 2026");
    expect(fileSafe("  Plan   2026\n", "x")).toBe("Plan 2026");
    const kept = "Plan #1 (R&D) - 50%+ [a] {b} ~ 'c' = d; e, f! @g $h ^i `j` \u007fk Größe 東京";
    expect(fileSafe(kept, "x")).toBe(kept);
    expect([fileSafe("a".repeat(80), "x"), fileSafe("a".repeat(81), "x")]).toEqual(["a".repeat(80), "a".repeat(80)]);
    // Trimmed before the cut, not after: a space that the cut leaves at the end stays.
    expect(fileSafe(`  ${"a".repeat(79)} b`, "x")).toBe(`${"a".repeat(79)} `);
    expect([fileSafe("", "app"), fileSafe("???", "model"), fileSafe(" \t ", "x"), fileSafe('\\/:*?"<>|', "y")]).toEqual(["app", "model", "x", "y"]);
  });

  it("says a time a step took in seconds, with two decimals", () => {
    expect([seconds(0), seconds(620), seconds(1234), seconds(61_005), seconds(-5)]).toEqual(["0.00 s", "0.62 s", "1.23 s", "61.01 s", "0.00 s"]);
  });

  it("says in one line how long each step of a run took, in the order they ended, and gives back what each gave", async () => {
    vi.useFakeTimers();
    const time = stepTimes();
    const names = time.step("names", async () => { await sleep(1200); return "named"; });
    await vi.advanceTimersByTimeAsync(1200);
    expect(await names).toBe("named");
    const lineItems = time.step("line items", () => sleep(840));
    await vi.advanceTimersByTimeAsync(840);
    await lineItems;
    expect(time.line()).toBe("Time: names 1.20 s, line items 0.84 s");
    // A time measured otherwise is kept in its turn.
    time.took("connection", 2_340);
    expect(time.line()).toBe("Time: names 1.20 s, line items 0.84 s, connection 2.34 s");
    // A step that fails is not timed: its failure is passed on.
    const failure = new Error("refused");
    await expect(time.step("action names", () => Promise.reject(failure))).rejects.toBe(failure);
    expect(time.line()).toBe("Time: names 1.20 s, line items 0.84 s, connection 2.34 s");
  });

  /** Work that waits until the test answers it, item by item: what was started, in order, and how to end each. */
  const held = () => {
    const started: number[] = [];
    const ends = new Map<number, { answer: () => void; fail: (error: Error) => void }>();
    let running = 0;
    let most = 0;
    const work = (item: number) => new Promise<void>((resolve, reject) => {
      started.push(item);
      most = Math.max(most, ++running);
      ends.set(item, { answer: () => { running--; resolve(); }, fail: error => { running--; reject(error); } });
    });
    return { started, ends, work, most: () => most };
  };
  const settled = () => new Promise(resolve => setTimeout(resolve, 0));

  it(`keeps at most ${AT_A_TIME} reads moving, starts them in the items' order, and starts the next as soon as any one ends`, async () => {
    const items = Array.from({ length: 10 }, (_, index) => index);
    const reads = held();
    let ended = false;
    const run = eachAtMost(items, AT_A_TIME, undefined, reads.work).then(() => { ended = true; });
    await settled();
    expect(reads.started).toEqual([0, 1, 2, 3]);
    // A slow read holds up only its own place: the third ends first, and the fifth starts in its place at once.
    reads.ends.get(2)!.answer();
    await settled();
    expect(reads.started).toEqual([0, 1, 2, 3, 4]);
    for (const item of [0, 1, 3, 4, 5, 6, 7, 8, 9]) {
      await settled();
      reads.ends.get(item)!.answer();
    }
    await run;
    expect([ended, reads.started, reads.most()]).toEqual([true, items, AT_A_TIME]);
    // Fewer items than places, a limit of one, and none at all.
    const few = held();
    const two = eachAtMost([7, 8], AT_A_TIME, undefined, few.work);
    await settled();
    few.ends.get(7)!.answer();
    few.ends.get(8)!.answer();
    await two;
    const one = held();
    const single = eachAtMost([1, 2, 3], 1, undefined, one.work);
    for (const item of [1, 2, 3]) {
      await settled();
      one.ends.get(item)!.answer();
    }
    await single;
    await eachAtMost([], AT_A_TIME, undefined, () => Promise.reject(new Error("never")));
    expect([few.started, few.most(), one.started, one.most()]).toEqual([[7, 8], 2, [1, 2, 3], 1]);
  });

  it("starts no further read once the run is stopped, lets the reads under way end, and then ends with the stop's reason", async () => {
    const reads = held();
    const stop = new AbortController();
    const stopped = new Error("Stopped: the results page was closed.");
    let outcome: unknown;
    const run = eachAtMost(Array.from({ length: 10 }, (_, index) => index), AT_A_TIME, stop.signal, reads.work).then(() => "ended", error => error);
    void run.then(value => { outcome = value; });
    await settled();
    stop.abort(stopped);
    reads.ends.get(1)!.answer();
    await settled();
    // Nothing started in the place that came free, and the run waits for the three reads still under way.
    expect([reads.started, outcome]).toEqual([[0, 1, 2, 3], undefined]);
    for (const item of [0, 2, 3]) reads.ends.get(item)!.answer();
    expect(await run).toBe(stopped);
    expect(reads.started).toEqual([0, 1, 2, 3]);
    // A run stopped before it begins starts nothing.
    const none = held();
    await expect(eachAtMost([1, 2], AT_A_TIME, AbortSignal.abort(stopped), none.work)).rejects.toBe(stopped);
    expect(none.started).toEqual([]);
  });

  it("ends at once with the failure of one read, and starts no further read after it", async () => {
    const reads = held();
    const failure = new Error("SIGNED_OUT");
    const run = eachAtMost(Array.from({ length: 10 }, (_, index) => index), AT_A_TIME, undefined, reads.work);
    await settled();
    reads.ends.get(2)!.fail(failure);
    // The other three reads are still under way: the run does not wait for them.
    await expect(run).rejects.toBe(failure);
    for (const item of [0, 1, 3]) reads.ends.get(item)!.answer();
    await settled();
    expect(reads.started).toEqual([0, 1, 2, 3]);
  });

  it("sleeps for the time asked", async () => {
    vi.useFakeTimers();
    let woke = false;
    void sleep(50).then(() => { woke = true; });
    await vi.advanceTimersByTimeAsync(49);
    expect(woke).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(woke).toBe(true);
  });
});
