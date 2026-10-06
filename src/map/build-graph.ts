import type { Cell, ResultTable } from "../result-types.js";
import { message } from "../util.js";
import { definitionOf, idOf, integer, knownSequence, separator, splitOutside, stripChars, unquote } from "./graph-names.js";
import type { EdgeKind, GraphEdge, GraphNode, ModelGraph, Unresolved } from "./graph-types.js";

/** The model map's graph, made from the tables of a model export and from nothing else. It is the owner's prototype
 * builder (build_model_data.py) in the export's own tables. The prototype read three of Anaplan's CSV exports: General
 * Lists, Line Items and Actions. Each of the export's files is laid out as Anaplan's own export of the same grid, so the
 * columns read here are the ones the prototype read, under the same names. How the names in a cell are read is in
 * graph-names.ts. Where the export differs from those three files:
 *
 * - It has no Actions file: the rows are in Processes, Imports, Exports and Other Actions, without their heading rows.
 *   An import has no Action cell ("Import into 'Prices'"): its target is in the Imports tab's Target Object and Target
 *   Type.
 * - Line Items has a Format List column, which names a list format's list by the list's ID. Where it names one, that is
 *   the line item's list. Where it is empty or not there, the prototype's rule stands: a list's ID is learnt from a line
 *   item that the list's Referenced as Format names, by the ID in that line item's Format.
 * - The Modules file's names tell a module's own row from a line item's row of which only the name was read, as they do
 *   on the page (results/line-items-view.ts): the map's modules and headings are the rows the page takes for modules' own.
 *
 * The prototype stops at what it takes for impossible: a name that occurs twice, a line item whose module has no row, a
 * definition that is no JSON object. An export can hold each of those, so here the first of a name is kept, what cannot
 * be placed is left out and counted, and `limitations` says so in a sentence each. Nothing is guessed in its place.
 *
 * The nodes come in the prototype's order: the lists as General Lists has them, then each list's subsets and properties,
 * then the modules and line items as Line Items has them, the processes, and the actions (imports, exports, others). */

/** The files the map is made of, as the export names them (model/export.ts). */
const LISTS_FILE = "General Lists.csv";
const LINE_ITEMS_FILE = "Line Items.csv";
const MODULES_FILE = "Modules.csv";
const PROCESSES_FILE = "Processes.csv";
const IMPORTS_FILE = "Imports.csv";
const EXPORTS_FILE = "Exports.csv";
const OTHER_ACTIONS_FILE = "Other Actions.csv";

/** The group of an object with no heading above it, and of one under a heading that is nothing but dashes. */
const UNGROUPED = "Ungrouped";

/** What the map reads of one file: what its sentences call the file's objects, and each column read, with what the map
 * lacks without it. A column without such words only says more about an object. A column with `null` is one the map
 * does without, and says nothing of. The row's name is the file's first column, which has no header. */
interface Reads<Column extends string> {
  file: string;
  objects: string;
  columns: readonly (readonly [column: Column, without?: string | null])[];
}

const LISTS = {
  file: LISTS_FILE, objects: "lists",
  columns: [["Top Level"], ["Item Count"], ["Numbered"], ["Notes"], ["Display Name Property"],
    ["Subsets", "the map has no list subsets"],
    ["Properties", "the map has no list properties"],
    ["Parent Hierarchy", "the map does not say which list is the parent of another"],
    ["Referenced in Applies To", "what a list applies to is known only from the Applies To column of Line Items"],
    ["Referenced as Format", "the list of a line item formatted as a list is known only where the Format List column of Line Items names it"],
    ["Referenced in Formula", "the map has no links from a list to the formulas that name it"]],
} as const satisfies Reads<string>;
type ListColumn = (typeof LISTS)["columns"][number][0];

const LINE_ITEMS = {
  file: LINE_ITEMS_FILE, objects: "modules and line items",
  columns: [
    ["Module Name", "no row says which module it is in, so the map has no line items"],
    ["Applies To", "modules and line items come without their dimensions"],
    ["Format", "line items come without their format, and the list of one formatted as a list is known only where the Format List column names it"],
    ["Read Access Driver", "the map has no read access links"],
    ["Write Access Driver", "the map has no write access links"],
    ["Referenced By", "the map has no links from a line item to what refers to it"],
    ["Formula"], ["Summary"], ["Notes"], ["Cell Count"], ["Time Scale"], ["Time Range"], ["Versions"], ["Style"], ["Code"],
    // The export's own column (model/lineitems.ts). A file from before the export had it is read by the prototype's rule.
    ["Format List", null]],
} as const satisfies Reads<string>;
type LineItemColumn = (typeof LINE_ITEMS)["columns"][number][0];

