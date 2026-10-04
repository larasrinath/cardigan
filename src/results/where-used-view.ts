import type { AnalysisResult, Cell, ResultTable } from "../result-types.js";
import { APP_FILES, columnIndex, columnsOf, type Column } from "./columns.js";
import { cellText, compareText, NONE, type Row } from "./table-engine.js";

/** An app's Where used file, turned round. The file has one row per use, in page and card order: an object, the card that
 * uses it and what the card uses it as. That answers "what does this card use?", and it is what the CSV holds: the file is
 * read here and never changed. The view answers "where is this object used?": one row per object, which says on how many
 * pages and cards it is used and as what, with its uses listed under it. Plain data in, plain data out: every cell is a
 * text or a number, and the page escapes it as it does any other.
 *
 * An object is its type and its ID. An ID is unique inside one model only and the file names no model, so in an app of
 * several models the Pages file says which model the page of each use reads: the same ID in two models is two objects.
 * Nothing is guessed. A use on a page whose model the Pages file does not settle goes to an object without a model, and an
 * object without an ID is its type, its name and its module.
 *
 * The file has only the name of a use's page. Where more than one page has a name (the Pages file lists each with its
 * own ID), the uses on that name cannot be told apart, and a count of pages or cards may be open. A count is then the
 * least it can be, and it says so: its cell reads "41+", the object carries the most it can be and a note, each such use
 * says how many pages have its page's name, and the view's note says which names are shared. No count is given as exact
 * unless it is. Where no two pages share a name, none of this is there and every count is a plain number.
 *
 * How many pages have a name is said as the Pages file lists them, every page of the name. A page that the file says has
 * no cards uses nothing: it counts among the pages of its name, and not among those a use can be on. */

/** The file the view is made of. */
export const WHERE_USED_FILE = APP_FILES["Where used"];

/** The view's columns. Pages and Cards are numbers, so they sort as numbers. A count that the file leaves open is the
 * least it can be, as text with a plus sign after it ("41+"): the page's sort puts it by its number, straight after the
 * same number without the sign. Model is a column only in an app of several models. With one model it would hold the same
 * name in every row, and the page's search, which looks in every cell, shown or hidden, would then keep every row for any
 * word of that name: for "21", in a model called "Plan 2021". */
export const BY_OBJECT_HEADERS: readonly string[] = ["Object type", "Object name", "Object's module", "Model", "Pages", "Cards", "Used as", "Object ID"];
const MODEL = "Model";

/** What is not a plain text column, by header (columns.ts `Column`): the type is a tag with a filter, the two counts are
 * numbers, and the ID is one to copy, hidden until chosen, as in the file's own table. */
const SHOWN: ReadonlyMap<string, Partial<Column>> = new Map<string, Partial<Column>>([
  ["Object type", { kind: "tag", filter: true }], ["Pages", { num: true }], ["Cards", { num: true }], ["Object ID", { kind: "id", hidden: true }]]);

/** The object types report.ts writes, in the order of the index: what a model is made of, then what a card runs (the
 * model's own actions first), then the pages a card links to. Any other type follows these, by its name. */
export const TYPE_ORDER: readonly string[] = [
  "Module", "Line item", "Dimension", "Saved view",
  "Import", "Export", "Process", "Bulk copy", "Assign", "Copy branch", "Integration", "Forecaster", "Workflow template", "Notification", "Form", "Writeback",
  "Navigation", "Data Orchestrator extract", "Data Orchestrator link",
  "Page",
];

/** The type of a page that a card links to. A page is the app's, not a model's: its ID is its own whichever model the
 * linking card's page reads, so a page is one object, and its model is the one it reads itself. */
const PAGE = "Page";

/** The columns the view reads, by the names report.ts `HEADERS` gives them. Without the Where used file, the Pages file or
 * one of these columns of theirs there is no view. The Cards file only adds each use's card ID. */
const USE_HEADERS = { type: "Object type", name: "Object name", module: "Object's module", page: "Page", card: "Card #", usedAs: "Used as", id: "Object ID" };
const PAGE_HEADERS = { page: "Page", model: "Model", modelId: "Model ID" };
const CARD_HEADERS = { page: "Page", card: "Card #", id: "Card ID" };

