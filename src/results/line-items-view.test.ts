import { afterEach, describe, expect, it, vi } from "vitest";
import { exportModel } from "../model/export.js";
import type { Cell, ResultTable } from "../result-types.js";
import { resultZip, tableCsv } from "../result-zip.test-support.js";
import { parseCsv, unzipText } from "../zip.test-support.js";
import { columnsOf } from "./columns.js";
import { APPLIES_TO, APPLIES_TO_FROM, APPLIES_TO_SOURCE, FORMAT_TYPE, LINE_ITEMS_FILE, lineItemsView, MODULE_NAME, type LineItemsView } from "./line-items-view.js";
import { selectRows, valueCounts } from "./table-engine.js";

// Made-up names only. The headers are the ones a real model's Line Items table has, in its order: the unnamed column with
// each row's name, the grid's 25 columns as the diagnostic log of an export lists them, then the three the export adds.
const GRID_COLUMNS = ["Format", "Formula", "Summary", "Applies To", "Time Scale", "Time Range", "Versions", "Style", "Cell Count", "Calculation Effort", "Notes",
  "Read Access Driver", "Write Access Driver", "Users List", "Parent", "Is Summary", "Formula Scope", "Code", "Use Switchover", "Breakback", "Brought-Forward",
  "Start of Section", "Data Tags", "Referenced By", "Module Name"];
const HEADERS = ["", ...GRID_COLUMNS, "Ratio Numerator", "Ratio Denominator", "Format List"];
/** The same headers as the view orders them: the module after the name, the format's data type after Format, and where
 * Applies To came from after Applies To. */
const VIEW_HEADERS = ["", "Module Name", "Format", "Format type", "Formula", "Summary", "Applies To", "Applies To from", "Time Scale", "Time Range", "Versions", "Style",
  "Cell Count", "Calculation Effort", "Notes", "Read Access Driver", "Write Access Driver", "Users List", "Parent", "Is Summary", "Formula Scope", "Code", "Use Switchover",
  "Breakback", "Brought-Forward", "Start of Section", "Data Tags", "Referenced By", "Ratio Numerator", "Ratio Denominator", "Format List"];

const NUMBER = '{"dataType":"NUMBER"}';
const NO_DATA = '{"dataType":"NONE"}';
const SUM = '{"summaryMethod":"SUM","timeSummaryMethod":"SUM"}';
const NO_SUMMARY = '{"summaryMethod":"NONE","timeSummaryMethod":"NONE"}';
/** A line item's ID, by its row in the grid: a Ratio summary names what it divides by these. */
const lineItemId = (row: number): number => 1901000000000 + row;
const RATIO = JSON.stringify({ summaryMethod: "RATIO", timeSummaryMethod: "RATIO", ratioNumeratorIdentifier: `_${lineItemId(5)}_`, ratioDenominatorIdentifier: `_${lineItemId(3)}_` });

const table = (headers: string[], rows: Cell[][], file = LINE_ITEMS_FILE): ResultTable => ({ file, label: file.replace(/\.csv$/, ""), headers, rows, guard: false });
/** A row of the real table: the cell under each header named ("" is the row's name), and an empty cell under every other. */
const real = (cells: Record<string, Cell>): Cell[] => HEADERS.map(header => (Object.hasOwn(cells, header) ? cells[header] : ""));
/** What a line item that takes its dimensions from its module holds, apart from its name. */
const measure = (inModule: string): Record<string, Cell> => ({ Format: NUMBER, Summary: SUM, "Applies To": "-", "Time Scale": "Month", Versions: "All",
  "Cell Count": "1200", "Is Summary": "false", "Start of Section": "false", "Module Name": inModule });

const REVENUE = "REV01 Revenue";
const SETTINGS = "SYS01 Settings";
const COSTS = "COST01 Costs";
/** A model of five modules, as the grid lists it: each module's own row, then its line items. Two modules have no line
 * items and only divide the list of modules, one of them at the very end. Three line items are called Revenue. */
const MODEL: Cell[][] = [
  real({ "": REVENUE, "Applies To": "Products, Regions", "Time Scale": "Month", Versions: "All" }),
  real({ "": "Units", ...measure(REVENUE) }),
  real({ "": "Price", ...measure(REVENUE), "Applies To": "Products", Summary: NO_SUMMARY }),
  real({ "": "Revenue", ...measure(REVENUE), Formula: "Units * Price" }),
  real({ "": "--- Checks ---", ...measure(REVENUE), Format: NO_DATA, Summary: NO_SUMMARY, Style: "Heading 1" }),
  real({ "": "Margin", ...measure(REVENUE), Formula: "Revenue - 'COST01 Costs'.Cost" }),
  real({ "": "Margin %", ...measure(REVENUE), Formula: "Margin / Revenue", Summary: RATIO, "Ratio Numerator": "Margin", "Ratio Denominator": "Revenue" }),
  real({ "": "------ Inputs ------" }),
  real({ "": SETTINGS, "Time Scale": "Not Applicable", Versions: "Not Applicable" }),
  real({ "": "Planning Horizon", ...measure(SETTINGS), "Time Scale": "Not Applicable", Versions: "Not Applicable", Summary: NO_SUMMARY }),
  real({ "": "Revenue", ...measure(SETTINGS), "Time Scale": "Not Applicable", Versions: "Not Applicable" }),
  real({ "": COSTS, "Applies To": "Cost Centres", "Time Scale": "Month", Versions: "All" }),
  real({ "": "Cost", ...measure(COSTS) }),
  real({ "": "Revenue", ...measure(COSTS), Formula: "'REV01 Revenue'.Revenue" }),
  real({ "": "Rate", ...measure(COSTS), "Applies To": "" }),
  real({ "": "------ Archive ------" }),
];
/** The rows of the model that are its modules' own, by their place in it. */
const MODULE_ROWS = [0, 7, 8, 11, 15];

// A smaller table of the same kind for the cases: the row's name, then these columns.
const SHORT = ["", "Format", "Applies To", "Start of Section", "Module Name", "Ratio Numerator"];
const SHORT_VIEW = ["", "Module Name", "Format", "Format type", "Applies To", "Applies To from", "Start of Section", "Ratio Numerator"];
const moduleRow = (name: string, appliesTo = ""): Cell[] => [name, "", appliesTo, "", "", ""];
const lineItem = (name: string, inModule: string, appliesTo = "-", startOfSection = "false"): Cell[] => [name, NUMBER, appliesTo, startOfSection, inModule, ""];
// And one with both of the columns that hold what every line item has and a module's own row has not.
const BOTH = ["", "Format", "Summary", "Applies To", "Module Name"];

/** What the line under the table adds where the table has Format type and line items: how its filter lists them alone. */
const FILTER_LINE = " To list only line items, untick (blank) in the filter of Format type, and No Data as well to leave out the line items that are headings.";

const column = (shown: ResultTable, header: string): Cell[] => shown.rows.map(row => row[shown.headers.indexOf(header)]);
/** What the view says of each row: its name, its module, its Applies To and where that came from. */
const said = (view: LineItemsView): Cell[][] => {
  const at = [MODULE_NAME, APPLIES_TO, APPLIES_TO_FROM].map(header => view.table.headers.indexOf(header));
  return view.table.rows.map(row => [row[0], ...at.map(index => row[index])]);
};
/** The names of the rows the view takes for modules' own, in the table's order: the page shows them as headings. */
const headings = (view: LineItemsView): Cell[] => view.table.rows.filter(row => view.headings.has(row)).map(row => row[0]);
/** The view of a table it must leave alone: the table itself, no module's row, nothing to say. */
const asItIs = (given: ResultTable): LineItemsView => ({ table: given, moduleRows: 0, headings: new Set() });

// The classic client is an untyped module graph, and so is its stand-in.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

/** The classic client's data page as far as the export reads it: a rectangle of cells from (startRow, 0). */
class FakePage {
  constructor(private readonly page: { startRow: number; rows: Cell[][] }) {}
  contains(row: number, at: number) { return row >= this.page.startRow && row < this.page.startRow + this.page.rows.length && at < (this.page.rows[0]?.length ?? 0); }
  getIndex(row: number, at: number) { return (row - this.page.startRow) * 1000 + at; }
  getCellText(index: number) { return this.page.rows[Math.floor(index / 1000)][index % 1000]; }
  getOriginalText(index: number) { return this.getCellText(index); }
}

/** The model export, run on a page whose classic client serves only the Line Items grid. `rows` are the table's rows; the
 * grid gives each as its axis does: a module's row under its own ID, a line item's under its ID and its module's. */
