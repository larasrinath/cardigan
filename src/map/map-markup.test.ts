import { describe, expect, it } from "vitest";
import { parseMarkup } from "../results/dom.test-support.js";
import { decode, readMarkup, shownValues, structure } from "../results/markup.test-support.js";
import type { InspectLink, Inspection } from "./map-inspect.js";
import {
  crumbsHtml, emptyHtml, esc, inspectorHtml, legendHtml, LIST_CAP, listHtml, moduleOptionsHtml, notesHtml, resultsHtml, sectionOptionsHtml, shellHtml, statsHtml, TIP_FORMULA, tooltipHtml, tracebarHtml,
} from "./map-markup.js";
import { HOSTILE } from "./map.test-support.js";

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

const link = (text: Texts, at: number, target: Pick<InspectLink, "raw" | "node">): InspectLink => ({ ...target, name: text(at), sub: text(at + 1), caption: text(at + 2), layer: "s3" });
/** An inspection that holds a text in every place that takes one. `used` says how many. */
const inspectionOf = (text: Texts): Inspection => ({
  kind: text(0), layer: "lineitem", name: text(1),
  rows: [[text(2), text(3)], [text(4), text(5)]],
  action: { label: text(6), module: 12, select: 34 },
  formula: text(7),
  lists: [{ key: "depends", title: text(8), open: true, links: [link(text, 9, { raw: 5 }), link(text, 12, { node: "external7" })] }, { key: "used", title: text(15), open: false, links: [link(text, 16, { raw: 6 })] }],
  texts: [{ key: "actions", title: text(19), lines: [text(20), text(21)] }],
  notes: text(22), source: text(23),
});
const INSPECTION_TEXTS = 24;

