import { describe, expect, it } from "vitest";
import { APP_FILES } from "./columns.js";
import { parseMarkup, type FakeElement } from "./dom.test-support.js";
import { FILE_ICONS, NAV_GROUPS, NAV_ICONS, navHtml, navItems, navMenuHtml, type NavEntry } from "./markup.js";

const DIMENSIONS = ["Model Calendar", "Time Ranges", "Versions", "General Lists", "Line Item Subsets"];
const USAGE = ["Module Usage", "Page Filters", "Page Actions"];
const MODULES = ["Modules", "Line Items", "Dynamic Cell Access"];
const ACTIONS = ["Processes", "Imports", "Import Data Sources", "Exports", "Other Actions"];
const entries = (names: readonly string[]): NavEntry[] => names.map(label => ({ id: label, label, file: `${label}.csv` }));
const full = [{ id: "overview", label: "Overview" }, ...entries([...DIMENSIONS, ...MODULES, ...ACTIONS, "Source Models", ...USAGE]), { id: "map", label: "Model map" }];
const words = (node: FakeElement) => node.querySelector("span")?.textContent;
const tree = (node: FakeElement): unknown[] => node.children.filter(child => !child.classList.contains("nav-heading")).map(child =>
  child.classList.contains("nav-section") ? [child.getAttribute("aria-label"), tree(child)] : words(child));

