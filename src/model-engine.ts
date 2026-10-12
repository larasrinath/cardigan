export type ModelEngine = "classic" | "polaris" | "unknown";
export interface EngineScope { customerId?: string; workspaceId?: string; modelId: string }
export interface EngineDetails { engine: ModelEngine; modelName?: string; workspaceName?: string }

/** The full export identifies Polaris by either of its Line Items columns; otherwise it is Classic. The columns are those of
 * the Line Items table, or, where the export has none, those the grid's first page gave (result-types.ts `lineItemColumns`):
 * a grid whose later pages the model refused says its engine all the same. */
export function engineFromColumns(headers: readonly string[]): ModelEngine {
  return headers.some(header => header === "Populated Cell Count" || header === "Calculation Complexity") ? "polaris" : "classic";
}

export function engineLine(engine: ModelEngine): string {
  return engine === "unknown" ? "Engine: unknown (no Classic client)"
    : `Engine: ${engine === "polaris" ? "Polaris" : "Classic"} (from the Line Items columns)`;
}

export const POLARIS_FULL_NOTE = "Polaris model, read in full through Model Building.";
