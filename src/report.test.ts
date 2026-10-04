import { describe, expect, it } from "vitest";
import { describePageCards } from "./card-reader/card-details.js";
import { nameCardDetails } from "./card-reader/card-naming.js";
import { addDerivedContextSelectors, gridNeeds } from "./analyse.js";
import { addActions, addLineItems, addLists, addModuleDimensions, addModuleViews, addSelections, emptyCatalog, resolveFromCatalog } from "./catalog.js";
import { buildReport, HEADERS, type PageInput, type TabName } from "./report.js";
import { toCsv } from "./zip.js";

// Synthetic IDs and names only, shaped like a captured board (see card-details.test.ts).
type Obj = Record<string, any>;
const guid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const [MODULE, MODULE_2, OWNER, LIST, LIST_2, VIEW] = ["102000000901", "102000000902", "102000000903", "101000000901", "101000000902", "130000000901"];
const LI = (n: number) => `19010000000${String(n).padStart(2, "0")}`;
const [TIME, LINE_ITEMS] = ["20000000003", "20000000012"];
const TOKEN = "fake-token-value";
const FORECASTER = "0123456789abcdef0123456789abcdef";

const common = (n: number, type: string): Obj => ({ type, customerId: "customer-1", defaultTitle: "", description: "", pageLinkType: "title", pageType: "NONE",
  contextOptions: [], clientGuid: guid(n), widgetGuid: guid(n + 100), version: 1, widgetActions: [], isTargetPagePublished: false, showCommenting: true,
  showMaximize: true, showBackground: true, validVersions: [1], widgetStyles: { titleColor: null, titleColorTheme: null, contextColor: null,
    contextColorTheme: null, contextPlacement: "BOTTOM", backgroundOptions: { backgroundColor: "#FFFFFF" } } });
const grid = (n: number, title: string, sources: Obj[]): Obj => ({ ...common(n, "TABLE"), defaultTitle: title, branchSync: "[]", defaultColumnWidth: "",
  defaultColumnLabelHeight: "", gridColumnWidths: [], lineItemWidthOverrides: [], isReadOnly: true, pivotEnabled: true, customizations: "", lineItemConfigs: "",
  csvExportEnabled: true, allowFiltering: true, allowSorting: true, styleConfig: JSON.stringify({ themeId: "Base" }), showListFunctions: false, allowCopyAcross: true,
  allowCopyDown: true, allowCellHistory: true, allowExpandOrCollapseRows: false, allowChartCreation: true, allowZeroSuppression: true, timeDimensionWidthOverrides: {},
  widgetDataSources: sources.map(source => ({ widgetGuid: guid(n + 100), subEntityId: "", axisDescriptionQuery: null, viewDescription: null, ...source })) });
const dim = (id: string, extra: Obj = {}) => ({ id, levels: [], sorts: [], totalsPosition: "AFTER", shows: [], hides: [], reorder: [], ...extra });
const leaf = (selectedItems: string[], operator = "NOT_EQUALS", values = ["0"]) => ({ type: "LEAF", rule: { selectedItems, operator, values, identifier: "", axisKey: null } });
const branch = (nodes: unknown[], operator = "AND") => ({ type: "BRANCH", operator, nodes });
const axis = (dimensions: unknown[], nodes: unknown[] = []) => ({ dimensions, filters: { rootNode: branch(nodes) }, raggedShows: [], raggedHides: [] });
const rule = (type: string, lineItem: string, targetRegionId: string | null = null) => ({ targetIdentifier: lineItem, sourceIdentifier: lineItem, type, targetRegionId,
  pegs: [{ value: 0, color: "#FFFFFF" }, { value: 100000, color: "#627786" }], targetRegionCoordinates: null, valuesRegionCoordinates: null });

const button = (id: string, type: string, name: string, extra: Obj = {}) => ({ id, type, name, style: null, runAutomatically: null, actionDriverId: null,
  destinationListId: null, disableCancelButton: false, actionToken: TOKEN, description: null, ...extra });
const buttons = [button("112000000901", "IMPORT", "Reload plan"), button(FORECASTER, "FORECASTER", "Forecast demand"),
  button("118000000901", "PROCESS", "Run nightly", { runAutomatically: false, disableCancelButton: true })];
const actionCard = { ...common(1, "ACTION"), actionWidgetStyle: { layoutType: "BUTTON" }, actions: JSON.stringify(buttons), actionButtons: buttons,
  widgetDataSources: [{ widgetGuid: guid(101), dataSourceId: "", subEntityId: "", dataSourceType: "CLASSIC", axisDescriptionQuery: null, viewDescription: null }] };
const customView = grid(2, "Demand by brand", [{ dataSourceId: guid(900), dataSourceType: "MULTI_AXIS_DESCRIPTION", axisDescriptionQuery: { id: guid(900), version: 1,
  regions: { SINGLE: { moduleId: MODULE, rows: axis([dim(LIST)], [branch([leaf([LIST_2, LI(9)])])]), columns: axis([dim(TIME, { levels: ["LEAF"] })]) } },
  conditionalFormattingRules: [rule("SLOT", LI(2))] } }]);
const savedView = grid(3, "", [{ dataSourceId: VIEW, dataSourceType: "CLASSIC" }]);
const combined = grid(4, "Plan and factors", [{ dataSourceId: guid(901), dataSourceType: "MULTI_AXIS_DESCRIPTION", axisDescriptionQuery: { id: guid(901), version: 2,
  rowAxis: { childAxes: { "row-0": axis([dim(LIST)], [leaf([LI(1)], "EQUALS", ["true"])]) } },
  columnAxis: { childAxes: { "col-0": axis([dim(TIME)]), "col-1": axis([dim(LINE_ITEMS)]) } },
  regions: [{ moduleId: MODULE, regionType: "DATA", id: "SINGLE", offAxisDimensions: [], rowAxisKey: "row-0", columnAxisKey: "col-0" },
    { moduleId: MODULE_2, regionType: "DATA", id: guid(902), offAxisDimensions: [], rowAxisKey: "row-0", columnAxisKey: "col-1" }],
  conditionalFormattingRules: [rule("BG_COLOR", LI(8), guid(902))] } }]);

