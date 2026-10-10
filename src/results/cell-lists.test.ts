import { describe, expect, it } from "vitest";
import { CALENDAR_HEADERS, CALENDAR_PROPERTIES, calendarRows } from "../model/calendar.js";
import { buildReport, HEADERS, type PageInput, type TabName } from "../report.js";
import type { AnalysisResult, Cell, ResultTable } from "../result-types.js";
import { cellLists, LISTED_COLUMNS, rowItems, type Items } from "./cell-lists.js";
import { APP_FILES } from "./columns.js";
import { fileView, MODEL_CALENDAR_FILE, MODEL_FILE_ORDER } from "./result-view.js";
import { NONE } from "./table-engine.js";

// Made-up names only. A model's cells are written as the export writes them, after the cells of the golden models
// (golden-0.8.1.test-support.ts) and the cells the model map is tested with (map/build-graph.test.ts); an app's tables
// are the report's own, made by report.ts from cards as the card reader names them.

const result = (kind: AnalysisResult["kind"], ...tables: ResultTable[]): AnalysisResult => ({ kind, name: "Demo", id: "demo", zipName: "Demo.zip", summary: [], tables });
const file = (label: string, headers: string[], rows: Cell[][]): ResultTable => ({ file: `${label}.csv`, label, headers, rows, guard: false });

/** For each row of a table, the cells that its drawer lists one item to a line, each by its header with its items. */
function listed(of: AnalysisResult, table: ResultTable): Record<string, Items>[] {
  const lists = cellLists(of, table);
  return table.rows.map(row => Object.fromEntries([...rowItems(lists, row)].map(([index, items]) => [String(table.headers[index]), items])));
}

/** The separators the producers write between two items; written one after another with one of them, the items are the
 * cell again. */
const SEPARATORS = ["; ", " | ", ", ", " · "];
function expectWhole(table: ResultTable, rows: readonly Record<string, Items>[]): void {
  rows.forEach((cells, at) => {
    for (const [header, items] of Object.entries(cells)) {
      const cell = String(table.rows[at][table.headers.indexOf(header)]);
      expect(SEPARATORS.some(separator => items.join(separator) === cell), `${header}: ${cell}`).toBe(true);
    }
  });
}

