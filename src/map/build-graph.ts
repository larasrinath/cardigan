import { textOf as plainText } from "../result-plain.js";
import type { Cell, ResultTable } from "../result-types.js";
import { message } from "../util.js";
import { definitionOf, idOf, integer, knownNames, knownSequence, nothing, separator, splitOutside, stripChars, unquote, type KnownNames } from "./graph-names.js";
import type { EdgeKind, GraphEdge, GraphNode, ModelGraph, Unresolved } from "./graph-types.js";

/** The model map's graph, made from the tables of a model export and from nothing else. It started as the owner's
 * prototype builder (build_model_data.py) in the export's own tables. The prototype read three of Anaplan's CSV exports:
 * General Lists, Line Items and Actions. Each of the export's files is laid out as Anaplan's own export of the same grid,
 * so the columns read here are the ones the prototype read, under the same names. How the names in a cell are read is in
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
 * A link never lands on an object the export does not name. The prototype looked a name up among every kind of object,
 * and took the first it found. Here a column's names are looked up only among what that column can name (a driver is a
 * line item, a dimension a list or a subset), a name that two such objects share is no one's, and a cell that reads two
 * ways is not read. Each of those is unresolved, as a name that matches nothing is. One shared name is read all the same,
 * and counted: a name behind another and a dot that is both a module's line item and a list's property is the line
 * item's. A module is often named as its list is, formulas of line items far outnumber those of properties, and left
 * unresolved such a model would lose formula links that are there.
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
 * does without, and says nothing of. `also` has the other headers a column may come under. The row's name is the file's
 * first column, which has no header. */
interface Reads<Column extends string> {
  file: string;
  objects: string;
  columns: readonly (readonly [column: Column, without?: string | null])[];
  also?: Partial<Record<Column, readonly string[]>>;
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
  // The prototype read the shorter headers from Anaplan's own export of the grid. The longer ones are the grid's own
  // labels in other places, and which of the two a model's file has is not settled.
  also: { "Top Level": ["Top Level Item"], Numbered: ["Numbered List"] },
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
    // The export's own columns (model/lineitems.ts). A file from before the export had Format List is read by the
    // prototype's rule; the two that name what a Ratio summary divides only say more of a line item, where they are there.
    ["Format List", null], ["Ratio Numerator", null], ["Ratio Denominator", null]],
} as const satisfies Reads<string>;
type LineItemColumn = (typeof LINE_ITEMS)["columns"][number][0];

const PROCESSES = { file: PROCESSES_FILE, objects: "processes", columns: [["Notes"]] } as const satisfies Reads<string>;

/** The Imports tab's columns that say where an import takes its data from. The map does not draw a source: it only says
 * where one is to be found, and says it of a file that has one of these. */
const SOURCE_COLUMNS = ["Source Label", "Source Object", "Source Type"] as const;

/** The columns a file of actions can have: the Actions list's own, and for an import the Imports tab's for its source
 * and its target. */
type ActionColumn = "Action" | "Target Object" | "Target Type" | "Used in Processes" | "Notes" | "Start Date and Time (UTC)" | "Most recent duration (ms)" | (typeof SOURCE_COLUMNS)[number];
/** An action's notes and its last run. */
const RUN_COLUMNS = [["Notes"], ["Start Date and Time (UTC)"], ["Most recent duration (ms)"]] as const;