/** What separates the roles in a Used as cell: the first of these that no role in the file holds, so that the cell reads
 * one way only. (The first of them, should the file's roles hold all three.) */
const SEPARATORS = ["; ", " | ", " / "];

/** One use: a row of the file. */
export interface WhereUsedUse {
  /** The row's place in the file's rows, from 0. */
  row: number;
  /** The page the card is on: the Page cell's text. */
  page: string;
  /** The Card # cell as it stands: the card's number on its page. */
  card: Cell;
  /** What the card uses the object as: the Used as cell's text. */
  usedAs: string;
  /** The card's ID. The page opens a card by its page's name and its ID, so the ID is there only when both lead to this
   * one card: exactly one row of the Cards file is a card of that number on a page of that name, and no other row of
   * that page name has its ID. With two cards of the number the file does not say which of them it is, also when they
   * have one ID. */
  cardId?: string;
  /** How many pages have this page's name, as the Pages file lists them: every page of the name, with cards or without.
   * It is there when the file cannot say which page the use is on, because more than one of them can have uses. */
  pagesOfName?: number;
}

/** One object, as its row of the view shows it, with its uses. */
export interface WhereUsedObject {
  type: string;
  /** The name and the module most of its uses give: an action that the model does not name goes by each button's label. */
  name: string;
  module: string;
  /** The model it is in, as the Model column names it; the dash when that is not known. It is given in an app of one
   * model too, where the view has no Model column. */
  model: string;
  /** How many different pages use it, and how many different cards: a card is a page and a card number. Each is exact,
   * unless `pagesMost` or `cardsMost` is there: then it is the least it can be. */
  pages: number;
  cards: number;
  /** The most pages and cards it can be on, where its uses on a page name that more than one page has leave that open.
   * Not there when the count is exact. */
  pagesMost?: number;
  cardsMost?: number;
  /** For an object with uses on a page name that more than one page has: what that leaves open, in plain words for the
   * drawer to show under the object's name. */
  note?: string;
  /** Each role it is used in, with the number of uses in that role: most uses first, equal ones in the file's order. */
  roles: [role: string, uses: number][];
  /** Its ID; what the file holds for it (nothing, or the dash) when it has none. */
  id: string;
  /** Its uses, in the file's order. */
  uses: WhereUsedUse[];
}

export interface WhereUsedView {
  /** The view's columns: `BY_OBJECT_HEADERS`, without Model in an app of one model. */
  headers: string[];
  /** How the page shows each of them (columns.ts), one for each header. */
  columns: Column[];
  /** One row per object, in the index's order: by type, then by name, then by module. */
  rows: Cell[][];
  /** The objects, in the same order: `objects[i]` is the object of `rows[i]`. */
  objects: WhereUsedObject[];
  /** How many uses the file lists: its rows. Every one of them is under exactly one object. */
  totalUses: number;
  /** Whether the app's pages name more than one model. Only then is the same ID two objects, and only then does the view
   * have its Model column. */
  multiModel: boolean;
  /** In an app of several models, the uses whose page does not say which model they are in, so that the model is left out
   * of what identifies their object: `ambiguousUses` on a page whose name pages of different models share, `unlistedUses`
   * on a page that the Pages file does not list, or lists without a model. Both are 0 in an app of one model. */
  ambiguousUses: number;
  unlistedUses: number;
  /** The page names with uses that cannot be told apart, because more than one page of the name can have uses, in the
   * file's order. Each comes with the number of pages that have the name, as the Pages file lists them: every page of the
   * name, with cards or without. Not there when no use is on such a name. */
  sharedPageNames?: [name: string, pages: number][];
  /** What the page says about the view, as plain text. */
  note: string;
}

/** Whether a text says something: it is neither empty nor the dash the analysis writes where it has nothing to say. */
const says = (text: string): boolean => text.trim() !== "" && text.trim() !== NONE;

/** A cell as the plain value it is. */
const plain = (cell: unknown): Cell => (typeof cell === "string" || typeof cell === "number" ? cell : cellText(cell));

