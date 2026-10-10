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
   * them: what the results page opens a module in Model Building by. None in an app's result, nor in one that an earlier
   * version kept. Pairs, so that a module's name is never taken for a property of an object. */
  moduleIds?: [name: string, id: string][];
}
