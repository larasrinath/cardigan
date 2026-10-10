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

  it("names nothing for a column that names no rows, nor without the table its items would be rows of", () => {
    expect(named(MODULES, "Notes", 0, ["Price", "Units"])).toEqual([undefined, undefined]);
    expect(itemRows(MODULES, "Line Items", ["Price", "Units"], MODULES.rows[0], new Map([[MODULES.file, { table: MODULES, name: 0 }]]))).toEqual([undefined, undefined]);
    // An app's table is never read so, whatever its columns are called.
    const cards = table("Cards", ["Page", "Applies To"], [["Overview", "Products, Time"]]);
    expect(itemRows(cards, "Applies To", ["Products", "Time"], cards.rows[0], TABLES)).toEqual([undefined, undefined]);
  });
});