const count = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;

const tally = (counts: Map<string, number>, text: string): void => { counts.set(text, (counts.get(text) ?? 0) + 1); };

/** The order of texts as the page sorts a column (table-engine.ts), and after it one fixed order for texts it holds equal:
 * "Revenue" and "revenue" always come the same way round. */
const byText = (a: string, b: string): number => compareText(a, b) || (a < b ? -1 : a > b ? 1 : 0);

/** The places of the named headers in a table, or undefined when the table lacks one of them. */
function places<K extends string>(table: ResultTable, headers: Record<K, string>): Record<K, number> | undefined {
  const found = {} as Record<K, number>;
  for (const key of Object.keys(headers) as K[]) {
    const index = columnIndex(table, headers[key]);
    if (index === undefined) return undefined;
    found[key] = index;
  }
  return found;
}

/** The text most uses give, among the texts that say something. The one met first when several are given equally often,
 * and when none says anything. */
function mostGiven(counts: ReadonlyMap<string, number>): string {
  let best: string | undefined;
  let most = 0;
  for (const [text, times] of counts) {
    if (says(text) && times > most) {
      best = text;
      most = times;
    }
  }
  return best ?? counts.keys().next().value ?? "";
}

interface Model { name: string; workspace: string; id: string }

interface Models {
  /** The name the Model column shows for each model the app's pages name, by the model's key. */
  labels: Map<string, string>;
  /** A page's name -> the keys of the models that pages of that name read: none for a page that names no model. */
  ofPage: Map<string, Set<string>>;
  /** The same by a page's ID, for a page that a card links to. */
  ofPageId: Map<string, Set<string>>;
}

/** A name for each model: its own, or its ID when it has no name. Models that share a name are told apart by their
 * workspaces when each has one of its own, as App Details.csv lists them, and otherwise by their IDs. */
function modelLabels(models: ReadonlyMap<string, Model>): Map<string, string> {
  const base = (model: Model): string => (says(model.name) ? model.name : model.id);
  const sharing = new Map<string, Model[]>();
  for (const model of models.values()) sharing.set(base(model), [...(sharing.get(base(model)) ?? []), model]);
  const labels = new Map<string, string>();
  for (const [key, model] of models) {
    const named = base(model);
    const alike = sharing.get(named) ?? [];
    const ownWorkspaces = alike.every(other => says(other.workspace)) && new Set(alike.map(other => other.workspace)).size === alike.length;
    const apart = alike.length < 2 ? "" : ownWorkspaces ? model.workspace : says(model.id) && model.id !== named ? model.id : "";
    labels.set(key, apart === "" ? named : `${named} (${apart})`);
  }
  return labels;
}

/** The models of the app's pages, from the Pages file. A model is known by its ID, or by its name and workspace when the
 * file gives no ID for it. */
function modelsOf(pages: ResultTable, at: Record<keyof typeof PAGE_HEADERS, number>): Models {
  const workspaceAt = columnIndex(pages, "Workspace");
  const pageIdAt = columnIndex(pages, "Page ID");
  const models = new Map<string, Model>();
  const ofPage = new Map<string, Set<string>>();
  const ofPageId = new Map<string, Set<string>>();
  const reads = (map: Map<string, Set<string>>, page: string, model: string | undefined): void => {
    const keys = map.get(page) ?? new Set<string>();
    if (model !== undefined) keys.add(model);
    map.set(page, keys);
  };
  for (const row of pages.rows) {
    const name = cellText(row[at.model]);
    const id = cellText(row[at.modelId]);
    const workspace = workspaceAt === undefined ? "" : cellText(row[workspaceAt]);
    const key = says(id) ? JSON.stringify([id]) : says(name) ? JSON.stringify([name, workspace]) : undefined;
    // A page of a model may be listed without the model's name: the first row that has the name gives it.
    if (key !== undefined && !says(models.get(key)?.name ?? "")) models.set(key, { name, workspace, id });
    reads(ofPage, cellText(row[at.page]), key);
    const pageId = pageIdAt === undefined ? "" : cellText(row[pageIdAt]);
    if (says(pageId)) reads(ofPageId, pageId, key);
  }
  return { labels: modelLabels(models), ofPage, ofPageId };
}

