/** Pure helpers for Model settings grids (MODEL_DEFINITION view results from the classic model building client). They turn
 * label pages and data pages into rows of display text, as the grid shows them. No model access here: `native.ts` reads. */

export interface LabelPage { start?: number; count?: number; entityLongIds?: unknown[][]; labels?: unknown[][] }
/** The native `_DataPage` methods these helpers use. */
export interface CellSource {
  contains(row: number, column: number): boolean;
  getIndex(row: number, column: number): number;
  getCellText(index: number): unknown;
  getOriginalText(index: number): unknown;
}
export interface LabelEntry { ids: number[]; labels: string[] }
export interface GridRow { ids: number[]; labels: string[]; cells: string[] }
export interface Grid {
  columns: LabelEntry[];
  rows: GridRow[];
  /** Where the model refused rows of the grid, which was read without them (native.ts `readGrid`): how many rows the grid
   * has, as its first page said, and the place of each row left out, counted from 0 in the grid's order, as the log counts
   * a grid's rows. None where no row was left out. */
  refused?: { rowCount: number; places: number[] };
}

/** A count with its thousands apart, as a note and the log's line on a grid read in part say one: 7,100. */
export const thousands = (count: number): string => count.toLocaleString("en-US");

/** The places of rows, in words: "2,345", "2,345 and 5,012", "12, 40 and 41"; of more than ten, the first ten and how many
 * more. */
export function placesSaid(places: readonly number[]): string {
  const said = places.slice(0, 10).map(thousands);
  const more = places.length - said.length;
  if (more > 0) return `${said.join(", ")} and ${thousands(more)} more`;
  return said.length > 1 ? `${said.slice(0, -1).join(", ")} and ${said.at(-1)}` : said.join("");
}

/** What the note on a grid the model refused rows of says after the grid's name: how many of its rows were read, of how
 * many, and which it refused, by their places as the log says them. "7,098 of 7,100 rows: the model refused 2 (rows 2,345
 * and 5,012)." Nothing for a grid read whole. */
export function refusedNote(grid: Grid): string | undefined {
  const refused = grid.refused;
  if (!refused?.places.length) return undefined;
  const count = refused.places.length;
  return `${thousands(grid.rows.length)} of ${thousands(refused.rowCount)} rows: the model refused ${thousands(count)} (${count === 1 ? "row" : "rows"} ${placesSaid(refused.places)}).`;
}

/** What the Files row of a file made from such a grid alone says after its number of rows, its numbers written as that one
 * is: "7098 rows (the model refused 2 of 7100)". */
export function refusedRemark(grid: Grid): string | undefined {
  const refused = grid.refused;
  return refused?.places.length ? `the model refused ${refused.places.length} of ${refused.rowCount}` : undefined;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " " };

/** The native formatter HTML-escapes cell text; a table's cells need the plain text. */
export function plainText(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code: string) => {
      if (code[0] === "#") {
        const point = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
        return Number.isFinite(point) ? String.fromCodePoint(point) : match;
      }
      return ENTITIES[code.toLowerCase()] ?? match;
    });
}

/** Label page entries: dimension 0 is the entity itself; later dimensions are optional qualifiers (for example a line
 * item's module), where -1 marks an absent qualifier. */
export function labelEntries(page: LabelPage | undefined): LabelEntry[] {
  const dims = Array.isArray(page?.entityLongIds) ? page!.entityLongIds : [];
  const labels = Array.isArray(page?.labels) ? page!.labels : [];
  const count = typeof page?.count === "number" ? page.count : Array.isArray(dims[0]) ? dims[0].length : 0;
  const out: LabelEntry[] = [];
  for (let index = 0; index < count; index++) {
    const entry: LabelEntry = { ids: [], labels: [] };
    dims.forEach((dimension, d) => {
      const id = Array.isArray(dimension) ? Number(dimension[index]) : NaN;
      if (d > 0 && id === -1) return;
      entry.ids.push(id);
      entry.labels.push(plainText(Array.isArray(labels[d]) ? labels[d][index] : ""));
    });
    out.push(entry);
  }
  return out;
}

/** What Anaplan's own CSV export of a settings grid writes (compared with exports from Model settings, 28 Sep 2026): the
 * cell's underlying value (format and summary definitions as JSON, cell counts without separators, true/false, ISO dates,
 * list labels), and the display text only when there is no underlying value. */
export function cellText(pages: readonly CellSource[], row: number, column: number): string {
  const page = pages.find(candidate => candidate.contains(row, column));
  if (!page) return "";
  const index = page.getIndex(row, column);
  const original = page.getOriginalText(index);
  if (original !== null && original !== undefined && typeof original !== "object") return String(original);
  const text = page.getCellText(index);
  return typeof text === "string" ? plainText(text) : "";
}

/** Rows of one window: `rows` are this window's row labels, starting at absolute row `start`. */
export function windowRows(rows: readonly LabelEntry[], start: number, columnCount: number, pages: readonly CellSource[]): GridRow[] {
  return rows.map((row, offset) => ({ ...row, cells: Array.from({ length: columnCount }, (_, column) => cellText(pages, start + offset, column)) }));
}

export interface Table { headers: string[]; rows: string[][] }

/** A grid laid out as Anaplan exports it: an unlabelled first column with each row's label, then every grid column. All
 * rows are kept (module rows above their line items, heading rows in the Actions list) unless `keep` filters them. */
export function gridTable(grid: Grid, keep: (row: GridRow) => boolean = () => true): Table {
  return { headers: ["", ...grid.columns.map(column => column.labels[0] ?? "")], rows: grid.rows.filter(keep).map(row => [row.labels[0] ?? "", ...row.cells]) };
}
