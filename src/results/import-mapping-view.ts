import { readsFile, SOURCE_TYPE } from "../file-imports.js";
import { readImportMappings } from "../result-plain.js";
import type { AnalysisResult, ImportMapping, MappedTarget, ResultTable } from "../result-types.js";
import { columnIndex } from "./columns.js";
import { IMPORTS_FILE } from "./result-view.js";
import { cellText, type Row } from "./table-engine.js";

/** The mapping of an import from a file, as the details of its row of a model's Imports show it, under All columns: each
 * target of the import with what feeds it, then what the mapping says of the columns it does not use. It is the import's
 * own definition, which the export read (model/import-mappings.ts), so an import whose file is no longer available shows
 * it as well. No word here names a file: the page names none (no-file.test-support.ts), and says "column" and "the header
 * row" where the dialog says file's columns.
 *
 * Which columns an import does not use can be said up to the last column it maps, and no further. The definition keeps
 * its columns by their places, and some by their headings alone, and nothing of the file: not how many columns it has,
 * nor its header row. So a column before the last one mapped that no target takes is not used. Whether there are columns
 * after it is not known, and the page says so rather than guess. A column a target names by its heading alone could be
 * any of them: where there is one, the columns no number takes may be used after all, and the page says that. */

/** A mapping as the drawer shows it: a row of Target and Source for each target, then lines under them. */
export interface MappingView {
  rows: [target: string, source: string][];
  lines: string[];
}

/** The kinds of import whose targets are listed (model/import-mappings.ts `MODULE_DATA`, `HIERARCHY_DATA`). */
const LISTED: ReadonlySet<string> = new Set(["MODULE_DATA", "HIERARCHY_DATA"]);
/** What another kind of import loads, by Anaplan's word for the kind. */
const LOADS: ReadonlyMap<string, string> = new Map([["USERS", "users"], ["VERSIONS", "versions"], ["LINE_ITEM_DEFINITION", "line items into a module"]]);
/** What the drawer says of an import of another kind, after what it loads. */
const ONLY_LISTED = "Cardigan lists the mapping of an import into a module or a list.";
/** What the drawer says where the result has no mapping for a row it has mappings for: a result the page cannot match. */
export const NO_MAPPING = "Cardigan has no mapping for this import: choose Run again to read it.";

/** Numbers as the page says them, in order: "3", "3 and 5", "3, 5 and 6", with three or more in a run said as one, "3 to 9". */
export function numbersWords(numbers: readonly number[]): string {
  const sorted = [...new Set(numbers)].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let at = 0; at < sorted.length;) {
    let end = at;
    while (end + 1 < sorted.length && sorted[end + 1] === sorted[end] + 1) end++;
    if (end - at >= 2) parts.push(`${sorted[at]} to ${sorted[end]}`);
    else for (let one = at; one <= end; one++) parts.push(String(sorted[one]));
    at = end + 1;
  }
  return parts.length < 2 ? parts.join("") : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/** "Column 3" or "Columns 3 and 5", for one column or more: a run said as one counts as more. */
const columnsWords = (numbers: readonly number[]): string => `${numbers.length === 1 ? "Column" : "Columns"} ${numbersWords(numbers)}`;

const said = (text: string | undefined): text is string => text !== undefined && text.trim() !== "";

/** What feeds a target, in words: the column by its place and its heading, the constant's value, and so on. */
export function sourceWords(target: MappedTarget): string {
  switch (target.source) {
    case "column":
      if (target.column !== undefined) return said(target.text) ? `Column ${target.column}: ${target.text}` : `Column ${target.column}`;
      return said(target.text) ? `Column headed ${target.text}` : "A column the definition neither numbers nor names";
    case "constant":
      return said(target.text) ? `Constant: ${target.text}` : "Constant, with no value given";
    case "prompt":
      return "Prompt: chosen each time the import runs";
    case "ignore":
      return "Ignored";
    case "headerRow":
      return "Header row: each line item from the column it heads";
    case "none":
      return "Not mapped";
    default:
      return said(target.text) ? `A source Cardigan does not know (${target.text})` : "A source Cardigan does not know";
  }
}

