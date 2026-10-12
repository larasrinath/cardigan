/** The names a formula refers to, read from its text as a lexer reads it, and never worked out: the map's source inputs
 * find in it the list properties a line item reads (map-sources.ts), which no link of the graph names, and Polaris's
 * formula links are made from it (polaris-map.ts). */

interface Token { text: string; start: number; end: number; kind: "name" | "word" | "other" }
const KEYWORDS = new Set(["IF", "THEN", "ELSE", "AND", "OR", "NOT", "TRUE", "FALSE", "BLANK"]);

/** Lexical references only. Double-quoted text and numeric literals are never object IDs. Single-quoted names,
 * qualified references and bare names are retained; function names and selector/aggregation labels are skipped. */
export function formulaReferences(formula: string): { parts: string[]; written: string }[] {
  const tokens: Token[] = [];
  const pattern = /"(?:""|\\.|[^"\\])*"|'(?:''|[^'])*'|\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|[\p{L}_][\p{L}\p{N}_?]*|[^\s]/gu;
  for (const match of formula.matchAll(pattern)) {
    const raw = match[0];
    const quoted = raw.startsWith("'");
    tokens.push({ text: quoted ? raw.slice(1, -1).replace(/''/g, "'") : raw, start: match.index, end: match.index + raw.length,
      kind: quoted ? "name" : /^[\p{L}_]/u.test(raw) ? "word" : "other" });
  }
  const references: { parts: string[]; written: string }[] = [];
  const usable = (index: number): boolean => tokens[index]?.kind === "name" || (tokens[index]?.kind === "word" && !KEYWORDS.has(tokens[index].text.toUpperCase()));
  for (let at = 0; at < tokens.length;) {
    if (!usable(at)) { at++; continue; }
    const start = at;
    const parts: string[] = [];
    const part = (): string => {
      const first = at++;
      if (tokens[first].kind === "name") return tokens[first].text;
      while (usable(at) && tokens[at].kind === "word" && /^\s+$/.test(formula.slice(tokens[at - 1].end, tokens[at].start))) at++;
      return formula.slice(tokens[first].start, tokens[at - 1].end);
    };
    parts.push(part());
    while (tokens[at]?.text === "." && usable(at + 1)) { at++; parts.push(part()); }
    // SUM: and LOOKUP: name what follows; a function's arguments are scanned on their own.
    if (parts.length === 1 && tokens[start].kind === "word" && ["(", ":"].includes(tokens[at]?.text)) continue;
    references.push({ parts, written: formula.slice(tokens[start].start, tokens[at - 1].end) });
  }
  return references;
}
