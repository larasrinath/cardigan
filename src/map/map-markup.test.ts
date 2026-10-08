import { describe, expect, it } from "vitest";
import { parseMarkup } from "../results/dom.test-support.js";
import { decode, readMarkup, shownValues, structure } from "../results/markup.test-support.js";
import type { InspectLink, Inspection, TraceWords } from "./map-inspect.js";
import {
  ACCESS_SAYS, BESIDE_SAYS, brokenHtml, crumbsHtml, emptyHtml, esc, inspectorHtml, legendHtml, LINK_SAYS, LIST_CAP, listHtml, moduleOptionsHtml, notesHtml, resultsHtml, sectionOptionsHtml, shellHtml, TIP_FORMULA, tooltipHtml, tracebarHtml,
  type ShellIds,
} from "./map-markup.js";
import { HOSTILE } from "./map-fakes.test-support.js";

/** Texts for one build of a piece of markup: the hostile ones in turn, or a harmless word in their place. */
type Texts = (index: number) => string;
const hostile: Texts = index => HOSTILE[index % HOSTILE.length];
const harmless: Texts = index => `word ${index}`;

/** The attributes that may hold a text of a model: a tooltip and a name for a screen reader. Nothing else. */
const TEXT_ATTRIBUTES = new Set(["title", "aria-label"]);

/** Builds a piece of markup with hostile and with harmless texts in the same places, with the hostile ones moved on by
 * one place each time, and checks that the texts changed nothing but text: the same elements with the same attributes,
 * each hostile text shown exactly as typed, and none of it in an attribute that is more than a text. `places` is how many
 * places of the markup take a text. */
function expectInert(build: (text: Texts) => string, places: number): void {
  for (let shift = 0; shift < HOSTILE.length; shift++) {
    const shifted: Texts = index => hostile(index + shift);
    const html = build(shifted);
    expect(structure(html), `texts moved on by ${shift}`).toEqual(structure(build(harmless)));
    const shown = shownValues(html);
    for (let place = 0; place < places; place++) expect(shown.filter(value => value.includes(shifted(place))), `place ${place} shows its text as typed, moved on by ${shift}`).not.toEqual([]);
    for (const tag of readMarkup(html).tags) {
      for (const [name, value] of tag.attributes) {
        if (value !== undefined && HOSTILE.some(text => decode(value).includes(text))) expect(TEXT_ATTRIBUTES, `${tag.name} ${name}`).toContain(name);
      }
    }
  }
}

const tagNames = (html: string): string[] => [...new Set(readMarkup(html).tags.map(tag => tag.name))].sort();
const attributeNames = (html: string): string[] => [...new Set(readMarkup(html).tags.flatMap(tag => [...tag.attributes.keys()]))].sort();
const classes = (html: string): string[] => [...new Set(readMarkup(html).tags.flatMap(tag => (tag.attributes.get("class") ?? "").split(/\s+/).filter(name => name !== "")))];

const IDS: ShellIds = { results: "map-results-1", hints: "map-hints-1", legend: "map-legend-1", about: "map-about-1", access: "map-access-1" };
const size = (text: Texts, from = 0) => ({ name: text(from), workspace: text(from + 1), modules: 250, lineItems: 5000 });
const words = (text: Texts, from = 0): TraceWords => ({ feeds: text(from), fed: text(from + 1), sentence: "" });
const TRACED: TraceWords = { feeds: "1,200 boxes feed it", fed: "it feeds 1 box", sentence: "Line item Gross selected." };

const link = (text: Texts, at: number, target: Pick<InspectLink, "raw" | "node">): InspectLink => ({ ...target, name: text(at), sub: text(at + 1), caption: text(at + 2), layer: "s3" });
/** An inspection that holds a text in every place that takes one. `used` says how many. */
const inspectionOf = (text: Texts): Inspection => ({
  kind: text(0), layer: "lineitem", name: text(1),
  rows: [[text(2), text(3)], [text(4), text(5)]],
  action: { label: text(6), module: 12, select: 34 },
  formula: text(7),
  lists: [{ key: "depends", title: text(8), open: true, links: [link(text, 9, { raw: 5 }), link(text, 12, { node: "external7" })] }, { key: "used", title: text(15), open: false, links: [link(text, 16, { raw: 6 })] }],
  texts: [{ key: "actions", title: text(19), lines: [text(20), text(21)] }],
  notes: text(22),
});
const INSPECTION_TEXTS = 23;

/** Every piece of markup the map writes, built with one set of texts. */
const everything = (text: Texts): string[] => [
  shellHtml(IDS, text(0)),
  notesHtml(size(text), [text(2), text(3)], 3),
  crumbsHtml({ model: text(0), workspace: text(1), section: { index: 2, name: text(2) }, here: text(3) }),
  crumbsHtml({ model: text(0) }),
  legendHtml(text(0), [{ key: "s0", label: text(1), count: 3 }, { key: "external", label: text(2), count: 1 }], new Set(["external"])),
  tracebarHtml(text(0), words(text, 1), false),
  tooltipHtml({ layer: "s1", kind: text(0), name: text(1), lines: [text(2), "", text(3)], formula: text(4) }),
  resultsHtml({ hits: [{ kind: "module", name: text(0), context: text(1) }, { kind: "section", section: 1, name: text(2), context: text(3) }], total: 80 }),
  inspectorHtml(inspectionOf(text), words(text, INSPECTION_TEXTS)),
  listHtml({ key: "depends", title: text(0), open: true, links: [link(text, 1, { raw: 1 })] }, true),
  sectionOptionsHtml([text(0), text(1)]),
  moduleOptionsHtml([{ id: 4, name: text(0) }, { id: 9, name: text(1) }]),
  emptyHtml(text(0), text(1), [text(2), text(3)]),
  brokenHtml(text(0)),
];

