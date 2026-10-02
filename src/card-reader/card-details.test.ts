import { describe, expect, it } from "vitest";
import { describePageCards } from "./card-details.js";
import type { UxCardDetail, UxEntityRef, UxPageCardDetails } from "./card-types.js";
import { UxDefinitionError } from "./definition-types.js";

// Synthetic IDs only, shaped like a real model: 12-digit modules/lists, 13-digit line items, built-in dimensions.
const guid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const [MODULE, MODULE_2, MODULE_3, IMAGE_MODULE] = ["102000000901", "102000000902", "102000000903", "102000000904"];
const [LIST, LIST_2, LIST_3] = ["101000000901", "101000000902", "101000000903"];
const LI = (n: number) => `19010000000${String(n).padStart(2, "0")}`;
const ITEM = (n: number) => `20100000${String(n).padStart(4, "0")}`;
const TIME = "20000000003";
const LINE_ITEMS = "20000000012";
const TOKEN = "fake-token-value";
const ADQ_ID = guid(900);

type Obj = Record<string, any>;
/** Native JSON has no undefined values (the reader rejects them), so fixtures drop keys instead. */
const omit = (value: Obj, ...keys: string[]): Obj => Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)));
const styles = () => ({ titleColor: null, titleColorTheme: null, contextColor: null, contextColorTheme: null, contextPlacement: "BOTTOM", backgroundOptions: { backgroundColor: "#FFFFFF" } });
const common = (id: string, type: string, widgetGuid: string): Obj => ({ type, customerId: "customer-1", defaultTitle: "", description: "", pageLinkType: "title",
  pageType: "NONE", contextOptions: [], clientGuid: id, widgetGuid, version: 1, widgetActions: [], widgetStyles: styles(), isTargetPagePublished: false,
  showCommenting: true, showMaximize: true, showBackground: true, validVersions: [1] });
const classic = (widgetGuid: string) => [{ widgetGuid, dataSourceId: "", subEntityId: "", dataSourceType: "CLASSIC", axisDescriptionQuery: null, viewDescription: null }];
const option = (dimensionId: string, extra: Obj = {}) => ({ dimensionId, visible: false, syncedToPage: true, editable: false, defaultValue: null,
  itemHierarchyLevels: null, selections: null, filter: null, scope: null, parentItem: null, syncOnSelection: true, enableMultiSelect: false,
  resolutionPolicy: null, ancestry: null, ...extra });
const dim = (id: string, extra: Obj = {}) => ({ id, levels: [], sorts: [], totalsPosition: "AFTER", shows: [], hides: [], reorder: [], ...extra });
const leaf = (selectedItems: string[], operator = "NOT_EQUALS", values = ["0"]) => ({ type: "LEAF", rule: { selectedItems, operator, values, identifier: "", axisKey: null } });
const branch = (operator: string, nodes: unknown[]) => ({ type: "BRANCH", operator, nodes });
const axis = (dimensions: unknown[], nodes: unknown[] = [], extra: Obj = {}) => ({ dimensions, filters: { rootNode: branch("AND", nodes) }, raggedShows: [], raggedHides: [], ...extra });
const adqSource = (widgetGuid: string, axisDescriptionQuery: Obj) => [{ widgetGuid, dataSourceId: ADQ_ID, subEntityId: "", dataSourceType: "MULTI_AXIS_DESCRIPTION",
  axisDescriptionQuery, viewDescription: null }];
const draft = (text: string, type = "heading3", entityMap: Obj = {}) => JSON.stringify({ blocks: [{ key: "k1", text, type, depth: 0, inlineStyleRanges: [],
  entityRanges: [], data: { align: "left" } }], entityMap });

const tableCard = (id = guid(104), adq?: Obj): Obj => ({ ...common(id, "TABLE", guid(204)), defaultTitle: "Demand by region", dataSourceId: ADQ_ID,
  contextOptions: [option(LIST_2), option(LINE_ITEMS, { scope: MODULE })], branchSync: "[]", defaultColumnWidth: "", defaultColumnLabelHeight: "",
  gridColumnWidths: [], lineItemWidthOverrides: [], isReadOnly: false, pivotEnabled: false, customizations: "", lineItemConfigs: "", csvExportEnabled: true,
  allowFiltering: true, allowSorting: true, styleConfig: JSON.stringify({ themeId: "Base" }), showListFunctions: false, allowCopyAcross: true, allowCopyDown: true,
  allowCellHistory: true, allowExpandOrCollapseRows: false, allowChartCreation: true, allowZeroSuppression: true, timeDimensionWidthOverrides: {},
  widgetDataSources: adqSource(guid(204), adq ?? { id: ADQ_ID, version: 1, regions: { SINGLE: {
    rows: axis([dim(LIST)], [branch("AND", [leaf([LIST_2, LI(1)])])]),
    columns: axis([dim(TIME, { levels: ["LEAF"] })]),
    moduleId: MODULE } },
    conditionalFormattingRules: [{ targetIdentifier: LI(2), pegs: [{ value: 0, color: "#FFFFFF" }, { value: 100000, color: "#627786" }], sourceIdentifier: LI(2),
      type: "SLOT", targetRegionId: null, targetRegionCoordinates: null, valuesRegionCoordinates: null }] }) });
const imageCard = (id: string, widgetGuid: string, lineItemId: string): Obj => ({ ...common(id, "IMAGE", widgetGuid), dataSourceId: IMAGE_MODULE, lineItemId,
  scaleType: "scale", sourceType: "model", widgetDataSources: [{ widgetGuid, dataSourceId: IMAGE_MODULE, subEntityId: lineItemId, dataSourceType: "LINE_ITEM",
    axisDescriptionQuery: null, viewDescription: null }] });
const button = { id: "112000000901", type: "IMPORT", name: "Refresh demand", style: null, runAutomatically: null, actionDriverId: null, destinationListId: null,
  disableCancelButton: false, actionToken: TOKEN, description: null };
const actionCard = (): Obj => ({ ...common(guid(102), "ACTION", guid(202)), actionWidgetStyle: { layoutType: "BUTTON", directionType: "HORIZONTAL",
  spacingType: "MEDIUM", alignmentType: "CENTER", optionalComponents: { image: true, chevron: true, text: true }, titleColor: "#000000", titleColorTheme: "" },
  actions: JSON.stringify([{ ...button, description: null }]), actionButtons: [{ ...button }], widgetDataSources: classic(guid(202)) });
const navTextCard = (): Obj => ({ ...common(guid(105), "TEXT", guid(205)), pageAppIdentifier: guid(2), pageIdentifier: guid(3), pageType: "BOARD",
  pageName: "Inventory policy", version: 2, text: draft(""), isTargetPagePublished: true, showBackground: false, validVersions: [1, 2], widgetDataSources: classic(guid(205)) });
const textCard = (id = guid(106), text = "NEXT:"): Obj => ({ ...common(id, "TEXT", guid(206)), version: 2, text: draft(text), showBackground: false,
  validVersions: [1, 2], widgetDataSources: classic(guid(206)) });
const kpiCard = (id = guid(107)): Obj => ({ ...common(id, "CARD", ""), version: 2, dataSourceId: MODULE, textStyle: "heading1", paddingStyle: "standard",
  numberScale: "NONE", showSparkline: true, config: {}, widgetDataSources: [{ dataSourceId: MODULE, dataSourceType: "LINE_ITEM", subEntityId: LI(1) }] });

const pageIdentity = () => ({ pageGuid: guid(1), categoryGuid: guid(4), appGuid: guid(2), customerId: "customer-1", name: "Synthetic demand board",
  workspaceId: "workspace-1", modelId: "MODEL-1", rows: [], contextOptions: [], isMyPage: false, modelStatus: "UNLOCKED",
  modelInfos: [{ workspaceId: "workspace-1", modelId: "MODEL-1" }], modelCount: 1, currentDraftVersionGuid: guid(5), currentPublishedVersionGuid: guid(5),
  publishedAt: 1_700_000_000_000, updatedAt: 1_700_000_000_000, isAlm: false, categoryUpdatedAt: null, restrictions: [] });
const spacer = (n: number, at: number) => ({ type: "BOARD_COLUMN_SPACER", id: guid(n), columnStart: at, columnEnd: at, areas: null });
const column = (n: number, start: number, end: number, card: Obj) => ({ type: "BOARD_COLUMN", id: guid(n), columnStart: start, columnEnd: end,
  areas: { cards: [{ type: "BOARD_COLUMN_WIDGET_SPACER", height: 0, id: guid(n + 1) }, card, { type: "BOARD_COLUMN_WIDGET_SPACER", height: 0, id: guid(n + 2) }] } });
