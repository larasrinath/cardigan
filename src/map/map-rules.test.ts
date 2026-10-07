import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { InspectLink } from "./map-inspect.js";
import { brokenHtml, crumbsHtml, emptyHtml, inspectorHtml, legendHtml, LIST_CAP, notesHtml, resultsHtml, shellHtml, tooltipHtml, tracebarHtml } from "./map-markup.js";

/** What the map may not do, checked in its own files: the stylesheet and the sources that are bundled. These are the
 * rules the map was built to; a change that breaks one fails here rather than on the page. */

const here = new URL("./", import.meta.url);
const SOURCES = readdirSync(here).filter(name => /^map-[\w-]+\.ts$/.test(name) && !/\.test(-support)?\.ts$/.test(name)).sort();
const source = (name: string): string => readFileSync(new URL(name, here), "utf8");
/** A source without its comments, so that a rule is not broken by a sentence about it. */
const code = (name: string): string => source(name).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
/** What of a text a pattern finds: a failed check then shows what was found, and not the whole text. */
const found = (text: string, pattern: RegExp): string[] => text.match(new RegExp(pattern.source, "g")) ?? [];
const CSS = readFileSync(new URL("../../map.css", import.meta.url), "utf8");
const STYLES = CSS.replace(/\/\*[\s\S]*?\*\//g, "");

/** The selectors of the stylesheet's rules, and the at-rules' own lines. */
function selectors(styles: string): string[] {
  const found: string[] = [];
  let at = 0;
  let last = 0;
  while (at < styles.length) {
    const char = styles[at];
    if (char === "{") {
      found.push(styles.slice(last, at).trim());
      last = at + 1;
    } else if (char === "}") last = at + 1;
    else if (char === ";") last = at + 1;
    at++;
  }
  return found.filter(selector => selector !== "");
}

describe("The map's sources", () => {
  it("are the map's own files, and take nothing from the rest of the extension but the contract and the page's words for a cell", () => {
    expect(SOURCES).toEqual(["map-camera.ts", "map-canvas.ts", "map-graphs.ts", "map-inspect.ts", "map-layout.ts", "map-markup.ts", "map-model.ts", "map-palette.ts", "map-search.ts", "map-text.ts", "map-trace.ts", "map-view.ts"]);
    const outside: string[] = [];
    for (const name of SOURCES) {
      const imports = [...source(name).matchAll(/from "([^"]+)"/g)].map(match => match[1]);
      for (const from of imports) if (!/^\.\/(graph-types|map-[\w-]+)\.js$/.test(from)) outside.push(`${name} < ${from}`);
    }
    // The details say a line item's Format and Summary as the page's Line Items table says them: one reader for both.
    expect(outside).toEqual(["map-inspect.ts < ../results/readable-cells.js"]);
    // That reader is text in and text out: it brings nothing of the page with it.
    const reader = readFileSync(new URL("../results/readable-cells.ts", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(reader.match(/^\s*(?:import|export \* from|export \{[^}]*\} from)\b.*$/gm) ?? []).toEqual([]);
    expect(found(reader, /\bdocument\b|\bwindow\b|innerHTML|querySelector|addEventListener|\bfetch\(|\bchrome\./)).toEqual([]);
  });

  it("keep everything that needs no page out of the view: only the view and the canvas touch the browser", () => {
    for (const name of SOURCES.filter(each => each !== "map-view.ts")) {
      expect(found(code(name), /\bdocument\b|\bwindow\b|getComputedStyle|requestAnimationFrame|ResizeObserver|addEventListener|innerHTML|querySelector/), name).toEqual([]);
    }
    // The canvas module draws with the pen it is handed, and makes none.
    expect(found(code("map-canvas.ts"), /getContext|createElement/)).toEqual([]);
  });

  it("never read the window's size, the address, the history or any storage", () => {
    for (const name of SOURCES) {
      expect(found(code(name), /innerWidth|innerHeight|outerWidth|outerHeight|visualViewport|\bscreen\.(?:width|height|avail\w+)|window\.screen|documentElement\.client|localStorage|sessionStorage|indexedDB|\bcaches\b|document\.cookie|\bhistory\s*[.[]|\blocation\s*[.[]|pushState|replaceState|\bchrome\./), name).toEqual([]);
    }
  });

  it("listen and look only inside the map's own element", () => {
    const view = code("map-view.ts");
    // Every listener is on the map's element, its canvas or its small picture: the page's elements are never listened to.
    const listened = [...view.matchAll(/(\w+)\.addEventListener\(/g)].map(match => match[1]);
    expect(new Set(listened)).toEqual(new Set(["root", "canvas", "miniCanvas"]));
    expect(found(view, /getElementById|getElementsBy|document\.querySelector|page\.querySelector|document\.body|page\.body|documentElement|removeEventListener/)).toEqual([]);
    // What it asks of the page's document: to make its element, and which element has the focus.
    const asked = [...view.matchAll(/\bpage\.(\w+)/g)].map(match => match[1]);
    expect(new Set(asked)).toEqual(new Set(["createElement", "activeElement"]));
    // Lookups are from the map's element down.
    const lookedIn = [...view.matchAll(/(\w+)\.querySelector(?:All)?[<(]/g)].map(match => match[1]);
    for (const owner of lookedIn) expect(["root", "inspector", "results", "holder", "tracebar", "crumbs"]).toContain(owner);
  });

  it("write markup only through the functions that escape it", () => {
    const view = code("map-view.ts");
    const written = [...view.matchAll(/\.innerHTML = ([^;]+);/g)].map(match => match[1].trim());
    expect(written.length).toBeGreaterThan(10);
    for (const value of written) expect(value).toMatch(/^(?:""|\w+Html\()/);
    // What is no markup is written as text: the line of what is shown, the search's count, what is said aloud.
    expect(found(view, /\b(?:stats|searchCount|live)\.innerHTML/)).toEqual([]);
    expect(found(view, /insertAdjacentHTML|outerHTML|document\.write|\.setAttribute\("(?:style|on\w+|href|src)"/)).toEqual([]);
    for (const name of SOURCES) expect(found(code(name), /\beval\(|new Function|setInterval|import\(/), name).toEqual([]);
    // The markup module writes no style and no address.
    expect(found(code("map-markup.ts"), /style=|href=|src=|javascript:/)).toEqual([]);
  });

  it("set styles only for a place on the canvas, never for a colour or from a model's text", () => {
    const view = code("map-view.ts");
    const styled = [...view.matchAll(/\.style\.(\w+) =/g)].map(match => match[1]);
    expect(new Set(styled)).toEqual(new Set(["left", "top"]));
  });

  it("load no font and no file", () => {
    for (const name of SOURCES) expect(found(code(name), /FontFace|fonts\.load|fonts\.add|fetch\(|XMLHttpRequest|new Image|\.src =|importScripts/), name).toEqual([]);
    expect(found(STYLES, /@font-face|@import|url\(|image-set\(/)).toEqual([]);
  });

  it("stop every timer and frame they start", () => {
    const view = code("map-view.ts");
    expect((view.match(/setTimeout\(/g) ?? []).length).toBe(1);
    expect(view).toMatch(/clearTimeout\(arriving\)/);
    expect(view).toMatch(/env\.cancelFrame\(frame\)/);
    expect(view).toMatch(/stopWatching\(\)/);
  });

  it("let no failure of a listener, a frame or a told size go uncaught", () => {
    const view = code("map-view.ts");
    // Every listener is wrapped in the guard that stops the map and says so in its place.
    const listeners = found(view, /\w+\.addEventListener\("\w+", [^\n]{0,12}/);
    expect(listeners.length).toBeGreaterThanOrEqual(14);
    for (const listener of listeners) expect(listener).toMatch(/addEventListener\("\w+", guarded\(/);
    // A picture the browser asks back for is drawn through the guard, and so is a size the browser tells.
    expect(found(view, /env\.requestFrame\((?!drawFrame\))[^)]*\)/)).toEqual([]);
    expect(view).toMatch(/const drawFrame = \(time: number\): void => guard\(\(\) => draw\(time\)\);/);
    expect(view).toMatch(/env\.watchSize\(canvas, \(nextWidth, nextHeight\) => \{\s*if \(shown\) guard\(\(\) => resize\(nextWidth, nextHeight\)\);/);
    expect(found(view, /env\.watchSize\(/)).toHaveLength(1);
  });
});

describe("The map's stylesheet", () => {
  it("names every class with the map's prefix, and styles nothing by an id or outside the map", () => {
    const all = selectors(STYLES);
    expect(all.length).toBeGreaterThan(100);
    for (const selector of all) {
      if (selector.startsWith("@")) continue;
      for (const [, name] of selector.matchAll(/\.([A-Za-z_][\w-]*)/g)) expect(name, selector).toMatch(/^map-/);
      expect(selector, "no id").not.toMatch(/#/);
      // Every rule is of the map's own elements: each selector of it holds one of the map's classes. A comma inside
      // brackets separates no selectors.
      for (const each of selector.split(/,(?![^()]*\))/)) expect(each, selector).toMatch(/\.map-/);
    }
  });

  it("fixes nothing to the window and measures nothing by it", () => {
    expect(found(STYLES, /position\s*:\s*(?:fixed|sticky)/)).toEqual([]);
    expect(found(STYLES, /\d(?:vw|vh|vmin|vmax|dvh|dvw|svh|svw|lvh|lvw)\b/)).toEqual([]);
    // The only question it asks of the window is whether the user wants less motion. Its sizes are its own element's.
    const media = selectors(STYLES).filter(selector => selector.startsWith("@media"));
    expect(media).toEqual(["@media (prefers-reduced-motion:reduce)"]);
    const containers = selectors(STYLES).filter(selector => selector.startsWith("@container"));
    expect(containers.length).toBeGreaterThanOrEqual(3);
    for (const query of containers) expect(query).toMatch(/^@container map \(max-(width|height):\d+px\)$/);
    expect(STYLES).toMatch(/container:map \/ size/);
  });

  it("keeps the map inside its element, never higher than the page's place for it needs", () => {
    // The map's element has a rule for its tokens and one for itself: both are read.
    const root = [...STYLES.replace(/\s*\n\s*/g, " ").matchAll(/(?:^|\})\s*\.map-root\{([^}]*)\}/g)].map(match => match[1]).join(";");
    expect(root).toMatch(/position:relative/);
    expect(root).toMatch(/overflow:hidden/);
    expect(root).toMatch(/isolation:isolate/);
    expect(root).toMatch(/box-sizing:border-box/);
    expect(root).toMatch(/height:100%/);
    // The page gives the map at least 320px: a higher least height of the map's own would make the page scroll.
    expect(Number(/min-height:(\d+)px/.exec(root)?.[1])).toBeLessThanOrEqual(320);
  });

  it("uses the page's tokens for panels, text, borders, the accent and the fonts, and no colour of its own outside its tokens", () => {
    for (const token of ["--panel", "--panel-2", "--border", "--border-strong", "--text", "--text-2", "--text-3", "--accent", "--accent-soft", "--accent-ink", "--ring", "--shadow", "--sans", "--mono", "--r-xs", "--r-sm", "--r-md"]) {
      expect(STYLES, token).toContain(`var(${token})`);
    }
    // Outside the two rules that set the map's tokens, a colour is a token: the one exception is the panels' soft shadow.
    const rules = STYLES.replace(/\s*\n\s*/g, " ").split("}").filter(rule => !/--map-canvas-bg:/.test(rule));
    for (const rule of rules) {
      const colours = rule.match(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g) ?? [];
      for (const colour of colours) expect(colour, rule.trim().slice(0, 80)).toMatch(/^rgba\(0,0,0,\.0\d\)$/);
    }
    expect(found(STYLES, /font-family:(?!var\(--(?:sans|mono)\))[^;}]*/)).toEqual([]);
  });

  it("has no rule for a class the map never writes, and a rule for every class the view sets to say a state", () => {
    const written = new Set<string>();
    // The classes of the markup: every class of everything it writes, with every part it can write and every colour.
    const layers = [...Array.from({ length: 8 }, (_, place) => `s${place}`), "lineitem", "heading", "external", "list", "property"];
    const links: InspectLink[] = Array.from({ length: LIST_CAP + 1 }, (_, index) => ({ raw: index, name: "Line", sub: "Module", caption: "read access", layer: layers[index % layers.length] }));
    const words = { feeds: "1 box feeds it", fed: "it feeds 2 boxes", sentence: "Line item Node selected." };
    const everything = [
      shellHtml({ results: "map-results-1", hints: "map-hints-1", legend: "map-legend-1", about: "map-about-1", access: "map-access-1" }, "Model"),
      notesHtml({ name: "Model", workspace: "Workspace", modules: 2, lineItems: 3 }, ["A sentence."], 1),
      crumbsHtml({ model: "Model", workspace: "Workspace", section: { index: 0, name: "Section" }, here: "Module" }), crumbsHtml({ model: "Model", workspace: "Workspace" }),
      legendHtml("Sections", layers.map(key => ({ key, label: key, count: 1 })), new Set(["external"])), tracebarHtml("Node", words, false), tracebarHtml("Node", words, true),
      tooltipHtml({ layer: "s0", kind: "kind", name: "Node", lines: ["a line"], formula: "A + B" }),
      resultsHtml({ hits: [{ kind: "module", name: "Module", context: "Section" }], total: 2 }), resultsHtml({ hits: [], total: 0 }),
      inspectorHtml({ kind: "LINE ITEM", layer: "lineitem", name: "Node", rows: [["Module", "Module"]], action: { label: "Open", module: 1 }, formula: "A + B", lists: [{ key: "depends", title: "Feeds it directly", open: true, links }],
        texts: [{ key: "actions", title: "Actions", lines: ["An action"] }], notes: "A note." }, words),
      inspectorHtml({ kind: "LINE ITEM", layer: "heading", name: "Node", rows: [], remark: "No formula.", lists: [], texts: [] }), emptyHtml("Nothing", "Nothing here.", ["A sentence."]),
      brokenHtml("A reason."),
    ].join("");
    for (const [, value] of everything.matchAll(/class="([^"]*)"/g)) for (const name of value.split(/\s+/)) if (name !== "") written.add(name);
    expect(written.size).toBeGreaterThan(80);
    // The classes the view sets: its element's own, and those that say a state.
    const view = code("map-view.ts");
    const states = new Set([...view.matchAll(/classList\.(?:add|remove|toggle)\("(map-[a-z0-9-]+)"/g)].map(match => match[1]));
    expect([...states].sort()).toEqual(["map-active", "map-arriving", "map-dragging", "map-has-inspector", "map-off", "map-over-node", "map-show"]);
    for (const name of states) written.add(name);
    for (const [, name] of view.matchAll(/setAttribute\("class", "(map-[a-z0-9-]+)"\)/g)) written.add(name);
    const styled = new Set([...STYLES.matchAll(/\.(map-[a-z][a-z0-9-]*)/g)].map(match => match[1]));
    expect([...styled].filter(name => !written.has(name)).sort()).toEqual([]);
    expect([...states].filter(name => !styled.has(name)).sort()).toEqual([]);
    // What the view looks up by a class is a class the markup writes.
    const looked = new Set([...view.matchAll(/["'`]\.(map-[a-z0-9-]+)["'`]/g)].map(match => match[1]));
    expect(looked.size).toBeGreaterThan(15);
    expect([...looked].filter(name => !written.has(name)).sort()).toEqual([]);
  });
});
