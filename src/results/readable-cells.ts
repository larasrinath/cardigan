/** Some cells of a model's settings grids hold a definition as JSON, because that is what Anaplan's own export of the grid
 * writes: a line item's Format (`{"minimumSignificantDigits":4,…,"dataType":"NUMBER"}`), its Summary, an action's
 * definition in the Actions list, and what a source model is mapped to (`mappingWords`). The result keeps that text
 * exactly, and a row's drawer shows it. The page says such a cell in words, and this module makes the words. It takes the cell's text and gives plain text back, which the caller escapes. It reads
 * no result and no page, and it never throws: a cell it cannot read gives undefined, and the caller shows the cell as it is.
 *
 * The words are Anaplan's own wherever the classic client's sources settle them: the client's modules (named below as the
 * client names them, anaplan/…), its dialogs' templates, and its English labels in the client's dojo/nls/dojo_en-us.js
 * (named below by bundle, anaplan/nls/…).
 *
 * What the grid itself shows in such a cell is anaplan/data/DataPageCache/_DataPage.js `_getFormattedCellText` (and the
 * same in anaplan/data/CellItemCache.js). For a format: the data type's label, or for a list its name alone, or for a time
 * period the period's label alone. For a summary: the method's label, then ", Time: " and the time summary's label unless
 * the time summary is "Same as main summary". For an action: anaplan/data/OtherAction.js `getDisplayValue`.
 *
 * The words here start from that and add what the grid leaves to its dialogs. A format says its data type before a list or
 * a period ("List: Products", where the grid shows "Products") and, after it, each option of the Format dialog that is not
 * at Anaplan's default. A Ratio says what it divides. The labels in those additions are Anaplan's; the phrases around
 * them are this module's, and each says below which option of the dialog it stands for. */

/** The names only the caller can know. A name that is missing or blank is never guessed: the ID is said instead, as an ID. */
export interface CellNames {
  /** The name of the list that a List format or an action points at, by the list's ID as digits ("101000000007"). The
   * client finds that ID among the lists, the list subsets and the line item subsets (anaplan/data/ModelContentHelper.js
   * `getHierarchyId`). */
  listName?: (id: string) => string | undefined;
  /** The line items a Ratio summary divides, by name: the row's "Ratio Numerator" and "Ratio Denominator" cells. */
  ratioNumerator?: string;
  ratioDenominator?: string;
}

type Definition = Record<string, unknown>;

/** A format or a summary is a few hundred characters. An action can be longer: Open Dashboard may name a dashboard for
 * each of up to 200 items of a list (anaplan/constants.js `OPEN_DASHBOARD_MAX_ITEM_LIMIT`), which is some thousands of
 * characters. A cell longer than this is not a definition, and is not read. */
export const MAX_DEFINITION_LENGTH = 20_000;

/** Thrown where a definition holds something its field cannot hold (a list for a data type, say). The cell is then one
 * this module does not read: `words` answers undefined for it, and nothing of it is said by halves. */
const UNREADABLE = new Error("The cell holds something its definition cannot hold.");

/** Labels and choices are looked up in maps, so that a value with the name of an object's built-in property finds nothing. */
const labels = (...entries: [value: string, label: string][]): ReadonlyMap<string, string> => new Map(entries);

/* ---------- a definition's fields ---------- */

/** The object a cell's text holds. Undefined for text that does not start as one, which is every ordinary cell (a blank, a
 * name, a formula): it is not parsed at all. Text that only starts as one throws. */
function definitionOf(text: unknown): Definition | undefined {
  if (typeof text !== "string" || text.length > MAX_DEFINITION_LENGTH || !/^\s*\{/.test(text)) return undefined;
  return JSON.parse(text) as Definition;
}

/** A field's text: one of a fixed set of values, a code or a label. Nothing when the field is absent, null or empty. */
function word(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw UNREADABLE;
  return value;
}

/** A field's count. The Format dialog submits a chosen count as text (anaplan/gridlet/_editor/DataType.js
 * `_buildNumberFormat`), so digits count as well. Nothing for -1, which is how a format says "not this one": a number is
 * shown to a count of significant digits or to a count of decimal places, and the other of the two is -1. */
function count(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const number = typeof value === "number" ? value : typeof value === "string" && /^-?\d+$/.test(value) ? Number(value) : NaN;
  if (!Number.isSafeInteger(number) || number < -1) throw UNREADABLE;
  return number === -1 ? undefined : number;
}

/** A field's yes or no. Undefined when the field is absent or null, which is not the same as no for a summary. */
function flag(value: unknown): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "boolean") throw UNREADABLE;
  return value;
}

