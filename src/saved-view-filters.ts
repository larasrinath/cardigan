import type { AxisFilter, ViewCondition } from "./result-types.js";

/** A model's saved views that have a filter, and the words their filters are said in. The export reads each saved view's
 * definition in the model's frame (model/saved-views.ts), and the results page shows the views as the Saved View Filters
 * table, under App Usage's Page Filters, with each row's filters in its details. Both say a filter in the same words, which
 * are these: what this module says is all the two share, so it reads no result, no page and no model.
 *
 * The words are Anaplan's own, as its filter dialog shows them (anaplan/view/FilterV2/Tab.js and Condition.js, which take
 * them from anaplan/nls/filter): "Show items that match all of the following" or "any", and each operator by its label
 * there (`option<OPERATOR>`, which Condition.js `_createOperatorOptions` reads). The dialog writes the three operators of
 * text with a capital (Contains, Starts with, Ends with) and the others without: in a sentence all are written without. The
 * table's Filters cell is short: it writes a comparison by its sign, and says only Match any, Match all being what a filter
 * does where it says nothing. */

export const SAVED_VIEW_FILTERS = "Saved View Filters";
export const SAVED_VIEW_FILTERS_FILE = `${SAVED_VIEW_FILTERS}.csv`;
/** The table's columns, in their order. Used on Pages is filled once the pages built on the model are read (model-pages.ts). */
export const SAVED_VIEW_FILTER_HEADERS = ["Name", "Module", "Filters", "Filter Line Items", "Used on Pages", "Used by Imports", "Used by Exports", "Definition read"] as const;
/** The column of Line Items that counts the saved views whose filters use each line item, on or off. */
export const VIEW_FILTER_USES = SAVED_VIEW_FILTERS;
/** What Definition read says of a view whose definition was read, and of one whose definition was not. */
export const READ_WORDS = { yes: "Yes", no: "No" } as const;

/** Each operator as the dialog labels it, in a sentence's case. An operator not listed is said by Anaplan's word for it. */
export const OPERATOR_WORDS: ReadonlyMap<string, string> = new Map([
  ["EQUALS", "is equal to"], ["NOT_EQUALS", "is not equal to"], ["LESS_THAN", "is less than"], ["LESS_THAN_OR_EQUAL_TO", "is less than or equal to"],
  ["GREATER_THAN", "is greater than"], ["GREATER_THAN_OR_EQUAL_TO", "is greater than or equal to"], ["IS_BLANK", "is blank"], ["IS_NOT_BLANK", "is not blank"],
  ["CONTAINS", "contains"], ["STARTS_WITH", "starts with"], ["ENDS_WITH", "ends with"], ["BETWEEN_OR_EQUAL_TO", "between"],
]);
/** The comparisons by their signs, as the Filters cell writes them. The others are written in the dialog's words. */
const OPERATOR_SIGNS: ReadonlyMap<string, string> = new Map([["EQUALS", "="], ["NOT_EQUALS", "≠"], ["LESS_THAN", "<"], ["LESS_THAN_OR_EQUAL_TO", "≤"],
  ["GREATER_THAN", ">"], ["GREATER_THAN_OR_EQUAL_TO", "≥"]]);
/** Show items that match all, or any, of the conditions: Tab.js `optionAll`, `optionAny`. */
export const MATCH_WORDS = { all: "Match all", any: "Match any" } as const;
/** Where a condition is not valid, as Anaplan marks it (a condition info's `isValid`): in the Filters cell, and in the details. */
export const NOT_VALID = { cell: "(not valid)", details: "Not valid" } as const;

/** A condition's values, as its Filters cell and its details say them: a text in double quotes, so that spaces and an empty
 * text show; any other value as the export read it, a list's item or a period by its label. Values compared with OR, as
 * a list's items are, are joined with "or"; the two ends of a range with "and" (the dialog's `arityTwoEditorSeparator`). */
export function valuesText(condition: Pick<ViewCondition, "operator" | "dataType" | "values">): string {
  const values = condition.values.map(value => (condition.dataType === "TEXT" ? `"${value}"` : value));
  return values.join(condition.operator === "BETWEEN_OR_EQUAL_TO" ? " and " : " or ");
}

/** An axis's name, with what the Filters cell says beside it in brackets: a page axis's dimension, and that the filter is
 * off. "Rows", "Columns (off)", "Pages (Version)", "Pages (Version, off)". */
export function axisLabel(filter: Pick<AxisFilter, "axis" | "dimension" | "active">): string {
  const said = [...(filter.dimension ? [filter.dimension] : []), ...(filter.active ? [] : ["off"])];
  return said.length ? `${filter.axis} (${said.join(", ")})` : filter.axis;
}

/** One condition as the Filters cell says it: its line item, with its context items in brackets where it has some, the
 * comparison's sign or words, and its values; "(not valid)" after one Anaplan marks not valid. */
export function conditionSummary(condition: ViewCondition): string {
  const operator = OPERATOR_SIGNS.get(condition.operator) ?? OPERATOR_WORDS.get(condition.operator) ?? condition.operator;
  const values = valuesText(condition);
  const contexts = condition.contexts.length ? ` (${condition.contexts.join(", ")})` : "";
  return `${condition.lineItem}${contexts} ${operator}${values === "" ? "" : ` ${values}`}${condition.valid ? "" : ` ${NOT_VALID.cell}`}`;
}

/** One axis's filter as the Filters cell says it: "Rows: Active? = True", "Rows (off): Match any: A > 0, B = True". */
export function axisSummary(filter: AxisFilter): string {
  return `${axisLabel(filter)}: ${filter.match === "any" ? `${MATCH_WORDS.any}: ` : ""}${filter.conditions.map(conditionSummary).join(", ")}`;
}

/** A view's filters as its Filters cell says them, an axis after another with a semicolon between them; empty for none. */
export const filtersSummary = (filters: readonly AxisFilter[]): string => filters.map(axisSummary).join("; ");

/** The heading of one axis's filter in a row's details: "Rows · Match all", with "· off" where the filter is not on. */
export function axisHeading(filter: AxisFilter): string {
  return `${filter.axis}${filter.dimension ? ` (${filter.dimension})` : ""} · ${MATCH_WORDS[filter.match]}${filter.active ? "" : " · off"}`;
}

/** What a condition says after its line item, in the dialog's words: "is equal to True", "is blank". */
export function conditionWords(condition: ViewCondition): string {
  const values = valuesText(condition);
  return `${OPERATOR_WORDS.get(condition.operator) ?? condition.operator}${values === "" ? "" : ` ${values}`}`;
}

/** A name as a cell that lists line items writes it, behind its module and a dot: in single quotes, with a quote of its own
 * doubled, where it holds a dot, a comma, a bar or a quote, has white space at an end, or is empty; as it is otherwise. */
export const listedName = (name: string): string => (/[.,|']/.test(name) || name !== name.trim() || name === "" ? `'${name.replaceAll("'", "''")}'` : name);

/** A line item as Filter Line Items lists it: behind its module's name and a dot, or alone where its module is not known. */
export const lineItemListed = (lineItem: string, module: string | undefined): string => (module === undefined ? listedName(lineItem) : `${listedName(module)}.${listedName(lineItem)}`);
