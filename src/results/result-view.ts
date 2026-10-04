import type { AnalysisResult, ResultTable } from "../result-types.js";
import { APP_FILES, columnIndex } from "./columns.js";
import { cellText, compareText, NONE } from "./table-engine.js";

/** What the results page reads out of a result besides its tables: the Details file's sections, the diagnostic log, and
 * what the overview says: its counts and notes, and everything the Details file holds, which has no view of its own.
 * Everything is taken from cells as they stand: nothing is split out of a joined text. */

/** The one file about the export itself (App Details.csv, Model Details.csv): rows of Section, Detail, Value. */
export const detailsOf = (result: AnalysisResult): ResultTable | undefined => result.tables.find(table => table.details === true);

/** The sections details.ts and the two exports write that the page treats on their own. */
const DIAGNOSTICS = "Diagnostics";
const NOTES = "Notes";
const FILES = "Files";
const HOW_TO_READ = "How to read";

export interface DetailSection { section: string; rows: [detail: string, value: string][] }

/** The Details file's rows under their sections, in the file's order, without the diagnostic log. */
export function detailSections(details: ResultTable | undefined): DetailSection[] {
  const sections = new Map<string, DetailSection>();
  for (const row of details?.rows ?? []) {
    const section = cellText(row[0]);
    if (section === DIAGNOSTICS) continue;
    let entry = sections.get(section);
    if (!entry) {
      entry = { section, rows: [] };
      sections.set(section, entry);
    }
    entry.rows.push([cellText(row[1]), cellText(row[2])]);
  }
  return [...sections.values()];
}

/** The diagnostic log the Details file carries, one line per row, each with its time as details.ts `diagnosticRows` split it. */
export function diagnosticLog(details: ResultTable | undefined): string[] {
  return (details?.rows ?? []).filter(row => cellText(row[0]) === DIAGNOSTICS).map(row => {
    const time = cellText(row[1]);
    return time ? `${time} ${cellText(row[2])}` : cellText(row[2]);
  });
}

/** One value of the Details file, or undefined when it has no such row. */
export function detailValue(details: ResultTable | undefined, section: string, detail: string): string | undefined {
  const row = details?.rows.find(candidate => cellText(candidate[0]) === section && cellText(candidate[1]) === detail);
  return row ? cellText(row[2]) : undefined;
}

/** The result's notes, one line each: its summary lines, then the Details file's Notes rows as "Detail: Value". A Notes row
 * whose text the summary already holds, word for word, is not said twice. A line that says only how many rows a file has
 * ("Line Items: 120 rows", as a model's summary lists every file) is left out: the overview's tiles say that. */
export function resultNotes(result: AnalysisResult): string[] {
  const rowCounts = new Set(result.tables.flatMap(table => ["rows", "row"].map(word => `${cellText(table.label)}: ${table.rows.length} ${word}`)));
  const summary = result.summary.map(cellText).filter(line => line !== "");
  const said = new Set(summary);
  const notes = summary.filter(line => !rowCounts.has(line));
  for (const row of detailsOf(result)?.rows ?? []) {
    if (cellText(row[0]) !== NOTES) continue;
    const detail = cellText(row[1]);
    const value = cellText(row[2]);
    const line = detail ? `${detail}: ${value}` : value;
    if (said.has(line) || said.has(value)) continue;
    said.add(line);
    notes.push(line);
  }
  return notes;
}

/** A file as the page shows it: the table it lists in the file's place, and a short line for under the table's name when
 * that table is not the file as it stands. What the page counts, searches, filters and opens is this table; the CSV, as a
 * table's download and in the zip, is always the file as the export wrote it. */
export interface FileView { table: ResultTable; note?: string }

/** A rule for one file: what the page shows in its place. It gives nothing when the file is not as the rule expects it,
 * and then the file is shown as it stands. */
export type FileRule = (file: ResultTable, result: AnalysisResult) => FileView | undefined;

