import { readsFile, SOURCE_TYPE } from "../file-imports.js";
import { missingIn, missingText } from "../page-files.js";
import type { Log, Stop } from "../progress.js";
import type { FileOptions, ImportHeader, ImportMapping, ItemMatch, MappedSource, MappedTarget, TargetKind } from "../result-types.js";
import { message } from "../util.js";
import { plainText, type Grid } from "./grid.js";
import { axis, readGrid, type Native } from "./native.js";

/** The mapping of each import, whatever its Source Type, out of the import's own definition: the JSON that Anaplan's import
 * dialog reads and saves (anaplan/view/ImportDefinition.js), which the Model settings grid of the imports against their
 * properties holds in the column of SYSTEM_PROPERTY_IMPORT_DEFINITION. The export reads that grid as it reads the others
 * (native.ts `readGrid`), with the dialog's own axes, IMPORT_ALL against IMPORT_PROPERTY: one view, read, and nothing
 * saved. The dialog's way to a source's columns, the system action GET_IMPORT_SOURCE_FIELDS, is never sent, nor is
 * GET_IMPORT_SOURCE_ITEMS: either may store what it is given. So the source itself is never asked for, and an import whose
 * file is no longer available keeps its mapping: the mapping is the import's. An import of a model's module, saved view
 * or list has a definition made the same way (view/ManageImportSources/_ModelSource.js): its columns are the object's own,
 * each kept by the entity it is (`sourceColumnEntityLongId`) and its name (`sourceColumnName`) where the dialog kept it.
 *
 * An import's definition names its data source in `source`, by the source's identifier ("_113000000012_"). The sources'
 * own definitions are in the grid of the data sources against their properties, IMPORT_DATA_SOURCE against
 * IMPORT_DATA_SOURCE_PROPERTY, in the column of SYSTEM_PROPERTY_IMPORT_DATA_SOURCE_DEFINITION, as anaplan-sam's
 * definition-core.ts reads them: null, or the text "null", for a source that is not set up; else JSON, of uploaded data
 * (`dataSourceType` UPLOADED_FILE, with its encoding, separators, text delimiter, decimal separator, header row and first
 * row of data, the rows as text) or of a model's object (MODEL_OBJECT, with the object's ID and name, and the model's and
 * the workspace's IDs, empty for this model). The export reads that grid once, after the imports' definitions, and keeps
 * of uploaded data its settings alone, the import's File Options (`fileOptionsOf`). Of a model's object it keeps nothing:
 * it names the object's columns by this model's names only where the object is this model's (`ModelSource`).
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
 * - `aliasMaps`, which the log describes: the codes behind the labels of `valueMaps`.
 * - `targetAreaSpecifications`, an entry for each dimension, keyed as `valueMaps` is, whose `area` says which of the
 *   dimension's items the import clears first (view/MappedDimensionImportOptions.js, view/TimeDimensionImportOptions.js):
 *   kept for a dimension fed by a column or the header row, as the dialog shows the choice for no other.
 * - `globalTargetAreaSpecification`: none where the import clears its target first (the dialog's "Clear target prior to
 *   import"), and MAPPED_ITEMS_IN_SOURCE where it only updates the cells it imports (view/ImportDefinitionModuleMapping.js
 *   `_initTargetItemsOptions`, `_onRadioButtonChange`).
 * A header the import matches when it runs, on a line item's name or code, is not stored anywhere: nor is any column the
 * definition does not name.
 *
 * The words for a target are Anaplan's, as the dialog's `_getTargetLabel` gives them, where they are names; the lines and
 * the page's words are said where the dialog has none ("Time", "Line Items"). Every name is the model's own, out of a
 * grid the export has read or the model page's own lists of names. A list with unnamed property targets has its
 * properties grid read once more (`readImportMappings`): the cache need not hold all of its properties. A constant into
 * Time is named by the client's own labels of the model's periods, then by the Model Calendar's period choices. A line item
 * that the import holds and nothing names, which the client classes as a line item, is one the model doesn't have: it is
 * said as the pages' tables say one, "Missing line item (ID 1901000000003)" (page-files.ts `missingText`). */

/** SYSTEM_PROPERTY_IMPORT_DEFINITION (anaplan/constants.js): the grid's column that holds each import's definition. */
export const IMPORT_DEFINITION = 4000001300;
/** SYSTEM_PROPERTY_IMPORT_DATA_SOURCE_DEFINITION (anaplan/constants.js): the column of the grid of the data sources that
 * holds each source's definition. */
export const SOURCE_DEFINITION = 4000001400;
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
  /** Last resort, from the client's entity class and labels already in memory. A line item, by the client's class, that
   * nothing names is said as missing, with its ID (page-files.ts `missingText`): the import still maps to it, and the model
   * doesn't have it. */
  entity?(id: number, into: number, constant?: boolean): string | undefined;
  describe?(id: number): string;
  /** A period's name, for a constant into Time: the client's own label of it, then the Model Calendar's choice of it. */
  period?(id: number): string | undefined;
  /** For the log, where a constant into Time stays unnamed: what the client and the Model Calendar held of periods, and that
   * the ID is not among them. */
  periodsLine?(id: number): string;
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
/** The ID a text says, where the text is an ID that nothing names (`asId`); none for any other text. */
const idSaid = (text: string | undefined): number | undefined => {
  const match = /^ID (\d+)$/.exec(text ?? "");
  return match ? Number(match[1]) : undefined;
};

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

/** Where an import of a model's object reads from, for naming the object's columns: the object, a module, a saved view or
 * a list, by its ID where its source's definition gives one, and whether the object is this model's. A source of another
 * model has entities of that model, which this model's names do not know: an ID of theirs could be one of this model's
 * with another meaning. Nothing of it is kept. */
export interface ModelSource { object?: number; here: boolean }

