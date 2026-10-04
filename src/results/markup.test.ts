import { describe, expect, it } from "vitest";
import { DETAILS_HEADERS } from "../details.js";
import { HEADERS } from "../report.js";
import type { AnalysisResult, Cell, ResultTable } from "../result-types.js";
import { cardsOf, columnsOf, rowKeys, type Column } from "./columns.js";
import {
  cardDrawerHtml, cardDrawerSubHtml, cellHtml, colChooserHtml, colFilterHtml, crumbsHtml, esc, headerMetaHtml, idPill,
  MOON_ICON, navHtml, noteBannerHtml, objectDrawerHtml, objectDrawerSubHtml, overviewHtml, pagerHtml, rowCellHtml, rowDrawerHtml, rowDrawerSubHtml, runBannerHtml, runHtml, SUN_ICON, tableHtml, tableParts, type Links, type TableView,
} from "./markup.js";
import { parseMarkup } from "./dom.test-support.js";
import { decode, readMarkup, shownValues, structure } from "./markup.test-support.js";
import { analysedOf, cardSections, detailsOf, overviewOf, type Overview } from "./result-view.js";
import { pageOf, selectRows, valueCounts } from "./table-engine.js";
import { whereUsedView, type WhereUsedObject } from "./where-used-view.js";

/** What an Anaplan user can type into a card title, a text card, a name or a formula. */
const IMG = "<img src=x onerror=alert(1)>";
const QUOTED = "Bob's \"<b>Q4</b>\" plan";
const SCRIPT = "<script>alert(document.cookie)</script>";
const BREAK_OUT = "\" onmouseover=\"alert(1)\" data-act=\"";
const BREAK_OUT_SINGLE = "' onfocus='alert(1)' autofocus x='";
const ENTITY = "&lt;b&gt; &amp;amp; &quot;";
const CLOSERS = "</td></tr></table></div><iframe src=//evil.example></iframe><!-- ";
const HOSTILE = [IMG, QUOTED, SCRIPT, BREAK_OUT, BREAK_OUT_SINGLE, ENTITY, CLOSERS];

/** Texts for one build of a piece of markup: the hostile ones in turn, or a harmless word in their place. */
type Texts = (index: number) => string;
const hostile: Texts = index => HOSTILE[index % HOSTILE.length];
const harmless: Texts = index => `word ${index}`;

/** The attributes that may hold a value from a result: a tooltip, a label for screen readers, the search box and an ID to copy. */
const VALUE_ATTRIBUTES = new Set(["title", "aria-label", "value", "data-copy"]);

/** Builds a piece of markup twice, with hostile and with harmless texts in the same places, and checks that the data
 * changed nothing but text: the same elements with the same attributes, every hostile text shown exactly as typed, and
 * none of it in an attribute that is more than a text. `used` is how many different texts the markup takes. */
function expectInert(build: (text: Texts) => string, used: number): void {
  const html = build(hostile);
  expect(structure(html)).toEqual(structure(build(harmless)));
  const shown = shownValues(html);
  for (let index = 0; index < used; index++) expect(shown.filter(value => value.includes(hostile(index))), `text ${index} is shown as typed`).not.toEqual([]);
  for (const tag of readMarkup(html).tags) {
    for (const [name, value] of tag.attributes) {
      if (value !== undefined && HOSTILE.some(text => decode(value).includes(text))) expect(VALUE_ATTRIBUTES, `${tag.name} ${name}`).toContain(name);
    }
  }
}

const LINKS: Links = { page: true, card: true };
const NO_LINKS: Links = { page: false, card: false };
const column = (index: number, label: string, kind: Column["kind"] = "text", extra: Partial<Column> = {}): Column =>
  ({ index, label, kind, num: false, filter: false, hidden: false, ...extra });
const KINDS: Column["kind"][] = ["text", "id", "tag", "page", "card"];
/** An overview that holds nothing but what a test gives it. */
const overviewWith = (parts: Partial<Overview>): Overview => ({ tiles: [], cardTypes: [], models: [], notes: [], about: [], files: [], howToRead: [], log: [], ...parts });
const tagNames = (html: string) => [...new Set(readMarkup(html).tags.map(tag => tag.name))].sort();
const attributeNames = (html: string) => [...new Set(readMarkup(html).tags.flatMap(tag => [...tag.attributes.keys()]))].sort();

/** A table view as the page builds it for a table, with nothing chosen. */
function viewOf(table: ResultTable, links: Links, overrides: Partial<TableView> = {}): TableView {
  const page = pageOf(selectRows(table.rows, { search: "", filters: new Map() }), 0, 50);
  return { label: table.label, columns: columnsOf(table), rows: page.rows, page: page.page, pages: page.pages, pageSize: 50, from: page.from, to: page.to,
    total: page.total, all: table.rows.length, search: "", sort: undefined, filtered: new Set(), context: undefined, links, note: undefined, ...overrides };
}

