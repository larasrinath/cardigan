import { readsFile, SOURCE_TYPE } from "../file-imports.js";
import { readImportMappings } from "../result-plain.js";
import type { AnalysisResult, ImportMapping, ResultTable } from "../result-types.js";
import { columnIndex } from "./columns.js";
import { IMPORT_TABLES, IMPORTS_FILE, type ImportKind, type ImportTable } from "./import-files.js";
import { sourceObjectOf } from "./source-object.js";
import { cellText } from "./table-engine.js";

/** Which of the results page's three tables of imports (import-files.ts) each import of a model's Imports file stands in.
 * The page shows the split and moves nothing: the result keeps its one Imports file, which the map, Unused Line Items and
 * Unused Modules, a source model's details and the mappings all read as they did, and a result kept by an earlier
 * version shows the same way.
 *
 * An import is placed by its Source Type, as the Imports tab writes it:
 * - FILE, uploaded data: File Imports.
 * - A module, a saved view or a list (MODULE, SAVED VIEW, LIST): this model's, In-Model Imports, or another's,
 *   Model-to-Model Imports. Which, by the best the result says: first what the import's data source says, where the
 *   export read its definition (result-types.ts `sourceInThisModel`); else the model its Source Object names, as Source
 *   Model shows it, against this model's own name. A Source Object that names no model is this model's.
 * - Anything else, as no Source Type or a Source Object that cannot be read as a model's object: not told. Such an import
 *   is listed in Model-to-Model Imports, and the page's log says how many there are.
 *
 * The imports' mappings are found by the Imports file's own rows, as ever: by an import's name and Source Type and, among
 * imports of both alike, by its place in the whole file (`mappingsByRow`), whichever table its row now stands in. */

/** What Source Model says for an import from one of this model's own modules where the export knew the model by its ID
 * alone (`ownModel`). */
export const THIS_MODEL = "This model";

/** This model's name, which Source Model gives an import from one of its own objects: the result's name, unless the export
 * knew the model by its ID alone (model/export.ts), when Source Model says This model. */
export function ownModel(result: Pick<AnalysisResult, "name" | "id">): string {
  const name = cellText(result.name);
  return name.trim() === "" || name === cellText(result.id) ? THIS_MODEL : name;
}

/** The Imports tab's column for where an import takes its data from (source-object.ts). */
export const SOURCE_OBJECT = "Source Object";

/** A Source Type as the page tells one from another: without the spaces around it, and in any case, as `readsFile` reads
 * FILE. */
export const typeKey = (cell: unknown): string => cellText(cell).trim().toUpperCase();

/** The Source Types of the imports that read a module or a saved view, which the tab writes as "MODULE" and "SAVED VIEW". */
export const READS_A_MODULE = /view|module/i;

/** Whether a Source Type is that of an import of a list, which the tab writes as "LIST". */
export const readsAList = (cell: unknown): boolean => ["LIST", "HIERARCHY"].includes(typeKey(cell));

/** Whether a Source Type is that of an import of a model's object: a module, a saved view or a list. */
const readsAnObject = (cell: unknown): boolean => readsAList(cell) || (typeKey(cell) !== "" && READS_A_MODULE.test(cellText(cell)));

/** The mapping of each row of a model's Imports file, in its order, where the result has mappings: the one of the row's
 * name and Source Type and, among imports of both alike, the one in the row's place among them in the whole file, as the
 * export lists them in the Imports tab's order. Names are told apart without the spaces around them, on both sides alike.
 * None for a row whose Source Type says nothing, and none at all for a result without mappings. A result an earlier
 * version kept has mappings of imports from a file alone, without their Source Type: they are taken for those of FILE
 * (file-imports.ts `readsFile`). */
export function mappingsByRow(result: AnalysisResult, file: ResultTable): (ImportMapping | undefined)[] {
  const type = columnIndex(file, SOURCE_TYPE);
  const mappings = readImportMappings(result.importMappings);
  if (type === undefined || !mappings) return file.rows.map(() => undefined);
  const key = (name: string, kind: string): string => JSON.stringify([name.trim(), kind]);
  const alike = new Map<string, ImportMapping[]>();
  for (const mapping of mappings) {
    const at = key(mapping.name, typeKey(mapping.sourceType ?? "FILE"));
    alike.set(at, [...alike.get(at) ?? [], mapping]);
  }
  const seen = new Map<string, number>();
  return file.rows.map(row => {
    const kind = typeKey(row[type]);
    if (kind === "") return undefined;
    const at = key(cellText(row[0]), kind);
    const place = seen.get(at) ?? 0;
    seen.set(at, place + 1);
    return alike.get(at)?.[place];
  });
}

/** How a row of the Imports file was placed: by its Source Type alone (FILE), by what its data source says, by the model
 * its Source Object names, or not at all. */
export type ToldBy = "type" | "source" | "sourceModel" | "unknown";

/** Where each import of a model's Imports file stands: each row's kind, in the file's order, and how it was told. */
export interface ImportSplit { kinds: ImportKind[]; told: ToldBy[] }

/** What `importSplit` worked out of each result's Imports file, so that it is worked out once: the navigation, the overview
 * and each row's details ask of it. A result is not changed once it is shown. */
