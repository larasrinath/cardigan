import { describe, expect, it } from "vitest";
import { buildModelGraph } from "../map/build-graph.js";
import type { Cell, ResultTable } from "../result-types.js";
import { ACCESS_HEADERS, ACCESS_LABEL, accessTable, type AccessTable } from "./access.js";
import { againstMap } from "./access.test-support.js";

// Made-up names only: nothing here comes from a real model. The tables are written by hand in the shape of the export's
// files (export.ts): the unnamed first column with each row's name, then the grid's columns under Anaplan's own headers.
// Line Items has the headers a real model's file has, in its order (results/line-items-view.test.ts).
const LINE_HEADERS = ["", "Format", "Formula", "Summary", "Applies To", "Time Scale", "Time Range", "Versions", "Style", "Cell Count", "Calculation Effort", "Notes",
  "Read Access Driver", "Write Access Driver", "Users List", "Parent", "Is Summary", "Formula Scope", "Code", "Use Switchover", "Breakback", "Brought-Forward", "Start of Section",
  "Data Tags", "Referenced By", "Module Name", "Ratio Numerator", "Ratio Denominator", "Format List"];
const [READ, WRITE] = ["Read Access Driver", "Write Access Driver"];

/** A row's cells by their headers ("" is the row's name): every other cell is empty. */
type Cells = Record<string, Cell>;
const file = (label: string, headers: readonly string[], rows: Cell[][]): ResultTable => ({ file: `${label}.csv`, label, headers: [...headers], rows, guard: false });
const lineItems = (...rows: Cells[]): ResultTable => file("Line Items", LINE_HEADERS, rows.map(cells => LINE_HEADERS.map(header => (Object.hasOwn(cells, header) ? cells[header] : ""))));
const modulesFile = (...names: string[]): ResultTable => file("Modules", ["", "Applies To", "Cell Count"], names.map(name => [name, "", ""]));
/** A table without some of its columns. */
const without = (table: ResultTable, ...headers: string[]): ResultTable => {
  const kept = table.headers.map((header, index) => (headers.includes(header) ? -1 : index)).filter(index => index >= 0);
  return { ...table, headers: kept.map(index => table.headers[index]), rows: table.rows.map(row => kept.map(index => row[index])) };
};

const NUMBER = '{"minimumSignificantDigits":4,"decimalPlaces":-1,"dataType":"NUMBER"}';
const BOOLEAN = '{"dataType":"BOOLEAN"}';
const SUM = '{"summaryMethod":"SUM","timeSummaryMethod":"SUM"}';
/** A heading among the modules, and a module's own row: a name, and no format, formula or summary. */
const heading = (name: string): Cells => ({ "": name });
const moduleRow = (name: string, cells: Cells = {}): Cells => ({ "": name, ...cells });
/** A line item's row: a number that is summed, with no access driver, unless the cells say otherwise. */
const item = (inModule: string, name: string, cells: Cells = {}): Cells => ({ "": name, "Module Name": inModule, Format: NUMBER, Summary: SUM, "Applies To": "-", ...cells });
/** A line item that can drive access: a tick box. */
const flag = (inModule: string, name: string, cells: Cells = {}): Cells => item(inModule, name, { Format: BOOLEAN, ...cells });

const HEADERS = ["Driver Module", "Driver Line Item", "Access", "Controlled Module", "Controlled Line Item"];

/** The table of these tables, where there is what it is made from: a test that expects a table fails without one. */
function made(...tables: ResultTable[]): AccessTable {
  const table = accessTable(tables);
  if ("missing" in table) throw new Error(`No table was made: ${table.missing}`);
  return table;
}
/** What is missing where the table cannot be made, or that it was made. */
function missing(...tables: ResultTable[]): string {
  const table = accessTable(tables);
  return "missing" in table ? table.missing : "made";
}