/** A field's ID, as digits. A format holds a list's ID as a number; a summary and an action hold an ID between underscores
 * ("_1901000000011_", anaplan/utils/EntityLongIdHelper.js). Nothing when the field is absent, empty or -1, the client's
 * "none" (anaplan/data/ModelContentHelper.js `_getEntityId`). */
function idOf(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "" || value === -1) return undefined;
  const digits = typeof value === "number" && Number.isSafeInteger(value) ? String(value) : typeof value === "string" ? value.replace(/^_+|_+$/g, "") : "";
  if (!/^\d+$/.test(digits)) throw UNREADABLE;
  return digits;
}

/** A field that holds a definition of its own, or nothing when it is absent or null. */
function part(value: unknown): Definition | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) throw UNREADABLE;
  return value as Definition;
}

/** A name the caller gave, when it says something. */
const given = (name: unknown): string | undefined => (typeof name === "string" && name.trim() !== "" ? name : undefined);

/** A list's name from the caller. The lookup is the caller's own: whatever it does, a name it does not give is not guessed. */
function listNameOf(id: string, names: CellNames): string | undefined {
  try {
    return given(typeof names.listName === "function" ? names.listName(id) : undefined);
  } catch {
    return undefined;
  }
}

const plural = (number: number, thing: string): string => `${number} ${thing}${number === 1 ? "" : "s"}`;

/* ---------- Format ---------- */

/** The data types (anaplan/constants.js `dataTypes`) by the labels of the Format dialog's Type list, which are also what
 * the grid shows (anaplan/nls/common `labelDataType…`). */
const DATA_TYPE = labels(["NUMBER", "Number"], ["BOOLEAN", "Boolean"], ["DATE", "Date"], ["TIME_ENTITY", "Time Period"], ["ENTITY", "List"], ["TEXT", "Text"],
  ["NONE", "No Data"]);

/** A text's types (anaplan/constants.js `textFormatType`) by the labels of the dialog's Text Type choices (anaplan/nls/dataType
 * `labelTextType…`). General is the dialog's default (the template DataType/Text.html), and is said as nothing. */
const TEXT_TYPE = labels(["GENERAL", ""], ["DRILLTHRU_URI", "Link"], ["EMAIL_ADDRESS", "Email"]);

/** A time period's periods (anaplan/gridlet/_editor/dataTypes/TimeEntity.js `_periodTypes`) by their labels (anaplan/nls/dataType
 * `labelPeriodType…`). A format carries its period's label itself; these stand in when one does not. */
const PERIOD_TYPE = labels(["WEEK", "Week"], ["MONTH", "Month"], ["QUARTER", "Quarter"], ["HALF_YEAR", "Half-Year"], ["YEAR", "Year"]);

/** Anaplan's default number format shows four significant digits (anaplan/constants.js `DEFAULT_NUMBER_FORMAT_DEFINITION`:
 * `minimumSignificantDigits: 4`, `decimalPlaces: -1`). */
const DEFAULT_SIGNIFICANT_DIGITS = 4;

/** How a number's units are shown (`unitsDisplayType`), by the kind of units (DataType.js `_buildNumberFormat`). What the
 * dialog starts from is said as nothing: a percentage's sign after the number, a currency's Symbol (the template
 * DataType.html). Custom units say Prefix or Suffix either way. Any other value is said as the cell holds it. */
const PERCENTAGE_SHOWN = labels(["PERCENTAGE_SUFFIX", ""]);
const CURRENCY_SHOWN = labels(["CURRENCY_SYMBOL", ""], ["CURRENCY_CODE", "as code"]);
const CUSTOM_SHOWN = labels(["CUSTOM_PREFIX", "prefix"], ["CUSTOM_SUFFIX", "suffix"]);
/** For units of a kind this module does not know, only "NONE" is known to say nothing. */
const OTHER_SHOWN = labels(["NONE", ""]);

/** The four characters the client escapes in custom units, by what it writes for each. It escapes "&" first, then "<", ">"
 * and the double quote (DataType.js `_buildNumberFormat`, with anaplan/utils/FormatHelper.js `escapeHTML`). */
const ESCAPED: ReadonlyMap<string, string> = new Map([["&amp;", "&"], ["&lt;", "<"], ["&gt;", ">"], ["&quot;", "\""]]);

