import { describe, expect, it } from "vitest";
import type { UxEntityRef } from "../../../src/domains/ux-designer/card-types.js";
import {
  addActions, addLineItems, addLists, addModuleDimensions, addModuleViews, addSelections, applicableModuleIds, emptyCatalog, resolveFromCatalog,
  unresolvedFilterItems, viewLayoutFromMetadata,
} from "./catalog.js";

// Synthetic IDs only.
const [MODULE, MODULE_2, LIST, VIEW] = ["102000000901", "102000000902", "101000000901", "130000000901"];
const ref = (kind: UxEntityRef["kind"], id: string, extra: Partial<UxEntityRef> = {}): UxEntityRef => ({ kind, id, ...extra });

function loaded() {
  const catalog = emptyCatalog();
  addModuleViews(catalog, {
    data: [{ id: Number(MODULE), name: "Demand", views: [{ viewId: VIEW, viewName: "Exceptions view", default: false }, { viewId: MODULE, viewName: "Demand", default: true }] },
      { id: MODULE_2, name: "Factors", views: [] }, { id: "bad" }],
    dimensions: { [LIST]: { label: "Brand from module" }, "20000000003": { label: "Time" } },
  });
  addLists(catalog, { data: [{ id: Number(LIST), name: "Product" }, { id: "101000000902", name: "Territory" }] });
  addLineItems(catalog, MODULE, { data: [{ lineItemId: 1901000000001, lineItemLabel: "Volume" }, { lineItemId: "x" }] });
  addActions(catalog, "imports", { imports: [{ id: "112000000901", name: "Import demand" }] });
  addActions(catalog, "processes", { processes: [{ id: 118000000901, name: "Nightly" }], imports: [{ id: "112000000902", name: "ignored" }] });
  catalog.pages.set("page-guid", "Inventory policy");
  return catalog;
}

