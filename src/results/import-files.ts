/** The tables the results page shows a model's Imports file as, by where each import takes its data from, under the names
 * the owner chose, in the words Anaplan's model builders use: File Imports, of uploaded data; Model-to-Model Imports, of a
 * module, a saved view or a list of another model; In-Model Imports, of one of this model's own. They are the page's, and
 * no file of the result: the result keeps its one Imports file, which everything else reads, and the page shows each
 * import in the one table of its kind (import-tables.ts). Each table is known by a name of a file, as any of the page's
 * tables is, so that what the page keeps of a table, its columns, its icon and its place in the navigation are its own:
 * a name no user reads or types. Named here, apart from what tells the imports apart, so that the page knows them by name
 * without taking in that work. */

/** A model's Imports file, as model/export.ts writes it: the Imports tab of Model settings, one import a row. */
export const IMPORTS_FILE = "Imports.csv";

/** The kind of source an import reads: uploaded data, another model's object, or one of this model's. */
export type ImportKind = "file" | "model" | "inModel";

export const FILE_IMPORTS_FILE = "File Imports.csv";
export const MODEL_IMPORTS_FILE = "Model-to-Model Imports.csv";
export const IN_MODEL_IMPORTS_FILE = "In-Model Imports.csv";

/** One of the three tables: the kind of import it lists, its name as a file, and its name on the page. */
export interface ImportTable { kind: ImportKind; file: string; label: string }

/** The three tables, in the order the page lists them. */
export const IMPORT_TABLES: readonly ImportTable[] = [
  { kind: "file", file: FILE_IMPORTS_FILE, label: "File Imports" },
  { kind: "model", file: MODEL_IMPORTS_FILE, label: "Model-to-Model Imports" },
  { kind: "inModel", file: IN_MODEL_IMPORTS_FILE, label: "In-Model Imports" },
];

/** The table a name of a file is, where it is one of the three. */
export const importTableOf = (file: string): ImportTable | undefined => IMPORT_TABLES.find(table => table.file === file);

/** The file of the result whose rows a table of the page lists: the Imports file for any of the three, and else the
 * table's own. */
export const resultFileOf = (file: string): string => (importTableOf(file) ? IMPORTS_FILE : file);
