import { describe, expect, it } from "vitest";
import { APP_FILES } from "./columns.js";
import { parseMarkup, type FakeElement } from "./dom.test-support.js";
import { FILE_ICONS, NAV_GROUPS, NAV_ICONS, navHtml, navItems, navMenuHtml, type NavEntry } from "./markup.js";

const DIMENSIONS = ["Model Calendar", "Time Ranges", "Versions", "General Lists", "Line Item Subsets"];
/** App Usage: Module Usage; the filters of the saved views the pages show and a page card's custom view filters (the Page
 * Filters file), under Page Filters; and Page Actions. */
const USAGE = ["Module Usage", "Saved View Filters", "Page Filters", "Page Actions"];
/** Modules: every saved view right after Line Items. */
const MODULES = ["Modules", "Line Items", "Saved Views", "Dynamic Cell Access"];
/** Actions as Polaris shows it, its Imports file unsplit. */
const ACTIONS = ["Processes", "Imports", "Import Data Sources", "Exports", "Other Actions"];
/** The three tables the page shows a split Imports file as, in its order. */
const IMPORT_TABLES_SHOWN = ["File Imports", "Model-to-Model Imports", "In-Model Imports"];
/** Actions with its Imports file split: every table it shows then, in its order. */
const SPLIT_ACTIONS = ["Processes", ...IMPORT_TABLES_SHOWN, "Import Data Sources", "Exports", "Other Actions"];
const entries = (names: readonly string[]): NavEntry[] => names.map(label => ({ id: label, label, file: `${label}.csv` }));
const full = [{ id: "overview", label: "Overview" }, ...entries([...DIMENSIONS, ...MODULES, ...ACTIONS, "Source Models", ...USAGE]), { id: "map", label: "Model map" }];
const words = (node: FakeElement) => node.querySelector("span")?.textContent;
const tree = (node: FakeElement): unknown[] => node.children.filter(child => !child.classList.contains("nav-heading")).map(child =>
  child.classList.contains("nav-section") ? [child.getAttribute("aria-label"), tree(child)] : words(child));

