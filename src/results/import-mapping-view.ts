import { readsFile, SOURCE_TYPE } from "../file-imports.js";
import { missingIn } from "../page-files.js";
import { POLARIS_MAPPING_NOTE } from "../polaris.js";
import { readImportItemNames, readImportMappings } from "../result-plain.js";
import type { AnalysisResult, FileOptions, ImportHeader, ImportMapping, ItemMatch, MappedSource, MappedTarget, ResultTable, TargetKind } from "../result-types.js";
import { columnIndex } from "./columns.js";
import { LINE_ITEMS_FILE, MODULE_NAME } from "./line-items-view.js";
import { formatType } from "./readable-cells.js";
import { IMPORTS_FILE } from "./result-view.js";
import { cellText, type Row } from "./table-engine.js";

/** The mapping of an import, as the details of its row of a model's Imports show it, before All details. It is the
 * import's own definition, which the export read (model/import-mappings.ts), so an import whose source is no longer
 * available shows it as well. Above it stands how the import's source is read: for uploaded data, its File Options, under
 * the one word of the page that names a file, "File", the word of Anaplan's own dialog for them; for a model's module,
 * saved view or list, the object, as the row of Imports names it. Otherwise no word here names a file: the page names
 * none (no-file.test-support.ts), and says "column" and "the header row" where the dialog says file's columns.
 *
 * An import into a module is laid out as Anaplan's import dialog lays it out (`moduleView`): what it does to the module
 * before it loads, the Mapping tab's "Clear target prior to import" or "Only update imported cells", by the heading; a
 * table of the module's dimensions, in the dialog's order (`DIMENSION_ORDER`), each with what feeds it, how its items are
 * matched and which of them it clears first, as the dimension's own tab says it; then its line items, each with its
 * column, or each header mapped manually with its line item; then each list whose items are mapped manually, each source
 * item with the item it is mapped to, as the list's own tab of the dialog shows them under Source Items and Mapped To. A
 * result an earlier version kept says of its targets neither what each is nor what it clears: its mapping into a module
 * stands as an import into a list does.
 *
 * An import into a list, as such a result's into a module, is a table of Source and Target: each source that feeds a
 * target of the import, with the target it feeds, the columns first and in their order; then a line that names the
 * targets nothing feeds, and what the mapping says of the columns it does not use. The source comes first because the
 * import is read from its source: a target that nothing feeds is no row, with nothing in its Source, but a name in that
 * line.
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
 * Of an import into a module an earlier version's result holds more, and the rows say it under their sources: a
 * dimension's items mapped manually or ignored, the format of Time's periods, a date line item's format. Where the line
 * items come from the header row, each header the modeller mapped manually is listed beneath it with its line item, and
 * each ignored header says so. A header the import matches on a line item's name or code when it runs is stored nowhere,
 * and the page says so rather than list what it cannot know: with the line items such a header can be. The header row
 * that holds Time's periods, or a list's items, is said so (`headerRowWords`).
 *
 * A line item the import still maps to that the model doesn't have is named Missing, with its ID, as the pages' tables
 * name one (page-files.ts `missingText`), and the last line under the mapping says what that means. */

/** A row of a mapping: its source, the target it feeds, and where there is more to say of how the source is read, a line
 * under the source; with the names that line lists in full, where it shows the first of them. */
export type MappingRow = [source: string, target: string, note?: string, all?: readonly string[], headers?: readonly string[]];

/** A row of the dimensions of an import into a module: the dimension, what feeds it, how its items or periods are matched,
 * and which of them the import clears first. Each but the dimension is empty where nothing applies. */
export type DimensionRow = [dimension: string, source: string, items: string, clear: string];
/** A row of the line items of an import into a module: what feeds a line item, the line item, and a line under the source
 * where there is more to say of how it is read. */
export type LineItemRow = [source: string, lineItem: string, note?: string];
/** A line the drawer shows in the place of a table or under it, with the names it lists in full where it shows the first
 * of them. */
export interface MappingNote { text: string; all?: readonly string[] }