/** Custom units as they were typed: each character the client escaped, undone exactly once. One pass over the text does
 * it, so that an "&" that comes out of "&amp;" is never read again as the start of another entity. Units typed as
 * "&lt;b&gt;" are stored as "&amp;lt;b&amp;gt;" and come back as "&lt;b&gt;". The caller escapes what this module returns
 * once for the page: undone twice, those units would show as "<b>", which is another unit, and with "&amp;" undone before
 * only some of the others, as "&lt;b>". The client's own `unescapeHTML` undoes "&amp;" first and so reads them back as
 * "<b>"; that order is not followed here. Entity text the client does not write ("&apos;", "&#60;", "&LT;") is text like
 * any other, and stays. */
const typed = (stored: string): string => stored.replace(/&(?:amp|lt|gt|quot);/g, entity => ESCAPED.get(entity) ?? entity);

/** A number's units, the dialog's Units group (DataType.js `_buildNumberFormat`; its labels in anaplan/nls/dataType): None
 * is said as nothing, Percentage as "%", Currency with its code, Multi Currency, and Other with its Custom Units. Units of a
 * kind not listed there are said by the value the cell holds. */
function unitsWords(format: Definition): string {
  const type = word(format.unitsType);
  if (type === undefined || type === "NONE") return "";
  const shown = word(format.unitsDisplayType);
  const how = (known: ReadonlyMap<string, string>): string => {
    const said = shown === undefined ? "" : known.get(shown) ?? shown;
    return said === "" ? "" : ` (${said})`;
  };
  switch (type) {
    case "PERCENTAGE":
      return `%${how(PERCENTAGE_SHOWN)}`;
    case "CURRENCY": {
      const code = word(format.currencyCode);
      return `${code === undefined ? "currency" : `currency ${code}`}${how(CURRENCY_SHOWN)}`;
    }
    case "MULTI_CURRENCY":
      return `multi currency${how(CURRENCY_SHOWN)}`;
    case "CUSTOM": {
      const units = word(format.customUnits);
      return `${units === undefined ? "custom units" : `custom units ${typed(units)}`}${how(CUSTOM_SHOWN)}`;
    }
    default:
      return `units ${type}${how(OTHER_SHOWN)}`;
  }
}

/** A number's other options: the dialog's Negative Numbers, Zero Format, Thousand Separator and Decimal Point and, under
 * Compare, its "Increase in value is" (the fields are DataType.js `_buildNumberFormat`; the choices and their English names
 * are DataType.js `_prepareSelect…`: Minus Sign and Brackets; Zero, Blank and Hyphen; None, Dot, Comma and Space; Dot and
 * Comma; Good, Bad and Neutral). They are said in this order, which is this module's: what changes how a value reads
 * comes before the separators. Anaplan's default choice (anaplan/constants.js `DEFAULT_NUMBER_FORMAT_DEFINITION`) is said
 * as nothing. A choice not listed there is said by the value the cell holds, after `other`. */
const NUMBER_OPTIONS: readonly { field: string; choices: ReadonlyMap<string, string>; other: string }[] = [
  { field: "negativeNumberNotation", choices: labels(["MINUS_SIGN", ""], ["PARENTHESES", "negatives in brackets"]), other: "negative numbers" },
  { field: "zeroFormat", choices: labels(["ZERO", ""], ["BLANK", "zero as blank"], ["HYPHEN", "zero as hyphen"]), other: "zero format" },
  { field: "groupingSeparator", choices: labels(["COMMA", ""], ["NONE", "no thousand separator"], ["FULL_STOP", "thousand separator dot"], ["SPACE", "thousand separator space"]),
    other: "thousand separator" },
  { field: "decimalSeparator", choices: labels(["FULL_STOP", ""], ["COMMA", "decimal point comma"]), other: "decimal point" },
  { field: "comparisonIncrease", choices: labels(["GOOD", ""], ["BAD", "increase in value is bad"], ["NEUTRAL", "increase in value is neutral"]), other: "increase in value is" },
];

/** What a number says after its data type: how many digits it shows (the dialog's Minimum Significant Digits or its
 * Decimal Places), its units, then its other options. Only what is not at Anaplan's default is said. */
