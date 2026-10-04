import { describe, expect, it } from "vitest";
import { actionWords, formatWords, MAX_DEFINITION_LENGTH, READABLE_HEADERS, readableCell, summaryWords, type CellNames } from "./readable-cells.js";

// Every definition here is made up, in the shape Anaplan's own export of a settings grid writes one: no model's data.
const cell = (definition: unknown): string => JSON.stringify(definition);
/** A character by its number, so that none of the invisible ones stands in this file itself. */
const char = (code: number): string => String.fromCodePoint(code);

/** Anaplan's default number format, field for field. */
const DEFAULT_NUMBER = { minimumSignificantDigits: 4, decimalPlaces: -1, decimalSeparator: "FULL_STOP", groupingSeparator: "COMMA", negativeNumberNotation: "MINUS_SIGN",
  unitsType: "NONE", unitsDisplayType: "NONE", currencyCode: null, customUnits: null, zeroFormat: "ZERO", comparisonIncrease: "GOOD", dataType: "NUMBER" };
const number = (changes: Record<string, unknown> = {}): string | undefined => formatWords(cell({ ...DEFAULT_NUMBER, ...changes }));
const places = (decimalPlaces: unknown) => ({ minimumSignificantDigits: -1, decimalPlaces });
const digits = (minimumSignificantDigits: unknown) => ({ minimumSignificantDigits, decimalPlaces: -1 });
/** A number's words when its custom units are stored as `customUnits`, and those words when the units read `units`. */
const custom = (customUnits: string): string | undefined => number({ unitsType: "CUSTOM", customUnits, unitsDisplayType: "CUSTOM_SUFFIX" });
const withUnits = (units: string): string => `Number, custom units ${units} (suffix)`;
/** What Anaplan stores for custom units that were typed: the "&" escaped first, then "<", ">" and the double quote, as
 * the classic client's escapeHTML does it. */
const stored = (typed: string): string => typed.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const LISTS = new Map([["101000000007", "Products"], ["109000000002", "Products: Active"]]);
const LIST_NAMES: CellNames = { listName: id => LISTS.get(id) };
const list = (changes: Record<string, unknown> = {}): string =>
  cell({ hierarchyEntityLongId: 101000000007, entityFormatFilter: null, selectiveAccessApplied: false, showAll: false, dataType: "ENTITY", ...changes });

const RATIO_IDS = { ratioNumeratorIdentifier: "_1901000000011_", ratioDenominatorIdentifier: "_1901000000012_" };
const RATIO_NAMES: CellNames = { ratioNumerator: "Profit", ratioDenominator: "Revenue" };
const summary = (definition: Record<string, unknown>, names?: CellNames): string | undefined => summaryWords(cell(definition), names);
/** A summary as the Summary dialog submits it: both methods, whether they are the same, and no ratio. */
const chosen = (summaryMethod: string, timeSummaryMethod: string, timeSummarySameAsMainSummary: boolean) =>
  ({ summaryMethod, timeSummaryMethod, timeSummarySameAsMainSummary, ratioNumeratorIdentifier: "", ratioDenominatorIdentifier: "" });

const METHODS: [method: string, label: string][] = [["SUM", "Sum"], ["NONE", "None"], ["FORMULA", "Formula"], ["AVERAGE", "Average"], ["RATIO", "Ratio"], ["MIN", "Min"],
  ["MAX", "Max"], ["OPENING_BALANCE", "Opening Balance"], ["CLOSING_BALANCE", "Closing Balance"], ["FIRST_NON_BLANK", "First non-blank"],
  ["LAST_NON_BLANK", "Last non-blank"], ["ANY", "Any"], ["ALL", "All"]];

const task = (taskElement: Record<string, unknown>): string => cell({ actionType: "TASK_ELEMENT", taskElement: JSON.stringify(taskElement) });

/** What no column's reader takes for a definition: text that is not JSON (one starts with a no-break space, which is not
 * white space to JSON), JSON that is not an object, an object without the fields, and a cell that is not text at all. */
const NOT_A_DEFINITION: unknown[] = ["", " ", "Sum", "Number", "=Revenue - Cost", "IF Units > 0 THEN Units * Price ELSE 0", "Import into Prices", "not json", "{", "{not json}",
  "{\"dataType\":\"NUMBER\"", "{\"dataType\":\"NUMBER\"} and more", "[]", "[{\"dataType\":\"NUMBER\"}]", "null", "true", "42", "-1", "\"NUMBER\"", "{}", "{\"dataTypes\":\"NUMBER\"}",
  "{\"__proto__\":{\"dataType\":\"NUMBER\",\"summaryMethod\":\"SUM\",\"actionType\":\"PROCESS\"}}", `${char(0xa0)}{"dataType":"NUMBER"}`,
  null, undefined, 42, NaN, true, {}, [], { dataType: "NUMBER", summaryMethod: "SUM", actionType: "PROCESS" }, () => "{\"dataType\":\"NUMBER\"}",
  // Very long: text that is no definition, text that only starts as one, and one nested deeper than any definition is.
  "x".repeat(1_000_000), `{${" ".repeat(1_000_000)}`, `${"{\"a\":".repeat(2_500)}1${"}".repeat(2_500)}`];