/** The table of a made-up model's tables: its rows. Every model a test uses goes through here, where the table is held
 * against the model map of the same tables (access.test-support.ts). For every row of Line Items that the map places,
 * the table's rows are the map's access links, each once, and the driver cells the map could not match, each once.
 * Beyond those it has one row for each driver cell in a row the map leaves out, and nothing else: no cell has vanished,
 * and no row is there without its cell. It counts its rows without a Driver Module. */
function access(...tables: ResultTable[]): string[][] {
  const { table, unmatched } = made(...tables);
  const held = againstMap(table.rows, tables);
  expect(table.headers).toEqual(HEADERS);
  expect(held.placed, "the rows of Line Items that the map places: the table against the map").toEqual(held.map);
  expect([held.unexplained, held.vanished], "the rows that the map leaves out").toEqual([[], []]);
  expect(unmatched, "the rows without a Driver Module").toBe(table.rows.filter(row => row[0] === "").length);
  return table.rows;
}

describe("Dynamic Cell Access: the access drivers of a model export, each with what it controls", () => {
  it("is named and laid out as the owner asked: one row for each use of a driver, in five columns", () => {
    expect([ACCESS_LABEL, ACCESS_HEADERS]).toEqual(["Dynamic Cell Access", ["Driver Module", "Driver Line Item", "Access", "Controlled Module", "Controlled Line Item"]]);
  });

  it("lists each use of a driver from the driver's side, whether the driver is in the same module or in another", () => {
    const rows = access(lineItems(
      moduleRow("ACC01 Access"),
      flag("ACC01 Access", "Can read"),
      flag("ACC01 Access", "Can write"),
      moduleRow("REV01 Revenue"),
      // A driver in another module is named behind its module and a dot, in quotes or not. Units has one for reading
      // and one for writing: two rows.
      item("REV01 Revenue", "Units", { [READ]: "ACC01 Access.Can read", [WRITE]: "'ACC01 Access'.Can write" }),
      // A driver in the line item's own module is named alone, or behind the module all the same.
      item("REV01 Revenue", "Price", { [WRITE]: "Open" }),
      flag("REV01 Revenue", "Open"),
      item("REV01 Revenue", "Revenue", { [WRITE]: "'REV01 Revenue'.'Open'" }),
      // A line item nothing drives has two empty cells, and is in no row as what is controlled.
      item("REV01 Revenue", "Margin")));
    // Line Items names a driver on the row it controls. Here each use is a row with the driver first, by its module and
    // its name: Units is controlled for reading and for writing, and has a row for each.
    expect(rows).toEqual([
      ["ACC01 Access", "Can read", "Read", "REV01 Revenue", "Units"],
      ["ACC01 Access", "Can write", "Write", "REV01 Revenue", "Units"],
      ["REV01 Revenue", "Open", "Write", "REV01 Revenue", "Price"],
      ["REV01 Revenue", "Open", "Write", "REV01 Revenue", "Revenue"]]);
  });

  it("orders the rows by the driver's place in Line Items, then Read before Write, then by the place of what is controlled", () => {
    const rows = access(lineItems(
      moduleRow("SALES"),
      item("SALES", "First", { [READ]: "FLAGS.Late", [WRITE]: "FLAGS.Early" }),
      moduleRow("FLAGS"),
      flag("FLAGS", "Early"),
      flag("FLAGS", "Late"),
      // One line item with the same driver for reading and for writing.
      item("FLAGS", "Own", { [READ]: "Late", [WRITE]: "Late" }),
      moduleRow("COSTS"),
      item("COSTS", "Last", { [WRITE]: "FLAGS.Early", [READ]: "FLAGS.Early" }),
      item("COSTS", "More", { [READ]: "FLAGS.Early" })));
    // Early stands above Late in Line Items, though the first line item of the file names Late first. One driver controls
    // many: Early has four rows, its Read rows before its Write rows, each in the order of the file.
    expect(rows).toEqual([
      ["FLAGS", "Early", "Read", "COSTS", "Last"],
      ["FLAGS", "Early", "Read", "COSTS", "More"],
      ["FLAGS", "Early", "Write", "SALES", "First"],
      ["FLAGS", "Early", "Write", "COSTS", "Last"],
      ["FLAGS", "Late", "Read", "SALES", "First"],
      ["FLAGS", "Late", "Read", "FLAGS", "Own"],
      ["FLAGS", "Late", "Write", "FLAGS", "Own"]]);
  });

  it("matches names written in quotes, with commas, dots and apostrophes inside, and writes each name as Line Items has it", () => {
    const PLAN = "It's a 'plan', v1.2";
    const quotedPlan = "'It''s a ''plan'', v1.2'";
    const rows = access(lineItems(
      moduleRow(PLAN),
      flag(PLAN, "Rate, net (50%)"),
      flag(PLAN, "Margin.net"),
      flag(PLAN, "=Open?"),
      // In its own module a name that needs quotes is in quotes too.
      item(PLAN, "-Adjustment", { [READ]: "'Rate, net (50%)'", [WRITE]: "'=Open?'" }),
      moduleRow("REP01 Report"),
      item("REP01 Report", "Total", { [READ]: `${quotedPlan}.'Rate, net (50%)'`, [WRITE]: `${quotedPlan}.'Margin.net'` }),
      // Without its quotes, a name with a dot in it reads as a module, a line item and one part too many: no line item.
      item("REP01 Report", "Detail", { [READ]: `${quotedPlan}.Margin.net` })));
    // The names are the first column of Line Items, as it is: out of the quotes a driver cell puts them in, and with
    // nothing put before a name that starts with a sign.
    expect(rows).toEqual([
      [PLAN, "Rate, net (50%)", "Read", PLAN, "-Adjustment"],
      [PLAN, "Rate, net (50%)", "Read", "REP01 Report", "Total"],
      [PLAN, "Margin.net", "Write", "REP01 Report", "Total"],
      [PLAN, "=Open?", "Write", PLAN, "-Adjustment"],
      ["", `${quotedPlan}.Margin.net`, "Read", "REP01 Report", "Detail"]]);
  });

  it("gives a table without rows for a model that drives no access", () => {
    const none = [moduleRow("REV01 Revenue"), item("REV01 Revenue", "Units"), item("REV01 Revenue", "Price")];
    expect(accessTable([lineItems(...none)])).toEqual({ table: { headers: HEADERS, rows: [] }, unmatched: 0 });
    expect(access(lineItems(...none))).toEqual([]);
    // A dash is no driver, on a line item's row or on a module's own, and neither is a Line Items file without rows.
    expect(access(lineItems(moduleRow("REV01 Revenue", { [READ]: "-", [WRITE]: "-" }), item("REV01 Revenue", "Units", { [READ]: "-", [WRITE]: "-" })))).toEqual([]);
    expect(access(lineItems())).toEqual([]);
    // The headers are the table's own: a caller that changes them changes no other table's, nor the list they come from.
    made(lineItems(...none)).table.headers.push("More");
    expect([made(lineItems(...none)).table.headers, ACCESS_HEADERS]).toEqual([HEADERS, HEADERS]);
  });

  it("keeps a driver that cannot be matched: its row comes last, with the cell as it is written and no Driver Module", () => {
    const tables = [
      lineItems(
        moduleRow("ACC01 Access"),
        flag("ACC01 Access", "Can read"),
        moduleRow("REV01 Revenue"),
        // A module and a line item the export does not hold; a name alone that is no line item of the row's own module,
        // though another module has one of that name; and a module's name, which is no line item.
        item("REV01 Revenue", "Units", { [READ]: "Gone.Flag", [WRITE]: "'Old access'.'Can write'" }),
        item("REV01 Revenue", "Price", { [READ]: "Can read", [WRITE]: "ACC01 Access" }),
        // A driver is a line item: a list, a list's property and three names in a row are none.
        item("REV01 Revenue", "Revenue", { [READ]: "Open periods", [WRITE]: "Seasons.Code" }),
        item("REV01 Revenue", "Margin", { [WRITE]: "ACC01 Access.Can read.more" }),
        // A cell is kept to the character: the spaces around it and inside it are its own. The map reads a name without
        // the spaces around it, so the same driver in spaces is matched, and its row has the name as Line Items has it.
        item("REV01 Revenue", "Stock", { [READ]: "  Gone .  Flag ", [WRITE]: " ACC01 Access . Can read " }),
        // One that is matched, below them all.
        item("REV01 Revenue", "Cost", { [READ]: "ACC01 Access.Can read" })),
      file("General Lists", ["", "Properties"], [["Open periods", ""], ["Seasons", "Code: TEXT"]]),
    ];
    const rows = access(...tables);
    // The matched rows first, then the others in the order of their cells in Line Items: row by row, Read before Write.
    expect(rows).toEqual([
      ["ACC01 Access", "Can read", "Read", "REV01 Revenue", "Cost"],
      ["ACC01 Access", "Can read", "Write", "REV01 Revenue", "Stock"],
      ["", "Gone.Flag", "Read", "REV01 Revenue", "Units"],
      ["", "'Old access'.'Can write'", "Write", "REV01 Revenue", "Units"],
      ["", "Can read", "Read", "REV01 Revenue", "Price"],
      ["", "ACC01 Access", "Write", "REV01 Revenue", "Price"],
      ["", "Open periods", "Read", "REV01 Revenue", "Revenue"],
      ["", "Seasons.Code", "Write", "REV01 Revenue", "Revenue"],
      ["", "ACC01 Access.Can read.more", "Write", "REV01 Revenue", "Margin"],
      ["", "  Gone .  Flag ", "Read", "REV01 Revenue", "Stock"]]);
    expect(made(...tables).unmatched).toBe(8);
    // A row has no Driver Module only when its driver was not matched: a module is never without a name.
    expect(rows.map(row => row[0] === "")).toEqual([false, false, true, true, true, true, true, true, true, true]);
    // Every driver cell of the file is in the table, matched or not: none has vanished.
    const cells = tables[0].rows.flatMap(row => [READ, WRITE].map(column => row[LINE_HEADERS.indexOf(column)])).filter(cell => cell !== "");
    expect(rows).toHaveLength(cells.length);
  });

  it("takes a module's own row that names a driver as the map does: the module's row has no Controlled Line Item, and a line item with a dash has the module's driver", () => {
    const rows = access(lineItems(
      moduleRow("ACC01 Access"),
      flag("ACC01 Access", "Can read"),
      flag("ACC01 Access", "Can write"),
      moduleRow("REV01 Revenue", { [READ]: "'ACC01 Access'.Can read", [WRITE]: "-" }),
      // A dash takes the module's driver. The module has no write driver to give.
      item("REV01 Revenue", "Units", { [READ]: "-", [WRITE]: "-" }),
      // A driver of its own, and an empty cell, which is no dash: nothing is taken from the module.
      item("REV01 Revenue", "Price", { [READ]: "ACC01 Access.Can write" }),
      item("REV01 Revenue", "Revenue"),
      // A driver that names nothing on a module's own row is that row's, once: not each line item's that has a dash.
      moduleRow("COST01 Costs", { [WRITE]: "Gone.Flag" }),
      item("COST01 Costs", "Rent", { [WRITE]: "-" }),
      item("COST01 Costs", "Rates", { [WRITE]: "-" })));
    expect(rows).toEqual([
      ["ACC01 Access", "Can read", "Read", "REV01 Revenue", ""],
      ["ACC01 Access", "Can read", "Read", "REV01 Revenue", "Units"],
      ["ACC01 Access", "Can write", "Read", "REV01 Revenue", "Price"],
      ["", "Gone.Flag", "Write", "COST01 Costs", ""]]);
  });

  it("lists a driver cell of a row that the map leaves out all the same: the row as Line Items writes it, and the driver as the map reads the cell", () => {
    // A module whose name reads as a heading, with line items: the map takes its row for a heading, and has no line item
    // of it. Two cells of such a line item name a driver, and a line item the map places names one of them as its driver.
    const underHeading = [lineItems(
      moduleRow("Flags"),
      flag("Flags", "Open"),
      heading("-- Archive 2025"),
      flag("-- Archive 2025", "Locked"),
      item("-- Archive 2025", "Old units", { [READ]: "Flags.Open", [WRITE]: "Locked" }),
      moduleRow("Sales"),
      item("Sales", "Units", { [READ]: "'-- Archive 2025'.Locked", [WRITE]: "Flags.Open" })),
    modulesFile("Flags", "-- Archive 2025", "Sales")];
    // Old units is listed by its Module Name and its name. Its read driver is a line item the map holds, and is matched
    // as in any row. Its write driver, a name alone, is a line item of its own module, of which the map holds none: the
    // cell is among the unmatched, as the cell of Units that names the same line item is. The rows the map does not
    // place stand among the others by their place in the file: the unmatched cell of Old units before that of Units.
    expect(access(...underHeading)).toEqual([
      ["Flags", "Open", "Read", "-- Archive 2025", "Old units"],
      ["Flags", "Open", "Write", "Sales", "Units"],
      ["", "Locked", "Write", "-- Archive 2025", "Old units"],
      ["", "'-- Archive 2025'.Locked", "Read", "Sales", "Units"]]);
    expect(made(...underHeading).unmatched).toBe(2);
    // The map has one of the four for a link and one for a name it could not match, and says what it left out.
    const held = againstMap(made(...underHeading).table.rows, underHeading);
    expect([held.map, held.beyond]).toEqual([[['["Flags","Open","Write","Sales","Units"]'], ['["","\'-- Archive 2025\'.Locked","Read","Sales","Units"]']],
      [["Flags", "Open", "Read", "-- Archive 2025", "Old units"], ["", "Locked", "Write", "-- Archive 2025", "Old units"]]]);
    expect(buildModelGraph(underHeading).limitations.filter(line => /^\d/.test(line)))
      .toEqual(["2 line items name a heading row as their module and are left out: a heading is no module on the map."]);

    // A module named with dots alone is a heading to the map too. The model's one driver is used under it.
    expect(access(lineItems(moduleRow("Flags"), flag("Flags", "Open"), heading("..."), item("...", "Units", { [READ]: "Flags.Open" })), modulesFile("Flags", "...")))
      .toEqual([["Flags", "Open", "Read", "...", "Units"]]);

    // A line item whose Module Name cell is empty, and three that name no row above them, one of them a module's name
    // with a space after it. Each is listed with its Module Name cell as it is written. A name alone is read in the module
    // the row names, which has no line item on the map.
    const noModule = [lineItems(
      moduleRow("Flags"),
      flag("Flags", "Open"),
      moduleRow("Sales"),
      item("", "Units", { [READ]: "Flags.Open" }),
      item("Sales ", "Price", { [WRITE]: "Flags.Open" }),
      item("Old sales", "Cost", { [READ]: "Open", [WRITE]: "'Flags'.Open" }),
      // A cell in spaces is read as in any row: matched without the spaces around a name, and otherwise kept to the character.
      item("Old sales", "Rent", { [READ]: "  Gone .  Flag ", [WRITE]: " Flags . Open " }))];
    expect(access(...noModule)).toEqual([
      ["Flags", "Open", "Read", "", "Units"],
      ["Flags", "Open", "Write", "Sales ", "Price"],
      ["Flags", "Open", "Write", "Old sales", "Cost"],
      ["Flags", "Open", "Write", "Old sales", "Rent"],
      ["", "Open", "Read", "Old sales", "Cost"],
      ["", "  Gone .  Flag ", "Read", "Old sales", "Rent"]]);
    expect(made(...noModule).unmatched).toBe(2);
  });

  it("lists a second line item or module of a name and a heading's own row too, each as what it is, in its place among the rows", () => {
    const tables = [lineItems(
      moduleRow("Flags"),
      flag("Flags", "Open"),
      // A second line item of a name in its module: the map keeps the first. The second's cell names the first.
      flag("Flags", "Open", { [READ]: "Open" }),
      moduleRow("Sales"),
      item("Sales", "Units", { [READ]: "Flags.Open" }),
      // A module's second row: a module's own row, which names no module and is no line item's. It is listed as one,
      // without a Controlled Line Item, and its cell is read in that module, as the cell of the module's first row is.
      moduleRow("Sales", { [WRITE]: "Units" }),
      item("Sales", "Price", { [WRITE]: "Flags.Open" }),
      // A heading among the modules is a module's own row as well.
      { "": "-- Notes --", [READ]: "Flags.Open", [WRITE]: "Open" }),
    ];
    // Open drives the reading of three rows, of which the map places the middle one: they stand in the file's order.
    expect(access(...tables)).toEqual([
      ["Flags", "Open", "Read", "Flags", "Open"],
      ["Flags", "Open", "Read", "Sales", "Units"],
      ["Flags", "Open", "Read", "-- Notes --", ""],
      ["Flags", "Open", "Write", "Sales", "Price"],
      ["Sales", "Units", "Write", "Sales", ""],
      ["", "Open", "Write", "-- Notes --", ""]]);
    expect(buildModelGraph(tables).limitations.filter(line => /^\d/.test(line))).toEqual([
      "1 row of Line Items repeats the name of a module above it and is left out.",
      "1 line item has the name of a line item above it in the same module and is left out."]);
  });

  it("gives a line item that the map leaves out its module's driver for a dash, as the map gives it to the line items it places", () => {
    // A module's own row names a driver, and so does a heading's: Flags.Open for reading, and for writing a line item
    // that is none. Each has line items that show a dash in both columns: the map places the first Units of Sales, and
    // leaves out the second of the name and the one under the heading.
    const rows = access(lineItems(
      moduleRow("Flags"),
      flag("Flags", "Open"),
      flag("Flags", "Shut"),
      moduleRow("Sales", { [READ]: "Flags.Open", [WRITE]: "Gone.Flag" }),
      item("Sales", "Units", { [READ]: "-", [WRITE]: "-" }),
      item("Sales", "Units", { [READ]: "-", [WRITE]: "-" }),
      { "": "-- Archive --", [READ]: "Flags.Open", [WRITE]: "Gone.Flag" },
      item("-- Archive --", "Old units", { [READ]: "-", [WRITE]: "-" }),
      // A dash takes nothing where the module has no row above the line item, and nothing from a row that is no module's
      // own: a line item named as the module is, whose own module the file does not say.
      item("Later", "Early", { [READ]: "-" }),
      moduleRow("Later", { [READ]: "Flags.Open" }),
      item("", "Lost", { [READ]: "Flags.Open" }),
      item("Lost", "Found", { [READ]: "-" }),
      // Nor does a line item of no module take the driver of the module it is named as.
      item("", "Sales", { [READ]: "-", [WRITE]: "-" }),
      // A module with two rows of its own, which name two drivers. The module is the first of them, to the map and here:
      // a second line item of a name has the driver the first has, not that of the row nearest above it.
      moduleRow("Costs", { [READ]: "Flags.Open" }),
      item("Costs", "Rent", { [READ]: "-" }),
      moduleRow("Costs", { [READ]: "Flags.Shut" }),
      item("Costs", "Rent", { [READ]: "-" })));
    // Every line item with a dash has the row its module's own row has, whether the map places it or not. A module's
    // cell that could not be matched is one row, the module's own: no line item says it again.
    expect(rows).toEqual([
      ["Flags", "Open", "Read", "Sales", ""],
      ["Flags", "Open", "Read", "Sales", "Units"],
      ["Flags", "Open", "Read", "Sales", "Units"],
      ["Flags", "Open", "Read", "-- Archive --", ""],
      ["Flags", "Open", "Read", "-- Archive --", "Old units"],
      ["Flags", "Open", "Read", "Later", ""],
      ["Flags", "Open", "Read", "", "Lost"],
      ["Flags", "Open", "Read", "Costs", ""],
      ["Flags", "Open", "Read", "Costs", "Rent"],
      ["Flags", "Open", "Read", "Costs", "Rent"],
      ["Flags", "Shut", "Read", "Costs", ""],
      ["", "Gone.Flag", "Write", "Sales", ""],
      ["", "Gone.Flag", "Write", "-- Archive --", ""]]);
  });

  it("is made from every table the map is made from: the Modules table tells a module's own row from a line item's that names no module", () => {
    // A row that names no module and has no format, formula or summary, but a driver. Without the Modules table every
    // such row is taken for a module's own: its driver is read in that module, which has no line item Open.
    const rows = [moduleRow("REV01 Revenue"), flag("REV01 Revenue", "Open"), { "": "Stray", [READ]: "Open", [WRITE]: "REV01 Revenue.Open" }];
    expect(access(lineItems(...rows))).toEqual([["REV01 Revenue", "Open", "Write", "Stray", ""], ["", "Open", "Read", "Stray", ""]]);
    // The Modules table names the model's modules. Stray is none of them: it is a line item whose module the file does
    // not say, which the map leaves out. Its cells are listed with the row as a line item's, in no module.
    expect(access(lineItems(...rows), modulesFile("REV01 Revenue"))).toEqual([["REV01 Revenue", "Open", "Write", "", "Stray"], ["", "Open", "Read", "", "Stray"]]);
    expect(access(lineItems(...rows), modulesFile("REV01 Revenue", "Stray"))).toEqual([["REV01 Revenue", "Open", "Write", "Stray", ""], ["", "Open", "Read", "Stray", ""]]);
  });

  it("is not made without the Line Items table, or without its Module Name column or one of its two driver columns, and says which", () => {
    const table = lineItems(moduleRow("REV01 Revenue"), flag("REV01 Revenue", "Open"), item("REV01 Revenue", "Units", { [READ]: "Open", [WRITE]: "Open" }));
    expect(missing(table)).toBe("made");
    expect([missing(), missing(modulesFile("REV01 Revenue")), missing({ ...table, file: "Line Items (2).csv" })]).toEqual(Array.from({ length: 3 }, () => "Line Items was not exported."));
    expect(missing(without(table, READ))).toBe("Line Items has no Read Access Driver column.");
    expect(missing(without(table, WRITE))).toBe("Line Items has no Write Access Driver column.");
    expect(missing(without(table, READ, WRITE))).toBe("Line Items has no Read Access Driver and Write Access Driver columns.");
    // With one of the two, half the table would look like the whole of it: the model's write drivers, and no word that
    // its read drivers are not there. A file without rows says of both that the model has none.
    expect(missing(without(lineItems(), WRITE))).toBe("Line Items has no Write Access Driver column.");
    // Without Module Name no row says which module it is in. The map then has no line items, and a table made of the
    // rows as they are would name no module in any row: there is no table, and the reason names the column.
    expect(missing(without(table, "Module Name"))).toBe("Line Items has no Module Name column.");
    expect(missing(without(table, "Module Name", WRITE))).toBe("Line Items has no Module Name and Write Access Driver columns.");
    expect(missing(without(table, "Module Name", READ, WRITE))).toBe("Line Items has no Module Name, Read Access Driver and Write Access Driver columns.");
    // The first column is the row's name, whatever its header: a column is one after it, as the map reads the file.
    expect(missing(file("Line Items", [READ, WRITE, "Module Name"], [["REV01 Revenue", "", ""]]))).toBe("Line Items has no Read Access Driver column.");
    // It is made from the first table of the file's name, as the map is: a second one counts for nothing, whether it
    // has rows and columns or not. And the tables given are never changed.
    const kept = JSON.stringify([table, modulesFile("REV01 Revenue")]);
    const given = JSON.parse(kept) as ResultTable[];
    const both = [["REV01 Revenue", "Open", "Read", "REV01 Revenue", "Units"], ["REV01 Revenue", "Open", "Write", "REV01 Revenue", "Units"]];
    expect([access(...given, lineItems()), access(...given, without(lineItems(), READ, WRITE))]).toEqual([both, both]);
    expect([access(lineItems(), ...given), missing(without(table, WRITE), ...given)]).toEqual([[], "Line Items has no Write Access Driver column."]);
    expect(JSON.stringify(given)).toBe(kept);
  });

  it("throws what keeps the map's graph from being made, where the map itself gives a graph of nothing", () => {
    // What is no list of tables: the page's map says that it could not be made, and draws nothing. A table of no rows
    // would say that the model drives no access, so there the table is not made, and the reason is thrown.
    for (const tables of [undefined, null, 7]) {
      expect(buildModelGraph(tables as unknown as ResultTable[]).nodes).toEqual([]);
      expect(() => accessTable(tables as unknown as ResultTable[])).toThrow();
    }
  });

  it("makes the table of a model of 250 modules and 5,000 line items in well under a second, and agrees with the map on every row", () => {
    const PER_MODULE = 20;
    const moduleName = (index: number): string => `MOD${String(index).padStart(3, "0")} Made-up module, ${index}`;
    const lineName = (index: number): string => `Line item ${index}`;
    const written = (module: number, line: number): string => `'${moduleName(module)}'.${lineName(line)}`;
    const rows: Cells[] = [];
    for (let module = 0; module < 250; module++) {
      if (module % 25 === 0) rows.push(heading(`-- ${String(module / 25).padStart(2, "0")} : SECTION --`));
      rows.push(moduleRow(moduleName(module)));
      for (let line = 0; line < PER_MODULE; line++) {
        // Each line item is referred to by the next one of its module and by one of another module, as in a model whose
        // formulas the map links. Every fourth has a read driver in its own module and a write driver in the next
        // module, and one line item of each module names a driver the model does not have.
        rows.push(item(moduleName(module), lineName(line), { "Referenced By": `${lineName((line + 1) % PER_MODULE)}, ${written((module + 113) % 250, (line + 5) % PER_MODULE)}`,
          ...(line % 4 === 2 ? { [READ]: lineName(1), [WRITE]: written((module + 1) % 250, 0) } : {}),
          ...(line === 7 ? { [READ]: written(module, 99) } : {}) }));
      }
    }
    const tables = [lineItems(...rows), modulesFile(...rows.filter(row => !row["Module Name"]).map(row => String(row[""])))];
    expect(access(...tables)).toHaveLength(250 * (5 * 2 + 1));
    let took = Infinity;
    let large = made(...tables);
    for (let run = 0; run < 3; run++) {
      const started = performance.now();
      large = made(...tables);
      took = Math.min(took, performance.now() - started);
    }
    expect([large.table.rows.length, large.unmatched]).toEqual([2750, 250]);
    // The first driver in the file is the first line item of the first module, which drives who may write five line
    // items of the last module. The rows whose driver was not matched are the last, in the file's order.
    expect(large.table.rows.slice(0, 2)).toEqual([[moduleName(0), lineName(0), "Write", moduleName(249), lineName(2)], [moduleName(0), lineName(0), "Write", moduleName(249), lineName(6)]]);
    expect(large.table.rows.at(-1)).toEqual(["", written(249, 99), "Read", moduleName(249), lineName(7)]);
    // Loosely: the table takes some tens of milliseconds on a laptop, nearly all of them the map's graph.
    expect(took).toBeLessThan(1_000);
  });
});
