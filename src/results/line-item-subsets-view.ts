import { splitOutside, unquote } from "../map/graph-names.js";
import { LINE_ITEM_SUBSETS_FILE, MEMBERSHIP_NOT_READ, MEMBERSHIP_READ, subsetModules } from "../model/line-item-subsets.js";
import type { AnalysisResult, Cell, ResultTable } from "../result-types.js";
import type { FileView } from "./result-view.js";
import { cellText, type Row } from "./table-engine.js";

export const LINE_ITEM_NAMES = "Line Item Names";
export const SUBSET_NOT_READ = "This subset's line items were not read.";

/** Keep membership names searchable while the visible column holds a number. Empty known membership
 * counts as zero; unknown membership stays blank. The captured result is left intact. */
export function lineItemSubsetsView(file: ResultTable, result: AnalysisResult): FileView {
  const headers = [...file.headers];
  const members = headers.indexOf("Line Items");
  const read = headers.indexOf(MEMBERSHIP_READ);
  const modules = headers.indexOf("Modules");
  let ids = headers.indexOf("Module IDs");
  const resolved = file.rows.map(row => subsetModules(cellText(row[ids >= 0 ? ids : modules]), result.moduleIds ?? []));
  if (ids < 0 && resolved.some(Boolean)) { ids = headers.length; headers.push("Module IDs"); }
  const names = members < 0 ? -1 : headers.length;
  if (names >= 0) headers.push(LINE_ITEM_NAMES);
  const exported = new Map<Row, ReadonlyMap<number, Cell>>();
  const rows = file.rows.map((original, index) => {
    const row = headers.map((_, index) => original[index] ?? "");
    if (resolved[index] && modules >= 0) {
      row[modules] = resolved[index]!.names.join(", ");
      row[ids] = resolved[index]!.ids;
    }
    if (members >= 0) {
      const selected = splitOutside(cellText(original[members]));
      row[names] = selected.map(member => splitOutside(member, ".").map(unquote).join(".")).join(", ");
      row[members] = read >= 0 && original[read] === "false" ? "" : selected.length;
      exported.set(row, new Map([[members, original[members]]]));
    }
    return row;
  });
  return { table: { ...file, headers, rows }, exported, ...(members < 0 ? { note: MEMBERSHIP_NOT_READ } : {}) };
}

export interface SubsetGroup {
  module: string;
  /** The item's place in Line Item Names, which also identifies its details link. */
  items: { name: string; index: number }[];
}
export interface SubsetView { groups: SubsetGroup[]; count?: number; namesColumn: number; members: string[] }

/** Group selected members in the model's module order and each module's line item order. Unmatched
 * names follow the known ones, keeping the membership grid's order. */
export function subsetOfRow(result: AnalysisResult | undefined, table: ResultTable, row: Row, exported?: ReadonlyMap<number, unknown>): SubsetView | undefined {
  if (result?.kind !== "model" || table.file !== LINE_ITEM_SUBSETS_FILE) return undefined;
  const namesColumn = table.headers.indexOf(LINE_ITEM_NAMES);
  const read = table.headers.indexOf(MEMBERSHIP_READ);
  if (namesColumn < 0 || !exported?.has(table.headers.indexOf("Line Items")) || (read >= 0 && row[read] === "false")) return { groups: [], namesColumn, members: [] };
  const groups = new Map<string, SubsetGroup>();
  const members = splitOutside(cellText(exported?.get(table.headers.indexOf("Line Items"))));
  members.forEach((member, index) => {
    const parts = splitOutside(member, ".").map(unquote);
    const module = parts.length === 2 ? parts[0] : "Module not read";
    const group = groups.get(module) ?? { module, items: [] };
    group.items.push({ name: parts.length === 2 ? parts[1] : unquote(member), index });
    groups.set(module, group);
  });
  const modules = result.tables.find(table => table.file === "Modules.csv");
  const order = new Map((modules?.rows.length ? modules.rows.map(row => cellText(row[0])) : result.moduleIds?.map(([name]) => name) ?? []).map((name, index) => [name, index]));
  const items = result.tables.find(table => table.file === "Line Items.csv");
  const moduleColumn = items?.headers.indexOf("Module Name") ?? -1;
  const itemOrder = new Map<string, Map<string, number>>();
  for (const [index, item] of (items?.rows ?? []).entries()) {
    const module = cellText(item[moduleColumn]);
    const ranked = itemOrder.get(module) ?? new Map<string, number>();
    ranked.set(cellText(item[0]), index);
    itemOrder.set(module, ranked);
  }
  const sorted = [...groups.values()].sort((a, b) => (order.get(a.module) ?? order.size) - (order.get(b.module) ?? order.size));
  for (const group of sorted) {
    const ranked = itemOrder.get(group.module);
    group.items.sort((a, b) => (ranked?.get(a.name) ?? Infinity) - (ranked?.get(b.name) ?? Infinity));
  }
  return { groups: sorted, count: members.length, namesColumn, members };
}