describe("A line item's Format in words", () => {
  it("says each data type by the label Anaplan's Format dialog gives it", () => {
    const types: [definition: unknown, words: string][] = [[DEFAULT_NUMBER, "Number"], [{ dataType: "BOOLEAN" }, "Boolean"], [{ dataType: "DATE" }, "Date"],
      [{ textType: "GENERAL", dataType: "TEXT" }, "Text"], [{ periodType: null, dataType: "TIME_ENTITY" }, "Time Period"], [{ dataType: "ENTITY" }, "List"],
      [{ dataType: "NONE" }, "No Data"]];
    for (const [definition, words] of types) expect(formatWords(cell(definition)), words).toBe(words);
    // A data type with nothing to choose says nothing else, whatever else its cell holds.
    expect(formatWords(cell({ dataType: "BOOLEAN", decimalPlaces: 2, textType: "DRILLTHRU_URI" }))).toBe("Boolean");
  });

  it("says nothing after Number for a number in Anaplan's default format", () => {
    expect(number()).toBe("Number");
    // A format that leaves its options out, or holds them as null, has them at their defaults.
    expect(formatWords("{\"dataType\":\"NUMBER\"}")).toBe("Number");
    expect(formatWords(cell(Object.fromEntries(Object.keys(DEFAULT_NUMBER).map(field => [field, field === "dataType" ? "NUMBER" : null]))))).toBe("Number");
    // Neither a count of significant digits nor one of decimal places: nothing to say.
    expect(number({ minimumSignificantDigits: -1, decimalPlaces: -1 })).toBe("Number");
  });

  it("says a number's decimal places, or its significant digits when they are not Anaplan's four", () => {
    expect([0, 1, 2, 15].map(count => number(places(count)))).toEqual(["Number, 0 decimal places", "Number, 1 decimal place", "Number, 2 decimal places", "Number, 15 decimal places"]);
    expect([1, 3, 4, 6].map(count => number(digits(count)))).toEqual(["Number, minimum 1 significant digit", "Number, minimum 3 significant digits", "Number",
      "Number, minimum 6 significant digits"]);
    // The Format dialog submits the count it was given as text.
    expect([number(places("2")), number(digits("6")), number(digits("4")), number({ minimumSignificantDigits: "-1", decimalPlaces: "0" })])
      .toEqual(["Number, 2 decimal places", "Number, minimum 6 significant digits", "Number", "Number, 0 decimal places"]);
    // The dialog writes one count and -1 for the other. A format that holds both says both.
    expect(number({ minimumSignificantDigits: 6, decimalPlaces: 2 })).toBe("Number, minimum 6 significant digits, 2 decimal places");
    expect(number({ minimumSignificantDigits: 4, decimalPlaces: 2 })).toBe("Number, 2 decimal places");
  });

  it("says a number's units: a percentage, a currency by its code, custom units and where they stand", () => {
    expect(number({ ...places(2), unitsType: "PERCENTAGE", unitsDisplayType: "PERCENTAGE_SUFFIX" })).toBe("Number, 2 decimal places, %");
    const currency = { unitsType: "CURRENCY", currencyCode: "USD" };
    expect(number({ ...places(0), ...currency, unitsDisplayType: "CURRENCY_SYMBOL" })).toBe("Number, 0 decimal places, currency USD");
    expect(number({ ...currency, unitsDisplayType: "CURRENCY_CODE" })).toBe("Number, currency USD (as code)");
    expect(number({ unitsType: "CURRENCY", unitsDisplayType: "CURRENCY_SYMBOL" })).toBe("Number, currency");
    expect(number({ unitsType: "MULTI_CURRENCY", unitsDisplayType: "CURRENCY_SYMBOL" })).toBe("Number, multi currency");
    expect(number({ unitsType: "MULTI_CURRENCY", unitsDisplayType: "CURRENCY_CODE" })).toBe("Number, multi currency (as code)");
    expect(number({ unitsType: "CUSTOM", customUnits: "kg", unitsDisplayType: "CUSTOM_SUFFIX" })).toBe("Number, custom units kg (suffix)");
    expect(number({ unitsType: "CUSTOM", customUnits: "per unit", unitsDisplayType: "CUSTOM_PREFIX" })).toBe("Number, custom units per unit (prefix)");
    expect(number({ unitsType: "CUSTOM", unitsDisplayType: "CUSTOM_SUFFIX" })).toBe("Number, custom units (suffix)");
    expect(number({ unitsType: "CUSTOM", customUnits: "kg", unitsDisplayType: null })).toBe("Number, custom units kg");
    // No units: whatever is left in the other fields of the units says nothing.
    expect(number({ unitsType: "NONE", unitsDisplayType: "CURRENCY_CODE", currencyCode: "USD", customUnits: "kg" })).toBe("Number");
  });

  it("says custom units as they were typed, not as Anaplan stores them", () => {
    expect(custom("R&amp;D &lt;h&gt; &quot;net&quot;")).toBe(withUnits("R&D <h> \"net\""));
    expect(custom("&lt;b&gt;")).toBe(withUnits("<b>"));
  });

  it("undoes what Anaplan escaped in custom units once: entity text that was typed stays entity text", () => {
    // Typed as "&lt;b&gt;", and so stored with each "&" escaped. Undone once, it is the text that was typed. Undone twice
    // it would be "<b>", another unit, and the page, which escapes these words once, would show that one.
    expect(custom("&amp;lt;b&amp;gt;")).toBe(withUnits("&lt;b&gt;"));
    // Each escaped character behind an escaped "&": whichever is undone first, none is undone twice.
    expect(["&amp;amp;", "&amp;lt;", "&amp;gt;", "&amp;quot;"].map(custom)).toEqual(["&amp;", "&lt;", "&gt;", "&quot;"].map(withUnits));
    // Typed characters beside typed entity text: every one is undone, and none is left half undone.
    expect(custom("&lt;&amp;lt;&gt;&amp;gt;&quot;&amp;quot;&amp;&amp;amp;")).toBe(withUnits("<&lt;>&gt;\"&quot;&&amp;"));
    // Escaped three times over: one escaping is undone, not every one.
    expect(custom("&amp;amp;lt;b&amp;amp;gt;")).toBe(withUnits("&amp;lt;b&amp;gt;"));
    // Whatever was typed comes back as it was typed, from what Anaplan stores for it.
    for (const typed of ["<b>", "&lt;b&gt;", "&amp;lt;b&amp;gt;", "R&D", "R&amp;D", "a < b > c & \"d\"", "&&lt;&&gt;&&quot;&&amp;", "&;lt;", "&amp", "&#60;", "100% & more"]) {
      expect(custom(stored(typed)), typed).toBe(withUnits(typed));
    }
  });

  it("leaves entity text that Anaplan does not write in custom units as it is", () => {
    // Another entity, a character by its number, other case, no semicolon, a bare "&": none of them is undone.
    const text = "&apos; &#60; &#x3c; &nbsp; &copy; &LT; &Amp; &QUOT; &lt &amp &gt &quot R&D & ;";
    expect(custom(text)).toBe(withUnits(text));
  });

  it("says each other option of a number that is not at Anaplan's default, always in the same order", () => {
    const options: [changes: Record<string, unknown>, words: string][] = [
      [{ negativeNumberNotation: "PARENTHESES" }, "negatives in brackets"], [{ zeroFormat: "BLANK" }, "zero as blank"], [{ zeroFormat: "HYPHEN" }, "zero as hyphen"],
      [{ groupingSeparator: "NONE" }, "no thousand separator"], [{ groupingSeparator: "FULL_STOP" }, "thousand separator dot"],
      [{ groupingSeparator: "SPACE" }, "thousand separator space"], [{ decimalSeparator: "COMMA" }, "decimal point comma"],
      [{ comparisonIncrease: "BAD" }, "increase in value is bad"], [{ comparisonIncrease: "NEUTRAL" }, "increase in value is neutral"]];
    for (const [changes, words] of options) expect(number(changes), words).toBe(`Number, ${words}`);
    expect(number({ ...places(2), unitsType: "PERCENTAGE", unitsDisplayType: "PERCENTAGE_SUFFIX", negativeNumberNotation: "PARENTHESES", zeroFormat: "HYPHEN",
      groupingSeparator: "FULL_STOP", decimalSeparator: "COMMA", comparisonIncrease: "BAD" }))
      .toBe("Number, 2 decimal places, %, negatives in brackets, zero as hyphen, thousand separator dot, decimal point comma, increase in value is bad");
  });

  it("says a choice it does not know by the value the cell holds, never hiding it", () => {
    expect(number({ unitsType: "PER_MILLE" })).toBe("Number, units PER_MILLE");
    expect(number({ unitsType: "PER_MILLE", unitsDisplayType: "PER_MILLE_SUFFIX" })).toBe("Number, units PER_MILLE (PER_MILLE_SUFFIX)");
    expect(number({ unitsType: "PERCENTAGE", unitsDisplayType: "PERCENTAGE_PREFIX" })).toBe("Number, % (PERCENTAGE_PREFIX)");
    // "NONE" is not a way the Format dialog shows a percentage, a currency or custom units.
    expect(number({ unitsType: "PERCENTAGE", unitsDisplayType: "NONE" })).toBe("Number, % (NONE)");
    expect(number({ unitsType: "PERCENTAGE", unitsDisplayType: null })).toBe("Number, %");
    expect(number({ unitsType: "CURRENCY", currencyCode: "USD", unitsDisplayType: "CURRENCY_NAME" })).toBe("Number, currency USD (CURRENCY_NAME)");
    expect(number({ unitsType: "CUSTOM", customUnits: "kg", unitsDisplayType: "CUSTOM_ABOVE" })).toBe("Number, custom units kg (CUSTOM_ABOVE)");
    expect(number({ negativeNumberNotation: "RED", zeroFormat: "DASH", groupingSeparator: "APOSTROPHE", decimalSeparator: "MIDDLE_DOT", comparisonIncrease: "UNKNOWN" }))
      .toBe("Number, negative numbers RED, zero format DASH, thousand separator APOSTROPHE, decimal point MIDDLE_DOT, increase in value is UNKNOWN");
    expect(formatWords(cell({ textType: "RICH", dataType: "TEXT" }))).toBe("Text: RICH");
    expect(formatWords(cell({ periodType: { entityId: "DAY" }, dataType: "TIME_ENTITY" }))).toBe("Time Period: DAY");
    // A value with the name of something every object has is a value like any other.
    expect(number({ zeroFormat: "constructor", unitsType: "toString", unitsDisplayType: "valueOf" })).toBe("Number, units toString (valueOf), zero format constructor");
    expect(formatWords(cell({ textType: "hasOwnProperty", dataType: "TEXT" }))).toBe("Text: hasOwnProperty");
  });

  it("says a text's type when it is not General", () => {
    const text = (textType?: unknown) => formatWords(cell({ textType, dataType: "TEXT" }));
    expect([text("GENERAL"), text("DRILLTHRU_URI"), text("EMAIL_ADDRESS"), text(), text(null)]).toEqual(["Text", "Text: Link", "Text: Email", "Text", "Text"]);
  });

  it("says which period a time period is", () => {
    const period = (periodType: unknown) => formatWords(cell({ periodType, dataType: "TIME_ENTITY" }));
    expect(period({ entityId: "MONTH", entityLabel: "Month", entityIndex: 3 })).toBe("Time Period: Month");
    // The label the format carries is what Anaplan's grid shows; without one, the period's own label.
    expect(period({ entityId: "HALF_YEAR", entityLabel: "Half" })).toBe("Time Period: Half");
    expect(["WEEK", "MONTH", "QUARTER", "HALF_YEAR", "YEAR"].map(entityId => period({ entityId })))
      .toEqual(["Time Period: Week", "Time Period: Month", "Time Period: Quarter", "Time Period: Half-Year", "Time Period: Year"]);
    expect(period({ entityId: "QUARTER", entityLabel: null })).toBe("Time Period: Quarter");
    expect([period(null), period(undefined)]).toEqual(["Time Period", "Time Period"]);
  });

  it("names a list when the caller can, and says its ID as an ID when it cannot", () => {
    expect(formatWords(list(), LIST_NAMES)).toBe("List: Products");
    expect(formatWords(list({ hierarchyEntityLongId: 109000000002 }), LIST_NAMES)).toBe("List: Products: Active");
    // No names at all, a list the caller does not know, and a name that says nothing.
    expect(formatWords(list())).toBe("List: ID 101000000007");
    expect(formatWords(list(), {})).toBe("List: ID 101000000007");
    expect(formatWords(list({ hierarchyEntityLongId: 101000000008 }), LIST_NAMES)).toBe("List: ID 101000000008");
    for (const name of ["", "  ", "\n", undefined, null, 101000000007, {}, ["Products"]]) {
      expect(formatWords(list(), { listName: () => name as string }), JSON.stringify(name)).toBe("List: ID 101000000007");
    }
    // A lookup that fails, or is not one, gives no name: the ID is said, and nothing is thrown.
    expect(formatWords(list(), { listName: () => { throw new Error("no such list"); } })).toBe("List: ID 101000000007");
    expect(formatWords(list(), { listName: LISTS as unknown as CellNames["listName"] })).toBe("List: ID 101000000007");
    // The format names no list.
    for (const none of [undefined, null, -1, ""]) expect(formatWords(list({ hierarchyEntityLongId: none }), LIST_NAMES), String(none)).toBe("List");
  });

  it("asks for a list's name by its ID as digits, however the cell writes the ID", () => {
    const asked: unknown[] = [];
    const names: CellNames = { listName: id => { asked.push(id); return LISTS.get(id); } };
    for (const id of [101000000007, "101000000007", "_101000000007_"]) expect(formatWords(list({ hierarchyEntityLongId: id }), names), String(id)).toBe("List: Products");
    expect(asked).toEqual(["101000000007", "101000000007", "101000000007"]);
  });

  it("says a list's filters", () => {
    const dependent = { sourceLineItemOrProperty: "_1901000000021_", mappingHierarchy: "_101000000009_", keyProperty: "_4000000001_", valueProperty: "_1010000000090001_" };
    expect(formatWords(list({ selectiveAccessApplied: true }), LIST_NAMES)).toBe("List: Products, filter: selective access");
    expect(formatWords(list({ entityFormatFilter: dependent }), LIST_NAMES)).toBe("List: Products, filter: dependent");
    expect(formatWords(list({ selectiveAccessApplied: true, entityFormatFilter: dependent, showAll: true }), LIST_NAMES))
      .toBe("List: Products, filter: selective access, dependent, unfiltered items allowed");
    expect(formatWords(list({ entityFormatFilter: dependent, showAll: true }))).toBe("List: ID 101000000007, filter: dependent, unfiltered items allowed");
    expect(formatWords(cell({ dataType: "ENTITY", selectiveAccessApplied: true }))).toBe("List, filter: selective access");
  });

  it("gives plain text: a name and custom units go in as they are, for the caller to escape", () => {
    expect(formatWords(list(), { listName: () => "<b>Tom & \"Jerry's\"</b>" })).toBe("List: <b>Tom & \"Jerry's\"</b>");
    expect(number({ unitsType: "CUSTOM", customUnits: "<i>x</i>", unitsDisplayType: "CUSTOM_PREFIX" })).toBe("Number, custom units <i>x</i> (prefix)");
    // Only custom units are stored escaped. A name from the caller and a period's label are plain text already: entity
    // text in one is text, and nothing of it is undone.
    expect(formatWords(list(), { listName: () => "R&amp;D &lt;b&gt;" })).toBe("List: R&amp;D &lt;b&gt;");
    expect(formatWords(cell({ periodType: { entityId: "MONTH", entityLabel: "P&amp;L &lt;month&gt;" }, dataType: "TIME_ENTITY" }))).toBe("Time Period: P&amp;L &lt;month&gt;");
  });

  it("leaves a cell that is not a format it reads as it is", () => {
    for (const text of NOT_A_DEFINITION) expect(formatWords(text), String(text).slice(0, 40)).toBeUndefined();
    // A data type it does not know: the cell's options are not known either.
    for (const dataType of ["CURRENCY", "number", " NUMBER", "", null, 7, ["NUMBER"], { is: "NUMBER" }, "constructor", "__proto__", "toString"]) {
      expect(formatWords(cell({ ...DEFAULT_NUMBER, dataType })), JSON.stringify(dataType)).toBeUndefined();
    }
    // A field that holds what it cannot hold. Nothing of such a cell is said.
    const wrong: Record<string, unknown>[] = [places(2.5), places("two"), places(-2), places(true), places([2]), digits(1e21), digits({}), { zeroFormat: 0 }, { zeroFormat: {} },
      { unitsType: 7 }, { unitsType: "CURRENCY", currencyCode: 840 }, { unitsType: "CUSTOM", customUnits: ["kg"] }, { unitsType: "PERCENTAGE", unitsDisplayType: false },
      { decimalSeparator: [] }, { groupingSeparator: 1 }, { negativeNumberNotation: true }, { comparisonIncrease: {} }];
    for (const changes of wrong) expect(number(changes), JSON.stringify(changes)).toBeUndefined();
    for (const textType of [7, [], {}, true]) expect(formatWords(cell({ textType, dataType: "TEXT" })), JSON.stringify(textType)).toBeUndefined();
    for (const periodType of ["MONTH", 3, [], {}, { entityLabel: 5 }, { entityId: ["MONTH"] }, true]) {
      expect(formatWords(cell({ periodType, dataType: "TIME_ENTITY" })), JSON.stringify(periodType)).toBeUndefined();
    }
    const lists: Record<string, unknown>[] = [{ hierarchyEntityLongId: "Products" }, { hierarchyEntityLongId: 1.5 }, { hierarchyEntityLongId: -2 }, { hierarchyEntityLongId: {} },
      { hierarchyEntityLongId: [101000000007] }, { hierarchyEntityLongId: "__" }, { selectiveAccessApplied: "true" }, { showAll: 1 }, { entityFormatFilter: "dependent" },
      { entityFormatFilter: [] }];
    for (const changes of lists) expect(formatWords(list(changes), LIST_NAMES), JSON.stringify(changes)).toBeUndefined();
  });

  it("does not read a cell longer than any definition is", () => {
    const sized = (length: number): string => {
      const empty = cell({ ...DEFAULT_NUMBER, unitsType: "CUSTOM", customUnits: "", unitsDisplayType: "CUSTOM_SUFFIX" });
      return empty.replace("\"customUnits\":\"\"", `"customUnits":"${"k".repeat(length - empty.length)}"`);
    };
    const longest = sized(MAX_DEFINITION_LENGTH);
    expect(longest.length).toBe(MAX_DEFINITION_LENGTH);
    expect(formatWords(longest)).toMatch(/^Number, custom units k+ \(suffix\)$/);
    expect(formatWords(sized(MAX_DEFINITION_LENGTH + 1))).toBeUndefined();
    expect(MAX_DEFINITION_LENGTH).toBe(20_000);
  });
});

