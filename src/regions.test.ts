import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ANAPLAN_ORIGIN } from "./bridge.js";
import { ANAPLAN_HOSTS, OTHER_HOSTS } from "./guards.test-support.js";
import { ANAPLAN_HOST } from "./util.js";

// Anaplan's au1 region (Australia) serves the app on au1a.app2.anaplan.com; every other region uses *.app.anaplan.com.
const AUSTRALIA = "au1a.app2.anaplan.com";
const LOOKALIKES = ["au1a.app2.anaplan.com.evil.example", "app2anaplan.com", "au1a.app2anaplan.com", "au1a.app2.anaplan.com.", "au1a.app2.anaplan.co",
  "au1a.app2.anaplan.com:8443", "au1a.app2.anaplan.com/a", "user@au1a.app2.anaplan.com", "app2.anaplan.com.evil.example"];

interface Manifest { content_scripts: { matches: string[]; js: string[] }[] }
const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8")) as Manifest;

describe("Anaplan regions, Australia's app2 host included", () => {
  it("loads both content scripts on every region's app host, Australia's included, and nowhere else", () => {
    expect(manifest.content_scripts.map(script => [script.js, script.matches])).toEqual([
      [["dist/content.js"], ["https://*.app.anaplan.com/*", "https://*.app2.anaplan.com/*"]],
      [["dist/model-export.js"], ["https://*.app.anaplan.com/*", "https://*.app2.anaplan.com/*"]],
    ]);
  });

  it("takes Australia's host as an Anaplan host, and its origin as an Anaplan origin in the model export bridge", () => {
    expect(ANAPLAN_HOSTS).toContain(AUSTRALIA);
    expect(ANAPLAN_HOST.test(AUSTRALIA)).toBe(true);
    expect(ANAPLAN_ORIGIN.test(`https://${AUSTRALIA}`)).toBe(true);
    expect(ANAPLAN_HOSTS.filter(host => !ANAPLAN_ORIGIN.test(`https://${host}`))).toEqual([]);
  });

  it("still refuses lookalikes of it, in both guards", () => {
    expect(OTHER_HOSTS).toEqual(expect.arrayContaining(LOOKALIKES.slice(0, 5)));
    expect(LOOKALIKES.filter(host => ANAPLAN_HOST.test(host))).toEqual([]);
    expect([...LOOKALIKES, ...OTHER_HOSTS].filter(host => ANAPLAN_ORIGIN.test(`https://${host}`))).toEqual([]);
    // An origin is the scheme and host only: plain http, another scheme, or anything after the host is refused.
    expect([`http://${AUSTRALIA}`, `wss://${AUSTRALIA}`, `https://${AUSTRALIA}/`, `https://${AUSTRALIA}:443`, AUSTRALIA]
      .filter(origin => ANAPLAN_ORIGIN.test(origin))).toEqual([]);
  });
});
