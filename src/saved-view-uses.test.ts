import { describe, expect, it } from "vitest";
import type { AnalysisResult, ResultTable, SavedViewDetail, SavedViewFilter } from "./result-types.js";
import { addViewFilterUses } from "./saved-view-uses.js";

// Invented names only.
const LINE_ITEMS: ResultTable = { file: "Line Items.csv", label: "Line Items", guard: false, headers: ["", "Formula", "Module Name"], rows: [
  ["REV01 Revenue", "", ""], ["Active?", "", "REV01 Revenue"], ["Volume", "", "REV01 Revenue"], ["Orphan", "", ""], ["SYS01 Flags", "", ""], ["Region", "", "SYS01 Flags"]] };
const SAVED: ResultTable = { file: "Saved Views.csv", label: "Saved Views", guard: false, headers: ["Name", "Module"], rows: [["Open items", "REV01 Revenue"], ["Split", "REV01 Revenue"]] };
const use = (view: string, lineItem: string, lineItemModule: string, active = true): SavedViewFilter =>
  ({ view, module: "REV01 Revenue", axis: "Rows", lineItem, lineItemModule, active, valid: true });
const detail = (name: string, read = true): SavedViewDetail => ({ name, module: "REV01 Revenue", read, filters: [] });
const model = (more: Partial<AnalysisResult>, tables: ResultTable[] = [LINE_ITEMS, SAVED]): AnalysisResult =>
  ({ kind: "model", name: "Invented plan", id: "FEDCBA9876543210FEDCBA9876543210", zipName: "x.zip", summary: [], tables, ...more });
const counts = (result: AnalysisResult) => {
  const table = result.tables.find(each => each.file === "Line Items.csv")!;
  return table.rows.map(row => `${row[0]}: ${JSON.stringify(row[table.headers.indexOf("Saved View Filters")])}`);
};

describe("Line Items' count of the saved views whose filters use each line item", () => {
  it("counts each view once for a line item its filters use, on or off, by the line item's module and name, and 0 for the others", () => {
    const given = model({ savedViewDetails: [detail("Open items"), detail("Split")],
      savedViewFilters: [use("Open items", "Active?", "REV01 Revenue"), use("Open items", "Active?", "REV01 Revenue"), use("Split", "Active?", "REV01 Revenue", false),
        use("Split", "Region", "SYS01 Flags")] });
    const made = addViewFilterUses(given);
    expect(made.tables[0].headers).toEqual(["", "Formula", "Module Name", "Saved View Filters"]);
    // A module's own row has none, nor has a line item whose module is not known.
    expect(counts(made)).toEqual(["REV01 Revenue: \"\"", "Active?: 2", "Volume: 0", "Orphan: \"\"", "SYS01 Flags: \"\"", "Region: 1"]);
    // The result given is not changed.
    expect([given.tables[0].headers.length, given.tables[0].rows[1].length]).toEqual([3, 3]);
  });

  it("leaves the count empty, not 0, where a view's definition was not read, or the saved views could not be listed", () => {
    const unread = addViewFilterUses(model({ savedViewDetails: [detail("Open items"), detail("Refused", false)], savedViewFilters: [use("Open items", "Active?", "REV01 Revenue")] }));
    expect(counts(unread)).toEqual(["REV01 Revenue: \"\"", "Active?: 1", "Volume: \"\"", "Orphan: \"\"", "SYS01 Flags: \"\"", "Region: \"\""]);
    const unlisted = addViewFilterUses(model({}, [LINE_ITEMS]));
    expect(counts(unlisted).every(each => each.endsWith('""'))).toBe(true);
    // A result without the Saved Views table is one whose views were not all listed: its counts are not known.
    const untabled = addViewFilterUses(model({ savedViewDetails: [detail("Open items")], savedViewFilters: [] }, [LINE_ITEMS]));
    expect(counts(untabled).every(each => each.endsWith('""'))).toBe(true);
    // Without Line Items, or its Module Name column, nothing is added.
    const bare = model({ savedViewFilters: [] }, [{ ...LINE_ITEMS, headers: ["", "Formula", "Module"] }]);
    expect(addViewFilterUses(bare)).toBe(bare);
  });
});
