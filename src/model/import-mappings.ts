import { readsFile, SOURCE_TYPE } from "../file-imports.js";
import type { Log } from "../progress.js";
import type { ImportMapping, MappedSource, MappedTarget } from "../result-types.js";
import { plainText, type Grid, type GridRow } from "./grid.js";
import type { Native } from "./native.js";

/** The mapping of each import from a file, out of the import's own definition: the JSON that Anaplan's import dialog reads
 * and saves (anaplan/view/ImportDefinition.js), which the Model settings grid of the imports against their properties
 * holds in the column of SYSTEM_PROPERTY_IMPORT_DEFINITION. The export reads that grid as it reads the others (native.ts
 * `readGrid`), with the dialog's own axes, IMPORT_ALL against IMPORT_PROPERTY: one view, read, and nothing saved. The
 * dialog's way to a file's columns, the system action GET_IMPORT_SOURCE_FIELDS, is never sent: it may store what it is
 * given. So the file itself is never asked for, and an import whose file is no longer available keeps its mapping: the
 * mapping is the import's.
 *
 * A definition is written by the dialog (anaplan/widgets/Mapping.js, view/ImportDefinitionModuleMapping.js,
 * view/LineItemImportMapper.js, view/ImportDefinitionHierarchyMapping.js) as
 * `{"importType":"MODULE_DATA","target":"_102000000001_","mappings":[…],…}`, with one mapping for each target:
 * `{"targetType":"moduleDimension","target":"_101000000001_","sourceType":"column","sourceColumnId":"#1","sourceColumnName":"Product"}`.
 * - `targetType` says what the target is. Into a module: a dimension (`moduleDimension`: a list, Time, Versions, or the
 *   line items, whose target is blank) or a line item (`moduleLineItem`; a blank target is the value of the line item
 *   each row names). Into a list: the list's items (`hierarchyMemberEntityName`) or a property (`hierarchyProperty`:
 *   Parent, Code, or one of the list's own).
 * - `sourceType` says what feeds it: `column`, `constant`, `prompt`, `ignore`, `headerRow` (the line items are the
 *   file's headings, each mapped to its column by a line item's own mapping) or `undefined` (nothing).
 * - A column is `sourceColumnId` ("#3", counted from 1), or `sourceColumnNumber` (counted from 0, a number or digits),
 *   with its heading as `sourceColumnName` where the dialog kept it; a line item's mapping can name its column by the
 *   heading alone. A constant is `sourceValueLabel`, or `sourceValue`, the identifier of a list's item.
 * The definition holds no list of the file's columns: Anaplan keeps the file's own settings (its separator, its header
 * row) apart, and never its columns. So which columns after the last one mapped the file has is not known.
 *
 * The words for a target are Anaplan's, as the dialog's `_getTargetLabel` gives them, where they are names; the lines and
 * the page's words are said where the dialog has none ("Time", "Line Items"). Every name is the model's own, out of a
 * grid the export has read or the model page's own lists of names: nothing more is read for them. */

/** SYSTEM_PROPERTY_IMPORT_DEFINITION (anaplan/constants.js): the grid's column that holds each import's definition. */
export const IMPORT_DEFINITION = 4000001300;
/** MODEL_CONTENT_TIMESCALE_ENTITY_LONG_ID and MODEL_CONTENT_VERSION_ENTITY_LONG_ID: Time and Versions as a module's
 * dimensions. */
const TIME = 9000000001;
const VERSIONS = 9000000002;
/** The properties of a list with a name of the dialog's own (anaplan/nls/mapping `labelHierarchyParent` and
 * `labelHierarchyCode`): SYSTEM_PROPERTY_PARENT and SYSTEM_PROPERTY_CODE. */
const PROPERTY_WORDS: ReadonlyMap<number, string> = new Map([[4000000001, "Parent"], [4000000004, "Code"]]);
/** The kinds of import whose mapping is listed: into a module, and into a list. Another kind (users, versions, line items
 * into a module's blueprint) says what it loads instead (results/import-mapping-view.ts). */
export const MODULE_DATA = "MODULE_DATA";
export const HIERARCHY_DATA = "HIERARCHY_DATA";
/** What feeds a target, by the definition's word for it. A word not here is a source of another kind. */
const SOURCES: ReadonlyMap<string, MappedSource> = new Map([["column", "column"], ["constant", "constant"], ["prompt", "prompt"], ["ignore", "ignore"],
  ["headerRow", "headerRow"], ["undefined", "none"]]);