describe("The model's shorter menu bar", () => {
  it("keeps the approved order, each table once, with Versions in Dimensions, Page Actions in App Usage, and each group's sub-groups in its own order", () => {
    const items = navItems(full, true);
    expect(items.map(item => "entries" in item ? [item.group.label, item.entries.map(entry => entry.label)] : item.label)).toEqual([
      "Overview", ["Dimensions", DIMENSIONS], ["Modules", MODULES], ["Actions", ACTIONS], "Source Models", ["App Usage", USAGE], "Model map",
    ]);
    expect(parseMarkup(navHtml(items, "overview")).querySelectorAll(".nav-item").map(words)).toEqual(full.map(entry => entry.label));
    expect(NAV_GROUPS.find(group => group.label === "Dimensions")?.subgroups).toEqual([
      { label: "Time", files: ["Model Calendar.csv", "Time Ranges.csv"] }, { label: "Versions", files: ["Versions.csv"] },
      { label: "Lists", files: ["General Lists.csv", "Line Item Subsets.csv"] },
    ]);
    // Imports holds the Imports file itself, which Polaris shows unsplit, the three tables it is split into, and Data Sources.
    expect(NAV_GROUPS.find(group => group.label === "Actions")?.subgroups).toEqual([
      { label: "Processes", files: ["Processes.csv"] },
      { label: "Imports", files: ["Imports.csv", "File Imports.csv", "Model-to-Model Imports.csv", "In-Model Imports.csv", "Import Data Sources.csv"] },
      { label: "Exports", files: ["Exports.csv"] }, { label: "Other Actions", files: ["Other Actions.csv"] },
    ]);
    // App Usage heads its tables by section: the two kinds of filter together under Page Filters.
    expect(NAV_GROUPS.find(group => group.label === "App Usage")?.subgroups).toEqual([
      { label: "Module Usage", files: ["Module Usage.csv"] }, { label: "Page Filters", files: ["Saved View Filters.csv", "Page Filters.csv"] },
      { label: "Page Actions", files: ["Page Actions.csv"] },
    ]);
    // A group's sub-groups hold its files in the group's own order, each once: a heading moves no table.
    const headed = NAV_GROUPS.filter(group => group.subgroups);
    expect(headed.map(group => group.label)).toEqual(["Dimensions", "Actions", "App Usage"]);
    for (const group of headed) expect(group.subgroups?.flatMap(subgroup => subgroup.files)).toEqual(group.files);
  });

  it("uses the same nested tree in the wide and compact menus, with named groups and headings that cannot take focus", () => {
    const items = navItems(full, true);
    const wide = parseMarkup(navHtml(items, "overview"));
    const compact = parseMarkup(navMenuHtml(items, "overview", "Overview"));
    const dimensions = [["Time", DIMENSIONS.slice(0, 2)], ["Versions", ["Versions"]], ["Lists", DIMENSIONS.slice(3)]];
    // The Imports file that Polaris shows unsplit stands under Imports, with Data Sources.
    const actions = [["Processes", ["Processes"]], ["Imports", ["Imports", "Import Data Sources"]], ["Exports", ["Exports"]], ["Other Actions", ["Other Actions"]]];
    const usage = [["Module Usage", ["Module Usage"]], ["Page Filters", ["Saved View Filters", "Page Filters"]], ["Page Actions", ["Page Actions"]]];
    expect(tree(wide.querySelector("#navGroupDimensions")!)).toEqual(dimensions);
    expect(tree(wide.querySelector("#navGroupActions")!)).toEqual(actions);
    expect(tree(wide.querySelector("#navGroupAppUsage")!)).toEqual(usage);
    expect(tree(compact.querySelector("#navMenu")!)).toEqual([
      "Overview", ["Dimensions", dimensions], ["Modules", MODULES], ["Actions", actions], "Source Models", ["App Usage", usage], "Model map",
    ]);
    // Every Dimensions table, every Actions table and every App Usage table sits at the same section depth, which sets its
    // indent in results.css.
    for (const [id, label, names] of [["navGroupDimensions", "Dimensions", DIMENSIONS], ["navGroupActions", "Actions", ACTIONS], ["navGroupAppUsage", "App Usage", USAGE]] as const) {
      for (const menu of [wide.querySelector(`#${id}`)!, compact.querySelector(`[aria-label="${label}"]`)!]) {
        expect(menu.querySelectorAll(".nav-item").map(entry => entry.parentElement?.parentElement === menu)).toEqual(names.map(() => true));
      }
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
    // The full menu: four headings, in Actions' order, the three tables of imports in the Imports file's place.
    [SPLIT_ACTIONS, [["Processes", ["Processes"]], ["Imports", [...IMPORT_TABLES_SHOWN, "Import Data Sources"]], ["Exports", ["Exports"]], ["Other Actions", ["Other Actions"]]]],
    [["Processes", "File Imports", "In-Model Imports", "Import Data Sources", "Exports", "Other Actions"],
      [["Processes", ["Processes"]], ["Imports", ["File Imports", "In-Model Imports", "Import Data Sources"]], ["Exports", ["Exports"]], ["Other Actions", ["Other Actions"]]]],
    [["Processes", "File Imports"], [["Processes", ["Processes"]], ["Imports", ["File Imports"]]]],
    [["Model-to-Model Imports", "Other Actions"], [["Imports", ["Model-to-Model Imports"]], ["Other Actions", ["Other Actions"]]]],
    [["Processes", "Exports"], [["Processes", ["Processes"]], ["Exports", ["Exports"]]]],
    // Polaris, or an Imports file with no Source Type column or no rows: the file itself, unsplit, under Imports.
    [["Processes", "Imports", "Import Data Sources", "Exports"], [["Processes", ["Processes"]], ["Imports", ["Imports", "Import Data Sources"]], ["Exports", ["Exports"]]]],
    [["Imports", "Other Actions"], [["Imports", ["Imports"]], ["Other Actions", ["Other Actions"]]]],
  ])("heads every sub-group of Actions when tables of two or more are present, every table at one indent, in both layouts: %j", (names, sections) => {
    const items = navItems(entries(names), true);
    const wide = parseMarkup(navHtml(items, ""));
    const compact = parseMarkup(navMenuHtml(items, "", "Overview"));
    for (const actions of [wide.querySelector("#navGroupActions")!, compact.querySelector('[aria-label="Actions"]')!]) {
      // The narrow window's one menu heads the group itself as well, before its sub-groups' headings.
      expect(actions.querySelectorAll(".nav-heading").map(heading => heading.textContent).filter(label => label !== "Actions")).toEqual(sections.map(([label]) => label));
      expect(tree(actions)).toEqual(sections);
      // Every table stands two steps under the menu, in its sub-group's section, which sets its indent in results.css.
      expect(actions.querySelectorAll(".nav-item").map(entry => [words(entry), entry.parentElement?.parentElement === actions])).toEqual(names.map(name => [name, true]));
    }
  });

  it.each([
    [[...IMPORT_TABLES_SHOWN, "Import Data Sources"]],
    [["File Imports", "Model-to-Model Imports"]],
    [["Model-to-Model Imports", "In-Model Imports", "Import Data Sources"]],
    [["Imports", "Import Data Sources"]],
  ])("gives Actions no heading where all its tables are of Imports, each one step under the menu: %j", names => {
    const items = navItems(entries(names), true);
    const wide = parseMarkup(navHtml(items, ""));
    const compact = parseMarkup(navMenuHtml(items, "", "Overview"));
    for (const actions of [wide.querySelector("#navGroupActions")!, compact.querySelector('[aria-label="Actions"]')!]) {
      // No heading but the narrow window's one menu's for the group itself.
      expect(actions.querySelectorAll(".nav-heading").map(heading => heading.textContent).filter(label => label !== "Actions")).toEqual([]);
      expect(tree(actions)).toEqual(names);
      expect(actions.querySelectorAll(".nav-item").map(entry => [words(entry), entry.parentElement === actions])).toEqual(names.map(name => [name, true]));
    }
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

  it.each([...DIMENSIONS, ...SPLIT_ACTIONS, "Imports", ...USAGE])("makes %s a standalone entry when it is the group's only table", label => {
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

  it.each(["Dimensions", "Actions", "App Usage"])("keeps all labels for %s's width, with its own icon until a table is shown", label => {
    const group = NAV_GROUPS.find(group => group.label === label)!;
    const tables = entries(label === "Dimensions" ? DIMENSIONS : label === "Actions" ? SPLIT_ACTIONS : USAGE);
    const items = navItems(tables, true);
    for (const shown of [undefined, ...tables]) {
      const button = parseMarkup(navHtml(items, shown?.id ?? "overview")).querySelector(".nav-group-btn")!;
      expect(words(button)).toBe(shown?.label ?? label);
      // The group's name and its tables' labels, and no heading: the menu's headings leave the button's slot as it was.
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
