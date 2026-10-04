import { describe, expect, it } from "vitest";
import { TAB_FILES } from "../analyse.js";
import { buildReport, HEADERS, NONE, type PageInput, type TabName } from "../report.js";
import { plainRows } from "../result-plain.js";
import type { AnalysisResult, Cell, ResultTable } from "../result-types.js";
import { tableCsv } from "../result-zip.js";
import { selectRows, sortRows } from "./table-engine.js";
import { BY_OBJECT_HEADERS, objectOf, TYPE_ORDER, usedOn, WHERE_USED_FILE, whereUsedView, type WhereUsedObject, type WhereUsedView } from "./where-used-view.js";

// Made-up apps, models, pages and IDs only.

/** The app export's files, as the analysis names them, and the report table each holds. */
const FILES: Record<string, TabName> = Object.fromEntries((Object.keys(TAB_FILES) as TabName[]).map(tab => [TAB_FILES[tab], tab]));
type Fields = Record<string, Cell>;
/** An app file with the report's real headers; each row gives only the columns it cares about, the rest are dashes. */
const appTable = (file: string, rows: Fields[]): ResultTable => {
  const headers = HEADERS[FILES[file]];
  return { file, label: file.replace(/\.csv$/, ""), headers: [...headers], rows: rows.map(row => headers.map(header => row[header] ?? NONE)), guard: true };
};
const app = (...tables: ResultTable[]): AnalysisResult => ({ kind: "app", name: "Demo app", id: "id", zipName: "x.zip", tables, summary: [] });

/** A row of Where Used.csv: an object, the card that uses it, and what as. */
const use = (type: string, name: string, module: string, page: string, card: Cell, usedAs: string, id: Cell): Fields =>
  ({ "Object type": type, "Object name": name, "Object's module": module, Page: page, "Card #": card, "Used as": usedAs, "Object ID": id });
const whereUsed = (...rows: Fields[]): ResultTable => appTable("Where Used.csv", rows);
/** A row of Pages.csv: a page and the model it reads. */
const page = (name: string, model: string, modelId: string, more: Fields = {}): Fields => ({ Page: name, Model: model, Workspace: "Main", "Model ID": modelId, ...more });
const pages = (...rows: Fields[]): ResultTable => appTable("Pages.csv", rows);
const cards = (...rows: [page: string, card: Cell, id: string][]): ResultTable =>
  appTable("Cards.csv", rows.map(([name, card, id]) => ({ Page: name, "Card #": card, "Card ID": id })));

const guid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const [DEMAND, SUPPLY] = ["0A".repeat(16), "0B".repeat(16)];
const demand = (name: string, more: Fields = {}) => page(name, "Demand planning", DEMAND, more);
const supply = (name: string, more: Fields = {}) => page(name, "Supply planning", SUPPLY, more);
const [SALES, MARGIN] = ["102000000001", "286000000004"];
/** The view's headers in an app of one model: there is no Model column to tell objects apart by. */
const ONE_MODEL_HEADERS = ["Object type", "Object name", "Object's module", "Pages", "Cards", "Used as", "Object ID"];
const search = (text: string) => ({ search: text, filters: new Map<number, Set<string>>() });

/** A count as its cell holds it: a number, or with a plus sign the least it can be. */
const counted = (least: number, most: number | undefined): Cell => (most === undefined ? least : `${least}+`);

/** How many pages have a name, as a Pages table lists them, and how many of those it says have no cards. A page is its
 * Page ID, or its row where the table gives no ID; it has no cards where every row of it says 0 cards. */
function pagesNamed(table: ResultTable, name: string): { listed: number; withoutCards: number } {
  const [pageAt, idAt, cardsAt] = ["Page", "Page ID", "Total cards"].map(header => table.headers.indexOf(header));
  const noCards = new Map<string, boolean>();
  table.rows.forEach((row, index) => {
    if (String(row[pageAt] ?? "") !== name) return;
    const id = idAt < 0 ? "" : String(row[idAt] ?? "").trim();
    const listed = id !== "" && id !== NONE ? `page ${id}` : `row ${index}`;
    noCards.set(listed, (noCards.get(listed) ?? true) && cardsAt >= 0 && String(row[cardsAt] ?? "").trim() === "0");
  });
  return { listed: noCards.size, withoutCards: [...noCards.values()].filter(none => none).length };
}

/** A result's view, after checking what holds for every view: its uses are the file's rows, each of them exactly once and
 * as the file has it, and each object's row says what its uses add up to. A count is the number of names and numbers
 * its uses give, and nothing says otherwise, unless some of them are on a page name that more than one page has: then it
 * is at least that, it is marked wherever it is not exact, and the object and the view say so. */
function viewOf(result: AnalysisResult): WhereUsedView {
  const view = whereUsedView(result);
  if (!view) throw new Error("The result has no by-object view");
  const file = result.tables.find(table => table.file === "Where Used.csv");
  if (!file) throw new Error("The result has no Where used file");
  const cell = (row: number, header: string): Cell => file.rows[row][file.headers.indexOf(header)] ?? "";
  const shared = new Map(view.sharedPageNames ?? []);
  const onShared = view.objects.flatMap(object => object.uses).filter(used => used.pagesOfName !== undefined);
  // Every number of pages that is said of a name is the number of pages the Pages table lists under it: in the view, on
  // each use, and in the words of both notes. Where a note says that some of them have no cards, the table says so of
  // exactly that many, and of fewer than all of them.
  const listedPages = result.tables.find(table => table.file === "Pages.csv");
  if (!listedPages) throw new Error("The result has no Pages file");
  for (const [name, said] of shared) expect(said, name).toBe(pagesNamed(listedPages, name).listed);
  for (const text of [view.note, ...view.objects.map(object => object.note ?? "")]) {
    for (const [, name, said, without] of text.matchAll(/"([^"]*)" \((\d+) pages(?:, (\d+) of them without cards)?\)/g)) {
      const { listed, withoutCards } = pagesNamed(listedPages, name);
      expect(Number(said), text).toBe(listed);
      expect(without === undefined ? [0, listed] : [Number(without)], text).toContain(withoutCards);
      if (without !== undefined) expect(withoutCards, text).toBeLessThan(listed);
    }
  }
  expect([...shared.keys()].sort()).toEqual([...new Set(onShared.map(used => used.page))].sort());
  expect("sharedPageNames" in view).toBe(onShared.length > 0);
  expect(view.note.includes("shared by more than one page")).toBe(onShared.length > 0);
  expect(view.note.includes('A count with "+"')).toBe(view.objects.some(object => object.pagesMost !== undefined || object.cardsMost !== undefined));
  // None lost and none twice.
  expect(view.totalUses).toBe(file.rows.length);
  expect(view.objects.flatMap(object => object.uses.map(used => used.row)).sort((a, b) => a - b)).toEqual(file.rows.map((_, index) => index));
  expect(view.rows).toHaveLength(view.objects.length);
  // Model is a column only where the app has several models; every object has its model either way.
  expect(view.headers).toEqual(view.multiModel ? BY_OBJECT_HEADERS : ONE_MODEL_HEADERS);
  expect(view.columns.map(shown => [shown.index, shown.label])).toEqual(view.headers.map((header, index) => [index, header]));
  view.objects.forEach((object, index) => {
    // Its uses are in the file's order, and each is the file's row: that type of object, on that page and card, as that.
    const order = object.uses.map(used => used.row);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    for (const used of object.uses) {
      expect([object.type, used.page, used.usedAs]).toEqual(["Object type", "Page", "Used as"].map(header => String(cell(used.row, header))));
      expect(used.card).toBe(cell(used.row, "Card #"));
      // A use says how many pages have its page's name where several do, and nothing of it otherwise.
      expect(used.pagesOfName).toBe(shared.get(used.page));
      expect("pagesOfName" in used).toBe(shared.has(used.page));
    }
    // It says what they add up to, and its row says the same, cell for cell. Each page name is at least a page and each
    // card number on it at least a card: exactly that many, unless uses on a shared name leave more open.
    const [names, numbers] = [new Set(object.uses.map(used => used.page)).size, new Set(object.uses.map(used => JSON.stringify([used.page, String(used.card)]))).size];
    const open = object.uses.filter(used => used.pagesOfName !== undefined);
    if (open.length === 0) {
      expect([object.pages, object.cards]).toEqual([names, numbers]);
      expect(["pagesMost", "cardsMost", "note"].filter(key => key in object)).toEqual([]);
    } else {
      // On no more pages than have the name, and on no more pages or cards than there are uses.
      const room = [...new Set(open.map(used => used.page))].reduce((sum, name) => sum + Math.min(shared.get(name) ?? 1, open.filter(used => used.page === name).length) - 1, 0);
      expect(object.pages).toBeGreaterThanOrEqual(names);
      expect(object.cards).toBeGreaterThanOrEqual(numbers);
      expect(object.pagesMost ?? object.pages).toBeLessThanOrEqual(names + room);
      expect(object.cardsMost ?? object.cards).toBeLessThanOrEqual(object.uses.length);
      // The most is there only where it is more than the least.
      expect([object.pagesMost ?? Infinity, object.cardsMost ?? Infinity].map((most, at) => most > [object.pages, object.cards][at])).toEqual([true, true]);
      expect(object.note).toContain(`It has ${open.length} use${open.length === 1 ? "" : "s"} on `);
      expect(object.note).toContain("which of those pages a use is on is not known.");
      expect(object.note?.includes(" It is on ")).toBe(object.pagesMost !== undefined || object.cardsMost !== undefined);
    }
    expect(object.roles.reduce((sum, [, uses]) => sum + uses, 0)).toBe(object.uses.length);
    expect(object.roles.map(([role]) => role).sort()).toEqual([...new Set(object.uses.map(used => used.usedAs))].sort());
    const said: Record<string, Cell> = { "Object type": object.type, "Object name": object.name, "Object's module": object.module, Model: object.model,
      Pages: counted(object.pages, object.pagesMost), Cards: counted(object.cards, object.cardsMost), "Used as": view.rows[index][view.headers.indexOf("Used as")],
      "Object ID": object.id };
    expect(view.rows[index]).toEqual(view.headers.map(header => said[header]));
    expect(objectOf(view, view.rows[index])).toBe(object);
  });
  return view;
}
/** One column of a view, by its header: Model is there in an app of several models only. */
const column = (view: WhereUsedView, header: string): Cell[] => view.rows.map(row => row[view.headers.indexOf(header)]);

// An app on one model: three pages, and a line item that several cards on two of them use in three ways.
const PAGES = pages(demand("Overview", { "Page ID": guid(1) }), demand("Stores", { "Page ID": guid(2) }), demand("Admin", { "Page ID": guid(3) }));
const USES = whereUsed(
  use("Module", "REV01 Sales", NONE, "Overview", 1, "Data source (custom view)", SALES),
  use("Dimension", "Products", NONE, "Overview", 1, "Rows", "101000000001"),
  use("Line item", "Margin %", "REV01 Sales", "Overview", 1, "Filter", MARGIN),
  use("Line item", "Margin %", "REV01 Sales", "Overview", 1, "Formatting", MARGIN),
  use("Line item", "Margin %", "REV01 Sales", "Overview", 2, "KPI value", MARGIN),
  use("Module", "REV01 Sales", NONE, "Stores", 1, "Data source (via saved view)", SALES),
  use("Saved view", "Top stores", "REV01 Sales", "Stores", 1, "Data source", "130000000007"),
  use("Line item", "Margin %", "REV01 Sales", "Stores", 3, "Filter", MARGIN),
  use("Process", "Refresh plan", NONE, "Admin", 1, "Action button", "118000000002"),
  use("Page", "Stores", NONE, "Admin", 2, "Link target", guid(2)),
);

