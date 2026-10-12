import type { Log, Stop } from "../progress.js";
import { message, seconds } from "../util.js";
import { gridTable, type Grid, type Table } from "./grid.js";
import { axis, readGrid, type Native } from "./native.js";

export const LINE_ITEM_SUBSETS = "Line Item Subsets";
export const LINE_ITEM_SUBSETS_FILE = `${LINE_ITEM_SUBSETS}.csv`;
export const MEMBERSHIP_NOT_READ = "Line item membership was not read. The diagnostic log says why.";
export const MEMBERSHIP_READ = "Membership read";

/** Resolve an ID cell with the pairs already read by the export. Older grids may give names directly. */
export function subsetModules(value: string, modules: readonly (readonly [name: string, id: string])[]): { names: string[]; ids: string; unknown: string[] } | undefined {
  const ids = value.split(",").map(id => id.trim());
  if (!ids.length || ids.some(id => !/^\d+$/.test(id))) return undefined;
  const byId = new Map(modules.map(([name, id], order) => [id, { name, order }]));
  const ordered = [...new Set(ids)].sort((a, b) => (byId.get(a)?.order ?? modules.length) - (byId.get(b)?.order ?? modules.length));
  return { names: ordered.map(id => byId.get(id)?.name || id), ids: value, unknown: ordered.filter(id => !byId.get(id)?.name) };
}

/** The client's tabs/Settings._getLineItemSubsetsViewDefinition uses LINE_ITEM_SUBSET against
 * LINE_ITEM_SUBSET_PROPERTY. Read every returned property with its own heading. Its membership view
 * (Settings._getViewDefinition for entity type 114) uses MODULE_WITH_LINE_ITEM against LINE_ITEM_SUBSET,
 * with one subset as static context. The context-free matrix does not give membership. No editor,
 * cache update or system action is involved. Where the model refused rows of the subsets' own grid, which is read
 * without them (native.ts `readGrid`), that grid comes back as `refused`, for the export's note on it; a membership grid
 * read without some rows gives its subset the members it holds, and the log names the rows. */
export async function readLineItemSubsets(native: Native, log: Log, stop?: Stop, modules: readonly (readonly [string, string])[] = []): Promise<{ table: Table; note?: string; refused?: Grid }> {
  const definitions = await readGrid(native, axis(native, "LINE_ITEM_SUBSET"), axis(native, "LINE_ITEM_SUBSET_PROPERTY"), LINE_ITEM_SUBSETS, log, undefined, false, stop);
  const refused = definitions.refused ? { refused: definitions } : {};
  const table = gridTable(definitions);
  const moduleColumn = table.headers.indexOf("Modules");
  const moduleCells = table.rows.map(row => row[moduleColumn] ?? "");
  if (moduleColumn >= 0) {
    const resolved = table.rows.map(row => subsetModules(row[moduleColumn] ?? "", modules));
    if (resolved.some(Boolean)) {
      table.headers.push("Module IDs");
      table.rows.forEach((row, index) => {
        row.push(resolved[index]?.ids ?? "");
        if (resolved[index]) row[moduleColumn] = resolved[index]!.names.join(", ");
      });
      for (const id of new Set(resolved.flatMap(value => value?.unknown ?? []))) log(`${LINE_ITEM_SUBSETS}: module ID ${id} has no name; kept as ID`);
    }
  }
  if (!definitions.rows.length) return { table, ...refused };
  const started = Date.now();
  const items: (string | undefined)[] = [];
  let empty = 0;
  for (const [index, subset] of definitions.rows.entries()) {
    stop?.throwIfAborted();
    if (moduleColumn >= 0 && !moduleCells[index].trim()) {
      items.push("");
      empty++;
      continue;
    }
    const id = subset.ids[0];
    try {
      if (typeof native.ids?.entityLongIdToEntityLongIdIdentifier !== "function") {
        throw new Error("the model page has no entityLongIdToEntityLongIdIdentifier helper");
      }
      if (!Number.isSafeInteger(id) || id <= 0) throw new Error("subset ID missing or invalid");
      const context = native.ids.entityLongIdToEntityLongIdIdentifier(id);
      if (typeof context !== "string" || !context) throw new Error("the model page returned no subset identifier");
      const membership = await readGrid(native, axis(native, "MODULE_WITH_LINE_ITEM"), axis(native, "LINE_ITEM_SUBSET"),
        `${LINE_ITEM_SUBSETS} membership: subset ${id}`, log, undefined, false, stop, [context]);
      items.push(subsetLineItems({ ...definitions, rows: [subset] }, membership, log)[0]);
    } catch (error) {
      stop?.throwIfAborted();
      log(`${LINE_ITEM_SUBSETS} membership: subset ${id} not read (${message(error)})`);
      items.push(undefined);
    }
  }
  stop?.throwIfAborted();
  // Compare the original Modules cells, before IDs were replaced by display names. Module order is
  // irrelevant to this diagnostic; the membership data is kept exactly as read.
  const matching = new Map<string, { ids: number[]; modules: Set<string> }>();
  items.forEach((members, index) => {
    if (!members || moduleColumn < 0) return;
    const group = matching.get(members) ?? { ids: [], modules: new Set<string>() };
    group.ids.push(definitions.rows[index].ids[0]);
    const modules = moduleCells[index].split(",").map(id => id.trim());
    group.modules.add(JSON.stringify([...new Set(modules)].sort()));
    matching.set(members, group);
  });
  for (const group of matching.values()) {
    if (group.modules.size > 1) log(`${LINE_ITEM_SUBSETS} membership: subsets ${group.ids.join(", ")} have different Modules but identical non-empty member lists`);
  }
  const column = table.headers.includes("Line Items") ? table.headers.indexOf("Line Items") : table.headers.push("Line Items") - 1;
  table.rows.forEach((row, index) => { row[column] = items[index] ?? ""; });
  const missing = items.filter(items => items === undefined).length;
  if (missing) {
    table.headers.push(MEMBERSHIP_READ);
    table.rows.forEach((row, index) => row.push(String(items[index] !== undefined)));
  }
  const read = items.length - missing - empty;
  const subsets = (count: number): string => `${count} ${count === 1 ? "subset" : "subsets"}`;
  log(`${LINE_ITEM_SUBSETS} membership: ${subsets(read)} read${empty ? `; ${subsets(empty)} without Modules (no read)` : ""}${missing ? `; ${subsets(missing)} not read` : ""} in ${seconds(Date.now() - started)}`);
  return { table, ...(missing === items.length ? { note: MEMBERSHIP_NOT_READ } : {}), ...refused };
}

