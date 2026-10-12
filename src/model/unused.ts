import { diagnosticRows, stampLine, type DetailRow } from "../details.js";
import { SOURCE_TYPE } from "../file-imports.js";
import { FILTERED_LINE_ITEMS, readFilteredLineItems } from "../filtered-line-items.js";
import { definitionOf, idOf, moduleHeadings, nothing, splitOutside, unquote } from "../map/graph-names.js";
import { missingIn, PAGE_FILTERS_FILE } from "../page-files.js";
import { plainRows, textOf } from "../result-plain.js";
import type { AnalysisResult, Cell, ResultTable } from "../result-types.js";
import { formatType, formatWords } from "../results/readable-cells.js";
import { sourceObjectOf } from "../results/source-object.js";
import { importLoads } from "./import-loads.js";
import { UNUSED_LINE_ITEMS, UNUSED_LINE_ITEMS_FILE, UNUSED_LINE_ITEMS_HEADERS, UNUSED_MODULES, UNUSED_MODULES_FILE, UNUSED_MODULES_HEADERS, UNUSED_NOTES, WHY } from "../unused-files.js";
import { message } from "../util.js";

/** The line items and the modules of a model that nothing uses, as far as Cardigan can see: two tables made from the
 * result's own tables and what it carries beside them, once the pages built on the model have been read (content.ts calls
 * this right after model-pages.ts has added them). Nothing is read from Anaplan for them.
 *
 * A line item is used, by a real use, where:
 * - a page names it (result-types.ts `PageUses`, and the Page Filters table: a condition, or a filtered line item);
 * - it drives who may read or write cells (the driver columns of Line Items, and the Dynamic Cell Access table);
 * - it is a member of a line item subset that a module or a line item applies to, or that something refers to (Line Item
 *   Subsets: its members, and its Referenced columns);
 * - an action's definition names it by its ID: an export's filters (`filter0LineItemEntityLongId`,
 *   `filter1LineItemEntityLongId`) or another action's (`filterLineItemIdentifier`, `lineItemIdentifier`), as anaplan-sam's
 *   model-builder reads those definitions;
 * - its module is used whole, where something names only the module or a saved view of it: a page's grid or chart
 *   (`PageUses.modules`), an export's source, an import's source in this model, or Used in Dashboards in Modules. A saved
 *   view's hidden line items are not read, so every line item of the module counts.
 * And a line item is used by another line item where that one's formula reads it (its Referenced By names it), a Ratio
 * summary divides by it (Ratio Numerator, Ratio Denominator), or the two are a summary parent and a line item summed into
 * it (Parent): each counts as using the other. What Referenced By names that is no line item of the model, such as a list's
 * property, a module, or a name nothing has, counts as a real use: it is something else that reads the line item. A line
 * item that refers only to itself is not used by that.
 *
 * A line item is listed where no real use reaches it: none of its own, and none through the line items that use it, as far
 * as the links go. An import that loads into a line item is a real use of what that line item uses, such as the summary
 * parent it is summed into; the line item itself is listed all the same where no other real use reaches it: an import is
 * no reader.
 * What an import from a file loads is what its mapping says (result-types.ts `ImportMapping`); where that is not known, as
 * for an import from a module or a saved view, whose mapping is not read, it is any line item of its module that holds
 * data and has no formula.
 * Each listed line item says why, in this order: Imported, never read; Read by nothing, where nothing uses it at all; and
 * Only feeds unused line items, where every line item that uses it is listed too. Headings, of the format No Data, are
 * never listed. A module is listed where nothing uses it whole, and it has no line item but headings (Empty), or every one
 * of its line items, headings aside, is listed (No line item used). Divider modules, named as headings, are left out.
 *
 * Where the run could not see what it would take to know (the pages, Line Items, the imports' mappings, an export's source,
 * a subset's members), the tables are made all the same, and a note says what may be used after all. */

type Row = readonly Cell[];
type Log = (line: string) => void;