async function exportedLineItems(rows: Cell[][]) {
  const inModule = (row: Cell[]) => row[HEADERS.indexOf(MODULE_NAME)];
  const moduleIds = new Map(rows.flatMap((row, index): [Cell, number][] => (inModule(row) === "" ? [[row[0], 102000000000 + index]] : [])));
  const served = rows.map((row, index) => {
    const cells = row.slice(1, 1 + GRID_COLUMNS.length);
    return inModule(row) === "" ? { ids: [102000000000 + index, -1], labels: [row[0], null], cells }
      : { ids: [lineItemId(index), moduleIds.get(inModule(row))], labels: [row[0], inModule(row)], cells };
  });
  const aggregator = { isDirty: () => false, post: (request: Any, _flag: boolean, ok: (response: unknown) => boolean) => {
    const { pageRequests: [{ startRow, rowCount }] } = request.params;
    const slice = served.slice(startRow, startRow + rowCount);
    queueMicrotask(() => ok({ result: { viewRequestResults: [{ rowCount: served.length, columnCount: GRID_COLUMNS.length,
      rowLabelPages: [{ start: startRow, count: slice.length, entityLongIds: [0, 1].map(d => slice.map(row => row.ids[d])), labels: [0, 1].map(d => slice.map(row => row.labels[d])) }],
      columnLabelPages: [{ start: 0, count: GRID_COLUMNS.length, entityLongIds: [GRID_COLUMNS.map((_, index) => 4000000001 + index)], labels: [GRID_COLUMNS] }],
      dataPages: [{ startRow, rows: slice.map(row => row.cells) }] }] } }));
    return true;
  } };
  const cache = { getModelName: () => "Plan", getWorkspaceInfo: () => ({ name: "Workspace one" }), getAllCurrenciesLabelPage: () => undefined };
  const helper = { getAxesForViewDefinition: (rowAxes: string[], columnAxes: string[]) => ({ rowAxis: rowAxes[0], columnAxis: columnAxes[0] }) };
  const constants = { SYSTEM_AXIS_IDENTIFIER_MODULE_WITH_LINE_ITEM_IDENTIFIER: "LINE ITEMS", SYSTEM_AXIS_IDENTIFIER_LINE_ITEM_PROPERTY_IDENTIFIER: "LINE ITEM PROPERTIES" };
  class RequestGenerator { getRequest(params: unknown) { return { requestType: "VIEW_REQUEST_SET", submissions: [], systemActions: [], params }; } }
  class DataPage extends FakePage { constructor({ page }: Any) { super(page); } }
  vi.stubGlobal("window", { workspaceId: "0123456789abcdef0123456789abcdef", modelId: "FEDCBA9876543210FEDCBA9876543210",
    require: (_modules: string[], loaded: (...modules: unknown[]) => void) => loaded(cache, aggregator, helper, {}, constants, RequestGenerator, DataPage, {}) });
  vi.stubGlobal("location", { host: "eu2a.app.anaplan.com", pathname: "/core-webapp/anaplan/framework.jsp" });
  return exportModel({ status: () => undefined, log: () => undefined }, () => "");
}

