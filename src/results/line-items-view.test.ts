import { afterEach, describe, expect, it, vi } from "vitest";
import { exportModel } from "../model/export.js";
import type { Cell, ResultTable } from "../result-types.js";
import { resultZip, tableCsv } from "../result-zip.js";
import { parseCsv, unzipText } from "../zip.test-support.js";
import { columnsOf } from "./columns.js";
import { APPLIES_TO, APPLIES_TO_FROM, APPLIES_TO_SOURCE, LINE_ITEMS_FILE, lineItemsView, MODULE_NAME, START_OF_SECTION, type LineItemsView } from "./line-items-view.js";
import { selectRows, valueCounts } from "./table-engine.js";

// Made-up names only. The headers are the ones a real model's Line Items table has, in its order: the unnamed column with
// each row's name, the grid's 25 columns as the diagnostic log of an export lists them, then the two the export adds.
const GRID_COLUMNS = ["Format", "Formula", "Summary", "Applies To", "Time Scale", "Time Range", "Versions", "Style", "Cell Count", "Calculation Effort", "Notes",
  "Read Access Driver", "Write Access Driver", "Users List", "Parent", "Is Summary", "Formula Scope", "Code", "Use Switchover", "Breakback", "Brought-Forward",
  "Start of Section", "Data Tags", "Referenced By", "Module Name"];
const HEADERS = ["", ...GRID_COLUMNS, "Ratio Numerator", "Ratio Denominator"];
/** The same headers as the view orders them: the module after the name, and where Applies To came from after Applies To. */
const VIEW_HEADERS = ["", "Module Name", "Format", "Formula", "Summary", "Applies To", "Applies To from", "Time Scale", "Time Range", "Versions", "Style", "Cell Count",
  "Calculation Effort", "Notes", "Read Access Driver", "Write Access Driver", "Users List", "Parent", "Is Summary", "Formula Scope", "Code", "Use Switchover", "Breakback",
  "Brought-Forward", "Start of Section", "Data Tags", "Referenced By", "Ratio Numerator", "Ratio Denominator"];

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

// A smaller table of the same kind for the cases: the row's name, then these columns.
const SHORT = ["", "Format", "Applies To", "Start of Section", "Module Name", "Ratio Numerator"];
const SHORT_VIEW = ["", "Module Name", "Format", "Applies To", "Applies To from", "Start of Section", "Ratio Numerator"];
const moduleRow = (name: string, appliesTo = ""): Cell[] => [name, "", appliesTo, "", "", ""];
const lineItem = (name: string, inModule: string, appliesTo = "-", startOfSection = "false"): Cell[] => [name, NUMBER, appliesTo, startOfSection, inModule, ""];