/** What the page says of an import whose mapping could not be read, by why. No word of it names a file: the page says none. */
const NOT_READ = "Cardigan could not read this import's mapping";
export const MAPPING_NOTES = {
  notRead: `${NOT_READ}: the model did not give the imports' definitions. The diagnostic log says why.`,
  noDefinition: `${NOT_READ}: the model gave no definition for it.`,
  unknown: `${NOT_READ}: its definition is not written in a way Cardigan knows.`,
} as const;

/** The names a definition's IDs are said by: the export gives them out of the grids it has read and the model page's own
 * lists of names (`importNames`). An ID that none of them names is said as an ID. */
export interface ImportNames {
  /** A list or a list subset: a module's dimension, or the list an import loads into. */
  list(id: number): string | undefined;
  /** A line item of the module an import loads into. */
  lineItem(id: number, module: number): string | undefined;
  /** A property of the list an import loads into. */
  property(id: number, list: number): string | undefined;
}

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);
const named = (value: unknown): value is string => typeof value === "string" && value.trim() !== "";

/** An entity's ID out of an identifier as a definition writes it (`_101000000007_`), or out of a number: NaN for anything
 * else, as the client's own reading of one gives (anaplan/utils/EntityLongIdHelper.js
 * `entityLongIdIdentifierToEntityLongId`). An ID of more digits than a number holds exactly is no ID here. */
function idOf(value: unknown): number {
  if (typeof value === "number") return Number.isSafeInteger(value) ? value : NaN;
  if (typeof value !== "string") return NaN;
  const digits = value.trim().replace(/^_+|_+$/g, "");
  return /^-?\d{1,19}$/.test(digits) && Number.isSafeInteger(Number(digits)) ? Number(digits) : NaN;
}

/** An ID as the page says one the model gave no name for, as it says such a list elsewhere (readable-cells.ts). */
const asId = (id: number): string => `ID ${id}`;

/** A column's place in the file, counted from 1: `sourceColumnId` ("#3") counts from 1, `sourceColumnNumber` from 0. */
function columnOf(mapping: Json): number | undefined {
  const id = typeof mapping.sourceColumnId === "string" ? /^#(\d{1,6})$/.exec(mapping.sourceColumnId.trim()) : null;
  if (id && Number(id[1]) >= 1) return Number(id[1]);
  const number = mapping.sourceColumnNumber;
  const place = typeof number === "number" ? number : typeof number === "string" && /^\d{1,6}$/.test(number.trim()) ? Number(number) : NaN;
  return Number.isSafeInteger(place) && place >= 0 && place < 1e6 ? place + 1 : undefined;
}

/** A constant's value: its label, as the dialog keeps it beside the item's identifier, or else the value itself, which
 * for an item of a list is said by the item's ID. */
function constantOf(mapping: Json): string | undefined {
  if (named(mapping.sourceValueLabel)) return mapping.sourceValueLabel;
  const value = mapping.sourceValue;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (!named(value)) return undefined;
  return /^_\d+_$/.test(value.trim()) && Number.isFinite(idOf(value)) ? asId(idOf(value)) : value;
}

/** What feeds a target, as the definition says it. */
function sourceOf(mapping: Json): Pick<MappedTarget, "source" | "column" | "text"> {
  const word = mapping.sourceType;
  const source = typeof word === "string" ? SOURCES.get(word) : undefined;
  if (source === "column") {
    const column = columnOf(mapping);
    const heading = named(mapping.sourceColumnName) ? mapping.sourceColumnName : undefined;
    return { source, ...(column !== undefined ? { column } : {}), ...(heading !== undefined ? { text: heading } : {}) };
  }
  if (source === "constant") {
    const value = constantOf(mapping);
    return { source, ...(value !== undefined ? { text: value } : {}) };
  }
  if (source) return { source };
  return { source: "other", ...(named(word) ? { text: word } : {}) };
}

/** A target's name, by the kind of target and the import's kind: into a module (`into` is the module's ID) or into a list
 * (`into` is the list's ID, and `list` the list's name as the Imports tab gives it, for a list the model's names miss). */