const row = (n: number, height: number, columns: unknown[]) => ({ id: guid(n), type: "BOARD_ROW", height, padding: "small", areas: { columns } });
const boardLayout = (rows: unknown[], sidepanelCards: unknown[] = []) => ({ id: guid(1000), type: "BOARD", version: 2, syncScroll: [], syncBrowser: false,
  defaultContext: [], contextFilterOrder: [], areas: {
    main: [{ type: "BOARD_CONTENT", id: guid(1001), areas: { sections: [{ type: "BOARD_SECTION", id: guid(1002), areas: { rows } }] } }],
    sidepanel: [{ type: "INSIGHT_PANEL", id: guid(1050), areas: { navLinks: [], cards: sidepanelCards } }], expanded: [] },
  commentSummary: true, commenting: true, openInsightsPanelByDefault: true });
const fullRow = (n: number, card: Obj, height = 240) => row(n, height, [spacer(n + 1, 0), column(n + 2, 0, 12, { ...card, height }), spacer(n + 5, 12)]);
/** A board with one full-width row per card. */
const boardOf = (...cards: Obj[]): Obj => ({ ...pageIdentity(), layout: boardLayout(cards.map((card, index) => fullRow(2000 + index * 10, { type: card.type, id: card.clientGuid }))),
  widgets: Object.fromEntries(cards.map(card => [card.clientGuid, card])) });

const board = (): Obj => ({ ...pageIdentity(), layout: boardLayout([
  row(1010, 91, [spacer(1011, 0), column(1012, 0, 2, { type: "IMAGE", height: 91, id: guid(101) }), spacer(1015, 2),
    column(1016, 2, 10, { type: "ACTION", height: 91, id: guid(102) }), spacer(1019, 10), column(1020, 10, 12, { type: "IMAGE", height: 91, id: guid(103) }), spacer(1023, 12)]),
  row(1030, 563, [spacer(1031, 0), column(1032, 0, 12, { type: "TABLE", height: 563, id: guid(104) }), spacer(1035, 12)]),
  row(1040, 240, [spacer(1041, 0), column(1042, 0, 10, { type: "TEXT", height: 240, id: guid(105) }), spacer(1045, 10),
    column(1046, 10, 12, { type: "TEXT", height: 240, id: guid(106) }), spacer(1049, 12)]),
], [{ type: "CARD", height: 200, id: guid(107) }]),
widgets: { [guid(102)]: actionCard(), [guid(104)]: tableCard(), [guid(103)]: imageCard(guid(103), guid(203), LI(3)), [guid(101)]: imageCard(guid(101), guid(201), LI(4)),
  [guid(105)]: navTextCard(), [guid(106)]: textCard(), [guid(107)]: kpiCard() } });

const card = (result: UxPageCardDetails, id: string): UxCardDetail => {
  const found = result.cards.find(item => item.id === id);
  if (!found) throw new Error(`Card ${id} was not described`);
  return found;
};
const ref = (kind: UxEntityRef["kind"], id: string, extra: Partial<UxEntityRef> = {}): UxEntityRef => ({ kind, id, ...extra });
const errorCode = (fn: () => unknown, code: string) => {
  try { fn(); throw new Error("Expected a definition error"); } catch (error) { expect(error).toBeInstanceOf(UxDefinitionError); expect((error as UxDefinitionError).code).toBe(code); }
};
const errorText = (fn: () => unknown, code: string, message: string) => {
  try { fn(); throw new Error("Expected a definition error"); } catch (error) { expect(error).toBeInstanceOf(UxDefinitionError); expect(error).toMatchObject({ code, message }); }
};
// The bounded copy's wording reaches MCP errors and the page analyzer's export.
const TRAVERSAL_BOUND = "Page definition exceeds SAM's bounded JSON traversal.";
const CHARACTER_BOUND = "Page definition exceeds SAM's 8 MB character bound.";
const UNSAFE_KEY = "Unsafe object key in page definition.";
const NO_IDENTITY = "pageGuid must be a nonempty string.";
const unsafeKey = (key = "__proto__") => JSON.parse(`{"${key}":{"polluted":true}}`);
/** An empty object wrapped in `levels` parent objects. */
const chain = (levels: number) => { let nested: unknown = {}; for (let i = 0; i < levels; i++) nested = { child: nested }; return nested; };
const referenceKeys = (result: UxPageCardDetails) => result.references.map(item => `${item.kind}:${item.id}:${item.moduleId ?? ""}`);
/** Every UxEntityRef-shaped object nested anywhere in the cards/page context. */
const nestedRefs = (value: unknown): UxEntityRef[] => {
  if (Array.isArray(value)) return value.flatMap(nestedRefs);
  if (!value || typeof value !== "object") return [];
  const item = value as Obj;
  const own = typeof item.kind === "string" && typeof item.id === "string" ? [item as UxEntityRef] : [];
  return [...own, ...Object.values(item).flatMap(nestedRefs)];
};

