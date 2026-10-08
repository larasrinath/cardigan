import { describe, expect, it } from "vitest";
import { sourceObjectOf } from "./source-object.js";

// Source Object cells as the Imports tab of Anaplan's Model settings writes them. The first two are the user's own
// examples; "Hub / 'LIST - Regions'.Export" is the import of the export's golden model (model/model.test.ts). The other
// names are made up.

describe("An import's Source Object, read as the model's object it names", () => {
  it("reads a model, a module and a saved view, each name out of its quotes", () => {
    expect(sourceObjectOf("M0 Data Hub [DEV] / 'HRY01 ORG Hierarchy Builder'.'DATA & LIST: ORG3 Area'"))
      .toEqual({ model: "M0 Data Hub [DEV]", module: "HRY01 ORG Hierarchy Builder", view: "DATA & LIST: ORG3 Area" });
    // A name that needs no quotes is written without them.
    expect(sourceObjectOf("Hub / 'LIST - Regions'.Export")).toEqual({ model: "Hub", module: "LIST - Regions", view: "Export" });
    expect(sourceObjectOf("Hub / Regions.Export")).toEqual({ model: "Hub", module: "Regions", view: "Export" });
    // White space around the cell is not part of it.
    expect(sourceObjectOf("  Hub / 'Regions'.'Export'\n")).toEqual({ model: "Hub", module: "Regions", view: "Export" });
  });

  it("reads a module and a saved view without a model as this model's own, and a module named alone as one without a saved view", () => {
    expect(sourceObjectOf("'SYS ORG1 Campus #'.'DATA: SYS ORG1 Campus # (Reset)'")).toEqual({ module: "SYS ORG1 Campus #", view: "DATA: SYS ORG1 Campus # (Reset)" });
    expect(sourceObjectOf("'SYS ORG1 Campus #'")).toEqual({ module: "SYS ORG1 Campus #" });
    expect(sourceObjectOf("Regions")).toEqual({ module: "Regions" });
    expect(sourceObjectOf("M0 Data Hub [DEV] / 'HRY01 ORG Hierarchy Builder'")).toEqual({ model: "M0 Data Hub [DEV]", module: "HRY01 ORG Hierarchy Builder" });
  });

  it("reads a saved view written without quotes, spaces and all, as all that follows the module's dot", () => {
    // As the Imports tab writes a saved view whose name has spaces and nothing that needs quotes (the user's example).
    expect(sourceObjectOf("'ADM003 - Keep Awake'.EXPORT Keep Awake")).toEqual({ module: "ADM003 - Keep Awake", view: "EXPORT Keep Awake" });
    expect(sourceObjectOf("Hub v1.2 / 'ADM003 - Keep Awake'.EXPORT Keep Awake")).toEqual({ model: "Hub v1.2", module: "ADM003 - Keep Awake", view: "EXPORT Keep Awake" });
    // A dot in a model's name is no view's: the view's dot is the last one, and a module named alone has none after it.
    expect(sourceObjectOf("Hub v1.2 / Regions")).toEqual({ model: "Hub v1.2", module: "Regions" });
  });

  it("keeps a dot, a slash and a doubled quote inside a quoted name as the name's own", () => {
    expect(sourceObjectOf("Hub / 'A / B'.'C.D'")).toEqual({ model: "Hub", module: "A / B", view: "C.D" });
    expect(sourceObjectOf("'A / B'.'C.D'")).toEqual({ module: "A / B", view: "C.D" });
    // Two quotes inside the quotes are one of the name's own, as the export writes "'Editor''s lock'".
    expect(sourceObjectOf("'Editor''s lock'.'Bob''s view'")).toEqual({ module: "Editor's lock", view: "Bob's view" });
    expect(sourceObjectOf("Hub / '''Quoted'''.View")).toEqual({ model: "Hub", module: "'Quoted'", view: "View" });
    expect(sourceObjectOf("Hub / 'It''s / 2.0'")).toEqual({ model: "Hub", module: "It's / 2.0" });
  });

  it("takes as the model's name all that stands before the module and the slash in front of it, whatever that holds", () => {
    // The model's name is written as it is, without quotes: a slash, a quote or a dot in it is its own.
    expect(sourceObjectOf("Finance / Ops Hub / 'REV01 Revenue'.Export")).toEqual({ model: "Finance / Ops Hub", module: "REV01 Revenue", view: "Export" });
    expect(sourceObjectOf("Bob's Hub / 'M'.V")).toEqual({ model: "Bob's Hub", module: "M", view: "V" });
    expect(sourceObjectOf("FP&A v2.1 / 'M'.V")).toEqual({ model: "FP&A v2.1", module: "M", view: "V" });
    // Quotes round it are part of it, as the cell has them: the export puts none there.
    expect(sourceObjectOf("'Quoted model' / 'M'.V")).toEqual({ model: "'Quoted model'", module: "M", view: "V" });
  });

  it("gives nothing for a cell that is not written as a model's object", () => {
    // The dash Anaplan writes for a file's import, nothing at all, and text whose names are not written as a model's are:
    // a model without its object, a slash without its spaces, a dot without a name on one side, text after the object,
    // a quote that is not closed or not opened, a quoted name of nothing, and a name of several words without quotes.
    for (const text of ["-", "", "   ", "Hub / ", " / 'M'.V", "Hub /'M'.V", "Hub/'M'.V", "'M'.", ".V", "'M'.'V' and more", "'M", "M'", "'M''", "''", "'   '.V", "Hub / ''.V",
      "Mod Name.View", "Hub / Mod Name.View", "Hub / -", "'M'.-"]) {
      expect(sourceObjectOf(text), text).toBeUndefined();
    }
    for (const cell of [null, undefined, 42, true, {}, ["Hub / 'M'.V"]]) expect(sourceObjectOf(cell), String(cell)).toBeUndefined();
    // A file's name is written as a module and a saved view would be: only the import's Source Type tells the two apart,
    // and this reads no Source Type.
    expect(sourceObjectOf("prices.csv")).toEqual({ module: "prices", view: "csv" });
  });
});