// Cards as the card reader describes them, which between them use an object in every way the report writes.
const ref = (id: string, name: string, more: Record<string, unknown> = {}) => ({ id, name, ...more });
const [SALES_MODULE, PRICES_MODULE] = [ref(SALES, "REV01 Sales"), ref("102000000002", "REV02 Prices")];
const [MARGIN_ITEM, TARGET_ITEM] = [ref(MARGIN, "Margin %", { moduleName: "REV01 Sales" }), ref("286000000005", "Target", { moduleName: "REV01 Sales" })];
const TIME = ref("20000000003", "Time");
/** The native action types the report has its own name for. */
const NATIVE_ACTIONS = ["IMPORT", "EXPORT", "PROCESS", "BULK_COPY", "ASSIGN", "COPY_BRANCH", "INTEGRATION", "FORECASTER", "WORKFLOW_TEMPLATE", "NOTIFICATION", "FORM",
  "WRITEBACK", "NAVIGATION", "DMS_EXTRACT", "DMS_LINK"];
const DESCRIBED = [
  { id: "card-1", type: "TABLE", viewType: "customView", sources: [{ module: SALES_MODULE }],
    grid: { regions: [{ region: "SINGLE", module: SALES_MODULE,
      rows: { dimensions: [{ dimension: ref("101000000001", "Products") }], filter: { match: "ALL", conditions: [
        { filterLineItem: MARGIN_ITEM, operator: "GREATER_THAN", values: [0], filterContext: [{ dimension: TIME, selection: "current" }] }] } },
      columns: { dimensions: [{ dimension: TIME }] }, pivot: { pages: [{ dimension: ref("101000000002", "Regions") }] } }] },
    conditionalFormatting: [{ type: "BG_COLOR", target: MARGIN_ITEM, source: TARGET_ITEM, pegs: [] }],
    navigation: { page: ref(guid(2), "Stock"), pageType: "BOARD" } },
  { id: "card-2", type: "TABLE", viewType: "savedView", sources: [{ module: SALES_MODULE, view: ref("130000000007", "Top stores", { moduleName: "REV01 Sales" }),
    viewLayout: { rows: [{ id: "101000000003", name: "Stores" }], columns: [{ id: "20000000012", name: "Line Items" }], pages: [{ id: "20000000020", name: "Versions" }] } }] },
  { id: "card-3", type: "TABLE", viewType: "moduleView", sources: [{ module: PRICES_MODULE }] },
  { id: "card-4", type: "TABLE", viewType: "combinedGrid", sources: [{ module: SALES_MODULE }, { module: PRICES_MODULE }], grid: { regions: [
    { region: "left", module: SALES_MODULE, rows: { dimensions: [] }, columns: { dimensions: [] } },
    { region: "right", module: PRICES_MODULE, rows: { dimensions: [] }, columns: { dimensions: [] } }] } },
  { id: "card-5", type: "CARD", sources: [{ module: SALES_MODULE }], kpi: { lineItem: MARGIN_ITEM } },
  { id: "card-6", type: "FIELD", fields: [{ lineItem: TARGET_ITEM }] },
  { id: "card-7", type: "IMAGE", image: { lineItem: ref("286000000006", "Picture", { moduleName: "REV02 Prices" }) } },
  { id: "card-8", type: "ACTION", actions: [
    ...NATIVE_ACTIONS.map((actionType, index) => ({ name: `Button ${index + 1}`, action: { id: `1180000000${String(index + 1).padStart(2, "0")}`, actionType } })),
    { name: "Custom step", action: { id: "119000000001", actionType: "CUSTOM_STEP" } }, { name: "Untyped", action: { id: "119000000002" } }] },
];
/** A page as the report takes it: its name, its ID, its model and its cards as the card reader describes them. */
const input = (pageName: string, pageGuid: string, modelName: string, modelId: string, described: unknown[]): PageInput => ({
  appName: "Demo app", categoryName: "Planning", pageName, pageType: "BOARD", state: "Published (no unpublished changes)", modelName, workspaceName: "Main",
  pageGuid, appGuid: guid(100), modelId, details: { cards: described } as unknown as PageInput["details"] });
/** The app the report makes of such pages: tables named, headed and made plain as the analysis hands them over. */
function reportedApp(...inputs: PageInput[]): AnalysisResult {
  const report = buildReport(inputs);
  return app(...(Object.keys(HEADERS) as TabName[]).map((tab): ResultTable =>
    ({ file: TAB_FILES[tab], label: TAB_FILES[tab].replace(/\.csv$/, ""), headers: [...report[tab].headers], rows: plainRows(report[tab].rows), guard: true })));
}
/** The app of those cards on a page of one model, and of a card on a page of another model that shows a module with the
 * first model's module's ID. */
const reported = (): AnalysisResult => reportedApp(input("Overview", guid(1), "Demand planning", DEMAND, DESCRIBED),
  input("Stock", guid(2), "Supply planning", SUPPLY, [{ id: "card-9", type: "TABLE", viewType: "moduleView", sources: [{ module: ref(SALES, "INV01 Stock") }] }]));
/** A grid card of a module, with Products on its rows and Time on its columns. */
const grid = (id: string, module: { id: string; name: string }) => ({ id, type: "TABLE", viewType: "customView", sources: [{ module }],
  grid: { regions: [{ region: "SINGLE", module, rows: { dimensions: [{ dimension: ref("101000000001", "Products") }] }, columns: { dimensions: [{ dimension: TIME }] } }] } });

