import type { AnalysisResult, ResultTable } from "../result-types.js";
import { columnIndex } from "./columns.js";
import { cellText, compareText, NONE } from "./table-engine.js";

/** What the results page reads out of a result besides its tables: the Details file's sections, the diagnostic log, the
 * notes and the overview's counts. Everything is taken from cells as they stand: nothing is split out of a joined text. */

/** The one file about the export itself (App Details.csv, Model Details.csv): rows of Section, Detail, Value. */
export const detailsOf = (result: AnalysisResult): ResultTable | undefined => result.tables.find(table => table.details === true);

/** The sections details.ts and the two exports write that the page treats on their own. */
const DIAGNOSTICS = "Diagnostics";
const NOTES = "Notes";

export interface DetailSection { section: string; rows: [detail: string, value: string][] }

/** The Details file's rows under their sections, in the file's order, without the diagnostic log. */
export function detailSections(details: ResultTable | undefined): DetailSection[] {
  const sections = new Map<string, DetailSection>();
  for (const row of details?.rows ?? []) {
    const section = cellText(row[0]);
    if (section === DIAGNOSTICS) continue;
    let entry = sections.get(section);
    if (!entry) {
      entry = { section, rows: [] };
      sections.set(section, entry);
    }
    entry.rows.push([cellText(row[1]), cellText(row[2])]);
  }
  return [...sections.values()];
}

/** The diagnostic log the Details file carries, one line per row, each with its time as details.ts `diagnosticRows` split it. */
export function diagnosticLog(details: ResultTable | undefined): string[] {
  return (details?.rows ?? []).filter(row => cellText(row[0]) === DIAGNOSTICS).map(row => {
    const time = cellText(row[1]);
    return time ? `${time} ${cellText(row[2])}` : cellText(row[2]);
  });
}

/** One value of the Details file, or undefined when it has no such row. */
export function detailValue(details: ResultTable | undefined, section: string, detail: string): string | undefined {
  const row = details?.rows.find(candidate => cellText(candidate[0]) === section && cellText(candidate[1]) === detail);
  return row ? cellText(row[2]) : undefined;
}

/** The result's notes: its summary lines, then the Details file's Notes rows as "Detail: Value". A Notes row whose text
 * the summary already holds, word for word, is not said twice. */
export function resultNotes(result: AnalysisResult): { summary: string[]; notes: string[] } {
  const summary = result.summary.map(cellText).filter(line => line !== "");
  const said = new Set(summary);
  const notes: string[] = [];
  for (const row of detailsOf(result)?.rows ?? []) {
    if (cellText(row[0]) !== NOTES) continue;
    const detail = cellText(row[1]);
    const value = cellText(row[2]);
    const line = detail ? `${detail}: ${value}` : value;
    if (said.has(line) || said.has(value)) continue;
    said.add(line);
    notes.push(line);
  }
  return { summary, notes };
}

/** What the header says was analysed. */
export interface Analysed { name: string; kind: string; host: string | undefined; exportedOn: string | undefined }
export function analysedOf(result: AnalysisResult): Analysed {
  const details = detailsOf(result);
  return {
    name: cellText(result.name), kind: result.kind === "model" ? "Model" : "App",
    host: detailValue(details, "Export", "Anaplan host"), exportedOn: detailValue(details, "Export", "Exported on"),
  };
}

/** The files that list a card's parts, as the design's card details show them: a heading per column, holding one of the
 * file's columns or several put side by side (a dash or a blank among several is left out). */
