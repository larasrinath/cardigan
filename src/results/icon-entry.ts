import { FIND_RESULTS, REUSE_RESULTS, type ResultsAnswer } from "../protocol.js";

/** Answers only for this page's Anaplan tab. Keep the listener synchronous: an async listener on an unrelated page can
 * claim Chrome's one response. Late probes have no side effects; only the worker's chosen page starts a run. */
export function serveIcon(api: { runtime: Pick<typeof chrome.runtime, "id" | "onMessage">; tabs: Pick<typeof chrome.tabs, "getCurrent"> },
  tabId: number | undefined, running: () => boolean, run: () => void): void {
  if (tabId === undefined) return;
  let resultsTabId: number | undefined;
  api.runtime.onMessage.addListener((message, sender, reply) => {
    const asked = message as { type?: unknown; tabId?: unknown; resultsTabId?: unknown } | null;
    if (!api.runtime.id || sender.id !== api.runtime.id || sender.tab || asked?.tabId !== tabId
      || (asked.type !== FIND_RESULTS && asked.type !== REUSE_RESULTS)) return;
    if (asked.type === REUSE_RESULTS) {
      if (resultsTabId === undefined || asked.resultsTabId !== resultsTabId) return;
      const busy = running();
      reply({ tabId, resultsTabId, running: busy } satisfies ResultsAnswer);
      if (!busy) run();
      return;
    }
    void api.tabs.getCurrent().then(tab => {
      if (tab?.id === undefined) return;
      resultsTabId = tab.id;
      const answer: ResultsAnswer = { tabId, resultsTabId, running: running() };
      reply(answer);
    }).catch(() => undefined);
    return true;
  });
}
