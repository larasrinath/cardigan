import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ANAPLAN_ORIGIN } from "./bridge.js";
import { CONTENT_SCRIPT, CONTENT_SCRIPT_ORIGIN, MODEL_READER } from "./protocol.js";
import { ANAPLAN_HOSTS, OTHER_HOSTS } from "./guards.test-support.js";
import { ANAPLAN_HOST } from "./util.js";

// Anaplan's au1 region (Australia) serves the app on au1a.app2.anaplan.com; every other region uses *.app.anaplan.com.
const AUSTRALIA = "au1a.app2.anaplan.com";
const LOOKALIKES = ["au1a.app2.anaplan.com.evil.example", "app2anaplan.com", "au1a.app2anaplan.com", "au1a.app2.anaplan.com.", "au1a.app2.anaplan.co",
  "au1a.app2.anaplan.com:8443", "au1a.app2.anaplan.com/a", "user@au1a.app2.anaplan.com", "app2.anaplan.com.evil.example"];

interface Manifest { content_scripts: { matches: string[]; js: string[] }[]; content_security_policy?: Record<string, string> }
const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8")) as Manifest;

describe("Anaplan regions, Australia's app2 host included", () => {
  it("loads both content scripts on every region's app host, Australia's included, and nowhere else", () => {
    expect(manifest.content_scripts.map(script => [script.js, script.matches])).toEqual([
      [["dist/content.js"], ["https://*.app.anaplan.com/*", "https://*.app2.anaplan.com/*"]],
      [["dist/model-export.js"], ["https://*.app.anaplan.com/*", "https://*.app2.anaplan.com/*"]],
    ]);
  });

  it("asks only for activeTab and scripting, and for no host permissions, required or optional", () => {
    // The toolbar icon's click, the tab it opens and the port to a tab's content script need none. These two let the click
    // put the content script into the clicked Anaplan tab when Chrome has not (results/connection.ts): neither comes with
    // a warning, and neither reaches a tab the icon was not clicked on.
    expect(Object.keys(manifest).filter(key => key.endsWith("permissions"))).toEqual(["permissions"]);
    expect((manifest as Manifest & { permissions: string[] }).permissions).toEqual(["activeTab", "scripting"]);
  });

  it("puts its content script back only on the hosts the manifest's matches name", () => {
    // And the model's reader, the file the manifest puts into the page's main world in every frame (results/connection.ts).
    expect([manifest.content_scripts[0].js, manifest.content_scripts[1].js]).toEqual([[CONTENT_SCRIPT], [MODEL_READER]]);
    expect(manifest.content_scripts[1]).toMatchObject({ world: "MAIN", all_frames: true });
    for (const host of ["us1a.app.anaplan.com", "eu2a.app.anaplan.com", "US1A.APP.ANAPLAN.COM", AUSTRALIA]) {
      expect(CONTENT_SCRIPT_ORIGIN.test(`https://${host}`), host).toBe(true);
    }
    for (const host of [...LOOKALIKES, "x.anaplan.com", "www.anaplan.com", "anaplan.com", "example.net"]) {
      expect(CONTENT_SCRIPT_ORIGIN.test(`https://${host}`), host).toBe(false);
    }
    expect(CONTENT_SCRIPT_ORIGIN.test(`http://${AUSTRALIA}`)).toBe(false);
  });

  it("lets its own pages and its service worker load only the extension's own files", () => {
    // Scripts, the stylesheet and the icon come from the package ('self') and everything else from nowhere: no address to
    // fetch from, no frame, no font, no form to send. Only styles may be written in the page, as the results page's markup
    // does; a style runs no code. The packager refuses a policy that lets anything else in (scripts/package.mjs).
    expect(manifest.content_security_policy).toEqual({
      extension_pages: "default-src 'none'; script-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline'; img-src 'self'; base-uri 'none'; form-action 'none'",
    });
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