const PROCESSES = { file: PROCESSES_FILE, objects: "processes", columns: [["Notes"]] } as const satisfies Reads<string>;

/** The columns a file of actions can have: the Actions list's own, and for an import the Imports tab's two for its target. */
type ActionColumn = "Action" | "Target Object" | "Target Type" | "Used in Processes" | "Notes" | "Start Date and Time (UTC)" | "Most recent duration (ms)";
/** An action's notes and its last run. */
const RUN_COLUMNS = [["Notes"], ["Start Date and Time (UTC)"], ["Most recent duration (ms)"]] as const;

const IMPORTS: Reads<ActionColumn> = {
  file: IMPORTS_FILE, objects: "imports",
  columns: [
    ["Target Object", "the map does not say what an import loads into"],
    // It only tells a module from a list of the same name.
    ["Target Type", null],
    ["Used in Processes", "the map does not say which processes run an import"],
    ...RUN_COLUMNS],
};

const EXPORTS: Reads<ActionColumn> = {
  file: EXPORTS_FILE, objects: "exports",
  columns: [
    ["Action", "exports come without their definition, and the map does not say what an export takes"],
    ["Used in Processes", "the map does not say which processes run an export"],
    ...RUN_COLUMNS],
};

const OTHER_ACTIONS: Reads<ActionColumn> = {
  file: OTHER_ACTIONS_FILE, objects: "the other actions",
  columns: [
    ["Action", "the other actions come without their kind and their definition, and the map does not say which list one works on"],
    ["Used in Processes", "the map does not say which processes run one of the other actions"],
    ...RUN_COLUMNS],
};

/** What the map is without a file. */
const WITHOUT_FILE: ReadonlyMap<string, string> = new Map([
  [LISTS_FILE, "the map has no lists, no list subsets and no list properties"],
  [LINE_ITEMS_FILE, "the map has no modules and no line items"],
  [PROCESSES_FILE, "the map has no processes"],
  [IMPORTS_FILE, "the map has no imports"],
  [EXPORTS_FILE, "the map has no exports"],
  [OTHER_ACTIONS_FILE, "the map has none of the model's other actions"],
]);

/** What no export says, and what the map does not do with what one says. The prototype said these of its three files.
 * Its fourth, that the files name neither the model nor its workspace, is not true of the export. */
const STANDING: readonly string[] = [
  "The export gives the number of items in each list, not the items.",
  "The export says which processes use an action, not the order in which a process runs its actions.",
  "Every link comes from a column of the export that names another object: formulas are kept as text and are not worked out.",
];
/** The prototype's files did not say where an import takes its data from. The export does, in a file the map does not draw. */
const IMPORT_SOURCES = "Where an import takes its data from is in the Imports table, not on the map.";

/** The columns that hold what only a line item has: a module's own row has none of the three (results/line-items-view.ts). */
const LINE_ITEM_HAS = ["Format", "Formula", "Summary"] as const;

/** A list's columns that name what uses it, each with the link from the list to what the column names. */
const LIST_REFERENCES = [["Referenced in Applies To", "applies"], ["Referenced as Format", "format"], ["Referenced in Formula", "list_formula"]] as const;

/** The columns that name what drives who may read and who may write a module or a line item, each with its link. */
const DRIVERS = [["Read Access Driver", "read_access"], ["Write Access Driver", "write_access"]] as const;

/** The fields of an action's definition that name a list by its ID. */
const LIST_IDENTIFIERS = ["hierarchyIdentifier", "sourceHierarchyIdentifier", "targetHierarchyIdentifier"] as const;

/** An Action cell that says its target in words. The prototype read an import's and an export's target so, from Anaplan's
 * own Actions file. */
const ACTION_TARGET = /^(Import into|Export from) '([^\n]+)'$/;

/** A list's property in the Properties cell: its name, a colon and white space, then its format. A name may hold a colon
 * itself: the last colon that white space follows is the one before the format. */
const PROPERTY = /^([^\n]+):\s+([^\n]*)/;

type Row = readonly Cell[];

const textOf = (cell: unknown): string => (cell === null || cell === undefined ? "" : String(cell));

const count = (amount: number, one: string, many: string): string => (amount === 1 ? `1 ${one}` : `${amount} ${many}`);