/** The entity a column of a model's object is, where the definition says it: `sourceColumnEntityLongId`, a number, or its
 * digits as view/LineItemImportMapper.js writes it, -1 for none; or a `sourceColumnId` written as an entity's identifier
 * ("_1901000000003_"). Nothing where it says neither. */
function columnEntityOf(mapping: Json): number | undefined {
  const entity = idOf(mapping.sourceColumnEntityLongId);
  if (Number.isSafeInteger(entity) && entity > 0) return entity;
  const id = mapping.sourceColumnId;
  const identified = typeof id === "string" && /^_\d{1,19}_$/.test(id.trim()) ? idOf(id) : NaN;
  return Number.isSafeInteger(identified) && identified > 0 ? identified : undefined;
}

/** The name this model gives an entity that is a column of one of its own objects: Time, Versions, a line item (of the
 * object, where it is a module), a list, a property (of the object, where it is a list), then what the client's entity
 * information names it by (`ImportNames.entity`), as a target is named. */
function sourceNameOf(id: number, names: ImportNames, object: number): string | undefined {
  if (id === TIME) return "Time";
  if (id === VERSIONS) return "Versions";
  return names.lineItem(id, object) ?? names.list(id) ?? names.property(id, object) ?? names.entity?.(id, object);
}

/** A column of a model's object, by the name the definition writes for it, as it is written: `sourceColumnName`, or a
 * `sourceColumnId` that is neither a "#" and a number nor an identifier. Else by the entity it is (`columnEntityOf`), named
 * as this model names it where the object is this model's (`sourceNameOf`), or by its ID. Nothing where the definition
 * says none of these. */
function modelColumnOf(mapping: Json, names: ImportNames, model: ModelSource, into: number): string | undefined {
  if (named(mapping.sourceColumnName)) return mapping.sourceColumnName;
  const entity = columnEntityOf(mapping);
  if (entity !== undefined) return (model.here ? sourceNameOf(entity, names, model.object ?? into) : undefined) ?? asId(entity);
  const id = mapping.sourceColumnId;
  return named(id) && !id.trim().startsWith("#") ? id.trim() : undefined;
}

/** What a target of an import into a module is (result-types.ts `TargetKind`), by its `targetType` and its target, as
 * `targetOf` names it. */
function kindOf(mapping: Json): TargetKind {
  const id = idOf(mapping.target);
  const known = Number.isFinite(id) && id !== -1;
  if (mapping.targetType === "moduleDimension") return !known ? "lineItems" : id === TIME ? "time" : id === VERSIONS ? "versions" : "list";
  if (mapping.targetType === "moduleLineItem") return known ? "lineItem" : "value";
  return "other";
}

/** Anaplan's words for which of a dimension's items an import clears first: an upper-case word, as the definition writes
 * them. Anything else is no area. */
const AREA = /^[A-Z][A-Z_]{0,39}$/;

/** Which of each dimension's items an import into a module clears first, by the dimension's key (`targetKey`), out of
 * `targetAreaSpecifications`: the first entry for a dimension, as the dialog takes it (view/ImportDefinition.js
 * `_getDimensionsInfo`). */
