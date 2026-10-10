import type { Log } from "../progress.js";
import type { ProcessActions, ProcessStep } from "../result-types.js";
import type { Grid, GridRow } from "./grid.js";

/** The actions each process runs, in the order it runs them, out of the process's own definition: the JSON that Anaplan's
 * process dialog reads and saves (anaplan/gridlet/_editor/ProcessEditor.js), which the Model settings grid of the
 * processes against their properties holds in the column of SYSTEM_PROPERTY_PROCESS_DEFINITION. The Actions tab reads
 * that grid itself for its processes (anaplan/settings/Actions/_ProcessDefinitions.js): a MODEL_DEFINITION view of the
 * PROCESS axis against PROCESS_PROPERTY, each process's definition the one cell of its row. The export reads it as it
 * reads the others (native.ts `readGrid`): one view, read, and nothing saved.
 *
 * A definition is a chain of nodes, which the dialog writes as
 * `{"nodes":{"0":{"type":"IMPORT","action":"_112000000001_","next":"1"},"1":{…,"next":"_END_"},"_END_":{"type":"END","next":null}},"start":"0"}`:
 * the process runs the action of the node `start` names, then that of the node its `next` names, until `_END_`. A node's
 * `action` is the action's ID between underscores (anaplan/utils/EntityLongIdHelper.js
 * `entityLongIdIdentifierToEntityLongId`), and its `type` is IMPORT, EXPORT or ACTION, for any other action; the dialog
 * reads the chain the same way (ProcessEditor.js `getSelectedItems`). Each action is named as the Actions list names it,
 * which the export has read: nothing more is read for the names. */

/** SYSTEM_PROPERTY_PROCESS_DEFINITION (anaplan/constants.js): the grid's column that holds each process's definition. */
export const PROCESS_DEFINITION = 4000001900;
/** The label of that column, by which it is found where the client numbers it otherwise. */
const DEFINITION_LABEL = "process definition";
/** The node that ends a chain. */
const END = "_END_";

/** What the page says of a process whose actions could not be read, by why. */
const NOT_READ = "Cardigan could not read the actions of this process";
export const PROCESS_NOTES = {
  notRead: `${NOT_READ}: the model did not give the processes' definitions. The diagnostic log says why.`,
  noDefinition: `${NOT_READ}: the model gave no definition for it.`,
  unknown: `${NOT_READ}: its definition is not written in a way Cardigan knows.`,
} as const;

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);

/** An action's ID out of a node's `action`: the digits between its underscores. Empty for anything else. */
function actionId(value: unknown): string {
  const found = typeof value === "string" ? /^_(\d{1,19})_$/.exec(value.trim()) : null;
  return found ? found[1] : "";
}

/** A process's actions out of its definition's text, in the order the chain of its nodes runs them, or why there are
 * none: a definition that is empty, no JSON, or JSON of another make (no nodes, no start). A chain that comes back to a
 * node it has been through, or names a node there is none of, ends there: the definition holds nothing after it that
 * the process runs. `names` names each action by its ID. */
export function readProcessDefinition(text: string, names: ReadonlyMap<string, string>): { actions: ProcessStep[]; note?: string } {
  if (text.trim() === "") return { actions: [], note: PROCESS_NOTES.noDefinition };
  let definition: unknown;
  try {
    definition = JSON.parse(text);
  } catch {
    return { actions: [], note: PROCESS_NOTES.unknown };
  }
  if (!isObject(definition) || !isObject(definition.nodes) || (definition.start !== null && typeof definition.start !== "string")) {
    return { actions: [], note: PROCESS_NOTES.unknown };
  }
  const nodes = definition.nodes;
  const actions: ProcessStep[] = [];
  const passed = new Set<string>();
  let at: unknown = definition.start;
  while (typeof at === "string" && at !== END && !passed.has(at) && Object.hasOwn(nodes, at)) {
    passed.add(at);
    const node = nodes[at];
    if (!isObject(node)) break;
    if (node.action !== undefined && node.action !== null) {
      const id = actionId(node.action);
      actions.push({ id, name: (id && names.get(id)) || (id ? `ID ${id}` : "An action the definition names in a way Cardigan does not know"), type: typeof node.type === "string" ? node.type : "" });
    }
    at = node.next;
  }
  return { actions };
}

