export type ModelEngine = "classic" | "polaris" | "unknown";
export interface EngineScope { customerId?: string; workspaceId?: string; modelId: string }
export interface EngineDetails { engine: ModelEngine; modelName?: string; workspaceName?: string }

/** The full export identifies Polaris by either of its Line Items columns; otherwise it is Classic. The columns are those of
 * the Line Items table, or, where the export has none, those the grid's first page gave (result-types.ts `lineItemColumns`):
 * a grid whose later pages the model refused says its engine all the same. Where neither is there, the Modules table's
 * columns say it: a Polaris model's Modules grid has Populated Cell Count too (seen live, 12 Oct 2026: "Cell Count |
 * Populated Cell Count | Memory Used"). */
export function engineFromColumns(headers: readonly string[]): ModelEngine {
  return headers.some(header => header === "Populated Cell Count" || header === "Calculation Complexity") ? "polaris" : "classic";
}

/** The table whose columns told the engine. */
export type EngineSource = "Line Items" | "Modules";

/** The columns the engine is told by (`engineFromColumns`): Line Items' table's, or its grid's first page's, else the Modules
 * table's; and which. None of them is Line Items' none, which says Classic, as ever. */
export function engineColumns(lineItems: readonly string[] | undefined, modules: readonly string[] | undefined): { columns: readonly string[]; from: EngineSource } {
  return lineItems === undefined && modules !== undefined ? { columns: modules, from: "Modules" } : { columns: lineItems ?? [], from: "Line Items" };
}

export function engineLine(engine: ModelEngine, from: EngineSource = "Line Items"): string {
  return engine === "unknown" ? "Engine: unknown (no Classic client)"
    : `Engine: ${engine === "polaris" ? "Polaris" : "Classic"} (from the ${from} columns)`;
}

export const POLARIS_FULL_NOTE = "Polaris model, read in full through Model Building.";