describe("What a model's cell lists, item by item, for the drawer", () => {
  const LIST_HEADERS = ["", "Parent Hierarchy", "Subsets", "Properties", "Referenced in Applies To", "Referenced as Format", "Referenced in Formula", "Notes"];
  const lists = (...rows: Record<string, string>[]) => file("General Lists", LIST_HEADERS, rows.map(cells => LIST_HEADERS.map(header => cells[header] ?? "")));

  it("cuts a cell that names objects at each comma and space outside its quotes, so that a name in quotes stays whole", () => {
    const table = lists(
      // The user's own case: two line items of two lists, each name that needs quotes in them.
      { "": "SYS ORG1 Campus #", "Referenced as Format": "'SYS ORG1 Campus #'.Item L, 'SYS ORG2 Division #'.'ORG1 Campus # L'" },
      // A comma inside quotes is the name's, as are the brackets of a property's format. A parent is one name.
      { "": "Regions, north & south", "Parent Hierarchy": "Regions, all", Subsets: "Active Regions, 'North, coastal'",
        Properties: "Code: TEXT, 'Opened, on': DATE, Rate: NUMBER (2 dp, %)", "Referenced in Applies To": "REV01 Revenue, 'COST01 Costs, direct'.Rate, Old module",
        "Referenced in Formula": "REV01 Revenue.'Rate, net (50%)'", Notes: "Sales regions, north and south; by country" },
      // One name, in quotes or not, is one item, and so is the dash for none.
      { "": "Products", Subsets: "'Top, sellers'", "Referenced as Format": "Customers.Favourite", "Referenced in Formula": "-" });
    const found = listed(result("model", table), table);
    expect(found).toEqual([
      { "Referenced as Format": ["'SYS ORG1 Campus #'.Item L", "'SYS ORG2 Division #'.'ORG1 Campus # L'"] },
      { Subsets: ["Active Regions", "'North, coastal'"], Properties: ["Code: TEXT", "'Opened, on': DATE", "Rate: NUMBER (2 dp, %)"],
        "Referenced in Applies To": ["REV01 Revenue", "'COST01 Costs, direct'.Rate", "Old module"] },
      {},
    ]);
    expectWhole(table, found);
  });

  it("keeps whole a cell that is not written as the export writes names: quotes or brackets that do not pair up, an empty item, a comma alone", () => {
    const table = lists(
      { "": "Unpaired quote", "Referenced as Format": "'SYS ORG1 Campus #.Item L, Products", Subsets: "Bob's list, Products" },
      { "": "Unpaired bracket", Properties: "Rate: NUMBER (2 dp, %, Code: TEXT" },
      { "": "Bracket closed first", Properties: "Rate: NUMBER 2 dp), Code: TEXT" },
      { "": "Empty items", Subsets: "Products, , Time", "Referenced in Applies To": "Products, ", "Referenced in Formula": ", Products" },
      { "": "No space", Subsets: "Products,Time", "Referenced as Format": "Products ,Time" },
      { "": "Spaces", Subsets: "Products,   ", "Referenced in Formula": "   " });
    expect(listed(result("model", table), table)).toEqual([{}, {}, {}, {}, {}, {}]);
    // Without its quotes' pairing a comma could be a name's: a property's brackets are its own and pair up, quotes or not.
    const paired = lists({ "": "Paired", Properties: "'Rate, (net': NUMBER (2 dp, %), Code: TEXT" });
    expect(listed(result("model", paired), paired)).toEqual([{ Properties: ["'Rate, (net': NUMBER (2 dp, %)", "Code: TEXT"] }]);
  });

  it("lists a line item's dimensions and what refers to it, wherever the page shows the columns, and a module's dimensions", () => {
    // The Line Items file as the export writes it, a module's own row first; the page shows every row of it, each line item
    // with its module after its name and the dimensions it has, from the module where it shows a dash.
    const lineItems = file("Line Items", ["", "Format", "Applies To", "Referenced By", "Read Access Driver", "Module Name"], [
      ["ACC01 Access, by role", "", "'Regions, north & south', 'O''Brien''s', Products, 'Top, sellers'", "", "", ""],
      ["Can read", '{"dataType":"BOOLEAN"}', "-",
        "'Editor''s lock', 'REV01 Revenue v1.2'.Units, 'REV01 Revenue v1.2'.Price, 'REV01 Revenue v1.2'.Revenue, 'COST01 Costs'.Salaries", "", "ACC01 Access, by role"],
      ["Editor's lock", '{"dataType":"BOOLEAN"}', "Roles", "'REV01 Revenue v1.2'.'Rate, net (50%)'", "Can read", "ACC01 Access, by role"],
      ["Open for input", '{"dataType":"BOOLEAN"}', "Products, Roles", "Price, 'COST01 Costs'.Rent, 'COST01 Costs'.Rates", "'ACC01 Access, by role'.Can read", "ACC01 Access, by role"]]);
    const modules = file("Modules", ["", "Applies To", "Cell Count"], [["ACC01 Access, by role", "'Regions, north & south', Products", "1,200"], ["REV01 Revenue v1.2", "-", "0"]]);
    const model = result("model", lineItems, modules);
    const shown = fileView(model, lineItems).table;
    expect(shown.headers).toEqual(["", "Module Name", "Format", "Format type", "Applies To", "Applies To from", "Referenced By", "Read Access Driver"]);
    const found = listed(model, shown);
    expect(found).toEqual([
      // The module's own row: its dimensions, which are the ones its first line item takes.
      { "Applies To": ["'Regions, north & south'", "'O''Brien''s'", "Products", "'Top, sellers'"] },
      { "Applies To": ["'Regions, north & south'", "'O''Brien''s'", "Products", "'Top, sellers'"],
        "Referenced By": ["'Editor''s lock'", "'REV01 Revenue v1.2'.Units", "'REV01 Revenue v1.2'.Price", "'REV01 Revenue v1.2'.Revenue", "'COST01 Costs'.Salaries"] },
      // One line item of another module, whose name holds a comma: one item. A driver is one name, whatever it holds.
      {},
      { "Applies To": ["Products", "Roles"], "Referenced By": ["Price", "'COST01 Costs'.Rent", "'COST01 Costs'.Rates"] },
    ]);
    expectWhole(shown, found);
    expect(listed(model, modules)).toEqual([{ "Applies To": ["'Regions, north & south'", "Products"] }, {}]);
  });

  it("cuts an action's processes and a data source's imports only into names the result has, where the cell reads one way", () => {
    const ACTION_HEADERS = ["", "Action", "Notes", "Used in Processes", "Used in Dashboards"];
    const processes = file("Processes", ACTION_HEADERS, [["Nightly load", "", "Runs at 2am", "", "Admin, Review"], ["-- LOADS --", "", "", "", ""], ["Nightly load, full", "", "", "", ""],
      ["Weekly", "", "", "", ""], ["Daily", "", "", "", ""], ["Daily, Weekly", "", "", "", ""]]);
    const imports = file("Imports", ["", "Source Label", "Target Object", "Used in Processes", "Used in Dashboards"], [
      // Two processes, one of them a name with a comma and a space in it.
      ["Load prices", "prices.csv", "Prices", "Nightly load, Nightly load, full", "Admin, Review"],
      // One process, with a comma in its name, and a name that is no process: a part that is no name may hold a comma.
      ["Load regions", "Hub", "Regions", "Nightly load, full", ""],
      ["Load stores", "Hub", "Stores", "Nightly load, full, Gone process", ""],
      // Daily and Weekly, or the one process "Daily, Weekly": the cell reads two ways, and is not cut.
      ["Load plan", "plan.csv", "Plan", "Nightly load, Daily, Weekly", ""],
      ["Load weeks", "weeks.csv", "Weeks", "Weekly, Daily", ""],
      ["Old import", "", "", "-", ""]]);
    const exports = file("Exports", ACTION_HEADERS, [["Send prices", "Export from 'Prices'", "", "Weekly, Nightly load", ""]]);
    const others = file("Other Actions", ACTION_HEADERS, [["Delete old items", "", "", "Daily, Weekly, Daily", ""], ["Tidy up", "", "", "Daily, Nightly load", ""]]);
    const sources = file("Import Data Sources", ["", "Type", "Used in Imports"], [["prices.csv", "FILE", "Load prices, Load regions"], ["hub", "FILE", "Load prices, Gone import"]]);
    const model = result("model", processes, imports, exports, others, sources);
    expect(listed(model, imports)).toEqual([{ "Used in Processes": ["Nightly load", "Nightly load, full"] }, {}, {}, {}, { "Used in Processes": ["Weekly", "Daily"] }, {}]);
    expect(listed(model, exports)).toEqual([{ "Used in Processes": ["Weekly", "Nightly load"] }]);
    expect(listed(model, others)).toEqual([{}, { "Used in Processes": ["Daily", "Nightly load"] }]);
    // The dashboards an action is on are named without quotes too, and the result has no names of dashboards: not cut.
    expect(listed(model, processes)).toEqual([{}, {}, {}, {}, {}, {}]);
    expect(listed(model, sources)).toEqual([{ "Used in Imports": ["Load prices", "Load regions"] }, {}]);
    // Without the Processes table, or with none of its rows, nothing is known to cut by.
    expect(listed(result("model", imports, exports), imports)).toEqual([{}, {}, {}, {}, {}, {}]);
    expect(listed(result("model", { ...processes, rows: [] }, imports), imports)).toEqual([{}, {}, {}, {}, {}, {}]);
  });

  it("lists the Model Calendar's allowed values, in the template's own words", () => {
    // The table lists the settings that hold a value, and a setting holds one only for the calendar types it applies to:
    // so a calendar of months, and one of 4-4-5 weeks.
    const bySetting = new Map<string, Record<string, Items>>();
    for (const values of [
      new Map([[CALENDAR_PROPERTIES["Calendar Type"], "Calendar Months/Quarters/Years"], [CALENDAR_PROPERTIES["Fiscal Year Starts"], "1"], [CALENDAR_PROPERTIES["Current Period"], "Jan 26"]]),
      new Map([[CALENDAR_PROPERTIES["Calendar Type"], "Weeks: 4-4-5, 4-5-4 or 5-4-4"], [CALENDAR_PROPERTIES["End of Fiscal Year is"], "Last"]]),
    ]) {
      const calendar = file("Model Calendar", [...CALENDAR_HEADERS], calendarRows({ workspace: "Main", model: "Model one", capturedOn: "2026-10-03", values }));
      const model = result("model", calendar);
      const shown = fileView(model, calendar).table;
      const found = listed(model, shown);
      expectWhole(shown, found);
      for (const [at, row] of shown.rows.entries()) bySetting.set(String(row[1]), found[at]);
    }
    // A choice may hold a comma: the template joins its choices with " | ".
    expect(bySetting.get("Calendar Type")).toEqual({ "Allowed values": ["Calendar Months/Quarters/Years", "Weeks: 4-4-5, 4-5-4 or 5-4-4", "Weeks: 13 4-week Periods", "Weeks: General"] });
    expect(bySetting.get("End of Fiscal Year is")).toEqual({ "Allowed values": ["Last", "Nearest"] });
    expect(bySetting.get("Fiscal Year Starts")?.["Allowed values"]).toHaveLength(12);
    // One allowed value is one item.
    expect(bySetting.get("Current Period")).toEqual({});
  });
});

