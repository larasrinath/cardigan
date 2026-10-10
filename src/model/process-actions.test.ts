import { describe, expect, it } from "vitest";
import type { Grid, GridRow } from "./grid.js";
import { PROCESS_DEFINITION, PROCESS_NOTES, processActions, processesLine, readProcessDefinition } from "./process-actions.js";

// Process definitions as Anaplan's process dialog saves them (anaplan/gridlet/_editor/ProcessEditor.js `getValue`). Every
// name and ID is made up.

const [LOAD, PRICES, SEND, CLEAR] = [112000000001, 112000000002, 116000000001, 117000000001];
const id = (entity: number): string => `_${entity}_`;
const row = (entity: number, name: string, ...cells: string[]): GridRow => ({ ids: [entity], labels: [name], cells });
/** The Actions list, headings and all, as the export reads it: what names each action by its ID. */
const ACTIONS: GridRow[] = [row(31000000001, "Processes"), row(118000000001, "Month end"), row(118000000002, "Weekly"), row(118000000003, "Empty"),
  row(31000000002, "Imports"), row(LOAD, "Load regions"), row(PRICES, "Prices"), row(31000000003, "Exports"), row(SEND, "Send plan"),
  row(31000000004, "Other Actions"), row(CLEAR, "Clear old items")];
const NAMES = new Map(ACTIONS.map(entry => [String(entry.ids[0]), entry.labels[0]]));
/** A chain of nodes as the dialog writes it: each action in a node of its own, named by its place, each naming the next. */
const chain = (...steps: [type: string, action: number][]): string => {
  const nodes: Record<string, unknown> = { _END_: { type: "END", next: null } };
  steps.forEach(([type, action], at) => { nodes[String(at)] = { type, action: id(action), next: at + 1 < steps.length ? String(at + 1) : "_END_" }; });
  return JSON.stringify({ nodes, start: steps.length ? "0" : "_END_", useDetailedResults: true });
};

describe("A process's actions, read out of its definition", () => {
  it("are those of the chain of its nodes, from start to end, each named as the Actions list names it, by Anaplan's word for its kind", () => {
    expect(readProcessDefinition(chain(["IMPORT", LOAD], ["IMPORT", PRICES], ["EXPORT", SEND], ["ACTION", CLEAR]), NAMES)).toEqual({ actions: [
      { id: String(LOAD), name: "Load regions", type: "IMPORT" }, { id: String(PRICES), name: "Prices", type: "IMPORT" },
      { id: String(SEND), name: "Send plan", type: "EXPORT" }, { id: String(CLEAR), name: "Clear old items", type: "ACTION" }] });
    // The order is the chain's, not that of the nodes' names: a node written first may run last.
    const backwards = JSON.stringify({ start: "b", nodes: { a: { type: "ACTION", action: id(CLEAR), next: "_END_" }, b: { type: "IMPORT", action: id(PRICES), next: "a" },
      _END_: { type: "END", next: null } } });
    expect(readProcessDefinition(backwards, NAMES).actions.map(step => step.name)).toEqual(["Prices", "Clear old items"]);
    // A process that runs nothing: the dialog's own definition of none.
    expect(readProcessDefinition(chain(), NAMES)).toEqual({ actions: [] });
  });

  it("name an action the Actions list does not have by its ID, and one named in a way Cardigan does not know by saying so", () => {
    const text = JSON.stringify({ start: "0", nodes: { 0: { type: "IMPORT", action: "_112000000099_", next: "1" }, 1: { type: "ACTION", action: "Clear old items", next: "2" },
      2: { action: id(SEND), next: "_END_" } } });
    expect(readProcessDefinition(text, NAMES).actions).toEqual([{ id: "112000000099", name: "ID 112000000099", type: "IMPORT" },
      { id: "", name: "An action the definition names in a way Cardigan does not know", type: "ACTION" }, { id: String(SEND), name: "Send plan", type: "" }]);
  });

  it("end where the chain comes back to a node, names a node there is none of, or reaches one that is no object", () => {
    const looped = JSON.stringify({ start: "0", nodes: { 0: { type: "IMPORT", action: id(LOAD), next: "1" }, 1: { type: "EXPORT", action: id(SEND), next: "0" } } });
    expect(readProcessDefinition(looped, NAMES).actions.map(step => step.name)).toEqual(["Load regions", "Send plan"]);
    const broken = JSON.stringify({ start: "0", nodes: { 0: { type: "IMPORT", action: id(LOAD), next: "7" } } });
    expect(readProcessDefinition(broken, NAMES).actions.map(step => step.name)).toEqual(["Load regions"]);
    const odd = JSON.stringify({ start: "0", nodes: { 0: { type: "IMPORT", action: id(LOAD), next: "1" }, 1: "Send plan" } });
    expect(readProcessDefinition(odd, NAMES).actions.map(step => step.name)).toEqual(["Load regions"]);
    // A node that names no action, as the dialog's end does, runs none: the chain goes on past it.
    const quiet = JSON.stringify({ start: "0", nodes: { 0: { type: "WAIT", next: "1" }, 1: { type: "EXPORT", action: id(SEND), next: null } } });
    expect(readProcessDefinition(quiet, NAMES).actions.map(step => step.name)).toEqual(["Send plan"]);
    // A key of the object's own and no node of the chain: "toString" is not a node.
    expect(readProcessDefinition(JSON.stringify({ start: "toString", nodes: {} }), NAMES)).toEqual({ actions: [] });
  });

  it("are not known where the definition is empty, no JSON, or JSON of another make, and the note says why", () => {
    expect(readProcessDefinition(" ", NAMES)).toEqual({ actions: [], note: PROCESS_NOTES.noDefinition });
    for (const text of ["{", "[]", "null", '"text"', JSON.stringify({ start: "0" }), JSON.stringify({ nodes: [], start: "0" }), JSON.stringify({ nodes: {}, start: 3 })]) {
      expect(readProcessDefinition(text, NAMES), text).toEqual({ actions: [], note: PROCESS_NOTES.unknown });
    }
  });
});