describe("Page analyzer names from the model data service", () => {
  it("reads modules, saved views, dimension labels, lists, line items and actions, keeping IDs as text", () => {
    const catalog = loaded();
    expect([...catalog.modules]).toEqual([[MODULE, "Demand"], [MODULE_2, "Factors"]]);
    expect([...catalog.views]).toEqual([[VIEW, { name: "Exceptions view", moduleId: MODULE }]]); // a module's default view is the module itself
    expect(catalog.dimensions.get(LIST)).toBe("Product"); // the list name wins over a module's dimension label
    expect(catalog.dimensions.get("20000000003")).toBe("Time");
    expect([...catalog.lineItems]).toEqual([["1901000000001", { name: "Volume", moduleId: MODULE }]]);
    expect([...catalog.actions]).toEqual([["112000000901", "Import demand"], ["118000000901", "Nightly"]]);
    expect([...catalog.lineItemModules]).toEqual([MODULE]);
    expect(applicableModuleIds(catalog, { data: [{ id: 102000000903, label: "Other" }, { label: "no id" }] })).toEqual(["102000000903"]);
    expect(catalog.modules.get("102000000903")).toBe("Other");
  });

  it("returns SAM's resolver shape: names, kinds for filter items, owning modules, and what stayed unresolved", () => {
    const refs = [ref("module", MODULE), ref("lineItem", "1901000000001", { moduleId: MODULE }), ref("view", VIEW), ref("dimension", "20000000012"),
      ref("unknown", "1901000000001"), ref("unknown", "101000000902"), ref("action", "112000000901", { actionType: "IMPORT" }), ref("page", "page-guid"),
      ref("listItem", "201000000001", { dimensionId: LIST }), ref("action", "118000000999", { actionType: "PROCESS" }), ref("module", MODULE)];
    const resolved = resolveFromCatalog(refs, loaded());
    expect(resolved.names).toEqual({ [`module:${MODULE}`]: "Demand", "lineItem:1901000000001": "Volume", [`view:${VIEW}`]: "Exceptions view",
      "dimension:20000000012": "Line Items", "unknown:1901000000001": "Volume", "unknown:101000000902": "Territory", "action:112000000901": "Import demand",
      "page:page-guid": "Inventory policy" });
    expect(resolved.kinds).toEqual({ "unknown:1901000000001": "lineItem", "unknown:101000000902": "dimension" });
    expect(resolved.modules).toEqual({ "lineItem:1901000000001": { moduleId: MODULE, moduleName: "Demand" }, [`view:${VIEW}`]: { moduleId: MODULE, moduleName: "Demand" },
      "unknown:1901000000001": { moduleId: MODULE, moduleName: "Demand" } });
    expect(resolved.unresolved).toEqual([{ kind: "listItem", id: "201000000001", reason: "List item names are not looked up." },
      { kind: "action", id: "118000000999", reason: "Not found in the model's metadata." }]);
  });

  it("labels a module or line item that is not in the model, and leaves merely unread ones as IDs", () => {
    const catalog = loaded();
    const refs = [ref("module", "102000000999"), ref("lineItem", "1901000000999", { moduleId: MODULE }), ref("lineItem", "1901000000998", { moduleId: "102000000999" }),
      ref("lineItem", "1902000000001", { moduleId: MODULE_2 }), ref("listItem", "201000000001", { dimensionId: LIST })];
    const resolved = resolveFromCatalog(refs, catalog);
    expect(resolved.names).toEqual({ "module:102000000999": "102000000999 (not in the model)", "lineItem:1901000000999": "1901000000999 (not in the model)",
      "lineItem:1901000000998": "1901000000998 (not in the model)" });
    expect(resolved.unresolved.map(({ id, reason }) => [id, reason])).toEqual([
      ["102000000999", "Not in the model: deleted, or not visible to this user."], ["1901000000999", "Not in the model: deleted, or not visible to this user."],
      ["1901000000998", "Not in the model: deleted, or not visible to this user."], ["1902000000001", "Not found in the model's metadata."],
      ["201000000001", "List item names are not looked up."]]);
    // Without a module list (the socket failed), nothing can be called missing.
    expect(resolveFromCatalog(refs, { ...emptyCatalog(), lineItemModules: new Set() }).names).toEqual({});
  });

  it("reads module dimensions, item labels and a saved view's rows, columns and context selectors", () => {
    const catalog = loaded();
    expect(addModuleDimensions(catalog, { modules: { [MODULE]: { dimensions: [{ id: Number(LIST), label: "Product" }, { id: "101000000903", label: "Channel" }, { label: "no id" }] },
      [MODULE_2]: { dimensions: [] } } })).toEqual([MODULE, MODULE_2]);
    expect(catalog.moduleDimensions.get(MODULE)).toEqual([{ id: LIST, name: "Product" }, { id: "101000000903", name: "Channel" }]);
    expect(catalog.dimensions.get("101000000903")).toBe("Channel");
    expect(addModuleDimensions(catalog, { data: [] })).toEqual([]);

    expect(addSelections(catalog, { data: [{ itemId: "201000000001", label: "North", index: 0 }, { id: 201000000002, name: "South" }, { itemId: "x" }] })).toBe(2);
    const view = viewLayoutFromMetadata({ rows: [{ dimensionId: "20000000012", label: "Line Items", scope: "s" }], cols: [],
      contextFilters: [{ parent: "101000000064", label: "Orders", type: "LIST" }, { parent: "101000000065", label: "Synced", contextFilterType: "BRANCH_SYNC" }] });
    expect(view).toEqual({ rows: [{ id: "20000000012", name: "Line Items" }], columns: [], pages: [{ id: "101000000064", name: "Orders" }] });
    expect(viewLayoutFromMetadata({ rowCount: 3 })).toBeUndefined();
    catalog.viewLayouts.set(VIEW, view!);

    const resolved = resolveFromCatalog([ref("listItem", "201000000001", { dimensionId: LIST }), ref("view", VIEW)], catalog);
    expect(resolved.names).toEqual({ "listItem:201000000001": "North", [`view:${VIEW}`]: "Exceptions view" });
    expect(resolved.views).toEqual({ [`view:${VIEW}`]: view });
  });

  it("finds filter items no listing names yet, with the dimensions of the axis they filter", () => {
    const catalog = loaded();
    const leaf = (ids: string[]) => ({ operator: "EQUALS", values: ["true"], selectedItems: ids.map(id => ref("unknown", id)) });
    const cards = [{ grid: { regions: [{ region: "SINGLE",
      rows: { dimensions: [{ dimension: ref("dimension", LIST) }], filter: { operator: "AND", conditions: [], groups: [{ operator: "AND", conditions: [leaf(["101000000902", "1901000000009"])], groups: [] }] } },
      columns: { dimensions: [{ dimension: ref("dimension", "20000000003") }], filter: { operator: "AND", conditions: [leaf(["1901000000001"])], groups: [] } } }] } }];
    const { itemIds, axisDimensionIds } = unresolvedFilterItems(cards, catalog);
    expect([...itemIds]).toEqual(["1901000000009"]);
    expect([...axisDimensionIds]).toEqual([LIST]);
  });
});
