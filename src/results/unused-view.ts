import type { AnalysisResult } from "../result-types.js";
import { UNUSED_CAVEAT, UNUSED_LINE_ITEMS_FILE, UNUSED_MODULES_FILE, UNUSED_NOTES } from "../unused-files.js";
import type { FileRule } from "./result-view.js";
import { cellText } from "./table-engine.js";

/** How the page shows the two tables of what nothing uses (unused-files.ts, made by model/unused.ts): as they stand, with a
 * line under each table's name that says what unused means here and what Cardigan cannot see, and after it what the run
 * could not see for this result, as its Details file notes it. A table without rows says what that means. */

/** What each table says in the rows' place when it has none. */
const EMPTY: ReadonlyMap<string, string> = new Map([
  [UNUSED_LINE_ITEMS_FILE, "Every line item that holds data has a use Cardigan can see."],
  [UNUSED_MODULES_FILE, "Every module has a line item in use, or is used whole."],
]);

/** What the run could not see for the two tables: the Details file's notes under their detail, in its order. */
export function unusedNotes(result: AnalysisResult): string[] {
  const details = result.tables.find(table => table.details === true);
  return (details?.rows ?? []).filter(row => cellText(row[0]) === "Notes" && cellText(row[1]) === UNUSED_NOTES).map(row => cellText(row[2]));
}

export const unusedRule: FileRule = (file, result) => ({
  table: file,
  note: [UNUSED_CAVEAT, ...unusedNotes(result)].join(" "),
  ...(EMPTY.has(file.file) ? { empty: EMPTY.get(file.file) } : {}),
});