function numberOptions(format: Definition): string[] {
  const digits = count(format.minimumSignificantDigits);
  const places = count(format.decimalPlaces);
  const options = NUMBER_OPTIONS.map(({ field, choices, other }) => {
    const value = word(format[field]);
    return value === undefined ? "" : choices.get(value) ?? `${other} ${value}`;
  });
  return [
    digits === undefined || digits === DEFAULT_SIGNIFICANT_DIGITS ? "" : `minimum ${plural(digits, "significant digit")}`,
    places === undefined ? "" : plural(places, "decimal place"),
    unitsWords(format), ...options,
  ].filter(phrase => phrase !== "");
}

/** A time period's period: the label the format carries, which is what the grid shows (_DataPage.js), or else the label
 * of the period's ID, or that ID as it is. Nothing when the format names no period: the grid then shows the data type. */
function periodWords(format: Definition): string {
  const period = part(format.periodType);
  if (period === undefined) return "";
  const label = word(period.entityLabel);
  if (label !== undefined) return label;
  const id = word(period.entityId);
  if (id === undefined) throw UNREADABLE;
  return PERIOD_TYPE.get(id) ?? id;
}

/** A list's filters, as the dialog offers them after "Filter:" (anaplan/gridlet/_editor/dataTypes/FilteredList.js
 * `buildFormat`; the labels are anaplan/nls/dataType `labelSelectiveAccessFilter`, `labelDependent` and
 * `labelAllowAccessToUnfilteredItems`). None of them is on by default. */
function listFilters(format: Definition): string[] {
  return [
    flag(format.selectiveAccessApplied) === true ? "selective access" : "",
    part(format.entityFormatFilter) === undefined ? "" : "dependent",
    flag(format.showAll) === true ? "unfiltered items allowed" : "",
  ].filter(phrase => phrase !== "");
}

function formatOf(format: Definition, names: CellNames): string {
  const type = word(format.dataType);
  const label = type === undefined ? undefined : DATA_TYPE.get(type);
  // A data type this module does not know has options it does not know either: the cell is left as it is.
  if (label === undefined) throw UNREADABLE;
  switch (type) {
    case "NUMBER":
      return [label, ...numberOptions(format)].join(", ");
    case "TEXT": {
      const textType = word(format.textType);
      const kind = textType === undefined ? "" : TEXT_TYPE.get(textType) ?? textType;
      return kind === "" ? label : `${label}: ${kind}`;
    }
    case "TIME_ENTITY": {
      const period = periodWords(format);
      return period === "" ? label : `${label}: ${period}`;
    }
    case "ENTITY": {
      const id = idOf(format.hierarchyEntityLongId);
      const filters = listFilters(format);
      const list = id === undefined ? label : `${label}: ${listNameOf(id, names) ?? `ID ${id}`}`;
      return filters.length ? `${list}, filter: ${filters.join(", ")}` : list;
    }
    default:
      // Boolean, Date and No Data have nothing to choose (DataType.js `_buildFormat`).
      return label;
  }
}

/* ---------- Summary ---------- */

/** The summary methods and the time summary methods by their labels (anaplan/nls/common `labelSummaryMethod…`). Which of
 * them a line item may have depends on its data type (anaplan/gridlet/_editor/Summary.js `_summaryOptionsMap` and
 * `_timeSummaryOptionsMap`): Opening Balance and Closing Balance are time summaries only. A method not listed there is
 * said by the value the cell holds. */
const SUMMARY_METHOD = labels(["SUM", "Sum"], ["NONE", "None"], ["FORMULA", "Formula"], ["AVERAGE", "Average"], ["RATIO", "Ratio"], ["MIN", "Min"], ["MAX", "Max"],
  ["OPENING_BALANCE", "Opening Balance"], ["CLOSING_BALANCE", "Closing Balance"], ["FIRST_NON_BLANK", "First non-blank"], ["LAST_NON_BLANK", "Last non-blank"],
  ["ANY", "Any"], ["ALL", "All"]);
const RATIO = "RATIO";

/** A Ratio as the Summary dialog writes it, "Ratio = " then the numerator, "/" and the denominator (anaplan/nls/summary
 * `labelRatio`, and the template Summary.html), each by the name the caller gave or else by its ID. Without both, the
 * method's label alone, as the grid shows it. */
function ratioWords(summary: Definition, names: CellNames): string {
  const operand = (name: unknown, identifier: unknown): string | undefined => {
    const said = given(name);
    if (said !== undefined) return said;
    const id = idOf(identifier);
    return id === undefined ? undefined : `ID ${id}`;
  };
  const numerator = operand(names.ratioNumerator, summary.ratioNumeratorIdentifier);
  const denominator = operand(names.ratioDenominator, summary.ratioDenominatorIdentifier);
  return numerator === undefined || denominator === undefined ? "Ratio" : `Ratio = ${numerator} / ${denominator}`;
}

