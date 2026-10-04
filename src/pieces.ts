import { ROWS_MAX, ROWS_MAX_CHARS, type TabMessage } from "./protocol.js";
import type { AnalysisResult, Cell } from "./result-types.js";

/** A result as the messages that carry it to the results page (protocol.ts): the result with every table's rows left out,
 * then each table's rows in pieces, table by table, then "done". A model has thousands of line items with dozens of columns
 * and a message is JSON, so a piece holds at most ROWS_MAX rows and at most ROWS_MAX_CHARS of cell text: it is cut before
 * the row that would pass either. Only a row that is larger than ROWS_MAX_CHARS by itself travels in a piece over that
 * size, alone. JSON adds the quotes and commas around each cell and escapes some characters (six characters for a control
 * character at worst), so a full piece stays within a few megabytes, far below the 64 MB Chrome allows a message. */
export function* resultMessages(result: AnalysisResult): Generator<TabMessage> {
  yield { type: "result", result: { ...result, tables: result.tables.map(table => ({ ...table, rows: [] })) } };
  for (const [table, { rows }] of result.tables.entries()) {
    let piece: Cell[][] = [];
    let chars = 0;
    for (const row of rows) {
      const size = row.reduce<number>((sum, cell) => sum + String(cell).length, 0);
      if (piece.length && (piece.length === ROWS_MAX || chars + size > ROWS_MAX_CHARS)) {
        yield { type: "rows", table, rows: piece };
        piece = [];
        chars = 0;
      }
      piece.push(row);
      chars += size;
    }
    if (piece.length) yield { type: "rows", table, rows: piece };
  }
  yield { type: "done" };
}