describe("UX card details, tolerant read of native pages", () => {
  it("describes a captured-shape board: placements, grid, images, action, text, navigation and page context", () => {
    const native = board();
    const snapshot = structuredClone(native);
    const result = describePageCards("BOARD", native);
    expect(native).toEqual(snapshot);
    expect(result).toMatchObject({ pageType: "BOARD", pageGuid: guid(1), appGuid: guid(2), name: "Synthetic demand board", customerId: "customer-1",
      workspaceId: "workspace-1", modelId: "MODEL-1", warnings: [] });
    expect(result.cards.map(item => [item.id, item.type])).toEqual([[guid(102), "ACTION"], [guid(104), "TABLE"], [guid(103), "IMAGE"], [guid(101), "IMAGE"],
      [guid(105), "TEXT"], [guid(106), "TEXT"], [guid(107), "CARD"]]);
    expect(result.cards.every(item => item.unrecognised === undefined)).toBe(true);
    expect(result.pageContext).toEqual({ layoutType: "BOARD", syncBrowser: false, layoutSettings: { version: 2, commentSummary: true, commenting: true,
      openInsightsPanelByDefault: true }, modelCount: 1, categoryGuid: guid(4), currentDraftVersionGuid: guid(5), currentPublishedVersionGuid: guid(5),
      publishedAt: 1_700_000_000_000, updatedAt: 1_700_000_000_000 });

    expect(card(result, guid(101)).placement).toEqual({ kind: "board", area: "main", sectionId: guid(1002), rowId: guid(1010), rowIndex: 0, rowHeight: 91,
      columnStart: 0, columnEnd: 2, height: 91 });
    expect(card(result, guid(103)).placement).toMatchObject({ rowIndex: 0, columnStart: 10, columnEnd: 12 });
    expect(card(result, guid(106)).placement).toMatchObject({ rowId: guid(1040), rowIndex: 2, rowHeight: 240, columnStart: 10, columnEnd: 12, height: 240 });
    expect(card(result, guid(107)).placement).toEqual({ kind: "board", area: "sidepanel", height: 200 });

    expect(card(result, guid(104))).toEqual({
      id: guid(104), type: "TABLE", title: "Demand by region", placement: { kind: "board", area: "main", sectionId: guid(1002), rowId: guid(1030), rowIndex: 1,
        rowHeight: 563, columnStart: 0, columnEnd: 12, height: 563 }, hasSavedWidgetReference: true,
      sources: [{ dataSourceType: "MULTI_AXIS_DESCRIPTION", descriptionId: ADQ_ID, module: ref("module", MODULE) }], viewType: "customView",
      grid: {
        sections: [{ region: "SINGLE", module: ref("module", MODULE), order: 1 }],
        regions: [{ region: "SINGLE", module: ref("module", MODULE),
          rows: { dimensions: [{ dimension: ref("dimension", LIST), totalsPosition: "AFTER" }],
            filter: { operator: "AND", match: "all", conditions: [], groups: [{ operator: "AND", match: "all", groups: [],
              conditions: [{ operator: "NOT_EQUALS", values: ["0"], selectedItems: [ref("unknown", LIST_2), ref("unknown", LI(1))] }] }] } },
          columns: { dimensions: [{ dimension: ref("dimension", TIME), levels: ["LEAF"], totalsPosition: "AFTER" }] },
          pivot: { rows: [ref("dimension", LIST)], columns: [ref("dimension", TIME)], pages: [
            { dimension: ref("dimension", LIST_2), source: "contextSelector", visible: false, syncedToPage: true },
            { dimension: ref("dimension", LINE_ITEMS), source: "contextSelector", visible: false, syncedToPage: true }] } }],
        summary: { hasFilters: true, hasSorts: false, hasHiddenItems: false, hasLevelSelection: true, hasConditionalFormatting: true },
      },
      conditionalFormatting: [{ type: "SLOT", source: ref("lineItem", LI(2), { moduleId: MODULE }), target: ref("lineItem", LI(2), { moduleId: MODULE }),
        pegs: [{ value: 0, color: "#FFFFFF" }, { value: 100000, color: "#627786" }] }],
      contextSelectors: [
        { dimension: ref("dimension", LIST_2), visible: false, syncedToPage: true, editable: false, enableMultiSelect: false, syncOnSelection: true },
        { dimension: ref("dimension", LINE_ITEMS), visible: false, syncedToPage: true, editable: false, enableMultiSelect: false, syncOnSelection: true,
          scope: ref("module", MODULE) }],
      settings: { version: 1, isReadOnly: false, pivotEnabled: false, csvExportEnabled: true, allowFiltering: true, allowSorting: true, showListFunctions: false,
        allowCopyAcross: true, allowCopyDown: true, allowCellHistory: true, allowExpandOrCollapseRows: false, allowChartCreation: true, allowZeroSuppression: true,
        widgetStyles: { contextPlacement: "BOTTOM", backgroundOptions: { backgroundColor: "#FFFFFF" } }, showCommenting: true, showMaximize: true,
        showBackground: true, themeId: "Base" },
    });

    const image = card(result, guid(103));
    expect(image.image).toEqual({ sourceType: "model", module: ref("module", IMAGE_MODULE), lineItem: ref("lineItem", LI(3), { moduleId: IMAGE_MODULE }), scaleType: "scale" });
    expect(image.sources).toEqual([{ dataSourceType: "LINE_ITEM", module: ref("module", IMAGE_MODULE), lineItem: ref("lineItem", LI(3), { moduleId: IMAGE_MODULE }) }]);

    const action = card(result, guid(102));
    expect(action.actions).toEqual([{ action: ref("action", "112000000901", { actionType: "IMPORT" }), name: "Refresh demand", disableCancelButton: false }]);
    expect(action.sources).toEqual([{ dataSourceType: "CLASSIC" }]);
    expect(action.settings).toMatchObject({ actionWidgetStyle: { layoutType: "BUTTON", optionalComponents: { image: true, chevron: true, text: true } } });
    expect(JSON.stringify(result)).not.toContain(TOKEN);
    expect(JSON.stringify(result)).not.toMatch(/actionToken|widgetDataSources|axisDescriptionQuery|clientGuid/u);

    expect(card(result, guid(105))).toMatchObject({ navigation: { page: ref("page", guid(3), { name: "Inventory policy" }), appGuid: guid(2), pageType: "BOARD",
      linkType: "title", targetPublished: true }, text: { plainText: "", styles: ["heading3"], hasDynamicContent: false } });
    expect(card(result, guid(106)).navigation).toBeUndefined();
    expect(card(result, guid(106)).text).toEqual({ plainText: "NEXT:", styles: ["heading3"], hasDynamicContent: false });

    // Every nested reference is listed once for name resolution, and nothing else is listed.
    const keys = referenceKeys(result);
    expect(new Set(keys).size).toBe(keys.length);
    const nested = new Set(nestedRefs(result.cards).map(item => `${item.kind}:${item.id}:${item.moduleId ?? ""}`));
    expect(new Set(keys)).toEqual(nested);
    expect(keys).toEqual(expect.arrayContaining([`action:112000000901:`, `module:${MODULE}:`, `lineItem:${LI(2)}:${MODULE}`, `unknown:${LI(1)}:`,
      `dimension:${LINE_ITEMS}:`, `page:${guid(3)}:`, `lineItem:${LI(4)}:${IMAGE_MODULE}`]));
  });

  it("keeps nested AND/OR filter trees on rows and columns in native order", () => {
    const rows = axis([dim(LIST)], [branch("AND", [leaf([LIST_2, LI(1)]), leaf([LI(2)], "GREATER_THAN", ["10"]),
      branch("OR", [leaf([LIST_2, LI(3)], "EQUALS", ["true"]), { type: "LEAF", rule: { selectedItems: ["-1", LI(4)], operator: "LESS_THAN", values: ["5"],
        identifier: LI(4), axisKey: "rows" } }])])]);
    const columns = axis([dim(TIME)], [leaf([LI(5)], "NOT_EQUALS", ["0"])]);
    const result = describePageCards("BOARD", boardOf(tableCard(guid(104), { version: 1, regions: { SINGLE: { rows, columns, moduleId: MODULE } } })));
    const region = (card(result, guid(104)).grid as Obj).regions[0];
    expect(region.rows.filter).toEqual({ operator: "AND", match: "all", conditions: [], groups: [{ operator: "AND", match: "all",
      conditions: [
        { operator: "NOT_EQUALS", values: ["0"], selectedItems: [ref("unknown", LIST_2), ref("unknown", LI(1))] },
        { operator: "GREATER_THAN", values: ["10"], selectedItems: [ref("unknown", LI(2))] }],
      groups: [{ operator: "OR", match: "any", groups: [], conditions: [
        { operator: "EQUALS", values: ["true"], selectedItems: [ref("unknown", LIST_2), ref("unknown", LI(3))] },
        { operator: "LESS_THAN", values: ["5"], selectedItems: [ref("unknown", LI(4))], otherItems: ["-1"], identifier: ref("unknown", LI(4)), axisKey: "rows" }] }] }] });
    expect(region.columns.filter).toEqual({ operator: "AND", match: "all", groups: [],
      conditions: [{ operator: "NOT_EQUALS", values: ["0"], selectedItems: [ref("unknown", LI(5))] }] });
    expect(result.warnings).toEqual([]);
  });

  it("describes levels, sorts, show/hide, reorder and ragged selections with item references", () => {
    const rows = axis([
      dim(LIST, { levels: ["LEAF"], shows: [ITEM(1), ITEM(2)], reorder: [ITEM(2), ITEM(1)],
        sorts: [{ selectedItems: [LI(1), "FY24"], direction: "DESCENDING", axisKey: "columns" }] }),
      dim(LINE_ITEMS, { hides: [LI(7), "not-an-id"] }),
    ], [], { raggedShows: [ITEM(3), { [LIST]: ITEM(4), [LIST_3]: ITEM(5) }], raggedHides: [{ future: "shape" }] });
    const result = describePageCards("BOARD", boardOf(tableCard(guid(104), { version: 1, regions: { SINGLE: { rows, columns: axis([dim(TIME)]), moduleId: MODULE } } })));
    const grid = card(result, guid(104)).grid as Obj;
    expect(grid.regions[0].rows).toEqual({
      dimensions: [
        { dimension: ref("dimension", LIST), levels: ["LEAF"], totalsPosition: "AFTER",
          sorts: [{ direction: "DESCENDING", axisKey: "columns", selectedItems: [ref("unknown", LI(1))], otherItems: ["FY24"] }],
          shows: [ref("listItem", ITEM(1), { dimensionId: LIST }), ref("listItem", ITEM(2), { dimensionId: LIST })],
          reorder: [ref("listItem", ITEM(2), { dimensionId: LIST }), ref("listItem", ITEM(1), { dimensionId: LIST })] },
        { dimension: ref("dimension", LINE_ITEMS), totalsPosition: "AFTER", hides: [ref("lineItem", LI(7), { moduleId: MODULE }), "not-an-id"] },
      ],
      raggedShows: [ref("listItem", ITEM(3)), [ref("listItem", ITEM(4), { dimensionId: LIST }), ref("listItem", ITEM(5), { dimensionId: LIST_3 })]],
      raggedHides: [{ future: "shape" }],
    });
    expect(grid.summary).toEqual({ hasFilters: false, hasSorts: true, hasHiddenItems: true, hasLevelSelection: true, hasConditionalFormatting: false });
    expect(referenceKeys(result)).toContain(`listItem:${ITEM(1)}:`);
  });

  it("keeps several conditional formatting rules, including unknown rule types as bounded raw config", () => {
    const adq = { version: 1, regions: { SINGLE: { rows: axis([dim(LIST)]), columns: axis([dim(LINE_ITEMS)]), moduleId: MODULE } }, conditionalFormattingRules: [
      { targetIdentifier: LI(1), sourceIdentifier: LI(2), type: "SLOT", pegs: [{ value: 1, color: "#000000" }], targetRegionId: null, targetRegionCoordinates: null, valuesRegionCoordinates: null },
      { targetIdentifier: LI(3), sourceIdentifier: "Revenue label", type: "ICON_SET", threshold: 5, reverse: true, icons: [{ name: "arrow-up", above: 5 }],
        targetRegion: { columnAxisKey: "c1", rowAxisKey: "r1" }, apiSecret: "fake-secret" },
    ] };
    const result = describePageCards("BOARD", boardOf(tableCard(guid(104), adq)));
    expect(card(result, guid(104)).conditionalFormatting).toEqual([
      { type: "SLOT", source: ref("lineItem", LI(2), { moduleId: MODULE }), target: ref("lineItem", LI(1), { moduleId: MODULE }), pegs: [{ value: 1, color: "#000000" }] },
      { type: "ICON_SET", source: ref("unknown", "Revenue label"), target: ref("lineItem", LI(3), { moduleId: MODULE }), threshold: 5, reverse: true,
        regions: { targetRegion: { columnAxisKey: "c1", rowAxisKey: "r1" } }, config: { icons: [{ name: "arrow-up", above: 5 }], apiSecret: "[redacted]" } },
    ]);
    expect(JSON.stringify(result)).not.toContain("fake-secret");
  });

  it("describes a three-section v1 grid with its own modules, filters, CF targeting and sources", () => {
    const adq = { id: ADQ_ID, version: 1, regions: {
      SINGLE: { rows: axis([dim(LIST)]), columns: axis([dim(TIME)]), moduleId: MODULE },
      "region-2": { rows: axis([dim(LIST)]), columns: axis([dim(LINE_ITEMS)]), moduleId: MODULE_2 },
      "region-3": { rows: axis([dim(LIST_3)], [leaf([LI(9)], "EQUALS", ["1"])]), columns: axis([dim(TIME)]), moduleId: MODULE_3,
        offAxisDimensions: [dim(LIST_2, { shows: [ITEM(8)] })] },
    }, conditionalFormattingRules: [
      { targetIdentifier: LI(21), sourceIdentifier: LI(21), type: "SLOT", pegs: [], targetRegionId: "region-2" },
      { targetIdentifier: LI(22), sourceIdentifier: LI(22), type: "SLOT", pegs: [], targetRegionId: null },
    ] };
    const table = { ...tableCard(guid(104), adq), contextOptions: [option(LIST_2), option(LINE_ITEMS, { scope: MODULE_2, visible: true })] };
    const result = describePageCards("BOARD", boardOf(table));
    const detail = card(result, guid(104));
    const grid = detail.grid as Obj;
    expect(grid.sections).toEqual([{ region: "SINGLE", module: ref("module", MODULE), order: 1 }, { region: "region-2", module: ref("module", MODULE_2), order: 2 },
      { region: "region-3", module: ref("module", MODULE_3), order: 3 }]);
    expect(detail.sources).toEqual([{ dataSourceType: "MULTI_AXIS_DESCRIPTION", descriptionId: ADQ_ID, module: ref("module", MODULE),
      modules: [ref("module", MODULE), ref("module", MODULE_2), ref("module", MODULE_3)] }]);
    expect(detail.conditionalFormatting).toEqual([
      { type: "SLOT", source: ref("lineItem", LI(21), { moduleId: MODULE_2 }), target: ref("lineItem", LI(21), { moduleId: MODULE_2 }), regions: { targetRegionId: "region-2" } },
      // No targeted region among three modules: the owning module is left to name resolution.
      { type: "SLOT", source: ref("lineItem", LI(22)), target: ref("lineItem", LI(22)) },
    ]);
    expect(grid.regions.map((region: Obj) => [region.region, region.rows.filter !== undefined, region.columns.filter !== undefined]))
      .toEqual([["SINGLE", false, false], ["region-2", false, false], ["region-3", true, false]]);
    expect(grid.regions[2].pages).toEqual([{ dimension: ref("dimension", LIST_2), totalsPosition: "AFTER", shows: [ref("listItem", ITEM(8), { dimensionId: LIST_2 })] }]);
    // Page dimensions: axis off-axis dimensions plus card context selectors; the module-scoped Line Items selector joins only its module's section.
    expect(grid.regions.map((region: Obj) => region.pivot.pages)).toEqual([
      [{ dimension: ref("dimension", LIST_2), source: "contextSelector", visible: false, syncedToPage: true }],
      [{ dimension: ref("dimension", LIST_2), source: "contextSelector", visible: false, syncedToPage: true }],
      [{ dimension: ref("dimension", LIST_2), source: "axis", visible: false, syncedToPage: true }],
    ]);
    expect(grid.regions[0].pivot.columns).toEqual([ref("dimension", TIME)]);
    const scoped = describePageCards("BOARD", boardOf({ ...table, contextOptions: [option(LINE_ITEMS, { scope: MODULE, visible: true })] }));
    expect((card(scoped, guid(104)).grid as Obj).regions.map((region: Obj) => region.pivot.pages.map((page: Obj) => [page.dimension.id, page.source])))
      .toEqual([[[LINE_ITEMS, "contextSelector"]], [], [[LIST_2, "axis"]]]);
  });

  it("describes a three-section v2 grid (child axes plus a regions array) in native order", () => {
    const adq = { id: ADQ_ID, version: 2, breakbackSelections: [], conditionalFormattingRules: [
      { targetIdentifier: LI(31), sourceIdentifier: LI(31), type: "SLOT", pegs: [{ value: 1, color: "#111111" }], targetRegionId: guid(702),
        targetRegion: { columnAxisKey: "c2", rowAxisKey: "r1" } }],
      rowAxis: { childAxes: { r1: axis([dim(LIST)]) } },
      columnAxis: { childAxes: { c1: axis([dim(TIME)]), c2: axis([dim(LINE_ITEMS)], [], { raggedShows: [] }), c3: axis([dim(TIME)], [leaf([LI(33)])]) } },
      regions: [
        { id: "SINGLE", moduleId: MODULE, regionType: "DATA", columnAxisKey: "c1", rowAxisKey: "r1", offAxisDimensions: [] },
        { id: guid(702), moduleId: MODULE_2, regionType: "DATA", coordinates: ["c2", "r1"], offAxisDimensions: [dim(LIST_3)] },
        { id: guid(703), moduleId: MODULE_3, regionType: "DATA", columnAxisKey: "c3", rowAxisKey: "r1" },
      ] };
    const result = describePageCards("BOARD", boardOf({ ...tableCard(guid(104), adq), contextOptions: [] }));
    const detail = card(result, guid(104));
    const grid = detail.grid as Obj;
    expect(grid.sections.map((section: Obj) => [section.region, section.module.id, section.order])).toEqual([["SINGLE", MODULE, 1], [guid(702), MODULE_2, 2], [guid(703), MODULE_3, 3]]);
    expect(grid.regions[1]).toMatchObject({ region: guid(702), regionType: "DATA", rowAxisKey: "r1", columnAxisKey: "c2",
      columns: { dimensions: [{ dimension: ref("dimension", LINE_ITEMS) }] }, pages: [{ dimension: ref("dimension", LIST_3) }],
      pivot: { rows: [ref("dimension", LIST)], columns: [ref("dimension", LINE_ITEMS)], pages: [{ dimension: ref("dimension", LIST_3), source: "axis" }] } });
    expect(grid.regions[2].columns.filter.conditions[0].selectedItems).toEqual([ref("unknown", LI(33))]);
    expect(detail.conditionalFormatting).toEqual([{ type: "SLOT", source: ref("lineItem", LI(31), { moduleId: MODULE_2 }), target: ref("lineItem", LI(31), { moduleId: MODULE_2 }),
      pegs: [{ value: 1, color: "#111111" }], regions: { targetRegionId: guid(702), targetRegion: { columnAxisKey: "c2", rowAxisKey: "r1" } } }]);
    expect(detail.sources?.[0].modules?.map(item => item.id)).toEqual([MODULE, MODULE_2, MODULE_3]);
    expect(detail.unrecognised).toBeUndefined();
    expect(result.warnings).toEqual([]);
  });

  it("describes worksheet main grid and insights in wrapper order", () => {
    const main = { ...common(`mainGrid:${guid(1)}`, "TABLE", ""), dataSourceId: MODULE, isReadOnly: true, widgetDataSources: [{ dataSourceId: MODULE, dataSourceType: "CLASSIC" }] };
    const worksheet = { ...omit(pageIdentity(), "rows"), navLinks: [{ guid: guid(60), label: "Related" }], defaultRelatedWidgetGuid: guid(302), pageMetadata: { version: 2 },
      layout: { id: guid(1100), type: "GRIDPAGE", version: 1, syncScroll: [] },
      widgets: [
        { guid: "", height: 250, widgetGuid: guid(401), showPreview: true, widgetDefinition: { ...textCard(guid(301), "First insight"), widgetGuid: guid(401) } },
        { guid: "", height: 300, widgetGuid: "", showPreview: false, widgetDefinition: main },
        { guid: "", height: 200, showPreview: true, futureWrapperFlag: "kept", widgetDefinition: { ...kpiCard(guid(302)), widgetGuid: "" } },
      ] };
    const result = describePageCards("GRID-PAGE", worksheet);
    expect(result.cards.map(item => [item.id, item.placement, item.hasSavedWidgetReference])).toEqual([
      [guid(301), { kind: "worksheet", role: "insight", index: 0, height: 250, showPreview: true }, true],
      [`mainGrid:${guid(1)}`, { kind: "worksheet", role: "main", index: 0, height: 300, showPreview: false }, false],
      [guid(302), { kind: "worksheet", role: "insight", index: 1, height: 200, showPreview: true }, false],
    ]);
    expect(card(result, `mainGrid:${guid(1)}`).sources).toEqual([{ dataSourceType: "CLASSIC", module: ref("module", MODULE) }]);
    expect(card(result, guid(302)).unrecognised).toEqual([{ path: "wrapper.futureWrapperFlag", valueType: "string", value: "kept" }]);
    expect(result.pageContext).toMatchObject({ layoutType: "GRIDPAGE", defaultRelatedCardId: guid(302), navLinks: [{ guid: guid(60), label: "Related" }], pageMetadata: { version: 2 } });
    expect(result.warnings).toEqual([]);
  });

  it("describes report slide positions and warns about saved references without definitions", () => {
    const report = { ...omit(pageIdentity(), "rows"), widgetGuids: [guid(601), guid(699)],
      widgets: { [guid(501)]: { ...textCard(guid(501), "Overview"), widgetGuid: guid(601), defaultTitle: "Summary" }, [guid(502)]: tableCard(guid(502)) },
      layout: { id: guid(1200), type: "REPORT", areas: { main: [
        { id: guid(1201), type: "SLIDE", title: "Overview", orientation: "LANDSCAPE", contextOptions: [], areas: { main: [
          { id: guid(501), type: "TEXT", position: { x: 10, y: 20, width: 400, height: 100, rotation: 0 } }] } },
        { id: guid(1202), type: "SLIDE", title: "Detail", orientation: "PORTRAIT", contextOptions: [option(LIST)], areas: {
          main: [{ id: guid(502), type: "TABLE", position: { x: 0, y: 0, width: 800, height: 400 }, locked: true }],
          expanded: [{ id: guid(502), type: "TABLE" }] } },
      ] } } };
    const result = describePageCards("REPORT", report);
    expect(card(result, guid(501))).toMatchObject({ title: "Summary", hasSavedWidgetReference: true, placement: { kind: "report", slideId: guid(1201), slideIndex: 0,
      slideTitle: "Overview", position: { x: 10, y: 20, width: 400, height: 100, rotation: 0 } } });
    expect(card(result, guid(502)).placement).toEqual({ kind: "report", slideId: guid(1202), slideIndex: 1, slideTitle: "Detail",
      position: { x: 0, y: 0, width: 800, height: 400 }, locked: true });
    expect(result.pageContext.slides).toEqual([
      { id: guid(1201), index: 0, type: "SLIDE", title: "Overview", orientation: "LANDSCAPE", cardCount: 1 },
      { id: guid(1202), index: 1, type: "SLIDE", title: "Detail", orientation: "PORTRAIT", cardCount: 1, contextSelectors: [
        { dimension: ref("dimension", LIST), visible: false, syncedToPage: true, editable: false, enableMultiSelect: false, syncOnSelection: true }] },
    ]);
    expect(result.warnings).toEqual(["1 saved widget reference(s) have no inline definition and are not described."]);
  });

  it("reports unknown card types and unknown nested fields without throwing", () => {
    const gantt = { type: "GANTT", clientGuid: guid(801), defaultTitle: "Timeline", widgetDataSources: [{ dataSourceId: MODULE, dataSourceType: "FUTURE_SOURCE", extra: 1 }],
      ganttConfig: { startLineItemId: LI(1), nested: { deep: [1, 2] } }, futureFlag: true, apiToken: TOKEN, longNote: "x".repeat(300) };
    const native = { ...pageIdentity(), widgets: { [guid(801)]: gantt, [guid(802)]: textCard(guid(802)) }, layout: boardLayout([
      row(3000, 240, [{ type: "FUTURE_CONTAINER", id: guid(3001), areas: { cards: [{ type: "GANTT", id: guid(801), height: 240 }] } },
        { type: "FUTURE_SPACER", id: guid(3002), areas: null }, { type: "TABLE", id: guid(3003), height: 100 }]),
    ]) };
    const result = describePageCards("BOARD", native);
    const detail = card(result, guid(801));
    expect(detail).toMatchObject({ type: "GANTT", title: "Timeline", sources: [{ dataSourceType: "FUTURE_SOURCE" }],
      placement: { kind: "board", area: "main", rowId: guid(3000), rowIndex: 0, rowHeight: 240, height: 240 } });
    expect(detail.unrecognised).toEqual([
      { path: "widgetDataSources[0].dataSourceId", valueType: "string", value: MODULE },
      { path: "widgetDataSources[0].extra", valueType: "number", value: 1 },
      { path: "ganttConfig.startLineItemId", valueType: "string", value: LI(1) },
      { path: "ganttConfig.nested.deep[0]", valueType: "number", value: 1 },
      { path: "ganttConfig.nested.deep[1]", valueType: "number", value: 2 },
      { path: "futureFlag", valueType: "boolean", value: true },
      { path: "apiToken", valueType: "string", value: "[redacted]" },
      { path: "longNote", valueType: "string" },
    ]);
    expect(card(result, guid(802)).placement).toEqual({ kind: "unplaced" });
    expect(result.warnings).toEqual([
      `1 card(s) are not placed in the layout: ${guid(802)}.`,
      `1 layout card(s) have no widget definition: ${guid(3003)}.`,
      "Unrecognised layout node types (traversed where they have areas): FUTURE_CONTAINER, FUTURE_SPACER.",
    ]);
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });

  it("caps unrecognised entries per card with a note", () => {
    const noisy = { ...textCard(guid(810)), future: Array.from({ length: 70 }, (_, index) => index + 1) };
    const result = describePageCards("BOARD", boardOf(noisy));
    expect(card(result, guid(810)).unrecognised).toHaveLength(60);
    expect(card(result, guid(810)).unrecognisedOmitted).toBe(10);
    expect(result.warnings).toEqual([`Card ${guid(810)}: 10 further unrecognised fields were omitted.`]);
  });

  it("warns about malformed chart, text, customization and action JSON and keeps valid chart references", () => {
    const brokenChart = { ...common(guid(901), "COMBOCHART", ""), chartConfig: "{not json", widgetDataSources: [{ dataSourceId: MODULE, dataSourceType: "CLASSIC" }] };
    const chart = { ...common(guid(902), "COMBOCHART", ""), dataSourceId: MODULE, widgetDataSources: [{ dataSourceId: MODULE, dataSourceType: "CLASSIC" }],
      chartConfig: JSON.stringify({ chartType: "linechart", series: [{ lineItemId: LI(1), moduleId: MODULE, color: "#123456" }], showDataLabels: true,
        globalSeriesOptions: { lineWidth: 2 } }), branchSync: JSON.stringify([{ dimensionId: LIST, enabled: true }]) };
    const brokenText = { ...textCard(guid(903)), text: "{\"blocks\": [" };
    const legacyText = { ...textCard(guid(904)), version: 1, text: "Plain legacy text" };
    const brokenGrid = { ...tableCard(guid(905)), customizations: "{oops", styleConfig: "not json" };
    const brokenAction = { ...omit(actionCard(), "actionButtons"), clientGuid: guid(906), actions: `[{"id": "1120", "actionToken": "${TOKEN}"` };
    const result = describePageCards("BOARD", boardOf(brokenChart, chart, brokenText, legacyText, brokenGrid, brokenAction));
    expect(card(result, guid(901)).chart).toBeUndefined();
    expect(card(result, guid(901)).unrecognised).toEqual([{ path: "chartConfig", valueType: "string", value: "{not json" }]);
    expect(card(result, guid(902)).chart).toEqual({ chartType: "linechart", series: [{ lineItem: ref("lineItem", LI(1), { moduleId: MODULE }), module: ref("module", MODULE),
      color: "#123456" }], settings: { showDataLabels: true } });
    expect(card(result, guid(902)).unrecognised).toEqual([{ path: "chartConfig.globalSeriesOptions.lineWidth", valueType: "number", value: 2 }]);
    expect(card(result, guid(902)).savedCustomizations).toEqual({ branchSync: [{ dimension: ref("dimension", LIST), enabled: true }] });
    expect(card(result, guid(903)).text).toBeUndefined();
    expect(card(result, guid(904)).text).toEqual({ plainText: "Plain legacy text", styles: [], hasDynamicContent: false });
    expect(card(result, guid(906)).actions).toBeUndefined();
    expect(result.warnings).toEqual([
      `Card ${guid(901)}: chartConfig is not a valid JSON object.`,
      `Card ${guid(903)}: text is not valid Draft.js content.`,
      `Card ${guid(905)}: customizations is not valid JSON.`,
      `Card ${guid(905)}: styleConfig is not a valid JSON object.`,
      `Card ${guid(906)}: actions is not a valid JSON list; it was not described.`,
    ]);
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });

  it("describes KPI and field cards with deduplicated references", () => {
    const kpi = { ...kpiCard(guid(111)), conditionalFormatting: { thresholds: [{ value: 10, color: "#00FF00" }], enabled: true } };
    const field = { ...common(guid(112), "FIELD", ""), horizontalLayout: true,
      fields: [{ moduleId: MODULE, lineItemId: LI(1), label: "Units" }, { moduleId: MODULE_2, lineItemId: LI(2) }],
      widgetDataSources: [{ dataSourceId: MODULE, dataSourceType: "LINE_ITEM", subEntityId: LI(1) }, { dataSourceId: MODULE_2, dataSourceType: "LINE_ITEM", subEntityId: LI(2) }] };
    const dynamicText = { ...textCard(guid(113)), text: draft("Units: ", "normal", { 0: { type: "LINEITEMVALUE", data: { id: LI(1) } } }), dataSourceId: MODULE,
      widgetDataSources: [{ dataSourceId: MODULE, dataSourceType: "LINE_ITEM", subEntityId: LI(1) }] };
    const result = describePageCards("BOARD", boardOf(kpi, field, dynamicText));
    expect(card(result, guid(111))).toMatchObject({
      sources: [{ dataSourceType: "LINE_ITEM", module: ref("module", MODULE), lineItem: ref("lineItem", LI(1), { moduleId: MODULE }) }],
      kpi: { module: ref("module", MODULE), lineItem: ref("lineItem", LI(1), { moduleId: MODULE }), textStyle: "heading1", paddingStyle: "standard",
        numberScale: "NONE", showSparkline: true },
      conditionalFormatting: [{ type: "CARD_LEVEL", enabled: true, config: { thresholds: [{ value: 10, color: "#00FF00" }] } }],
    });
    expect(card(result, guid(111)).settings).not.toHaveProperty("textStyle");
    expect(card(result, guid(112)).fields).toEqual([
      { module: ref("module", MODULE), lineItem: ref("lineItem", LI(1), { moduleId: MODULE }), label: "Units" },
      { module: ref("module", MODULE_2), lineItem: ref("lineItem", LI(2), { moduleId: MODULE_2 }) }]);
    expect(card(result, guid(112)).settings).toMatchObject({ horizontalLayout: true });
    expect(card(result, guid(113)).text).toEqual({ plainText: "Units: ", styles: ["normal"], hasDynamicContent: true, entityTypes: ["LINEITEMVALUE"] });
    expect(result.references).toEqual([ref("module", MODULE), ref("lineItem", LI(1), { moduleId: MODULE }), ref("module", MODULE_2),
      ref("lineItem", LI(2), { moduleId: MODULE_2 })]);
  });

  it("describes KPI flat formatting and indicators, field formats, ADQ-backed charts and source-less text", () => {
    const flatCf = { cfTargetIdentifier: "", cfSourceIdentifier: "", cfMinValue: "", cfMinColor: "", cfMidValue: "", cfMidColor: "", cfMaxValue: "", cfMaxColor: "" };
    const kpi = { ...omit(kpiCard(guid(141)), "pageLinkType"), ...flatCf, contextOptions: [option(LINE_ITEMS, { scope: MODULE, resolutionPolicy: "any", syncedToPage: false })],
      showSparklineTooltips: true, sparklineTimePeriod: "", sparklineColor: "#3C67EA", sparklineColorTheme: "", textColor: "", textColorTheme: "",
      cfTargetIdentifier: LI(1), cfSourceIdentifier: LI(2), cfMinValue: "0", cfMinColor: "#FF0000", cfMaxValue: "100", cfMaxColor: "#00FF00",
      config: { conditionalFormatting: { targets: ["INDICATOR"] }, iconIndicatorType: "THRESHOLD",
        trendIndicatorConfig: { referenceLineItemId: LI(3), showReferenceLineItem: true, icons: { greaterThanReferenceIcon: "up", lessThanReferenceIcon: "down", equalToReferenceIcon: "flat" } },
        thresholdIndicatorConfig: { icons: [{ index: 0, iconId: "icon-a" }, { index: 1, iconId: "icon-b" }] } } };
    const plainKpi = { ...kpiCard(guid(142)), ...flatCf, config: { conditionalFormatting: { targets: [] }, iconIndicatorType: "NONE",
      trendIndicatorConfig: { referenceLineItemId: null, showReferenceLineItem: false } } };
    const field = { ...omit(common(guid(143), "FIELD", ""), "pageLinkType"), dataSourceId: "", horizontalLayout: false,
      fields: [{ moduleId: MODULE, lineItemId: LI(4), label: "Units", formatSpecificProperties: {} }, { moduleId: MODULE, lineItemId: LI(5), formatSpecificProperties: { decimalPlaces: 2 } }],
      widgetDataSources: [{ dataSourceId: MODULE, dataSourceType: "LINE_ITEM", subEntityId: LI(4) }] };
    const chartAdq = { id: ADQ_ID, version: 1, conditionalFormattingRules: [],
      regions: { SINGLE: { rows: axis([dim(LINE_ITEMS)]), columns: axis([dim(TIME, { levels: ["LEAF"] })]), moduleId: MODULE_2 } } };
    const chart = { ...common(guid(144), "COMBOCHART", guid(244)), dataSourceId: ADQ_ID, branchSync: "[]", widgetDataSources: adqSource(guid(244), chartAdq),
      chartConfig: JSON.stringify({ chartType: "combochart", isEditable: false, showTooltips: true, series: [] }) };
    const bareText = { ...omit(textCard(guid(145), "Note"), "pageLinkType"), widgetDataSources: [] };
    const result = describePageCards("BOARD", boardOf(kpi, plainKpi, field, chart, bareText));
    expect(result.warnings).toEqual([]);
    expect(result.cards.every(item => item.unrecognised === undefined)).toBe(true);
    expect(card(result, guid(141))).toMatchObject({
      kpi: { module: ref("module", MODULE), lineItem: ref("lineItem", LI(1), { moduleId: MODULE }), textStyle: "heading1", showSparklineTooltips: true, sparklineColor: "#3C67EA",
        indicator: { type: "THRESHOLD", targets: ["INDICATOR"], threshold: { icons: [{ index: 0, iconId: "icon-a" }, { index: 1, iconId: "icon-b" }] },
          trend: { showReferenceLineItem: true, icons: { greaterThanReferenceIcon: "up", lessThanReferenceIcon: "down", equalToReferenceIcon: "flat" },
            referenceLineItem: ref("lineItem", LI(3), { moduleId: MODULE }) } } },
      conditionalFormatting: [{ type: "CARD_LEVEL", source: ref("lineItem", LI(2), { moduleId: MODULE }), target: ref("lineItem", LI(1), { moduleId: MODULE }),
        pegs: [{ position: "min", value: 0, color: "#FF0000" }, { position: "max", value: 100, color: "#00FF00" }] }],
      contextSelectors: [{ dimension: ref("dimension", LINE_ITEMS), visible: false, syncedToPage: false, scope: ref("module", MODULE), resolutionPolicy: "any" }],
    });
    expect(card(result, guid(141)).kpi).not.toHaveProperty("sparklineTimePeriod");
    expect(card(result, guid(142)).conditionalFormatting).toBeUndefined();
    expect(card(result, guid(142)).kpi?.indicator).toEqual({ type: "NONE", trend: { showReferenceLineItem: false } });
    expect(card(result, guid(143)).fields).toEqual([{ module: ref("module", MODULE), lineItem: ref("lineItem", LI(4), { moduleId: MODULE }), label: "Units" },
      { module: ref("module", MODULE), lineItem: ref("lineItem", LI(5), { moduleId: MODULE }), formatSpecificProperties: { decimalPlaces: 2 } }]);
    expect(card(result, guid(144))).toMatchObject({ chart: { chartType: "combochart", settings: { isEditable: false, showTooltips: true } },
      sources: [{ dataSourceType: "MULTI_AXIS_DESCRIPTION", descriptionId: ADQ_ID, module: ref("module", MODULE_2) }],
      grid: { sections: [{ region: "SINGLE", module: ref("module", MODULE_2), order: 1 }],
        regions: [{ pivot: { rows: [ref("dimension", LINE_ITEMS)], columns: [ref("dimension", TIME)], pages: [] } }],
        summary: { hasFilters: false, hasSorts: false, hasHiddenItems: false, hasLevelSelection: true, hasConditionalFormatting: false } } });
    expect(card(result, guid(144))).not.toHaveProperty("savedCustomizations");
    expect(card(result, guid(145))).toMatchObject({ text: { plainText: "Note" } });
    expect(card(result, guid(145))).not.toHaveProperty("sources");
  });

  it("lists card-level bindings that no data source repeats and warns about foreign models", () => {
    const legacy = { ...common(guid(121), "TABLE", ""), dataSourceId: MODULE, modelId: "OTHER-MODEL" };
    const image = { ...imageCard(guid(122), "", LI(5)), widgetDataSources: [], sourceType: "direct", imageSource: "https://images.example.test/a/b.png?sig=abc#frag" };
    const result = describePageCards("BOARD", boardOf(legacy, image));
    expect(card(result, guid(121))).toMatchObject({ modelId: "OTHER-MODEL", sources: [{ dataSourceType: "CARD_LEVEL", module: ref("module", MODULE) }] });
    expect(card(result, guid(122)).sources).toEqual([{ dataSourceType: "CARD_LEVEL", module: ref("module", IMAGE_MODULE), lineItem: ref("lineItem", LI(5), { moduleId: IMAGE_MODULE }) }]);
    expect(card(result, guid(122)).image).toMatchObject({ sourceType: "direct", url: "https://images.example.test/a/b.png" });
    expect(result.warnings).toEqual([`Card ${guid(121)}: names another model; its references are resolved against the page model.`]);
  });

  it("describes page-level context selectors, default context and filter order", () => {
    const native = board();
    native.contextOptions = [option(LIST_3, { visible: true })];
    native.layout.defaultContext = [{ dimensionId: LIST_3, selectedItemId: ITEM(9) }];
    native.layout.contextFilterOrder = [LIST_3];
    const result = describePageCards("BOARD", native);
    expect(result.pageContext).toMatchObject({ contextSelectors: [{ dimension: ref("dimension", LIST_3), visible: true, syncedToPage: true }],
      defaultContext: [{ dimension: ref("dimension", LIST_3), selectedItemId: ITEM(9) }], contextFilterOrder: [LIST_3] });
    expect(referenceKeys(result)).toContain(`dimension:${LIST_3}:`);
    expect(result.warnings).toEqual([]);
  });

  it("warns about legacy rows, multi-model pages and unknown top-level fields", () => {
    const native = { ...board(), rows: [{ columns: [] }], modelCount: 2, futurePageSetting: { enabled: true } };
    const result = describePageCards("BOARD", native);
    expect(result.warnings).toEqual([
      "Page spans 2 models; references are resolved against the page model only.",
      "Legacy row-based board layout (1 rows) is not described; card placement may be incomplete.",
    ]);
    expect(result.pageContext.unrecognised).toEqual([{ path: "futurePageSetting.enabled", valueType: "boolean", value: true }]);
    expect(result.cards).toHaveLength(7);
  });

  it("rejects prototype keys, non-object roots, cycles, oversized nesting and missing identity", () => {
    errorCode(() => describePageCards("BOARD", { ...board(), extra: JSON.parse('{"__proto__":{"polluted":true}}') }), "UNSUPPORTED_DEFINITION");
    for (const root of [null, "page", [board()], 42]) errorCode(() => describePageCards("BOARD", root), "UNSUPPORTED_DEFINITION");
    const cyclic = board(); cyclic.self = cyclic;
    errorCode(() => describePageCards("BOARD", cyclic), "UNSUPPORTED_DEFINITION");
    errorCode(() => describePageCards("BOARD", { ...board(), invalid: Number.NaN }), "UNSUPPORTED_DEFINITION");
    let nested: unknown = {};
    for (let i = 0; i < 50; i++) nested = { child: nested };
    errorCode(() => describePageCards("BOARD", { ...board(), nested }), "DEFINITION_TOO_LARGE");
    for (const key of ["pageGuid", "appGuid", "name", "customerId", "workspaceId", "modelId"]) {
      const missing = board(); delete missing[key];
      errorCode(() => describePageCards("BOARD", missing), "UNSUPPORTED_DEFINITION");
      errorCode(() => describePageCards("BOARD", { ...board(), [key]: "" }), "UNSUPPORTED_DEFINITION");
    }
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("words each bounded-copy rejection and accepts shared and null-prototype objects", () => {
    for (const key of ["__proto__", "prototype", "constructor"]) {
      errorText(() => describePageCards("BOARD", { ...board(), extra: unsafeKey(key) }), "UNSUPPORTED_DEFINITION", UNSAFE_KEY);
    }
    for (const root of [null, "page", [board()], 42]) errorText(() => describePageCards("BOARD", root), "UNSUPPORTED_DEFINITION", "Page definition must be an object.");
    const cyclic = board(); cyclic.self = cyclic;
    errorText(() => describePageCards("BOARD", cyclic), "UNSUPPORTED_DEFINITION", "Cyclic page definition.");
    for (const invalid of [Number.NaN, Number.POSITIVE_INFINITY, undefined, 1n, () => 1]) {
      errorText(() => describePageCards("BOARD", { ...board(), invalid }), "UNSUPPORTED_DEFINITION", "Page definitions must contain only JSON values.");
    }
    errorText(() => describePageCards("BOARD", undefined), "UNSUPPORTED_DEFINITION", "Page definitions must contain only JSON values.");
    for (const instance of [new Date(0), new Map(), new (class Page {})()]) {
      errorText(() => describePageCards("BOARD", { ...board(), instance }), "UNSUPPORTED_DEFINITION", "Unexpected object prototype.");
    }
    // The same object in two places is not a cycle.
    const shared = { enabled: true };
    const result = describePageCards("BOARD", Object.assign(Object.create(null), board(), { first: shared, second: shared }));
    expect(result.cards).toHaveLength(7);
    expect(result.pageContext.unrecognised).toEqual([{ path: "first.enabled", valueType: "boolean", value: true }, { path: "second.enabled", valueType: "boolean", value: true }]);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("bounds the copy at 40 nested levels and 150,000 values", () => {
    // The page is level 0 and `nested` level 1.
    expect(describePageCards("BOARD", { ...board(), nested: chain(39) }).cards).toHaveLength(7);
    errorText(() => describePageCards("BOARD", { ...board(), nested: chain(40) }), "DEFINITION_TOO_LARGE", TRAVERSAL_BOUND);
    // The page and the list are two values. A copy within the bound goes on to the identity check.
    errorText(() => describePageCards("BOARD", { list: new Array(149_998).fill(0) }), "UNSUPPORTED_DEFINITION", NO_IDENTITY);
    errorText(() => describePageCards("BOARD", { list: new Array(149_999).fill(0) }), "DEFINITION_TOO_LARGE", TRAVERSAL_BOUND);
  });

  it("stops at 8,000,000 string characters during the copy, before a later fault, and bounds the serialized size", () => {
    errorText(() => describePageCards("BOARD", { ...board(), big: "x".repeat(8_000_001) }), "DEFINITION_TOO_LARGE", CHARACTER_BOUND);
    // Strings are counted as they are copied, so an oversized string wins over an unsafe key that follows it.
    errorText(() => describePageCards("BOARD", { big: "x".repeat(8_000_001), extra: unsafeKey() }), "DEFINITION_TOO_LARGE", CHARACTER_BOUND);
    errorText(() => describePageCards("BOARD", { first: "x".repeat(4_000_000), second: "x".repeat(4_000_001), extra: unsafeKey() }), "DEFINITION_TOO_LARGE", CHARACTER_BOUND);
    errorText(() => describePageCards("BOARD", { big: "x".repeat(8_000_000), extra: unsafeKey() }), "UNSUPPORTED_DEFINITION", UNSAFE_KEY);
    // Escaping doubles these characters only when serialized: the copy completes and the final bound applies.
    errorText(() => describePageCards("BOARD", { quotes: '"'.repeat(4_500_000), extra: unsafeKey() }), "UNSUPPORTED_DEFINITION", UNSAFE_KEY);
    errorText(() => describePageCards("BOARD", { quotes: '"'.repeat(4_500_000) }), "DEFINITION_TOO_LARGE", CHARACTER_BOUND);
    // {"big":"..."} serializes to the string's length plus 10.
    errorText(() => describePageCards("BOARD", { big: "x".repeat(7_999_990) }), "UNSUPPORTED_DEFINITION", NO_IDENTITY);
    errorText(() => describePageCards("BOARD", { big: "x".repeat(7_999_991) }), "DEFINITION_TOO_LARGE", CHARACTER_BOUND);
  });

  it("treats unsafe keys inside embedded JSON as malformed rather than throwing", () => {
    const chart = { ...common(guid(131), "COMBOCHART", ""), chartConfig: '{"chartType":"bar","__proto__":{"polluted":true}}' };
    const result = describePageCards("BOARD", boardOf(chart));
    expect(card(result, guid(131)).chart).toBeUndefined();
    expect(result.warnings).toEqual([`Card ${guid(131)}: chartConfig is not a valid JSON object.`]);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("applies the copy's key, nesting and value bounds to embedded JSON", () => {
    const chartWith = (chartConfig: string) => describePageCards("BOARD", boardOf({ ...common(guid(131), "COMBOCHART", ""), chartConfig }));
    const malformed = [`Card ${guid(131)}: chartConfig is not a valid JSON object.`];
    for (const key of ["prototype", "constructor"]) expect(chartWith(`{"chartType":"bar","${key}":{}}`).warnings).toEqual(malformed);
    // The config is level 0 and `deep` level 1.
    const nested = chartWith(JSON.stringify({ chartType: "bar", deep: chain(39) }));
    expect(card(nested, guid(131)).chart).toEqual({ chartType: "bar" });
    expect(nested.warnings).toEqual([]);
    expect(chartWith(JSON.stringify({ chartType: "bar", deep: chain(40) })).warnings).toEqual(malformed);
    // The config, its chart type and the series list are three values.
    const series = (length: number) => JSON.stringify({ chartType: "bar", series: new Array(length).fill(0) });
    expect(chartWith(series(149_997)).warnings).toEqual([]);
    expect(chartWith(series(149_998)).warnings).toEqual(malformed);
  });
});

describe("Saved-view grids and non-model action buttons (shapes observed 27 Sep 2026)", () => {
  // A saved view ID has no module prefix (102); the module's own ID is its default view.
  const SAVED_VIEW = "1321000000901";
  const classicSource = (widgetGuid: string, dataSourceId: string) => [{ widgetGuid, dataSourceId, subEntityId: "", dataSourceType: "CLASSIC",
    axisDescriptionQuery: null, viewDescription: null }];
  const classicGrid = (id: string, dataSourceId: string): Obj => ({ ...common(id, "TABLE", guid(240)), dataSourceId, branchSync: "", isReadOnly: true,
    pivotEnabled: true, styleConfig: JSON.stringify({ themeId: "Base" }), widgetDataSources: classicSource(guid(240), dataSourceId) });

  it("reads a CLASSIC source as a saved view unless its ID has the module prefix", () => {
    const result = describePageCards("BOARD", boardOf(classicGrid(guid(140), SAVED_VIEW), classicGrid(guid(141), MODULE)));
    expect(card(result, guid(140)).sources).toEqual([{ dataSourceType: "CLASSIC", view: ref("view", SAVED_VIEW) }]);
    expect(card(result, guid(141)).sources).toEqual([{ dataSourceType: "CLASSIC", module: ref("module", MODULE) }]);
    expect(referenceKeys(result)).toEqual(expect.arrayContaining([`view:${SAVED_VIEW}:`, `module:${MODULE}:`]));
    expect(referenceKeys(result)).not.toContain(`module:${SAVED_VIEW}:`);
    expect(result.warnings).toEqual([]);
  });

  it("classifies custom views, saved views, module views and combined grids", () => {
    // Two sections side by side, sharing the row axis: the shape of a real combined grid.
    const childAxis = (dimensionId: string) => ({ dimensions: [dim(dimensionId)], filters: { rootNode: branch("AND", []) }, raggedShows: [], raggedHides: [] });
    const combinedAdq = { id: guid(950), version: 2, rowAxis: { childAxes: { "row-0": childAxis(LIST) } },
      columnAxis: { childAxes: { "col-0": childAxis(TIME), "col-1": childAxis(LINE_ITEMS) } },
      regions: [{ moduleId: MODULE, regionType: "DATA", id: "SINGLE", offAxisDimensions: [], columnAxisKey: "col-0", rowAxisKey: "row-0" },
        { moduleId: MODULE_2, regionType: "DATA", id: guid(951), offAxisDimensions: [], columnAxisKey: "col-1", rowAxisKey: "row-0" }],
      conditionalFormattingRules: [] };
    const combined = { ...common(guid(142), "TABLE", guid(242)), defaultTitle: "Combined grids", dataSourceId: guid(950),
      widgetDataSources: [{ widgetGuid: guid(242), dataSourceId: guid(950), subEntityId: "", dataSourceType: "MULTI_AXIS_DESCRIPTION",
        axisDescriptionQuery: combinedAdq, viewDescription: null }] };
    const result = describePageCards("BOARD", boardOf(tableCard(), classicGrid(guid(140), SAVED_VIEW), classicGrid(guid(141), MODULE), combined, kpiCard()));
    expect([guid(104), guid(140), guid(141), guid(142), guid(107)].map(id => card(result, id).viewType))
      .toEqual(["customView", "savedView", "moduleView", "combinedGrid", undefined]);
    const grid = card(result, guid(142)).grid!;
    expect(grid.sections.map(section => section.module?.id)).toEqual([MODULE, MODULE_2]);
    expect(grid.regions.map(region => [region.pivot.rows.map(ref => ref.id), region.pivot.columns.map(ref => ref.id)]))
      .toEqual([[[LIST], [TIME]], [[LIST], [LINE_ITEMS]]]);
    expect(result.warnings).toEqual([]);
  });

  it("names non-model action buttons from the card and leaves model actions to name resolution", () => {
    const buttons = [
      { ...button, id: "116000000901", type: "EXPORT", name: "Export orders" },
      { ...button, id: "3e56872f0775444b9a064bf3355649ff", type: "FORECASTER", name: "Demand forecaster" },
      { ...button, id: guid(77), type: "WORKFLOW_TEMPLATE", name: "Month-end review" },
    ];
    const writeback = { ...button, id: guid(78), type: "WRITEBACK", name: "Approve plan", moduleId: MODULE, lineItemId: LI(9) };
    const action = { ...actionCard(), actions: JSON.stringify(buttons.map(({ id, name, type }) => ({ id, name, type }))), actionButtons: buttons, widgetDataSources: [] };
    const result = describePageCards("BOARD", boardOf(action));
    expect(card(result, guid(102)).actions?.map(item => item.action)).toEqual([
      ref("action", "116000000901", { actionType: "EXPORT" }),
      ref("action", "3e56872f0775444b9a064bf3355649ff", { actionType: "FORECASTER", name: "Demand forecaster" }),
      ref("action", guid(77), { actionType: "WORKFLOW_TEMPLATE", name: "Month-end review" }),
    ]);
    expect(card(result, guid(102)).actions?.map(item => item.name)).toEqual(["Export orders", "Demand forecaster", "Month-end review"]);
    expect(JSON.stringify(result)).not.toContain(TOKEN);
    expect(result.warnings).toEqual([]);
    // Writeback (and notification) buttons name the line item they write to.
    const withWriteback = describePageCards("BOARD", boardOf({ ...actionCard(), actions: JSON.stringify([writeback]), actionButtons: [writeback] }));
    const described = card(withWriteback, guid(102));
    expect(described.actions?.[0]).toMatchObject({ action: ref("action", guid(78), { actionType: "WRITEBACK", name: "Approve plan" }),
      module: ref("module", MODULE), lineItem: ref("lineItem", LI(9), { moduleId: MODULE }) });
    expect(described.unrecognised ?? []).toEqual([]);
    expect(referenceKeys(withWriteback)).toEqual(expect.arrayContaining([`lineItem:${LI(9)}:${MODULE}`]));
  });
});
