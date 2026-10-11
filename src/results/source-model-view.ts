import { unquote } from "../map/graph-names.js";
import type { AnalysisResult, ResultTable } from "../result-types.js";
import { cellLists } from "./cell-lists.js";
import { columnIndex } from "./columns.js";
import { IMPORTS_FILE, SOURCE_MODELS_FILE } from "./result-view.js";
import { sourceObjectOf } from "./source-object.js";
import { cellText, type Row } from "./table-engine.js";

/** What a model's source model gives it, as the details of its row of Source Models show them, above All columns: the
 * objects of that model the imports read, each with its kind, from the rows of Import Data Sources whose Source Model is
 * this one; then the imports that read them, each with the objects it reads. The Source Models grid itself only counts
 * them (Sources, Imports): the names are in the other two tables.
 *
 * A source model is found in those tables by its name, as each writes it. Nothing is guessed: a name is the same where it
 * is the same text, without the spaces at its ends and with any run of spaces as one, and out of its quotes. Where the
 * row's name is not found that way, the model's own name is tried, the part after the last " / " where one table writes
 * the model behind its workspace ("DEV - Supply Chain / DEV - Demand") and the other does not, but only where no other
 * source model has that part too: which of the two is meant is not otherwise known. An import's source model comes from
 * its Source Object, as the Imports table shows it (source-object.ts), where Import Data Sources lists none of its
 * objects. A source model found in neither table gets no section: the details never show an empty list. */

/** The file of a model's import data sources, by the name model/export.ts writes it under. */
export const DATA_SOURCES_FILE = "Import Data Sources.csv";
/** The columns read, by the grid's own headers. Anaplan's grid heads the data sources' imports Imports; an earlier
 * export, as the tests' exports, Used in Imports (cell-lists.ts). */
const SOURCE_MODEL = "Source Model";
const SOURCE_TYPE = "Source Type";
const SOURCE_OBJECT_NAME = "Source Object Name";
const DATA_SOURCE_IMPORTS = ["Imports", "Used in Imports"];
/** Source Models' own columns, which count what the sections list. */
const SOURCES = "Sources";
const IMPORTS = "Imports";
/** Where an import reads from, as the Imports tab writes it. */
const SOURCE_OBJECT = "Source Object";

/** One object of the source model that the imports read: its name, its kind in words, and its row of Import Data
 * Sources, by its place among that table's rows. */
export interface SourceView { name: string; kind: string; row: number }
/** One import that reads from the source model: its name, and the objects it reads, by their names. */
export interface SourceImportView { name: string; from: string[] }
/** A source model's objects and imports as the details show them, with the lines under each about a count that is not
 * what the row says. */
export interface SourceModelView {
  sources: SourceView[];
  imports: SourceImportView[];
  sourceLines: string[];
  importLines: string[];
}

/** Each kind of object a data source may be, by the grid's word for it: what the details call it. Any other word is said as
 * the grid writes it. */
const KINDS: ReadonlyMap<string, string> = new Map([["SAVED VIEW", "Saved view"], ["SAVED_VIEW", "Saved view"], ["VIEW", "Saved view"],
  ["MODULE", "Module"], ["LIST", "List"], ["HIERARCHY", "List"]]);

/** A name as two cells are compared: out of its quotes, without the spaces at its ends, any run of spaces as one. */
function sameAs(text: string): string {
  return unquote(text.trim()).replace(/\s+/g, " ").trim();
}
/** A model's own name: the part after the last " / " of a name written behind its workspace, or the name itself. */
function ownPart(name: string): string {
  const at = name.lastIndexOf(" / ");
  return at < 0 ? name : name.slice(at + 3).trim();
}

/** Whether a cell names the source model `name`: the same name, or else, where the cell or the name has a workspace in
 * front and the other has not, the same model's own name, if `unique` says no other source model has it. */
function names(cell: string, name: string, unique: (own: string) => boolean): boolean {
  const said = sameAs(cell);
  if (said === "" || said === "-") return false;
  if (said === name) return true;
  const own = ownPart(name);
  const saidOwn = ownPart(said);
  return (said === own || saidOwn === name) && saidOwn === own && unique(own);
}

const count = (amount: number, one: string, many: string): string => (amount === 1 ? `1 ${one}` : `${amount} ${many}`);

