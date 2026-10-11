import { nameDetails } from "./analyse.js";
import { entityKey, type UxPageCardDetails } from "./card-reader/card-types.js";
import { NOT_IN_MODEL, resolveFromCatalog, unresolvedFilterItems, type ModelCatalog } from "./catalog.js";
import { MISSING_LINE_ITEMS_MODULE, missingIn, missingText, type MissingKind } from "./page-files.js";
import { HEADERS, NAME_NOT_FOUND, NONE, type Cell, type Report } from "./report.js";

/** What a card on a page built on a model points at that the model does not have, deleted since the page was built or
 * hidden from whoever read it, as the model's tables of those pages say it (model-pages.ts): plainly, with its ID
 * (page-files.ts `missingText`). Only what the model's names prove is said so:
 * - a module that the model's list of modules does not hold, and a line item of such a module or one that its module's
 *   line items do not list, which the catalog names "(not in the model)" (catalog.ts `resolveFromCatalog`);
 * - a filter rule's line item, where the rule has no line item the model names and one item alone that nothing names,
 *   once the line items of every module of the model were read: a rule has one line item, so that item is it, and no
 *   module of the model has it;
 * - an import, an export or a process that a button runs, where the model's actions of its type were read and do not list
 *   it (report.ts `NAME_NOT_FOUND`).
 * A dimension or a list that nothing names keeps its ID: no read says that the model does not have it. An app's tables keep
 * their own words. */

/** Whether the line items of every module the model named were read, as the export's are (model-pages.ts
 * `exportedLineItems`): a line item that none of them lists is then in no module of the model. */
const everyLineItemRead = (catalog: ModelCatalog): boolean =>
  catalog.moduleListLoaded && catalog.modules.size > 0 && [...catalog.modules.keys()].every(id => catalog.lineItemModules.has(id));

/** A page's cards named as analyse.ts `nameDetails` names them, with what the model does not have named plainly. */
export function namePlainly(details: UxPageCardDetails, catalog: ModelCatalog): UxPageCardDetails {
  const resolved = resolveFromCatalog(details.references, catalog);
  for (const { kind, id } of resolved.unresolved) {
    const key = entityKey({ kind, id });
    if (resolved.names[key] === `${id} (${NOT_IN_MODEL})`) resolved.names[key] = missingText(kind === "module" ? "module" : "line item", id);
  }
  // The rule's one unnamed item is its line item: named so, it is the rule's line item, and the rest is its context.
  if (everyLineItemRead(catalog)) {
    for (const [id, ...more] of unresolvedFilterItems(details.cards, catalog).rules) {
      if (more.length) continue;
      const key = entityKey({ kind: "unknown", id });
      resolved.names[key] = missingText("line item", id);
      resolved.kinds[key] = "lineItem";
    }
  }
  return nameDetails(details, catalog, resolved);
}

/** The model's action types that a button can run, by the words Action type has for them (report.ts). */
const ACTION_KINDS: ReadonlyMap<string, MissingKind> = new Map([["Import", "import"], ["Export", "export"], ["Process", "process"]]);

/** The report of a page whose cards were named plainly (`namePlainly`), with the rest said plainly too: a filter whose
 * condition line item is missing says that its module is not known, and a button whose import, export or process the
 * model does not have names it, by its type and ID. Its rows are changed in place. */
export function sayMissing(report: Report): Report {
  const filters = HEADERS.Filters;
  const [lineItemAt, moduleAt] = [filters.indexOf("Condition line item"), filters.indexOf("Condition line item's module")];
  for (const row of report.Filters.rows) {
    if (String(row[moduleAt]) === NONE && missingIn(String(row[lineItemAt])).some(({ kind }) => kind === "line item")) row[moduleAt] = MISSING_LINE_ITEMS_MODULE;
  }
  const actions = HEADERS.Actions;
  const [nameAt, typeAt, sourceAt, idAt] = ["Model action name", "Action type", "Name source", "Action ID"].map(header => actions.indexOf(header));
  for (const row of report.Actions.rows) {
    const kind = ACTION_KINDS.get(String(row[typeAt]));
    const id = String(row[idAt]);
    if (kind && row[sourceAt] === NAME_NOT_FOUND && String(row[nameAt]) === NONE && /^\d+$/.test(id)) row[nameAt] = missingText(kind, id);
  }
  return report;
}

/** The cards, of `ours`, that point at something the model does not have, as the model's tables of the pages show it: a
 * module that Module Usage names Missing (a card's module, its saved view's or a line item's), a filter of Page Filters or a
 * button of Page Actions that names something Missing. Each by its ID, with what it points at that is missing, by the
 * words the tables have for it. */
export function missingCards(report: Report, ours: ReadonlySet<string>): Map<string, Set<string>> {
  const cards = new Map<string, Set<string>>();
  const add = (card: string, cells: readonly Cell[]): void => {
    if (!ours.has(card)) return;
    for (const { kind, id } of cells.flatMap(cell => missingIn(String(cell)))) {
      const things = cards.get(card) ?? new Set<string>();
      cards.set(card, things.add(missingText(kind, id)));
    }
  };
  // A use names its card by its number: the Cards rows say which card has which.
  const [numberAt, idAt] = [HEADERS.Cards.indexOf("Card #"), HEADERS.Cards.indexOf("Card ID")];
  const cardOf = new Map(report.Cards.rows.map(row => [String(row[numberAt]), String(row[idAt])]));
  const used = HEADERS["Where used"];
  const [typeAt, nameAt, moduleAt, cardAt] = [used.indexOf("Object type"), used.indexOf("Object name"), used.indexOf("Object's module"), used.indexOf("Card #")];
  for (const row of report["Where used"].rows) {
    const kind = String(row[typeAt]);
    add(cardOf.get(String(row[cardAt])) ?? "", [kind === "Module" ? row[nameAt] : kind === "Saved view" || kind === "Line item" ? row[moduleAt] : NONE]);
  }
  for (const [table, cardId] of [["Filters", HEADERS.Filters.indexOf("Card ID")], ["Actions", HEADERS.Actions.indexOf("Card ID")]] as const) {
    for (const row of report[table].rows) add(String(row[cardId]), row);
  }
  return cards;
}

/** The note on the cards of the pages that point at something the model does not have (`missingCards`, one map a page):
 * how many, each page's counted on its own, and what they point at, all pages together. None where no card does. */
export function missingNote(pages: readonly ReadonlyMap<string, ReadonlySet<string>>[]): string | undefined {
  const cards = pages.reduce((count, page) => count + page.size, 0);
  if (!cards) return undefined;
  const things = new Set(pages.flatMap(page => [...page.values()].flatMap(each => [...each]))).size;
  const onOne = pages.filter(page => page.size).length === 1;
  return `${cards === 1 ? "1 card on a page" : `${cards} cards on pages`} built on this model ${cards === 1 ? "points" : "point"} at ${things === 1 ? "something" : "things"} `
    + `the model doesn't have: deleted since ${onOne ? "the page was" : "the pages were"} built, or hidden from you. Module Usage, Page Filters and Page Actions `
    + "say Missing, with the ID.";
}
