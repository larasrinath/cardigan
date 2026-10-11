export type ModelEngine = "classic" | "polaris" | "unknown";
export interface EngineScope { customerId?: string; workspaceId?: string; modelId: string }
export interface EngineDetails { engine: ModelEngine; modelName?: string; workspaceName?: string }

/** The full export identifies Polaris by either of its Line Items columns; otherwise it is Classic. */
export function engineFromColumns(headers: readonly string[]): ModelEngine {
  return headers.some(header => header === "Populated Cell Count" || header === "Calculation Complexity") ? "polaris" : "classic";
}

export function engineLine(engine: ModelEngine): string {
  return engine === "unknown" ? "Engine: unknown (no Classic client)"
    : `Engine: ${engine === "polaris" ? "Polaris" : "Classic"} (from the Line Items columns)`;
}

export const POLARIS_FULL_NOTE = "Polaris model, read in full through Model Building.";