/** The result's tables this reads, as model/export.ts and model-pages.ts name them. */
const LINE_ITEMS_FILE = "Line Items.csv";
const MODULES_FILE = "Modules.csv";
const LISTS_FILE = "General Lists.csv";
const SUBSETS_FILE = "Line Item Subsets.csv";
const ACCESS_FILE = "Dynamic Cell Access.csv";
const IMPORTS_FILE = "Imports.csv";
const EXPORTS_FILE = "Exports.csv";
const OTHER_ACTIONS_FILE = "Other Actions.csv";
/** A Source Type that reads one of a model's modules, or a saved view of one (results/result-view.ts `READS_A_MODULE`). */
const READS_A_MODULE = /view|module/i;
/** How the report joins the modules of a filter on sections of more than one module (report.ts). */
const MODULES_JOINED = "; ";
/** The fields of an export's definition that name its source, and the line items it filters by. */
const EXPORT_SOURCE = "sourceEntityLongId";
const EXPORT_FILTERS = ["filter0LineItemEntityLongId", "filter1LineItemEntityLongId"];
/** The fields of another action's definition that name a line item. */
const ACTION_LINE_ITEMS = ["filterLineItemIdentifier", "lineItemIdentifier"];
/** An Action cell that says an export's source in words, as Anaplan's own Actions list writes it ("Export from 'Prices'"). */
const EXPORT_WORDS = /^Export from (\S[^\n]*)$/;
/** The columns of Line Item Subsets that say something refers to a subset. */
const SUBSET_REFERENCES = ["Referenced in Applies To", "Referenced By", "Referenced as Format"];
/** The columns of Line Items that name a driver (map/build-graph.ts `DRIVERS`). */
const DRIVER_COLUMNS = ["Read Access Driver", "Write Access Driver"];

