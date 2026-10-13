import { describe, expect, it } from "vitest";
import { PAGE_FILTERS_HEADERS } from "./model-pages.js";
import { HEADERS } from "./report.js";
import type { AxisFilter, ViewCondition } from "./result-types.js";
import { axisHeading, axisLabel, axisSummary, conditionSummary, conditionWords, filterState, filtersSummary, lineItemListed, listedName, MATCH_SHOWN, OPERATOR_WORDS,
  SAVED_VIEW_FILTER_HEADERS, SAVED_VIEW_FILTER_ORDER, valuesText, viewFilterRows, type ViewCard } from "./saved-view-filters.js";

// Invented names only.
const condition = (more: Partial<ViewCondition>): ViewCondition => ({ lineItem: "Active?", lineItemModule: "SYS01 Flags", operator: "EQUALS", dataType: "BOOLEAN", values: ["True"],
  contexts: [], valid: true, ...more });
const filter = (more: Partial<AxisFilter>): AxisFilter => ({ axis: "Rows", active: true, match: "all", conditions: [condition({})], ...more });

describe("The words a saved view's filter is said in", () => {
  it("are the filter dialog's labels for each operator, in a sentence's case (anaplan/nls/filter)", () => {
    expect([...OPERATOR_WORDS]).toEqual([["EQUALS", "is equal to"], ["NOT_EQUALS", "is not equal to"], ["LESS_THAN", "is less than"], ["LESS_THAN_OR_EQUAL_TO", "is less than or equal to"],
      ["GREATER_THAN", "is greater than"], ["GREATER_THAN_OR_EQUAL_TO", "is greater than or equal to"], ["IS_BLANK", "is blank"], ["IS_NOT_BLANK", "is not blank"],
      ["CONTAINS", "contains"], ["STARTS_WITH", "starts with"], ["ENDS_WITH", "ends with"], ["BETWEEN_OR_EQUAL_TO", "between"]]);
    // No arrow of any kind among them, nor among the signs the table's cell writes.
    const said = [...OPERATOR_WORDS.values(), ...["EQUALS", "NOT_EQUALS", "LESS_THAN", "LESS_THAN_OR_EQUAL_TO", "GREATER_THAN", "GREATER_THAN_OR_EQUAL_TO"]
      .map(operator => conditionSummary(condition({ operator })))].join(" ");
    expect(said).not.toMatch(/[←-⇿➔-➿▲-◅»›]|->|=>|<-/);
  });

  it("say each condition short in the table's Filters cell: a comparison by its sign, the rest in the dialog's words, values as they are read", () => {
    expect([
      conditionSummary(condition({})),
      conditionSummary(condition({ operator: "NOT_EQUALS", values: ["False"] })),
      conditionSummary(condition({ lineItem: "Volume", operator: "GREATER_THAN", dataType: "NUMBER", values: ["0"] })),
      conditionSummary(condition({ lineItem: "Volume", operator: "LESS_THAN_OR_EQUAL_TO", dataType: "NUMBER", values: ["1500.5"] })),
      conditionSummary(condition({ lineItem: "Volume", operator: "GREATER_THAN_OR_EQUAL_TO", dataType: "NUMBER", values: ["-2"] })),
      conditionSummary(condition({ lineItem: "Volume", operator: "LESS_THAN", dataType: "NUMBER", values: ["10"] })),
      conditionSummary(condition({ lineItem: "Code", operator: "CONTAINS", dataType: "TEXT", values: ["FY 26"] })),
      conditionSummary(condition({ lineItem: "Code", operator: "ENDS_WITH", dataType: "TEXT", values: [""] })),
      conditionSummary(condition({ lineItem: "Launch", operator: "IS_BLANK", dataType: "DATE", values: [] })),
      conditionSummary(condition({ lineItem: "Region", operator: "EQUALS", dataType: "ENTITY", values: ["North", "South"], contexts: ["SCN042:Spring Launch"] })),
      conditionSummary(condition({ lineItem: "Missing line item (ID 2000000099)", valid: false })),
      conditionSummary(condition({ lineItem: "Band", operator: "BETWEEN_OR_EQUAL_TO", dataType: "NUMBER", values: ["1", "9"] })),
      conditionSummary(condition({ operator: "SOMETHING_NEW" })),
    ]).toEqual(["Active? = True", "Active? ≠ False", "Volume > 0", "Volume ≤ 1500.5", "Volume ≥ -2", "Volume < 10", 'Code contains "FY 26"', 'Code ends with ""', "Launch is blank",
      "Region (SCN042:Spring Launch) = North or South", "Missing line item (ID 2000000099) = True (not valid)", "Band between 1 and 9", "Active? SOMETHING_NEW True"]);
    expect(valuesText(condition({ dataType: "TIME_ENTITY", values: ["Jan 26", "Feb 26"] }))).toBe("Jan 26 or Feb 26");
  });

  it("say each axis's filter by its axis, a page's dimension and whether it is off, then Match any where it matches any", () => {
    expect([axisLabel(filter({})), axisLabel(filter({ active: false })), axisLabel(filter({ axis: "Pages", dimension: "Version" })),
      axisLabel(filter({ axis: "Pages", dimension: "Version", active: false })), axisLabel(filter({ axis: "Pages" }))])
      .toEqual(["Rows", "Rows (off)", "Pages (Version)", "Pages (Version, off)", "Pages"]);
    const two = [condition({ lineItem: "A", dataType: "NUMBER", operator: "GREATER_THAN", values: ["0"] }), condition({ lineItem: "B" })];
    expect([axisSummary(filter({})), axisSummary(filter({ match: "any", conditions: two })), axisSummary(filter({ active: false, conditions: two })),
      axisSummary(filter({ axis: "Columns", conditions: [condition({ lineItem: "Version", dataType: "ENTITY", values: ["Actual"] })] }))])
      .toEqual(["Rows: Active? = True", "Rows: Match any: A > 0, B = True", "Rows (off): A > 0, B = True", "Columns: Version = Actual"]);
    expect(filtersSummary([filter({}), filter({ axis: "Pages", dimension: "Time", active: false })])).toBe("Rows: Active? = True; Pages (Time, off): Active? = True");
    expect(filtersSummary([])).toBe("");
  });

  it("head each axis's filter in a row's details with Match all or Match any, and off, and say each condition in the dialog's words", () => {
    expect([axisHeading(filter({})), axisHeading(filter({ match: "any", active: false })), axisHeading(filter({ axis: "Pages", dimension: "Version" }))])
      .toEqual(["Rows · Match all", "Rows · Match any · off", "Pages (Version) · Match all"]);
    expect([conditionWords(condition({})), conditionWords(condition({ operator: "GREATER_THAN_OR_EQUAL_TO", dataType: "NUMBER", values: ["5"] })),
      conditionWords(condition({ operator: "IS_NOT_BLANK", dataType: "TEXT", values: [] })), conditionWords(condition({ operator: "STARTS_WITH", dataType: "TEXT", values: ["FY"] }))])
      .toEqual(["is equal to True", "is greater than or equal to 5", "is not blank", 'starts with "FY"']);
  });

  it("say in Filter state that a filter is off or a condition not valid, in the details' words, and nothing where it is on and valid", () => {
    expect([filterState({ active: true }, { valid: true }), filterState({ active: false }, { valid: true }), filterState({ active: true }, { valid: false }),
      filterState({ active: false }, { valid: false })]).toEqual(["", "Off", "Not valid", "Off · Not valid"]);
  });

  it("list a condition's line item behind its module and a dot, each name in quotes where a dot, a comma, a bar or a quote would cut it", () => {
    expect([lineItemListed("Active?", "SYS01 Flags"), lineItemListed("Rate, net", "1.1 Prices"), lineItemListed("Editor's lock", "Locks"), lineItemListed("Missing line item (ID 2000000099)", undefined),
      lineItemListed("Gone.Flag", undefined), listedName(" spaced "), listedName("")])
      .toEqual(["SYS01 Flags.Active?", "'1.1 Prices'.'Rate, net'", "Locks.'Editor''s lock'", "Missing line item (ID 2000000099)", "'Gone.Flag'", "' spaced '", "''"]);
  });
});

