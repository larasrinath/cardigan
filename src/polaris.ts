import type { ModelCatalog } from "./catalog.js";
import type { EngineDetails, EngineScope } from "./model-engine.js";
import type { AnalysisResult, Cell, ResultTable } from "./result-types.js";
import { LINE_ITEMS } from "./report.js";
import { quoted } from "./map/graph-names.js";
import { polarisId, polarisText as value, type PolarisReader } from "./polaris-read.js";
import { fileSafe, text, type Obj } from "./util.js";

export const POLARIS_NOTE = "Not read yet on Polaris: Model Calendar, Time Ranges, Line Item Subsets, Dynamic Cell Access, Other Actions, Source Models, list properties or subset membership, functional area assignments, import mappings and process steps.";
export const POLARIS_MAPPING_NOTE = "Polaris: the import's mapping isn't read yet";
export const POLARIS_STEPS_NOTE = "Polaris: its steps aren't read yet";

/** Only exact, unambiguous type labels. A list name, a period label or a description is not a type definition. */
export function polarisFormatType(format: unknown): string {
  return new Map([["number", "Number"], ["boolean", "Boolean"], ["date", "Date"], ["text", "Text"], ["no data", "No Data"]])
    .get(value(format).trim().toLowerCase()) ?? "";
}

/** Kept results from before settings reads remain readable, without offering an empty map. */
export function hasModelMap(result: AnalysisResult | undefined): boolean {
  if (result?.kind !== "model") return false;
  if (result.engine !== "polaris") return true;
  const items = result.tables.find(table => table.file === "Line Items.csv");
  const at = items?.headers.indexOf("Formula") ?? -1;
  return at >= 0 && !!items?.rows.some(row => String(row[at] ?? "").trim());
}

const table = (label: string, headers: string[], rows: Cell[][]): ResultTable => ({ file: `${label}.csv`, label, guard: true, headers, rows });
const strings = (item: Obj | undefined, keys: string[]): string[] => keys.map(key => value(item?.[key]));

/** Module metadata joins by a unique exact name: the receipt does not establish the LLM module ID field.
 * No join is made from ordering or count agreement. */