/** The grid of the processes against their properties, as the Actions tab reads it (anaplan/settings/Actions/_ProcessDefinitions.js):
 * the processes' definitions in their column, with another column beside it. */
const DEFINITIONS: Grid = {
  columns: [{ ids: [4000000017], labels: ["Notes"] }, { ids: [PROCESS_DEFINITION], labels: ["Process Definition"] }],
  rows: [row(118000000001, "Month end", "Runs last", chain(["IMPORT", PRICES], ["ACTION", CLEAR], ["IMPORT", 112000000099])),
    row(118000000003, "Empty", "", chain()), row(118000000004, "Odd", "", "{")],
};
const PROCESSES = ACTIONS.filter(entry => Math.floor(entry.ids[0] / 1e9) === 118).concat(row(118000000004, "Odd"));

describe("The actions of a model's processes", () => {
  it("are listed for each process of the Actions list, in its order, out of its definition, and the log counts them by kind", () => {
    const log: string[] = [];
    expect(processActions(PROCESSES, DEFINITIONS, ACTIONS, line => log.push(line))).toEqual([
      { id: "118000000001", name: "Month end", actions: [{ id: String(PRICES), name: "Prices", type: "IMPORT" }, { id: String(CLEAR), name: "Clear old items", type: "ACTION" },
        { id: "112000000099", name: "ID 112000000099", type: "IMPORT" }] },
      // A process the grid holds no definition for says so: none of the processes is left out.
      { id: "118000000002", name: "Weekly", actions: [], note: PROCESS_NOTES.noDefinition },
      { id: "118000000003", name: "Empty", actions: [] },
      { id: "118000000004", name: "Odd", actions: [], note: PROCESS_NOTES.unknown }]);
    // A line for each process that could not be read, by its ID alone, and a last line that counts what was read, the
    // actions by kind, those the Actions list does not have, and what the grid holds.
    expect(log).toEqual(["Process 118000000002: not in the grid of definitions", "Process 118000000004: the definition is not one Cardigan knows",
      "Process actions: 2 of 4 read; 3 actions: IMPORT ×2, ACTION ×1, 1 not in the Actions list; 3 found in the grid of definitions"]);
    expect([processesLine(1), processesLine(45)]).toEqual(["Process actions: 1 process to read", "Process actions: 45 processes to read"]);
  });

  it("say that they could not be read where the model gave no definitions, or none in a column Cardigan can find", () => {
    const log: string[] = [];
    const unread = processActions(PROCESSES, undefined, ACTIONS, line => log.push(line));
    expect(new Set(unread.map(process => process.note))).toEqual(new Set([PROCESS_NOTES.notRead]));
    expect(log).toEqual(["Process actions: 0 of 4 read; 0 actions; the model gave no grid of definitions"]);
    // A client that numbers the column otherwise: the definitions are looked for under the ID the client says, then under
    // the column's label, and are not taken from another column.
    log.length = 0;
    expect(processActions(PROCESSES, DEFINITIONS, ACTIONS, line => log.push(line), 4000009999)[0].actions).toHaveLength(3);
    log.length = 0;
    const unlabelled: Grid = { ...DEFINITIONS, columns: DEFINITIONS.columns.map(column => ({ ...column, labels: [column.labels[0] === "Process Definition" ? "Definition" : column.labels[0]] })) };
    const nowhere = processActions(PROCESSES, unlabelled, ACTIONS, line => log.push(line), 4000009999);
    expect([new Set(nowhere.map(process => process.note)), log]).toEqual([new Set([PROCESS_NOTES.notRead]),
      ["Process actions: no column of definitions among the 2 given", "Process actions: 0 of 4 read; 0 actions; the grid has no column of definitions"]]);
  });
});
