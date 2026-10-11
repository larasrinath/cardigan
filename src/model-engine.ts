export type ModelEngine = "classic" | "polaris" | "unknown";
export type DataEngineType = "HYPERBLOCK" | "CALCULATION_ENGINE";
export interface EngineScope { customerId?: string; workspaceId?: string; modelId: string }
export interface EngineDetails { engine: ModelEngine; modelName?: string; workspaceName?: string }

/** Only the page's two known values cross the frame boundary; unfamiliar values are not logged. */
export const knownDataEngineType = (value: unknown): DataEngineType | undefined =>
  value === "HYPERBLOCK" || value === "CALCULATION_ENGINE" ? value : undefined;

export function parseEngine(value: unknown): ModelEngine {
  return value === "HYPERBLOCK" ? "classic" : value === "CALCULATION_ENGINE" ? "polaris" : "unknown";
}

export function engineLine(value: unknown): string {
  const engine = parseEngine(value);
  return engine === "unknown" ? "Engine: unknown (dataEngineType missing or unrecognized)"
    : `Engine: ${engine === "polaris" ? "Polaris" : "Classic"} (dataEngineType ${knownDataEngineType(value)})`;
}

export const POLARIS_FULL_NOTE = "Polaris model, read in full through Model Building.";

/** These columns are positive evidence of Polaris. Their absence (or an unread grid) cannot establish Classic.
 * This check reports a disagreement without replacing the decision made from the page before any reads. */
export function engineCrossCheck(engine: ModelEngine, headers: readonly string[]): string | undefined {
  if (!headers.some(header => header === "Populated Cell Count" || header === "Calculation Complexity")) return;
  if (engine === "classic") return "Engine cross-check: Polaris-only Line Items columns disagree with dataEngineType HYPERBLOCK (Classic).";
  if (engine === "unknown") return "Engine cross-check: Polaris-only Line Items columns found; dataEngineType is unknown.";
}