/** Every piece of markup the map writes, built with one set of texts. */
const everything = (text: Texts): string[] => [
  shellHtml({ results: "map-results-1", hints: "map-hints-1" }, text(0), text(1)),
  statsHtml(3, 40, [[2, "sections"], [5, "links"]]),
  notesHtml([text(0), text(1)], 3),
  crumbsHtml({ model: text(0), workspace: text(1), section: { index: 2, name: text(2) }, here: text(3) }),
  crumbsHtml({ model: text(0) }),
  legendHtml(text(0), [{ key: "s0", label: text(1), count: 3 }, { key: "external", label: text(2), count: 1 }], new Set(["external"])),
  tracebarHtml(text(0), 3, 1200),
  tooltipHtml({ layer: "s1", kind: text(0), name: text(1), lines: [text(2), "", text(3)], formula: text(4) }),
  resultsHtml({ hits: [{ kind: "module", name: text(0), context: text(1) }, { kind: "section", section: 1, name: text(2), context: text(3) }], total: 80 }),
  inspectorHtml(inspectionOf(text)),
  listHtml({ key: "depends", title: text(0), open: true, links: [link(text, 1, { raw: 1 })] }, true),
  sectionOptionsHtml([text(0), text(1)]),
  moduleOptionsHtml([{ id: 4, name: text(0) }, { id: 9, name: text(1) }]),
  emptyHtml(text(0), text(1)),
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
    expectInert(text => shellHtml({ results: "map-results-1", hints: "map-hints-1" }, text(0), text(1)), 2);
    expectInert(text => notesHtml([text(0), text(1)], 0), 2);
    expectInert(text => crumbsHtml({ model: text(0), workspace: text(1), section: { index: 2, name: text(2) }, here: text(3) }), 4);
    expectInert(text => crumbsHtml({ model: text(0), here: text(1) }), 2);
    expectInert(text => crumbsHtml({ model: text(0) }), 1);
    expectInert(text => legendHtml(text(0), [{ key: "s0", label: text(1), count: 3 }, { key: "external", label: text(2), count: 1 }], new Set()), 3);
    expectInert(text => tracebarHtml(text(0), 3, 4), 1);
    expectInert(text => tooltipHtml({ layer: "s1", kind: text(0), name: text(1), lines: [text(2), text(3)], formula: text(4) }), 5);
    expectInert(text => resultsHtml({ hits: [{ kind: "module", name: text(0), context: text(1) }, { kind: "lineItem", name: text(2), context: text(3) }], total: 2 }), 4);
    expectInert(text => inspectorHtml(inspectionOf(text)), INSPECTION_TEXTS);
    expectInert(text => listHtml({ key: "depends", title: text(0), open: true, links: [link(text, 1, { raw: 1 }), link(text, 4, { node: "section2" })] }, true), 7);
    expectInert(text => sectionOptionsHtml([text(0), text(1), text(2)]), 3);
    expectInert(text => moduleOptionsHtml([{ id: 4, name: text(0) }, { id: 9, name: text(1) }]), 2);
    expectInert(text => emptyHtml(text(0), text(1)), 2);
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
    const shell = parseMarkup(shellHtml({ results: "map-results-7", hints: "map-hints-7" }, "Demand Plan", "Sandbox"));
    const canvas = shell.querySelector(".map-canvas")!;
    expect([canvas.localName, canvas.getAttribute("role"), canvas.getAttribute("tabindex"), canvas.getAttribute("aria-describedby")]).toEqual(["canvas", "img", "0", "map-hints-7"]);
    expect(canvas.getAttribute("aria-label")).toMatch(/^Map of Demand Plan: /);
    expect(shell.querySelector(".map-hints")?.id).toBe("map-hints-7");
    expect(shell.querySelector(".map-hints")?.textContent).toMatch(/Esc back · F fit · \/ search/);
    // The small picture and the tooltip say nothing a screen reader does not get elsewhere.
    expect(shell.querySelector(".map-minimap")?.getAttribute("aria-hidden")).toBe("true");
    expect(shell.querySelector(".map-tooltip")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("makes every control a real button, list or box with a name", () => {
    const shell = parseMarkup(shellHtml({ results: "map-results-1", hints: "map-hints-1" }, "Demand Plan", undefined));
    const controls = shell.querySelectorAll("button, select, input");
    expect(controls.map(control => control.localName).sort()).toEqual(["button", "button", "button", "button", "button", "button", "button", "button", "input", "input", "select", "select"]);
    for (const control of controls) {
      const label = control.closest("label");
      const name = control.getAttribute("aria-label") ?? (control.textContent.trim() || label?.textContent.trim() || "");
      expect(name, control.outerHTML).not.toBe("");
      if (control.localName === "button") expect(control.getAttribute("type")).toBe("button");
    }
    expect(shell.querySelector(".map-search")?.getAttribute("aria-label")).toBe("Search all sections, modules and line items");
    expect(shell.querySelector(".map-search")?.getAttribute("aria-controls")).toBe("map-results-1");
    expect(shell.querySelector(".map-results")?.id).toBe("map-results-1");
    expect([shell.querySelector(".map-section-select")?.getAttribute("aria-label"), shell.querySelector(".map-module-select")?.getAttribute("aria-label")]).toEqual(["Model section", "Module for line items"]);
    expect(shell.querySelectorAll('[data-map-act="zoom-in"], [data-map-act="zoom-out"]').map(button => button.getAttribute("aria-label"))).toEqual(["Zoom out", "Zoom in"]);
    // Nothing that looks like a control is a div or a span.
    expect(shell.querySelectorAll("[data-map-act]").filter(element => element.localName !== "button")).toEqual([]);
  });

  it("names the panels, and has a place that speaks politely", () => {
    const shell = parseMarkup(shellHtml({ results: "map-results-1", hints: "map-hints-1" }, "Demand Plan", undefined));
    expect(shell.querySelector(".map-inspector")?.getAttribute("aria-label")).toBe("Selected node details");
    expect(shell.querySelector(".map-crumbs")?.localName).toBe("nav");
    expect(shell.querySelector(".map-crumbs")?.getAttribute("aria-label")).toBe("Map breadcrumb");
    expect(shell.querySelector(".map-live")?.getAttribute("aria-live")).toBe("polite");
    expect(shell.querySelectorAll('[role="group"]').map(group => group.getAttribute("aria-label"))).toEqual(["What the map shows", "Map controls", "Search results", "Legend: shows and hides layers"]);
  });

  it("shows the model's name as the map's heading, with the workspace's under it where there is one", () => {
    const withWorkspace = parseMarkup(shellHtml({ results: "r", hints: "h" }, "Demand Plan", "Sandbox"));
    expect([withWorkspace.querySelector(".map-title-name")?.localName, withWorkspace.querySelector(".map-title-name")?.textContent, withWorkspace.querySelector(".map-title-sub")?.textContent]).toEqual(["h2", "Demand Plan", "Workspace: Sandbox"]);
    for (const none of [undefined, "", "   "]) expect(parseMarkup(shellHtml({ results: "r", hints: "h" }, "Demand Plan", none)).querySelector(".map-title-sub")?.textContent).toBe("Model map");
  });

  it("starts with the panels of a selection hidden", () => {
    const shell = parseMarkup(shellHtml({ results: "r", hints: "h" }, "Demand Plan", undefined));
    for (const selector of [".map-inspector", ".map-tracebar", ".map-results", ".map-module-select", ".map-notes", ".map-empty"]) expect(shell.querySelector(selector)?.hidden, selector).toBe(true);
    expect(shell.querySelector('[data-map-act="focus"]')?.disabled).toBe(true);
    expect(shell.querySelectorAll(".map-tab").map(tab => [tab.textContent, tab.dataset.mapView, tab.getAttribute("aria-pressed")])).toEqual([["Modules", "modules", "true"], ["Line items", "drill", "false"]]);
  });
});

