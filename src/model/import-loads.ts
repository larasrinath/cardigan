import { readsFile, SOURCE_TYPE } from "../file-imports.js";
import { unquote } from "../map/graph-names.js";
import type { ImportLoad } from "../map/graph-types.js";
import { textOf } from "../result-plain.js";
import type { Cell, ImportMapping, ResultTable } from "../result-types.js";

/** What each import of a model loads into a module's line items, as its saved mapping says it: worked out from the Imports
 * table and the mappings the run kept (result-types.ts `ImportMapping`), and from nothing else. Unused Line Items
 * (unused.ts) counts a line item an import loads as imported, and the map's source inputs (map/map-sources.ts) say which
 * imports load an input, both from this.
 *
 * An import loads what its mapping says, whatever its source: its line item targets, its constant into Line Items, and its
 * headers mapped manually. Where its line items come from a column, or from the header row matched by name when it runs,
 * it can load any of the module's line items. So can an import whose mapping is not known: it could not be read, or a
 * result an earlier version kept has none for an import from a model. Any line item is every line item of the module that
 * holds data and has no formula, which an import can load; each reader picks those out of its own line items. An import's
 * mapping is found as the results page finds it (results/import-mapping-view.ts `mappingOfRow`): by its name, in its place
 * among the imports of that name and Source Type. An import into a list, or of anything but module data, loads no line item. */

/** The kind of import that loads a module's line items (import-mappings.ts `MODULE_DATA`). */
const MODULE_DATA = "MODULE_DATA";
/** The words a mapping has for the line items as a dimension, and for the values of the line item each row names
 * (import-mappings.ts `targetOf`). */
const LINE_ITEMS_TARGET = "Line Items";
const VALUE_TARGET = "Value";

const cellText = (cell: Cell | undefined): string => (cell === undefined || cell === null ? "" : textOf(cell));

export type { ImportLoad };

/** Each import of the Imports table that loads a module, in the table's order, with what it loads there (graph-types.ts
 * `ImportLoad`, the shape the map takes them in). `isModule` says
 * whether a name is a module's, for a row whose Target Type says neither module nor list. */
export function importLoads(imports: ResultTable | undefined, mappings: readonly ImportMapping[] | undefined, isModule: (name: string) => boolean): ImportLoad[] {
  if (!imports) return [];
  const cell = (row: readonly Cell[], header: string): string => {
    const index = imports.headers.indexOf(header);
    return index < 0 ? "" : cellText(row[index]);
  };
  const loads: ImportLoad[] = [];
  const taken = new Map<string, number>();
  for (const row of imports.rows) {
    // The mapping of an import of this name and Source Type, in its place among those: every import is counted, whatever it
    // loads, as the mappings are listed for every one.
    const kind = cell(row, SOURCE_TYPE).trim().toUpperCase();
    const file = readsFile(cell(row, SOURCE_TYPE));
    const name = cellText(row[0]).trim();
    const key = `${kind}\n${name}`;
    const place = taken.get(key) ?? 0;
    if (kind !== "") taken.set(key, place + 1);
    const module = unquote(cell(row, "Target Object")).trim();
    const type = cell(row, "Target Type").toLowerCase().split(/[^a-z]+/);
    if (!(type.includes("module") || (type.every(word => word === "") && isModule(module)))) continue;
    const mapping = kind === "" ? undefined
      : mappings?.filter(each => each.name.trim() === name && (each.sourceType ?? "FILE").trim().toUpperCase() === kind)[place];
    if (!mapping || mapping.note !== undefined) {
      loads.push({ name, module, lineItems: [], any: true, unread: file || (mappings?.some(each => each.sourceType !== undefined) ?? false) });
      continue;
    }
    if (mapping.importType !== MODULE_DATA) continue;
    const lineItems: string[] = [];
    let any = false;
    const into = (lineItem: string | undefined): void => {
      if (lineItem !== undefined) lineItems.push(lineItem);
    };
    for (const target of mapping.targets) {
      if (target.source === "ignore" || target.source === "none") continue;
      if (target.target === LINE_ITEMS_TARGET) {
        if (target.source === "constant") into(target.text);
        else if (!(target.source === "headerRow" && mapping.headers?.length)) any = true;
      } else if (target.target !== VALUE_TARGET) into(target.target);
    }
    for (const header of mapping.headers ?? []) into(header.lineItem);
    loads.push({ name, module, lineItems, any, unread: false });
  }
  return loads;
}
