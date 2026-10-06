/** Text for the model map that needs no page: how a name is split, how a number is said, and how a label is cut to the
 * room a node gives it. Widths are in em, multiples of the font size, so that one measurement of a word serves every
 * zoom: the canvas (map-canvas.ts) supplies the measurements. */

/** A first word that is a code by its look: capitals and digits with at least one of each, as in SYS01, C3 or REV01.2. */
const CODE = /^[A-Z][A-Z0-9]*[0-9][A-Z0-9]*(?:[._][A-Z0-9]+)?$/;

/** A module's name as its code and the rest. A code is one word at the start: the word before a dash ("REV01 - Revenue"),
 * or a word of capitals and digits before a space ("SYS01 Time Settings"). Any other name is the label whole.
 * Both patterns start at the name's start with a word of a few characters, so that neither has a choice of where a run
 * of spaces begins: a name of a hundred thousand spaces is read in the time it takes to pass over it once. */
export function splitName(name: string): { code: string; label: string } {
  const dashed = /^(\S{1,12})\s+[-\u2013\u2014]\s+(\S.*)$/.exec(name);
  if (dashed) return { code: dashed[1], label: dashed[2] };
  const spaced = /^(\S{2,12})\s+(\S.*)$/.exec(name);
  return spaced && CODE.test(spaced[1]) ? { code: spaced[1], label: spaced[2] } : { code: "", label: name };
}

/** A count with its thousands apart: 12,345. */
export function formatCount(value: number | undefined): string {
  return (Number.isFinite(value) ? (value as number) : 0).toLocaleString("en-US");
}

/** A cell count cut short for a node: 1.2K, 3.40M, 1.00B. */
export function formatCells(value: number | undefined): string {
  const cells = Number.isFinite(value) ? (value as number) : 0;
  if (cells >= 1e9) return `${(cells / 1e9).toFixed(2)}B`;
  if (cells >= 1e6) return `${(cells / 1e6).toFixed(2)}M`;
  if (cells >= 1e3) return `${(cells / 1e3).toFixed(1)}K`;
  return String(cells);
}

/** "1 module", "2 modules": a count with its noun. */
export function plural(count: number, one: string, many = `${one}s`): string {
  return `${formatCount(count)} ${count === 1 ? one : many}`;
}

/** What measures text, in em: a word (a run without spaces) or a single character, and the widths of a space and of the
 * mark that stands for what was cut. */
export interface TextMeasure {
  word(text: string): number;
  char(text: string): number;
  readonly space: number;
  readonly ellipsis: number;
}

const ELLIPSIS = "…";
const words = (text: string): string[] => text.split(/\s+/).filter(word => word !== "");

/** The width of a line: its words, and a space between each two. */
export function lineWidth(line: string, measure: TextMeasure): number {
  const parts = words(line);
  return parts.reduce((width, word) => width + measure.word(word), 0) + Math.max(0, parts.length - 1) * measure.space;
}

/** A line cut to a width: as it is when it fits, otherwise as many of its characters as fit before the mark. A width
 * that does not even hold the mark gives the mark alone. */
export function shorten(line: string, width: number, measure: TextMeasure): string {
  if (lineWidth(line, measure) <= width) return line;
  let kept = "";
  let used = measure.ellipsis;
  for (const char of line) {
    const next = used + (char === " " ? measure.space : measure.char(char));
    if (next > width) break;
    kept += char;
    used = next;
  }
  return `${kept.trimEnd()}${ELLIPSIS}`;
}

/** A label as at most `maxLines` lines of a width: words go to the next line when the line is full, and a word wider
 * than the line is cut. The last line takes whatever is left and is cut where it ends, with the mark, so that it is
 * filled before anything is left out. */
export function wrapLines(text: string, width: number, maxLines: number, measure: TextMeasure): string[] {
  const limit = Math.max(1, maxLines);
  const lines: string[] = [];
  let line = "";
  let used = 0;
  for (const [word] of text.matchAll(/\S+/g)) {
    // The last line is full and more: whatever follows is cut with it, and need not be read.
    if (lines.length === limit - 1 && used > width) break;
    const wide = measure.word(word);
    if (line !== "" && lines.length < limit - 1 && used + measure.space + wide > width) {
      lines.push(line);
      line = word;
      used = wide;
    } else {
      used = line === "" ? wide : used + measure.space + wide;
      line = line === "" ? word : `${line} ${word}`;
    }
  }
  if (line !== "") lines.push(line);
  return lines.map(each => shorten(each, width, measure));
}
