import type { AnalysisResult } from "./result-types.js";
import { VERSION } from "./version.js";

/** The first line of a run's log, as progress.ts `firstLine` writes it, up to the version it names. */
const FIRST_LINE = /^Cardigan \S+(?=: (?:app|model) )/;

/** The result as this version made it: "Exported with" in its Details table, and the first line of the diagnostic log
 * there where it names a version, say `version`. The model's reader writes both in the model's frame, and a tab keeps its
 * reader through an update that leaves the reader's code as it was (scripts/reader-mark.mjs): the reader may then be of
 * an earlier version than the content script and the results page, which make the rest of the result. Every other row,
 * and every other table, stays as it was. This file is not part of the reader, so that changing it changes no reader. */
export function withVersion(result: AnalysisResult, version = VERSION): AnalysisResult {
  return { ...result, tables: result.tables.map(table => (table.details !== true ? table : { ...table, rows: table.rows.map(row => {
    if (row[0] === "Export" && row[1] === "Exported with") return [row[0], row[1], `Cardigan ${version}`, ...row.slice(3)];
    if (row[0] === "Diagnostics" && typeof row[2] === "string" && FIRST_LINE.test(row[2])) return [row[0], row[1], row[2].replace(FIRST_LINE, `Cardigan ${version}`), ...row.slice(3)];
    return row;
  }) })) };
}