/** A model's Model Calendar file (model/export.ts writes it under this name) follows a template: its first rows are about
 * the model itself (its workspace, its name, when it was captured), under the Section "Model", and the rest are the
 * calendar's settings. The rows about the model are not the calendar's, so the page says them with the model, in the
 * overview, and the table lists the others. */
export const MODEL_CALENDAR_FILE = "Model Calendar.csv";
/** The Section of the Model Calendar file's rows about the model. */
export const ABOUT_MODEL = "Model";

const calendarView: FileRule = file => {
  const about = columnIndex(file, "Section");
  if (about === undefined) return undefined;
  const rows = file.rows.filter(row => cellText(row[about]) !== ABOUT_MODEL);
  const left = file.rows.length - rows.length;
  // The line says where the rows are, so that the table's count is not taken for the file's.
  return left ? { table: { ...file, rows }, note: `${left} ${left === 1 ? "row about the model is" : "rows about the model are"} in the CSV only.` } : undefined;
};

/** The files the page shows otherwise than as they stand, each with its rule, by the kind of result and the file's name.
 * No other file is touched: a rule is a file's own, not a filter over all of them. */
export const FILE_RULES: Record<AnalysisResult["kind"], ReadonlyMap<string, FileRule>> = {
  app: new Map(),
  model: new Map([[MODEL_CALENDAR_FILE, calendarView]]),
};

/** One of the result's files as the page shows it: by its rule, or as it stands. */
export function fileView(result: AnalysisResult, file: ResultTable): FileView {
  return FILE_RULES[result.kind].get(file.file)?.(file, result) ?? { table: file };
}

/** What a model's Model Calendar file says about the model itself: each setting with its value, in the file's order. A
 * setting without a value, as the export leaves the ones it cannot know, is left out. */
export function modelFacts(result: AnalysisResult): [setting: string, value: string][] {
  const facts: [string, string][] = [];
  for (const table of result.kind === "model" ? result.tables.filter(candidate => candidate.file === MODEL_CALENDAR_FILE) : []) {
    const about = columnIndex(table, "Section");
    const setting = columnIndex(table, "Setting");
    const value = columnIndex(table, "Value");
    if (about === undefined || setting === undefined || value === undefined) continue;
    for (const row of table.rows) {
      if (cellText(row[about]) === ABOUT_MODEL && cellText(row[value]).trim() !== "") facts.push([cellText(row[setting]), cellText(row[value])]);
    }
  }
  return facts;
}

/** The order of a model's files in the navigation and among the overview's tiles: the order of Anaplan's own Model
 * settings, with the Actions list's files in the order the owner gave. Each file is known by the name model/export.ts
 * writes it under. Line Item Subsets is not exported yet, and has its place for when it is. A file of a result that is
 * not listed here comes after these, in the result's own order: a file that is renamed, or new, moves to the end and
 * does not go missing. */
export const MODEL_FILE_ORDER: readonly string[] = [
  MODEL_CALENDAR_FILE, "Time Ranges.csv", "Versions.csv", "General Lists.csv", "Line Item Subsets.csv", "Modules.csv", "Line Items.csv",
  "Processes.csv", "Imports.csv", "Import Data Sources.csv", "Exports.csv", "Other Actions.csv", "Source Models.csv",
];

/** The result's files as the page lists them, in the navigation and as the overview's tiles: every file but the Details
 * file, each with its place in the result's tables. An app's are in the result's order; a model's in `MODEL_FILE_ORDER`.
 * Only this list is ordered: the zip keeps the result's own order. */
export function listedTables(result: AnalysisResult): { index: number; table: ResultTable }[] {
  const tables = result.tables.map((table, index) => ({ index, table })).filter(({ table }) => table.details !== true);
  if (result.kind !== "model") return tables;
  const rank = (table: ResultTable): number => {
    const place = MODEL_FILE_ORDER.indexOf(table.file);
    return place < 0 ? MODEL_FILE_ORDER.length : place;
  };
  // The sort keeps the result's order among the files that are not listed, and among files of one name.
  return tables.sort((a, b) => rank(a.table) - rank(b.table));
}

