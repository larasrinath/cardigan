/** A model's objects and what links them: what the model map draws. It is worked out from the tables of a model export
 * and from nothing else (build-graph.ts), so the map can say of every node which file and row it comes from, and it
 * shows nothing the files do not hold. Formulas are kept as text and never evaluated: every link comes from a column
 * of the export that names another object. */

/** What a node is. A section is no node: it is the heading row above a group of modules (or lists) in the export. */
export type NodeKind = "list" | "subset" | "property" | "module" | "lineItem" | "process" | "action";

export interface GraphNode {
  /** Its place in `ModelGraph.nodes`. */
  id: number;
  kind: NodeKind;
  name: string;
  /** Where it comes from: the table's label ("Line Items", "General Lists", "Processes"...) and the row in it, counted
   * from 1 as the page counts a table's rows. A subset and a property carry their list's row. */
  file: string;
  row: number;
  /** The heading row above it in its file, without the heading's dashes; "Ungrouped" where there is none. For a list, a
   * subset, a property, a module and a line item (its module's). */
  group?: string;
  /** A line item's module. */
  module?: number;
  /** A subset's and a property's list; a list's parent list or subset. */
  parent?: number;
  /** A line item's formula, as exported. */
  formula?: string;
  /** A line item's format: the data type of the Format cell's JSON (NONE, NUMBER, BOOLEAN, DATE, TEXT, ENTITY,
   * TIME_ENTITY...), or the cell as it is where it is no JSON. A property's format, as its list's Properties cell says. */
  format?: string;
  /** For a line item formatted as a list or a subset that the export names: that node. */
  formatList?: number;
  /** A module's and a line item's cell count. */
  cells?: number;
  /** A list's item count. */
  count?: number;
  notes?: string;
  /** For a module and a line item: the lists and subsets it applies to, in the export's order. A line item with none of
   * its own has its module's, and `inheritsDimensions` says so. */
  dimensions?: number[];
  inheritsDimensions?: true;
  timeScale?: string;
  timeRange?: string;
  versions?: string;
  /** A line item's summary method, from the Summary cell's JSON. */
  summary?: string;
  style?: string;
  code?: string;
  /** A list's top level item, whether it is numbered, and its display name property. */
  topLevel?: string;
  numbered?: boolean;
  displayName?: string;
  /** An action's kind ("Import", "Export", or what the action's own definition says), its definition as exported, and
   * its last run. */
  actionType?: string;
  action?: string;
  lastRun?: string;
  durationMs?: number;
}

/** What a link says, read from its first node to its second:
 * - `reference`: the second's formula refers to the first (the first's Referenced By names the second).
 * - `list_formula`: the second's formula names the list or subset (the list's Referenced in Formula names the second).
 * - `applies`: the list or subset is a dimension of the module or line item.
 * - `format`: the list or subset is the format of the line item.
 * - `read_access`, `write_access`: the first drives who may read or write the second.
 * - `subset`: the list has the subset. `parent`: the first is the parent of the second (list hierarchy).
 * - `process_action`: the process runs the action.
 * - `import_target`: the import loads into the module or list. `export_source`: the module or list is what the export
 *   takes. `action_target`: the action works on the list.
 * Formula and access links run the way data flows: from what is read to what is worked out from it. */
export type EdgeKind = "reference" | "list_formula" | "applies" | "format" | "read_access" | "write_access" | "subset" | "parent"
  | "process_action" | "import_target" | "export_source" | "action_target";

export type GraphEdge = readonly [from: number, to: number, kind: EdgeKind];

/** A name in the export that matched no object: the node whose row holds it, the column, and the name as written. */
export interface Unresolved {
  source: number;
  field: string;
  reference: string;
}

export interface ModelGraph {
  nodes: GraphNode[];
  /** Every link once, in a fixed order (by first node, second node, kind), so the same export gives the same graph. */
  edges: GraphEdge[];
  unresolved: Unresolved[];
  /** The module sections in the order of the Line Items file; "Ungrouped" is among them only when a module has no
   * heading above it. */
  sections: string[];
  /** In plain sentences, what this graph could not hold: a file that was not exported or lacks a column the map reads,
   * and what no export says (list members, the order a process runs its actions in). */
  limitations: string[];
}

/** What the page tells the map about the model it draws. */
export interface ModelMapOptions {
  modelName: string;
  workspaceName?: string;
}

/** The mounted map (map-view.ts). The page shows and hides it as its navigation goes: while hidden it draws nothing and
 * listens to nothing outside its own element. */
export interface ModelMap {
  show(): void;
  hide(): void;
  /** The page's theme changed: every colour is read again from the page's styles. */
  themeChanged(): void;
  /** Takes its elements out of the host and drops every listener and timer. */
  destroy(): void;
}
