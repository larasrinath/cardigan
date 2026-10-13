import { describe, expect, it } from "vitest";
import type { Cell, ResultTable } from "../result-types.js";
import { itemRows, type NamedRows } from "./item-links.js";
import { cellText } from "./table-engine.js";

// Made-up names only. The tables are the page's own, as it shows them: Line Items with each line item's module after its
// name, and a module's own row naming itself there (line-items-view.ts).

const table = (label: string, headers: string[], rows: Cell[][]): ResultTable => ({ file: `${label}.csv`, label, headers, rows, guard: false });

const MODULES = table("Modules", ["", "Applies To", "Referenced By", "Line Items"], [
  ["SYS100 Time", "Time", "'PRM000 - Global', REV01 Revenue, 'REV01 Revenue'.Price, Gone module, Twice", "Price, Units, Twice"],
  ["REV01 Revenue", "Products, Time", "", "Price, Units"],
  ["PRM000 - Global", "", "", ""],
  ["Twice", "", "", ""],
  ["Twice", "", "", ""]]);
const LINE_ITEMS = table("Line Items", ["", "Module Name", "Referenced By"], [
  ["SYS100 Time", "SYS100 Time", ""], ["Price", "SYS100 Time", ""], ["Units", "SYS100 Time", "Price, 'REV01 Revenue'.Units, REV01 Revenue"], ["Twice", "SYS100 Time", ""],
  ["REV01 Revenue", "REV01 Revenue", ""], ["Price", "REV01 Revenue", ""], ["Units", "REV01 Revenue", ""]]);
const LISTS = table("General Lists", ["", "Referenced in Applies To"], [["Products", "REV01 Revenue, 'REV01 Revenue'.Units"], ["Time", ""]]);
const PROCESSES = table("Processes", ["", "Used in Processes"], [["Nightly load", ""], ["Weekly", ""]]);
const IMPORTS = table("Imports", ["", "Used in Processes"], [["Load prices", "Nightly load, Weekly, Monthly"]]);
const SOURCES = table("Import Data Sources", ["", "Imports"], [["prices.csv", "Load prices, Gone import"]]);
const EXPORTS = table("Exports", ["", "Used in Processes"], [["Send plan", "Weekly"], ["Twin", ""]]);
const OTHERS = table("Other Actions", ["", "Used in Processes"], [["Delete old items", "Nightly load"]]);
/** The Processes table as the page shows it, with the actions each process runs after its name (result-view.ts). */
const PROCESS_VIEW = table("Processes", ["", "Actions"], [["Nightly load", "Load prices, Send plan, Delete old items, Twin, Gone action"]]);
const TWIN_IMPORTS = table("Imports", ["", "Used in Processes"], [["Load prices", ""], ["Twin", ""]]);

const TABLES = new Map<string, NamedRows>([
  [MODULES.file, { table: MODULES, name: 0 }],
  [LINE_ITEMS.file, { table: LINE_ITEMS, name: 0, module: 1 }],
  [LISTS.file, { table: LISTS, name: 0 }],
  [PROCESSES.file, { table: PROCESSES, name: 0 }],
  [IMPORTS.file, { table: IMPORTS, name: 0 }],
  [SOURCES.file, { table: SOURCES, name: 0 }]]);

/** Each item's row, by the name of that row and its module where it has one, or nothing. */
function named(of: ResultTable, header: string, row: number, items: string[]): (string | undefined)[] {
  return itemRows(of, header, items, of.rows[row], TABLES).map(found => (found ? `${found.file}: ${found.row.slice(0, found.file === LINE_ITEMS.file ? 2 : 1).map(cell => cellText(cell)).join(" / ")}` : undefined));
}

