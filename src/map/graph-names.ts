/** How a model export writes names, and how the model map reads them (build-graph.ts). A cell of the export that names
 * other objects is text: one name, or several with a comma between them, each in single quotes where it needs them, a
 * line item behind its module and a dot. The rules for headings, quotes and lists of names are those of the owner's
 * prototype builder (build_model_data.py), kept as they are: what they give for a cell is what the prototype gave for it.
 * Text in, text out: nothing here knows a table or a node. White space is what JavaScript's `trim` takes off. */

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

/** The parts of a cell that lists names with `delimiter` between them: split only outside single quotes, so that a
 * delimiter inside a quoted name is part of the name. Each part comes back as it is written, quotes and all, without the
 * white space around it. An empty part says nothing, and neither does a dash, which the export writes for "none". */
export function splitOutside(text: string, delimiter = ","): string[] {
  const parts: string[] = [];
  let start = 0;
  let quoted = false;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (character === "'") {
      // Two single quotes inside a quoted name are one of the name's own, and end nothing.
      if (quoted && text[index + 1] === "'") {
        index++;
        continue;
      }
      quoted = !quoted;
    } else if (character === delimiter && !quoted) {
      parts.push(text.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(text.slice(start).trim());
  return parts.filter(part => part !== "" && part !== "-");
}

/** What separates the names of a cell that writes them without quotes (an action's Used in Processes). */
const BETWEEN = ", ";

/** The names in a cell that lists them without quotes, where a name may itself hold a comma and a space: at each step
 * the longest of the `known` names that the rest of the cell starts with and that ends where the cell does or before a
 * comma and a space. Where the rest starts with no known name, what stands before its next comma and space is taken for
 * a name, as it is written, and the caller finds that it is not one. `longest` is the length of the longest known name:
 * nothing longer is looked up. */
export function knownSequence(text: string, known: { has(name: string): boolean }, longest: number): string[] {
  const names: string[] = [];
  let rest = text.trim();
  while (rest !== "") {
    // Each place a name could end, from the nearest on: the last one that gives a known name is the longest name.
    let found = 0;
    for (let end = rest.indexOf(BETWEEN); ; end = rest.indexOf(BETWEEN, end + 1)) {
      const stop = end === -1 ? rest.length : end;
      if (stop > longest) break;
      if (stop > 0 && known.has(rest.slice(0, stop))) found = stop;
      if (end === -1) break;
    }
    if (found > 0) {
      names.push(rest.slice(0, found));
      rest = rest.slice(found).replace(/^[, ]+/, "");
      continue;
    }
    const next = rest.indexOf(BETWEEN);
    names.push(next === -1 ? rest : rest.slice(0, next));
    rest = next === -1 ? "" : rest.slice(next + BETWEEN.length);
  }
  return names;
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
