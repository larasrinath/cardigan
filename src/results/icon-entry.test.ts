import { describe, expect, it, vi } from "vitest";
import { FIND_RESULTS, REUSE_RESULTS } from "../protocol.js";
import { serveIcon } from "./icon-entry.js";

type Listener = Parameters<typeof chrome.runtime.onMessage.addListener>[0];
const sender = { id: "cardigan-test" };
function page(tabId: number | undefined = 7, ownId = 90) {
  let listener: Listener | undefined;
  let busy = false;
  const run = vi.fn(() => { busy = true; });
  const current = vi.fn(async () => ({ id: ownId, index: 1 }));
  serveIcon({ runtime: { id: sender.id, onMessage: { addListener: next => { listener = next; } } }, tabs: { getCurrent: current } }, tabId, () => busy, run);
  return { run, current, listener: () => listener, busy: () => { busy = true; },
    async ask(message: unknown, from = sender) {
      const reply = vi.fn();
      const held = listener?.(message, from, reply);
      for (let i = 0; i < 5; i++) await Promise.resolve();
      return { held, answers: reply.mock.calls.map(([answer]) => answer) };
    } };
}

describe("The results page's toolbar messages", () => {
  it("answers for its Anaplan tab, then runs only when chosen, and reports an active run", async () => {
    const held = page();
    expect(await held.ask({ type: FIND_RESULTS, tabId: 7 })).toEqual({ held: true, answers: [{ tabId: 7, resultsTabId: 90, running: false }] });
    expect(held.run).not.toHaveBeenCalled();
    expect((await held.ask({ type: REUSE_RESULTS, tabId: 7, resultsTabId: 90 })).answers).toEqual([{ tabId: 7, resultsTabId: 90, running: false }]);
    expect((await held.ask({ type: FIND_RESULTS, tabId: 7 })).answers).toEqual([{ tabId: 7, resultsTabId: 90, running: true }]);
    await held.ask({ type: REUSE_RESULTS, tabId: 7, resultsTabId: 90 });
    expect(held.run).toHaveBeenCalledTimes(1);
  });

  it("never answers for another source tab or extension, and never runs an unchosen duplicate", async () => {
    const held = page();
    for (const message of [null, {}, { type: FIND_RESULTS, tabId: 8 }, { type: REUSE_RESULTS, tabId: "7", resultsTabId: 90 }]) {
      expect(await held.ask(message)).toEqual({ held: undefined, answers: [] });
    }
    expect(await held.ask({ type: FIND_RESULTS, tabId: 7 }, { id: "other" })).toEqual({ held: undefined, answers: [] });
    expect(held.current).not.toHaveBeenCalled();
    expect((await held.ask({ type: REUSE_RESULTS, tabId: 7, resultsTabId: 91 })).answers).toEqual([]);
    expect(held.run).not.toHaveBeenCalled();
    const addListener = vi.fn();
    serveIcon({ runtime: { id: sender.id, onMessage: { addListener } }, tabs: { getCurrent: held.current } }, undefined, () => false, held.run);
    expect(addListener).not.toHaveBeenCalled();
  });
});