export function polarisResult(scope: EngineScope, details: EngineDetails, catalog: ModelCatalog, read?: PolarisReader): AnalysisResult {
  const name = details.modelName ?? "Polaris model";
  const metadata = new Map<string, Obj[]>();
  for (const item of read?.modules ?? []) if (text(item.name)) metadata.set(item.name, [...metadata.get(item.name) ?? [], item]);
  const counts = new Map<string, number>();
  for (const name of catalog.modules.values()) counts.set(name, (counts.get(name) ?? 0) + 1);
  const moduleRows: Cell[][] = [...catalog.modules].map(([id, name]) => {
    const matches = metadata.get(name) ?? [];
    const item = counts.get(name) === 1 && matches.length === 1 ? matches[0] : undefined;
    const dimensions = (catalog.moduleViewDimensions.get(id) ?? []).filter(d => d.id !== LINE_ITEMS)
      .map(d => quoted(catalog.dimensions.get(d.id) ?? d.name)).join(", ");
    return [name, value(item?.applies_to), ...strings(item, ["time_scale", "time_range", "versions", "notes"]), "", dimensions, id];
  });
  for (const [name, items] of metadata) if (!counts.has(name)) for (const item of items) {
    moduleRows.push([name, value(item.applies_to), ...strings(item, ["time_scale", "time_range", "versions", "notes"]), "", "", ""]);
  }
  const modules = table("Modules", ["", "Applies To", "Time Scale", "Time Range", "Versions", "Notes", "Functional Area", "Dimensions", "Module ID"], moduleRows);
  const listDetails = new Map((read?.lists ?? []).map(item => [polarisId(item.id), item]));
  const lists = table("General Lists", ["", "Parent Hierarchy", "Display Name Property", "Subset Count", "Properties", "List ID"],
    [...catalog.lists].map(([id, name]) => {
      const item = listDetails.get(id);
      const parent = polarisId(item?.parentId);
      const property = polarisId(item?.displayNamePropertyId);
      // The evidence gives no property definitions or per-list subset membership. Unknown is blank, never zero.
      return [name, parent ? catalog.lists.get(parent) ?? parent : "", property ? catalog.dimensions.get(property) ?? "" : "", "", "", id];
    }));
  const lineItems = table("Line Items", ["", "Module Name", "Format", "Format type", "Formula", "Applies To", "Summary", "Time Scale", "Time Range", "Versions", "Notes"],
    [...catalog.modules].flatMap(([id, name]) => (read?.lineItems.get(id) ?? []).map(item => [value(item.name), name, value(item.format), polarisFormatType(item.format),
      ...strings(item, ["formula", "appliesTo", "summary", "time_scale", "time_range", "versions", "notes"])])));
  const imports = table("Imports", ["", "Import Type", "Import Data Source ID", "Import ID"],
    (read?.actions.get("imports") ?? []).filter(item => text(item.name)).map(item => strings(item, ["name", "importType", "importDataSourceId", "id"])));
  const exports = table("Exports", ["", "Export ID"], (read?.actions.get("exports") ?? []).filter(item => text(item.name)).map(item => strings(item, ["name", "id"])));
  const processes = table("Processes", ["", "Process ID"], (read?.actions.get("processes") ?? []).filter(item => text(item.name)).map(item => strings(item, ["name", "id"])));
  const versions = table("Versions", [""], (read?.versions ?? []).filter(item => text(item.name)).map(item => [item.name]));
  const tables = [modules, lists, lineItems, imports, exports, processes, versions].filter(table => table.rows.length > 0);
  const how: [string, string][] = [
    ["Modules", "Polaris module settings keep the service's Applies To, Time Scale, Time Range, Versions and Notes strings. Dimensions comes separately from moduleViews, by ID and name; an unknown dimension stays as its ID. Settings join by unique exact module names. Functional Area is not known."],
    ["Line Items", "One row per line item returned by each module's Polaris metadata GET. Strings stay as read; Format type is filled only for an exact type label. Formula links on the Model map are matched by name; unmatched or ambiguous references stay unresolved. No access drivers or calculation metrics are read. Pagination completeness is unknown."],
    ["General Lists", "Names and parent IDs come from lists; a parent is named where its ID resolves. Display Name Property is filled only where its ID has a name. Properties and Subset Count stay blank: the probe found no property definitions or per-list subset membership, and extra entries in lists with subsets do not establish it."],
    ["Imports", "The shared action listing gives names, Import Type and Import Data Source ID. Import Type keeps the service's category without guessing a target. Source references are IDs, not source definitions. Import mappings are not read."],
    ["Exports", "Names and IDs from the shared action listing where it returns entries. The probe's export listing was empty; no export definition is established."],
    ["Processes", "Names and IDs from the shared action listing. Process steps and their order are not read."],
    ["Versions", "Polaris version names only; actual, current, switchover and other version settings are not read."],
  ];
  const summary = [POLARIS_NOTE, "Polaris listing completeness is unknown.", ...tables.map(table => `${table.label}: ${table.rows.length} rows`)];
  if (read?.partial.size) summary.push(`Polaris answers may be cut short in ${read.partial.size} sources; only returned rows are shown.`);
  if (read?.unavailable.size) summary.push(`Polaris skipped ${read.unavailable.size} unavailable sources; see the diagnostic log.`);
  return { kind: "model", engine: "polaris", name, id: scope.modelId, zipName: `${fileSafe(name, "Polaris model")} - Partial Model Export.zip`, summary,
    moduleIds: [...catalog.modules].map(([id, label]) => [label, id]), listIds: [...catalog.lists].map(([id, label]) => [label, id]),
    tables: [{ file: "Model Details.csv", label: "Model Details", details: true, guard: true, headers: ["Section", "Detail", "Value"], rows: [
      ["Model", "Workspace", details.workspaceName ?? "Name not available"], ["Model", "Workspace ID", scope.workspaceId ?? "Not available"],
      ["Model", "Model", name], ["Model", "Model ID", scope.modelId],
      ...tables.map(table => ["Files", table.file, `${table.rows.length} rows`]),
      ...how.map(([label, words]) => ["How to read", label, words]),
    ] }, ...tables] };
}

/** Called after page tables have joined the result, so the note says what this run actually holds. */
export function describePolarisRead(result: AnalysisResult): void {
  const names = result.tables.filter(table => !table.details && table.rows.length).map(table => table.label);
  result.summary.unshift(names.length ? `Polaris read: ${names.join(", ")}${hasModelMap(result) ? ", and a Model map from formulas" : ""}.` : "No Polaris source returned table rows.");
}
