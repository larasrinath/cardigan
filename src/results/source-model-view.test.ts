import { describe, expect, it } from "vitest";
import type { AnalysisResult, ResultTable } from "../result-types.js";
import { sourceModelOfRow } from "./source-model-view.js";
import { fileView } from "./result-view.js";

// A model whose imports read two other models, as the user's Source Models showed them (10 Oct 2026): each source model
// named behind its workspace, with how many objects and imports it gives. The names of the objects and imports are made up.
const DEMAND = "DEV - Supply Chain Applications - Polaris / DEV - Demand Ana";
const STAT = "Pedalwick Partners / DEV Stat";
const MAPPED = '{"workspaceId":"9999aaaa0000bbbb1111cccc2222dddd","workspaceName":"Pedalwick Partners - Polaris","modelId":"2222BBBB3333CCCC4444DDDD5555EEEE","modelName":"Pedalwick Demand Analysis 2026"}';

const table = (file: string, headers: string[], rows: string[][]): ResultTable => ({ file, label: file.replace(/\.csv$/, ""), headers, rows, guard: false });

const SOURCE_MODELS = table("Source Models.csv", ["", "Sources", "Imports", "Mapped To"], [
  [DEMAND, "2", "2", MAPPED],
  [STAT, "1", "1", MAPPED],
]);
const DATA_SOURCES = table("Import Data Sources.csv", ["", "Source Model", "Source Type", "Source Object Name", "Production Data", "Imports"], [
  ["SYS02 Products.Export", DEMAND, "SAVED VIEW", "SYS02 Products", "false", "IMP01 Products from Demand"],
  ["DAT01 Demand.Grid", DEMAND, "MODULE", "DAT01 Demand", "false", "IMP02 Demand from Demand, IMP03 Demand again"],
  ["Stat Combos.Export", STAT, "SAVED VIEW", "Stat Combos", "false", "IMP04 Stat combos"],
  ["prices.csv", "-", "FILE", "prices.csv", "false", "IMP05 Prices"],
]);
const IMPORTS = table("Imports.csv", ["", "Source Label", "Source Object", "Source Type", "Target Object", "Target Type", "Production Data"], [
  ["IMP01 Products from Demand", "IMP01", `${DEMAND} / 'SYS02 Products'.Export`, "SAVED VIEW", "Products", "LIST", "false"],
  ["IMP02 Demand from Demand", "IMP02", `${DEMAND} / 'DAT01 Demand'`, "MODULE", "Demand", "MODULE", "false"],
  ["IMP03 Demand again", "IMP03", `${DEMAND} / 'DAT01 Demand'`, "MODULE", "Demand", "MODULE", "false"],
  ["IMP04 Stat combos", "IMP04", `${STAT} / 'Stat Combos'.Export`, "SAVED VIEW", "Combos", "LIST", "false"],
  ["IMP05 Prices", "prices.csv", "-", "FILE", "Prices", "MODULE", "false"],
]);

const model = (...tables: ResultTable[]): AnalysisResult => ({ kind: "model", name: "Pedalwick Data Hub 2026", id: "6666FFFF7777AAAA8888BBBB9999CCCC",
  zipName: "Pedalwick Data Hub 2026 - Model Export - 2026-10-10.zip", summary: [], tables });

/** Source Models as the page shows it, Mapped To split in two (result-view.ts), and its row of `name`. */
function rowOf(result: AnalysisResult, name: string) {
  const shown = fileView(result, result.tables.find(each => each.file === "Source Models.csv")!).table;
  return { shown, row: shown.rows.find(row => row[0] === name)! };
}

