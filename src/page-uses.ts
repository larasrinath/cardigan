import type { UxCardDetail } from "./card-reader/card-types.js";
import { missingIn } from "./page-files.js";
import { LINE_ITEMS } from "./report.js";
import type { PageUses } from "./result-types.js";
import { list, type Obj } from "./util.js";

/** What the cards of a page built on a model use of the model by name (result-types.ts `PageUses`), out of the card
 * descriptions the run read and named anyway (model-pages.ts `tablesOf`): nothing more is read for it. A model's run finds
 * the line items nothing uses with it (model/unused.ts).
 *
 * - A line item is used wherever a card names it: a field, a KPI or an image card, a button that writes to it or notifies
 *   with it, a grid's shown, hidden or reordered line items, a filter's condition, a sort, a formatting rule. Each is a
 *   line item reference of the card description (card-reader/card-types.ts `UxEntityRef`), named by its module and its own
 *   name, wherever in the card it stands.
 * - A module is used whole where a grid or a chart shows it without naming the line items it shows: through a saved view
 *   or the module's default view, whose own hidden line items are not read, or in a section whose Line Items are not
 *   narrowed to a list of shown line items (all of them, all but some, or picked by the Line Items selector). A grid or a
 *   chart whose sections were not read shows each module it takes data from whole.
 * A reference the model's names could not name is counted, never guessed; one the model doesn't have (page-files.ts
 * `missingText`) is no line item or module of the model, and is left out. */

/** How deep a card description is walked for line items: deeper than any the card reader writes. */
const DEEPEST = 40;
/** The cards that show a module's data in a grid or a chart, by their type (report.ts `TYPE_LABEL`). */
const GRID_CARDS: ReadonlySet<string> = new Set(["TABLE", "COMBOCHART", "PRESENTATION_TABLE"]);
/** The view types of a card that only selects a view the model holds: a saved view or a module's default view. */
const MODEL_VIEWS: ReadonlySet<string> = new Set(["savedView", "moduleView"]);

const isObj = (value: unknown): value is Obj => !!value && typeof value === "object" && !Array.isArray(value);
const named = (value: unknown): string | undefined => (typeof value === "string" && value.trim() !== "" ? value : undefined);

/** Whether an object is a reference to a line item: of that kind, or of a kind the card did not say that the names
 * established as a line item's (a filter rule's items). */
const isLineItemRef = (node: Obj): boolean => typeof node.id === "string" && (node.kind === "lineItem" || (node.kind === "unknown" && node.resolvedKind === "lineItem"));

/** Whether a section's Line Items are narrowed to a list of the line items it shows, every one of them a reference: on its
 * rows or its columns, or, where the Line Items selector picks them, among the section's own dimensions off its axes. A
 * list cut short (the card reader keeps at most 50 items, then a word that says how many more) is no such list. */
function shownOnly(region: Obj): boolean {
  const entry = ["rows", "columns"].flatMap(axis => list(region[axis]?.dimensions)).find(each => each.dimension?.id === LINE_ITEMS)
    ?? list(region.pages).find(each => each.dimension?.id === LINE_ITEMS);
  const shows: unknown[] = Array.isArray(entry?.shows) ? entry.shows : [];
  return shows.length > 0 && shows.every(item => isObj(item) && isLineItemRef(item));
}

/** What the cards of one page use, `cards` being those of its cards that work on this model, named by the model's names. */
export function pageUsesOf(cards: readonly UxCardDetail[]): Omit<PageUses, "unread"> {
  const lineItems = new Map<string, [string, string]>();
  const modules = new Set<string>();
  const unnamed = new Set<string>();
  const lineItem = (ref: Obj): void => {
    const [name, module] = [named(ref.name), named(ref.moduleName)];
    if (name !== undefined && missingIn(name).length) return;
    if (name === undefined || module === undefined || missingIn(module).length) {
      unnamed.add(`line item ${String(ref.id)}`);
      return;
    }
    const key = `${module.trim()}\n${name.trim()}`;
    if (!lineItems.has(key)) lineItems.set(key, [module.trim(), name.trim()]);
  };
  /** A module a grid or a chart shows whole, by its reference. */
  const whole = (ref: unknown): void => {
    if (!isObj(ref)) return;
    const name = named(ref.name) ?? named(ref.moduleName);
    if (name !== undefined && missingIn(name).length) return;
    if (name === undefined) unnamed.add(`module ${String(ref.id ?? ref.moduleId)}`);
    else modules.add(name.trim());
  };
  const walk = (node: unknown, depth: number): void => {
    if (depth > DEEPEST) return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1);
      return;
    }
    if (!isObj(node)) return;
    if (isLineItemRef(node)) lineItem(node);
    for (const [key, child] of Object.entries(node)) if (key !== "unrecognised") walk(child, depth + 1);
  };
  for (const card of cards) {
    const each = card as Obj;
    walk(each, 0);
    const regions = list(each.grid?.regions);
    for (const region of regions) if (!shownOnly(region)) whole(region.module);
    const sources = list(each.sources);
    // A saved view's module, or the module a card shows through its default view.
    for (const source of sources) {
      if (!source.view) continue;
      if (named(source.view.moduleName) !== undefined) whole({ name: source.view.moduleName });
      else if (isObj(source.module)) whole(source.module);
      else unnamed.add(`view ${String(source.view.id)}`);
    }
    if (MODEL_VIEWS.has(String(each.viewType)) || (!regions.length && GRID_CARDS.has(String(each.type)))) {
      for (const source of sources) if (!source.view) whole(source.module);
    }
  }
  return { lineItems: [...lineItems.values()], modules: [...modules], unnamed: unnamed.size };
}

/** What all the pages that were read use, each page's in turn, with how many pages could not be read. */
export function mergePageUses(pages: readonly Omit<PageUses, "unread">[], unread: number): PageUses {
  const lineItems = new Map<string, [string, string]>();
  const modules = new Set<string>();
  let unnamed = 0;
  for (const page of pages) {
    for (const [module, name] of page.lineItems) if (!lineItems.has(`${module}\n${name}`)) lineItems.set(`${module}\n${name}`, [module, name]);
    for (const module of page.modules) modules.add(module);
    unnamed += page.unnamed;
  }
  return { lineItems: [...lineItems.values()], modules: [...modules], unread, unnamed };
}
