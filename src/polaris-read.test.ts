import { describe, expect, it, vi } from "vitest";
import { addModuleViews, emptyCatalog } from "./catalog.js";
import { polarisListing, PolarisReader } from "./polaris-read.js";
import { polarisResult } from "./polaris.js";
import { POLARIS_ENGINE, POLARIS_IDS, POLARIS_ITEMS, POLARIS_LISTS, POLARIS_MODULES, POLARIS_VIEWS, polarisItem } from "./polaris.test-support.js";
import { RestError } from "./rest.js";
import { serveTab } from "./tab-port.js";
import { EXTENSION, FakePort } from "./tab-port.test-support.js";

const progress = () => ({ log: vi.fn(), status: vi.fn() });
function catalog() { const c = emptyCatalog(); addModuleViews(c, POLARIS_VIEWS); return c; }
const answer = async (path: string): Promise<unknown> => path.endsWith("/modules") ? POLARIS_MODULES : path.endsWith("/versions") ? [{ name: "Plan" }]
  : POLARIS_ITEMS.get(path.split("/").at(-1)!);

describe("Polaris GET sources", () => {
  it("reads one GET per module, including an empty module, and reuses inventory answers", async () => {
    const get = vi.fn(answer);
    const c = catalog();
    const log = progress();
    const reader = new PolarisReader(POLARIS_IDS, log, undefined, get);
    const subscribe = vi.fn(async () => ({ data: [...POLARIS_LISTS.data, { id: 101000000599, name: "Active products" }] }));
    await reader.inventory(c, POLARIS_LISTS, subscribe);
    await reader.inventory(c);
    expect(get).toHaveBeenCalledTimes(5);
    expect(get.mock.calls.every(([path]) => path.startsWith("/a/llm-data-service/meta-data/workspace/"))).toBe(true);
    expect(reader.lineItems.get("102000000503")).toEqual([]);
    expect(c.lineItems.get("1902000000501")).toEqual({ name: "Revenue", moduleId: "102000000502" });
    expect(c.lineItemModules.size).toBe(3);
    expect(c.lists.has("101000000599")).toBe(false);
    expect(c.dimensions.get("101000000599")).toBe("Active products");
    expect(subscribe).toHaveBeenCalledWith(expect.stringContaining("/lists?subsets=true"), { body: {}, timeoutMs: 60_000 });
    expect(log.log).toHaveBeenCalledWith(expect.stringMatching(/^Polaris line items: 3\/3 modules answered, 5 line items, 3 formulas, 1 empty modules;/));
  });

  it.each([401, 403, 404, 500, 503])("keeps other sources after HTTP %i, without retry", async code => {
    const log = progress();
    const get = vi.fn(async (path: string) => {
      if (path.endsWith("/modules") || path.endsWith("/102000000501")) throw new RestError(code === 503 ? "MAINTENANCE" : "HTTP_ERROR", code);
      return answer(path);
    });
    const c = catalog();
    const reader = new PolarisReader(POLARIS_IDS, log, undefined, get);
    await reader.inventory(c);
    expect(reader.versions).toEqual([{ name: "Plan" }]);
    expect(reader.lineItems.get("102000000502")).toHaveLength(3);
    expect(c.unreadableModules.has("102000000501")).toBe(true);
    expect(get.mock.calls.filter(([path]) => path.endsWith("/modules"))).toHaveLength(1);
    expect(log.log).toHaveBeenCalledWith(`Polaris source unavailable: llmModules (HTTP ${code})`);
    expect(log.log).toHaveBeenCalledWith(`Polaris source unavailable: llmLineItems module 102000000501 (HTTP ${code})`);
  });

  it("retains returned rows but reports paging and does not mark that module complete", async () => {
    const log = progress();
    const get = vi.fn(async (path: string) => path.endsWith("/102000000501") ? { items: [polarisItem("Only returned item", 1901000000599)], pagination: { nextPageToken: "invented-token", totalCount: 30 } } : answer(path));
    const c = catalog();
    const reader = new PolarisReader(POLARIS_IDS, log, undefined, get);
    await reader.inventory(c);
    expect(reader.lineItems.get("102000000501")).toHaveLength(1);
    expect(c.lineItemModules.has("102000000501")).toBe(false);
    expect(log.log).toHaveBeenCalledWith("Polaris possibly incomplete: llmLineItems module 102000000501 (1 rows; continuation not read)");
    expect(polarisResult(POLARIS_IDS, POLARIS_ENGINE, c, reader).summary.join(" ")).toContain("answers may be cut short");
    expect(get).toHaveBeenCalledTimes(5);
  });

  it.each([{ hasMore: true }, { last: false }, { next: "/unverified" }, { total: 100 }, { totalPages: 2 }, { limit: 1 }, { offset: 1 }])("detects a possibly short listing %j", paging => {
    expect(polarisListing({ data: [{}], ...paging }, "lineItems").partial).toBe(true);
  });
  it("does not claim a bare array is complete or interpret row settings as paging", () => {
    expect(polarisListing([{ next: "a line item's own field" }], "lineItems")).toMatchObject({ paging: [], partial: false });
    expect(polarisListing({ items: [{}], pagination: { size: 1, total: 1, last: true } }, "lineItems").partial).toBe(false);
  });

  it("stops queued modules when the results page cancels, waits for in-flight reads, and starts nothing if already cancelled", async () => {
    const stop = new AbortController();
    const c = emptyCatalog();
    for (let i = 0; i < 20; i++) c.modules.set(String(102000000600 + i), `Module ${i}`);
    const releases: (() => void)[] = [];
    const get = vi.fn(async (path: string) => {
      if (!path.includes("/line-items/")) return [];
      await new Promise<void>(resolve => releases.push(resolve));
      return [];
    });
    const work = new PolarisReader(POLARIS_IDS, progress(), stop.signal, get).inventory(c);
    const settled = expect(work).rejects.toThrow("results page closed");
    await vi.waitFor(() => expect(releases).toHaveLength(4));
    stop.abort(new Error("results page closed"));
    releases.forEach(release => release());
    await settled;
    expect(get.mock.calls.filter(([path]) => path.includes("/line-items/"))).toHaveLength(4);
    get.mockClear();
    await expect(new PolarisReader(POLARIS_IDS, progress(), stop.signal, get).inventory(c)).rejects.toThrow("results page closed");
    expect(get).not.toHaveBeenCalled();
  });

  it("reads an invented 440-module model with at most four requests in flight and logs elapsed time", async () => {
    const c = emptyCatalog();
    for (let i = 0; i < 440; i++) c.modules.set(String(102000001000 + i), `Practice module ${i}`);
    let active = 0;
    let peak = 0;
    let asked = 0;
    const get = vi.fn(async (path: string) => {
      if (!path.includes("/line-items/")) return [];
      peak = Math.max(peak, ++active);
      asked++;
      await new Promise(resolve => setTimeout(resolve, 1));
      active--;
      return [polarisItem("Value", 1901000000601, "1 + 2")];
    });
    const log = progress();
    await new PolarisReader(POLARIS_IDS, log, undefined, get).inventory(c);
    expect([peak, active, asked]).toEqual([4, 0, 440]);
    const line = log.log.mock.calls.map(([line]) => line).find(line => line.startsWith("Polaris line items:"));
    expect(line).toMatch(/440\/440 modules answered.*at most 4 requests at once; \d+\.\d{2} s$/);
    console.log(`Invented 440-module performance: ${line}`);
  });

  it("receives cancellation from tab-port when the results page closes", async () => {
    const c = emptyCatalog();
    for (let i = 0; i < 12; i++) c.modules.set(String(102000002000 + i), `Practice module ${i}`);
    const releases: (() => void)[] = [];
    const get = vi.fn(async (path: string) => {
      if (path.includes("/line-items/")) await new Promise<void>(resolve => releases.push(resolve));
      return [];
    });
    let connect: (port: chrome.runtime.Port) => void = () => undefined;
    let stopped: AbortSignal | undefined;
    let ended = false;
    serveTab({ id: EXTENSION, onConnect: { addListener: listener => { connect = listener; } } }, {
      host: "practice.app.anaplan.com", subject: () => ({ kind: "model", id: POLARIS_IDS.modelId }), signedOut: () => false,
      run: async (_subject, progress, _diagnostics, signal) => {
        stopped = signal;
        try {
          const reader = new PolarisReader(POLARIS_IDS, progress, signal, get);
          await reader.inventory(c);
          return polarisResult(POLARIS_IDS, POLARIS_ENGINE, c, reader);
        } finally { ended = true; }
      },
    });
    const port = new FakePort();
    connect(port as unknown as chrome.runtime.Port);
    port.say({ type: "run" });
    await vi.waitFor(() => expect(releases).toHaveLength(4));
    port.close();
    expect(stopped?.aborted).toBe(true);
    releases.forEach(release => release());
    await vi.waitFor(() => expect(ended).toBe(true));
    expect(get.mock.calls.filter(([path]) => path.includes("/line-items/"))).toHaveLength(4);
    expect(port.types()).not.toContain("done");
  });

  it("logs a timeout as one unavailable source and reads the next module", async () => {
    const log = progress();
    const reader = new PolarisReader(POLARIS_IDS, log, undefined, async path => {
      if (path.endsWith("/102000000501")) throw new RestError("TIMEOUT");
      return answer(path);
    });
    await reader.inventory(catalog());
    expect(log.log).toHaveBeenCalledWith("Polaris source unavailable: llmLineItems module 102000000501 (TIMEOUT)");
    expect(reader.lineItems.size).toBe(2);
  });

  it("joins inventory work already in flight after the socket stops, rather than finishing a partial run early", async () => {
    const c = catalog();
    const releases: (() => void)[] = [];
    const reader = new PolarisReader(POLARIS_IDS, progress(), undefined, async path => {
      if (path.includes("/line-items/")) await new Promise<void>(resolve => releases.push(resolve));
      return answer(path);
    });
    const first = reader.inventory(c);
    await vi.waitFor(() => expect(releases).toHaveLength(3));
    const second = reader.inventory(c);
    expect(second).toBe(first);
    let finished = false;
    void second.then(() => { finished = true; });
    await Promise.resolve();
    expect(finished).toBe(false);
    releases.forEach(release => release());
    await second;
    expect(reader.lineItems.size).toBe(3);
  });
});