describe("A line item's Summary in words", () => {
  it("says each summary method by Anaplan's label, alone when the time summary is the same as the main one", () => {
    for (const [method, label] of METHODS) expect(summary(chosen(method, method, true)), method).toBe(label);
    expect(METHODS).toHaveLength(13);
  });

  it("says each time summary method after \"Time:\" when it is chosen apart from the main summary", () => {
    for (const [method, label] of METHODS) expect(summary(chosen("NONE", method, false)), method).toBe(`None, Time: ${label}`);
    expect(summary(chosen("SUM", "CLOSING_BALANCE", false))).toBe("Sum, Time: Closing Balance");
    expect(summary(chosen("AVERAGE", "OPENING_BALANCE", false))).toBe("Average, Time: Opening Balance");
    expect(summary(chosen("FORMULA", "LAST_NON_BLANK", false))).toBe("Formula, Time: Last non-blank");
  });

  it("takes the summary's own word for whether its time summary is the same as the main one, as Anaplan's grid does", () => {
    // "Same as main summary": the time summary is not said, whatever method the cell still holds for it.
    expect(summary(chosen("SUM", "CLOSING_BALANCE", true))).toBe("Sum");
    // A time summary chosen by name is said, even when it is the same method.
    expect(summary(chosen("SUM", "SUM", false))).toBe("Sum, Time: Sum");
    // A summary that does not say: the time summary is said when its method differs.
    expect(summary({ summaryMethod: "SUM" })).toBe("Sum");
    expect(summary({ summaryMethod: "SUM", timeSummaryMethod: "SUM" })).toBe("Sum");
    expect(summary({ summaryMethod: "SUM", timeSummaryMethod: "AVERAGE" })).toBe("Sum, Time: Average");
    expect(summary({ summaryMethod: "SUM", timeSummaryMethod: "AVERAGE", timeSummarySameAsMainSummary: null })).toBe("Sum, Time: Average");
    expect(summary({ summaryMethod: "SUM", timeSummaryMethod: null, timeSummarySameAsMainSummary: true })).toBe("Sum");
    // Chosen apart, but no time summary to say: not a summary this module reads.
    expect(summary({ summaryMethod: "SUM", timeSummarySameAsMainSummary: false })).toBeUndefined();
    expect(summary({ summaryMethod: "SUM", timeSummaryMethod: "", timeSummarySameAsMainSummary: false })).toBeUndefined();
  });

  it("says what a Ratio divides: by name when the caller has the names, by ID when it has not", () => {
    const ratio = { ...chosen("RATIO", "RATIO", true), ...RATIO_IDS };
    expect(summary(ratio, RATIO_NAMES)).toBe("Ratio = Profit / Revenue");
    expect(summary(ratio)).toBe("Ratio = ID 1901000000011 / ID 1901000000012");
    expect(summary(ratio, {})).toBe("Ratio = ID 1901000000011 / ID 1901000000012");
    // One name only, and names that say nothing: the ID stands where a name is missing, never a guess.
    expect(summary(ratio, { ratioNumerator: "Profit" })).toBe("Ratio = Profit / ID 1901000000012");
    expect(summary(ratio, { ratioDenominator: "Revenue" })).toBe("Ratio = ID 1901000000011 / Revenue");
    expect(summary(ratio, { ratioNumerator: "", ratioDenominator: "  " })).toBe("Ratio = ID 1901000000011 / ID 1901000000012");
    expect(summary(ratio, { ratioNumerator: 7, ratioDenominator: null } as unknown as CellNames)).toBe("Ratio = ID 1901000000011 / ID 1901000000012");
    // The IDs as a summary may also hold them: digits, or a number.
    expect(summary({ summaryMethod: "RATIO", ratioNumeratorIdentifier: "1901000000011", ratioDenominatorIdentifier: 1901000000012 })).toBe("Ratio = ID 1901000000011 / ID 1901000000012");
    // The caller's names are enough; without a name or an ID on both sides, the method alone, as Anaplan's grid shows it.
    expect(summary({ summaryMethod: "RATIO" }, RATIO_NAMES)).toBe("Ratio = Profit / Revenue");
    expect(summary(chosen("RATIO", "RATIO", true))).toBe("Ratio");
    expect(summary(chosen("RATIO", "RATIO", true), { ratioNumerator: "Profit" })).toBe("Ratio");
    expect(summary({ summaryMethod: "RATIO", ratioNumeratorIdentifier: "_1901000000011_", ratioDenominatorIdentifier: null })).toBe("Ratio");
  });

  it("says a Ratio's operands once, where the Ratio is: the main summary, or the time summary", () => {
    expect(summary({ ...chosen("RATIO", "SUM", false), ...RATIO_IDS }, RATIO_NAMES)).toBe("Ratio = Profit / Revenue, Time: Sum");
    expect(summary({ ...chosen("SUM", "RATIO", false), ...RATIO_IDS }, RATIO_NAMES)).toBe("Sum, Time: Ratio = Profit / Revenue");
    expect(summary({ ...chosen("SUM", "RATIO", false), ...RATIO_IDS })).toBe("Sum, Time: Ratio = ID 1901000000011 / ID 1901000000012");
    expect(summary({ ...chosen("RATIO", "RATIO", false), ...RATIO_IDS }, RATIO_NAMES)).toBe("Ratio = Profit / Revenue, Time: Ratio");
    // The engine's own fixture: no word on whether the two are the same.
    expect(summary({ summaryMethod: "RATIO", timeSummaryMethod: "RATIO", ...RATIO_IDS }, RATIO_NAMES)).toBe("Ratio = Profit / Revenue");
    // Names, or IDs left in the cell, of a summary that is no Ratio are not said.
    expect(summary({ ...chosen("SUM", "SUM", true), ...RATIO_IDS }, RATIO_NAMES)).toBe("Sum");
    expect(summary({ ...chosen("SUM", "AVERAGE", false), ...RATIO_IDS }, RATIO_NAMES)).toBe("Sum, Time: Average");
  });

  it("says a method it does not know by the value the cell holds", () => {
    expect(summary({ summaryMethod: "MEDIAN" })).toBe("MEDIAN");
    expect(summary(chosen("SUM", "WEIGHTED_AVERAGE", false))).toBe("Sum, Time: WEIGHTED_AVERAGE");
    expect(summary({ summaryMethod: "sum" })).toBe("sum");
    // A value with the name of something every object has is a value like any other.
    expect(summary(chosen("constructor", "toString", false))).toBe("constructor, Time: toString");
    expect(summary({ summaryMethod: "__proto__" })).toBe("__proto__");
  });

  it("gives plain text: a name goes in as it is, for the caller to escape", () => {
    expect(summary({ ...chosen("RATIO", "RATIO", true), ...RATIO_IDS }, { ratioNumerator: "<i>Profit</i> & loss", ratioDenominator: "Revenue \"net\"" }))
      .toBe("Ratio = <i>Profit</i> & loss / Revenue \"net\"");
    // Entity text in a name is text: nothing of it is undone.
    expect(summary({ ...chosen("RATIO", "RATIO", true), ...RATIO_IDS }, { ratioNumerator: "R&amp;D", ratioDenominator: "&lt;all&gt;" })).toBe("Ratio = R&amp;D / &lt;all&gt;");
  });

  it("leaves a cell that is not a summary it reads as it is", () => {
    for (const text of NOT_A_DEFINITION) expect(summaryWords(text), String(text).slice(0, 40)).toBeUndefined();
    const wrong: Record<string, unknown>[] = [{ summaryMethod: null }, { summaryMethod: "" }, { summaryMethod: 5 }, { summaryMethod: ["SUM"] }, { summaryMethod: { is: "SUM" } },
      { timeSummaryMethod: "SUM" }, { summaryMethod: "SUM", timeSummaryMethod: 7 }, { summaryMethod: "SUM", timeSummaryMethod: ["SUM"] },
      { summaryMethod: "SUM", timeSummarySameAsMainSummary: "false" }, { summaryMethod: "SUM", timeSummaryMethod: "SUM", timeSummarySameAsMainSummary: 0 },
      // A Ratio whose operand is no ID, where no name stands for it.
      { summaryMethod: "RATIO", ratioNumeratorIdentifier: "Profit", ratioDenominatorIdentifier: "_1901000000012_" },
      { summaryMethod: "RATIO", ratioNumeratorIdentifier: "_1901000000011_", ratioDenominatorIdentifier: {} },
      { summaryMethod: "RATIO", ratioNumeratorIdentifier: 1.5, ratioDenominatorIdentifier: "_1901000000012_" }];
    for (const definition of wrong) expect(summary(definition), JSON.stringify(definition)).toBeUndefined();
    // A format is not a summary, nor a summary a format.
    expect(summaryWords(cell(DEFAULT_NUMBER))).toBeUndefined();
    expect(formatWords(cell(chosen("SUM", "SUM", true)))).toBeUndefined();
  });
});