describe("The Where used table, by object", () => {
  it("is the view of the file the analysis writes its Where used table to", () => {
    expect(WHERE_USED_FILE).toBe(TAB_FILES["Where used"]);
    expect(BY_OBJECT_HEADERS).toEqual(["Object type", "Object name", "Object's module", "Model", "Pages", "Cards", "Used as", "Object ID"]);
  });

  it("answers \"where is this object used?\" for a navigation page of twenty image cards: one row per object, not two per card", () => {
    // What the file's own table reads like: "Module / Images / Home / card 1 / Data source", "Line item / 21 / Images / Home /
    // card 1 / Image", "Module / Images / Home / card 2 / Data source", and so on, forty rows for twenty cards.
    const numbers = Array.from({ length: 20 }, (_, index) => index + 1);
    const view = viewOf(app(pages(page("Home", "Supply plan 2021", SUPPLY)), whereUsed(...numbers.flatMap(card => [
      use("Module", "Images", NONE, "Home", card, "Data source", "102000000050"),
      use("Line item", String(20 + card), "Images", "Home", card, "Image", String(286000000100 + card))]))));
    expect(view.headers).toEqual(ONE_MODEL_HEADERS);
    expect(view.rows).toHaveLength(21);
    expect(view.rows[0]).toEqual(["Module", "Images", "—", 1, 20, "Data source", "102000000050"]);
    expect(view.rows.slice(1)).toEqual(numbers.map(card => ["Line item", String(20 + card), "Images", 1, 1, "Image", String(286000000100 + card)]));
    // The module's uses are a click away: every card of the page, in the page's order.
    expect(view.objects[0].uses.map(used => [used.page, used.card, used.usedAs])).toEqual(numbers.map(card => ["Home", card, "Data source"]));
    expect(view.note).toBe("40 uses of 21 objects. The CSV lists every use.");
    // The page's search finds line item 21 and nothing called a plan. No row holds the name of the app's one model, which
    // would answer to "21" and to "plan" in every row.
    expect(selectRows(view.rows, search("21")).map(row => row[1])).toEqual(["21"]);
    expect(selectRows(view.rows, search("plan"))).toEqual([]);
    expect(view.objects.every(object => object.model === "Supply plan 2021")).toBe(true);
  });

  it("gives an object used by several cards on several pages in several ways one row: its pages, its cards and its roles", () => {
    const view = viewOf(app(PAGES, USES));
    expect(view.rows).toEqual([
      ["Module", "REV01 Sales", "—", 2, 2, "Data source (custom view); Data source (via saved view)", SALES],
      ["Line item", "Margin %", "REV01 Sales", 2, 3, "Filter; Formatting; KPI value", MARGIN],
      ["Dimension", "Products", "—", 1, 1, "Rows", "101000000001"],
      ["Saved view", "Top stores", "REV01 Sales", 1, 1, "Data source", "130000000007"],
      ["Process", "Refresh plan", "—", 1, 1, "Action button", "118000000002"],
      ["Page", "Stores", "—", 1, 1, "Link target", guid(2)],
    ]);
    // The line item: four uses on three cards of two pages. Two cards filter by it, so Filter comes first.
    expect(view.objects[1]).toEqual({
      type: "Line item", name: "Margin %", module: "REV01 Sales", model: "Demand planning", pages: 2, cards: 3, id: MARGIN,
      roles: [["Filter", 2], ["Formatting", 1], ["KPI value", 1]],
      uses: [{ row: 2, page: "Overview", card: 1, usedAs: "Filter" }, { row: 3, page: "Overview", card: 1, usedAs: "Formatting" },
        { row: 4, page: "Overview", card: 2, usedAs: "KPI value" }, { row: 7, page: "Stores", card: 3, usedAs: "Filter" }],
    });
    expect(view.objects.map(object => object.model)).toEqual(Array.from({ length: 6 }, () => "Demand planning"));
    expect([view.totalUses, view.multiModel, view.ambiguousUses, view.unlistedUses]).toEqual([10, false, 0, 0]);
    expect(view.note).toBe("10 uses of 6 objects. The CSV lists every use.");
  });

  it("takes the same ID in two models for two objects, and in one model for one", () => {
    // The file has no model column: the Pages file says which model the page of each use reads.
    const uses = whereUsed(
      use("Module", "REV01 Sales", NONE, "Demand review", 1, "Data source", SALES),
      use("Module", "INV01 Stock", NONE, "Supply review", 1, "Data source", SALES),
      use("Module", "REV01 Sales", NONE, "Demand detail", 2, "Data source", SALES),
      use("Dimension", "Time", NONE, "Demand review", 1, "Columns", "20000000003"),
      use("Dimension", "Time", NONE, "Supply review", 1, "Columns", "20000000003"));
    const two = viewOf(app(pages(demand("Demand review"), demand("Demand detail"), supply("Supply review")), uses));
    expect(two.headers).toEqual(BY_OBJECT_HEADERS);
    expect(two.rows).toEqual([
      ["Module", "INV01 Stock", "—", "Supply planning", 1, 1, "Data source", SALES],
      ["Module", "REV01 Sales", "—", "Demand planning", 2, 2, "Data source", SALES],
      ["Dimension", "Time", "—", "Demand planning", 1, 1, "Columns", "20000000003"],
      ["Dimension", "Time", "—", "Supply planning", 1, 1, "Columns", "20000000003"],
    ]);
    expect(two.objects.map(object => object.uses.map(used => used.row))).toEqual([[1], [0, 2], [3], [4]]);
    expect([two.multiModel, two.ambiguousUses, two.unlistedUses]).toEqual([true, 0, 0]);
    expect(two.note).toBe("5 uses of 4 objects. The CSV lists every use.");
    // The very same file in an app whose pages all read one model: one module and one dimension, and no Model column. The
    // module goes by the name most of its uses give.
    const one = viewOf(app(pages(demand("Demand review"), demand("Demand detail"), demand("Supply review")), uses));
    expect(one.rows).toEqual([
      ["Module", "REV01 Sales", "—", 3, 3, "Data source", SALES],
      ["Dimension", "Time", "—", 2, 2, "Columns", "20000000003"],
    ]);
    expect([one.multiModel, one.objects.map(object => object.model)]).toEqual([false, ["Demand planning", "Demand planning"]]);
  });

  it("takes a page that cards link to for one object whichever model the linking pages read, and names the page's own model", () => {
    // A page is the app's, and its ID is its own: the model of a page it is linked from says nothing about it.
    const view = viewOf(app(
      pages(demand("Home", { "Page ID": guid(10) }), supply("Stock home", { "Page ID": guid(11) }), supply("Supply review", { "Page ID": guid(12) })),
      whereUsed(
        use("Page", "Supply review", NONE, "Home", 3, "Link target", guid(12)),
        use("Page", "Supply review", NONE, "Stock home", 1, "Link target", guid(12)),
        use("Page", "Finance home", NONE, "Home", 4, "Link target", guid(99)),
        use("Module", "REV01 Sales", NONE, "Home", 1, "Data source", SALES))));
    expect(view.rows).toEqual([
      ["Module", "REV01 Sales", "—", "Demand planning", 1, 1, "Data source", SALES],
      // A page of another app is in no model the Pages file knows.
      ["Page", "Finance home", "—", "—", 1, 1, "Link target", guid(99)],
      ["Page", "Supply review", "—", "Supply planning", 2, 2, "Link target", guid(12)],
    ]);
    expect([view.multiModel, view.ambiguousUses, view.unlistedUses]).toEqual([true, 0, 0]);
  });

  it("names a model by its name, and tells two models of one name apart by their workspaces or their IDs", () => {
    const [MAIN, ARCHIVE] = ["1A".repeat(16), "1B".repeat(16)];
    /** The Model cells of one module ID used on a page of each model, in the view's order. */
    const models = (...rows: Fields[]) => column(viewOf(app(pages(...rows),
      whereUsed(...rows.map(row => use("Module", "REV01 Sales", NONE, String(row.Page), 1, "Data source", SALES))))), "Model");
    expect(models(demand("One"), supply("Two"))).toEqual(["Demand planning", "Supply planning"]);
    // The same name in two workspaces, as App Details.csv lists them; beside them a model whose name is its own.
    expect(models(page("One", "Planning", MAIN), page("Two", "Planning", ARCHIVE, { Workspace: "Archive" }), supply("Three")))
      .toEqual(["Planning (Archive)", "Planning (Main)", "Supply planning"]);
    // The same name in one workspace, or a workspace the file does not give: the IDs tell them apart.
    expect(models(page("One", "Planning", MAIN), page("Two", "Planning", ARCHIVE))).toEqual([`Planning (${MAIN})`, `Planning (${ARCHIVE})`]);
    expect(models(page("One", "Planning", MAIN, { Workspace: NONE }), page("Two", "Planning", ARCHIVE, { Workspace: "Archive" })))
      .toEqual([`Planning (${MAIN})`, `Planning (${ARCHIVE})`]);
    // A model the file names only by its ID goes by the ID, and takes its name from another page of the same model.
    expect(models(page("One", NONE, MAIN), supply("Two"))).toEqual([MAIN, "Supply planning"]);
    expect(models(page("One", NONE, MAIN), page("Two", "Planning", MAIN), supply("Three"))).toEqual(["Planning", "Supply planning"]);
    // Whichever of them comes first: a later page of the model that does not name it takes nothing away.
    expect(models(page("One", "Planning", MAIN), page("Two", NONE, MAIN), supply("Three"))).toEqual(["Planning", "Supply planning"]);
    expect(models(page("One", "Planning", MAIN), page("Two", "", MAIN, { Workspace: "" }), page("Three", NONE, MAIN), supply("Four"))).toEqual(["Planning", "Supply planning"]);
    // A model without an ID is known by its name and its workspace.
    expect(models(page("One", "Planning", NONE), page("Two", "Planning", NONE, { Workspace: "Archive" }), page("Three", "Planning", NONE)))
      .toEqual(["Planning (Archive)", "Planning (Main)"]);
  });

  it("knows an object without an ID by its type, its name and its module", () => {
    const file = whereUsed(
      use("Line item", "Sales, Margin", NONE, "Overview", 4, "Filter", NONE),
      // The same object: the ID is the report's dash in one row and empty in the other.
      use("Line item", "Sales, Margin", NONE, "Stores", 2, "Filter", ""),
      // Another module, a name that differs in case, and a row that does have an ID: three other objects.
      use("Line item", "Sales, Margin", "REV02 Prices", "Stores", 2, "Filter", NONE),
      use("Line item", "sales, margin", NONE, "Stores", 5, "Filter", NONE),
      use("Line item", "Sales, Margin", NONE, "Stores", 6, "Filter", "286000000009"),
      // Only spaces are no ID either: two modules, not one module of the ID "  ".
      use("Module", "REV01 Sales", NONE, "Stores", 6, "Data source", "  "),
      use("Module", "REV02 Prices", NONE, "Stores", 7, "Data source", "  "));
    // A row cut short has no ID cell at all.
    const view = viewOf(app(PAGES, { ...file, rows: [...file.rows, ["Dimension", "Region", NONE, "Overview", 4, "Filter context"]] }));
    expect(view.rows).toEqual([
      ["Module", "REV01 Sales", "—", 1, 1, "Data source", "  "],
      ["Module", "REV02 Prices", "—", 1, 1, "Data source", "  "],
      ["Line item", "Sales, Margin", "—", 2, 2, "Filter", "—"],
      ["Line item", "Sales, Margin", "—", 1, 1, "Filter", "286000000009"],
      ["Line item", "sales, margin", "—", 1, 1, "Filter", "—"],
      ["Line item", "Sales, Margin", "REV02 Prices", 1, 1, "Filter", "—"],
      ["Dimension", "Region", "—", 1, 1, "Filter context", ""],
    ]);
    expect(view.objects.map(object => object.uses.map(used => used.row))).toEqual([[5], [6], [0, 1], [4], [3], [2], [7]]);
    // In an app of two models, such an object is still its model's own.
    const two = viewOf(app(pages(demand("Demand review"), supply("Supply review")), whereUsed(
      use("Line item", "Sales, Margin", NONE, "Demand review", 1, "Filter", NONE), use("Line item", "Sales, Margin", NONE, "Supply review", 1, "Filter", NONE))));
    expect(column(two, "Model")).toEqual(["Demand planning", "Supply planning"]);
    // Two uses without an ID in two modules are two objects: which module it is counts, not only whether there is one.
    const modules = viewOf(app(PAGES, whereUsed(
      use("Line item", "Amount", "REV01 Sales", "Overview", 1, "Field", NONE), use("Line item", "Amount", "REV02 Prices", "Overview", 1, "Field", NONE),
      use("Line item", "Amount", "REV01 Sales", "Stores", 1, "Field", ""))));
    expect(modules.rows).toEqual([["Line item", "Amount", "REV01 Sales", 2, 2, "Field", "—"], ["Line item", "Amount", "REV02 Prices", 1, 1, "Field", "—"]]);
    expect(modules.objects.map(object => object.uses.map(used => used.row))).toEqual([[0, 2], [1]]);
    // A linked page without an ID is known by its name, and no page of the Pages file is taken for it: these two pages
    // have no ID in the file either.
    const linked = viewOf(app(pages(demand("Overview"), demand("Stores")), whereUsed(use("Page", "Somewhere", NONE, "Overview", 7, "Link target", NONE))));
    expect([linked.rows, linked.objects[0].model]).toEqual([[["Page", "Somewhere", "—", 1, 1, "Link target", "—"]], "—"]);
  });

  it("does not guess the model of a use on a page the Pages file does not list: its object is listed without a model", () => {
    const uses = whereUsed(
      use("Module", "REV01 Sales", NONE, "Demand review", 1, "Data source", SALES),
      use("Module", "REV01 Sales", NONE, "Ghost page", 1, "Data source", SALES),
      // A page the file lists without any model says no more.
      use("Module", "REV01 Sales", NONE, "Draft page", 2, "Data source", SALES),
      use("Module", "INV01 Stock", NONE, "Supply review", 1, "Data source", SALES));
    const view = viewOf(app(pages(demand("Demand review"), supply("Supply review"), page("Draft page", NONE, NONE, { Workspace: NONE })), uses));
    expect(view.rows).toEqual([
      ["Module", "INV01 Stock", "—", "Supply planning", 1, 1, "Data source", SALES],
      ["Module", "REV01 Sales", "—", "—", 2, 2, "Data source", SALES],
      ["Module", "REV01 Sales", "—", "Demand planning", 1, 1, "Data source", SALES],
    ]);
    expect(view.objects[1].uses.map(used => used.page)).toEqual(["Ghost page", "Draft page"]);
    expect([view.multiModel, view.ambiguousUses, view.unlistedUses]).toEqual([true, 0, 2]);
    expect(view.note).toBe("4 uses of 3 objects. The CSV lists every use. 2 uses are on a page whose model is not known, so their objects are listed without a model.");
    // An app whose pages name one model has nothing to tell apart: every object is that model's.
    const one = viewOf(app(pages(demand("Demand review"), demand("Supply review"), page("Draft page", NONE, NONE)), uses));
    expect([one.rows, one.objects[0].model]).toEqual([[["Module", "REV01 Sales", "—", 4, 4, "Data source", SALES]], "Demand planning"]);
    expect([one.multiModel, one.ambiguousUses, one.unlistedUses, one.note]).toEqual([false, 0, 0, "4 uses of 1 object. The CSV lists every use."]);
    // And an app whose pages name no model at all has none to name.
    const none = viewOf(app(pages(page("Demand review", NONE, NONE)), uses));
    expect([none.rows, none.objects[0].model, none.multiModel]).toEqual([[["Module", "REV01 Sales", "—", 4, 4, "Data source", SALES]], "—", false]);
  });

  it("does not guess the model of a use on a page whose name pages of different models share, and counts those uses", () => {
    const view = viewOf(app(
      pages(demand("Overview"), supply("Overview"), demand("Summary"), demand("Summary"), demand("Demand review"), demand("Notes"), page("Notes", NONE, NONE)),
      whereUsed(
        // Two pages are called Overview, one in each model: which of them a use is on, the file does not say.
        use("Module", "REV01 Sales", NONE, "Overview", 1, "Data source", SALES),
        use("Module", "INV01 Stock", NONE, "Overview", 2, "Data source", SALES),
        // Two pages called Summary read the same model, and a page that names no model disagrees with nothing.
        use("Module", "REV01 Sales", NONE, "Summary", 1, "Data source", SALES),
        use("Module", "REV01 Sales", NONE, "Demand review", 1, "Data source", SALES),
        use("Module", "REV01 Sales", NONE, "Notes", 1, "Data source", SALES))));
    // The two uses on Overview are on cards 1 and 2: two cards for certain, on one of the two pages or on both.
    expect(view.rows).toEqual([
      ["Module", "REV01 Sales", "—", "—", "1+", 2, "Data source", SALES],
      ["Module", "REV01 Sales", "—", "Demand planning", 3, 3, "Data source", SALES],
    ]);
    expect(view.objects.map(object => object.uses.map(used => used.row))).toEqual([[0, 1], [2, 3, 4]]);
    expect([view.multiModel, view.ambiguousUses, view.unlistedUses]).toEqual([true, 2, 0]);
    // The model that is not known, then the names that pages share: a page that names no model may still have cards.
    const shared = "The CSV has only the name of a use's page, so the uses on those pages cannot be told apart.";
    expect(view.note).toBe("5 uses of 2 objects. The CSV lists every use. 2 uses are on a page whose model is not known, so their objects are listed without a model. "
      + `3 page names are each shared by more than one page: "Overview" (2 pages), "Summary" (2 pages), "Notes" (2 pages). ${shared} A count with "+" is at least that number.`);
    // One such use is said in the singular. It is on one page and one card, whichever of the two pages that is.
    const single = viewOf(app(pages(demand("Overview"), supply("Overview")), whereUsed(use("Module", "REV01 Sales", NONE, "Overview", 1, "Data source", SALES))));
    expect(single.rows).toEqual([["Module", "REV01 Sales", "—", "—", 1, 1, "Data source", SALES]]);
    expect(single.note).toBe("1 use of 1 object. The CSV lists every use. 1 use is on a page whose model is not known, so its object is listed without a model. "
      + `1 page name is shared by more than one page: "Overview" (2 pages). ${shared}`);
  });

  it("takes every object type and every role the report writes, each type at its place in the index", () => {
    const result = reported();
    const file = result.tables.find(table => table.file === WHERE_USED_FILE);
    const written = (header: string) => [...new Set(file?.rows.map(row => row[HEADERS["Where used"].indexOf(header)]))];
    // The report's own types are the ones the index puts in order, no more and no fewer. A native action type the report
    // has no name for is written as it is, and one without a type as the dash.
    expect(written("Object type").filter(type => type !== "CUSTOM_STEP" && type !== NONE).sort()).toEqual([...TYPE_ORDER].sort());
    expect(written("Object type")).toEqual(expect.arrayContaining(["CUSTOM_STEP", NONE]));
    const view = viewOf(result);
    expect([...new Set(column(view, "Object type"))]).toEqual([...TYPE_ORDER, NONE, "CUSTOM_STEP"]);
    expect(TYPE_ORDER).toEqual(["Module", "Line item", "Dimension", "Saved view", "Import", "Export", "Process", "Bulk copy", "Assign", "Copy branch", "Integration",
      "Forecaster", "Workflow template", "Notification", "Form", "Writeback", "Navigation", "Data Orchestrator extract", "Data Orchestrator link", "Page"]);
    // Every way the report says an object is used. None of them holds the text that separates the roles in a cell, so a
    // Used as cell reads one way only.
    const roles = ["Data source (custom view)", "Data source (via saved view)", "Data source (default view)", "Data source (combined grid section 1)",
      "Data source (combined grid section 2)", "Data source", "KPI value", "Field", "Image", "Rows", "Columns", "Page selector", "Rows (saved view)", "Columns (saved view)",
      "Pages (saved view)", "Filter", "Filter context", "Formatting", "Formatting values", "Action button", "Link target"];
    expect(written("Used as").sort()).toEqual([...roles].sort());
    expect([...new Set(column(view, "Used as").flatMap(cell => String(cell).split("; ")))].sort()).toEqual([...roles].sort());
    // The module ID both models have is two modules, and the page the first model's card links to is the second model's.
    expect(view.rows.filter(row => row[0] === "Module")).toEqual([
      ["Module", "INV01 Stock", "—", "Supply planning", 1, 1, "Data source (default view)", SALES],
      ["Module", "REV01 Sales", "—", "Demand planning", 1, 4, "Data source (custom view); Data source (via saved view); Data source (combined grid section 1); Data source", SALES],
      ["Module", "REV02 Prices", "—", "Demand planning", 1, 2, "Data source (default view); Data source (combined grid section 2)", "102000000002"],
    ]);
    expect(view.rows.filter(row => row[0] === "Page")).toEqual([["Page", "Stock", "—", "Supply planning", 1, 1, "Link target", guid(2)]]);
    // Each use names its card as the Cards file does.
    expect(view.objects.find(object => object.name === "Margin %")?.uses.map(used => [used.page, used.card, used.usedAs, used.cardId])).toEqual(
      [["Overview", 1, "Filter", "card-1"], ["Overview", 1, "Formatting", "card-1"], ["Overview", 5, "KPI value", "card-5"]]);
  });

  it("puts the objects in the order of an index: by type, then by name with numbers as numbers, then by module", () => {
    const named = (type: string, names: string[], module = "REV01 Sales") => names.map((name, index) => use(type, name, module, "Overview", index + 1, "Field", `${type} ${name} ${index}`));
    // Types: the model's parts, what a card runs, the pages it links to, then any other type by its name.
    const types = ["Zebra", "Page", "Process", NONE, "Saved view", "alpha", "Import", "Dimension", "Line item", "Module", "Navigation", "Export"];
    expect([...new Set(column(viewOf(app(PAGES, whereUsed(...types.flatMap(type => named(type, ["One"]))))), "Object type"))]).toEqual(
      ["Module", "Line item", "Dimension", "Saved view", "Import", "Export", "Process", "Navigation", "Page", NONE, "alpha", "Zebra"]);
    // Names: "2" before "11", whatever the case, and names that differ only in case always the same way round. (No name
    // here differs in the case of an "i": a browser set to Turkish reads "I" and "i" as two letters, in any table.)
    const names = ["Step 11", "21", "step 2", "11", "Step 2", "2", "STEP 2", "1", "Margin %", "step 1"];
    const sorted = ["1", "2", "11", "21", "Margin %", "step 1", "STEP 2", "Step 2", "step 2", "Step 11"];
    expect(column(viewOf(app(PAGES, whereUsed(...named("Line item", names)))), "Object name")).toEqual(sorted);
    expect(column(viewOf(app(PAGES, whereUsed(...named("Line item", [...names].reverse())))), "Object name")).toEqual(sorted);
    // Each of them is an object of its own: none is merged with a name that looks alike.
    expect(viewOf(app(PAGES, whereUsed(...named("Line item", names)))).rows).toHaveLength(names.length);
    // Then the module, read the same way; no module comes first. The module counts before the case of the name: "revenue"
    // of the first module stands among the "Revenue" of the others, where its module puts it.
    const modules = ["REV10 Returns", NONE, "REV2 Prices", "rev2 prices"];
    const view = viewOf(app(PAGES, whereUsed(...modules.map((module, index) => use("Line item", "Revenue", module, "Overview", 1, "Field", String(286000000100 + index))),
      use("Line item", "revenue", "REV1 Sales", "Overview", 1, "Field", "286000000150"), use("Line item", "Cost", "REV10 Returns", "Overview", 1, "Field", "286000000200"))));
    expect(view.rows.map(row => [row[1], row[2]])).toEqual(
      [["Cost", "REV10 Returns"], ["Revenue", "—"], ["revenue", "REV1 Sales"], ["Revenue", "REV2 Prices"], ["Revenue", "rev2 prices"], ["Revenue", "REV10 Returns"]]);
  });

  it("lists an object's roles most used first, then in the file's order, with a separator no role holds", () => {
    const roles = (...usedAs: string[]) => viewOf(app(PAGES, whereUsed(...usedAs.map((role, index) => use("Dimension", "Products", NONE, "Overview", index + 1, role, "101000000001")))));
    const view = roles("Rows", "Filter context", "Columns", "Filter context", "Columns", "Columns", "Page selector");
    expect(view.objects[0].roles).toEqual([["Columns", 3], ["Filter context", 2], ["Rows", 1], ["Page selector", 1]]);
    expect(column(view, "Used as")).toEqual(["Columns; Filter context; Rows; Page selector"]);
    // A role that holds the separator would read as two roles: the whole column is then separated by another.
    expect(column(roles("Rows; Columns", "Filter", "Filter"), "Used as")).toEqual(["Filter | Rows; Columns"]);
    expect(column(roles("Rows; Columns", "Rows | Columns", "Filter"), "Used as")).toEqual(["Rows; Columns / Rows | Columns / Filter"]);
    const mixed = viewOf(app(PAGES, whereUsed(
      use("Dimension", "Products", NONE, "Overview", 1, "Rows; Columns", "101000000001"), use("Dimension", "Products", NONE, "Overview", 2, "Filter", "101000000001"),
      use("Dimension", "Time", NONE, "Overview", 1, "Columns", "20000000003"), use("Dimension", "Time", NONE, "Overview", 1, "Filter context", "20000000003"))));
    expect(column(mixed, "Used as")).toEqual(["Rows; Columns | Filter", "Columns | Filter context"]);
  });

  it("names an object as most of its uses do, and by a name that says something where one use has none", () => {
    // An action the model does not name goes by each button's label, and the labels need not agree.
    const view = viewOf(app(PAGES, whereUsed(
      use("Process", "Refresh", NONE, "Overview", 1, "Action button", "118000000002"),
      use("Process", "Refresh plan", NONE, "Stores", 1, "Action button", "118000000002"),
      use("Process", "Refresh plan", NONE, "Admin", 1, "Action button", "118000000002"),
      // As often one name as the other: the one met first.
      use("Export", "Send", NONE, "Overview", 2, "Action button", "116000000001"),
      use("Export", "Send plan", NONE, "Stores", 2, "Action button", "116000000001"),
      // A dash and a blank are no name, however often they come.
      use("Line item", NONE, NONE, "Overview", 3, "Filter", MARGIN),
      use("Line item", "", "", "Stores", 3, "Filter", MARGIN),
      use("Line item", NONE, NONE, "Stores", 4, "Filter", MARGIN),
      use("Line item", "Margin %", "REV01 Sales", "Admin", 3, "Filter", MARGIN),
      // No use names it: what the first one holds.
      use("Dimension", "", NONE, "Overview", 4, "Rows", "101000000009"),
      use("Dimension", NONE, NONE, "Overview", 5, "Rows", "101000000009"))));
    expect(view.rows.map(row => row.slice(0, 3))).toEqual(
      [["Line item", "Margin %", "REV01 Sales"], ["Dimension", "", "—"], ["Export", "Send", "—"], ["Process", "Refresh plan", "—"]]);
  });

  it("shows the type as a tag, the counts as numbers and the ID as one to copy, with a Model column only for several models", () => {
    const one = viewOf(app(PAGES, USES));
    expect(one.columns.map(shown => [shown.label, shown.kind, shown.num, shown.hidden])).toEqual([
      ["Object type", "tag", false, false], ["Object name", "text", false, false], ["Object's module", "text", false, false],
      ["Pages", "text", true, false], ["Cards", "text", true, false], ["Used as", "text", false, false], ["Object ID", "id", false, true]]);
    // The type has its filter whatever the table holds, and a column of few different texts has one as in any table.
    const single = viewOf(app(PAGES, whereUsed(use("Module", "REV01 Sales", NONE, "Overview", 1, "Data source", SALES))));
    expect(single.columns.map(shown => shown.filter)).toEqual([true, false, false, false, false, false, false]);
    const two = viewOf(app(pages(demand("Demand review"), supply("Supply review")), whereUsed(
      use("Module", "REV01 Sales", NONE, "Demand review", 1, "Data source", SALES), use("Module", "INV01 Stock", NONE, "Supply review", 1, "Data source", SALES))));
    expect(two.columns.map(shown => [shown.label, shown.kind, shown.num, shown.hidden])).toEqual([
      ["Object type", "tag", false, false], ["Object name", "text", false, false], ["Object's module", "text", false, false], ["Model", "text", false, false],
      ["Pages", "text", true, false], ["Cards", "text", true, false], ["Used as", "text", false, false], ["Object ID", "id", false, true]]);
    expect(two.columns[3]).toEqual({ index: 3, label: "Model", kind: "text", num: false, filter: true, hidden: false });
    // The counts are numbers: the page's own sort puts 2 before 11, and its search finds an object by its ID as well.
    const wide = viewOf(app(pages(...Array.from({ length: 11 }, (_, index) => demand(`Page ${index + 1}`))), whereUsed(
      ...Array.from({ length: 11 }, (_, index) => use("Dimension", "Time", NONE, `Page ${index + 1}`, 1, "Columns", "20000000003")),
      use("Dimension", "Products", NONE, "Page 1", 1, "Rows", "101000000001"), use("Dimension", "Products", NONE, "Page 2", 1, "Rows", "101000000001"),
      use("Dimension", "Regions", NONE, "Page 3", 1, "Rows", "101000000002"))));
    const [pagesAt, cardsAt] = [wide.headers.indexOf("Pages"), wide.headers.indexOf("Cards")];
    expect(wide.rows.every(row => typeof row[pagesAt] === "number" && typeof row[cardsAt] === "number")).toBe(true);
    expect(sortRows(wide.rows, { column: pagesAt, dir: "asc" }).map(row => [row[1], row[pagesAt]])).toEqual([["Regions", 1], ["Products", 2], ["Time", 11]]);
    expect(sortRows(wide.rows, { column: pagesAt, dir: "desc" }).map(row => row[1])).toEqual(["Time", "Products", "Regions"]);
    expect(selectRows(wide.rows, search("20000000003")).map(row => row[1])).toEqual(["Time"]);
  });

  it("gives back the object of a row the page holds, whatever the page did with the rows", () => {
    const view = viewOf(app(PAGES, USES));
    const shown = sortRows(selectRows(view.rows, search("rev01")), { column: view.headers.indexOf("Cards"), dir: "desc" });
    expect(shown.map(row => objectOf(view, row)?.name)).toEqual(["Margin %", "REV01 Sales", "Top stores"]);
    expect(objectOf(view, shown[0])).toBe(view.objects[1]);
    // A row that only looks like one of the view's is not one of them.
    expect(objectOf(view, [...view.rows[1]])).toBeUndefined();
    expect(objectOf(view, [])).toBeUndefined();
  });

  it("names the card of each use by its ID, where the Cards file has exactly one such card", () => {
    const uses = (result: AnalysisResult) => viewOf(result).objects[1].uses.map(used => [used.page, used.card, used.cardId]);
    expect(uses(app(PAGES, USES, cards(["Overview", 1, "card-a"], ["Overview", 2, "card-b"], ["Stores", 1, "card-c"], ["Stores", 3, "card-d"], ["Admin", 1, "card-e"]))))
      .toEqual([["Overview", 1, "card-a"], ["Overview", 1, "card-a"], ["Overview", 2, "card-b"], ["Stores", 3, "card-d"]]);
    // Two rows of the Cards file for one page name and number are two cards: which of them a use is on, the file does not
    // say. That holds when the two have one ID too, here for card 2, written as a number and as text. A card without an
    // ID has none to give.
    expect(uses(app(PAGES, USES, cards(["Overview", 1, "card-a"], ["Overview", 1, "card-x"], ["Overview", "2", "card-b"], ["Overview", 2, "card-b"], ["Stores", 3, NONE]))))
      .toEqual([["Overview", 1, undefined], ["Overview", 1, undefined], ["Overview", 2, undefined], ["Stores", 3, undefined]]);
    // A card's number written as text is the same number: one row, and its ID.
    expect(uses(app(PAGES, USES, cards(["Overview", "1", "card-a"], ["Overview", "2", "card-b"], ["Stores", "3", "card-d"]))))
      .toEqual([["Overview", 1, "card-a"], ["Overview", 1, "card-a"], ["Overview", 2, "card-b"], ["Stores", 3, "card-d"]]);
    // Without the Cards file, or without one of its three columns, a use has its page and its card's number.
    const noId = cards(["Overview", 1, "card-a"]);
    expect(uses(app(PAGES, USES))).toEqual([["Overview", 1, undefined], ["Overview", 1, undefined], ["Overview", 2, undefined], ["Stores", 3, undefined]]);
    expect(uses(app(PAGES, USES, { ...noId, headers: noId.headers.map(header => (header === "Card ID" ? "Card" : header)) }))[0]).toEqual(["Overview", 1, undefined]);
    expect(viewOf(app(PAGES, USES)).objects[1].uses[0]).not.toHaveProperty("cardId");
  });

  it("says in a note how many uses and objects there are, and that the CSV lists every use", () => {
    const sized = (uses: number, objects: number) => viewOf(app(PAGES, whereUsed(...Array.from({ length: uses }, (_, index) =>
      use("Line item", `Line item ${index % objects}`, "REV01 Sales", "Overview", Math.floor(index / objects) + 1, "Field", String(286000000000 + index % objects)))))).note;
    expect(sized(796, 143)).toBe("796 uses of 143 objects. The CSV lists every use.");
    expect(sized(2, 1)).toBe("2 uses of 1 object. The CSV lists every use.");
    expect(sized(1, 1)).toBe("1 use of 1 object. The CSV lists every use.");
  });

  it("gives an empty view for an empty file", () => {
    const view = viewOf(app(PAGES, whereUsed()));
    expect([view.rows, view.objects, view.totalUses, view.multiModel, view.ambiguousUses, view.unlistedUses]).toEqual([[], [], 0, false, 0, 0]);
    expect(view.note).toBe("No uses. The CSV has no rows.");
    expect(view.columns.map(shown => shown.label)).toEqual(ONE_MODEL_HEADERS);
    // An empty file of an app of two models keeps the Model column, and an app without pages has no model to name.
    expect(viewOf(app(pages(demand("One"), supply("Two")), whereUsed())).headers).toEqual(BY_OBJECT_HEADERS);
    expect(viewOf(app(pages(), USES)).objects.map(object => object.model)).toEqual(Array.from({ length: 6 }, () => NONE));
  });

  it("gives nothing when the file, the Pages file or a column it reads is missing or goes by another name", () => {
    const without = (table: ResultTable, header: string): ResultTable => {
      const gone = table.headers.indexOf(header);
      return { ...table, headers: table.headers.filter((_, index) => index !== gone), rows: table.rows.map(row => row.filter((_, index) => index !== gone)) };
    };
    const renamed = (table: ResultTable, header: string): ResultTable => ({ ...table, headers: table.headers.map(name => (name === header ? `${name} ` : name)) });
    const whole = viewOf(app(PAGES, USES));
    expect(whole.rows).toHaveLength(6);
    for (const header of HEADERS["Where used"]) {
      expect(whereUsedView(app(PAGES, without(USES, header))), header).toBeUndefined();
      expect(whereUsedView(app(PAGES, renamed(USES, header))), header).toBeUndefined();
    }
    for (const header of ["Page", "Model", "Model ID"]) {
      expect(whereUsedView(app(without(PAGES, header), USES)), header).toBeUndefined();
      expect(whereUsedView(app(renamed(PAGES, header), USES)), header).toBeUndefined();
    }
    expect(whereUsedView(app(PAGES))).toBeUndefined();
    expect(whereUsedView(app(USES))).toBeUndefined();
    expect(whereUsedView(app(PAGES, { ...USES, file: "Where used.csv" }))).toBeUndefined();
    expect(whereUsedView(app({ ...PAGES, file: "Page list.csv" }, USES))).toBeUndefined();
    expect(whereUsedView(app())).toBeUndefined();
    // A model's export has no such view, whatever its files are called.
    expect(whereUsedView({ ...app(PAGES, USES), kind: "model" })).toBeUndefined();
    // The columns are found by their names, not by their places, and the ones the view does not read may be missing.
    const mirrored = (table: ResultTable): ResultTable => ({ ...table, headers: [...table.headers].reverse(), rows: table.rows.map(row => [...row].reverse()) });
    expect(viewOf(app(mirrored(USES), mirrored(PAGES))).objects).toEqual(whole.objects);
    const bare = viewOf(app(without(without(PAGES, "Workspace"), "Page ID"), USES));
    expect(bare.rows).toEqual(whole.rows);
    // Only the linked page's own model needs the page's ID.
    expect([whole.objects.map(object => object.model), bare.objects.map(object => object.model)]).toEqual(
      [Array.from({ length: 6 }, () => "Demand planning"), [...Array.from({ length: 5 }, () => "Demand planning"), "—"]]);
  });

  it("never throws, whatever it is given", () => {
    const hostile = { get kind(): string { throw new Error("no"); } };
    const unreadable = { toString(): string { throw new Error("no"); } };
    const odd: unknown[] = [undefined, null, 5, "text", [], {}, hostile, { kind: "app" }, { kind: "app", tables: null }, { kind: "app", tables: [null] },
      { kind: "app", tables: [{ file: "Where Used.csv" }, PAGES] }, { kind: "app", tables: [{ ...USES, headers: "Object type" }, PAGES] },
      { kind: "app", tables: [{ ...USES, rows: [null] }, PAGES] }, { kind: "app", tables: [{ ...USES, rows: [[unreadable]] }, PAGES] },
      { kind: "app", tables: [USES, { ...PAGES, rows: 5 }] }];
    for (const value of odd) {
      expect(() => whereUsedView(value as AnalysisResult)).not.toThrow();
      expect(whereUsedView(value as AnalysisResult)).toBeUndefined();
    }
    // A cell that is no text and no number is read as the page reads it, and the view holds plain values only: a row
    // without cells is an object without a type, a name or an ID, after the types the index knows.
    const cells = { ...USES, rows: [["Module", null, undefined, "Overview", null, "Data source", SALES], [], ["Module", "REV01 Sales", NONE, "Overview", true, "Data source", SALES]] };
    const view = whereUsedView(app(PAGES, cells as unknown as ResultTable));
    expect(view?.rows).toEqual([["Module", "REV01 Sales", "", 1, 2, "Data source", SALES], ["", "", "", 1, 1, "", ""]]);
    expect(view?.objects.map(object => object.uses.map(used => [used.row, used.card]))).toEqual([[[0, ""], [2, "true"]], [[1, ""]]]);
  });

  it("reads the result and changes nothing in it: the CSV stays as it is", () => {
    const result = app(PAGES, USES, cards(["Overview", 1, "card-a"]));
    const before = structuredClone(result);
    const csv = tableCsv(result.tables[1]);
    const first = viewOf(result);
    expect(result).toEqual(before);
    expect(tableCsv(result.tables[1])).toBe(csv);
    // The same result gives the same view again, and the view shares nothing with the file: changing it changes no row.
    expect(viewOf(result)).toEqual(first);
    first.rows[0][1] = "changed";
    first.objects[0].uses.length = 0;
    first.headers.length = 0;
    expect(result).toEqual(before);
    expect(viewOf(result).rows[0][1]).toBe("REV01 Sales");
    expect(BY_OBJECT_HEADERS).toHaveLength(8);
  });

  it("turns 5,000 uses of 600 objects into 600 rows at once", () => {
    // Three hundred IDs, each in both models with the same type and name: only the model of the page tells the two apart.
    const types = ["Module", "Line item", "Dimension", "Saved view", "Process", "Import"];
    const roles = ["Data source", "Rows", "Columns", "Filter", "Formatting"];
    const models = [["Demand planning", DEMAND], ["Supply planning", SUPPLY]];
    const expected = new Map<string, number[]>();
    const rows = Array.from({ length: 5_000 }, (_, index) => {
      const object = index % 600;
      const [model] = models[object % 2];
      const [type, id] = [types[Math.floor(object / 2) % types.length], String(100000000000 + Math.floor(object / 2))];
      const key = `${type}|${model}|${id}`;
      expected.set(key, [...(expected.get(key) ?? []), index]);
      return use(type, `${type} ${Math.floor(object / 2)}`, NONE, `${model} page ${index * 7 % 20 + 1}`, index % 13 + 1, roles[(index + Math.floor(index / 600)) % roles.length], id);
    });
    const result = app(pages(...models.flatMap(([model, id]) => Array.from({ length: 20 }, (_, index) => page(`${model} page ${index + 1}`, model, id)))), whereUsed(...rows));
    const started = performance.now();
    const view = whereUsedView(result);
    const took = performance.now() - started;
    expect(took, `${took.toFixed(1)} ms`).toBeLessThan(1_000);
    expect(view?.rows).toHaveLength(600);
    expect(expected.size).toBe(600);
    const checked = viewOf(result);
    expect(checked.note).toBe("5000 uses of 600 objects. The CSV lists every use.");
    // Each object has exactly the uses that were made for it, by another count than the view's own.
    expect(new Map(checked.objects.map(object => [`${object.type}|${object.model}|${object.id}`, object.uses.map(used => used.row)]))).toEqual(expected);
  });
});