/** Names in a sentence: "Notes", "Notes and Style", "Notes, Style and Code". */
const listed = (names: readonly string[]): string => (names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`);

/** A file's name in a sentence: without its extension, as the page names its table. */
const named = (file: string): string => file.replace(/\.csv$/, "");

const notExported = (file: string): string => `${named(file)} was not exported: ${WITHOUT_FILE.get(file)}.`;

/** One of the export's files as the map reads it: its rows, and each row's cell under a column, by the column's header. */
interface Table<Column extends string> {
  /** The name the page shows for the file, which is where a node says it comes from. */
  label: string;
  rows: readonly Row[];
  has(column: Column): boolean;
  /** The cell's text: nothing where the file has no such column, or the row no such cell. */
  cell(row: Row, column: Column): string;
  /** In a sentence each, what the map lacks for the columns the file does not have. A file without rows lacks nothing. */
  lacks: string[];
}

function tableOf<Column extends string>(tables: readonly ResultTable[], reads: Reads<Column>): Table<Column> | undefined {
  const table = tables.find(candidate => candidate?.file === reads.file);
  if (!table) return undefined;
  const headers: readonly unknown[] = Array.isArray(table.headers) ? table.headers : [];
  const rows: readonly Row[] = Array.isArray(table.rows) ? table.rows.map(row => (Array.isArray(row) ? row : [])) : [];
  // The first column is the row's name, whatever its header: a column the map reads is the first of its name after it.
  const at = new Map<Column, number>();
  for (const [column] of reads.columns) {
    const index = headers.indexOf(column, 1);
    if (index > 0) at.set(column, index);
  }
  const lacks: string[] = [];
  if (rows.length) {
    const details: string[] = [];
    for (const [column, without] of reads.columns) {
      if (at.has(column) || without === null) continue;
      if (without === undefined) details.push(column);
      else lacks.push(`${named(reads.file)} has no ${column} column: ${without}.`);
    }
    const [columns, them] = details.length === 1 ? ["column", "it"] : ["columns", "them"];
    if (details.length) lacks.push(`${named(reads.file)} has no ${listed(details)} ${columns}: ${reads.objects} come without ${them}.`);
  }
  return {
    label: textOf(table.label), rows, lacks,
    has: column => at.has(column),
    cell: (row, column) => {
      const index = at.get(column);
      return index === undefined ? "" : textOf(row[index]);
    },
  };
}

/** A field of a definition as text: `otherwise` where the cell holds no definition or the definition no such field, and
 * where the field holds something that is no text. A field that is there and null says nothing. */
function fieldOf(definition: Record<string, unknown> | undefined, name: string, otherwise: string): string {
  if (!definition || !Object.hasOwn(definition, name)) return otherwise;
  const value = definition[name];
  return typeof value === "string" ? value : value === null ? "" : otherwise;
}

/** A heading's name as its group's: without the spaces and dashes at its two ends. */
const groupOf = (heading: string): string => stripChars(heading, " -") || UNGROUPED;

/** What a node says beyond what every node has. */
type Details = Omit<GraphNode, "id" | "kind" | "name" | "file" | "row">;

/** The graph while it is made: its nodes, its links and the names that matched nothing, and every object the export can
 * name, by the name it is named with. A line item is named by its module's name and its own, and a list's property by its
 * list's name and its own. */
class Draft {
  readonly nodes: GraphNode[] = [];
  readonly unresolved: Unresolved[] = [];
  readonly lists = new Map<string, number>();
  readonly subsets = new Map<string, number>();
  readonly modules = new Map<string, number>();
  readonly processes = new Map<string, number>();
  readonly items = new Map<string, Map<string, number>>();
  readonly properties = new Map<string, Map<string, number>>();
  private readonly edges = new Map<string, GraphEdge>();

  /** A new node, numbered by its place. Of its details, one that says nothing is left out: a value that is not there, and
   * an empty text. Its name is kept whatever it holds. */
  add(node: Pick<GraphNode, "kind" | "name" | "file" | "row">, details: Details = {}): number {
    const id = this.nodes.length;
    const said = Object.fromEntries(Object.entries(details).filter(([, value]) => value !== undefined && value !== "")) as Details;
    this.nodes.push({ id, ...node, ...said });
    return id;
  }

  /** A link, which the graph holds once however often the export says it. */
  link(from: number, to: number, kind: EdgeKind): void {
    const key = `${from} ${to} ${kind}`;
    if (!this.edges.has(key)) this.edges.set(key, [from, to, kind]);
  }

  /** A name in `field` of the row of `source` that matched no object. */
  missing(source: number, field: string, reference: string): void {
    this.unresolved.push({ source, field, reference });
  }

  /** A dimension by its name: a list, or else a list's subset. */
  dimension(name: string): number | undefined {
    return this.lists.get(name) ?? this.subsets.get(name);
  }

  /** What a reference names. A bare name is a line item of `inModule` first, then a module, a list or a subset. A name
   * behind another and a dot is that module's line item, or that list's property. */
  resolve(reference: string, inModule?: string): number | undefined {
    const parts = splitOutside(reference, ".");
    if (parts.length === 1) {
      const name = unquote(parts[0]);
      const own = inModule === undefined ? undefined : this.items.get(inModule)?.get(name);
      return own ?? this.modules.get(name) ?? this.dimension(name);
    }
    if (parts.length === 2) {
      const [owner, name] = parts.map(unquote);
      return this.items.get(owner)?.get(name) ?? this.properties.get(owner)?.get(name);
    }
    return undefined;
  }

  /** The links in their fixed order: by first node, second node and kind. */
  links(): GraphEdge[] {
    return [...this.edges.values()].sort((a, b) => a[0] - b[0] || a[1] - b[1] || (a[2] < b[2] ? -1 : a[2] > b[2] ? 1 : 0));
  }
}

/** What was read of a file: its table, where the export has the file, the row each of its lists, modules or line items
 * was read from, and what the map says of what the file lacks and of what was left out of it. */
interface Read<Column extends string> {
  table: Table<Column> | undefined;
  rows: Map<number, Row>;
  says: string[];
}

/** General Lists: the lists under their headings, then each list's subsets and properties. */
function readLists(draft: Draft, tables: readonly ResultTable[]): Read<ListColumn> {
  const table = tableOf(tables, LISTS);
  const rows = new Map<number, Row>();
  if (!table) return { table, rows, says: [notExported(LISTS_FILE)] };
  const says = [...table.lacks];
  let group = UNGROUPED;
  let repeated = 0;
  table.rows.forEach((row, index) => {
    const name = textOf(row[0]);
    if (separator(name)) {
      group = groupOf(name);
      return;
    }
    if (draft.lists.has(name)) {
      repeated++;
      return;
    }
    const id = draft.add({ kind: "list", name, file: table.label, row: index + 1 }, { group, topLevel: table.cell(row, "Top Level"), count: integer(table.cell(row, "Item Count")),
      numbered: table.has("Numbered") ? table.cell(row, "Numbered") === "true" : undefined, notes: table.cell(row, "Notes"), displayName: table.cell(row, "Display Name Property") });
    draft.lists.set(name, id);
    rows.set(id, row);
  });
  if (repeated) says.push(`${count(repeated, "row of General Lists repeats the name of a list above it and is", "rows of General Lists repeat the name of a list above them and are")} left out.`);

  let repeatedSubsets = 0;
  for (const [listName, list] of draft.lists) {
    const row = rows.get(list)!;
    // Both carry their list's row and its group.
    const from = { file: table.label, row: draft.nodes[list].row };
    const under = { group: draft.nodes[list].group, parent: list };
    // A subset is named as its list's cell writes it.
    for (const name of splitOutside(table.cell(row, "Subsets"))) {
      if (draft.subsets.has(name)) {
        repeatedSubsets++;
        continue;
      }
      const subset = draft.add({ kind: "subset", name, ...from }, under);
      draft.subsets.set(name, subset);
      draft.link(list, subset, "subset");
    }
    const ofList = new Map<string, number>();
    for (const property of splitOutside(table.cell(row, "Properties"))) {
      const match = PROPERTY.exec(property);
      if (match) ofList.set(match[1], draft.add({ kind: "property", name: match[1], ...from }, { ...under, format: match[2] }));
    }
    draft.properties.set(listName, ofList);
  }
  if (repeatedSubsets) says.push(`${count(repeatedSubsets, "list subset has the name of a subset before it and is", "list subsets have the name of a subset before them and are")} left out.`);
  return { table, rows, says };
}

/** The names of the model's modules, where the export's Modules file lists any, and whether the export has the file. */
function moduleNamesOf(tables: readonly ResultTable[]): { names: Set<string> | undefined; exported: boolean } {
  const table = tables.find(candidate => candidate?.file === MODULES_FILE);
  const rows: readonly unknown[] = table && Array.isArray(table.rows) ? table.rows : [];
  return { names: rows.length ? new Set(rows.map(row => textOf(Array.isArray(row) ? row[0] : ""))) : undefined, exported: table !== undefined };
}

/** What was read of Line Items, and for each line item formatted as a list, that list's ID, from the line item's Format. */
type LineItemsRead = Read<LineItemColumn> & { formatIds: Map<number, string> };

/** Line Items: each module's own row under its heading, then the module's line items. */
function readLineItems(draft: Draft, tables: readonly ResultTable[]): LineItemsRead {
  const table = tableOf(tables, LINE_ITEMS);
  const rows = new Map<number, Row>();
  const formatIds = new Map<number, string>();
  if (!table) return { table, rows, formatIds, says: [notExported(LINE_ITEMS_FILE)] };
  const says = [...table.lacks];

  // Whether a name is a module's, as far as the Modules file says: the file lists it, or a line item of this file gives
  // it as its module. Without the file's names any name may be a module's (results/line-items-view.ts `moduleNamed`).
  const { names: moduleNames, exported } = moduleNamesOf(tables);
  if (moduleNames) {
    for (const row of table.rows) {
      const inModule = table.cell(row, "Module Name");
      if (inModule.trim() !== "") moduleNames.add(inModule);
    }
  } else if (table.rows.length) {
    says.push(`${exported ? "Modules lists no modules" : "Modules was not exported"}, so a row of Line Items that holds only a name is taken for a module's own row.`);
  }

  let group = UNGROUPED;
  const headings = new Set<string>();
  const left = { modules: 0, unknown: 0, headed: 0, orphans: 0, items: 0 };
  table.rows.forEach((row, index) => {
    const name = textOf(row[0]);
    const inModule = table.cell(row, "Module Name");
    if (inModule.trim() === "") {
      // A line item whose module the file does not say: it has what only a line item has, or its name is no module's.
      if (LINE_ITEM_HAS.some(column => table.cell(row, column).trim() !== "") || (moduleNames && !moduleNames.has(name))) left.unknown++;
      else if (separator(name)) {
        group = groupOf(name);
        headings.add(name);
      } else if (draft.modules.has(name)) left.modules++;
      else {
        const id = draft.add({ kind: "module", name, file: table.label, row: index + 1 }, { group, notes: table.cell(row, "Notes"), cells: integer(table.cell(row, "Cell Count")),
          timeScale: table.cell(row, "Time Scale"), timeRange: table.cell(row, "Time Range"), versions: table.cell(row, "Versions") });
        draft.modules.set(name, id);
        rows.set(id, row);
      }
      return;
    }
    const owner = draft.modules.get(inModule);
    if (owner === undefined) {
      if (headings.has(inModule)) left.headed++;
      else left.orphans++;
      return;
    }
    let ofModule = draft.items.get(inModule);
    if (!ofModule) draft.items.set(inModule, ofModule = new Map());
    if (ofModule.has(name)) {
      left.items++;
      return;
    }
    const formatCell = table.cell(row, "Format");
    const format = definitionOf(formatCell);
    const id = draft.add({ kind: "lineItem", name, file: table.label, row: index + 1 }, { module: owner, group: draft.nodes[owner].group, formula: table.cell(row, "Formula"),
      format: fieldOf(format, "dataType", formatCell), cells: integer(table.cell(row, "Cell Count")), notes: table.cell(row, "Notes"), style: table.cell(row, "Style"),
      timeScale: table.cell(row, "Time Scale"), timeRange: table.cell(row, "Time Range"), versions: table.cell(row, "Versions"), code: table.cell(row, "Code"),
      summary: fieldOf(definitionOf(table.cell(row, "Summary")), "summaryMethod", "") });
    ofModule.set(name, id);
    rows.set(id, row);
    // Only a list format names a list (model/lineitems.ts): an ID that another format still carries is no one's.
    const listId = format?.dataType === "ENTITY" ? idOf(format.hierarchyEntityLongId) : undefined;
    if (listId !== undefined) formatIds.set(id, listId);
  });

  if (left.modules) says.push(`${count(left.modules, "row of Line Items repeats the name of a module above it and is", "rows of Line Items repeat the name of a module above them and are")} left out.`);
  if (left.unknown) says.push(`${count(left.unknown, "row of Line Items is no module's own and names no module: it is", "rows of Line Items are no module's own and name no module: they are")} left out.`);
  if (left.headed) {
    says.push(`${count(left.headed, "line item names a heading row as its module and is", "line items name a heading row as their module and are")} left out: a heading is no module on the map.`);
  }
  if (left.orphans) {
    says.push(`${count(left.orphans, "line item names a module that has no row above it in Line Items and is", "line items name a module that has no row above them in Line Items and are")} left out.`);
  }
  if (left.items) {
    says.push(`${count(left.items, "line item has the name of a line item above it in the same module and is", "line items have the name of a line item above them in the same module and are")} left out.`);
  }
  return { table, rows, formatIds, says };
}