describe("The rows of Saved View Filters, the filters of the saved views a page's cards show", () => {
  /** A card of an invented page that shows a saved view. */
  const CARD: ViewCard = { app: "Planning app", page: "Demand board", number: 2, section: "1", place: ["Board", "00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000001000"],
    cardId: "00000000-0000-4000-8000-000000000002" };
  const where = ["Planning app", "Demand board", 2, "1", "Board", "00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000001000", "00000000-0000-4000-8000-000000000002"];
  /** Each row as its columns name it. */
  const named = (row: readonly unknown[]) => Object.fromEntries(SAVED_VIEW_FILTER_HEADERS.map((header, at) => [header, row[at]]));

  it("have Custom View Filters' columns in its order, with Saved view after Filtered module, and Filter state last, and its order of rows", () => {
    expect([...SAVED_VIEW_FILTER_HEADERS]).toEqual([...PAGE_FILTERS_HEADERS.flatMap(header => (header === "Filtered module" ? [header, "Saved view"] : [header])), "Filter state"]);
    expect([...SAVED_VIEW_FILTER_ORDER]).toEqual(["Condition line item's module", "Condition line item", "App", "Page", "Card #"]);
    // No column of an app's Filters table is lost: each column but the two added means what it means there.
    expect(SAVED_VIEW_FILTER_HEADERS.filter(header => !["Saved view", "Filter state", "App", "Page type", "App ID", "Page ID"].includes(header)).sort()).toEqual([...HEADERS.Filters].sort());
    // Show items that match says All or Any, as Custom View Filters does.
    expect(MATCH_SHOWN).toEqual({ all: "All", any: "Any" });
  });

  it("give one row for each condition of each axis's filter, in the filter's order, each column said as Custom View Filters says it", () => {
    const view = { name: "Open items", module: "REV01 Revenue", filters: [
      filter({ dimensions: ["Products", "Customers"], conditions: [condition({ lineItemId: "2000000001" })] }),
      filter({ axis: "Columns", match: "any", active: false, conditions: [
        condition({ lineItem: "Region", lineItemId: "2000000003", dataType: "ENTITY", values: ["North", "South"], contexts: ["SCN042:Spring Launch", "FY26"] }),
        condition({ lineItem: "Code", lineItemId: "2000000004", operator: "STARTS_WITH", dataType: "TEXT", values: ["FY 26"], valid: false })] }),
      filter({ axis: "Pages", dimension: "Version", dimensions: ["Version"], conditions: [condition({ lineItem: "Band", lineItemId: "2000000005", operator: "BETWEEN_OR_EQUAL_TO",
        dataType: "NUMBER", values: ["1", "9"] })] }),
      filter({ axis: "Pages", conditions: [condition({ lineItem: "Launch", lineItemId: "2000000006", operator: "IS_BLANK", dataType: "DATE", values: [] })] }),
    ] };
    const rows = viewFilterRows(view, CARD);
    expect(rows.map(row => row.length)).toEqual([22, 22, 22, 22, 22]);
    // Filtered dimension names the filtered axis's dimensions as the client named them, with a comma between them, and is
    // empty where it named none: Filter on says the axis.
    expect(rows).toEqual([
      ["SYS01 Flags", "Active?", "REV01 Revenue", "Open items", "Products, Customers", "", "is equal to", "True", "All", "", "", "Rows", ...where, "2000000001", ""],
      ["SYS01 Flags", "Region", "REV01 Revenue", "Open items", "", "", "is equal to", "North or South", "Any", "", "SCN042:Spring Launch; FY26", "Columns", ...where,
        "2000000003", "Off"],
      ["SYS01 Flags", "Code", "REV01 Revenue", "Open items", "", "", "starts with", '"FY 26"', "Any", "", "", "Columns", ...where, "2000000004", "Off · Not valid"],
      ["SYS01 Flags", "Band", "REV01 Revenue", "Open items", "Version", "", "between", "1 and 9", "All", "", "", "Pages", ...where, "2000000005", ""],
      ["SYS01 Flags", "Launch", "REV01 Revenue", "Open items", "", "", "is blank", "", "All", "", "", "Pages", ...where, "2000000006", ""],
    ]);
    expect(named(rows[1])).toMatchObject({ "Filter on": "Columns", "Show items that match": "Any", "Condition context": "SCN042:Spring Launch; FY26", "Filter state": "Off",
      "Condition group": "", "Filtered line items": "" });
  });

  it("say a line item the model does not have, and one whose module is not known, as Custom View Filters does, and give a view without a filter no row", () => {
    const view = { name: "Old flags", module: "SYS01 Flags", filters: [filter({ conditions: [
      condition({ lineItem: "Missing line item (ID 2000000099)", lineItemModule: undefined, lineItemId: "2000000099", valid: false }),
      condition({ lineItem: "Labelled only", lineItemModule: undefined, lineItemId: "2000000098" }),
      condition({ lineItem: "Current Module", lineItemModule: undefined, operator: "IS_NOT_BLANK", values: [] })] })] };
    expect(viewFilterRows(view, CARD).map(row => [named(row)["Condition line item's module"], named(row)["Condition line item"], named(row)["Line item ID"], named(row)["Filter state"]]))
      .toEqual([["Missing line item: module not known", "Missing line item (ID 2000000099)", "2000000099", "Not valid"], ["", "Labelled only", "2000000098", ""],
        ["", "Current Module", "", ""]]);
    expect(viewFilterRows({ name: "Plain", module: "REV01 Revenue", filters: [] }, CARD)).toEqual([]);
  });
});