/** The grid's own words (_DataPage.js): the summary method, and ", Time: " with the time summary unless the summary says
 * that the two are the same (`timeSummarySameAsMainSummary`, the dialog's "Same as main summary"; "Time" is anaplan/nls/common
 * `labelTime`). A time summary chosen by name is said even when it is the same method, as the grid says it. A summary that
 * does not say whether they are the same says its time summary when the method differs. A Ratio's operands are said once. */
function summaryOf(summary: Definition, names: CellNames): string {
  const main = word(summary.summaryMethod);
  if (main === undefined) throw UNREADABLE;
  const time = word(summary.timeSummaryMethod);
  const same = flag(summary.timeSummarySameAsMainSummary);
  const say = (method: string, operands: boolean): string => (method === RATIO && operands ? ratioWords(summary, names) : SUMMARY_METHOD.get(method) ?? method);
  if (same ?? (time === undefined || time === main)) return say(main, true);
  if (time === undefined) throw UNREADABLE;
  return `${say(main, true)}, Time: ${say(time, main !== RATIO)}`;
}

/* ---------- Action ---------- */

/** The kinds of action the Actions list holds as a definition (anaplan/constants.js `ACTION_TYPE_…`) by their labels
 * (anaplan/nls/actionEditor). The grid puts the list's name where two of the labels say "List" (OtherAction.js). */
const ACTION_TYPE = labels(["PROCESS", "Process"], ["BULK_COPY", "Bulk Copy"], ["DELETE_BY_SELECTION", "Delete from List using Selection"],
  ["ORDER_HIERARCHY", "Order List"], ["UPDATE_CURRENT_PERIOD", "Update Current Period"], ["TASK_ELEMENT", "Task Element"]);
const NAMES_A_LIST = new Set(["DELETE_BY_SELECTION", "ORDER_HIERARCHY"]);

/** What a task element does (anaplan/constants.js `taskElementOperation`) by its label (anaplan/nls/actionEditor). */
const OPERATION = labels(["SIMPLE_CREATE", "Create"], ["SYNCHRONISE_HIERARCHY", "Synchronise Hierarchy"],
  ["SET_PROPERTY_AND_SYNCHRONISE_HIERARCHY", "Set Property and Synchronise Hierarchy"], ["COPY_TO_NUMBERED_LIST", "Assign Only"], ["DEFINE_ENTITIES", "Define Entities"],
  ["SELECT_CHILDREN", "Assign"], ["BULK_ENTITY_COPY", "Copy Branch"], ["BULK_DELETE_ENTITIES", "Delete Branch"], ["OPTIMIZER", "Optimizer"]);
const OPEN_DASHBOARD = "Open Dashboard";

/** A task element's words, in the order OtherAction.js `getDisplayValue` decides them: the Optimizer, then a bulk
 * operation by what it does (an operation not listed is said by its value, as the grid says it), then Open Dashboard
 * (anaplan/nls/actionEditor `DASHBOARD`), and for any other the label of the action's kind. The action holds its task
 * element as JSON in text (anaplan/settings/Actions/Toolbar.js). */
function taskWords(taskElement: unknown, label: string): string {
  const task = part(typeof taskElement === "string" ? definitionOf(taskElement) : taskElement);
  if (task === undefined) throw UNREADABLE;
  const kind = word(task.taskElementType);
  const operation = word(task.operation);
  if (operation === "OPTIMIZER") return OPERATION.get(operation) ?? operation;
  if (kind === "BULK_OPERATION") {
    if (operation === undefined) throw UNREADABLE;
    return OPERATION.get(operation) ?? operation;
  }
  return kind === "DASHBOARD" ? OPEN_DASHBOARD : label;
}

/** What the Actions grid shows for an action (OtherAction.js `getDisplayValue`), without its check that the list, the
 * line item or the dashboard still exists: that needs the model. */