const splits = new WeakMap<AnalysisResult, WeakMap<ResultTable, ImportSplit | undefined>>();

/** Where each import of a model's Imports file stands. None for a result that is no model's, and for a file without the
 * Source Type column or without a row: there is nothing to tell its imports apart by, and the page shows the file as it
 * stands. */
export function importSplit(result: AnalysisResult, file: ResultTable): ImportSplit | undefined {
  const known = splits.get(result)?.get(file);
  if (known || splits.get(result)?.has(file)) return known;
  const split = splitOf(result, file);
  const ofResult = splits.get(result) ?? new WeakMap<ResultTable, ImportSplit | undefined>();
  ofResult.set(file, split);
  splits.set(result, ofResult);
  return split;
}

function splitOf(result: AnalysisResult, file: ResultTable): ImportSplit | undefined {
  const type = columnIndex(file, SOURCE_TYPE);
  if (result.kind !== "model" || type === undefined || !file.rows.length) return undefined;
  const object = columnIndex(file, SOURCE_OBJECT);
  const mappings = mappingsByRow(result, file);
  const own = ownModel(result).trim();
  const kinds: ImportKind[] = [];
  const told: ToldBy[] = [];
  file.rows.forEach((row, at) => {
    const [kind, by] = ((): [ImportKind, ToldBy] => {
      if (readsFile(row[type])) return ["file", "type"];
      if (!readsAnObject(row[type])) return ["model", "unknown"];
      const here = mappings[at]?.sourceInThisModel;
      if (here !== undefined) return [here ? "inModel" : "model", "source"];
      // Source Model, as the page shows it: the model the Source Object names, or this model where it names none.
      const read = object === undefined ? undefined : sourceObjectOf(row[object]);
      if (!read || (readsAList(row[type]) && read.view !== undefined)) return ["model", "unknown"];
      return [(read.model ?? own).trim() === own ? "inModel" : "model", "sourceModel"];
    })();
    kinds.push(kind);
    told.push(by);
  });
  return { kinds, told };
}

/** The result's Imports file: the first file of that name, which the page splits. */
export const importsFileOf = (result: AnalysisResult): ResultTable | undefined => result.tables.find(table => table.file === IMPORTS_FILE);

/** The place the page names one of the three tables by, as it names a file by its place among the result's tables: after
 * all of them, in the three tables' order, so that no file's place is taken, and the same for a result whenever it is
 * shown. */
export const importTableIndex = (result: AnalysisResult, table: ImportTable): number => result.tables.length + IMPORT_TABLES.indexOf(table);

/** The three tables a model's Imports file is shown as, by its place among the result's tables (`index`), each with the
 * file's rows of its kind, in the file's order, and each by its place (`importTableIndex`), its name as a file and its own
 * name: those that have rows. None where the file is not split (`importSplit`), and none for any other file of the
 * result, a second file of the name among them. */
export function importTables(result: AnalysisResult, index: number): { index: number; table: ResultTable }[] | undefined {
  const file = result.tables[index];
  if (!file || index !== result.tables.findIndex(table => table.file === IMPORTS_FILE)) return undefined;
  const split = importSplit(result, file);
  if (!split) return undefined;
  return IMPORT_TABLES.flatMap(table => {
    const rows = file.rows.filter((_, at) => split.kinds[at] === table.kind);
    return rows.length ? [{ index: importTableIndex(result, table), table: { ...file, file: table.file, label: table.label, rows } }] : [];
  });
}

/** The place in the result's Imports file of the row at `at` of one of the three tables: the table's rows are the file's of
 * its kind, in the file's order, one for one. None where the result has no such row. */
export function fileRowOf(result: AnalysisResult, table: ImportTable, at: number): number | undefined {
  const file = importsFileOf(result);
  const split = file && importSplit(result, file);
  if (!split || at < 0) return undefined;
  let seen = -1;
  for (let row = 0; row < split.kinds.length; row++) {
    if (split.kinds[row] === table.kind && ++seen === at) return row;
  }
  return undefined;
}

/** What the page's log says of how a result's imports were placed: how many each table lists; how many imports of a
 * model's object were placed by what their data sources say, and how many by Source Model, the model their Source Object
 * names; and how many could not be placed and are listed in Model-to-Model Imports. Counts and the page's own words
 * alone: no import's name. None where the file is not split. */
export function importSplitLine(result: AnalysisResult): string | undefined {
  const file = importsFileOf(result);
  const split = file && importSplit(result, file);
  if (!split) return undefined;
  const count = (kind: ImportKind): number => split.kinds.filter(each => each === kind).length;
  const by = (how: ToldBy): number => split.told.filter(each => each === how).length;
  const unknown = by("unknown");
  return `Import tables: ${IMPORT_TABLES.map(table => `${table.label} ${count(table.kind)}`).join(", ")}; `
    + `${by("source")} placed by their data source and ${by("sourceModel")} by Source Model; `
    + `${unknown} could not be placed${unknown === 0 ? "" : `, so Model-to-Model Imports lists ${unknown === 1 ? "it" : "them"}`}.`;
}
