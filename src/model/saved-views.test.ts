import { describe, expect, it } from "vitest";
import type { ImportMapping } from "../result-types.js";
import type { Grid } from "./grid.js";
import { assertDefinitionRead, Refusal, readViewDefinition, type Native } from "./native.js";
import { listSavedViews, readSavedViews, type SavedViewNames } from "./saved-views.js";

// Invented names and IDs only. Entity type = ID / 1e9: 102 module, 2 line item, 101 list, 116 export, 112 import, 105 saved
// view, as the classic client encodes them.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const WS = "0123456789abcdef0123456789abcdef";
const MODEL = "FEDCBA9876543210FEDCBA9876543210";

/** The client's request generator, as anaplan/data/ViewRequestRequestGenerator.js makes a request: a view request only
 * where page requests, row label requests or column label requests are given, each data page request also asking for its
 * rows' and its columns' labels, and the view by its definition or else its reference. */
class Generator {
  uninitialized = false;
  constructor(readonly workspaceId: string) {}
  getRequest(any: Any): Any {
    const view = (): Any => {
      const [data, rows, columns]: Any[][] = [[], [], []];
      for (const page of any.pageRequests ?? []) {
        data.push(page);
        rows.push({ start: page.startRow, count: page.rowCount });
        columns.push({ start: page.startColumn, count: page.columnCount });
      }
      return { workspaceId: this.workspaceId, dataPageRequests: data, rowLabelPageRequests: rows, columnLabelPageRequests: columns,
        cellSelectorLabelsRequired: any.cellSelectorLabelsRequired, pageSelectorLabelsRequired: any.pageSelectorLabelsRequired, viewIndex: any.viewIndex || -1,
        viewGuid: null, containerEntityLongId: -1, state: {}, modelId: any.modelId, ...(any.viewDefinition ? { viewDefinition: any.viewDefinition } : any.viewReference ? { viewReference: any.viewReference } : {}) };
    };
    const viewRequests = any.pageRequests || any.rowLabelPageRequests || any.columnLabelPageRequests ? [view()] : [];
    return { modelId: any.modelId, requestType: "VIEW_REQUEST_SET", workspaceId: this.workspaceId, submissions: [], viewRequests, systemActions: [], fetchAllModelSummaries: false };
  }
  uninitialize() { this.uninitialized = true; }
}

/** A label page of one entry each, as a condition's info gives its labels. */
const labels = (...texts: string[]) => ({ start: 0, count: texts.length, entityLongIds: [texts.map((_, at) => at + 1)], labels: [texts] });

interface Condition { id?: number; label?: string; operator: string; type: string; value?: unknown; values?: unknown[]; valueLabels?: string[]; contexts?: string[];
  contextLabels?: string[]; valid?: boolean; module?: string }
/** One condition of a filter and its info, as the view's definition holds them. */
const condition = (each: Condition) => ({
  condition: { ...(each.id !== undefined ? { lineItemIdentifier: `_${each.id}_` } : { lineItemIdentifier: null, moduleIdentifier: each.module }), contextIdentifiers: each.contexts ?? [],
    comparisonOperator: each.operator, comparisonValue: each.value ?? null, comparisonMultiValueOR: each.values ?? null, comparisonDataType: each.type },
  info: { lineItemLabelPage: labels(each.label ?? ""), contextLabelPage: labels(...(each.contextLabels ?? [])), comparisonValuesLabelPage: labels(...(each.valueLabels ?? [])),
    ...(each.valid === false ? { isValid: false } : {}) },
});
/** An axis's specification, with its filter where it has one. */
const axis = (dimension: string, filter?: { active?: boolean; match?: string; conditions: Condition[] }) => ({ dimension, axisDefinition: { type: "DIMENSION",
  ...(filter ? { sortAndFilterDefinition: { isActive: filter.active ?? true, filterMatchType: filter.match ?? "ALL", sortConditions: [],
    filterConditions: filter.conditions.map(each => condition(each).condition), filterConditionInfos: filter.conditions.map(each => condition(each).info) } } : {}) } });