describe("A source model's details", () => {
  it("lists the objects it gives, each with its kind and its row of Import Data Sources, and the imports that read them, each with what it reads", () => {
    const result = model(SOURCE_MODELS, DATA_SOURCES, IMPORTS);
    const { shown, row } = rowOf(result, DEMAND);
    // The page shows Mapped To as two columns; the row keeps its counts.
    expect(shown.headers).toEqual(["", "Sources", "Imports", "Mapped Workspace", "Mapped Model"]);
    expect(sourceModelOfRow(result, shown, row)).toEqual({
      sources: [{ name: "SYS02 Products", kind: "Saved view", row: 0 }, { name: "DAT01 Demand", kind: "Module", row: 1 }],
      imports: [{ name: "IMP01 Products from Demand", from: ["SYS02 Products"] }, { name: "IMP02 Demand from Demand", from: ["DAT01 Demand"] },
        { name: "IMP03 Demand again", from: ["DAT01 Demand"] }],
      sourceLines: [],
      // The row counts 2 imports, and Import Data Sources names 3: the line says so.
      importLines: ["Imports counts 2; 3 are found in Import Data Sources."],
    });
    const stat = rowOf(result, STAT);
    expect(sourceModelOfRow(result, stat.shown, stat.row)).toEqual({ sources: [{ name: "Stat Combos", kind: "Saved view", row: 2 }],
      imports: [{ name: "IMP04 Stat combos", from: ["Stat Combos"] }], sourceLines: [], importLines: [] });
  });

  it("says where the count of sources is not what Import Data Sources lists", () => {
    const counted = table("Source Models.csv", SOURCE_MODELS.headers, [[DEMAND, "3", "3", MAPPED]]);
    const result = model(counted, DATA_SOURCES, IMPORTS);
    const { shown, row } = rowOf(result, DEMAND);
    const view = sourceModelOfRow(result, shown, row);
    expect([view?.sourceLines, view?.importLines]).toEqual([["Sources counts 3; 2 are found in Import Data Sources."], []]);
  });

  it("finds a source model that one table names behind its workspace and the other by its own name, where no other source model has that name", () => {
    // Import Data Sources names the model alone; Source Models names it behind its workspace.
    const bare = table("Import Data Sources.csv", DATA_SOURCES.headers, [["SYS02 Products.Export", "  DEV - Demand Ana ", "SAVED VIEW", "SYS02 Products", "false", "IMP01 Products from Demand"]]);
    const result = model(SOURCE_MODELS, bare, IMPORTS);
    const { shown, row } = rowOf(result, DEMAND);
    expect(sourceModelOfRow(result, shown, row)?.sources).toEqual([{ name: "SYS02 Products", kind: "Saved view", row: 0 }]);
    // And the other way round, and with the spaces and quotes a cell may have.
    const behind = table("Source Models.csv", SOURCE_MODELS.headers, [["DEV - Demand Ana", "1", "1", MAPPED]]);
    const quoted = table("Import Data Sources.csv", DATA_SOURCES.headers, [["v", "'DEV - Supply Chain Applications -  Polaris / DEV - Demand Ana'", "MODULE", "DAT01 Demand", "false", ""]]);
    const other = model(behind, quoted, IMPORTS);
    const found = rowOf(other, "DEV - Demand Ana");
    expect(sourceModelOfRow(other, found.shown, found.row)?.sources).toEqual([{ name: "DAT01 Demand", kind: "Module", row: 0 }]);
  });

  it("does not take a model's own name for it where another source model has that name too, nor a model of another workspace", () => {
    const twins = table("Source Models.csv", SOURCE_MODELS.headers, [[DEMAND, "1", "1", MAPPED], ["OTHER WS / DEV - Demand Ana", "1", "1", MAPPED]]);
    const bare = table("Import Data Sources.csv", DATA_SOURCES.headers, [["SYS02 Products.Export", "DEV - Demand Ana", "SAVED VIEW", "SYS02 Products", "false", ""]]);
    const result = model(twins, bare);
    const { shown, row } = rowOf(result, DEMAND);
    // Which of the two the bare name is is not known, and nothing else names either: no section.
    expect(sourceModelOfRow(result, shown, row)).toBeUndefined();
    const elsewhere = table("Import Data Sources.csv", DATA_SOURCES.headers, [["v", "THIRD WS / DEV - Demand Ana", "MODULE", "DAT01 Demand", "false", ""]]);
    const third = model(SOURCE_MODELS, elsewhere);
    const again = rowOf(third, DEMAND);
    expect(sourceModelOfRow(third, again.shown, again.row)).toBeUndefined();
  });

  it("finds the imports in the Imports table, by their Source Object, where Import Data Sources lists none of them", () => {
    const withoutModel = table("Import Data Sources.csv", ["", "Type", "Used in Imports"], [["prices.csv", "FILE", "IMP05 Prices"]]);
    const result = model(SOURCE_MODELS, withoutModel, IMPORTS);
    const { shown, row } = rowOf(result, DEMAND);
    expect(sourceModelOfRow(result, shown, row)).toEqual({ sources: [], imports: [{ name: "IMP01 Products from Demand", from: ["SYS02 Products.Export"] },
      { name: "IMP02 Demand from Demand", from: ["DAT01 Demand"] }, { name: "IMP03 Demand again", from: ["DAT01 Demand"] }],
    sourceLines: [], importLines: ["Imports counts 2; 3 are found in Imports."] });
  });

  it("gives nothing for a source model that neither table names, for another table's row, and for an app's result", () => {
    const result = model(SOURCE_MODELS, DATA_SOURCES, IMPORTS);
    const lonely = table("Source Models.csv", SOURCE_MODELS.headers, [["NOWHERE / Lost model", "1", "1", MAPPED]]);
    const unknown = model(lonely, DATA_SOURCES, IMPORTS);
    const { shown, row } = rowOf(unknown, "NOWHERE / Lost model");
    expect(sourceModelOfRow(unknown, shown, row)).toBeUndefined();
    expect(sourceModelOfRow(result, IMPORTS, IMPORTS.rows[0])).toBeUndefined();
    expect(sourceModelOfRow({ ...result, kind: "app" }, SOURCE_MODELS, SOURCE_MODELS.rows[0])).toBeUndefined();
    expect(sourceModelOfRow(undefined, SOURCE_MODELS, SOURCE_MODELS.rows[0])).toBeUndefined();
  });
});
