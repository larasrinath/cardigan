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
  /** Polaris reads partial settings and published pages; absent settings must not be inferred. */
  engine?: "polaris";
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
  /** The mapping of each of a model's imports, whatever its Source Type in the Imports tab, in the order of that tab: what
   * feeds each target of the import, as the import's own definition says it. The results page shows it in the details of
   * the import's row of File Imports, Model-to-Model Imports or In-Model Imports, the three tables it shows the Imports
   * table as. Empty for a model that has no import; none in an app's result, in a model's whose Imports
   * tab could not be read, nor in one that an earlier version kept. An earlier version kept those of the imports from a
   * file alone (Source Type FILE), each without its `sourceType`. */
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
  /** The columns of a model's Line Items grid, by their labels, as the grid's first page gave them, wherever that page was
   * read: the content script tells the model's engine by them where the result has no Line Items table, as when the model
   * refused the grid's later pages (model-engine.ts `engineFromColumns`). It takes them off the result, as it takes
   * `lineItemIds`. */
  lineItemColumns?: string[];
  /** How many rows of a model's Line Items grid the model refused, where the export kept the grid without them
   * (model/native.ts `readGrid`): Unused Line Items says that what only they use may be listed (model/unused.ts). The
   * content script takes it off the result, as it takes `lineItemIds`. */
  lineItemsRefused?: number;
  /** What the pages built on a model use of it by name, out of the page definitions the run read (page-uses.ts): the run
   * finds the model's unused line items with it (model/unused.ts). None in an app's result, in a model's whose pages could
   * not be read, nor in one that an earlier version kept. */
  pageUses?: PageUses;
  /** The model's saved views, one for each row of the Saved Views table, in its order (model/saved-views.ts): the results
   * page lists each one's filters in its row's details, and the run makes the Saved View Filters table of those the pages
   * built on the model show (model-pages.ts). Empty for a model with none; none in an app's result, in a model's whose saved
   * views could not be listed, nor in one that an earlier version kept. 0.43.0 and 0.44.0 kept only the views with a filter
   * and those whose definition was not read, one for each row of their table of them, which they called Saved View Filters
   * (results/saved-view-filters-view.ts `withSavedViews`). */
  savedViewDetails?: SavedViewDetail[];
  /** Each condition of a saved view's filter, as the export read it, for the Model map: the saved view and its module, the
   * axis, and the condition's line item and that line item's module, all by the names Modules and Line Items give them;
   * whether the filter is on and the condition valid. A condition whose line item can't be named is left out. */
  savedViewFilters?: SavedViewFilter[];
  /** The IDs of the saved views of `savedViewDetails`, in digits, one for each: the content script finds the pages whose
   * cards show each view with them (model-pages.ts), and takes them off the result before it leaves the Anaplan tab, as it
   * takes `lineItemIds`. No results page holds them. */
  savedViewIds?: string[];
  /** Where a model read in Model Building is, as the Anaplan tab's address said it: the site's origin and the customer.
   * The results page opens the model's modules there, and the apps and pages built on it. None in an app's result, in a
   * model's read on the classic model page, whose address names no customer, nor in one that an earlier version kept. */
  site?: { origin: string; customer: string };
}

/** What the cards of the pages built on a model that work on it use of the model, by name: compact, and read from the
 * pages' definitions the run read anyway. */
export interface PageUses {
  /** Each line item a card names anywhere, by its module's name and its own, once each, in the order the pages name them. */
  lineItems: [module: string, lineItem: string][];
  /** Each module a grid or a chart shows whole, by its name, once each: through a saved view, the module's default view, or
   * a section whose Line Items are not narrowed to a list of them. */
  modules: string[];
  /** How many of the pages built on the model could not be read: what they use is not known. */
  unread: number;
  /** How many line items and modules the cards name that the model's names could not name. */
  unnamed: number;
}

/** A saved view, as a row of the Saved Views table names it, with its filters where its definition was read. */
export interface SavedViewDetail {
  /** The view's name, and its module's, as Modules names it. */
  name: string;
  module: string;
  /** Whether its definition was read: false where the model refused it, or the export was stopped before it. */
  read: boolean;
  /** The filter of each axis that has one, on or off: Rows, Columns, then each page axis in its order. None where the
   * definition was not read. */
  filters: AxisFilter[];
}