const cellText = (cell: Cell | undefined): string => (cell === undefined || cell === null ? "" : textOf(cell));
const key = (module: string, name: string): string => `${module.trim()}\n${name.trim()}`;
const plural = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`;
/** A key of a definition for the log: a word, or a question mark for anything else, which could be a value. */
const logWord = (word: string): string => (/^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(word) ? word : "?");

/** One of the result's tables, read by its headers. */
interface Read { table: ResultTable; at(header: string): number | undefined; cell(row: Row, header: string): string }
function readOf(result: AnalysisResult, file: string): Read | undefined {
  const table = result.tables.find(each => each.file === file);
  if (!table) return undefined;
  const at = (header: string): number | undefined => {
    const index = table.headers.indexOf(header);
    return index < 0 ? undefined : index;
  };
  return { table, at, cell: (row, header) => { const index = at(header); return index === undefined ? "" : cellText(row[index]); } };
}

/** A line item of Line Items: its row, its name and its module's, and whether it is a heading. */
interface Item { row: Row; index: number; name: string; module: string; heading: boolean; formula: string }

/** What the two tables are made of, and what the run could not see. */
interface Found { lineItems: Cell[][]; modules: Cell[][]; notes: string[]; log: string[] }

/** The two tables, with what may be used after all and the log's lines. */
function findUnused(result: AnalysisResult, lineItemIds: readonly (readonly [string, string])[] | undefined): Found {
  const notes: string[] = [];
  const lineItems = readOf(result, LINE_ITEMS_FILE);
  const modules = readOf(result, MODULES_FILE);
  const headings = moduleHeadings(result.tables);

  // The line items, each by its module and its name. A row that names no module is a module's own, or a line item whose
  // module is not known: neither is listed.
  const items: Item[] = [];
  const byKey = new Map<string, Item>();
  const byName = new Map<string, Item[]>();
  const byModule = new Map<string, Item[]>();
  const moduleAt = lineItems?.at("Module Name");
  const read = lineItems !== undefined && moduleAt !== undefined;
  if (!read) notes.push("Line Items was not read, so no line item or module could be checked.");
  else {
    lineItems.table.rows.forEach((row, index) => {
      const module = cellText(row[moduleAt]);
      const name = cellText(row[0]);
      if (module.trim() === "" || name.trim() === "") return;
      const item: Item = { row, index, name, module, heading: formatType(lineItems.cell(row, "Format")) === "No Data", formula: lineItems.cell(row, "Formula") };
      items.push(item);
      if (!byKey.has(key(module, name))) byKey.set(key(module, name), item);
      for (const [map, by] of [[byName, name.trim()], [byModule, module.trim()]] as const) {
        const held = map.get(by);
        if (held) held.push(item);
        else map.set(by, [item]);
      }
    });
  }
  const find = (module: string, name: string): Item | undefined => byKey.get(key(module, name));

  // The modules, in Modules' order, or in Line Items' where Modules was not read; and every module Line Items names.
  const moduleRows = new Map<string, Row | undefined>();
  for (const row of modules?.table.rows ?? []) {
    const name = cellText(row[0]);
    if (name.trim() !== "" && !headings.has(name) && !moduleRows.has(name.trim())) moduleRows.set(name.trim(), row);
  }
  if (read) {
    for (const row of lineItems.table.rows) {
      const name = cellText(row[0]);
      if (cellText(row[moduleAt]).trim() === "" && name.trim() !== "" && !headings.has(name) && !moduleRows.has(name.trim()) && !modules?.table.rows.length) moduleRows.set(name.trim(), undefined);
    }
    for (const item of items) if (!moduleRows.has(item.module.trim()) && !headings.has(item.module)) moduleRows.set(item.module.trim(), undefined);
  }
  const lists = new Set((readOf(result, LISTS_FILE)?.table.rows ?? []).map(row => cellText(row[0]).trim()).filter(name => name !== ""));

  // What uses what: a line item, by the line items it uses; what is used by a real use; and the modules used whole.
  const uses = new Map<Item, Set<Item>>();
  const usedBy = new Map<Item, Set<Item>>();
  const roots = new Set<Item>();
  const whole = new Set<string>();
  const imported = new Set<Item>();
  const link = (user: Item, used: Item): void => {
    if (user === used) return;
    uses.set(user, (uses.get(user) ?? new Set()).add(used));
    usedBy.set(used, (usedBy.get(used) ?? new Set()).add(user));
  };
  const counts = { references: 0, others: 0, unresolved: 0, ratios: 0, ratiosUnmatched: 0, parents: 0, parentsUnmatched: 0, drivers: 0, driversUnmatched: 0,
    pages: 0, pagesUnmatched: 0, filters: 0, subsets: 0, subsetsUnread: 0, ids: 0, idsUnmatched: 0, imported: 0, mappingsUnread: 0 };

  if (read) {
    const referencedBy = lineItems.at("Referenced By") !== undefined;
    if (!referencedBy) notes.push("Line Items has no Referenced By column, so formula use is unknown: some line items may be read by formulas after all.");
    for (const item of items) {
      // What the line item's Referenced By names. A name behind another and a dot is that module's line item, or that list's
      // property; a name alone is a line item of its own module, or a module.
      for (const reference of referencedBy ? splitOutside(lineItems.cell(item.row, "Referenced By")) : []) {
        const parts = splitOutside(reference, ".");
        const [owner, name] = parts.length === 2 ? parts.map(unquote) : ["", ""];
        const user = (parts.length === 2 ? find(owner, name) : undefined) ?? find(item.module, unquote(reference));
        if (user) {
          counts.references++;
          link(user, item);
          continue;
        }
        roots.add(item);
        if ((parts.length === 2 && lists.has(owner.trim())) || moduleRows.has(unquote(reference).trim())) counts.others++;
        else counts.unresolved++;
      }
      // A Ratio summary divides by two line items of its module, which the export names beside it.
      for (const operand of ["Ratio Numerator", "Ratio Denominator"].map(header => lineItems.cell(item.row, header)).filter(name => !nothing(name))) {
        const named = find(item.module, operand) ?? (byName.get(operand.trim())?.length === 1 ? byName.get(operand.trim())![0] : undefined);
        if (named) {
          counts.ratios++;
          link(item, named);
        } else counts.ratiosUnmatched++;
      }
      // A line item summed into a parent, and the parent: each counts as using the other.
      const parent = lineItems.cell(item.row, "Parent");
      if (!nothing(parent)) {
        const parts = splitOutside(parent, ".").map(unquote);
        const found = find(item.module, unquote(parent)) ?? (parts.length === 2 ? find(parts[0], parts[1]) : undefined);
        if (found && found !== item) {
          counts.parents++;
          link(found, item);
          link(item, found);
        } else if (!found) counts.parentsUnmatched++;
      }
    }
    // Access drivers: each driver cell of a module's own row or of a line item's, read in that row's module.
    for (const row of lineItems.table.rows) {
      const module = cellText(row[moduleAt]).trim() === "" ? cellText(row[0]) : cellText(row[moduleAt]);
      for (const column of DRIVER_COLUMNS) {
        const written = lineItems.cell(row, column);
        if (nothing(written)) continue;
        const parts = splitOutside(written, ".").map(unquote);
        const driver = (parts.length === 2 ? find(parts[0], parts[1]) : undefined) ?? find(module, unquote(written));
        if (driver) {
          counts.drivers++;
          roots.add(driver);
        } else counts.driversUnmatched++;
      }
    }
  }
  // The Dynamic Cell Access table says the same from the driver's side, as the model map reads the cells.
  const access = readOf(result, ACCESS_FILE);
  for (const row of access?.table.rows ?? []) {
    const driver = find(access!.cell(row, "Driver Module"), access!.cell(row, "Driver Line Item"));
    if (driver) roots.add(driver);
  }

  // The pages: what their cards name, and the modules their grids and charts show whole.
  const pageUses = result.pageUses;
  if (!pageUses) notes.push("The pages built on this model could not be read, so page use is unknown: some line items may be used on pages after all.");
  else {
    for (const [module, name] of pageUses.lineItems) {
      const found = find(module, name);
      if (found) {
        counts.pages++;
        roots.add(found);
      } else counts.pagesUnmatched++;
    }
    for (const module of pageUses.modules) whole.add(module.trim());
    if (pageUses.unread) notes.push(`${plural(pageUses.unread, "page", "pages")} built on this model could not be read, so some line items may be used on ${pageUses.unread === 1 ? "it" : "them"} after all.`);
    if (pageUses.unnamed) notes.push(`${plural(pageUses.unnamed, "thing", "things")} the pages use could not be named, so some line items may be used on pages after all.`);
  }
  // Page Filters: a condition's line item, and the line items a filter filters: those named, or the module whole.
  const filters = readOf(result, PAGE_FILTERS_FILE);
  for (const row of filters?.table.rows ?? []) {
    const condition = find(filters!.cell(row, "Condition line item's module"), filters!.cell(row, "Condition line item"));
    if (condition) {
      counts.filters++;
      roots.add(condition);
    }
    const filtered = filters!.cell(row, "Filtered module").split(MODULES_JOINED).map(module => module.trim()).filter(module => !nothing(module) && !missingIn(module).length);
    for (const part of readFilteredLineItems(filters!.cell(row, FILTERED_LINE_ITEMS))) {
      for (const module of part.module === undefined ? filtered : [part.module.trim()]) {
        const shown = part.shown;
        if (!shown || "all" in shown) whole.add(module);
        else for (const name of "only" in shown ? shown.only : shown.except) {
          const found = find(module, name);
          if (found) roots.add(found);
        }
      }
    }
  }

  // Line item subsets: the members of a subset that a module or a line item applies to, or that something refers to.
  const subsets = readOf(result, SUBSETS_FILE);
  if (!subsets) notes.push("Line Item Subsets was not read, so some line items may be used through a subset after all.");
  else {
    const dimensions = new Set<string>();
    for (const table of [modules, lineItems]) {
      for (const row of table?.table.rows ?? []) for (const name of splitOutside(table!.cell(row, "Applies To"))) dimensions.add(unquote(name).trim());
    }
    const membersAt = subsets.at("Line Items");
    for (const row of subsets.table.rows) {
      const name = cellText(row[0]).trim();
      if (name === "" || !(dimensions.has(name) || SUBSET_REFERENCES.some(column => !nothing(subsets.cell(row, column))))) continue;
      counts.subsets++;
      if (membersAt === undefined || subsets.cell(row, "Membership read") === "false") {
        counts.subsetsUnread++;
        continue;
      }
      for (const member of splitOutside(cellText(row[membersAt]))) {
        const parts = splitOutside(member, ".").map(unquote);
        const found = parts.length === 2 ? find(parts[0], parts[1]) : undefined;
        if (found) roots.add(found);
      }
    }
    if (counts.subsetsUnread) notes.push(`The members of ${plural(counts.subsetsUnread, "line item subset", "line item subsets")} in use were not read, so some line items may be used through ${counts.subsetsUnread === 1 ? "it" : "them"} after all.`);
  }

  // Modules used whole: Used in Dashboards, and an import's source in this model.
  for (const [name, row] of moduleRows) {
    const dashboards = row && modules ? modules.cell(row, "Used in Dashboards").trim() : "";
    if (!nothing(dashboards) && !/^(false|no|0)$/i.test(dashboards)) whole.add(name);
  }
  const imports = readOf(result, IMPORTS_FILE);
  if (!imports) notes.push("Imports was not read, so the imports into line items and from modules are not known: some modules may be used after all.");
  for (const row of imports?.table.rows ?? []) {
    if (!READS_A_MODULE.test(imports!.cell(row, SOURCE_TYPE))) continue;
    const source = sourceObjectOf(imports!.cell(row, "Source Object"));
    if (source && (source.model === undefined || source.model.trim() === result.name.trim())) whole.add(source.module.trim());
  }

  // The actions: what an export reads, and the line items an action's definition names by ID.
  const ids = new Map<string, Item>();
  const idsFit = !!lineItemIds && lineItems !== undefined && lineItemIds.length === lineItems.table.rows.length;
  if (idsFit) for (const item of items) ids.set(lineItemIds![item.index][0], item);
  const byId = (value: unknown): void => {
    const id = idOf(value);
    if (id === undefined || /^0+$/.test(id)) return;
    counts.ids++;
    const found = ids.get(id);
    if (found) roots.add(found);
    else counts.idsUnmatched++;
  };
  const moduleNames = new Map((result.moduleIds ?? []).map(([name, id]) => [id, name]));
  const listIds = new Set((result.listIds ?? []).map(([, id]) => id));
  const shapes = { exports: new Map<string, number>(), others: new Map<string, number>() };
  const shape = (into: Map<string, number>, kind: string): void => { into.set(kind, (into.get(kind) ?? 0) + 1); };
  let exportsUnread = 0;
  const exports = readOf(result, EXPORTS_FILE);
  for (const row of exports?.table.rows ?? []) {
    const cell = exports!.cell(row, "Action").trim();
    const definition = definitionOf(cell);
    if (definition) {
      for (const field of Object.keys(definition)) shape(shapes.exports, logWord(field));
      for (const field of EXPORT_FILTERS) byId(definition[field]);
      const source = idOf(definition[EXPORT_SOURCE]);
      const module = source === undefined ? undefined : moduleNames.get(source);
      if (module !== undefined) whole.add(module.trim());
      else if (source === undefined || !listIds.has(source)) exportsUnread++;
      continue;
    }
    const words = EXPORT_WORDS.exec(cell);
    shape(shapes.exports, words ? "(words)" : nothing(cell) ? "(empty)" : "(other)");
    const named = words ? sourceObjectOf(words[1])?.module ?? unquote(words[1]) : undefined;
    if (named !== undefined && moduleRows.has(named.trim())) whole.add(named.trim());
    else if (named === undefined || !lists.has(named.trim())) exportsUnread++;
  }
  if (exportsUnread) notes.push(`${exportsUnread === 1 ? "1 export's source" : `${exportsUnread} exports' sources`} couldn't be read, so a module ${exportsUnread === 1 ? "it exports" : "they export"} may be used after all.`);
  const others = readOf(result, OTHER_ACTIONS_FILE);
  for (const row of others?.table.rows ?? []) {
    const definition = definitionOf(others!.cell(row, "Action").trim());
    if (!definition) {
      shape(shapes.others, nothing(others!.cell(row, "Action")) ? "(empty)" : "(other)");
      continue;
    }
    for (const field of Object.keys(definition)) shape(shapes.others, logWord(field));
    for (const field of ACTION_LINE_ITEMS) byId(definition[field]);
  }
  if (!exports && !others) notes.push("The Actions list was not read, so exports and actions are not known: some line items may be used after all.");
  if (counts.ids && !idsFit) notes.push("The line items that actions name by ID could not be matched, so some line items may be used by actions after all.");

  // Imports into line items: what each import of the Imports table into a module loads, as its mapping says
  // (import-loads.ts), found among the module's line items. Any line item is every line item of the module that holds data
  // and has no formula, which an import can load.
  for (const load of importLoads(imports?.table, result.importMappings, module => moduleRows.has(module))) {
    if (load.unread) counts.mappingsUnread++;
    if (load.any) for (const item of byModule.get(load.module) ?? []) if (!item.heading && item.formula.trim() === "") imported.add(item);
    for (const lineItem of load.lineItems) {
      const found = find(load.module, lineItem);
      if (found) imported.add(found);
    }
  }
  counts.imported = imported.size;
  if (counts.mappingsUnread) {
    notes.push(`The ${counts.mappingsUnread === 1 ? "mapping of 1 import" : `mappings of ${counts.mappingsUnread} imports`} could not be read, so every line item `
      + `without a formula in the ${counts.mappingsUnread === 1 ? "module it loads" : "modules they load"} counts as imported.`);
  }

  // Every line item of a module used whole.
  for (const module of whole) for (const item of byModule.get(module) ?? []) roots.add(item);

  // What the real uses reach, through the line items that use one another: once without the imports, which say whether an
  // imported line item is read or shown, and once with them, since what an import loads into is a use as well, as of a
  // summary parent of an imported line item.
  const reach = (from: Iterable<Item>): Set<Item> => {
    const live = new Set<Item>(from);
    const queue = [...live];
    for (let at = 0; at < queue.length; at++) {
      for (const used of uses.get(queue[at]) ?? []) {
        if (live.has(used)) continue;
        live.add(used);
        queue.push(used);
      }
    }
    return live;
  };
  const readOrShown = reach(roots);
  const live = reach([...roots, ...imported]);

  const listed = new Set<Item>();
  const whyCounts = new Map<string, number>();
  const lineItemRows: Cell[][] = [];
  for (const item of items) {
    if (item.heading || (imported.has(item) ? readOrShown.has(item) : live.has(item)) || byKey.get(key(item.module, item.name)) !== item) continue;
    const why = imported.has(item) ? WHY.importedNeverRead : usedBy.get(item)?.size ? WHY.onlyFeedsUnused : WHY.readByNothing;
    listed.add(item);
    whyCounts.set(why, (whyCounts.get(why) ?? 0) + 1);
    const cell = (header: string): string => lineItems!.cell(item.row, header);
    const format = cell("Format");
    const list = cell("Format List");
    const counted = lineItems!.at("Cell Count") ?? lineItems!.at("Populated Cell Count");
    lineItemRows.push([item.name, item.module, why, formatWords(format, { listName: list === "" ? undefined : () => list }) ?? format,
      counted === undefined ? "" : item.row[counted] ?? "", cell("Notes"), item.formula, cell("Referenced By")]);
  }
  const moduleRowsOut: Cell[][] = [];
  if (read) {
    const count = modules?.at("Cell Count") ?? modules?.at("Populated Cell Count");
    for (const [name, row] of moduleRows) {
      if (whole.has(name)) continue;
      const own = (byModule.get(name) ?? []).filter(item => !item.heading);
      const why = own.length === 0 ? WHY.empty : own.every(item => listed.has(item)) ? WHY.noLineItemUsed : undefined;
      if (why === undefined) continue;
      whyCounts.set(why, (whyCounts.get(why) ?? 0) + 1);
      const cell = (header: string): string => (row && modules ? modules.cell(row, header) : "");
      moduleRowsOut.push([row ? cellText(row[0]) : name, why, own.length, row && count !== undefined ? row[count] ?? "" : "", cell("Functional Area"), cell("Notes")]);
    }
  }

  const said = (map: Map<string, number>): string => [...map].map(([word, count]) => `${word} ×${count}`).join(", ") || "none";
  const by = (whys: readonly string[]): string => whys.map(why => `${why} ×${whyCounts.get(why) ?? 0}`).join(", ");
  const log = [
    `Unused: ${lineItemRows.length} of ${items.filter(item => !item.heading).length} line items that hold data listed (${by([WHY.importedNeverRead, WHY.readByNothing, WHY.onlyFeedsUnused])}); `
      + `${moduleRowsOut.length} of ${moduleRows.size} modules listed (${by([WHY.empty, WHY.noLineItemUsed])}); ${roots.size} line items used directly, ${whole.size} modules used whole`,
    `Unused: uses found: Referenced By ${counts.references}, ratio ${counts.ratios}, parent ${counts.parents}, driver cells ${counts.drivers}, on pages ${counts.pages}, `
      + `page filter conditions ${counts.filters}, imported ${counts.imported} (mappings not read ${counts.mappingsUnread}), subsets in use ${counts.subsets} (${counts.subsetsUnread} not read), `
      + `action IDs ${counts.ids - counts.idsUnmatched} of ${counts.ids}; `
      + `Referenced By naming no line item: something else ${counts.others}, nothing ${counts.unresolved}; not matched: ratio operands ${counts.ratiosUnmatched}, `
      + `parents ${counts.parentsUnmatched}, drivers ${counts.driversUnmatched}, page line items ${counts.pagesUnmatched}`,
    `Unused: Action cells of Exports: ${said(shapes.exports)}; of Other Actions: ${said(shapes.others)}; exports whose source was not read: ${exportsUnread}`,
  ];
  // Where Line Items was not read, nothing could be checked, and that is all there is to say.
  return { lineItems: lineItemRows, modules: moduleRowsOut, notes: read ? notes : notes.slice(0, 1), log };
}