/** The number a count cell holds, or none for a cell that holds no whole number. */
function numberIn(cell: unknown): number | undefined {
  const text = cellText(cell).trim().replace(/,/g, "");
  return /^\d+$/.test(text) ? Number(text) : undefined;
}

/** The line under a section where the row counts another number than the section lists. */
function countLine(said: number | undefined, found: number, column: string, where: string): string[] {
  if (said === undefined || said === found) return [];
  return [`${column} counts ${said}; ${found === 0 ? "none is" : count(found, "is", "are")} found in ${where}.`];
}

/** The source model a row of a model's Source Models is, with its objects and its imports, or none for any other row, an
 * app's result, and a source model neither Import Data Sources nor Imports names. `table` is Source Models as the page
 * shows it, whose rows keep the grid's first cell, the source model's name, and its Sources and Imports. */
export function sourceModelOfRow(result: AnalysisResult | undefined, table: ResultTable, row: Row): SourceModelView | undefined {
  if (result?.kind !== "model" || table.file !== SOURCE_MODELS_FILE) return undefined;
  const name = sameAs(cellText(row[0]));
  if (name === "") return undefined;
  // How many source models have each own name: one that two have tells neither apart.
  const owns = new Map<string, number>();
  for (const other of table.rows) {
    const own = ownPart(sameAs(cellText(other[0])));
    owns.set(own, (owns.get(own) ?? 0) + 1);
  }
  const unique = (own: string): boolean => owns.get(own) === 1;

  const sources: SourceView[] = [];
  const imports = new Map<string, string[]>();
  const addImport = (importName: string, from?: string): void => {
    const key = importName.trim();
    if (key === "") return;
    const reads = imports.get(key) ?? [];
    if (from !== undefined && !reads.includes(from)) reads.push(from);
    imports.set(key, reads);
  };

  const data = result.tables.find(candidate => candidate.file === DATA_SOURCES_FILE);
  const model = data && columnIndex(data, SOURCE_MODEL);
  if (data && model !== undefined) {
    const type = columnIndex(data, SOURCE_TYPE);
    const object = columnIndex(data, SOURCE_OBJECT_NAME);
    const listed = DATA_SOURCE_IMPORTS.map(header => columnIndex(data, header)).find(at => at !== undefined);
    const lists = cellLists(result, data);
    data.rows.forEach((source, index) => {
      if (!names(cellText(source[model]), name, unique)) return;
      const objectName = (object === undefined ? "" : cellText(source[object]).trim()) || cellText(source[0]).trim();
      const word = type === undefined ? "" : cellText(source[type]).trim();
      sources.push({ name: objectName, kind: KINDS.get(word.toUpperCase()) ?? word, row: index });
      if (listed === undefined) return;
      const text = cellText(source[listed]);
      for (const each of lists.get(listed)?.(text, source) ?? [text]) addImport(each, objectName);
    });
  }
  // Where Import Data Sources lists none of its imports, the Imports table may: each import whose Source Object names
  // this source model, with the module and the saved view it reads.
  const importsTable = result.tables.find(candidate => candidate.file === IMPORTS_FILE);
  const where = importsTable && columnIndex(importsTable, SOURCE_OBJECT);
  if (!imports.size && importsTable && where !== undefined) {
    for (const each of importsTable.rows) {
      const read = sourceObjectOf(cellText(each[where]));
      if (!read?.model || !names(read.model, name, unique)) continue;
      addImport(cellText(each[0]), read.view === undefined ? read.module : `${read.module}.${read.view}`);
    }
  }
  if (!sources.length && !imports.size) return undefined;

  const dataLabel = cellText(data?.label ?? "Import Data Sources");
  const sourcesAt = columnIndex(table, SOURCES);
  const importsAt = columnIndex(table, IMPORTS);
  return {
    sources,
    imports: [...imports].map(([importName, from]) => ({ name: importName, from })),
    sourceLines: sources.length ? countLine(sourcesAt === undefined ? undefined : numberIn(row[sourcesAt]), sources.length, SOURCES, dataLabel) : [],
    importLines: countLine(importsAt === undefined ? undefined : numberIn(row[importsAt]), imports.size, IMPORTS,
      sources.length ? dataLabel : cellText(importsTable?.label ?? "Imports")),
  };
}