describe("The Line Items table as the results page shows it", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("is given, by the model export, the table these cases are written on, under the file name it looks for", async () => {
    const result = await exportedLineItems(MODEL);
    // The export's files here: the one about the export itself, then the grid's, which the view knows by this name, and
    // the one the export makes from the grid's two driver columns, which hold nothing in this model.
    expect(result.tables.map(written => written.file)).toEqual(["Model Details.csv", LINE_ITEMS_FILE, "Dynamic Cell Access.csv"]);
    expect(result.tables[2].rows).toEqual([]);
    // The row's name first, the grid's columns under Anaplan's own headers, the export's three columns last. The module each
    // line item's row carries on the grid's axis is not in the table: only the Module Name column says it.
    const exported = result.tables[1];
    expect(exported).toEqual(table(HEADERS, MODEL));
    const view = lineItemsView(exported);
    expect(view).toEqual(lineItemsView(table(HEADERS, MODEL)));
    // Every row of the grid, the modules' own among them.
    expect([view.table.headers, view.table.rows.length, view.moduleRows, view.headings.size]).toEqual([VIEW_HEADERS, 16, 5, 5]);
    // The export's own details file is not the view's. And the zip still holds the grid as the export read it, row for
    // row: the view is another table, and the result's is not touched.
    expect(lineItemsView(result.tables[0]).table).toBe(result.tables[0]);
    const [headers, ...rows] = parseCsv(unzipText(resultZip(result)).get(LINE_ITEMS_FILE) ?? "");
    expect([headers, rows]).toEqual([HEADERS, MODEL]);
  });

  it("is for the model's Line Items file, and for no other", () => {
    const lineItems = table(HEADERS, MODEL);
    expect([LINE_ITEMS_FILE, lineItems.file, lineItems.label, HEADERS.length, VIEW_HEADERS.length]).toEqual(["Line Items.csv", "Line Items.csv", "Line Items", 29, 31]);
    expect(lineItemsView(lineItems).moduleRows).toBe(5);
    // The same table under any other name comes back as it is: a file is known by its whole name, as it is written.
    for (const file of ["Modules.csv", "line items.csv", "Line Items", "Line Items.csv ", "Line Items (1).csv", "Model Details.csv"]) {
      const other = { ...lineItems, file };
      expect(lineItemsView(other), file).toEqual(asItIs(other));
      expect(lineItemsView(other).table, file).toBe(other);
    }
  });

  it("shows every row in the file's order, each with its module directly after its name: a module's own row names itself and heads its line items", () => {
    const view = lineItemsView(table(SHORT, [
      moduleRow("Sales", "Products, Time"), lineItem("Units", "Sales"), lineItem("Price", "Sales", "Products"),
      moduleRow("Stock", "Warehouses"), lineItem("Units", "Stock"), lineItem("Cover", "Stock")]));
    expect(view.table).toEqual({ file: "Line Items.csv", label: "Line Items", guard: false, headers: SHORT_VIEW, rows: [
      ["Sales", "Sales", "", "", "Products, Time", "Module", "", ""],
      ["Units", "Sales", NUMBER, "Number", "Products, Time", "Module", "false", ""],
      ["Price", "Sales", NUMBER, "Number", "Products", "Line item", "false", ""],
      ["Stock", "Stock", "", "", "Warehouses", "Module", "", ""],
      ["Units", "Stock", NUMBER, "Number", "Warehouses", "Module", "false", ""],
      ["Cover", "Stock", NUMBER, "Number", "Warehouses", "Module", "false", ""]] });
    // The two modules' own rows are the view's headings: its very rows, not copies of them.
    expect([view.moduleRows, headings(view), [...view.headings].every(row => view.table.rows.includes(row as Cell[]))]).toEqual([2, ["Sales", "Stock"], true]);
    expect(view.note).toBe(`Every row of Anaplan's Line Items grid: 4 line items, and 2 modules' own rows, each in bold above its line items, with its own name under Module Name.${FILTER_LINE}`);
    // The module's name is shown once: the grid's own Module Name column, moved, not a second one.
    expect(view.table.headers.filter(header => header === MODULE_NAME)).toHaveLength(1);
    expect(SHORT_VIEW).toHaveLength(SHORT.length + 2);
  });

  it("lays a table with a real model's columns out the same way, and leaves every other column as it is", () => {
    const view = lineItemsView(table(HEADERS, MODEL));
    expect(view.table.headers).toEqual(VIEW_HEADERS);
    expect(said(view)).toEqual([
      [REVENUE, REVENUE, "Products, Regions", "Module"],
      ["Units", REVENUE, "Products, Regions", "Module"], ["Price", REVENUE, "Products", "Line item"], ["Revenue", REVENUE, "Products, Regions", "Module"],
      // A line item that only divides its module's line items is a line item: it has a module, and a format.
      ["--- Checks ---", REVENUE, "Products, Regions", "Module"],
      ["Margin", REVENUE, "Products, Regions", "Module"], ["Margin %", REVENUE, "Products, Regions", "Module"],
      // A module with no line items is a module's own row with nothing under it.
      ["------ Inputs ------", "------ Inputs ------", "", "Module"],
      // A module with no dimensions has an empty Applies To, and so have the line items that take theirs from it.
      [SETTINGS, SETTINGS, "", "Module"], ["Planning Horizon", SETTINGS, "", "Module"], ["Revenue", SETTINGS, "", "Module"],
      [COSTS, COSTS, "Cost Centres", "Module"], ["Cost", COSTS, "Cost Centres", "Module"], ["Revenue", COSTS, "Cost Centres", "Module"],
      // An empty Applies To on a line item is its own: it applies to no list, whatever its module applies to.
      ["Rate", COSTS, "", "Line item"],
      ["------ Archive ------", "------ Archive ------", "", "Module"]]);
    expect(headings(view)).toEqual(MODULE_ROWS.map(at => MODEL[at][0]));
    // Every other column holds, for each row, the very cell the file holds: Format and Summary as they stand, the export's
    // three columns too. Module Name is the file's but on a module's own row, which names itself.
    for (const header of HEADERS.filter(name => name !== APPLIES_TO && name !== MODULE_NAME)) expect(column(view.table, header), header).toEqual(MODEL.map(row => row[HEADERS.indexOf(header)]));
    expect(column(view.table, MODULE_NAME)).toEqual(MODEL.map((row, at) => (MODULE_ROWS.includes(at) ? row[0] : row[HEADERS.indexOf(MODULE_NAME)])));
    expect([column(view.table, "Format")[4], column(view.table, "Summary")[6], column(view.table, "Ratio Numerator")[6], column(view.table, "Ratio Denominator")[6]])
      .toEqual([NO_DATA, RATIO, "Margin", "Revenue"]);
    // The format's data type stands after Format: none for a module's own row, No Data for the line item that is a heading.
    expect(column(view.table, FORMAT_TYPE)).toEqual(["", "Number", "Number", "Number", "No Data", "Number", "Number", "", "", "Number", "Number", "", "Number", "Number", "Number", ""]);
    expect(view.table.rows.every(row => row.length === VIEW_HEADERS.length)).toBe(true);
    expect(view.moduleRows).toBe(5);
    expect(view.note).toBe(`Every row of Anaplan's Line Items grid: 11 line items, and 5 modules' own rows, each in bold above its line items, with its own name under Module Name.${FILTER_LINE}`);
  });

  it("tells line items of the same name apart by their module, and takes each one's Applies To from its own module", () => {
    const view = lineItemsView(table(HEADERS, MODEL));
    expect(said(view).filter(([name]) => name === "Revenue")).toEqual([
      ["Revenue", REVENUE, "Products, Regions", "Module"], ["Revenue", SETTINGS, "", "Module"], ["Revenue", COSTS, "Cost Centres", "Module"]]);
    // And a module whose name looks like a divider is a module like any other when it has line items.
    const divided = lineItemsView(table(SHORT, [moduleRow("------ Drivers ------", "Products"), lineItem("Growth %", "------ Drivers ------"), moduleRow("------ Outputs ------")]));
    expect(said(divided)).toEqual([["------ Drivers ------", "------ Drivers ------", "Products", "Module"], ["Growth %", "------ Drivers ------", "Products", "Module"],
      ["------ Outputs ------", "------ Outputs ------", "", "Module"]]);
    expect([divided.moduleRows, headings(divided)]).toEqual([2, ["------ Drivers ------", "------ Outputs ------"]]);
  });

  it("shows a line item's own Applies To as it is, and says that it is its own", () => {
    const view = lineItemsView(table(SHORT, [moduleRow("Sales", "Products, Time"),
      lineItem("Price", "Sales", "Products"), lineItem("Rate", "Sales", ""), lineItem("Quoted", "Sales", "\"Regions, EMEA\", Time"), lineItem("Spaced", "Sales", " - "),
      // Only the dash is the module's: a longer text that starts with one, or another kind of dash, is the line item's own.
      lineItem("Odd", "Sales", "-- None --"), lineItem("Long dash", "Sales", "—")]));
    expect(said(view)).toEqual([["Sales", "Sales", "Products, Time", "Module"],
      ["Price", "Sales", "Products", "Line item"], ["Rate", "Sales", "", "Line item"], ["Quoted", "Sales", "\"Regions, EMEA\", Time", "Line item"],
      ["Spaced", "Sales", "Products, Time", "Module"], ["Odd", "Sales", "-- None --", "Line item"], ["Long dash", "Sales", "—", "Line item"]]);
    expect(APPLIES_TO_SOURCE).toEqual({ module: "Module", lineItem: "Line item", notFound: "Module (not found)" });
    expect([APPLIES_TO_FROM, FORMAT_TYPE]).toEqual(["Applies To from", "Format type"]);
  });

  it("takes a dash for the module's Applies To whatever Start of Section says", () => {
    // Start of Section is a break in how the blueprint shows a module's line items, not a change of dimensions: after a
    // line item that has it ticked and an Applies To of its own, an empty one too, a dash is still the module's.
    const view = lineItemsView(table(SHORT, [
      moduleRow("Plan", "Products, Time"), lineItem("Volume", "Plan"),
      lineItem("Regional Uplift", "Plan", "Regions", "true"), lineItem("Uplift Start", "Plan"), lineItem("Uplift End", "Plan"),
      lineItem("Flat Rate", "Plan", "", "true"), lineItem("Flat Fee", "Plan"),
      lineItem("Totals", "Plan", "-", "true"), lineItem("Total Volume", "Plan"),
      moduleRow("Other", "Channels"), lineItem("Sales", "Other")]));
    expect(said(view)).toEqual([
      ["Plan", "Plan", "Products, Time", "Module"], ["Volume", "Plan", "Products, Time", "Module"],
      ["Regional Uplift", "Plan", "Regions", "Line item"], ["Uplift Start", "Plan", "Products, Time", "Module"], ["Uplift End", "Plan", "Products, Time", "Module"],
      ["Flat Rate", "Plan", "", "Line item"], ["Flat Fee", "Plan", "Products, Time", "Module"],
      ["Totals", "Plan", "Products, Time", "Module"], ["Total Volume", "Plan", "Products, Time", "Module"],
      ["Other", "Other", "Channels", "Module"], ["Sales", "Other", "Channels", "Module"]]);
    // The column itself is shown as the file has it, like every other: a module's own row has nothing in it.
    expect(column(view.table, "Start of Section")).toEqual(["", "false", "true", "false", "false", "true", "false", "true", "false", "", "false"]);
    // After such a line item too, one whose module's row is missing keeps its dash: only its module's row gives it dimensions.
    const orphans = lineItemsView(table(SHORT, [moduleRow("Zero", "Time"), lineItem("Uplift", "First", "Regions", "true"), lineItem("Next", "First")]));
    expect(said(orphans)).toEqual([["Zero", "Zero", "Time", "Module"], ["Uplift", "First", "Regions", "Line item"], ["Next", "First", "-", "Module (not found)"]]);
  });

  it("keeps a module with no line items as a heading with nothing under it, at the very end of the table too", () => {
    const view = lineItemsView(table(SHORT, [
      moduleRow("------ Inputs ------"), moduleRow("Sales", "Products"), lineItem("Units", "Sales"), moduleRow("Empty", "Regions"), moduleRow("------ Archive ------")]));
    expect(said(view)).toEqual([["------ Inputs ------", "------ Inputs ------", "", "Module"], ["Sales", "Sales", "Products", "Module"], ["Units", "Sales", "Products", "Module"],
      ["Empty", "Empty", "Regions", "Module"], ["------ Archive ------", "------ Archive ------", "", "Module"]]);
    expect([view.moduleRows, headings(view)]).toEqual([4, ["------ Inputs ------", "Sales", "Empty", "------ Archive ------"]]);
    expect(view.note).toBe(`Every row of Anaplan's Line Items grid: 1 line item, and 4 modules' own rows, each in bold above its line items, with its own name under Module Name.${FILTER_LINE}`);
    // Only modules' rows: each is shown, and the line says that there is no line item, with no word of the filter.
    const none = lineItemsView(table(SHORT, [moduleRow("------ Inputs ------")]));
    expect([none.table.headers, none.table.rows, none.moduleRows]).toEqual([SHORT_VIEW, [["------ Inputs ------", "------ Inputs ------", "", "", "", "Module", "", ""]], 1]);
    expect(none.note).toBe("Every row of Anaplan's Line Items grid: no line items, and 1 module's own row, in bold, with its own name under Module Name.");
    const two = lineItemsView(table(SHORT, [moduleRow("Inputs"), moduleRow("Outputs")]));
    expect(two.note).toBe("Every row of Anaplan's Line Items grid: no line items, and 2 modules' own rows, each in bold, with its own name under Module Name.");
  });

  it("says in one line what its rows are: how many line items, and how many modules' own rows", () => {
    const note = (rows: Cell[][], headers = SHORT) => lineItemsView(table(headers, rows)).note;
    expect(note([moduleRow("Sales"), lineItem("Units", "Sales")]))
      .toBe(`Every row of Anaplan's Line Items grid: 1 line item, and 1 module's own row, in bold above its line items, with its own name under Module Name.${FILTER_LINE}`);
    expect(note([moduleRow("Sales"), lineItem("Units", "Sales"), moduleRow("Stock"), lineItem("Units", "Stock"), moduleRow("Empty")]))
      .toBe(`Every row of Anaplan's Line Items grid: 2 line items, and 3 modules' own rows, each in bold above its line items, with its own name under Module Name.${FILTER_LINE}`);
    // A table without Format has no Format type, and the line says nothing of a filter on it.
    expect(note([["Sales", "Products", ""], ["Units", "-", "Sales"], ["Price", "Regions", "Sales"]], ["", "Applies To", "Module Name"]))
      .toBe("Every row of Anaplan's Line Items grid: 2 line items, and 1 module's own row, in bold above its line items, with its own name under Module Name.");
    // The table lists the file's rows, every one: none is lost between the file and the page, and the numbers the line is
    // made of add up to them.
    const view = lineItemsView(table(HEADERS, MODEL));
    expect([view.table.rows.length, view.moduleRows + 11]).toEqual([MODEL.length, MODEL.length]);
  });

  it("keeps a line item whose module's row is missing, with its Applies To as it is", () => {
    const view = lineItemsView(table(SHORT, [
      lineItem("First", "Lost"),
      moduleRow("Sales", "Products"), lineItem("Units", "Sales"),
      // The row above these two is another module's: theirs is not in the table.
      lineItem("Stock Units", "Stock"), lineItem("Stock Value", "Stock", "Warehouses"),
      // A module's row that comes after its line items is not above them.
      lineItem("Late", "Costs"), moduleRow("Costs", "Cost Centres"), lineItem("Cost", "Costs")]));
    expect(said(view)).toEqual([
      ["First", "Lost", "-", "Module (not found)"],
      ["Sales", "Sales", "Products", "Module"], ["Units", "Sales", "Products", "Module"],
      ["Stock Units", "Stock", "-", "Module (not found)"], ["Stock Value", "Stock", "Warehouses", "Line item"],
      ["Late", "Costs", "-", "Module (not found)"], ["Costs", "Costs", "Cost Centres", "Module"], ["Cost", "Costs", "Cost Centres", "Module"]]);
    expect([view.moduleRows, headings(view)]).toEqual([2, ["Sales", "Costs"]]);
    // A module's name is matched whole and as it is written.
    const near = lineItemsView(table(SHORT, [moduleRow("Sales", "Products"), lineItem("Lower", "sales"), lineItem("Longer", "Sales Plan"), lineItem("Spaced", "Sales ")]));
    expect(column(near.table, APPLIES_TO_FROM)).toEqual(["Module", "Module (not found)", "Module (not found)", "Module (not found)"]);
  });

  it("keeps a line item that has no Module Name: it is a line item whose module is not known, not a module's own row", () => {
    // One module with three line items, as a read that lost a cell gives it: the second names no module, and has a Format.
    const view = lineItemsView(table(HEADERS, [
      real({ "": REVENUE, "Applies To": "Products, Regions", "Time Scale": "Month", Versions: "All" }),
      real({ "": "Units", ...measure(REVENUE) }),
      real({ "": "Price", ...measure(REVENUE), "Module Name": "" }),
      real({ "": "Revenue", ...measure(REVENUE), Formula: "Units * Price" })]));
    // It stays where the file has it, with its dash as it is: whose Applies To the dash stands for is not known. The line
    // item after it is its module's, as the one before it.
    expect(said(view)).toEqual([[REVENUE, REVENUE, "Products, Regions", "Module"], ["Units", REVENUE, "Products, Regions", "Module"], ["Price", "", "-", "Module (not found)"],
      ["Revenue", REVENUE, "Products, Regions", "Module"]]);
    // One row is the module's own, and it has its format's data type like any line item.
    expect([view.moduleRows, view.table.rows.length, column(view.table, FORMAT_TYPE)]).toEqual([1, 4, ["", "Number", "Number", "Number"]]);
    expect(view.note).toBe(`Every row of Anaplan's Line Items grid: 3 line items, and 1 module's own row, in bold above its line items, with its own name under Module Name.${FILTER_LINE}`
      + " 1 line item has no Module Name: its module is not known.");
  });

  it("keeps a line item's row that is cut short before its Module Name the same way", () => {
    const cut = real({ "": "Price", ...measure(REVENUE) }).slice(0, HEADERS.indexOf(APPLIES_TO) + 1);
    expect(cut).toEqual(["Price", NUMBER, "", SUM, "-"]);
    const view = lineItemsView(table(HEADERS, [
      real({ "": REVENUE, "Applies To": "Products, Regions", "Time Scale": "Month", Versions: "All" }),
      real({ "": "Units", ...measure(REVENUE) }), cut, real({ "": "Revenue", ...measure(REVENUE), Formula: "Units * Price" })]));
    expect(said(view)).toEqual([[REVENUE, REVENUE, "Products, Regions", "Module"], ["Units", REVENUE, "Products, Regions", "Module"], ["Price", "", "-", "Module (not found)"],
      ["Revenue", REVENUE, "Products, Regions", "Module"]]);
    // The cells the row does not have are empty ones in the view, as everywhere on the page.
    const shown: Record<string, Cell> = { "": "Price", Format: NUMBER, "Format type": "Number", Summary: SUM, "Applies To": "-", "Applies To from": "Module (not found)" };
    expect(view.table.rows[2]).toEqual(VIEW_HEADERS.map(header => (Object.hasOwn(shown, header) ? shown[header] : "")));
    expect([view.moduleRows, view.table.rows.length]).toEqual([1, 4]);
    expect(view.note).toBe(`Every row of Anaplan's Line Items grid: 3 line items, and 1 module's own row, in bold above its line items, with its own name under Module Name.${FILTER_LINE}`
      + " 1 line item has no Module Name: its module is not known.");
  });

  it("takes a row for a module's own only when it names no module and has nothing that only a line item has", () => {
    const view = lineItemsView(table(BOTH, [
      ["Sales", "", "", "Products", ""],
      // No module named, but a Format, a Summary or both: a line item whose module is not known. Its dash stays.
      ["Both", NUMBER, SUM, "-", ""], ["Format only", NUMBER, "", "-", ""], ["Summary only", "", SUM, "-", ""], ["Spaces", NUMBER, SUM, "-", "  "],
      // An Applies To of its own is its own, as any line item's. Of an empty one nothing is said: the read that gave no
      // Module Name for the row may have given no Applies To either.
      ["Own", NUMBER, SUM, "Regions", ""], ["Empty", NUMBER, SUM, "", ""],
      // A module named: a line item, whatever it lacks, a name of its own included. The rows above did not end its module.
      ["Bare", "", "", "-", "Sales"], ["", NUMBER, SUM, "-", "Sales"],
      // No module named and neither of the two, also when only spaces stand in those cells: a module's own row.
      ["Stock", " ", "  ", "Warehouses", " "], ["Cover", NUMBER, SUM, "-", "Stock"],
      // A row with nothing but its name is one too: without the model's module names it cannot be told from a module that has no line items.
      ["Lost"]]));
    expect(said(view)).toEqual([
      ["Sales", "Sales", "Products", "Module"],
      ["Both", "", "-", "Module (not found)"], ["Format only", "", "-", "Module (not found)"], ["Summary only", "", "-", "Module (not found)"], ["Spaces", "  ", "-", "Module (not found)"],
      ["Own", "", "Regions", "Line item"], ["Empty", "", "", ""],
      ["Bare", "Sales", "Products", "Module"], ["", "Sales", "Products", "Module"],
      ["Stock", "Stock", "Warehouses", "Module"], ["Cover", "Stock", "Warehouses", "Module"],
      ["Lost", "Lost", "", "Module"]]);
    expect([view.moduleRows, headings(view)]).toEqual([3, ["Sales", "Stock", "Lost"]]);
    // A module's own row has no format's data type, nor has a line item without a Format.
    expect(column(view.table, FORMAT_TYPE)).toEqual(["", "Number", "Number", "", "Number", "Number", "Number", "", "Number", "", "Number", ""]);
    expect(view.note).toBe(`Every row of Anaplan's Line Items grid: 9 line items, and 3 modules' own rows, each in bold above its line items, with its own name under Module Name.${FILTER_LINE}`
      + " 6 line items have no Module Name: their module is not known.");
    // A line item that names no module is no module's, not even of a module's row that has no name.
    const nameless = lineItemsView(table(BOTH, [["", "", "", "Products", ""], ["Lost", NUMBER, SUM, "-", ""]]));
    expect(said(nameless)).toEqual([["", "", "Products", "Module"], ["Lost", "", "-", "Module (not found)"]]);
    // A module's own row that is cut short is still one: a cell a row does not have is an empty one.
    expect(lineItemsView(table(SHORT, [["Sales", "", "Products"], lineItem("Units", "Sales")])).table.rows)
      .toEqual([["Sales", "Sales", "", "", "Products", "Module", "", ""], ["Units", "Sales", NUMBER, "Number", "Products", "Module", "false", ""]]);
  });

  it("reads whichever of Format, Formula and Summary the table has, and takes any row that names no module for a module's own when it has none of them", () => {
    const formatOnly = lineItemsView(table(SHORT, [moduleRow("Sales", "Products"), ["Lost", NUMBER, "-", "false", "", ""], lineItem("Units", "Sales")]));
    expect(said(formatOnly)).toEqual([["Sales", "Sales", "Products", "Module"], ["Lost", "", "-", "Module (not found)"], ["Units", "Sales", "Products", "Module"]]);
    const summaryOnly = lineItemsView(table(["", "Summary", "Applies To", "Module Name"], [["Sales", "", "Products", ""], ["Lost", SUM, "-", ""], ["Units", SUM, "-", "Sales"]]));
    expect(said(summaryOnly)).toEqual([["Sales", "Sales", "Products", "Module"], ["Lost", "", "-", "Module (not found)"], ["Units", "Sales", "Products", "Module"]]);
    // Without Format there is no format's data type to say.
    expect(summaryOnly.table.headers).toEqual(["", "Module Name", "Summary", "Applies To", "Applies To from"]);
    // A module's own row has no formula: a row with one is a line item, with no Format, no Summary and no Module Name too.
    const formulaOnly = lineItemsView(table(["", "Formula", "Applies To", "Module Name"], [["Sales", "", "Products", ""], ["Lost", "Units * 2", "-", ""], ["Units", "", "-", "Sales"]]));
    expect([said(formulaOnly), formulaOnly.moduleRows]).toEqual([[["Sales", "Sales", "Products", "Module"], ["Lost", "", "-", "Module (not found)"], ["Units", "Sales", "Products", "Module"]], 1]);
    const all = lineItemsView(table(["", "Format", "Formula", "Summary", "Applies To", "Module Name"], [
      ["Sales", "", "", "", "Products", ""], ["Lost", "", "Units * 2", "", "-", ""], ["Units", NUMBER, "", SUM, "-", "Sales"], ["Spaces", "", "  ", "", "Regions", ""]]));
    // A formula of only spaces is none: that row is a module's own.
    expect([said(all), all.moduleRows]).toEqual([[["Sales", "Sales", "Products", "Module"], ["Lost", "", "-", "Module (not found)"], ["Units", "Sales", "Products", "Module"],
      ["Spaces", "Spaces", "Regions", "Module"]], 2]);
    expect(all.note).toBe(`Every row of Anaplan's Line Items grid: 2 line items, and 2 modules' own rows, each in bold above its line items, with its own name under Module Name.${FILTER_LINE}`
      + " 1 line item has no Module Name: its module is not known.");
    // None of the three columns: nothing in the table tells such a row from a module's own, and it is taken for one, as
    // before. The line item after it then names a module that is not the row above it.
    const none = lineItemsView(table(["", "Notes", "Applies To", "Module Name"], [["Sales", "", "Products", ""], ["Lost", "Checked", "-", ""], ["Units", "", "-", "Sales"]]));
    expect([said(none), none.moduleRows]).toEqual([[["Sales", "Sales", "Products", "Module"], ["Lost", "Lost", "-", "Module"], ["Units", "Sales", "-", "Module (not found)"]], 2]);
    // The first column is the row's name whatever its header says: one headed Format is not the grid's Format, and the
    // view adds no data type after it.
    const headed = lineItemsView(table(["Format", "Applies To", "Module Name"], [["Sales", "Products", ""], ["Units", "-", "Sales"]]));
    expect([said(headed), headed.moduleRows, headed.table.headers]).toEqual([[["Sales", "Sales", "Products", "Module"], ["Units", "Sales", "Products", "Module"]], 1,
      ["Format", "Module Name", "Applies To", "Applies To from"]]);
  });

  it("shows a module's own row the same whether line items stand under it or not, and counts the line items that name no module", () => {
    const view = lineItemsView(table(BOTH, [
      // Every line item of this module lost its Module Name: they stand under its row, and are line items all the same.
      ["Sales", "", "", "Products", ""], ["Units", NUMBER, SUM, "-", ""], ["Price", NUMBER, SUM, "Regions", ""],
      ["Stock", "", "", "Warehouses", ""], ["Cover", NUMBER, SUM, "-", "Stock"],
      ["------ Archive ------", "", "", "", ""]]));
    expect(said(view)).toEqual([["Sales", "Sales", "Products", "Module"], ["Units", "", "-", "Module (not found)"], ["Price", "", "Regions", "Line item"],
      ["Stock", "Stock", "Warehouses", "Module"], ["Cover", "Stock", "Warehouses", "Module"], ["------ Archive ------", "------ Archive ------", "", "Module"]]);
    expect([view.moduleRows, headings(view)]).toEqual([3, ["Sales", "Stock", "------ Archive ------"]]);
    expect(view.note).toBe(`Every row of Anaplan's Line Items grid: 3 line items, and 3 modules' own rows, each in bold above its line items, with its own name under Module Name.${FILTER_LINE}`
      + " 2 line items have no Module Name: their module is not known.");
    // Nor do line items under its row that name another module make it any other: whose they are is not known.
    const foreign = lineItemsView(table(BOTH, [["Sales", "", "", "Products", ""], ["Units", NUMBER, SUM, "-", "Stock"], ["Empty", "", "", "Regions", ""], ["Costs", "", "", "", ""]]));
    expect([said(foreign), foreign.moduleRows]).toEqual([[["Sales", "Sales", "Products", "Module"], ["Units", "Stock", "-", "Module (not found)"], ["Empty", "Empty", "Regions", "Module"],
      ["Costs", "Costs", "", "Module"]], 3]);
    expect(foreign.note).toBe(`Every row of Anaplan's Line Items grid: 1 line item, and 3 modules' own rows, each in bold above its line items, with its own name under Module Name.${FILTER_LINE}`);
  });

  it("with the model's module names, keeps a row that holds only its name and is no module's, among its module's line items", () => {
    // One module with three line items, as a read that lost a row's cells gives it: of the second only the name is there.
    const rows = [real({ "": REVENUE, "Applies To": "Products, Regions", "Time Scale": "Month", Versions: "All" }),
      real({ "": "Units", ...measure(REVENUE) }), real({ "": "Price" }), real({ "": "Revenue", ...measure(REVENUE), Formula: "Units * Price" })];
    const view = lineItemsView(table(HEADERS, rows), new Set([REVENUE, COSTS]));
    // No module is called Price: it is a line item, in its place. Nothing but its name is known of it, and nothing is said
    // of its Applies To. The line item after it is its module's, as the one before it.
    expect(said(view)).toEqual([[REVENUE, REVENUE, "Products, Regions", "Module"], ["Units", REVENUE, "Products, Regions", "Module"], ["Price", "", "", ""],
      ["Revenue", REVENUE, "Products, Regions", "Module"]]);
    expect([view.moduleRows, view.table.rows.length]).toEqual([1, 4]);
    expect(view.note).toBe(`Every row of Anaplan's Line Items grid: 3 line items, and 1 module's own row, in bold above its line items, with its own name under Module Name.${FILTER_LINE}`
      + " 1 line item has no Module Name: its module is not known.");
    // Without the names such a row cannot be told from a module's own and is taken for one, as before: it heads the line
    // item after it, which keeps its dash.
    const before = lineItemsView(table(HEADERS, rows));
    expect(said(before)).toEqual([[REVENUE, REVENUE, "Products, Regions", "Module"], ["Units", REVENUE, "Products, Regions", "Module"], ["Price", "Price", "", "Module"],
      ["Revenue", REVENUE, "-", "Module (not found)"]]);
    expect([before.moduleRows, before.note]).toEqual([2,
      `Every row of Anaplan's Line Items grid: 2 line items, and 2 modules' own rows, each in bold above its line items, with its own name under Module Name.${FILTER_LINE}`]);
  });

  it("with the model's module names, keeps such a row as the last under its module, as a line item", () => {
    const rows = [real({ "": REVENUE, "Applies To": "Products, Regions", "Time Scale": "Month", Versions: "All" }),
      real({ "": "Units", ...measure(REVENUE) }), real({ "": "Price" }),
      real({ "": COSTS, "Applies To": "Cost Centres", "Time Scale": "Month", Versions: "All" }), real({ "": "Cost", ...measure(COSTS) })];
    const view = lineItemsView(table(HEADERS, rows), new Set([REVENUE, COSTS]));
    expect(said(view)).toEqual([[REVENUE, REVENUE, "Products, Regions", "Module"], ["Units", REVENUE, "Products, Regions", "Module"], ["Price", "", "", ""],
      [COSTS, COSTS, "Cost Centres", "Module"], ["Cost", COSTS, "Cost Centres", "Module"]]);
    expect([view.moduleRows, view.table.rows.length, headings(view)]).toEqual([2, 5, [REVENUE, COSTS]]);
    expect(view.note).toBe(`Every row of Anaplan's Line Items grid: 3 line items, and 2 modules' own rows, each in bold above its line items, with its own name under Module Name.${FILTER_LINE}`
      + " 1 line item has no Module Name: its module is not known.");
    // Without the names it is taken for a module's own row, with nothing under it, as before.
    const before = lineItemsView(table(HEADERS, rows));
    expect(said(before)).toEqual([[REVENUE, REVENUE, "Products, Regions", "Module"], ["Units", REVENUE, "Products, Regions", "Module"], ["Price", "Price", "", "Module"],
      [COSTS, COSTS, "Cost Centres", "Module"], ["Cost", COSTS, "Cost Centres", "Module"]]);
    expect([before.moduleRows, headings(before)]).toEqual([3, [REVENUE, "Price", COSTS]]);
    expect(before.note).toBe(`Every row of Anaplan's Line Items grid: 2 line items, and 3 modules' own rows, each in bold above its line items, with its own name under Module Name.${FILTER_LINE}`);
  });

  it("with the names, takes a row for a module's own when its name is a module's: one of the names, or one a line item of the file gives as its module", () => {
    const view = lineItemsView(table(BOTH, [
      ["Sales", "", "", "Products", ""], ["Units", NUMBER, SUM, "-", "Sales"],
      // A module with no line items is among the names: its row is its own, as before.
      ["------ Archive ------", "", "", "", ""],
      // The names do not list this one, but its line item names it: that makes it a module, whatever the names hold.
      ["Stock", "", "", "Warehouses", ""], ["Cover", NUMBER, SUM, "-", "Stock"],
      // Neither: a line item whose module is not known. What its cells hold is shown as it is, a row that holds nothing too.
      ["Old", "", "", "Regions", ""], ["Dash", "", "", "-", ""], ["Nothing", "", "", "", ""], ["", "", "", "", ""]]), new Set(["Sales", "------ Archive ------"]));
    expect(said(view)).toEqual([["Sales", "Sales", "Products", "Module"], ["Units", "Sales", "Products", "Module"], ["------ Archive ------", "------ Archive ------", "", "Module"],
      ["Stock", "Stock", "Warehouses", "Module"], ["Cover", "Stock", "Warehouses", "Module"],
      ["Old", "", "Regions", "Line item"], ["Dash", "", "-", "Module (not found)"], ["Nothing", "", "", ""], ["", "", "", ""]]);
    expect([view.moduleRows, headings(view)]).toEqual([3, ["Sales", "------ Archive ------", "Stock"]]);
    expect(view.note).toBe(`Every row of Anaplan's Line Items grid: 6 line items, and 3 modules' own rows, each in bold above its line items, with its own name under Module Name.${FILTER_LINE}`
      + " 4 line items have no Module Name: their module is not known.");
    // A name is matched whole and as it is written.
    const near = lineItemsView(table(BOTH, [["Sales", "", "", "Products", ""], ["Stock", "", "", "Regions", ""], ["Cover", NUMBER, SUM, "-", "Stock"]]), new Set(["sales", "Sales ", "Sale"]));
    expect([said(near), near.moduleRows]).toEqual([[["Sales", "", "Products", "Line item"], ["Stock", "Stock", "Regions", "Module"], ["Cover", "Stock", "Regions", "Module"]], 1]);
    // Names that list none of the file's modules leave the ones that line items name, and no other.
    const unlisted = lineItemsView(table(BOTH, [["Sales", "", "", "Products", ""], ["Units", NUMBER, SUM, "-", "Sales"], ["Archive", "", "", "", ""]]), new Set());
    expect([said(unlisted), unlisted.moduleRows]).toEqual([[["Sales", "Sales", "Products", "Module"], ["Units", "Sales", "Products", "Module"], ["Archive", "", "", ""]], 1]);
    // Where they leave none, no row is a module's own, and the file is shown as it is.
    const none = table(BOTH, [["Sales", "", "", "Products", ""], ["Archive", "", "", "", ""]]);
    expect(lineItemsView(none, new Set(["Other"]))).toEqual(asItIs(none));
    expect(lineItemsView(none, new Set(["Other"])).table).toBe(none);
    // With every module's name among them, a table reads as it does without them.
    const names = new Set([REVENUE, SETTINGS, COSTS, "------ Inputs ------", "------ Archive ------"]);
    expect(lineItemsView(table(HEADERS, MODEL), names)).toEqual(lineItemsView(table(HEADERS, MODEL)));
  });

  it("takes a row that holds only a module's name for that module's own row, a line item of that name too", () => {
    // A line item can be called as a module is. Of this one the read gave only the name: by its cells it is what every
    // module's own row is, and it is taken for one. The line item after it then keeps its dash: the row above it is not
    // its module's.
    const view = lineItemsView(table(BOTH, [
      ["Sales", "", "", "Products", ""], ["Units", NUMBER, SUM, "-", "Sales"], ["Stock", "", "", "", ""], ["Price", NUMBER, SUM, "-", "Sales"],
      ["Stock", "", "", "Warehouses", ""], ["Cover", NUMBER, SUM, "-", "Stock"]]), new Set(["Sales", "Stock"]));
    expect(said(view)).toEqual([["Sales", "Sales", "Products", "Module"], ["Units", "Sales", "Products", "Module"], ["Stock", "Stock", "", "Module"],
      ["Price", "Sales", "-", "Module (not found)"], ["Stock", "Stock", "Warehouses", "Module"], ["Cover", "Stock", "Warehouses", "Module"]]);
    expect(view.moduleRows).toBe(3);
    // With something only a line item has, a Formula here, it is a line item whatever it is called.
    const formula = lineItemsView(table(["", "Formula", "Applies To", "Module Name"], [["Sales", "", "Products", ""], ["Stock", "Units * 2", "-", ""], ["Price", "", "-", "Sales"]]), new Set(["Sales", "Stock"]));
    expect([said(formula), formula.moduleRows]).toEqual([[["Sales", "Sales", "Products", "Module"], ["Stock", "", "-", "Module (not found)"], ["Price", "Sales", "Products", "Module"]], 1]);
  });

  it("takes names that differ only by the spaces around them for different names, wherever it compares a module's name", () => {
    // With the Modules file's names: a row that holds only a name is a module's own when its name is one of them as it is
    // written. With a space before it or after it, it is another name, and the row is a line item.
    const listed = lineItemsView(table(BOTH, [["Stock", "", "", "Warehouses", ""], ["Cover", NUMBER, SUM, "-", "Stock"],
      [" Sales", "", "", "Products", ""], ["Sales ", "", "", "Regions", ""], ["Sales", "", "", "Channels", ""]]), new Set(["Sales", "Stock"]));
    expect([said(listed), listed.moduleRows]).toEqual([
      [["Stock", "Stock", "Warehouses", "Module"], ["Cover", "Stock", "Warehouses", "Module"], [" Sales", "", "Products", "Line item"], ["Sales ", "", "Regions", "Line item"],
        ["Sales", "Sales", "Channels", "Module"]], 2]);
    // The same the other way round: a name the Modules file writes with a space is not the name of a row without it.
    const spaced = lineItemsView(table(BOTH, [["Stock", "", "", "Warehouses", ""], ["Cover", NUMBER, SUM, "-", "Stock"], ["Sales", "", "", "Channels", ""]]), new Set([" Sales", "Sales ", "Stock"]));
    expect([said(spaced), spaced.moduleRows]).toEqual([[["Stock", "Stock", "Warehouses", "Module"], ["Cover", "Stock", "Warehouses", "Module"], ["Sales", "", "Channels", "Line item"]], 1]);

    // With the names a line item gives as its module (the names given list none here): "Sales " makes no module of the row
    // Sales, and Stock none of the row "Stock ". Only Costs is named as it is written.
    const named = lineItemsView(table(BOTH, [
      ["Sales", "", "", "Products", ""], ["Units", NUMBER, SUM, "-", "Sales "],
      ["Stock ", "", "", "Warehouses", ""], ["Cover", NUMBER, SUM, "-", "Stock"],
      ["Costs", "", "", "Regions", ""], ["Rent", NUMBER, SUM, "-", "Costs"]]), new Set());
    expect([said(named), named.moduleRows]).toEqual([[
      ["Sales", "", "Products", "Line item"], ["Units", "Sales ", "-", "Module (not found)"],
      ["Stock ", "", "Warehouses", "Line item"], ["Cover", "Stock", "-", "Module (not found)"],
      ["Costs", "Costs", "Regions", "Module"], ["Rent", "Costs", "Regions", "Module"]], 1]);

    // And where a line item's Module Name is compared with the module's row above it: the row is called "Sales ", so it is
    // the module of the line item that names "Sales ", and not of the one that names Sales.
    const above = lineItemsView(table(BOTH, [["Sales ", "", "", "Products", ""], ["Units", NUMBER, SUM, "-", "Sales"], ["Price", NUMBER, SUM, "-", "Sales "]]));
    expect(said(above)).toEqual([["Sales ", "Sales ", "Products", "Module"], ["Units", "Sales", "-", "Module (not found)"], ["Price", "Sales ", "Products", "Module"]]);
    // Only a Module Name of nothing but spaces is no name at all: its row names no module, and it makes no module of a
    // row that is called by those spaces.
    const blank = lineItemsView(table(BOTH, [["Sales", "", "", "Products", ""], ["Units", NUMBER, SUM, "-", " "], [" ", "", "", "Regions", ""]]), new Set(["Sales"]));
    expect([said(blank), blank.note]).toEqual([[["Sales", "Sales", "Products", "Module"], ["Units", " ", "-", "Module (not found)"], [" ", "", "Regions", "Line item"]],
      `Every row of Anaplan's Line Items grid: 2 line items, and 1 module's own row, in bold above its line items, with its own name under Module Name.${FILTER_LINE}`
        + " 2 line items have no Module Name: their module is not known."]);
  });

  it("reads the table as before when the names are not given, or are no set of names", () => {
    const given = table(BOTH, [["Sales", "", "", "Products", ""], ["Units", NUMBER, SUM, "-", "Sales"], ["Lost", "", "", "", ""]]);
    const before = lineItemsView(given);
    expect([said(before), before.moduleRows]).toEqual([[["Sales", "Sales", "Products", "Module"], ["Units", "Sales", "Products", "Module"], ["Lost", "Lost", "", "Module"]], 2]);
    const odd: unknown[] = [undefined, null, ["Sales"], "Sales", 7, {}, { has: "Sales" }];
    odd.forEach((names, index) => expect(lineItemsView(given, names as never), `case ${index}`).toEqual(before));
    // The names say otherwise of the last row: it is no module's.
    expect(said(lineItemsView(given, new Set(["Sales"])))).toEqual([["Sales", "Sales", "Products", "Module"], ["Units", "Sales", "Products", "Module"], ["Lost", "", "", ""]]);
    // Names that cannot be asked give the table back as it is: the view never throws.
    const broken = { has: (): never => { throw new Error("no names"); } };
    expect(lineItemsView(given, broken as never)).toEqual(asItIs(given));
    expect(lineItemsView(given, broken as never).table).toBe(given);
  });

  it("returns the table as it is, with no note, when it lacks a column the view reads, or any module's own row", () => {
    const rows = [["Sales", "", "Products", "", "", ""], ["Units", NUMBER, "-", "false", "Sales", ""]];
    const without = (header: string) => table(SHORT.map(name => (name === header ? `${name} (old)` : name)), rows);
    for (const given of [without(MODULE_NAME), without(APPLIES_TO), table(SHORT.map(name => name.toLowerCase()), rows), table(["", "Format"], [["Units", NUMBER]]),
      // The row's name is the first column: neither of the two can stand there, whatever the rows under them hold.
      table(["Module Name", "Applies To"], [["", "Products"], ["Sales", "-"]]), table(["Applies To", "Module Name"], [["Products", ""], ["-", "Sales"]]),
      table([], rows), table([], []),
      // No row is a module's own: only line items, or modules' rows that name themselves as their module. Such a table is not
      // the grid as the view knows it, and no line item's module could be found in it.
      table(SHORT, [lineItem("Units", "Sales"), lineItem("Price", "Sales", "Products")]),
      table(SHORT, [["Sales", "", "Products", "", "Sales", ""], lineItem("Units", "Sales")]),
      // Nor is a line item that names no module one.
      table(BOTH, [["Units", NUMBER, SUM, "-", ""], ["Price", NUMBER, SUM, "Products", "Sales"]])]) {
      const view = lineItemsView(given);
      expect(view, given.headers.join("|")).toEqual(asItIs(given));
      expect(view.table, given.headers.join("|")).toBe(given);
      expect("note" in view).toBe(false);
    }
    // Only the two are needed: a table with no other column of the grid is viewed.
    const least = lineItemsView(table(["", "Applies To", "Module Name"], [["Plan", "Products", ""], ["Uplift", "Regions", "Plan"], ["After", "-", "Plan"]]));
    expect(least.table).toMatchObject({ headers: ["", "Module Name", "Applies To", "Applies To from"],
      rows: [["Plan", "Plan", "Products", "Module"], ["Uplift", "Plan", "Regions", "Line item"], ["After", "Plan", "Products", "Module"]] });
    // The view of a view is the view: every row of it names its module, so none is a module's own.
    const view = lineItemsView(table(SHORT, rows));
    expect(lineItemsView(view.table)).toEqual(asItIs(view.table));
    expect(lineItemsView(view.table).table).toBe(view.table);
  });

  it("returns an empty table as it is", () => {
    for (const empty of [table(HEADERS, []), table(SHORT, [])]) {
      const view = lineItemsView(empty);
      expect(view).toEqual(asItIs(empty));
      expect(view.table).toBe(empty);
      expect("note" in view).toBe(false);
    }
  });

  it("never throws: whatever it cannot read comes back as it is", () => {
    const good = table(SHORT, [moduleRow("Sales", "Products"), lineItem("Units", "Sales")]);
    expect(lineItemsView(good).moduleRows).toBe(1);
    const odd: unknown[] = [null, undefined, 7, "Line Items.csv", {}, [], { file: LINE_ITEMS_FILE }, { ...good, headers: undefined }, { ...good, headers: null },
      { ...good, headers: "Module Name,Applies To" }, { ...good, headers: ",Format,Applies To,Start of Section,Module Name,Ratio Numerator" },
      { ...good, rows: undefined }, { ...good, rows: null }, { ...good, rows: 5 }, { ...good, rows: [null] }, { ...good, rows: [...good.rows, undefined] },
      { ...good, rows: [...good.rows, "Units,Sales"] }, { ...good, rows: [...good.rows, { 0: "Units", 4: "Sales", length: 6 }] },
      { ...good, get rows(): never { throw new Error("no rows"); } }];
    odd.forEach((given, index) => {
      const view = lineItemsView(given as never);
      expect(view.table, `case ${index}`).toBe(given);
      expect([view.moduleRows, view.headings.size, "note" in view], `case ${index}`).toEqual([0, 0, false]);
    });
    // A cell that is not there is an empty cell, as the page reads it: a hole in a row, or nothing where text should be.
    const holed = lineItem("Units", "Sales");
    delete holed[5];
    const view = lineItemsView({ ...good, rows: [["Sales", null, "Products", undefined, null, ""], holed, ["Price", NUMBER, "-", undefined, "Sales", null]] } as never);
    expect(view.table.rows).toEqual([["Sales", "Sales", "", "", "Products", "Module", "", ""], ["Units", "Sales", NUMBER, "Number", "Products", "Module", "false", ""],
      ["Price", "Sales", NUMBER, "Number", "Products", "Module", "", ""]]);
    expect(view.table.rows.every(row => Object.keys(row).length === SHORT_VIEW.length)).toBe(true);
    expect(view.moduleRows).toBe(1);
  });

  it("keeps cells plain and as they are: a number stays a number, and a row's cells beyond the headers stay after them", () => {
    const given = table(SHORT, [
      [2024, "", 12, "", "", ""], ["Units", NUMBER, "-", "false", 2024, 0], [7, NUMBER, "-", "false", "2024", 1.5],
      moduleRow("Sales", "Products"), [...lineItem("Long", "Sales"), "beyond", 9], ["Short", NUMBER, "-", "false", "Sales"], ["Own", NUMBER, 3, "false", "Sales", ""]]);
    const before = structuredClone(given);
    const csv = tableCsv(given);
    const view = lineItemsView(given);
    expect(view.table.rows).toEqual([
      // A module called 2024 is the same module whether a cell holds the number or its text; its Applies To is the cell
      // itself, and its own row names it as it is.
      [2024, 2024, "", "", 12, "Module", "", ""], ["Units", 2024, NUMBER, "Number", 12, "Module", "false", 0], [7, "2024", NUMBER, "Number", 12, "Module", "false", 1.5],
      ["Sales", "Sales", "", "", "Products", "Module", "", ""],
      ["Long", "Sales", NUMBER, "Number", "Products", "Module", "false", "", "beyond", 9], ["Short", "Sales", NUMBER, "Number", "Products", "Module", "false", ""],
      ["Own", "Sales", NUMBER, "Number", 3, "Line item", "false", ""]]);
    expect(view.table.rows.flat().every(cell => typeof cell === "string" || (typeof cell === "number" && Number.isFinite(cell)))).toBe(true);
    // The table given is not touched: written as a CSV, it is the text it was. The view is another table.
    expect(given).toEqual(before);
    expect(tableCsv(given)).toBe(csv);
    expect(view.table).not.toBe(given);
    expect([view.table.rows === given.rows, view.table.headers === given.headers, view.table.rows.some(row => given.rows.includes(row))]).toEqual([false, false, false]);
    expect(tableCsv(view.table)).not.toBe(csv);
  });

  it("says each line item's data type under Format type, by the Format dialog's labels, and none for a module's own row", () => {
    const typed = (format: Cell): Cell[] => ["Item", format, "-", "false", "Plan", ""];
    const formats: [Cell, string][] = [
      [NUMBER, "Number"], ['{"dataType":"BOOLEAN"}', "Boolean"], ['{"dataType":"DATE"}', "Date"],
      ['{"dataType":"TIME_ENTITY","periodType":{"entityId":"MONTH","entityLabel":"Month"}}', "Time Period"],
      ['{"dataType":"ENTITY","hierarchyEntityLongId":101000000007}', "List"], ['{"dataType":"TEXT","textType":"DRILLTHRU_URI"}', "Text"], [NO_DATA, "No Data"],
      // A data type no label is known for is said as the cell holds it; a format that names none, or is no definition, says nothing.
      ['{"dataType":"DURATION"}', "DURATION"], ["{}", ""], ['{"dataType":7}', ""], ['{"dataType":', ""], ["Number", ""]];
    const view = lineItemsView(table(SHORT, [moduleRow("Plan", "Products"), ...formats.map(([format]) => typed(format))]));
    expect(column(view.table, FORMAT_TYPE)).toEqual(["", ...formats.map(([, type]) => type)]);
    // Format itself stays as it is, the definition as it was read: the page says it in words in its own place.
    expect(column(view.table, "Format")).toEqual(["", ...formats.map(([format]) => format)]);
  });

  it("gives the page's table code a table it takes: columns, filters on where Applies To came from and on the format's data type, search and counts", () => {
    const view = lineItemsView(table(HEADERS, MODEL));
    const columns = columnsOf(view.table);
    // The unnamed first column is the row's name on the page, and the module stands next to it.
    expect(columns.map(shown => shown.label)).toEqual(["Name", ...VIEW_HEADERS.slice(1)]);
    expect(columns.map(shown => shown.index)).toEqual(VIEW_HEADERS.map((_, index) => index));
    expect(columns.filter(shown => [MODULE_NAME, FORMAT_TYPE, APPLIES_TO, APPLIES_TO_FROM].includes(shown.label)).map(shown => [shown.label, shown.kind, shown.filter, shown.hidden]))
      .toEqual([["Module Name", "text", true, false], ["Format type", "text", true, false], ["Applies To", "text", true, false], ["Applies To from", "text", true, false]]);
    const from = VIEW_HEADERS.indexOf(APPLIES_TO_FROM);
    const type = VIEW_HEADERS.indexOf(FORMAT_TYPE);
    expect(valueCounts(view.table.rows, from)).toEqual([["Line item", 2], ["Module", 14]]);
    // The filter on the format's data type lists the modules' own rows as blanks, and the line item that is a heading as No Data.
    expect(valueCounts(view.table.rows, type)).toEqual([["", 5], ["No Data", 1], ["Number", 10]]);
    const ticked = (texts: string[]) => selectRows(view.table.rows, { search: "", filters: new Map([[type, new Set(texts)]]) }).map(row => `${row[1]}.${row[0]}`);
    // Without the blanks the table lists only line items, and without No Data no heading either.
    expect(ticked(["No Data", "Number"])).toEqual([1, 2, 3, 4, 5, 6, 9, 10, 12, 13, 14].map(at => `${MODEL[at][HEADERS.indexOf(MODULE_NAME)]}.${MODEL[at][0]}`));
    expect(ticked(["Number"])).toEqual([1, 2, 3, 5, 6, 9, 10, 12, 13, 14].map(at => `${MODEL[at][HEADERS.indexOf(MODULE_NAME)]}.${MODEL[at][0]}`));
    expect(ticked([""])).toEqual(MODULE_ROWS.map(at => `${MODEL[at][0]}.${MODEL[at][0]}`));
    // A search for a module finds its own row and its line items. A search for a dimension finds every line item that has
    // it, the ones that take it from their module too: in the file only the module's own row holds it for them.
    const found = (search: string) => selectRows(view.table.rows, { search, filters: new Map() }).map(row => `${row[1]}.${row[0]}`);
    expect(found("cost01")).toEqual([`${REVENUE}.Margin`, `${COSTS}.${COSTS}`, `${COSTS}.Cost`, `${COSTS}.Revenue`, `${COSTS}.Rate`]);
    expect(found("regions")).toEqual([REVENUE, "Units", "Revenue", "--- Checks ---", "Margin", "Margin %"].map(name => `${REVENUE}.${name}`));
    expect(selectRows(view.table.rows, { search: "", filters: new Map([[from, new Set(["Line item"])]]) }).map(row => row[0])).toEqual(["Price", "Rate"]);
    // The two modules' rows that only divide the list of modules are in the table too, where the file has them.
    expect(found("------")).toEqual(["------ Inputs ------", "------ Archive ------"].map(name => `${name}.${name}`));
  });

  it("turns 5,000 line items in 250 modules into the view in well under a second", () => {
    const rows: Cell[][] = [];
    for (let index = 0; index < 250; index++) {
      const name = `M${String(index).padStart(3, "0")} Module ${index}`;
      rows.push(real({ "": name, "Applies To": `List ${index % 7}, List ${index % 11}`, "Time Scale": "Month", Versions: "All" }));
      for (let item = 0; item < 20; item++) {
        rows.push(real({ "": `Line item ${item}`, ...measure(name), Formula: `'${name}'.'Line item ${(item + 1) % 20}' * 2`, ...(item % 10 === 9 ? { "Applies To": `List ${item}` } : {}) }));
      }
    }
    const given = table(HEADERS, rows);
    const started = performance.now();
    const view = lineItemsView(given);
    const took = performance.now() - started;
    expect([given.rows.length, view.table.rows.length, view.moduleRows, view.headings.size]).toEqual([5250, 5250, 250, 250]);
    expect(view.note).toBe(`Every row of Anaplan's Line Items grid: 5000 line items, and 250 modules' own rows, each in bold above its line items, with its own name under Module Name.${FILTER_LINE}`);
    expect(valueCounts(view.table.rows, VIEW_HEADERS.indexOf(APPLIES_TO_FROM))).toEqual([["Line item", 500], ["Module", 4750]]);
    expect(said(view).slice(5248)).toEqual([["Line item 18", "M249 Module 249", "List 4, List 7", "Module"], ["Line item 19", "M249 Module 249", "List 19", "Line item"]]);
    expect(took).toBeLessThan(1_000);
    // The names of its 250 modules change nothing in a table that is whole. (Compared by its parts: a deep comparison of
    // two sets of 250 rows takes longer than the view.)
    const names = new Set(rows.filter(row => row[HEADERS.indexOf(MODULE_NAME)] === "").map(row => String(row[0])));
    const named = lineItemsView(given, names);
    expect([names.size, named.table, named.note, headings(named)]).toEqual([250, view.table, view.note, headings(view)]);
  });
});