function targetOf(mapping: Json, importType: string, into: number, names: ImportNames, list: string | undefined): string {
  const id = idOf(mapping.target);
  const known = Number.isFinite(id) && id !== -1;
  switch (mapping.targetType) {
    case "moduleDimension":
      if (!known) return "Line Items";
      if (id === TIME) return "Time";
      if (id === VERSIONS) return "Versions";
      return names.list(id) ?? asId(id);
    case "moduleLineItem":
      return known ? names.lineItem(id, into) ?? asId(id) : "Value";
    case "hierarchyMemberEntityName":
      return names.list(into) ?? list ?? "Items";
    case "hierarchyProperty":
      return known ? PROPERTY_WORDS.get(id) ?? names.property(id, into) ?? asId(id) : "Property";
    default:
      if (known) return (importType === MODULE_DATA ? names.lineItem(id, into) : names.property(id, into)) ?? names.list(id) ?? asId(id);
      return named(mapping.targetType) ? mapping.targetType : "Target";
  }
}

/** A word of a definition for the log: a key or a sourceType, when it is a short word of letters and digits, and a
 * question mark for anything else, which could be a value. */
const logWord = (value: unknown): string => (typeof value === "string" && /^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(value) ? value : "?");

/** How a definition is made, for the diagnostic log: its keys, and each mapping's keys with its sourceType, mappings made
 * alike counted together. No value is written but the sourceType: no name, no column, no constant, and no key of what
 * lies under the definition's keys (a value map's keys are the file's values). */
function shapeOf(definition: Json): string {
  const keys = Object.keys(definition).map(logWord).join(", ");
  const mappings = definition.mappings;
  if (!Array.isArray(mappings)) return `keys ${keys}; mappings is not a list`;
  const kinds = new Map<string, number>();
  for (const mapping of Array.from(mappings as unknown[])) {
    const kind = isObject(mapping) ? `[${Object.keys(mapping).map(logWord).join(", ")}] ${logWord(mapping.sourceType)}` : "not an object";
    kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
  }
  return `keys ${keys}; ${mappings.length} mappings${kinds.size ? `: ${[...kinds].map(([kind, count]) => `${kind} ×${count}`).join("; ")}` : ""}`;
}

/** An import's mapping out of its definition's text, and how the definition is made for the log. A definition that is no
 * JSON, or JSON of another make (no list of mappings, a mapping that is no object), gives the note that it could not be
 * read. One of a kind whose mapping is not listed gives no targets: the page says what it loads. */
export function readDefinition(text: string, names: ImportNames, list?: string): { mapping: Pick<ImportMapping, "importType" | "targets" | "note">; shape: string } {
  if (text.trim() === "") return { mapping: { importType: "", targets: [], note: MAPPING_NOTES.noDefinition }, shape: "no definition" };
  let definition: unknown;
  try {
    definition = JSON.parse(text);
  } catch {
    return { mapping: { importType: "", targets: [], note: MAPPING_NOTES.unknown }, shape: "the definition is not JSON" };
  }
  if (!isObject(definition)) return { mapping: { importType: "", targets: [], note: MAPPING_NOTES.unknown }, shape: "the definition is not an object" };
  const shape = shapeOf(definition);
  const importType = typeof definition.importType === "string" ? definition.importType : "";
  const mappings = definition.mappings;
  if (!Array.isArray(mappings) || !Array.from(mappings as unknown[]).every(isObject)) return { mapping: { importType, targets: [], note: MAPPING_NOTES.unknown }, shape };
  if (importType !== MODULE_DATA && importType !== HIERARCHY_DATA) return { mapping: { importType, targets: [] }, shape };
  const into = idOf(definition.target);
  const targets = (mappings as Json[]).map((mapping): MappedTarget => ({ target: targetOf(mapping, importType, into, names, list), ...sourceOf(mapping) }));
  return { mapping: { importType, targets }, shape };
}

/** The place of the Imports tab's column of that label, or -1. */
const columnAt = (grid: Grid, label: string): number => grid.columns.findIndex(column => (column.labels[0] ?? "").trim() === label);

/** The imports of the Imports tab that read a file, in the tab's order (file-imports.ts `readsFile`). */
export function fileImports(tab: Grid): GridRow[] {
  const at = columnAt(tab, SOURCE_TYPE);
  return at < 0 ? [] : tab.rows.filter(row => readsFile(row.cells[at]));
}

/** Each import of the Imports tab that reads a file, in the tab's order, with its mapping: out of its definition's cell in
 * `definitions`, the grid of the imports against their properties, in the column `column`. Without that grid, which the
 * model did not give, each says so, and so does an import the grid has no definition for: none is left out, so that the
 * page has one for each such row of the Imports table. The log has a line for each: how its definition is made. */