/** The axes of a view, as Anaplan's filter dialog names them. */
export type ViewAxis = "Rows" | "Columns" | "Pages";

/** One axis's filter, as the view's definition holds it (`sortAndFilterDefinition`). */
export interface AxisFilter {
  axis: ViewAxis;
  /** For a page axis, its dimension, as the model's client names it, where it does: several joined with a slash, as the
   * filter dialog says them. */
  dimension?: string;
  /** The axis's dimensions, each as the model's client names it, in the axis's order, where it names them: the rows', the
   * columns' or a page's. None in a result an earlier version kept. */
  dimensions?: string[];
  /** Whether the filter is on: the dialog's Enable filter (`isActive`). */
  active: boolean;
  /** Whether a row shows where all of the conditions hold, or any (`filterMatchType` ALL or ANY). */
  match: "all" | "any";
  conditions: ViewCondition[];
}

/** One condition of an axis's filter. */
export interface ViewCondition {
  /** The line item, by the name Line Items gives it, or by the name the definition gives it where Line Items has none of
   * its ID; "Missing line item (ID 2000000123)" where neither does (page-files.ts `missingText`). */
  lineItem: string;
  /** The line item's module, by the name Line Items gives it; none where Line Items has none of the line item's ID. */
  lineItemModule?: string;
  /** The line item's ID in the model (the entity's long ID, in digits), as the definition gives it, a missing line item's
   * too; none for a condition on the view's module itself, and none in a result an earlier version kept. */
  lineItemId?: string;
  /** Anaplan's word for the comparison: EQUALS, NOT_EQUALS, LESS_THAN, IS_BLANK, CONTAINS and the like. */
  operator: string;
  /** Anaplan's word for what is compared (`comparisonDataType`): BOOLEAN, NUMBER, TEXT, DATE, ENTITY or TIME_ENTITY. */
  dataType: string;
  /** The values compared with: a list's items and periods by their labels, True or False, and any other value as the
   * definition holds it. None for an operator that takes none. */
  values: string[];
  /** The items the line item is read at on its dimensions that the view does not show, by their labels. */
  contexts: string[];
  /** False where Anaplan marks the condition not valid. */
  valid: boolean;
}

/** One condition of a saved view's filter, for the Model map (`AnalysisResult.savedViewFilters`). */
export interface SavedViewFilter {
  view: string;
  module: string;
  axis: ViewAxis;
  lineItem: string;
  lineItemModule: string;
  active: boolean;
  valid: boolean;
}

/** One import, with its mapping. The mapping is the import's own: it holds whether the source it was made with is still
 * there or not. */
export interface ImportMapping {
  /** The import's ID in the model (the entity's long ID, in digits) and its name, as the Imports tab lists it. The page
   * finds an import's row by the name, among the rows of its Source Type: the Imports table has no column of IDs. */
  id: string;
  name: string;
  /** Anaplan's word for the kind of source the import reads, as the Imports tab's Source Type writes it, trimmed: FILE for
   * uploaded data, MODULE, SAVED VIEW or LIST for a model's object, and empty where the tab says none. None in a result an
   * earlier version kept, whose mappings are all of imports whose Source Type is FILE. */
  sourceType?: string;
  /** Anaplan's word for what the import loads, as its definition says it: MODULE_DATA into a module, HIERARCHY_DATA into a
   * list, and others such as USERS, VERSIONS or LINE_ITEM_DEFINITION. Empty where the definition says none. */
  importType: string;
  /** Each target of an import into a module or a list, with what feeds it, in the definition's order: none for an import
   * of any other kind, and none where the definition could not be read. */
  targets: MappedTarget[];
  /** How an import into a list tells the list's items apart, as the dialog's "Items uniquely identified by" says it. None
   * for an import into a module, and none where the definition says it in no way the dialog knows. */
  matchedBy?: ItemMatch;
  /** For an import into a module whose line items come from the header row: each header the modeller mapped to a line
   * item manually, with its line item, or ignored, in the order the definition writes them. None where no header is mapped
   * manually: the headers are then matched on names or codes when the import runs, and the definition stores none. */
  headers?: ImportHeader[];
  /** For an import into a module, what its dialog's Mapping tab says it does to the module before it loads: "clear" for
   * Clear target prior to import, where the definition has no `globalTargetAreaSpecification`, and "update" for Only
   * update imported cells, where it has one (anaplan/view/ImportDefinitionModuleMapping.js `_initTargetItemsOptions`).
   * None for an import into a list, and none in a result an earlier version kept. */
  clear?: "clear" | "update";
  /** For an import of uploaded data, how its data source reads it, as the source's own definition holds it: the import's
   * File Options. None where the source's definition was not read or holds none of them, and none in a result an earlier
   * version kept. Nothing else of a source is kept but `sourceInThisModel`: never the model, the workspace or the object a
   * model's import reads, by name or by ID. */
  fileOptions?: FileOptions;
  /** For an import of a model's module, saved view or list, whether that object is this model's: true where its data
   * source's definition names no model or this one, false where it names another. The results page lists the import under
   * In-Model Imports or Model-to-Model Imports by it (results/import-tables.ts). None where that definition was not read
   * or is no model's object, for an import of uploaded data, and in a result an earlier version kept. */
  sourceInThisModel?: boolean;
  /** Why there is no mapping, in words for the user, where the definition could not be read. */
  note?: string;
}

