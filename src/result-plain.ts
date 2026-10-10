import type { AnalysisResult, Cell, ImportMapping, MappedSource, MappedTarget, ResultTable } from "./result-types.js";

/** A result leaves the place that made it as plain data: a window message from the model's core frame, then JSON on the port
 * to the results page. These keep it to what both carry unchanged, so a table is the same on either side, cell for
 * cell. */

/** A value as text, the way String makes it. String cannot convert an object whose own toString and valueOf are not
 * functions, and both JSON and a message from another window can hold one: it is written as any other object is. */
export const textOf = (value: unknown): string => { try { return String(value); } catch { return "[object Object]"; } };

/** A cell as text or a finite number, which JSON keeps as they are. Anything else becomes its text, as `String` makes it
 * (nothing for null and undefined): what the page shows for the cell is the same before and after. */
export const plainCell = (value: unknown): Cell =>
  typeof value === "string" || (typeof value === "number" && Number.isFinite(value)) ? value : value === null || value === undefined ? "" : textOf(value);

/** Rows of plain cells. A hole in a row is a cell that is not there, and is the empty text: `map` would keep the hole,
 * and JSON would turn it into null. */
export const plainRows = (rows: readonly (readonly unknown[])[]): Cell[][] => rows.map(row => Array.from(row, plainCell));

/** A file name as the analysis writes it: none of the characters a file name cannot hold (util.ts `fileSafe`), so a name
 * from another window can never be a path. */
const fileName = (value: unknown, extension: string): value is string =>
  typeof value === "string" && value.endsWith(extension) && value.length > extension.length && !/[\\/:*?"<>|\u0000-\u001f]/.test(value);

/** A model's modules and their IDs: pairs of a name and an ID of digits only, or nothing when anything else is there. A
 * result is not refused for them: the page only cannot open its modules in Anaplan. */
function readModuleIds(value: unknown): [string, string][] | undefined {
  if (!Array.isArray(value)) return undefined;
  const pairs: [string, string][] = [];
  for (const pair of Array.from(value as unknown[])) {
    if (!Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== "string" || typeof pair[1] !== "string" || !/^\d{1,19}$/.test(pair[1])) return undefined;
    pairs.push([pair[0], pair[1]]);
  }
  return pairs;
}

/** What feeds a target of an import, by the result's word for it (result-types.ts `MappedSource`). */
const SOURCES: ReadonlySet<string> = new Set<MappedSource>(["column", "constant", "prompt", "ignore", "headerRow", "none", "other"]);

/** One target of an import's mapping, every field checked, or nothing when anything else is there. */
function readTarget(value: unknown): MappedTarget | undefined {
  const target = value as Partial<MappedTarget> | null;
  if (!target || typeof target !== "object" || typeof target.target !== "string" || typeof target.source !== "string" || !SOURCES.has(target.source)
      || (target.column !== undefined && !(Number.isSafeInteger(target.column) && target.column >= 1)) || (target.text !== undefined && typeof target.text !== "string")) return undefined;
  return { target: target.target, source: target.source, ...(target.column !== undefined ? { column: target.column } : {}), ...(target.text !== undefined ? { text: target.text } : {}) };
}

/** A model's imports from a file with their mappings (result-types.ts `ImportMapping`), every field checked, or nothing when
 * anything else is there. As for the modules' IDs, a result is not refused for them: the page only shows no mapping. The
 * results page checks a result's mappings so too before it shows one, whoever kept the result. */
export function readImportMappings(value: unknown): ImportMapping[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const mappings: ImportMapping[] = [];
  for (const entry of Array.from(value as unknown[])) {
    const mapping = entry as Partial<ImportMapping> | null;
    if (!mapping || typeof mapping !== "object" || typeof mapping.id !== "string" || !/^\d{0,19}$/.test(mapping.id) || typeof mapping.name !== "string"
        || typeof mapping.importType !== "string" || !Array.isArray(mapping.targets) || (mapping.note !== undefined && typeof mapping.note !== "string")) return undefined;
    const targets: MappedTarget[] = [];
    for (const item of Array.from(mapping.targets as unknown[])) {
      const target = readTarget(item);
      if (!target) return undefined;
      targets.push(target);
    }
    mappings.push({ id: mapping.id, name: mapping.name, importType: mapping.importType, targets, ...(mapping.note !== undefined ? { note: mapping.note } : {}) });
  }
  return mappings;
}

/** Lists are read entry by entry (Array.from), so a hole counts as an entry that is not there: `every` would pass over it. */
function readResult(value: unknown): AnalysisResult | undefined {
  const data = value as Partial<AnalysisResult> | null;
  if (!data || typeof data !== "object" || (data.kind !== "app" && data.kind !== "model") || typeof data.name !== "string" || typeof data.id !== "string"
      || !fileName(data.zipName, ".zip") || !Array.isArray(data.tables) || !Array.isArray(data.summary)) return undefined;
  const tables: ResultTable[] = [];
  for (const table of data.tables as (Partial<ResultTable> | null)[]) {
    if (!table || typeof table !== "object" || !fileName(table.file, ".csv") || typeof table.label !== "string" || typeof table.guard !== "boolean"
        || !Array.isArray(table.headers) || !Array.isArray(table.rows)) return undefined;
    // A row that is missing is no more a list than one that is text.
    const rows: unknown[] = Array.from(table.rows);
    if (!rows.every(row => Array.isArray(row))) return undefined;
    tables.push({ file: table.file, label: table.label, headers: Array.from(table.headers, textOf), rows: plainRows(rows as unknown[][]), guard: table.guard,
      ...(table.details === true ? { details: true as const } : {}) });
  }
  const moduleIds = data.kind === "model" ? readModuleIds(data.moduleIds) : undefined;
  const importMappings = data.kind === "model" ? readImportMappings(data.importMappings) : undefined;
  return { kind: data.kind, name: data.name, id: data.id, zipName: data.zipName, tables, summary: Array.from(data.summary, textOf), ...(moduleIds ? { moduleIds } : {}),
    ...(importMappings ? { importMappings } : {}) };
}

/** A result received from another window, with every field checked before use and nothing else kept; undefined when it is
 * not a result. It never throws: whoever calls it is in the middle of a run and must not be left waiting, so a value that
 * cannot even be read is not a result either. */
export function plainResult(value: unknown): AnalysisResult | undefined {
  try { return readResult(value); } catch { return undefined; }
}
