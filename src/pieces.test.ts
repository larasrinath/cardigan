import { describe, expect, it } from "vitest";
import { assemble } from "./pieces.test-support.js";
import { resultMessages } from "./pieces.js";
import { ROWS_MAX, ROWS_MAX_CHARS, type TabMessage } from "./protocol.js";
import type { AnalysisResult, Cell, ResultTable } from "./result-types.js";
import { resultZip } from "./result-zip.test-support.js";
import { sameBytes } from "./zip.test-support.js";

const table = (file: string, headers: string[], rows: Cell[][], guard = false): ResultTable => ({ file, label: file.replace(/\.csv$/, ""), headers, rows, guard });
const model = (...tables: ResultTable[]): AnalysisResult => ({ kind: "model", name: "Model one", id: "FEDCBA9876543210FEDCBA9876543210",
  zipName: "Model one - Model Export - 2026-09-28.zip", summary: ["Line Items: many rows"],
  tables: [{ ...table("Model Details.csv", ["Section", "Detail", "Value"], [["Model", "Model", "Model one"], ["Files", "Line Items.csv", "many rows"]], true), details: true }, ...tables] });
const pieces = (messages: TabMessage[]) => messages.filter((message): message is Extract<TabMessage, { type: "rows" }> => message.type === "rows");
const cellText = (rows: Cell[][]) => rows.reduce((sum, row) => sum + row.reduce<number>((chars, cell) => chars + String(cell).length, 0), 0);
/** A message as it travels: JSON, in UTF-8. */
const bytes = (message: TabMessage) => new TextEncoder().encode(JSON.stringify(message)).byteLength;
const MODIFIED = new Date(2026, 8, 28, 12, 30, 10);

