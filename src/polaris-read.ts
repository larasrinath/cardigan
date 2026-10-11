import type { ModelCatalog } from "./catalog.js";
import type { EngineScope } from "./model-engine.js";
import type { Progress } from "./progress.js";
import { getJson, RestError } from "./rest.js";
import type { StompConnection } from "./stomp.js";
import { AT_A_TIME, eachAtMost, list, message, seconds, text, type Obj } from "./util.js";

export type PolarisAction = "imports" | "exports" | "processes";
export const polarisId = (value: unknown): string | undefined =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? String(value)
    : typeof value === "string" && /^[1-9]\d{0,17}$/.test(value) ? value : undefined;
export const polarisText = (value: unknown): string => typeof value === "string" ? value : "";

/** The receipts had bare arrays and no paging metadata. Recognize common continuation/count markers defensively,
 * without following an unverified route or claiming that their absence proves completeness. */
export function polarisListing(json: unknown, key: string): { rows: Obj[]; paging: string[]; partial: boolean } {
  const root: Obj = json && typeof json === "object" && !Array.isArray(json) ? json : {};
  const entries: unknown = Array.isArray(json) ? json : root[key] ?? root.data ?? root.items;
  if (!Array.isArray(entries)) throw new Error("unrecognized listing shape");
  const paging = new Set<string>();
  let partial = false;
  const containers = [root, root.pagination, root.paging, root.page, root.meta, root.links]
    .filter((entry): entry is Obj => !!entry && typeof entry === "object" && !Array.isArray(entry));
  const totals = containers.flatMap(entry => [entry.total, entry.totalCount, entry.totalElements]).filter(value => typeof value === "number");
  for (const entry of containers) for (const [name, value] of Object.entries(entry)) {
    if (["next", "nextPage", "nextPageToken", "nextToken", "continuationToken", "hasMore", "hasNext", "last", "total", "totalCount", "totalElements",
      "totalPages", "page", "pageNumber", "number", "offset", "limit", "pageSize", "size"].includes(name)) paging.add(name);
    if (["next", "nextPage", "nextPageToken", "nextToken", "continuationToken"].includes(name) && value !== null && value !== undefined && value !== "" && value !== false) partial = true;
    if ((["hasMore", "hasNext"].includes(name) && value === true) || (name === "last" && value === false)) partial = true;
    if (["total", "totalCount", "totalElements"].includes(name) && typeof value === "number" && value > entries.length) partial = true;
    if ((name === "totalPages" && typeof value === "number" && value > 1) || (name === "offset" && typeof value === "number" && value > 0)) partial = true;
    if (["pageSize", "limit", "size"].includes(name) && typeof value === "number" && value > 0 && value === entries.length && !totals.includes(entries.length)) partial = true;
  }
  return { rows: list(entries), paging: [...paging].sort(), partial };
}

/** State of one Polaris read. Shared socket/action reads hand their answers here; every REST source can fail alone.
 * No customer identifiers or payload values are written to diagnostics, apart from the model-local module IDs. */
export class PolarisReader {
  modules: Obj[] = [];
  versions: Obj[] = [];
  lists: Obj[] = [];
  subsets: Obj[] = [];
  lineItems = new Map<string, Obj[]>();
  actions = new Map<PolarisAction, Obj[]>();
  unavailable = new Set<string>();
  partial = new Set<string>();
  private reading?: Promise<void>;

  constructor(private scope: EngineScope, private progress: Progress, private signal?: AbortSignal, readonly get: typeof getJson = getJson) {}

  failed(source: string, error: unknown): void {
    this.signal?.throwIfAborted();
    this.unavailable.add(source);
    const status = error instanceof RestError ? error.status : undefined;
    this.progress.log(`Polaris source unavailable: ${source} (${status ? `HTTP ${status}` : message(error)})`);
  }

  received(source: string, json: unknown, key: string): Obj[] {
    const answer = polarisListing(json, key);
    if (answer.paging.length) this.progress.log(`Polaris paging metadata: ${source} (${answer.paging.join(", ")})`);
    if (answer.partial) {
      this.partial.add(source);
      this.progress.log(`Polaris possibly incomplete: ${source} (${answer.rows.length} rows; continuation not read)`);
    }
    return answer.rows;
  }