describe("What an app's cell lists, item by item, for the drawer: the report's own joins", () => {
  // Cards as the card reader names them (report.test.ts), each with the parts that make the report join a column.
  const dimension = (id: string, name: string) => ({ kind: "dimension", id, name });
  const [PRODUCT, REGION, TERRITORY, CHANNEL, STORE] = [["101000000901", "Product"], ["101000000902", "Region"], ["101000000903", "Territory"], ["101000000904", "Channel"],
    ["101000000905", "Store"]].map(([id, name]) => dimension(id, name));
  const TIME = dimension("20000000003", "Time");
  const LINE_ITEMS = dimension("20000000012", "Line Items");
  const [DEMAND, FACTORS, OWNER] = [["102000000901", "Demand"], ["102000000902", "Factors"], ["102000000903", "Order summary"]].map(([id, name]) => ({ kind: "module", id, name }));
  const VOLUME = { kind: "lineItem", id: "1901000000001", name: "Volume", moduleName: "Demand" };
  const PRICE = { kind: "lineItem", id: "1901000000002", name: "Price", moduleName: "Demand" };
  const on = (entry: object, extra: object = {}) => ({ dimension: entry, levels: [], ...extra });
  const selector = (entry: object, visible: boolean, syncedToPage = false) => ({ dimension: entry, visible, syncedToPage });
  const region = (id: string, module: object, [rowAxisKey, columnAxisKey]: string[], rows: object[], columns: object[], pages: object[] = [], filter?: object) =>
    ({ region: id, module, rowAxisKey, columnAxisKey, rows: { dimensions: rows, ...(filter ? { filter } : {}) }, columns: { dimensions: columns }, pivot: { rows: [], columns: [], pages } });
  const condition = (lineItem: object, operator: string, values: unknown[], filterContext: object[] = []) => ({ filterLineItem: lineItem, operator, values, filterContext });
  const PEGS = [{ value: 0, color: "#FFFFFF" }, { value: 100000, color: "#627786" }];
  const card = (place: number, type: string, parts: object) => ({ id: `card-${place + 1}`, type, placement: { kind: "board", rowIndex: place, columnStart: 0 }, hasSavedWidgetReference: false, ...parts });
  const cards = [
    // A grid of one section: two row dimensions, two context selectors, a sorted list with hidden items, two filter
    // conditions (the second with a context of two dimensions) and two formatting rules.
    card(0, "TABLE", { title: "Demand by product", viewType: "customView", sources: [{ dataSourceType: "MULTI_AXIS_DESCRIPTION", module: DEMAND }],
      settings: { isReadOnly: true, pivotEnabled: true, allowFiltering: true, allowSorting: true, csvExportEnabled: false },
      grid: { sections: [], summary: {}, regions: [region("SINGLE", DEMAND, ["row-0", "col-0"],
        [on(PRODUCT, { sorts: [{ direction: "DESC" }], hides: [{ name: "North" }, { name: "South" }] }), on(REGION)], [on(TIME, { levels: ["LEAF"] })],
        [selector(TERRITORY, true, true), selector(CHANNEL, false)],
        { match: "ALL", conditions: [condition(VOLUME, "EQUALS", ["true"]), condition(PRICE, "GREATER_THAN", [10], [{ dimension: TERRITORY, selection: "current" }, { dimension: TIME }])] })] },
      conditionalFormatting: [{ type: "BG_COLOR", target: VOLUME, source: VOLUME, pegs: PEGS, regions: { targetRegionId: null } }, { type: "FONT", target: PRICE, source: PRICE, pegs: PEGS }] }),
    // A combined grid whose two sections share their rows, and only the first of which has context selectors.
    card(1, "TABLE", { title: "Plan and factors", viewType: "combinedGrid", grid: { sections: [], summary: {}, regions: [
      region("SINGLE", DEMAND, ["row-0", "col-0"], [on(PRODUCT)], [on(TIME)], [selector(TERRITORY, true, true), selector(CHANNEL, false)],
        { match: "ALL", conditions: [condition(VOLUME, "EQUALS", ["true"])] }),
      region("r2", FACTORS, ["row-0", "col-1"], [on(PRODUCT)], [on(LINE_ITEMS)])] } }),
    // A combined grid whose two sections share their columns, and each of which has context selectors.
    card(2, "TABLE", { title: "Plan by store", viewType: "combinedGrid", grid: { sections: [], summary: {}, regions: [
      region("SINGLE", DEMAND, ["row-0", "col-0"], [on(PRODUCT)], [on(TIME)], [selector(TERRITORY, true, true), selector(CHANNEL, false)]),
      region("r2", FACTORS, ["row-1", "col-0"], [on(REGION)], [on(TIME)], [selector(STORE, false)])] } }),
    // A saved view, whose layout has two context selectors.
    card(3, "TABLE", { title: "Exceptions", viewType: "savedView", sources: [{ module: OWNER, view: { id: "130000000901", name: "Exceptions view", moduleName: "Order summary" },
      viewLayout: { rows: [{ id: LINE_ITEMS.id, name: "Line Items" }], columns: [], pages: [{ id: "101000000906", name: "Orders" }, { id: REGION.id, name: "Region" }] } }] }),
    // A KPI with an indicator, whose formatting is a sentence with a semicolon, and two buttons.
    card(4, "CARD", { title: "Total volume", kpi: { lineItem: VOLUME, textStyle: "LARGE", numberScale: "THOUSANDS", showSparkline: true,
      indicator: { type: "THRESHOLD", threshold: { icons: [{ iconId: "ARROW_UP" }, { iconId: "FLAG_RED" }] } } } }),
    card(5, "ACTION", { actions: [{ name: "Reload plan", action: { id: "112000000901", actionType: "IMPORT", name: "Import demand" } },
      { name: "Run nightly", action: { id: "118000000901", actionType: "PROCESS" } }] }),
    // A text card's text is the user's, whatever it holds.
    card(6, "TEXT", { title: "Notes", text: { plainText: "Check the plan; then submit | review, and close." } }),
  ];
  const page: PageInput = { appName: "Planning app", categoryName: "Demand", pageName: "Plan board", pageType: "BOARD", state: "Published (no unpublished changes)",
    modelName: "Model one", workspaceName: "Workspace one", pageGuid: "page-1", appGuid: "app-1", modelId: "MODEL-1", details: { cards } as never };
  const report = buildReport([page]);
  const tables = Object.fromEntries((Object.keys(HEADERS) as TabName[]).map(tab =>
    [tab, { file: APP_FILES[tab], label: tab, headers: report[tab].headers, rows: report[tab].rows, guard: true } satisfies ResultTable])) as Record<TabName, ResultTable>;
  const app = result("app", ...Object.values(tables));
  /** What a table's drawers list, with each listed cell checked to be its items joined again. */
  const listedIn = (tab: TabName) => {
    const found = listed(app, tables[tab]);
    expectWhole(tables[tab], found);
    return found;
  };

  it("cuts a card's column at the separator the report joined it with: one for a combined grid's sections, another for any other card", () => {
    // What the report wrote, so that the cells below are its own.
    const cell = (place: number, header: string) => report.Cards.rows[place][HEADERS.Cards.indexOf(header)];
    expect([cell(1, "View type"), cell(1, "Rows"), cell(1, "Context selectors"), cell(2, "Context selectors")]).toEqual(["Combined grid (2 sections)",
      "Product (shared by all sections)", "Section 1: Territory (visible, synced to page); Channel (hidden)", "Section 1: Territory (visible, synced to page); Channel (hidden) | Section 2: Store (hidden)"]);
    const SETTINGS = ["Editable", "pivot off", "filter/sort limited", "CSV export off"];
    expect(listedIn("Cards")).toEqual([
      // A comma inside an item is the item's: a context selector's flags, the hidden items, a filter's context.
      { Rows: ["Product", "Region"], "Context selectors": ["Territory (visible, synced to page)", "Channel (hidden)"],
        Filters: ["Rows, match all: Volume [Demand] is equal to true", "Rows, match all: Price [Demand] is greater than 10 (context: Territory = current; Time = current)"],
        "Sorts & hidden items": ["Product: sorted (1 sort key)", "Product: 2 items hidden (North, South)"],
        "Conditional formatting": ["Background colour on Volume: 0 → #FFFFFF; 100,000 → #627786", "Font colour on Price: 0 → #FFFFFF; 100,000 → #627786"],
        "Card settings": ["Read-only", "pivot on", "filter/sort on", "CSV export off"] },
      // A combined grid's item is a section's. Rows that the two sections share are one item, and so are the context
      // selectors of the one section that has any: their semicolon is the section's own.
      { "Source module(s)": ["Section 1: Demand", "Section 2: Factors"],
        "Line items shown": ["Section 1: Line Items not on rows, columns or a selector", "Section 2: All line items (Line Items on columns)"],
        Columns: ["Section 1: Time", "Section 2: Line Items"], "Card settings": SETTINGS, "Source IDs": ["102000000901", "102000000902"] },
      { "Source module(s)": ["Section 1: Demand", "Section 2: Factors"],
        "Line items shown": ["Section 1: Line Items not on rows, columns or a selector", "Section 2: Line Items not on rows, columns or a selector"],
        Rows: ["Section 1: Product", "Section 2: Region"], "Context selectors": ["Section 1: Territory (visible, synced to page); Channel (hidden)", "Section 2: Store (hidden)"],
        "Card settings": SETTINGS, "Source IDs": ["102000000901", "102000000902"] },
      { "Context selectors": ["Orders", "Region"], "Card settings": SETTINGS, "Source IDs": ["102000000903", "130000000901"] },
      // The KPI's formatting is one sentence: no " | " in it, though a semicolon.
      { "Card settings": ["text LARGE", "scale THOUSANDS", "sparkline on"] },
      { "Buttons & links": ["Import: Reload plan", "Process: Run nightly"] },
      {},
    ]);
    expect([cell(4, "Conditional formatting"), cell(6, "Text content")]).toEqual(["KPI indicator (threshold): 2 icons (arrow up, flag red); no threshold values set",
      "Check the plan; then submit | review, and close."]);
  });

  it("cuts a section's, a filter's and a rule's columns at the report's separator for each, and an indicator's sentence not at all", () => {
    expect(listedIn("Grid sections")).toEqual([
      { Rows: ["Product", "Region"], "Context selectors": ["Territory (visible, synced to page)", "Channel (hidden)"],
        "Sorts & hidden items": ["Product: sorted (1 sort key)", "Product: 2 items hidden (North, South)"] },
      // A section of a combined grid lists its own context selectors, joined as a grid's are.
      { "Context selectors": ["Territory (visible, synced to page)", "Channel (hidden)"] }, {},
      { "Context selectors": ["Territory (visible, synced to page)", "Channel (hidden)"] }, {},
      { "Context selectors": ["Orders", "Region"] }]);
    // The filtered dimensions and the values are names and values with a comma between them, which either may hold.
    expect(listedIn("Filters")).toEqual([{}, { "Condition context": ["Territory = current", "Time = current"] }, { "Filtered module": ["Demand", "Factors"] }]);
    expect(report.Formatting.rows.map(row => row[HEADERS.Formatting.indexOf("Colour stops")])).toEqual(["0 → #FFFFFF; 100,000 → #627786", "0 → #FFFFFF; 100,000 → #627786",
      "2 icons (arrow up, flag red); no threshold values set"]);
    expect(listedIn("Formatting")).toEqual([{ "Colour stops": ["0 → #FFFFFF", "100,000 → #627786"] }, { "Colour stops": ["0 → #FFFFFF", "100,000 → #627786"] }, {}]);
    // The page's views by kind, in the report's words alone.
    expect(listedIn("Pages")).toEqual([{ "Grid & chart views": ["1 custom view", "1 saved view", "2 combined grids"] }]);
    expect([listedIn("Actions").every(cells => Object.keys(cells).length === 0), listedIn("Where used").every(cells => Object.keys(cells).length === 0)]).toEqual([true, true]);
  });

  it("cuts none of a card's columns that depend on the card where the table cannot say which card it is, nor a rule's stops without its style", () => {
    const withoutColumn = (table: ResultTable, header: string): ResultTable => {
      const at = table.headers.indexOf(header);
      return { ...table, headers: table.headers.filter((_, index) => index !== at), rows: table.rows.map(row => row.filter((_, index) => index !== at)) };
    };
    const cards = withoutColumn(tables.Cards, "View type");
    expect(listed(app, cards).flatMap(cells => Object.keys(cells)).filter(header => ["Source module(s)", "Line items shown", "Rows", "Columns", "Context selectors"].includes(header))).toEqual([]);
    const formatting = withoutColumn(tables.Formatting, "Format style");
    expect(listed(app, formatting)).toEqual([{}, {}, {}]);
  });
});

