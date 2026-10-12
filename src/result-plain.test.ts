import { describe, expect, it } from "vitest";
import { readDefinition } from "./model/import-mappings.js";
import { plainCell, plainResult, plainRows, readImportItemNames, textOf } from "./result-plain.js";
import type { AnalysisResult } from "./result-types.js";
import { toCsv } from "./zip.test-support.js";

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
    // A model's modules and their IDs come along. Anything else in their place is left out, the result kept; an app has none.
    const model = { ...result, kind: "model" as const, moduleIds: [["Sales", "102000000001"], ["-- Admin", "102000000002"]] };
    expect(plainResult(model)).toEqual(model);
    for (const moduleIds of [[["Sales", 102000000001]], [["Sales", "1x"]], [["Sales"]], [["Sales", "1", "2"]], "Sales", { Sales: "102000000001" }, [null]]) {
      expect(plainResult({ ...model, moduleIds }), JSON.stringify(moduleIds)).toEqual({ ...result, kind: "model" });
    }
    expect(plainResult({ ...result, moduleIds: model.moduleIds })).toEqual(result);
    // So do its lists and theirs, kept or left out alike.
    const listIds = [["Products", "101000000017"], ["+ Regions", "101000000018"]];
    expect(plainResult({ ...model, listIds })).toEqual({ ...model, listIds });
    for (const odd of [[["Products", 101000000017]], [["Products"]], "Products", [null]]) {
      expect(plainResult({ ...model, listIds: odd }), JSON.stringify(odd)).toEqual(model);
    }
    expect(plainResult({ ...result, listIds })).toEqual(result);
    // So do the IDs of a model's Line Items rows, a row's own and its module's, which a module's own row has none of.
    const lineItemIds = [["102000000001", ""], ["597000000011", "102000000001"]];
    expect(plainResult({ ...model, lineItemIds })).toEqual({ ...model, lineItemIds });
    for (const ids of [[["", ""]], [["5970x", "102000000001"]], [[597000000011, "102000000001"]], [["597000000011"]], [["1", "2", "3"]], "597000000011", [null]]) {
      expect(plainResult({ ...model, lineItemIds: ids }), JSON.stringify(ids)).toEqual(model);
    }
    expect(plainResult({ ...result, lineItemIds })).toEqual(result);
    // So does where a model was read: an Anaplan site's origin and a customer's ID. Anything else is left out.
    const site = { origin: "https://us1a.app.anaplan.com", customer: "5555eeee6666ffff7777aaaa8888bbbb" };
    expect(plainResult({ ...model, site: { ...site, extra: "<b>" } })).toEqual({ ...model, site });
    for (const odd of [{ ...site, origin: "https://evil.example.com" }, { ...site, origin: "http://us1a.app.anaplan.com" }, { ...site, customer: "5555eeee" },
      { ...site, customer: 1 }, { origin: site.origin }, "us1a", null]) {
      expect(plainResult({ ...model, site: odd }), JSON.stringify(odd)).toEqual(model);
    }
    expect(plainResult({ ...result, site })).toEqual(result);
  });

  it("keeps what a model's pages use of it by name, every field checked, and leaves it out whole where anything is not as it should be", () => {
    const model = { ...result, kind: "model" as const };
    const pageUses = { lineItems: [["REV01 Revenue", "Units"], ["REP01 Report", "Total"]], modules: ["GRD01 Grid"], unread: 1, unnamed: 0 };
    const read = plainResult({ ...model, pageUses: { ...pageUses, extra: "<b>" } });
    expect(read).toEqual({ ...model, pageUses });
    expect(read!.pageUses!.lineItems).not.toBe(pageUses.lineItems);
    for (const odd of [{ ...pageUses, lineItems: [["REV01 Revenue"]] }, { ...pageUses, lineItems: [["REV01 Revenue", 7]] }, { ...pageUses, lineItems: "Units" },
      { ...pageUses, modules: [null] }, { ...pageUses, unread: -1 }, { ...pageUses, unnamed: 1.5 }, { lineItems: [], modules: [] }, "Units", null]) {
      expect(plainResult({ ...model, pageUses: odd }), JSON.stringify(odd)).toEqual(model);
    }
    // An app's result has none; a model's that an earlier version kept has none either, and is read all the same.
    expect(plainResult({ ...result, pageUses })).toEqual(result);
    expect(plainResult(model)).toEqual(model);
  });

  it("keeps a model's mappings of its imports from a file, every field checked, and leaves them out whole where anything is not as it should be", () => {
    const importMappings = [
      { id: "112000000001", name: "Division from HQ Network.csv", importType: "HIERARCHY_DATA", targets: [{ target: "Division", source: "column", column: 1, text: "Division Name" },
        { target: "Parent", source: "constant", text: "All" }, { target: "Code", source: "none" }, { target: "Manager", source: "other", text: "field" },
        { target: "Region", source: "column", id: "f12" }, { target: "Batch", source: "numbered" }],
      matchedBy: { by: "properties", properties: ["Manager", "Parent"], numbered: true } },
      { id: "", name: "Gone", importType: "", targets: [], note: "Cardigan could not read this import's mapping." }];
    const model = { ...result, kind: "model" as const, importMappings };
    const read = plainResult({ ...model, importMappings: importMappings.map(mapping => ({ ...mapping, extra: "<b>", targets: mapping.targets.map(target => ({ ...target, html: 1 })) })) });
    expect(read).toEqual(model);
    expect(Object.keys(read!.importMappings![0].targets[0])).toEqual(["target", "source", "column", "text"]);
    const target = importMappings[0].targets[0];
    const mapping = importMappings[0];
    for (const odd of [{ ...mapping, id: "1x" }, { ...mapping, id: 112000000001 }, { ...mapping, name: null }, { ...mapping, importType: 1 }, { ...mapping, targets: "none" },
      { ...mapping, note: 7 }, { ...mapping, targets: [{ ...target, source: "file" }] }, { ...mapping, targets: [{ ...target, source: "toString" }] },
      { ...mapping, targets: [{ ...target, column: 0 }] }, { ...mapping, targets: [{ ...target, column: 1.5 }] }, { ...mapping, targets: [{ ...target, column: "1" }] },
      { ...mapping, targets: [{ ...target, text: 3 }] }, { ...mapping, targets: [{ ...target, id: 12 }] }, { ...mapping, targets: [{ ...target, target: undefined }] },
      { ...mapping, targets: [null] }, { ...mapping, matchedBy: { by: "toString" } }, { ...mapping, matchedBy: "code" }, { ...mapping, matchedBy: null },
      { ...mapping, matchedBy: { by: "properties", properties: [1] } }, { ...mapping, matchedBy: { by: "properties", properties: "Manager" } },
      { ...mapping, matchedBy: { by: "code", numbered: "yes" } }, null, "mapping"]) {
      expect(plainResult({ ...model, importMappings: [odd] }), JSON.stringify(odd)).toEqual({ ...result, kind: "model" });
    }
    expect(plainResult({ ...model, importMappings: { 0: mapping } })).toEqual({ ...result, kind: "model" });
    // What a definition holds of how its sources are read: kept where every field is as it should be, and else the whole.
    const read2 = { id: "112000000020", name: "Rates", importType: "MODULE_DATA", targets: [{ target: "Products", source: "column", text: "Product", items: { byHand: 2, ignored: 1 } },
      { target: "Time", source: "column", column: 2, periodFormat: null }, { target: "Month end", source: "column", column: 3, periodFormat: "MMM YY" },
      { target: "Ship Date", source: "column", column: 4, dateFormat: "DD/MM/YYYY" }, { target: "Line Items", source: "headerRow", items: { byHand: 0, ignored: 0 } }],
    headers: [{ header: "Cost (EUR)", lineItem: "Cost" }, { header: "Comment" }] };
    expect(plainResult({ ...model, importMappings: [read2] })).toEqual({ ...model, importMappings: [read2] });
    const items = read2.targets[0];
    for (const odd of [{ ...read2, targets: [{ ...items, items: { byHand: -1, ignored: 0 } }] }, { ...read2, targets: [{ ...items, items: { byHand: 1.5, ignored: 0 } }] },
      { ...read2, targets: [{ ...items, items: { byHand: 1 } }] }, { ...read2, targets: [{ ...items, items: null }] }, { ...read2, targets: [{ ...items, periodFormat: 7 }] },
      { ...read2, targets: [{ ...items, dateFormat: null }] }, { ...read2, headers: "Cost" }, { ...read2, headers: [{ header: 1 }] }, { ...read2, headers: [{ header: "A", lineItem: 2 }] },
      { ...read2, headers: [null] }]) {
      expect(plainResult({ ...model, importMappings: [odd] }), JSON.stringify(odd)).toEqual({ ...result, kind: "model" });
    }
    // An app has none.
    expect(plainResult({ ...result, importMappings })).toEqual(result);
  });

  it("keeps what a mapping says of its Source Type, what it clears, its File Options and what each target is, and reads one without them as an earlier version kept it", () => {
    const model = { ...result, kind: "model" as const };
    const now = { id: "112000000051", name: "Load joiners", sourceType: "FILE", importType: "MODULE_DATA", clear: "clear", targets: [
      { target: "Time", source: "column", text: "Time", kind: "time", area: "MATCHED_ITEMS", periodFormat: "M-Y" }, { target: "Join Band", source: "prompt", kind: "list" },
      { target: "Line Items", source: "headerRow", kind: "lineItems", area: "MAPPED_ITEMS_IN_SOURCE", items: { byHand: 3, ignored: 0 } }],
    headers: [{ header: "Bonus Rate", lineItem: "Bonus Rate" }],
    fileOptions: { encoding: "ISO-8859-1", separators: ",\t", delimiter: "", decimal: ".", headerRow: 0, firstDataRow: 1 } };
    // Every field as it is, and nothing more: of the File Options, the six the dialog reads.
    const read = plainResult({ ...model, importMappings: [{ ...now, fileOptions: { ...now.fileOptions, objectId: 102000000008, modelId: "4B7E0C1D9A2F4E3B8C6D5A4F3E2D1C0B" } }] });
    expect(read).toEqual({ ...model, importMappings: [now] });
    expect(Object.keys(read!.importMappings![0].fileOptions!)).toEqual(["encoding", "separators", "delimiter", "decimal", "headerRow", "firstDataRow"]);
    // A mapping of an import into a list, with its Source Type and nothing more, and one an earlier version kept, with none
    // of these, are read as they are.
    const list = { id: "112000000002", name: "Regions from the hub", sourceType: "SAVED VIEW", importType: "HIERARCHY_DATA", targets: [{ target: "+ Regions", source: "column", text: "Region" }] };
    const earlier = { id: "112000000001", name: "Division from HQ Network.csv", importType: "HIERARCHY_DATA", targets: [{ target: "Division", source: "column", column: 1 }] };
    expect(plainResult({ ...model, importMappings: [list, earlier] })).toEqual({ ...model, importMappings: [list, earlier] });
    // Anything else is no mapping, and none of the result's mappings is kept.
    const time = now.targets[0];
    for (const odd of [{ ...now, sourceType: 3 }, { ...now, sourceType: null }, { ...now, clear: "all" }, { ...now, clear: true }, { ...now, fileOptions: "ISO-8859-1" },
      { ...now, fileOptions: null }, { ...now, fileOptions: [] }, { ...now, fileOptions: { encoding: 8859 } }, { ...now, fileOptions: { separators: [","] } },
      { ...now, fileOptions: { delimiter: null } }, { ...now, fileOptions: { decimal: 0 } }, { ...now, fileOptions: { headerRow: "1" } },
      { ...now, fileOptions: { firstDataRow: -1 } }, { ...now, fileOptions: { headerRow: 1.5 } }, { ...now, targets: [{ ...time, kind: "dimension" }] },
      { ...now, targets: [{ ...time, kind: "toString" }] }, { ...now, targets: [{ ...time, kind: 1 }] }, { ...now, targets: [{ ...time, area: ["MATCHED_ITEMS"] }] }]) {
      expect(plainResult({ ...model, importMappings: [odd] }), JSON.stringify(odd)).toEqual(model);
    }
  });

  it("keeps a list's items mapped manually with the module's and the list's IDs, as the reader makes them, and reads a mapping of 0.37.0 without them as it is", () => {
    const model = { ...result, kind: "model" as const };
    // As the export reads them out of a definition (model/import-mappings.ts), and as the bridge then checks them: every
    // pair, ID and module ID comes through, so that the run can ask for the items' names.
    const definition = JSON.stringify({ importType: "MODULE_DATA", target: "_102000000041_", mappings: [
      { targetType: "moduleDimension", target: "_101000000041_", sourceType: "column", sourceColumnId: "#1", sourceColumnName: "Division" }],
    valueMaps: [{ targetType: "moduleDimension", target: "_101000000041_", values: { North: 201000000011, "Old office": -1 } }] });
    const { mapping: read } = readDefinition(definition, { list: id => (id === 101000000041 ? "Division" : undefined), lineItem: () => undefined, property: () => undefined });
    const reader = { id: "112000000072", name: "Load division costs", sourceType: "FILE", ...read };
    expect([read.moduleId, read.targets[0].dimensionId, read.targets[0].pairs]).toEqual(["102000000041", "101000000041", [{ source: "North", item: "201000000011" }, { source: "Old office" }]]);
    expect(plainResult({ ...model, importMappings: [reader] })).toEqual({ ...model, importMappings: [reader] });
    // A mapping of 0.37.0 says only how many are mapped manually: it is read as it is.
    const { pairs, dimensionId, ...earlierTarget } = reader.targets[0];
    const { moduleId, ...withoutModule } = reader;
    const earlier = { ...withoutModule, targets: [earlierTarget] };
    expect([moduleId, pairs?.length, dimensionId, plainResult({ ...model, importMappings: [earlier] })])
      .toEqual(["102000000041", 2, "101000000041", { ...model, importMappings: [earlier] }]);
    // Anything else is no mapping, and none of the result's mappings is kept.
    const target = reader.targets[0];
    for (const odd of [{ ...reader, moduleId: 102000000041 }, { ...reader, moduleId: "102x" }, { ...reader, moduleId: "" }, { ...reader, targets: [{ ...target, dimensionId: 101000000041 }] },
      { ...reader, targets: [{ ...target, dimensionId: "-5" }] }, { ...reader, targets: [{ ...target, pairs: "North" }] }, { ...reader, targets: [{ ...target, pairs: [null] }] },
      { ...reader, targets: [{ ...target, pairs: [{ item: "201000000011" }] }] }, { ...reader, targets: [{ ...target, pairs: [{ source: "North", item: 201000000011 }] }] },
      { ...reader, targets: [{ ...target, pairs: [{ source: "North", item: "-1" }] }] }, { ...reader, targets: [{ ...target, pairs: [{ source: 1 }] }] }]) {
      expect(plainResult({ ...model, importMappings: [odd] }), JSON.stringify(odd)).toEqual(model);
    }
  });

  it("keeps the names of the items the imports map manually, and leaves them out, the result kept, where anything is not as it should be", () => {
    const model = { ...result, kind: "model" as const };
    const importItemNames = [["201000000011", "North Division"], ["201000000012", ""]];
    const read = plainResult({ ...model, importItemNames });
    expect(read).toEqual({ ...model, importItemNames });
    expect(read!.importItemNames).not.toBe(importItemNames);
    for (const odd of [[["201000000011"]], [["201000000011", "North", "x"]], [[201000000011, "North"]], [["2010x", "North"]], [["201000000011", 7]], [null], "North",
      { "201000000011": "North" }]) {
      expect(plainResult({ ...model, importItemNames: odd }), JSON.stringify(odd)).toEqual(model);
    }
    // An app's result has none.
    expect(plainResult({ ...result, importItemNames })).toEqual(result);
    expect([readImportItemNames(importItemNames), readImportItemNames(undefined), readImportItemNames([["1", 2]])]).toEqual([importItemNames, undefined, undefined]);
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
