import { readsFile, SOURCE_TYPE } from "../file-imports.js";
import { readImportMappings } from "../result-plain.js";
import type { AnalysisResult, ImportHeader, ImportMapping, ItemMatch, MappedSource, MappedTarget, ResultTable } from "../result-types.js";
import { columnIndex } from "./columns.js";
import { LINE_ITEMS_FILE, MODULE_NAME } from "./line-items-view.js";
import { formatType } from "./readable-cells.js";
import { IMPORTS_FILE } from "./result-view.js";
import { cellText, type Row } from "./table-engine.js";

/** The mapping of an import from a file, as the details of its row of a model's Imports show it, under All columns: each
 * source that feeds a target of the import, with the target it feeds, the columns first and in their order; then a line
 * that names the targets nothing feeds, and what the mapping says of the columns it does not use. The source comes first
 * because the import is read from its source: a target that nothing feeds is no row, with nothing in its Source, but a
 * name in that line. It is the import's own definition, which the export read (model/import-mappings.ts), so an import
 * whose file is no longer available shows it as well. No word here names a file: the page names none
 * (no-file.test-support.ts), and says "column" and "the header row" where the dialog says file's columns.
 *
 * Which columns an import does not use can be said up to the last column it maps, and no further. The definition keeps
 * its columns by their places, and some by their headings alone, and nothing of the file: not how many columns it has,
 * nor its header row. So a column before the last one mapped that no target takes is not used. Whether there are columns
 * after it is not known, and the page says so rather than guess. A column a target names by its heading alone could be
 * any of them: where there is one, the columns no number takes may be used after all, and the page says that.
 *
 * Above the rows of an import into a list stands how it tells the list's items apart, in the dialog's own words: that is
 * why a list's Name, Parent or Code may rightly be fed by nothing.
 *
 * Of an import into a module the definition holds more, and the rows say it under their sources: a dimension's items
 * mapped by hand or ignored, the format of Time's periods, a date line item's format. Where the line items come from the
 * header row, each header the modeller mapped by hand is a row of its own, with its line item, and each one ignored a
 * row that says so, after the other columns. A header the import matches on a line item's name or code when it runs is
 * stored nowhere, and the page says so rather than list what it cannot know: with the line items such a header can be. */

/** A row of a mapping: its source, the target it feeds, and where there is more to say of how the source is read, a line
 * under the source; with the names that line lists in full, where it shows the first of them. */
export type MappingRow = [source: string, target: string, note?: string, all?: readonly string[]];

/** A mapping as the drawer shows it: for an import into a list, how it tells the list's items apart, above; a row of Source
 * and Target for each source and a target it feeds; then lines under them. */
export interface MappingView {
  match?: string;
  rows: MappingRow[];
  lines: string[];
}

/** The source of the line items from the header row, where nothing is mapped by hand: the dialog's "Match on names or codes". */
export const HEADER_ROW_MATCHED = "Header row: each column whose header is a line item's name or code";
/** The same where headers are mapped by hand: each is a row of its own, above this one. */
export const HEADER_ROW_BY_HAND = "Header row: each line item from the header mapped to it";
/** What the page says of the header row where nothing is mapped by hand: what the import matches when it runs is stored
 * nowhere. */
export const HEADER_ROW_UNSTORED = "Headers that match a line item's name or code are matched when the import runs; Anaplan stores no such match, so those columns are not listed.";
/** How many names a line under a source shows before it says how many more there are. */
const FIRST_NAMES = 5;

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

/** What feeds a target, in words: a column by the file's header for it alone, where the definition keeps it, and by its
 * place where it keeps only that; the constant's value, and so on. A column the definition gives only an identifier for
 * is said by it. The place of a column with a header still counts in the lines under the mapping (`columnLines`). */
export function sourceWords(target: MappedTarget): string {
  switch (target.source) {
    case "column":
      if (said(target.text)) return target.text;
      if (target.column !== undefined) return `Column ${target.column}`;
      return said(target.id) ? `Column with ID ${target.id}` : "A column the definition neither numbers nor names";
    case "constant":
      return said(target.text) ? `Constant: ${target.text}` : "Constant, with no value given";
    case "prompt":
      return "Prompt: chosen each time the import runs";
    case "ignore":
      return "Ignored";
    case "headerRow":
      return HEADER_ROW_MATCHED;
    case "none":
      return "Not mapped";
    case "numbered":
      return "Not mapped: the list numbers its items itself";
    default:
      return said(target.text) ? `A source Cardigan does not know (${target.text})` : "A source Cardigan does not know";
  }
}

