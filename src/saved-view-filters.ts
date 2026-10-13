import { MISSING_LINE_ITEMS_MODULE, missingIn } from "./page-files.js";
import type { AxisFilter, Cell, SavedViewDetail, ViewCondition } from "./result-types.js";

/** A model's saved views, and the words their filters are said in. The export reads each saved view's definition in the
 * model's frame (model/saved-views.ts), and the results page shows every view as the Saved Views table, under Modules, with
 * each row's filters in its details. The filters of the views that cards on the pages built on the model show are the Saved
 * View Filters table, under App Usage's Page Filters, which the run makes once those pages are read (model-pages.ts), laid
 * out as Custom View Filters is. All of them say a filter in the same words, which are these: what this module says is all
 * they share, so it reads no result, no page and no model.
 *
 * The words are Anaplan's own, as its filter dialog shows them (anaplan/view/FilterV2/Tab.js and Condition.js, which take
 * them from anaplan/nls/filter): "Show items that match all of the following" or "any", and each operator by its label
 * there (`option<OPERATOR>`, which Condition.js `_createOperatorOptions` reads). The dialog writes the three operators of
 * text with a capital (Contains, Starts with, Ends with) and the others without: in a sentence all are written without. The
 * Saved Views table's Filters cell is short: it writes a comparison by its sign, and says only Match any, Match all being
 * what a filter does where it says nothing. */

/** Every saved view of the model, with a filter or not, and each whose definition was not read. */
export const SAVED_VIEWS = "Saved Views";
export const SAVED_VIEWS_FILE = `${SAVED_VIEWS}.csv`;
/** The Saved Views table's columns, in their order. Used on Pages is filled once the pages built on the model are read
 * (model-pages.ts). 0.43.0 and 0.44.0 wrote the table under Saved View Filters' name, with these columns
 * (results/saved-view-filters-view.ts `withSavedViews`). */
export const SAVED_VIEW_HEADERS = ["Name", "Module", "Filters", "Filter Line Items", "Used on Pages", "Used by Imports", "Used by Exports", "Definition read"] as const;

/** The filters of the saved views that the pages built on the model show, one row for each card and condition. */
export const SAVED_VIEW_FILTERS = "Saved View Filters";
export const SAVED_VIEW_FILTERS_FILE = `${SAVED_VIEW_FILTERS}.csv`;
/** The Saved View Filters table's columns: Custom View Filters' (model-pages.ts `PAGE_FILTERS_HEADERS`) in their order, with
 * the saved view after the module it filters, and last what no column of Custom View Filters says, whether the filter is off
 * and the condition not valid (`filterState`). */
export const SAVED_VIEW_FILTER_HEADERS = ["Condition line item's module", "Condition line item", "Filtered module", "Saved view", "Filtered dimension",
  "Filtered line items", "Operator", "Value", "Show items that match", "Condition group", "Condition context", "Filter on", "App", "Page", "Card #", "Section #",
  "Page type", "App ID", "Page ID", "Card ID", "Line item ID", "Filter state"] as const;
/** The order of Saved View Filters' rows, Custom View Filters' own (results/result-view.ts `PAGE_ROW_ORDER`): by these
 * columns in turn, and where they are one, in the order the rows were made, each card's in its view's filter's order. The
 * run writes them so (model-pages.ts), and the page shows them so. */
export const SAVED_VIEW_FILTER_ORDER = ["Condition line item's module", "Condition line item", "App", "Page", "Card #"] as const;

/** The column of Line Items that counts the saved views whose filters use each line item, on or off, whether a page shows the
 * view or not. */
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
/** The same, as Custom View Filters' Show items that match says it: Page Builder's All or Any (report.ts `conditions`). */
export const MATCH_SHOWN = { all: "All", any: "Any" } as const;
/** Where a condition is not valid, as Anaplan marks it (a condition info's `isValid`): in the Filters cell, and in the details. */
export const NOT_VALID = { cell: "(not valid)", details: "Not valid" } as const;
/** Where a filter is not on, as its axis in the Filters cell and its heading in the details say it. */
export const OFF = "off";

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
  const said = [...(filter.dimension ? [filter.dimension] : []), ...(filter.active ? [] : [OFF])];
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
  return `${filter.axis}${filter.dimension ? ` (${filter.dimension})` : ""} · ${MATCH_WORDS[filter.match]}${filter.active ? "" : ` · ${OFF}`}`;
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

/** What Filter state of Saved View Filters says of a condition: that its filter is off, and that it is not valid, in the
 * words a row's details say them (`axisHeading`, `NOT_VALID`), with " · " between them as the details write them, and a
 * capital first. Nothing where the filter is on and the condition valid. */
export function filterState(filter: Pick<AxisFilter, "active">, condition: Pick<ViewCondition, "valid">): string {
  const said = [...(filter.active ? [] : [OFF]), ...(condition.valid ? [] : [NOT_VALID.details])].join(" · ");
  return said.charAt(0).toUpperCase() + said.slice(1);
}

/** A card on a page built on the model that shows a saved view, as Custom View Filters says a filter's card: its app and its
 * page, its number and the number of its section where the page's own tables give one, where its page is (page-files.ts
 * `PAGE_PLACE_HEADERS`: its type, its app's ID and its own), and its ID. */
export interface ViewCard { app: string; page: string; number: Cell; section: Cell; place: readonly Cell[]; cardId: string }

/** The rows of Saved View Filters that a card showing a saved view gives: one for each condition of each of the view's
 * filters, Rows, Columns, then each page axis, each condition in its order, in the columns `SAVED_VIEW_FILTER_HEADERS`
 * names. Each column says what it says in Custom View Filters:
 * - the condition's line item and its module, as Line Items names them; a module not known is empty, and a line item the
 *   model does not have is Missing, with its ID, its module "Missing line item: module not known", as there;
 * - the view's module, then the view;
 * - the filtered axis's dimensions, by the names the model's client gives them, with a comma and a space between them, as
 *   Custom View Filters writes its; empty where the client names none, as Filter on says the axis;
 * - the comparison and its values in the dialog's words (`OPERATOR_WORDS`, `valuesText`), All or Any, and the context items;
 * - where the card is, and the condition line item's ID, where the definition gave it;
 * - last, whether the filter is off or the condition not valid (`filterState`).
 * Filtered line items and Condition group are empty: the definition says no more of the line items the view shows than the
 * export reads, and a saved view's filter has no groups. A view with no filter gives none. */
export function viewFilterRows(view: Pick<SavedViewDetail, "name" | "module" | "filters">, card: ViewCard): Cell[][] {
  return view.filters.flatMap(filter => filter.conditions.map((condition): Cell[] => {
    const module = condition.lineItemModule ?? (missingIn(condition.lineItem).some(each => each.kind === "line item") ? MISSING_LINE_ITEMS_MODULE : "");
    return [module, condition.lineItem, view.module, view.name, (filter.dimensions ?? []).join(", "), "", OPERATOR_WORDS.get(condition.operator) ?? condition.operator,
      valuesText(condition), MATCH_SHOWN[filter.match], "", condition.contexts.join("; "), filter.axis, card.app, card.page, card.number, card.section, ...card.place,
      card.cardId, condition.lineItemId ?? "", filterState(filter, condition)];
  }));
}
