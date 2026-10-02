import { afterEach, describe, expect, it, vi } from "vitest";
import { ANAPLAN_HOSTS, NOT_SCOPE_IDS, OTHER_HOSTS, SCOPE_IDS } from "./guards.test-support.js";
import { ANAPLAN_HOST, fileSafe, list, message, SCOPE_ID, sleep, text } from "./util.js";

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