/** A view's page info: its rows, columns and pages. */
const pageInfo = (rows: Any, columns: Any, ...pages: Any[]) => ({ rowAxisSpecification: rows, columnAxisSpecification: columns, pageAxisSpecifications: pages });

/** The Line Items grid the export read: each line item with its module, by ID. */
const LINE_ITEMS: Grid = { columns: [], rows: [
  { ids: [102000000001], labels: ["REV01 Revenue"], cells: [] },
  { ids: [2000000001, 102000000001], labels: ["Active?", "REV01 Revenue"], cells: [] },
  { ids: [2000000002, 102000000001], labels: ["Volume", "REV01 Revenue"], cells: [] },
  { ids: [102000000002], labels: ["SYS01 Flags"], cells: [] },
  { ids: [2000000003, 102000000002], labels: ["Region", "SYS01 Flags"], cells: [] },
  { ids: [2000000004, 102000000002], labels: ["Code", "SYS01 Flags"], cells: [] },
  { ids: [2000000005, 102000000002], labels: ["Launch", "SYS01 Flags"], cells: [] },
  { ids: [2000000006, 102000000002], labels: ["Period", "SYS01 Flags"], cells: [] },
] };
const MODULE_IDS: [string, string][] = [["REV01 Revenue", "102000000001"], ["SYS01 Flags", "102000000002"]];

/** A model page whose client holds these saved views, in its cache, and answers each view's read with what `answer` gives
 * for its ID: a view's result, a refusal (`{ error }`) or nothing. Every request the page is given to send is kept, as are
 * the reads under way at once, at most. */
function page(views: [id: number, name: string, module: number][], answer: (id: number) => Any, options: { delay?: boolean; generator?: Any } = {}) {
  const posted: Any[] = [];
  const flight = { now: 0, most: 0 };
  const native = {
    workspaceId: WS, modelId: MODEL, ids: {}, constants: {}, axisHelper: {}, DataPage: class {},
    cache: { getViewsLabelPage: () => ({ start: 0, count: views.length, entityLongIds: [views.map(([id]) => id)], labels: [views.map(([, name]) => name)] }),
      getViewsInfo: () => ({ moduleEntityLongIds: views.map(([, , module]) => module) }) },
    helper: { getAllDimensionIdentifiersForAxisSpecification: (specification: Any) => [specification.dimension], getLabelForDimensionIdentifier: (_cache: unknown, id: string) => id },
    RequestGenerator: options.generator ?? Generator,
    aggregator: { isDirty: () => false, post(request: Any, _flag: boolean, ok: (response: unknown) => void) {
      posted.push(request);
      flight.now++;
      flight.most = Math.max(flight.most, flight.now);
      const id = request.viewRequests?.[0]?.viewReference?.entityDefaultViewEntityLongId;
      const reply = () => { flight.now--; ok(answer(id)); };
      if (options.delay) setTimeout(reply, 5); else queueMicrotask(reply);
      return true;
    } },
  } as unknown as Native;
  return { native, posted, flight };
}
/** A view's answer, as the model gives one to a read of its definition: its page info, its sizes, and no page. */
const answered = (info: Any, pages: Any = {}) => ({ result: { viewRequestResults: [{ pageInfo: info, viewDefinition: {}, rowCount: 12, columnCount: 4,
  dataPages: [], rowLabelPages: [], columnLabelPages: [], ...pages }] } });
const NO_FILTER = pageInfo(axis("Products"), axis("Line Items"));
const names = (more: Partial<SavedViewNames> = {}): SavedViewNames => ({ lineItems: LINE_ITEMS, moduleIds: MODULE_IDS, model: "Invented plan", ...more });