/** The line items of an import into a module, under its dimensions: the rows of their table, under a heading that says
 * what feeds them, each header mapped manually ("Header"), each line item's own column ("Column"), or both ("Source"); and
 * the lines in the table's place or under it. `count` is how many the heading counts: the rows, or the line items a
 * header can match. */
export interface LineItemsView { count?: number; heading?: "Header" | "Column" | "Source"; rows: LineItemRow[]; notes: MappingNote[] }

/** A list whose items an import into a module maps manually, as the list's tab of the dialog shows them under Source Items
 * and Mapped To: the list by its name, and a row for each source item, in the order the definition keeps them, with the
 * item it is mapped to, by its name where the run named it, else by its ID, or Ignored. */
export interface PairsView { list: string; rows: [source: string, mappedTo: string][] }

/** A mapping as the drawer shows it. Above all, what an import into a module does to it before it loads (`clear`), and how
 * its source is read (`from`): the File Options of uploaded data, or the model's object it reads, each with its label.
 * For an import into a list, how it tells the list's items apart, and a row of Source and Target for each source and a
 * target it feeds. For an import into a module, its dimensions, its line items, and each list whose items it maps
 * manually. Then lines under them. */
export interface MappingView {
  clear?: string;
  from?: { label: "File" | "Source"; text: string };
  match?: string;
  dimensions?: DimensionRow[];
  lineItems?: LineItemsView;
  pairs?: PairsView[];
  rows: MappingRow[];
  lines: string[];
}

/** The source of the line items from the header row, where nothing is mapped manually: the dialog's "Match on names or codes". */
export const HEADER_ROW_MATCHED = "Header row: each column whose header is a line item's name or code";
/** The same where headers are mapped manually: each pair is listed beneath this source. */
export const HEADER_ROW_BY_HAND = "Header row: each line item from the header mapped to it";
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
/** The line under a mapping that names a line item the model doesn't have, worded as the pages' note on such things
 * (page-missing.ts `missingNote`). */
export const MISSING_LINE_ITEM_NOTE = "A missing line item is one this import still maps to that the model doesn't have: deleted since the import was saved, or hidden from you.";

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
      return headerRowWords(target);
    case "none":
      return "Not mapped";
    case "numbered":
      return "Not mapped: the list numbers its items itself";
    default:
      return said(target.text) ? `A source Cardigan does not know (${target.text})` : "A source Cardigan does not know";
  }
}

/** What a target of an import into a module is (result-types.ts `TargetKind`); in a result an earlier version kept, which
 * says it of none, what its name says of the dimensions the header row can feed: Time, Versions, the line items. */
const kindOf = (target: MappedTarget): TargetKind | undefined => target.kind
  ?? (target.target === "Time" ? "time" : target.target === "Versions" ? "versions" : target.target === "Line Items" ? "lineItems" : undefined);

/** The header row as the source of what it feeds, in words for what it holds: the line items, a column for each whose
 * header is a line item's name or code (`HEADER_ROW_MATCHED`); Time's periods; the versions; or a list's items. */
