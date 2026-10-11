import { addLists, addModuleViews, emptyCatalog } from "./catalog.js";
import { PolarisReader } from "./polaris-read.js";
import { describePolarisRead, polarisResult } from "./polaris.js";

// Entirely invented model and service answers, shaped like the sanitized probe schema.
export const POLARIS_IDS = { customerId: "D".repeat(32), workspaceId: "E".repeat(32), modelId: "F".repeat(32) };
export const POLARIS_ENGINE = { engine: "polaris", modelName: "Orchard planning", workspaceName: "Practice workspace" } as const;
export const POLARIS_VIEWS = { data: [
  { id: 102000000501, name: "Inputs", dimensions: ["101000000501"], views: [] },
  { id: 102000000502, name: "Forecast", dimensions: ["101000000501", "20000000003"], views: [] },
  { id: 102000000503, name: "Empty module", dimensions: [], views: [] },
], dimensions: { "101000000501": { id: "101000000501", label: "Products" }, "20000000003": { id: "20000000003", label: "Time" } } };
export const POLARIS_LISTS = { data: [
  { id: 101000000501, name: "Products", parentId: "101000000502", displayNamePropertyId: "199000000501" },
  { id: 101000000502, name: "Families", parentId: null, displayNamePropertyId: null },
] };
export const POLARIS_MODULES = [
  { name: "Forecast", applies_to: "Products", time_scale: "Month", time_range: "Planning horizon", versions: "All Versions", notes: "Monthly forecast" },
  { name: "Inputs", applies_to: "Products", time_scale: "Not Applicable", time_range: "Not Applicable", versions: "Not Applicable", notes: "Drivers" },
  { name: "Empty module", applies_to: "", time_scale: "Not Applicable", time_range: "Not Applicable", versions: "Not Applicable", notes: "" },
];
export const polarisItem = (name: string, entityLongId: number, formula = "", format = "Number") => ({ name, entityLongId, formula, format,
  appliesTo: "Products", summary: "Sum", time_scale: "Month", time_range: "Planning horizon", versions: "All Versions", notes: "" });
export const POLARIS_ITEMS = new Map([
  ["102000000501", [polarisItem("Units", 1901000000501), polarisItem("Unit Price", 1901000000502)]],
  ["102000000502", [polarisItem("Revenue", 1902000000501, "'Inputs'.Units * 'Inputs'.'Unit Price'"),
    polarisItem("Adjusted Revenue", 1902000000502, "Revenue * 1.05"), polarisItem("Ready", 1902000000503, "Revenue > 0", "Boolean")]],
  ["102000000503", []],
]);

export function polarisFixture() {
  const catalog = emptyCatalog();
  addModuleViews(catalog, POLARIS_VIEWS);
  addLists(catalog, POLARIS_LISTS);
  const reader = new PolarisReader(POLARIS_IDS, { log: () => undefined, status: () => undefined });
  reader.modules = POLARIS_MODULES;
  reader.lists = POLARIS_LISTS.data;
  reader.lineItems = POLARIS_ITEMS;
  reader.versions = [{ name: "Actual" }, { name: "Plan" }];
  reader.actions.set("imports", [{ id: "112000000501", name: "Load units", importType: "MODULE_DATA", importDataSourceId: "115000000501" }]);
  reader.actions.set("exports", [{ id: "113000000501", name: "Forecast extract" }]);
  reader.actions.set("processes", [{ id: "118000000501", name: "Refresh forecast" }]);
  const result = polarisResult(POLARIS_IDS, POLARIS_ENGINE, catalog, reader);
  describePolarisRead(result);
  return { catalog, reader, result };
}