const cards = [actionCard, customView, savedView, combined];
const column = (n: number, card: Obj) => ({ type: "BOARD_COLUMN", id: guid(n), columnStart: 0, columnEnd: 12,
  areas: { cards: [{ type: card.type, id: card.clientGuid, height: 240 }] } });
const native: Obj = {
  pageGuid: guid(1000), categoryGuid: guid(1001), appGuid: guid(1002), customerId: "customer-1", name: "Synthetic demand board", workspaceId: "workspace-1",
  modelId: "MODEL-1", rows: [], contextOptions: [], isMyPage: false, modelStatus: "UNLOCKED", modelInfos: [{ workspaceId: "workspace-1", modelId: "MODEL-1" }],
  modelCount: 1, currentDraftVersionGuid: guid(1003), currentPublishedVersionGuid: guid(1003), publishedAt: 1_790_000_000_000, updatedAt: 1_790_000_000_000,
  isAlm: false, categoryUpdatedAt: null, restrictions: [],
  layout: { id: guid(1100), type: "BOARD", version: 2, syncScroll: [], syncBrowser: false, defaultContext: [], contextFilterOrder: [],
    commentSummary: true, commenting: true, openInsightsPanelByDefault: true,
    areas: { main: [{ type: "BOARD_CONTENT", id: guid(1101), areas: { sections: [{ type: "BOARD_SECTION", id: guid(1102), areas: {
      rows: cards.map((card, index) => ({ id: guid(1200 + index * 10), type: "BOARD_ROW", height: 240, padding: "small", areas: { columns: [column(1201 + index * 10, card)] } })) } }] } }],
    sidepanel: [], expanded: [] } },
  widgets: Object.fromEntries(cards.map(card => [card.clientGuid, card])),
};

function catalog() {
  const result = emptyCatalog();
  addModuleViews(result, { data: [{ id: MODULE, name: "Demand", views: [] }, { id: MODULE_2, name: "Factors", views: [] },
    { id: OWNER, name: "Order summary", views: [{ viewId: VIEW, viewName: "Exceptions view", default: false }] }], dimensions: { [TIME]: { label: "Time" } } });
  addLists(result, { data: [{ id: LIST, name: "Product" }, { id: LIST_2, name: "Territory" }] });
  addLineItems(result, MODULE, { data: [{ lineItemId: LI(1), lineItemLabel: "Show?" }, { lineItemId: LI(2), lineItemLabel: "Volume" }] });
  addLineItems(result, MODULE_2, { data: [{ lineItemId: LI(8), lineItemLabel: "Factor" }, { lineItemId: LI(9), lineItemLabel: "Territory demand" }] });
  addActions(result, "imports", { imports: [{ id: "112000000901", name: "Import demand (model name)" }] });
  return result;
}

function report() {
  const details = describePageCards("BOARD", structuredClone(native));
  const named = nameCardDetails(details, resolveFromCatalog(details.references, catalog()));
  const input: PageInput = { appName: "Planning app", categoryName: "Demand", pageName: "Synthetic demand board", pageType: "BOARD",
    state: "Published (no unpublished changes)", modelName: "Model one", workspaceName: "Workspace one", publishedAt: native.publishedAt,
    pageGuid: guid(1000), appGuid: guid(1002), modelId: "MODEL-1", details: named };
  const unpublished: PageInput = { ...input, pageName: "Draft page", state: "Not published", details: undefined, publishedAt: undefined };
  return buildReport([input, unpublished]);
}
const column_ = (tab: TabName, header: string) => HEADERS[tab].indexOf(header);
const rowsOf = (tab: TabName, ...headers: string[]) => report()[tab].rows.map(row => headers.map(header => row[column_(tab, header)]));

// A second board with the other card kinds: a KPI with an indicator, flat formatting and a title link, two fields, an image
// bound to a line item, a text card whose title links to the first board, a sorted grid, a module's default view and more
// buttons. The KPI is placed right of the field card in the same row, so it is numbered after it.
const kpi = { ...common(11, "CARD"), defaultTitle: "Total volume", textStyle: "LARGE", numberScale: "THOUSANDS", showSparkline: true,
  config: { iconIndicatorType: "THRESHOLD", thresholdIndicatorConfig: { icons: [{ iconId: "ARROW_UP" }, { iconId: "FLAG_RED" }, { iconId: "ARROW_UP" }] } },
  cfSourceIdentifier: LI(1), cfTargetIdentifier: LI(2), cfMinValue: "0", cfMinColor: "#FFFFFF", cfMaxValue: 1500.5, cfMaxColor: "#627786",
  pageIdentifier: guid(1000), pageType: "BOARD", isTargetPagePublished: true,
  widgetDataSources: [{ widgetGuid: guid(111), dataSourceId: MODULE, subEntityId: LI(2), dataSourceType: "LINE_ITEM", axisDescriptionQuery: null, viewDescription: null }] };
const fieldCard = { ...common(12, "FIELD"), defaultTitle: "Plan inputs",
  fields: [{ moduleId: MODULE, lineItemId: LI(1), label: "Show?" }, { moduleId: MODULE_2, lineItemId: LI(8), label: "Factor" }] };
const imageCard = { ...common(13, "IMAGE"), sourceType: "LINE_ITEM", dataSourceId: MODULE_2, lineItemId: LI(9), scaleType: "FIT", imageName: "",
  imageAlign: "CENTER", opacity: 1, imageSource: "" };