export const CARD_PARTS: readonly { file: string; title: string; none: string; columns: readonly (readonly [heading: string, headers: readonly string[], join?: string])[] }[] = [
  { file: "Grid Sections.csv", title: "Grid sections", none: "grid sections", columns: [
    ["#", ["Section #"]], ["Layout", ["Section layout"]], ["Source module", ["Source module"]], ["Saved view", ["Saved view"]],
    ["Line items shown", ["Line items shown"]], ["Row filter", ["Row filter"]], ["Formatting", ["Conditional formatting"]]] },
  { file: "Filters.csv", title: "Filters", none: "filters", columns: [
    ["Sec", ["Section #"]], ["Filter on", ["Filter on"]], ["Dimension", ["Filtered dimension"]], ["Group", ["Condition group", "Show items that match"], " · "],
    ["Condition", ["Condition line item", "Operator", "Value"]], ["Context", ["Condition context"]]] },
  { file: "Conditional Formatting.csv", title: "Conditional formatting", none: "formatting rules", columns: [
    ["Sec", ["Section #"]], ["Style", ["Format style"]], ["Line item", ["Formatted line item"]], ["Driven by", ["Colour driven by"]], ["Colour stops", ["Colour stops"]]] },
  { file: "Action Buttons.csv", title: "Buttons & links", none: "buttons", columns: [
    ["Label", ["Button label"]], ["Action type", ["Action type"]], ["Model action", ["Model action name"]], ["Runs auto", ["Runs automatically"]], ["Cancel", ["Cancel button"]]] },
];

export interface CardSection { title: string; none: string; headings: string[]; rows: string[][] }

/** A card's parts: the rows of the other files that carry its Card ID on its page. A card is known by both, because a
 * page copied in Anaplan may keep its cards' IDs. A file the result does not have, or one without those two columns, is
 * left out. */
export function cardSections(result: AnalysisResult, page: string, cardId: string): CardSection[] {
  const sections: CardSection[] = [];
  for (const part of CARD_PARTS) {
    const table = result.tables.find(candidate => candidate.file === part.file);
    const pageColumn = table && columnIndex(table, "Page");
    const idColumn = table && columnIndex(table, "Card ID");
    if (!table || pageColumn === undefined || idColumn === undefined) continue;
    const indexes = part.columns.map(([, headers]) => headers.map(header => columnIndex(table, header)));
    const rows = table.rows.filter(row => cellText(row[idColumn]) === cardId && cellText(row[pageColumn]) === page);
    sections.push({
      title: part.title, none: part.none, headings: part.columns.map(([heading]) => heading),
      rows: rows.map(row => part.columns.map(([, , join], column) => {
        const texts = indexes[column].map(index => (index === undefined ? "" : cellText(row[index])));
        return texts.length === 1 ? texts[0] : texts.filter(text => text !== "" && text !== NONE).join(join ?? " ") || NONE;
      })),
    });
  }
  return sections;
}

export interface ModelRow { model: string; workspace: string; modelId: string }
export interface Overview {
  /** Every file but the Details file, with its number of rows. */
  tiles: { label: string; count: number }[];
  /** An app's cards by the text of their Card type, most first. */
  cardTypes: [type: string, count: number][];
  /** An app's models: each different Model, Workspace and Model ID its pages name, in the pages' order. */
  models: ModelRow[];
}

export function overviewOf(result: AnalysisResult): Overview {
  const tiles = result.tables.filter(table => table.details !== true).map(table => ({ label: cellText(table.label), count: table.rows.length }));

  const counts = new Map<string, number>();
  const cards = result.tables.find(table => table.file === "Cards.csv");
  const type = cards && columnIndex(cards, "Card type");
  if (cards && type !== undefined) {
    for (const row of cards.rows) counts.set(cellText(row[type]), (counts.get(cellText(row[type])) ?? 0) + 1);
  }
  const cardTypes = [...counts].sort(([a, x], [b, y]) => y - x || compareText(a, b));

  const models = new Map<string, ModelRow>();
  const pages = result.tables.find(table => table.file === "Pages.csv");
  const model = pages && columnIndex(pages, "Model");
  const workspace = pages && columnIndex(pages, "Workspace");
  const modelId = pages && columnIndex(pages, "Model ID");
  if (pages && model !== undefined && workspace !== undefined && modelId !== undefined) {
    for (const row of pages.rows) {
      const entry = { model: cellText(row[model]), workspace: cellText(row[workspace]), modelId: cellText(row[modelId]) };
      // A page that names no model at all (a dash in all three columns) is not a model.
      if (Object.values(entry).every(value => value === "" || value === NONE)) continue;
      const key = JSON.stringify(entry);
      if (!models.has(key)) models.set(key, entry);
    }
  }
  return { tiles, cardTypes, models: [...models.values()] };
}