describe("A model's saved views, listed from the page's client", () => {
  it("are the cache's views, in its order, by ID, name and module, skipping an entry with no ID", () => {
    const { native } = page([[105000000001, "Open items", 102000000001], [Number.NaN, "Broken", 102000000001], [105000000002, "Flags &amp; more", 102000000002]], () => undefined);
    expect(listSavedViews(native)).toEqual([{ id: 105000000001, name: "Open items", moduleId: 102000000001 }, { id: 105000000002, name: "Flags & more", moduleId: 102000000002 }]);
    // The page's own count is how many entries there are.
    (native.cache as Any).getViewsLabelPage = () => ({ count: 1, entityLongIds: [[105000000001, 105000000002]], labels: [["Open items", "Flags"]] });
    expect(listSavedViews(native).map(view => view.name)).toEqual(["Open items"]);
  });

  it("are not listed, with why, from a client without the list or with one it holds otherwise; no request is made for them", () => {
    const { native, posted } = page([], () => undefined);
    (native.cache as Any).getViewsLabelPage = undefined;
    expect(() => listSavedViews(native)).toThrow("the model page's client does not list its saved views");
    (native.cache as Any).getViewsLabelPage = () => { throw new Error("model not loaded"); };
    expect(() => listSavedViews(native)).toThrow("the model page's client does not list its saved views (model not loaded)");
    (native.cache as Any).getViewsLabelPage = () => ({ count: 1, entityLongIds: "105000000001" });
    expect(() => listSavedViews(native)).toThrow("the model page's client lists its saved views in a form Cardigan does not read");
    expect(posted).toEqual([]);
  });
});

describe("A saved view's definition, read as Model Building opens the view", () => {
  it("is one view request, by the view's reference, with an empty list of page requests: no data, row or column page is asked for", async () => {
    const { native, posted } = page([[105000000001, "Open items", 102000000001]], () => answered(NO_FILTER));
    const read = await readViewDefinition(native, 105000000001);
    expect(read).toEqual({ pageInfo: NO_FILTER, ignored: 0 });
    expect(posted).toHaveLength(1);
    const [request] = posted;
    expect([request.requestType, request.submissions, request.systemActions, request.fetchAllModelSummaries, request.viewRequests.length]).toEqual(["VIEW_REQUEST_SET", [], [], false, 1]);
    const [view] = request.viewRequests;
    expect([view.viewReference, view.dataPageRequests, view.rowLabelPageRequests, view.columnLabelPageRequests, view.cellSelectorLabelsRequired, view.pageSelectorLabelsRequired,
      view.viewDefinition, view.viewChanges]).toEqual([{ entityDefaultViewEntityLongId: 105000000001 }, [], [], [], false, false, undefined, undefined]);
  });

  it("is refused before it is sent where the request would ask for pages, make no view request, or be anything but a read", async () => {
    // A generator that adds pages to what it is asked for, one that makes no view request (as the real one does without
    // page requests at all), one that adds a view's definition, and one that adds a submission.
    const asking = class extends Generator { getRequest(any: Any) { return super.getRequest({ ...any, pageRequests: [{ startRow: 0, startColumn: 0, rowCount: 10, columnCount: -1 }] }); } };
    const viewless = class extends Generator { getRequest(any: Any) { return super.getRequest({ ...any, pageRequests: undefined }); } };
    const defined = class extends Generator { getRequest(any: Any) { const request = super.getRequest(any); request.viewRequests[0].viewDefinition = { type: "MODEL_DEFINITION" }; return request; } };
    const changing = class extends Generator { getRequest(any: Any) { return { ...super.getRequest(any), submissions: [{ cellChanges: [] }] }; } };
    const another = class extends Generator { getRequest(any: Any) { return super.getRequest({ ...any, viewReference: { entityDefaultViewEntityLongId: 105000000009 } }); } };
    for (const generator of [asking, viewless, defined, changing, another]) {
      const { native, posted } = page([[105000000001, "Open items", 102000000001]], () => answered(NO_FILTER), { generator });
      await expect(readViewDefinition(native, 105000000001), generator.name).rejects.toThrow(/^Refusing to send anything but a read/);
      expect(posted, generator.name).toEqual([]);
    }
    // The check alone: one view request of three empty page lists, by this view's reference.
    const request = new Generator(WS).getRequest({ modelId: MODEL, viewReference: { entityDefaultViewEntityLongId: 105000000001 }, pageRequests: [] });
    expect(() => assertDefinitionRead(request, 105000000001)).not.toThrow();
    expect(() => assertDefinitionRead({ ...request, viewRequests: [...request.viewRequests, ...request.viewRequests] }, 105000000001)).toThrow();
    expect(() => assertDefinitionRead({ ...request, requestType: "SYSTEM_ACTION_SET" }, 105000000001)).toThrow("Refusing to send anything but a read.");
  });

  it("is a refusal, with the model's own words made plain, where the model refuses it or answers with no view", async () => {
    const refusing = page([[105000000001, "Open items", 102000000001]], () => ({ error: { message: `View <b>Open items</b> of model ${MODEL} is not available` } }));
    const error = await readViewDefinition(refusing.native, 105000000001).catch((thrown: unknown) => thrown);
    expect([error instanceof Refusal, (error as Refusal).said]).toEqual([true, "View Open items of model [ID] is not available"]);
    const viewless = page([[105000000001, "Open items", 102000000001]], () => ({ result: { viewRequestResults: [{ errorInfo: { errorCode: "NO_ACCESS" } }] } }));
    await expect(readViewDefinition(viewless.native, 105000000001)).rejects.toThrow("The model returned no view for this read: NO_ACCESS.");
  });

  it("keeps the page info alone, and counts any data or label page the answer holds all the same, reading none of it", async () => {
    const { native } = page([[105000000001, "Open items", 102000000001]], () => answered(NO_FILTER, { dataPages: [{ rows: [["9"]] }], rowLabelPages: [{ count: 1, labels: [["North"]] }] }));
    expect(await readViewDefinition(native, 105000000001)).toEqual({ pageInfo: NO_FILTER, ignored: 2 });
  });
});

