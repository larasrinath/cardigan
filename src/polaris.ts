import type { ModelCatalog } from "./catalog.js";
import type { EngineDetails, EngineScope } from "./model-engine.js";
import type { AnalysisResult, ResultTable } from "./result-types.js";
import { LINE_ITEMS } from "./report.js";
import { quoted } from "./map/graph-names.js";
import { fileSafe } from "./util.js";

export const POLARIS_NOTE = "This is a Polaris model. Cardigan can't read a Polaris model's settings yet, so Line Items, Actions and the Model map aren't shown.";

/** A partial model result from the socket's inventory. No empty settings tables, and no assumption that every
 * dimension label is a General List. IDs remain available for opening the model's modules and lists. */
export function polarisResult(scope: EngineScope, details: EngineDetails, catalog: ModelCatalog): AnalysisResult {
  const name = details.modelName ?? "Polaris model";
  const modules: ResultTable = { file: "Modules.csv", label: "Modules", guard: true, headers: ["", "Applies To", "Module ID"],
    rows: [...catalog.modules].map(([id, label]) => [label, (catalog.moduleViewDimensions.get(id) ?? catalog.moduleDimensions.get(id) ?? [])
      .filter(dimension => dimension.id !== LINE_ITEMS)
      .map(dimension => quoted(catalog.dimensions.get(dimension.id) ?? dimension.name)).join(", "), id]) };
  const lists: ResultTable = { file: "General Lists.csv", label: "General Lists", guard: true, headers: ["", "List ID"],
    rows: [...catalog.lists].map(([id, label]) => [label, id]) };
  const tables = [modules, lists].filter(table => table.rows.length > 0);
  return { kind: "model", engine: "polaris", name, id: scope.modelId, zipName: `${fileSafe(name, "Polaris model")} - Partial Model Export.zip`,
    summary: [POLARIS_NOTE, ...tables.map(table => `${table.label}: ${table.rows.length} rows`)],
    moduleIds: [...catalog.modules].map(([id, label]) => [label, id]), listIds: [...catalog.lists].map(([id, label]) => [label, id]),
    tables: [{ file: "Model Details.csv", label: "Model Details", details: true, guard: true, headers: ["Section", "Detail", "Value"], rows: [
      ["Model", "Workspace", details.workspaceName ?? "Name not available"], ["Model", "Workspace ID", scope.workspaceId ?? "Not available"],
      ["Model", "Model", name], ["Model", "Model ID", scope.modelId],
      ...tables.map(table => ["Files", table.file, `${table.rows.length} rows`]),
      ["How to read", "Modules", "Names from the model data service, with the dimensions it supplies. An empty Applies To cell means the dimensions were not supplied or the module has none; it is not a full settings read."],
      ["How to read", "General Lists", "List names and IDs from the model data service. Time and other dimension labels are not counted as General Lists; list settings are not read."],
    ] }, ...tables] };
}
