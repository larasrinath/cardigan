import { describe, expect, it } from "vitest";
import type { AxisFilter, ViewCondition } from "./result-types.js";
import { axisHeading, axisLabel, axisSummary, conditionSummary, conditionWords, filtersSummary, lineItemListed, listedName, OPERATOR_WORDS, valuesText } from "./saved-view-filters.js";

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

  it("list a condition's line item behind its module and a dot, each name in quotes where a dot, a comma, a bar or a quote would cut it", () => {
    expect([lineItemListed("Active?", "SYS01 Flags"), lineItemListed("Rate, net", "1.1 Prices"), lineItemListed("Editor's lock", "Locks"), lineItemListed("Missing line item (ID 2000000099)", undefined),
      lineItemListed("Gone.Flag", undefined), listedName(" spaced "), listedName("")])
      .toEqual(["SYS01 Flags.Active?", "'1.1 Prices'.'Rate, net'", "Locks.'Editor''s lock'", "Missing line item (ID 2000000099)", "'Gone.Flag'", "' spaced '", "''"]);
  });
});
