import { describe, expect, it } from "vitest";
import type { UxEntityRef } from "./card-reader/card-types.js";
import {
  addActions, addLineItems, addLists, addModuleDimensions, addModuleViews, addSelections, applicableModuleIds, describeFormat, emptyCatalog, entityType,
  filterItemNeeds, filterLineItemSearch, nameFilterValues, resolveFromCatalog, selectionShape, unnamedFilterRules, unresolvedFilterItems, viewLayoutFromMetadata,
} from "./catalog.js";

// Synthetic IDs only.
const [MODULE, MODULE_2, LIST, VIEW] = ["102000000901", "102000000902", "101000000901", "130000000901"];
/** A list that is no dimension the catalog has loaded, and items by their entity type and index: a list's top level item
 * is its item zero. */
const ROLES = "101000000911";
const ITEM = (type: number, index: number) => `${type}${String(index).padStart(9, "0")}`;
const ALL_REGIONS = ITEM(358, 0);
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

    // A rule has one line item. Once it is known, what the rule still holds unnamed is its context: no module lists that,
    // so it is not looked for among line items, and its axis is not a place to look.
    const fixed = [{ grid: { regions: [{ region: "SINGLE",
      rows: { dimensions: [{ dimension: ref("dimension", LIST) }], filter: { operator: "AND", conditions: [leaf(["20000000003", ALL_REGIONS, "1901000000001"])], groups: [] } },
      columns: { dimensions: [{ dimension: ref("dimension", "20000000003") }], filter: { operator: "AND", conditions: [leaf([ALL_REGIONS, "1901000000009"])], groups: [] } } }] } }];
    const sought = unresolvedFilterItems(fixed, catalog);
    expect([[...sought.itemIds], [...sought.axisDimensionIds]]).toEqual([[ALL_REGIONS, "1901000000009"], ["20000000003"]]);
    // An item that was named is no longer looked for either.
    addSelections(catalog, { data: [{ itemId: ALL_REGIONS, label: "All regions" }] });
    expect([...unresolvedFilterItems(fixed, catalog).itemIds]).toEqual(["1901000000009"]);
  });

  describe("the plan of the search for a rule's line item", () => {
    const module = (n: number) => String(102000000100 + n);
    /** A catalog in which these modules were read: each with two line items of the entity type given, or with none. */
    const read = (...modules: [n: number, type?: number][]) => {
      const catalog = emptyCatalog();
      for (const [n, type] of modules) addLineItems(catalog, module(n), { data: type === undefined ? [] : [0, 1].map(index => ({ lineItemId: ITEM(type, index), lineItemLabel: `Line item ${index}` })) });
      return catalog;
    };
    const unread = (...numbers: number[]) => numbers.map(module);
    const few = "fewer than 3 modules with line items were read";
    const rise = (modules: number) => `in the modules read, module IDs and line item entity types rise together (${modules} modules with line items)`;
    const fall = "in the modules read, module IDs and line item entity types do not rise together";
    const mixed = "in the modules read, a module's line items do not have one entity type of their own";

    it("looks for an ID in every module, until a module that was read rules it out: then, with the other IDs of its rule, in the candidate modules only", () => {
      // Nothing read that says anything: every ID is looked for in every module, the candidates first, as many as asked for.
      expect(filterLineItemSearch([[ITEM(315, 0), ITEM(250, 4)], [ITEM(315, 0)]], unread(7, 3), unread(9, 1, 5), emptyCatalog(), 4))
        .toEqual({ everywhere: [ITEM(315, 0), ITEM(250, 4)], candidatesOnly: [], ruledOut: [], modules: unread(7, 3, 9, 1), bracketed: 0, evidence: few });
      // No rule is without its line item, or no module is left: nothing is read.
      expect(filterLineItemSearch([], unread(7, 3), unread(9), emptyCatalog(), 4)).toEqual({ everywhere: [], candidatesOnly: [], ruledOut: [], modules: [], bracketed: 0, evidence: few });
      expect(filterLineItemSearch([[ITEM(315, 0)]], [], [], read([10, 300], [20]), 4)).toEqual({ everywhere: [ITEM(315, 0)], candidatesOnly: [], ruledOut: [], modules: [], bracketed: 0, evidence: few });
      // A module that is both a candidate and in the list is read once.
      expect(filterLineItemSearch([[ITEM(315, 0)]], unread(7, 3), unread(3, 9, 7), emptyCatalog(), 4).modules).toEqual(unread(7, 3, 9));

      // The line items of a module share an entity type: an ID of the type of a module that was read, which does not list
      // it, is ruled out. Nothing proves that no other module has line items of that type, so it is still looked for in the
      // candidate modules, and only there. An ID too short to have an entity type is never ruled out.
      const telling = read([10, 300], [20, 330], [30, 320]);
      expect(filterLineItemSearch([[ITEM(300, 7)], [ITEM(301, 0)], ["7"]], unread(7, 3), unread(9, 1), telling, 4)).toEqual({ everywhere: [ITEM(301, 0), "7"],
        candidatesOnly: [ITEM(300, 7)], ruledOut: [{ id: ITEM(300, 7), moduleId: module(10) }], modules: unread(7, 3, 9, 1), bracketed: 0, evidence: fall });
      // With no other ID to look for, only the candidates are read, in their order; and with no candidate left, nothing.
      expect(filterLineItemSearch([[ITEM(300, 7)]], unread(7, 3, 5), unread(9, 1), telling, 2)).toEqual({ everywhere: [],
        candidatesOnly: [ITEM(300, 7)], ruledOut: [{ id: ITEM(300, 7), moduleId: module(10) }], modules: unread(7, 3), bracketed: 0, evidence: fall });
      expect(filterLineItemSearch([[ITEM(300, 7)]], [], unread(9, 1), telling, 4)).toMatchObject({ everywhere: [], candidatesOnly: [ITEM(300, 7)], modules: [] });

      // A rule holds one line item: when one of its IDs is ruled out, that one was it, and the rule's other IDs are its
      // context. They are looked for in the candidates only too, unless a rule with no ID ruled out holds them as well.
      expect(filterLineItemSearch([[ITEM(7000, 3), ITEM(300, 7)]], unread(7), unread(9), telling, 4)).toEqual({ everywhere: [],
        candidatesOnly: [ITEM(7000, 3), ITEM(300, 7)], ruledOut: [{ id: ITEM(300, 7), moduleId: module(10) }], modules: unread(7), bracketed: 0, evidence: fall });
      expect(filterLineItemSearch([[ITEM(7000, 3), ITEM(300, 7)], [ITEM(7000, 3), ITEM(315, 0)], [ITEM(320, 9), ITEM(300, 7)]], unread(7), unread(9), telling, 4))
        .toEqual({ everywhere: [ITEM(7000, 3), ITEM(315, 0)], candidatesOnly: [ITEM(300, 7), ITEM(320, 9)],
          ruledOut: [{ id: ITEM(300, 7), moduleId: module(10) }, { id: ITEM(320, 9), moduleId: module(30) }], modules: unread(7, 9), bracketed: 0, evidence: fall });

      // All of that is taken from three modules with line items, and not from fewer.
      expect(filterLineItemSearch([[ITEM(7000, 3), ITEM(300, 7)]], unread(7), unread(9), read([10, 300], [20, 330], [40]), 4))
        .toEqual({ everywhere: [ITEM(7000, 3), ITEM(300, 7)], candidatesOnly: [], ruledOut: [], modules: unread(7, 9), bracketed: 0, evidence: few });
      // Nor when the modules read say otherwise: two of them have line items of one type, or one has line items of two types,
      // or a line item's ID is too short to have a type. Then no ID says which module it belongs to: nothing is ruled out,
      // and the IDs order nothing.
      const two = read([10, 300], [20, 310], [30, 320]);
      addLineItems(two, module(40), { data: [{ lineItemId: ITEM(300, 9), lineItemLabel: "Elsewhere" }] });
      const both = read([10, 300], [20, 310], [30, 320]);
      addLineItems(both, module(10), { data: [{ lineItemId: ITEM(305, 0), lineItemLabel: "Another type" }] });
      const short = read([10, 300], [20, 310], [30, 320]);
      addLineItems(short, module(40), { data: [{ lineItemId: "12", lineItemLabel: "Short" }] });
      for (const catalog of [two, both, short]) {
        expect(filterLineItemSearch([[ITEM(300, 7)], [ITEM(315, 0)]], [], unread(25, 1, 2), catalog, 2))
          .toEqual({ everywhere: [ITEM(300, 7), ITEM(315, 0)], candidatesOnly: [], ruledOut: [], modules: unread(25, 1), bracketed: 0, evidence: mixed });
      }
    });

    it("reads first the unread modules between the two whose entity types bracket an ID's, while the modules read bear that order out", () => {
      /** The plan when each ID is a rule of its own and no module is a candidate. */
      const plan = (ids: string[], others: string[], catalog: ReturnType<typeof read>, size: number) => filterLineItemSearch(ids.map(id => [id]), [], others, catalog, size);
      // Module IDs and entity types rise together in three modules that were read: the module of an entity type lies between
      // the two whose types bracket it. The unread modules there are read first, spread evenly; the others follow in the
      // order given.
      const rising = read([10, 300], [20, 310], [30, 320], [15]);
      const all = unread(1, 5, 12, 21, 22, 23, 24, 25, 26, 27, 28, 29, 35, 44);
      expect(plan([ITEM(315, 0)], all, rising, 4))
        .toEqual({ everywhere: [ITEM(315, 0)], candidatesOnly: [], ruledOut: [], modules: unread(22, 24, 26, 28), bracketed: 4, evidence: rise(3) });
      expect(plan([ITEM(315, 0)], all, rising, 6).modules).toEqual(unread(22, 23, 24, 26, 27, 28));
      // They are spread by their IDs, in whatever order the unread modules are given.
      expect(plan([ITEM(315, 0)], unread(29, 44, 21, 25, 1, 23, 27, 22, 28, 12, 24, 26, 5, 35), rising, 4)).toMatchObject({ modules: unread(22, 24, 26, 28), bracketed: 4 });
      // Fewer modules between the two than are asked for: all of them, then the first of the others, the candidates before
      // the model's other modules.
      expect(plan([ITEM(305, 3)], all, rising, 4)).toMatchObject({ modules: unread(12, 1, 5, 21), bracketed: 1 });
      expect(filterLineItemSearch([[ITEM(305, 3)]], unread(44, 21), unread(1, 12, 5), rising, 4)).toMatchObject({ modules: unread(12, 44, 21, 1), bracketed: 1 });
      // An entity type below every one that was read, or above: the modules before the first, or after the last.
      expect(plan([ITEM(250, 0)], all, rising, 4)).toMatchObject({ modules: unread(1, 5, 12, 21), bracketed: 2 });
      expect(plan([ITEM(400, 0)], all, rising, 1)).toMatchObject({ modules: unread(44), bracketed: 1 });
      // Several IDs: those between the same two modules share their bracket, and each bracket has its part of the reads.
      // An ID that is ruled out has no bracket: it is looked for in the candidates only.
      expect(plan([ITEM(315, 0), ITEM(316, 2), ITEM(400, 0), ITEM(300, 9)], all, rising, 4)).toEqual({ everywhere: [ITEM(315, 0), ITEM(316, 2), ITEM(400, 0)],
        candidatesOnly: [ITEM(300, 9)], ruledOut: [{ id: ITEM(300, 9), moduleId: module(10) }], modules: unread(24, 27, 35, 44), bracketed: 4, evidence: rise(3) });
      // Three brackets and four reads: the first has two, the others one each. And two reads: the first two have one each.
      expect(plan([ITEM(315, 0), ITEM(250, 0), ITEM(400, 0)], all, rising, 4)).toMatchObject({ modules: unread(24, 27, 5, 44), bracketed: 4 });
      expect(plan([ITEM(315, 0), ITEM(250, 0), ITEM(400, 0)], all, rising, 2)).toMatchObject({ modules: unread(25, 5), bracketed: 2 });
      // A bracket with no unread module takes no read from one that has some.
      expect(plan([ITEM(305, 0), ITEM(315, 0)], unread(21, 22, 23, 24, 25, 26, 27, 28, 29, 35), rising, 4)).toMatchObject({ modules: unread(22, 24, 26, 28), bracketed: 4 });
      // No unread module between the two, or an ID too short to have an entity type: the order given is all there is.
      expect(plan([ITEM(315, 0)], unread(44, 1, 12), rising, 4)).toMatchObject({ modules: unread(44, 1, 12), bracketed: 0, evidence: rise(3) });
      expect(plan(["7"], unread(21, 22, 1, 5), rising, 2)).toMatchObject({ everywhere: ["7"], modules: unread(21, 22), bracketed: 0 });

      // The modules read do not bear the order out, or are too few to: the IDs order nothing.
      expect(plan([ITEM(315, 0)], all, read([10, 300], [20, 330], [30, 320]), 4)).toMatchObject({ modules: unread(1, 5, 12, 21), bracketed: 0, evidence: fall });
      expect(plan([ITEM(315, 0)], all, read([10, 300], [30, 320]), 4)).toMatchObject({ modules: unread(1, 5, 12, 21), bracketed: 0, evidence: few });

      // IDs are put in the order of their numbers without being read as numbers: these two are one number to JavaScript, and
      // a longer ID is a greater one whatever its first digit.
      const [low, high, longer] = ["900000000000000001", "900000000000000002", "1000000000000000000"];
      const long = emptyCatalog();
      for (const [moduleId, type] of [["99", 300], [low, 310], [longer, 320]] as const) addLineItems(long, moduleId, { data: [{ lineItemId: ITEM(type, 0), lineItemLabel: "Line item" }] });
      expect(Number(low)).toBe(Number(high));
      expect(plan([ITEM(315, 0)], ["98", high, "100", "2000000000000000000"], long, 4)).toMatchObject({ modules: [high, "98", "100", "2000000000000000000"], bracketed: 1 });
      expect(plan([ITEM(305, 0)], ["98", high, "100", "2000000000000000000"], long, 4)).toMatchObject({ modules: ["100", "98", high, "2000000000000000000"], bracketed: 1 });
    });
  });

  it("keeps what the line items listing says of a line item's format: its data type and the list of a list format, never another value", () => {
    const catalog = loaded();
    const lineItem = (n: number, format?: unknown) => ({ lineItemId: 1902000000000 + n, lineItemLabel: `Line item ${n}`, ...(format === undefined ? {} : { lineItemInfo: { format } }) });
    addLineItems(catalog, MODULE_2, { data: [
      // As the classic client's format object has them: the list of a list format, the plain types, a time period.
      lineItem(1, { dataType: "ENTITY", hierarchyEntityLongId: Number(ROLES), isRelative: false, entityFormatFilter: { mappingHierarchyEntityLongId: Number(LIST), "Product - North": { deep: 1 } } }),
      lineItem(2, { dataType: "NUMBER", decimalPlaces: 2, units: "NONE", hierarchyEntityLongId: Number(ROLES) }),
      lineItem(3, { dataType: "TIME_ENTITY", periodType: { entityIndex: 3, entityLabel: "Month" } }),
      // Other names for the same: the list is the one value that is a dimension of this model, and with two there is none.
      lineItem(4, { type: "LIST", listId: Number(LIST) }),
      lineItem(5, { dataType: "ENTITY", listId: LIST, parentListId: "101000000902" }),
      // A data type that is no plain token is not kept; a list that is no ID is none; a key that is no plain word is not shown.
      lineItem(6, { dataType: "a list of Product", hierarchyEntityLongId: "Product", "Product - North": true }),
      lineItem(7), { ...lineItem(8), lineItemInfo: {} }, lineItem(9, "ENTITY"), lineItem(10, ["ENTITY"]), lineItem(11, null),
    ] });
    const id = (n: number) => String(1902000000000 + n);
    expect([...catalog.lineItemFormats]).toEqual([
      // The keys are kept for the log, with those of an object under a key, and no deeper.
      [id(1), { dataType: "ENTITY", listId: ROLES, keys: ["dataType", "entityFormatFilter{?, mappingHierarchyEntityLongId}", "hierarchyEntityLongId", "isRelative"] }],
      [id(2), { dataType: "NUMBER", keys: ["dataType", "decimalPlaces", "hierarchyEntityLongId", "units"] }],
      [id(3), { dataType: "TIME_ENTITY", listId: "20000000003", keys: ["dataType", "periodType{entityIndex, entityLabel}"] }],
      [id(4), { listId: LIST, keys: ["listId", "type"] }],
      [id(5), { dataType: "ENTITY", keys: ["dataType", "listId", "parentListId"] }],
      [id(6), { keys: ["?", "dataType", "hierarchyEntityLongId"] }],
    ]);
    // Every line item is still named, with or without a format.
    expect([...catalog.lineItems.keys()].slice(1)).toEqual(Array.from({ length: 11 }, (_, index) => id(index + 1)));
    // For the diagnostic log: keys, the data type and the dimension, and nothing else of the format.
    expect([1, 2, 4, 5, 6, 7].map(n => describeFormat(id(n), catalog))).toEqual([
      `filter line item ${id(1)}: format {dataType, entityFormatFilter{?, mappingHierarchyEntityLongId}, hierarchyEntityLongId, isRelative}, data type ENTITY, items of dimension ${ROLES}`,
      `filter line item ${id(2)}: format {dataType, decimalPlaces, hierarchyEntityLongId, units}, data type NUMBER`,
      `filter line item ${id(4)}: format {listId, type}, items of dimension ${LIST}`,
      `filter line item ${id(5)}: format {dataType, listId, parentListId}, data type ENTITY, no list named`,
      `filter line item ${id(6)}: format {?, dataType, hierarchyEntityLongId}`,
      `filter line item ${id(7)}: no format in the line items listing`]);
  });

  it("names a filter rule's item once a read has named it, and remembers which module and dimension named an item of its entity type", () => {
    const catalog = loaded();
    // An item's ID is its entity type and an index: the items of one list share the type.
    expect([entityType(ALL_REGIONS), entityType(ITEM(404, 3)), entityType("5438300031"), entityType("1901000000001")]).toEqual(["358", "404", "5", "1901"]);
    const answer = { data: [{ itemId: ALL_REGIONS, label: "All regions", index: 0 }, { itemId: Number(ITEM(358, 7)), label: "North" }, { itemId: ITEM(404, 3), label: "Planner" },
      { itemId: "7", label: "Seven" }, { itemId: ITEM(404, 4) }] };
    expect(addSelections(catalog, answer, { moduleId: MODULE, dimensionId: LIST })).toBe(4);
    // The first place that named an item of a type is kept; an ID too short to be an item's has no type.
    addSelections(catalog, { data: [{ itemId: ITEM(358, 8), label: "South" }, { itemId: ITEM(318, 1), label: "Open" }] }, { moduleId: MODULE_2, dimensionId: ROLES });
    addSelections(catalog, { data: [{ itemId: ITEM(319, 1), label: "No source" }] });
    expect([...catalog.itemSources]).toEqual([["358", { moduleId: MODULE, dimensionId: LIST }], ["404", { moduleId: MODULE, dimensionId: LIST }],
      ["318", { moduleId: MODULE_2, dimensionId: ROLES }]]);
    // What an answer holds, for the diagnostic log: the count and the first entry's keys.
    expect([selectionShape(answer), selectionShape({ data: [] }), selectionShape({ data: ["x"] }), selectionShape({ items: [] }), selectionShape(undefined)])
      .toEqual(["5 entries of {index, itemId, label}", "0 entries", "1 entries", "no data list", "no data list"]);

    // A rule's selected item of unknown kind: a line item, a list or a module first, as SAM's resolver has it; then a named item.
    const refs = [ref("unknown", ALL_REGIONS), ref("unknown", ITEM(358, 9)), ref("unknown", "1901000000001"), ref("unknown", LIST), ref("listItem", ITEM(404, 3))];
    const resolved = resolveFromCatalog(refs, catalog);
    expect(resolved.names).toEqual({ [`unknown:${ALL_REGIONS}`]: "All regions", "unknown:1901000000001": "Volume", [`unknown:${LIST}`]: "Product", [`listItem:${ITEM(404, 3)}`]: "Planner" });
    expect(resolved.kinds).toEqual({ [`unknown:${ALL_REGIONS}`]: "listItem", "unknown:1901000000001": "lineItem", [`unknown:${LIST}`]: "dimension" });
    expect(resolved.unresolved).toEqual([{ kind: "unknown", id: ITEM(358, 9), reason: "Not found in the model's metadata." }]);
  });

  it("says which items of filter rules are still to be named: fixed context items by the line item's module, compared items by line item", () => {
    const catalog = loaded();
    const [ROLE, STATUS, AMOUNT, MONTH, NOTE, UNSAID, ODD] = [1, 2, 3, 4, 5, 6, 7].map(n => String(1902000000000 + n));
    addLineItems(catalog, MODULE_2, { data: [
      { lineItemId: ROLE, lineItemLabel: "Role", lineItemInfo: { format: { dataType: "ENTITY", hierarchyEntityLongId: Number(ROLES) } } },
      { lineItemId: STATUS, lineItemLabel: "Status", lineItemInfo: { format: { dataType: "ENTITY", hierarchyEntityLongId: Number(ROLES) } } },
      { lineItemId: AMOUNT, lineItemLabel: "Amount", lineItemInfo: { format: { dataType: "NUMBER" } } },
      { lineItemId: MONTH, lineItemLabel: "Month", lineItemInfo: { format: { dataType: "TIME_ENTITY" } } },
      { lineItemId: NOTE, lineItemLabel: "Note", lineItemInfo: { format: { dataType: "TEXT", textType: "GENERAL" } } },
      { lineItemId: UNSAID, lineItemLabel: "Unsaid" },
      { lineItemId: ODD, lineItemLabel: "Odd", lineItemInfo: { format: { dataType: "SOMETHING_NEW" } } }] });
    const rule = (ids: string[], values: unknown[], operator = "EQUALS") => ({ operator, values, selectedItems: ids.map(id => ref("unknown", id)) });
    const card = (id: string, rowDimension: string, ...rules: unknown[]) => ({ id, grid: { regions: [{ region: "SINGLE",
      rows: { dimensions: [{ dimension: ref("dimension", rowDimension) }], filter: { operator: "AND", conditions: [], groups: [{ operator: "AND", conditions: rules, groups: [] }] } } }] } });
    const cards = [
      card("card-1", LIST,
        // The owner's fourth row: Time follows the page, a second dimension is fixed to one of its items, and the last is the line item.
        rule(["20000000003", ALL_REGIONS, ROLE], [ITEM(404, 3)]),
        // Compared with items of the list it is formatted as; with a number; with a time period; with text that only looks like an ID.
        rule([STATUS], [ITEM(318, 2), ITEM(318, 1)]), rule([AMOUNT], ["318000000002"], "GREATER_THAN"), rule([MONTH], ["5438300031"]), rule([NOTE], [ITEM(318, 2)]),
        // Not a value that can be an item's ID: text, a short number, true, nothing.
        rule([STATUS], ["Open", "42", true, null, 12, { id: ITEM(318, 5) }]),
        // A format that is not given, or says nothing known: a value is not taken for an item, however the rule tests it.
        rule([UNSAID], [ITEM(318, 3)]), rule([UNSAID], [ITEM(318, 4), ITEM(318, 3), "7"], "GREATER_THAN"), rule([ODD], [Number(ITEM(318, 6))], "NOT_EQUALS")),
      // The same line item in another card; and a rule on a line item of the first module, with two items fixed.
      card("card-2", "101000000902", rule([STATUS], [ITEM(318, 1), ITEM(318, 7), "7"]), rule([ITEM(358, 2), ITEM(359, 1), "101000000902", "1901000000001"], ["0"], "NOT_EQUALS")),
      // No line item that is known, or two: nothing can be said of the rule's other items.
      card("card-3", LIST, rule(["20000000003", ITEM(358, 3), "1901000000777"], [ITEM(318, 8)]), rule([ROLE, STATUS, ITEM(358, 4)], [ITEM(318, 9)])),
    ];
    expect(filterItemNeeds(cards, catalog)).toEqual({
      // The dimensions a rule filters or leaves to the page's selection are the least likely to hold its fixed item.
      context: [{ moduleId: MODULE_2, itemIds: [ALL_REGIONS], unlikely: ["20000000003", LIST] },
        { moduleId: MODULE, itemIds: [ITEM(358, 2), ITEM(359, 1)], unlikely: ["101000000902"] }],
      values: [{ lineItemId: ROLE, moduleId: MODULE_2, listId: ROLES, itemIds: [ITEM(404, 3)] },
        { lineItemId: STATUS, moduleId: MODULE_2, listId: ROLES, itemIds: [ITEM(318, 2), ITEM(318, 1), ITEM(318, 7)] },
        { lineItemId: MONTH, moduleId: MODULE_2, listId: "20000000003", itemIds: ["5438300031"] }],
      // What looks like an ID where the listing does not say what the line item's values are: counted, for the log, and no more.
      unsaid: [{ lineItemId: UNSAID, values: 2 }, { lineItemId: ODD, values: 1 }],
    });
    // For the log: each rule that holds an item nothing names, by what its items are, in their order. IDs only.
    expect(unnamedFilterRules(cards, catalog)).toEqual([
      `filter rule with an unnamed item (card card-1): dimension 20000000003, unnamed ${ALL_REGIONS}, line item ${ROLE} of module ${MODULE_2}`,
      `filter rule with an unnamed item (card card-2): unnamed ${ITEM(358, 2)}, unnamed ${ITEM(359, 1)}, dimension 101000000902, line item 1901000000001 of module ${MODULE}`,
      `filter rule with an unnamed item (card card-3): dimension 20000000003, unnamed ${ITEM(358, 3)}, unnamed 1901000000777`,
      `filter rule with an unnamed item (card card-3): line item ${ROLE} of module ${MODULE_2}, line item ${STATUS} of module ${MODULE_2}, unnamed ${ITEM(358, 4)}`]);

    // Once named, an item is no longer needed: what is left is what no read named. (The answers here also name what is no
    // item of a rule's: a value that is no ID, and the values of rules nothing can be said of.)
    addSelections(catalog, { data: [[ALL_REGIONS, "All regions"], [ITEM(359, 1), "Retail"], [ITEM(404, 3), "Planner"], [ITEM(318, 1), "Open"], [ITEM(318, 2), "Closed"],
      [ITEM(318, 3), "Late"], [ITEM(318, 4), "Never shown"], [ITEM(318, 5), "Never shown"], ["5438300031", "Jan 26"], ["318000000002", "Closed"],
      ["7", "Never shown"], [ITEM(318, 8), "Never shown"], [ITEM(318, 9), "Never shown"]].map(([itemId, label]) => ({ itemId, label })) });
    expect(filterItemNeeds(cards, catalog)).toEqual({ context: [{ moduleId: MODULE, itemIds: [ITEM(358, 2)], unlikely: ["101000000902"] }],
      values: [{ lineItemId: STATUS, moduleId: MODULE_2, listId: ROLES, itemIds: [ITEM(318, 7)] }],
      unsaid: [{ lineItemId: UNSAID, values: 2 }, { lineItemId: ODD, values: 1 }] });
    expect(unnamedFilterRules(cards, catalog)[0]).toBe(
      `filter rule with an unnamed item (card card-2): unnamed ${ITEM(358, 2)}, item ${ITEM(359, 1)}, dimension 101000000902, line item 1901000000001 of module ${MODULE}`);

    // The values of the rules, named: an item's name stands for its ID only where the listing says the value is an item,
    // although an item of that very ID has a name, and one that was not named keeps its ID. Nothing else changes, whatever it is.
    const values = (details: { cards: unknown[] }) => details.cards.flatMap(each => (each as typeof cards[0]).grid.regions[0].rows.filter.groups[0].conditions.map(condition => (condition as { values: unknown[] }).values));
    const copy = structuredClone({ cards });
    expect(nameFilterValues(copy, catalog)).toBe(copy);
    expect(values(copy)).toEqual([["Planner"], ["Closed", "Open"], ["318000000002"], ["Jan 26"], [ITEM(318, 2)], ["Open", "42", true, null, 12, { id: ITEM(318, 5) }],
      [ITEM(318, 3)], [ITEM(318, 4), ITEM(318, 3), "7"], [Number(ITEM(318, 6))], ["Open", ITEM(318, 7), "7"], ["0"], [ITEM(318, 8)], [ITEM(318, 9)]]);
    expect(values({ cards })[0]).toEqual([ITEM(404, 3)]);
  });
});
