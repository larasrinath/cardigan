import { describe, expect, it } from "vitest";
import { DETAILS_HEADERS } from "../details.js";
import { HEADERS } from "../report.js";
import type { AnalysisResult, Cell, ResultTable } from "../result-types.js";
import { cellLists, rowItems } from "./cell-lists.js";
import { columnWidths } from "./column-widths.js";
import { APP_FILES, cardsOf, columnsOf, rowKeys, type Column } from "./columns.js";
import {
  cardDrawerHtml, cardDrawerSubHtml, cellHtml, colChooserHtml, colFilterHtml, coloursHtml, esc, FILE_ICONS, FORGOTTEN_LINE, headerMetaHtml, idPill, keptCopyHtml, MAP_LABEL, mapHtml,
  MOON_ICON, NAV_GROUPS, NAV_ICONS, navHtml, navItems, navMenuHtml, noteBannerHtml, NOT_REMOVED_LINE, objectDrawerHtml, objectDrawerSubHtml, overviewHtml, pagerHtml, rowCellHtml, rowDrawerHtml,
  rowDrawerSubHtml, runBannerHtml, runHtml, SUN_ICON, tableHtml, tableParts,
  type KeptCopy, type Links, type TableView,
} from "./markup.js";
import { parseMarkup } from "./dom.test-support.js";
import { decode, readMarkup, shownValues, structure } from "./markup.test-support.js";
import { analysedOf, cardParts, detailsOf, fileView, MODEL_FILE_ORDER, overviewOf, type Overview } from "./result-view.js";
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

/** `expectInert` with each of the hostile texts in each place in turn. One text in one place shows only what that text
 * can do there: a text that breaks out of an attribute changes nothing where a text is written unescaped between tags,
 * and a tag changes nothing inside a quoted attribute. Round the whole list, every place meets every one of them. `places`
 * is how many places of the markup take a text: each must show its text as typed, whichever it is. */
function expectInertInTurn(build: (text: Texts) => string, places: number): void {
  for (let shift = 0; shift < HOSTILE.length; shift++) {
    const shifted = (text: Texts): Texts => index => text(index + shift);
    expectInert(text => build(shifted(text)), 0);
    const shown = shownValues(build(shifted(hostile)));
    for (let place = 0; place < places; place++) expect(shown.filter(value => value.includes(hostile(place + shift))), `place ${place} shows its text as typed, with the texts moved on by ${shift}`).not.toEqual([]);
  }
}

const LINKS: Links = { page: true, card: true };
const NO_LINKS: Links = { page: false, card: false };
/** A column of one of the app's tables, where the dash alone says that there is nothing (columns.ts `Column`). */
const column = (index: number, label: string, kind: Column["kind"] = "text", extra: Partial<Column> = {}): Column =>
  ({ index, label, kind, num: false, filter: false, hidden: false, none: true, ...extra });
const KINDS: Column["kind"][] = ["text", "id", "tag", "page", "card", "colours"];
/** An overview that holds nothing but what a test gives it. */
const overviewWith = (parts: Partial<Overview>): Overview => ({ tiles: [], notes: [], about: [], files: [], howToRead: [], log: [], ...parts });
const tagNames = (html: string) => [...new Set(readMarkup(html).tags.map(tag => tag.name))].sort();
const attributeNames = (html: string) => [...new Set(readMarkup(html).tags.flatMap(tag => [...tag.attributes.keys()]))].sort();