describe("A result sent to the results page piece by piece", () => {
  it("sends the result without its rows, then each table's rows in order, then done", () => {
    const result = model(table("Line Items.csv", ["", "Formula"], [["Revenue", "Units * Price"], ["Units", 12]]), table("Versions.csv", ["", "Is Actual"], []),
      table("Modules.csv", ["", "Cell Count"], [["Demand", "2252068"]]));
    const messages = [...resultMessages(result)];
    expect(messages).toEqual([
      { type: "result", result: { ...result, tables: result.tables.map(entry => ({ ...entry, rows: [] })) } },
      { type: "rows", table: 0, rows: [["Model", "Model", "Model one"], ["Files", "Line Items.csv", "many rows"]] },
      { type: "rows", table: 1, rows: [["Revenue", "Units * Price"], ["Units", 12]] },
      // A table without rows has no piece.
      { type: "rows", table: 3, rows: [["Demand", "2252068"]] },
      { type: "done" }]);
    // The result itself is left as it was.
    expect(result.tables.map(entry => entry.rows.length)).toEqual([2, 2, 0, 1]);
    expect(assemble(messages)).toEqual(result);
    // A result with no tables at all is still a result and a done.
    expect([...resultMessages({ ...result, tables: [] })].map(message => message.type)).toEqual(["result", "done"]);
  });

  it("sends a model's line items, thousands of rows with dozens of columns, in pieces of bounded size", () => {
    // 5,000 line items with 26 columns: a formula, a format definition as JSON, and the settings around them.
    const headers = ["", ...Array.from({ length: 25 }, (_, column) => `Column ${column + 1}`)];
    const rows = Array.from({ length: 5000 }, (_, index): Cell[] => [`Line item ${index}`, `IF 'Flag ${index}' THEN Volume[SELECT: Versions.Actual] * Price ELSE 0`,
      '{"dataType":"NUMBER","minimumSignificantDigits":4,"decimalPlaces":2,"units":"NONE"}', ...Array.from({ length: 23 }, (_, column) => `value ${index}.${column}`)]);
    const result = model(table("Line Items.csv", headers, rows), table("Modules.csv", ["", "Cell Count"], Array.from({ length: 1001 }, (_, index) => [`Module ${index}`, index])));
    const messages = [...resultMessages(result)];
    const sent = pieces(messages);

    // 5,000 rows are ten full pieces; 1,001 rows are two full pieces and one more row.
    expect(sent.map(piece => [piece.table, piece.rows.length])).toEqual([[0, 2], ...Array(10).fill([1, ROWS_MAX]), [2, ROWS_MAX], [2, ROWS_MAX], [2, 1]]);
    for (const piece of sent) {
      expect(piece.rows.length).toBeLessThanOrEqual(ROWS_MAX);
      expect(cellText(piece.rows)).toBeLessThanOrEqual(ROWS_MAX_CHARS);
    }
    // No message, the first included, is anywhere near what Chrome allows one (64 MB): each is under half a megabyte here.
    expect(messages.map(bytes).filter(size => size > 500_000)).toEqual([]);
    expect(bytes(messages[0])).toBeLessThan(2_000);

    // Put together as the page does, it is the same result, and so the same zip.
    const received = assemble(messages.map(message => JSON.parse(JSON.stringify(message)) as TabMessage));
    expect(received).toEqual(result);
    expect(sameBytes(resultZip(received, MODIFIED), resultZip(result, MODIFIED))).toBe(true);
  });

  it("cuts a piece before the row that would take its cell text past the limit", () => {
    // Rows of 30,000 characters: 33 of them are 990,000, and the 34th would pass 1,000,000.
    const long = "x".repeat(29_990);
    const rows = Array.from({ length: 100 }, (_, index): Cell[] => [`Item ${String(index).padStart(5, "0")}`, long]);
    const sent = pieces([...resultMessages(model(table("Line Items.csv", ["", "Notes"], rows)))]).filter(piece => piece.table === 1);
    expect(sent.map(piece => piece.rows.length)).toEqual([33, 33, 33, 1]);
    expect(sent.map(piece => cellText(piece.rows))).toEqual([990_000, 990_000, 990_000, 30_000]);
    expect(sent.flatMap(piece => piece.rows)).toEqual(rows);

    // Exactly at the limit is within it; one character more starts the next piece.
    const exact = (last: number) => pieces([...resultMessages(model(table("Notes.csv", ["Notes"], [["x".repeat(ROWS_MAX_CHARS - 10)], ["x".repeat(last)], ["end"]])))])
      .filter(piece => piece.table === 1).map(piece => piece.rows.length);
    expect([exact(10), exact(11)]).toEqual([[2, 1], [1, 2]]);
    // Numbers count by their digits.
    expect(pieces([...resultMessages(model(table("Counts.csv", ["Count"], [["x".repeat(ROWS_MAX_CHARS - 6)], [123456], [7]])))]).filter(piece => piece.table === 1)
      .map(piece => piece.rows.length)).toEqual([2, 1]);
  });

  it("sends a row that is larger than the limit by itself, alone", () => {
    const huge = "y".repeat(ROWS_MAX_CHARS + 1);
    const rows: Cell[][] = [["before", "a"], ["huge", huge], ["after", "b"], ["last", "c"]];
    const messages = [...resultMessages(model(table("Line Items.csv", ["", "Notes"], rows)))];
    expect(pieces(messages).filter(piece => piece.table === 1).map(piece => piece.rows.map(row => row[0]))).toEqual([["before"], ["huge"], ["after", "last"]]);
    expect(assemble(messages).tables[1].rows).toEqual(rows);
    // When that row is the table's first, nothing goes before it: no piece is ever empty.
    const first = [...resultMessages(model(table("Line Items.csv", ["", "Notes"], rows.slice(1)), table("Modules.csv", ["", "Notes"], [["huge", huge]])))];
    expect(pieces(first).map(piece => [piece.table, piece.rows.map(row => row[0])])).toEqual([[0, ["Model", "Files"]], [1, ["huge"]], [1, ["after", "last"]], [2, ["huge"]]]);
    expect(assemble(first).tables[1].rows).toEqual(rows.slice(1));
  });

  it("stays far below Chrome's limit for a message even when every character has to be escaped", () => {
    // A control character is six characters in JSON, a quote or a backslash two; text outside Latin is three bytes in UTF-8.
    for (const [character, most] of [["\u0001", 6.1 * ROWS_MAX_CHARS], ['"', 2.1 * ROWS_MAX_CHARS], ["\\", 2.1 * ROWS_MAX_CHARS], ["東", 3.1 * ROWS_MAX_CHARS]] as const) {
      const rows = Array.from({ length: 1200 }, (): Cell[] => [character.repeat(2500), character.repeat(2500)]);
      const messages = [...resultMessages(model(table("Line Items.csv", ["", "Notes"], rows)))];
      const sizes = messages.map(bytes);
      expect(Math.max(...sizes), JSON.stringify(character)).toBeLessThan(most);
      expect(Math.max(...sizes), JSON.stringify(character)).toBeLessThan(8 * 1024 * 1024);
      expect(pieces(messages).filter(piece => piece.table === 1).map(piece => piece.rows.length), JSON.stringify(character)).toEqual([200, 200, 200, 200, 200, 200]);
      expect(assemble(messages.map(message => JSON.parse(JSON.stringify(message)) as TabMessage)).tables[1].rows).toEqual(rows);
    }
  });
});
