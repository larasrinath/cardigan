/** What is hidden on the results page, for those who look closely. Each thing is found only on purpose, and only says a
 * line: a word typed on the page while the focus is in no text box and not on the model map, or a table's search for
 * GGMU that finds no row. No key is taken from the page or the map, no search lists other rows, and nothing here is read
 * from Anaplan, kept with a result, copied, or written into the diagnostic log.
 *
 * For Saran.
 *
 * GGMU. LS21 */

/** The words, each with the line the page's toast says for it. */
export const WORDS: ReadonlyMap<string, string> = new Map([
  ["ggmu", "Glory Glory Man United"],
  ["united", "It's Man Utd we are talking about."],
  ["ls21", "LS21 · United all the way"],
  ["saran", "For Saran."],
]);

/** What a table says in the place of its rows when its search for GGMU finds none. */
export const NO_GGMU = "United all the way.";

/** The keys that only change the next one: they neither go on with a word nor start it afresh, so that a word can be
 * typed in capitals. */
const MODIFIERS: ReadonlySet<string> = new Set(["Shift", "CapsLock", "Control", "Alt", "AltGraph", "Meta"]);
/** The elements a key is typed into, told apart as the page's own shortcut to the search tells them (main.ts). */
const TEXT_BOX = /^(INPUT|TEXTAREA|SELECT)$/;
const LONGEST = Math.max(...[...WORDS.keys()].map(word => word.length));

/** A key as the words read it: which key, and whether it came with Ctrl, Alt or the Command key, or while a character
 * was being composed. */
export interface TypedKey {
  readonly key: string;
  readonly ctrlKey?: boolean;
  readonly altKey?: boolean;
  readonly metaKey?: boolean;
  readonly isComposing?: boolean;
}

/** What the words are listened for on: the page's document, as far as they need it. */
export interface KeyTarget {
  addEventListener(type: "keydown", listener: (event: TypedKey) => void): void;
  readonly activeElement: { readonly tagName: string } | null;
}

/** Reads the keys typed in a row, and gives a word's line once its last letter is typed. A letter counts in either case,
 * and a digit as a letter does. */
export class WordReader {
  private typed = "";

  /** A key that counts: one character, which the word goes on with, or any other key, which starts it afresh. */
  key(key: string): string | undefined {
    if (key.length !== 1) {
      this.reset();
      return undefined;
    }
    this.typed = (this.typed + key.toLowerCase()).slice(-LONGEST);
    const word = [...WORDS.keys()].find(each => this.typed.endsWith(each));
    if (word === undefined) return undefined;
    this.typed = "";
    return WORDS.get(word);
  }

  /** A key that does not count, such as one typed in a text box: the word starts afresh. */
  reset(): void {
    this.typed = "";
  }
}

/** Listens on the page for the words, and has `show` say each one's line. A key counts only on the page itself: in no
 * text box, not on the map (`onMap`), and without Ctrl, Alt or the Command key. Every key goes on to the page, the map
 * and the browser as it would without this: nothing is prevented or stopped. */
export function listenForWords(page: KeyTarget, show: (line: string) => void, onMap: () => boolean): void {
  const reader = new WordReader();
  page.addEventListener("keydown", event => {
    if (event.isComposing || MODIFIERS.has(event.key)) return;
    if (event.ctrlKey || event.altKey || event.metaKey || onMap() || TEXT_BOX.test(page.activeElement?.tagName ?? "")) {
      reader.reset();
      return;
    }
    const line = reader.key(event.key);
    if (line !== undefined) show(line);
  });
}

/** What a table says in the place of its rows when its search finds none, for the one search with an answer of its own:
 * GGMU, in either case and with space around it. Undefined for any other search, which the table answers as ever. */
export const noMatchAnswer = (search: string): string | undefined => (search.trim().toLowerCase() === "ggmu" ? NO_GGMU : undefined);