describe("The Where used table by object, where pages share a name", () => {
  // The file has only the name of a use's page. Two pages called Overview, with a page of another name between them.
  const ONE_NAME = '1 page name is shared by more than one page: "Overview" (2 pages).';
  const SHARED = "The CSV has only the name of a use's page, so the uses on those pages cannot be told apart.";
  const NOT_KNOWN = "The CSV has only the name of a use's page, so which of those pages a use is on is not known.";
  const ON_OVERVIEW = 'on a page name that more than one page has: "Overview" (2 pages).';
  /** What a view says of each object's pages and cards: the least, and the most where that is more. */
  const spread = (view: WhereUsedView) => Object.fromEntries(view.objects.map(object => [object.name, [object.pages, object.pagesMost, object.cards, object.cardsMost]]));
  /** The report's app of three pages: an Overview with a grid of Sales and one of Prices, Stores with a grid of Sales, and a
   * last page with the given cards, under the given name. */
  const threePages = (lastName: string, last: unknown[]): AnalysisResult => reportedApp(
    input("Overview", guid(1), "Demand planning", DEMAND, [grid("card-1", SALES_MODULE), grid("card-2", PRICES_MODULE)]),
    input("Stores", guid(2), "Demand planning", DEMAND, [grid("card-3", SALES_MODULE)]),
    input(lastName, guid(3), "Demand planning", DEMAND, last));

  it("counts the same use on two pages of one name as two pages and two cards, on the report's own rows", () => {
    // The second Overview has one grid of Sales, as the first has on its card 1: the file has those three rows twice.
    const view = viewOf(threePages("Overview", [grid("card-4", SALES_MODULE)]));
    // Counted by page name alone this read 2 pages and 2 cards for Sales, and 2 and 3 for the two dimensions.
    expect(view.rows).toEqual([
      ["Module", "REV01 Sales", "—", 3, 3, "Data source (custom view)", SALES],
      ["Module", "REV02 Prices", "—", 1, 1, "Data source (custom view)", "102000000002"],
      ["Dimension", "Products", "—", 3, 4, "Rows", "101000000001"],
      ["Dimension", "Time", "—", 3, 4, "Columns", "20000000003"],
    ]);
    // Which is what the app has: the same app with its last page under a name of its own counts the same.
    const told = viewOf(threePages("Overview, the other one", [grid("card-4", SALES_MODULE)]));
    expect(told.rows).toEqual(view.rows);
    expect(["sharedPageNames" in told, told.note]).toEqual([false, "12 uses of 4 objects. The CSV lists every use."]);
    // Every count is exact here, so none is marked. The view still says that a name is shared, each object with uses
    // on it says so, and so does each of those uses: its page is one of two.
    expect(view.sharedPageNames).toEqual([["Overview", 2]]);
    expect(view.note).toBe(`12 uses of 4 objects. The CSV lists every use. ${ONE_NAME} ${SHARED}`);
    expect(view.objects.map(object => object.note)).toEqual([`It has 2 uses ${ON_OVERVIEW} ${NOT_KNOWN}`, `It has 1 use ${ON_OVERVIEW} ${NOT_KNOWN}`,
      `It has 3 uses ${ON_OVERVIEW} ${NOT_KNOWN}`, `It has 3 uses ${ON_OVERVIEW} ${NOT_KNOWN}`]);
    // Two cards are card 1 of an Overview, with two IDs: which of them a use is on, the file does not say, so neither
    // use names its card. The card on Stores is the only card 1 there.
    expect(view.objects[0].uses).toEqual([{ row: 0, page: "Overview", card: 1, usedAs: "Data source (custom view)", pagesOfName: 2 },
      { row: 6, page: "Stores", card: 1, usedAs: "Data source (custom view)", cardId: "card-3" },
      { row: 9, page: "Overview", card: 1, usedAs: "Data source (custom view)", pagesOfName: 2 }]);
    // Card 2 is a card of one Overview only, so its use names it.
    expect(view.objects[1].uses).toEqual([{ row: 3, page: "Overview", card: 2, usedAs: "Data source (custom view)", cardId: "card-2", pagesOfName: 2 }]);
    expect(view.objects.map(usedOn)).toEqual(["3 pages, 3 cards", "1 page, 1 card", "3 pages, 4 cards", "3 pages, 4 cards"]);
  });

  it("gives the least a count can be, marked in its cell, where the file leaves it open, on the report's own rows", () => {
    // The second Overview has the same two grids the other way round: Prices on its card 1 and Sales on its card 2.
    const last = [grid("card-4", PRICES_MODULE), grid("card-5", SALES_MODULE)];
    const view = viewOf(threePages("Overview", last));
    // Sales is used by card 1 and by card 2 of an Overview: two cards for certain, on one of those pages or on both. Each
    // dimension is used twice in the same way by a card 1 and by a card 2: on both pages, by two cards of each number.
    expect(view.rows).toEqual([
      ["Module", "REV01 Sales", "—", "2+", 3, "Data source (custom view)", SALES],
      ["Module", "REV02 Prices", "—", "1+", 2, "Data source (custom view)", "102000000002"],
      ["Dimension", "Products", "—", 3, 5, "Rows", "101000000001"],
      ["Dimension", "Time", "—", 3, 5, "Columns", "20000000003"],
    ]);
    expect(spread(view)).toEqual({ "REV01 Sales": [2, 3, 3, undefined], "REV02 Prices": [1, 2, 2, undefined], Products: [3, undefined, 5, undefined], Time: [3, undefined, 5, undefined] });
    expect(view.note).toBe(`15 uses of 4 objects. The CSV lists every use. ${ONE_NAME} ${SHARED} A count with "+" is at least that number.`);
    expect(view.objects.map(object => object.note)).toEqual([`It has 2 uses ${ON_OVERVIEW} ${NOT_KNOWN} It is on 2 or 3 pages.`, `It has 2 uses ${ON_OVERVIEW} ${NOT_KNOWN} It is on 1 or 2 pages.`,
      `It has 4 uses ${ON_OVERVIEW} ${NOT_KNOWN}`, `It has 4 uses ${ON_OVERVIEW} ${NOT_KNOWN}`]);
    expect(view.objects.map(usedOn)).toEqual(["at least 2 pages, 3 cards", "at least 1 page, 2 cards", "3 pages, 5 cards", "3 pages, 5 cards"]);
    // No count says less than the app has, or more: the same app with its last page under a name of its own.
    const told = viewOf(threePages("Overview, the other one", last));
    expect(spread(told)).toEqual({ "REV01 Sales": [3, undefined, 3, undefined], "REV02 Prices": [2, undefined, 2, undefined], Products: [3, undefined, 5, undefined], Time: [3, undefined, 5, undefined] });
  });

  // Hand-made: two pages called Overview and one called Stores, and uses of four objects.
  const PAGES_ALIKE = pages(demand("Overview", { "Page ID": guid(1) }), demand("Overview", { "Page ID": guid(2) }), demand("Stores", { "Page ID": guid(3) }));
  const USES_ALIKE = whereUsed(
    // The same row twice: card 1 of each Overview shows the module.
    use("Module", "REV01 Sales", NONE, "Overview", 1, "Data source", SALES),
    use("Module", "REV01 Sales", NONE, "Overview", 1, "Data source", SALES),
    // A card 1 filters by the line item and a card 1 formats by it: one card, or card 1 of each page.
    use("Line item", "Margin %", "REV01 Sales", "Overview", 1, "Filter", MARGIN),
    use("Line item", "Margin %", "REV01 Sales", "Overview", 1, "Formatting", MARGIN),
    use("Line item", "Margin %", "REV01 Sales", "Overview", 2, "KPI value", MARGIN),
    use("Line item", "Margin %", "REV01 Sales", "Stores", 3, "Filter", MARGIN),
    // Three cards of three numbers: three cards, on one page or on both.
    use("Dimension", "Time", NONE, "Overview", 1, "Columns", "20000000003"),
    use("Dimension", "Time", NONE, "Overview", 2, "Columns", "20000000003"),
    use("Dimension", "Time", NONE, "Overview", 3, "Columns", "20000000003"),
    use("Dimension", "Products", NONE, "Stores", 1, "Rows", "101000000001"));

  it("states no count as exact that is not: two uses that look alike are two pages, and an open count is at least its number", () => {
    const view = viewOf(app(PAGES_ALIKE, USES_ALIKE));
    expect(view.rows).toEqual([
      ["Module", "REV01 Sales", "—", 2, 2, "Data source", SALES],
      ["Line item", "Margin %", "REV01 Sales", "2+", "3+", "Filter; Formatting; KPI value", MARGIN],
      ["Dimension", "Products", "—", 1, 1, "Rows", "101000000001"],
      ["Dimension", "Time", "—", "1+", 3, "Columns", "20000000003"],
    ]);
    expect(spread(view)).toEqual({ "REV01 Sales": [2, undefined, 2, undefined], "Margin %": [2, 3, 3, 4], Products: [1, undefined, 1, undefined], Time: [1, 2, 3, undefined] });
    expect(view.note).toBe(`10 uses of 4 objects. The CSV lists every use. ${ONE_NAME} ${SHARED} A count with "+" is at least that number.`);
    // What the drawer is given: the line under the object's name, the note that says what is open, and for each use on
    // the shared name how many pages have it. The module's two uses look alike, and each says its page is one of two.
    expect(view.objects.map(object => [usedOn(object), object.note])).toEqual([
      ["2 pages, 2 cards", `It has 2 uses ${ON_OVERVIEW} ${NOT_KNOWN}`],
      ["at least 2 pages, at least 3 cards", `It has 3 uses ${ON_OVERVIEW} ${NOT_KNOWN} It is on 2 or 3 pages and on 3 or 4 cards.`],
      ["1 page, 1 card", undefined],
      ["at least 1 page, 3 cards", `It has 3 uses ${ON_OVERVIEW} ${NOT_KNOWN} It is on 1 or 2 pages.`]]);
    expect(view.objects[0].uses).toEqual([{ row: 0, page: "Overview", card: 1, usedAs: "Data source", pagesOfName: 2 }, { row: 1, page: "Overview", card: 1, usedAs: "Data source", pagesOfName: 2 }]);
    expect(view.objects[1].uses.map(used => used.pagesOfName)).toEqual([2, 2, 2, undefined]);
    // The page's own sort puts a marked count by its number, straight after the same number unmarked, in both directions.
    const [pagesAt, cardsAt] = [view.headers.indexOf("Pages"), view.headers.indexOf("Cards")];
    expect(sortRows(view.rows, { column: pagesAt, dir: "asc" }).map(row => [row[1], row[pagesAt]])).toEqual([["Products", 1], ["Time", "1+"], ["REV01 Sales", 2], ["Margin %", "2+"]]);
    expect(sortRows(view.rows, { column: pagesAt, dir: "desc" }).map(row => row[pagesAt])).toEqual(["2+", 2, "1+", 1]);
    expect(sortRows(view.rows, { column: cardsAt, dir: "asc" }).map(row => row[cardsAt])).toEqual([1, 2, 3, "3+"]);
    expect(sortRows([[9], ["10+"], [100], ["9+"], [10], ["41+"], [42], [41]], { column: 0, dir: "asc" }).flat()).toEqual([9, "9+", 10, "10+", 41, "41+", 42, 100]);
    expect(view.columns.filter(shown => shown.num).map(shown => shown.label)).toEqual(["Pages", "Cards"]);
  });

  it("takes from the Pages file which pages have a name: a page is its ID, and a page without cards uses nothing", () => {
    const shared = (...rows: Fields[]) => viewOf(app(pages(...rows, demand("Stores")), USES_ALIKE)).sharedPageNames;
    const today = viewOf(app(pages(demand("Overview"), demand("Stores")), USES_ALIKE));
    // One page called Overview: every count is the number of names and numbers, and nothing is said of shared names.
    expect(today.rows.map(row => row.slice(3, 5))).toEqual([[1, 1], [2, 3], [1, 1], [1, 3]]);
    expect([shared(demand("Overview")), today.note]).toEqual([undefined, "10 uses of 4 objects. The CSV lists every use."]);
    // The same page listed twice is one page, and so is a page beside a page of its name that has no cards: not
    // published, or not analysed. Either way the view is the one above.
    for (const rows of [[demand("Overview", { "Page ID": guid(1) }), demand("Overview", { "Page ID": guid(1) })],
      [demand("Overview", { "Page ID": guid(1), "Total cards": 3 }), demand("Overview", { "Page ID": guid(2), "Total cards": 0 })],
      [demand("Overview", { "Total cards": "0" }), demand("Overview", { "Total cards": 3 }), demand("Overview", { "Total cards": 0 })]]) {
      expect(viewOf(app(pages(...rows, demand("Stores")), USES_ALIKE))).toEqual(today);
    }
    // Two IDs are two pages, and so are two rows where the file gives no ID, or has no such column at all.
    expect(shared(demand("Overview", { "Page ID": guid(1) }), demand("Overview", { "Page ID": guid(2) }))).toEqual([["Overview", 2]]);
    expect(shared(demand("Overview"), demand("Overview", { "Page ID": "" }))).toEqual([["Overview", 2]]);
    const noIds = pages(demand("Overview"), demand("Overview"), demand("Stores"));
    const without = { ...noIds, headers: noIds.headers.filter(header => header !== "Page ID"), rows: noIds.rows.map(row => row.filter((_, index) => noIds.headers[index] !== "Page ID")) };
    expect(viewOf(app(without, USES_ALIKE)).rows).toEqual(viewOf(app(PAGES_ALIKE, USES_ALIKE)).rows);
    // A page whose number of cards is not given may have cards: an empty cell does not say "no cards", nor does a cell of
    // spaces, a dash or any text that is not the number 0, nor a row that ends before the cell.
    expect(shared(demand("Overview", { "Total cards": 3 }), demand("Overview"))).toEqual([["Overview", 2]]);
    for (const notSaid of ["", "   ", NONE, "none", "0 cards", "00", 0.5]) {
      expect(shared(demand("Overview", { "Total cards": 3 }), demand("Overview", { "Total cards": notSaid })), JSON.stringify(notSaid)).toEqual([["Overview", 2]]);
    }
    const short: ResultTable = { file: "Pages.csv", label: "Pages", headers: ["Page", "Model", "Model ID", "Total cards"], guard: true,
      rows: [["Overview", "Demand planning", DEMAND, 3], ["Overview", "Demand planning", DEMAND], ["Stores", "Demand planning", DEMAND, 1]] };
    expect(viewOf(app(short, USES_ALIKE)).sharedPageNames).toEqual([["Overview", 2]]);
    // Only the number 0 says it, as a number or as text: then the other Overview is the one page a use can be on.
    for (const none of [0, "0", " 0 "]) expect(shared(demand("Overview", { "Total cards": 3 }), demand("Overview", { "Total cards": none })), JSON.stringify(none)).toBeUndefined();
    // And where no page of the name is said to have any cards, that says nothing of the uses on it: every page of the
    // name counts.
    expect(shared(demand("Overview", { "Total cards": 0 }), demand("Overview", { "Total cards": 0 }))).toEqual([["Overview", 2]]);
    // Three pages of the name: on no more of them than there are uses, and on no more than three.
    const three = viewOf(app(pages(demand("Overview"), demand("Overview"), demand("Overview"), demand("Stores")), USES_ALIKE));
    expect(spread(three)).toEqual({ "REV01 Sales": [2, undefined, 2, undefined], "Margin %": [2, 4, 3, 4], Products: [1, undefined, 1, undefined], Time: [1, 3, 3, undefined] });
    expect([three.sharedPageNames, three.objects[3].note]).toEqual([[["Overview", 3]],
      `It has 3 uses on a page name that more than one page has: "Overview" (3 pages). ${NOT_KNOWN} It is on 1 to 3 pages.`]);
  });

  it("says how many pages have a name as the Pages file lists them, a page without cards among them", () => {
    // Two published pages called Sales board and one that is not published, as the report lists them: the third has no
    // cards, so no use is on it.
    const boards = [input("Sales board", guid(1), "Demand planning", DEMAND, [grid("card-1", SALES_MODULE), grid("card-2", PRICES_MODULE)]),
      input("Sales board", guid(2), "Demand planning", DEMAND, [grid("card-3", PRICES_MODULE), grid("card-4", SALES_MODULE)])];
    const unpublished: PageInput = { ...input("Sales board", guid(3), "Demand planning", DEMAND, []), state: "Not published", details: undefined };
    const result = reportedApp(...boards, unpublished);
    const listed = result.tables.find(table => table.file === "Pages.csv")?.rows.filter(row => row[HEADERS.Pages.indexOf("Page")] === "Sales board") ?? [];
    expect(listed.map(row => [row[HEADERS.Pages.indexOf("Publish state")], row[HEADERS.Pages.indexOf("Total cards")]]))
      .toEqual([["Published (no unpublished changes)", 2], ["Published (no unpublished changes)", 2], ["Not published", 0]]);
    const view = viewOf(result);
    // The Pages file lists three pages of the name, and three is the number said of it wherever one is said: in the view,
    // on every use on the name, which is what the drawer puts into "3 pages have this name", and in both notes.
    expect(view.sharedPageNames).toEqual([["Sales board", listed.length]]);
    expect(view.objects.flatMap(object => object.uses.map(used => used.pagesOfName))).toEqual(Array.from({ length: 12 }, () => listed.length));
    expect(view.note).toBe('12 uses of 4 objects. The CSV lists every use. 1 page name is shared by more than one page: "Sales board" (3 pages, 1 of them without cards). '
      + `${SHARED} A count with "+" is at least that number.`);
    expect(view.objects[0].note).toBe(`It has 2 uses on a page name that more than one page has: "Sales board" (3 pages, 1 of them without cards). ${NOT_KNOWN} It is on 1 or 2 pages.`);
    // The counts go by the two pages that have cards, as they do without the third page: a module on card 1 of one page
    // and card 2 of the other is on one or two pages, never on three.
    expect(view.rows).toEqual([
      ["Module", "REV01 Sales", "—", "1+", 2, "Data source (custom view)", SALES],
      ["Module", "REV02 Prices", "—", "1+", 2, "Data source (custom view)", "102000000002"],
      ["Dimension", "Products", "—", 2, 4, "Rows", "101000000001"],
      ["Dimension", "Time", "—", 2, 4, "Columns", "20000000003"],
    ]);
    const two = viewOf(reportedApp(...boards));
    expect([view.rows, spread(view)]).toEqual([two.rows, spread(two)]);
    expect([two.sharedPageNames, two.objects[0].note]).toEqual([[["Sales board", 2]],
      `It has 2 uses on a page name that more than one page has: "Sales board" (2 pages). ${NOT_KNOWN} It is on 1 or 2 pages.`]);

    // Hand-made: the number said is the Pages file's, whatever its pages are like. Four pages, two of them without cards.
    const said = (...rows: Fields[]) => {
      const made = viewOf(app(pages(...rows, demand("Stores")), USES_ALIKE));
      return [made.sharedPageNames, [...new Set(made.objects.flatMap(object => object.uses.map(used => used.pagesOfName)))], made.note.split(": ")[1].split(". ")[0], spread(made)["Margin %"]];
    };
    expect(said(demand("Overview", { "Total cards": 3 }), demand("Overview", { "Total cards": 0 }), demand("Overview", { "Total cards": 2 }), demand("Overview", { "Total cards": 0 })))
      .toEqual([[["Overview", 4]], [4, undefined], '"Overview" (4 pages, 2 of them without cards)', [2, 3, 3, 4]]);
    // A page is its ID: one page listed twice, a second page and a third without cards are three pages, two with cards.
    expect(said(demand("Overview", { "Page ID": guid(1) }), demand("Overview", { "Page ID": guid(1) }), demand("Overview", { "Page ID": guid(2) }),
      demand("Overview", { "Page ID": guid(3), "Total cards": 0 }))).toEqual([[["Overview", 3]], [3, undefined], '"Overview" (3 pages, 1 of them without cards)', [2, 3, 3, 4]]);
    // Every page of the name with cards: nothing is said of cards. And where none of them is said to have cards, the
    // numbers of cards say nothing, and nothing is said of them either.
    expect(said(demand("Overview"), demand("Overview"), demand("Overview"))).toEqual([[["Overview", 3]], [3, undefined], '"Overview" (3 pages)', [2, 4, 3, 4]]);
    expect(said(demand("Overview", { "Total cards": 0 }), demand("Overview", { "Total cards": 0 }))).toEqual([[["Overview", 2]], [2, undefined], '"Overview" (2 pages)', [2, 3, 3, 4]]);
  });

  it("names a use's card only where one card answers to its page name and number: not where a page and its copy share a name", () => {
    // A page copied in Anaplan may keep its cards' IDs. Under the same name, card 1 of the page and card 1 of the copy are
    // two rows of the Cards file with one ID: the page opens a card by its page's name and its ID, so it would open the
    // first of the two, whichever the use is on. Card 2 is a card of the first page only.
    const copied = cards(["Overview", 1, "card-a"], ["Overview", 2, "card-b"], ["Overview", 1, "card-a"], ["Stores", 3, "card-d"]);
    const view = viewOf(app(PAGES_ALIKE, copied, USES_ALIKE));
    expect(Object.fromEntries(view.objects.map(object => [object.name, object.uses.map(used => [used.page, used.card, used.cardId])]))).toEqual({
      "REV01 Sales": [["Overview", 1, undefined], ["Overview", 1, undefined]],
      "Margin %": [["Overview", 1, undefined], ["Overview", 1, undefined], ["Overview", 2, "card-b"], ["Stores", 3, "card-d"]],
      // The file has no card 3 of an Overview, and no card 1 of Stores.
      Time: [["Overview", 1, undefined], ["Overview", 2, "card-b"], ["Overview", 3, undefined]],
      Products: [["Stores", 1, undefined]],
    });
    expect(view.objects[0].uses.every(used => !("cardId" in used))).toBe(true);
    // The same on the report's own rows: the last page is a copy of the first, with its cards' IDs and its name.
    const report = viewOf(threePages("Overview", [grid("card-1", SALES_MODULE), grid("card-2", PRICES_MODULE)]));
    expect(report.objects.flatMap(object => object.uses.map(used => `${used.page} ${String(used.card)}: ${used.cardId ?? "no card"}`)).sort()).toEqual([
      ...Array.from({ length: 6 }, () => "Overview 1: no card"), ...Array.from({ length: 6 }, () => "Overview 2: no card"), ...Array.from({ length: 3 }, () => "Stores 1: card-3")]);
    // One card of its number is not enough where its ID is another card's too. A copy listed first, with the original's
    // first card removed, keeps its cards' IDs under other numbers: card 3 is one card, but the page would open the
    // first card of that name with its ID, which is card 2 of the copy. So card 3 is not named, and neither is any other.
    const shifted = cards(["Overview", 1, "card-y"], ["Overview", 2, "card-z"], ["Overview", 1, "card-x"], ["Overview", 2, "card-y"], ["Overview", 3, "card-z"], ["Stores", 3, "card-d"]);
    const moved = viewOf(app(PAGES_ALIKE, shifted, USES_ALIKE));
    expect(moved.objects.flatMap(object => object.uses.map(used => `${used.page} ${String(used.card)}: ${used.cardId ?? "no card"}`)).filter(said => !said.endsWith("no card"))).toEqual(["Stores 3: card-d"]);
    // Where the ID is one card's alone, the one card of its number is named: card 3 with an ID of its own.
    const own = viewOf(app(PAGES_ALIKE, cards(["Overview", 1, "card-y"], ["Overview", 2, "card-z"], ["Overview", 1, "card-x"], ["Overview", 2, "card-y"], ["Overview", 3, "card-w"]), USES_ALIKE));
    expect(own.objects.flatMap(object => object.uses.map(used => `${used.page} ${String(used.card)}: ${used.cardId ?? "no card"}`)).filter(said => !said.endsWith("no card"))).toEqual(["Overview 3: card-w"]);
    // Under a name of its own, each card of the copy is the one card of its page and number, and is named.
    const renamed = viewOf(threePages("Overview (copy)", [grid("card-1", SALES_MODULE), grid("card-2", PRICES_MODULE)]));
    expect(new Set(renamed.objects.flatMap(object => object.uses.map(used => `${used.page} ${String(used.card)}: ${used.cardId ?? "no card"}`)))).toEqual(new Set([
      "Overview 1: card-1", "Overview 2: card-2", "Stores 1: card-3", "Overview (copy) 1: card-1", "Overview (copy) 2: card-2"]));
  });

  it("takes a row that comes more often than pages have the name for no more than one page and one card", () => {
    // The file has one row for an object, a card and a role, so the same row twice is two pages. Three times on a name
    // that two pages have is a file that does not keep to that: its repeats say nothing, here or on another card.
    const rows = (times: number) => [...Array.from({ length: times }, () => use("Module", "REV01 Sales", NONE, "Overview", 1, "Data source", SALES)),
      use("Module", "REV01 Sales", NONE, "Overview", 2, "Data source", SALES), use("Module", "REV01 Sales", NONE, "Overview", 2, "Data source", SALES)];
    expect(spread(viewOf(app(PAGES_ALIKE, whereUsed(...rows(2)))))).toEqual({ "REV01 Sales": [2, undefined, 4, undefined] });
    const view = viewOf(app(PAGES_ALIKE, whereUsed(...rows(3))));
    expect(spread(view)).toEqual({ "REV01 Sales": [1, 2, 2, 4] });
    expect(view.rows).toEqual([["Module", "REV01 Sales", "—", "1+", "2+", "Data source", SALES]]);
    expect(view.objects[0].note).toBe(`It has 5 uses ${ON_OVERVIEW} ${NOT_KNOWN} It is on 1 or 2 pages and on 2 to 4 cards.`);
    // On a name that one page has, a row twice is one page and one card, as it always was.
    expect(spread(viewOf(app(PAGES, whereUsed(...rows(2)))))).toEqual({ "REV01 Sales": [1, undefined, 2, undefined] });
    // Two rows that differ in anything are not the same row. One card may run a process from two buttons, each under its
    // own label, and may use a line item in two ways: one page and one card, or two.
    const labels = viewOf(app(PAGES_ALIKE, whereUsed(use("Process", "Run", NONE, "Overview", 1, "Action button", "118000000002"),
      use("Process", "Run now", NONE, "Overview", 1, "Action button", "118000000002"),
      use("Line item", "Margin %", "REV01 Sales", "Overview", 1, "Filter", MARGIN), use("Line item", "Margin %", "REV01 Sales", "Overview", 1, "Formatting", MARGIN),
      use("Line item", "Target", "REV01 Sales", "Overview", 1, "Filter", "286000000005"), use("Line item", "Target", "REV02 Prices", "Overview", 1, "Filter", "286000000005"))));
    expect(spread(labels)).toEqual({ "Margin %": [1, 2, 1, 2], Target: [1, 2, 1, 2], Run: [1, 2, 1, 2] });
  });

  it("names the shared page names in the note, three of them and then how many more", () => {
    const names = ["Overview", "Summary", "Plan", "Review", "Notes"];
    const noted = (count: number) => viewOf(app(pages(...names.slice(0, count).flatMap(name => [demand(name), demand(name)]), demand("Stores"), demand("Draft"), demand("Draft")),
      whereUsed(...names.slice(0, count).map(name => use("Dimension", "Time", NONE, name, 1, "Columns", "20000000003")), use("Dimension", "Time", NONE, "Stores", 1, "Columns", "20000000003")))).note;
    // A name that pages share, but that no use is on, is not one of them: Draft.
    expect(noted(0)).toBe("1 use of 1 object. The CSV lists every use.");
    expect(noted(1)).toBe(`2 uses of 1 object. The CSV lists every use. ${ONE_NAME} ${SHARED}`);
    expect(noted(3)).toBe(`4 uses of 1 object. The CSV lists every use. 3 page names are each shared by more than one page: "Overview" (2 pages), "Summary" (2 pages), "Plan" (2 pages). ${SHARED}`);
    expect(noted(5)).toBe(`6 uses of 1 object. The CSV lists every use. 5 page names are each shared by more than one page: "Overview" (2 pages), "Summary" (2 pages), "Plan" (2 pages) and 2 more. ${SHARED}`);
    // The object has one use on each: one page and one card of each name, whichever page that is. Its own note lists them the same way.
    const view = viewOf(app(pages(...names.flatMap(name => [demand(name), demand(name)])), whereUsed(...names.map(name => use("Dimension", "Time", NONE, name, 1, "Columns", "20000000003")))));
    expect([view.rows, view.objects[0].note]).toEqual([[["Dimension", "Time", "—", 5, 5, "Columns", "20000000003"]],
      `It has 5 uses on page names that more than one page has: "Overview" (2 pages), "Summary" (2 pages), "Plan" (2 pages) and 2 more. ${NOT_KNOWN}`]);
  });

  it("never says less than an app has, or more, in 400 made-up apps whose pages share names", () => {
    // Numbers that are the same on every run.
    let seed = 20261004;
    const pick = (below: number): number => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return Math.floor(seed / 4294967296 * below);
    };
    const things: [type: string, name: string, module: string, id: string][] = [["Module", "REV01 Sales", NONE, SALES], ["Line item", "Margin %", "REV01 Sales", MARGIN],
      ["Dimension", "Time", NONE, "20000000003"]];
    const roles = ["Rows", "Filter"];
    const seen = { exact: 0, open: 0, exactOnShared: 0 };
    for (let made = 0; made < 400; made++) {
      // Two to six pages with names from a pool of three, each with up to three cards, and on a page one row for an
      // object, a card and a role, as the report writes them.
      const listed = Array.from({ length: 2 + pick(5) }, (_, index) => ({ name: `Page ${1 + pick(3)}`, cards: pick(4), id: guid(100 + index) }));
      const truth = new Map(things.map(([, , , id]) => [id, { pages: new Set<number>(), cards: new Set<string>() }]));
      const rows: Fields[] = [];
      listed.forEach((entry, at) => {
        for (let card = 1; card <= entry.cards; card++) {
          for (const [type, name, module, id] of things) {
            for (const role of roles) {
              if (pick(100) >= 30) continue;
              rows.push(use(type, name, module, entry.name, card, role, id));
              truth.get(id)?.pages.add(at);
              truth.get(id)?.cards.add(`${at}:${card}`);
            }
          }
        }
      });
      // Every other app has its rows in another order than the report's, page after page: what the view says does not
      // lean on the order. And half of them do not say how many cards a page has: then a page without cards counts too.
      if (made % 2 === 1) {
        for (let at = rows.length - 1; at > 0; at--) {
          const other = pick(at + 1);
          [rows[at], rows[other]] = [rows[other], rows[at]];
        }
      }
      const listing = (entry: { name: string; cards: number; id: string }) => demand(entry.name, { "Page ID": entry.id, ...(made % 4 < 2 ? { "Total cards": entry.cards } : {}) });
      const view = viewOf(app(pages(...listed.map(listing)), whereUsed(...rows)));
      for (const object of view.objects) {
        const has = truth.get(object.id);
        const told = `app ${made}, ${object.name}: ${JSON.stringify(listed)}`;
        expect(has, told).toBeDefined();
        if (!has) continue;
        // The least is no more than the app has, the most no less, and a count without a most is the app's own.
        expect(object.pages, told).toBeLessThanOrEqual(has.pages.size);
        expect(object.pagesMost ?? object.pages, told).toBeGreaterThanOrEqual(has.pages.size);
        expect(object.cards, told).toBeLessThanOrEqual(has.cards.size);
        expect(object.cardsMost ?? object.cards, told).toBeGreaterThanOrEqual(has.cards.size);
        const open = object.pagesMost !== undefined || object.cardsMost !== undefined;
        seen[open ? "open" : "exact"]++;
        if (!open && object.note !== undefined) seen.exactOnShared++;
      }
    }
    // The apps were of every kind: counts the file leaves open, exact ones, and exact ones on a shared name.
    expect(Object.values(seen).every(count => count > 50), JSON.stringify(seen)).toBe(true);
  });

  it("says nothing of shared names, and changes no count, where no two pages share a name", () => {
    const view = viewOf(app(PAGES, USES));
    expect(Object.keys(view).sort()).toEqual(["ambiguousUses", "columns", "headers", "multiModel", "note", "objects", "rows", "totalUses", "unlistedUses"]);
    expect(view.objects.map(object => Object.keys(object).sort().join())).toEqual(Array.from({ length: 6 }, () => "cards,id,model,module,name,pages,roles,type,uses"));
    expect(new Set(view.objects.flatMap(object => object.uses.map(used => Object.keys(used).join())))).toEqual(new Set(["row,page,card,usedAs"]));
    expect(view.rows.every(row => typeof row[3] === "number" && typeof row[4] === "number")).toBe(true);
    expect([view.note, view.objects.map(usedOn)]).toEqual(["10 uses of 6 objects. The CSV lists every use.",
      ["2 pages, 2 cards", "2 pages, 3 cards", "1 page, 1 card", "1 page, 1 card", "1 page, 1 card", "1 page, 1 card"]]);
    // The line under an object's name reads as the page wrote it before, for any object.
    const object = (pagesOn: number, cardsOn: number, most: Partial<WhereUsedObject> = {}): WhereUsedObject =>
      ({ type: "Dimension", name: "Time", module: NONE, model: NONE, pages: pagesOn, cards: cardsOn, roles: [], id: "20000000003", uses: [], ...most });
    expect([usedOn(object(65, 130)), usedOn(object(1, 1)), usedOn(object(1, 2, { pagesMost: 2 })), usedOn(object(41, 84, { pagesMost: 42, cardsMost: 86 })), usedOn(object(3, 1, { cardsMost: 3 }))])
      .toEqual(["65 pages, 130 cards", "1 page, 1 card", "at least 1 page, 2 cards", "at least 41 pages, at least 84 cards", "3 pages, at least 1 card"]);
  });
});