const IMPORTS: Reads<ActionColumn> = {
  file: IMPORTS_FILE, objects: "imports",
  columns: [
    ["Target Object", "the map does not say what an import loads into"],
    // It says whether the target is a module or a list. Without it, a name that only one of the two has is that one's.
    ["Target Type", null],
    ["Used in Processes", "the map does not say which processes run an import"],
    ...RUN_COLUMNS,
    ...SOURCE_COLUMNS.map(column => [column, null] as const)],
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

/** What no export says, and what the map does not do with what one says. The prototype said these of its three files;
 * its fourth, that the files name neither the model nor its workspace, is not true of the export. Each is said only of
 * an export it is true of: the first two of one that has the lists, and the actions with their processes, to say it of. */
const LIST_ITEMS = "The export gives the number of items in each list, not the items.";
/** The same of a General Lists file that has no Item Count column. */
const NO_LIST_ITEMS = "The export does not give the items of a list.";
const PROCESS_ORDER = "The export says which processes use an action, not the order in which a process runs its actions.";
const LINKS = "Every link comes from a column of the export that names another object: formulas are kept as text and are not worked out.";
/** The prototype's files did not say where an import takes its data from. The export does, in a file the map does not draw. */
const IMPORT_SOURCES = "Where an import takes its data from is in the Imports table, not on the map.";

/** The columns that hold what only a line item has: a module's own row has none of the three (results/line-items-view.ts). */
const LINE_ITEM_HAS = ["Format", "Formula", "Summary"] as const;

/** The data type of a format that is a list's, which is also what a line item's node says for its format. */
const LIST_FORMAT = "ENTITY";

/** What a column's references can name. A name behind another and a dot is that module's line item wherever such a
 * reference is read; these say what else a column may name. */
interface Names {
  /** The module of the row: a bare name is a line item of that module before it is anything else. */
  inModule?: string;
  /** A bare name may be a module's. */
  module?: boolean;
  /** A name behind another and a dot may be that list's property. */
  property?: boolean;
}

/** A list's columns that name what uses it, each with the link from the list to what the column names, and with what
 * it can name beside a line item: a list applies to a module, and is the format, or in the formula, of a list's property. */
const LIST_REFERENCES = [["Referenced in Applies To", "applies", { module: true }], ["Referenced as Format", "format", { property: true }],
  ["Referenced in Formula", "list_formula", { property: true }]] as const;

/** The columns that name what drives who may read and who may write a module or a line item, each with its link. A
 * driver is a line item. The export's Dynamic Cell Access table is made of these links (model/access.ts), and knows the
 * two columns from here. */
export const DRIVERS = [["Read Access Driver", "read_access"], ["Write Access Driver", "write_access"]] as const;

/** Whether a driver cell says something: it is not empty, and not the dash that stands for no driver of the row's own. */
const drives = (written: string): boolean => written !== "" && written !== "-";

/** The fields of an action's definition that name a list by its ID. */
const LIST_IDENTIFIERS = ["hierarchyIdentifier", "sourceHierarchyIdentifier", "targetHierarchyIdentifier"] as const;

/** An Action cell that says its target in words, and nothing else: the prototype read an import's and an export's
 * target so, from Anaplan's own Actions file ("Import into 'Prices'"). */
const ACTION_TARGET = /^(Import into|Export from) (\S[^\n]*)$/;

/** A list's property in the Properties cell: its name, a colon and white space, then its format. A name may hold a colon
 * itself: the last colon that white space follows is the one before the format. */
const PROPERTY = /^([^\n]+):\s+([^\n]*)/;

type Row = readonly Cell[];

/** A cell as text: nothing for a cell that is not there. */
const textOf = (cell: unknown): string => (cell === null || cell === undefined ? "" : plainText(cell));

const count = (amount: number, one: string, many: string): string => (amount === 1 ? `1 ${one}` : `${amount} ${many}`);

/** Names in a sentence: "Notes", "Notes and Style", "Notes, Style and Code". */
const listed = (names: readonly string[]): string => (names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`);

/** A file's name in a sentence: without its extension, as the page names its table. */
const named = (file: string): string => file.replace(/\.csv$/, "");

const notExported = (file: string): string => `${named(file)} was not exported: ${WITHOUT_FILE.get(file)}.`;

/** The rows of a file of processes or actions that are named as a heading is. In Anaplan's own Actions file such a row
 * divides the list, and the prototype took it for no object; the map keeps to that, and says how many it left out. */
const headingRows = (file: string, amount: number): string =>
  `${count(amount, `row of ${named(file)} is named as a heading is and is`, `rows of ${named(file)} are named as headings are and are`)} left out.`;

/** One of the export's files as the map reads it: its rows, and each row's cell under a column, by the column's header. */
interface Table<Column extends string> {
  /** The name the page shows for the file: what a node carries as where it comes from. */
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
  // Read row by row, so that a hole among the rows is a row with nothing in it: `map` would leave the hole.
  const rows: readonly Row[] = Array.isArray(table.rows) ? Array.from(table.rows, (row: unknown) => (Array.isArray(row) ? row as Row : [])) : [];
  // The first column is the row's name, whatever its header: a column the map reads is the first of its name after it,
  // and under another header only where the file has none of its own.
  const at = new Map<Column, number>();
  for (const [column] of reads.columns) {
    const index = [column, ...(reads.also?.[column] ?? [])].map(header => headers.indexOf(header, 1)).find(place => place > 0);
    if (index !== undefined) at.set(column, index);
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

/** A row's number in its file as a spreadsheet numbers it: the header is row 1, so the first row of data is row 2. */
const rowNumber = (index: number): number => index + 2;

/** A field of a definition as text: `otherwise` where the cell holds no definition or the definition no such field, and
 * where the field holds something that is no text. A field that is there and null says nothing. */
function fieldOf(definition: Record<string, unknown> | undefined, name: string, otherwise: string): string {
  if (!definition || !Object.hasOwn(definition, name)) return otherwise;
  const value = definition[name];
  return typeof value === "string" ? value : value === null ? "" : otherwise;
}

/** A heading's name as its group's: without the spaces and dashes at its two ends. */
const groupOf = (heading: string): string => stripChars(heading, " -") || UNGROUPED;

/** The one object among those a name could be. A name that is no one's is none, and so is a name that two of them
 * have: nothing in the export tells which of the two is meant, and the map does not choose. */
function only(...found: (number | undefined)[]): number | undefined {
  const those = found.filter(each => each !== undefined);
  return those.length === 1 ? those[0] : undefined;
}

/** The one object a cell that holds a single name stands for, among those `among` gives for a name: the cell as it is
 * written, and only where nothing has that name, the cell out of its quotes. */
function onlyNamed(written: string, among: (name: string) => (number | undefined)[]): number | undefined {
  return among(written).some(each => each !== undefined) ? only(...among(written)) : only(...among(unquote(written)));
}

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
  /** The line items taken for a name that a list's property has as well: see `resolve`. Each is one such name. */
  readonly sharedWithProperty = new Set<number>();
  private readonly edges = new Map<string, GraphEdge>();
  private readonly missed = new Set<string>();

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

  /** A name in `field` of the row of `source` that stands for no object, or for two. It is recorded once for the cell
   * that holds it, however often the cell says it. */
  missing(source: number, field: string, reference: string): void {
    const key = `${source}\n${field}\n${reference}`;
    if (this.missed.has(key)) return;
    this.missed.add(key);
    this.unresolved.push({ source, field, reference });
  }

  /** A dimension by its name: a list, or a list's subset. */
  dimension(name: string): number | undefined {
    return only(this.lists.get(name), this.subsets.get(name));
  }

  /** What a reference names, among what its column can name. A bare name is a line item of the row's own module, or
   * else a module. A name behind another and a dot is that module's line item, or that list's property. Where a module
   * and a list have the first name, and a line item of the one and a property of the other the second, it is the line
   * item, and the name is kept to be counted: nothing in the export tells the two apart. A reference of more parts
   * names nothing. */
  resolve(reference: string, can: Names): number | undefined {
    const parts = splitOutside(reference, ".");
    if (parts.length === 1) {
      const name = unquote(parts[0]);
      const own = can.inModule === undefined ? undefined : this.items.get(can.inModule)?.get(name);
      return own ?? (can.module ? this.modules.get(name) : undefined);
    }
    if (parts.length === 2) {
      const [owner, name] = parts.map(unquote);
      const item = this.items.get(owner)?.get(name);
      const property = can.property ? this.properties.get(owner)?.get(name) : undefined;
      if (item !== undefined && property !== undefined) this.sharedWithProperty.add(item);
      return item ?? property;
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
    const id = draft.add({ kind: "list", name, file: table.label, row: rowNumber(index) }, { group, topLevel: table.cell(row, "Top Level"), count: integer(table.cell(row, "Item Count")),
      numbered: table.has("Numbered") ? table.cell(row, "Numbered") === "true" : undefined, notes: table.cell(row, "Notes"), displayName: table.cell(row, "Display Name Property") });
    draft.lists.set(name, id);
    rows.set(id, row);
  });
  if (repeated) says.push(`${count(repeated, "row of General Lists repeats the name of a list above it and is", "rows of General Lists repeat the name of a list above them and are")} left out.`);

  let repeatedSubsets = 0;
  let unread = 0;
  for (const [listName, list] of draft.lists) {
    const row = rows.get(list)!;
    // Both carry their list's row and its group. Each is named as what refers to it names it: out of its quotes.
    const from = { file: table.label, row: draft.nodes[list].row };
    const under = { group: draft.nodes[list].group, parent: list };
    for (const written of splitOutside(table.cell(row, "Subsets"))) {
      const name = unquote(written);
      if (draft.subsets.has(name)) {
        repeatedSubsets++;
        continue;
      }
      const subset = draft.add({ kind: "subset", name, ...from }, under);
      draft.subsets.set(name, subset);
      draft.link(list, subset, "subset");
    }
    const ofList = new Map<string, number>();
    for (const property of splitOutside(table.cell(row, "Properties"), ",", true)) {
      const match = PROPERTY.exec(property);
      if (match) ofList.set(unquote(match[1]), draft.add({ kind: "property", name: unquote(match[1]), ...from }, { ...under, format: match[2] }));
      else unread++;
    }
    draft.properties.set(listName, ofList);
  }
  if (repeatedSubsets) says.push(`${count(repeatedSubsets, "list subset has the name of a subset before it and is", "list subsets have the name of a subset before them and are")} left out.`);
  if (unread) says.push(`${count(unread, 'part of a Properties cell does not read as "name: format" and is', 'parts of Properties cells do not read as "name: format" and are')} left out.`);
  return { table, rows, says };
}

/** The names of the model's modules, where the export's Modules file lists any, and whether the export has the file. */
function moduleNamesOf(tables: readonly ResultTable[]): { names: Set<string> | undefined; exported: boolean } {
  const table = tables.find(candidate => candidate?.file === MODULES_FILE);
  const rows: readonly unknown[] = table && Array.isArray(table.rows) ? table.rows : [];
  return { names: rows.length ? new Set(Array.from(rows, row => textOf(Array.isArray(row) ? row[0] : ""))) : undefined, exported: table !== undefined };
}

/** What was read of Line Items, and for each line item formatted as a list, that list's ID, from the line item's Format.
 * `moduleless` has the numbers of the rows left out as line items whose module the file does not say: among the rows
 * that name no module, those are the ones that are no module's own (`readAccess`). */
type LineItemsRead = Read<LineItemColumn> & { formatIds: Map<number, string>; moduleless: Set<number> };

/** Line Items: each module's own row under its heading, then the module's line items. */
function readLineItems(draft: Draft, tables: readonly ResultTable[]): LineItemsRead {
  const table = tableOf(tables, LINE_ITEMS);
  const rows = new Map<number, Row>();
  const formatIds = new Map<number, string>();
  const moduleless = new Set<number>();
  if (!table) return { table, rows, formatIds, moduleless, says: [notExported(LINE_ITEMS_FILE)] };
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
      if (LINE_ITEM_HAS.some(column => table.cell(row, column).trim() !== "") || (moduleNames && !moduleNames.has(name))) {
        left.unknown++;
        moduleless.add(rowNumber(index));
      } else if (separator(name)) {
        group = groupOf(name);
        headings.add(name);
      } else if (draft.modules.has(name)) left.modules++;
      else {
        const id = draft.add({ kind: "module", name, file: table.label, row: rowNumber(index) }, { group, notes: table.cell(row, "Notes"), cells: integer(table.cell(row, "Cell Count")),
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
    const summaryCell = table.cell(row, "Summary");
    // Its group is its module's, whatever heading stands nearest above its own row. Its Format and Summary are also kept
    // as the cells hold them, with the names of what a Ratio divides: the map says them in the page's words from those.
    const id = draft.add({ kind: "lineItem", name, file: table.label, row: rowNumber(index) }, { module: owner, group: draft.nodes[owner].group, formula: table.cell(row, "Formula"),
      format: fieldOf(format, "dataType", formatCell), formatCell, cells: integer(table.cell(row, "Cell Count")), notes: table.cell(row, "Notes"), style: table.cell(row, "Style"),
      timeScale: table.cell(row, "Time Scale"), timeRange: table.cell(row, "Time Range"), versions: table.cell(row, "Versions"), code: table.cell(row, "Code"),
      summary: fieldOf(definitionOf(summaryCell), "summaryMethod", ""), summaryCell, ratioNumerator: table.cell(row, "Ratio Numerator"), ratioDenominator: table.cell(row, "Ratio Denominator") });
    ofModule.set(name, id);
    rows.set(id, row);
    // Only a list format names a list (model/lineitems.ts): an ID that another format still carries is no one's.
    const listId = format?.dataType === LIST_FORMAT ? idOf(format.hierarchyEntityLongId) : undefined;
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
  return { table, rows, formatIds, moduleless, says };
}

/** A list for a key, among the lists found for it so far. */
function foundFor<Key>(known: Map<Key, Set<number>>, key: Key, list: number): void {
  const lists = known.get(key);
  if (lists) lists.add(list);
  else known.set(key, new Set([list]));
}

/** What the lists' Referenced as Format columns say of the line items' lists: for each line item, the lists that name
 * it, and for each list ID, the lists that name a line item with that ID in its Format. */
interface FormatsNamed {
  formatOf: Map<number, Set<number>>;
  referencedAs: Map<string, Set<number>>;
}

/** General Lists again, now that the modules and line items are there: each list's parent, and what its three Referenced
 * columns name. */
function linkLists(draft: Draft, { table, rows }: Read<ListColumn>, formatIds: ReadonlyMap<number, string>): FormatsNamed {
  const formatOf = new Map<number, Set<number>>();
  const referencedAs = new Map<string, Set<number>>();
  if (!table) return { formatOf, referencedAs };
  for (const [list, row] of rows) {
    // A parent is one name, a list's or a subset's. The cell is not split: a comma in it is the name's.
    const parent = table.cell(row, "Parent Hierarchy");
    if (!nothing(parent)) {
      const target = onlyNamed(parent, name => [draft.lists.get(name), draft.subsets.get(name)]);
      if (target === undefined) draft.missing(list, "Parent Hierarchy", parent);
      else {
        draft.nodes[list].parent = target;
        draft.link(target, list, "parent");
      }
    }
    for (const [column, kind, names] of LIST_REFERENCES) {
      for (const reference of splitOutside(table.cell(row, column))) {
        const target = draft.resolve(reference, names);
        if (target === undefined) {
          draft.missing(list, column, reference);
          continue;
        }
        draft.link(list, target, kind);
        // Only what the list is the format of says what the list's ID is: a line item it applies to is formatted as another.
        if (kind !== "format") continue;
        foundFor(formatOf, target, list);
        const listId = formatIds.get(target);
        if (listId !== undefined) foundFor(referencedAs, listId, list);
      }
    }
  }
  return { formatOf, referencedAs };
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

/** What drives who may read or who may write a module or a line item: the link's kind, the column and the cell that say
 * it, whether the cell is the row's own or its module's, and the line item the cell names, if it names one. */
interface Driver {
  kind: (typeof DRIVERS)[number][1];
  column: (typeof DRIVERS)[number][0];
  written: string;
  own: boolean;
  target: number | undefined;
}

/** Line Items again, now that every object is there: each module's and line item's dimensions and access drivers, each
 * line item's list, and what refers to each line item. It gives back what the map says of the line items whose list the
 * export does not name.
 *
 * A line item formatted as a list has the list that the Format List column names beside it. Where that names none, it has
 * the one list whose Referenced as Format names the line item (`formatOf`), and failing that the list of the ID in its
 * Format (`listOfId`). */
function linkLineItems(draft: Draft, { table, rows, formatIds }: LineItemsRead, formatOf: ReadonlyMap<number, ReadonlySet<number>>, listOfId: ReadonlyMap<string, number>): string[] {
  if (!table) return [];
  const ownerOf = (node: GraphNode): GraphNode => (node.module === undefined ? node : draft.nodes[node.module]);

  /** The drivers of a module or a line item. A line item with a dash has its module's. The cell is read in the module
   * of the row it is in, which for a module's own row is that module: a bare name is a line item of it. */
  const drivers = new Map<number, Driver[]>();
  const driversOf = (id: number): Driver[] => {
    let found = drivers.get(id);
    if (found) return found;
    const node = draft.nodes[id];
    const owner = ownerOf(node);
    found = [];
    for (const [column, kind] of DRIVERS) {
      let written = table.cell(rows.get(id)!, column);
      const own = !(node.kind === "lineItem" && written === "-");
      if (!own) written = table.cell(rows.get(owner.id)!, column);
      if (drives(written)) found.push({ kind, column, written, own, target: draft.resolve(written, { inModule: owner.name }) });
    }
    drivers.set(id, found);
    return found;
  };

  let unnamed = 0;
  for (const [id, row] of rows) {
    const node = draft.nodes[id];
    const isItem = node.kind === "lineItem";
    const owner = ownerOf(node);

    // A line item with a dash has no dimensions of its own: it has its module's. A name among them that is no
    // dimension's is the module's row's to say, once, and not each such line item's.
    const ownDimensions = table.cell(row, "Applies To");
    const inherits = isItem && ownDimensions === "-";
    if (inherits) node.inheritsDimensions = true;
    const dimensions: number[] = [];
    for (const reference of splitOutside(inherits ? table.cell(rows.get(owner.id)!, "Applies To") : ownDimensions)) {
      const target = draft.dimension(unquote(reference));
      if (target !== undefined) {
        dimensions.push(target);
        draft.link(target, id, "applies");
      } else if (!inherits) draft.missing(id, "Applies To", reference);
    }
    if (dimensions.length) node.dimensions = dimensions;

    // And so with a driver that a line item has from its module.
    for (const driver of driversOf(id)) {
      if (driver.target !== undefined) draft.link(driver.target, id, driver.kind);
      else if (driver.own) draft.missing(id, driver.column, driver.written);
    }
    if (!isItem) continue;

    const formatList = table.cell(row, "Format List");
    const namedBy = node.format === LIST_FORMAT ? [...formatOf.get(id) ?? []] : [];
    const listId = formatIds.get(id);
    const list = formatList !== "" ? draft.lists.get(formatList) : namedBy.length === 1 ? namedBy[0] : listId === undefined ? undefined : listOfId.get(listId);
    if (list !== undefined) {
      node.formatList = list;
      draft.link(list, id, "format");
    } else if (formatList !== "") draft.missing(id, "Format List", formatList);
    else if (node.format === LIST_FORMAT && namedBy.length === 0) unnamed++;

    for (const reference of splitOutside(table.cell(row, "Referenced By"))) {
      const target = draft.resolve(reference, { inModule: owner.name, module: true, property: true });
      if (target === undefined) {
        draft.missing(id, "Referenced By", reference);
        continue;
      }
      // What refers to the line item as its access driver is linked by that, from its own row, and by no formula link:
      // the export has one entry for the two. Only a module and a line item have a row of this file, and so a driver.
      if (!rows.has(target) || !driversOf(target).some(driver => driver.target === id)) draft.link(id, target, "reference");
    }
  }
  return unnamed ? [`${count(unnamed, "line item is formatted as a list that the export does not name, and has", "line items are formatted as a list that the export does not name, and have")} no list on the map.`] : [];
}

/** Processes: each row but those named as headings. It gives back the processes' names, made ready to be found in an
 * action's Used in Processes. */
function readProcesses(draft: Draft, tables: readonly ResultTable[]): { known: KnownNames; says: string[] } {
  const table = tableOf(tables, PROCESSES);
  if (!table) return { known: knownNames([]), says: [notExported(PROCESSES_FILE)] };
  const says = [...table.lacks];
  let headings = 0;
  let repeated = 0;
  table.rows.forEach((row, index) => {
    const name = textOf(row[0]);
    if (separator(name)) headings++;
    else if (draft.processes.has(name)) repeated++;
    else draft.processes.set(name, draft.add({ kind: "process", name, file: table.label, row: rowNumber(index) }, { notes: table.cell(row, "Notes") }));
  });
  if (headings) says.push(headingRows(PROCESSES_FILE, headings));
  if (repeated) says.push(`${count(repeated, "row of Processes repeats the name of a process above it and is", "rows of Processes repeat the name of a process above them and are")} left out.`);
  return { known: knownNames(draft.processes.keys()), says };
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

/** What was read of a file of actions: what the map says of it, whether it has actions and says which processes use
 * them, and whether it has imports and holds where they take their data from. */
interface ActionsRead {
  says: string[];
  usedIn: boolean;
  sources: boolean;
}

/** One file of actions: each row but those named as headings, linked to the processes that use it and to its target. */
function readActions(draft: Draft, tables: readonly ResultTable[], reads: Reads<ActionColumn>, processes: KnownNames, as: ActionsAs): ActionsRead {
  const table = tableOf(tables, reads);
  if (!table) return { says: [notExported(reads.file)], usedIn: false, sources: false };
  const says = [...table.lacks];
  let headings = 0;
  let untargeted = 0;
  table.rows.forEach((row, index) => {
    const name = textOf(row[0]);
    if (separator(name)) {
      headings++;
      return;
    }
    const definition = table.cell(row, "Action");
    const id = draft.add({ kind: "action", name, file: table.label, row: rowNumber(index) }, { actionType: as.kind ?? fieldOf(definitionOf(definition), "actionType", "Other"), action: definition,
      notes: table.cell(row, "Notes"), lastRun: table.cell(row, "Start Date and Time (UTC)"), durationMs: integer(table.cell(row, "Most recent duration (ms)")) });
    // A cell that reads two ways is not read: the whole of it is what could not be told.
    const used = table.cell(row, "Used in Processes");
    const names = knownSequence(used, processes);
    if (!names) draft.missing(id, "Used in Processes", used);
    for (const { name: process, known } of names ?? []) {
      if (known) draft.link(draft.processes.get(process)!, id, "process_action");
      else draft.missing(id, "Used in Processes", process);
    }
    if (!as.target(draft, id, table, row)) untargeted++;
  });
  if (headings) says.push(headingRows(reads.file, headings));
  if (untargeted && as.untargeted) says.push(`${count(untargeted, ...as.untargeted)}.`);
  return { says, usedIn: table.rows.length > 0 && table.has("Used in Processes"), sources: table.rows.length > 0 && SOURCE_COLUMNS.some(column => table.has(column)) };
}

/** An import's target, from the Imports tab's own columns. Target Type says whether it is a module or a list, by the
 * word it holds, in capitals or not ("LIST", "Numbered List"), and then only one of that kind is looked for. A type that
 * holds neither word, or both, says neither: it is of a target the map does not have, and nothing is linked, though a
 * module or a list has the name. Without a type, the name is the one object's that has it, and no one's where a module
 * and a list both do. A dash is an empty cell. */
const targetOfImport: TargetOf = (draft, action, table, row) => {
  const written = table.cell(row, "Target Object");
  if (nothing(written)) return !table.has("Target Object");
  const type = table.cell(row, "Target Type");
  // The type's words: what stands between anything that is no letter.
  const words = type.toLowerCase().split(/[^a-z]+/);
  const [saysModule, saysList] = [words.includes("module"), words.includes("list")];
  const among = (name: string): (number | undefined)[] =>
    (saysModule !== saysList ? [saysModule ? draft.modules.get(name) : draft.lists.get(name)] : type.trim() === "" ? [draft.modules.get(name), draft.lists.get(name)] : []);
  const target = onlyNamed(written, among);
  if (target === undefined) draft.missing(action, "Target Object", written);
  else draft.link(action, target, "import_target");
  return true;
};

/** What an action's Action cell says of its target: in words ("Export from 'Prices'"), or as a definition that names
 * lists by their IDs, which `listOfId` knows. In words, the target is one name, in quotes or not, a module's or a list's:
 * the one object's that has it. Without quotes the words are taken for a target only where they are a name; in quotes, a
 * name that nothing has is unresolved. */
const targetInAction = (listOfId: ReadonlyMap<string, number>): TargetOf => (draft, action, table, row) => {
  const definition = table.cell(row, "Action");
  const words = ACTION_TARGET.exec(definition);
  if (words) {
    const [, verb, written] = words;
    const among = (name: string): (number | undefined)[] => [draft.modules.get(name), draft.lists.get(name)];
    // In quotes, whatever stands between them is a name, but for nothing at all. Without quotes, only what something is named.
    const quoted = written.trim() !== unquote(written) && unquote(written) !== "";
    if (quoted || [written, unquote(written)].some(name => among(name).some(each => each !== undefined))) {
      const target = onlyNamed(written, among);
      if (target === undefined) draft.missing(action, "Action", written);
      else if (verb === "Import into") draft.link(action, target, "import_target");
      else draft.link(target, action, "export_source");
      return true;
    }
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

/** What the map says of the names that fit both a module's line item and a list's property, each taken for the line item. */
const sharedNames = (amount: number): string =>
  `${count(amount, "name fits both a line item and a list property of the same name, and is", "names fit both a line item and a list property of the same name, and are")} taken for the line item.`;

/** The graph of a model export's tables, with what it was made with: the draft, which knows every object by its name,
 * and what was read of Line Items. It throws whatever keeps a graph from being made. */
function build(tables: readonly ResultTable[]): { graph: ModelGraph; draft: Draft; lineItems: LineItemsRead } {
  const draft = new Draft();
  // In the prototype's order. A column that names objects is read once every object it can name is there.
  const lists = readLists(draft, tables);
  const lineItems = readLineItems(draft, tables);
  const formats = linkLists(draft, lists, lineItems.formatIds);
  const ids = listIds(draft, lineItems, formats.referencedAs);
  const unnamedLists = linkLineItems(draft, lineItems, formats.formatOf, ids.listOfId);
  const processes = readProcesses(draft, tables);
  const imports = readActions(draft, tables, IMPORTS, processes.known, { kind: "Import", target: targetOfImport,
    untargeted: ["import is linked to no module or list: its Target Object cell is empty", "imports are linked to no module or list: their Target Object cell is empty"] });
  const exportActions = readActions(draft, tables, EXPORTS, processes.known, { kind: "Export", target: targetInAction(ids.listOfId),
    untargeted: ["export is linked to no module or list: what it takes could not be read from its Action cell",
      "exports are linked to no module or list: what they take could not be read from their Action cell"] });
  // Many of the other actions work on no list: one that names none is as it should be.
  const otherActions = readActions(draft, tables, OTHER_ACTIONS, processes.known, { target: targetInAction(ids.listOfId) });
  const actions = [imports, exportActions, otherActions];
  const shared = draft.sharedWithProperty.size;
  const graph: ModelGraph = {
    nodes: draft.nodes,
    edges: draft.links(),
    unresolved: draft.unresolved,
    // The module sections, in the file's order: each group that a module is in.
    sections: [...new Set(draft.nodes.flatMap(node => (node.kind === "module" && node.group !== undefined ? [node.group] : [])))],
    limitations: [
      // What each file lacks and what was left out of it, in the files' order; then the links the export gives no name
      // for, and the names it gives to two objects of which the map takes one.
      ...lists.says, ...lineItems.says, ...processes.says, ...actions.flatMap(read => read.says), ...ids.says, ...unnamedLists,
      ...(shared ? [sharedNames(shared)] : []),
      // Then what no export says, each of an export that has what the sentence is about.
      ...(lists.table?.rows.length ? [lists.table.has("Item Count") ? LIST_ITEMS : NO_LIST_ITEMS] : []),
      ...(actions.some(read => read.usedIn) ? [PROCESS_ORDER] : []),
      LINKS,
      ...(imports.sources ? [IMPORT_SOURCES] : []),
    ],
  };
  return { graph, draft, lineItems };
}

/** The graph of a model export's tables (`AnalysisResult.tables` of a model). A table that is missing, or lacks a column
 * the map reads, leaves out what it would have given and adds a sentence to `limitations`: it never throws for that, nor
 * for anything else a table holds. Tables that cannot be read at all give a graph of nothing, which says so. The same
 * tables always give the same graph. */
export function buildModelGraph(tables: readonly ResultTable[]): ModelGraph {
  try {
    return build(tables).graph;
  } catch (error) {
    return { nodes: [], edges: [], unresolved: [], sections: [], limitations: [`The map could not be made from this export's tables (${message(error)}).`] };
  }
}

