import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FakePage } from "./results/dom.test-support.js";
import { ABOUT_PAGE } from "./protocol.js";

/** The About page as the extension holds it, and its tags with their attributes, in order. */
const html = readFileSync(new URL(`../${ABOUT_PAGE}`, import.meta.url), "utf8");
const TAG = /<([a-z][a-z0-9-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/gi;
const ATTRIBUTE = /([^\s"'=<>/]+)\s*=\s*"([^"]*)"/g;
const tags = [...html.matchAll(TAG)].map(([, name, rest]) => ({ name: name.toLowerCase(), attributes: new Map([...rest.matchAll(ATTRIBUTE)].map(([, key, value]) => [key, value])) }));
const REPOSITORY = "https://github.com/larasrinath/cardigan";

/** The page with its script run: the system's theme dark or not, and the theme the results page kept, if any. */
async function openAbout(systemDark: boolean, kept: string | null | Error): Promise<FakePage> {
  vi.resetModules();
  const page = new FakePage(html);
  vi.stubGlobal("document", page.document);
  vi.stubGlobal("window", { matchMedia: () => ({ matches: systemDark, addEventListener: () => undefined }) });
  vi.stubGlobal("localStorage", { getItem: () => { if (kept instanceof Error) throw kept; return kept; } });
  await import("./about.js");
  return page;
}

describe("The About page", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("loads the results page's stylesheet and a script of its own, nothing from outside the extension, and writes no script or style inline", () => {
    expect(tags.filter(tag => tag.name === "link").map(tag => [tag.attributes.get("rel"), tag.attributes.get("href")])).toEqual([["icon", "icons/32.png"], ["stylesheet", "results.css"]]);
    expect(tags.filter(tag => tag.name === "script").map(tag => tag.attributes.get("src"))).toEqual(["dist/about.js"]);
    // The script's tag is empty, there is no style element, and no element holds a handler or a style of its own.
    expect([/<script[^>]*>[^<]/.test(html), /<style/i.test(html), tags.filter(tag => [...tag.attributes.keys()].some(key => /^on|^style$/i.test(key))).length]).toEqual([false, false, 0]);
  });

  it("says what Cardigan is and that it only reads, and leads to the project's pages in a new tab: what's new, privacy, help and the source", () => {
    const page = new FakePage(html);
    expect([page.texts("h1"), page.id("aboutVersion").textContent, page.texts(".about-safe")])
      .toEqual([["Cardigan"], "", ["It only reads. It changes nothing in Anaplan, and sends what it reads nowhere else."]]);
    expect(page.texts(".about-what")[0]).toMatch(/^A read-only analyser for Anaplan models and apps/);
    const links = tags.filter(tag => tag.name === "a");
    expect(links.map(tag => tag.attributes.get("href"))).toEqual([`${REPOSITORY}/blob/main/CHANGELOG.md`, `${REPOSITORY}/blob/main/NOTICE.md`, `${REPOSITORY}#readme`, REPOSITORY]);
    expect(page.texts(".about-links a")).toEqual(["What's new", "Privacy", "Help", "Source"]);
    expect(links.every(tag => tag.attributes.get("target") === "_blank" && tag.attributes.get("rel") === "noopener noreferrer")).toBe(true);
  });

  it("writes the version and takes the theme the results page kept, or else the system's", async () => {
    // In the tests the build gives no version: the page says the one version.ts has then.
    let page = await openAbout(false, "dark");
    expect([page.document.documentElement.dataset.theme, page.id("aboutVersion").textContent]).toEqual(["dark", "Version dev"]);
    page = await openAbout(true, "light");
    expect(page.document.documentElement.dataset.theme).toBe("light");
    // Nothing kept, or a storage that cannot be read: the system's theme.
    page = await openAbout(true, null);
    expect(page.document.documentElement.dataset.theme).toBe("dark");
    page = await openAbout(false, new Error("The storage is not available."));
    expect(page.document.documentElement.dataset.theme).toBe("light");
  });
});
