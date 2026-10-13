import { describe, expect, it } from "vitest";
import type { AnalysisResult, ResultTable } from "../result-types.js";
import { SAVED_VIEW_FILTER_HEADERS, SAVED_VIEW_HEADERS } from "../saved-view-filters.js";
import { savedViewOfRow, withSavedViews } from "./saved-view-filters-view.js";

// Invented names only.
const DETAILS: ResultTable = { file: "Model Details.csv", label: "Model Details", headers: ["Section", "Detail", "Value"], guard: true, details: true, rows: [
  ["Model", "Model", "Invented plan"], ["Files", "Line Items.csv", "3 rows"], ["Files", "Saved View Filters.csv", "2 rows"],
  ["Notes", "Saved View Filters", "1 of the 2 saved views could not be read, so their filters are not known."],
  ["How to read", "Saved View Filters", "Under App Usage's Page Filters: each saved view of the model with a filter."], ["Diagnostics", "09:30:00", "Saved View Filters: read"]] };
const VIEWS: ResultTable = { file: "Saved View Filters.csv", label: "Saved View Filters", headers: [...SAVED_VIEW_HEADERS], guard: false, rows: [
  ["Open items", "REV01 Revenue", "Rows: Active? = True", "SYS01 Flags.Active?", "", "", "", "Yes"], ["Refused", "SYS01 Flags", "", "", "", "", "", "No"]] };
/** A result as 0.43.0 and 0.44.0 kept one: its table of the saved views with a filter under Saved View Filters' name. */
const KEPT: AnalysisResult = { kind: "model", name: "Invented plan", id: "FEDCBA9876543210FEDCBA9876543210", zipName: "x.zip",
  summary: ["Line Items: 3 rows", "Saved View Filters: 2 rows", "Saved View Filters: 1 of the 2 saved views could not be read, so their filters are not known."],
  tables: [DETAILS, { file: "Line Items.csv", label: "Line Items", headers: ["", "Saved View Filters"], guard: false, rows: [["Active?", 1]] }, VIEWS],
  savedViewDetails: [{ name: "Open items", module: "REV01 Revenue", read: true, filters: [{ axis: "Rows", active: true, match: "all", conditions: [
    { lineItem: "Active?", lineItemModule: "SYS01 Flags", operator: "EQUALS", dataType: "BOOLEAN", values: ["True"], contexts: [], valid: true }] }] },
  { name: "Refused", module: "SYS01 Flags", read: false, filters: [] }] };

describe("A result an earlier version kept, with its saved views under Saved View Filters' name", () => {
  it("is shown with that table as Saved Views, its file and label, and the lines about it under that name, and nothing else changed", () => {
    const shown = withSavedViews(KEPT);
    const table = shown.tables.find(each => each.file === "Saved Views.csv")!;
    expect([table.label, table.headers, table.rows, shown.tables.some(each => each.file === "Saved View Filters.csv")]).toEqual(["Saved Views", VIEWS.headers, VIEWS.rows, false]);
    expect(shown.tables[0].rows.map(row => row.slice(0, 2).join(" / "))).toEqual(["Model / Model", "Files / Line Items.csv", "Files / Saved Views.csv",
      "Notes / Saved Views", "How to read / Saved Views", "Diagnostics / 09:30:00"]);
    // What the lines say stays as that version wrote it; the diagnostic log, and Line Items' column of that name, are as they were.
    expect(shown.tables[0].rows.map(row => row[2])).toEqual(DETAILS.rows.map(row => row[2]));
    expect(shown.summary).toEqual(["Line Items: 3 rows", "Saved Views: 2 rows", "Saved Views: 1 of the 2 saved views could not be read, so their filters are not known."]);
    expect([shown.tables[1], shown.savedViewDetails]).toEqual([KEPT.tables[1], KEPT.savedViewDetails]);
    // Each row has its view's details, as Saved Views' rows do.
    expect(table.rows.map(row => savedViewOfRow(shown, table, row)?.name)).toEqual(["Open items", "Refused"]);
    // The result given is not changed.
    expect([KEPT.tables[2].file, KEPT.tables[0].rows[2][1], KEPT.summary[1]]).toEqual(["Saved View Filters.csv", "Saved View Filters.csv", "Saved View Filters: 2 rows"]);
  });

  it("leaves as it is a result of this version, one without that table, and an app's", () => {
    const filters: ResultTable = { file: "Saved View Filters.csv", label: "Saved View Filters", headers: [...SAVED_VIEW_FILTER_HEADERS], guard: true, rows: [] };
    const now: AnalysisResult = { ...KEPT, tables: [DETAILS, { ...VIEWS, file: "Saved Views.csv", label: "Saved Views" }, filters] };
    const before: AnalysisResult = { ...KEPT, tables: [KEPT.tables[0], KEPT.tables[1]] };
    const app: AnalysisResult = { ...KEPT, kind: "app" };
    // The very result: nothing is copied.
    expect([withSavedViews(now), withSavedViews(before), withSavedViews(app), withSavedViews({ ...KEPT, tables: [DETAILS, filters] }).tables[1]])
      .toEqual([now, before, app, filters]);
    expect([withSavedViews(now) === now, withSavedViews(before) === before, withSavedViews(app) === app]).toEqual([true, true, true]);
    // Shown once, it is shown so again, as a refresh of the page shows the result it kept.
    const once = withSavedViews(KEPT);
    expect(withSavedViews(once)).toBe(once);
  });
});
