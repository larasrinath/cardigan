import { readsFile, SOURCE_TYPE } from "../file-imports.js";
import type { Log } from "../progress.js";
import type { ImportHeader, ImportMapping, ItemMatch, MappedSource, MappedTarget } from "../result-types.js";
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
 * - A column is `sourceColumnId` ("#3", counted from 1), or `sourceColumnNumber` (counted from 0, a number or digits; -1
 *   for none), with its heading as `sourceColumnName` where the dialog kept it. A `sourceColumnId` that is no "#" and
 *   number is the column's heading: the dialog finds such a column in the header row by it, in any case, as it does by
 *   `sourceColumnName` (view/ImportDefinitionModuleMapping.js `markColumn`), and matches it to the file's own columns
 *   (widgets/Mapping.js `_updateMappings`). A line item's mapping can name its column by the heading alone. A constant is
 *   `sourceValueLabel`, or `sourceValue`, the identifier of a list's item.
 * - An import into a list says how it tells the list's items apart in `propertyMatchKey`, as the dialog's "Items uniquely
 *   identified by" (view/ImportDefinitionHierarchyMapping.js): with none, by what it maps, as the dialog takes a definition
 *   made before the choice; with the identifier of SYSTEM_PROPERTY_ID, by name alone; with that of SYSTEM_PROPERTY_CODE,
 *   by code alone; and else by the combination of the properties it lists. A numbered list told apart by code or by
 *   properties numbers its items itself: the dialog refuses a column for their names then.
 * The definition holds no list of the file's columns: Anaplan keeps the file's own settings (its separator, its header
 * row) apart, and never its columns. So which columns after the last one mapped the file has is not known.
 *
 * An import into a module holds more of how its sources are read (view/ImportDefinition.js `_getDimensionsInfo`, and
 * anaplan-sam's reading of the same definitions, src/domains/model-builder/definition-core.ts):
 * - `valueMaps`, a list with an entry for each dimension the dialog showed, `{"targetType":"moduleDimension","target":
 *   "_101000000001_","values":{…}}`, the line items' with a blank target. Its `values` take a source value, as the column
 *   or the header row writes it, to the ID of the item it is mapped to by hand, or to -1 where the modeller ignored it
 *   (view/MappedDimensionImportOptions.js `_onTargetSelectionChange`, `_onIgnoreButtonClick`). Empty `values` is the
 *   dialog's "Match on names or codes": the items are matched when the import runs, and nothing of them is stored. Where
 *   the line items come from the header row, the source values are the headers: each header mapped by hand, or ignored,
 *   is stored with its text.
 * - `periodFormats`, Time's entry `{"targetType":"moduleDimension","target":"_9000000001_","periodFormat":…}`: null where
 *   the periods are matched by their names, else the format they are read by (view/TimeDimensionImportOptions.js).
 * - `dataFormatsByTarget`, which takes a date line item's identifier to a key of `dataFormatDefinitions`, whose entry of
 *   type "date" holds the format its column's dates are read by.
 * - `aliasMaps` and `targetAreaSpecifications`, which the log describes: the codes behind the labels of `valueMaps`, and
 *   which of a dimension's items the import clears first. Neither says more of the sources.
 * A header the import matches when it runs, on a line item's name or code, is not stored anywhere: nor is any column the
 * definition does not name.
 *
 * The words for a target are Anaplan's, as the dialog's `_getTargetLabel` gives them, where they are names; the lines and
 * the page's words are said where the dialog has none ("Time", "Line Items"). Every name is the model's own, out of a
 * grid the export has read or the model page's own lists of names: nothing more is read for them. */

/** SYSTEM_PROPERTY_IMPORT_DEFINITION (anaplan/constants.js): the grid's column that holds each import's definition. */
export const IMPORT_DEFINITION = 4000001300;
/** The label of that column, by which it is found where the client numbers it otherwise. */
const DEFINITION_LABEL = "import definition";
/** MODEL_CONTENT_TIMESCALE_ENTITY_LONG_ID and MODEL_CONTENT_VERSION_ENTITY_LONG_ID: Time and Versions as a module's
 * dimensions. */
const TIME = 9000000001;
const VERSIONS = 9000000002;
/** The properties of a list with a name of the dialog's own (anaplan/nls/mapping `labelHierarchyParent` and
 * `labelHierarchyCode`): SYSTEM_PROPERTY_PARENT and SYSTEM_PROPERTY_CODE. */
const PROPERTY_WORDS: ReadonlyMap<number, string> = new Map([[4000000001, "Parent"], [4000000004, "Code"]]);
/** SYSTEM_PROPERTY_ID and SYSTEM_PROPERTY_CODE (anaplan/constants.js): the keys of an import into a list that tells its items
 * apart by name alone, and by code alone. */
const NAME_KEY = 4000000010;
const CODE_KEY = 4000000004;
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
  /** Whether a list is numbered, where the names know it. */
  numbered?(list: number): boolean | undefined;
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

/** A column's place in the file, counted from 1: `sourceColumnId` ("#3") counts from 1, `sourceColumnNumber` from 0, where -1
 * gives none. */
function columnOf(mapping: Json): number | undefined {
  const id = typeof mapping.sourceColumnId === "string" ? /^#\s*(\d{1,6})$/.exec(mapping.sourceColumnId.trim()) : null;
  if (id && Number(id[1]) >= 1) return Number(id[1]);
  const number = mapping.sourceColumnNumber;
  const place = typeof number === "number" ? number : typeof number === "string" && /^\d{1,6}$/.test(number.trim()) ? Number(number) : NaN;
  return Number.isSafeInteger(place) && place >= 0 && place < 1e6 ? place + 1 : undefined;
}

/** A column's heading: `sourceColumnName`, or else a `sourceColumnId` that is no "#" and number, by which the dialog finds
 * a column as it does by a heading. */
function headingOf(mapping: Json): string | undefined {
  if (named(mapping.sourceColumnName)) return mapping.sourceColumnName;
  const id = mapping.sourceColumnId;
  return named(id) && !id.trim().startsWith("#") ? id.trim() : undefined;
}

/** What a definition identifies a column by where it gives neither its place nor its heading: a `sourceColumnId` of a "#"
 * and no number Cardigan can read, or a number, a field's ID (`sourceFieldId`), or a model's column's
 * (`sourceColumnEntityLongId`, -1 for none). Nothing where it gives none. */
function identifierOf(mapping: Json): string | undefined {
  for (const value of [mapping.sourceColumnId, mapping.sourceFieldId, mapping.sourceColumnEntityLongId]) {
    if (named(value)) return value.trim();
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) return String(value);
  }
  return undefined;
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

/** A dimension's key among the parts of a definition that hold one entry for each dimension: its ID in digits, or "" for
 * the line items, whose target is blank. */
const targetKey = (target: unknown): string => {
  const id = idOf(target);
  return Number.isFinite(id) && id !== -1 ? String(id) : "";
};

/** What `valueMaps` holds for each dimension of an import into a module: each source value mapped by hand, with the ID of
 * the item it is mapped to, or -1 where it is ignored, in the order the definition writes them. Undefined where the
 * definition has no such list; a dimension it holds no entry for has none here. */
function valueMapsOf(definition: Json): Map<string, [source: string, item: number][]> | undefined {
  if (!Array.isArray(definition.valueMaps)) return undefined;
  const found = new Map<string, [string, number][]>();
  for (const entry of Array.from(definition.valueMaps as unknown[])) {
    if (!isObject(entry) || !isObject(entry.values)) continue;
    const key = targetKey(entry.target);
    const pairs = found.get(key) ?? [];
    for (const [source, item] of Object.entries(entry.values)) {
      if (item === -1 || (typeof item === "number" && Number.isSafeInteger(item) && item > 0)) pairs.push([source, item]);
    }
    found.set(key, pairs);
  }
  return found;
}

/** How Time is read out of its source: null where its periods are matched by their names, else the format they are read
 * by, out of `periodFormats`. Undefined where the definition says neither. */
function periodFormatOf(definition: Json): string | null | undefined {
  if (!Array.isArray(definition.periodFormats)) return undefined;
  const time = Array.from(definition.periodFormats as unknown[]).find((entry): entry is Json => isObject(entry) && idOf(entry.target) === TIME);
  if (!time || !Object.hasOwn(time, "periodFormat")) return undefined;
  if (time.periodFormat === null) return null;
  return isObject(time.periodFormat) && named(time.periodFormat.format) ? time.periodFormat.format : undefined;
}

/** The format each date line item's column is read by, by the line item's ID, out of `dataFormatsByTarget` and the entries of
 * type "date" of `dataFormatDefinitions`. */
function dateFormatsOf(definition: Json): Map<number, string> {
  const found = new Map<number, string>();
  const [byTarget, formats] = [definition.dataFormatsByTarget, definition.dataFormatDefinitions];
  if (!isObject(byTarget) || !isObject(formats)) return found;
  for (const [target, key] of Object.entries(byTarget)) {
    const id = idOf(target);
    const format = typeof key === "string" ? formats[key] : undefined;
    if (Number.isFinite(id) && isObject(format) && format.type === "date" && named(format.format)) found.set(id, format.format);
  }
  return found;
}

/** What feeds a target, as the definition says it. */
function sourceOf(mapping: Json): Pick<MappedTarget, "source" | "column" | "text" | "id"> {
  const word = mapping.sourceType;
  const source = typeof word === "string" ? SOURCES.get(word) : undefined;
  if (source === "column") {
    const column = columnOf(mapping);
    const heading = headingOf(mapping);
    const id = column === undefined && heading === undefined ? identifierOf(mapping) : undefined;
    return { source, ...(column !== undefined ? { column } : {}), ...(heading !== undefined ? { text: heading } : {}), ...(id !== undefined ? { id } : {}) };
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

/** A value of a definition for the log: its type, and for a text, a number or a truth the value, a text cut to 20
 * characters. That is what a live log needs to tell how a model's definitions write a column, and no more. */
function logValue(value: unknown): string {
  if (value === undefined) return "absent";
  if (value === null) return "null";
  if (typeof value === "string") return `text ${JSON.stringify(value.length > 20 ? `${value.slice(0, 20)}…` : value)}`;
  if (typeof value === "number" || typeof value === "boolean") return `${typeof value === "number" ? "number" : "truth"} ${String(value)}`;
  if (Array.isArray(value)) return `list of ${value.length}`;
  return typeof value === "object" ? `object of ${Object.keys(value).length}` : typeof value;
}

/** A key of a part of a definition for the log: a word or an entity's identifier, and a question mark for anything else,
 * which could be a value (a value map's keys are the file's values). */
const logKey = (key: string): string => (/^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(key) || /^_?\d{1,19}_?$/.test(key) ? key : "?");

/** A part of a definition for the log, by its type and its keys, at most eight of them, and never a value. */
function partShape(value: unknown): string {
  if (value === undefined) return "absent";
  if (value === null) return "null";
  if (Array.isArray(value)) return `list of ${value.length}`;
  if (typeof value !== "object") return typeof value;
  const keys = Object.keys(value);
  return `object of ${keys.length} ${keys.length === 1 ? "key" : "keys"}${keys.length ? `: ${keys.slice(0, 8).map(logKey).join(", ")}${keys.length > 8 ? ", …" : ""}` : ""}`;
}

/** More of how a definition is made, for the log: its first mapping fed by a column, by each of the three ways it can say
 * the column, each by its type and a short value; its parts `source`, `dataFormatDefinitions` and `dataFormatsByTarget`,
 * by their types and keys; and where it holds them, the parts that say how items are matched (`mapsLine`). One live log
 * then shows how a model's definitions write their columns, and what they keep of how the sources are matched. */
function detailsOf(definition: Json): string[] {
  const mappings: unknown[] = Array.isArray(definition.mappings) ? Array.from(definition.mappings as unknown[]) : [];
  const first = mappings.find((mapping): mapping is Json => isObject(mapping) && mapping.sourceType === "column");
  const column = first
    ? `first column: sourceColumnId ${logValue(first.sourceColumnId)}, sourceColumnNumber ${logValue(first.sourceColumnNumber)}, sourceColumnName ${logValue(first.sourceColumnName)}`
    : "no mapping from a column";
  // The line on how items are matched is written where the definition holds any of its parts, as the dialog's do.
  const maps = MATCHING_PARTS.some(key => definition[key] !== undefined) ? [mapsLine(definition)] : [];
  return [column, ["source", "dataFormatDefinitions", "dataFormatsByTarget"].map(key => `${key} ${partShape(definition[key])}`).join("; "), ...maps];
}

/** The parts of a definition that say how items and periods are matched, which the dialog writes for an import into a
 * module (view/ImportDefinition.js `_getDimensionsInfo`). */
const MATCHING_PARTS = ["valueMaps", "aliasMaps", "targetAreaSpecifications", "periodFormats"] as const;

/** A target of a part of a definition, for the log: a dimension's ID, or "line items" for the line items' blank target. */
const whose = (target: unknown): string => (targetKey(target) === "" ? "line items" : targetKey(target));

/** A list of a definition for the log, by how many entries it has and each of its first eight as `each` says it, one from
 * the next by a bar. */
function listed(value: unknown, each: (entry: Json) => string): string {
  if (!Array.isArray(value)) return partShape(value);
  const entries: unknown[] = Array.from(value as unknown[]);
  const said = entries.slice(0, 8).map(entry => (isObject(entry) ? each(entry) : "?"));
  return `list of ${entries.length}${said.length ? `: ${said.join(" | ")}${entries.length > 8 ? " | …" : ""}` : ""}`;
}

/** A source value of a value map for the log: its type and length, never its text, which is the import's source's own. */
const sourceShape = ([source, item]: [string, unknown]): string =>
  `text of ${source.length} ${source.length === 1 ? "character" : "characters"} ${item === -1 ? "ignored" : typeof item === "number" ? "to an ID" : `to ${logValue(item)}`}`;

/** The parts of a definition that say how a dimension's items, and Time's periods, are matched, for the log:
 * `valueMaps` by each dimension with how many source values it maps by hand and ignores, and the shapes of its first
 * two; `aliasMaps` by each dimension with how many codes it holds; `targetAreaSpecifications` by each dimension's area;
 * `periodFormats` by whether each matches names or holds a format. No source value is written: a log a user passes on
 * holds the import's mapping, not its source's values. */
function mapsLine(definition: Json): string {
  const values = (entry: Json): [string, unknown][] => (isObject(entry.values) ? Object.entries(entry.values) : []);
  const samples = Array.isArray(definition.valueMaps)
    ? Array.from(definition.valueMaps as unknown[]).flatMap(entry => (isObject(entry) ? values(entry) : [])).slice(0, 2).map(sourceShape) : [];
  const valueMaps = listed(definition.valueMaps, entry => {
    const items = values(entry);
    const mapped = items.filter(([, item]) => typeof item === "number" && Number.isSafeInteger(item) && item > 0).length;
    const ignored = items.filter(([, item]) => item === -1).length;
    const other = items.length - mapped - ignored;
    return `${whose(entry.target)}: ${mapped} mapped, ${ignored} ignored${other ? `, ${other} of another kind` : ""}`;
  }) + (samples.length ? ` (${samples.join("; ")})` : "");
  const aliasMaps = listed(definition.aliasMaps, entry => `${whose(entry.target)}: ${values(entry).length}`);
  const areas = listed(definition.targetAreaSpecifications, entry => `${whose(entry.target)}: ${logWord(entry.area)}`);
  const periods = listed(definition.periodFormats, entry => `${whose(entry.target)}: ${entry.periodFormat === null ? "names"
    : isObject(entry.periodFormat) && typeof entry.periodFormat.format === "string" ? `a format of ${entry.periodFormat.format.length} characters` : logValue(entry.periodFormat)}`);
  return `valueMaps ${valueMaps}; aliasMaps ${aliasMaps}; targetAreaSpecifications ${areas}; periodFormats ${periods}`;
}

/** How an import into a list tells the list's items apart, as the dialog reads its definition
 * (view/ImportDefinitionHierarchyMapping.js `startup`). Without `propertyMatchKey`, by what it maps: name alone where it maps
 * the items' names and not their codes, code alone where it maps the codes and not the names, and name or code otherwise.
 * With the key of names, or of codes, alone, by that; with any other list of keys, by the combination of those
 * properties, each by its name. Nothing for a key that is no list. */
function matchOf(definition: Json, mappings: readonly Json[], into: number, names: ImportNames): ItemMatch | undefined {
  const numbered = names.numbered?.(into);
  const known = numbered === undefined ? {} : { numbered };
  const key = definition.propertyMatchKey;
  if (key === undefined || key === null) {
    const mapped = (mapping: Json): boolean => mapping.sourceType !== "undefined";
    const name = mappings.some(mapping => mapping.targetType === "hierarchyMemberEntityName" && mapped(mapping));
    const code = mappings.some(mapping => mapping.targetType === "hierarchyProperty" && idOf(mapping.target) === CODE_KEY && mapped(mapping));
    return { by: name && !code ? "name" : code && !name ? "code" : "nameOrCode", ...known };
  }
  if (!Array.isArray(key)) return undefined;
  const keys: unknown[] = Array.from(key as unknown[]);
  if (keys.length === 1 && idOf(keys[0]) === NAME_KEY) return { by: "name", ...known };
  if (keys.length === 1 && idOf(keys[0]) === CODE_KEY) return { by: "code", ...known };
  const properties = keys.map(entry => {
    const id = idOf(entry);
    return Number.isFinite(id) ? PROPERTY_WORDS.get(id) ?? names.property(id, into) ?? asId(id) : named(entry) ? entry : "?";
  });
  return { by: "properties", properties, ...known };
}

/** An import's mapping out of its definition's text, and how the definition is made for the log: `shape`, and where it is
 * an object, `details`. A definition that is no JSON, or JSON of another make (no list of mappings, a mapping that is no
 * object), gives the note that it could not be read. One of a kind whose mapping is not listed gives no targets: the page
 * says what it loads. */
export function readDefinition(text: string, names: ImportNames, list?: string): { mapping: Pick<ImportMapping, "importType" | "targets" | "matchedBy" | "headers" | "note">; shape: string; details: string[] } {
  if (text.trim() === "") return { mapping: { importType: "", targets: [], note: MAPPING_NOTES.noDefinition }, shape: "no definition", details: [] };
  let definition: unknown;
  try {
    definition = JSON.parse(text);
  } catch {
    return { mapping: { importType: "", targets: [], note: MAPPING_NOTES.unknown }, shape: "the definition is not JSON", details: [] };
  }
  if (!isObject(definition)) return { mapping: { importType: "", targets: [], note: MAPPING_NOTES.unknown }, shape: "the definition is not an object", details: [] };
  const shape = shapeOf(definition);
  const details = detailsOf(definition);
  const importType = typeof definition.importType === "string" ? definition.importType : "";
  const mappings = definition.mappings;
  if (!Array.isArray(mappings) || !Array.from(mappings as unknown[]).every(isObject)) return { mapping: { importType, targets: [], note: MAPPING_NOTES.unknown }, shape, details };
  if (importType !== MODULE_DATA && importType !== HIERARCHY_DATA) return { mapping: { importType, targets: [] }, shape, details };
  const into = idOf(definition.target);
  const matchedBy = importType === HIERARCHY_DATA ? matchOf(definition, mappings as Json[], into, names) : undefined;
  // A numbered list told apart by code or by properties gives its items their names itself.
  const numbers = matchedBy?.numbered === true && (matchedBy.by === "code" || matchedBy.by === "properties");
  // An import into a module also holds how its dimensions' items, Time's periods and its dates are read.
  const module = importType === MODULE_DATA;
  const valueMaps = module ? valueMapsOf(definition) : undefined;
  const period = module ? periodFormatOf(definition) : undefined;
  const dates = module ? dateFormatsOf(definition) : new Map<number, string>();
  let headers: ImportHeader[] | undefined;
  // Where the line items come from the header row, each line item's values are in the column it heads: the dialog asks
  // for no column of values then (view/ImportDefinitionModuleMapping.js `validate`), so the blank line item it keeps for
  // one is no target.
  const fromHeaderRow = module && (mappings as Json[]).some(mapping => mapping.targetType === "moduleDimension" && targetKey(mapping.target) === ""
    && mapping.sourceType === "headerRow");
  const kept = fromHeaderRow ? (mappings as Json[]).filter(mapping => !(mapping.targetType === "moduleLineItem" && targetKey(mapping.target) === ""
    && mapping.sourceType === "undefined")) : (mappings as Json[]);
  const targets = kept.map((mapping): MappedTarget => {
    const target = targetOf(mapping, importType, into, names, list);
    const source = sourceOf(mapping);
    if (numbers && mapping.targetType === "hierarchyMemberEntityName" && source.source === "none") return { target, source: "numbered" };
    const read: MappedTarget = { target, ...source };
    if (!module) return read;
    const id = idOf(mapping.target);
    if (mapping.targetType === "moduleLineItem") {
      const format = Number.isFinite(id) ? dates.get(id) : undefined;
      return format === undefined ? read : { ...read, dateFormat: format };
    }
    if (mapping.targetType !== "moduleDimension" || (source.source !== "column" && source.source !== "headerRow")) return read;
    if (id === TIME) return period === undefined ? read : { ...read, periodFormat: period };
    if (!valueMaps) return read;
    const byHand = valueMaps.get(targetKey(mapping.target)) ?? [];
    const ignored = byHand.filter(([, item]) => item === -1).length;
    // The line items from the header row: the source values mapped by hand are the headers, each with its line item.
    if (targetKey(mapping.target) === "" && source.source === "headerRow" && byHand.length) {
      headers = byHand.map(([header, item]): ImportHeader => (item === -1 ? { header } : { header, lineItem: names.lineItem(item, into) ?? asId(item) }));
    }
    return { ...read, items: { byHand: byHand.length - ignored, ignored } };
  });
  return { mapping: { importType, targets, ...(matchedBy ? { matchedBy } : {}), ...(headers ? { headers } : {}) }, shape, details };
}

/** The place of the Imports tab's column of that label, or -1. */
const columnAt = (grid: Grid, label: string): number => grid.columns.findIndex(column => (column.labels[0] ?? "").trim() === label);

/** The imports of the Imports tab that read a file, in the tab's order (file-imports.ts `readsFile`). */
export function fileImports(tab: Grid): GridRow[] {
  const at = columnAt(tab, SOURCE_TYPE);
  return at < 0 ? [] : tab.rows.filter(row => readsFile(row.cells[at]));
}

/** A Source Type as the log writes it: Anaplan's own word for a kind of source, such as FILE or SAVED VIEW, in letters and
 * spaces; "blank" for an empty cell, and a question mark for anything else, which could be a value of the model's. */
const typeWord = (cell: string | undefined): string => {
  const word = (cell ?? "").trim();
  return word === "" ? "blank" : /^[A-Za-z][A-Za-z _-]{0,29}$/.test(word) ? word : "?";
};

/** The log's line on the Imports tab, where the mappings start: how many imports it lists, each Source Type it holds with
 * how many imports have it, and how many mappings are to be read, one for each import from a file; or that it has no
 * Source Type column. One live log then tells whether an import from a file was found at all. As the page's other words,
 * the line names no file: FILE is Anaplan's own word, as the tab holds it. */
export function importsLine(tab: Grid): string {
  const at = columnAt(tab, SOURCE_TYPE);
  if (at < 0) return `Import mappings: ${tab.rows.length} imports; the Imports tab has no ${SOURCE_TYPE} column`;
  const types = new Map<string, number>();
  for (const row of tab.rows) types.set(typeWord(row.cells[at]), (types.get(typeWord(row.cells[at])) ?? 0) + 1);
  const toRead = fileImports(tab).length;
  return `Import mappings: ${tab.rows.length} imports; Source Types: ${[...types].map(([type, count]) => `${type} ×${count}`).join(", ") || "none"}; `
    + `${toRead} ${toRead === 1 ? "mapping" : "mappings"} to read`;
}

/** The column of the grid of definitions that holds them: the one the client numbers `column`, or else the one labelled
 * Import Definition, as a client that numbers it otherwise would give it; -1 where there is neither. No other column is
 * taken for it. */
function definitionsAt(definitions: Grid, column: number): number {
  const byId = definitions.columns.findIndex(entry => entry.ids[0] === column);
  return byId >= 0 ? byId : definitions.columns.findIndex(entry => (entry.labels[0] ?? "").trim().toLowerCase() === DEFINITION_LABEL);
}

/** Each import of the Imports tab that reads a file, in the tab's order, with its mapping: out of its definition's cell in
 * `definitions`, the grid of the imports against their properties, in its column of definitions (`definitionsAt`). Without
 * that grid, which the model did not give, each says so, and so does an import the grid has no definition for: none is
 * left out, so that the page has one for each such row of the Imports table. The log has lines for each: how its
 * definition is made, how it writes its first column, and the parts that could say more of its columns (`detailsOf`).
 * A last line counts what was read and what was found, and says why nothing was where the grid or its column is missing. */
export function importMappings(tab: Grid, definitions: Grid | undefined, names: ImportNames, log: Log, column = IMPORT_DEFINITION): ImportMapping[] {
  const imports = fileImports(tab);
  const target = columnAt(tab, "Target Object");
  const at = definitions ? definitionsAt(definitions, column) : -1;
  const byId = new Map((definitions?.rows ?? []).map(row => [row.ids[0], row]));
  if (definitions && at < 0) log(`Import mappings: no column of definitions among the ${definitions.columns.length} given`);
  let [found, read] = [0, 0];
  const mappings = imports.map((row): ImportMapping => {
    const id = Number.isSafeInteger(row.ids[0]) && row.ids[0] > 0 ? String(row.ids[0]) : "";
    const known = { id, name: row.labels[0] ?? "" };
    if (!definitions || at < 0) return { ...known, importType: "", targets: [], note: MAPPING_NOTES.notRead };
    const cell = byId.get(row.ids[0])?.cells[at];
    if (cell === undefined) {
      log(`Import mapping ${id || "?"}: not in the grid of definitions`);
      return { ...known, importType: "", targets: [], note: MAPPING_NOTES.noDefinition };
    }
    found++;
    try {
      const { mapping, shape, details } = readDefinition(cell, names, target < 0 ? undefined : row.cells[target] || undefined);
      log(`Import mapping ${id || "?"}: ${shape}`);
      for (const detail of details) log(`Import mapping ${id || "?"}: ${detail}`);
      if (mapping.note === undefined) read++;
      return { ...known, ...mapping };
    } catch (error) {
      log(`Import mapping ${id || "?"}: ${error instanceof Error ? error.name : "error"} while reading the definition`);
      return { ...known, importType: "", targets: [], note: MAPPING_NOTES.unknown };
    }
  });
  // The page shows the log, and no word of the page names a file: nor does this line.
  const where = !definitions ? "the model gave no grid of definitions" : at < 0 ? "the grid has no column of definitions" : `${found} found in the grid of definitions`;
  log(`Import mappings: ${read} of ${imports.length} read; ${where}`);
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
 * `_lookupHierarchyLabel`), and a list's properties, which no grid of the export lists. Whether a list is numbered is its
 * row's Numbered cell of General Lists, "true" or "false", and not known for a list the grid does not have. */
export function importNames(native: Native, grids: { lists?: Grid; lineItems?: Grid }): ImportNames {
  const byId = (grid: Grid | undefined): Map<number, string> => {
    const names = new Map<number, string>();
    for (const row of grid?.rows ?? []) if (Number.isSafeInteger(row.ids[0]) && named(row.labels[0]) && !names.has(row.ids[0])) names.set(row.ids[0], row.labels[0]);
    return names;
  };
  const lists = byId(grids.lists);
  const lineItems = byId(grids.lineItems);
  const numberedAt = grids.lists ? columnAt(grids.lists, "Numbered") : -1;
  const numbered = new Map<number, boolean>();
  for (const row of numberedAt < 0 ? [] : grids.lists?.rows ?? []) {
    const cell = (row.cells[numberedAt] ?? "").trim().toLowerCase();
    if (Number.isSafeInteger(row.ids[0]) && (cell === "true" || cell === "false") && !numbered.has(row.ids[0])) numbered.set(row.ids[0], cell === "true");
  }
  const cache = native.cache;
  return {
    list: id => lists.get(id) ?? labelIn(() => cache.getHierarchiesLabelPage(), id) ?? labelIn(() => cache.getHierarchySubsetsLabelPage(), id),
    lineItem: (id, module) => lineItems.get(id) ?? labelIn(() => cache.getLineItemsLabelPage(module), id),
    property: (id, list) => labelIn(() => cache.getHierarchyInfo(list)?.propertiesLabelPage, id) ?? labelIn(() => cache.getHierarchySubsetsLabelPage(), id),
    numbered: list => numbered.get(list),
  };
}