/** What the Pages file says of a page name whose uses cannot be told apart. */
interface SharedName {
  /** How many pages have the name, as the Pages file lists them: every page of the name. This is the number said. */
  pages: number;
  /** How many of them a use can be on: the ones the file does not say have no cards. This is the number the counts go by. */
  canUse: number;
}

/** Whether the Pages file says a page has no cards: its Total cards is 0. An empty cell does not say so, nor does a dash
 * or any other text: such a page may have cards. */
const noCards = (cell: unknown): boolean => cellText(cell).trim() === "0";

/** Page name -> what the Pages file says of it, for the names whose uses cannot be told apart: more than one page of the
 * name can have uses. A page is a row of the Pages file, or the rows that give one Page ID. A page without cards uses
 * nothing, so it is not one a use can be on. Only where no page of the name has cards do the file's numbers of cards say
 * nothing of the uses on it, and every page of the name is one a use can be on. */
function sharedNamesOf(pages: ResultTable, pageAt: number): Map<string, SharedName> {
  const idAt = columnIndex(pages, "Page ID");
  const cardsAt = columnIndex(pages, "Total cards");
  const named = new Map<string, { all: Set<string>; mayHaveCards: Set<string> }>();
  pages.rows.forEach((row, index) => {
    const name = cellText(row[pageAt]);
    const id = idAt === undefined ? "" : cellText(row[idAt]);
    const page = JSON.stringify(says(id) ? [id] : index);
    const known = named.get(name) ?? { all: new Set<string>(), mayHaveCards: new Set<string>() };
    known.all.add(page);
    if (cardsAt === undefined || !noCards(row[cardsAt])) known.mayHaveCards.add(page);
    named.set(name, known);
  });
  const shared = new Map<string, SharedName>();
  for (const [name, { all, mayHaveCards }] of named) {
    const canUse = mayHaveCards.size > 0 ? mayHaveCards.size : all.size;
    if (canUse > 1) shared.set(name, { pages: all.size, canUse });
  }
  return shared;
}

/** Page name and card number -> the card's ID, from the Cards file, where the result settles which card that is. Exactly
 * one row of the file is a card of that number on a page of that name: two such rows are two cards, and the file does not
 * say which of them a use is on, also when both have one ID, as the cards of a page and of its copy can. And no other
 * row of that page name has the card's ID: the page opens a card by its page's name and its ID, and takes the first row
 * that has both, which under a name that a page shares with its copy may be a card of another number. */
function cardIdsOf(result: AnalysisResult): (page: string, card: string) => string | undefined {
  const cards = result.tables.find(table => table.file === APP_FILES.Cards);
  const at = cards && places(cards, CARD_HEADERS);
  /** By page name and card number: the ID of the one row that is such a card, or nothing where several rows are. */
  const ids = new Map<string, string | undefined>();
  /** By page name and Card ID: how many rows have both. */
  const rowsOfId = new Map<string, number>();
  if (cards && at) {
    for (const row of cards.rows) {
      const [name, id] = [cellText(row[at.page]), cellText(row[at.id])];
      const key = JSON.stringify([name, cellText(row[at.card])]);
      ids.set(key, ids.has(key) ? undefined : id);
      tally(rowsOfId, JSON.stringify([name, id]));
    }
  }
  return (page, card) => {
    const id = ids.get(JSON.stringify([page, card]));
    return id !== undefined && says(id) && rowsOfId.get(JSON.stringify([page, id])) === 1 ? id : undefined;
  };
}

/** What the uses of one object add up to, while the file is read. */
interface Group {
  type: string;
  /** The key of the model the object is in: only in an app of several models, and only when its uses' page says which. */
  model: string | undefined;
  id: string;
  names: Map<string, number>;
  modules: Map<string, number>;
  pages: Set<string>;
  cards: Set<string>;
  roles: Map<string, number>;
  uses: WhereUsedUse[];
  /** Its uses on page names that more than one page has: by name, then by card number, how often each row comes. */
  shared: Map<string, Map<string, Map<string, number>>>;
}