const column = (shown: ResultTable, header: string): Cell[] => shown.rows.map(row => row[shown.headers.indexOf(header)]);
/** What the view says of each line item: its name, its module, its Applies To and where that came from. */
const said = (view: LineItemsView): Cell[][] => {
  const at = [MODULE_NAME, APPLIES_TO, APPLIES_TO_FROM].map(header => view.table.headers.indexOf(header));
  return view.table.rows.map(row => [row[0], ...at.map(index => row[index])]);
};
/** The view of a table it must leave alone: the table itself, nothing left out, nothing to say. */
const asItIs = (given: ResultTable): LineItemsView => ({ table: given, moduleRows: 0, emptyModules: 0 });

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
    // The export's files here: the one about the export itself, then the grid's. The view knows the grid's by this name.
    expect(result.tables.map(written => written.file)).toEqual(["Model Details.csv", LINE_ITEMS_FILE]);
    // The row's name first, the grid's columns under Anaplan's own headers, the two ratio columns last. The module each
    // line item's row carries on the grid's axis is not in the table: only the Module Name column says it.
    const exported = result.tables[1];
    expect(exported).toEqual(table(HEADERS, MODEL));
    const view = lineItemsView(exported);
    expect(view).toEqual(lineItemsView(table(HEADERS, MODEL)));
    expect([view.table.headers, view.table.rows.length, view.moduleRows, view.emptyModules]).toEqual([VIEW_HEADERS, 11, 5, 2]);
    // The export's own details file is not the view's. And the zip still holds the grid as the export read it, row for
    // row, the modules' own rows among them: the view is another table, and the result's is not touched.
    expect(lineItemsView(result.tables[0]).table).toBe(result.tables[0]);
    const [headers, ...rows] = parseCsv(unzipText(resultZip(result)).get(LINE_ITEMS_FILE) ?? "");
    expect([headers, rows]).toEqual([HEADERS, MODEL]);
  });

  it("is for the model's Line Items file, and for no other", () => {
    const lineItems = table(HEADERS, MODEL);
    expect([LINE_ITEMS_FILE, lineItems.file, lineItems.label, HEADERS.length, VIEW_HEADERS.length]).toEqual(["Line Items.csv", "Line Items.csv", "Line Items", 28, 29]);
    expect(lineItemsView(lineItems).moduleRows).toBe(5);
    // The same table under any other name comes back as it is: a file is known by its whole name, as it is written.
    for (const file of ["Modules.csv", "line items.csv", "Line Items", "Line Items.csv ", "Line Items (1).csv", "Model Details.csv"]) {
      const other = { ...lineItems, file };
      expect(lineItemsView(other), file).toEqual(asItIs(other));
      expect(lineItemsView(other).table, file).toBe(other);
    }
  });

  it("shows only line items, each with its module directly after its name, in the file's order", () => {
    const view = lineItemsView(table(SHORT, [
      moduleRow("Sales", "Products, Time"), lineItem("Units", "Sales"), lineItem("Price", "Sales", "Products"),
      moduleRow("Stock", "Warehouses"), lineItem("Units", "Stock"), lineItem("Cover", "Stock")]));
    expect(view.table).toEqual({ file: "Line Items.csv", label: "Line Items", guard: false, headers: SHORT_VIEW, rows: [
      ["Units", "Sales", NUMBER, "Products, Time", "Module", "false", ""],
      ["Price", "Sales", NUMBER, "Products", "Line item", "false", ""],
      ["Units", "Stock", NUMBER, "Warehouses", "Module", "false", ""],
      ["Cover", "Stock", NUMBER, "Warehouses", "Module", "false", ""]] });
    expect([view.moduleRows, view.emptyModules, view.note]).toEqual([2, 0, "2 module rows are in the CSV only; each line item shows its module."]);
    // The module's name is shown once: the grid's own Module Name column, moved, not a second one.
    expect(view.table.headers.filter(header => header === MODULE_NAME)).toHaveLength(1);
    expect(SHORT_VIEW).toHaveLength(SHORT.length + 1);
  });

  it("lays a table with a real model's columns out the same way, and leaves every other column as it is", () => {
    const view = lineItemsView(table(HEADERS, MODEL));
    expect(view.table.headers).toEqual(VIEW_HEADERS);
    expect(said(view)).toEqual([
      ["Units", REVENUE, "Products, Regions", "Module"], ["Price", REVENUE, "Products", "Line item"], ["Revenue", REVENUE, "Products, Regions", "Module"],
      // A line item that only divides its module's line items is a line item: it has a module, and a format.
      ["--- Checks ---", REVENUE, "Products, Regions", "Module"],
      ["Margin", REVENUE, "Products, Regions", "Module"], ["Margin %", REVENUE, "Products, Regions", "Module"],
      // A module with no dimensions has an empty Applies To, and so have the line items that take theirs from it.
      ["Planning Horizon", SETTINGS, "", "Module"], ["Revenue", SETTINGS, "", "Module"],
      ["Cost", COSTS, "Cost Centres", "Module"], ["Revenue", COSTS, "Cost Centres", "Module"],
      // An empty Applies To on a line item is its own: it applies to no list, whatever its module applies to.
      ["Rate", COSTS, "", "Line item"]]);
    // Every other column holds, for each line item, the very cell the file holds: Format and Summary as they stand, the ratio columns too.
    const lineItems = MODEL.filter(row => row[HEADERS.indexOf(MODULE_NAME)] !== "");
    for (const header of HEADERS.filter(name => name !== APPLIES_TO)) expect(column(view.table, header), header).toEqual(lineItems.map(row => row[HEADERS.indexOf(header)]));
    expect([column(view.table, "Format")[3], column(view.table, "Summary")[5], column(view.table, "Ratio Numerator")[5], column(view.table, "Ratio Denominator")[5]])
      .toEqual([NO_DATA, RATIO, "Margin", "Revenue"]);
    expect(view.table.rows.every(row => row.length === VIEW_HEADERS.length)).toBe(true);
    expect([view.moduleRows, view.emptyModules]).toEqual([5, 2]);
    expect(view.note).toBe("5 module rows are in the CSV only; each line item shows its module. 2 modules have no line items, so they are not in this table.");
  });

  it("tells line items of the same name apart by their module, and takes each one's Applies To from its own module", () => {
    const view = lineItemsView(table(HEADERS, MODEL));
    expect(said(view).filter(([name]) => name === "Revenue")).toEqual([
      ["Revenue", REVENUE, "Products, Regions", "Module"], ["Revenue", SETTINGS, "", "Module"], ["Revenue", COSTS, "Cost Centres", "Module"]]);
    // And a module whose name looks like a divider is a module like any other when it has line items.
    const divided = lineItemsView(table(SHORT, [moduleRow("------ Drivers ------", "Products"), lineItem("Growth %", "------ Drivers ------"), moduleRow("------ Outputs ------")]));
    expect(said(divided)).toEqual([["Growth %", "------ Drivers ------", "Products", "Module"]]);
    expect([divided.moduleRows, divided.emptyModules]).toEqual([2, 1]);
  });

  it("shows a line item's own Applies To as it is, and says that it is its own", () => {
    const view = lineItemsView(table(SHORT, [moduleRow("Sales", "Products, Time"),
      lineItem("Price", "Sales", "Products"), lineItem("Rate", "Sales", ""), lineItem("Quoted", "Sales", "\"Regions, EMEA\", Time"), lineItem("Spaced", "Sales", " - "),
      // Only the dash is the module's: a longer text that starts with one, or another kind of dash, is the line item's own.
      lineItem("Odd", "Sales", "-- None --"), lineItem("Long dash", "Sales", "—")]));
    expect(said(view)).toEqual([["Price", "Sales", "Products", "Line item"], ["Rate", "Sales", "", "Line item"], ["Quoted", "Sales", "\"Regions, EMEA\", Time", "Line item"],
      ["Spaced", "Sales", "Products, Time", "Module"], ["Odd", "Sales", "-- None --", "Line item"], ["Long dash", "Sales", "—", "Line item"]]);
    expect(APPLIES_TO_SOURCE).toEqual({ module: "Module", section: "Section", lineItem: "Line item", notFound: "Module (not found)" });
    expect(APPLIES_TO_FROM).toBe("Applies To from");
  });

  it("takes a dash from the line item that started the section, when that one has an Applies To of its own", () => {
    const view = lineItemsView(table(SHORT, [
      moduleRow("Plan", "Products, Time"),
      lineItem("Volume", "Plan"),
      lineItem("Regional Uplift", "Plan", "Regions", "true"), lineItem("Uplift Start", "Plan"),
      // A line item with its own Applies To that starts no section changes nothing for the ones after it.
      lineItem("Customer Note", "Plan", "Customers"), lineItem("Uplift End", "Plan"),
      // A line item that starts a section with a dash takes the module's, and so do the ones after it.
      lineItem("Totals", "Plan", "-", "true"), lineItem("Total Volume", "Plan"),
      lineItem("Flat Rate", "Plan", "", "TRUE"), lineItem("Flat Fee", "Plan"),
      // A section ends with its module.
      moduleRow("Other", "Channels"), lineItem("Sales", "Other")]));
    expect(said(view)).toEqual([
      ["Volume", "Plan", "Products, Time", "Module"],
      ["Regional Uplift", "Plan", "Regions", "Line item"], ["Uplift Start", "Plan", "Regions", "Section"],
      ["Customer Note", "Plan", "Customers", "Line item"], ["Uplift End", "Plan", "Regions", "Section"],
      ["Totals", "Plan", "Products, Time", "Module"], ["Total Volume", "Plan", "Products, Time", "Module"],
      ["Flat Rate", "Plan", "", "Line item"], ["Flat Fee", "Plan", "", "Section"],
      ["Sales", "Other", "Channels", "Module"]]);
    // Nor does a section run on into another module's line items when that module's row is missing.
    const orphans = lineItemsView(table(SHORT, [moduleRow("Zero", "Time"), lineItem("Uplift", "First", "Regions", "true"), lineItem("Next", "First"), lineItem("Orphan", "Second")]));
    expect(said(orphans)).toEqual([["Uplift", "First", "Regions", "Line item"], ["Next", "First", "Regions", "Section"], ["Orphan", "Second", "-", "Module (not found)"]]);
    // A module's row ends the section whatever the module is called: the line items under it start from that row.
    const again = lineItemsView(table(SHORT, [moduleRow("Plan", "Products"), lineItem("Uplift", "Plan", "Regions", "true"), moduleRow("Plan", "Channels"), lineItem("Sales", "Plan")]));
    expect(said(again)).toEqual([["Uplift", "Plan", "Regions", "Line item"], ["Sales", "Plan", "Channels", "Module"]]);
    // A table without the Start of Section column has no sections: a dash is the module's.
    const headers = ["", "Applies To", "Module Name"];
    expect(headers).not.toContain(START_OF_SECTION);
    const plain = lineItemsView(table(headers, [["Plan", "Products", ""], ["Uplift", "Regions", "Plan"], ["After", "-", "Plan"]]));
    expect(plain.table).toMatchObject({ headers: ["", "Module Name", "Applies To", "Applies To from"], rows: [["Uplift", "Plan", "Regions", "Line item"], ["After", "Plan", "Products", "Module"]] });
  });

  it("leaves out a module with no line items and counts it apart, at the very end of the table too", () => {
    const view = lineItemsView(table(SHORT, [
      moduleRow("------ Inputs ------"), moduleRow("Sales", "Products"), lineItem("Units", "Sales"), moduleRow("Empty", "Regions"), moduleRow("------ Archive ------")]));
    expect(said(view)).toEqual([["Units", "Sales", "Products", "Module"]]);
    expect([view.moduleRows, view.emptyModules]).toEqual([4, 3]);
    expect(view.note).toBe("4 module rows are in the CSV only; each line item shows its module. 3 modules have no line items, so they are not in this table.");
    // Only modules' rows: nothing is left to show, and the note says where they went.
    const none = lineItemsView(table(SHORT, [moduleRow("------ Inputs ------")]));
    expect([none.table.headers, none.table.rows, none.moduleRows, none.emptyModules]).toEqual([SHORT_VIEW, [], 1, 1]);
    expect(none.note).toBe("1 module row is in the CSV only; each line item shows its module. 1 module has no line items, so it is not in this table.");
  });

  it("says in one line how many module rows it left out", () => {
    const note = (rows: Cell[][]) => lineItemsView(table(SHORT, rows)).note;
    expect(note([moduleRow("Sales"), lineItem("Units", "Sales")])).toBe("1 module row is in the CSV only; each line item shows its module.");
    expect(note([moduleRow("Sales"), lineItem("Units", "Sales"), moduleRow("Stock"), lineItem("Units", "Stock"), moduleRow("Empty")]))
      .toBe("3 module rows are in the CSV only; each line item shows its module. 1 module has no line items, so it is not in this table.");
    // The numbers the note is made of add up to the file's rows: none is lost between the CSV and the page.
    const view = lineItemsView(table(HEADERS, MODEL));
    expect(view.table.rows.length + view.moduleRows).toBe(MODEL.length);
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
      ["Units", "Sales", "Products", "Module"],
      ["Stock Units", "Stock", "-", "Module (not found)"], ["Stock Value", "Stock", "Warehouses", "Line item"],
      ["Late", "Costs", "-", "Module (not found)"], ["Cost", "Costs", "Cost Centres", "Module"]]);
    expect([view.moduleRows, view.emptyModules]).toEqual([2, 0]);
    // A module's name is matched whole and as it is written.
    const near = lineItemsView(table(SHORT, [moduleRow("Sales", "Products"), lineItem("Lower", "sales"), lineItem("Longer", "Sales Plan"), lineItem("Spaced", "Sales ")]));
    expect(column(near.table, APPLIES_TO_FROM)).toEqual(["Module (not found)", "Module (not found)", "Module (not found)"]);
    expect(near.emptyModules).toBe(1);
  });

  it("takes a row for a module's own by its empty Module Name alone", () => {
    const view = lineItemsView(table(SHORT, [
      // Whatever else the row holds: a row with a format and no module, or only spaces for one, is left out and counted like any module's row.
      ["Unnamed", NUMBER, "-", "false", "", ""], ["Spaces", NUMBER, "-", "false", "  ", ""],
      // And a row with a module is a line item, whatever it lacks: a format, or a name of its own.
      ["Sales", "", "Products", "", "", ""], ["No Format", "", "-", "", "Sales", ""], ["", NUMBER, "-", "false", "Sales", ""]]));
    expect(view.table.rows).toEqual([["No Format", "Sales", "", "Products", "Module", "", ""], ["", "Sales", NUMBER, "Products", "Module", "false", ""]]);
    expect([view.moduleRows, view.emptyModules]).toEqual([3, 2]);
    // Such a row among a module's line items ends the module for the ones after it: they keep their dash and say that
    // their module was not found. A line item that lost its Module Name shows up so, and never under a wrong Applies To.
    const broken = lineItemsView(table(SHORT, [moduleRow("Sales", "Products"), lineItem("Units", "Sales"), ["Lost", NUMBER, "-", "false", "", ""], lineItem("Price", "Sales")]));
    expect(said(broken)).toEqual([["Units", "Sales", "Products", "Module"], ["Price", "Sales", "-", "Module (not found)"]]);
    expect([broken.moduleRows, broken.emptyModules]).toEqual([2, 1]);
    // A row too short to have the cell has an empty one, as everywhere on the page.
    expect(lineItemsView(table(SHORT, [["Sales", "", "Products"], lineItem("Units", "Sales")])).table.rows).toEqual([["Units", "Sales", NUMBER, "Products", "Module", "false", ""]]);
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
      table(SHORT, [["Sales", "", "Products", "", "Sales", ""], lineItem("Units", "Sales")])]) {
      const view = lineItemsView(given);
      expect(view, given.headers.join("|")).toEqual(asItIs(given));
      expect(view.table, given.headers.join("|")).toBe(given);
      expect("note" in view).toBe(false);
    }
    // Without Start of Section the view still applies: only the two are needed.
    expect(lineItemsView(without(START_OF_SECTION)).moduleRows).toBe(1);
    // The view of a view is the view: no row of it is a module's own.
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
      expect([view.moduleRows, view.emptyModules, "note" in view], `case ${index}`).toEqual([0, 0, false]);
    });
    // A cell that is not there is an empty cell, as the page reads it: a hole in a row, or nothing where text should be.
    const holed = lineItem("Units", "Sales");
    delete holed[5];
    const view = lineItemsView({ ...good, rows: [["Sales", null, "Products", undefined, null, ""], holed, ["Price", NUMBER, "-", undefined, "Sales", null]] } as never);
    expect(view.table.rows).toEqual([["Units", "Sales", NUMBER, "Products", "Module", "false", ""], ["Price", "Sales", NUMBER, "Products", "Module", "", ""]]);
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
      // A module called 2024 is the same module whether a cell holds the number or its text; its Applies To is the cell itself.
      ["Units", 2024, NUMBER, 12, "Module", "false", 0], [7, "2024", NUMBER, 12, "Module", "false", 1.5],
      ["Long", "Sales", NUMBER, "Products", "Module", "false", "", "beyond", 9], ["Short", "Sales", NUMBER, "Products", "Module", "false", ""],
      ["Own", "Sales", NUMBER, 3, "Line item", "false", ""]]);
    expect(view.table.rows.flat().every(cell => typeof cell === "string" || (typeof cell === "number" && Number.isFinite(cell)))).toBe(true);
    // The table given is not touched, so the CSV written from it is the one it always was; the view is another table.
    expect(given).toEqual(before);
    expect(tableCsv(given)).toBe(csv);
    expect(view.table).not.toBe(given);
    expect([view.table.rows === given.rows, view.table.headers === given.headers, view.table.rows.some(row => given.rows.includes(row))]).toEqual([false, false, false]);
    expect(tableCsv(view.table)).not.toBe(csv);
  });

  it("gives the page's table code a table it takes: columns, a filter on where Applies To came from, search and counts", () => {
    const view = lineItemsView(table(HEADERS, MODEL));
    const columns = columnsOf(view.table);
    // The unnamed first column is the row's name on the page, and the module stands next to it.
    expect(columns.map(shown => shown.label)).toEqual(["Name", ...VIEW_HEADERS.slice(1)]);
    expect(columns.map(shown => shown.index)).toEqual(VIEW_HEADERS.map((_, index) => index));
    expect(columns.filter(shown => [MODULE_NAME, APPLIES_TO, APPLIES_TO_FROM].includes(shown.label)).map(shown => [shown.label, shown.kind, shown.filter, shown.hidden]))
      .toEqual([["Module Name", "text", true, false], ["Applies To", "text", true, false], ["Applies To from", "text", true, false]]);
    const from = VIEW_HEADERS.indexOf(APPLIES_TO_FROM);
    expect(valueCounts(view.table.rows, from)).toEqual([["Line item", 2], ["Module", 9]]);
    // A search for a module finds its line items. A search for a dimension finds every line item that has it, the ones that
    // take it from their module too: in the file only the module's own row holds it for them.
    const found = (search: string) => selectRows(view.table.rows, { search, filters: new Map() }).map(row => `${row[1]}.${row[0]}`);
    expect(found("cost01")).toEqual([`${REVENUE}.Margin`, `${COSTS}.Cost`, `${COSTS}.Revenue`, `${COSTS}.Rate`]);
    expect(found("regions")).toEqual(["Units", "Revenue", "--- Checks ---", "Margin", "Margin %"].map(name => `${REVENUE}.${name}`));
    expect(selectRows(view.table.rows, { search: "", filters: new Map([[from, new Set(["Line item"])]]) }).map(row => row[0])).toEqual(["Price", "Rate"]);
    // No row of the view is a module's own: the two that only divide the list of modules are found nowhere in it.
    expect(found("------")).toEqual([]);
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
    expect([given.rows.length, view.table.rows.length, view.moduleRows, view.emptyModules]).toEqual([5250, 5000, 250, 0]);
    expect(view.note).toBe("250 module rows are in the CSV only; each line item shows its module.");
    expect(valueCounts(view.table.rows, VIEW_HEADERS.indexOf(APPLIES_TO_FROM))).toEqual([["Line item", 500], ["Module", 4500]]);
    expect(said(view).slice(4998)).toEqual([["Line item 18", "M249 Module 249", "List 4, List 7", "Module"], ["Line item 19", "M249 Module 249", "List 19", "Line item"]]);
    expect(took).toBeLessThan(1_000);
  });
});
