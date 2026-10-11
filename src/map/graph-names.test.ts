import { describe, expect, it } from "vitest";
import { decorated, headingName, headingNames, headingStyle, moduleHeadings, separator } from "./graph-names.js";
import type { ResultTable } from "../result-types.js";

describe("heading shapes learnt from a model", () => {
  it.each(["", "   ", "🟣", "┄┄", "# # Orchard", "~ ~ Orchard", "| Orchard |", "[ Orchard ]", "( Orchard )", "{ Orchard }", "< Orchard >", "🟣 Orchard 🟣", "[ Orchard (FY) ]"])("recognises decoration in %j", name => {
    expect(decorated(name)).toBe(true);
  });

  it.each(["Orchard", "Été", "四", "٣", "- Orchard", "# Orchard", "[Old] Orchard [v2]", "(Old) Revenue (v2)", "(Orchard) Forecast", "[ Orchard)"])("keeps ordinary name %j", name => {
    expect(decorated(name)).toBe(false);
  });

  it.each([
    ["<-------- Orchard -------->", "Orchard"], ["-- Inputs (FY) --", "Inputs (FY)"], ["[ Orchard ]", "Orchard"],
    ["## Orchard ##", "Orchard"], ["~~ Inputs [Draft] ~~", "Inputs [Draft]"], ["[ Inputs (FY) ]", "Inputs (FY)"],
    ["🟣🟣 Récolte 🟣", "Récolte"], ["┄┄┄", "Ungrouped"], ["", "Ungrouped"],
    ["~~ ((FY)) Inputs ~~", "((FY)) Inputs"], ["~~ Inputs ((FY)) ~~", "Inputs ((FY))"], ["<> Data <>", "Data"],
  ])("names heading %j as %j", (name, title) => expect(headingName(name)).toBe(title));

  it("collapses repeats and spacing, keeping the two ends and their order", () => {
    expect(headingStyle("<-------- Orchard -------->")).toBe(JSON.stringify(["<-", "->"]));
    expect(headingStyle("# # Orchard # #")).toBe(headingStyle("#### Meadow ##"));
    expect(headingStyle("~~ Orchard ~~")).not.toBe(headingStyle("~~ Meadow"));
  });

  it("takes the style from the decoration the group name leaves out, so the words' own brackets never change it", () => {
    for (const [words, name, plain] of [
      ["-- Inputs (FY) --", "Inputs (FY)", "-- Data --"], ["~~ Inputs (FY) ~~", "Inputs (FY)", "~~ Data ~~"], ["~~ (FY) Inputs ~~", "(FY) Inputs", "~~ Data ~~"],
      ["[ Inputs (FY) ]", "Inputs (FY)", "[ Data ]"], ["<-Inputs [Draft]->", "Inputs [Draft]", "<-Data->"],
    ]) expect([headingName(words), headingStyle(words)], words).toEqual([name, headingStyle(plain)]);
    // So a divider in the style that holds a note is a heading where an empty divider has the style.
    expect(headingNames([{ name: "~~ Inputs (FY) ~~", empty: false }, { name: "~~ Data ~~", empty: true }])).toEqual(new Set(["~~ Inputs (FY) ~~", "~~ Data ~~"]));
    expect(headingNames([{ name: "~~ Inputs (FY) ~~", empty: false }, { name: "~~ Data", empty: true }])).toEqual(new Set(["~~ Data"]));
    // A bracket pair wholly inside the decoration is decoration: it is neither in the name nor out of the style.
    expect([headingName("<> Data <>"), headingStyle("<> Data <>"), headingName("[] (FY) Inputs []")]).toEqual(["Data", JSON.stringify(["<>", "<>"]), "(FY) Inputs"]);
  });

  it("learns only from empty rows in the current model and keeps the old separators unchanged", () => {
    const held = { name: "## Harvest ##", empty: false };
    expect(headingNames([held])).toEqual(new Set());
    expect(headingNames([held, { name: "# # Orchard #", empty: true }])).toEqual(new Set([held.name, "# # Orchard #"]));
    expect(headingNames([held, { name: "~~ Meadow ~~", empty: true }])).toEqual(new Set(["~~ Meadow ~~"]));
    expect(headingNames([held])).toEqual(new Set());
    expect(separator("## Harvest ##")).toBe(false);
    expect(separator("-- Harvest")).toBe(true);
  });

  it("counts Module Name as the exact cell text used by readLineItems, before deciding headings", () => {
    const tables: ResultTable[] = [
      { file: "Modules.csv", label: "Modules", headers: [""], guard: false, rows: [[" ## Orchard ## "]] },
      { file: "Line Items.csv", label: "Line Items", headers: ["", "Module Name"], guard: false,
        rows: [[" ## Orchard ## ", ""], ["Value", " ## Orchard ## "]] },
    ];
    expect(moduleHeadings(tables)).toEqual(new Set());
    tables[1].rows[1][1] = "## Orchard ##";
    expect(moduleHeadings(tables)).toEqual(new Set([" ## Orchard ## "]));
  });
});
