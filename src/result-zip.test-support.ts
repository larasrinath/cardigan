import type { AnalysisResult, ResultTable } from "./result-types.js";
import { toCsv, zipStore } from "./zip.test-support.js";

/** A result as the zip Cardigan wrote of it through version 0.9.1, for the tests that hold a result against a stored
 * zip, or two results against each other byte for byte. Tests only: the extension writes no file. */

/** One table of a result as the CSV text the zip holds. */
export const tableCsv = (table: ResultTable): string => toCsv(table.headers, table.rows, table.guard);

/** A result's zip: one CSV per table, in order. The same result and time give the same bytes. */
export function resultZip(result: AnalysisResult, modified = new Date()): Uint8Array<ArrayBuffer> {
  const encoder = new TextEncoder();
  return zipStore(result.tables.map(table => ({ name: table.file, data: encoder.encode(tableCsv(table)) })), modified);
}