describe("The map's escaping", () => {
  it("escapes the five characters that can end a text or a quoted attribute, and nothing else", () => {
    expect(esc("<a href=\"x\" title='y'>&</a>")).toBe("&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;");
    expect(esc("&lt;")).toBe("&amp;lt;");
    expect([esc("plain text, 100% – ok"), esc(12), esc(0), esc(""), esc(undefined), esc(null)]).toEqual(["plain text, 100% – ok", "12", "0", "", "", ""]);
    for (const text of HOSTILE) {
      expect(esc(text)).not.toMatch(/[<>"']/);
      expect(decode(esc(text))).toBe(text);
    }
  });

  it("shows every text of a model as text, wherever the map writes one, whatever the text is", () => {
    expectInert(text => shellHtml(IDS, text(0)), 1);
    expectInert(text => notesHtml(size(text), [text(2), text(3)], 0), 4);
    expectInert(text => crumbsHtml({ model: text(0), workspace: text(1), section: { index: 2, name: text(2) }, here: text(3) }), 4);
    expectInert(text => crumbsHtml({ model: text(0), here: text(1) }), 2);
    expectInert(text => crumbsHtml({ model: text(0) }), 1);
    expectInert(text => legendHtml(text(0), [{ key: "s0", label: text(1), count: 3 }, { key: "external", label: text(2), count: 1 }], new Set()), 3);
    expectInert(text => tracebarHtml(text(0), words(text, 1), true), 3);
    expectInert(text => tooltipHtml({ layer: "s1", kind: text(0), name: text(1), lines: [text(2), text(3)], formula: text(4) }), 5);
    expectInert(text => resultsHtml({ hits: [{ kind: "module", name: text(0), context: text(1) }, { kind: "lineItem", name: text(2), context: text(3) }], total: 2 }), 4);
    expectInert(text => inspectorHtml(inspectionOf(text), words(text, INSPECTION_TEXTS)), INSPECTION_TEXTS + 2);
    expectInert(text => listHtml({ key: "depends", title: text(0), open: true, links: [link(text, 1, { raw: 1 }), link(text, 4, { node: "section2" })] }, true), 7);
    expectInert(text => sectionOptionsHtml([text(0), text(1), text(2)]), 3);
    expectInert(text => moduleOptionsHtml([{ id: 4, name: text(0) }, { id: 9, name: text(1) }]), 2);
    expectInert(text => emptyHtml(text(0), text(1), [text(2), text(3)]), 4);
    expectInert(text => brokenHtml(text(0)), 1);
  });

  it("makes no element, handler, style or address out of a text", () => {
    const own = everything(harmless);
    everything(hostile).forEach((html, piece) => {
      expect(html).not.toMatch(/<img|<script|<iframe|<b>Q4/);
      const names = tagNames(html);
      for (const name of ["img", "script", "iframe", "a", "style", "link", "object", "embed", "form"]) expect(names, name).not.toContain(name);
      // The same elements as with harmless texts: the bold of the hints and of the counts is the map's own.
      expect(names).toEqual(tagNames(own[piece]));
      expect(attributeNames(html).filter(name => /^on/i.test(name) || name === "style" || name === "href" || name === "src" || name === "srcdoc")).toEqual([]);
    });
  });

  it("shows a name that holds an img tag with an onerror attribute as its text, in the inspector and among the results", () => {
    const img = HOSTILE[0];
    const inspector = parseMarkup(inspectorHtml({ ...inspectionOf(harmless), name: img }));
    expect(inspector.querySelector(".map-insp-name")?.textContent).toBe(img);
    expect(inspector.querySelectorAll("img")).toEqual([]);
    const results = parseMarkup(resultsHtml({ hits: [{ kind: "module", name: img, context: img }], total: 1 }));
    expect(results.querySelectorAll(".map-result").map(result => [result.localName, result.textContent, result.dataset.mapHit])).toEqual([["button", img + img, "0"]]);
  });
});

describe("The map's own markup", () => {
  it("names every element, class and id of its own with the map's prefix", () => {
    for (const html of everything(harmless)) {
      for (const name of classes(html)) expect(name).toMatch(/^map-/);
      for (const tag of readMarkup(html).tags) {
        const id = tag.attributes.get("id");
        if (id !== undefined) expect(id).toMatch(/^map-/);
        for (const attribute of tag.attributes.keys()) if (attribute.startsWith("data-")) expect(attribute).toMatch(/^data-map-/);
      }
    }
  });

  it("carries in its data attributes only numbers and names the view made itself", () => {
    const html = everything(hostile).join("");
    for (const tag of readMarkup(html).tags) {
      for (const [name, value] of tag.attributes) if (name.startsWith("data-map-")) expect(value, name).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it("gives the canvas a role and a name, and the hints as its description", () => {
    const shell = parseMarkup(shellHtml({ ...IDS, hints: "map-hints-7" }, "Demand Plan"));
    const canvas = shell.querySelector(".map-canvas")!;
    expect([canvas.localName, canvas.getAttribute("role"), canvas.getAttribute("tabindex"), canvas.getAttribute("aria-describedby")]).toEqual(["canvas", "img", "0", "map-hints-7"]);
    expect(canvas.getAttribute("aria-label")).toBe("Map of Demand Plan: its sections, modules and line items, and what feeds what. Search and the details panel reach every box.");
    expect(shell.querySelector(".map-hints")?.id).toBe("map-hints-7");
    expect(shell.querySelector(".map-hints")?.textContent.replace(/\s+/g, " ")).toMatch(/Click a box: what feeds it and what it feeds · Double-click: open it .* Esc back · F whole map · \/ search · \+ − zoom Arrows next box · Enter open it/);
    // The small picture and the tooltip say nothing a screen reader does not get elsewhere.
    expect(shell.querySelector(".map-minimap")?.getAttribute("aria-hidden")).toBe("true");
    expect(shell.querySelector(".map-tooltip")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("stands each select with the page's chevron, which a screen reader is not told of, in a wrap that the stylesheet hides with it", () => {
    const shell = parseMarkup(shellHtml(IDS, "Demand Plan"));
    expect(shell.querySelectorAll(".map-select-wrap").map(wrap => [wrap.children.map(child => [child.localName, child.getAttribute("class"), child.getAttribute("aria-hidden")])]))
      .toEqual([[[["select", "map-select map-section-select", null], ["svg", "map-select-chevron", "true"]]],
        [[["select", "map-select map-module-select", null], ["svg", "map-select-chevron", "true"]]]]);
  });

  it("makes every control a real button, list or box with a name", () => {
    const shell = parseMarkup(shellHtml(IDS, "Demand Plan"));
    const controls = shell.querySelectorAll("button, select, input");
    expect(controls.map(control => control.localName).sort()).toEqual([...Array.from({ length: 10 }, () => "button"), "input", "input", "select", "select"]);
    const names: string[] = [];
    for (const control of controls) {
      const label = control.closest("label");
      const name = control.getAttribute("aria-label") ?? (control.textContent.trim() || label?.textContent.trim() || "");
      expect(name, control.outerHTML).not.toBe("");
      names.push(name);
      if (control.localName === "button") expect(control.getAttribute("type")).toBe("button");
    }
    expect(names).toEqual([
      "Modules", "Line items", "Show all modules", "Model section", "Module for line items", "Show line items of other modules", "Access drivers", "Search all sections, modules and line items",
      "Whole map", "Legend", "About this map", "Zoom out", "Zoom in", "Fit",
    ]);
    expect(shell.querySelector(".map-search")?.getAttribute("aria-controls")).toBe("map-results-1");
    expect(shell.querySelector(".map-results")?.id).toBe("map-results-1");
    // Nothing that looks like a control is a div or a span.
    expect(shell.querySelectorAll("[data-map-act]").filter(element => element.localName !== "button")).toEqual([]);
  });

  it("says what Access drivers does where it is switched, on hover and to a screen reader", () => {
    const shell = parseMarkup(shellHtml(IDS, "Demand Plan"));
    const box = shell.querySelector(".map-access")!;
    expect([box.getAttribute("type"), box.getAttribute("aria-describedby")]).toEqual(["checkbox", "map-access-1"]);
    expect(box.closest("label")?.getAttribute("title")).toBe(ACCESS_SAYS);
    expect(shell.querySelector("#map-access-1")?.textContent).toBe(ACCESS_SAYS);
    expect(ACCESS_SAYS).toBe("Also draws a link from each read access driver and write access driver to what it controls.");
  });

  it("names the panels, and has a place that speaks politely", () => {
    const shell = parseMarkup(shellHtml(IDS, "Demand Plan"));
    expect(shell.querySelector(".map-inspector")?.getAttribute("aria-label")).toBe("Details of the box selected");
    // No name a screen reader says, and no word on the map, calls a box a node.
    expect(shell.textContent + shell.querySelectorAll("[aria-label], [title]").map(named => `${named.getAttribute("aria-label") ?? ""} ${named.getAttribute("title") ?? ""}`).join(" ")).not.toMatch(/\bnodes?\b/i);
    expect(shell.querySelector(".map-crumbs")?.localName).toBe("nav");
    expect(shell.querySelector(".map-crumbs")?.getAttribute("aria-label")).toBe("Map breadcrumb");
    expect(shell.querySelector(".map-live")?.getAttribute("aria-live")).toBe("polite");
    expect(shell.querySelectorAll('[role="group"]').map(group => group.getAttribute("aria-label"))).toEqual(["What the map shows", "Map controls", "Search results", "Legend: shows and hides layers", "About this map", "Zoom"]);
  });

  it("keeps the legend and the notes about the map closed until asked for, each behind a button that says whether it is open", () => {
    const shell = parseMarkup(shellHtml(IDS, "Demand Plan"));
    const buttons = shell.querySelectorAll('[data-map-act="legend"], [data-map-act="about"]');
    expect(buttons.map(button => [button.textContent, button.getAttribute("aria-expanded"), button.getAttribute("aria-controls")])).toEqual([["Legend", "false", "map-legend-1"], ["About this map", "false", "map-about-1"]]);
    expect([shell.querySelector(".map-legend")?.id, shell.querySelector(".map-legend")?.hidden]).toEqual(["map-legend-1", true]);
    const about = shell.querySelector(".map-about")!;
    expect([about.id, about.hidden, about.getAttribute("tabindex")]).toEqual(["map-about-1", true, "0"]);
    // What is of this model comes first in the notes, then how any map is read.
    expect(about.children.map(child => child.getAttribute("class"))).toEqual(["map-notes", "map-about-title", "map-about-line", "map-about-line", "map-about-title", "map-hints"]);
    expect(about.querySelectorAll(".map-about-title").map(title => title.textContent)).toEqual(["How to read the map", "Mouse and keys"]);
    expect(about.querySelector(".map-about-line")?.textContent).toContain(LINK_SAYS);
    // What a sign means, and why a box beside a module's line items can carry one with no coloured link to it.
    expect(about.querySelectorAll(".map-about-line").map(line => line.textContent)).toEqual([
      `${LINK_SAYS} Click a box to see everything that feeds it and everything it feeds:  at a box's right edge means it feeds the box selected,  at its left edge means the box selected feeds it.`, BESIDE_SAYS,
    ]);
    expect(LINK_SAYS).toBe("An arrow from A to B: B reads A.");
  });

  it("starts with the panels of a selection hidden, and the first view's controls shown", () => {
    const shell = parseMarkup(shellHtml(IDS, "Demand Plan"));
    for (const selector of [".map-inspector", ".map-tracebar", ".map-results", ".map-module-select", ".map-empty", '[data-map-act="external"]', '[data-map-act="whole"]']) expect(shell.querySelector(selector)?.hidden, selector).toBe(true);
    for (const selector of [".map-section-select", '[data-map-act="group"]', ".map-status", ".map-corner"]) expect(shell.querySelector(selector)?.hidden, selector).toBe(false);
    expect(shell.querySelectorAll(".map-tab").map(tab => [tab.textContent, tab.dataset.mapView, tab.getAttribute("aria-pressed")])).toEqual([["Modules", "modules", "true"], ["Line items", "drill", "false"]]);
    // The line of what is shown and the small picture stand over the graph's own room, with the bar above it.
    expect(shell.querySelector(".map-chrome")?.children.map(child => child.getAttribute("class"))).toEqual(["map-panel map-bar", "map-panel map-inspector", "map-free"]);
    // In the bar the controls and the search are one group, which takes a second line as one where the first is too short.
    expect(shell.querySelector(".map-bar")?.children.map(child => child.getAttribute("class"))).toEqual(["map-tabs", "map-crumbs", "map-tools"]);
    expect(shell.querySelector(".map-tools")?.children.map(child => child.getAttribute("class"))).toEqual(["map-controls", "map-searchwrap"]);
    expect(shell.querySelector(".map-free")?.children.map(child => child.getAttribute("class"))).toEqual(["map-foot", "map-corner", "map-empty"]);
    // The legend and the notes stand over the line at the foot, whatever its height.
    expect(shell.querySelector(".map-foot")?.children.map(child => child.getAttribute("class"))).toEqual(["map-over", "map-dock"]);
    // At the foot: the line of what is shown with the two buttons beside it, and under them the bar of what is traced.
    expect(shell.querySelector(".map-dock")?.children.map(child => child.getAttribute("class"))).toEqual(["map-panel map-status", "map-btn map-dock-btn", "map-btn map-dock-btn", "map-panel map-tracebar"]);
    expect(shell.querySelector(".map-over")?.children.map(child => child.getAttribute("class"))).toEqual(["map-panel map-legend", "map-panel map-about"]);
  });
});

describe("The map's panels", () => {
  it("says in the notes why the page's Modules table has more rows than the map has modules, where the model has heading rows", () => {
    const model = { name: "Demand Plan", modules: 4, lineItems: 10 };
    const lines = (headings?: number): string[] => parseMarkup(`<div>${notesHtml({ ...model, ...(headings === undefined ? {} : { headings }) }, [], 0)}</div>`).querySelectorAll(".map-about-line").map(line => line.textContent);
    // The first line is the model's size, and ends with it, whatever follows.
    expect(lines(3)).toEqual([
      "Demand Plan: 4 modules · 10 line items",
      "3 heading rows stand among the modules. The map counts them as no module, and the page's Modules table counts each as a row: that table has more rows than the map has modules.",
    ]);
    expect(lines(1)[1]).toBe("1 heading row stands among the modules. The map counts it as no module, and the page's Modules table counts it as a row: that table has more rows than the map has modules.");
    // A model without heading rows has nothing to explain.
    expect([lines(0), lines()]).toEqual([["Demand Plan: 4 modules · 10 line items"], ["Demand Plan: 4 modules · 10 line items"]]);
  });

  it("says in the notes how large the model is, and in which workspace where the page names one", () => {
    const notes = parseMarkup(`<div>${notesHtml({ name: "Demand Plan", workspace: "Sandbox", modules: 250, lineItems: 5000 }, [], 0)}</div>`);
    expect(notes.querySelectorAll("h3").map(title => title.textContent)).toEqual(["This model"]);
    expect(notes.querySelector(".map-about-line")?.textContent).toBe("Demand Plan, in the workspace Sandbox: 250 modules · 5,000 line items");
    expect(notes.querySelector("ul")).toBeNull();
    for (const none of [undefined, "", "   "]) {
      expect(parseMarkup(`<div>${notesHtml({ name: "Demand Plan", workspace: none, modules: 1, lineItems: 1 }, [], 0)}</div>`).querySelector(".map-about-line")?.textContent).toBe("Demand Plan: 1 module · 1 line item");
    }
  });

  it("lists what the graph could not hold, one sentence or a dozen, and how many names matched nothing", () => {
    const model = { name: "Demand Plan", modules: 2, lineItems: 3 };
    const one = parseMarkup(`<div>${notesHtml(model, ["List members are not exported."], 0)}</div>`);
    expect(one.querySelectorAll("h3").map(title => title.textContent)).toEqual(["This model", "What this map leaves out · 1"]);
    expect(one.querySelectorAll("li").map(line => line.textContent)).toEqual(["List members are not exported."]);
    const dozen = Array.from({ length: 12 }, (_, index) => `Line Items has no column number ${index + 1}: line items come without it.`);
    const many = parseMarkup(`<div>${notesHtml(model, dozen, 12)}</div>`);
    expect(many.querySelectorAll("h3")[1].textContent).toBe("What this map leaves out · 13");
    expect(many.querySelectorAll("ul")).toHaveLength(1);
    // Every sentence is its own line, in the graph's order, and the count of names comes last.
    expect(many.querySelectorAll("li").map(line => line.textContent)).toEqual([...dozen, "12 names in the export matched no object, or more than one. A box's details list its own."]);
    expect(parseMarkup(`<div>${notesHtml(model, [], 1)}</div>`).querySelectorAll("li").map(line => line.textContent)).toEqual(["1 name in the export matched no object, or more than one. A box's details list its own."]);
  });

  it("says in the middle of a map with nothing to draw what is missing, and lists under it what the map leaves out", () => {
    const sentences = ["Modules was not exported.", "Line Items lists no modules."];
    const empty = parseMarkup(emptyHtml("No modules to draw", "This export holds no modules, so there is nothing to map.", sentences));
    const box = empty.querySelector(".map-empty-box")!;
    expect([box.getAttribute("role"), box.getAttribute("aria-label"), box.getAttribute("tabindex")]).toEqual(["group", "No modules to draw", "0"]);
    expect([empty.querySelector(".map-empty-title")?.localName, empty.querySelector(".map-empty-title")?.textContent]).toEqual(["h3", "No modules to draw"]);
    expect(empty.querySelector(".map-empty-text")?.textContent).toBe("This export holds no modules, so there is nothing to map.");
    expect(empty.querySelector(".map-about-title")?.textContent).toBe("What this map leaves out · 2");
    expect(empty.querySelectorAll("li").map(line => line.textContent)).toEqual(sentences);
    // A view that is only empty here has nothing to list.
    const plain = parseMarkup(emptyHtml("Nothing to show here", "This module has no line items."));
    expect([plain.querySelector(".map-empty-text")?.textContent, plain.querySelector("ul"), plain.querySelector(".map-about-title")]).toEqual(["This module has no line items.", null, null]);
  });

  it("says in a map that stopped after a failure that it could not be drawn, with the failure's own words, at once to a screen reader", () => {
    const broken = parseMarkup(brokenHtml("Failed to execute 'fillText' on <canvas>"));
    const box = broken.querySelector(".map-broken")!;
    expect([box.getAttribute("role"), box.getAttribute("tabindex")]).toEqual(["alert", "-1"]);
    expect([box.querySelector(".map-empty-title")?.localName, box.querySelector(".map-empty-title")?.textContent]).toEqual(["h2", "The map could not be drawn"]);
    expect(box.querySelector(".map-empty-text")?.textContent).toBe("Drawing it failed (Failed to execute 'fillText' on <canvas>), and the map has stopped. The tables of this result are not affected.");
    // A failure that says nothing leaves no empty brackets.
    for (const none of ["", "   "]) expect(parseMarkup(brokenHtml(none)).querySelector(".map-empty-text")?.textContent).toBe("Drawing it failed, and the map has stopped. The tables of this result are not affected.");
  });

  it("says where the map is: the model alone where it is shown whole, and the way back from anywhere else", () => {
    const root = parseMarkup(`<nav>${crumbsHtml({ model: "Demand Plan", workspace: "Sandbox" })}</nav>`);
    expect(root.querySelectorAll("button")).toEqual([]);
    // The model's name is the map's heading. It says its workspace on hover, where a narrow bar has no room to write it.
    const here = root.querySelector("[aria-current]")!;
    expect([here.localName, here.getAttribute("class"), here.textContent, here.getAttribute("aria-current"), here.getAttribute("title")]).toEqual(["h2", "map-title-name map-here", "Demand Plan", "location", "Demand Plan (workspace: Sandbox)"]);
    // The workspace and the mark after it are one piece, so that the mark goes when the workspace does: it is the first
    // thing to go where the bar is short of room.
    const workspace = root.querySelector(".map-crumb-ws")!;
    expect([workspace.getAttribute("title"), workspace.children.map(child => [child.getAttribute("class"), child.textContent]), workspace.querySelector(".map-sep")?.getAttribute("aria-hidden")])
      .toEqual(["Workspace: Sandbox", [["map-crumb-ws-name", "Sandbox"], ["map-sep", "›"]], "true"]);
    expect(root.querySelector("nav")?.children.map(child => child.getAttribute("class"))).toEqual(["map-crumb-ws", "map-title-name map-here"]);

    const section = parseMarkup(`<nav>${crumbsHtml({ model: "Demand Plan", here: "01: Inputs" })}</nav>`);
    expect(section.querySelectorAll("button").map(button => [button.textContent, button.dataset.mapAct, button.dataset.mapCrumb, button.getAttribute("title"), button.closest("h2")?.getAttribute("class")])).toEqual([["Demand Plan", "crumb", "root", "Demand Plan", "map-title-name"]]);
    expect(section.querySelectorAll("[aria-current]").map(each => [each.localName, each.textContent])).toEqual([["span", "01: Inputs"]]);
    expect(section.querySelector(".map-crumb-ws")).toBeNull();
    expect(section.querySelectorAll(".map-sep")).toHaveLength(1);
    for (const none of ["", "   "]) expect(parseMarkup(`<nav>${crumbsHtml({ model: "Demand Plan", workspace: none })}</nav>`).querySelector(".map-crumb-ws")).toBeNull();

    const module = parseMarkup(`<nav>${crumbsHtml({ model: "Demand Plan", workspace: "Sandbox", section: { index: 3, name: "04: Planning" }, here: "PLN01 - Plan" })}</nav>`);
    expect(module.querySelectorAll("button").map(button => [button.textContent, button.dataset.mapCrumb, button.dataset.mapSection])).toEqual([["Demand Plan", "root", undefined], ["04: Planning", "section", "3"]]);
    expect(module.querySelector("[aria-current]")?.textContent).toBe("PLN01 - Plan");
    expect(module.querySelectorAll(".map-sep")).toHaveLength(3);
    // The workspace is the same piece before every view's names: whether it has the room is the view's to measure.
    expect([module.querySelector(".map-crumb-ws")?.getAttribute("class"), section.querySelector(".map-crumb-ws")]).toEqual(["map-crumb-ws", null]);
    // A section is named only on the way to a module.
    expect(parseMarkup(`<nav>${crumbsHtml({ model: "Demand Plan", section: { index: 3, name: "04: Planning" } })}</nav>`).querySelectorAll("button")).toEqual([]);
  });

  it("makes each layer of the legend a button that says whether the layer is shown, and says under them what a line means", () => {
    const legend = parseMarkup(`<div>${legendHtml("On this map", [{ key: "lineitem", label: "Line items", count: 1200 }, { key: "external", label: "Other modules", count: 3 }, { key: "s9", label: "10: Archive", count: 1 }], new Set(["external"]))}</div>`);
    expect(legend.querySelector(".map-legend-title")?.textContent).toBe("On this map");
    expect(legend.querySelectorAll("button").map(item => [item.dataset.mapLayer, item.getAttribute("aria-pressed"), item.classList.contains("map-off"), item.querySelector(".map-legend-name")?.textContent, item.querySelector(".map-legend-count")?.textContent]))
      .toEqual([["lineitem", "true", false, "Line items", "1,200"], ["external", "false", true, "Other modules", "3"], ["s9", "true", false, "10: Archive", "1"]]);
    // A colour is a class of the stylesheet's: the tenth section has the second colour.
    expect(legend.querySelectorAll(".map-dot").map(dot => dot.getAttribute("class"))).toEqual(["map-dot map-c-lineitem", "map-dot map-c-external", "map-dot map-c-s2"]);
    expect([legend.querySelector(".map-legend-note")?.localName, legend.querySelector(".map-legend-note")?.textContent]).toEqual(["p", LINK_SAYS]);
  });

  it("says what is traced as the picture runs: what feeds the node, the node, what it feeds, each side with its sign", () => {
    const bar = parseMarkup(`<div>${tracebarHtml("CAL01 - Revenue", TRACED, false)}</div>`);
    // Its two buttons are one piece: where the bar is too short for one row, they take the second together.
    expect(bar.querySelector("div")?.children.map(child => child.getAttribute("class"))).toEqual(["map-trace-count map-trace-up", "map-trace-name", "map-trace-count map-trace-down", "map-trace-acts"]);
    expect(bar.querySelector(".map-trace-acts")?.children.map(child => child.getAttribute("class"))).toEqual(["map-btn map-small", "map-btn map-small"]);
    expect([bar.querySelector(".map-trace-name")?.textContent, bar.querySelector(".map-trace-name")?.getAttribute("title")]).toEqual(["CAL01 - Revenue", "CAL01 - Revenue"]);
    expect(bar.querySelectorAll(".map-trace-count").map(count => count.textContent)).toEqual(["1,200 boxes feed it", "it feeds 1 box"]);
    // The sign is a picture beside the words, not a word: a screen reader hears the words alone.
    expect(bar.querySelectorAll(".map-sign").map(sign => [sign.localName, sign.getAttribute("aria-hidden"), sign.parentElement?.getAttribute("class")])).toEqual([["svg", "true", "map-trace-count map-trace-up"], ["svg", "true", "map-trace-count map-trace-down"]]);
    // The first button keeps the picture to the boxes the bar has just counted. Its face is short, so that the bar keeps
    // to one row; its name to a screen reader and on hover says it in full, and holds the words on its face.
    const buttons = (focused: boolean): (string | undefined)[][] => parseMarkup(`<div>${tracebarHtml("CAL01 - Revenue", TRACED, focused)}</div>`).querySelectorAll("button")
      .map(button => [button.textContent, button.dataset.mapAct, button.getAttribute("aria-label") ?? undefined, button.getAttribute("title") ?? undefined]);
    expect(buttons(false)).toEqual([["Only these", "focus", "Show only these boxes", "Show only these boxes"], ["Clear", "clear", "Clear the selection", "Clear the selection"]]);
    // While the picture keeps to them, the same button leads back.
    expect(buttons(true)).toEqual([["All boxes", "focus", "Show all boxes", "Show all boxes"], ["Clear", "clear", "Clear the selection", "Clear the selection"]]);
    for (const [face, , name] of [...buttons(false), ...buttons(true)]) expect(name?.toLowerCase()).toContain(face?.toLowerCase());
  });

  it("cuts a long formula short in the tooltip, and leaves out lines that say nothing", () => {
    const long = "A + ".repeat(200);
    const tip = parseMarkup(tooltipHtml({ layer: "lineitem", kind: "line item", name: "Gross", lines: ["", "CAL01 - Revenue", ""], formula: long }));
    expect(tip.querySelector(".map-tip-formula")?.textContent).toBe(`${long.slice(0, TIP_FORMULA)}…`);
    expect(tip.querySelector(".map-tip-meta")?.textContent).toBe("CAL01 - Revenue");
    const bare = parseMarkup(tooltipHtml({ layer: "s0", kind: "INP01", name: "Volumes", lines: ["", ""] }));
    expect([bare.querySelector(".map-tip-meta"), bare.querySelector(".map-tip-formula")]).toEqual([null, null]);
    expect(parseMarkup(tooltipHtml({ layer: "s0", kind: "x", name: "y", lines: [], formula: "A + B" })).querySelector(".map-tip-formula")?.textContent).toBe("A + B");
  });

  it("lists the search's hits by their place, and says when there are more or none", () => {
    const some = parseMarkup(resultsHtml({ hits: [{ kind: "module", name: "INP01 - Volumes", context: "Module · 01: Inputs" }, { kind: "lineItem", name: "Units", context: "INP01 - Volumes" }], total: 2 }));
    expect(some.querySelectorAll("button").map(button => [button.dataset.mapAct, button.dataset.mapHit, button.querySelector("span")?.textContent, button.querySelector("small")?.textContent]))
      .toEqual([["result", "0", "INP01 - Volumes", "Module · 01: Inputs"], ["result", "1", "Units", "INP01 - Volumes"]]);
    expect(some.querySelector(".map-results-note")).toBeNull();
    const more = parseMarkup(resultsHtml({ hits: [{ kind: "module", name: "A", context: "B" }], total: 1234 }));
    expect(more.querySelector(".map-results-note")?.textContent).toBe("First 1 of 1,234 matches. Keep typing to narrow.");
    expect(parseMarkup(resultsHtml({ hits: [], total: 0 })).textContent).toBe("No matching sections, modules or line items.");
  });

  it("offers every section and every module as a choice, known by a number", () => {
    const sections = parseMarkup(`<select>${sectionOptionsHtml(["01: Inputs", "02: Calculations"])}</select>`);
    expect(sections.querySelectorAll("option").map(option => [option.getAttribute("value"), option.textContent])).toEqual([["", "All sections"], ["0", "01: Inputs"], ["1", "02: Calculations"]]);
    const modules = parseMarkup(`<select>${moduleOptionsHtml([{ id: 14, name: "INP01 - Volumes" }, { id: 30, name: "CAL01 - Revenue" }])}</select>`);
    expect(modules.querySelectorAll("option").map(option => [option.getAttribute("value"), option.textContent])).toEqual([["14", "INP01 - Volumes"], ["30", "CAL01 - Revenue"]]);
  });
});

describe("The details' markup", () => {
  const inspection: Inspection = {
    kind: "LINE ITEM", layer: "lineitem", name: "Gross", rows: [["Module", "CAL01 - Revenue"], ["Format", "Number, 2 decimal places"]],
    action: { label: "Open its module with it selected", module: 12, select: 34 }, formula: "Units\n  * Price",
    lists: [
      { key: "depends", title: "Feeds it directly · 2", open: true, links: [{ raw: 5, name: "Units", sub: "INP01 - Volumes", caption: "read access driver", layer: "lineitem" }, { node: "external7", name: "INP02 - Prices", layer: "external" }] },
      { key: "used", title: "It feeds directly · 0", open: false, links: [] },
    ],
    texts: [{ key: "unresolved", title: "Names not matched to one object · 1", lines: ["Referenced By: Retired.Total"] }],
    notes: "Before discounts.",
  };

  it("shows what the node is, its name as a heading that can take the focus, and the button that closes it", () => {
    const panel = parseMarkup(inspectorHtml(inspection));
    expect(panel.querySelector(".map-kind")?.textContent).toBe("LINE ITEM");
    expect(panel.querySelector(".map-kind .map-dot")?.getAttribute("class")).toBe("map-dot map-c-lineitem");
    const name = panel.querySelector(".map-insp-name")!;
    expect([name.localName, name.textContent, name.getAttribute("tabindex")]).toEqual(["h3", "Gross", "-1"]);
    const close = panel.querySelector('[data-map-act="close"]')!;
    expect([close.localName, close.getAttribute("aria-label")]).toEqual(["button", "Close details"]);
  });

  it("shows the formula near the top, under its own heading, and then the details as a list of names and values", () => {
    const html = inspectorHtml(inspection, TRACED);
    const panel = parseMarkup(html);
    expect(panel.querySelectorAll("dt").map(term => term.textContent)).toEqual(["Module", "Format"]);
    expect(panel.querySelectorAll("dd").map(value => value.textContent)).toEqual(["CAL01 - Revenue", "Number, 2 decimal places"]);
    expect([panel.querySelector(".map-formula")?.localName, panel.querySelector(".map-formula")?.textContent]).toEqual(["pre", "Units\n  * Price"]);
    expect(panel.querySelectorAll("h4").map(title => title.textContent)).toEqual(["Formula", "Notes"]);
    expect(panel.querySelectorAll(".map-insp-note").map(note => note.textContent)).toEqual(["Before discounts."]);
    // The notes end the details: nothing names a file or a row after them.
    expect([panel.children[panel.children.length - 1].textContent, html.includes(".csv"), /\brow \d/.test(panel.textContent)]).toEqual(["Before discounts.", false, false]);
    // The order a modeller reads in: the name, what the trace found, the way in, the formula, and only then the rest.
    const order = ["map-insp-name", "map-insp-trace", "map-primary", "map-formula", "map-dl", "map-details", "map-insp-note"].map(name => html.indexOf(`class="${name}"`));
    expect(order.every(at => at >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("says what the trace found in words, each side with its sign, and nothing of a trace it was not given", () => {
    const panel = parseMarkup(inspectorHtml(inspection, TRACED));
    const traced = panel.querySelector(".map-insp-trace")!;
    expect(traced.textContent).toBe("On the map, directly or through others: 1,200 boxes feed it, it feeds 1 box.");
    expect(traced.children.map(child => [child.getAttribute("class"), child.querySelector(".map-sign")?.getAttribute("aria-hidden")])).toEqual([["map-trace-up", "true"], ["map-trace-down", "true"]]);
    expect(parseMarkup(inspectorHtml(inspection)).querySelector(".map-insp-trace")).toBeNull();
  });

  it("says where its main button leads by numbers alone", () => {
    const open = parseMarkup(inspectorHtml(inspection)).querySelector('[data-map-act="open"]')!;
    expect([open.textContent, open.dataset.mapModule, open.dataset.mapSelect, open.dataset.mapSection]).toEqual(["Open its module with it selected →", "12", "34", undefined]);
    const section = parseMarkup(inspectorHtml({ ...inspection, action: { label: "Open its 2 modules", section: 0 } })).querySelector('[data-map-act="open"]')!;
    expect([section.textContent, section.dataset.mapSection, section.dataset.mapModule]).toEqual(["Open its 2 modules →", "0", undefined]);
    expect(parseMarkup(inspectorHtml({ ...inspection, action: undefined })).querySelector('[data-map-act="open"]')).toBeNull();
  });

  it("makes each thing that feeds it a button: to an object of the model, or to a node on screen", () => {
    const panel = parseMarkup(inspectorHtml(inspection));
    const lists = panel.querySelectorAll(".map-details");
    expect(lists.map(list => [list.dataset.mapList, list.hasAttribute("open"), list.querySelector("summary")?.textContent])).toEqual([["depends", true, "Feeds it directly · 2"], ["used", false, "It feeds directly · 0"], [undefined, false, "Names not matched to one object · 1"]]);
    expect(lists[0].querySelectorAll(".map-link").map(each => [each.localName, each.dataset.mapAct, each.dataset.mapRaw, each.dataset.mapNode, each.querySelectorAll("small").map(small => small.textContent)]))
      .toEqual([["button", "raw", "5", undefined, ["INP01 - Volumes", "read access driver"]], ["button", "node", undefined, "external7", []]]);
    expect(lists[2].querySelectorAll("li").map(line => line.textContent)).toEqual(["Referenced By: Retired.Total"]);
  });

  it("says in the formula's place why there is none, and leaves out what an inspection lacks", () => {
    const panel = parseMarkup(inspectorHtml({ kind: "LINE ITEM", layer: "heading", name: "Workings", rows: [], remark: "No formula.", lists: [], texts: [] }));
    expect(panel.querySelector(".map-formula")).toBeNull();
    expect(panel.querySelectorAll(".map-insp-note").map(note => note.textContent)).toEqual(["No formula."]);
    expect([panel.querySelector("dl"), panel.querySelector(".map-details"), panel.querySelector("h4"), panel.querySelector(".map-primary")]).toEqual([null, null, null, null]);
  });

  it("writes the first hundred links of a long list, with a button that lists them all", () => {
    const links = Array.from({ length: LIST_CAP + 40 }, (_, index): InspectLink => ({ raw: index, name: `Line ${index}`, layer: "lineitem" }));
    const list = { key: "items", title: "All its line items · 140", open: false, links };
    const capped = parseMarkup(`<details>${listHtml(list, false)}</details>`);
    expect(capped.querySelectorAll(".map-link")).toHaveLength(LIST_CAP);
    expect(capped.querySelectorAll(".map-more").map(more => [more.localName, more.textContent, more.dataset.mapAct, more.dataset.mapList])).toEqual([["button", "Show all 140", "more", "items"]]);
    const whole = parseMarkup(`<details>${listHtml(list, true)}</details>`);
    expect(whole.querySelectorAll(".map-link")).toHaveLength(LIST_CAP + 40);
    expect(whole.querySelector(".map-more")).toBeNull();
    // A list that fits has no such button.
    expect(parseMarkup(`<details>${listHtml({ ...list, links: links.slice(0, LIST_CAP) }, false)}</details>`).querySelector(".map-more")).toBeNull();
  });
});
