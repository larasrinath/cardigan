/** Which of a model's imports read a file, as the model export and the results page both tell them. The export reads the
 * mapping of every import (model/import-mappings.ts), one after another in the Imports tab's order, each with its Source
 * Type, and keeps the File Options of those that read a file. The page shows each in the details of its row of Imports
 * (results/import-mapping-view.ts), which it finds by the import's name and Source Type and, among imports of both alike,
 * by its place. A result an earlier version kept has the mappings of the imports that read a file alone, without their
 * Source Type: the page takes them for those of the rows this tells. */

/** The Imports tab's column for the kind of source an import reads, as the tab labels it and the Imports table keeps it. */
export const SOURCE_TYPE = "Source Type";

/** Whether a Source Type cell says that its import reads a file: the tab writes FILE, where it writes SAVED VIEW, MODULE or
 * LIST for a model's own data. */
export const readsFile = (cell: unknown): boolean => typeof cell === "string" && cell.trim().toUpperCase() === "FILE";