/** A list by an ID, among the lists known for it so far. */
function foundFor(known: Map<string, Set<number>>, listId: string, list: number): void {
  const lists = known.get(listId);
  if (lists) lists.add(list);
  else known.set(listId, new Set([list]));
}

/** General Lists again, now that the modules and line items are there: each list's parent, and what its three Referenced
 * columns name. It gives back, for each list ID, the lists whose Referenced as Format names a line item with that ID in
 * its Format. */
function linkLists(draft: Draft, { table, rows }: Read<ListColumn>, formatIds: ReadonlyMap<number, string>): Map<string, Set<number>> {
  const referencedAs = new Map<string, Set<number>>();
  if (!table) return referencedAs;
  for (const [list, row] of rows) {
    const parent = table.cell(row, "Parent Hierarchy");
    if (parent !== "") {
      const target = draft.dimension(parent);
      if (target === undefined) draft.missing(list, "Parent Hierarchy", parent);
      else {
        draft.nodes[list].parent = target;
        draft.link(target, list, "parent");
      }
    }
    for (const [column, kind] of LIST_REFERENCES) {
      for (const reference of splitOutside(table.cell(row, column))) {
        const target = draft.resolve(reference);
        if (target === undefined) {
          draft.missing(list, column, reference);
          continue;
        }
        draft.link(list, target, kind);
        const listId = kind === "format" ? formatIds.get(target) : undefined;
        if (listId !== undefined) foundFor(referencedAs, listId, list);
      }
    }
  }
  return referencedAs;
}

