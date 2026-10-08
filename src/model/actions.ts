import { gridTable, type Grid, type GridRow, type LabelEntry, type Table } from "./grid.js";

/** The Actions list (Model settings → Actions) split at its headings, Processes, Imports, Exports and Other Actions, with
 * its imports merged into the Imports tab (asked for by the user, 28 Sep 2026), and with the name of the list each of the
 * other actions names beside it (asked for by the user, 7 Oct 2026). */

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

/** One column after the Actions list's own, in Other Actions.csv. An action that deletes from a list using a selection,
 * or orders a list, names the list only by its ID in its Action cell (`"hierarchyIdentifier":"_101000000007_"` beside
 * `"actionType":"DELETE_BY_SELECTION"`), where Anaplan's own Actions list says the list's name ("Delete from Products
 * using Selection"). Each general list's ID is its own row's entity ID in the General Lists grid, so the name comes from
 * there, as the Format List column of Line Items names a list format's list (lineitems.ts): it is that table's name for
 * the list. The column is Other Actions' alone: actions of those two kinds are other actions, and the results page says
 * no process or export with a list's name.
 *
 * An ID that is no row of the General Lists grid is not named, whatever it is the ID of: the classic client looks an
 * action's list up among the list subsets and the line item subsets as well (results/readable-cells.ts `CellNames`), and
 * neither is a row of that grid. No ID is named when that grid was not read. The cell is then blank: never a guess, and
 * never the ID, which the Action cell holds. */
export const ACTION_LIST_COLUMN = "Action List";

/** The kinds of action whose definition names a list by its ID in `hierarchyIdentifier`: Delete from List using
 * Selection and Order List, whose labels the Actions grid says with the list's name in the place of the word List. They
 * are the kinds the results page says so (results/readable-cells.ts `NAMES_A_LIST`). Another kind's definition may carry
 * an ID in that field as well: it is not read, as the page does not read it, so that the column names a list exactly
 * where the page's words for the action name one. */
const NAMES_A_LIST: ReadonlySet<string> = new Set(["DELETE_BY_SELECTION", "ORDER_HIERARCHY"]);

/** The definition an Action cell holds as JSON, or nothing for a cell that holds none, as the results page tells one
 * (results/readable-cells.ts `definitionOf`): a blank, a name, an import's "Import into …", or JSON cut short. */
function actionDefinition(cell: unknown): { actionType?: unknown; hierarchyIdentifier?: unknown } | undefined {
  if (typeof cell !== "string" || !/^\s*\{/.test(cell)) return undefined;
  try {
    return JSON.parse(cell) as { actionType?: unknown; hierarchyIdentifier?: unknown };
  } catch {
    return undefined;
  }
}

/** Other Actions.csv: the rows of the Actions list that `keep` takes, laid out as Anaplan exports the list (grid.ts
 * `gridTable`), plus the name of the list each action names, by the rows of `lists`, the General Lists grid (blank for an
 * action that names none, for an ID that grid does not hold, and in every row without the grid). The table `gridTable`
 * gives is left as it is: the column is added to new rows. */
export function otherActionsTable(actions: Grid, keep: (row: GridRow) => boolean, lists?: Grid): Table {
  const table = gridTable(actions, keep);
  const action = table.headers.indexOf("Action");
  const listNames = new Map<number, string>();
  for (const row of lists?.rows ?? []) if (Number.isFinite(row.ids[0])) listNames.set(row.ids[0], row.labels[0] ?? "");
  /** The list an action of one of those kinds names. Its definition holds the ID between underscores; as a number, or as
   * digits alone, it is the same ID (the results page reads it so too, results/readable-cells.ts `idOf`). An ID of more
   * digits than a number holds exactly is not looked up: it could be found under another ID's number. The rule is the
   * one Format List names a list format's list by (lineitems.ts). */
  const listName = (cell: unknown): string => {
    const definition = actionDefinition(cell);
    const kind = definition?.actionType;
    if (typeof kind !== "string" || !NAMES_A_LIST.has(kind)) return "";
    const identifier = definition?.hierarchyIdentifier;
    const id = typeof identifier === "number" ? String(identifier) : typeof identifier === "string" ? identifier.replace(/^_+|_+$/g, "") : "";
    return /^\d+$/.test(id) && Number.isSafeInteger(Number(id)) ? listNames.get(Number(id)) ?? "" : "";
  };
  return { headers: [...table.headers, ACTION_LIST_COLUMN], rows: table.rows.map(cells => [...cells, action > 0 ? listName(cells[action]) : ""]) };
}