/** A use of a driver in a row of Line Items that the map leaves out: a line item under a heading, one whose module has
 * no row above it or is not said, a second line item of a name, a module's second row, a heading. */
export interface LeftOutDriver {
  /** The row's number in the Line Items file, counted as a node's `row` is. */
  row: number;
  /** What the row is, as the file writes it: a line item by its Module Name cell and its name, and a module's own row,
   * which names no module and is no line item's, by its name and no line item's. */
  module: string;
  lineItem: string;
  kind: (typeof DRIVERS)[number][1];
  /** The cell as it is written, and the line item of the graph that it names, if it names one. The cell is read as
   * that of a row the map places is. A name alone is a line item of the row's own module. A line item with a dash has
   * its module's driver, where its module's own row stands above it and names one of the graph. */
  written: string;
  driver: number | undefined;
}

/** What the export's Dynamic Cell Access table is made of (model/access.ts): one row for each use of a driver. */
export interface AccessRead {
  /** The map's graph of the same tables. For every row of Line Items that the map places, the table's rows are this
   * graph's `read_access` and `write_access` links and its unresolved driver cells, so the table and the map agree. */
  graph: ModelGraph;
  /** Whether the export has a Line Items file, and the columns the table cannot be made without that the file lacks:
   * the one that says which module a line item is in, and the two that name a driver. */
  exported: boolean;
  lacks: string[];
  /** The uses of a driver in the rows the map leaves out, in the file's order. The map has no link for these, and says
   * in `limitations` how many rows it left out. The table lists them all the same: no driver cell that says something
   * is to be in no row of it. */
  leftOut: LeftOutDriver[];
}