/** On how many pages and cards an object is used, at least and at most. Each page name is at least one page and each card
 * number on it at least one card. On a name that more than one page has, the uses may be on more of them: on no more pages
 * than can have uses, and on no more pages or cards than there are uses. The same row twice is two cards of that number,
 * on two pages of that name, because the file has one row for an object, a card and a role. Where a row comes more often
 * than pages of the name can have uses, the file does not keep to that, and its repeats say nothing. */
function spreadOf(group: Group, sharedNames: ReadonlyMap<string, SharedName>): { pages: number; pagesMost: number; cards: number; cardsMost: number } {
  const spread = { pages: group.pages.size, pagesMost: group.pages.size, cards: group.cards.size, cardsMost: group.cards.size };
  for (const [name, byCard] of group.shared) {
    const canUse = sharedNames.get(name)?.canUse ?? 1;
    const numbers = [...byCard.values()].map(rows => ({ uses: [...rows.values()].reduce((sum, times) => sum + times, 0), repeats: Math.max(...rows.values()) }));
    const kept = numbers.every(number => number.repeats <= canUse);
    const repeats = numbers.map(number => (kept ? number.repeats : 1));
    spread.pages += Math.max(...repeats) - 1;
    spread.pagesMost += Math.min(canUse, numbers.reduce((sum, number) => sum + number.uses, 0)) - 1;
    numbers.forEach((number, index) => {
      spread.cards += repeats[index] - 1;
      spread.cardsMost += Math.min(canUse, number.uses) - 1;
    });
  }
  return spread;
}

/** Page names as a note lists them, three of them and then how many more. Each with the number of pages that have it, as
 * the Pages file lists them, and with how many of those have no cards where some do not: a use is on one of the others. */
function namesText(names: readonly (readonly [name: string, shared: SharedName])[]): string {
  const said = names.slice(0, 3).map(([name, { pages, canUse }]) => `"${name}" (${pages} pages${pages > canUse ? `, ${pages - canUse} of them without cards` : ""})`);
  return said.join(", ") + (names.length > 3 ? ` and ${names.length - 3} more` : "");
}

/** What an object's drawer says of its uses on page names that more than one page has, and of the counts they leave open. */
function objectNote(uses: number, names: readonly (readonly [name: string, shared: SharedName])[], open: readonly (readonly [least: number, most: number, word: string])[]): string {
  const ranges = open.map(([least, most, word]) => `${least} ${most === least + 1 ? "or" : "to"} ${most} ${word}`);
  return `It has ${count(uses, "use")} on ${names.length === 1 ? "a page name" : "page names"} that more than one page has: ${namesText(names)}. `
    + "The CSV has only the name of a use's page, so which of those pages a use is on is not known."
    + (ranges.length ? ` It is on ${ranges.join(" and on ")}.` : "");
}

/** On how many pages and cards an object is used, in words, for the line under its name: "2 pages, 3 cards", and "at least
 * 41 pages, 84 cards" where the number of its pages is open. */
export function usedOn(object: WhereUsedObject): string {
  const said = (least: number, most: number | undefined, word: string): string => `${most === undefined ? "" : "at least "}${count(least, word)}`;
  return `${said(object.pages, object.pagesMost, "page")}, ${said(object.cards, object.cardsMost, "card")}`;
}

const RANK = new Map(TYPE_ORDER.map((type, index) => [type, index]));
const rank = (type: string): number => RANK.get(type) ?? TYPE_ORDER.length;

/** The index's order: by type (`TYPE_ORDER`, then any other type by its name), then by name as people read names, whatever
 * their case and with "2" before "11", then by module. Objects that are still equal then (the same name in two models,
 * names that differ only in case) keep one order: by the exact name and module, then the model, then the ID. */
function inIndexOrder(a: WhereUsedObject, b: WhereUsedObject): number {
  return rank(a.type) - rank(b.type) || byText(a.type, b.type)
    || compareText(a.name, b.name) || compareText(a.module, b.module)
    || byText(a.name, b.name) || byText(a.module, b.module) || byText(a.model, b.model) || byText(a.id, b.id);
}

