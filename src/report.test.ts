import { describe, expect, it } from "vitest";
import { describePageCards } from "../../../src/domains/ux-designer/card-details.js";
import { nameCardDetails } from "../../../src/domains/ux-designer/card-naming.js";
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
});