function areasOf(definition: Json): Map<string, string> {
  const found = new Map<string, string>();
  if (!Array.isArray(definition.targetAreaSpecifications)) return found;
  for (const entry of Array.from(definition.targetAreaSpecifications as unknown[])) {
    if (!isObject(entry) || typeof entry.area !== "string" || !AREA.test(entry.area)) continue;
    const key = targetKey(entry.target);
    if (!found.has(key)) found.set(key, entry.area);
  }
  return found;
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

/** A constant's value: its stored label, then, into Time, the period's name, or else the client's entity name, with an ID
 * left when unknown. Ordinary numeric and text values are kept as values. */
function constantOf(mapping: Json, names: ImportNames, into: number): string | undefined {
  if (named(mapping.sourceValueLabel)) return mapping.sourceValueLabel;
  const value = mapping.sourceValue;
  const id = idOf(value);
  const time = mapping.targetType === "moduleDimension" && idOf(mapping.target) === TIME;
  const identifier = typeof value === "string" && /^_\d+_$/.test(value.trim());
  if (Number.isFinite(id) && (time || identifier)) return (time ? names.period?.(id) : undefined) ?? names.entity?.(id, into, true) ?? asId(id);
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (!named(value)) return undefined;
  return value;
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

/** What feeds a target, as the definition says it: of an import of a model's object, a column by its name or the entity it
 * is (`modelColumnOf`). */
function sourceOf(mapping: Json, names: ImportNames, into: number, model?: ModelSource): Pick<MappedTarget, "source" | "column" | "text" | "id"> {
  const word = mapping.sourceType;
  const source = typeof word === "string" ? SOURCES.get(word) : undefined;
  if (source === "column") {
    const column = columnOf(mapping);
    const heading = model ? modelColumnOf(mapping, names, model, into) : headingOf(mapping);
    const id = column === undefined && heading === undefined ? identifierOf(mapping) : undefined;
    return { source, ...(column !== undefined ? { column } : {}), ...(heading !== undefined ? { text: heading } : {}), ...(id !== undefined ? { id } : {}) };
  }
  if (source === "constant") {
    const value = constantOf(mapping, names, into);
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
      return names.list(id) ?? names.entity?.(id, into) ?? asId(id);
    case "moduleLineItem":
      return known ? names.lineItem(id, into) ?? names.entity?.(id, into) ?? asId(id) : "Value";
    case "hierarchyMemberEntityName":
      return names.list(into) ?? list ?? "Items";
    case "hierarchyProperty":
      return known ? PROPERTY_WORDS.get(id) ?? names.property(id, into) ?? names.entity?.(id, into) ?? asId(id) : "Property";
    default:
      if (known) return (importType === MODULE_DATA ? names.lineItem(id, into) : names.property(id, into)) ?? names.list(id) ?? names.entity?.(id, into) ?? asId(id);
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
    return Number.isFinite(id) ? PROPERTY_WORDS.get(id) ?? names.property(id, into) ?? names.entity?.(id, into) ?? asId(id) : named(entry) ? entry : "?";
  });
  return { by: "properties", properties, ...known };
}

/** An import's mapping out of its definition's text, and how the definition is made for the log: `shape`, and where it is
 * an object, `details`. A definition that is no JSON, or JSON of another make (no list of mappings, a mapping that is no
 * object), gives the note that it could not be read. One of a kind whose mapping is not listed gives no targets: the page
 * says what it loads. `model` is where an import of a model's object reads from, for naming the object's columns. */
export function readDefinition(text: string, names: ImportNames, list?: string, model?: ModelSource):
  { mapping: Pick<ImportMapping, "importType" | "targets" | "matchedBy" | "headers" | "clear" | "note">; shape: string; details: string[] } {
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
  // An import into a module also holds how its dimensions' items, Time's periods and its dates are read, and what it
  // clears first.
  const module = importType === MODULE_DATA;
  const valueMaps = module ? valueMapsOf(definition) : undefined;
  const period = module ? periodFormatOf(definition) : undefined;
  const dates = module ? dateFormatsOf(definition) : new Map<number, string>();
  const areas = module ? areasOf(definition) : new Map<string, string>();
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
    const source = sourceOf(mapping, names, into, model);
    if (numbers && mapping.targetType === "hierarchyMemberEntityName" && source.source === "none") return { target, source: "numbered" };
    if (!module) return { target, ...source };
    const read: MappedTarget = { target, ...source, kind: kindOf(mapping) };
    const id = idOf(mapping.target);
    if (mapping.targetType === "moduleLineItem") {
      const format = Number.isFinite(id) ? dates.get(id) : undefined;
      return format === undefined ? read : { ...read, dateFormat: format };
    }
    if (mapping.targetType !== "moduleDimension" || (source.source !== "column" && source.source !== "headerRow")) return read;
    // What the dimension clears first, as the dialog shows it for a dimension fed by a column or the header row alone
    // (view/ImportDefinitionListMapping.js `_isUnmapped`).
    const area = areas.get(targetKey(mapping.target));
    const cleared: MappedTarget = area === undefined ? read : { ...read, area };
    if (id === TIME) return period === undefined ? cleared : { ...cleared, periodFormat: period };
    if (!valueMaps) return cleared;
    const byHand = valueMaps.get(targetKey(mapping.target)) ?? [];
    const ignored = byHand.filter(([, item]) => item === -1).length;
    // The line items from the header row: the source values mapped by hand are the headers, each with its line item.
    if (targetKey(mapping.target) === "" && source.source === "headerRow" && byHand.length) {
      headers = byHand.map(([header, item]): ImportHeader => (item === -1 ? { header } : { header, lineItem: names.lineItem(item, into) ?? names.entity?.(item, into) ?? asId(item) }));
    }
    return { ...cleared, items: { byHand: byHand.length - ignored, ignored } };
  });
  if (fromHeaderRow) {
    const pairs = headers ?? [];
    kept.forEach((mapping, at) => {
      // A line item's own column, by the heading it is read by, as its target says it.
      const header = targets[at].source === "column" ? targets[at].text : undefined;
      if (mapping.targetType !== "moduleLineItem" || targetKey(mapping.target) === "" || header === undefined) return;
      const lineItem = targets[at].target;
      // The value map and a line item's own mapping may store the same pair. Keep distinct stored mappings.
      if (!pairs.some(entry => entry.header.trim().toLowerCase() === header.trim().toLowerCase() && entry.lineItem === lineItem)) pairs.push({ header, lineItem });
    });
    headers = pairs.length ? pairs : undefined;
  }
  // What the import does to the module before it loads, as the dialog's Mapping tab reads it: any value of
  // `globalTargetAreaSpecification` checks Only update imported cells, and none Clear target prior to import.
  const clear = module ? { clear: definition.globalTargetAreaSpecification ? "update" as const : "clear" as const } : {};
  return { mapping: { importType, targets, ...(matchedBy ? { matchedBy } : {}), ...(headers ? { headers } : {}), ...clear }, shape, details };
}

/** The place of the Imports tab's column of that label, or -1. */
const columnAt = (grid: Grid, label: string): number => grid.columns.findIndex(column => (column.labels[0] ?? "").trim() === label);

/** A Source Type as the log writes it: Anaplan's own word for a kind of source, such as FILE or SAVED VIEW, in letters and
 * spaces; "blank" for an empty cell, and a question mark for anything else, which could be a value of the model's. */
const typeWord = (cell: string | undefined): string => {
  const word = (cell ?? "").trim();
  return word === "" ? "blank" : /^[A-Za-z][A-Za-z _-]{0,29}$/.test(word) ? word : "?";
};

/** The log's line on the Imports tab, where the mappings start: how many imports it lists, each Source Type it holds with
 * how many imports have it, or that it has no Source Type column, and how many mappings are to be read: one for each
 * import, whatever its Source Type. As the page's other words, the line names no file: FILE is Anaplan's own word, as the
 * tab holds it. */
export function importsLine(tab: Grid): string {
  const at = columnAt(tab, SOURCE_TYPE);
  const toRead = `${tab.rows.length} ${tab.rows.length === 1 ? "mapping" : "mappings"} to read`;
  if (at < 0) return `Import mappings: ${tab.rows.length} imports; the Imports tab has no ${SOURCE_TYPE} column; ${toRead}`;
  const types = new Map<string, number>();
  for (const row of tab.rows) types.set(typeWord(row.cells[at]), (types.get(typeWord(row.cells[at])) ?? 0) + 1);
  return `Import mappings: ${tab.rows.length} imports; Source Types: ${[...types].map(([type, count]) => `${type} ×${count}`).join(", ") || "none"}; ${toRead}`;
}

