import { describe, expect, it, vi } from "vitest";
import type { loadCatalog } from "./analyse.js";
import { addActions, addLineItems, addLists, addModuleViews, emptyCatalog } from "./catalog.js";
import { addModelPages, AT_A_TIME, NO_APPS, NO_CUSTOMER, type PageReads } from "./model-pages.js";
import { MODULE_USAGE_FILE, PAGE_ACTIONS_FILE, PAGE_FILTERS_FILE } from "./page-files.js";
import type { AnalysisResult } from "./result-types.js";
import { RestError } from "./rest.js";
import type { Obj } from "./util.js";

const [CUSTOMER, WS, MODEL, OTHER_MODEL] = ["abcdef0123456789abcdef0123456789", "0123456789abcdef0123456789abcdef", "FEDCBA9876543210FEDCBA9876543210",
  "00112233445566778899AABBCCDDEEFF"];
const [MODULE, MODULE_2, OTHER_MODULE, LIST, LIST_2, TIME] = ["102000000901", "102000000902", "102000000999", "101000000901", "101000000902", "20000000003"];
const LI = (n: number) => `19010000000${String(n).padStart(2, "0")}`;
const guid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const [APP_A, APP_B, PAGE_A, PAGE_B, PAGE_C] = [guid(1), guid(2), guid(1000), guid(2000), guid(3000)];
const PAGES = "/a/springboard-definition-service/customer/abcdef0123456789abcdef0123456789/model/FEDCBA9876543210FEDCBA9876543210/pages";
const appRead = (app: string) => `/a/springboard-definition-service/apps/${app}?includeUnpublished=true&includeReportPages=true`;

const common = (n: number, type: string, extra: Obj = {}): Obj => ({ type, customerId: CUSTOMER, defaultTitle: "", description: "", pageLinkType: "title",
  pageType: "NONE", contextOptions: [], clientGuid: guid(n), widgetGuid: guid(n + 100), version: 1, widgetActions: [], isTargetPagePublished: false,
  showCommenting: true, showMaximize: true, showBackground: true, validVersions: [1], ...extra });
const dim = (id: string) => ({ id, levels: [], sorts: [], totalsPosition: "AFTER", shows: [], hides: [], reorder: [] });
const leaf = (selectedItems: string[], operator = "EQUALS", values = ["true"]) => ({ type: "LEAF", rule: { selectedItems, operator, values, identifier: "", axisKey: null } });
const axis = (dimensions: unknown[], nodes: unknown[] = []) => ({ dimensions, filters: { rootNode: { type: "BRANCH", operator: "AND", nodes } }, raggedShows: [], raggedHides: [] });
/** A grid of one module whose rows are filtered by `rule`. */
const grid = (n: number, title: string, module: string, rule: unknown[], extra: Obj = {}): Obj => common(n, "TABLE", { defaultTitle: title, ...extra,
  widgetDataSources: [{ widgetGuid: guid(n + 100), subEntityId: "", viewDescription: null, dataSourceId: guid(n + 900), dataSourceType: "MULTI_AXIS_DESCRIPTION",
    axisDescriptionQuery: { id: guid(n + 900), version: 1, conditionalFormattingRules: [],
      regions: { SINGLE: { moduleId: module, rows: axis([dim(LIST)], rule), columns: axis([dim(TIME)]) } } } }] });
const button = (id: string, type: string, name: string) => ({ id, type, name, style: null, runAutomatically: null, actionDriverId: null, destinationListId: null,
  disableCancelButton: false, actionToken: "fake-token-value", description: null });
const actions = (n: number, buttons: Obj[], extra: Obj = {}): Obj => common(n, "ACTION", { actionWidgetStyle: { layoutType: "BUTTON" }, actions: JSON.stringify(buttons),
  actionButtons: buttons, widgetDataSources: [{ widgetGuid: guid(n + 100), dataSourceId: "", subEntityId: "", dataSourceType: "CLASSIC", axisDescriptionQuery: null,
    viewDescription: null }], ...extra });
