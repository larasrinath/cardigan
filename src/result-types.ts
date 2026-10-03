/** What one run hands the results page: the files of the zip, as data. The zip and each CSV are built from these tables and
 * from nothing else (result-zip.ts), so what the page shows and what a download holds cannot differ. */

/** A cell as it goes into the CSV. */
export type Cell = string | number;

/** One file of the zip. */
export interface ResultTable {
  /** The file's name in the zip, with its extension: "Cards.csv", "Line Items.csv". */
  file: string;
  /** The name the page shows for it: the file name without ".csv". */
  label: string;
  headers: string[];
  rows: Cell[][];
  /** toCsv's `guard` for this file: true guards formula-like cells (every app file, and both Details files); false writes
   * values exactly as Anaplan's own export does (the model's grids). */
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
  /** The zip's file name, as the download has always been named. */
  zipName: string;
  /** The zip's files, in the zip's order; the Details file comes first. */
  tables: ResultTable[];
  /** The lines listed after a run: counts and notes. */
  summary: string[];
}