/** The data sources' definitions the export read, for linking each import to its own source: the grid of the sources
 * against their properties, the ID of its column of definitions, and this model's ID, against which a model's object is
 * told to be this model's or another's. Nothing of them is kept. */
export interface SourceDefinitions { grid: Grid; column: number; model: string }

/** A data source as its definition says it (`dataSourceOf`): its type, as the log writes it, with the File Options of
 * uploaded data where it holds any, and where a model's object is. */
interface DataSource { type: string; options?: FileOptions; model?: ModelSource }
/** What the log says of a source that is not set up, and of one whose definition cannot be read. */
const NOT_SET_UP = "not set up";
const UNREADABLE = "not readable";

/** The settings of a source of uploaded data that Anaplan's own dialog reads (view/ManageImportSources/_EditUploadedText.js
 * `setSourceDefinition`), each where the definition holds it as text of a sensible length, and the two rows as whole
 * numbers from 0, in digits or as numbers, as the dialog writes them: the import's File Options. Nothing else of the
 * source is taken, by name: neither its name nor any ID. None where it holds none of them. */
function fileOptionsOf(source: Json): FileOptions | undefined {
  const text = (value: unknown, longest: number): string | undefined => (typeof value === "string" && value.length <= longest ? value : undefined);
  const row = (value: unknown): number | undefined => {
    const number = typeof value === "number" ? value : typeof value === "string" && /^\s*\d{1,6}\s*$/.test(value) ? Number(value) : NaN;
    return Number.isSafeInteger(number) && number >= 0 && number < 1e6 ? number : undefined;
  };
  const encoding = text(source.textEncoding, 60)?.trim();
  const separators = text(source.columnSeparators, 20);
  const delimiter = text(source.textDelimiter, 4);
  const decimal = text(source.decimalSeparator, 4);
  const [headerRow, firstDataRow] = [row(source.headerRow), row(source.firstDataRow)];
  const options: FileOptions = { ...(encoding ? { encoding } : {}), ...(separators !== undefined ? { separators } : {}),
    ...(delimiter !== undefined ? { delimiter } : {}), ...(decimal ? { decimal } : {}), ...(headerRow !== undefined ? { headerRow } : {}),
    ...(firstDataRow !== undefined ? { firstDataRow } : {}) };
  return Object.keys(options).length ? options : undefined;
}

/** A data source out of its definition's cell (anaplan-sam's definition-core.ts reads the same cell): null, the text
 * "null" or nothing for one that is not set up; JSON of uploaded data, with its File Options (`fileOptionsOf`); JSON of a
 * model's object, with the object's ID and whether the model it is in is this one, which its definition says by an empty
 * `modelId`, or by this model's own (view/ManageImportSources.js `_onModelSourceSelected`); JSON of another type; or text
 * that is no JSON object. */
function dataSourceOf(cell: string, model: string): DataSource {
  const text = cell.trim();
  if (text === "" || text === "null") return { type: NOT_SET_UP };
  let value: unknown;
  try { value = JSON.parse(text); } catch { return { type: UNREADABLE }; }
  if (value === null) return { type: NOT_SET_UP };
  if (!isObject(value)) return { type: UNREADABLE };
  const type = logWord(value.dataSourceType);
  if (value.dataSourceType === "UPLOADED_FILE") {
    const options = fileOptionsOf(value);
    return { type, ...(options ? { options } : {}) };
  }
  if (value.dataSourceType === "MODEL_OBJECT") {
    const object = idOf(value.objectId);
    const owner = value.modelId === undefined || value.modelId === null ? "" : typeof value.modelId === "string" ? value.modelId.trim() : "?";
    return { type, model: { ...(Number.isSafeInteger(object) && object > 0 ? { object } : {}), here: owner === "" || owner.toLowerCase() === model.trim().toLowerCase() } };
  }
  return { type };
}

/** The ID of an import's data source, out of its definition's `source` ("_113000000012_"); nothing where the definition is
 * no JSON object or names none. */
function sourceIdOf(text: string): number | undefined {
  try {
    const definition: unknown = JSON.parse(text);
    const id = isObject(definition) ? idOf(definition.source) : NaN;
    return Number.isSafeInteger(id) && id > 0 ? id : undefined;
  } catch {
    return undefined;
  }
}

/** Counts, by their words, for the log: "not set up ×1, not readable ×2". */
const tallied = (counts: ReadonlyMap<string, number>): string => [...counts].map(([word, count]) => `${word} ×${count}`).join(", ");
const add = (counts: Map<string, number>, word: string): void => { counts.set(word, (counts.get(word) ?? 0) + 1); };

/** How the imports of one kind found their sources, for the log: how many of them there are, how many found what the
 * page shows of their source, and why each other one did not. */
interface SourcesFound { total: number; found: number; why: Map<string, number> }
const sourcesFound = (): SourcesFound => ({ total: 0, found: 0, why: new Map() });

/** The column of the grid of definitions that holds them: the one the client numbers `column`, or else the one labelled
 * Import Definition, as a client that numbers it otherwise would give it; -1 where there is neither. No other column is
 * taken for it. */
function definitionsAt(definitions: Grid, column: number): number {
  const byId = definitions.columns.findIndex(entry => entry.ids[0] === column);
  return byId >= 0 ? byId : definitions.columns.findIndex(entry => (entry.labels[0] ?? "").trim().toLowerCase() === DEFINITION_LABEL);
}