describe("An action's definition in words", () => {
  it("says each kind of action as Anaplan's Actions grid shows it", () => {
    expect(["PROCESS", "BULK_COPY", "UPDATE_CURRENT_PERIOD"].map(actionType => actionWords(cell({ actionType })))).toEqual(["Process", "Bulk Copy", "Update Current Period"]);
    const operations: [operation: string, words: string][] = [["SIMPLE_CREATE", "Create"], ["SYNCHRONISE_HIERARCHY", "Synchronise Hierarchy"],
      ["SET_PROPERTY_AND_SYNCHRONISE_HIERARCHY", "Set Property and Synchronise Hierarchy"], ["COPY_TO_NUMBERED_LIST", "Assign Only"], ["DEFINE_ENTITIES", "Define Entities"],
      ["SELECT_CHILDREN", "Assign"], ["BULK_ENTITY_COPY", "Copy Branch"], ["BULK_DELETE_ENTITIES", "Delete Branch"], ["OPTIMIZER", "Optimizer"]];
    for (const [operation, words] of operations) expect(actionWords(task({ taskElementType: "BULK_OPERATION", operation, hierarchyEntityLongId: 101000000007 })), operation).toBe(words);
    expect(actionWords(task({ taskElementType: "DASHBOARD", dashboardEntityLongId: 115000000004 }))).toBe("Open Dashboard");
    // The Optimizer is known by what it does, whatever kind of task element it is; any other kind is a task element.
    expect(actionWords(task({ operation: "OPTIMIZER" }))).toBe("Optimizer");
    expect(actionWords(task({ taskElementType: "OTHER_ACTION" }))).toBe("Task Element");
    expect(actionWords(task({ taskElementType: "OTHER_ACTION", operation: "SIMPLE_CREATE" }))).toBe("Task Element");
    // A bulk operation it does not know is said by its value, as Anaplan's grid says it.
    expect(actionWords(task({ taskElementType: "BULK_OPERATION", operation: "MERGE_ENTITIES" }))).toBe("MERGE_ENTITIES");
    expect(actionWords(task({ taskElementType: "BULK_OPERATION", operation: "constructor" }))).toBe("constructor");
    // The task element as an object, where Anaplan writes it as JSON in text.
    expect(actionWords(cell({ actionType: "TASK_ELEMENT", taskElement: { taskElementType: "BULK_OPERATION", operation: "SELECT_CHILDREN" } }))).toBe("Assign");
  });

  it("names the list an action deletes from or orders, or says the list's ID", () => {
    const from = (actionType: string, hierarchyIdentifier?: unknown): string => cell({ actionType, hierarchyIdentifier, filterLineItemIdentifier: "_1901000000031_" });
    expect(actionWords(from("DELETE_BY_SELECTION", "_101000000007_"), LIST_NAMES)).toBe("Delete from Products using Selection");
    expect(actionWords(from("DELETE_BY_SELECTION", "_101000000007_"))).toBe("Delete from list ID 101000000007 using Selection");
    expect(actionWords(from("DELETE_BY_SELECTION", "_101000000008_"), LIST_NAMES)).toBe("Delete from list ID 101000000008 using Selection");
    expect(actionWords(from("ORDER_HIERARCHY", "_109000000002_"), LIST_NAMES)).toBe("Order Products: Active");
    expect(actionWords(from("ORDER_HIERARCHY", "_109000000002_"))).toBe("Order list ID 109000000002");
    // The action names no list: the label as it stands.
    expect([actionWords(from("DELETE_BY_SELECTION"), LIST_NAMES), actionWords(from("ORDER_HIERARCHY", ""), LIST_NAMES)]).toEqual(["Delete from List using Selection", "Order List"]);
    // A name goes in as it is, whatever it holds.
    expect(actionWords(from("DELETE_BY_SELECTION", "_101000000007_"), { listName: () => "$& <b>$1</b> List" })).toBe("Delete from $& <b>$1</b> List using Selection");
    expect(actionWords(from("ORDER_HIERARCHY", "_101000000007_"), { listName: () => "R&amp;D &lt;b&gt;" })).toBe("Order R&amp;D &lt;b&gt;");
    // Another kind of action names no list: what its cell holds in that place is not read, an ID or not.
    expect(actionWords(from("BULK_COPY", "_101000000007_"), LIST_NAMES)).toBe("Bulk Copy");
    expect(actionWords(from("BULK_COPY", "Versions"), LIST_NAMES)).toBe("Bulk Copy");
    expect(actionWords(from("UPDATE_CURRENT_PERIOD", { not: "an ID" }), LIST_NAMES)).toBe("Update Current Period");
  });

  it("leaves a cell that is not an action it reads as it is", () => {
    for (const text of NOT_A_DEFINITION) expect(actionWords(text), String(text).slice(0, 40)).toBeUndefined();
    const wrong: unknown[] = [{ exportType: "GRID_CURRENT_PAGE" }, { actionType: "EXPORT" }, { actionType: "process" }, { actionType: "" }, { actionType: null }, { actionType: 3 },
      { actionType: ["PROCESS"] }, { actionType: "constructor" }, { actionType: "__proto__" }, { actionType: "TASK_ELEMENT" }, { actionType: "TASK_ELEMENT", taskElement: null },
      { actionType: "TASK_ELEMENT", taskElement: "" }, { actionType: "TASK_ELEMENT", taskElement: "not json" }, { actionType: "TASK_ELEMENT", taskElement: "{not json}" },
      { actionType: "TASK_ELEMENT", taskElement: "[]" }, { actionType: "TASK_ELEMENT", taskElement: [] }, { actionType: "TASK_ELEMENT", taskElement: 5 },
      { actionType: "TASK_ELEMENT", taskElement: "{\"taskElementType\":\"BULK_OPERATION\"}" }, { actionType: "TASK_ELEMENT", taskElement: "{\"taskElementType\":7}" },
      { actionType: "TASK_ELEMENT", taskElement: "{\"taskElementType\":\"BULK_OPERATION\",\"operation\":[\"SIMPLE_CREATE\"]}" },
      { actionType: "DELETE_BY_SELECTION", hierarchyIdentifier: "Products" }, { actionType: "ORDER_HIERARCHY", hierarchyIdentifier: {} }];
    for (const definition of wrong) expect(actionWords(cell(definition), LIST_NAMES), JSON.stringify(definition)).toBeUndefined();
  });
});