/** A published board of these cards, one to a row, built on `model`. */
const board = (page: string, app: string, name: string, model: string, cards: Obj[]): Obj => ({
  pageGuid: page, categoryGuid: guid(9), appGuid: app, customerId: CUSTOMER, name, workspaceId: WS, modelId: model, rows: [], contextOptions: [],
  modelInfo: { modelName: "Model one", workspaceName: "Workspace one" }, currentDraftVersionGuid: guid(8), currentPublishedVersionGuid: guid(8), publishedAt: 1_790_000_000_000,
  layout: { id: guid(7), type: "BOARD", version: 2, areas: { main: [{ type: "BOARD_CONTENT", id: guid(6), areas: { sections: [{ type: "BOARD_SECTION", id: guid(5),
    areas: { rows: cards.map((card, index) => ({ id: guid(1200 + index * 10), type: "BOARD_ROW", height: 240, padding: "small", areas: { columns: [
      { type: "BOARD_COLUMN", id: guid(1201 + index * 10), columnStart: 0, columnEnd: 12, areas: { cards: [{ type: card.type, id: card.clientGuid, height: 240 }] } }] } })) } }] } }],
    sidepanel: [], expanded: [] } },
  widgets: Object.fromEntries(cards.map(card => [card.clientGuid, card])),
});

/** The first board: a grid that names another model, this model's buttons and grid, then a button card that names another
 * model. With `elsewhere` null, the two cards name no model and so work on the page's, this one. */
const demandBoard = (elsewhere: string | null = OTHER_MODEL) => board(PAGE_A, APP_A, "Demand board", MODEL, [
  grid(1, "Elsewhere", OTHER_MODULE, [leaf([LI(1)])], elsewhere ? { modelId: elsewhere } : {}),
  actions(2, [button("112000000901", "IMPORT", "Reload plan"), button("118000000901", "PROCESS", "Run nightly")]),
  grid(3, "Demand by product", MODULE, [leaf([LIST_2, LI(9)], "NOT_EQUALS", ["0"])]),
  actions(4, [button("112000000977", "IMPORT", "Load elsewhere")], elsewhere ? { modelId: elsewhere } : {}),
]);
/** The second board, in another app, filters a grid of this model by the same line item. */
const supplyBoard = board(PAGE_B, APP_B, "Supply board", MODEL, [grid(1, "Factors", MODULE_2, [leaf([LI(9)])])]);

/** The names this model gives, as the model data service and the actions service give them. Factors is not among the
 * modules: the export's own names name it. */
function catalog() {
  const result = emptyCatalog();
  addModuleViews(result, { data: [{ id: MODULE, name: "Demand", views: [] }], dimensions: { [TIME]: { label: "Time" } } });
  addLists(result, { data: [{ id: LIST, name: "Product" }, { id: LIST_2, name: "Territory" }] });
  addLineItems(result, MODULE, { data: [{ lineItemId: LI(1), lineItemLabel: "Volume" }] });
  addLineItems(result, MODULE_2, { data: [{ lineItemId: LI(9), lineItemLabel: "Territory demand" }] });
  addActions(result, "imports", { imports: [{ id: "112000000901", name: "Import demand" }] });
  addActions(result, "processes", { processes: [{ id: "118000000901", name: "Nightly process" }] });
  return result;
}

