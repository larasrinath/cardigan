/** Which of a model's imports read a file, as the model export and the results page both tell them. The export reads the
 * mapping of those imports (model/import-mappings.ts), one after another in the Imports tab's order, and the page shows each
 * in the details of its row of Imports (results/import-mapping-view.ts), which it finds by the import's name and, among
 * imports of one name, by its place: so the two must take the very same rows for imports from a file. */

/** The Imports tab's column for the kind of source an import reads, as the tab labels it and the Imports table keeps it. */
export const SOURCE_TYPE = "Source Type";

/** Whether a Source Type cell says that its import reads a file: the tab writes FILE, where it writes SAVED VIEW, MODULE or
 * LIST for a model's own data. */
export const readsFile = (cell: unknown): boolean => typeof cell === "string" && cell.trim().toUpperCase() === "FILE";
