import { describe, expect, it } from "vitest";
import { groupingsOf } from "../map/map-groups.js";
import { indexModel } from "../map/map-model.js";
import { buildModelGraph } from "../map/build-graph.js";
import { accessTable } from "../model/access.js";
import type { AnalysisResult, Cell, ResultTable } from "../result-types.js";
import { APP_FILES, columnsOf } from "./columns.js";
import { cellLists, rowItems } from "./cell-lists.js";
import { parseMarkup } from "./dom.test-support.js";
import { cellHtml, colFilterHtml, rowDrawerHtml } from "./markup.js";
import { fileView } from "./result-view.js";
import { rangeColumn, selectRows, tableText, valueCounts } from "./table-engine.js";

const table = (file: string, headers: string[], rows: Cell[][]): ResultTable => ({ file, label: file.slice(0, -4), headers, rows, guard: false });
const result = (tables: ResultTable[], kind: "model" | "app" = "model"): AnalysisResult => ({
  kind, id: "invented-model", name: "Example model", zipName: "unused.zip", summary: [], tables,
});
const links = { page: false, card: false };
const imports = () => table("Imports.csv", ["", "Source Model"], [
  ["From file", "-"], ["Empty", ""], ["Spaced dash", " \t-\n"], ["From model", "Example hub"], ["Hyphenated", "Example-hub"],
]);