/** Fill gaps in the client's property names before making the mappings. Only imports into lists with unnamed numeric
 * targets need a read: CUSTOM_PROPERTY against PROPERTY_PROPERTY, with the target list as static context, as the
 * list-property blueprint in anaplan-sam's authoring-core.ts reads it. Group all missing IDs first so each list's grid,
 * including a failed read, is tried only once per export. Names stay local to the run; the client cache is not changed.
 * `sources` is the grid of the data sources' definitions, where the export read it, in its column `sourceColumn`. */
export async function readImportMappings(native: Native, tab: Grid, definitions: Grid | undefined, names: ImportNames,
  log: Log, column = IMPORT_DEFINITION, stop?: Stop, sources?: Grid, sourceColumn = SOURCE_DEFINITION): Promise<ImportMapping[]> {
  stop?.throwIfAborted();
  const at = definitions ? definitionsAt(definitions, column) : -1;
  const byId = new Map((definitions?.rows ?? []).map(row => [row.ids[0], row]));
  const target = columnAt(tab, "Target Object");
  const missing = new Map<number, { name: string; mappings: Json[] }>();
  for (const row of at < 0 ? [] : tab.rows) {
    let definition: unknown;
    try { definition = JSON.parse(byId.get(row.ids[0])?.cells[at] ?? ""); } catch { continue; }
    if (!isObject(definition) || definition.importType !== HIERARCHY_DATA || !Array.isArray(definition.mappings)
        || !Array.from(definition.mappings as unknown[]).every(isObject)) continue;
    const list = idOf(definition.target);
    if (!Number.isSafeInteger(list) || list <= 0) continue;
    const listName = names.list(list) ?? (target < 0 ? undefined : row.cells[target] || undefined) ?? asId(list);
    for (const mapping of definition.mappings as Json[]) {
      const id = idOf(mapping.target);
      if (!Number.isFinite(id) || id === -1 || mapping.targetType === "hierarchyMemberEntityName" || PROPERTY_WORDS.has(id)
          || targetOf(mapping, HIERARCHY_DATA, list, names, listName) !== asId(id)) continue;
      const group = missing.get(list) ?? { name: listName, mappings: [] };
      group.mappings.push(mapping);
      missing.set(list, group);
    }
  }
  const properties = new Map<number, Map<number, string>>();
  const withProperties: ImportNames = { ...names, property: (id, list) => names.property(id, list) ?? properties.get(list)?.get(id) };
  for (const [list, group] of missing) {
    stop?.throwIfAborted();
    const found = new Map<number, string>();
    properties.set(list, found);
    let failure: string | undefined;
    let propertyCount = 0;
    try {
      if (typeof native.ids.entityLongIdToEntityLongIdIdentifier !== "function") throw new Error("the model page has no entityLongIdToEntityLongIdIdentifier helper");
      const context = native.ids.entityLongIdToEntityLongIdIdentifier(list);
      if (typeof context !== "string" || !context) throw new Error("the model page returned no list identifier");
      const grid = await readGrid(native, axis(native, "CUSTOM_PROPERTY"), axis(native, "PROPERTY_PROPERTY"),
        `Import mapping properties: list ${list}`, log, undefined, false, stop, [context]);
      for (const row of grid.rows) {
        if (Number.isSafeInteger(row.ids[0]) && named(row.labels[0])) found.set(row.ids[0], row.labels[0]);
      }
      propertyCount = grid.rows.length;
    } catch (error) {
      stop?.throwIfAborted();
      failure = message(error);
    }
    const namedIds = new Set<number>();
    const unnamed = new Set<string>();
    for (const mapping of group.mappings) {
      const id = idOf(mapping.target);
      if (targetOf(mapping, HIERARCHY_DATA, list, withProperties, group.name) === asId(id)) unnamed.add(`${asId(id)} (targetType ${logWord(mapping.targetType)})`);
      else namedIds.add(id);
    }
    if (failure === undefined) {
      log(`Import mappings: list ${group.name} (${list}): properties grid held ${propertyCount} ${propertyCount === 1 ? "property" : "properties"}; named ${namedIds.size} ${namedIds.size === 1 ? "ID" : "IDs"}`);
    }
    if (unnamed.size) log(`Import mappings: list ${group.name} (${list}): unnamed targets: ${[...unnamed].join(", ")}`
      + (failure === undefined ? "" : `; properties grid not read (${failure})`));
  }
  stop?.throwIfAborted();
  return importMappings(tab, definitions, withProperties, log, column, sources ? { grid: sources, column: sourceColumn, model: native.modelId } : undefined);
}

/** Each import of the Imports tab, whatever its Source Type, in the tab's order, with its mapping: out of its definition's
 * cell in `definitions`, the grid of the imports against their properties, in its column of definitions
 * (`definitionsAt`), and with the Source Type the tab gives it. Without that grid, which the model did not give, each says
 * so, and so does an import the grid has no definition for: none is left out, so that the page has one for each row of
 * the Imports table. The log has lines for each: how its definition is made, how it writes its first column, and the
 * parts that could say more of its columns (`detailsOf`). A line counts what was read and what was found, and says why
 * nothing was where the grid or its column is missing.
 *
 * With `sources`, the data sources' definitions, each import is linked to its source by its definition's `source`: an
 * import of uploaded data keeps its File Options, and an import of a model's object has the object's columns named
 * (`ModelSource`). An import of a model's object whose source is not known names its columns by what the definition
 * writes, and by their IDs. A last line then says of the sources how they are made and what each kind of import found,
 * by counts and Anaplan's words alone: no setting and no name (`sourcesLine`). */