/** How an import into a list tells the list's items apart, in the dialog's words for its choice under "Items uniquely
 * identified by" (anaplan/nls/importDefinitionHierarchyMapping), which for a numbered list names two choices otherwise. */
export function matchWords(match: ItemMatch): string {
  const choice = match.by === "nameOrCode" ? "Name or code"
    : match.by === "name" ? (match.numbered ? "Name (#ID)" : "Name only")
    : match.by === "code" ? (match.numbered ? "Code" : "Code only")
    : `Combination of properties${match.properties?.length ? `: ${listWords(match.properties)}` : ", with none chosen"}`;
  return `Items uniquely identified by: ${choice}.`;
}

/** Names as the page says them, in order: "Product", "Product and Location", "Product, Location and Expiry Date". */
const listWords = (names: readonly string[]): string => (names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`);

/** The kinds of source that feed a target from outside the columns, in the order the mapping lists them after the columns:
 * a source of a kind Cardigan does not know comes last. */
const NOT_COLUMNS: readonly MappedSource[] = ["constant", "prompt", "headerRow", "other"];

/** The kinds of target that nothing feeds: one not mapped, one the import ignores, and the items' names of a list that
 * numbers its items itself; each with what the line under the mapping says of it in brackets, where there is more to say. */
const UNFED: ReadonlyMap<MappedSource, string | undefined> = new Map<MappedSource, string | undefined>([
  ["none", undefined], ["ignore", "ignored"], ["numbered", "the list numbers its items itself"]]);

/** A heading as the dialog matches one with the header row: without the spaces around it, and in any case. */
const headingKey = (text: string): string => text.trim().toLowerCase();

/** A count with its noun: "1 item", "3 items". */
const counted = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`;

/** What more a row says of how its source is read, under the source: a dimension's items mapped by hand or ignored, the
 * line items a header can match where the header row is matched on names or codes, the format of Time's periods, a date
 * line item's format. Nothing where the definition says nothing more, and nothing for items matched on names or codes,
 * which a line under the rows says once for all of them. */
function noteOf(target: MappedTarget, lineItems: readonly string[] | undefined): [note?: string, all?: readonly string[]] {
  if (target.dateFormat !== undefined) return [`Date format: ${target.dateFormat}`];
  if (target.periodFormat !== undefined) return [target.periodFormat === null ? "Periods matched by their names" : `Period format: ${target.periodFormat}`];
  const handled = target.items ? target.items.byHand + target.items.ignored : 0;
  if (target.source === "headerRow") {
    if (target.items && handled) {
      return [`Mapped by hand: ${counted(target.items.byHand, "header", "headers")}${target.items.ignored ? `, ${target.items.ignored} ignored` : ""}`];
    }
    if (!lineItems?.length) return [];
    const first = lineItems.slice(0, FIRST_NAMES);
    const more = lineItems.length - first.length;
    const note = `Line items a header can match: ${more ? `${first.join(", ")} and ${more} more` : listWords(first)}`;
    return more ? [note, lineItems] : [note];
  }
  if (target.items && handled) {
    return [`${counted(target.items.byHand, "item", "items")} mapped by hand${target.items.ignored ? `, ${target.items.ignored} ignored` : ""}`];
  }
  return [];
}

/** A row of a target with what its note says, the note and its names left out where there are none. */
const rowOf = (source: string, target: MappedTarget, lineItems: readonly string[] | undefined): MappingRow => {
  const [note, all] = noteOf(target, lineItems);
  return note === undefined ? [source, target.target] : all === undefined ? [source, target.target, note] : [source, target.target, note, all];
};

/** The rows of a mapping, Source then Target. First each column that feeds a target, with every target it feeds together:
 * the columns with a place in their order, then the others in the definition's. A column kept by its heading alone is the
 * column of that heading where another target gives its place, and stands with it. Each row of a column says it as the
 * best of its targets does: by the header a target with its place keeps, else by any header kept for it. Then each
 * header of the header row mapped to a line item by hand that no column above already feeds it from, then each header
 * ignored, which feeds nothing. Then the constants, the prompts, the header row and any source of another kind, each kind
 * in the definition's order. A target that nothing feeds has no row. */
function sourceRows(targets: readonly MappedTarget[], headers: readonly ImportHeader[] = [], lineItems?: readonly string[]): MappingRow[] {
  const columns = targets.filter(target => target.source === "column");
  const placeOf = new Map<string, number>();
  for (const target of columns) {
    if (target.column !== undefined && said(target.text) && !placeOf.has(headingKey(target.text))) placeOf.set(headingKey(target.text), target.column);
  }
  const groups = new Map<string, { place?: number; first: number; targets: MappedTarget[] }>();
  columns.forEach((target, index) => {
    const place = target.column ?? (said(target.text) ? placeOf.get(headingKey(target.text)) : undefined);
    // A column is one by its place, else by its heading, else by its identifier; one with none of them stands alone.
    const key = place !== undefined ? `#${place}` : said(target.text) ? `h ${headingKey(target.text)}` : said(target.id) ? `i ${target.id.trim()}` : `n ${index}`;
    const group = groups.get(key);
    if (group) group.targets.push(target);
    else groups.set(key, { ...(place !== undefined ? { place } : {}), first: index, targets: [target] });
  });
  // A column without a place comes after those with one: two without one stand in the order of the definition.
  const ordered = [...groups.values()].sort((a, b) => (a.place ?? Infinity) - (b.place ?? Infinity) || a.first - b.first);
  const rows = ordered.flatMap(group => {
    const words = sourceWords(group.targets.find(target => target.column !== undefined && said(target.text))
      ?? group.targets.find(target => said(target.text)) ?? group.targets[0]);
    return group.targets.map(target => rowOf(words, target, lineItems));
  });
  // A header mapped by hand that a line item's own column above already gives is not said twice.
  const fed = new Set(columns.filter(target => said(target.text)).map(target => `${headingKey(target.text!)}\n${target.target}`));
  for (const { header, lineItem } of headers) if (lineItem !== undefined && !fed.has(`${headingKey(header)}\n${lineItem}`)) rows.push([header, lineItem]);
  for (const { header, lineItem } of headers) if (lineItem === undefined) rows.push([header, "Ignored"]);
  for (const kind of NOT_COLUMNS) {
    for (const target of targets) {
      if (target.source !== kind) continue;
      rows.push(rowOf(kind === "headerRow" && headers.length ? HEADER_ROW_BY_HAND : sourceWords(target), target, lineItems));
    }
  }
  return rows;
}

/** The lines under a mapping on what it does not store: that the items of the dimensions nothing is mapped for by hand
 * are matched on their names or codes when the import runs; and of the header row, that a header matched so is stored
 * nowhere, or that the definition keeps only the headers mapped by hand. */
function matchingLines(targets: readonly MappedTarget[], headers: readonly ImportHeader[]): string[] {
  const matched = targets.filter(target => target.source === "column" && target.items && !target.items.byHand && !target.items.ignored).map(target => target.target);
  const lines = matched.length ? [`Items of ${listWords(matched)} are matched on their names or codes when the import runs.`] : [];
  if (targets.some(target => target.source === "headerRow")) {
    lines.push(headers.length ? "Anaplan stores the headers mapped by hand; any other header of the header row is not known."
      : HEADER_ROW_UNSTORED);
  }
  return lines;
}

/** The line under a mapping that names the targets nothing feeds, in the definition's order, each with why where there is
 * more to say than that; none where every target has a source. */
export function unfedLine(targets: readonly MappedTarget[]): string | undefined {
  const unfed = targets.filter(target => UNFED.has(target.source)).map(target => {
    const why = UNFED.get(target.source);
    return why ? `${target.target} (${why})` : target.target;
  });
  return unfed.length ? `Not mapped: ${listWords(unfed)}.` : undefined;
}

/** What the mapping says of the columns it does not use: those before the last column it maps that no target takes, and
 * that what lies after that column is not known. A target that gives no place for its column could take any column, so
 * where there is one the columns no number takes may be used after all; and where none gives a place, nothing can be said
 * of the columns. */
export function columnLines(targets: readonly MappedTarget[]): string[] {
  const columns = targets.filter(target => target.source === "column");
  // The header row's columns are said by the lines on the header row (`matchingLines`).
  if (!columns.length) return targets.some(target => target.source === "headerRow") ? [] : ["No column is mapped."];
  const numbered = new Set(columns.flatMap(target => (target.column === undefined ? [] : [target.column])));
  const loose = columns.filter(target => target.column === undefined);
  const headed = loose.every(target => said(target.text));
  if (!numbered.size) {
    return [headed ? "Each column mapped is named by its heading alone, so Cardigan cannot say which columns are not used."
      : "The definition gives no column's place, so Cardigan cannot say which columns are not used."];
  }
  const last = Math.max(...numbered);
  const unused = Array.from({ length: last }, (_, index) => index + 1).filter(column => !numbered.has(column));
  const be = (numbers: readonly number[]): string => (numbers.length === 1 ? "is" : "are");
  const allUsed = last === 1 ? "Column 1 is used." : last === 2 ? "Columns 1 and 2 are both used." : `Columns 1 to ${last} are all used.`;
  const lines = [unused.length ? `${columnsWords(unused)} ${be(unused)} not used.` : allUsed];
  if (loose.length && unused.length) {
    const them = unused.length === 1 ? "it" : "them";
    const one = loose.length === 1;
    lines[0] = `${columnsWords(unused)} ${be(unused)} not mapped by number. ` + (headed
      ? `${one ? "1 target names its column" : `${loose.length} targets name their columns`} by heading alone, and may use ${them}.`
      : `${one ? "1 target gives no place for its column" : `${loose.length} targets give no place for their columns`}, and may use ${them}.`);
  }
  lines.push(`Whether there are columns after column ${last} is not known: Anaplan keeps the import's mapping, not the header row it was made from.`);
  return lines;
}

/** An import's mapping as the drawer shows it, or what stands in its place: why it could not be read, what an import of
 * another kind loads, or that the definition maps nothing. `lineItems` are the line items of the module it loads into
 * that a header can match, where the page knows them (`lineItemsOf`). */
export function mappingView(mapping: ImportMapping | undefined, lineItems?: readonly string[]): MappingView {
  if (!mapping) return { rows: [], lines: [NO_MAPPING] };
  if (mapping.note !== undefined) return { rows: [], lines: [mapping.note] };
  if (!LISTED.has(mapping.importType)) {
    const loads = LOADS.get(mapping.importType);
    return { rows: [], lines: [`${loads ? `This import loads ${loads}.` : "This import loads neither a module nor a list."} ${ONLY_LISTED}`] };
  }
  const match = mapping.matchedBy ? { match: matchWords(mapping.matchedBy) } : {};
  if (!mapping.targets.length) return { ...match, rows: [], lines: ["The import's definition maps no target."] };
  const unfed = unfedLine(mapping.targets);
  const headers = mapping.headers ?? [];
  return { ...match, rows: sourceRows(mapping.targets, headers, lineItems),
    lines: [...(unfed === undefined ? [] : [unfed]), ...matchingLines(mapping.targets, headers), ...columnLines(mapping.targets)] };
}

/** The line items of the module an import loads into that a header of its header row can match, by the import's Target
 * Object and the result's Line Items: each line item of that module, in the model's order, but one that holds no data (No
 * Data, a heading). None where the result has neither, or the module none. */
export function lineItemsOf(result: AnalysisResult, table: ResultTable, row: Row): string[] | undefined {
  const target = columnIndex(table, "Target Object");
  const module = target === undefined ? "" : cellText(row[target]).trim();
  const lineItems = result.tables.find(candidate => candidate.file === LINE_ITEMS_FILE);
  if (module === "" || !lineItems) return undefined;
  const [moduleName, format] = [columnIndex(lineItems, MODULE_NAME), columnIndex(lineItems, "Format")];
  if (moduleName === undefined) return undefined;
  const names = lineItems.rows.filter(line => cellText(line[moduleName]).trim() === module && (format === undefined || formatType(cellText(line[format])) !== "No Data"))
    .map(line => cellText(line[0]).trim()).filter(name => name !== "");
  return names.length ? names : undefined;
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
  // Names are told apart without the spaces around them, on both sides alike.
  const name = cellText(row[0]).trim();
  const at = table.rows.findIndex(candidate => candidate === row);
  const place = table.rows.slice(0, Math.max(0, at)).filter(other => cellText(other[0]).trim() === name && readsFile(other[type])).length;
  const mapping = mappings.filter(candidate => candidate.name.trim() === name)[place];
  // The line items a header can match are said only where the header row is matched on names or codes.
  const matched = mapping?.targets.some(target => target.source === "headerRow") && !mapping.headers?.length;
  return mappingView(mapping, matched ? lineItemsOf(result, table, row) : undefined);
}
