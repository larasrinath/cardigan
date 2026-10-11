import type { EngineDetails, EngineScope } from "./model-engine.js";
import type { Progress } from "./progress.js";
import { getJson, RestError } from "./rest.js";
import { message, SCOPE_ID } from "./util.js";

type ModelNames = Pick<EngineDetails, "modelName" | "workspaceName">;
const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const name = (value: unknown): string | undefined => typeof value === "string" && value.trim() ? value : undefined;

/** Only the frame-free reader needs these names: the full reader gets them from its client.
 * No engine fields are read, and neither field names nor returned values enter the log. */
export async function readModelNames(scope: EngineScope, progress: Progress, signal?: AbortSignal,
  read: typeof getJson = getJson): Promise<ModelNames> {
  const result: ModelNames = {};
  const { customerId, workspaceId, modelId } = scope;
  signal?.throwIfAborted();
  if (!customerId || !workspaceId || ![customerId, workspaceId, modelId].every(id => SCOPE_ID.test(id))) return result;
  const base = `/a/springboard-platform-gateway-service/customers/${customerId}/workspaces`;
  try {
    const model = object(await read(`${base}/${workspaceId}/models/${modelId}`, { timeoutMs: 5000 }));
    result.modelName = name(model.label) ?? name(model.name);
    result.workspaceName = name(model.workspaceName);
  } catch (error) {
    if (error instanceof RestError && error.code === "MAINTENANCE") throw error;
    progress.log(`Model name unavailable (${message(error)})`);
  }
  signal?.throwIfAborted();
  if (!result.workspaceName) {
    try {
      const directory = await read(base, { timeoutMs: 5000 });
      const workspace = (Array.isArray(directory) ? directory : []).map(object)
        .find(item => String(item.WorkspaceGuid ?? item.id ?? "").toLowerCase() === workspaceId.toLowerCase());
      result.workspaceName = name(workspace?.Name) ?? name(workspace?.label) ?? name(workspace?.name);
    } catch (error) {
      if (error instanceof RestError && error.code === "MAINTENANCE") throw error;
      progress.log(`Workspace name unavailable (${message(error)})`);
    }
  }
  signal?.throwIfAborted();
  return result;
}