/** The column of the grid of definitions that holds them: the one the client numbers `column`, or else the one labelled
 * Process Definition, as a client that numbers it otherwise would give it; -1 where there is neither. */
function definitionsAt(definitions: Grid, column: number): number {
  const byId = definitions.columns.findIndex(entry => entry.ids[0] === column);
  return byId >= 0 ? byId : definitions.columns.findIndex(entry => (entry.labels[0] ?? "").trim().toLowerCase() === DEFINITION_LABEL);
}

/** The log's line before the definitions are read: how many processes the Actions list has. */
export const processesLine = (count: number): string => `Process actions: ${count} ${count === 1 ? "process" : "processes"} to read`;

/** Each process of the Actions list (`processes`, its rows), in the list's order, with the actions it runs: out of its
 * definition's cell in `definitions`, the grid of the processes against their properties, in its column of definitions
 * (`definitionsAt`). Without that grid, which the model did not give, each says so, and so does a process the grid has no
 * definition for: none is left out, so that the page has one for each row of the Processes table. `actions` are every row
 * of the Actions list, which name the actions by their IDs. The log says how many were read and how many actions they
 * run, by Anaplan's word for each kind, and why nothing was where the grid or its column is missing; a line for each
 * process that could not be read says why, by the process's ID alone. */
export function processActions(processes: readonly GridRow[], definitions: Grid | undefined, actions: readonly GridRow[], log: Log, column = PROCESS_DEFINITION): ProcessActions[] {
  const names = new Map<string, string>();
  for (const row of actions) if (Number.isSafeInteger(row.ids[0]) && row.ids[0] > 0 && !names.has(String(row.ids[0]))) names.set(String(row.ids[0]), row.labels[0] ?? "");
  const at = definitions ? definitionsAt(definitions, column) : -1;
  const byId = new Map((definitions?.rows ?? []).map(row => [row.ids[0], row]));
  if (definitions && at < 0) log(`Process actions: no column of definitions among the ${definitions.columns.length} given`);
  const kinds = new Map<string, number>();
  let [found, read, unnamed] = [0, 0, 0];
  const listed = processes.map((row): ProcessActions => {
    const id = Number.isSafeInteger(row.ids[0]) && row.ids[0] > 0 ? String(row.ids[0]) : "";
    const known = { id, name: row.labels[0] ?? "" };
    if (!definitions || at < 0) return { ...known, actions: [], note: PROCESS_NOTES.notRead };
    const cell = byId.get(row.ids[0])?.cells[at];
    if (cell === undefined) {
      log(`Process ${id || "?"}: not in the grid of definitions`);
      return { ...known, actions: [], note: PROCESS_NOTES.noDefinition };
    }
    found++;
    const { actions: steps, note } = readProcessDefinition(cell, names);
    if (note !== undefined) {
      log(`Process ${id || "?"}: ${note === PROCESS_NOTES.noDefinition ? "the definition is empty" : "the definition is not one Cardigan knows"}`);
      return { ...known, actions: [], note };
    }
    read++;
    for (const step of steps) {
      const word = /^[A-Z][A-Z_]{0,29}$/.test(step.type) ? step.type : step.type === "" ? "none" : "?";
      kinds.set(word, (kinds.get(word) ?? 0) + 1);
      if (!names.has(step.id)) unnamed++;
    }
    return { ...known, actions: steps };
  });
  const runs = [...kinds.values()].reduce((sum, count) => sum + count, 0);
  const where = !definitions ? "the model gave no grid of definitions" : at < 0 ? "the grid has no column of definitions" : `${found} found in the grid of definitions`;
  const what = `${runs} ${runs === 1 ? "action" : "actions"}${kinds.size ? `: ${[...kinds].map(([kind, count]) => `${kind} ×${count}`).join(", ")}` : ""}`;
  log(`Process actions: ${read} of ${processes.length} read; ${what}${unnamed ? `, ${unnamed} not in the Actions list` : ""}; ${where}`);
  return listed;
}