describe("Which cells are cut, and by which rule", () => {
  it("names only the files and the headers their producers write", () => {
    // Every app column that is cut is one the report writes, in the table it writes it in.
    for (const tab of Object.keys(HEADERS) as TabName[]) {
      expect([...LISTED_COLUMNS.app.get(APP_FILES[tab])?.keys() ?? []].filter(header => !HEADERS[tab].includes(header)), tab).toEqual([]);
    }
    expect([...LISTED_COLUMNS.app.keys()].filter(name => !Object.values(APP_FILES).includes(name))).toEqual([]);
    // Every model file named is one the export writes, under the name the page orders it by; the calendar's columns are
    // the template's.
    expect([...LISTED_COLUMNS.model.keys()].filter(name => !MODEL_FILE_ORDER.includes(name))).toEqual([]);
    expect([...LISTED_COLUMNS.model.get(MODEL_CALENDAR_FILE)?.keys() ?? []].filter(header => !CALENDAR_HEADERS.includes(header))).toEqual([]);
  });

  it("reads a file by its own kind's rules only, and finds no rule under the name of an object's built-in property", () => {
    const lineItems = file("Line Items", ["", "Applies To", "Referenced By"], [["Units", "Products, Time", "Revenue, Margin"]]);
    const cards = { ...file("Cards", ["Page", "Context selectors", "View type"], [["Overview", "Territory; Channel", "Custom view"]]), guard: true };
    expect([listed(result("model", lineItems), lineItems), listed(result("app", lineItems), lineItems)]).toEqual([[{ "Applies To": ["Products", "Time"], "Referenced By": ["Revenue", "Margin"] }], [{}]]);
    expect([listed(result("app", cards), cards), listed(result("model", cards), cards)]).toEqual([[{ "Context selectors": ["Territory", "Channel"] }], [{}]]);
    const odd = ["constructor", "__proto__", "toString", "hasOwnProperty", "valueOf"];
    for (const name of odd) {
      const table = file(name, ["", ...odd], [["x", ...odd.map(() => "a, b; c | d")]]);
      expect([listed(result("model", table), table), listed(result("app", table), table)], name).toEqual([[{}], [{}]]);
    }
    const named = file("Line Items", ["", ...odd], [["x", ...odd.map(() => "a, b; c | d")]]);
    expect(listed(result("model", named), named)).toEqual([{}]);
  });

  it("leaves a row without a cell to cut with nothing listed, and an empty cell, one item and the dash as they are", () => {
    const lineItems = file("Line Items", ["", "Applies To", "Referenced By"], [["Units", "", "Revenue"], ["Price", NONE, "-"], ["Cost", "Products", "'Margin, net'"]]);
    const lists = cellLists(result("model", lineItems), lineItems);
    expect([...lists.keys()]).toEqual([1, 2]);
    expect(lineItems.rows.map(row => rowItems(lists, row).size)).toEqual([0, 0, 0]);
  });
});