describe("The filters of a model's saved views", () => {
  /** Five views: a filter on rows that is on, of a Boolean; one on columns that matches any, of a list's items and a number,
   * and one on a page, off, of a period; a view without a filter; one the model refuses; and one whose condition's line item
   * is gone, not valid, with context, text and date conditions. */
  const VIEWS: [number, string, number][] = [[105000000001, "Open items", 102000000001], [105000000002, "Regional split", 102000000001], [105000000003, "Plain", 102000000001],
    [105000000004, "Refused", 102000000002], [105000000005, "Old flags", 102000000002]];
  const ANSWERS: Record<number, Any> = {
    105000000001: answered(pageInfo(axis("Products", { conditions: [{ id: 2000000001, label: "Active?", operator: "EQUALS", type: "BOOLEAN", value: "true" }] }), axis("Line Items"))),
    105000000002: answered(pageInfo(axis("Products"), axis("Regions", { match: "ANY", conditions: [
      { id: 2000000003, label: "Region", operator: "EQUALS", type: "ENTITY", values: ["_101000000011_", "_101000000012_", "_101000000013_"], valueLabels: ["North", "South"] },
      { id: 2000000002, label: "Volume", operator: "GREATER_THAN_OR_EQUAL_TO", type: "NUMBER", value: "1500" }] }),
    axis("Time", { active: false, conditions: [{ id: 2000000006, label: "Period", operator: "LESS_THAN", type: "TIME_ENTITY", values: ["_20000000123_"], valueLabels: ["Jan 26"] }] }))),
    105000000003: answered(NO_FILTER),
    105000000004: { error: "No access to this view" },
    105000000005: answered(pageInfo(axis("Products", { conditions: [
      { id: 2000000099, label: "", operator: "EQUALS", type: "BOOLEAN", value: "false", valid: false },
      { id: 2000000004, label: "Code", operator: "STARTS_WITH", type: "TEXT", value: "FY 26", contexts: ["_101000000021_"], contextLabels: ["SCN042:Spring Launch"] },
      { id: 2000000005, label: "Launch", operator: "IS_NOT_BLANK", type: "DATE", value: "" },
      { id: 2000000005, label: "Launch", operator: "NOT_EQUALS", type: "DATE", value: "2026-03-31" }] }), axis("Line Items")),
    { dataPages: [{ rows: [["1"]] }] }),
  };

  it("are read one view at a time, in the cache's order, and make the table of each view with a filter or not read, with the details and the map's conditions", async () => {
    const { native, posted, flight } = page(VIEWS, id => ANSWERS[id], { delay: true });
    const log: string[] = [];
    const read = await readSavedViews(native, listSavedViews(native), names(), line => log.push(line));
    // One read a view, each by its reference, never two at once.
    expect([posted.map(request => request.viewRequests[0].viewReference.entityDefaultViewEntityLongId), flight.most]).toEqual([VIEWS.map(([id]) => id), 1]);
    // The view without a filter is no row; the one refused is, and says its definition was not read.
    expect(read.table.headers).toEqual(["Name", "Module", "Filters", "Filter Line Items", "Used on Pages", "Used by Imports", "Used by Exports", "Definition read"]);
    expect(read.table.rows).toEqual([
      ["Open items", "REV01 Revenue", "Rows: Active? = True", "REV01 Revenue.Active?", "", "", "", "Yes"],
      ["Regional split", "REV01 Revenue", "Columns: Match any: Region = North or South or ID 101000000013, Volume ≥ 1500; Pages (Time, off): Period < Jan 26",
        "SYS01 Flags.Region, REV01 Revenue.Volume, SYS01 Flags.Period", "", "", "", "Yes"],
      ["Refused", "SYS01 Flags", "", "", "", "", "", "No"],
      ["Old flags", "SYS01 Flags", "Rows: Missing line item (ID 2000000099) = False (not valid), Code (SCN042:Spring Launch) starts with \"FY 26\", Launch is not blank, Launch ≠ 2026-03-31",
        "Missing line item (ID 2000000099), SYS01 Flags.Code, SYS01 Flags.Launch", "", "", "", "Yes"],
    ]);
    expect(read.ids).toEqual(["105000000001", "105000000002", "105000000004", "105000000005"]);
    expect(read.details.map(view => [view.name, view.read, view.filters.map(filter => [filter.axis, filter.dimension, filter.active, filter.match, filter.conditions.length])])).toEqual([
      ["Open items", true, [["Rows", undefined, true, "all", 1]]],
      ["Regional split", true, [["Columns", undefined, true, "any", 2], ["Pages", "Time", false, "all", 1]]],
      ["Refused", false, []],
      ["Old flags", true, [["Rows", undefined, true, "all", 4]]],
    ]);
    expect(read.details[3].filters[0].conditions).toEqual([
      { lineItem: "Missing line item (ID 2000000099)", operator: "EQUALS", dataType: "BOOLEAN", values: ["False"], contexts: [], valid: false },
      { lineItem: "Code", lineItemModule: "SYS01 Flags", operator: "STARTS_WITH", dataType: "TEXT", values: ["FY 26"], contexts: ["SCN042:Spring Launch"], valid: true },
      { lineItem: "Launch", lineItemModule: "SYS01 Flags", operator: "IS_NOT_BLANK", dataType: "DATE", values: [], contexts: [], valid: true },
      { lineItem: "Launch", lineItemModule: "SYS01 Flags", operator: "NOT_EQUALS", dataType: "DATE", values: ["2026-03-31"], contexts: [], valid: true },
    ]);
    // The map's conditions: each whose line item is named, with its view and module, axis, and whether it is on and valid.
    expect(read.filters).toEqual([
      { view: "Open items", module: "REV01 Revenue", axis: "Rows", lineItem: "Active?", lineItemModule: "REV01 Revenue", active: true, valid: true },
      { view: "Regional split", module: "REV01 Revenue", axis: "Columns", lineItem: "Region", lineItemModule: "SYS01 Flags", active: true, valid: true },
      { view: "Regional split", module: "REV01 Revenue", axis: "Columns", lineItem: "Volume", lineItemModule: "REV01 Revenue", active: true, valid: true },
      { view: "Regional split", module: "REV01 Revenue", axis: "Pages", lineItem: "Period", lineItemModule: "SYS01 Flags", active: false, valid: true },
      { view: "Old flags", module: "SYS01 Flags", axis: "Rows", lineItem: "Code", lineItemModule: "SYS01 Flags", active: true, valid: true },
      { view: "Old flags", module: "SYS01 Flags", axis: "Rows", lineItem: "Launch", lineItemModule: "SYS01 Flags", active: true, valid: true },
      { view: "Old flags", module: "SYS01 Flags", axis: "Rows", lineItem: "Launch", lineItemModule: "SYS01 Flags", active: true, valid: true },
    ]);
    // The log: the view refused, by its ID, with the model's words; the answer that held a page; and one line on them all.
    expect(log).toEqual(["Saved view 105000000004: refused (No access to this view)", "Saved view 105000000005: the answer held 1 data or label pages, which were left unread",
      expect.stringMatching(/^Saved views: 5; filters read for 4, 3 with a filter; 1 refused; in \d+\.\d\d s$/)]);
    expect(read.notes).toEqual(["1 of the 5 saved views could not be read, so their filters are not known: Definition read says No in their rows, and the diagnostic log says why."]);
  });

  it("stop being read once the export is asked to stop, and list the views not read rather than leave them out", async () => {
    const { native, posted } = page(VIEWS, id => ANSWERS[id]);
    const log: string[] = [];
    let asked = 0;
    // The stop is asked before every read: the third time, the export has been asked to stop.
    const stop = { throwIfAborted: () => { if (++asked > 2) throw new Error("The export was stopped."); } };
    const read = await readSavedViews(native, listSavedViews(native), names(), line => log.push(line), stop);
    expect([posted.length, asked]).toEqual([2, 3]);
    expect(read.table.rows.map(row => [row[0], row[7]])).toEqual([["Open items", "Yes"], ["Regional split", "Yes"], ["Plain", "No"], ["Refused", "No"], ["Old flags", "No"]]);
    expect(log.at(-1)).toMatch(/^Saved views: 5; filters read for 2, 2 with a filter; 0 refused; 3 not read: the export was stopped; in \d+\.\d\d s$/);
    expect(read.notes).toEqual(["3 of the 5 saved views were not read: the export was stopped before them. Definition read says No in their rows."]);
  });

  it("name the imports of this model that read each view, by their data source's object or their Source Object, and the exports from it", async () => {
    const { native } = page(VIEWS.slice(0, 2), id => ANSWERS[id]);
    const column = (label: string) => ({ ids: [4000000001], labels: [label] });
    const imports: Grid = { columns: ["Source Label", "Source Object", "Source Type", "Target Object"].map(column), rows: [
      { ids: [112000000001], labels: ["Load from open items"], cells: ["", "'REV01 Revenue'.'Open items'", "SAVED VIEW", "Targets"] },
      { ids: [112000000002], labels: ["Load by source"], cells: ["", "Hub / Elsewhere.View", "SAVED VIEW", "Targets"] },
      { ids: [112000000003], labels: ["Load from the hub"], cells: ["", "Data Hub / 'REV01 Revenue'.'Open items'", "SAVED VIEW", "Targets"] },
      { ids: [112000000004], labels: ["Load a module"], cells: ["", "'REV01 Revenue'", "MODULE", "Targets"] },
      { ids: [112000000005], labels: ["Load split, here"], cells: ["", "Invented plan / 'REV01 Revenue'.'Regional split'", "SAVED VIEW", "Targets"] },
    ] };
    // The second import's data source names the second view by ID; the fifth's mapping says its source is another model's.
    const mappings = imports.rows.map((row, at): ImportMapping => ({ id: String(row.ids[0]), name: row.labels[0], importType: "MODULE_DATA", targets: [], ...(at === 4 ? { sourceInThisModel: false } : {}) }));
    const exports = { columns: [column("Action"), column("Notes")], rows: [
      { ids: [116000000001], labels: ["Export open items"], cells: ["Export from 'REV01 Revenue'.'Open items'", ""] },
      { ids: [116000000002], labels: ["Export by ID"], cells: ['{"sourceEntityLongId":"_105000000002_","filter0LineItemEntityLongId":null}', ""] },
      { ids: [116000000003], labels: ["Export the module"], cells: ["Export from 'REV01 Revenue'", ""] },
    ] };
    const read = await readSavedViews(native, listSavedViews(native), names({ imports, mappings, sourceObjects: new Map([[112000000002, 105000000002]]), exports }), () => undefined);
    expect(read.table.rows.map(row => [row[0], row[5], row[6]])).toEqual([["Open items", "Load from open items", "Export open items"], ["Regional split", "Load by source", "Export by ID"]]);
  });
});