describe("The map's panels", () => {
  it("says how large the model is and what is on screen, each on a line", () => {
    const stats = parseMarkup(statsHtml(250, 5000, [[8, "sections"], [1, "link"]]));
    expect(stats.querySelectorAll("div").map(line => line.textContent)).toEqual(["250 modules · 5,000 line items", "8 sections · 1 link"]);
    expect(parseMarkup(statsHtml(1, 1, [[1, "local"]])).querySelectorAll("div")[0].textContent).toBe("1 module · 1 line item");
  });

  it("lists what the graph could not hold, and how many names matched nothing", () => {
    const notes = parseMarkup(`<details>${notesHtml(["List members are not exported."], 12)}</details>`);
    expect(notes.querySelector("summary")?.textContent).toBe("What this map leaves out · 2");
    expect(notes.querySelectorAll("li").map(line => line.textContent)).toEqual(["List members are not exported.", "12 names in the export matched no object. A node's details list its own."]);
    expect(parseMarkup(`<details>${notesHtml([], 1)}</details>`).querySelectorAll("li").map(line => line.textContent)).toEqual(["1 name in the export matched no object. A node's details list its own."]);
    expect(notesHtml([], 0)).toBe("");
  });

  it("says where the map is: the model alone at its sections, and the way back from anywhere else", () => {
    const root = parseMarkup(crumbsHtml({ model: "Demand Plan", workspace: "Sandbox" }));
    expect(root.querySelectorAll("button")).toEqual([]);
    expect(root.querySelectorAll("[aria-current]").map(here => [here.textContent, here.getAttribute("aria-current")])).toEqual([["Demand Plan", "location"]]);
    expect(root.querySelector(".map-crumb-ws")?.textContent).toBe("Sandbox");
    const section = parseMarkup(crumbsHtml({ model: "Demand Plan", here: "01: Inputs" }));
    expect(section.querySelectorAll("button").map(button => [button.textContent, button.dataset.mapAct, button.dataset.mapCrumb])).toEqual([["Demand Plan", "crumb", "root"]]);
    expect(section.querySelector("[aria-current]")?.textContent).toBe("01: Inputs");
    expect(section.querySelector(".map-crumb-ws")).toBeNull();
    const module = parseMarkup(crumbsHtml({ model: "Demand Plan", workspace: "Sandbox", section: { index: 3, name: "04: Planning" }, here: "PLN01 - Plan" }));
    expect(module.querySelectorAll("button").map(button => [button.textContent, button.dataset.mapCrumb, button.dataset.mapSection])).toEqual([["Demand Plan", "root", undefined], ["04: Planning", "section", "3"]]);
    expect(module.querySelector("[aria-current]")?.textContent).toBe("PLN01 - Plan");
    expect(module.querySelectorAll(".map-sep")).toHaveLength(3);
  });

  it("makes each layer of the legend a button that says whether the layer is shown", () => {
    const legend = parseMarkup(legendHtml("Node types", [{ key: "lineitem", label: "Line item", count: 1200 }, { key: "external", label: "External module", count: 3 }, { key: "s9", label: "10: Archive", count: 1 }], new Set(["external"])));
    expect(legend.querySelector(".map-legend-title")?.textContent).toBe("Node types");
    expect(legend.querySelectorAll("button").map(item => [item.dataset.mapLayer, item.getAttribute("aria-pressed"), item.classList.contains("map-off"), item.querySelector(".map-legend-name")?.textContent, item.querySelector(".map-legend-count")?.textContent]))
      .toEqual([["lineitem", "true", false, "Line item", "1,200"], ["external", "false", true, "External module", "3"], ["s9", "true", false, "10: Archive", "1"]]);
    // A colour is a class of the stylesheet's: the tenth section has the second colour.
    expect(legend.querySelectorAll(".map-dot").map(dot => dot.getAttribute("class"))).toEqual(["map-dot map-c-lineitem", "map-dot map-c-external", "map-dot map-c-s2"]);
  });

  it("says what is traced, with the words a narrow map hides in an element of their own", () => {
    const bar = parseMarkup(tracebarHtml("CAL01 - Revenue", 1200, 1));
    expect([bar.querySelector(".map-trace-name")?.textContent, bar.querySelector(".map-trace-name")?.title]).toEqual(["CAL01 - Revenue", "CAL01 - Revenue"]);
    expect(bar.querySelectorAll(".map-trace-count").map(count => count.textContent)).toEqual(["↑ 1,200 upstream", "↓ 1 downstream"]);
    expect(bar.querySelectorAll(".map-trace-word").map(word => word.textContent)).toEqual([" upstream", " downstream"]);
    expect(bar.querySelectorAll("button").map(button => [button.textContent, button.dataset.mapAct])).toEqual([["Clear", "clear"]]);
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

describe("The inspector's markup", () => {
  const inspection: Inspection = {
    kind: "LINE ITEM", layer: "lineitem", name: "Gross", rows: [["module", "CAL01 - Revenue"], ["format", "NUMBER"]],
    action: { label: "Open containing module", module: 12, select: 34 }, formula: "Units\n  * Price",
    lists: [
      { key: "depends", title: "Depends on · 2", open: true, links: [{ raw: 5, name: "Units", sub: "INP01 - Volumes", caption: "read access", layer: "lineitem" }, { node: "external7", name: "INP02 - Prices", layer: "external" }] },
      { key: "used", title: "Used by · 0", open: false, links: [] },
    ],
    texts: [{ key: "unresolved", title: "Names not found · 1", lines: ["Referenced By: Retired.Total"] }],
    notes: "Before discounts.", source: "Line Items · row 42",
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

  it("shows the details as a list of names and values, and the formula as it was exported", () => {
    const panel = parseMarkup(inspectorHtml(inspection));
    expect(panel.querySelectorAll("dt").map(term => term.textContent)).toEqual(["module", "format"]);
    expect(panel.querySelectorAll("dd").map(value => value.textContent)).toEqual(["CAL01 - Revenue", "NUMBER"]);
    expect([panel.querySelector(".map-formula")?.localName, panel.querySelector(".map-formula")?.textContent]).toEqual(["pre", "Units\n  * Price"]);
    expect(panel.querySelector(".map-source")?.textContent).toBe("Line Items · row 42");
    expect(panel.querySelectorAll(".map-insp-note").map(note => note.textContent)).toEqual(["Before discounts."]);
    expect(panel.querySelector(".map-tracekey")?.textContent).toContain("Trace counts apply to the graph on screen.");
  });

  it("says where its main button leads by numbers alone", () => {
    const open = parseMarkup(inspectorHtml(inspection)).querySelector('[data-map-act="open"]')!;
    expect([open.textContent, open.dataset.mapModule, open.dataset.mapSelect, open.dataset.mapSection]).toEqual(["Open containing module →", "12", "34", undefined]);
    const section = parseMarkup(inspectorHtml({ ...inspection, action: { label: "Open modules", section: 0 } })).querySelector('[data-map-act="open"]')!;
    expect([section.dataset.mapSection, section.dataset.mapModule]).toEqual(["0", undefined]);
    expect(parseMarkup(inspectorHtml({ ...inspection, action: undefined })).querySelector('[data-map-act="open"]')).toBeNull();
  });

  it("makes each thing it depends on a button: to an object of the model, or to a node on screen", () => {
    const panel = parseMarkup(inspectorHtml(inspection));
    const lists = panel.querySelectorAll(".map-details");
    expect(lists.map(list => [list.dataset.mapList, list.hasAttribute("open"), list.querySelector("summary")?.textContent])).toEqual([["depends", true, "Depends on · 2"], ["used", false, "Used by · 0"], [undefined, false, "Names not found · 1"]]);
    expect(lists[0].querySelectorAll(".map-link").map(each => [each.localName, each.dataset.mapAct, each.dataset.mapRaw, each.dataset.mapNode, each.querySelectorAll("small").map(small => small.textContent)]))
      .toEqual([["button", "raw", "5", undefined, ["INP01 - Volumes", "read access"]], ["button", "node", undefined, "external7", []]]);
    expect(lists[2].querySelectorAll("li").map(line => line.textContent)).toEqual(["Referenced By: Retired.Total"]);
  });

  it("says in the formula's place why there is none, and leaves out what an inspection lacks", () => {
    const panel = parseMarkup(inspectorHtml({ kind: "LINE ITEM", layer: "heading", name: "Workings", rows: [], remark: "Exported heading; no formula.", lists: [], texts: [] }));
    expect(panel.querySelector(".map-formula")).toBeNull();
    expect(panel.querySelectorAll(".map-insp-note").map(note => note.textContent)).toEqual(["Exported heading; no formula."]);
    expect([panel.querySelector("dl"), panel.querySelector(".map-source"), panel.querySelector(".map-details")]).toEqual([null, null, null]);
  });

  it("writes the first hundred links of a long list, with a button that lists them all", () => {
    const links = Array.from({ length: LIST_CAP + 40 }, (_, index): InspectLink => ({ raw: index, name: `Line ${index}`, layer: "lineitem" }));
    const list = { key: "items", title: "All line items · 140", open: false, links };
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