/** Match by subset ID, never by a possibly repeated label. A module's own row is a heading, not a
 * member. Only true cells select line items, whatever their case or spaces; an empty cell is simply not
 * selected, and any other value is counted in the log. An absent or ambiguous column affects only its
 * subset; an odd row or value never cancels the read. Quotes preserve dots,
 * commas and apostrophes in either name when the details resolve Module.Line Item. */
export function subsetLineItems(definitions: Grid, membership: Grid, log: Log = () => undefined): (string | undefined)[] {
  const quote = (name: string): string => `'${name.replaceAll("'", "''")}'`;
  const unrecognised = new Map<string, number>();
  let skipped = 0;
  let heading = "";
  const rows = membership.rows.flatMap(row => {
    const id = row.ids[0];
    if (!Number.isSafeInteger(id) || id <= 0 || Math.floor(id / 1e9) === 102) {
      heading = Math.floor(id / 1e9) === 102 ? row.labels[0] || "" : row.labels[1] || row.labels[0] || "";
      return [];
    }
    const module = row.labels[1] || heading;
    if (!module || !row.labels[0]) { skipped++; return []; }
    return [{ row, name: `${quote(module)}.${quote(row.labels[0])}` }];
  });
  const items = definitions.rows.map(subset => {
    const id = subset.ids[0];
    const columns = membership.columns.flatMap((column, index) => column.ids[0] === id ? [index] : []);
    if (!Number.isSafeInteger(id) || id <= 0 || columns.length !== 1) {
      log(`${LINE_ITEM_SUBSETS} membership: subset ${id} not read (${columns.length === 0 ? "column missing" : "column not identified once"})`);
      return undefined;
    }
    const items: string[] = [];
    for (const { row, name } of rows) {
      const value: unknown = row.cells[columns[0]];
      const said = value === undefined || value === null ? "" : String(value).trim().toLowerCase();
      if (said === "true") items.push(name);
      else if (said !== "false" && said !== "") {
        const raw = JSON.stringify(value) ?? String(value);
        unrecognised.set(raw, (unrecognised.get(raw) ?? 0) + 1);
      }
    }
    return items.join(", ");
  });
  if (unrecognised.size) {
    const total = [...unrecognised.values()].reduce((sum, count) => sum + count, 0);
    const examples = [...unrecognised].slice(0, 3).map(([value, count]) => `${value} ×${count}`).join(", ");
    log(`${LINE_ITEM_SUBSETS} membership: ${total} cells with an unrecognised value (${examples}), taken as not in the subset`);
  }
  if (skipped) log(`${LINE_ITEM_SUBSETS} membership: ${skipped} rows without a line item name or module skipped`);
  return items;
}