/** What the header says was analysed. */
export interface Analysed { name: string; kind: string; host: string | undefined; exportedOn: string | undefined }
export function analysedOf(result: AnalysisResult): Analysed {
  const details = detailsOf(result);
  return {
    name: cellText(result.name), kind: result.kind === "model" ? "Model" : "App",
    host: detailValue(details, "Export", "Anaplan host"), exportedOn: detailValue(details, "Export", "Exported on"),
  };
}

/** The files that list a card's parts, as the design's card details show them: a heading per column, holding one of the
 * file's columns or several put side by side (a dash or a blank among several is left out). */
export const CARD_PARTS: readonly { file: string; title: string; none: string; columns: readonly (readonly [heading: string, headers: readonly string[], join?: string])[] }[] = [
  { file: APP_FILES["Grid sections"], title: "Grid sections", none: "grid sections", columns: [
    ["#", ["Section #"]], ["Layout", ["Section layout"]], ["Source module", ["Source module"]], ["Saved view", ["Saved view"]],
    ["Line items shown", ["Line items shown"]], ["Row filter", ["Row filter"]], ["Formatting", ["Conditional formatting"]]] },
  { file: APP_FILES.Filters, title: "Filters", none: "filters", columns: [
    ["Sec", ["Section #"]], ["Filter on", ["Filter on"]], ["Dimension", ["Filtered dimension"]], ["Group", ["Condition group", "Show items that match"], " · "],
    ["Condition", ["Condition line item", "Operator", "Value"]], ["Context", ["Condition context"]]] },
  { file: APP_FILES.Formatting, title: "Conditional formatting", none: "formatting rules", columns: [
    ["Sec", ["Section #"]], ["Style", ["Format style"]], ["Line item", ["Formatted line item"]], ["Driven by", ["Colour driven by"]], ["Colour stops", ["Colour stops"]]] },
  { file: APP_FILES.Actions, title: "Buttons & links", none: "buttons", columns: [
    ["Label", ["Button label"]], ["Action type", ["Action type"]], ["Model action", ["Model action name"]], ["Runs auto", ["Runs automatically"]], ["Cancel", ["Cancel button"]]] },
];

export interface CardSection { title: string; none: string; headings: string[]; rows: string[][] }

/** A card's parts: the rows of the other files that carry its Card ID on its page. A card is known by both, because a
 * page copied in Anaplan may keep its cards' IDs. A file the result does not have, or one without those two columns, is
 * left out. */
export function cardSections(result: AnalysisResult, page: string, cardId: string): CardSection[] {
  const sections: CardSection[] = [];
  for (const part of CARD_PARTS) {
    const table = result.tables.find(candidate => candidate.file === part.file);
    const pageColumn = table && columnIndex(table, "Page");
    const idColumn = table && columnIndex(table, "Card ID");
    if (!table || pageColumn === undefined || idColumn === undefined) continue;
    const indexes = part.columns.map(([, headers]) => headers.map(header => columnIndex(table, header)));
    const rows = table.rows.filter(row => cellText(row[idColumn]) === cardId && cellText(row[pageColumn]) === page);
    sections.push({
      title: part.title, none: part.none, headings: part.columns.map(([heading]) => heading),
      rows: rows.map(row => part.columns.map(([, , join], column) => {
        const texts = indexes[column].map(index => (index === undefined ? "" : cellText(row[index])));
        return texts.length === 1 ? texts[0] : texts.filter(text => text !== "" && text !== NONE).join(join ?? " ") || NONE;
      })),
    });
  }
  return sections;
}

/** The design's names for the overview's tiles, where a file is one of the app's: shorter than the file's own name, so
 * that a tile's name keeps to one line. Any other file's tile has the file's own label. */