/** What the page says about the view: how much it lists, then what the file left open, where it did. */
function noteOf(uses: number, objects: number, modelUnknown: number, shared: readonly (readonly [name: string, shared: SharedName])[], marked: boolean): string {
  if (uses === 0) return "No uses. The CSV has no rows.";
  const said = [`${count(uses, "use")} of ${count(objects, "object")}. The CSV lists every use.`];
  if (modelUnknown > 0) {
    said.push(`${count(modelUnknown, "use")} ${modelUnknown === 1 ? "is" : "are"} on a page whose model is not known, so `
      + `${modelUnknown === 1 ? "its object is" : "their objects are"} listed without a model.`);
  }
  if (shared.length > 0) {
    said.push(`${count(shared.length, "page name")} ${shared.length === 1 ? "is" : "are each"} shared by more than one page: ${namesText(shared)}. `
      + "The CSV has only the name of a use's page, so the uses on those pages cannot be told apart.");
    if (marked) said.push('A count with "+" is at least that number.');
  }
  return said.join(" ");
}

function byObject(result: AnalysisResult): WhereUsedView | undefined {
  if (result.kind !== "app") return undefined;
  const file = result.tables.find(table => table.file === WHERE_USED_FILE);
  const pages = result.tables.find(table => table.file === APP_FILES.Pages);
  const at = file && places(file, USE_HEADERS);
  const pageAt = pages && places(pages, PAGE_HEADERS);
  if (!file || !pages || !at || !pageAt) return undefined;

  const models = modelsOf(pages, pageAt);
  const multiModel = models.labels.size > 1;
  const cardIdOf = cardIdsOf(result);
  const sharedNames = sharedNamesOf(pages, pageAt.page);
  /** The shared names that uses are on, in the file's order. */
  const sharedUsed = new Map<string, SharedName>();

  const groups = new Map<string, Group>();
  let ambiguousUses = 0;
  let unlistedUses = 0;
  file.rows.forEach((row, index) => {
    const [type, name, module, page, usedAs, id] = [at.type, at.name, at.module, at.page, at.usedAs, at.id].map(column => cellText(row[column]));
    const card = plain(row[at.card]);
    // The model of the use's page, in an app of several models. Where pages of different models share the page's name,
    // or the Pages file has no model for it, the model is left out and the use is counted.
    let model: string | undefined;
    if (multiModel && type !== PAGE) {
      const read = models.ofPage.get(page);
      if (read?.size === 1) [model] = read;
      else if (read && read.size > 1) ambiguousUses++;
      else unlistedUses++;
    }
    // What identifies the object: its type and its ID in its model, or without an ID its type, its name and its module.
    const key = JSON.stringify(says(id) ? [type, model, id] : [type, model, name, module]);
    let group = groups.get(key);
    if (!group) {
      group = { type, model, id, names: new Map(), modules: new Map(), pages: new Set(), cards: new Set(), roles: new Map(), uses: [], shared: new Map() };
      groups.set(key, group);
    }
    tally(group.names, name);
    tally(group.modules, module);
    tally(group.roles, usedAs);
    group.pages.add(page);
    group.cards.add(JSON.stringify([page, cellText(card)]));
    // A use on a name that more than one page has: which of them it is on, the file does not say. It says how many
    // pages have the name, every one of them, as the Pages file lists them.
    const shared = sharedNames.get(page);
    const pagesOfName = shared?.pages;
    if (shared !== undefined) {
      sharedUsed.set(page, shared);
      const byCard = group.shared.get(page) ?? new Map<string, Map<string, number>>();
      const sameRows = byCard.get(cellText(card)) ?? new Map<string, number>();
      tally(sameRows, JSON.stringify([name, module, usedAs, id]));
      byCard.set(cellText(card), sameRows);
      group.shared.set(page, byCard);
    }
    const cardId = cardIdOf(page, cellText(card));
    group.uses.push({ row: index, page, card, usedAs, ...(cardId === undefined ? {} : { cardId }), ...(pagesOfName === undefined ? {} : { pagesOfName }) });
  });

  const labelOf = (keys: ReadonlySet<string> | undefined): string => (keys?.size === 1 ? models.labels.get([...keys][0]) ?? NONE : NONE);
  const onlyModel = [...models.labels.values()][0] ?? NONE;
  const modelOf = (group: Group): string => (group.type === PAGE ? labelOf(models.ofPageId.get(group.id))
    : !multiModel ? onlyModel : group.model === undefined ? NONE : models.labels.get(group.model) ?? NONE);
  const objects = [...groups.values()].map((group): WhereUsedObject => {
    const { pages: onPages, pagesMost, cards: onCards, cardsMost } = spreadOf(group, sharedNames);
    const names = [...group.shared.keys()].flatMap((name): [string, SharedName][] => {
      const shared = sharedNames.get(name);
      return shared ? [[name, shared]] : [];
    });
    // A count is open where it can be more than the least: only then is the most given, and said in the note.
    const open = [[onPages, pagesMost, "pages"] as const, [onCards, cardsMost, "cards"] as const].filter(([least, most]) => most > least);
    return {
      type: group.type, name: mostGiven(group.names), module: mostGiven(group.modules), model: modelOf(group), pages: onPages, cards: onCards,
      roles: [...group.roles].sort(([, a], [, b]) => b - a), id: group.id, uses: group.uses,
      ...(pagesMost > onPages ? { pagesMost } : {}), ...(cardsMost > onCards ? { cardsMost } : {}),
      ...(names.length > 0 ? { note: objectNote(group.uses.filter(use => use.pagesOfName !== undefined).length, names, open) } : {}),
    };
  }).sort(inIndexOrder);

  const roles = [...new Set(objects.flatMap(object => object.roles.map(([role]) => role)))];
  const separator = SEPARATORS.find(candidate => !roles.some(role => role.includes(candidate))) ?? SEPARATORS[0];
  // The cells in the order of `BY_OBJECT_HEADERS`, with Model where the app has several models to tell apart.
  const headers = BY_OBJECT_HEADERS.filter(header => multiModel || header !== MODEL);
  // A count is a number, or with a plus sign the least it can be: the mark is in the cell, where no choice of columns hides it.
  const counted = (least: number, most: number | undefined): Cell => (most === undefined ? least : `${least}+`);
  const rows = objects.map((object): Cell[] => [object.type, object.name, object.module, ...(multiModel ? [object.model] : []),
    counted(object.pages, object.pagesMost), counted(object.cards, object.cardsMost), object.roles.map(([role]) => role).join(separator), object.id]);
  // A column of few different texts gets its filter from columns.ts, as in any table.
  const columns = columnsOf({ file: "", label: "", headers, rows, guard: true }).map((column): Column => ({ ...column, ...SHOWN.get(column.label) }));

  const totalUses = file.rows.length;
  const sharedPageNames = [...sharedUsed].map(([name, { pages: pagesOfName }]): [string, number] => [name, pagesOfName]);
  const marked = objects.some(object => object.pagesMost !== undefined || object.cardsMost !== undefined);
  return {
    headers, columns, rows, objects, totalUses, multiModel, ambiguousUses, unlistedUses, ...(sharedPageNames.length > 0 ? { sharedPageNames } : {}),
    note: noteOf(totalUses, objects.length, ambiguousUses + unlistedUses, [...sharedUsed], marked),
  };
}

/** The by-object view of an app's Where used file. Undefined when the result is not an app's, or when the Where used file,
 * the Pages file or a column the view reads is missing or goes by another name: the page then shows the file's own table.
 * It never throws, whatever it is given. */
export function whereUsedView(result: AnalysisResult): WhereUsedView | undefined {
  try {
    return byObject(result);
  } catch {
    return undefined;
  }
}

/** The object a row of the view stands for: the page holds the view's rows, and a click names one of them. Undefined for
 * any other row. */
export function objectOf(view: WhereUsedView, row: Row): WhereUsedObject | undefined {
  const index = view.rows.findIndex(candidate => candidate === row);
  return index < 0 ? undefined : view.objects[index];
}