export function importMappings(tab: Grid, definitions: Grid | undefined, names: ImportNames, log: Log, column = IMPORT_DEFINITION,
  sources?: SourceDefinitions): ImportMapping[] {
  const imports = tab.rows;
  const target = columnAt(tab, "Target Object");
  const type = columnAt(tab, SOURCE_TYPE);
  const at = definitions ? definitionsAt(definitions, column) : -1;
  const byId = new Map((definitions?.rows ?? []).map(row => [row.ids[0], row]));
  if (definitions && at < 0) log(`Import mappings: no column of definitions among the ${definitions.columns.length} given`);
  // Each data source, read once, by its ID.
  const sourceAt = sources ? sources.grid.columns.findIndex(entry => entry.ids[0] === sources.column) : -1;
  const dataSources = new Map<number, DataSource>();
  for (const row of sources && sourceAt >= 0 ? sources.grid.rows : []) {
    if (Number.isSafeInteger(row.ids[0]) && !dataSources.has(row.ids[0])) dataSources.set(row.ids[0], dataSourceOf(row.cells[sourceAt] ?? "", sources!.model));
  }
  const [uploaded, fromModels] = [sourcesFound(), sourcesFound()];
  let elsewhere = 0;
  let [found, read] = [0, 0];
  // Why a constant into Time keeps its ID is said once a run, for the first such constant.
  let periodsLogged = false;
  const mappings = imports.map((row): ImportMapping => {
    const id = Number.isSafeInteger(row.ids[0]) && row.ids[0] > 0 ? String(row.ids[0]) : "";
    const sourceType = type < 0 ? "" : (row.cells[type] ?? "").trim();
    const known = { id, name: row.labels[0] ?? "", sourceType };
    // The imports whose sources the last line counts: of uploaded data, and of a model's object.
    const kind = readsFile(sourceType) ? uploaded : sourceType !== "" ? fromModels : undefined;
    if (kind) kind.total++;
    if (!definitions || at < 0) return { ...known, importType: "", targets: [], note: MAPPING_NOTES.notRead };
    const cell = byId.get(row.ids[0])?.cells[at];
    if (cell === undefined) {
      log(`Import mapping ${id || "?"}: not in the grid of definitions`);
      if (kind) add(kind.why, "definition not read");
      return { ...known, importType: "", targets: [], note: MAPPING_NOTES.noDefinition };
    }
    found++;
    // The import's own data source, where the export read them: why it has none, for the last line, where it has none.
    const reference = sourceIdOf(cell);
    const source = reference === undefined ? undefined : dataSources.get(reference);
    const why = !sources || sourceAt < 0 ? undefined : reference === undefined ? "no source in the definition" : !source ? "source not in the grid"
      : source.type === NOT_SET_UP ? "source not set up" : source.type === UNREADABLE ? "source not readable" : undefined;
    const model = source?.model ?? (kind === fromModels && source?.type !== "UPLOADED_FILE" ? { here: false } : undefined);
    try {
      const { mapping, shape, details } = readDefinition(cell, names, target < 0 ? undefined : row.cells[target] || undefined, model);
      log(`Import mapping ${id || "?"}: ${shape}`);
      for (const detail of details) log(`Import mapping ${id || "?"}: ${detail}`);
      const unnamed = new Set<number>();
      const inspect = (value: string | undefined) => {
        const id = idSaid(value);
        if (id !== undefined) unnamed.add(id);
        // A line item said to be missing has no name either: the log says what the client classes it as.
        for (const missing of missingIn(value ?? "")) if (missing.kind === "line item") unnamed.add(Number(missing.id));
      };
      for (const target of mapping.targets) {
        inspect(target.target);
        if (target.source === "constant") inspect(target.text);
      }
      for (const header of mapping.headers ?? []) inspect(header.lineItem);
      for (const property of mapping.matchedBy?.properties ?? []) inspect(property);
      // A column of a model's object that keeps its ID: of this model's, the log says what the client classes it as, as of
      // any other; of another model's, that this model's names are not its own.
      const kept = model ? mapping.targets.filter(target => target.source === "column" && idSaid(target.text) !== undefined) : [];
      if (model?.here) for (const target of kept) inspect(target.text);
      if (unnamed.size && names.describe) log(`Import mappings: ${known.name}: ${[...unnamed].map(entity => names.describe!(entity)).join("; ")}`);
      if (model && !model.here && kept.length) {
        log(`Import mappings: ${known.name}: ${kept.length} source ${kept.length === 1 ? "column keeps its ID" : "columns keep their IDs"}: `
          + (source?.model ? "the source is another model's" : "the source is not known"));
      }
      if (!periodsLogged && names.periodsLine) {
        const time = mapping.targets.find(target => target.target === "Time" && target.source === "constant" && idSaid(target.text) !== undefined);
        if (time) {
          log(`Import mappings: ${names.periodsLine(idSaid(time.text)!)}`);
          periodsLogged = true;
        }
      }
      if (mapping.note === undefined) read++;
      // What the page shows of the source: the File Options of uploaded data, and of a model's object nothing it keeps.
      const options = source?.options;
      if (kind) {
        const [shown, own, empty] = kind === uploaded ? [options !== undefined, "UPLOADED_FILE", "source holds no settings"]
          : [source?.model?.object !== undefined, "MODEL_OBJECT", "source names no object"];
        if (shown) kind.found++;
        else add(kind.why, mapping.note !== undefined ? "definition not read" : why ?? (source?.type === own ? empty : `source of type ${source?.type ?? "?"}`));
        if (kind === fromModels && source?.model && !source.model.here) elsewhere++;
      }
      return { ...known, ...mapping, ...(options ? { fileOptions: options } : {}) };
    } catch (error) {
      log(`Import mapping ${id || "?"}: ${error instanceof Error ? error.name : "error"} while reading the definition`);
      if (kind) add(kind.why, "definition not read");
      return { ...known, importType: "", targets: [], note: MAPPING_NOTES.unknown };
    }
  });
  // The page shows the log, and no word of the page names a file: nor do these lines.
  const where = !definitions ? "the model gave no grid of definitions" : at < 0 ? "the grid has no column of definitions" : `${found} found in the grid of definitions`;
  log(`Import mappings: ${read} of ${imports.length} read; ${where}`);
  if (sources && definitions && at >= 0) log(sourcesLine(sources.grid, sourceAt, dataSources, uploaded, fromModels, elsewhere));
  return mappings;
}