/** The graph with what the map itself does not show of the drivers: the cells in the rows it leaves out, read by its own
 * rules. Unlike `buildModelGraph` it throws whatever keeps a graph from being made: a file must not take a graph of
 * nothing for a model that drives no access. */
export function readAccess(tables: readonly ResultTable[]): AccessRead {
  const { graph, draft, lineItems: { table, rows, moduleless } } = build(tables);
  if (!table) return { graph, exported: false, lacks: [], leftOut: [] };
  // What the table is not made without: the column that says which module a line item is in, and the two of a driver.
  const needs: readonly LineItemColumn[] = ["Module Name", ...DRIVERS.map(([column]) => column)];
  const lacks = needs.filter(column => !table.has(column));
  const leftOut: LeftOutDriver[] = [];
  if (lacks.length) return { graph, exported: true, lacks, leftOut };
  const placed = new Map(Array.from(rows.keys(), id => [draft.nodes[id].row, draft.nodes[id]] as const));
  /** Each module's own row above the row being read, by the module's name: the first of a name. */
  const ownRows = new Map<string, Row>();
  table.rows.forEach((row, index) => {
    const at = rowNumber(index);
    const node = placed.get(at);
    const name = textOf(row[0]);
    const inModule = table.cell(row, "Module Name");
    // A row that names no module is a line item's whose module the file does not say, or a module's own: one the map
    // places, a module's second row, or a heading.
    const own = node ? node.kind === "module" : inModule.trim() === "" && !moduleless.has(at);
    if (own && !ownRows.has(name)) ownRows.set(name, row);
    if (node) return;
    // A module's own row is read in that module, and a line item's in the module its row names.
    const [module, lineItem] = own ? [name, ""] : [inModule, name];
    for (const [column, kind] of DRIVERS) {
      let written = table.cell(row, column);
      const ofModule = !own && inModule.trim() !== "" && written === "-" ? ownRows.get(inModule) : undefined;
      if (ofModule) written = table.cell(ofModule, column);
      if (!drives(written)) continue;
      const driver = draft.resolve(written, { inModule: module });
      // A module's cell that names no line item is the module's row's to say, once: not each line item's that has it.
      if (driver !== undefined || !ofModule) leftOut.push({ row: at, module, lineItem, kind, written, driver });
    }
  });
  return { graph, exported: true, lacks, leftOut };
}
