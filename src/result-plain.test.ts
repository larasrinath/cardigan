import { describe, expect, it } from "vitest";
import { plainCell, plainResult, plainRows, textOf } from "./result-plain.js";
import type { AnalysisResult } from "./result-types.js";
import { toCsv } from "./zip.js";

// What a described card can leave in a cell besides text and numbers: the report reads fields of no fixed shape.
const ODD = [[undefined, null, NaN, Infinity, -Infinity], [true, false, 0, -0, 1e21], [{ id: 7 }, ["a", "b"], 10n, 102000000086, "=SUM(1)"],
  ["-1+1", "line\nbreak", 'say "hi", ok', "", " "]];
const HEADERS = ["A", "B", "C", "D", "E"];

describe("A result as plain data", () => {
  it("keeps text and finite numbers, and writes anything else as the text the CSV has for it", () => {
    expect(ODD.map(row => row.map(plainCell))).toEqual([["", "", "NaN", "Infinity", "-Infinity"], ["true", "false", 0, -0, 1e21],
      ["[object Object]", "a,b", "10", 102000000086, "=SUM(1)"], ["-1+1", "line\nbreak", 'say "hi", ok', "", " "]]);
    expect(plainRows([["a", 1], []])).toEqual([["a", 1], []]);
  });

  it("has a text for every value, and a cell for every place in a row", () => {
    // String cannot convert an object whose own toString and valueOf are not functions, and JSON can hold one.
    const textless = JSON.parse('{"toString":1,"valueOf":1}') as unknown;
    expect(() => String(textless)).toThrow(TypeError);
    expect([textOf(textless), textOf({ id: 7 }), textOf(null), textOf(undefined), textOf(7), textOf("")]).toEqual(["[object Object]", "[object Object]", "null", "undefined", "7", ""]);
    expect([plainCell(textless), plainCell(Symbol("x")), plainCell(Object.create(null))]).toEqual(["[object Object]", "Symbol(x)", "[object Object]"]);
    // A hole in a row is a cell that is not there: toCsv writes nothing for it, and so does the row sent on as JSON.
    const row: unknown[] = ["a"];
    row[2] = "c";
    const plain = plainRows([row, [textless]]);
    expect(plain).toEqual([["a", "", "c"], ["[object Object]"]]);
    expect(1 in plain[0]).toBe(true);
    expect(toCsv(["A", "B", "C"], JSON.parse(JSON.stringify(plain.slice(0, 1))) as unknown[][])).toBe(toCsv(["A", "B", "C"], [row]));
  });

  it("does not change the CSV, guarded or not, and neither does the trip to the results page as JSON", () => {
    const plain = plainRows(ODD);
    const received = JSON.parse(JSON.stringify(plain)) as typeof plain;
    for (const guard of [true, false]) {
      expect(toCsv(HEADERS, plain, guard), String(guard)).toBe(toCsv(HEADERS, ODD, guard));
      expect(toCsv(HEADERS, received, guard), String(guard)).toBe(toCsv(HEADERS, ODD, guard));
    }
    expect(toCsv(HEADERS, ODD)).toContain("NaN,Infinity,'-Infinity");
    // Sent as they are, the same rows would come back different: JSON has no NaN, no Infinity and no undefined.
    expect(toCsv(HEADERS, JSON.parse(JSON.stringify(ODD.slice(0, 2))) as unknown[][])).not.toBe(toCsv(HEADERS, ODD.slice(0, 2)));
    expect(() => JSON.stringify(ODD)).toThrow();
  });

  const result: AnalysisResult = { kind: "app", name: "Planning app", id: "01234567-89ab-cdef-0123-456789abcdef", zipName: "Planning app - App Export - 2026-09-28.zip",
    summary: ["1 of 1 pages analysed, 3 cards."], tables: [
      { file: "App Details.csv", label: "App Details", headers: ["Section", "Detail", "Value"], rows: [["App", "Cards", 3]], guard: true, details: true },
      { file: "Cards.csv", label: "Cards", headers: ["Page", "Card #"], rows: [], guard: true }] };

  it("reads a result from another window as a copy with the contract's fields only", () => {
    const read = plainResult({ ...result, zip: new Uint8Array(4), tables: result.tables.map(table => ({ ...table, html: "<b>" })) });
    expect(read).toEqual(result);
    expect(read).not.toBe(result);
    expect(read!.tables[0].rows).not.toBe(result.tables[0].rows);
    expect(Object.keys(read!.tables[1])).toEqual(["file", "label", "headers", "rows", "guard"]);
    expect(plainResult({ ...result, kind: "model", summary: [1, null], tables: [{ ...result.tables[1], headers: ["", 2], details: false }] }))
      .toEqual({ ...result, kind: "model", summary: ["1", "null"], tables: [{ ...result.tables[1], headers: ["", "2"] }] });
  });

  it("takes a file name only when it is a name: no path, no drive, no line break, and the extension expected", () => {
    const named = (zipName: unknown, file: unknown) => plainResult({ ...result, zipName, tables: [{ ...result.tables[1], file }] }) !== undefined;
    expect(named("Plan #1 (R&D) - 50%+ [a] {b} ~ 'c' = d; e, f! @g $h ^i - App Export - 2026-09-28.zip", "Conditional Formatting.csv")).toBe(true);
    expect(named("x.zip", "Cards.csv")).toBe(true);
    for (const name of ["../x.zip", "a/b.zip", "a\\b.zip", "C:x.zip", "x*.zip", "x?.zip", 'x".zip', "x<y.zip", "x>y.zip", "x|y.zip", "x\ny.zip", "x\u0000.zip",
      "x\t.zip", ".zip", "x.zip ", "x.ZIP", "x.csv", "", 7, null, undefined, ["x.zip"]]) {
      expect(named(name, "Cards.csv"), JSON.stringify(name)).toBe(false);
    }
    for (const name of ["../Cards.csv", "a/Cards.csv", "a\\Cards.csv", "C:Cards.csv", "Cards.csv\n", ".csv", "Cards.html", "Cards", "", 7, null, undefined]) {
      expect(named("x.zip", name), JSON.stringify(name)).toBe(false);
    }
  });

  it("is undefined for anything that is not a result", () => {
    for (const value of [undefined, null, "result", 7, [], {}, { ...result, kind: "page" }, { ...result, name: undefined }, { ...result, id: 7 },
      { ...result, tables: "Cards" }, { ...result, summary: undefined }, { ...result, tables: [undefined] }, { ...result, tables: ["Cards.csv"] },
      { ...result, tables: [{ ...result.tables[1], label: 7 }] }, { ...result, tables: [{ ...result.tables[1], guard: 1 }] },
      { ...result, tables: [{ ...result.tables[1], headers: undefined }] }, { ...result, tables: [{ ...result.tables[1], rows: [["a"], "b"] }] },
      { ...result, tables: [{ ...result.tables[1], rows: { length: 1 } }] }]) {
      expect(plainResult(value), JSON.stringify(value)).toBeUndefined();
    }
  });

  it("never throws: a missing row makes it no result, and whatever else a list holds is read as a value that is not there or made text", () => {
    // As it arrives from another window: a structured clone keeps a hole in a list, and an object's own toString.
    const sparse = (...values: unknown[]) => { const list: unknown[] = []; values.forEach((value, index) => { list[index * 2 + 1] = value; }); return list; };
    const table = result.tables[1];
    expect(plainResult(structuredClone({ ...result, tables: [{ ...table, rows: sparse(["Demand board", 1]) }] }))).toBeUndefined();
    expect(plainResult(structuredClone({ ...result, tables: sparse(table) }))).toBeUndefined();

    const textless = { toString: 1, valueOf: 1 };
    const read = plainResult(structuredClone({ ...result, summary: sparse(textless), tables: [{ ...table, headers: sparse(textless, "Card #"), rows: [sparse(textless, 1)] }] }));
    expect(read).toEqual({ ...result, summary: ["undefined", "[object Object]"],
      tables: [{ ...table, headers: ["undefined", "[object Object]", "undefined", "Card #"], rows: [["", "[object Object]", "", 1]] }] });
    // What is kept is plain: the same after the trip to the results page as JSON.
    expect(JSON.parse(JSON.stringify(read))).toEqual(read);

    // A value that cannot even be read is no result.
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    const unreadable = { ...result, get tables(): never { throw new Error("not readable"); } };
    for (const value of [revoked.proxy, unreadable, { ...result, tables: [revoked.proxy] }, { ...result, tables: [{ ...table, rows: [revoked.proxy] }] }]) {
      let outcome: unknown = "thrown";
      expect(() => { outcome = plainResult(value); }).not.toThrow();
      expect(outcome).toBeUndefined();
    }
  });
});
