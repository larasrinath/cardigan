import { textOf } from "../result-plain.js";
import type { ResultTable } from "../result-types.js";

/** How a model export writes names, and how the model map reads them (build-graph.ts). A cell of the export that names
 * other objects is text: one name, or several with a comma between them, each in single quotes where it needs them, a
 * line item behind its module and a dot. The rules for headings, quotes and lists of names are those of the owner's
 * prototype builder (build_model_data.py). The names in a cell that writes them without quotes are read otherwise than
 * the prototype read them: see `knownSequence`. Heading styles are learnt from the result's own tables. White space is
 * what JavaScript's `trim` takes off. */

/** Heading prefixes and their closing marks. A closing mark is optional. */
export const HEADING_MARKS = { "--": "--", "==": "==", "**": "**", "<<": ">>", ">>": "<<" } as const;
/** Every character used by a heading mark, for trimming either end of a heading. */
export const HEADING_CHARS = Object.entries(HEADING_MARKS).flat().join("");

/** Whether a row's name makes the row a heading and no object: after leading spaces, it starts with a heading prefix,
 * or holds nothing but spaces, dots and heading marks, the empty name included. Model builders divide a list of modules,
 * lists or actions with such rows. */
export const separator = (name: string): boolean =>
  Object.keys(HEADING_MARKS).some(mark => name.trimStart().startsWith(mark)) || stripChars(name, ` .${HEADING_CHARS}`) === "";

const LETTER_OR_NUMBER = /[\p{L}\p{N}]/u;
const DECORATION = /[^\p{L}\p{N}\s]/u;
const BRACKET_PAIRS: Readonly<Record<string, string>> = { "(": ")", "[": "]", "{": "}", "<": ">" };

/** Matched brackets, including nested pairs. An opening bracket wraps the name only if its own close is at the end. */
function bracketPairs(name: string): [number, number][] {
  const stack: [string, number][] = [];
  const pairs: [number, number][] = [];
  for (let at = 0; at < name.length; at++) {
    const character = name[at];
    if (BRACKET_PAIRS[character]) stack.push([character, at]);
    else if (Object.values(BRACKET_PAIRS).includes(character)) {
      const open = stack.pop();
      if (open && BRACKET_PAIRS[open[0]] === character) pairs.push([open[1], at]);
    }
  }
  return pairs;
}

/** Symbols at both ends or two at the start, regardless of which symbols a model uses. */
export function decorated(name: string): boolean {
  const trimmed = name.trim();
  if (!LETTER_OR_NUMBER.test(trimmed)) return true;
  const characters = [...trimmed];
  const first = characters[0];
  if (!DECORATION.test(first)) return false;
  if (/^[^\p{L}\p{N}\s]\s*[^\p{L}\p{N}\s]/u.test(trimmed)) return true;
  if (BRACKET_PAIRS[first]) return bracketPairs(trimmed).some(([start, end]) => start === 0 && end === trimmed.length - 1);
  return first === characters[characters.length - 1];
}

/** Where a heading's words start and end: past the decoration at its two ends, with the brackets that belong to the
 * words, such as the two of "Inputs (FY)", kept on their side. A bracket pair counts as the words' only where it reaches
 * into them: a pair wholly inside the decoration, such as the "<>" of "<> Data <>", stays decoration. Nothing for a name
 * with no letter or digit: it is all decoration. `headingName` keeps what is between the two, and `headingStyle` is
 * made of what is outside them, so that the two always agree on what the decoration is. */
function wordsOf(name: string): [start: number, end: number] | undefined {
  if (!LETTER_OR_NUMBER.test(name)) return undefined;
  let start = name.match(/^[^\p{L}\p{N}]*/u)![0].length;
  let end = name.length - name.match(/[^\p{L}\p{N}]*$/u)![0].length;
  // Pairs come as they close, so an inner pair moves its edge before the pair round it does.
  for (const [open, close] of bracketPairs(name)) {
    if (open < start && close >= start && close < end) start = open;
    if (open >= start && open < end && close >= end) end = close + 1;
  }
  return [start, end];
}

