import type { AnalysisResult, Cell, ResultTable } from "./result-types.js";

/** A result leaves the place that made it as plain data: a window message from the model's core frame, then JSON on the port
 * to the results page. These keep it to what both carry unchanged, so the CSV written from the tables is the same on
 * either side. */

/** A cell as text or a finite number, which JSON keeps as they are. Anything else becomes the text toCsv writes for it
 * (nothing for null and undefined), so the CSV does not change. */
export const plainCell = (value: unknown): Cell =>
  typeof value === "string" || (typeof value === "number" && Number.isFinite(value)) ? value : value === null || value === undefined ? "" : String(value);

export const plainRows = (rows: readonly (readonly unknown[])[]): Cell[][] => rows.map(row => row.map(plainCell));

/** A file name as the analysis writes it: none of the characters a file name cannot hold (util.ts `fileSafe`), so a name
 * from another window can never be a path. */
const fileName = (value: unknown, extension: string): value is string =>
  typeof value === "string" && value.endsWith(extension) && value.length > extension.length && !/[\\/:*?"<>|\u0000-\u001f]/.test(value);

/** A result received from another window, with every field checked before use and nothing else kept; undefined when it is
 * not a result. */
export function plainResult(value: unknown): AnalysisResult | undefined {
  const data = value as Partial<AnalysisResult> | null;
  if (!data || typeof data !== "object" || (data.kind !== "app" && data.kind !== "model") || typeof data.name !== "string" || typeof data.id !== "string"
      || !fileName(data.zipName, ".zip") || !Array.isArray(data.tables) || !Array.isArray(data.summary)) return undefined;
  const tables: ResultTable[] = [];
  for (const table of data.tables as (Partial<ResultTable> | null)[]) {
    if (!table || typeof table !== "object" || !fileName(table.file, ".csv") || typeof table.label !== "string" || typeof table.guard !== "boolean"
        || !Array.isArray(table.headers) || !Array.isArray(table.rows) || !table.rows.every(row => Array.isArray(row))) return undefined;
    tables.push({ file: table.file, label: table.label, headers: table.headers.map(String), rows: plainRows(table.rows), guard: table.guard,
      ...(table.details === true ? { details: true as const } : {}) });
  }
  return { kind: data.kind, name: data.name, id: data.id, zipName: data.zipName, tables, summary: data.summary.map(String) };
}