const textCard = { ...common(14, "TEXT"), text: "Review the plan before Friday.", pageIdentifier: guid(1000), pageType: "BOARD", isTargetPagePublished: true };
const sorted = { ...grid(15, "Ranked demand", [{ dataSourceId: guid(910), dataSourceType: "MULTI_AXIS_DESCRIPTION", axisDescriptionQuery: { id: guid(910), version: 1,
  regions: { SINGLE: { moduleId: MODULE,
    rows: axis([dim(LIST, { sorts: [{ selectedItems: [LI(2)], direction: "DESC" }], shows: ["201000000001"] }), dim(LINE_ITEMS, { hides: [LI(1)] })]),
    columns: axis([dim(TIME)], [branch([leaf([LI(2)], "GREATER_THAN", ["1500.5"]), branch([leaf([LI(1)], "EQUALS", ["true"]), leaf([LI(2)], "IS_BLANK", [])])], "OR")]) } },
  conditionalFormattingRules: [rule("FONT", LI(2))] } }]), contextOptions: [{ dimensionId: LIST_2, visible: false, syncedToPage: true }] };
const defaultView = grid(16, "Factors", [{ dataSourceId: MODULE_2, dataSourceType: "CLASSIC" }]);
const moreButtons = [button("116000000901", "EXPORT", "Send plan", { runAutomatically: true }), button("118000000902", "PROCESS", "Run weekly"),
  button(guid(990), "NAVIGATION", "Open review"), button("119000000901", "CUSTOM_STEP", "Custom step")];
const moreActions = { ...common(17, "ACTION"), actionWidgetStyle: { layoutType: "BUTTON" }, actions: JSON.stringify(moreButtons), actionButtons: moreButtons };
const placed = (n: number, card: Obj, columnStart: number) => ({ type: "BOARD_COLUMN", id: guid(n), columnStart, columnEnd: columnStart + 6,
  areas: { cards: [{ type: card.type, id: card.clientGuid, height: 240 }] } });
const boardRow = (n: number, columns: Obj[]) => ({ id: guid(n), type: "BOARD_ROW", height: 240, padding: "small", areas: { columns } });
const kpiBoard: Obj = { ...native, pageGuid: guid(1010), name: "Synthetic KPI board",
  layout: { ...native.layout, id: guid(1110), areas: { main: [{ type: "BOARD_CONTENT", id: guid(1111), areas: { sections: [{ type: "BOARD_SECTION", id: guid(1112), areas: {
    rows: [boardRow(1300, [placed(1301, kpi, 6), placed(1302, fieldCard, 0)]),
      ...[imageCard, textCard, sorted, defaultView, moreActions].map((card, index) => boardRow(1310 + index * 10, [placed(1311 + index * 10, card, 0)]))] } }] } }],
    sidepanel: [], expanded: [] } },
  widgets: Object.fromEntries([kpi, fieldCard, imageCard, textCard, sorted, defaultView, moreActions].map(card => [card.clientGuid, card])) };

/** Both boards and the draft page, named as analyseApp names them: catalog names, then the context selectors the model adds. */
function fullReport() {
  const names = catalog();
  addSelections(names, { data: [{ itemId: "201000000001", label: "North" }] });
  addModuleDimensions(names, { modules: { [MODULE]: { dimensions: [{ id: LIST, label: "Product" }, { id: LIST_2, label: "Territory" }, { id: TIME, label: "Time" }] } } });
  names.pages.set(guid(1000), "Synthetic demand board");
  const named = (page: Obj) => {
    const details = describePageCards("BOARD", structuredClone(page));
    return addDerivedContextSelectors(nameCardDetails(details, resolveFromCatalog(details.references, names)), names);
  };
  const base = { appName: "Planning app", categoryName: "Demand", pageType: "BOARD", modelName: "Model one", workspaceName: "Workspace one", appGuid: guid(1002),
    modelId: "MODEL-1" };
  return buildReport([
    { ...base, pageName: "Synthetic demand board", state: "Published (no unpublished changes)", publishedAt: native.publishedAt, pageGuid: guid(1000), details: named(native) },
    { ...base, pageName: "Draft page", state: "Not published", pageGuid: guid(1000) },
    { ...base, pageName: "Synthetic KPI board", state: "Published, draft differs", publishedAt: "2026-09-30T08:00:00Z", pageGuid: guid(1010), details: named(kpiBoard),
      failedActionTypes: ["EXPORT"] },
  ]);
}

