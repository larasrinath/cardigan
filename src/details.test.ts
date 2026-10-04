import { afterEach, describe, expect, it, vi } from "vitest";
import { DETAILS_HEADERS, diagnosticRows, exportRows, stampLine } from "./details.js";
import { toCsv } from "./zip.js";

describe("App Details.csv and Model Details.csv", () => {
  afterEach(() => vi.useRealTimers());

  it("says when, with which build and from which host the export was made", () => {
    expect(exportRows("us1a.app.anaplan.com", new Date(Date.UTC(2026, 8, 28, 1, 59, 9)))).toEqual([
      ["Export", "Exported on", "2026-09-28 01:59 UTC"], ["Export", "Exported with", "Cardigan dev"], ["Export", "Anaplan host", "us1a.app.anaplan.com"]]);
  });

  it("keeps the diagnostic log, one row per line with its time stamp", () => {
    const rows = diagnosticRows("01:59:09 app-analysis v0.5.0: app on us1a.app.anaplan.com\r\n01:59:10 GET /a/springboard-definition-service/apps 200\r\n\r\nplain line");
    expect(rows).toEqual([["Diagnostics", "01:59:09", "app-analysis v0.5.0: app on us1a.app.anaplan.com"],
      ["Diagnostics", "01:59:10", "GET /a/springboard-definition-service/apps 200"], ["Diagnostics", "", "plain line"]]);
    expect(toCsv(DETAILS_HEADERS, rows.slice(0, 1)).split("\r\n")[1]).toBe("Diagnostics,01:59:09,app-analysis v0.5.0: app on us1a.app.anaplan.com");
  });

  it("stamps a log line with its time in the form the diagnostic rows read back", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.UTC(2026, 8, 28, 1, 59, 9, 999)));
    expect(stampLine("model status UNKNOWN")).toBe("01:59:09 model status UNKNOWN");
    expect(diagnosticRows([stampLine("model status UNKNOWN"), stampLine("")].join("\r\n"))).toEqual([["Diagnostics", "01:59:09", "model status UNKNOWN"], ["Diagnostics", "01:59:09", ""]]);
  });
});