/** The decoration at a heading's two ends, as its style: the runs keep their order but not their spacing, nor the
 * length of a repeated mark. It is what `headingName` strips, so brackets that belong to the words never change the
 * style: "-- Inputs (FY) --" and "-- Data --" share one. */
export function headingStyle(name: string): string {
  const collapse = (text: string): string => [...text.replace(/\s/g, "")].filter((character, at, all) => at === 0 || character !== all[at - 1]).join("");
  const words = wordsOf(name);
  const [before, after] = words ? [name.slice(0, words[0]), name.slice(words[1])] : [name, name];
  return JSON.stringify([collapse(before), collapse(after)]);
}

/** One set for a table: the old separators, empty decorated names, and decorated names in those empty rows' styles. */
export function headingNames(rows: readonly { name: string; empty: boolean }[]): Set<string> {
  const styles = new Set(rows.filter(row => row.empty && decorated(row.name)).map(row => headingStyle(row.name)));
  return new Set(rows.filter(row => separator(row.name) || (decorated(row.name) && (row.empty || styles.has(headingStyle(row.name))))).map(row => row.name));
}

/** The same untrimmed cell text that readLineItems compares. Whitespace in a Module Name is part of its name. */
const cellText = (value: unknown): string => value === null || value === undefined ? "" : textOf(value);

/** Work out module headings once before reading rows, using only tables already in the result. Consumers share this
 * decision: the map's Line Items and Modules passes, and Module Usage's list of exported modules. */