/** What the mapping says of the columns it does not use: those before the last column it maps that no target takes, and
 * that what lies after that column is not known. */
export function columnLines(targets: readonly MappedTarget[]): string[] {
  const columns = targets.filter(target => target.source === "column");
  if (!columns.length) return ["No column is mapped."];
  const numbered = new Set(columns.flatMap(target => (target.column === undefined ? [] : [target.column])));
  const headed = columns.length - columns.filter(target => target.column !== undefined).length;
  if (!numbered.size) return ["Each column mapped is named by its heading alone, so Cardigan cannot say which columns are not used."];
  const last = Math.max(...numbered);
  const unused = Array.from({ length: last }, (_, index) => index + 1).filter(column => !numbered.has(column));
  const be = (numbers: readonly number[]): string => (numbers.length === 1 ? "is" : "are");
  const allUsed = last === 1 ? "Column 1 is used." : last === 2 ? "Columns 1 and 2 are both used." : `Columns 1 to ${last} are all used.`;
  const lines = [unused.length ? `${columnsWords(unused)} ${be(unused)} not used.` : allUsed];
  if (headed && unused.length) {
    lines[0] = `${columnsWords(unused)} ${be(unused)} not mapped by number. ${headed === 1 ? "1 target names its column" : `${headed} targets name their columns`} `
      + `by heading alone, and may use ${unused.length === 1 ? "it" : "them"}.`;
  }
  lines.push(`Whether there are columns after column ${last} is not known: Anaplan keeps the import's mapping, not the header row it was made from.`);
  return lines;
}

/** An import's mapping as the drawer shows it, or what stands in its place: why it could not be read, what an import of
 * another kind loads, or that the definition maps nothing. */
export function mappingView(mapping: ImportMapping | undefined): MappingView {
  if (!mapping) return { rows: [], lines: [NO_MAPPING] };
  if (mapping.note !== undefined) return { rows: [], lines: [mapping.note] };
  if (!LISTED.has(mapping.importType)) {
    const loads = LOADS.get(mapping.importType);
    return { rows: [], lines: [`${loads ? `This import loads ${loads}.` : "This import loads neither a module nor a list."} ${ONLY_LISTED}`] };
  }
  if (!mapping.targets.length) return { rows: [], lines: ["The import's definition maps no target."] };
  return { rows: mapping.targets.map((target): [string, string] => [target.target, sourceWords(target)]), lines: columnLines(mapping.targets) };
}

/** The mapping for a row of a model's Imports, where its Source Type says that it reads a file (file-imports.ts
 * `readsFile`, the export's rule for which imports it reads the mapping of), and where the result has mappings, checked as
 * the bridge checks them (result-plain.ts `readImportMappings`). None for any other row, and for a result without
 * mappings, such as one an earlier version kept: the drawer then has no Mapping. The Imports table has no column of IDs,
 * so the row's mapping is the one of its name, the import's own name; among imports of one name, the one in the row's
 * place among them, as the export lists them in the Imports tab's order, which the table keeps. `table` is the Imports
 * table as the page shows it, whose rows stand each in the place it has in the file (result-view.ts `fileView`). */
export function mappingOfRow(result: AnalysisResult | undefined, table: ResultTable, row: Row): MappingView | undefined {
  if (result?.kind !== "model" || table.file !== IMPORTS_FILE) return undefined;
  const type = columnIndex(table, SOURCE_TYPE);
  if (type === undefined || !readsFile(row[type])) return undefined;
  const mappings = readImportMappings(result.importMappings);
  if (!mappings) return undefined;
  const name = cellText(row[0]);
  const at = table.rows.findIndex(candidate => candidate === row);
  const place = table.rows.slice(0, Math.max(0, at)).filter(other => cellText(other[0]) === name && readsFile(other[type])).length;
  return mappingView(mappings.filter(mapping => mapping.name === name)[place]);
}