describe("The results page's escaping", () => {
  it("escapes the five characters that can end a text or a quoted attribute, and nothing else", () => {
    expect(esc("<a href=\"x\" title='y'>&</a>")).toBe("&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;");
    expect(esc("&lt;")).toBe("&amp;lt;");
    expect([esc("plain text, 100% – ok"), esc(12), esc(0), esc(""), esc(undefined), esc(null)]).toEqual(["plain text, 100% – ok", "12", "0", "", "", ""]);
    for (const text of HOSTILE) {
      expect(esc(text)).not.toMatch(/[<>"']/);
      expect(decode(esc(text))).toBe(text);
    }
  });

  it("shows a card title that holds an img tag with an onerror attribute as its text, in the table and in the drawer", () => {
    const cards: ResultTable = { file: "Cards.csv", label: "Cards", headers: HEADERS.Cards, guard: true,
      rows: [HEADERS.Cards.map(header => (header === "Card title" ? IMG : header === "Card #" ? 1 : header === "Card ID" ? "card-a" : "Overview"))] };
    for (const html of [tableHtml(viewOf(cards, LINKS)), rowDrawerHtml(columnsOf(cards), cards.rows[0], LINKS), cardDrawerHtml(columnsOf(cards), cards.rows[0], LINKS, [])]) {
      expect(html).not.toContain("<img");
      expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
      expect(tagNames(html)).not.toContain("img");
      expect(attributeNames(html).filter(name => /^on/i.test(name))).toEqual([]);
      // The title is a link to the card's details, and its text is what was typed.
      const links = parseMarkup(html).querySelectorAll('.link[data-act="card"]').filter(link => link.textContent === IMG);
      expect(links.map(link => [link.localName, link.title, link.querySelectorAll("img").length])).toEqual([["button", "Open card details", 0]]);
    }
  });

  it("shows a name that holds quotes and angle brackets as its text: the app, a file, a page, a model", () => {
    const pieces = [
      headerMetaHtml({ name: QUOTED, kind: "App", host: QUOTED, exportedOn: QUOTED }),
      navHtml([{ id: "overview", label: "Overview" }, { id: "1", label: QUOTED, count: 2 }], "1"),
      crumbsHtml(QUOTED, QUOTED),
      overviewHtml({ tiles: [{ label: QUOTED, count: 1 }], cardTypes: [[QUOTED, 1]], models: [{ model: QUOTED, workspace: QUOTED, modelId: QUOTED }], notes: [QUOTED],
        about: [[QUOTED, QUOTED]], files: [[QUOTED, QUOTED]], howToRead: [[QUOTED, QUOTED]], log: [QUOTED] }),
      tableHtml(viewOf({ file: "Pages.csv", label: QUOTED, headers: ["Page", QUOTED], rows: [[QUOTED, QUOTED]], guard: true }, LINKS, { search: QUOTED, context: QUOTED })),
      rowDrawerSubHtml(41, QUOTED),
      cardDrawerSubHtml(QUOTED, QUOTED, QUOTED),
    ];
    for (const html of pieces) {
      expect(html).not.toContain("<b>");
      expect(html).not.toContain(QUOTED);
      expect(html).toContain("Bob&#39;s &quot;&lt;b&gt;Q4&lt;/b&gt;&quot; plan");
      expect(tagNames(html)).not.toContain("b");
      expect(shownValues(html).some(value => value.includes(QUOTED))).toBe(true);
    }
    // In an attribute the name stays inside its quotes: the page link's tooltip is the whole name and nothing follows it.
    const link = readMarkup(cellHtml(column(0, "Page", "page"), [QUOTED], LINKS)).tags[0];
    expect([...link.attributes.keys()]).toEqual(["type", "class", "data-act", "title"]);
    expect(decode(link.attributes.get("title") ?? "")).toBe(`Show cards on ${QUOTED}`);
  });

  it("shows a cell that holds a script tag as its text, whatever its column: text, ID, tag or link", () => {
    for (const kind of KINDS) {
      for (const links of [LINKS, NO_LINKS]) {
        const html = cellHtml(column(0, "Any", kind), [SCRIPT], links);
        expect(html, kind).not.toContain("<script");
        expect(html, kind).toContain("&lt;script&gt;alert(document.cookie)&lt;/script&gt;");
        expect(tagNames(html), kind).not.toContain("script");
        expect(readMarkup(html).texts.map(decode), kind).toEqual([SCRIPT]);
      }
    }
    // An ID is copied from an attribute: the attribute holds the whole ID, as typed, and ends where it should.
    const pill = readMarkup(idPill(SCRIPT)).tags[0];
    expect([...pill.attributes.keys()]).toEqual(["type", "class", "data-copy", "title", "aria-label"]);
    expect(decode(pill.attributes.get("data-copy") ?? "")).toBe(SCRIPT);
    expect(overviewHtml(overviewWith({ notes: [SCRIPT], about: [[SCRIPT, SCRIPT]], files: [[SCRIPT, SCRIPT]], howToRead: [[SCRIPT, SCRIPT]], log: [SCRIPT] }))).not.toContain("<script");
  });

  it("lets no text change a cell's markup, in any kind of column", () => {
    for (const kind of KINDS) {
      for (const links of [LINKS, NO_LINKS]) {
        for (let index = 0; index < HOSTILE.length; index++) expectInert(text => cellHtml(column(0, "Any", kind), [text(index)], links), 0);
      }
    }
    for (let index = 0; index < HOSTILE.length; index++) expectInert(text => idPill(text(index)), 0);
    for (const text of HOSTILE) expect(shownValues(cellHtml(column(0, "Any"), [text], LINKS))).toContain(text);
  });

  it("lets no text change a row's first cell, the one that opens the row, in any kind of column", () => {
    for (const kind of KINDS) {
      for (const links of [LINKS, NO_LINKS]) {
        for (const [index, text] of HOSTILE.entries()) {
          expectInert(texts => rowCellHtml(column(0, "Any", kind), [texts(index)], links), 0);
          expect(shownValues(rowCellHtml(column(0, "Any", kind), [text], links)), kind).toContain(text);
        }
      }
    }
  });

  it("makes a row's first cell open the row: its content is the button, or a button stands before a link, an ID or nothing", () => {
    /** The cell's buttons, each by what a click on it does and what it shows, and the text the cell shows outside them. */
    const cell = (kind: Column["kind"], value: Cell | undefined, links = LINKS) => {
      const td = parseMarkup(rowCellHtml(column(0, "Any", kind), value === undefined ? [] : [value], links));
      const outside = td.childNodes.filter(node => node.nodeType === 3).map(node => node.textContent).join("").trim();
      return [td.querySelectorAll("button").map(button => [button.dataset.act ?? (button.dataset.copy !== undefined ? "copy" : ""), button.textContent, button.getAttribute("aria-label")]), outside];
    };
    // Plain content is the button itself, named by its own text, and the cell shows nothing else.
    expect(cell("text", "Revenue")).toEqual([[["row", "Revenue", null]], ""]);
    expect(cell("text", 0)).toEqual([[["row", "0", null]], ""]);
    expect(cell("tag", "Grid")).toEqual([[["row", "Grid", null]], ""]);
    expect(cell("text", "—")).toEqual([[["row", "—", null]], ""]);
    // Without the result's Cards file a page or a card is plain text, and so the button.
    expect(cell("page", "Overview", NO_LINKS)).toEqual([[["row", "Overview", null]], ""]);
    expect(cell("card", 3, NO_LINKS)).toEqual([[["row", "3", null]], ""]);
    // A link or an ID keeps what it does; the row's button stands before it, with a name of its own.
    expect(cell("page", "Overview")).toEqual([[["row", "", "Open this row"], ["page", "Overview", null]], ""]);
    expect(cell("card", 3)).toEqual([[["row", "", "Open this row"], ["card", "3", null]], ""]);
    expect(cell("id", "card-a")).toEqual([[["row", "", "Open this row"], ["copy", "card-a", "Copy ID card-a"]], ""]);
    // A cell without text has the button alone.
    expect(cell("text", "")).toEqual([[["row", "", "Open this row"]], ""]);
    expect(cell("page", undefined)).toEqual([[["row", "", "Open this row"]], ""]);
    // In a table it is the first column shown that opens the row, whichever column that is, and no other.
    const table: ResultTable = { file: "Cards.csv", label: "Cards", headers: ["Page", "Card #", "Card title"], rows: [["Overview", 1, "Sales"], ["Stores", 2, "Plan"]], guard: true };
    const acts = (columns: Column[]) => parseMarkup(tableHtml(viewOf(table, LINKS, { columns }))).querySelectorAll("tbody tr")
      .map(row => row.children.map(td => td.querySelectorAll("[data-act]").map(button => button.dataset.act).join("+")));
    const columns = columnsOf(table);
    expect(acts(columns)).toEqual([["row+page", "card", "card"], ["row+page", "card", "card"]]);
    expect(acts(columns.slice(1))).toEqual([["row+card", "card"], ["row+card", "card"]]);
    expect(acts([column(2, "Card title")])).toEqual([["row"], ["row"]]);
  });

  it("lets no text change the header, the navigation or the breadcrumb", () => {
    expectInert(text => headerMetaHtml({ name: text(0), kind: text(1), host: text(2), exportedOn: text(3) }), 4);
    expectInert(text => navHtml([{ id: "overview", label: text(0) }, { id: "1", label: text(1), count: 3 }, { id: "details", label: text(2) }], "details"), 3);
    expectInert(text => crumbsHtml(text(0), text(1)), 2);
    expectInert(text => crumbsHtml(text(2), undefined), 0);
  });

  it("lets no text change the overview, which holds what the Details file says as well", () => {
    expectInert(text => overviewHtml({
      tiles: [{ label: text(0), count: 3 }, { label: text(1), count: 1 }], cardTypes: [[text(2), 4], [text(3), 1]],
      models: [{ model: text(4), workspace: text(5), modelId: text(6) }, { model: text(7), workspace: text(8), modelId: text(9) }],
      notes: [text(10), text(11), text(12)], about: [[text(13), text(14)], [text(15), text(16)]], files: [[text(17), text(18)]],
      howToRead: [[text(19), text(20)], [text(21), text(22)]], log: [text(23), text(24), text(25)],
    }), 7);
    // Each part alone, with each of the texts in turn: the notes, what the export is about, its files, how to read them, the log.
    const each = <T>(make: (text: Texts, index: number) => T) => (text: Texts): T[] => HOSTILE.map((_, index) => make(text, index));
    expectInert(text => overviewHtml(overviewWith({ notes: each((texts, index) => texts(index))(text) })), 7);
    expectInert(text => overviewHtml(overviewWith({ about: each((texts, index): [string, string] => [texts(index), texts(index + 1)])(text) })), 7);
    expectInert(text => overviewHtml(overviewWith({ files: each((texts, index): [string, string] => [texts(index), texts(index + 1)])(text) })), 7);
    expectInert(text => overviewHtml(overviewWith({ howToRead: each((texts, index): [string, string] => [texts(index), texts(index + 1)])(text) })), 7);
    expectInert(text => overviewHtml(overviewWith({ log: each((texts, index) => texts(index))(text) })), 7);
  });

  it("lets no text change a table: its name, its headers, its cells, the search box, the page a jump keeps", () => {
    const table = (text: Texts): ResultTable => ({
      file: "Anything.csv", label: text(0), headers: [text(1), text(2), text(3), text(4), text(5)], guard: true,
      rows: [[text(6), text(0), text(1), text(2), text(3)], [text(4), text(5), text(6), text(0), text(1)]],
    });
    const kinds = (source: ResultTable): Column[] => columnsOf(source).map((entry, index) => ({ ...entry, kind: KINDS[index], filter: index % 2 === 0, num: index === 1 }));
    expectInert(text => tableHtml(viewOf(table(text), LINKS, { columns: kinds(table(text)), search: text(2), context: text(3), note: text(7), sort: { column: 1, dir: "asc" }, filtered: new Set([0]) })), 7);
    // A table with no rows, and one whose search finds nothing.
    expectInert(text => tableHtml(viewOf({ ...table(text), rows: [] }, NO_LINKS)), 6);
    expectInert(text => tableHtml(viewOf(table(text), LINKS, { rows: [], total: 0, from: 0, to: 0, search: text(2), context: text(3), filtered: new Set([1]) })), 6);
  });

  it("makes a table's view of the parts the page writes again while the user types, each in its place", () => {
    const table: ResultTable = { file: "Cards.csv", label: QUOTED, headers: ["Page", "Card #", IMG], guard: true,
      rows: [["Overview", 1, SCRIPT], ["Overview", 2, "Margin"], ["Stores", 1, CLOSERS]] };
    for (const overrides of [{}, { search: QUOTED, sort: { column: 1, dir: "desc" as const }, filtered: new Set([0]), context: IMG }, { rows: [], total: 0, from: 0, to: 0, search: SCRIPT }]) {
      const view = viewOf(table, LINKS, overrides);
      const parts = tableParts(view);
      const whole = parseMarkup(tableHtml(view));
      // What the box, the pager and the count hold in the whole view is exactly the part.
      expect(whole.querySelector("#tableWrap")?.innerHTML.trim()).toBe(parseMarkup(parts.grid).innerHTML.trim());
      expect(whole.querySelector("#pager")?.innerHTML.trim()).toBe(parseMarkup(parts.pager).innerHTML.trim());
      expect(whole.querySelector("#rowCount")?.textContent).toBe(parts.count);
      expect(whole.querySelector("#resetBtn")?.hidden).toBe(!parts.modified);
      // And the parts hold none of the rest: the search box is not in them.
      for (const part of [parts.grid, parts.pager]) expect(readMarkup(part).tags.filter(tag => tag.attributes.get("id") === "tblSearch")).toEqual([]);
      expectInert(text => tableParts(viewOf({ ...table, label: text(0), headers: [text(1), text(2), text(3)], rows: [[text(4), text(5), text(6)]] }, LINKS, overrides)).grid, 0);
    }
    // Reset is offered for a search, a filter, a sort or a jump, each on its own, and not for a search of spaces only.
    const modified = (overrides: Partial<TableView>) => tableParts(viewOf(table, LINKS, overrides)).modified;
    expect([modified({}), modified({ search: "   " }), modified({ search: "a" }), modified({ filtered: new Set([2]) }), modified({ sort: { column: 0, dir: "asc" } }), modified({ context: "" })])
      .toEqual([false, false, true, true, true, true]);
    expect(tableParts(viewOf(table, LINKS)).count).toBe("1–3 of 3 rows");
    expect(tableParts(viewOf(table, LINKS, { total: 2, to: 2 })).count).toBe("1–2 of 2 rows (filtered from 3)");
    // One row is a row, and no rows are said in words, not as "0–0 of 0 rows".
    expect(tableParts(viewOf(table, LINKS, { total: 1, to: 1 })).count).toBe("1–1 of 1 row (filtered from 3)");
    expect(tableParts(viewOf(table, LINKS, { rows: [], total: 0, from: 0, to: 0, search: "x" })).count).toBe("No rows (filtered from 3)");
    expect(tableParts(viewOf({ ...table, rows: [] }, LINKS)).count).toBe("No rows");
    // A table without rows says so in the page's own word for it.
    const none = parseMarkup(tableHtml(viewOf({ ...table, label: "Filters", rows: [] }, LINKS)));
    expect([none.querySelector(".e-title")?.textContent, none.querySelector(".e-sub")?.textContent]).toEqual(["Filters has no rows", "Nothing was found for this table in this analysis."]);
  });

  it("shows a row whole in the drawer: each value as it is, in the element that keeps its line breaks and spaces", () => {
    const text = "IF Sales > 0 THEN\n    Sales  *  Price\nELSE\n\t0";
    const columns = [column(0, "Formula"), column(1, "Type", "tag"), column(2, "Page", "page"), column(3, "Card title", "card"), column(4, "Card ID", "id", { hidden: true }), column(5, "Empty"), column(6, "None")];
    const row: Cell[] = [text, text, text, text, text, "", "—"];
    for (const html of [rowDrawerHtml(columns, row, LINKS), rowDrawerHtml(columns, row, NO_LINKS), cardDrawerHtml(columns, row, LINKS, [])]) {
      const values = parseMarkup(html).querySelectorAll(".d-dl dd");
      expect(parseMarkup(html).querySelectorAll(".d-dl dt").map(name => name.textContent)).toEqual(["Formula", "Type", "Page", "Card title", "Card ID", "Empty", "None"]);
      // Every cell's own text, to the character, whatever its column's kind; an empty cell stays empty.
      expect(values.map(value => value.textContent)).toEqual([text, text, text, text, text, "", "—"]);
      // The text of a value stands in a cell-t or, for an ID, in its pill, and in nothing else: the dd holds no other text.
      for (const value of values.slice(0, 5)) {
        const holders = value.querySelectorAll(".cell-t, .id-pill");
        expect(holders.map(holder => holder.textContent)).toEqual([text]);
        expect(value.childNodes.filter(node => node.nodeType === 3)).toEqual([]);
      }
      expect(values[4].querySelectorAll(".id-pill").map(pill => pill.dataset.copy)).toEqual([text]);
    }
    // A tag stays a tag and a link a link, in the drawer as in the table; only the table leaves the cell-t out of them.
    const kinds = (html: string) => parseMarkup(html).querySelectorAll(".tag, .link").map(element => [element.classList.contains("tag") ? "tag" : element.dataset.act, element.querySelectorAll(".cell-t").length]);
    expect(kinds(rowDrawerHtml(columns, row, LINKS))).toEqual([["tag", 1], ["page", 1], ["card", 1]]);
    expect(kinds(columns.map(entry => cellHtml(entry, row, LINKS)).join(""))).toEqual([["tag", 0], ["page", 0], ["card", 0]]);
  });

  it("shows the cells a row holds beyond its headers too, under names of the page's own", () => {
    const table: ResultTable = { file: "Line Items.csv", label: "Line Items", headers: ["", "Formula"], guard: false,
      rows: [["Revenue", "Units * Price", "left over", IMG, 7], ["Units", ""], ["Short"]] };
    const columns = columnsOf(table);
    const pairs = (row: Cell[]) => {
      const drawer = parseMarkup(rowDrawerHtml(columns, row, NO_LINKS));
      return drawer.querySelectorAll("dt").map((name, index) => [name.textContent, drawer.querySelectorAll("dd")[index].textContent]);
    };
    expect(pairs(table.rows[0])).toEqual([["Name", "Revenue"], ["Formula", "Units * Price"], ["Column 3", "left over"], ["Column 4", IMG], ["Column 5", "7"]]);
    // A row with as many cells as headers, or fewer, has the table's columns and no more.
    expect(pairs(table.rows[1])).toEqual([["Name", "Units"], ["Formula", ""]]);
    expect(pairs(table.rows[2])).toEqual([["Name", "Short"], ["Formula", ""]]);
    // A card's drawer shows its row the same way. The table itself keeps to its headers.
    expect(parseMarkup(cardDrawerHtml(columns, table.rows[0], NO_LINKS, [])).querySelectorAll("dt").map(name => name.textContent)).toEqual(["Name", "Formula", "Column 3", "Column 4", "Column 5"]);
    expect(parseMarkup(tableHtml(viewOf(table, NO_LINKS))).querySelectorAll("tbody tr").map(tr => tr.children.length)).toEqual([2, 2, 2]);
    expectInert(texts => rowDrawerHtml(columns, [texts(0), texts(1), texts(2), texts(3)], NO_LINKS), 4);
  });

  it("lets no text change the switch between a table's ways, or an object's drawer", () => {
    // The switch: the table's name is in its label; a way's own name and words are the page's, and are written as text all the same.
    expectInert(text => tableHtml(viewOf({ file: "Where Used.csv", label: text(0), headers: [text(1)], rows: [[text(2)]], guard: true }, NO_LINKS,
      { ways: [{ way: "object", label: text(3), chosen: true }, { way: "use", label: text(4), chosen: false }], note: text(5) })), 6);
    // An object: its type, its module, its ID, its model, each role, and each use's page, card and role. Its name is the
    // drawer's heading, which the page sets as text.
    const object = (text: Texts, uses: number): WhereUsedObject => ({ type: text(0), module: text(1), id: text(2), model: text(3), name: text(4), pages: 2, cards: 3,
      roles: [[text(5), 2], [text(6), 1]], uses: Array.from({ length: uses }, (_, index) => ({ row: index, page: text(7 + index % 3), card: text(10 + index), usedAs: text(11 + index), cardId: index % 2 ? text(12) : undefined })) });
    for (const links of [LINKS, NO_LINKS]) {
      expectInert(text => objectDrawerHtml(object(text, 6), links, false), 7);
      expectInert(text => objectDrawerHtml(object(text, 60), links, false), 7);
      expectInert(text => objectDrawerHtml(object(text, 60), links, true), 7);
    }
    for (const multiModel of [true, false]) expectInert(text => objectDrawerSubHtml(object(text, 1), multiModel), multiModel ? 4 : 3);
    // What a click reads of a use is its place among the object's uses, a number, and never the use's own text: here on
    // the three pages' names and on the thirty cards that are named.
    const uses = readMarkup(objectDrawerHtml(object(hostile, 60), LINKS, true)).tags.filter(tag => tag.attributes.has("data-use"));
    expect([uses.length, uses.every(tag => /^\d+$/.test(tag.attributes.get("data-use") ?? "")), [...new Set(uses.map(tag => tag.attributes.get("data-act")))].sort()]).toEqual([33, true, ["use-card", "use-page"]]);
  });

  it("lets no text change the column filter, the column chooser or the drawer", () => {
    expectInert(text => colFilterHtml(column(0, text(0), "text", { filter: true }), [[text(1), 3], [text(2), 1], [text(3), 1]], new Set([text(1), text(3)])), 4);
    expectInert(text => colFilterHtml(column(0, text(0)), [[text(1), 3]], undefined), 2);
    expectInert(text => colChooserHtml([column(0, text(0)), column(1, text(1), "id", { hidden: true }), column(2, text(2))], new Set([1])), 3);
    const columns = (text: Texts) => KINDS.map((kind, index) => column(index, text(index), kind));
    const row = (text: Texts): Cell[] => KINDS.map((_, index) => text(index + 2));
    expectInert(text => rowDrawerHtml(columns(text), row(text), LINKS), 7);
    // With the CSV's text for the cells said in words, under each kind of column; and each of the texts in turn as such a
    // text: it stands there as it was typed, and changes nothing else.
    expectInert(text => rowDrawerHtml(columns(text), row(text), LINKS, new Map(KINDS.map((_, index) => [index, text(index + 4)]))), 7);
    const withText = (exported: string) => rowDrawerHtml(columns(harmless), row(harmless), NO_LINKS, new Map([[1, exported]]));
    for (const entry of HOSTILE) {
      expect(structure(withText(entry)), entry).toEqual(structure(withText("a harmless text")));
      expect(shownValues(withText(entry)), entry).toContain(entry);
    }
    // The line under a row's name says which row of which table, and is nothing but text whatever the table's name holds.
    for (const [index, name] of HOSTILE.entries()) {
      expectInert(text => rowDrawerSubHtml(41, text(index)), 0);
      expect(readMarkup(rowDrawerSubHtml(41, name)).tags).toEqual([]);
      expect(shownValues(rowDrawerSubHtml(41, name))).toEqual([`Row 41 of ${name}`]);
    }
    expect(rowDrawerSubHtml(3, "Line Items")).toBe("Row 3 of Line Items");
    expectInert(text => cardDrawerSubHtml(text(0), text(1), text(2)), 3);
    expectInert(text => cardDrawerHtml(columns(text), row(text), LINKS, [
      { title: text(0), none: text(1), headings: [text(2), text(3)], rows: [[text(4), text(5)], [text(6), text(0)]] },
      { title: text(1), none: text(2), headings: [text(3)], rows: [] },
    ]), 7);
  });

  it("writes only numbers the page counted itself into the pager and into what a click reads", () => {
    const html = pagerHtml(3, 12, 600, 50);
    expect(readMarkup(html).tags.filter(tag => tag.attributes.has("data-page")).map(tag => tag.attributes.get("data-page"))).toEqual(["2", "0", "2", "3", "4", "11", "4"]);
    expect(pagerHtml(0, 1, 0, 50)).toBe("");
    const filter = readMarkup(colFilterHtml(column(4, "Card type"), [[SCRIPT, 1], [IMG, 2]], undefined)).tags.filter(tag => tag.name === "input");
    expect(filter.map(tag => tag.attributes.get("data-fval"))).toEqual(["0", "1"]);
  });

  it("holds no text of a run in the run's view or in its banner: the page sets each part as plain text", () => {
    const ids = (html: string) => readMarkup(html).tags.flatMap(tag => (tag.attributes.has("id") ? [tag.attributes.get("id")] : []));
    const words = (html: string) => readMarkup(html).texts.map(text => text.trim()).filter(text => text !== "");
    expect(ids(runHtml())).toEqual(["runTitle", "runStatus", "runHint", "runLog", "diagLog"]);
    expect(words(runHtml())).toEqual(["Diagnostics", "Copy diagnostic log"]);
    expect(ids(runBannerHtml())).toEqual(["runBanner", "bannerTitle", "bannerText", "bannerHint", "bannerCopy"]);
    expect(words(runBannerHtml())).toEqual(["The results below are from the earlier run.", "Copy diagnostic log"]);
    // The note above a result is the same: a place for one line, and the button, which waits hidden for a reason to copy.
    expect([ids(noteBannerHtml()), words(noteBannerHtml())]).toEqual([["noteBanner", "noteText", "noteCopy"], ["Copy diagnostic log"]]);
    const note = parseMarkup(noteBannerHtml()).querySelector("#noteBanner");
    expect([note?.classList.contains("banner"), note?.classList.contains("note"), note?.classList.contains("warn"), note?.querySelector("#noteText")?.localName]).toEqual([true, true, false, "span"]);
    // Both copy the log of the run, not the one a result carries; the banner's button waits, hidden, for a first line.
    const copies = (html: string) => parseMarkup(html).querySelectorAll("button").map(button => [button.dataset.act, button.textContent.trim(), button.hidden]);
    expect(copies(runHtml())).toEqual([["copy-run-log", "Copy diagnostic log", false]]);
    expect(copies(runBannerHtml())).toEqual([["copy-run-log", "Copy diagnostic log", true]]);
    expect(copies(noteBannerHtml())).toEqual([["copy-run-log", "Copy diagnostic log", true]]);
    expect(copies(overviewHtml(overviewWith({ log: ["a line"] })))).toEqual([["copy-diag", "Copy diagnostic log", false]]);
  });
});

describe("A result whose every text is hostile, through every view of the page", () => {
  let next = 0;
  const text = (): string => HOSTILE[next++ % HOSTILE.length];
  const appTable = (file: string, headers: string[], rows: number): ResultTable => ({
    file, label: file.replace(/\.csv$/, ""), headers, guard: true,
    // Every cell is hostile, except what ties a row to its card and page, which the drawer looks up.
    rows: Array.from({ length: rows }, () => headers.map(header => (header === "Page" ? QUOTED : header === "Card ID" ? SCRIPT : text()))),
  });
  const result: AnalysisResult = {
    kind: "app", name: IMG, id: SCRIPT, zipName: `${QUOTED}.zip`, summary: [text(), text()],
    tables: [
      { file: "App Details.csv", label: "App Details", headers: DETAILS_HEADERS, guard: true, details: true,
        rows: [["App", text(), text()], ["Export", "Anaplan host", text()], ["Export", "Exported on", text()], ["Notes", text(), text()], [text(), text(), text()],
          ["Diagnostics", "14:02:05", text()], ["Diagnostics", "", text()]] },
      appTable("Pages.csv", HEADERS.Pages, 2),
      appTable("Cards.csv", HEADERS.Cards, 3),
      appTable("Grid Sections.csv", HEADERS["Grid sections"], 2),
      appTable("Filters.csv", HEADERS.Filters, 2),
      appTable("Conditional Formatting.csv", HEADERS.Formatting, 1),
      appTable("Action Buttons.csv", HEADERS.Actions, 0),
      appTable("Where Used.csv", HEADERS["Where used"], 2),
      { file: SCRIPT, label: IMG, headers: ["", IMG, QUOTED], rows: [[SCRIPT, BREAK_OUT, BREAK_OUT_SINGLE], [CLOSERS, ENTITY, ""]], guard: false },
    ],
  };

  /** Every piece of markup the page writes for the result, as main.ts puts it together. */
  function everyView(): string[] {
    const details = detailsOf(result);
    const cards = cardsOf(result);
    const tables = result.tables.filter(table => table !== details);
    const linksOf = (table: ResultTable): Links => {
      const keys = rowKeys(table);
      return { page: cards !== undefined && keys.page !== undefined, card: cards !== undefined && keys.page !== undefined && keys.cardId !== undefined };
    };
    const pieces = [
      headerMetaHtml(analysedOf(result)),
      navHtml([{ id: "overview", label: "Overview" }, ...tables.map((table, index) => ({ id: String(index + 1), label: table.label, count: table.rows.length })), ], "overview", true),
      // The overview holds what the Details file says, too: there is no view of it apart.
      overviewHtml(overviewOf(result)),
      // The run's own view and its banner hold no text of a result, but they are the page's markup too.
      runHtml(),
      runBannerHtml(),
      noteBannerHtml(),
    ];
    for (const table of tables) {
      const columns = columnsOf(table);
      const links = linksOf(table);
      pieces.push(crumbsHtml(table.label, QUOTED));
      pieces.push(tableHtml(viewOf(table, links, { search: SCRIPT, context: QUOTED })));
      pieces.push(tableHtml(viewOf(table, links, { columns: columns.filter(entry => !entry.hidden) })));
      pieces.push(colChooserHtml(columns, new Set()));
      for (const entry of columns.filter(candidate => candidate.filter)) pieces.push(colFilterHtml(entry, valueCounts(table.rows, entry.index), undefined));
      pieces.push(rowDrawerSubHtml(1, table.label));
      for (const row of table.rows) pieces.push(rowDrawerHtml(columns, row, links));
    }
    if (cards) {
      for (const row of cards.table.rows) {
        pieces.push(cardDrawerSubHtml(String(row[cards.page]), IMG, String(row[cards.cardId])));
        pieces.push(cardDrawerHtml(columnsOf(cards.table), row, linksOf(cards.table), cardSections(result, String(row[cards.page]), String(row[cards.cardId]))));
      }
    }
    // The Where Used file by object: its table under the switch, and each object's drawer, with its uses' links.
    const byObject = whereUsedView(result);
    if (!byObject) throw new Error("The result has no view of Where Used by object.");
    const ways = [{ way: "object", label: "By object", chosen: true }, { way: "use", label: "Every use", chosen: false }];
    pieces.push(tableHtml(viewOf({ file: "Where Used.csv", label: QUOTED, headers: byObject.headers, rows: byObject.rows, guard: true }, NO_LINKS, { columns: byObject.columns, ways, note: byObject.note })));
    for (const object of byObject.objects) {
      pieces.push(objectDrawerSubHtml(object, true));
      for (const all of [false, true]) pieces.push(objectDrawerHtml({ ...object, uses: Array.from({ length: 60 }, (_, index) => ({ ...object.uses[0], row: index, cardId: SCRIPT })) }, LINKS, all));
    }
    return pieces;
  }

  it("is made of the design's own elements and attributes only", () => {
    const html = everyView().join("\n");
    const elements = new Set(["button", "circle", "dd", "details", "div", "dl", "dt", "em", "h1", "h2", "h3", "input", "kbd", "label", "li", "option", "p", "path", "pre", "rect",
      "section", "select", "span", "strong", "summary", "svg", "table", "tbody", "td", "th", "thead", "tr", "ul"]);
    const attributes = /^(aria-[a-z]+|data-(act|nav|copy|sort|colfilter|col|fval|page|popact|way|use)|class|type|title|style|id|hidden|open|disabled|checked|selected|value|placeholder|tabindex|role|scope|width|height|viewBox|fill|stroke|stroke-width|stroke-linecap|stroke-linejoin|d|cx|cy|r|x|y|rx)$/;
    expect(tagNames(html).filter(name => !elements.has(name))).toEqual([]);
    expect(attributeNames(html).filter(name => !attributes.test(name))).toEqual([]);
    // The table, the drawer and the popovers are all there: this is the whole page, not a corner of it.
    expect(["table", "input", "dl", "pre", "select", "svg"].filter(name => !tagNames(html).includes(name))).toEqual([]);
  });

  it("keeps every text out of the attributes that are more than a text: classes, styles, IDs and what a click reads", () => {
    const styles = new Set<string>();
    for (const html of everyView()) {
      for (const tag of readMarkup(html).tags) {
        for (const [name, value] of tag.attributes) {
          if (value === undefined) continue;
          if (HOSTILE.some(entry => decode(value).includes(entry))) expect(VALUE_ATTRIBUTES, `${tag.name} ${name}="${value}"`).toContain(name);
          if (name === "style") styles.add(value.replace(/\d+%/, "N%"));
          if (name === "class") expect(value, "a class").toMatch(/^[a-z0-9 -]*$/);
          if (/^data-(sort|colfilter|col|fval|page|use)$/.test(name)) expect(value, name).toMatch(/^-?\d+$/);
          if (name === "data-act") expect(["page", "card", "row", "reset", "clear-search", "clear-context", "copy-diag", "copy-run-log", "use-page", "use-card", "more-uses"]).toContain(value);
          if (name === "data-nav") expect(value).toMatch(/^(overview|map|\d+)$/);
          if (name === "data-way") expect(value).toMatch(/^(object|use)$/);
          if (name === "id") expect(value).toMatch(/^[A-Za-z]+$/);
        }
      }
    }
    // Every style on the page is one of the design's own; the only part that varies is a bar's width, a number.
    expect([...styles].sort()).toEqual(["display:block;width:N%", "font-family:var(--mono);font-size:11px", "font-size:12px;color:var(--text-2);margin:-6px 0 12px",
      "font-size:12px;color:var(--text-3);margin:4px 0 0", "font:inherit", "margin-bottom:10px", "margin-bottom:12px", "margin-left:auto", "margin-left:auto;flex:none",
      "overflow:hidden;text-overflow:ellipsis"]);
  });

  it("shows each hostile text as it was typed, somewhere on the page", () => {
    const shown = everyView().flatMap(shownValues);
    for (const entry of HOSTILE) expect(shown.some(value => value.includes(entry)), entry).toBe(true);
  });

  it("has static icons that hold nothing but their drawing", () => {
    for (const icon of [SUN_ICON, MOON_ICON]) expect(tagNames(icon).filter(name => !["svg", "path", "circle"].includes(name))).toEqual([]);
  });

  it("hides every icon from a screen reader: each stands beside a text or in a control with a name", () => {
    const icons = [...everyView(), SUN_ICON, MOON_ICON].flatMap(html => readMarkup(html).tags.filter(tag => tag.name === "svg" && !tag.closing));
    expect(icons.length).toBeGreaterThan(40);
    expect(icons.filter(icon => icon.attributes.get("aria-hidden") !== "true")).toEqual([]);
    // A button that holds only an icon has a name of its own.
    for (const html of everyView()) {
      for (const button of parseMarkup(html).querySelectorAll("button")) {
        if (button.textContent.trim() === "") expect(button.getAttribute("aria-label"), button.outerHTML).toMatch(/\S/);
      }
    }
  });

  it("goes down its headings one level at a time: a view from its h1, the drawer from the shell's h2", () => {
    /** The headings of a piece of markup, in order, as "level text". */
    const headings = (html: string) => parseMarkup(html).querySelectorAll("h1, h2, h3, h4, h5, h6").map(heading => `${heading.localName[1]} ${heading.textContent}`);
    const overview = overviewOf({ kind: "app", name: "App", id: "id", zipName: "App.zip", summary: ["A note."], tables: [
      { file: "Pages.csv", label: "Pages", headers: ["Page", "Model", "Workspace", "Model ID"], rows: [["Overview", "Model one", "Main", "id-1"]], guard: true },
      { file: "Cards.csv", label: "Cards", headers: ["Page", "Card type", "Card ID"], rows: [["Overview", "Grid", "card-a"]], guard: true }] });
    expect(headings(overviewHtml(overview))).toEqual(["1 Overview", "2 Notes", "2 Cards by type", "2 Models"]);
    // With what the Details file says: each part under a heading of its own, the two that start closed among them.
    expect(headings(overviewHtml({ ...overview, about: [["App", "Demo"]], files: [["Imports.csv", "Not exported"]], howToRead: [["Layout", "As Anaplan's export."]], log: ["a line"] })))
      .toEqual(["1 Overview", "2 About this export", "2 Notes", "2 Cards by type", "2 Models", "2 Files", "2 How to read these files", "2 Diagnostics"]);
    const table: ResultTable = { file: "Cards.csv", label: "Cards", headers: ["Page"], rows: [["Overview"]], guard: true };
    expect(headings(tableHtml(viewOf(table, LINKS)))).toEqual(["1 Cards"]);
    expect(headings(runHtml())).toEqual(["1 "]);
    // The drawer's heading is the page shell's h2 (results.html), so its sections are one level under that.
    expect(headings(rowDrawerHtml(columnsOf(table), table.rows[0], LINKS))).toEqual(["3 All columns"]);
    expect(headings(cardDrawerHtml(columnsOf(table), table.rows[0], LINKS, [{ title: "Filters", none: "filters", headings: ["Sec"], rows: [] }]))).toEqual(["3 Card details", "3 Filters (0)"]);
    // Whatever the result, no view goes from one level to one two below it.
    for (const html of everyView()) {
      const levels = headings(html).map(heading => Number(heading[0]));
      expect(levels.filter((level, index) => index > 0 && level > levels[index - 1] + 1), headings(html).join(" | ")).toEqual([]);
      if (levels.includes(1)) expect(levels[0]).toBe(1);
    }
  });

  it("gives the diagnostic log, which the keyboard can scroll, a role and a name", () => {
    for (const html of [runHtml(), overviewHtml(overviewWith({ log: ["a line"] }))]) {
      const log = parseMarkup(html).querySelector("#diagLog");
      expect([log?.localName, log?.getAttribute("tabindex"), log?.getAttribute("role"), log?.getAttribute("aria-label")]).toEqual(["pre", "0", "region", "Diagnostic log"]);
    }
  });

  it("says in a filter button's name and in its icon's shape, not by colour alone, that the filter is in force", () => {
    const table: ResultTable = { file: "Cards.csv", label: "Cards", headers: ["Page", "Card #", "Card type"], rows: [["Overview", 1, "Grid"], ["Stores", 2, "KPI"]], guard: true };
    const buttons = parseMarkup(tableHtml(viewOf(table, LINKS, { filtered: new Set([2]) }))).querySelectorAll("[data-colfilter]");
    expect(buttons.map(button => [button.dataset.colfilter, button.getAttribute("aria-label"), button.title, button.classList.contains("active"), button.querySelector("svg")?.getAttribute("fill"),
      button.getAttribute("aria-haspopup"), button.getAttribute("aria-expanded")])).toEqual([
      ["0", "Filter by Page", "Filter by Page", false, "none", "dialog", "false"],
      ["1", "Filter by Card #", "Filter by Card #", false, "none", "dialog", "false"],
      ["2", "Filter by Card type (filter on)", "Filter by Card type (filter on)", true, "currentColor", "dialog", "false"],
    ]);
    // The outline is drawn with a stroke; the filled funnel needs none.
    expect(buttons.map(button => button.querySelector("svg")?.getAttribute("stroke"))).toEqual(["currentColor", "currentColor", null]);
    const chooser = parseMarkup(tableHtml(viewOf(table, LINKS))).querySelector("#colBtn");
    expect([chooser?.getAttribute("aria-haspopup"), chooser?.getAttribute("aria-expanded")]).toEqual(["dialog", "false"]);
  });
});