/** The result with the two tables after its others, each with its Files row, the notes on what may be used after all, and
 * the log's lines, which go to the run's log too. It never throws: a failure leaves both tables out, with why. The result
 * given is not changed: its tables and its Details file are copied where they gain rows. `lineItemIds` are the IDs the
 * export gave for the rows of its Line Items table (content.ts takes them off its result). */
export function addUnused(given: AnalysisResult, lineItemIds: readonly (readonly [string, string])[] | undefined, log: Log = () => undefined): AnalysisResult {
  const result: AnalysisResult = { ...given, summary: [...given.summary], tables: given.tables.map(table => (table.details ? { ...table, rows: [...table.rows] } : table)) };
  const details = result.tables.find(table => table.details === true);
  const lastOf = (sections: readonly string[]): number => (details?.rows ?? []).reduce((at, row, index) => (sections.includes(cellText(row[0])) ? index : at), -1);
  const after = (sections: readonly string[], rows: readonly DetailRow[]): void => {
    if (!details || !rows.length) return;
    const at = lastOf(sections);
    details.rows.splice(at < 0 ? details.rows.length : at + 1, 0, ...plainRows(rows));
  };
  const said = (line: string): void => {
    log(line);
    details?.rows.push(...plainRows(diagnosticRows(stampLine(line))));
  };
  const tables: [file: string, label: string, headers: readonly string[]][] = [[UNUSED_LINE_ITEMS_FILE, UNUSED_LINE_ITEMS, UNUSED_LINE_ITEMS_HEADERS],
    [UNUSED_MODULES_FILE, UNUSED_MODULES, UNUSED_MODULES_HEADERS]];
  let found: Found;
  try {
    found = findUnused(result, lineItemIds);
  } catch (error) {
    const why = `Cardigan could not make it: ${message(error)}`;
    result.summary.push(...tables.map(([, label]) => `${label}: not exported (${why}).`));
    after(["Files"], tables.map(([file]): DetailRow => ["Files", file, `Not exported: ${why}`]));
    said(`Unused: ${message(error)}`);
    return result;
  }
  const rows = [found.lineItems, found.modules];
  tables.forEach(([file, label, headers], index) => result.tables.push({ file, label, headers: [...headers], rows: plainRows(rows[index]), guard: true }));
  result.summary.push(...tables.map(([, label], index) => `${label}: ${rows[index].length} rows`));
  after(["Files"], tables.map(([file], index): DetailRow => ["Files", file, `${rows[index].length} rows`]));
  after(["Notes", "Files"], found.notes.map((note): DetailRow => ["Notes", UNUSED_NOTES, note]));
  for (const line of found.log) said(line);
  return result;
}
