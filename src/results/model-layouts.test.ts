import { describe, expect, it } from "vitest";
import { PAGE_FILTERS_HEADERS } from "../model-pages.js";
import type { AnalysisResult, ResultTable } from "../result-types.js";
import { columnsOf } from "./columns.js";
import { fileView } from "./result-view.js";
import { keepTable, takeTable } from "./view-keep.js";

/** When an action last started, as the page shows it (times.ts `splitTimes`), and how long it took. */
const run = ["Start Date (UTC)", "Start Time (UTC)", "Most recent duration (ms)"];
const dashboards = ["Used in Dashboards"];
const place = ["Page type", "App ID", "Page ID"];
const layouts: [string, string[], string[]][] = [
  ["Model Calendar", ["Setting", "Value"], ["Section", "Allowed values"]],
  ["Time Ranges", ["Name", "Start Period", "End Period"], []],
  ["Versions", ["Name", "Is Actual", "Switchover", "Edit From", "Edit To"], []],
  ["General Lists", ["Name", "Parent Hierarchy", "Top Level", "Item Count", "Numbered", "Production Data", "Properties", "Subsets", "Notes"],
    ["Display Name Property", "Referenced in Applies To", "Referenced as Format", "Referenced in Formula"]],
  ["Modules", ["Name", "Functional Area", "Applies To", "Time Scale", "Time Range", "Versions", "Cell Count", "Notes"], ["Line Items", "Referenced By"]],
  ["Line Items", ["Name", "Module Name", "Format", "Format type", "Formula", "Applies To", "Time Scale", "Versions", "Summary", "Referenced By", "Cell Count", "Calculation Effort", "Page Filters", "Saved View Filters", "Notes"],
    ["Applies To from", "Time Range", "Style", "Read Access Driver", "Write Access Driver", "Users List", "Parent", "Is Summary", "Formula Scope", "Code", "Use Switchover", "Breakback", "Brought-Forward", "Start of Section", "Data Tags", "Ratio Numerator", "Ratio Denominator", "Format List"]],
  ["Dynamic Cell Access", ["Driver Module", "Driver Line Item", "Access", "Controlled Module", "Controlled Line Item"], []],
  ["Processes", ["Name", "Actions", ...run, "Notes"], dashboards],
  ["Imports", ["Name", "Source Type", "Source Label", "Source Model", "Source Module", "Saved View", "Target Type", "Target Object", "Used in Processes", ...run, "Notes", "Production Data"], dashboards],
  ["Import Data Sources", ["Name", "Source Type", "Source Model", "Source Object Name", "Imports"], []],
  ["Exports", ["Name", "Action", "Used in Processes", ...run, "Notes"], dashboards],
  ["Other Actions", ["Name", "Action", "Action List", "Used in Processes", ...run, "Notes"], dashboards],
  ["Source Models", ["Name", "Mapped Workspace", "Mapped Model", "Sources", "Imports"], []],
  ["Module Usage", ["Module", "App", "Page"], place],
  ["Saved Views", ["Name", "Module", "Filters", "Filter Line Items", "Used on Pages", "Used by Imports", "Used by Exports"], ["Definition read"]],
  ["Page Filters", PAGE_FILTERS_HEADERS.filter(header => !["Card #", "Section #", ...place, "Card ID", "Line item ID"].includes(header)),
    ["Card #", "Section #", ...place, "Card ID", "Line item ID"]],
  // Custom View Filters' layout, with the saved view shown after the module it filters, and Filter state hidden last.
  ["Saved View Filters", [...PAGE_FILTERS_HEADERS.filter(header => !["Card #", "Section #", ...place, "Card ID", "Line item ID"].includes(header))
    .flatMap(header => (header === "Filtered module" ? [header, "Saved view"] : [header]))], ["Card #", "Section #", ...place, "Card ID", "Line item ID", "Filter state"]],
  ["Page Actions", ["Model action name", "Action type", "App", "Page", "Button label", "Runs automatically", "Cancel button"], ["Card #", "Name source", ...place, "Card ID", "Action ID"]],
];
const table = (label: string, headers: readonly string[], rows: string[][] = []): ResultTable => ({ file: `${label}.csv`, label, headers: [...headers], rows, guard: true });
const model = (tables: ResultTable[]): AnalysisResult => ({ kind: "model", name: "Invented plan", id: "invented-model", zipName: "unused.zip", summary: [], tables });

/** A column's name as the page shows it: Line Items' count of the page filters is shown as Custom View Filters, its header
 * still its key (columns.ts `SHOWN_COLUMNS`). */
