import { describe, expect, it } from "vitest";
import { listenForWords, noMatchAnswer, WORDS, type KeyTarget, type TypedKey } from "./easter-eggs.js";

/** A page to type on: where its focus is and whether that is on the map, which a test sets, every line the page was
 * given to say, and what each key it heard was let do. */
function pageToType() {
  const listeners: [type: string, listener: (event: TypedKey) => void][] = [];
  const said: string[] = [];
  const where = { focus: "BODY", onMap: false };
  /** Each key that a listener prevented or stopped, by its name. */
  const held: string[] = [];
  const target: KeyTarget = {
    addEventListener: (type, listener) => { listeners.push([type, listener]); },
    get activeElement() { return { tagName: where.focus }; },
  };
  listenForWords(target, line => said.push(line), () => where.onMap);
  /** A key pressed where the focus is, with what `held` comes with. */
  const press = (key: string, also: Omit<TypedKey, "key"> = {}) => {
    const event = { key, ...also, preventDefault: () => held.push(`${key} prevented`), stopPropagation: () => held.push(`${key} stopped`) };
    for (const [, listener] of listeners) listener(event);
  };
  /** Each character of `text` as a key of its own. */
  const type = (text: string, also: Omit<TypedKey, "key"> = {}) => { for (const key of text) press(key, also); };
  return { listeners, said, where, held, press, type };
}

describe("What is hidden on the results page", () => {
  it("GGMU: four letters typed on the page bring Glory Glory Man United, in capitals too, and after any other letters", () => {
    const { listeners, said, press, type } = pageToType();
    // One listener, for the keys pressed on the page.
    expect(listeners.map(([type]) => type)).toEqual(["keydown"]);
    type("ggmu");
    expect(said).toEqual(["Glory Glory Man United"]);
    // Shift before each capital, and Caps Lock, neither go on with the word nor start it afresh.
    press("CapsLock");
    for (const letter of "GGMU") { press("Shift"); press(letter); }
    type("the road to ggmu");
    expect(said).toEqual(["Glory Glory Man United", "Glory Glory Man United", "Glory Glory Man United"]);
  });

  it("has a line for each of its words, said once the word's last letter is typed: LS21's is United all the way, United's is It's Man Utd we are talking about, and Saran's is For Saran", () => {
    expect([...WORDS]).toEqual([["ggmu", "Glory Glory Man United"], ["united", "It's Man Utd we are talking about."], ["ls21", "LS21 · United all the way"], ["saran", "For Saran."]]);
    for (const [word, line] of WORDS) {
      const { said, type } = pageToType();
      type(word.slice(0, -1));
      expect(said, word).toEqual([]);
      type(word.slice(-1));
      expect(said, word).toEqual([line]);
    }
    // A digit counts as a letter does, from the row of numbers or the keypad alike: both give the same key.
    const { said, type } = pageToType();
    type("LS21");
    expect(said).toEqual(["LS21 · United all the way"]);
  });

  it("counts a word only when it is typed in a row: any other key starts it afresh, and a word said starts the next afresh too", () => {
    const { said, press, type } = pageToType();
    for (const key of ["Enter", "Escape", "Tab", "ArrowDown", "Backspace", " "]) {
      type("ggm");
      press(key);
      type("u");
    }
    expect(said).toEqual([]);
    // The letters of a word just said are no part of the next: "ggmu" then "nited" is not United.
    type("ggmunited");
    expect(said).toEqual(["Glory Glory Man United"]);
    type("united");
    expect(said).toEqual(["Glory Glory Man United", "It's Man Utd we are talking about."]);
  });

  it("leaves a key typed in a text box, on the map, with Ctrl, Alt or the Command key, or while a character is composed, to what it was typed for, and the word starts afresh", () => {
    const { said, where, press, type } = pageToType();
    for (const box of ["INPUT", "TEXTAREA", "SELECT"]) {
      where.focus = box;
      type("ggmu");
      // Half a word outside the box and the rest in it is no word either.
      where.focus = "BUTTON";
      type("gg");
      where.focus = box;
      type("mu");
    }
    where.focus = "BUTTON";
    where.onMap = true;
    type("ggmu");
    where.onMap = false;
    for (const also of [{ ctrlKey: true }, { altKey: true }, { metaKey: true }]) {
      type("ggm");
      press("u", also);
      type("u");
    }
    type("ggmu", { isComposing: true });
    expect(said).toEqual([]);
    // Out of the box, off the map and without a modifier, the same keys say the word's line.
    type("saran");
    expect(said).toEqual(["For Saran."]);
  });

  it("never takes a key from the page, the map or the browser: it prevents and stops none, a word's last letter included", () => {
    const { said, held, where, press, type } = pageToType();
    type("ls21");
    where.focus = "INPUT";
    type("ggmu");
    where.focus = "BODY";
    press("u", { ctrlKey: true });
    press("Escape");
    expect([said, held]).toEqual([["LS21 · United all the way"], []]);
  });

  it("United all the way: a search for GGMU that finds nothing has an answer of its own, in either case and with space around it; any other search has none", () => {
    expect([noMatchAnswer("GGMU"), noMatchAnswer("ggmu"), noMatchAnswer("  GgMu\t")]).toEqual(["United all the way.", "United all the way.", "United all the way."]);
    expect(["", "ggm", "gg mu", "ggmu united", "united", "ls21", "saran"].map(noMatchAnswer)).toEqual(Array(7).fill(undefined));
  });
});
