import type { AnalysisResult, ResultTable } from "./result-types.js";
import { toCsv, zipStore } from "./zip.js";

/** One file of a result as the CSV text the zip holds. */
export const tableCsv = (table: ResultTable): string => toCsv(table.headers, table.rows, table.guard);

/** A result's zip: one CSV per table, in order. The same result and time give the same bytes. */
export function resultZip(result: AnalysisResult, modified = new Date()): Uint8Array<ArrayBuffer> {
  const encoder = new TextEncoder();
  return zipStore(result.tables.map(table => ({ name: table.file, data: encoder.encode(tableCsv(table)) })), modified);
}