function headerRowWords(target: MappedTarget): string {
  const kind = kindOf(target);
  return kind === "lineItems" ? HEADER_ROW_MATCHED : kind === "time" ? "Header row: the periods" : kind === "versions" ? "Header row: the versions"
    : `Header row: the items of ${target.target}`;
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

/** The line items a header can match, where the header row is matched on names or codes: the first five, and how many
 * more, with all of them where there are more. Nothing where none is known. */
function canMatch(lineItems: readonly string[] | undefined): [note?: string, all?: readonly string[]] {
  if (!lineItems?.length) return [];
  const first = lineItems.slice(0, FIRST_NAMES);
  const more = lineItems.length - first.length;
  const note = `Line items a header can match: ${more ? `${first.join(", ")} and ${more} more` : listWords(first)}`;
  return more ? [note, lineItems] : [note];
}

/** What more a row says of how its source is read, under the source: a dimension's items mapped manually or ignored, the
 * line items a header can match where the header row that holds them is matched on names or codes, the format of Time's
 * periods, a date line item's format. Nothing where the definition says nothing more, and nothing for items matched on
 * names or codes, which a line under the rows says once for all of them. */
function noteOf(target: MappedTarget, lineItems: readonly string[] | undefined): [note?: string, all?: readonly string[]] {
  if (target.dateFormat !== undefined) return [`Date format: ${target.dateFormat}`];
  if (target.periodFormat !== undefined) return [target.periodFormat === null ? "Periods matched by their names" : `Period format: ${target.periodFormat}`];
  const handled = target.items ? target.items.byHand + target.items.ignored : 0;
  if (target.source === "headerRow") {
    if (target.items && handled) {
      return [`Mapped manually: ${counted(target.items.byHand, "header", "headers")}${target.items.ignored ? `, ${target.items.ignored} ignored` : ""}`];
    }
    // Only a header row of line items has line items a header can match.
    return kindOf(target) === "lineItems" ? canMatch(lineItems) : [];
  }
  if (target.items && handled) {
    return [`${counted(target.items.byHand, "item", "items")} mapped manually${target.items.ignored ? `, ${target.items.ignored} ignored` : ""}`];
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
 * constant, prompt, header row and source of another kind, each kind in the definition's order. Stored header pairs
 * stand beneath the header row. A target that nothing feeds has no row. */
function sourceRows(targets: readonly MappedTarget[], headers: readonly ImportHeader[] = [], lineItems?: readonly string[]): MappingRow[] {
  const underHeader = targets.some(target => target.source === "headerRow") && headers.length > 0;
  const columns = targets.filter(target => target.source === "column" && !(underHeader && target.dateFormat === undefined && headers.some(entry =>
    entry.lineItem === target.target && said(target.text) && headingKey(entry.header) === headingKey(target.text))));
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
  // A header mapped manually that a line item's own column above already gives is not said twice.
  const fed = new Set(columns.filter(target => said(target.text)).map(target => `${headingKey(target.text!)}\n${target.target}`));
  if (!underHeader) {
    for (const { header, lineItem } of headers) if (lineItem !== undefined && !fed.has(`${headingKey(header)}\n${lineItem}`)) rows.push([header, lineItem]);
    for (const { header, lineItem } of headers) if (lineItem === undefined) rows.push([header, "Ignored"]);
  }
  for (const kind of NOT_COLUMNS) {
    for (const target of targets) {
      if (target.source !== kind) continue;
      if (kind === "headerRow" && underHeader) {
        rows.push([HEADER_ROW_BY_HAND, target.target, undefined, undefined,
          headers.map(({ header, lineItem }) => lineItem === undefined ? `${header}: Ignored` : `${header} to ${lineItem}`)]);
        continue;
      }
      rows.push(rowOf(kind === "headerRow" && headers.length ? HEADER_ROW_BY_HAND : sourceWords(target), target, lineItems));
    }
  }
  return rows;
}

/** The lines under a mapping on what it does not store: that the items of the dimensions nothing is mapped for manually
 * are matched on their names or codes when the import runs; the general explanation of saved headers is in How to read. */
function matchingLines(targets: readonly MappedTarget[]): string[] {
  const matched = targets.filter(target => target.source === "column" && target.items && !target.items.byHand && !target.items.ignored).map(target => target.target);
  const lines = matched.length ? [`Items of ${listWords(matched)} are matched on their names or codes when the import runs.`] : [];
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
 * that a column without a number may use one of those places. A target that gives no place for its column could take any column, so
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
  return lines;
}

/** Whether a mapping names a line item the model doesn't have (page-files.ts `missingIn`), where it names things: a target, a
 * constant, a header's line item, or a property that tells a list's items apart. A column's heading or a header is the
 * file's own text, and says nothing of the model. */
function namesMissingLineItem(mapping: ImportMapping): boolean {
  const names = [...mapping.targets.flatMap(target => [target.target, ...(target.source === "constant" && target.text !== undefined ? [target.text] : [])]),
    ...(mapping.headers ?? []).flatMap(({ lineItem }) => (lineItem === undefined ? [] : [lineItem])), ...(mapping.matchedBy?.properties ?? [])];
  return names.some(name => missingIn(name).some(({ kind }) => kind === "line item"));
}

/** What an import into a module does to it before it loads, in its dialog's words (anaplan/nls/importDefinitionModuleMapping
 * `labelClearItemsRadioButtonLabel`, `labelReplaceItemsRadioButtonLabel`). */
export const CLEAR_TARGET = "Clear target prior to import";
export const ONLY_UPDATE = "Only update imported cells";

/** Which of a dimension's items an import clears first, in the words of the dimension's tab of the dialog
 * (anaplan/nls/mappedDimensionImportOptions, and anaplan/nls/timeDimensionImportOptions for Time's matched items), by the
 * definition's word for it. A word the dialog has no label for is said as it is. */
export function areaWords(area: string, time = false): string {
  switch (area) {
    case "MATCHED_ITEMS": return time ? "Matched items only" : "Matched items in source";
    case "MAPPED_ITEMS_IN_SOURCE": return "Mapped items in source";
    case "ALL_MAPPED_ITEMS": return "All mapped items";
    case "ALL_ITEMS": return "All items";
    default: return area;
  }
}

/** A character of a source's settings in words: the column separators of Anaplan's dialog by their names, a space by its
 * name, a character that shows nothing by its code ("U+001F"), and any other as itself. */
function characterWords(character: string): string {
  if (character === "\t") return "Tab";
  if (character === ",") return "Comma";
  if (character === ";") return "Semicolon";
  if (character === " ") return "Space";
  const code = character.codePointAt(0) ?? 0;
  return code < 32 || (code >= 127 && code < 160) || /^\s$/u.test(character) ? `U+${code.toString(16).toUpperCase().padStart(4, "0")}` : character;
}

/** The File Options of uploaded data, in a line, as Anaplan's dialog sets them out, each part where the source holds it:
 * the header row ("Header row 1", or "No header row" for 0) and the first row of data ("data from row 2"); the column
 * separators, each by its name or as itself, "Comma and Tab", or "No column separator" for none; the text delimiter, '"'
 * or "'", "no text delimiter" for none (as the dialog takes a nought too), or another character with what it is; the
 * decimal separator, Dot or Comma, or another with what it is; and the encoding, by Anaplan's name for it. */
export function fileOptionsWords(options: FileOptions): string {
  const parts: string[] = [];
  if (options.headerRow !== undefined) parts.push(options.headerRow === 0 ? "No header row" : `Header row ${options.headerRow}`);
  if (options.firstDataRow !== undefined) parts.push(`${parts.length ? "data" : "Data"} from row ${options.firstDataRow}`);
  if (options.separators !== undefined) {
    const characters = [...new Set(Array.from(options.separators))];
    parts.push(characters.length ? listWords(characters.map(characterWords)) : "No column separator");
  }
  if (options.delimiter !== undefined) {
    const delimiter = options.delimiter;
    parts.push(delimiter === "" || delimiter === "\u0000" ? "no text delimiter" : delimiter === '"' || delimiter === "'" ? delimiter
      : `${Array.from(delimiter).map(characterWords).join("")} as text delimiter`);
  }
  if (options.decimal !== undefined) {
    parts.push(options.decimal === "." ? "Dot" : options.decimal === "," ? "Comma" : `${Array.from(options.decimal).map(characterWords).join("")} as decimal separator`);
  }
  if (options.encoding !== undefined && options.encoding.trim() !== "") parts.push(options.encoding.trim());
  return parts.join(" · ");
}

/** What feeds a target of an import into a module, in the words of the dialog's choices (anaplan/nls/
 * importDefinitionModuleMapping): a column by its place and its heading as the definition keeps them, "Column 3: Price",
 * "Column: Price" or "Column 3"; the header row; a prompt each run; a fixed item, by its value; not applicable to this
 * import; or not mapped. A column the definition gives only an identifier for is said by it. */
export function moduleSourceWords(target: MappedTarget): string {
  switch (target.source) {
    case "column":
      if (said(target.text)) return target.column !== undefined ? `Column ${target.column}: ${target.text}` : `Column: ${target.text}`;
      if (target.column !== undefined) return `Column ${target.column}`;
      return said(target.id) ? `Column with ID ${target.id}` : "A column the definition neither numbers nor names";
    case "headerRow":
      return "Header row";
    case "prompt":
      return "Prompt each run";
    case "constant":
      return said(target.text) ? `Fixed: ${target.text}` : "Fixed, with no value given";
    case "ignore":
      return "Not applicable";
    default:
      return sourceWords(target);
  }
}

/** The kinds of target of an import into a module that are its dimensions, and so rows of its table of dimensions. A
 * target of a kind Cardigan does not know stands among them, by its name. */
const DIMENSIONS: ReadonlySet<TargetKind> = new Set<TargetKind>(["time", "versions", "list", "lineItems", "other"]);

/** Where each kind of dimension stands in the table, as the dialog orders its dimensions (view/ImportDefinition.js
 * `_getDimensionsInfo`): Time first, then the lists and list subsets, then Versions, then the line items; dimensions of one
 * kind in the definition's order. The dialog puts the list that has the model's workflow before all of them, which it
 * knows by the model's lists in its memory, not by the definition: here it stands among the lists. A target of a kind
 * Cardigan does not know stands among the lists, by its name. */
const DIMENSION_ORDER: Readonly<Partial<Record<TargetKind, number>>> = { time: 0, list: 1, other: 1, versions: 2, lineItems: 3 };

/** How a dimension's items, or Time's periods, are matched to what feeds them, as the dimension's tab says it: Time's
 * periods by a format, or by their names; a dimension's items on their names or codes, or mapped manually. Mapped manually
 * says how many and how many are ignored, but for line items whose table lists them (`listed`). Nothing for a dimension
 * fed by anything but a column or the header row, nor where the definition says nothing. */
function itemsWords(target: MappedTarget, listed: boolean): string {
  if (target.source !== "column" && target.source !== "headerRow") return "";
  if (target.kind === "time") return target.periodFormat === null ? "Periods matched by their names" : target.periodFormat !== undefined ? `Periods, ${target.periodFormat}` : "";
  if (!target.items) return "";
  const { byHand, ignored } = target.items;
  if (!byHand && !ignored) return "Matched on names or codes";
  return listed ? "Mapped manually" : `Mapped manually: ${counted(byHand, "item", "items")}${ignored ? `, ${ignored} ignored` : ""}`;
}

/** The line items of an import into a module (`LineItemsView`), or none where there is nothing to say of them beyond the
 * row of the line items' dimension:
 * - each line item's own mapping, with what feeds it, as a column's place and heading say it, and its date format. Where
 *   a column of values feeds the line items each row names, the dialog keeps no column of a line item's own
 *   (view/ImportDefinitionModuleMapping.js `_initSingleOrMultipleColumnDataValues`): a line item's that is not mapped is
 *   then no row. Nor is one that a header mapped manually feeds.
 * - each header mapped manually, with its line item or Ignored, but one that a line item's own column already says.
 * - with neither, where the header row is matched on names or codes, the line items a header can match, where the page
 *   knows them: what each header may be, not what it is.
 * - the line item a constant fixes, in the dialog's words.
 * - the column of values, where one feeds the line items each row names: the dialog's "Data values from". */
function lineItemsView(mapping: ImportMapping, lineItems: readonly string[] | undefined): LineItemsView | undefined {
  const dimension = mapping.targets.find(target => target.kind === "lineItems");
  const value = mapping.targets.find(target => target.kind === "value" && target.source !== "none");
  const own = mapping.targets.filter(target => target.kind === "lineItem");
  const columns = new Set(own.filter(target => target.source === "column" && said(target.text)).map(target => `${headingKey(target.text!)}\n${target.target}`));
  const pairs = (mapping.headers ?? []).filter(({ header, lineItem }) => lineItem === undefined || !columns.has(`${headingKey(header)}\n${lineItem}`));
  const paired = new Set(pairs.flatMap(({ lineItem }) => (lineItem === undefined ? [] : [lineItem])));
  const shown = own.filter(target => target.source !== "none" || (!value && !paired.has(target.target)));
  const rows: LineItemRow[] = [...shown.map((target): LineItemRow => (target.dateFormat === undefined ? [moduleSourceWords(target), target.target]
    : [moduleSourceWords(target), target.target, `Date format: ${target.dateFormat}`])), ...pairs.map(({ header, lineItem }): LineItemRow => [header, lineItem ?? "Ignored"])];
  const notes: MappingNote[] = [];
  let count = rows.length || undefined;
  if (!rows.length && dimension?.source === "headerRow") {
    const [text, all] = canMatch(lineItems);
    if (text !== undefined) {
      notes.push(all ? { text, all } : { text });
      count = lineItems?.length;
    }
  }
  if (dimension?.source === "constant") notes.push({ text: said(dimension.text) ? `Fixed line item: ${dimension.text}. Every value loads into it.` : "Fixed line item, with no line item given." });
  if (value) notes.push({ text: `Data values from ${moduleSourceWords(value)}` });
  if (!rows.length && !notes.length) return undefined;
  const heading = !rows.length ? undefined : !pairs.length ? "Column" : !shown.length ? "Header" : "Source";
  return { ...(count !== undefined ? { count } : {}), ...(heading ? { heading } : {}), rows, notes };
}

/** The dimensions of an import into a module in the dialog's order (`DIMENSION_ORDER`), those of a kind in the
 * definition's order. */
function dimensionsOf(mapping: ImportMapping): MappedTarget[] {
  const place = (target: MappedTarget): number => (target.kind === undefined ? 1 : DIMENSION_ORDER[target.kind] ?? 1);
  return mapping.targets.filter(target => target.kind !== undefined && DIMENSIONS.has(target.kind)).map((target, at) => ({ target, at }))
    .sort((a, b) => place(a.target) - place(b.target) || a.at - b.at).map(({ target }) => target);
}

/** Each list of an import into a module whose items are mapped manually, in the order of the dimensions (`PairsView`):
 * each source item with the name of the item it is mapped to, as the run named it (`names`, by the item's ID), else its
 * ID, as the page says one the model gave no name for, or Ignored. */
function pairsViews(dimensions: readonly MappedTarget[], names: ReadonlyMap<string, string> | undefined): PairsView[] {
  const mappedTo = (item: string | undefined): string => {
    if (item === undefined) return "Ignored";
    const name = names?.get(item);
    return said(name) ? name : `ID ${item}`;
  };
  return dimensions.filter(target => target.kind === "list" && target.pairs?.length).map(target => ({ list: target.target,
    rows: target.pairs!.map(({ source, item }): [string, string] => [source, mappedTo(item)]) }));
}

/** An import into a module, laid out as its dialog lays it out (`MappingView`): what it clears, its dimensions, its line
 * items and each list whose items it maps manually, then the lines under them. A dimension's clear choice is said only
 * where the import clears its target first: the dialog hides it otherwise (view/MappedDimensionImportOptions.js
 * `displayTargetItemsOptions`). The lines say where the header row holds Time's periods or a list's items, that items
 * matched on names or codes are matched when the import runs, what the mapping says of the columns it does not use, for
 * uploaded data, and what a missing line item is. `names` are the names the run read of the items mapped manually. */
function moduleView(mapping: ImportMapping, lineItems: readonly string[] | undefined, model: boolean, names: ReadonlyMap<string, string> | undefined):
  Pick<MappingView, "clear" | "dimensions" | "lineItems" | "pairs" | "lines"> {
  const update = mapping.clear === "update";
  const items = lineItemsView(mapping, lineItems);
  const ordered = dimensionsOf(mapping);
  const dimensions = ordered.map((target): DimensionRow => [target.target,
    moduleSourceWords(target), itemsWords(target, target.kind === "lineItems" && (items?.rows.length ?? 0) > 0),
    update || target.area === undefined ? "" : areaWords(target.area, target.kind === "time")]);
  const pairs = pairsViews(ordered, names);
  const holds = mapping.targets.filter(target => target.source === "headerRow" && target.kind !== "lineItems" && target.kind !== "other").map(target =>
    (target.kind === "time" ? "The periods are in the header row." : target.kind === "versions" ? "The versions are in the header row." : `The items of ${target.target} are in the header row.`));
  const matched = mapping.targets.some(target => target.kind !== "time" && target.items && !target.items.byHand && !target.items.ignored
    && (target.source === "column" || target.source === "headerRow"));
  return { ...(mapping.clear ? { clear: update ? ONLY_UPDATE : CLEAR_TARGET } : {}), dimensions, ...(items ? { lineItems: items } : {}), ...(pairs.length ? { pairs } : {}),
    lines: [...holds, ...(matched ? ["Items set to match on names or codes are paired when the import runs, so Anaplan saves no pairs for them."] : []),
      ...(model ? [] : columnLines(mapping.targets)), ...(namesMissingLineItem(mapping) ? [MISSING_LINE_ITEM_NOTE] : [])] };
}

/** Whether a mapping says what each of its targets is, as a result of this version does of an import into a module: one
 * an earlier version kept is shown as an import into a list is. */
const laidOutAsModule = (mapping: ImportMapping): boolean => mapping.importType === "MODULE_DATA" && mapping.targets.length > 0
  && mapping.targets.every(target => target.kind !== undefined);

/** An import's mapping as the drawer shows it, or what stands in its place: why it could not be read, what an import of
 * another kind loads, or that the definition maps nothing. `lineItems` are the line items of the module it loads into
 * that a header can match, where the page knows them (`lineItemsOf`). `source` is the model's object an import of one
 * reads, as its row of Imports names it (`sourceLine`): the line the File Options of uploaded data stand in otherwise. Of
 * a model's object, no column is numbered, and nothing is said of the columns it does not use. The last line says what a
 * missing line item is, where the mapping names one. `names` are the names the run read of the items that imports into
 * modules map manually, by their IDs (result-types.ts `importItemNames`). */
export function mappingView(mapping: ImportMapping | undefined, lineItems?: readonly string[], source?: string, names?: ReadonlyMap<string, string>): MappingView {
  if (!mapping) return { rows: [], lines: [NO_MAPPING] };
  if (mapping.note !== undefined) return { rows: [], lines: [mapping.note] };
  if (!LISTED.has(mapping.importType)) {
    const loads = LOADS.get(mapping.importType);
    return { rows: [], lines: [`${loads ? `This import loads ${loads}.` : "This import loads neither a module nor a list."} ${ONLY_LISTED}`] };
  }
  const options = mapping.fileOptions ? fileOptionsWords(mapping.fileOptions) : "";
  const from = options ? { from: { label: "File" as const, text: options } } : source ? { from: { label: "Source" as const, text: source } } : {};
  const clear = mapping.importType === "MODULE_DATA" && mapping.clear ? { clear: mapping.clear === "update" ? ONLY_UPDATE : CLEAR_TARGET } : {};
  const match = mapping.matchedBy ? { match: matchWords(mapping.matchedBy) } : {};
  if (!mapping.targets.length) return { ...clear, ...from, ...match, rows: [], lines: ["The import's definition maps no target."] };
  const model = !readsFile(mapping.sourceType ?? "FILE") && mapping.sourceType !== "" && !options;
  if (laidOutAsModule(mapping)) return { ...from, ...moduleView(mapping, lineItems, model, names), rows: [] };
  const unfed = unfedLine(mapping.targets);
  const headers = mapping.headers ?? [];
  return { ...clear, ...from, ...match, rows: sourceRows(mapping.targets, headers, lineItems),
    lines: [...(unfed === undefined ? [] : [unfed]), ...matchingLines(mapping.targets), ...(model ? [] : columnLines(mapping.targets)),
      ...(namesMissingLineItem(mapping) ? [MISSING_LINE_ITEM_NOTE] : [])] };
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

/** A Source Type as the page tells one from another: without the spaces around it, and in any case, as `readsFile` reads
 * FILE. */
const typeKey = (cell: unknown): string => cellText(cell).trim().toUpperCase();

/** The model's object an import of one reads, as its row of Imports names it, in a line: the model, the module and the
 * saved view, each with what it is, where the table shows Source Object as those three (result-view.ts `importsRule`);
 * the list an import of a list reads, as the cell writes it, under Source Model, or under Source Object where the table
 * shows that as it stands; any other object as the cell writes it. None where the row says none. */
export function sourceLine(table: ResultTable, row: Row): string | undefined {
  const part = (label: string): string => {
    const at = columnIndex(table, label);
    return at === undefined ? "" : cellText(row[at]).trim();
  };
  const [model, module, view] = [part("Source Model") || part("Source Object"), part("Source Module"), part("Saved View")];
  const type = columnIndex(table, SOURCE_TYPE);
  if (module !== "") return [`Model: ${model || "This model"}`, `Module: ${module}`, ...(view ? [`Saved view: ${view}`] : [])].join(" · ");
  if (model === "" || model === "-") return undefined;
  return type !== undefined && typeKey(row[type]) === "LIST" ? `List: ${model}` : model;
}

/** The mapping for a row of a model's Imports, where its Source Type says anything, and where the result has mappings,
 * checked as the bridge checks them (result-plain.ts `readImportMappings`). None for any other row, such as one of an
 * import the Actions list has and the Imports tab did not give, and for a result without mappings: the drawer then has no
 * Mapping. The Imports table has no column of IDs, so the row's mapping is the one of its name, the import's own name, and
 * of its Source Type; among imports of both alike, the one in the row's place among them, as the export lists them in the
 * Imports tab's order, which the table keeps. A result an earlier version kept has mappings of imports from a file alone,
 * without their Source Type: they are taken for those of FILE (file-imports.ts `readsFile`), and a row of another Source
 * Type has none, which the drawer says, with what to do. `table` is the Imports table as the page shows it, whose rows
 * stand each in the place it has in the file (result-view.ts `fileView`). An import of a model's object has the object as
 * its row names it (`sourceLine`). The items an import into a module maps manually are named as the result names them,
 * checked as the bridge checks them (result-plain.ts `readImportItemNames`). */
export function mappingOfRow(result: AnalysisResult | undefined, table: ResultTable, row: Row): MappingView | undefined {
  if (result?.kind !== "model" || table.file !== IMPORTS_FILE) return undefined;
  if (result.engine === "polaris") return { rows: [], lines: [POLARIS_MAPPING_NOTE] };
  const type = columnIndex(table, SOURCE_TYPE);
  const kind = type === undefined ? "" : typeKey(row[type]);
  if (type === undefined || kind === "") return undefined;
  const mappings = readImportMappings(result.importMappings);
  if (!mappings) return undefined;
  // Names are told apart without the spaces around them, on both sides alike.
  const name = cellText(row[0]).trim();
  const at = table.rows.findIndex(candidate => candidate === row);
  const place = table.rows.slice(0, Math.max(0, at)).filter(other => cellText(other[0]).trim() === name && typeKey(other[type]) === kind).length;
  const mapping = mappings.filter(candidate => candidate.name.trim() === name && typeKey(candidate.sourceType ?? "FILE") === kind)[place];
  // The line items a header can match are said only where the header row of line items is matched on names or codes.
  const matched = mapping?.targets.some(target => target.source === "headerRow" && kindOf(target) === "lineItems") && !mapping.headers?.length;
  const names = new Map(readImportItemNames(result.importItemNames) ?? []);
  return mappingView(mapping, matched ? lineItemsOf(result, table, row) : undefined, readsFile(row[type]) ? undefined : sourceLine(table, row), names);
}