describe("Which row of the result an item of a row's details names", () => {
  it("resolves the additional single names by their table and owning module", () => {
    const sourceModels = table("Source Models", [""], [["Seed model"]]);
    const tables = new Map([...TABLES, [sourceModels.file, { table: sourceModels, name: 0 }]]);
    const cases: [string, string[], Cell[], string, string, string][] = [
      ["Line Items", ["Name", "Module Name"], ["Price", "REV01 Revenue"], "Module Name", "REV01 Revenue", "Modules.csv"],
      ["Imports", ["Target Object", "Target Type"], ["REV01 Revenue", "MODULE"], "Target Object", "REV01 Revenue", "Modules.csv"],
      ["Imports", ["Target Object", "Target Type"], ["Products", "LIST"], "Target Object", "Products", "General Lists.csv"],
      ["Dynamic Cell Access", ["Driver Module", "Driver Line Item", "Controlled Module", "Controlled Line Item"],
        ["SYS100 Time", "Price", "REV01 Revenue", "Units"], "Driver Line Item", "Price", "Line Items.csv"],
      ["Dynamic Cell Access", ["Driver Module", "Driver Line Item", "Controlled Module", "Controlled Line Item"],
        ["SYS100 Time", "Price", "REV01 Revenue", "Units"], "Controlled Line Item", "Units", "Line Items.csv"],
      ["Page Filters", ["Condition line item's module", "Condition line item", "Filtered module"],
        ["SYS100 Time", "Price", "REV01 Revenue"], "Condition line item", "Price", "Line Items.csv"],
      ["Page Filters", ["Filtered module"], ["REV01 Revenue"], "Filtered module", "REV01 Revenue", "Modules.csv"],
      ["Page Actions", ["Model action name", "Action type"], ["Nightly load", "Process"], "Model action name", "Nightly load", "Processes.csv"],
      ["Import Data Sources", ["Source Model"], ["Seed model"], "Source Model", "Seed model", "Source Models.csv"],
    ];
    for (const [label, headers, row, header, name, file] of cases) {
      const of = table(label, headers, [row]);
      const found = itemRows(of, header, [name], row, tables)[0];
      expect(found?.file, `${label}: ${header}`).toBe(file);
      if (file === "Line Items.csv") expect(found?.row[1]).toBe(header === "Controlled Line Item" ? "REV01 Revenue" : "SYS100 Time");
    }
  });

  it("leaves absent, ambiguous, and Missing names plain, including a line item in the wrong module", () => {
    const of = table("Page Filters", ["Condition line item's module", "Condition line item"], [["Gone", "Price"]]);
    expect(itemRows(of, "Condition line item", ["Price"], of.rows[0], TABLES)).toEqual([undefined]);
    const imports = table("Imports", ["Target Object"], [["Twice"]]);
    expect(itemRows(imports, "Target Object", ["Twice", "Gone", "Missing module (ID 102000000999)"], imports.rows[0], TABLES))
      .toEqual([undefined, undefined, undefined]);
    const sameName = table("Modules", ["Name"], [["Missing module (ID 102000000999)"]]);
    expect(itemRows(of, "Filtered module", ["Missing module (ID 102000000999)"], of.rows[0], new Map([[sameName.file, { table: sameName, name: 0 }]])))
      .toEqual([undefined]);
  });

  it("finds what refers to a module: a module by its name out of its quotes, a line item behind its module's name, and nothing that no row or several have", () => {
    expect(named(MODULES, "Referenced By", 0, ["'PRM000 - Global'", "REV01 Revenue", "'REV01 Revenue'.Price", "Gone module", "Twice"]))
      .toEqual(["Modules.csv: PRM000 - Global", "Modules.csv: REV01 Revenue", "Line Items.csv: Price / REV01 Revenue", undefined, undefined]);
  });

  it("finds a module's own line items by their names alone, in that module and no other", () => {
    expect(named(MODULES, "Line Items", 0, ["Price", "Units", "Twice"])).toEqual(["Line Items.csv: Price / SYS100 Time", "Line Items.csv: Units / SYS100 Time", "Line Items.csv: Twice / SYS100 Time"]);
    expect(named(MODULES, "Line Items", 1, ["Price", "Units"])).toEqual(["Line Items.csv: Price / REV01 Revenue", "Line Items.csv: Units / REV01 Revenue"]);
  });

  it("finds what refers to a line item: a line item of its own module by its name alone, unless a module has that name too", () => {
    // "Price" is a line item of Units' own module; "REV01 Revenue" is a module, and the module's own row in Line Items is
    // not a line item of SYS100 Time.
    expect(named(LINE_ITEMS, "Referenced By", 2, ["Price", "'REV01 Revenue'.Units", "REV01 Revenue"]))
      .toEqual(["Line Items.csv: Price / SYS100 Time", "Line Items.csv: Units / REV01 Revenue", "Modules.csv: REV01 Revenue"]);
  });

  it("finds a dimension among the lists, a process among the processes and an import among the imports", () => {
    expect(named(MODULES, "Applies To", 1, ["Products", "Time"])).toEqual(["General Lists.csv: Products", "General Lists.csv: Time"]);
    expect(named(LISTS, "Referenced in Applies To", 0, ["REV01 Revenue", "'REV01 Revenue'.Units"])).toEqual(["Modules.csv: REV01 Revenue", "Line Items.csv: Units / REV01 Revenue"]);
    expect(named(IMPORTS, "Used in Processes", 0, ["Nightly load", "Weekly", "Monthly"])).toEqual(["Processes.csv: Nightly load", "Processes.csv: Weekly", undefined]);
    expect(named(SOURCES, "Imports", 0, ["Load prices", "Gone import"])).toEqual(["Imports.csv: Load prices", undefined]);
  });

  it("finds an action a process runs among the imports, the exports and the other actions together", () => {
    const tables = new Map([...TABLES, [TWIN_IMPORTS.file, { table: TWIN_IMPORTS, name: 0 }], [EXPORTS.file, { table: EXPORTS, name: 0 }], [OTHERS.file, { table: OTHERS, name: 0 }]]);
    const found = itemRows(PROCESS_VIEW, "Actions", ["Load prices", "Send plan", "Delete old items", "Twin", "Gone action"], PROCESS_VIEW.rows[0], tables)
      .map(row => (row ? `${row.file}: ${cellText(row.row[0])}` : undefined));
    // An import and an export of one name name neither, and a name no action has names nothing.
    expect(found).toEqual(["Imports.csv: Load prices", "Exports.csv: Send plan", "Other Actions.csv: Delete old items", undefined, undefined]);
    // A process's own Used in Processes, which the page's table does not have, names no row.
    expect(named(PROCESSES, "Used in Processes", 0, ["Nightly load"])).toEqual([undefined]);
  });

  it("finds from Saved View Filters the condition's line item and its module, the filtered module, and the saved view among Saved Views by its name and module", () => {
    const views = table("Saved Views", ["Name", "Module", "Filters"], [["Open items", "REV01 Revenue", "Rows: Price > 0"], ["Open items", "SYS100 Time", ""], ["Twice", "REV01 Revenue", ""],
      ["Twice", "REV01 Revenue", ""]]);
    const tables = new Map([...TABLES, [views.file, { table: views, name: 0 }]]);
    const filters = table("Saved View Filters", ["Condition line item's module", "Condition line item", "Filtered module", "Saved view", "Filtered dimension"],
      [["SYS100 Time", "Price", "REV01 Revenue", "Open items", "Products"], ["SYS100 Time", "Price", "REV01 Revenue", "Twice", "Rows"], ["SYS100 Time", "Price", "Gone", "Open items", "Rows"]]);
    const found = (row: number, header: string) => itemRows(filters, header, [cellText(filters.rows[row][filters.headers.indexOf(header)])], filters.rows[row], tables)
      .map(each => (each ? `${each.file}: ${each.row.slice(0, 2).map(cell => cellText(cell)).join(" / ")}` : undefined))[0];
    expect(["Condition line item's module", "Condition line item", "Filtered module", "Saved view", "Filtered dimension"].map(header => found(0, header))).toEqual([
      "Modules.csv: SYS100 Time / Time", "Line Items.csv: Price / SYS100 Time", "Modules.csv: REV01 Revenue / Products, Time", "Saved Views.csv: Open items / REV01 Revenue",
      "General Lists.csv: Products / REV01 Revenue, 'REV01 Revenue'.Units"]);
    // A view of one name in another module is another view; one of a name two rows of one module have, or of a module the
    // row does not name a view of, is none. An axis is no list.
    expect([found(1, "Saved view"), found(2, "Saved view"), found(1, "Filtered dimension")]).toEqual([undefined, undefined, undefined]);
    // Without Saved Views, the view is plain.
    expect(itemRows(filters, "Saved view", ["Open items"], filters.rows[0], TABLES)).toEqual([undefined]);
  });

  it("names nothing for a column that names no rows, nor without the table its items would be rows of", () => {
    expect(named(MODULES, "Notes", 0, ["Price", "Units"])).toEqual([undefined, undefined]);
    expect(itemRows(MODULES, "Line Items", ["Price", "Units"], MODULES.rows[0], new Map([[MODULES.file, { table: MODULES, name: 0 }]]))).toEqual([undefined, undefined]);
    // An app's table is never read so, whatever its columns are called.
    const cards = table("Cards", ["Page", "Applies To"], [["Overview", "Products, Time"]]);
    expect(itemRows(cards, "Applies To", ["Products", "Time"], cards.rows[0], TABLES)).toEqual([undefined, undefined]);
  });
});
