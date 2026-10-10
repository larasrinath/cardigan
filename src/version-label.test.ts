import { describe, expect, it } from "vitest";
import type { AnalysisResult } from "./result-types.js";
import { withVersion } from "./version-label.js";

const MODEL = "FEDCBA9876543210FEDCBA9876543210";
/** A model's export as a reader of an earlier version hands it over: its Details table says that version twice. */
const exported = (): AnalysisResult => ({ kind: "model", name: "Model one", id: MODEL, zipName: "Model one - Model Export - 2026-10-10.zip", summary: [],
  tables: [{ file: "Model Details.csv", label: "Model Details", headers: ["Section", "Detail", "Value"], guard: true, details: true, rows: [
    ["Export", "Exported on", "2026-10-10 14:02 UTC"], ["Export", "Exported with", "Cardigan 0.13.0"], ["Export", "Anaplan host", "eu2a.app.anaplan.com"],
    ["Diagnostics", "14:02:05", `Cardigan 0.13.0: model ${MODEL} on eu2a.app.anaplan.com`], ["Diagnostics", "14:02:05", "Loading the model page's client…"],
    ["Diagnostics", "14:02:06", "Cardigan 0.13.0: app or model, as a line of the model's own"], ["Notes", "Exported with", "Cardigan 0.13.0"]] },
  { file: "Versions.csv", label: "Versions", headers: ["", "Notes"], guard: false, rows: [["Actual", "Cardigan 0.13.0: model on a page"]] }] });

describe("The version a model's export says it was made with", () => {
  it("is the one of the content script and the results page, whichever version the model's reader is of", () => {
    const given = exported();
    const said = withVersion(given, "0.14.1");
    // The row that says so, and the first line of the log where it names a version. Nothing else, and no other table.
    expect(said.tables[0].rows).toEqual([
      ["Export", "Exported on", "2026-10-10 14:02 UTC"], ["Export", "Exported with", "Cardigan 0.14.1"], ["Export", "Anaplan host", "eu2a.app.anaplan.com"],
      ["Diagnostics", "14:02:05", `Cardigan 0.14.1: model ${MODEL} on eu2a.app.anaplan.com`], ["Diagnostics", "14:02:05", "Loading the model page's client…"],
      ["Diagnostics", "14:02:06", "Cardigan 0.14.1: app or model, as a line of the model's own"], ["Notes", "Exported with", "Cardigan 0.13.0"]]);
    expect(said.tables[1]).toBe(given.tables[1]);
    // The result given stays as it was.
    expect(given).toEqual(exported());
    // In a test the build names no version: the page's own word for that.
    expect(withVersion(given).tables[0].rows[1]).toEqual(["Export", "Exported with", "Cardigan dev"]);
  });
});