/** Which list has which ID. The export's Format List column says it outright, by the list's name beside a Format that
 * holds the ID. For an ID it names no list for, the prototype's rule: `referencedAs`. An ID that either gives to two lists
 * is no one's: the prototype stops there, and the map does not choose between them. */
function listIds(draft: Draft, { table, rows, formatIds }: LineItemsRead, referencedAs: ReadonlyMap<string, Set<number>>): { listOfId: Map<string, number>; says: string[] } {
  const namedAs = new Map<string, Set<number>>();
  if (table?.has("Format List")) {
    for (const [item, listId] of formatIds) {
      const list = draft.lists.get(table.cell(rows.get(item)!, "Format List"));
      if (list !== undefined) foundFor(namedAs, listId, list);
    }
  }
  const listOfId = new Map<string, number>();
  let shared = 0;
  const settle = (lists: Set<number>, listId: string): void => {
    if (lists.size === 1) listOfId.set(listId, [...lists][0]);
    else shared++;
  };
  namedAs.forEach(settle);
  referencedAs.forEach((lists, listId) => {
    if (!namedAs.has(listId)) settle(lists, listId);
  });
  return { listOfId, says: shared ? [`${count(shared, "list ID stands for more than one list in the export, and names", "list IDs each stand for more than one list in the export, and name")} none on the map.`] : [] };
}