export function importMappings(tab: Grid, definitions: Grid | undefined, names: ImportNames, log: Log, column = IMPORT_DEFINITION): ImportMapping[] {
  const imports = fileImports(tab);
  const target = columnAt(tab, "Target Object");
  const at = definitions ? definitions.columns.findIndex(entry => entry.ids[0] === column) : -1;
  const byId = new Map((definitions?.rows ?? []).map(row => [row.ids[0], row]));
  if (definitions && at < 0) log(`Import mappings: no column of definitions among the ${definitions.columns.length} given`);
  let read = 0;
  const mappings = imports.map((row): ImportMapping => {
    const id = Number.isSafeInteger(row.ids[0]) && row.ids[0] > 0 ? String(row.ids[0]) : "";
    const known = { id, name: row.labels[0] ?? "" };
    if (!definitions || at < 0) return { ...known, importType: "", targets: [], note: MAPPING_NOTES.notRead };
    const cell = byId.get(row.ids[0])?.cells[at];
    if (cell === undefined) {
      log(`Import mapping ${id || "?"}: not in the grid of definitions`);
      return { ...known, importType: "", targets: [], note: MAPPING_NOTES.noDefinition };
    }
    try {
      const { mapping, shape } = readDefinition(cell, names, target < 0 ? undefined : row.cells[target] || undefined);
      log(`Import mapping ${id || "?"}: ${shape}`);
      if (mapping.note === undefined) read++;
      return { ...known, ...mapping };
    } catch (error) {
      log(`Import mapping ${id || "?"}: ${error instanceof Error ? error.name : "error"} while reading the definition`);
      return { ...known, importType: "", targets: [], note: MAPPING_NOTES.unknown };
    }
  });
  // The page shows the log, and no word of the page names a file: nor does this line.
  log(`Import mappings: ${read} of ${imports.length} read`);
  return mappings;
}

/** A name out of a page of names of the model page's own (anaplan/data/ModelContentCache.js): its IDs and its labels, each
 * a list, or each a list of lists whose first is the entities' own. Nothing where the page has no such page, or throws. */
function labelIn(page: () => unknown, id: number): string | undefined {
  try {
    const found = page() as { entityLongIds?: unknown; labels?: unknown } | null | undefined;
    const ids = found?.entityLongIds;
    const labels = found?.labels;
    if (!Array.isArray(ids) || !Array.isArray(labels)) return undefined;
    const [own, said] = Array.isArray(ids[0]) ? [ids[0] as unknown[], labels[0]] : [ids, labels];
    if (!Array.isArray(said)) return undefined;
    const at = own.findIndex(entry => Number(entry) === id);
    const label: unknown = at < 0 ? undefined : said[at];
    return named(label) ? plainText(label) : undefined;
  } catch {
    return undefined;
  }
}

/** The names of a model's lists and line items, by the grids the export has read: General Lists (a list's own row) and
 * Line Items (a line item's own row). For one they do not have, as a list subset, the model page's own lists of names:
 * the lists, the list subsets and a module's line items, as the dialog looks them up (anaplan/widgets/Mapping.js
 * `_lookupHierarchyLabel`), and a list's properties, which no grid of the export lists. */
export function importNames(native: Native, grids: { lists?: Grid; lineItems?: Grid }): ImportNames {
  const byId = (grid: Grid | undefined): Map<number, string> => {
    const names = new Map<number, string>();
    for (const row of grid?.rows ?? []) if (Number.isSafeInteger(row.ids[0]) && named(row.labels[0]) && !names.has(row.ids[0])) names.set(row.ids[0], row.labels[0]);
    return names;
  };
  const lists = byId(grids.lists);
  const lineItems = byId(grids.lineItems);
  const cache = native.cache;
  return {
    list: id => lists.get(id) ?? labelIn(() => cache.getHierarchiesLabelPage(), id) ?? labelIn(() => cache.getHierarchySubsetsLabelPage(), id),
    lineItem: (id, module) => lineItems.get(id) ?? labelIn(() => cache.getLineItemsLabelPage(module), id),
    property: (id, list) => labelIn(() => cache.getHierarchyInfo(list)?.propertiesLabelPage, id) ?? labelIn(() => cache.getHierarchySubsetsLabelPage(), id),
  };
}