describe("Page analyzer report, from a native page to the agreed CSV tables", () => {
  it("numbers cards by position and keeps the card title on the Cards tab only", () => {
    const result = report();
    expect(rowsOf("Cards", "Card #", "Card title", "Card type", "View type")).toEqual([[1, "—", "Action", "—"], [2, "Demand by brand", "Grid", "Custom view"],
      [3, "—", "Grid", "Saved view"], [4, "Plan and factors", "Grid", "Combined grid (2 sections)"]]);
    for (const tab of ["Grid sections", "Filters", "Formatting", "Actions", "Where used"] as TabName[]) {
      expect(HEADERS[tab]).not.toContain("Card title");
      expect(JSON.stringify(result[tab].rows)).not.toContain("Demand by brand");
    }
    expect(result.Pages.rows).toEqual([
      ["Planning app", "Demand", "Synthetic demand board", "Board", "Published (no unpublished changes)", "Model one", "Workspace one", 4, 3, 0,
        "1 custom view, 1 saved view, 1 combined grid", 0, 0, 1, 0, "2026-09-21", guid(1000), guid(1002), "MODEL-1"],
      ["Planning app", "Demand", "Draft page", "Board", "Not published", "Model one", "Workspace one", 0, 0, 0, "—", 0, 0, 0, 0, "—", guid(1000), guid(1002), "MODEL-1"]]);
  });

  it("describes each view type: custom view, saved view and a side-by-side combined grid", () => {
    expect(rowsOf("Cards", "Source module(s)", "Saved view", "Line items shown", "Rows", "Columns", "Filters", "Sorts & hidden items")).toEqual([
      ["—", "—", "—", "—", "—", "—", "—"],
      ["Demand", "—", "Line Items not on rows, columns or a selector", "Product", "Time (lowest level only)",
        "Rows, match all: Territory demand [Factors] is not equal to 0 (context: Territory = current)", "—"],
      ["Order summary", "Exceptions view", "Set by the saved view", "—", "—", "Set in the model (saved view)", "Set in the model (saved view)"],
      ["Section 1: Demand | Section 2: Factors", "—", "Section 1: Line Items not on rows, columns or a selector | Section 2: All line items (Line Items on columns)",
        "Product (shared by all sections)", "Section 1: Time | Section 2: Line Items", "Rows (sections 1 and 2), match all: Show? [Demand] is equal to true", "—"]]);
    expect(rowsOf("Grid sections", "Card #", "Section #", "Section layout", "Source module", "Saved view", "Row filter", "Column filter", "Conditional formatting")).toEqual([
      [2, 1, "—", "Demand", "—", "1 condition, match all", "—", "1 rule (Border)"],
      [3, 1, "—", "Order summary", "Exceptions view", "Set in the model (saved view)", "Set in the model (saved view)", "—"],
      [4, 1, "Beside section 2 (same rows)", "Demand", "—", "1 condition, match all (shared with section 2)", "—", "—"],
      [4, 2, "Beside section 1 (same rows)", "Factors", "—", "1 condition, match all (shared with section 1)", "—", "1 rule (Background)"]]);
    expect(rowsOf("Filters", "Card #", "Section #", "Filtered module", "Filter on", "Condition line item", "Condition line item's module", "Condition context")).toEqual([
      [2, "1", "Demand", "Rows", "Territory demand", "Factors", "Territory = current"], [4, "1, 2 (shared rows)", "Demand; Factors", "Rows", "Show?", "Demand", "—"]]);
    expect(rowsOf("Formatting", "Card #", "Section #", "Formatted module", "Format style", "Formatted line item")).toEqual([[2, "1", "Demand", "Border", "Volume"], [4, "2", "Factors", "Background", "Factor"]]);
  });

  it("lists each section's context selectors the way Pivot data shows them, and a saved view's layout", () => {
    const withLayout = catalog();
    // Section 1's module has a second list and no Line Items entry; section 2's module has two more lists.
    addModuleDimensions(withLayout, { modules: {
      [MODULE]: { dimensions: [{ id: LIST, label: "Product" }, { id: LIST_2, label: "Territory" }, { id: TIME, label: "Time" }] },
      [MODULE_2]: { dimensions: [{ id: LIST, label: "Product" }, { id: "101000000903", label: "Channel" }, { id: "101000000904", label: "Store" }, { id: LINE_ITEMS, label: "Line Items" }] },
    } });
    withLayout.viewLayouts.set(VIEW, { rows: [{ id: LINE_ITEMS, name: "Line Items" }], columns: [], pages: [{ id: "101000000905", name: "Orders" }] });
    const details = describePageCards("BOARD", structuredClone(native));
    expect(gridNeeds([details]).modules).toEqual(new Set([MODULE, MODULE_2]));
    const named = addDerivedContextSelectors(nameCardDetails(details, resolveFromCatalog(details.references, withLayout)), withLayout);
    const result = buildReport([{ appName: "Planning app", categoryName: "Demand", pageName: "Synthetic demand board", pageType: "BOARD",
      state: "Published (no unpublished changes)", modelName: "Model one", workspaceName: "Workspace one", pageGuid: guid(1000), appGuid: guid(1002),
      modelId: "MODEL-1", details: named }]);
    const cards = result.Cards.rows.map(row => [row[1], row[HEADERS.Cards.indexOf("Context selectors")], row[HEADERS.Cards.indexOf("Line items shown")],
      row[HEADERS.Cards.indexOf("Rows")]]);
    expect(cards.slice(1)).toEqual([
      [2, "Territory; Line Items", "Chosen by the Line Items selector", "Product"],
      [3, "Orders", "Set by the saved view (Line Items on rows)", "Line Items"],
      [4, "Section 1: Territory; Line Items | Section 2: Channel; Store", "Section 1: Chosen by the Line Items selector | Section 2: All line items (Line Items on columns)",
        "Product (shared by all sections)"]]);
    expect(result["Grid sections"].rows.map(row => [row[1], row[3], row[HEADERS["Grid sections"].indexOf("Context selectors")]])).toEqual([
      [2, 1, "Territory; Line Items"], [3, 1, "Orders"], [4, 1, "Territory; Line Items"], [4, 2, "Channel; Store"]]);
  });

  it("names shown and hidden items once the model answers their labels", () => {
    const withItems = catalog();
    addSelections(withItems, { data: [{ itemId: "201000000001", label: "North" }, { itemId: "201000000002", label: "South" }] });
    const hidden = structuredClone(native);
    hidden.widgets[guid(2)].widgetDataSources[0].axisDescriptionQuery.regions.SINGLE.rows.dimensions[0].hides = ["201000000001", "201000000002"];
    const details = describePageCards("BOARD", hidden);
    expect(gridNeeds([details]).items).toEqual([{ moduleId: MODULE, dimensionId: LIST, itemIds: ["201000000001", "201000000002"] }]);
    const named = nameCardDetails(details, resolveFromCatalog(details.references, withItems));
    const result = buildReport([{ appName: "Planning app", categoryName: "Demand", pageName: "Hidden", pageType: "BOARD", state: "Published (no unpublished changes)",
      modelName: "Model one", workspaceName: "Workspace one", pageGuid: guid(1000), appGuid: guid(1002), modelId: "MODEL-1", details: named }]);
    expect(result.Cards.rows[1][HEADERS.Cards.indexOf("Sorts & hidden items")]).toBe("Product: 2 items hidden (North, South)");
  });

  it("reads hierarchy levels as words and list names, and says when a model action lookup failed", () => {
    const region = { region: "SINGLE", module: { kind: "module", id: MODULE, name: "Demand" },
      rows: { dimensions: [{ dimension: { kind: "dimension", id: LIST, name: "Product" }, levels: ["TOTALS", "LEAF", `_${LIST_2}_`, "_101000000999_"] }] },
      columns: { dimensions: [{ dimension: { kind: "dimension", id: TIME, name: "Time" }, levels: ["LEAF"] }] }, pivot: { rows: [], columns: [], pages: [] } };
    const details = { ...describePageCards("BOARD", structuredClone(native)), cards: [
      { id: "card-1", type: "TABLE", placement: { kind: "board", rowIndex: 0, columnStart: 0 }, hasSavedWidgetReference: false, viewType: "customView",
        sources: [{ dataSourceType: "MULTI_AXIS_DESCRIPTION", module: region.module }], grid: { sections: [], regions: [region], summary: {} } },
      { id: "card-2", type: "ACTION", placement: { kind: "board", rowIndex: 1, columnStart: 0 }, hasSavedWidgetReference: false,
        actions: [{ action: { kind: "action", id: "118000000901", actionType: "PROCESS" }, name: "Run nightly" }] }] };
    const result = buildReport([{ appName: "Planning app", categoryName: "Demand", pageName: "Levels", pageType: "BOARD", state: "Published (no unpublished changes)",
      modelName: "Model one", workspaceName: "Workspace one", pageGuid: guid(1000), appGuid: guid(1002), modelId: "MODEL-1",
      details: details as never, dimensionNames: new Map([[LIST_2, "Territory"]]), failedActionTypes: ["PROCESS"] }]);
    const cards = result.Cards.rows;
    expect(cards[0][HEADERS.Cards.indexOf("Rows")]).toBe("Product (levels: top level, lowest level, Territory, 101000000999)");
    expect(cards[0][HEADERS.Cards.indexOf("Columns")]).toBe("Time (lowest level only)");
    const section = result["Grid sections"].rows[0];
    expect([section[HEADERS["Grid sections"].indexOf("Rows")], section[HEADERS["Grid sections"].indexOf("Columns")]])
      .toEqual(["Product (levels: top level, lowest level, Territory, 101000000999)", "Time (lowest level only)"]);
    expect(result.Actions.rows[0].slice(4, 6)).toEqual(["—", "Card label (model lookup failed)"]);
  });

  it("names model actions from the model, keeps other buttons' labels, and never exports an action token", () => {
    expect(rowsOf("Actions", "Button label", "Action type", "Model action name", "Name source", "Runs automatically", "Cancel button")).toEqual([
      ["Reload plan", "Import", "Import demand (model name)", "Model", "Yes (default)", "n/a"],
      ["Forecast demand", "Forecaster", "—", "Card label (not a model object)", "n/a", "n/a"],
      ["Run nightly", "Process", "—", "Card label (not found in the model)", "No (asks first)", "Cancel disabled"]]);
    const result = report();
    const csv = (Object.keys(HEADERS) as TabName[]).map(tab => toCsv(result[tab].headers, result[tab].rows)).join("\n");
    expect(csv).not.toContain(TOKEN);
    expect(csv).not.toMatch(/actionToken|actionButtons/);
    expect(rowsOf("Where used", "Object type", "Object name", "Card #", "Used as").filter(([type]) => type === "Module" || type === "Saved view")).toEqual([
      ["Module", "Demand", 2, "Data source (custom view)"], ["Module", "Order summary", 3, "Data source (via saved view)"], ["Saved view", "Exceptions view", 3, "Data source"],
      ["Module", "Demand", 4, "Data source (combined grid section 1)"], ["Module", "Factors", 4, "Data source (combined grid section 2)"]]);
  });

  it("fills all seven tables, every row in order, for boards with every kind of card", () => {
    // Where used keeps the first use of each object, card and role, in the order the card's parts are read: modules, saved
    // view, KPI, field and image line items, axis dimensions, context selectors, filters, formatting, buttons and the link.
    const result = fullReport();
    expect(result.Pages.rows).toEqual([
      ["Planning app", "Demand", "Synthetic demand board", "Board", "Published (no unpublished changes)", "Model one", "Workspace one", 4, 3, 0,
        "1 custom view, 1 saved view, 1 combined grid", 0, 0, 1, 0, "2026-09-21", guid(1000), guid(1002), "MODEL-1"],
      ["Planning app", "Demand", "Draft page", "Board", "Not published", "Model one", "Workspace one", 0, 0, 0, "—", 0, 0, 0, 0, "—", guid(1000), guid(1002), "MODEL-1"],
      ["Planning app", "Demand", "Synthetic KPI board", "Board", "Published, draft differs", "Model one", "Workspace one", 7, 2, 0, "1 custom view, 1 saved view", 1, 1,
        1, 2, "2026-09-30", guid(1010), guid(1002), "MODEL-1"]]);
    expect(result.Cards.rows).toEqual([
      ["Synthetic demand board", 1, "—", "Action", "—", "—", "—", "—", "—", "—", "—", "—", "—", "—",
        "Import: Reload plan | Forecaster: Forecast demand | Process: Run nightly", "—", "—", guid(1), "—"],
      ["Synthetic demand board", 2, "Demand by brand", "Grid", "Custom view", "Demand", "—", "Chosen by the Line Items selector", "Product", "Time (lowest level only)",
        "Territory; Line Items", "Rows, match all: Territory demand [Factors] is not equal to 0 (context: Territory = current)", "—",
        "Border colour on Volume: 0 → #FFFFFF; 100,000 → #627786", "—", "—", "Read-only · pivot on · filter/sort on · CSV export on", guid(2), MODULE],
      ["Synthetic demand board", 3, "—", "Grid", "Saved view", "Order summary", "Exceptions view", "Set by the saved view", "—", "—", "—",
        "Set in the model (saved view)", "Set in the model (saved view)", "—", "—", "—", "Read-only · pivot on · filter/sort on · CSV export on", guid(3),
        "102000000903; 130000000901"],
      ["Synthetic demand board", 4, "Plan and factors", "Grid", "Combined grid (2 sections)", "Section 1: Demand | Section 2: Factors", "—",
        "Section 1: Chosen by the Line Items selector | Section 2: All line items (Line Items on columns)", "Product (shared by all sections)",
        "Section 1: Time | Section 2: Line Items", "Section 1: Territory; Line Items", "Rows (sections 1 and 2), match all: Show? [Demand] is equal to true", "—",
        "Section 2: Background colour on Factor: 0 → #FFFFFF; 100,000 → #627786", "—", "—", "Read-only · pivot on · filter/sort on · CSV export on", guid(4),
        "102000000901; 102000000902"],
      ["Synthetic KPI board", 1, "Plan inputs", "Field", "—", "—", "—", "Show?; Factor", "—", "—", "—", "—", "—", "—", "—", "—", "—", guid(12), "—"],
      ["Synthetic KPI board", 2, "Total volume", "KPI", "—", "Demand", "—", "Volume", "—", "—", "—", "—", "—",
        "CARD_LEVEL colour on Volume (values from Show?): 0 → #FFFFFF; 1,500.5 → #627786 | KPI indicator (threshold): 3 icons (arrow up, flag red); no threshold values set",
        "Title links to board Synthetic demand board", "—", "text LARGE · scale THOUSANDS · sparkline on", guid(11), MODULE],
      ["Synthetic KPI board", 3, "—", "Image", "—", "Factors", "—", "Territory demand (image)", "—", "—", "—", "—", "—", "—", "—", "—", "—", guid(13), MODULE_2],
      ["Synthetic KPI board", 4, "—", "Text", "—", "—", "—", "—", "—", "—", "—", "—", "—", "—", "Title links to board Synthetic demand board",
        "Review the plan before Friday.", "—", guid(14), "—"],
      ["Synthetic KPI board", 5, "Ranked demand", "Grid", "Custom view", "Demand", "—", "All except Show? (Line Items on rows)", "Product; Line Items", "Time",
        "Territory (hidden, synced to page)",
        "Columns, match any: Volume [Demand] is greater than 1500.5 | Columns, match all: Show? [Demand] is equal to true | Columns, match all: Volume [Demand] is blank —",
        "Product: sorted (1 sort key); Product: only North shown; Line Items: 1 item hidden (Show?)", "Font colour on Volume: 0 → #FFFFFF; 100,000 → #627786", "—", "—",
        "Read-only · pivot on · filter/sort on · CSV export on", guid(15), MODULE],
      ["Synthetic KPI board", 6, "Factors", "Grid", "Saved view", "Factors", "Default view of the module", "Set by the saved view", "—", "—", "—",
        "Set in the model (saved view)", "Set in the model (saved view)", "—", "—", "—", "Read-only · pivot on · filter/sort on · CSV export on", guid(16), MODULE_2],
      ["Synthetic KPI board", 7, "—", "Action", "—", "—", "—", "—", "—", "—", "—", "—", "—", "—",
        "Export: Send plan | Process: Run weekly | Navigation: Open review | CUSTOM_STEP: Custom step", "—", "—", guid(17), "—"]]);
    expect(result["Grid sections"].rows).toEqual([
      ["Synthetic demand board", 2, "Custom view", 1, "—", "Demand", "—", "Product", "Time (lowest level only)", "Territory; Line Items",
        "Chosen by the Line Items selector", "1 condition, match all", "—", "—", "1 rule (Border)", guid(2), "SINGLE", MODULE],
      ["Synthetic demand board", 3, "Saved view", 1, "—", "Order summary", "Exceptions view", "—", "—", "—", "Set by the saved view", "Set in the model (saved view)",
        "Set in the model (saved view)", "Set in the model (saved view)", "—", guid(3), "—", OWNER],
      ["Synthetic demand board", 4, "Combined grid (2 sections)", 1, "Beside section 2 (same rows)", "Demand", "—", "Product", "Time", "Territory; Line Items",
        "Chosen by the Line Items selector", "1 condition, match all (shared with section 2)", "—", "—", "—", guid(4), "SINGLE", MODULE],
      ["Synthetic demand board", 4, "Combined grid (2 sections)", 2, "Beside section 1 (same rows)", "Factors", "—", "Product", "Line Items", "—",
        "All line items (Line Items on columns)", "1 condition, match all (shared with section 1)", "—", "—", "1 rule (Background)", guid(4), guid(902), MODULE_2],
      ["Synthetic KPI board", 5, "Custom view", 1, "—", "Demand", "—", "Product; Line Items", "Time", "Territory (hidden, synced to page)",
        "All except Show? (Line Items on rows)", "—", "3 conditions, match all/any",
        "Product: sorted (1 sort key); Product: only North shown; Line Items: 1 item hidden (Show?)", "1 rule (Font colour)", guid(15), "SINGLE", MODULE],
      ["Synthetic KPI board", 6, "Saved view", 1, "—", "Factors", "Default view of the module", "—", "—", "—", "Set by the saved view", "Set in the model (saved view)",
        "Set in the model (saved view)", "Set in the model (saved view)", "—", guid(16), "—", MODULE_2]]);
    expect(result.Filters.rows).toEqual([
      ["Synthetic demand board", 2, "1", "Demand", "Rows", "Product", "1", "All", "Territory demand", "Factors", "is not equal to", "0", "Territory = current", guid(2),
        LI(9)],
      ["Synthetic demand board", 4, "1, 2 (shared rows)", "Demand; Factors", "Rows", "Product", "1", "All", "Show?", "Demand", "is equal to", "true", "—", guid(4),
        LI(1)],
      ["Synthetic KPI board", 5, "1", "Demand", "Columns", "Time", "1", "Any", "Volume", "Demand", "is greater than", "1500.5", "—", guid(15), LI(2)],
      ["Synthetic KPI board", 5, "1", "Demand", "Columns", "Time", "1.1", "All", "Show?", "Demand", "is equal to", "true", "—", guid(15), LI(1)],
      ["Synthetic KPI board", 5, "1", "Demand", "Columns", "Time", "1.1", "All", "Volume", "Demand", "is blank", "—", "—", guid(15), LI(2)]]);
    expect(result.Formatting.rows).toEqual([
      ["Synthetic demand board", 2, "1", "Demand", "Border", "Volume", "Volume", "0 → #FFFFFF; 100,000 → #627786", guid(2), LI(2)],
      ["Synthetic demand board", 4, "2", "Factors", "Background", "Factor", "Factor", "0 → #FFFFFF; 100,000 → #627786", guid(4), LI(8)],
      ["Synthetic KPI board", 2, "—", "Demand", "CARD_LEVEL", "Volume", "Show?", "0 → #FFFFFF; 1,500.5 → #627786", guid(11), LI(2)],
      ["Synthetic KPI board", 2, "—", "Demand", "KPI indicator – threshold icons", "KPI value", "Volume", "3 icons (arrow up, flag red); no threshold values set",
        guid(11), LI(2)],
      ["Synthetic KPI board", 5, "1", "Demand", "Font colour", "Volume", "Volume", "0 → #FFFFFF; 100,000 → #627786", guid(15), LI(2)]]);
    expect(result.Actions.rows).toEqual([
      ["Synthetic demand board", 1, "Reload plan", "Import", "Import demand (model name)", "Model", "Yes (default)", "n/a", guid(1), "112000000901"],
      ["Synthetic demand board", 1, "Forecast demand", "Forecaster", "—", "Card label (not a model object)", "n/a", "n/a", guid(1), "0123456789abcdef0123456789abcdef"],
      ["Synthetic demand board", 1, "Run nightly", "Process", "—", "Card label (not found in the model)", "No (asks first)", "Cancel disabled", guid(1), "118000000901"],
      ["Synthetic KPI board", 7, "Send plan", "Export", "—", "Card label (model lookup failed)", "Yes", "n/a", guid(17), "116000000901"],
      ["Synthetic KPI board", 7, "Run weekly", "Process", "—", "Card label (not found in the model)", "Yes (default)", "Cancel allowed", guid(17), "118000000902"],
      ["Synthetic KPI board", 7, "Open review", "Navigation", "—", "Card label (not a model object)", "n/a", "n/a", guid(17), guid(990)],
      ["Synthetic KPI board", 7, "Custom step", "CUSTOM_STEP", "—", "Card label (not a model object)", "n/a", "n/a", guid(17), "119000000901"]]);
    expect(result["Where used"].rows).toEqual([
      ["Import", "Import demand (model name)", "—", "Synthetic demand board", 1, "Action button", "112000000901"],
      ["Forecaster", "Forecast demand", "—", "Synthetic demand board", 1, "Action button", "0123456789abcdef0123456789abcdef"],
      ["Process", "Run nightly", "—", "Synthetic demand board", 1, "Action button", "118000000901"],
      ["Module", "Demand", "—", "Synthetic demand board", 2, "Data source (custom view)", MODULE],
      ["Dimension", "Product", "—", "Synthetic demand board", 2, "Rows", LIST],
      ["Dimension", "Time", "—", "Synthetic demand board", 2, "Columns", TIME],
      ["Dimension", "Territory", "—", "Synthetic demand board", 2, "Page selector", LIST_2],
      ["Dimension", "Line Items", "—", "Synthetic demand board", 2, "Page selector", LINE_ITEMS],
      ["Line item", "Territory demand", "Factors", "Synthetic demand board", 2, "Filter", LI(9)],
      ["Dimension", "Territory", "—", "Synthetic demand board", 2, "Filter context", LIST_2],
      ["Line item", "Volume", "Demand", "Synthetic demand board", 2, "Formatting", LI(2)],
      ["Module", "Order summary", "—", "Synthetic demand board", 3, "Data source (via saved view)", OWNER],
      ["Saved view", "Exceptions view", "Order summary", "Synthetic demand board", 3, "Data source", VIEW],
      ["Module", "Demand", "—", "Synthetic demand board", 4, "Data source (combined grid section 1)", MODULE],
      ["Module", "Factors", "—", "Synthetic demand board", 4, "Data source (combined grid section 2)", MODULE_2],
      ["Dimension", "Product", "—", "Synthetic demand board", 4, "Rows", LIST],
      ["Dimension", "Time", "—", "Synthetic demand board", 4, "Columns", TIME],
      ["Dimension", "Territory", "—", "Synthetic demand board", 4, "Page selector", LIST_2],
      ["Dimension", "Line Items", "—", "Synthetic demand board", 4, "Page selector", LINE_ITEMS],
      ["Dimension", "Line Items", "—", "Synthetic demand board", 4, "Columns", LINE_ITEMS],
      ["Line item", "Show?", "Demand", "Synthetic demand board", 4, "Filter", LI(1)],
      ["Line item", "Factor", "Factors", "Synthetic demand board", 4, "Formatting", LI(8)],
      ["Line item", "Show?", "Demand", "Synthetic KPI board", 1, "Field", LI(1)],
      ["Line item", "Factor", "Factors", "Synthetic KPI board", 1, "Field", LI(8)],
      ["Module", "Demand", "—", "Synthetic KPI board", 2, "Data source", MODULE],
      ["Line item", "Volume", "Demand", "Synthetic KPI board", 2, "KPI value", LI(2)],
      ["Line item", "Volume", "Demand", "Synthetic KPI board", 2, "Formatting", LI(2)],
      ["Line item", "Show?", "Demand", "Synthetic KPI board", 2, "Formatting values", LI(1)],
      ["Page", "Synthetic demand board", "—", "Synthetic KPI board", 2, "Link target", guid(1000)],
      ["Module", "Factors", "—", "Synthetic KPI board", 3, "Data source", MODULE_2],
      ["Line item", "Territory demand", "Factors", "Synthetic KPI board", 3, "Image", LI(9)],
      ["Page", "Synthetic demand board", "—", "Synthetic KPI board", 4, "Link target", guid(1000)],
      ["Module", "Demand", "—", "Synthetic KPI board", 5, "Data source (custom view)", MODULE],
      ["Dimension", "Product", "—", "Synthetic KPI board", 5, "Rows", LIST],
      ["Dimension", "Line Items", "—", "Synthetic KPI board", 5, "Rows", LINE_ITEMS],
      ["Dimension", "Time", "—", "Synthetic KPI board", 5, "Columns", TIME],
      ["Dimension", "Territory", "—", "Synthetic KPI board", 5, "Page selector", LIST_2],
      ["Line item", "Volume", "Demand", "Synthetic KPI board", 5, "Filter", LI(2)],
      ["Line item", "Show?", "Demand", "Synthetic KPI board", 5, "Filter", LI(1)],
      ["Line item", "Volume", "Demand", "Synthetic KPI board", 5, "Formatting", LI(2)],
      ["Module", "Factors", "—", "Synthetic KPI board", 6, "Data source (default view)", MODULE_2],
      ["Export", "Send plan", "—", "Synthetic KPI board", 7, "Action button", "116000000901"],
      ["Process", "Run weekly", "—", "Synthetic KPI board", 7, "Action button", "118000000902"],
      ["Navigation", "Open review", "—", "Synthetic KPI board", 7, "Action button", guid(990)],
      ["CUSTOM_STEP", "Custom step", "—", "Synthetic KPI board", 7, "Action button", "119000000901"]]);
    expect(Object.keys(result)).toEqual(["Pages", "Cards", "Grid sections", "Filters", "Formatting", "Actions", "Where used"]);
    for (const tab of Object.keys(HEADERS) as TabName[]) expect(result[tab].headers).toBe(HEADERS[tab]);
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });

  // Where used, from cards as the card reader describes them once they are named.
  const lineItem = (n: number, name: string, moduleName: string) => ({ kind: "lineItem", id: LI(n), name, moduleName });
  const process = (id: string, name: string) => ({ action: { kind: "action", id, actionType: "PROCESS" }, name });
  const fieldCard_ = (id: string, rowIndex: number, ...lineItems: Obj[]) => ({ id, type: "FIELD", placement: { kind: "board", rowIndex, columnStart: 0 },
    hasSavedWidgetReference: false, fields: lineItems.map(each => ({ lineItem: each })) });
  const actionCard_ = (id: string, rowIndex: number, ...actions: Obj[]) => ({ id, type: "ACTION", placement: { kind: "board", rowIndex, columnStart: 0 },
    hasSavedWidgetReference: false, actions });
  const pageOf = (pageName: string, pageGuid: string, ...pageCards: Obj[]): PageInput => ({ appName: "Planning app", categoryName: "Demand", pageName, pageType: "BOARD",
    state: "Published (no unpublished changes)", modelName: "Model one", workspaceName: "Workspace one", pageGuid, appGuid: guid(1002), modelId: "MODEL-1",
    details: { ...describePageCards("BOARD", structuredClone(native)), cards: pageCards } as never });

  it("lists in Where used the uses of every page, also of a page that has the name of an earlier page", () => {
    const shown = [lineItem(1, "Show?", "Demand"), lineItem(8, "Factor", "Factors")];
    const [fields, buttons] = [fieldCard_("card-1", 0, ...shown), actionCard_("card-2", 1, process("118000000901", "Run nightly"))];
    // Three pages of one name (a page, its copy, and a page with the same cards the other way round), then a page of another
    // name. Each has the rows it has when it is the only page: the rows of two pages of one name can be the same row twice.
    const result = buildReport([pageOf("Plan", guid(1000), fields, buttons), pageOf("Plan", guid(1020), fields, buttons),
      pageOf("Plan", guid(1030), actionCard_("card-1", 0, process("118000000901", "Run nightly")), fieldCard_("card-2", 1, ...shown)), pageOf("Review", guid(1040), buttons)]);
    const copy = [["Line item", "Show?", "Demand", "Plan", 1, "Field", LI(1)], ["Line item", "Factor", "Factors", "Plan", 1, "Field", LI(8)],
      ["Process", "Run nightly", "—", "Plan", 2, "Action button", "118000000901"]];
    expect(result["Where used"].rows).toEqual([...copy, ...copy,
      ["Process", "Run nightly", "—", "Plan", 1, "Action button", "118000000901"],
      ["Line item", "Show?", "Demand", "Plan", 2, "Field", LI(1)], ["Line item", "Factor", "Factors", "Plan", 2, "Field", LI(8)],
      ["Process", "Run nightly", "—", "Review", 1, "Action button", "118000000901"]]);
    // The other tables always had a row for each of them.
    expect(result.Cards.rows.map(row => [row[0], row[1], row[3]])).toEqual([["Plan", 1, "Field"], ["Plan", 2, "Action"], ["Plan", 1, "Field"], ["Plan", 2, "Action"],
      ["Plan", 1, "Action"], ["Plan", 2, "Field"], ["Review", 1, "Action"]]);
  });

  it("lists in Where used each object a card uses in a role, also one that has the name of another: the first use of the same object wins", () => {
    const result = buildReport([pageOf("Plan", guid(1000),
      // Two line items of one name, from two modules, and the first of them once more.
      fieldCard_("card-1", 0, lineItem(1, "Amount", "Demand"), lineItem(8, "Amount", "Factors"), lineItem(1, "Amount", "Demand")),
      // Two actions the model has no name for, under one label; the first of them once more, under that label and under another.
      actionCard_("card-2", 1, process("118000000901", "Run nightly"), process("118000000902", "Run nightly"), process("118000000901", "Run nightly"),
        process("118000000901", "Run it again")))]);
    expect(result["Where used"].rows).toEqual([
      ["Line item", "Amount", "Demand", "Plan", 1, "Field", LI(1)], ["Line item", "Amount", "Factors", "Plan", 1, "Field", LI(8)],
      ["Process", "Run nightly", "—", "Plan", 2, "Action button", "118000000901"], ["Process", "Run nightly", "—", "Plan", 2, "Action button", "118000000902"],
      // Its label is the only name such an action has, so it is listed under each: as it was before objects were told apart by their IDs.
      ["Process", "Run it again", "—", "Plan", 2, "Action button", "118000000901"]]);
    // Every button has its row in Action Buttons.csv, as before.
    expect(result.Actions.rows.map(row => [row[2], row[9]])).toEqual([["Run nightly", "118000000901"], ["Run nightly", "118000000902"], ["Run nightly", "118000000901"],
      ["Run it again", "118000000901"]]);
  });
});