describe("Lone dashes in table views", () => {
  it.each(["model", "app"] as const)("blanks every %s table's lone dashes without touching the result", kind => {
    const files = ["Imports.csv", "Module Usage.csv", "Page Filters.csv", "Page Actions.csv", ...Object.values(APP_FILES), "Unknown.csv"];
    const tables = files.map(file => table(file, ["Name", "Value"], [["Row", "-", " \t-\n"], ["Other", "a-b"], ["Negative", -2]]));
    const stored = result(tables, kind);
    const before = structuredClone(stored);
    for (const file of tables) {
      const view = fileView(stored, file).table;
      expect(view.rows).toEqual([["Row", "", ""], ["Other", "a-b"], ["Negative", -2]]);
      expect(cellHtml(columnsOf(view).find(column => column.index === 1)!, view.rows[0], links)).toBe("");
    }
    expect(stored).toEqual(before);
    expect([tableText("--"), tableText(" -2 "), tableText("a - b"), tableText("—")]).toEqual(["--", " -2 ", "a - b", "—"]);
  });

  it("merges dashes with empty cells in the filter and shows empty details", () => {
    const file = imports();
    const stored = result([file]);
    const view = fileView(stored, file).table;
    const lists = cellLists(stored, view);
    const columns = columnsOf(view, lists);
    const counts = valueCounts(view.rows, 1, lists.get(1));
    expect(counts).toEqual([["", 3], ["Example hub", 1], ["Example-hub", 1]]);
    const filter = parseMarkup(colFilterHtml(columns.find(column => column.index === 1)!, counts, undefined));
    expect(filter.querySelectorAll(".pop-opt").map(option => [option.children[1].textContent, option.children[2].textContent])).toContainEqual(["(blank)", "3 rows in the whole table"]);
    expect(selectRows(view.rows, { search: "", filters: new Map([[1, new Set([""])]]) }).map(row => row[0]))
      .toEqual(["From file", "Empty", "Spaced dash"]);
    const details = parseMarkup(rowDrawerHtml(columns, view.rows[0], links, undefined, rowItems(lists, view.rows[0])));
    expect(details.querySelectorAll("dd").map(cell => cell.textContent)).toEqual(["From file", ""]);
    expect(details.querySelectorAll(".dash")).toHaveLength(0);
  });

  it("searches and sorts the blank value, with stable ties and numeric ordering", () => {
    const file = imports();
    const view = fileView(result([file]), file).table;
    expect(selectRows(view.rows, { search: "-", filters: new Map() }).map(row => row[0])).toEqual(["Hyphenated"]);
    const numeric = table("Unknown.csv", ["Name", "Amount"], [["Dash", "-"], ["Ten", 10], ["Empty", ""], ["Negative", -2], ["Two", 2]]);
    const rows = fileView(result([numeric]), numeric).table.rows;
    expect(selectRows(rows, { search: "", filters: new Map(), sort: { column: 1, dir: "asc" } }).map(row => row[0]))
      .toEqual(["Dash", "Empty", "Negative", "Two", "Ten"]);
    expect(selectRows(rows, { search: "", filters: new Map(), sort: { column: 1, dir: "desc" } }).map(row => row[0]))
      .toEqual(["Ten", "Two", "Negative", "Dash", "Empty"]);
  });

  it.each(["number", "date"] as const)("counts dashes as blanks in %s ranges, cached or read directly", kind => {
    const file = table("Unknown.csv", ["Name", "Value"], [["Dash", " - "], ["Empty", ""], ["Low", kind === "number" ? "2" : "2026-01-02"],
      ["High", kind === "number" ? "10" : "2026-01-10"]]);
    const view = fileView(result([file]), file).table;
    expect(columnsOf(view)[1].range).toBe(kind);
    const read = rangeColumn(view.rows, 1, kind, true);
    expect(read.blanks).toBe(2);
    for (const values of [undefined, read.values]) {
      for (const blanks of [false, true]) {
        expect(selectRows(view.rows, { search: "", filters: new Map(), ranges: new Map([[1, { kind, from: read.highest!.value, blanks, none: true, values }]]) }).map(row => row[0]))
          .toEqual(blanks ? ["Dash", "Empty", "High"] : ["High"]);
      }
    }
  });

  it("keeps the three inherited dashes and the source tables used by the map and Dynamic Cell Access", () => {
    const modules = table("Modules.csv", ["", "Applies To"], [["Plan", "Products"], ["Access", ""]]);
    const lines = table("Line Items.csv", ["", "Module Name", "Format", "Summary", "Applies To", "Read Access Driver", "Write Access Driver", "Notes"], [
      ["Plan", "", "", "", "Products", "Access.Read", "Access.Write", "-"],
      ["Amount", "Plan", '{"dataType":"NUMBER"}', "SUM", "-", "-", " - ", "-"],
      ["Orphan", "Absent", '{"dataType":"NUMBER"}', "SUM", " - ", "-", "-", "-"],
      ["Access", "", "", "", "", "", "", ""],
      ["Read", "Access", '{"dataType":"BOOLEAN"}', "NONE", "", "", "", ""],
      ["Write", "Access", '{"dataType":"BOOLEAN"}', "NONE", "", "", "", ""],
    ]);
    const usage = table("Module Usage.csv", ["Module", "App", "Page"], [["Plan", "-", "-"], ["Access", "Example app", "Example page"]]);
    const stored = result([modules, lines, usage]);
    const before = structuredClone(stored);
    const graph = buildModelGraph(stored.tables);
    const access = accessTable(stored.tables);
    const view = fileView(stored, lines);
    const index = (header: string) => view.table.headers.indexOf(header);
    expect(view.table.rows[0][index("Applies To")]).toBe("Products");
    expect(view.table.rows[0][index("Applies To from")]).toBe("Module");
    const orphan = view.table.rows[1];
    for (const header of ["Applies To", "Read Access Driver", "Write Access Driver"]) {
      const at = index(header);
      const column = columnsOf(view.table).find(column => column.index === at)!;
      expect(parseMarkup(cellHtml(column, orphan, links)).textContent.trim()).toBe("-");
      expect(valueCounts(view.table.rows, at).some(([value]) => value.trim() === "-")).toBe(true);
    }
    expect(selectRows(view.table.rows, { search: "-", filters: new Map() }).map(row => row[0])).toEqual(["Amount", "Orphan"]);
    expect(view.exported?.get(view.table.rows[0])?.get(index("Format"))).toBe('{"dataType":"NUMBER"}');
    fileView(stored, usage);
    expect(stored).toEqual(before);
    expect(buildModelGraph(stored.tables)).toEqual(graph);
    expect(accessTable(stored.tables)).toEqual(access);
    const app = groupingsOf(indexModel(buildModelGraph(stored.tables))).find(group => group.kind === "app")!;
    expect(graph.nodes.filter(node => node.kind === "module").map(node => [node.name, app.groupOf.get(node.id)]))
      .toEqual([["Plan", "Not on any page"], ["Access", "Example app"]]);
    expect(JSON.stringify(access)).toContain("Amount");
  });
});
