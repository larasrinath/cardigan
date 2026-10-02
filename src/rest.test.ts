import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

  it("refuses a host outside anaplan.com before anything is sent", async () => {
    for (const host of ["example.net", "anaplan.com", "eu2a.app.anaplan.com.example.net", "eu2a.app.anaplan.com:8443", "eu2a.app.anaplan.com/a",
      "user@eu2a.app.anaplan.com", "eu2a.app.anaplan.com\n"]) {
      const error = await getJson(PATH, { host }).catch((thrown: unknown) => thrown);
      expect(error).toBeInstanceOf(RestError);
      expect(error).toMatchObject({ code: "INVALID_PATH", message: "INVALID_PATH", status: undefined });
    }
    expect(globalThis.fetch).not.toHaveBeenCalled();
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
