import { describe, expect, it } from "vitest";
import type { UxCardDetail, UxEntityRef } from "./card-reader/card-types.js";
import { mergePageUses, pageUsesOf } from "./page-uses.js";
import { LINE_ITEMS } from "./report.js";
import type { Obj } from "./util.js";

// Made-up names and IDs only. The cards are written by hand as the card reader describes them (card-reader/card-types.ts)
// once the model's names have named their references (card-reader/card-naming.ts `applyNames`).
const lineItem = (module: string, name: string, id = "1901000000001"): UxEntityRef => ({ kind: "lineItem", id, moduleId: "102000000001", name, moduleName: module });
const module = (name: string, id = "102000000001"): UxEntityRef => ({ kind: "module", id, name });
const card = (type: string, more: Obj = {}): UxCardDetail => ({ id: `card-${type}-${Math.random()}`, type, placement: { kind: "unplaced" }, hasSavedWidgetReference: false, ...more });
/** A grid section of a module, with its Line Items entry on its rows. */
const region = (shown: string, lineItems: Obj = {}, more: Obj = {}): Obj => ({ region: "SINGLE", module: module(shown), pivot: { rows: [], columns: [], pages: [] },
  rows: { dimensions: [{ dimension: { kind: "dimension", id: LINE_ITEMS, name: "Line Items" }, ...lineItems }] }, columns: { dimensions: [] }, ...more });
const grid = (...regions: Obj[]): UxCardDetail => card("TABLE", { viewType: "customView", grid: { sections: [], regions, summary: {} } });