describe("The model's shorter menu bar", () => {
  it("keeps the approved order, each table once, with Versions in Dimensions and Page Actions in App Usage", () => {
    const items = navItems(full, true);
    expect(items.map(item => "entries" in item ? [item.group.label, item.entries.map(entry => entry.label)] : item.label)).toEqual([
      "Overview", ["Dimensions", DIMENSIONS], ["Modules", MODULES], ["Actions", ACTIONS], "Source Models", ["App Usage", USAGE], "Model map",
    ]);
    expect(parseMarkup(navHtml(items, "overview")).querySelectorAll(".nav-item").map(words)).toEqual(full.map(entry => entry.label));
    expect(NAV_GROUPS.find(group => group.label === "Dimensions")?.subgroups).toEqual([
      { label: "Time", files: ["Model Calendar.csv", "Time Ranges.csv"] }, { label: "Versions", files: ["Versions.csv"] },
      { label: "Lists", files: ["General Lists.csv", "Line Item Subsets.csv"] },
    ]);
  });

  it("uses the same nested tree in the wide and compact menus, with named groups and headings that cannot take focus", () => {
    const items = navItems(full, true);
    const wide = parseMarkup(navHtml(items, "overview"));
    const compact = parseMarkup(navMenuHtml(items, "overview", "Overview"));
    const dimensions = [["Time", DIMENSIONS.slice(0, 2)], ["Versions", ["Versions"]], ["Lists", DIMENSIONS.slice(3)]];
    expect(tree(wide.querySelector("#navGroupDimensions")!)).toEqual(dimensions);
    expect(tree(compact.querySelector("#navMenu")!)).toEqual([
      "Overview", ["Dimensions", dimensions], ["Modules", MODULES], ["Actions", ACTIONS], "Source Models", ["App Usage", USAGE], "Model map",
    ]);
    // Every Dimensions table sits at the same section depth, which sets its indent in results.css.
    for (const menu of [wide.querySelector("#navGroupDimensions")!, compact.querySelector('[aria-label="Dimensions"]')!]) {
      expect(menu.querySelectorAll(".nav-item").map(entry => entry.parentElement?.parentElement === menu)).toEqual(DIMENSIONS.map(() => true));
    }
    for (const root of [wide, compact]) {
      for (const section of root.querySelectorAll(".nav-section")) {
        const heading = section.children[0];
        expect(section.getAttribute("role")).toBe("group");
        expect(section.getAttribute("aria-label")).toBe(heading.textContent);
        expect([heading.localName, heading.getAttribute("aria-hidden"), heading.hasAttribute("tabindex"), heading.hasAttribute("data-nav")])
          .toEqual(["p", "true", false, false]);
      }
    }
  });

  it.each([
    [DIMENSIONS, ["Time", "Versions", "Lists"]],
    [["Model Calendar", "Time Ranges", "General Lists"], ["Time", "Lists"]],
    [["Model Calendar", "Versions", "General Lists", "Line Item Subsets"], ["Time", "Versions", "Lists"]],
    [["Time Ranges", "Versions", "General Lists"], ["Time", "Versions", "Lists"]],
    [["Versions", "General Lists"], ["Versions", "Lists"]],
    [["General Lists", "Line Item Subsets"], []],
    [["Model Calendar", "Time Ranges"], []],
    [["General Lists"], []],
  ])("heads every subgroup only when two or more subgroups are present: %j", (names, headings) => {
    const items = navItems(entries(names), true);
    for (const html of [navHtml(items, ""), navMenuHtml(items, "", "Overview")]) {
      const root = parseMarkup(html);
      expect(root.querySelectorAll(".nav-heading").map(heading => heading.textContent).filter(label => label !== "Dimensions")).toEqual(headings);
      expect(root.querySelectorAll(".nav-item").map(words)).toEqual(names);
    }
  });

  it.each([
    [["File Imports"]],
    [["Model-to-Model Imports"]],
    [["File Imports", "In-Model Imports"]],
    [["Model-to-Model Imports", "In-Model Imports"]],
    [["File Imports", "Model-to-Model Imports", "In-Model Imports"]],
  ])("lists the tables of imports in Actions in the Imports file's place, with no heading, at the indent of its other tables: %j", present => {
    const names = ["Processes", ...present, "Import Data Sources", "Exports", "Other Actions"];
    const items = navItems(entries(names), true);
    const wide = parseMarkup(navHtml(items, ""));
    const compact = parseMarkup(navMenuHtml(items, "", "Overview"));
    for (const actions of [wide.querySelector("#navGroupActions")!, compact.querySelector('[aria-label="Actions"]')!]) {
      // No heading but the narrow window's one menu's for the group itself, and every table one step under the menu.
      expect(actions.querySelectorAll(".nav-heading").map(heading => heading.textContent).filter(label => label !== "Actions")).toEqual([]);
      expect(tree(actions)).toEqual(names);
      expect(actions.querySelectorAll(".nav-item").map(entry => [words(entry), entry.parentElement === actions])).toEqual(names.map(name => [name, true]));
    }
  });

  it("gives the tables of imports no heading where they are Actions' only tables, and makes one of them alone the bar's own entry", () => {
    const items = navItems(entries(["File Imports", "Model-to-Model Imports"]), true);
    for (const html of [navHtml(items, ""), navMenuHtml(items, "", "Overview")]) {
      expect(parseMarkup(html).querySelectorAll(".nav-heading").map(heading => heading.textContent).filter(label => label !== "Actions")).toEqual([]);
    }
    const one = entries(["In-Model Imports"]);
    expect(navItems(one, true)).toEqual(one);
  });

  it("draws each table of imports with an icon of its own, in the menu bar's style, and the Actions button names the one shown", () => {
    const tables = entries(["Processes", "File Imports", "Model-to-Model Imports", "In-Model Imports", "Import Data Sources"]);
    const items = navItems(tables, true);
    const icons = ["File Imports", "Model-to-Model Imports", "In-Model Imports"].map(label => FILE_ICONS.get(`${label}.csv`));
    expect(new Set([...icons, FILE_ICONS.get("Imports.csv")]).size).toBe(4);
    for (const icon of icons) {
      expect(icon).toContain('viewBox="0 0 16 16"');
      expect(icon).toContain('stroke-width="1.5"');
      expect(icon).toContain('stroke-linecap="round"');
    }
    const button = parseMarkup(navHtml(items, "Model-to-Model Imports")).querySelector(".nav-group-btn")!;
    expect([words(button), button.dataset.labels?.split("\n"), button.querySelector("svg")?.outerHTML])
      .toEqual(["Model-to-Model Imports", ["Actions", ...tables.map(table => table.label)], parseMarkup(icons[1]!).innerHTML]);
  });

  it.each([...DIMENSIONS, ...USAGE])("makes %s a standalone entry when it is the group's only table", label => {
    const tables = entries([label]);
    const items = navItems(tables, true);
    expect(items).toEqual(tables);
    expect(parseMarkup(navHtml(items, label)).querySelectorAll(".nav-group")).toHaveLength(0);
    expect(parseMarkup(navMenuHtml(items, label, label)).querySelectorAll(".nav-heading")).toHaveLength(0);
  });

  it("omits groups without tables and leaves app navigation in its original order without headings", () => {
    expect(navItems([], true)).toEqual([]);
    const app = [{ id: "overview", label: "Overview" }, ...Object.entries(APP_FILES).map(([label, file]) => ({ id: file, label, file }))];
    for (const source of [app, full]) {
      expect(navItems(source, false)).toEqual(source);
      expect(parseMarkup(navHtml(navItems(source, false), "overview")).querySelectorAll(".nav-group")).toHaveLength(0);
      expect(parseMarkup(navMenuHtml(navItems(source, false), "overview", "Overview")).querySelectorAll(".nav-heading")).toHaveLength(0);
    }
  });

  it.each(["Dimensions", "App Usage"])("keeps all labels for %s's width, with its own icon until a table is shown", label => {
    const group = NAV_GROUPS.find(group => group.label === label)!;
    const tables = entries(label === "Dimensions" ? DIMENSIONS : USAGE);
    const items = navItems(tables, true);
    for (const shown of [undefined, ...tables]) {
      const button = parseMarkup(navHtml(items, shown?.id ?? "overview")).querySelector(".nav-group-btn")!;
      expect(words(button)).toBe(shown?.label ?? label);
      expect(button.dataset.labels?.split("\n")).toEqual([label, ...tables.map(table => table.label)]);
      expect(button.querySelector("svg")?.outerHTML).toBe(parseMarkup(shown ? FILE_ICONS.get(shown.file!)! : group.icon).innerHTML);
      expect(button.querySelectorAll(".nav-chevron")).toHaveLength(1);
    }
    expect([...Object.values(NAV_ICONS), ...FILE_ICONS.values()].filter(icon => icon === group.icon)).toHaveLength(1);
    expect(group.icon).toContain('viewBox="0 0 16 16"');
    expect(group.icon).toContain('stroke-width="1.5"');
    expect(group.icon).toContain('stroke-linecap="round"');
  });
});
