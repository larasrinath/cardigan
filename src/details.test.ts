import { describe, expect, it } from "vitest";
import { DETAILS_HEADERS, diagnosticRows, exportRows } from "./details.js";
import { toCsv } from "./zip.js";

describe("App Details.csv and Model Details.csv", () => {
  it("says when, with which build and from which host the export was made", () => {
    expect(exportRows("us1a.app.anaplan.com", new Date(Date.UTC(2026, 8, 28, 1, 59, 9)))).toEqual([
      ["Export", "Exported on", "2026-09-28 01:59 UTC"], ["Export", "Exported with", "Anaplan Analyzer dev"], ["Export", "Anaplan host", "us1a.app.anaplan.com"]]);
  });

  it("keeps the diagnostic log, one row per line with the panel's time stamp", () => {
    const rows = diagnosticRows("01:59:09 app-analysis v0.5.0: app on us1a.app.anaplan.com\r\n01:59:10 GET /a/springboard-definition-service/apps 200\r\n\r\nplain line");
    expect(rows).toEqual([["Diagnostics", "01:59:09", "app-analysis v0.5.0: app on us1a.app.anaplan.com"],
      ["Diagnostics", "01:59:10", "GET /a/springboard-definition-service/apps 200"], ["Diagnostics", "", "plain line"]]);
    expect(toCsv(DETAILS_HEADERS, rows.slice(0, 1)).split("\r\n")[1]).toBe("Diagnostics,01:59:09,app-analysis v0.5.0: app on us1a.app.anaplan.com");
  });
});