const LINE_ITEMS_HEADERS = ["", "Module Name", "Applies To", "Format"];
/** A model's export as the core frame hands it over: its details, Modules (a heading among them) and Line Items. */
const exported = (): AnalysisResult => ({
  kind: "model", name: "Model one", id: MODEL, zipName: "Model one - Model Export - 2026-10-09.zip", summary: ["Modules: 4 rows", "Line Items: 6 rows"],
  moduleIds: [["Demand", MODULE], ["Factors", MODULE_2], ["Unused", "102000000903"]],
  tables: [
    { file: "Model Details.csv", label: "Model Details", headers: ["Section", "Detail", "Value"], guard: true, details: true, rows: [
      ["Model", "Model", "Model one"], ["Model", "Workspace", "Workspace one"], ["Model", "Model ID", MODEL], ["Model", "Workspace ID", WS],
      ["Export", "Exported at", "2026-10-09 10:00 UTC"], ["Files", "Modules.csv", "4 rows"], ["Files", "Line Items.csv", "6 rows"],
      ["Notes", "Source Models", "none"], ["How to read", "Modules", "One row for each module."], ["Diagnostics", "10:00:00", "Cardigan dev: model"]] },
    { file: "Modules.csv", label: "Modules", headers: ["", "Applies To"], guard: false, rows: [["-- INPUTS", ""], ["Demand", "Product"], ["Factors", "Product"], ["Unused", ""]] },
    { file: "Line Items.csv", label: "Line Items", headers: [...LINE_ITEMS_HEADERS], guard: false, rows: [
      ["Demand", "", "Product", ""], ["Volume", "Demand", "-", "Number"], ["Factors", "", "Product", ""], ["Territory demand", "Factors", "-", "Number"],
      ["Unused", "", "", ""], ["Note", "Unused", "-", "Text"]] },
  ],
});

type Published = Awaited<ReturnType<PageReads["readPublished"]>>;
interface Fake { reads: PageReads; asked: string[]; status: string[]; log: string[] }
/** Reads that answer from these pages: a page's board, or the state readPublished gives for it. */
function fake(entries: Obj[], pages: Record<string, Obj | string>, apps: Record<string, string> = { [APP_A]: "Planning app", [APP_B]: "Another app" }): Fake {
  const asked: string[] = [];
  const reads: PageReads = {
    getJson: vi.fn(async (path: string) => {
      asked.push(path);
      if (path === PAGES) return { items: entries, isPageBuilder: true };
      const app = /\/apps\/([0-9a-f-]+)\?/.exec(path)?.[1];
      if (app && apps[app]) return { name: apps[app] };
      throw new RestError("HTTP_ERROR", 404);
    }) as unknown as PageReads["getJson"],
    readPublished: vi.fn(async (page: string): Promise<Published> => {
      asked.push(`page ${page}`);
      const answer = pages[page];
      return typeof answer === "string" ? { state: answer } : answer ? { type: "BOARD", native: structuredClone(answer) } : { state: "Not published" };
    }),
    loadCatalog: vi.fn(async () => { asked.push("names"); return { catalog: catalog(), notes: [], failedActionTypes: [] }; }) as unknown as typeof loadCatalog,
  };
  return { reads, asked, status: [], log: [] };
}
const run = (result: AnalysisResult, customer: string | undefined, use: Fake, signal?: AbortSignal) =>
  addModelPages(result, customer, { status: text => use.status.push(text), log: line => use.log.push(line) }, signal, use.reads);
const rowsOf = (result: AnalysisResult, file: string) => result.tables.find(each => each.file === file)?.rows;
const detailsOf = (result: AnalysisResult) => result.tables[0].rows;
const filterUses = (result: AnalysisResult) => result.tables.find(each => each.file === "Line Items.csv")!.rows.map(row => [row[0], row[4]]);
const BOTH = [{ guid: PAGE_A, name: "Demand board", appGuid: APP_A }, { guid: PAGE_B, name: "Supply board" }];

/** The three tables left out for `why`, as the export says it of a file it could not make, and the Line Items column empty. */
function withoutPages(why: string): AnalysisResult {
  const result = exported();
  const files = [["Module Usage", MODULE_USAGE_FILE], ["Page Filters", PAGE_FILTERS_FILE], ["Page Actions", PAGE_ACTIONS_FILE]];
  result.summary.push(...files.map(([label]) => `${label}: not exported (${why}).`));
  result.tables[0].rows.splice(7, 0, ...files.map(([, file]) => ["Files", file, `Not exported: ${why}`]));
  result.tables[2].headers.push("Page Filters");
  for (const row of result.tables[2].rows) row.push("");
  return result;
}

