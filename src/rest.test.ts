import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ANAPLAN_HOSTS, OTHER_HOSTS } from "./guards.test-support.js";
import { getJson, RestError } from "./rest.js";

// Synthetic hosts and IDs only.
const PAGE_HOST = "us1a.app.anaplan.com";
const PATH = "/a/collaboration-actions-service/workspaces/0123456789abcdef0123456789abcdef/models/FEDCBA9876543210FEDCBA9876543210/imports";

describe("Page analyzer REST reads", () => {
  beforeEach(() => {
    vi.stubGlobal("location", { host: PAGE_HOST, origin: `https://${PAGE_HOST}` });
    vi.stubGlobal("document", { cookie: "other=1; XSRF-TOKEN=xsrf-value" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ imports: [] }), { status: 200, headers: { "content-type": "application/json" } })));
  });
  afterEach(() => vi.unstubAllGlobals());

  const calls = () => vi.mocked(globalThis.fetch).mock.calls as unknown as [string, RequestInit][];

  it("reads only the two services the analyser needs, by paths of plain segments, and refuses any other path before anything is sent", async () => {
    const [GUID, WS, MODEL] = ["01234567-89ab-cdef-0123-456789abcdef", "0123456789abcdef0123456789abcdef", "FEDCBA9876543210FEDCBA9876543210"];
    // Every shape of path the analysis asks for (analyse.ts): the app, a page on each of its routes, and a model's actions.
    const read = [`/a/springboard-definition-service/apps/${GUID}?includeUnpublished=true&includeReportPages=true`,
      ...["boards", "grid-pages", "reports"].map(route => `/a/springboard-definition-service/${route}/${GUID}`),
      ...["imports", "exports", "processes"].map(key => `/a/collaboration-actions-service/workspaces/${WS}/models/${MODEL}/${key}`)];
    for (const path of read) await expect(getJson(path), path).resolves.toEqual({ imports: [] });
    expect(calls().map(([url]) => url)).toEqual(read.map(path => `https://${PAGE_HOST}${path}`));

    vi.mocked(globalThis.fetch).mockClear();
    const page = "/a/springboard-definition-service/boards/x";
    const refused = [
      // Another service, the model data and classic services among them, or a name that only begins or ends like an allowed one.
      "/a/springboard-widget-data-service/ws", "/a/core/anaplan/framework.jsp", "/a/modeling/customers/x", "/a/collaboration-service/x", "/a/x",
      "/a/springboard-definition-service-2/apps", "/a/my-springboard-definition-service/apps", "/a/collaboration-actions-servicex/x", "/a/Springboard-Definition-Service/apps",
      // Not under /a/, or not a path of this host at all.
      "/b/springboard-definition-service/apps", "/springboard-definition-service/apps", "a/springboard-definition-service/apps", "/a/a/springboard-definition-service/apps",
      "/A/springboard-definition-service/apps", "//evil.example/a/springboard-definition-service/apps", "https://evil.example/a/springboard-definition-service/apps",
      " /a/springboard-definition-service/apps", "",
      // The service alone: there is nothing to read.
      "/a/springboard-definition-service", "/a/springboard-definition-service/", "/a/collaboration-actions-service?x=1",
      // A segment that leaves the service, written plainly or encoded, and any dot at all.
      "/a/springboard-definition-service/../collaboration-service/x", "/a/springboard-definition-service/apps/..", "/a/springboard-definition-service/./apps",
      "/a/springboard-definition-service/%2e%2e/x", "/a/springboard-definition-service/apps%2f..%2fx", "/a/springboard-definition-service/apps/x.json",
      "/a/springboard-definition-service/apps?x=..", "/a/springboard-definition-service/apps?x=.",
      // Characters that would start a query, a fragment, a host or another path in a URL, and white space.
      ...["\\", ":", "@", ";", "#", "%", "+", ",", "*", "'", "(", "~", "é", " ", "\t", "\n", "\r\n"].map(character => `${page}${character}y`), `${page}\n`, `${page} `,
      // A query of anything but names and values, or a second one.
      `${page}?`, `${page}?a=1?b=2`, `${page}?a=/x`, `${page}?a=b c`, `${page}?a=%2e`, `${page}?a=1#x`, `${page}?a=1;b=2`, `${page}?a=1\n`,
    ];
    for (const path of refused) {
      for (const options of [{}, { host: "eu2a.app.anaplan.com" }]) {
        const error = await getJson(path, options).catch((thrown: unknown) => thrown);
        expect(error, JSON.stringify(path)).toBeInstanceOf(RestError);
        expect(error, JSON.stringify(path)).toMatchObject({ code: "INVALID_PATH", status: undefined });
      }
    }
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("refuses a host outside anaplan.com before anything is sent", async () => {
    for (const host of OTHER_HOSTS) {
      const error = await getJson(PATH, { host }).catch((thrown: unknown) => thrown);
      expect(error, host).toBeInstanceOf(RestError);
      expect(error, host).toMatchObject({ code: "INVALID_PATH", message: "INVALID_PATH", status: undefined });
    }
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("reads from any host under anaplan.com, addressed exactly as given", async () => {
    for (const host of ANAPLAN_HOSTS) await expect(getJson(PATH, { host }), host).resolves.toEqual({ imports: [] });
    expect(calls().map(([url]) => url)).toEqual(ANAPLAN_HOSTS.map(host => `https://${host}${PATH}`));
    for (const [, init] of calls()) expect(init).toMatchObject({ method: "GET", mode: "cors", credentials: "include", redirect: "error" });
  });

  it("reads from another Anaplan host as a cross-origin GET without the XSRF token", async () => {
    await expect(getJson(PATH, { host: "eu2a.app.anaplan.com" })).resolves.toEqual({ imports: [] });
    await getJson(PATH, { host: "EU2A.APP.ANAPLAN.COM" });
    expect(calls().map(([url]) => url)).toEqual([`https://eu2a.app.anaplan.com${PATH}`, `https://EU2A.APP.ANAPLAN.COM${PATH}`]);
    for (const [, init] of calls()) {
      expect(init).toMatchObject({ method: "GET", mode: "cors", credentials: "include", redirect: "error" });
      expect(init.headers).not.toHaveProperty("X-XSRF-TOKEN");
    }
  });

  it("reads the page's own host as the same origin, whatever that host is", async () => {
    await getJson(PATH, { host: PAGE_HOST });
    vi.stubGlobal("location", { host: "localhost:8443", origin: "https://localhost:8443" });
    await getJson(PATH, { host: "localhost:8443" });
    await getJson(PATH);
    expect(calls().map(([url]) => url)).toEqual([`https://${PAGE_HOST}${PATH}`, `https://localhost:8443${PATH}`, `https://localhost:8443${PATH}`]);
    for (const [, init] of calls()) {
      expect(init).toMatchObject({ method: "GET", mode: "same-origin", credentials: "include", redirect: "error" });
      expect(init.headers).toMatchObject({ "X-XSRF-TOKEN": "xsrf-value" });
    }
  });
});
