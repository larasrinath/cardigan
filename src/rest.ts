import { ANAPLAN_HOST } from "./util.js";
import { maintenanceHtml } from "./maintenance.js";

/** GET-only JSON reads on the page's own origin, sent the way the Anaplan web client sends them (same headers and
 * XSRF cookie echo). Only the services and metadata/name routes the analyser reads are allowed. */

export type RestErrorCode = "INVALID_PATH" | "SIGNED_OUT" | "HTTP_ERROR" | "TIMEOUT" | "NETWORK_ERROR" | "INVALID_RESPONSE" | "TOO_LARGE" | "MAINTENANCE";

export class RestError extends Error {
  constructor(readonly code: RestErrorCode, readonly status?: number) {
    super(status ? `${code} (HTTP ${status})` : code);
  }
}

const ALLOWED = /^\/a\/(?:springboard-definition-service|collaboration-actions-service)\/[A-Za-z0-9_/-]+(?:\?[A-Za-z0-9=&]+)?$/;
const PLATFORM_NAMES = /^\/a\/springboard-platform-gateway-service\/customers\/[0-9A-Za-z]{32}\/workspaces(?:\/[0-9A-Za-z]{32}\/models\/[0-9A-Za-z]{32})?$/;
const POLARIS_METADATA = /^\/a\/llm-data-service\/meta-data\/workspace\/[0-9A-Za-z]{32}\/model\/[0-9A-Za-z]{32}\/(?:modules|versions|line-items\/[1-9]\d{0,17})$/;

function xsrfToken(): string | undefined {
  const entry = document.cookie.split(";").map(part => part.trim()).find(part => part.startsWith("XSRF-TOKEN="));
  if (!entry) return undefined;
  try {
    const value = decodeURIComponent(entry.slice("XSRF-TOKEN=".length));
    return value.length <= 4096 && !/[\r\n]/.test(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

/** `host` sends the read to the Anaplan host a model lives on (a model in another data centre is served there, as Page
 * Builder does); otherwise the page's own origin is used. */
export async function getJson(path: string, options: { apiVersion?: "1" | "2"; timeoutMs?: number; maxBytes?: number; host?: string } = {}): Promise<unknown> {
  if ((!ALLOWED.test(path) && !PLATFORM_NAMES.test(path) && !POLARIS_METADATA.test(path)) || path.split(/[/?]/).some(part => part === "." || part === "..")) throw new RestError("INVALID_PATH");
  const host = options.host && options.host !== location.host ? options.host : undefined;
  if (host && !ANAPLAN_HOST.test(host)) throw new RestError("INVALID_PATH");
  const headers: Record<string, string> = { Accept: "application/json", "x-api-version": options.apiVersion ?? "1", "X-TracePath": "springboard-ui" };
  // Like Axios, the XSRF cookie is echoed only to the page's own origin.
  const xsrf = host ? undefined : xsrfToken();
  if (xsrf) headers["X-XSRF-TOKEN"] = xsrf;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 60_000);
  try {
    const response = await fetch(host ? `https://${host}${path}` : new URL(path, location.origin).href, {
      method: "GET", headers, credentials: "include", mode: host ? "cors" : "same-origin", redirect: "error", cache: "no-store", signal: controller.signal,
    });
    if (response.status === 401 || response.status === 498) throw new RestError("SIGNED_OUT", response.status);
    if (response.status === 503) throw new RestError("MAINTENANCE", response.status);
    const body = await response.text();
    if (body.length > (options.maxBytes ?? 25_000_000)) throw new RestError("TOO_LARGE");
    if (maintenanceHtml(body)) throw new RestError("MAINTENANCE", response.status);
    if (!response.ok) throw new RestError("HTTP_ERROR", response.status);
    try {
      return JSON.parse(body);
    } catch {
      throw new RestError("INVALID_RESPONSE", response.status);
    }
  } catch (error) {
    if (error instanceof RestError) throw error;
    throw new RestError(controller.signal.aborted ? "TIMEOUT" : "NETWORK_ERROR");
  } finally {
    clearTimeout(timer);
  }
}
