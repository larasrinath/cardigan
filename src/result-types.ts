/** What one run hands the results page: its tables, as data. The page shows them, and makes no file of them.
 *
 * The names are from the time when a result was also a zip of CSV files to download, one file a table, and they are
 * kept as they were: the code knows a table by its `file`. The tests still write a result as that zip, from these
 * tables and from nothing else (result-zip.test-support.ts), to hold it against the zips earlier versions wrote. */

/** A cell: a text or a number. */
export type Cell = string | number;

/** One table: one file of the zip, while there was one. */
export interface ResultTable {
  /** The table's name as a file, with its extension: "Cards.csv", "Line Items.csv". The code knows the table by it; a
   * user is shown `label`, never this. */
  file: string;
  /** The name the page shows for it: the file name without ".csv". */
  label: string;
  headers: string[];
  rows: Cell[][];
  /** How the table is written as a CSV: true guards formula-like cells (every app file, and both Details files); false
   * writes values exactly as Anaplan's own export does (the model's grids). Only the tests' writer reads it now
   * (zip.test-support.ts `toCsv`). */
  guard: boolean;
  /** True for the one file about the export itself (App Details.csv, Model Details.csv): rows of Section, Detail, Value. */
  details?: true;
}

export interface AnalysisResult {
  /** An app's pages, or a model's Model settings. */
  kind: "app" | "model";
  /** The app's or the model's name, and its ID. */
  name: string;
  id: string;
  /** The name the zip had as a download. Nothing is saved under it now. */
  zipName: string;
  /** The tables, in the order the zip had its files in; the Details file comes first. */
  tables: ResultTable[];
  /** The lines listed after a run: counts and notes. */
  summary: string[];
  /** A model's modules, each by its name and its ID in the model (the entity's long ID, in digits), as the export read
   * them: what the results page opens a module in Model Building by. Empty where the export found none; none in an app's
   * result, nor in one that an earlier version kept. Pairs, so that a module's name is never taken for a property of an
   * object. */
  moduleIds?: [name: string, id: string][];
  /** A model's lists, each by its name and its ID in the model, as the export read them from General Lists: what the results
   * page opens a list in Model Building by. Empty where the export found none; none in an app's result, nor in one that an
   * earlier version kept. */
  listIds?: [name: string, id: string][];
  /** The mapping of each of a model's imports from a file (Source Type FILE in the Imports tab), in the order of that tab:
   * what feeds each target of the import, as the import's own definition says it. The results page shows it in the
   * details of the import's row of Imports. Empty for a model that has no import from a file; none in an app's result, in
   * a model's whose Imports tab could not be read, nor in one that an earlier version kept. */
  importMappings?: ImportMapping[];
  /** The actions each of a model's processes runs, in the order it runs them, as the process's own definition holds them:
   * one entry for each process of the Actions list, in that list's order. The results page lists them in the details of the
   * process's row of Processes. Empty for a model without a process; none in an app's result, in a model's whose Actions
   * list could not be read, nor in one that an earlier version kept. */
  processActions?: ProcessActions[];
  /** The IDs of each row of a model's Line Items table, in the table's order: the row's own (the entity's long ID, in
   * digits), and the ID of a line item's module, empty for a module's own row. The export gives them, and the content script
   * reads the pages built on the model with them (model-pages.ts), so that the modules the pages use are not read again:
   * it takes them off the result before the result leaves the Anaplan tab. No results page holds them. */
  lineItemIds?: [id: string, moduleId: string][];
  /** Where a model read in Model Building is, as the Anaplan tab's address said it: the site's origin and the customer.
   * The results page opens the model's modules there, and the apps and pages built on it. None in an app's result, in a
   * model's read on the classic model page, whose address names no customer, nor in one that an earlier version kept. */
  site?: { origin: string; customer: string };
}

/** One import from a file, with its mapping. The mapping is the import's own: it holds whether the file it was made with is
 * still there or not. */
export interface ImportMapping {
  /** The import's ID in the model (the entity's long ID, in digits) and its name, as the Imports tab lists it. The page
   * finds an import's row by the name: the Imports table has no column of IDs. */
  id: string;
  name: string;
  /** Anaplan's word for what the import loads, as its definition says it: MODULE_DATA into a module, HIERARCHY_DATA into a
   * list, and others such as USERS, VERSIONS or LINE_ITEM_DEFINITION. Empty where the definition says none. */
  importType: string;
  /** Each target of an import into a module or a list, with what feeds it, in the definition's order: none for an import
   * of any other kind, and none where the definition could not be read. */
  targets: MappedTarget[];
  /** How an import into a list tells the list's items apart, as the dialog's "Items uniquely identified by" says it. None
   * for an import into a module, and none where the definition says it in no way the dialog knows. */
  matchedBy?: ItemMatch;
  /** Why there is no mapping, in words for the user, where the definition could not be read. */
  note?: string;
}

/** How an import into a list tells the list's items apart (anaplan/view/ImportDefinitionHierarchyMapping.js): by their
 * names or codes, by names alone, by codes alone, or by a combination of the list's properties. */
export interface ItemMatch {
  by: "nameOrCode" | "name" | "code" | "properties";
  /** The properties that together tell an item apart, each by its name, where `by` is "properties". */
  properties?: string[];
  /** Whether the list is numbered, where the export knows: the dialog names the choices of a numbered list otherwise. */
  numbered?: boolean;
}

/** One of a model's processes, with the actions it runs. */
export interface ProcessActions {
  /** The process's ID in the model (the entity's long ID, in digits) and its name, as the Actions list lists it. The page
   * finds a process's row by the name: the Processes table has no column of IDs. */
  id: string;
  name: string;
  /** Its actions, in the order the process runs them: none where it runs none, and none where its definition could not be
   * read. */
  actions: ProcessStep[];
  /** Why its actions are not known, in words for the user, where the definition could not be read. */
  note?: string;
}

/** One action a process runs. */
export interface ProcessStep {
  /** The action's ID in the model, in digits; empty where the definition names it in no way Cardigan knows. */
  id: string;
  /** The action's name, as the Actions list names it; "ID 112000000001" for an action the list does not have. */
  name: string;
  /** Anaplan's word for its kind, as the process's definition says it: IMPORT, EXPORT, ACTION for any other action, and
   * others the definition may hold; empty where it says none. */
  type: string;
}

/** What feeds one target of an import: a column of the file, a constant, a prompt when the import runs, nothing (the target
 * is ignored), the file's header row (the line items, each from the column it heads), nothing mapped, the list itself (a
 * numbered list's items' names, which the list gives where its items are told apart by code or by properties: the dialog
 * lets no column feed them then), or a source of another kind, which `text` names by Anaplan's word. */
export type MappedSource = "column" | "constant" | "prompt" | "ignore" | "headerRow" | "none" | "numbered" | "other";

export interface MappedTarget {
  /** The target by its name: a list, Time, Versions or Line Items, or a line item, for an import into a module; the list's
   * items, Parent, Code or a property, for an import into a list. A target the model gave no name for is named by its ID
   * ("ID 1901000000003"). */
  target: string;
  source: MappedSource;
  /** A column's place in the file, counted from 1, where the definition gives it. */
  column?: number;
  /** A column's heading, where the definition keeps it; a constant's value; or Anaplan's word for a source of another kind. */
  text?: string;
  /** A column's identifier as the definition writes it, where it gives neither the column's place nor its heading. */
  id?: string;
}
