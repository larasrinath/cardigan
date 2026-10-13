import { describe, expect, it } from "vitest";
import { plainCell, plainResult, plainRows, textOf } from "./result-plain.js";
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
    // So do the columns of its Line Items grid, and how many of the grid's rows the model refused: a list of texts and a whole
    // number above nought. Anything else is left out; an app has neither.
    const lineItemColumns = ["Formula", "Populated Cell Count", ""];
    expect(plainResult({ ...model, lineItemColumns, lineItemsRefused: 2 })).toEqual({ ...model, lineItemColumns, lineItemsRefused: 2 });
    for (const odd of [["Formula", 3], "Formula", [null], { 0: "Formula" }]) {
      expect(plainResult({ ...model, lineItemColumns: odd }), JSON.stringify(odd)).toEqual(model);
    }
    for (const odd of [0, -1, 1.5, "2", Number.NaN, null]) expect(plainResult({ ...model, lineItemsRefused: odd }), String(odd)).toEqual(model);
    expect(plainResult({ ...result, lineItemColumns, lineItemsRefused: 2 })).toEqual(result);
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

  it("keeps a model's saved views' filters, their conditions for the map and their IDs, every field checked, and leaves each out whole where anything is not as it should be", () => {
    const model = { ...result, kind: "model" as const };
    const condition = { lineItem: "Active?", lineItemModule: "SYS01 Flags", operator: "EQUALS", dataType: "BOOLEAN", values: ["True"], contexts: ["SCN042:Spring Launch"], valid: true };
    const savedViewDetails = [{ name: "Open items", module: "REV01 Revenue", read: true, filters: [{ axis: "Pages", dimension: "Version", active: false, match: "any",
      conditions: [condition, { ...condition, lineItemModule: undefined, lineItem: "Missing line item (ID 2000000099)", valid: false }] }] },
    { name: "Refused", module: "REV01 Revenue", read: false, filters: [] }];
    const savedViewFilters = [{ view: "Open items", module: "REV01 Revenue", axis: "Pages", lineItem: "Active?", lineItemModule: "SYS01 Flags", active: false, valid: true }];
    const savedViewIds = ["105000000001", "105000000002"];
    const read = plainResult(JSON.parse(JSON.stringify({ ...model, savedViewDetails: savedViewDetails.map(view => ({ ...view, extra: "<b>" })), savedViewFilters, savedViewIds })));
    expect(read).toEqual({ ...model, savedViewDetails: JSON.parse(JSON.stringify(savedViewDetails)), savedViewFilters, savedViewIds });
    // Each field is checked on its own: anything amiss leaves that field out, and the result is read all the same.
    for (const odd of [[{ ...savedViewDetails[0], read: "yes" }], [{ ...savedViewDetails[0], filters: [{ ...savedViewDetails[0].filters[0], axis: "Diagonal" }] }],
      [{ ...savedViewDetails[0], filters: [{ ...savedViewDetails[0].filters[0], match: "some" }] }],
      [{ ...savedViewDetails[0], filters: [{ ...savedViewDetails[0].filters[0], conditions: [{ ...condition, values: [1] }] }] }], "Open items", null]) {
      expect(plainResult({ ...model, savedViewDetails: odd, savedViewFilters, savedViewIds }), JSON.stringify(odd)).toEqual({ ...model, savedViewFilters, savedViewIds });
    }
    for (const odd of [[{ ...savedViewFilters[0], axis: "rows" }], [{ ...savedViewFilters[0], lineItemModule: undefined }], [{ ...savedViewFilters[0], active: 1 }], {}]) {
      expect(plainResult({ ...model, savedViewFilters: odd }), JSON.stringify(odd)).toEqual(model);
    }
    for (const odd of [["105000000001", "x1"], [105000000001], "105000000001"]) expect(plainResult({ ...model, savedViewIds: odd }), JSON.stringify(odd)).toEqual(model);
    // An app's result has none; a model's that an earlier version kept has none either, and is read all the same.
    expect(plainResult({ ...result, savedViewDetails, savedViewFilters, savedViewIds })).toEqual(result);
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

  it("keeps whether an import's source is this model's, as a truth alone, and reads a mapping without it as an earlier version kept it", () => {
    const model = { ...result, kind: "model" as const };
    const own = { id: "112000000058", name: "Bands from staff costs", sourceType: "MODULE", importType: "MODULE_DATA", targets: [], sourceInThisModel: true };
    const hub = { ...own, id: "112000000059", name: "Bands from the hub", sourceType: "SAVED VIEW", sourceInThisModel: false };
    const earlier = { id: "112000000060", name: "Bands from elsewhere", sourceType: "LIST", importType: "HIERARCHY_DATA", targets: [] };
    expect(plainResult({ ...model, importMappings: [own, hub, earlier] })).toEqual({ ...model, importMappings: [own, hub, earlier] });
    expect(Object.hasOwn(plainResult({ ...model, importMappings: [earlier] })!.importMappings![0], "sourceInThisModel")).toBe(false);
    // Anything but a truth is no mapping, and none of the result's mappings is kept.
    for (const odd of [{ ...own, sourceInThisModel: "true" }, { ...own, sourceInThisModel: 1 }, { ...own, sourceInThisModel: null }, { ...own, sourceInThisModel: { here: true } }]) {
      expect(plainResult({ ...model, importMappings: [odd, hub] }), JSON.stringify(odd)).toEqual(model);
    }
  });

  it("reads a result 0.38.0 kept, with a list's items mapped manually and their names, without them: whatever they hold, they never keep it from loading", () => {
    const model = { ...result, kind: "model" as const };
    // An import into a module as this version keeps it: of its list mapped manually, how many items, and how many ignored.
    const now = { id: "112000000072", name: "Load division costs", sourceType: "FILE", importType: "MODULE_DATA", clear: "clear", targets: [
      { target: "Division", source: "column", column: 1, text: "Division", kind: "list", area: "ALL_ITEMS", items: { byHand: 1, ignored: 1 } },
      { target: "Line Items", source: "headerRow", kind: "lineItems", items: { byHand: 1, ignored: 0 } }],
    headers: [{ header: "Cost (EUR)", lineItem: "Cost" }] };
    // The same as 0.38.0 kept it: the module's ID, each of the list's pairs with the list's ID, and the names the run read
    // of those items. Every name and ID is made up.
    const division = { ...now.targets[0], dimensionId: "101000000041", pairs: [{ source: "North", item: "201000000011" }, { source: "Old office" }] };
    const old = { ...now, moduleId: "102000000041", targets: [division, now.targets[1]] };
    const kept = { ...model, importMappings: [old], importItemNames: [["201000000011", "North Division"]] };
    // It loads as this version's would: the counts, and the line items' header pair by pair; no list item, no name, no ID.
    const read = plainResult(kept);
    expect(read).toEqual({ ...model, importMappings: [now] });
    expect([Object.hasOwn(read!, "importItemNames"), Object.hasOwn(read!.importMappings![0], "moduleId"), Object.keys(read!.importMappings![0].targets[0]).sort()])
      .toEqual([false, false, ["area", "column", "items", "kind", "source", "target", "text"]]);
    // Not even what 0.38.0 itself refused keeps the mapping out now: those fields are left out as they are.
    for (const odd of [{ ...old, moduleId: 102000000041 }, { ...old, moduleId: "102x" }, { ...old, targets: [{ ...division, dimensionId: -5 }, now.targets[1]] },
      { ...old, targets: [{ ...division, pairs: "North" }, now.targets[1]] }, { ...old, targets: [{ ...division, pairs: [null, { item: 201000000011 }] }, now.targets[1]] }]) {
      expect(plainResult({ ...kept, importMappings: [odd] }), JSON.stringify(odd)).toEqual({ ...model, importMappings: [now] });
    }
    for (const names of [[["2010x", "North"]], [["201000000011", 7]], [null], "North", { "201000000011": "North" }]) {
      expect(plainResult({ ...kept, importItemNames: names }), JSON.stringify(names)).toEqual({ ...model, importMappings: [now] });
    }
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
