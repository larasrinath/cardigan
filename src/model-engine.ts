import type { Progress } from "./progress.js";
import { getJson, RestError } from "./rest.js";
import { message, SCOPE_ID } from "./util.js";

export type ModelEngine = "classic" | "polaris" | "unknown";
export interface EngineScope { customerId?: string; workspaceId?: string; modelId: string }
export interface EngineDetails { engine: ModelEngine; modelName?: string; workspaceName?: string }

const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

/** The platform gateway and Model Building use these two engine values. Anything else needs a fallback. */
export function parseEngine(value: unknown): ModelEngine {
  return typeof value === "string" && value.toLowerCase() === "hyperblock" ? "classic"
    : typeof value === "string" && value.toLowerCase() === "calculation_engine" ? "polaris" : "unknown";
}

const ENGINE_FIELDS = ["engine", "engineType", "calculationEngine", "modelType", "isPolaris", "dataEngineType"] as const;
const engineOf = (details: Record<string, unknown>): ModelEngine => {
  for (const field of ENGINE_FIELDS) {
    const value = details[field];
    const engine = field === "isPolaris" && typeof value === "boolean" ? (value ? "polaris" : "classic") : parseEngine(value);
    if (engine !== "unknown") return engine;
  }
  return "unknown";
};
const fields = (details: Record<string, unknown>): string => Object.keys(details).sort().join(", ") || "none";
const name = (value: unknown): string | undefined => typeof value === "string" && value.trim() ? value : undefined;

/** GET only, using the same session and headers as the page's other REST reads. The native platform contracts are
 * getModel (one model) and getWorkspaces (the customer's directory); only this workspace's entry is inspected.
 * Neither a refused read nor an unfamiliar engine prevents the existing Classic reader from running. */
export async function detectModelEngine(scope: EngineScope, progress: Progress, signal?: AbortSignal,
  read: typeof getJson = getJson): Promise<EngineDetails> {
  const result: EngineDetails = { engine: "unknown" };
  const { customerId, workspaceId, modelId } = scope;
  signal?.throwIfAborted();
  if (customerId && workspaceId && [customerId, workspaceId, modelId].every(id => SCOPE_ID.test(id))) {
    const base = `/a/springboard-platform-gateway-service/customers/${customerId}/workspaces`;
    progress.status("Checking the model's engine…");
    try {
      const model = object(await read(`${base}/${workspaceId}/models/${modelId}`, { timeoutMs: 5000 }));
      progress.log(`Engine detection: model details fields: ${fields(model)}`);
      result.engine = engineOf(model);
      result.modelName = name(model.label) ?? name(model.name);
      result.workspaceName = name(model.workspaceName);
    } catch (error) {
      if (error instanceof RestError && error.code === "MAINTENANCE") throw error;
      progress.log(`Engine detection: model details unavailable (${message(error)})`);
    }
    signal?.throwIfAborted();
    if (result.engine === "unknown") {
      try {
        const directory = await read(base, { timeoutMs: 5000 });
        const workspace = (Array.isArray(directory) ? directory : []).map(object)
          .find(item => String(item.WorkspaceGuid ?? item.id ?? "").toLowerCase() === workspaceId.toLowerCase());
        progress.log(`Engine detection: workspace entry fields: ${fields(workspace ?? {})}`);
        result.engine = engineOf(workspace ?? {});
        result.workspaceName ??= name(workspace?.Name) ?? name(workspace?.label) ?? name(workspace?.name);
      } catch (error) {
        if (error instanceof RestError && error.code === "MAINTENANCE") throw error;
        progress.log(`Engine detection: workspace details unavailable (${message(error)})`);
      }
    }
  } else progress.log("Engine detection: the address does not name the customer, workspace and model needed for platform details");
  signal?.throwIfAborted();
  // Both engines can load the Classic client; its presence says nothing about the calculation engine.
  progress.log(`Engine detection: ${result.engine === "polaris" ? "Polaris" : result.engine === "classic" ? "Classic" : "unknown"}; trying the Classic reader first`);
  return result;
}