function actionOf(action: Definition, names: CellNames): string {
  const type = word(action.actionType);
  const label = type === undefined ? undefined : ACTION_TYPE.get(type);
  // An action of a kind this module does not know (an export's definition, say) is left as it is.
  if (type === undefined || label === undefined) throw UNREADABLE;
  if (type === "TASK_ELEMENT") return taskWords(action.taskElement, label);
  if (!NAMES_A_LIST.has(type)) return label;
  const id = idOf(action.hierarchyIdentifier);
  if (id === undefined) return label;
  const list = listNameOf(id, names) ?? `list ID ${id}`;
  // A function, so that a name is put in as it is whatever it holds ("$&" means something to `replace` in text).
  return label.replace("List", () => list);
}

/* ---------- Mapped To ---------- */

/** What a source model is mapped to, as the page says it: the workspace and the model, each by its name, or by its ID where
 * the cell gives no name for it, and empty where the cell gives neither. */
export interface MappingWords { workspace: string; model: string }

/** One of the two a mapping names: by its name where the cell gives one that says something, or else by its ID, said as
 * an ID as a list is said by its ID above. Nothing when the cell gives neither: a name is never made up. */
function mappedOne(name: unknown, id: unknown): string | undefined {
  const named = given(name);
  if (named !== undefined) return named;
  const identified = given(id);
  return identified === undefined ? undefined : `ID ${identified}`;
}

/** A source model's Mapped To cell, of the Source Models grid, in words. Anaplan's own export of the grid writes the cell as
 * an object that names the workspace and the model the source model is mapped to, each by its ID and by its name:
 * `{"workspaceId":"dc56f2296af444ca894c1bca437ae1b4","workspaceName":"…","modelId":"42FAAB38…","modelName":"…"}`. No
 * client source settles these four keys: they are the ones a real model's cell holds. Each of the two is said by its
 * name, or else by its ID ("ID dc56f2296af444ca894c1bca437ae1b4"), and a name that is missing, blank or not text is never
 * guessed. Undefined for a cell that is no such object, and for an object that names neither the workspace nor the model
 * either way: the caller then shows the cell as it is. */
export function mappingWords(text: unknown): MappingWords | undefined {
  try {
    const mapping = definitionOf(text);
    if (mapping === undefined) return undefined;
    const workspace = mappedOne(mapping.workspaceName, mapping.workspaceId);
    const model = mappedOne(mapping.modelName, mapping.modelId);
    return workspace === undefined && model === undefined ? undefined : { workspace: workspace ?? "", model: model ?? "" };
  } catch {
    return undefined;
  }
}

/* ---------- for the caller ---------- */

/** The words for one cell: undefined when the text is not a definition, or not one `say` can read. */
function words(text: unknown, names: CellNames | undefined, say: (definition: Definition, names: CellNames) => string): string | undefined {
  try {
    const definition = definitionOf(text);
    return definition === undefined ? undefined : say(definition, names ?? {});
  } catch {
    return undefined;
  }
}

/** A Format cell in words: "Number", "Number, 2 decimal places, %", "Text: Link", "Time Period: Month", "List: Products",
 * or "List: ID 101000000007" when the caller has no name for the list. */
export function formatWords(text: unknown, names?: CellNames): string | undefined {
  return words(text, names, formatOf);
}

/** A Summary cell in words: "Sum", "Sum, Time: Closing Balance", "Ratio = Profit / Revenue", or "Ratio = ID 1901000000011 /
 * ID 1901000000012" when the caller has no names for the line items. */
export function summaryWords(text: unknown, names?: CellNames): string | undefined {
  return words(text, names, summaryOf);
}

/** An Action cell of the Actions list in words: "Create", "Open Dashboard", "Delete from Products using Selection". */
export function actionWords(text: unknown, names?: CellNames): string | undefined {
  return words(text, names, actionOf);
}

/** The headers of the columns this module can say in words, as the model's grids name them: a line item's Format and its
 * Summary, and the Action of the Actions list, which holds a definition for the actions under Other Actions. */
export const READABLE_HEADERS = ["Format", "Summary", "Action"] as const;
export type ReadableHeader = (typeof READABLE_HEADERS)[number];

const READERS: Record<ReadableHeader, (text: unknown, names?: CellNames) => string | undefined> = { Format: formatWords, Summary: summaryWords, Action: actionWords };

/** A cell in words, by its column's header: undefined when the column is not one of `READABLE_HEADERS`, or when the cell
 * is not a definition this module reads. The caller then shows the cell's own text. */
export function readableCell(header: unknown, text: unknown, names?: CellNames): string | undefined {
  const known = READABLE_HEADERS.find(candidate => candidate === header);
  return known === undefined ? undefined : READERS[known](text, names);
}
