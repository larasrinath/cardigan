import type { AnalysisResult, Cell, ResultTable } from "./result-types.js";

/** A result leaves the place that made it as plain data: a window message from the model's core frame, then JSON on the port
 * to the results page. These keep it to what both carry unchanged, so the CSV written from the tables is the same on
 * either side. */

/** A value as text, the way String makes it. String cannot convert an object whose own toString and valueOf are not
 * functions, and both JSON and a message from another window can hold one: it is written as any other object is. */
export const textOf = (value: unknown): string => { try { return String(value); } catch { return "[object Object]"; } };

/** A cell as text or a finite number, which JSON keeps as they are. Anything else becomes the text toCsv writes for it
 * (nothing for null and undefined), so the CSV does not change. */
export const plainCell = (value: unknown): Cell =>
  typeof value === "string" || (typeof value === "number" && Number.isFinite(value)) ? value : value === null || value === undefined ? "" : textOf(value);

/** Rows of plain cells. A hole in a row is a cell that is not there, which toCsv writes as nothing: `map` would keep the hole,
 * and JSON would turn it into null. */
export const plainRows = (rows: readonly (readonly unknown[])[]): Cell[][] => rows.map(row => Array.from(row, plainCell));

/** A file name as the analysis writes it: none of the characters a file name cannot hold (util.ts `fileSafe`), so a name
 * from another window can never be a path. */
const fileName = (value: unknown, extension: string): value is string =>
  typeof value === "string" && value.endsWith(extension) && value.length > extension.length && !/[\\/:*?"<>|\u0000-\u001f]/.test(value);

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
  return { kind: data.kind, name: data.name, id: data.id, zipName: data.zipName, tables, summary: Array.from(data.summary, textOf) };
}

/** A result received from another window, with every field checked before use and nothing else kept; undefined when it is
 * not a result. It never throws: whoever calls it is in the middle of a run and must not be left waiting, so a value that
 * cannot even be read is not a result either. */
export function plainResult(value: unknown): AnalysisResult | undefined {
  try { return readResult(value); } catch { return undefined; }
}