describe("A cell in words, by its column's header", () => {
  const FORMAT = cell({ ...DEFAULT_NUMBER, ...places(2), unitsType: "PERCENTAGE", unitsDisplayType: "PERCENTAGE_SUFFIX" });
  const SUMMARY = cell(chosen("SUM", "CLOSING_BALANCE", false));
  const ACTION = task({ taskElementType: "BULK_OPERATION", operation: "SIMPLE_CREATE" });
  const NAMES: CellNames = { ...LIST_NAMES, ...RATIO_NAMES };

  it("understands the Format, the Summary and the Action column", () => {
    expect(READABLE_HEADERS).toEqual(["Format", "Summary", "Action"]);
    expect(READABLE_HEADERS.map(header => readableCell(header, { Format: FORMAT, Summary: SUMMARY, Action: ACTION }[header])))
      .toEqual(["Number, 2 decimal places, %", "Sum, Time: Closing Balance", "Create"]);
    // The names reach each column's words.
    expect(readableCell("Format", list(), NAMES)).toBe("List: Products");
    expect(readableCell("Summary", cell({ summaryMethod: "RATIO", ...RATIO_IDS }), NAMES)).toBe("Ratio = Profit / Revenue");
    expect(readableCell("Action", cell({ actionType: "ORDER_HIERARCHY", hierarchyIdentifier: "_101000000007_" }), NAMES)).toBe("Order Products");
    expect(readableCell("Format", list())).toBe("List: ID 101000000007");
  });

  it("reads under a header only that column's own definition", () => {
    const cells = [FORMAT, SUMMARY, ACTION];
    expect(READABLE_HEADERS.map(header => cells.map(text => readableCell(header, text) !== undefined))).toEqual([[true, false, false], [false, true, false], [false, false, true]]);
  });

  it("gives nothing for any other column, whatever its cell holds", () => {
    const merged = cell({ ...DEFAULT_NUMBER, ...chosen("SUM", "SUM", true), actionType: "PROCESS" });
    expect(READABLE_HEADERS.map(header => readableCell(header, merged))).toEqual(["Number", "Sum", "Process"]);
    for (const header of ["", "format", "FORMAT", "Format ", " Format", "Formats", "Summary Method", "Action type", "Formula", "Notes", "Applies To", "Ratio Numerator",
      "constructor", "__proto__", "toString", "hasOwnProperty", "0", 0, 1, null, undefined, true, {}, ["Format"], () => "Format"]) {
      expect(readableCell(header, merged), String(header)).toBeUndefined();
    }
  });

  it("gives nothing for a cell that is no definition, so the caller shows the cell as it is", () => {
    for (const header of READABLE_HEADERS) for (const text of NOT_A_DEFINITION) expect(readableCell(header, text), `${header}: ${String(text).slice(0, 40)}`).toBeUndefined();
    // A line item's module has its own row in the Line Items table, with these cells empty.
    expect([readableCell("Format", ""), readableCell("Summary", "")]).toEqual([undefined, undefined]);
  });

  it("never throws, and gives words or nothing, whatever it is handed", () => {
    const failing = Object.defineProperty({}, "ratioNumerator", { get: () => { throw new Error("no name"); } }) as CellNames;
    const names: unknown[] = [undefined, null, {}, "names", 7, [], LIST_NAMES, RATIO_NAMES, failing, { listName: () => { throw new Error("no such list"); } },
      { listName: "Products" }, { listName: () => ({ toString: () => { throw new Error("no text"); } }) }, { ratioNumerator: {}, ratioDenominator: [] }];
    const texts: unknown[] = [...NOT_A_DEFINITION, FORMAT, SUMMARY, ACTION, list(), cell({ summaryMethod: "RATIO", ...RATIO_IDS }),
      cell({ actionType: "DELETE_BY_SELECTION", hierarchyIdentifier: "_101000000007_" }), cell({ periodType: { entityId: "MONTH" }, dataType: "TIME_ENTITY" })];
    let read = 0;
    for (const header of [...READABLE_HEADERS, "Notes", null]) {
      for (const text of texts) {
        for (const given of names) {
          let words: unknown;
          expect(() => { words = readableCell(header, text, given as CellNames); }).not.toThrow();
          expect(words === undefined || (typeof words === "string" && words !== "")).toBe(true);
          if (words !== undefined) read++;
        }
      }
    }
    // Each definition was read under its own header with every one of the names, but the summary whose names cannot be read.
    expect(read).toBe(7 * names.length - 1);
  });
});
