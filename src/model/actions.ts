import type { Grid, GridRow, LabelEntry, Table } from "./grid.js";

/** The Actions list (Model settings → Actions) split at its headings, Processes, Imports, Exports and Other Actions, with
 * its imports merged into the Imports tab (asked for by the user, 28 Sep 2026). */

const [IMPORT, EXPORT, PROCESS] = [112, 116, 118];

export type ActionKind = "heading" | "process" | "import" | "export" | "other";

/** Imports, exports and processes by entity type. The headings are the rows that are no action and hold no values; every
 * other row sits under Other Actions (bulk copy, delete by selection, order hierarchy, optimizer and so on). */
export function actionKind(entityType: number, isAction: boolean, hasValues: boolean): ActionKind {
  if (entityType === PROCESS) return "process";
  if (entityType === IMPORT) return "import";
  if (entityType === EXPORT) return "export";
  return isAction || hasValues ? "other" : "heading";
}

/** What the split files must keep, as Anaplan's own export of the Actions list has it: the processes that use each action,
 * its notes and its last run. */
const ACTION_COLUMNS: readonly [label: string, pattern: RegExp][] = [
  ["Used in Processes", /^used in processes$/i], ["Notes", /^notes$/i], ["Start Date and Time (UTC)", /^start date/i]];

export function missingActionColumns(labels: readonly string[]): string[] {
  return ACTION_COLUMNS.filter(([, pattern]) => !labels.some(label => pattern.test(label.trim()))).map(([label]) => label);
}

/** Imports.csv: the Imports tab (each import's source and target), then the same import's columns from the Actions list
 * (last run, duration, notes, Used in Processes, Used in Dashboards), matched on the import's ID. The Actions list's own
 * Action column ("Import into 'P1 Category'") is left out: Target Object and Target Type say the same. */
export function mergeImports(tab: Grid, actions?: { columns: readonly LabelEntry[]; rows: readonly GridRow[] }): { table: Table; matched: number } {
  const columns = (actions?.columns ?? []).map((column, index) => ({ label: column.labels[0] ?? "", index }))
    .filter(({ label }) => !/^action$/i.test(label.trim()));
  const byId = new Map((actions?.rows ?? []).map(row => [row.ids[0], row]));
  const actionCells = (row: GridRow | undefined) => columns.map(({ index }) => row?.cells[index] ?? "");
  const matched = new Set<GridRow>();
  const rows = tab.rows.map(row => {
    const action = byId.get(row.ids[0]);
    if (action) matched.add(action);
    return [row.labels[0] ?? "", ...row.cells, ...actionCells(action)];
  });
  // An import the Actions list has but the Imports tab did not return still gets its row.
  for (const action of actions?.rows ?? []) {
    if (!matched.has(action)) rows.push([action.labels[0] ?? "", ...tab.columns.map(() => ""), ...actionCells(action)]);
  }
  return { table: { headers: ["", ...tab.columns.map(column => column.labels[0] ?? ""), ...columns.map(({ label }) => label)], rows }, matched: matched.size };
}
