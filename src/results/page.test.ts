import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { RESULTS_PAGE } from "../protocol.js";
import { parseMarkup } from "./dom.test-support.js";
import { keptCopyHtml } from "./markup.js";
import { readMarkup } from "./markup.test-support.js";
import { PAGE_IDS } from "./page-ids.js";

// The page itself and its stylesheet, as they are packaged: an extension page runs no inline script and no inline handler.
const html = readFileSync(new URL(`../../${RESULTS_PAGE}`, import.meta.url), "utf8");
const css = readFileSync(new URL("../../results.css", import.meta.url), "utf8");
const { tags } = readMarkup(html, true);
const opening = tags.filter(tag => !tag.closing);

describe("The results page's files", () => {
  it("loads its one script from the extension, last, and writes none in the page", () => {
    const scripts = tags.map((tag, index) => ({ tag, index })).filter(({ tag }) => tag.name === "script" && !tag.closing);
    expect(scripts.map(({ tag }) => [...tag.attributes])).toEqual([[["src", "dist/results.js"]]]);
    // Nothing between the script's tags, and nothing after it but the end of the page.
    const at = scripts[0].index;
    expect(tags.slice(at + 1).map(tag => `${tag.closing ? "/" : ""}${tag.name}`)).toEqual(["/script", "/body", "/html"]);
    expect(html).toContain("<script src=\"dist/results.js\"></script>\n</body>");
  });

  it("has no inline event handler and no script address", () => {
    expect(opening.flatMap(tag => [...tag.attributes.keys()]).filter(name => /^on/i.test(name))).toEqual([]);
    expect(html).not.toMatch(/javascript:/i);
  });

  it("loads nothing from outside the extension", () => {
    const addresses = opening.flatMap(tag => ["src", "href", "action", "data", "poster", "srcset"].flatMap(name => (tag.attributes.has(name) ? [`${tag.name} ${name}=${tag.attributes.get(name)}`] : [])));
    expect(addresses).toEqual(["link href=icons/32.png", "link href=results.css", "a href=#view", "script src=dist/results.js"]);
    for (const text of [html, css]) {
      expect(text).not.toMatch(/https?:|\/\//i);
      expect(text).not.toMatch(/url\(|@import|@font-face/i);
    }
    expect(opening.map(tag => tag.name).filter(name => ["iframe", "img", "object", "embed", "base", "form", "style"].includes(name))).toEqual([]);
  });

  it("holds each element the script looks up, once", () => {
    const ids = opening.flatMap(tag => (tag.attributes.has("id") ? [tag.attributes.get("id")] : []));
    expect(PAGE_IDS.filter(id => ids.filter(found => found === id).length !== 1)).toEqual([]);
    // And no ID twice, the script's or not.
    expect(ids.filter((id, index) => ids.indexOf(id) !== index)).toEqual([]);
  });

  it("shows nothing of the room the overview holds for a kept copy's line and button: the stylesheet hides what the markup marks as to come", () => {
    // While a result is being kept the place holds the words of the line and of the button (markup.ts `keptCopyHtml`).
    // They say that a copy is kept, which is not so yet: each part is marked, and the stylesheet must not show a marked one.
    const room = parseMarkup(keptCopyHtml("keeping")).children;
    expect(room.map(part => [part.classList.contains("to-come"), part.textContent])).toEqual([[true, "A copy of this result is kept for a refresh of this page."], [true, "Forget this result"]]);
    /** The stylesheet's rules whose selector names a class or the like, each as its selector and what it declares. */
    const rules = (name: string) => [...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => [selector.trim(), body.trim()]).filter(([selector]) => selector.includes(name));
    // Unseen, and still taking its room, which `display:none` would not: that room is what it is there for.
    expect(rules(".to-come")).toEqual([[".ov-kept .to-come", "visibility:hidden"]]);
    // The place of a result that could not be kept holds nothing, and takes no room.
    expect(rules(".ov-kept:empty")).toEqual([[".ov-kept:empty", "display:none"]]);
  });

  it("carries no demo left from the design: no sample name, no version, no preview control", () => {
    expect(html).not.toMatch(/Demo|Preview state|previewState|Assortment|0\.9\.3/);
    expect(opening.find(tag => tag.attributes.get("id") === "version")?.attributes.get("class")).toBe("ver");
    expect(html).toContain("<span class=\"ver\" id=\"version\"></span>");
    expect(css).not.toMatch(/preview-lab/);
  });
});