/** Line Items again, now that every object is there: each module's and line item's dimensions and access drivers, each
 * line item's list, and what refers to each line item. */
function linkLineItems(draft: Draft, { table, rows, formatIds }: LineItemsRead, listOfId: ReadonlyMap<string, number>): void {
  if (!table) return;
  for (const [id, row] of rows) {
    const node = draft.nodes[id];
    const isItem = node.kind === "lineItem";
    const owner = node.module === undefined ? node : draft.nodes[node.module];
    const ownerRow = rows.get(owner.id)!;

    // A line item with a dash has no dimensions of its own: it has its module's.
    let appliesTo = table.cell(row, "Applies To");
    if (isItem && appliesTo === "-") {
      appliesTo = table.cell(ownerRow, "Applies To");
      node.inheritsDimensions = true;
    }
    const dimensions: number[] = [];
    for (const reference of splitOutside(appliesTo)) {
      const target = draft.dimension(unquote(reference));
      if (target === undefined) draft.missing(id, "Applies To", reference);
      else {
        dimensions.push(target);
        draft.link(target, id, "applies");
      }
    }
    if (dimensions.length) node.dimensions = dimensions;

    // And one with a dash for a driver has its module's.
    for (const [column, kind] of DRIVERS) {
      let driver = table.cell(row, column);
      if (isItem && driver === "-") driver = table.cell(ownerRow, column);
      if (driver === "" || driver === "-") continue;
      const target = draft.resolve(driver, owner.name);
      if (target === undefined) draft.missing(id, column, driver);
      else draft.link(target, id, kind);
    }
    if (!isItem) continue;

    const formatList = table.cell(row, "Format List");
    const listId = formatIds.get(id);
    const list = formatList !== "" ? draft.lists.get(formatList) : listId === undefined ? undefined : listOfId.get(listId);
    if (list !== undefined) {
      node.formatList = list;
      draft.link(list, id, "format");
    } else if (formatList !== "") draft.missing(id, "Format List", formatList);

    for (const reference of splitOutside(table.cell(row, "Referenced By"))) {
      const target = draft.resolve(reference, owner.name);
      if (target === undefined) {
        draft.missing(id, "Referenced By", reference);
        continue;
      }
      // Where what refers to the line item names it as its own access driver, that is the link, and no formula link. The
      // driver is read in the module of the one that has it.
      const referrer = draft.nodes[target];
      const inModule = referrer.module === undefined ? owner.name : draft.nodes[referrer.module].name;
      // Only a module and a line item have a row of this file, and so a driver.
      const referrerRow = rows.get(target) ?? [];
      let drives = false;
      for (const [column, kind] of DRIVERS) {
        const driver = table.cell(referrerRow, column);
        if (driver === "" || driver === "-" || draft.resolve(driver, inModule) !== id) continue;
        draft.link(id, target, kind);
        drives = true;
      }
      if (!drives) draft.link(id, target, "reference");
    }
  }
}