/** How a data source of uploaded data reads it (anaplan/view/ManageImportSources/_EditUploadedText.js), each as the source's
 * definition holds it, where it holds it in a way Anaplan's own dialog reads. */
export interface FileOptions {
  /** The text encoding, by Anaplan's name for it: "ISO-8859-1", "UTF-8". */
  encoding?: string;
  /** The characters that separate the columns, one or more: a tab, a comma, a semicolon, or others of the modeller's. */
  separators?: string;
  /** The character that encloses text, '"' or "'"; empty for none. */
  delimiter?: string;
  /** The decimal separator: "." or ",". */
  decimal?: string;
  /** The row that holds the headers, counted from 1, and 0 for none; and the first row of data. */
  headerRow?: number;
  firstDataRow?: number;
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

/** A header of the header row that the modeller mapped to a line item manually, as the import's definition keeps it. */
export interface ImportHeader {
  /** The header, as the definition writes it. */
  header: string;
  /** The line item it is mapped to, by its name ("ID 1901000000003" where the model gives none); none where the header is
   * ignored. */
  lineItem?: string;
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

/** What a target of an import into a module is, by its definition's `targetType` and target: one of the module's
 * dimensions, Time, Versions, a list (or a subset) or the line items; one line item's own column; the column of values
 * where each row names its line item (the blank line item, the dialog's "Data values from"); or a target of another kind. */
export type TargetKind = "time" | "versions" | "list" | "lineItems" | "lineItem" | "value" | "other";

export interface MappedTarget {
  /** The target by its name: a list, Time, Versions or Line Items, or a line item, for an import into a module; the list's
   * items, Parent, Code or a property, for an import into a list. A target the model gave no name for is named by its ID
   * ("ID 1901000000003"). */
  target: string;
  source: MappedSource;
  /** A column's place in the file, counted from 1, where the definition gives it. */
  column?: number;
  /** A column's heading, where the definition keeps it; for a column of a model's object, its name as the definition writes
   * it, else as this model names the entity it is, or that entity's ID ("ID 1901000000003"); a constant's value; or
   * Anaplan's word for a source of another kind. */
  text?: string;
  /** A column's identifier as the definition writes it, where it gives neither the column's place nor its heading. */
  id?: string;
  /** For a dimension of an import into a module, fed by a column or the header row, where the definition says how its items
   * are matched: how many source values are mapped to items manually, and how many are ignored. Both none is the dialog's
   * "Match on names or codes". None where the definition does not say. */
  items?: { byHand: number; ignored: number };
  /** For Time, fed by a column or the header row: the format its periods are read by, or null where they are matched by
   * their names. None where the definition does not say. */
  periodFormat?: string | null;
  /** For a line item formatted as a date: the format its column's dates are read by. */
  dateFormat?: string;
  /** What the target is, for every target of an import into a module (`TargetKind`); none for an import into a list, and
   * none in a result an earlier version kept. */
  kind?: TargetKind;
  /** For a dimension of an import into a module, fed by a column or the header row: which of its items the import clears
   * first, by Anaplan's word in the definition's `targetAreaSpecifications` (MATCHED_ITEMS, MAPPED_ITEMS_IN_SOURCE,
   * ALL_MAPPED_ITEMS or ALL_ITEMS). None where the definition says none. */
  area?: string;
}
