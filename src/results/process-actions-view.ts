import { readProcessActions } from "../result-plain.js";
import { POLARIS_STEPS_NOTE } from "../polaris.js";
import type { AnalysisResult, ProcessStep, ResultTable } from "../result-types.js";
import { cellLists } from "./cell-lists.js";
import { columnIndex } from "./columns.js";
import { cellText, type Row } from "./table-engine.js";

/** The actions a process runs, as the details of its row of a model's Processes show them, under All columns: each action
 * with its kind, in the order the process runs them, as the process's own definition holds them (model/process-actions.ts).
 * Where the result does not have them, because the definitions could not be read or an earlier version kept the result,
 * the details list instead the actions whose Used in Processes names the process, as the Actions list says it, and say
 * that the order they run in is not known: Anaplan's grids of the actions say which processes use each, not when. */

/** The files of the Actions list, by the names model/export.ts writes them under. They are named here, and not taken from
 * result-view.ts, which reads this module for the Processes table's Actions column. */
const PROCESSES_FILE = "Processes.csv";
const IMPORTS_FILE = "Imports.csv";
const EXPORTS_FILE = "Exports.csv";
const OTHER_ACTIONS_FILE = "Other Actions.csv";
/** The column of each action's processes, as Anaplan's grid of the actions names it. */
const USED_IN_PROCESSES = "Used in Processes";

/** Each kind of action a process runs, by the definition's word for it: what the details call it, and the table that
 * lists such actions. A word not here is said as it is, in no table. */
const KINDS: ReadonlyMap<string, { words: string; file: string }> = new Map([
  ["IMPORT", { words: "Import", file: IMPORTS_FILE }], ["EXPORT", { words: "Export", file: EXPORTS_FILE }],
  ["ACTION", { words: "Other action", file: OTHER_ACTIONS_FILE }], ["PROCESS", { words: "Process", file: PROCESSES_FILE }]]);
/** The tables whose actions a process may run, in the navigation's order, each with what the details call its actions. */
const ACTION_FILES: readonly [file: string, words: string][] = [[IMPORTS_FILE, "Import"], [EXPORTS_FILE, "Export"], [OTHER_ACTIONS_FILE, "Other action"]];

/** One action as the details list it: its name, its kind in words, and the table whose rows it is among, where the page
 * may find its row there by its name. */
export interface StepView { name: string; kind: string; file?: string }

/** A process's actions as the details show them: in the order the process runs them where `ordered`, then lines under
 * them, about why the order is not known or why there is none to show. */
export interface ProcessView { steps: StepView[]; ordered: boolean; lines: string[]; countKnown?: false }

/** What the details say under the actions where the result has no process's own, by why. */
export const PROCESS_LINES = {
  unordered: "These are the actions whose Used in Processes names this process, by kind, as their tables list them. The order the process runs them in is not known.",
  earlier: "Choose Run again to read the order the process runs its actions in.",
  none: "This process runs no action.",
  noneUsed: "No action's Used in Processes names this process.",
} as const;

/** An action out of the process's definition, as the details list it. */
function stepView(step: ProcessStep): StepView {
  const kind = KINDS.get(step.type);
  return kind ? { name: step.name, kind: kind.words, file: kind.file } : { name: step.name, kind: step.type.trim() === "" ? "Not said" : step.type };
}

/** For every process an action's Used in Processes names, the actions that name it, by kind, each table in its rows'
 * order: Imports, then Exports, then Other Actions. A cell lists its processes as the drawer lists it (cell-lists.ts): cut
 * into the names of the Processes table's rows where it names several, and whole where it does not. Each table is read
 * once, whatever number of processes is asked about. Names are told apart without the spaces around them. */
function usedInAll(result: AnalysisResult): ReadonlyMap<string, StepView[]> {
  const byProcess = new Map<string, StepView[]>();
  for (const [file, words] of ACTION_FILES) {
    const table = result.tables.find(candidate => candidate.file === file);
    const at = table && columnIndex(table, USED_IN_PROCESSES);
    if (!table || at === undefined) continue;
    const list = cellLists(result, table).get(at);
    for (const row of table.rows) {
      const text = cellText(row[at]);
      for (const name of new Set((list?.(text, row) ?? [text]).map(each => each.trim()))) {
        if (name === "") continue;
        const steps = byProcess.get(name);
        const step = { name: cellText(row[0]), kind: words, file };
        if (steps) steps.push(step);
        else byProcess.set(name, [step]);
      }
    }
  }
  return byProcess;
}

/** The actions whose Used in Processes names the process `name`, as `usedInAll` finds them. */
const usedIn = (result: AnalysisResult, name: string): StepView[] => usedInAll(result).get(name) ?? [];

/** The actions of the process a row of a model's Processes is, or none for any other row and for an app's result. The
 * Processes table has no column of IDs, so the row's process is the one of its name, as the result lists the processes;
 * among processes of one name, the one in the row's place among them, as the export lists them in the Actions list's
 * order, which the table keeps. `table` is the Processes table as the page shows it. */
export function processOfRow(result: AnalysisResult | undefined, table: ResultTable, row: Row): ProcessView | undefined {
  if (result?.kind !== "model" || table.file !== PROCESSES_FILE) return undefined;
  if (result.engine === "polaris") return { steps: [], ordered: false, lines: [POLARIS_STEPS_NOTE], countKnown: false };
  // Names are told apart without the spaces around them, on both sides alike.
  const name = cellText(row[0]).trim();
  const at = table.rows.findIndex(candidate => candidate === row);
  const place = table.rows.slice(0, Math.max(0, at)).filter(other => cellText(other[0]).trim() === name).length;
  const processes = readProcessActions(result.processActions);
  const process = processes?.filter(each => each.name.trim() === name)[place];
  if (process && process.note === undefined) {
    return { steps: process.actions.map(stepView), ordered: true, lines: process.actions.length ? [] : [PROCESS_LINES.none] };
  }
  // What is listed, then why it is not the process's own list: its definition could not be read, or the result, kept by an
  // earlier version or by none that read this process, has none of it.
  const steps = usedIn(result, name);
  return { steps, ordered: false, lines: [steps.length ? PROCESS_LINES.unordered : PROCESS_LINES.noneUsed, process?.note ?? PROCESS_LINES.earlier] };
}

/** For each row of a model's Processes file, in its order, the names of the actions the process runs: the actions its
 * details list (`processOfRow`), in the order it runs them where the result has that order, and otherwise those whose
 * Used in Processes names it. The Processes table shows them in its Actions column (result-view.ts). A row is its process
 * as `processOfRow` finds one: by its name, and among processes of one name by its place among them. The result's
 * processes and the actions' tables are read once for the whole file. */
export function actionNamesByRow(result: AnalysisResult, table: ResultTable): string[][] {
  const processes = readProcessActions(result.processActions);
  let used: ReadonlyMap<string, StepView[]> | undefined;
  const seen = new Map<string, number>();
  return table.rows.map(row => {
    const name = cellText(row[0]).trim();
    const place = seen.get(name) ?? 0;
    seen.set(name, place + 1);
    const process = processes?.filter(each => each.name.trim() === name)[place];
    if (process && process.note === undefined) return process.actions.map(step => step.name);
    used ??= usedInAll(result);
    return (used.get(name) ?? []).map(step => step.name);
  });
}
