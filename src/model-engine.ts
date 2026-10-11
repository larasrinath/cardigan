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

const raw = (value: unknown): string => value === undefined ? "missing" : JSON.stringify(value)?.replace(/[\r\n]/g, " ").slice(0, 120) ?? "missing";
const name = (value: unknown): string | undefined => typeof value === "string" && value.trim() ? value : undefined;

/** GET only, using the same session and headers as the page's other REST reads. The native platform contracts are
 * getModel (one model) and getWorkspaces (the customer's directory); only this workspace's entry is inspected.
 * Neither a refused read nor an unfamiliar engine prevents the existing Classic reader from running. */
export async function detectModelEngine(scope: EngineScope, classicFrame: () => boolean, progress: Progress, signal?: AbortSignal,
  read: typeof getJson = getJson): Promise<EngineDetails> {
  const result: EngineDetails = { engine: "unknown" };
  const { customerId, workspaceId, modelId } = scope;
  signal?.throwIfAborted();
  if (customerId && workspaceId && [customerId, workspaceId, modelId].every(id => SCOPE_ID.test(id))) {
    const base = `/a/springboard-platform-gateway-service/customers/${customerId}/workspaces`;
    progress.status("Checking the model's engine…");
    try {
      const model = object(await read(`${base}/${workspaceId}/models/${modelId}`, { timeoutMs: 5000 }));
      progress.log(`Engine detection: model.engine=${raw(model.engine)}`);
      result.engine = parseEngine(model.engine);
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
        progress.log(`Engine detection: workspace.dataEngineType=${raw(workspace?.dataEngineType)}`);
        result.engine = parseEngine(workspace?.dataEngineType);
        result.workspaceName ??= name(workspace?.Name) ?? name(workspace?.label) ?? name(workspace?.name);
      } catch (error) {
        if (error instanceof RestError && error.code === "MAINTENANCE") throw error;
        progress.log(`Engine detection: workspace details unavailable (${message(error)})`);
      }
    }
  } else progress.log("Engine detection: the address does not name the customer, workspace and model needed for platform details");
  signal?.throwIfAborted();
  if (result.engine === "unknown" && classicFrame()) {
    result.engine = "classic";
    progress.log("Engine detection: a Classic frame answered");
  }
  progress.log(`Engine detection: ${result.engine === "polaris" ? "Polaris; reading a partial result without the Classic frame"
    : result.engine === "classic" ? "Classic; reading model settings" : "unknown; continuing with the Classic reader"}`);
  return result;
}