/** A table view as the page builds it for a table, with nothing chosen: its columns' widths from all of its rows. */
function viewOf(table: ResultTable, links: Links, overrides: Partial<TableView> = {}): TableView {
  const page = pageOf(selectRows(table.rows, { search: "", filters: new Map() }), 0, 50);
  return { label: table.label, columns: columnsOf(table), widths: columnWidths(columnsOf(table), table.rows), rows: page.rows, page: page.page, pages: page.pages, pageSize: 50,
    from: page.from, to: page.to, total: page.total, all: table.rows.length, search: "", sort: undefined, filtered: new Set(), context: undefined, links, note: undefined, ...overrides };
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

  it("shows a name that holds quotes and angle brackets as its text: the app, a file, a page, a detail of the export", () => {
    const pieces = [
      headerMetaHtml({ name: QUOTED, kind: "App", host: QUOTED, exportedOn: QUOTED }),
      navHtml([{ id: "overview", label: "Overview" }, { id: "1", label: QUOTED, file: QUOTED }], "1"),
      overviewHtml({ tiles: [{ label: QUOTED, count: 1 }], notes: [QUOTED], about: [[QUOTED, QUOTED]], files: [[QUOTED, QUOTED]], howToRead: [[QUOTED, QUOTED]], log: [QUOTED] }),
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
    expect(cell("text", "-")).toEqual([[["row", "-", null]], ""]);
    // Without the result's Cards file a page or a card is plain text, and so the button.
    expect(cell("page", "Overview", NO_LINKS)).toEqual([[["row", "Overview", null]], ""]);
    expect(cell("card", 3, NO_LINKS)).toEqual([[["row", "3", null]], ""]);
    // A link or an ID keeps what it does; the row's button stands before it, with a name of its own.
    expect(cell("page", "Overview")).toEqual([[["row", "", "Open this row"], ["page", "Overview", null]], ""]);
    expect(cell("card", 3)).toEqual([[["row", "", "Open this row"], ["card", "3", null]], ""]);
    // In a table that says row by row whether the result has the row's card, a card that it has not is plain, and so the button.
    expect(cell("card", 3, { ...LINKS, hasCard: () => true })).toEqual([[["row", "", "Open this row"], ["card", "3", null]], ""]);
    expect(cell("card", 3, { ...LINKS, hasCard: () => false })).toEqual([[["row", "3", null]], ""]);
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
    // A table may have a column of its own for it, said by the column's place in the table: then that column's cell opens
    // the row wherever it is shown, and no other. While it is not shown, the first one shown opens the row, as in any table.
    const opened = (shown: Column[], opensFrom: number) => parseMarkup(tableHtml(viewOf(table, LINKS, { columns: shown, opensFrom }))).querySelectorAll("tbody tr")
      .map(row => row.children.map(td => td.querySelectorAll("[data-act]").map(button => button.dataset.act).join("+")));
    expect(opened(columns, 2)).toEqual([["page", "card", "row+card"], ["page", "card", "row+card"]]);
    expect(opened([columns[2], columns[0]], 2)).toEqual([["row+card", "page"], ["row+card", "page"]]);
    expect(opened([columns[1], columns[0]], 0)).toEqual([["card", "row+page"], ["card", "row+page"]]);
    expect(opened(columns.slice(0, 2), 2)).toEqual([["row+page", "card"], ["row+page", "card"]]);
    expect(opened(columns, 0)).toEqual(acts(columns));
  });

  it("lets no text change the header or the navigation, its icons included: a file's name chooses an icon and is written nowhere", () => {
    expectInert(text => headerMetaHtml({ name: text(0), kind: text(1), host: text(2), exportedOn: text(3) }), 4);
    expectInert(text => navHtml([{ id: "overview", label: text(0) }, { id: "1", label: text(1) }, { id: "details", label: text(2) }], "details"), 3);
    // A file's name, as a result can hold any, is only looked up: whatever it holds, the entry has a drawing of the
    // page's own, and the name is not in the markup at all. A known file under a hostile label keeps its own icon.
    expectInert(text => navHtml([{ id: "1", label: text(0), file: text(3) }, { id: "2", label: text(1), file: APP_FILES.Cards }, { id: "map", label: text(2), file: text(4) }], "2"), 3);
    for (const name of HOSTILE) {
      const html = navHtml([{ id: "1", label: "Line Items", file: name }], "1");
      expect([parseMarkup(html).querySelector("svg")?.outerHTML, shownValues(html).some(value => value.includes(name))], name).toEqual([parseMarkup(NAV_ICONS.table).innerHTML, false]);
    }
    // A model's groups, and the one menu of a narrow window: the groups' words are the page's own, the tables' labels
    // and the name of the view shown are text, and a file's name only places its table.
    const grouped = (text: Texts) => navItems([{ id: "1", label: text(0), file: "Modules.csv" }, { id: "2", label: text(1), file: "Line Items.csv" }, { id: "3", label: text(2), file: text(4) }], true);
    expectInert(text => navHtml(grouped(text), "2"), 3);
    expectInert(text => navMenuHtml(grouped(text), "2", text(3)), 4);
  });

  it("lets no text change the overview, which holds what the Details file says as well", () => {
    expectInert(text => overviewHtml({
      tiles: [{ label: text(0), count: 3 }, { label: text(1), count: 1 }], notes: [text(2), text(3), text(4)], about: [[text(5), text(6)], [text(7), text(8)]],
      files: [[text(9), text(10)]], howToRead: [[text(11), text(12)], [text(13), text(14)]], log: [text(15), text(16), text(17)],
    }), 7);
    // Each part alone, with each of the texts in turn: the notes, what the export is about, its files, how to read them, the log.
    const each = <T>(make: (text: Texts, index: number) => T) => (text: Texts): T[] => HOSTILE.map((_, index) => make(text, index));
    expectInert(text => overviewHtml(overviewWith({ notes: each((texts, index) => texts(index))(text) })), 7);
    expectInert(text => overviewHtml(overviewWith({ about: each((texts, index): [string, string] => [texts(index), texts(index + 1)])(text) })), 7);
    expectInert(text => overviewHtml(overviewWith({ files: each((texts, index): [string, string] => [texts(index), texts(index + 1)])(text) })), 7);
    expectInert(text => overviewHtml(overviewWith({ howToRead: each((texts, index): [string, string] => [texts(index), texts(index + 1)])(text) })), 7);
    expectInert(text => overviewHtml(overviewWith({ log: each((texts, index) => texts(index))(text) })), 7);
  });

  it("puts nothing of a result into what the overview says about the copy kept for a refresh: its words are the page's own", () => {
    /** An overview whose every text is one of `text`'s. */
    const full = (text: Texts): Overview => ({
      tiles: [{ label: text(0), count: 3 }], notes: [text(5), text(6)], about: [[text(0), text(1)], [text(2), text(3)]], files: [[text(4), text(5)]], howToRead: [[text(6), text(0)]], log: [text(1), text(2)],
    });
    const words: Record<KeptCopy, string[]> = { none: [], keeping: ["A copy of this result is kept for a refresh of this page.", "Forget this result"],
      kept: ["A copy of this result is kept for a refresh of this page.", "Forget this result"], "not-removed": [NOT_REMOVED_LINE, "Forget this result"], forgotten: [FORGOTTEN_LINE] };
    for (const copy of ["none", "keeping", "kept", "not-removed", "forgotten"] as const) {
      // What stands in the place is made of the state alone, so no result can have a say in it: the same markup, to the
      // character, under an overview whose every text is hostile and under one that holds nothing but harmless words.
      const places = [full(hostile), full(harmless), overviewWith({})].map(overview => parseMarkup(overviewHtml(overview, copy)).querySelector("#ovKept")?.innerHTML);
      expect(places, copy).toEqual(Array(3).fill(parseMarkup(keptCopyHtml(copy)).innerHTML));
      // Its texts are the page's sentences and the button's words, shown as they are; what its attributes hold is fixed as well.
      expect(readMarkup(keptCopyHtml(copy)).texts.map(decode), copy).toEqual(words[copy]);
      expect(readMarkup(keptCopyHtml(copy)).tags.flatMap(tag => [...tag.attributes].map(([name, value]) => `${name}=${value}`)), copy).toEqual({ none: [],
        keeping: ["class=to-come", "aria-hidden=true", "class=btn sm to-come", "aria-hidden=true"],
        kept: ["id=keptLine", "type=button", "class=btn sm", "data-act=forget", "aria-describedby=keptLine"],
        "not-removed": ["id=keptLine", "type=button", "class=btn sm", "data-act=forget"], forgotten: ["id=keptLine", "tabindex=-1"] }[copy]);
      // The overview around it is as inert as it is without it.
      expectInert(text => overviewHtml(full(text), copy), 7);
    }
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
    // A table that lists none of the rows that were read for it: what it says in the rows' place, each of the texts in turn.
    for (const [index] of HOSTILE.entries()) expectInert(text => tableHtml(viewOf({ ...table(harmless), rows: [] }, NO_LINKS, { note: text(index), none: text(index + 1) })), 0);
    for (const entry of HOSTILE) expect(shownValues(tableHtml(viewOf({ ...table(harmless), rows: [] }, NO_LINKS, { none: entry }))), entry).toContain(entry);
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

  it("keeps a header as wide sorted as not: the arrow's place is in every header, and a sort changes only the arrow and what the header says", () => {
    const table: ResultTable = { file: "Cards.csv", label: "Cards", headers: ["Page", "Card #", "Card title", "Card type"], guard: true,
      rows: [["Overview", 1, "Sales", "Grid"], ["Stores", 2, "A title far longer than the others", "KPI"], ["Overview", 3, "Margin", "Grid"]] };
    /** Each header as written, without the arrow and without what it says of the sort: what gives it its width. */
    const heads = (sort: TableView["sort"]) => parseMarkup(tableParts(viewOf(table, LINKS, { sort })).grid).querySelectorAll("thead th")
      .map(heading => heading.outerHTML.replace(/ aria-sort="(none|ascending|descending)"/, "").replace(/[▲▼]/, ""));
    const colgroup = (sort: TableView["sort"]) => parseMarkup(tableParts(viewOf(table, LINKS, { sort })).grid).querySelector("colgroup")?.outerHTML;
    const unsorted = heads(undefined);
    // Every header holds the arrow's place, empty while its column is not sorted.
    expect(parseMarkup(tableParts(viewOf(table, LINKS)).grid).querySelectorAll("thead th").map(heading => heading.querySelectorAll(".th-sort .dir").length)).toEqual([1, 1, 1, 1]);
    for (const sort of [{ column: 2, dir: "asc" }, { column: 2, dir: "desc" }, { column: 0, dir: "asc" }, { column: 1, dir: "desc" }] as const) {
      expect(heads(sort), JSON.stringify(sort)).toEqual(unsorted);
      // The columns' widths are those of the table unsorted, to the character.
      expect(colgroup(sort), JSON.stringify(sort)).toBe(colgroup(undefined));
      // The arrow itself is in the sorted column's header, and in no other.
      expect(parseMarkup(tableParts(viewOf(table, LINKS, { sort })).grid).querySelectorAll(".dir").map(arrow => arrow.textContent))
        .toEqual(table.headers.map((_, index) => (index === sort.column ? (sort.dir === "asc" ? "▲" : "▼") : "")));
    }
  });

  it("shows a row whole in the drawer: each value as it is, in the element that keeps its line breaks and spaces", () => {
    const text = "IF Sales > 0 THEN\n    Sales  *  Price\nELSE\n\t0";
    const columns = [column(0, "Formula"), column(1, "Type", "tag"), column(2, "Page", "page"), column(3, "Card title", "card"), column(4, "Card ID", "id", { hidden: true }), column(5, "Empty"), column(6, "None")];
    const row: Cell[] = [text, text, text, text, text, "", "-"];
    for (const html of [rowDrawerHtml(columns, row, LINKS), rowDrawerHtml(columns, row, NO_LINKS), cardDrawerHtml(columns, row, LINKS, [])]) {
      const values = parseMarkup(html).querySelectorAll(".d-dl dd");
      expect(parseMarkup(html).querySelectorAll(".d-dl dt").map(name => name.textContent)).toEqual(["Formula", "Type", "Page", "Card title", "Card ID", "Empty", "None"]);
      // Every cell's own text, to the character, whatever its column's kind; an empty cell stays empty.
      expect(values.map(value => value.textContent)).toEqual([text, text, text, text, text, "", "-"]);
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
    // The switch: the table's name is in its label; a way's own name and words are the page's, and are written as text all
    // the same. Every place takes every text in turn: a tag in a way's words would be an element if they were not escaped.
    expectInertInTurn(text => tableHtml(viewOf({ file: "Where Used.csv", label: text(0), headers: [text(1)], rows: [[text(2)]], guard: true }, NO_LINKS,
      { ways: [{ way: "object", label: text(3), chosen: true }, { way: "use", label: text(4), chosen: false }], note: text(5) })), 6);
    // An object: its type, its module, its ID, its model, each role, and each use's page, card and role. Its name is the
    // drawer's heading, which the page sets as text.
    const object = (text: Texts, uses: number): WhereUsedObject => ({ type: text(0), module: text(1), id: text(2), model: text(3), name: text(4), pages: 2, cards: 3,
      roles: [[text(5), 2], [text(6), 1]], uses: Array.from({ length: uses }, (_, index) => ({ row: index, page: text(7 + index % 3), card: text(10 + index), usedAs: text(11 + index), cardId: index % 2 ? text(12) : undefined })) });
    for (const links of [LINKS, NO_LINKS]) {
      expectInert(text => objectDrawerHtml(object(text, 6), links, false), 7);
      expectInert(text => objectDrawerHtml(object(text, 60), links, false), 7);
      expectInert(text => objectDrawerHtml(object(text, 60), links, true), 7);
      // Each role, and each use's page, card and role, with each of the texts in turn.
      expectInertInTurn(text => objectDrawerHtml({ ...object(harmless, 0), roles: [[text(0), 2], [text(1), 1]],
        uses: [0, 1, 2, 3].map(index => ({ row: index, page: text(2 + index % 2), card: text(4 + index), usedAs: text(8 + index), cardId: index % 2 ? "card" : undefined })) }, links, false), 12);
    }
    // The line under the object's name: its type, its module, its ID and, in an app of several models, its model. Each of
    // them with each of the texts in turn: a model's name that holds a tag is shown as that text, as the others are.
    for (const multiModel of [true, false]) expectInertInTurn(text => objectDrawerSubHtml(object(text, 1), multiModel), multiModel ? 4 : 3);
    const named = parseMarkup(`<div>${objectDrawerSubHtml({ ...object(harmless, 1), model: `Demand ${IMG} planning <b>EU</b>` }, true)}</div>`);
    expect([named.querySelectorAll("img, b").length, named.textContent.includes(`Demand ${IMG} planning <b>EU</b>`)]).toEqual([0, true]);
    // An object with uses on a page name that pages share: its note, which names those pages, with each of the texts in
    // turn, in the line under its name; and its uses, each marked with how many pages have its page's name.
    // (The note takes the place after the model's, or the model's own in an app of one model, which says no model there.)
    for (const multiModel of [true, false]) {
      expectInertInTurn(text => objectDrawerSubHtml({ ...object(text, 1), pagesMost: 3, cardsMost: 4, note: `It has uses on "${text(multiModel ? 4 : 3)}" (2 pages).` }, multiModel), multiModel ? 5 : 4);
    }
    for (const links of [LINKS, NO_LINKS]) {
      expectInertInTurn(text => objectDrawerHtml({ ...object(harmless, 0), uses: [0, 1, 2, 3].map(index => ({ row: index, page: text(index % 2), card: text(2 + index), usedAs: text(6 + index), pagesOfName: 2 + index % 2 })) }, links, false), 10);
    }
    // What says the counts is the view's own words, made of numbers, and how many pages share a name is a number. Should
    // either hold a text all the same, as a value of the wrong shape can, it is written as that text.
    const plain = { ...object(harmless, 1), uses: [{ row: 0, page: "Overview", card: 1, usedAs: "Rows", pagesOfName: 2 }] };
    for (const entry of HOSTILE) {
      const odd = { ...plain, pages: entry as unknown as number, cards: entry as unknown as number, uses: [{ ...plain.uses[0], pagesOfName: entry as unknown as number }] };
      for (const [html, harmlessly] of [[objectDrawerSubHtml(odd, true), objectDrawerSubHtml(plain, true)], [objectDrawerHtml(odd, LINKS, false), objectDrawerHtml(plain, LINKS, false)]]) {
        expect(structure(html), entry).toEqual(structure(harmlessly));
        expect(shownValues(html).some(value => value.includes(entry)), entry).toBe(true);
      }
    }
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
    // With the text that was read for the cells said in words, under each kind of column; and each of the texts in turn as such a
    // text: it stands there as it was typed, and changes nothing else.
    expectInert(text => rowDrawerHtml(columns(text), row(text), LINKS, new Map(KINDS.map((_, index) => [index, text(index + 4)]))), 7);
    const withText = (exported: string) => rowDrawerHtml(columns(harmless), row(harmless), NO_LINKS, new Map([[1, exported]]));
    for (const entry of HOSTILE) {
      expect(structure(withText(entry)), entry).toEqual(structure(withText("a harmless text")));
      expect(shownValues(withText(entry)), entry).toContain(entry);
    }
    // With the file's own name for the column each such text was read from, which names the text in the column's place:
    // each of the texts in turn as such a name, and as the text that was read.
    expectInertInTurn(text => rowDrawerHtml(columns(text), row(text), LINKS, new Map(KINDS.map((_, index) => [index, text(index + 4)])), undefined,
      new Map(KINDS.map((_, index) => [index, text(index + 1)]))), 7);
    const named = (name: string) => rowDrawerHtml(columns(harmless), row(harmless), NO_LINKS, new Map([[1, "a harmless text"]]), undefined, new Map([[1, name]]));
    for (const entry of HOSTILE) {
      expect(structure(named(entry)), entry).toEqual(structure(named("Mapped To")));
      expect(shownValues(named(entry)), entry).toContain(`${entry} as read`);
    }
    // The line under a row's name says which row of which table, and is nothing but text whatever the table's name holds.
    for (const [index, name] of HOSTILE.entries()) {
      expectInert(text => rowDrawerSubHtml(41, text(index)), 0);
      expect(readMarkup(rowDrawerSubHtml(41, name)).tags).toEqual([]);
      expect(shownValues(rowDrawerSubHtml(41, name))).toEqual([`Row 41 of ${name}`]);
    }
    expect(rowDrawerSubHtml(3, "Line Items")).toBe("Row 3 of Line Items");
    expectInert(text => cardDrawerSubHtml(text(0), text(1), text(2)), 3);
    // The line about a card whose parts are left out names the card's page: it is text as well, with each of the texts in turn.
    expectInertInTurn(text => cardDrawerSubHtml(text(0), text(1), text(2), `2 cards on pages named "${text(3)}" have this number and this ID.`), 4);
    expectInert(text => cardDrawerHtml(columns(text), row(text), LINKS, [
      { title: text(0), none: text(1), headings: [text(2), text(3)], colours: [false, true], rows: [[text(4), text(5)], [text(6), text(0)]] },
      { title: text(1), none: text(2), headings: [text(3)], colours: [false], rows: [] },
    ]), 7);
  });

  it("lets no name in a source model's Mapped To change its table or its row's drawer: each name is shown as typed", () => {
    // Mapped To as Anaplan's own export of the Source Models grid writes it, with what a user can type into a workspace's
    // or a model's name in each name's place. Written as JSON, whatever a name holds, the cell is a mapping the page reads.
    const WORKSPACE_ID = "dc56f2296af444ca894c1bca437ae1b4";
    const MODEL_ID = "42FAAB38006B4E478C5A051DADA1B7C0";
    const mapped = (workspaceName: string, modelName: string): string => JSON.stringify({ workspaceId: WORKSPACE_ID, workspaceName, modelId: MODEL_ID, modelName });
    const shown = (rows: Cell[][]) => {
      const file: ResultTable = { file: "Source Models.csv", label: "Source Models", guard: false, headers: ["", "Mapped To"], rows };
      return fileView({ kind: "model", name: "Model one", id: "id", zipName: "x.zip", tables: [file], summary: [] }, file);
    };
    const sources = (text: Texts) => shown([0, 3].map(index => [text(index), mapped(text(index + 1), text(index + 2))]));
    const drawers = (text: Texts): string => {
      const view = sources(text);
      return view.table.rows.map(row => rowDrawerHtml(columnsOf(view.table), row, NO_LINKS, view.exported?.get(row), undefined, view.readUnder)).join("");
    };
    // The table with its line, and each row's drawer: each of the texts in turn in each place, as a source model's name, a
    // workspace's and a model's, and within the text that was read.
    expectInertInTurn(text => tableHtml(viewOf(sources(text).table, NO_LINKS, { note: sources(text).note })), 6);
    expectInertInTurn(drawers, 6);
    // Each name stands in its column as it was typed, and the text that was read is the file's cell, whole, as Mapped To.
    for (const entry of HOSTILE) {
      const view = shown([[entry, mapped(entry, entry)]]);
      expect(view.table.rows, entry).toEqual([[entry, entry, entry]]);
      const drawer = parseMarkup(rowDrawerHtml(columnsOf(view.table), view.table.rows[0], NO_LINKS, view.exported?.get(view.table.rows[0]), undefined, view.readUnder));
      expect([drawer.querySelectorAll("dt").map(name => name.textContent), drawer.querySelectorAll("dd").map(value => value.textContent)], entry)
        .toEqual([["Name", "Mapped Workspace", "Mapped Model", "Mapped To as read"], [entry, entry, entry, mapped(entry, entry)]]);
    }
  });

  it("lets no name in an import's Source Object change its table or its row's drawer: each name is shown as typed", () => {
    // Source Object as the Imports tab writes it, with what a user can type into a model's, a module's or a saved view's name
    // in each name's place: the model's name as it is, and the module's and the view's in quotes, with each quote in them
    // doubled, as the export writes a name that holds one. So each is read whatever it holds.
    const quoted = (name: string): string => `'${name.replaceAll("'", "''")}'`;
    const object = (model: string, module: string, view: string): string => `${model} / ${quoted(module)}.${quoted(view)}`;
    const shown = (rows: Cell[][]) => {
      const file: ResultTable = { file: "Imports.csv", label: "Imports", guard: false, headers: ["", "Source Object", "Source Type"], rows };
      return fileView({ kind: "model", name: "Model one", id: "id", zipName: "x.zip", tables: [file], summary: [] }, file);
    };
    const sources = (text: Texts) => shown([0, 4].map(index => [text(index), object(text(index + 1), text(index + 2), text(index + 3)), "SAVED VIEW"]));
    const drawers = (text: Texts): string => {
      const view = sources(text);
      return view.table.rows.map(row => rowDrawerHtml(columnsOf(view.table), row, NO_LINKS, view.exported?.get(row), undefined, view.readUnder)).join("");
    };
    // The table with its line, and each row's drawer: each of the texts in turn in each place, as an import's name, a model's,
    // a module's and a saved view's, and within the text that was read.
    expectInertInTurn(text => tableHtml(viewOf(sources(text).table, NO_LINKS, { note: sources(text).note })), 8);
    expectInertInTurn(drawers, 8);
    // Each name stands in its column as it was typed, and the text that was read is the file's cell, whole, as Source Object.
    for (const entry of HOSTILE) {
      const view = shown([[entry, object(entry, entry, entry), "SAVED VIEW"]]);
      expect(view.table.rows, entry).toEqual([[entry, entry, entry, entry, "SAVED VIEW"]]);
      const drawer = parseMarkup(rowDrawerHtml(columnsOf(view.table), view.table.rows[0], NO_LINKS, view.exported?.get(view.table.rows[0]), undefined, view.readUnder));
      expect([drawer.querySelectorAll("dt").map(name => name.textContent), drawer.querySelectorAll("dd").map(value => value.textContent)], entry)
        .toEqual([["Name", "Source Model", "Source Module", "Saved View", "Source Object as read", "Source Type"], [entry, entry, entry, entry, object(entry, entry, entry), "SAVED VIEW"]]);
    }
  });

  it("lets no text change a value that the drawer lists one item to a line: each item is shown as typed, and the list is the page's own", () => {
    // A value of three items in a row's drawer and in a card's, and in a cell of a card's part: the same list whatever the
    // items hold, each of them in each place in turn. The items are the cell's text cut, as cell-lists.ts gives them.
    const columns = [column(0, "Applies To"), column(1, "Name")];
    const row = (text: Texts): Cell[] => [[text(0), text(1), text(2)].join("; "), text(3)];
    const items = (text: Texts) => new Map([[0, [text(0), text(1), text(2)]]]);
    expectInertInTurn(text => rowDrawerHtml(columns, row(text), LINKS, undefined, items(text)), 4);
    expectInertInTurn(text => rowDrawerHtml(columns, row(text), NO_LINKS, new Map([[1, text(4)]]), items(text)), 5);
    expectInertInTurn(text => cardDrawerHtml(columns, row(text), LINKS, [{ title: text(4), none: "parts", headings: [text(6), text(0)], colours: [false, false],
      rows: [[[text(1), text(2), text(3)], text(5)]] }], items(text)), 7);
    // The list holds what the markup says and nothing of the value's: a list, an item each, and in each item its text.
    const html = rowDrawerHtml(columns, row(hostile), LINKS, undefined, items(hostile));
    const list = readMarkup(html).tags.filter(tag => ["ul", "li"].includes(tag.name) && !tag.closing);
    expect(list.map(tag => [tag.name, [...tag.attributes].map(([name, value]) => `${name}=${value}`)])).toEqual([["ul", ["class=cell-list"]], ["li", []], ["li", []], ["li", []]]);
    expect(parseMarkup(html).querySelectorAll(".cell-list li .cell-t").map(item => item.textContent)).toEqual([hostile(0), hostile(1), hostile(2)]);
    // A column that is more than plain text keeps its own markup, items or not: an ID to copy stays one pill.
    const pill = parseMarkup(rowDrawerHtml([column(0, "Card ID", "id")], [`${IMG}; ${SCRIPT}`], LINKS, undefined, new Map([[0, [IMG, SCRIPT]]])));
    expect([pill.querySelectorAll(".cell-list").length, pill.querySelectorAll(".id-pill").map(button => button.dataset.copy)]).toEqual([0, [`${IMG}; ${SCRIPT}`]]);
  });

  it("shows whole, and as inert as any value, a model's cell whose quotes do not pair up, so that where a name ends cannot be told", () => {
    /** Two names with a comma and a space between them, and quotes that cannot pair up whatever the name holds: twice the
     * name's own, and one more. */
    const unpaired = (name: string): string => `${name}, '${name}`;
    const table: ResultTable = { file: "Line Items.csv", label: "Line Items", headers: ["", "Applies To", "Referenced By"], guard: false,
      rows: HOSTILE.map(text => [text, unpaired(text), unpaired(QUOTED)]) };
    const model: AnalysisResult = { kind: "model", name: "Model", id: "model", zipName: "Model.zip", summary: [], tables: [table] };
    const lists = cellLists(model, table);
    expect([...lists.keys()]).toEqual([1, 2]);
    for (const [index, entry] of table.rows.entries()) {
      expect(rowItems(lists, entry).size, HOSTILE[index]).toBe(0);
      const html = rowDrawerHtml(columnsOf(table), entry, NO_LINKS, undefined, rowItems(lists, entry));
      expect([tagNames(html).includes("ul"), shownValues(html).includes(unpaired(HOSTILE[index]))], HOSTILE[index]).toEqual([false, true]);
    }
    expectInertInTurn(text => {
      const entry = [text(0), unpaired(text(1)), unpaired(text(2))];
      return rowDrawerHtml(columnsOf(table), entry, NO_LINKS, undefined, rowItems(lists, entry));
    }, 3);
  });

  it("writes only numbers the page counted itself into the pager and into what a click reads", () => {
    const html = pagerHtml(3, 12, 600, 50);
    expect(readMarkup(html).tags.filter(tag => tag.attributes.has("data-page")).map(tag => tag.attributes.get("data-page"))).toEqual(["2", "4"]);
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

describe("A formatting rule's colours", () => {
  /** Each colour of the markup: the code it shows, its square's style and whether screen readers skip the square. */
  const squares = (html: string) => parseMarkup(html).querySelectorAll(".colour").map(colour => {
    const square = colour.querySelector(".swatch");
    return [colour.textContent, square?.getAttribute("style"), square?.getAttribute("aria-hidden"), square?.textContent];
  });

  it("shows each colour of a colour stop as a square of that colour before its code, and keeps the rest as text", () => {
    const stops = "0 → #FFFFFF; 3 → #F9E95C; 5 → #1F46B4; 9 → #000";
    expect(squares(coloursHtml(stops))).toEqual([["#FFFFFF", "--swatch:#FFFFFF", "true", ""], ["#F9E95C", "--swatch:#F9E95C", "true", ""],
      ["#1F46B4", "--swatch:#1F46B4", "true", ""], ["#000", "--swatch:#000", "true", ""]]);
    expect(parseMarkup(coloursHtml(stops)).textContent).toBe(stops);
    // A card's rules one after another, as the Cards file writes them; a colour may be written in small letters.
    const card = "Border colour on Name (values from CF Input #): 0 → #FFFFFF; 3 → #F9E95C | Background on Delete? (values from CF Input #): 1 → #f9e95c";
    expect(squares(coloursHtml(card)).map(([code]) => code)).toEqual(["#FFFFFF", "#F9E95C", "#f9e95c"]);
    expect(parseMarkup(coloursHtml(card)).textContent).toBe(card);
  });

  it("shows a square for nothing but a colour stop's colour written as # and three or six hexadecimal digits", () => {
    for (const text of ["Item #123 (values from Count #)", "0 → red; 1 → rgb(0,0,0)", "0 → #12345", "0 → #1234567", "0 → #GGGGGG", "0 →#FFFFFF",
      "0 → #FFFFFF7", `0 → #FFF" onmouseover="alert(1)`, "0 → #FFF<b>", "0 → #FFFFFFx", ""]) {
      expect(squares(coloursHtml(text)), text).toEqual([]);
      expect(parseMarkup(coloursHtml(text)).textContent, text).toBe(text);
    }
  });

  it("shows the squares in a table's cell, with the whole text as its tooltip, and in the row's drawer, where the text is read in full", () => {
    const colours = column(0, "Colour stops", "colours");
    const stops = "0 → #FFFFFF; 3 → #F9E95C";
    expect([parseMarkup(cellHtml(colours, [stops], LINKS)).querySelector(".cell-t")?.getAttribute("title"), squares(cellHtml(colours, [stops], LINKS)).length]).toEqual([stops, 2]);
    expect([parseMarkup(cellHtml(colours, [stops], LINKS, true)).querySelector(".cell-t")?.hasAttribute("title"), squares(cellHtml(colours, [stops], LINKS, true)).length]).toEqual([false, 2]);
    // A dash stays a dash, and an empty cell stays empty.
    expect([cellHtml(colours, ["-"], LINKS), cellHtml(colours, [""], LINKS)]).toEqual(['<span class="dash">-</span>', ""]);
    // In a card's details, the column that holds colour stops shows their squares, and only that one.
    const drawer = cardDrawerHtml([], [], LINKS, [{ title: "Conditional formatting", none: "formatting rules", headings: ["Style", "Colour stops"], colours: [false, true],
      rows: [["0 → #FFFFFF", stops]] }]);
    expect(squares(drawer).map(([code]) => code)).toEqual(["#FFFFFF", "#F9E95C"]);
    // The stops a drawer lists one to a line, in a card's part or in a row's own column: each line has its square.
    const items = ["0 → #FFFFFF", "3 → #F9E95C"];
    for (const html of [cardDrawerHtml([], [], LINKS, [{ title: "Conditional formatting", none: "formatting rules", headings: ["Colour stops"], colours: [true], rows: [[items]] }]),
      rowDrawerHtml([colours], [stops], LINKS, undefined, new Map([[0, items]]))]) {
      expect(parseMarkup(html).querySelectorAll(".cell-list li").map(item => [item.textContent, item.querySelectorAll(".swatch").length])).toEqual([[items[0], 1], [items[1], 1]]);
    }
  });
});

describe("A result whose every text is hostile, through every view of the page", () => {
  let next = 0;
  const text = (): string => HOSTILE[next++ % HOSTILE.length];
  const appTable = (file: string, headers: string[], rows: number): ResultTable => ({
    file, label: file.replace(/\.csv$/, ""), headers, guard: true,
    // Every cell is hostile, except what ties a row to its card and page, which the drawer looks up: the page's name, the
    // card's ID and its number. Every card has one page name and one ID, and every other row one number: the Cards file's
    // first and third card are one card as far as the files say, and its second is told from them by its number. A rule's
    // colour stops hold colours, with their squares, beside their hostile text.
    rows: Array.from({ length: rows }, (_, index) => headers.map(header => (header === "Page" ? QUOTED : header === "Card ID" ? SCRIPT : header === "Card #" ? (index % 2 ? IMG : CLOSERS)
      : header === "Colour stops" ? `${text()} → #F9E95C; 1 → #1f46b4` : text()))),
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

  /** A model's navigation entries, each table's label a hostile text: tables of two groups and of one, and a file of a
   * hostile name, which no group names. */
  const MODEL_ENTRIES = [{ id: "overview", label: "Overview" }, { id: "1", label: IMG, file: "Modules.csv" }, { id: "2", label: QUOTED, file: "Line Items.csv" },
    { id: "3", label: SCRIPT, file: "Time Ranges.csv" }, { id: "4", label: CLOSERS, file: "Model Calendar.csv" }, { id: "5", label: ENTITY, file: "Versions.csv" },
    { id: "6", label: BREAK_OUT, file: SCRIPT }, { id: "map", label: MAP_LABEL }];

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
      navHtml([{ id: "overview", label: "Overview" }, ...tables.map((table, index) => ({ id: String(index + 1), label: table.label, file: table.file })), { id: "map", label: MAP_LABEL }], "overview"),
      // A model's line, its tables in groups by their files' names, and the one menu of a narrow window, which names the
      // view shown: here each table's label is a hostile text, and so is the name of a file no group names.
      navHtml(navItems(MODEL_ENTRIES, true), "2"),
      navMenuHtml(navItems(MODEL_ENTRIES, true), "2", QUOTED),
      // The overview holds what the Details file says, too: there is no view of it apart. And it says what the page keeps
      // of the result for a refresh: nothing yet, a copy, or a copy no longer.
      overviewHtml(overviewOf(result)),
      overviewHtml(overviewOf(result), "kept"),
      overviewHtml(overviewOf(result), "forgotten"),
      // The run's own view and its banner hold no text of a result, but they are the page's markup too. So is the view
      // of a model's map, shown and not drawn: the map itself is not the page's markup.
      runHtml(),
      runBannerHtml(),
      noteBannerHtml(),
      mapHtml(false),
      mapHtml(true),
    ];
    for (const table of tables) {
      const columns = columnsOf(table);
      const links = linksOf(table);
      pieces.push(tableHtml(viewOf(table, links, { search: SCRIPT, context: QUOTED })));
      pieces.push(tableHtml(viewOf(table, links, { columns: columns.filter(entry => !entry.hidden) })));
      pieces.push(colChooserHtml(columns, new Set()));
      for (const entry of columns.filter(candidate => candidate.filter)) pieces.push(colFilterHtml(entry, valueCounts(table.rows, entry.index), undefined));
      pieces.push(rowDrawerSubHtml(1, table.label));
      // As the page opens a row: each cell that lists several items listed one to a line (cell-lists.ts).
      const lists = cellLists(result, table);
      for (const row of table.rows) pieces.push(rowDrawerHtml(columns, row, links, undefined, rowItems(lists, row)));
    }
    if (cards) {
      // A card with its parts, and one whose parts are left out, under a line that names its page.
      expect(cards.table.rows.map(row => { const { sections, note } = cardParts(result, cards, row); return [sections.map(section => section.rows.length), note?.includes(QUOTED)]; }))
        .toEqual([[[0], true], [[1, 1, 0, 0], undefined], [[0], true]]);
      const lists = cellLists(result, cards.table);
      for (const row of cards.table.rows) {
        const { sections, note } = cardParts(result, cards, row);
        pieces.push(cardDrawerSubHtml(String(row[cards.page]), IMG, String(row[cards.cardId]), note));
        pieces.push(cardDrawerHtml(columnsOf(cards.table), row, linksOf(cards.table), sections, rowItems(lists, row)));
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
    const elements = new Set(["button", "circle", "col", "colgroup", "dd", "details", "div", "dl", "dt", "em", "h1", "h2", "h3", "input", "kbd", "label", "li", "option", "p", "path", "pre", "rect",
      "section", "select", "span", "strong", "summary", "svg", "table", "tbody", "td", "th", "thead", "tr", "ul"]);
    const attributes = /^(aria-[a-z]+|data-(act|nav|copy|sort|colfilter|col|fval|page|popact|way|use)|class|type|title|style|id|hidden|open|disabled|checked|selected|value|placeholder|tabindex|role|scope|width|height|viewBox|fill|stroke|stroke-width|stroke-linecap|stroke-linejoin|d|cx|cy|r|x|y|rx)$/;
    expect(tagNames(html).filter(name => !elements.has(name))).toEqual([]);
    expect(attributeNames(html).filter(name => !attributes.test(name))).toEqual([]);
    // The table, the drawer and the popovers are all there: this is the whole page, not a corner of it.
    expect(["table", "input", "dl", "pre", "select", "svg"].filter(name => !tagNames(html).includes(name))).toEqual([]);
  });

  it("keeps every text out of the attributes that are more than a text: classes, styles, IDs and what a click reads", () => {
    const styles = new Set<string>();
    const widths: string[] = [];
    for (const html of everyView()) {
      for (const tag of readMarkup(html).tags) {
        for (const [name, value] of tag.attributes) {
          if (value === undefined) continue;
          if (HOSTILE.some(entry => decode(value).includes(entry))) expect(VALUE_ATTRIBUTES, `${tag.name} ${name}="${value}"`).toContain(name);
          // A formatting rule's colour in its square and the number in a column's width are the only parts of a style that vary.
          if (name === "style") styles.add(value.replace(/^--swatch:#(?:[0-9A-Fa-f]{6}|[0-9A-Fa-f]{3})$/, "--swatch:#hex").replace(/^--width:\d+ch$/, "--width:Nch"));
          if (name === "style" && tag.name === "col") widths.push(value);
          if (name === "class") expect(value, "a class").toMatch(/^[a-z0-9 -]*$/);
          if (/^data-(sort|colfilter|col|fval|page|use)$/.test(name)) expect(value, name).toMatch(/^-?\d+$/);
          if (name === "data-act") expect(["page", "card", "row", "reset", "clear-search", "clear-context", "copy-diag", "copy-run-log", "use-page", "use-card", "more-uses", "forget"]).toContain(value);
          if (name === "data-nav") expect(value).toMatch(/^(overview|map|\d+)$/);
          if (name === "aria-controls") expect(value).toMatch(/^[A-Za-z]+$/);
          if (name === "data-way") expect(value).toMatch(/^(object|use)$/);
          if (name === "id") expect(value).toMatch(/^[A-Za-z]+$/);
        }
      }
    }
    // Every style on the page is one of the design's own; the only parts that vary are a formatting rule's colour in its
    // square, # and hexadecimal digits, and a column's width in ch (column-widths.ts), which the stylesheet reads as --width.
    // That number is counted from the lengths of the table's texts, and no text of a result can reach the style: each
    // column's style is the width and nothing else, a whole number of ch, here where every text of the result is hostile.
    expect([...styles].sort()).toEqual(["--swatch:#hex", "--width:Nch", "font-family:var(--mono);font-size:11px", "font-size:12px;color:var(--text-3);margin:4px 0 0",
      "margin-bottom:12px", "margin-left:auto;flex:none", "overflow:hidden;text-overflow:ellipsis"]);
    expect(widths.length).toBeGreaterThan(20);
    expect(widths.filter(width => !/^--width:[1-9]\d?ch$/.test(width))).toEqual([]);
  });

  it("shows each hostile text as it was typed, somewhere on the page", () => {
    const shown = everyView().flatMap(shownValues);
    for (const entry of HOSTILE) expect(shown.some(value => value.includes(entry)), entry).toBe(true);
  });

  it("lists in its drawers values whose hostile text the report's separators cut into items, so that the pins above hold for those lists too", () => {
    // A hostile text with "; " in it, in a column the report joins with "; ", is cut there: in a row's drawer and in a
    // card's. Without such a list the whole page above would say nothing of one.
    const lists = everyView().filter(html => readMarkup(html).tags.some(tag => tag.name === "ul" && tag.attributes.get("class") === "cell-list"));
    expect(lists.length).toBeGreaterThan(1);
    expect(lists.some(html => html.includes("<h3>Card details</h3>"))).toBe(true);
    expect(lists.flatMap(html => parseMarkup(`<div>${html}</div>`).querySelectorAll(".cell-list li .cell-t").map(item => item.textContent))).toContain("&lt;b&gt");
  });

  it("has static icons that hold nothing but their drawing", () => {
    for (const icon of [SUN_ICON, MOON_ICON]) expect(tagNames(icon).filter(name => !["svg", "path", "circle"].includes(name))).toEqual([]);
    // The navigation's icons are drawn of the same few shapes, and say nothing: no text, no name, no address.
    for (const icon of [...Object.values(NAV_ICONS), ...FILE_ICONS.values()]) {
      expect([tagNames(icon).filter(name => !["svg", "path", "circle", "rect"].includes(name)), readMarkup(icon).texts, attributeNames(icon).filter(name => /^(aria-label|title|href|src|id|style|class)$/.test(name))])
        .toEqual([[], [], []]);
    }
  });

  it("gathers a model's files in groups that keep the order of Model settings: each file the order names stands in one group or on its own, once, where the order has it", () => {
    const entries = MODEL_FILE_ORDER.map((file, index) => ({ id: String(index + 1), label: file.replace(/\.csv$/, ""), file }));
    const items = navItems(entries, true);
    // The line: Time, Versions, Lists, Modules, Actions, Source Models, and the three tables of the pages built on the model.
    expect(items.map(item => ("entries" in item ? `${item.group.label}: ${item.entries.length}` : item.label))).toEqual(["Time: 2", "Versions", "Lists: 2", "Modules: 3", "Actions: 5", "Source Models",
      "Module Usage", "Page Filters", "Page Actions"]);
    // Nothing is left out, and nothing moves: the items, opened up, are the order itself.
    expect(items.flatMap(item => ("entries" in item ? item.entries : [item])).map(entry => entry.file)).toEqual([...MODEL_FILE_ORDER]);
    // Every file of a group is one the order names, and none is in two groups. Each group's ID is its menu's, of letters
    // only; its name and its drawing are the page's own, a drawing of its own.
    const files = NAV_GROUPS.flatMap(group => group.files);
    expect([files.filter(file => !MODEL_FILE_ORDER.includes(file)), new Set(files).size === files.length]).toEqual([[], true]);
    expect(NAV_GROUPS.map(group => [group.id, group.label, group.icon])).toEqual([["navGroupTime", "Time", NAV_ICONS.time], ["navGroupLists", "Lists", NAV_ICONS.lists],
      ["navGroupModules", "Modules", NAV_ICONS.modules], ["navGroupActions", "Actions", NAV_ICONS.actions]]);
  });

  it("keys the navigation's icons by the names the analysis writes its files under, each file a drawing of its own, with drawings of their own for the overview, the map and any other table", () => {
    // Exactly the app's seven files and every file a model's navigation orders: no other name, so none that a result
    // could make up, and none left without its icon.
    expect([...FILE_ICONS.keys()].sort()).toEqual([...Object.values(APP_FILES), ...MODEL_FILE_ORDER].sort());
    // Every drawing is a different one: no two entries look alike, the overview's, the map's and the table's among them.
    const drawings = [...Object.values(NAV_ICONS), ...FILE_ICONS.values()];
    expect(new Set(drawings).size).toBe(drawings.length);
    // Each is drawn as the page's other icons are: 14px, in a box of 16 by 16, with a line of the text's colour, round
    // at its ends and its corners, and hidden from a screen reader.
    for (const icon of drawings) {
      const svg = readMarkup(icon).tags[0];
      expect([...svg.attributes]).toEqual([["width", "14"], ["height", "14"], ["viewBox", "0 0 16 16"], ["fill", "none"], ["stroke", "currentColor"], ["stroke-width", "1.5"],
        ["stroke-linecap", "round"], ["stroke-linejoin", "round"], ["aria-hidden", "true"]]);
    }
    // An entry's icon is its view's or its file's: the overview's and the map's by the view, a table's by its file's name,
    // and the table's for a file of a name the page does not know, or for none.
    const icon = (entry: { id: string; file?: string }) => parseMarkup(navHtml([{ label: "Anything", ...entry }], "")).querySelector("svg")?.outerHTML;
    const drawn = (made: string | undefined) => (made === undefined ? undefined : parseMarkup(made).innerHTML);
    expect([icon({ id: "overview" }), icon({ id: "map" }), icon({ id: "1", file: APP_FILES["Where used"] }), icon({ id: "1", file: "Line Items.csv" }), icon({ id: "1", file: "Dashboards.csv" }),
      icon({ id: "1" }), icon({ id: "1", file: "toString" }), icon({ id: "1", file: "__proto__" })])
      .toEqual([drawn(NAV_ICONS.overview), drawn(NAV_ICONS.map), drawn(FILE_ICONS.get("Where Used.csv")), drawn(FILE_ICONS.get("Line Items.csv")), drawn(NAV_ICONS.table),
        drawn(NAV_ICONS.table), drawn(NAV_ICONS.table), drawn(NAV_ICONS.table)]);
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
    expect(headings(overviewHtml(overview))).toEqual(["1 Overview", "2 Notes"]);
    // With what the Details file says: each part under a heading of its own, the two that start closed among them.
    expect(headings(overviewHtml({ ...overview, about: [["App", "Demo"]], files: [["Imports", "Not exported"]], howToRead: [["Layout", "As Anaplan's export."]], log: ["a line"] })))
      .toEqual(["1 Overview", "2 About this export", "2 Notes", "2 Tables", "2 How to read these tables", "2 Diagnostics"]);
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