/** Processes: each row but a heading. It gives back the length of the longest process name, for `knownSequence`. */
function readProcesses(draft: Draft, tables: readonly ResultTable[]): { longest: number; says: string[] } {
  const table = tableOf(tables, PROCESSES);
  if (!table) return { longest: 0, says: [notExported(PROCESSES_FILE)] };
  const says = [...table.lacks];
  let longest = 0;
  let repeated = 0;
  table.rows.forEach((row, index) => {
    const name = textOf(row[0]);
    if (separator(name)) return;
    if (draft.processes.has(name)) {
      repeated++;
      return;
    }
    draft.processes.set(name, draft.add({ kind: "process", name, file: table.label, row: index + 1 }, { notes: table.cell(row, "Notes") }));
    longest = Math.max(longest, name.length);
  });
  if (repeated) says.push(`${count(repeated, "row of Processes repeats the name of a process above it and is", "rows of Processes repeat the name of a process above them and are")} left out.`);
  return { longest, says };
}

/** Links an action to what it loads into, takes from or works on, as its row says. It gives back whether the row says
 * any target at all, or the file has no column that could: an action that could name its target and names none is counted. */
type TargetOf = (draft: Draft, action: number, table: Table<ActionColumn>, row: Row) => boolean;

/** What a file of actions is read as: what its actions are, where their definitions do not say; how an action's target
 * is read; and for a file whose every action has a target, what the map says of the one, or the many, that name none. */
interface ActionsAs {
  kind?: string;
  target: TargetOf;
  untargeted?: readonly [one: string, many: string];
}

/** One file of actions: each row but a heading, linked to the processes that use it and to its target. `present` is
 * whether the export has the file. */
function readActions(draft: Draft, tables: readonly ResultTable[], reads: Reads<ActionColumn>, longestProcess: number, as: ActionsAs): { present: boolean; says: string[] } {
  const table = tableOf(tables, reads);
  if (!table) return { present: false, says: [notExported(reads.file)] };
  let untargeted = 0;
  table.rows.forEach((row, index) => {
    const name = textOf(row[0]);
    if (separator(name)) return;
    const definition = table.cell(row, "Action");
    const id = draft.add({ kind: "action", name, file: table.label, row: index + 1 }, { actionType: as.kind ?? fieldOf(definitionOf(definition), "actionType", "Other"), action: definition,
      notes: table.cell(row, "Notes"), lastRun: table.cell(row, "Start Date and Time (UTC)"), durationMs: integer(table.cell(row, "Most recent duration (ms)")) });
    for (const processName of knownSequence(table.cell(row, "Used in Processes"), draft.processes, longestProcess)) {
      const process = draft.processes.get(processName);
      if (process === undefined) draft.missing(id, "Used in Processes", processName);
      else draft.link(process, id, "process_action");
    }
    if (!as.target(draft, id, table, row)) untargeted++;
  });
  return { present: true, says: untargeted && as.untargeted ? [...table.lacks, `${count(untargeted, ...as.untargeted)}.`] : table.lacks };
}