/** The log's line on the data sources, where the export read their definitions: how many definitions the grid holds, by
 * their types (Anaplan's own words, or not set up, or not readable); how many imports of uploaded data have File Options,
 * and how many of a model's object have the object they read, with how many of those are another model's; and why each
 * other one has not, counted by why. No setting, no name and no ID: a log a user passes on says how the sources are made,
 * not what they hold. */
function sourcesLine(grid: Grid, at: number, sources: ReadonlyMap<number, DataSource>, uploaded: SourcesFound, fromModels: SourcesFound, elsewhere: number): string {
  if (at < 0) return `Import mapping sources: no column of source definitions among the ${grid.columns.length} given`;
  const types = new Map<string, number>();
  for (const source of sources.values()) add(types, source.type);
  const why = (found: SourcesFound): string => (found.why.size ? ` (${tallied(found.why)})` : "");
  const imports = (count: number): string => `${count} ${count === 1 ? "import" : "imports"}`;
  const parts = [`${sources.size} ${sources.size === 1 ? "definition" : "definitions"}${types.size ? `: ${tallied(types)}` : ""}`,
    ...(uploaded.total ? [`settings for ${uploaded.found} of ${imports(uploaded.total)} of uploaded data${why(uploaded)}`] : []),
    ...(fromModels.total ? [`objects for ${fromModels.found} of ${imports(fromModels.total)} from a model${elsewhere ? `, ${elsewhere} in another model` : ""}${why(fromModels)}`] : [])];
  return `Import mapping sources: ${parts.join("; ")}`;
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

/** Optional memory access only: preserve the receiver, check the method, and contain a client's missing metadata or error.
 * What became of the call is kept for the log: its value, or that the method is missing or threw. */
function recall(owner: unknown, method: string, ...args: unknown[]): { value?: unknown; failure?: "missing" | "threw" } {
  try {
    const read = isObject(owner) ? owner[method] : undefined;
    return typeof read === "function" ? { value: read.apply(owner, args) } : { failure: "missing" };
  } catch { return { failure: "threw" }; }
}

/** The value of a call to the client's memory (`recall`), or nothing where the method is missing or threw. */
function memory(owner: unknown, method: string, ...args: unknown[]): unknown {
  return recall(owner, method, ...args).value;
}

const field = (value: unknown, key: string): unknown => isObject(value) ? value[key] : undefined;
const infoName = (value: unknown): string | undefined => {
  const name = field(value, "label") ?? field(value, "name");
  return named(name) ? plainText(name) : undefined;
};

/** A count with its noun, for the log: "1 period", "3 periods". */
const counted = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`;

/** The client's own information on the model's time scale (anaplan/data/ModelContentCache.js): of its superset first, then of
 * the time scale itself. Each getter asserts that the model is loaded, and may throw. */
const TIMESCALES = ["getTimescaleSupersetInfo", "getTimescaleInfo"] as const;

/** What one getter of `TIMESCALES` held of periods, for the log: its label pages and their periods, or that it is missing or
 * threw. */
type PeriodSource = { getter: string; failure: "missing" | "threw" } | { getter: string; pages: number; periods: number };

/** The client's own labels of the model's periods, by their IDs, with what each getter of `TIMESCALES` held. Each info's
 * `allowedTimeEntityPeriodTypeLabelPages` has a label page for each period type the model allows, which the client's own
 * editors name a period by (gridlet/_editor/TimeEntityEditor.js, view/Filter/Condition.js): the place of its ID in the
 * page's first list of IDs, and the label in that place of its first list of labels. Each getter is called once, through
 * the guard. Only a whole number above 0 is an ID, and only text that is not blank a label; an ID is looked up as it is,
 * and nothing is worked out of its digits. A period's first label is kept: the superset's before the time scale's. */
function periodLabels(cache: unknown): { labels: Map<number, string>; sources: PeriodSource[] } {
  const labels = new Map<number, string>();
  const sources = TIMESCALES.map((getter): PeriodSource => {
    const { value, failure } = recall(cache, getter);
    if (failure) return { getter, failure };
    let [pages, periods] = [0, 0];
    try {
      const all = field(value, "allowedTimeEntityPeriodTypeLabelPages");
      for (const page of Array.isArray(all) ? all : []) {
        const [ids, said] = [field(page, "entityLongIds"), field(page, "labels")];
        const own: unknown = Array.isArray(ids) ? ids[0] : undefined;
        const words: unknown = Array.isArray(said) ? said[0] : undefined;
        if (!Array.isArray(own) || !Array.isArray(words)) continue;
        pages++;
        own.forEach((id: unknown, at: number) => {
          const label: unknown = words[at];
          if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0 || !named(label)) return;
          periods++;
          if (!labels.has(id)) labels.set(id, plainText(label));
        });
      }
    } catch {
      // Information the client holds in a way of its own: what it held up to there is kept.
    }
    return { getter, pages, periods };
  });
  return { labels, sources };
}

/** The names of a model's lists and line items, by the grids the export has read: General Lists (a list's own row) and
 * Line Items (a line item's own row). For one they do not have, as a list subset, the model page's own lists of names:
 * the lists, the list subsets and a module's line items, as the dialog looks them up (anaplan/widgets/Mapping.js
 * `_lookupHierarchyLabel`), and a list's properties, which no grid of the export lists. Whether a list is numbered is its
 * row's Numbered cell of General Lists, "true" or "false", and not known for a list the grid does not have. Remaining IDs
 * use getEntityTypeIndex and getEntityType, as Model Building does in anaplan-sam's authoring-core.ts. A dynamic type's
 * hierarchyEntityLongId identifies its owning list; labels and metadata here are optional memory lookups, never reads. A
 * line item of that class that nothing names is said as missing. A period is named by the client's own labels of the
 * model's periods (`periodLabels`), taken once, when a constant into Time first needs one, and then by the Model
 * Calendar's period choices, which the export's read of the calendar kept (`periods`). */
export function importNames(native: Native, grids: { lists?: Grid; lineItems?: Grid; modules?: Grid }, periods: ReadonlyMap<number, string> = new Map()): ImportNames {
  const byId = (grid: Grid | undefined): Map<number, string> => {
    const names = new Map<number, string>();
    for (const row of grid?.rows ?? []) if (Number.isSafeInteger(row.ids[0]) && named(row.labels[0]) && !names.has(row.ids[0])) names.set(row.ids[0], row.labels[0]);
    return names;
  };
  const lists = byId(grids.lists);
  const lineItems = byId(grids.lineItems);
  const modules = byId(grids.modules);
  const numberedAt = grids.lists ? columnAt(grids.lists, "Numbered") : -1;
  const numbered = new Map<number, boolean>();
  for (const row of numberedAt < 0 ? [] : grids.lists?.rows ?? []) {
    const cell = (row.cells[numberedAt] ?? "").trim().toLowerCase();
    if (Number.isSafeInteger(row.ids[0]) && (cell === "true" || cell === "false") && !numbered.has(row.ids[0])) numbered.set(row.ids[0], cell === "true");
  }
  const cache = native.cache;
  const pageLabel = (method: string, id: number, ...args: unknown[]) => labelIn(() => memory(cache, method, ...args), id);
  const hierarchy = (id: number) => memory(cache, "getHierarchyInfo", id);
  const listName = (id: number): string | undefined => lists.get(id) ?? pageLabel("getHierarchiesLabelPage", id)
    ?? pageLabel("getHierarchySubsetsLabelPage", id) ?? infoName(hierarchy(id));
  const types = new Map<number, { index?: number; kind?: string; list?: number }>();
  const entityInfo = (id: number) => {
    const known = types.get(id);
    if (known) return known;
    const index = memory(native.ids, "getEntityTypeIndex", id);
    const type = typeof index === "number" && Number.isSafeInteger(index) && index >= 0 ? memory(cache, "getEntityType", index) : undefined;
    const list = idOf(field(type, "hierarchyEntityLongId"));
    const kind = field(type, "entityTypeClass");
    const info = { ...(typeof index === "number" && Number.isSafeInteger(index) && index >= 0 ? { index } : {}),
      ...(named(kind) ? { kind } : {}), ...(Number.isSafeInteger(list) && list > 0 ? { list } : {}) };
    types.set(id, info);
    return info;
  };
  // The client's labels of the model's periods: taken on first use, and kept for the run, with a getter that failed.
  let clientPeriods: ReturnType<typeof periodLabels> | undefined;
  const periodsHeld = () => (clientPeriods ??= periodLabels(cache));
  const names: ImportNames = {
    list: listName,
    lineItem: (id, module) => lineItems.get(id) ?? pageLabel("getLineItemsLabelPage", id, module),
    property: (id, list) => labelIn(() => field(hierarchy(list), "propertiesLabelPage"), id) ?? pageLabel("getHierarchySubsetsLabelPage", id),
    numbered: list => numbered.get(list),
    period: id => periodsHeld().labels.get(id) ?? periods.get(id),
    periodsLine: id => {
      const held = periodsHeld().sources.map(source => `${source.getter}: ${"failure" in source ? source.failure
        : `${counted(source.pages, "label page", "label pages")}, ${counted(source.periods, "period", "periods")}`}`);
      return `Time constant ${asId(id)} is not among the client's periods (${held.join("; ")}) or the Model Calendar's `
        + `${counted(periods.size, "period choice", "period choices")}; unnamed Time constants keep their IDs.`;
    },
    entity: (id, into, constant = false) => {
      const { index, kind, list } = entityInfo(id);
      if (kind === "CUSTOM" && list !== undefined) {
        const info = hierarchy(list);
        const item = pageLabel("getHierarchyLabelPage", id, list)
          ?? labelIn(() => field(info, "labelPage"), id) ?? labelIn(() => field(info, "itemsLabelPage"), id);
        const owner = listName(list);
        // A target can refer to the list's dynamic type. A constant must name the item itself.
        return item ? `${item} (${owner ?? asId(list)})` : constant ? undefined : owner;
      }
      if (kind === "HIERARCHY" || kind === "LIST" || index === 101) return listName(id) ?? (list === undefined ? undefined : listName(list));
      if (kind === "LINE_ITEM") {
        const info = memory(native.helper, "getLineItemInfo", cache, id);
        const module = idOf(field(info, "moduleEntityLongId"));
        // A line item that nothing names is one the import still maps to that the model doesn't have, as far as a Line Items
        // grid that was read says: without one, nothing proves it is gone, and its ID stays.
        return names.lineItem(id, Number.isFinite(module) ? module : into) ?? infoName(info) ?? (lineItems.size ? missingText("line item", String(id)) : undefined);
      }
      if (kind === "MODULE" || index === 102) return modules.get(id) ?? pageLabel("getModulesLabelPage", id) ?? infoName(memory(cache, "getModuleInfo", id));
      // Subsets and properties also have label pages in models where their class is SYSTEM.
      return names.list(id) ?? names.lineItem(id, into) ?? names.property(id, list ?? into)
        ?? pageLabel("getLineItemSubsetsLabelPage", id);
    },
    describe: id => {
      const { index, kind, list } = entityInfo(id);
      return `${asId(id)} is entity type ${index ?? "unknown"} (class ${kind ?? "unknown"}${list === undefined ? "" : `, list ${list}`}) with no name in the client`;
    },
  };
  return names;
}