describe("What the pages built on a model use of it", () => {
  it("takes every line item a card names, wherever it stands in the card: fields, a KPI, an image, buttons, filters, sorts and formatting", () => {
    const uses = pageUsesOf([
      card("FIELD", { fields: [{ module: module("FLD01 Fields"), lineItem: lineItem("FLD01 Fields", "Owner") }, { lineItem: lineItem("FLD01 Fields", "Due Date") }] }),
      card("CARD", { kpi: { module: module("KPI01 Measures"), lineItem: lineItem("KPI01 Measures", "Revenue"), indicator: { trend: { referenceLineItem: lineItem("KPI01 Measures", "Last Year") } } },
        sources: [{ dataSourceType: "CARD_LEVEL", module: module("KPI01 Measures"), lineItem: lineItem("KPI01 Measures", "Revenue") }] }),
      card("IMAGE", { image: { lineItem: lineItem("IMG01 Images", "Logo URL") } }),
      // A button that writes to a line item, and one that notifies with another.
      card("ACTION", { actions: [{ action: { kind: "action", id: "999000000001", actionType: "WRITEBACK" }, module: module("WRT01 Writeback"), lineItem: lineItem("WRT01 Writeback", "Approved") },
        { action: { kind: "action", id: "999000000002", actionType: "NOTIFICATION" }, lineItem: lineItem("WRT01 Writeback", "Message") }] }),
      // A grid that hides one line item and puts another first: both are named, and its module is shown whole.
      grid(region("GRD01 Grid", { hides: [lineItem("GRD01 Grid", "Hidden")], reorder: [lineItem("GRD01 Grid", "First")],
        sorts: [{ direction: "ASC", selectedItems: [lineItem("GRD01 Grid", "Sort Key")] }] }, {
        rows: { dimensions: [{ dimension: { kind: "dimension", id: LINE_ITEMS }, hides: [lineItem("GRD01 Grid", "Hidden")], reorder: [lineItem("GRD01 Grid", "First")],
          sorts: [{ direction: "ASC", selectedItems: [lineItem("GRD01 Grid", "Sort Key")] }] }],
        filter: { operator: "AND", conditions: [{ operator: "EQUALS", values: ["true"], selectedItems: [{ kind: "unknown", id: "1901000000077", resolvedKind: "lineItem", name: "Include?",
          moduleId: "102000000077", moduleName: "FLT01 Flags" }], filterLineItem: { kind: "unknown", id: "1901000000077", resolvedKind: "lineItem", name: "Include?", moduleName: "FLT01 Flags" } }],
        groups: [] } } })),
      card("TABLE", { conditionalFormatting: [{ type: "BG_COLOR", target: lineItem("CF01 Colours", "Status"), source: lineItem("CF01 Colours", "Score") }], grid: { regions: [] } }),
    ]);
    expect(uses.lineItems).toEqual([["FLD01 Fields", "Owner"], ["FLD01 Fields", "Due Date"], ["KPI01 Measures", "Revenue"], ["KPI01 Measures", "Last Year"], ["IMG01 Images", "Logo URL"],
      ["WRT01 Writeback", "Approved"], ["WRT01 Writeback", "Message"], ["GRD01 Grid", "Hidden"], ["GRD01 Grid", "First"], ["GRD01 Grid", "Sort Key"], ["FLT01 Flags", "Include?"],
      ["CF01 Colours", "Status"], ["CF01 Colours", "Score"]]);
    // The KPI, the field and the image cards name line items: none shows its module whole. The grid does, and so does the
    // grid whose sections were not read.
    expect([uses.modules, uses.unnamed]).toEqual([["GRD01 Grid"], 0]);
  });

  it("takes a module whole where a grid shows it without listing its line items, and not where a section lists those it shows", () => {
    const shows = [lineItem("SHW01 Shown", "Units"), lineItem("SHW01 Shown", "Price")];
    const uses = pageUsesOf([
      grid(region("ALL01 Everything")),
      grid(region("SHW01 Shown", { shows })),
      // A list cut short by the card reader is not the whole list: the section may show more.
      grid(region("CUT01 Cut", { shows: [lineItem("CUT01 Cut", "Units"), "[+3 more]"] })),
      // Line Items picked by the selector, narrowed by the section's own entry off its axes.
      grid({ region: "SINGLE", module: module("SEL01 Selector"), rows: { dimensions: [] }, columns: { dimensions: [] }, pivot: { rows: [], columns: [], pages: [{ dimension: { kind: "dimension", id: LINE_ITEMS } }] },
        pages: [{ dimension: { kind: "dimension", id: LINE_ITEMS }, shows: [lineItem("SEL01 Selector", "Picked")] }] }),
      grid({ region: "SINGLE", module: module("SEL02 All Picked"), rows: { dimensions: [] }, columns: { dimensions: [] }, pivot: { rows: [], columns: [], pages: [{ dimension: { kind: "dimension", id: LINE_ITEMS } }] } }),
      // A saved view, and a module's default view: their own hidden line items are not read.
      card("TABLE", { viewType: "savedView", sources: [{ dataSourceType: "CLASSIC", view: { kind: "view", id: "114000000001", name: "Review", moduleName: "SAV01 Saved" } }] }),
      card("COMBOCHART", { viewType: "moduleView", sources: [{ dataSourceType: "CLASSIC", module: module("DEF01 Default") }] }),
      // A grid whose sections were not read shows each module it takes data from.
      card("TABLE", { viewType: "customView", sources: [{ dataSourceType: "MULTI_AXIS_DESCRIPTION", module: module("UNR01 Unread") }] }),
    ]);
    expect(uses.modules).toEqual(["ALL01 Everything", "CUT01 Cut", "SEL02 All Picked", "SAV01 Saved", "DEF01 Default", "UNR01 Unread"]);
    expect(uses.lineItems).toEqual([["SHW01 Shown", "Units"], ["SHW01 Shown", "Price"], ["CUT01 Cut", "Units"], ["SEL01 Selector", "Picked"]]);
  });

  it("leaves out what the model doesn't have, counts what its names could not name, and reads nothing the card reader did not map", () => {
    const uses = pageUsesOf([card("FIELD", { fields: [{ lineItem: lineItem("FLD01 Fields", "Missing line item (ID 1901000000099)") }, { lineItem: { kind: "lineItem", id: "1901000000098" } },
      { lineItem: { kind: "lineItem", id: "1901000000098", name: "No Module" } }], unrecognised: [{ path: "x", valueType: "object", value: "y" }],
      grid: { regions: [{ region: "SINGLE", module: { kind: "module", id: "102000000555" }, rows: { dimensions: [] }, pivot: { rows: [], columns: [], pages: [] } },
        { region: "SINGLE", module: module("Missing module (ID 102000000556)"), rows: { dimensions: [] }, pivot: { rows: [], columns: [], pages: [] } }] } }),
    card("TABLE", { viewType: "savedView", sources: [{ dataSourceType: "CLASSIC", view: { kind: "view", id: "114000000002" } }] })]);
    // The unnamed line item counts once, though two references name it; the unnamed module and the saved view of no known
    // module count too.
    expect(uses).toEqual({ lineItems: [], modules: [], unnamed: 3 });
  });

  it("puts the pages' uses together, each once, with how many pages could not be read", () => {
    expect(mergePageUses([{ lineItems: [["A01", "One"], ["A01", "Two"]], modules: ["A01"], unnamed: 1 }, { lineItems: [["A01", "Two"], ["B01", "Three"]], modules: ["B01", "A01"], unnamed: 2 }], 4))
      .toEqual({ lineItems: [["A01", "One"], ["A01", "Two"], ["B01", "Three"]], modules: ["A01", "B01"], unread: 4, unnamed: 3 });
    expect(mergePageUses([], 0)).toEqual({ lineItems: [], modules: [], unread: 0, unnamed: 0 });
  });
});