export function moduleHeadings(tables: readonly ResultTable[]): Set<string> {
  const modules = tables.find(table => table?.file === "Modules.csv");
  const items = tables.find(table => table?.file === "Line Items.csv");
  const rowsOf = (table: ResultTable | undefined): readonly unknown[][] => Array.isArray(table?.rows) ? Array.from(table.rows, row => Array.isArray(row) ? row : []) : [];
  const moduleRows = rowsOf(modules);
  const itemRows = rowsOf(items);
  const headers = Array.isArray(items?.headers) ? items.headers : [];
  const moduleAt = headers.indexOf("Module Name", 1);
  const counts = new Map<string, number>();
  for (const row of itemRows) {
    const name = cellText(row[moduleAt]);
    if (name.trim() !== "") counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const names = new Set(moduleRows.map(row => cellText(row[0])));
  const known = moduleRows.length ? new Set([...names, ...counts.keys()]) : undefined;
  const itemColumns = ["Format", "Formula", "Summary"].map(column => headers.indexOf(column, 1));
  for (const row of itemRows) {
    const name = cellText(row[0]);
    if (cellText(row[moduleAt]).trim() === "" && !itemColumns.some(at => cellText(row[at]).trim() !== "") && (!known || known.has(name))) names.add(name);
  }
  return headingNames([...names].map(name => ({ name, empty: !counts.has(name) })));
}

/** Strip a heading's decoration, retaining brackets that belong to its words, such as Inputs (FY) (`wordsOf`). A name
 * that is nothing but decoration gives Ungrouped. */
export function headingName(name: string): string {
  const words = wordsOf(name);
  return words ? name.slice(words[0], words[1]).trim() : "Ungrouped";
}

/** `text` without the characters of `chars` at its two ends. */
export function stripChars(text: string, chars: string): string {
  let start = 0;
  let end = text.length;
  while (start < end && chars.includes(text[start])) start++;
  while (end > start && chars.includes(text[end - 1])) end--;
  return text.slice(start, end);
}

/** A name as it is, out of the single quotes the export puts round one that needs them. Inside the quotes, two single
 * quotes are one that is part of the name. */
export function unquote(name: string): string {
  const text = name.trim();
  return text.length > 1 && text.startsWith("'") && text.endsWith("'") ? text.slice(1, -1).replaceAll("''", "'") : text;
}

/** Whether a cell that names one thing names nothing: it is empty, or holds the dash the export writes for "none". */
export const nothing = (cell: string): boolean => {
  const text = cell.trim();
  return text === "" || text === "-";
};

/** A name written among others, as the export writes one that needs it: in single quotes, with each single quote of its
 * own doubled, where it holds a comma, a bar or a single quote, has white space at an end, or says nothing on its own (it
 * is empty, or a dash). Any other name is written as it is. `splitOutside` then never cuts it, and `unquote` gives it
 * back as it was. */
export function quoted(name: string): string {
  return /[,|']/.test(name) || name !== name.trim() || nothing(name) ? `'${name.replaceAll("'", "''")}'` : name;
}

const OPENS = "([{";
const CLOSES = ")]}";

/** The parts of a cell that lists names with `delimiter` between them: split only outside single quotes, so that a
 * delimiter inside a quoted name is part of the name. Two single quotes inside a quoted name are one of the name's own:
 * they end the quoted text and open it again at once, so nothing between them is split. Each part comes back as it is
 * written, quotes and all, without the white space around it. An empty part says nothing, and neither does a dash.
 * With `brackets`, a delimiter inside round, square or curly brackets is no split either: a list's Properties cell
 * writes a format after each name, and a format may hold a comma in brackets ("Rate: NUMBER (2 dp, %)"). */
export function splitOutside(text: string, delimiter = ",", brackets = false): string[] {
  const parts: string[] = [];
  let start = 0;
  let quoted = false;
  let depth = 0;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (character === "'") quoted = !quoted;
    else if (quoted) continue;
    else if (brackets && OPENS.includes(character)) depth++;
    else if (brackets && CLOSES.includes(character)) depth = Math.max(0, depth - 1);
    else if (character === delimiter && depth === 0) {
      parts.push(text.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(text.slice(start).trim());
  return parts.filter(part => part !== "" && part !== "-");
}

/** What separates the names of a cell that writes them without quotes (an action's Used in Processes). */
const BETWEEN = ", ";

/** The known names of one kind, made ready to be found in a cell that lists such names without quotes. A name may itself
 * hold a comma and a space, so a name is one or more of the cell's parts in a row. The names are kept as a tree of their
 * parts, each node with where to go on when the next part does not fit (the longest end of what was read that starts a
 * name) and with the nearest shorter name that ends at the same part. A cell is then read once from its start, whatever
 * the names' lengths. */
export interface KnownNames {
  /** For each node, the node each next part leads to. Node 0 is the start. */
  next: Map<string, number>[];
  fallback: number[];
  /** The name that ends at the node, with the number of parts it has; none for a node inside a name. */
  name: (string | undefined)[];
  size: number[];
  /** The nearest node, going back by `fallback`, at which a name ends: 0 for none. */
  shorter: number[];
}

export function knownNames(names: Iterable<string>): KnownNames {
  const known: KnownNames = { next: [new Map()], fallback: [0], name: [undefined], size: [0], shorter: [0] };
  for (const name of names) {
    const parts = name.split(BETWEEN);
    let node = 0;
    for (const part of parts) {
      let to = known.next[node].get(part);
      if (to === undefined) {
        to = known.next.length;
        known.next.push(new Map());
        known.fallback.push(0);
        known.name.push(undefined);
        known.size.push(0);
        known.shorter.push(0);
        known.next[node].set(part, to);
      }
      node = to;
    }
    known.name[node] = name;
    known.size[node] = parts.length;
  }
  // Level by level from the start, so that a node's fallback is settled before the nodes after it ask for it.
  const queue = [...known.next[0].values()];
  for (let at = 0; at < queue.length; at++) {
    const node = queue[at];
    for (const [part, to] of known.next[node]) {
      // The longest end of what leads here that starts a name and goes on with this part. It is nearer the start than
      // `to`, and so is settled already.
      let back = known.fallback[node];
      while (back !== 0 && !known.next[back].has(part)) back = known.fallback[back];
      known.fallback[to] = known.next[back].get(part) ?? 0;
      known.shorter[to] = known.name[known.fallback[to]] !== undefined ? known.fallback[to] : known.shorter[known.fallback[to]];
      queue.push(to);
    }
  }
  return known;
}

/** Whether a part of such a cell says nothing: it is empty, a dash, or nothing but a stray comma. */
const silent = (part: string): boolean => nothing(stripChars(part, ", "));

/** One name of a cell that lists names without quotes: a known name, or text between two commas that is none. */
export interface NamedPart {
  name: string;
  known: boolean;
}

/** The names in a cell that lists them without quotes, with a comma and a space between them, where a name may itself
 * hold a comma and a space. The cell is read as known names wherever it can be: of all the ways to cut it at its commas,
 * the one that leaves the fewest parts that are no known name. Such a part is given as it is written, and the caller
 * finds that it names nothing; an empty part, a dash and a stray comma say nothing and are not given. Where two ways are equally good,
 * the cell reads two ways and neither is chosen: nothing comes back, and the caller has the whole cell to say so of.
 * (The prototype took the longest known name at each step, and so chose "Daily, Weekly" over Daily and Weekly.) */
export function knownSequence(text: string, known: KnownNames): NamedPart[] | undefined {
  if (silent(text)) return [];
  const parts = text.trim().split(BETWEEN);
  // For the cell up to each part: the fewest parts that are no known name, in how many ways (two stands for more), and
  // how the last name of that reading ends there: at a node of `known`, or at 0 as a part that is no known name.
  const fewest = [0];
  const ways = [1];
  const last = [0];
  let node = 0;
  for (let end = 1; end <= parts.length; end++) {
    const part = parts[end - 1];
    while (node !== 0 && !known.next[node].has(part)) node = known.fallback[node];
    node = known.next[node].get(part) ?? 0;
    let best = fewest[end - 1] + (silent(part) ? 0 : 1);
    let count = ways[end - 1];
    let ending = 0;
    for (let ends = known.name[node] !== undefined ? node : known.shorter[node]; ends !== 0; ends = known.shorter[ends]) {
      const before = end - known.size[ends];
      if (fewest[before] < best) {
        best = fewest[before];
        count = ways[before];
        ending = ends;
      } else if (fewest[before] === best) count = Math.min(2, count + ways[before]);
    }
    fewest.push(best);
    ways.push(count);
    last.push(ending);
  }
  if (ways[parts.length] > 1) return undefined;
  const names: NamedPart[] = [];
  for (let end = parts.length; end > 0;) {
    const ending = last[end];
    if (ending !== 0) names.push({ name: known.name[ending]!, known: true });
    else if (!silent(parts[end - 1])) names.push({ name: parts[end - 1], known: false });
    end -= ending !== 0 ? known.size[ending] : 1;
  }
  return names.reverse();
}

/** A count the export writes as digits, with or without commas between the thousands. Nothing for any other text, and
 * for a number too large to be held exactly. */
export function integer(text: string): number | undefined {
  const digits = text.replaceAll(",", "").trim();
  if (!/^[+-]?\d+$/.test(digits)) return undefined;
  const value = Number(digits);
  // Minus nothing is nothing.
  return Number.isSafeInteger(value) ? (value === 0 ? 0 : value) : undefined;
}

/** The definition a cell holds as JSON (a line item's Format and Summary, an action's Action), or nothing: the cell is
 * no JSON, or its JSON is no object. Most cells are neither, and are not parsed at all. */
export function definitionOf(text: string): Record<string, unknown> | undefined {
  if (!/^\s*\{/.test(text)) return undefined;
  try {
    const value: unknown = JSON.parse(text);
    return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}

/** An ID as a definition holds it, as digits: a number (a format's list, `101000000007`), or text between underscores
 * or not (`"_101000000007_"`, in an action). The export's own Format List column reads an ID so (model/lineitems.ts).
 * Nothing for anything else, and for a number of more digits than a number holds exactly. */
export function idOf(value: unknown): string | undefined {
  const digits = typeof value === "number" && Number.isSafeInteger(value) ? String(value) : typeof value === "string" ? stripChars(value, "_") : "";
  return /^\d+$/.test(digits) ? digits : undefined;
}