const TILE_LABELS: ReadonlyMap<string, string> = new Map([
  [APP_FILES.Pages, "Pages"], [APP_FILES.Cards, "Cards"], [APP_FILES["Grid sections"], "Grid sections"], [APP_FILES.Filters, "Filters"],
  [APP_FILES.Formatting, "Formatting rules"], [APP_FILES.Actions, "Action buttons"], [APP_FILES["Where used"], "Where Used"],
]);

export interface ModelRow { model: string; workspace: string; modelId: string }
export interface Overview {
  /** Every file but the Details file, in the navigation's order (`listedTables`), with the number of rows its table lists. */
  tiles: { label: string; count: number }[];
  /** An app's cards by the text of their Card type, most first. */
  cardTypes: [type: string, count: number][];
  /** An app's models: each different Model, Workspace and Model ID its pages name, in the pages' order. */
  models: ModelRow[];
  /** The result's notes (`resultNotes`). */
  notes: string[];
  /** About this export: the Details file's rows of every section but its files, its notes, how to read them and the log,
   * in the file's order; then what a model's Model Calendar file says about the model (`modelFacts`), without what those
   * rows have said already. */
  about: [detail: string, value: string][];
  /** The Details file's rows about files, as far as a file's tile does not say the same: a file that was not exported,
   * and a count that comes with a remark. A row that says only how many rows a file of the result has is left to the tile. */
  files: [file: string, value: string][];
  /** How to read these files: the Details file's rows of that section. */
  howToRead: [detail: string, value: string][];
  /** The diagnostic log the result carries (`diagnosticLog`). */
  log: string[];
}

export function overviewOf(result: AnalysisResult): Overview {
  const tiles = listedTables(result).map(({ table }) => ({ label: TILE_LABELS.get(table.file) ?? cellText(table.label), count: fileView(result, table).table.rows.length }));

  const counts = new Map<string, number>();
  const cards = result.tables.find(table => table.file === APP_FILES.Cards);
  const type = cards && columnIndex(cards, "Card type");
  if (cards && type !== undefined) {
    for (const row of cards.rows) counts.set(cellText(row[type]), (counts.get(cellText(row[type])) ?? 0) + 1);
  }
  const cardTypes = [...counts].sort(([a, x], [b, y]) => y - x || compareText(a, b));

  const models = new Map<string, ModelRow>();
  const pages = result.tables.find(table => table.file === APP_FILES.Pages);
  const model = pages && columnIndex(pages, "Model");
  const workspace = pages && columnIndex(pages, "Workspace");
  const modelId = pages && columnIndex(pages, "Model ID");
  if (pages && model !== undefined && workspace !== undefined && modelId !== undefined) {
    for (const row of pages.rows) {
      const entry = { model: cellText(row[model]), workspace: cellText(row[workspace]), modelId: cellText(row[modelId]) };
      // A page that names no model at all (a dash in all three columns) is not a model.
      if (Object.values(entry).every(value => value === "" || value === NONE)) continue;
      const key = JSON.stringify(entry);
      if (!models.has(key)) models.set(key, entry);
    }
  }
  const sections = detailSections(detailsOf(result));
  const rowsOf = (name: string) => sections.find(section => section.section === name)?.rows ?? [];
  const about = sections.filter(section => ![FILES, NOTES, HOW_TO_READ].includes(section.section)).flatMap(section => section.rows);
  for (const fact of modelFacts(result)) {
    if (!about.some(([detail, value]) => detail === fact[0] && value === fact[1])) about.push(fact);
  }
  // The Details file says "1 rows" too: a count is the file's number of rows and the word, whatever the number.
  const onlyCounted = new Map(result.tables.map(table => [table.file, `${table.rows.length} rows`]));
  const files = rowsOf(FILES).filter(([file, value]) => onlyCounted.get(file) !== value);
  return { tiles, cardTypes, models: [...models.values()], notes: resultNotes(result), about, files, howToRead: rowsOf(HOW_TO_READ), log: diagnosticLog(detailsOf(result)) };
}