  action(key: PolarisAction, json: unknown): void {
    const rows = this.received(key, json, key);
    this.actions.set(key, rows);
    this.progress.log(`Polaris source read: ${key} (${rows.length} rows)`);
  }

  /** Called inside the existing socket before page enrichment, or after a socket failure with the inventory retained.
   * The guard also lets test transports provide only the older catalog interface without duplicating any live read. */
  inventory(catalog: ModelCatalog, lists?: unknown, subscribe?: StompConnection["subscribe"], host?: string): Promise<void> {
    return this.reading ??= this.readInventory(catalog, lists, subscribe, host);
  }

  private async readInventory(catalog: ModelCatalog, lists?: unknown, subscribe?: StompConnection["subscribe"], host?: string): Promise<void> {
    this.signal?.throwIfAborted();
    this.lists = list((lists as Obj | undefined)?.data);
    const { workspaceId: ws, modelId: model } = this.scope;
    const base = `/a/llm-data-service/meta-data/workspace/${ws ?? ""}/model/${model}`;
    const read = async (source: string, path: string, key: string): Promise<Obj[] | undefined> => {
      this.signal?.throwIfAborted();
      try {
        const rows = this.received(source, await this.get(path, { host, timeoutMs: 60_000 }), key);
        this.signal?.throwIfAborted();
        return rows;
      } catch (error) { this.failed(source, error); return undefined; }
    };
    const began = Date.now();
    this.progress.status("Reading Polaris settings");
    await Promise.all([
      (async () => {
        const rows = await read("llmModules", `${base}/modules`, "modules");
        if (rows) { this.modules = rows; this.progress.log(`Polaris source read: llmModules (${rows.length} rows)`); }
      })(),
      (async () => {
        const rows = await read("llmVersions", `${base}/versions`, "versions");
        if (rows) { this.versions = rows; this.progress.log(`Polaris source read: llmVersions (${rows.length} rows)`); }
      })(),
      (async () => {
        if (!subscribe) return;
        try {
          const json = await subscribe(`core://${ws}:${model}/lists?subsets=true`, { body: {}, timeoutMs: 60_000 });
          this.signal?.throwIfAborted();
          this.subsets = this.received("subsets", json, "data");
          for (const entry of this.subsets) {
            const id = polarisId(entry.id);
            if (id && text(entry.name)) catalog.dimensions.set(id, entry.name);
          }
          this.progress.log(`Polaris source read: subsets (${this.subsets.length} entries; per-list membership unverified)`);
        } catch (error) { this.failed("subsets", error); }
      })(),
    ]);
    const lineBegan = Date.now();
    const modules = [...catalog.modules].filter(([id]) => polarisId(id));
    let answered = 0;
    let empty = 0;
    let rowsRead = 0;
    let formulas = 0;
    await eachAtMost(modules, AT_A_TIME, this.signal, async ([id]) => {
      const rows = await read(`llmLineItems module ${id}`, `${base}/line-items/${id}`, "lineItems");
      if (!rows) { catalog.unreadableModules.add(id); return; }
      const named = rows.filter(row => text(row.name));
      this.lineItems.set(id, named);
      // A possibly paged listing must not make a missing page reference look deleted.
      if (!this.partial.has(`llmLineItems module ${id}`)) catalog.lineItemModules.add(id);
      else catalog.unreadableModules.add(id);
      for (const row of named) {
        const itemId = polarisId(row.entityLongId);
        if (itemId) catalog.lineItems.set(itemId, { name: row.name, moduleId: id });
      }
      answered++;
      if (!named.length) empty++;
      rowsRead += named.length;
      formulas += named.filter(row => polarisText(row.formula).trim()).length;
    });
    this.progress.log(`Polaris line items: ${answered}/${modules.length} modules answered, ${rowsRead} line items, ${formulas} formulas, ${empty} empty modules; at most ${AT_A_TIME} requests at once; ${seconds(Date.now() - lineBegan)}`);
    this.progress.log(`Time: Polaris metadata ${seconds(lineBegan - began)}, Polaris line items ${seconds(Date.now() - lineBegan)}; Polaris settings in all ${seconds(Date.now() - began)}`);
  }
}