const shownAs = (label: string) => (header: string): string => (label === "Line Items" && header === "Page Filters" ? "Custom View Filters" : header);

describe("A model's reading layouts", () => {
  it.each(layouts)("orders %s, retains every column and shows new columns", (label, shown, hidden) => {
    const headers = [...shown, ...hidden].reverse();
    const file = table(label, ["New column", ...headers], [["new", ...headers]]);
    const columns = columnsOf(file);
    expect(columns.filter(column => !column.hidden).map(column => column.label)).toEqual([...shown.map(shownAs(label)), "New column"]);
    expect(columns.filter(column => column.hidden).map(column => column.label)).toEqual(hidden);
    expect(columns.map(column => file.headers[column.index])).toEqual([...shown, ...hidden, "New column"]);
    expect(columns.map(column => file.rows[0][column.index])).toEqual([...shown, ...hidden, "new"]);
    // A model without one of these columns gets no invented column or empty space for it.
    const missing = columnsOf(table(label, headers.filter(header => header !== shown[0])));
    expect(missing.map(column => column.label)).toEqual([...shown.slice(1).map(shownAs(label)), ...hidden]);
    expect(file.headers).toEqual(["New column", ...headers]);
  });

  it("matches Anaplan's header variants without changing their names", () => {
    expect(columnsOf(table("General Lists", ["", "Numbered List", "Item Count", "Top Level Item", "Parent Hierarchy"])).map(column => column.label))
      .toEqual(["Name", "Parent Hierarchy", "Top Level Item", "Item Count", "Numbered List"]);
    expect(columnsOf(table("Modules", ["", "Notes", "Populated Cell Count", "Versions"])).map(column => column.label))
      .toEqual(["Name", "Versions", "Populated Cell Count", "Notes"]);
    expect(columnsOf(table("Import Data Sources", ["", "Used in Imports", "Source Object Name", "Type", "Source Model"])).map(column => column.label))
      .toEqual(["Name", "Type", "Source Model", "Source Object Name", "Used in Imports"]);
    expect(columnsOf(table("Imports", ["", "Notes", "Start Date and Time (Europe/London)", "Source Type"]), undefined, "Europe/London").map(column => column.label))
      .toEqual(["Name", "Source Type", "Start Date and Time (Europe/London)", "Notes"]);
    // Start Date and Start Time in the viewer's zone stand where they do in UTC; an action's start as one column, as the
    // file has it, and one whose header names no zone, stand in Start Date's place.
    expect(columnsOf(table("Imports", ["", "Notes", "Start Time (Europe/London)", "Start Date (Europe/London)", "Source Type"]), undefined, "Europe/London").map(column => column.label))
      .toEqual(["Name", "Source Type", "Start Date (Europe/London)", "Start Time (Europe/London)", "Notes"]);
    expect(["Start Date and Time (UTC)", "Start Date and Time"].map(start => columnsOf(table("Exports", ["", "Notes", "Most recent duration (ms)", start, "Action"]))
      .map(column => column.label))).toEqual([["Name", "Action", "Start Date and Time (UTC)", "Most recent duration (ms)", "Notes"], ["Name", "Action", "Start Date and Time", "Most recent duration (ms)", "Notes"]]);
  });

  it("offers a range of days on an action's Start Date, in either zone, and no filter on its Start Time", () => {
    const rows = [["Nightly", "", "2026-03-12", "23:19:56", "5"], ["Weekly", "", "2026-03-13", "06:00:00", "7"], ["Never", "", "", "", ""]];
    for (const [zone, end] of [["UTC", "UTC"], ["Europe/London", "Europe/London"]]) {
      const columns = columnsOf(table("Processes", ["", "Actions", `Start Date (${end})`, `Start Time (${end})`, "Most recent duration (ms)"], rows), undefined, zone);
      expect(columns.map(column => [column.label, column.filter, column.range, column.hidden])).toEqual([["Name", false, undefined, false], ["Actions", true, undefined, false],
        [`Start Date (${end})`, true, "date", false], [`Start Time (${end})`, false, undefined, false], ["Most recent duration (ms)", true, "number", false]]);
    }
  });

  it("takes kept columns, filters, ranges and sorts by name across reading orders and changed defaults", () => {
    const old = columnsOf(table("Line Items", ["", "Style", "Cell Count", "Module Name", "Notes"], [["Units", "Normal", "1", "Demand", ""], ["Price", "Normal", "20", "Sales", ""]]));
    const kept = keepTable({ columns: old, hidden: new Set([4]), filters: new Map([[3, new Set(["Demand"])]]),
      ranges: new Map([[2, { fromText: "1", toText: "10", from: 1, to: 10, blanks: false }]]), sort: { column: 3, dir: "desc" }, page: 0 }, () => ["Demand", "Sales"]);
    expect(kept?.shown).toEqual(["Style"]);
    const next = columnsOf(table("Line Items", ["", "Module Name", "Style", "Notes", "Cell Count", "New column"], [["Units", "Demand", "Normal", "", "1", "a"], ["Price", "Sales", "Normal", "", "20", "b"]]));
    const taken = takeTable(kept!, next, () => ["Demand", "Sales"]);
    expect([...taken.hidden]).toEqual([3]);
    expect([...taken.filters]).toEqual([[1, new Set(["Demand"])]]);
    expect(taken.ranges.get(4)).toMatchObject({ from: 1, to: 10 });
    expect(taken.sort).toEqual({ column: 1, dir: "desc" });
    expect(taken.hidden.has(5)).toBe(false);
    // Even a previously kept explicit choice whose old default differed wins over the new default.
    expect(takeTable({ shown: ["Style"] }, next, () => []).hidden.has(2)).toBe(false);
  });

  it("keeps what was chosen of Line Items' count of the page filters, shown now as Custom View Filters, under the header it was kept by", () => {
    // A view kept before the column was renamed: the count hidden and sorted on, by its header, which is still its key.
    const headers = ["", "Module Name", "Page Filters", "Saved View Filters", "Notes"];
    const rows = [["Units", "Demand", 2, 0, ""], ["Price", "Sales", 0, 1, ""]];
    const columns = columnsOf(table("Line Items", headers, rows));
    expect(columns.filter(column => column.key !== undefined).map(column => [column.label, column.key])).toEqual([["Custom View Filters", "Page Filters"]]);
    const taken = takeTable({ hidden: ["Page Filters"], sort: { column: "Page Filters", dir: "asc" } }, columns, () => []);
    expect([[...taken.hidden], taken.sort]).toEqual([[2], { column: 2, dir: "asc" }]);
    // And what is kept now is kept by the header too.
    expect(keepTable({ columns, hidden: new Set([2]), filters: new Map(), ranges: new Map(), sort: undefined, page: 0 }, () => [])?.hidden).toEqual(["Page Filters"]);
  });

  it("sorts page filters by condition, app, page and numeric card number only in the results view", () => {
    const file = table("Page Filters", ["Condition line item's module", "Condition line item", "App", "Page", "Card #", "Value"], [
      ["Zulu", "Allow", "A", "Board", "1", "z"], ["Alpha", "Show", "B", "Board", "1", "b"],
      ["Alpha", "Allow", "B", "Board", "1", "c"], ["Alpha", "Allow", "A", "Board", "10", "ten"],
      ["Alpha", "Allow", "A", "Board", "2", "two"], ["Alpha", "Allow", "A", "Board", "2", "tie"],
      ["Alpha", "Allow", "A", "Ahead", "20", "page"],
    ]);
    const original = structuredClone(file);
    expect(fileView(model([file]), file).table.rows.map(row => row.at(-1))).toEqual(["page", "two", "tie", "ten", "c", "b", "z"]);
    expect(file).toEqual(original);
    expect(fileView({ ...model([file]), kind: "app" }, file).table).toBe(file);
  });

  it("orders actions by model action, app and page, and usage by Modules then app and page", () => {
    const actions = table("Page Actions", ["Model action name", "App", "Page"], [["Sort", "A", "Home"], ["Load", "B", "Home"], ["Load", "A", "Totals"], ["Load", "A", "Home"]]);
    expect(fileView(model([actions]), actions).table.rows).toEqual([actions.rows[3], actions.rows[2], actions.rows[1], actions.rows[0]]);
    const modules = table("Modules", [""], [["Zulu"], ["--- Heading ---"], ["Alpha"]]);
    const usage = table("Module Usage", ["Module", "App", "Page"], [["Alpha", "A", "Home"], ["Zulu", "B", "Home"], ["Zulu", "A", "Totals"], ["Zulu", "A", "Home"], ["--- Heading ---", "-", "-"]]);
    expect(fileView(model([modules, usage]), usage).table.rows).toEqual([usage.rows[3], usage.rows[2], usage.rows[1], ["--- Heading ---", "", ""], usage.rows[0]]);
    expect(fileView(model([modules]), modules).table.rows).toEqual(modules.rows);
  });
});