/** An import's target, from the Imports tab's own columns. Target Type tells a module from a list where it says which of
 * the two the target is. Where it says neither, a module of the name comes before a list of it, as in the prototype. */
const targetOfImport: TargetOf = (draft, action, table, row) => {
  const written = table.cell(row, "Target Object");
  if (written === "") return !table.has("Target Object");
  const type = table.cell(row, "Target Type").trim().toLowerCase();
  const find = (name: string): number | undefined =>
    (type === "module" ? draft.modules.get(name) : type === "list" ? draft.lists.get(name) : draft.modules.get(name) ?? draft.lists.get(name));
  const target = find(written) ?? find(unquote(written));
  if (target === undefined) draft.missing(action, "Target Object", written);
  else draft.link(action, target, "import_target");
  return true;
};

/** What an action's Action cell says of its target: in words ("Export from 'Prices'"), or as a definition that names
 * lists by their IDs, which `listOfId` knows. */
const targetInAction = (listOfId: ReadonlyMap<string, number>): TargetOf => (draft, action, table, row) => {
  const definition = table.cell(row, "Action");
  const words = ACTION_TARGET.exec(definition);
  if (words) {
    const target = draft.modules.get(words[2]) ?? draft.lists.get(words[2]);
    if (target === undefined) draft.missing(action, "Action", words[2]);
    else if (words[1] === "Import into") draft.link(action, target, "import_target");
    else draft.link(target, action, "export_source");
    return true;
  }
  let named = !table.has("Action");
  const detail = definitionOf(definition) ?? {};
  for (const field of LIST_IDENTIFIERS) {
    // The ID as the definition writes it, between underscores or not. A field that is empty or zero names no list.
    const value = Object.hasOwn(detail, field) ? detail[field] : undefined;
    if (!((typeof value === "string" && value !== "") || (typeof value === "number" && value !== 0))) continue;
    const listId = stripChars(String(value), "_");
    const target = listOfId.get(listId);
    if (target === undefined) draft.missing(action, field, listId);
    else draft.link(action, target, "action_target");
    named = true;
  }
  return named;
};

function build(tables: readonly ResultTable[]): ModelGraph {
  const draft = new Draft();
  // In the prototype's order. A column that names objects is read once every object it can name is there.
  const lists = readLists(draft, tables);
  const lineItems = readLineItems(draft, tables);
  const ids = listIds(draft, lineItems, linkLists(draft, lists, lineItems.formatIds));
  linkLineItems(draft, lineItems, ids.listOfId);
  const processes = readProcesses(draft, tables);
  const imports = readActions(draft, tables, IMPORTS, processes.longest, { kind: "Import", target: targetOfImport,
    untargeted: ["import is linked to no module or list: its Target Object cell is empty", "imports are linked to no module or list: their Target Object cell is empty"] });
  const exportActions = readActions(draft, tables, EXPORTS, processes.longest, { kind: "Export", target: targetInAction(ids.listOfId),
    untargeted: ["export is linked to no module or list: what it takes could not be read from its Action cell",
      "exports are linked to no module or list: what they take could not be read from their Action cell"] });
  // Many of the other actions work on no list: one that names none is as it should be.
  const otherActions = readActions(draft, tables, OTHER_ACTIONS, processes.longest, { target: targetInAction(ids.listOfId) });
  return {
    nodes: draft.nodes,
    edges: draft.links(),
    unresolved: draft.unresolved,
    // The module sections, in the file's order: each group that a module is in.
    sections: [...new Set(draft.nodes.flatMap(node => (node.kind === "module" && node.group !== undefined ? [node.group] : [])))],
    // What each file lacks and what was left out of it, in the files' order, then what the map always says.
    limitations: [...lists.says, ...lineItems.says, ...processes.says, ...imports.says, ...exportActions.says, ...otherActions.says, ...ids.says, ...STANDING,
      ...(imports.present ? [IMPORT_SOURCES] : [])],
  };
}

/** The graph of a model export's tables (`AnalysisResult.tables` of a model). A table that is missing, or lacks a column
 * the map reads, leaves out what it would have given and adds a sentence to `limitations`: it never throws for that, nor
 * for anything else a table holds. Tables that cannot be read at all give a graph of nothing, which says so. The same
 * tables always give the same graph. */
export function buildModelGraph(tables: readonly ResultTable[]): ModelGraph {
  try {
    return build(tables);
  } catch (error) {
    return { nodes: [], edges: [], unresolved: [], sections: [], limitations: [`The map could not be made from this export's tables (${message(error)}).`] };
  }
}
