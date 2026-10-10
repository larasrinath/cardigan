import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { RESULTS_PAGE } from "../protocol.js";
import { FakePage, parseMarkup } from "./dom.test-support.js";
import { cardDrawerHtml, keptCopyHtml, navHtml, navItems, navMenuHtml, overviewHtml, rowDrawerHtml, runHtml, tableHtml } from "./markup.js";
import { readMarkup } from "./markup.test-support.js";
import { PAGE_IDS } from "./page-ids.js";

// The page itself and its stylesheet, as they are packaged: an extension page runs no inline script and no inline handler.
const html = readFileSync(new URL(`../../${RESULTS_PAGE}`, import.meta.url), "utf8");
const css = readFileSync(new URL("../../results.css", import.meta.url), "utf8");
/** The extension's manifest, which names the icons that are packaged with it. */
const manifest = JSON.parse(readFileSync(new URL("../../manifest.json", import.meta.url), "utf8")) as { icons: Record<string, string> };
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
    expect(addresses).toEqual(["link href=icons/32.png", "link href=results.css", "link href=map.css", "a href=#view", "img src=icons/128.png", "script src=dist/results.js"]);
    for (const text of [html, css]) {
      expect(text).not.toMatch(/https?:|\/\//i);
      expect(text).not.toMatch(/url\(|@import|@font-face/i);
    }
    // One image and no more: the extension's own icon beside its name in the header, one of the icons/ files that the
    // manifest names, which are packaged with the page (scripts/package.mjs). Its text is empty: the name beside it says
    // it. No other image, and none of the elements that would load or hold another document, a form or styles.
    const images = opening.filter(tag => tag.name === "img");
    expect(images.map(tag => [...tag.attributes])).toEqual([[["src", "icons/128.png"], ["alt", ""], ["width", "26"], ["height", "26"]]]);
    expect(images.map(tag => [/^icons\/\d+\.png$/.test(tag.attributes.get("src") ?? ""), Object.values(manifest.icons).includes(tag.attributes.get("src") ?? "")])).toEqual([[true, true]]);
    expect(opening.map(tag => tag.name).filter(name => ["iframe", "object", "embed", "base", "form", "style"].includes(name))).toEqual([]);
  });

  it("shows the extension's own icon beside its name in the header, the one Chrome shows in its toolbar, and no drawing of its own in its place", () => {
    const brand = new FakePage(html).find(".hd .brand");
    expect(brand.children.map(child => [child.localName, child.getAttribute("class"), child.getAttribute("src")])).toEqual([["img", null, "icons/128.png"], ["span", "brand-name", null]]);
    expect(brand.querySelectorAll("svg")).toEqual([]);
    // The largest of the icons, drawn at the brand's size: sharp on a screen of any density. Only its place is styled.
    expect([manifest.icons["128"], rules(".brand").map(([selector]) => selector)]).toEqual(["icons/128.png", [".brand", ".brand img", ".brand-name"]]);
    expect(declared(".brand img")).toEqual(["display:block"]);
  });

  it("offers nothing to download: its header holds the run control, the switch of the times' zone and the theme's button, and the page no link that saves a file", () => {
    // A result is shown on the page and saved nowhere. The header's controls are these three, the page's one link leads
    // to a place in the page, and no word of it names a download, a zip or a CSV.
    const shell = new FakePage(html);
    expect(shell.find(".hd-actions").children.map(child => [child.localName, child.id])).toEqual([["button", "runAgain"], ["div", "timesSwitch"], ["button", "themeToggle"]]);
    // The switch is two buttons, Local first, after a word that names them; it is hidden until a result is shown.
    expect([shell.id("timesSwitch").hidden, shell.all("#timesSwitch [data-times]").map(button => [button.dataset.times, button.textContent.trim()]), shell.texts("#timesSwitch .times-lab")])
      .toEqual([true, [["local", "Local"], ["utc", "UTC"]], ["Times"]]);
    expect(opening.filter(tag => tag.name === "a" || tag.attributes.has("download")).map(tag => [...tag.attributes])).toEqual([[["class", "skip"], ["href", "#view"]]]);
    expect(html).not.toMatch(/download|\.zip|\.csv/i);
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
    expect([page.id("main").children.map(child => child.id), host.localName, [...host.attributes.keys()], host.hidden, host.childNodes.length]).toEqual([["view", "mapHost"], "div", ["id", "hidden"], true, 0]);
  });

  it("gives the map's place the height the window leaves while it is shown, and no look of its own", () => {
    // The place itself takes the room that is left and is never lower than 320px. What stands in it is placed from it
    // and stacked within it, and is not cut off: a map that needs more height than the place has shows whole. How the
    // map looks is the map's own: the page gives its place no colour, border, padding or type.
    expect(rules("#mapHost").filter(([selector]) => selector === "#mapHost")).toEqual([["#mapHost", "position:relative;flex:1 1 0;min-height:320px;isolation:isolate"]]);
    // The page is as high as the window only while the place is shown: every other rule about it says so of each box it
    // sizes, from the page down to the main area, and a hidden place changes nothing on the page. While it is shown the
    // shell keeps 12px at the window's two sides, at every width, less than the gutter that every other view keeps: the
    // map takes nearly the whole width. The banners keep the gutter, as the header and the navigation do.
    expect(rules("#mapHost").filter(([selector]) => selector !== "#mapHost")).toEqual([
      ["body:has(#mapHost:not([hidden]))", "display:flex;flex-direction:column;height:100dvh"],
      ["body:has(#mapHost:not([hidden])) > .banners,body:has(#mapHost:not([hidden])) > .shell", "width:100%"],
      ["body:has(#mapHost:not([hidden])) > .shell", "flex:1 1 0;min-height:0;padding:12px"],
      ["main:has(> #mapHost:not([hidden]))", "align-self:stretch;display:flex;flex-direction:column"],
      // The one time the place stands over the page: the map fills the window, where the browser would not give it the
      // screen. Only the page's toasts stand over it then.
      ["#mapHost:has(> .map-full-window)", "z-index:85"],
    ]);
    expect(rules("[hidden]")[0]).toEqual(["[hidden]", "display:none !important"]);
  });

  /** The rules a media query holds, by the query as the stylesheet writes it: each as its selector and what it declares. */
  const mediaRules = (query: string): string[][] => {
    const plain = css.replace(/\/\*[\s\S]*?\*\//g, "");
    const found: string[][] = [];
    // The stylesheet may say a query more than once: the rules of each of its blocks, in the stylesheet's order.
    for (let at = plain.indexOf(`@media ${query}{`); at >= 0; at = plain.indexOf(`@media ${query}{`, at + 1)) {
      const open = plain.indexOf("{", at);
      let close = open;
      for (let depth = 0; close < plain.length; close++) {
        if (plain[close] === "{") depth++;
        else if (plain[close] === "}" && --depth === 0) break;
      }
      found.push(...[...plain.slice(open + 1, close).matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => [selector.trim(), body.trim().replace(/\s+/g, " ")]));
    }
    return found;
  };
  /** What the rules of exactly this selector declare, in the stylesheet's order: the rule for every width first. */
  const declared = (selector: string): string[] => rules(selector).filter(([found]) => found === selector).map(([, body]) => body.replace(/\s+/g, " "));

  it("stands every view but a model's map in one column in the middle of the window, at most 1400px wide, whose sides the header, the navigation, the banners and the content all keep", () => {
    // No rule gives the shell, the banners or the main area a greatest width or a margin: the column is the room each of
    // them keeps at its two sides, the gutter, so that their backgrounds and borders still reach the window's edges.
    const sized = [".shell", ".banners", "main"].flatMap(name => rules(name));
    expect(sized.length).toBeGreaterThan(6);
    expect(sized.filter(([, body]) => /max-width|margin/.test(body))).toEqual([]);
    // The column is at most 1400px wide, with at least the edge at each side: 16px in a phone's window, more as the window
    // widens past 400px, and 48px from 1200px on. From 1496px on the column is 1400px wide, in the middle of the window,
    // and the rest of the width is the room at its two sides.
    const token = (name: string) => css.match(new RegExp(`\\n {2}--${name}:([^;]*);\\n`))?.[1];
    expect([token("column"), token("edge"), token("gutter")]).toEqual(["1400px", "clamp(16px,4vw,48px)", "max(var(--edge),calc((100% - var(--column)) / 2))"]);
    // The gutter's 100% is the width of the box it is a side of. Each of the four is as wide as the window: a child of the
    // page's body, or of a box of the top of the page, none of which has a side or a width of its own.
    const page = new FakePage(html);
    expect([".hd", ".nav-list", ".banners", ".shell"].map(name => page.find(name).parentElement).map(parent => parent?.getAttribute("class") ?? parent?.localName))
      .toEqual(["top", "topnav", "body", "body"]);
    expect(rules(".top").filter(([, body]) => /padding|margin|width/.test(body))).toEqual([]);
    // The room for a scrollbar is kept whether the page scrolls or not: a long overview scrolls and a table's page does
    // not, and a scrollbar that came and went would move the column sideways, the header and the navigation with it.
    expect(declared("html")).toEqual(["scrollbar-gutter:stable"]);
    // The header, the navigation in either of its forms, the banners and the shell all keep the gutter, so that their
    // edges line up. The shell holds the main area alone, so it has no gap between parts.
    expect(declared(".shell")[0]).toBe("display:flex;padding:12px var(--gutter) 32px;align-items:flex-start");
    expect(declared(".banners")).toEqual(["padding:12px var(--gutter) 0;display:grid;gap:8px"]);
    expect(declared(".hd")[0]).toContain("padding:10px var(--gutter);");
    expect([declared(".nav-list")[0], declared(".nav-compact")[0]]).toEqual(["display:flex;flex-wrap:wrap;align-items:center;gap:4px 2px;padding:6px var(--gutter)", "display:none;padding:6px var(--gutter)"]);
    // The narrow layout gives none of their sides of its own: the gutter narrows with the window by itself.
    const narrow = new Map(mediaRules("(max-width:1120px)").map(([selector, body]) => [selector, body]));
    expect([narrow.get(".hd"), narrow.get(".nav-list"), narrow.get(".nav-compact"), narrow.get(".banners"), narrow.get(".shell")]).toEqual(["gap:10px", undefined, undefined, undefined, "padding-bottom:28px"]);
    // Nor does any other rule but the map's (see the map's place, above): no side of the five is a length of its own.
    const sides = [".hd", ".nav-list", ".nav-compact", ".banners", ".shell"].flatMap(name => rules(name)).filter(([selector]) => !selector.includes("#mapHost"))
      .flatMap(([, body]) => body.split(";").map(declaration => declaration.trim()))
      .filter(declaration => /^padding(-left|-right|-inline)?:/.test(declaration));
    expect([sides.length, sides.filter(declaration => !declaration.includes("var(--gutter)"))]).toEqual([5, []]);
  });

  it("keeps prose to a measure in a wide window, and only there; each thing it names is what the page writes", () => {
    // In a window as wide as it likes, a note, a paragraph of how to read the tables and the words of an empty state
    // would run to lines of any length. They keep to the measure; the line under a table's name may be twice as long.
    const measured = mediaRules("(width > 1120px)").filter(([, body]) => body.includes("--measure"));
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
    // The page's script writes what these rules name: an overview with a note and with how to read the tables, the view
    // of a run, and a table with a line under its name and no row.
    const written = parseMarkup(overviewHtml({ tiles: [], notes: ["A note."], about: [], files: [], howToRead: [["Layout", "How each table is laid out."]], log: [] })
      + runHtml()
      + tableHtml({ label: "Line Items", note: "A line under the name.", columns: [], widths: new Map(), rows: [], page: 0, pages: 1, pageSize: 50, from: 0, to: 0, total: 0, all: 0, search: "", sort: undefined,
        filtered: new Set(), context: undefined, links: { page: false, card: false } }));
    const named = measured.flatMap(([selector]) => selector.split(","));
    expect(named.map(selector => [selector, written.querySelectorAll(selector).length > 0])).toEqual(named.map(selector => [selector, true]));
    expect([written.querySelector("#ovHowTo .dl dd")?.textContent, written.querySelector(".warn-list li")?.textContent, written.querySelector(".view-note")?.textContent])
      .toEqual(["How each table is laid out.", "A note.", "A line under the name."]);
  });

  it("shows each line of a value about the export on a line of its own, by one rule of the stylesheet, and the value in the markup as its text", () => {
    // A value about the export that lists several things has each on a line of its own, as the analysis writes an app's
    // categories and its models, and so has one that says two, as the pages analysed do when pages were left unpublished.
    // The markup writes such a value as its text and nothing else: no tag for a line break, and no space around the
    // value, which the rule would show as well. A value of one line is one line.
    const about: [string, string][] = [["Categories", "Demand\nSupply\n00 Admin"], ["Pages analysed", "2 of 2 (published versions)\n1 unpublished, not analysed"],
      ["Models", "Model one (Workspace one)\nModel two (Workspace two)"], ["Cards", "6"]];
    const written = parseMarkup(overviewHtml({ tiles: [], notes: [], about, files: [["Imports", "Not exported: the grid did not load"]],
      howToRead: [["Layout", "How each table is laid out."]], log: [] }));
    const values = written.querySelectorAll("#ovAbout .dl dd");
    expect(values.map(value => [value.children.length, value.textContent.split("\n")])).toEqual([[0, ["Demand", "Supply", "00 Admin"]],
      [0, ["2 of 2 (published versions)", "1 unpublished, not analysed"]], [0, ["Model one (Workspace one)", "Model two (Workspace two)"]], [0, ["6"]]]);
    // The stylesheet shows those lines as the value has them, by one rule, which names what the markup writes: the values
    // of that list, and of no other list of details. No rule keeps the lines of a value under Tables or of how to read
    // the tables, which are shown as they always were.
    expect(rules("#ovAbout")).toEqual([["#ovAbout .dl dd", "white-space:pre-line"]]);
    expect([written.querySelectorAll(".dl dd").length, values.length]).toEqual([6, 4]);
    expect(rules(".dl dd").filter(([, body]) => body.includes("white-space"))).toEqual([["#ovAbout .dl dd", "white-space:pre-line"]]);
  });

  it("holds the navigation in a bar of its own under the header, the two the top of the page, hidden until there is a result, with nothing that puts it away", () => {
    const shell = new FakePage(html);
    const top = shell.find(".top");
    const bar = shell.id("topnav");
    // The header and the navigation under it are the top of the page: after the link that skips to the results, before
    // the banners and the shell.
    expect(shell.find("body").children.slice(0, 4).map(child => child.id || child.getAttribute("class"))).toEqual(["skip", "top", "banners", "shell"]);
    expect([top.children.map(child => child.localName), top.children[1] === bar]).toEqual([["header", "nav"], true]);
    // The bar is a landmark with a name of its own. It holds the places the script writes the navigation into, its line
    // and the one menu that stands in the line's place in a narrow window, and nothing else; until the script has a
    // result to navigate, it is hidden, and nothing of it is drawn.
    expect([bar.localName, bar.getAttribute("aria-label"), bar.hidden, bar.children.map(child => [child.id, child.getAttribute("class"), child.childNodes.length])])
      .toEqual(["nav", "Result tables", true, [["navList", "nav-list", 0], ["navCompact", "nav-compact", 0]]]);
    // Nothing is left of the button that put the old navigation away, of the drawer it slid in as, or of the breadcrumb:
    // no element, no rule, and no rule that reads a choice from the page's root.
    expect(["navToggle", "sidenav", "crumbs"].filter(id => html.includes(`id="${id}"`))).toEqual([]);
    const plain = css.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(["data-navigation", ".nav-toggle", ".sidenav", ".crumbs"].filter(name => plain.includes(name))).toEqual([]);
    // The header holds the brand, the name of what was analysed and the actions, in that order, and nothing on the page
    // is drawn out of its order.
    /** A declaration of the order a box is drawn in: the property of that name, and no other whose name ends so. */
    const ORDER = /(?<![a-z-])order:/g;
    expect([shell.find(".hd").children.map(child => child.id || child.getAttribute("class")), plain.match(ORDER)]).toEqual([["brand", "hdMeta", "hd-actions"], null]);
  });

  it("lays the navigation out on one line, a model's tables in groups whose menus have the popovers' look, with one menu in the line's place under 1000px wide; it marks the view shown as it always did", () => {
    // One line of items, each as wide as its words and on one line of its own: no item fills the line. An item goes to the
    // next line only where the line has no room, which no line the page knows needs where it is shown (see below).
    // Nothing of the line scrolls: no rule of it holds an overflow or a scroll.
    expect(declared(".nav-list")[0]).toBe("display:flex;flex-wrap:wrap;align-items:center;gap:4px 2px;padding:6px var(--gutter)");
    const item = declared(".nav-item,.nav-group-btn")[0];
    expect([item.includes("flex:none;"), item.includes("white-space:nowrap;"), /width|margin/.test(item)]).toEqual([true, true, false]);
    expect([".nav-list", ".nav-item", ".nav-group-btn", ".topnav"].flatMap(name => rules(name)).filter(([, body]) => /overflow|scroll/.test(body))).toEqual([]);
    // A menu has the look of the page's popovers, their panel, border, corners and shadow, and stands under its button,
    // over the content and the tables' headers, under the drawer. The one long menu, a narrow window's, scrolls within itself.
    const menu = declared(".nav-menu")[0];
    const popover = declared(".popover")[0];
    expect(["background:var(--panel)", "border:1px solid var(--border-strong)", "border-radius:var(--r-md)", "box-shadow:var(--shadow)"].map(part => [part, menu.includes(part), popover.includes(part)]))
      .toEqual(["background:var(--panel)", "border:1px solid var(--border-strong)", "border-radius:var(--r-md)", "box-shadow:var(--shadow)"].map(part => [part, true, true]));
    expect([menu.includes("position:absolute;"), menu.includes("overflow-y:auto;"), /z-index:(\d+)/.exec(menu)?.[1]]).toEqual([true, true, "50"]);
    // Under 1000px wide the one menu stands in the line's place, whatever the result's kind: the line needs about 860px.
    // It is the narrow layout's only rule about the navigation, and nothing slides in over the content.
    expect(mediaRules("(max-width:1000px)")).toEqual([[".nav-list", "display:none"], [".nav-compact", "display:flex"]]);
    expect(mediaRules("(max-width:1120px)").filter(([selector]) => /nav/.test(selector))).toEqual([]);
    // An entry has no count: the overview's tiles say how many rows each table has.
    expect(rules(".cnt")).toEqual([]);
    // The entry of the view shown is marked as it always was, in the accent's soft colour and its ink with its words in
    // bold, and so is the button of the group that holds it. Every colour of the bar is one of the page's tokens, so that
    // both themes have it.
    expect(declared('.nav-item[aria-current="page"],.nav-group-btn[aria-current="true"]')).toEqual(["background:var(--accent-soft);color:var(--accent-ink);font-weight:600"]);
    expect([...rules(".nav-"), ...rules(".topnav")].flatMap(([, body]) => body.match(/#[0-9a-f]{3,8}\b|rgba?\(/gi) ?? [])).toEqual([]);
    // What these rules name is what the page writes: entries, a group with its button, chevron and menu, and the one menu
    // with a group's section under its heading, the entry of the view shown marked in each, and its group.
    const entries = [{ id: "overview", label: "Overview" }, { id: "1", label: "Modules", file: "Modules.csv" }, { id: "2", label: "Line Items", file: "Line Items.csv" }];
    const written = parseMarkup(navHtml(navItems(entries, true), "2") + navMenuHtml(navItems(entries, true), "2", "Line Items"));
    expect([".nav-item", ".nav-group", ".nav-group-btn", ".nav-chevron", ".nav-menu", ".nav-section", ".nav-heading", '.nav-item[aria-current="page"]', '.nav-group-btn[aria-current="true"]', ".cnt"]
      .map(selector => written.querySelectorAll(selector).length)).toEqual([6, 2, 2, 2, 2, 1, 1, 2, 1, 0]);
  });

  it("keeps the header and the navigation at the top of the window together, as one box, which a window under 640px wide, or a narrow one that is short, lets scroll away", () => {
    // The box of the two stays at the top, over the content that scrolls under it. The header has no place of its own:
    // the navigation needs to know nothing of the header's height, which grows as the header wraps.
    expect(declared(".top")[0]).toBe("position:sticky;top:0;z-index:40");
    expect(rules(".hd").filter(([selector]) => selector === ".hd").map(([, body]) => /position|top:|z-index/.test(body))).toEqual([false, false]);
    // Under 640px wide the header wraps onto two or three lines, and in a window that is narrow and short the two take
    // much of its height whatever its width. There they would cover much of the window: they scroll away with the page.
    // That is the one other rule for the box.
    expect(mediaRules("(max-width:640px), (max-width:1120px) and (max-height:560px)")).toEqual([[".top", "position:static"]]);
    expect(declared(".top")).toEqual(["position:sticky;top:0;z-index:40", "position:static"]);
  });

  it("styles the page a jump keeps as a chip of its own in a table's toolbar, which wraps the page's name within itself rather than widen the page", () => {
    const view = parseMarkup(tableHtml({ label: "Cards", note: undefined, columns: [], rows: [], page: 0, pages: 1, pageSize: 50, from: 0, to: 0, total: 0, all: 0, search: "", sort: undefined,
      filtered: new Set(), context: "Stores", links: { page: true, card: true } }));
    expect([view.querySelectorAll(".toolbar .ctx").length, rules(".ctx").map(([selector]) => selector)]).toEqual([1, [".ctx", ".ctx button", ".ctx button:hover"]]);
    expect(declared(".ctx")[0]).toContain("overflow-wrap:anywhere;");
  });

  it("lays the results table out by the widths the page writes on its columns, and by nothing the rows on screen hold", () => {
    const every = rules("");
    // Only the results table is laid out by its columns' widths, by rules of its box's own: a card's small tables in the
    // drawer keep the rules every table has, and the browser's own layout. With no width of its own the results table
    // is as wide as its columns, and at least as wide as its box.
    expect(every.filter(([, body]) => body.includes("table-layout"))).toEqual([[".table-wrap table", "table-layout:fixed;width:0"]]);
    expect(declared("table")).toEqual(["border-collapse:separate;border-spacing:0;width:max-content;min-width:100%;font-size:12.5px"]);
    // Each column is as wide as its <col> says, and the first, which stays at the left, at most half of what the box
    // shows. No cell's own width rule is left to say otherwise: in this layout it would say nothing.
    expect([declared(".table-wrap col"), declared(".table-wrap col:first-child"), declared(".table-wrap :is(th,td):first-child")[0]])
      .toEqual([["width:var(--width)"], ["width:min(var(--width),50cqi - 9px)"], "position:sticky;left:0"]);
    expect(every.filter(([selector, body]) => selector.includes(":first-child") && selector.includes("table-wrap") && /(^|;)\s*(max-)?width/.test(body)).map(([selector]) => selector))
      .toEqual([".table-wrap col:first-child"]);
    // The sort mark keeps its room in every header, sorted or not, and never gives it up; a header's name takes a second
    // line rather than run into the next header's. Every other table's headers stay on one line, as they were.
    expect(declared(".th-sort .dir")).toEqual(["display:inline-flex;align-items:center;color:var(--accent);width:9px;flex:none"]);
    expect([declared(".table-wrap thead th"), declared("thead th")[0].includes("white-space:nowrap")]).toEqual([["white-space:normal;overflow-wrap:anywhere"], true]);
    // A row keeps to one line: a text wider than its column ends in an ellipsis, in the cell and in the text's own box.
    expect([declared("tbody td")[0].includes("white-space:nowrap;overflow:hidden;text-overflow:ellipsis"), declared(".cell-t")[0].includes("max-width:100%;overflow:hidden;text-overflow:ellipsis")])
      .toEqual([true, true]);
    // The page writes what the rules read: a <col> for each column shown, which says its width and nothing else.
    const column = (index: number, label: string) => ({ index, label, kind: "text" as const, num: false, filter: false, hidden: false });
    const written = parseMarkup(tableHtml({ label: "Modules", note: undefined, columns: [column(0, "Name"), column(2, "Cell Count")], widths: new Map([[0, 20], [2, 12]]), rows: [["Revenue", "", "12"]],
      page: 0, pages: 1, pageSize: 50, from: 1, to: 1, total: 1, all: 1, search: "", sort: undefined, filtered: new Set(), context: undefined, links: { page: false, card: false } }));
    expect(written.querySelectorAll(".table-wrap col").map(col => [...col.attributes])).toEqual([[["style", "--width:20ch"]], [["style", "--width:12ch"]]]);
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

  it("lists a value of several items one to a line, in the drawer's values and in a card's parts alike, by the page's tokens alone", () => {
    // The list takes no room round it; its bullet hangs in its own margin, in the muted colour; an item's text runs as text,
    // so that the bullet stands beside an item's first line, not beside the last line of a box.
    expect(rules(".cell-list")).toEqual([[".cell-list", "margin:0;padding-left:16px"], [".cell-list li + li", "margin-top:3px"], [".cell-list li::marker", "color:var(--text-3)"],
      [".cell-list .cell-t", "display:inline"]]);
    // The one colour is a token, which the light theme and the dark one each set.
    for (const theme of [":root{", ':root[data-theme="dark"]{']) {
      const at = css.indexOf(theme);
      expect([at >= 0, /--text-3:#[0-9a-f]{6};/.test(css.slice(at, css.indexOf("}", at)))], theme).toEqual([true, true]);
    }
    // The page's script writes what the rules name: a list among the drawer's values, and in a cell of a card's part.
    const column = { index: 0, label: "Context selectors", kind: "text" as const, num: false, filter: false, hidden: false };
    const items = new Map([[0, ["Territory (visible, synced to page)", "Channel (hidden)"]]]);
    const written = parseMarkup(rowDrawerHtml([column], ["Territory (visible, synced to page); Channel (hidden)"], { page: false, card: false }, undefined, items)
      + cardDrawerHtml([], [], { page: false, card: false }, [{ title: "Filters", none: "filters", headings: ["Context"], colours: [false], rows: [[["Time = current", "Version = Actual"]]] }]));
    expect([written.querySelectorAll(".d-dl dd .cell-list li .cell-t").length, written.querySelectorAll(".mini td .cell-list li .cell-t").length]).toEqual([2, 2]);
  });

  it("makes every tile of the overview the same size: columns of one width, rows of one height, a name on one line, and no word under the number", () => {
    const body = (name: string, selector: string) => rules(name).find(([found]) => found === selector)?.[1] ?? "";
    const [grid, tile, label, number] = [body(".ov-grid", ".ov-grid"), body(".stat", ".stat"), body(".s-lab", ".stat .s-lab"), body(".s-num", ".stat .s-num")];
    // Columns of one width, and every row as high as the highest: a tile never grows with its name or its number.
    expect([/grid-template-columns:repeat\(auto-fill,minmax\(\d+px,1fr\)\)/.test(grid), grid.includes("grid-auto-rows:1fr"), tile.includes("min-width:0"), tile.includes("height:100%")])
      .toEqual([true, true, true, true]);
    // A name and a number keep to one line, cut with an ellipsis where they are too long; the line under the number is gone.
    expect([["white-space:nowrap", "overflow:hidden", "text-overflow:ellipsis"].every(rule => label.includes(rule) && number.includes(rule)), rules(".s-sub").length]).toEqual([true, 0]);
  });

  it("carries no demo left from the design: no sample name, no version, no preview control", () => {
    expect(html).not.toMatch(/Demo|Preview state|previewState|Assortment|0\.9\.3/);
    expect(opening.find(tag => tag.attributes.get("id") === "version")?.attributes.get("class")).toBe("ver");
    expect(html).toContain("<span class=\"ver\" id=\"version\"></span>");
    expect(css).not.toMatch(/preview-lab/);
  });
});
