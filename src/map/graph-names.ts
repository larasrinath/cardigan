/** How a model export writes names, and how the model map reads them (build-graph.ts). A cell of the export that names
 * other objects is text: one name, or several with a comma between them, each in single quotes where it needs them, a
 * line item behind its module and a dot. The rules for headings, quotes and lists of names are those of the owner's
 * prototype builder (build_model_data.py). The names in a cell that writes them without quotes are read otherwise than
 * the prototype read them: see `knownSequence`. Text in, text out: nothing here knows a table or a node. White space is
 * what JavaScript's `trim` takes off. */

/** Whether a row's name makes the row a heading and no object: a name that starts with two dashes ("-- MODEL ADMIN"),
 * or one of nothing but spaces, dots and dashes, the empty name among them. Model builders divide a list of modules, of
 * lists or of actions with such rows. */
export const separator = (name: string): boolean => name.startsWith("--") || stripChars(name, " .-") === "";

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
