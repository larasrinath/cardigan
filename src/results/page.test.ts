import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { RESULTS_PAGE } from "../protocol.js";
import { FakePage, parseMarkup } from "./dom.test-support.js";
import { keptCopyHtml, overviewHtml, runHtml, tableHtml } from "./markup.js";
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
    expect(addresses).toEqual(["link href=icons/32.png", "link href=results.css", "link href=map.css", "a href=#view", "script src=dist/results.js"]);
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

  /** The stylesheet's rules whose selector names a class or the like, each as its selector and what it declares. */
  const rules = (name: string) => [...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => [selector.trim(), body.trim()]).filter(([selector]) => selector.includes(name));

  it("holds the place of a model's map beside the view, empty and hidden, and loads the map's stylesheet after its own", () => {
    // The map's styles use the page's tokens, so the page's stylesheet comes first.
    expect(opening.filter(tag => tag.name === "link" && tag.attributes.get("rel") === "stylesheet").map(tag => tag.attributes.get("href"))).toEqual(["results.css", "map.css"]);
    // The place is the last thing in the main area, after the view, which stays where it is while the map is shown. The
    // page gives it a name to find it by and nothing else: no class, no role, no style.
    const page = new FakePage(html);
    const host = page.id("mapHost");
    expect([page.id("main").children.map(child => child.id), host.localName, [...host.attributes.keys()], host.hidden, host.childNodes.length]).toEqual([["crumbs", "view", "mapHost"], "div", ["id", "hidden"], true, 0]);
  });

  it("gives the map's place the height the window leaves while it is shown, and no look of its own", () => {
    // The place itself takes the room that is left and is never lower than 320px. What stands in it is placed from it
    // and stacked within it, and is not cut off: a map that needs more height than the place has shows whole. How the
    // map looks is the map's own: the page gives its place no colour, border, padding or type.
    expect(rules("#mapHost").filter(([selector]) => selector === "#mapHost")).toEqual([["#mapHost", "position:relative;flex:1 1 0;min-height:320px;isolation:isolate"]]);
    // The page is as high as the window only while the place is shown: every other rule about it says so of each box it
    // sizes, from the page down to the main area, and a hidden place changes nothing on the page.
    expect(rules("#mapHost").filter(([selector]) => selector !== "#mapHost")).toEqual([
      ["body:has(#mapHost:not([hidden]))", "display:flex;flex-direction:column;height:100dvh"],
      ["body:has(#mapHost:not([hidden])) > .banners,body:has(#mapHost:not([hidden])) > .shell", "width:100%"],
      ["body:has(#mapHost:not([hidden])) > .shell", "flex:1 1 0;min-height:0;padding-bottom:12px"],
      ["body:has(#mapHost:not([hidden])) .sidenav", "max-height:100%"],
      ["main:has(> #mapHost:not([hidden]))", "align-self:stretch;display:flex;flex-direction:column"],
    ]);
    expect(rules("[hidden]")[0]).toEqual(["[hidden]", "display:none !important"]);
  });

  /** The rules a media query holds, by the query as the stylesheet writes it: each as its selector and what it declares. */
  const mediaRules = (query: string): string[][] => {
    const plain = css.replace(/\/\*[\s\S]*?\*\//g, "");
    const open = plain.indexOf("{", plain.indexOf(`@media ${query}{`));
    if (open < 0 || !plain.includes(`@media ${query}{`)) return [];
    let close = open;
    for (let depth = 0; close < plain.length; close++) {
      if (plain[close] === "{") depth++;
      else if (plain[close] === "}" && --depth === 0) break;
    }
    return [...plain.slice(open + 1, close).matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => [selector.trim(), body.trim().replace(/\s+/g, " ")]);
  };
  /** What the rules of exactly this selector declare, in the stylesheet's order: the rule for every width first. */
  const declared = (selector: string): string[] => rules(selector).filter(([found]) => found === selector).map(([, body]) => body.replace(/\s+/g, " "));

  it("is as wide as the window: nothing caps the shell or the banners, and the header, the banners and the shell keep to the same sides", () => {
    // The navigation stands at the window's left edge and the content takes the room beside it: no rule gives the
    // shell, the banners or the main area a greatest width, or sets them in the middle of the window.
    const sized = [".shell", ".banners", "main"].flatMap(name => rules(name));
    expect(sized.length).toBeGreaterThan(6);
    expect(sized.filter(([, body]) => /max-width|margin/.test(body))).toEqual([]);
    // One gutter is at the window's two sides and between the navigation and the content. The header and the banners
    // keep to the same sides as the shell: the brand stands over the navigation's edge, and a banner is as wide as the
    // navigation and the content together.
    expect(css).toMatch(/\n {2}--gutter:\d+px;\n/);
    expect(declared(".shell")[0]).toBe("display:flex;gap:var(--gutter);padding:12px var(--gutter) 32px;align-items:flex-start");
    expect(declared(".banners")[0]).toBe("padding:12px var(--gutter) 0;display:grid;gap:8px");
    expect(declared(".hd")[0]).toContain("padding:10px var(--gutter);");
    // The narrow layout, where the navigation slides in over the content, keeps its own sides.
    const narrow = new Map(mediaRules("(max-width:1120px)").map(([selector, body]) => [selector, body]));
    expect([narrow.get(".hd"), narrow.get(".banners"), narrow.get(".shell")]).toEqual(["gap:10px;padding:10px 14px", "padding:12px 20px 0", "padding:12px 14px 28px"]);
    expect([declared(".shell").length, declared(".banners").length]).toEqual([2, 2]);
  });

  it("keeps prose to a measure where the navigation stands beside the content, and only there; each thing it names is what the page writes", () => {
    // In a window as wide as it likes, a note, a paragraph of how to read the files and the words of an empty state
    // would run to lines of any length. They keep to the measure; the line under a table's name may be twice as long.
    const measured = mediaRules("(width > 1120px)");
    expect(measured).toEqual([
      [".warn-list li", "max-width:var(--measure)"],
      ["#ovHowTo .dl dd", "padding-right:max(16px,calc(100% - var(--measure) - 16px))"],
      [".empty .e-title,.empty .e-sub", "max-width:var(--measure);margin-left:auto;margin-right:auto"],
      [".view-note", "max-width:calc(2*var(--measure))"],
    ]);
    expect(css).toMatch(/\n {2}--measure:\d+ch;\n/);
    // The query is the other side of the narrow layout's, so the narrow layout is as it was: every use of the measure
    // is in this query, and none in a rule for every width or in the narrow layout's.
    const uses = (text: string): number => text.split("var(--measure)").length - 1;
    expect([uses(css.replace(/\/\*[\s\S]*?\*\//g, "")), uses(measured.map(([, body]) => body).join(";"))]).toEqual([4, 4]);
    expect(mediaRules("(max-width:1120px)").filter(([, body]) => body.includes("--measure"))).toEqual([]);
    // The page's script writes what these rules name: an overview with a note and with how to read the files, the view
    // of a run, and a table with a line under its name and no row.
    const written = parseMarkup(overviewHtml({ tiles: [], cardTypes: [], models: [], notes: ["A note."], about: [], files: [], howToRead: [["Layout", "How each file is laid out."]], log: [] })
      + runHtml()
      + tableHtml({ label: "Line Items", note: "A line under the name.", columns: [], rows: [], page: 0, pages: 1, pageSize: 50, from: 0, to: 0, total: 0, all: 0, search: "", sort: undefined,
        filtered: new Set(), context: undefined, links: { page: false, card: false } }));
    const named = measured.flatMap(([selector]) => selector.split(","));
    expect(named.map(selector => [selector, written.querySelectorAll(selector).length > 0])).toEqual(named.map(selector => [selector, true]));
    expect([written.querySelector("#ovHowTo .dl dd")?.textContent, written.querySelector(".warn-list li")?.textContent, written.querySelector(".view-note")?.textContent])
      .toEqual(["How each file is laid out.", "A note.", "A line under the name."]);
  });

  it("shows nothing of the room the overview holds for a kept copy's line and button: the stylesheet hides what the markup marks as to come", () => {
    // While a result is being kept the place holds the words of the line and of the button (markup.ts `keptCopyHtml`).
    // They say that a copy is kept, which is not so yet: each part is marked, and the stylesheet must not show a marked one.
    const room = parseMarkup(keptCopyHtml("keeping")).children;
    expect(room.map(part => [part.classList.contains("to-come"), part.textContent])).toEqual([[true, "A copy of this result is kept for a refresh of this page."], [true, "Forget this result"]]);
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