/** Page reads that answer only when the test says, each by its page. */
function waiting() {
  const reads: { page: string; answer: (published: Published) => void; fail: (error: unknown) => void }[] = [];
  const readPublished = vi.fn((page: string) => new Promise<Published>((answer, fail) => { reads.push({ page, answer, fail }); }));
  return { reads, readPublished };
}

describe("The pages built on a model", () => {
  it("reads Model Building's list, each page, the apps and then the names, and makes the three tables of the cards that work on the model", async () => {
    const use = fake(BOTH, { [PAGE_A]: demandBoard(), [PAGE_B]: supplyBoard });
    const given = exported();
    const result = await run(given, CUSTOMER, use);

    expect(use.asked).toEqual([PAGES, `page ${PAGE_A}`, `page ${PAGE_B}`, appRead(APP_A), appRead(APP_B), "names"]);
    // The apps' records are read as an app's own run reads them; the names as an app's pages are named, for this model.
    expect(vi.mocked(use.reads.getJson).mock.calls.slice(1).map(([, options]) => options)).toEqual([{ apiVersion: "2" }, { apiVersion: "2" }]);
    const [scope, details, names] = vi.mocked(use.reads.loadCatalog).mock.calls[0];
    expect([scope, details.map(page => page.pageGuid), [...names]]).toEqual([{ customerId: CUSTOMER, workspaceId: WS, modelId: MODEL, modelName: "Model one" },
      [PAGE_A, PAGE_B], [[PAGE_A, "Demand board"], [PAGE_B, "Supply board"]]]);
    expect(use.status).toEqual(["Reading the pages built on this model…", "Reading the pages built on this model: 1 of 2", "Reading the pages built on this model: 2 of 2",
      "Reading the apps of the pages built on this model: 2", "Building the tables of the pages built on this model…"]);
    // The list's fields are logged, never what they hold.
    expect(use.log).toEqual(["pages built on the model: 2 entries; their fields: appGuid, guid, name; isPageBuilder true",
      "pages built on the model: 2 read, 0 unpublished, 0 not read; 2 apps; 4 module usage rows, 2 page filters, 2 page actions"]);

    // Each module in the Modules table's order, by app and page; Factors is named by the export, as the service did not name
    // it. A module no page uses has its one row.
    expect(rowsOf(result, MODULE_USAGE_FILE)).toEqual([["Demand", "Planning app", "Demand board"], ["Factors", "Another app", "Supply board"],
      ["Factors", "Planning app", "Demand board"], ["Unused", "-", "Not on any page"]]);
    // The cards that name another model are left out, and the others keep the numbers the app's own tables give them.
    expect(rowsOf(result, PAGE_FILTERS_FILE)).toEqual([
      ["Another app", "Supply board", 1, "1", "Factors", "Rows", "Product", "1", "All", "Territory demand", "Factors", "is equal to", "true", "-", guid(1), LI(9)],
      ["Planning app", "Demand board", 3, "1", "Demand", "Rows", "Product", "1", "All", "Territory demand", "Factors", "is not equal to", "0", "Territory = current", guid(3), LI(9)]]);
    expect(rowsOf(result, PAGE_ACTIONS_FILE)).toEqual([
      ["Planning app", "Demand board", 2, "Reload plan", "Import", "Import demand", "Model", "Yes (default)", "n/a", guid(2), "112000000901"],
      ["Planning app", "Demand board", 2, "Run nightly", "Process", "Nightly process", "Model", "Yes (default)", "Cancel allowed", guid(2), "118000000901"]]);
    expect(result.tables.slice(3).map(table => [table.file, table.label, table.headers.slice(0, 3), table.guard])).toEqual([
      [MODULE_USAGE_FILE, "Module Usage", ["Module", "App", "Page"], true], [PAGE_FILTERS_FILE, "Page Filters", ["App", "Page", "Card #"], true],
      [PAGE_ACTIONS_FILE, "Page Actions", ["App", "Page", "Card #"], true]]);

    // Line Items counts the filters that have each line item as their condition: none is 0, as every page was read.
    expect(result.tables[2].headers).toEqual([...LINE_ITEMS_HEADERS, "Page Filters"]);
    expect(filterUses(result)).toEqual([["Demand", ""], ["Volume", 0], ["Factors", ""], ["Territory demand", 2], ["Unused", ""], ["Note", 0]]);

    // The apps right after the model's ID, one to a line; each file's row after the files'; how to read them after the rest.
    expect(detailsOf(result).map(row => row.slice(0, 2).join(" / "))).toEqual(["Model / Model", "Model / Workspace", "Model / Model ID", "Model / Apps",
      "Model / Workspace ID", "Export / Exported at", "Files / Modules.csv", "Files / Line Items.csv", `Files / ${MODULE_USAGE_FILE}`, `Files / ${PAGE_FILTERS_FILE}`,
      `Files / ${PAGE_ACTIONS_FILE}`, "Notes / Source Models", "How to read / Modules", "How to read / Module Usage", "How to read / Page Filters",
      "How to read / Page Actions", "Diagnostics / 10:00:00"]);
    expect(detailsOf(result)[3][2]).toBe("Another app\nPlanning app");
    expect(detailsOf(result).slice(8, 11).map(row => row[2])).toEqual(["4 rows", "2 rows", "2 rows"]);
    expect(result.summary).toEqual(["Modules: 4 rows", "Line Items: 6 rows", "Module Usage: 4 rows", "Page Filters: 2 rows", "Page Actions: 2 rows"]);
    // What the export handed over is as it was.
    expect(given).toEqual(exported());
  });

  it("keeps a card by the model it works on: its own where it names one, the page's otherwise", async () => {
    // The same board with its two outer cards naming no model: they work on the page's, this one, and are kept with their numbers.
    const same = await run(exported(), CUSTOMER, fake(BOTH, { [PAGE_A]: demandBoard(null) }));
    expect(rowsOf(same, PAGE_FILTERS_FILE)!.map(row => [row[1], row[2]])).toEqual([["Demand board", 1], ["Demand board", 3]]);
    expect(rowsOf(same, PAGE_ACTIONS_FILE)!.map(row => [row[1], row[2], row[3]])).toEqual([["Demand board", 2, "Reload plan"], ["Demand board", 2, "Run nightly"],
      ["Demand board", 4, "Load elsewhere"]]);
    // A module the model does not have comes after the Modules table's, by its ID, as the app's own tables show it.
    expect(rowsOf(same, MODULE_USAGE_FILE)!.at(-1)).toEqual([`${OTHER_MODULE} (not in the model)`, "Planning app", "Demand board"]);

    // A page built on another model: only its card that names this model is kept.
    const mixed = board(PAGE_C, APP_B, "Mixed board", OTHER_MODEL, [grid(1, "Theirs", OTHER_MODULE, [leaf(["1901000000077"])]),
      grid(2, "Ours", MODULE, [leaf([LI(9)])], { modelId: MODEL })]);
    const result = await run(exported(), CUSTOMER, fake([{ guid: PAGE_C, name: "Mixed board" }], { [PAGE_C]: mixed }));
    expect(rowsOf(result, PAGE_FILTERS_FILE)!.map(row => [row[1], row[2], row[4]])).toEqual([["Mixed board", 2, "Demand"]]);
    expect(rowsOf(result, MODULE_USAGE_FILE)).toEqual([["Demand", "Another app", "Mixed board"], ["Factors", "Another app", "Mixed board"], ["Unused", "-", "Not on any page"]]);
  });

  it(`reads at most ${AT_A_TIME} pages at a time, starting them in the list's order`, async () => {
    const entries = Array.from({ length: 10 }, (_, index) => ({ guid: guid(5000 + index), name: `Page ${index}` }));
    const use = fake(entries, {});
    const pending = waiting();
    use.reads.readPublished = pending.readPublished;
    const done = run(exported(), CUSTOMER, use);
    let most = 0;
    for (let answered = 0; answered < entries.length; answered++) {
      await vi.waitFor(() => expect(pending.reads.length).toBeGreaterThan(answered));
      most = Math.max(most, pending.reads.length - answered);
      pending.reads[answered].answer({ state: "Not published" });
    }
    await done;
    expect([most, pending.reads.map(read => read.page)]).toEqual([AT_A_TIME, entries.map(entry => entry.guid)]);
  });

  it("stops when the run is stopped: no further page is read, nothing is named, and the run ends with the stop", async () => {
    const entries = Array.from({ length: 10 }, (_, index) => ({ guid: guid(5000 + index) }));
    const use = fake(entries, {});
    const pending = waiting();
    use.reads.readPublished = pending.readPublished;
    const stop = new AbortController();
    const done = run(exported(), CUSTOMER, use, stop.signal);
    await vi.waitFor(() => expect(pending.reads).toHaveLength(AT_A_TIME));
    stop.abort(new Error("Stopped: the results page was closed."));
    for (const read of pending.reads) read.answer({ state: "Not published" });
    await expect(done).rejects.toThrow("Stopped: the results page was closed.");
    expect([pending.reads.length, use.asked]).toEqual([AT_A_TIME, [PAGES]]);
  });

  it("ends the page reads when the session has ended, and says so", async () => {
    const entries = Array.from({ length: 10 }, (_, index) => ({ guid: guid(5000 + index) }));
    const use = fake(entries, {});
    const pending = waiting();
    use.reads.readPublished = pending.readPublished;
    const done = run(exported(), CUSTOMER, use);
    await vi.waitFor(() => expect(pending.reads).toHaveLength(AT_A_TIME));
    pending.reads[1].fail(new RestError("SIGNED_OUT", 401));
    expect(await done).toEqual(withoutPages("you're signed out of Anaplan"));
    // The reads under way finish; none starts after them.
    for (const read of pending.reads) read.answer({ state: "Not published" });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(pending.reads).toHaveLength(AT_A_TIME);
  });

  it("reads nothing where the address names no customer, and says why the three tables are not there", async () => {
    const use = fake(BOTH, { [PAGE_A]: demandBoard() });
    expect(await run(exported(), undefined, use)).toEqual(withoutPages(NO_CUSTOMER));
    expect(use.asked).toEqual([]);
  });

  it("says why when the list of pages cannot be read: refused, signed out, failed, or not a list", async () => {
    for (const [answer, why] of [
      [new RestError("HTTP_ERROR", 403), "Anaplan refused the list of the pages built on this model"],
      [new RestError("SIGNED_OUT", 401), "you're signed out of Anaplan"],
      [new RestError("TIMEOUT"), "the list of the pages built on this model could not be read (TIMEOUT)"],
      [{ pages: [] }, "Anaplan's list of the pages built on this model was not in a form Cardigan reads"],
    ] as const) {
      const use = fake([], {});
      use.reads.getJson = vi.fn(async () => { if (answer instanceof Error) throw answer; return answer; }) as unknown as PageReads["getJson"];
      expect(await run(exported(), CUSTOMER, use), why).toEqual(withoutPages(why));
      expect(vi.mocked(use.reads.readPublished), why).not.toHaveBeenCalled();
    }
  });

  it("notes the pages it could not read and those never published, and leaves a count it cannot know empty", async () => {
    const use = fake([...BOTH, { guid: PAGE_C, name: "Draft page", hasPublishedVersion: false }, { guid: guid(4000), name: "Old page" }, { name: "Odd entry" },
      { guid: PAGE_A, name: "Demand board again" }], { [PAGE_A]: demandBoard(), [PAGE_B]: "Not analysed: no access" });
    const result = await run(exported(), CUSTOMER, use);
    // A page that has no published version is not asked for when the list says so; one listed twice is read once.
    expect(use.asked.filter(path => path.startsWith("page "))).toEqual([`page ${PAGE_A}`, `page ${PAGE_B}`, `page ${guid(4000)}`]);
    const notes = ["2 of the 4 pages built on this model have no published version, so they are not in these tables.",
      "2 pages could not be read, so a module on one of them may show as not on any page: Odd entry (no page ID); Supply board (no access)."];
    expect(result.summary.slice(-2)).toEqual(notes.map(note => `Pages built on the model: ${note}`));
    expect(detailsOf(result).filter(row => row[0] === "Notes")).toEqual([["Notes", "Source Models", "none"], ...notes.map(note => ["Notes", "Pages built on the model", note])]);
    // Volume is the condition of no filter on the pages read: on the one that was not, it may be.
    expect(filterUses(result)).toEqual([["Demand", ""], ["Volume", ""], ["Factors", ""], ["Territory demand", 1], ["Unused", ""], ["Note", ""]]);
    // The apps are those of the list's pages that say theirs: the unread page's app is not known.
    expect(detailsOf(result)[3]).toEqual(["Model", "Apps", "Planning app"]);
  });

  it("shows an app by its ID where its name cannot be read, and says so", async () => {
    const use = fake(BOTH, { [PAGE_A]: demandBoard(), [PAGE_B]: supplyBoard }, { [APP_A]: "Planning app" });
    const result = await run(exported(), CUSTOMER, use);
    expect(rowsOf(result, MODULE_USAGE_FILE)!.map(row => row[1])).toEqual(["Planning app", APP_B, "Planning app", "-"]);
    expect(detailsOf(result)[3]).toEqual(["Model", "Apps", `${APP_B}\nPlanning app`]);
    expect(result.summary.at(-1)).toBe("Pages built on the model: The names of 1 app could not be read: it is shown by ID.");
  });

  it("says plainly that no app's pages use the model, and names no apps where no page tells them", async () => {
    const none = await run(exported(), CUSTOMER, fake([], {}));
    expect(detailsOf(none)[3]).toEqual(["Model", "Apps", NO_APPS]);
    expect(rowsOf(none, MODULE_USAGE_FILE)).toEqual([["Demand", "-", "Not on any page"], ["Factors", "-", "Not on any page"], ["Unused", "-", "Not on any page"]]);
    expect([rowsOf(none, PAGE_FILTERS_FILE), rowsOf(none, PAGE_ACTIONS_FILE)]).toEqual([[], []]);
    expect(filterUses(none).map(([, count]) => count)).toEqual(["", 0, "", 0, "", 0]);

    // The one page could not be read, and the list does not say its app.
    const unknown = await run(exported(), CUSTOMER, fake([{ guid: PAGE_B }], { [PAGE_B]: "Not analysed: no access" }));
    expect(detailsOf(unknown).filter(row => row[1] === "Apps")).toEqual([]);
  });

  it("leaves the export as it was, with the three tables left out, when its own work fails", async () => {
    const use = fake(BOTH, { [PAGE_A]: demandBoard(), [PAGE_B]: supplyBoard });
    use.reads.loadCatalog = vi.fn(async () => { throw new Error("unexpected"); });
    expect(await run(exported(), CUSTOMER, use)).toEqual(withoutPages("Cardigan could not make them: unexpected"));
    expect(use.log.at(-1)).toBe("pages built on the model: unexpected");
  });
});
